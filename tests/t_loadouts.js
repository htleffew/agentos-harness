// B12 and B35: saved loadouts, their hidden marker, and loadouts made from stacks (marker version 2).
// Run with: node --test tests/t_loadouts.js
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
// Browser storage for the working copy's crash journal.
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
const wb = await import('../src/preset-workbench.js');
const bank = await import('../src/preset-bank.js');
const riBank = await import('../src/preset-bank-ri.js');
const checks = await import('../src/preset-checks.js');
const { effectiveModules } = await import('../src/v10.js');
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
    const marker = lo.makeMarker({ base: 'Sola', edition: edition.key, switches: { style: 'theirs', state: 'ours' }, off: [] });
    const name = await lo.saveLoadout(manager, { preset: 'Sola', name: 'Noir nights', data: context.data, marker });
    assert.equal(name, 'Sola + RI Noir nights');
    assert.equal(selected, name, 'Save as loadout leaves the loadout selected');
    const exported = JSON.stringify(files[name], null, 4);
    const imported = JSON.parse(exported);
    assert.deepEqual(lo.readMarker(imported).switches, marker.switches);
    assert.deepEqual(lo.listLoadouts(manager).map(item => item.name), [name]);
    // Update writes fresh switches into the selected loadout.
    const claims = wb.featureBlockIds(context);
    const styleOnly = claims.style.filter(id => !Object.entries(claims).some(([key, list]) => key !== 'style' && list.includes(id)));
    await lo.updateLoadout(manager, name, wb.switchContext().data, lo.makeMarker({ base: 'Sola', edition: edition.key, switches: { style: 'ours' }, off: styleOnly }));
    assert.equal(lo.readMarker(files[name]).switches.style, 'ours');
    await assert.rejects(lo.saveLoadout(manager, { preset: 'Sola', name: 'Noir nights', data: context.data, marker }), /already exists/);
});

test('selecting a loadout applies no second working copy', () => {
    select('Sola');
    select('Sola + RI Noir nights');
    wb.onPresetSelected();
    const context = wb.switchContext();
    assert.ok(context.marker);
    assert.equal(context.key, 'loadout:Sola + RI Noir nights');
    const before = enabledIds(host.chatCompletionSettings);
    assert.equal(wb.applyWorkingCopy(), 0);
    assert.deepEqual(enabledIds(host.chatCompletionSettings), before, 'the loadout was not sent as saved');
    wb.restoreWorkingCopy();
    for (const id of lo.readMarker(files['Sola + RI Noir nights']).off) assert.equal(before.includes(id), false, 'an Ours block is on in the loadout');
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

// ---------------------------------------------------------------------------------------------------------------------
// B35: loadouts made from stacks (marker version 2).

const settingsOf = () => host.extensionSettings.roleplay_instructions;
const block = (identifier, content, extra = {}) => ({ identifier, name: identifier, content, role: 'system', ...extra });
function plain(blocks, off = []) {
    return { temperature: 0.8, openai_max_tokens: 400, prompts: blocks, prompt_order: [{ character_id: 100001, order: blocks.map(item => ({ identifier: item.identifier, enabled: !off.includes(item.identifier) })) }], extensions: {} };
}
const baseBlocks = () => [block('main', 'Main text.', { system_prompt: true }), block('rule', 'Keep replies short.'), block('guard', 'Never speak for the player.'),
    block('chatHistory', undefined, { system_prompt: true, marker: true }), block('offblock', 'Shipped off block.')];
const MINE = 'Her own take on other one. {{getvar::mood}} and a stray }} here.';
const RI_MINE = 'Her own reply planning rules.';

function reset() {
    for (const name of Object.keys(files)) delete files[name];
    const st = settingsOf();
    for (const key of ['bankStacks', 'bankVersions', 'bankTexts', 'bankSources', 'bankTags']) st[key] = {};
    delete st.presetSwitches;
    chats.A = { roleplay_instructions: { v10: { enabled: true } } };
    bank.resetBank();
    saves.length = 0;
    selected = '';
    host.chatCompletionSettings = null;
}
/** The request SillyTavern assembles from the live preset while the working copy is applied, and the extension's own sections. */
function request() {
    const count = wb.applyWorkingCopy();
    const live = host.chatCompletionSettings;
    const prompts = new Map();
    for (const prompt of live.prompts) if (!prompts.has(prompt.identifier)) prompts.set(prompt.identifier, prompt);
    const rows = live.prompt_order[0].order.filter(entry => entry.enabled && prompts.has(entry.identifier))
        .map(entry => ({ id: entry.identifier, text: prompts.get(entry.identifier).marker ? null : prompts.get(entry.identifier).content }));
    const modules = effectiveModules();
    wb.restoreWorkingCopy();
    return { rows, modules, count };
}
/** A base, cards from two other presets (one switched off), her version of one, a block taken out, one put in, and the RI group changed. */
async function composeStack() {
    files.Base = plain(baseBlocks(), ['offblock']);
    files.Other = plain([block('o1', 'Other one text.'), block('o2', 'Other two text.'), block('o3', 'Other three never added.')]);
    files.Third = plain([block('t1', 'Third one text.')]);
    select('Base');
    const b = bank.refreshBank('test');
    const key = bank.stackFor(b, 'Base').key;
    const o = id => `p:${b.sids.Other}::${id}`;
    bank.includeCards(b, key, [o('o1'), o('o2')], { base: 'Base', after: 'base::main' });
    const mine = bank.createVersion(b, o('o1'), { text: MINE, base: 'Base' });
    bank.includeCards(b, key, [bank.versionKey(mine.id)], { base: 'Base', after: o('o2') });
    bank.includeCards(b, key, [`p:${b.sids.Third}::t1`], { base: 'Base' });
    bank.excludeCards(b, key, [o('o2')], { base: 'Base' });
    bank.excludeCards(b, key, ['base::rule'], { base: 'Base' });
    bank.includeCards(b, key, ['base::offblock'], { base: 'Base' });
    const riKeys = bank.storedStack(key).ri.map(item => item.key);
    bank.excludeCards(b, key, [riKeys[1]], { base: 'Base' });
    const riMine = bank.createVersion(b, riKeys[0], { text: RI_MINE, base: 'Base' });
    bank.includeCards(b, key, [bank.versionKey(riMine.id)], { base: 'Base' });
    return { b, key, mine, riMine, riKeys, o, sids: { ...b.sids } };
}
/** Compose a stack, record its request, and save it as the loadout "Base + RI Mix". */
async function makeLoadout(options = {}) {
    reset();
    const made = await composeStack();
    wb.onPresetSelected();
    const stackRequest = request();
    const group = riBank.riGroup(made.b, 'Base');
    const original = bank.storedStack(made.key);
    const name = await lo.saveLoadoutFromContext(manager, 'Mix', wb.switchContext(), options);
    return { ...made, name, stackRequest, group, original, exported: JSON.stringify(files[name], null, 4) };
}
const cardsOf = stack => stack.cards.concat(stack.ri).map(item => ({ key: item.key, on: item.on, hash: item.hash }));
const withoutSend = list => list.map(({ send, ...item }) => item);
const loadoutStack = name => bank.storedStack(`loadout:${name}`);
const enabledRows = data => data.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);

test('a loadout built from a base, other presets and customized versions sends the same request as its stack', async () => {
    const made = await makeLoadout();
    const sent = made.stackRequest.rows.map(row => row.text);
    for (const text of ['Main text.', 'Other one text.', MINE, 'Third one text.', 'Shipped off block.', 'Never speak for the player.', RI_MINE]) assert.ok(sent.includes(text), text);
    for (const text of ['Keep replies short.', 'Other two text.', 'Other three never added.']) assert.equal(sent.includes(text), false, `${text} was sent`);
    assert.equal(made.name, 'Base + RI Mix');
    assert.equal(selected, made.name);
    const saved = files[made.name];
    assert.equal(saved.temperature, 0.8, 'the base settings were not kept');
    assert.equal(saved.openai_max_tokens, 400);
    assert.deepEqual(files.Base, plain(baseBlocks(), ['offblock']), 'the base preset changed');
    const ids = saved.prompts.map(item => item.identifier);
    assert.ok(ids.includes(`ri-bank-${made.sids.Other}-o1`) && ids.includes(`ri-bank-${made.sids.Other}-o2`) && ids.includes(`ri-bank-${made.sids.Third}-t1`), ids.join());
    assert.ok(ids.includes(`ri-bank-mine-${made.mine.id}`) && ids.includes(`ri-bank-mine-${made.riMine.id}`));
    assert.equal(saved.prompts.some(item => item.ri_bank_insert), false, 'an inserted block kept its working-copy flag');
    const entry = id => saved.prompt_order[0].order.find(row => row.identifier === id);
    assert.equal(entry(`ri-bank-${made.sids.Other}-o2`).enabled, false, 'a card taken out was not kept switched off');
    assert.equal(saved.prompts.find(item => item.identifier === `ri-bank-${made.sids.Other}-o2`).content, 'Other two text.');
    assert.equal(entry('rule').enabled, false);
    assert.equal(entry('offblock').enabled, true);
    wb.onPresetSelected();
    const again = request();
    assert.equal(again.count, 0, 'a loadout got a working copy');
    assert.deepEqual(again.rows, made.stackRequest.rows, 'the request differs from the stack it came from');
    assert.deepEqual(again.modules, made.stackRequest.modules, 'the extension sections differ');
    assert.deepEqual(riBank.riGroup(bank.refreshBank(), made.name), made.group, 'the RI group differs');
    assert.equal(made.stackRequest.modules[made.riKeys[1].slice(4)], false, 'the RI card she took out still runs');
    assert.deepEqual(withoutSend(lo.readMarker(files[made.name]).stack.cards), made.original.cards, 'the marker stack is not the stack');
    assert.deepEqual(withoutSend(lo.readMarker(files[made.name]).stack.ri), made.original.ri);
});

test('an exported loadout imported on a host with empty extension settings recreates its versions and restores the stack', async () => {
    const made = await makeLoadout();
    const versions = structuredClone(settingsOf().bankVersions);
    assert.ok(versions[made.mine.id] && versions[made.riMine.id]);
    reset();
    assert.deepEqual(settingsOf().bankVersions, {});
    await manager.savePreset('Imported', JSON.parse(made.exported));
    bank.refreshBank('import');
    wb.onPresetSelected();
    const mine = settingsOf().bankVersions[made.mine.id];
    assert.ok(mine, 'her version was not recreated');
    assert.equal(mine.text, MINE);
    assert.equal(mine.sourceName, 'Other');
    assert.equal(mine.sourceId, 'o1');
    assert.equal(mine.source, versions[made.mine.id].source);
    assert.deepEqual(settingsOf().bankVersions, versions, 'a version record differs from the one that was saved');
    const stack = loadoutStack('Imported');
    assert.deepEqual(stack.cards, withoutSend(made.original.cards));
    assert.deepEqual(stack.ri, made.original.ri);
    // The other presets are not on this host: their cards still send the text the loadout holds.
    const plan = bank.stackPlan(bank.currentBank(), stack, 'Imported');
    const o1 = plan.find(item => item.key === made.o('o1'));
    assert.equal(o1.status, 'removed');
    assert.equal(o1.text, 'Other one text.');
    assert.equal(plan.find(item => item.key === made.o('o2')).text, 'Other two text.');
    assert.equal(plan.find(item => item.key === bank.versionKey(made.mine.id)).text, MINE);
    const sent = request();
    assert.deepEqual(sent.rows, made.stackRequest.rows);
    assert.deepEqual(sent.modules, made.stackRequest.modules);
});

test('importing a loadout whose version ids exist with different text keeps both and names the imported one', async () => {
    const made = await makeLoadout();
    settingsOf().bankVersions[made.mine.id].text = 'Her newer edit on this device.';
    const before = JSON.stringify(settingsOf().bankVersions[made.riMine.id]);
    await manager.savePreset('Imported twice', JSON.parse(made.exported));
    bank.refreshBank('import');
    wb.onPresetSelected();
    const records = Object.values(settingsOf().bankVersions);
    assert.equal(settingsOf().bankVersions[made.mine.id].text, 'Her newer edit on this device.', 'her version was replaced');
    const imported = records.filter(item => item.importedFrom === made.mine.id);
    assert.equal(imported.length, 1);
    assert.equal(imported[0].text, MINE);
    assert.match(imported[0].label, /\(imported\)$/);
    assert.equal(imported[0].sourceName, 'Other');
    assert.notEqual(imported[0].id, made.mine.id);
    assert.equal(JSON.stringify(settingsOf().bankVersions[made.riMine.id]), before, 'a version with the same text was changed');
    const stack = loadoutStack('Imported twice');
    assert.ok(stack.cards.some(item => item.key === bank.versionKey(imported[0].id)), 'the loadout card does not point at the imported version');
    assert.equal(stack.cards.some(item => item.key === bank.versionKey(made.mine.id)), false);
    const plan = bank.stackPlan(bank.refreshBank('import'), stack, 'Imported twice');
    assert.equal(plan.find(item => item.key === bank.versionKey(imported[0].id)).text, MINE);
    // Selecting it again, or importing the same file again, adds nothing more.
    wb.onPresetSelected();
    await manager.savePreset('Imported thrice', JSON.parse(made.exported));
    wb.onPresetSelected();
    assert.equal(Object.values(settingsOf().bankVersions).filter(item => item.importedFrom === made.mine.id).length, 1);
});

test('the marker survives SillyTavern save, export and import as JSON, in the extension data and in the comment row', async () => {
    const made = await makeLoadout();
    const marker = lo.readMarker(files[made.name]);
    assert.equal(marker.v, 2);
    assert.deepEqual(lo.readMarker(JSON.parse(made.exported)), marker);
    assert.equal(files[made.name].prompts.some(item => item.identifier === lo.MARKER_ROW), false);
    // The fallback carrier holds the same marker, including text with double braces inside her versions.
    reset();
    const row = await (async () => {
        const again = await composeStack();
        const name = await lo.saveLoadoutFromContext(manager, 'Row', wb.switchContext(), { carrier: 'row' });
        return { again, name };
    })();
    const data = files[row.name];
    const marked = data.prompts.find(item => item.identifier === lo.MARKER_ROW);
    assert.ok(marked);
    assert.equal(data.prompt_order[0].order.find(entry => entry.identifier === lo.MARKER_ROW).enabled, false);
    assert.match(marked.content, /^\{\{\/\/ .* \}\}$/s);
    assert.equal(marked.content.slice(4, -2).includes('}}'), false, 'the comment macro closes early');
    assert.equal(data.extensions.roleplay_instructions, undefined);
    const read = lo.readMarker(JSON.parse(JSON.stringify(data)));
    assert.equal(read.stack.cards.length, lo.readMarker(files[row.name]).stack.cards.length);
    assert.equal(read.versions[row.again.mine.id].text, MINE, 'text with double braces changed through the comment row');
    const sent = request();
    assert.equal(sent.rows.some(item => item.id === lo.MARKER_ROW), false, 'the marker row is sent');
});

test('a version 1 loadout opens with the blocks it saved and its switches show as a stack she can edit', async () => {
    reset();
    files.Base = plain(baseBlocks(), ['offblock']);
    select('Base');
    const b = bank.refreshBank('test');
    const saved = lo.buildLoadout(files.Base, lo.makeMarker({ base: 'Base', switches: { dice: 'theirs', style: 'ours' }, off: ['rule'] }));
    assert.equal(lo.readMarker(saved).v, 1);
    files['Base + RI Old'] = saved;
    select('Base + RI Old');
    wb.onPresetSelected();
    const name = 'Base + RI Old';
    const asSaved = enabledRows(files[name]);
    assert.deepEqual(asSaved, ['main', 'guard', 'chatHistory']);
    const sent = request();
    assert.equal(sent.count, 0);
    assert.deepEqual(sent.rows.map(row => row.id), asSaved, 'the loadout did not send the blocks it saved');
    const stack = bank.stackFor(bank.refreshBank('test'), name, wb.switchContext().data);
    assert.equal(stack.key, `loadout:${name}`);
    assert.deepEqual(stack.cards.map(item => [item.key, item.on]), [['base::main', true], ['base::rule', false], ['base::guard', true], ['base::chatHistory', true], ['base::offblock', false]]);
    assert.equal(stack.ri.find(item => item.key === 'ri::dice').on, false, 'a Theirs feature kept its card on');
    assert.equal(stack.ri.find(item => item.key === 'ri::style').on, true);
    assert.equal(wb.switchContext().marker.switches.dice, 'theirs');
    assert.equal(effectiveModules().dice, false);
    // She can edit it: putting the dice card back on gives the feature back.
    bank.includeCards(b, stack.key, ['ri::dice'], { base: name });
    wb.syncOwners();
    assert.equal(effectiveModules().dice, true, 'her tap on the dice card did not reach the request');
    bank.excludeCards(b, stack.key, ['base::main'], { base: name });
    assert.equal(bank.storedStack(stack.key).cards.find(item => item.key === 'base::main').on, false);
    // Updating a version 1 loadout writes a version 2 marker from that stack, and the base blocks keep her taps.
    await lo.updateLoadoutFromContext(manager, name, wb.switchContext());
    const upgraded = lo.readMarker(files[name]);
    assert.equal(upgraded.v, 2);
    assert.equal(upgraded.base, 'Base');
    assert.equal(files[name].prompt_order[0].order.find(entry => entry.identifier === 'main').enabled, false);
});

test('selecting, renaming and updating a loadout restore the saved stack exactly, and no block moves without her tap', async () => {
    const made = await makeLoadout();
    const key = `loadout:${made.name}`;
    wb.onPresetSelected();
    const saved = bank.storedStack(key);
    assert.deepEqual(saved.cards.map(item => item.key), made.original.cards.map(item => item.key), 'selecting changed the order');
    assert.deepEqual(cardsOf(saved), cardsOf(made.original));
    // She edits the loadout's stack, then selects it again: the saved stack is back.
    const b = bank.refreshBank('edit');
    bank.excludeCards(b, key, ['base::main'], { base: made.name });
    bank.moveCards(b, key, ['base::guard'], 0, { base: made.name });
    assert.notDeepEqual(cardsOf(bank.storedStack(key)), cardsOf(saved));
    wb.onPresetSelected();
    assert.deepEqual(bank.storedStack(key), saved, 'selecting did not restore the saved stack');
    // Rename keeps the base and the stack, under the new name.
    const next = await lo.renameLoadout(manager, made.name, 'Renamed');
    assert.equal(next, 'Base + RI Renamed');
    assert.equal(bank.storedStack(key), null, 'the old stack key was left behind');
    assert.deepEqual(cardsOf(bank.storedStack(`loadout:${next}`)), cardsOf(made.original));
    assert.deepEqual(lo.readMarker(files[next]).stack, lo.readMarker(JSON.parse(made.exported)).stack);
    // Update with no change to the stack writes the same stack and the same blocks.
    select(next);
    wb.onPresetSelected();
    const blocksBefore = JSON.stringify(files[next].prompts), orderBefore = JSON.stringify(files[next].prompt_order);
    await lo.updateLoadoutFromContext(manager, next, wb.switchContext());
    assert.deepEqual(lo.readMarker(files[next]).stack, lo.readMarker(JSON.parse(made.exported)).stack);
    assert.equal(JSON.stringify(files[next].prompts), blocksBefore);
    assert.equal(JSON.stringify(files[next].prompt_order), orderBefore);
    assert.deepEqual(cardsOf(bank.storedStack(`loadout:${next}`)), cardsOf(made.original));
    // Her tap, then Update: the card goes off in the loadout, and only that card.
    bank.excludeCards(bank.refreshBank('edit'), `loadout:${next}`, [made.o('o1')], { base: next });
    await lo.updateLoadoutFromContext(manager, next, wb.switchContext());
    const after = files[next].prompt_order[0].order;
    const sid = made.sids.Other;
    assert.equal(after.find(entry => entry.identifier === `ri-bank-${sid}-o1`).enabled, false);
    assert.deepEqual(after.map(entry => entry.identifier), JSON.parse(orderBefore)[0].order.map(entry => entry.identifier), 'Update reordered the blocks');
    assert.deepEqual(files.Base, plain(baseBlocks(), ['offblock']), 'Update changed the base preset');
    // Delete removes the preset and its stack.
    select('Base');
    await lo.deleteLoadout(manager, next);
    assert.equal(files[next], undefined);
    assert.equal(bank.storedStack(`loadout:${next}`), null);
});

test('a block turned on in the prompt manager that the loadout leaves out is a note in the check list', async () => {
    const made = await makeLoadout();
    wb.onPresetSelected();
    const marker = lo.readMarker(files[made.name]);
    const live = host.chatCompletionSettings;
    assert.deepEqual(lo.loadoutNotes(marker, live), [], 'a loadout as saved has notes');
    const off = marker.stack.cards.find(item => item.key === made.o('o2')).send;
    live.prompt_order[0].order.find(entry => entry.identifier === off).enabled = true;
    live.prompts.push(block('added', 'Added later in the prompt manager.'));
    live.prompt_order[0].order.push({ identifier: 'added', enabled: true });
    live.prompt_order[0].order.find(entry => entry.identifier === 'rule').enabled = true;
    const notes = lo.loadoutNotes(marker, live);
    assert.deepEqual(notes.map(item => item.id).sort(), [`loadout-left-out:added`, `loadout-left-out:${off}`, 'loadout-left-out:rule'].sort());
    for (const item of notes) { assert.equal(item.kind, 'loadout-left-out'); assert.equal(item.cards[0].on, true); assert.match(item.text, /left it out/); }
    assert.equal(notes.find(item => item.id === 'loadout-left-out:rule').cards[0].name, 'rule');
    assert.equal(notes.find(item => item.id === 'loadout-left-out:added').left, 'missing');
    const plan = bank.stackPlan(bank.refreshBank('notes'), bank.stackFor(bank.currentBank(), made.name, live), made.name);
    const list = checks.checkList(plan, { extra: notes });
    assert.equal(list.notes.filter(item => item.kind === 'loadout-left-out').length, 3);
    assert.equal(list.counts['loadout-left-out'], 3);
    assert.equal(checks.checkList(plan).notes.some(item => item.kind === 'loadout-left-out'), false);
    // The loadout sends the preset as saved, so the block really goes out: the note is about a real send.
    const sent = request();
    assert.ok(sent.rows.some(row => row.text === 'Other two text.') && sent.rows.some(row => row.text === 'Added later in the prompt manager.'));
    assert.deepEqual(plan.map(item => item.key), made.original.cards.concat(made.original.ri).map(item => item.key).filter(key => plan.some(item => item.key === key)), 'the check changed the stack');
});

test('building a loadout never changes the source preset, the stack or the settings versions', async () => {
    reset();
    const made = await composeStack();
    wb.onPresetSelected();
    const context = wb.switchContext();
    const before = JSON.stringify([files.Base, context.data, bank.storedStack(made.key), settingsOf().bankVersions]);
    await lo.saveLoadoutFromContext(manager, 'Quiet', context);
    assert.equal(JSON.stringify([files.Base, context.data, bank.storedStack(made.key), settingsOf().bankVersions]), before);
    await assert.rejects(lo.saveLoadoutFromContext(manager, 'Quiet', context), /already exists/);
});

// ---------------------------------------------------------------------------------------------------------------------
// B57: a loadout keeps each card's placement and first reply, and the diagnostics log lists a gated card as left out.

const diag = await import('../src/diagnostics-log.js');
/** The request at reply number reply: each sent block with where it goes (position, depth, role), read while the working copy is applied. */
function placedRequest(reply) {
    host.chat = Array.from({ length: reply }, () => ({ is_user: false, mes: 'x' }));
    wb.applyWorkingCopy();
    const live = host.chatCompletionSettings;
    const prompts = new Map(live.prompts.map(prompt => [prompt.identifier, prompt]));
    const rows = live.prompt_order[0].order.filter(entry => entry.enabled && prompts.has(entry.identifier)).map(entry => {
        const prompt = prompts.get(entry.identifier);
        return { text: prompt.marker ? null : prompt.content, role: prompt.role || 'system', position: prompt.injection_position === 1 ? 1 : 0,
            depth: prompt.injection_position === 1 ? prompt.injection_depth : null };
    });
    wb.restoreWorkingCopy();
    host.chat = [];
    return rows;
}

test('a loadout keeps each card position, depth, role and first reply, and sends the stack request at every reply', async () => {
    reset();
    const made = await composeStack();
    const guard = 'base::guard', other = made.o('o1'), third = `p:${made.sids.Third}::t1`;
    bank.setCardSending(made.b, made.key, guard, { role: 'assistant', position: 1, depth: 3, notBefore: 3 }, { base: 'Base' });
    bank.setCardSending(made.b, made.key, other, { role: 'user', position: 1, depth: 2 }, { base: 'Base' });
    bank.setCardSending(made.b, made.key, third, { notBefore: 5 }, { base: 'Base' });
    wb.onPresetSelected();
    const stackRows = [1, 2, 3, 4, 5, 6].map(placedRequest);
    assert.equal(stackRows[0].some(row => row.text === 'Never speak for the player.'), false, 'the stack sent a gated card early');
    assert.equal(stackRows[2].filter(row => row.text === 'Never speak for the player.')[0].depth, 3);
    assert.ok(stackRows[4].some(row => row.text === 'Third one text.') && !stackRows[3].some(row => row.text === 'Third one text.'));
    const name = await lo.saveLoadoutFromContext(manager, 'Placed', wb.switchContext());
    const saved = files[name];
    const byText = text => saved.prompts.find(item => item.content === text);
    const guarded = byText('Never speak for the player.');
    assert.deepEqual([guarded.injection_position, guarded.injection_depth, guarded.role, guarded.ri_not_before], [1, 3, 'assistant', 3]);
    const moved = byText('Other one text.');
    assert.deepEqual([moved.injection_position, moved.injection_depth, moved.role], [1, 2, 'user']);
    assert.equal(byText('Third one text.').ri_not_before, 5);
    assert.equal(byText('Main text.').ri_not_before, undefined, 'an ungated card got a gate');
    wb.onPresetSelected();
    assert.ok(wb.switchContext().marker);
    [1, 2, 3, 4, 5, 6].forEach((reply, i) => assert.deepEqual(placedRequest(reply), stackRows[i], `reply ${reply} differs from the stack`));
    assert.deepEqual(files.Base, plain(baseBlocks(), ['offblock']), 'the base preset changed');
});

test('a stack that loses its gate saves a loadout without one', async () => {
    reset();
    const made = await composeStack();
    bank.setCardSending(made.b, made.key, 'base::guard', { notBefore: 4 }, { base: 'Base' });
    bank.setCardSending(made.b, made.key, 'base::guard', { notBefore: 0 }, { base: 'Base' });
    wb.onPresetSelected();
    const name = await lo.saveLoadoutFromContext(manager, 'Plain', wb.switchContext());
    assert.equal(files[name].prompts.find(item => item.identifier === 'guard').ri_not_before, undefined);
});

test('a loadout saved before B57 has no gate and sends as saved', async () => {
    const made = await makeLoadout();
    assert.equal(files[made.name].prompts.some(item => item.ri_not_before !== undefined), false);
    wb.onPresetSelected();
    assert.equal(wb.applyWorkingCopy(), 0);
});

test('the diagnostics log lists a card held back by its gate as left out, with the reply it opens at', () => {
    const work = { plan: [
        { key: 'a', id: 'a', source: 'base', on: true, name: 'Late rule', notBefore: 4, group: 'main' },
        { key: 'b', id: 'b', source: 'base', on: true, name: 'Always', notBefore: 0, group: 'main' },
        { key: 'c', id: 'c', source: 'base', on: false, name: 'Off', notBefore: 4, group: 'main' }], source: { cards: [] } };
    const rows = reply => diag.stackLeftOut(work, {}, reply).map(row => `${row.name}:${row.reason}:${row.why}`);
    assert.deepEqual(rows(2), ['Late rule:gate:held back until its first reply: opens at reply 4', 'Off:off:switched off in the stack']);
    assert.deepEqual(rows(4), ['Off:off:switched off in the stack']);
    assert.deepEqual(rows(Infinity), ['Off:off:switched off in the stack']);
    assert.deepEqual(diag.stackLeftOut(work).map(row => row.name), ['Off']);
});
