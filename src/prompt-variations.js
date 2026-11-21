import { settings, saveSettings } from './store.js';

export const promptOwner = (...identity) => JSON.stringify(identity);
const type = 'roleplay-instructions.prompt-variation';
const scoped = owner => settings().promptVariations?.[owner] || [];

export function listVariations(owner, { removed = false } = {}) {
    return structuredClone(scoped(owner).filter(entry=>Boolean(entry.removed)===removed));
}

function write(owner, entries) {
    if (typeof owner!=='string' || !owner.startsWith('[')) throw new Error('An instruction owner is required.');
    const data = settings().promptVariations ||= {};
    data[owner] = entries;
    saveSettings();
}

export function saveVariation(owner, { id, name, value }) {
    const label = String(name || '').trim();
    if (!label || label.length > 80) throw new Error('Enter a variation name of up to 80 characters.');
    if (value===undefined) throw new Error('There is no instruction to save.');
    const entries = [...scoped(owner)];
    if (entries.some(item=>!item.removed && item.id!==id && item.name.toLowerCase()===label.toLowerCase())) {
        throw new Error('A variation already uses that name.');
    }
    const index = entries.findIndex(item=>item.id===id);
    if (id && (index<0 || entries[index].removed)) throw new Error('That variation is unavailable.');
    const entry = { id:id || globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name:label,value:structuredClone(value) };
    if (index>=0) entries[index] = entry;
    else entries.push(entry);
    write(owner,entries);
    return structuredClone(entry);
}

export function setVariationRemoved(owner, id, removed) {
    const entries = [...scoped(owner)];
    const index = entries.findIndex(item=>item.id===id);
    if (index<0) throw new Error('That variation is unavailable.');
    const entry = { ...entries[index], removed:Boolean(removed) };
    if (!removed && entries.some(item=>!item.removed && item.id!==id && item.name===entry.name)) entry.name += ' (restored)';
    entries[index] = entry;
    write(owner,entries);
}

export function variationFile(value) {
    return { type,version:1,name:value.name,value:structuredClone(value.value) };
}

export function readVariationFile(data) {
    if (data?.type!==type || data.version!==1 || typeof data.name!=='string' || !Object.hasOwn(data,'value')) {
        throw new Error('Choose a Roleplay Instructions variation JSON file.');
    }
    return { name:data.name,value:data.value };
}

export function exportVariations(owner) {
    return listVariations(owner).map(variationFile);
}
