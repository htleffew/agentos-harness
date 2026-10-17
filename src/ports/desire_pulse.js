// Undercurrent ports — desire pulse (appetite cadence). Pure logic.
//
// Reproduces, natively, the "private appetite pulse" mechanics of a desire plugin: every N turns (or sooner while a
// character's attraction is live) one present character gets one concrete impulse drawn from their own intimacy
// profile (preferences, the evidence behind them, their history and style) and colored by their current mood and the
// scene. Evidence strength per preference is computed from the count and recency of quoted evidence and reported as a
// descriptive label ("stated in their card", "shown once, recently", "well established") — it is never a meter and it
// never gates behavior. Hard limits and negative evidence always win: a limited or disliked item is never offered. A
// "curiosity" path offers something the card supports or the character has hinted at (quoted in-story) but never done.
//
// Deliberately not reproduced: libido / charge / inhibition / satiation numbers, kink status ladders (latent → core),
// personality-derived "fit" scores, kink-family boilerplate blocks, numbers of any kind in the prompt.

import {
    kb, ki, kn, kt, kta, klist, makeResolver, isUserName, presentNpcs, charRecord, str, sameThing, beginTurn, weightedPick,
    chance, capNewest, renderTemplate, isPlainObject, normText,
} from './common.js';
import { normalizeIntimacy, attractionLive, quoteFound, findLimit } from '../intimacy.js';

const G = 'Desire pulse';
const P = 'desire.';

export const DESIRE_PATHS = ['hint'];

export const DESIRE_PLACEHOLDERS = [
    { name: 'uc_name', help: 'The character.' },
    { name: 'uc_item', help: 'The preference or curiosity.' },
    { name: 'uc_strength', help: 'Descriptive evidence label (no numbers).' },
    { name: 'uc_basis', help: 'Why it is a curiosity: their card, or what they hinted.' },
    { name: 'uc_style', help: '", in their way: <style>" from the intimacy profile, or empty.' },
    { name: 'uc_mood', help: 'Their current mood or dominant feeling.' },
    { name: 'uc_attraction', help: 'The live attraction note.' },
    { name: 'uc_context', help: 'Where/when, short.' },
    { name: 'uc_limits', help: 'Their hard limits, or "none recorded".' },
];

export const DESIRE_KNOBS = [
    kb(`${P}enabled`, G, 'Desire pulse', true, 'Every few turns, one present character gets one concrete impulse drawn from their own intimacy profile. Also needs the intimacy engine on.'),
    ki(`${P}cadence_turns`, G, 'Pulse every N turns', 3, 1, 50, 'Minimum turns between pulses when no attraction is live.'),
    kb(`${P}live_bypass`, G, 'Pulse sooner while attraction is live', true, 'Live, unacted attraction (or a fresh intimate thread) lets a pulse come after the shorter gap below.'),
    ki(`${P}live_min_gap`, G, 'Gap while attraction is live (turns)', 1, 0, 20, ''),
    kn(`${P}pulse_chance`, G, 'Chance a due pulse fires (%)', 100, 0, 100, 1, '100 = always when due.'),
    klist(`${P}suppressed_modes`, G, 'Quiet in scene modes', ['grief', 'argument'], 'No impulses in these scene modes.'),
    kn(`${P}attraction_weight`, G, 'Character pick: weight for live attraction', 3, 0, 20, 0.1, 'Multiplies the chance a character with live attraction is the one who gets the pulse.'),
    kn(`${P}intimate_weight`, G, 'Character pick: weight in an intimate scene', 2, 0, 20, 0.1, ''),
    kn(`${P}repeat_char_weight`, G, 'Character pick: weight for whoever had the last pulse', 0.35, 0, 5, 0.05, 'Below 1 spreads pulses across the cast.'),
    ki(`${P}item_no_repeat`, G, 'Do not offer the same item again within (turns)', 8, 0, 100, ''),
    kn(`${P}curiosity_pct`, G, 'Curiosity path chance (%)', 30, 0, 100, 1, 'When untried, card-supported or hinted items exist, how often the pulse picks curiosity instead of a known appetite.'),
    kb(`${P}curiosity_from_card`, G, 'Curiosity may come from untried card items', true, 'Card or inferred preferences with no evidence and no history count as untried.'),
    kb(`${P}curiosity_from_hints`, G, 'Curiosity may come from hints', true, 'Things a character hinted at (scribe: desire.hint with a verbatim quote) but has not done.'),
    kb(`${P}require_hint_quote`, G, 'Hints need a verbatim quote', true, 'A hint is accepted only when its quote really appears in the reply it came from.'),
    ki(`${P}max_hints`, G, 'Hints remembered per chat', 24, 0, 200, ''),
    kn(`${P}weight_card`, G, 'Item weight: stated in the card', 1, 0, 10, 0.1, ''),
    kn(`${P}weight_inferred`, G, 'Item weight: inferred guess', 0.5, 0, 10, 0.1, ''),
    kn(`${P}weight_per_evidence`, G, 'Item weight: per piece of positive evidence', 0.75, 0, 10, 0.05, ''),
    kn(`${P}weight_recent`, G, 'Item weight: bonus when evidence is recent', 0.75, 0, 10, 0.05, ''),
    ki(`${P}recent_turns`, G, 'Evidence counts as recent within (turns)', 10, 1, 500, ''),
    ki(`${P}established_count`, G, 'Pieces of evidence for "well established"', 3, 2, 20, ''),
    kt(`${P}label_card`, G, 'Label: stated in the card', 'stated in their card', ''),
    kt(`${P}label_inferred`, G, 'Label: inferred', 'a guess from who they are', ''),
    kt(`${P}label_once`, G, 'Label: one piece of evidence', 'shown once', ''),
    kt(`${P}label_some`, G, 'Label: some evidence', 'shown a few times', ''),
    kt(`${P}label_established`, G, 'Label: well established', 'well established', ''),
    kt(`${P}label_recent`, G, 'Suffix: recent evidence', ', recently', ''),
    kt(`${P}label_old`, G, 'Suffix: older evidence', ', a while ago', ''),
    kt(`${P}basis_card`, G, 'Curiosity basis: card', 'their card suggests it; never done on the page', ''),
    kt(`${P}basis_hint`, G, 'Curiosity basis: hint', 'they hinted at it: "{{uc_quote}}"', 'Placeholder: {{uc_quote}}.'),
    klist(`${P}muting_moods`, G, 'Moods that mute an impulse', ['grief', 'grieving', 'angry', 'furious', 'afraid', 'scared', 'terrified', 'hurt', 'ashamed', 'humiliated', 'sick', 'exhausted', 'devastated', 'betrayed'], 'When the character\'s mood or strongest feeling contains one of these words, the muted template is used.'),
    kta(`${P}template_default`, G, 'Impulse line', '{{uc_name}} has an appetite stirring: {{uc_item}} ({{uc_strength}}). It surfaces{{uc_style}}; acting on it, hinting at it or sitting on it all fit {{uc_name}}.', 'Placeholders: see the list.', DESIRE_PLACEHOLDERS),
    kta(`${P}template_live`, G, 'Impulse line (live attraction)', '{{uc_name}}\'s attraction ({{uc_attraction}}) has a concrete want behind it: {{uc_item}} ({{uc_strength}}). Strong want prompts a move of {{uc_name}}\'s own{{uc_style}}.', '', DESIRE_PLACEHOLDERS),
    kta(`${P}template_muted`, G, 'Impulse line (muted by mood)', 'Under the {{uc_mood}}, {{uc_name}} still half-wants {{uc_item}} ({{uc_strength}}); it colors {{uc_name}}\'s mood without driving anything.', '', DESIRE_PLACEHOLDERS),
    kta(`${P}template_curious`, G, 'Impulse line (curiosity)', '{{uc_name}} is curious about something untried: {{uc_item}} ({{uc_basis}}). A question, a look or a joke that circles it; never assumed into a done deal.', '', DESIRE_PLACEHOLDERS),
    kta(`${P}director_template`, G, 'Director line', 'Desire impulse for {{uc_name}}: {{uc_item}} ({{uc_strength}}). If it fits the beat, let it shape {{uc_name}}\'s own move. Their limits: {{uc_limits}}.', '', DESIRE_PLACEHOLDERS),
    kt(`${P}style_prefix`, G, 'Style clause prefix', ', in their way: ', 'Text before the profile\'s style in {{uc_style}}.'),
    kt(`${P}no_limits_text`, G, 'Text when no limits are recorded', 'none recorded', ''),
    ki(`${P}pri`, G, 'Note priority', 57, 0, 100, 'Higher survives the note\'s word cap longer.'),
];

export const resolveDesireOptions = makeResolver(P, DESIRE_KNOBS);

let CFG = resolveDesireOptions({});
export function setDesireConfig(values) {
    CFG = resolveDesireOptions(values || {});
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptyDesireRt() {
    return { turn: -1, prev: null, last_pulse: -1000, last_by: {}, recent: [] };
}

export function emptyDesire() {
    return { hints: [], rt: emptyDesireRt() };
}

export function normalizeDesire(raw) {
    const s = emptyDesire();
    if (!isPlainObject(raw)) return s;
    s.hints = (Array.isArray(raw.hints) ? raw.hints : []).filter(h => isPlainObject(h) && str(h.who) && str(h.item)).map(h => ({
        who: str(h.who, 60), item: str(h.item, 100), quote: str(h.quote, 240),
        turn: Number.isFinite(h.turn) ? h.turn : 0, until_turn: Number.isFinite(h.until_turn) ? h.until_turn : null,
    })).slice(-200);
    const rt = isPlainObject(raw.rt) ? raw.rt : {};
    s.rt = {
        turn: Number.isFinite(rt.turn) ? rt.turn : -1,
        prev: isPlainObject(rt.prev) ? rt.prev : null,
        last_pulse: Number.isFinite(rt.last_pulse) ? rt.last_pulse : -1000,
        last_by: isPlainObject(rt.last_by) ? Object.fromEntries(Object.entries(rt.last_by).filter(([, v]) => Number.isFinite(v))) : {},
        recent: (Array.isArray(rt.recent) ? rt.recent : []).filter(r => isPlainObject(r) && r.who && r.item && Number.isFinite(r.turn)).slice(-40),
    };
    return s;
}

/**
 * Op reducer for "desire.hint". Needs the character's intimacy profile: a limited or disliked item is never a hint.
 * @param {object} slice normalized desire slice (mutated)
 * @param {{op:string, field:string, value:any}} op
 * @param {{turn:number, userName?:string, sourceText?:string, trusted?:boolean, characters?:object, options?:object}} ctx
 */
export function applyDesireOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    if (op.field !== 'hint') return 'unknown desire field';
    const v = isPlainObject(op.value) ? op.value : {};
    const who = str(v.who, 60);
    const item = str(v.item ?? v.text, 100);
    if (!who || !item) return 'hint needs who and item';
    if (isUserName(who, ctx.userName)) return 'the player\'s desires are never recorded';
    if (op.op === 'close' || op.op === 'remove') {
        const idx = slice.hints.findIndex(h => h.who.toLowerCase() === who.toLowerCase() && sameThing(h.item, item) && (op.op === 'remove' || h.until_turn === null));
        if (idx === -1) return 'no matching hint';
        if (op.op === 'remove') slice.hints.splice(idx, 1);
        else slice.hints[idx].until_turn = turn;
        return 'ok';
    }
    if (op.op !== 'append') return 'hints are appended / closed';
    const quote = str(v.quote, 240);
    if (o.require_hint_quote && !ctx.trusted && !(quote && quoteFound(quote, ctx.sourceText || ''))) return 'a hint needs a verbatim quote from the text';
    const key = ctx.characters ? Object.keys(ctx.characters).find(k => k.toLowerCase() === who.toLowerCase()) : null;
    const intim = key ? normalizeIntimacy(ctx.characters[key].intimacy) : null;
    if (intim && findLimit(intim, item)) return 'a hard limit outranks a hint';
    if (intim && intim.preferences.some(p => p.stance === 'dislikes' && sameThing(p.item, item))) return 'negative evidence outranks a hint';
    if (slice.hints.some(h => h.until_turn === null && h.who.toLowerCase() === who.toLowerCase() && sameThing(h.item, item))) return 'ok';
    slice.hints.push({ who: key || who, item, quote, turn, until_turn: null });
    slice.hints = capNewest(slice.hints, o.max_hints);
    return 'ok';
}

// ---------------------------------------------------------------------------------------------------------------------
// Evidence strength (descriptive)

/**
 * Descriptive strength of one preference: count and recency of its quoted evidence. Never a gate.
 * @returns {{label:string, positive:number, negative:number, last_turn:number|null, excluded:boolean, weight:number, untried:boolean}}
 */
export function evidenceStrength(pref, { turn = 0, options, history = [] } = {}) {
    const o = resolveDesireOptions(options || {});
    const ev = Array.isArray(pref?.evidence) ? pref.evidence : [];
    const pos = ev.filter(e => e.polarity !== 'negative');
    const neg = ev.filter(e => e.polarity === 'negative');
    const lastPos = pos.length ? Math.max(...pos.map(e => e.turn || 0)) : null;
    const lastNeg = neg.length ? Math.max(...neg.map(e => e.turn || 0)) : null;
    const excluded = pref?.stance === 'dislikes' || (lastNeg !== null && (lastPos === null || lastNeg >= lastPos));
    const inHistory = (history || []).some(h => sameThing(h.text || h, pref?.item, 0.5));
    let label;
    let weight;
    if (!pos.length) {
        label = pref?.status === 'inferred' ? o.label_inferred : o.label_card;
        weight = pref?.status === 'inferred' ? o.weight_inferred : o.weight_card;
    } else {
        label = pos.length >= o.established_count ? o.label_established : pos.length === 1 ? o.label_once : o.label_some;
        const recent = turn - lastPos <= o.recent_turns;
        label += recent ? o.label_recent : o.label_old;
        weight = o.weight_card + pos.length * o.weight_per_evidence + (recent ? o.weight_recent : 0);
    }
    return { label, positive: pos.length, negative: neg.length, last_turn: lastPos, excluded, weight: excluded ? 0 : weight, untried: !pos.length && !inHistory };
}

function limitsText(intim, o) {
    const l = (intim.limits || []).map(x => x.item);
    return l.length ? l.join(', ') : o.no_limits_text;
}

function moodOf(name, c, psyche) {
    const p = psyche && isPlainObject(psyche) ? psyche[name] || psyche[String(name).toLowerCase()] : '';
    return str(p || c?.mood || '', 80);
}

/** Candidates for one character: known appetites and curiosities, with limits and negative evidence removed. */
export function desireCandidates(state, name, { turn = 0, options, recent = [] } = {}) {
    const o = resolveDesireOptions(options || {});
    const r = charRecord(state, name);
    if (!r) return { known: [], curious: [], intim: null };
    const intim = normalizeIntimacy(r.c.intimacy);
    const blocked = item => !!findLimit(intim, item) || intim.preferences.some(p => p.stance === 'dislikes' && sameThing(p.item, item));
    const fresh = item => !recent.some(x => x.who.toLowerCase() === r.key.toLowerCase() && sameThing(x.item, item) && turn - x.turn < o.item_no_repeat);
    const known = [];
    const curious = [];
    for (const p of intim.preferences) {
        if (p.stance !== 'likes' || blocked(p.item) || !fresh(p.item)) continue;
        const s = evidenceStrength(p, { turn, options: o, history: intim.history });
        if (s.excluded) continue;
        if (s.untried && o.curiosity_from_card) {
            // Untried card/inferred items belong to the curiosity path only: nothing on the page shows them yet.
            curious.push({ item: p.item, basis: o.basis_card, w: Math.max(0.01, s.weight), strength: s.label, kind: 'card' });
            continue;
        }
        known.push({ item: p.item, strength: s.label, w: s.weight, kind: 'known' });
    }
    if (o.curiosity_from_hints) {
        for (const h of normalizeDesire(state?.ports?.desire).hints) {
            if (h.until_turn !== null || h.who.toLowerCase() !== r.key.toLowerCase()) continue;
            if (blocked(h.item) || !fresh(h.item)) continue;
            if (intim.history.some(x => sameThing(x.text, h.item, 0.5))) continue;
            if (curious.some(c => sameThing(c.item, h.item))) continue;
            curious.push({ item: h.item, basis: renderTemplate(o.basis_hint, { uc_quote: h.quote }), w: 1, strength: o.basis_card, kind: 'hint' });
        }
    }
    return { known, curious, intim, key: r.key };
}

/**
 * Interceptor-time pass: maybe one impulse line this turn.
 * @param {object} p
 * @param {object} p.state chat state
 * @param {number} p.turn
 * @param {() => number} [p.rng]
 * @param {object} [p.options]
 * @param {string} [p.userName]
 * @param {string} [p.charName]
 * @param {boolean} [p.intimacyEnabled]
 * @param {string} [p.type]
 * @param {object} [p.psyche] {name: dominant feeling text} from psyche.js (optional)
 * @param {boolean} [p.force] fire now regardless of cadence (slash command)
 * @returns {{line:string, director:string, rt:object, pick:object|null, reason:string, lines:object[]}}
 */
export function desirePulseTurn({ state, turn = 0, rng = Math.random, options, userName = '', charName = '', intimacyEnabled = true, type = 'normal', psyche = null, force = false } = {}) {
    const o = resolveDesireOptions(options || {});
    const slice = normalizeDesire(state?.ports?.desire);
    const out = (reason, rt = slice.rt, extra = {}) => ({ line: '', director: '', rt, pick: null, reason, lines: [], ...extra });
    if (!o.enabled || intimacyEnabled === false) return out('desire pulse is off');
    if (type === 'quiet' || type === 'impersonate') return out(`no pulse on ${type}`);
    const mode = String(state?.scene?.mode || '');
    if (!force && o.suppressed_modes.includes(mode)) return out(`quiet in ${mode}`);
    const rt = beginTurn(slice.rt, turn, emptyDesireRt);
    const present = presentNpcs(state, { charName, userName });
    const live = present.filter((n) => { const r = charRecord(state, n); return r && attractionLive(r.c.intimacy, turn); });
    const since = turn - rt.last_pulse;
    const due = force || since >= o.cadence_turns || (o.live_bypass && live.length > 0 && since >= Math.max(1, o.live_min_gap));
    if (!due) return out('not due', rt);
    if (!force && !chance(o.pulse_chance, rng)) return out('chance roll failed', rt);

    const options_ = [];
    for (const n of present) {
        const cand = desireCandidates(state, n, { turn, options: o, recent: rt.recent });
        if (!cand.intim || (!cand.known.length && !cand.curious.length)) continue;
        let w = 1;
        if (live.includes(n)) w *= o.attraction_weight;
        if (mode === 'intimate') w *= o.intimate_weight;
        if (rt.last_by[cand.key] === rt.last_pulse && rt.last_pulse >= 0) w *= o.repeat_char_weight;
        options_.push({ name: cand.key, cand, w });
    }
    const who = weightedPick(options_, rng);
    if (!who) return out('no character with a usable profile', rt);
    const { cand, name } = who;
    const curiousPath = cand.curious.length && (!cand.known.length || chance(o.curiosity_pct, rng));
    const item = weightedPick(curiousPath ? cand.curious : cand.known, rng);
    if (!item) return out('nothing to offer', rt);

    const r = charRecord(state, name);
    const intim = cand.intim;
    const mood = moodOf(name, r.c, psyche);
    const muted = !!mood && o.muting_moods.some(m => normText(mood).split(' ').includes(normText(m)));
    const isLive = live.includes(name) && !!intim.attraction;
    const vars = {
        uc_name: name,
        uc_item: item.item,
        uc_strength: item.strength,
        uc_basis: item.basis || '',
        uc_style: intim.style ? `${o.style_prefix}${intim.style.replace(/[.;\s]+$/, '')}` : '',
        uc_mood: mood || 'mood',
        uc_attraction: intim.attraction || '',
        uc_context: [state?.scene?.place, state?.scene?.time].filter(Boolean).join(', '),
        uc_limits: limitsText(intim, o),
    };
    const tpl = curiousPath ? o.template_curious : muted ? o.template_muted : isLive ? o.template_live : o.template_default;
    const line = renderTemplate(tpl, vars).replace(/\s+/g, ' ').trim();
    const director = renderTemplate(o.director_template, vars).replace(/\s+/g, ' ').trim();
    rt.last_pulse = turn;
    rt.last_by[name] = turn;
    rt.recent = capNewest([...rt.recent, { who: name, item: item.item, turn }], 40);
    const pick = { who: name, item: item.item, path: curiousPath ? 'curiosity' : 'known', strength: item.strength, register: curiousPath ? 'curious' : muted ? 'muted' : isLive ? 'live' : 'default' };
    return { line, director, rt, pick, reason: 'fired', lines: [{ text: line, pri: o.pri, section: 'desire' }] };
}

/** Scribe path guide line (appended to {{uc_paths}} when the pulse and the intimacy engine are on). */
export function desirePathGuide() {
    return ['desire.hint — append {"who":"Name","item":"short label","quote":"their exact words or act hinting they are curious about something they have not done"} | close {"who","item"} once it happened or they ruled it out'];
}
