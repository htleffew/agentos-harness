// V1: the desktop voice server (estate/apps/chatterbox-voice, branch ri-v1), reached over Tailscale only.
//
// Reach: RI runs in TauriTavern's WebView, a browser, so the call is either direct (the server answers with CORS
// headers) or through SillyTavern's own CORS proxy (`/proxy/<url>`, when its config enables it). The probe tries the
// direct call first and keeps whichever answers; the answer is saved per device for the session. No model call: the
// voice server renders audio, and RI's text routes are untouched.
import { settings, saveSettings } from '../store.js';
import { noteVoiceHealth, voiceRoute } from '../routing.js';
import { pcm16ToFloat } from './audio.js';

export const PROBE_MS = 4000;
const SPEAK_MS = 180 * 1000;
/** Her King County settings, the server's defaults since ri-v1. RI sends only what she changed. */
export const KING_COUNTY = Object.freeze({ exaggeration: 0.65, cfg_weight: 0.5, temperature: 0.8, steps: 24 });
/**
 * The saved voice settings: { url, key, verify, lift, presets, voices: { [castKey]: { id, name, seconds, at, delivery } } }.
 * delivery is V2's three settings (delivery.js); a voice saved by V1 may hold raw knobs instead, read back by deliveryOf.
 */
export function voiceSettings() {
    const st = settings();
    const config = st.voice && typeof st.voice === 'object' ? st.voice : (st.voice = {});
    config.voices ||= {};
    if (config.verify === undefined) config.verify = true;
    return config;
}

export function saveVoiceSettings(patch = {}) {
    Object.assign(voiceSettings(), patch);
    saveSettings();
}

let reach = { url: '', mode: '' };

/** How this device reaches the server: 'direct', 'proxy', or '' before a probe. */
export const reachMode = () => reach.mode;

function endpoint(route, path, mode = reach.mode) {
    return mode === 'proxy' ? `/proxy/${route.url}${path}` : `${route.url}${path}`;
}

function timeout(ms, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('The desktop voice did not answer in time.')), ms);
    const stop = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', stop, { once: true });
    return { signal: controller.signal, done: () => { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); } };
}

async function call(route, path, { method = 'GET', body, headers = {}, ms = PROBE_MS, signal, mode, fetcher = globalThis.fetch } = {}) {
    const limit = timeout(ms, signal);
    try {
        const response = await fetcher(endpoint(route, path, mode), { method, body, signal: limit.signal,
            headers: { ...(route.key ? { Authorization: `Bearer ${route.key}` } : {}), ...headers } });
        return response;
    } finally { limit.done(); }
}

/**
 * Check the voice server: { ok, mode, status, reason }. status is the server's /status answer, which names its
 * defaults, whether it has the line check, and whether a speed control exists (ri-v1 has none).
 */
export async function probe({ fetcher = globalThis.fetch, signal, ms = PROBE_MS } = {}) {
    const route = voiceRoute();
    if (!route.ok) return { ok: false, mode: '', status: null, reason: route.problem };
    const reasons = [];
    for (const mode of ['direct', 'proxy']) {
        try {
            const status = await call(route, '/status', { mode, ms, signal, fetcher });
            if (!status.ok) { reasons.push(`${mode}: status ${status.status}`); continue; }
            const body = await status.json();
            const keyed = await call(route, '/v1/models', { mode, ms, signal, fetcher });
            if (keyed.status === 401) return { ok: false, mode, status: body, reason: 'The desktop voice refused the key. Copy the key from the .key file beside its server.' };
            if (!keyed.ok) { reasons.push(`${mode}: models ${keyed.status}`); continue; }
            reach = { url: route.url, mode };
            noteVoiceHealth(true);
            return { ok: true, mode, status: body, reason: '' };
        } catch (error) {
            if (signal?.aborted) throw error;
            reasons.push(`${mode}: ${String(error?.message || error).slice(0, 80)}`);
        }
    }
    reach = { url: '', mode: '' };
    noteVoiceHealth(false, 'probe');
    return { ok: false, mode: '', status: null, detail: reasons.join('; '),
        reason: 'The desktop voice is unavailable: the desktop is off, asleep or off the tailnet. Wake it and check Tailscale, then try again.' };
}

/** Reach the server, probing first when this device has not reached it at this address yet. */
export async function ensureReach(options = {}) {
    const route = voiceRoute();
    if (!route.ok) return { ok: false, reason: route.problem };
    if (reach.mode && reach.url === route.url) return { ok: true, mode: reach.mode };
    return probe(options);
}

/** Forget how the server was reached, so the next call probes again (after a failure or a new address). */
export function forgetReach() { reach = { url: '', mode: '' }; }

const header = (response, name) => {
    const value = response.headers.get(`X-Chatterbox-${name}`);
    if (value === null) return '';
    try { return decodeURIComponent(value); } catch { return value; }
};

/**
 * Render one line: { samples, info }. samples are 24 kHz floats; info carries the seed used, the check outcome, what
 * the recogniser heard, the names left for her ear, and how long the line waited for the desktop.
 */
export async function speak({ text, voice = 'default', seed, knobs = {}, verify = false, names = [], eq = true, signal, fetcher = globalThis.fetch } = {}) {
    const route = voiceRoute();
    if (!route.ok) throw Object.assign(new Error(route.problem), { kind: 'setup' });
    const body = { model: 'chatterbox', input: text, voice, response_format: 'pcm', seed, verify, names, ...(eq === false ? { eq: false } : {}) };
    for (const [name, value] of Object.entries(knobs || {})) if (Number.isFinite(value) && value !== KING_COUNTY[name]) body[name] = value;
    const started = Date.now();
    const response = await call(route, '/v1/audio/speech', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, ms: SPEAK_MS, signal, fetcher });
    if (!response.ok) {
        const reason = await response.json().then(data => data.error, () => '').catch(() => '');
        throw Object.assign(new Error(reason || `The desktop voice answered ${response.status}.`), { kind: response.status === 401 ? 'key' : 'server' });
    }
    const samples = pcm16ToFloat(new Uint8Array(await response.arrayBuffer()));
    let settingsUsed = null;
    try { settingsUsed = JSON.parse(response.headers.get('X-Chatterbox-Settings') || 'null'); } catch { settingsUsed = null; }
    return { samples, info: {
        seed: Number(header(response, 'Seed')) || seed, check: header(response, 'Check') || (verify ? 'not reported' : 'off'),
        heard: header(response, 'Heard'), diffs: header(response, 'Diffs'), names: header(response, 'Names'),
        renders: Number(header(response, 'Renders')) || 1, waited: Number(header(response, 'Waited')) || 0,
        waitedFor: header(response, 'Waited-For'), seconds: Number(header(response, 'Seconds')) || samples.length / 24000,
        elapsed: (Date.now() - started) / 1000, settings: settingsUsed,
    } };
}

/** Send a checked reference clip (WAV bytes) as a voice: { voice_id, seconds }. */
export async function addVoice(name, wav, { fetcher = globalThis.fetch, signal } = {}) {
    const route = voiceRoute();
    if (!route.ok) throw new Error(route.problem);
    const form = new FormData();
    form.append('name', name);
    form.append('files', new Blob([wav], { type: 'audio/wav' }), `${name}.wav`);
    const response = await call(route, '/v1/audio/voices', { method: 'POST', body: form, ms: 60000, signal, fetcher });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `The desktop voice answered ${response.status}.`);
    return data;
}

/** Forget a voice on the server. A voice already gone counts as removed. */
export async function removeVoice(id, { fetcher = globalThis.fetch } = {}) {
    const route = voiceRoute();
    if (!route.ok) throw new Error(route.problem);
    const response = await call(route, `/v1/audio/voices/${encodeURIComponent(id)}`, { method: 'DELETE', fetcher });
    if (!response.ok && response.status !== 404) throw new Error(`The desktop voice answered ${response.status}.`);
}
