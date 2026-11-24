// The scene header (DESIGN.md 6.8): the model writes it as the first line of each reply, code reads it,
// and a chat whose replies miss it 3 times in the last 10 moves the header into the reply tray.
// This file imports nothing from v10.js or engine.js, so the request files (MB3) can import it freely.
import { ctx, isReply, on } from './st.js';
import { chatState, saveChatState, settings } from './store.js';

export const SCENE_SYMBOLS = Object.freeze({ place: '\u{25C6}', time: '\u{25F7}', weather: '\u{2248}', present: '\u{25CE}' });
export const FIELD_SEPARATOR = ' · ';
export const HEADER_WINDOW = 10;
export const HEADER_LIMIT = 3;
export const HEADER_MODES = Object.freeze({ reply: 'In the reply, with fallback', tray: 'In the tray' });
export const PROMPT_KEY = 'roleplay_instructions_scene_header';

const { place: P, time: T, weather: W, present: C } = SCENE_SYMBOLS;
export const SCENE_HEADER_EXAMPLE = `**${P} The Gilded Hound, taproom** · ${T} Day 3, Thursday, 21:40 · ${W} rain, cold · ${C} Hale, Marten`;

/** The instruction the chat request carries while the header lives in the reply. */
export function sceneHeaderInstruction() {
    return [
        'Begin the reply with one scene header line, then a blank line, then the prose. Write the header on a single line in this form:',
        `**${P} place** · ${T} story date and time · ${W} weather · ${C} who is present`,
        `Example: ${SCENE_HEADER_EXAMPLE}`,
        `The place comes first and in bold, the area and then the room. The story date and time follow. Add the weather and the names of the people present when the scene establishes them, and omit those fields otherwise. Separate the fields with a middle dot. Use the four symbols ${P} ${T} ${W} ${C} exactly as shown and plain text everywhere else in the line.`,
    ].join('\n');
}

// Any character with emoji presentation, or the emoji variation selector, makes the line a miss.
const EMOJI = /\p{Emoji_Presentation}|\u{FE0F}/u;
const BOLD_PLACE = new RegExp(`^\\*\\*\\s*${P}\\s*([^*]*?)\\s*\\*\\*`);
const FIELD_START = new RegExp(`^\\s*(?:·\\s*)?[${T}${W}${C}]`);

export const MISS_REASONS = Object.freeze({
    'multi-line': 'The header ran over more than one line.',
    'no-bold-place': 'The first line did not start with the place in bold.',
    'no-place': 'The header had no place.',
    'no-time': 'The header had no story date or time.',
    emoji: 'The header held an emoji.',
});

const firstLines = text => {
    const lines = String(text ?? '').split(/\r?\n/);
    const at = lines.findIndex(line => line.trim());
    return at < 0 ? [] : lines.slice(at);
};

function fieldsOf(line) {
    const bold = BOLD_PLACE.exec(line);
    const out = { place: bold ? bold[1].trim() : '', time: '', weather: '', present: [] };
    const rest = bold ? line.slice(bold[0].length) : line;
    for (const part of rest.split('·').map(piece => piece.trim()).filter(Boolean)) {
        const symbol = part[0];
        const value = part.slice(1).trim();
        if (symbol === T) out.time ||= value;
        else if (symbol === W) out.weather ||= value;
        else if (symbol === C) out.present = value.split(/\s*,\s*|\s+and\s+/).map(name => name.trim()).filter(Boolean);
    }
    return out;
}

/**
 * Check a reply's first non-empty line against the format of 6.8.
 * Returns { ok, reason, place, time, weather, present, line }.
 */
export function readSceneHeader(text) {
    const [line = '', next = ''] = firstLines(text);
    const fields = fieldsOf(line);
    const result = { ...fields, line: line.trim() };
    const opened = new RegExp(`^\\*\\*\\s*${P}`).test(line.trim());
    let reason = null;
    if ((opened && !BOLD_PLACE.test(line.trim())) || (next.trim() && FIELD_START.test(next))) reason = 'multi-line';
    else if (!BOLD_PLACE.test(line.trim())) reason = 'no-bold-place';
    else if (!fields.place) reason = 'no-place';
    else if (!fields.time) reason = 'no-time';
    else if (EMOJI.test(line)) reason = 'emoji';
    return { ok: !reason, reason, ...result };
}

/** The header fields of a valid first line, or null. */
export function parseSceneHeader(text) {
    const read = readSceneHeader(text);
    if (!read.ok) return null;
    const { place, time, weather, present } = read;
    return { place, time, weather, present };
}

// Per-chat record: results for the last 10 replies that were asked for the header, and the fallback once it trips.
export function headerState(cs = chatState()) {
    if (!cs) return null;
    const state = cs.sceneHeader && typeof cs.sceneHeader === 'object' ? cs.sceneHeader : (cs.sceneHeader = {});
    if (!Array.isArray(state.results)) state.results = [];
    return state;
}

/** Record whether reply `id` (on swipe `swipe`) carried a valid header; a swipe replaces its reply's earlier result. */
export function noteHeaderResult(state, { id, swipe = 0, reason = null }) {
    if (!state) return null;
    state.results = state.results.filter(row => row.id !== id).concat({ id, swipe, miss: reason || null })
        .sort((a, b) => a.id - b.id).slice(-HEADER_WINDOW);
    const misses = state.results.filter(row => row.miss).length;
    if (!state.fallback && misses >= HEADER_LIMIT) state.fallback = { misses, of: state.results.length, at: Date.now() };
    return state;
}

export const headerMisses = state => (state?.results || []).filter(row => row.miss).length;

/** "Try in the reply again": the line returns to the request and the count starts over. */
export function retryHeaderInReply(state) {
    if (!state) return null;
    state.results = [];
    delete state.fallback;
    return state;
}

export function headerSetting(st = settings()) {
    const value = st.tray?.sceneHeader;
    return Object.hasOwn(HEADER_MODES, value) ? value : 'reply';
}

/** Where the header lives for this chat: 'reply', or 'tray' by the setting or after the fallback tripped. */
export function headerMode(state = headerState(), st = settings()) {
    return headerSetting(st) === 'tray' || state?.fallback ? 'tray' : 'reply';
}

export function fallbackNote(state) {
    const fallback = state?.fallback;
    if (!fallback) return '';
    return `Scene header moved to the tray: ${fallback.misses} of the last ${HEADER_WINDOW} replies missed it`;
}

// Generation types whose reply opens with the header. Continue extends a reply that already has one.
const ASKING_TYPES = new Set(['normal', 'swipe', 'regenerate']);
const wiring = { active: () => false, changed: () => {}, type: 'normal', asked: null, mounted: false };

/** Whether the next reply request carries the instruction. */
export function headerRequested(type = wiring.type) {
    return ASKING_TYPES.has(type) && !!wiring.active() && headerMode() === 'reply';
}

function placePrompt() {
    // One system line near the end of the chat (in-chat, depth 1). SillyTavern 1.19 passes in-chat prompts through
    // Array.filter with an async filter, which keeps every prompt, so the value itself is emptied when not requested.
    const value = headerRequested() ? sceneHeaderInstruction() : '';
    try { ctx().setExtensionPrompt?.(PROMPT_KEY, value, 1, 1, false, 0, () => headerRequested()); }
    catch { /* the host has no extension prompts; the header stays unrequested */ }
}

/** Mark a reply's result after it arrives, when its request asked for the header. */
export function judgeReply(id) {
    const asked = wiring.asked;
    wiring.asked = null;
    const message = ctx().chat?.[id];
    if (!asked || !isReply(message) || asked.chat !== String(ctx().getCurrentChatId?.() || '')) return null;
    const state = headerState();
    const before = !!state?.fallback;
    const read = readSceneHeader(message.mes);
    noteHeaderResult(state, { id: Number(id), swipe: Number(message.swipe_id || 0), reason: read.reason });
    saveChatState();
    placePrompt();
    wiring.changed({ id: Number(id), read, tripped: !before && !!state.fallback });
    return read;
}

/** Wire the instruction into the chat request. `active` says whether this chat uses the header at all. */
export function mountSceneHeader({ active, changed } = {}) {
    if (typeof active === 'function') wiring.active = active;
    if (typeof changed === 'function') wiring.changed = changed;
    placePrompt();
    if (wiring.mounted) return;
    wiring.mounted = true;
    on('GENERATION_STARTED', (type, options, dryRun) => {
        if (dryRun) return;
        wiring.type = options?.quiet_prompt ? 'quiet' : String(type || 'normal');
        placePrompt();
        wiring.asked = headerRequested() ? { chat: String(ctx().getCurrentChatId?.() || ''), type: wiring.type } : null;
    });
    on('MESSAGE_RECEIVED', id => { try { judgeReply(Number(id)); } catch (error) { console.warn('[Roleplay Instructions] scene header', error); } });
    for (const name of ['GENERATION_STOPPED', 'CHAT_CHANGED']) on(name, () => { wiring.asked = null; placePrompt(); });
}

/** Undo the fallback for this chat and tell the tray. */
export function tryHeaderInReplyAgain() {
    retryHeaderInReply(headerState());
    saveChatState();
    placePrompt();
    wiring.changed({ retried: true });
}

/** Save the Setup, Look choice. */
export function setHeaderSetting(value) {
    if (!Object.hasOwn(HEADER_MODES, value)) return;
    const st = settings();
    st.tray = { ...(st.tray || {}), sceneHeader: value };
    try { ctx().saveSettingsDebounced?.(); } catch { /* saved with the next change */ }
    placePrompt();
    wiring.changed({ setting: value });
}
