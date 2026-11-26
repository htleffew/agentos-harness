// Saved loadouts (DESIGN.md 7): a working copy saved as its own SillyTavern preset named "<preset> + RI <name>",
// carrying a hidden marker of every Ours and Theirs switch. The marker lives in the preset's extension data
// (preset.extensions.roleplay_instructions.loadout), which SillyTavern keeps through save, export and import and
// never shows in the prompt list. A disabled comment-macro row is the fallback carrier (row 39 of DESIGN.md 12):
// SillyTavern keeps the row and its {{// ...}} macro expands to nothing, so the row sends no text even if enabled.
//
// Version 2 markers (A11 c.9 and c.3a, ticket B35) record the stack the loadout was made from: every card in its order with
// source, hash and on or off state, the extension's own cards (the RI group) as they stand, and the records of every
// customized version in the stack. The preset holds the blocks: the base's settings, the stack's blocks in her order, cards
// from other presets under their namespaced identifiers, her versions under ri-bank-mine-<version id>, and blocks she took
// out kept but switched off. Version 1 markers (switches and off ids) still read.
import { FEATURES, isSide, blockHash } from './preset-library.js';
import { settings, saveSettings, chatState, saveChatState } from './store.js';

export const MARKER_KEY = 'roleplay_instructions';
export const MARKER_ROW = 'ri-loadout-marker';
export const MARKER_V1 = 1;
export const MARKER_V2 = 2;
const SEP = ' + RI ';
const INSERT_FLAG = 'ri_bank_insert';
/** The field a block's first reply travels in, in a preset and in the bank (B56, B57). */
export const LOADOUT_GATE = 'ri_not_before';
const STACK_VERSION = 1;
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const copy = value => structuredClone(value);

// A reader from before Both drops the Both entries and uses its own sides; a marker written before Both holds none.
const sideOf = value => isSide(value) ? value : null;
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

/**
 * The marker written into a loadout. off lists the preset block ids the loadout switches off. A marker with a stack is
 * version 2: stack is { cards, ri } as the bank stores them (a card may carry send, the identifier of its block in the
 * preset) and versions maps a version id to its record.
 */
export function makeMarker({ base, edition = null, switches, off = [], stack = null, versions = null }) {
    const marker = { v: stack ? MARKER_V2 : MARKER_V1, base: String(base || ''), edition: edition || null, switches: cleanSwitches(switches),
        off: [...new Set(off)].filter(id => typeof id === 'string'), saved: Date.now() };
    if (stack) { marker.stack = { cards: copy(stack.cards || []), ri: copy(stack.ri || []) }; marker.versions = copy(versions || {}); }
    return marker;
}
const cleanItems = list => (Array.isArray(list) ? list : []).filter(item => item && typeof item === 'object' && typeof item.key === 'string' && item.key);
function validMarker(value) {
    if (!value || typeof value !== 'object' || typeof value.base !== 'string' || !value.switches || typeof value.switches !== 'object' || !Array.isArray(value.off)) return null;
    const base = { ...value, switches: cleanSwitches(value.switches), off: value.off.filter(id => typeof id === 'string') };
    if (value.v === MARKER_V1) return base;
    if (value.v !== MARKER_V2 || !value.stack || !Array.isArray(value.stack.cards) || !Array.isArray(value.stack.ri)) return null;
    const versions = value.versions && typeof value.versions === 'object' && !Array.isArray(value.versions) ? value.versions : {};
    return { ...base, stack: { cards: cleanItems(value.stack.cards), ri: cleanItems(value.stack.ri) },
        versions: Object.fromEntries(Object.entries(versions).filter(([, record]) => record && typeof record.text === 'string' && record.sourceId)
            .map(([id, record]) => [id, { ...record, id }])) };
}

// The comment macro ends at the first closing double brace. The JSON is indented, which keeps the braces that close nested
// objects apart, and each double brace left inside a string is written as a JSON escape.
const commentText = marker => `{{// Roleplay Instructions loadout ${JSON.stringify(marker, null, 1).replace(/\}\}/g, '}\\u007d').replace(/\{\{/g, '{\\u007b')} }}`;
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
    return writeLoadout(manager, name, buildLoadout(data, marker, { carrier }));
}
async function writeLoadout(manager, name, next) {
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
    moveLoadoutStack(name, next, data);
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
    const result = await manager.deletePreset(name);
    dropLoadoutStack(name);
    return result;
}

// ----------------------------------------------------------------------------------------------------------------------
// Loadouts from stacks (version 2, ticket B35)

const SOURCE_BASE = 'base';
const SOURCE_MINE = 'v';
const SOURCE_RI = 'ri';
const keyParts = key => {
    const text = String(key ?? '');
    const at = text.indexOf('::');
    return at < 0 ? { source: '', id: text } : { source: text.slice(0, at), id: text.slice(at + 2) };
};
/** The key a loadout's stack saves under (the bank's stackKey gives the same for a preset with a marker). */
export const loadoutStackKey = name => `loadout:${name}`;
const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
function stores() {
    const st = settings();
    for (const name of ['bankVersions', 'bankStacks', 'bankTexts']) {
        if (!st[name] || typeof st[name] !== 'object' || Array.isArray(st[name])) st[name] = {};
    }
    return st;
}
const pinsOf = () => chatState()?.v10?.bankPins || null;

function attachMarker(data, marker, carrier) {
    data.extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
    const mine = { ...(data.extensions[MARKER_KEY] || {}) };
    delete mine.loadout;
    if (carrier === 'row') {
        data.prompts.push({ identifier: MARKER_ROW, name: 'Roleplay Instructions loadout marker', role: 'system', system_prompt: false,
            injection_position: 0, content: commentText(marker) });
        sequence(data).push({ identifier: MARKER_ROW, enabled: false });
    } else mine.loadout = marker;
    if (Object.keys(mine).length) data.extensions[MARKER_KEY] = mine; else delete data.extensions[MARKER_KEY];
}

/** The display switches of a stack: a feature whose cards are all off reads Theirs, any other feature with a card reads Both. */
function switchesOfStack(ri, versions) {
    const state = {};
    for (const item of ri) {
        const { source, id } = keyParts(item.key);
        const feature = source === SOURCE_RI ? id : source === SOURCE_MINE && versions[id]?.source === SOURCE_RI ? versions[id].sourceId : '';
        if (Object.hasOwn(FEATURES, feature)) state[feature] = state[feature] || item.on === true;
    }
    return Object.fromEntries(Object.entries(state).map(([feature, on]) => [feature, on ? 'both' : 'theirs']));
}

/**
 * A new preset object for a loadout made from a stack. source is the base preset as it stands, work is { source, stack, plan }
 * as workingPlan() returns it, off the interim switch's block ids. The blocks are the ones the working copy sends at request
 * time (the same code builds both), so the loadout sends what the stack sends. Cards the stack holds but has off are kept as
 * blocks switched off. Resolves to { data, marker, sends }, sends mapping a card key to its block identifier in the preset.
 */
export async function buildStackLoadout(source, work, { base = '', off = [], edition = null, carrier = 'extensions' } = {}) {
    const [{ workingCopyChanges }, { savedWordingOf }] = await Promise.all([import('./preset-workbench.js'), import('./preset-bank-ri.js')]);
    const data = copy(source);
    if (!Array.isArray(data.prompts) || !Array.isArray(sequence(data))) throw new Error('This preset has no prompt order to save.');
    const stale = new Set(data.prompts.filter(block => block?.[INSERT_FLAG] === true).map(block => block.identifier));
    data.prompts = data.prompts.filter(block => block?.identifier !== MARKER_ROW && block?.[INSERT_FLAG] !== true);
    for (const group of data.prompt_order || []) if (Array.isArray(group?.order)) group.order = group.order.filter(entry => entry.identifier !== MARKER_ROW && !stale.has(entry.identifier));
    const order = sequence(data);
    const live = new Set(data.prompts.map(block => block?.identifier).filter(Boolean));
    const isBase = item => item.source === SOURCE_BASE && live.has(item.id);
    const kept = new Set(work.plan.filter(item => item.group === 'main' && !item.on && !item.marker && !isBase(item)).map(item => item.key));
    const plan = work.plan.map(item => kept.has(item.key) ? { ...item, on: true } : item);
    const changes = workingCopyChanges(data, { source: work.source, plan }, {});
    const insertedMain = plan.filter(item => item.group === 'main' && item.on && !item.marker && !isBase(item));
    const insertedRi = plan.filter(item => item.group === 'ri' && item.source !== SOURCE_RI && item.on && !savedWordingOf(item));
    if (changes.inserts.length !== insertedMain.length + insertedRi.length) throw new Error('The stack could not be matched to its blocks.');
    for (const { entry, value, added } of changes.flags) if (!added) entry.enabled = value;
    for (const { prompt, value } of changes.texts) prompt.content = value;
    const sends = new Map();
    for (const item of plan) if (item.group === 'main' && isBase(item)) sends.set(item.key, item.id);
    [...insertedMain, ...insertedRi].forEach((item, index) => sends.set(item.key, changes.inserts[index].identifier));
    for (const prompt of changes.inserts) delete prompt[INSERT_FLAG];
    data.prompts.push(...changes.inserts);
    // B57: her role, position and depth on a base row stay on its block, and each card's first reply goes on its block.
    for (const { prompt, values } of changes.fields) Object.assign(prompt, values);
    const blockOf = new Map(data.prompts.map(block => [block?.identifier, block]));
    for (const item of plan) {
        const block = sends.has(item.key) ? blockOf.get(sends.get(item.key)) : null;
        if (!block || block.marker) continue;
        if (Number.isInteger(item.notBefore) && item.notBefore > 1) block[LOADOUT_GATE] = Math.min(item.notBefore, 100000); else delete block[LOADOUT_GATE];
    }
    order.splice(0, order.length, ...changes.order);
    const entries = new Map(order.map(entry => [entry.identifier, entry]));
    for (const key of kept) { const entry = entries.get(sends.get(key)); if (entry) entry.enabled = false; }
    const withSend = item => sends.has(item.key) ? { ...copy(item), send: sends.get(item.key) } : copy(item);
    const cards = work.stack.cards.map(withSend), ri = work.stack.ri.map(withSend);
    const records = stores().bankVersions, versions = {};
    for (const item of [...cards, ...ri]) {
        const { source: kind, id } = keyParts(item.key);
        if (kind === SOURCE_MINE && own(records, id)) versions[id] = copy(records[id]);
    }
    const sent = new Set(sends.values());
    const marker = makeMarker({ base: base || work.stack.base, edition, switches: switchesOfStack(ri, versions),
        off: order.filter(entry => entry.enabled !== true && sent.has(entry.identifier)).map(entry => entry.identifier), stack: { cards, ri }, versions });
    attachMarker(data, marker, carrier);
    return { data, marker, sends };
}

// ----------------------------------------------------------------------------------------------------------------------
// Restoring a stack from a marker

/**
 * Put a marker's customized versions in her settings. A version id she does not have is added as it was. An id she has with the
 * same text stays. An id she has with other text keeps her version, and the loadout's version is added beside it under a new
 * id, named "(imported)"; the same import twice adds nothing more. Returns { old id: id it is stored under } for the ids that moved.
 */
export function importVersions(versions) {
    const records = stores().bankVersions, remap = {};
    let changed = false;
    for (const [id, record] of Object.entries(versions || {})) {
        const present = own(records, id);
        if (!present) { put(records, id, copy(record)); changed = true; continue; }
        if (present.text === record.text) continue;
        const earlier = Object.values(records).find(item => item.importedFrom === id && item.text === record.text);
        if (earlier) { remap[id] = earlier.id; continue; }
        let next = `${id}-imp`;
        for (let n = 2; own(records, next); n++) next = `${id}-imp${n}`;
        const time = Date.now();
        put(records, next, { ...copy(record), id: next, label: `${record.label || 'Version'} (imported)`, importedFrom: id, created: time, edited: time });
        remap[id] = next;
        changed = true;
    }
    if (changed) saveSettings();
    return remap;
}

/**
 * Write the stack a loadout's marker records as the stored stack of that loadout, with its versions and the texts of its cards
 * (read from the blocks the loadout holds). A chat pin is left alone. Without force an existing stored stack is kept. Returns the
 * stack, or null for a loadout with no stack (version 1), a pinned stack or a kept one.
 */
export function restoreLoadoutStack(name, data, { force = false } = {}) {
    const marker = readMarker(data);
    if (!marker?.stack) return null;
    const key = loadoutStackKey(name);
    const st = stores();
    if (own(pinsOf(), key)) return null;
    if (!force && own(st.bankStacks, key)) return null;
    const remap = importVersions(marker.versions);
    const blocks = new Map((data.prompts || []).map(block => [block?.identifier, block]));
    const rememberText = item => {
        const block = item.send ? blocks.get(item.send) : null;
        if (block && typeof block.content === 'string' && item.hash && blockHash(block.content) === item.hash && !Object.hasOwn(st.bankTexts, item.hash)) put(st.bankTexts, item.hash, block.content);
    };
    const mapItem = item => {
        rememberText(item);
        const { send, ...rest } = copy(item);
        const { source, id } = keyParts(rest.key);
        if (source === SOURCE_MINE) {
            const now = own(remap, id) || id;
            Object.assign(rest, { key: `${SOURCE_MINE}::${now}`, id: now });
            const record = own(st.bankVersions, now);
            if (record) rest.hash = blockHash(record.text);
        }
        return rest;
    };
    const stack = { v: STACK_VERSION, key, base: name, created: marker.saved || Date.now(), edited: marker.saved || Date.now(),
        cards: marker.stack.cards.map(mapItem), ri: marker.stack.ri.map(mapItem) };
    put(st.bankStacks, key, stack);
    saveSettings();
    return copy(stack);
}

/** A version 1 loadout's stack: the stack the bank starts from the loadout's own blocks, with the cards of Theirs features off. */
export function legacyStack(stack, marker) {
    if (!stack || !marker || marker.stack) return stack;
    for (const item of stack.ri || []) {
        const { source, id } = keyParts(item.key);
        if (source === SOURCE_RI && marker.switches?.[id] === 'theirs') item.on = false;
    }
    return stack;
}

function moveLoadoutStack(from, to, data) {
    const st = stores(), oldKey = loadoutStackKey(from), newKey = loadoutStackKey(to), pins = pinsOf();
    if (pins && own(pins, oldKey) && !own(pins, newKey)) { put(pins, newKey, { ...pins[oldKey], key: newKey, base: to }); delete pins[oldKey]; saveChatState(); }
    if (readMarker(data)?.stack) { delete st.bankStacks[oldKey]; restoreLoadoutStack(to, data, { force: true }); }
    else if (own(st.bankStacks, oldKey)) { put(st.bankStacks, newKey, { ...st.bankStacks[oldKey], key: newKey, base: to }); delete st.bankStacks[oldKey]; }
    saveSettings();
}
function dropLoadoutStack(name) {
    const st = stores(), key = loadoutStackKey(name), pins = pinsOf();
    if (own(st.bankStacks, key)) delete st.bankStacks[key];
    if (pins && own(pins, key)) { delete pins[key]; saveChatState(); }
    saveSettings();
}

// ----------------------------------------------------------------------------------------------------------------------
// The check list note

/**
 * Notes for the check list (A11 c.9): a block that is on in SillyTavern's prompt manager but that the loadout leaves out, either
 * as a card it holds switched off or because the stack does not hold it. The loadout sends the preset as saved, so such a block
 * is sent; the note says so and names the block. Information only, nothing here changes the preset.
 */
export function loadoutNotes(marker, data) {
    if (!marker?.stack || !data) return [];
    const held = new Map();
    for (const item of [...marker.stack.cards, ...marker.stack.ri]) {
        const { source, id } = keyParts(item.key);
        const send = item.send || (source === SOURCE_BASE ? id : '');
        if (send && !held.has(send)) held.set(send, item);
    }
    const prompts = new Map((data.prompts || []).map(block => [block?.identifier, block]));
    const out = [];
    for (const entry of sequence(data) || []) {
        const id = entry?.identifier;
        if (!id || entry.enabled !== true || id === MARKER_ROW) continue;
        const item = held.get(id);
        if (item?.on) continue;
        const block = prompts.get(id);
        const key = item?.key || `${SOURCE_BASE}::${id}`;
        const name = String(item?.name || block?.name || id);
        out.push({ id: `loadout-left-out:${id}`, kind: 'loadout-left-out', level: 'warn', loadout: true, left: item ? 'off' : 'missing',
            text: `${name} is on in the prompt manager, but this loadout left it out. It is sent anyway; turn it off in the prompt manager or update the loadout.`,
            cards: [{ key, name, source: String(item?.sourceName || marker.base), sourceKey: keyParts(key).source, on: true, link: `#bank-card=${encodeURIComponent(key)}` }] });
    }
    return out;
}

// ----------------------------------------------------------------------------------------------------------------------
// Saving and updating from the stack

const sourceOfBase = (bank, name) => {
    const sid = bank?.sids && Object.hasOwn(bank.sids, name) ? bank.sids[name] : '';
    return (sid && bank.sources.get(`p:${sid}`)) || null;
};

/**
 * What a loadout is built from for a switch context: { base, source, work, off, edition }. A preset gives its working plan. A
 * loadout gives its own stack read against the base preset it was made from (a version 1 loadout, whose stack starts from its
 * own blocks, is built from itself and becomes a version 2 loadout on its next update).
 */
export async function loadoutInputs(manager, context) {
    const [wb, bank] = await Promise.all([import('./preset-workbench.js'), import('./preset-bank.js')]);
    if (!context) throw new Error('Select a Chat Completion preset first.');
    const marker = context.marker;
    if (!marker) {
        const work = wb.workingPlan(context);
        if (!work) throw new Error('This preset has no stack to save yet. Open Setup, Presets once and try again.');
        return { base: context.preset, source: context.data, work, off: [], edition: context.edition?.key || null };
    }
    let baseName = context.preset, source = context.data;
    if (marker.stack) {
        const found = bank.listedPresets(manager).find(entry => entry.name === marker.base);
        if (!found) throw new Error(`The base preset ${marker.base} is no longer in the preset list, so ${context.preset} cannot be rebuilt from it.`);
        baseName = marker.base;
        source = found.data;
    }
    restoreLoadoutStack(context.preset, context.data);
    let b = bank.currentBank() || bank.refreshBank('loadout');
    if (!sourceOfBase(b, baseName)) b = bank.refreshBank('loadout');
    const stack = bank.stackFor(b, context.preset, context.data);
    const sourceCards = sourceOfBase(b, baseName);
    if (!stack || !sourceCards) throw new Error(`The preset ${baseName} is not in the bank yet.`);
    return { base: marker.base, source, work: { bank: b, stack, source: sourceCards, plan: bank.stackPlan(b, stack, baseName) }, off: [], edition: marker.edition || null };
}

/** Save the selected stack (or loadout) as a new loadout preset named "<preset> + RI <name>". The loadout is left selected. */
export async function saveLoadoutFromContext(manager, name, context, { carrier } = {}) {
    const input = await loadoutInputs(manager, context);
    const full = loadoutName(input.base, name);
    if (exists(manager, full)) throw new Error(`A preset named ${full} already exists.`);
    const { data } = await buildStackLoadout(input.source, input.work, { base: input.base, off: input.off, edition: input.edition, carrier });
    await manager.savePreset(full, data);
    restoreLoadoutStack(full, data, { force: true });
    return full;
}

/** Write the selected loadout's current stack back into it. */
export async function updateLoadoutFromContext(manager, name, context, { carrier } = {}) {
    if (!exists(manager, name)) throw new Error(`The loadout ${name} is no longer in the preset list.`);
    if (!context?.marker || context.preset !== name) throw new Error('Select this loadout first; Update writes its stack back into it.');
    const input = await loadoutInputs(manager, context);
    const { data } = await buildStackLoadout(input.source, input.work, { base: input.base, off: input.off, edition: input.edition, carrier });
    await writeLoadout(manager, name, data);
    restoreLoadoutStack(name, data, { force: true });
    return name;
}
