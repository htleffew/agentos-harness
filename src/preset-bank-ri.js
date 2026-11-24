// The extension's own cards in the block bank (A11 c.5 and c.3a, ticket B31; DECISIONS.md, decision 16).
//
// Each feature in FEATURES is one RI card. Its clean version is the shipped default prompt of the feature (the prompts in
// MODULE_PROMPTS joined). Her customized version, when she has one, is the stored prompt override the Prompts page keeps,
// kept in settings().bankVersions under the id ri-<feature> so every version tool of the bank (include, exclude, move,
// compare) works on it; its text always equals the stored text, and editing it happens in the mirrored prompt editor
// (slot()), which keeps one stored prompt per id. The stack's RI group sets what the engine sends:
//   clean card on, her version out        the shipped default
//   her version on, clean card out        her stored text
//   both on                               both texts, clean first
//   no card for the feature in the stack  the stored text, as before (the feature's own on or off setting decides)
// The order of the cards in the group is the order of feature guidance in the request; it replaces moduleOrder in chat state.
// The old order is read once into the stack and then no longer used. Nothing here takes a card out of a stack.
import { FEATURES, FEATURE_KEYS, blockHash } from './preset-library.js';
import { MODULE_PROMPTS, moduleOrder } from './module-layout.js';
import { promptText, promptStatus, withPromptVariant } from './prompts.js';
import { settings, saveSettings, chatState, saveChatState } from './store.js';
import { activePreset } from './v10.js';
import { RI_LABEL, SOURCE_RI, SOURCE_MINE, parseKey, versionKey, setRiCards, featureOn, currentBank, refreshBank, stackFor, migrateStack,
    deleteVersion } from './preset-bank.js';

const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const join = texts => texts.filter(Boolean).join('\n\n');
const idsOf = feature => MODULE_PROMPTS[feature] || [];
const read = id => { try { return promptText(id); } catch { return ''; } };

/** The id of her saved wording for a feature in settings().bankVersions. */
export const riVersionId = feature => `ri-${feature}`;
/** The feature a version id stands for, or '' when the id is not one of the saved-wording versions. */
export const riFeatureOfVersion = id => {
    const feature = String(id ?? '').startsWith('ri-') ? String(id).slice(3) : '';
    return Object.hasOwn(FEATURES, feature) ? feature : '';
};
/** A plan or stack item for her saved wording of a feature, or '' for anything else. */
export const savedWordingOf = item => item?.origin === SOURCE_RI ? riFeatureOfVersion(item.id) : '';

/** The shipped default of a feature: its prompts at their default text, joined. */
export const cleanText = feature => withPromptVariant('clean', () => join(idsOf(feature).map(read)));
/** Her stored wording for a feature, or null when she has saved none (or her text equals the default). */
export function customText(feature) {
    if (!idsOf(feature).some(id => promptStatus(id).customized)) return null;
    const text = join(idsOf(feature).map(read));
    return text && text !== cleanText(feature) ? text : null;
}

/** The provider the bank uses for its RI source: one card per feature with the shipped default text. */
export function riCardList(preset = activePreset()) {
    const enabled = featureOn(preset);
    const order = moduleOrder(chatState()?.v10?.moduleOrder);
    const keys = [...order.filter(key => Object.hasOwn(FEATURES, key)), ...FEATURE_KEYS.filter(key => !order.includes(key))];
    return keys.map(key => ({ id: key, name: FEATURES[key].label, on: enabled[key], text: cleanText(key), live: FEATURES[key].ours, tags: [key] }));
}

const bankVersions = () => {
    const st = settings();
    if (!st.bankVersions || typeof st.bankVersions !== 'object' || Array.isArray(st.bankVersions)) st.bankVersions = {};
    return st.bankVersions;
};
const placementOf = () => ({ position: 1, depth: 0, order: 100, triggers: [] });

/**
 * Make her saved wording a version of the matching RI card: a record per feature that has a stored override, its text equal
 * to the stored text; a feature whose override is gone loses its record (a stack card of it keeps the last text, marked
 * Source removed, as for any deleted version). Returns true when a record changed.
 */
export function syncRiVersions() {
    const records = bankVersions();
    let changed = false;
    for (const feature of FEATURE_KEYS) {
        const id = riVersionId(feature), custom = customText(feature), record = own(records, id);
        if (custom === null) {
            if (record) { deleteVersion(id); changed = true; }
            continue;
        }
        const hash = blockHash(cleanText(feature));
        if (!record) {
            const time = Date.now();
            records[id] = { id, source: SOURCE_RI, sourceName: RI_LABEL, sourceId: feature, cleanHash: hash, name: FEATURES[feature].label, role: 'system',
                placement: placementOf(), label: 'Your wording', text: custom, created: time, edited: time };
            changed = true;
        } else if (record.text !== custom || record.cleanHash !== hash) {
            record.text = custom; record.cleanHash = hash; record.edited = Date.now();
            changed = true;
        }
    }
    if (changed) { saveSettings(); try { if (currentBank()) refreshBank('prompts'); } catch (error) { console.warn('Roleplay Instructions could not refresh the bank.', error); } }
    return changed;
}

const featureOfItem = item => {
    const { source, id } = parseKey(item.key);
    if (source === SOURCE_RI) return id;
    return source === SOURCE_MINE ? riFeatureOfVersion(id) || (own(bankVersions(), id)?.source === SOURCE_RI ? own(bankVersions(), id).sourceId : '') : '';
};

/**
 * Bring the RI group of a stack up to date with two steps that are not her taps, each once:
 *  - her saved wording becomes a card beside the clean card, on where the clean card was on, and the clean card goes off,
 *    so the request keeps carrying the wording she saved; the clean card stays in the stack, one tap from back on;
 *  - the old per-chat extension order is read into the group's order. Cards keep their on and off state.
 */
export function reconcileStack(bank, stack, base) {
    if (!stack) return stack;
    const records = bankVersions();
    const needsWording = FEATURE_KEYS.filter(feature => own(records, riVersionId(feature))
        && !stack.ri.some(item => item.key === versionKey(riVersionId(feature))));
    const saved = chatState()?.v10?.moduleOrder;
    const needsOrder = Array.isArray(saved) && saved.length && chatState().v10.moduleOrderRead !== true;
    if (!needsWording.length && !needsOrder) return stack;
    const next = migrateStack(bank, stack.key, base, draft => {
        for (const feature of needsWording) {
            const record = records[riVersionId(feature)];
            const at = draft.ri.findIndex(item => item.key === `${SOURCE_RI}::${feature}`);
            const was = at >= 0 && draft.ri[at].on === true;
            if (at >= 0) draft.ri[at].on = false;
            const item = { key: versionKey(record.id), on: was, hash: blockHash(record.text), source: SOURCE_MINE, id: record.id, name: record.name,
                sourceName: RI_LABEL, role: record.role, placement: structuredClone(record.placement), marker: false, tags: [feature] };
            draft.ri.splice(at >= 0 ? at + 1 : draft.ri.length, 0, item);
        }
        if (needsOrder) {
            const order = moduleOrder(saved);
            const rank = item => { const index = order.indexOf(featureOfItem(item)); return index < 0 ? order.length : index; };
            draft.ri = draft.ri.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(entry => entry.item);
        }
    });
    if (needsOrder) { chatState().v10.moduleOrderRead = true; saveChatState(); }
    return next || stack;
}

/** The stack of the selected base with the RI group brought up to date, or null when there is none to read. */
export function riStack(bank = currentBank() || refreshBank('engine'), base = activePreset()) {
    if (!base) return null;
    syncRiVersions();
    const stack = stackFor(bank, base);
    return reconcileStack(bank, stack, base);
}

/** The factory order of the features; a stack in this order sends the sections in the order they are built. */
const FACTORY = () => moduleOrder();

/**
 * What the request reads from the stack's RI group: { order, modes }. order lists the features in group order, or is null when
 * it equals the factory order. modes maps a feature to 'stored', 'clean' or 'both'.
 */
export function riGroup(bank, base) {
    let stack;
    try { stack = riStack(bank, base); } catch (error) { console.warn('Roleplay Instructions could not read the stack.', error); return null; }
    if (!stack) return null;
    const placed = {}, order = [];
    for (const item of stack.ri) {
        const feature = featureOfItem(item);
        if (!feature) continue;
        if (!order.includes(feature)) order.push(feature);
        const entry = placed[feature] ||= { clean: null, wording: null };
        if (parseKey(item.key).source === SOURCE_RI) entry.clean = item.on === true;
        else if (riFeatureOfVersion(parseKey(item.key).id)) entry.wording = item.on === true;
    }
    const modes = {};
    for (const feature of FEATURE_KEYS) {
        const entry = placed[feature];
        if (!entry || customText(feature) === null) { modes[feature] = 'stored'; continue; }
        if (entry.clean && entry.wording) modes[feature] = 'both';
        else if (entry.clean && entry.wording !== null) modes[feature] = 'clean';
        else modes[feature] = 'stored';
    }
    const full = moduleOrder(order);
    const factory = FACTORY();
    return { order: full.every((feature, index) => feature === factory[index]) ? null : full, modes };
}

/** Wire the extension's cards into the bank and the engine. Safe to call more than once. */
let installed = false;
export function installRiCards(setReader) {
    if (installed) return false;
    installed = true;
    setRiCards(() => riCardList(activePreset()));
    setReader?.(() => riGroup());
    return true;
}
