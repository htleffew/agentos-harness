// MB7: upkeep (memory DESIGN 7.1 levels 0 and 4, 7.3 to 7.5, 3.5). The extension's own modules run in Node on a host in
// SillyTavern's shape. Every model ruling goes through tests/mock.js, started here on its own port, so the Cleanup request
// and its answer cross the same HTTP boundary a route uses.
//   node --test tests/t_upkeep.js
// Fixtures from docs/ux-overhaul (the M1a store, the MB11 102-turn story, TunnelVision's five planted entries, the MB11
// register scorer) are read when docs/ is present; those tests print SKIP and pass when it is not.
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
const EVIDENCE = path.join(DOCS, 'memory', 'evidence', 'MB7');
const HAS_DOCS = fs.existsSync(path.join(DOCS, 'memory', 'evidence', 'MB11', 'fixtures', 'story100.json'));
const PORT = Number(process.env.RI_UPKEEP_MOCK_PORT || 8274);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mb7-'));
const MODE = path.join(TMP, 'mode.json'), LOG = path.join(TMP, 'requests.jsonl');
const t0 = Date.parse('2026-11-24T10:00:00Z');

// ---------------------------------------------------------------- a host in SillyTavern's shape

const books = new Map();
const host = {
    chat: [], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale of Verath', characters: [{ name: 'Hale of Verath' }], characterId: 0,
    getCurrentChatId: () => host.chatId || 'mb7-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    loadWorldInfo: async name => structuredClone(books.get(name) || null), saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const SIM = await import('../src/memory/similarity.js');
const U = await import('../src/memory/upkeep.js');
const A = await import('../src/memory/additions.js');
const FL = await import('../src/memory/flags.js');
const BW = await import('../src/memory/book-writer.js');
const CR = await import('../src/corrections.js');

const out = { suite: 'tests/t_upkeep.js', run: new Date().toISOString() };
const register = HAS_DOCS ? createRequire(import.meta.url)(path.join(DOCS, 'memory', 'evidence', 'm1g', 'harness', 'mb11', 'register.js')) : null;
const written = [];   // every text this ticket writes as record, for the register check

let clock = t0;
function message(i, text, user = false, name = user ? 'Heather' : 'Hale of Verath') {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name, is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
/** A fresh chat of `replies` exchanges and a store over it. */
function freshChat(replies = 6, { id = 'mb7-chat' } = {}) {
    host.chatId = id;
    host.chat = [message(0, 'Hale waits at the gatehouse of Elerian Keep.')];
    for (let r = 1; r <= replies; r++) host.chat.push(message(2 * r - 1, `I ask about turn ${r}.`, true), message(2 * r, `Reply ${r}: the column rides on.`));
    host.chatMetadata = { [F.MEMORY]: { v: 1, seq: 0, log: [], imported: true } };
    const store = S.createStore({ chat: () => host.chat, meta: () => host.chatMetadata, chatId: () => host.getCurrentChatId(), save: async () => {}, now: () => (clock += 1000) });
    store.marks();
    return store;
}
const reply = r => 2 * r;
const rec = (id, subject, text, extra = {}) => ({ id, kind: 'fact', subject, text, status: 'current', importance: 5, ...extra });
const file = (store, index, record, quote = '') => store.recordOnReply(index, [{ op: 'add', record, origin: { type: 'capture', route: 'desktop' }, ...(quote ? { evidence: [{ quote }] } : {}) }]);
const view = () => F.fold(host.chat, host.chatMetadata, { cache: false });

// ---------------------------------------------------------------- the mock and a route over it

let mock = null;
function setMode(value) { fs.writeFileSync(MODE, JSON.stringify(value)); }
const mockRows = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
async function viaMock({ system, user, schema }) {
    const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'mock-cleanup', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_schema', json_schema: { name: schema.name, schema: schema.value } } }) });
    const json = await res.json();
    return { ok: true, value: JSON.parse(json.choices[0].message.content), route: 'desktop', model: 'mock-cleanup' };
}
before(async () => {
    setMode({});
    mock = spawn(process.execPath, [path.join(here, 'mock.js')], { env: { ...process.env, RI_MOCK_PORT: String(PORT), RI_MOCK_MODE: MODE, RI_MOCK_LOG: LOG }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/v1/models`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
    throw new Error('The mock did not start.');
});
after(() => {
    mock?.kill();
    if (HAS_DOCS && process.env.RI_WRITE_EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, 'upkeep-node.json'), JSON.stringify(out, null, 1)); }
});

// ---------------------------------------------------------------- 1. code merges only identical duplicates

test('code merges only identical duplicates; "loose" against "no longer loose" goes to a model ruling through the mock', async () => {
    const store = freshChat(4);
    await file(store, reply(1), rec('gate-1', 'Crossroads gate', 'The gate is red.', { attribute: 'colour' }));
    await file(store, reply(2), rec('gate-2', 'Crossroads gate', 'The gate is red.', { attribute: 'colour', aliases: ['the red gate'] }));
    await file(store, reply(2), rec('shoe-1', 'Night', 'The shoe is loose.', { attribute: 'left foreshoe' }));
    await file(store, reply(3), rec('shoe-2', 'Night', 'The shoe is no longer loose.', { attribute: 'left foreshoe' }));
    const zero = U.levelZero(view(), { names: ['Hale', 'Night'] });
    assert.equal(zero.merges.length, 1, 'one code merge');
    assert.deepEqual(zero.merges[0].target, ['gate-1', 'gate-2'], 'the identical pair, the earliest kept as main');
    assert.ok(zero.clusters.some(c => c.ids.includes('shoe-1') && c.ids.includes('shoe-2')), 'the shoe pair is queued for a ruling');
    assert.ok(!zero.merges.some(m => m.target.includes('shoe-1')), 'similar wording alone never merges in code');
    await store.record(zero.merges);
    assert.equal(view().byId.get('gate-2').status, 'merged');
    assert.deepEqual(view().byId.get('gate-1').aliases, ['the red gate'], 'aliases join the main record');
    U.upkeepState(host.chatMetadata).queue.push(...zero.clusters);
    setMode({ tidy: { clusters: { 'shoe-1|shoe-2': { ruling: 'supersede', newer: 'shoe-2' } } } });
    const before = mockRows().length;
    const res = await U.runTidy({ context: host, store, runChainFn: viaMock, books: [] });
    const sent = mockRows().slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].kind, 'tidy', 'the mock read the Cleanup task line');
    assert.match(sent[0].messages[1].content, /\[shoe-1\] fact \| Night \| The shoe is loose\./, 'the judge sees the full text of every record');
    assert.match(sent[0].messages[1].content, /\[shoe-2\] fact \| Night \| The shoe is no longer loose\./);
    assert.equal(res.counts.supersede, 1);
    assert.equal(view().byId.get('shoe-1').status, 'replaced');
    assert.equal(view().byId.get('shoe-2').status, 'current');
    out.identical = { merges: zero.merges.length, clusters: zero.clusters.map(c => c.ids), tidy: res.counts };
});

// ---------------------------------------------------------------- 2. the M1f planted pairs

function m1aRecords() {
    const d = JSON.parse(fs.readFileSync(path.join(DOCS, 'memory', 'evidence', 'm1a', 'story-world-after-turn-32.json'), 'utf8'));
    const kinds = { profile: 'person', arc: 'thread', seed: 'thread', agenda: 'thread', knowledge: 'secret' };
    return Object.values(d.entries).filter(e => e.extensions?.ri?.fields?.data).map(e => JSON.parse(e.extensions.ri.fields.data))
        .sort((a, b) => a.atIndex - b.atIndex).map(j => ({ at: j.atIndex, quote: j.quote, record: { id: j.id, kind: kinds[j.kind] || j.kind, subject: j.subject, text: j.text, status: 'current', importance: 6 } }));
}
const CAST = ['Hale', 'Heather', 'Marten', 'Jory', 'Night', 'Brannic', 'Edren', 'Orren', 'Tobin', 'Darius', 'Aldric', 'Piers', 'Vell', 'Hobb', 'Veck', 'Corwin', 'Wend', 'Orla', 'Pip', 'Dunn', 'Ash', 'Pebble', 'Garrow', 'Mara'];

test('both M1f planted pairs are found by code and ruled by a model; the harmless salt-mark pair is kept', { skip: !HAS_DOCS && 'docs/ is missing' }, async () => {
    const store = freshChat(33);
    for (const { at, quote, record } of m1aRecords()) await file(store, reply(Math.max(1, Math.ceil(at / 2))), record, quote);
    const result = view();
    const zero = U.levelZero(result, { names: CAST });
    const has = (a, b) => zero.clusters.some(c => c.ids.includes(a) && c.ids.includes(b) && c.verdicts.includes('supersede?'));
    assert.ok(has('night-loose-shoe', 'night-shoe-loose'), "Night's shoe pair is queued as supersede?");
    assert.ok(has('marten-rear-guard', 'marten-head-column'), "Marten's post pair is queued as supersede?");
    const supersedes = zero.clusters.filter(c => c.verdicts.includes('supersede?'));
    assert.equal(supersedes.length, 2, 'no other cluster reaches the supersede class');
    assert.ok(!zero.clusters.some(c => c.ids.includes('hale-first-salt-mark') && c.ids.includes('hale-heather')), 'the salt-mark pair is never queued');
    assert.equal(zero.merges.length, 0, 'no record in the M1a store is identical to another');
    U.upkeepState(host.chatMetadata).queue.push(...zero.clusters);
    setMode({ tidy: { clusters: {
        'night-loose-shoe|night-shoe-loose': { ruling: 'supersede', newer: 'night-shoe-loose' },
        'marten-rear-guard|marten-head-column': { ruling: 'supersede', newer: 'marten-head-column' },
    } } });
    const res = await U.runTidy({ context: host, store, runChainFn: viaMock, books: [] });
    const after = view();
    assert.equal(after.byId.get('night-loose-shoe').status, 'replaced');
    assert.equal(after.byId.get('marten-rear-guard').status, 'replaced');
    assert.equal(after.byId.get('night-shoe-loose').status, 'current');
    assert.equal(after.byId.get('marten-head-column').status, 'current');
    for (const id of ['hale-first-salt-mark', 'hale-heather']) assert.equal(after.byId.get(id).status, 'current', `${id} kept`);
    // The enrich candidate (one wound in two records) was merged by the mock's faithful text into the earliest record.
    assert.equal(res.counts.merge, 1);
    assert.equal(after.byId.get('marten-stitched').mergedInto, 'marten-arm-cut');
    assert.match(after.byId.get('marten-arm-cut').text, /deep cut.*six knots/);
    for (const m of after.current.filter(r => r.mergedFrom)) written.push(m.text);
    out.m1f = { clusters: zero.clusters.map(c => ({ ids: c.ids, verdicts: c.verdicts })), tidy: res.counts };
});

// ---------------------------------------------------------------- 3. merges keep every detail (the claim check)

test('the claim check: a faithful merge passes; one written from previews, one that drops a number, one over 600 characters are refused', () => {
    const arm = { id: 'marten-arm-cut', text: 'Ser Marten Drey has a deep cut on his sword arm from a branch.' };
    const stitch = { id: 'marten-stitched', text: "Maester Orren stitched Marten's cut with six knots and told him to keep it dry." };
    assert.ok(U.claimCheck([arm, stitch], 'Ser Marten Drey has a deep cut on his sword arm from a branch; Maester Orren stitched the cut with six knots and told him to keep it dry.').ok);
    const preview = U.claimCheck([arm, stitch], `${arm.text.slice(0, 45)} ${stitch.text.slice(0, 45)}`);
    assert.ok(!preview.ok && ['branch', 'knot'].every(d => preview.missing.some(m => m.detail === d)), `a merge from 45-character previews drops details: ${JSON.stringify(preview.missing)}`);
    const number = U.claimCheck([{ id: 'p', text: 'Hale carries 200 silver for the Valen Ford toll.' }], 'Hale carries silver for the Valen Ford toll.');
    assert.ok(!number.ok && number.missing.some(m => m.detail === '200'));
    assert.ok(!U.claimCheck([{ id: 'n', text: 'Night is black.' }], `Night is black. ${'x'.repeat(620)}`).ok);
    // A refused merge leaves the records as they were, linked, and the next level 0 does not queue them again.
    const store = freshChat(3);
    return (async () => {
        await file(store, reply(1), rec('a1', 'Marten', arm.text));
        await file(store, reply(2), rec('a2', 'Marten', stitch.text));
        const result = view();
        const cluster = { id: 'c1', ids: ['a1', 'a2'], why: 'test' };
        const lossy = U.applyTidy({ clusters: [{ cluster: 'c1', ruling: 'merge', text: 'Marten was hurt.', quotes: [{ id: 'a1', quote: 'deep cut' }, { id: 'a2', quote: 'six knots' }] }] }, { clusters: [cluster], result });
        assert.equal(lossy.counts.refused, 1);
        assert.equal(lossy.inputs[0].op, 'link');
        await store.record(lossy.inputs);
        assert.equal(view().byId.get('a1').status, 'current');
        assert.ok(view().byId.get('a1').links.includes('a2'), 'the cluster stays as linked records');
        assert.ok(U.ruledPairs(host.chat, host.chatMetadata, view()).has(SIM.pairKey('a1', 'a2')), 'a linked pair is not queued again');
        const mood = U.applyTidy({ clusters: [{ cluster: 'c1', ruling: 'merge', text: `${arm.text} ${stitch.text} Marten felt afraid.`, quotes: [{ id: 'a1', quote: 'deep cut' }, { id: 'a2', quote: 'six knots' }] }] }, { clusters: [cluster], result });
        assert.equal(mood.counts.refused, 1, 'a merged text that adds mood is refused (report register)');
        const unquoted = U.applyTidy({ clusters: [{ cluster: 'c1', ruling: 'merge', text: `${arm.text} ${stitch.text}`, quotes: [{ id: 'a1', quote: 'deep cut' }] }] }, { clusters: [cluster], result });
        assert.equal(unquoted.counts.refused, 1, 'a merge must quote each source');
    })();
});

test('Tidy batches clusters by route: 6 on the desktop, 12 on mid routes, 16 on frontier routes; the interval adapts', () => {
    assert.equal(U.batchSize('desktop'), 6);
    assert.equal(U.batchSize('nanogpt'), 12);
    assert.equal(U.batchSize('openrouterFree'), 12);
    assert.equal(U.batchSize('openrouter'), 16);
    assert.equal(U.batchSize('main'), 16);
    assert.equal(U.nextEvery(40, 8), 20, 'a run that found a lot brings the next one sooner');
    assert.equal(U.nextEvery(40, 0), 80, 'a run that found little puts the next one later');
    assert.equal(U.nextEvery(10, 9), 10);
    assert.equal(U.nextEvery(160, 0), 160);
    const state = { queue: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}` })), every: 40, last: { at: t0, reply: 10 } };
    assert.match(U.tidyDue(state, { reply: 11, now: t0 }), /8 clusters/);
    assert.equal(U.tidyDue({ ...state, queue: [{}] }, { reply: 11, now: t0 }), '');
    assert.match(U.tidyDue({ ...state, queue: [] }, { reply: 70, now: t0, oldestFlagReply: 12 }), /flag/);
    assert.match(U.tidyDue({ ...state, queue: [] }, { reply: 11, now: t0 + U.WEEK_MS }), /week/);
    assert.match(U.tidyDue({ ...state, queue: [] }, { reply: 50, now: t0 }), /40 replies/);
});

test('a Tidy run of 14 clusters on the desktop goes out as three calls of at most 6 clusters, each with full texts', async () => {
    const store = freshChat(30);
    for (let i = 0; i < 14; i++) {
        await file(store, reply(2 * i + 1), rec(`p${i}-a`, `Rider${String.fromCharCode(65 + i)}`, `Rider${String.fromCharCode(65 + i)} keeps the north gate key on a red cord.`, { attribute: 'gate key' }));
        await file(store, reply(2 * i + 2), rec(`p${i}-b`, `Rider${String.fromCharCode(65 + i)}`, `Rider${String.fromCharCode(65 + i)} keeps the north gate key on a red cord and a brass ring.`, { attribute: 'gate key' }));
    }
    const zero = U.levelZero(view(), { names: [] });
    assert.equal(zero.clusters.length, 14);
    U.upkeepState(host.chatMetadata).queue.push(...zero.clusters);
    setMode({});
    const before = mockRows().length;
    const res = await U.runTidy({ context: host, store, runChainFn: viaMock, books: [] });
    const calls = mockRows().slice(before).filter(r => r.kind === 'tidy');
    assert.deepEqual(calls.map(r => (r.messages[1].content.match(/^Cluster /gm) || []).length), [6, 6, 2]);
    assert.equal(res.counts.merge, 14);
    assert.equal(U.upkeepState(host.chatMetadata).queue.length, 0);
});

// ---------------------------------------------------------------- 4. TunnelVision's five planted entries

function haleBook() {
    const lore = JSON.parse(fs.readFileSync(path.join(here, '..', 'docs', 'roleplay-cards', 'hale-of-verath', 'Hale of Verath - World Info.json'), 'utf8'));
    const planted = JSON.parse(fs.readFileSync(path.join(DOCS, 'memory', 'evidence', 'MB11', 'fixtures', 'planted_tv.json'), 'utf8'));
    const data = structuredClone(lore);
    let uid = Math.max(...Object.keys(data.entries).map(Number)) + 1;
    const plants = [];
    for (const p of planted.entries) { data.entries[uid] = { ...structuredClone(BW.ENTRY_DEFAULTS), uid, displayIndex: uid, key: p.key, comment: p.comment, content: p.content }; plants.push({ uid, ...p }); uid += 1; }
    return { data, plants };
}
async function fileStory100(store) {
    const story = JSON.parse(fs.readFileSync(path.join(DOCS, 'memory', 'evidence', 'MB11', 'fixtures', 'story100.json'), 'utf8'));
    const kinds = { profile: 'person', arc: 'thread', seed: 'thread', agenda: 'thread', knowledge: 'secret' };
    const aliases = { orla: ['the harbormaster'], edren: ['the squire'], 'veck-patrol': ['Captain Veck'], 'pip-saw': [], 'marten-arm-cut': ['Ser Marten'] };
    const seen = new Set();
    for (const t of story.turns) for (const c of t.update?.changes || []) {
        const record = { id: c.id, kind: kinds[c.kind] || c.kind, subject: c.subject, text: c.text, status: 'current', importance: 7, ...(aliases[c.id] ? { aliases: aliases[c.id] } : {}) };
        await store.recordOnReply(reply(t.n), [{ op: seen.has(c.id) ? 'revise' : 'add', target: seen.has(c.id) ? [c.id] : [], record, origin: { type: 'capture' }, evidence: [{ quote: c.evidence || c.text.slice(0, 40) }] }]);
        seen.add(c.id);
    }
    // Two people the story made that the book does not hold.
    await store.recordOnReply(reply(59), [{ op: 'add', record: { id: 'pip', kind: 'person', subject: 'Pip', text: 'Pip is a fishing boy at the Saltmar causeway.', aliases: ['the fishing boy'], status: 'current', importance: 6 }, origin: { type: 'capture' } }]);
    return story;
}

test('after a full run with TunnelVision\'s five planted entries your text, keys and settings are byte-identical, every change is a logged addition, and the review list holds the clashes', { skip: !HAS_DOCS && 'docs/ is missing' }, async () => {
    const store = freshChat(102, { id: 'mb7-tv' });
    await fileStory100(store);
    const name = 'Hale of Verath - World Info';
    const { data, plants } = haleBook();
    const original = JSON.stringify(data);
    books.set(name, data);
    const io = { loadBook: async n => structuredClone(books.get(n)), saveBook: async (n, d) => { books.set(n, structuredClone(d)); }, now: () => (clock += 1000) };
    // Level 0 and the additions the book allows, at a chapter close, on the book bound to this chat (Keywords, lines and entries).
    const result = view();
    const zero = U.levelZero(result, { names: CAST });
    if (zero.merges.length) await store.record(zero.merges);
    U.upkeepState(host.chatMetadata).queue.push(...zero.clusters);
    const run = await A.runAdditions({ books: [{ name, roles: ['Host chat attachment'] }], io, meta: host.chatMetadata, records: view().current, chapters: [], atClose: true });
    const kinds = run.made.reduce((o, row) => ({ ...o, [row.kind]: (o[row.kind] || 0) + 1 }), {});
    assert.ok(kinds.key > 0 && kinds.line > 0 && kinds.entry > 0, `keywords, lines and entries were added: ${JSON.stringify(kinds)}`);
    for (const row of run.made) assert.ok(row.book === name && row.uid !== undefined && row.value && row.source?.mark, 'each addition is logged with its book, entry, text and source reply');
    // Tidy, with the five planted pairs ruled by the mock as a judge would rule them.
    const after = books.get(name);
    const pairs = FL.entryPairs([{ name, data: after }], view().records, { limit: 80 });
    const entries = {};
    for (const p of plants) {
        const partner = Object.values(after.entries).find(e => e.comment === p.pairWith);
        const pair = pairs.find(x => [x.a.uid, x.b.uid].includes(p.uid) && [x.a.uid, x.b.uid].includes(partner.uid));
        assert.ok(pair, `the planted ${p.comment} is paired with your ${p.pairWith} by code`);
        entries[pair.pair] = p.verdict === 'contradiction' ? 'clash' : 'duplicate';
    }
    setMode({ tidy: { entries } });
    const before = JSON.stringify(books.get(name));
    const tidy = await U.runTidy({ context: host, store, runChainFn: viaMock, books: [{ name, data: after }] });
    assert.equal(JSON.stringify(books.get(name)), before, 'Tidy changes nothing in your book');
    const list = FL.reviewList(host.chat, host.chatMetadata, view());
    const entryFlags = list.filter(f => [FL.FLAG_KINDS.entryDuplicate, FL.FLAG_KINDS.entryContradiction].includes(f.kind));
    assert.equal(entryFlags.length, 5, 'five flags in the review list');
    assert.equal(entryFlags.filter(f => f.kind === FL.FLAG_KINDS.entryDuplicate).length, 4);
    assert.equal(entryFlags.filter(f => f.kind === FL.FLAG_KINDS.entryContradiction).length, 1);
    assert.ok(entryFlags.every(f => f.mine.text && f.theirs.text && f.actions.length === 4), 'each flag shows both texts and the four actions');
    // Every change to the book is a logged addition: taking back exactly the logged additions gives the book you wrote, byte for byte.
    const final = books.get(name);
    assert.equal(JSON.stringify(A.withoutAdditions(final, A.additionsLog(host.chatMetadata))), original);
    for (const p of plants) assert.equal(final.entries[p.uid].comment, p.comment, 'no planted entry is renamed');
    for (const e of Object.values(final.entries)) assert.equal(e.disable, JSON.parse(original).entries[e.uid]?.disable ?? false, 'no entry is disabled or enabled');
    assert.deepEqual(A.foreignFields(final), [], 'additions add no field of ours');
    for (const row of run.made.filter(r => r.kind !== 'key')) written.push(row.value);
    // The four actions.
    const store2 = store;
    const [dup, contra] = [entryFlags.find(f => f.kind === FL.FLAG_KINDS.entryDuplicate), entryFlags.find(f => f.kind === FL.FLAG_KINDS.entryContradiction)];
    let opened = null;
    assert.equal((await FL.resolveFlag(store2, dup, 'edit-mine', { openBook: (b, u) => { opened = { b, u }; return true; } })).opened, true);
    assert.deepEqual(opened, { b: name, u: dup.mine.uid });
    await FL.resolveFlag(store2, dup, 'keep-mine');
    assert.ok(!FL.reviewList(host.chat, host.chatMetadata, view()).some(f => f.pair === dup.pair), 'Keep mine takes it off the list');
    const again = FL.entryPairs([{ name, data: final }], view().records, { kept: FL.keptPairs(host.chat, host.chatMetadata, view()), limit: 80 });
    assert.ok(!again.some(p => p.pair === dup.pair), 'and code does not raise the pair again');
    const changed = await FL.resolveFlag(store2, contra, 'story-changed');
    const story = view().byId.get(changed.record);
    assert.ok(story && story.locked && story.overrides.uid === contra.mine.uid, 'The story changed files a locked record for this chat');
    assert.deepEqual(FL.overriddenEntries(view()).map(o => o.uid), [contra.mine.uid], 'injection can leave the entry out for this chat');
    assert.equal(JSON.stringify(books.get(name)), JSON.stringify(final), 'and the entry stays as written');
    written.push(story.text);
    const third = FL.reviewList(host.chat, host.chatMetadata, view()).find(f => f.kind === FL.FLAG_KINDS.entryDuplicate);
    await FL.resolveFlag(store2, third, 'dismiss');
    assert.ok(!FL.reviewList(host.chat, host.chatMetadata, view()).some(f => f.entry === third.entry), 'Dismiss takes it off the list');
    out.tunnelVision = { additions: kinds, tidy: tidy.counts, flags: entryFlags.map(f => ({ kind: f.kind, mine: f.mine.title, theirs: f.theirs.title })) };
});

// ---------------------------------------------------------------- 5. additions leave with their reply

function smallBook() {
    const e = (uid, comment, key, content, extra = {}) => ({ ...structuredClone(BW.ENTRY_DEFAULTS), uid, displayIndex: uid, comment, key, content, ...extra });
    return { entries: { 0: e(0, 'Night', ['Night', "Hale's horse"], "Night is Hale's black destrier."), 1: e(1, 'Ser Marten Drey', ['Marten'], 'Ser Marten Drey is a knight of the Vanguard.') } };
}
async function smallStory(store) {
    await file(store, reply(1), { id: 'pip', kind: 'person', subject: 'Pip', text: 'Pip is a fishing boy at the Saltmar causeway.', aliases: ['the fishing boy'], status: 'current', importance: 6 });
    await file(store, reply(2), rec('night-shoe', 'Night', "Hobb fitted Night with a new iron shoe on the left fore.", { importance: 7 }));
    await file(store, reply(3), rec('night-name', 'Night', 'The riders call Night the black.', { importance: 4, aliases: ['the black'] }));
}
const bookIo = () => ({ loadBook: async n => structuredClone(books.get(n)), saveBook: async (n, d) => { books.set(n, structuredClone(d)); }, now: () => (clock += 1000) });
async function addAll(name = 'Bound book', roles = ['Host chat attachment'], atClose = true) {
    books.set(name, smallBook());
    return A.runAdditions({ books: [{ name, roles }], io: bookIo(), meta: host.chatMetadata, records: view().current, chapters: [], atClose });
}

test('deleting the reply that caused an addition removes exactly that addition', async () => {
    const store = freshChat(4);
    await smallStory(store);
    const original = JSON.stringify(smallBook());
    const run = await addAll();
    assert.deepEqual(run.made.map(r => r.kind).sort(), ['entry', 'key', 'line']);
    host.chat.splice(reply(3), 1);                                   // delete reply 3, the source of "the black"
    const res = await A.reconcileAdditions({ io: bookIo(), meta: host.chatMetadata, chat: host.chat });
    assert.deepEqual(res.removed.map(r => r.value), ['the black']);
    const book = books.get('Bound book');
    assert.ok(!book.entries[0].key.includes('the black'));
    assert.match(book.entries[0].content, /Since chapter 1: Hobb fitted Night/, 'the line from reply 2 stays');
    assert.ok(Object.values(book.entries).some(e => e.comment === 'Pip'), 'the entry from reply 1 stays');
    // Deleting the rest takes the book back to what you wrote, byte for byte.
    host.chat.splice(1);
    await A.reconcileAdditions({ io: bookIo(), meta: host.chatMetadata, chat: host.chat });
    assert.equal(JSON.stringify(books.get('Bound book')), original);
});

test('swiping away the reply that caused an addition removes exactly that addition', async () => {
    const store = freshChat(4);
    await smallStory(store);
    await addAll();
    const m = host.chat[reply(2)];
    m.swipes.push('Reply 2, another version.'); m.swipe_info.push({ send_date: m.send_date, extra: {} }); m.swipe_id = 1; m.mes = m.swipes[1];
    const res = await A.reconcileAdditions({ io: bookIo(), meta: host.chatMetadata, chat: host.chat });
    assert.deepEqual(res.removed.map(r => r.kind), ['line']);
    assert.doesNotMatch(books.get('Bound book').entries[0].content, /Hobb/);
    assert.ok(books.get('Bound book').entries[0].key.includes('the black'), 'the keyword from reply 3 stays');
});

test('branching before the reply that caused an addition removes exactly that addition', async () => {
    const store = freshChat(4);
    await smallStory(store);
    await addAll();
    // A branch at reply 1: SillyTavern copies the messages up to the branch point and the chat metadata.
    host.chat = host.chat.slice(0, reply(1) + 1);
    host.chatMetadata = structuredClone(host.chatMetadata);
    const res = await A.reconcileAdditions({ io: bookIo(), meta: host.chatMetadata, chat: host.chat });
    assert.deepEqual(res.removed.map(r => r.kind).sort(), ['key', 'line']);
    assert.ok(Object.values(books.get('Bound book').entries).some(e => e.comment === 'Pip'), 'the entry from reply 1, before the branch point, stays');
    void store;
});

test('an addition you edited afterwards stays as your text, with a note in History', async () => {
    const store = freshChat(4);
    await smallStory(store);
    await addAll();
    const book = books.get('Bound book');
    book.entries[0].content += ' (checked by me)';                    // you typed after the added line
    const pip = Object.values(book.entries).find(e => e.comment === 'Pip');
    pip.content = 'Pip is a fishing boy who saw the wagons.';
    books.set('Bound book', book);
    host.chat.splice(1);                                              // every source reply leaves
    const res = await A.reconcileAdditions({ io: bookIo(), meta: host.chatMetadata, chat: host.chat });
    assert.deepEqual(res.kept.map(r => r.kind).sort(), ['entry', 'line']);
    assert.deepEqual(res.removed.map(r => r.kind), ['key']);
    const now = books.get('Bound book');
    assert.match(now.entries[0].content, /Hobb fitted Night.*\(checked by me\)/, 'the edited line stays');
    assert.ok(Object.values(now.entries).some(e => e.comment === 'Pip'), 'the edited entry stays');
    const rows = U.historyRows(host.chat, host.chatMetadata, { jobs: ['additions'] });
    assert.ok(rows.filter(r => /your text/.test(r.note)).length === 2, 'History notes that they are yours now');
    void store;
});

// ---------------------------------------------------------------- 6. levels and Constant entries

test('a global or character book at Keywords only receives keywords and nothing else; Off receives nothing', async () => {
    assert.equal(A.defaultLevel(['Host character attachment']), 'keywords');
    assert.equal(A.defaultLevel(['Host global selection']), 'keywords');
    assert.equal(A.defaultLevel(['Host persona attachment']), 'keywords');
    assert.equal(A.defaultLevel(['Host chat attachment']), 'full');
    const store = freshChat(4);
    await smallStory(store);
    const original = smallBook();
    const run = await addAll('Character book', ['Host character attachment']);
    assert.deepEqual(run.made.map(r => r.kind), ['key']);
    const book = books.get('Character book');
    assert.equal(Object.keys(book.entries).length, 2, 'no entry added');
    for (const uid of [0, 1]) assert.equal(book.entries[uid].content, original.entries[uid].content, 'no line added');
    books.set('Off book', smallBook());
    const off = await A.runAdditions({ books: [{ name: 'Off book', roles: ['Host chat attachment'] }], io: bookIo(), meta: host.chatMetadata, records: view().current, saved: { 'Off book': 'off' }, atClose: true });
    assert.equal(off.made.length, 0);
    assert.equal(JSON.stringify(books.get('Off book')), JSON.stringify(smallBook()));
});

test('an addition to a Constant entry lands only at a chapter close', async () => {
    const store = freshChat(4);
    await smallStory(store);
    const book = smallBook();
    book.entries[0].constant = true;
    books.set('Bound book', book);
    const io = bookIo();
    const between = await A.runAdditions({ books: [{ name: 'Bound book', roles: ['Host chat attachment'] }], io, meta: host.chatMetadata, records: view().current, atClose: false });
    assert.ok(!between.made.some(r => r.uid === 0), 'nothing reaches the Constant entry between chapters');
    assert.equal(books.get('Bound book').entries[0].content, book.entries[0].content);
    const close = await A.runAdditions({ books: [{ name: 'Bound book', roles: ['Host chat attachment'] }], io, meta: host.chatMetadata, records: view().current, atClose: true });
    assert.deepEqual(close.made.filter(r => r.uid === 0).map(r => r.kind).sort(), ['key', 'line'], 'at the chapter close the keyword and the line land');
});

// ---------------------------------------------------------------- 7. export

test('a book with additions holds only SillyTavern\'s own fields, and its export is the same book', async () => {
    const store = freshChat(4);
    await smallStory(store);
    await addAll();
    const book = books.get('Bound book');
    assert.deepEqual(A.foreignFields(book), []);
    assert.equal(JSON.stringify(A.exportBook(book)), JSON.stringify(book));
    for (const e of Object.values(book.entries)) for (const field of Object.keys(BW.ENTRY_DEFAULTS)) assert.ok(field in e, `entry ${e.uid} has ${field}`);
    void store;
});

// ---------------------------------------------------------------- 8. Story changes, History, Undo and Restore across a reload

function reload() {
    const chat = JSON.parse(JSON.stringify(host.chat)), meta = JSON.parse(JSON.stringify(host.chatMetadata));
    host.chat = chat; host.chatMetadata = meta;
    return S.createStore({ chat: () => host.chat, meta: () => host.chatMetadata, chatId: () => host.getCurrentChatId(), save: async () => {}, now: () => (clock += 1000) });
}

test('every automatic change shows in Story changes and History; Undo and Restore work after a reload', async () => {
    let store = freshChat(4);
    await file(store, reply(1), rec('gate-1', 'Crossroads gate', 'The gate is red.', { attribute: 'colour' }));
    await file(store, reply(3), rec('gate-2', 'Crossroads gate', 'The gate is red.', { attribute: 'colour' }));
    const zero = U.levelZero(view());
    await store.record(zero.merges);
    const changes = U.storyChanges(host.chat, host.chatMetadata, reply(3), { result: view() });
    const merge = changes.find(r => r.op === 'merge');
    assert.ok(merge && merge.job === 'level0' && merge.undo, 'the code merge shows on the reply that caused it, with Undo');
    assert.ok(changes.some(r => r.op === 'add' && r.job === 'capture'), 'and capture\'s filing of that reply');
    assert.deepEqual(merge.restore, ['gate-2'], 'and Restore for the record it retired');
    assert.ok(U.historyRows(host.chat, host.chatMetadata, { jobs: ['level0'] }).some(r => r.entry === merge.entry), 'History lists it under Code upkeep');
    // Restore, then reload.
    await U.restoreRecord('gate-2', { store });
    store = reload();
    assert.equal(view().byId.get('gate-2').status, 'current', 'Restore survives a reload');
    // Undo the restore's effect again with Undo on the merge row after another merge, then reload.
    await store.record(U.levelZero(view()).merges);
    const row = U.historyRows(host.chat, host.chatMetadata, { jobs: ['level0'] }).find(r => r.counts && r.op === 'merge');
    await U.undoChange(row, { context: host, store });
    store = reload();
    assert.equal(view().byId.get('gate-2').status, 'current', 'Undo survives a reload');
    const undone = U.historyRows(host.chat, host.chatMetadata, { jobs: ['level0'] }).find(r => r.entry === row.entry);
    assert.equal(undone.counts, false);
    assert.equal(undone.note, 'reverted');
    // Undo of an addition from History removes it from the book the same way, and survives a reload.
    await smallStory(store);
    await addAll();
    const addition = U.historyRows(host.chat, host.chatMetadata, { jobs: ['additions'] }).find(r => r.op === 'key');
    await U.undoChange(addition, { context: host, store });
    store = reload();
    assert.ok(!(await host.loadWorldInfo('Bound book')).entries[0].key.includes('the black'), 'Undo took the keyword back out of the book');
    assert.equal(A.additionsLog(host.chatMetadata).find(r => r.id === addition.entry).state, 'undone');
    out.history = { rows: U.historyRows(host.chat, host.chatMetadata).length };
});

// ---------------------------------------------------------------- 9. precision per verdict class (M1f question 1)

function story100Versions() {
    const story = JSON.parse(fs.readFileSync(path.join(DOCS, 'memory', 'evidence', 'MB11', 'fixtures', 'story100.json'), 'utf8'));
    const recs = [], seen = new Set();
    const kinds = { profile: 'person', arc: 'thread', seed: 'thread', agenda: 'thread', knowledge: 'secret' };
    for (const t of story.turns) for (const c of t.update?.changes || []) {
        if (seen.has(`${c.id}|${c.text}`)) continue;
        seen.add(`${c.id}|${c.text}`);
        const n = recs.filter(r => r.base === c.id).length;
        recs.push({ id: n ? `${c.id}@${t.n}` : c.id, base: c.id, kind: kinds[c.kind] || c.kind, subject: c.subject, text: c.text, quote: c.evidence });
    }
    return recs;
}
function precision(pairs, labels) {
    const label = p => labels[`${p.a}|${p.b}`] || labels[`${p.b}|${p.a}`] || 'distinct';
    const correct = { duplicate: ['duplicate'], 'supersede?': ['supersede'], 'merge?': ['enrich', 'supersede', 'duplicate'], linked: ['linked'], related: ['enrich', 'supersede', 'duplicate', 'linked', 'distinct'] };
    const strict = { 'merge?': ['enrich'] };
    const byClass = {};
    for (const v of SIM.VERDICTS) {
        const got = pairs.filter(p => p.verdict === v);
        const hit = got.filter(p => correct[v].includes(label(p)));
        byClass[v] = { flagged: got.length, correct: hit.length, precision: got.length ? +(hit.length / got.length).toFixed(2) : null, ...(strict[v] ? { strict: got.length ? +(got.filter(p => strict[v].includes(label(p))).length / got.length).toFixed(2) : null } : {}), wrong: got.filter(p => !correct[v].includes(label(p))).map(p => `${p.a}/${p.b}: ${label(p)}`) };
    }
    const needsModel = Object.entries(labels).filter(([, l]) => ['supersede', 'enrich', 'duplicate'].includes(l)).map(([k]) => k);
    const found = needsModel.filter(k => { const [a, b] = k.split('|'); return pairs.some(p => ['duplicate', 'supersede?', 'merge?'].includes(p.verdict) && ((p.a === a && p.b === b) || (p.a === b && p.b === a))); });
    return { byClass, recall: { labelled: needsModel.length, queued: found.length, missed: needsModel.filter(k => !found.includes(k)) } };
}

test('precision of the code candidate rules per verdict class, on the tuning set and a held-out set', { skip: !HAS_DOCS && 'docs/ is missing' }, () => {
    const labels = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'pair-labels.json'), 'utf8'));
    const tuning = m1aRecords().map(x => ({ ...x.record, quote: x.quote }));
    const tune = precision(SIM.candidatePairs(tuning, { names: CAST }), labels.tuning);
    const held = precision(SIM.candidatePairs(story100Versions(), { names: CAST }), labels.heldout);
    assert.equal(tune.byClass['supersede?'].precision, 1, 'tuning set: both planted pairs, nothing else');
    assert.equal(tune.byClass['merge?'].precision, 1);
    assert.ok(held.byClass['supersede?'].precision >= 0.8, `held-out supersede? precision ${held.byClass['supersede?'].precision}`);
    assert.ok(held.byClass['merge?'].precision >= 0.7, `held-out merge? precision ${held.byClass['merge?'].precision}`);
    out.precision = { tuning: tune, heldout: held };
    if (process.env.RI_WRITE_EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, 'precision.json'), JSON.stringify(out.precision, null, 1)); }
});

test('level 0 pair finding stays fast on a 2,000-record store: only pairs that share a subject or a quote are scored', () => {
    const records = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, kind: 'fact', subject: `Name${i % 200}`, text: `Record ${i}: Name${i % 200} rode to the north gate with ${i % 13} riders and a lantern.` }));
    const started = performance.now();
    const pairs = SIM.candidatePairs(records);
    const ms = performance.now() - started;
    assert.ok(ms < 500, `${Math.round(ms)} ms on the desktop (M1d expects a phone core 2 to 4 times slower)`);
    assert.ok(pairs.every(p => records.find(r => r.id === p.a).subject === records.find(r => r.id === p.b).subject));
    out.timing = { records: 2000, ms: Math.round(ms), pairs: pairs.length };
});

test('thresholds are named for their measure; a setting read under another measure throws', () => {
    assert.deepEqual(SIM.selfTestThresholds(), []);
    assert.ok(SIM.selfTestThresholds({ ...SIM.THRESHOLDS, vectorDedupThreshold: { measure: 'cosine', value: 0.85 } }).length >= 1, "TunnelVision's mixed setting fails");
    assert.throws(() => SIM.threshold('diceNearDuplicate', 'jaccard'));
});

test('level 0 code work: thread closing candidates, the recall pool and one copy of a fact across your books', async () => {
    const store = freshChat(6);
    await file(store, reply(1), { id: 'valen-toll', kind: 'thread', threadType: 'Seed', subject: 'Valen Ford toll', text: 'Lord Darius doubled the toll at Valen Ford, and every rider must pay.', status: 'current', importance: 6 });
    await file(store, reply(2), rec('night-black', 'Night', "Night is Hale's black destrier."));
    await file(store, reply(3), { id: 'old-plan', kind: 'thread', subject: 'Plan', text: 'Ride north.', status: 'done', importance: 3 });
    const exchanges = [3, 4, 5].map(r => ({ index: reply(r), text: r === 4 ? 'At Valen Ford Hale counted out a hundred silver for the toll and the column crossed.' : `Reply ${r}: the column rides on.`, header: r === 4 ? 'Valen Ford' : '' }));
    assert.equal(U.threadCandidates(view().records, exchanges)['valen-toll'][0], reply(4));
    const pool = U.recallPool(view(), { chapters: [{ toIndex: reply(5) }] });
    assert.ok(!pool.some(p => p.id === 'old-plan'), 'a closed thread ages out after the chapter that closed it');
    assert.deepEqual(U.repeatsOfEntries(view().current, [{ content: "Night is Hale's black destrier, bigger than most." }]), ['night-black']);
});

// ---------------------------------------------------------------- the correction search on the record store

test('the correction search reads the record store: one source per current record, none before memory moved', async () => {
    const store = freshChat(3);
    await file(store, reply(1), rec('night-black', 'Night', "Night is Hale's black destrier."));
    const sources = CR.recordSources(host.chat, host.chatMetadata);
    assert.deepEqual(sources.map(s => [s.id, s.kind, s.before]), [['record:night-black', 'record', "Night is Hale's black destrier."]]);
    assert.deepEqual(CR.recordSources(host.chat, { [F.MEMORY]: { log: [] } }), []);
});

// ---------------------------------------------------------------- 10. the report register

test('everything this ticket writes as record follows the report register (MB11 register scorer)', { skip: !HAS_DOCS && 'docs/ is missing' }, () => {
    assert.ok(written.length >= 5, `${written.length} texts collected`);
    const flagged = written.map(t => [t, register.moodHits(t)]).filter(([, hits]) => hits.length);
    assert.deepEqual(flagged, []);
    assert.match(U.TIDY_RULES, /incident report/, 'the Cleanup prompt carries the register rule');
    out.register = { scanned: written.length, flagged: flagged.length };
});
