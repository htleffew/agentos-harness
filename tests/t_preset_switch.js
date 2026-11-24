// B12: recognition, the per-feature Ours or Theirs switch and the working copy. Run with: node --test tests/t_preset_switch.js
// A fake SillyTavern context stands in for the host; the request a provider receives is modelled as the enabled
// blocks of the global prompt order at the moment SillyTavern assembles the prompt (prepareOpenAIMessages reads them
// between GENERATION_STARTED and CHAT_COMPLETION_PROMPT_READY in SillyTavern 1.19).
// Pass --write to rewrite presets/preset-families.json from the analyst map.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const lib = await import('../src/preset-library.js');
const full = JSON.parse(readFileSync(root + 'docs/ux-overhaul/presets/preset-families.json', 'utf8'));
const shippedPath = root + 'presets/preset-families.json';
if (process.argv.includes('--write')) writeFileSync(shippedPath, lib.asciiJson(lib.compactFamilies(full)));
const shipped = JSON.parse(readFileSync(shippedPath, 'utf8'));

// A host with two chats, a preset manager and live Chat Completion settings.
const chats = { A: {}, B: {} };
let chat = 'A';
const stored = {};
function presetFromEdition(edition, extra = []) {
    const ids = [...new Set([...edition.recognize.ids, ...Object.values(edition.modules).flatMap(m => m.ids)])];
    const prompts = [{ identifier: 'main', name: 'Main Prompt', content: 'Main.' }, { identifier: 'chatHistory', name: 'Chat History', marker: true },
        ...ids.map((id, i) => ({ identifier: id, name: `Block ${i}`, content: `Block ${i} text.`, role: 'system' })), ...extra];
    return { temperature: 1, prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: {} };
}
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    get chatMetadata() { return chats[chat]; }, getCurrentChatId: () => chat, saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1',
    getPresetManager: () => manager,
};
let selected = '';
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: Object.fromEntries(Object.keys(stored).map((name, i) => [name, i])), presets: Object.values(stored) }),
    async savePreset(name, data) { stored[name] = structuredClone(data); },
};
globalThis.SillyTavern = { getContext: () => host };
function select(name) { selected = name; host.chatCompletionSettings = structuredClone(stored[name]); }
const wb = await import('../src/preset-workbench.js');
const { effectiveModules } = await import('../src/v10.js');
function openChat(id) { chat = id; chats[id].roleplay_instructions ||= {}; chats[id].roleplay_instructions.v10 = { ...(chats[id].roleplay_instructions.v10 || {}), enabled: true }; }
// The prompt SillyTavern assembles: enabled blocks in order, read while the working copy is applied.
function assemble() {
    wb.applyWorkingCopy();
    const order = host.chatCompletionSettings.prompt_order[0].order;
    const sent = order.filter(entry => entry.enabled).map(entry => entry.identifier);
    wb.restoreWorkingCopy();
    return sent;
}

const editionOf = key => shipped.editions.find(edition => edition.key === key);

test('the shipped map is the analyst map compacted, holds no literal emoji and keeps every edition', () => {
    assert.deepEqual(shipped, JSON.parse(lib.asciiJson(lib.compactFamilies(full))));
    assert.equal(/[^\u0000-\u007f]/.test(readFileSync(shippedPath, 'utf8')), false);
    assert.equal(shipped.editions.length, full.families.reduce((n, family) => n + family.editions.length, 0));
});

test('block hashes follow the P1 rule and the plain SHA-256 matches node crypto', () => {
    for (const text of ['', 'abc', 'x'.repeat(1000), 'café ☃ \u{1F512}']) {
        assert.equal(lib.sha256Hex(text), createHash('sha256').update(text).digest('hex'));
    }
    const normal = 'Line one\nLine two';
    assert.equal(lib.blockHash('  Line one\r\n\tLine   two  '), createHash('sha256').update(normal.replace(/\s+/g, ' ')).digest('hex').slice(0, 16));
    assert.equal(lib.blockHash('   '), '');
});

test('recognition picks the edition a preset was built from and rejects an unrelated preset', () => {
    const sample = shipped.editions.filter(edition => edition.recognize.mode === 'distinct' && edition.recognize.ids.length >= 5);
    assert.ok(sample.length > 50);
    for (const edition of sample) {
        const key = edition.key;
        const match = lib.recognize(presetFromEdition(edition), shipped);
        assert.ok(match, key);
        assert.ok(match.edition.key === key || (edition.recognize.twins || []).includes(match.edition.key), `${key} -> ${match.edition.key}`);
    }
    assert.equal(lib.recognize({ prompts: [{ identifier: 'x', name: 'Mine', content: 'Something of my own entirely.' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'x', enabled: true }] }] }, shipped), null);
});

test('selecting a preset lists the features both sides offer, and the list changes with the preset', () => {
    stored.Sola = presetFromEdition(editionOf('sola/kindling-v2'));
    stored.Nemo = presetFromEdition(editionOf('nemo-engine/12.5.3'));
    stored.Plain = { prompts: [{ identifier: 'dr', name: 'Dice Rolls', content: 'Roll a d20 for every attempt.' }, { identifier: 'pr', name: 'Prose Rules', content: 'Write tight prose.' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'dr', enabled: true }, { identifier: 'pr', enabled: true }] }], extensions: {} };
    wb.useLibrary(shipped);
    openChat('A');
    select('Sola');
    const sola = wb.switchContext();
    assert.equal(sola.edition.key, 'sola/kindling-v2');
    assert.deepEqual(sola.features.switched.map(item => item.key).sort(), ['emotions', 'preflight', 'relationships', 'state', 'style']);
    assert.deepEqual(sola.features.alongside.map(item => item.key), ['worldEvents']);
    assert.equal(sola.features.switched.find(item => item.key === 'style').verdict, 'contradictory');
    select('Nemo');
    const nemo = wb.switchContext();
    assert.notDeepEqual(nemo.features.switched.map(item => item.key), sola.features.switched.map(item => item.key));
    select('Plain');
    const plain = wb.switchContext();
    assert.equal(plain.edition, null);
    assert.deepEqual(plain.features.switched.map(item => [item.key, item.matchedBy]), [['style', 'name'], ['dice', 'name']]);
});

test('every feature starts on Both (the sides B12 started on are one choice away)', () => {
    select('Sola');
    const switches = wb.resolvedSwitches(wb.switchContext());
    for (const key of lib.FEATURE_KEYS) assert.equal(switches[key], 'both', key);
});

test('Ours switches the preset blocks off in the working copy only; Theirs sends none of the extension text', () => {
    select('Sola');
    const context = wb.switchContext();
    // The sides B12 started on, chosen explicitly now that the default is Both.
    wb.setSwitches(context, { state: 'ours', emotions: 'ours', relationships: 'ours', dice: 'ours', colors: 'ours',
        style: 'theirs', preflight: 'theirs', knowledge: 'theirs', plots: 'theirs', worldEvents: 'theirs', roast: 'theirs', roastFeedback: 'theirs' });
    const ids = wb.featureBlockIds(context);
    const before = JSON.stringify(stored.Sola);
    const live = JSON.stringify(host.chatCompletionSettings);
    const sent = assemble();
    const only = (mine, other) => mine.filter(id => !other.includes(id));
    const shared = ids.state.filter(id => ids.style.includes(id));
    assert.ok(only(ids.state, ids.style).length && shared.length, 'the fixture needs exclusive and shared blocks');
    for (const id of only(ids.state, ids.style)) assert.equal(sent.includes(id), false, 'a story state block was sent');
    for (const id of ids.style) assert.equal(sent.includes(id), true, 'a writing style block was dropped');
    assert.equal(JSON.stringify(stored.Sola), before, 'the saved preset changed');
    assert.equal(JSON.stringify(host.chatCompletionSettings), live, 'the live preset kept the working copy');
    const modules = effectiveModules();
    assert.equal(modules.style, false, 'Theirs still sends the extension writing guidance');
    assert.equal(modules.state, true, 'Ours does not run the extension story state');
    // Flip both and check again.
    wb.setSwitches(context, { style: 'ours', state: 'theirs' });
    const flipped = assemble();
    const switches = wb.resolvedSwitches(wb.switchContext());
    for (const [id, keys] of wb.blockFeatures(wb.switchContext())) {
        assert.equal(flipped.includes(id), !keys.every(key => switches[key] === 'ours'), `${id} claimed by ${keys}`);
    }
    for (const id of ids.state) assert.equal(flipped.includes(id), true, 'a block of a Theirs feature was dropped');
    assert.equal(effectiveModules().style, true);
    assert.equal(effectiveModules().state, false);
});

test('choices save per edition, other chats follow, and a chat can pin its own', () => {
    select('Sola');
    const context = wb.switchContext();
    assert.equal(wb.switchScope(context), 'edition');
    assert.equal(host.extensionSettings.roleplay_instructions.presetSwitches['sola/kindling-v2'].style, 'ours');
    openChat('B');
    assert.equal(wb.resolvedSwitches(wb.switchContext()).style, 'ours', 'chat B does not follow the edition choice');
    wb.pinSwitches(wb.switchContext(), true);
    wb.setSwitches(wb.switchContext(), { style: 'theirs' });
    assert.equal(wb.switchScope(wb.switchContext()), 'chat');
    assert.equal(wb.resolvedSwitches(wb.switchContext()).style, 'theirs');
    openChat('A');
    assert.equal(wb.resolvedSwitches(wb.switchContext()).style, 'ours', 'the pin in chat B leaked into chat A');
    openChat('B');
    wb.pinSwitches(wb.switchContext(), false);
    assert.equal(wb.resolvedSwitches(wb.switchContext()).style, 'ours');
    openChat('A');
});

test('bulk switches have undo', () => {
    select('Sola');
    const context = wb.switchContext();
    const before = wb.resolvedSwitches(context);
    wb.bulkSwitches(context, 'theirs');
    const after = wb.resolvedSwitches(wb.switchContext());
    for (const item of context.features.switched) assert.equal(after[item.key], lib.MEMORY_FEATURES.includes(item.key) ? 'ours' : 'theirs', item.key);
    assert.equal(wb.bulkUndoAvailable(wb.switchContext()), true);
    wb.undoBulkSwitches(wb.switchContext());
    assert.deepEqual(wb.resolvedSwitches(wb.switchContext()), before);
    wb.bulkSwitches(wb.switchContext(), 'ours');
    assert.ok(context.features.switched.every(item => wb.resolvedSwitches(wb.switchContext())[item.key] === 'ours'));
    wb.undoBulkSwitches(wb.switchContext());
    assert.equal(wb.bulkUndoAvailable(wb.switchContext()), false);
});

test('with the extension off for a chat, the preset is sent exactly as saved', () => {
    select('Sola');
    chats.A.roleplay_instructions.v10.enabled = false;
    const order = host.chatCompletionSettings.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    assert.deepEqual(assemble(), order);
    chats.A.roleplay_instructions.v10.enabled = true;
});

test('the companion preset lists nothing to switch', () => {
    stored['Roleplay Instructions V10'] = { prompts: [{ identifier: 'ri-craft-voice', name: 'Voice', content: 'Distinct voices.' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'ri-craft-voice', enabled: true }] }], extensions: {} };
    select('Roleplay Instructions V10');
    const context = wb.switchContext();
    assert.equal(context.companion, true);
    assert.deepEqual(context.features.switched, []);
    assert.deepEqual(assemble(), ['ri-craft-voice']);
});

test('a model profile follows the selected model', () => {
    const edition = shipped.editions.find(item => item.profiles.some(profile => profile.models.includes('glm')));
    assert.ok(lib.activeProfile(edition, 'z-ai/glm-5.1'));
    assert.equal(lib.activeProfile(edition, 'some-other-model'), null);
});
