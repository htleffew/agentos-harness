// Undercurrent ports — one interceptor-time call for all port engines. Pure logic.
//
// portsTurn() runs psyche → scene_intimacy → desire_pulse → reply_shape → critic → drama_cadence for the current
// generation and returns: note lines per section (for buildInjection's `extra`), lines for the director's signals
// (`signals.extra`), {{uc_*}} macro values, and the new runtime slices. commitPortsRuntime() writes those slices back
// into the chat state (call it before saving the chat metadata).

import { psycheTurn } from './psyche.js';
import { sceneIntimacyTurn } from './scene_intimacy.js';
import { desirePulseTurn } from './desire_pulse.js';
import { replyShapeTurn } from './reply_shape.js';
import { criticTurn } from './critic.js';
import { dramaTurn } from './drama_cadence.js';
import { normalizePortsState, resolvePortsCoreOptions } from './port-state.js';
import { isPlainObject } from '../util.js';

export const PORT_SECTIONS = Object.freeze(['scene_intimacy', 'desire', 'psyche', 'reply_shape', 'critic', 'drama']);
export const PORT_MACROS = Object.freeze({
    uc_scene_intimacy: 'scene_intimacy', uc_desire: 'desire', uc_psyche: 'psyche', uc_reply_shape: 'reply_shape', uc_critic: 'critic', uc_drama: 'drama',
});

/**
 * @param {object} p
 * @param {object} p.state chat state
 * @param {number} p.turn player turn (countUserTurns)
 * @param {string} [p.type] generation type ('quiet' → nothing; 'impersonate' → nothing but psyche facts are also skipped)
 * @param {string} [p.userMessage] latest player message
 * @param {string} [p.userName]
 * @param {string} [p.charName]
 * @param {object} [p.knobs] resolved flat knob values
 * @param {boolean} [p.intimacyEnabled]
 * @param {object} [p.cardTexts] {name: card text} for defense selection ({{char}}'s description + personality)
 * @param {boolean} [p.stall] ticguard stall flag
 * @param {boolean} [p.samey] ticguard near-identical flag (last findings)
 * @param {(engine:string) => (() => number)} [p.rngFor] per-engine random source (seeded per chat+turn for reroll safety)
 * @returns {{extra:object, director:string[], macros:object, rt:object, results:object, noteExtraWords:number}}
 */
export function portsTurn({ state, turn = 0, type = 'normal', userMessage = '', userName = '', charName = '', knobs = {}, intimacyEnabled = true, cardTexts = {}, stall = false, samey = false, rngFor } = {}) {
    const rng = name => (typeof rngFor === 'function' ? rngFor(name) : Math.random);
    const results = {};
    const core = resolvePortsCoreOptions(knobs);
    if (type === 'quiet' || !core.enabled) return { extra: {}, director: [], macros: Object.fromEntries(Object.keys(PORT_MACROS).map(k => [k, ''])), rt: {}, results };
    results.psyche = psycheTurn({ state, turn, options: knobs, userName, charName, cardTexts, type });
    results.scene_intimacy = sceneIntimacyTurn({ state, turn, rng: rng('scene_intimacy'), options: knobs, userName, charName, intimacyEnabled, type });
    results.desire = desirePulseTurn({ state, turn, rng: rng('desire'), options: knobs, userName, charName, intimacyEnabled, type, psyche: results.psyche.moods });
    results.reply_shape = replyShapeTurn({ state, turn, userMessage, stall, samey, rng: rng('reply_shape'), options: knobs, type });
    results.critic = criticTurn({ state, turn, options: knobs, type });
    results.drama = dramaTurn({ state, turn, userMessage, rng: rng('drama'), options: knobs, type });
    const extra = {};
    const director = [];
    for (const sec of PORT_SECTIONS) {
        const r = results[sec];
        const lines = (r?.lines || []).filter(l => l && l.text);
        if (lines.length) extra[sec] = lines.map(l => ({ text: l.text, pri: l.pri }));
        const d = sec === 'desire' ? (r?.director ? [r.director] : []) : (r?.director || []);
        for (const x of d) if (x) director.push(x);
    }
    director.splice(core.director_lines_max);
    const macros = {};
    for (const [name, sec] of Object.entries(PORT_MACROS)) macros[name] = (extra[sec] || []).map(l => `- ${l.text}`).join('\n');
    const rt = {};
    for (const sec of ['scene_intimacy', 'desire', 'reply_shape', 'drama']) if (results[sec]?.rt) rt[sec] = results[sec].rt;
    const noteExtraWords = Object.keys(extra).length ? core.note_extra_words : 0;
    return { extra, director, macros, rt, results, noteExtraWords };
}

/** Write the runtime slices returned by portsTurn() into the chat state (mutates and returns it). */
export function commitPortsRuntime(state, rt = {}) {
    if (!isPlainObject(state)) return state;
    state.ports = normalizePortsState(state.ports);
    for (const [sec, slice] of Object.entries(isPlainObject(rt) ? rt : {})) {
        if (state.ports[sec] && isPlainObject(slice)) state.ports[sec].rt = slice;
    }
    return state;
}
