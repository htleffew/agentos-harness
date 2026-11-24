// The search model and the desktop booster (memory DESIGN 4.2 steps 3 and 4).
//
// The meaning search runs in the extension: `all-MiniLM-L6-v2` (q8, 23 MB, 384 dimensions, decision 6) through
// transformers.js 4.3.2, which ships inside the extension (vendor/transformers/) together with the WebAssembly runtime
// it needs, so no library is fetched at run time. The model files download once from Hugging Face on first use and are
// kept in the page's own database, so a later start loads them from there with no request. The model takes no query
// instruction. A text longer than 256 tokens is cut by the tokenizer, as sentence-transformers does for this model.
//
// The booster is the desktop's own list from `nomic-embed-text` through Ollama. It is optional and late answers are
// skipped; its vectors live in a separate index with their own model id, and lists merge by rank only (index.js).
import { deviceItems } from './device-db.js';
import { approxTokens } from './search.js';

export const SEARCH_MODEL = Object.freeze({
    repo: 'Xenova/all-MiniLM-L6-v2', dtype: 'q8', id: 'all-MiniLM-L6-v2@q8', dim: 384, maxTokens: 256, bytes: 22_434_000,
});
export const BOOSTER_MODEL = Object.freeze({ id: 'nomic-embed-text', dim: 768, queryPrefix: 'search_query: ', passagePrefix: 'search_document: ', limitMs: 400 });
const RETRY_MS = 10 * 60 * 1000;

export const VENDOR_URL = new URL('../../vendor/transformers/', import.meta.url).href;
const LIBRARY_URL = `${VENDOR_URL}transformers.min.js`;

// ---------------------------------------------------------------- the model files, kept in the page's database

/**
 * The cache transformers.js reads model files from and writes them to. It follows the Cache API's match and put, so the
 * library can use it as `env.customCache`, and it works on an http page where the Cache API itself is not offered.
 */
export function modelCache(db = deviceItems({ name: 'roleplay_instructions_search_model' })) {
    return {
        async match(request) {
            const item = await db.get(`file:${request}`);
            if (!item) return undefined;
            return new Response(item.bytes.slice(0), { status: 200, headers: { 'content-type': item.type || 'application/octet-stream', 'content-length': String(item.bytes.byteLength) } });
        },
        async put(request, response, progress) {
            const total = Number(response.headers.get('content-length')) || 0;
            const reader = response.body?.getReader?.();
            let bytes;
            if (reader) {
                const parts = [];
                let loaded = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    parts.push(value); loaded += value.byteLength;
                    progress?.({ progress: total ? 100 * loaded / total : 0, loaded, total });
                }
                bytes = new Uint8Array(loaded);
                let at = 0;
                for (const part of parts) { bytes.set(part, at); at += part.byteLength; }
            } else bytes = new Uint8Array(await response.arrayBuffer());
            await db.put(`file:${request}`, { type: response.headers.get('content-type') || '', bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
        },
        async delete(request) { await db.remove(`file:${request}`); return true; },
        async files() { return db.keys('file:'); },
        async clear() { await db.clear(); },
    };
}

// ---------------------------------------------------------------- the WebAssembly runtime, shipped gzipped

/**
 * The runtime's bytes, read from the extension folder and expanded with the browser's own gunzip. A server that already
 * expanded the file (a transfer encoding) is handled by looking at the first two bytes.
 */
export async function expandRuntime(fetchImpl = globalThis.fetch?.bind(globalThis), url = `${VENDOR_URL}ort-wasm-simd-threaded.wasm.gz`) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`The search runtime did not load (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot expand the search runtime.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------- the search model

/**
 * An embedder: `embed(texts)` gives one normalized Float32Array per text, `count(text)` the tokens the model's own
 * tokenizer makes of it (special tokens included). `loadLibrary` and `device` are for tests and other hosts.
 */
export function createEmbedder({ model = SEARCH_MODEL, loadLibrary = () => import(LIBRARY_URL), cache = null, device = 'wasm', configure = null, now = Date.now, retryMs = RETRY_MS } = {}) {
    let library = null, pipe = null, loading = null, failedAt = 0;
    const listeners = new Set();
    const state = { state: 'idle', progress: 0, error: '', loadedAt: 0, fromCache: null, files: 0 };
    const set = patch => { Object.assign(state, patch); for (const fn of listeners) { try { fn({ ...state }); } catch { /* a listener never stops the model */ } } };
    const files = new Map();
    const downloaded = new Set();
    // The page's cache, watched: a file written to it was downloaded; a file read from it was not.
    const watched = cache && {
        match: request => cache.match(request),
        put: (request, response, progress) => { downloaded.add(request); return cache.put(request, response, info => { progress?.(info); set({ state: 'downloading', progress: Math.round(info.progress || 0) }); }); },
        delete: request => cache.delete?.(request),
    };

    async function open() {
        set({ state: 'loading', progress: 0, error: '' });
        library = await loadLibrary();
        const { env, pipeline } = library;
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        if (cache) {
            env.useBrowserCache = false; env.useFSCache = false;
            env.useCustomCache = true; env.customCache = watched;
        }
        env.useWasmCache = false;
        const wasm = env.backends?.onnx?.wasm;
        if (wasm && device === 'wasm') {
            // the runtime ships gzipped (3.7 MB against 14.3 MB) and is expanded in the page, so it is never fetched from a CDN
            wasm.wasmBinary = await expandRuntime();
            wasm.wasmPaths = { mjs: `${VENDOR_URL}ort-wasm-simd-threaded.mjs`, wasm: `${VENDOR_URL}ort-wasm-simd-threaded.wasm.gz` };
            wasm.numThreads = 1;
            wasm.proxy = false;
        }
        configure?.(env);
        const progress_callback = info => {
            if (info?.file) files.set(info.file, info);
            const total = [...files.values()].reduce((s, f) => s + (f.total || 0), 0), loaded = [...files.values()].reduce((s, f) => s + (f.loaded || 0), 0);
            set({ state: loaded < total ? 'downloading' : 'loading', progress: total ? Math.round(100 * loaded / total) : 0, files: files.size });
        };
        const options = { dtype: model.dtype, progress_callback };
        if (device) options.device = device;
        pipe = await pipeline('feature-extraction', model.repo, options);
        // the model was trained on 256 tokens; the tokenizer's own limit is 512, so the length is set where it reads it from
        if (pipe.tokenizer?._tokenizerConfig) pipe.tokenizer._tokenizerConfig.model_max_length = model.maxTokens;
        set({ state: 'ready', progress: 100, loadedAt: now(), fromCache: downloaded.size === 0 });
    }

    const api = {
        id: model.id,
        dim: model.dim,
        get counterId() { return pipe?.tokenizer ? model.id : 'approx'; },
        status: () => ({ ...state }),
        onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        isReady: () => !!pipe,
        /** Load the model, downloading its files the first time. Returns false when it cannot be loaded right now. */
        async load({ force = false } = {}) {
            if (pipe) return true;
            if (!force && failedAt && now() - failedAt < retryMs) return false;
            loading ||= open().then(() => { failedAt = 0; return true; }).catch(error => {
                failedAt = now(); pipe = null;
                set({ state: 'failed', error: String(error?.message || error) });
                return false;
            }).finally(() => { loading = null; });
            return loading;
        },
        count(text) {
            const tokenizer = pipe?.tokenizer;
            if (!tokenizer) return approxTokens(text);
            const encoded = tokenizer(String(text ?? ''), { padding: false, truncation: false });
            return encoded.input_ids.dims.at(-1);
        },
        async embed(texts) {
            if (!(await api.load())) throw new Error('The search model is not loaded.');
            const out = [];
            for (let i = 0; i < texts.length; i += 16) {
                const batch = texts.slice(i, i + 16).map(text => String(text ?? ''));
                const tensor = await pipe(batch, { pooling: 'mean', normalize: true });
                const dim = tensor.dims.at(-1);
                for (let k = 0; k < batch.length; k++) out.push(Float32Array.from(tensor.data.subarray(k * dim, (k + 1) * dim)));
            }
            return out;
        },
        async dispose() { try { await pipe?.dispose?.(); } catch { /* nothing to free */ } pipe = null; library = null; set({ state: 'idle' }); },
    };
    return api;
}

// ---------------------------------------------------------------- a deterministic embedder for tests and for a build with no model

const fnv = text => { let h = 0x811c9dc5; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
/** Words and word pairs hashed into a fixed number of slots, then normalized. The same text always gives the same vector. */
export function hashEmbedder({ dim = 384, id = `hash-${dim}` } = {}) {
    const vector = text => {
        const v = new Float32Array(dim);
        const words = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        for (const feature of [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)]) { const h = fnv(feature); v[h % dim] += 1; v[(h >>> 8) % dim] += 0.5; }
        let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
        return v.map(x => x / n);
    };
    return {
        id, dim, counterId: 'approx', isReady: () => true, load: async () => true, status: () => ({ state: 'ready', progress: 100 }),
        count: approxTokens, embed: async texts => texts.map(vector), onStatus: () => () => {}, dispose: async () => {},
    };
}

// ---------------------------------------------------------------- the desktop booster

/**
 * The desktop's embedder through Ollama's /api/embed. `query(text)` answers within the limit or gives null; `passages`
 * runs in the background with no short limit. The nomic prefixes follow the model's own instructions.
 */
export function ollamaBooster({ base, model = BOOSTER_MODEL.id, fetchImpl = globalThis.fetch?.bind(globalThis), limitMs = BOOSTER_MODEL.limitMs, passageMs = 60_000 } = {}) {
    const url = `${String(base || '').replace(/\/+$/, '').replace(/\/v1$/, '')}/api/embed`;
    const call = async (input, ms) => {
        if (!base || !fetchImpl) return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input, keep_alive: '1h' }), signal: controller.signal });
            if (!res.ok) return null;
            const json = await res.json();
            return Array.isArray(json.embeddings) ? json.embeddings.map(row => Float32Array.from(row)) : null;
        } catch { return null; } finally { clearTimeout(timer); }
    };
    return {
        id: model,
        dim: BOOSTER_MODEL.dim,
        available: () => !!base,
        async query(text) { return (await call([`${BOOSTER_MODEL.queryPrefix}${text}`], limitMs))?.[0] || null; },
        async passages(texts) {
            const out = [];
            for (let i = 0; i < texts.length; i += 16) {
                const rows = await call(texts.slice(i, i + 16).map(t => `${BOOSTER_MODEL.passagePrefix}${t}`), passageMs);
                if (!rows) return null;
                out.push(...rows);
            }
            return out;
        },
    };
}
