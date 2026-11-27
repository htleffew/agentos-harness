// Route chains for background jobs (memory DESIGN 9.1 to 9.4). Each job belongs to a tier (Quick, Writer, Cleanup)
// and runs on a chain of routes tried in order: the desktop over Tailscale, the NanoGPT plan, free tiers, paid routes
// within the monthly spend ceiling, then the Main API. A route that fails, times out, refuses or is rate limited
// passes the job on; a route that is down, timed out or rate limited is skipped for 10 minutes. Every attempt leaves
// a receipt that reads "attempt n of chain length".
import { askFull, ctx, isLocalUrl, parseJson, probeCustomUrl, profileDetails } from './st.js';
import { settings, saveSettings } from './store.js';
import { addLog, updateLog } from './log.js';
import { canSpend, catalogCost, recordSpend, releaseSpend, reserveSpend } from './spend.js';

export const PROBE_MS = 4000;
export const DOWN_MS = 10 * 60 * 1000;
export const WARM_MS = 10 * 60 * 1000;
const PROBE_FRESH_MS = 60 * 1000;
const CLOUD_TIMEOUT_MS = 90 * 1000;
const DESKTOP_TIMEOUT_MS = 8000;

/** Reasoning effort per tier on the cloud routes. The desktop always runs with reasoning off. */
export const TIERS = Object.freeze({
    quick: { label: 'Quick', effort: 'none' },
    writer: { label: 'Writer', effort: 'low' },
    cleanup: { label: 'Cleanup', effort: 'high' },
});

/**
 * Routes. cost: local and plan routes cost nothing per call, free routes are free tiers, paid routes count against
 * the ceiling, and the Main API counts as paid when the chat model is on a paid provider.
 * match picks a saved connection profile for the route when none is set by hand.
 */
export const ROUTES = Object.freeze({
    desktop: { label: 'Desktop over Tailscale', cost: 'local', source: 'custom', match: p => p.api === 'custom' && isLocalUrl(p.url) },
    nanogpt: { label: 'NanoGPT plan', cost: 'plan', source: 'nanogpt', match: p => p.api === 'nanogpt' },
    openrouterFree: { label: 'OpenRouter free model', cost: 'free', source: 'openrouter', match: p => p.api === 'openrouter' },
    googleFree: { label: 'Google AI Studio free tier', cost: 'free', source: 'makersuite', match: p => p.api === 'makersuite' },
    openrouter: { label: 'OpenRouter', cost: 'paid', source: 'openrouter', match: p => p.api === 'openrouter' },
    phone: { label: 'On-phone model', cost: 'local', kind: 'phone', judgmentOnly: true },
    main: { label: 'Main API', cost: 'main', kind: 'main' },
    // V1: reading replies aloud. Not a text route and in no chain; voiceRoute() below resolves it.
    voice: { label: 'Desktop voice over Tailscale', cost: 'local', kind: 'voice' },
});

// V1, the voice route. Chatterbox on her desktop, reachable over Tailscale only and never through Funnel or the public
// internet (DECISIONS 2026-11-25; A19 section 2.6). The address is a tailnet address (100.64.0.0/10 or
// fd7a:115c:a1e0::/48), a MagicDNS name on a port Funnel cannot publish, or this machine. Funnel publishes only ports
// 443, 8443 and 10000, so a ts.net name on one of those ports is refused.
export const FUNNEL_PORTS = Object.freeze(['443', '8443', '10000']);
const TAILNET_V4 = ip => ip.length === 4 && ip.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127;

/** Why a voice server address is refused, or '' when it stays on her own devices. */
export function voiceUrlProblem(url) {
    let parsed;
    try { parsed = new URL(String(url || '').trim()); } catch { return 'Enter the desktop voice address, for example http://100.97.15.107:8125.'; }
    if (!/^https?:$/.test(parsed.protocol)) return 'The voice address starts with http:// or https://.';
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    if (/^(localhost|127(?:\.\d+){3}|::1)$/.test(host)) return '';
    if (TAILNET_V4(host.split('.').map(Number))) return '';
    if (/^fd7a:115c:a1e0:/.test(host)) return '';
    if (/\.ts\.net$/.test(host)) {
        return FUNNEL_PORTS.includes(port) ? `Port ${port} of a ts.net name can be published by Tailscale Funnel. Use the desktop's 100.x address and the voice server's own port.` : '';
    }
    return 'Use the desktop\'s Tailscale address (100.x) or its ts.net name, so the voice never leaves your own devices.';
}

/** The voice route on this device: { ok, url, key, problem }. The address and key are saved on the Voices page. */
export function voiceRoute(config = settings().voice) {
    const url = String(config?.url || '').trim().replace(/\/+$/, '');
    const key = String(config?.key || '').trim();
    if (!url) return { ok: false, url: '', key, problem: 'No desktop voice is set up. Add its address on Story, Characters, Voices.' };
    const problem = voiceUrlProblem(url);
    return problem ? { ok: false, url, key, problem } : { ok: true, url, key, problem: '' };
}

/** Record whether the voice server answered, so route health shows the voice route beside the others. */
export function noteVoiceHealth(ok, reason = '', clock = Date.now) {
    const state = healthOf('voice');
    if (ok) { state.lastOk = clock(); state.downUntil = 0; state.reason = ''; }
    else { state.downUntil = clock() + DOWN_MS; state.reason = String(reason || 'down'); }
}

/** Jobs and their tiers. chain names the job whose chain this one shares. judgment: may use the on-phone model. */
export const JOBS = Object.freeze({
    judgment: { label: 'Judgment call', tier: 'quick', judgment: true },
    capture: { label: 'Capture', tier: 'quick' },
    statSheets: { label: 'Stat sheets', tier: 'quick', chain: 'capture' },
    choices: { label: 'Choices', tier: 'quick', chain: 'capture' },
    chapter: { label: 'Chapter close', tier: 'writer' },
    storySoFar: { label: 'Story so far', tier: 'writer', chain: 'chapter' },
    tidy: { label: 'Tidy', tier: 'cleanup' },
    catchUp: { label: 'Catch-up map', tier: 'writer' },
    catchUpNow: { label: 'Catch-up map, run now', tier: 'writer' },
    carryOver: { label: 'Continue in a new chat', tier: 'writer', waiting: true },
    behaviorDrafts: { label: 'Behavior book drafts', tier: 'writer', chain: 'carryOver', waiting: true },
    // B52: free routes only. story-outline.js drops every paid step of this chain before it runs, so it never spends.
    outline: { label: 'Story outline', tier: 'writer', chain: 'chapter', freeOnly: true },
});

const DESKTOP = 'gemma4:12b';
const FLASH = 'deepseek/deepseek-v4.1-flash';
const FLASH_PRICE = { in: 0.0498, out: 0.1992 };
const HAIKU = { route: 'openrouter', model: 'anthropic/claude-haiku-5.5', price: { in: 0.10, out: 0.50 } };
const OPENROUTER_FREE = 'inclusionai/ling-3.2-flash:free';
const GEMMA_FREE = 'gemma-4-31b-it';
const PHONE_MODEL = 'gemma-4-e2b-litert';

/** The chains of DESIGN 9.2, with OpenRouter prices read 2026-11-23 for the spend estimate. */
export const RECOMMENDED_CHAINS = Object.freeze({
    judgment: [{ route: 'desktop', model: DESKTOP, timeoutMs: 1000 }, { route: 'phone', model: PHONE_MODEL, timeoutMs: 6000 }],
    capture: [
        { route: 'desktop', model: DESKTOP, timeoutMs: DESKTOP_TIMEOUT_MS },
        { route: 'nanogpt', model: FLASH, effort: 'none' },
        { route: 'openrouterFree', model: OPENROUTER_FREE },
        { route: 'openrouter', model: FLASH, price: FLASH_PRICE },
        { route: 'main' },
    ],
    chapter: [
        { route: 'desktop', model: DESKTOP, timeoutMs: 60000 },
        { route: 'nanogpt', model: 'z-ai/glm-5.3' },
        { route: 'googleFree', model: GEMMA_FREE },
        HAIKU,
        { route: 'main' },
    ],
    tidy: [
        { route: 'desktop', model: DESKTOP, timeoutMs: 60000 },
        { route: 'nanogpt', model: 'deepseek/deepseek-v4-pro-0813', effort: 'high' },
        { route: 'openrouter', model: 'deepseek/deepseek-v4-pro', price: { in: 0.90, out: 1.50 } },
    ],
    catchUp: [
        { route: 'desktop', model: DESKTOP, timeoutMs: 60000 },
        { route: 'nanogpt', model: FLASH, effort: 'low' },
        { route: 'phone', model: PHONE_MODEL },
    ],
    catchUpNow: [
        { route: 'desktop', model: DESKTOP, timeoutMs: 60000 },
        { route: 'nanogpt', model: FLASH, effort: 'low' },
        { route: 'googleFree', model: GEMMA_FREE },
        { route: 'openrouter', model: FLASH, price: FLASH_PRICE },
    ],
    carryOver: [
        { route: 'desktop', model: DESKTOP, timeoutMs: 60000, warmOnly: true },
        { route: 'nanogpt', model: 'z-ai/glm-5.3' },
        HAIKU,
        { route: 'main' },
    ],
});

// Route health on this device: down until a time, the last good answer and the last good probe.
const health = new Map();
let phoneModel = null;

const healthOf = key => {
    if (!health.has(key)) health.set(key, { downUntil: 0, lastOk: 0, probedAt: 0, reason: '' });
    return health.get(key);
};

/** The on-phone model's runner, set by the build that downloads it. Without one the phone route is skipped. */
export function registerPhoneModel(run) {
    phoneModel = typeof run === 'function' ? run : null;
}

/** Forget route health. Tests and a "Test routes" button start from a clean state. */
export function resetRouteHealth() {
    health.clear();
}

/** Route health for the status line: per route, whether it is down and until when. */
export function routeHealth(now = Date.now()) {
    return Object.fromEntries([...health].map(([key, value]) => [key, { down: value.downUntil > now, downUntil: value.downUntil, reason: value.reason, lastOk: value.lastOk }]));
}

function routingSettings() {
    const st = settings();
    const routing = st.routing && typeof st.routing === 'object' ? st.routing : (st.routing = {});
    routing.version ||= 1;
    routing.routes ||= {};
    routing.chains ||= {};
    return routing;
}

/** Save a route's binding: { profileId } for a saved connection profile, { direct: true } for a saved key with no profile. */
export function setRouteBinding(routeId, binding) {
    if (!ROUTES[routeId]) throw new Error('Unknown route.');
    routingSettings().routes[routeId] = { ...binding };
    saveSettings();
}

/** Save a job's chain, or clear it with null to use the recommended chain. */
export function setJobChain(jobId, chain) {
    if (!JOBS[jobId]) throw new Error('Unknown background job.');
    const chains = routingSettings().chains;
    if (chain === null) delete chains[jobId];
    else chains[jobId] = chain.map(entry => ({ ...entry }));
    saveSettings();
}

/** The chain a job runs on: the saved chain, else the recommended one, following shared chains. */
export function chainFor(jobId) {
    const job = JOBS[jobId];
    if (!job) throw new Error('Unknown background job.');
    const saved = routingSettings().chains;
    const own = Array.isArray(saved[jobId]) ? saved[jobId] : null;
    const shared = job.chain && Array.isArray(saved[job.chain]) ? saved[job.chain] : null;
    const chain = own || shared || RECOMMENDED_CHAINS[jobId] || RECOMMENDED_CHAINS[job.chain] || [{ route: 'main' }];
    return chain.map(entry => ({ ...entry }));
}

/** How the Main API is billed: a local server, a NanoGPT plan, or a paid provider. */
export function mainCostClass() {
    const host = ctx();
    const api = String(host.mainApi || host.main_api || '');
    if (api === 'openai') {
        const cc = host.chatCompletionSettings || {};
        const source = String(cc.chat_completion_source || '');
        if (source === 'nanogpt') return 'plan';
        if (source === 'custom' && isLocalUrl(cc.custom_url)) return 'local';
        return 'paid';
    }
    const type = String(host.textCompletionSettings?.type || '');
    return ['openrouter', 'mancer', 'togetherai', 'infermaticai', 'dreamgen', 'featherless', 'huggingface'].includes(type) ? 'paid' : 'local';
}

/**
 * Where a route sends: { kind: 'profile', profileId, url } for a saved connection profile, { kind: 'direct', source }
 * for a saved key, { kind: 'main' }, { kind: 'phone' }, or null when nothing on this host can carry it.
 * entry.profileId is a per-operation override and always wins.
 */
export function resolveRoute(entry) {
    const def = ROUTES[entry.route];
    if (entry.profileId) {
        const profile = profileDetails().find(p => p.id === String(entry.profileId));
        return profile ? { kind: 'profile', profileId: profile.id, url: profile.url, api: profile.api, name: profile.name } : null;
    }
    if (!def) return null;
    if (def.kind === 'main') return { kind: 'main' };
    if (def.kind === 'phone') return phoneModel ? { kind: 'phone' } : null;
    const found = detectRoutes()[entry.route];
    if (!found) return null;
    return found.kind === 'profile' ? { kind: 'profile', profileId: found.profileId, url: found.url, api: found.api, name: found.name } : { kind: found.kind, source: found.source };
}

/** How a saved profile chosen for one operation is billed, read from its source and address. */
export function profileCostClass(target) {
    if (target?.api === 'custom' && isLocalUrl(target.url)) return 'local';
    return target?.api === 'nanogpt' ? 'plan' : 'paid';
}

// How well a saved profile fits a route, so the best one is picked when several match. The desktop route prefers a
// profile on the tailnet with the resident model, since that one reaches the desktop from the phone at home and away.
const FIT = {
    desktop: p => (/^gemma4/i.test(p.model) ? 4 : 0) + (/^https?:\/\/(100\.|[^/]*\.ts\.net)/i.test(p.url) ? 2 : 0) + (/:11434\b/.test(p.url) ? 1 : 0),
};

/**
 * Find every route this host can carry, with no user action: each saved connection profile classified by its source
 * and address, a binding saved by hand where there is one, and the on-phone model once it is registered.
 * Returns { [routeId]: { kind, profileId?, name?, url?, source?, detected } }.
 */
export function detectRoutes() {
    const profiles = profileDetails();
    const bindings = routingSettings().routes;
    const found = {};
    for (const [id, def] of Object.entries(ROUTES)) {
        if (def.kind === 'main') { found[id] = { kind: 'main', detected: true }; continue; }
        if (def.kind === 'phone') { if (phoneModel) found[id] = { kind: 'phone', detected: true }; continue; }
        if (def.kind === 'voice') continue;
        const bound = bindings[id]?.profileId && profiles.find(p => p.id === String(bindings[id].profileId));
        const fit = FIT[id] || (() => 0);
        const match = bound || profiles.filter(def.match).sort((a, b) => fit(b) - fit(a))[0];
        if (match) found[id] = { kind: 'profile', profileId: match.id, name: match.name, url: match.url, api: match.api, detected: !bound };
        else if (bindings[id]?.direct && def.source && typeof ctx().ChatCompletionService?.processRequest === 'function') found[id] = { kind: 'direct', source: def.source, detected: false };
    }
    return found;
}

// Listeners hear each finished chain: { job, background, ok, route, model, waiting, attempts }. Setup, Connections,
// Spend (B19) reads them for its fallback notices and per-route counts. A listener never stops a chain.
const chainListeners = new Set();

/** Hear every finished chain. Returns a function that stops listening. */
export function onChainResult(fn) {
    chainListeners.add(fn);
    return () => chainListeners.delete(fn);
}

/** Tell the listeners a background job finished. Chains call it; judgment calls (memory/decide.js) call it for theirs. */
export function reportChainResult(result) {
    for (const fn of chainListeners) { try { fn(result); } catch { /* a listener must not stop the job */ } }
}

const routeKey = (entry, target) => target?.profileId ? `${entry.route}:${target.profileId}` : entry.route;

const TYPES = { object: v => v && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: v => typeof v === 'string',
    number: v => typeof v === 'number' && Number.isFinite(v), integer: Number.isInteger, boolean: v => typeof v === 'boolean', null: v => v === null };

/** Check a value against the parts of JSON Schema the extension's schemas use. Returns the first problem, or ''. */
export function schemaProblem(value, schema, path = 'answer') {
    if (!schema || typeof schema !== 'object') return '';
    const types = [].concat(schema.type || []);
    if (types.length && !types.some(type => TYPES[type]?.(value))) return `${path} should be ${types.join(' or ')}`;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path} should be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`;
    if (TYPES.object(value)) {
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return `${path} is missing ${key}`;
        for (const [key, sub] of Object.entries(schema.properties || {})) {
            if (Object.hasOwn(value, key)) {
                const problem = schemaProblem(value[key], sub, `${path}.${key}`);
                if (problem) return problem;
            }
        }
    }
    if (Array.isArray(value) && schema.items) {
        for (const [index, item] of value.entries()) {
            const problem = schemaProblem(item, schema.items, `${path}[${index}]`);
            if (problem) return problem;
        }
    }
    return '';
}

/**
 * Read a schema answer from text: the first JSON value in it, checked against the schema. schema.read, when given, is the
 * schema code checks against; providers get schema.value (capture sends the strict form and reads the plain one, MB3).
 */
export function readSchemaAnswer(text, schema) {
    const value = parseJson(text, { object: schema?.value?.type === 'object' });
    if (value === null) return { value: null, problem: 'The answer held no JSON.' };
    const problem = schemaProblem(value, schema?.read || schema?.value);
    return { value, problem: problem ? `The JSON does not match the schema: ${problem}.` : '' };
}

const schemaInstruction = schema => `Answer with one JSON value and nothing else. It matches this JSON schema:\n${JSON.stringify(schema.value)}`;

/**
 * A schema answer through a route that cannot carry a schema (the Main API): the schema goes in the system prompt,
 * the answer is read with parseJson, and one repair request sends the problem and the first answer back.
 */
export async function askWithSchemaInPrompt(send, { system = '', user = '', schema, tokens, signal }) {
    const withSchema = [system, schemaInstruction(schema)].filter(Boolean).join('\n\n');
    const first = await send({ system: withSchema, user, tokens, signal });
    const firstRead = readSchemaAnswer(first.text, schema);
    if (!firstRead.problem) return { ...first, value: firstRead.value, repaired: false };
    const repairUser = `${user}\n\nYour previous answer:\n${first.text}\n\n${firstRead.problem} Send the corrected JSON only.`;
    const second = await send({ system: withSchema, user: repairUser, tokens, signal });
    const secondRead = readSchemaAnswer(second.text, schema);
    if (secondRead.problem) throw Object.assign(new Error(`${secondRead.problem} The repair request did not fix it.`), { kind: 'invalid', partialText: second.text });
    return { ...second, value: secondRead.value, repaired: true, firstText: first.text };
}

function classify(error, timedOut) {
    if (timedOut) return 'timeout';
    const text = String(error?.message || error || '');
    if (error?.kind) return error.kind;
    if (/\b429\b|rate.?limit|too many requests|quota/i.test(text)) return 'rate-limit';
    if (/safety|blocked|prohibited|refus|content.?filter|policy/i.test(text)) return 'refusal';
    if (/fetch failed|failed to fetch|network|ECONN|ENOTFOUND|unreachable|not ok|\b50[234]\b|status 5\d\d|unavailable/i.test(text)) return 'down';
    return 'error';
}

const BREAKS = new Set(['timeout', 'down', 'rate-limit']);
const OUTCOME_TEXT = { timeout: 'timed out', down: 'did not answer', 'rate-limit': 'was rate limited', refusal: 'refused', invalid: 'returned an answer that could not be used', error: 'failed' };

function timed(promise, ms, controller) {
    let timer;
    const limit = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort(new Error('The route ran past its time limit.'));
            reject(Object.assign(new Error('The route ran past its time limit.'), { timedOut: true }));
        }, ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * Run one job on a chain. Returns { ok, value, text, route, model, attempts, waiting, reason }.
 * value is the parsed schema answer when a schema is given, else the text. waiting is true when no route can take the
 * job now and a paid route was skipped at the spend ceiling, so the job waits for a free or local route.
 * background: a call no tap started; only these count against the ceiling. clock: test hook for time.
 */
export async function runChain(chain, { job = 'capture', system = '', user = '', schema = null, tokens = 800, signal, background = true,
    toolName = 'commit_memory_ops', label = '', probeMs = PROBE_MS, clock = Date.now, onAttempt } = {}) {
    const def = JOBS[job] || { tier: 'quick', label: job };
    const tier = TIERS[def.tier] || TIERS.quick;
    const of = chain.length;
    const attempts = [];
    const entry = addLog({ what: label || `${def.label} (background)`, details: [`Route chain of ${of} for ${def.label}, ${tier.label} tier.`], sent: system ? `${system}\n\n${user}` : user });
    let ceilingSkipped = false;
    const note = attempt => {
        attempts.push(attempt);
        const line = `Attempt ${attempt.n} of ${of}: ${attempt.label}${attempt.model ? ` (${attempt.model})` : ''} ${attempt.outcome === 'completed' ? 'answered' : attempt.outcome === 'skipped' ? `skipped, ${attempt.reason}` : `${OUTCOME_TEXT[attempt.outcome] || 'failed'}: ${attempt.reason}`}${attempt.ms != null ? ` in ${(attempt.ms / 1000).toFixed(1)} s` : ''}${attempt.cost ? `, US$${attempt.cost.toFixed(4)}` : ''}.`;
        attempt.receipt = line;
        updateLog(entry, { details: [line] });
        try { onAttempt?.(attempt); } catch { /* a listener must not stop the chain */ }
    };
    for (const [index, item] of chain.entries()) {
        if (signal?.aborted) break;
        const n = index + 1;
        const route = ROUTES[item.route] || {};
        const base = { n, of, route: item.route, label: route.label || (item.profileId ? 'Saved connection profile' : item.route), model: item.model || '' };
        if (route.judgmentOnly && !def.judgment) { note({ ...base, outcome: 'skipped', reason: 'the on-phone model takes judgment calls only' }); continue; }
        const target = resolveRoute(item);
        if (!target) { note({ ...base, outcome: 'skipped', reason: 'no connection here carries this route' }); continue; }
        const key = routeKey(item, target);
        const state = healthOf(key);
        const now = clock();
        if (state.downUntil > now) { note({ ...base, outcome: 'skipped', reason: `down until ${new Date(state.downUntil).toLocaleTimeString()}` }); continue; }
        if (item.warmOnly && now - state.lastOk > WARM_MS) { note({ ...base, outcome: 'skipped', reason: 'the desktop is cold and someone is waiting' }); continue; }
        const cost = target.kind === 'main' ? mainCostClass() : route.cost || profileCostClass(target);
        const paid = cost === 'paid' && background;
        const estimate = paid ? catalogCost(item.price, Math.ceil((system.length + user.length) / 4), tokens) ?? 0 : 0;
        if (paid && !canSpend(estimate)) { ceilingSkipped = true; note({ ...base, outcome: 'skipped', reason: 'the monthly spend ceiling is reached' }); continue; }
        // A local route is probed before it is used, so a desktop that is off costs at most the probe's limit.
        if (target.kind === 'profile' && isLocalUrl(target.url) && now - state.probedAt > PROBE_FRESH_MS && now - state.lastOk > PROBE_FRESH_MS) {
            const started = clock();
            const up = await probeCustomUrl(target.url, { timeoutMs: probeMs, signal });
            state.probedAt = clock();
            if (!up) {
                state.downUntil = clock() + DOWN_MS;
                state.reason = 'probe';
                note({ ...base, outcome: 'down', reason: `no answer to the ${Math.round(probeMs / 1000)} s probe; skipped for 10 minutes`, ms: clock() - started });
                continue;
            }
        }
        const reservation = paid ? reserveSpend({ route: item.route, estimate }) : null;
        if (paid && !reservation) { ceilingSkipped = true; note({ ...base, outcome: 'skipped', reason: 'the monthly spend ceiling is reached' }); continue; }
        const effort = item.route === 'desktop' || target.kind === 'profile' && isLocalUrl(target.url) ? 'none' : item.effort ?? (target.kind === 'main' || target.kind === 'phone' ? '' : tier.effort);
        const mode = item.mode || (item.caps?.schema === false ? (item.caps?.tools ? 'tool' : 'prompt') : 'schema');
        const controller = new AbortController();
        const stop = () => controller.abort(signal?.reason);
        signal?.addEventListener?.('abort', stop, { once: true });
        const started = clock();
        const send = ({ system: s, user: u, tokens: t }) => {
            if (target.kind === 'phone') return phoneModel({ system: s, user: u, schema, tokens: t, signal: controller.signal });
            if (target.kind === 'main') return askFull({ system: s, user: u, tokens: t, signal: controller.signal });
            return askFull({ system: s, user: u, tokens: t, signal: controller.signal, model: item.model || '', effort,
                ...(target.kind === 'profile' ? { profileId: target.profileId } : { source: target.source }),
                ...(schema && mode !== 'prompt' ? { schema, mode, toolName } : {}) });
        };
        try {
            const work = (async () => {
                if (schema && (target.kind === 'main' || mode === 'prompt')) return askWithSchemaInPrompt(send, { system, user, schema, tokens, signal: controller.signal });
                const res = await send({ system, user, tokens });
                if (/content_filter|safety/i.test(String(res.finish || ''))) throw Object.assign(new Error('The provider withheld the answer.'), { kind: 'refusal' });
                if (!String(res.text || '').trim() && !res.value) throw Object.assign(new Error(res.thinking ? 'The model spent its answer room on thinking.' : 'The answer was empty.'), { kind: 'refusal' });
                if (!schema) return { ...res, value: res.text };
                if (res.value !== undefined && res.value !== null && target.kind === 'phone') return res;
                const read = readSchemaAnswer(res.text, schema);
                if (read.problem) throw Object.assign(new Error(read.problem), { kind: 'invalid', partialText: res.text });
                return { ...res, value: read.value };
            })();
            const res = await timed(work, item.timeoutMs || (item.route === 'desktop' ? DESKTOP_TIMEOUT_MS : CLOUD_TIMEOUT_MS), controller);
            const ms = clock() - started;
            state.lastOk = clock();
            state.downUntil = 0;
            let usd = 0;
            if (paid) {
                const usage = res.usage || {};
                const fromCatalog = catalogCost(item.price, Number(usage.prompt_tokens) || 0, Number(usage.completion_tokens) || 0);
                const reported = Number.isFinite(res.cost) ? res.cost : null;
                usd = reported ?? (res.usage ? fromCatalog : null) ?? estimate;
                const basis = reported !== null ? 'usage' : res.usage && fromCatalog !== null ? 'catalog' : item.price ? 'catalog' : 'unpriced';
                recordSpend({ route: item.route, model: item.model || '', cost: usd, basis, reservation, job,
                    tokens: res.usage ? { in: Number(usage.prompt_tokens) || 0, out: Number(usage.completion_tokens) || 0 } : null });
            }
            note({ ...base, outcome: 'completed', reason: '', ms, cost: usd });
            updateLog(entry, { ok: true, result: `Answered on attempt ${n} of ${of}.`, got: res.raw || res.text || '' });
            reportChainResult({ job, background, ok: true, route: item.route, model: item.model || '', waiting: false, attempts });
            return { ok: true, value: res.value, text: res.text, route: item.route, model: item.model || '', attempts, waiting: false, reason: '' };
        } catch (error) {
            const ms = clock() - started;
            const cancelled = signal?.aborted;
            const outcome = cancelled ? 'cancelled' : classify(error, error?.timedOut);
            if (paid && reservation) {
                if (outcome === 'timeout') recordSpend({ route: item.route, model: item.model || '', cost: estimate, basis: 'reserved', reservation, job });
                else releaseSpend(reservation);
            }
            if (BREAKS.has(outcome)) {
                state.downUntil = clock() + DOWN_MS;
                state.reason = outcome;
            }
            note({ ...base, outcome, reason: String(error?.message || error).slice(0, 300), ms });
            if (cancelled) break;
        } finally {
            signal?.removeEventListener?.('abort', stop);
        }
    }
    const waiting = ceilingSkipped && !signal?.aborted;
    const reason = signal?.aborted ? 'Cancelled.' : waiting ? 'Paused, monthly ceiling reached. The job waits for a free or local route.' : 'No route in the chain answered.';
    updateLog(entry, { ok: false, status: signal?.aborted ? 'Cancelled' : waiting ? 'Waiting' : 'Failed', result: reason });
    reportChainResult({ job, background, ok: false, route: '', model: '', waiting, attempts });
    return { ok: false, value: null, text: '', route: '', model: '', attempts, waiting, reason };
}

/** Run a background job on its own chain. */
export function runJob(jobId, options = {}) {
    return runChain(chainFor(jobId), { ...options, job: jobId });
}
