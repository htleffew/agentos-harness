// MB2: the memory store in chat data, the fold, locks, reverts, history and the device database. Run with:
//   node --test tests/t_memory_store.js
// The scripted scenarios of MB11 (memory/evidence/m1g/harness/mb11/scen_storage.js) are replayed here against the real
// modules in src/memory/, on a chat in SillyTavern's own shape: messages with swipes, swipe_info slots and extra, and
// chat metadata. Swipes, edits, deletes and branches act on that chat the way SillyTavern does.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import needsDocs from './needs-docs.cjs';
needsDocs('t_memory_store', ['docs/ux-overhaul/memory/evidence/m1a']);
import { MEMORY, fold, historyOf, hashText, proseOf, storedMark, swipeEntries, memoryBytes, makeEntry, entrySum } from '../src/memory/fold.js';
import { createStore } from '../src/memory/store.js';
import { Play, fresh, story, clone } from './fixtures/mb2/story-play.mjs';
import { memoryItems } from '../src/memory/device-db.js';
import { createSearchIndex, sourcesFromChat } from '../src/memory/index.js';
import { hashEmbedder } from '../src/memory/embed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'MB2');

// The fold as seen from every reply except the given ones: entries that count and the records none of whose versions came from them.
function signature(p, exceptIndexes = []) {
    const f = p.fold();
    const skip = new Set(exceptIndexes.map(i => storedMark(p.chat[i])));
    const records = f.records.filter(r => r.versions.every(v => !skip.has(v.anchor?.mark))).map(r => [r.id, r.status, r.text]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return JSON.stringify(records);
}
const foldJson = p => { const f = p.fold(); return JSON.stringify({ r: f.records.map(r => [r.id, r.status, r.text, r.holders]), applied: f.applied, flags: f.flags.length }); };
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail) }); assert.ok(pass, `${name}: ${detail}`); };

// ---------------------------------------------------------------- entry shape and immutability (3.2)

test('entries have the shape of 3.2, keep their anchors and are never edited after save', async () => {
    const p = await fresh(12);
    const i = p.replyIndexOfTurn(12);
    const entries = swipeEntries(p.chat[i]);
    assert.ok(entries.length > 0);
    for (const e of entries) {
        for (const key of ['id', 'op', 'origin', 'anchor', 'at', 'seq', 'sum']) assert.ok(key in e, `entry has ${key}`);
        assert.deepEqual(Object.keys(e.anchor).sort(), ['hash', 'mark', 'swipe']);
        assert.equal(e.anchor.mark, storedMark(p.chat[i]));
        assert.equal(e.anchor.hash, hashText(proseOf(p.chat[i])));
        assert.ok(Object.isFrozen(e) && Object.isFrozen(e.anchor), 'saved entries are frozen');
        assert.equal(e.sum, entrySum(e));
        if (e.record?.text) assert.ok(e.record.text.length <= 300);
    }
    // Write, reload, compare: the saved bytes of every entry are the same after a reload and after more work.
    const before = JSON.stringify([p.meta[MEMORY].log, p.chat.map(m => [m.extra?.[MEMORY], m.swipe_info?.map(s => s.extra?.[MEMORY])])]);
    p.reload();
    const reloaded = JSON.stringify([p.meta[MEMORY].log, p.chat.map(m => [m.extra?.[MEMORY], m.swipe_info?.map(s => s.extra?.[MEMORY])])]);
    assert.equal(reloaded, before, 'a reload reads back the same entries');
    const oldLog = clone(p.meta[MEMORY].log), oldReply = clone(swipeEntries(p.chat[i]));
    await p.play(13); await p.store.lock(['night-shoe-new']); await p.store.revert(oldReply[0].id);
    assert.deepEqual(p.meta[MEMORY].log.slice(0, oldLog.length), oldLog, 'chat log entries are unchanged by later locks and reverts');
    assert.deepEqual(clone(swipeEntries(p.chat[i])), oldReply, 'a reply\'s entries are unchanged by later work');
    // An entry edited in the file is held out and named in History.
    const tampered = p.reload();
    const target = tampered.chat[i].extra[MEMORY].entries[0];
    target.record.text = 'Changed by hand in the file.';
    const f = tampered.fold();
    assert.ok(!f.applied.includes(target.id));
    assert.ok(f.history.some(h => h.entry === target.id && /changed after it was saved/.test(h.note)));
    assert.throws(() => makeEntry({ op: 'rewrite', origin: 'capture' }, { seq: 1, at: 1 }), /Unknown change entry op/);
    record('entry shape and anchors as in 3.2; entries never edited after save (write, reload, compare)', true, `${entries.length} entries on reply 12; reload byte-identical; tampered entry held out`);
});

// ---------------------------------------------------------------- the scenarios of 3.4

test('swipe of turn 20 (TunnelVision replay): no record from another reply changes', async () => {
    const p = await fresh(20);
    const i20 = p.replyIndexOfTurn(20);
    const before = signature(p, [i20]);
    const foldBefore = foldJson(p);
    const others = Array.from({ length: 9 }, (_, k) => p.replyIndexOfTurn(11 + k));
    const nBefore = others.reduce((s, i) => s + swipeEntries(p.chat[i]).length, 0);
    const alt = 'At the rear of the column Ser Marten Drey held a wet cloth to his sword arm. "A graze from a thorn," Marten said. "It will keep." He rode on without looking at it.';
    p.swipe(i20, alt);
    const own = swipeEntries(p.chat[i20]).filter(e => e.anchor.swipe === 1);
    record('a new swipe has no entries until its capture runs', own.length === 0);
    const mid = signature(p, [i20]);
    await p.capture(i20, { scene: { where: 'the rear of the column', time: 'morning', present: 'Hale, Marten' }, changes: [{ kind: 'fact', id: 'marten-arm-cut', subject: 'Marten', text: 'Ser Marten Drey has a graze on his sword arm that he says came from a thorn.', evidence: 'A graze from a thorn' }] });
    const after = signature(p, [i20]);
    const nAfter = others.reduce((s, i) => s + swipeEntries(p.chat[i]).length, 0);
    const noScene = s => JSON.stringify(JSON.parse(s).filter(r => r[0] !== 'scene'));
    record('swipe of turn 20: no record from another reply changes, before or after the new swipe is captured', before === after && noScene(before) === noScene(mid), 'signature of the other replies compared');
    record('swipe of turn 20: the entries of turns 11 to 19 all remain', nBefore > 0 && nBefore === nAfter, `${nBefore} before, ${nAfter} after (TunnelVision lost 10)`);
    assert.match(p.fold().byId.get('marten-arm-cut').text, /thorn/);
    p.select(i20, 0);
    record('swiping back returns the first swipe\'s records exactly', foldJson(p) === foldBefore);
    // A swipe of a reply that a closed chapter covers makes the chapter stale; nothing else moves.
    const q = await fresh(30);
    const j20 = q.replyIndexOfTurn(20);
    const sig0 = signature(q, [j20]);
    q.swipe(j20, alt);
    const chapter = q.fold().byId.get('chapter-2');
    record('swipe inside a closed chapter: no record from another reply changes and the chapter goes stale', noScene(signature(q, [j20])) === noScene(sig0) && chapter.stale && q.fold().stale.includes('chapter-2'), `stale: ${q.fold().stale.join(', ')}`);
});

test('a one-turn branch with upkeep (TunnelVision replay): the main chat\'s fold is identical before and after', async () => {
    const p = await fresh(30);
    const i20 = p.replyIndexOfTurn(20);
    const mainBefore = foldJson(p);
    const metaBefore = JSON.stringify(p.meta), chatBefore = JSON.stringify(p.chat);
    const b = p.branch(i20, 'branch-20');
    await b.play(21);
    await b.store.record([{ op: 'flag', record: { kind: 'upkeep-note', text: 'A branch-only flag.' }, origin: { type: 'upkeep', route: 'code' } }, { op: 'merge', target: ['marten-arm-cut', 'marten-rear-guard'], record: { text: 'Merged in the branch only.' }, origin: { type: 'upkeep', route: 'code' } }]);
    record('branch: the main chat\'s fold is identical after the branch and its upkeep', foldJson(p) === mainBefore && JSON.stringify(p.meta) === metaBefore && JSON.stringify(p.chat) === chatBefore, 'fold, metadata and messages compared');
    record('branch: the branch holds the main story up to the branch point', b.fold().byId.has('marten-arm-cut') && !b.fold().byId.has('night-shoe-new'));
    const c = p.branch(p.replyIndexOfTurn(16), 'branch-16');
    record('branch: a chapter cut by the branch point loses its coverage', !c.fold().byId.has('chapter-2') && c.fold().byId.has('chapter-1') && p.fold().byId.has('chapter-2'));
});

test('edits: a recent reply is held out until captured again; an old covered reply marks its chapter stale', async () => {
    const p = await fresh(40);
    const i38 = p.replyIndexOfTurn(38);
    const counts = () => swipeEntries(p.chat[i38]).filter(e => p.fold().applied.includes(e.id)).length;
    const n0 = counts();
    p.edit(i38, `${p.chat[i38].mes} A bell rang.`);
    const n1 = counts();
    const held = p.fold().history.filter(h => /held out: its reply was edited/.test(h.note)).length;
    await p.capture(i38, { scene: { present: 'Hale, Heather' }, changes: [{ kind: 'fact', id: 'bell', subject: 'Hale', text: 'A bell rang at the keep.', evidence: 'A bell rang.' }] });
    const n2 = counts();
    record('an edited reply\'s entries are held out until it is captured again', n0 > 0 && n1 === 0 && held >= n0 && n2 > 0 && p.fold().byId.has('bell'), `${n0} then ${n1} then ${n2}`);
    const q = await fresh(40);
    const i5 = q.replyIndexOfTurn(5);
    const covered = q.fold().records.filter(r => r.kind === 'chapter').map(r => r.id);
    q.edit(i5, `${q.chat[i5].mes} The wind turned.`);
    const f = q.fold();
    record('an edit inside a closed chapter marks the chapter stale and every other chapter keeps its coverage', f.stale.includes('chapter-1') && covered.every(id => f.byId.has(id)) && f.stale.length === 1 && q.chat.every(m => !('hidden' in m)), `stale: ${f.stale.join(', ')}`);
});

test('delete and continue', async () => {
    const p = await fresh(30);
    const i14 = p.replyIndexOfTurn(14);
    const made = swipeEntries(p.chat[i14]).filter(e => e.op === 'add' && e.record?.id !== 'scene').map(e => e.record.id);
    const mark = storedMark(p.chat[i14]);
    p.del(i14); p.del(i14 - 1);
    const f = p.fold();
    record('delete: what the reply created leaves the fold with it, and its chapter goes stale', made.length > 0 && made.every(id => !f.byId.has(id)) && f.records.every(r => r.versions.every(v => v.anchor?.mark !== mark)) && f.stale.includes('chapter-2'), made.join(', '));
    const q = await fresh(30);
    const i29 = q.replyIndexOfTurn(29);
    const old = swipeEntries(q.chat[i29]).length;
    q.edit(i29, `${q.chat[i29].mes} Hale added that the road would be quiet.`);
    await q.capture(i29, { scene: { present: 'Hale' }, changes: [{ kind: 'fact', id: 'quiet-road', subject: 'Hale', text: 'Hale expects a quiet road below the keep.', evidence: 'the road would be quiet' }] });
    const counting = swipeEntries(q.chat[i29]).filter(e => q.fold().applied.includes(e.id));
    record('continue: the continued reply is captured again as a whole and its earlier entries are replaced', old > 0 && counting.length > 0 && counting.every(e => e.anchor.hash === hashText(proseOf(q.chat[i29]))) && q.fold().byId.has('quiet-road'));
});

// ---------------------------------------------------------------- depends, revert, locks and the cache (3.2, 3.5)

test('depends: reverting an entry drops the entries that depended on it; the cached fold invalidates on a lock, revert or edit', async () => {
    const p = await fresh(14);
    const shoe = p.fold().byId.get('edren-waterskins');
    assert.ok(shoe, 'a record with more than one version');
    const first = shoe.versions[0].entry, later = shoe.versions.slice(1).map(v => v.entry);
    const k0 = p.fold().key, f0 = p.fold();
    assert.equal(p.fold(), f0, 'the fold is cached while nothing changes');
    await p.store.revert(first, 'Undo the first version.');
    const f1 = p.fold();
    assert.notEqual(f1.key, k0, 'a revert changes the cache key');
    const gone = later.filter(id => !f1.applied.includes(id));
    const notes = later.map(id => f1.history.find(h => h.entry === id)?.note);
    record('reverting an entry drops the entries that depended on it, shown as "no longer applies" in History', !f1.byId.has(shoe.id) && gone.length === later.length && notes.every(n => /no longer applies/.test(n || '')), notes.join(' | '));
    const rows = historyOf(p.chat, p.meta, shoe.id);
    assert.ok(rows.some(r => r.entry === first && !r.counts && r.revertedBy));
    const k1 = f1.key;
    await p.store.lock(['scene']);
    const k2 = p.fold().key;
    p.edit(1, `${p.chat[1].mes} Edited.`);
    const k3 = p.fold().key;
    record('the cached fold invalidates on a lock, a revert and an edit', new Set([k0, k1, k2, k3]).size === 4);
    // A lock turns a model entry aimed at the record into a review flag; your own edit still applies.
    await p.store.lock(['heather-mare-ash']);
    await p.capture(p.replyIndexOfTurn(14), { changes: [{ kind: 'fact', id: 'heather-mare-ash', subject: 'Heather', text: 'A model says Heather has no horse.', evidence: '' }] });
    const f4 = p.fold();
    assert.ok(f4.flags.some(flag => flag.kind === 'locked-record' && flag.target.includes('heather-mare-ash')));
    assert.doesNotMatch(f4.byId.get('heather-mare-ash').text, /no horse/);
    await p.store.record([{ op: 'revise', target: ['heather-mare-ash'], record: { id: 'heather-mare-ash', kind: 'fact', subject: 'Heather', text: 'Heather rides a grey mare named Ash, shod at Valen.' }, origin: { type: 'you' } }]);
    assert.equal(p.fold().byId.get('heather-mare-ash').text, 'Heather rides a grey mare named Ash, shod at Valen.');
});

test('record history lists every version with its source after a reload; Revert and Restore work after a reload', async () => {
    const p = await fresh(30);
    const id = p.fold().records.find(r => r.versions.length >= 2 && r.kind !== 'scene').id;
    const before = p.store.history(id);
    p.reload();
    const after = p.store.history(id);
    assert.deepEqual(after, before);
    record('record history lists every version with its source after a reload', after.length >= 2 && after.every(row => row.origin && Number.isInteger(row.index) && row.entry), `${after.length} versions of ${id}: ${after.map(r => `${r.op} by ${r.origin} at message ${r.index}`).join('; ')}`);
    const last = after.at(-1).entry;
    await p.store.revert(last);
    p.reload();
    const reverted = p.store.history(id).find(r => r.entry === last);
    assert.ok(!reverted.counts && reverted.revertedBy, 'the revert survives a reload');
    // Restore after a reload: retire the record, reload, restore.
    await p.store.record([{ op: 'retire', target: [id], origin: { type: 'upkeep', route: 'code' }, reason: 'Retired by a tidy run.' }]);
    p.reload();
    assert.equal(p.fold().byId.get(id).status, 'retired');
    await p.store.restore(id);
    p.reload();
    assert.notEqual(p.fold().byId.get(id).status, 'retired');
    // Undo of the revert brings the version back.
    const undo = p.store.history(id).find(r => r.op === 'revert' && r.counts && p.store.entryById(r.entry)?.target?.includes(last));
    await p.store.revert(undo.entry);
    p.reload();
    record('Revert and Restore work after a reload', p.store.history(id).find(r => r.entry === last).counts);
});

// ---------------------------------------------------------------- late writes (3.2)

test('a capture result that returns after a swipe, edit or chat switch is discarded and logged; commits are serialized and saved', async () => {
    const p = await fresh(10);
    const t = story.turns[10];
    p.add(true, t.player);
    const i = p.add(false, t.prose, { turn: 11 });
    const job = p.store.begin(i);
    p.swipe(i, 'A different reply entirely.');
    const r1 = await p.store.commit(job, p.inputs(t.update, null, i));
    const job2 = p.store.begin(i);
    p.edit(i, 'An edited reply.');
    const r2 = await p.store.commit(job2, p.inputs(t.update, null, i));
    const job3 = p.store.begin(i);
    p.current = 'another-chat';
    const r3 = await p.store.commit(job3, p.inputs(t.update, null, i));
    p.current = undefined;
    const jobs = p.store.jobs();
    record('a capture that returns after a swipe, an edit or a chat switch is discarded and logged', r1.discarded && r2.discarded && r3.discarded && jobs.filter(j => j.kind === 'discarded-late-write').length === 2 && p.store.receipts().length === 3, `${r1.reason}; ${r2.reason}; ${r3.reason}`);
    // Two commits started together land one after the other, each followed by its save.
    const order = [];
    const host = { chat: () => p.chat, meta: () => p.meta, chatId: () => 'main', now: () => ++p.clock, save: async () => { order.push(`save after ${swipeEntries(p.chat[i]).length}`); await new Promise(r => setTimeout(r, 5)); } };
    const s = createStore(host);
    const a = s.begin(i), b = s.begin(i);
    const [ra, rb] = await Promise.all([s.commit(a, [{ op: 'add', record: { id: 'race-a', kind: 'fact', text: 'A.' }, origin: 'capture' }]), s.commit(b, [{ op: 'add', record: { id: 'race-b', kind: 'fact', text: 'B.' }, origin: 'capture' }])]);
    record('commits for one chat are serialized and each is followed by a save', ra.committed && rb.committed && order.length === 2 && order[0] === 'save after 1' && order[1] === 'save after 2', order.join(', '));
});

// ---------------------------------------------------------------- size, and the device database

test('memory data averages 1.5 KB a reply or less on the 54-turn story; a 1,000-message chat saves in a recorded time', async () => {
    const p = await fresh(54);
    const replies = p.chat.filter(m => !m.is_user && m.extra?.turn > 0).length;
    const bytes = memoryBytes(p.chat, p.meta);
    const perReply = bytes.total / replies;
    record('memory data averages 1.5 KB a reply or less on the 54-turn story', perReply <= 1536, `${Math.round(perReply)} bytes a reply over ${replies} replies (${bytes.meta} chat log, ${bytes.extras} reply entries and marks)`);
    // 1,000 messages: the story played over and over with fresh ids per cycle.
    const big = new Play(); big.add(false, story.greeting, { turn: 0 });
    for (let k = 0; k < 500; k++) {
        const t = story.turns[k % story.turns.length], cycle = Math.floor(k / story.turns.length);
        const update = cycle ? { ...clone(t.update), changes: t.update.changes.map(c => ({ ...c, id: `${c.id}#${cycle}` })) } : t.update;
        big.add(true, t.player);
        const i = big.add(false, `${t.prose}${cycle ? ` (${cycle})` : ''}`, { turn: t.n });
        await big.capture(i, update, t.replaces ? `${t.replaces}${cycle ? `#${cycle}` : ''}` : null);
    }
    const time = fn => { const s = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - s) / 1e6; };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb2-'));
    const jsonl = () => [JSON.stringify({ chat_metadata: big.meta }), ...big.chat.map(m => JSON.stringify(m))].join('\n');
    const saveMs = time(() => fs.writeFileSync(path.join(tmp, 'chat.jsonl'), jsonl()));
    big.store.view({ cache: false });
    const foldMs = time(() => fold(big.chat, big.meta, { cache: false }));
    const m1a = path.join(here, '..', 'docs', 'ux-overhaul', 'memory', 'evidence', 'm1a');
    const today = ['chat-records-after-turn-32.json', 'chat-metadata-after-turn-32.json', 'story-world-after-turn-32.json'].map(f => JSON.parse(fs.readFileSync(path.join(m1a, f), 'utf8')));
    const todayAll = JSON.stringify({ parts: Array.from({ length: 16 }, () => today) });
    const todayMs = time(() => fs.writeFileSync(path.join(tmp, 'today.json'), todayAll));
    const mem = JSON.stringify({ meta: big.meta[MEMORY], extras: big.chat.map(m => [m.extra?.[MEMORY], ...(m.swipe_info || []).slice(1).map(s => s.extra?.[MEMORY])]) });
    const memMs = time(() => fs.writeFileSync(path.join(tmp, 'mem.json'), mem));
    const sizes = { messages: big.chat.length, chatFileBytes: fs.statSync(path.join(tmp, 'chat.jsonl')).size, memoryDataBytes: mem.length, todayMemoryBytes: todayAll.length };
    fs.rmSync(tmp, { recursive: true, force: true });
    const node = { ...sizes, chatSaveMs: +saveMs.toFixed(1), foldMs: +foldMs.toFixed(1), memoryDataSaveMs: +memMs.toFixed(1), todaySaveMs: +todayMs.toFixed(1), perReplyBytes54: Math.round(perReply), note: 'Node on the desktop. The browser figure with a phone CPU throttle is in save-time.json; the phone run is still to come.' };
    fs.mkdirSync(EVIDENCE, { recursive: true });
    if (process.env.RI_WRITE_EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'store-node.json'), JSON.stringify(node, null, 2));
    record('a 1,000-message chat: the save time is recorded against today\'s (Node, desktop)', big.chat.length >= 1000 && memMs > 0 && todayMs > 0, `memory data ${sizes.memoryDataBytes} bytes in ${memMs.toFixed(1)} ms; today's ${sizes.todayMemoryBytes} bytes in ${todayMs.toFixed(1)} ms; fold ${foldMs.toFixed(1)} ms`);
});

test('clearing the device database loses nothing: the indexes rebuild on the next open', async () => {
    // MB5: MiniSearch (src/memory/index.js) is the one word index; the device database keeps only the search vectors.
    const p = await fresh(30);
    const db = memoryItems();
    const embedder = hashEmbedder({ dim: 64, id: 'store-test' });
    const f = p.fold();
    const findIn = async index => (await index.search({ message: 'Marten sword arm', turn: 31 })).items.map(i => i.key);
    const first = createSearchIndex({ embedder, db });
    await first.sync(sourcesFromChat({ chat: p.chat, result: f }));
    assert.equal(first.stats.reused, 0);
    const found = await findIn(first);
    const chatBefore = JSON.stringify([p.chat, p.meta]);
    await db.clear();
    assert.equal(await db.count(), 0);
    // The next open: chat data is all there is, and it is untouched.
    p.reload();
    const g = p.fold();
    const again = createSearchIndex({ embedder, db });
    await again.sync(sourcesFromChat({ chat: p.chat, result: g }));
    const foundAgain = await findIn(again);
    // A branch with the same records reuses every item.
    const b = p.branch(p.chat.length - 1, 'copy');
    const reuse = createSearchIndex({ embedder, db });
    await reuse.sync(sourcesFromChat({ chat: b.chat, result: b.fold() }));
    record('clearing the device database loses nothing: the indexes rebuild on the next open', JSON.stringify([p.chat, p.meta]) === chatBefore && foldJson(p) === JSON.stringify({ r: f.records.map(r => [r.id, r.status, r.text, r.holders]), applied: f.applied, flags: f.flags.length }) && again.stats.built === first.stats.built && JSON.stringify(foundAgain) === JSON.stringify(found) && found.length > 0 && reuse.stats.built === 0, `${first.stats.built} search vectors built, ${again.stats.built} rebuilt after the clear, ${reuse.stats.reused} reused by a branch; found ${found.join(', ')}`);
    assert.ok((await db.keys('vec:store-test:')).length > 0);
    assert.equal((await db.keys('words:')).length, 0, 'no word index items in the device database');
});

test('write the results', () => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    if (process.env.RI_WRITE_EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'store-results.json'), JSON.stringify({ suite: 'tests/t_memory_store.js', run: new Date().toISOString(), results }, null, 2));
    assert.ok(results.every(r => r.pass));
});
