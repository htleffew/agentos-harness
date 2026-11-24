// B18: preset cleanup with a backup export. Run with: node --test tests/t_preset_cleanup.js
// The fake preset manager follows SillyTavern 1.19 (public/scripts/preset-manager.js and src/endpoints/presets.js): the
// server writes JSON.stringify(preset, null, 4) to one file per preset, the page keeps the parsed objects in a list
// keyed by name, deletePreset drops the name but leaves the array slot, and savePreset without skipUpdate selects.
// Every preset here is a fixture with invented text; nothing reads her real presets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

const pc = await import('../src/preset-cleanup.js');

const sha = text => createHash('sha256').update(text).digest('hex');
const GLM = ['ET-glm-5-3-flash-roleplay-prompt-sillytavern-preset', 'GLM - 5.3-flash- evening-truth-roleplay-prompt', 'GLM 5.3-flash-evening-truth-roleplay-prompt'];
const KIMI5 = ['ET-kimi-k2-5-roleplay-prompt-sillytavern-preset', 'kimi k2.5-thinking-evening-truth-roleplay-prompt', 'kimi k2.5-thinking-10⭐ - evening-truth-roleplay-prompt'];
const KIMI7 = ['ET-kimi-k2-7-sillytavern-preset', 'kimi-k2-7-evening-truth', 'kimi-k2-7-evening-truth-sillytavern-preset'];
const MIMO25 = ['ET-mimo-v2-5-pro-rp-prompt-sillytavern-preset', 'mimo-v2-5-pro-evening-truth-rp-prompt'];
const MIMO26 = ['ET-mimo-v2-6-pro-roleplay-prompt-sillytavern-preset', 'mimo-v2-6-pro-evening-truth-roleplay-prompt'];

function blocks(seed, { agent = false } = {}) {
    const prompts = [{ identifier: 'main', name: 'Main Prompt', role: 'system', content: `Fixture main text ${seed}.`, system_prompt: true },
        { identifier: `${seed}-a`, name: 'Block A', role: 'system', content: `Fixture   block A for ${seed}.`, injection_position: 0 },
        { identifier: `${seed}-b`, name: 'Block B', role: 'user', content: `Fixture block B for ${seed}.`, injection_position: 1, injection_depth: 4 },
        { identifier: 'chatHistory', name: 'Chat History', marker: true }];
    if (agent) prompts.push({ identifier: 'ag-1', name: 'Agent System Prompt', role: 'system', content: 'Fixture agent row.' });
    const order = prompts.map(block => ({ identifier: block.identifier, enabled: block.identifier !== `${seed}-b` }));
    return { prompts, prompt_order: [{ character_id: 100001, order }] };
}
const preset = (seed, context, extra = {}, options = {}) => ({ temperature: 0.8, top_p: 0.95, openai_max_tokens: 4096, openai_max_context: context,
    chat_completion_source: 'openai', openai_model: 'fixture-model', ...blocks(seed, options), ...extra });

/** A fixture library: every copy beside its base, the five ET groups, and presets that must stay as they are. */
function fixtureLibrary() {
    const lib = {};
    for (const [index, [copy, base]] of pc.COPIES.entries()) {
        const seed = `fx${index}`;
        lib[base] = preset(seed, 32768 + index);
        lib[copy] = preset(seed, 1000000 + index, { chat_completion_source: 'claude', openai_model: 'other-model' }, { agent: index % 2 === 0 });
    }
    const groups = [[GLM, 'glm', [1040218, 90000, 90000]], [KIMI5, 'kimi5', [1175693, 201943, 201943]], [KIMI7, 'kimi7', [1082104, 100002, 100002]],
        [MIMO25, 'mimo25', [1135496, 128000]], [MIMO26, 'mimo26', [1048576, 128000]]];
    for (const [names, seed, contexts] of groups) names.forEach((name, i) => { lib[name] = preset(seed, contexts[i], seed.startsWith('mimo') ? { inline_image_quality: i === 0 ? 'auto' : 'low' } : {}); });
    lib['minimax m3-evening-truth-roleplay-prompt'] = preset('minimax', 90000);
    lib['Kimi-K2-Thinking-evening-truth-v1.3'] = preset('kimithink', 256000);
    lib['Mimo Needs To Calm Down!'] = preset('calm', 0);
    lib['Plain preset A'] = preset('plain-a', 8192);
    lib['Plain preset B'] = preset('plain-b', 16384, { extensions: { regex_scripts: [{ scriptName: 'Fixture', findRegex: '/x/g' }] } });
    return lib;
}

/** A fake host: one JSON file per preset as the server writes it, and the page's parsed list. */
function makeHost(initial, { selected = '' } = {}) {
    const files = new Map(), calls = [];
    const list = { presets: [], preset_names: {} };
    const put = (name, data) => { files.set(name, JSON.stringify(data, null, 4)); };
    const state = { selected, failSaveOf: null };
    for (const [name, data] of Object.entries(initial)) { put(name, data); list.presets.push(JSON.parse(files.get(name))); list.preset_names[name] = list.presets.length - 1; }
    const manager = {
        getPresetList: () => list,
        getSelectedPresetName: () => state.selected,
        findPreset: name => list.preset_names[name],
        selectPreset: async value => { state.selected = Object.keys(list.preset_names).find(name => list.preset_names[name] === value) ?? state.selected; calls.push(['select', state.selected]); },
        async savePreset(name, data, { skipUpdate = false } = {}) {
            if (state.failSaveOf === name) throw new Error('Preset could not be saved');
            calls.push(['save', name]);
            put(name, data);
            if (skipUpdate) return;
            const parsed = JSON.parse(files.get(name));
            if (name in list.preset_names) list.presets[list.preset_names[name]] = parsed; else { list.presets.push(parsed); list.preset_names[name] = list.presets.length - 1; }
            state.selected = name;
        },
        async deletePreset(name) { calls.push(['delete', name]); delete list.preset_names[name]; return files.delete(name); },
    };
    const fileHashes = () => Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : 1).map(([name, text]) => [name, sha(text)]));
    return { manager, files, calls, list, state, fileHashes };
}

test('the table holds the 14 copies of P1, each with its base and edition', () => {
    assert.equal(pc.COPIES.length, 14);
    assert.equal(new Set(pc.COPIES.map(row => row[0])).size, 14);
    assert.equal(new Set(pc.COPIES.map(row => row[2])).size, 14);
    for (const [copy, base, edition] of pc.COPIES) { assert.ok(copy && base && edition.includes('/')); assert.notEqual(copy, base); }
});

test('the plan lists 14 copies beside their bases and 5 ET groups, and the button names the result', () => {
    const { manager } = makeHost(fixtureLibrary());
    const plan = pc.planCleanup(pc.entriesOf(manager));
    assert.equal(plan.label, 'Retire 14 copies, merge 5 ET groups');
    assert.equal(plan.copies.filter(item => item.state === 'ready').length, 14);
    for (const item of plan.copies) assert.ok(Number.isFinite(item.copyContext) && Number.isFinite(item.baseContext));
    assert.deepEqual(plan.groups.map(group => group.members.length).sort(), [2, 2, 3, 3, 3]);
    assert.equal(plan.groupRetired, 8);
    const glm = plan.groups.find(group => group.keeper === GLM[0]);
    assert.equal(glm.members[0].name, GLM[0], 'the author file name is the keeper');
    assert.deepEqual(glm.members.map(member => member.context).sort((a, b) => a - b), [90000, 90000, 1040218]);
});

test('connection fields, Agent rows, context size and image settings do not stop a match', () => {
    const a = preset('x', 100, { inline_image_quality: 'auto' }, { agent: true });
    const b = preset('x', 999999, { chat_completion_source: 'claude', openai_model: 'm', inline_image_quality: 'low', openrouter_allow_fallbacks: true });
    assert.equal(pc.sameBesidesContext(a, b), true);
});

test('a preset that differs in blocks, samplers or regex scripts is not a copy and is not merged', () => {
    const lib = fixtureLibrary();
    const [copyA, baseA] = pc.COPIES[0], [copyB, baseB] = pc.COPIES[1], [copyC, baseC] = pc.COPIES[2];
    lib[copyA].prompts[1].content = 'A different block text.';
    lib[copyB].temperature = 1.2;
    lib[copyC].extensions = { regex_scripts: [{ scriptName: 'Added', findRegex: '/y/g' }] };
    lib[MIMO25[1]].top_p = 0.5;
    const { manager } = makeHost(lib);
    const plan = pc.planCleanup(pc.entriesOf(manager));
    assert.deepEqual(plan.copies.slice(0, 3).map(item => item.state), ['differs', 'differs', 'differs']);
    assert.equal(plan.copyCount, 11);
    assert.equal(plan.groups.length, 4, 'the MiMo 2.5 pair no longer matches');
    assert.equal(plan.label, 'Retire 11 copies, merge 4 ET groups');
    assert.ok(![copyA, copyB, copyC, baseA, baseB, baseC].some(name => plan.groups.some(group => group.members.some(member => member.name === name))));
});

test('a copy whose base is missing, a copy already gone, a connection profile and a loadout keep their presets', () => {
    const lib = fixtureLibrary();
    delete lib[pc.COPIES[3][1]];
    delete lib[pc.COPIES[4][0]];
    const loadout = preset('fx5', 1);
    loadout.extensions = { roleplay_instructions: { loadout: { v: 1, base: pc.COPIES[5][0], edition: null, switches: {}, off: [], saved: 1 } } };
    lib[`${pc.COPIES[5][0]} + RI Night`] = loadout;
    const { manager } = makeHost(lib);
    const protectedNames = pc.profileProtections({ extensionSettings: { connectionManager: { profiles: [{ name: 'Daily', preset: pc.COPIES[6][0] }] } } });
    const plan = pc.planCleanup(pc.entriesOf(manager), { protectedNames });
    assert.deepEqual(plan.copies.slice(3, 8).map(item => item.state), ['no-base', 'gone', 'kept', 'kept', 'ready']);
    assert.match(plan.copies[5].note, /loadout/);
    assert.match(plan.copies[6].note, /connection profile Daily/);
    assert.equal(plan.copyCount, 14 - 4);
});

test('planning and backing up change nothing in the host', async () => {
    const host = makeHost(fixtureLibrary());
    const before = host.fileHashes();
    const plan = pc.planCleanup(pc.entriesOf(host.manager));
    await pc.buildBackup(pc.entriesOf(host.manager));
    assert.ok(plan.copyCount);
    assert.deepEqual(host.calls, []);
    assert.deepEqual(host.fileHashes(), before);
});

test('the backup holds every preset, parses back, and a damaged file is refused', async () => {
    const host = makeHost(fixtureLibrary());
    const entries = pc.entriesOf(host.manager);
    const backup = await pc.buildBackup(entries, new Date(2026, 10, 23, 9, 5, 7));
    assert.equal(backup.name, 'roleplay-instructions-presets-backup-20261123-090507.json');
    assert.equal(backup.count, entries.length);
    const parsed = await pc.parseBackup(backup.text);
    assert.equal(parsed.count, entries.length);
    assert.equal(parsed.libraryHash, backup.libraryHash);
    assert.deepEqual(parsed.entries.map(item => item.name), entries.map(item => item.name));
    await assert.rejects(pc.parseBackup('not json'), /not a preset backup/);
    await assert.rejects(pc.parseBackup(JSON.stringify({ schema: 'other', presets: [] })), /not a Roleplay Instructions/);
    const damaged = JSON.parse(backup.text);
    damaged.presets[0].data.temperature = 2;
    await assert.rejects(pc.parseBackup(JSON.stringify(damaged)), /damaged/);
    damaged.presets.pop();
    await assert.rejects(pc.parseBackup(JSON.stringify(damaged)), /damaged/);
});

test('cleanup refuses without a backup, after the library changed, and for a list she did not see', async () => {
    const host = makeHost(fixtureLibrary());
    const key = pc.planKey(pc.planCleanup(pc.entriesOf(host.manager)));
    await assert.rejects(pc.applyCleanup(host.manager, key, null), /Back up/);
    const backup = await pc.buildBackup(pc.entriesOf(host.manager));
    await assert.rejects(pc.applyCleanup(host.manager, 'something else', backup), /list changed/);
    host.list.presets[host.list.preset_names['Plain preset A']].temperature = 0.1;
    await assert.rejects(pc.applyCleanup(host.manager, key, backup), /changed after the backup/);
    assert.deepEqual(host.calls, []);
});

test('cleanup retires the copies and merges the ET groups; context sizes survive as model profiles', async () => {
    const host = makeHost(fixtureLibrary());
    const entries = pc.entriesOf(host.manager);
    const originals = new Map(entries.map(entry => [entry.name, structuredClone(entry.data)]));
    const backup = await pc.buildBackup(entries);
    const key = pc.planKey(pc.planCleanup(entries));
    const outcome = await pc.applyCleanup(host.manager, key, backup);
    assert.equal(outcome.retired.length, 14 + 8);
    assert.deepEqual(outcome.failed, []);
    const names = Object.keys(host.list.preset_names);
    for (const [copy] of pc.COPIES) assert.ok(!names.includes(copy), `${copy} should be retired`);
    for (const name of [...GLM.slice(1), ...KIMI5.slice(1), ...KIMI7.slice(1), MIMO25[1], MIMO26[1]]) assert.ok(!names.includes(name), `${name} should be retired`);
    for (const [index, [copy, base]] of pc.COPIES.entries()) {
        const data = host.list.presets[host.list.preset_names[base]];
        const profiles = pc.storedProfiles(data);
        assert.equal(profiles.length, 1, base);
        assert.equal(profiles[0].contextSize, originals.get(copy).openai_max_context);
        assert.equal(profiles[0].from, copy);
        assert.equal(data.openai_max_context, originals.get(base).openai_max_context, 'the base keeps its own context size');
        assert.deepEqual({ ...data, extensions: undefined }, { ...originals.get(base), extensions: undefined }, `${index}: only the extension data changes on the base`);
    }
    for (const group of [GLM, KIMI5, KIMI7, MIMO25, MIMO26]) {
        const keeper = host.list.presets[host.list.preset_names[group[0]]];
        const profiles = pc.storedProfiles(keeper);
        assert.equal(profiles.length, group.length, 'one profile per former member');
        assert.deepEqual(profiles.map(item => item.from).sort(), [...group].sort());
        assert.deepEqual(profiles.map(item => item.contextSize).sort(), group.map(name => originals.get(name).openai_max_context).sort());
        assert.equal(profiles.filter(item => item.current).length, 1);
        assert.equal(profiles.find(item => item.current).from, group[0]);
    }
    const mimo = pc.storedProfiles(host.list.presets[host.list.preset_names[MIMO25[0]]]).find(item => item.from === MIMO25[1]);
    assert.deepEqual(mimo.settings, { inline_image_quality: 'low' }, 'a differing image setting is kept in the profile');
    assert.deepEqual(pc.storedProfiles(host.list.presets[host.list.preset_names[GLM[0]]]).find(item => item.from === GLM[1]).models, ['glm']);
    assert.equal(pc.profileForModel(host.list.presets[host.list.preset_names[GLM[0]]], 'glm-5.3-flash').from, GLM[0]);
    assert.equal(pc.profileForModel(host.list.presets[host.list.preset_names[GLM[0]]], 'claude-opus'), null);
});

test('ET presets outside identical-prompt groups, and every other preset, are not written or deleted', async () => {
    const host = makeHost(fixtureLibrary());
    const before = host.fileHashes();
    const entries = pc.entriesOf(host.manager);
    await pc.applyCleanup(host.manager, pc.planKey(pc.planCleanup(entries)), await pc.buildBackup(entries));
    const after = host.fileHashes();
    const untouched = ['minimax m3-evening-truth-roleplay-prompt', 'Kimi-K2-Thinking-evening-truth-v1.3', 'Mimo Needs To Calm Down!', 'Plain preset A', 'Plain preset B'];
    for (const name of untouched) assert.equal(after[name], before[name], `${name} changed`);
    assert.ok(!host.calls.some(([kind, name]) => untouched.includes(name)), 'no write or delete reached an untouched preset');
    assert.equal(host.calls.filter(([kind]) => kind === 'save').length, 14 + 5, 'one write per surviving base and keeper');
    assert.equal(host.calls.filter(([kind]) => kind === 'delete').length, 14 + 8);
    // Every survivor is written before any retired preset is deleted.
    const firstDelete = host.calls.findIndex(([kind]) => kind === 'delete');
    assert.ok(host.calls.slice(firstDelete).every(([kind]) => kind !== 'save'));
});

test('restoring the backup returns every preset file to its exact earlier bytes', async () => {
    const host = makeHost(fixtureLibrary(), { selected: 'Plain preset A' });
    const before = host.fileHashes();
    const entries = pc.entriesOf(host.manager);
    const backup = await pc.buildBackup(entries);
    const parsed = await pc.parseBackup(backup.text);
    await pc.applyCleanup(host.manager, pc.planKey(pc.planCleanup(entries)), backup);
    assert.notDeepEqual(host.fileHashes(), before, 'cleanup changed the library');
    assert.equal(host.files.size, Object.keys(before).length - 22);
    const done = await pc.restoreBackup(host.manager, parsed);
    assert.equal(done.recreated, 22);
    assert.equal(done.rewritten, 19);
    assert.equal(done.exact, true);
    assert.deepEqual(host.fileHashes(), before, 'file hashes differ after the restore');
    assert.equal(await pc.libraryHash(pc.entriesOf(host.manager)), backup.libraryHash);
    // A second restore finds nothing to do.
    const again = await pc.restoreBackup(host.manager, parsed);
    assert.deepEqual([again.recreated, again.rewritten], [0, 0]);
});

test('a restore leaves presets made after the backup and says how many', async () => {
    const host = makeHost(fixtureLibrary());
    const entries = pc.entriesOf(host.manager);
    const backup = await pc.buildBackup(entries);
    await pc.applyCleanup(host.manager, pc.planKey(pc.planCleanup(entries)), backup);
    await host.manager.savePreset('Made later', preset('later', 1), { skipUpdate: true });
    const done = await pc.restoreBackup(host.manager, await pc.parseBackup(backup.text));
    assert.deepEqual(done.added, []);
    host.list.presets.push(JSON.parse(host.files.get('Made later')));
    host.list.preset_names['Made later'] = host.list.presets.length - 1;
    const second = await pc.restoreBackup(host.manager, await pc.parseBackup(backup.text));
    assert.deepEqual(second.added, ['Made later']);
    assert.equal(second.exact, true);
    assert.ok(host.files.has('Made later'));
});

test('a retired preset that is selected hands the selection to the preset that stays first', async () => {
    const [copy, base] = pc.COPIES[7];
    const host = makeHost(fixtureLibrary(), { selected: copy });
    const entries = pc.entriesOf(host.manager);
    await pc.applyCleanup(host.manager, pc.planKey(pc.planCleanup(entries)), await pc.buildBackup(entries));
    assert.equal(host.state.selected, base);
    const selectAt = host.calls.findIndex(([kind, name]) => kind === 'select' && name === base);
    const deleteAt = host.calls.findIndex(([kind, name]) => kind === 'delete' && name === copy);
    assert.ok(selectAt >= 0 && selectAt < deleteAt);
});

test('when a write fails nothing is deleted', async () => {
    const host = makeHost(fixtureLibrary());
    const entries = pc.entriesOf(host.manager);
    const key = pc.planKey(pc.planCleanup(entries));
    const backup = await pc.buildBackup(entries);
    host.state.failSaveOf = pc.COPIES[10][1];
    await assert.rejects(pc.applyCleanup(host.manager, key, backup), /could not be saved/);
    assert.ok(!host.calls.some(([kind]) => kind === 'delete'));
    // The backup still restores the library, including the bases written before the failure.
    host.state.failSaveOf = null;
    await pc.restoreBackup(host.manager, await pc.parseBackup(backup.text));
    assert.equal(await pc.libraryHash(pc.entriesOf(host.manager)), backup.libraryHash);
});

test('a second cleanup finds nothing left to do', async () => {
    const host = makeHost(fixtureLibrary());
    const entries = pc.entriesOf(host.manager);
    await pc.applyCleanup(host.manager, pc.planKey(pc.planCleanup(entries)), await pc.buildBackup(entries));
    const plan = pc.planCleanup(pc.entriesOf(host.manager));
    assert.equal(plan.empty, true);
    assert.equal(plan.copyCount, 0);
    assert.equal(plan.groups.length, 0);
});

test('copies the host names with emoji are found by their plain text', () => {
    const lib = fixtureLibrary();
    const mark = String.fromCodePoint(0x1F4A5), sun = String.fromCodePoint(0x2600, 0xFE0F);
    const [copy, base] = pc.COPIES[12], [copy2] = pc.COPIES[13];
    lib[`${mark} ${copy}${mark}`] = lib[copy]; delete lib[copy];
    lib[base.replace('universal - ', `universal -${mark} `)] = lib[base]; delete lib[base];
    lib[`${sun} ${copy2} ${sun}`] = lib[copy2]; delete lib[copy2];
    const { manager } = makeHost(lib);
    const plan = pc.planCleanup(pc.entriesOf(manager));
    assert.equal(plan.copyCount, 14);
    assert.ok(plan.copies[12].copy.includes(mark) && plan.copies[13].copy.includes(sun), 'the plan shows the names the host uses');
});
