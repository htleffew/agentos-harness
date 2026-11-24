// The shared book writer (memory DESIGN 2.2). One writer writes every generated World Info book from chat data: the Story
// World book (story-world-book.js), the Tracker book (B21) and the carry-over book (MB9). It never reads a generated book
// back as a source of records. It reads the book it wrote only to find what you changed there, and then only to hand that
// text to a callback before the rewrite.
//
// A generated book holds:
//   - a disabled first entry that names the reply the book reflects and says where to correct a value;
//   - one entry per item the caller gives, titled by kind and subject, with the subject and its aliases as keys;
//   - on each entry, extensions.ri_generated = { book, id, sig }: the id the caller gave it and a checksum of the text
//     the writer wrote, so a later pass can tell an entry you changed from one it wrote;
//   - on the book, extensions.ri_generated = { v, kind, chat, wrote }.
//
// The writer works over any host that gives { loadBook(name), saveBook(name, data), now() }; hostBooks() in
// story-world-book.js is the one wired to SillyTavern. Writes to one book run one at a time, and a write that is asked for
// while another waits replaces the waiting one, so a capture that schedules a write never waits on it.
import { canonical, hashText } from './fold.js';

export const GENERATED = 'ri_generated';
export const BOOK_KINDS = Object.freeze(['story-world', 'tracker', 'carry-over']);
export const STAMP_ID = 'stamp';

/** SillyTavern's own fields of a World Info entry, with the values a generated entry starts from. */
export const ENTRY_DEFAULTS = Object.freeze({
    key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: false, selectiveLogic: 0, addMemo: true,
    order: 100, position: 1, disable: false, ignoreBudget: false, excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false,
    probability: 100, useProbability: false, depth: 4, outletName: '', group: '', groupOverride: false, groupWeight: 100,
    scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: 0, sticky: null, cooldown: null, delay: null,
    triggers: [], matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false, matchCharacterDepthPrompt: false,
    matchScenario: false, matchCreatorNotes: false, characterFilter: { isExclude: false, names: [], tags: [] }, extensions: {},
});
export const ST_FIELDS = new Set([...Object.keys(ENTRY_DEFAULTS), 'uid', 'displayIndex']);

const clone = value => structuredClone(value);
const list = value => [...new Set([].concat(value ?? []).map(item => String(item ?? '').trim()).filter(Boolean))];

/** The checksum of what a reader sees in an entry: its title, keys and text. Toggles and ordering are not part of it. */
export const entrySig = entry => hashText(canonical({ comment: String(entry?.comment ?? ''), key: list(entry?.key), keysecondary: list(entry?.keysecondary), content: String(entry?.content ?? '') }));

/** The marker a generated entry carries, or null. */
export const markerOf = entry => {
    const marker = entry?.extensions?.[GENERATED];
    return marker && typeof marker === 'object' ? marker : null;
};

/** The marker of a generated book, or null for any other book. */
export const bookMarkerOf = data => {
    const marker = data?.extensions?.[GENERATED];
    return marker && typeof marker === 'object' && BOOK_KINDS.includes(marker.kind) ? marker : null;
};

/** A file name SillyTavern keeps as it is: the characters its sanitizer would change become a hyphen. */
export const safeBookName = name => String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);

/** One entry in SillyTavern's shape from the writer's input. */
export function makeBookEntry(uid, input, book) {
    const entry = { ...clone(ENTRY_DEFAULTS), uid, displayIndex: uid };
    for (const field of Object.keys(input)) if (ST_FIELDS.has(field) && !['uid', 'displayIndex', 'extensions'].includes(field)) entry[field] = clone(input[field]);
    entry.comment = String(input.comment ?? '');
    entry.content = String(input.content ?? '');
    entry.key = list(input.key);
    entry.keysecondary = list(input.keysecondary);
    entry.extensions = { [GENERATED]: { book, id: String(input.id), sig: entrySig(entry), ...(input.record ? { record: String(input.record) } : {}) } };
    return entry;
}

/**
 * What you changed or added in a generated book since the writer last wrote it. An entry with no marker was added by you;
 * one whose text no longer matches the checksum it was written with was changed. The stamp entry is the writer's own.
 */
export function readEdits(data) {
    const edits = [];
    for (const entry of Object.values(data?.entries || {})) {
        const marker = markerOf(entry);
        if (marker?.id === STAMP_ID) continue;
        if (!marker) edits.push({ why: 'added', uid: entry.uid, id: '', record: '', comment: String(entry.comment ?? ''), key: list(entry.key), content: String(entry.content ?? ''), sig: entrySig(entry) });
        else if (marker.sig !== entrySig(entry)) edits.push({ why: 'changed', uid: entry.uid, id: String(marker.id), record: String(marker.record || ''), comment: String(entry.comment ?? ''), key: list(entry.key), content: String(entry.content ?? ''), sig: entrySig(entry) });
    }
    return edits;
}

/** The checksum of a whole book as saved, used to skip a write that would change nothing. */
const bookSum = data => hashText(canonical(data));

/**
 * The book data for one write. spec: { name, kind, chat, stamp, entries }.
 * stamp: { text }, the content of the disabled first entry. entries: [{ id, comment, key, keysecondary, content, ...fields of
 * a World Info entry, record }] in the order they are shown.
 */
export function buildBook(spec, { at = 0 } = {}) {
    if (!BOOK_KINDS.includes(spec.kind)) throw new Error(`Unknown generated book kind: ${spec.kind}`);
    const seen = new Set();
    const entries = {};
    let uid = 0;
    const put = input => { entries[uid] = makeBookEntry(uid, input, spec.kind); uid += 1; };
    put({ id: STAMP_ID, comment: spec.stamp?.title || 'About this book', content: spec.stamp?.text || '', disable: true, key: [] });
    for (const input of spec.entries || []) {
        const id = String(input.id ?? '');
        if (!id || seen.has(id)) throw new Error(`Generated book entry ids must be unique and not empty: ${id || '(empty)'}`);
        if (id === STAMP_ID) throw new Error('The entry id "stamp" belongs to the first entry.');
        seen.add(id);
        put(input);
    }
    return { entries, extensions: { [GENERATED]: { v: 1, kind: spec.kind, chat: { ...(spec.chat || {}) }, wrote: Number(at) } } };
}

export function createBookWriter(host) {
    const chains = new Map();    // book name -> the tail of its write chain
    const waiting = new Map();   // book name -> { produce, waiters } for a write that has not started
    const receipts = [];
    const note = item => { receipts.push({ at: host.now(), ...item }); if (receipts.length > 50) receipts.shift(); };

    /**
     * Write one generated book now. spec.onEdit:
     *   'review'  an entry you changed or added goes to spec.review(edits) first; if that fails the book is left as it is
     *   'replace' your edits are replaced by the rewrite (Tracker book)
     *   'once'    a book that exists is left as it is (carry-over book)
     * Resolves { saved, unchanged, entries, edits } or { refused, reason }.
     */
    async function write(spec) {
        const mode = spec.onEdit || 'replace';
        const previous = await host.loadBook(spec.name);
        // SillyTavern answers a book that does not exist with an empty one, so only a book that holds entries counts as authored.
        if (previous && Object.keys(previous.entries || {}).length && !bookMarkerOf(previous)) {
            const item = { kind: 'refused', name: spec.name, reason: 'A book with this name exists and the extension did not write it.' };
            note(item);
            return { refused: true, reason: item.reason };
        }
        if (previous && mode === 'once' && (Object.keys(previous.entries || {}).length || bookMarkerOf(previous))) return { saved: false, unchanged: true, entries: Object.keys(previous.entries || {}).length, edits: [] };
        let edits = [];
        if (previous && mode === 'review') {
            edits = readEdits(previous);
            if (edits.length) await spec.review?.(edits, previous);
        }
        const next = buildBook(spec, { at: host.now() });
        // A book that would read the same after the write is left alone (the time it was written does not count).
        const same = data => bookSum({ ...data, extensions: { ...data.extensions, [GENERATED]: { ...(data.extensions?.[GENERATED] || {}), wrote: 0 } } });
        if (previous && !edits.length && same(previous) === same(next)) return { saved: false, unchanged: true, entries: Object.keys(next.entries).length, edits };
        await host.saveBook(spec.name, next);
        note({ kind: 'written', name: spec.name, entries: Object.keys(next.entries).length, edits: edits.length });
        return { saved: true, unchanged: false, entries: Object.keys(next.entries).length, edits };
    }

    /**
     * Ask for a write and return at once. produce() is called when the write starts and gives the spec from the chat as it
     * stands then, so a write that waited matches the fold at the time it runs. A second request for the same book while
     * one waits joins it. Resolves with the write's result; a caller that does not wait ignores the promise.
     */
    function schedule(name, produce) {
        const pending = waiting.get(name);
        if (pending) { pending.produce = produce; return new Promise((resolve, reject) => pending.waiters.push({ resolve, reject })); }
        const job = { produce, waiters: [] };
        waiting.set(name, job);
        const result = new Promise((resolve, reject) => job.waiters.push({ resolve, reject }));
        const tail = chains.get(name) || Promise.resolve();
        const run = tail.then(async () => {
            waiting.delete(name);
            try {
                const spec = await job.produce();
                const out = spec ? await write(spec) : { saved: false, skipped: true };
                for (const waiter of job.waiters) waiter.resolve(out);
            } catch (error) {
                note({ kind: 'failed', name, reason: String(error?.message || error) });
                for (const waiter of job.waiters) waiter.reject(error);
            }
        });
        chains.set(name, run);
        result.catch(() => {});
        return result;
    }

    return { write, schedule, receipts: () => receipts.slice(), settled: name => chains.get(name) || Promise.resolve() };
}
