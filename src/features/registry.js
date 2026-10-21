// Undercurrent 2 · FEATURES → CORE contract (docs/INTERFACES.md).
//
//   providers      — pure provider objects; every method is wrapped so a provider can never throw into CORE
//   featureSchema  — settings entries (tab, section, type, default, label, help, advanced?, scope); `hidden: true`
//                    entries hold data managed through helpers (rule-pack switches, imported packs) and get no control
//   featureDefaults— {key: default} for every feature setting
//   helpers        — pure functions for CORE's api (rule packs, one-shot notes, memory stats, event re-roll, semantic
//                    prefetch, memory interceptor). Helpers that change settings return {key, value} for setSetting.
//
// Provider shape: {id, settingsKeys, turnLines?(ctx), onReply?(ctx), jobs?, interceptor?(ctx, chat), prefetch?(ctx),
// stats?(ctx)}. turnLines → [{slot:'uc_directive'|'uc_cast'|'uc_recall', text, priority, source}]; higher priority = more
// important (keep first under the word budget). onReply → job specs {kind, provider, dedupeKey, meta, buildRequest(),
// parse(text), apply(result, store)}; the same jobs are reachable for manual runs through provider.jobs[kind]
// {build(ctx), parse(text), apply(result, store, spec)}.

import events, { SCHEMA as EVENTS_SCHEMA, DEFAULTS as EVENTS_DEFAULTS, rerollEvents } from './events/index.js';
import chance, { SCHEMA as CHANCE_SCHEMA, DEFAULTS as CHANCE_DEFAULTS, listRulePacks, setRulePackEnabled, importLoreBary, removeRulePack } from './chance/index.js';
import ticguard, { SCHEMA as TIC_SCHEMA, DEFAULTS as TIC_DEFAULTS } from './ticguard/index.js';
import critic, { SCHEMA as CRITIC_SCHEMA, DEFAULTS as CRITIC_DEFAULTS } from './critic/index.js';
import minds, { SCHEMA as MINDS_SCHEMA, DEFAULTS as MINDS_DEFAULTS } from './minds/index.js';
import intimacy, { SCHEMA as INTIMACY_SCHEMA, DEFAULTS as INTIMACY_DEFAULTS } from './intimacy/index.js';
import memory, { SCHEMA as MEMORY_SCHEMA, DEFAULTS as MEMORY_DEFAULTS, memoryStats, prefetch as memoryPrefetch, interceptor as memoryInterceptorRaw } from './memory/index.js';
import showrunner, { SCHEMA as SR_SCHEMA, DEFAULTS as SR_DEFAULTS } from './showrunner/index.js';
import oneshot, { setOneShot, clearOneShot, getOneShot } from './oneshot/index.js';

export const SLOTS = ['uc_directive', 'uc_cast', 'uc_recall'];

/** Last error per provider method (debug panel); never thrown. */
export const lastErrors = {};

function note(id, method, e) {
    lastErrors[`${id}.${method}`] = { message: String(e?.message || e), at: Date.now() };
    try { console.debug?.(`[Undercurrent2] ${id}.${method} failed`, e); } catch { /* no console */ }
}

function cleanLines(id, out) {
    if (!Array.isArray(out)) return [];
    return out.filter(l => l && SLOTS.includes(l.slot) && typeof l.text === 'string' && l.text.trim())
        .map(l => ({ slot: l.slot, text: l.text.replace(/\s*\n\s*/g, ' ').trim(), priority: Number.isFinite(Number(l.priority)) ? Number(l.priority) : 50, source: l.source || id }));
}

function wrapJobs(id, jobs) {
    if (!jobs) return undefined;
    const out = {};
    for (const [kind, j] of Object.entries(jobs)) {
        out[kind] = {
            build(ctx) { try { return j.build(ctx) || null; } catch (e) { note(id, `jobs.${kind}.build`, e); return null; } },
            parse(text, spec) { try { return j.parse(text, spec); } catch (e) { note(id, `jobs.${kind}.parse`, e); return null; } },
            apply(result, store, spec) { try { j.apply(result, store, spec); } catch (e) { note(id, `jobs.${kind}.apply`, e); } },
        };
    }
    return out;
}

function wrapSpec(id, spec) {
    if (!spec || typeof spec !== 'object' || !spec.kind) return null;
    return {
        ...spec,
        provider: spec.provider || id,
        buildRequest() { try { return spec.buildRequest() || null; } catch (e) { note(id, `${spec.kind}.buildRequest`, e); return null; } },
        parse(text) { try { return spec.parse(text); } catch (e) { note(id, `${spec.kind}.parse`, e); return null; } },
        apply(result, store) { try { return spec.apply(result, store); } catch (e) { note(id, `${spec.kind}.apply`, e); return false; } },
    };
}

/** Wrap a provider so no method can throw. */
export function safeProvider(p) {
    const id = p.id;
    const w = { id, settingsKeys: [...(p.settingsKeys || [])] };
    if (p.turnLines) w.turnLines = (ctx) => { try { return cleanLines(id, p.turnLines(ctx)); } catch (e) { note(id, 'turnLines', e); return []; } };
    if (p.onReply) w.onReply = (ctx) => { try { return (p.onReply(ctx) || []).map(s => wrapSpec(id, s)).filter(Boolean); } catch (e) { note(id, 'onReply', e); return []; } };
    if (p.onState) w.onState = (ctx) => { try { p.onState(ctx); } catch (e) { note(id, 'onState', e); } };
    if (p.staticText) w.staticText = (ctx) => { try { return p.staticText(ctx) || {}; } catch (e) { note(id, 'staticText', e); return {}; } };
    if (p.interceptor) w.interceptor = (ctx, chat) => { try { return p.interceptor(ctx, chat) || 0; } catch (e) { note(id, 'interceptor', e); return 0; } };
    if (p.prefetch) w.prefetch = async (ctx) => { try { return await p.prefetch(ctx); } catch (e) { note(id, 'prefetch', e); return false; } };
    if (p.stats) w.stats = (ctx) => { try { return p.stats(ctx); } catch (e) { note(id, 'stats', e); return null; } };
    if (p.jobs) w.jobs = wrapJobs(id, p.jobs);
    return w;
}

// Order matters only for readability of the turn block when priorities tie: corrections first, then direction.
export const providers = [oneshot, critic, ticguard, showrunner, events, chance, minds, intimacy, memory].map(safeProvider);

export const featureSchema = [
    ...EVENTS_SCHEMA, ...CHANCE_SCHEMA, ...SR_SCHEMA, ...TIC_SCHEMA, ...CRITIC_SCHEMA,
    ...MINDS_SCHEMA, ...INTIMACY_SCHEMA, ...MEMORY_SCHEMA,
].map(e => ({ advanced: false, ...e }));

export const featureDefaults = Object.freeze(Object.assign({},
    EVENTS_DEFAULTS, CHANCE_DEFAULTS, TIC_DEFAULTS, CRITIC_DEFAULTS, MINDS_DEFAULTS, INTIMACY_DEFAULTS, MEMORY_DEFAULTS, SR_DEFAULTS,
    Object.fromEntries(featureSchema.map(e => [e.key, e.default])),
));

/** Feature-store ids CORE should create (chat_metadata.undercurrent2.features[<id>]). */
export const featureIds = providers.map(p => p.id);

// ---------------------------------------------------------------------------------------------------------------------
// Helpers for CORE's api (all pure; ctx-taking helpers only read ctx and write ctx.store)

export const helpers = {
    // chance rules — settings in, {key, value} (a setSetting to perform) out
    listRulePacks: settings => { try { return listRulePacks(settings); } catch (e) { note('chance', 'listRulePacks', e); return []; } },
    setRulePackEnabled: (settings, id, on) => setRulePackEnabled(settings, id, on),
    removeRulePack: (settings, id) => removeRulePack(settings, id),
    importLoreBary: (settings, text, opts) => {
        try { return importLoreBary(settings, text, opts); } catch (e) { note('chance', 'importLoreBary', e); return { ok: false, added: 0, warnings: [String(e?.message || e)] }; }
    },
    // one-shot note (/uc-direct) — ctx must carry the oneshot store
    setOneShot: (ctx, note) => setOneShot(ctx, note),
    clearOneShot: ctx => clearOneShot(ctx),
    getOneShot: ctx => getOneShot(ctx),
    // memory — ctx must carry the memory store
    memoryStats: (ctx) => { try { return memoryStats(ctx); } catch (e) { note('memory', 'memoryStats', e); return { enabled: false, working: 0, archived: 0, summarized: 0, pending: 0, tokensSaved: 0, chunks: 0 }; } },
    memoryInterceptor: (ctx, chat) => { try { return memoryInterceptorRaw(ctx, chat); } catch (e) { note('memory', 'interceptor', e); return 0; } },
    memoryPrefetch: async (ctx) => { try { return await memoryPrefetch(ctx); } catch (e) { note('memory', 'prefetch', e); return false; } },
    // events — ctx must carry the events store
    rerollEvents: ctx => { try { return rerollEvents(ctx); } catch (e) { note('events', 'rerollEvents', e); return false; } },
};

export { listRulePacks, setRulePackEnabled, importLoreBary, removeRulePack, setOneShot, clearOneShot, getOneShot, memoryStats, rerollEvents };
export { memoryPrefetch, memoryInterceptorRaw as memoryInterceptor };
export { events, chance, ticguard, critic, minds, intimacy, memory, showrunner, oneshot };
