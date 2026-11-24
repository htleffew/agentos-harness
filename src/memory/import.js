// Moving today's chats over (memory DESIGN 8.5), and filing the book edits that still reach the Story World book.
//
// On the first open after the update, after one settings backup, a chat's Story World book imports into chat data:
// every entry becomes an `import` entry anchored to the reply it came from (chapters to the last reply they cover, with
// the replies they cover kept as `covers`), the changes still staged on replies in the editable window become per-reply
// entries of the swipe they belong to, and saved stat sheets become this chat's starting sheets. The book itself is
// left as it is.
//
// Capture (src/memory/capture.js) writes each reply's entries straight into chat data, so no reply writes the book any
// more. Edits typed on a record screen and today's chapter writer still save the book; fileBookEdits() turns each of
// those changes into a chat log entry (yours are locked). A difference that comes from the store's own side (a revert, a
// lock, a swipe or a delete the fold already handles) is left alone, so the fold, not the book, decides what the Story
// World page and the request read.
import { ctx, KEY, LOG, on, isReply, names, characterKey } from '../st.js';
import { settings } from '../store.js';
import { setInfo } from '../books.js';
import { chatWorld, listWorld, writeWorldEntry, isStructuredWorldKind } from '../world.js';
import { loadEffectiveWorld, worldIdle } from '../worldflow.js';
import { replayStoryPatch } from '../memory-journal.js';
import { MEMORY, RANGE_KINDS, OUT_OF_FORCE, canonical, chatMemory, fold, forgetFold, hashText, makeEntry, proseOf, revisionOf, storedMark, swipeEntries, swipeOf } from './fold.js';
import { memoryStore } from './store.js';
import { addRebuilder, desktopQueue } from './queue.js';

export const IMPORT_VERSION = 1;

// ---------------------------------------------------------------- records from book entries (pure)

const DESIGN_KIND = {
    character: ['person'], place: ['place'], faction: ['group'], secret: ['secret'], chapter: ['chapter'],
    thread: ['thread', 'Open'], seed: ['thread', 'Detail'], activity: ['thread', 'Elsewhere'],
    fact: ['fact'], profile: ['person'], knowledge: ['secret'], emotion: ['emotion'], relationship: ['relationship'],
    arc: ['thread', 'Plotline'], agenda: ['thread', 'Plan'], event: ['thread', 'Pending'], payoff: ['thread', 'Seed'],
};
/** The design kind (and thread type) of one of today's entry kinds (DESIGN 3.3, 8.5). */
export const designKind = kind => DESIGN_KIND[kind] || ['fact'];

const IMPORTANCE = { chapter: 7, secret: 7, knowledge: 7, arc: 8, agenda: 7, thread: 6, seed: 6, relationship: 6, character: 5, profile: 5, fact: 5, place: 4, faction: 4, activity: 5, emotion: 4, event: 6, payoff: 6 };
const clip = (text, max) => { const v = String(text ?? '').replace(/\s+/g, ' ').trim(); return v.length <= max ? v : (v.slice(0, max).replace(/\s+\S*$/, '') || v.slice(0, max)); };
const parseData = view => { try { return JSON.parse(view?.fields?.data || 'null'); } catch { return null; } };

/** A record in the design's shape from one of today's Story World entries (the panel's view of it). */
export function recordFromView(view) {
    const [kind, threadType] = designKind(view.kind);
    const data = isStructuredWorldKind(view.kind) ? parseData(view) : null;
    const fields = view.fields || {};
    const subject = clip(data?.subject || data?.name || data?.character || fields.holder || view.name || '', 120);
    const text = data
        ? data.text || data.summary || data.state || data.facts?.join?.('. ') || ''
        : view.kind === 'chapter' ? fields.summary || '' : view.kind === 'secret' ? fields.secret || fields.shadow || '' : Object.values(fields).filter(Boolean).join('. ');
    const holders = view.kind === 'secret' ? [fields.holder, ...String(fields.known || '').split(/,|\band\b/)].map(s => String(s || '').trim()).filter(Boolean)
        : view.kind === 'knowledge' ? [].concat(data?.holders || data?.character || data?.subject || []).map(String) : undefined;
    return {
        id: `u${view.uid}`, kind, ...(threadType ? { threadType } : {}), subject, attribute: clip(data?.attribute || view.kind, 60),
        text: clip(text, RANGE_KINDS.includes(kind) ? 4000 : 300), ...(holders ? { holders } : {}), aliases: [...(view.aliases || [])],
        status: 'current', ...(data?.outcome ? { outcome: String(data.outcome) } : {}), story_time: clip(fields.when || data?.date || '', 60),
        importance: IMPORTANCE[view.kind] || 5, view: structuredClone(view),
    };
}

// A record capture files (DESIGN 3.3) as the structured kind the request and the record screens read today.
const THREAD_VIEW = { Plotline: 'arc', Open: 'arc', Track: 'arc', Plan: 'agenda', Elsewhere: 'agenda', Pending: 'event', Seed: 'seed', Detail: 'seed' };
const VIEW_KIND = { person: 'profile', secret: 'knowledge', relationship: 'relationship', emotion: 'emotion' };
/** The structured kind of a design record: profile, knowledge, relationship, emotion, a plot kind, or fact. */
export const viewKindOf = record => record.kind === 'thread' ? THREAD_VIEW[record.threadType] || 'arc' : VIEW_KIND[record.kind] || 'fact';

/** The panel's view a record is shown as: its stored view, or one made for a record that never had a book entry. */
export function viewOfRecord(record, uid) {
    if (record.view) return { ...structuredClone(record.view), uid: Number.isFinite(record.view.uid) ? record.view.uid : uid };
    const kind = viewKindOf(record);
    const data = {
        id: record.id, kind, text: record.text || '', subject: record.subject || '', aliases: record.aliases || [], ...(record.quote ? { quote: record.quote } : {}),
        ...(record.attribute ? { attribute: record.attribute } : {}), ...(record.holders ? { holders: record.holders } : {}), ...(record.outcome ? { outcome: record.outcome } : {}),
        ...(record.other ? { other: record.other } : {}), ...(record.axes ? { axes: record.axes } : {}), ...(record.source?.speaker ? { basis: 'reported', reportedBy: record.source.speaker } : {}),
        ...(kind === 'knowledge' ? { private: true, basis: record.source?.speaker ? 'reported' : 'observed' } : {}),
        ...(['arc', 'agenda', 'event', 'seed'].includes(kind) ? { status: ['done', 'failed'].includes(record.status) ? 'done' : 'open' } : {}),
    };
    const bookKind = kind === 'seed' ? 'payoff' : kind;
    return { uid, kind: bookKind, name: record.id, on: true, aliases: [], fields: { data: JSON.stringify(data) }, status: '', show: 'shadow', auto: true, locked: !!record.locked, at: null, span: null, rollup: false };
}

/** The views of the records in force, keyed by uid, with locks shown on the view as today's book showed them. */
export function viewsFromFold(result) {
    const views = new Map();
    let next = 0;
    for (const record of result.records) if (Number.isFinite(record.view?.uid)) next = Math.max(next, record.view.uid + 1);
    for (const record of result.records) {
        // A suspect is held out of recall until the next capture rules on it (DESIGN 7.2, check 5).
        if (OUT_OF_FORCE.includes(record.status) || record.status === 'suspect') continue;
        const view = viewOfRecord(record, Number.isFinite(record.view?.uid) ? record.view.uid : next++);
        if (record.locked) view.locked = true;
        views.set(view.uid, view);
    }
    return views;
}

/** Comparable hash of a view: everything the panel and the request read from it. */
export const viewHash = view => (view ? hashText(canonical({ ...view, isNew: undefined })) : '');

// ---------------------------------------------------------------- anchors

/** The chat index of today's reply number n (reply 1 is the first reply after the opening). */
function indexOfReply(chat, n) {
    let count = 0;
    for (let i = 0; i < chat.length; i++) if (i > 0 && isReply(chat[i]) && ++count === n) return i;
    return -1;
}
const indexOfTime = (chat, time) => time ? chat.findIndex(m => String(m?.extra?.[KEY]?.time ?? '') === String(time)) : -1;

/** Where an imported entry belongs: the reply that made it, by the reply time, chat index or reply number it stored. */
export function anchorIndexOf(chat, view) {
    if (view.kind === 'chapter' && view.span) {
        const byTime = indexOfTime(chat, view.span.time);
        if (byTime >= 0) return byTime;
        const byNumber = indexOfReply(chat, view.span.to);
        if (byNumber >= 0) return byNumber;
    }
    const data = isStructuredWorldKind(view.kind) ? parseData(view) : null;
    if (data) {
        const byTime = indexOfTime(chat, data.source);
        if (byTime >= 0) return byTime;
        if (Number.isInteger(data.atIndex) && chat[data.atIndex]) return data.atIndex;
    }
    if (view.at?.n) { const byNumber = indexOfReply(chat, view.at.n); if (byNumber >= 0) return byNumber; }
    return 0;
}

/** The revisions a chapter covers, for its staleness check. */
export function coversOf(chat, view) {
    if (view.kind !== 'chapter' || !view.span) return [];
    const from = indexOfReply(chat, view.span.from), to = anchorIndexOf(chat, view);
    if (from < 0 || to < from) return [];
    const start = from > 0 && chat[from - 1]?.is_user ? from - 1 : from;
    return chat.slice(start, to + 1).map(revisionOf).filter(r => r.mark);
}

/** One import entry for a view. */
export function importInput(chat, view, { origin = 'import', route = 'story world' } = {}) {
    const record = recordFromView(view);
    const at = anchorIndexOf(chat, view);
    const covers = coversOf(chat, view);
    if (covers.length) record.covers = covers;
    return { op: 'add', record, origin: { type: origin, route }, anchor: { mark: storedMark(chat[at]) }, reason: 'Moved over from the Story World book.' };
}

// ---------------------------------------------------------------- the host side

const host = () => ctx();
const metaOf = () => host().chatMetadata || {};

/** True once this chat's memory lives in chat data. */
export function memoryActive() {
    try { return !!host().getCurrentChatId?.() && !!metaOf()[MEMORY]?.imported; } catch { return false; }
}

/** The chat's Story World book as the fold shows it: book data the panel and the request read. */
export function foldWorldData(id = chatWorld(), { before = Infinity } = {}) {
    const result = fold(host().chat || [], metaOf(), { before });
    const info = setInfo(id);
    const data = { entries: {}, extensions: { riFromMemory: true } };
    for (const view of viewsFromFold(result).values()) {
        const entry = writeWorldEntry(data, view, id);
        if (info.shared) entry.extensions.ri.set = info.group;
    }
    return data;
}

/**
 * The chat's Story World as a reader sees it now: book edits saved a moment ago are filed first, then the fold is read.
 * The request and the record screens read through this, so an edit is in both.
 */
export async function currentWorldData(id = chatWorld(), options = {}) {
    await fileBookEdits();
    return foldWorldData(id, options);
}

/** The rows the request and the panel list for this chat, from the fold. */
export async function foldRows(id = chatWorld(), options = {}) {
    return listWorld(await currentWorldData(id, options), id);
}

const BACKUP_KEY = 'memoryBackup';

/** One backup of the extension settings, saved as a file in SillyTavern's user files before the first import. */
export async function backupSettingsOnce({ upload = uploadFile } = {}) {
    const s = settings();
    if (s[BACKUP_KEY]?.name) return s[BACKUP_KEY];
    const created = new Date().toISOString();
    const name = `roleplay-instructions-settings-backup-${created.replace(/[^0-9]/g, '').slice(0, 14)}.json`;
    const copy = structuredClone({ ...s, [BACKUP_KEY]: undefined });
    const text = JSON.stringify({ schema: 'roleplay-instructions/settings-backup@1', created, reason: 'Before chat memory moved into chat data (memory DESIGN 8.5).', settings: copy });
    const path = await upload(name, text);
    s[BACKUP_KEY] = { name, path, created, bytes: text.length };
    try { host().saveSettingsDebounced?.(); } catch { /* saved with the next change */ }
    return s[BACKUP_KEY];
}

async function uploadFile(name, text) {
    const c = host();
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const response = await fetch('/api/files/upload', { method: 'POST', headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: btoa(binary) }) });
    if (!response.ok) throw new Error(`The settings backup was not saved (${response.status}).`);
    return (await response.json().catch(() => ({})))?.path || name;
}

function viewsOf(data, id) {
    return new Map(data ? listWorld(data, id).map(view => [view.uid, view]) : []);
}

/** The replies whose shown swipe still has staged changes from today's editable window. */
function stagedReplies(chat, world) {
    const out = [];
    chat.forEach((message, index) => {
        if (index === 0 || !isReply(message)) return;
        const update = message.extra?.[KEY]?.update;
        if (update?.world === world && update.pending?.changes?.length && !update.undone) out.push(index);
    });
    return out;
}

/** The staged changes of the swipes a reply does not show, each as a list of patches. */
function otherSwipePatches(message, world) {
    const out = [];
    (message.swipe_info || []).forEach((info, k) => {
        if (k === swipeOf(message)) return;
        const update = info?.extra?.[KEY]?.update;
        if (update?.world === world && update.pending?.changes?.length && !update.undone) out.push({ swipe: k, changes: update.pending.changes });
    });
    return out;
}

function changedViews(before, after) {
    const out = [];
    for (const [uid, view] of after) if (viewHash(view) !== viewHash(before.get(uid))) out.push({ uid, view });
    for (const uid of before.keys()) if (!after.has(uid)) out.push({ uid, view: null });
    return out;
}

const inputFor = (change, { origin, route, chat }) => change.view
    ? { ...importInput(chat, change.view, { origin, route }), op: 'revise', target: [`u${change.uid}`] }
    : { op: 'retire', target: [`u${change.uid}`], origin: { type: origin, route }, reason: 'Removed from the Story World book.' };

/** Per-reply entries for the staged changes of a swipe that is not showing: they are written to its slot. */
function writeOtherSwipe(message, swipe, entries) {
    const info = message.swipe_info?.[swipe];
    if (!info) return;
    if (!info.extra || typeof info.extra !== 'object') info.extra = {};
    info.extra[MEMORY] = { ...(info.extra[MEMORY] || {}), mark: storedMark(message), entries: [...(info.extra[MEMORY]?.entries || []), ...entries] };
}

/** Stat sheets saved per character card or persona, as this chat's starting sheets (DESIGN 7.7). */
function sheetInputs(chat) {
    const sheets = settings().dice?.sheets || {};
    const out = [];
    const tip = { mark: storedMark(chat[0]) };
    const who = [[characterKey(), names().char], [`persona:${names().user}`, names().user]];
    for (const [key, name] of who) {
        const sheet = sheets[key];
        if (!sheet || typeof sheet !== 'object' || !Object.keys(sheet).length) continue;
        out.push({ op: 'add', record: { id: `sheet:${key}`, kind: 'stat sheet', subject: name, text: clip(Object.entries(sheet).map(([stat, value]) => `${stat} ${value}`).join(', '), 300), stats: structuredClone(sheet), status: 'current', importance: 5 }, origin: { type: 'import', route: 'dice sheets' }, anchor: tip, reason: 'Starting stat sheet moved over from the saved sheets.' });
    }
    return out;
}

/**
 * Import the open chat once. Returns { imported, counts } or { skipped, reason }. Nothing in the book or in today's chat
 * state is changed or removed. A failed settings backup stops the import, and the next open tries again.
 */
export async function importOpenChat({ store = memoryStore(), backup = backupSettingsOnce } = {}) {
    const c = host();
    const chat = c.chat || [];
    const meta = metaOf();
    if (!c.getCurrentChatId?.() || !chat.length) return { skipped: true, reason: 'no chat' };
    if (meta[MEMORY]?.imported) return { skipped: true, reason: 'already imported' };
    try { await backup(); } catch (error) { return { skipped: true, reason: String(error?.message || error) }; }
    store.marks();
    const world = chatWorld();
    const counts = { records: 0, chapters: 0, staged: 0, otherSwipes: 0, sheets: 0, legacy: 0 };
    const log = [];
    let base = new Map();
    if (world) {
        const staged = stagedReplies(chat, world);
        const first = staged.length ? staged[0] : Infinity;
        base = viewsOf(await loadEffectiveWorld(world, { before: first }), world);
        for (const view of base.values()) {
            log.push(importInput(chat, view));
            if (view.kind === 'chapter') counts.chapters += 1;
            else if (isStructuredWorldKind(view.kind)) counts.records += 1;
            else counts.legacy += 1;
        }
        const sheets = sheetInputs(chat);
        counts.sheets = sheets.length;
        log.push(...sheets);
        await store.record(log, { save: false });
        // Staged changes, reply by reply in story order, each against the book as it stood before that reply.
        let before = base;
        for (const index of staged) {
            const after = viewsOf(await loadEffectiveWorld(world, { before: index + 1 }), world);
            const changes = changedViews(before, after);
            if (changes.length) await store.recordOnReply(index, changes.map(change => inputFor(change, { origin: 'import', route: 'staged change', chat })), { save: false });
            counts.staged += changes.length;
            for (const { swipe, changes: patches } of otherSwipePatches(chat[index], world)) {
                const data = await loadEffectiveWorld(world, { before: index });
                const copy = structuredClone(data);
                replayStoryPatch(copy, world, patches);
                const swipeChanges = changedViews(viewsOf(data, world), viewsOf(copy, world));
                const mem = chatMemory(meta);
                const anchor = { mark: storedMark(chat[index]), swipe, hash: hashText(proseOf({ mes: chat[index].swipes?.[swipe] ?? '' })) };
                const entries = swipeChanges.map(change => { mem.seq += 1; return makeEntry({ ...inputFor(change, { origin: 'import', route: 'staged change', chat }), anchor }, { seq: mem.seq, at: Date.now() }); });
                writeOtherSwipe(chat[index], swipe, entries);
                counts.otherSwipes += entries.length;
            }
            before = after;
        }
    } else {
        const sheets = sheetInputs(chat);
        counts.sheets = sheets.length;
        if (sheets.length) await store.record(sheets, { save: false });
    }
    const mem = chatMemory(meta);
    mem.imported = { v: IMPORT_VERSION, at: Date.now(), world: world || '', book: world ? setInfo(world).book : '', counts, backup: settings()[BACKUP_KEY]?.name || '' };
    mem.follow = { world: world || '', hashes: Object.fromEntries([...viewsOf(world ? await loadEffectiveWorld(world) : null, world).entries()].map(([uid, view]) => [uid, viewHash(view)])) };
    forgetFold(meta);
    await c.saveChat?.();
    return { imported: true, counts };
}

let filing = null, again = false;

/**
 * File the changes saved into the Story World book since the last look: edits on a record screen (origin 'you', filed as
 * your edits and locked, as the design's record screens do) and today's chapter writer. Replies no longer write the book.
 */
export function fileBookEdits({ origin = '' } = {}) {
    if (filing) { again = true; return filing; }
    filing = (async () => {
        try {
            do { again = false; await fileOnce({ origin }); } while (again);
        } finally { filing = null; }
    })();
    return filing;
}

async function fileOnce({ origin }) {
    if (!memoryActive()) return;
    const c = host();
    const chat = c.chat || [];
    const meta = metaOf();
    const mem = chatMemory(meta);
    const world = chatWorld();
    const store = memoryStore();
    if (!world) return;
    if (mem.follow?.world !== world) mem.follow = { world, hashes: {} };
    store.marks();
    const now = viewsOf(await loadEffectiveWorld(world), world);
    if (c.chat !== chat) return;
    const result = fold(chat, meta);
    const shown = viewsFromFold(result);
    const last = mem.follow.hashes || {};
    const inputs = [];
    for (const uid of new Set([...now.keys(), ...Object.keys(last).map(Number)])) {
        const legacy = now.get(uid) || null;
        const lh = viewHash(legacy);
        if (lh === viewHash(shown.get(uid))) continue;
        if (lh === (last[uid] || '')) continue;
        const kind = legacy?.kind || shown.get(uid)?.kind || '';
        const by = origin === 'you' || (legacy?.locked && !shown.get(uid)?.locked) ? 'you' : kind === 'chapter' ? 'chapter' : 'import';
        const route = by === 'chapter' ? 'chapter writer' : by === 'you' ? 'record screen' : 'story world';
        if (!legacy) { inputs.push({ op: 'retire', target: [`u${uid}`], origin: { type: by, route }, reason: 'Removed from the Story World book.' }); continue; }
        const input = { ...importInput(chat, legacy, { origin: by, route }), op: result.byId.has(`u${uid}`) ? 'revise' : 'add' };
        if (input.op === 'revise') input.target = [`u${uid}`];
        if (by === 'you') input.reason = 'Edited by you.';
        inputs.push(input);
        if (by === 'you') inputs.push({ op: 'lock', target: [`u${uid}`], origin: { type: 'you' }, reason: 'Your edit is kept as you wrote it.', anchor: input.anchor });
    }
    if (inputs.length) await store.record(inputs, { save: false });
    mem.follow.hashes = Object.fromEntries([...now.entries()].map(([uid, view]) => [uid, viewHash(view)]));
    if (inputs.length) { forgetFold(meta); await c.saveChat?.(); }
    else { try { (c.saveMetadataDebounced || c.saveMetadata)?.(); } catch { /* saved with the next change */ } }
}

/** Chapters whose covered replies changed since they were written (DESIGN 3.4): marked stale, rebuilt by MB6's Writer. */
export function staleChapters(result = fold(host().chat || [], metaOf())) {
    return result.records.filter(record => RANGE_KINDS.includes(record.kind) && record.stale && !OUT_OF_FORCE.includes(record.status));
}

/** The rebuild job of each stale chapter, keyed by the revisions it would read, for MB6's Writer to take. */
export function chapterJobs(chat = host().chat || [], chatId = String(host().getCurrentChatId?.() || '')) {
    const meta = metaOf();
    if (!meta[MEMORY]?.imported) return [];
    const result = fold(chat, meta);
    const index = new Map(chat.map((message, i) => [storedMark(message), i]));
    return staleChapters(result).map(record => {
        const covered = (record.covers || []).map(src => index.has(src.mark) ? revisionOf(chat[index.get(src.mark)]) : { mark: src.mark, swipe: -1, hash: 'gone' });
        return { chatId, kind: 'chapter', subject: record.id, order: index.get(record.versions.at(-1)?.anchor?.mark) ?? 0, sources: Object.fromEntries(covered.map(src => [src.mark, `${src.swipe}:${src.hash}`])), payload: { rebuild: record.id, title: record.view?.name || record.subject || '' } };
    });
}

let started = false;
/**
 * Wire the store to the host once: import on the first open of each chat, file book edits after every reply,
 * swipe, edit and delete, queue the rebuild of stale chapters, and rebuild the device indexes from chat data.
 */
export function startMemory() {
    if (started) return;
    started = true;
    const settle = async () => {
        try {
            await worldIdle();
            await fileBookEdits();
            for (const job of chapterJobs()) await desktopQueue().enqueue(job);
        } catch (error) { console.warn(LOG, 'chat memory', error); }
    };
    const open = async () => {
        try {
            const result = await importOpenChat();
            if (result.imported) console.log(LOG, 'chat memory moved into chat data', result.counts);
        } catch (error) { console.warn(LOG, 'chat memory import', error); }
        await settle();
    };
    on('CHAT_CHANGED', () => setTimeout(open, 0));
    for (const name of ['MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SENT']) on(name, () => setTimeout(settle, 0));
    addRebuilder((chat, chatId) => chapterJobs(chat, chatId));
    if (host().getCurrentChatId?.()) setTimeout(open, 0);
}