// MB2: a chat from the M1a run imports into chat data (memory DESIGN 8.5), and the Story World page and the request then
// read the same records. Runs the extension's own modules in Node on a host that serves the rebuilt chat and its book.
//   node --test tests/t_memory_import.js
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildM1aChat, KEY } from './fixtures/mb2/m1a-chat.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'MB2');
const fixture = buildM1aChat();
const saved = { books: {}, chatSaves: 0 };
const host = {
    extensionSettings: { [KEY]: { sets: { [fixture.bookName]: { kind: 'world' } } } },
    chatMetadata: structuredClone(fixture.chatMetadata),
    chat: structuredClone(fixture.messages),
    characters: [{ name: 'Hale of Verath', avatar: 'Hale of Verath.png' }], characterId: 0, name1: 'User', name2: 'Hale of Verath',
    getCurrentChatId: () => fixture.chatId,
    loadWorldInfo: async name => structuredClone(saved.books[name] ?? (name === fixture.bookName ? fixture.book : null)),
    saveWorldInfo: async (name, data) => { saved.books[name] = structuredClone(data); },
    saveChat: async () => { saved.chatSaves += 1; },
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };
const ls = new Map();
globalThis.localStorage = { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) };

const R = await import('../src/records.js');
const V = await import('../src/v10.js');
const WF = await import('../src/worldflow.js');
const W = await import('../src/world.js');
const I = await import('../src/memory/import.js');
const F = await import('../src/memory/fold.js');

const sameRows = rows => rows.map(row => ({ ...row, isNew: undefined }));
const out = { suite: 'tests/t_memory_import.js', run: new Date().toISOString(), fixture: 'tests/fixtures/mb2 (copies of memory/evidence/m1a, after turn 32)' };

test('a chat from the M1a run imports its records, chapters and staged changes, and the page and the request read the same records', async () => {
    assert.equal(W.chatWorld(), fixture.bookName);
    // Today's view: the page lists the effective book (book plus staged changes); the request reads the same rows.
    const pageBefore = R.entries.list(await R.entries.effective(fixture.bookName), fixture.bookName);
    const requestBefore = await V.rowsForWorld('normal');
    const swipeRequestBefore = await V.rowsForWorld('swipe');
    const recordsBefore = await R.listRecords(Object.keys(R.RECORD_KINDS));
    const prepBefore = await WF.prepareWorld('normal', 33, { memory: true });
    const bookBefore = JSON.stringify(await host.loadWorldInfo(fixture.bookName));
    const stateBefore = JSON.stringify(host.chatMetadata[KEY]);
    assert.ok(pageBefore.length > 20 && recordsBefore.length > 10);
    let backups = 0;
    const result = await I.importOpenChat({ backup: async () => { backups += 1; return { name: 'backup.json' }; } });
    assert.ok(result.imported, JSON.stringify(result));
    assert.equal(backups, 1, 'the settings backup runs before the import');
    assert.ok(R.memoryActive());
    const c = result.counts;
    out.counts = c;
    assert.ok(c.records > 0 && c.chapters > 0 && c.staged > 0, JSON.stringify(c));
    // Nothing of today's data is changed or removed: the book and the chat state are byte-identical.
    assert.equal(JSON.stringify(await host.loadWorldInfo(fixture.bookName)), bookBefore);
    assert.equal(JSON.stringify(host.chatMetadata[KEY]), stateBefore);
    for (const [i, m] of host.chat.entries()) assert.equal(JSON.stringify(m.extra[KEY] ?? null), JSON.stringify(fixture.messages[i].extra[KEY] ?? null));
    // The staged changes sit on the replies whose swipes made them.
    const staged = host.chat.flatMap((m, i) => F.swipeEntries(m).filter(e => e.origin.route === 'staged change').map(() => i));
    assert.deepEqual([...new Set(staged)], [60, 64]);
    const kinds = new Set(F.fold(host.chat, host.chatMetadata).records.map(r => r.kind));
    out.kinds = [...kinds];
    for (const kind of ['fact', 'chapter', 'thread', 'person']) assert.ok(kinds.has(kind), `imported kind ${kind}`);

    // After the import: the page and the request read the fold, and both show what today's code showed.
    const pageAfter = R.entries.list(await R.entries.effective(fixture.bookName), fixture.bookName);
    const loaded = R.entries.list(await R.entries.load(fixture.bookName), fixture.bookName);
    const requestAfter = await V.rowsForWorld('normal');
    const swipeRequestAfter = await V.rowsForWorld('swipe');
    const recordsAfter = await R.listRecords(Object.keys(R.RECORD_KINDS));
    const prepAfter = await WF.prepareWorld('normal', 33, { memory: true });
    assert.deepEqual(sameRows(pageAfter), sameRows(pageBefore), 'the Story World page shows the same entries');
    assert.deepEqual(sameRows(loaded), sameRows(pageBefore), 'the page editor loads the same entries');
    assert.deepEqual(sameRows(requestAfter), sameRows(pageAfter), 'the request reads the same records as the page');
    assert.deepEqual(sameRows(requestAfter), sameRows(requestBefore), 'the request reads what it read before the import');
    assert.deepEqual(sameRows(swipeRequestAfter), sameRows(swipeRequestBefore), 'a swipe request leaves out the newest reply\'s staged changes, as before');
    assert.deepEqual(recordsAfter, recordsBefore, 'the record screens list the same records');
    assert.equal(prepAfter.notes?.text, prepBefore.notes?.text, 'the story notes sent with the next reply are the same text');
    out.page = { entries: pageAfter.length, records: recordsAfter.length, requestRows: requestAfter.length, notesChars: prepAfter.notes?.text?.length || 0 };
    out.bytes = F.memoryBytes(host.chat, host.chatMetadata);
});

test('after the import, a swipe of the newest staged reply takes back only its own changes', async () => {
    const i = 64;
    const m = host.chat[i];
    const before = R.entries.list(I.foldWorldData(), fixture.bookName);
    const own = F.swipeEntries(m).map(e => e.record?.id || e.target?.[0]);
    // SillyTavern: the shown extra goes to its slot, the new swipe starts from a clone, the text changes.
    m.swipe_info[0].extra = structuredClone(m.extra);
    m.swipes.push('Hale said nothing and rode on.');
    m.swipe_info.push({ send_date: new Date().toISOString(), extra: structuredClone(m.extra) });
    m.swipe_id = 1; m.mes = m.swipes[1];
    const after = R.entries.list(I.foldWorldData(), fixture.bookName);
    const changed = before.filter(row => JSON.stringify(row) !== JSON.stringify(after.find(x => x.uid === row.uid)));
    assert.ok(changed.length > 0);
    assert.ok(changed.every(row => own.includes(`u${row.uid}`)), 'every entry that changed is one reply 64 changed');
    // Back to the first swipe: the same entries as before.
    m.swipe_info[1].extra = structuredClone(m.extra); m.swipe_id = 0; m.mes = m.swipes[0]; m.extra = structuredClone(m.swipe_info[0].extra);
    assert.deepEqual(R.entries.list(I.foldWorldData(), fixture.bookName), before);
    out.swipe = { changedEntries: changed.length };
});

test('a record screen edit is saved to the book and filed as your edit, locked, with history after a reload', async () => {
    const id = fixture.bookName;
    const data = await R.entries.load(id);
    const list = R.entries.list(data, id);
    const target = list.find(row => row.kind === 'character') || list.find(row => !W.isStructuredWorldKind(row.kind));
    const before = structuredClone(data.entries[target.uid]);
    const draft = structuredClone(target);
    const key = Object.keys(draft.fields)[0];
    draft.fields[key] = `${draft.fields[key]} Edited on the Story World page.`.trim();
    draft.auto = false;
    R.entries.put(data, draft, id);
    await R.entries.save(id, data);
    await R.entries.changed(id, draft.uid, before, data.entries[draft.uid]);
    const book = saved.books[id];
    assert.match(JSON.stringify(book.entries[target.uid]), /Edited on the Story World page/);
    const shown = R.entries.list(await R.entries.effective(id), id).find(row => row.uid === target.uid);
    assert.match(shown.fields[key], /Edited on the Story World page/);
    const rec = F.fold(host.chat, host.chatMetadata).byId.get(`u${target.uid}`);
    assert.ok(rec.locked, 'your edit is locked');
    assert.equal(rec.versions.at(-1).origin.type, 'you');
    // A reload: the chat file round trip; history and revert still work.
    host.chat = JSON.parse(JSON.stringify(host.chat));
    host.chatMetadata = JSON.parse(JSON.stringify(host.chatMetadata));
    const versions = R.recordVersions({ uid: target.uid });
    assert.ok(versions.length >= 2 && versions[0].origin === 'import' && versions.some(v => v.origin === 'you'));
    const yours = versions.filter(v => v.origin === 'you' && v.op !== 'lock').at(-1);
    await R.revertChange(yours.entry);
    const back = R.entries.list(I.foldWorldData(), id).find(row => row.uid === target.uid);
    assert.doesNotMatch(back.fields[key], /Edited on the Story World page/);
    out.edit = { uid: target.uid, versions: versions.length };
});

// MB3 removed the follower of the update block; a change saved into the book (today's chapter writer, a record screen) is
// still filed as an entry by fileBookEdits.
test('a change saved into the book after the import becomes an entry', async () => {
    const id = fixture.bookName;
    const book = await host.loadWorldInfo(id);
    const entry = R.entries.blank(R.entries.reserve(book, id), 'thread');
    const uid = entry.uid;
    Object.assign(entry, { name: 'The salt mark question', fields: { ...entry.fields, open: 'Who cut the salt marks on the posts.' }, auto: true });
    W.writeWorldEntry(book, entry, id);
    await host.saveWorldInfo(id, book);
    await I.fileBookEdits();
    const row = R.entries.list(I.foldWorldData(), id).find(r => r.uid === uid);
    assert.equal(row?.name, 'The salt mark question');
    const rec = F.fold(host.chat, host.chatMetadata).byId.get(`u${uid}`);
    assert.equal(rec.kind, 'thread');
    assert.equal(rec.threadType, 'Open');
    // A second look with nothing new files nothing.
    const n = (host.chatMetadata.ri_memory.log || []).length;
    await I.fileBookEdits();
    assert.equal(host.chatMetadata.ri_memory.log.length, n);
});

test('legacy entries convert by kind: open thread, planted detail and going on elsewhere to Thread; secret to Secret', async () => {
    // A copy of the chat whose Story World also holds the entry kinds of today's Legacy workflow, written by today's code.
    host.chat = structuredClone(fixture.messages);
    host.chatMetadata = structuredClone(fixture.chatMetadata);
    const id = fixture.bookName;
    const book = structuredClone(fixture.book);
    const legacy = [
        ['character', 'Brannic', { role: 'farrier of the column', who: 'Brannic reset Night\'s shoe at the ford.' }, '', 12],
        ['place', 'Valen ford', { what: 'A shallow ford on the Valen road.' }, '', 8],
        ['faction', 'Northwood riders', { what: 'Riders seen on the north road.', wants: 'Unknown.' }, '', 10],
        ['secret', 'Hale and the dispatch', { secret: 'Hale read the sealed dispatch before delivering it.', holder: 'Hale', known: 'Heather' }, 'kept', 20],
        ['thread', 'The missing iron', { open: 'Who took the iron from the ore carts.', people: 'Hale, Marten' }, 'stirring', 22],
        ['seed', 'The salt mark', { detail: 'A salt mark on the first post.', payoff: 'It marks a hidden road.' }, 'planted', 24],
        ['activity', 'Darius rides south', { who: 'Darius', what: 'Darius rides south to the coast.', step: 'Two days out.' }, 'going', 26],
    ];
    const reserved = R.entries.reserve(book, id);
    for (const [kind, name, fields, status, n] of legacy) {
        const entry = R.entries.blank(reserved, kind);
        Object.assign(entry, { name, fields: { ...entry.fields, ...fields }, status: status || entry.status, at: { chat: fixture.chatId, n }, auto: true });
        R.entries.put(reserved, entry, id);
    }
    saved.books[id] = reserved;
    // Reply 64 also has a second swipe, not showing, with a staged change of its own.
    const m64 = host.chat[64];
    const alt = R.entries.blank(R.entries.reserve(structuredClone(reserved), id), 'fact');
    Object.assign(alt, { name: 'alt-fact', fields: { data: JSON.stringify({ id: 'alt-fact', kind: 'fact', text: 'Hale sent Jory back to the keep.', subject: 'Hale' }) }, auto: true });
    const altRec = { ...structuredClone(m64.extra[KEY]), update: { world: id, ops: [], changes: [], pending: { chat: fixture.chatId, revision: { turn: m64.send_date, swipe: 1, fingerprint: 'x' }, changes: [{ uid: alt.uid, name: 'alt-fact', kind: 'fact', type: 'create', entry: alt }] } } };
    m64.swipes.push('Hale sent Jory back to the keep and rode on alone.');
    m64.swipe_info.push({ send_date: m64.send_date, extra: { [KEY]: altRec } });
    const pageBefore = R.entries.list(await R.entries.effective(id), id);
    const notesBefore = (await WF.prepareWorld('normal', 33, { memory: true })).notes?.text;
    const result = await I.importOpenChat({ backup: async () => ({ name: 'backup.json' }) });
    assert.ok(result.imported && result.counts.legacy === legacy.length, JSON.stringify(result));
    const records = F.fold(host.chat, host.chatMetadata).records;
    const of = name => records.find(r => r.view?.name === name);
    assert.deepEqual([of('The missing iron').kind, of('The missing iron').threadType], ['thread', 'Open']);
    assert.deepEqual([of('The salt mark').kind, of('The salt mark').threadType], ['thread', 'Detail']);
    assert.deepEqual([of('Darius rides south').kind, of('Darius rides south').threadType], ['thread', 'Elsewhere']);
    assert.equal(of('Hale and the dispatch').kind, 'secret');
    assert.deepEqual(of('Hale and the dispatch').holders, ['Hale', 'Heather']);
    assert.equal(of('Brannic').kind, 'person');
    assert.equal(of('Valen ford').kind, 'place');
    // Each legacy entry is anchored to the reply it was made at.
    const replyIndex = n => host.chat.findIndex((m, i) => i > 0 && !m.is_user && host.chat.slice(1, i + 1).filter(x => !x.is_user).length === n);
    for (const [, name, , , n] of legacy) assert.equal(of(name).versions[0].index, replyIndex(n), `${name} anchored at reply ${n}`);
    const pageAfter = R.entries.list(await R.entries.effective(id), id);
    assert.deepEqual(sameRows(pageAfter), sameRows(pageBefore));
    assert.deepEqual(sameRows(await V.rowsForWorld('normal')), sameRows(pageAfter));
    assert.equal((await WF.prepareWorld('normal', 33, { memory: true })).notes?.text, notesBefore);
    // The other swipe's staged change sits in its own slot and shows when that swipe does.
    assert.equal(result.counts.otherSwipes, 1);
    assert.equal(m64.swipe_info[1].extra.ri_memory.entries[0].anchor.swipe, 1);
    const own64 = F.swipeEntries(m64).map(e => e.record?.id);
    m64.swipe_info[0].extra = structuredClone(m64.extra); m64.swipe_id = 1; m64.mes = m64.swipes[1]; m64.extra = structuredClone(m64.swipe_info[1].extra);
    const shown = F.fold(host.chat, host.chatMetadata);
    assert.ok(shown.byId.has(`u${alt.uid}`), 'the other swipe\'s record shows with its swipe');
    assert.ok(own64.every(rid => !shown.byId.get(rid)?.versions.some(v => v.index === 64)), 'the first swipe\'s changes leave with it');
    m64.swipe_info[1].extra = structuredClone(m64.extra); m64.swipe_id = 0; m64.mes = m64.swipes[0]; m64.extra = structuredClone(m64.swipe_info[0].extra);
    assert.ok(!F.fold(host.chat, host.chatMetadata).byId.has(`u${alt.uid}`));
    out.legacy = { counts: result.counts, kinds: legacy.map(([kind, name]) => [kind, of(name).kind, of(name).threadType || '']) };
});

test('an edit inside an imported closed chapter marks it stale and queues its rebuild', async () => {
    const Q = await import('../src/memory/queue.js');
    const result = F.fold(host.chat, host.chatMetadata);
    const chapter = result.records.find(r => r.kind === 'chapter');
    assert.ok(chapter?.covers?.length > 2, 'the imported chapter keeps the replies it covers');
    assert.equal(I.chapterJobs().length, 0, 'nothing is stale before the edit');
    const index = host.chat.findIndex(m => F.storedMark(m) === chapter.covers[3].mark);
    host.chat[index].mes = `${host.chat[index].mes} The wind turned.`;
    if (host.chat[index].swipes) host.chat[index].swipes[0] = host.chat[index].mes;
    const stale = I.staleChapters().map(r => r.id);
    assert.deepEqual(stale, [chapter.id]);
    assert.ok(R.entries.list(I.foldWorldData(), fixture.bookName).some(row => row.kind === 'chapter'), 'a stale chapter stays in force until its rebuild lands');
    const jobs = I.chapterJobs();
    assert.equal(jobs.length, 1);
    assert.deepEqual([jobs[0].kind, jobs[0].subject, jobs[0].payload.rebuild], ['chapter', chapter.id, chapter.id]);
    const queue = Q.createQueue({ store: Q.memoryStore(), timers: false });
    await queue.enqueue(jobs[0]);
    assert.deepEqual(queue.jobs().map(j => [j.kind, j.subject, j.state]), [['chapter', chapter.id, 'queued']]);
    // The same stale chapter queued again merges; a rebuild already saved for these sources is not queued again.
    await queue.enqueue(I.chapterJobs()[0]);
    assert.equal(queue.jobs().length, 1);
    out.stale = { chapter: chapter.id, covers: chapter.covers.length, job: `chapter ${jobs[0].subject} queued for its rebuild` };
});

test('a second open does not import again', async () => {
    const again = await I.importOpenChat({ backup: async () => ({}) });
    assert.equal(again.reason, 'already imported');
    fs.mkdirSync(EVIDENCE, { recursive: true });
    if (process.env.RI_WRITE_EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'import-results.json'), JSON.stringify(out, null, 2));
});
