// Story rules (B41, audit A13 rec. 2). A short list of rules per chat or per story event set, each one sentence built from
// pickers: When [a condition] then [an effect], [once | each time it becomes true | at most every N replies]. Code checks
// the rules after each capture commit (to show what the next reply will carry) and before each reply (to decide); nothing
// calls a model.
//
// Conditions read what capture already stored on the replies of the showing swipes:
//   field    a card field of a subject (an emotion axis, a relationship level, a faculty) is at least or at most a number
//   step     an emotion axis or a relationship level moved by a step of B40 (-5 to +5) in the newest captured reply
//   due      a Pending thread is due within a story time (its due time read against the story clock)
//   replies  the reply being written is reply N or later
// Effects:
//   direction  a private direction with her words goes with the reply being written
//   add        an event item joins the pool of its set's next story event roll (once that set rolls, it is held again)
//   available  an event item joins the pool from now on
// An item a rule names for "add" or "available" stays out of rolls until the rule fires (the hook in pacing.js itemFits).
// No effect switches a preset block or a World Info entry.
//
// A firing is stored with the reply, per swipe, as fired World Info entries are (src/memory/fired-entries.js): in
// message.extra.ri_rules and in the matching swipe_info slot, with the state of every rule's condition at that reply. A
// swipe away, a delete or a branch cut before the reply takes the firing back, so a once-only rule can fire again, and
// "each time it becomes true" reads the state stored on the reply before.
import { ctx, KEY, LOG, isReply, on } from './st.js';
import { chatState, saveChatState, settings, saveSettings } from './store.js';
import { fold, swipeOf } from './memory/fold.js';

export const RULES = 'ri_rules';
export const PROMPT_KEY = 'ri_story_rules';
export const STEP_MIN = -5;
export const STEP_MAX = 5;
const PER_SUBJECT = new Set(['emotions', 'relationships', 'characters']);

/** The numbers a condition can read: card fields with a value from 0 to 10, and the faculties capture writes whole. */
export const NUMBERS = Object.freeze([
    { id: 'emotions.axes.tenderness', card: 'emotions', field: 'axes', axis: 'tenderness', label: 'Tenderness', steps: true, max: 10 },
    { id: 'emotions.axes.fury', card: 'emotions', field: 'axes', axis: 'fury', label: 'Fury', steps: true, max: 10 },
    { id: 'emotions.axes.dread', card: 'emotions', field: 'axes', axis: 'dread', label: 'Dread', steps: true, max: 10 },
    { id: 'emotions.axes.yearning', card: 'emotions', field: 'axes', axis: 'yearning', label: 'Yearning', steps: true, max: 10 },
    { id: 'relationships.level', card: 'relationships', field: 'level', label: 'Relationship level', steps: true, max: 10 },
    { id: 'characters.ego', card: 'characters', field: 'ego', label: 'Ego', steps: false, max: 20 },
    { id: 'characters.nerve', card: 'characters', field: 'nerve', label: 'Nerve', steps: false, max: 20 },
    { id: 'characters.faculty_body', card: 'characters', field: 'faculty_body', label: 'Body (faculty)', steps: false, max: 20 },
    { id: 'characters.faculty_psyche', card: 'characters', field: 'faculty_psyche', label: 'Psyche (faculty)', steps: false, max: 20 },
]);
export const numberById = id => NUMBERS.find(n => n.id === id) || null;

export const CONDITIONS = Object.freeze({
    field: 'A card value vs a number',
    step: 'A card value moves',
    due: 'A Pending thread falls due',
    replies: 'The reply count',
});
export const EFFECTS = Object.freeze({
    direction: 'Private direction',
    add: 'Item in the next event roll',
    available: 'Event item available',
});
export const REPEATS = Object.freeze({
    once: 'Once in this chat',
    rises: 'Each time it becomes true',
    every: 'At most every N replies',
});
export const UNITS = Object.freeze({ minutes: 1, hours: 60, days: 1440 });

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const whole = (n, min, max, fallback) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; };
const fold1 = t => clean(t).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const newId = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- the rule as data (pure)

/** A rule as stored: every value read through a picker's range, so a hand-edited or older rule still evaluates. */
export function normalRule(r = {}) {
    const w = r.when || {};
    const kind = CONDITIONS[w.kind] ? w.kind : 'field';
    const number = numberById(w.number) || NUMBERS[0];
    const when = { kind };
    if (kind === 'field' || kind === 'step') {
        when.number = kind === 'step' && !number.steps ? NUMBERS[0].id : number.id;
        when.subject = clean(w.subject).slice(0, 80);
    }
    if (kind === 'field') { when.op = w.op === 'atMost' ? 'atMost' : 'atLeast'; when.value = whole(w.value, 0, number.max, 7); }
    if (kind === 'step') { const v = whole(w.value, STEP_MIN, STEP_MAX, 2); when.value = v === 0 ? 1 : v; }
    if (kind === 'due') { when.amount = whole(w.amount, 1, 999, 1); when.unit = UNITS[w.unit] ? w.unit : 'hours'; }
    if (kind === 'replies') when.value = whole(w.value, 1, 9999, 10);
    const t = r.then || {};
    const effect = EFFECTS[t.kind] ? t.kind : 'direction';
    const then = { kind: effect };
    if (effect === 'direction') then.text = String(t.text ?? '').trim().slice(0, 600);
    else Object.assign(then, { set: String(t.set || ''), cat: String(t.cat || ''), item: String(t.item || ''), label: clean(t.label).slice(0, 160) });
    const p = r.repeat || {};
    const repeat = { kind: REPEATS[p.kind] ? p.kind : 'once' };
    if (repeat.kind === 'every') repeat.every = whole(p.every, 1, 999, 5);
    return { id: String(r.id || newId()), on: r.on !== false, when, then, repeat };
}

/** A blank rule, as the Add rule button makes it. */
export const blankRule = () => normalRule({});

const subjectWords = (subject, number) => {
    if (number.card === 'relationships') return subject ? `the relationship level of ${subject}` : 'any relationship level';
    return subject ? `${subject}'s ${number.label.toLowerCase()}` : `anyone's ${number.label.toLowerCase()}`;
};

/** The condition in words: "When Marla's fury is at least 7". */
export function whenWords(rule) {
    const w = normalRule(rule).when;
    if (w.kind === 'replies') return `When the reply count reaches ${w.value}`;
    if (w.kind === 'due') return `When a Pending thread is due within ${plural(w.amount, w.unit.replace(/s$/, ''))} of story time`;
    const number = numberById(w.number);
    const who = subjectWords(w.subject, number);
    if (w.kind === 'step') return `When ${who} ${w.value > 0 ? 'rises' : 'falls'} by ${Math.abs(w.value)} or more in one reply`;
    return `When ${who} is ${w.op === 'atMost' ? 'at most' : 'at least'} ${w.value}`;
}

/** The effect in words. */
export function thenWords(rule) {
    const t = normalRule(rule).then;
    if (t.kind === 'direction') return `send the private direction "${t.text || '(no wording yet)'}"`;
    const item = t.label ? `"${t.label}"` : 'an event item';
    return t.kind === 'add' ? `add ${item} to the next story event roll` : `make ${item} available`;
}

export function repeatWords(rule) {
    const p = normalRule(rule).repeat;
    if (p.kind === 'every') return `at most every ${plural(p.every, 'reply', 'replies')}`;
    return p.kind === 'rises' ? 'each time it becomes true' : 'once in this chat';
}

/** The whole rule as one sentence. */
export const ruleSentence = rule => `${whenWords(rule)}, ${thenWords(rule)}, ${repeatWords(rule)}.`;

/** Event item ids a rule holds out of rolls until it fires. */
export const heldIds = rules => new Set((rules || []).map(normalRule).filter(r => r.on && r.then.kind !== 'direction' && r.then.item).map(r => r.then.item));

// ---------------------------------------------------------------- what the chat holds (pure)

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const plain = raw => (isObject(raw) && Object.hasOwn(raw, 'v') ? raw.v : raw);
const finite = raw => { const v = plain(raw); if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** The stored firing of a message's showing swipe, or null (a value copied from another swipe does not count). */
export function rulesOf(message) {
    const value = message?.extra?.[RULES];
    if (!isObject(value) || value.swipe !== swipeOf(message)) return null;
    return { fired: Array.isArray(value.fired) ? value.fired : [], states: isObject(value.states) ? value.states : {} };
}

/** Store a firing on a message's showing swipe: in extra and in the matching swipe_info slot. */
export function storeRules(message, { fired = [], states = {} } = {}) {
    if (!message) return null;
    const value = { swipe: swipeOf(message), fired: structuredClone(fired), states: { ...states } };
    if (!isObject(message.extra)) message.extra = {};
    message.extra[RULES] = value;
    const info = Array.isArray(message.swipe_info) ? message.swipe_info[value.swipe] : null;
    if (isObject(info)) {
        if (!isObject(info.extra)) info.extra = {};
        info.extra[RULES] = structuredClone(value);
    }
    return value;
}

/** The end of the chat a reply is being written after: a swipe or regenerate replaces the last reply, so it is left out. */
export function endFor(chat, type) {
    const list = chat || [];
    const last = list.length - 1;
    return ['swipe', 'regenerate'].includes(type) && last > 0 && isReply(list[last]) ? last : list.length;
}

/** The number of replies before `end`. */
const repliesBefore = (chat, end) => (chat || []).slice(0, end).filter((m, i) => i > 0 && isReply(m)).length;

/** The newest reply before `end` whose showing swipe carries tracker values, as { index, tracker }. */
export function trackerBefore(chat, end) {
    for (let i = Math.min(end, (chat || []).length) - 1; i > 0; i--) {
        const tracker = chat[i]?.extra?.[KEY]?.tracker;
        if (isReply(chat[i]) && isObject(tracker) && Object.keys(tracker).length) return { index: i, tracker };
    }
    return null;
}

/** The subjects of one number in a tracker: [{ name, value, step }]. */
export function readings(tracker, number) {
    const raw = tracker?.[number.card];
    const items = Array.isArray(raw) ? raw : isObject(raw) ? [raw] : [];
    const out = [];
    for (const item of items) {
        if (!isObject(item)) continue;
        const name = PER_SUBJECT.has(number.card) ? clean(plain(item.name) ?? item.pair) : '';
        const cell = plain(item[number.field]);
        const value = number.axis ? finite(isObject(cell) ? cell[number.axis] : null) : finite(cell);
        const moved = item[`${number.field}_steps`];
        const stepRaw = number.axis ? moved?.[number.axis]?.step : moved?.step;
        const step = finite(stepRaw);
        if (value !== null || step !== null) out.push({ name, value, step: step === null ? 0 : step });
    }
    return out;
}

/** Names seen for a card in the chat's newest tracker values, for the subject picker. */
export function subjectsSeen(chat, card) {
    const seen = new Map();
    for (let i = (chat || []).length - 1; i > 0 && seen.size < 30; i--) {
        const raw = chat[i]?.extra?.[KEY]?.tracker?.[card];
        for (const item of Array.isArray(raw) ? raw : []) { const n = clean(plain(item?.name)); if (n && !seen.has(fold1(n))) seen.set(fold1(n), n); }
    }
    return [...seen.values()];
}

// ---- story time: when a Pending thread is due

const DAY = 1440;
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, couple: 2, few: 3 };
const PARTS = { dawn: 6 * 60, sunrise: 6 * 60, morning: 8 * 60, noon: 12 * 60, midday: 12 * 60, afternoon: 15 * 60, dusk: 18 * 60, sunset: 18 * 60, evening: 19 * 60, tonight: 21 * 60, night: 21 * 60, midnight: 24 * 60 };
const UNIT_MIN = { minute: 1, min: 1, hour: 60, hr: 60, day: DAY, week: 7 * DAY };

/** Minutes after midnight of a clock time such as "21:40" or "9 PM", or null. */
export function clockOf(text) {
    const m = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?|\b(\d{1,2}):(\d{2})\b/i.exec(String(text || ''));
    if (!m) return null;
    if (m[4] !== undefined) { const h = Number(m[4]), min = Number(m[5]); return h < 24 && min < 60 ? h * 60 + min : null; }
    const h = Number(m[1]), min = Number(m[2] || 0);
    if (h < 1 || h > 12 || min > 59) return null;
    return (h % 12 + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + min;
}

/**
 * The story minute a due time names, read against the minute it was filed at and the clock time of that reply, or null
 * when the words name no time code can place. Reads "in two hours", "3 days from now", "tomorrow", "next week", "at
 * dawn", "tomorrow at 9 PM" and "21:00".
 */
export function dueMinute(text, { filed, clock = null } = {}) {
    const s = String(text ?? '').toLowerCase();
    if (!Number.isSafeInteger(filed)) return null;
    const n = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|half an?)';
    const rel = new RegExp(`\\b(?:in|within)\\s+(?:a\\s+)?${n}\\s+(?:of\\s+)?(minute|min|hour|hr|day|week)s?\\b|\\b${n}\\s+(minute|min|hour|hr|day|week)s?\\s+(?:from now|later|away|hence)\\b`).exec(s);
    if (rel) {
        const word = rel[1] || rel[3];
        const unit = UNIT_MIN[rel[2] || rel[4]];
        const count = /^half/.test(word) ? 0.5 : /^\d+$/.test(word) ? Number(word) : WORDS[word] ?? 1;
        return filed + Math.round(count * unit);
    }
    const days = /\bday after tomorrow\b/.test(s) ? 2 : /\btomorrow\b/.test(s) ? 1 : /\bnext week\b/.test(s) ? 7 : 0;
    const part = Object.keys(PARTS).find(k => new RegExp(`\\b${k}\\b`).test(s));
    const at = clockOf(s) ?? (part ? PARTS[part] % DAY : null);
    if (at !== null && Number.isInteger(clock)) {
        let delta = (at - clock + DAY) % DAY + days * DAY;
        if (!days && delta === 0) delta = DAY;
        return filed + delta;
    }
    if (days) return filed + days * DAY;
    return null;
}

/** The story minute of the newest reply before `end`, or null. */
export function minuteBefore(chat, end) {
    for (let i = Math.min(end, (chat || []).length) - 1; i > 0; i--) {
        const v = chat[i]?.extra?.[KEY]?.v10Minutes;
        if (isReply(chat[i]) && Number.isSafeInteger(v)) return v;
    }
    return null;
}

const OPEN = new Set(['current', 'open']);
/** The Pending threads in force before `end`, each with the story minute it is due: [{ id, text, due }]. */
export function pendingThreads(chat, meta, end) {
    let records = [];
    try { records = fold(chat || [], meta || {}, { before: end, cache: false }).current || []; } catch (error) { console.warn(LOG, 'story rules threads', error); }
    const out = [];
    for (const r of records) {
        if (r?.kind !== 'thread' || r.threadType !== 'Pending' || !OPEN.has(r.status || 'current') || r.paused) continue;
        const index = (r.versions || []).map(v => v.index).find(Number.isInteger);
        const filedAt = Number.isInteger(index) ? chat[index] : null;
        const filed = Number.isSafeInteger(filedAt?.extra?.[KEY]?.v10Minutes) ? filedAt.extra[KEY].v10Minutes : minuteBefore(chat, (index ?? end) + 1);
        const clock = clockOf(plain(filedAt?.extra?.[KEY]?.tracker?.scene?.time) || filedAt?.extra?.[KEY]?.scene?.time || '');
        const due = Number.isSafeInteger(r.due) ? r.due : dueMinute([r.story_time, r.due, r.when].filter(x => typeof x === 'string').join(' '), { filed, clock });
        if (due !== null) out.push({ id: r.id, text: clean(r.subject || r.text).slice(0, 120), due });
    }
    return out;
}

/**
 * Everything the conditions read for the reply that is about to be written after chat[0..end):
 * { reply, tracker, minute, threads }.
 */
export function ruleView(chat, meta, end) {
    const latest = trackerBefore(chat, end);
    return { reply: repliesBefore(chat, end) + 1, tracker: latest?.tracker || null, trackerIndex: latest?.index ?? null, minute: minuteBefore(chat, end), threads: pendingThreads(chat, meta, end) };
}

// ---------------------------------------------------------------- checking (pure)

const fmtTime = minutes => (minutes < 60 ? plural(minutes, 'minute') : minutes < DAY ? plural(Math.round(minutes / 60), 'hour') : plural(Math.round(minutes / DAY), 'day'));

/** Whether a condition holds for a view, as { met, why }: why names the value that met it, in words. */
export function checkCondition(rule, view) {
    const w = normalRule(rule).when;
    if (w.kind === 'replies') return { met: view.reply >= w.value, why: `this is reply ${view.reply}` };
    if (w.kind === 'due') {
        if (!Number.isSafeInteger(view.minute)) return { met: false, why: 'the story clock has no time yet' };
        const limit = w.amount * UNITS[w.unit];
        const hit = (view.threads || []).filter(t => t.due - view.minute <= limit).sort((a, b) => a.due - b.due)[0];
        if (!hit) return { met: false, why: '' };
        const left = hit.due - view.minute;
        return { met: true, why: `"${hit.text}" is ${left <= 0 ? 'due now' : `due in ${fmtTime(left)}`}` };
    }
    const number = numberById(w.number);
    const list = readings(view.tracker, number).filter(x => !w.subject || fold1(x.name) === fold1(w.subject));
    for (const x of list) {
        const who = number.card === 'relationships' ? (x.name || 'the pair') : x.name ? `${x.name}'s ${number.label.toLowerCase()}` : number.label;
        if (w.kind === 'step') {
            if (w.value > 0 ? x.step >= w.value : x.step <= w.value) return { met: true, why: `${who} moved ${x.step > 0 ? '+' : ''}${x.step}${x.value !== null ? ` to ${x.value}` : ''}` };
        } else if (x.value !== null && (w.op === 'atMost' ? x.value <= w.value : x.value >= w.value)) {
            return { met: true, why: `${who} is ${x.value}` };
        }
    }
    return { met: false, why: '' };
}

/** The replies before `end` with their stored firing and reply number, newest first: [{ index, reply, fired, states }]. */
function storedBefore(chat, end) {
    const out = [];
    let n = 0;
    const numbers = new Map();
    (chat || []).slice(0, end).forEach((m, i) => { if (i > 0 && isReply(m)) numbers.set(i, ++n); });
    for (let i = Math.min(end, (chat || []).length) - 1; i > 0; i--) {
        const v = isReply(chat[i]) ? rulesOf(chat[i]) : null;
        if (v) out.push({ index: i, reply: numbers.get(i), ...v });
    }
    return out;
}

/**
 * Decide which rules fire with the reply about to be written after chat[0..end). Returns { fired, states }: fired is the
 * list stored with the reply, states every rule's condition at this reply (what "becomes true" reads next time).
 *   once   fires when the condition holds and no reply in the chat shows it fired
 *   rises  fires when the condition holds and the reply before stored it as false; a rule with no stored state waits
 *          until its condition has been false once
 *   every  fires when the condition holds and it last fired at least N replies before this one
 */
export function decide(rules, view, chat, end) {
    const stored = storedBefore(chat, end);
    const fired = [];
    const states = {};
    for (const rule of (rules || []).map(normalRule)) {
        if (!rule.on) continue;
        const { met, why } = checkCondition(rule, view);
        states[rule.id] = met;
        if (!met) continue;
        const last = stored.find(s => s.fired.some(f => f.id === rule.id));
        if (rule.repeat.kind === 'once' && last) continue;
        if (rule.repeat.kind === 'rises') {
            const prev = stored.find(s => Object.hasOwn(s.states, rule.id));
            if (!prev || prev.states[rule.id] !== false) continue;
        }
        if (rule.repeat.kind === 'every' && last && view.reply - last.reply < rule.repeat.every) continue;
        fired.push({ id: rule.id, when: whenWords(rule), why, then: structuredClone(rule.then), repeat: repeatWords(rule), at: view.reply });
    }
    return { fired, states };
}

/**
 * The event items rules have let into rolls for the reply after chat[0..end): every "available" firing still in the chat,
 * every "add" firing whose set has not rolled since, and the firings `pending` for the reply being written.
 * A roll is seen on a reply's record: an item whose roll lists the item's category.
 */
export function grantsFrom(chat, end, pending = []) {
    const out = new Set();
    const rolledCat = (i, cat) => (chat[i]?.extra?.[KEY]?.items || []).some(it => (it?.roll?.cats || []).some(c => c?.id === cat));
    for (const s of storedBefore(chat, end)) for (const f of s.fired) {
        if (!f?.then?.item) continue;
        if (f.then.kind === 'available') out.add(f.then.item);
        if (f.then.kind === 'add') {
            let used = false;
            for (let i = s.index; i < end && !used; i++) if (isReply(chat[i]) && rolledCat(i, f.then.cat)) used = true;
            if (!used) out.add(f.then.item);
        }
    }
    for (const f of pending) if (f?.then?.item && f.then.kind !== 'direction') out.add(f.then.item);
    return out;
}

/** The private direction text for a list of firings, or '' when none sends one. */
export function directionText(fired) {
    const lines = (fired || []).filter(f => f?.then?.kind === 'direction' && clean(f.then.text)).map(f => `- ${clean(f.then.text)}`);
    return lines.length ? ['Story rule directions for this reply. Work them into the story through what the characters say and do:', ...lines].join('\n') : '';
}

/** One line per firing, for the Sent card: the condition in words, what met it, and what it did. */
export function firedLines(fired) {
    return (fired || []).map(f => `${f.when} (${f.why || 'condition met'}): ${thenWords({ then: f.then })}, ${f.repeat}.`);
}

// ---------------------------------------------------------------- where the rules are kept

/** This chat's own rules. */
export function chatRules() {
    const cs = chatState();
    if (!cs) return [];
    if (!Array.isArray(cs.storyRules)) cs.storyRules = [];
    return cs.storyRules;
}
/** The rules kept with story event sets, by set id. */
export function setRules() {
    const st = settings();
    if (!isObject(st.storyRules)) st.storyRules = {};
    return st.storyRules;
}
/** Every rule in force in this chat: its own, then those of the sets that are on in it. Each carries where it is kept. */
export function rulesInForce() {
    const cs = chatState();
    if (!cs) return [];
    const kept = setRules();
    const sets = new Set(cs.activeSets || []);
    return [...chatRules().map(r => ({ ...r, scope: '' })), ...Object.entries(kept).filter(([id]) => sets.has(id)).flatMap(([id, list]) => (list || []).map(r => ({ ...r, scope: id })))];
}
/** Save a list of rules where they are kept: '' for this chat, a set id for the set. */
export function saveRules(scope, list) {
    const rules = (list || []).map(normalRule);
    if (scope) { setRules()[scope] = rules; if (!rules.length) delete setRules()[scope]; saveSettings(); }
    else { const cs = chatState(); if (!cs) return; cs.storyRules = rules; saveChatState(); }
    refresh();
}

// ---------------------------------------------------------------- the hook pacing.js reads, and the host side

const live = { held: new Set(), granted: new Set(), upcoming: null, chat: '' };
const listeners = new Set();
/** Redraws of the page when what the next reply carries changes. */
export const onRulesChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = () => { for (const fn of listeners) { try { fn(); } catch { /* a listener must not stop the rules */ } } };

/** True when a story rule holds this event item out of rolls right now (pacing.js itemFits). */
export const ruleHeld = item => !!item && live.held.has(String(item.id)) && !live.granted.has(String(item.id));

/** What the next reply will carry, as last checked: { fired, states } or null. */
export const upcoming = () => live.upcoming;

/** Recompute the held items, the grants and the preview of the next reply, for the chat as it stands. */
export function refresh() {
    try {
        const c = ctx();
        const chat = c.chat || [];
        const rules = rulesInForce();
        live.held = heldIds(rules);
        // during a reply, the reply being written keeps the firings decided for it
        const end = turn.active && turn.type !== 'continue' ? endFor(chat, turn.type) : chat.length;
        live.upcoming = turn.active ? null : decide(rules, ruleView(chat, c.chatMetadata, end), chat, end);
        live.granted = grantsFrom(chat, end, turn.active ? turn.fired : []);
        live.chat = String(c.getCurrentChatId?.() || '');
    } catch (error) { console.warn(LOG, 'story rules', error); }
    tell();
}

const turn = { active: false, quiet: false, type: '', fired: [], states: {} };
function publish(text) {
    try { ctx().setExtensionPrompt?.(PROMPT_KEY, text, 1, 0, false, 0, () => turn.active && !turn.quiet); } catch { /* the host has no extension prompts */ }
}

/** Before a reply: decide the firings, send their directions, let their items into this reply's roll. */
export function beforeReply(type) {
    const c = ctx();
    const chat = c.chat || [];
    if (type === 'continue') {
        const last = [...chat].reverse().find(isReply);
        const kept = last ? rulesOf(last) : null;
        Object.assign(turn, { active: true, type, fired: kept?.fired || [], states: kept?.states || {} });
    } else {
        const end = endFor(chat, type);
        const rules = rulesInForce();
        const { fired, states } = decide(rules, ruleView(chat, c.chatMetadata, end), chat, end);
        Object.assign(turn, { active: true, type, fired, states });
        live.held = heldIds(rules);
        live.granted = grantsFrom(chat, end, fired);
    }
    publish(directionText(turn.fired));
}

/** After the reply arrives: store the firing on its showing swipe. */
export function afterReply(index, type) {
    if (!turn.active) return;
    const message = ctx().chat?.[index];
    if (message && isReply(message) && !(type === 'continue' && rulesOf(message))) storeRules(message, turn);
    endTurn();
}

function endTurn() {
    turn.active = false;
    turn.fired = []; turn.states = {};
    publish('');
    setTimeout(() => refresh(), 0);
}

let started = false;
/** Wire the rules to the host once. */
export async function startStoryRules() {
    if (started) return;
    started = true;
    on('GENERATION_STARTED', (type, opts, dryRun) => {
        if (dryRun) return;
        if (type === 'quiet' || opts?.quiet_prompt) { turn.quiet = true; return; }
        if (type === 'impersonate' || settings().enabled === false) return;
        try { beforeReply(String(type || 'normal')); } catch (error) { console.warn(LOG, 'story rules', error); }
    });
    on('MESSAGE_RECEIVED', (id, type) => { if (type !== 'first_message') afterReply(Number(id), type); });
    for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, () => { if (turn.quiet) turn.quiet = false; else if (turn.active) endTurn(); });
    for (const name of ['MESSAGE_DELETED', 'MESSAGE_SWIPED', 'CHAT_CHANGED']) on(name, () => setTimeout(() => refresh(), 0));
    try {
        const capture = await import('./memory/capture.js');
        capture.onCapture(event => { if (event.phase === 'done') refresh(); });
    } catch (error) { console.warn(LOG, 'story rules after capture', error); }
    try { await import('./ui/story-rules.js'); } catch (error) { console.warn(LOG, 'story rules page', error); }
    refresh();
}

// Loaded through pacing.js, which the engine imports: in the browser the rules wire themselves to the host, so no entry
// file change is needed. Node tests import the pure functions and nothing starts.
if (globalThis.document && globalThis.SillyTavern?.getContext) setTimeout(() => startStoryRules().catch(error => console.warn(LOG, 'story rules did not start', error)), 0);
