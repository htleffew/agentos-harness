// Undercurrent — the knob registry: one schema for every setting, toggle and prompt template. Pure logic: no DOM,
// no SillyTavern globals. index.js stores values; ui-knobs.js renders them; every engine reads resolved values.
//
// Knob schema:
//   { key, group, label, type: "number"|"int"|"bool"|"select"|"text"|"textarea"|"list"|"json", default,
//     min?, max?, step?, options?: [{value,label}], help?, scope?: "global"|"chat", advanced?: bool,
//     // optional extras: placeholders?: [{name, help}] (prompt templates), template?: bool, ui?: string,
//     //                  keepOnProfile?: bool (profiles never touch it), maxLength?: number, rows?: number,
//     //                  builtin?: (values) => string (UI: text shown when a template knob is empty) }
// Storage:
//   global values  -> extensionSettings.undercurrent.knobs   { key: value } (only what the user changed)
//   chat overrides -> chatMetadata.undercurrent.knob_overrides { key: value }
// resolve(global, overrides) gives a flat { key: value } for every registered knob: validated, coerced and clamped;
// a bad value falls back to the default and nothing ever throws.

export const KNOB_TYPES = ['number', 'int', 'bool', 'select', 'text', 'textarea', 'list', 'json'];
export const KNOB_SCOPES = ['global', 'chat'];
export const PROFILE_FORMAT = 'undercurrent-settings';
export const PROFILE_VERSION = 1;

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @type {Map<string, object>} key -> knob (registration order kept) */
const REGISTRY = new Map();
/** @type {Map<string, {id:string, label:string, description:string, order:number}>} */
const GROUPS = new Map();

// ---------------------------------------------------------------------------------------------------------------------
// Groups

/** Register (or update) group metadata. Unknown groups get a label derived from their id. */
export function registerGroups(list = []) {
    for (const g of Array.isArray(list) ? list : []) {
        if (!isObj(g) || typeof g.id !== 'string' || !g.id) continue;
        const prev = GROUPS.get(g.id);
        GROUPS.set(g.id, {
            id: g.id,
            label: String(g.label || prev?.label || (/[A-Z ]/.test(g.id) ? g.id : titleCase(g.id))),
            description: String(g.description ?? prev?.description ?? ''),
            order: Number.isFinite(g.order) ? g.order : (prev?.order ?? 1000 + GROUPS.size),
        });
    }
}

export function groupMeta(id) {
    return GROUPS.get(id) || { id, label: /[A-Z ]/.test(id) ? id : titleCase(id), description: '', order: 5000 };
}

/** Groups that have at least one registered knob, in display order. */
export function allGroups() {
    const used = [...new Set(allKnobs().map(k => k.group))];
    return used.map(groupMeta).sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

function titleCase(id) {
    return String(id).replace(/[_.-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ---------------------------------------------------------------------------------------------------------------------
// Schema validation & registration

/** Accept friendly shorthands from other engines: options as plain values become [{value, label}]. */
export function normalizeKnobDef(def) {
    if (!isObj(def)) return def;
    const out = { ...def };
    if (Array.isArray(out.options)) out.options = out.options.map(o => (isObj(o) ? o : { value: o, label: String(o) }));
    if (!out.group && typeof out.section === 'string' && out.section) out.group = out.section;
    return out;
}

/** Problems with a knob definition ([] = valid). Never throws. */
export function validateKnobDef(raw) {
    const errors = [];
    if (!isObj(raw)) return ['knob must be an object'];
    const def = normalizeKnobDef(raw);
    if (typeof def.key !== 'string' || !KEY_RE.test(def.key)) errors.push(`bad key ${JSON.stringify(def.key)} (lowercase, dot-separated, [a-z0-9_])`);
    if (!KNOB_TYPES.includes(def.type)) errors.push(`${def.key}: unknown type ${JSON.stringify(def.type)}`);
    if (typeof def.group !== 'string' || !def.group) errors.push(`${def.key}: missing group`);
    if (typeof def.label !== 'string' || !def.label) errors.push(`${def.key}: missing label`);
    if (def.scope !== undefined && !KNOB_SCOPES.includes(def.scope)) errors.push(`${def.key}: scope must be global|chat`);
    if (def.type === 'number' || def.type === 'int') {
        if (def.min !== undefined && !Number.isFinite(def.min)) errors.push(`${def.key}: min must be a number`);
        if (def.max !== undefined && !Number.isFinite(def.max)) errors.push(`${def.key}: max must be a number`);
        if (Number.isFinite(def.min) && Number.isFinite(def.max) && def.min > def.max) errors.push(`${def.key}: min > max`);
    }
    if (def.type === 'select') {
        if (!Array.isArray(def.options) || !def.options.length) errors.push(`${def.key}: select needs options`);
    }
    if (def.options !== undefined) {
        if (!Array.isArray(def.options) || def.options.some(o => !isObj(o) || o.value === undefined)) errors.push(`${def.key}: options must be [{value,label}]`);
    }
    if (!errors.length) {
        const c = coerce(def, def.default);
        if (!c.ok) errors.push(`${def.key}: default is invalid (${c.reason})`);
        else if (!deepEqual(c.value, def.type === 'json' ? def.default : c.value) || c.clamped) errors.push(`${def.key}: default is out of range`);
    }
    return errors;
}

/**
 * Register knob definitions. Invalid ones are skipped and reported; never throws.
 * @param {object[]} list
 * @param {{source?:string, replace?:boolean}} [opts] replace: allow redefining existing keys
 * @returns {{added:string[], rejected:{key:any, errors:string[]}[]}}
 */
export function registerKnobs(list, { source = '', replace = false } = {}) {
    const added = [];
    const rejected = [];
    for (const raw of Array.isArray(list) ? list : []) {
        const def = normalizeKnobDef(raw);
        const errors = validateKnobDef(def);
        if (!errors.length && REGISTRY.has(def.key) && !replace) errors.push(`${def.key}: already registered`);
        if (errors.length) { rejected.push({ key: def?.key, errors }); continue; }
        const knob = Object.freeze({
            scope: 'global',
            advanced: false,
            help: '',
            ...def,
            default: def.type === 'json' ? clone(def.default) : coerce(def, def.default).value,
            source: def.source || source || '',
        });
        REGISTRY.set(knob.key, knob);
        if (!GROUPS.has(knob.group)) registerGroups([{ id: knob.group }]);
        added.push(knob.key);
    }
    return { added, rejected };
}

/** Remove knobs (tests, or an engine that unloads). */
export function unregisterKnobs(keys = []) {
    for (const k of keys) REGISTRY.delete(k);
}

export function allKnobs() {
    return [...REGISTRY.values()];
}

export function getKnob(key) {
    return REGISTRY.get(key) || null;
}

/**
 * Find a knob by exact key, case-insensitively, or by a unique key suffix (e.g. "max_words" -> "inject.max_words").
 * @returns {{knob:object|null, matches:string[]}}
 */
export function findKnob(query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return { knob: null, matches: [] };
    if (REGISTRY.has(q)) return { knob: REGISTRY.get(q), matches: [q] };
    const keys = [...REGISTRY.keys()];
    const dotted = keys.filter(k => k.endsWith(`.${q}`));
    if (dotted.length === 1) return { knob: REGISTRY.get(dotted[0]), matches: dotted };
    const suffix = dotted.length ? dotted : keys.filter(k => k.endsWith(q));
    if (suffix.length === 1) return { knob: REGISTRY.get(suffix[0]), matches: suffix };
    return { knob: null, matches: suffix.length ? suffix : keys.filter(k => k.includes(q)) };
}

export function defaultsOf(knobs = allKnobs()) {
    return Object.fromEntries(knobs.map(k => [k.key, clone(k.default)]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Coercion

const TRUE = new Set(['true', '1', 'on', 'yes', 'y', 'enabled']);
const FALSE = new Set(['false', '0', 'off', 'no', 'n', 'disabled']);

/**
 * Coerce a raw value to a knob's type. Numbers are clamped to min/max (clamped: true), ints rounded.
 * @returns {{ok:boolean, value:any, reason?:string, clamped?:boolean}}
 */
export function coerce(knob, raw) {
    try {
        switch (knob?.type) {
            case 'bool': {
                if (typeof raw === 'boolean') return { ok: true, value: raw };
                if (raw === 1 || raw === 0) return { ok: true, value: raw === 1 };
                const s = String(raw ?? '').trim().toLowerCase();
                if (TRUE.has(s)) return { ok: true, value: true };
                if (FALSE.has(s)) return { ok: true, value: false };
                return { ok: false, value: undefined, reason: 'expected true/false' };
            }
            case 'number':
            case 'int': {
                const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN);
                if (!Number.isFinite(n)) return { ok: false, value: undefined, reason: 'expected a number' };
                let v = knob.type === 'int' ? Math.round(n) : n;
                let clamped = false;
                if (Number.isFinite(knob.min) && v < knob.min) { v = knob.min; clamped = true; }
                if (Number.isFinite(knob.max) && v > knob.max) { v = knob.max; clamped = true; }
                if (knob.type === 'number') v = Math.round(v * 1e6) / 1e6;
                return { ok: true, value: v, clamped };
            }
            case 'select': {
                const opts = (knob.options || []).map(o => o.value);
                const hit = opts.find(o => o === raw) ?? opts.find(o => String(o) === String(raw))
                    ?? opts.find(o => String(o).toLowerCase() === String(raw ?? '').trim().toLowerCase());
                return hit === undefined ? { ok: false, value: undefined, reason: `expected one of ${opts.join('|')}` } : { ok: true, value: hit };
            }
            case 'text':
            case 'textarea': {
                if (raw === null || raw === undefined || typeof raw === 'object') return { ok: false, value: undefined, reason: 'expected text' };
                let s = String(raw);
                if (knob.type === 'text') s = s.replace(/\r?\n/g, ' ');
                if (Number.isFinite(knob.maxLength) && s.length > knob.maxLength) s = s.slice(0, knob.maxLength);
                return { ok: true, value: s };
            }
            case 'list': {
                let arr;
                if (Array.isArray(raw)) arr = raw;
                else if (typeof raw === 'string') {
                    const t = raw.trim();
                    if (t.startsWith('[')) { try { arr = JSON.parse(t); } catch { arr = null; } }
                    if (!Array.isArray(arr)) arr = t ? t.split(t.includes('\n') ? /\r?\n/ : ',') : [];
                } else return { ok: false, value: undefined, reason: 'expected a list' };
                if (knob.itemType === 'number') {
                    const nums = arr.map(x => (typeof x === 'number' ? x : Number(String(x ?? '').trim()))).filter(x => Number.isFinite(x));
                    return { ok: true, value: Number.isFinite(knob.maxItems) ? nums.slice(0, knob.maxItems) : nums };
                }
                let items = arr.filter(x => x !== null && x !== undefined && typeof x !== 'object').map(x => String(x).trim()).filter(Boolean);
                items = items.filter((x, i) => items.indexOf(x) === i);
                if (Array.isArray(knob.options) && knob.options.length) {
                    const allowed = knob.options.map(o => String(o.value));
                    items = items.map(x => allowed.find(a => a.toLowerCase() === x.toLowerCase())).filter(Boolean);
                    items = items.filter((x, i) => items.indexOf(x) === i);
                }
                if (Number.isFinite(knob.maxItems)) items = items.slice(0, knob.maxItems);
                return { ok: true, value: items };
            }
            case 'json': {
                let v = raw;
                if (typeof raw === 'string') {
                    try { v = JSON.parse(raw); } catch (e) { return { ok: false, value: undefined, reason: `invalid JSON: ${e.message}` }; }
                }
                if (v === undefined || typeof v === 'function') return { ok: false, value: undefined, reason: 'expected JSON' };
                const s = JSON.stringify(v);
                if (s === undefined) return { ok: false, value: undefined, reason: 'expected JSON' };
                return { ok: true, value: JSON.parse(s) };
            }
            default:
                return { ok: false, value: undefined, reason: 'unknown knob type' };
        }
    } catch (e) {
        return { ok: false, value: undefined, reason: String(e?.message || e) };
    }
}

/** Coerce or fall back to the knob default. */
export function valueOr(knob, raw) {
    if (raw === undefined) return clone(knob.default);
    const c = coerce(knob, raw);
    return c.ok ? c.value : clone(knob.default);
}

// ---------------------------------------------------------------------------------------------------------------------
// Resolve / diff

/**
 * Flat values for every registered knob: chat override, else global value, else default. Never throws.
 * @param {object} [globalValues] extensionSettings.undercurrent.knobs
 * @param {object} [chatOverrides] chatMetadata.undercurrent.knob_overrides
 * @param {{knobs?:object[]}} [opts]
 */
export function resolve(globalValues = {}, chatOverrides = {}, { knobs = allKnobs() } = {}) {
    const g = isObj(globalValues) ? globalValues : {};
    const o = isObj(chatOverrides) ? chatOverrides : {};
    const out = {};
    for (const k of knobs) {
        if (Object.hasOwn(o, k.key)) {
            const c = coerce(k, o[k.key]);
            if (c.ok) { out[k.key] = c.value; continue; }
        }
        out[k.key] = valueOr(k, Object.hasOwn(g, k.key) ? g[k.key] : undefined);
    }
    return out;
}

/** Where a knob's effective value comes from: 'chat' | 'global' | 'default'. */
export function sourceOf(key, globalValues = {}, chatOverrides = {}) {
    const k = getKnob(key);
    if (!k) return 'default';
    if (isObj(chatOverrides) && Object.hasOwn(chatOverrides, key) && coerce(k, chatOverrides[key]).ok) return 'chat';
    if (isObj(globalValues) && Object.hasOwn(globalValues, key) && coerce(k, globalValues[key]).ok && !deepEqual(valueOr(k, globalValues[key]), k.default)) return 'global';
    return 'default';
}

/** Only the values that differ from their knob's default (unknown keys are kept as they are). */
export function diff(values = {}) {
    const out = {};
    for (const [key, v] of Object.entries(isObj(values) ? values : {})) {
        const k = getKnob(key);
        if (!k) { out[key] = clone(v); continue; }
        const c = coerce(k, v);
        if (c.ok && !deepEqual(c.value, k.default)) out[key] = c.value;
    }
    return out;
}

export function isModified(key, value) {
    const k = getKnob(key);
    return !!k && !deepEqual(valueOr(k, value), k.default);
}

/**
 * Set one value in a storage object (global knobs or chat overrides). A value equal to the default is removed from
 * global storage (it is the default anyway); chat overrides keep it (an override can pin the default).
 * @returns {{ok:boolean, store:object, value?:any, reason?:string, clamped?:boolean}}
 */
export function setValue(store, key, raw, { isOverride = false } = {}) {
    const k = getKnob(key);
    const next = { ...(isObj(store) ? store : {}) };
    if (!k) return { ok: false, store: next, reason: `unknown setting "${key}"` };
    const c = coerce(k, raw);
    if (!c.ok) return { ok: false, store: next, reason: c.reason };
    if (!isOverride && deepEqual(c.value, k.default)) delete next[key];
    else next[key] = c.value;
    return { ok: true, store: next, value: c.value, clamped: !!c.clamped };
}

export function resetKeys(store, keys) {
    const next = { ...(isObj(store) ? store : {}) };
    for (const k of keys) delete next[k];
    return next;
}

// ---------------------------------------------------------------------------------------------------------------------
// Profiles

/** Build a portable profile (only non-default values). */
export function exportProfile(name, values = {}) {
    return { format: PROFILE_FORMAT, version: PROFILE_VERSION, name: String(name || 'Untitled').slice(0, 80), values: diff(values) };
}

/**
 * Parse a profile (object or JSON text). Invalid values are dropped and reported; unknown keys are kept (they may
 * belong to an engine that registers its knobs later) and listed in `unknown`.
 * @returns {{ok:boolean, name:string, values:object, errors:string[], unknown:string[]}}
 */
export function importProfile(json) {
    let data = json;
    if (typeof json === 'string') {
        try { data = JSON.parse(json); } catch (e) { return { ok: false, name: '', values: {}, errors: [`Not JSON: ${e.message}`], unknown: [] }; }
    }
    if (!isObj(data)) return { ok: false, name: '', values: {}, errors: ['A profile must be a JSON object.'], unknown: [] };
    if (data.format !== PROFILE_FORMAT) return { ok: false, name: '', values: {}, errors: [`Not an Undercurrent settings file (format must be "${PROFILE_FORMAT}").`], unknown: [] };
    if (!Number.isFinite(data.version) || data.version > PROFILE_VERSION) return { ok: false, name: '', values: {}, errors: [`Unsupported version ${data.version}.`], unknown: [] };
    if (!isObj(data.values)) return { ok: false, name: '', values: {}, errors: ['"values" must be an object.'], unknown: [] };
    const values = {};
    const errors = [];
    const unknown = [];
    for (const [key, v] of Object.entries(data.values)) {
        const k = getKnob(key);
        if (!k) {
            if (KEY_RE.test(key)) { unknown.push(key); values[key] = clone(v); } else errors.push(`${key}: bad key`);
            continue;
        }
        const c = coerce(k, v);
        if (c.ok) values[key] = c.value;
        else errors.push(`${key}: ${c.reason}`);
    }
    return { ok: true, name: String(data.name || 'Imported').slice(0, 80), values, errors, unknown };
}

/**
 * Apply profile values to the global store: every registered knob not marked keepOnProfile returns to its default,
 * then the profile's values are laid on top. keepOnProfile knobs and unknown keys in the store are kept.
 */
export function applyProfile(store, profileValues = {}) {
    const cur = isObj(store) ? store : {};
    const next = {};
    for (const [key, v] of Object.entries(cur)) {
        const k = getKnob(key);
        if (!k || k.keepOnProfile) next[key] = v;
    }
    for (const [key, v] of Object.entries(isObj(profileValues) ? profileValues : {})) {
        const k = getKnob(key);
        if (k?.keepOnProfile) continue;
        if (!k) { next[key] = clone(v); continue; }
        const c = coerce(k, v);
        if (c.ok && !deepEqual(c.value, k.default)) next[key] = c.value;
    }
    return next;
}

/** True when the store's profile-relevant values equal exactly what the profile would set. */
export function matchesProfile(store, profileValues = {}) {
    const a = applyProfile(store, profileValues);
    const strip = s => Object.fromEntries(Object.entries(diff(s)).filter(([k]) => !getKnob(k)?.keepOnProfile && getKnob(k)));
    return deepEqual(strip(a), strip(store));
}

// ---------------------------------------------------------------------------------------------------------------------
// Search (settings UI)

/** Knobs matching every whitespace-separated term in label, help, key, group label or option labels. */
export function searchKnobs(query, knobs = allKnobs()) {
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return knobs;
    return knobs.filter((k) => {
        const hay = [k.key, k.label, k.help, groupMeta(k.group).label, ...(k.options || []).map(o => `${o.label ?? ''} ${o.value}`)].join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// Legacy (v1.0 flat settings) migration

/** v1.0 flat keys -> knob keys. */
export const LEGACY_MAP = Object.freeze({
    enabled: 'core.enabled',
    paused: 'core.paused',
    mode: 'core.mode',
    cadence: 'core.cadence',
    preReply: 'core.pre_reply',
    drama: 'events.drama',
    intimacy: 'intimacy.enabled',
    ticguard: 'ticguard.enabled',
    profileId: 'hidden.profile_id',
    timeoutSec: 'hidden.timeout_sec',
    maxTokens: 'hidden.max_tokens',
    stallTurns: 'ticguard.stall_turns',
    debug: 'core.debug',
    'events.pulse': 'events.enable_pulse',
    'events.twist': 'events.enable_twist',
    'events.curiosity': 'events.enable_curiosity',
});

/**
 * Move v1.0 flat keys of extensionSettings.undercurrent into `knobs`. Legacy keys present win (they are newer than any
 * knob value, because migration deletes them) and are removed. Mutates and returns the settings object.
 * @returns {{settings:object, migrated:string[]}}
 */
export function migrateLegacy(settings) {
    const s = isObj(settings) ? settings : {};
    if (!isObj(s.knobs)) s.knobs = {};
    const migrated = [];
    for (const [legacy, key] of Object.entries(LEGACY_MAP)) {
        let present = false;
        let v;
        if (legacy.startsWith('events.')) {
            const kind = legacy.slice(7);
            if (isObj(s.events) && Object.hasOwn(s.events, kind)) { present = true; v = s.events[kind]; }
        } else if (Object.hasOwn(s, legacy)) { present = true; v = s[legacy]; }
        if (!present) continue;
        if (v !== undefined) {
            const k = getKnob(key);
            const c = k ? coerce(k, v) : { ok: true, value: v };
            if (c.ok) {
                if (k && deepEqual(c.value, k.default)) delete s.knobs[key];
                else s.knobs[key] = c.value;
                migrated.push(key);
            }
        }
        if (!legacy.startsWith('events.')) delete s[legacy];
    }
    if (isObj(s.events)) delete s.events;
    s.version = Math.max(2, Number(s.version) || 0);
    return { settings: s, migrated };
}

// ---------------------------------------------------------------------------------------------------------------------
// helpers

export function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => deepEqual(a[k], b[k]));
}

function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
