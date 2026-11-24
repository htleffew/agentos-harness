import { ctx } from './st.js';
import { settings, saveSettings, chatState, saveChatState } from './store.js';
import { activePreset, prefs, blockCompanions, enabledV10, isCompanionPreset, setModuleOwner } from './v10.js';
import { FEATURES, FEATURE_KEYS, MEMORY_FEATURES, DEFAULT_SIDE, isSide, startingSwitches, loadLibrary, recognize, presetBlocks, presetFeatures } from './preset-library.js';
import { readMarker, makeMarker } from './preset-loadouts.js';
import { savedWordingOf } from './preset-bank-ri.js';
import { currentBank, refreshBank, stackFor, stackPlan, ownersFromStack, useBankLibrary, presetSource, SOURCE_BASE, SOURCE_COMPANION, SOURCE_RI } from './preset-bank.js';

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
    loadLibrary().then(data => { library = data; libraryState = data ? 'ready' : 'missing'; useBankLibrary(data); syncOwners(); notify(); });
}
export const libraryStatus = () => libraryState;
export function useLibrary(data) { library = data; libraryState = data ? 'ready' : 'missing'; recognized.clear(); useBankLibrary(data); }

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

// ----------------------------------------------------------------------------------------------------------------------
// The stack as the working copy (A11 c.9 and d.3, ticket B30).
//
// The stack of the selected base (preset-bank.js) is applied for the length of one prompt assembly. When a generation
// starts, the live prompt order switches off base blocks she took out, switches on base blocks she put in that ship off,
// takes her order when she moved base blocks, and gains a namespaced copy of every other card that is on (another preset,
// the companion, her customized versions); when the prompt is ready, or the generation ends or stops, the live arrays get
// back the very objects they held. The saved preset file and the stored stack are never written here.
// A base block she has not tapped in the stack keeps its live state, so a toggle in SillyTavern's prompt manager still
// applies. The extension's own cards (ri::) are sent by the extension in its fixed group; the stack sets their owners.
//
// The interim Ours, Theirs and Both switch keeps its current path until the bank page ships (B32): Both changes nothing,
// an Ours tap also switches that feature's preset blocks off in the working copy, and a Theirs tap sets the owner 'preset'.

/** Inserted prompts carry this flag, so a copy left in the live arrays by a crash is found and removed at the next start. */
export const INSERT_FLAG = 'ri_bank_insert';
const JOURNAL = 'roleplay_instructions_working_copy';
const isInsert = prompt => !!prompt && prompt[INSERT_FLAG] === true;
function journalStore() { try { return globalThis.localStorage || null; } catch { return null; } }
function readJournal() { try { return JSON.parse(journalStore()?.getItem(JOURNAL) || 'null'); } catch { return null; } }
function writeJournal(value) { try { if (value) journalStore()?.setItem(JOURNAL, JSON.stringify(value)); else journalStore()?.removeItem(JOURNAL); } catch { /* No storage: the insert flag still finds stale copies. */ } }

/** The bank source of the selected base: its own preset source, or the companion source for the companion preset. */
function baseSourceOf(bank, base) {
    const sid = bank?.sids && Object.hasOwn(bank.sids, base) ? bank.sids[base] : '';
    if (sid && bank.sources.has(presetSource(sid))) return bank.sources.get(presetSource(sid));
    return isCompanionPreset(base) ? bank?.sources?.get(SOURCE_COMPANION) || null : null;
}

/**
 * The stack plan the working copy sends for a context: { bank, stack, plan, source }, or null for a loadout (it sends as
 * saved), a host with no preset list, or a base the bank does not hold. Reading it saves a starting stack the first time.
 */
export function workingPlan(context = switchContext()) {
    if (!context || context.marker) return null;
    let bank = currentBank() || refreshBank('working-copy');
    // A preset saved or imported since the last refresh is read now rather than after the scheduled refresh.
    if (!baseSourceOf(bank, context.preset)) bank = refreshBank('working-copy');
    const source = baseSourceOf(bank, context.preset);
    if (!source) return null;
    const stack = stackFor(bank, context.preset, context.data);
    if (!stack) return null;
    return { bank, stack, source, plan: stackPlan(bank, stack, context.preset) };
}

/**
 * Mirror the stack into the chat's module owners, which effectiveModules() reads: the extension's card for a feature on in
 * the stack gives 'both', taken out gives 'preset' (the extension sends none of its text and runs none of it). A feature
 * whose card was never in the stack follows its own on or off setting ('both'). A Theirs tap on the interim switch gives
 * 'preset'; a loadout keeps the owners its marker's switches give.
 */
export const ownerFor = side => side === 'theirs' ? 'preset' : 'both';
export function syncOwners(context = switchContext(), work = undefined) {
    if (!context || !chatState()) return false;
    const switches = context.companion ? {} : resolvedSwitches(context);
    const switched = new Set(context.features.switched.map(item => item.key));
    let wanted;
    const plan = context.marker ? null : (work === undefined ? workingPlan(context) : work)?.plan;
    if (!plan) wanted = Object.fromEntries([...switched].map(key => [key, ownerFor(switches[key])]));
    else {
        // Her versions of an extension card are sent as inserted blocks; the owner follows the extension's own card.
        // Her saved wording of a feature counts as the feature's card being in the stack (B31).
        const cards = plan.filter(item => item.source === SOURCE_RI || savedWordingOf(item));
        const fromStack = ownersFromStack(cards);
        const placed = new Set(cards.map(item => item.source === SOURCE_RI ? item.id : item.versionOf));
        wanted = Object.fromEntries(FEATURE_KEYS.map(key => [key,
            switched.has(key) && switches[key] === 'theirs' ? 'preset' : placed.has(key) ? fromStack[key] : 'both']));
        // The companion pairs its own scene checks with the extension's (hostSceneChecks reads an explicit 'both' on
        // preflight as unpaired), so on it a preflight card taken out sets an owner and putting it back clears that owner.
        // Every other feature gets 'both' as on any preset: with no owner, a block the stack sends that matches a feature
        // (an Internal States Template copied in from another preset) would hand the feature to the preset.
        const held = chatState().v10?.moduleOwners?.[context.preset] || {};
        if (context.companion && wanted.preflight === 'both') { if (held.preflight === 'preset') wanted.preflight = undefined; else delete wanted.preflight; }
    }
    const owners = chatState().v10?.moduleOwners?.[context.preset] || {};
    let changed = false;
    for (const [key, value] of Object.entries(wanted)) {
        if (owners[key] !== value) { setModuleOwner(context.preset, key, value); changed = true; }
    }
    return changed;
}

/** Remove inserted prompts a crash left in the live arrays, and put back the flags and text the journal recorded. */
function clearStale(data, preset) {
    const order = sequence(data);
    const journal = readJournal();
    writeJournal(null);
    if (!Array.isArray(order) || !Array.isArray(data?.prompts)) return 0;
    const stale = new Set(data.prompts.filter(isInsert).map(prompt => prompt.identifier));
    let removed = 0;
    if (stale.size) {
        const keep = data.prompts.filter(prompt => !isInsert(prompt));
        removed = data.prompts.length - keep.length;
        data.prompts.splice(0, data.prompts.length, ...keep);
        const live = new Set(keep.map(prompt => prompt.identifier));
        const rows = order.filter(entry => !(stale.has(entry.identifier) && !live.has(entry.identifier)));
        order.splice(0, order.length, ...rows);
    }
    if (journal?.preset === preset) {
        const entries = new Map(order.map(entry => [entry.identifier, entry]));
        for (const flag of journal.flags || []) {
            const entry = entries.get(flag.id);
            if (!entry || entry.enabled !== flag.sent) continue;
            if (flag.had) entry.enabled = flag.value; else delete entry.enabled;
        }
        const prompts = new Map(data.prompts.map(prompt => [prompt.identifier, prompt]));
        for (const text of journal.texts || []) {
            const prompt = prompts.get(text.id);
            if (prompt && prompt.content === text.sent) prompt.content = text.value;
        }
        const ids = journal.order || [];
        const now = order.map(entry => entry.identifier);
        if (ids.length === now.length && new Set(ids).size === ids.length && ids.every(id => entries.has(id)) && ids.some((id, i) => id !== now[i])) {
            order.splice(0, order.length, ...ids.map(id => entries.get(id)));
        }
    }
    return removed;
}

/** An identifier no live prompt uses: the card's send id, with ~2, ~3 and so on added when the base already has it. */
function freeId(id, used) {
    let value = id;
    for (let n = 2; used.has(value); n++) value = `${id}~${n}`;
    used.add(value);
    return value;
}
function insertedPrompt(item, identifier) {
    const placement = item.placement || {};
    return { identifier, name: item.label ? `${item.name} (${item.label})` : item.name, role: item.role || 'system', content: item.text,
        system_prompt: false, marker: false, injection_position: placement.position === 1 ? 1 : 0,
        injection_depth: Number.isInteger(placement.depth) ? placement.depth : 4, injection_order: Number.isInteger(placement.order) ? placement.order : 100,
        injection_trigger: Array.isArray(placement.triggers) ? [...placement.triggers] : [], forbid_overrides: false, [INSERT_FLAG]: true };
}

/**
 * The live order the stack gives, without touching the live arrays: the entries in send order, the prompts to insert,
 * the flags to set and the texts to swap. Pure over its inputs, so tests and the page can read it.
 */
export function workingCopyChanges(data, work, off = []) {
    const order = sequence(data);
    const out = { order: [...order], inserts: [], flags: [], texts: [] };
    const live = new Map();
    for (const prompt of data.prompts) if (prompt?.identifier && !live.has(prompt.identifier)) live.set(prompt.identifier, prompt);
    const entryOf = new Map();
    for (const entry of order) if (entry?.identifier && !entryOf.has(entry.identifier)) entryOf.set(entry.identifier, entry);
    const stored = new Map(work.source.cards.map(card => [card.id, card]));
    const used = new Set(data.prompts.map(prompt => prompt?.identifier).filter(Boolean));
    const main = work.plan.filter(item => item.group === 'main');
    const isBase = item => item.source === SOURCE_BASE && live.has(item.id);
    // Her order applies once she has moved a base block: the stack's base sequence then differs from the saved one.
    const baseIds = main.filter(item => isBase(item) && entryOf.has(item.id)).map(item => item.id);
    const inStack = new Set(baseIds);
    const savedIds = work.source.cards.filter(card => card.listed && inStack.has(card.id)).map(card => card.id);
    if (baseIds.some((id, i) => id !== savedIds[i])) {
        const sorted = baseIds.map(id => entryOf.get(id));
        let anchor = null;
        for (const entry of order) {
            if (inStack.has(entry.identifier) && entryOf.get(entry.identifier) === entry) { anchor = entry; continue; }
            // A live row the stack does not hold stays after the row it followed in the live order.
            sorted.splice(anchor ? sorted.indexOf(anchor) + 1 : 0, 0, entry);
            anchor = entry;
        }
        out.order = sorted;
    }
    const firstBase = () => { const at = out.order.findIndex(entry => inStack.has(entry.identifier)); return at < 0 ? out.order.length : at; };
    let anchor = null;
    const place = entry => {
        const at = anchor ? out.order.indexOf(anchor) + 1 : firstBase();
        out.order.splice(at, 0, entry);
        anchor = entry;
    };
    for (const item of main) {
        if (isBase(item)) {
            const prompt = live.get(item.id);
            const entry = entryOf.get(item.id);
            const card = stored.get(item.id);
            // Only her tap changes a base block: on in the stack and off as shipped, or the reverse.
            const tapped = !card || item.on !== card.shippedOn;
            let want = entry ? entry.enabled === true : false;
            if (tapped) want = item.on;
            if (off.includes(item.id)) want = false;
            if (!entry) {
                if (want) { const row = { identifier: item.id, enabled: true }; place(row); out.flags.push({ entry: row, added: true }); }
                continue;
            }
            anchor = entry;
            if ((entry.enabled === true) !== want) out.flags.push({ entry, value: want });
            if (item.on && item.status === 'changed' && !prompt.marker && typeof item.text === 'string' && prompt.content !== item.text) out.texts.push({ prompt, value: item.text });
            continue;
        }
        if (!item.on || item.marker) continue;
        const identifier = freeId(item.sendId || item.key, used);
        const prompt = insertedPrompt(item, identifier);
        out.inserts.push(prompt);
        place({ identifier, enabled: true });
    }
    // An Ours tap on the interim switch also covers preset rows the stack does not hold.
    const flagged = new Set(out.flags.map(flag => flag.entry));
    for (const entry of order) if (off.includes(entry.identifier) && entry.enabled === true && !flagged.has(entry)) out.flags.push({ entry, value: false });
    // Her versions of the extension's cards go with the RI group, at the placement the card carries (depth 0 at the end).
    // Her saved wording of a feature is part of the extension's own group (B31), so it is not inserted here as well.
    for (const item of work.plan.filter(entry => entry.group === 'ri' && entry.source !== SOURCE_RI && entry.on && !savedWordingOf(entry))) {
        const identifier = freeId(item.sendId || item.key, used);
        out.inserts.push(insertedPrompt(item, identifier));
        out.order.push({ identifier, enabled: true });
    }
    return out;
}

let applied = null;
export function applyWorkingCopy() {
    restoreWorkingCopy();
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return 0;
    const data = c.chatCompletionSettings;
    const order = sequence(data);
    if (!Array.isArray(order) || !Array.isArray(data?.prompts)) return 0;
    const name = activePreset();
    clearStale(data, name);
    const context = switchContext();
    // With the extension off for the chat, or a loadout selected, the preset sends as saved.
    if (!context || context.marker || !enabledV10()) return 0;
    const work = workingPlan(context);
    syncOwners(context, work);
    // A base the bank cannot read (no preset list on this host) still gets the interim switch's Ours taps.
    const changes = workingCopyChanges(data, work || { source: { cards: [] }, plan: [] }, workingCopyOff(context));
    const unchanged = !changes.inserts.length && !changes.flags.length && !changes.texts.length && changes.order.every((entry, i) => entry === order[i]);
    if (unchanged) return 0;
    const snapshot = { prompts: data.prompts, order, promptList: [...data.prompts], entries: [...order], flags: [], texts: [] };
    for (const { entry, value, added } of changes.flags) {
        if (added) continue;
        snapshot.flags.push({ entry, had: Object.hasOwn(entry, 'enabled'), value: entry.enabled, sent: value });
        entry.enabled = value;
    }
    for (const { prompt, value } of changes.texts) {
        snapshot.texts.push({ prompt, value: prompt.content, sent: value });
        prompt.content = value;
    }
    data.prompts.push(...changes.inserts);
    order.splice(0, order.length, ...changes.order);
    applied = snapshot;
    writeJournal({ preset: name, order: snapshot.entries.map(entry => entry.identifier),
        flags: snapshot.flags.map(flag => ({ id: flag.entry.identifier, had: flag.had, value: flag.value, sent: flag.sent })),
        texts: snapshot.texts.map(text => ({ id: text.prompt.identifier, value: text.value, sent: text.sent })) });
    return changes.inserts.length + changes.flags.length + changes.texts.length;
}
export function restoreWorkingCopy() {
    if (!applied) return;
    const snapshot = applied;
    applied = null;
    snapshot.prompts.splice(0, snapshot.prompts.length, ...snapshot.promptList);
    snapshot.order.splice(0, snapshot.order.length, ...snapshot.entries);
    for (const flag of snapshot.flags) { if (flag.had) flag.entry.enabled = flag.value; else delete flag.entry.enabled; }
    for (const text of snapshot.texts) text.prompt.content = text.value;
    writeJournal(null);
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
