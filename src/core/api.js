// Undercurrent 2: the CORE → UI contract (docs/INTERFACES.md). index.js binds the runtime; until then (or in UI tests)
// every call returns a safe empty value so the UI can render against it.
//
// Beyond the contract, the UI may use: substitute(text), getDefaultContent(), listPromptPaths(), getPromptText(path),
// setPromptText(path, text), resetPromptText(path), registerOpener(fn), uiState(), saveUiState(),
// listConnectionProfiles(), diagnostics().

let rt = null;
let pendingOpener = null;
const pendingListeners = [];

/** Called once by index.js. */
export function bindRuntime(runtime) {
    rt = runtime || null;
    if (rt && pendingOpener) rt.setOpenHandler(pendingOpener);
    if (rt) for (const [ev, fn] of pendingListeners.splice(0)) rt.on(ev, fn);
}

const call = (name, fallback, ...args) => {
    if (!rt || typeof rt[name] !== 'function') return typeof fallback === 'function' ? fallback() : fallback;
    try {
        return rt[name](...args);
    } catch (e) {
        try { console.warn(`[Undercurrent 2] api.${name} failed`, e); } catch { /* ignore */ }
        return typeof fallback === 'function' ? fallback() : fallback;
    }
};

export const api = {
    // settings
    /** Every entry, including `hidden: true` data keys (e.g. chance.packs): renderers must skip hidden entries. */
    getSchema: () => call('getSchema', []),
    getContent: () => call('getContent', {}),
    getSettings: () => call('getSettings', {}),
    setSetting: (key, value) => call('setSetting', false, key, value),
    /** Extra: drop one key's value in the current scope (falls back to the layer below). */
    resetSetting: key => call('resetSetting', false, key),
    resetTab: tab => call('resetTab', undefined, tab),
    getGlobalMode: tab => call('getGlobalMode', true, tab),
    setGlobalMode: (tab, on) => call('setGlobalMode', undefined, tab, on),
    getScopeLabel: tab => call('getScopeLabel', 'Global', tab),
    // story state + overrides
    getState: () => call('getState', null),
    setOverride: (entity, field, value) => call('setOverride', false, entity, field, value),
    clearOverride: (entity, field) => call('clearOverride', false, entity, field),
    /** Extra: the raw overrides map {entity: {field: value}}. */
    getOverrides: () => call('getOverrides', {}),
    // prompt
    estimateTokens: () => call('estimateTokens', { static: 0, turn: 0, total: 0 }),
    previewPayload: () => call('previewPayload', () => Promise.resolve({ messages: [] })),
    // memory / jobs
    memoryStats: () => call('memoryStats', { working: 0, archived: 0, summarized: 0, tokensSaved: 0 }),
    /** meta (optional) is passed to the job spec; when omitted CORE asks the owning provider (see runtime.runJob). */
    runJob: (kind, meta) => call('runJob', { ok: false }, kind, meta),
    jobStatus: () => call('jobStatus', { running: null, queued: 0, lastError: null }),
    // chance rules (FEATURES data, routed by CORE)
    listRulePacks: () => call('listRulePacks', []),
    setRulePackEnabled: (id, on) => call('setRulePackEnabled', false, id, on),
    /** Extra: remove an imported pack (built-ins can only be switched off). */
    removeRulePack: id => call('removeRulePack', false, id),
    importLoreBary: text => call('importLoreBary', { ok: false, added: 0, warnings: ['Not available.'] }, text),
    // events: 'settings' | 'state' | 'jobs' | 'chat'
    on(event, fn) {
        if (rt) return rt.on(event, fn);
        pendingListeners.push([event, fn]);
        return undefined;
    },
    off(event, fn) {
        const i = pendingListeners.findIndex(([e, f]) => e === event && f === fn);
        if (i >= 0) pendingListeners.splice(i, 1);
        if (rt) rt.off(event, fn);
    },
    // misc
    getCharacter: () => call('getCharacter', null),
    /** Expand ST macros ({{char}}, {{user}}) in labels/help text for display. */
    substitute: text => call('substitute', String(text ?? ''), text),
    isActive: () => call('isActive', true),
    setActive: on => call('setActive', undefined, on),

    // extras (prompt editor, launcher, dev)
    getDefaultContent: () => call('getDefaultContent', {}),
    listPromptPaths: () => call('listPromptPaths', []),
    getPromptText: path => call('getPromptText', { value: '', default: '', overridden: false }, path),
    setPromptText: (path, text) => call('setPromptText', undefined, path, text),
    resetPromptText: path => call('resetPromptText', undefined, path),
    /** The UI registers how to open itself; /uc and the extensions-menu entry call it. */
    registerOpener(fn) {
        pendingOpener = typeof fn === 'function' ? fn : null;
        if (rt) rt.setOpenHandler(pendingOpener);
    },
    open: () => call('openUi', undefined),
    /** extension_settings.undercurrent2.ui (launcher position etc.); mutate it, then call saveUiState(). */
    uiState: () => call('uiState', {}),
    saveUiState: () => call('saveUiState', undefined),
    listConnectionProfiles: () => call('listConnectionProfiles', []),
    diagnostics: () => call('diagnostics', {}),
};

export default api;
