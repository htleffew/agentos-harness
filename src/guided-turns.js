import { ctx, eventTypes, hasEvent, isGenerating, isReply, KEY, readComposer, restoreReplySnapshot, selectReplyVersion, setReplyVersion, updateReplyVersion, withSingleHostRequest, writeComposer } from './st.js';
import { settings } from './store.js';
import { memoryOnly } from './components.js';
import { guideContinuation, guideSwipe } from './engine.js';
import { isOwnPrompt, request } from './ai.js';
import { amendExecutionReceipt, executionPreview, executionScope, executionSetting, runAdditional } from './execution.js';
import { draftImpersonation, playerPrompt } from './impersonation.js';
import { cleanGuidedProse, freshGuidance, freshHistoryCapability, guidedContext, guidedDirection, guidedTarget as readGuidedTarget, hasUnscopedMacro, literalGuidedInput, scopedGuidedTemplate, validateGuidedTarget } from './guided-context.js';
import { promptText } from './prompts.js';
import { presetRows } from './preset-workbench.js';
import { timelineDependents } from './reply-world.js';
import { runFactRepair } from './corrections.js';
import { afterReply, liftBlock, syncWorld, undoContinuationEffects } from './worldflow.js';
import { changesFromProfiles, sceneAt, sceneUpdate, storyMinuteAt } from './state.js';
import { defaultWritingGuidance, effectiveModules, enabledV10, prefs, recordMap, sceneCheckPrompt, replyExtras } from './v10.js';
import { rememberStoryTimeline } from './story-refresh.js';

const modelFunctions = { draft: 'playerDraft', choices: 'playerChoices', expand: 'playerExpansion' };
const modes = { swipe: 'Guide a swipe', continue: 'Continue this reply', draft: 'Generate my draft', choices: 'Give me choices', expand: 'Draft from this choice' };
const labels = { substituted: 'Earlier prose replaced with factual context', retained: 'Host retains earlier prose', bounded: 'Selected earlier exchanges included' };
const choiceCount = 3;
let running;

// Hosts can reuse the same chat array on a switch. The scoped identity
// distinguishes its contents and the array guard still detects replacement.
const chatOwner = () => ({ chat: ctx().chat, scope: executionScope() });
const ownsChat = owner => ctx().chat === owner.chat && executionScope() === owner.scope;

export function guidedTarget(index) {
    const target = readGuidedTarget(index);
    return target && { ...target, scope: executionScope() };
}

function validateTurnTarget(target) {
    if (target?.scope && target.scope !== executionScope()) throw new Error('The selected reply belongs to a different chat.');
    return validateGuidedTarget(target);
}

function nativeDraftAvailable(base) {
    const host = ctx();
    return ['prompt', 'blank'].includes(base?.kind) &&
        !executionSetting('playerDraft').profileId && !executionSetting('playerDraft').fallback && host.mainApi === 'openai' && !host.groupId && host.onlineStatus !== 'no_connection' &&
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

export function guidedPreview(family, { target, freshStart = false, mode = 'draft', fixFacts = false, forceHelper = false, suggestions } = {}) {
    const host = ctx(), draft = family === 'draft';
    const label = suggestions?.label || modes[draft ? mode : family];
    const story = family === 'swipe' || family === 'continue';
    const base = draft && draftImpersonation({ mode: 'helper', operation: modelFunctions[mode] });
    const nativeDraft = draft && mode === 'draft' && !forceHelper && nativeDraftAvailable(base);
    const nativeStory = story && nativeStoryAvailable(family, target);
    const operation = draft ? modelFunctions[mode] : nativeStory ? family : family === 'continue' ? 'historicalContinue' : 'historicalSwipe';
    const route = nativeDraft ? 'Native impersonation' : nativeStory ? family === 'swipe' ? 'Host swipe' : 'Host continuation' :
        suggestions ? 'Composer suggestions' : draft ? 'Player-only helper' : 'Bounded reply helper';
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

const firstPersonSubject = /\b(?:i|we)(?:['’](?:m|ll|d|ve|re)\b|\s+\p{L})/iu;
const sentenceEnd = /[.!?…]["'’”)\]*_]*$/u;

const candidateText = (value, { line = false } = {}) => {
    let text = typeof value === 'string' ? value.trim() : '';
    const heading = text.match(/^(\*\*[^*\n]{1,75}\*\*|[^:\n—–]{1,75})\s*[:—–]\s+(\S[\s\S]*)$/u);
    if (heading && !firstPersonSubject.test(heading[1]) && firstPersonSubject.test(heading[2])) text = heading[2];
    if (text.length < 4 || text.length > 4000 || /```|<\/?[a-z][\w_-]*(?:\s[^<>]*|\/?)>|^[\[{]|[\]}]$/i.test(text)) return '';
    // A plain list has no JSON string boundary. A complete sentence is a
    // conservative way to retain earlier bullets from a cut-off answer.
    if (line && !sentenceEnd.test(text)) return '';
    const dialogue = /\b(?:my|me|mine|myself|our)\b/i.test(text) && sentenceEnd.test(text) && text.split(/\s+/).length >= 3;
    return firstPersonSubject.test(text) || dialogue ? text : '';
};

export function parsePlayerChoices(raw, count = choiceCount) {
    const text = String(raw ?? '').trim();
    const start = text.indexOf('['), stop = text.lastIndexOf(']');
    let values = [];
    let repaired = false;
    const wording = item => typeof item === 'string' ? item : item?.text;
    if (start >= 0 && stop > start) {
        try {
            const array = JSON.parse(text.slice(start, stop + 1));
            if (Array.isArray(array)) values = array.map(wording);
        } catch { /* Other readable response formats are checked next. */ }
    }
    if (!values.length && start >= 0) {
        // A truncated JSON batch can still contain complete, independently readable entries.
        const source = text.slice(start + 1);
        const entries = source.matchAll(/(?:^|,)\s*("(?:[^"\\]|\\.)*"|\{(?:[^"{}]|"(?:[^"\\]|\\.)*")*\})\s*(?=,|\]|$)/g);
        for (const [, json] of entries) {
            try { values.push(wording(JSON.parse(json))); } catch { /* Keep other complete choices. */ }
        }
        repaired = values.length > 0;
    }
    const line = !values.length;
    if (line) values = [...text.matchAll(/^[ \t]*(?:[-*•]|\d+[.)]|\(\d+\))[ \t]+(\S[^\n]*)/gm)].map(match => match[1]);
    const choices = [...new Set(values.map(value => candidateText(value, { line })).filter(Boolean))].slice(0, count);
    return { choices, partial: repaired || choices.length < count || values.length > choices.length, raw: text };
}

// Titled options for the composer bar's Options kind (DESIGN.md 4.4). The model returns objects with a
// title and a body; anything else it sends is read as well as it can be, and nothing that is only a
// separator or only a title reaches the message box.
const DASHES = '\\-\u2010-\u2015\u2212';
const separatorLine = new RegExp(`^[ \\t]*(?:[${DASHES}_*=~#.\u00b7\u2022|][ \\t]*){3,}$`, 'gmu');
const separatorOnly = new RegExp(`^[\\s${DASHES}_*=~#.\u00b7\u2022|:;,]*$`, 'u');
const pictograph = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]/gu;
const optionTitleKeys = ['title', 'name', 'label', 'heading'];
const optionTextKeys = ['text', 'body', 'description', 'content', 'option'];

function optionTitle(value) {
    return String(value ?? '').replace(pictograph, '').replace(/^[\s#>*_"'\u201c\u2018]+|[\s*_"'\u201d\u2019:]+$/gu, '')
        .replace(/^(?:\d+[.)]|\(\d+\)|option\s+\d+[.:)]?)\s*/iu, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function optionBody(value, title = '') {
    let text = String(value ?? '').replace(/\r\n?/g, '\n').replace(separatorLine, '').trim();
    // A body that repeats its own title as the first line keeps only the body.
    if (title) {
        const first = text.split('\n', 1)[0];
        if (optionTitle(first).toLowerCase() === title.toLowerCase()) text = text.slice(first.length).trim();
    }
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return separatorOnly.test(text) ? '' : text;
}

const decodeJsonString = value => {
    try { return JSON.parse(`"${value.replace(/\\$/, '')}"`); } catch { return value; }
};

/** Split a plain-text block into a title and a body: "Title: body", "**Title** body" or a short first line. */
function splitTitled(block) {
    const text = String(block ?? '').trim().replace(/^(?:[-*\u2022]|\d+[.)]|\(\d+\))[ \t]+/u, '');
    const bold = text.match(new RegExp(`^\\*\\*([^*\\n]{1,80})\\*\\*[ \\t]*(?:[:${DASHES}][ \\t]*)?([\\s\\S]*)$`, 'u'));
    if (bold) return { title: bold[1], text: bold[2] };
    const lines = text.split('\n');
    if (lines.length > 1 && lines[0].length <= 80 && !/[.!?]["'\u201d)]*$/u.test(lines[0].trim())) {
        return { title: lines[0], text: lines.slice(1).join('\n') };
    }
    const colon = text.match(new RegExp(`^([^:\\n${DASHES.replace('\\-', '')}]{1,60}?)[ \\t]*(?::|[ \\t][\u2013\u2014][ \\t])[ \\t]*(\\S[\\s\\S]*)$`, 'u'));
    if (colon && colon[1].split(/\s+/).length <= 8) return { title: colon[1], text: colon[2] };
    return { title: '', text };
}

function optionFrom(item, cut = false) {
    if (typeof item === 'string') return optionFrom({ ...splitTitled(item) }, cut);
    if (!item || typeof item !== 'object') return null;
    const pick = keys => keys.map(key => item[key]).find(value => typeof value === 'string' && value.trim());
    const title = optionTitle(pick(optionTitleKeys));
    const text = optionBody(pick(optionTextKeys), title);
    if (!title && !text) return null;
    const ended = /[.!?\u2026]["'\u2019\u201d)\]*_]*$/u.test(text);
    return { title, text, incomplete: !text || (cut && !ended) };
}

/**
 * Read a model's Options answer into titled options. Each option is { title, text, incomplete }:
 * a title-only leftover keeps its title with empty text and is marked incomplete, and an option cut off
 * mid-sentence by a truncated answer is marked incomplete. Separator fragments are dropped.
 */
export function parseOptions(raw, count = 4) {
    const text = String(raw ?? '').replace(/```(?:json)?/gi, '').trim();
    const start = text.indexOf('['), stop = text.lastIndexOf(']');
    let options = [];
    let salvaged = false;
    if (start >= 0 && stop > start) {
        try {
            const array = JSON.parse(text.slice(start, stop + 1));
            if (Array.isArray(array)) options = array.map(item => optionFrom(item));
        } catch { /* A truncated answer is salvaged below. */ }
    }
    if (!options.length && start >= 0) {
        salvaged = true;
        const source = text.slice(start + 1);
        let end = 0;
        for (const match of source.matchAll(/(?:^|,)\s*("(?:[^"\\]|\\.)*"|\{(?:[^"{}]|"(?:[^"\\]|\\.)*")*\})\s*(?=,|\]|$)/g)) {
            try { options.push(optionFrom(JSON.parse(match[1]))); end = match.index + match[0].length; } catch { /* Keep the other complete options. */ }
        }
        // The object the answer stopped inside: its title, and any text it reached, marked incomplete.
        const rest = source.slice(end);
        const field = keys => {
            for (const key of keys) {
                const found = rest.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
                if (found) return decodeJsonString(found[1]);
            }
            return '';
        };
        const tail = optionFrom({ title: field(optionTitleKeys), text: field(optionTextKeys) }, true);
        if (tail) options.push({ ...tail, incomplete: true });
    }
    if (!options.length && start < 0) {
        const blocks = /\n[ \t]*\n|^[ \t]*(?:[-*\u2022]|\d+[.)]|\(\d+\))[ \t]/m.test(text) ?
            text.replace(separatorLine, '\n\n').split(/\n[ \t]*\n|\n(?=[ \t]*(?:[-*\u2022]|\d+[.)]|\(\d+\))[ \t])/u) : [text];
        options = blocks.map(block => optionFrom(block));
    }
    const seen = new Set();
    const unique = options.filter(option => {
        if (!option) return false;
        const key = (option.text || option.title).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, count);
    return { options: unique, partial: salvaged || unique.length < count || unique.some(option => option.incomplete), raw: text };
}

/** The format line of an Options request: titled objects, so each option reaches the sheet with a name. */
export const optionsFormat = count => `Return a JSON array of exactly ${count} distinct objects. Give each object a "title" that names the option in two to six words and a "text" that holds the option itself.`;

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
    const host = ctx(), owner = chatOwner(), events = eventTypes(), source = host.eventSource;
    const snapshot = readComposer();
    return runAdditional('playerDraft', { ...options, mainOnly: true }, async ({ receipt }) => {
        receipt.route = 'Native impersonation';
        receipt.history = { mode: 'substituted', observed: false };
        const expected = prompt.base.expanded || '';
        let observed = false, mismatch = false, output = '', received = '', switched = false;
        const canRestore = () => !switched && ownsChat(owner);
        const cancel = () => {
            if (canRestore() || switched) return;
            switched = true;
            host.stopGeneration();
        };
        const stream = value => {
            if (observed && !mismatch && canRestore() && typeof value === 'string') received = value;
        };
        const partialText = () => {
            if (!canRestore() || !observed || mismatch) return '';
            const current = readComposer()?.text;
            return received || (current !== snapshot?.text ? current : '') || '';
        };
        const restore = value => {
            if (!canRestore()) return;
            output = String(value || '');
            writeComposer(snapshot);
        };
        const prepare = data => {
            if (data.dryRun || !Array.isArray(data.chat) || isOwnPrompt(data.chat)) return;
            if (!canRestore()) {
                cancel();
                return;
            }
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
        const handlers = [[events.CHAT_COMPLETION_PROMPT_READY, prepare], [events.STREAM_TOKEN_RECEIVED, stream],
            [events.IMPERSONATE_READY, restore], [events.CHAT_CHANGED, cancel]].filter(([event]) => event);
        for (const [event, handler] of handlers) source.on(event, handler);
        try {
            try { await withSingleHostRequest(() => host.generate('impersonate', { skipWIAN: true, depth: 1 })); }
            catch (cause) {
                if (!observed || mismatch) receipt.attempts = 0;
                options.signal?.throwIfAborted();
                if (!canRestore()) throw new DOMException('The chat changed during drafting.', 'AbortError');
                if (!mismatch) throw Object.assign(cause instanceof Error ? cause : new Error(String(cause)), {
                    partialText:partialText(),
                });
            }
            if (!observed || mismatch) receipt.attempts = 0;
            options.signal?.throwIfAborted();
            if (!canRestore()) throw new DOMException('The chat changed during drafting.', 'AbortError');
            if (!observed || mismatch) throw Object.assign(new Error('The host impersonation prompt could not be verified. Retry through the player-only helper.'),
                { code: 'native-impersonation-unverified' });
            if (!output.trim()) {
                const partial = partialText();
                if (partial.trim()) throw Object.assign(new Error('The stream stopped before the draft finished. Review the partial text or retry.'),{partialText:partial});
                throw new Error('The model returned an empty draft. Run the action again to retry.');
            }
            return output;
        } finally {
            for (const [event, handler] of handlers) source.removeListener(event, handler);
            if (canRestore()) writeComposer(snapshot);
        }
    });
}

async function runPlayer(preview, context, options) {
    const { mode, target, direction, choice, freshStart, onReceipt, owner, signal, suggestions } = options;
    if (mode === 'expand' && !String(choice ?? '').trim()) throw new Error('Select wording to expand first.');
    const count = suggestions?.count || choiceCount;
    const payload = suggestions ? {
        instructions:[suggestions.prompt, optionsFormat(count)],
        user:[context.text,direction].filter(Boolean).join('\n\n'),
    } : playerRequest(mode, preview.nativeDraft ? 'native' : 'helper', context, direction, choice, freshStart);
    const callOptions = { authorization: 'manual', target: preview.target, onReceipt, signal };
    let raw, note, receipt;
    if (preview.nativeDraft) ({ value: raw, receipt } = await nativePlayerDraft(payload, callOptions));
    else ({ text: raw, note, receipt } = await request({ ...callOptions, operation: preview.operation, what: preview.label,
        system: literalGuidedInput(payload.instructions.join('\n\n')), user: literalGuidedInput(payload.user),
        tokens: suggestions ? Math.max(900,count * 250) : mode === 'choices' ? 900 : 650, useProfilePreset: false }));
    const details = { route: preview.route, history: receipt.history || { mode: preview.history, observed: true } };
    try {
        signal.throwIfAborted();
        // A helper result is an editable draft owned by the originating chat.
        // The sheet retains it in that editor even when another chat is open.
        if (ownsChat(owner) && target) validateTurnTarget(target);
    } catch (error) {
        amendExecutionReceipt(receipt, { ...details, outcome: 'cancelled', result: error.message, partialText: raw }, onReceipt);
        note?.(error.message, false);
        throw Object.assign(error, { receipt });
    }
    if (suggestions) {
        const result = parseOptions(raw,count);
        const usable = result.options.filter(option => option.text).length;
        const ok = usable > 0;
        amendExecutionReceipt(receipt, { ...details, result: `${usable} of ${count} options.`,
            ...(!ok && { outcome: 'failed', partialText: raw }) }, onReceipt);
        note?.(receipt.result, ok);
        return { ok, receipt, choices: result.options, partial: result.partial, raw: result.raw };
    }
    if (mode === 'choices') {
        const result = parsePlayerChoices(raw,count);
        const ok = result.choices.length > 0;
        amendExecutionReceipt(receipt, { ...details, result: `${result.choices.length} of ${count} playable choices.`,
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
        sceneCheckPrompt(context.scene, { modules, type: family }), replyExtras(modules)].filter(Boolean).map(scopedGuidedTemplate).join('\n\n');
}

function selectedSourceLabels(cues) {
    const labels = new Map();
    for (const source of cues.flatMap(cue => Array.isArray(cue?.sources) ? cue.sources : [])) {
        if (!source?.book || source.uid == null) continue;
        const item = { book: source.book, title: source.title, set: source.set, uid: source.uid };
        labels.set(JSON.stringify(item), item);
    }
    return [...labels.values()];
}

async function applyHistorical(family, target, output, context, modules, { owner, roll, direction, history, additionalSources }) {
    validateTurnTarget(target);
    const host = ctx(), { chat } = owner, { index } = target, append = family === 'continue';
    const { message, before } = setReplyVersion(index, output, { append });
    const isCurrent = () => ownsChat(owner) && chat[index] === message;
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
            guided: { historical: true, direction, history, additionalSources, ...(roll && { roll: structuredClone(roll) }) },
        };
        message.extra[KEY] = rec;
        updateReplyVersion(index);
        appliedMark = guidedTarget(index)?.fingerprint;
        await host.saveChat?.();
        if (isCurrent()) {
            rememberStoryTimeline();
            const records = context.world.rows?.length ? recordMap(context.world.rows) : new Map((context.world.records || []).map(record => [record.id, record]));
            await afterReply(index, rec, parsed, chat.slice(1, index + 1).filter(isReply).length, null,
                { v10: { modules, records }, historical: true, prior: before.extra?.[KEY], propagate: true });
            if (isCurrent() && message.extra?.[KEY] === rec) {
                updateReplyVersion(index);
                await host.saveChat?.();
                const event = eventTypes().MESSAGE_SWIPED;
                if (event && isCurrent()) await host.eventSource?.emit(event, index);
            }
        }
        return before;
    } catch (error) {
        if (isCurrent() && (!appliedMark || guidedTarget(index)?.fingerprint === appliedMark)) {
            restoreReplySnapshot(index, before, message);
            rememberStoryTimeline();
            await host.saveChat?.();
            if (isCurrent()) await syncWorld();
        }
        throw error;
    }
}

async function runHistorical(family, preview, context, { target, direction, freshStart, onReceipt, owner, roll, signal, cues }) {
    const modules = { ...effectiveModules(), roast: false, roastFeedback: false };
    const additionalSources = selectedSourceLabels(cues);
    const prose = cleanGuidedProse(target.text);
    const user = [context.text, family === 'continue' && `Passage to continue\n${prose}`,
        family === 'swipe' && !freshStart && `Version to revise\n${prose}`,
        freshStart && scopedGuidedTemplate(freshGuidance()), direction && `Direction for this reply\n${direction}`].filter(Boolean).join('\n\n');
    let result;
    try {
        result = await request({ operation: preview.operation, what: preview.label, authorization: 'manual', target: preview.target,
            system: literalGuidedInput(historicalSystem(family, context, modules)), user: literalGuidedInput(user),
            tokens: 1000, onReceipt, useProfilePreset: false, signal });
        signal.throwIfAborted();
        if (!ownsChat(owner)) throw new DOMException('The chat changed during generation.', 'AbortError');
        const before = await applyHistorical(family, target, result.text, context, modules,
            { owner, roll, direction, history: preview.history, additionalSources });
        amendExecutionReceipt(result.receipt, { route: preview.route, history: { mode: preview.history, observed: true },
            additionalSources, result: 'Saved on the selected reply.' }, onReceipt);
        return { ok: true, receipt: result.receipt, before };
    } catch (error) {
        const receipt = result?.receipt || error.receipt;
        if (!receipt) throw error;
        const change = { route: preview.route, additionalSources };
        if (result) {
            Object.assign(change, { outcome: error.name === 'AbortError' ? 'cancelled' : 'failed', result: error.message, partialText: result.text });
            result.note(error.message, false);
        }
        amendExecutionReceipt(receipt, change, onReceipt);
        throw Object.assign(error, { receipt });
    }
}

async function runNativeStory(family, preview, context, { target, direction, freshStart, onReceipt, repeatOrders, rerollDice, keepManualEdits, repair, roll, signal, owner }) {
    const receipt = { ...preview, chat: target.chatId, scope: owner.scope, authorization: 'manual', attempts: 0, outcome: 'running', result: '' };
    onReceipt?.(receipt);
    try {
        const options = { target, freshStart, facts: context.facts, waitForResult: true, receipt, repeatOrders: repeatOrders && !freshStart,
            rerollDice, keepManualEdits: keepManualEdits || !!repair?.correction, correction: repair?.correction, roll, signal };
        const result = family === 'continue' ? await guideContinuation(direction, options) : await guideSwipe(direction, options);
        if (!result.accepted && !ownsChat(owner)) throw new DOMException('The chat changed during generation.', 'AbortError');
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
    rerollDice = false, keepManualEdits = false, quickCheck = '', roll, forceHelper = false, onReceipt, suggestions } = {}) {
    if (!['swipe', 'continue', 'draft'].includes(family)) throw new Error('Select a guided reply action.');
    const owner = chatOwner();
    const requireOwner = () => {
        if (!ownsChat(owner)) throw new DOMException('The chat changed while preparing the guided action.', 'AbortError');
    };
    const preview = guidedPreview(family, { target, mode, freshStart, fixFacts, forceHelper, suggestions });
    if (!preview.available && !repairOnly) throw new Error(preview.reason);
    if (isGenerating() || running) throw new Error('Wait for the current guided action to finish.');
    if (target) validateTurnTarget(target);
    const controller = new AbortController();
    const signal = controller.signal;
    running = { owner, controller, native: preview.nativeStory || preview.nativeDraft, profile: !!preview.profileId, dispatching: false };
    try {
        if ((fixFacts || repairOnly || cues.some(cue => cue?.operation === 'repair')) && !repair) {
            if (!target) throw new Error('Select a reply to repair.');
            repair = await runFactRepair({ focus: target.index, truth: direction, direction: true });
        }
        requireOwner();
        if (repairOnly) return { ok: true, repair, receipt: { ...executionPreview('factRepair', { stage: 'code', target: preview.target }), attempts: 0, outcome: 'completed' } };
        if (target) validateTurnTarget(target);
        const combined = guidedDirection([...cues, quickCheck || roll?.text], direction);
        const correction = repair?.correction?.truth;
        const complete = [combined, correction && !combined.includes(correction) && `${promptText('correctionCanon')} ${correction}`].filter(Boolean).join('\n\n');
        const context = await guidedContext({ family, target, freshStart, fragment: family === 'draft' ? composer : '' });
        signal.throwIfAborted();
        requireOwner();
        running.dispatching = true;
        const options = { target, direction: complete, freshStart, mode, choice, onReceipt, repair, repeatOrders, rerollDice, keepManualEdits, owner, roll, signal, cues, suggestions };
        if (family === 'draft') return await runPlayer(preview, context, options);
        const defaultDirection = 'Write a new version of this reply from the current point in the story.';
        const result = preview.nativeStory ? await runNativeStory(family, preview, context, { ...options,
            direction: complete || (family === 'swipe' ? defaultDirection : '') }) : await runHistorical(family, preview, context, options);
        if (family === 'continue' && ownsChat(owner)) {
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
    if (!running || !ownsChat(running.owner)) return '';
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
    const target = validateTurnTarget(undo.target);
    if (isGenerating()) throw new Error('Wait for the current generation to finish.');
    const host = ctx(), owner = chatOwner(), message = owner.chat[target.index];
    const isCurrent = () => ownsChat(owner) && owner.chat[target.index] === message;
    await undoContinuationEffects(target.index, undo.before.extra?.[KEY], target.fingerprint);
    if (!isCurrent()) throw new Error('The chat changed while undoing the continuation.');
    validateTurnTarget(undo.target);
    if (!restoreReplySnapshot(target.index, undo.before, message)) throw new Error('The selected reply changed.');
    await host.saveChat?.();
    if (!isCurrent()) return;
    await syncWorld();
    const event = eventTypes().MESSAGE_SWIPED;
    if (event && isCurrent()) await host.eventSource?.emit(event, target.index);
}

export function guidedVersions(target) {
    if (!target || target.scope && target.scope !== executionScope() || target.chatId !== String(ctx().getCurrentChatId?.() ?? '')) return [];
    const message = ctx().chat?.[target.index];
    return (message?.swipes || []).flatMap((text, swipe) => typeof text === 'string' && text.trim() ?
        [{ swipe, text: cleanGuidedProse(text) }] : []);
}

export async function selectGuidedVersion(target, swipe) {
    validateTurnTarget(target);
    if (isGenerating()) throw new Error('Wait for the current generation to finish.');
    const host = ctx(), owner = chatOwner(), message = owner.chat[target.index], before = structuredClone(message);
    const isCurrent = () => ownsChat(owner) && owner.chat[target.index] === message;
    if (!Number.isInteger(swipe)) throw new Error('Select a swipe.');
    try {
        selectReplyVersion(target.index, swipe);
        await host.saveChat?.();
    } catch (error) {
        if (isCurrent()) restoreReplySnapshot(target.index, before, message);
        throw error;
    }
    if (!isCurrent()) throw new Error('The chat changed while switching swipes.');
    const event = eventTypes().MESSAGE_SWIPED;
    if (event) await host.eventSource?.emit(event, target.index);
    if (!isCurrent()) throw new Error('The chat changed while switching swipes.');
    return guidedTarget(target.index);
}
