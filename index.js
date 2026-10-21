// Undercurrent 2: SillyTavern 1.18 / TauriTavern extension entry. Wiring only; logic lives in ./src (pure modules).
// One request per turn: the preset is a skeleton of [[uc_*]] slots filled at CHAT_COMPLETION_PROMPT_READY; story state
// is derived from the chat's <UC> envelopes; optional background jobs run after replies through one queue.

import * as st from './src/st.js';
import { createRuntime } from './src/core/runtime.js';
import { loadContent } from './src/core/content.js';
import { loadFeatures } from './src/core/providers.js';
import { api, bindRuntime } from './src/core/api.js';

const LOG = '[Undercurrent 2]';

/** Folder this extension is served from (e.g. "third-party/<any-name>"), whatever the install folder is called. */
export const EXT_PATH = (() => {
    try {
        const m = new URL(import.meta.url).pathname.match(/\/scripts\/extensions\/(.+)\/index\.js$/);
        return m ? decodeURIComponent(m[1]) : '';
    } catch {
        return '';
    }
})();

const here = rel => new URL(rel, import.meta.url).href;

let runtime = null;

// Generate interceptor (manifest.generate_interceptor). Filter-only: delegates to providers (memory) and never calls a
// model. Defined synchronously so it exists before the first generation even while the rest still loads.
globalThis.undercurrent2Interceptor = async function undercurrent2Interceptor(chat, _contextSize, _abort, type) {
    try {
        runtime?.intercept(chat, type);
    } catch (e) {
        console.warn(LOG, 'interceptor failed', e);
    }
};

async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
}

function wireEvents(rt) {
    const ev = st.eventTypes();
    st.on(ev.CHAT_COMPLETION_PROMPT_READY, data => rt.onPromptReady(data));
    st.on(ev.GENERATION_STARTED, (type, params, dryRun) => rt.onGenerationStarted(type, params, dryRun));
    st.on(ev.GENERATION_ENDED, () => rt.onGenerationEnded());
    st.on(ev.GENERATION_STOPPED, () => rt.onGenerationEnded());
    st.on(ev.MESSAGE_SENT, () => rt.onMessageSent());
    st.on(ev.MESSAGE_RECEIVED, (id, type) => rt.onMessageReceived(id, type));
    st.on(ev.CHAT_CHANGED, () => rt.onChatChanged());
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED', 'MORE_MESSAGES_LOADED']) {
        if (ev[name]) st.on(ev[name], () => rt.onChatMutated(name));
    }
}

function registerCommands(rt) {
    const c = rt.commands;
    st.registerSlashCommand({ name: 'uc', help: 'Open the Undercurrent 2 panel.', callback: () => { c.openUi(); return ''; } });
    st.registerSlashCommand({
        name: 'uc-direct', help: 'One-shot director note for the next reply only (empty clears it).', argDescription: 'note',
        callback: (_named, text) => c.direct(text),
    });
    st.registerSlashCommand({ name: 'uc-state', help: 'Show the derived story state.', callback: () => c.showState() });
    st.registerSlashCommand({ name: 'uc-off', help: 'Pause Undercurrent 2 (static prompt text stays; the turn block is empty).', callback: () => c.setActive(false) });
    st.registerSlashCommand({ name: 'uc-on', help: 'Resume Undercurrent 2.', callback: () => c.setActive(true) });
    st.registerSlashCommand({ name: 'uc-reset-chat', help: 'Clear Undercurrent 2 data for this chat (seed, overrides, memory).', callback: () => c.resetChat() });
}

async function boot() {
    await st.initHost(import.meta.url);
    const contentInfo = await loadContent({
        url: here('./src/content.js'),
        fallback: () => fetchJson(here('./data/content/content.json')),
    });
    if (contentInfo.source !== 'content.js') console.warn(LOG, `content loaded from ${contentInfo.source}`);
    const features = await loadFeatures({ url: here('./src/features/registry.js') });
    if (features.source !== 'registry.js') console.info(LOG, 'no FEATURES registry; running core only', features.error || '');

    runtime = createRuntime({ st: st.facade, content: contentInfo.content, contentSettings: contentInfo.contentSettings, features });
    bindRuntime(runtime);
    wireEvents(runtime);
    registerCommands(runtime);
    runtime.onChatChanged();

    // The UI is optional and owned separately: mount it when present.
    try {
        const ui = await import(here('./src/ui/index.js'));
        if (typeof ui.mount === 'function') await ui.mount(api, { extPath: EXT_PATH, baseUrl: here('./') });
        runtime.setUiModule(ui); // only after a successful mount, so /uc falls back to a toast otherwise
    } catch (e) {
        console.info(LOG, 'UI module not mounted', String(e?.message || e));
    }

    const flush = () => { try { runtime.flush(); } catch { /* ignore */ } };
    try {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
        globalThis.addEventListener?.('pagehide', flush);
    } catch { /* not a browser */ }

    console.info(LOG, `ready (${EXT_PATH || 'unknown path'}; content: ${contentInfo.source}; providers: ${runtime.diagnostics().providers.join(', ') || 'none'})`);
}

boot().catch(e => console.error(LOG, 'failed to start', e));

export { api };
