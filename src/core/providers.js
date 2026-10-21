// Undercurrent 2: FEATURES provider host (BUILD_SPEC §5, docs/INTERFACES.md). Pure apart from the guarded import.
// CORE calls providers; a provider error is logged and skipped, never breaking the turn.

import { clone, isPlainObject } from './util.js';
import { indexOfId, idOf } from '../state/ids.js';

export const TURN_SLOTS = Object.freeze(['uc_cast', 'uc_directive', 'uc_recall']);

/**
 * Load extension/src/features/registry.js when present.
 * @returns {Promise<{providers:object[], featureSchema:object[], featureDefaults:object, source:string}>}
 */
export async function loadFeatures({ url, importer = u => import(u) } = {}) {
    if (url) {
        try {
            const mod = await importer(String(url));
            return {
                providers: Array.isArray(mod?.providers) ? mod.providers.filter(p => p && p.id) : [],
                featureSchema: Array.isArray(mod?.featureSchema) ? mod.featureSchema : [],
                featureDefaults: isPlainObject(mod?.featureDefaults) ? mod.featureDefaults : {},
                helpers: isPlainObject(mod?.helpers) ? mod.helpers : {},
                source: 'registry.js',
            };
        } catch (e) {
            return { providers: [], featureSchema: [], featureDefaults: {}, helpers: {}, source: 'missing', error: String(e?.message || e) };
        }
    }
    return { providers: [], featureSchema: [], featureDefaults: {}, helpers: {}, source: 'none' };
}

/**
 * Per-chat persistent store for one feature, backed by meta.features[id].
 * Writes are refused when the chat changed since the store was made (identity guard) or in dry runs.
 */
export function createFeatureStore({ meta, id, chatId, getChatId = () => chatId, save = () => {}, readOnly = false }) {
    const bucket = () => {
        if (!isPlainObject(meta)) return null;
        if (!isPlainObject(meta.features)) meta.features = {};
        if (!isPlainObject(meta.features[id])) meta.features[id] = {};
        return meta.features[id];
    };
    const peek = () => (isPlainObject(meta?.features?.[id]) ? meta.features[id] : {});
    return {
        get(key) {
            const v = peek()[key];
            return v === undefined ? undefined : clone(v);
        },
        set(key, value) {
            if (readOnly) return false;
            if (getChatId() !== chatId) {
                try { console.warn(`[Undercurrent 2] ${id}: store write refused (chat changed)`); } catch { /* ignore */ }
                return false;
            }
            const b = bucket();
            if (!b) return false;
            if (value === undefined) delete b[key];
            else b[key] = clone(value);
            save();
            return true;
        },
        keys: () => Object.keys(peek()),
        get readOnly() { return readOnly; },
        /**
         * Write per-chat seed data (chat_metadata.undercurrent2.seed) that derived state applies before the fold, e.g.
         * setSeed('char:Name', 'intimacy', {likes:[...], limits:[...]}). Same guards as set().
         */
        setSeed(entity, field, value) {
            if (readOnly || getChatId() !== chatId || !isPlainObject(meta)) return false;
            const name = String(entity ?? '').replace(/^char:/, '').trim();
            if (!name || !field) return false;
            if (!isPlainObject(meta.seed)) meta.seed = {};
            if (!isPlainObject(meta.seed.characters)) meta.seed.characters = {};
            if (!isPlainObject(meta.seed.characters[name])) meta.seed.characters[name] = {};
            if (value === undefined) delete meta.seed.characters[name][field];
            else meta.seed.characters[name][field] = clone(value);
            save();
            return true;
        },
    };
}

/**
 * Built-in fallback for /uc-direct when FEATURES ships no `oneshot` provider. The note lives in the oneshot store as
 * {text, anchor} where anchor = uc_id of the last message when the command ran; it applies to the next reply after the
 * anchor (and to swipes of that reply) and to nothing later.
 */
export const ONESHOT_FALLBACK = Object.freeze({
    id: 'oneshot',
    builtin: true,
    turnLines(ctx) {
        const note = ctx.store.get('note');
        if (!note || !String(note.text ?? '').trim()) return [];
        return isOneshotActive(note, ctx.chat) ? [{ slot: 'uc_directive', text: String(note.text).trim(), priority: 1000 }] : [];
    },
});

/** True while no AI reply exists after the note's anchor message. */
export function isOneshotActive(note, chat) {
    const list = Array.isArray(chat) ? chat : [];
    let from = 0;
    if (note?.anchor) {
        const i = indexOfId(list, note.anchor);
        if (i < 0) return false;
        from = i + 1;
    }
    for (let i = from; i < list.length; i++) {
        const m = list[i];
        if (m && !m.is_user && !m.is_system) return false;
    }
    return true;
}

/** Anchor for a new one-shot note: the uc_id of the last message. */
export function oneshotAnchor(chat) {
    const list = Array.isArray(chat) ? chat : [];
    return list.length ? idOf(list[list.length - 1]) || null : null;
}

export function createProviderHost({ providers = [], log = () => {} } = {}) {
    const list = [...providers];
    if (!list.some(p => p.id === 'oneshot')) list.push(ONESHOT_FALLBACK);
    const errorsShown = new Map();

    function guard(p, what, fn, fallback) {
        try {
            return fn();
        } catch (e) {
            const key = `${p.id}:${what}`;
            const now = Date.now();
            if (!errorsShown.has(key) || now - errorsShown.get(key) > 60000) {
                errorsShown.set(key, now);
                try { console.warn(`[Undercurrent 2] provider ${p.id}.${what} failed`, e); } catch { /* ignore */ }
            }
            log('provider error', p.id, what, String(e?.message || e));
            return fallback;
        }
    }

    return {
        get providers() { return list; },
        has: id => list.some(p => p.id === id && !p.builtin),

        /** Collect turn lines from every provider: {uc_cast:[{text, priority, source}], ...}. */
        turnLines(ctxFor) {
            const out = { uc_cast: [], uc_directive: [], uc_recall: [] };
            for (const p of list) {
                if (typeof p.turnLines !== 'function') continue;
                const lines = guard(p, 'turnLines', () => p.turnLines(ctxFor(p)), []);
                for (const l of Array.isArray(lines) ? lines : []) {
                    if (!l || !TURN_SLOTS.includes(l.slot)) continue;
                    const text = String(l.text ?? '').trim();
                    if (!text) continue;
                    out[l.slot].push({ text, priority: Number.isFinite(Number(l.priority)) ? Number(l.priority) : 0, source: p.id });
                }
            }
            return out;
        },

        /** Static contributions: {[slot or 'uc.<placeholder>']: [text]} (must be deterministic given settings). */
        staticText(ctxFor) {
            const out = {};
            for (const p of list) {
                if (typeof p.staticText !== 'function') continue;
                const r = guard(p, 'staticText', () => p.staticText(ctxFor(p)), null);
                if (!isPlainObject(r)) continue;
                for (const [k, v] of Object.entries(r)) {
                    const t = String(v ?? '').trim();
                    if (!t) continue;
                    (out[k] ||= []).push(t);
                }
            }
            return out;
        },

        /**
         * Job specs from onReply: [{provider, spec}]. spec = 'kind' | {kind, dedupeKey?, meta?} (built from provider.jobs[kind])
         * | a self-contained {kind, provider?, dedupeKey?, buildRequest(), parse(text), apply(result, store)}.
         */
        onReply(ctxFor) {
            const out = [];
            for (const p of list) {
                if (typeof p.onReply !== 'function') continue;
                const specs = guard(p, 'onReply', () => p.onReply(ctxFor(p)), []);
                for (const s of Array.isArray(specs) ? specs : []) {
                    const spec = typeof s === 'string' ? { kind: s } : s;
                    if (spec && spec.kind) out.push({ provider: p, spec });
                }
            }
            return out;
        },

        onState(ctxFor) {
            for (const p of list) if (typeof p.onState === 'function') guard(p, 'onState', () => p.onState(ctxFor(p)), null);
        },

        /** Generate-interceptor filters (memory). Never makes calls. */
        intercept(ctxFor, chat) {
            for (const p of list) if (typeof p.interceptor === 'function') guard(p, 'interceptor', () => p.interceptor(ctxFor(p), chat), null);
        },

        /** Provider object by id. */
        byId: id => list.find(p => p.id === id) || null,

        /** The provider + job definition for a job kind. */
        jobDef(kind) {
            for (const p of list) {
                const def = p.jobs?.[kind];
                if (def && typeof def.build === 'function') return { provider: p, def };
            }
            return null;
        },

        /** Route a UI call (e.g. listRulePacks) to the first provider exposing it as provider.api[name](ctx, ...args). */
        callApi(name, ctxFor, ...args) {
            for (const p of list) {
                const fn = p.api?.[name];
                if (typeof fn === 'function') return { handled: true, value: guard(p, `api.${name}`, () => fn.call(p.api, ctxFor(p), ...args), undefined) };
            }
            return { handled: false, value: undefined };
        },
    };
}
