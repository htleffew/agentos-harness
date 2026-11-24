import { ctx, parseJson } from './st.js';
import { settings, saveSettings, chatState, saveChatState } from './store.js';
import { activePreset, defaultWritingGuidance, PREFLIGHT, prefs, MODULES, blockCompanions, enabledV10, isCompanionPreset, setModuleOwner } from './v10.js';
import { FEATURES, FEATURE_KEYS, MEMORY_FEATURES, DEFAULT_SIDE, isSide, startingSwitches, loadLibrary, recognize, presetBlocks, presetFeatures } from './preset-library.js';
import { readMarker, makeMarker } from './preset-loadouts.js';
import { MODULE_PROMPTS } from './module-layout.js';
import { promptText, roastVoiceText } from './prompts.js';
import { request } from './ai.js';

const own = (obj,key) => obj && Object.hasOwn(obj,key) ? obj[key] : undefined;
function put(obj,key,value) {
    Object.defineProperty(obj,key,{value,enumerable:true,writable:true,configurable:true});
}
const sequence = data => data?.prompt_order?.find(group=>String(group.character_id)==='100001')?.order;
const state = (preset,id) => own(own(settings().presetBlockOriginals,preset),id);
const baselineState = (preset,id) => own(own(settings().presetBlockBaselines,preset),id);
const fileSource = preset => settings().presetRestoreSources?.[JSON.stringify(preset)];
const copy = value => structuredClone(value);
const cloneBlock = block => block && copy(block);
export function hasPresetEdit(preset,id) { return !!state(preset,id); }
export function presetRows() {
    const host = ctx().chatCompletionSettings;
    const order = sequence(host);
    if (!Array.isArray(order) || !Array.isArray(host?.prompts)) return [];
    const byId = new Map(host.prompts.map(p=>[p.identifier,p]));
    const seen = new Set();
    function row(id,entry) {
        const prompt = byId.get(id);
        seen.add(id);
        return {id,name:prompt.name || id,content:prompt.content || '',role:prompt.role || 'system',marker:!!prompt.marker,
            listed:!!entry,enabled:entry?.enabled===true,absolute:prompt.injection_position===1,
            depth:prompt.injection_depth ?? 4,priority:prompt.injection_order ?? 100,triggers:prompt.injection_trigger || []};
    }
    return [...order.filter(entry=>byId.has(entry.identifier)).map(entry=>row(entry.identifier,entry)),
        ...host.prompts.filter(p=>!seen.has(p.identifier)).map(p=>row(p.identifier,null))];
}
function original(data,id) {
    const order = sequence(data);
    const index = order.findIndex(row=>row.identifier===id);
    return {block:cloneBlock(data.prompts.find(p=>p.identifier===id)) || null,entry:index<0 ? null : copy(order[index]),
        preceding:order.slice(0,Math.max(0,index)).map(row=>row.identifier),following:index<0 ? [] : order.slice(index+1).map(row=>row.identifier)};
}
const equal = (left,right) => JSON.stringify(left)===JSON.stringify(right);
const editableKeys = ['name','content','role','injection_position','injection_depth','injection_order','injection_trigger'];
function moveToPosition(order,id,placement) {
    const index = order.findIndex(entry=>entry.identifier===id);
    if (index<0) return;
    const [entry]=order.splice(index,1);
    const before = new Set(placement.preceding), after = new Set(placement.following);
    const lower = order.findLastIndex(row=>before.has(row.identifier))+1;
    const firstAfter = order.findIndex(row=>after.has(row.identifier));
    const upper = firstAfter<0 ? order.length : firstAfter;
    const at = lower<=upper ? Math.max(lower,Math.min(index,upper)) : Math.min(placement.preceding.length,order.length);
    order.splice(at,0,entry);
}
function restore(data,id,base) {
    const order = sequence(data);
    const pos = data.prompts.findIndex(p=>p.identifier===id);
    if (base.block && pos>=0) {
        const prompt = data.prompts[pos];
        if (!prompt.marker) for (const field of editableKeys) {
            if (Object.hasOwn(base.block,field)) prompt[field]=copy(base.block[field]);
            else delete prompt[field];
        }
    }
    else if (base.block) data.prompts.push(copy(base.block));
    else if (pos>=0) data.prompts.splice(pos,1);
    const index = order.findIndex(e=>e.identifier===id);
    if (base.entry) {
        if (index<0) order.splice(Math.min(base.preceding.length,order.length),0,copy(base.entry));
        else order[index].enabled=base.entry.enabled;
        moveToPosition(order,id,base);
    } else if (index>=0) order.splice(index,1);
}

export const presetBlockRevision = id => {
    const live=ctx().chatCompletionSettings;
    return sequence(live) && Array.isArray(live?.prompts) ? JSON.stringify(original(live,id)) : '';
};

export function presetRestoreBaselines(preset,id) {
    const saved = baselineState(preset,id);
    const before = saved?.snapshot || state(preset,id);
    const file = fileSource(preset);
    return {
        before:before ? {label:'Before extension edits',snapshot:before,captured:saved?.captured} : null,
        file:file?.data?.prompts.some(block=>block.identifier===id) ? {label:`Original file ${file.name}`,snapshot:original(file.data,id)} : null,
    };
}

export const presetRestoreFileName = preset => fileSource(preset)?.name || '';
export const presetRestoreUndo = preset => own(settings().presetBlockUndo,preset);

/** Link a user-selected original export to the active preset by block identities. */
export function linkPresetRestoreFile(preset,name,data) {
    if (!preset || activePreset()!==preset) throw new Error('The active preset changed. Reopen its workbench.');
    const order = sequence(data);
    if (!Array.isArray(data?.prompts) || !Array.isArray(order) || data.prompts.length>2500) throw new Error('Choose a Chat Completion preset JSON with prompts and prompt order.');
    const ids = new Set();
    for (const block of data.prompts) {
        if (typeof block?.identifier!=='string' || !block.identifier || ids.has(block.identifier)) throw new Error('The original file has missing or duplicate block identities.');
        ids.add(block.identifier);
    }
    const live = new Map(presetRows().map(row=>[row.id,row]));
    const overlap = data.prompts.filter(block=>live.has(block.identifier));
    if (!overlap.length || !overlap.some(block=>!block.marker && live.get(block.identifier).name===(block.name || block.identifier))) {
        throw new Error('The file does not contain matching block identities and names for this preset.');
    }
    const st = settings();
    (st.presetRestoreSources ||= {})[JSON.stringify(preset)] = {name:String(name),data:{prompts:copy(data.prompts),
        prompt_order:[{character_id:100001,order:copy(order)}],impersonation_prompt:data.impersonation_prompt}};
    saveSettings();
    return overlap.length;
}

export function presetBlockVariation(row, data = ctx().chatCompletionSettings) {
    const snap = original(data,row.id);
    return {name:row.name,content:row.content,role:row.role,absolute:row.absolute,depth:row.depth,priority:row.priority,
        triggers:copy(row.triggers),listed:row.listed,enabled:row.enabled,preceding:snap.preceding,following:snap.following};
}

export function validateBlockVariation(value) {
    if (!value || typeof value.name!=='string' || !value.name.trim() || typeof value.content!=='string' ||
        !['system','user','assistant'].includes(value.role) || ![value.listed,value.enabled,value.absolute].every(flag=>typeof flag==='boolean') ||
        ![value.depth,value.priority].every(number=>Number.isInteger(number) && number>=0 && number<=9999) ||
        ![value.triggers,value.preceding,value.following].every(items=>Array.isArray(items) && items.every(item=>typeof item==='string'))) {
        return 'Choose a complete preset block variation with valid placement and triggers.';
    }
    return '';
}

function setBlockText(target, change) {
    if (!change.name.trim()) throw new Error('A preset block needs a name.');
    if (target.marker) throw new Error('The host supplies the contents of this marker.');
    target.name=change.name.trim(); target.content=change.content;
    if (['system','user','assistant'].includes(change.role) && (target.role || 'system')!==change.role) target.role=change.role;
    if (!change.placement) return;
    const {absolute,depth,priority,triggers}=change.placement;
    if (![depth,priority].every(n=>Number.isInteger(n) && n>=0 && n<=9999)) throw new Error('Depth and priority must be whole numbers from 0 to 9999.');
    if (Boolean(target.injection_position===1)!==absolute) target.injection_position=absolute ? 1 : 0;
    if ((target.injection_depth ?? 4)!==depth) target.injection_depth=depth;
    if ((target.injection_order ?? 100)!==priority) target.injection_order=priority;
    if (!equal(target.injection_trigger || [],triggers)) target.injection_trigger=triggers;
}

let saving = false;
export async function withPresetWrite(action) {
    if (saving) throw new Error('Another preset edit is saving. Try again in a moment.');
    saving=true;
    try { return await action(); } finally { saving=false; }
}

export async function editPresetBlock(preset,id,change) {
    if (saving) throw new Error('Another preset edit is saving. Try again in a moment.');
    const manager = ctx().getPresetManager?.('openai');
    if (!preset || activePreset()!==preset) throw new Error('The active preset changed. Reopen its blocks.');
    const library = manager?.getPresetList?.();
    const names = library?.preset_names;
    const presetIndex = Array.isArray(names) ? names.indexOf(preset) : own(names,preset);
    const stored = manager?.getCompletionPresetByName?.(preset) ?? library?.presets?.[presetIndex];
    if (!stored || !manager?.savePreset) throw new Error('This host does not expose a writable Chat Completion preset.');
    const live = ctx().chatCompletionSettings;
    const data = {...copy(stored),prompts:copy(live.prompts),prompt_order:copy(live.prompt_order)};
    const order = sequence(data);
    if (!order) throw new Error('The host has not exposed its prompt order.');
    const p = data.prompts.find(block=>block.identifier===id);
    const index = order.findIndex(e=>e.identifier===id);
    const before = original(data,id);
    if (change.expected && change.expected!==JSON.stringify(before)) throw new Error('This block changed. Reopen it to compare before saving.');
    const baseline = baselineState(preset,id)?.snapshot || state(preset,id) || before;
    if (change.type==='restore') {
        const restoreSource = change.from==='file' ? presetRestoreBaselines(preset,id).file : presetRestoreBaselines(preset,id).before;
        if (!restoreSource) return;
        restore(data,id,restoreSource.snapshot);
    } else if (change.type==='undo') {
        const undo=presetRestoreUndo(preset);
        if (!undo || undo.id!==id) return;
        if (!equal(before,undo.after)) throw new Error('This block changed after the restore. Compare its current wording before editing.');
        restore(data,id,undo.snapshot);
    } else if (change.type==='add') {
        if (p || !change.name.trim()) throw new Error('Give the new preset block a name.');
        data.prompts.push({identifier:id,name:change.name.trim(),content:change.content || '',role:'system',system_prompt:false,injection_position:0});
        order.push({identifier:id,enabled:true});
    } else if (!p) throw new Error('This block no longer exists in the active preset.');
    else if (change.type==='text') setBlockText(p,change);
    else if (change.type==='variation') {
        const value=change.value;
        const error=validateBlockVariation(value);
        if (error) throw new Error(error);
        setBlockText(p,{...value,placement:value});
        if (!value.listed && index>=0) order.splice(index,1);
        if (value.listed && index<0) order.push({identifier:id,enabled:value.enabled});
        if (value.listed && index>=0) order[index].enabled=value.enabled;
        if (value.listed) moveToPosition(order,id,value);
    } else if (change.type==='enabled') {
        if (index<0 && change.value) order.push({identifier:id,enabled:true});
        else if (index>=0) order[index].enabled=change.value;
        else return;
    } else if (change.type==='move') {
        const target=index+change.delta;
        if (index<0 || ![-1,1].includes(change.delta) || target<0 || target>=order.length) return;
        order.splice(target,0,...order.splice(index,1));
    } else throw new Error('Unknown preset edit.');
    const after=original(data,id);
    const matchesOriginal=equal(after,baseline);
    if (equal(after,before)) return;
    return withPresetWrite(async()=>{
        await manager.savePreset(preset,data,{skipUpdate:true});
        const all=settings().presetBlockOriginals ||= {};
        const per=own(all,preset) || {};
        if (matchesOriginal) delete per[id]; else put(per,id,baseline);
        const baselines = settings().presetBlockBaselines ||= {};
        const saved=own(baselines,preset) || {};
        if (!own(saved,id)) put(saved,id,{snapshot:baseline,captured:Date.now()});
        put(baselines,preset,saved);
        const undo=settings().presetBlockUndo ||= {};
        if (change.type==='restore') put(undo,preset,{id,snapshot:before,after});
        else if (change.type==='undo') delete undo[preset];
        put(all,preset,per); saveSettings();
        // The host picker reloads every sampler and connection setting when reselected.
        // Commit just the edited prompt fields to the live manager and its preset cache.
        const stillCurrent=activePreset()===preset && equal(original(live,id),before);
        if (!Array.isArray(stored.prompts)) stored.prompts=copy(data.prompts);
        if (!sequence(stored)) stored.prompt_order=copy(data.prompt_order);
        restore(stored,id,after);
        if (stillCurrent) {
            if (stored!==live) restore(live,id,after);
            ctx().saveSettingsDebounced?.();
            try {
                const { promptManager }=await import('/scripts/openai.js');
                promptManager?.render(false);
            } catch { /* Hosts that omit the native visual manager still read the live settings. */ }
        }
    });
}
export function savePair(preset,id,keys) {
    const all=settings().promptPairs ||= {};
    const per=own(all,preset) || {};
    if (keys===null) delete per[id];
    else put(per,id,keys.filter(key=>Object.hasOwn(MODULES,key)));
    put(all,preset,per); saveSettings();
}
export async function evaluateParity(rows) {
    const blocks=rows.filter(row=>!row.marker);
    const modules=Object.fromEntries(Object.entries(MODULES).map(([key,label])=>[key,{label,instructions:MODULE_PROMPTS[key].map(id=>promptText(id))}]));
    modules.style.instructions.unshift(prefs()?.style ?? defaultWritingGuidance());
    modules.preflight.instructions.unshift(prefs()?.preflight ?? PREFLIGHT);
    modules.roast.instructions.push(roastVoiceText());
    // Give every block representation even for very large imported presets.
    const excerptLimit=Math.min(4000, Math.max(100, Math.floor(120000/Math.max(1,blocks.length))));
    const input=blocks.map(({id,name,content})=>{
        if (content.length<=excerptLimit) return {id,name,content};
        const n=Math.floor(excerptLimit/3), middle=Math.floor((content.length-n)/2);
        return {id,name,excerpts:[content.slice(0,n),content.slice(middle,middle+n),content.slice(-n)]};
    });
    const result=await request({operation:'presetParity',authorization:'manual',what:'Compare preset blocks and extension modules',promptSystemId:'parityEvaluation',
        user:JSON.stringify({modules,blocks:input}),tokens:3500});
    const parsed=parseJson(result.text);
    if (!Array.isArray(parsed)) { result.note('Could not read suggestions.',false); throw new Error('The model returned an unreadable comparison. Your settings are unchanged.'); }
    const ids=new Set(input.map(p=>p.id)), seen=new Set();
    const suggestions=parsed.filter(item=>{
        if (!ids.has(item?.id) || !Object.hasOwn(MODULES,item.module) || typeof item.reason!=='string') return false;
        const key=JSON.stringify([item.id,item.module]); if (seen.has(key)) return false;
        seen.add(key); return true;
    });
    result.note(`Received ${suggestions.length} valid suggested pairings.`);
    return suggestions;
}

// Per-feature Ours or Theirs switch (DESIGN.md 7). Switches save per preset edition in extension settings;
// a chat can pin its own copy in its metadata. A loadout's marker supplies its switches when it is selected.
let library = null;
let libraryState = 'idle';
const listeners = new Set();
export const onSwitchChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => { for (const fn of listeners) { try { fn(); } catch (error) { console.warn('Roleplay Instructions switch listener failed.', error); } } };

export function ensureLibrary() {
    if (libraryState !== 'idle') return;
    libraryState = 'loading';
    loadLibrary().then(data => { library = data; libraryState = data ? 'ready' : 'missing'; syncOwners(); notify(); });
}
export const libraryStatus = () => libraryState;
export function useLibrary(data) { library = data; libraryState = data ? 'ready' : 'missing'; recognized.clear(); }

const recognized = new Map();
function recognizeCached(name, data) {
    const signature = JSON.stringify([name, (data?.prompts || []).length, (data?.prompts || []).reduce((n, p) => n + String(p?.content || '').length, 0)]);
    if (!recognized.has(signature)) recognized.set(signature, library ? recognize(data, library) : null);
    return recognized.get(signature);
}
const editionByKey = key => library?.editions?.find(edition => edition.key === key) || null;

/** Everything the switch list needs for the selected preset. */
export function switchContext(name = activePreset()) {
    if (!name) return null;
    const data = ctx().chatCompletionSettings;
    if (!data || !Array.isArray(data.prompts)) return null;
    const marker = readMarker(data);
    const companion = isCompanionPreset(name);
    const match = marker?.edition ? { edition: editionByKey(marker.edition), score: 1 } : recognizeCached(marker?.base || name, data);
    const edition = match?.edition || null;
    const blocks = presetBlocks(data);
    const features = companion ? { switched: [], alongside: [] } : presetFeatures(blocks, edition, block => blockCompanions(block, name));
    const key = marker ? `loadout:${name}` : edition ? edition.key : `preset:${name}`;
    return { preset: name, data, marker, companion, edition, score: match?.score ?? null, blocks, features, key };
}

const pinOf = key => { const pins = chatState()?.v10?.presetPins; return pins && Object.hasOwn(pins, key) ? pins[key] : null; };
const savedOf = key => { const all = settings().presetSwitches; return all && Object.hasOwn(all, key) ? all[key] : null; };

/**
 * The resolved switches for one context: chat pin, then saved edition choices, then the loadout marker, then Both. A side she saved
 * or pinned keeps its value; a feature nobody chose falls to the default, which moved from the old starting sides to Both.
 */
export function resolvedSwitches(context) {
    if (!context) return {};
    const out = { ...startingSwitches(), ...(context.marker?.switches || {}), ...(savedOf(context.key) || {}), ...(pinOf(context.key) || {}) };
    return Object.fromEntries(FEATURE_KEYS.map(key => [key, isSide(out[key]) ? out[key] : DEFAULT_SIDE]));
}
export const switchScope = context => context && pinOf(context.key) ? 'chat' : 'edition';

/** Set one or more switches in the current scope (the chat pin when there is one). */
export function setSwitches(context, change) {
    if (!context) return;
    const clean = Object.fromEntries(Object.entries(change).filter(([key, value]) => Object.hasOwn(FEATURES, key) && isSide(value)));
    const pin = pinOf(context.key);
    if (pin) {
        put(chatState().v10.presetPins, context.key, { ...pin, ...clean });
        saveChatState();
    } else {
        const all = settings().presetSwitches ||= {};
        put(all, context.key, { ...(savedOf(context.key) || {}), ...clean });
        saveSettings();
    }
    syncOwners();
    notify();
}

/** Pin the current switches to this chat, or remove the pin. */
export function pinSwitches(context, pinned) {
    const local = prefs();
    if (!context || !local) return false;
    const pins = local.presetPins ||= {};
    if (pinned) put(pins, context.key, resolvedSwitches(context)); else delete pins[context.key];
    saveChatState();
    syncOwners();
    notify();
    return true;
}

let undoBulk = null;
/** "Theirs for everything except memory", "Ours for everything" or "Both for everything"; the previous switches are kept for Undo. */
export function bulkSwitches(context, mode) {
    if (!context) return;
    const listed = context.features.switched.map(item => item.key);
    undoBulk = { key: context.key, scope: switchScope(context), switches: resolvedSwitches(context) };
    const side = key => mode === 'ours' || mode === 'both' ? mode : MEMORY_FEATURES.includes(key) ? 'ours' : 'theirs';
    setSwitches(context, Object.fromEntries(listed.map(key => [key, side(key)])));
}
export const bulkUndoAvailable = context => !!context && undoBulk?.key === context.key;
export function undoBulkSwitches(context) {
    if (!bulkUndoAvailable(context)) return false;
    const previous = undoBulk;
    undoBulk = null;
    setSwitches(context, previous.switches);
    return true;
}

/** Block ids each listed feature owns in the selected preset. */
export function featureBlockIds(context) {
    return Object.fromEntries((context?.features.switched || []).map(item => [item.key, item.blocks.map(block => block.id)]));
}

/** Each listed block id with the features that claim it. */
export function blockFeatures(context) {
    const owners = new Map();
    for (const [key, list] of Object.entries(featureBlockIds(context))) for (const id of list) owners.set(id, [...(owners.get(id) || []), key]);
    return owners;
}

/**
 * The block ids the working copy switches off: the preset blocks of Ours features, except a block another
 * feature on Theirs or Both also uses, which stays on so that feature keeps its supply. Both switches nothing off.
 * A loadout sends as saved.
 */
export function workingCopyOff(context, switches = resolvedSwitches(context)) {
    if (!context || context.marker || context.companion) return [];
    return oursOnly(context, switches);
}
const oursOnly = (context, switches) => [...blockFeatures(context)].filter(([, keys]) => keys.every(key => switches[key] === 'ours')).map(([id]) => id);

/** The marker for saving the current switches as a loadout, or into the selected loadout with Update. */
export function currentMarker(context) {
    return makeMarker({ base: context.marker?.base || context.preset, edition: context.edition?.key || null,
        switches: resolvedSwitches(context), off: context.companion ? [] : oursOnly(context, resolvedSwitches(context)) });
}

/**
 * Mirror the switches into the chat's module owners, which effectiveModules() reads: Theirs maps to 'preset'
 * (the extension sends none of its text for it). Ours and Both map to 'both': the extension runs the feature and the host
 * blocks stand. They differ in the working copy, which takes the preset's blocks out of the request for Ours only.
 */
export const ownerFor = side => side === 'theirs' ? 'preset' : 'both';
export function syncOwners(context = switchContext()) {
    if (!context || context.companion || !chatState()) return false;
    const switches = resolvedSwitches(context);
    const owners = chatState().v10?.moduleOwners?.[context.preset] || {};
    let changed = false;
    for (const item of context.features.switched) {
        const value = ownerFor(switches[item.key]);
        if (owners[item.key] !== value) { setModuleOwner(context.preset, item.key, value); changed = true; }
    }
    return changed;
}

// The working copy is applied for the length of one prompt assembly: the Ours blocks are switched off in the live
// prompt order when a generation starts and switched back when the prompt is ready, so the saved preset file and
// SillyTavern's own preset state never change.
let applied = null;
export function applyWorkingCopy() {
    restoreWorkingCopy();
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return 0;
    const context = switchContext();
    if (!context || !enabledV10()) return 0;
    syncOwners(context);
    const off = new Set(workingCopyOff(context));
    const order = sequence(context.data);
    if (!off.size || !Array.isArray(order)) return 0;
    const changed = order.filter(entry => off.has(entry.identifier) && entry.enabled === true);
    for (const entry of changed) entry.enabled = false;
    applied = { order, entries: changed };
    return changed.length;
}
export function restoreWorkingCopy() {
    if (!applied) return;
    for (const entry of applied.entries) entry.enabled = true;
    applied = null;
}

/** When a loadout becomes active, drop unsaved switch edits for it so its marker's switches are restored. */
export function onPresetSelected() {
    const context = switchContext();
    if (context?.marker && savedOf(context.key)) {
        delete settings().presetSwitches[context.key];
        saveSettings();
    }
    syncOwners(context);
    notify();
}
