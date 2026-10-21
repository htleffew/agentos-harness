// Undercurrent 2 · FEATURES — events: code dice for pulse / twist / curiosity beats. No model call.
//
// Code decides IF an event is due this turn; the reply model decides WHAT it is, prompted by one directive line taken
// from content.directive_phrases.event_<kind>. Chances scale with the drama dial (0 = off … 3 = chaos), the active
// narrator persona's event_bias, and tone/genre (an option's own event_bias when CONTENT supplies one, else a small
// built-in table). Events stay quiet in intimate, grief and argument scenes. Each kind has a cooldown and there is a
// minimum gap between any two events.
//
// Swipe consistency: the roll for a turn is cached under the uc_id of the turn's user message (the anchor), so swiping
// or regenerating the reply re-uses the same decision and the same phrase. History (cooldowns, "never the same phrase
// twice in a row") is rebuilt by walking the chat's user messages in order, so deletes and edits stay consistent.
// Set events.reroll_on_swipe to roll again for every new swipe of the reply.

import { clamp, isPlainObject, fillUc } from '../common/text.js';
import { anchor, pruneByUids } from '../common/chat.js';
import { opt, optBool, optNum, phrases, activePersona, contentOption, toneId, genreId, sget, sset, rngOf, pickVaried } from '../common/settings.js';
import { sceneKind, sceneOf, presentNames } from '../common/state.js';
import { stallOf } from '../common/stall.js';

export const KINDS = ['pulse', 'twist', 'curiosity'];

export const DEFAULTS = Object.freeze({
    'events.enabled': true,
    'events.drama': 1,
    'events.reroll_on_swipe': false,
    'events.min_turn': 2,
});

export const SCHEMA = [
    { key: 'events.drama', tab: 'director', section: 'Events', type: 'select', default: 1, label: 'Drama dial',
        options: [{ value: 0, label: 'Off' }, { value: 1, label: 'Normal' }, { value: 2, label: 'Lively' }, { value: 3, label: 'Chaos' }],
        help: 'How often the world interrupts with a small event, a complication or an open question. Off = never.', scope: 'story' },
    { key: 'events.enabled', tab: 'director', section: 'Events', type: 'toggle', default: true, label: 'Story events',
        help: 'Code dice decide when an event is due; the reply decides what it is. Quiet in intimate, grief and argument scenes.', scope: 'story' },
    { key: 'events.reroll_on_swipe', tab: 'director', section: 'Events', type: 'toggle', default: false, advanced: true, label: 'Re-roll events on swipe',
        help: 'Off: swiping a reply keeps that turn\'s event decision. On: every new swipe rolls again.', scope: 'setup' },
    { key: 'events.min_turn', tab: 'director', section: 'Events', type: 'number', default: 2, advanced: true, label: 'First event from turn',
        help: 'Let the opening breathe: no events before this player turn.', scope: 'setup', min: 1, max: 50 },
];

const BASE = { pulse: 0.12, twist: 0.10, curiosity: 0.08 };
const COOLDOWN = { pulse: 3, twist: 6, curiosity: 5 };
const STALL_BOOST = { pulse: 1.5, twist: 1.5, curiosity: 1 };
const DRAMA = [
    { mult: 0, gap: 99, cool: 1, max: 0 },
    { mult: 1, gap: 2, cool: 1, max: 0.6 },
    { mult: 1.8, gap: 2, cool: 0.8, max: 0.6 },
    { mult: 2.8, gap: 1, cool: 0.6, max: 0.75 },
];

const FALLBACK = {
    pulse: 'Due now: ambient life. Let something small and alive happen in the scene, with a visible source, without derailing it.',
    twist: 'Due now: a complication. One consequence or reversal grown from something already established; leave it open for {{user}} to answer.',
    curiosity: 'Due now: a curiosity. Plant one unexplained, concrete detail, or have a character want to know something about {{user}} they have not been told.',
};

// Tone/genre option ids → multipliers, used only when the content option carries no event_bias of its own.
const LENS_TABLE = [
    [/cozy|warm|gentle|wholesome|light|sweet|soft/, { pulse: 1.1, twist: 0.6, curiosity: 1 }],
    [/dark|grim|horror|thriller|noir|tense|bleak|gritty/, { pulse: 0.9, twist: 1.3, curiosity: 1.1 }],
    [/myster|detective|crime|investig/, { pulse: 0.9, twist: 1.1, curiosity: 1.4 }],
    [/romance|romantic/, { pulse: 1.1, twist: 0.8, curiosity: 1 }],
    [/action|adventure|war|survival/, { pulse: 1.2, twist: 1.2, curiosity: 0.9 }],
    [/comedy|comic|slice|absurd/, { pulse: 1.3, twist: 0.8, curiosity: 1 }],
];

function biasOf(obj) {
    const b = isPlainObject(obj?.event_bias) ? obj.event_bias : null;
    if (!b) return null;
    const out = {};
    for (const k of KINDS) if (Number.isFinite(Number(b[k])) && Number(b[k]) >= 0) out[k] = Number(b[k]);
    return out;
}

function lensBias(ctx, kind, id) {
    if (!id) return null;
    const own = biasOf(contentOption(ctx, kind, id));
    if (own) return own;
    for (const [re, b] of LENS_TABLE) if (re.test(String(id).toLowerCase())) return b;
    return null;
}

/** Per-kind chances for this turn. */
export function eventChances(ctx, { stalled = false } = {}) {
    const drama = Math.round(clamp(optNum(ctx, 'events.drama', DEFAULTS['events.drama']), 0, 3));
    const d = DRAMA[drama];
    const biases = [biasOf(activePersona(ctx)), lensBias(ctx, 'tone', toneId(ctx)), lensBias(ctx, 'genre', genreId(ctx))].filter(Boolean);
    const out = {};
    for (const k of KINDS) {
        let c = BASE[k] * d.mult;
        for (const b of biases) if (Number.isFinite(b[k])) c *= b[k];
        if (stalled) c *= STALL_BOOST[k];
        out[k] = clamp(c, 0, d.max);
    }
    return { chances: out, drama, gap: d.gap, cool: d.cool };
}

function cacheKey(ctx, a) {
    if (!a.user) return '';
    const base = a.userKey || `pos:${a.user.pos}`;
    if (optBool(ctx, 'events.reroll_on_swipe', false) && a.lastIsReplyAfterAnchor) {
        const last = ctx.chat[a.list[a.list.length - 1].pos];
        return `${base}#${Number(last?.swipe_id) || 0}#${Array.isArray(last?.swipes) ? last.swipes.length : 0}`;
    }
    return base;
}

function phraseVars(ctx, rng) {
    const present = presentNames(ctx);
    const sc = sceneOf(ctx);
    return {
        place: sc.place, time: sc.time, weather: sc.weather,
        someone: present.length ? present[Math.floor(Math.min(0.9999, rng()) * present.length)] : '',
    };
}

/** Choose a phrase for a kind, avoiding the last phrase used (any kind). Returns {text, idx}. */
function choosePhrase(ctx, kind, lastText, rng) {
    const list = phrases(ctx, `event_${kind}`);
    const vars = phraseVars(ctx, rng);
    const usable = list.map((t, i) => ({ i, f: fillUc(t, vars) })).filter(x => !x.f.missing.length && x.f.text);
    if (!usable.length) return { text: FALLBACK[kind], idx: -1 };
    const texts = usable.map(x => x.f.text);
    const rawAvoid = usable.findIndex(x => list[x.i] === lastText || x.f.text === lastText);
    const pick = pickVaried(texts, rng, rawAvoid === -1 ? undefined : rawAvoid);
    return { text: texts[pick], idx: usable[pick].i, raw: list[usable[pick].i] };
}

/**
 * Decide this turn's event (cached per anchor). Returns {event:null|{kind, text}, reason, chances}.
 * Pure apart from the store write of the cached roll.
 */
export function rollTurn(ctx) {
    const a = anchor(ctx);
    if (!optBool(ctx, 'events.enabled', true)) return { event: null, reason: 'off' };
    const key = cacheKey(ctx, a);
    if (!key) return { event: null, reason: 'no player message yet' };
    const rolls = isPlainObject(sget(ctx, 'rolls', null)) ? sget(ctx, 'rolls', {}) : {};
    const cached = rolls[key];
    if (isPlainObject(cached)) return { event: cached.k ? { kind: cached.k, text: cached.text } : null, reason: cached.why || 'cached' };

    const rng = rngOf(ctx);
    const turn = a.turn;
    const record = (entry) => {
        const next = pruneByUids({ ...rolls, [key]: entry }, a.userUids, 300);
        sset(ctx, 'rolls', next);
        return { event: entry.k ? { kind: entry.k, text: entry.text } : null, reason: entry.why };
    };
    const { chances, drama, gap, cool } = eventChances(ctx, { stalled: stallOf(ctx).stalled });
    if (drama === 0) return { event: null, reason: 'drama dial is off' };
    if (turn < optNum(ctx, 'events.min_turn', DEFAULTS['events.min_turn'], 1, 1000)) return record({ k: null, why: 'too early' });
    const sk = sceneKind(ctx);
    if (sk.intimate || sk.grief || sk.argument) return record({ k: null, why: `quiet in ${sk.intimate ? 'intimate' : sk.grief ? 'grief' : 'argument'} scene` });

    // History along the current chat (oldest first), excluding this anchor.
    const history = [];
    const swipeKeys = Object.keys(rolls).filter(k => k.includes('#'));
    a.userUids.slice(0, -1).forEach((uid, i) => {
        let r = rolls[uid];
        if (!r) { const ks = swipeKeys.filter(k => k.startsWith(`${uid}#`)); r = ks.length ? rolls[ks[ks.length - 1]] : null; }
        if (isPlainObject(r) && r.k) history.push({ kind: r.k, turn: i + 1, text: r.raw || r.text });
    });
    const lastAny = history.length ? history[history.length - 1] : null;
    if (lastAny && turn - lastAny.turn < gap) return record({ k: null, why: 'too soon after the last event' });
    const hits = [];
    for (const k of KINDS) {
        const last = [...history].reverse().find(h => h.kind === k);
        if (last && turn - last.turn < Math.max(1, Math.round(COOLDOWN[k] * cool))) continue;
        const r = Number(rng()) || 0;
        if (chances[k] > 0 && r < chances[k]) hits.push({ kind: k, margin: r / chances[k] });
    }
    if (!hits.length) return record({ k: null, why: 'no event this turn' });
    let best = hits[0];
    for (const h of hits) if (h.margin < best.margin) best = h;
    const p = choosePhrase(ctx, best.kind, lastAny?.text, rng);
    return record({ k: best.kind, text: p.text, raw: p.raw || p.text, why: 'fired' });
}

/** Forget the cached roll for the current anchor (an explicit "re-roll" request). */
export function rerollEvents(ctx) {
    const a = anchor(ctx);
    const key = cacheKey(ctx, a);
    const rolls = sget(ctx, 'rolls', {});
    if (key && isPlainObject(rolls) && rolls[key]) {
        const next = { ...rolls };
        delete next[key];
        sset(ctx, 'rolls', next);
        return true;
    }
    return false;
}

export default {
    id: 'events',
    settingsKeys: Object.keys(DEFAULTS),
    turnLines(ctx) {
        if (!optBool(ctx, 'events.enabled', true) || Number(opt(ctx, 'events.drama', 1)) === 0) return [];
        const r = rollTurn(ctx);
        return r.event ? [{ slot: 'uc_directive', text: r.event.text, priority: 70, source: `events:${r.event.kind}` }] : [];
    },
};
