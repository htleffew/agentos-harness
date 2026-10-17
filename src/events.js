// Undercurrent — code-side randomness for world events. Pure logic.
//
// Three kinds, rolled once per new player turn:
//   pulse     — ambient life: something small and alive happens in the scene
//   twist     — a complication, consequence or reversal
//   curiosity — a question or unexplained detail planted (or a character wanting to know something)
// Base chances are scaled by the user's drama dial (0..dramaMax) and by persona/tone/genre event_bias multipliers.
// Events are suppressed in the configured scene modes (default: intimate, grief, argument). Each kind has a cooldown;
// by default at most one event per turn. Code decides IF an event happens; the director decides WHAT it is.
//
// Every number and text here is a default: callers pass `config` (built from the knobs, see knob-defs.js).

import { clamp, isPlainObject, mergeConfig } from './util.js';

export const EVENT_KINDS = ['pulse', 'twist', 'curiosity'];

export const EVENTS_DEFAULTS = Object.freeze({
    base: Object.freeze({ pulse: 0.12, twist: 0.10, curiosity: 0.08 }),
    cooldown: Object.freeze({ pulse: 3, twist: 6, curiosity: 5 }),
    stallBoost: Object.freeze({ pulse: 1.5, twist: 1.5, curiosity: 1 }),
    maxChance: 0.6,
    minGap: 2,
    dramaMax: 2,
    onePerTurn: true,
    useLensBias: true,
    suppressedModes: Object.freeze(['intimate', 'grief', 'argument']),
    historyLen: 30,
    contentChars: 240,
    fallback: Object.freeze({
        pulse: 'Ambient life: let something small and alive happen in the scene, with a visible source (a person, an errand, weather, an animal), without derailing it.',
        twist: 'Complication: one consequence or reversal grown from something already established; leave it open for {{user}} to answer.',
        curiosity: 'Curiosity: plant one unexplained, concrete detail, or have a character want to know something about {{user}} they have not been told; no answer yet.',
    }),
    directorHelp: Object.freeze({
        pulse: 'ambient life: something small and alive happens in the scene with a visible source, without derailing it.',
        twist: 'a complication, consequence or reversal grown from what is established.',
        curiosity: 'plant an unexplained concrete detail, or have a character want to learn something about {{user}} they have not been told.',
    }),
});

// Back-compat aliases (the defaults).
export const BASE_CHANCES = EVENTS_DEFAULTS.base;
export const COOLDOWN_TURNS = EVENTS_DEFAULTS.cooldown;
export const MIN_GAP_TURNS = EVENTS_DEFAULTS.minGap;
export const MAX_CHANCE = EVENTS_DEFAULTS.maxChance;
export const SUPPRESSED_MODES = EVENTS_DEFAULTS.suppressedModes;

/** Defaults merged with a partial config. */
export function eventsConfig(config) {
    return mergeConfig(EVENTS_DEFAULTS, config);
}

/**
 * @param {{drama?:number, biases?:object[], stall?:boolean, config?:object}} opts biases: list of partial {pulse,twist,curiosity} multipliers
 * @returns {{pulse:number, twist:number, curiosity:number}}
 */
export function eventChances({ drama = 1, biases = [], stall = false, config } = {}) {
    const cfg = eventsConfig(config);
    const d = clamp(drama, 0, cfg.dramaMax);
    const out = {};
    for (const k of EVENT_KINDS) {
        let c = (Number(cfg.base[k]) || 0) * d;
        if (cfg.useLensBias) {
            for (const b of biases || []) {
                if (isPlainObject(b) && Number.isFinite(b[k]) && b[k] >= 0) c *= b[k];
            }
        }
        if (stall && Number.isFinite(cfg.stallBoost[k])) c *= cfg.stallBoost[k];
        out[k] = clamp(c, 0, cfg.maxChance);
    }
    return out;
}

export function emptyEvents() {
    return { cooldowns: {}, history: [], last_roll_turn: -1, pending: null };
}

/**
 * Roll for this turn. Pure: returns a new events object.
 * @param {object} p
 * @param {object} p.events current events state
 * @param {number} p.turn current player turn
 * @param {() => number} [p.rng] random source in [0,1) (seeded in tests, Math.random in the app)
 * @param {number} [p.drama] 0..dramaMax
 * @param {object[]} [p.biases]
 * @param {string} [p.sceneMode]
 * @param {{pulse?:boolean, twist?:boolean, curiosity?:boolean}} [p.enabled]
 * @param {boolean} [p.stall]
 * @param {object} [p.config] see EVENTS_DEFAULTS
 * @returns {{events:object, event:null|{kind:string, turn:number, also?:string[]}, reason:string, rolls:object, chances:object}}
 */
export function rollEvents({ events, turn, rng = Math.random, drama = 1, biases = [], sceneMode = '', enabled = {}, stall = false, config }) {
    const cfg = eventsConfig(config);
    const ev = {
        ...emptyEvents(),
        ...(isPlainObject(events) ? events : {}),
    };
    ev.cooldowns = { ...(ev.cooldowns || {}) };
    ev.history = [...(ev.history || [])];
    const chances = eventChances({ drama, biases, stall, config: cfg });
    const result = (event, reason, rolls = {}) => ({ events: ev, event, reason, rolls, chances });

    if (ev.last_roll_turn === turn) {
        const pending = ev.pending && ev.pending.turn === turn ? ev.pending : null;
        return result(pending, 'already rolled this turn');
    }
    ev.last_roll_turn = turn;
    ev.pending = null;
    const suppressed = Array.isArray(cfg.suppressedModes) ? cfg.suppressedModes : [];
    if (suppressed.includes(String(sceneMode))) return result(null, `suppressed in ${sceneMode} scene`);
    if (clamp(drama, 0, cfg.dramaMax) === 0) return result(null, 'drama dial is 0');
    const lastAny = ev.history.length ? ev.history[ev.history.length - 1].turn : -Infinity;
    if (turn - lastAny < cfg.minGap) return result(null, 'too soon after the last event');

    const rolls = {};
    const hits = [];
    for (const k of EVENT_KINDS) {
        if (enabled[k] === false) continue;
        const last = ev.cooldowns[k];
        if (Number.isFinite(last) && turn - last < (Number(cfg.cooldown[k]) || 0)) continue;
        const r = rng();
        rolls[k] = r;
        if (chances[k] > 0 && r < chances[k]) hits.push({ kind: k, margin: r / chances[k] }); // smaller = more decisive
    }
    if (!hits.length) return result(null, 'no event this turn', rolls);
    // Most decisive first; ties keep kind order (pulse, twist, curiosity), as before.
    let best = hits[0];
    for (const h of hits) if (h.margin < best.margin) best = h;
    const others = hits.filter(h => h !== best).sort((a, b) => a.margin - b.margin);
    const fired = cfg.onePerTurn ? [best] : [best, ...others];
    const event = { kind: best.kind, turn };
    if (fired.length > 1) event.also = fired.slice(1).map(h => h.kind);
    for (const h of fired) {
        ev.cooldowns[h.kind] = turn;
        ev.history.push({ kind: h.kind, turn });
    }
    ev.history = ev.history.slice(-cfg.historyLen);
    ev.pending = event;
    return result(event, 'fired', rolls);
}

/** Every kind due in an event (primary first). */
export function eventKinds(event) {
    if (!event?.kind) return [];
    return [event.kind, ...(Array.isArray(event.also) ? event.also : [])];
}

/** Generic direction for an event when the director could not supply its content. */
export function eventFallbackText(kind, config) {
    const cfg = eventsConfig(config);
    return EVENT_KINDS.includes(kind) ? String(cfg.fallback[kind] ?? '') : '';
}

/** One-line help for the director about what an event kind means. */
export function eventDirectorHelp(kind, config) {
    const cfg = eventsConfig(config);
    return EVENT_KINDS.includes(kind) ? String(cfg.directorHelp[kind] ?? '') : '';
}

/** Record the director's content for the event in history. */
export function recordEventContent(events, turn, content, config) {
    const max = eventsConfig(config).contentChars;
    const ev = { ...emptyEvents(), ...(isPlainObject(events) ? events : {}) };
    const text = String(content || '').slice(0, max);
    ev.history = (ev.history || []).map(h => (h.turn === turn && !h.content ? { ...h, content: text } : h));
    if (ev.pending && ev.pending.turn === turn) ev.pending = { ...ev.pending, content: text };
    return ev;
}
