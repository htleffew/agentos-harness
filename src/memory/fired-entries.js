// The behavior entries that fired (memory DESIGN 7.6, 3.3 and 3.4). SillyTavern's own scan decides what fires, with chance,
// inclusion groups and timing intact; the extension never rolls for itself. After each generation, code reads
// SillyTavern's report of the entries that fired and stores their ids with the reply, per swipe, as rolls are stored:
// in message.extra.ri_fired and in the matching swipe_info slot together, so a swipe keeps its own list, a branch copies it
// and a delete takes it away. Capture receives the titles with the reply, so a reply that acts on an event files it as a
// Thread or Fact like anything else that happened.
//
// SillyTavern 1.19 reports the entries in two places: WORLD_INFO_ACTIVATED (the whole list, once per real generation) and
// WORLDINFO_SCAN_DONE (args.activated.entries, after each pass of the scan). WORLD_INFO_ACTIVATED is the authority: it is
// sent only for a real scan, while WORLDINFO_SCAN_DONE also follows the dry runs SillyTavern makes to count tokens, with
// their own rolls. So the list of WORLDINFO_SCAN_DONE (its last scan only) is used only when no WORLD_INFO_ACTIVATED came
// for the generation. A host that sends neither falls back to the final prompt: a behavior entry the scan loaded counts
// as fired when its text is in the request.
//
// One-shot events: an event entry the extension created can play once. After it fires and the reply acts on it (a key
// of the entry is in the reply, or the reply and what capture filed from it share most of the event's words), the
// extension disables that entry, logged in chat data with Undo. When the reply leaves the chat (a delete, a swipe away, a
// branch cut before it) the entry is enabled again. Your own entries keep the switches you set.
import { entryIsBehavior } from '../book-triggers.js';
import { chatMemory, proseOf, storedMark, swipeOf } from './fold.js';
import { contentWords, overlapCoefficient } from './similarity.js';

export const FIRED = 'ri_fired';
export const CAPTURE_TITLES = 8;
const KEYED = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;

const titleOf = entry => String(entry?.comment || (Array.isArray(entry?.key) ? entry.key[0] : '') || `Entry ${entry?.uid}`).trim();
const values = list => (list instanceof Map ? [...list.values()] : Array.isArray(list) ? list : list ? [...list] : []);

// ---------------------------------------------------------------- reading the host's report (pure)

/**
 * The fired entries in the shape stored with a reply: [{ book, uid, title, behavior }], in book then uid order, with no
 * entry text. isBehavior(entry) tells a behavior entry; skip(entry) leaves an entry out (the extension's own sets).
 */
export function firedFrom(activated, { isBehavior = entryIsBehavior, skip = () => false } = {}) {
    const out = new Map();
    for (const entry of values(activated)) {
        if (!entry || entry.world === undefined || entry.uid === undefined || skip(entry)) continue;
        const key = `${entry.world}#${entry.uid}`;
        if (!out.has(key)) out.set(key, { book: String(entry.world), uid: String(entry.uid), title: titleOf(entry), behavior: !!isBehavior(entry) });
    }
    return [...out.values()].sort(byBookAndUid);
}
function byBookAndUid(a, b) {
    if (a.book !== b.book) return a.book < b.book ? -1 : 1;
    return (Number(a.uid) - Number(b.uid)) || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);
}

export const PROMPT_MATCH_MIN = 12;   // characters an entry's text needs before the prompt fallback looks for it

/**
 * The recorder for one page: it follows the host's generations and keeps the entries the current one fired.
 *   started(type, options, dryRun)  GENERATION_STARTED; a quiet generation pauses the list until it ends
 *   loaded(lore)                    WORLDINFO_ENTRIES_LOADED: the behavior entries the scan will consider
 *   activated(list)                 WORLD_INFO_ACTIVATED
 *   scanDone(args)                  WORLDINFO_SCAN_DONE
 *   prompt(text)                    the final prompt; used only when the host reported no fired entries this turn
 *   ended()                         GENERATION_ENDED or GENERATION_STOPPED
 *   take()                          the list for the reply that just arrived, or null when no generation was followed
 * The prompt fallback covers a host that runs the scan but sends neither report: a loaded behavior entry counts as fired
 * when its text is in the prompt. Each stored item names where it came from: "report" or "prompt".
 */
export function createFiredRecorder(options = {}) {
    const { isBehavior = entryIsBehavior, skip = () => false } = options;
    let turn = null;
    const keyed = items => new Map(items.map(item => [`${item.book}#${item.uid}`, { ...item, from: 'report' }]));
    return {
        started(type, opts, dryRun) {
            if (dryRun) return;
            if (type === 'quiet' || opts?.quiet_prompt) { if (turn) turn.paused = true; return; }
            turn = { type: String(type || 'normal'), entries: new Map(), scan: new Map(), paused: false, activated: false, loaded: [] };
        },
        loaded(lore) {
            if (!turn || turn.paused) return;
            const all = ['globalLore', 'characterLore', 'chatLore', 'personaLore'].flatMap(k => values(lore?.[k]));
            turn.loaded = all.filter(e => e && e.world !== undefined && !e.disable && !skip(e) && isBehavior(e) && String(e.content ?? '').trim().length >= PROMPT_MATCH_MIN)
                .map(e => ({ book: String(e.world), uid: String(e.uid), title: titleOf(e), text: String(e.content).trim() }));
        },
        activated(list) {
            if (!turn || turn.paused) return;
            turn.activated = true;
            for (const [key, item] of keyed(firedFrom(list, options))) turn.entries.set(key, item);
        },
        // each pass reports the scan's whole list so far; the last pass of the last scan is kept
        scanDone(args) { if (turn && !turn.paused) turn.scan = keyed(firedFrom(args?.activated?.entries, options)); },
        prompt(text) {
            if (!turn || turn.paused || turn.activated || turn.scan.size || !turn.loaded.length) return;
            const t = String(text || '');
            for (const e of turn.loaded) if (t.includes(e.text)) turn.entries.set(`${e.book}#${e.uid}`, { book: e.book, uid: e.uid, title: e.title, behavior: true, from: 'prompt' });
        },
        ended() { if (turn) turn.paused = false; },
        take() {
            if (!turn) return null;
            const list = turn.activated ? turn.entries : turn.scan.size ? turn.scan : turn.entries;
            const out = { type: turn.type, entries: [...list.values()].sort(byBookAndUid) };
            turn = null;
            return out;
        },
        get turn() { return turn; },
    };
}

// ---------------------------------------------------------------- the extension's entries leave your behavior entries alone (pure)

/**
 * With a behavior entry in the scan, the extension's own entries (its generated books and the sets it adds) get
 * SillyTavern's "Prevent further recursion" for this scan only, so their text cannot trigger a keyword of your book and
 * your book fires the same entries with the extension on and off. Nothing is saved. Returns how many entries changed.
 *   isOwn(entry): the entry is the extension's.
 */
export function sealOwnEntries(lore, { isOwn, isBehavior = entryIsBehavior } = {}) {
    const all = ['globalLore', 'characterLore', 'chatLore', 'personaLore'].flatMap(k => values(lore?.[k]));
    if (!all.some(e => e && !e.disable && !isOwn(e) && isBehavior(e))) return 0;
    let sealed = 0;
    for (const e of all) if (e && isOwn(e) && !e.preventRecursion) { e.preventRecursion = true; sealed += 1; }
    return sealed;
}

// ---------------------------------------------------------------- stored with the reply, per swipe (pure)

/**
 * Store a fired list on a message's showing swipe: in extra and in the matching swipe_info slot. A continued reply adds to
 * the list its first part stored. Writing an empty list matters: SillyTavern copies the last swipe's extra into a new one.
 */
export function storeFired(message, entries, { append = false } = {}) {
    if (!message) return null;
    const swipe = swipeOf(message);
    const before = append ? firedOf(message) : [];
    const merged = new Map([...before, ...entries].map(e => [`${e.book}#${e.uid}`, { ...e }]));
    const value = { swipe, entries: [...merged.values()] };
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[FIRED] = value;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[swipe] : null;
    if (info && typeof info === 'object') {
        if (!info.extra || typeof info.extra !== 'object') info.extra = {};
        info.extra[FIRED] = structuredClone(value);
    }
    return value;
}

/** The entries that fired for the showing swipe of a message, or [] (a list copied from another swipe does not count). */
export function firedOf(message) {
    const value = message?.extra?.[FIRED];
    if (!value || !Array.isArray(value.entries) || value.swipe !== swipeOf(message)) return [];
    return value.entries;
}

/** What capture is told fired for a reply: the titles of its behavior entries, at most eight. */
export function firedForCapture(rec, message) {
    const stored = message?.extra?.[FIRED] ? firedOf(message) : null;
    const list = stored ?? (rec?.v10Lore || rec?.fired || []).filter(e => e?.behavior || e?.fired);
    return list.filter(e => e?.behavior !== false).map(e => e.title || e.comment || String(e.uid)).slice(0, CAPTURE_TITLES);
}

// ---------------------------------------------------------------- one-shot events (pure)

const keysOf = entry => [].concat(entry?.key || []).map(k => String(k ?? '').trim()).filter(k => k.length >= 3 && KEYED.test(k));

/**
 * True when a reply acts on an event entry: one of its keys is in the reply, or the event's words are mostly in the reply
 * and the texts capture filed from it. Keys are matched as whole words, ignoring case.
 */
export function actedOn(entry, { prose = '', filed = [] } = {}) {
    const text = String(prose || '');
    if (keysOf(entry).some(key => new RegExp(`(^|[^\\p{L}\\p{N}])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text))) return true;
    const words = contentWords(entry?.content);
    if (words.length < 3) return false;
    return overlapCoefficient(words, contentWords([text, ...filed].join(' '))) >= 0.5;
}

/**
 * The one-shot entries a reply played: those in its fired list that are registered as one-shot, are still enabled in their
 * book, and that the reply acted on. books: Map of name to book data; oneShot: { "book#uid": true }.
 */
export function oneShotsPlayed(message, { books, oneShot = {}, filed = [] } = {}) {
    const out = [];
    for (const item of firedOf(message)) {
        if (!oneShot[`${item.book}#${item.uid}`]) continue;
        const entry = books?.get(item.book)?.entries?.[item.uid];
        if (!entry || entry.disable) continue;
        if (actedOn(entry, { prose: proseOf(message), filed })) out.push(item);
    }
    return out;
}

/** The disable log of a chat: [{ id, book, uid, title, source: { mark, swipe }, at, state }]. */
export function disabledLog(meta) {
    const mem = chatMemory(meta);
    const b = (mem.behavior ||= {});
    if (!Array.isArray(b.disabled)) b.disabled = [];
    return b.disabled;
}

/** True while the reply a row came from is in the chat and shows the swipe it came from. */
export function rowSourcePresent(row, chat) {
    const message = (chat || []).find(m => storedMark(m) === row?.source?.mark);
    return !!message && (!Number.isInteger(row.source.swipe) || row.source.swipe === swipeOf(message));
}

// ================================================================ the host side

let H = null;
async function host() {
    if (H) return H;
    const st = await import('../st.js');
    const store = await import('../store.js');
    const books = await import('./behavior-books.js');
    H = { st, store, books };
    return H;
}

const bookIo = st => ({ load: name => st.loadBook(name), save: (name, data) => st.saveBook(name, data) });

/**
 * Disable the one-shot entries the reply at `index` played. filed: texts capture filed from it. Returns the log rows made.
 */
export async function settleOneShots(index, { context, filed = [], io, now = Date.now } = {}) {
    const { st, books: B } = await host();
    const c = context || st.ctx();
    const message = c.chat?.[index];
    const mark = storedMark(message);
    if (!message || !mark) return [];
    const { oneShot } = await B.behaviorSettings();
    const fired = firedOf(message).filter(item => oneShot[`${item.book}#${item.uid}`]);
    if (!fired.length) return [];
    const { load, save } = io || bookIo(st);
    const loaded = new Map();
    for (const name of new Set(fired.map(item => item.book))) loaded.set(name, await load(name).catch(() => null));
    const played = oneShotsPlayed(message, { books: loaded, oneShot, filed });
    if (!played.length) return [];
    const log = disabledLog(c.chatMetadata);
    const rows = [];
    for (const name of new Set(played.map(item => item.book))) {
        const data = structuredClone(loaded.get(name));
        for (const item of played.filter(p => p.book === name)) {
            data.entries[item.uid].disable = true;
            const row = { id: `d${log.length + rows.length + 1}`, book: name, uid: item.uid, title: item.title, source: { mark, swipe: swipeOf(message) }, at: now(), state: 'live' };
            rows.push(row);
        }
        await save(name, data);
    }
    log.push(...rows);
    await (c.saveMetadata?.() ?? c.saveChat?.());
    return rows;
}

/**
 * Enable again the entries whose reply left the chat, and any rows named in undo. An entry you enabled or changed by hand
 * since stays as it is. Returns { enabled, kept }.
 */
export async function reconcileOneShots({ context, undo = [], io, now = Date.now } = {}) {
    const { st } = await host();
    const c = context || st.ctx();
    const log = c.chatMetadata?.ri_memory?.behavior?.disabled || [];
    const due = log.filter(row => row.state === 'live' && (undo.includes(row.id) || !rowSourcePresent(row, c.chat)));
    if (!due.length) return { enabled: [], kept: [] };
    const { load, save } = io || bookIo(st);
    const enabled = [], kept = [];
    for (const name of new Set(due.map(row => row.book))) {
        const data = await load(name).catch(() => null);
        let changed = false;
        for (const row of due.filter(r => r.book === name)) {
            const entry = data?.entries?.[row.uid];
            if (!entry) { row.state = 'gone'; kept.push(row); }
            else if (entry.disable === true) { entry.disable = false; changed = true; enabled.push(row); row.state = undo.includes(row.id) ? 'undone' : 'enabled'; }
            else { row.state = 'yours'; row.note = 'you enabled this entry again by hand'; kept.push(row); }
            row.ended = now();
        }
        if (changed) await save(name, data);
    }
    await (c.saveMetadata?.() ?? c.saveChat?.());
    return { enabled, kept };
}

/** Undo one disable from History: the entry is enabled again. */
export const undoOneShot = (id, options = {}) => reconcileOneShots({ ...options, undo: [id] });

/** History rows for the one-shot log, in the shape of upkeep.historyRows. */
export function oneShotRows(chat, meta) {
    const marks = new Map((chat || []).map((m, i) => [storedMark(m), i]));
    return (meta?.ri_memory?.behavior?.disabled || []).map(row => ({
        entry: row.id, op: 'disable', job: 'behavior', label: `Event played once, disabled: ${row.title}`, text: `${row.book} #${row.uid}`, reason: '',
        index: marks.get(row.source?.mark) ?? null, at: row.at, counts: row.state === 'live', note: row.state === 'live' ? '' : row.state,
        targets: [`${row.book}#${row.uid}`], undo: row.state === 'live' ? row.id : '', restore: [], oneShot: true,
    })).sort((a, b) => (b.at || 0) - (a.at || 0));
}

let started = false;
const recorder = { value: null };
/** The recorder this page uses (tests read it). */
export const firedRecorder = () => recorder.value;

/**
 * Wire the recorder to the host once. The list is written to the reply in MESSAGE_RECEIVED, after the extension's own
 * handler has attached its record, and one-shot events are settled after the reply's capture is done.
 */
export async function startFiredEntries() {
    if (started) return;
    started = true;
    const { st, store } = await host();
    const kinds = () => store.settings().memory?.behavior?.kinds || {};
    const isBehavior = entry => entryIsBehavior(entry) || kinds()[entry.world] === 'behavior';
    const skip = entry => !!entry?.extensions?.ri || Object.hasOwn(store.settings().sets || {}, entry?.world);
    const rec = recorder.value = createFiredRecorder({ isBehavior, skip });
    const { isGeneratedName } = await import('./story-world-book.js');
    const isOwn = entry => skip(entry) || isGeneratedName(entry?.world) || String(entry?.world ?? '').startsWith('Roleplay Instructions');
    st.on('GENERATION_STARTED', (type, opts, dryRun) => rec.started(type, opts, dryRun));
    // registered after the extension's other WORLDINFO_ENTRIES_LOADED handlers, so the entries they add are in the lists
    st.on('WORLDINFO_ENTRIES_LOADED', lore => { sealOwnEntries(lore, { isOwn, isBehavior }); rec.loaded(lore); });
    st.on('WORLD_INFO_ACTIVATED', list => rec.activated(list));
    st.on('WORLDINFO_SCAN_DONE', args => rec.scanDone(args));
    st.on('CHAT_COMPLETION_PROMPT_READY', data => { if (!data?.dryRun) rec.prompt((data?.chat || []).map(m => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''))).join('\n')); });
    st.on('GENERATE_AFTER_COMBINE_PROMPTS', data => { if (!data?.dryRun) rec.prompt(String(data?.prompt || '')); });
    st.on('GENERATION_ENDED', () => rec.ended());
    st.on('GENERATION_STOPPED', () => rec.ended());
    st.on('MESSAGE_RECEIVED', (id, type) => {
        if (type === 'first_message') return;
        const taken = rec.take();
        const message = st.ctx().chat?.[id];
        if (!taken || !message || message.is_user) return;
        storeFired(message, taken.entries, { append: taken.type === 'continue' });
    });
    // book writes run in upkeep's line, so they never race the additions pass over the same book
    const { upkeepPass } = await import('./upkeep.js');
    try {
        const capture = await import('./capture.js');
        capture.onCapture(event => {
            if (event.phase !== 'done' || !Number.isInteger(event.index)) return;
            const filed = (event.result?.inputs || []).map(i => i.record?.text).filter(Boolean);
            upkeepPass(() => settleOneShots(event.index, { filed }), 'one-shot events');
        });
    } catch (error) { console.warn(st.LOG, 'one-shot events', error); }
    const take = () => upkeepPass(() => reconcileOneShots(), 'one-shot events');
    for (const name of ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHAT_CHANGED']) st.on(name, () => setTimeout(take, 0));
}
