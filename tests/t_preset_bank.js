// B29: the block bank, customized versions and the stack model. Run with: node --test tests/t_preset_bank.js
// A fake SillyTavern context stands in for the host: a preset manager whose list the bank indexes, two chats, and an
// event source. Every preset text here is invented. The 190-preset fixture takes its block counts from the P1 inventory
// in docs/ux-overhaul/presets/preset-families.json.
// Pass --write-fixtures <folder> to write the 190 fixture presets as SillyTavern preset files (for the host check).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));
const full = JSON.parse(readFileSync(root + 'docs/ux-overhaul/presets/preset-families.json', 'utf8'));
const companionFile = JSON.parse(readFileSync(root + 'presets/Roleplay Instructions V10.json', 'utf8'));

// ---------------------------------------------------------------------------------------------------------------------
// The 190-preset fixture: one preset per P1 inventory row, with that row's block, marker and enabled counts and invented text.
const HOST_ROWS = ['chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'dialogueExamples', 'charDescription', 'charPersonality', 'scenario', 'personaDescription'];
const WORDS = 'amber lantern river quill harbor meadow copper thistle orbit velvet canyon ember signal marble willow cipher atlas fable'.split(' ');
function rng(seed) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }
function inventedText(random, serial) {
    const length = 60 + Math.floor(random() * random() * 2600);
    let text = `Rule ${serial}.`;
    while (text.length < length) text += ` ${WORDS[Math.floor(random() * WORDS.length)]}`;
    return `${text}.`;
}
export function fixtureLibrary() {
    return full.inventory.map((row, index) => {
        const random = rng(index * 7919 + 17);
        const prompts = [];
        const markers = Math.min(row.markers, row.blocks);
        for (let i = 0; i < markers; i++) {
            const id = i < HOST_ROWS.length ? HOST_ROWS[i] : `fixture-head-${i}`;
            prompts.push({ identifier: id, name: i < HOST_ROWS.length ? id : `Heading ${i}`, marker: true, system_prompt: i < HOST_ROWS.length });
        }
        for (let i = markers; i < row.blocks; i++) {
            prompts.push({ identifier: `fx-${index}-${i}`, name: `Fixture block ${i}`, role: 'system', system_prompt: false, injection_position: 0,
                content: inventedText(random, `${index}.${i}`) });
        }
        const order = prompts.map((block, i) => ({ identifier: block.identifier, enabled: i < row.enabled }));
        return { name: `Fixture ${String(index + 1).padStart(3, '0')} ${row.family}`, data: { temperature: 1, openai_max_context: 32000, prompts,
            prompt_order: [{ character_id: 100001, order }], extensions: {} } };
    });
}
const writeAt = process.argv.indexOf('--write-fixtures');
if (writeAt > 0) {
    const folder = process.argv[writeAt + 1];
    mkdirSync(folder, { recursive: true });
    for (const entry of fixtureLibrary()) writeFileSync(`${folder}/${entry.name}.json`, JSON.stringify(entry.data, null, 4));
    console.log(`wrote ${full.inventory.length} fixture presets to ${folder}`);
    process.exit(0);
}

// ---------------------------------------------------------------------------------------------------------------------
// The fake host
const chats = { A: {}, B: {} };
let chat = 'A';
let stored = {};
let selected = '';
const handlers = new Map();
const eventTypes = { OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after', OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready', PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted', PRESET_RENAMED: 'preset_renamed', SETTINGS_LOADED_AFTER: 'settings_loaded_after', CHAT_CHANGED: 'chat_id_changed' };
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    get chatMetadata() { return chats[chat]; }, getCurrentChatId: () => chat, saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1', getPresetManager: () => manager, eventTypes,
    eventSource: { on(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
        async emit(type, data) { for (const fn of handlers.get(type) || []) await fn(data); } },
};
// The list holds the same objects SillyTavern keeps, so a save that assigns into one in place is seen as SillyTavern does it.
let names = {}, presets = [];
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: names, presets }),
    async savePreset(name, data) { put(name, structuredClone(data)); },
};
function put(name, data) {
    if (Object.hasOwn(names, name)) Object.assign(presets[names[name]], data);
    else { presets.push(data); names[name] = presets.length - 1; }
    stored[name] = presets[names[name]];
}
function remove(name) { delete names[name]; delete stored[name]; }
function setLibrary(entries) { names = {}; presets = []; stored = {}; for (const { name, data } of entries) put(name, structuredClone(data)); }
function select(name) { selected = name; host.chatCompletionSettings = structuredClone(stored[name]); }
globalThis.SillyTavern = { getContext: () => host };

const bank = await import('../src/preset-bank.js');
const lib = await import('../src/preset-library.js');
const { settings } = await import('../src/store.js');
const { syncProfile } = await import('../src/preset-profiles.js');
function openChat(id) { chat = id; chats[id].roleplay_instructions ||= {}; chats[id].roleplay_instructions.v10 = { ...(chats[id].roleplay_instructions.v10 || {}), enabled: true }; }
openChat('A');

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const block = (identifier, name, content, extra = {}) => ({ identifier, name, content, role: 'system', system_prompt: false, injection_position: 0, ...extra });
const marker = identifier => ({ identifier, name: identifier, marker: true, system_prompt: true });
function presetOf(blocks, enabled) {
    return { temperature: 1, openai_max_context: 32000, prompts: blocks, extensions: {},
        prompt_order: [{ character_id: 100001, order: blocks.filter(b => !b.unlisted).map(b => ({ identifier: b.identifier, enabled: enabled.includes(b.identifier) })) }] };
}
const PROSE = 'Write the scene in close third person with plain, concrete sentences and distinct voices for every speaker.';
const alpha = () => presetOf([block('main', 'Main Prompt', 'Alpha main prompt text.'), block('a-prose', 'Prose Rules', PROSE), marker('worldInfoBefore'),
    block('a-dice', 'Dice Rolls', 'Roll a die for each risky action and report the number.'), block('a-alt', 'Alternative voice', 'Use a playful narrator voice.'),
    marker('chatHistory'), block('a-unlisted', 'Spare block', 'A spare block that the order does not list.', { unlisted: true })],
    ['main', 'a-prose', 'worldInfoBefore', 'a-dice', 'chatHistory']);
const beta = () => presetOf([block('main', 'Main Prompt', 'Beta main prompt text.'), block('b-prose', 'Prose Rules', PROSE),
    block('b-extra', 'Extra flavour', 'Add one sensory detail to every paragraph of the reply.'), marker('chatHistory')], ['main', 'b-prose', 'chatHistory']);
const recognisedEdition = shipped.editions.find(edition => edition.recognize.mode !== 'coverage-pair' && Object.keys(edition.modules).length >= 2
    && Object.values(edition.modules).every(item => item.ids.length));
function editionPreset(edition) {
    const ids = [...new Set([...edition.recognize.ids, ...Object.values(edition.modules).flatMap(m => m.ids)])];
    const blocks = [block('main', 'Main Prompt', 'Edition main.'), marker('chatHistory'), ...ids.map((id, i) => block(id, `Edition block ${i}`, `Edition block ${i} invented text.`))];
    return presetOf(blocks, blocks.map(b => b.identifier));
}
const COMPANION = 'Roleplay Instructions V10';

function reset(entries = [{ name: 'Alpha', data: alpha() }, { name: 'Beta', data: beta() }, { name: COMPANION, data: companionFile }]) {
    const st = settings();
    for (const name of ['bankVersions', 'bankStacks', 'bankTexts', 'bankSources', 'bankTags', 'presetSwitches']) delete st[name];
    for (const id of Object.keys(chats)) { chats[id] = {}; }
    openChat('A');
    bank.resetBank();
    bank.useBankLibrary(shipped);
    bank.useCompanionFile(null);
    setLibrary(entries);
    select(entries[0].name);
    return bank.refreshBank('test');
}
const keyIn = (b, name, id) => bank.cardKey(bank.presetSource(b.sids[name]), id);
const planOf = (b, stack, base = selected) => bank.stackPlan(b, stack, base);
const stackShape = stack => JSON.stringify({ cards: stack.cards, ri: stack.ri });
const orderShape = stack => JSON.stringify([...stack.cards, ...stack.ri].map(item => [item.key, item.on, item.hash]));

// ---------------------------------------------------------------------------------------------------------------------

test('the bank lists every preset in the list, RI and the companion, with no add-a-source step', () => {
    const b = reset();
    const kinds = [...b.sources.values()].map(source => [source.kind, source.name]);
    assert.deepEqual(kinds.filter(([kind]) => kind === 'preset').map(([, name]) => name), ['Alpha', 'Beta']);
    assert.ok(b.sources.has(bank.SOURCE_COMPANION) && b.sources.get(bank.SOURCE_COMPANION).name === COMPANION);
    assert.ok(b.sources.has(bank.SOURCE_RI));
    assert.equal(b.sources.get(bank.SOURCE_RI).cards.length, lib.FEATURE_KEYS.length, 'one RI card per feature');
    assert.equal(b.sources.get(bank.SOURCE_COMPANION).cards.length, companionFile.prompts.length);
    // Identical text keeps one card per source.
    const a = b.cards.get(keyIn(b, 'Alpha', 'a-prose')), c = b.cards.get(keyIn(b, 'Beta', 'b-prose'));
    assert.equal(a.hash, c.hash);
    assert.notEqual(a.key, c.key);
    assert.equal(a.hash, lib.blockHash(PROSE), 'cards carry the P1 block hash');
    // An unlisted block is in the bank; a marker from a source other than the base is filled by the base.
    assert.ok(b.cards.get(keyIn(b, 'Alpha', 'a-unlisted')));
    assert.equal(bank.canInclude(b, keyIn(b, 'Beta', 'chatHistory'), 'Alpha').ok, false);
    // With the companion missing from the list, the shipped file is the companion source.
    setLibrary([{ name: 'Alpha', data: alpha() }]);
    bank.useCompanionFile(companionFile);
    const shippedOnly = bank.refreshBank('test');
    assert.equal(shippedOnly.sources.get(bank.SOURCE_COMPANION).name, COMPANION);
});

test('two blocks with one identifier in a preset keep two cards', () => {
    const doubled = presetOf([block('main', 'Main', 'One.'), block('main', 'Main again', 'Two.')], ['main']);
    const b = reset([{ name: 'Doubled', data: doubled }]);
    const source = b.sources.get(bank.presetSource(b.sids.Doubled));
    assert.deepEqual(source.cards.map(card => card.id), ['main', 'main#2']);
});

test('tags come from the P1 map, then the name tables, then her own tag; they only label cards', () => {
    const b = reset([{ name: 'Edition copy', data: editionPreset(recognisedEdition) }, { name: 'Alpha', data: alpha() }, { name: COMPANION, data: companionFile }]);
    const source = b.sources.get(bank.presetSource(b.sids['Edition copy']));
    assert.equal(source.recognized?.edition.key, recognisedEdition.key);
    assert.equal(bank.stackKey('Edition copy', null, b), recognisedEdition.key, 'the stack saves per edition key');
    const [feature, item] = Object.entries(recognisedEdition.modules)[0];
    assert.ok(b.cards.get(keyIn(b, 'Edition copy', item.ids[0])).tags.includes(feature));
    assert.deepEqual(b.cards.get(keyIn(b, 'Alpha', 'a-dice')).tags, ['dice'], 'Dice Rolls matched by the name tables');
    assert.deepEqual(b.cards.get(bank.cardKey(bank.SOURCE_COMPANION, 'ri-craft-prose')).tags, ['style']);
    assert.equal(bank.stackKey('Alpha', null, b), 'preset:Alpha');
    // Recognition over indexed cards gives what preset-library.js recognize() gives.
    for (const entry of [{ data: editionPreset(recognisedEdition) }, { data: alpha() }, ...fixtureLibrary().slice(0, 12)]) {
        const cards = bank.indexBank({ presets: [{ name: 'X', data: entry.data }], library: shipped }).sources;
        const mine = [...cards.values()].find(s => s.kind === 'preset').recognized;
        const theirs = lib.recognize(entry.data, shipped);
        assert.equal(mine?.edition.key ?? null, theirs?.edition.key ?? null);
    }
});

test('a new stack holds the base as shipped, every RI feature that is on and the companion shipped-on blocks', () => {
    const b = reset();
    const stack = bank.stackFor(b, 'Alpha');
    const plan = planOf(b, stack);
    const main = plan.filter(item => item.group === 'main');
    const base = main.filter(item => item.source === bank.SOURCE_BASE);
    assert.deepEqual(base.map(item => [item.id, item.on]), [['main', true], ['a-prose', true], ['worldInfoBefore', true], ['a-dice', true], ['a-alt', false], ['chatHistory', true]],
        'the base order with its shipped on and off states');
    assert.equal(main.some(item => item.id === 'a-unlisted'), false, 'a block the order does not list waits in the bank');
    const shippedCompanion = bank.shippedOn(b, bank.SOURCE_COMPANION);
    const companion = main.filter(item => item.source === bank.SOURCE_COMPANION).map(item => item.key);
    assert.deepEqual(companion, shippedCompanion, 'every companion shipped-on block, in its own order');
    assert.ok(companion.length >= 10);
    assert.ok(main.findIndex(item => item.source === bank.SOURCE_COMPANION) < main.findIndex(item => item.id === 'chatHistory'), 'placed before the base Chat History row');
    const on = bank.featureOn('Alpha');
    assert.deepEqual(plan.filter(item => item.group === 'ri').map(item => item.id).sort(), lib.FEATURE_KEYS.filter(key => on[key]).sort());
    assert.ok(plan.filter(item => item.group === 'ri').every(item => item.on));
    // Duplicates and feature matches stay: Alpha's prose block, the companion's prose craft and the RI Writing style card are all on.
    assert.equal(plan.find(item => item.id === 'a-prose').on, true);
    assert.equal(plan.find(item => item.key === 'companion::ri-craft-prose').on, true);
    assert.equal(plan.find(item => item.key === 'ri::style').on, true);
    assert.equal(plan.find(item => item.id === 'a-dice').on, true, 'Dice Rolls stays on beside the RI Dice card');
    assert.deepEqual(bank.storedStack('preset:Alpha'), stack, 'the starting stack is saved when first read');
    // A base without the companion's landmark rows still gets every companion block before its Chat History row.
    const betaMain = bank.stackFor(b, 'Beta').cards.map(item => item.key);
    assert.ok(betaMain.indexOf('companion::main') < betaMain.indexOf('base::chatHistory'));
    assert.equal(betaMain.at(-1), 'base::chatHistory');
    // The companion as base gives its own order, nothing added twice, and every RI card that is on.
    const own = planOf(b, bank.stackFor(b, COMPANION), COMPANION);
    assert.equal(own.filter(item => item.source === bank.SOURCE_COMPANION).length, 0);
    assert.equal(own.filter(item => item.group === 'main').length, companionFile.prompt_order[0].order.length);
});

test('a copy of the companion and the companion send each companion block once from their shared stack', () => {
    const copyName = `${COMPANION}.432`;
    const b = reset([{ name: COMPANION, data: companionFile }, { name: copyName, data: structuredClone(companionFile) }]);
    assert.ok(b.sids[copyName], 'the copy is a listed preset of its own');
    const stack = bank.stackFor(b, copyName);
    assert.equal(stack.cards.filter(item => item.source === bank.SOURCE_COMPANION).length, 0, 'a companion edition gains no companion cards');
    // A stack started on the copy before this fix holds both the copy's rows and the companion's cards under one edition key.
    const twin = bank.shippedOn(b, bank.SOURCE_COMPANION)[0];
    const id = bank.parseKey(twin).id;
    const shared = { ...stack, cards: [...stack.cards, { ...stack.cards.find(item => item.key === `base::${id}`), key: twin, source: bank.SOURCE_COMPANION, on: true }] };
    for (const base of [copyName, COMPANION]) {
        const sent = planOf(b, shared, base).filter(item => item.on && item.id === id);
        assert.equal(sent.length, 1, `${base} sends ${id} once`);
        assert.equal(sent[0].key, `base::${id}`);
    }
    // With the base row taken out and the companion card on, the companion card is the one sent.
    const off = { ...shared, cards: shared.cards.map(item => item.key === `base::${id}` ? { ...item, on: false } : item) };
    assert.deepEqual(planOf(b, off, COMPANION).filter(item => item.on && item.id === id).map(item => item.key), [twin]);
});

test('stored Ours or Theirs switches do not carry into stacks and stay readable', () => {
    const b0 = reset();
    const switches = Object.fromEntries(lib.FEATURE_KEYS.map(key => [key, 'ours']));
    settings().presetSwitches = { 'preset:Alpha': { ...switches } };
    chats.A.roleplay_instructions.v10.presetPins = { 'preset:Alpha': { style: 'theirs' } };
    const b = bank.refreshBank('test');
    assert.ok(b0);
    const plan = planOf(b, bank.stackFor(b, 'Alpha'));
    assert.equal(plan.find(item => item.id === 'a-dice').on, true);
    assert.equal(plan.find(item => item.key === 'ri::style').on, true);
    bank.migrateBank();
    assert.deepEqual(settings().presetSwitches['preset:Alpha'], switches);
});

test('a saved edit makes a customized version; the clean card and the preset file are unchanged', () => {
    const b = reset();
    const before = { file: sha(stored.Beta), live: sha(host.chatCompletionSettings), all: sha(presets) };
    const key = keyIn(b, 'Beta', 'b-prose');
    const clean = b.cards.get(key);
    const version = bank.createVersion(b, key, { label: 'Tighter', text: 'Write in short sentences.' });
    assert.deepEqual(Object.keys(version).sort(), ['cleanHash', 'created', 'edited', 'id', 'label', 'name', 'placement', 'role', 'sourceId', 'source', 'sourceName', 'text'].sort());
    assert.equal(version.sourceName, 'Beta');
    assert.equal(version.sourceId, 'b-prose');
    assert.equal(version.cleanHash, clean.hash);
    assert.equal(version.name, 'Prose Rules');
    assert.equal(version.role, 'system');
    assert.deepEqual(version.placement, { position: 0, depth: 4, order: 100, triggers: [] });
    assert.ok(version.created > 0 && version.edited === version.created);
    assert.deepEqual(settings().bankVersions[version.id], version);
    assert.deepEqual({ file: sha(stored.Beta), live: sha(host.chatCompletionSettings), all: sha(presets) }, before, 'no preset written');
    const again = bank.refreshBank('test');
    assert.equal(again.cards.get(key).hash, clean.hash);
    assert.equal(again.cards.get(key).text, PROSE);
    // An edit of a base card names the base preset as its source.
    const fromBase = bank.createVersion(again, 'base::a-prose', { text: 'Mine.', base: 'Alpha' });
    assert.equal(fromBase.sourceName, 'Alpha');
    assert.equal(bank.cleanKeyOf(fromBase), keyIn(again, 'Alpha', 'a-prose'));
    assert.throws(() => bank.createVersion(again, keyIn(again, 'Alpha', 'chatHistory'), { text: 'x' }), /fills this row/);
    const edited = bank.editVersion(version.id, { text: 'Write in very short sentences.', label: 'Tightest' });
    assert.ok(edited.edited >= edited.created);
    assert.equal(bank.versionsOf(key).length, 1);
});

test('versions survive a re-import that overwrites their source', () => {
    const b = reset();
    const key = keyIn(b, 'Beta', 'b-prose');
    const version = bank.createVersion(b, key, { text: 'My prose rule.' });
    // SillyTavern's import of a file with the same name overwrites the stored preset in place.
    const next = beta();
    next.prompts[1].content = 'A rewritten prose rule from the author.';
    put('Beta', next);
    const after = bank.refreshBank('preset-imported');
    assert.equal(after.sids.Beta, b.sids.Beta);
    const record = bank.getVersion(version.id);
    assert.equal(record.text, 'My prose rule.');
    const status = bank.versionStatus(after, record);
    assert.equal(status.status, 'changed');
    assert.equal(status.cleanKey, key);
    assert.equal(status.clean.text, 'A rewritten prose rule from the author.', 'linked to the new clean block for compare');
    // Unchanged clean text leaves the version clean.
    const other = bank.createVersion(after, keyIn(after, 'Beta', 'b-extra'), { text: 'Two sensory details.' });
    put('Beta', beta());
    assert.equal(bank.versionStatus(bank.refreshBank('test'), bank.getVersion(other.id)).status, 'clean');
});

test('reset to clean takes the current clean text; delete removes only that record', () => {
    const b = reset();
    const key = keyIn(b, 'Beta', 'b-prose');
    const one = bank.createVersion(b, key, { text: 'First.' });
    const two = bank.createVersion(b, key, { text: 'Second.' });
    const changed = beta();
    changed.prompts[1].content = 'The author changed this.';
    put('Beta', changed);
    const after = bank.refreshBank('test');
    const reset1 = bank.resetVersion(after, one.id);
    assert.equal(reset1.text, 'The author changed this.');
    assert.equal(reset1.cleanHash, after.cards.get(key).hash);
    assert.equal(bank.versionStatus(after, reset1).status, 'clean');
    const others = sha({ two: settings().bankVersions[two.id], stacks: settings().bankStacks });
    assert.equal(bank.deleteVersion(one.id), true);
    assert.equal(bank.getVersion(one.id), null);
    assert.equal(sha({ two: settings().bankVersions[two.id], stacks: settings().bankStacks }), others);
    assert.equal(bank.deleteVersion(one.id), false);
});

test('a clean card and versions of it sit in one stack, each with its own place', () => {
    const b = reset();
    const stack = bank.stackFor(b, 'Alpha');
    const one = bank.createVersion(b, 'base::a-prose', { text: 'Version one.', base: 'Alpha' });
    const two = bank.createVersion(b, 'base::a-prose', { text: 'Version two.', base: 'Alpha' });
    bank.includeCards(b, stack.key, [bank.versionKey(one.id)], { base: 'Alpha', at: 0 });
    bank.includeCards(b, stack.key, [bank.versionKey(two.id)], { base: 'Alpha', after: 'base::a-dice' });
    const plan = planOf(b, bank.storedStack(stack.key));
    const order = plan.filter(item => item.group === 'main').map(item => item.key);
    assert.equal(order[0], bank.versionKey(one.id));
    assert.equal(order[order.indexOf('base::a-dice') + 1], bank.versionKey(two.id));
    assert.ok(order.includes('base::a-prose'));
    assert.deepEqual(plan.filter(item => [bank.versionKey(one.id), bank.versionKey(two.id), 'base::a-prose'].includes(item.key)).map(item => [item.on, item.text]),
        [[true, 'Version one.'], [true, PROSE], [true, 'Version two.']]);
    // Moving the clean card moves it alone.
    const moved = bank.moveCard(b, stack.key, 'base::a-prose', 0, { base: 'Alpha' });
    assert.equal(moved.cards[0].key, 'base::a-prose');
    assert.equal(moved.cards[1].key, bank.versionKey(one.id));
});

test('refresh marks Changed in source, keeps a deleted source sending, and follows a rename by block hash', () => {
    const b = reset();
    const sids = { ...b.sids };
    const stack = bank.stackFor(b, 'Alpha');
    const betaProse = keyIn(b, 'Beta', 'b-prose');
    bank.includeCards(b, stack.key, [betaProse, keyIn(b, 'Beta', 'b-extra')], { base: 'Alpha' });
    const version = bank.createVersion(b, betaProse, { text: 'Mine.' });
    bank.includeCard(b, stack.key, bank.versionKey(version.id), { base: 'Alpha' });
    const shape = () => stackShape(bank.storedStack(stack.key));
    const before = shape();
    // A save that changes one block of Beta, written in place as SillyTavern's Update does.
    const saved = beta();
    saved.prompts[1].content = 'Prose rules, second edition.';
    Object.assign(stored.Beta, saved);
    const changed = bank.refreshBank('preset-saved');
    assert.ok(changed.cards.get(betaProse).changedAt > 0, 'the bank card shows Changed in source');
    assert.equal(changed.cards.get(betaProse).previousHash, lib.blockHash(PROSE));
    let plan = planOf(changed, bank.storedStack(stack.key));
    const card = plan.find(item => item.key === betaProse);
    assert.equal(card.status, 'changed');
    assert.equal(card.text, PROSE, 'it sends the text it was taken with until she takes the new text');
    assert.equal(card.currentText, 'Prose rules, second edition.');
    const mine = plan.find(item => item.key === bank.versionKey(version.id));
    assert.equal(mine.text, 'Mine.');
    assert.equal(mine.cleanStatus, 'changed');
    assert.equal(shape(), before, 'the refresh did not edit the stack');
    // Take the new text applies on her tap only.
    bank.takeNewText(changed, stack.key, [betaProse], { base: 'Alpha' });
    plan = planOf(changed, bank.storedStack(stack.key));
    assert.equal(plan.find(item => item.key === betaProse).status, 'clean');
    assert.equal(plan.find(item => item.key === betaProse).text, 'Prose rules, second edition.');
    const afterTake = shape();
    const takenOrder = orderShape(bank.storedStack(stack.key));
    // A deleted preset keeps its cards, with their last text, marked Source removed and still on.
    remove('Beta');
    const gone = bank.refreshBank('preset-deleted');
    assert.ok(gone.removed.includes(b.sids.Beta));
    plan = planOf(gone, bank.storedStack(stack.key));
    const left = plan.filter(item => bank.parseKey(item.key).source === bank.presetSource(b.sids.Beta));
    assert.deepEqual(left.map(item => [item.status, item.on]), [['removed', true], ['removed', true]]);
    assert.deepEqual(left.map(item => item.text), ['Prose rules, second edition.', 'Add one sensory detail to every paragraph of the reply.']);
    assert.equal(plan.find(item => item.key === bank.versionKey(version.id)).cleanStatus, 'removed');
    assert.equal(shape(), afterTake);
    // Renamed with no event: the new name holds the same block hashes, so it keeps the source id and every card key.
    const alphaData = stored.Alpha;
    remove('Alpha');
    put('Alpha Renamed', structuredClone(alphaData));
    select('Alpha Renamed');
    const renamed = bank.refreshBank('reread');
    assert.equal(renamed.sids['Alpha Renamed'], sids.Alpha);
    assert.deepEqual(renamed.renames.map(item => [item.from, item.to, item.by]), [['Alpha', 'Alpha Renamed', 'hash']]);
    assert.equal(bank.storedStack('preset:Alpha'), null);
    assert.equal(orderShape(bank.storedStack('preset:Alpha Renamed')), takenOrder, 'the stack moved with the name, order and inclusion as they were');
    assert.equal(bank.storedStack('preset:Alpha Renamed').base, 'Alpha Renamed');
    assert.ok(renamed.cards.get(bank.cardKey(bank.presetSource(sids.Alpha), 'a-prose')));
});

test('a rename the host reports moves the source even after a refresh saw both names', () => {
    const b = reset();
    const betaSid = b.sids.Beta;
    bank.stackFor(b, 'Beta');
    put('Beta Two', structuredClone(stored.Beta));
    const both = bank.refreshBank('preset-changed');
    assert.notEqual(both.sids['Beta Two'], betaSid);
    remove('Beta');
    bank.installBankHooks();
    return host.eventSource.emit(eventTypes.PRESET_RENAMED, { apiId: 'openai', oldName: 'Beta', newName: 'Beta Two' })
        .then(() => new Promise(resolve => setTimeout(resolve, 30)))
        .then(() => {
            const now = bank.currentBank();
            assert.equal(now.sids['Beta Two'], betaSid);
            assert.ok(bank.storedStack('preset:Beta Two'));
        });
});

test('preset events refresh the bank', async () => {
    const b = reset();
    bank.installBankHooks();
    const wait = () => new Promise(resolve => setTimeout(resolve, 360));
    put('Gamma', presetOf([block('g-one', 'Gamma one', 'Gamma text.')], ['g-one']));
    await host.eventSource.emit(eventTypes.OAI_PRESET_IMPORT_READY, { presetName: 'Gamma' });
    await wait();
    assert.ok(bank.currentBank().sids.Gamma && bank.currentBank().sources.has(bank.presetSource(bank.currentBank().sids.Gamma)));
    stored.Gamma.prompts[0].content = 'Gamma text, saved again.';
    await host.eventSource.emit(eventTypes.OAI_PRESET_CHANGED_AFTER);
    await wait();
    assert.equal(bank.currentBank().cards.get(keyIn(bank.currentBank(), 'Gamma', 'g-one')).text, 'Gamma text, saved again.');
    remove('Gamma');
    await host.eventSource.emit(eventTypes.PRESET_DELETED, { apiId: 'openai', name: 'Gamma' });
    await wait();
    assert.equal(bank.currentBank().sources.has(bank.presetSource(bank.currentBank().sids.Gamma)), false);
    assert.ok(b);
});

test('190 fixture presets index in under 2 seconds and a one-preset change rehashes only that preset', () => {
    const library = fixtureLibrary();
    const blocks = library.reduce((n, entry) => n + entry.data.prompts.length, 0);
    const textBlocks = library.reduce((n, entry) => n + entry.data.prompts.filter(p => !p.marker).length, 0);
    const chars = library.reduce((n, entry) => n + entry.data.prompts.reduce((m, p) => m + (p.content || '').length, 0), 0);
    assert.equal(library.length, 190);
    assert.equal(blocks, full.inventory.reduce((n, row) => n + row.blocks, 0));
    const started = performance.now();
    const b = reset([...library, { name: COMPANION, data: companionFile }]);
    const ms = performance.now() - started;
    const presetsIndexed = [...b.sources.values()].filter(source => source.kind === 'preset').length;
    console.log(`# indexed ${presetsIndexed} fixture presets, ${blocks} blocks (${textBlocks} with text, ${(chars / 1e6).toFixed(1)} M characters) in ${ms.toFixed(0)} ms; index ${b.stats.ms.toFixed(0)} ms, ${b.stats.hashed} hashed`);
    assert.equal(presetsIndexed, 190);
    assert.ok(ms < 2000, `indexing took ${ms.toFixed(0)} ms`);
    const quiet = bank.refreshBank('open');
    assert.equal(quiet.stats.hashed, 0, 'a refresh with nothing changed hashes nothing');
    const target = library[57];
    const at = target.data.prompts.findIndex(p => !p.marker);
    stored[target.name].prompts[at].content = 'One changed block of invented text.';
    const once = bank.refreshBank('preset-saved');
    console.log(`# refresh after one change: ${once.stats.ms.toFixed(1)} ms, hashed ${once.stats.hashed}, presets rehashed ${JSON.stringify(once.stats.rehashed)}`);
    assert.deepEqual(once.stats.rehashed, [target.name]);
    assert.ok(once.stats.hashed >= 1 && once.stats.hashed <= target.data.prompts.length);
    const card = once.cards.get(keyIn(once, target.name, target.data.prompts[at].identifier));
    assert.ok(card.changedAt > 0);
    if (process.env.RI_BANK_TIMING) writeFileSync(process.env.RI_BANK_TIMING, JSON.stringify({ presets: presetsIndexed, blocks, textBlocks, chars, ms, indexMs: b.stats.ms,
        hashed: b.stats.hashed, refreshMs: once.stats.ms, refreshHashed: once.stats.hashed, rehashed: once.stats.rehashed, node: process.version }, null, 2));
});

test('no block is excluded or reordered without her tap', () => {
    const b = reset([{ name: 'Alpha', data: alpha() }, { name: 'Beta', data: beta() }, { name: COMPANION, data: companionFile }, { name: 'Edition copy', data: editionPreset(recognisedEdition) }]);
    const stack = bank.stackFor(b, 'Alpha');
    bank.includeCards(b, stack.key, [keyIn(b, 'Beta', 'b-prose')], { base: 'Alpha' });
    bank.excludeCard(b, stack.key, 'ri::dice', { base: 'Alpha' });
    const fixed = () => stackShape(bank.storedStack(stack.key));
    const before = fixed();
    const checks = {
        refresh: () => bank.refreshBank('test'),
        refreshOnOpen: () => bank.refreshOnOpen(),
        tagChange: () => { bank.setCardTags(keyIn(b, 'Beta', 'b-prose'), ['dice', 'emotions']); bank.setCardTags('base::a-prose', []); },
        libraryChange: () => { bank.useBankLibrary(null); bank.refreshBank('test'); bank.useBankLibrary(shipped); bank.refreshBank('test'); },
        profileChange: () => {
            stored.Alpha.extensions = { roleplay_instructions: { modelProfiles: [{ id: 'p1', label: 'GLM', models: ['glm-5.1'], contextSize: 200000 }] } };
            select('Alpha'); syncProfile('model'); syncProfile('preset');
        },
        presetChange: () => { select('Beta'); bank.stackFor(bank.refreshBank('test'), 'Beta'); select('Alpha'); bank.refreshBank('test'); },
        presetEdit: () => { stored.Alpha.prompt_order[0].order.reverse(); stored.Alpha.prompt_order[0].order.forEach(row => { row.enabled = !row.enabled; }); bank.refreshBank('test'); },
        featureChange: () => { chats.A.roleplay_instructions.v10.modules = { style: false, roast: true }; bank.refreshBank('test'); },
        chatChange: () => { openChat('B'); bank.refreshBank('test'); openChat('A'); },
        migration: () => { bank.migrateBank(); settings().bankStacks[stack.key].v = 0; bank.migrateBank(); },
        plan: () => { const plan = planOf(bank.currentBank(), bank.storedStack(stack.key)); bank.stackCost(plan); bank.featureStates(plan); bank.ownersFromStack(plan); },
        newVersion: () => bank.createVersion(bank.currentBank(), 'base::a-prose', { text: 'Unrelated version.', base: 'Alpha' }),
    };
    for (const [name, run] of Object.entries(checks)) {
        run();
        assert.equal(fixed(), before, `${name} left the stack as it was`);
    }
    // The taps do change it.
    bank.stepCard(bank.currentBank(), stack.key, 'base::a-dice', -1, { base: 'Alpha' });
    assert.notEqual(fixed(), before);
    assert.equal(stackShape(bank.undoStack(bank.currentBank(), stack.key)), before);
});

test('include, exclude, move and undo are taps on the stored stack', () => {
    const b = reset();
    const stack = bank.stackFor(b, 'Alpha');
    const plan0 = planOf(b, stack);
    const cost0 = bank.stackCost(plan0);
    const extra = keyIn(b, 'Beta', 'b-extra');
    bank.includeCard(b, stack.key, extra, { base: 'Alpha' });
    let saved = bank.storedStack(stack.key);
    assert.equal(saved.cards[saved.cards.findIndex(item => item.key === 'base::chatHistory') - 1].key, extra, 'a new card goes before the base Chat History row');
    const cost1 = bank.stackCost(planOf(b, saved));
    assert.equal(cost1.total - cost0.total, b.cards.get(extra).tokens);
    bank.excludeCard(b, stack.key, extra, { base: 'Alpha' });
    saved = bank.storedStack(stack.key);
    assert.equal(saved.cards.find(item => item.key === extra).on, false, 'left out at its place');
    bank.includeCard(b, stack.key, 'base::a-alt', { base: 'Alpha' });
    assert.equal(bank.storedStack(stack.key).cards.find(item => item.key === 'base::a-alt').on, true, 'a shipped-off base block goes in where it stands');
    // A base card taken through its preset key is the same card.
    bank.excludeCard(b, stack.key, keyIn(b, 'Alpha', 'a-alt'), { base: 'Alpha' });
    assert.equal(bank.storedStack(stack.key).cards.find(item => item.key === 'base::a-alt').on, false);
    // RI cards move only among themselves.
    const ri = bank.storedStack(stack.key).ri.map(item => item.key);
    const moved = bank.moveCard(b, stack.key, ri[ri.length - 1], 0, { base: 'Alpha' });
    assert.equal(moved.ri[0].key, ri[ri.length - 1]);
    assert.equal(moved.cards.length, saved.cards.length);
    for (let i = 0; i < 12; i++) bank.stepCard(b, stack.key, 'base::a-dice', i % 2 ? 1 : -1, { base: 'Alpha' });
    let undone = 0;
    while (bank.canUndo(stack.key)) { bank.undoStack(b, stack.key); undone++; }
    assert.equal(undone, 10, 'undo keeps the last ten edits');
    // Pinning copies the stack into the chat; edits then stay in the chat.
    bank.pinStack(b, stack.key, true, { base: 'Alpha' });
    assert.equal(bank.stackScope(stack.key), 'chat');
    bank.excludeCard(b, stack.key, 'base::main', { base: 'Alpha' });
    assert.equal(settings().bankStacks[stack.key].cards.find(item => item.key === 'base::main').on, true);
    assert.equal(bank.storedStack(stack.key).cards.find(item => item.key === 'base::main').on, false);
    openChat('B');
    assert.equal(bank.stackScope(stack.key), 'edition');
    openChat('A');
    bank.pinStack(b, stack.key, false);
    assert.equal(bank.stackScope(stack.key), 'edition');
});

test('feature state reads RI, preset, both or off from the stack alone', () => {
    const b = reset();
    const stack = bank.stackFor(b, 'Alpha');
    const state = () => bank.featureStates(planOf(bank.currentBank(), bank.storedStack(stack.key)));
    assert.equal(state().dice.state, 'both', 'Dice Rolls and the RI Dice card both on');
    assert.equal(state().style.state, 'both');
    bank.excludeCard(b, stack.key, 'ri::dice', { base: 'Alpha' });
    assert.equal(state().dice.state, 'preset');
    assert.deepEqual(state().dice.preset.map(item => item.key), ['base::a-dice']);
    bank.excludeCard(b, stack.key, 'base::a-dice', { base: 'Alpha' });
    assert.equal(state().dice.state, 'off');
    bank.includeCard(b, stack.key, 'ri::dice', { base: 'Alpha' });
    assert.equal(state().dice.state, 'ri');
    assert.equal(state().roast.state, 'off', 'roast ships off');
    const all = state();
    for (const key of lib.FEATURE_KEYS) assert.ok(['ri', 'preset', 'both', 'off'].includes(all[key].state), key);
    // Her own tag adds a feature reading; it never changes inclusion.
    bank.setCardTags('base::main', ['tone']);
    const shapeBefore = stackShape(bank.storedStack(stack.key));
    assert.equal(state().tone?.state, undefined, 'a base:: tag key is not a bank card key');
    bank.setCardTags(keyIn(b, 'Alpha', 'main'), ['tone']);
    assert.equal(state().tone.state, 'preset');
    assert.equal(stackShape(bank.storedStack(stack.key)), shapeBefore);
    const owners = bank.ownersFromStack(planOf(bank.currentBank(), bank.storedStack(stack.key)));
    assert.equal(owners.dice, 'both');
    assert.equal(owners.roast, 'preset');
});

test('a namespaced identifier never collides with a base identifier', () => {
    const b = reset();
    const stack = bank.stackFor(b, 'Alpha');
    bank.includeCards(b, stack.key, [keyIn(b, 'Beta', 'main'), 'companion::main'], { base: 'Alpha' });
    const ids = planOf(b, bank.storedStack(stack.key)).map(item => item.sendId);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('main') && ids.includes(`ri-bank-${b.sids.Beta}-main`) && ids.includes('ri-bank-companion-main'));
});
