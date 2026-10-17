// Undercurrent ports — reply shape: length matched to the player's turn, repeat vetoes, and a spark when replies
// flatten. Pure logic.
//
// Reproduces, natively, the deterministic controller of a "taste director" plugin: the size of the player's turn sets
// the scale of the reply (a three-word poke gets a short, punchy single beat with no new characters; a long, detailed
// turn earns a fuller reply), every finished reply is fingerprinted (how it opens, how it ends, its paragraph shape,
// which kinds of beat it used) and the next reply is vetoed from repeating the same opening, ending, shape or beat type
// within a window, and when replies flatten (short, low novelty versus the previous reply, or the tic guard reports a
// stall / near-identical replies) a spark nudge from a rotating channel pool is added. Callback sparks obey a maturity
// gate: only facts at least N turns old can be called back (fresh material is continuity, not a payoff).
//
// Deliberately not reproduced: the three extra pre-generation LLM agents (the existing director covers that), budget
// numbers in the prompt, and keyword blocks that fired on common words like "more" or "again".

import {
    kb, ki, kn, kt, kta, klist, kjson, makeResolver, str, beginTurn, weightedPick, chance, capNewest, renderTemplate,
    isPlainObject, normText, contentTokens, dialogueSpans, deepClone,
} from './common.js';
import { jaccard, wordCount } from '../util.js';

/** The player's message with *private thoughts* removed (same rule as context.publicPart; local to avoid an import cycle). */
export function publicPart(text) {
    return String(text ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1').replace(/\s+/g, ' ').trim();
}

const G = 'Reply shape';
const P = 'reply_shape.';

export const REPLY_SHAPE_PATHS = ['observe'];

const DEFAULT_BEATS = {
    touch: ['touches', 'hand', 'hands', 'hug', 'kiss', 'kisses', 'holds', 'grabs', 'strokes', 'leans into'],
    confession: ['admits', 'confess', 'confesses', 'truth is', 'never told', 'i lied', 'i\'m sorry', 'i am sorry'],
    arrival: ['door opens', 'walks in', 'arrives', 'knock', 'knocks', 'appears', 'shows up'],
    departure: ['leaves', 'walks out', 'storms off', 'turns to go', 'gone'],
    conflict: ['shouts', 'snaps', 'accuses', 'slams', 'argue', 'argues', 'glares', 'threat', 'threatens'],
    humor: ['laughs', 'grins', 'jokes', 'snorts', 'teases', 'smirk', 'smirks'],
    revelation: ['realizes', 'discovers', 'turns out', 'reveals', 'finds out', 'secret'],
    gift: ['gives', 'hands over', 'offers', 'present', 'gift'],
    memory: ['remembers', 'used to', 'back then', 'years ago', 'once'],
};
const DEFAULT_SPARKS = [
    { id: 'want_now', channel: 'character', text: 'Spark: someone in the scene wants something inconvenient right now, and lets it show.' },
    { id: 'contradiction', channel: 'character', text: 'Spark: let {{char}} show a side the scene has not seen yet, one that is still true to the card.' },
    { id: 'bad_idea', channel: 'character', text: 'Spark: a tempting bad idea, proposed or acted on by someone other than {{user}}.' },
    { id: 'comic', channel: 'humor', text: 'Spark: something small goes comically wrong, or someone says the wrong thing at the right time.' },
    { id: 'outside', channel: 'world', text: 'Spark: the world outside the scene intrudes with a concrete source: a message, a neighbor, weather, a deadline.' },
    { id: 'object', channel: 'world', text: 'Spark: an object in the room becomes important.' },
    { id: 'sense', channel: 'sensory', text: 'Spark: lead with a sense the last replies ignored.' },
    { id: 'stakes', channel: 'plot', text: 'Spark: a cost appears; something that was safe is not anymore.' },
    { id: 'callback', channel: 'callback', text: 'Spark: an older thread comes back changed: {{uc_callback}}.' },
    { id: 'contrast', channel: 'chemistry', text: 'Spark: tension through contrast; two people want different things from the same moment.' },
];

export const REPLY_SHAPE_PLACEHOLDERS = [
    { name: 'uc_min', help: 'Target minimum words.' },
    { name: 'uc_max', help: 'Target maximum words.' },
    { name: 'uc_kind', help: 'The repeated opening / ending / shape / beat type.' },
    { name: 'uc_callback', help: 'An older open fact (callback spark only).' },
];

export const REPLY_SHAPE_KNOBS = [
    kb(`${P}enabled`, G, 'Reply shape', true, 'Length hint from the player\'s turn, repeat vetoes and a spark when replies flatten.'),
    kb(`${P}length_enabled`, G, 'Length hint', true, ''),
    ki(`${P}short_max_words`, G, 'Player turn counts as short up to (words)', 12, 1, 200, 'Spoken/acted words only; private *thoughts* are not counted.'),
    ki(`${P}long_min_words`, G, 'Player turn counts as long from (words)', 80, 2, 2000, ''),
    ki(`${P}short_min`, G, 'Short turn: reply words min', 180, 20, 2000, ''),
    ki(`${P}short_max`, G, 'Short turn: reply words max', 320, 20, 3000, ''),
    ki(`${P}medium_min`, G, 'Medium turn: reply words min', 300, 20, 2000, ''),
    ki(`${P}medium_max`, G, 'Medium turn: reply words max', 480, 20, 3000, ''),
    ki(`${P}long_min`, G, 'Long turn: reply words min', 420, 20, 3000, ''),
    ki(`${P}long_max`, G, 'Long turn: reply words max', 600, 20, 4000, ''),
    kta(`${P}short_template`, G, 'Short turn line', 'Length: tight, {{uc_min}}–{{uc_max}} words; one punchy beat, no new characters or events unless one is already due.', 'Placeholders: {{uc_min}}, {{uc_max}}.', REPLY_SHAPE_PLACEHOLDERS),
    kta(`${P}medium_template`, G, 'Medium turn line', 'Length: {{uc_min}}–{{uc_max}} words.', '', REPLY_SHAPE_PLACEHOLDERS),
    kta(`${P}long_template`, G, 'Long turn line', 'Length: full, {{uc_min}}–{{uc_max}} words; answer the detail the player gave, point by point where it matters.', '', REPLY_SHAPE_PLACEHOLDERS),
    kn(`${P}dialogue_heavy_ratio`, G, 'Player turn counts as dialogue-heavy from (share of words in quotes)', 0.6, 0, 1, 0.05, ''),
    kt(`${P}dialogue_heavy_text`, G, 'Dialogue-heavy line', 'The player mostly spoke: answer in speech first.', 'Empty = none.'),
    ki(`${P}window`, G, 'Veto window (replies)', 3, 1, 12, 'Recent replies compared for repeats.'),
    ki(`${P}veto_count`, G, 'Veto after (uses within the window)', 2, 1, 12, ''),
    kjson(`${P}beat_lexicon`, G, 'Beat-type lexicon', DEFAULT_BEATS, 'Map of beat type to words that show it (code-side, edit for other languages).'),
    ki(`${P}beat_min_hits`, G, 'Words needed to count a beat type', 1, 1, 10, ''),
    ki(`${P}vetoes_shown`, G, 'Vetoes per turn', 3, 0, 10, ''),
    kta(`${P}veto_open_template`, G, 'Veto: opening', 'Do not open with {{uc_kind}} again.', '', REPLY_SHAPE_PLACEHOLDERS),
    kta(`${P}veto_close_template`, G, 'Veto: ending', 'Do not end on {{uc_kind}} again.', '', REPLY_SHAPE_PLACEHOLDERS),
    kta(`${P}veto_shape_template`, G, 'Veto: paragraph shape', 'Change the reply\'s structure (recent replies all ran {{uc_kind}}).', '', REPLY_SHAPE_PLACEHOLDERS),
    kta(`${P}veto_beat_template`, G, 'Veto: beat type', 'Not another {{uc_kind}} beat; reach for a different kind of moment.', '', REPLY_SHAPE_PLACEHOLDERS),
    kjson(`${P}class_names`, G, 'Names for openings / endings', { dialogue: 'dialogue', thought: 'a private thought', narration: 'narration', question: 'a question', action: 'an action' }, ''),
    kb(`${P}spark_enabled`, G, 'Spark when replies flatten', true, ''),
    ki(`${P}flat_words`, G, 'A reply counts as flat under (words)', 140, 0, 2000, ''),
    kn(`${P}flat_novelty`, G, 'A reply counts as flat when novelty is under', 0.35, 0, 1, 0.05, 'Novelty = 1 − word overlap with the previous reply.'),
    ki(`${P}spark_after`, G, 'Spark after flat replies in a row', 2, 1, 20, ''),
    kb(`${P}spark_on_stall`, G, 'Spark when the tic guard reports a stall or near-identical replies', true, ''),
    ki(`${P}spark_cooldown`, G, 'Spark cooldown (turns)', 3, 0, 50, ''),
    kn(`${P}spark_chance`, G, 'Chance a due spark fires (%)', 100, 0, 100, 1, ''),
    kjson(`${P}spark_pool`, G, 'Spark pool', DEFAULT_SPARKS, '{id, channel, text}. The same channel is not used twice in a row. Callback sparks need {{uc_callback}}.'),
    ki(`${P}callback_min_age`, G, 'Callback maturity: facts at least this old (turns)', 6, 1, 500, 'Fresher material is continuity, not a callback.'),
    klist(`${P}suppressed_modes`, G, 'No sparks in scene modes', ['intimate', 'grief'], ''),
    ki(`${P}history`, G, 'Reply fingerprints kept', 8, 2, 40, ''),
    ki(`${P}pri_length`, G, 'Note priority: length', 66, 0, 100, ''),
    ki(`${P}pri_veto`, G, 'Note priority: vetoes', 54, 0, 100, ''),
    ki(`${P}pri_spark`, G, 'Note priority: spark', 64, 0, 100, ''),
];

export const resolveReplyShapeOptions = makeResolver(P, REPLY_SHAPE_KNOBS, (o) => {
    if (!isPlainObject(o.beat_lexicon)) o.beat_lexicon = deepClone(DEFAULT_BEATS);
    if (!Array.isArray(o.spark_pool)) o.spark_pool = deepClone(DEFAULT_SPARKS);
    o.spark_pool = o.spark_pool.filter(e => isPlainObject(e) && e.text).map((e, i) => ({ id: str(e.id, 40) || `spark_${i}`, channel: str(e.channel, 30) || 'any', text: String(e.text) }));
    if (!isPlainObject(o.class_names)) o.class_names = {};
    if (o.short_max < o.short_min) o.short_max = o.short_min;
    if (o.medium_max < o.medium_min) o.medium_max = o.medium_min;
    if (o.long_max < o.long_min) o.long_max = o.long_min;
    if (o.long_min_words <= o.short_max_words) o.long_min_words = o.short_max_words + 1;
    return o;
});

let CFG = resolveReplyShapeOptions({});
export function setReplyShapeConfig(values) {
    CFG = resolveReplyShapeOptions(values || {});
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptyReplyShapeRt() {
    return { turn: -1, prev: null, spark_last: -1000, channel_last: '', used: [] };
}

export function emptyReplyShape() {
    return { history: [], rt: emptyReplyShapeRt() };
}

export function normalizeReplyShape(raw) {
    const s = emptyReplyShape();
    if (!isPlainObject(raw)) return s;
    s.history = (Array.isArray(raw.history) ? raw.history : []).filter(isPlainObject).map(h => ({
        turn: Number.isFinite(h.turn) ? h.turn : 0, words: Number.isFinite(h.words) ? h.words : 0,
        open: str(h.open, 20), close: str(h.close, 20), shape: str(h.shape, 60),
        beats: (Array.isArray(h.beats) ? h.beats : []).map(b => str(b, 30)).filter(Boolean).slice(0, 8),
        novelty: Number.isFinite(h.novelty) ? h.novelty : 1, flat: !!h.flat,
    })).slice(-40);
    const rt = isPlainObject(raw.rt) ? raw.rt : {};
    s.rt = {
        turn: Number.isFinite(rt.turn) ? rt.turn : -1, prev: isPlainObject(rt.prev) ? rt.prev : null,
        spark_last: Number.isFinite(rt.spark_last) ? rt.spark_last : -1000, channel_last: str(rt.channel_last, 30),
        used: (Array.isArray(rt.used) ? rt.used : []).filter(u => isPlainObject(u) && u.id).slice(-20),
    };
    return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fingerprinting a finished reply (code-side)

function paraClass(p) {
    const t = p.trim();
    if (/^["“]/.test(t)) return 'dialogue';
    if (/^\*(?!\*)/.test(t)) return 'thought';
    const words = wordCount(t) || 1;
    const quoted = dialogueSpans(t).reduce((n, d) => n + wordCount(d), 0);
    return quoted / words > 0.5 ? 'dialogue' : 'narration';
}

/** Fingerprint of a reply: opening/closing class, paragraph shape, beat types, novelty vs the previous reply, flatness. */
export function fingerprintReply(reply, previous = '', options) {
    const o = resolveReplyShapeOptions(options || {});
    const text = String(reply ?? '').trim();
    const paras = text.split(/\n\s*\n|\n/).map(x => x.trim()).filter(Boolean);
    const classes = paras.map(paraClass);
    const collapsed = classes.filter((c, i) => i === 0 || c !== classes[i - 1]).slice(0, 6);
    const lastSentence = (text.replace(/[*"”’\s]+$/g, '').match(/[^.!?…]+[.!?…]*$/) || [''])[0];
    let close = classes[classes.length - 1] || 'narration';
    // A closing question counts only when spoken or narrated (a private *thought* ending in "?" is not a question to anyone).
    if (close !== 'thought' && (/\?\s*$/.test(text.replace(/[*"”’\s]+$/g, '')) || /\?$/.test(lastSentence.trim()))) close = 'question';
    const low = ` ${normText(text)} `;
    const beats = [];
    for (const [type, words] of Object.entries(o.beat_lexicon || {})) {
        if (!Array.isArray(words)) continue;
        const hits = words.filter(w => { const n = normText(w); return n && low.includes(` ${n} `); }).length;
        if (hits >= o.beat_min_hits) beats.push(type);
    }
    const words = wordCount(text);
    const novelty = previous ? 1 - jaccard(contentTokens(text), contentTokens(previous)) : 1;
    return {
        words, open: classes[0] || 'narration', close, shape: collapsed.join('-'), beats,
        novelty: Math.round(novelty * 1000) / 1000,
        flat: words < o.flat_words || (!!previous && novelty < o.flat_novelty),
    };
}

/** Op reducer: "reply_shape.observe" (system-only). */
export function applyReplyShapeOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    if (op.field !== 'observe') return 'unknown reply_shape field';
    if (!(ctx.trusted || ctx.source === 'ports' || ctx.source === 'replay')) return 'observe is system-only';
    const v = isPlainObject(op.value) ? op.value : null;
    if (!v) return 'observation must be an object';
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    const h = normalizeReplyShape({ history: [{ ...v, turn }] }).history[0];
    slice.history = capNewest([...slice.history.filter(x => x.turn !== turn), h], o.history);
    return 'ok';
}

// ---------------------------------------------------------------------------------------------------------------------
// Interceptor-time pass

/** Length band for a player message (public part only). */
export function lengthBand(userMessage, options) {
    const o = resolveReplyShapeOptions(options || {});
    const pub = publicPart(userMessage);
    const words = wordCount(pub);
    const quoted = dialogueSpans(pub).reduce((n, d) => n + wordCount(d), 0);
    const band = words <= o.short_max_words ? 'short' : words >= o.long_min_words ? 'long' : 'medium';
    return { band, words, dialogueShare: words ? quoted / words : 0, min: o[`${band}_min`], max: o[`${band}_max`] };
}

function name(o, cls) {
    return String(o.class_names?.[cls] ?? cls);
}

/** Repeat vetoes from the recent fingerprints. */
export function computeVetoes(history, options) {
    const o = resolveReplyShapeOptions(options || {});
    const recent = (history || []).slice(-o.window);
    const out = [];
    if (recent.length < o.veto_count) return out;
    const count = (key, val) => recent.filter(h => h[key] === val).length;
    const last = recent[recent.length - 1];
    const tailRun = key => { let n = 0; for (let i = recent.length - 1; i >= 0 && recent[i][key] === last[key]; i--) n++; return n; };
    if (last.open && tailRun('open') >= o.veto_count) out.push({ kind: 'open', value: last.open, text: renderTemplate(o.veto_open_template, { uc_kind: name(o, last.open) }) });
    if (last.close && tailRun('close') >= o.veto_count) out.push({ kind: 'close', value: last.close, text: renderTemplate(o.veto_close_template, { uc_kind: name(o, last.close) }) });
    if (last.shape && last.shape.includes('-') && count('shape', last.shape) >= o.veto_count) out.push({ kind: 'shape', value: last.shape, text: renderTemplate(o.veto_shape_template, { uc_kind: last.shape.split('-').map(c => name(o, c)).join(' → ') }) });
    const beatCounts = {};
    for (const h of recent) for (const b of h.beats || []) beatCounts[b] = (beatCounts[b] || 0) + 1;
    for (const [b, n] of Object.entries(beatCounts).sort((a, c) => c[1] - a[1])) {
        if (n >= o.veto_count && (last.beats || []).includes(b)) out.push({ kind: 'beat', value: b, text: renderTemplate(o.veto_beat_template, { uc_kind: b }) });
    }
    return out.slice(0, o.vetoes_shown);
}

function callbackCandidate(state, turn, o) {
    const facts = (state?.facts || []).filter(f => f && (f.until_turn === null || f.until_turn === undefined || f.until_turn > turn) && Number.isFinite(f.since_turn) && turn - f.since_turn >= o.callback_min_age);
    const threads = [...(state?.threads?.offscreen || []), ...(state?.threads?.arcs || [])]
        .filter(t => t && (t.until_turn === null || t.until_turn === undefined || t.until_turn > turn) && Number.isFinite(t.since_turn) && turn - t.since_turn >= o.callback_min_age);
    const pool = [...threads, ...facts];
    return pool.length ? str(pool[0].text, 140) : '';
}

/**
 * @param {object} p
 * @param {object} p.state chat state
 * @param {number} p.turn
 * @param {string} p.userMessage the player's latest message (private thoughts are excluded from the count)
 * @param {boolean} [p.stall] tic guard: story stalled
 * @param {boolean} [p.samey] tic guard: near-identical replies
 * @param {() => number} [p.rng]
 * @param {object} [p.options]
 * @param {string} [p.type]
 * @returns {{lines:object[], director:string[], vetoes:object[], band:object, spark:object|null, rt:object}}
 */
export function replyShapeTurn({ state, turn = 0, userMessage = '', stall = false, samey = false, rng = Math.random, options, type = 'normal' } = {}) {
    const o = resolveReplyShapeOptions(options || {});
    const slice = normalizeReplyShape(state?.ports?.reply_shape);
    const empty = { lines: [], director: [], vetoes: [], band: null, spark: null, rt: slice.rt };
    if (!o.enabled || type === 'quiet' || type === 'impersonate') return empty;
    const rt = beginTurn(slice.rt, turn, emptyReplyShapeRt);
    const lines = [];
    const director = [];
    const band = lengthBand(userMessage, o);
    if (o.length_enabled) {
        lines.push({ text: renderTemplate(o[`${band.band}_template`], { uc_min: band.min, uc_max: band.max }), pri: o.pri_length, section: 'reply_shape' });
        if (o.dialogue_heavy_text && band.dialogueShare >= o.dialogue_heavy_ratio && band.words > 0) lines.push({ text: o.dialogue_heavy_text, pri: o.pri_length - 1, section: 'reply_shape' });
    }
    const vetoes = computeVetoes(slice.history, o);
    for (const v of vetoes) lines.push({ text: v.text, pri: o.pri_veto, section: 'reply_shape' });
    if (vetoes.length) director.push(`Vetoed this turn: ${vetoes.map(v => `${v.kind} ${v.value}`).join('; ')}.`);

    let spark = null;
    if (o.spark_enabled && !o.suppressed_modes.includes(String(state?.scene?.mode || ''))) {
        const recent = slice.history.slice(-o.spark_after);
        const flatRun = recent.length >= o.spark_after && recent.every(h => h.flat);
        const due = (flatRun || (o.spark_on_stall && (stall || samey))) && turn - rt.spark_last > o.spark_cooldown;
        if (due && chance(o.spark_chance, rng)) {
            const cb = callbackCandidate(state, turn, o);
            const usedRecently = new Set(rt.used.filter(u => turn - u.turn < o.spark_pool.length).map(u => u.id));
            const pool = o.spark_pool.filter(e => e.channel !== rt.channel_last && !usedRecently.has(e.id) && (!e.text.includes('{{uc_callback}}') || cb));
            const pick = weightedPick((pool.length ? pool : o.spark_pool.filter(e => !e.text.includes('{{uc_callback}}') || cb)).map(e => ({ ...e, w: 1 })), rng);
            if (pick) {
                spark = { id: pick.id, channel: pick.channel, text: renderTemplate(pick.text, { uc_callback: cb }) };
                rt.spark_last = turn;
                rt.channel_last = pick.channel;
                rt.used = capNewest([...rt.used, { id: pick.id, turn }], 20);
                lines.push({ text: spark.text, pri: o.pri_spark, section: 'reply_shape' });
                director.push(spark.text);
            }
        }
    }
    return { lines, director, vetoes, band, spark, rt };
}
