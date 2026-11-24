// B6: the record adapter reads and writes today's Story World storage with no change in behavior, every record screen goes
// through it, and every prompt slot and control home names something real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { roleplay_instructions: { sets: { World: { kind: 'world' } } } }, getCurrentChatId: () => 'chat', chatMetadata: {}, chat: [] }) };
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../../src');
const R = await import('../../src/records.js');
const W = await import('../../src/world.js');
const V = await import('../../src/v10.js');

// An existing Story World book, written by today's code, loads through the adapter and saves back unchanged.
const book = { entries: {} };
for (const [kind, name, key, text] of [['character', 'Hale', 'who', 'A captain'], ['place', 'Gate', 'what', 'The gate is open.'], ['thread', 'Open matter', 'what', 'Who took the ledger.']]) {
    const entry = R.entries.blank(book, kind);
    entry.name = name; entry.fields[key] = text; entry.locked = kind === 'place';
    R.entries.put(book, entry, 'World');
}
const stored = JSON.parse(JSON.stringify(book));
const listed = R.entries.list(book, 'World');
assert.deepEqual(listed.map(item => [item.kind, item.name]), [['character', 'Hale'], ['place', 'Gate'], ['thread', 'Open matter']]);
assert.deepEqual(listed, W.listWorld(book, 'World'), 'the adapter lists what the world module lists');
for (const entry of listed) R.entries.put(book, entry, 'World');
assert.deepEqual(book, stored, 'loading and saving every entry leaves the book unchanged');
assert.equal(R.entries.text(listed[0]), W.renderEntry(listed[0]));
assert.deepEqual(R.entries.flags(listed[0], listed), W.entryFlags(listed[0], listed));

// Chat records: the kinds each screen shows, Facts and Plot separate.
assert.deepEqual(R.kindsFor('facts'), ['fact']);
assert.deepEqual(R.kindsFor('plots'), ['arc', 'seed', 'agenda', 'event']);
assert.deepEqual(R.kindsFor('portrayal'), ['profile', 'knowledge']);
assert.deepEqual(R.kindsFor('emotion'), ['emotion', 'relationship']);
assert.equal(new Set(Object.values(R.RECORD_KINDS).map(info => info.screen)).size, 4);
for (const kind of Object.keys(R.RECORD_KINDS)) assert.ok(Object.hasOwn(V.KIND_MODULE, kind));
const row = { kind: 'fact', on: true, fields: { data: JSON.stringify({ id: 'gate-open', kind: 'fact', text: 'The gate is open.', source: 'user', atIndex: 3 }) } };
const record = V.readRecord(row);
assert.equal(record.id, 'gate-open');
assert.deepEqual(R.recordSource(record), { store: 'story-world', world: '', origin: 'player', quote: '', atIndex: 3 });
assert.deepEqual(R.recordHistory(record), []);

// Screens read and write records only through the adapter.
const screens = ['ui/world.js', 'ui/v10.js', 'ui/context-dashboard.js', 'ui/chat-books.js', 'ui/state.js'];
const forbidden = ['loadWorld', 'saveWorld', 'listWorld', 'writeWorldEntry', 'newWorldEntry', 'rowsForWorld', 'saveV10Record', 'readRecord', 'loadEffectiveWorld', 'recordManualWorldChange', 'storyJournalStatus', 'syncWorld'];
for (const file of screens) {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.\.\/(?:world|worldflow|memory-journal|v10)\.js)'/g)) {
        const names = match[1].split(',').map(name => name.trim().split(/\s+as\s+/)[0]);
        for (const name of names) assert.ok(!forbidden.includes(name), `${file} imports ${name} from ${match[2]}; use records.js`);
    }
}

// Every prompt a page edits goes through a slot that carries the stored prompt ids.
const pagesWithPrompts = ['ui/world.js', 'ui/v10.js', 'ui/context-dashboard.js', 'ui/settings.js', 'ui/state.js', 'ui/sets.js', 'ui/events.js', 'ui/goals.js', 'ui/corrections.js'];
for (const file of pagesWithPrompts) assert.ok(!/promptGroup\(/.test(fs.readFileSync(path.join(src, file), 'utf8')), `${file} uses slot(), not promptGroup()`);
const { PROMPTS } = await import('../../src/prompts.js');
for (const file of pagesWithPrompts) {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    for (const match of text.matchAll(/\bslot\(\s*\[([^\]]*)\]/g)) {
        for (const id of [...match[1].matchAll(/'([A-Za-z0-9-]+)'/g)].map(item => item[1])) assert.ok(PROMPTS[id], `${file}: slot names a stored prompt (${id})`);
    }
}

// The control homes name pages that exist and links that make sense.
const { HOMES } = await import('../../src/ui/home-table.js');
const D = await import('../../src/ui/destinations.js');
const known = new Set([...D.pages.map(page => page.id), 'memory', 'set-rules']);
for (const [key, home] of Object.entries(HOMES)) {
    assert.ok(known.has(home.page), `${key}: home page ${home.page} exists`);
    for (const link of home.links) assert.ok(known.has(link), `${key}: link page ${link} exists`);
    assert.ok(!home.links.includes(home.page), `${key}: a home does not link to itself`);
}
assert.ok(Object.keys(HOMES).length >= 24, 'the 24 duplicated controls of audit 02 each have a home');
console.log('record adapter, control homes and prompt slots: passed');
