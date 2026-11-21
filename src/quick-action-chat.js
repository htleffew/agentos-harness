// A pending direction is resolved before queueing and bound to a real player message.
import { executionPreview } from './execution.js';
import { memoryOnly } from './components.js';
import { chatState, saveChatState, settings } from './store.js';
import { characterKey, ctx, hasEvent, isGenerating, isReply, KEY, readComposer, writeComposer } from './st.js';

const SEND_KEY = 'riQuickActionSend';
const SLOT_KEY = 'riQuickActionSlot';
const FRESH_LENGTH = 5;
let retrying = null;
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
    const routeEvents = c.mainApi === 'openai' ? ['CHAT_COMPLETION_PROMPT_READY']
        : c.mainApi ? ['GENERATE_BEFORE_COMBINE_PROMPTS','GENERATE_AFTER_COMBINE_PROMPTS'] : [];
    if (!routeEvents.length || !['MESSAGE_SENT','WORLDINFO_SCAN_DONE','WORLDINFO_ENTRIES_LOADED',...routeEvents].every(hasEvent)) {
        return 'This host does not expose the player send and final prompt needed for queue delivery.';
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

function deliveryRows(entries) {
    const seen = new Set();
    let required = 0;
    return entries.flatMap(entry => entry.rows).flatMap(row => {
        const key = row.sources?.length ? JSON.stringify([row.text, row.sources]) : '';
        if (key && seen.has(key)) return [];
        if (key) seen.add(key);
        return [{...row, ...(row.required ? {evidenceId:'Q'+(++required)} : {})}];
    });
}

function visibleDirections(rows) {
    return rows.filter(row => row.visibility === 'visible')
        .map(row => `(OOC: ${row.required ? `Required direction ${row.evidenceId}. ` : ''}${row.text})`).join('\n');
}

function privateDirections(rows, entries) {
    const direction = rows.filter(row => row.visibility !== 'visible')
        .map(row => `${row.required ? 'Required direction '+row.evidenceId : 'Direction'}: ${row.text}`);
    for (const entry of entries) if (entry.roll) direction.push(entry.roll.text);
    if (rows.some(row=>row.required)) direction.push(
        'After the story prose, put evidence for fulfilled directions in <direction_evidence>{"Q1":"exact quote from this reply"}</direction_evidence>.',
        'Use the matching direction ID and copy a short passage that shows the action in the story. Use an empty object when none apply.',
    );
    return direction.length ? 'Directions for the current reply.\n'+direction.join('\n') : '';
}

const EVIDENCE_BLOCK = /\s*<direction_evidence\b[^>]*>([\s\S]*?)(?:<\/direction_evidence\s*>|(?=<story_update\b|<\/reply\s*>|$))/gi;

export function splitQuickEvidence(prose, {streaming=false}={}) {
    const evidence = new Map();
    let text = String(prose ?? '').replace(EVIDENCE_BLOCK, (_source, json) => {
        try {
            const values = JSON.parse(json.trim());
            if (values && !Array.isArray(values) && typeof values==='object') for (const [key,value] of Object.entries(values)) {
                if (/^Q[1-9]\d*$/.test(key) && typeof value==='string' && !evidence.has(key)) evidence.set(key,value.trim());
            }
        } catch { /* Keep the prose even when the metadata is incomplete. */ }
        return '';
    });
    if (streaming) {
        const opening = '<direction_evidence';
        for (let length=opening.length-1;length>2;length--) {
            if (text.toLowerCase().endsWith(opening.slice(0,length))) { text=text.slice(0,-length); break; }
        }
    }
    return {text,evidence};
}

export function hasQuickEvidence(prose, quote) {
    const words = typeof quote==='string' ? quote.match(/[\p{L}\p{N}]+/gu)?.length || 0 : 0;
    return words>=3 && words<=40 && String(prose ?? '').includes(quote);
}

export function startQuickReply(generation, options) {
    if (!settings().enabled || generation.skip || generation.memory || generation.type !== 'normal') return;
    const state = quickChat();
    if (!state) return;
    generation.quickChat = state.owner;
    generation.quickDelivery = !options?.automatic_trigger && !queueCapability();
    if (!generation.quickDelivery) return;
    const message = ctx().chat?.at(-1);
    const snapshot = boundSnapshot(state, message);
    const composer = document.getElementById('send_textarea');
    if ((retrying?.binding===snapshot?.id || !composer?.value.trim()) && message?.is_user && snapshot?.owner === state.owner && !snapshot.accepted) {
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
    const visible = visibleDirections(deliveryRows(entries));
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

function boundContribution(snapshot) {
    const source = (ctx().chat || []).find(message => message.extra?.[SEND_KEY]?.id === snapshot.id);
    const contribution = playerContribution(source);
    return contribution === snapshot.contribution ? contribution : '';
}

function recordDelivery(plan, rows, route) {
    const {snapshot,entries} = plan;
    snapshot.attempts += 1;
    const receipt = {...executionPreview('steer',{stage:'reply',label:'Queued directions',target:snapshot.id,
        trigger:'The first character reply to this player message.'}), observedRoute:route,
        attempts:snapshot.attempts, outcome:'included', directions:structuredClone(rows),
        rolls:entries.flatMap(entry=>entry.roll || [])};
    snapshot.receipt = receipt;
    if (plan.history) receipt.history = plan.history;
    return receipt;
}

export function applyQuickPrompt(messages, plan) {
    if (!plan?.entries.length) return null;
    const contribution = boundContribution(plan.snapshot);
    if (!contribution) return null;
    const lastUser = messages.findLastIndex(message => message.role === 'user' && textOf(message.content).trim().endsWith(contribution.trim()));
    if (lastUser < 0) return null;
    const target = messages[lastUser];
    const rows = deliveryRows(plan.entries);
    const visible = visibleDirections(rows);
    const direction = privateDirections(rows,plan.entries);
    if (visible) {
        if (typeof target.content === 'string') target.content += '\n\n' + visible;
        else if (Array.isArray(target.content)) target.content.push({ type: 'text', text: '\n\n' + visible });
    }
    if (direction) messages.splice(lastUser, 0, { role: 'system', content: direction });
    return recordDelivery(plan,rows,'Chat Completion');
}

/** Observe the native formatted player entry without replacing any of the host's prompt formatting. */
export function observeQuickTextAnchor(data,plan) {
    if (!plan?.entries.length || !Array.isArray(data?.finalMesSend)) return;
    const contribution = boundContribution(plan.snapshot);
    if (!contribution) return;
    const player = data.finalMesSend.findLast(entry=>!entry.injected && typeof entry.message==='string' &&
        stripStoredQuickText(entry.message).includes(contribution));
    plan.textAnchor = player && stripStoredQuickText(player.message).replace(/\r/g,'').trim();
}

export function applyQuickText(prompt,plan) {
    const anchor = plan?.textAnchor;
    if (!anchor) return prompt;
    plan.textAnchor = null;
    const contribution = boundContribution(plan.snapshot);
    if (!contribution) return prompt;
    const forms = [anchor,anchor.replace(/\n{2,}/g,'\n')];
    const matched = forms.find(text=>prompt.includes(text) && text.includes(contribution));
    if (!matched) return prompt;
    const index = prompt.lastIndexOf(matched);
    const end = index + matched.lastIndexOf(contribution) + contribution.length;
    const rows = deliveryRows(plan.entries);
    const visible = visibleDirections(rows);
    const direction = privateDirections(rows,plan.entries);
    const assembled = prompt.slice(0,index)+(direction ? direction+'\n\n' : '')+prompt.slice(index,end)+
        (visible ? '\n\n'+visible : '')+prompt.slice(end);
    recordDelivery(plan,rows,'Text Completion');
    plan.confirmed = true;
    return assembled;
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
    const host=ctx(), state=quickChat(), message=host.chat?.at(-1), binding=boundSnapshot(state,message);
    if (!queuedRetry() || !binding) throw new Error('The original player message is no longer the latest message.');
    if (playerContribution(message)!==binding.contribution) throw new Error('The player message was edited. Cancel the old directions and queue them for a new send.');
    if (isGenerating() || retrying) throw new Error('Wait for the current reply to finish.');
    if (queueCapability()) throw new Error(queueCapability());
    if (typeof host.generate !== 'function') throw new Error('This host cannot retry the original message from Quick actions.');
    if (host.groupId && host.mainApi==='openai' && host.chatCompletionSettings?.send_if_empty?.trim()) {
        throw new Error('The host adds a default player message in this group. Clear the host’s Send if empty setting to retry the original message.');
    }
    const retry = {owner:state.owner,binding:binding.id};
    retrying=retry;
    const draft = host.groupId && readComposer();
    if (draft?.text) {
        state.heldRetryDraft=draft;
        saveChatState();
        writeComposer({text:''});
    }
    try {
        // Native solo generation uses the existing player turn and skips processing the unsent composer.
        return await host.generate('normal',{depth:1});
    } finally {
        if (retrying===retry) retrying=null;
        if (quickChatIdentity()===retry.owner) restoreHeldRetryDraft();
    }
}

export function restoreHeldRetryDraft() {
    const state=quickChat(), prior=state?.heldRetryDraft;
    if (!prior) return false;
    const now=readComposer();
    if (!now) return false;
    if (!now.text && writeComposer(prior)) {
        delete state.heldRetryDraft;
        saveChatState();
        return true;
    }
    // Keep this draft recoverable when the player has started another composition.
    state.draftRecovery={value:prior.text,start:prior.start,end:prior.end,direction:prior.direction};
    delete state.heldRetryDraft;
    saveChatState();
    return false;
}

export function reconcileQuickDelivery() {
    const state=quickChat();
    if (!state?.bindings?.length) return;
    const receipts=new Map();
    for (const message of ctx().chat || []) {
        for (const extra of [message.extra,...(message.swipe_info || []).map(item=>item?.extra)]) {
            const receipt=extra?.[KEY]?.quickActions;
            if (receipt?.target && receipt.outcome==='accepted') receipts.set(receipt.target,receipt);
        }
    }
    const accepted=state.bindings.filter(binding=>receipts.has(binding.id));
    if (!accepted.length) return;
    const spent=new Set(accepted.flatMap(binding=>binding.entries.map(entry=>entry.id)));
    state.lastReceipt=structuredClone(receipts.get(accepted.at(-1).id));
    state.pending=state.pending.filter(entry=>!spent.has(entry.id));
    state.bindings=state.bindings.filter(binding=>!receipts.has(binding.id));
    saveChatState();
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
