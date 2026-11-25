// B24, reworked in B36b: the Ours, Theirs and Both switch retired (DECISIONS 2026-11-24, Presets compose freely).
// Switches she stored before have no effect, nothing is switched off, and old markers (B24 Both, B35 loadouts) still read.
// The same fake host as t_preset_switch.js stands in for SillyTavern; the request is modelled as the enabled blocks of the
// global prompt order while the working copy is applied, plus effectiveModules() for the extension's own text.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));
const lib = await import('../src/preset-library.js');
const lo = await import('../src/preset-loadouts.js');

const chats = { A: {}, B: {} };
let chat = 'A';
const stored = {};
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    get chatMetadata() { return chats[chat]; }, getCurrentChatId: () => chat, saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1', getPresetManager: () => manager,
};
let selected = '';
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: Object.fromEntries(Object.keys(stored).map((name, i) => [name, i])), presets: Object.values(stored) }),
    async savePreset(name, data) { stored[name] = structuredClone(data); },
};
globalThis.SillyTavern = { getContext: () => host };
const select = name => { selected = name; host.chatCompletionSettings = structuredClone(stored[name]); };
const wb = await import('../src/preset-workbench.js');
const { effectiveModules, moduleOwnership } = await import('../src/v10.js');
const openChat = id => { chat = id; chats[id].roleplay_instructions ||= {}; chats[id].roleplay_instructions.v10 = { ...(chats[id].roleplay_instructions.v10 || {}), enabled: true }; };
const assemble = () => {
    wb.applyWorkingCopy();
    const sent = host.chatCompletionSettings.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    wb.restoreWorkingCopy();
    return sent;
};
const edition = shipped.editions.find(item => item.key === 'sola/kindling-v2');
const ids = [...new Set([...edition.recognize.ids, ...Object.values(edition.modules).flatMap(item => item.ids)])];
const prompts = [{ identifier: 'main', name: 'Main Prompt', content: 'Main.' }, { identifier: 'chatHistory', name: 'Chat History', marker: true },
    ...ids.map((id, i) => ({ identifier: id, name: `Block ${i}`, content: `Block ${i} text.`, role: 'system' }))];
stored.Sola = { temperature: 1, prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }], extensions: {} };
wb.useLibrary(shipped);
openChat('A');
select('Sola');
const listed = () => wb.switchContext().features.switched.map(item => item.key);

test('a stored Ours or Theirs switch, or a chat pin, has no effect: nothing is switched off and every owner stays Both', () => {
    const context = wb.switchContext();
    const all = host.chatCompletionSettings.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    host.extensionSettings.roleplay_instructions.presetSwitches = { [context.key]: { style: 'ours', state: 'theirs' } };
    chats.A.roleplay_instructions.v10.presetPins = { [context.key]: Object.fromEntries(lib.FEATURE_KEYS.map(key => [key, 'theirs'])) };
    wb.syncOwners(context);
    const owners = chats.A.roleplay_instructions.v10.moduleOwners.Sola;
    for (const key of listed()) assert.equal(owners[key], 'both', key);
    assert.deepEqual(assemble(), all, 'a stored switch switched a block off');
    const modules = effectiveModules();
    for (const key of listed()) assert.equal(modules[key], true, `${key}: the extension text went missing`);
    assert.deepEqual(host.extensionSettings.roleplay_instructions.presetSwitches[context.key], { style: 'ours', state: 'theirs' }, 'her saved data was rewritten');
    delete host.extensionSettings.roleplay_instructions.presetSwitches;
    delete chats.A.roleplay_instructions.v10.presetPins;
});

test('the retired switch surface is gone from the workbench', () => {
    for (const name of ['setSwitches', 'resolvedSwitches', 'pinSwitches', 'bulkSwitches', 'undoBulkSwitches', 'bulkUndoAvailable', 'switchScope', 'blockFeatures', 'currentMarker', 'ownerFor'])
        assert.equal(name in wb, false, name);
});

test('markers written with Both still read and still stay at version 1', () => {
    const marker = lo.makeMarker({ base: 'Sola', edition: 'sola/kindling-v2', switches: { style: 'both', state: 'ours', preflight: 'theirs' }, off: [] });
    assert.equal(marker.v, 1);
    for (const carrier of ['extensions', 'row']) {
        const read = lo.readMarker(lo.buildLoadout(stored.Sola, marker, { carrier }));
        assert.deepEqual(read.switches, marker.switches, carrier);
        assert.equal(read.v, 1);
    }
    assert.equal(lo.makeMarker({ base: 'Sola', switches: { style: 'sideways' } }).switches.style, undefined);
});

test('an older version 1 loadout still opens as a stack she can edit, and opening it writes no switches', () => {
    const older = { v: 1, base: 'Sola', edition: 'sola/kindling-v2', switches: { state: 'ours', style: 'theirs' }, off: [], saved: 1 };
    stored['Sola + RI Old'] = { ...structuredClone(stored.Sola), extensions: { [lo.MARKER_KEY]: { loadout: older } } };
    select('Sola + RI Old');
    const context = wb.switchContext();
    assert.ok(context.marker);
    assert.deepEqual(lo.readMarker(context.data).switches, { state: 'ours', style: 'theirs' });
    assert.equal(wb.workingPlan(context), null, 'a loadout sends as saved');
    assert.doesNotThrow(() => wb.syncOwners(context));
    assert.equal(host.extensionSettings.roleplay_instructions.presetSwitches, undefined, 'opening it wrote switches');
    select('Sola');
});
