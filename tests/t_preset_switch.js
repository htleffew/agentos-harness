// B12 and B30: recognition, and the block-bank stack applied as the working copy. B36b removed the per-feature switch tests.
// Run with: node --test tests/t_preset_switch.js
// A fake SillyTavern context stands in for the host; the request a provider receives is modelled as the enabled
// blocks of the global prompt order, each with the text of the first live prompt holding its identifier, at the moment
// SillyTavern assembles the prompt (prepareOpenAIMessages reads them between GENERATION_STARTED and
// GENERATE_AFTER_DATA in SillyTavern 1.19), plus effectiveModules() for the extension's own cards.
// Pass --write to rewrite presets/preset-families.json from the analyst map.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import needsDocs from './needs-docs.cjs';
needsDocs('t_preset_switch', ['docs/ux-overhaul/presets/preset-families.json']);

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
// Browser storage for the working copy's crash journal.
const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) } });
const wb = await import('../src/preset-workbench.js');
const bank = await import('../src/preset-bank.js');
const lo = await import('../src/preset-loadouts.js');
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

test('with the extension off, the preset is sent exactly as saved', () => {
    select('Sola');
    host.extensionSettings.roleplay_instructions.enabled = false;
    const order = host.chatCompletionSettings.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    assert.deepEqual(assemble(), order);
    host.extensionSettings.roleplay_instructions.enabled = true;
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

// ---------------------------------------------------------------------------------------------------------------------
// B30: the stack as the working copy.

const settingsOf = () => host.extensionSettings.roleplay_instructions;
/** The request SillyTavern assembles while the working copy is applied: enabled rows with the first live prompt's text. */
function request({ stop = false } = {}) {
    const count = wb.applyWorkingCopy();
    const live = host.chatCompletionSettings;
    const prompts = new Map();
    for (const prompt of live.prompts) if (!prompts.has(prompt.identifier)) prompts.set(prompt.identifier, prompt);
    const rows = live.prompt_order[0].order.filter(entry => entry.enabled && prompts.has(entry.identifier))
        .map(entry => ({ id: entry.identifier, text: prompts.get(entry.identifier).marker ? null : prompts.get(entry.identifier).content }));
    const modules = effectiveModules();
    // A stopped generation fires GENERATION_STOPPED and never reaches GENERATE_AFTER_DATA; both restore.
    wb.restoreWorkingCopy();
    return { rows, texts: rows.map(row => row.text).filter(text => text !== null), modules, count, stop };
}
const occurrences = (list, text) => list.filter(item => item === text).length;
const block = (identifier, content, extra = {}) => ({ identifier, name: identifier, content, role: 'system', ...extra });
function plainPreset(blocks, off = []) {
    return { temperature: 1, prompts: blocks, prompt_order: [{ character_id: 100001, order: blocks.map(p => ({ identifier: p.identifier, enabled: !off.includes(p.identifier) })) }], extensions: {} };
}
function freshStacks() {
    delete settingsOf().presetSwitches;
    settingsOf().bankStacks = {};
    settingsOf().bankVersions = {};
    settingsOf().bankTexts = {};
    if (chats.A.roleplay_instructions?.v10) { delete chats.A.roleplay_instructions.v10.bankPins; delete chats.A.roleplay_instructions.v10.moduleOwners; }
}
const solaOf = () => {
    const data = presetFromEdition(editionOf('sola/kindling-v2'), [block('offblock', 'Shipped off block text.')]);
    data.prompt_order[0].order.find(entry => entry.identifier === 'offblock').enabled = false;
    return data;
};

test('a stack of the base, two cards from another preset, a third preset and a customized version sends each once, in stack order', () => {
    freshStacks();
    stored.Sola = solaOf();
    stored.Other = plainPreset([block('o1', 'Other one text.'), block('o2', 'Other two text.'), block('o3', 'Other three text, never added.')]);
    stored.Third = plainPreset([block('t1', 'Third one text.')]);
    openChat('A');
    select('Sola');
    const b = bank.refreshBank();
    const sid = b.sids.Other, tid = b.sids.Third;
    const key = bank.stackFor(b, 'Sola').key;
    assert.equal(key, 'sola/kindling-v2', 'a recognised preset keeps its stack under the edition key');
    const o1 = `p:${sid}::o1`, o2 = `p:${sid}::o2`, t1 = `p:${tid}::t1`;
    bank.includeCards(b, key, [o1, o2], { base: 'Sola', after: 'base::main' });
    const mine = bank.createVersion(b, o1, { text: 'Her own take on other one.', base: 'Sola' });
    bank.includeCards(b, key, [bank.versionKey(mine.id)], { base: 'Sola', after: o2 });
    bank.includeCards(b, key, [t1], { base: 'Sola' });
    const stackBefore = JSON.stringify(bank.storedStack(key));
    const plan = bank.stackPlan(b, bank.storedStack(key), 'Sola').filter(item => item.group === 'main' && item.on && !item.marker);
    const sent = request();
    assert.deepEqual(sent.texts, plan.map(item => item.text), 'the request does not follow the stack');
    for (const text of ['Other one text.', 'Other two text.', 'Her own take on other one.', 'Third one text.', 'Main.']) assert.equal(occurrences(sent.texts, text), 1, text);
    assert.equal(occurrences(sent.texts, 'Other three text, never added.'), 0, 'a card she did not put in was sent');
    const at = text => sent.texts.indexOf(text);
    assert.ok(at('Main.') < at('Other one text.') && at('Other one text.') < at('Other two text.') && at('Other two text.') < at('Her own take on other one.'));
    assert.ok(at('Third one text.') < sent.rows.findIndex(row => row.id === 'chatHistory'), 'a new card goes before Chat History');
    // Namespaced identifiers: ri-bank-<source hash>-<id> and ri-bank-mine-<version id>.
    const ids = sent.rows.map(row => row.id);
    assert.ok(ids.includes(`ri-bank-${sid}-o1`) && ids.includes(`ri-bank-${sid}-o2`) && ids.includes(`ri-bank-${tid}-t1`) && ids.includes(`ri-bank-mine-${mine.id}`), ids.join());
    assert.equal(new Set(ids).size, ids.length, 'an identifier was sent twice');
    // The extension's own cards in the stack: each feature that is on runs once.
    for (const item of bank.stackPlan(b, bank.storedStack(key), 'Sola').filter(entry => entry.source === 'ri' && entry.on)) assert.equal(sent.modules[item.id], true, item.id);
    assert.equal(JSON.stringify(bank.storedStack(key)), stackBefore, 'the working copy edited the stack');
});

test('her taps on base blocks apply: one taken out, one put in that ships off, a moved block; untapped blocks keep their live state', () => {
    select('Sola');
    const b = bank.currentBank();
    const key = 'sola/kindling-v2';
    const first = stored.Sola.prompts[2].identifier, second = stored.Sola.prompts[3].identifier;
    assert.equal(request().rows.some(row => row.id === 'offblock'), false, 'a block shipped off was sent before her tap');
    bank.excludeCards(b, key, [`base::${first}`], { base: 'Sola' });
    bank.includeCards(b, key, [`base::offblock`], { base: 'Sola' });
    const index = bank.storedStack(key).cards.findIndex(item => item.key === 'base::main');
    bank.moveCards(b, key, [`base::${second}`], index, { base: 'Sola' });
    let ids = request().rows.map(row => row.id);
    assert.equal(ids.includes(first), false, 'a block she took out was sent');
    assert.equal(ids.includes('offblock'), true, 'a block she put in was not sent');
    assert.ok(ids.indexOf(second) < ids.indexOf('main'), 'her order was not applied');
    // A toggle in SillyTavern's prompt manager on a block she has not tapped in the stack still applies.
    const third = stored.Sola.prompts[4].identifier;
    host.chatCompletionSettings.prompt_order[0].order.find(entry => entry.identifier === third).enabled = false;
    ids = request().rows.map(row => row.id);
    assert.equal(ids.includes(third), false, 'the prompt manager toggle was overridden');
    select('Sola');
    bank.undoStack(b, key); bank.undoStack(b, key); bank.undoStack(b, key);
});

test('a preset block and the extension card for the same feature both reach the request', () => {
    select('Sola');
    const context = wb.switchContext();
    const style = wb.featureBlockIds(context).style;
    assert.ok(style.length);
    const sent = request();
    for (const id of style) assert.equal(sent.rows.some(row => row.id === id), true, `${id} was dropped for being duplicative`);
    assert.equal(sent.modules.style, true, 'the extension writing guidance was dropped');
    assert.equal(chats.A.roleplay_instructions.v10.moduleOwners.Sola.style, 'both');
});

test('saved presets and the live arrays are byte-identical after five generations, a stopped one included', () => {
    select('Sola');
    const saved = JSON.stringify(stored);
    const live = JSON.stringify(host.chatCompletionSettings);
    const stack = JSON.stringify(bank.storedStack('sola/kindling-v2'));
    const references = [host.chatCompletionSettings.prompts, host.chatCompletionSettings.prompt_order[0].order];
    for (let n = 0; n < 5; n++) {
        const sent = request({ stop: n === 2 });
        assert.ok(sent.count > 0, 'the working copy changed nothing');
        assert.equal(JSON.stringify(host.chatCompletionSettings), live, `generation ${n + 1} left the live arrays changed`);
    }
    // A second start without a restore in between applies the copy once.
    wb.applyWorkingCopy();
    wb.applyWorkingCopy();
    const ids = host.chatCompletionSettings.prompts.map(prompt => prompt.identifier);
    assert.equal(new Set(ids).size, ids.length, 'a double start inserted a card twice');
    wb.restoreWorkingCopy();
    assert.equal(JSON.stringify(host.chatCompletionSettings), live);
    assert.equal(JSON.stringify(stored), saved, 'a saved preset changed');
    assert.equal(JSON.stringify(bank.storedStack('sola/kindling-v2')), stack, 'the stack changed');
    assert.equal(host.chatCompletionSettings.prompts, references[0], 'the live prompt array was replaced');
    assert.equal(host.chatCompletionSettings.prompt_order[0].order, references[1], 'the live order array was replaced');
    assert.equal(storage.size, 0, 'the crash journal outlived the generation');
});

test('a dry run or a background prompt that lands while a reply is being built leaves the stack applied for that reply', () => {
    select('Sola');
    const live = JSON.stringify(host.chatCompletionSettings);
    const applied = () => JSON.stringify(host.chatCompletionSettings) !== live;
    // The reply starts; SillyTavern then starts a dry run (a token count) before the reply has built its prompt.
    wb.onGenerationStarted('normal', false);
    assert.ok(applied(), 'the reply did not apply the stack');
    const during = JSON.stringify(host.chatCompletionSettings);
    wb.onGenerationStarted('normal', true);
    assert.equal(JSON.stringify(host.chatCompletionSettings), during, 'the dry run reapplied the stack under the reply');
    // The dry run builds its prompt first: the reply is still building, so its blocks stay in the live arrays.
    wb.onPromptBuilt();
    assert.equal(JSON.stringify(host.chatCompletionSettings), during, 'the dry run took the stack away from the reply');
    wb.onPromptBuilt();
    assert.equal(JSON.stringify(host.chatCompletionSettings), live, 'the live arrays stayed changed after the reply built its prompt');
    // A stopped reply restores at once, and the count starts again from nothing.
    wb.onGenerationStarted('normal', false);
    wb.onGenerationStarted('normal', true);
    wb.onGenerationDone();
    assert.equal(JSON.stringify(host.chatCompletionSettings), live);
    wb.onGenerationStarted('normal', false);
    assert.ok(applied());
    wb.onPromptBuilt();
    assert.equal(JSON.stringify(host.chatCompletionSettings), live);
    assert.equal(storage.size, 0, 'the crash journal outlived the generation');
    // A start that returned early (a slash command) never builds a prompt; the next real reply still restores after its build.
    wb.onGenerationStarted('normal', false);
    wb.onGenerationStarted('normal', false);
    wb.onPromptBuilt();
    assert.equal(JSON.stringify(host.chatCompletionSettings), live, 'a start that returned early kept the stack applied after the next reply');
    // A generateRaw prompt (a background scene or state job) fires CHAT_COMPLETION_PROMPT_READY without GENERATION_STARTED
    // or GENERATE_AFTER_DATA; the page restores only on GENERATE_AFTER_DATA, GENERATION_ENDED and GENERATION_STOPPED.
    const page = readFileSync(root + 'src/ui/presets-page.js', 'utf8');
    assert.match(page, /on\('GENERATE_AFTER_DATA', onPromptBuilt\)/);
    assert.doesNotMatch(page, /CHAT_COMPLETION_PROMPT_READY/, 'a background prompt would restore the copy under a reply');
});

test('owners follow the stack for recognised and unrecognised presets, and effectiveModules() follows them', () => {
    stored.Plain2 = plainPreset([block('dr', 'Roll a d20 for every attempt.', { name: 'Dice Rolls' }), block('pr', 'Write tight prose.', { name: 'Prose Rules' })]);
    for (const name of ['Sola', 'Plain2']) {
        select(name);
        const b = bank.refreshBank();
        const key = bank.stackFor(b, name).key;
        request();
        const owners = () => chats.A.roleplay_instructions.v10.moduleOwners[name];
        for (const item of bank.storedStack(key).ri) assert.equal(owners()[item.key.slice(4)], 'both', `${name} ${item.key}`);
        bank.excludeCards(b, key, ['ri::state', 'ri::dice'], { base: name });
        const sent = request();
        assert.equal(owners().state, 'preset', name);
        assert.equal(owners().dice, 'preset', name);
        assert.equal(sent.modules.state, false, `${name}: story state still runs`);
        assert.equal(sent.modules.dice, false, `${name}: dice still run`);
        bank.includeCards(b, key, ['ri::state', 'ri::dice'], { base: name });
        const back = request();
        assert.equal(owners().state, 'both');
        assert.equal(back.modules.state, true);
        assert.equal(back.modules.dice, true);
    }
    assert.equal(bank.stackFor(bank.currentBank(), 'Plain2').key, 'preset:Plain2');
});

test('namespaced identifiers never collide with base identifiers, and a stale insertion from a crash is removed at the next start', async () => {
    const b0 = bank.refreshBank();
    const sid = b0.sids.Other;
    stored.Clash = plainPreset([block('main', 'Clash main.'), block(`ri-bank-${sid}-o1`, 'A base block that took the namespaced name.'), block('chatHistory', '', { marker: true })]);
    select('Clash');
    const b = bank.refreshBank();
    const key = bank.stackFor(b, 'Clash').key;
    bank.includeCards(b, key, [`p:${sid}::o1`], { base: 'Clash' });
    bank.excludeCards(b, key, ['base::main'], { base: 'Clash' });
    const saved = JSON.stringify(host.chatCompletionSettings);
    let sent = request();
    assert.equal(occurrences(sent.texts, 'A base block that took the namespaced name.'), 1);
    assert.equal(occurrences(sent.texts, 'Other one text.'), 1);
    assert.ok(sent.rows.some(row => row.id === `ri-bank-${sid}-o1~2`), sent.rows.map(row => row.id).join());
    // A crash: the copy is applied, SillyTavern saved its settings with it, and the page reloaded.
    wb.applyWorkingCopy();
    const crashed = structuredClone(host.chatCompletionSettings);
    const journal = storage.get('roleplay_instructions_working_copy');
    assert.ok(crashed.prompts.some(prompt => prompt.ri_bank_insert) && journal);
    wb.restoreWorkingCopy();
    storage.set('roleplay_instructions_working_copy', journal);
    host.chatCompletionSettings = crashed;
    const reloaded = await import('../src/preset-workbench.js?reload');
    reloaded.applyWorkingCopy();
    const ids = host.chatCompletionSettings.prompts.map(prompt => prompt.identifier);
    assert.equal(new Set(ids).size, ids.length, 'the stale copy was sent beside the new one');
    reloaded.restoreWorkingCopy();
    assert.equal(JSON.stringify(host.chatCompletionSettings), saved, 'the stale insertion or flag survived');
    // Without the journal the flagged insertion is still found and removed.
    wb.applyWorkingCopy();
    const again = structuredClone(host.chatCompletionSettings);
    wb.restoreWorkingCopy();
    host.chatCompletionSettings = again;
    const fresh = await import('../src/preset-workbench.js?again');
    fresh.applyWorkingCopy();
    fresh.restoreWorkingCopy();
    assert.equal(host.chatCompletionSettings.prompts.some(prompt => prompt.ri_bank_insert), false);
    assert.equal(host.chatCompletionSettings.prompts.length, stored.Clash.prompts.length);
    select('Sola');
});

test('a card whose source was removed still sends its last text while it is in the stack', () => {
    select('Sola');
    const b = bank.currentBank();
    const tid = b.sids.Third;
    delete stored.Third;
    const after = bank.refreshBank();
    const item = bank.stackPlan(after, bank.storedStack('sola/kindling-v2'), 'Sola').find(entry => entry.key === `p:${tid}::t1`);
    assert.equal(item.status, 'removed');
    assert.equal(occurrences(request().texts, 'Third one text.'), 1, 'a removed source stopped sending');
});

test('nothing is excluded or reordered without her tap: the working copy sends the stored stack and never edits it', () => {
    select('Sola');
    const key = 'sola/kindling-v2';
    const before = JSON.stringify(bank.storedStack(key));
    const sent = request();
    bank.refreshBank();
    request();
    assert.equal(JSON.stringify(bank.storedStack(key)), before);
    const onKeys = bank.stackPlan(bank.currentBank(), bank.storedStack(key), 'Sola').filter(item => item.group === 'main' && item.on && !item.marker);
    assert.equal(sent.texts.length, onKeys.length, 'the request and the stack hold different cards');
});

test('the companion gets a preflight owner only for a card taken out', () => {
    select('Roleplay Instructions V10');
    const b = bank.refreshBank();
    const key = bank.stackFor(b, 'Roleplay Instructions V10').key;
    request();
    const owners = () => chats.A.roleplay_instructions.v10.moduleOwners?.['Roleplay Instructions V10'] || {};
    // Every feature sends both (DECISIONS 2026-11-24, B24): only preflight is left without an owner on the
    // companion, because hostSceneChecks reads an explicit 'both' there as unpaired.
    assert.equal(owners().preflight, undefined, 'the companion got a preflight owner for a card that is on');
    assert.equal(owners().relationships, 'both');
    bank.excludeCards(b, key, ['ri::preflight'], { base: 'Roleplay Instructions V10' });
    request();
    assert.equal(owners().preflight, 'preset');
    bank.includeCards(b, key, ['ri::preflight'], { base: 'Roleplay Instructions V10' });
    request();
    assert.equal(owners().preflight, undefined, 'putting the card back left the owner');
    select('Sola');
});

test('with the extension off, and with a loadout selected as base, the preset sends as saved', async () => {
    select('Sola');
    const asSaved = data => data.prompt_order[0].order.filter(entry => entry.enabled).map(entry => entry.identifier);
    host.extensionSettings.roleplay_instructions.enabled = false;
    assert.deepEqual(request().rows.map(row => row.id), asSaved(stored.Sola));
    host.extensionSettings.roleplay_instructions.enabled = true;
    const data = lo.buildLoadout(stored.Sola, lo.makeMarker({ base: 'Sola', edition: 'sola/kindling-v2', switches: {}, off: [] }));
    stored['Sola + RI Night'] = data;
    bank.refreshBank();
    select('Sola + RI Night');
    const live = JSON.stringify(host.chatCompletionSettings);
    const sent = request();
    assert.equal(sent.count, 0, 'a loadout got a working copy');
    assert.deepEqual(sent.rows.map(row => row.id), asSaved(data));
    assert.equal(JSON.stringify(host.chatCompletionSettings), live);
    select('Sola');
});
