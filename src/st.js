// The only module that talks to SillyTavern. Everything goes through SillyTavern.getContext(),
// so the same code runs in desktop SillyTavern and in TauriTavern.

export const KEY = 'roleplay_instructions';
export const LOG = '[Roleplay Instructions]';

export const ctx = () => globalThis.SillyTavern.getContext();

export function eventTypes() {
    const c = ctx();
    return c.eventTypes || c.event_types || {};
}

/** Listen to a SillyTavern event by its name in event_types. Returns false when this app does not have it. */
export function on(name, fn) {
    const type = eventTypes()[name];
    if (!type) return false;
    ctx().eventSource.on(type, fn);
    return true;
}

export function hasEvent(name) {
    return !!eventTypes()[name];
}

export function sub(text) {
    try { return ctx().substituteParams(String(text ?? '')); } catch { return String(text ?? ''); }
}

export function isChatOpen() {
    try { return !!ctx().getCurrentChatId(); } catch { return false; }
}

export function names() {
    const c = ctx();
    return { char: String(c.name2 || 'the character'), user: String(c.name1 || 'the user') };
}

export function characterKey() {
    const c = ctx();
    if (c.groupId) return `group:${c.groupId}`;
    const ch = c.characters?.[c.characterId];
    return ch?.avatar ? `char:${ch.avatar}` : '';
}

export function setChatVariable(name, value) {
    try { ctx().variables.local.set(name, value); return true; } catch (e) { console.warn(LOG, 'could not set variable', name, e); return false; }
}

/** Number of messages World Info counts for the scan of this generation. */
export function scanLength(type) {
    const chat = ctx().chat || [];
    let n = chat.filter(m => !m.is_system).length;
    if (type === 'swipe') n -= 1;
    return Math.max(0, n);
}

export function toast(kind, message) {
    try {
        const t = globalThis.toastr;
        (t?.[kind] || t?.info)?.call(t, String(message), 'Roleplay Instructions');
    } catch { console.log(LOG, message); }
}

export async function confirmBox(text) {
    const c = ctx();
    try {
        const r = await c.callGenericPopup(String(text), c.POPUP_TYPE?.CONFIRM ?? 2);
        return r === (c.POPUP_RESULT?.AFFIRMATIVE ?? 1) || r === true;
    } catch { return globalThis.confirm(String(text)); }
}

export async function inputBox(text, value = '') {
    const c = ctx();
    try {
        const r = await c.callGenericPopup(String(text), c.POPUP_TYPE?.INPUT ?? 3, String(value));
        return typeof r === 'string' ? r.trim() : '';
    } catch { return (globalThis.prompt(String(text), String(value)) || '').trim(); }
}

export function listProfiles() {
    try {
        const list = ctx().extensionSettings?.connectionManager?.profiles;
        return Array.isArray(list) ? list.map(p => ({ id: String(p.id), name: String(p.name || p.id) })) : [];
    } catch { return []; }
}

function stripThinking(text) {
    return String(text ?? '').replace(/<\s*(think|thinking|reasoning)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '').trim();
}

/**
 * Send one background request and return the text of the answer.
 * With a connection profile: ConnectionManagerRequestService. Otherwise generateRaw on the chat's own connection.
 */
export async function ask({ system = '', user = '', tokens = 600, profileId = '' }) {
    const c = ctx();
    const messages = [{ role: 'user', content: String(user) }];
    if (profileId && listProfiles().some(p => p.id === String(profileId))) {
        const msgs = [...(system ? [{ role: 'system', content: String(system) }] : []), ...messages];
        const r = await c.ConnectionManagerRequestService.sendRequest(String(profileId), msgs, tokens, { stream: false, extractData: true, includePreset: true, includeInstruct: true });
        return stripThinking(typeof r === 'string' ? r : (r?.content ?? ''));
    }
    const text = await c.generateRaw({ prompt: messages, systemPrompt: String(system), responseLength: tokens, trimNames: false });
    return stripThinking(text);
}

/** Pull the first JSON list or object out of a model answer. Returns null when there is none. */
export function parseJson(text) {
    const s = String(text ?? '').replace(/```(?:json)?/gi, '');
    for (const [open, close] of [['[', ']'], ['{', '}']]) {
        const a = s.indexOf(open);
        const b = s.lastIndexOf(close);
        if (a >= 0 && b > a) {
            try { return JSON.parse(s.slice(a, b + 1)); } catch { /* try the next shape */ }
        }
    }
    return null;
}

export function worldNames() {
    try { return ctx().getWorldInfoNames?.() || []; } catch { return []; }
}

export async function loadBook(name) {
    return await ctx().loadWorldInfo(name);
}

export async function saveBook(name, data) {
    const c = ctx();
    await c.saveWorldInfo(name, data, true);
    try { c.reloadWorldInfoEditor?.(name, false); } catch { /* the World Info editor is not open */ }
}

export async function refreshWorldList() {
    try { await ctx().updateWorldInfoList?.(); } catch { /* not fatal */ }
}

export function regexScripts() {
    try {
        const list = ctx().extensionSettings?.regex;
        return Array.isArray(list) ? list : [];
    } catch { return []; }
}

export async function triggerSwipe() {
    const c = ctx();
    try {
        if (typeof c.swipe?.right === 'function') { await c.swipe.right(); return true; }
    } catch (e) { console.warn(LOG, 'swipe.right failed', e); }
    try { globalThis.jQuery?.('#chat .last_mes .swipe_right').trigger('click'); return true; } catch { return false; }
}

export function isGenerating() {
    return document.body?.dataset?.generating === 'true';
}
