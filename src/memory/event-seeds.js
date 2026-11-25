// Story events from your story (memory DESIGN 7.6). Each chapter call returns up to three event seeds grounded in the
// closed chapter (story-so-far.js keeps them on the chapter record as `seeds`). Code turns each seed into a Random story
// event entry (chance 10 percent, inclusion group "Story events", cooldown 10 messages, keys from the places or people it
// names, depth 1, the system role), checks every name against the records and the cast, and drops a seed that resembles
// an entry already in the book (Dice 0.85 on its text with the same keys). Seeds go to the one behavior book chosen for
// the chat under "Receive story events":
//   - a book the extension created takes them directly, each with Undo in History;
//   - a book of yours takes them as new entries when its "Story may add to this book" is Keywords, lines and entries;
//   - otherwise they wait in the review list with Add to book and Dismiss.
//
// A seed is anchored to its chapter. The entries it made are rows of the additions log (additions.js) whose source is the
// chapter's last message and the chapter record, so a delete or branch that removes the chapter removes them, unless you
// edited them, and Undo in History removes one the same way. A seed waiting for review is a `flag` entry in the chat log
// anchored to the chapter, so it leaves the list with its chapter.
import { fold as foldChat } from './fold.js';
import { additionsLog, levelOf, settleLog, sourcePresent, takeBack } from './additions.js';
import { bare } from './similarity.js';
import { dice, diceNearDuplicate } from './validate.js';
import { entryFields } from './behavior-books.js';

export const SEED_FLAG = 'event-seed';
export const MAX_SEEDS = 3;
export const MAX_KEYS = 4;
export const ROUTES = Object.freeze({ direct: 'direct', entry: 'entry', review: 'review' });

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
// Capitalized words that open or join sentences without naming anyone.
const COMMON = new Set(('a an the this that these those there here he she they it his her their its we our you your i ' +
    'when while if after before as at in on of from to with by for and but or so then now soon later meanwhile someone something ' +
    'somebody nobody everyone news word rumor rumors rumour rumours one two three four five six seven eight nine ten ' +
    'day night morning evening dawn dusk noon midnight monday tuesday wednesday thursday friday saturday sunday').split(' '));

// ---------------------------------------------------------------- names (pure)

/**
 * The names the records hold, as [{ name, subject, kind, cast }]: people and places with their aliases, thread titles,
 * the people and places of chapter records, and the cast (the character and your persona).
 */
export function knownNames(records = [], cast = []) {
    const out = [];
    const add = (name, subject, kind, isCast = false) => { const n = clean(name); if (n.length >= 2) out.push({ name: n, subject: clean(subject) || n, kind, cast: isCast }); };
    for (const r of records) {
        if (['person', 'place'].includes(r.kind)) for (const n of [r.subject, ...(r.aliases || [])]) add(n, r.subject, r.kind);
        else if (r.kind === 'thread') { add(r.subject, r.subject, 'thread'); if (r.title) add(r.title, r.subject, 'thread'); }
        else if (r.kind === 'chapter') { for (const p of r.people || []) add(p, p, 'person'); for (const p of r.places || []) add(p, p, 'place'); }
        else if (r.subject && /^[A-Z]/.test(r.subject)) for (const n of [r.subject, ...(r.aliases || [])]) add(n, r.subject, r.kind);
    }
    for (const n of cast) add(n, n, 'person', true);
    return out;
}

/** The capitalized words of a seed that read as names. A word that opens a sentence counts only when it is known. */
export function properWords(text, known = new Set()) {
    const words = [];
    const re = /[\p{L}][\p{L}'-]*/gu;
    const t = String(text || '');
    let m;
    while ((m = re.exec(t))) {
        const w = m[0].replace(/'s$/i, '');
        if (!/^\p{Lu}/u.test(w)) continue;
        const before = t.slice(0, m.index).trimEnd();
        const opens = !before || /[.!?:;"“(]$/.test(before);
        const lower = w.toLowerCase();
        if (COMMON.has(lower)) continue;
        if (opens && !known.has(lower)) continue;
        words.push(w);
    }
    return words;
}

/**
 * Ground one seed: every name it uses must be a word of a known name. Returns { ok, unknown, names, keys }: names are the
 * known names it mentions; keys are the people and places it needs (the cast left out, since they are in every scene).
 */
export function groundSeed(seed, known) {
    const text = clean(seed);
    const lowerText = ` ${bare(text)} `;
    const vocabulary = new Set(known.flatMap(k => bare(k.name).split(' ')).filter(Boolean));
    const unknown = properWords(text, vocabulary).filter(w => !vocabulary.has(bare(w)));
    const mentioned = known.filter(k => lowerText.includes(` ${bare(k.name)} `));
    // a longer name wins over a word of it ("Ser Marten Drey" over "Marten")
    // in the order the seed names them
    const names = mentioned.filter(k => !mentioned.some(o => o !== k && o.name.length > k.name.length && ` ${bare(o.name)} `.includes(` ${bare(k.name)} `)))
        .sort((a, b) => lowerText.indexOf(` ${bare(a.name)} `) - lowerText.indexOf(` ${bare(b.name)} `));
    // the cast by full name or first name ("Hale" for "Hale of Verath"), wherever the records list them
    const cast = new Set(known.filter(k => k.cast).flatMap(k => [bare(k.name), bare(k.name).split(' ')[0]]));
    const keys = [...new Map(names.filter(k => !cast.has(bare(k.name)) && ['person', 'place'].includes(k.kind)).map(k => [bare(k.name), k.name])).values()].slice(0, MAX_KEYS);
    return { ok: !!text && !unknown.length, unknown: [...new Set(unknown)], names: [...new Set(names.map(k => k.name))], keys };
}

// ---------------------------------------------------------------- seeds into entries (pure)

const sameKeys = (a, b) => {
    const A = new Set([].concat(a || []).map(bare)), B = new Set([].concat(b || []).map(bare));
    return A.size === B.size && [...A].every(k => B.has(k));
};
/** True when an entry already in the book resembles the seed: Dice 0.85 or more on its text, with the same keys. */
export const resembles = (item, entries) => entries.some(e => sameKeys(e.key, item.keys) && dice(e.content, item.content) >= diceNearDuplicate);

const titleOf = text => `Story event: ${clean(text).replace(/[.!?]+$/, '').split(' ').slice(0, 6).join(' ')}`;

/**
 * The Random story event items a chapter's seeds make, checked against the names and the book. Returns
 * { items: [{ kind: 'event', title, content, keys, seed }], dropped: [{ seed, why }] }.
 */
export function seedItems(chapter, { known, entries = [] }) {
    const items = [], dropped = [];
    for (const seed of (chapter?.seeds || []).slice(0, MAX_SEEDS)) {
        const g = groundSeed(seed, known);
        if (!g.ok) { dropped.push({ seed, why: g.unknown.length ? `names no one in the records: ${g.unknown.join(', ')}` : 'empty' }); continue; }
        const content = /[.!?]$/.test(clean(seed)) ? clean(seed) : `${clean(seed)}.`;
        const item = { kind: 'event', title: titleOf(seed), content, keys: g.keys, seed: clean(seed), names: g.names };
        if (resembles(item, [...entries, ...items.map(i => ({ key: i.keys, content: i.content }))])) { dropped.push({ seed, why: 'resembles an entry already in the book' }); continue; }
        items.push(item);
    }
    return { items, dropped };
}

/** Where a book takes seeds: a book the extension made takes them directly; yours only at Keywords, lines and entries. */
export function routeFor({ book = '', made = false, level = 'keywords' } = {}) {
    if (!book) return ROUTES.review;
    if (made) return ROUTES.direct;
    return level === 'full' ? ROUTES.entry : ROUTES.review;
}

const nextAdditionId = log => `a${(log.reduce((n, row) => Math.max(n, Number(String(row.id).slice(1)) || 0), 0) + 1)}`;

/** The key a chapter is seeded under: its id and the entry that first filed it, so a rebuild is not seeded twice. */
export const seedKey = chapter => `${chapter.id}@${chapter.versions?.[0]?.entry || ''}`;

/** The source of the rows a chapter's seeds make: its last message and the chapter record. */
export const chapterSource = chapter => ({ mark: chapter.to || chapter.versions?.at(-1)?.anchor?.mark || '', record: chapter.id });

/**
 * Add seed items to a copy of a book as Random story event entries. Returns { data, rows, uids }; rows go to the
 * additions log (kind "entry", source the chapter), so History lists each with Undo.
 */
export function applySeeds(bookName, data, items, { chapter, log = [], at = 0, order = 0 } = {}) {
    const out = structuredClone(data || { entries: {} });
    out.entries ||= {};
    const rows = [], uids = [];
    const ids = [...log];
    for (const item of items) {
        const uid = Math.max(-1, ...Object.keys(out.entries).map(Number).filter(Number.isFinite)) + 1;
        const entry = { ...entryFields('event', item), uid, displayIndex: uid };
        out.entries[uid] = entry;
        const row = { id: nextAdditionId(ids), book: bookName, uid, kind: 'entry', value: entry.content, keys: [...entry.key], source: chapterSource(chapter), at, state: 'live', ...(order ? { chapter: order } : {}), event: { chapter: chapter.id, seed: item.seed } };
        rows.push(row);
        ids.push(row);
        uids.push(uid);
    }
    return { data: out, rows, uids };
}

/** The flag entry a seed waiting for review becomes: anchored to its chapter and dropping out with it. */
export function seedFlag(item, chapter, { book = '' } = {}) {
    const entryId = chapter.versions?.[0]?.entry;
    return {
        op: 'flag', origin: { type: 'chapter' }, anchor: { mark: chapterSource(chapter).mark }, ...(entryId ? { depends: [{ entry: entryId }] } : {}),
        record: { kind: SEED_FLAG, subject: item.title, text: item.content, keys: item.keys, seed: item.seed, chapter: chapter.id, book },
        reason: `Story event from chapter "${clean(chapter.title || chapter.subject)}"`.slice(0, 160),
    };
}

/** The current chapter records of a fold, in story order, with their order number. */
export function chaptersIn(result) {
    return (result?.current || []).filter(r => r.kind === 'chapter').map((r, i) => ({ r, order: i + 1 }));
}

/**
 * The seed rows of the additions log whose chapter is gone: its last message left the chat, or the chapter record is no
 * longer in force (a branch, a delete or a revert).
 */
export function goneSeedRows(log, { chat, result }) {
    const live = new Set(chaptersIn(result).map(({ r }) => r.id));
    return log.filter(row => row.state === 'live' && row.event?.chapter && (!sourcePresent(row.source, chat) || !live.has(row.event.chapter)));
}

// ================================================================ the host side

let H = null;
async function host() {
    if (H) return H;
    const st = await import('../st.js');
    const books = await import('./behavior-books.js');
    const memStore = await import('./store.js');
    const upkeep = await import('./upkeep.js');
    H = { st, books, memStore, upkeep };
    return H;
}

const bookIo = st => ({ load: name => st.loadBook(name), save: (name, data) => st.saveBook(name, data), names: () => st.worldNames(), now: () => Date.now() });
const castOf = c => [c.name1, c.name2].filter(Boolean);

/** The roles chat-books.js lists for a book, for its default "Story may add" level. */
async function rolesOf(name) {
    try { const { chatBooks } = await import('../chat-books.js'); return chatBooks().find(b => b.name === name)?.roles || []; } catch { return []; }
}

/**
 * Seed the chapters closed since the last pass. Each new chapter's seeds go to the book that receives story events, or to
 * the review list. Returns { added: rows, review: flags, dropped, chapters }.
 */
export async function seedChapters({ context, store, io } = {}) {
    const { st, books: B, memStore, upkeep } = await host();
    const c = context || st.ctx();
    const meta = c.chatMetadata || {};
    if (!meta.ri_memory?.imported) return { added: [], review: [], dropped: [], chapters: 0 };
    const b = B.chatBehavior(meta);
    const result = foldChat(c.chat || [], meta, { cache: false });
    const fresh = chaptersIn(result).filter(({ r }) => (r.seeds || []).length && !b.seeded.includes(seedKey(r)));
    if (!fresh.length) return { added: [], review: [], dropped: [], chapters: 0 };
    const bio = io || bookIo(st);
    const target = b.receive && bio.names().includes(b.receive) ? b.receive : '';
    const made = target ? await B.isMadeBook(target) : false;
    const level = target ? levelOf(target, { saved: await upkeep.savedLevels(), roles: await rolesOf(target) }) : 'off';
    const route = routeFor({ book: target, made, level });
    let data = target ? await bio.load(target) : null;
    const known = knownNames(result.current, castOf(c));
    const log = additionsLog(meta);
    const added = [], review = [], dropped = [];
    const s = store || memStore.memoryStore();
    for (const { r, order } of fresh) {
        const entries = Object.values(data?.entries || {});
        const planned = seedItems(r, { known, entries });
        dropped.push(...planned.dropped.map(d => ({ ...d, chapter: r.id })));
        if (planned.items.length && route !== ROUTES.review && data) {
            const applied = applySeeds(target, data, planned.items, { chapter: r, log, at: bio.now(), order });
            data = applied.data;
            log.push(...applied.rows);
            added.push(...applied.rows);
            const { oneShot } = await B.behaviorSettings();
            for (const uid of applied.uids) oneShot[`${target}#${uid}`] = true;
        } else if (planned.items.length) {
            const flags = planned.items.map(item => seedFlag(item, r, { book: target }));
            await s.record(flags);
            review.push(...flags);
        }
        b.seeded.push(seedKey(r));
    }
    if (added.length) {
        await bio.save(target, data);
        (await import('../store.js')).saveSettings?.();
    }
    await (c.saveChat?.() ?? c.saveMetadata?.());
    return { added, review, dropped, chapters: fresh.length, route, book: target };
}

/**
 * Take back the event entries whose chapter is gone, in every book the log names. An entry you edited stays as your text.
 * Returns { removed, kept }.
 */
export async function reconcileSeeds({ context, io } = {}) {
    const { st } = await host();
    const c = context || st.ctx();
    const meta = c.chatMetadata || {};
    const log = meta.ri_memory?.additions || [];
    const result = foldChat(c.chat || [], meta, { cache: false });
    const gone = new Set(goneSeedRows(log, { chat: c.chat || [], result }).map(row => row.id));
    if (!gone.size) return { removed: [], kept: [] };
    const bio = io || bookIo(st);
    const removed = [], kept = [];
    for (const name of new Set(log.filter(row => gone.has(row.id)).map(row => row.book))) {
        const data = await bio.load(name).catch(() => null);
        if (!data?.entries) { removed.push(...log.filter(row => gone.has(row.id) && row.book === name).map(row => ({ ...row, note: 'the book is gone' }))); continue; }
        const out = takeBack(data, log.filter(row => row.book === name && row.state === 'live'), row => gone.has(row.id));
        if (out.removed.length) await bio.save(name, out.data);
        removed.push(...out.removed);
        kept.push(...out.kept);
    }
    settleLog(log, { removed, kept }, bio.now());
    await (c.saveChat?.() ?? c.saveMetadata?.());
    return { removed, kept };
}

/**
 * The two actions on a seed in the review list. "add-to-book" adds it to `book` (or the book that receives story events) as
 * a Random story event, logged with Undo; "dismiss" takes it off the list. flag: a row of flags.reviewList.
 */
export async function resolveSeed(flag, action, { book = '', context, store, io } = {}) {
    const { st, books: B, memStore } = await host();
    const c = context || st.ctx();
    const meta = c.chatMetadata || {};
    const s = store || memStore.memoryStore();
    if (action === 'dismiss') { await s.revert(flag.entry, 'Dismissed from the review list.'); return { dismissed: flag.entry }; }
    if (action !== 'add-to-book') throw new Error(`The action ${action} does not apply to a story event.`);
    const target = book || flag.seed?.book || B.chatBehavior(meta).receive;
    if (!target) throw new Error('Choose a book for this story event.');
    const result = foldChat(c.chat || [], meta, { cache: false });
    const found = chaptersIn(result).find(({ r }) => r.id === flag.seed?.chapter);
    if (!found) throw new Error('The chapter of this story event is no longer in this chat.');
    const bio = io || bookIo(st);
    const data = await bio.load(target);
    if (!data?.entries) throw new Error(`The World Info book "${target}" was not found.`);
    const log = additionsLog(meta);
    const item = { kind: 'event', title: flag.title, content: flag.theirs?.text || flag.seed?.text, keys: flag.seed?.keys || [], seed: flag.seed?.seed || '' };
    const applied = applySeeds(target, data, [item], { chapter: found.r, log, at: bio.now(), order: found.order });
    await bio.save(target, applied.data);
    log.push(...applied.rows);
    const { oneShot } = await B.behaviorSettings();
    oneShot[`${target}#${applied.uids[0]}`] = true;
    (await import('../store.js')).saveSettings?.();
    await s.revert(flag.entry, `Added to ${target}.`);
    return { added: applied.rows[0] };
}

let started = false;
/** Wire seeding to the host once: after each capture and on chat open; take-back on delete, swipe and branch. */
export async function startEventSeeds() {
    if (started) return;
    started = true;
    const { st, upkeep } = await host();
    // in upkeep's line, after the additions pass of the same reply, so no two jobs write one book at once
    const run = () => upkeep.upkeepPass(async () => { await seedChapters(); await reconcileSeeds(); }, 'story events');
    try { (await import('./capture.js')).onCapture(event => { if (event.phase === 'done') run(); }); } catch (error) { console.warn(st.LOG, 'story events', error); }
    for (const name of ['MESSAGE_RECEIVED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHAT_CHANGED']) st.on(name, () => setTimeout(run, 0));
}

/** Start everything behavior books need: the fired-entry recorder, one-shot events and story events. */
export async function startBehaviorBooks() {
    const fired = await import('./fired-entries.js');
    await fired.startFiredEntries();
    await startEventSeeds();
}
