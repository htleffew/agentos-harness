// MB13: generated World Info books, the Story World book view and the shared book writer. Run with:
//   node --test tests/t_generated_books.js
// The scenarios replay MB11's scripted story into a chat in SillyTavern's own shape (tests/fixtures/mb2/story-play.mjs)
// and write the Story World book through the real modules in src/memory/. A fake World Info host keeps books by name
// and counts and times every save.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { storedMark } from '../src/memory/fold.js';
import { createBookWriter, bookMarkerOf, markerOf, ST_FIELDS, GENERATED, STAMP_ID } from '../src/memory/book-writer.js';
import {
    createStoryWorld, storyWorldEntries, storyWorldName, standaloneBook, filterGeneratedEntries, generatedBookNote, installGeneratedBookGuard,
    listGeneratedBooks, deleteGeneratedBook, FLAG_KIND, stampText, reflectedReply,
} from '../src/memory/story-world-book.js';
import { fresh, clone, story } from './fixtures/mb2/story-play.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'MB13');
const Reg = createRequire(import.meta.url)(path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'm1g', 'harness', 'mb11', 'register.js'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail) }); assert.ok(pass, `${name}: ${detail}`); };

/** A World Info host in memory: books by name, a save counter, an optional save time and a hook that runs inside each save. */
function worldHost(play, { name = 'Hale, chat 1', delay = 0, books = new Map() } = {}) {
    const saves = [];
    const state = { books, saves, onSave: null };
    const host = {
        chat: () => play.chat,
        chatInfo: () => ({ id: name, name, avatar: 'hale.png', group: '' }),
        books: {
            load: async bookName => (books.has(bookName) ? clone(books.get(bookName)) : null),
            save: async (bookName, data) => { if (delay) await sleep(delay); await state.onSave?.(bookName, data); saves.push(bookName); books.set(bookName, clone(data)); },
            names: () => [...books.keys()],
            remove: async bookName => { books.delete(bookName); },
        },
        now: () => Date.now(),
    };
    return { host, state, world: createStoryWorld({ store: play.store, host }) };
}

const SKIPPED = new Set(['scene', 'chapter', 'condensed', 'stat-sheet']);
/** What the book must hold for the play's fold, worked out here from the fold itself and not from the writer's own code. */
function expectedIds(play) {
    const f = play.fold();
    const ids = f.current.filter(r => !SKIPPED.has(r.kind)).map(r => r.id);
    for (const r of f.current) if (r.kind === 'chapter' || r.id === 'condensed') ids.push(r.id);
    return ids.sort();
}
const bodyOf = data => Object.values(data.entries).filter(e => markerOf(e)?.id !== STAMP_ID);
/** The book matches the fold: the same record ids, each entry's text holds the record's text, and nothing else is in it. */
function matches(play, data) {
    const f = play.fold();
    const have = bodyOf(data).map(e => markerOf(e)?.id || `unmarked:${e.uid}`).sort();
    const want = expectedIds(play);
    const problems = [];
    if (JSON.stringify(have) !== JSON.stringify(want)) problems.push(`ids differ: missing ${want.filter(x => !have.includes(x)).join(', ') || 'none'}; extra ${have.filter(x => !want.includes(x)).join(', ') || 'none'}`);
    for (const e of bodyOf(data)) { const r = f.byId.get(markerOf(e)?.id); if (r && !e.content.startsWith(r.text)) problems.push(`${r.id}: text differs`); }
    return { match: !problems.length, problems };
}

// ---------------------------------------------------------------- the Story World book matches the fold (13, Generated books)

test('after swipe, delete, edit and branch the Story World book matches the fold at its next write', async () => {
    const p = await fresh(30);
    const { state, world } = worldHost(p);
    const name = storyWorldName('Hale, chat 1');
    await world.write();
    let data = state.books.get(name);
    record('the book holds one entry per current record, then the chapters and the condensed account', matches(p, data).match && bodyOf(data).some(e => /^Chapter 1$/.test(e.comment)), JSON.stringify(matches(p, data)));
    const first = data.entries[0];
    record('its first entry is disabled and names the reply the book reflects', first.disable === true && first.extensions[GENERATED].id === STAMP_ID && first.content.includes(`Reflects reply ${storedMark(p.chat.at(-1))}`) && /Story World page/.test(first.content), first.content.slice(0, 120));
    const sample = bodyOf(data).find(e => /^Fact: /.test(e.comment));
    record('entries are titled by kind and subject with the subject and its aliases as keys', /^Fact: [^:]+$/.test(sample.comment) && sample.key.length >= 1 && sample.key[0] === p.fold().byId.get(markerOf(sample).id).subject, `${sample.comment} / ${sample.key.join(', ')}`);
    record('the book marks itself as generated, with the chat it belongs to', bookMarkerOf(data)?.kind === 'story-world' && bookMarkerOf(data).chat.id === 'Hale, chat 1');

    // swipe of the newest reply: the book is behind until its next write
    const i30 = p.replyIndexOfTurn(30);
    const alt = { scene: { where: 'the Crossroads drawbridge', time: 'grey dawn', present: 'Hale' }, changes: [{ kind: 'fact', id: 'drawbridge-count', subject: 'Crossroads Keep', text: 'The drawbridge guards counted the wagons twice.', evidence: 'counted the wagons twice' }] };
    p.swipe(i30, 'The column came to the drawbridge in the grey light and the guards counted the wagons twice.');
    await p.capture(i30, alt);
    const behind = matches(p, state.books.get(name));
    await world.write();
    const afterSwipe = matches(p, state.books.get(name));
    record('after a swipe the old book is behind the fold and the next write matches it', !behind.match && afterSwipe.match, `behind: ${behind.problems[0] || ''}`);
    p.select(i30, 0);
    await world.write();
    record('swiping back, the next write matches the fold again', matches(p, state.books.get(name)).match);

    // delete turn 25 (its player message and its reply)
    const before = bodyOf(state.books.get(name)).length;
    const i25 = p.replyIndexOfTurn(25);
    p.del(i25); p.del(i25 - 1);
    const stale = matches(p, state.books.get(name));
    await world.write();
    const afterDelete = matches(p, state.books.get(name));
    record('after a delete the next write matches the fold', afterDelete.match && bodyOf(state.books.get(name)).length <= before, `${before} entries before, ${bodyOf(state.books.get(name)).length} after; stale before the write: ${stale.match ? 'no' : 'yes'}`);

    // edit a reply: its entries are held out until it is captured again
    const i22 = p.replyIndexOfTurn(22);
    p.edit(i22, `${p.chat[i22].mes} Marten counted the wagons again.`);
    await world.write();
    const afterEdit = matches(p, state.books.get(name));
    record('after an edit the next write matches the fold', afterEdit.match, afterEdit.problems.join('; '));

    // branch at reply 20: its own book, the main book unchanged
    const mainBefore = JSON.stringify(state.books.get(name));
    const b = p.branch(p.replyIndexOfTurn(20), 'branch');
    const branchHost = worldHost(b, { name: 'Branch #1 - Hale', books: state.books });
    await branchHost.world.write();
    const branchBook = state.books.get(storyWorldName('Branch #1 - Hale'));
    record('a branch gets its own book that matches its fold, and the main book is not changed', matches(b, branchBook).match && Object.keys(branchBook.entries).length < Object.keys(state.books.get(name).entries).length && JSON.stringify(state.books.get(name)) === mainBefore, `${Object.keys(branchBook.entries).length} entries in the branch book, ${Object.keys(state.books.get(name).entries).length} in the main`);
    results.push({ name: 'swipe scenario book sizes', pass: true, detail: JSON.stringify({ main30: before, afterDelete: bodyOf(state.books.get(name)).length }) });
});

test('the book is written as one whole-book save per write, and an unchanged book is not saved again', async () => {
    const p = await fresh(12);
    const { state, world } = worldHost(p);
    const a = await world.write();
    record('the first write is one save', a.saved === true && state.saves.length === 1, `${state.saves.length} saves`);
    const b = await world.write();
    record('a second write with nothing new saves nothing', b.unchanged === true && state.saves.length === 1);
    await p.play(13);
    const c = await world.write();
    record('a write after a new reply is one more save', c.saved === true && state.saves.length === 2 && matches(p, state.books.get(storyWorldName('Hale, chat 1'))).match);
});

// ---------------------------------------------------------------- a capture never waits on a book write (timed)

test('a reply\'s capture never waits on a book write', async () => {
    const p = await fresh(20);
    const { state, world } = worldHost(p, { delay: 400 });
    // the book write is asked for, as a chapter close does, and the next capture runs while the save is under way
    const t0 = performance.now();
    world.schedule();
    const asked = performance.now() - t0;
    const t1 = performance.now();
    await p.play(21);
    const capture = performance.now() - t1;
    const savedDuringCapture = state.saves.length;
    await world.settled();
    world.schedule();
    await world.settled();
    const name = storyWorldName('Hale, chat 1');
    record('asking for a write returns at once', asked < 20, `${asked.toFixed(1)} ms`);
    record('the capture finishes while the save is still running', capture < 200 && savedDuringCapture === 0, `capture ${capture.toFixed(1)} ms against a 400 ms save, ${savedDuringCapture} saves done`);
    record('the next write matches the fold, which now holds the capture', matches(p, state.books.get(name)).match && state.saves.length === 2, `${state.saves.length} saves`);
    results.push({ name: 'timed', pass: true, detail: JSON.stringify({ askForWriteMs: +asked.toFixed(2), captureMs: +capture.toFixed(2), saveMs: 400 }) });
});

test('writes asked for while one waits join it, and a failed write leaves the book as it was', async () => {
    const p = await fresh(10);
    const { state, world } = worldHost(p, { delay: 120 });
    const first = world.write();
    const second = world.write();
    const third = world.write();
    await Promise.all([first, second, third]);
    record('three requests while one runs make two saves at most', state.saves.length <= 2, `${state.saves.length} saves`);
    const name = storyWorldName('Hale, chat 1');
    const good = clone(state.books.get(name));
    state.onSave = async () => { throw new Error('disk full'); };
    await p.play(11);
    await assert.rejects(world.write(), /disk full/);
    record('a failed save leaves the saved book as it was and is kept in the receipts', JSON.stringify(state.books.get(name)) === JSON.stringify(good) && world.receipts().some(r => r.kind === 'failed'));
    state.onSave = null;
    await world.write();
    record('the next write recovers', matches(p, state.books.get(name)).match);
});

// ---------------------------------------------------------------- edits typed into the generated book

test('an entry typed or changed in the book reaches the review list before the rewrite, and File as my edit makes a locked record', async () => {
    const p = await fresh(30);
    const { state, world } = worldHost(p);
    const name = storyWorldName('Hale, chat 1');
    await world.write();
    const data = clone(state.books.get(name));
    const changed = bodyOf(data).find(e => /^Fact: /.test(e.comment));
    const target = p.fold().byId.get(markerOf(changed).id);
    changed.content = 'Night is a dapple-grey gelding with a white blaze.';
    const added = { ...clone(data.entries[0]), uid: 999, comment: 'My note', content: 'The ford below the keep is haunted.', disable: false, key: ['the ford'], extensions: {} };
    data.entries[999] = added;
    state.books.set(name, data);
    let flagsAtSave = -1, bookAtSave = '';
    state.onSave = async () => { flagsAtSave = p.fold().flags.filter(f => f.kind === FLAG_KIND).length; };
    await world.write();
    const flags = world.edits();
    record('both edits are on the review list before the book is rewritten', flagsAtSave === 2 && flags.length === 2, `${flagsAtSave} flags when the save started`);
    record('the flags carry the text you typed in full, with the book and entry it came from', flags.some(f => f.record.why === 'changed' && f.record.content === 'Night is a dapple-grey gelding with a white blaze.' && f.record.book === name) && flags.some(f => f.record.why === 'added' && f.record.content.includes('haunted')));
    record('the rewrite replaced the typed text in the book, so the review list is the only copy', !JSON.stringify(state.books.get(name)).includes('dapple-grey') && !JSON.stringify(state.books.get(name)).includes('haunted'));
    await world.write();
    record('a second write raises no second flag for the same edits', world.edits().length === 2);

    const changedFlag = world.edits().find(f => f.record.why === 'changed');
    const addedFlag = world.edits().find(f => f.record.why === 'added');
    const filed = await world.fileEdit(changedFlag);
    const f = p.fold();
    const mine = f.byId.get(target.id);
    record('File as my edit creates a locked record that holds your text', filed.filed && mine.locked === true && mine.text === 'Night is a dapple-grey gelding with a white blaze.' && mine.versions.at(-1).origin.type === 'you', `${mine.id} locked ${mine.locked}`);
    record('the filed flag leaves the list', !world.edits().some(x => x.entry === changedFlag.entry) && world.edits().length === 1);
    await world.write();
    const afterFile = bodyOf(state.books.get(name)).find(e => markerOf(e).id === target.id);
    record('the next write carries your text in that entry', afterFile.content.startsWith('Night is a dapple-grey gelding') && world.edits().length === 1);
    // a model entry aimed at the locked record is held for review: the lock is real
    await p.store.record([{ op: 'revise', target: [target.id], record: { id: target.id, kind: target.kind, subject: target.subject, text: 'A model rewrote this.' }, origin: { type: 'upkeep', route: 'code' } }]);
    record('a background job cannot rewrite the locked record', p.fold().byId.get(target.id).text.startsWith('Night is a dapple-grey') && p.fold().flags.some(x => x.kind === 'locked-record'));
    // the added entry becomes a new locked record, or is dismissed
    const filedNew = await world.fileEdit(addedFlag);
    const created = p.fold().byId.get(filedNew.id);
    record('an entry you added files as a new locked record', created && created.locked && created.text === 'The ford below the keep is haunted.' && created.aliases.includes('the ford') && world.edits().length === 0, filedNew.id);
    await world.write();
    record('after filing, the book matches the fold and holds the new record', matches(p, state.books.get(name)).match && bodyOf(state.books.get(name)).some(e => markerOf(e).id === filedNew.id));

    // Dismiss: the typed text stays out of the records
    const book2 = clone(state.books.get(name));
    book2.entries[998] = { ...clone(book2.entries[0]), uid: 998, comment: 'Another note', content: 'The tower clock is slow.', disable: false, extensions: {} };
    state.books.set(name, book2);
    await world.write();
    const dismissed = world.edits()[0];
    const recordsBefore = p.fold().records.length;
    await world.dismiss(dismissed);
    record('Dismiss removes the flag and files nothing', world.edits().length === 0 && p.fold().records.length === recordsBefore);
    // reload keeps the flags and locked record
    const reloaded = p.reload();
    record('the filed record stays locked after a reload', reloaded.fold().byId.get(target.id).locked === true);
});

test('an edited secret keeps its holders, and a thread keeps its outcome, when filed', async () => {
    const p = await fresh(30);
    const { state, world } = worldHost(p);
    const name = storyWorldName('Hale, chat 1');
    await world.write();
    const data = clone(state.books.get(name));
    const entry = bodyOf(data).find(e => /^Secret: /.test(e.comment));
    const rec = p.fold().byId.get(markerOf(entry).id);
    assert.match(entry.content, /Known to: /);
    entry.content = entry.content.replace(/^[^]*?( Known to:)/, 'Heather heard the packet was left at the Broken Spur.$1');
    state.books.set(name, data);
    await world.write();
    await world.fileEdit(world.edits()[0]);
    const after = p.fold().byId.get(rec.id);
    record('the secret keeps its holders after filing', JSON.stringify(after.holders) === JSON.stringify(rec.holders) && after.text === 'Heather heard the packet was left at the Broken Spur.' && after.locked, JSON.stringify(after.holders));
    await world.write();
    const again = bodyOf(state.books.get(name)).find(e => markerOf(e).id === rec.id);
    record('and its entry still ends with the fixed holder line', /Known to: [^.]+\.$/.test(again.content), again.content);
});

test('a book with this name that the extension did not write is never overwritten', async () => {
    const p = await fresh(8);
    const { state, world } = worldHost(p);
    const name = storyWorldName('Hale, chat 1');
    const authored = { entries: { 0: { uid: 0, key: ['mine'], comment: 'Mine', content: 'Written by hand.', disable: false } } };
    state.books.set(name, authored);
    const out = await world.write();
    record('the write is refused and the book is untouched', out.refused === true && JSON.stringify(state.books.get(name)) === JSON.stringify(authored) && state.saves.length === 0);
});

// ---------------------------------------------------------------- the book never reaches the request beside recall

test('the Story World book never reaches the request beside the recall block, including when attached to the chat', async () => {
    const p = await fresh(30);
    const { state, world } = worldHost(p);
    const name = storyWorldName('Hale, chat 1');
    await world.write();
    const book = state.books.get(name);
    // SillyTavern's scan as it would hand it over with the book attached to the chat: every entry with its book's name.
    const scanned = Object.values(book.entries).filter(e => !e.disable).map(e => ({ ...clone(e), world: name }));
    const mine = [{ uid: 1, world: 'Hale reference', comment: 'Brannic', content: 'Brannic is the farrier at Elerian Keep.', key: ['Brannic'], extensions: {} }];
    const recall = p.fold().current.filter(r => !SKIPPED.has(r.kind) && r.kind !== 'secret').map(r => r.text).join('\n');
    const lines = [...p.fold().current].filter(r => r.kind === 'fact').map(r => r.text);
    const probe = lines[0];
    const countOf = (text, needle) => text.split(needle).length - 1;
    const control = [recall, ...scanned.map(e => e.content), ...mine.map(e => e.content)].join('\n');
    const lore = { globalLore: [], characterLore: [], personaLore: [], chatLore: [...scanned, ...mine] };
    const handlers = [];
    await installGeneratedBookGuard((event, fn) => { handlers.push([event, fn]); return true; });
    assert.equal(handlers[0][0], 'WORLDINFO_ENTRIES_LOADED');
    handlers[0][1](lore);
    const payload = [recall, ...lore.chatLore.map(e => e.content)].join('\n');
    record('without the guard a record reaches the request twice, once in recall and once from the attached book', countOf(control, probe) === 2, `${countOf(control, probe)} times`);
    record('with the guard the record reaches the request once, in the recall block', countOf(payload, probe) === 1, `${countOf(payload, probe)} times`);
    record('no entry of the book remains in the request and your own book entry is untouched', !lore.chatLore.some(e => e.world === name || markerOf(e)) && lore.chatLore.some(e => e.world === 'Hale reference'));
    const note = generatedBookNote();
    record('Review, Context gets a note naming the book and the number of entries left out', note.includes(name) && new RegExp(`${scanned.length} entries were left out`).test(note), note);
    // a marker alone is enough, so a book renamed in SillyTavern's editor is still left out
    const renamed = [{ ...clone(scanned[0]), world: 'Some other name' }];
    const out = filterGeneratedEntries([renamed]);
    record('an entry carrying the extension\'s marker is left out whatever its book is called', out.removed === 1 && renamed.length === 0);
    // the Tracker book is placed by the extension itself, so it is not sent twice either
    const tracker = [{ uid: 0, world: 'RI Tracker, Hale, chat 1', content: 'Place: the drawbridge', extensions: {} }];
    record('the Tracker book\'s entries are left out of the scan as well', filterGeneratedEntries([tracker]).removed === 1);
});

// ---------------------------------------------------------------- export

test('Export as World Info book writes a standalone copy with entries enabled and secrets left out by default', async () => {
    const p = await fresh(30);
    const { state, world } = worldHost(p);
    const f = p.fold();
    const secrets = f.current.filter(r => r.kind === 'secret');
    assert.ok(secrets.length >= 2);
    const copy = await world.exportBook();
    const file = JSON.parse(copy.file);
    const entries = Object.values(file.entries);
    record('every entry in the file is enabled and the file holds only SillyTavern\'s own fields', entries.length > 10 && entries.every(e => e.disable === false) && entries.every(e => Object.keys(e).every(k => ST_FIELDS.has(k))) && entries.every(e => Object.keys(e.extensions).length === 0));
    record('no marker of the extension is in the file and the stamp entry is not exported', !copy.file.includes(GENERATED) && !entries.some(e => /Reflects reply/.test(e.content)));
    record('with Leave secrets out on by default, no secret record is in the file', secrets.every(s => !copy.file.includes(s.text) && !copy.file.includes(s.text.slice(0, 40))) && !/Known to:/.test(copy.file) && copy.secretsLeftOut === secrets.length, `${copy.secretsLeftOut} secrets left out`);
    const open = await world.exportBook({ leaveSecretsOut: false });
    record('with Leave secrets out off, the secrets are included with their holders', secrets.every(s => open.file.includes(s.text.slice(0, 40))) && /Known to: Heather\./.test(open.file));
    record('every entry has the fields SillyTavern needs to open it', entries.every(e => Array.isArray(e.key) && typeof e.content === 'string' && typeof e.comment === 'string' && Number.isInteger(e.uid)) && Object.keys(file.entries).every((uid, i) => Number(uid) === i));
    const saved = await world.exportToBook();
    const again = await world.exportToBook();
    record('Export to a book saves an ordinary book that the extension does not own, under a free name', !bookMarkerOf(state.books.get(saved.name)) && saved.name !== again.name && state.books.has(again.name));
    record('exporting writes the generated book first, so the copy matches the fold', matches(p, state.books.get(storyWorldName('Hale, chat 1'))).match);
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, 'export-sample.json'), copy.file);
});

// ---------------------------------------------------------------- the shared writer: Tracker and carry-over books

test('B21 writes the Tracker book through the same writer, from a fixture tracker set', async () => {
    const books = new Map();
    const saves = [];
    const writer = createBookWriter({ loadBook: async n => (books.has(n) ? clone(books.get(n)) : null), saveBook: async (n, d) => { saves.push(n); books.set(n, clone(d)); }, now: () => 1 });
    const tracker = (scene, extra = {}) => ({
        name: 'RI Tracker, Hale, chat 1', kind: 'tracker', chat: { id: 'Hale, chat 1' }, onEdit: 'replace',
        stamp: { text: `Reflects reply m1 (version 1). Edits made in the editor are replaced at the next rewrite. Correct a value with Correct a story fact.` },
        entries: [
            { id: 'scene', comment: 'Scene', key: [], content: scene, constant: true, position: 4, depth: 1, order: 100, ...extra },
            { id: 'character:Hale', comment: 'Character: Hale', key: [], content: 'Hale: left arm bandaged; mounted on Night.', constant: true, position: 4, depth: 1, order: 110 },
        ],
    });
    const a = await writer.write(tracker('Place: Crossroads drawbridge; Time: grey dawn; Present: Hale, Marten'));
    const book = books.get('RI Tracker, Hale, chat 1');
    record('the writer saves the Tracker book as one whole-book save', a.saved && saves.length === 1 && bookMarkerOf(book).kind === 'tracker');
    record('its entries are Constant, at depth 1 in the chat, and the first is disabled and says edits are replaced', Object.values(book.entries).slice(1).every(e => e.constant === true && e.position === 4 && e.depth === 1 && !e.disable) && book.entries[0].disable === true && /replaced at the next rewrite/.test(book.entries[0].content));
    book.entries[1].content = 'Place: somewhere I typed.';
    books.set('RI Tracker, Hale, chat 1', book);
    const b = await writer.write(tracker('Place: Crossroads drawbridge; Time: grey dawn; Present: Hale, Marten'));
    record('an edit made in the editor is replaced at the next rewrite and raises no review item', b.saved && b.edits.length === 0 && /Crossroads drawbridge/.test(books.get('RI Tracker, Hale, chat 1').entries[1].content));
    const c = await writer.write(tracker('Place: the north gate; Time: noon; Present: Hale'));
    record('a changed value rewrites the book', c.saved && /north gate/.test(books.get('RI Tracker, Hale, chat 1').entries[1].content) && saves.length === 3);
    const d = await writer.write(tracker('Place: the north gate; Time: noon; Present: Hale'));
    record('the same values again save nothing', d.unchanged === true && saves.length === 3);
    const carry = { name: 'RI Carry-over, Hale, chat 2', kind: 'carry-over', chat: { id: 'Hale, chat 2' }, onEdit: 'once', stamp: { text: 'Carried from Hale, chat 1 at reply m9.' }, entries: [{ id: 'synopsis', comment: 'Synopsis', key: [], content: 'The column reached Crossroads Keep.', constant: true }] };
    const e = await writer.write(carry);
    const f = await writer.write({ ...carry, entries: [{ ...carry.entries[0], content: 'Changed.' }] });
    record('a carry-over book is written once and left as it is afterwards', e.saved && f.unchanged && /reached Crossroads/.test(books.get(carry.name).entries[1].content));
    await assert.rejects(writer.write({ ...carry, name: 'x', kind: 'diary' }), /Unknown generated book kind/);
    await assert.rejects(writer.write({ ...tracker('x'), name: 'y', entries: [{ id: 'a', content: '1' }, { id: 'a', content: '2' }] }), /unique/);
});

// ---------------------------------------------------------------- books of chats that are gone

test('a generated book whose chat is gone is listed with Delete and never removed on its own', async () => {
    const p = await fresh(10);
    const books = new Map();
    const a = worldHost(p, { name: 'Hale, chat 1', books });
    const b = worldHost(p, { name: 'Hale, chat 2', books });
    await a.world.write(); await b.world.write();
    books.set('Some reference book', { entries: { 0: { uid: 0, key: ['x'], content: 'x', comment: 'x' } } });
    const alive = new Set(['Hale, chat 2']);
    const parts = { names: () => [...books.keys()], load: async n => clone(books.get(n) || null), remove: async n => { books.delete(n); }, chatExists: async chat => alive.has(chat.id) };
    const listed = await listGeneratedBooks(parts);
    record('both generated books are listed, the first with its chat gone, and the reference book is not listed', listed.length === 2 && listed.find(x => x.chat.id === 'Hale, chat 1').chatGone === true && listed.find(x => x.chat.id === 'Hale, chat 2').chatGone === false, JSON.stringify(listed.map(x => [x.name, x.chatGone])));
    record('listing deletes nothing', books.size === 3);
    const refused = await deleteGeneratedBook(storyWorldName('Hale, chat 2'), parts);
    const reference = await deleteGeneratedBook('Some reference book', parts);
    record('Delete refuses a book whose chat still exists and a book the extension did not write', !refused.deleted && !reference.deleted && books.size === 3);
    const gone = await deleteGeneratedBook(storyWorldName('Hale, chat 1'), parts);
    record('Delete removes the book whose chat is gone', gone.deleted && !books.has(storyWorldName('Hale, chat 1')) && books.size === 2);
});

// ---------------------------------------------------------------- the report register

test('everything the writer adds follows the report register, and the book carries no mood language', async () => {
    const p = await fresh(54);
    const { state, world } = worldHost(p);
    await world.write();
    const data = state.books.get(storyWorldName('Hale, chat 1'));
    // The frozen M1g story words one record as an inner state ("Hale suspects ..."); a live Writer under the register prompt would state what was said. The count is reported and the sentences are skipped.
    const FROZEN = /[^.]*\bHale suspect(s|ed)\b[^.]*\./g;
    let frozen = 0;
    const clean = t => t.replace(FROZEN, () => { frozen++; return ''; });
    const bad = Object.values(data.entries).filter(e => Reg.moodHits(clean(`${e.comment} ${e.content}`)).length);
    record('the Story World book carries no mood language in any entry', bad.length === 0, bad.slice(0, 3).map(e => `${e.comment}: ${Reg.moodHits(clean(e.content)).join('/')}`).join('; ') || `${Object.keys(data.entries).length} entries scanned, ${frozen} frozen sentences skipped`);
    const own = [stampText(reflectedReply(p.chat)), stampText(null), ...Object.values(data.entries).map(e => e.comment.replace(/:.*$/, '')), 'Known to: Hale, Heather.', 'Outcome:'];
    record('the text the writer adds itself (the stamp, title labels and the holder line) has no mood language', own.every(t => Reg.moodHits(t).length === 0), own.filter(t => Reg.moodHits(t).length).join(' | '));
    record('names, numbers and places in the records are kept exactly in the entries', bodyOf(data).every(e => { const r = p.fold().byId.get(markerOf(e).id); return r && e.content.startsWith(r.text); }) && bodyOf(data).some(e => /\b\d+\b/.test(e.content)));
    record('no emoji in any entry', !Object.values(data.entries).some(e => /\p{Extended_Pictographic}/u.test(`${e.comment}${e.content}${e.key.join('')}`)));
});

test('no memory job reads a generated book back as a source of records', async () => {
    const p = await fresh(20);
    const { state, world } = worldHost(p);
    await world.write();
    const name = storyWorldName('Hale, chat 1');
    const data = clone(state.books.get(name));
    bodyOf(data)[0].content = 'A line typed into the book.';
    state.books.set(name, data);
    const recordsBefore = JSON.stringify(p.fold().records.map(r => [r.id, r.text]));
    // Until the edit is filed it is a flag and nothing else: the fold's records are the same.
    await world.write();
    record('a typed edit adds a flag and changes no record until you file it', JSON.stringify(p.fold().records.map(r => [r.id, r.text])) === recordsBefore && world.edits().length === 1);
    const log = JSON.stringify(p.meta);
    record('no change entry names a book as its route or source', !/"route":"[^"]*book/i.test(log) && p.fold().flags.every(f => f.kind === FLAG_KIND || f.kind === 'locked-record'));
});

test.after(() => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE, 'book-results.json'), JSON.stringify({ suite: 'tests/t_generated_books.js', run: new Date().toISOString().slice(0, 10), story: story.turns.length, results }, null, 2));
});
