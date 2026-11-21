import { canUseProfiles, characterKey, ctx, listProfiles } from './st.js';
import { settings, saveSettings } from './store.js';
import { addLog, updateLog } from './log.js';

export const EXECUTION_OPERATIONS = Object.freeze({
    playerDraft: { label:'Generate my draft',preserveDraft:true },
    playerChoices: { label:'Give me choices',preserveDraft:true },
    playerExpansion: { label:'Draft from this choice',preserveDraft:true },
    historicalSwipe: { label:'Generate a historical swipe' },
    historicalContinue: { label:'Continue a historical reply' },
    factRepair: { label:'Find source facts to repair', legacyProfile:true },
    chapterSummary: { label:'Write a chapter summary', legacyProfile:true,
        automatic:'When a filed reply qualifies at an enabled reply count, scene-end or token threshold.' },
    chapterCombine: { label:'Combine older chapters', legacyProfile:true,
        automatic:'When a new chapter has been saved and the configured number of older chapters has been exceeded.' },
    historyCatchUp: { label:'Catch up story history', legacyProfile:true },
    newChapter: { label:'Draft a new chapter', legacyProfile:true },
    starterWorld: { label:'Fill a starter Story World', legacyProfile:true },
    storyOpening: { label:'Draft or read an opening', legacyProfile:true },
    instructionCheck: { label:'Check whether directions happened', legacyProfile:true,
        automatic:'After a reply with at least one instruction that needs checking when reply checks are enabled.' },
    automaticSwipe: { label:'Automatically replace a missed reply', mainOnly:true,
        automatic:'Once for an eligible reply when the enabled check finds an overdue instruction or player-agency issue and automatic replacement is selected.' },
    writerVersions: { label:'Write instruction versions', legacyProfile:true },
    writerVersionRewrite: { label:'Rewrite one instruction version', legacyProfile:true },
    writerItems: { label:'Write story event items', legacyProfile:true },
    writerStyle: { label:'Write style items', legacyProfile:true },
    writerRewrite: { label:'Rewrite event items' },
    writerGoal: { label:'Draft a character goal', legacyProfile:true },
    writerWorld: { label:'Draft a Story World entry', legacyProfile:true },
    bookKeywords: { label:'Suggest lorebook trigger phrases', legacyProfile:true },
    editedState: { label:'Rebuild edited story state', legacyProfile:true },
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

export function executionSetting(operation) {
    const st = settings(), def = definition(operation);
    const table = st.execution?.functions;
    const value = table && Object.hasOwn(table, operation) ? table[operation] : {};
    return {
        profileId:String(value?.profileId ?? (def?.legacyProfile ? st.profileId : '') ?? ''),
        automatic:!!def?.automatic && value?.automatic === true,
        migrated:!Object.hasOwn(value || {},'profileId') && !!def?.legacyProfile && !!st.profileId,
    };
}

export function setExecutionSetting(operation, change) {
    const def = definition(operation);
    if (!def) throw new Error('Unknown model function.');
    const st = settings();
    const execution = st.execution ||= { version:1, functions:{} };
    const functions = execution.functions ||= {};
    const previous = executionSetting(operation);
    const profileId = String(change.profileId ?? previous.profileId);
    if (def.mainOnly && profileId) throw new Error('This function uses the host reply connection.');
    functions[operation] = { profileId, automatic:!!def.automatic && (change.automatic ?? previous.automatic) === true };
    saveSettings();
}

export const automaticAllowed = operation => executionSetting(operation).automatic;

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
    const profileId = kind === 'additional' && def ? executionSetting(operation).profileId : '';
    const profile = profileId ? listProfiles().find(item=>item.id===profileId) : null;
    const problem = profileId && !profile ? `The saved connection profile (${profileId}) is unavailable.`
        : profileId && (mainOnly || def?.mainOnly) ? 'This host operation requires Main API.'
        : profileId && !canUseProfiles() ? 'This host cannot send through the saved connection profile.' : '';
    const connection = kind === 'code' ? '' : profile ? `Connection profile: ${profile.name}` : profileId ? `Unavailable profile (${profileId})` : mainConnection();
    return { operation, label:label || def?.label || 'Story action', stage:kind, expected:expected ?? Number(kind==='additional'),
        trigger:trigger || 'When you run this action.', connection, profileId, target, problem };
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
    const receipt = { ...preview, id:`${Date.now().toString(36)}-${sequence}`, sequence, chat:activeChat(), scope:executionScope(), authorization,
        attempts:0, outcome:'pending', result:'' };
    const block = !def ? 'This model function is unknown.'
        : authorization !== 'manual' && (authorization !== 'automatic' || !automaticAllowed(operation)) ? 'Additional model work needs authorization.'
        : preview.problem || (requireRaw && !preview.profileId && typeof ctx().generateRaw!=='function' ? 'This host does not expose direct generation on Main API.' : '');
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
    const entry = record ? addLog({what:receipt.label,details:[`Additional model request · attempt 1 of 1.`, `Connection ${receipt.connection}.`]}) : null;
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
