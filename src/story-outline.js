// The long-range story outline (B52; audit A20 rec. 5; her ruling of 25 November). Every 40 replies, or when she taps
// Write the outline now, one call reads the chat's records, its open threads with their "ends when" lines (B49) and her
// story rules, and writes a short outline of possible next chapters. The writer reads it only as lines of the Director's
// desk entry in the Tracker book (tracker-book.js); she reads, edits and clears it on Direction, Goal.
//
// The extra call. No existing request can carry it: the reply request writes prose for the next turn, capture files one
// exchange, and the chapter call summarizes a closed range; none of them looks forward across the open threads, and
// folding the outline into the chapter call would tie it to chapter closes and the chapter's checks. So this is one call
// of its own, about 8,000 characters in and 900 tokens out, every 40 replies. It runs only on free routes: the desktop over
// Tailscale, the NanoGPT plan, the free tiers, and the Main API when it is a local server or the NanoGPT plan. With no free
// route it waits for one and spends nothing; a paid route is never tried, and the spend ceiling is never touched.
//
// Edits. Her edit stays as she wrote it. While "Keeps your text" is chosen, the 40-reply run makes no call over an edited
// outline; with "Rewrites it" the run sends her text as the current outline. A failed answer keeps the old outline and the
// run waits for the next interval; a run that found no free route tries again after 10 minutes.
import { DOWN_MS, JOBS, ROUTES, chainFor, mainCostClass, profileCostClass, resolveRoute, runChain } from './routing.js';
import { ctx, isReply, LOG, on } from './st.js';
import { settings, saveSettings } from './store.js';
import { fold, MEMORY } from './memory/fold.js';
import { endsWhenOf, isPaused } from './memory/thread-state.js';

export const JOB = 'outline';
export const EVERY = 40;
export const MAX_CHAPTERS = 5;
export const LINE_MAX = 240;
export const TEXT_MAX = 1400;
const FREE = new Set(['local', 'plan', 'free']);
const BUDGET = { threads: 3000, records: 2400, chapters: 2400, rules: 600 };
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Variation_Selector}\p{Join_Control}]/gu;
const clean = text => String(text ?? '').replace(EMOJI, '').replace(/\s+/g, ' ').trim();
const CLOSED = new Set(['done', 'failed', 'retired', 'replaced', 'merged', 'suspect']);

// ---------------------------------------------------------------- the outline in chat data (pure)

/** The outline of a chat's data, normalized: { text, reply, at, route, model, edited, keep, problem, waitUntil }. */
export function outlineOf(meta) {
    const raw = meta?.[MEMORY]?.outline;
    const o = raw && typeof raw === 'object' ? raw : {};
    return {
        text: typeof o.text === 'string' ? o.text : '',
        reply: Number.isFinite(o.reply) ? o.reply : 0,
        at: Number(o.at) || 0,
        route: String(o.route || ''), model: String(o.model || ''),
        edited: o.edited === true,
        keep: o.keep !== false,
        problem: String(o.problem || ''),
        waitUntil: Number(o.waitUntil) || 0,
    };
}

/** The outline's lines: one possible chapter per line, emoji and list marks taken off, at most MAX_CHAPTERS + 3. */
export function outlineLines(text) {
    return String(text ?? '').split('\n').map(line => clean(line).replace(/^(?:[-*]|\d+[.)])\s*/, '').slice(0, LINE_MAX)).filter(Boolean).slice(0, MAX_CHAPTERS + 3);
}

/** The lines the Director's desk entry carries for an outline, or [] when there is none. Model-facing text. */
export function outlineDeskLines(text) {
    const lines = outlineLines(text);
    if (!lines.length) return [];
    return ['Long-range outline, for you alone: possible next chapters. Open paths toward them over many replies, through the people and threads already in play.',
        ...lines.map((line, i) => `${i + 1}. ${line}`)];
}

/** The number of story replies in a chat; the interval counts these. */
export const storyReplies = chat => (chat || []).filter(isReply).length;

/** True when the 40-reply run is due: the replies since the last run reach the interval. */
export const isDue = (state, count, every = EVERY) => count - Math.min(state.reply || 0, count) >= every;

/**
 * Why the 40-reply run makes no call now, or '' when it may run. state: outlineOf(meta). now: the clock.
 * An edited outline kept as she wrote it waits for her; a run that found no free route waits 10 minutes.
 */
export function skipReason(state, count, now = Date.now()) {
    if (!isDue(state, count)) return 'not due';
    if (state.edited && state.keep && state.text.trim()) return 'kept edit';
    if (state.waitUntil > now) return 'waiting for a free route';
    return '';
}

/**
 * The free steps of a chain, in order. A step is free when its route costs nothing per call: local, plan or free tier.
 * The Main API counts only when it is a local server or the NanoGPT plan; the on-phone model takes judgment calls only.
 * costs: test hooks for the Main API's class and a saved profile's class.
 */
export function freeChain(chain, { mainCost = mainCostClass, profileCost = entry => profileCostClass(resolveRoute(entry)) } = {}) {
    return (chain || []).filter(entry => {
        if (entry?.profileId) return FREE.has(profileCost(entry));
        const def = ROUTES[entry?.route];
        if (!def || def.judgmentOnly) return false;
        if (def.kind === 'main') return FREE.has(mainCost());
        return FREE.has(def.cost);
    });
}

// ---------------------------------------------------------------- the request (pure)

export const OUTLINE_SCHEMA = Object.freeze({
    name: 'story_outline',
    value: {
        type: 'object', required: ['chapters'],
        properties: {
            chapters: { type: 'array', items: { type: 'object', required: ['title', 'events'], properties: { title: { type: 'string' }, events: { type: 'string' } } } },
        },
    },
});

export const OUTLINE_SYSTEM = [
    'You plan the long-range course of a roleplay story. From the records below, write 3 to 5 possible next chapters the story can be steered toward.',
    'Build each chapter from the open threads: it moves one or more of them toward the line written after "ends when", or ends a thread on that line.',
    'Write each chapter as a title and one or two sentences of events in the register of an incident report: who does what, where, when, how many, on what terms and with what result. Keep names, places, numbers and deadlines exactly as the records give them. Describe what people do and say.',
    'Use the people, places and threads the records name. A chapter may add one new person or place, named plainly.',
    'Order the chapters from nearest to furthest, each able to follow the one before.',
    'Return only a JSON object with the keys "chapters", a list of objects with the keys "title" and "events".',
].join('\n');

const within = (lines, budget) => {
    const out = [];
    let used = 0;
    for (const line of lines) { if (used + line.length + 1 > budget) continue; out.push(line); used += line.length + 1; }
    return out;
};

/**
 * The outline request. records: the fold's current records in story order. cast: the character and persona names.
 * rules: her story rules as sentences. current: { text, edited } of the outline on file. Returns { system, user, schema }.
 */
export function buildOutlineRequest({ records = [], cast = [], rules = [], current = null } = {}) {
    const live = records.filter(r => r && !CLOSED.has(r.status));
    const threads = live.filter(r => r.kind === 'thread' && !isPaused(r))
        .sort((a, b) => (b.importance || 5) - (a.importance || 5))
        .map(r => {
            const ends = endsWhenOf(r);
            const due = [r.story_time, r.due, r.when].find(x => typeof x === 'string' && x.trim());
            return `- ${r.threadType || 'Open'}: ${clean(r.subject || r.title) || 'untitled'}. ${clean(r.text)}${ends ? ` Ends when ${ends.replace(/\.?$/, '.')}` : ''}${due ? ` Due ${clean(due)}.` : ''}`;
        });
    const others = live.filter(r => !['thread', 'chapter', 'condensed', 'arc', 'scene', 'stat sheet'].includes(r.kind) && clean(r.text))
        .sort((a, b) => (b.importance || 5) - (a.importance || 5))
        .map(r => `- ${r.kind} | ${clean(r.subject) || '-'} | ${clean(r.text)}`);
    const chapters = live.filter(r => r.kind === 'chapter' && clean(r.text));
    const condensed = live.find(r => r.kind === 'condensed' && clean(r.text));
    const story = [
        condensed ? `Story so far: ${clean(condensed.text)}` : '',
        ...chapters.slice(-3).map(c => `Chapter "${clean(c.title || c.subject)}": ${clean(c.text)}`),
    ].filter(Boolean);
    const now = outlineLines(current?.text);
    const parts = [
        cast.length ? `Cast: ${cast.map(clean).filter(Boolean).join(', ')}.` : '',
        story.length ? within(story.reverse(), BUDGET.chapters).reverse().join('\n') : '',
        `Open threads:\n${within(threads, BUDGET.threads).join('\n') || '(none on file)'}`,
        others.length ? `Other records (kind | subject | text):\n${within(others, BUDGET.records).join('\n')}` : '',
        rules.length ? `Story rules the player set (code fires them):\n${within(rules.map(r => `- ${clean(r)}`), BUDGET.rules).join('\n')}` : '',
        now.length ? `Current outline${current?.edited ? ', as the player edited it' : ''}. Keep its chapters that still fit the records, in their wording, and rewrite the ones the story has passed or ruled out:\n${now.map(line => `- ${line}`).join('\n')}` : '',
    ];
    return { system: OUTLINE_SYSTEM, user: parts.filter(Boolean).join('\n\n'), schema: OUTLINE_SCHEMA };
}

/** The outline text an answer makes: one "Title: events" line per chapter, at most MAX_CHAPTERS, or '' when none. */
export function readOutline(value) {
    const list = Array.isArray(value?.chapters) ? value.chapters : [];
    const lines = list.map(item => {
        const title = clean(item?.title).replace(/[.:]+$/, '');
        const events = clean(item?.events);
        return (title && events ? `${title}: ${events}` : title || events).slice(0, LINE_MAX);
    }).filter(Boolean).slice(0, MAX_CHAPTERS);
    return lines.join('\n');
}

// ---------------------------------------------------------------- the chat it runs in

const listeners = new Set();
/** Hear every change of the outline or of a run's state. Returns a function that stops listening. */
export const onOutlineChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const tell = () => { for (const fn of listeners) { try { fn(); } catch { /* a listener must not stop the outline */ } } };

let running = null;
export const outlineBusy = () => !!running;

const metaOf = () => ctx().chatMetadata || null;
const chatIdOf = () => String(ctx().getCurrentChatId?.() || '');
const memoryOn = meta => !!meta?.[MEMORY]?.imported && meta[MEMORY].off !== true;

/** The global switch: the outline runs unless she turned it off. */
export function outlineOn() {
    return settings().enabled !== false && settings().storyOutline?.on !== false;
}

export async function setOutlineOn(on) {
    const st = settings();
    st.storyOutline = { ...(st.storyOutline || {}), on: on === true };
    saveSettings();
    await rewriteBook();
    tell();
}

/** The outline of the open chat, or null with no chat open. */
export function currentOutline() {
    const meta = metaOf();
    return meta && chatIdOf() ? outlineOf(meta) : null;
}

/** The text the Director's desk carries for the open chat: the outline while the switch is on, else ''. */
export function deskOutline(meta = metaOf()) {
    if (!meta || !outlineOn()) return '';
    return outlineOf(meta).text;
}

async function saveMeta({ debounced = false } = {}) {
    const c = ctx();
    try { await (debounced ? (c.saveMetadataDebounced || c.saveMetadata) : c.saveMetadata)?.call(c); } catch (error) { console.warn(LOG, 'outline save', error); }
}

let bookTimer = 0;
async function rewriteBook({ soon = false } = {}) {
    const write = async () => {
        try {
            const meta = metaOf();
            if (!meta?.[MEMORY]?.imported) return;
            const { trackerBook } = await import('./tracker-book.js');
            await trackerBook().write();
        } catch (error) { console.warn(LOG, 'outline tracker book', error); }
    };
    clearTimeout(bookTimer);
    if (soon) { bookTimer = setTimeout(write, 800); return; }
    await write();
}

function store(change) {
    const meta = metaOf();
    if (!meta) return null;
    const holder = (meta[MEMORY] ||= {});
    holder.outline = { ...outlineOf(meta), ...change };
    return holder.outline;
}

/** Her edit of the outline. It stays as she wrote it until a run rewrites it. */
export async function editOutline(text) {
    if (!currentOutline()) return;
    const value = String(text ?? '').slice(0, TEXT_MAX);
    store({ text: value, edited: !!value.trim() });
    await saveMeta({ debounced: true });
    await rewriteBook({ soon: true });
}

/** Her choice for an edited outline at the next 40-reply run: keep it as written (true) or rewrite it from her text. */
export async function setKeepEdits(keep) {
    if (!currentOutline()) return;
    store({ keep: keep === true });
    await saveMeta();
    tell();
}

/** Clear the outline. The Director's desk drops its outline lines; the next run writes a new one. */
export async function clearOutline() {
    if (!currentOutline()) return;
    store({ text: '', edited: false, problem: '' });
    await saveMeta();
    await rewriteBook();
    tell();
}

/** The sentences of her story rules in force in this chat that are on. */
async function ruleSentences() {
    try {
        const R = await import('./story-rules.js');
        return R.rulesInForce().map(R.normalRule).filter(r => r.on).map(R.ruleSentence).slice(0, 8);
    } catch { return []; }
}

const castOf = () => { const c = ctx(); return [c.name2, c.name1].map(clean).filter(Boolean); };
// outcomes that mean a route took the request and its answer could not be used
const ANSWERED = new Set(['invalid', 'refusal', 'error']);

/**
 * Write the outline now. tap: she asked (the Generate sheet's Generate). Resolves { ok, text?, waiting?, reason }.
 * A failed answer keeps the outline on file. Only free routes are tried, so nothing is spent.
 */
export function runOutline({ tap = false, signal, clock = Date.now } = {}) {
    if (running) return running;
    running = (async () => {
        const meta = metaOf();
        const chatId = chatIdOf();
        if (!meta || !chatId) return { ok: false, reason: 'No chat is open.' };
        if (!memoryOn(meta)) return { ok: false, reason: 'Story memory is off for this chat, and the outline reads its records.' };
        tell();
        const count = storyReplies(ctx().chat);
        const chain = freeChain(chainFor(JOB));
        if (!chain.length) {
            store({ problem: 'No free route is set up. The outline waits for the desktop, a free tier or the NanoGPT plan.', waitUntil: clock() + DOWN_MS });
            await saveMeta();
            return { ok: false, waiting: true, reason: outlineOf(meta).problem };
        }
        const state = outlineOf(meta);
        const records = fold(ctx().chat || [], meta, { cache: false }).current || [];
        const request = buildOutlineRequest({ records, cast: castOf(), rules: await ruleSentences(), current: state.text.trim() ? state : null });
        const res = await runChain(chain, { job: JOB, ...request, tokens: 900, signal, background: !tap,
            label: tap ? 'Story outline (you asked)' : `Story outline (background, every ${EVERY} replies)` });
        if (chatIdOf() !== chatId) return { ok: false, reason: 'The chat changed while the outline was written; nothing was kept.' };
        const text = res.ok ? readOutline(res.value) : '';
        if (text) {
            store({ text, reply: count, at: clock(), route: res.route, model: res.model, edited: false, problem: '', waitUntil: 0 });
            await saveMeta();
            await rewriteBook();
            return { ok: true, text, reason: '' };
        }
        const answered = res.ok || res.attempts.some(a => ANSWERED.has(a.outcome));
        const problem = answered
            ? `The last answer could not be used${res.reason && !res.ok ? ` (${res.attempts.filter(a => ANSWERED.has(a.outcome)).at(-1)?.reason || res.reason})` : ' (it held no chapters)'}. The outline on file is kept until the next run.`
            : 'No free route answered. The outline on file is kept, and the run tries again in 10 minutes.';
        store(answered ? { problem, reply: count, waitUntil: 0 } : { problem, waitUntil: clock() + DOWN_MS });
        await saveMeta();
        return { ok: false, waiting: !answered, reason: problem };
    })().catch(error => {
        console.warn(LOG, 'story outline', error);
        return { ok: false, reason: String(error?.message || error) };
    }).finally(() => { running = null; tell(); });
    return running;
}

/** After a capture: run when 40 replies have passed since the last run and nothing holds it back. */
export async function checkOutline({ clock = Date.now } = {}) {
    try {
        const meta = metaOf();
        if (running || !meta || !chatIdOf() || !memoryOn(meta) || !outlineOn()) return null;
        if (skipReason(outlineOf(meta), storyReplies(ctx().chat), clock())) return null;
        return await runOutline({ clock });
    } catch (error) { console.warn(LOG, 'story outline check', error); return null; }
}

let started = false;
/** Wire the outline to the host once: a check after each capture, a redraw on chat change, and the Direction page. */
export async function startStoryOutline() {
    if (started) return;
    started = true;
    if (!JOBS[JOB]) console.warn(LOG, 'the outline job is missing from the route jobs');
    try {
        const capture = await import('./memory/capture.js');
        capture.onCapture(event => { if (event.phase === 'done') checkOutline(); });
    } catch (error) { console.warn(LOG, 'story outline after capture', error); }
    on('CHAT_CHANGED', () => setTimeout(tell, 0));
    try { await import('./ui/story-outline.js'); } catch (error) { console.warn(LOG, 'story outline page', error); }
}

// Loaded through tracker-book.js, which the extension imports: in the browser the outline wires itself to the host, so no
// entry file change is needed. Node tests import the pure functions and nothing starts.
if (globalThis.document && globalThis.SillyTavern?.getContext) setTimeout(() => startStoryOutline().catch(error => console.warn(LOG, 'story outline did not start', error)), 0);
