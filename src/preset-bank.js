// Block bank, customized versions and the stack (A11 c.2 to c.4, ticket B29; DECISIONS.md, 24 November 2026).
//
// The bank indexes every Chat Completion preset in SillyTavern's preset list, the extension's own feature cards (RI)
// and the companion preset, with nothing added by hand. A card is keyed by source and identifier and carries the P1 block
// hash of its text; feature tags label cards and never decide anything. Her edits of any card are customized versions,
// stored in settings().bankVersions beside the unchanged clean card; no function here writes to a preset.
// The stack is the ordered list of cards the next request sends for one base, saved per edition key with an optional chat
// pin. It starts with everything on and changes only through the tap functions below (include, exclude, move, take the new
// text, undo, pin). Refreshes, tags, profiles, preset changes and migration read stacks and never reorder or exclude a card.
//
// Card keys:
//   base::<id>        a block of the selected base preset (one stack serves every preset of an edition)
//   p:<sid>::<id>     a block of another preset in the list; sid is a stable source id that survives a rename
//   companion::<id>   a block of the companion preset
//   ri::<feature>     the extension's own card for one feature (sent in the fixed RI group at depth 0)
//   v::<version id>   one of her customized versions
//   imp:<iid>::<id>   a block read from a preset or plugin file by the option bank import (B37), one source per file
import { ctx, on } from './st.js';
import { settings, saveSettings, chatState, saveChatState } from './store.js';
import { FEATURES, FEATURE_KEYS, blockHash, loadLibrary } from './preset-library.js';
import { readMarker, restoreLoadoutStack, legacyStack } from './preset-loadouts.js';
import { estimateTokens } from './context-budget.js';
import { MODULE_PROMPTS, moduleOrder } from './module-layout.js';
import { promptText } from './prompts.js';
import { DEFAULT_MODULES, PRESET, isCompanionPreset, presetDefaults, blockCompanions, activePreset, stripPresetComments } from './v10.js';

export const BANK_VERSION = 1;
export const SOURCE_BASE = 'base';
export const SOURCE_RI = 'ri';
export const SOURCE_COMPANION = 'companion';
export const SOURCE_MINE = 'v';
export const RI_LABEL = 'Roleplay Instructions';
const SEP = '::';
const UNDO_DEPTH = 10;

// Host rows SillyTavern fills itself; only the base supplies them (the landmarks of A11 c.2).
export const HOST_MARKERS = Object.freeze(['chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'dialogueExamples', 'charDescription',
    'charPersonality', 'scenario', 'personaDescription']);
const LANDMARK = new Set(HOST_MARKERS);
// Recognition leaves these out (the P1 recognition rule, as in preset-library.js).
const STOCK = new Set(['main', 'nsfw', 'jailbreak', 'chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'enhanceDefinitions',
    'dialogueExamples', 'charDescription', 'charPersonality', 'scenario', 'personaDescription']);
const HOST_NAMES = new Set(['agent system prompt', 'agent task', 'agent results']);

const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const copy = value => structuredClone(value);
const now = () => Date.now();

export const cardKey = (source, id) => `${source}${SEP}${id}`;
/** { source, id } of a card key. */
export function parseKey(key) {
    const text = String(key ?? '');
    const at = text.indexOf(SEP);
    return at < 0 ? { source: '', id: text } : { source: text.slice(0, at), id: text.slice(at + SEP.length) };
}
export const presetSource = sid => `p:${sid}`;
export const importSource = iid => `imp:${iid}`;
export const isImportSource = source => /^imp:/.test(String(source));
export const isPresetSource = source => /^p:/.test(String(source));
export const sidOf = source => isPresetSource(source) ? String(source).slice(2) : '';
/** The RI group holds the extension's cards and her versions of them; every other card is in the main group. */
export const groupOf = card => card?.source === SOURCE_RI || card?.origin === SOURCE_RI ? 'ri' : 'main';

// ----------------------------------------------------------------------------------------------------------------------
// Preset objects

const globalOrder = data => data?.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order
    || data?.prompt_order?.[0]?.order || [];

/** Every preset of a manager's list as { name, data }, in list order. A deleted preset that the host left in its array is skipped. */
export function listedPresets(manager) {
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    if (!names) return [];
    const pairs = Array.isArray(names) ? names.map((name, index) => [name, index]) : Object.entries(names);
    return pairs.map(([name, index]) => ({ name: String(name), data: list.presets?.[index] }))
        .filter(entry => entry.name && entry.data && typeof entry.data === 'object');
}

const placementOf = block => ({ position: block?.injection_position === 1 ? 1 : 0, depth: Number.isInteger(block?.injection_depth) ? block.injection_depth : 4,
    order: Number.isInteger(block?.injection_order) ? block.injection_order : 100,
    triggers: Array.isArray(block?.injection_trigger) ? block.injection_trigger.filter(item => typeof item === 'string') : [] });
export const ROLES = Object.freeze(['system', 'user', 'assistant']);
const roleOf = role => ROLES.includes(role) ? role : 'system';
/**
 * The reply-number gate a preset wrote as one macro around the whole block, {{if {{getvar::turn}} >= N}}...{{/if}}, as
 * { at: N, body }, or null. A gate inside other text (an init block that counts the turns) is the preset's own macro.
 */
const WRAPPED = /^\s*\{\{if\s+\{\{getvar::turn\}\}\s*>=\s*(\d+)\s*\}\}([\s\S]*)\{\{\/if\}\}\s*$/;
export function wrappedGate(text) {
    const match = String(text ?? '').match(WRAPPED);
    if (!match || /\{\{\/?if\b/.test(match[2])) return null;
    return { at: Number(match[1]), body: match[2] };
}
/** A reply number gate: the first reply the block is sent with; 0 and 1 both mean from the first reply. */
export const gateValue = value => Number.isInteger(value) && value > 0 ? Math.min(value, 100000) : 0;
/** The field an imported block's reply-number gate travels in from its stored record to its card. */
const GATE_FIELD = 'ri_not_before';
/** Whether a card with this gate is sent with the reply numbered reply. */
export const gateOpen = (notBefore, reply) => !(gateValue(notBefore) > 1 && Number.isFinite(reply) && reply < notBefore);
const plainText = text => stripPresetComments(text);
/** The token estimate a card shows: comments stripped, as the block editor does today. */
export const cardTokens = text => estimateTokens(plainText(text));
/** Macros can expand or vanish, so a card with any macro other than a comment shows its raw size. */
export const hasMacros = text => /\{\{(?!\/\/)/.test(String(text ?? ''));

// ----------------------------------------------------------------------------------------------------------------------
// Hashing with a per-card cache: a refresh compares each block's text with the text it indexed and hashes only what changed.

let hashCalls = 0;
const memo = new Map();
function hashOf(text) {
    const cached = memo.get(text);
    if (cached !== undefined) return cached;
    hashCalls++;
    const value = blockHash(text);
    if (memo.size > 60000) memo.clear();
    memo.set(text, value);
    return value;
}

// ----------------------------------------------------------------------------------------------------------------------
// Recognition over indexed cards (the P1 rule of preset-library.js recognize(), run on hashes the index already holds).

export function recognizeCards(cards, library) {
    if (!library?.editions?.length) return null;
    const ids = new Set(), hashes = new Set(), large = new Set();
    for (const card of cards) {
        if (!STOCK.has(card.id) && !HOST_NAMES.has(card.name.toLowerCase())) ids.add(card.id);
        if (card.hash) { hashes.add(card.hash); if (card.text.length > 40) large.add(card.hash); }
    }
    const share = (list, set) => {
        if (!list.length) return 0;
        let n = 0;
        for (const item of list) if (set.has(item)) n++;
        return n / list.length;
    };
    let best = null;
    for (const edition of library.editions) {
        const r = edition.recognize;
        const score = r.mode === 'coverage-pair' ? (share(r.ids, ids) + share(r.hashes, large)) / 2
            : Math.max(share(r.ids, ids), share(r.hashes, hashes), r.main && hashes.has(r.main) ? 1 : 0);
        const tiebreak = Math.min(ids.size, r.own) / Math.max(ids.size, r.own, 1) / 1000;
        const total = Math.round(score * 1000) / 1000 + tiebreak;
        if (!best || total > best.total) best = { edition, score: Math.round(score * 1000) / 1000, total };
    }
    return best && best.score >= 0.5 ? { edition: best.edition, score: best.score } : null;
}

/** Feature tags per block id from a recognised edition, with the P1 verdict for each. */
function editionTags(edition) {
    const tags = new Map();
    for (const group of [edition?.modules, edition?.optional]) for (const [key, item] of Object.entries(group || {})) {
        for (const id of item.ids || []) {
            const entry = tags.get(id) || {};
            if (!entry[key]) entry[key] = item.verdict || '';
            tags.set(id, entry);
        }
    }
    return tags;
}

// ----------------------------------------------------------------------------------------------------------------------
// The index

/**
 * Index one source. prev is the same source from the previous index, or null. Returns the source and how many blocks
 * it hashed. Two blocks with the same identifier in one preset keep two cards (the second gets a #2 suffix).
 */
function indexSource({ key, kind, name, data, sid = '' }, prev, context) {
    const order = globalOrder(data);
    const flags = new Map();
    order.forEach((row, index) => { if (row?.identifier && !flags.has(row.identifier)) flags.set(row.identifier, { on: row.enabled === true, index }); });
    const prevCards = prev?.byId || new Map();
    if (prev && prev.name === name && sameSource(prev, data, flags, order.length)) { prev.data = data; prev.name = name; return { source: prev, hashed: 0, changed: false }; }
    const before = hashCalls;
    const cards = [], byId = new Map(), seen = new Map();
    let changed = !prev;
    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
    for (const block of prompts) {
        if (typeof block?.identifier !== 'string' || !block.identifier) continue;
        const count = (seen.get(block.identifier) || 0) + 1;
        seen.set(block.identifier, count);
        const id = count > 1 ? `${block.identifier}#${count}` : block.identifier;
        const text = typeof block.content === 'string' ? block.content : String(block.content ?? '');
        const marker = block.marker === true;
        const old = prevCards.get(id);
        const hash = marker ? '' : old && old.text === text ? old.hash : hashOf(text);
        const flag = count === 1 ? flags.get(block.identifier) : null;
        const card = { key: cardKey(key, id), source: key, kind, sourceName: name, sid, id, name: String(block.name || block.identifier),
            text, hash, marker, landmark: marker && LANDMARK.has(block.identifier), systemPrompt: block.system_prompt === true,
            role: roleOf(block.role), placement: placementOf(block), notBefore: gateValue(block[GATE_FIELD]),
            listed: !!flag, shippedOn: flag?.on === true, index: flag ? flag.index : order.length + cards.length,
            tokens: marker ? 0 : cardTokens(text), raw: hasMacros(text), tags: [], verdicts: {},
            changedAt: old && old.hash !== hash ? context.at : old?.changedAt || 0, previousHash: old && old.hash !== hash ? old.hash : old?.previousHash || '' };
        if (!old || old.hash !== hash || old.name !== card.name || old.marker !== marker || old.notBefore !== card.notBefore || old.role !== card.role
            || JSON.stringify(old.placement) !== JSON.stringify(card.placement)) changed = true;
        cards.push(card);
        byId.set(id, card);
    }
    if (prev && prev.cards.length !== cards.length) changed = true;
    cards.sort((a, b) => a.index - b.index);
    return { source: { key, kind, name, sid, cards, byId, hashes: new Set(cards.map(card => card.hash).filter(Boolean)), orderLength: order.length,
        recognized: changed ? undefined : prev.recognized, data }, hashed: hashCalls - before, changed };
}

/** True when every block of a preset reads as the indexed source holds it: same text, name, role, placement and order flags. */
function sameSource(prev, data, flags, orderLength) {
    const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
    let n = 0;
    const seen = new Map();
    for (const block of prompts) {
        if (typeof block?.identifier !== 'string' || !block.identifier) continue;
        const count = (seen.get(block.identifier) || 0) + 1;
        seen.set(block.identifier, count);
        const card = prev.byId.get(count > 1 ? `${block.identifier}#${count}` : block.identifier);
        const flag = count === 1 ? flags.get(block.identifier) : null;
        const text = typeof block.content === 'string' ? block.content : String(block.content ?? '');
        if (!card || card.text !== text || card.name !== String(block.name || block.identifier) || card.marker !== (block.marker === true)
            || card.role !== (roleOf(block.role)) || card.listed !== !!flag
            || card.shippedOn !== (flag?.on === true) || (flag && card.index !== flag.index) || card.notBefore !== gateValue(block[GATE_FIELD])
            || JSON.stringify(card.placement) !== JSON.stringify(placementOf(block))) return false;
        n++;
    }
    return n === prev.cards.length && prev.orderLength === orderLength;
}

function tagSource(source, library, nameTags, ownTags, stamp) {
    if (source.kind === 'ri') return;
    if (stamp !== undefined && source.tagStamp === stamp) return;
    source.tagStamp = stamp;
    if (source.recognized === undefined) source.recognized = library ? recognizeCards(source.cards, library) : null;
    const edition = source.recognized?.edition || null;
    const fromEdition = edition ? editionTags(edition) : null;
    for (const card of source.cards) {
        const mine = own(ownTags, card.key);
        let verdicts = {};
        if (fromEdition?.has(card.id)) verdicts = { ...fromEdition.get(card.id) };
        else if (!card.marker) for (const key of safeTags(nameTags, card, source)) verdicts[key] = '';
        card.verdicts = verdicts;
        card.tags = Array.isArray(mine) ? mine.filter(key => typeof key === 'string') : Object.keys(verdicts);
        card.tagged = Array.isArray(mine) ? 'hers' : fromEdition?.has(card.id) ? 'library' : card.tags.length ? 'name' : '';
    }
}
function safeTags(nameTags, card, source) {
    try { return (nameTags?.({ id: card.id, name: card.name }, source.name) || []).filter(key => typeof key === 'string'); } catch { return []; }
}

/**
 * Build the bank from plain input. Pure apart from the hash cache; prev is the previous bank, so unchanged blocks keep
 * their hash without hashing again.
 *   presets   [{ name, data }] every Chat Completion preset in the list (the companion is picked out of it)
 *   companion { name, data } used when the list holds no companion preset (the extension's shipped file)
 *   ri        [{ id, name, text, on, tags }] the extension's feature cards
 *   sids      { [preset name]: sid } the stable source ids, updated in place for new names and renames
 *   renamed   [{ from, to }] renames the host reported, applied before the hash match
 *   library   the compact P1 map, or null
 *   nameTags  (block, presetName) => feature keys, for blocks the library does not tag
 *   tags      { [card key]: feature keys } her own tags
 */
export function indexBank(input = {}, prev = null) {
    const started = globalThis.performance?.now?.() ?? now();
    const context = { at: now() };
    const sids = input.sids || {};
    const presets = (input.presets || []).filter(entry => entry?.name && entry.data);
    const companionEntry = pickCompanion(presets) || (input.companion?.data ? input.companion : null);
    const listed = presets.filter(entry => entry !== companionEntry);
    const names = new Set(listed.map(entry => entry.name));
    const renames = [];
    // A rename the host reported wins over a sid an earlier refresh gave the new name while both names were listed.
    for (const { from, to } of input.renamed || []) {
        if (own(sids, from) && names.has(to) && !names.has(from)) { sids[to] = sids[from]; delete sids[from]; renames.push({ from, to, sid: sids[to], by: 'event' }); }
    }
    const used = new Set(Object.values(sids));
    const liveSids = new Set(listed.map(entry => own(sids, entry.name)).filter(Boolean));
    // Sources that left the list since the last index, with the hashes they held (for the rename match).
    const vanished = new Map();
    for (const source of prev?.sources?.values?.() || []) if (source.kind === 'preset' && !liveSids.has(source.sid)) vanished.set(source.sid, source.hashes);
    for (const [sid, hashes] of Object.entries(input.knownHashes || {})) if (!liveSids.has(sid) && !vanished.has(sid)) vanished.set(sid, new Set(hashes));
    const sources = new Map();
    let hashed = 0;
    const rehashed = [];
    const results = [];
    for (const entry of listed) {
        let sid = own(sids, entry.name);
        let fresh = null;
        if (!sid) {
            fresh = indexSource({ key: 'p:?', kind: 'preset', name: entry.name, data: entry.data }, null, context);
            const match = renameMatch(fresh.source.hashes, vanished);
            if (match) { sid = match; vanished.delete(match); const from = Object.keys(sids).find(name => sids[name] === match && !names.has(name));
                if (from) delete sids[from]; renames.push({ from: from || '', to: entry.name, sid, by: 'hash' }); }
            else sid = newSid(entry.name, used);
            sids[entry.name] = sid;
            used.add(sid);
        }
        const key = presetSource(sid);
        const previous = prev?.sources?.get(key) || null;
        const result = fresh ? rekey(fresh, key, sid, previous, context) : indexSource({ key, kind: 'preset', name: entry.name, data: entry.data, sid }, previous, context);
        results.push(result);
    }
    if (companionEntry) {
        results.push(indexSource({ key: SOURCE_COMPANION, kind: 'companion', name: companionEntry.name, data: companionEntry.data },
            prev?.sources?.get(SOURCE_COMPANION)?.name === companionEntry.name ? prev.sources.get(SOURCE_COMPANION) : null, context));
    }
    for (const result of results) {
        hashed += result.hashed;
        if (result.hashed) rehashed.push(result.source.name);
        tagSource(result.source, input.library || null, input.nameTags, input.tags, input.tagStamp);
        sources.set(result.source.key, result.source);
    }
    for (const record of Object.values(input.imports || {})) {
        if (!record?.id || !Array.isArray(record.blocks)) continue;
        const key = importSource(record.id);
        const result = indexSource({ key, kind: 'import', name: record.name || record.file || 'Imported file', data: importData(record) }, prev?.sources?.get(key) || null, context);
        for (const card of result.source.cards) card.lineage = { file: record.file || '', block: own(record.lineage, card.id) || card.name, at: record.at || 0 };
        result.source.file = record.file || '';
        hashed += result.hashed;
        if (result.hashed) rehashed.push(result.source.name);
        tagSource(result.source, null, input.nameTags, input.tags, input.tagStamp);
        sources.set(key, result.source);
    }
    const ri = riSource(input.ri || [], prev?.sources?.get(SOURCE_RI), context);
    hashed += ri.hashed;
    sources.set(SOURCE_RI, ri.source);
    const cards = new Map();
    for (const source of sources.values()) for (const card of source.cards) cards.set(card.key, card);
    const ms = (globalThis.performance?.now?.() ?? now()) - started;
    return { v: BANK_VERSION, sources, cards, sids, renames, at: context.at,
        removed: [...vanished.keys()], stats: { sources: sources.size, cards: cards.size, hashed, rehashed, ms } };
}

/** An imported file's blocks in the shape of a preset with no prompt order: every block waits in the bank for her tap. */
function importData(record) {
    return { prompts: record.blocks.map(block => {
        const placement = block.placement || {};
        return { identifier: block.id, name: block.name, content: block.text, role: block.role || 'system',
            ...(placement.position === 1 ? { injection_position: 1 } : {}), ...(Number.isInteger(placement.depth) ? { injection_depth: placement.depth } : {}),
            ...(Number.isInteger(placement.order) ? { injection_order: placement.order } : {}),
            ...(Array.isArray(placement.triggers) ? { injection_trigger: placement.triggers } : {}),
            ...(gateValue(block.notBefore) ? { [GATE_FIELD]: block.notBefore } : {}) };
    }), prompt_order: [] };
}

function pickCompanion(presets) {
    const all = presets.filter(entry => isCompanionPreset(entry.name));
    return all.find(entry => entry.name === PRESET) || all.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))[0] || null;
}
function rekey(result, key, sid, previous, context) {
    if (previous) return indexSource({ key, kind: 'preset', name: result.source.name, data: result.source.data, sid }, previous, context);
    const source = result.source;
    source.key = key; source.sid = sid;
    for (const card of source.cards) { card.key = cardKey(key, card.id); card.source = key; card.sid = sid; }
    return result;
}
/** A new preset whose block hashes cover at least 90 percent of a vanished source's hashes is that source renamed. */
function renameMatch(hashes, vanished) {
    let best = null;
    for (const [sid, old] of vanished) {
        if (!old?.size) continue;
        let n = 0;
        for (const hash of old) if (hashes.has(hash)) n++;
        const share = n / old.size;
        if (share >= 0.9 && (!best || share > best.share)) best = { sid, share };
    }
    return best?.sid || '';
}
function newSid(name, used) {
    let seed = `source:${name}`, sid = blockHash(seed).slice(0, 10);
    for (let n = 2; used.has(sid) || !sid; n++) { seed = `source:${name}#${n}`; sid = blockHash(seed).slice(0, 10); }
    return sid;
}

function riSource(list, prev, context) {
    const before = hashCalls;
    const cards = list.filter(item => item && Object.hasOwn(FEATURES, item.id)).map((item, index) => {
        const text = String(item.text ?? '');
        const old = prev?.byId?.get(item.id);
        const hash = old && old.text === text ? old.hash : hashOf(text);
        return { key: cardKey(SOURCE_RI, item.id), source: SOURCE_RI, kind: 'ri', sourceName: RI_LABEL, sid: '', id: item.id,
            name: item.name || FEATURES[item.id].label, text, hash, marker: false, landmark: false, systemPrompt: false, role: 'system',
            placement: { position: 1, depth: 0, order: 100, triggers: [] }, listed: true, shippedOn: item.on === true, index,
            tokens: cardTokens(text), raw: hasMacros(text), tags: Array.isArray(item.tags) ? item.tags : [item.id], verdicts: {}, tagged: 'library',
            live: item.live || '', changedAt: 0, previousHash: '' };
    });
    return { source: { key: SOURCE_RI, kind: 'ri', name: RI_LABEL, sid: '', cards, byId: new Map(cards.map(card => [card.id, card])),
        hashes: new Set(cards.map(card => card.hash)), recognized: null }, hashed: hashCalls - before };
}

/** The shipped-on blocks of one source in its own order (the tap that puts a whole source in at once). */
export function shippedOn(bank, sourceKey) {
    return (bank?.sources?.get(sourceKey)?.cards || []).filter(card => card.shippedOn && !card.marker).map(card => card.key);
}

// ----------------------------------------------------------------------------------------------------------------------
// Default RI cards. B31 supplies the full cards through setRiCards(); until then each feature's card holds its stored prompts.

let riProvider = null;
/** Replace the provider of the extension's cards: () => [{ id, name, text, on, tags, live }]. */
export const setRiCards = fn => { riProvider = typeof fn === 'function' ? fn : null; };
export function featureOn(preset = activePreset()) {
    const modules = { ...DEFAULT_MODULES, ...presetDefaults(preset), ...(chatState()?.v10?.modules || {}) };
    return Object.fromEntries(FEATURE_KEYS.map(key => [key, modules[key] === true]));
}
function defaultRiCards(preset) {
    const enabled = featureOn(preset);
    const order = moduleOrder(chatState()?.v10?.moduleOrder);
    const keys = [...order.filter(key => Object.hasOwn(FEATURES, key)), ...FEATURE_KEYS.filter(key => !order.includes(key))];
    return keys.map(key => ({ id: key, name: FEATURES[key].label, on: enabled[key],
        text: (MODULE_PROMPTS[key] || []).map(id => { try { return promptText(id); } catch { return ''; } }).filter(Boolean).join('\n\n'),
        live: FEATURES[key].ours, tags: [key] }));
}
const riCards = preset => { try { return (riProvider || defaultRiCards)(preset) || []; } catch (error) { console.warn('Roleplay Instructions could not read its feature cards.', error); return []; } };

// ----------------------------------------------------------------------------------------------------------------------
// Settings stores

function stores() {
    const st = settings();
    for (const name of ['bankVersions', 'bankStacks', 'bankTexts', 'bankSources', 'bankTags', 'bankImports']) {
        if (!st[name] || typeof st[name] !== 'object' || Array.isArray(st[name])) st[name] = {};
    }
    return st;
}
const put = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });

/**
 * Bring the bank's stores to the current shape. Malformed version and stack records are dropped, cards with an unknown
 * shape are kept as they are (a stack is never reordered or emptied here), and the stored Ours or Theirs records are left as they are.
 */
export function migrateBank() {
    const st = stores();
    let changed = false;
    for (const [id, version] of Object.entries(st.bankVersions)) {
        if (!version || typeof version !== 'object' || typeof version.text !== 'string' || !version.sourceId) { delete st.bankVersions[id]; changed = true; continue; }
        if (version.id !== id) { version.id = id; changed = true; }
    }
    for (const [key, stack] of Object.entries(st.bankStacks)) {
        if (!stack || typeof stack !== 'object' || !Array.isArray(stack.cards)) { delete st.bankStacks[key]; changed = true; continue; }
        if (!Array.isArray(stack.ri)) { stack.ri = []; changed = true; }
        if (stack.v !== BANK_VERSION) { stack.v = BANK_VERSION; changed = true; }
    }
    if (changed) saveSettings();
    return changed;
}


/** Her own feature tags on a card. Tags label cards and the By feature view; they never change a stack. */
export function setCardTags(key, tags) {
    const st = stores();
    if (tags === null) delete st.bankTags[key];
    else put(st.bankTags, key, [...new Set((tags || []).filter(tag => typeof tag === 'string' && tag))]);
    tagsVersion++;
    saveSettings();
    if (current) { current = indexBank({ ...hostInput(), tags: st.bankTags }, current); notify('tags'); }
}

// ----------------------------------------------------------------------------------------------------------------------
// Customized versions

export const versionKey = id => cardKey(SOURCE_MINE, id);
export const cleanKeyOf = version => cardKey(version.source, version.sourceId);
export const listVersions = () => Object.values(stores().bankVersions).map(copy);
export const getVersion = id => { const value = own(stores().bankVersions, id); return value ? copy(value) : null; };
/** Her versions of one clean card. */
export const versionsOf = key => listVersions().filter(version => cleanKeyOf(version) === key);

function newVersionId(existing) {
    let id;
    do id = `${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; while (Object.hasOwn(existing, id));
    return id;
}

/**
 * Save an edit of a card as a customized version. The clean card, the source preset and every stack stay as they are.
 * key may be a base:: key (the version then names the base preset's own source), any source card, or another version
 * (the new version names the same clean block). Returns the stored record.
 */
export function createVersion(bank, key, { label = '', text, base = activePreset() } = {}) {
    const st = stores();
    const parsed = parseKey(key);
    let clean;
    if (parsed.source === SOURCE_MINE) {
        const from = own(st.bankVersions, parsed.id);
        if (!from) throw new Error('That version is no longer saved.');
        clean = bankCard(bank, cleanKeyOf(from), base) || { source: from.source, sourceName: from.sourceName, id: from.sourceId, hash: from.cleanHash,
            name: from.name, role: from.role, placement: from.placement, notBefore: from.notBefore || 0 };
    } else clean = bankCard(bank, key, base);
    if (!clean) throw new Error('That block is no longer in the bank.');
    if (clean.marker) throw new Error('SillyTavern fills this row itself, so it has no text to edit.');
    if (typeof text !== 'string') throw new Error('A version needs its text.');
    const id = newVersionId(st.bankVersions);
    const time = now();
    const record = { id, source: clean.source, sourceName: clean.sourceName, sourceId: clean.id, cleanHash: clean.hash || '',
        name: clean.name, role: clean.role || 'system', placement: copy(clean.placement || placementOf(null)), ...(gateValue(clean.notBefore) ? { notBefore: clean.notBefore } : {}),
        label: String(label || '').trim() || `Version ${versionsOf(cardKey(clean.source, clean.id)).length + 1}`, text, created: time, edited: time };
    put(st.bankVersions, id, record);
    saveSettings();
    notify('versions');
    return copy(record);
}

/** Change her text or her name for a version. */
export function editVersion(id, { text, label } = {}) {
    const st = stores();
    const record = own(st.bankVersions, id);
    if (!record) throw new Error('That version is no longer saved.');
    if (typeof text === 'string') record.text = text;
    if (typeof label === 'string' && label.trim()) record.label = label.trim();
    record.edited = now();
    saveSettings();
    notify('versions');
    return copy(record);
}

/** Reset to clean: the version's text becomes the current clean text, and it is then made from the current clean hash. */
export function resetVersion(bank, id) {
    const st = stores();
    const record = own(st.bankVersions, id);
    if (!record) throw new Error('That version is no longer saved.');
    const clean = bank?.cards?.get(cleanKeyOf(record));
    if (!clean) throw new Error('The clean block is no longer in its source, so there is no clean text to reset to.');
    record.text = clean.text;
    record.cleanHash = clean.hash;
    record.edited = now();
    saveSettings();
    notify('versions');
    return copy(record);
}

/** Delete version: removes that one record. Stacks keep their card for it, marked Source removed, until she takes it out. */
export function deleteVersion(id) {
    const st = stores();
    if (!own(st.bankVersions, id)) return false;
    const record = st.bankVersions[id];
    const hash = blockHash(record.text);
    rememberText(st.bankTexts, hash, record.text);
    // Stack cards of the version keep sending her last text, so they point at the text it had when deleted.
    const key = versionKey(id);
    for (const stack of [...Object.values(st.bankStacks), ...Object.values(pinsOf() || {})]) {
        for (const item of [...(stack.cards || []), ...(stack.ri || [])]) if (item.key === key) item.hash = hash;
        if (stack.texts && [...stack.cards, ...stack.ri].some(item => item.key === key)) rememberText(stack.texts, hash, record.text);
    }
    if (pinsOf()) saveChatState();
    delete st.bankVersions[id];
    saveSettings();
    notify('versions');
    return true;
}

/** Where a version stands against its clean block now: clean, changed (the clean text moved on) or removed (the source is gone). */
export function versionStatus(bank, version) {
    const clean = bank?.cards?.get(cleanKeyOf(version)) || null;
    if (!clean) return { status: 'removed', clean: null, cleanKey: cleanKeyOf(version) };
    return { status: version.cleanHash && clean.hash !== version.cleanHash ? 'changed' : 'clean', clean, cleanKey: clean.key };
}

function versionCard(record) {
    return { key: versionKey(record.id), source: SOURCE_MINE, kind: 'mine', origin: record.source, sourceName: record.sourceName, sid: sidOf(record.source),
        id: record.id, versionOf: record.sourceId, name: record.name, label: record.label, text: record.text, hash: blockHash(record.text),
        marker: false, landmark: false, systemPrompt: false, role: record.role, placement: record.placement, notBefore: gateValue(record.notBefore), listed: false, shippedOn: false,
        tokens: cardTokens(record.text), raw: hasMacros(record.text), tags: [], verdicts: {}, cleanHash: record.cleanHash };
}

// ----------------------------------------------------------------------------------------------------------------------
// Resolving cards

/** The current bank card for a key; base:: keys resolve against the named base preset, v:: keys to her version. */
export function bankCard(bank, key, base = activePreset()) {
    const { source, id } = parseKey(key);
    if (source === SOURCE_BASE) {
        const sid = own(bank?.sids, base);
        const card = sid ? bank.cards.get(cardKey(presetSource(sid), id)) : null;
        const companion = !card && isCompanionPreset(base) ? bank?.cards?.get(cardKey(SOURCE_COMPANION, id)) : null;
        return card || companion || null;
    }
    if (source === SOURCE_MINE) {
        const record = own(stores().bankVersions, id);
        if (!record) return null;
        const card = versionCard(record);
        const tagged = bank?.cards?.get(cleanKeyOf(record));
        if (tagged) { card.tags = tagged.tags; card.verdicts = tagged.verdicts; }
        return card;
    }
    return bank?.cards?.get(key) || null;
}

/** The key a card takes in the stack of a base: the base's own blocks become base:: cards. */
export function stackKeyOf(bank, key, base) {
    const card = bank?.cards?.get(key);
    if (!card) return key;
    const sid = own(bank.sids, base);
    if (sid && card.source === presetSource(sid)) return cardKey(SOURCE_BASE, card.id);
    if (isCompanionPreset(base) && card.source === SOURCE_COMPANION) return cardKey(SOURCE_BASE, card.id);
    return key;
}

/** Whether a card can be put in a stack; markers from a source other than the base are filled by the base. */
export function canInclude(bank, key, base = activePreset()) {
    const card = bankCard(bank, key, base);
    if (!card) return { ok: false, reason: 'That block is no longer in the bank.' };
    const asBase = parseKey(stackKeyOf(bank, key, base)).source === SOURCE_BASE || parseKey(key).source === SOURCE_BASE;
    if (card.marker && !asBase) return { ok: false, reason: 'The base preset supplies this row; SillyTavern fills it once.' };
    return { ok: true, reason: '' };
}

// ----------------------------------------------------------------------------------------------------------------------
// Stacks

/** The key a stack saves under: a loadout's own name, a recognised edition, or the preset name. */
export function stackKey(name, data, bank) {
    if (!name) return '';
    if (readMarker(data)) return `loadout:${name}`;
    const sid = own(bank?.sids, name);
    const source = sid ? bank.sources.get(presetSource(sid)) : isCompanionPreset(name) ? bank?.sources?.get(SOURCE_COMPANION) : null;
    const edition = source?.recognized?.edition;
    return edition ? edition.key : `preset:${name}`;
}

function stackCardOf(card, key, on) {
    return { key, on: !!on, hash: card.hash || '', source: parseKey(key).source, id: card.id, name: card.name, sourceName: card.sourceName,
        role: card.role, placement: copy(card.placement), ...(gateValue(card.notBefore) ? { notBefore: card.notBefore } : {}), marker: !!card.marker, tags: [...(card.tags || [])] };
}

/**
 * The stack for a base she has not composed yet (d.8): the base's listed blocks in its order with the on and off states it
 * ships, every RI card whose feature is on, and the companion's shipped-on blocks. Nothing is left out for being a duplicate
 * or a feature match. Companion blocks are placed before the base landmark that follows them in the companion's own order.
 */
export function startingStack(bank, base, { key = stackKey(base, null, bank) } = {}) {
    const sid = own(bank?.sids, base);
    const baseSource = sid ? bank.sources.get(presetSource(sid)) : isCompanionPreset(base) ? bank?.sources?.get(SOURCE_COMPANION) : null;
    const cards = (baseSource?.cards || []).filter(card => card.listed).map(card => stackCardOf(card, cardKey(SOURCE_BASE, card.id), card.shippedOn));
    const companion = bank?.sources?.get(SOURCE_COMPANION);
    // A companion edition (the companion itself or a copy saved under a companion name) already holds those blocks as its
    // own rows, so its stack gains no companion cards.
    if (companion && baseSource !== companion && !isCompanionPreset(base)) {
        // Each run of shipped-on companion blocks goes before the first landmark after it that the base also has; blocks
        // with no such landmark go before the base's Chat History row, or at the end when the base has none.
        const pending = [];
        const at = id => cards.findIndex(item => item.key === cardKey(SOURCE_BASE, id));
        for (const card of companion.cards.filter(entry => entry.listed)) {
            if (card.marker) {
                const index = card.landmark && pending.length ? at(card.id) : -1;
                if (index >= 0) cards.splice(index, 0, ...pending.splice(0));
                continue;
            }
            if (card.shippedOn) pending.push(stackCardOf(card, card.key, true));
        }
        if (pending.length) { const index = at('chatHistory'); cards.splice(index < 0 ? cards.length : index, 0, ...pending); }
    }
    const ri = (bank?.sources?.get(SOURCE_RI)?.cards || []).filter(card => card.shippedOn).map(card => stackCardOf(card, card.key, true));
    const time = now();
    return { v: BANK_VERSION, key, base: String(base || ''), created: time, edited: time, cards, ri };
}

const pinsOf = (create = false) => {
    const local = chatState()?.v10 || (create && chatState() ? (chatState().v10 = {}) : null);
    if (!local) return null;
    if (create && (!local.bankPins || typeof local.bankPins !== 'object')) local.bankPins = {};
    return local.bankPins || null;
};
/** Where a stack saves: 'chat' when this chat pins its own copy, else 'edition'. */
export const stackScope = key => own(pinsOf(), key) ? 'chat' : 'edition';
/** The stored stack of a key (the chat pin first), or null when she has not composed one. */
export function storedStack(key) {
    const pin = own(pinsOf(), key);
    const saved = pin || own(stores().bankStacks, key);
    return saved ? copy(saved) : null;
}
const textsFor = key => own(pinsOf(), key) ? (own(pinsOf(), key).texts ||= {}) : stores().bankTexts;
function rememberText(texts, hash, text) { if (hash && typeof text === 'string' && !Object.hasOwn(texts, hash)) put(texts, hash, text); }

function writeStack(bank, stack, base) {
    const pins = pinsOf();
    const pinned = own(pins, stack.key);
    const texts = pinned ? (pinned.texts || {}) : stores().bankTexts;
    for (const item of [...stack.cards, ...stack.ri]) {
        const card = bankCard(bank, item.key, base || stack.base);
        // A version card always sends her current text, so its stored hash follows her edits.
        if (card && item.source === SOURCE_MINE) item.hash = card.hash;
        if (item.hash && card && card.hash === item.hash) rememberText(texts, item.hash, card.text);
    }
    if (pinned) { put(pins, stack.key, { ...copy(stack), texts }); saveChatState(); }
    else { put(stores().bankStacks, stack.key, copy(stack)); pruneTexts(); saveSettings(); }
    notify('stack');
}

/** Drop stored texts that no saved stack or version needs any more. Pins keep their own texts in the chat. */
export function pruneTexts() {
    const st = stores();
    const needed = new Set();
    for (const stack of Object.values(st.bankStacks)) for (const item of [...(stack.cards || []), ...(stack.ri || [])]) if (item?.hash) needed.add(item.hash);
    for (const hash of Object.keys(st.bankTexts)) if (!needed.has(hash)) delete st.bankTexts[hash];
}

/**
 * The stack for a base: the stored one, or the starting stack, which is saved at once so later preset changes, refreshes
 * and feature changes cannot alter what she was shown.
 */
export function stackFor(bank, base = activePreset(), data = null) {
    if (!base) return null;
    const key = stackKey(base, data || findPreset(base), bank);
    const stored = storedStack(key);
    if (stored) return stored;
    // A loadout made from a stack restores that stack from its marker (B35); a version 1 loadout starts from its own blocks
    // with the cards of its Theirs features off.
    const preset = data || findPreset(base);
    const restored = restoreLoadoutStack(base, preset);
    if (restored) return restored;
    const stack = legacyStack(startingStack(bank, base, { key }), readMarker(preset));
    writeStack(bank, stack, base);
    return copy(stack);
}
function findPreset(name) {
    try { return listedPresets(ctx().getPresetManager?.('openai')).find(entry => entry.name === name)?.data || null; } catch { return null; }
}

// Tap functions. Each saves the stack in its scope and keeps the last ten stacks for undo.
const history = new Map();
function edit(bank, key, base, change) {
    const stack = storedStack(key) || (bank && base ? startingStack(bank, base, { key }) : null);
    if (!stack) throw new Error('There is no stack for this preset yet.');
    const before = copy(stack);
    const result = change(stack);
    if (result === false) return before;
    stack.edited = now();
    const past = history.get(key) || [];
    past.push(before);
    while (past.length > UNDO_DEPTH) past.shift();
    history.set(key, past);
    writeStack(bank, stack, base || stack.base);
    return copy(stack);
}
/**
 * A change to a stack that is not her tap, for a migration the caller names (B31 reads the old extension order and folds in
 * her saved wording). It saves in the stack's own scope, adds no undo step and leaves the edited time alone.
 */
export function migrateStack(bank, key, base, change) {
    const stack = storedStack(key);
    if (!stack) return null;
    if (change(stack) === false) return stack;
    writeStack(bank, stack, base || stack.base);
    return copy(stack);
}
// A card already in the stack stays in the group that holds it: a deleted version of an RI card has no record left to say
// which group it belongs to, and her taps on it must still reach it (B32).
const listOf = (stack, key) => {
    if (parseKey(key).source === SOURCE_RI || stack.ri.some(item => item.key === key)) return stack.ri;
    if (stack.cards.some(item => item.key === key)) return stack.cards;
    return groupFromKey(key) === 'ri' ? stack.ri : stack.cards;
};
function groupFromKey(key) {
    const { source, id } = parseKey(key);
    if (source === SOURCE_RI) return 'ri';
    if (source === SOURCE_MINE) return own(stores().bankVersions, id)?.source === SOURCE_RI ? 'ri' : 'main';
    return 'main';
}
const findItem = (stack, key) => { const list = listOf(stack, key); const index = list.findIndex(item => item.key === key); return { list, index }; };

/**
 * Put cards in the stack (her tap). A card already in the stack is switched on where it stands; a new card is placed at
 * at (an index in its group), after the card key in after, or before the base's Chat History row, else at the end of its group.
 */
export function includeCards(bank, key, keys, { base = activePreset(), at = null, after = null } = {}) {
    return edit(bank, key, base, stack => {
        let changed = false;
        let position = Number.isInteger(at) ? at : null;
        for (const raw of [].concat(keys)) {
            const permit = canInclude(bank, raw, base);
            if (!permit.ok) throw new Error(permit.reason);
            const itemKey = parseKey(raw).source === SOURCE_BASE ? raw : stackKeyOf(bank, raw, base);
            const found = findItem(stack, itemKey);
            if (found.index >= 0) { if (!found.list[found.index].on) { found.list[found.index].on = true; changed = true; } continue; }
            const card = bankCard(bank, itemKey, base);
            const item = stackCardOf(card, itemKey, true);
            const list = found.list;
            let index;
            if (position !== null) index = Math.max(0, Math.min(position, list.length));
            else if (after) { const anchor = list.findIndex(entry => entry.key === after); index = anchor < 0 ? list.length : anchor + 1; }
            else { const chat = list === stack.cards ? list.findIndex(entry => entry.key === cardKey(SOURCE_BASE, 'chatHistory')) : -1; index = chat < 0 ? list.length : chat; }
            list.splice(index, 0, item);
            if (position !== null) position = index + 1; else if (after) after = itemKey;
            changed = true;
        }
        return changed;
    });
}
export const includeCard = (bank, key, card, options) => includeCards(bank, key, [card], options);

/** Take cards out (her tap). A card left out keeps its place, so putting it back returns it there. */
export function excludeCards(bank, key, keys, { base = activePreset() } = {}) {
    return edit(bank, key, base, stack => {
        let changed = false;
        for (const raw of [].concat(keys)) {
            const itemKey = parseKey(raw).source === SOURCE_BASE ? raw : stackKeyOf(bank, raw, base);
            const found = findItem(stack, itemKey);
            if (found.index >= 0 && found.list[found.index].on) { found.list[found.index].on = false; changed = true; }
        }
        return changed;
    });
}
export const excludeCard = (bank, key, card, options) => excludeCards(bank, key, [card], options);

/**
 * Move cards (her tap) so the first of them lands at index to of its group once moved (a Place here target). Several keys
 * keep their relative order. RI cards move only inside the RI group, every other card only inside the main group.
 */
export function moveCards(bank, key, keys, to, { base = activePreset() } = {}) {
    return edit(bank, key, base, stack => {
        const wanted = new Set([].concat(keys));
        const list = listOf(stack, [...wanted][0]);
        const moving = list.filter(item => wanted.has(item.key));
        if (!moving.length || moving.length !== wanted.size) return false;
        const rest = list.filter(item => !wanted.has(item.key));
        const index = Math.max(0, Math.min(Number.isInteger(to) ? to : rest.length, rest.length));
        const next = [...rest.slice(0, index), ...moving, ...rest.slice(index)];
        if (next.every((item, i) => item === list[i])) return false;
        list.splice(0, list.length, ...next);
        return true;
    });
}
export const moveCard = (bank, key, card, to, options) => moveCards(bank, key, [card], to, options);
/** Step a card up (-1) or down (+1) by one place in its group. */
export function stepCard(bank, key, card, delta, options = {}) {
    const stack = storedStack(key);
    const found = stack ? findItem(stack, card) : { index: -1 };
    if (found.index < 0 || ![-1, 1].includes(delta)) return stack;
    const to = found.index + delta;
    if (to < 0 || to >= found.list.length) return stack;
    return moveCards(bank, key, [card], to, options);
}

/** Take the new text (her tap): the cards send their source's current text from now on. */
export function takeNewText(bank, key, keys, { base = activePreset() } = {}) {
    return edit(bank, key, base, stack => {
        let changed = false;
        for (const raw of [].concat(keys)) {
            const found = findItem(stack, raw);
            if (found.index < 0) continue;
            const item = found.list[found.index];
            const card = bankCard(bank, item.key, base);
            if (!card || card.hash === item.hash) continue;
            Object.assign(item, { hash: card.hash, name: card.name, role: card.role, placement: copy(card.placement), sourceName: card.sourceName });
            if (gateValue(card.notBefore)) item.notBefore = card.notBefore; else delete item.notBefore;
            changed = true;
        }
        return changed;
    });
}

/**
 * Where a stack card is sent (her tap in the card's Placement editor, B56): change { role, position, depth, notBefore },
 * any of them; position 0 is the stack order and 1 is in the chat at depth messages from the end, and notBefore is the first
 * reply number it is sent with (0 from the first reply). A value equal to the source's is not kept, so the card follows its
 * source again; change null takes back every value she set. The bank card and the source stay as they are.
 */
export function setCardSending(bank, key, card, change, { base = activePreset() } = {}) {
    return edit(bank, key, base, stack => {
        const found = findItem(stack, card);
        if (found.index < 0) throw new Error('Put the block in the stack to change where it is sent.');
        const item = found.list[found.index];
        if (item.marker) throw new Error('SillyTavern places this row itself.');
        if (parseKey(item.key).source === SOURCE_RI) throw new Error('Roleplay Instructions places its own cards in its group at the end of the request.');
        const before = JSON.stringify(item.set || null);
        if (change === null) delete item.set;
        else {
            const source = bankCard(bank, item.key, base) || item;
            const from = { role: roleOf(source.role || item.role), position: (source.placement || item.placement || {}).position === 1 ? 1 : 0,
                depth: Number.isInteger((source.placement || item.placement || {}).depth) ? (source.placement || item.placement).depth : 4,
                notBefore: gateValue(source.notBefore ?? item.notBefore) };
            const next = { ...(item.set || {}) };
            if (change.role !== undefined) { if (!ROLES.includes(change.role)) throw new Error('A block is sent as system, user or assistant.'); next.role = change.role; }
            if (change.position !== undefined) next.position = change.position === 1 ? 1 : 0;
            if (change.depth !== undefined) {
                const depth = Number(change.depth);
                if (!Number.isInteger(depth) || depth < 0 || depth > 9999) throw new Error('The depth is a whole number of messages from 0 up.');
                next.depth = depth;
            }
            if (change.notBefore !== undefined) {
                const at = Number(change.notBefore);
                if (!Number.isInteger(at) || at < 0 || at > 100000) throw new Error('The first reply is a whole number from 0 up.');
                next.notBefore = gateValue(at);
            }
            for (const field of Object.keys(next)) if (next[field] === from[field]) delete next[field];
            if (Object.keys(next).length) item.set = next; else delete item.set;
        }
        return JSON.stringify(item.set || null) !== before;
    });
}

/** Undo the last stack edit of a key; up to ten are kept for this session. */
export function undoStack(bank, key) {
    const past = history.get(key);
    if (!past?.length) return null;
    const previous = past.pop();
    previous.edited = now();
    writeStack(bank, previous, previous.base);
    return copy(previous);
}
export const canUndo = key => !!history.get(key)?.length;

/** Pin the stack to this chat (a copy with its texts goes into the chat metadata), or remove the pin. */
export function pinStack(bank, key, pinned, { base = activePreset() } = {}) {
    const pins = pinsOf(true);
    if (!pins) return false;
    if (pinned) {
        const stack = storedStack(key) || startingStack(bank, base, { key });
        const texts = {};
        const all = stores().bankTexts;
        for (const item of [...stack.cards, ...stack.ri]) if (item.hash && Object.hasOwn(all, item.hash)) texts[item.hash] = all[item.hash];
        put(pins, key, { ...stack, texts });
        writeStack(bank, own(pins, key), base);
    } else { delete pins[key]; saveChatState(); notify('stack'); }
    return true;
}

// ----------------------------------------------------------------------------------------------------------------------
// Reading a stack: the plan B30 sends, its cost and the feature states

/**
 * Each stack card resolved against the bank, in send order (main group, then the RI group):
 * { key, on, group, status: 'clean' | 'changed' | 'removed', text (what is sent), currentText, hash, currentHash, card fields }.
 * A changed card sends the text it was taken with until she taps Take the new text; a removed card sends its last text.
 * RI cards follow the extension's stored prompts, so they are always clean here.
 */
export function stackPlan(bank, stack, base = stack?.base || activePreset()) {
    if (!stack) return [];
    const texts = own(own(pinsOf(), stack.key), 'texts') || {};
    const stored = stores().bankTexts;
    const lastText = hash => own(texts, hash) ?? own(stored, hash);
    const resolve = (item, group) => {
        let card = bankCard(bank, item.key, base);
        const source = parseKey(item.key).source;
        // A base row the selected copy of the edition lacks is read from the copy of the same edition that holds it.
        let elsewhere = '';
        if (!card && source === SOURCE_BASE) { card = copyCard(bank, stack.key, parseKey(item.key).id, base); elsewhere = card?.sourceName || ''; }
        const live = source === SOURCE_RI;
        let status = 'clean', text;
        if (!card) { status = 'removed'; text = lastText(item.hash) ?? ''; }
        else if (source === SOURCE_MINE) {
            text = card.text;
            card.cleanStatus = versionStatus(bank, own(stores().bankVersions, card.id)).status;
        } else if (!live && item.hash && card.hash !== item.hash) { status = 'changed'; text = lastText(item.hash) ?? card.text; }
        else text = card.text;
        const base_ = card || {};
        // Where it is sent: her values from the Placement editor over the source's (B56). A stack saved before B56 holds none.
        const set = item.set && typeof item.set === 'object' ? item.set : {};
        const fromRole = base_.role || item.role, fromPlacement = base_.placement || item.placement;
        const fromGate = gateValue(base_.notBefore ?? item.notBefore);
        const placement = set.position !== undefined || set.depth !== undefined
            ? { ...(fromPlacement || placementOf(null)), ...(set.position !== undefined ? { position: set.position } : {}), ...(set.depth !== undefined ? { depth: set.depth } : {}) }
            : fromPlacement;
        const notBefore = set.notBefore !== undefined ? gateValue(set.notBefore) : fromGate;
        // A gate the file wrote as a macro around the whole block is kept by RI, so the body goes out without the macro,
        // which reads a turn counter only the preset it came from keeps.
        const wrapped = fromGate ? wrappedGate(text) : null;
        const sendText = wrapped && wrapped.at === fromGate ? wrapped.body : text;
        return { key: item.key, on: item.on, group, status, text, sendText, currentText: card?.text ?? null, hash: item.hash, currentHash: card?.hash ?? null,
            source, sourceName: base_.sourceName || item.sourceName, id: base_.id ?? item.id, name: base_.name || item.name,
            label: base_.label || '', role: set.role || fromRole, placement, notBefore, set: Object.keys(set).length ? { ...set } : null,
            from: { role: fromRole, placement: fromPlacement, notBefore: fromGate }, marker: base_.marker ?? item.marker,
            landmark: source === SOURCE_BASE && !!(base_.landmark ?? (item.marker && LANDMARK.has(item.id))), tags: base_.tags || item.tags || [],
            verdicts: base_.verdicts || {}, tokens: (base_.marker ?? item.marker) ? 0 : cardTokens(text), raw: hasMacros(text),
            cleanStatus: base_.cleanStatus || '', origin: base_.origin || '', versionOf: base_.versionOf || '', sendId: sendId(item.key, bank, base), elsewhere,
            lineage: base_.lineage || null };
    };
    return [...companionTwins(stack.cards, base).map(item => resolve(item, 'main')), ...stack.ri.map(item => resolve(item, 'ri'))];
}

/**
 * Presets that share one stack key are copies of one edition and share one stored stack (B29, kept by B32). A base row one
 * copy holds and the selected copy lacks is read from that other copy, so its card shows "In another copy: <name>" in place
 * of Source removed and sends that copy's text while it is on.
 */
const editionKeys = new WeakMap();
export function copyCard(bank, key, id, base) {
    if (!bank?.sources || !key) return null;
    let names = editionKeys.get(bank);
    if (!names) { names = new Map(); editionKeys.set(bank, names); }
    for (const source of bank.sources.values()) {
        if (source.kind !== 'preset' || source.name === base) continue;
        if (!names.has(source.name)) names.set(source.name, stackKey(source.name, source.data, bank));
        if (names.get(source.name) !== key) continue;
        const card = source.byId.get(id);
        if (card) return card;
    }
    return null;
}

/**
 * On a companion edition a companion card and the base block with its identifier are one block. Companion editions share
 * one stored stack (the edition key), so a stack started on a copy of the companion can hold both; the base row is sent,
 * and the companion card only when the base row is off and the card is on, so the block goes out once at most.
 */
function companionTwins(cards, base) {
    if (!isCompanionPreset(base)) return cards;
    const rows = new Map(cards.filter(item => parseKey(item.key).source === SOURCE_BASE).map(item => [parseKey(item.key).id, item]));
    return cards.filter(item => {
        const { source, id } = parseKey(item.key);
        if (source !== SOURCE_COMPANION || !rows.has(id)) return true;
        return item.on && !rows.get(id).on;
    });
}

/** The identifier a card is sent under in the live prompt list: base blocks keep theirs, other cards are namespaced (B30). */
export function sendId(key, bank, base) {
    const { source, id } = parseKey(key);
    if (source === SOURCE_BASE) return id;
    if (source === SOURCE_MINE) return `ri-bank-mine-${id}`;
    if (source === SOURCE_COMPANION) return `ri-bank-companion-${id}`;
    if (source === SOURCE_RI) return `ri-bank-ri-${id}`;
    if (isImportSource(source)) return `ri-bank-imp-${source.slice(4)}-${id}`;
    return `ri-bank-${sidOf(source)}-${id}`;
}

/** Token totals of a plan: the whole stack, the RI group, per source, and whether any card in it shows raw size. */
export function stackCost(plan) {
    const out = { total: 0, ri: 0, bySource: {}, raw: false, cards: 0 };
    for (const item of plan) {
        if (!item.on) continue;
        out.cards++;
        out.total += item.tokens;
        if (item.group === 'ri') out.ri += item.tokens;
        const name = item.source === SOURCE_RI ? RI_LABEL : item.sourceName || item.source;
        out.bySource[name] = (out.bySource[name] || 0) + item.tokens;
        if (item.raw) out.raw = true;
    }
    return out;
}
/** The change in tokens a tap on a card's include control makes: positive to put it in, negative to take it out. */
export const includeDelta = item => item.on ? -item.tokens : item.tokens;

/**
 * The supplier of one feature, read from the stack alone: 'ri' when only the extension's card for it is on, 'preset' when
 * only preset cards tagged with it are on, 'both', or 'off'. Lists the cards behind each side.
 */
export function featureState(plan, feature) {
    const ri = plan.filter(item => item.on && (item.source === SOURCE_RI ? item.id === feature : item.origin === SOURCE_RI && item.versionOf === feature));
    const preset = plan.filter(item => item.on && item.source !== SOURCE_RI && item.origin !== SOURCE_RI && !item.marker && (item.tags || []).includes(feature));
    const state = ri.length && preset.length ? 'both' : ri.length ? 'ri' : preset.length ? 'preset' : 'off';
    return { key: feature, state, ri: ri.map(item => item.key), preset: preset.map(item => ({ key: item.key, name: item.name, source: item.sourceName })) };
}
/** Every feature the extension has, plus every other tag a card in the stack carries. */
export function featureStates(plan) {
    const keys = [...FEATURE_KEYS];
    for (const item of plan) for (const tag of item.tags || []) if (!keys.includes(tag)) keys.push(tag);
    return Object.fromEntries(keys.map(key => [key, featureState(plan, key)]));
}
/** Module owners for effectiveModules() (B30's syncOwners): an RI card on in the stack gives 'both', otherwise 'preset'. */
export function ownersFromStack(plan) {
    return Object.fromEntries(FEATURE_KEYS.map(key => [key, featureState(plan, key).ri.length ? 'both' : 'preset']));
}

// ----------------------------------------------------------------------------------------------------------------------
// Host wiring: the live bank, refreshed on preset events and each time the page opens

let current = null;
let library = null;
let tagsVersion = 0;
let companionFile = null;
const pendingRenames = [];
const listeners = new Set();
export const onBankChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function notify(reason) { for (const fn of listeners) { try { fn(reason); } catch (error) { console.warn('Roleplay Instructions bank listener failed.', error); } } }
export const currentBank = () => current;
/** Use this library map for tags and edition keys (tests, or a host that loaded it already). */
export function useBankLibrary(data) { library = data || null; tagsVersion++; if (current) for (const source of current.sources.values()) source.recognized = undefined; }
/** Use this companion preset data when the list holds none (tests, or the shipped file). */
export const useCompanionFile = data => { companionFile = data || null; };
export const resetBank = () => { current = null; history.clear(); pendingRenames.length = 0; hashCalls = 0; memo.clear(); };
export const hashCount = () => hashCalls;

/** Hashes stacks and versions recorded for each source id, so a rename found after a reload still matches. */
function knownHashes() {
    const st = stores();
    const out = {};
    const add = (source, hash) => { const sid = sidOf(source); if (sid && hash) (out[sid] ||= []).push(hash); };
    for (const stack of Object.values(st.bankStacks)) for (const item of stack.cards || []) add(item.source, item.hash);
    for (const version of Object.values(st.bankVersions)) add(version.source, version.cleanHash);
    return out;
}

function hostInput() {
    const st = stores();
    let presets = [];
    try { presets = listedPresets(ctx().getPresetManager?.('openai')); } catch { presets = []; }
    return { presets, companion: companionFile ? { name: PRESET, data: companionFile } : null, ri: riCards(activePreset()), imports: st.bankImports,
        sids: st.bankSources, library, nameTags: blockCompanions, tags: st.bankTags, tagStamp: `${library ? 'library' : 'names'}:${tagsVersion}` };
}

/** Move a preset:<name> stack, its chat pin and the versions naming the old preset to the new name. Order and inclusion stay. */
function followRenames(renames) {
    if (!renames.length) return;
    const st = stores();
    const pins = pinsOf();
    for (const { from, to } of renames) {
        if (!from || from === to) continue;
        const oldKey = `preset:${from}`, newKey = `preset:${to}`;
        if (own(st.bankStacks, oldKey) && !own(st.bankStacks, newKey)) { put(st.bankStacks, newKey, { ...st.bankStacks[oldKey], key: newKey, base: to }); delete st.bankStacks[oldKey]; }
        if (pins && own(pins, oldKey) && !own(pins, newKey)) { put(pins, newKey, { ...pins[oldKey], key: newKey, base: to }); delete pins[oldKey]; saveChatState(); }
        for (const stack of [...Object.values(st.bankStacks), ...Object.values(pins || {})]) {
            if (stack.base === from) stack.base = to;
            for (const item of stack.cards || []) if (item.sourceName === from) item.sourceName = to;
        }
        for (const version of Object.values(st.bankVersions)) if (version.sourceName === from) version.sourceName = to;
    }
}

/**
 * Reread the preset list and update the index. Only blocks whose text changed are hashed again. Stacks are not edited:
 * a changed source shows on their cards through stackPlan, and a removed source keeps its cards with their last text.
 */
export function refreshBank(reason = 'refresh') {
    const st = stores();
    const before = JSON.stringify(st.bankSources);
    const input = hostInput();
    input.renamed = pendingRenames.splice(0);
    input.knownHashes = knownHashes();
    current = indexBank(input, current);
    followRenames(current.renames);
    if (JSON.stringify(st.bankSources) !== before || current.renames.length) saveSettings();
    notify(reason);
    return current;
}
/** The refresh each time the bank page opens, the fallback that works on every host. */
export const refreshOnOpen = () => refreshBank('open');

let scheduled = null;
function later(reason, delay = 0) {
    clearTimeout(scheduled);
    scheduled = setTimeout(() => { scheduled = null; try { refreshBank(reason); } catch (error) { console.warn('Roleplay Instructions could not refresh the block bank.', error); } }, delay);
}

let hooked = false;
/**
 * Listen to SillyTavern's preset events (import, save, rename, delete, selection). Saving through the Update button
 * fires no event in SillyTavern 1.19, so a tap on it schedules refreshes after the save request has had time to finish.
 */
export function installBankHooks() {
    if (hooked) return false;
    hooked = true;
    migrateBank();
    on('OAI_PRESET_CHANGED_AFTER', () => later('preset-changed'));
    on('OAI_PRESET_IMPORT_READY', () => later('preset-imported', 300));
    on('PRESET_CHANGED', event => { if (!event?.apiId || event.apiId === 'openai') later('preset-changed'); });
    on('PRESET_DELETED', event => { if (!event?.apiId || event.apiId === 'openai') later('preset-deleted'); });
    on('PRESET_RENAMED', event => {
        if (event?.apiId && event.apiId !== 'openai') return;
        if (event?.oldName && event?.newName) pendingRenames.push({ from: String(event.oldName), to: String(event.newName) });
        later('preset-renamed');
    });
    on('SETTINGS_LOADED_AFTER', () => later('settings-loaded'));
    on('CHAT_CHANGED', () => later('chat-changed'));
    globalThis.document?.addEventListener?.('click', event => {
        if (event.target?.closest?.('#update_oai_preset')) for (const delay of [400, 1500, 4000]) setTimeout(() => later('preset-saved'), delay);
    }, true);
    loadLibrary().then(data => { if (data && !library) { useBankLibrary(data); later('library'); } }).catch(() => {});
    if (!companionFile) {
        fetch(new URL('../presets/Roleplay Instructions V10.json', import.meta.url).href).then(response => response.ok ? response.json() : null)
            .then(data => { if (data?.prompts) { companionFile = data; later('companion'); } }).catch(() => {});
    }
    return true;
}

// ----------------------------------------------------------------------------------------------------------------------
// Blocks read from a file (the option bank import of B37 sends its instruction blocks here)

const slug = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'block';
const fileTitle = file => String(file).replace(/[.][a-z0-9]+$/i, '');

/**
 * Put the instruction blocks the import read from a preset or plugin file into the bank as a source of their own, one source
 * per file, each card naming the file and block it came from. Importing the same file again updates that source, so a block
 * whose text changed shows Changed in source on every stack card taken from it. Nothing goes into a stack: the blocks wait in
 * the bank for her tap. blocks: [{ name, text, source: { file, block }, role, notBefore, injection_position, injection_depth,
 * injection_order, injection_trigger, chance, wordings, background, origin }]. Each record keeps the role, where the file sends
 * the block (placement) and its reply-number gate (B56).
 * Returns [{ source, file, added, updated, kept }].
 */
export function intakeBlocks(blocks) {
    const st = stores();
    const byFile = new Map();
    for (const block of [].concat(blocks || [])) {
        const text = typeof block?.text === 'string' ? block.text : '';
        if (!text.trim()) continue;
        const file = String(block.source?.file || block.file || 'Imported file');
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push(block);
    }
    const out = [];
    for (const [file, list] of byFile) {
        const iid = blockHash(`import:${file}`).slice(0, 10);
        const old = own(st.bankImports, iid);
        const previous = new Map((old?.blocks || []).map(block => [block.id, block]));
        const seen = new Map();
        const next = [];
        const lineage = {};
        let added = 0, updated = 0, kept = 0;
        for (const block of list) {
            const name = String(block.name || block.source?.block || 'Imported block');
            const stem = slug(block.source?.block || name);
            const count = (seen.get(stem) || 0) + 1;
            seen.set(stem, count);
            const id = count > 1 ? `${stem}-${count}` : stem;
            const notBefore = intakeGate(block);
            const record = { id, name, text: block.text, role: roleOf(block.role), placement: placementOf(block),
                ...(notBefore ? { notBefore } : {}),
                ...(Number.isFinite(block.chance) ? { chance: block.chance } : {}), ...(Array.isArray(block.wordings) ? { wordings: block.wordings.map(String) } : {}),
                ...(block.background ? { background: true } : {}) };
            const was = previous.get(id);
            const moved = was && (was.role !== record.role || (was.notBefore || 0) !== notBefore
                || JSON.stringify(was.placement || placementOf(null)) !== JSON.stringify(record.placement));
            if (!was) added++; else if (was.text !== record.text || was.name !== record.name || moved) updated++; else kept++;
            lineage[id] = String(block.source?.block || name);
            next.push(record);
        }
        // Blocks the file no longer has stay readable for stacks that hold them, marked Source removed by the plan.
        for (const block of previous.values()) if (!next.some(item => item.id === block.id)) rememberText(st.bankTexts, hashOf(block.text), block.text);
        put(st.bankImports, iid, { id: iid, file, name: fileTitle(file), at: now(), blocks: next, lineage });
        out.push({ source: importSource(iid), file, added, updated, kept, stored: next });
    }
    if (out.length) {
        saveSettings();
        if (current) { current = indexBank({ ...hostInput(), tags: st.bankTags }, current); notify('import'); }
    }
    return out;
}

/**
 * The reply-number gate an imported block keeps (B56). The reader finds a gate wherever the text compares the preset's turn
 * counter; the bank keeps it when the gate wraps the whole block, so RI sends the block from that reply on. A comparison
 * inside other text (an init block that counts the turns) stays the preset's own macro, sent from the first reply.
 */
function intakeGate(block) {
    const value = gateValue(block?.notBefore);
    if (!value) return 0;
    const text = String(block.text ?? '');
    if (!/getvar::turn\}\}/.test(text)) return value;
    return wrappedGate(text)?.at === value ? value : 0;
}

/** Take one imported file out of the bank. Stack cards from it keep sending their last text, marked Source removed. */
export function removeImport(iid) {
    const st = stores();
    const record = own(st.bankImports, iid);
    if (!record) return false;
    for (const block of record.blocks || []) rememberText(st.bankTexts, hashOf(block.text), block.text);
    delete st.bankImports[iid];
    saveSettings();
    if (current) { current = indexBank({ ...hostInput(), tags: st.bankTags }, current); notify('import'); }
    return true;
}
