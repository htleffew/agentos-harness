import { ctx, sub } from './st.js';
import { settings, saveSettings } from './store.js';
import { activePreset } from './v10.js';
import { PROMPTS, promptText } from './prompts.js';
import { withPresetWrite } from './preset-workbench.js';

const field = 'impersonation_prompt';
const activeInstruct = () => ctx().powerUserSettings?.instruct || ctx().power_user?.instruct;
const scopeFor = source => JSON.stringify([source.api,source.preset]);
const playerBaseMacro=/^(?:user|char)(?:\.(?:they|them|their|theirs|themself))?$/i;
const readsHostContext = text => [...text.matchAll(/\{\{([\s\S]*?)\}\}/g)].some(match=>!playerBaseMacro.test(match[1].trim()));

function managerFor(preset) {
    const manager = ctx().getPresetManager?.('openai');
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    const index = Array.isArray(names) ? names.indexOf(preset) : names && Object.hasOwn(names,preset) ? names[preset] : undefined;
    return { manager, presetData:manager?.getCompletionPresetByName?.(preset) ?? list?.presets?.[index] };
}

export function impersonationSource() {
    const host = ctx();
    const api = String(host.mainApi || host.main_api || 'openai');
    if (api==='openai') {
        const preset = activePreset();
        const value = host.chatCompletionSettings?.[field];
        if (typeof value!=='string') return {api,preset,kind:'opaque',status:'SillyTavern wording unavailable',source:'Chat Completion impersonation field',text:null,raw:null,writable:false};
        let writable = false;
        try {
            const access = managerFor(preset);
            writable = !!preset && !!access.presetData && typeof access.manager?.savePreset==='function';
        } catch { /* Some hosts expose a readable field only. */ }
        return {api,preset,kind:value.trim() ? 'prompt' : 'blank',source:'Chat Completion impersonation field',text:value,raw:value,writable,
            status:value.trim() ? writable ? 'Editable in this preset' : 'Read-only SillyTavern wording' : writable ? 'Blank SillyTavern field' : 'Blank, read-only SillyTavern field'};
    }
    const instruct = activeInstruct();
    const cue = instruct?.last_input_sequence || instruct?.input_sequence;
    if (instruct?.enabled && typeof cue==='string') return {api,preset:String(instruct.preset || ''),kind:'instruct',status:'Read-only formatting direction',source:'Instruct preset · last input sequence',text:cue,raw:cue,writable:false};
    return {api,preset:String(instruct?.preset || ''),kind:'opaque',status:'SillyTavern wording unavailable',source:'SillyTavern impersonation',text:null,raw:null,writable:false};
}

export function draftImpersonation({ mode = 'helper', operation = 'playerDraft' } = {}) {
    const host = impersonationSource();
    const capable = ['prompt','blank'].includes(host.kind);
    const local = impersonationMode(host)==='extension';
    // Host macros can read the unrestricted character card, transcript, variables, or lore.
    const privateMacro = capable && readsHostContext(host.text);
    if (capable && !privateMacro && (!local || mode==='native')) {
        return {...host,label:host.source,expanded:sub(host.text),include:mode==='helper',host,operation};
    }
    const editable = playerPrompt('playerDraft');
    const {text,expanded}=editable;
    return {...host,kind:'extension',label:'Extension Impersonate instruction',source:'Extension Impersonate instruction',
        status:local ? 'Extension template selected' : privateMacro ? 'Extension template used for player knowledge limits' : 'Extension template available',
        text,raw:text,expanded,include:true,host,operation,privateMacro:privateMacro || editable.privateMacro};
}

export function playerPrompt(id, values = {}) {
    let text = promptText(id,values);
    const privateMacro=readsHostContext(text);
    if (privateMacro) {
        text = PROMPTS[id].text.replace(/\{([a-zA-Z]\w*)\}/g,(token,key)=>Object.hasOwn(values,key) ? String(values[key]) : token);
    }
    return {text,expanded:sub(text),privateMacro};
}

export const impersonationMode = source => settings().impersonationByPreset?.[scopeFor(source)]==='extension' ? 'extension' : 'preset';

export function setImpersonationSource(source, mode) {
    const current = impersonationSource();
    if (scopeFor(current)!==scopeFor(source)) throw new Error('The active preset changed. Reopen the impersonation prompt.');
    if (!['extension','preset'].includes(mode)) throw new Error('Choose an impersonation source.');
    const st = settings();
    (st.impersonationByPreset ||= {})[scopeFor(source)] = mode;
    saveSettings();
}

export function impersonationBaselines(source = impersonationSource()) {
    const before = settings().impersonationOriginals?.[scopeFor(source)];
    const verified = settings().presetRestoreSources?.[JSON.stringify(source.preset)];
    return {
        before:before ? {text:before.text,label:'Before extension edits',captured:before.captured} : null,
        file:typeof verified?.data?.[field]==='string' ? {text:verified.data[field],label:`Original file ${verified.name}`} : null,
    };
}

export const hasHostImpersonationDefault = () => !!globalThis.document?.querySelector('#impersonation_prompt_restore');

/** Read the host's own restore value on demand, then leave the shared field as it was. */
export function readHostImpersonationDefault(source) {
    const current = impersonationSource();
    if (scopeFor(current)!==scopeFor(source) || current.text!==source.text) throw new Error('The active preset changed. Reopen the field to compare.');
    const control = globalThis.document?.querySelector('#impersonation_prompt_restore');
    const input = globalThis.document?.querySelector('#impersonation_prompt_textarea');
    const live = ctx().chatCompletionSettings;
    if (!current.writable || !control || !live) throw new Error('SillyTavern does not expose its utility default.');
    const inputValue = input?.value;
    try {
        control.click();
        const text=live[field];
        if (typeof text!=='string') throw new Error('SillyTavern did not expose a text utility default.');
        return text;
    } finally {
        live[field]=current.text;
        if (input) input.value=inputValue;
    }
}

export async function saveImpersonationField(source, text) {
    if (typeof text!=='string' || text.length>12000) throw new Error('Keep the impersonation field within 12,000 characters.');
    const now = impersonationSource();
    if (scopeFor(now)!==scopeFor(source) || now.text!==source.text) throw new Error('The preset or field changed. Reopen it to compare before saving.');
    if (!now.writable) throw new Error('SillyTavern field is read-only.');
    if (now.text===text) return now;
    const host = ctx(), live = host.chatCompletionSettings;
    const {manager,presetData} = managerFor(now.preset);
    const storedBefore = presetData[field];
    const data = {...structuredClone(presetData),prompts:structuredClone(live.prompts),prompt_order:structuredClone(live.prompt_order),[field]:text};
    return withPresetWrite(async()=>{
        await manager.savePreset(now.preset,data,{skipUpdate:true});
        if (presetData[field]===storedBefore) presetData[field]=text;
        const baselines = settings().impersonationOriginals ||= {};
        baselines[scopeFor(now)] ??= { text:now.text,captured:Date.now() };
        saveSettings();
        const afterSave = impersonationSource();
        if (scopeFor(afterSave)!==scopeFor(now) || afterSave.text!==now.text) {
            throw new Error('The active preset or field changed during the save, and the original preset was saved. Reopen it to inspect the result.');
        }
        live[field] = text;
        const nativeInput = globalThis.document?.querySelector('#impersonation_prompt_textarea');
        if (nativeInput) nativeInput.value=text;
        host.saveSettingsDebounced?.();
        return impersonationSource();
    });
}
