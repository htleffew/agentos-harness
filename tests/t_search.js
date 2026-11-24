// MB4: search and recall (memory DESIGN 4). Run with:
//   node --test tests/t_search.js
// The suite runs on the mock model: a deterministic embedder stands in for all-MiniLM-L6-v2. Rows that need the real model
// (the 256-token limit by the model's own tokenizer, the section 13 Retrieval row, the 12 reworded Hale questions, query
// timings) run when RI_TRANSFORMERS_NODE names a node_modules folder that holds @huggingface/transformers; the model
// downloads once into RI_MODEL_CACHE (default: a folder beside it). Set RI_EVIDENCE_MB4 to a folder to save results.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fresh } from './fixtures/mb2/story-play.mjs';
import { memoryItems } from '../src/memory/device-db.js';
import { createEmbedder, expandRuntime, hashEmbedder, modelCache, ollamaBooster, SEARCH_MODEL } from '../src/memory/embed.js';
import { createSearchIndex, hiddenQuotesFor, sourcesFromChat } from '../src/memory/index.js';
import {
    MEASURES, SEARCH, THRESHOLD_SPEC, aliasGroups, approxTokens, buildUnits, chapterSecretLines, createThresholds, createWordIndex, cosine,
    cutToUnits, dice, expandQuery, holderAllows, loreHolderOk, renderBlock, renderItem, rrf, searchTurn, selfTestThresholds,
} from '../src/memory/search.js';
import { bookTraits, entryHasFilters, entryIsBehavior, entryIsManaged, recallOffered, takeFiredEntries } from '../src/book-triggers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const EVIDENCE = process.env.RI_EVIDENCE_MB4 || '';
const NODE_LIB = process.env.RI_TRANSFORMERS_NODE || '';
const saved = {};
const save = (name, value) => { saved[name] = value; if (EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, `${name}.json`), JSON.stringify(value, null, 1)); } };

async function realEmbedder() {
    const cacheDir = process.env.RI_MODEL_CACHE || path.join(NODE_LIB, '..', 'modelcache');
    const e = createEmbedder({
        loadLibrary: () => import(pathToFileURL(path.join(NODE_LIB, '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')).href),
        device: null,
        configure: env => { env.cacheDir = cacheDir; },
    });
    assert.equal(await e.load(), true, JSON.stringify(e.status()));
    return e;
}

const record = (id, subject, text, extra = {}) => ({ id, kind: 'fact', subject, text, importance: 5, srcTurn: 1, ...extra });
const unitsOf = (records, count = approxTokens) => buildUnits({ records, count });
const mapOf = records => new Map(records.map(r => [r.id, r]));

// ---------------------------------------------------------------- the library ships with the extension

test('the libraries ship in vendor/ with their licences and pinned versions', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'vendor.json'), 'utf8'));
    for (const item of manifest.libraries) {
        assert.match(item.version, /^\d+\.\d+\.\d+/, `${item.name} has a version`);
        assert.ok(item.source.startsWith('https://registry.npmjs.org/') || item.source.startsWith('https://cdn.jsdelivr.net/'), `${item.name} comes from npm or jsDelivr`);
        for (const file of item.files) {
            const bytes = fs.readFileSync(path.join(root, 'vendor', file.path));
            assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path} matches its pinned hash`);
        }
        assert.ok(item.files.some(file => /licen[cs]e/i.test(file.path)), `${item.name} keeps its licence file`);
    }
    assert.deepEqual(manifest.libraries.map(item => item.name).sort(), ['minisearch', 'onnxruntime-web', 'stemmer', 'transformers.js']);
    assert.equal(manifest.model.id, 'Xenova/all-MiniLM-L6-v2');
    for (const item of manifest.libraries) for (const file of item.files) assert.ok(fs.statSync(path.join(root, 'vendor', file.path)).size < 10 * 1024 * 1024, `${file.path} is under the repository's 10 MB file limit`);
    const wasm = manifest.libraries.flatMap(item => item.files).find(file => file.path.endsWith('.wasm.gz'));
    assert.ok(wasm && wasm.bytes > 1e6, 'the WebAssembly runtime is in the extension');
});

test('the WebAssembly runtime is stored gzipped and expands to the pinned bytes', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'vendor', 'vendor.json'), 'utf8'));
    const wasm = manifest.libraries.flatMap(item => item.files).find(file => file.path.endsWith('.wasm.gz'));
    const stored = fs.readFileSync(path.join(root, 'vendor', wasm.path));
    const bytes = await expandRuntime(async () => ({ ok: true, status: 200, arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) }), 'x');
    assert.equal(bytes.length, wasm.uncompressedBytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), wasm.uncompressedSha256);
    assert.deepEqual([...bytes.slice(0, 4)], [0x00, 0x61, 0x73, 0x6d], 'a WebAssembly module');
    // a server that expanded the file already is read as it is
    const plain = await expandRuntime(async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(0, 16) }), 'x');
    assert.equal(plain.length, 16);
    await assert.rejects(expandRuntime(async () => ({ ok: false, status: 404 }), 'x'), /did not load \(404\)/);
});

test('the search model is all-MiniLM-L6-v2 at q8 and the runtime loads from the extension folder', () => {
    assert.equal(SEARCH_MODEL.repo, 'Xenova/all-MiniLM-L6-v2');
    assert.equal(SEARCH_MODEL.dtype, 'q8');
    assert.equal(SEARCH_MODEL.dim, 384);
    assert.equal(SEARCH_MODEL.maxTokens, 256);
    const source = fs.readFileSync(path.join(root, 'src', 'memory', 'embed.js'), 'utf8');
    assert.ok(source.includes('vendor/transformers/'), 'the library path is inside the extension');
    assert.ok(!/cdn\.jsdelivr|unpkg|cdnjs/i.test(source), 'no run-time library fetch');
});

// ---------------------------------------------------------------- units fit the model (4.1)

test('every unit, header included, is cut to fit the token limit, and every piece keeps its header', () => {
    const sentence = 'The column rode out of Elerian Keep before dawn with ten riders and a sealed letter for the General.';
    const body = Array.from({ length: 80 }, (_, i) => `${sentence} Mile ${i}.`).join(' ');
    const header = 'Chapter 3: the Saltmar road | Blossomtide 14 | Hale, Heather';
    const pieces = cutToUnits(header, body, approxTokens, 256);
    assert.ok(pieces.length > 3);
    for (const piece of pieces) { assert.ok(approxTokens(piece) <= 256, `${approxTokens(piece)} tokens`); assert.ok(piece.startsWith(header)); }
    // one sentence longer than a unit is cut at words
    const long = cutToUnits('Header', Array.from({ length: 400 }, (_, i) => `word${i}`).join(' '), approxTokens, 256);
    assert.ok(long.length > 1 && long.every(piece => approxTokens(piece) <= 256));
    // nothing is lost: every sentence is in some piece
    const all = pieces.join(' ');
    for (let i = 0; i < 80; i += 9) assert.ok(all.includes(`Mile ${i}.`));
});

test('records, chapters, exchanges of closed chapters and managed book entries become units; the open chapter does not', async () => {
    const p = await fresh(34);
    const sources = sourcesFromChat({ chat: p.chat, result: p.fold() });
    assert.equal(sources.chapters.length, 3, 'three chapters closed in 34 turns');
    assert.equal(sources.exchanges.length, 30, 'only the exchanges of closed chapters');
    const units = buildUnits({ ...sources, entries: [{ book: 'Lore', uid: 1, title: 'Night', content: 'A black horse.' }] });
    const types = units.reduce((o, u) => (o[u.type] = (o[u.type] || 0) + 1, o), {});
    assert.ok(types.record > 20 && types.chapter >= 3 && types.exchange >= 30 && types.lore === 1, JSON.stringify(types));
    assert.ok(units.every(u => u.type !== 'exchange' || u.text.startsWith('Chapter ')), 'every exchange unit starts with its header line');
    assert.ok(!units.some(u => u.id.startsWith('rec:scene')), 'the current scene is a tracker value, not a unit');
    const last = sources.exchanges.at(-1).srcTurn;
    assert.ok(last <= 30, `the newest indexed exchange is from reply ${last}, inside the third chapter`);
});

test('a replaced or retired record is not searchable, and a revised one is searched at its newest text', async () => {
    const p = await fresh(30);
    const result = p.fold();
    const ids = new Set(result.current.map(r => r.id));
    const gone = result.records.filter(r => !ids.has(r.id));
    assert.ok(gone.length > 0, 'the story replaced at least one record');
    const units = buildUnits(sourcesFromChat({ chat: p.chat, result }));
    for (const r of gone) assert.ok(!units.some(u => u.id === `rec:${r.id}`), `${r.id} stays out`);
});

// ---------------------------------------------------------------- word search, fusion, scoring

test('word search stems, ignores filler and counts a repeated word once', () => {
    const word = createWordIndex();
    const units = unitsOf([record('a', 'Night', 'The horses refused the ford and bolted.'), record('b', 'Hale', 'He keeps a bird button.'), record('c', 'Edren', 'The armorer packed waterskins.')]);
    for (const u of units) word.add(u);
    assert.equal(word.search('a horse that refuses')[0].id, 'rec:a');
    assert.equal(word.search('Hale Hale Hale Hale')[0].id, 'rec:b');
    assert.deepEqual(word.search('the and of'), [], 'a query of filler words finds nothing');
    word.remove('rec:a');
    assert.ok(!word.search('horses').length, 'a removed unit is gone');
});

test('RRF merges ranked lists by rank alone at k = 60', () => {
    assert.deepEqual(rrf([['a', 'b', 'c'], ['b', 'a'], ['c', 'b']]).slice(0, 2), ['b', 'a']);
    const score = (rank) => 1 / (60 + rank + 1);
    assert.ok(Math.abs(score(0) - 1 / 61) < 1e-12);
    // a list of another model contributes ranks, never scores: lists with unrelated score scales merge the same way
    assert.deepEqual(rrf([['x', 'y'], ['y', 'x']]), ['x', 'y']);
});

test('query expansion adds the other names of a subject the message uses, and the scene line', () => {
    const groups = aliasGroups([{ subject: 'Aldric', aliases: ['the General', 'Lord Aldric'] }, { subject: 'Night', aliases: [] }]);
    const q = expandQuery({ message: 'Hale asks the General about the road', scene: { place: 'Gatehouse', time: 'Blossomtide 14', present: ['Hale', 'Edren'] }, groups });
    assert.ok(/Aldric/.test(q) && /Lord Aldric/.test(q) && /Gatehouse/.test(q) && /Edren/.test(q));
    assert.ok(!/Night/.test(q), 'a subject the message does not name is not added');
});

test('the score is relevance scaled over the candidates plus 0.99 to the power of the turns since plus importance over ten', () => {
    const records = [record('old', 'Night', 'The shoe is loose.', { srcTurn: 1, importance: 5 }), record('new', 'Night', 'The shoe is tied with hide.', { srcTurn: 90, importance: 5, attribute: 'other' })];
    const units = unitsOf(records);
    const vectors = new Map([['rec:old', [1, 0]], ['rec:new', [1, 0]]]);
    const out = searchTurn({ units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'shoe', turn: 100, word: createWordIndex() }, {});
    const byKey = Object.fromEntries(out.items.map(i => [i.key, i]));
    assert.ok(Math.abs(byKey['rec:new'].recency - Math.pow(0.99, 10)) < 1e-9);
    assert.ok(Math.abs(byKey['rec:old'].recency - Math.pow(0.99, 99)) < 1e-9);
    assert.ok(Math.abs(byKey['rec:new'].score - (1 + Math.pow(0.99, 10) + 0.5)) < 1e-9);
});

// ---------------------------------------------------------------- the filters of step 8

test('a secret goes only when the viewpoint character knows it; a secret only the persona holds stays out', async () => {
    const records = [
        record('s1', 'Heather', 'Marten told Heather he sent a rider to Crossroads.', { kind: 'secret', holders: ['Heather'] }),
        record('s2', 'Hale', 'Heather told Hale about the sealed packet.', { kind: 'secret', holders: ['Hale', 'Heather'] }),
        record('f1', 'Marten', 'Marten sent a rider to Crossroads.'),
    ];
    const units = unitsOf(records);
    const vectors = new Map(units.map(u => [u.id, [1, 0]]));
    const run = pov => searchTurn({ units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'rider packet', turn: 5, pov, word: createWordIndex() }, {}).items.map(i => i.key);
    assert.deepEqual(run('Hale').filter(k => k.startsWith('rec:s')), ['rec:s2']);
    assert.deepEqual(run('Heather').filter(k => k.startsWith('rec:s')).sort(), ['rec:s1', 'rec:s2']);
    assert.ok(holderAllows([], 'Hale') && holderAllows(undefined, 'Hale'), 'a secret with no holders is open to every reader');
    assert.ok(holderAllows(['the General'], 'Aldric', ['the General']), 'the viewpoint character is matched through the names the story uses');
    // with the rule switched off, as the harness fault does, the secret leaks: the self-checking pair of the test above
    const leaked = searchTurn({ units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'rider', turn: 5, pov: 'Hale', word: createWordIndex() }, { holderRule: false }).items.map(i => i.key);
    assert.ok(leaked.includes('rec:s1'));
});

test('a raw exchange excerpt that carries a hidden secret quote is dropped, and so is a chapter secret line', () => {
    const quote = 'sent a rider from Aldermarch to Crossroads';
    const units = buildUnits({ exchanges: [{ id: 'm1', header: 'Chapter 1', reply: `Marten told her he ${quote}. The rain fell.`, srcTurn: 3, records: [] }, { id: 'm2', header: 'Chapter 1', reply: 'The rain fell on the keep.', srcTurn: 4, records: [] }] });
    const vectors = new Map(units.map(u => [u.id, [1, 0]]));
    const out = searchTurn({ units, records: new Map(), vectors, queryVec: [1, 0], query: 'rain rider', turn: 9, pov: 'Hale', hiddenQuotes: [quote], word: createWordIndex() }, {});
    assert.ok(!out.items.some(i => /Aldermarch/.test(i.text || '')), 'the excerpt with the quote stays out');
    assert.ok(out.items.some(i => i.type === 'excerpt'), 'the other excerpt is admitted');
    const chapter = { secrets: [{ text: 'Marten sent the rider.', holders: ['Heather'] }, { text: 'The toll was paid.', holders: [] }, { text: 'Hale owes Darius.', holders: ['Hale'] }] };
    assert.deepEqual(chapterSecretLines(chapter, 'Hale').map(l => l.text), ['The toll was paid.', 'Hale owes Darius.']);
    assert.deepEqual(chapterSecretLines(chapter, 'Heather').map(l => l.text), ['Marten sent the rider.', 'The toll was paid.']);
    assert.ok(!loreHolderOk('Marten sent a rider. Known to: Heather.', 'Hale') && loreHolderOk('Marten sent a rider. Known to: Hale, Heather.', 'Hale'));
});

test('the holder rule holds on the real story chat: a secret only the persona holds is not in the rendered block', async () => {
    const p = await fresh(40);
    const result = p.fold();
    const sources = sourcesFromChat({ chat: p.chat, result });
    const secret = sources.records.find(r => r.id === 'heather-knows-rider');
    assert.ok(secret && secret.holders.length === 1 && secret.holders[0] === 'Heather');
    const index = createSearchIndex({ embedder: hashEmbedder(), db: memoryItems() });
    await index.sync(sources);
    const ask = 'Marten sent a rider from Aldermarch to Crossroads with the route of the column.';
    const as = async pov => {
        const hiddenQuotes = hiddenQuotesFor({ chat: p.chat, meta: p.meta, result, pov, allows: holderAllows });
        const res = await index.search({ message: ask, turn: 41, pov, hiddenQuotes });
        return renderBlock(res.items, {});
    };
    const hale = await as('Hale'), heather = await as('Heather');
    assert.ok(!/heather-knows-rider|sent a rider from Aldermarch/i.test(hale) || !/Marten told Heather he sent a rider/.test(hale), 'Hale is never sent the persona-only secret');
    assert.ok(/Marten told Heather he sent a rider/.test(heather), 'written from the persona, the secret is sent');
    assert.ok(!/Marten told Heather he sent a rider/.test(hale));
});

test('a record that repeats a constant entry already in the prefix drops, and one that replaces it stays with a flag', () => {
    const constant = 'The Elerian Iron Vanguard has two hundred riders under Hale.';
    const records = [record('dup', 'Vanguard', constant), record('chg', 'Vanguard', 'The Elerian Iron Vanguard now has one hundred riders under Hale.', { attribute: 'size' })];
    const units = unitsOf(records);
    const vectors = new Map(units.map(u => [u.id, [1, 0]]));
    const out = searchTurn({ units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'Vanguard riders', turn: 3, staticTexts: [constant], word: createWordIndex() }, {});
    assert.ok(!out.items.some(i => i.key === 'rec:dup'));
    assert.ok(out.dropped.some(d => d.key === 'rec:dup' && /constant/.test(d.reason)));
});

test('between two records of one subject and attribute the later reply stays', () => {
    const records = [record('a', 'Night', 'The shoe is loose.', { attribute: 'left foreshoe', srcTurn: 3 }), record('b', 'Night', 'The shoe is tied with hide.', { attribute: 'left foreshoe', srcTurn: 12 })];
    const units = unitsOf(records);
    const vectors = new Map(units.map(u => [u.id, [1, 0]]));
    const out = searchTurn({ units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'shoe', turn: 20, word: createWordIndex() }, {});
    assert.deepEqual(out.items.map(i => i.key), ['rec:b']);
});

// ---------------------------------------------------------------- admission (step 9)

test('admission follows the cap, the size and the cut, with pinned records first and counted', () => {
    const records = Array.from({ length: 12 }, (_, i) => record(`r${i}`, `S${i}`, `Subject ${i} did a thing number ${i} on the road.`, { srcTurn: i + 1 }));
    const units = unitsOf(records);
    const vectors = new Map(units.map((u, i) => [u.id, i === 11 ? [0.3, 0.95] : [1, 0.05 * i]]));
    const base = { units, records: mapOf(records), vectors, queryVec: [1, 0], query: 'road', turn: 13, word: createWordIndex() };
    const capped = searchTurn(base, {});
    assert.ok(capped.items.length <= SEARCH.itemCap, `cap ${capped.items.length}`);
    assert.ok(!capped.items.some(i => i.key === 'rec:r11'), 'a record below the cosine cut is not admitted');
    const pinned = searchTurn({ ...base, pinned: new Set(['r11']) }, {});
    assert.ok(pinned.items.some(i => i.key === 'rec:r11') && pinned.items.length <= SEARCH.itemCap, 'a pinned record is admitted first and counts toward the cap');
    const tight = searchTurn(base, { tokenCap: 60 });
    assert.ok(tight.tokens <= 60 && tight.items.length < capped.items.length);
    const empty = searchTurn({ ...base, vectors: new Map(units.map(u => [u.id, [1, 0]])), queryVec: [0, 1] }, {});
    assert.equal(renderBlock(empty.items, { scene: { place: 'Gatehouse', time: 'Dusk', present: ['Hale'] } }), '<recall>\n<scene>Gatehouse | Dusk | present: Hale</scene>\n</recall>', 'a block with only the scene line is a valid result');
    assert.equal(renderBlock([], {}), '');
});

test('fired entries of a managed book come first within their own token share, apart from the item cap', () => {
    const fired = [{ book: 'Lore', uid: 1, title: 'Night', content: 'A black stallion.' }, { book: 'Lore', uid: 2, title: 'Saltmar', content: 'A harbor town. '.repeat(60) }];
    const records = [record('a', 'Hale', 'Hale keeps a button.')];
    const units = unitsOf(records);
    const out = searchTurn({ units, records: mapOf(records), vectors: new Map([['rec:a', [1, 0]]]), queryVec: [1, 0], query: 'button', turn: 3, fired, word: createWordIndex() }, { loreShare: 40 });
    assert.deepEqual(out.items.filter(i => i.fired).map(i => i.title), ['Night']);
    assert.ok(out.dropped.some(d => d.key === 'lore:Lore:2' && /share/.test(d.reason)));
    assert.ok(out.items.some(i => i.key === 'rec:a'));
    const block = renderBlock(out.items, {});
    assert.ok(block.indexOf('<lore title="Night">') < block.indexOf('<fact'), 'story order puts the ageless entries first');
});

test('items render in fixed XML with attributes, plain sentences and escaped text', () => {
    const rec = { kind: 'secret', subject: 'Heather', attribute: 'rider', text: 'Marten told her <a rider> left & came back.', story_time: 'Day 3, dusk', holders: ['Hale', 'Brannic'] };
    assert.equal(renderItem({ type: 'record', rec, srcTurn: 34 }), '<secret subject="Heather" attribute="rider" when="Day 3, dusk" from="reply 34" known_by="Hale, Brannic">Marten told her &lt;a rider&gt; left &amp; came back.</secret>');
    assert.equal(renderItem({ type: 'lore', title: 'Night "the black"', text: 'A horse.' }), '<lore title="Night &quot;the black&quot;">A horse.</lore>');
});

// ---------------------------------------------------------------- thresholds named by measure (4.3)

test('the threshold self-test passes as shipped and fails when a cosine setting reaches a Dice comparison, or the reverse', () => {
    assert.deepEqual(selfTestThresholds(), { ok: true, problems: [] });
    assert.deepEqual(Object.fromEntries(Object.entries(THRESHOLD_SPEC).map(([k, v]) => [k, v.measure])), { cosineCut: 'cosine', loreCosineCut: 'cosine', diceNearDuplicate: 'dice' });
    const cosineAsDice = selfTestThresholds({ cosineCut: { measure: 'dice', value: 0.4 }, diceNearDuplicate: THRESHOLD_SPEC.diceNearDuplicate });
    assert.equal(cosineAsDice.ok, false);
    assert.ok(cosineAsDice.problems.some(p => /cosineCut.*(dice|Dice)/.test(p)), cosineAsDice.problems.join(' | '));
    const diceAsCosine = selfTestThresholds({ cosineCut: THRESHOLD_SPEC.cosineCut, diceNearDuplicate: { measure: 'cosine', value: 0.85 } });
    assert.equal(diceAsCosine.ok, false);
    assert.ok(diceAsCosine.problems.some(p => /diceNearDuplicate/.test(p)), diceAsCosine.problems.join(' | '));
    const unnamed = selfTestThresholds({ vectorDedupThreshold: { measure: 'cosine', value: 0.85 }, cosineCut: THRESHOLD_SPEC.cosineCut, diceNearDuplicate: THRESHOLD_SPEC.diceNearDuplicate });
    assert.ok(unnamed.problems.some(p => /vectorDedupThreshold.*does not carry its measure/.test(p)), 'TunnelVision\'s 0.85 in a trigram comparison is caught by name');
    // the comparison itself throws when it reads a threshold of another measure
    const t = createThresholds({ cosineCut: { measure: 'dice', value: 0.4 }, diceNearDuplicate: THRESHOLD_SPEC.diceNearDuplicate });
    assert.throws(() => t.get('cosineCut', 'cosine'), /dice setting and was used in a cosine comparison/);
    assert.throws(() => searchTurn({ units: [], records: new Map() }, { thresholds: t }), /cosineCut/);
    assert.deepEqual(Object.keys(MEASURES).sort(), ['cosine', 'dice']);
    assert.ok(dice('the shoe is loose', 'the shoe is loose') === 1 && cosine([1, 0], [1, 0]) === 1);
});

// ---------------------------------------------------------------- the index, the model id and the booster (4.2)

test('each index stores its model id; switching the model re-indexes; a branch reuses its parent vectors', async () => {
    const p = await fresh(24);
    const sources = sourcesFromChat({ chat: p.chat, result: p.fold() });
    const db = memoryItems();
    const a = hashEmbedder({ dim: 64, id: 'model-a' });
    const one = createSearchIndex({ embedder: a, db });
    await one.sync(sources);
    const built = one.stats.built;
    assert.ok(built > 40 && one.pending() === 0, `${built} vectors built`);
    assert.deepEqual(await db.get('search:model'), { model: 'model-a' });
    assert.ok((await db.keys('vec:model-a:')).length >= built - 1);
    // a branch is another index over the same database: nothing is embedded again
    const branch = createSearchIndex({ embedder: a, db });
    await branch.sync(sources);
    assert.equal(branch.stats.built, 0, 'the branch built nothing');
    assert.ok(branch.stats.reused >= built - 1, 'the branch reused its parent\'s vectors');
    // switching the model drops the old model's vectors and builds new ones under the new id
    const b = hashEmbedder({ dim: 96, id: 'model-b' });
    const two = createSearchIndex({ embedder: b, db });
    await two.sync(sources);
    assert.equal(two.stats.reindexed, true);
    assert.ok(two.stats.built >= built - 1, 're-indexed with the new model');
    assert.equal((await db.keys('vec:model-a:')).length, 0, 'the old model\'s vectors are gone');
    assert.deepEqual(await db.get('search:model'), { model: 'model-b' });
    assert.ok([...two.vectors.values()].every(v => v.length === 96));
});

test('the booster list merges by rank only: its vectors have their own model id, size and scale', async () => {
    const p = await fresh(24);
    const sources = sourcesFromChat({ chat: p.chat, result: p.fold() });
    const db = memoryItems();
    const calls = [];
    const booster = {
        id: 'nomic-embed-text', available: () => true,
        // 768 dimensions against the search model's 64, on a scale of 100: a cosine across the two would be meaningless
        async passages(texts) { calls.push(texts.length); return texts.map(t => Float32Array.from({ length: 768 }, (_, i) => 100 * ((t.length + i) % 7))); },
        async query(text) { return Float32Array.from({ length: 768 }, (_, i) => 100 * ((text.length + i) % 7)); },
    };
    const index = createSearchIndex({ embedder: hashEmbedder({ dim: 64, id: 'model-a' }), booster, db });
    await index.sync(sources);
    const added = await index.fillBooster();
    assert.ok(added > 40 && calls.length > 2, `${added} units embedded by the desktop in batches ${calls.join(',')}`);
    assert.ok((await db.keys('bvec:nomic-embed-text:')).length >= added - 1, 'booster vectors live under their own model id');
    assert.ok((await db.keys('vec:model-a:')).length > 0 && !(await db.keys('vec:')).some(k => k.includes('nomic')));
    const res = await index.search({ message: 'Edren packs the waterskins', turn: 25, options: {} });
    assert.equal(res.mode, 'fused+booster');
    const none = await createSearchIndex({ embedder: hashEmbedder({ dim: 64, id: 'model-a' }), booster: { ...booster, query: async () => null }, db }).sync(sources).then(i => i.search({ message: 'Edren packs the waterskins', turn: 25 }));
    assert.equal(none.mode, 'fused', 'a late or missing booster list is skipped');
});

test('the booster answers within its limit or not at all', async () => {
    const slow = ollamaBooster({ base: 'http://127.0.0.1:1/v1', fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), limitMs: 40 });
    const t0 = Date.now();
    assert.equal(await slow.query('hello'), null);
    assert.ok(Date.now() - t0 < 400, 'it gave up within the limit');
    let body = null;
    const fast = ollamaBooster({ base: 'http://desk:11434/v1', fetchImpl: async (url, init) => { body = { url, ...JSON.parse(init.body) }; return { ok: true, json: async () => ({ embeddings: [[0.5, 0.5]] }) }; } });
    assert.deepEqual([...await fast.query('hello')], [0.5, 0.5]);
    assert.equal(body.url, 'http://desk:11434/api/embed');
    assert.equal(body.model, 'nomic-embed-text');
    assert.equal(body.input[0], 'search_query: hello');
});

test('a search with no model yet is word search alone and still answers', async () => {
    const p = await fresh(24);
    const sources = sourcesFromChat({ chat: p.chat, result: p.fold() });
    const offline = { ...hashEmbedder(), isReady: () => false, load: async () => false };
    const index = createSearchIndex({ embedder: offline, db: memoryItems() });
    await index.sync(sources, { embed: 'none' });
    const res = await index.search({ message: 'Night left foreshoe loose', turn: 25 });
    assert.equal(res.mode, 'word');
    assert.ok(res.items.length > 0 && res.items.every(i => i.type !== 'record' || i.rec.id));
});

// ---------------------------------------------------------------- books Recall manages (4.1, 4.2 step 2)

test('a behavior book is never offered "Recall manages this book" by default', () => {
    const plain = [{ uid: 1, key: ['Night'], content: 'A horse.' }, { uid: 2, key: ['Hale'], content: 'A captain.', constant: true }];
    assert.deepEqual({ kind: recallOffered(plain).kind, offered: recallOffered(plain).offered }, { kind: 'reference', offered: true });
    const chance = [...plain, { uid: 3, key: ['dice'], content: 'A random event.', useProbability: true, probability: 40 }];
    const grouped = [...plain, { uid: 4, key: ['x'], content: 'Group.', group: 'weather' }];
    const timed = [...plain, { uid: 5, key: ['x'], content: 'Timed.', sticky: 3 }, { uid: 6, key: ['y'], content: 'Cool.', cooldown: 2 }];
    const delayed = [...plain, { uid: 7, key: ['x'], content: 'Delayed.', delay: 4 }];
    for (const book of [chance, grouped, timed, delayed]) {
        const offer = recallOffered(book);
        assert.equal(offer.kind, 'behavior');
        assert.equal(offer.offered, false);
    }
    const filtered = [...plain, { uid: 8, key: ['a'], keysecondary: ['b'], selective: true, selectiveLogic: 0, content: 'Filtered.' }];
    assert.deepEqual({ kind: recallOffered(filtered).kind, offered: recallOffered(filtered).offered }, { kind: 'filtered', offered: false });
    assert.equal(bookTraits(chance).chance, 1);
    assert.equal(bookTraits(timed).timing, 2);
    assert.equal(bookTraits(grouped).groups, 1);
    assert.ok(entryHasFilters(filtered[2]) && !entryHasFilters({ selective: true, keysecondary: [] }));
    // a probability of 100, or one the entry does not use, is no chance
    assert.ok(!entryIsBehavior({ useProbability: true, probability: 100 }) && !entryIsBehavior({ useProbability: false, probability: 20 }));
    // and the activation of a behavior entry stays with the host even in a book that was switched on by hand
    for (const e of [chance[2], grouped[2], timed[2], delayed[2]]) assert.equal(entryIsManaged(e), false);
    assert.equal(entryIsManaged(plain[0]), true);
    assert.equal(entryIsManaged(plain[1]), false, 'constant entries stay with the host');
    assert.equal(entryIsManaged({ ...plain[0], disable: true }), false);
});

test('the entries the host fires in a managed book are taken out of the host request; behavior and constant entries are left alone', () => {
    const activated = new Map();
    const add = (world, uid, extra = {}) => activated.set(`${world}.${uid}`, { world, uid, comment: `Entry ${uid}`, content: `Content ${uid}`, key: [`k${uid}`], ...extra });
    add('Lore', 1); add('Lore', 2, { constant: true }); add('Lore', 3, { group: 'weather' }); add('Other', 4);
    const taken = new Map();
    const fresh1 = takeFiredEntries(activated, { isManaged: name => name === 'Lore', taken });
    assert.deepEqual(fresh1.map(e => `${e.book}.${e.uid}`), ['Lore.1']);
    assert.equal(activated.get('Lore.1').content, '', 'the host skips an entry with no content');
    assert.equal(activated.get('Lore.2').content, 'Content 2');
    assert.equal(activated.get('Lore.3').content, 'Content 3');
    assert.equal(activated.get('Other.4').content, 'Content 4');
    // a later pass of the scan finds the same entry already taken
    assert.deepEqual(takeFiredEntries(activated, { isManaged: name => name === 'Lore', taken }), []);
    assert.equal(taken.size, 1);
});

// ---------------------------------------------------------------- the turn: one request, from the host's own inputs

test('the recall turn builds its block from the fold and the host\'s entries; a swipe leaves out what the replaced reply filed', async () => {
    globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, chatMetadata: {} }) };
    const { runRecallTurn } = await import('../src/recall.js');
    const p = await fresh(36);
    const result = p.fold();
    const last = p.chat.length - 1;
    const filedByLast = result.current.filter(r => !['scene', 'chapter'].includes(r.kind) && r.versions.at(-1).index === last);
    assert.ok(filedByLast.length > 0, 'the newest reply filed a record');
    const target = filedByLast[0];
    const parts = () => ({ embedder: hashEmbedder(), booster: null, db: memoryItems() });
    const values = { ...SEARCH };
    const lore = { chatLore: [
        { world: 'Lore', uid: 1, key: ['night'], content: 'Night is the black stallion of Hale, tall and sure of foot.', comment: 'Night' },
        { world: 'Lore', uid: 2, key: ['x'], content: 'A timed omen.', comment: 'Omen', sticky: 3 },
        { world: 'Lore', uid: 3, constant: true, key: [], content: 'The kingdom of Ostrem lies in the north.', comment: 'Ostrem' },
        { world: 'Other', uid: 4, key: ['night'], content: 'A different book entirely.', comment: 'Other' },
    ] };
    const base = { lore, values, managed: name => name === 'Lore' };
    const normal = await runRecallTurn({ ...base, parts: parts(), host: { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'normal', message: target.text } });
    assert.ok(normal.block.includes(target.text.slice(0, 40)), 'a normal turn finds what the newest reply filed');
    assert.ok(normal.block.startsWith('<recall>') && normal.block.endsWith('</recall>'));
    const swipe = await runRecallTurn({ ...base, parts: parts(), host: { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'swipe', message: target.text } });
    assert.ok(!swipe.block.includes(target.text.slice(0, 40)), 'a swipe does not see the records of the reply it replaces');
    // the managed book's plain entry is indexed; a behavior entry, a constant entry and another book's entry are not
    const index = (await import('../src/recall.js')).recallRuntime().index;
    const ids = [...index.units.keys()].filter(id => id.startsWith('lore:'));
    assert.deepEqual(ids, ['lore:Lore:1:0']);
});

// ---------------------------------------------------------------- cost of a query (4.2, M1f question 8)

test('a query costs well under 0.15 s at 2,000 indexed units, and the steps are timed', async () => {
    const records = Array.from({ length: 2000 }, (_, i) => record(`r${i}`, `Subject ${i % 80}`, `Subject ${i % 80} did thing ${i} near place ${i % 37} with person ${i % 53} on day ${i % 90}.`, { srcTurn: (i % 400) + 1, importance: 3 + (i % 7) }));
    const index = createSearchIndex({ embedder: hashEmbedder(), db: memoryItems(), now: () => performance.now() });
    const t0 = performance.now();
    await index.sync({ records, chapters: [], exchanges: [], entries: [], turn: 400 });
    const buildMs = performance.now() - t0;
    assert.equal(index.units.size, 2000);
    const times = [];
    for (let i = 0; i < 25; i++) {
        const res = await index.search({ message: `What did subject ${i} do near place ${i % 37} with person ${i % 53}?`, turn: 401, scene: { place: 'Gatehouse', time: 'Dusk', present: ['Hale', 'Edren'] } });
        times.push(res.time);
    }
    const med = key => times.map(t => t[key] || 0).sort((a, b) => a - b)[Math.floor(times.length / 2)];
    const summary = { units: 2000, buildMs: +buildMs.toFixed(1), medianMs: { expand: +med('expand').toFixed(2), embedMock: +med('embed').toFixed(2), score: +med('score').toFixed(2), total: +med('total').toFixed(2) }, runs: 25, host: 'node, desktop CPU, mock embedder (the search model is timed separately)' };
    save('query-cost-node-2000', summary);
    assert.ok(summary.medianMs.score < 150, `scoring ${summary.medianMs.score} ms`);
    assert.ok(summary.medianMs.total < 150, `total ${summary.medianMs.total} ms`);
});

// ---------------------------------------------------------------- the real model (RI_TRANSFORMERS_NODE)

const real = { skip: NODE_LIB ? false : 'RI_TRANSFORMERS_NODE is not set' };

test('every indexed unit is 256 tokens or fewer by the model\'s own tokenizer', real, async () => {
    const embedder = await realEmbedder();
    const p = await fresh(60);
    const sources = sourcesFromChat({ chat: p.chat, result: p.fold() });
    const longReply = Array.from({ length: 120 }, (_, i) => `Marten rode the northern road past marker ${i} and counted the wagons.`).join(' ');
    sources.exchanges.push({ id: 'long', header: 'Chapter 9: a long reply | Blossomtide 14 | Hale, Heather, Marten, Darius', user: 'I ask again.', reply: longReply, srcTurn: 61, records: [] });
    sources.chapters.push({ id: 'chapter-long', order: 9, title: 'the long one', text: longReply, srcTurn: 61 });
    sources.entries = [{ book: 'Lore', uid: 1, title: 'The Elerian Reckoning', content: longReply }];
    const units = buildUnits({ ...sources, count: text => embedder.count(text) });
    const counts = units.map(u => ({ id: u.id, type: u.type, tokens: embedder.count(u.text) }));
    const over = counts.filter(c => c.tokens > 256);
    const byType = {};
    for (const c of counts) { byType[c.type] ||= { units: 0, max: 0 }; byType[c.type].units += 1; byType[c.type].max = Math.max(byType[c.type].max, c.tokens); }
    save('unit-tokens', { tokenizer: SEARCH_MODEL.repo, limit: 256, units: counts.length, over: over.length, longest: Math.max(...counts.map(c => c.tokens)), byType });
    assert.equal(over.length, 0, `over: ${JSON.stringify(over.slice(0, 5))}`);
    assert.ok(units.filter(u => u.type === 'exchange' && u.id.startsWith('ex:long')).length > 3, 'a long reply is cut into several units, each with the header');
    assert.ok(units.filter(u => u.id.startsWith('ex:long')).every(u => u.text.startsWith('Chapter 9: a long reply')));
    // the model reads 256 tokens: a longer text is truncated by the tokenizer, not an error
    const [vec] = await embedder.embed([longReply]);
    assert.equal(vec.length, 384);
    await embedder.dispose();
});

test('section 13, Retrieval: memory recall 10 points over baseline, probes found, 12 reworded questions', real, async () => {
    const embedder = await realEmbedder();
    const adapter = require(path.join(here, 'mb4_adapter.cjs'));
    await adapter.install({ embedder });
    const { retrieval } = require(path.join(adapter.HARNESS, 'scen_retrieval.js'));
    const out = await retrieval({ embedder, faults: new Set() });
    save('retrieval-row', { embedder: embedder.id, checks: out.checks, modes: out.notes.modes, baseline: out.notes.baseline, question10: out.notes.question10, units: out.notes.units });
    for (const c of out.checks) assert.ok(c.pass, `${c.name}: ${c.detail}`);
    assert.ok(out.checks.length >= 8);
    await embedder.dispose();
});

test('the 12 reworded Hale questions through the production index: right entry first for 10 or more, in the top 3 for all 12', real, async () => {
    const embedder = await realEmbedder();
    const adapter = require(path.join(here, 'mb4_adapter.cjs'));
    const { REWORDED } = require(path.join(adapter.HARNESS, 'scen_retrieval.js'));
    const { newEngine, playStory } = require(path.join(adapter.HARNESS, 'ref', 'play.js'));
    const engine = newEngine({ faults: new Set() });
    playStory(engine, 20);
    const entries = Object.entries(engine.lore.entries).filter(([, e]) => !e.constant).map(([uid, e]) => ({ book: 'lore', uid, title: e.comment, content: e.content }));
    const index = createSearchIndex({ embedder, db: memoryItems() });
    await index.sync({ records: [], chapters: [], exchanges: [], entries });
    // Three ranks per question: in the scored candidate list (the order the turn admits from, before the cut and the cap:
    // the section 13 measure), in the merged word and meaning list before scoring, and whether the entry reaches the
    // request at the cut of 0.4 (the cosine of a reworded question to its entry is often under it).
    const ranks = [];
    for (const [question, target] of REWORDED) {
        const res = await index.search({ message: question, turn: 21 });
        const scored = res.pool.filter(c => c.key.startsWith('lore:')).sort((a, b) => b.score - a.score).map(c => index.units.get(`${c.key}:0`)?.title);
        const merged = [];
        for (const id of res.ranked) { const u = index.units.get(id); if (u?.type === 'lore' && !merged.includes(u.title)) merged.push(u.title); }
        ranks.push({ question, target, rank: scored.indexOf(target) + 1 || 99, mergedListRank: merged.indexOf(target) + 1 || 99, sentAtCut: res.items.some(i => i.type === 'lore' && i.title === target) });
    }
    const count = (key, ok) => ranks.filter(r => ok(r[key])).length;
    const out = {
        entries: entries.length, scoredFirst: count('rank', r => r === 1), scoredTop3: count('rank', r => r <= 3), mergedListFirst: count('mergedListRank', r => r === 1), mergedListTop3: count('mergedListRank', r => r <= 3),
        sentAtCut04: ranks.filter(r => r.sentAtCut).length, ranks,
    };
    save('reworded-hale', out);
    assert.ok(out.scoredFirst >= 10 && out.scoredTop3 === 12, `${out.scoredFirst} first, ${out.scoredTop3} in the top 3: ${JSON.stringify(ranks.filter(r => r.rank > 1))}`);
    assert.ok(out.mergedListTop3 === 12, 'the merged list holds all 12 in its top 3');
    await embedder.dispose();
});

// MB5: the cut for a book entry meaning search found with no keyword. Each step of the sweep counts the reworded questions
// whose entry reaches the request and the other entries sent beside it (entries the question is not about).
test('the lore cosine cut is swept on the 12 reworded Hale questions, and the shipped value is the lowest step where most entries sent are the ones asked about', real, async () => {
    const embedder = await realEmbedder();
    const adapter = require(path.join(here, 'mb4_adapter.cjs'));
    const { REWORDED } = require(path.join(adapter.HARNESS, 'scen_retrieval.js'));
    const { newEngine, playStory } = require(path.join(adapter.HARNESS, 'ref', 'play.js'));
    const engine = newEngine({ faults: new Set() });
    playStory(engine, 20);
    const entries = Object.entries(engine.lore.entries).filter(([, e]) => !e.constant).map(([uid, e]) => ({ book: 'lore', uid, title: e.comment, content: e.content }));
    const index = createSearchIndex({ embedder, db: memoryItems() });
    await index.sync({ records: [], chapters: [], exchanges: [], entries });
    const cuts = [0.4, 0.35, 0.3, 0.25, 0.2, 0.15];
    const rows = [];
    let cosines = null;
    for (const value of cuts) {
        const spec = { ...THRESHOLD_SPEC, loreCosineCut: { measure: 'cosine', value } };
        let sent = 0, others = 0;
        const perQuestion = [];
        for (const [question, target] of REWORDED) {
            const res = await index.search({ message: question, turn: 21, options: { thresholds: createThresholds(spec) } });
            const lore = res.items.filter(i => i.type === 'lore');
            const hit = lore.some(i => i.title === target);
            sent += hit ? 1 : 0;
            others += lore.filter(i => i.title !== target).length;
            const own = res.pool.find(c => index.units.get(`${c.key}:0`)?.title === target);
            perQuestion.push({ target, cosine: own?.rel ?? null, sent: hit, others: lore.filter(i => i.title !== target).length });
        }
        cosines ||= perQuestion.map(p => p.cosine);
        rows.push({ loreCosineCut: value, sent, othersSent: others, othersPerQuestion: +(others / REWORDED.length).toFixed(2), perQuestion });
    }
    const shipped = THRESHOLD_SPEC.loreCosineCut.value;
    const row = rows.find(r => r.loreCosineCut === shipped);
    const out = { entries: entries.length, targetCosines: { min: Math.min(...cosines), max: Math.max(...cosines) }, shipped, rows: rows.map(({ perQuestion, ...r }) => r), detail: rows };
    save('lore-cut-sweep', out);
    assert.ok(rows[0].sent === 6 || rows[0].sent <= 7, `at 0.4 the sweep sends ${rows[0].sent} (MB4 measured 6)`);
    const share = r => r.sent / Math.max(1, r.sent + r.othersSent);
    assert.ok(row && row.sent > rows[0].sent && share(row) > 0.5, `the shipped cut ${shipped} sends ${row?.sent} of 12 with ${row?.othersSent} others`);
    const lower = rows.filter(r => r.loreCosineCut < shipped);
    assert.ok(lower.every(r => share(r) <= 0.5), 'every lower step sends more other entries than asked-about ones');
    await embedder.dispose();
});

test('the real model: query timing at 2,000 units and the model id is stored with the index', real, async () => {
    const embedder = await realEmbedder();
    const records = Array.from({ length: 2000 }, (_, i) => record(`r${i}`, `Subject ${i % 80}`, `Subject ${i % 80} did thing ${i} near place ${i % 37} with person ${i % 53} on day ${i % 90}.`, { srcTurn: (i % 400) + 1 }));
    const db = memoryItems();
    const index = createSearchIndex({ embedder, db });
    const t0 = performance.now();
    await index.sync({ records, chapters: [], exchanges: [], entries: [], turn: 400 }, { embed: 'wait' });
    const embedAll = performance.now() - t0;
    assert.deepEqual(await db.get('search:model'), { model: SEARCH_MODEL.id });
    const times = [];
    for (let i = 0; i < 30; i++) times.push((await index.search({ message: `What did subject ${i} do near place ${i % 37}?`, turn: 401 })).time);
    const med = key => times.map(t => t[key] || 0).sort((a, b) => a - b)[Math.floor(times.length / 2)];
    const out = { units: 2000, model: SEARCH_MODEL.id, embedAllMs: +embedAll.toFixed(0), medianMs: { embed: +med('embed').toFixed(1), score: +med('score').toFixed(2), total: +med('total').toFixed(1) }, host: 'node onnxruntime-node, desktop CPU' };
    save('query-cost-node-real-model', out);
    assert.ok(out.medianMs.score < 150);
    await embedder.dispose();
});

// ---------------------------------------------------------------- the model cache

test('the model cache keeps downloaded files in the page database and serves them back', async () => {
    const cache = modelCache(memoryItems());
    const body = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const progress = [];
    assert.equal(await cache.match('https://example.test/onnx/model.onnx'), undefined);
    await cache.put('https://example.test/onnx/model.onnx', new Response(body, { headers: { 'content-type': 'application/octet-stream', 'content-length': '6' } }), info => progress.push(info.loaded));
    const hit = await cache.match('https://example.test/onnx/model.onnx');
    assert.deepEqual([...new Uint8Array(await hit.arrayBuffer())], [1, 2, 3, 4, 5, 6]);
    assert.ok(progress.length >= 1 && progress.at(-1) === 6);
    assert.deepEqual(await cache.files(), ['file:https://example.test/onnx/model.onnx']);
    await cache.delete('https://example.test/onnx/model.onnx');
    assert.equal(await cache.match('https://example.test/onnx/model.onnx'), undefined);
});

test('a model that cannot download leaves search on words and retries no sooner than ten minutes later', async () => {
    let clock = 1000, loads = 0;
    const embedder = createEmbedder({ loadLibrary: async () => { loads += 1; throw new Error('offline'); }, now: () => clock });
    assert.equal(await embedder.load(), false);
    assert.equal(embedder.status().state, 'failed');
    assert.match(embedder.status().error, /offline/);
    clock += 60_000;
    assert.equal(await embedder.load(), false);
    assert.equal(loads, 1, 'no second attempt inside ten minutes');
    clock += 11 * 60_000;
    assert.equal(await embedder.load(), false);
    assert.equal(loads, 2);
});

test('recall settings that hold values but no book switches read every book as not managed, without throwing', async () => {
    const before = globalThis.SillyTavern;
    const extensionSettings = { roleplay_instructions: { recall: { values: { itemCap: 14 } } } };
    globalThis.SillyTavern = { getContext: () => ({ extensionSettings }) };
    try {
        const { isRecallManaged } = await import('../src/book-triggers.js');
        assert.equal(isRecallManaged('Eldoria'), false);
        assert.deepEqual(extensionSettings.roleplay_instructions.recall.books, {});
    } finally { globalThis.SillyTavern = before; }
});

test.after(() => {
    if (EVIDENCE) fs.writeFileSync(path.join(EVIDENCE, 'node-suite-summary.json'), JSON.stringify({ at: new Date().toISOString(), realModel: !!NODE_LIB, saved: Object.keys(saved) }, null, 1));
});

