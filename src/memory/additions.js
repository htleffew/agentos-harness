// Additions to your World Info books (memory DESIGN 7.4, decision 4). Background jobs only append to and enrich your
// entries: alias keywords, one appended line, new entries. Your own text, keys and settings stay as you wrote them.
//
//   "Story may add to this book" per book: Off, Keywords only, or Keywords, lines and entries. Books shared by many chats
//   (global, character and persona books) start at Keywords only; books bound to one chat start at all three.
//   A log in chat metadata (chat_metadata.ri_memory.additions) records each addition: the book, the entry, the exact key or
//   text added and the reply it came from. When that reply leaves the chat (a delete, a swipe away, a branch cut before it),
//   code removes exactly that addition. An addition you edited since counts as your text and stays, with a note in History.
//   Additions to a Constant entry wait for a chapter close, when the history is reprocessed anyway (6.5).
//
// The first half is pure (plan, apply, reconcile, export); the second half reads and saves books through the host.
import { chatMemory, storedMark, swipeOf } from './fold.js';
import { ENTRY_DEFAULTS, ST_FIELDS } from './book-writer.js';
import { moodWord, restates } from './validate.js';
import { bare, canonicalSubject } from './similarity.js';

export const LEVELS = Object.freeze(['off', 'keywords', 'full']);
export const LEVEL_LABELS = Object.freeze({ off: 'Off', keywords: 'Keywords only', full: 'Keywords, lines and entries' });
export const LINES_PER_ENTRY = 2;            // lines one run may append to one entry
export const LINE_IMPORTANCE = 6;            // a record must be at least this important to become a line in your book
const ENTRY_KINDS = new Set(['person', 'place']);
const LINE_KINDS = new Set(['fact', 'trait', 'item', 'person', 'place']);
const SHARED_ROLE = /^Host (character|persona|global)/;
const BOUND_ROLE = /^Host chat attachment|^Pinned Base World|^Story World|Reusable|Knowledge & Reference|Behavior & Guidelines/;

/**
 * The level a book starts at. roles: the roles chat-books.js lists for it. A book shared by many chats starts at
 * Keywords only; a book bound to this chat or made by the extension starts at Keywords, lines and entries.
 */
export function defaultLevel(roles = []) {
    const list = [].concat(roles || []).map(String);
    if (list.some(role => SHARED_ROLE.test(role))) return 'keywords';
    if (list.some(role => BOUND_ROLE.test(role))) return 'full';
    return 'keywords';
}

/** The level of one book: your saved choice, else its default. */
export const levelOf = (name, { saved = {}, roles = [] } = {}) => (LEVELS.includes(saved?.[name]) ? saved[name] : defaultLevel(roles));

// ---------------------------------------------------------------- the log

/** The additions log of a chat, created when absent. */
export function additionsLog(meta) {
    const mem = chatMemory(meta);
    if (!Array.isArray(mem.additions)) mem.additions = [];
    return mem.additions;
}

const nextId = log => `a${(log.reduce((n, row) => Math.max(n, Number(String(row.id).slice(1)) || 0), 0) + 1)}`;

// ---------------------------------------------------------------- planning (pure)

const names = entry => [String(entry.comment || ''), ...[].concat(entry.key || [])].map(String).filter(name => name && !name.startsWith('/'));
const lower = list => new Set(list.map(item => bare(item)));
/** True when an entry is about a record's subject: a key or the title matches the subject or one of its aliases. */
export function entryAbout(entry, record) {
    const mine = lower(names(entry));
    const theirs = [record.subject, ...(record.aliases || [])].filter(Boolean);
    if (theirs.some(name => mine.has(bare(name)))) return true;
    const head = canonicalSubject(record.subject);
    return !!head && head.length >= 3 && [...mine].some(name => canonicalSubject(name) === head);
}

/** The source of a record: the newest version that counts, as { mark, swipe, entry, record }. */
export function sourceOf(record) {
    const version = [...(record.versions || [])].reverse().find(v => v.anchor?.mark);
    return version ? { mark: version.anchor.mark, ...(Number.isInteger(version.anchor.swipe) ? { swipe: version.anchor.swipe } : {}), entry: version.entry, record: record.id } : null;
}

/** The chapter a source falls in: the order of the chapter record that covers its mark, else the next chapter's number. */
export function chapterOf(source, chapters = []) {
    const hit = chapters.find(ch => (ch.covers || []).some(c => c?.mark === source?.mark));
    if (hit) return Number(hit.order) || chapters.indexOf(hit) + 1;
    return chapters.length + 1;
}

/**
 * The additions one run would make to one book. Pure: nothing is changed.
 *   book: { name, data }; level: 'off' | 'keywords' | 'full'; records: the fold's current records; chapters: chapter records
 *   atClose: true at a chapter close, when additions to Constant entries may land; log: the additions log (to skip repeats)
 * Returns [{ kind: 'key'|'line'|'entry', uid, value, keys?, source, chapter? }]; a new entry has uid null.
 */
export function planAdditions({ book, level, records = [], chapters = [], atClose = false, log = [] }) {
    if (!book?.data?.entries || !LEVELS.includes(level) || level === 'off') return [];
    const entries = Object.values(book.data.entries).filter(entry => entry && typeof entry === 'object');
    const live = records.filter(r => !['retired', 'replaced', 'merged', 'suspect'].includes(r.status) && !['chapter', 'condensed', 'arc', 'scene', 'secret'].includes(r.kind) && !r.overrides);
    const done = new Set(log.filter(row => row.book === book.name && row.state !== 'undone').map(row => `${row.kind}|${row.uid ?? ''}|${bare(row.value)}`));
    const recordDone = new Set(log.filter(row => row.book === book.name && row.source?.record && row.state !== 'undone').map(row => `${row.kind}|${row.source.record}`));
    const plan = [];
    // Keywords: the names the story uses for the entry's subject, from the alias table.
    for (const entry of entries) {
        if (entry.disable) continue;
        if (entry.constant && !atClose) continue;
        const have = lower(names(entry));
        for (const record of live.filter(r => (r.aliases || []).length && entryAbout(entry, r))) {
            for (const alias of record.aliases) {
                const a = String(alias || '').trim();
                if (a.length < 3 || have.has(bare(a)) || done.has(`key|${entry.uid}|${bare(a)}`)) continue;
                const source = sourceOf(record);
                if (!source) continue;
                have.add(bare(a));
                plan.push({ kind: 'key', uid: entry.uid, value: a, source });
            }
        }
    }
    if (level !== 'full') return plan;
    // A line: one sentence appended after your text, holding a durable record about the entry's subject.
    for (const entry of entries) {
        if (entry.disable) continue;
        if (entry.constant && !atClose) continue;
        const text = String(entry.content || '');
        let added = 0;
        const candidates = live.filter(r => LINE_KINDS.has(r.kind) && (r.importance || 5) >= LINE_IMPORTANCE && entryAbout(entry, r) && !recordDone.has(`line|${r.id}`))
            .sort((a, b) => (b.importance || 5) - (a.importance || 5));
        for (const record of candidates) {
            if (added >= LINES_PER_ENTRY) break;
            const sentence = String(record.text || '').trim().replace(/\s+/g, ' ');
            if (!sentence || moodWord(sentence) || restates(sentence, [text])) continue;
            const source = sourceOf(record);
            if (!source) continue;
            const chapter = chapterOf(source, chapters);
            const value = ` Since chapter ${chapter}: ${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}`;
            if (done.has(`line|${entry.uid}|${bare(value)}`)) continue;
            plan.push({ kind: 'line', uid: entry.uid, value, source, chapter });
            recordDone.add(`line|${record.id}`);
            added += 1;
        }
    }
    // A new entry for a subject the story made and the book does not hold.
    for (const record of live.filter(r => ENTRY_KINDS.has(r.kind) && !recordDone.has(`entry|${r.id}`))) {
        if (entries.some(entry => entryAbout(entry, record))) continue;
        if (plan.some(p => p.kind === 'entry' && bare(p.keys[0]) === bare(record.subject))) continue;
        const text = String(record.text || '').trim();
        const source = sourceOf(record);
        if (!text || !source || moodWord(text)) continue;
        plan.push({ kind: 'entry', uid: null, value: text, keys: [record.subject, ...(record.aliases || [])].filter(Boolean), title: record.subject, source });
    }
    return plan;
}

// ---------------------------------------------------------------- applying and taking back (pure over a book copy)

/** SillyTavern's own fields for a new entry, the same defaults its editor gives. */
function newEntry(uid, { title, keys, value }) {
    return { ...structuredClone(ENTRY_DEFAULTS), key: [...new Set(keys.map(String))], comment: String(title || keys[0] || ''), content: value, uid, displayIndex: uid };
}

/**
 * Apply a plan to a copy of a book. Returns { data, rows }, where rows are the log rows to append (one per addition made).
 * Keys are pushed after yours, lines are appended after your text, and new entries take the next free uid.
 */
export function applyAdditions(bookName, data, plan, { log = [], at = 0 } = {}) {
    const out = structuredClone(data);
    const rows = [];
    const ids = [...log];
    for (const item of plan) {
        const id = nextId(ids);
        if (item.kind === 'key') {
            const entry = out.entries[item.uid];
            if (!entry) continue;
            entry.key = [...[].concat(entry.key || []), item.value];
        } else if (item.kind === 'line') {
            const entry = out.entries[item.uid];
            if (!entry) continue;
            entry.content = `${String(entry.content ?? '')}${item.value}`;
        } else if (item.kind === 'entry') {
            const uid = Math.max(-1, ...Object.keys(out.entries).map(Number).filter(Number.isFinite)) + 1;
            out.entries[uid] = newEntry(uid, item);
            item.uid = uid;
        } else continue;
        const row = { id, book: bookName, uid: item.uid, kind: item.kind, value: item.value, ...(item.keys ? { keys: [...item.keys] } : {}), source: { ...item.source }, at, state: 'live', ...(item.chapter ? { chapter: item.chapter } : {}) };
        rows.push(row);
        ids.push(row);
    }
    return { data: out, rows };
}

/** True while an addition's source reply is in the chat and shows the swipe it came from. */
export function sourcePresent(source, chat) {
    if (!source?.mark) return false;
    const message = (chat || []).find(m => storedMark(m) === source.mark);
    if (!message) return false;
    return !Number.isInteger(source.swipe) || source.swipe === swipeOf(message);
}

/**
 * Take back additions whose source left the chat (or that were undone). Pure over a copy of the book.
 *   gone(row) tells whether a row's source is gone; rows: the log rows of this book that are live.
 * Returns { data, removed, kept } where kept rows were edited by you and stay as your text.
 * A key is removed when it is still in the entry; a line when it still sits whole at the end of the entry or just before
 * another live line; a new entry when its text and keys are still what was added.
 */
export function takeBack(data, rows, gone) {
    const out = structuredClone(data);
    const removed = [], kept = [];
    // Newest first, so a later line comes off before the earlier one it follows.
    const live = rows.filter(row => row.state === 'live');
    for (const row of [...live].reverse()) {
        if (!gone(row)) continue;
        const entry = out.entries[row.uid];
        if (!entry) { removed.push({ ...row, note: 'its entry is no longer in the book' }); continue; }
        if (row.kind === 'key') {
            const keys = [].concat(entry.key || []);
            const at = keys.lastIndexOf(row.value);
            if (at >= 0) { keys.splice(at, 1); entry.key = keys; removed.push(row); } else kept.push({ ...row, note: 'you removed or changed this keyword, so it is yours' });
        } else if (row.kind === 'line') {
            const text = String(entry.content ?? '');
            const at = text.lastIndexOf(row.value);
            const rest = at < 0 ? null : text.slice(at + row.value.length);
            const others = live.filter(x => x !== row && x.kind === 'line' && x.book === row.book && String(x.uid) === String(row.uid) && !removed.includes(x));
            const untouched = at >= 0 && (rest === '' || others.some(x => rest.startsWith(x.value)));
            if (untouched) { entry.content = text.slice(0, at) + rest; removed.push(row); } else kept.push({ ...row, note: 'you edited this line, so it stays as your text' });
        } else if (row.kind === 'entry') {
            const keys = [].concat(entry.key || []);
            const same = String(entry.content ?? '') === row.value && keys.length === (row.keys || []).length && keys.every((k, i) => k === row.keys[i]);
            if (same) { delete out.entries[row.uid]; removed.push(row); } else kept.push({ ...row, note: 'you edited this entry, so it stays as your text' });
        }
    }
    return { data: out, removed, kept };
}

/** Mark rows in the log after a take-back: removed rows leave, kept rows become yours. Returns the rows changed. */
export function settleLog(log, { removed = [], kept = [], undone = [] }, at = 0) {
    const changed = [];
    for (const row of log) {
        if (removed.some(r => r.id === row.id)) { row.state = undone.includes(row.id) ? 'undone' : 'removed'; row.ended = at; changed.push(row); }
        else if (kept.some(r => r.id === row.id)) { row.state = 'yours'; row.note = kept.find(r => r.id === row.id).note; row.ended = at; changed.push(row); }
    }
    return changed;
}

/**
 * A book as SillyTavern exports it: SillyTavern's own entry fields only. Additions are plain keys and plain text, so the
 * book needs nothing of ours to work with the extension on or off.
 */
export function exportBook(data) {
    const entries = {};
    for (const [uid, entry] of Object.entries(data?.entries || {})) entries[uid] = Object.fromEntries(Object.entries(entry).filter(([field]) => ST_FIELDS.has(field)));
    return { ...data, entries };
}

/** Entry fields in a book that are not SillyTavern's own, as [{ uid, field }]. */
export const foreignFields = data => Object.entries(data?.entries || {}).flatMap(([uid, entry]) => Object.keys(entry).filter(field => !ST_FIELDS.has(field)).map(field => ({ uid, field })));

/** A book with every live addition of `rows` taken back: what you wrote, byte for byte when nothing of yours changed. */
export const withoutAdditions = (data, rows) => takeBack(data, rows, () => true).data;

// ---------------------------------------------------------------- the host side

/**
 * One additions pass over the books a chat uses. books: [{ name, roles }]; io: { loadBook, saveBook, now }.
 * meta, records and chapters are the chat's; saved is the per-book level setting. Saves each book it changed.
 * Returns { made: rows, books: [{ name, level, made }] }.
 */
export async function runAdditions({ books = [], io, meta, records = [], chapters = [], saved = {}, atClose = false, skip = () => false }) {
    const log = additionsLog(meta);
    const made = [], report = [];
    for (const book of books) {
        if (skip(book.name)) continue;
        const level = levelOf(book.name, { saved, roles: book.roles });
        if (level === 'off') { report.push({ name: book.name, level, made: 0 }); continue; }
        const data = await io.loadBook(book.name);
        if (!data?.entries) continue;
        const plan = planAdditions({ book: { name: book.name, data }, level, records, chapters, atClose, log });
        if (!plan.length) { report.push({ name: book.name, level, made: 0 }); continue; }
        const applied = applyAdditions(book.name, data, plan, { log, at: io.now() });
        await io.saveBook(book.name, applied.data);
        log.push(...applied.rows);
        made.push(...applied.rows);
        report.push({ name: book.name, level, made: applied.rows.length });
    }
    return { made, books: report };
}

/**
 * Take back the additions whose reply left the chat, and any undone ones, in every book the log names. Saves each book
 * it changed and settles the log. Returns { removed, kept }.
 */
export async function reconcileAdditions({ io, meta, chat, undo = [] }) {
    const log = additionsLog(meta);
    const live = log.filter(row => row.state === 'live');
    const gone = row => undo.includes(row.id) || !sourcePresent(row.source, chat);
    const byBook = new Map();
    for (const row of live) if (gone(row)) (byBook.get(row.book) || byBook.set(row.book, []).get(row.book)).push(row);
    const removed = [], kept = [];
    for (const [name] of byBook) {
        const data = await io.loadBook(name);
        if (!data?.entries) { removed.push(...byBook.get(name).map(row => ({ ...row, note: 'the book is gone' }))); continue; }
        const result = takeBack(data, live.filter(row => row.book === name), gone);
        if (result.removed.length) await io.saveBook(name, result.data);
        removed.push(...result.removed);
        kept.push(...result.kept);
    }
    settleLog(log, { removed, kept, undone: undo }, io.now());
    return { removed, kept };
}

/** Undo one addition from History: it is removed the same way a delete removes it. */
export const undoAddition = (id, options) => reconcileAdditions({ ...options, undo: [id] });
