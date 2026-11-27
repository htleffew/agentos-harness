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
export function replyLabels(chat = ctx().chat || []) {
    let number = 0;
    return chat.map((message, index) => index && isReply(message) ? `Reply ${++number}` : 'First message');
}
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

/**
 * Saved connection profiles the request service can send through, with what routing needs to classify them:
 * the API source, model, address and completion preset. Key values never leave SillyTavern's server.
 */
export function profileDetails() {
    const host = ctx();
    let list = [];
    try {
        const service = host.ConnectionManagerRequestService;
        list = typeof service?.getSupportedProfiles === 'function' ? service.getSupportedProfiles()
            : host.extensionSettings?.connectionManager?.profiles;
    } catch { list = host.extensionSettings?.connectionManager?.profiles; }
    const map = host.CONNECT_API_MAP || {};
    const sourceOf = api => String(map[api]?.source || (api === 'google' ? 'makersuite' : api));
    return (Array.isArray(list) ? list : []).filter(p => p && p.id).map(p => ({
        id: String(p.id), name: String(p.name || p.id), api: sourceOf(String(p.api || '')), model: String(p.model || ''),
        url: String(p['api-url'] || ''), preset: String(p.preset || ''),
    }));
}

/** A model server on this device, on the home network or on the tailnet. */
export function isLocalUrl(url) {
    let host = '', port = '';
    try { ({ hostname: host, port } = new URL(String(url))); } catch { return false; }
    host = host.replace(/^\[|\]$/g, '');
    if (port === '11434' || /\.ts\.net$/i.test(host) || /^(localhost|127\.\d+\.\d+\.\d+|::1)$/i.test(host)) return true;
    const ip = host.split('.').map(Number);
    if (ip.length !== 4 || ip.some(n => !Number.isInteger(n))) return false;
    return ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127 || ip[0] === 10 || ip[0] === 192 && ip[1] === 168 || ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31;
}

// SillyTavern maps the reasoning effort it receives for NanoGPT one step down (NANOGPT_REASONING_EFFORT_MAP in
// src/constants.js), so the value sent is the one that arrives at NanoGPT as the effort the tier asks for.
const NANOGPT_EFFORT = Object.freeze({ none: 'min', minimal: 'low', low: 'medium', medium: 'high', high: 'max' });

/** Set one key in the Additional Parameters text of a Custom source, keeping every other line as written. */
export function includeBodyWith(text, key, value) {
    const base = String(text ?? '').trim();
    if (base.startsWith('{')) {
        try { return JSON.stringify({ ...JSON.parse(base), [key]: value }); } catch { /* read it as YAML lines below */ }
    }
    const kept = base.split(/\r?\n/).filter(line => line.trim() && !new RegExp(`^\\s*${key}\\s*:`).test(line));
    return [...kept, `${key}: ${value}`].join('\n');
}

/**
 * The extra request fields for one structured background call, as SillyTavern's chat completion request reads them.
 * schema: { name, value, description }. mode: 'schema' sends the JSON schema (SillyTavern turns it into
 * response_format), 'tool' forces one tool whose parameters are the schema. effort: none, low or high.
 * includeBody: the profile's Additional Parameters, which a Custom source needs for its reasoning effort.
 */
export function overridePayloadFor(source, { schema, mode = 'schema', effort = '', toolName = '', includeBody = '', model = '' } = {}) {
    const payload = {};
    if (model) payload.model = String(model);
    if (schema?.value && mode === 'schema') {
        payload.json_schema = { name: String(schema.name || 'answer'), strict: true, value: schema.value,
            ...(schema.description ? { description: String(schema.description) } : {}) };
    }
    if (schema?.value && mode === 'tool') {
        const name = String(toolName || schema.name || 'answer');
        payload.tools = [{ type: 'function', function: { name, description: String(schema.description || 'Record the answer.'), parameters: schema.value } }];
        payload.tool_choice = { type: 'function', function: { name } };
    }
    if (effort) {
        // A Custom source forwards reasoning_effort only for OpenAI's own models, so it travels in Additional Parameters.
        if (source === 'custom') payload.custom_include_body = includeBodyWith(includeBody, 'reasoning_effort', effort);
        else if (source === 'nanogpt') payload.reasoning_effort = NANOGPT_EFFORT[effort] || effort;
        else if (source !== 'makersuite') payload.reasoning_effort = effort;
        if (source === 'openrouter') payload.include_reasoning = false;
    }
    return payload;
}

/** Read the answer, its reasoning, a forced tool's arguments, usage and any reported cost from a raw completion. */
export function readCompletion(json) {
    const choice = json?.choices?.[0] || {};
    const message = choice.message || {};
    const content = Array.isArray(message.content) ? message.content.map(part => part?.text || '').join('') : String(message.content ?? choice.text ?? '');
    const call = Array.isArray(message.tool_calls) ? message.tool_calls[0] : null;
    const usage = json?.usage && typeof json.usage === 'object' ? json.usage : null;
    const reported = [usage?.cost, json?.cost, json?.x_nanogpt_pricing?.cost].find(value => Number.isFinite(Number(value)) && value !== null && value !== '');
    return {
        text: content, reasoning: String(message.reasoning || message.reasoning_content || ''), finish: String(choice.finish_reason || ''),
        toolArguments: call?.function?.arguments ?? null, usage, cost: reported === undefined ? null : Number(reported),
    };
}

/**
 * Ask SillyTavern's server whether a Custom (OpenAI-compatible) address answers, within a time limit.
 * The server makes the call, so the phone's WebView needs no access to the address itself.
 */
export async function probeCustomUrl(url, { timeoutMs = 4000, signal } = {}) {
    const host = ctx();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('The probe timed out.')), timeoutMs);
    const stop = () => controller.abort(signal?.reason);
    signal?.addEventListener?.('abort', stop, { once: true });
    try {
        const headers = typeof host.getRequestHeaders === 'function' ? host.getRequestHeaders() : { 'Content-Type': 'application/json' };
        const response = await globalThis.fetch('/api/backends/chat-completions/status', {
            method: 'POST', headers, body: JSON.stringify({ chat_completion_source: 'custom', custom_url: String(url) }), signal: controller.signal,
        });
        if (!response.ok) return false;
        const data = await response.json().catch(() => null);
        return !!data && !data.error && !data.bypass;
    } catch { return false; }
    finally { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); }
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
export async function askFull({ system = '', user = '', tokens = 600, profileId = '', signal, useProfilePreset = true,
    source = '', model = '', schema = null, mode = 'schema', effort = '', toolName = '' }) {
    const c = ctx();
    const messages = [{ role: 'user', content: String(user) }];
    const msgs = [...(system ? [{ role: 'system', content: String(system) }] : []), ...messages];
    let raw = '';
    let reasoning = '';
    // A schema, a forced tool, a reasoning effort or a model of the route's own needs the override payload and the raw
    // response, which also carries the usage and cost the spend meter records.
    const routed = !!(schema?.value || effort || model);
    if (routed && (profileId || source)) {
        let profile = null;
        if (profileId) {
            profile = profileDetails().find(p => p.id === String(profileId));
            if (!canUseProfiles() || !profile) throw new Error('The saved connection profile is unavailable in this SillyTavern. Choose an available connection in Execution settings.');
        } else if (typeof c.ChatCompletionService?.processRequest !== 'function') {
            throw new Error('SillyTavern cannot send a direct background request.');
        }
        const api = profile ? profile.api : String(source);
        let includeBody = '';
        if (api === 'custom' && effort && profile && useProfilePreset) {
            try {
                const preset = c.getPresetManager?.('openai')?.getCompletionPresetByName?.(profile.preset);
                if (preset) includeBody = preset.custom_include_body ?? c.chatCompletionSettings?.custom_include_body ?? '';
            } catch { /* The preset is read for its Additional Parameters only. */ }
        }
        const override = overridePayloadFor(api, { schema, mode, effort, toolName, includeBody, model });
        const json = profile
            ? await c.ConnectionManagerRequestService.sendRequest(String(profileId), msgs, tokens, {
                stream: false, extractData: false, includePreset: useProfilePreset, includeInstruct: true, signal,
            }, override)
            : await c.ChatCompletionService.processRequest({ stream: false, messages: msgs, max_tokens: tokens, chat_completion_source: api, ...override }, {}, false, signal);
        const read = readCompletion(json);
        raw = mode === 'tool' && read.toolArguments != null && !read.text.trim()
            ? (typeof read.toolArguments === 'string' ? read.toolArguments : JSON.stringify(read.toolArguments)) : read.text;
        reasoning = read.reasoning;
        const text = stripThinking(raw);
        return { text, raw: reasoning ? `[thinking]\n${reasoning}\n[answer]\n${raw}` : raw, thinking: reasoning.length,
            usage: read.usage, cost: read.cost, finish: read.finish, source: api };
    }
    if (profileId) {
        if (!canUseProfiles() || !listProfiles().some(p => p.id === String(profileId))) {
            throw new Error('The saved connection profile is unavailable in this SillyTavern. Choose an available connection in Execution settings.');
        }
        const r = await c.ConnectionManagerRequestService.sendRequest(String(profileId), msgs, tokens, {
            stream: false, extractData: true, includePreset: useProfilePreset, includeInstruct: true, signal,
        });
        raw = String(typeof r === 'string' ? r : (r?.content ?? ''));
        reasoning = String((r && typeof r === 'object' && r.reasoning) || '');
    } else {
        if (typeof c.generateRaw !== 'function') throw new Error('SillyTavern does not expose direct generation on Main API.');
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
    if (typeof remove!=='function' || await remove(name) === false) throw new Error('SillyTavern could not delete this World Info book.');
    await refreshWorldList();
    if (worldNames().includes(name)) throw new Error('SillyTavern still lists this book. Reload World Info before trying again.');
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
        if (typeof c.swipe?.to!=='function') throw new Error('SillyTavern needs the newest swipe selected to generate another one.');
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

let heldGroupDraft;

function groupDraftOwner(hold) {
    const current = ctx();
    return current.chat === hold.chat && current.getCurrentChatId?.() === hold.chatId && characterKey() === hold.character;
}

/** The origin's draft during the host's temporary input clear for a group continuation. */
export function heldGroupContinuationComposer() {
    return heldGroupDraft && groupDraftOwner(heldGroupDraft) ? heldGroupDraft.draft : null;
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
    const draft = readComposer();
    const hold = { draft, chat: host.chat, chatId: host.getCurrentChatId?.(), character: characterKey() };
    if (draft?.text) {
        heldGroupDraft = hold;
        writeComposer({ text: '' });
    }
    try { await host.generate('continue'); }
    finally {
        if (heldGroupDraft === hold) heldGroupDraft = null;
        if (groupDraftOwner(hold) && draft?.text && readComposer()?.text === '') writeComposer(draft);
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
