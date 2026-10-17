// Undercurrent ports — one entry point for state.js / scribe.js / index.js. Pure logic.
//
//  - emptyPortsState() / normalizePortsState(raw): the `ports` block of the chat state (state.js patch, see
//    INTEGRATION_PORTS.md).
//  - isPortPath / parsePortPath / applyPortOp: op paths "scene_intimacy.*", "desire.*", "psyche.*", "reply_shape.*",
//    "critic.*", "drama.*". Scribe-recordable paths go through the ledger like every other op, so edits, deletes and
//    swipes roll them back. System paths (observations, critic corrections, scout bookkeeping) are accepted only from
//    source 'ports' / 'replay' or trusted batches.
//  - portObservationOps(...): the code-side observations of a finished reply, as ops to commit with the reply's entry.
//  - portScribePathGuide(...): lines to append to the scribe's {{uc_paths}}.
//  - PORTS_KNOBS / configurePorts(values): every port knob, and pushing resolved values into the reducers.

import { isPlainObject } from '../util.js';
import { PORTS_GROUPS, kb, ki, makeResolver } from './common.js';
import {
    SCENE_INTIMACY_KNOBS, emptySceneIntimacy, normalizeSceneIntimacy, applySceneIntimacyOp, observeSceneReply, sceneStatus,
    setSceneIntimacyConfig, resolveSceneIntimacyOptions, sceneIntimacyPathGuide, SCENE_INTIMACY_PATHS,
} from './scene_intimacy.js';
import { DESIRE_KNOBS, emptyDesire, normalizeDesire, applyDesireOp, setDesireConfig, resolveDesireOptions, desirePathGuide, DESIRE_PATHS } from './desire_pulse.js';
import { PSYCHE_KNOBS, emptyPsyche, normalizePsyche, applyPsycheOp, setPsycheConfig, resolvePsycheOptions, psychePathGuide, PSYCHE_PATHS } from './psyche.js';
import { REPLY_SHAPE_KNOBS, emptyReplyShape, normalizeReplyShape, applyReplyShapeOp, setReplyShapeConfig, resolveReplyShapeOptions, fingerprintReply, REPLY_SHAPE_PATHS } from './reply_shape.js';
import { CRITIC_KNOBS, emptyCritic, normalizeCritic, applyCriticOp, setCriticConfig, resolveCriticOptions, detectViolations, criticObserveOp, CRITIC_PATHS } from './critic.js';
import { DRAMA_KNOBS, emptyDrama, normalizeDrama, applyDramaOp, setDramaConfig, resolveDramaOptions, isFlatReply, dramaPathGuide, DRAMA_PATHS } from './drama_cadence.js';

export const PORTS_STATE_VERSION = 1;

export const PORT_ENGINES = Object.freeze({
    scene_intimacy: { empty: emptySceneIntimacy, normalize: normalizeSceneIntimacy, apply: applySceneIntimacyOp, paths: SCENE_INTIMACY_PATHS, system: ['observe'] },
    desire: { empty: emptyDesire, normalize: normalizeDesire, apply: applyDesireOp, paths: DESIRE_PATHS, system: [] },
    psyche: { empty: emptyPsyche, normalize: normalizePsyche, apply: applyPsycheOp, paths: PSYCHE_PATHS, system: [] },
    reply_shape: { empty: emptyReplyShape, normalize: normalizeReplyShape, apply: applyReplyShapeOp, paths: REPLY_SHAPE_PATHS, system: ['observe'] },
    critic: { empty: emptyCritic, normalize: normalizeCritic, apply: applyCriticOp, paths: CRITIC_PATHS, system: ['observe', 'corrections'] },
    drama: { empty: emptyDrama, normalize: normalizeDrama, apply: applyDramaOp, paths: DRAMA_PATHS, system: ['observe', 'scouted'] },
});

/** Scribe path groups (scribe.record_<group> style switches, see INTEGRATION_PORTS.md). */
export const PORT_PATH_GROUPS = Object.freeze([
    { id: 'scene_intimacy', label: 'Intimate scene (phase, activities, clothing, aftermath)', paths: ['scene_intimacy.phase', 'scene_intimacy.activity', 'scene_intimacy.wardrobe', 'scene_intimacy.residue', 'scene_intimacy.end'] },
    { id: 'desire_hints', label: 'Desire hints (quoted curiosity)', paths: ['desire.hint'] },
    { id: 'psyche_events', label: 'Events that matter to characters (psyche appraisal)', paths: ['psyche.event'] },
    { id: 'drama_threads', label: 'Planted questions, ask topics, spent beats', paths: ['drama.question', 'drama.ask', 'drama.beat'] },
]);

/** Cross-engine knobs (group "Ports"). */
export const PORTS_CORE_KNOBS = Object.freeze([
    kb('ports.enabled', 'Ports', 'Native ports engines', true, 'Master switch for scene intimacy, desire pulse, psyche, reply shape, critic and drama cadence (each also has its own switch).'),
    ki('ports.note_extra_words', 'Ports', 'Extra words the note may use for port lines', 120, 0, 800, 'Added to the note\'s word cap when port lines are present, so they do not crowd out the beat and world facts.'),
    ki('ports.director_lines_max', 'Ports', 'Port lines handed to the director at most', 8, 0, 30, 'Lines added to the director\'s signals each turn (desire impulse, drama due, beat menu, minds, vetoes, sparks…).'),
]);
export const resolvePortsCoreOptions = makeResolver('ports.', PORTS_CORE_KNOBS);

export const PORTS_KNOBS = Object.freeze([...PORTS_CORE_KNOBS, ...SCENE_INTIMACY_KNOBS, ...DESIRE_KNOBS, ...PSYCHE_KNOBS, ...REPLY_SHAPE_KNOBS, ...CRITIC_KNOBS, ...DRAMA_KNOBS]);
export { PORTS_GROUPS };

export function emptyPortsState() {
    const out = { v: PORTS_STATE_VERSION };
    for (const [k, e] of Object.entries(PORT_ENGINES)) out[k] = e.empty();
    return out;
}

/** Repair anything into a valid ports block. Never throws. */
export function normalizePortsState(raw) {
    const src = isPlainObject(raw) ? raw : {};
    const out = { v: PORTS_STATE_VERSION };
    for (const [k, e] of Object.entries(PORT_ENGINES)) {
        try { out[k] = e.normalize(src[k]); } catch { out[k] = e.empty(); }
    }
    return out;
}

/** "<engine>.<field>" with a known engine and field, or null. */
export function parsePortPath(path) {
    const p = Array.isArray(path) ? path.join('.') : String(path ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '.');
    const m = p.match(/^([a-z_]+)\.([a-z_]+)$/);
    if (!m) return null;
    const e = PORT_ENGINES[m[1]];
    if (!e || !e.paths.includes(m[2])) return null;
    return { kind: 'port', engine: m[1], field: m[2], system: e.system.includes(m[2]) };
}

export function isPortPath(path) {
    return !!parsePortPath(path);
}

/** The scribe path group id (PORT_PATH_GROUPS) of a port path, or null. */
export function portPathGroup(path) {
    const p = parsePortPath(path);
    if (!p) return null;
    const full = `${p.engine}.${p.field}`;
    return PORT_PATH_GROUPS.find(g => g.paths.includes(full))?.id || null;
}

/** Port paths the scribe may record (system paths excluded). */
export function isScribePortPath(path) {
    const p = parsePortPath(path);
    return !!p && !p.system;
}

/**
 * Apply one port op to a (normalized) chat state, in place — the same contract as state.js applyOne().
 * @param {object} st chat state (st.ports is created/normalized if missing)
 * @param {{op:string, path:string, value:any, until_turn?:number}} op
 * @param {{turn?:number, userName?:string, sourceText?:string, trusted?:boolean, source?:string, intimacyEnabled?:boolean}} opts
 * @returns {string} 'ok' or a rejection reason
 */
export function applyPortOp(st, op, opts = {}) {
    if (!isPlainObject(op)) return 'op must be an object';
    if (!['set', 'append', 'close', 'remove'].includes(op.op)) return `unknown op "${op.op}"`;
    const p = parsePortPath(op.path);
    if (!p) return `path not allowed: ${JSON.stringify(op.path)}`;
    if (p.system && !(opts.trusted || opts.source === 'ports' || opts.source === 'replay')) return `${op.path} is system-only`;
    if ((p.engine === 'scene_intimacy' || p.engine === 'desire') && opts.intimacyEnabled === false) return 'intimacy engine is off';
    st.ports = normalizePortsState(st.ports);
    const slice = st.ports[p.engine];
    const ctx = { turn: Number.isFinite(opts.turn) ? opts.turn : (st.turn || 0), userName: opts.userName || '', sourceText: opts.sourceText || '', trusted: !!opts.trusted, source: opts.source || 'scribe', state: st, characters: st.characters };
    try {
        return PORT_ENGINES[p.engine].apply(slice, { op: op.op, field: p.field, value: op.value, until_turn: op.until_turn }, ctx);
    } catch (e) {
        return `error: ${e?.message || e}`;
    }
}

/**
 * Code-side observations of a finished assistant reply, as system ops for the reply's ledger entry
 * (commit with {trusted: true, source: 'ports'}). Cheap; no LLM.
 * @param {object} p
 * @param {object} p.state chat state BEFORE these ops
 * @param {string} p.reply cleaned reply text
 * @param {string} [p.previous] the previous assistant reply (novelty)
 * @param {string} [p.userMessage] the player message this reply answered
 * @param {string} [p.userName]
 * @param {object} [p.ticFindings] ticguard.analyzeReply().findings
 * @param {boolean} [p.stall] ticguard.isStalled(...)
 * @param {boolean} [p.ticguardOn]
 * @param {number} [p.turn]
 * @param {object} [p.knobs] resolved knob values (flat)
 * @param {boolean} [p.intimacyEnabled]
 * @returns {{ops:object[], findings:object[], fingerprint:object|null}}
 */
export function portObservationOps({ state, reply = '', previous = '', userMessage = '', userName = '', ticFindings = null, stall = false, ticguardOn = true, turn = 0, knobs = {}, intimacyEnabled = true } = {}) {
    const ops = [];
    if (!resolvePortsCoreOptions(knobs).enabled) return { ops, findings: [], fingerprint: null };
    const si = resolveSceneIntimacyOptions(knobs);
    const st = sceneStatus(state?.ports?.scene_intimacy, state, { turn, options: si });
    if (si.enabled && intimacyEnabled !== false && st.live) {
        ops.push({ op: 'set', path: 'scene_intimacy.observe', value: observeSceneReply(reply, si), reason: 'ports' });
    }
    let fingerprint = null;
    const rs = resolveReplyShapeOptions(knobs);
    if (rs.enabled) {
        fingerprint = fingerprintReply(reply, previous, rs);
        ops.push({ op: 'set', path: 'reply_shape.observe', value: fingerprint, reason: 'ports' });
    }
    const cr = resolveCriticOptions(knobs);
    let findings = [];
    if (cr.enabled) {
        findings = detectViolations({ reply, userMessage, userName, options: cr, ticguardOn });
        ops.push(criticObserveOp(findings));
    }
    const dr = resolveDramaOptions(knobs);
    if (dr.enabled) ops.push({ op: 'set', path: 'drama.observe', value: { flat: isFlatReply({ reply, ticFindings, stall, options: dr }) }, reason: 'ports' });
    return { ops, findings, fingerprint };
}

/** Lines to append to the scribe's path list ({{uc_paths}}), following the engine switches. */
export function portScribePathGuide({ knobs = {}, intimacy = true, record = {} } = {}) {
    const on = id => record?.[id] !== false;
    const lines = [];
    if (intimacy && on('scene_intimacy') && resolveSceneIntimacyOptions(knobs).enabled) lines.push(...sceneIntimacyPathGuide(knobs));
    if (intimacy && on('desire_hints') && resolveDesireOptions(knobs).enabled) lines.push(...desirePathGuide());
    if (on('psyche_events') && resolvePsycheOptions(knobs).enabled) lines.push(...psychePathGuide());
    if (on('drama_threads') && resolveDramaOptions(knobs).enabled) lines.push(...dramaPathGuide());
    return lines.map(l => `- ${l}`);
}

/** Push resolved knob values into every reducer (call whenever knobs change, like setIntimacyConfig). */
export function configurePorts(knobs = {}) {
    return {
        scene_intimacy: setSceneIntimacyConfig(knobs),
        desire: setDesireConfig(knobs),
        psyche: setPsycheConfig(knobs),
        reply_shape: setReplyShapeConfig(knobs),
        critic: setCriticConfig(knobs),
        drama: setDramaConfig(knobs),
    };
}
