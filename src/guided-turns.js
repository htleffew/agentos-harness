import { ctx, eventTypes, hasEvent, isGenerating, isReply, KEY, readComposer, restoreReplySnapshot, selectReplyVersion, setReplyVersion, updateReplyVersion, withSingleHostRequest, writeComposer } from './st.js';
import { settings } from './store.js';
import { memoryOnly } from './components.js';
import { guideContinuation, guideSwipe } from './engine.js';
import { isOwnPrompt, request } from './ai.js';
import { amendExecutionReceipt, executionPreview, executionSetting, runAdditional } from './execution.js';
import { draftImpersonation, playerPrompt } from './impersonation.js';
import { cleanGuidedProse, freshGuidance, freshHistoryCapability, guidedContext, guidedDirection, guidedTarget, hasUnscopedMacro, literalGuidedInput, scopedGuidedTemplate, validateGuidedTarget } from './guided-context.js';
import { promptText } from './prompts.js';
import { presetRows } from './preset-workbench.js';
import { timelineDependents } from './reply-world.js';
import { runFactRepair } from './corrections.js';
import { afterReply, liftBlock, syncWorld, undoContinuationEffects } from './worldflow.js';
import { changesFromProfiles, sceneAt, sceneUpdate, storyMinuteAt } from './state.js';
import { defaultWritingGuidance, effectiveModules, enabledV10, prefs, recordMap, sceneCheckPrompt, updateContract } from './v10.js';
import { rememberStoryTimeline } from './story-refresh.js';

export { guidedTarget };

const modelFunctions = { draft: 'playerDraft', choices: 'playerChoices', expand: 'playerExpansion' };
const modes = { swipe: 'Guide a swipe', continue: 'Continue this reply', draft: 'Generate my draft', choices: 'Give me choices', expand: 'Draft from this choice' };
const labels = { substituted: 'Earlier prose replaced with factual context', retained: 'Host retains earlier prose', bounded: 'Selected earlier exchanges included' };
const choiceCount = 3;
let running;

function nativeDraftAvailable(base) {
    const host = ctx();
    return ['prompt', 'blank'].includes(base?.kind) &&
        !executionSetting('playerDraft').profileId && host.mainApi === 'openai' && !host.groupId && host.onlineStatus !== 'no_connection' &&
        typeof host.generate === 'function' && typeof host.stopGeneration === 'function' &&
        typeof host.eventSource?.removeListener === 'function' && hasEvent('CHAT_COMPLETION_PROMPT_READY') && hasEvent('IMPERSONATE_READY');
}

function nativeStoryAvailable(family, target) {
    const host = ctx();
    if (!target?.latest || memoryOnly() || !hasEvent('GENERATION_STARTED') || !hasEvent('MESSAGE_RECEIVED')) return false;
    if (family === 'continue') return typeof host.generate === 'function';
    const message = host.chat?.[target.index];
    if (host.swipe?.isAllowed?.() === false || message?.extra?.swipeable === false || message?.extra?.isSmallSys ||
        message?.extra?.overswipe_behavior && message.extra.overswipe_behavior !== 'regenerate') return false;
    if (target.index === 0 || target.swipe < (message?.swipes?.length || 1) - 1) return typeof host.swipe?.to === 'function' && target.index > 0;
    return typeof host.swipe?.right === 'function';
}

export function guidedPreview(family, { target, freshStart = false, mode = 'draft', fixFacts = false, forceHelper = false } = {}) {
    const host = ctx(), draft = family === 'draft';
    const label = modes[draft ? mode : family];
    const story = family === 'swipe' || family === 'continue';
    const base = draft && draftImpersonation({ mode: 'helper', operation: modelFunctions[mode] });
    const nativeDraft = draft && mode === 'draft' && !forceHelper && nativeDraftAvailable(base);
    const nativeStory = story && nativeStoryAvailable(family, target);
    const operation = draft ? modelFunctions[mode] : nativeStory ? family : family === 'continue' ? 'historicalContinue' : 'historicalSwipe';
    const route = nativeDraft ? 'Native impersonation' : nativeStory ? family === 'swipe' ? 'Host swipe' : 'Host continuation' :
        draft ? 'Player-only helper' : 'Bounded reply helper';
    const history = freshStart ? (nativeStory ? freshHistoryCapability() : 'substituted') : (nativeStory ? 'ordinary' : 'bounded');
    const targetPreview = target && { chatId: target.chatId, index: target.index, swipe: target.swipe,
        fingerprint: target.fingerprint, label: `${target.name} · swipe ${target.swipe + 1}` };
    const execution = executionPreview(operation, { stage: nativeStory ? 'reply' : 'additional', target: targetPreview,
        label, trigger: nativeStory ? 'One ordinary generation for this selected reply.' : undefined });
    let reason = '';
    if (!settings().enabled) reason = 'Turn on Roleplay Instructions before running this action.';
    else if (!host.getCurrentChatId?.()) reason = 'Open a story chat to use this action.';
    else if (story && !target) reason = 'Select a visible character reply first.';
    else if (story && !nativeStory && typeof host.saveChat !== 'function') reason = 'This host cannot save a new version of the selected reply.';
    else if (!nativeStory && !nativeDraft && !execution.profileId && typeof host.generateRaw !== 'function') reason = 'This host does not expose a direct generation route on Main API.';
    else if (execution.problem) reason = execution.problem;
    const dependent = story && target ? timelineDependents(target.index) : null;
    return { ...execution, available: !reason, reason, route, history, historyLabel: labels[history] || 'Host history',
        budget: nativeStory ? 0 : 1, nativeStory, nativeDraft, dependent, fixFacts,
        fallback: story && !nativeStory ? 'The host only generates ordinary requests on its latest supported reply. This helper uses the selected reply’s earlier timeline and saves the result on that reply.' :
            draft && !nativeDraft ? 'This helper sends the player’s perspective on the saved connection. The chat composer retains its current draft.' : '' };
}

const candidateText = value => {
    const text = String(value ?? '').trim().replace(/^(?:\*\*[^*\n]+\*\*\s*[:—-]\s*|(?:choice|option)\s+\d+\s*[:—-]\s*)/i, '').trim();
    if (text.length < 4 || text.length > 4000 || /```|<\/?[a-z][\w_-]*(?:\s[^<>]*|\/?)>|^[\[{]|[\]}]$/i.test(text)) return '';
    const subject = /\b(?:i|we)(?:['’](?:m|ll|d|ve|re)\b|\s+\p{L})/iu;
    const dialogue = /\b(?:my|me|mine|myself|our)\b/i.test(text) && /[.!?]["'’”]*$/.test(text) && text.split(/\s+/).length >= 3;
    return subject.test(text) || dialogue ? text : '';
};

export function parsePlayerChoices(raw) {
    const text = String(raw ?? '').trim();
    const start = text.indexOf('['), stop = text.lastIndexOf(']');
    let values = [];
    if (start >= 0 && stop > start) {
        try {
            const array = JSON.parse(text.slice(start, stop + 1));
            if (Array.isArray(array)) values = array.map(item => typeof item === 'string' ? item : item?.text);
        } catch { /* Other readable response formats are checked next. */ }
    }
    if (!values.length && start >= 0) {
        // A truncated JSON batch can still contain complete, independently readable entries.
        const source = text.slice(start);
        const objects = [...source.matchAll(/"text"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g)];
        const strings = [...source.matchAll(/(?:\[|,)\s*("(?:[^"\\]|\\.)*")\s*(?=[,\]])/g)];
        for (const [, json] of objects.length ? objects : strings) {
            try { values.push(JSON.parse(json)); } catch { /* Keep other complete choices. */ }
        }
    }
    if (!values.length) values = [...text.matchAll(/^\s*(?:[-*•]|\d+[.)])\s+(\S[^\n]*)/gm)].map(match => match[1]);
    const choices = [...new Set(values.map(candidateText).filter(Boolean))].slice(0, choiceCount);
    return { choices, partial: choices.length < choiceCount, raw: text };
}

function playerRequest(mode, route, context, direction, choice, freshStart) {
    const operation = modelFunctions[mode];
    const base = draftImpersonation({ mode: route, operation });
    const boundary = 'Use the active player’s first-person point of view. Use their senses, memories, and information they received. Mark guesses as guesses. Write their own words and voluntary actions, leaving the other characters’ responses open.';
    const task = mode === 'draft' ? '' : playerPrompt(operation, { count: choiceCount }).expanded;
    const format = mode === 'choices' ? `Return a JSON array of ${choiceCount} strings. Each string is one playable first-person action or line of dialogue.` :
        'Return only playable first-person draft prose.';
    const instructions = [base.expanded, boundary, task, format];
    return {
        base, instructions: [...new Set(instructions.filter(Boolean))],
        user: [context.text, freshStart && scopedGuidedTemplate(freshGuidance()), choice && `Selected player choice\n${choice}`,
            direction && `Direction for this draft\n${direction}`].filter(Boolean).join('\n\n'),
    };
}

async function nativePlayerDraft(prompt, options) {
    const host = ctx(), chat = host.chat, events = eventTypes(), source = host.eventSource;
    const snapshot = readComposer();
    return runAdditional('playerDraft', { ...options, mainOnly: true }, async ({ receipt }) => {
        receipt.route = 'Native impersonation';
        receipt.history = { mode: 'substituted', observed: false };
        const expected = prompt.base.expanded || '';
        let observed = false, mismatch = false, output = '', switched = false;
        const cancel = () => { switched = true; host.stopGeneration(); };
        const restore = value => {
            output = String(value || '');
            if (ctx().chat === chat) writeComposer(snapshot);
        };
        const prepare = data => {
            if (data.dryRun || !Array.isArray(data.chat) || isOwnPrompt(data.chat)) return;
            const full = data.chat.filter(message => message.role === 'system').map(message => message.content).join('\n');
            mismatch = !!expected && !full.includes(expected);
            const system = prompt.instructions.filter(instruction => instruction !== expected || !mismatch).join('\n\n');
            // Replace the native character context before delivery. Only the observed
            // preset impersonation field is reused, with independently bounded player data.
            data.chat.splice(0, data.chat.length, { role: 'system', content: system }, { role: 'user', content: prompt.user });
            observed = true;
            receipt.history.observed = !mismatch;
            if (mismatch || switched || options.signal?.aborted) host.stopGeneration();
        };
        const handlers = [[events.CHAT_COMPLETION_PROMPT_READY, prepare], [events.IMPERSONATE_READY, restore], [events.CHAT_CHANGED, cancel]].filter(([event]) => event);
        for (const [event, handler] of handlers) source.on(event, handler);
        try {
            try { await withSingleHostRequest(() => host.generate('impersonate', { skipWIAN: true, depth: 1 })); }
            catch (cause) {
                if (!observed || mismatch) receipt.attempts = 0;
                options.signal?.throwIfAborted();
                const current = readComposer()?.text;
                if (!mismatch) throw Object.assign(cause instanceof Error ? cause : new Error(String(cause)), {
                    partialText: ctx().chat === chat && current !== snapshot?.text ? current : '',
                });
            }
            if (!observed || mismatch) receipt.attempts = 0;
            options.signal?.throwIfAborted();
            if (switched || ctx().chat !== chat) throw new DOMException('The chat changed during drafting.', 'AbortError');
            if (!observed || mismatch) throw Object.assign(new Error('The host impersonation prompt could not be verified. Retry through the player-only helper.'),
                { code: 'native-impersonation-unverified' });
            if (!output.trim()) throw new Error('The model returned an empty draft. Run the action again to retry.');
            return output;
        } finally {
            for (const [event, handler] of handlers) source.removeListener(event, handler);
            if (ctx().chat === chat) writeComposer(snapshot);
        }
    });
}

async function runPlayer(preview, context, options) {
    const { mode, target, direction, choice, freshStart, onReceipt, chat, signal } = options;
    if (mode === 'expand' && !String(choice ?? '').trim()) throw new Error('Select wording to expand first.');
    const payload = playerRequest(mode, preview.nativeDraft ? 'native' : 'helper', context, direction, choice, freshStart);
    const callOptions = { authorization: 'manual', target: preview.target, onReceipt, signal };
    let raw, note, receipt;
    if (preview.nativeDraft) ({ value: raw, receipt } = await nativePlayerDraft(payload, callOptions));
    else ({ text: raw, note, receipt } = await request({ ...callOptions, operation: preview.operation, what: preview.label,
        system: literalGuidedInput(payload.instructions.join('\n\n')), user: literalGuidedInput(payload.user),
        tokens: mode === 'choices' ? 900 : 650, useProfilePreset: false }));
    const details = { route: preview.route, history: receipt.history || { mode: preview.history, observed: true } };
    try {
        signal.throwIfAborted();
        // A helper result is an editable draft owned by the originating chat.
        // The sheet retains it in that editor even when another chat is open.
        if (ctx().chat === chat && target) validateGuidedTarget(target);
    } catch (error) {
        amendExecutionReceipt(receipt, { ...details, outcome: 'cancelled', result: error.message, partialText: raw }, onReceipt);
        note?.(error.message, false);
        throw Object.assign(error, { receipt });
    }
    if (mode === 'choices') {
        const result = parsePlayerChoices(raw);
        const ok = result.choices.length > 0;
        amendExecutionReceipt(receipt, { ...details, result: `${result.choices.length} of ${choiceCount} playable choices.`,
            ...(!ok && { outcome: 'failed', partialText: raw }) }, onReceipt);
        note?.(receipt.result, ok);
        return { ok, receipt, ...result };
    }
    const text = candidateText(cleanGuidedProse(raw));
    amendExecutionReceipt(receipt, { ...details, result: text ? 'One player draft is ready.' : 'The response needs manual editing before it can be used.',
        ...(!text && { outcome: 'failed', partialText: raw }) }, onReceipt);
    note?.(receipt.result, !!text);
    return { ok: !!text, receipt, text, raw, partial: !text };
}

function historicalSystem(family, context, modules) {
    const configured = ctx().mainApi === 'openai' ? presetRows().filter(row => row.enabled && !row.marker && row.role === 'system' &&
        !hasUnscopedMacro(row.content) && (!row.triggers.length || row.triggers.includes(family))).map(row => row.content) : [];
    const behavior = promptText(family === 'continue' ? 'historicalContinue' : 'historicalSwipe');
    return [...configured, behavior, modules.style && (prefs()?.style ?? defaultWritingGuidance()),
        sceneCheckPrompt(context.scene, { modules, type: family }), updateContract(modules)].filter(Boolean).map(scopedGuidedTemplate).join('\n\n');
}

async function applyHistorical(family, target, output, context, modules, { roll, direction, history }) {
    validateGuidedTarget(target);
    const host = ctx(), chat = host.chat, { index } = target, append = family === 'continue';
    const { message, before } = setReplyVersion(index, output, { append });
    let appliedMark;
    try {
        const parsed = liftBlock(index, false, modules), earlier = append ? before.extra?.[KEY] : null;
        let text = cleanGuidedProse(message.mes);
        const prefix = append && cleanGuidedProse(target.text);
        if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length).trimStart();
        if (!text) throw new Error('The response contained no playable story prose.');
        message.mes = append ? `${target.text}${/\s$/.test(target.text) ? '' : '\n\n'}${text}` : text;
        const rec = { ...earlier, v: 1, v10: enabledV10(), time: earlier?.time || Date.now(), type: family,
            scene: { ...sceneAt(index), ...earlier?.scene, ...sceneUpdate(parsed.scene) }, items: earlier?.items || [],
            profiles: parsed.profiles?.length ? parsed.profiles : earlier?.profiles || [],
            stateChanges: [...(earlier?.stateChanges || []), ...changesFromProfiles(parsed.profiles || [])],
            v10Minutes: parsed.minutes ?? earlier?.v10Minutes ?? storyMinuteAt(index),
            v10SceneId: earlier?.v10SceneId ?? chat[index - 1]?.extra?.[KEY]?.v10SceneId,
            guided: { historical: true, direction, history, ...(roll && { roll: structuredClone(roll) }) },
        };
        message.extra[KEY] = rec;
        updateReplyVersion(index);
        appliedMark = guidedTarget(index)?.fingerprint;
        await host.saveChat?.();
        if (ctx().chat === chat && chat[index] === message) {
            rememberStoryTimeline();
            const records = context.world.rows?.length ? recordMap(context.world.rows) : new Map((context.world.records || []).map(record => [record.id, record]));
            await afterReply(index, rec, parsed, chat.slice(1, index + 1).filter(isReply).length, null,
                { v10: { modules, records }, historical: true, prior: before.extra?.[KEY], propagate: true });
            if (ctx().chat === chat) {
                updateReplyVersion(index);
                await host.saveChat?.();
                const event = eventTypes().MESSAGE_SWIPED;
                if (event) await host.eventSource?.emit(event, index);
            }
        }
        return before;
    } catch (error) {
        if (ctx().chat === chat && chat[index] === message && (!appliedMark || guidedTarget(index)?.fingerprint === appliedMark)) {
            restoreReplySnapshot(index, before, message);
            rememberStoryTimeline();
            await host.saveChat?.();
            await syncWorld();
        }
        throw error;
    }
}

async function runHistorical(family, preview, context, { target, direction, freshStart, onReceipt, chat, roll, signal }) {
    const modules = { ...effectiveModules(), roast: false, roastFeedback: false };
    const prose = cleanGuidedProse(target.text);
    const user = [context.text, family === 'continue' && `Passage to continue\n${prose}`,
        family === 'swipe' && !freshStart && `Version to revise\n${prose}`,
        freshStart && scopedGuidedTemplate(freshGuidance()), direction && `Direction for this reply\n${direction}`].filter(Boolean).join('\n\n');
    const result = await request({ operation: preview.operation, what: preview.label, authorization: 'manual', target: preview.target,
        system: literalGuidedInput(historicalSystem(family, context, modules)), user: literalGuidedInput(user),
        tokens: 1000, onReceipt, useProfilePreset: false, signal });
    try {
        signal.throwIfAborted();
        if (ctx().chat !== chat) throw new DOMException('The chat changed during generation.', 'AbortError');
        const before = await applyHistorical(family, target, result.text, context, modules, { roll, direction, history: preview.history });
        amendExecutionReceipt(result.receipt, { route: preview.route, history: { mode: preview.history, observed: true },
            result: 'Saved on the selected reply.' }, onReceipt);
        return { ok: true, receipt: result.receipt, before };
    } catch (error) {
        const receipt = result.receipt;
        amendExecutionReceipt(receipt, { route: preview.route, outcome: error.name === 'AbortError' ? 'cancelled' : 'failed',
            result: error.message, partialText: result.text }, onReceipt);
        result.note(error.message, false);
        throw Object.assign(error, { receipt });
    }
}

async function runNativeStory(family, preview, context, { target, direction, freshStart, onReceipt, repeatOrders, rerollDice, keepManualEdits, repair, roll, signal }) {
    const receipt = { ...preview, chat: target.chatId, authorization: 'manual', attempts: 0, outcome: 'running', result: '' };
    onReceipt?.(receipt);
    try {
        const options = { target, freshStart, facts: context.facts, waitForResult: true, receipt, repeatOrders: repeatOrders && !freshStart,
            rerollDice, keepManualEdits: keepManualEdits || !!repair?.correction, correction: repair?.correction, roll, signal };
        const result = family === 'continue' ? await guideContinuation(direction, options) : await guideSwipe(direction, options);
        if (!result.accepted) signal.throwIfAborted();
        if (!result.accepted) throw new Error('No generated version was accepted. Retry on the same reply or choose a new target.');
        receipt.outcome = 'completed';
        receipt.result = 'Saved on the selected reply.';
        onReceipt?.(receipt);
        return { ok: true, receipt, before: result.before };
    } catch (error) {
        receipt.outcome = error.name === 'AbortError' ? 'cancelled' : 'failed';
        receipt.result = error.message;
        onReceipt?.(receipt);
        throw Object.assign(error, { receipt });
    }
}

export async function runGuidedTurn(family, { target = guidedTarget(), cues = [], direction = '', freshStart = false, mode = 'draft',
    composer = readComposer()?.text ?? '', choice = '', fixFacts = false, repairOnly = false, repair, repeatOrders = false,
    rerollDice = false, keepManualEdits = false, quickCheck = '', roll, forceHelper = false, onReceipt } = {}) {
    if (!['swipe', 'continue', 'draft'].includes(family)) throw new Error('Select a guided reply action.');
    const host = ctx(), chat = host.chat;
    const preview = guidedPreview(family, { target, mode, freshStart, fixFacts, forceHelper });
    if (!preview.available && !repairOnly) throw new Error(preview.reason);
    if (isGenerating() || running) throw new Error('Wait for the current guided action to finish.');
    if (target) validateGuidedTarget(target);
    const controller = new AbortController();
    const signal = controller.signal;
    running = { chat, controller, native: preview.nativeStory || preview.nativeDraft, profile: !!preview.profileId, dispatching: false };
    try {
        if ((fixFacts || repairOnly || cues.some(cue => cue?.operation === 'repair')) && !repair) {
            if (!target) throw new Error('Select a reply to repair.');
            repair = await runFactRepair({ focus: target.index, truth: direction, direction: true });
        }
        if (repairOnly) return { ok: true, repair, receipt: { ...executionPreview('factRepair', { stage: 'code', target: preview.target }), attempts: 0, outcome: 'completed' } };
        if (target) validateGuidedTarget(target);
        const combined = guidedDirection([...cues, quickCheck || roll?.text], direction);
        const correction = repair?.correction?.truth;
        const complete = [combined, correction && !combined.includes(correction) && `${promptText('correctionCanon')} ${correction}`].filter(Boolean).join('\n\n');
        const context = await guidedContext({ family, target, freshStart, fragment: family === 'draft' ? composer : '' });
        signal.throwIfAborted();
        running.dispatching = true;
        const options = { target, direction: complete, freshStart, mode, choice, onReceipt, repair, repeatOrders, rerollDice, keepManualEdits, chat, roll, signal };
        if (family === 'draft') return await runPlayer(preview, context, options);
        const defaultDirection = 'Write a new version of this reply from the current point in the story.';
        const result = preview.nativeStory ? await runNativeStory(family, preview, context, { ...options,
            direction: complete || (family === 'swipe' ? defaultDirection : '') }) : await runHistorical(family, preview, context, options);
        if (family === 'continue' && ctx().chat === chat) {
            result.undo = { before: result.before, target: guidedTarget(target.index) };
        }
        delete result.before;
        return { ...result, repair };
    } catch (error) {
        if (repair) error.repair = repair;
        throw error;
    } finally { running = null; }
}

export function cancelGuidedTurn() {
    if (!running || running.chat !== ctx().chat) return '';
    if (running.controller.signal.aborted) return '';
    running.controller.abort(new DOMException('The guided action was cancelled.', 'AbortError'));
    if (!running.dispatching) return 'Cancelled before the model request.';
    if (running.native) {
        ctx().stopGeneration?.();
        return 'Stopping the host generation.';
    }
    if (running.profile) return 'Stopping the guided request.';
    return 'The result will be discarded. Main API may finish the request.';
}

export async function undoGuidedContinuation(undo) {
    if (!undo?.target || !undo.before) throw new Error('No continuation is available to undo.');
    const target = validateGuidedTarget(undo.target);
    if (isGenerating()) throw new Error('Wait for the current generation to finish.');
    const host = ctx(), message = host.chat[target.index];
    await undoContinuationEffects(target.index, undo.before.extra?.[KEY], target.fingerprint);
    validateGuidedTarget(target);
    if (!restoreReplySnapshot(target.index, undo.before, message)) throw new Error('The selected reply changed.');
    await host.saveChat?.();
    await syncWorld();
    const event = eventTypes().MESSAGE_SWIPED;
    if (event && ctx().chat === host.chat) await host.eventSource?.emit(event, target.index);
}

export function guidedVersions(target) {
    if (!target) return [];
    const message = ctx().chat?.[target.index];
    return (message?.swipes || []).flatMap((text, swipe) => typeof text === 'string' && text.trim() ?
        [{ swipe, text: cleanGuidedProse(text) }] : []);
}

export async function selectGuidedVersion(target, swipe) {
    validateGuidedTarget(target);
    if (isGenerating()) throw new Error('Wait for the current generation to finish.');
    const host = ctx(), chat = host.chat, message = chat[target.index], before = structuredClone(message);
    if (!Number.isInteger(swipe)) throw new Error('Select a swipe.');
    try {
        selectReplyVersion(target.index, swipe);
        await host.saveChat?.();
    } catch (error) {
        if (ctx().chat === chat) restoreReplySnapshot(target.index, before, message);
        throw error;
    }
    if (ctx().chat !== chat) throw new Error('The chat changed while switching swipes.');
    const event = eventTypes().MESSAGE_SWIPED;
    if (event) await host.eventSource?.emit(event, target.index);
    return guidedTarget(target.index);
}
