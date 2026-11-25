// B31: the extension's own cards and the companion preset in the block bank. Run with: node --test tests/t_preset_bank_ri.js
// A fake SillyTavern context stands in for the host (as in t_preset_bank.js). The browser suite t_ri_cards.js reads the real
// request from the mock log; this file covers the card model, the stack reading, the order and the owners. Every text here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const companionFile = JSON.parse(readFileSync(root + 'presets/Roleplay Instructions V10.json', 'utf8'));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));

const chats = { A: {} };
let chat = 'A';
let stored = {};
let selected = '';
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    get chatMetadata() { return chats[chat]; }, getCurrentChatId: () => chat, saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1',
    getPresetManager: () => manager,
};
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: Object.fromEntries(Object.keys(stored).map((name, i) => [name, i])), presets: Object.values(stored) }),
    async savePreset(name, data) { stored[name] = structuredClone(data); },
};
globalThis.SillyTavern = { getContext: () => host };
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });

const bank = await import('../src/preset-bank.js');
const ri = await import('../src/preset-bank-ri.js');
const P = await import('../src/prompts.js');
const V = await import('../src/v10.js');
const MP = await import('../src/module-layout.js');
const wb = await import('../src/preset-workbench.js');
const lib = await import('../src/preset-library.js');
const { settings } = await import('../src/store.js');
ri.installRiCards(V.setRiGroupReader);

const block = (identifier, name, content, extra = {}) => ({ identifier, name, content, role: 'system', system_prompt: false, injection_position: 0, ...extra });
const presetOf = (blocks, enabled) => ({ temperature: 1, openai_max_context: 32000, prompts: blocks, extensions: {},
    prompt_order: [{ character_id: 100001, order: blocks.map(b => ({ identifier: b.identifier, enabled: enabled.includes(b.identifier) })) }] });
const alpha = () => presetOf([block('main', 'Main Prompt', 'Alpha main prompt text.'), block('a-note', 'Side note', 'Keep every reply under four paragraphs.'),
    { identifier: 'chatHistory', name: 'Chat History', marker: true, system_prompt: true }], ['main', 'a-note', 'chatHistory']);
const beta = () => presetOf([block('main', 'Main Prompt', 'Beta main prompt text.'), { identifier: 'chatHistory', name: 'Chat History', marker: true, system_prompt: true }], ['main', 'chatHistory']);
const COMPANION = 'Roleplay Instructions V10';
const WORDING = 'Describe only what a careful observer could see in the room.';
const WORDING_2 = 'Track each relationship in one plain line.';

function select(name) { selected = name; host.chatCompletionSettings = structuredClone(stored[name]); }
function openChat() { chats.A = { roleplay_instructions: { v10: { enabled: true } } }; }
function reset() {
    const st = settings();
    for (const name of ['bankVersions', 'bankStacks', 'bankTexts', 'bankSources', 'bankTags', 'presetSwitches', 'prompts']) delete st[name];
    openChat();
    stored = { Alpha: alpha(), Beta: beta(), [COMPANION]: structuredClone(companionFile) };
    bank.resetBank();
    bank.useBankLibrary(shipped);
    bank.useCompanionFile(null);
    wb.useLibrary(shipped);
    select('Alpha');
    return bank.refreshBank('test');
}
const stackKey = 'preset:Alpha';
const onMap = stack => Object.fromEntries(stack.ri.map(item => [item.key, item.on]));
const storedWording = feature => MP.MODULE_PROMPTS[feature].map(id => settings().prompts?.[id]?.text ?? P.PROMPTS[id].text).join('\n\n');
const shippedDefault = feature => MP.MODULE_PROMPTS[feature].map(id => P.PROMPTS[id].text).join('\n\n');

test('every feature has one RI card whose clean text is the shipped default', () => {
    const b = reset();
    const cards = b.sources.get(bank.SOURCE_RI).cards;
    assert.deepEqual(cards.map(card => card.id).sort(), [...lib.FEATURE_KEYS].sort(), 'one card per feature, none twice');
    assert.deepEqual(Object.keys(MP.MODULE_PROMPTS).sort(), [...lib.FEATURE_KEYS].sort(), 'every feature names the prompts it uses');
    for (const feature of lib.FEATURE_KEYS) {
        assert.ok(MP.MODULE_PROMPTS[feature].every(id => P.PROMPTS[id]), `${feature} names stored prompts`);
        assert.equal(b.cards.get(`ri::${feature}`).text, shippedDefault(feature), `${feature}: the clean card holds the shipped default`);
        assert.equal(b.cards.get(`ri::${feature}`).name, lib.FEATURES[feature].label);
    }
    assert.equal(ri.syncRiVersions(), false, 'with no saved wording there is no version');
    assert.deepEqual(bank.listVersions(), []);
});

test('her saved wording is a version of the card and equals the stored text; the clean card stays the default', () => {
    reset();
    P.savePrompt('groundedRealism', WORDING);
    P.savePrompt('structuredRelationships', WORDING_2);
    assert.equal(ri.syncRiVersions(), true);
    const b = bank.currentBank();
    assert.deepEqual(bank.listVersions().map(version => version.id).sort(), ['ri-relationships', 'ri-style']);
    for (const feature of ['style', 'relationships']) {
        const version = bank.getVersion(`ri-${feature}`);
        assert.equal(version.text, storedWording(feature), `${feature}: the version is the stored text`);
        assert.equal(bank.bankCard(b, `v::ri-${feature}`).text, storedWording(feature));
        assert.equal(b.cards.get(`ri::${feature}`).text, shippedDefault(feature), `${feature}: the clean card is unchanged`);
        assert.equal(version.source, bank.SOURCE_RI);
        assert.equal(version.sourceId, feature);
    }
    assert.ok(bank.getVersion('ri-style').text.includes(WORDING) && bank.getVersion('ri-style').text.includes(P.PROMPTS.heightenedRealism.text), 'the unchanged prompt of the feature keeps its default text');
    assert.equal(bank.getVersion('ri-state'), null, 'a feature with no saved wording has no version');
    // The version follows later edits of the stored prompt, and goes when she restores the default.
    P.savePrompt('groundedRealism', `${WORDING} Keep it short.`);
    ri.syncRiVersions();
    assert.equal(bank.getVersion('ri-style').text, storedWording('style'));
    P.restorePrompt('groundedRealism');
    ri.syncRiVersions();
    assert.equal(bank.getVersion('ri-style'), null);
    assert.equal(bank.getVersion('ri-relationships').text, storedWording('relationships'), 'the other version is untouched');
});

test('her saved wording is placed beside the clean card, and what the request carries stays the same', () => {
    const b = reset();
    const start = bank.stackFor(b, 'Alpha');
    const others = onMap(start);
    P.savePrompt('groundedRealism', WORDING);
    const group = ri.riGroup();
    const stack = bank.storedStack(stackKey);
    const keys = stack.ri.map(item => item.key);
    assert.equal(keys[keys.indexOf('ri::style') + 1], 'v::ri-style', 'her wording sits right after the clean card');
    const now = onMap(stack);
    assert.equal(now['v::ri-style'], true);
    assert.equal(now['ri::style'], false, 'the clean card is left out so the same text goes out as before');
    for (const [key, on] of Object.entries(others)) if (key !== 'ri::style') assert.equal(now[key], on, `${key} keeps its state`);
    assert.equal(group.modes.style, 'stored', 'the stored text is sent');
    // Read again: nothing changes.
    const before = JSON.stringify(stack);
    ri.riGroup();
    assert.equal(JSON.stringify(bank.storedStack(stackKey)), before);
    // Her taps decide the rest.
    const cur = bank.currentBank();
    bank.includeCards(cur, stackKey, ['ri::style'], { base: 'Alpha' });
    assert.equal(ri.riGroup().modes.style, 'both', 'the clean card and her version are both in the stack');
    bank.excludeCards(cur, stackKey, ['v::ri-style'], { base: 'Alpha' });
    assert.equal(ri.riGroup().modes.style, 'clean', 'the clean card alone sends the shipped default');
    bank.excludeCards(cur, stackKey, ['ri::style'], { base: 'Alpha' });
    bank.includeCards(cur, stackKey, ['v::ri-style'], { base: 'Alpha' });
    assert.equal(ri.riGroup().modes.style, 'stored', 'her version alone sends the stored text');
    assert.equal(ri.riGroup().modes.state, 'stored', 'a feature with no saved wording sends its prompt');
});

test('a card for each wording: the request builder sends both texts, one text, or the other', () => {
    reset();
    P.savePrompt('groundedRealism', WORDING);
    const build = () => [['style', `Style: ${P.promptText('groundedRealism')}`], ['style', 'Fixed line.'], ['state', 'Records: none.']];
    const texts = parts => parts.map(part => part[1]);
    const stored_ = `Style: ${WORDING}`, clean = `Style: ${P.PROMPTS.groundedRealism.text}`;
    assert.deepEqual(texts(V.variantParts(build, { style: 'stored' })), [stored_, 'Fixed line.', 'Records: none.']);
    assert.deepEqual(texts(V.variantParts(build, { style: 'clean' })), [clean, 'Fixed line.', 'Records: none.']);
    assert.deepEqual(texts(V.variantParts(build, { style: 'both' })), [clean, stored_, 'Fixed line.', 'Records: none.'], 'clean first, then hers; a line the two share goes once');
    assert.deepEqual(texts(V.variantParts(build, null)), [stored_, 'Fixed line.', 'Records: none.']);
    assert.deepEqual(texts(V.variantParts(build, { style: 'none' })), ['Fixed line.', 'Records: none.'], 'none: the prompt text goes, fixed lines stay');
    const mixed = () => [['relationships', `For a relationship use subject and other. ${P.promptText('structuredRelationships')}`]];
    assert.deepEqual(texts(V.variantParts(mixed, { relationships: 'none' })), ['For a relationship use subject and other.'], 'none keeps the fixed part of a mixed line');
    assert.equal(P.promptText('groundedRealism'), WORDING, 'building the clean pass leaves the stored text readable');
});

test('the order of the RI cards is the order in the request, and the old module order is read once', () => {
    const b = reset();
    const start = bank.stackFor(b, 'Alpha');
    assert.equal(ri.riGroup().order, null, 'the factory order sends the sections as built');
    const wanted = ['dice', 'relationships', ...MP.moduleOrder().filter(key => !['dice', 'relationships'].includes(key))];
    chats.A.roleplay_instructions.v10.moduleOrder = wanted;
    const before = onMap(bank.storedStack(stackKey));
    const group = ri.riGroup();
    assert.deepEqual(group.order.slice(0, 2), ['dice', 'relationships'], 'the old order is now the group order');
    const after = onMap(bank.storedStack(stackKey));
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no card left the stack');
    assert.deepEqual(Object.fromEntries(Object.entries(after).sort()), Object.fromEntries(Object.entries(before).sort()), 'every card keeps its on or off state');
    assert.ok(Object.values(after).every(Boolean));
    assert.equal(chats.A.roleplay_instructions.v10.moduleOrderRead, true);
    assert.equal(start.cards.length, bank.storedStack(stackKey).cards.length, 'the main group is untouched');
    // The record is not read again.
    chats.A.roleplay_instructions.v10.moduleOrder = [...wanted].reverse();
    assert.deepEqual(ri.riGroup().order.slice(0, 2), ['dice', 'relationships']);
    // A step of one card changes the next request's order.
    const cur = bank.currentBank();
    bank.stepCard(cur, stackKey, 'ri::dice', 1, { base: 'Alpha' });
    assert.deepEqual(ri.riGroup().order.slice(0, 2), ['relationships', 'dice']);
    bank.moveCards(cur, stackKey, ['ri::style'], 0, { base: 'Alpha' });
    assert.equal(ri.riGroup().order[0], 'style');
});

test('a new stack starts in the old order, and a chat with no old order sends the factory order', () => {
    openChat();
    const order = ['plots', ...MP.moduleOrder().filter(key => key !== 'plots')];
    reset();
    chats.A.roleplay_instructions.v10.moduleOrder = order;
    bank.resetBank();
    const b = bank.refreshBank('test');
    const stack = bank.stackFor(b, 'Alpha');
    assert.equal(stack.ri[0].key, 'ri::plots', 'the starting stack follows the old order');
    assert.equal(ri.riGroup().order[0], 'plots');
});

test('her saved wording counts as the feature being in the stack, and a feature with neither card sends nothing', () => {
    reset();
    P.savePrompt('groundedRealism', WORDING);
    ri.riGroup();
    const cur = bank.currentBank();
    const owners = () => chats.A.roleplay_instructions.v10.moduleOwners?.Alpha || {};
    wb.syncOwners();
    assert.equal(owners().style, 'both', 'her wording alone keeps the feature on');
    bank.excludeCards(cur, stackKey, ['v::ri-style'], { base: 'Alpha' });
    wb.syncOwners();
    assert.equal(owners().style, 'preset', 'both cards out: the extension sends none of its text');
    assert.equal(V.effectiveModules().style, false);
    bank.includeCards(cur, stackKey, ['ri::style'], { base: 'Alpha' });
    wb.syncOwners();
    assert.equal(owners().style, 'both');
    assert.equal(V.effectiveModules().style, true);
});

test('the working copy does not insert her saved wording, so the extension sends it once', () => {
    reset();
    P.savePrompt('groundedRealism', WORDING);
    ri.riGroup();
    wb.applyWorkingCopy();
    const sent = host.chatCompletionSettings.prompts.filter(prompt => String(prompt.content || '').includes(WORDING));
    wb.restoreWorkingCopy();
    assert.equal(sent.length, 0, 'no preset prompt carries her saved wording');
    // A free-text version of a card is still sent as an inserted block, as before.
    const cur = bank.currentBank();
    const mine = bank.createVersion(cur, 'ri::dice', { label: 'Mine', text: 'Roll once per scene.' });
    bank.includeCards(cur, stackKey, [bank.versionKey(mine.id)], { base: 'Alpha' });
    wb.applyWorkingCopy();
    const inserted = host.chatCompletionSettings.prompts.filter(prompt => prompt.content === 'Roll once per scene.');
    wb.restoreWorkingCopy();
    assert.equal(inserted.length, 1);
});

test('the companion is a source in the bank of any base, and as the base it gives every RI card and its shipped-on blocks', () => {
    const b = reset();
    const companion = b.sources.get(bank.SOURCE_COMPANION);
    assert.equal(companion.name, COMPANION);
    const craft = companion.cards.filter(card => /^ri-craft-|^ri-check-/.test(card.id));
    assert.ok(craft.length >= 2, 'the craft and check blocks are cards');
    // Any base: Alpha and Beta can take a companion block that ships off, with one tap.
    for (const base of ['Alpha', 'Beta']) {
        select(base);
        const key = bank.stackFor(b, base).key;
        const offCard = companion.cards.find(card => !card.shippedOn && !card.marker);
        assert.ok(offCard, 'the companion has a block that ships off');
        assert.equal(bank.canInclude(b, offCard.key, base).ok, true);
        const next = bank.includeCards(b, key, [offCard.key], { base });
        const plan = bank.stackPlan(b, next, base);
        assert.equal(plan.find(item => item.key === offCard.key)?.on, true, `${base}: the companion block is in the stack`);
        assert.ok(plan.some(item => item.source === bank.SOURCE_COMPANION && item.on && item.key !== offCard.key), `${base}: the shipped-on companion blocks are in too`);
    }
    // The companion as base.
    select(COMPANION);
    const stack = bank.stackFor(b, COMPANION);
    const plan = bank.stackPlan(b, stack, COMPANION);
    const ricards = plan.filter(item => item.group === 'ri' && item.source === bank.SOURCE_RI);
    const on = bank.featureOn(COMPANION);
    assert.deepEqual(ricards.map(item => item.id).sort(), lib.FEATURE_KEYS.filter(key => on[key]).sort(), 'every RI card that is on');
    assert.ok(ricards.every(item => item.on));
    const shippedOn = companionFile.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    const sentIds = plan.filter(item => item.group === 'main' && item.on).map(item => item.id);
    assert.deepEqual(sentIds, shippedOn, 'the companion blocks that ship on are on, in the companion order');
});
