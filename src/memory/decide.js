// Judgment calls before the reply (memory DESIGN 7.7 and 9.2): a dice attempt with its difficulty and stance, an
// out-of-character aside that code cannot settle, and whether a reply changed a lasting fact. Each runs in code first;
// code skips the call on a turn with no action by anyone. Every other turn goes to the routes in order:
//   1. the desktop's resident gemma4:12b over Tailscale, one structured answer, within a 1 s limit;
//   2. with the desktop unreachable or late, the on-phone Gemma 4 E2B, as one-word items (about 2.6 s each);
//   3. Jev's slot: jev-router through SillyTavern's own OpenRouter connection (the key stays there), within the ceiling;
//   4. code's default.
// B22 writes the dice judge's wording (src/dice-judge.js) and MB14 stores the roll; this file routes the call.
import { askFull, parseJson } from '../st.js';
import { chainFor, resolveRoute, routeHealth, runChain, schemaProblem } from '../routing.js';
import { settings } from '../store.js';
import { askOneWord, phoneModelReady } from './phone-model.js';
import { desktopQueue } from './queue.js';

export const DESKTOP_LIMIT_MS = 1000;
export const MISS_MS = 60 * 1000;
export const JEV_ROUTER = Object.freeze({ route: 'openrouter', model: 'typesafe/jev-router', price: { in: 0.10, out: 0.40 }, timeoutMs: 3000 });

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
    phone: [{ key: 'aside', question: ({ message }) => `Player message: ${message}\nIs the player speaking outside the story? Answer yes or no.`, options: ['yes', 'no'] }],
    fromPhone: answers => ({ aside: answers.aside === 'yes' }),
    codeDefault: (_input, screen) => ({ aside: !!screen.ooc }),
    normalize: value => typeof value?.aside === 'boolean' ? { aside: value.aside } : null,
});

/** Whether a reply changed a lasting fact, asked while capture waits for a route. */
export const FACT_CHANGED = Object.freeze({
    name: 'factChanged',
    schema: { name: 'fact_changed', strict: true, value: { type: 'object', required: ['changed'], properties: { changed: { type: 'boolean' } } } },
    system: 'Say whether the reply changes a lasting fact of the story: where someone lives, who is alive, what someone owns, a relationship, a promise. Answer with JSON on one line and nothing else.',
    user: ({ reply }) => `Reply: ${reply}`,
    phone: [{ key: 'changed', question: ({ reply }) => `Reply: ${reply}\nDoes this reply change a lasting fact of the story? Answer yes or no.`, options: ['yes', 'no'] }],
    fromPhone: answers => ({ changed: answers.changed === 'yes' }),
    codeDefault: () => ({ changed: false }),
    normalize: value => typeof value?.changed === 'boolean' ? { changed: value.changed } : null,
    screen: () => ({ skip: false }),
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

async function askJev({ system, user, schema, signal }) {
    // On by default, as routing is automatic; it is reached only when the desktop and the phone gave no answer, and
    // runs as a paid entry within the ceiling. false turns it off.
    const on = settings().routing?.judgmentCloud ?? true;
    if (on === false) return { skipped: 'the Jev slot is turned off' };
    const entry = { ...JEV_ROUTER, ...(typeof on === 'object' ? on : {}) };
    const res = await runChain([entry], { job: 'judgment', system, user, schema, tokens: 120, signal, label: 'Judgment call on Jev' });
    if (!res.ok) throw new Error(res.reason);
    return { text: res.text, value: res.value, model: entry.model };
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
 * Run one judgment call. def: DICE, ASIDE, FACT_CHANGED, or a definition shaped like them. input: { message, scene,
 * threads, npcNames, reply }. Returns { value, route, model, ms, skipped, attempts }, where route is 'code',
 * 'desktop', 'phone' or 'jev', and attempts lists each route tried with its outcome and time.
 */
export async function judge(def, input = {}, deps = {}) {
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
    if (await d.phoneReady().catch(() => false)) {
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
        const res = await d.jev({ system, user, schema: def.schema });
        if (res?.skipped) attempts.push({ route: 'jev', outcome: 'skipped', reason: res.skipped });
        else {
            const value = def.normalize(res?.value ?? parseJson(res?.text, { object: true }));
            if (value) {
                attempts.push({ route: 'jev', outcome: 'answered', ms: d.clock() - t0 });
                return done(value, 'jev', res.model || '');
            }
            attempts.push({ route: 'jev', outcome: 'invalid', ms: d.clock() - t0 });
        }
    } catch (error) {
        attempts.push({ route: 'jev', outcome: 'failed', reason: String(error?.message || error).slice(0, 200) });
    }

    // 4. Code's default.
    return done(def.codeDefault(input, screen), 'code');
}

/** The dice judgment for a turn: whether an attempt happens, who acts, the stat, the difficulty step and the stance. */
export const judgeDice = (input, deps) => judge(DICE, input, deps);
