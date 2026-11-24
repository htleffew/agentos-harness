// B24: the Both side of the per-feature switch. Run with: node --test tests/t_preset_both.js
// Both keeps every block the preset has on and also sends the extension's text; it is the default for every feature.
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

test('Both is the default for every feature, and a feature nobody chose follows it', () => {
    const switches = wb.resolvedSwitches(wb.switchContext());
    for (const key of lib.FEATURE_KEYS) assert.equal(switches[key], 'both', key);
    assert.equal(lib.DEFAULT_SIDE, 'both');
    assert.deepEqual(lib.SIDES, ['ours', 'theirs', 'both']);
});

test('migration: sides she saved or pinned keep their value; only unchosen features move to Both', () => {
    const context = wb.switchContext();
    // What the old code saved: only the features she changed, as plain ours or theirs.
    host.extensionSettings.roleplay_instructions.presetSwitches = { [context.key]: { style: 'ours', state: 'theirs' } };
    let switches = wb.resolvedSwitches(wb.switchContext());
    assert.equal(switches.style, 'ours');
    assert.equal(switches.state, 'theirs');
    for (const key of lib.FEATURE_KEYS.filter(item => !['style', 'state'].includes(item))) assert.equal(switches[key], 'both', key);
    // A pin made before Both held every feature, defaults included; it keeps all of them.
    chats.A.roleplay_instructions.v10.presetPins = { [context.key]: Object.fromEntries(lib.FEATURE_KEYS.map(key => [key, key === 'state' ? 'ours' : 'theirs'])) };
    switches = wb.resolvedSwitches(wb.switchContext());
    assert.equal(wb.switchScope(wb.switchContext()), 'chat');
    assert.equal(switches.state, 'ours');
    assert.equal(switches.style, 'theirs');
    // An unreadable stored value falls to Both rather than to Theirs.
    host.extensionSettings.roleplay_instructions.presetSwitches = { [context.key]: { style: 'sideways' } };
    delete chats.A.roleplay_instructions.v10.presetPins;
    assert.equal(wb.resolvedSwitches(wb.switchContext()).style, 'both');
    delete host.extensionSettings.roleplay_instructions.presetSwitches;
});

test('Both sends every preset block and the extension text; nothing is switched off', () => {
    const context = wb.switchContext();
    const all = host.chatCompletionSettings.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    assert.deepEqual(wb.workingCopyOff(context), []);
    assert.deepEqual(assemble(), all, 'a block was switched off for Both');
    const modules = effectiveModules();
    for (const key of listed()) {
        assert.equal(modules[key], true, `${key}: the extension text is missing for Both`);
        const owner = moduleOwnership()[key];
        if (owner) assert.equal(owner.usesExtension, true, key);
    }
    for (const item of wb.switchContext().features.switched) for (const block of item.blocks) assert.equal(assemble().includes(block.id), true, `${block.id} dropped`);
});

test('syncOwners maps Both to the owner that sends the extension rule and keeps the host blocks; Ours maps to the same owner, Theirs to the preset', () => {
    const context = wb.switchContext();
    wb.syncOwners(context);
    const owners = () => chats.A.roleplay_instructions.v10.moduleOwners.Sola;
    for (const key of listed()) assert.equal(owners()[key], 'both', key);
    wb.setSwitches(context, { style: 'theirs', state: 'ours' });
    assert.equal(owners().style, 'preset');
    assert.equal(owners().state, 'both');
    assert.equal(wb.ownerFor('both'), 'both');
    assert.equal(effectiveModules().style, false, 'Theirs still sends the extension text');
    wb.setSwitches(context, { style: 'both' });
    assert.equal(owners().style, 'both');
    assert.equal(effectiveModules().style, true);
});

test('a block an Ours feature shares with a Both feature stays on', () => {
    const context = wb.switchContext();
    const blocks = wb.featureBlockIds(context);
    const shared = blocks.state.filter(id => blocks.style.includes(id));
    assert.ok(shared.length, 'the fixture needs a block both features use');
    wb.setSwitches(context, { state: 'ours', style: 'both' });
    const sent = assemble();
    for (const id of shared) assert.equal(sent.includes(id), true, `${id} was switched off although Both still claims it`);
    for (const id of blocks.state.filter(id => !blocks.style.includes(id))) assert.equal(sent.includes(id), false, 'an Ours block was sent');
    wb.setSwitches(context, { state: 'both', style: 'both' });
});

test('bulk Both sets every listed feature and Undo restores the earlier sides', () => {
    const context = wb.switchContext();
    wb.setSwitches(context, { style: 'ours', preflight: 'theirs' });
    const before = wb.resolvedSwitches(wb.switchContext());
    wb.bulkSwitches(wb.switchContext(), 'both');
    for (const key of listed()) assert.equal(wb.resolvedSwitches(wb.switchContext())[key], 'both', key);
    wb.undoBulkSwitches(wb.switchContext());
    assert.deepEqual(wb.resolvedSwitches(wb.switchContext()), before);
});

test('the loadout marker saves and restores Both and stays at version 1', () => {
    const context = wb.switchContext();
    wb.setSwitches(context, { style: 'both', state: 'ours', preflight: 'theirs' });
    const marker = wb.currentMarker(wb.switchContext());
    assert.equal(marker.v, 1);
    assert.equal(marker.switches.style, 'both');
    assert.equal(marker.switches.state, 'ours');
    assert.equal(marker.switches.preflight, 'theirs');
    const blocks = wb.featureBlockIds(wb.switchContext());
    for (const id of blocks.style.filter(id => !blocks.state.includes(id))) assert.equal(marker.off.includes(id), false, 'Both put a block in the off list');
    for (const carrier of ['extensions', 'row']) {
        const data = lo.buildLoadout(stored.Sola, marker, { carrier });
        const read = lo.readMarker(data);
        assert.deepEqual(read.switches, marker.switches, carrier);
        assert.equal(read.v, 1);
    }
});

test('an older marker without Both still loads; a feature it does not name falls to Both', () => {
    const older = { v: 1, base: 'Sola', edition: 'sola/kindling-v2', switches: { state: 'ours', style: 'theirs' }, off: [], saved: 1 };
    const data = { extensions: { [lo.MARKER_KEY]: { loadout: older } } };
    assert.deepEqual(lo.readMarker(data).switches, { state: 'ours', style: 'theirs' });
    stored['Sola + RI Old'] = { ...structuredClone(stored.Sola), extensions: { [lo.MARKER_KEY]: { loadout: older } } };
    select('Sola + RI Old');
    const context = wb.switchContext();
    assert.ok(context.marker);
    const switches = wb.resolvedSwitches(context);
    assert.equal(switches.state, 'ours');
    assert.equal(switches.style, 'theirs');
    for (const key of lib.FEATURE_KEYS.filter(item => !['state', 'style'].includes(item))) assert.equal(switches[key], 'both', key);
    // A reader from before Both keeps only the sides it knows; the marker itself still reads.
    const withBoth = lo.makeMarker({ base: 'Sola', switches: { style: 'both', state: 'ours' } });
    assert.deepEqual(withBoth.switches, { style: 'both', state: 'ours' });
    assert.equal(lo.makeMarker({ base: 'Sola', switches: { style: 'sideways' } }).switches.style, undefined);
    select('Sola');
});
