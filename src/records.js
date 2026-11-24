// The record adapter (DESIGN.md section 9): the one layer every story-record screen uses to list, read,
// write, trace and source a record. It sits over today's Story World book and changes no behavior. The
// memory design (MB2) replaces what sits behind it and the screens stay as they are.
//
// Two groups of records, one storage today:
//   Chat records (RECORD_KINDS): fact, profile, knowledge, emotion, relationship, arc, seed, agenda, event.
//     listRecords(kinds)            -> Promise<record[]>, newest definition of each, portrayal merged with its sources
//     readRecordById(id, kinds)     -> Promise<record|null>
//     writeRecord(input, {create})  -> Promise (saves through the story-journal queue, same as before)
//     recordSource(record)          -> {store, world, origin, quote, atIndex}  where the record came from
//     recordHistory(record)         -> [{time, type, field, before, after}]    saved changes, oldest first
//     filingStatus()                -> {filed, pending, uncertain, error, slots}  how current filing is
//   Story World entries (people, places, groups, threads, secrets, seeds, activities, chapters):
//     entries.load(id)              -> Promise<book data|null>
//     entries.list(data, id)        -> entry[] sorted by kind, then name
//     entries.save(id, data)        -> Promise
//     entries.blank(data, kind)     -> a new entry (reserves its id when given the reserving data)
//     entries.put(data, entry, id)  -> writes one entry into the book data
//     entries.flags(entry, others)  -> {blocks, checks, warns}
//     entries.text(entry, options)  -> the line the AI would receive
//     entries.recall(list)          -> what would be sent with the next reply
//     entries.effective(id)         -> Promise<book data with unfiled changes applied>
//     entries.reserve(data, id)     -> data with fresh ids reserved
//     entries.changed(id, uid, before, after) -> records a hand edit so a swipe or branch can undo it
//     entries.draftWithAI(options)  -> Promise, one model request, nothing saved
// Screens import this file for record data and nothing else from world.js, worldflow.js or memory-journal.js.

import { WORLD_KINDS, KIND_ORDER, isStructuredWorldKind, MAX_ACTIVITIES, chatWorld, loadWorld, saveWorld, listWorld, newWorldEntry, writeWorldEntry, entryFlags, renderEntry, storyRecall, writeWorldEntryWithAI } from './world.js';
import { loadEffectiveWorld, recordManualWorldChange, saveV10Record, syncWorld } from './worldflow.js';
import { readRecord, rowsForWorld, portrayalSources, baselineFor, effectivePortrayal, PLOT_KINDS, KIND_MODULE, baseWorld } from './v10.js';
import { reserveStoryUids, storyJournalStatus, editableReplySlots } from './memory-journal.js';
import { chatState } from './store.js';
import { ctx } from './st.js';
import { fold } from './memory/fold.js';
import { memoryStore } from './memory/store.js';
import { follow, currentWorldData, memoryActive, staleChapters } from './memory/import.js';
import { freeUid } from './books.js';

/** Every chat record kind, the screen that shows it and the feature that switches it on. */
export const RECORD_KINDS = {
    fact:{ screen:'facts', label:'Fact', module:KIND_MODULE.fact },
    profile:{ screen:'portrayal', label:'Portrayal', module:KIND_MODULE.profile },
    knowledge:{ screen:'portrayal', label:'Knowledge', module:KIND_MODULE.knowledge },
    emotion:{ screen:'emotion', label:'Emotion', module:KIND_MODULE.emotion },
    relationship:{ screen:'emotion', label:'Relationship', module:KIND_MODULE.relationship },
    arc:{ screen:'plots', label:'Arc milestone', module:KIND_MODULE.arc },
    seed:{ screen:'plots', label:'Seed', module:KIND_MODULE.seed },
    agenda:{ screen:'plots', label:'Agenda', module:KIND_MODULE.agenda },
    event:{ screen:'plots', label:'Event', module:KIND_MODULE.event },
};

/** The kinds one screen shows, in the order above. Facts and Plot stay separate screens; merging them later changes this table. */
export const kindsFor = screen => Object.entries(RECORD_KINDS).filter(([, info]) => info.screen === screen).map(([kind]) => kind);

export const kindLabel = kind => RECORD_KINDS[kind]?.label || kind;
export { PLOT_KINDS, WORLD_KINDS, KIND_ORDER, isStructuredWorldKind, MAX_ACTIVITIES, chatWorld };

export async function listRecords(kinds) {
    const rows = await rowsForWorld();
    let records = rows.map(readRecord).filter(Boolean);
    if (kinds.includes('profile')) {
        const sources = portrayalSources(rows);
        for (const [index, record] of records.entries()) if (record.kind === 'profile') {
            records[index] = effectivePortrayal(record, baselineFor(sources, record.subject, record.aliases));
        }
        for (const baseline of sources.values()) {
            if (records.some(record => record.kind === 'profile' && baselineFor(sources, record.subject, record.aliases) === baseline)) continue;
            const id = `portrayal-${baseline.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 45) || records.length}`;
            records.push({ kind:'profile', id, subject:baseline.name, text:baseline.text || baseline.voice, voice:baseline.voice, aliases:baseline.aliases, baseline });
        }
    }
    return records.filter(record => kinds.includes(record.kind));
}

export async function readRecordById(id, kinds = Object.keys(RECORD_KINDS)) {
    return (await listRecords(kinds)).find(record => record.id === id) || null;
}

/** Save a record as before, then file the change as your edit in chat data. */
export async function writeRecord(input, options = {}) {
    const result = await saveV10Record(input, options);
    if (memoryActive()) await follow({ origin: 'you' });
    return result;
}

// ---------------------------------------------------------------- memory in chat data (MB2)

export { memoryActive };
const folded = () => { const c = ctx(); return fold(c.chat || [], c.chatMetadata || {}); };
const dataOf = record => { try { return JSON.parse(record?.view?.fields?.data || 'null'); } catch { return null; } };

/** The record in the fold a screen's record stands for: by its fold id, its book uid, or its structured id. */
export function memoryRecordOf(record, result = folded()) {
    if (!record) return null;
    if (result.byId.has(record.id)) return result.byId.get(record.id);
    if (Number.isFinite(record.uid) && result.byId.has(`u${record.uid}`)) return result.byId.get(`u${record.uid}`);
    return result.records.find(item => dataOf(item)?.id === record.id) || null;
}

/** Every saved version of a record with its source, including those that no longer apply, oldest first. */
export function recordVersions(record) {
    const found = memoryRecordOf(record);
    return found ? memoryStore().history(found.id) : [];
}

export const revertChange = (entryId, reason) => memoryStore().revert(entryId, reason);
export async function restoreRecord(record) { const found = memoryRecordOf(record); return found ? memoryStore().restore(found.id) : { committed: false }; }
export async function lockRecord(record) { const found = memoryRecordOf(record); return found ? memoryStore().lock([found.id]) : { committed: false }; }
export async function unlockRecord(record) { const found = memoryRecordOf(record); return found ? memoryStore().unlock(found.id) : []; }

/** How this chat's memory stands: where it lives, how much, and what waits. */
export function memoryStatus() {
    const active = memoryActive();
    if (!active) return { active: false };
    const result = folded();
    const meta = ctx().chatMetadata?.ri_memory || {};
    return { active, imported: meta.imported || null, records: result.current.length, flags: result.flags.length, stale: staleChapters(result).map(item => item.id), bytes: memoryStore().bytes() };
}

/** Where a record is stored and who wrote it. */
export function recordSource(record) {
    if (!record) return null;
    const found = memoryActive() ? memoryRecordOf(record) : null;
    const latest = found?.versions?.at(-1);
    return {
        store:found ? 'chat' : 'story-world',
        world:chatWorld() || '',
        origin:found ? latest?.origin?.type === 'you' ? 'player' : latest?.origin?.type === 'import' && record.source === 'user' ? 'player' : record.baseline && !record.source ? 'character card' : latest?.origin?.type === 'import' ? 'reply' : latest?.origin?.type || 'reply'
            : record.baseline && !record.source ? 'character card' : record.source === 'user' ? 'player' : 'reply',
        quote:record.quote || '',
        atIndex:Number.isInteger(record.atIndex) ? record.atIndex : found && Number.isInteger(latest?.index) ? latest.index : null,
    };
}

/** Saved changes to one record, oldest first: the versions in chat data, or today's change log before the import. */
export function recordHistory(record) {
    if (memoryActive()) {
        return recordVersions(record).map(row => ({ time:row.at, type:row.op, field:'data', before:'', after:row.text, entry:row.entry, origin:row.origin, route:row.route, counts:row.counts, note:row.note, index:row.index }));
    }
    const items = Object.entries(chatState()?.worldLog?.items || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const out = [];
    for (const [time, item] of items) for (const change of item.changes || []) {
        if (change.field !== 'data' && change.type !== 'create') continue;
        let after = null;
        try { after = change.after ? JSON.parse(change.after) : null; } catch { /* a change that is not a record */ }
        if (after?.id === record?.id || change.name === record?.subject) out.push({ time:Number(time), type:change.type, field:change.field, before:change.before, after:change.after });
    }
    return out;
}

export function filingStatus() {
    return { ...storyJournalStatus(), slots:editableReplySlots(), memory:memoryStatus() };
}
export const refileStory = async () => { const result = await syncWorld(); if (memoryActive()) await follow(); return result; };

// A screen loads the book data, changes entries and saves it. For an imported chat the data it loads is the fold's
// view; on save only the entries the screen changed reach the book, and the change is filed as your edit.
const loadedFromFold = new WeakMap();
const isStoryWorld = id => !!id && id === chatWorld() && memoryActive();
const sameEntry = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function loadForScreen(id) {
    if (!isStoryWorld(id)) return loadWorld(id);
    const book = await loadWorld(id);
    if (!book) return null;
    const data = await currentWorldData(id);
    data.extensions = { ...(book.extensions || {}), riNextUid: Math.max(freeUid(book), freeUid(data)) };
    loadedFromFold.set(data, structuredClone(data.entries));
    return data;
}

async function saveFromScreen(id, data) {
    const base = loadedFromFold.get(data);
    if (!base) return saveWorld(id, data);
    const book = await loadWorld(id);
    if (!book) throw new Error('The Story World book could not be read.');
    for (const uid of new Set([...Object.keys(base), ...Object.keys(data.entries || {})])) {
        if (sameEntry(base[uid], data.entries?.[uid])) continue;
        if (data.entries?.[uid]) book.entries[uid] = structuredClone(data.entries[uid]);
        else delete book.entries[uid];
    }
    book.extensions = { ...(book.extensions || {}), riNextUid: Math.max(freeUid(book), Number(data.extensions?.riNextUid) || 0) };
    await saveWorld(id, book);
    loadedFromFold.set(data, structuredClone(data.entries));
    await follow({ origin: 'you' });
}

export const entries = {
    load:id => loadForScreen(id),
    list:(data, id) => listWorld(data, id),
    save:(id, data) => saveFromScreen(id, data),
    blank:(data, kind) => newWorldEntry(data, kind),
    put:(data, entry, id) => writeWorldEntry(data, entry, id),
    flags:entryFlags,
    text:renderEntry,
    recall:storyRecall,
    effective:async id => isStoryWorld(id) ? currentWorldData(id) : loadEffectiveWorld(id),
    reserve:(data, id) => reserveStoryUids(data, id),
    changed:async (id, uid, before, after) => { const result = recordManualWorldChange(id, uid, before, after); if (isStoryWorld(id)) await follow({ origin: 'you' }); return result; },
    draftWithAI:options => writeWorldEntryWithAI(options),
};
/** The pinned Base World is read-only reference material and is not a Story World record. */
export const baseEntries = () => Object.values(baseWorld()?.entries || {});
