// Stat sheets per chat (DESIGN 6.9, decision 17). Every roll adds the actor's stat modifier, read here.
//   Persona and character: one model call at chat start infers both sheets from the persona and the character card.
//   NPC in a World Info book: a sheet inferred from that book's entry, stored in the book as one added, disabled entry
//     ("Stats: <name>"); every entry she wrote stays as written.
//   NPC who first acts during play: a plain sheet (every modifier 0) at once, stored with the chat, filled by inference.
// A value she sets is marked as hers, and no later inference changes it. With MB14's store installed
// (src/memory/stat-sheet-store.js) the sheets are Stat sheet records in the memory log: every read comes from there and
// every write goes there too; the per-chat copy in chat state answers only while no store is installed.
import { ctx, names, characterKey, loadBook, saveBook, worldNames, isChatOpen, KEY } from './st.js';
import { settings, chatState, saveChatState } from './store.js';
import { runJob } from './routing.js';

export const DEFAULT_STATS = ['Strength', 'Agility', 'Wits', 'Charm', 'Will', 'Senses'];
export const MOD_MIN = -20;
export const MOD_MAX = 20;
/** The range inference keeps to: 0 is average, +5 exceptional, as the Setup help describes. */
export const INFER_MIN = -3;
export const INFER_MAX = 5;
export const SHEET_ENTRY_PREFIX = 'Stats: ';

// MB14: the memory store of Stat sheet records, once installed.
let records = null;
export const setSheetRecords = store => { records = store || null; };

const fold = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** The stats in use, in order. */
export function statNames() {
    const list = settings().dice?.stats;
    return (Array.isArray(list) && list.length ? list : DEFAULT_STATS).map(s => String(s || '').trim()).filter(Boolean);
}

/** The key a stat sheet is kept under in the chat: 'user', 'char', or 'npc:<folded name>'. */
export function subjectOf(who) {
    if (who === 'user' || who === 'char') return who;
    const name = fold(who);
    if (name && name === fold(names().user)) return 'user';
    if (name && name === fold(names().char)) return 'char';
    return `npc:${name}`;
}

/** The key today's saved sheets use in settings: the character card, or the persona. */
export function legacyKey(who) {
    if (who === 'char') return characterKey() || `char:${names().char}`;
    return `user:${ctx().user_avatar || names().user}`;
}

/** This chat's sheets: { [subject]: { name, kind, stats, reasons, mine, source, route, model, book, at } }. */
export function chatSheets() {
    const cs = chatState();
    if (!cs) return {};
    if (!cs.statSheets || typeof cs.statSheets !== 'object') cs.statSheets = {};
    return cs.statSheets;
}

/** The same sheets read only: a roll or a view never writes the chat's metadata. */
export function savedSheets() {
    if (records) { try { return records.sheets() || {}; } catch { return {}; } }
    try {
        const sheets = isChatOpen() ? ctx().chatMetadata?.[KEY]?.statSheets : null;
        return sheets && typeof sheets === 'object' ? sheets : {};
    } catch { return {}; }
}

export function sheetOf(who) {
    return savedSheets()[subjectOf(who)] || null;
}

/** The stat modifiers of an actor: this chat's sheet over the sheet saved in settings before per-chat sheets. */
export function statsOf(who) {
    const subject = subjectOf(who);
    const legacy = subject === 'user' || subject === 'char' ? settings().dice?.sheets?.[legacyKey(subject)] || {} : {};
    return { ...legacy, ...(sheetOf(who)?.stats || {}) };
}

/** One modifier; a stat with no value counts as 0. */
export function modifierOf(who, stat) {
    return clamp(statsOf(who)[stat], MOD_MIN, MOD_MAX);
}

function newSheet(who, name, kind, source) {
    return { name: clip(name, 80), kind, stats: {}, reasons: {}, mine: {}, source, at: Date.now() };
}

const kindOf = subject => subject === 'user' ? 'persona' : subject === 'char' ? 'character' : 'npc';
const nameOf = (subject, name) => subject === 'user' ? names().user : subject === 'char' ? names().char : name;

/** Set one value by hand. It is marked as hers, so inference leaves it alone from now on. */
export function setStatByHand(who, stat, value, name = '') {
    const all = chatSheets();
    if (!chatState()) return null;
    const subject = subjectOf(who);
    const sheet = all[subject] || (all[subject] = newSheet(subject, nameOf(subject, name || who), kindOf(subject), 'you'));
    sheet.stats[stat] = clamp(value, MOD_MIN, MOD_MAX);
    sheet.mine = { ...(sheet.mine || {}), [stat]: true };
    if (sheet.reasons) delete sheet.reasons[stat];
    saveChatState();
    return records?.byHand(subject, stat, value, sheet.name) || sheet;
}

/** Give a value back to inference: the mark goes, and the next inference may set it. */
export function releaseStat(who, stat) {
    if (records) {
        const own = chatState()?.statSheets?.[subjectOf(who)];
        if (own?.mine) delete own.mine[stat];
        return !!records.release(subjectOf(who), stat);
    }
    const sheet = sheetOf(who);
    if (!sheet?.mine?.[stat]) return false;
    delete sheet.mine[stat];
    saveChatState();
    return true;
}

/**
 * Store what an inference found, leaving every value she set as it is. stats: { [stat]: number }, reasons: { [stat]: text }.
 * Returns the sheet.
 */
export function applyInferred(who, { name = '', stats = {}, reasons = {}, source = 'card', route = '', model = '', book = '' } = {}) {
    if (!chatState()) return null;
    const all = chatSheets();
    const subject = subjectOf(who);
    const sheet = all[subject] || (all[subject] = newSheet(subject, nameOf(subject, name || who), kindOf(subject), source));
    const known = new Set(statNames());
    for (const [stat, value] of Object.entries(stats || {})) {
        if (!known.has(stat) || sheet.mine?.[stat]) continue;
        sheet.stats[stat] = clamp(value, INFER_MIN, INFER_MAX);
        if (reasons?.[stat]) sheet.reasons[stat] = clip(reasons[stat], 160);
    }
    Object.assign(sheet, { source: sheet.source === 'you' ? 'you' : source, inferred: Date.now(), ...(route ? { route } : {}), ...(model ? { model } : {}), ...(book ? { book } : {}) });
    delete sheet.plain;
    saveChatState();
    return records?.inferred(subject, { name: sheet.name, stats, reasons, source, route, model, book }) || sheet;
}

/** A plain sheet, every modifier 0, for an actor with none yet. It is stored with the chat. */
export function ensurePlainSheet(who, name = '', source = 'play') {
    if (!chatState()) return null;
    const existing = sheetOf(who);
    if (existing) return existing;
    const subject = subjectOf(who);
    const sheet = chatSheets()[subject] = newSheet(subject, nameOf(subject, name || who), kindOf(subject), source);
    sheet.plain = true;
    saveChatState();
    return records?.plain(subject, sheet.name, source) || sheet;
}

// ---------------------------------------------------------------- the inference call

/** The answer every sheet call returns: one sheet per subject, one row per stat with a short reason. */
export function sheetSchema(stats = statNames()) {
    return {
        name: 'stat_sheets', strict: true,
        value: {
            type: 'object', required: ['sheets'], additionalProperties: false,
            properties: { sheets: { type: 'array', items: {
                type: 'object', required: ['who', 'stats'], additionalProperties: false,
                properties: {
                    who: { type: 'string' },
                    stats: { type: 'array', items: { type: 'object', required: ['stat', 'value', 'reason'], additionalProperties: false,
                        properties: { stat: { type: 'string', enum: [...stats] }, value: { type: 'integer' }, reason: { type: 'string' } } } },
                },
            } } },
        },
    };
}

export const SHEET_SYSTEM = 'You set stat modifiers for characters in a roleplay. Read each description and give every listed stat a whole number '
    + `from ${INFER_MIN} to +${INFER_MAX}: 0 is an ordinary person, +1 to +3 trained or gifted, +4 or +5 exceptional, below 0 a clear weakness. `
    + 'Base each number on what the description says, and give a reason of a few words quoting or naming that part. '
    + 'With nothing to go on, give 0. Answer with JSON and nothing else.';

/** The request for one or more subjects: [{ who, text }]. */
export function sheetRequest(subjects, stats = statNames()) {
    const user = [`Stats: ${stats.join(', ')}.`, ...subjects.map(s => `Character "${s.who}":\n${clip(s.text, 3000) || '(no description)'}`)].join('\n\n');
    return { system: SHEET_SYSTEM, user, schema: sheetSchema(stats) };
}

/** Read an answer into { [who folded]: { stats, reasons } }. Values outside the stat list are dropped. */
export function readSheetAnswer(value, stats = statNames()) {
    const known = new Set(stats);
    const out = {};
    for (const item of Array.isArray(value?.sheets) ? value.sheets : []) {
        const who = fold(item?.who);
        if (!who) continue;
        const sheet = out[who] = { stats: {}, reasons: {} };
        for (const row of Array.isArray(item.stats) ? item.stats : []) {
            if (!known.has(row?.stat) || !Number.isFinite(Number(row?.value))) continue;
            sheet.stats[row.stat] = clamp(row.value, INFER_MIN, INFER_MAX);
            if (row.reason) sheet.reasons[row.stat] = clip(row.reason, 160);
        }
    }
    return out;
}

/** The persona and the character card as the sheet call reads them. */
export function cardTexts() {
    const c = ctx();
    const ch = c.characters?.[c.characterId] || {};
    const data = ch.data || {};
    const card = [ch.description ?? data.description, ch.personality ?? data.personality, ch.scenario ?? data.scenario].filter(Boolean).join('\n');
    const persona = c.powerUserSettings?.persona_description || c.persona_description || '';
    return [{ subject: 'user', who: names().user, text: persona }, { subject: 'char', who: names().char, text: card }];
}

let running = null;

/**
 * Infer the Persona's and the character's sheets at chat start, once per chat. `run` is the job runner (runJob by
 * default; tests pass their own). force runs it again, which still keeps every value she set.
 */
export async function inferChatSheets({ run = runJob, force = false, signal } = {}) {
    const cs = chatState();
    if (!cs) return null;
    if (!force && cs.statSheetsInferred) return null;
    if (running) return running;
    running = (async () => {
        const subjects = cardTexts();
        const req = sheetRequest(subjects);
        const res = await run('statSheets', { ...req, tokens: 500, signal, label: 'Stat sheets for the persona and the character' });
        const at = Date.now();
        const call = { at, ok: !!res?.ok, route: res?.route || '', model: res?.model || '', reason: res?.ok ? '' : res?.reason || '' };
        cs.statSheetCalls = [...(cs.statSheetCalls || []), { what: 'persona and character', ...call }].slice(-20);
        if (!res?.ok) { saveChatState(); return { ok: false, reason: call.reason }; }
        const read = readSheetAnswer(res.value);
        for (const s of subjects) {
            const found = read[fold(s.who)] || read[s.subject] || (s.subject === 'user' ? read.persona || read.user : read.character || read.char);
            if (found) applyInferred(s.subject, { name: s.who, ...found, source: 'card', route: res.route, model: res.model });
        }
        cs.statSheetsInferred = at;
        saveChatState();
        return { ok: true, sheets: chatSheets() };
    })().finally(() => { running = null; });
    return running;
}

// ---------------------------------------------------------------- NPCs and their World Info books

/** The books an NPC may be described in: the chat's, the character's, the persona's and the chat's story world. */
export function candidateBooks() {
    const c = ctx();
    const out = [c.chatMetadata?.world_info, c.characters?.[c.characterId]?.data?.extensions?.world, c.powerUserSettings?.persona_description_lorebook];
    for (const extra of c.characters?.[c.characterId]?.data?.extensions?.world_info_extra || []) out.push(extra);
    const available = new Set(worldNames());
    return [...new Set(out.filter(name => typeof name === 'string' && name && available.has(name)))];
}

const isSheetEntry = entry => String(entry?.comment || '').startsWith(SHEET_ENTRY_PREFIX);

/** The entry of a book that describes an NPC: its key or its title names the NPC. Our own added sheet entries do not count. */
export function entryFor(data, name) {
    const target = fold(name);
    if (!target) return null;
    for (const entry of Object.values(data?.entries || {})) {
        if (!entry || isSheetEntry(entry) || entry.disable) continue;
        const keys = [...(entry.key || []), entry.comment].map(fold).filter(Boolean);
        if (keys.some(key => key === target || key.split(' ').includes(target) || target.split(' ').includes(key) && key.length > 2)) return entry;
    }
    return null;
}

/** The text of the added entry: one line per stat. */
export function sheetEntryText(name, stats, reasons = {}) {
    return [`Stat modifiers for ${name}, added by Roleplay Instructions for its dice. This entry stays disabled; it is never sent.`,
        ...Object.entries(stats).map(([stat, value]) => `${stat}: ${value > 0 ? '+' : ''}${value}${reasons[stat] ? ` (${reasons[stat]})` : ''}`)].join('\n');
}

/** Add, or refresh, the one disabled "Stats: <name>" entry of a book. Every other entry stays as it was. Returns its uid. */
export function writeSheetEntry(data, name, stats, reasons = {}) {
    data.entries = data.entries && typeof data.entries === 'object' ? data.entries : {};
    const title = `${SHEET_ENTRY_PREFIX}${name}`;
    const existing = Object.values(data.entries).find(entry => entry?.comment === title);
    const content = sheetEntryText(name, stats, reasons);
    if (existing) { existing.content = content; return existing.uid; }
    const uid = Math.max(-1, ...Object.keys(data.entries).map(Number).filter(Number.isFinite)) + 1;
    data.entries[uid] = { uid, key: [name], keysecondary: [], comment: title, content, constant: false, selective: true, disable: true,
        order: 100, position: 0, addMemo: true, excludeRecursion: true, preventRecursion: true, probability: 100, useProbability: false, depth: 4, group: '' };
    return uid;
}

/** Find where an NPC is described: { book, entry } or null. */
export async function findNpcEntry(name, { books = candidateBooks(), load = loadBook } = {}) {
    for (const book of books) {
        const data = await load(book).catch(() => null);
        const entry = entryFor(data, name);
        if (entry) return { book, data, entry };
    }
    return null;
}

/** Read an added sheet entry back: { stats, reasons } or null. */
export function readSheetEntry(data, name) {
    const entry = Object.values(data?.entries || {}).find(e => e?.comment === `${SHEET_ENTRY_PREFIX}${name}`);
    if (!entry) return null;
    const known = new Set(statNames());
    const stats = {}, reasons = {};
    for (const line of String(entry.content || '').split('\n')) {
        const m = line.match(/^([^:]+):\s*([+-]?\d+)(?:\s*\((.*)\))?\s*$/);
        if (!m || !known.has(m[1].trim())) continue;
        stats[m[1].trim()] = clamp(m[2], MOD_MIN, MOD_MAX);
        if (m[3]) reasons[m[1].trim()] = m[3];
    }
    return Object.keys(stats).length ? { stats, reasons } : null;
}

const npcRuns = new Map();

/**
 * Give an NPC a sheet. With a World Info entry, the sheet is inferred from it and stored in that book as one added
 * entry; without one, from the recent story, stored with the chat. A plain sheet stands in until the call answers.
 */
export async function inferNpcSheet(name, { run = runJob, storyText = '', load = loadBook, save = saveBook, books, signal } = {}) {
    if (!chatState()) return null;
    const subject = subjectOf(name);
    if (subject === 'user' || subject === 'char') return null;
    const existing = sheetOf(name);
    if (existing && !existing.plain) return existing;
    if (npcRuns.has(subject)) return npcRuns.get(subject);
    const work = (async () => {
        const found = await findNpcEntry(name, { books: books || candidateBooks(), load });
        ensurePlainSheet(name, name, found ? 'book' : 'play');
        // A sheet an earlier chat added to the book is read back with no call.
        const saved = found ? readSheetEntry(found.data, name) : null;
        if (saved) return applyInferred(name, { name, ...saved, source: 'book', book: found.book });
        const text = found ? found.entry.content : storyText;
        const res = await run('statSheets', { ...sheetRequest([{ who: name, text }]), tokens: 300, signal, label: `Stat sheet for ${name}` });
        const cs = chatState();
        if (cs) cs.statSheetCalls = [...(cs.statSheetCalls || []), { what: name, at: Date.now(), ok: !!res?.ok, route: res?.route || '', model: res?.model || '', reason: res?.ok ? '' : res?.reason || '' }].slice(-20);
        if (!res?.ok) { saveChatState(); return sheetOf(name); }
        const read = readSheetAnswer(res.value)[fold(name)] || Object.values(readSheetAnswer(res.value))[0];
        if (!read) return sheetOf(name);
        const sheet = applyInferred(name, { name, ...read, source: found ? 'book' : 'play', route: res.route, model: res.model, book: found?.book || '' });
        // The base sheet goes into the NPC's book at any "Story may add to this book" level except Off (memory DESIGN 7.7).
        if (found && (records?.mayAddToBook(found.book) ?? true)) {
            const uid = writeSheetEntry(found.data, name, sheet.stats, sheet.reasons);
            await save(found.book, found.data);
            records?.addedToBook(found.book, uid, found.data.entries[uid]);
        }
        return sheet;
    })().finally(() => npcRuns.delete(subject));
    npcRuns.set(subject, work);
    return work;
}
