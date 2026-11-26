// Judgment calls before the reply (memory DESIGN 7.7 and 9.2): a dice attempt with its difficulty and stance, an
// out-of-character aside that code cannot settle. Whether a reply changed a lasting fact is capture's call (MB17). Each runs in code first;
// code skips the call on a turn with no action by anyone. Every other turn goes to the routes in order:
//   1. the desktop's resident gemma4:12b over Tailscale, one structured answer, within a 1 s limit;
//   2. with the desktop unreachable or late, the on-phone Gemma 4 E2B, as one-word items (about 2.6 s each);
//   3. Jev's slot, within the ceiling: with her OpenRouter key saved in Setup, Connections, Background jobs, the calibrated
//      jev-1.13 on OpenRouter's decisions endpoint (typed questions, one call); with no key, or when that fails or is
//      refused, jev-router through SillyTavern's own OpenRouter connection (that key stays there);
//   4. code's default.
// B22 writes the dice judge's wording (src/dice-judge.js) and MB14 stores the roll; this file routes the call.
import { askFull, parseJson } from '../st.js';
import { chainFor, reportChainResult, resolveRoute, routeHealth, runChain, schemaProblem } from '../routing.js';
import { saveSettings, settings } from '../store.js';
import { catalogCost, recordSpend, releaseSpend, reserveSpend } from '../spend.js';
import { askOneWord, phoneModelReady } from './phone-model.js';
import { desktopQueue } from './queue.js';

export const DESKTOP_LIMIT_MS = 1000;
export const MISS_MS = 60 * 1000;
export const JEV_ROUTER = Object.freeze({ route: 'openrouter', model: 'typesafe/jev-router', price: { in: 0.10, out: 0.40 }, timeoutMs: 3000 });
// The calibrated decision model (DECISIONS, MB8 follow-ups): typed questions posted straight to OpenRouter with her key.
// OpenRouter billed US$0.042 per million input tokens and nothing for output when measured (memory/m1b-jeved.md 6.2).
export const JEV_MODEL = 'typesafe/jev-1.13';
export const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
export const JEV_PRICE = Object.freeze({ in: 0.042, out: 0 });
export const JEV_TIMEOUT_MS = 3000;

/** The OpenRouter key she saved for jev-1.13. It lives only in this extension's settings and goes only to OpenRouter. */
export const jevKey = () => String(settings().jev?.key || '');
export const hasJevKey = () => !!jevKey();

/** Save the key, or remove it with an empty string. It is never logged and never shown again once saved. */
export function setJevKey(key) {
    const st = settings();
    const value = String(key ?? '').trim();
    st.jev = st.jev && typeof st.jev === 'object' ? st.jev : {};
    if (value) st.jev.key = value; else delete st.jev.key;
    saveSettings();
    return hasJevKey();
}

/** The five difficulty steps and their numbers (M1l 5). Fair is the middle step and code's default. */
export const STEPS = Object.freeze([['Easy', 8], ['Fair', 11], ['Hard', 14], ['Very hard', 17], ['Extreme', 20]]);
export const STANCES = Object.freeze(['helping', 'neutral', 'resisting']);
export const STATS = Object.freeze(['Strength', 'Agility', 'Wits', 'Charm', 'Will', 'Senses']);

// The kind of action names the stat when the phone or code decides: force, finesse, persuasion and so on.
const STAT_WORDS = [
    ['Strength', /\b(attack|strike|hit|punch|kick|lift|shove|push|force|break|smash|wrestle|grapple|haul|pull|bash|carry|hold (?:back|off))\w*/i],
    ['Agility', /\b(sneak|dodge|leap|jump|climb|balance|pick(?:s|ed|ing)? the lock|steal|pickpocket|tumble|flee|run|sprint|catch|duck|evade|slip|hide|vault|swing)\w*/i],
    ['Charm', /\b(persuade|convince|charm|seduce|flatter|bluff|lie|deceive|negotiate|bargain|haggle|plead|talk (?:him|her|them) into)\w*/i],
    ['Will', /\b(resist|endure|withstand|intimidate|threaten|stare (?:him|her|them) down|hold (?:my|her|his) nerve|refuse to yield)\w*/i],
    ['Senses', /\b(search|spot|notice|listen|track|scan|watch for|look for|sniff|perceive|keep watch)\w*/i],
    ['Wits', /\b(recall|decipher|deduce|figure out|solve|study|examine|investigate|analy[sz]e|identify|translate|pick apart)\w*/i],
];
const ATTEMPT_WORDS = /\b(try|tries|tried|trying|attempt\w*|manage\w* to|struggle\w* to|do my best to|see if I can|risk\w*)\b/i;
const SAID = /\b(I|we|you|he|she|they|it|[A-Z][a-z]+)\s+(?:quietly\s+|softly\s+|finally\s+)?(say|said|says|ask|asks|asked|reply|replies|replied|whisper\w*|murmur\w*|answer\w*|tell|tells|told|call\w* out|shout\w*|add\w*|continue\w*|mutter\w*|laugh\w*|sigh\w*|nod\w*|smile\w*)\b[^.!?]*[.!?]?/g;
const OOC = /^\s*(?:\(\(|\[\s*ooc\b|\(\s*ooc\b|ooc\s*:|\/\/)/i;

/** The stat code names from the kind of action, or '' when no action word names one. */
export function statFromText(text) {
    for (const [stat, words] of STAT_WORDS) if (words.test(String(text || ''))) return stat;
    return '';
}

/**
 * Code's screen of a turn. skip is true only for a turn with no action by anyone: dialogue alone or an
 * out-of-character aside, with no open threat or plan of an NPC among the Pending and Plan threads.
 * threads: [{ kind: 'pending' | 'plan' | ..., status: 'open' | ..., by: 'npc' | 'user', threat?: boolean }].
 */
export function screenTurn(message, { threads = [] } = {}) {
    const text = String(message || '').trim();
    const ooc = OOC.test(text) || /^\(.*\)$/s.test(text);
    const openNpcMove = threads.some(t => t && t.status !== 'closed' && t.by !== 'user' && (t.threat || ['pending', 'plan'].includes(String(t.kind || '').toLowerCase())));
    const narrative = ooc ? '' : text.replace(/"[^"]*"|“[^”]*”|«[^»]*»/g, ' ').replace(SAID, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const attemptWords = !ooc && (ATTEMPT_WORDS.test(text) || !!statFromText(narrative));
    const action = !!narrative;
    const skip = !openNpcMove && !action;
    return { skip, ooc, action, openNpcMove, attemptWords, stat: statFromText(narrative || text), reason: skip ? (ooc ? 'an out-of-character aside' : 'dialogue alone') : '' };
}

/** Who acts, read by code: a named NPC who is the subject before an action word, else the persona. */
export function actorFromText(text, npcNames = []) {
    for (const name of npcNames) {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(^|[.!?]\\s+)${escaped}\\s+(?:\\w+ly\\s+)?(?:tries|attempts|lunges|swings|reaches|draws|moves|steps|grabs|runs)`, 'i').test(String(text || ''))) return name;
    }
    return 'user';
}

const stepName = index => STEPS[Math.max(0, Math.min(STEPS.length - 1, index))][0];

// The unsure band (MB15). Jev answers a noul question with the probability that the statement is true. A score at or above
// the upper cut is yes, at or below the lower cut is no, and a score between them takes the question's default. The default
// is what code does today on a "no": no roll for an attempt, the message stays in the story, no fact change to write. An
// unsure score is never handed to another route, so the band adds no calls.
// Source of the numbers: Statosphere's classifier threshold defaults to 0.7 (src/Stage.tsx:37, :457; audit/A13-statosphere.md
// rec. 3), and the lower cut is its mirror, 1 - 0.7 = 0.3. Heather's ruling of 25 November 2026 (DECISIONS.md) adopts the band.
// Measured on the M1g story with d3:4b, in docs/ux-overhaul/tickets/MB15.md.
export const BAND_UPPER = 0.7;
export const BAND_LOWER = 0.3;
export const BANDS = Object.freeze({
    attempt: Object.freeze({ upper: BAND_UPPER, lower: BAND_LOWER, default: false }),
    aside: Object.freeze({ upper: BAND_UPPER, lower: BAND_LOWER, default: false }),
});

/** Read one noul score against its band: { yes, unsure, score }. A missing or non-numeric score is a no, as before the band. */
export function readBand(score, band) {
    const n = Number(score);
    if (score === undefined || score === null || !Number.isFinite(n)) return { yes: false, unsure: false, score: null };
    if (n >= band.upper) return { yes: true, unsure: false, score: n };
    if (n <= band.lower) return { yes: false, unsure: false, score: n };
    return { yes: !!band.default, unsure: true, score: n };
}

const bandYes = (answers, key) => readBand(answers?.[key]?.noul, BANDS[key]).yes;

/** The receipt lines for the noul answers that fell in the band: the score and that the default applied. */
export function unsureReceipts(answers, bands = BANDS) {
    const lines = [];
    for (const [key, band] of Object.entries(bands)) {
        const read = readBand(answers?.[key]?.noul, band);
        if (read.unsure) lines.push(`${key} scored ${read.score.toFixed(2)}, between ${band.lower} and ${band.upper}, so the default (${band.default ? 'yes' : 'no'}) applied`);
    }
    return lines;
}

/** The dice judgment: one structured answer from the desktop, two one-word items on the phone, a code default. */
export const DICE = Object.freeze({
    name: 'dice',
    schema: {
        name: 'dice_judgment', strict: true,
        value: {
            type: 'object', required: ['attempt', 'actor', 'stat', 'difficulty', 'stance'],
            properties: {
                attempt: { type: 'boolean' }, actor: { type: 'string' }, stat: { type: 'string', enum: [...STATS] },
                difficulty: { type: 'string', enum: STEPS.map(([name]) => name) }, stance: { type: 'string', enum: [...STANCES] },
            },
        },
    },
    system: 'You set up dice for a roleplay turn. An attempt is an action whose outcome is uncertain: a fight, a climb, a lie, a search. '
        + 'Say whether this turn holds one, who makes it (user for the player, or the NPC by name), the stat it uses, its difficulty step and the stance of whoever resists it. '
        + 'Answer with JSON on one line and nothing else.',
    user: ({ message, scene = '' }) => [scene ? `Scene: ${scene}` : '', `Player message: ${message}`].filter(Boolean).join('\n'),
    phone: [
        { key: 'attempt', question: ({ message }) => `Player message: ${message}\nDoes this message make an attempt whose outcome is uncertain? Answer yes or no.`, options: ['yes', 'no'] },
        { key: 'difficulty', when: answers => answers.attempt === 'yes', options: ['1', '2', '3', '4', '5'],
            question: ({ message }) => `Player message: ${message}\nHow hard is the attempt? Answer 1 for easy, 2 fair, 3 hard, 4 very hard, 5 extreme.` },
    ],
    fromPhone(answers, input, screen) {
        if (answers.attempt !== 'yes') return { attempt: false, actor: 'user', stat: screen.stat || 'Wits', difficulty: 'Fair', stance: 'neutral' };
        return { attempt: true, actor: actorFromText(input.message, input.npcNames), stat: screen.stat || 'Wits', difficulty: stepName(Number(answers.difficulty || 2) - 1), stance: 'neutral' };
    },
    codeDefault(input, screen) {
        return { attempt: !!screen.attemptWords, actor: actorFromText(input.message, input.npcNames), stat: screen.stat || 'Wits', difficulty: 'Fair', stance: 'neutral' };
    },
    decision: {
        bands: { attempt: BANDS.attempt },
        state: ({ message, scene = '' }) => ({ message: String(message || ''), ...(scene ? { scene: String(scene) } : {}) }),
        questions: {
            attempt: { type: 'noul', instructions: '`message` holds an attempt whose outcome is uncertain: a fight, a climb, a lie, a search.' },
            stat: { type: 'choice', instructions: 'Which stat does the attempt in `message` rest on?', criteria: {
                Strength: 'force, endurance, hauling, fighting', Agility: 'speed, balance, stealth, dodging', Wits: 'reasoning, memory, solving, studying',
                Charm: 'persuasion, deception, bargaining', Will: 'nerve, resisting, intimidating', Senses: 'noticing, searching, tracking' } },
            difficulty: { type: 'choice', instructions: 'How hard is the attempt in `message`?', criteria: {
                Easy: 'most people succeed', Fair: 'an even chance for a capable person', Hard: 'needs skill or luck',
                'Very hard': 'only a few succeed', Extreme: 'close to impossible' } },
            stance: { type: 'choice', instructions: 'What is the stance of whoever resists the attempt in `message`?', criteria: {
                helping: 'the resisting side helps', neutral: 'no one resists or helps', resisting: 'someone works against it' } },
        },
        fromAnswers: (answers, input) => ({ attempt: bandYes(answers, 'attempt'), actor: actorFromText(input.message, input.npcNames),
            stat: answers?.stat?.choice, difficulty: answers?.difficulty?.choice, stance: answers?.stance?.choice }),
    },
    normalize(value) {
        const stat = STATS.find(s => s.toLowerCase() === String(value?.stat || '').toLowerCase());
        const step = STEPS.find(([name]) => name.toLowerCase() === String(value?.difficulty || '').toLowerCase());
        const stance = STANCES.find(s => s === String(value?.stance || '').toLowerCase());
        if (typeof value?.attempt !== 'boolean' || !stat || !step || !stance) return null;
        return { attempt: value.attempt, actor: String(value.actor || 'user').trim() || 'user', stat, difficulty: step[0], stance };
    },
});

/** An out-of-character aside that code cannot settle from its markers. */
export const ASIDE = Object.freeze({
    name: 'aside',
    schema: { name: 'aside_judgment', strict: true, value: { type: 'object', required: ['aside'], properties: { aside: { type: 'boolean' } } } },
    system: 'Say whether the player steps out of the story to speak to the narrator or the app. Acting or speaking as their character is inside the story. Answer with JSON on one line and nothing else.',
    user: ({ message }) => `Player message: ${message}`,
    // No phone items: the on-phone model answered "no" to 11 of 12 real asides (MB16), so the aside goes to the desktop or Jev's slot.
    codeDefault: (_input, screen) => ({ aside: !!screen.ooc }),
    normalize: value => typeof value?.aside === 'boolean' ? { aside: value.aside } : null,
    decision: {
        bands: { aside: BANDS.aside },
        state: ({ message }) => ({ message: String(message || '') }),
        questions: { aside: { type: 'noul', instructions: 'In `message` the player steps out of the story to speak to the narrator or the app, outside their character.' } },
        fromAnswers: answers => ({ aside: bandYes(answers, 'aside') }),
    },
});


let desktopMissUntil = 0;

/** Forget the desktop misses of judgment calls. Tests and the Test button use it. */
export function resetJudgmentHealth() {
    desktopMissUntil = 0;
}

const desktopDown = now => now < desktopMissUntil || Object.entries(routeHealth(now)).some(([key, value]) => key.startsWith('desktop') && value.down);

async function askDesktop({ system, user, schema, signal }) {
    const entry = chainFor('judgment').find(item => item.route === 'desktop') || { route: 'desktop', model: 'gemma4:12b' };
    const target = resolveRoute(entry);
    if (!target || target.kind !== 'profile') return { skipped: 'no desktop connection on this host' };
    const res = await askFull({ system, user, tokens: 120, profileId: target.profileId, model: entry.model, schema, mode: 'schema', effort: 'none', signal });
    return { ...res, model: entry.model };
}

const scrub = (text, key) => (key ? String(text).split(key).join('[key]') : String(text)).slice(0, 200);

/**
 * jev-1.13 on OpenRouter's decisions endpoint: typed questions in one call, metered under the ceiling. The key goes in
 * the header of this one request to OpenRouter and nowhere else. Throws with text that holds no key.
 */
export async function askJevDecision({ def, input = {}, screen = {}, signal, fetchImpl = globalThis.fetch } = {}) {
    const key = jevKey();
    if (!key) throw new Error('no OpenRouter key is saved for jev-1.13');
    const body = JSON.stringify({ model: JEV_MODEL, state: def.decision.state(input), questions: def.decision.questions });
    const estimate = catalogCost(JEV_PRICE, Math.ceil(body.length / 4), 0) ?? 0;
    const reservation = reserveSpend({ route: 'openrouter', estimate });
    if (!reservation) throw new Error('the monthly spend ceiling is reached');
    const controller = new AbortController();
    const stop = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('jev-1.13 ran past its time limit.')); }, JEV_TIMEOUT_MS);
    try {
        const response = await fetchImpl(JEV_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body, signal: controller.signal });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.error) throw new Error(`OpenRouter answered ${response.status}${data?.error?.message ? `: ${data.error.message}` : ''}`);
        const usage = data?.usage || {};
        const tokens = { in: Number(usage.input_tokens) || 0, out: Number(usage.output_tokens) || 0 };
        const reported = usage.cost !== undefined && usage.cost !== null && Number.isFinite(Number(usage.cost)) ? Number(usage.cost) : null;
        recordSpend({ route: 'openrouter', model: JEV_MODEL, cost: reported ?? catalogCost(JEV_PRICE, tokens.in, tokens.out) ?? estimate,
            basis: reported !== null ? 'usage' : 'catalog', reservation, job: 'judgment', tokens });
        const answers = data?.answers || {};
        const unsure = unsureReceipts(answers, def.decision.bands);
        return { value: def.decision.fromAnswers(answers, input, screen), model: JEV_MODEL, ...(unsure.length ? { unsure } : {}) };
    } catch (error) {
        // A call that timed out may still be billed, so it keeps its reservation as spent; any other failure lets it go.
        if (timedOut) recordSpend({ route: 'openrouter', model: JEV_MODEL, cost: estimate, basis: 'reserved', reservation, job: 'judgment' });
        else releaseSpend(reservation);
        throw new Error(scrub(timedOut ? 'jev-1.13 ran past its time limit.' : error?.message || error, key));
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', stop);
    }
}

async function askJev({ system, user, schema, signal, def, input, screen }) {
    // On by default, as routing is automatic; it is reached only when the desktop and the phone gave no answer, and
    // runs as a paid entry within the ceiling. false turns it off.
    const on = settings().routing?.judgmentCloud ?? true;
    if (on === false) return { skipped: 'the Jev slot is turned off' };
    let decisionFailed = '';
    if (def?.decision && hasJevKey()) {
        try {
            const res = await askJevDecision({ def, input, screen, signal });
            if (def.normalize(res.value)) return res;
            decisionFailed = 'jev-1.13 returned answers that could not be used';
        } catch (error) { decisionFailed = String(error?.message || error); }
    }
    const entry = { ...JEV_ROUTER, ...(typeof on === 'object' ? on : {}) };
    const res = await runChain([entry], { job: 'judgment', system, user, schema, tokens: 120, signal, label: 'Judgment call on Jev' });
    if (!res.ok) throw Object.assign(new Error(res.reason), { decisionFailed });
    return { text: res.text, value: res.value, model: entry.model, ...(decisionFailed ? { decisionFailed } : {}) };
}

const DEFAULT_DEPS = {
    clock: () => Date.now(),
    lane: (fn, options) => desktopQueue().desktopTurn(fn, options),
    desktop: askDesktop,
    phoneReady: phoneModelReady,
    phoneAsk: askOneWord,
    jev: askJev,
};

/**
 * Run one judgment call. def: DICE, ASIDE, or a definition shaped like them. input: { message, scene,
 * threads, npcNames, reply }. Returns { value, route, model, ms, skipped, attempts }, where route is 'code',
 * 'desktop', 'phone' or 'jev', and attempts lists each route tried with its outcome and time. unsure, when present, holds the
 * receipt lines of Jev answers that fell in the unsure band and took the question's default.
 */
export async function judge(def, input = {}, deps = {}) {
    const result = await runJudgment(def, input, deps);
    if (!result.skipped) reportJudgment(result);
    return result;
}

// Tell the route notices how the call went: each route that was asked, in order, and the one that answered.
function reportJudgment(result) {
    const pooled = { desktop: 'desktop', phone: 'phone', jev: 'openrouter' };
    const attempts = result.attempts.filter(item => pooled[item.route])
        .map(item => ({ route: pooled[item.route], outcome: item.outcome === 'answered' ? 'completed' : item.outcome, reason: item.reason || '' }));
    reportChainResult({ job: 'judgment', background: true, ok: result.route !== 'code', route: pooled[result.route] || '', model: result.model || '', waiting: false, attempts });
}

async function runJudgment(def, input, deps) {
    const d = { ...DEFAULT_DEPS, ...deps };
    const started = d.clock();
    const screen = def.screen ? def.screen(input) : screenTurn(input.message, { threads: input.threads });
    const attempts = [];
    const done = (value, route, model = '') => ({ value, route, model, ms: d.clock() - started, skipped: false, attempts });
    if (screen.skip) return { ...done(def.codeDefault(input, screen), 'code'), skipped: true, reason: screen.reason };
    const system = input.system || def.system;
    const user = input.user || def.user(input);

    // 1. The desktop, within its limit, ahead of waiting background jobs.
    if (desktopDown(d.clock())) attempts.push({ route: 'desktop', outcome: 'skipped', reason: 'down' });
    else {
        const t0 = d.clock();
        const deadline = t0 + DESKTOP_LIMIT_MS;
        const controller = new AbortController();
        let timer;
        try {
            const res = await Promise.race([
                d.lane(async () => d.desktop({ system, user, schema: def.schema, signal: controller.signal }), { withinMs: DESKTOP_LIMIT_MS }),
                new Promise(resolve => { timer = setTimeout(() => resolve({ late: true }), Math.max(0, deadline - d.clock())); }),
            ]);
            if (res?.late) {
                controller.abort(new Error('The judgment call ran past its 1 s limit.'));
                attempts.push({ route: 'desktop', outcome: 'late', ms: d.clock() - t0 });
            } else if (res?.skipped) {
                attempts.push({ route: 'desktop', outcome: 'skipped', reason: res.skipped });
            } else {
                const raw = res?.value ?? parseJson(res?.text, { object: true });
                const problem = raw ? schemaProblem(raw, def.schema.value) : 'no JSON';
                const value = problem ? null : def.normalize(raw);
                if (value) {
                    attempts.push({ route: 'desktop', outcome: 'answered', ms: d.clock() - t0 });
                    return done(value, 'desktop', res.model || '');
                }
                attempts.push({ route: 'desktop', outcome: 'invalid', reason: problem || 'out of range', ms: d.clock() - t0 });
            }
        } catch (error) {
            // A desktop that does not answer at all is skipped by later judgment calls for a minute.
            if (!controller.signal.aborted) desktopMissUntil = d.clock() + MISS_MS;
            attempts.push({ route: 'desktop', outcome: 'failed', reason: String(error?.message || error).slice(0, 200), ms: d.clock() - t0 });
        } finally {
            clearTimeout(timer);
        }
    }

    // 2. The phone, one one-word item at a time.
    if (!def.phone) attempts.push({ route: 'phone', outcome: 'skipped', reason: 'this judgment does not use the on-phone model' });
    else if (await d.phoneReady().catch(() => false)) {
        const t0 = d.clock();
        try {
            const answers = {};
            for (const item of def.phone) {
                if (item.when && !item.when(answers)) continue;
                const word = await d.phoneAsk(item.question(input), item.options, {});
                if (!word) throw new Error(`no allowed answer for ${item.key}`);
                answers[item.key] = word;
            }
            attempts.push({ route: 'phone', outcome: 'answered', ms: d.clock() - t0 });
            return done(def.fromPhone(answers, input, screen), 'phone', 'gemma-4-e2b-litert');
        } catch (error) {
            attempts.push({ route: 'phone', outcome: 'failed', reason: String(error?.message || error).slice(0, 200), ms: d.clock() - t0 });
        }
    } else attempts.push({ route: 'phone', outcome: 'skipped', reason: 'not downloaded' });

    // 3. Jev's slot, through SillyTavern's own connection.
    try {
        const t0 = d.clock();
        const res = await d.jev({ system, user, schema: def.schema, def, input, screen });
        if (res?.decisionFailed) attempts.push({ route: 'jev-1.13', outcome: 'failed', reason: res.decisionFailed.slice(0, 200) });
        if (res?.skipped) attempts.push({ route: 'jev', outcome: 'skipped', reason: res.skipped });
        else {
            const value = def.normalize(res?.value ?? parseJson(res?.text, { object: true }));
            if (value) {
                const unsure = Array.isArray(res.unsure) ? res.unsure : [];
                attempts.push({ route: 'jev', outcome: 'answered', ms: d.clock() - t0, ...(unsure.length ? { reason: unsure.join('; ') } : {}) });
                return { ...done(value, 'jev', res.model || ''), ...(unsure.length ? { unsure } : {}) };
            }
            attempts.push({ route: 'jev', outcome: 'invalid', ms: d.clock() - t0 });
        }
    } catch (error) {
        if (error?.decisionFailed) attempts.push({ route: 'jev-1.13', outcome: 'failed', reason: String(error.decisionFailed).slice(0, 200) });
        attempts.push({ route: 'jev', outcome: 'failed', reason: String(error?.message || error).slice(0, 200) });
    }

    // 4. Code's default.
    return done(def.codeDefault(input, screen), 'code');
}

/** The dice judgment for a turn: whether an attempt happens, who acts, the stat, the difficulty step and the stance. */
export const judgeDice = (input, deps) => judge(DICE, input, deps);
