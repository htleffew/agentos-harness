// B12: saved loadouts and their hidden marker. Run with: node --test tests/t_loadouts.js
// The fake preset manager follows SillyTavern 1.19 (public/scripts/preset-manager.js): savePreset posts the whole
// preset object, updateList selects a new name, and export or import moves the file as JSON. The host check of
// save, export and import is in docs/ux-overhaul/tickets/B12.md, Notes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));
const lo = await import('../src/preset-loadouts.js');

const files = {};
let selected = '';
const saves = [];
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => {
        const names = Object.keys(files);
        return { preset_names: Object.fromEntries(names.map((name, i) => [name, i])), presets: names.map(name => files[name]) };
    },
    async savePreset(name, data, { skipUpdate = false } = {}) {
        // The server stores what it receives; JSON is the wire format.
        files[name] = JSON.parse(JSON.stringify(data));
        saves.push(name);
        if (!skipUpdate) select(name);
    },
    async deletePreset(name) { delete files[name]; if (selected === name) select(Object.keys(files)[0]); return true; },
};
const chats = { A: { roleplay_instructions: { v10: { enabled: true } } } };
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } }, get chatMetadata() { return chats.A; },
    getCurrentChatId: () => 'A', saveMetadataDebounced() {}, saveSettingsDebounced() {}, chatCompletionSettings: null, getPresetManager: () => manager,
};
globalThis.SillyTavern = { getContext: () => host };
function select(name) { selected = name; host.chatCompletionSettings = files[name] ? JSON.parse(JSON.stringify(files[name])) : null; }
const wb = await import('../src/preset-workbench.js');
wb.useLibrary(shipped);

const edition = shipped.editions.find(item => item.key === 'sola/kindling-v2');
function solaPreset() {
    const ids = [...new Set([...edition.recognize.ids, ...Object.values(edition.modules).flatMap(m => m.ids)])];
    const prompts = [{ identifier: 'main', name: 'Main Prompt', content: 'Main.' }, ...ids.map((id, i) => ({ identifier: id, name: `Block ${i}`, content: `Block ${i}.` }))];
    return { temperature: 0.9, prompts, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }],
        extensions: { regex_scripts: [{ scriptName: 'Hide HUD', findRegex: '/<hud>/g' }] } };
}
const enabledIds = data => data.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);

test('loadout names follow "<preset> + RI <name>" and refuse empty or unsafe names', () => {
    assert.equal(lo.loadoutName('Neon Sola V5', '  Noir   nights '), 'Neon Sola V5 + RI Noir nights');
    assert.throws(() => lo.loadoutName('Sola', '  '), /short name/);
    assert.throws(() => lo.loadoutName('Sola', 'a/b'), /cannot hold/);
});

test('a loadout holds the working copy blocks and a marker that is not a prompt row', () => {
    const source = solaPreset();
    const marker = lo.makeMarker({ base: 'Sola', edition: edition.key, switches: { state: 'ours', style: 'theirs', bogus: 'ours' }, off: [edition.modules.state.ids[0]] });
    const data = lo.buildLoadout(source, marker);
    assert.deepEqual(solaPreset(), source, 'the source preset changed');
    assert.equal(data.prompts.length, source.prompts.length, 'the marker added a prompt row');
    assert.equal(enabledIds(data).includes(edition.modules.state.ids[0]), false);
    assert.deepEqual(data.extensions.roleplay_instructions.loadout.switches, { state: 'ours', style: 'theirs' });
    assert.deepEqual(data.extensions.regex_scripts, source.extensions.regex_scripts, 'preset-bound regex scripts were lost');
    assert.deepEqual(lo.readMarker(data).off, marker.off);
});

test('the marker survives save, export and import as JSON, and Update of an existing loadout', async () => {
    files.Sola = solaPreset();
    select('Sola');
    const context = wb.switchContext();
    assert.equal(context.edition.key, edition.key);
    const name = await lo.saveLoadout(manager, { preset: 'Sola', name: 'Noir nights', data: context.data, marker: wb.currentMarker(context) });
    assert.equal(name, 'Sola + RI Noir nights');
    assert.equal(selected, name, 'Save as loadout leaves the loadout selected');
    const exported = JSON.stringify(files[name], null, 4);
    const imported = JSON.parse(exported);
    assert.deepEqual(lo.readMarker(imported).switches, wb.resolvedSwitches(context));
    assert.deepEqual(lo.listLoadouts(manager).map(item => item.name), [name]);
    // Update writes fresh switches into the selected loadout.
    const loaded = wb.switchContext();
    wb.setSwitches(loaded, { style: 'ours' });
    await lo.updateLoadout(manager, name, wb.switchContext().data, wb.currentMarker(wb.switchContext()));
    assert.equal(lo.readMarker(files[name]).switches.style, 'ours');
    await assert.rejects(lo.saveLoadout(manager, { preset: 'Sola', name: 'Noir nights', data: context.data, marker: wb.currentMarker(context) }), /already exists/);
});

test('selecting a loadout restores its switches and applies no second working copy', () => {
    select('Sola');
    wb.setSwitches(wb.switchContext(), { state: 'theirs', dice: 'ours' });
    select('Sola + RI Noir nights');
    wb.setSwitches(wb.switchContext(), { emotions: 'theirs' });
    wb.onPresetSelected();
    const context = wb.switchContext();
    assert.ok(context.marker);
    assert.equal(context.key, 'loadout:Sola + RI Noir nights');
    assert.deepEqual(wb.resolvedSwitches(context), lo.readMarker(files['Sola + RI Noir nights']).switches);
    assert.deepEqual(wb.workingCopyOff(context), [], 'a loadout got a second working copy');
    const before = enabledIds(host.chatCompletionSettings);
    assert.equal(wb.applyWorkingCopy(), 0);
    assert.deepEqual(enabledIds(host.chatCompletionSettings), before, 'the loadout was not sent as saved');
    wb.restoreWorkingCopy();
    for (const id of lo.readMarker(files['Sola + RI Noir nights']).off) assert.equal(before.includes(id), false, 'an Ours block is on in the loadout');
});

test('a block turned back on that the marker says Ours supplies shows a Conflict with its feature', async () => {
    select('Sola + RI Noir nights');
    const context = wb.switchContext();
    const switches = wb.resolvedSwitches(context);
    const off = lo.readMarker(context.data).off;
    assert.deepEqual(lo.loadoutConflicts(context.marker, switches, context.blocks, wb.featureBlockIds(context)), []);
    const order = host.chatCompletionSettings.prompt_order[0].order;
    order.find(entry => entry.identifier === off[0]).enabled = true;
    const again = wb.switchContext();
    const conflicts = lo.loadoutConflicts(again.marker, switches, again.blocks, wb.featureBlockIds(again));
    assert.equal(conflicts.length >= 1, true);
    assert.ok(conflicts.some(item => switches[item.key] === 'ours' && item.blocks.some(block => block.id === off[0])));
    order.find(entry => entry.identifier === off[0]).enabled = false;
});

test('the comment-row fallback carries the marker in a disabled row whose text is a comment macro', () => {
    const marker = lo.makeMarker({ base: 'Sola', edition: edition.key, switches: { state: 'ours', dice: 'ours' }, off: ['x'] });
    const data = lo.buildLoadout(solaPreset(), marker, { carrier: 'row' });
    const row = data.prompts.find(block => block.identifier === lo.MARKER_ROW);
    assert.ok(row);
    assert.equal(data.prompt_order[0].order.find(entry => entry.identifier === lo.MARKER_ROW).enabled, false);
    assert.match(row.content, /^\{\{\/\/ .* \}\}$/s);
    assert.equal(row.content.slice(4, -2).includes('}}'), false, 'the macro closes early');
    assert.equal(data.extensions.roleplay_instructions, undefined);
    assert.deepEqual(lo.readMarker(JSON.parse(JSON.stringify(data))).switches, { state: 'ours', dice: 'ours' });
    // Switching carriers leaves exactly one marker.
    const back = lo.buildLoadout(data, marker);
    assert.equal(back.prompts.some(block => block.identifier === lo.MARKER_ROW), false);
    assert.ok(back.extensions.roleplay_instructions.loadout);
});

test('Rename keeps the base and the marker; Delete removes only loadouts', async () => {
    select('Sola');
    const next = await lo.renameLoadout(manager, 'Sola + RI Noir nights', 'Rainy days');
    assert.equal(next, 'Sola + RI Rainy days');
    assert.equal(files['Sola + RI Noir nights'], undefined);
    assert.ok(lo.readMarker(files[next]));
    assert.equal(selected, 'Sola', 'renaming a loadout that is not selected changed the selection');
    await assert.rejects(lo.deleteLoadout(manager, 'Sola'), /not a loadout/);
    await lo.deleteLoadout(manager, next);
    assert.deepEqual(lo.listLoadouts(manager), []);
});
