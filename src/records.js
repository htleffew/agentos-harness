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

export const writeRecord = (input, options = {}) => saveV10Record(input, options);

/** Where a record is stored and who wrote it. Records live in this chat's Story World book today. */
export function recordSource(record) {
    if (!record) return null;
    return {
        store:'story-world',
        world:chatWorld() || '',
        origin:record.baseline && !record.source ? 'character card' : record.source === 'user' ? 'player' : 'reply',
        quote:record.quote || '',
        atIndex:Number.isInteger(record.atIndex) ? record.atIndex : null,
    };
}

/** Saved changes to one record from the chat's change log, oldest first. */
export function recordHistory(record) {
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
    return { ...storyJournalStatus(), slots:editableReplySlots() };
}
export const refileStory = () => syncWorld();

export const entries = {
    load:id => loadWorld(id),
    list:(data, id) => listWorld(data, id),
    save:(id, data) => saveWorld(id, data),
    blank:(data, kind) => newWorldEntry(data, kind),
    put:(data, entry, id) => writeWorldEntry(data, entry, id),
    flags:entryFlags,
    text:renderEntry,
    recall:storyRecall,
    effective:id => loadEffectiveWorld(id),
    reserve:(data, id) => reserveStoryUids(data, id),
    changed:(id, uid, before, after) => recordManualWorldChange(id, uid, before, after),
    draftWithAI:options => writeWorldEntryWithAI(options),
};

/** The pinned Base World is read-only reference material and is not a Story World record. */
export const baseEntries = () => Object.values(baseWorld()?.entries || {});
