// B23: per-model profiles applied to the live settings, and recognition of blocks added under known names.
// Run with: node --test tests/t_preset_profiles.js
// A fake SillyTavern context stands in for the host (the same shape as t_preset_switch.js): live Chat Completion
// settings, a preset manager that holds the saved files, and a selected model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));
const lib = await import('../src/preset-library.js');

const stored = {};
let selected = '';
let model = 'z-ai/glm-5.1';
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    chatMetadata: {}, getCurrentChatId: () => 'A', saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => model,
    getPresetManager: () => manager,
};
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: Object.fromEntries(Object.keys(stored).map((name, i) => [name, i])), presets: Object.values(stored) }),
};
globalThis.SillyTavern = { getContext: () => host };
// Selecting a preset loads its saved values into the live settings, as SillyTavern does.
const select = name => { selected = name; host.chatCompletionSettings = structuredClone(stored[name]); };
const profiles = await import('../src/preset-profiles.js');
const wb = await import('../src/preset-workbench.js');

const blocks = [{ identifier: 'main', name: 'Main Prompt', content: 'Main.' }, { identifier: 'chatHistory', name: 'Chat History', marker: true }];
const presetWith = (list, extra = {}) => ({ temperature: 1, openai_max_context: 32000, inline_image_quality: 'auto', prompts: structuredClone(blocks),
    prompt_order: [{ character_id: 100001, order: blocks.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: { roleplay_instructions: { modelProfiles: list } }, ...extra });
const glm = { id: 'ctx-glm', kind: 'context-size', label: 'GLM', from: 'ET-glm', models: ['glm'], contextSize: 200000, current: true };
const kimi = { id: 'ctx-kimi', kind: 'context-size', label: 'Kimi', from: 'ET-kimi', models: ['kimi', 'moonshotai/kimi-k2.5'], contextSize: 128000, settings: { inline_image_quality: 'high' } };
const gemini = { id: 'ctx-gem', kind: 'context-size', label: 'Gemini', from: 'ET-gemini', models: ['gemini'], contextSize: null };

test('matching: an exact model name beats a family tag, a family tag matches inside the name, and nothing else matches', () => {
    const data = presetWith([glm, kimi, gemini]);
    assert.deepEqual([profiles.matchProfile(data, 'moonshotai/kimi-k2.5').match, profiles.matchProfile(data, 'moonshotai/kimi-k2.5').profile.id], ['exact', 'ctx-kimi']);
    assert.equal(profiles.matchProfile(data, 'Moonshotai/Kimi-K2.5').match, 'exact');
    const family = profiles.matchProfile(data, 'z-ai/glm-5.1');
    assert.deepEqual([family.match, family.profile.id], ['family', 'ctx-glm']);
    assert.equal(profiles.matchProfile(data, 'kimi-k2.7').profile.id, 'ctx-kimi');
    assert.equal(profiles.matchProfile(data, 'anthropic/claude-opus'), null);
    assert.equal(profiles.matchProfile(data, ''), null);
});

test('a preset with no profiles never matches', () => {
    assert.equal(profiles.matchProfile(presetWith([]), 'z-ai/glm-5.1'), null);
    assert.equal(profiles.matchProfile({ extensions: {} }, 'z-ai/glm-5.1'), null);
    assert.equal(profiles.matchProfile(null, 'z-ai/glm-5.1'), null);
});

test('profile values carry the context size and the kept settings, and skip an empty size', () => {
    assert.deepEqual(profiles.profileValues(kimi), { openai_max_context: 128000, inline_image_quality: 'high' });
    assert.deepEqual(profiles.profileValues(gemini), {});
    assert.deepEqual(profiles.profileValues(null), {});
});

test('a model change applies the profile to the live settings and leaves the saved preset file alone', () => {
    stored.Family = presetWith([glm, kimi, gemini]);
    const before = JSON.stringify(stored.Family);
    profiles.resetProfileState();
    model = 'z-ai/glm-5.1';
    select('Family');
    assert.equal(host.chatCompletionSettings.openai_max_context, 32000);
    const changes = profiles.syncProfile('preset');
    assert.deepEqual(changes, [{ key: 'openai_max_context', from: 32000, to: 200000 }]);
    assert.equal(host.chatCompletionSettings.openai_max_context, 200000);
    assert.equal(JSON.stringify(stored.Family), before);
    const status = profiles.profileStatus();
    assert.equal(status.active.id, 'ctx-glm');
    assert.equal(status.match, 'family');
    assert.equal(status.live, 200000);
    assert.equal(status.own, 32000);
    assert.deepEqual(status.edited, []);
    assert.equal(status.profiles.length, 3);

    model = 'moonshotai/kimi-k2.5';
    const next = profiles.syncProfile('model');
    assert.deepEqual(next, [{ key: 'openai_max_context', from: 200000, to: 128000 }, { key: 'inline_image_quality', from: 'auto', to: 'high' }]);
    assert.equal(host.chatCompletionSettings.inline_image_quality, 'high');
    assert.equal(JSON.stringify(stored.Family), before);
});

test('her own edit to the context size stays until the model changes', () => {
    assert.equal(host.chatCompletionSettings.openai_max_context, 128000);
    host.chatCompletionSettings.openai_max_context = 90000;
    assert.deepEqual(profiles.syncProfile('model'), [], 'the same model again does nothing');
    assert.equal(host.chatCompletionSettings.openai_max_context, 90000);
    const status = profiles.profileStatus();
    assert.deepEqual(status.edited, ['openai_max_context']);
    assert.equal(status.live, 90000);
    model = 'z-ai/glm-5.1';
    profiles.syncProfile('model');
    assert.equal(host.chatCompletionSettings.openai_max_context, 200000);
});

test('with no matching profile the preset keeps its own values, and values a profile set go back to the preset file', () => {
    model = 'moonshotai/kimi-k2.5';
    profiles.syncProfile('model');
    assert.equal(host.chatCompletionSettings.inline_image_quality, 'high');
    model = 'anthropic/claude-opus';
    const changes = profiles.syncProfile('model');
    assert.deepEqual(changes.map(item => item.key).sort(), ['inline_image_quality', 'openai_max_context']);
    assert.equal(host.chatCompletionSettings.openai_max_context, 32000);
    assert.equal(host.chatCompletionSettings.inline_image_quality, 'auto');
    assert.equal(profiles.profileStatus().active, null);
    // A model with no profile changes nothing when nothing was applied before.
    model = 'anthropic/claude-sonnet';
    assert.deepEqual(profiles.syncProfile('model'), []);
    assert.equal(host.chatCompletionSettings.openai_max_context, 32000);
});

test('a profile with no context size leaves the context alone', () => {
    model = 'google/gemini-3';
    assert.deepEqual(profiles.syncProfile('model'), []);
    assert.equal(host.chatCompletionSettings.openai_max_context, 32000);
});

test('a preset change applies the new preset profile; a preset with no profiles keeps what the host loaded', () => {
    stored.Plain = presetWith([], { openai_max_context: 64000 });
    model = 'z-ai/glm-5.1';
    select('Family');
    profiles.syncProfile('preset');
    assert.equal(host.chatCompletionSettings.openai_max_context, 200000);
    select('Plain');
    assert.deepEqual(profiles.syncProfile('preset'), []);
    assert.equal(host.chatCompletionSettings.openai_max_context, 64000);
    assert.equal(profiles.profileStatus().profiles.length, 0);
});

test('a host on another Main API is left alone', () => {
    select('Family');
    host.mainApi = 'textgenerationwebui';
    model = 'moonshotai/kimi-k2.5';
    assert.deepEqual(profiles.syncProfile('model'), []);
    host.mainApi = 'openai';
    assert.equal(host.chatCompletionSettings.openai_max_context, 32000);
});

// ---- Integration finding 7 ----
const DEFAULT_MAIN = 'Write the next reply in the chat.';
const defaultEdition = hash => ({ key: 'sillytavern-default/default', family: 'sillytavern-default', familyLabel: 'SillyTavern Default', label: 'default', distinct: true,
    recognize: { mode: 'distinct', ids: [], hashes: [hash], main: hash, own: 0 }, modules: {}, optional: {}, profiles: [], overrides: [] });
const defaultPreset = extra => {
    const prompts = [{ identifier: 'main', name: 'Main Prompt', content: DEFAULT_MAIN }, { identifier: 'chatHistory', name: 'Chat History', marker: true }, ...extra];
    return { prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: {} };
};
const withNames = [{ identifier: 'dice-1', name: 'Dice Rolls', content: 'Roll the dice.' }, { identifier: 'prose-1', name: 'Prose Rules', content: 'Write plainly.' }];

test('blocks added to a recognised preset under names the library knows count, and an unchanged preset is still recognised at 100%', () => {
    const edition = defaultEdition(lib.blockHash(DEFAULT_MAIN));
    const library = { schema: lib.LIBRARY_SCHEMA, editions: [edition] };
    stored.Default = defaultPreset([]);
    stored['Default plus'] = defaultPreset(withNames);
    wb.useLibrary(library);
    select('Default');
    const plain = wb.switchContext('Default');
    assert.equal(plain.score, 1);
    assert.equal(plain.edition.key, edition.key);
    assert.deepEqual(plain.features.switched, []);
    select('Default plus');
    const context = wb.switchContext('Default plus');
    assert.equal(context.edition.key, edition.key);
    assert.equal(context.score, 1);
    assert.deepEqual(context.features.switched.map(item => [item.key, item.matchedBy, item.blocks.map(block => block.id)]),
        [['style', 'name', ['prose-1']], ['dice', 'name', ['dice-1']]]);
});

test('an unchanged shipped preset gains no row from the name match, and a library module keeps its own row', () => {
    const edition = shipped.editions.find(item => item.recognize.mode === 'distinct' && item.recognize.ids.length >= 5 && item.recognize.ids.length === item.recognize.own
        && !item.modules.dice && !Object.values(item.modules).some(entry => entry.ids.includes('dice-1')));
    assert.ok(edition);
    const ids = [...new Set([...edition.recognize.ids, ...Object.values(edition.modules).flatMap(item => item.ids)])];
    const build = extra => {
        const prompts = [{ identifier: 'main', name: 'Main Prompt', content: 'Main.' }, { identifier: 'chatHistory', name: 'Chat History', marker: true },
            ...ids.map((id, i) => ({ identifier: id, name: `Block ${i}`, content: `Block ${i} text.` })), ...extra];
        return { prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: {} };
    };
    wb.useLibrary(shipped);
    stored.Unchanged = build([]);
    stored.Added = build([{ identifier: 'dice-1', name: 'Dice Rolls', content: 'Roll the dice.' }]);
    select('Unchanged');
    const same = wb.switchContext('Unchanged');
    const added = (select('Added'), wb.switchContext('Added'));
    assert.equal(added.edition.key, same.edition.key);
    assert.equal(added.score, same.score);
    assert.deepEqual(added.features.switched.filter(item => item.key !== 'dice'), same.features.switched);
    assert.deepEqual(added.features.switched.filter(item => item.key === 'dice').map(item => item.blocks.map(block => block.id)), [['dice-1']]);
    assert.equal(same.features.switched.some(item => item.key === 'dice'), false);
});

test('an unrecognised preset still matches by block name as before', () => {
    wb.useLibrary(shipped);
    stored.Odd = defaultPreset(withNames);
    select('Odd');
    const context = wb.switchContext('Odd');
    assert.equal(context.edition, null);
    assert.deepEqual(context.features.switched.map(item => [item.key, item.matchedBy]), [['style', 'name'], ['dice', 'name']]);
});
