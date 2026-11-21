// A pending direction is resolved before queueing and bound to a real player message.
import { executionPreview } from './execution.js';
import { memoryOnly } from './components.js';
import { chatState, saveChatState, settings } from './store.js';
import { characterKey, ctx, hasEvent, isGenerating, isReply } from './st.js';

const SEND_KEY = 'riQuickActionSend';
const SLOT_KEY = 'riQuickActionSlot';
const FRESH_LENGTH = 5;
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const textOf = content => typeof content === 'string' ? content : (Array.isArray(content) ? content.map(part => part?.text || '').join('') : '');

export function quickChatIdentity() {
    return JSON.stringify([characterKey(), String(ctx().getCurrentChatId?.() || '')]);
}

export function quickChat() {
    const cs = chatState();
    if (!cs) return null;
    const owner = quickChatIdentity();
    // Some hosts copy chat metadata on branch creation. The branch owns a new queue.
    if (cs.quickActions?.owner !== owner) cs.quickActions = { version: 1, owner, pending: [], pins: [], recent: [], draftRecovery: null };
    return cs.quickActions;
}

export function queueCapability() {
    const c = ctx();
    if (memoryOnly()) return 'Directions need the full extension workflow in this chat.';
    if (c.mainApi !== 'openai' || !['MESSAGE_SENT','CHAT_COMPLETION_PROMPT_READY','WORLDINFO_SCAN_DONE','WORLDINFO_ENTRIES_LOADED'].every(hasEvent)) {
        return 'Queue delivery needs a chat-completion connection with an observable final prompt.';
    }
    return '';
}

export function queueDirections(cues, direction, { visibility = 'private', required = false, freshStart = '', roll = null } = {}) {
    const state = quickChat();
    if (!state) throw new Error('Open a chat to queue directions.');
    const reason = queueCapability();
    if (reason) throw new Error(reason);
    const rows = [...cues, ...(direction.trim() ? [{ text: direction }] : [])].filter(cue => cue?.text?.trim());
    if (!rows.length && !freshStart && !roll) throw new Error('Add a cue, a direction or Fresh start.');
    const entry = { id: id(), created: Date.now(), freshStart, roll, rows: structuredClone(rows).map(row => ({
        ...row, visibility: visibility === 'default' ? row.visibility || 'private' : visibility,
        required: required || row.required === true,
    })) };
    state.pending.push(entry);
    saveChatState();
    return entry;
}

export function cancelQueued(idToRemove) {
    const state = quickChat();
    const entry = state?.pending.find(item => item.id === idToRemove);
    if (!entry) return false;
    state.pending = state.pending.filter(item => item.id !== idToRemove);
    state.bindings = (state.bindings || []).filter(binding => binding.entries.some(queued => state.pending.some(item => item.id === queued.id)));
    saveChatState();
    return true;
}

export function pinQuickAction(reference, title, family) {
    const state = quickChat();
    if (!state) return;
    const key = typeof reference === 'string' ? reference : JSON.stringify(reference);
    const i = state.pins.findIndex(pin => pin.key === key);
    if (i < 0) state.pins.push({ key, reference, title, family });
    else state.pins.splice(i, 1);
    saveChatState();
}

export function moveQuickPin(index, step) {
    const pins = quickChat()?.pins;
    if (!pins?.[index] || !pins[index + step]) return;
    [pins[index], pins[index + step]] = [pins[index + step], pins[index]];
    saveChatState();
}

export function rememberQuickActions(cues) {
    const state = quickChat();
    if (!state) return;
    for (const cue of cues) {
        if (!cue.reference) continue;
        const key = typeof cue.reference === 'string' ? cue.reference : JSON.stringify(cue.reference);
        state.recent = [{ key, reference: cue.reference, title: cue.title ?? cue.id, family: cue.family },
            ...state.recent.filter(row => row.key !== key)].slice(0, 12);
    }
    saveChatState();
}

const boundSnapshot = (state, message) => {
    const marker = message?.extra?.[SEND_KEY];
    return marker?.owner === state?.owner ? state?.bindings?.find(binding => binding.id === marker.id) : null;
};

const activeRows = (state, snapshot) => snapshot.entries.filter(entry => state.pending.some(row => row.id === entry.id));

export function startQuickReply(generation, options) {
    if (!settings().enabled || generation.skip || generation.memory || generation.type !== 'normal' || options?.automatic_trigger) return;
    const state = quickChat();
    if (!state) return;
    generation.quickChat = state.owner;
    generation.quickDelivery = !queueCapability();
    if (!generation.quickDelivery) return;
    const message = ctx().chat?.at(-1);
    const snapshot = boundSnapshot(state, message);
    const composer = document.getElementById('send_textarea');
    if (!composer?.value.trim() && message?.is_user && snapshot?.owner === state.owner && !snapshot.accepted) {
        if (activeRows(state, snapshot).length) generation.quickSend = snapshot;
    }
}

export async function bindQuickReply(generation, index) {
    const state = quickChat();
    const chat = ctx().chat;
    const message = chat?.[index];
    if (!state || generation?.quickChat !== state.owner || !generation.quickDelivery || generation.quickSend || Number(index) !== chat?.length - 1 ||
        !message?.is_user || message.is_system || !message.mes?.trim() || /^[\s(\[<*]*OOC\b/i.test(message.mes) || !state.pending.length) return;
    const surviving = new Set(chat.map(other => other.extra?.[SEND_KEY]?.id).filter(Boolean));
    state.bindings = (state.bindings || []).filter(binding => surviving.has(binding.id));
    const alreadyBound = new Set(state.bindings.flatMap(binding => binding.entries.map(entry => entry.id)));
    const entries = state.pending.filter(entry => !alreadyBound.has(entry.id));
    if (!entries.length) return;
    const visible = entries.flatMap(entry => entry.rows.filter(row => row.visibility === 'visible'))
        .map(row => `(OOC: ${row.required ? 'Required direction. ' : ''}${row.text})`).join('\n');
    const suffix = visible ? '\n\n' + visible : '';
    const snapshot = { owner: state.owner, id: id(), entries: structuredClone(entries), contribution: message.mes, suffix, attempts: 0 };
    message.extra ||= {};
    message.extra[SEND_KEY] = { owner: state.owner, id: snapshot.id, suffix };
    state.bindings.push(snapshot);
    message.mes += suffix;
    generation.quickSend = snapshot;
    // The native event occurs after the initial save and before the message is rendered.
    saveChatState();
    await ctx().saveChat?.();
}

export function playerContribution(message) {
    const original = String(message?.mes ?? '');
    const suffix = message?.extra?.[SEND_KEY]?.suffix;
    return suffix && original.endsWith(suffix) ? original.slice(0, -suffix.length) : original;
}

export function activeQuickPlan(generation) {
    const state = quickChat();
    if (!state || generation?.quickChat !== state.owner) return null;
    const snapshot = generation.quickSend;
    const entries = snapshot?.owner === state.owner ? activeRows(state, snapshot) : [];
    const fresh = entries.find(entry => entry.freshStart)?.freshStart;
    const freshStart = !!fresh || freshRemaining() > 0;
    if (!entries.length && !freshStart) return null;
    return { snapshot, entries, freshStart, arm: fresh === 'five' };
}

const visibleSuffixes = () => (ctx().chat || []).flatMap(row => row.extra?.[SEND_KEY]?.suffix || []);

export function stripStoredQuickDirections(messages) {
    const suffixes = visibleSuffixes();
    if (!suffixes.length) return;
    const strip = value => {
        for (const suffix of suffixes) if (value.endsWith(suffix)) return value.slice(0, -suffix.length);
        return value;
    };
    for (const message of messages) {
        if (message.role !== 'user') continue;
        if (typeof message.content === 'string') message.content = strip(message.content);
        else if (Array.isArray(message.content)) for (const part of message.content) if (typeof part?.text === 'string') part.text = strip(part.text);
    }
}

export function stripStoredQuickText(prompt) {
    let result = prompt;
    for (const suffix of visibleSuffixes()) {
        result = result.replaceAll(suffix, '').replaceAll(suffix.replace(/\n{2,}/g,'\n'), '');
    }
    return result;
}

export function applyQuickPrompt(messages, plan) {
    if (!plan?.entries.length) return null;
    const { snapshot, entries } = plan;
    const source = (ctx().chat || []).find(message => message.extra?.[SEND_KEY]?.id === snapshot.id);
    const contribution = playerContribution(source);
    if (!contribution || contribution !== snapshot.contribution) return null;
    const lastUser = messages.findLastIndex(message => message.role === 'user' && textOf(message.content).trim().endsWith(contribution.trim()));
    if (lastUser < 0) return null;
    const target = messages[lastUser];
    const rows = [];
    const seen = new Set();
    for (const row of entries.flatMap(entry => entry.rows)) {
        const key = row.sources?.[0]?.key;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        rows.push(row);
    }
    const visible = rows.filter(row => row.visibility === 'visible').map(row => `(OOC: ${row.required ? 'Required direction. ' : ''}${row.text})`).join('\n');
    const direction = rows.filter(row => row.visibility !== 'visible').map(row => `${row.required ? 'Required direction' : 'Direction'}: ${row.text}`);
    for (const entry of entries) if (entry.roll) direction.push(entry.roll.text);
    if (visible) {
        if (typeof target.content === 'string') target.content += '\n\n' + visible;
        else if (Array.isArray(target.content)) target.content.push({ type: 'text', text: '\n\n' + visible });
    }
    if (direction.length) messages.splice(lastUser, 0, { role: 'system', content: `Directions for the current reply.\n${direction.join('\n')}` });
    snapshot.attempts += 1;
    const receipt = {...executionPreview('steer',{stage:'reply',label:'Queued directions',target:snapshot.id,
        trigger:'The first character reply to this player message.'}), observedRoute:'Chat Completion',
        attempts:snapshot.attempts, outcome:'included', directions:structuredClone(rows),
        rolls:entries.flatMap(entry=>entry.roll || [])};
    snapshot.receipt = receipt;
    if (plan.history) receipt.history = plan.history;
    return receipt;
}

export function finishQuickReply(plan, message, acceptedRecord, {story=true}={}) {
    const state = quickChat();
    if (!state || !message || !acceptedRecord) return;
    const snapshot = plan?.snapshot;
    if (snapshot?.owner === state.owner && snapshot.receipt?.target === snapshot.id && plan.confirmed && !snapshot.accepted) {
        snapshot.accepted = true;
        snapshot.receipt.outcome = 'accepted';
        acceptedRecord.quickActions = structuredClone(snapshot.receipt);
        state.lastReceipt = acceptedRecord.quickActions;
        const spent = new Set(plan.entries.map(entry => entry.id));
        state.pending = state.pending.filter(entry => !spent.has(entry.id));
        state.bindings = (state.bindings || []).filter(binding => binding.id !== snapshot.id);
        if (plan.arm) armFreshStart();
    } else if (snapshot?.owner === state.owner && plan.entries.length && !snapshot.accepted && !plan.confirmed) {
        state.bindings = (state.bindings || []).filter(binding=>binding.id!==snapshot.id);
        failQuickReply(plan, 'The host could not confirm delivery. The directions are pending for the next send.');
    }
    if (plan?.freshStart && plan.history && !acceptedRecord.quickActions) {
        acceptedRecord.quickActions = {...executionPreview('steer',{stage:'reply',label:'Fresh start',trigger:'An accepted forward story reply.'}),
            observedRoute:plan.history.mode==='retained' ? 'Host history' : 'Chat Completion', history:plan.history, attempts:1, outcome:'accepted'};
    }
    if (story && acceptedRecord.type === 'normal' && !message.extra?.[SLOT_KEY]) {
        state.slotSequence=(Number(state.slotSequence) || 0)+1;
        const marker = { owner: state.owner, id: id(), time: Date.now(), sequence:state.slotSequence };
        message.extra[SLOT_KEY] = marker;
        const active = message.swipe_info?.[message.swipe_id]?.extra;
        if (active) active[SLOT_KEY] = marker;
    }
    saveChatState();
}

export function failQuickReply(plan, outcome = 'failed') {
    const state = quickChat();
    const snapshot = plan?.snapshot;
    if (snapshot?.owner !== state?.owner || !snapshot || snapshot.accepted) return;
    snapshot.receipt ||= {...executionPreview('steer',{stage:'reply',label:'Queued directions',target:snapshot.id}),attempts:0};
    if (snapshot.receipt.outcome==='cancelled' && outcome==='failed') return;
    snapshot.receipt.outcome = outcome;
    state.lastReceipt = structuredClone(snapshot.receipt);
    saveChatState();
    Promise.resolve(ctx().saveChat?.()).catch(() => {});
}

export function queuedRetry() {
    const state = quickChat();
    const message = ctx().chat?.at(-1);
    const snapshot = boundSnapshot(state, message);
    return !!(message?.is_user && snapshot?.owner === state?.owner && !snapshot?.accepted && activeRows(state, snapshot).length);
}

export async function retryQueuedReply() {
    if (!queuedRetry()) throw new Error('The original player message is no longer the latest message.');
    if (isGenerating()) throw new Error('Wait for the current reply to finish.');
    if (queueCapability()) throw new Error(queueCapability());
    if (document.getElementById('send_textarea')?.value.trim()) throw new Error('Save or clear the unsent composer text before retrying this message.');
    if (typeof ctx().generate !== 'function') throw new Error('This host cannot retry the original message from Quick actions.');
    return ctx().generate('normal');
}

export function armFreshStart() {
    const state = quickChat();
    if (!state) return;
    state.fresh = { armed: Date.now(), after:Number(state.slotSequence) || 0, stopped:false };
    saveChatState();
}

export function stopFreshStart() {
    const state = quickChat();
    if (!state?.fresh) return;
    state.fresh.stopped = true;
    saveChatState();
}

export function freshRemaining() {
    const state = quickChat();
    if (!state?.fresh || state.fresh.stopped) return 0;
    const slots = new Set();
    for (const message of ctx().chat || []) {
        if (!isReply(message)) continue;
        for (const extra of [message.extra, ...(message.swipe_info || []).map(swipe => swipe?.extra)]) {
            const marker = extra?.[SLOT_KEY];
            if (marker?.owner !== state.owner) continue;
            const acceptedAfter = marker.sequence && Number.isInteger(state.fresh.after)
                ? marker.sequence > state.fresh.after : marker.time >= state.fresh.armed;
            if (acceptedAfter) slots.add(marker.id);
        }
    }
    return Math.max(0, FRESH_LENGTH - slots.size);
}
