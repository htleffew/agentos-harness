// B37: "Import options from a preset or plugin file". The fixtures hold invented text built to mirror the structure of
// each format (A12 c.3). Runs with node --test, no host needed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, chat: [] }) };
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/banks', name), 'utf8');
let I; let B;
const ready = (async () => {
    I = await import(pathToFileURL(path.join(root, 'src/bank-import.js')).href);
    B = await import(pathToFileURL(path.join(root, 'src/banks.js')).href);
})();
const named = (out, name) => out.lists.find(l => l.name === name);
const blockNamed = (out, name) => out.blocks.find(b => b.name === name);

/** No list item may also be sent as an instruction block, and no block may sit in a list. */
function separated(out) {
    const blockTexts = new Set(out.blocks.map(b => b.name));
    for (const l of out.lists) assert.ok(!blockTexts.has(l.name) || l.items.length >= 3, `${l.name} is both a list and a block`);
    for (const b of out.blocks) assert.ok(typeof b.text === 'string' && b.text.length > 0);
}

test('the four tests tell value lists from wordings, chance gates and blocks', async () => {
    await ready;
    assert.equal(I.classify(['red', 'green', 'blue']).kind, 'list');
    assert.equal(I.classify(['red', 'green']).kind, 'block');
    assert.equal(I.classify(['', '.', '0', 'A real thing happens']).kind, 'chance');
    assert.equal(I.classify(['', '.', '0', 'A real thing happens']).chance, 25);
    const long = 'word '.repeat(80);
    assert.equal(I.classify([`{${long}}`, `<x>${long}</x>`, `[${long}]`]).kind, 'wordings');
    assert.equal(I.classify(['# Heading', 'two', 'three']).kind, 'block');
    assert.equal(I.classify(['1. Rule one', 'two', 'three']).kind, 'block');
});

test('inline {{random}} lists come with their labels; readme comments and duplicates are skipped; chance gates are blocks', async () => {
    await ready;
    const out = I.readImportFile('preset-inline.json', fixture('preset-inline.json'));
    assert.equal(out.format, 'preset');
    const flavour = named(out, 'Flavour Roller');
    assert.equal(flavour.items.length, 4);
    assert.deepEqual(flavour.items.map(i => i.label), ['Lantern', 'Harbour', 'Orchard', 'Foundry']);
    assert.equal(named(out, 'Weather').items.length, 3);
    assert.deepEqual(named(out, 'Mood').items.map(i => i.text), ['Brittle', 'Sleepy', 'Giddy', 'Sour']);
    assert.ok(!out.lists.some(l => l.items.some(i => i.text === 'not')), 'a list inside a readme comment was read');
    assert.equal(out.lists.filter(l => l.items.some(i => i.label === 'Lantern')).length, 1, 'the duplicate list was kept');
    const gate = blockNamed(out, 'Rare Surprise');
    assert.equal(gate.chance, 20);
    assert.ok(!out.lists.some(l => l.items.some(i => /goose/.test(i.text))), 'a chance gate became a value list');
    assert.ok(blockNamed(out, 'Main Prompt'), 'an instruction block was not handed to the block bank');
    const spicy = named(out, 'Heat');
    assert.equal(spicy.adult, true);
    assert.equal(spicy.tick, false);
    assert.equal(flavour.tick, true);
    separated(out);
});

test('menu groups read pick one or pick many, strip icons and wrappers, and list blocks outside the order', async () => {
    await ready;
    const out = I.readImportFile('preset-menu.json', fixture('preset-menu.json'));
    const pace = named(out, 'Pace');
    assert.equal(pace.pick, 'one');
    assert.deepEqual(pace.items.map(i => i.label), ['Crawl', 'Stroll', 'Sprint']);
    assert.ok(pace.items.every(i => !/<\/?pace>/.test(i.text)));
    const flavours = named(out, 'Flavours');
    assert.equal(flavours.pick, 'many');
    assert.equal(flavours.items[0].label, 'Zesty');
    assert.equal(named(out, 'Spice').adult, true);
    assert.equal(named(out, 'Spice').tick, false);
    const outside = named(out, "Not in the preset's order");
    assert.equal(outside.outside, true);
    assert.deepEqual(outside.items.map(i => i.label), ['Bubbly', 'Gloomy']);
    assert.ok(blockNamed(out, 'House Rules'), 'the rules block went into a list');
    assert.ok(blockNamed(out, 'Odd Moment').chance > 0);
    separated(out);
});

test('roulettes, ambient pulses, hidden subtext with tier, earliest reply and die, and one-reply rules', async () => {
    await ready;
    const out = I.readImportFile('preset-roulette.json', fixture('preset-roulette.json'));
    const mood = named(out, 'Mood');
    assert.equal(mood.roulette, true);
    assert.deepEqual(mood.items.map(i => i.label), ['SUNNY', 'STORMY', 'DRIZZLY']);
    assert.equal(mood.items[0].text, 'Bright days and easy smiles.');
    const ambient = named(out, 'Ambient pulse');
    assert.deepEqual(ambient.items.map(i => i.text), ['Church bells ring somewhere across town.', 'Two cats argue on a wall.', 'A pipe hisses and goes still.']);
    const subtext = named(out, 'Hidden subtext');
    assert.deepEqual(subtext.items.map(i => i.gate.tier), ['light', 'heavy']);
    assert.deepEqual(subtext.items.map(i => i.gate.reply), [14, 30]);
    assert.deepEqual(subtext.items.map(i => i.gate.die), [9, 21]);
    assert.equal(named(out, 'Rule for this reply').items.length, 3);
    const nested = out.lists.find(l => l.nested);
    assert.ok(nested && nested.tick === false, 'a sub-list inside a roulette option started ticked');
    assert.ok(blockNamed(out, 'Engine Init'), 'the engine block was not handed to the block bank');
    assert.ok(!out.blocks.some(b => /SUNNY|Pulse|Secret|Trial/.test(b.name)), 'a roulette option went to the block bank');
});

test('LoreBary pools become a value list or one block with its wordings; agents are background blocks', async () => {
    await ready;
    const out = I.readImportFile('plugin.json', fixture('plugin.json'));
    assert.equal(out.format, 'plugin');
    const snacks = named(out, 'Picnic snacks');
    assert.equal(snacks.items.length, 4);
    const note = blockNamed(out, 'Long craft note');
    assert.equal(note.wordings.length, 3);
    assert.equal(note.chance, 5);
    assert.ok(!out.lists.some(l => l.name === 'Long craft note'));
    const agent = blockNamed(out, 'Helper');
    assert.equal(agent.background, true);
    const fields = named(out, 'Helper: brief fields');
    assert.deepEqual(fields.items.map(i => i.label), ['WHO', 'WHERE', 'THING', 'NOT']);
    assert.equal(fields.tick, false);
    assert.deepEqual(out.data, [{ name: 'variables', count: 1 }]);
});

test('Workbench array literals and <select> options are read as text and nothing in the page runs', async () => {
    await ready;
    const before = Object.keys(globalThis).length;
    const out = I.readImportFile('workbench.html', fixture('workbench.html'));
    assert.equal(out.format, 'workbench');
    assert.deepEqual(named(out, 'tea prompts').items.map(i => i.text), ['Someone spills tea on a stranger.', 'The tea arrives an hour late.', 'The tea has gone cold and nobody says so.']);
    assert.deepEqual(named(out, 'size').items.map(i => i.text), ['tiny', 'small', 'large', 'huge']);
    assert.equal(named(out, 'way').items.length, 4);
    assert.equal(named(out, 'Beak').tick, false);
    assert.ok(blockNamed(out, 'Field Manual'));
    assert.equal(Object.keys(globalThis).length, before, 'reading the page changed the global scope');
    assert.equal(typeof globalThis.neverRun, 'undefined');
});

test('imported items carry their source and group and are removed as one group; blocks go to the block bank only', async () => {
    await ready;
    const out = I.readImportFile('preset-inline.json', fixture('preset-inline.json'));
    const group = I.importGroup('preset-inline.json', 1700000000000);
    const items = I.listItems(named(out, 'Mood'), group);
    assert.ok(items.every(i => i.group === group && i.source.file === 'preset-inline.json' && i.source.block === 'Flavour Roller'));
    const book = { entries: {} };
    const dim = B.addBank(book, 'Mood from import');
    const entry = Object.values(book.entries)[0];
    B.setBankItems(book, dim, [...entry.extensions.ri.items, ...items]);
    assert.equal(entry.extensions.ri.items.length, 4);
    assert.equal(entry.disable, true);
    B.setBankItems(book, dim, entry.extensions.ri.items.filter(i => i.group !== group));
    assert.equal(entry.extensions.ri.items.length, 0);
    // B32 added intakeBlocks to the block bank, so the default path now finds it and the blocks are written.
    const found = await I.sendBlocksToBlockBank(out.blocks);
    assert.equal(found.sent, out.blocks.length);
    assert.equal(found.waiting, 0);
    const missing = await I.sendBlocksToBlockBank(out.blocks, 'not a function');
    assert.equal(missing.sent, 0);
    assert.equal(missing.waiting, out.blocks.length);
    const taken = [];
    const sent = await I.sendBlocksToBlockBank(out.blocks, blocks => { taken.push(...blocks); });
    assert.equal(sent.sent, out.blocks.length);
    assert.ok(taken.every(b => b.origin === 'import' && !out.lists.some(l => l.items.some(i => i.text === b.text))));
});

test('a file that is neither JSON nor HTML is refused with a plain message', async () => {
    await ready;
    assert.throws(() => I.readImportFile('notes.txt', 'just some words'), /not JSON or HTML/);
    assert.throws(() => I.readImportFile('other.json', '{"hello": 1}'), /not a Chat Completion preset/);
});
