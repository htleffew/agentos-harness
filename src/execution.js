import { canUseProfiles, characterKey, ctx, listProfiles } from './st.js';
import { settings, saveSettings } from './store.js';
import { addLog, updateLog } from './log.js';
import { historySourceMark } from './history-source.js';
import { chainFor, detectRoutes, resolveRoute, runChain } from './routing.js';

export const EXECUTION_OPERATIONS = Object.freeze({
    playerDraft: { label:'Generate my draft',preserveDraft:true },
    playerChoices: { label:'Give me choices',preserveDraft:true },
    playerExpansion: { label:'Draft from this choice',preserveDraft:true },
    historicalSwipe: { label:'Generate a historical swipe' },
    historicalContinue: { label:'Continue a historical reply' },
    factRepair: { label:'Find source facts to repair' },
    chapterSummary: { label:'Write a chapter summary',
        automatic:'When a filed reply qualifies at an enabled reply count, scene-end or token threshold.', automaticDefault:true },
    chapterCombine: { label:'Combine older chapters',
        automatic:'When a new chapter has been saved and the configured number of older chapters has been exceeded.', automaticDefault:true },
    newChapter: { label:'Draft a new chapter' },
    starterWorld: { label:'Fill a starter Story World' },
    storyOpening: { label:'Draft or read an opening' },
    instructionCheck: { label:'Check whether directions happened',
        automatic:'After a reply with at least one instruction that needs checking when reply checks are enabled.', automaticDefault:true },
    automaticSwipe: { label:'Automatically replace a missed reply', mainOnly:true,
        automatic:'Once for an eligible reply when the enabled check finds an overdue instruction or player-agency issue and automatic replacement is selected.' },
    writerVersions: { label:'Write instruction versions' },
    writerVersionRewrite: { label:'Rewrite one instruction version' },
    writerItems: { label:'Write story event items' },
    writerStyle: { label:'Write style items' },
    writerRewrite: { label:'Rewrite event items' },
    writerGoal: { label:'Draft a character goal' },
    writerWorld: { label:'Draft a Story World entry' },
    bookKeywords: { label:'Suggest lorebook trigger phrases' },
    presetParity: { label:'Compare preset blocks and extension modules' },
});

export const EXECUTION_STAGES = Object.freeze({
    code: { label:'Runs in code', icon:'◇' },
    reply: { label:'Uses the reply request', icon:'↪' },
    additional: { label:'Additional model request', icon:'▲' },
});

const recent = new Map();
let serial = 0;
const activeChat = () => String(ctx().getCurrentChatId?.() ?? '');
const scopedChat = (chat,character) => JSON.stringify([character,chat]);
const storageKey = (operation, scope) => JSON.stringify([scope,operation]);
export const executionScope = () => scopedChat(activeChat(),characterKey());
const definition = operation => Object.hasOwn(EXECUTION_OPERATIONS, operation) ? EXECUTION_OPERATIONS[operation] : null;

/** A function with a background job runs Automatic until she fixes a connection. The others start Fixed on Main API. */
export const isJobBacked = operation => { const def = definition(operation); return !!def && !def.mainOnly && Object.hasOwn(OPERATION_JOBS,operation); };

/** The chain a function follows when it is Automatic, or when a Fixed pick falls back. The tapped functions write prose, so they use the writer tier. */
const TAPPED_JOB = 'carryOver';
export const chainJob = operation => OPERATION_JOBS[operation] || TAPPED_JOB;

/**
 * What she chose for one function. mode is 'auto' or 'fixed'. A Fixed function sends through profileId, or through Main
 * API when that is empty, and falls down the Automatic chain after her pick only when fallback is on. A profile she saved
 * for a job-backed function before modes existed stays Fixed on that profile; the older shared profile fixes nothing.
 */
export function executionSetting(operation) {
    const st = settings(), def = definition(operation);
    const table = st.execution?.functions;
    const value = table && Object.hasOwn(table,operation) ? table[operation] : {};
    const profileId = String(value?.profileId ?? '');
    const mode = def?.mainOnly ? 'fixed' : value?.mode==='auto' || value?.mode==='fixed' ? value.mode
        : isJobBacked(operation) && !profileId ? 'auto' : 'fixed';
    const automatic = !!def?.automatic && (typeof value?.automatic === 'boolean' ? value.automatic : def.automaticDefault === true);
    return { mode, profileId:mode==='fixed' ? profileId : '', fallback:mode==='fixed' && !def?.mainOnly && value?.fallback === true, automatic };
}

export function setExecutionSetting(operation, change) {
    const def = definition(operation);
    if (!def) throw new Error('Unknown model function.');
    const st = settings();
    const execution = st.execution ||= { version:1, functions:{} };
    const functions = execution.functions ||= {};
    const entry = { ...(Object.hasOwn(functions,operation) ? functions[operation] : null) };
    const current = executionSetting(operation);
    if (def.mainOnly && (change.profileId || change.mode==='auto' || change.fallback)) throw new Error('This function uses the host reply connection.');
    if (change.mode !== undefined || change.profileId !== undefined || change.fallback !== undefined) {
        entry.mode = change.mode ?? (change.profileId !== undefined ? 'fixed' : current.mode);
        entry.profileId = String(change.profileId ?? current.profileId);
        entry.fallback = (change.fallback ?? current.fallback) === true;
        if (entry.mode==='auto') { entry.profileId = ''; entry.fallback = false; }
    }
    if (change.automatic !== undefined && def.automatic) entry.automatic = change.automatic === true;
    functions[operation] = entry;
    saveSettings();
}

export const automaticAllowed = operation => executionSetting(operation).automatic;

/** The background job, and so the tier chain, each model function uses. */
export const OPERATION_JOBS = Object.freeze({
    factRepair:'tidy', chapterSummary:'chapter', chapterCombine:'storySoFar', newChapter:'carryOver',
    starterWorld:'behaviorDrafts', storyOpening:'behaviorDrafts', instructionCheck:'capture', writerVersions:'behaviorDrafts',
    writerVersionRewrite:'behaviorDrafts', writerItems:'behaviorDrafts', writerStyle:'behaviorDrafts', writerRewrite:'behaviorDrafts',
    writerGoal:'behaviorDrafts', writerWorld:'behaviorDrafts', bookKeywords:'capture', presetParity:'tidy',
});

/** The tier chain of a function, ending on Main API so a host with no saved profile still answers, as it did before chains. */
const autoChain = operation => {
    const chain = chainFor(chainJob(operation));
    return chain.some(entry=>entry.route==='main') ? chain : [...chain,{ route:'main' }];
};

/**
 * The route chain for one model function (M1e 7.3), and the one source the settings screen and the receipts name.
 * Automatic follows the tier chain from the first run, with no approval step. Fixed sends to her pick and nowhere else
 * unless "Fall back if this fails" is on, which continues down the Automatic chain after her pick.
 */
export function resolveChain(operation) {
    const def = definition(operation);
    if (!def) throw new Error('Unknown model function.');
    if (def.mainOnly) return [{ route:'main' }];
    const { mode, profileId, fallback } = executionSetting(operation);
    if (mode==='auto') return autoChain(operation);
    const head = profileId ? { route:'override', profileId } : { route:'main' };
    return fallback ? [head,...autoChain(operation).filter(entry=>head.route!=='main' || entry.route!=='main')] : [head];
}

const STEP_NAMES = { desktop:['Tailscale','Desktop over Tailscale'], phone:['Local','On-phone model'], nanogpt:['Backup','NanoGPT'],
    openrouterFree:['Backup','free tiers'], googleFree:['Backup','free tiers'], openrouter:['Backup','OpenRouter'], main:['Main','Main API'] };

/** One step of a chain with its kind and the profile it will use, for example "Tailscale: Desktop over Tailscale (Gemma)". */
function stepText(entry, found) {
    if (entry.route==='override') {
        const name = listProfiles().find(p=>p.id===entry.profileId)?.name || `unavailable profile (${entry.profileId})`;
        return `Fixed: ${name}`;
    }
    const [kind,name] = STEP_NAMES[entry.route] || ['Backup',entry.route];
    const profile = found[entry.route]?.kind==='profile' ? found[entry.route].name : '';
    return `${kind}: ${name}${profile ? ` (${profile})` : ''}`;
}

/** The chain in order, each step labeled with its kind and detected profile name. */
export function chainSummary(chain) {
    const found = detectRoutes(), steps = [];
    for (const entry of chain) {
        const text = stepText(entry,found);
        if (steps[steps.length-1]!==text) steps.push(text);
    }
    return steps.join(', then ');
}

/**
 * Send one background request over the chain resolveChain returns: Automatic walks every route with the probe, the
 * ten-minute skip, the spend ceiling and the fallback notices of runChain; Fixed sends only to her pick, and continues
 * down the chain only with "Fall back if this fails" on. The receipt, when given, records the route that answered.
 */
export async function runOperationChain(operation, { receipt, ...options } = {}) {
    const chain = resolveChain(operation);
    const result = await runChain(chain, { job:chainJob(operation), background:true, ...options });
    if (receipt) {
        const sent = result.attempts.filter(item=>item.outcome!=='skipped').length;
        receipt.attempts = Math.max(1,sent);
        receipt.observedRoute = result.ok ? `${stepText(chain[(result.attempts.at(-1)?.n || 1) - 1] || { route:result.route },detectRoutes())}${result.model ? ` · ${result.model}` : ''}` : 'No route answered';
        receipt.chainLog = result.attempts.map(item=>item.receipt);
    }
    return result;
}

/** The step of a chain that runs first today: the first with a connection this host can carry. */
export function firstStep(chain) {
    const found = detectRoutes();
    const entry = chain.find(item=>{ try { return !!resolveRoute(item); } catch { return false; } }) || chain[0];
    return entry ? stepText(entry,found) : '';
}

function mainConnection() {
    const host = ctx();
    const api = String(host.mainApi || host.main_api || '');
    let model = '';
    try { model = String((api==='openai' ? host.getChatCompletionModel?.() : host.getCurrentModel?.()) ?? ''); }
    catch { /* Model introspection depends on the host. */ }
    const source = api==='openai' ? host.chatCompletionSettings?.chat_completion_source : host.textCompletionSettings?.type;
    const details = [api,source,model].filter(Boolean).join(' · ');
    return details ? `Main API (${details})` : 'Main API';
}

export function executionPreview(operation, { stage = 'additional', target, trigger, expected, mainOnly = false, label } = {}) {
    const def = definition(operation);
    const kind = EXECUTION_STAGES[stage] ? stage : 'additional';
    const chain = kind === 'additional' && def ? resolveChain(operation) : [];
    const setting = kind === 'additional' && def ? executionSetting(operation) : null;
    const profileId = chain[0]?.route==='override' ? chain[0].profileId : '';
    const profile = profileId ? listProfiles().find(item=>item.id===profileId) : null;
    const problem = profileId && !profile ? `The saved connection profile (${profileId}) is unavailable.`
        : profileId && (mainOnly || def?.mainOnly) ? 'This host operation requires Main API.'
        : profileId && !canUseProfiles() ? 'This host cannot send through the saved connection profile.' : '';
    const head = profile ? `Connection profile: ${profile.name}` : profileId ? `Unavailable profile (${profileId})` : mainConnection();
    const connection = kind === 'code' ? '' : setting?.mode==='auto' ? `Automatic: ${chainSummary(chain)}. Runs first today: ${firstStep(chain)}`
        : setting?.fallback ? `${head}. If it fails, falls back to ${chainSummary(chain.slice(1))}` : head;
    return { operation, label:label || def?.label || 'Story action', stage:kind, expected:expected ?? Number(kind==='additional'),
        trigger:trigger || 'When you run this action.', connection, profileId, target, problem, viaChain:chain.length>1 };
}

export function executionReceipt(operation, chat = activeChat(), character = characterKey()) {
    return recent.get(storageKey(operation,scopedChat(chat,character))) || null;
}

function publish(receipt, onReceipt) {
    const snapshot = { ...receipt };
    const key = storageKey(receipt.operation,receipt.scope);
    if (!recent.has(key) && recent.size >= 120) recent.delete(recent.keys().next().value);
    const previous = recent.get(key);
    if (!previous || previous.sequence<=receipt.sequence) recent.set(key, snapshot);
    try { onReceipt?.(snapshot); } catch (error) { console.warn('Roleplay Instructions execution receipt could not be displayed.', error); }
}

export function amendExecutionReceipt(receipt, change, onReceipt) {
    Object.assign(receipt,change);
    publish(receipt,onReceipt);
}

/** Run a single authorized attempt, including a host generation if the extension starts it. */
export async function runAdditional(operation, { authorization, target, onReceipt, mainOnly, label, requireRaw, signal, record = true, preserveDraft = false } = {}, dispatch) {
    const def = definition(operation);
    const preview = executionPreview(operation,{target,mainOnly,label,trigger:authorization==='automatic' ? def?.automatic : undefined});
    const sequence=++serial;
    const receipt = { ...preview, id:`${Date.now().toString(36)}-${sequence}`, sequence, chat:activeChat(), scope:executionScope(), authorization, viaChain:preview.viaChain || authorization==='automatic' && !!preview.profileId,
        attempts:0, outcome:'pending', result:'' };
    const block = !def ? 'This model function is unknown.'
        : authorization !== 'manual' && (authorization !== 'automatic' || !automaticAllowed(operation)) ? 'Additional model work needs authorization.'
        : preview.problem || (requireRaw && !preview.profileId && !preview.viaChain && typeof ctx().generateRaw!=='function' ? 'This host does not expose direct generation on Main API.' : '');
    if (block) {
        receipt.outcome = 'blocked';
        receipt.result = block;
        publish(receipt,onReceipt);
        throw Object.assign(new Error(block),{receipt});
    }
    if (signal?.aborted) {
        receipt.outcome='cancelled'; receipt.result='Cancelled before dispatch.';
        publish(receipt,onReceipt);
        throw Object.assign(new Error(receipt.result),{name:'AbortError',receipt});
    }
    receipt.attempts = 1;
    receipt.outcome = 'running';
    publish(receipt,onReceipt);
    const reply=operation==='instructionCheck' && Number.isInteger(target?.id) && ctx().chat?.[target.id];
    const entry = record ? addLog({what:receipt.label,details:[`Additional model request · attempt 1 of 1.`, `Connection ${receipt.connection}.`],
        reply:reply && {scope:receipt.scope,index:target.id,fingerprint:historySourceMark(reply),swipe:Number(reply.swipe_id || 0)}}) : null;
    try {
        const value = await dispatch({profileId:receipt.profileId,receipt});
        if (!preserveDraft && receipt.scope!==executionScope()) {
            throw Object.assign(new Error('The chat changed while this request was running.'),{name:'AbortError'});
        }
        receipt.outcome = 'completed';
        receipt.result ||= 'Received a result.';
        updateLog(entry,{ok:true,result:receipt.result});
        publish(receipt,onReceipt);
        return { value, receipt };
    } catch (error) {
        receipt.outcome = error?.name==='AbortError' ? 'cancelled' : 'failed';
        receipt.result = String(error?.message || error);
        const partial = error?.partialText ?? error?.partial ?? error?.responseText;
        if (typeof partial==='string' && partial.trim()) receipt.partialText = partial;
        updateLog(entry,{ok:false,status:receipt.outcome==='cancelled' ? 'Cancelled' : 'Failed',result:receipt.result,got:receipt.partialText || ''});
        publish(receipt,onReceipt);
        throw Object.assign(error instanceof Error ? error : new Error(receipt.result),{receipt});
    }
}
