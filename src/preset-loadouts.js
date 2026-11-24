// Saved loadouts (DESIGN.md 7): a working copy saved as its own SillyTavern preset named "<preset> + RI <name>",
// carrying a hidden marker of every Ours and Theirs switch. The marker lives in the preset's extension data
// (preset.extensions.roleplay_instructions.loadout), which SillyTavern keeps through save, export and import and
// never shows in the prompt list. A disabled comment-macro row is the fallback carrier (row 39 of DESIGN.md 12):
// SillyTavern keeps the row and its {{// ...}} macro expands to nothing, so the row sends no text even if enabled.
import { FEATURES } from './preset-library.js';

export const MARKER_KEY = 'roleplay_instructions';
export const MARKER_ROW = 'ri-loadout-marker';
const MARKER_VERSION = 1;
const SEP = ' + RI ';

const sideOf = value => value === 'ours' || value === 'theirs' ? value : null;
export function cleanSwitches(switches) {
    return Object.fromEntries(Object.entries(switches || {}).filter(([key, value]) => Object.hasOwn(FEATURES, key) && sideOf(value)));
}

/** Validate a loadout name and build the preset name. */
export function loadoutName(preset, name) {
    const short = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!short) throw new Error('Give the loadout a short name.');
    if (short.length > 60) throw new Error('Keep the loadout name under 60 characters.');
    if (/[\\/:*?"<>|]/.test(short)) throw new Error('A loadout name cannot hold \\ / : * ? " < > or |.');
    return `${String(preset).trim()}${SEP}${short}`;
}

/** The marker written into a loadout. off lists the preset block ids the working copy switched off. */
export function makeMarker({ base, edition = null, switches, off = [] }) {
    return { v: MARKER_VERSION, base: String(base || ''), edition: edition || null, switches: cleanSwitches(switches),
        off: [...new Set(off)].filter(id => typeof id === 'string'), saved: Date.now() };
}
function validMarker(value) {
    return value && typeof value === 'object' && value.v === MARKER_VERSION && typeof value.base === 'string'
        && value.switches && typeof value.switches === 'object' && Array.isArray(value.off)
        ? { ...value, switches: cleanSwitches(value.switches), off: value.off.filter(id => typeof id === 'string') } : null;
}

const commentText = marker => `{{// Roleplay Instructions loadout ${JSON.stringify(marker).replace(/\}\}/g, '} }')} }}`;
function readCommentRow(data) {
    const row = (data?.prompts || []).find(block => block?.identifier === MARKER_ROW);
    const match = /^\{\{\/\/ Roleplay Instructions loadout (\{.*\}) \}\}$/s.exec(String(row?.content || '').trim());
    if (!match) return null;
    try { return validMarker(JSON.parse(match[1])); } catch { return null; }
}

/** The marker of a preset object, from its extension data first, then from the comment-row fallback. */
export function readMarker(data) {
    return validMarker(data?.extensions?.[MARKER_KEY]?.loadout) || readCommentRow(data);
}

const sequence = data => data?.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order;

/**
 * A new preset object for a loadout: a deep copy of the source with the off block ids switched off in the
 * global prompt order and the marker in its extension data. carrier 'row' writes the comment row instead.
 */
export function buildLoadout(source, marker, { carrier = 'extensions' } = {}) {
    const data = structuredClone(source);
    if (!Array.isArray(data.prompts) || !Array.isArray(sequence(data))) throw new Error('This preset has no prompt order to save.');
    data.prompts = data.prompts.filter(block => block?.identifier !== MARKER_ROW);
    for (const group of data.prompt_order || []) if (Array.isArray(group?.order)) group.order = group.order.filter(entry => entry.identifier !== MARKER_ROW);
    const order = sequence(data);
    // Blocks an earlier marker switched off and this one no longer does come back on.
    const off = new Set(marker.off), earlier = new Set(readMarker(source)?.off || []);
    for (const entry of order) {
        if (off.has(entry.identifier)) entry.enabled = false;
        else if (earlier.has(entry.identifier)) entry.enabled = true;
    }
    data.extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
    const own = { ...(data.extensions[MARKER_KEY] || {}) };
    delete own.loadout;
    if (carrier === 'row') {
        data.prompts.push({ identifier: MARKER_ROW, name: 'Roleplay Instructions loadout marker', role: 'system', system_prompt: false,
            injection_position: 0, content: commentText(marker) });
        order.push({ identifier: MARKER_ROW, enabled: false });
    } else own.loadout = marker;
    if (Object.keys(own).length) data.extensions[MARKER_KEY] = own; else delete data.extensions[MARKER_KEY];
    return data;
}

/**
 * Ours features whose preset blocks are on in a loadout, named per block (the Conflict chip of DESIGN.md 7).
 * A block another feature on Theirs also uses is meant to stay on and is not a conflict.
 */
export function loadoutConflicts(marker, switches, blocks, featureBlocks) {
    if (!marker) return [];
    const enabled = new Map(blocks.filter(block => block.enabled).map(block => [block.id, block]));
    const owners = new Map();
    for (const [key, list] of Object.entries(featureBlocks)) for (const id of list) owners.set(id, [...(owners.get(id) || []), key]);
    const out = [];
    for (const [key, list] of Object.entries(featureBlocks)) {
        if (switches[key] !== 'ours') continue;
        const on = list.filter(id => enabled.has(id) && owners.get(id).every(owner => switches[owner] === 'ours')).map(id => enabled.get(id));
        if (on.length) out.push({ key, blocks: on });
    }
    return out;
}

/** Every loadout in a preset list as { name, marker }. */
export function listLoadouts(manager) {
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    if (!names) return [];
    const entries = Array.isArray(names) ? names.map((name, index) => [name, index]) : Object.entries(names);
    return entries.map(([name, index]) => ({ name, marker: readMarker(list.presets?.[index]) })).filter(item => item.marker)
        .sort((a, b) => a.name.localeCompare(b.name));
}

const stored = (manager, name) => {
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    const index = Array.isArray(names) ? names.indexOf(name) : names?.[name];
    return index === undefined || index < 0 ? null : list.presets?.[index] ?? null;
};
const exists = (manager, name) => !!stored(manager, name);

/** Save a new loadout preset. select true leaves it selected, as SillyTavern's Save as does. */
export async function saveLoadout(manager, { preset, name, data, marker, carrier }) {
    const full = loadoutName(preset, name);
    if (exists(manager, full)) throw new Error(`A preset named ${full} already exists.`);
    await manager.savePreset(full, buildLoadout(data, marker, { carrier }));
    return full;
}

/** Write fresh switches and block flags into an existing loadout. */
export async function updateLoadout(manager, name, data, marker, { carrier } = {}) {
    if (!exists(manager, name)) throw new Error(`The loadout ${name} is no longer in the preset list.`);
    const next = buildLoadout(data, marker, { carrier });
    await manager.savePreset(name, next, { skipUpdate: true });
    const target = stored(manager, name);
    if (target) for (const key of Object.keys(target)) delete target[key];
    if (target) Object.assign(target, structuredClone(next));
    return name;
}

/** Rename a loadout: the base part stays, the short name changes. */
export async function renameLoadout(manager, name, nextShort) {
    const data = stored(manager, name);
    const marker = readMarker(data);
    if (!marker) throw new Error(`The loadout ${name} is no longer in the preset list.`);
    const next = loadoutName(marker.base, nextShort);
    if (next === name) return name;
    if (exists(manager, next)) throw new Error(`A preset named ${next} already exists.`);
    const selected = manager.getSelectedPresetName?.() === name;
    await manager.savePreset(next, structuredClone(data), { skipUpdate: !selected });
    if (!selected) addToList(manager, next, structuredClone(data));
    await manager.deletePreset(name);
    return next;
}

function addToList(manager, name, data) {
    const list = manager.getPresetList?.();
    if (!list || exists(manager, name)) return;
    list.presets.push(data);
    const value = list.presets.length - 1;
    if (Array.isArray(list.preset_names)) list.preset_names[value] = name; else list.preset_names[name] = value;
    // SillyTavern's manager.select is a selector string in some builds and a jQuery object in others.
    const sel = manager.select;
    const select = typeof sel === 'string' ? globalThis.document?.querySelector?.(sel) : (sel?.[0] ?? null);
    if (select) {
        const option = globalThis.document.createElement('option');
        option.value = Array.isArray(list.preset_names) ? name : String(value);
        option.textContent = name;
        select.append(option);
    }
}

export async function deleteLoadout(manager, name) {
    if (!readMarker(stored(manager, name))) throw new Error(`${name} is not a loadout.`);
    return manager.deletePreset(name);
}
