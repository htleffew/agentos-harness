// Undercurrent — per-chat state: schema, defaults, patch operations, ledger, snapshots and rollback. Pure logic.
//
// State is changed only through patch ops {op:set|append|close|remove, path, value, reason, until_turn?}.
// Each batch applied for an assistant message is recorded in the ledger under that message's key
// {index, swipe_id, text_hash} together with a snapshot of the story state from before it. When a message is edited,
// deleted or swiped, entries whose key no longer matches are invalidated: the story state is restored from the snapshot
// before the earliest invalid entry, and the later entries that are still valid are replayed on top.

import {
    clip, normText, contentTokens, jaccard, deepClone, isPlainObject, findKeyCI, hashText,
} from './util.js';
import { applyIntimacyOp, emptyIntimacy, normalizeIntimacy } from './intimacy.js';
import { emptyGoals, normalizeGoals } from './goals.js';
import { emptyRuleState, normalizeRuleState } from './rules.js';
import { emptyPortsState, normalizePortsState, isPortPath, applyPortOp } from './ports/port-state.js';

export const STATE_VERSION = 1;
// romantic / flirt (v1.1) let the Chance rules' @romance group and the director tell courtship apart from intimacy.
export const SCENE_MODES = ['conversation', 'action', 'intimate', 'romantic', 'flirt', 'grief', 'argument', 'tension', 'quiet', 'travel', 'comedy'];
export const OPS = ['set', 'append', 'close', 'remove'];

export const LIMITS_DEFAULTS = Object.freeze({
    facts: 80,
    closedKeepTurns: 30,
    charList: 12,
    threads: 12,
    usedBeats: 30,
    ledger: 60,
    snapshots: 20,
    characters: 40,
    swipeCache: 12,
    eventsHistory: 30,
    opsPerBatch: 24,
});

/** Live caps (knobs state.*). Mutated in place by setLimits() so every reader sees the current values. */
export const LIMITS = { ...LIMITS_DEFAULTS };

/** Set caps from knobs: unknown keys and non-positive / non-finite values are ignored. Returns LIMITS. */
export function setLimits(partial = {}) {
    for (const k of Object.keys(LIMITS_DEFAULTS)) {
        const v = partial?.[k];
        LIMITS[k] = Number.isFinite(v) && v >= 0 ? Math.round(v) : LIMITS_DEFAULTS[k];
    }
    return LIMITS;
}

export function resetLimits() {
    return setLimits({});
}

const SCENE_SCALARS = ['mode', 'place', 'time', 'weather'];
const CHAR_SCALARS = ['role', 'ikigai', 'mood', 'last_seen', 'offscreen', 'age', 'traits', 'background', 'relation'];
const CHAR_LISTS = ['wants', 'plans', 'goals', 'knows', 'doesnt_know', 'secrets'];
const INTIMACY_FIELDS = ['orientation', 'style', 'phase', 'attraction', 'preferences', 'limits', 'history'];
const THREAD_LISTS = ['offscreen', 'arcs', 'driver'];
const STORY_KEYS = ['scene', 'characters', 'facts', 'threads', 'ports'];

// ---------------------------------------------------------------------------------------------------------------------
// Schema & defaults

export function createState() {
    return {
        v: STATE_VERSION,
        turn: 0,
        scene: { mode: 'conversation', place: '', time: '', weather: '', present: [] },
        characters: {},
        facts: [],
        threads: { offscreen: [], arcs: [], driver: [], used_beats: [] },
        director: { last_turn: -1, plan: null, plan_turn: -1, plan_key: '', nudge: '', last_injection: '' },
        events: { cooldowns: {}, history: [], last_roll_turn: -1, pending: null },
        tics: { counts: {}, level: 0, streak: 0, pending: [], last_progress_turn: 0 },
        ledger: [],
        snapshots: {},
        swipe_cache: [],
        knob_overrides: {},
        goals: emptyGoals(),
        rules_state: emptyRuleState(),
        ports: emptyPortsState(),
    };
}

export function emptyCharacter(extra = {}) {
    return {
        role: '', ikigai: '', mood: '', age: '', traits: '', background: '', relation: '',
        wants: [], plans: [], goals: [], knows: [], doesnt_know: [], secrets: [],
        last_seen: '', offscreen: '',
        intimacy: emptyIntimacy(),
        ...extra,
    };
}

function s(v, max = 300) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return clip(v, max);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

function num(v, def) {
    return Number.isFinite(v) ? v : def;
}

function normItem(raw, turn = 0) {
    if (typeof raw === 'string') raw = { text: raw };
    if (!isPlainObject(raw)) return null;
    const text = s(raw.text ?? raw.item ?? raw.name ?? (raw.who && raw.doing ? `${raw.who}: ${raw.doing}` : ''), 300);
    if (!text) return null;
    const out = { ...raw, text, since_turn: num(raw.since_turn, turn), until_turn: Number.isFinite(raw.until_turn) ? raw.until_turn : null };
    for (const k of Object.keys(out)) {
        if (typeof out[k] === 'string') out[k] = clip(out[k], 300);
    }
    return out;
}

function normList(list, turn = 0) {
    return (Array.isArray(list) ? list : []).map(x => normItem(x, turn)).filter(Boolean);
}

export function normalizeCharacter(raw) {
    const c = emptyCharacter();
    if (!isPlainObject(raw)) return c;
    for (const k of CHAR_SCALARS) c[k] = s(raw[k], k === 'background' ? 400 : 200);
    for (const k of CHAR_LISTS) c[k] = normList(raw[k]);
    c.intimacy = normalizeIntimacy(raw.intimacy);
    return c;
}

/** Repair anything into a valid state object. Never throws. */
export function normalizeState(raw) {
    const st = createState();
    if (!isPlainObject(raw)) return st;
    st.turn = num(raw.turn, 0);
    const sc = isPlainObject(raw.scene) ? raw.scene : {};
    st.scene.mode = SCENE_MODES.includes(sc.mode) ? sc.mode : 'conversation';
    st.scene.place = s(sc.place, 160);
    st.scene.time = s(sc.time, 120);
    st.scene.weather = s(sc.weather, 120);
    st.scene.present = (Array.isArray(sc.present) ? sc.present : []).map(n => s(n, 60)).filter(Boolean);
    if (isPlainObject(raw.characters)) {
        for (const [name, c] of Object.entries(raw.characters)) {
            const n = s(name, 60);
            if (n) st.characters[n] = normalizeCharacter(c);
        }
    }
    st.facts = normList(raw.facts);
    const th = isPlainObject(raw.threads) ? raw.threads : {};
    for (const k of THREAD_LISTS) st.threads[k] = normList(th[k]);
    st.threads.used_beats = normList(th.used_beats);
    const d = isPlainObject(raw.director) ? raw.director : {};
    st.director = {
        last_turn: num(d.last_turn, -1),
        plan: isPlainObject(d.plan) ? d.plan : null,
        plan_turn: num(d.plan_turn, -1),
        plan_key: s(d.plan_key, 40),
        nudge: s(d.nudge, 600),
        last_injection: typeof d.last_injection === 'string' ? d.last_injection : '',
    };
    const e = isPlainObject(raw.events) ? raw.events : {};
    st.events = {
        cooldowns: isPlainObject(e.cooldowns) ? Object.fromEntries(Object.entries(e.cooldowns).filter(([, v]) => Number.isFinite(v))) : {},
        history: (Array.isArray(e.history) ? e.history : []).filter(isPlainObject).slice(-LIMITS.eventsHistory),
        last_roll_turn: num(e.last_roll_turn, -1),
        pending: isPlainObject(e.pending) ? e.pending : null,
    };
    const t = isPlainObject(raw.tics) ? raw.tics : {};
    st.tics = {
        counts: isPlainObject(t.counts) ? Object.fromEntries(Object.entries(t.counts).filter(([, v]) => Number.isFinite(v))) : {},
        level: num(t.level, 0),
        streak: num(t.streak, 0),
        pending: (Array.isArray(t.pending) ? t.pending : []).filter(x => typeof x === 'string').slice(0, 6),
        last_progress_turn: num(t.last_progress_turn, 0),
    };
    st.ledger = (Array.isArray(raw.ledger) ? raw.ledger : []).filter(x => isPlainObject(x) && Number.isFinite(x.index) && typeof x.text_hash === 'string')
        .map(x => ({ ...x, swipe_id: num(x.swipe_id, 0), ops: Array.isArray(x.ops) ? x.ops : [], turn: num(x.turn, 0) }))
        .slice(-LIMITS.ledger);
    st.snapshots = isPlainObject(raw.snapshots) ? raw.snapshots : {};
    st.swipe_cache = (Array.isArray(raw.swipe_cache) ? raw.swipe_cache : []).filter(x => isPlainObject(x) && typeof x.text_hash === 'string').slice(0, LIMITS.swipeCache);
    // Per-chat settings overrides (knobs); values are validated by knobs.resolve(), not here.
    st.knob_overrides = isPlainObject(raw.knob_overrides) ? { ...raw.knob_overrides } : {};
    // Goals & Tasks: author-managed, outside the ledger/snapshots (completions reconcile via goals.reconcileCompletions).
    // Chats saved before v1.1 have no goals block and get the default one here.
    st.goals = normalizeGoals(raw.goals);
    // Chance rules runtime state (cooldowns, sticky, cycles, switches); not ledgered, not in rollback snapshots.
    st.rules_state = normalizeRuleState(raw.rules_state);
    // Native port engines (scene intimacy, desire, psyche, reply shape, critic, drama): story state, ledgered.
    st.ports = normalizePortsState(raw.ports);
    return st;
}

/** Strict structural check used before accepting a hand-edited state (State Inspector). */
export function validateStateObject(raw) {
    const errors = [];
    if (!isPlainObject(raw)) return ['State must be a JSON object.'];
    if (raw.v !== undefined && raw.v !== STATE_VERSION) errors.push(`"v" must be ${STATE_VERSION}.`);
    if (raw.scene !== undefined && !isPlainObject(raw.scene)) errors.push('"scene" must be an object.');
    if (isPlainObject(raw.scene)) {
        if (raw.scene.mode !== undefined && !SCENE_MODES.includes(raw.scene.mode)) errors.push(`"scene.mode" must be one of: ${SCENE_MODES.join(', ')}.`);
        if (raw.scene.present !== undefined && !Array.isArray(raw.scene.present)) errors.push('"scene.present" must be an array of names.');
    }
    if (raw.characters !== undefined && !isPlainObject(raw.characters)) errors.push('"characters" must be an object keyed by name.');
    if (isPlainObject(raw.characters)) {
        for (const [name, c] of Object.entries(raw.characters)) {
            if (!isPlainObject(c)) { errors.push(`characters["${name}"] must be an object.`); continue; }
            for (const k of CHAR_LISTS) if (c[k] !== undefined && !Array.isArray(c[k])) errors.push(`characters["${name}"].${k} must be an array.`);
            if (c.intimacy !== undefined && !isPlainObject(c.intimacy)) errors.push(`characters["${name}"].intimacy must be an object.`);
        }
    }
    for (const k of ['facts', 'ledger', 'swipe_cache']) {
        if (raw[k] !== undefined && !Array.isArray(raw[k])) errors.push(`"${k}" must be an array.`);
    }
    if (Array.isArray(raw.facts)) {
        raw.facts.forEach((f, i) => {
            if (!(typeof f === 'string' || (isPlainObject(f) && typeof f.text === 'string'))) errors.push(`facts[${i}] needs a "text" string.`);
        });
    }
    for (const k of ['threads', 'director', 'events', 'tics', 'snapshots', 'knob_overrides', 'goals', 'rules_state', 'ports']) {
        if (raw[k] !== undefined && !isPlainObject(raw[k])) errors.push(`"${k}" must be an object.`);
    }
    return errors;
}

/** Parse and validate inspector JSON. */
export function parseStateJson(text) {
    let raw;
    try {
        raw = JSON.parse(String(text ?? ''));
    } catch (e) {
        return { ok: false, state: null, errors: [`Invalid JSON: ${e.message}`] };
    }
    const errors = validateStateObject(raw);
    if (errors.length) return { ok: false, state: null, errors };
    return { ok: true, state: normalizeState(raw), errors: [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Items

export function isOpen(item, turn) {
    return !!item && (item.until_turn === null || item.until_turn === undefined || item.until_turn > turn);
}

export function openItems(list, turn) {
    return (Array.isArray(list) ? list : []).filter(i => isOpen(i, turn));
}

function itemText(v) {
    if (typeof v === 'string') return v;
    if (!isPlainObject(v)) return '';
    return v.text ?? v.item ?? v.name ?? (v.who ? `${v.who}${v.doing ? `: ${v.doing}` : ''}` : '');
}

/** Find the best matching item index: exact normalized text, else best token overlap >= 0.5. */
export function findItem(list, value, { openOnly = true, turn = 0 } = {}) {
    const target = itemText(value);
    const nt = normText(target);
    if (!nt) return -1;
    let best = -1;
    let bestScore = 0;
    const tt = contentTokens(target);
    (list || []).forEach((it, idx) => {
        if (openOnly && !isOpen(it, turn)) return;
        const keys = [it.text, it.who, it.name, it.item].filter(Boolean);
        for (const k of keys) {
            if (normText(k) === nt) { if (bestScore < 2) { best = idx; bestScore = 2; } return; }
        }
        const score = jaccard(tt, contentTokens(it.text));
        if (score >= 0.5 && score > bestScore) { best = idx; bestScore = score; }
    });
    return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// Paths

/**
 * Parse an op path against the allow-list. Returns null when not allowed.
 * Forms: scene.<mode|place|time|weather|present>, facts, threads.<offscreen|arcs|driver|used_beats>,
 * characters.<Name>[.<field>][.intimacy.<field>]. Names may contain dots/spaces; array paths are accepted too.
 */
export function parsePath(path) {
    let parts;
    if (Array.isArray(path)) parts = path.map(p => String(p));
    else if (typeof path === 'string') parts = null;
    else return null;
    const p = parts ? parts.join('.') : String(path).trim().replace(/^\/+|\/+$/g, '').replace(/\//g, '.');
    if (!p) return null;
    if (p === 'facts') return { kind: 'facts' };
    let m = p.match(/^scene\.(mode|place|time|weather|present)$/);
    if (m) return { kind: 'scene', field: m[1] };
    m = p.match(/^threads\.(offscreen|arcs|driver|used_beats)$/);
    if (m) return { kind: 'threads', field: m[1] };
    if (!p.startsWith('characters.')) return null;
    if (parts && parts[0] === 'characters') {
        const [, name, a, b] = parts;
        return charPath(name, a, b, parts.length);
    }
    let rest = p.slice('characters.'.length);
    rest = rest.replace(/^\[\s*["']?|["']?\s*\]$/g, '');
    const intim = rest.match(/^(.+?)\.intimacy\.(\w+)$/);
    if (intim) return charPath(intim[1], 'intimacy', intim[2], 4);
    const field = rest.match(/^(.+)\.(\w+)$/);
    if (field && (CHAR_SCALARS.includes(field[2]) || CHAR_LISTS.includes(field[2]))) return charPath(field[1], field[2], undefined, 3);
    if (rest.endsWith('.intimacy')) return null;
    return charPath(rest, undefined, undefined, 2);
}

function charPath(name, field, sub, len) {
    const n = String(name ?? '').replace(/^\[\s*["']?|["']?\s*\]$/g, '').trim();
    if (!n || n.length > 60 || /[{}<>]/.test(n)) return null;
    if (len === 2 || field === undefined) return { kind: 'character', name: n, field: null };
    if (field === 'intimacy') {
        if (!INTIMACY_FIELDS.includes(sub)) return null;
        return { kind: 'intimacy', name: n, field: sub };
    }
    if (sub !== undefined) return null;
    if (CHAR_SCALARS.includes(field)) return { kind: 'character', name: n, field, list: false };
    if (CHAR_LISTS.includes(field)) return { kind: 'character', name: n, field, list: true };
    return null;
}

export const ALLOWED_PATH_HELP = [
    'scene.mode', 'scene.place', 'scene.time', 'scene.weather', 'scene.present', 'facts',
    'threads.offscreen', 'threads.arcs', 'threads.driver',
    'characters.<Name>', ...CHAR_SCALARS.map(f => `characters.<Name>.${f}`), ...CHAR_LISTS.map(f => `characters.<Name>.${f}`),
    ...INTIMACY_FIELDS.map(f => `characters.<Name>.intimacy.${f}`),
];

// ---------------------------------------------------------------------------------------------------------------------
// Applying ops

/**
 * Apply patch ops to a copy of the state.
 * @param {object} state
 * @param {object[]} ops
 * @param {{turn?:number, userName?:string, sourceText?:string, trusted?:boolean, source?:'scribe'|'director'|'inreply'|'replay', intimacyEnabled?:boolean}} opts
 * @returns {{state:object, applied:object[], rejected:{op:object, reason:string}[]}}
 */
export function applyOps(state, ops, opts = {}) {
    const st = normalizeState(deepClone(state));
    const turn = Number.isFinite(opts.turn) ? opts.turn : st.turn;
    const applied = [];
    const rejected = [];
    const list = (Array.isArray(ops) ? ops : []).slice(0, opts.trusted ? 500 : LIMITS.opsPerBatch);
    for (const op of list) {
        let reason = 'ok';
        try {
            reason = applyOne(st, op, { ...opts, turn });
        } catch (e) {
            reason = `error: ${e?.message || e}`;
        }
        if (reason === 'ok') applied.push(cleanOp(op));
        else rejected.push({ op, reason });
    }
    prune(st, turn);
    return { state: st, applied, rejected };
}

function cleanOp(op) {
    const o = { op: op.op, path: op.path, value: op.value };
    if (op.reason) o.reason = clip(String(op.reason), 120);
    if (Number.isFinite(op.until_turn)) o.until_turn = op.until_turn;
    return o;
}

function isUserName(name, userName) {
    if (!userName) return /^\{\{user\}\}$/i.test(name);
    return name.trim().toLowerCase() === String(userName).trim().toLowerCase() || /^\{\{user\}\}$/i.test(name);
}

function progress(st, turn) {
    st.tics.last_progress_turn = Math.max(st.tics.last_progress_turn || 0, turn);
}

function ensureCharacter(st, name, turn) {
    const key = findKeyCI(st.characters, name);
    if (key) return { key, created: false };
    st.characters[name] = emptyCharacter({ last_seen: st.scene.place || '' });
    st.characters[name]._since = turn;
    return { key: name, created: true };
}

function appendItem(list, value, turn, untilTurn, dedupeKey) {
    const item = normItem(value, turn);
    if (!item) return 'empty value';
    item.since_turn = turn;
    item.until_turn = Number.isFinite(untilTurn) ? untilTurn : null;
    if (dedupeKey && item[dedupeKey]) {
        const idx = list.findIndex(x => isOpen(x, turn) && x[dedupeKey] && normText(x[dedupeKey]) === normText(item[dedupeKey]));
        if (idx !== -1) { list[idx] = { ...list[idx], ...item, since_turn: list[idx].since_turn }; return 'ok'; }
    }
    if (list.some(x => isOpen(x, turn) && normText(x.text) === normText(item.text))) return 'ok';
    list.push(item);
    return 'ok';
}

function closeItem(list, value, turn) {
    const idx = findItem(list, value, { openOnly: true, turn });
    if (idx === -1) return 'no matching open item';
    list[idx].until_turn = turn;
    return 'ok';
}

function removeItem(list, value, turn) {
    const idx = findItem(list, value, { openOnly: false, turn });
    if (idx === -1) return 'no matching item';
    list.splice(idx, 1);
    return 'ok';
}

function listOp(list, op, turn, dedupeKey) {
    switch (op.op) {
        case 'append': return appendItem(list, op.value, turn, op.until_turn, dedupeKey);
        case 'close': return closeItem(list, op.value, turn);
        case 'remove': return removeItem(list, op.value, turn);
        default: return `"${op.op}" not allowed on a list (use append/close/remove)`;
    }
}

function scalarValue(v, max = 200) {
    if (isPlainObject(v)) v = v.value ?? v.text ?? '';
    return s(v, max);
}

function applyOne(st, op, opts) {
    if (!isPlainObject(op)) return 'op must be an object';
    if (!OPS.includes(op.op)) return `unknown op "${op.op}"`;
    if (isPortPath(op.path)) return applyPortOp(st, op, opts);
    const p = parsePath(op.path);
    if (!p) return `path not allowed: ${JSON.stringify(op.path)}`;
    const turn = opts.turn;
    const source = opts.source || 'scribe';

    if (p.kind === 'scene') {
        if (p.field === 'present') {
            const names = op.op === 'set' ? (Array.isArray(op.value) ? op.value : [op.value]) : [op.value];
            const clean = names.map(n => s(isPlainObject(n) ? n.name : n, 60)).filter(n => n && !isUserName(n, opts.userName));
            if (op.op === 'set') {
                st.scene.present = [...new Set(clean)];
                for (const n of clean) ensureCharacter(st, n, turn);
                return 'ok';
            }
            if (!clean.length) return 'no valid name';
            const name = clean[0];
            if (op.op === 'append') {
                const { key, created } = ensureCharacter(st, name, turn);
                if (created) progress(st, turn);
                if (!st.scene.present.some(n => n.toLowerCase() === key.toLowerCase())) st.scene.present.push(key);
                if (st.scene.place) st.characters[key].last_seen = st.scene.place;
                return 'ok';
            }
            const before = st.scene.present.length;
            st.scene.present = st.scene.present.filter(n => n.toLowerCase() !== name.toLowerCase());
            return st.scene.present.length < before ? 'ok' : 'name not present';
        }
        if (op.op === 'append') return 'scene fields are set, not appended';
        if (p.field === 'mode') {
            if (op.op !== 'set') { st.scene.mode = 'conversation'; return 'ok'; }
            const v = scalarValue(op.value, 30).toLowerCase();
            if (!SCENE_MODES.includes(v)) return `scene.mode must be one of ${SCENE_MODES.join('|')}`;
            st.scene.mode = v;
            return 'ok';
        }
        const v = op.op === 'set' ? scalarValue(op.value, p.field === 'place' ? 160 : 120) : '';
        if (v !== st.scene[p.field] && (p.field === 'place' || p.field === 'time') && v) progress(st, turn);
        st.scene[p.field] = v;
        if (p.field === 'place' && v) {
            for (const n of st.scene.present) {
                const k = findKeyCI(st.characters, n);
                if (k) st.characters[k].last_seen = v;
            }
        }
        return 'ok';
    }

    if (p.kind === 'facts') {
        if (op.op === 'set') return 'facts are appended/closed, not set';
        const r = listOp(st.facts, op, turn);
        if (r === 'ok' && op.op === 'append') progress(st, turn);
        return r;
    }

    if (p.kind === 'threads') {
        if (p.field === 'used_beats' && source !== 'director' && source !== 'replay') return 'threads.used_beats is director-only';
        if (op.op === 'set') return 'threads are appended/closed, not set';
        const key = p.field === 'offscreen' ? 'who' : p.field === 'arcs' ? 'name' : p.field === 'driver' ? 'item' : null;
        let value = op.value;
        if (p.field === 'offscreen' && isPlainObject(value)) {
            value = { who: s(value.who, 60), doing: s(value.doing, 200), surfaces_when: s(value.surfaces_when, 160) };
            if (!value.who || !value.doing) return 'offscreen needs who and doing';
            value.text = `${value.who}: ${value.doing}`;
        } else if (p.field === 'arcs' && isPlainObject(value)) {
            value = { name: s(value.name, 80), status: s(value.status, 160), next: s(value.next, 160) };
            if (!value.name) return 'arc needs a name';
            value.text = value.name;
        } else if (p.field === 'driver' && isPlainObject(value)) {
            value = { item: s(value.item, 100), purpose: s(value.purpose, 160), planned_outcome: s(value.planned_outcome, 160) };
            if (!value.item) return 'driver needs an item';
            value.text = value.item;
        }
        const r = listOp(st.threads[p.field], { ...op, value }, turn, op.op === 'append' ? key : null);
        if (r === 'ok' && op.op === 'append' && p.field !== 'used_beats') progress(st, turn);
        return r;
    }

    if (p.kind === 'character' || p.kind === 'intimacy') {
        if (isUserName(p.name, opts.userName)) return 'the player character is never tracked as an NPC';
        if (p.kind === 'intimacy' && opts.intimacyEnabled === false) return 'intimacy engine is off';

        if (p.kind === 'character' && p.field === null) {
            if (op.op === 'remove' || op.op === 'close') {
                const key = findKeyCI(st.characters, p.name);
                if (!key) return 'no such character';
                delete st.characters[key];
                st.scene.present = st.scene.present.filter(n => n.toLowerCase() !== key.toLowerCase());
                return 'ok';
            }
            if (op.op !== 'set') return 'characters.<Name> takes set (profile) or remove';
            if (!isPlainObject(op.value)) return 'character profile must be an object';
            const { key, created } = ensureCharacter(st, p.name, turn);
            const c = st.characters[key];
            for (const f of CHAR_SCALARS) {
                if (op.value[f] !== undefined && op.value[f] !== null && op.value[f] !== '') {
                    c[f] = s(Array.isArray(op.value[f]) ? op.value[f].join(', ') : op.value[f], f === 'background' ? 400 : 200);
                }
            }
            for (const f of CHAR_LISTS) {
                const vals = Array.isArray(op.value[f]) ? op.value[f] : (typeof op.value[f] === 'string' && op.value[f] ? [op.value[f]] : []);
                for (const v of vals.slice(0, 6)) appendItem(c[f], v, turn, null);
            }
            if (created) progress(st, turn);
            return 'ok';
        }

        const { key, created } = ensureCharacter(st, p.name, turn);
        if (created) progress(st, turn);
        const c = st.characters[key];

        if (p.kind === 'intimacy') {
            const r = applyIntimacyOp(c.intimacy, { op: op.op, field: p.field, value: op.value }, {
                turn, sourceText: opts.sourceText, trusted: !!opts.trusted,
            });
            if (r.ok) c.intimacy = r.intimacy;
            else if (created) delete st.characters[key];
            return r.ok ? 'ok' : r.reason;
        }
        if (p.list) {
            const r = listOp(c[p.field], op, turn);
            if (r === 'ok' && op.op === 'append' && p.field === 'knows') {
                // Learning something resolves the matching gap.
                const gap = findItem(c.doesnt_know, op.value, { openOnly: true, turn });
                if (gap !== -1) c.doesnt_know[gap].until_turn = turn;
            }
            return r;
        }
        if (op.op === 'append') return `${p.field} is set, not appended`;
        c[p.field] = op.op === 'set' ? scalarValue(op.value, p.field === 'background' ? 400 : 200) : '';
        return 'ok';
    }
    return 'unhandled path';
}

/** Keep lists bounded: drop long-closed items, cap open items (oldest first), cap characters. */
export function prune(st, turn) {
    const trim = (list, cap) => {
        let l = list.filter(i => isOpen(i, turn) || (turn - (i.until_turn ?? turn)) < LIMITS.closedKeepTurns);
        const open = l.filter(i => isOpen(i, turn));
        if (open.length > cap) {
            const drop = new Set(open.slice(0, open.length - cap));
            l = l.filter(i => !drop.has(i));
        }
        const closed = l.filter(i => !isOpen(i, turn));
        if (closed.length > cap) {
            const drop = new Set(closed.slice(0, closed.length - cap));
            l = l.filter(i => !drop.has(i));
        }
        return l;
    };
    st.facts = trim(st.facts, LIMITS.facts);
    for (const k of THREAD_LISTS) st.threads[k] = trim(st.threads[k], LIMITS.threads);
    st.threads.used_beats = st.threads.used_beats.slice(-LIMITS.usedBeats);
    for (const c of Object.values(st.characters)) {
        for (const k of CHAR_LISTS) c[k] = trim(c[k], LIMITS.charList);
    }
    const names = Object.keys(st.characters);
    if (names.length > LIMITS.characters) {
        const present = new Set(st.scene.present.map(n => n.toLowerCase()));
        const removable = names.filter(n => !present.has(n.toLowerCase()));
        const excess = names.length - LIMITS.characters;
        for (const n of removable.slice(0, excess)) delete st.characters[n];
    }
    st.events.history = st.events.history.slice(-LIMITS.eventsHistory);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ledger, snapshots, rollback

/** Key of a chat message: {index, swipe_id, text_hash}. */
export function messageKey(msg, index) {
    return { index, swipe_id: Number.isFinite(msg?.swipe_id) ? msg.swipe_id : 0, text_hash: hashText(msg?.mes ?? '') };
}

/** Light per-message keys for the whole chat (what reconcile needs). */
export function chatKeys(chat) {
    return (Array.isArray(chat) ? chat : []).map((m, i) => ({
        index: i,
        is_user: !!m?.is_user,
        is_system: !!m?.is_system,
        ...messageKey(m, i),
    }));
}

export function entryId(key) {
    return `${key.index}:${key.swipe_id}:${key.text_hash}`;
}

/** Snapshot of the ledgered story sections (plus tics). Director/events/used_beats are runtime and not rolled back. */
export function snapshotOf(state) {
    const snap = {};
    for (const k of STORY_KEYS) snap[k] = deepClone(state[k]);
    if (snap.threads) delete snap.threads.used_beats;
    snap.tics = deepClone(state.tics);
    return snap;
}

export function restoreSnapshot(state, snap, { restoreTics = true } = {}) {
    const st = normalizeState(deepClone(state));
    const usedBeats = st.threads.used_beats;
    const sn = normalizeState({ ...deepClone(snap), director: st.director, events: st.events, rules_state: st.rules_state });
    for (const k of STORY_KEYS) st[k] = sn[k];
    st.threads.used_beats = usedBeats;
    if (restoreTics && snap.tics) st.tics = sn.tics;
    return st;
}

function pruneLedger(st) {
    if (st.ledger.length > LIMITS.ledger) st.ledger = st.ledger.slice(-LIMITS.ledger);
    const keep = new Set(st.ledger.slice(-LIMITS.snapshots).map(e => e.snapshot_before));
    for (const id of Object.keys(st.snapshots)) if (!keep.has(id)) delete st.snapshots[id];
}

export function findEntry(state, key) {
    const id = entryId(key);
    return (state.ledger || []).find(e => e.id === id) || null;
}

/**
 * Record a ledger entry for a message and apply its ops. Snapshot is taken before the ops.
 * If an entry for the same key exists, ops are appended to it instead (no new snapshot).
 * @returns {{state:object, entry:object, applied:object[], rejected:object[]}}
 */
export function commitEntry(state, key, ops, opts = {}) {
    const base = normalizeState(deepClone(state));
    const id = entryId(key);
    const existing = base.ledger.find(e => e.id === id);
    if (existing) return appendToEntry(base, id, ops, opts);
    const snap = snapshotOf(base);
    const { state: after, applied, rejected } = applyOps(base, ops, opts);
    const entry = {
        id, index: key.index, swipe_id: key.swipe_id, text_hash: key.text_hash,
        turn: Number.isFinite(opts.turn) ? opts.turn : after.turn,
        ops: applied, snapshot_before: id, at: Number.isFinite(opts.now) ? opts.now : 0,
    };
    after.ledger = [...after.ledger.filter(e => e.id !== id), entry].sort((a, b) => a.index - b.index);
    after.snapshots[id] = snap;
    pruneLedger(after);
    return { state: after, entry, applied, rejected };
}

/** Apply more ops to an existing entry (async scribe results). No-op if the entry was invalidated meanwhile. */
export function appendToEntry(state, id, ops, opts = {}) {
    const base = normalizeState(deepClone(state));
    const entry = base.ledger.find(e => e.id === id);
    if (!entry) return { state: base, entry: null, applied: [], rejected: (ops || []).map(op => ({ op, reason: 'ledger entry gone' })) };
    const { state: after, applied, rejected } = applyOps(base, ops, { ...opts, turn: entry.turn });
    const e = after.ledger.find(x => x.id === id);
    e.ops = [...e.ops, ...applied];
    return { state: after, entry: e, applied, rejected };
}

function keyMatches(entry, k) {
    return !!k && !k.is_user && !k.is_system && k.swipe_id === entry.swipe_id && k.text_hash === entry.text_hash;
}

function matchIndex(entry, keys, after, claimed = new Set()) {
    if (entry.index > after && keyMatches(entry, keys[entry.index])) return entry.index;
    // Deletions shift messages down, insertions shift them up: look nearby, nearest first.
    // Never take a position another entry already owns by an exact match (identical replies share a hash).
    for (let d = 1; d <= 8; d++) {
        for (const j of [entry.index - d, entry.index + d]) {
            if (j > after && j >= 0 && j < keys.length && !claimed.has(j) && keyMatches(entry, keys[j])) return j;
        }
    }
    return -1;
}

/**
 * Reconcile the ledger with the current chat. Invalid entries are removed (and cached for swipe-back); the story
 * state is restored from the snapshot before the earliest invalid entry and later valid entries are replayed.
 * @returns {{state:object, changed:boolean, rolledBack:boolean, invalidated:object[]}}
 */
export function reconcile(state, keys, opts = {}) {
    const st = normalizeState(deepClone(state));
    if (!st.ledger.length) return { state: st, changed: false, rolledBack: false, invalidated: [] };
    const matched = [];
    let last = -1;
    let remapped = false;
    // First pass: positions owned by an exact match at the entry's own index.
    const claimed = new Set(st.ledger.filter(e => keyMatches(e, keys[e.index])).map(e => e.index));
    for (const entry of st.ledger) {
        const own = keyMatches(entry, keys[entry.index]);
        const idx = matchIndex(entry, keys, last, own ? new Set() : claimed);
        if (idx === -1) {
            matched.push({ entry, valid: false });
        } else {
            if (idx !== entry.index) remapped = true;
            matched.push({ entry, valid: true, idx });
            last = idx;
        }
    }
    const firstInvalid = matched.findIndex(m => !m.valid);
    const reindex = (m) => {
        const e = { ...m.entry, index: m.idx };
        const oldId = m.entry.id;
        e.id = entryId(e);
        if (oldId !== e.id) {
            if (st.snapshots[oldId]) { st.snapshots[e.id] = st.snapshots[oldId]; delete st.snapshots[oldId]; }
            e.snapshot_before = e.id;
        }
        return e;
    };
    if (firstInvalid === -1) {
        if (remapped) st.ledger = matched.map(reindex);
        return { state: st, changed: remapped, rolledBack: false, invalidated: [] };
    }
    const invalidated = matched.filter(m => !m.valid).map(m => m.entry);
    let baseIdx = firstInvalid;
    while (baseIdx >= 0 && !st.snapshots[matched[baseIdx].entry.snapshot_before]) baseIdx--;
    const cache = (list) => {
        const out = [...invalidated.map(e => ({ index: e.index, swipe_id: e.swipe_id, text_hash: e.text_hash, ops: e.ops, turn: e.turn })), ...list];
        const seen = new Set();
        return out.filter(e => { const k = `${e.swipe_id}:${e.text_hash}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, LIMITS.swipeCache);
    };
    if (baseIdx < 0) {
        // No snapshot reaches back far enough: drop the invalid entries, keep the state as is.
        st.ledger = matched.filter(m => m.valid).map(reindex);
        st.swipe_cache = cache(st.swipe_cache);
        pruneLedger(st);
        return { state: st, changed: true, rolledBack: false, invalidated };
    }
    const anyValidAfter = matched.slice(firstInvalid + 1).some(m => m.valid);
    let cur = restoreSnapshot(st, st.snapshots[matched[baseIdx].entry.snapshot_before], { restoreTics: !anyValidAfter });
    const kept = matched.slice(0, baseIdx).map(reindex);
    cur.ledger = kept;
    cur.snapshots = Object.fromEntries(Object.entries(st.snapshots).filter(([id]) => kept.some(e => e.snapshot_before === id)));
    for (const m of matched.slice(baseIdx)) {
        if (!m.valid) continue;
        const key = { index: m.idx, swipe_id: m.entry.swipe_id, text_hash: m.entry.text_hash };
        const r = commitEntry(cur, key, m.entry.ops, { ...opts, turn: m.entry.turn, trusted: true, source: 'replay', now: m.entry.at });
        cur = r.state;
    }
    cur.swipe_cache = cache(st.swipe_cache);
    cur.director.last_injection = '';
    return { state: cur, changed: true, rolledBack: true, invalidated };
}

/** If a previously invalidated batch matches this key (e.g. swiping back), take it out of the cache. */
export function takeCached(state, key) {
    const st = normalizeState(deepClone(state));
    const idx = st.swipe_cache.findIndex(e => e.swipe_id === key.swipe_id && e.text_hash === key.text_hash);
    if (idx === -1) return { state: st, cached: null };
    const [cached] = st.swipe_cache.splice(idx, 1);
    return { state: st, cached };
}

/**
 * A 'continue' extends a message in place: move its ledger entry to the new text hash (keeping its ops and snapshot)
 * so the original batch is not rolled back. Returns the state unchanged when no entry exists for that index/swipe.
 */
export function rekeyEntry(state, index, swipeId, newHash) {
    const st = normalizeState(deepClone(state));
    const e = st.ledger.find(x => x.index === index && x.swipe_id === swipeId);
    if (!e || e.text_hash === newHash) return st;
    const oldId = e.id;
    e.text_hash = newHash;
    e.id = entryId(e);
    if (st.snapshots[oldId]) { st.snapshots[e.id] = st.snapshots[oldId]; delete st.snapshots[oldId]; }
    e.snapshot_before = e.id;
    return st;
}
