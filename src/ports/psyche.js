// Undercurrent ports — psyche: per-character appraisal, emotion decay, significance-gated memory, insight moments and
// defenses under stress. Pure logic.
//
// Reproduces, natively, the person-state mechanics of two psychology plugins: every event the scribe records is
// appraised separately by each character it matters to (relevance to their wants, help vs. harm, who caused it, norm
// violation, certainty, expectation) and becomes an emotion with an intensity that decays per turn with a configurable
// half-life. Only high-intensity events pass the significance gate and become lasting memories in that character's
// mind (grudges, bonds, wounds, wariness, milestones). Repeated evidence on one theme accumulates silently until it
// crosses a threshold and produces an occasional insight line (delayed realization). Under accumulated stress a
// defense is chosen from personality cues in the character's own text (card, traits, background) — never hardcoded per
// character — and colors behavior while the stress lasts (with hysteresis).
//
// Deliberately not reproduced: keyword sentiment over the player's message (a player saying "I'm scared" never makes a
// character afraid), raw meters in the prompt, relationship stages, trust/attachment scores, random canned "system
// notes". Intensities are internal; lines are qualitative. {{user}} is never appraised (the player's feelings are
// never tracked), though {{user}} can be the cause of a character's feeling.

import {
    kb, ki, kn, kt, kta, klist, kjson, makeResolver, isUserName, presentNpcs, charRecord, str, sameThing,
    renderTemplate, isPlainObject, normText, contentTokens, capNewest, deepClone,
} from './common.js';

// Local copy (avoids importing state.js, which imports the ports through port-state.js).
function openItems(list, turn) {
    return (Array.isArray(list) ? list : []).filter(i => i && (i.until_turn === null || i.until_turn === undefined || i.until_turn > turn));
}

const G = 'Psyche';
const P = 'psyche.';

export const PSYCHE_PATHS = ['event', 'forget'];

const DEFAULT_RULES = [
    { if: { goal: 'hinders', agent: 'other', norm: 'violated' }, emotion: 'anger' },
    { if: { goal: 'hinders', agent: 'self', norm: 'violated' }, emotion: 'shame' },
    { if: { goal: 'hinders', agent: 'self' }, emotion: 'regret' },
    { if: { goal: 'hinders', certainty: 'uncertain' }, emotion: 'fear' },
    { if: { goal: 'hinders', control: 'none' }, emotion: 'sadness' },
    { if: { goal: 'hinders', agent: 'other' }, emotion: 'frustration' },
    { if: { goal: 'hinders' }, emotion: 'sadness' },
    { if: { goal: 'helps', agent: 'other' }, emotion: 'gratitude' },
    { if: { goal: 'helps', agent: 'self' }, emotion: 'pride' },
    { if: { goal: 'helps', certainty: 'uncertain' }, emotion: 'hope' },
    { if: { goal: 'helps' }, emotion: 'joy' },
    { if: { norm: 'violated', agent: 'other' }, emotion: 'contempt' },
    { if: { expected: false }, emotion: 'surprise' },
];
const DEFAULT_MEMORY_KINDS = {
    anger: 'grudge', contempt: 'grudge', frustration: 'grudge', gratitude: 'bond', joy: 'bond', hope: 'milestone', pride: 'milestone',
    fear: 'wariness', sadness: 'wound', shame: 'wound', regret: 'wound', surprise: 'milestone',
};
const DEFAULT_DEFENSES = [
    { id: 'deflection', behavior: 'dodges: changes the subject, answers a different question, gets suddenly busy', cues: ['evasive', 'guarded', 'secretive', 'private', 'aloof', 'reserved', 'closed off', 'mysterious', 'cagey'], emotions: ['shame', 'fear', 'regret'] },
    { id: 'humor', behavior: 'jokes it away: a quip at the worst moment, laughing first so nobody else can', cues: ['witty', 'sarcastic', 'joker', 'playful', 'teasing', 'funny', 'irreverent', 'snarky', 'flippant', 'clown'], emotions: ['fear', 'shame', 'sadness'] },
    { id: 'aggression', behavior: 'goes on the attack: sharper words, blame, striking first', cues: ['hot-tempered', 'aggressive', 'combative', 'volatile', 'fierce', 'confrontational', 'short fuse', 'temper', 'hostile', 'brash'], emotions: ['anger', 'frustration', 'contempt', 'shame'] },
    { id: 'withdrawal', behavior: 'pulls back: shorter answers, more distance, an exit if one exists', cues: ['shy', 'introvert', 'introverted', 'quiet', 'withdrawn', 'loner', 'avoidant', 'solitary', 'stoic', 'timid'], emotions: ['fear', 'sadness', 'shame'] },
    { id: 'rationalization', behavior: 'explains it away: reasons, logic, a tidy story that skips the feeling', cues: ['analytical', 'logical', 'intellectual', 'calculating', 'rational', 'pragmatic', 'controlled', 'scholar', 'cerebral', 'detached'], emotions: ['regret', 'shame', 'fear'] },
    { id: 'caretaking', behavior: 'turns to fixing someone else\'s problem instead of feeling this one', cues: ['caring', 'nurturing', 'protective', 'people-pleaser', 'selfless', 'helpful', 'dutiful', 'devoted', 'kind'], emotions: ['fear', 'sadness', 'regret'] },
    { id: 'denial', behavior: 'insists everything is fine, a little too brightly', cues: ['optimistic', 'cheerful', 'carefree', 'sunny', 'bubbly', 'upbeat', 'stubborn', 'naive'], emotions: ['fear', 'sadness'] },
    { id: 'control', behavior: 'grabs control of something small: tidying, rules, a plan, a schedule', cues: ['perfectionist', 'controlling', 'organized', 'meticulous', 'disciplined', 'strict', 'orderly', 'rigid'], emotions: ['fear', 'frustration', 'regret'] },
];

export const PSYCHE_PLACEHOLDERS = [
    { name: 'uc_name', help: 'The character.' },
    { name: 'uc_feelings', help: 'Strongest current feelings, qualitative ("clear anger about …").' },
    { name: 'uc_carrying', help: '"; carrying: …" lasting memories about people present, or empty.' },
    { name: 'uc_defense', help: '"; under strain: …" the active defense, or empty.' },
    { name: 'uc_agent', help: 'Who keeps causing the pattern (a name, "own choices", or "circumstance").' },
    { name: 'uc_emotion', help: 'The emotion of the pattern.' },
    { name: 'uc_examples', help: 'Short examples of the events behind an insight.' },
    { name: 'uc_behavior', help: 'The defense behavior.' },
];

export const PSYCHE_KNOBS = [
    kb(`${P}enabled`, G, 'Psyche engine', true, 'Appraise recorded events per character into emotions, lasting memories, insights and defenses.'),
    kjson(`${P}appraisal_rules`, G, 'Appraisal rules', DEFAULT_RULES, 'Ordered list {if:{goal:"helps|hinders|none", agent:"self|other|circumstance", norm:"violated|upheld|none", certainty:"certain|uncertain", expected:true|false, control:"some|none"}, emotion}. First match wins.'),
    klist(`${P}negative_emotions`, G, 'Emotions that count as stress', ['anger', 'shame', 'regret', 'fear', 'sadness', 'frustration', 'contempt'], ''),
    kjson(`${P}stakes`, G, 'Intensity by stakes', { low: 0.3, medium: 0.55, high: 0.85 }, 'Base intensity (0..1) for the event\'s stakes.'),
    kn(`${P}relevance_bonus`, G, 'Bonus when the event touches their wants/goals/plans', 0.15, 0, 1, 0.05, 'Relevance to a character\'s own open wants is computed by word overlap (code-side).'),
    kn(`${P}relevance_min_overlap`, G, 'Shared content words that count as relevant', 1, 1, 10, 1, ''),
    kn(`${P}surprise_factor`, G, 'Intensity factor when it was unexpected', 1.2, 0.5, 3, 0.05, ''),
    kn(`${P}uncertain_factor`, G, 'Intensity factor when it is uncertain', 0.85, 0.1, 2, 0.05, ''),
    kn(`${P}half_life`, G, 'Emotion half-life (turns)', 3, 0.5, 100, 0.5, 'An emotion\'s intensity halves every this many turns.'),
    kn(`${P}floor`, G, 'Forget feelings below', 0.08, 0, 1, 0.01, ''),
    kn(`${P}show_floor`, G, 'Mention feelings above', 0.18, 0, 1, 0.01, ''),
    ki(`${P}feelings_shown`, G, 'Feelings named per character', 2, 0, 6, ''),
    ki(`${P}max_emotions`, G, 'Emotions kept per character', 12, 1, 60, ''),
    kjson(`${P}intensity_words`, G, 'Intensity words', [[0.35, 'a trace of'], [0.65, 'clear'], [1, 'consuming']], 'Ascending [upper bound, word] pairs used instead of numbers.'),
    kn(`${P}memory_threshold`, G, 'Significance gate: intensity that becomes a lasting memory', 0.7, 0, 1, 0.05, 'Only events at least this intense are remembered as grudges, bonds, wounds, wariness or milestones.'),
    kjson(`${P}memory_kinds`, G, 'Memory kind per emotion', DEFAULT_MEMORY_KINDS, 'grudge/bond need someone else as the cause; otherwise they become wound/milestone.'),
    ki(`${P}max_memories`, G, 'Lasting memories per character', 10, 1, 60, ''),
    ki(`${P}memories_shown`, G, 'Memories mentioned per character', 1, 0, 6, 'Only memories about someone present (or about the character themself).'),
    kn(`${P}insight_weight`, G, 'Insight: accumulated intensity needed', 1.6, 0.1, 20, 0.1, 'Repeated evidence on one theme (same feeling, same cause) adds up until this.'),
    ki(`${P}insight_min_events`, G, 'Insight: events needed', 2, 1, 20, ''),
    ki(`${P}insight_cooldown`, G, 'Insight cooldown per character (turns)', 6, 0, 100, ''),
    ki(`${P}insight_show_turns`, G, 'An insight stays in the note for (turns)', 2, 1, 20, ''),
    kjson(`${P}defenses`, G, 'Defense catalog', DEFAULT_DEFENSES, 'Generic defenses {id, behavior, cues:[words found in a character\'s own card/traits], emotions:[affinity]}. The best match for each character is computed from their text at runtime.'),
    kn(`${P}cue_weight`, G, 'Defense pick: weight per personality cue found', 2, 0, 20, 0.1, ''),
    kn(`${P}emotion_weight`, G, 'Defense pick: weight for matching the dominant feeling', 1, 0, 20, 0.1, ''),
    kn(`${P}defense_on`, G, 'Stress that triggers a defense', 0.9, 0.05, 10, 0.05, 'Sum of current negative-feeling intensities.'),
    kn(`${P}defense_off`, G, 'Stress below which the defense drops', 0.45, 0, 10, 0.05, 'Lower than the trigger, so a defense does not flicker.'),
    kt(`${P}self_agent`, G, 'Pattern cause: own choices', '{{uc_name}}\'s own choices', 'Placeholder: {{uc_name}}.'),
    kt(`${P}circumstance_agent`, G, 'Pattern cause: circumstance', 'the way things keep going', ''),
    kta(`${P}line_template`, G, 'Mind line', '{{uc_name}} feels {{uc_feelings}}{{uc_carrying}}{{uc_defense}}', 'Placeholders: see the list.', PSYCHE_PLACEHOLDERS),
    kt(`${P}carrying_prefix`, G, 'Memories prefix', '; carrying: ', ''),
    kt(`${P}defense_prefix`, G, 'Defense prefix', '; under strain, ', ''),
    kta(`${P}insight_template`, G, 'Insight line', '{{uc_name}} is close to a realization, maybe not in words yet: {{uc_agent}} keeps leaving {{uc_name}} with {{uc_emotion}} ({{uc_examples}}).', '', PSYCHE_PLACEHOLDERS),
    ki(`${P}pri`, G, 'Note priority: mind lines', 68, 0, 100, ''),
    ki(`${P}pri_insight`, G, 'Note priority: insight', 72, 0, 100, ''),
];

export const resolvePsycheOptions = makeResolver(P, PSYCHE_KNOBS, (o) => {
    if (!Array.isArray(o.appraisal_rules)) o.appraisal_rules = deepClone(DEFAULT_RULES);
    if (!isPlainObject(o.stakes)) o.stakes = { low: 0.3, medium: 0.55, high: 0.85 };
    if (!isPlainObject(o.memory_kinds)) o.memory_kinds = deepClone(DEFAULT_MEMORY_KINDS);
    if (!Array.isArray(o.defenses)) o.defenses = deepClone(DEFAULT_DEFENSES);
    o.defenses = o.defenses.filter(d => isPlainObject(d) && d.id && d.behavior).map(d => ({
        id: str(d.id, 40), behavior: str(d.behavior, 200),
        cues: (Array.isArray(d.cues) ? d.cues : []).map(String), emotions: (Array.isArray(d.emotions) ? d.emotions : []).map(String),
    }));
    if (!Array.isArray(o.intensity_words) || !o.intensity_words.every(x => Array.isArray(x) && Number.isFinite(x[0]))) o.intensity_words = [[0.35, 'a trace of'], [0.65, 'clear'], [1, 'consuming']];
    return o;
});

let CFG = resolvePsycheOptions({});
export function setPsycheConfig(values) {
    CFG = resolvePsycheOptions(values || {});
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptyMind() {
    return { emotions: [], memories: [], themes: {}, insights: [], defense: null, last_insight_turn: -1000 };
}

export function emptyPsyche() {
    return { chars: {} };
}

function normMind(raw) {
    const m = emptyMind();
    if (!isPlainObject(raw)) return m;
    m.emotions = (Array.isArray(raw.emotions) ? raw.emotions : []).filter(e => isPlainObject(e) && e.emotion && Number.isFinite(e.intensity)).map(e => ({
        emotion: str(e.emotion, 30), intensity: Math.max(0, Math.min(1, e.intensity)), turn: Number.isFinite(e.turn) ? e.turn : 0,
        about: str(e.about, 160), agent: str(e.agent, 60), agent_kind: ['self', 'other', 'circumstance'].includes(e.agent_kind) ? e.agent_kind : 'circumstance',
    })).slice(-60);
    m.memories = (Array.isArray(raw.memories) ? raw.memories : []).filter(x => isPlainObject(x) && x.text).map(x => ({
        kind: str(x.kind, 20), text: str(x.text, 200), agent: str(x.agent, 60), emotion: str(x.emotion, 30), turn: Number.isFinite(x.turn) ? x.turn : 0,
    })).slice(-60);
    if (isPlainObject(raw.themes)) {
        for (const [k, t] of Object.entries(raw.themes)) {
            if (!isPlainObject(t)) continue;
            m.themes[str(k, 100)] = {
                emotion: str(t.emotion, 30), agent: str(t.agent, 60), agent_kind: str(t.agent_kind, 20) || 'circumstance',
                weight: Number.isFinite(t.weight) ? t.weight : 0, count: Number.isFinite(t.count) ? t.count : 0,
                examples: (Array.isArray(t.examples) ? t.examples : []).map(x => str(x, 80)).filter(Boolean).slice(-3),
                insight_turn: Number.isFinite(t.insight_turn) ? t.insight_turn : null,
            };
        }
    }
    m.insights = (Array.isArray(raw.insights) ? raw.insights : []).filter(x => isPlainObject(x) && x.text).map(x => ({ text: str(x.text, 400), turn: Number.isFinite(x.turn) ? x.turn : 0 })).slice(-10);
    m.defense = isPlainObject(raw.defense) && Number.isFinite(raw.defense.since) ? { since: raw.defense.since } : null;
    m.last_insight_turn = Number.isFinite(raw.last_insight_turn) ? raw.last_insight_turn : -1000;
    return m;
}

export function normalizePsyche(raw) {
    const s = emptyPsyche();
    if (!isPlainObject(raw) || !isPlainObject(raw.chars)) return s;
    for (const [n, m] of Object.entries(raw.chars).slice(0, 60)) {
        const name = str(n, 60);
        if (name) s.chars[name] = normMind(m);
    }
    return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Appraisal

/** Decayed intensity at `turn`. */
export function decayed(intensity, fromTurn, turn, halfLife) {
    const age = Math.max(0, turn - fromTurn);
    return intensity * Math.pow(0.5, age / Math.max(0.01, halfLife));
}

function agentKind(agent, who, userName) {
    const a = String(agent ?? '').trim().toLowerCase();
    if (!a || ['circumstance', 'nobody', 'none', 'chance', 'fate', 'world'].includes(a)) return 'circumstance';
    if (a === 'self' || a === String(who).trim().toLowerCase()) return 'self';
    return 'other';
}

function enumOf(v, allowed, def) {
    const s = String(v ?? '').trim().toLowerCase();
    return allowed.includes(s) ? s : def;
}

/**
 * Appraise one event for one character. Pure.
 * @returns {{emotion:string, intensity:number, agent_kind:string, relevant:boolean}|null} null = not emotionally relevant
 */
export function appraise(event, { who, mind = null, wants = [], userName = '', options } = {}) {
    const o = resolvePsycheOptions(options || {});
    const ev = isPlainObject(event) ? event : {};
    const facts = {
        goal: enumOf(ev.goal, ['helps', 'hinders', 'none'], 'none'),
        agent: agentKind(ev.agent, who, userName),
        norm: enumOf(ev.norm, ['violated', 'upheld', 'none'], 'none'),
        certainty: enumOf(ev.certainty, ['certain', 'uncertain'], 'certain'),
        expected: ev.expected === false || ev.expected === 'false' || ev.expected === 'no' ? false : true,
        control: enumOf(ev.control, ['some', 'none'], 'some'),
    };
    const rule = o.appraisal_rules.find(r => isPlainObject(r) && isPlainObject(r.if) && r.emotion
        && Object.entries(r.if).every(([k, v]) => (k === 'expected' ? facts.expected === (v === true || v === 'true') : facts[k] === String(v).toLowerCase())));
    if (!rule) return null;
    const stakes = enumOf(ev.stakes, Object.keys(o.stakes), 'medium');
    let intensity = Number(o.stakes[stakes]) || 0.5;
    const tokens = new Set(contentTokens(ev.text));
    const relevant = (wants || []).some(w => contentTokens(w).filter(t => tokens.has(t)).length >= o.relevance_min_overlap);
    if (relevant) intensity += o.relevance_bonus;
    if (!facts.expected) intensity *= o.surprise_factor;
    if (facts.certainty === 'uncertain') intensity *= o.uncertain_factor;
    return { emotion: String(rule.emotion), intensity: Math.max(0, Math.min(1, intensity)), agent_kind: facts.agent, relevant };
}

function stressOf(mind, turn, o) {
    return mind.emotions.filter(e => o.negative_emotions.includes(e.emotion)).reduce((s, e) => s + decayed(e.intensity, e.turn, turn, o.half_life), 0);
}

function dominantNegative(mind, turn, o) {
    let best = null;
    for (const e of mind.emotions) {
        if (!o.negative_emotions.includes(e.emotion)) continue;
        const v = decayed(e.intensity, e.turn, turn, o.half_life);
        if (!best || v > best.v) best = { emotion: e.emotion, v };
    }
    return best?.emotion || '';
}

/**
 * Pick the defense that best matches a character's own text (cue words) and their dominant feeling.
 * @param {string} text everything known about the character (card, traits, background, role)
 * @param {string} emotion dominant negative feeling
 */
export function selectDefense(text, emotion, options) {
    const o = resolvePsycheOptions(options || {});
    const hay = ` ${normText(text)} `;
    let best = null;
    o.defenses.forEach((d, i) => {
        const cues = d.cues.filter(c => { const n = normText(c); return n && hay.includes(` ${n} `); }).length;
        const score = cues * o.cue_weight + (d.emotions.includes(emotion) ? o.emotion_weight : 0);
        if (score > 0 && (!best || score > best.score)) best = { id: d.id, behavior: d.behavior, score, cues, i };
    });
    return best;
}

function charText(state, name, cardTexts) {
    const r = charRecord(state, name);
    const c = r?.c || {};
    const bits = [c.traits, c.background, c.role, c.ikigai, c.relation, c.intimacy?.style];
    const card = isPlainObject(cardTexts) ? (cardTexts[name] ?? cardTexts[r?.key] ?? Object.entries(cardTexts).find(([k]) => k.toLowerCase() === String(name).toLowerCase())?.[1]) : '';
    return [card, ...bits].filter(Boolean).join(' \n ');
}

/**
 * Op reducer: "psyche.event" (append) and "psyche.forget" (remove a memory). Mutates the slice.
 * ctx.state gives access to characters (wants) and card texts are not needed here (defenses are chosen when read).
 */
export function applyPsycheOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    const v = isPlainObject(op.value) ? op.value : {};
    if (op.field === 'forget') {
        const who = str(v.who, 60);
        const key = Object.keys(slice.chars).find(k => k.toLowerCase() === who.toLowerCase());
        if (!key) return 'no such character';
        const idx = slice.chars[key].memories.findIndex(m => sameThing(m.text, v.text ?? '', 0.5));
        if (idx === -1) return 'no matching memory';
        slice.chars[key].memories.splice(idx, 1);
        return 'ok';
    }
    if (op.field !== 'event') return 'unknown psyche field';
    if (op.op !== 'append') return 'events are appended';
    const whoList = (Array.isArray(v.who) ? v.who : [v.who]).map(w => str(w, 60)).filter(Boolean).slice(0, 6);
    const text = str(v.text ?? v.event, 160);
    if (!whoList.length || !text) return 'event needs who and text';
    let applied = 0;
    for (const who of whoList) {
        if (isUserName(who, ctx.userName)) continue; // the player's feelings are never tracked
        const r = ctx.state ? charRecord(ctx.state, who) : null;
        const name = r?.key || Object.keys(slice.chars).find(k => k.toLowerCase() === who.toLowerCase()) || who;
        const mind = slice.chars[name] ? normMind(slice.chars[name]) : emptyMind();
        const wants = r ? ['wants', 'goals', 'plans'].flatMap(f => openItems(r.c[f], turn).map(x => x.text)) : [];
        const a = appraise(v, { who: name, mind, wants, userName: ctx.userName, options: o });
        if (!a) continue;
        const agent = a.agent_kind === 'other' ? str(v.agent, 60) : a.agent_kind === 'self' ? name : '';
        mind.emotions.push({ emotion: a.emotion, intensity: a.intensity, turn, about: text, agent, agent_kind: a.agent_kind });
        mind.emotions = mind.emotions.filter(e => decayed(e.intensity, e.turn, turn, o.half_life) >= o.floor).slice(-o.max_emotions);
        // Significance gate: only intense events become lasting memories.
        if (a.intensity >= o.memory_threshold) {
            let kind = String(o.memory_kinds[a.emotion] || 'milestone');
            if ((kind === 'grudge' || kind === 'bond') && a.agent_kind !== 'other') kind = kind === 'grudge' ? 'wound' : 'milestone';
            mind.memories.push({ kind, text, agent, emotion: a.emotion, turn });
            mind.memories = mind.memories.slice(-o.max_memories);
        }
        // Delayed realization: evidence on one theme accumulates silently.
        const key = `${a.emotion}|${a.agent_kind === 'other' ? normText(agent) : a.agent_kind}`;
        const th = mind.themes[key] || { emotion: a.emotion, agent, agent_kind: a.agent_kind, weight: 0, count: 0, examples: [], insight_turn: null };
        th.weight += a.intensity;
        th.count += 1;
        th.examples = [...th.examples, str(text, 80)].slice(-3);
        if (th.weight >= o.insight_weight && th.count >= o.insight_min_events && turn - mind.last_insight_turn >= o.insight_cooldown) {
            const agentText = a.agent_kind === 'other' ? agent : a.agent_kind === 'self' ? renderTemplate(o.self_agent, { uc_name: name }) : o.circumstance_agent;
            mind.insights.push({ text: renderTemplate(o.insight_template, { uc_name: name, uc_agent: agentText, uc_emotion: a.emotion, uc_examples: th.examples.join('; ') }), turn });
            mind.insights = mind.insights.slice(-10);
            mind.last_insight_turn = turn;
            th.insight_turn = turn;
            th.weight = 0;
            th.count = 0;
        }
        mind.themes[key] = th;
        const keys = Object.keys(mind.themes);
        if (keys.length > 30) for (const k of keys.slice(0, keys.length - 30)) delete mind.themes[k];
        // Stress: a defense switches on above the trigger; reading drops it below the release level.
        const stress = stressOf(mind, turn, o);
        if (stress >= o.defense_on && !mind.defense) mind.defense = { since: turn };
        else if (stress < o.defense_off) mind.defense = null;
        slice.chars[name] = mind;
        applied++;
    }
    return applied ? 'ok' : 'no emotionally relevant appraisal';
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading

function intensityWord(v, o) {
    for (const [hi, word] of o.intensity_words) if (v <= hi) return word;
    return o.intensity_words[o.intensity_words.length - 1][1];
}

/** Current feelings of a character, strongest first: [{emotion, value, about, agent}] */
export function currentFeelings(mind, turn, options) {
    const o = resolvePsycheOptions(options || {});
    const m = normMind(mind);
    const best = new Map();
    for (const e of m.emotions) {
        const v = decayed(e.intensity, e.turn, turn, o.half_life);
        if (v < o.floor) continue;
        const cur = best.get(e.emotion);
        if (!cur || v > cur.value) best.set(e.emotion, { emotion: e.emotion, value: v, about: e.about, agent: e.agent });
    }
    return [...best.values()].sort((a, b) => b.value - a.value);
}

/** {name: dominant feeling text} for present characters (feeds the desire pulse's mood). */
export function psycheMoods(state, { turn = 0, options } = {}) {
    const o = resolvePsycheOptions(options || {});
    const s = normalizePsyche(state?.ports?.psyche);
    const out = {};
    for (const [name, mind] of Object.entries(s.chars)) {
        const f = currentFeelings(mind, turn, o)[0];
        if (f && f.value >= o.show_floor) out[name] = f.emotion;
    }
    return out;
}

/** Is the defense active now, and which one (computed from the character's own text). */
export function activeDefense(state, name, { turn = 0, options, cardTexts } = {}) {
    const o = resolvePsycheOptions(options || {});
    const s = normalizePsyche(state?.ports?.psyche);
    const key = Object.keys(s.chars).find(k => k.toLowerCase() === String(name).toLowerCase());
    if (!key) return null;
    const mind = s.chars[key];
    if (!mind.defense) return null;
    const stress = stressOf(mind, turn, o);
    if (stress < o.defense_off) return null;
    return selectDefense(charText(state, key, cardTexts), dominantNegative(mind, turn, o), o);
}

/**
 * Interceptor-time output: one compact line per present character with something to say, plus fresh insights.
 * @returns {{lines:{text:string,pri:number,section:string}[], director:string[], moods:object}}
 */
export function psycheTurn({ state, turn = 0, options, userName = '', charName = '', cardTexts = {}, type = 'normal' } = {}) {
    const o = resolvePsycheOptions(options || {});
    const none = { lines: [], director: [], moods: {} };
    if (!o.enabled || type === 'quiet') return none;
    const s = normalizePsyche(state?.ports?.psyche);
    const present = presentNpcs(state, { charName, userName });
    const presentLow = present.map(n => n.toLowerCase());
    const lines = [];
    for (const n of present) {
        const key = Object.keys(s.chars).find(k => k.toLowerCase() === n.toLowerCase());
        if (!key) continue;
        const mind = s.chars[key];
        const feelings = currentFeelings(mind, turn, o).filter(f => f.value >= o.show_floor).slice(0, o.feelings_shown);
        const mem = mind.memories.filter(m => !m.agent || m.agent.toLowerCase() === key.toLowerCase() || presentLow.includes(m.agent.toLowerCase()) || isUserName(m.agent, userName))
            .slice(-o.memories_shown).map(m => `${m.kind}${m.agent && m.agent.toLowerCase() !== key.toLowerCase() ? ` (${m.agent})` : ''}: ${m.text}`);
        const def = type === 'impersonate' ? null : activeDefense(state, key, { turn, options: o, cardTexts });
        if (feelings.length || mem.length || def) {
            const text = renderTemplate(o.line_template, {
                uc_name: key,
                uc_feelings: feelings.length ? feelings.map(f => `${intensityWord(f.value, o)} ${f.emotion}${f.about ? ` (${f.about})` : ''}`).join(', ') : 'steady',
                uc_carrying: mem.length ? `${o.carrying_prefix}${mem.join('; ')}` : '',
                uc_defense: def ? `${o.defense_prefix}${def.behavior}` : '',
                uc_behavior: def?.behavior || '',
            });
            lines.push({ text: text.replace(/\s+/g, ' ').trim(), pri: o.pri, section: 'psyche' });
        }
        for (const ins of mind.insights.filter(i => turn - i.turn < o.insight_show_turns && turn >= i.turn)) {
            if (type !== 'impersonate') lines.push({ text: ins.text, pri: o.pri_insight, section: 'psyche' });
        }
    }
    return { lines, director: lines.map(l => l.text), moods: psycheMoods(state, { turn, options: o }) };
}

/** Scribe path guide line. */
export function psychePathGuide() {
    return [
        'psyche.event — append {"who":["Name",…] (characters it matters to; never {{user}}),"text":"what happened, short","goal":"helps|hinders|none" (for their wants),"stakes":"low|medium|high","agent":"who caused it: a name, self, or circumstance","norm":"violated|upheld|none","certainty":"certain|uncertain","expected":true|false,"control":"some|none"} only for events that matter to someone',
    ];
}
