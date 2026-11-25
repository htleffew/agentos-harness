// Behavior books (memory DESIGN 7.6). A behavior book is an ordinary World Info book whose entries shape how the story
// runs: random story events, writing styles and instructions that fire by chance or exclude one another. Every behavior
// uses fields SillyTavern 1.19 reads itself (useProbability and probability; group, groupOverride, groupWeight and
// useGroupScoring; secondary keys with NOT ANY or NOT ALL logic; sticky, cooldown and delay; position, depth and role), so
// SillyTavern's own scan decides what fires, with the extension on or off.
//
// Nothing of the extension's own is stored inside a book. Which books count as behavior books, which books the extension
// made and which of its entries play once live in extension settings (settings.memory.behavior); the book that receives
// story events and the log of additions live in chat data (chat_metadata.ri_memory).
//
// Entries the extension creates sit at depth 1 with the system role (position 4 is "at depth"), so a fired entry changes
// only the end of the request (5.2). Your own entries keep the positions you gave them.
//
// The first half is pure (kinds, entry fields, drafts, export); the second half reads and saves books through the host.
import { ENTRY_DEFAULTS, ST_FIELDS } from './book-writer.js';
import { bookTraits } from '../book-triggers.js';
import { chatMemory } from './fold.js';

export const KINDS = Object.freeze(['behavior', 'reference']);
export const KIND_LABELS = Object.freeze({ behavior: 'Behavior book', reference: 'Reference book' });
export const DRAFT_KINDS = Object.freeze(['event', 'style', 'chance']);
export const DRAFT_LABELS = Object.freeze({ event: 'Random story event', style: 'Writing style', chance: 'Chance instruction' });
export const EVENT_GROUP = 'Story events';
export const STYLE_GROUP = 'Style';
export const EVENT_CHANCE = 10;        // percent
export const EVENT_COOLDOWN = 10;      // messages
export const CHANCE_DEFAULT = 25;      // percent, when a chance instruction names none
/** Where every entry the extension creates sits: position 4 ("at depth"), depth 1, the system role. */
export const PLACE = Object.freeze({ position: 4, depth: 1, role: 0 });
/** The top-level fields of a World Info file that SillyTavern 1.19 reads. */
export const BOOK_FIELDS = Object.freeze(['entries', 'originalData']);

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const list = value => [...new Set([].concat(value ?? []).map(clean).filter(Boolean))];

// ---------------------------------------------------------------- kinds (pure)

/** True when any entry of the book uses chance, an inclusion group or a timing field. */
export const usesBehavior = data => bookTraits(Object.values(data?.entries || {})).behavior > 0;

/** The kind a book has: the kind you set on Story, World Info, else what its entries use. */
export function bookKind(name, data, kinds = {}) {
    if (KINDS.includes(kinds?.[name])) return kinds[name];
    return usesBehavior(data) ? 'behavior' : 'reference';
}

// ---------------------------------------------------------------- entries the extension creates (pure)

const nextUid = data => Math.max(-1, ...Object.keys(data?.entries || {}).map(Number).filter(Number.isFinite)) + 1;

/**
 * The SillyTavern fields of one entry of a given kind. item: { title, content, keys, chance, weight, group }.
 *   event:  keys from the people and places it needs, or Constant when it names none; chance 10 percent; inclusion group
 *           "Story events", so at most one fires a turn; cooldown 10 messages.
 *   style:  Constant; inclusion group "Style" with its weight, so one style applies a turn.
 *   chance: chance as drafted; an inclusion group when it competes with others; keys or Constant as for an event.
 * Every kind sits at depth 1 with the system role.
 */
export function entryFields(kind, item = {}) {
    if (!DRAFT_KINDS.includes(kind)) throw new Error(`Unknown behavior entry kind: ${kind}`);
    const keys = list(item.keys);
    const base = { ...structuredClone(ENTRY_DEFAULTS), ...PLACE, comment: clean(item.title), content: clean(item.content), key: kind === 'style' ? [] : keys, constant: kind === 'style' || !keys.length };
    if (kind === 'event') return { ...base, useProbability: true, probability: EVENT_CHANCE, group: EVENT_GROUP, cooldown: EVENT_COOLDOWN };
    if (kind === 'style') return { ...base, group: STYLE_GROUP, groupWeight: Math.max(1, Math.min(1000, Math.round(Number(item.weight) || 100))) };
    const chance = Math.round(Number(item.chance));
    return { ...base, useProbability: true, probability: chance >= 1 && chance <= 99 ? chance : CHANCE_DEFAULT, group: clean(item.group) };
}

/** One new entry in SillyTavern's shape, with the uid it takes. */
export function makeEntry(uid, kind, item) {
    return { ...entryFields(kind, item), uid, displayIndex: uid };
}

/** An empty book: entries only, nothing of ours. */
export const newBookData = () => ({ entries: {} });

/** Add entries to a copy of a book. items: [{ kind, title, content, keys, ... }]. Returns { data, uids }. */
export function addEntries(data, items) {
    const out = structuredClone(data || newBookData());
    out.entries ||= {};
    const uids = [];
    for (const item of items) {
        const uid = nextUid(out);
        out.entries[uid] = makeEntry(uid, item.kind, item);
        uids.push(uid);
    }
    return { data: out, uids };
}

// ---------------------------------------------------------------- export (pure)

/** A book as a standard World Info file: SillyTavern's top-level fields and SillyTavern's own entry fields only. */
export function exportData(data) {
    const out = {};
    for (const field of Object.keys(data || {})) {
        if (!BOOK_FIELDS.includes(field)) continue;
        if (field !== 'entries') { out[field] = structuredClone(data[field]); continue; }
        out.entries = {};
        for (const [uid, entry] of Object.entries(data.entries || {})) out.entries[uid] = Object.fromEntries(Object.entries(entry).filter(([name]) => ST_FIELDS.has(name)));
    }
    if (!out.entries) out.entries = {};
    return out;
}

/** The text of an exported book, as SillyTavern's own Export writes it (JSON.stringify of the book). */
export const exportText = data => JSON.stringify(exportData(data));

/** What in a book is not SillyTavern's own: top-level fields and entry fields, as readable lines. */
export function foreignParts(data) {
    const out = Object.keys(data || {}).filter(field => !BOOK_FIELDS.includes(field)).map(field => `book field ${field}`);
    for (const [uid, entry] of Object.entries(data?.entries || {})) for (const field of Object.keys(entry || {})) if (!ST_FIELDS.has(field)) out.push(`entry ${uid} field ${field}`);
    return out;
}

// ---------------------------------------------------------------- Draft entries from a description (pure)

export const DRAFT_SYSTEM = 'You draft the entries of a behavior book for a roleplay story. You answer with one JSON object only.';

export const DRAFT_SCHEMA = Object.freeze({
    name: 'behavior_entries',
    value: {
        type: 'object',
        required: ['entries'],
        properties: {
            entries: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['kind', 'title', 'content'],
                    properties: {
                        kind: { type: 'string', enum: [...DRAFT_KINDS] },
                        title: { type: 'string' },
                        content: { type: 'string' },
                        people: { type: 'array', items: { type: 'string' } },
                        places: { type: 'array', items: { type: 'string' } },
                        chance: { type: 'integer' },
                        weight: { type: 'integer' },
                        group: { type: 'string' },
                        once: { type: 'boolean' },
                    },
                },
            },
        },
    },
});

/**
 * The user prompt of the one Writer call that turns a sentence into entries. kind: one of DRAFT_KINDS, or '' to let the
 * description decide. cast and places: names the story already uses, so the entries can key on them.
 */
export function draftPrompt({ description, kind = '', cast = [], places = [], count = 4, error = '', previous = '' }) {
    const kinds = kind ? [kind] : [...DRAFT_KINDS];
    const lines = [
        'Draft behavior book entries from this description.',
        `Description: "${clean(description)}"`,
        list(cast).length ? `People in the story: ${list(cast).join(', ')}.` : '',
        list(places).length ? `Places in the story: ${list(places).join(', ')}.` : '',
        [
            `Return one JSON object with "entries": 1 to ${count} entries. Each entry has:`,
            `- "kind": ${kinds.map(k => `"${k}"`).join(' or ')}. "event" is a short cue to the narrator that something happens now; "style" is a writing style instruction; "chance" is an instruction that applies on some turns.`,
            '- "title": 2 to 6 plain words.',
            '- "content": one or two sentences addressed to the narrator, under 300 characters, naming people and places by name.',
            '- "people" and "places": the names the entry needs, which become its keywords. Use [] when it can happen anywhere.',
            '- "chance": for "chance" only, the percent of turns it applies on, 1 to 99.',
            '- "weight": for "style" only, 1 to 1000, how often this style is picked against the others.',
            '- "group": for "chance" only, a short group name when it competes with other chance instructions, else "".',
            '- "once": true when the event should play only once.',
        ].join('\n'),
        error ? `Your previous answer:\n${previous}\n\nIt could not be used: ${error} Send the corrected JSON only.` : '',
    ];
    return lines.filter(Boolean).join('\n\n');
}

/**
 * Check a draft answer. Returns { items, problems }: items ready for review ([{ kind, title, content, keys, chance, weight,
 * group, once }]); problems name what made an entry unusable.
 */
export function checkDraft(answer, { kind = '' } = {}) {
    const problems = [];
    const rows = Array.isArray(answer?.entries) ? answer.entries : [];
    if (!rows.length) problems.push('The answer has no entries.');
    const items = [];
    rows.forEach((row, i) => {
        const k = DRAFT_KINDS.includes(row?.kind) ? row.kind : kind || '';
        const content = clean(row?.content);
        if (!DRAFT_KINDS.includes(k)) { problems.push(`Entry ${i + 1} has no kind.`); return; }
        if (kind && k !== kind) { problems.push(`Entry ${i + 1} is a ${k}; a ${kind} was asked for.`); return; }
        if (!content) { problems.push(`Entry ${i + 1} has no content.`); return; }
        items.push({ kind: k, title: clean(row.title) || DRAFT_LABELS[k], content: content.slice(0, 300), keys: [...list(row.people), ...list(row.places)].slice(0, 6), chance: row.chance, weight: row.weight, group: clean(row.group), once: k === 'event' && row.once === true });
    });
    return { items, problems };
}

/** The entries a reviewed draft would save, in SillyTavern's shape, for the review sheet to show their fields. */
export const draftPreview = items => items.map((item, i) => ({ ...makeEntry(i, item.kind, item), once: !!item.once }));

// ================================================================ the host side

let H = null;
async function host() {
    if (H) return H;
    const st = await import('../st.js');
    const store = await import('../store.js');
    H = { st, store };
    return H;
}

/** The extension's own record of behavior books: kinds you set, books it made, entries that play once. */
export async function behaviorSettings() {
    const { store } = await host();
    const memory = (store.settings().memory ||= {});
    const b = (memory.behavior ||= {});
    b.kinds ||= {};
    b.made ||= {};
    b.oneShot ||= {};
    return b;
}
const save = async () => (await host()).store.saveSettings?.();

/** The behavior part of a chat's memory data: the book that receives story events, chapters seeded, entries disabled. */
export function chatBehavior(meta) {
    const mem = chatMemory(meta);
    const b = (mem.behavior ||= {});
    if (typeof b.receive !== 'string') b.receive = '';
    if (!Array.isArray(b.seeded)) b.seeded = [];
    if (!Array.isArray(b.disabled)) b.disabled = [];
    return b;
}

/** Every World Info book with its kind, as Story, World Info lists it. names and load default to the host's. */
export async function listBooks({ names, load } = {}) {
    const { st } = await host();
    const b = await behaviorSettings();
    const all = names || st.worldNames();
    const out = [];
    for (const name of all) {
        const data = await (load || st.loadBook)(name).catch(() => null);
        if (!data?.entries) continue;
        const traits = bookTraits(Object.values(data.entries));
        out.push({ name, kind: bookKind(name, data, b.kinds), detected: usesBehavior(data) ? 'behavior' : 'reference', set: KINDS.includes(b.kinds[name]), made: !!b.made[name], traits });
    }
    return out;
}

/** Change the kind of a book. A behavior book is never managed by recall (4.1), so its switch turns off. */
export async function setBookKind(name, kind) {
    if (!KINDS.includes(kind) && kind !== '') throw new Error(`Unknown book kind: ${kind}`);
    const b = await behaviorSettings();
    if (kind) b.kinds[name] = kind; else delete b.kinds[name];
    if (kind === 'behavior') (await import('../book-triggers.js')).setRecallManages(name, false);
    await save();
    return kind;
}

/** The book that receives story events in this chat, or '' when none is chosen. */
export const receiveBookOf = meta => (meta?.ri_memory?.behavior?.receive || '');

/** Choose the book that receives story events in the open chat ('' for none). */
export async function setReceiveBook(name, { context } = {}) {
    const { st } = await host();
    const c = context || st.ctx();
    chatBehavior(c.chatMetadata).receive = String(name || '');
    await (c.saveMetadata?.() ?? c.saveChat?.());
    return chatBehavior(c.chatMetadata).receive;
}

/**
 * New behavior book: an empty World Info book the extension made. It becomes the book that receives story events in the
 * open chat when none is chosen yet. "Story may add to this book" starts at Off for it: story events reach it directly,
 * and alias keywords or lines from the alias table would change when its events fire.
 */
export async function createBehaviorBook(name, { context, receive = true } = {}) {
    const { st } = await host();
    const title = String(name || '').trim();
    if (!title) throw new Error('A behavior book needs a name.');
    if (st.worldNames().includes(title)) throw new Error(`A World Info book named "${title}" already exists.`);
    await st.saveBook(title, newBookData());
    await st.refreshWorldList();
    const b = await behaviorSettings();
    b.made[title] = true;
    b.kinds[title] = 'behavior';
    const { setBookLevel } = await import('./upkeep.js');
    await setBookLevel(title, 'off');
    await save();
    const c = context || st.ctx();
    if (receive && c.chatMetadata && !chatBehavior(c.chatMetadata).receive) await setReceiveBook(title, { context: c });
    return title;
}

/** True when the extension made this book. */
export async function isMadeBook(name) {
    return !!(await behaviorSettings()).made[name];
}

/** The names the story already uses, for a draft to key on: the cast and the people and places in the records. */
async function storyNames(c) {
    const { fold } = await import('./fold.js');
    const result = c.chatMetadata?.ri_memory ? fold(c.chat || [], c.chatMetadata) : { current: [] };
    const cast = [c.name1, c.name2, ...result.current.filter(r => r.kind === 'person').map(r => r.subject)];
    const places = result.current.filter(r => r.kind === 'place').map(r => r.subject);
    return { cast: list(cast), places: list(places) };
}

/**
 * Draft entries from a description: one Writer call (job "behaviorDrafts"), one repair retry. Nothing is saved; the
 * result is shown for you to accept, edit or drop. Returns { ok, items, preview, problems, route, model, reason }.
 */
export async function draftEntries(description, { kind = '', signal, runChainFn, context } = {}) {
    const { st } = await host();
    if (!clean(description)) throw new Error('Describe what the entries should do.');
    const c = context || st.ctx();
    const names = await storyNames(c);
    const run = runChainFn || (async options => { const routing = await import('../routing.js'); return routing.runChain(routing.chainFor('behaviorDrafts'), { job: 'behaviorDrafts', ...options }); });
    let error = '', previous = '', last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await run({ system: DRAFT_SYSTEM, user: draftPrompt({ description, kind, ...names, error, previous }), schema: DRAFT_SCHEMA, tokens: 900, signal, background: false, label: 'Draft behavior entries' });
        if (!res?.ok) return { ok: false, items: [], preview: [], problems: [], reason: res?.reason || 'No route in the Writer chain answered.' };
        last = res;
        const checked = checkDraft(res.value, { kind });
        if (checked.items.length && !checked.problems.length) return { ok: true, ...checked, preview: draftPreview(checked.items), route: res.route, model: res.model };
        error = checked.problems.join(' ');
        previous = JSON.stringify(res.value ?? null).slice(0, 4000);
        if (attempt === 1) return { ok: true, ...checked, preview: draftPreview(checked.items), route: res.route, model: res.model };
    }
    return { ok: false, items: [], preview: [], problems: [], route: last?.route, reason: 'The draft could not be read.' };
}

/**
 * Save reviewed draft items into a book. Events marked once are recorded in extension settings as one-shot entries, so
 * the extension disables them after they play. Returns the uids saved.
 */
export async function saveDrafts(name, items) {
    const { st } = await host();
    const data = await st.loadBook(name);
    if (!data?.entries) throw new Error(`The World Info book "${name}" was not found.`);
    const added = addEntries(data, items);
    await st.saveBook(name, added.data);
    const b = await behaviorSettings();
    items.forEach((item, i) => { if (item.once) b.oneShot[`${name}#${added.uids[i]}`] = true; });
    await save();
    return added.uids;
}

/** Export any book as a standard World Info file. Returns the text; downloads it as "<name>.json" unless told not to. */
export async function exportBook(name, { download = true } = {}) {
    const { st } = await host();
    const data = await st.loadBook(name);
    if (!data?.entries) throw new Error(`The World Info book "${name}" was not found.`);
    const text = exportText(data);
    if (download && typeof document !== 'undefined') {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `${name}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return text;
}
