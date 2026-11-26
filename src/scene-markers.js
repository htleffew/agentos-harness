// B50: time skips and scene breaks act at once. When her message holds a "Time skip:" line, a "Scene:" line or a `***`
// break line, code acts before the request, each effect behind its own switch, all on by default:
//   clock    a stated amount moves the story clock forward; an amount that cannot be read marks the clock unknown
//            until capture reads the reply that follows;
//   chapter  the open memory chapter closes through the newest reply, with MB6's closeChapterHere;
//   due      Pending threads whose due time falls inside the gap are listed for capture to rule on.
// No model call of its own. The chapter close is MB6's own chapter write (the same call "Close the chapter here" makes).
// The clock lives on replies (v10Minutes, the record capture's minutesBefore and the request builder read), so a skip is
// added to the newest reply that has a clock, and the note of what happened is kept on the newest reply as v10SceneBreak.
import { settings, saveSettings, chatState } from './store.js';
import { ctx, KEY, toast } from './st.js';
import { sceneAt, sceneDateLabel } from './state.js';
import { advanceStoryClock } from './story-clock.js';

export const MARKER_DEFAULTS = Object.freeze({ clock: true, chapter: true, due: true });
const MAX_MINUTES = 5256000;      // the clock's own bound, ten years (story-clock.js validElapsed)
const CLOSE_WAIT_MS = 45000;      // a slow chapter write finishes in the background after this

/** The three switches, each on unless she turned it off. */
export function markerSettings() {
    const saved = settings().sceneMarkers && typeof settings().sceneMarkers === 'object' ? settings().sceneMarkers : {};
    return Object.fromEntries(Object.entries(MARKER_DEFAULTS).map(([key, value]) => [key, typeof saved[key] === 'boolean' ? saved[key] : value]));
}

export function saveMarkerSettings(patch) {
    settings().sceneMarkers = { ...markerSettings(), ...patch };
    saveSettings();
}

// ---------- reading the message ----------

const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    couple: 2, 'a couple of': 2, 'couple of': 2, few: 3, 'a few': 3, half: 0.5, 'half a': 0.5, 'half an': 0.5 };
const UNITS = { minute: 1, min: 1, hour: 60, hr: 60, day: 1440, night: 1440, week: 10080, fortnight: 20160, month: 43200, year: 525600 };
const AMOUNT = /(\d+(?:\.\d+)?|half an?|a couple of|a few|couple of|few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(minutes?|mins?|hours?|hrs?|days?|nights?|weeks?|fortnights?|months?|years?)\b/i;

/** The minutes a phrase such as "three days" or "half an hour" states, or null when it states no amount code can count. */
export function minutesOf(phrase) {
    const text = String(phrase ?? '').toLowerCase();
    const hit = AMOUNT.exec(text);
    if (!hit) {
        const next = /^\s*(?:the\s+)?next\s+(day|week|month|year)\b/.exec(text);
        return next ? UNITS[next[1]] : null;
    }
    const n = /^\d/.test(hit[1]) ? Number(hit[1]) : WORDS[hit[1].toLowerCase()];
    const unit = UNITS[hit[2].toLowerCase().replace(/s$/, '')];
    if (!Number.isFinite(n) || !unit) return null;
    const minutes = Math.round(n * unit);
    return minutes > 0 && minutes <= MAX_MINUTES ? minutes : null;
}

const SKIP_LINE = /^[\s*_>#\[(]*time\s*skip\s*[:\-]\s*(.*?)[\s*_\])]*$/i;
const SCENE_LINE = /^[\s*_>#\[(]*scene\s*:\s*(.*?)[\s*_\])]*$/i;
const RULE_LINE = /^(?:\*{3,}|\*\s+\*\s+\*(?:\s+\*)*)$/;
const QUOTES = /["“”]/g;

/**
 * What her message asks for. A marker line inside an open quotation, a code fence or a block quote line does not count.
 * Returns { found, skip: { text, minutes } | null, scene, rule }; minutes is null when the amount cannot be read.
 */
export function findMarkers(input) {
    const out = { found: false, skip: null, scene: false, rule: false };
    let quoteOpen = false, fenced = false;
    for (const raw of String(input ?? '').split(/\r?\n/)) {
        const line = raw.trim();
        if (/^(```|~~~)/.test(line)) { fenced = !fenced; continue; }
        const usable = !fenced && !quoteOpen && !line.startsWith('>');
        if (usable) {
            let hit;
            if ((hit = SKIP_LINE.exec(line))) { out.skip ||= { text: hit[1].trim(), minutes: minutesOf(hit[1]) }; out.found = true; }
            else if (SCENE_LINE.test(line)) { out.scene = true; out.found = true; }
            else if (RULE_LINE.test(line)) { out.rule = true; out.found = true; }
        }
        if ((line.match(QUOTES) || []).length % 2) quoteOpen = !quoteOpen;
    }
    return out;
}

// ---------- the clock ----------

const holdersOf = message => [message?.extra, message?.swipe_info?.[Number.isInteger(message?.swipe_id) ? message.swipe_id : 0]?.extra]
    .filter(holder => holder && typeof holder === 'object');
const isReplyMessage = message => !!message && !message.is_user && !message.is_system;

/** The index of the newest reply, and of the newest reply that carries a story minute. */
function newestReplies(chat) {
    let newest = -1, timed = -1;
    for (let i = chat.length - 1; i >= 0 && timed < 0; i--) {
        if (!isReplyMessage(chat[i])) continue;
        if (newest < 0) newest = i;
        if (Number.isSafeInteger(chat[i]?.extra?.[KEY]?.v10Minutes)) timed = i;
    }
    return { newest, timed };
}

const signatureOf = text => { let h = 0; for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) | 0; return String(h); };

/** The story minute now: the newest reply's clock, or the chat's starting clock. Null when none is known. */
export function clockNow(chat = ctx().chat || [], seed = chatState()?.v10ClockSeed) {
    const { timed } = newestReplies(chat);
    if (timed >= 0) return chat[timed].extra[KEY].v10Minutes;
    return Number.isSafeInteger(seed) ? seed : null;
}

/**
 * Move the clock forward. A number of minutes is added to the newest reply that has a clock (every holder capture writes:
 * the message and its showing swipe), or to the chat's starting clock when no reply has one. Without a clock to move, or with
 * minutes null, the clock is marked unknown on the newest reply. Returns { moved, from, to, unknown }.
 */
export function advanceClock(chat, minutes, state = chatState()) {
    const { timed } = newestReplies(chat);
    const from = clockNow(chat, state?.v10ClockSeed);
    if (minutes === null || from === null) return { moved: false, unknown: true, from, to: null };
    const to = Math.min(from + minutes, Number.MAX_SAFE_INTEGER);
    if (timed >= 0) for (const holder of holdersOf(chat[timed])) { if (holder[KEY] && Number.isSafeInteger(holder[KEY].v10Minutes)) holder[KEY].v10Minutes = to; }
    else state.v10ClockSeed = to;
    return { moved: true, unknown: false, from, to };
}

/**
 * The scene's date and time as the writer reads them (the Scene line of the request): move them by `minutes` with the story
 * clock's own calendar rules, and write the result on the newest reply (its saved scene and, when capture filed one, its tracker
 * scene, which is read after the saved one). Returns the new { date, time, label } or null when the scene states no date or time.
 */
export function advanceScene(chat, minutes) {
    const { newest } = newestReplies(chat);
    if (newest < 0 || minutes === null) return null;
    const before = sceneAt(Infinity, { overrides: false });
    if (!before.date && !before.time && !before.when && !before.lastKnownDate) return null;
    const moved = advanceStoryClock(before, {}, { elapsed: minutes }).scene;
    const label = [sceneDateLabel(moved), moved.time || moved.when].filter(Boolean).join(', ');
    if (!label) return null;
    for (const holder of holdersOf(chat[newest])) {
        const record = holder[KEY] ||= {};
        record.scene = { ...(record.scene || {}), date: moved.date || '', time: moved.time || '', when: moved.when || '',
            ...(moved.lastKnownDate ? { lastKnownDate: moved.lastKnownDate } : {}), ...(moved.daysAfterKnownDate ? { daysAfterKnownDate: moved.daysAfterKnownDate } : {}) };
        if (record.tracker?.scene && typeof record.tracker.scene === 'object') record.tracker.scene.time = { v: label, from: null };
    }
    return { date: moved.date, time: moved.time, label };
}

// ---------- Pending threads that fell due ----------

/**
 * Pending threads whose due time falls inside the gap. A due time is a story minute (a whole number) inside (from, from + skip],
 * or a stated span ("in two days", "tomorrow") no longer than the skip. With an unreadable skip every Pending thread that
 * states a due time is listed. Returns [{ id, text, due }].
 */
export function dueInGap(records, { from = null, minutes = null } = {}) {
    const out = [];
    for (const rec of records || []) {
        if (rec?.kind !== 'thread' || rec.threadType !== 'Pending' || ['done', 'failed', 'retired', 'replaced', 'merged'].includes(rec.status)) continue;
        const key = Object.keys(rec).find(name => /^due/.test(name) && rec[name] !== undefined && rec[name] !== '');
        if (!key) continue;
        const raw = String(rec[key]).trim();
        let falls;
        if (minutes === null) falls = true;
        else if (/^\d+$/.test(raw) && from !== null) falls = Number(raw) > from && Number(raw) <= from + minutes;
        else { const span = /^(?:in\s+)?(?:tomorrow|tonight)$/i.test(raw) ? 1440 : minutesOf(raw.replace(/^in\s+/i, '')); falls = span !== null && span <= minutes; }
        if (falls) out.push({ id: rec.id, text: String(rec.text || rec.subject || '').slice(0, 200), due: raw.slice(0, 120) });
    }
    return out;
}

/** What capture reads: the Pending threads a skip listed and no capture has ruled on yet. */
export function dueForCapture(chat = ctx().chat || []) {
    const { newest } = newestReplies(chat);
    const note = newest >= 0 ? chat[newest]?.extra?.[KEY]?.v10SceneBreak : null;
    return note && !note.ruled && Array.isArray(note.due) ? note.due.map(item => ({ ...item })) : [];
}

/** Capture ruled on the listed threads: they leave the list. */
export function markDueRuled(chat = ctx().chat || []) {
    const { newest } = newestReplies(chat);
    for (const holder of newest >= 0 ? holdersOf(chat[newest]) : []) if (holder[KEY]?.v10SceneBreak) holder[KEY].v10SceneBreak.ruled = true;
}

// ---------- the hook ----------

const composer = () => globalThis.document?.querySelector('#send_textarea');
/** Types for which SillyTavern sends the message box as a player message (as in inline-direction.js). */
const sendsMessageBox = (type, opts) => (type === undefined || type === 'normal' || type === '') && !opts?.automatic_trigger && !opts?.quiet_prompt && !opts?.quietToLoud;

/**
 * The hook before generation: read the message box, and act on a time skip, scene line or break. Returns what was done.
 * A promise the host waits on, so the chapter close finishes (or ten seconds' wait ends) before the request is built.
 */
export async function takeSceneMarkers(generation, type, opts, deps = {}) {
    try {
        if (generation?.skip || generation?.memory || !sendsMessageBox(type, opts)) return null;
        const found = findMarkers(composer()?.value);
        if (!found.found) return null;
        return await act(found, deps);
    } catch (error) {
        console.warn('[Roleplay Instructions] scene markers', error);
        return null;
    }
}

async function act(found, { chat = ctx().chat || [], text = composer()?.value, closeChapter, listPending } = {}) {
    const on = markerSettings();
    const { newest } = newestReplies(chat);
    if (newest < 0) return null;
    const did = { clock: null, chapter: false, due: [] };
    const note = chat[newest].extra?.[KEY]?.v10SceneBreak;
    const signature = signatureOf(text);
    // The same message sent again right after a send that never produced a reply must not move the clock twice.
    if (note?.signature === signature && newest === chat.length - 1 && note.at === chat.length) return did;
    const record = {};
    if (found.skip && on.clock) {
        did.clock = advanceClock(chat, found.skip.minutes);
        did.scene = advanceScene(chat, found.skip.minutes);
        Object.assign(record, { minutes: found.skip.minutes, text: found.skip.text, unknown: did.clock.unknown && !did.scene });
    }
    if (found.skip && on.due) {
        const pending = listPending ? await listPending() : await pendingRecords();
        did.due = dueInGap(pending, { from: did.clock?.from ?? clockNow(chat), minutes: found.skip.minutes });
        if (did.due.length) record.due = did.due;
    }
    if (Object.keys(record).length) {
        for (const holder of holdersOf(chat[newest])) { holder[KEY] ||= {}; holder[KEY].v10SceneBreak = { ...record, signature, at: chat.length }; }
        try { await ctx().saveChat?.(); } catch { /* saved with the next change */ }
    }
    if (on.chapter) did.chapter = await closeHere(closeChapter);
    return did;
}

async function pendingRecords() {
    try { return (await import('./chapters.js')).chapterState().result.current; } catch { return []; }
}

async function closeHere(closeChapter) {
    try {
        const close = closeChapter || (await import('./chapters.js')).closeChapterHere;
        const writing = Promise.resolve(close()).then(() => true);
        writing.catch(() => {});
        return await Promise.race([writing, new Promise(resolve => setTimeout(() => resolve(false), CLOSE_WAIT_MS))]);
    } catch (error) {
        // No open reply, a chapter already being written, or memory not in chat data: nothing to close here.
        console.warn('[Roleplay Instructions] scene break chapter', error?.message || error);
        if (/route|answered|stays open/i.test(String(error?.message))) toast('warning', `The chapter did not close: ${error.message}`);
        return false;
    }
}
