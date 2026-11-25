// Inline notes (B42). Text she wraps as [[OOC: plain words]] inside her own message is cut from the message
// before it is saved, and goes out once, for that reply, as a private direction that keeps its OOC: prefix.
// The delivery is B2's: each note is queued as a Private direction (src/quick-action-chat.js), so it shows in the
// queue, rides the request like any queued direction and is listed in the Sent card.
// The wrap helpers at the end serve the bar's three wrap buttons.
import { settings, saveSettings } from './store.js';
import { isOutOfCharacter } from './memory/capture.js';
import { bindQuickReply, queueCapability, queueDirections, quickChat } from './quick-action-chat.js';
import { ctx } from './st.js';

export const NOTES_KEY = 'riInlineNotes';
export const NOTE_TITLE = 'Inline note';

const MARKER = /\[\[[ \t]*OOC[ \t]*:([\s\S]*?)\]\]/gi;
// worldflow.js reads the newest player message with this pattern, wider than capture.js.
const ASIDE_START = /^[\s(\[<*]*OOC\b/i;
const looksAside = text => isOutOfCharacter(text) || ASIDE_START.test(String(text ?? ''));
const ZERO_WIDTH = '​';

export const INLINE_DEFAULTS = Object.freeze({ marker: true, ooc: true, italic: true, quote: true });

/** The saved settings of the marker and the three wrap buttons, with Off for each. */
export function inlineSettings() {
    const st = settings();
    const saved = st.inlineNotes && typeof st.inlineNotes === 'object' ? st.inlineNotes : {};
    const out = {};
    for (const [key, value] of Object.entries(INLINE_DEFAULTS)) out[key] = typeof saved[key] === 'boolean' ? saved[key] : value;
    return out;
}

export function saveInlineSettings(patch) {
    const st = settings();
    st.inlineNotes = { ...inlineSettings(), ...patch };
    saveSettings();
    return inlineSettings();
}

/** The wrap buttons in bar order. A button needs its own switch on; the OOC button also needs the marker on. */
export const WRAPS = Object.freeze([
    { id: 'ooc', open: '[[OOC: ', close: ']]', label: '[[OOC: ]]', icon: 'fa-note-sticky', ink: 'direction',
        name: 'Add a private note to this reply', help: 'Wraps the selection in [[OOC: ]]. The note is cut from your message and sent once, privately.' },
    { id: 'italic', open: '*', close: '*', label: '* *', icon: 'fa-italic', ink: 'reply',
        name: 'Wrap in asterisks for an action', help: 'Wraps the selection in * *.' },
    { id: 'quote', open: '"', close: '"', label: '" "', icon: 'fa-quote-left', ink: 'reply',
        name: 'Wrap in quotation marks for speech', help: 'Wraps the selection in " ".' },
]);

export function shownWraps(config = inlineSettings()) {
    return WRAPS.filter(wrap => config[wrap.id] && (wrap.id !== 'ooc' || config.marker));
}

// ---------- the marker ----------

function join(left, right) {
    const a = left.replace(/[ \t]+$/, ''), b = right.replace(/^[ \t]+/, '');
    if (!a || !b) return a + b;
    // A note on a line of its own leaves one line break, not two.
    if (/\n$/.test(a) && /^\r?\n/.test(b)) return a + b.replace(/^\r?\n/, '');
    if (/\n$/.test(a) || /^\r?\n/.test(b)) return a + b;
    // Closing punctuation stays against the word before it. Otherwise one space, so the words around the cut never fuse.
    return /^[.,;:!?)\]]/.test(b) ? a + b : a + ' ' + b;
}

/**
 * Pull every [[OOC: ...]] out of a message. `text` is the message without them and `notes` the private notes
 * in order, each beginning "OOC: ". An empty marker is removed and sends nothing. An unclosed marker is left alone.
 * A cleaned message never reads as an aside because of a cut marker (capture.js isOutOfCharacter, worldflow isOocTurn).
 */
export function extractInlineNotes(input) {
    const source = String(input ?? '');
    const notes = [], parts = [];
    let last = 0, found = false;
    for (const match of source.matchAll(MARKER)) {
        found = true;
        parts.push(source.slice(last, match.index));
        last = match.index + match[0].length;
        const inner = match[1].replace(/\s+/g, ' ').trim();
        if (inner) notes.push('OOC: ' + inner);
    }
    if (!found) return { text: source, notes: [], found: false, only: false };
    parts.push(source.slice(last));
    let text = parts[0];
    for (let i = 1; i < parts.length; i++) text = join(text, parts[i]);
    text = text.trim();
    if (text && looksAside(text)) {
        // Compare with the message where each cut marker is one neutral word: if that does not read as an aside, the cut did it.
        const neutral = parts.reduce((joined, part, i) => joined + (i ? '§' : '') + part, '');
        if (!looksAside(neutral.trim())) text = ZERO_WIDTH + text;
    }
    return { text, notes, found: true, only: !text };
}

// ---------- taking the notes as a message is sent ----------

let held = null;       // { notes, entry } waiting for the player message they belong to

const composer = () => globalThis.document?.querySelector('#send_textarea');

/** True when a marker would be taken: the setting is on, a chat is open and the host can deliver queued directions. */
export function inlineActive() {
    return !!(inlineSettings().marker && quickChat() && !queueCapability());
}

/** Types for which SillyTavern sends the message box as a player message. */
const sendsMessageBox = (type, opts) => (type === undefined || type === 'normal' || type === '') && !opts?.automatic_trigger
    && !opts?.quiet_prompt && !opts?.quietToLoud;

/** True when the message box holds only note markers: nothing of her own for the story. */
export function boxHoldsOnlyNotes(value = composer()?.value) {
    const found = extractInlineNotes(value);
    return found.found && found.only;
}

/**
 * The hook before generation. For a message send, cut the markers out of the message box and queue them as Private
 * directions; the queue binds them to the player message when it is added. For a swipe, regenerate or continue,
 * queue again the notes kept on the player message this reply answers.
 * Returns the notes queued.
 */
export function takeInlineNotes(generation, type, opts) {
    try {
        if (!inlineActive() || generation?.skip || generation?.memory) return [];
        if (sendsMessageBox(type, opts)) return takeFromBox();
        if (['swipe', 'regenerate', 'continue'].includes(String(type))) return replayNotes();
    } catch (error) {
        console.warn('[Roleplay Instructions] inline notes', error);
    }
    return [];
}

function takeFromBox() {
    held = null;
    const input = composer();
    if (!input) return [];
    const found = extractInlineNotes(input.value);
    // A box of markers only is refused before it is sent (src/ui/inline-direction.js). Anything that still reaches here is sent as typed.
    if (!found.found || found.only) return [];
    input.value = found.text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (!found.notes.length) return [];
    const entry = queueDirections(found.notes.map(text => ({ text, title: NOTE_TITLE })), '', { visibility: 'private', required: false });
    held = { notes: found.notes, entry: entry.id };
    return found.notes;
}

function replayNotes() {
    const chat = ctx().chat || [];
    let index = chat.length - 1;
    while (index >= 0 && !chat[index]?.is_user) index--;
    const player = chat[index];
    const notes = player?.extra?.[NOTES_KEY];
    // The notes belong to the reply right after the message that carried them.
    if (!Array.isArray(notes) || !notes.length || index !== chat.length - 2 && index !== chat.length - 1) return [];
    const state = quickChat();
    if (state.pending.some(entry => entry.rows?.some(row => notes.includes(row.text) && row.title === NOTE_TITLE))) return [];
    const entry = queueDirections(notes.map(text => ({ text, title: NOTE_TITLE })), '', { visibility: 'private', required: false });
    held = { notes, entry: entry.id, replay: index };
    return notes;
}

/**
 * The hook after the player message is added. Bind the queued notes to it the way every queued direction is bound,
 * and keep the notes on the message so a swipe of its reply sends them again. A later edit of the message text
 * cannot bring the marker back, because the text was cleaned before it was saved.
 */
export async function bindInlineNotes(generation, index) {
    const taken = held;
    if (!taken || taken.replay !== undefined) return;
    held = null;
    const message = ctx().chat?.[Number(index)];
    if (!message?.is_user) return;
    message.extra ||= {};
    message.extra[NOTES_KEY] = taken.notes.slice();
    await ctx().saveChat?.();
}

/** The hook for a swipe, regenerate or continue: bind the queued notes to the player message this reply answers. */
export async function bindReplayedNotes(generation) {
    const taken = held;
    if (!taken || taken.replay === undefined) return;
    held = null;
    const state = quickChat();
    if (!state || !generation) return;
    // startQuickReply only arms a plain send, so a swipe is armed here.
    generation.quickChat = state.owner;
    generation.quickDelivery = true;
    generation.inlineReplay = true;
    await bindQuickReply(generation, taken.replay, { rebind: true });
}

// ---------- the wrap buttons ----------

/**
 * Wrap the selection in a pair of marks, or insert the pair and put the cursor between them when nothing is selected.
 * With a selection the cursor ends after the closing mark.
 */
export function wrapSelection(value, start, end, wrap) {
    const text = String(value ?? '');
    const from = Math.max(0, Math.min(Number.isInteger(start) ? start : text.length, text.length));
    const to = Math.max(from, Math.min(Number.isInteger(end) ? end : from, text.length));
    const pair = typeof wrap === 'string' ? WRAPS.find(item => item.id === wrap) : wrap;
    if (!pair) return { value: text, start: from, end: to };
    const inner = text.slice(from, to);
    const next = text.slice(0, from) + pair.open + inner + pair.close + text.slice(to);
    const cursor = from === to ? from + pair.open.length : from + pair.open.length + inner.length + pair.close.length;
    return { value: next, start: cursor, end: cursor };
}

/** Apply a wrap to the message box: set its value, place the cursor and tell SillyTavern the text changed. */
export function applyWrap(wrap, input = composer()) {
    if (!input) return false;
    const result = wrapSelection(input.value, input.selectionStart, input.selectionEnd, wrap);
    input.value = result.value;
    input.focus({ preventScroll: true });
    input.setSelectionRange(result.start, result.end);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // SillyTavern's own input handler can re-set the cursor while it resizes the box; set it once more.
    input.setSelectionRange(result.start, result.end);
    return true;
}
