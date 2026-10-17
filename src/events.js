// Undercurrent — code-side randomness for world events. Pure logic.
//
// Three kinds, rolled once per new player turn:
//   pulse     — ambient life: something small and alive happens in the scene
//   twist     — a complication, consequence or reversal
//   curiosity — a question or unexplained detail planted (or a character wanting to know something)
// Base chances are scaled by the user's drama dial (0..2) and by persona/tone/genre event_bias multipliers.
// Events are suppressed in intimate, grief and argument scenes. Each kind has a cooldown; at most one event per turn.
// Code decides IF an event happens; the director decides WHAT it is.

import { clamp, isPlainObject } from './util.js';

export const EVENT_KINDS = ['pulse', 'twist', 'curiosity'];
export const BASE_CHANCES = { pulse: 0.12, twist: 0.10, curiosity: 0.08 };
export const COOLDOWN_TURNS = { pulse: 3, twist: 6, curiosity: 5 };
export const MIN_GAP_TURNS = 2;
export const MAX_CHANCE = 0.6;
export const SUPPRESSED_MODES = ['intimate', 'grief', 'argument'];

/**
 * @param {{drama?:number, biases?:object[], stall?:boolean}} opts biases: list of partial {pulse,twist,curiosity} multipliers
 * @returns {{pulse:number, twist:number, curiosity:number}}
 */
export function eventChances({ drama = 1, biases = [], stall = false } = {}) {
    const d = clamp(drama, 0, 2);
    const out = {};
    for (const k of EVENT_KINDS) {
        let c = BASE_CHANCES[k] * d;
        for (const b of biases || []) {
            if (isPlainObject(b) && Number.isFinite(b[k]) && b[k] >= 0) c *= b[k];
        }
        if (stall && (k === 'pulse' || k === 'twist')) c *= 1.5;
        out[k] = clamp(c, 0, MAX_CHANCE);
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
 * @param {number} [p.drama] 0..2
 * @param {object[]} [p.biases]
 * @param {string} [p.sceneMode]
 * @param {{pulse?:boolean, twist?:boolean, curiosity?:boolean}} [p.enabled]
 * @param {boolean} [p.stall]
 * @returns {{events:object, event:null|{kind:string, turn:number}, reason:string, rolls:object, chances:object}}
 */
export function rollEvents({ events, turn, rng = Math.random, drama = 1, biases = [], sceneMode = '', enabled = {}, stall = false }) {
    const ev = {
        ...emptyEvents(),
        ...(isPlainObject(events) ? events : {}),
    };
    ev.cooldowns = { ...(ev.cooldowns || {}) };
    ev.history = [...(ev.history || [])];
    const chances = eventChances({ drama, biases, stall });
    const result = (event, reason, rolls = {}) => ({ events: ev, event, reason, rolls, chances });

    if (ev.last_roll_turn === turn) {
        const pending = ev.pending && ev.pending.turn === turn ? ev.pending : null;
        return result(pending, 'already rolled this turn');
    }
    ev.last_roll_turn = turn;
    ev.pending = null;
    if (SUPPRESSED_MODES.includes(String(sceneMode))) return result(null, `suppressed in ${sceneMode} scene`);
    if (clamp(drama, 0, 2) === 0) return result(null, 'drama dial is 0');
    const lastAny = ev.history.length ? ev.history[ev.history.length - 1].turn : -Infinity;
    if (turn - lastAny < MIN_GAP_TURNS) return result(null, 'too soon after the last event');

    const rolls = {};
    let best = null;
    for (const k of EVENT_KINDS) {
        if (enabled[k] === false) continue;
        const last = ev.cooldowns[k];
        if (Number.isFinite(last) && turn - last < COOLDOWN_TURNS[k]) continue;
        const r = rng();
        rolls[k] = r;
        if (chances[k] > 0 && r < chances[k]) {
            const margin = r / chances[k]; // smaller = more decisive
            if (!best || margin < best.margin) best = { kind: k, margin };
        }
    }
    if (!best) return result(null, 'no event this turn', rolls);
    const event = { kind: best.kind, turn };
    ev.cooldowns[best.kind] = turn;
    ev.history.push({ kind: best.kind, turn });
    ev.history = ev.history.slice(-30);
    ev.pending = event;
    return result(event, 'fired', rolls);
}

/** Generic direction for an event when the director could not supply its content. */
export function eventFallbackText(kind) {
    switch (kind) {
        case 'pulse': return 'Ambient life: let something small and alive happen in the scene, with a visible source (a person, an errand, weather, an animal), without derailing it.';
        case 'twist': return 'Complication: one consequence or reversal grown from something already established; leave it open for {{user}} to answer.';
        case 'curiosity': return 'Curiosity: plant one unexplained, concrete detail, or have a character want to know something about {{user}} they have not been told; no answer yet.';
        default: return '';
    }
}

/** Record the director's content for the event in history. */
export function recordEventContent(events, turn, content) {
    const ev = { ...emptyEvents(), ...(isPlainObject(events) ? events : {}) };
    ev.history = (ev.history || []).map(h => (h.turn === turn && !h.content ? { ...h, content: String(content || '').slice(0, 240) } : h));
    if (ev.pending && ev.pending.turn === turn) ev.pending = { ...ev.pending, content: String(content || '').slice(0, 240) };
    return ev;
}
