// The on-phone model for judgment calls (memory DESIGN 7.7 and 12.2): Gemma 4 E2B through the LiteRT-LM web runtime.
// Routing is automatic (DECISIONS, the routing row): the 2.0 GB file downloads by itself the first time the phone is on
// Wi-Fi, or, where the app cannot tell the network type, at the first idle moment with a visible progress note.
// Setup, Connections, Background jobs states the size with Download and Delete; after Delete it stays off until
// Download is tapped again. The weights are kept in the WebView Cache API store, and the runtime library loads from
// jsDelivr at a pinned version, kept by the HTTP cache.
// It answers one-word items only (an attempt, a difficulty step, an aside, a changed fact); writing jobs never reach
// it, because the route chains skip the phone for every job that is not a judgment call.
import { registerPhoneModel } from '../routing.js';

export const PHONE_MODEL = Object.freeze({
    id: 'gemma-4-e2b-litert',
    label: 'Gemma 4 E2B',
    size: '2.0 GB',
    bytes: 2.0e9,
    url: 'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm',
});
export const CACHE_NAME = 'roleplay_instructions_phone_model_v1';
// ponytail: the runtime comes from jsDelivr at a pinned version (DECISIONS, MB8 follow-ups) and the WebView's HTTP cache
// keeps it; an offline cold start fails until it has loaded once. Copy it into the Cache API if airplane-mode starts matter.
export const RUNTIME_PATH = 'https://cdn.jsdelivr.net/npm/@litert-lm/core@0.19.0/+esm';
const ITEM_TIMEOUT_MS = 4000;

let runtimeLoader = () => import(RUNTIME_PATH);
let cachesApi = () => globalThis.caches;
let state = { status: 'unknown', progress: 0, error: '' };
let engine = null;
let loading = null;
const listeners = new Set();

function set(patch) {
    state = { ...state, ...patch };
    for (const fn of listeners) { try { fn({ ...state }); } catch { /* a listener must not stop the model */ } }
}

/** Test hooks: the runtime import and the Cache API. */
export function setPhoneRuntime({ loader, caches } = {}) {
    if (loader) runtimeLoader = loader;
    if (caches) cachesApi = () => caches;
    engine = null;
    loading = null;
    state = { status: 'unknown', progress: 0, error: '' };
}

/** Hear status changes: { status: absent, downloading, ready, loaded, error; progress 0 to 1; error }. */
export function onPhoneModel(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

async function cached() {
    const api = cachesApi();
    if (!api) return null;
    const cache = await api.open(CACHE_NAME);
    return cache.match(PHONE_MODEL.url);
}

/** The row Setup, Connections, Background jobs shows: label, size, state and the action it offers. */
export async function phoneModelStatus() {
    if (state.status === 'unknown' || state.status === 'absent' || state.status === 'ready') {
        const hit = await cached().catch(() => null);
        if (state.status !== 'downloading') set({ status: engine ? 'loaded' : hit ? 'ready' : 'absent' });
    }
    const downloaded = ['ready', 'loaded'].includes(state.status);
    return {
        label: `On-phone model for judgment calls: ${PHONE_MODEL.label}, ${PHONE_MODEL.size} download`,
        status: state.status, progress: state.progress, error: state.error,
        action: state.status === 'downloading' ? 'Cancel' : downloaded ? 'Delete' : 'Download',
    };
}

/**
 * Download the weights into the Cache API store. Only a tap on Download calls this. onProgress hears 0 to 1 while
 * the size is known. Resolves true when the file is stored.
 */
export async function downloadPhoneModel({ signal, onProgress, fetchImpl = globalThis.fetch } = {}) {
    const api = cachesApi();
    if (!api) throw new Error('This app has no Cache API, so the model cannot be kept on the phone.');
    const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
    if (estimate?.quota && estimate.quota - (estimate.usage || 0) < PHONE_MODEL.bytes * 1.1) {
        throw new Error(`The phone has less than ${PHONE_MODEL.size} of storage free for this app.`);
    }
    set({ status: 'downloading', progress: 0, error: '' });
    try {
        const response = await fetchImpl(PHONE_MODEL.url, { signal });
        if (!response.ok || !response.body) throw new Error(`The download did not start (HTTP ${response.status}).`);
        const total = Number(response.headers.get('content-length')) || 0;
        let received = 0;
        const counted = response.body.pipeThrough(new TransformStream({
            transform(chunk, controller) {
                received += chunk.byteLength;
                if (total) {
                    set({ progress: received / total });
                    onProgress?.(received / total);
                }
                controller.enqueue(chunk);
            },
        }));
        const cache = await api.open(CACHE_NAME);
        await cache.put(PHONE_MODEL.url, new Response(counted, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(total || received) } }));
        set({ status: 'ready', progress: 1 });
        return true;
    } catch (error) {
        const cache = await api.open(CACHE_NAME).catch(() => null);
        await cache?.delete(PHONE_MODEL.url).catch(() => {});
        set({ status: signal?.aborted ? 'absent' : 'error', progress: 0, error: signal?.aborted ? '' : String(error?.message || error) });
        throw error;
    }
}

/** Delete the weights and release the engine. The automatic download stays off until Download is tapped. */
export async function deletePhoneModel() {
    await unloadPhoneModel();
    await cachesApi()?.delete(CACHE_NAME);
    setDeclined(true);
    registerPhoneModel(null);
    set({ status: 'absent', progress: 0, error: '' });
}

const DECLINED = 'roleplay_instructions_phone_model_off';
const declined = () => { try { return globalThis.localStorage?.getItem(DECLINED) === '1'; } catch { return false; } };
function setDeclined(on) {
    try { on ? globalThis.localStorage?.setItem(DECLINED, '1') : globalThis.localStorage?.removeItem(DECLINED); } catch { /* storage may be blocked */ }
}

/** Download Heather tapped: clears a Delete, fetches the file and offers it to the route chains. */
export async function tapDownloadPhoneModel(options = {}) {
    setDeclined(false);
    await downloadPhoneModel(options);
    return registerPhoneRoute();
}

/**
 * Get the model onto the phone with no user action. Already cached: register it. On Wi-Fi: download now. On another
 * network: wait for the change to Wi-Fi. Where the network type is unknown: download at the first idle moment with a
 * progress note. Never on a metered or data-saver connection, and never after Delete.
 * Returns 'cached', 'downloading', 'waiting', 'declined' or 'unsupported'.
 */
export async function autoDownloadPhoneModel({ connection = globalThis.navigator?.connection, whenIdle = defaultIdle, note = null, fetchImpl } = {}) {
    if (await phoneModelReady()) { await registerPhoneRoute(); return 'cached'; }
    if (declined()) return 'declined';
    if (!cachesApi()) return 'unsupported';
    // No 2.0 GB download for a model this build cannot run.
    try { await runtimeLoader(); } catch { return 'unsupported'; }
    const start = async () => {
        if (state.status === 'downloading') return;
        let shown = -1;
        note?.(`Downloading the on-phone model for judgment calls (${PHONE_MODEL.label}, ${PHONE_MODEL.size}).`);
        try {
            await downloadPhoneModel({ fetchImpl, onProgress: share => {
                const step = Math.floor(share * 10);
                if (step > shown) { shown = step; note?.(`On-phone model: ${step * 10} percent of ${PHONE_MODEL.size}.`); }
            } });
            await registerPhoneRoute();
            note?.('The on-phone model is ready for judgment calls.');
        } catch (error) {
            note?.(`The on-phone model did not download: ${String(error?.message || error)}`);
        }
    };
    const type = connection?.type;
    if (connection?.saveData) return 'waiting';
    if (type === 'wifi' || type === 'ethernet') { start(); return 'downloading'; }
    if (type && type !== 'unknown' && type !== 'other') {
        const onChange = () => {
            if (connection.type === 'wifi' || connection.type === 'ethernet') {
                connection.removeEventListener?.('change', onChange);
                start();
            }
        };
        connection.addEventListener?.('change', onChange);
        return 'waiting';
    }
    whenIdle(start);
    return 'waiting';
}

function defaultIdle(fn) {
    if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(() => fn(), { timeout: 60 * 1000 });
    else setTimeout(fn, 30 * 1000);
}

export async function unloadPhoneModel() {
    const old = engine;
    engine = null;
    loading = null;
    try { await old?.delete?.(); } catch { /* the engine is gone already */ }
}

/** Whether a judgment call can use the phone now: the file is on the phone. Loading happens on first use. */
export async function phoneModelReady() {
    if (engine) return true;
    return !!await cached().catch(() => null);
}

/** Load the engine from the cached file. Never touches the network; returns null when the file is not cached. */
async function load() {
    if (engine) return engine;
    return loading ||= (async () => {
        const hit = await cached();
        if (!hit) { set({ status: 'absent' }); loading = null; return null; }
        let runtime;
        try { runtime = await runtimeLoader(); }
        catch (error) { loading = null; set({ status: 'error', error: 'The LiteRT-LM runtime did not load (no network on first use?).' }); throw error; }
        const blob = await hit.blob();
        const url = globalThis.URL.createObjectURL(blob);
        try {
            engine = await runtime.Engine.create({ model: url, mainExecutorSettings: { maxNumTokens: 2048 } });
        } finally {
            globalThis.URL.revokeObjectURL?.(url);
            loading = null;
        }
        set({ status: 'loaded' });
        return engine;
    })();
}

const firstWord = text => String(text || '').replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '').trim().split(/[\s.,;:!?"')(]+/).filter(Boolean)[0]?.toLowerCase() || '';

/**
 * Ask one item with a fixed set of one-word answers. Returns the matching option, or '' when the answer was none
 * of them. Stops reading at the first word, so an item costs about one decode step after the prompt.
 */
export async function askOneWord(question, options, { system = '', signal, timeoutMs = ITEM_TIMEOUT_MS } = {}) {
    const ready = await load();
    if (!ready) throw new Error('The on-phone model is not downloaded.');
    const allowed = options.map(o => String(o).toLowerCase());
    const preface = [system, `Answer with exactly one of these words and nothing else: ${allowed.join(', ')}.`].filter(Boolean).join('\n');
    const conversation = await ready.createConversation({ preface: { messages: [{ role: 'system', content: preface }] } });
    let text = '';
    let timer;
    const stop = () => { try { conversation.cancel?.(); } catch { /* already finished */ } };
    signal?.addEventListener?.('abort', stop, { once: true });
    try {
        const work = (async () => {
            for await (const chunk of conversation.sendMessageStreaming(String(question))) {
                for (const item of chunk.content || []) if (item.type === 'text' && item.text) text += item.text;
                const visible = text.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '').trimStart();
                if (/^[^\s<]+[\s.,;:!?]/.test(visible) || visible.length > 40) { stop(); break; }
            }
        })();
        await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { stop(); reject(new Error('The on-phone model ran past its time limit.')); }, timeoutMs); })]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', stop);
        try { await conversation.delete?.(); } catch { /* conversation already released */ }
    }
    const word = firstWord(text);
    return allowed.find(option => option === word) || allowed.find(option => word.startsWith(option)) || '';
}

/**
 * The runner the route chains call for a judgment job (routing's phone route). It answers a schema whose every
 * property is an enum or a boolean by asking one one-word item per property, in order.
 */
export async function phoneRunner({ system = '', user = '', schema, signal }) {
    const props = schema?.value?.properties || {};
    const value = {};
    for (const [key, sub] of Object.entries(props)) {
        const options = sub.type === 'boolean' ? ['yes', 'no'] : Array.isArray(sub.enum) ? sub.enum.map(String) : null;
        if (!options) throw Object.assign(new Error('The on-phone model answers one-word items only.'), { kind: 'invalid' });
        const word = await askOneWord(`${user}\n\nItem: ${sub.description || key}`, options, { system, signal });
        if (!word) throw Object.assign(new Error(`The on-phone model gave no allowed answer for ${key}.`), { kind: 'invalid' });
        value[key] = sub.type === 'boolean' ? word === 'yes' : sub.enum.find(o => String(o).toLowerCase() === word);
    }
    return { text: JSON.stringify(value), value, raw: JSON.stringify(value) };
}

/** Offer the phone model to the route chains once the file is on the phone. Call at start and after a download. */
export async function registerPhoneRoute() {
    const ready = await phoneModelReady();
    registerPhoneModel(ready ? phoneRunner : null);
    return ready;
}
