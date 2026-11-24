// The Story World book view (memory DESIGN 2.2). One World Info book per chat, "RI Story World, <chat name>", written by
// code from the fold and never read back as a source. It is written at each chapter close, when the Story World page
// opens it, and before an export, as one whole-book save through the shared writer (book-writer.js). A reply's capture
// never waits on it: callers use schedule(), which returns at once.
//
// What this module holds:
//   storyWorldEntries(fold)         the entries the fold calls for, titled by kind and subject
//   createStoryWorld({ store, ... }) write, schedule, review of your edits, export
//   filterGeneratedEntries(arrays)  leaves a generated book's entries out of a request when it is attached to the chat
//   listGeneratedBooks, deleteGeneratedBook   books whose chat is gone, listed with Delete and never removed on their own
import { createBookWriter, bookMarkerOf, markerOf, safeBookName, makeBookEntry, GENERATED, STAMP_ID } from './book-writer.js';
import { hashText, storedMark, swipeOf } from './fold.js';
import { memoryStore } from './store.js';

export const STORY_WORLD_PREFIX = 'RI Story World, ';
export const TRACKER_PREFIX = 'RI Tracker, ';
export const FLAG_KIND = 'you-edited-the-generated-book';
export const storyWorldName = chatName => safeBookName(`${STORY_WORLD_PREFIX}${chatName}`);
export const isStoryWorldName = name => String(name ?? '').startsWith(STORY_WORLD_PREFIX);
export const isGeneratedName = name => isStoryWorldName(name) || String(name ?? '').startsWith(TRACKER_PREFIX);

// ---------------------------------------------------------------- entries from the fold (pure)

const LABEL = { person: 'Person', place: 'Place', group: 'Group', fact: 'Fact', secret: 'Secret', emotion: 'Emotion', relationship: 'Relationship', arc: 'Arc', thread: 'Thread' };
const RANK = ['person', 'place', 'group', 'fact', 'thread', 'relationship', 'emotion', 'secret', 'arc'];
const SKIPPED = new Set(['scene', 'chapter', 'condensed', 'stat-sheet', 'statsheet']);
const HOLDERS = /\s*Known to: ([^.]*)\.\s*$/;
const OUTCOME = /\s*Outcome: (.*)$/s;
const capital = word => word ? word[0].toUpperCase() + word.slice(1) : '';

/** A record's entry title: kind and subject, with the thread type for a thread ("Plan: Reach the ford"). */
export function titleOf(record) {
    const kind = record.kind === 'thread' && record.threadType ? record.threadType : LABEL[record.kind] || capital(record.kind || 'fact');
    const attribute = String(record.attribute || '').trim();
    const plain = !attribute || attribute === record.kind || /^(fact|arc|seed|agenda|knowledge|profile|emotion|relationship|edit)$/i.test(attribute);
    const subject = String(record.subject || '').trim() || String(record.text || '').split(/\s+/).slice(0, 4).join(' ') || record.id;
    return `${kind}: ${subject}${plain ? '' : `, ${attribute.split(/\s+/).slice(0, 3).join(' ')}`}`;
}

/** The text of a record's entry: the record text, a done thread's outcome, and for a secret the holders in a fixed line. */
export function contentOf(record) {
    let text = String(record.text || '');
    if (record.status === 'done' && record.outcome) text += ` Outcome: ${record.outcome}`;
    if (record.kind === 'secret' && record.holders?.length) text += ` Known to: ${record.holders.join(', ')}.`;
    return text;
}

/** The record text, outcome and holders that a typed entry content holds, read the way contentOf wrote them. */
export function readContent(record, content) {
    let text = String(content ?? '');
    const out = {};
    if (record?.kind === 'secret' || HOLDERS.test(text)) {
        const found = text.match(HOLDERS);
        if (found) { out.holders = found[1].split(/,|\band\b/).map(item => item.trim()).filter(Boolean); text = text.replace(HOLDERS, ''); }
    }
    if (record?.status === 'done' || OUTCOME.test(text)) {
        const found = text.match(OUTCOME);
        if (found && record?.outcome) { out.outcome = found[1].trim(); text = text.replace(OUTCOME, ''); }
    }
    out.text = text.trim();
    return out;
}

/**
 * The entries of the Story World book for a fold result: one per current record, titled by kind and subject, with the
 * subject and its aliases as keys; then the chapters in story order and the condensed account. Each carries the record id.
 */
export function storyWorldEntries(result, { leaveSecretsOut = false } = {}) {
    const records = result.current.filter(record => !SKIPPED.has(record.kind) && !(leaveSecretsOut && record.kind === 'secret'));
    const rank = record => { const at = RANK.indexOf(record.kind); return at < 0 ? RANK.length : at; };
    const ordered = records.map((record, index) => ({ record, index })).sort((a, b) => rank(a.record) - rank(b.record) || a.index - b.index).map(item => item.record);
    const titles = new Map();
    const entries = ordered.map(record => {
        let comment = titleOf(record);
        const n = (titles.get(comment) || 0) + 1;
        titles.set(comment, n);
        if (n > 1) comment = `${comment} (${n})`;
        return { id: record.id, record: record.id, comment, key: [record.subject, ...(record.aliases || [])], content: contentOf(record) };
    });
    const chapters = result.current.filter(record => record.kind === 'chapter').sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    for (const chapter of chapters) entries.push({ id: chapter.id, record: chapter.id, comment: `Chapter ${chapter.order ?? ''}`.trim(), key: [`chapter ${chapter.order ?? ''}`.trim()], content: String(chapter.text || '') });
    const condensed = result.byId.get('condensed');
    if (condensed && !['retired', 'replaced', 'merged'].includes(condensed.status)) entries.push({ id: 'condensed', record: 'condensed', comment: 'Condensed account', key: ['story so far'], content: String(condensed.text || '') });
    return entries;
}

/** The reply a book reflects: the newest reply with a mark, as { mark, number, swipe, swipes } (number counts replies, 1 first). */
export function reflectedReply(chat) {
    const messages = chat || [];
    let at = -1;
    for (let i = messages.length - 1; i >= 0; i--) if (!messages[i]?.is_user && storedMark(messages[i])) { at = i; break; }
    if (at < 0) return null;
    const message = messages[at];
    return { mark: storedMark(message), number: messages.slice(0, at + 1).filter(item => item && !item.is_user).length, swipe: swipeOf(message), swipes: Math.max(1, message.swipes?.length || message.swipe_info?.length || 1) };
}

/** The text of the first, disabled entry. */
export function stampText(reply) {
    const where = reply ? `Reflects reply ${reply.mark}, reply number ${reply.number}, version ${reply.swipe + 1} of ${reply.swipes}.` : 'Reflects reply none. The chat has no replies yet.';
    return `${where} Records are corrected on the Story World page. Recall rewrites this book at each chapter close, when the Story World page opens it and before an export. An entry typed or changed here is listed for review in Setup, Memory, and one tap files it as your own edit.`;
}

// ---------------------------------------------------------------- export

const TITLE_KINDS = new Map([...Object.entries(LABEL).map(([kind, label]) => [label, kind]), ['Plan', 'thread'], ['Plotline', 'thread'], ['Seed', 'thread'], ['Detail', 'thread'], ['Elsewhere', 'thread'], ['Pending', 'thread'], ['Open', 'thread']]);

/**
 * A standalone copy for another chat or for play with the extension off (DESIGN 2.2, Export): a book of SillyTavern's own
 * fields with every entry enabled and no marker of ours. SillyTavern has no holder rule, so a secret fires by keyword there;
 * leaveSecretsOut (on by default) leaves the secrets out. Returns { name, data, file, filename, secretsLeftOut }.
 */
export function standaloneBook(result, { chatName = '', leaveSecretsOut = true } = {}) {
    const all = storyWorldEntries(result);
    const entries = storyWorldEntries(result, { leaveSecretsOut });
    // A chapter or the condensed account can restate what a secret says. With secrets left out, a sentence of those two
    // kinds that shares a run of six words with a secret record is left out as well.
    let sentencesLeftOut = 0;
    if (leaveSecretsOut) {
        const runs = new Set();
        for (const record of result.current.filter(item => item.kind === 'secret')) for (const run of wordRuns(record.text, SECRET_RUN)) runs.add(run);
        if (runs.size) for (const input of entries) {
            if (!['chapter', 'condensed'].includes(result.byId.get(input.id)?.kind)) continue;
            input.content = String(input.content).split(/(?<=[.!?])\s+/).filter(sentence => {
                const hit = wordRuns(sentence, SECRET_RUN).some(run => runs.has(run));
                if (hit) sentencesLeftOut += 1;
                return !hit;
            }).join(' ');
        }
    }
    const data = { entries: {}, extensions: {} };
    entries.forEach((input, uid) => {
        const entry = makeBookEntry(uid, { ...input, disable: false }, 'export');
        entry.extensions = {};
        data.entries[uid] = entry;
    });
    const name = safeBookName(`Story World export, ${chatName}`);
    return { name, data, file: JSON.stringify(data, null, 4), filename: `${name}.json`, secretsLeftOut: all.length - entries.length, sentencesLeftOut };
}

const SECRET_RUN = 6;
const wordsOf = text => String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
/** Every run of n consecutive words in a text, as strings. */
function wordRuns(text, n) {
    const words = wordsOf(text);
    const out = [];
    for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
    return out;
}

// ---------------------------------------------------------------- the request: a generated book never goes out beside recall

let lastGuard = { at: 0, removed: 0, books: {} };

/** Remove the entries of every generated book from the lists SillyTavern's scan built (DESIGN 2.2, Sent once). */
export function filterGeneratedEntries(arrays) {
    const books = {};
    let removed = 0;
    for (const entries of arrays || []) {
        if (!Array.isArray(entries)) continue;
        for (let index = entries.length - 1; index >= 0; index--) {
            const entry = entries[index];
            const marker = markerOf(entry);
            if (!(marker && ['story-world', 'tracker'].includes(marker.book)) && !isGeneratedName(entry?.world)) continue;
            entries.splice(index, 1);
            removed += 1;
            const book = String(entry?.world || 'a generated book');
            books[book] = (books[book] || 0) + 1;
        }
    }
    if (removed) lastGuard = { at: Date.now(), removed, books };
    return { removed, books };
}

/** The line Review, Context shows when a generated book is attached to the chat, or an empty string. */
export function generatedBookNote() {
    const names = Object.keys(lastGuard.books);
    if (!lastGuard.removed || !names.length) return '';
    return `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} attached to this chat. ${lastGuard.removed} ${lastGuard.removed === 1 ? 'entry was' : 'entries were'} left out of the request because recall already weighs every record the book holds.`;
}

let guarded = false;
/** Register the guard on SillyTavern's World Info entries event, once. */
export async function installGeneratedBookGuard(on = null) {
    if (guarded) return true;
    const register = on || (await import('../st.js')).on;
    guarded = !!register('WORLDINFO_ENTRIES_LOADED', lore => { if (lore) filterGeneratedEntries([lore.globalLore, lore.characterLore, lore.chatLore, lore.personaLore]); });
    return guarded;
}

// ---------------------------------------------------------------- books of chats that are gone

/** Every generated Story World or Tracker book, each with whether its chat is gone. Reads books only to find their marker. */
export async function listGeneratedBooks({ names, load, chatExists }) {
    const out = [];
    for (const name of names()) {
        if (!isGeneratedName(name)) continue;
        const data = await load(name).catch(() => null);
        const marker = bookMarkerOf(data);
        if (!marker || !['story-world', 'tracker'].includes(marker.kind)) continue;
        out.push({ name, kind: marker.kind, chat: marker.chat || {}, chatGone: marker.chat?.id ? !(await chatExists(marker.chat)) : false });
    }
    return out;
}

/** Delete one generated book whose chat is gone. Nothing else is deleted, and nothing calls this on its own. */
export async function deleteGeneratedBook(name, { load, remove, chatExists }) {
    const data = await load(name).catch(() => null);
    const marker = bookMarkerOf(data);
    if (!marker) return { deleted: false, reason: 'The extension did not write this book.' };
    if (!marker.chat?.id || await chatExists(marker.chat)) return { deleted: false, reason: 'The chat this book belongs to still exists.' };
    await remove(name);
    return { deleted: true };
}

// ---------------------------------------------------------------- the Story World book of one chat

/**
 * host: { chat(), chatInfo(), books: { load, save }, now() } over the open chat. store: createStore(...) of MB2. A chat info
 * is { id, name, avatar, group }.
 */
export function createStoryWorld({ store, host, writer = createBookWriter({ loadBook: host.books.load, saveBook: host.books.save, now: host.now }) }) {
    const name = () => storyWorldName(host.chatInfo().name);

    function spec() {
        const info = host.chatInfo();
        return {
            name: storyWorldName(info.name), kind: 'story-world', chat: { id: info.id, name: info.name, avatar: info.avatar || '', group: info.group || '' },
            stamp: { text: stampText(reflectedReply(host.chat())) }, entries: storyWorldEntries(store.view()), onEdit: 'review', review: edits => recordEdits(edits, storyWorldName(info.name)),
        };
    }

    /** Edits typed into the book go to the review list as flags before the rewrite. One flag per distinct text. */
    async function recordEdits(edits, book) {
        const known = new Set(store.view().flags.filter(flag => flag.kind === FLAG_KIND).map(flag => flag.record?.sig));
        const fresh = edits.filter(edit => !known.has(edit.sig));
        if (!fresh.length) return;
        await store.record(fresh.map(edit => ({
            op: 'flag', anchor: null, origin: { type: 'upkeep', route: 'code' }, reason: 'You edited the generated book.',
            record: { kind: FLAG_KIND, book, entryId: edit.id, recordId: edit.record, why: edit.why, title: edit.comment, keys: edit.key, content: edit.content, text: edit.content, sig: edit.sig },
        })));
    }

    /** Write the book now. Resolves when it is saved. */
    const write = () => writer.schedule(name(), spec);

    /** Ask for a write and return at once; a reply's capture never waits on a book. Failures are kept in receipts. */
    function schedule() {
        const pending = write();
        pending.catch(() => {});
        return undefined;
    }

    /** Write the book, then say which one to open (the Story World page's Open as World Info book). */
    async function open() {
        const result = await write();
        return { name: name(), ...result };
    }

    /** The flags waiting on the review list that came from edits in this book. */
    const edits = () => store.view().flags.filter(flag => flag.kind === FLAG_KIND);

    /** Dismiss: the flag is reverted and the text you typed stays out of the records. */
    const dismiss = flag => store.revert(flag.entry, 'Dismissed from the review list.');

    /**
     * File as my edit: a locked record in this chat holds the text you typed, and the flag is done. A change to an entry
     * revises the record the entry came from; an entry you added becomes a new record. Resolves { filed, id, clipped }.
     */
    async function fileEdit(flag) {
        const typed = flag.record || {};
        const current = store.view();
        const existing = typed.recordId ? current.byId.get(typed.recordId) : null;
        const read = readContent(existing, typed.content);
        const keys = (typed.keys || []).filter(Boolean);
        let id, input;
        if (existing) {
            id = existing.id;
            const subject = existing.subject || keys[0] || '';
            const aliases = keys.filter(key => key.toLowerCase() !== String(subject).toLowerCase());
            input = { op: 'revise', target: [id], record: { id, kind: existing.kind, ...(existing.threadType ? { threadType: existing.threadType } : {}), subject, text: read.text, aliases, ...(read.holders ? { holders: read.holders } : {}), ...(read.outcome ? { outcome: read.outcome } : {}) } };
        } else {
            const [, label = '', rest = ''] = String(typed.title || '').match(/^([^:]+): (.*)$/) || [];
            const kind = TITLE_KINDS.get(label) || 'fact';
            const subject = (rest || typed.title || keys[0] || 'Your note').replace(/, [^,]*$/, '').replace(/ \(\d+\)$/, '').trim();
            id = `you-${typed.sig || hashText(typed.content)}`;
            const aliases = keys.filter(key => key.toLowerCase() !== subject.toLowerCase());
            input = { op: 'add', record: { id, kind, ...(kind === 'thread' && label !== 'Thread' ? { threadType: label } : {}), subject, text: read.text, aliases, ...(read.holders ? { holders: read.holders } : {}), status: 'current', importance: 8 } };
        }
        const clipped = read.text.length > (['chapter', 'condensed'].includes(input.record.kind) ? 4000 : 300);
        await store.record([
            { ...input, origin: { type: 'you' }, reason: 'Edited in the generated book.' },
            { op: 'lock', target: [id], origin: { type: 'you' }, reason: 'Your edit is kept as you wrote it.' },
        ]);
        await store.revert(flag.entry, 'Filed as your edit.');
        return { filed: true, id, clipped };
    }

    /** A standalone copy of the book (after one write, so it matches the fold). Resolves { name, data, file, filename, secretsLeftOut }. */
    async function exportBook({ leaveSecretsOut = true } = {}) {
        await write().catch(() => {});
        return standaloneBook(store.view(), { chatName: host.chatInfo().name, leaveSecretsOut });
    }

    /** Save the standalone copy as an ordinary World Info book under a free name; it opens in SillyTavern's World Info screen. */
    async function exportToBook({ leaveSecretsOut = true } = {}) {
        const copy = await exportBook({ leaveSecretsOut });
        const taken = new Set(host.books.names?.() || []);
        let name = copy.name;
        for (let n = 2; taken.has(name); n++) name = `${copy.name} (${n})`;
        await host.books.save(name, copy.data);
        return { ...copy, name };
    }

    return { name, spec, write, schedule, open, edits, dismiss, fileEdit, exportBook, exportToBook, receipts: () => writer.receipts(), settled: () => writer.settled(name()) };
}

// ---------------------------------------------------------------- wired to SillyTavern

/** The host of one open chat in SillyTavern. */
export function hostStoryWorld(getContext = () => globalThis.SillyTavern.getContext()) {
    const st = () => import('../st.js');
    return {
        chat: () => getContext().chat || [],
        chatInfo() {
            const c = getContext();
            const id = String(c.getCurrentChatId?.() || '');
            return { id, name: id, avatar: String(c.characters?.[c.characterId]?.avatar || ''), group: String(c.groupId || '') };
        },
        books: {
            load: async bookName => (await st()).loadBook(bookName),
            save: async (bookName, data) => (await st()).saveBook(bookName, data),
            names: () => getContext().getWorldInfoNames?.() || [],
            remove: async bookName => (await st()).deleteBook(bookName),
        },
        now: () => Date.now(),
    };
}

/** Whether a chat of a generated book still exists. A chat it cannot look up counts as existing, so nothing is listed as gone by mistake. */
export async function hostChatExists(chat, getContext = () => globalThis.SillyTavern.getContext()) {
    try {
        if (!chat?.id || (!chat.avatar && !chat.group)) return true;
        const c = getContext();
        const response = await fetch('/api/chats/search', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify(chat.group ? { group_id: chat.group, query: '' } : { avatar_url: chat.avatar, query: '' }) });
        if (!response.ok) return true;
        const rows = await response.json();
        return !Array.isArray(rows) || rows.some(row => String(row.file_name || '').replace(/\.jsonl$/, '') === chat.id);
    } catch { return true; }
}

let shared = null;
/** The Story World book of the open chat. */
export const storyWorld = () => shared ||= createStoryWorld({ store: memoryStore(), host: hostStoryWorld() });

/** The generated books of this device with whether each chat is gone, and the one tap to delete a book whose chat is gone. */
export function hostGeneratedBooks() {
    const host = hostStoryWorld();
    const parts = { names: host.books.names, load: host.books.load, remove: host.books.remove, chatExists: hostChatExists };
    return { list: () => listGeneratedBooks(parts), remove: name => deleteGeneratedBook(name, parts) };
}

export { GENERATED, STAMP_ID };
