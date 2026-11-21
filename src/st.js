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

/**
 * A message that was hidden from the AI (the /hide command, or anything that hides older messages for you). It is
 * still part of the story. SillyTavern marks it the same way as its own notices, which carry a type.
 */
export const isHidden = m => !!m && m.is_system === true && !m.extra?.type && m.role !== 'tool' && !(m.extra && 'tool_invocations' in m.extra);
/** A reply of the story: a message that you did not write, whether or not it is hidden from the AI now. */
export const isReply = m => !!m && !m.is_user && (!m.is_system || isHidden(m));
/** A message of the story, yours or not, whether or not it is hidden from the AI now. */
export const isStory = m => !!m && (!m.is_system || isHidden(m));

// How many chat messages were in the finished prompt of the last reply. It is counted from the prompt itself, after
// every extension (Message Limit included) has had its turn, so it is what the AI was really sent.
let handed = null;
/** Record the finished prompt. messages: the prompt's list of { role, content }. */
export function notePromptSent(messages) {
    try {
        const chat = ctx().chat || [];
        const n = messages.filter(m => m && (m.role === 'user' || m.role === 'assistant')).length;
        const open = chat.filter(m => m && !m.is_system).length;
        handed = { n, open, chatId: String(ctx().getCurrentChatId?.() || '') };
    } catch { /* only a count */ }
}

/** What the AI is sent from this chat: how many messages there are, how many are hidden, and how many went out last. */
export function chatReach() {
    const chat = ctx().chat || [];
    const hidden = chat.filter(isHidden).length;
    const open = chat.filter(m => m && !m.is_system).length;
    const mine = handed && handed.chatId === String(ctx().getCurrentChatId?.() || '') ? handed : null;
    // One message of slack: a swipe leaves out the reply being replaced.
    return { total: chat.length, hidden, open, last: mine ? mine.n : null, cut: mine ? Math.max(0, mine.open - mine.n - 1) : 0 };
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
        const escaped = String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        const r = await c.callGenericPopup(escaped, c.POPUP_TYPE?.CONFIRM ?? 2);
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

export function canUseProfiles() {
    const host = ctx();
    return typeof host.ConnectionManagerRequestService?.sendRequest === 'function' &&
        !host.extensionSettings?.disabledExtensions?.includes('connection-manager');
}

function stripThinking(text) {
    // Closed thinking blocks, then a thinking block that was cut off before it closed.
    return String(text ?? '').replace(/<\s*(think|thinking|reasoning)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/<\s*(think|thinking|reasoning)\s*>[\s\S]*$/i, '').trim();
}

/**
 * Send one background request and return the text of the answer.
 * With a connection profile: ConnectionManagerRequestService. Otherwise generateRaw on the chat's own connection.
 */
export async function askFull({ system = '', user = '', tokens = 600, profileId = '', signal, useProfilePreset = true }) {
    const c = ctx();
    const messages = [{ role: 'user', content: String(user) }];
    let raw = '';
    let reasoning = '';
    if (profileId) {
        if (!canUseProfiles() || !listProfiles().some(p => p.id === String(profileId))) {
            throw new Error('The saved connection profile is unavailable on this host. Choose an available connection in Execution settings.');
        }
        const msgs = [...(system ? [{ role: 'system', content: String(system) }] : []), ...messages];
        const r = await c.ConnectionManagerRequestService.sendRequest(String(profileId), msgs, tokens, {
            stream: false, extractData: true, includePreset: useProfilePreset, includeInstruct: true, signal,
        });
        raw = String(typeof r === 'string' ? r : (r?.content ?? ''));
        reasoning = String((r && typeof r === 'object' && r.reasoning) || '');
    } else {
        if (typeof c.generateRaw !== 'function') throw new Error('This host does not expose direct generation on Main API.');
        raw = String(await c.generateRaw({ prompt: messages, systemPrompt: String(system), responseLength: tokens, trimNames: false }) ?? '');
    }
    const text = stripThinking(raw);
    // How many characters were the model thinking: a reasoning field, or thinking tags inside the answer.
    const thinking = reasoning.length + (raw.length - text.length > 0 && /<\s*(think|thinking|reasoning)\s*>/i.test(raw) ? raw.length - text.length : 0);
    return { text, raw: reasoning ? `[thinking]\n${reasoning}\n[answer]\n${raw}` : raw, thinking };
}

/** The text of the answer only. */
export async function ask(options) {
    return (await askFull(options)).text;
}

/** Pull the first JSON list or object out of a model answer. Returns null when there is none. */
export function parseJson(text, { object = false } = {}) {
    const s = String(text ?? '').replace(/```(?:json)?/gi, '');
    for (const [open, close] of object ? [['{','}']] : [['[', ']'], ['{', '}']]) {
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

export async function deleteBook(name) {
    const host = ctx();
    const remove = typeof host.deleteWorldInfo==='function' ? host.deleteWorldInfo.bind(host) :
        (await import('../../../../world-info.js')).deleteWorldInfo;
    if (typeof remove!=='function' || await remove(name) === false) throw new Error('The host could not delete this World Info book.');
    await refreshWorldList();
    if (worldNames().includes(name)) throw new Error('The host still lists this book. Reload World Info before trying again.');
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

export async function triggerSwipe({ append = false } = {}) {
    const c = ctx();
    const message = c.chat?.at(-1);
    if (append && message?.swipes?.length && Number(message.swipe_id || 0)<message.swipes.length-1) {
        if (typeof c.swipe?.to!=='function') throw new Error('This host needs the newest swipe selected to generate another one.');
        await c.swipe.to(null,'right',{message,forceSwipeId:message.swipes.length});
        return true;
    }
    if (typeof c.swipe?.right === 'function') { await c.swipe.right(); return true; }
    try {
        const button = globalThis.document?.querySelector('#chat .last_mes .swipe_right');
        if (!button) return false;
        button.click();
        return true;
    } catch { return false; }
}

export function isGenerating() {
    return globalThis.document?.body?.dataset?.generating === 'true';
}

/** A guided request reserves one generation. Host autoretry settings stay in force for ordinary sends. */
export async function withSingleHostRequest(action) {
    const prefs = ctx().powerUserSettings;
    const continuing = prefs?.auto_continue;
    const disableSwipe = prefs?.auto_swipe === true;
    const disableContinue = continuing?.enabled === true;
    if (disableSwipe) prefs.auto_swipe = false;
    if (disableContinue) continuing.enabled = false;
    try { return await action(); }
    finally {
        if (disableSwipe && prefs.auto_swipe === false) prefs.auto_swipe = true;
        if (disableContinue && continuing.enabled === false) continuing.enabled = true;
    }
}

export function readComposer() {
    const input = globalThis.document?.querySelector('#send_textarea');
    return input ? { text: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection } : null;
}

export function writeComposer(snapshot) {
    const input = globalThis.document?.querySelector('#send_textarea');
    if (!input || !snapshot) return false;
    input.value = snapshot.text;
    if (snapshot.start != null) input.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start, snapshot.direction ?? 'none');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
}

export async function triggerContinuation() {
    const host = ctx();
    if (typeof host.generate !== 'function') return false;
    if (!host.groupId) {
        // SillyTavern's depth flag keeps the composer out of a continuation.
        await host.generate('continue', { depth: 1 });
        return true;
    }
    // Group generation invokes the host command a second time without the depth
    // option. Temporarily clear the composer and restore only in this same chat.
    const draft = readComposer(), chat = host.chat;
    if (draft?.text) writeComposer({ text: '' });
    try { await host.generate('continue'); }
    finally {
        if (ctx().chat === chat && draft && readComposer()?.text === '') writeComposer(draft);
    }
    return true;
}

const swipeSnapshot = message => ({
    send_date: message.send_date, gen_started: message.gen_started, gen_finished: message.gen_finished,
    extra: structuredClone(message.extra || {}),
});

/** Apply a generated historical version to the chosen host message only. */
export function setReplyVersion(index, text, { append = false } = {}) {
    const message = ctx().chat?.[index];
    if (!message || !isReply(message) || message.is_system) throw new Error('The selected reply is unavailable.');
    const before = structuredClone(message);
    message.swipes = Array.isArray(message.swipes) ? [...message.swipes] : [];
    message.swipe_info = Array.isArray(message.swipe_info) ? structuredClone(message.swipe_info) : [];
    const original = Number(message.swipe_id ?? 0);
    message.swipes[original] = message.mes;
    message.swipe_info[original] = swipeSnapshot(message);
    const swipe = append ? original : message.swipes.length;
    message.swipe_id = swipe;
    message.mes = text;
    const extra = structuredClone(message.extra || {});
    delete extra.display_text;
    if (!append) for (const field of [KEY, 'api', 'model', 'reasoning', 'reasoning_signature', 'reasoning_duration', 'token_count']) delete extra[field];
    message.extra = extra;
    message.swipes[swipe] = text;
    message.swipe_info[swipe] = swipeSnapshot(message);
    return { message, before };
}

export function selectReplyVersion(index, swipe) {
    const message = ctx().chat?.[index];
    if (!message || typeof message.swipes?.[swipe] !== 'string') throw new Error('That swipe is no longer available.');
    const original = Number(message.swipe_id ?? 0);
    if (original === swipe) return message;
    message.swipe_info ??= [];
    message.swipes[original] = message.mes;
    message.swipe_info[original] = swipeSnapshot(message);
    const chosen = message.swipe_info[swipe];
    message.swipe_id = swipe;
    message.mes = message.swipes[swipe];
    if (chosen) {
        for (const key of ['send_date', 'gen_started', 'gen_finished']) message[key] = chosen[key];
        message.extra = structuredClone(chosen.extra || {});
    } else {
        message.extra = structuredClone(message.extra || {});
        delete message.extra[KEY];
    }
    updateReplyVersion(index);
    return message;
}

export function updateReplyVersion(index) {
    const host = ctx(), message = host.chat?.[index];
    if (!message) return;
    if (message.swipes?.[message.swipe_id] !== undefined) {
        message.swipes[message.swipe_id] = message.mes;
        message.swipe_info ??= [];
        message.swipe_info[message.swipe_id] = swipeSnapshot(message);
    }
    host.updateMessageBlock?.(index, message);
    host.swipe?.refresh?.(true, false);
}

export function restoreReplySnapshot(index, before, expected = ctx().chat?.[index]) {
    const message = ctx().chat?.[index];
    if (!message || message !== expected || !before) return false;
    for (const key of Object.keys(message)) delete message[key];
    Object.assign(message, structuredClone(before));
    const host = ctx();
    host.updateMessageBlock?.(index, message);
    host.swipe?.refresh?.(true, false);
    return true;
}
