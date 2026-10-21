// Undercurrent 2: the ONLY module that touches SillyTavern. Everything goes through SillyTavern.getContext()
// (public/scripts/st-context.js, ST 1.18.0) plus one guarded dynamic import of /script.js for the live `is_send_press`
// flag. No static imports from SillyTavern, so the extension works from any install folder. Every call is wrapped so a
// host difference degrades a feature instead of breaking the turn.

const LOG = '[Undercurrent 2]';
const SETTINGS_KEY = 'undercurrent2';

/** Requests made by our own job queue (generateRaw passes our array object straight to CHAT_COMPLETION_PROMPT_READY). */
const OWN_REQUESTS = new WeakSet();

let scriptModule = null;

export function ctx() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

/** Load the host's script.js module (same URL as index.html's <script type="module" src="script.js">). */
export async function initHost(importMetaUrl) {
    try {
        const href = String(importMetaUrl || '');
        const i = href.indexOf('/scripts/extensions/');
        if (i < 0) return false;
        scriptModule = await import(`${href.slice(0, i)}/script.js`);
        return true;
    } catch (e) {
        console.debug(LOG, 'script.js module not reachable; generation state comes from events only', e);
        return false;
    }
}

export function eventTypes() {
    const c = ctx();
    return c?.eventTypes || c?.event_types || {};
}

export function on(eventName, fn) {
    const c = ctx();
    if (!eventName || !c?.eventSource) return false;
    try {
        c.eventSource.on(eventName, fn);
        return true;
    } catch (e) {
        console.warn(LOG, 'could not listen to', eventName, e);
        return false;
    }
}

export function getChat() {
    const c = ctx();
    return Array.isArray(c?.chat) ? c.chat : [];
}

export function getChatId() {
    const c = ctx();
    try { return c?.getCurrentChatId?.() ?? c?.chatId ?? null; } catch { return null; }
}

export function getChatMetadata() {
    const c = ctx();
    return c?.chatMetadata && typeof c.chatMetadata === 'object' ? c.chatMetadata : {};
}

export function saveMetadata() {
    try { ctx()?.saveMetadataDebounced?.(); } catch (e) { console.warn(LOG, 'saveMetadataDebounced failed', e); }
}

export function saveChat() {
    try { return ctx()?.saveChat?.(); } catch (e) { console.warn(LOG, 'saveChat failed', e); return undefined; }
}

/** extension_settings.undercurrent2 (created on first use). */
export function getSettingsRoot() {
    const c = ctx();
    const all = c?.extensionSettings;
    if (!all || typeof all !== 'object') return {};
    if (!all[SETTINGS_KEY] || typeof all[SETTINGS_KEY] !== 'object' || Array.isArray(all[SETTINGS_KEY])) all[SETTINGS_KEY] = {};
    return all[SETTINGS_KEY];
}

export function saveSettings() {
    try { ctx()?.saveSettingsDebounced?.(); } catch (e) { console.warn(LOG, 'saveSettingsDebounced failed', e); }
}

export function substituteParams(text) {
    const c = ctx();
    try { return c?.substituteParams ? c.substituteParams(String(text ?? '')) : String(text ?? ''); } catch { return String(text ?? ''); }
}

function cardFields() {
    try { return ctx()?.getCharacterCardFields?.() || {}; } catch { return {}; }
}

function currentCharacter() {
    const c = ctx();
    if (!c) return null;
    const id = c.characterId;
    if (id === undefined || id === null || id === '') return null;
    return c.characters?.[id] || null;
}

function currentGroup() {
    const c = ctx();
    if (!c?.groupId) return null;
    return (c.groups || []).find(g => String(g.id) === String(c.groupId)) || null;
}

/** {name, description, personality, scenario} of the current card ({{char}}). */
export function getCard() {
    const c = ctx();
    const f = cardFields();
    return {
        name: String(c?.name2 ?? currentCharacter()?.name ?? ''),
        description: String(f.description ?? ''),
        personality: String(f.personality ?? ''),
        scenario: String(f.scenario ?? ''),
    };
}

/** The player's persona: {name ({{user}}), description}. */
export function getPersona() {
    const c = ctx();
    const f = cardFields();
    return { name: String(c?.name1 ?? ''), description: String(f.persona ?? '') };
}

/** Settings profile key: the character's avatar file, or group:<id>; null without a chat. */
export function getProfileKey() {
    const g = currentGroup();
    if (g) return `group:${g.id}`;
    const ch = currentCharacter();
    return ch?.avatar ? String(ch.avatar) : null;
}

/** {name, avatarUrl} for the hero banner, or null. */
export function getCharacter() {
    const c = ctx();
    const g = currentGroup();
    if (g) {
        const first = (g.members || [])[0];
        let avatarUrl = '';
        try { if (first) avatarUrl = c.getThumbnailUrl('avatar', first); } catch { avatarUrl = ''; }
        return { name: String(g.name || ''), avatarUrl, group: true };
    }
    const ch = currentCharacter();
    if (!ch) return null;
    let avatarUrl = '';
    try { avatarUrl = ch.avatar ? c.getThumbnailUrl('avatar', ch.avatar) : ''; } catch { avatarUrl = ''; }
    return { name: String(ch.name || c.name2 || ''), avatarUrl, group: false };
}

/** The connected model id (Chat Completion), or the online status string for other APIs. */
export function getModelId() {
    const c = ctx();
    try {
        if (c?.mainApi === 'openai') return String(c.getChatCompletionModel?.() || '');
        return String(c?.onlineStatus || '');
    } catch {
        return '';
    }
}

/** True while SillyTavern is generating (send pressed, or a stream still running). */
export function isGenerating() {
    try {
        if (scriptModule && scriptModule.is_send_press === true) return true;
    } catch { /* ignore */ }
    try {
        const sp = ctx()?.streamingProcessor;
        if (sp && sp.isFinished === false && sp.isStopped !== true) return true;
    } catch { /* ignore */ }
    return false;
}

export function isOwnRequest(messages) {
    return !!messages && typeof messages === 'object' && OWN_REQUESTS.has(messages);
}

export function listConnectionProfiles() {
    try {
        const svc = ctx()?.ConnectionManagerRequestService;
        return svc ? svc.getSupportedProfiles().map(p => ({ id: p.id, name: p.name || p.id })) : [];
    } catch {
        return [];
    }
}

function stripThinking(text) {
    return String(text ?? '').replace(/^\s*<\s*(think|thinking)\s*>[\s\S]*?<\s*\/\s*\1\s*>\s*/i, '').trim();
}

/**
 * Send one background request. With a Connection Manager profile: ConnectionManagerRequestService.sendRequest
 * (public/scripts/extensions/shared.js:419). Otherwise generateRaw (public/script.js:4063) on the current connection;
 * generateRaw cannot take an AbortSignal in 1.18, so a cancelled job's late answer is simply discarded by the queue.
 * @param {{systemPrompt:string, prompt:string|{role,content}[], responseLength:number, profileId?:string}} req
 */
export async function sendJobRequest(req, signal) {
    const c = ctx();
    if (!c) throw new Error('SillyTavern is not available');
    const raw = Array.isArray(req.prompt) ? req.prompt : [{ role: 'user', content: String(req.prompt ?? '') }];
    const messages = raw.map(m => ({ role: m.role || 'user', content: String(m.content ?? '') }));
    const sys = String(req.systemPrompt ?? '');
    const tokens = Math.max(16, Number(req.responseLength) || 400);
    const profileId = String(req.profileId || '');
    if (profileId && listConnectionProfiles().some(p => p.id === profileId)) {
        const sub = t => substituteParams(t);
        const msgs = [...(sys ? [{ role: 'system', content: sub(sys) }] : []), ...messages.map(m => ({ role: m.role, content: sub(m.content) }))];
        const r = await c.ConnectionManagerRequestService.sendRequest(profileId, msgs, tokens, { stream: false, signal, extractData: true, includePreset: true, includeInstruct: true });
        return stripThinking(typeof r === 'string' ? r : (r?.content ?? ''));
    }
    OWN_REQUESTS.add(messages);
    const text = await c.generateRaw({ prompt: messages, systemPrompt: sys, responseLength: tokens, trimNames: false });
    return stripThinking(text);
}

/**
 * Assemble the prompt without sending it (the prompt manager's own path: Generate('normal', {}, true),
 * public/scripts/openai.js:700). Returns false when no dry run is possible here.
 */
export async function dryRunGenerate() {
    const c = ctx();
    if (!c || c.mainApi !== 'openai') return false;
    const hasChar = c.characterId !== undefined && c.characterId !== null && c.characterId !== '';
    if (!hasChar && !c.groupId) return false;
    if (isGenerating()) return false;
    await c.generate('normal', {}, true);
    return true;
}

export function toast(kind, message, title = 'Undercurrent 2') {
    try {
        const t = globalThis.toastr;
        const fn = t?.[kind] || t?.info;
        if (fn) fn.call(t, String(message), title);
        else console.log(LOG, message);
    } catch {
        console.log(LOG, message);
    }
}

export async function popup(html) {
    const c = ctx();
    try {
        if (c?.callGenericPopup) return await c.callGenericPopup(html, c.POPUP_TYPE?.TEXT ?? 1, '', { wide: true, large: true, allowVerticalScrolling: true });
    } catch (e) {
        console.warn(LOG, 'popup failed', e);
    }
    return undefined;
}

export async function confirm(text) {
    const c = ctx();
    try {
        if (c?.callGenericPopup) {
            const r = await c.callGenericPopup(String(text), c.POPUP_TYPE?.CONFIRM ?? 2);
            return r === (c.POPUP_RESULT?.AFFIRMATIVE ?? 1) || r === true;
        }
    } catch (e) {
        console.warn(LOG, 'confirm failed', e);
    }
    return globalThis.confirm ? globalThis.confirm(String(text)) : false;
}

export function uuid() {
    try {
        const u = ctx()?.uuidv4?.();
        if (u) return String(u);
    } catch { /* ignore */ }
    return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Register a slash command (SlashCommandParser.addCommandObject + SlashCommand.fromProps,
 * public/scripts/slash-commands/SlashCommandParser.js / SlashCommand.js:44).
 * @param {{name:string, help:string, callback:(named:object, unnamed:string)=>any, argDescription?:string, aliases?:string[]}} o
 */
export function registerSlashCommand({ name, help, callback, argDescription = '', aliases = [] }) {
    const c = ctx();
    if (!c) return false;
    try {
        const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = c;
        const props = {
            name,
            aliases,
            helpString: help,
            returns: 'nothing',
            callback: async (named, unnamed) => {
                try {
                    const r = await callback(named || {}, typeof unnamed === 'string' ? unnamed : String(unnamed ?? ''));
                    return typeof r === 'string' ? r : '';
                } catch (e) {
                    console.warn(LOG, `/${name} failed`, e);
                    return '';
                }
            },
        };
        if (argDescription && SlashCommandArgument?.fromProps) {
            props.unnamedArgumentList = [SlashCommandArgument.fromProps({ description: argDescription, typeList: [ARGUMENT_TYPE?.STRING ?? 'string'], isRequired: false })];
        }
        SlashCommandParser.addCommandObject(SlashCommand.fromProps(props));
        return true;
    } catch (e) {
        console.warn(LOG, `could not register /${name}`, e);
        return false;
    }
}

/** SillyTavern's "leave this message out of the prompt" marker (getContext().symbols.ignore, constants.js IGNORE_SYMBOL). */
export function ignoreSymbol() {
    try { return ctx()?.symbols?.ignore || Symbol.for('ignore'); } catch { return Symbol.for('ignore'); }
}

// Embedding sources that need nothing beyond {source, model} in the request body (others need local endpoints or
// client-side embeddings, so semantic recall falls back to keywords there).
const SIMPLE_VECTOR_SOURCES = { transformers: null, openai: 'openai_model', openrouter: 'openrouter_model', cohere: 'cohere_model', togetherai: 'togetherai_model', electronhub: 'electronhub_model', nomicai: null, mistral: null };

/**
 * Minimal adapter over SillyTavern's vector endpoints (src/endpoints/vectors.js: /api/vector/list|insert|delete|query)
 * using the user's Vector Storage source. Returns null when unavailable (memory then recalls by keywords).
 */
export function vectors(collectionId) {
    const c = ctx();
    const vs = c?.extensionSettings?.vectors;
    if (!c || !vs || !collectionId || typeof c.getRequestHeaders !== 'function') return null;
    if ((c.extensionSettings.disabledExtensions || []).some(x => String(x).includes('vectors'))) return null;
    const source = String(vs.source || 'transformers');
    if (!Object.hasOwn(SIMPLE_VECTOR_SOURCES, source)) return null;
    const modelKey = SIMPLE_VECTOR_SOURCES[source];
    const base = { collectionId, source, ...(modelKey && vs[modelKey] ? { model: vs[modelKey] } : {}) };
    const post = async (path, body) => {
        const r = await fetch(`/api/vector/${path}`, { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ ...base, ...body }) });
        if (!r.ok) throw new Error(`vector ${path}: ${r.status}`);
        const t = await r.text();
        return t ? JSON.parse(t) : null;
    };
    return {
        list: () => post('list', {}),
        insert: items => post('insert', { items }),
        remove: hashes => post('delete', { hashes }),
        query: (text, topK = 10) => post('query', { searchText: String(text), topK, threshold: 0 }),
    };
}

/** The facade object handed to the runtime. */
export const facade = {
    getChat, getChatId, getChatMetadata, saveMetadata, saveChat, getSettingsRoot, saveSettings, substituteParams, getCard,
    getPersona, getProfileKey, getCharacter, getModelId, isGenerating, sendJobRequest, isOwnRequest, dryRunGenerate, toast,
    popup, confirm, uuid, listConnectionProfiles, ignoreSymbol, vectors,
};
