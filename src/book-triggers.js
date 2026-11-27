import { ctx, sub } from './st.js';
import { separateReply } from './reply-format.js';
import { settings, saveSettings } from './store.js';

export const BOOK_TRIGGER_SOURCES = {
    chat: 'SillyTavern’s recent chat scan',
    user: 'Latest user message',
    assistant: 'Previous model reply',
};

export const bookTriggerSource = entry => ['user', 'assistant'].includes(entry.extensions?.riTriggerSource)
    ? entry.extensions.riTriggerSource : 'chat';

export function scopedTriggerTexts(chat, type) {
    const excluded = ['swipe', 'regenerate', 'continue'].includes(type) && !chat.at(-1)?.is_user;
    const input = excluded ? chat.slice(0, -1) : chat;
    const last = role => input.findLast(message => !message.is_system && !!message.is_user === (role === 'user') && message.mes);
    const output = separateReply(last('assistant')?.mes || '').text
        .replace(/<(story_update|sent_instructions|think|thinking|analysis)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
    return { user: last('user')?.mes || '', assistant: output };
}

export function reusableKeywordMatch(entry, text) {
    if (!text) return false;
    const match = raw => {
        const key = sub(raw).trim();
        if (!key) return false;
        const regex = /^\/(.+)\/([gimsuy]*)$/.exec(key);
        if (regex) {
            try { return new RegExp(regex[1], regex[2]).test(text); } catch { /* treat invalid regex as literal */ }
        }
        const needle = entry.caseSensitive ? key : key.toLowerCase();
        const haystack = entry.caseSensitive ? text : text.toLowerCase();
        if (entry.matchWholeWords === false || /\s/.test(needle)) return haystack.includes(needle);
        const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, 'u').test(haystack);
    };
    if (!entry.key?.some(match)) return false;
    if (!entry.selective || !entry.keysecondary?.length) return true;
    const hits = entry.keysecondary.map(match);
    return [hits.some(Boolean), hits.some(hit => !hit), hits.every(hit => !hit), hits.every(Boolean)][entry.selectiveLogic || 0];
}

// A stable macro key lets the host own probability, sticky/cooldown and prompt budgets.
const registered = new Map();
export function beginBookTriggers() {
    for (const state of registered.values()) state.match = false;
}

export function scopedBookEntry(entry, texts) {
    const source = bookTriggerSource(entry);
    if (source === 'chat' || entry.constant || entry.disable) return entry;
    const c = ctx();
    if (!c.registerMacro) return { ...entry, disable: true };
    const id = Array.from(new TextEncoder().encode(JSON.stringify([entry.world, entry.uid])), n => n.toString(16).padStart(2, '0')).join('');
    const name = `ri_book_trigger_${id}`;
    let state = registered.get(name);
    if (!state) {
        state = { match: false };
        c.registerMacro(name, () => state.match ? '/^/' : '');
        registered.set(name, state);
    }
    state.match = reusableKeywordMatch(entry, texts[source]);
    return { ...entry, comment: entry.comment || entry.key?.[0] || `Entry ${entry.uid}`,
        key: [`{{${name}}}`], keysecondary: [], selective: false, scanDepth: 1 };
}

// ---------------------------------------------------------------- books Recall manages (memory DESIGN 4.1, 4.2 step 2)
//
// SillyTavern's own scan keeps deciding which keyword entries of a managed book fire, with Optional Filters and groups
// intact. The extension takes the fired entries out of the host's request (the host skips an entry with no content), and
// sends them in the recall block at depth 1 within their own token share. Constant entries stay with the host. An entry
// that uses chance, an inclusion group or a timing field belongs to a behavior book (7.6): it keeps its place in the host's
// request even when its book is switched to Recall, and it is never indexed for meaning search.

// recall also holds values, booster and sceneLine, so it can exist without books; a missing books made every recall turn throw.
const recallSettings = () => ((settings().recall ||= {}).books ||= {});

/** True when this book is switched to "Recall manages this book". */
export const isRecallManaged = name => !!name && recallSettings()[name] === true;

export function setRecallManages(name, on) {
    if (!name) return false;
    recallSettings()[name] = !!on;
    saveSettings();
    return !!on;
}

/** The carry-over book that Continue in a new chat makes starts with the switch on (8.3). */
export const markCarryOverBook = name => setRecallManages(name, true);

const positive = value => Number.isFinite(Number(value)) && Number(value) > 0;

/** True when the entry rolls a chance, belongs to an inclusion group or carries a timing field. */
export function entryIsBehavior(entry) {
    if (!entry) return false;
    const rolls = entry.useProbability !== false && Number.isFinite(Number(entry.probability)) && Number(entry.probability) < 100;
    return rolls || !!String(entry.group ?? '').trim() || positive(entry.sticky) || positive(entry.cooldown) || positive(entry.delay);
}
/** True when the entry uses Optional Filters (secondary keys with a logic choice). */
export const entryHasFilters = entry => !!entry?.selective && Array.isArray(entry.keysecondary) && entry.keysecondary.some(key => String(key ?? '').trim());

/** What a book uses, counted over its entries. */
export function bookTraits(entries) {
    const list = (Array.isArray(entries) ? entries : Object.values(entries || {})).filter(Boolean);
    const traits = { entries: list.length, constant: 0, behavior: 0, filters: 0, groups: 0, chance: 0, timing: 0 };
    for (const entry of list) {
        if (entry.constant) traits.constant += 1;
        if (entryIsBehavior(entry)) traits.behavior += 1;
        if (entryHasFilters(entry)) traits.filters += 1;
        if (String(entry.group ?? '').trim()) traits.groups += 1;
        if (entry.useProbability !== false && Number(entry.probability) < 100) traits.chance += 1;
        if (positive(entry.sticky) || positive(entry.cooldown) || positive(entry.delay)) traits.timing += 1;
    }
    return traits;
}

/**
 * Whether "Recall manages this book" is offered by default for a book: only for a book with no filters, no inclusion groups,
 * no chance and no timing fields. A book that uses them can still be switched on by hand; its behavior entries stay with
 * the host.
 */
export function recallOffered(entries) {
    const traits = bookTraits(entries);
    const kind = traits.behavior ? 'behavior' : traits.filters ? 'filtered' : 'reference';
    return { kind, offered: kind === 'reference', traits };
}

/** An entry Recall may index and move: it is not constant, not disabled, not a behavior entry, and has content. */
export const entryIsManaged = entry => !!entry && !entry.constant && !entry.disable && !entryIsBehavior(entry) && !!String(entry.content ?? '').trim();

/**
 * Called on each pass of the host's scan with the entries it has activated (a Map keyed by book and uid). For each
 * activated entry of a managed book that Recall may move, it records the entry and empties its content on the host's copy,
 * so the host leaves it out of the request. Returns the entries taken in this call; `taken` collects them across passes.
 */
export function takeFiredEntries(activated, { isManaged, taken = new Map() } = {}) {
    const fresh = [];
    const values = activated instanceof Map ? [...activated.values()] : Array.isArray(activated) ? activated : [...(activated || [])];
    for (const entry of values) {
        if (!entry || !isManaged?.(entry.world) || !entryIsManaged(entry)) continue;
        const key = `${entry.world}.${entry.uid}`;
        if (!taken.has(key)) {
            const taking = { book: entry.world, uid: String(entry.uid), title: entry.comment || (Array.isArray(entry.key) ? entry.key[0] : '') || `Entry ${entry.uid}`, content: String(entry.content) };
            taken.set(key, taking);
            fresh.push(taking);
        }
        entry.content = '';
    }
    return fresh;
}
