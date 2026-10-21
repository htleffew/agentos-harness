// Undercurrent 2: layered settings store (BUILD_SPEC §4). Pure: the SillyTavern objects come in as functions.
//
// Storage (extension_settings.undercurrent2):
//   { version, global:{key:value, prompts:{path:text}}, profiles:{[avatarKey]:{...}}, globalMode:{[tab]:bool}, ui:{}, active }
// Effective value of a key whose tab has Global ON  = global ← default.
// Effective value of a key whose tab has Global OFF = profile ← global ← default (the current character's profile).
// Writes go to global (Global ON or no character) or to the current profile (Global OFF). A written value equal to the
// layer below it is deleted instead of stored (diff-against-default), so improved defaults reach users who never edited.

import { clone, debounce, isPlainObject, stableStringify } from '../core/util.js';
import { defaultsOf } from './schema.js';

export const SETTINGS_VERSION = 1;
const RESERVED = new Set(['prompts']);

function same(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
    return stableStringify(a) === stableStringify(b);
}

/** Ensure the persisted root has the expected shape (mutates and returns it). */
export function normalizeRoot(root) {
    const r = isPlainObject(root) ? root : {};
    if (!r.version) r.version = SETTINGS_VERSION;
    if (!isPlainObject(r.global)) r.global = {};
    if (!isPlainObject(r.profiles)) r.profiles = {};
    if (!isPlainObject(r.globalMode)) r.globalMode = {};
    if (!isPlainObject(r.ui)) r.ui = {};
    if (typeof r.active !== 'boolean') r.active = true;
    return r;
}

/**
 * @param {object} o
 * @param {object[]} o.schema
 * @param {() => object} o.getRoot            returns the persisted root object (created by the caller)
 * @param {() => string|null} [o.getProfileKey] current character/group key, or null when no chat is open
 * @param {() => string} [o.getProfileLabel]  display name of the current character/group
 * @param {() => void} [o.save]                persists (e.g. saveSettingsDebounced); called after a 300 ms debounce
 * @param {(info:object) => void} [o.onChange]
 * @param {object} [o.timers]                  {setTimeout, clearTimeout} for tests
 */
export function createSettingsStore({ schema, getRoot, getProfileKey = () => null, getProfileLabel = () => '', save = () => {}, onChange = () => {}, timers = globalThis }) {
    let entries = Array.isArray(schema) ? schema : [];
    let byKey = new Map(entries.map(e => [e.key, e]));
    let defaults = defaultsOf(entries);
    let cache = { sig: null, value: null };
    let version = 0;
    const saveSoon = debounce(() => { try { save(); } catch (e) { console.warn('[Undercurrent 2] settings save failed', e); } }, 300, timers);

    const root = () => normalizeRoot(getRoot());
    const profileKey = () => {
        try { return getProfileKey() || null; } catch { return null; }
    };
    const tabOf = key => byKey.get(key)?.tab || 'advanced';
    const tabKeys = tab => entries.filter(e => e.tab === tab).map(e => e.key);

    /** Tabs default to Global ON, except tabs whose every key is per-story (Story Config is naturally per character). */
    function defaultGlobal(tab) {
        const keys = entries.filter(e => e.tab === tab);
        return !(keys.length && keys.every(e => e.scope === 'story'));
    }
    function getGlobalMode(tab) {
        const m = root().globalMode[tab];
        return typeof m === 'boolean' ? m : defaultGlobal(tab);
    }
    function profileObj(create = false) {
        const k = profileKey();
        if (!k) return null;
        const r = root();
        if (!isPlainObject(r.profiles[k])) {
            if (!create) return null;
            r.profiles[k] = {};
        }
        return r.profiles[k];
    }
    /** Where a write to `tab` lands right now. */
    function targetFor(tab) {
        if (getGlobalMode(tab) || !profileKey()) return { scope: 'global', obj: root().global };
        return { scope: 'profile', obj: profileObj(true) };
    }
    function changed(info) {
        version++;
        cache = { sig: null, value: null };
        saveSoon();
        try { onChange(info); } catch { /* ignore */ }
    }

    function effective() {
        const r = root();
        const pk = profileKey();
        const sig = `${version}|${pk}`;
        if (cache.sig === sig) return cache.value;
        const prof = pk && isPlainObject(r.profiles[pk]) ? r.profiles[pk] : {};
        const out = {};
        const modes = {};
        for (const e of entries) {
            const tab = e.tab;
            if (!(tab in modes)) modes[tab] = getGlobalMode(tab);
            let v = defaults[e.key];
            if (Object.hasOwn(r.global, e.key)) v = r.global[e.key];
            if (!modes[tab] && Object.hasOwn(prof, e.key)) v = prof[e.key];
            out[e.key] = clone(v);
        }
        // Keys written by features without a schema entry still resolve (global only).
        for (const [k, v] of Object.entries(r.global)) if (!(k in out) && !RESERVED.has(k)) out[k] = clone(v);
        Object.freeze(out);
        cache = { sig, value: out };
        return out;
    }

    function set(key, value) {
        const tab = tabOf(key);
        const { scope, obj } = targetFor(tab);
        if (!obj) return false;
        const r = root();
        const lower = scope === 'profile' ? (Object.hasOwn(r.global, key) ? r.global[key] : defaults[key]) : defaults[key];
        if (value === undefined || same(value, lower)) delete obj[key];
        else obj[key] = clone(value);
        changed({ type: 'set', key, scope });
        return true;
    }

    /**
     * Reset a tab to the DEFAULTS in the current scope. In a character scope the profile would otherwise fall back to
     * global, which may hold non-default values (e.g. after Global was on for a while), so a key whose global value
     * differs from the default gets the default pinned in this profile; other characters keep the global value.
     */
    function resetTab(tab) {
        const { scope, obj } = targetFor(tab);
        if (!obj) return;
        const g = root().global;
        for (const k of tabKeys(tab)) {
            if (scope === 'profile' && Object.hasOwn(g, k) && !same(g[k], defaults[k])) obj[k] = clone(defaults[k]);
            else delete obj[k];
        }
        if (tab === 'advanced') delete obj.prompts;
        changed({ type: 'reset', tab, scope });
    }

    function setGlobalMode(tab, on) {
        const r = root();
        const want = !!on;
        if (want && !getGlobalMode(tab)) {
            // Megumin semantics: what this character shows now becomes everyone's value.
            const prof = profileObj(false);
            if (prof) {
                for (const k of tabKeys(tab)) {
                    if (Object.hasOwn(prof, k)) {
                        if (same(prof[k], defaults[k])) delete r.global[k];
                        else r.global[k] = clone(prof[k]);
                        delete prof[k];
                    }
                }
                if (tab === 'advanced' && isPlainObject(prof.prompts)) {
                    r.global.prompts = { ...(r.global.prompts || {}), ...prof.prompts };
                    delete prof.prompts;
                }
            }
        }
        r.globalMode[tab] = want;
        changed({ type: 'globalMode', tab, on: want });
    }

    function getScopeLabel(tab) {
        if (tab && !getGlobalMode(tab) && profileKey()) {
            try { return getProfileLabel() || 'Character'; } catch { return 'Character'; }
        }
        return 'Global';
    }

    // Prompt-text overrides live with the Advanced tab's scope: {path: text}, stored only when different from default.
    function getPromptOverrides() {
        const r = root();
        const g = isPlainObject(r.global.prompts) ? r.global.prompts : {};
        if (getGlobalMode('advanced')) return { ...g };
        const prof = profileObj(false);
        return { ...g, ...(isPlainObject(prof?.prompts) ? prof.prompts : {}) };
    }
    function setPromptText(path, text, defaultText) {
        const { obj } = targetFor('advanced');
        if (!obj) return;
        if (!isPlainObject(obj.prompts)) obj.prompts = {};
        if (text === undefined || text === null || String(text) === String(defaultText ?? '')) delete obj.prompts[path];
        else obj.prompts[path] = String(text);
        if (!Object.keys(obj.prompts).length) delete obj.prompts;
        changed({ type: 'prompt', path });
    }
    function resetPromptText(path) {
        const { obj } = targetFor('advanced');
        if (obj && isPlainObject(obj.prompts)) {
            delete obj.prompts[path];
            if (!Object.keys(obj.prompts).length) delete obj.prompts;
        }
        changed({ type: 'prompt', path });
    }

    return {
        get schema() { return entries; },
        setSchema(next) {
            entries = Array.isArray(next) ? next : [];
            byKey = new Map(entries.map(e => [e.key, e]));
            defaults = defaultsOf(entries);
            changed({ type: 'schema' });
        },
        defaults: () => ({ ...defaults }),
        effective,
        get: key => effective()[key],
        set,
        resetTab,
        getGlobalMode,
        setGlobalMode,
        getScopeLabel,
        tabOf,
        getPromptOverrides,
        setPromptText,
        resetPromptText,
        isActive: () => root().active !== false,
        setActive(on) {
            root().active = !!on;
            changed({ type: 'active', on: !!on });
        },
        ui: () => root().ui,
        touchUi() { saveSoon(); },
        /** Call when the current character changes (invalidates the effective cache). */
        invalidate() { version++; cache = { sig: null, value: null }; },
        flush: () => saveSoon.flush(),
        get version() { return version; },
    };
}
