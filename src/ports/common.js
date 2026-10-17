// Undercurrent ports — shared helpers for the native engines that re-implement LoreBary plugin mechanics
// (scene_intimacy, desire_pulse, psyche, reply_shape, critic, drama_cadence). Pure logic: no DOM, no SillyTavern globals.
//
// Every engine exports <ENGINE>_KNOBS (the knobs.js schema) and resolve<Engine>Options(values). The resolver accepts
// flat panel keys ("desire.cadence_turns"), bare option names ("cadence_turns"), a nested object ({desire: {...}}) or
// an already-resolved options object, and never throws: a bad value falls back to the knob default.

import { coerce } from '../knobs.js';
import { isPlainObject, clip, normText, contentTokens, findKeyCI, deepClone, renderTemplate } from '../util.js';

export { renderTemplate };

// ---------------------------------------------------------------------------------------------------------------------
// Knob builders (same shapes as knob-defs.js, so registerKnobs() accepts them unchanged)

export const kb = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'bool', default: def, help, ...x });
export const ki = (key, group, label, def, min, max, help = '', x = {}) => ({ key, group, label, type: 'int', default: def, min, max, step: 1, help, ...x });
export const kn = (key, group, label, def, min, max, step, help = '', x = {}) => ({ key, group, label, type: 'number', default: def, min, max, step, help, ...x });
export const ksel = (key, group, label, def, options, help = '', x = {}) => ({
    key, group, label, type: 'select', default: def, options: options.map(o => (isPlainObject(o) ? o : { value: o, label: String(o) })), help, ...x,
});
export const kt = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'text', default: def, help, ...x });
export const kta = (key, group, label, def, help = '', placeholders = [], x = {}) => ({
    key, group, label, type: 'textarea', default: def, help, rows: 4, ...(placeholders.length ? { placeholders, template: true } : {}), ...x,
});
export const klist = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'list', default: def, help, ...x });
export const kjson = (key, group, label, def, help = '', x = {}) => ({ key, group, label, type: 'json', default: def, help, advanced: true, ...x });

/** Group metadata for the settings panel (registerGroups). Orders sit after the core groups (core uses 10..110). */
export const PORTS_GROUPS = Object.freeze([
    { id: 'Ports', label: 'Ports', order: 71, description: 'Shared switches for the native engines ported from plugin mechanics.' },
    { id: 'Scene intimacy', label: 'Scene intimacy', order: 72, description: 'Descriptive phase, activities, clothing, senses, cliché counters, pacing hints and aftermath carry-over for intimate scenes. Never a gate.' },
    { id: 'Desire pulse', label: 'Desire pulse', order: 74, description: 'Occasional, character-true impulses drawn from intimacy profiles and their evidence. Limits and negative evidence always win.' },
    { id: 'Psyche', label: 'Psyche', order: 76, description: 'Per-character appraisal of recorded events: emotion, decay, lasting memories, insight moments and defenses under stress.' },
    { id: 'Reply shape', label: 'Reply shape', order: 78, description: 'Reply length matched to the player\'s turn, repeat vetoes on openings/endings/beat types, and a spark when replies flatten.' },
    { id: 'Critic', label: 'Critic', order: 82, description: 'Free code-side rule checks every turn, plus an optional hidden critic pass that returns up to 3 corrections.' },
    { id: 'Drama cadence', label: 'Drama cadence', order: 84, description: 'Drama when replies go flat or a beat is overdue, a curiosity queue with payoff windows, and a plot-beat menu.' },
]);

// ---------------------------------------------------------------------------------------------------------------------
// Option resolution

/**
 * Build a resolver for one engine.
 * @param {string} prefix e.g. "desire." (key prefix, with the trailing dot)
 * @param {object[]} knobs the engine's knob list
 * @param {(o:object)=>object} [post] derive/repair after coercion
 */
export function makeResolver(prefix, knobs, post) {
    const root = prefix.replace(/\.$/, '');
    const byName = new Map(knobs.map(k => [k.key.slice(prefix.length), k]));
    return function resolveOptions(values = {}) {
        const src = isPlainObject(values) ? values : {};
        if (src.__resolved === root) return src;
        const flat = {};
        if (isPlainObject(src[root])) Object.assign(flat, src[root]);
        for (const [k, v] of Object.entries(src)) {
            if (k === root) continue;
            const name = k.startsWith(prefix) ? k.slice(prefix.length) : k;
            if (byName.has(name)) flat[name] = v;
        }
        const out = {};
        for (const [name, k] of byName) {
            const raw = flat[name];
            let v;
            if (raw === undefined || raw === null) v = deepClone(k.default);
            else {
                const c = coerce(k, raw);
                v = c.ok ? c.value : deepClone(k.default);
                // Cleared templates fall back to the built-in text (plain text knobs may be blank on purpose).
                if (k.type === 'textarea' && k.template && typeof v === 'string' && !v.trim()) v = k.default;
            }
            out[name] = v;
        }
        const done = typeof post === 'function' ? (post(out) || out) : out;
        Object.defineProperty(done, '__resolved', { value: root, enumerable: false });
        return done;
    };
}

// ---------------------------------------------------------------------------------------------------------------------
// Names & text

/** True when `name` refers to the player ({{user}} macro or the persona name, case-insensitive). */
export function isUserName(name, userName = '') {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return false;
    if (n === '{{user}}') return true;
    return !!userName && n === String(userName).trim().toLowerCase();
}

/** Present non-player characters (recorded presence, else the card character). */
export function presentNpcs(state, { charName = '', userName = '' } = {}) {
    const recorded = (state?.scene?.present || []).filter(Boolean);
    const list = recorded.length ? recorded : (charName ? [charName] : []);
    return [...new Set(list.filter(n => !isUserName(n, userName)))];
}

/** The character record for a name (case-insensitive), or null. */
export function charRecord(state, name) {
    const key = findKeyCI(state?.characters, name);
    return key ? { key, c: state.characters[key] } : null;
}

export function str(v, max = 200) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return clip(v, max);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
}

export function num(v, def = 0) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return Number.isFinite(n) ? n : def;
}

/** Same thing, loosely: normalized equality or strong content-token overlap. */
export function sameThing(a, b, threshold = 0.6) {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    if (na === nb || na.includes(nb) || nb.includes(na)) return true;
    const ta = new Set(contentTokens(a));
    const tb = new Set(contentTokens(b));
    if (!ta.size || !tb.size) return false;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / Math.min(ta.size, tb.size) >= threshold;
}

/** Count matches of a phrase list in text. Entries: plain phrases (word-bounded, case-insensitive) or "/regex/flags". */
const phraseCache = new Map();
export function compilePhrases(list) {
    const key = JSON.stringify(list || []);
    if (phraseCache.has(key)) return phraseCache.get(key);
    const out = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const s = String(raw ?? '').trim();
        if (!s) continue;
        try {
            const m = s.match(/^\/(.+)\/([a-z]*)$/);
            if (m) out.push({ id: s, re: new RegExp(m[1], m[2].includes('g') ? m[2] : `${m[2]}g`) });
            else {
                const body = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
                out.push({ id: s, re: new RegExp(`${/^\w/.test(s) ? '\\b' : ''}${body}${/\w$/.test(s) ? '\\b' : ''}`, 'gi') });
            }
        } catch { /* invalid pattern: skipped */ }
    }
    if (phraseCache.size > 50) phraseCache.clear();
    phraseCache.set(key, out);
    return out;
}

export function phraseHits(text, list) {
    const s = String(text ?? '');
    const hits = [];
    for (const p of compilePhrases(list)) {
        p.re.lastIndex = 0;
        const m = s.match(p.re);
        if (m && m.length) hits.push({ id: p.id, match: clip(m[0], 60), count: m.length });
    }
    return hits;
}

/** Narration only: the reply without "quoted dialogue" and *asterisk thoughts*. */
export function narrationOf(text) {
    return String(text ?? '')
        .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
        .replace(/(^|[^*])\*(?!\*)[^*\n]+?\*(?!\*)/g, '$1 ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function dialogueSpans(text) {
    return String(text ?? '').match(/"[^"\n]+"|“[^”\n]+”/g) || [];
}

export function thoughtSpans(text) {
    const out = [];
    const re = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g;
    let m;
    while ((m = re.exec(String(text ?? '')))) out.push(m[2].trim());
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Exactly-once turn scope (reroll safety): re-running the same turn starts again from the state before that turn.

/**
 * @param {object} rt runtime slice {turn, prev, ...}
 * @param {number} turn
 * @param {()=>object} empty factory for a blank runtime slice
 * @returns {object} a fresh working copy with .turn = turn and .prev = the base it started from
 */
export function beginTurn(rt, turn, empty) {
    const cur = isPlainObject(rt) ? rt : empty();
    const base = cur.turn === turn ? (isPlainObject(cur.prev) ? cur.prev : empty()) : cur;
    const work = { ...empty(), ...deepClone({ ...base, prev: null }) };
    work.prev = deepClone({ ...base, prev: null });
    work.turn = turn;
    return work;
}

// ---------------------------------------------------------------------------------------------------------------------
// Random helpers

/** Weighted pick from [{w, ...}] (w <= 0 never picked). Returns the item or null. */
export function weightedPick(items, rng = Math.random) {
    const list = (items || []).filter(x => x && Number.isFinite(x.w) && x.w > 0);
    if (!list.length) return null;
    const total = list.reduce((s, x) => s + x.w, 0);
    let r = rng() * total;
    for (const x of list) {
        r -= x.w;
        if (r < 0) return x;
    }
    return list[list.length - 1];
}

export function chance(pct, rng = Math.random) {
    const p = Number(pct);
    if (!Number.isFinite(p) || p <= 0) return false;
    if (p >= 100) return true;
    return rng() * 100 < p;
}

/** Cap a list, keeping the newest entries. */
export function capNewest(list, n) {
    const arr = Array.isArray(list) ? list : [];
    return n > 0 ? arr.slice(-n) : [];
}

export function toLines(items) {
    return (items || []).map(x => (typeof x === 'string' ? x : x?.text)).filter(Boolean);
}

export { isPlainObject, clip, normText, contentTokens, findKeyCI, deepClone };
