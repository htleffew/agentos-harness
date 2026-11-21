import { ctx, parseJson } from './st.js';
import { settings, saveSettings } from './store.js';
import { activePreset, defaultWritingGuidance, PREFLIGHT, prefs, MODULES } from './v10.js';
import { MODULE_PROMPTS } from './module-layout.js';
import { promptText, roastVoiceText } from './prompts.js';
import { request } from './ai.js';

const own = (obj,key) => obj && Object.hasOwn(obj,key) ? obj[key] : undefined;
function put(obj,key,value) {
    Object.defineProperty(obj,key,{value,enumerable:true,writable:true,configurable:true});
}
const sequence = data => data?.prompt_order?.find(group=>String(group.character_id)==='100001')?.order;
const state = (preset,id) => own(own(settings().presetBlockOriginals,preset),id);
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
function restore(data,id,base) {
    const order = sequence(data);
    const pos = data.prompts.findIndex(p=>p.identifier===id);
    if (base.block) data.prompts.splice(pos<0 ? data.prompts.length : pos,pos<0 ? 0 : 1,copy(base.block));
    else if (pos>=0) data.prompts.splice(pos,1);
    const index = order.findIndex(e=>e.identifier===id);
    if (index>=0) order.splice(index,1);
    if (base.entry) {
        const before = new Set(base.preceding), after = new Set(base.following);
        const lower = order.findLastIndex(entry=>before.has(entry.identifier))+1;
        const firstAfter = order.findIndex(entry=>after.has(entry.identifier));
        const upper = firstAfter<0 ? order.length : firstAfter;
        const preferred = index<0 ? base.preceding.length : index;
        const at = lower<=upper ? Math.max(lower,Math.min(preferred,upper)) : Math.min(base.preceding.length,order.length);
        order.splice(at,0,copy(base.entry));
    }
}
let saving = false;
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
    const baseline = state(preset,id) || original(data,id);
    if (change.type==='restore') {
        if (!state(preset,id)) return;
        restore(data,id,baseline);
    } else if (change.type==='add') {
        if (p || !change.name.trim()) throw new Error('Give the new preset block a name.');
        data.prompts.push({identifier:id,name:change.name.trim(),content:change.content || '',role:'system',system_prompt:false,injection_position:0});
        order.push({identifier:id,enabled:true});
    } else if (!p) throw new Error('This block no longer exists in the active preset.');
    else if (change.type==='text') {
        if (!change.name.trim()) throw new Error('A preset block needs a name.');
        if (p.marker) throw new Error('The host supplies the contents of this marker.');
        p.name=change.name.trim(); p.content=change.content;
        if (['system','user','assistant'].includes(change.role) && (p.role || 'system')!==change.role) p.role=change.role;
        if (change.placement) {
            const {absolute,depth,priority,triggers} = change.placement;
            if (![depth,priority].every(n=>Number.isInteger(n) && n>=0 && n<=9999)) throw new Error('Depth and priority must be whole numbers from 0 to 9999.');
            if (Boolean(p.injection_position===1)!==absolute) p.injection_position=absolute ? 1 : 0;
            if ((p.injection_depth ?? 4)!==depth) p.injection_depth=depth;
            if ((p.injection_order ?? 100)!==priority) p.injection_order=priority;
            if (JSON.stringify(p.injection_trigger || [])!==JSON.stringify(triggers)) p.injection_trigger=triggers;
        }
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
    const matchesOriginal=JSON.stringify(after)===JSON.stringify(baseline);
    if (matchesOriginal && !state(preset,id)) return;
    saving=true;
    try {
        await manager.savePreset(preset,data,{skipUpdate:true});
        const all=settings().presetBlockOriginals ||= {};
        const per=own(all,preset) || {};
        if (change.type==='restore' || matchesOriginal) delete per[id]; else put(per,id,baseline);
        put(all,preset,per); saveSettings();
        // The host picker reloads every sampler and connection setting when reselected.
        // Commit just the edited prompt fields to the live manager and its preset cache.
        Object.assign(stored,{prompts:data.prompts,prompt_order:data.prompt_order});
        if (activePreset()===preset) {
            live.prompts=copy(data.prompts);
            live.prompt_order=copy(data.prompt_order);
            ctx().saveSettingsDebounced?.();
            try {
                const { promptManager }=await import('/scripts/openai.js');
                promptManager?.render(false);
            } catch { /* Hosts that omit the native visual manager still read the live settings. */ }
        }
    } finally { saving=false; }
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
    const result=await request({what:'Compare preset blocks and extension modules',promptSystemId:'parityEvaluation',
        user:JSON.stringify({modules,blocks:input}),tokens:3500,retryEmpty:false});
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
