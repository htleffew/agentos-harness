// Catch-up, rebuild and the route tests that decide whether catch-up runs by itself (memory DESIGN 8.1 and 8.2, MB9).
//
// A chat that opens with 20 or more exchanges past its capture watermark is read in order, a stretch at a time:
//   1. Code lists the untracked exchanges, cuts them at scene boundaries into chunks sized for the route, and picks the route
//      with the five tests of 8.1 (reachable, proven, fits, finishes in time, leaves room), or asks first and names the test
//      that failed.
//   2. One map call per chunk, in story order. The prompt carries a state digest built in code, the stored records as an
//      exclusion list, and the exchanges; the answer holds change entries, chapters and the scene at the chunk's end.
//   3. Code checks every entry with the capture checks (src/memory/validate.js), every chapter with the chapter checks
//      (src/memory/story-so-far.js), drops what fails, and files the rest to the replies it came from.
//   4. After the last map call: code merges identical records and one Cleanup call rules on the near duplicates, then the
//      condensed account is built and the search index is brought up to date, both in the background.
// Every part is a saved queue job (src/memory/queue.js) and the plan is saved in chat metadata, so a closed app resumes at the
// next part and a repeated catch-up over covered history adds nothing: replies already filed are context only, and the
// records already stored go to the model as an exclusion list.
//
// Extra model calls this file makes beyond the map calls and the one Cleanup call: one tiny structured probe per free route
// at chat open, only when a catch-up is due and the route has not answered in the last 10 minutes (test 1 of 8.1 needs a
// recent valid answer). Nothing else.
import { MEMORY, chatMemory, fold as foldChat, forgetFold, proseOf, revisionOf, storedMark } from './fold.js';
import { exchangeOf, isCaptured, isOutOfCharacter, recordsFor, stampMessage, sceneFor, captureReadSchema, strictSchema, replyNumber, watermarkOf } from './capture.js';
import { checkCapture } from './validate.js';
import { chaptersOf, coverage, checkChapter, chapterRecord, evidenceOf, tokensOf, moodHits, REGISTER_RULE, REGISTER_EXAMPLE } from './story-so-far.js';
import { parseSceneHeader } from '../scene-header.js';
import { catalogCost } from '../spend.js';

// ---------------------------------------------------------------- what 8.1 fixes

export const START_AT = 20;
/** The bar a free route must clear (8.1): a context of 12,000 tokens, 30 minutes, under 5 percent of NanoGPT's weekly allowance. */
export const BAR = Object.freeze({ context: 12000, minutes: 30, share: 0.05, weekly: 60000000, freshMs: 10 * 60 * 1000 });
/** The free routes, in the order catch-up tries them. */
export const FREE_ORDER = Object.freeze(['desktop', 'nanogpt', 'phone']);
export const CLASS_OF = Object.freeze({ desktop: 'local', phone: 'local', nanogpt: 'mid', openrouterFree: 'mid', googleFree: 'mid', openrouter: 'frontier', main: 'frontier' });
/** Tokens of new exchanges one map call reads: 8,000 to 10,000 local, 16,000 mid, 32,000 frontier (M1f 6.4). */
export const CHUNK = Object.freeze({ local: 9000, mid: 16000, frontier: 32000 });
const EXCLUDE_CHARS = Object.freeze({ local: 4000, mid: 12000, frontier: 24000 });
export const OUT_TOKENS = 1600;
export const OVERHEAD_TOKENS = 2600;
const SPEED = Object.freeze({
    desktop: { prefill: 1200, gen: 35 }, nanogpt: { prefill: 4000, gen: 80 }, phone: { prefill: 100, gen: 6.6 },
    googleFree: { prefill: 3000, gen: 60 }, openrouterFree: { prefill: 3000, gen: 60 }, openrouter: { prefill: 6000, gen: 100 }, main: { prefill: 6000, gen: 100 },
});
const CONTEXT = Object.freeze({ desktop: 32768, nanogpt: 128000, phone: 4096, googleFree: 131072, openrouterFree: 65536, openrouter: 128000, main: 128000 });
/** The models that count as proven until MB9 measures each route (8.1, test 2). */
export const PROVEN = Object.freeze(['gemma4:12b', 'deepseek/deepseek-v4.1-flash']);
const PAID = new Set(['openrouter', 'main']);
const WORDS = Object.freeze({ desktop: 'the desktop', nanogpt: 'NanoGPT', phone: 'the phone', googleFree: 'Google AI Studio', openrouterFree: 'OpenRouter', openrouter: 'OpenRouter', main: 'the Main API' });
const LABELS = Object.freeze({ desktop: 'Desktop', nanogpt: 'NanoGPT', phone: 'The on-phone model', googleFree: 'Google AI Studio free tier', openrouterFree: 'OpenRouter free model', openrouter: 'OpenRouter', main: 'The Main API' });
export const routeWord = route => WORDS[route] || route;

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const list = value => (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
const group = n => Number(n).toLocaleString('en-US');

// ---------------------------------------------------------------- the story, as exchanges

const isHiddenReply = m => m?.is_system === true && !m.extra?.type && m.role !== 'tool' && !(m.extra && 'tool_invocations' in m.extra);
/** A reply of the story: a message you did not write, shown or hidden from the model. */
export const storyReply = m => !!m && !m.is_user && (!m.is_system || isHiddenReply(m)) && typeof m.mes === 'string' && !m.extra?.ri_chapter_view;

const BREAK_LINE = /^(\*\s*\*\s*\*|-{3,}|\*{3,}|_{3,})$/;
const HEADING_LINE = /^#{1,3}\s\S/;
/** True when the story turns a scene after this exchange: the tracker says so, the next header names another place, or a break line stands between them. */
function boundaryAfter(chat, index, key) {
    const tracker = chat[index]?.extra?.[key]?.tracker;
    if (tracker?.sceneEnded) return true;
    const next = chat.slice(index + 1).find(storyReply);
    const here = parseSceneHeader(chat[index]?.mes)?.place, there = next ? parseSceneHeader(next.mes)?.place : '';
    if (here && there && clean(here).toLowerCase() !== clean(there).toLowerCase()) return true;
    const lines = text => String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    const tail = lines(chat[index]?.mes).at(-1) || '', head = next ? lines(next.mes)[0] || '' : '';
    return BREAK_LINE.test(tail) || BREAK_LINE.test(head) || HEADING_LINE.test(head);
}

/**
 * Every exchange of the story in order. status 'new' when the exchange waits to be filed (not captured, not covered by a
 * chapter, past what this plan filed; a rebuild ignores capture and chapters), 'context' for the rest. Out-of-character
 * exchanges are left out.
 */
export function exchangeList(chat, { result = null, rebuild = false, filedIndex = 0, key = '', oocMarks = [] } = {}) {
    const covered = result && !rebuild ? coverage(chaptersOf(chat, result)) : new Set();
    const out = [];
    for (let i = 1; i < (chat || []).length; i++) {
        const m = chat[i];
        if (!storyReply(m)) continue;
        const ex = exchangeOf(chat, i);
        if (isOutOfCharacter(ex.player, oocMarks)) continue;
        const waiting = i > filedIndex && (rebuild || (!isCaptured(m) && !covered.has(ex.mark)));
        out.push({ ...ex, status: waiting ? 'new' : 'context', tokens: tokensOf(ex.player) + tokensOf(ex.prose) + 30, start: ex.playerIndex >= 0 ? ex.playerIndex : i, boundary: false });
    }
    return out;
}
const withBoundaries = (chat, list, key) => { for (const ex of list) ex.boundary = boundaryAfter(chat, ex.index, key); return list; };

/** How many exchanges wait for catch-up, and their tokens. */
export function pending(chat, options = {}) {
    const items = exchangeList(chat, options).filter(ex => ex.status === 'new');
    return { count: items.length, tokens: items.reduce((sum, ex) => sum + ex.tokens, 0) };
}

/**
 * The next chunk. list: exchangeList; cursorIndex: the first chat index to show. The chunk starts at the cursor, shows the
 * exchanges already filed after it as context (at most a fifth of the target), then takes new exchanges until the target is
 * reached, ending at the last scene boundary once 80 percent of it is in. Returns { exchanges, newCount, tokens, final, first }.
 */
export function pickChunk(list, { cursorIndex = 1, target = CHUNK.local, key = '', chat = [] } = {}) {
    let from = list.findIndex(ex => ex.index >= cursorIndex);
    if (from < 0) return { exchanges: [], newCount: 0, tokens: 0, final: true, first: null };
    let lead = from;
    while (lead < list.length && list[lead].status === 'context') lead += 1;
    // The scene still going comes back as context so a chapter can start at its first exchange. It takes room from the new
    // exchanges (never more than 70 percent of the target); a longer open scene loses its oldest exchanges.
    let contextTokens = list.slice(from, lead).reduce((sum, ex) => sum + ex.tokens, 0);
    while (from < lead && contextTokens > target * 0.7) { contextTokens -= list[from].tokens; from += 1; }
    const room = Math.max(target * 0.3, target - contextTokens);
    let newTokens = 0, cut = -1, boundary = -1;
    for (let k = lead; k < list.length; k++) {
        const ex = list[k];
        if (ex.status !== 'new') continue;
        newTokens += ex.tokens;
        const edge = ex.boundary ?? boundaryAfter(chat, ex.index, key);
        if (edge && newTokens >= room * 0.8) { cut = k; break; }
        if (edge && newTokens >= room * 0.6) boundary = k;
        if (newTokens >= room * 1.1) { cut = boundary >= 0 ? boundary : k; break; }
    }
    if (cut < 0) cut = list.length - 1;
    const exchanges = list.slice(from, cut + 1);
    const newCount = exchanges.filter(ex => ex.status === 'new').length;
    return { exchanges, newCount, tokens: exchanges.reduce((sum, ex) => sum + (ex.status === 'new' ? ex.tokens : 0), 0), final: !list.slice(cut + 1).some(ex => ex.status === 'new'), first: exchanges[0] || null };
}

/** Cut a list of exchanges into the chunks a route would read (for the call estimate and the tests). */
export function cutChunks(chat, options = {}, target = CHUNK.local) {
    const items = withBoundaries(chat, exchangeList(chat, options), options.key || '');
    const chunks = [];
    let cursor = 1;
    for (let guard = 0; guard < 1000; guard++) {
        const chunk = pickChunk(items, { cursorIndex: cursor, target, key: options.key || '', chat });
        if (!chunk.newCount) break;
        chunks.push(chunk);
        if (chunk.final) break;
        const last = chunk.exchanges.at(-1);
        const next = items.find(ex => ex.index > last.index);
        if (!next) break;
        cursor = next.index;
        for (const ex of chunk.exchanges) ex.status = 'context';
    }
    return chunks;
}

// ---------------------------------------------------------------- the five tests (8.1)

/** The size and time of a run on one route. tokens: the new exchanges' tokens. speed: { perCall } measured, or { prefill, gen } defaults. */
export function estimateRun({ tokens, route, speed = null } = {}) {
    const cls = CLASS_OF[route] || 'mid', chunk = CHUNK[cls];
    const calls = Math.max(1, Math.ceil(tokens * 1.05 / chunk));
    const rate = speed?.prefill ? speed : SPEED[route] || SPEED.nanogpt;
    const perCall = speed?.perCall > 0 ? speed.perCall : (Math.min(chunk, tokens) + OVERHEAD_TOKENS) / rate.prefill + OUT_TOKENS / rate.gen + 3;
    const seconds = Math.round(calls * perCall);
    return { route, class: cls, chunk, calls, cleanup: 1, seconds, minutes: Math.max(1, Math.ceil(seconds / 60)), inputTokens: Math.ceil(tokens * 1.05 + calls * OVERHEAD_TOKENS), outputTokens: calls * OUT_TOKENS };
}

/**
 * The five tests of 8.1 for one route. facts: { found, reachable (answered within 10 minutes), model, proven, context,
 * charging, weekly, speed }. Returns { pass, tests: [{ id, ok, text }], failed: [{ id, text }] }; text of a failed test names the route.
 */
export function routeTests(route, facts = {}, est) {
    const label = LABELS[route] || route;
    const proven = facts.proven === true || PROVEN.includes(String(facts.model || ''));
    const context = Number(facts.context) || CONTEXT[route] || 0;
    const weekly = Number(facts.weekly) > 0 ? Number(facts.weekly) : BAR.weekly;
    const timeOk = est.minutes <= BAR.minutes;
    const charging = route !== 'phone' || facts.charging === true;
    const tests = [
        { id: 'reachable', ok: facts.reachable === true, text: `${label}: no valid answer in the last 10 minutes` },
        { id: 'proven', ok: proven, text: `${label}: ${facts.model || 'its model'} has not passed the catch-up bar` },
        { id: 'fits', ok: context >= BAR.context, text: `${label}: a context of ${group(context)} tokens is under ${group(BAR.context)}` },
        { id: 'time', ok: timeOk && charging, text: !charging ? `${label}: runs only while the phone is charging` : `${label}: about ${group(est.minutes)} minutes, over ${BAR.minutes}` },
        { id: 'room', ok: route !== 'nanogpt' || est.inputTokens < BAR.share * weekly, text: `${label}: over 5 percent of this week's allowance` },
    ];
    return { pass: tests.every(test => test.ok), tests, failed: tests.filter(test => !test.ok).map(({ id, text }) => ({ id, text })) };
}

/**
 * Pick what catch-up does. facts: { [route]: { found, ... }, charging }; tokens: new exchanges' tokens; free: the "Catch up by
 * itself on free routes" setting; askRoute: the route a tap would use when no free route passes (first of the Run now chain);
 * askPrice: its price for the cost line. Returns { mode: 'auto' | 'ask', route, est, failed, ... }.
 */
export function chooseRoute({ facts = {}, tokens = 0, free = true, askRoute = '', askPrice = null, speeds = {} } = {}) {
    const trials = [];
    for (const route of FREE_ORDER) {
        const f = facts[route];
        if (!f?.found) continue;
        const est = estimateRun({ tokens, route, speed: speeds[route] || null });
        const tests = routeTests(route, { ...f, charging: facts.charging }, est);
        trials.push({ route, est, ...tests });
        if (tests.pass) {
            if (free) return { mode: 'auto', route, est, failed: [], trials };
            return { mode: 'ask', route, est, failed: [{ id: 'setting', text: 'Catch up by itself on free routes is off' }], trials, cost: 0 };
        }
    }
    const use = askRoute || trials[0]?.route || '';
    const est = use ? estimateRun({ tokens, route: use, speed: speeds[use] || null }) : null;
    const cost = est && askPrice ? catalogCost(askPrice, est.inputTokens, est.outputTokens) ?? 0 : 0;
    const failed = trials.length ? trials[0].failed.map(item => ({ ...item, route: trials[0].route })) : [{ id: 'none', text: 'No free route is set up on this device' }];
    return { mode: 'ask', route: use, est, failed, trials, cost };
}

/** The one line that says what catch-up would do and what it costs, for the Cost chip and the ask card. */
export function costLine(est, { free = true, cost = 0, route = '' } = {}) {
    if (!est) return 'no route can run it now';
    const money = free ? 'free' : cost ? `about US$${cost.toFixed(2)}` : 'paid, inside your US$5 ceiling';
    return `${est.calls} model ${est.calls === 1 ? 'call' : 'calls'} and 1 Cleanup call, about ${est.minutes} ${est.minutes === 1 ? 'minute' : 'minutes'}, ${money}${route ? ` on ${routeWord(route)}` : ''}`;
}

/**
 * What a tap on Catch up this chat would do, from an assessment: the free route that passes the tests, or the first route of the
 * Run now chain when none does. Returns { route, est, pass, line }.
 */
export function tapPlan(seen) {
    const decision = seen.decision;
    const pass = (decision.trials || []).find(t => t.pass);
    const route = pass ? pass.route : decision.route;
    const est = pass ? pass.est : decision.est;
    const cost = pass ? 0 : decision.cost || 0;
    return { route, est, pass: !!pass, line: costLine(est, { free: !PAID.has(route), cost, route }) };
}

// ---------------------------------------------------------------- the map call

const OP_ITEM = captureReadSchema([], { batch: true }).properties.ops.items;
const strArray = { type: 'array', items: { type: 'string' } };
const CHAPTER_ITEM = {
    type: 'object', required: ['first_exchange', 'last_exchange', 'evidence', 'title', 'summary', 'people', 'places'],
    properties: {
        first_exchange: { type: 'integer' }, last_exchange: { type: 'integer' },
        evidence: { type: 'array', items: { type: 'object', required: ['message', 'quote'], properties: { message: { type: 'string' }, quote: { type: 'string' } } } },
        title: { type: 'string' }, start_time: { type: 'string' }, end_time: { type: 'string' }, summary: { type: 'string' },
        people: strArray, places: strArray, threads_opened: strArray, threads_closed: strArray, importance: { type: 'integer' },
        secrets: { type: 'array', items: { type: 'object', required: ['text', 'holders'], properties: { text: { type: 'string' }, holders: strArray } } },
    },
};
const SCENE_ITEM = { type: 'object', required: ['place', 'time', 'present'], properties: { place: { type: 'string' }, time: { type: 'string' }, present: strArray } };
const plainMap = { type: 'object', required: ['ops', 'chapters', 'scene'], properties: { ops: { type: 'array', items: OP_ITEM }, chapters: { type: 'array', items: CHAPTER_ITEM }, scene: SCENE_ITEM } };
/** The schema providers receive (strict) and the one code reads an answer with (only ops and chapters required). */
export const MAP_SCHEMA = Object.freeze({ name: 'catch_up_map', value: strictSchema(plainMap), read: { ...plainMap, required: ['ops', 'chapters'] } });

export const MAP_RULES = [
    'You keep the records of a roleplay story. You read a stretch of its exchanges, in order, and answer with one JSON object with three keys: "ops", "chapters" and "scene".',
    'Exchanges marked [recorded] were filed by an earlier call. They are shown so a chapter can start where the last one stopped; file nothing from them, and give no op their number. Exchanges marked [new] are yours to file.',
    'ops: one entry for each lasting change in a [new] exchange, at most 12 for each exchange, with the number of the exchange in "exchange". A change is lasting when it makes something true that will still matter in later scenes and the stored records do not already hold it: a new named person, place or item; an item changing hands, breaking or being used up; a wound or condition that lasts; an agreement with its terms, a price, a deadline or a number; a secret told or found out; a thread that opens, moves or ends; a change in how two characters stand. Travel, arrivals, who is present, weather, scenery, routine actions, small talk and descriptions of what is already known are not changes; most exchanges file nothing.',
    'op "add" files a new record with a new short lowercase id of words and hyphens. op "revise" gives an existing record a new text and keeps its id. op "supersede" files a new record whose newer state replaces an older one; put the older id in target. op "complete" ends an open thread; put its id in target and say how it ended in outcome. op "retire" says a record no longer holds; put its id in target. The stored records list holds what earlier calls filed: reuse an id when the fact is filed already, and file nothing a stored record already says.',
    'kind is one of fact, person, trait, place, item, secret, relationship, emotion, reputation, achievement, thread. A thread has thread_type Open, Plotline, Track, Seed, Detail, Pending, Plan or Elsewhere and, for a Plotline or Pending thread, ends_when: one plain line naming what has to happen for it to end. A secret lists its holders, the characters who know it; a false belief is a secret with believes set to what the holder wrongly believes. An item names its holder in details. A relationship names the other person in details (field "other"). An emotion gives axes: for each of tenderness, fury, dread and yearning, a step from -5 to 5 for how far the exchange moved it, with a reason that is a quote or an action.',
    'quote: copy the exact words from the exchange that show the change, 200 characters or fewer. text: one plain sentence of 300 characters or fewer. A claim files the same way whether a character speaks it or the narration states it; when a spoken line carries it, set speaker to who said it.',
    `Every text you write is a record. ${REGISTER_RULE} For example: "${REGISTER_EXAMPLE}"`,
    'chapters: cut the stretch into chapters at scene ends. A scene ends when the story moves to a new place or time, or settles what it was about. A chapter covers whole exchanges from first_exchange through last_exchange, with no gap and no overlap, in order, and the first chapter starts at exchange 1. A chapter covers at least 4 exchanges and at most 20. Do not close the scene that is still going at the last exchange: leave it with no chapter, because the story goes on from there. Each chapter has evidence first (three to six exact quotes, each with the label of its message in "message"), then title (3 to 6 plain words), start_time and end_time (as the messages state them, or an empty string), summary (150 to 250 words in the register above), people, places, threads_opened and threads_closed (short titles), importance (1 to 10) and secrets (facts only some characters know, each with its holders; keep them out of the summary).',
    'scene: the place, the story time and the people present at the end of the last exchange, as the messages state them.',
].join('\n');

const recordLine = r => `${r.id} | ${r.kind}${r.threadType ? `/${r.threadType}` : ''} | ${r.subject || '-'} | ${r.status === 'done' ? '(closed) ' : ''}${clean(r.text)}${r.holders?.length ? ` | known by ${r.holders.join(', ')}` : ''}${r.kind === 'thread' && r.endsWhen ? ` | ends when ${r.endsWhen}` : ''}`;
const OUT_OF_FORCE = ['retired', 'replaced', 'merged'];
const SKIP_KINDS = new Set(['chapter', 'condensed', 'arc', 'stat sheet', 'scene']);

/** The cast the chapter checks read: people on record with their other names, and the two names of the chat. */
export function castOf(result, names = {}) {
    const cast = [];
    const seen = new Set();
    for (const r of result?.current || []) if (r.kind === 'person' && r.subject && !seen.has(r.subject.toLowerCase())) { seen.add(r.subject.toLowerCase()); cast.push({ name: r.subject, aliases: r.aliases || [] }); }
    for (const name of [names.char, names.user].filter(Boolean)) if (!seen.has(String(name).toLowerCase())) cast.push({ name, aliases: [] });
    return cast;
}
const placesOf = result => (result?.current || []).filter(r => r.kind === 'place' && r.subject).map(r => r.subject);

/**
 * The state digest a map call carries (8.1 step 2), built in code from the records and the scene the last call returned:
 * the scene at the end of the last stretch, the people on record, the open threads and the latest chapter.
 */
export function stateDigest(result, scene = null) {
    const current = (result?.current || []).filter(r => !SKIP_KINDS.has(r.kind) || r.kind === 'chapter');
    const people = current.filter(r => r.kind === 'person').map(r => r.subject).filter(Boolean).slice(0, 20);
    const threads = current.filter(r => r.kind === 'thread' && r.status !== 'done' && !r.paused).slice(0, 8).map(r => `${r.subject || r.id}${r.threadType ? ` (${r.threadType})` : ''}`);
    const chapters = current.filter(r => r.kind === 'chapter');
    const last = chapters.at(-1);
    const lines = [];
    if (scene && (scene.place || scene.time || list(scene.present).length)) lines.push(`Scene at the end of the last stretch: ${[scene.place && `place ${scene.place}`, scene.time && `time ${scene.time}`, list(scene.present).length && `present ${list(scene.present).join(', ')}`].filter(Boolean).join('; ')}.`);
    if (people.length) lines.push(`People on record: ${people.join(', ')}.`);
    if (threads.length) lines.push(`Open threads: ${threads.join('; ')}.`);
    if (last) lines.push(`Latest chapter, "${clean(last.title || last.subject)}": ${clean(last.text).split(' ').slice(0, 50).join(' ')}${clean(last.text).split(' ').length > 50 ? ' ...' : ''}`);
    return lines.join('\n') || 'This is the start of the story; nothing is on record yet.';
}

/** The request of one map call. Returns { system, user, schema, read }. */
export function mapRequest({ chunk, result, scene = null, cast = [], routeClass = 'local', final = false, closeLast = false }) {
    const text = chunk.exchanges.map(ex => `${ex.player}\n${ex.prose}`).join('\n');
    const budget = EXCLUDE_CHARS[routeClass] || EXCLUDE_CHARS.local;
    const known = recordsFor(text, result?.records || [], { budget, present: cast.map(c => c.name) });
    const aliases = [...new Set((result?.current || []).flatMap(r => (r.aliases || []).length && ['person', 'place'].includes(r.kind) ? [`${r.subject}: ${r.aliases.join(', ')}`] : []))].slice(0, 30);
    const parts = [
        `State at the start of this stretch:\n${stateDigest(result, scene)}`,
        cast.length ? `Cast: ${cast.map(c => c.name).join(', ')}.` : '',
        aliases.length ? `Names in use:\n${aliases.join('\n')}` : '',
        `Stored records (id | kind | subject | text). They are already filed; do not file them again:\n${known.map(recordLine).join('\n') || '(none yet)'}`,
        `The exchanges, oldest first. Each message starts with its label in square brackets.\n${chunk.exchanges.map((ex, i) => [
            `Exchange ${i + 1} [${ex.status === 'new' ? 'new' : 'recorded'}]`,
            `[${ex.playerMark || `p${i + 1}`}] ${clean(ex.player) ? `Player: ${ex.player.trim()}` : 'Player: (nothing)'}`,
            `[${ex.mark || `i${ex.index}`}] ${ex.speaker || 'Character'}: ${ex.prose}`,
        ].join('\n')).join('\n\n')}`,
        final ? 'This is the last stretch of the chat. Leave the scene that is still going at the end without a chapter.'
            : closeLast ? 'The last exchange ends a scene, so the last chapter may end there. The story goes on after this stretch.'
                : 'The story goes on after this stretch. Leave the scene that is still going at the end without a chapter; the next call starts there.',
    ];
    return { system: MAP_RULES, user: parts.filter(Boolean).join('\n\n'), schema: MAP_SCHEMA.value, read: MAP_SCHEMA.read };
}

/** Sentences of a record text without mood language outside a stated line (the report register; no model call). */
export function stripMood(text) {
    const sentences = String(text ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
    return sentences.filter(s => !moodHits(s).length).join(' ');
}

const working = records => records.map(r => ({ ...r }));
/** Fold one exchange's checked entries into the working list, so the next exchange of the chunk is checked against them. */
function applyWorking(records, inputs) {
    for (const input of inputs) {
        const id = input.record?.id;
        if (input.op === 'add' && id) records.push({ ...input.record, status: input.record.status || 'current' });
        else if (input.op === 'revise' && id) { const at = records.findIndex(r => r.id === id); if (at >= 0) records[at] = { ...records[at], ...input.record }; }
        else if (input.op === 'supersede') { for (const t of input.target || []) { const r = records.find(x => x.id === t); if (r) r.status = 'replaced'; } if (id) records.push({ ...input.record, status: input.record.status || 'current' }); }
        else if (input.op === 'retire') for (const t of input.target || []) { const r = records.find(x => x.id === t); if (r) r.status = 'retired'; }
        else if (input.op === 'complete') for (const t of input.target || []) { const r = records.find(x => x.id === t); if (r) r.status = 'done'; }
    }
}

/**
 * Check one map answer against the chunk it read (pure). Entries go through the capture checks for the [new] exchange they
 * name; chapters through the chapter checks and must follow each other with no gap, starting at the chunk's first exchange.
 * Returns { byExchange: Map(index -> inputs), chapters: [{ record, answer, last }], scene, dropped, ruledOut }.
 */
export function checkMap(answer, { chat, chunk, result, cast = [], places = [], origin = {}, planId = 'cu', textOf = proseOf } = {}) {
    const dropped = [];
    const byExchange = new Map();
    const records = working(result?.records || []);
    const ops = Array.isArray(answer?.ops) ? answer.ops : [];
    const grouped = new Map();
    for (const op of ops) {
        const n = Number(op?.exchange);
        const ex = chunk.exchanges[n - 1];
        if (!ex || ex.status !== 'new') { dropped.push({ op, why: ex ? 'it names an exchange that was filed already' : 'it names no exchange of this stretch' }); continue; }
        (grouped.get(n) || grouped.set(n, []).get(n)).push(op);
    }
    for (const [n, list_] of [...grouped].sort((a, b) => a[0] - b[0])) {
        const ex = chunk.exchanges[n - 1];
        const exchange = { prose: ex.prose, player: ex.player, cast: cast.map(c => c.name), mark: ex.mark, swipe: ex.swipe, playerMark: ex.playerMark };
        const inputs = [];
        // One entry at a time, so an entry repeated inside the same answer is checked against the one before it.
        for (const op of list_.slice(0, 12)) {
            const checked = checkCapture({ decisions: { durable_change: true, scene_ended: false, out_of_character: false }, ops: [op] }, exchange, { records, route: origin.route || '', model: origin.model || '', callId: origin.call || '' });
            const mapped = checked.inputs.map(input => ({ ...input, origin: { ...input.origin, type: 'catch-up', route: origin.route || '', model: origin.model || '', call: origin.call || '' } }));
            for (const item of checked.dropped) dropped.push(item);
            applyWorking(records, mapped);
            inputs.push(...mapped);
        }
        if (list_.length > 12) dropped.push({ op: null, why: 'only the first 12 entries of an exchange are read' });
        byExchange.set(ex.index, inputs);
    }

    const accepted = [];
    let expect = 1;
    const chapters = (Array.isArray(answer?.chapters) ? answer.chapters : []).slice().sort((a, b) => Number(a?.first_exchange) - Number(b?.first_exchange));
    for (const item of chapters) {
        const first = Number(item?.first_exchange), last = Number(item?.last_exchange);
        if (first !== expect || !Number.isInteger(last) || last < first || last > chunk.exchanges.length) { dropped.push({ chapter: item?.title, why: first !== expect ? 'it does not start where the last chapter ended' : 'its exchange numbers are out of range' }); break; }
        const a = chunk.exchanges[first - 1], b = chunk.exchanges[last - 1];
        const from = a.start, to = b.index;
        const text = stripMood(item.summary);
        const candidate = { ...item, summary: text, evidence: Array.isArray(item.evidence) ? item.evidence : [], people: list(item.people), places: list(item.places) };
        const verdict = checkChapter(candidate, { chat, from, to, cast, places, textOf });
        if (verdict.problems.length) { dropped.push({ chapter: item?.title, why: verdict.problems.slice(0, 3).join(' ') }); break; }
        const record = chapterRecord(candidate, { chat, from, to, id: `ch-${a.playerMark || a.mark}-${planId}` });
        accepted.push({ record, answer: candidate, last, evidence: evidenceOf(candidate) });
        expect = last + 1;
    }
    const scene = answer?.scene && typeof answer.scene === 'object' ? { place: clean(answer.scene.place), time: clean(answer.scene.time), present: list(answer.scene.present) } : null;
    return { byExchange, chapters: accepted, scene, dropped, working: records };
}

// ---------------------------------------------------------------- rebuild: retire what a model made

const lastOrigin = r => r.versions?.at(-1)?.origin?.type || '';
/** The ids of the records a rebuild retires: every record a model made, except the ones you wrote or edited, locked records and stat sheets. */
export function modelMadeIds(result) {
    return (result?.current || []).filter(r => !r.locked && r.kind !== 'stat sheet' && !(r.versions || []).some(v => v.origin?.type === 'you')).map(r => r.id);
}

/** Write the one entry that retires every model-made record. Undo is one revert of that entry. Resolves { entry, count }. */
export async function retireModelMade(store, { reason = 'Rebuild: retired every record a model made.', type = 'catch-up' } = {}) {
    const ids = modelMadeIds(store.view());
    if (!ids.length) return { entry: '', count: 0 };
    const out = await store.record([{ op: 'retire', target: ids, origin: { type }, anchor: null, reason }]);
    return { entry: out.entries?.[0]?.id || '', count: ids.length };
}

// ---------------------------------------------------------------- the runner

const STAGES = ['map', 'cleanup', 'condensed', 'index'];
const newId = now => `cu${Number(now).toString(36)}`;

/**
 * The catch-up runner over a host. deps:
 *   chat(), meta(), chatId(), names() { char, user }, key (the extension's key on a message), store (src/memory/store.js), save(),
 *   runChain(chain, options), chainFor(job), enqueue(job), pump(), now(), memorySettings() { catchUpFree, speeds },
 *   facts({ probe }) async -> { [route]: { found, reachable, model, proven, context, weekly }, charging },
 *   askRoute() -> { route, price }, stages: { cleanup(plan), condensed(plan), index(plan) }, saveSettings(), measure(route, ms).
 */
export function createCatchUp(deps) {
    const d = deps;
    const listeners = new Set();
    let controller = null;
    const tell = () => { for (const fn of listeners) { try { fn(status()); } catch { /* a listener must not stop catch-up */ } } };
    const planOf = () => chatMemory(d.meta()).catchup || null;
    const setPlan = plan => { const mem = chatMemory(d.meta()); if (plan) mem.catchup = plan; else delete mem.catchup; };
    const settingsOf = () => d.memorySettings();

    function status() {
        const plan = planOf();
        if (!plan) return null;
        return { ...describe(plan), plan: structuredClone(plan) };
    }

    const jobFor = (plan, stage, cursorMark = '') => ({
        chatId: plan.chatId, kind: 'catchUp', subject: `${plan.id}:${plan.epoch || 0}:${stage}:${cursorMark}`, order: 0,
        sources: { plan: plan.id, stage, cursor: cursorMark, epoch: String(plan.epoch || 0) }, model: plan.model || '', payload: { plan: plan.id, stage },
    });

    async function queueNext(plan) {
        plan.updated = d.now();
        const job = jobFor(plan, plan.stage, plan.stage === 'map' ? plan.cursorMark || '' : '');
        await d.enqueue(job);
    }

    /** What the chat has waiting, with the facts of every route. probe: ask each free route one tiny question first. */
    async function assess({ probe = false, rebuild = false } = {}) {
        const chat = d.chat();
        const result = foldChat(chat, d.meta());
        const waiting = pending(chat, { result, rebuild, key: d.key });
        const facts = await d.facts({ probe });
        const ask = d.askRoute(facts);
        const speeds = settingsOf().speeds || {};
        return { ...waiting, facts, decision: chooseRoute({ facts, tokens: waiting.tokens, free: settingsOf().catchUpFree !== false, askRoute: ask.route, askPrice: ask.price, speeds }) };
    }

    function begin({ kind = 'catch-up', mode, route, tokens, count, est }) {
        const chat = d.chat();
        const id = newId(d.now());
        const plan = {
            id, kind, state: 'running', mode, route, model: d.chainFor(mode === 'now' ? 'catchUpNow' : 'catchUp').find(e => e.route === route)?.model || '',
            class: CLASS_OF[route] || 'mid', chatId: d.chatId(), stage: 'map', cursorMark: '', filedMark: '', epoch: 0,
            total: est?.calls || 1, done: 0, calls: 0, exchanges: count, filed: 0, records: 0, chapters: 0, dropped: 0, made: [], started: d.now(), updated: d.now(), scene: null, note: '',
        };
        const result = foldChat(chat, d.meta());
        const items = exchangeList(chat, { result, rebuild: kind === 'rebuild', key: d.key });
        const firstNew = items.find(ex => ex.status === 'new');
        const at = firstNew ? items.indexOf(firstNew) : 0;
        plan.cursorMark = (items[Math.max(0, at - 2)] || firstNew || {}).mark || '';
        return plan;
    }

    async function start(options) {
        const plan = begin(options);
        setPlan(plan);
        await d.save();
        await queueNext(plan);
        d.pump();
        tell();
        return plan;
    }

    /** At chat open: resume a saved plan, start by itself when a free route passes the tests, or ask first. */
    async function evaluate({ probe = true } = {}) {
        const plan = planOf();
        if (plan?.state === 'running') { await queueNext(plan); d.pump(); return { resumed: true, plan }; }
        const chat = d.chat();
        const waiting = pending(chat, { result: foldChat(chat, d.meta()), key: d.key });
        if (waiting.count < START_AT) { if (plan?.state === 'asking' || plan?.state === 'waiting') { setPlan(null); await d.save(); tell(); } return { skipped: 'few', count: waiting.count }; }
        if (plan?.state === 'declined' && waiting.count < (plan.declinedAt || 0) + START_AT) return { skipped: 'declined' };
        if (plan?.state === 'paused') return { skipped: 'paused' };
        const seen = await assess({ probe });
        const { decision } = seen;
        if (decision.mode === 'auto') {
            const started = await start({ mode: 'auto', route: decision.route, tokens: seen.tokens, count: seen.count, est: decision.est });
            return { started: true, plan: started, decision };
        }
        const ask = { route: decision.route, calls: decision.est?.calls || 0, minutes: decision.est?.minutes || 0, cost: decision.cost || 0, failed: decision.failed, line: costLine(decision.est, { free: !PAID.has(decision.route), cost: decision.cost, route: decision.route }), count: seen.count };
        const waitingForDesktop = plan?.state === 'waiting';
        setPlan({ id: plan?.id || newId(d.now()), kind: 'catch-up', state: waitingForDesktop ? 'waiting' : 'asking', ask, chatId: d.chatId(), asked: d.now(), updated: d.now() });
        await d.save();
        tell();
        return { asked: true, decision };
    }

    /** Catch up this chat now (a tap). A free route that passes runs it; otherwise the Run now chain does, inside the ceiling. */
    async function startTapped() {
        const seen = await assess({ probe: true });
        if (!seen.count) throw new Error('Nothing waits for catch-up: every reply is filed.');
        const { decision } = seen;
        const passing = (decision.trials || []).find(t => t.pass);
        if (!passing && !decision.route) throw new Error(`No route can run catch-up now. ${decision.failed.map(f => f.text).join('. ')}.`);
        const pick = passing || { route: decision.route, est: decision.est };
        return start({ kind: 'catch-up', mode: passing ? 'tapped' : 'now', route: pick.route, tokens: seen.tokens, count: seen.count, est: pick.est });
    }

    /** Run now on the ask card: the Run now chain, inside the ceiling. */
    async function runNow() {
        const plan = planOf();
        const seen = await assess({ probe: false, rebuild: plan?.kind === 'rebuild' });
        const ask = d.askRoute(seen.facts);
        if (!ask.route) throw new Error('No route can run catch-up now. Check Setup, Connections.');
        const est = estimateRun({ tokens: seen.tokens, route: ask.route, speed: (settingsOf().speeds || {})[ask.route] || null });
        return start({ mode: 'now', route: ask.route, tokens: seen.tokens, count: seen.count, est, kind: plan?.kind === 'rebuild' ? 'rebuild' : 'catch-up' });
    }

    async function waitForDesktop() {
        const plan = planOf();
        if (plan) { plan.state = 'waiting'; plan.updated = d.now(); await d.save(); tell(); }
    }

    async function notNow() {
        const chat = d.chat();
        const waiting = pending(chat, { result: foldChat(chat, d.meta()), key: d.key });
        setPlan({ id: planOf()?.id || newId(d.now()), kind: 'catch-up', state: 'declined', declinedAt: waiting.count, chatId: d.chatId(), updated: d.now() });
        await d.save();
        tell();
    }

    async function cancel() {
        const plan = planOf();
        if (!plan || plan.state !== 'running') return false;
        plan.state = 'cancelled';
        plan.note = 'Cancelled. What was filed stays.';
        plan.updated = d.now();
        controller?.abort(new Error('Cancelled.'));
        await d.save();
        tell();
        return true;
    }

    async function resume() {
        const plan = planOf();
        if (!plan || !['paused', 'cancelled'].includes(plan.state)) return false;
        plan.state = 'running';
        plan.epoch = (plan.epoch || 0) + 1;
        plan.note = '';
        await d.save();
        await queueNext(plan);
        d.pump();
        tell();
        return true;
    }

    /** Rebuild: one entry retires every model-made record (undoable), then catch-up runs from the first message. */
    async function rebuild() {
        const store = d.store;
        const retired = await retireModelMade(store);
        const seen = await assess({ probe: true, rebuild: true });
        const decision = seen.decision;
        const passing = (decision.trials || []).find(t => t.pass);
        const route = passing ? passing.route : decision.route;
        if (!route) { if (retired.entry) await store.revert(retired.entry, 'Rebuild could not start: no route answers.'); throw new Error('No route can rebuild this chat now. Check Setup, Connections.'); }
        const est = passing ? passing.est : decision.est;
        const plan = await start({ kind: 'rebuild', mode: passing ? 'tapped' : 'now', route, tokens: seen.tokens, count: seen.count, est });
        plan.retired = retired;
        await d.save();
        return plan;
    }

    /** Undo a rebuild in one tap: the retire entry is reverted and the records the rebuild made are retired. */
    async function undoRebuild() {
        const plan = planOf();
        if (!plan || plan.kind !== 'rebuild' || !plan.retired?.entry) return { undone: false, reason: 'There is no rebuild to undo.' };
        if (plan.state === 'running') await cancel();
        const result = d.store.view();
        const made = (plan.made || []).filter(id => result.byId.get(id) && !OUT_OF_FORCE.includes(result.byId.get(id).status) && !result.byId.get(id).locked);
        await d.store.revert(plan.retired.entry, 'Rebuild undone.');
        if (made.length) await d.store.record([{ op: 'retire', target: made, origin: { type: 'you' }, anchor: null, reason: 'Rebuild undone: the records it made are retired.' }]);
        plan.state = 'undone';
        plan.note = 'Rebuild undone. The earlier records are back.';
        await d.save();
        tell();
        return { undone: true, restored: plan.retired.count, retired: made.length };
    }

    // ------------------------------------------------------------ one part

    const entryFor = plan => {
        const entry = { ...(d.chainFor(plan.mode === 'now' ? 'catchUpNow' : 'catchUp').find(e => e.route === plan.route) || { route: plan.route }) };
        entry.timeoutMs = Math.max(entry.timeoutMs || 0, plan.route === 'phone' ? 20 * 60 * 1000 : 4 * 60 * 1000);
        return entry;
    };

    const indexOfMark = (chat, mark) => (mark ? chat.findIndex(m => storedMark(m) === mark) : -1);

    async function runMap(plan, signal) {
        const chat = d.chat(), meta = d.meta();
        d.store.marks();
        const result = foldChat(chat, meta);
        const rebuildMode = plan.kind === 'rebuild';
        const filedAt = indexOfMark(chat, plan.filedMark);
        const items = withBoundaries(chat, exchangeList(chat, { result, rebuild: rebuildMode, filedIndex: Math.max(0, filedAt), key: d.key }), d.key);
        const cursorAt = Math.max(1, indexOfMark(chat, plan.cursorMark));
        const target = CHUNK[plan.class] || CHUNK.local;
        const chunk = pickChunk(items, { cursorIndex: cursorAt, target, key: d.key, chat });
        if (!chunk.newCount) return advance(plan, 'cleanup');
        const names = d.names();
        const cast = castOf(result, names);
        const request = mapRequest({ chunk, result, scene: plan.scene, cast, routeClass: plan.class, final: chunk.final, closeLast: !chunk.final && !!items.find(ex => ex.index === chunk.exchanges.at(-1).index)?.boundary });
        const remaining = items.filter(ex => ex.status === 'new').reduce((sum, ex) => sum + ex.tokens, 0);
        plan.total = plan.done + Math.max(1, Math.ceil(remaining * 1.05 / target));
        const started = d.now();
        const res = await d.runChain([entryFor(plan)], {
            job: plan.mode === 'now' ? 'catchUpNow' : 'catchUp', system: request.system, user: request.user, schema: { name: MAP_SCHEMA.name, value: request.schema, read: request.read },
            tokens: OUT_TOKENS + 900, signal, background: true, label: `Catch-up, part ${plan.done + 1} of ${plan.total}`,
        });
        if (!res.ok) return { ok: false, waiting: res.waiting, reason: res.reason };
        d.measure?.(plan.route, d.now() - started);
        if (d.chatId() !== plan.chatId || planOf()?.id !== plan.id || planOf()?.state !== 'running') return { ok: true, value: { stale: true } };

        // The chat may have moved while the model worked: an exchange whose reply no longer shows what was read is left for the next pass.
        const live = chunk.exchanges.filter(ex => ex.status === 'new').filter(ex => { const m = chat[ex.index]; return m && storedMark(m) === ex.mark && revisionOf(m).hash === ex.hash; });
        if (!live.length) return { ok: false, reason: 'The chat changed while the model worked.' };
        const liveSet = new Set(live.map(ex => ex.index));
        const call = `${res.route}:${d.now()}`;
        const checked = checkMap(res.value, { chat, chunk: { ...chunk, exchanges: chunk.exchanges.map(ex => (ex.status === 'new' && !liveSet.has(ex.index) ? { ...ex, status: 'context' } : ex)) }, result, cast, places: placesOf(result), origin: { route: res.route, model: res.model, call }, planId: plan.id.slice(-4) });
        let added = 0;
        const madeIds = [];
        for (const ex of live) {
            const inputs = checked.byExchange.get(ex.index) || [];
            if (!inputs.length) continue;
            await d.store.recordOnReply(ex.index, inputs, { save: false });
            for (const input of inputs) { if (input.op === 'add' && input.record?.id) madeIds.push(input.record.id); if (input.op === 'supersede' && input.record?.id) madeIds.push(input.record.id); }
            added += inputs.length;
        }
        if (checked.chapters.length) {
            await d.store.record(checked.chapters.map(c => ({ op: 'add', record: c.record, origin: { type: 'catch-up', route: res.route, model: res.model, call }, anchor: { mark: c.record.to }, evidence: c.evidence, reason: 'Chapter written by catch-up.' })), { save: false });
            for (const c of checked.chapters) madeIds.push(c.record.id);
        }
        const lastLive = live.at(-1);
        for (const ex of live) {
            const message = chat[ex.index];
            const last = ex === lastLive;
            const tracker = last && checked.scene ? { scene: sceneFor({ header: null, captured: { place: checked.scene.place, time: checked.scene.time, present: checked.scene.present }, previous: {}, headerReliable: false, reply: replyNumber(chat, ex.index), previousReply: 0 }) } : null;
            stampMessage(message, { hash: ex.hash, at: d.now(), route: 'catch-up', model: res.model, ops: (checked.byExchange.get(ex.index) || []).length, tracker, key: d.key });
        }
        if (live.length) {
            const mark = watermarkOf(chat);
            chatMemory(meta).capture = { watermark: { mark: mark.mark, reply: mark.reply } };
        }
        // Where the next stretch starts: after the last chapter filed, or a few exchanges back when none closed.
        const shown = chunk.exchanges;
        if (checked.chapters.length) {
            const lastExchange = shown[checked.chapters.at(-1).last - 1];
            const after = items.find(ex => ex.index > lastExchange.index);
            plan.cursorMark = after ? storedMark(chat[after.index]) : '';
        } else if (!chunk.final) {
            const keep = shown[Math.max(0, shown.length - 4)];
            plan.cursorMark = storedMark(chat[keep.index]);
        }
        if (lastLive) plan.filedMark = storedMark(chat[lastLive.index]);
        if (checked.scene) plan.scene = checked.scene;
        plan.done += 1;
        plan.calls += 1;
        plan.filed += live.length;
        plan.records += added;
        plan.chapters += checked.chapters.length;
        plan.dropped += checked.dropped.length;
        plan.made = [...(plan.made || []), ...madeIds];
        plan.updated = d.now();
        forgetFold(meta);
        if (chunk.final) plan.stage = 'cleanup';
        await d.save();
        tell();
        await queueNext(plan);
        d.pump();
        return { ok: true, route: res.route, value: { filed: live.length, records: added, chapters: checked.chapters.length } };
    }

    async function advance(plan, stage) {
        plan.stage = stage;
        plan.updated = d.now();
        await d.save();
        tell();
        await queueNext(plan);
        d.pump();
        return { ok: true, value: { advanced: stage } };
    }

    async function runStage(plan, stage, signal) {
        const run = d.stages?.[stage];
        try { await run?.(plan, { signal }); }
        catch (error) { plan.note = `${stage}: ${String(error?.message || error)}`.slice(0, 200); }
        const next = STAGES[STAGES.indexOf(stage) + 1];
        if (next) return advance(plan, next);
        plan.state = 'done';
        plan.updated = d.now();
        await d.save();
        tell();
        return { ok: true, value: { done: true } };
    }

    /** The queue handler: one part of the saved plan. */
    async function run(job, { signal } = {}) {
        if (job.chatId && d.chatId() !== job.chatId) return { ok: false, waiting: true, reason: 'The chat is not open.' };
        const plan = planOf();
        if (!plan || plan.id !== job.payload?.plan || plan.state !== 'running' || plan.stage !== job.payload.stage) return { ok: true, value: { skipped: true } };
        controller = new AbortController();
        const stop = () => controller.abort(signal?.reason);
        signal?.addEventListener?.('abort', stop, { once: true });
        try {
            if (job.tries >= 4) {
                plan.state = 'paused';
                plan.note = 'The route gave no usable answer four times. Resume tries again.';
                await d.save();
                tell();
                return { ok: true, value: { paused: true } };
            }
            if (plan.stage === 'map') return await runMap(plan, controller.signal);
            return await runStage(plan, plan.stage, controller.signal);
        } finally { signal?.removeEventListener?.('abort', stop); controller = null; }
    }

    /** The jobs a reopened chat still needs: the saved plan's next part. */
    function missingWork(chat, chatId) {
        const plan = planOf();
        if (!plan || plan.state !== 'running' || plan.chatId !== chatId) return [];
        return [jobFor(plan, plan.stage, plan.stage === 'map' ? plan.cursorMark || '' : '')];
    }

    return {
        status, assess, evaluate, start, startTapped, runNow, waitForDesktop, notNow, cancel, resume, rebuild, undoRebuild, run, missingWork,
        onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); }, plan: planOf,
    };
}

// ---------------------------------------------------------------- the status line

/** The words of the status line and the ask card for a saved plan. */
export function describe(plan) {
    const where = routeWord(plan.route);
    const verb = plan.kind === 'rebuild' ? 'Rebuilding' : 'Catching up';
    if (plan.state === 'running') {
        const part = { map: `part ${Math.min(plan.done + 1, plan.total)} of ${plan.total}`, cleanup: 'tidying records', condensed: 'writing the condensed account', index: 'updating the search index' }[plan.stage] || '';
        return { state: 'running', text: `${verb} on ${where}: ${part}`, cancel: true };
    }
    if (plan.state === 'paused') return { state: 'paused', text: `${verb} paused: ${plan.note || 'the route did not answer'}`, resume: true };
    if (plan.state === 'cancelled') return { state: 'cancelled', text: `${verb} cancelled after ${plan.filed || 0} of ${plan.exchanges || 0} exchanges. What was filed stays.`, resume: true, undo: plan.kind === 'rebuild' };
    if (plan.state === 'done') return { state: 'done', text: `${plan.kind === 'rebuild' ? 'Rebuilt' : 'Caught up'}: ${plan.filed} exchanges read, ${plan.records} records and ${plan.chapters} chapters filed${plan.dropped ? `, ${plan.dropped} dropped by the checks` : ''}.`, undo: plan.kind === 'rebuild' };
    if (plan.state === 'undone') return { state: 'undone', text: plan.note };
    if (plan.state === 'asking') return { state: 'asking', text: `${plan.ask.count} exchanges are not in memory yet. It did not start by itself: ${plan.ask.failed.map(f => f.text).join('; ')}.`, ask: plan.ask };
    if (plan.state === 'waiting') return { state: 'waiting', text: 'Waiting for the desktop. Catch-up starts by itself when it answers.', ask: plan.ask };
    if (plan.state === 'declined') return { state: 'declined', text: 'Catch-up is on hold for this chat until 20 more exchanges pile up. Catch up this chat starts it now.' };
    return { state: plan.state, text: '' };
}

// ---------------------------------------------------------------- wired to SillyTavern

/** The route facts of this device, for the five tests. probe: ask each free route one tiny structured question first. */
export async function hostFacts({ probe = false, now = Date.now(), parts } = {}) {
    const P = parts || await hostParts();
    const detected = P.routing.detectRoutes();
    const memory = P.settings().memory || {};
    const out = {};
    for (const route of FREE_ORDER) {
        if (!detected[route]) continue;
        const entry = P.routing.chainFor('catchUp').find(e => e.route === route) || {};
        const fresh = () => Object.entries(P.routing.routeHealth(P.clock())).filter(([k]) => k === route || k.startsWith(`${route}:`)).map(([, v]) => v);
        const age = () => { const ok = Math.max(0, ...fresh().map(v => v.lastOk || 0)); return ok ? P.clock() - ok : Infinity; };
        let answered = age() <= BAR.freshMs;
        const down = fresh().some(v => v.down);
        if (!answered && !down && probe && route !== 'phone') {
            const res = await P.routing.runChain([{ ...entry, timeoutMs: 15000 }], { job: 'catchUp', system: 'Answer with the JSON the schema asks for.', user: 'Return {"ok": true}.', schema: { name: 'probe', value: strictSchema({ type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }), read: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }, tokens: 24, background: true, label: `Catch-up probe, ${route}` }).catch(() => ({ ok: false }));
            answered = res.ok;
        }
        out[route] = { found: true, reachable: answered && !down, model: entry.model || '', proven: !!(memory.catchUpProven || {})[entry.model], context: (memory.routeContext || {})[route] || CONTEXT[route], weekly: memory.nanoWeekly || BAR.weekly };
    }
    out.charging = await chargingNow();
    return out;
}

async function chargingNow() {
    try { const battery = await globalThis.navigator?.getBattery?.(); return battery ? battery.charging === true : null; } catch { return null; }
}

let loaded = null;
async function hostParts() {
    if (loaded) return loaded;
    const [st, store, routing, memStore, queue] = await Promise.all([import('../st.js'), import('../store.js'), import('../routing.js'), import('./store.js'), import('./queue.js')]);
    loaded = { st, settings: store.settings, saveSettings: store.saveSettings, routing, memStore, queue, clock: () => Date.now() };
    return loaded;
}

/** The first route of the Run now chain this device can use: found and not down. */
function askRouteOf(P, facts) {
    const detected = P.routing.detectRoutes();
    const health = P.routing.routeHealth();
    for (const entry of P.routing.chainFor('catchUpNow')) {
        if (!detected[entry.route]) continue;
        if (Object.entries(health).some(([k, v]) => (k === entry.route || k.startsWith(`${entry.route}:`)) && v.down)) continue;
        return { route: entry.route, price: entry.price || null };
    }
    return { route: '', price: null };
}

/** The runner over the open chat in SillyTavern. */
export function hostCatchUp(P) {
    const queue = P.queue.desktopQueue();
    const c = () => P.st.ctx();
    const runner = createCatchUp({
        chat: () => c().chat || [], meta: () => c().chatMetadata || {}, chatId: () => String(c().getCurrentChatId?.() || ''),
        names: () => P.st.names(), key: P.st.KEY, store: P.memStore.memoryStore(), save: async () => { await (c().saveChat?.() ?? c().saveMetadata?.()); },
        runChain: (chain, options) => P.routing.runChain(chain, options), chainFor: job => P.routing.chainFor(job),
        enqueue: job => queue.enqueue({ ...job, model: job.model || P.queue.desktopModelFor('catchUp') }), pump: () => { queue.pump(); }, now: () => Date.now(),
        memorySettings: () => (P.settings().memory ||= {}),
        facts: ({ probe } = {}) => hostFacts({ probe, parts: P }),
        askRoute: facts => askRouteOf(P, facts),
        measure: (route, ms) => { const mem = (P.settings().memory ||= {}); const speeds = (mem.speeds ||= {}); const before = speeds[route]?.perCall; speeds[route] = { perCall: Math.round(before ? before * 0.6 + (ms / 1000) * 0.4 : ms / 1000) }; P.saveSettings(); },
        stages: {
            cleanup: async (plan, { signal }) => {
                const upkeep = await import('./upkeep.js');
                await upkeep.afterReply({ force: false });
                // one Cleanup call: a second batch stays queued for the next Tidy
                let used = 0;
                const once = options => { if (used++) return Promise.resolve({ ok: false, reason: 'one Cleanup call per catch-up' }); return P.routing.runChain(P.routing.chainFor('tidy'), { job: 'tidy', ...options }); };
                await upkeep.runTidy({ runChainFn: once, signal });
            },
            condensed: async () => { await (await import('../chapters.js')).queueChapterWork(); },
            // the search index is brought up to date in the background; catch-up does not wait for the model to load
            index: async () => { (await import('../recall.js')).warmRecall().catch(() => {}); },
        },
    });
    queue.handle('catchUp', { run: (job, options) => runner.run(job, options), commit: async () => {}, saved: () => false });
    P.queue.addRebuilder((chat, chatId) => runner.missingWork(chat, chatId));
    return runner;
}

let shared = null;
/** The catch-up runner of this page, created on first use. Resolves once its queue handler and rebuilder are in place. */
export async function catchUp() {
    if (shared) return shared;
    const P = await hostParts();
    return shared ||= hostCatchUp(P);
}

let started = false;
/**
 * Wire catch-up to the host once: a check each time a chat opens (after its memory moved into chat data), and again when the
 * desktop answers while catch-up waits for it. Safe to call twice.
 */
export async function startCatchUp() {
    if (started) return;
    started = true;
    const runner = await catchUp();
    const P = await hostParts();
    let checking = false;
    const check = async () => {
        if (checking) return;
        checking = true;
        try {
            const meta = P.st.ctx().chatMetadata;
            for (let i = 0; i < 60 && !meta?.[MEMORY]?.imported; i++) await new Promise(resolve => setTimeout(resolve, 500));
            if (!meta?.[MEMORY]?.imported || meta[MEMORY].off === true || P.settings().enabled === false) return;
            await runner.evaluate({ probe: true });
        } catch (error) { console.warn('[Roleplay Instructions]', 'catch-up check', error); }
        finally { checking = false; }
    };
    P.st.on('CHAT_CHANGED', () => setTimeout(check, 1500));
    P.routing.onChainResult(result => { if (result.ok && result.route === 'desktop' && runner.plan()?.state === 'waiting') check(); });
    if (P.st.isChatOpen()) setTimeout(check, 1500);
}

