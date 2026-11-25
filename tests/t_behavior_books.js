// MB12: behavior books (memory DESIGN 7.6). The extension's own modules run in Node on a host in SillyTavern's shape. The
// Writer and capture calls go through tests/mock.js, started here on its own port, so each request and answer crosses
// the same HTTP boundary a route uses.
//   node --test tests/t_behavior_books.js
// The fixture is a third-party behavior book in SillyTavern 1.19's own shape (tests/fixtures/mb12). The section 13 row
// (200 seeded turns with the extension on and off) runs on the MB11 harness's model of SillyTavern's scan when docs/ is
// present; the browser suite t_behavior_books_host.js runs it on SillyTavern's real scan.
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, '..', 'docs', 'ux-overhaul');
const HARNESS = path.join(DOCS, 'memory', 'evidence', 'm1g', 'harness', 'mb11');
const EVIDENCE = path.join(DOCS, 'memory', 'evidence', 'MB12');
const FIXTURE = path.join(here, 'fixtures', 'mb12', 'Story events and styles.json');
const PORT = Number(process.env.RI_BEHAVIOR_MOCK_PORT || 8264);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mb12-'));
const MODE = path.join(TMP, 'mode.json'), LOG = path.join(TMP, 'requests.jsonl');
const t0 = Date.parse('2026-11-24T12:00:00Z');

// ---------------------------------------------------------------- a host in SillyTavern's shape

const books = new Map();
const host = {
    chat: [], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale of Verath', characters: [{ name: 'Hale of Verath' }], characterId: 0,
    getCurrentChatId: () => host.chatId || 'mb12-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata: async () => {},
    loadWorldInfo: async name => structuredClone(books.get(name) || null), saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
    getWorldInfoNames: () => [...books.keys()], updateWorldInfoList: async () => {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const A = await import('../src/memory/additions.js');
const FL = await import('../src/memory/flags.js');
const U = await import('../src/memory/upkeep.js');
const BB = await import('../src/memory/behavior-books.js');
const FE = await import('../src/memory/fired-entries.js');
const ES = await import('../src/memory/event-seeds.js');
const CA = await import('../src/memory/capture.js');
const SF = await import('../src/memory/story-so-far.js');
const BW = await import('../src/memory/book-writer.js');

const out = { suite: 'tests/t_behavior_books.js', run: new Date().toISOString(), checks: {} };
const fixtureText = fs.readFileSync(FIXTURE, 'utf8');
const fixture = () => JSON.parse(fixtureText);

let clock = t0;
function message(i, text, user = false, name = user ? 'Heather' : 'Hale of Verath') {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name, is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
/** A fresh chat of `replies` exchanges with its memory in chat data, and a store over it. */
function freshChat(replies = 8, { id = 'mb12-chat', texts = [] } = {}) {
    host.chatId = id;
    host.chat = [message(0, 'Hale waits at the gatehouse of Elerian Keep.')];
    for (let r = 1; r <= replies; r++) host.chat.push(message(2 * r - 1, `I ask about turn ${r}.`, true), message(2 * r, texts[r - 1] || `Reply ${r}: the column rides on toward Saltmar.`));
    host.chatMetadata = { [F.MEMORY]: { v: 1, seq: 0, log: [], imported: true } };
    const store = S.createStore({ chat: () => host.chat, meta: () => host.chatMetadata, chatId: () => host.getCurrentChatId(), save: async () => {}, now: () => (clock += 1000) });
    store.marks();
    return store;
}
const reply = r => 2 * r;
const view = () => F.fold(host.chat, host.chatMetadata, { cache: false });
const io = () => ({ load: async name => structuredClone(books.get(name) || null), save: async (name, data) => { books.set(name, structuredClone(data)); }, names: () => [...books.keys()], now: () => (clock += 1000) });
const fileRecord = (store, index, record) => store.recordOnReply(index, [{ op: 'add', record: { status: 'current', importance: 6, ...record }, origin: { type: 'capture', route: 'desktop' } }]);

/** File a chapter record over replies from..to (chat indices) with seeds, as the chapter call does. */
async function closeChapter(store, from, to, seeds, { title = 'The road to Saltmar', people = ['Hale', 'Ser Marten Drey'], places = ['Saltmar'] } = {}) {
    const answer = { evidence: [{ message: F.storedMark(host.chat[from]), quote: String(host.chat[from].mes).slice(0, 30) }], title, summary: 'Hale rode to Saltmar. '.repeat(40), people, places, event_seeds: seeds };
    const record = SF.chapterRecord(answer, { chat: host.chat, from, to });
    await store.record([{ op: 'add', record, origin: { type: 'chapter', route: 'desktop' }, anchor: { mark: record.to }, reason: 'Closed in the test.' }]);
    return record;
}

// ---------------------------------------------------------------- the mock

let mock = null;
const setMode = value => fs.writeFileSync(MODE, JSON.stringify(value));
const mockRows = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
async function viaMock({ system, user, schema }) {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'mock-writer', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: schema.name, schema: schema.value } } }) });
    const json = await res.json();
    return { ok: true, value: JSON.parse(json.choices[0].message.content), route: 'desktop', model: 'mock-writer' };
}
before(async () => {
    setMode({});
    mock = spawn(process.execPath, [path.join(here, 'mock.js')], { env: { ...process.env, RI_MOCK_PORT: String(PORT), RI_MOCK_MODE: MODE, RI_MOCK_LOG: LOG }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/v1/models`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
    throw new Error('The mock did not start.');
});
after(() => {
    mock?.kill();
    if (fs.existsSync(DOCS) && process.env.RI_WRITE_EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, 'behavior-node.json'), JSON.stringify(out, null, 1)); }
});

// ---------------------------------------------------------------- 1. kinds

test('a third-party book with chance, inclusion groups and cooldowns is a behavior book on import; its kind can be changed', async () => {
    const data = fixture();
    assert.equal(BB.bookKind('Story events and styles', data), 'behavior');
    assert.equal(BB.bookKind('Plain', { entries: { 0: { ...BW.ENTRY_DEFAULTS, uid: 0, key: ['Saltmar'], content: 'Saltmar is a fort.' } } }), 'reference');
    books.set('Story events and styles', data);
    books.set('Plain', { entries: { 0: { ...BW.ENTRY_DEFAULTS, uid: 0, key: ['Saltmar'], content: 'Saltmar is a fort.' } } });
    let listed = await BB.listBooks({ names: ['Story events and styles', 'Plain'] });
    assert.deepEqual(listed.map(b => [b.name, b.kind]), [['Story events and styles', 'behavior'], ['Plain', 'reference']]);
    assert.ok(listed[0].traits.groups >= 7 && listed[0].traits.timing >= 3 && listed[0].traits.chance >= 4);
    await BB.setBookKind('Plain', 'behavior');
    listed = await BB.listBooks({ names: ['Plain'] });
    assert.equal(listed[0].kind, 'behavior');
    assert.equal(host.extensionSettings.roleplay_instructions.recall?.books?.Plain, false, 'a behavior book is not managed by recall');
    await BB.setBookKind('Plain', '');
    assert.equal((await BB.listBooks({ names: ['Plain'] }))[0].kind, 'reference', 'clearing the kind returns to what its entries use');
    assert.deepEqual(BB.foreignParts(books.get('Story events and styles')), [], 'nothing of the extension is stored in the book');
    out.checks.kinds = listed;
});

// ---------------------------------------------------------------- 2. entries the extension creates

test('entries the extension creates: event, style and chance fields, at depth 1 with the system role', () => {
    const ev = BB.entryFields('event', { title: 'Courier', content: 'A courier from Valen arrives asking for Hale.', keys: ['Valen'] });
    assert.deepEqual([ev.useProbability, ev.probability, ev.group, ev.cooldown, ev.constant, ev.key], [true, 10, 'Story events', 10, false, ['Valen']]);
    const anywhere = BB.entryFields('event', { title: 'Storm', content: 'A storm breaks.', keys: [] });
    assert.equal(anywhere.constant, true, 'an event that names no place or person is Constant');
    const style = BB.entryFields('style', { title: 'Terse', content: 'Short sentences.', weight: 60 });
    assert.deepEqual([style.constant, style.group, style.groupWeight, style.useProbability], [true, 'Style', 60, false]);
    const chance = BB.entryFields('chance', { title: 'Complication', content: 'A complication arises.', chance: 30, group: 'Complications' });
    assert.deepEqual([chance.useProbability, chance.probability, chance.group], [true, 30, 'Complications']);
    assert.equal(BB.entryFields('chance', { content: 'x', chance: 0 }).probability, BB.CHANCE_DEFAULT);
    for (const e of [ev, anywhere, style, chance]) {
        assert.deepEqual([e.position, e.depth, e.role], [4, 1, 0], 'depth 1, system role');
        assert.deepEqual(Object.keys(e).filter(k => !BW.ST_FIELDS.has(k)), [], 'only SillyTavern fields');
    }
});

// ---------------------------------------------------------------- 3. export

test('export holds only SillyTavern fields and round-trips byte-identical apart from logged additions', async () => {
    const name = 'Story events and styles';
    books.set(name, fixture());
    const store = freshChat(8);
    const stored = JSON.stringify(books.get(name));
    assert.equal(BB.exportText(books.get(name)), stored, 'exporting the imported book writes what SillyTavern stored');
    await fileRecord(store, reply(2), { id: 'p-valen', kind: 'place', subject: 'Valen', text: 'Valen is a port city east of Saltmar.' });
    const ch = await closeChapter(store, 1, reply(4), ['A courier from Valen arrives with a sealed letter for Hale.']);
    const result = view();
    const chapter = result.byId.get(ch.id);
    const known = ES.knownNames(result.current, ['Heather', 'Hale of Verath']);
    const planned = ES.seedItems(chapter, { known, entries: Object.values(books.get(name).entries) });
    const log = A.additionsLog(host.chatMetadata);
    const applied = ES.applySeeds(name, books.get(name), planned.items, { chapter, log, at: clock });
    log.push(...applied.rows);
    books.set(name, applied.data);
    const exported = JSON.parse(BB.exportText(books.get(name)));
    assert.deepEqual(BB.foreignParts(exported), [], 'the export holds only SillyTavern fields');
    assert.equal(Object.keys(exported.entries).length, 13, 'the seed entry is a plain entry in the export');
    const back = A.withoutAdditions(exported, log.filter(r => r.book === name));
    assert.equal(JSON.stringify(back), stored, 'taking back the logged addition gives the stored book byte for byte');
    // a Windows checkout may turn the fixture's line ends into CRLF; the file as committed uses LF
    assert.equal(JSON.stringify(back, null, 4), fixtureText.replace(/\r\n/g, '\n').trimEnd(), 'and the imported file byte for byte');
    // a book that carries fields of another tool: the export leaves them out
    const marked = structuredClone(books.get(name));
    marked.extensions = { ri_generated: { v: 1 } };
    marked.entries[0].ri_origin = 'story-event';
    assert.deepEqual(BB.foreignParts(marked), ['book field extensions', 'entry 0 field ri_origin']);
    assert.deepEqual(BB.foreignParts(JSON.parse(BB.exportText(marked))), []);
    out.checks.export = { entries: Object.keys(exported.entries).length, bytes: BB.exportText(books.get(name)).length };
});

// ---------------------------------------------------------------- 4. fired entries per swipe, and capture

test('the recorder keeps what SillyTavern reported for the generation, and stores it per swipe', () => {
    const book = fixture();
    const activated = [book.entries[0], book.entries[3], book.entries[11]].map(e => ({ ...e, world: 'Story events and styles' }));
    const rec = FE.createFiredRecorder();
    rec.started('normal', {}, true);
    rec.activated(activated);
    assert.equal(rec.take(), null, 'a dry run is not followed');
    rec.started('normal', {}, false);
    rec.scanDone({ activated: { entries: new Map(activated.slice(0, 1).map(e => [`${e.world}.${e.uid}`, e])) } });
    rec.started('quiet', { quiet_prompt: 'x' }, false);
    rec.activated([{ ...book.entries[1], world: 'Story events and styles' }]);
    rec.ended();
    rec.activated(activated);
    const taken = rec.take();
    assert.deepEqual(taken.entries.map(e => [e.uid, e.behavior]), [['0', true], ['3', true], ['11', false]], 'a quiet generation adds nothing; a plain entry is marked as such');
    assert.ok(taken.entries.every(e => !('content' in e)), 'no entry text is stored');
    freshChat(2);
    const m = host.chat[reply(2)];
    FE.storeFired(m, taken.entries);
    assert.deepEqual(FE.firedOf(m).map(e => e.uid), ['0', '3', '11']);
    assert.deepEqual(m.swipe_info[0].extra[FE.FIRED].entries.map(e => e.uid), ['0', '3', '11'], 'the swipe slot holds the same list');
    // SillyTavern copies extra into a new swipe; the copy does not count for it
    m.swipes.push('Another version.'); m.swipe_info.push({ extra: structuredClone(m.extra) }); m.swipe_id = 1; m.mes = 'Another version.';
    assert.deepEqual(FE.firedOf(m), [], 'a list copied from another swipe does not count');
    FE.storeFired(m, [taken.entries[1]]);
    assert.deepEqual(FE.firedOf(m).map(e => e.uid), ['3']);
    m.swipe_id = 0; m.extra = structuredClone(m.swipe_info[0].extra); m.mes = m.swipes[0];
    assert.deepEqual(FE.firedOf(m).map(e => e.uid), ['0', '3', '11'], 'swiping back shows that swipe\'s own list');
    FE.storeFired(m, [{ book: 'Story events and styles', uid: '5', title: 'Complication', behavior: true }], { append: true });
    assert.deepEqual(FE.firedOf(m).map(e => e.uid), ['0', '3', '11', '5'], 'a continued reply adds to its list');
    // a dry run that counts tokens scans with its own rolls and sends only WORLDINFO_SCAN_DONE: the real report wins
    const as = uids => uids.map(u => ({ ...book.entries[u], world: 'Story events and styles' }));
    rec.started('normal', {}, false);
    rec.scanDone({ activated: { entries: new Map(as([2, 7]).map(e => [e.uid, e])) } });
    rec.activated(as([4, 9]));
    rec.scanDone({ activated: { entries: new Map(as([5]).map(e => [e.uid, e])) } });
    assert.deepEqual(rec.take().entries.map(e => e.uid), ['4', '9'], 'WORLD_INFO_ACTIVATED is the list kept');
    // a host that sends only WORLDINFO_SCAN_DONE: the last pass of the last scan
    rec.started('normal', {}, false);
    rec.scanDone({ activated: { entries: new Map(as([3]).map(e => [e.uid, e])) } });
    rec.scanDone({ activated: { entries: new Map(as([3, 7]).map(e => [e.uid, e])) } });
    assert.deepEqual(rec.take().entries.map(e => e.uid), ['3', '7']);
    assert.deepEqual(FE.firedForCapture(m.extra.roleplay_instructions, m), ['Event: rival courier', 'Style: terse', 'Complication'], 'capture is told the behavior entries');
});

test('a host that sends no report of fired entries falls back to the final prompt', () => {
    const book = fixture();
    const lore = { chatLore: Object.values(book.entries).map(e => ({ ...e, world: 'Story events and styles' })), globalLore: [], characterLore: [], personaLore: [] };
    const prompt = `System.\n${book.entries[3].content}\nChat.\n${book.entries[0].content}\nUser.`;
    const rec = FE.createFiredRecorder();
    rec.started('normal', {}, false);
    rec.loaded(lore);
    rec.scanDone({ activated: { entries: new Map() } });
    rec.prompt(prompt);
    const taken = rec.take();
    assert.deepEqual(taken.entries.map(e => [e.uid, e.from]), [['0', 'prompt'], ['3', 'prompt']], 'the behavior entries whose text is in the request');
    assert.ok(!taken.entries.some(e => e.uid === '11'), 'a plain entry is not a behavior entry');
    // with a report, the prompt is not read
    rec.started('normal', {}, false);
    rec.loaded(lore);
    rec.activated([{ ...book.entries[4], world: 'Story events and styles' }]);
    rec.prompt(prompt);
    assert.deepEqual(rec.take().entries.map(e => [e.uid, e.from]), [['4', 'report']]);
});

test('with a behavior entry in the scan, the extension\'s own entries do not recurse into your book', () => {
    const book = fixture();
    const own = { uid: 0, world: 'RI Tracker, chat', constant: true, content: 'Scene: Hale at the gate.', preventRecursion: false };
    const isOwn = e => e.world.startsWith('RI Tracker');
    const lore = { chatLore: [own, ...Object.values(book.entries).map(e => ({ ...e, world: 'Story events and styles' }))], globalLore: [], characterLore: [], personaLore: [] };
    assert.equal(FE.sealOwnEntries(lore, { isOwn }), 1);
    assert.equal(own.preventRecursion, true, 'the tracker entry no longer feeds the recursion scan');
    assert.ok(lore.chatLore.slice(1).every(e => e.preventRecursion === false), 'your entries keep their own settings');
    const plain = { uid: 0, world: 'RI Tracker, chat', constant: true, content: 'Scene.', preventRecursion: false };
    assert.equal(FE.sealOwnEntries({ chatLore: [plain, { ...BW.ENTRY_DEFAULTS, uid: 1, world: 'Plain', key: ['Hale'] }] }, { isOwn }), 0, 'without a behavior entry nothing changes');
});

test('the fired ids reach capture; a reply that acts on the event files it as a Thread', async () => {
    const store = freshChat(2, { texts: ['A courier rode in from Valen with a sealed letter. Hale broke the seal at the gate.', 'Reply 2.'] });
    const m = host.chat[reply(1)];
    FE.storeFired(m, [{ book: 'Story events and styles', uid: '0', title: 'Event: rival courier', behavior: true }]);
    setMode({ capture: { decisions: { durable_change: true, scene_ended: false, out_of_character: false }, ops: [{ op: 'add', id: 'courier-letter', target: [], kind: 'thread', thread_type: 'Open', subject: 'Courier from Valen', text: 'A courier from Valen brought Hale a sealed letter.', quote: 'A courier rode in from Valen with a sealed letter' }], state: {} } });
    const before = mockRows().length;
    const res = await CA.runCapture([reply(1)], { runChainFn: viaMock, context: host, store, settingsValue: { memory: {} } });
    assert.ok(res.ok, res.reason);
    const row = mockRows().slice(before).find(r => r.kind === 'capture');
    const sent = row.messages.map(x => x.content).join('\n');
    assert.match(sent, /Behavior entries that fired: Event: rival courier/, 'the capture request names the event that fired');
    const thread = view().byId.get('courier-letter');
    assert.equal(thread?.kind, 'thread', 'the event is filed as a Thread');
    assert.equal(thread.threadType, 'Open');
    out.checks.capture = { line: (sent.match(/Behavior entries that fired: [^\n]*/) || [''])[0], thread: thread.text };
});

// ---------------------------------------------------------------- 5. story event seeds

test('every seed names only people, places and threads in the records; keys come from places and people; resembling seeds drop', async () => {
    const store = freshChat(8);
    await fileRecord(store, reply(1), { id: 'p-marten', kind: 'person', subject: 'Ser Marten Drey', aliases: ['Marten', 'the rear knight'], text: 'Ser Marten Drey rides at the rear.' });
    await fileRecord(store, reply(1), { id: 'pl-saltmar', kind: 'place', subject: 'Saltmar', text: 'Saltmar is a fort on a tidal marsh.' });
    await fileRecord(store, reply(2), { id: 't-toll', kind: 'thread', subject: 'Toll at the ford', threadType: 'Pending', text: 'The toll at the ford is due at dawn.' });
    const ch = await closeChapter(store, 1, reply(4), [
        'Ser Marten Drey brings word from Saltmar that the toll at the ford has doubled.',
        'A rider named Corvane Ashgrove arrives from Quillhaven.',
        'Rumors from Saltmar reach Hale at the gate.',
        'A fourth seed past the limit about Saltmar.',
    ]);
    const result = view();
    const known = ES.knownNames(result.current, ['Heather', 'Hale of Verath', 'Hale']);
    const g = ES.groundSeed('Ser Marten Drey brings word from Saltmar that the toll at the ford has doubled.', known);
    assert.ok(g.ok);
    assert.deepEqual(g.keys, ['Ser Marten Drey', 'Saltmar'], 'keys are the person and the place; the longer name wins');
    const invented = ES.groundSeed('A rider named Corvane Ashgrove arrives from Quillhaven.', known);
    assert.deepEqual([invented.ok, invented.unknown], [false, ['Corvane', 'Ashgrove', 'Quillhaven']]);
    assert.deepEqual(ES.groundSeed('Rumors from Saltmar reach Hale at the gate.', known).keys, ['Saltmar'], 'the cast is known but not a key');
    const planned = ES.seedItems(result.byId.get(ch.id), { known, entries: [] });
    assert.equal(planned.items.length, 2, 'two grounded seeds, the invented one dropped, the fourth past the limit');
    assert.match(planned.dropped[0].why, /Corvane/);
    const again = ES.seedItems(result.byId.get(ch.id), { known, entries: planned.items.map(i => ({ key: i.keys, content: i.content })) });
    assert.equal(again.items.length, 0, 'a seed that resembles an entry already in the book is dropped');
    assert.ok(again.dropped.every(d => d.why === 'names no one in the records: Corvane, Ashgrove, Quillhaven' || /resembles/.test(d.why)));
    const near = ES.seedItems({ seeds: ['Ser Marten Drey brings word from Saltmar that the toll at the ford has tripled.'] }, { known, entries: planned.items.map(i => ({ key: i.keys, content: i.content })) });
    assert.equal(near.items.length, 0, 'near wording with the same keys (Dice 0.85 or more) drops');
    const otherKeys = ES.seedItems({ seeds: ['Ser Marten Drey brings word that the toll at the ford has doubled.'] }, { known, entries: planned.items.map(i => ({ key: i.keys, content: i.content })) });
    assert.equal(otherKeys.items.length, 1, 'a similar text with other keys is kept');
    out.checks.grounding = { kept: planned.items.map(i => ({ content: i.content, keys: i.keys })), dropped: planned.dropped };
});

test('seeds reach a book the extension made directly, a book of yours only at Keywords, lines and entries, and the review list otherwise', async () => {
    const seeds = ['Ser Marten Drey brings word from Saltmar that the toll has doubled.'];
    const setup = async () => {
        const store = freshChat(8);
        await fileRecord(store, reply(1), { id: 'p-marten', kind: 'person', subject: 'Ser Marten Drey', aliases: ['Marten'], text: 'Ser Marten Drey rides at the rear.' });
        await fileRecord(store, reply(1), { id: 'pl-saltmar', kind: 'place', subject: 'Saltmar', text: 'Saltmar is a fort on a tidal marsh.' });
        await closeChapter(store, 1, reply(4), seeds);
        return store;
    };
    const st = host.extensionSettings.roleplay_instructions;
    // 1. a book the extension made
    let store = await setup();
    books.delete('RI Story events');
    await BB.createBehaviorBook('RI Story events', { context: host });
    assert.equal(BB.receiveBookOf(host.chatMetadata), 'RI Story events', 'a new behavior book receives story events when none is chosen');
    assert.equal(st.memory.bookAdditions['RI Story events'], 'off');
    assert.deepEqual(books.get('RI Story events'), { entries: {} }, 'nothing of ours in the new book');
    let r = await ES.seedChapters({ context: host, store, io: io() });
    assert.deepEqual([r.route, r.added.length, r.review.length], ['direct', 1, 0]);
    const made = books.get('RI Story events').entries[0];
    assert.deepEqual([made.probability, made.group, made.cooldown, made.depth, made.role, made.position, made.key], [10, 'Story events', 10, 1, 0, 4, ['Ser Marten Drey', 'Saltmar']]);
    assert.equal(st.memory.behavior.oneShot['RI Story events#0'], true, 'a seed event plays once');
    let rows = U.historyRows(host.chat, host.chatMetadata, { jobs: ['additions'] });
    assert.equal(rows[0].label, 'Entry added: RI Story events');
    assert.ok(rows[0].undo, 'with Undo in History');
    r = await ES.seedChapters({ context: host, store, io: io() });
    assert.equal(r.chapters, 0, 'a chapter is seeded once');
    // Undo from History removes the entry
    await A.undoAddition(rows[0].undo, { io: { loadBook: async n => structuredClone(books.get(n)), saveBook: async (n, d) => books.set(n, structuredClone(d)), now: () => clock }, meta: host.chatMetadata, chat: host.chat });
    assert.deepEqual(books.get('RI Story events').entries, {}, 'Undo removes the entry');
    // 2. a book of yours at Keywords, lines and entries
    store = await setup();
    books.set('My events', { entries: {} });
    await U.setBookLevel('My events', 'full');
    BB.chatBehavior(host.chatMetadata).receive = 'My events';
    r = await ES.seedChapters({ context: host, store, io: io() });
    assert.deepEqual([r.route, r.added.length], ['entry', 1]);
    assert.equal(Object.keys(books.get('My events').entries).length, 1);
    // 3. a book of yours at Keywords only: the review list
    store = await setup();
    books.set('My events', { entries: {} });
    await U.setBookLevel('My events', 'keywords');
    BB.chatBehavior(host.chatMetadata).receive = 'My events';
    r = await ES.seedChapters({ context: host, store, io: io() });
    assert.deepEqual([r.route, r.added.length, r.review.length], ['review', 0, 1]);
    assert.deepEqual(books.get('My events').entries, {}, 'your book is not changed');
    const list = FL.reviewList(host.chat, host.chatMetadata, view());
    const flag = list.find(f => f.kind === 'event-seed');
    assert.deepEqual(flag.actions, ['add-to-book', 'dismiss']);
    assert.equal(FL.ACTION_LABELS['add-to-book'], 'Add to book');
    await ES.resolveSeed(flag, 'add-to-book', { book: 'My events', context: host, store, io: io() });
    assert.equal(Object.keys(books.get('My events').entries).length, 1, 'Add to book adds it');
    assert.ok(!FL.reviewList(host.chat, host.chatMetadata, view()).some(f => f.kind === 'event-seed'), 'and takes it off the list');
    rows = U.historyRows(host.chat, host.chatMetadata, { jobs: ['additions'] });
    assert.ok(rows.some(x => x.label === 'Entry added: My events' && x.undo), 'with Undo in History');
    // 4. no book chosen: the review list, then Dismiss
    store = await setup();
    BB.chatBehavior(host.chatMetadata).receive = '';
    r = await ES.seedChapters({ context: host, store, io: io() });
    assert.deepEqual([r.route, r.review.length], ['review', 1]);
    const waiting = FL.reviewList(host.chat, host.chatMetadata, view()).find(f => f.kind === 'event-seed');
    await FL.resolveFlag(store, waiting, 'dismiss');
    assert.ok(!FL.reviewList(host.chat, host.chatMetadata, view()).some(f => f.kind === 'event-seed'), 'Dismiss takes it off the list');
    out.checks.routes = 'direct, entry, review';
});

test('a chapter removed by a delete or a branch removes the event entries it created, unless you edited them', async () => {
    const name = 'RI Story events';
    const run = async () => {
        const store = freshChat(8);
        await fileRecord(store, reply(1), { id: 'pl-saltmar', kind: 'place', subject: 'Saltmar', text: 'Saltmar is a fort on a tidal marsh.' });
        await fileRecord(store, reply(1), { id: 'p-marten', kind: 'person', subject: 'Ser Marten Drey', text: 'Ser Marten Drey rides at the rear.' });
        await closeChapter(store, 1, reply(3), ['Ser Marten Drey brings word from Saltmar that the toll has doubled.', 'A boat from Saltmar runs aground on the marsh.']);
        await closeChapter(store, reply(3) + 1, reply(6), ['Ser Marten Drey loses his horse at the Saltmar causeway.'], { title: 'The causeway' });
        books.set(name, { entries: {} });
        BB.chatBehavior(host.chatMetadata).receive = name;
        const r = await ES.seedChapters({ context: host, store, io: io() });
        assert.equal(r.added.length, 3);
        return store;
    };
    // delete: the first chapter's last message goes
    await run();
    host.chat.splice(reply(3), 1);
    let rec = await ES.reconcileSeeds({ context: host, io: io() });
    assert.equal(rec.removed.length, 2, 'the deleted chapter\'s two entries are removed');
    assert.deepEqual(Object.values(books.get(name).entries).map(e => e.content), ['Ser Marten Drey loses his horse at the Saltmar causeway.'], 'the other chapter\'s entry stays');
    // an entry you edited stays
    await run();
    books.get(name).entries[0].content += ' Hale sends a rider after it.';
    host.chat.splice(reply(3), 1);
    rec = await ES.reconcileSeeds({ context: host, io: io() });
    assert.deepEqual([rec.removed.length, rec.kept.length], [1, 1]);
    assert.ok(books.get(name).entries[0], 'your edited entry stays');
    assert.equal(A.additionsLog(host.chatMetadata).find(r => r.uid === 0).state, 'yours');
    // a branch cut before the second chapter: the chat keeps the messages up to reply 4
    await run();
    host.chat = host.chat.slice(0, reply(4) + 1);
    rec = await ES.reconcileSeeds({ context: host, io: io() });
    assert.equal(rec.removed.length, 1, 'the chapter past the branch point takes its entry with it');
    assert.equal(Object.keys(books.get(name).entries).length, 2);
    // a chapter reverted (its record leaves the fold while its message stays)
    const store = await run();
    const chapter = ES.chaptersIn(view())[0].r;
    await store.revert(chapter.versions[0].entry, 'Test revert.');
    rec = await ES.reconcileSeeds({ context: host, io: io() });
    assert.equal(rec.removed.length, 2, 'a chapter that is no longer in force takes its entries with it');
    // a review flag leaves with its chapter
    const s2 = freshChat(8);
    await fileRecord(s2, reply(1), { id: 'pl-saltmar', kind: 'place', subject: 'Saltmar', text: 'Saltmar is a fort.' });
    await closeChapter(s2, 1, reply(3), ['A boat from Saltmar runs aground on the marsh.']);
    BB.chatBehavior(host.chatMetadata).receive = '';
    await ES.seedChapters({ context: host, store: s2, io: io() });
    assert.equal(FL.reviewList(host.chat, host.chatMetadata, view()).filter(f => f.kind === 'event-seed').length, 1);
    host.chat.splice(reply(3), 1);
    assert.equal(FL.reviewList(host.chat, host.chatMetadata, view()).filter(f => f.kind === 'event-seed').length, 0, 'a waiting seed leaves the list with its chapter');
    out.checks.chapterRemoval = 'delete, edit kept, branch, revert, review flag';
});

// ---------------------------------------------------------------- 6. one-shot events

test('a one-shot event the extension created is disabled after it plays, with Undo; your own entries are not touched', async () => {
    const name = 'RI Story events';
    books.set(name, { entries: {} });
    const added = BB.addEntries(books.get(name), [
        { kind: 'event', title: 'Courier', content: 'A courier from Valen arrives with a letter for Hale.', keys: ['Valen'] },
        { kind: 'event', title: 'Toll', content: 'A toll collector stops the column at the ford.', keys: ['ford'] },
    ]);
    books.set(name, added.data);
    books.set('Mine', { entries: { 0: { ...BW.ENTRY_DEFAULTS, uid: 0, key: ['Valen'], content: 'Valen is a port.', useProbability: true, probability: 50 } } });
    const st = host.extensionSettings.roleplay_instructions.memory.behavior;
    st.oneShot = { [`${name}#0`]: true, [`${name}#1`]: true };
    freshChat(3, { texts: ['A rider from Valen hands Hale a letter at the gate.', 'The column waits at the gate.', 'Reply 3.'] });
    const fired = [{ book: name, uid: '0', title: 'Courier', behavior: true }, { book: name, uid: '1', title: 'Toll', behavior: true }, { book: 'Mine', uid: '0', title: 'Valen', behavior: true }];
    FE.storeFired(host.chat[reply(1)], fired);
    FE.storeFired(host.chat[reply(2)], [fired[1]]);
    const rows = await FE.settleOneShots(reply(1), { context: host, io: io(), filed: ['A rider from Valen brought Hale a letter.'] });
    assert.deepEqual(rows.map(r => r.uid), ['0'], 'only the event the reply acted on, and only the extension\'s');
    assert.equal(books.get(name).entries[0].disable, true);
    assert.equal(books.get(name).entries[1].disable, false, 'the toll event the reply did not act on stays enabled');
    assert.equal(books.get('Mine').entries[0].disable, false, 'your entry keeps its switch');
    assert.deepEqual(await FE.settleOneShots(reply(2), { context: host, io: io() }), [], 'not acted on: nothing changes');
    const hist = FE.oneShotRows(host.chat, host.chatMetadata);
    assert.ok(hist[0].undo && /Event played once/.test(hist[0].label));
    await FE.undoOneShot(hist[0].undo, { context: host, io: io() });
    assert.equal(books.get(name).entries[0].disable, false, 'Undo enables it again');
    // played again, then its reply is swiped away: enabled again
    await FE.settleOneShots(reply(1), { context: host, io: io(), filed: [] });
    assert.equal(books.get(name).entries[0].disable, true);
    const m = host.chat[reply(1)];
    m.swipes.push('Another version.'); m.swipe_info.push({ extra: {} }); m.swipe_id = 1; m.mes = 'Another version.'; m.extra = {};
    const back = await FE.reconcileOneShots({ context: host, io: io() });
    assert.equal(back.enabled.length, 1);
    assert.equal(books.get(name).entries[0].disable, false, 'a swipe away from the reply enables it again');
    out.checks.oneShot = FE.oneShotRows(host.chat, host.chatMetadata).map(r => [r.label, r.note]);
});

// ---------------------------------------------------------------- 7. New behavior book and Draft entries

test('Draft entries from a description: one Writer call through the mock, reviewed before saving, at depth 1', async () => {
    freshChat(2);
    setMode({ behaviorDraft: { entries: [
        { kind: 'event', title: 'Rival courier', content: 'A rival courier from Valen turns up asking for Hale.', people: [], places: ['Valen'], once: true },
        { kind: 'style', title: 'Terse', content: 'Write in short plain sentences.', weight: 70 },
        { kind: 'chance', title: 'Complication', content: 'A complication arises on the road.', chance: 20, group: '' },
    ] } });
    const before = mockRows().length;
    const draft = await BB.draftEntries('a rival courier turns up now and then', { runChainFn: viaMock, context: host });
    const calls = mockRows().slice(before);
    assert.equal(calls.length, 1, 'one Writer call');
    assert.equal(calls[0].kind, 'behavior');
    assert.ok(draft.ok && draft.items.length === 3 && !draft.problems.length);
    assert.deepEqual(draft.preview.map(e => [e.depth, e.role, e.position]), [[1, 0, 4], [1, 0, 4], [1, 0, 4]]);
    books.set('Drafts', { entries: {} });
    assert.deepEqual(books.get('Drafts').entries, {}, 'nothing is saved before review');
    const kept = draft.items.filter(i => i.kind !== 'chance');
    const uids = await BB.saveDrafts('Drafts', kept);
    assert.deepEqual(uids, [0, 1]);
    assert.deepEqual(Object.values(books.get('Drafts').entries).map(e => [e.comment, e.group, e.depth, e.role]), [['Rival courier', 'Story events', 1, 0], ['Terse', 'Style', 1, 0]]);
    assert.equal(host.extensionSettings.roleplay_instructions.memory.behavior.oneShot['Drafts#0'], true, 'an event drafted as once plays once');
    // a bad answer gets one repair retry with the problem sent back
    setMode({ behaviorDraft: { entries: [{ kind: 'event', title: 'x', content: '' }] } });
    const n = mockRows().length;
    const bad = await BB.draftEntries('something', { runChainFn: viaMock, context: host });
    const retry = mockRows().slice(n);
    assert.equal(retry.length, 2, 'one repair retry');
    assert.match(retry[1].messages.map(x => x.content).join('\n'), /could not be used: Entry 1 has no content/);
    assert.equal(bad.items.length, 0);
    out.checks.draft = draft.preview.map(e => ({ comment: e.comment, group: e.group, probability: e.probability, depth: e.depth, role: e.role }));
});

// ---------------------------------------------------------------- 8. the section 13 row on the MB11 harness

test('section 13, Behavior books: the same entries fire with the extension on and off over 200 seeded turns', { skip: !fs.existsSync(HARNESS) && 'docs/ is not present' }, () => {
    const require = createRequire(import.meta.url);
    const B = require(path.join(HARNESS, 'ref', 'behavior.js'));
    const { rng } = require(path.join(HARNESS, 'ref', 'util.js'));
    const L = require(path.join(HARNESS, 'scen_lib.js'));
    const story = L.loadStory();
    const texts = Array.from({ length: 200 }, (_, i) => { const t = story.turns[i % story.turns.length]; return `${t.player} ${t.prose}`; });
    const run = (extensionOn, seed) => {
        const book = fixture();
        const state = { lastFired: {}, stickyUntil: {} };
        const rand = rng(seed);
        const chat = [];
        const fired = [];
        const rec = extensionOn ? FE.createFiredRecorder() : null;
        for (let i = 0; i < 200; i++) {
            rec?.started('normal', {}, false);
            const ids = B.wiScan(book, { text: texts[i], turn: i }, state, rand);
            // SillyTavern reports the activated entries; the extension reads the report and nothing else
            rec?.activated(ids.map(u => ({ ...book.entries[u], world: 'Story events and styles' })));
            const m = message(i, texts[i]);
            chat.push(m);
            const taken = rec?.take();
            if (taken) FE.storeFired(m, taken.entries);
            fired.push(ids);
        }
        return { fired, stored: chat.filter(m => m.extra[FE.FIRED]).map(m => FE.firedOf(m).map(e => Number(e.uid))) };
    };
    const results = [];
    for (const seed of [7, 1234]) {
        const on = run(true, seed), off = run(false, seed);
        assert.deepEqual(on.fired, off.fired, `seed ${seed}: the same entries fire`);
        assert.deepEqual(on.stored, on.fired, `seed ${seed}: each reply stores exactly the ids that fired`);
        assert.equal(off.stored.length, 0);
        const events = on.fired.map(f => f.filter(u => u <= 2).length);
        assert.ok(Math.max(...events) <= 1, 'at most one story event a turn');
        results.push({ seed, firings: on.fired.flat().length, stored: on.stored.length });
    }
    out.checks.harness = results;
});
