// MB5: the request layout, the prompt cache and the trim guard (memory DESIGN 5). Run with:
//   node --test tests/t_inject.js
// The converter rows run SillyTavern's own Claude converter: set RI_ST_DIR to a SillyTavern 1.19.0 folder and RI_ST_CONFIG to
// its config.yaml. The section 13 Injection row runs on a deterministic embedder, and on the real search model when
// RI_TRANSFORMERS_NODE names a node_modules folder that holds @huggingface/transformers. Set RI_EVIDENCE_MB5 to a folder to
// save the results.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fresh } from './fixtures/mb2/story-play.mjs';
import { memoryItems } from '../src/memory/device-db.js';
import { createEmbedder, hashEmbedder } from '../src/memory/embed.js';
import { renderBlock, SEARCH } from '../src/memory/search.js';
import { chapterView, chaptersOf } from '../src/memory/story-so-far.js';
import { storedMark as storedMarkOf } from '../src/memory/fold.js';
import { captureFields, normalizeConfig } from '../src/cards/catalog.js';
import {
    MEMORY_INSTRUCTION, RULE_REMINDER, RECALL_PROMPT_KEY, INSTRUCTION_KEY, REMINDER_KEY, SIZE_CAPS, TRACKER_CARDS, blockOf, layoutOf, trimCheck, firstChanged,
    prefixReport, cachingDepthFor, trackerCarries, placeTracker, theirsFeatures, captureModules, tokensOf,
} from '../src/memory/inject.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const EVIDENCE = process.env.RI_EVIDENCE_MB5 || '';
const ST_DIR = process.env.RI_ST_DIR || '';
const ST_CONFIG = process.env.RI_ST_CONFIG || (ST_DIR ? path.join(ST_DIR, 'config.yaml') : '');
const NODE_LIB = process.env.RI_TRANSFORMERS_NODE || '';
const save = (name, value) => { if (!EVIDENCE) return; fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, `${name}.json`), JSON.stringify(value, null, 1)); };

globalThis.SillyTavern ||= { getContext: () => ({ extensionSettings: {}, chatMetadata: {} }) };

// A Chat Completion request in the fixed layout of 5.1, as SillyTavern assembles it: the stable prefix with the memory
// instruction at the end of the main prompt, the chapter view above the history, the recall block at depth 1 and the
// reminder at depth 0. `history` is the open chapter, oldest first.
function request({ history, recall = '<recall>\n<fact subject="Night">The shoe is loose.</fact>\n</recall>', view = '<story_so_far>\n<chapter n="1">Hale met Heather at the keep.</chapter>\n</story_so_far>', prefill = '', tracker = '' }) {
    const out = [
        { role: 'system', content: `You are the narrator of a roleplay.\n${MEMORY_INSTRUCTION}` },
        { role: 'system', content: 'Hale is a captain of the Vanguard.' },
        { role: 'system', content: view },
        ...history,
    ];
    const last = out.pop();
    out.push({ role: 'system', content: [recall, tracker].filter(Boolean).join('\n') }, last, { role: 'system', content: RULE_REMINDER });
    if (prefill) out.push({ role: 'assistant', content: prefill });
    return out;
}
const exchange = n => [{ role: 'user', content: `Player line ${n}.` }, { role: 'assistant', content: `Reply ${n}, the narrator answers.` }];
const historyTo = n => [{ role: 'assistant', content: 'The greeting.' }, ...Array.from({ length: n }, (_, i) => exchange(i + 1)).flat(), { role: 'user', content: `Player line ${n + 1}.` }];

// ---------------------------------------------------------------- the blocks and the trim guard

test('the blocks of a request are found by their tags and the fixed texts', () => {
    const messages = request({ history: historyTo(3) });
    const layout = layoutOf(messages);
    assert.equal(blockOf(messages[0]), 'instruction');
    assert.equal(layout.instruction, 0);
    assert.equal(layout.view, 2);
    assert.equal(layout.recall, messages.length - 3);
    assert.equal(layout.reminder, messages.length - 1);
    assert.ok(layout.tokens.recall > 0 && layout.tokens.view > 0);
    // about 80 tokens for the instruction (5.1)
    assert.ok(tokensOf(MEMORY_INSTRUCTION) >= 60 && tokensOf(MEMORY_INSTRUCTION) <= 100, `${tokensOf(MEMORY_INSTRUCTION)} tokens`);
    // a capitals key sorts before SillyTavern's World Info depth keys, so the recall block comes first at depth 1
    assert.deepEqual([RECALL_PROMPT_KEY, 'customDepthWI_1_0', 'roleplay_instructions_scene_header'].sort()[0], RECALL_PROMPT_KEY);
    assert.ok(INSTRUCTION_KEY !== REMINDER_KEY);
});

test('the trim guard names what a trimmed request lost, and passes a whole one', () => {
    const whole = request({ history: historyTo(4) });
    assert.deepEqual(trimCheck(whole, { view: true, recall: true }).cut, []);
    // SillyTavern fills the history from the newest message back, so the chapter view at the top goes first
    const trimmed = whole.filter(m => blockOf(m) !== 'view');
    const result = trimCheck(trimmed, { view: true, recall: true });
    assert.equal(result.ok, false);
    assert.deepEqual(result.cut, ['chapter view']);
    const both = trimmed.filter(m => blockOf(m) !== 'recall');
    assert.deepEqual(trimCheck(both, { view: true, recall: true }).cut, ['chapter view', 'recall block']);
    // a block the extension did not send this turn is not reported as cut
    assert.deepEqual(trimCheck(both, { view: false, recall: false }).cut, []);
});

// ---------------------------------------------------------------- the prompt cache

test('between chapter closes the first changed message is the old recall block, and the lost tokens are the tail', () => {
    const one = request({ history: historyTo(5) });
    const two = request({ history: historyTo(6) });
    const report = prefixReport(one, two);
    assert.equal(report.firstChanged, layoutOf(one).recall, 'the first difference is where the old recall block stood');
    assert.equal(report.followsHistory, true);
    // reprocessed: the old recall block's place onward, which is the new reply, the user message, the blocks
    const tail = two.slice(report.firstChanged).reduce((s, m) => s + tokensOf(m.content), 0);
    assert.equal(report.lostTokens, tail);
    // a chapter close changes the view above the history: the first change is far above
    const closed = request({ history: historyTo(6).slice(5), view: '<story_so_far>\n<chapter n="1">Hale met Heather at the keep.</chapter>\n<chapter n="2">They rode south.</chapter>\n</story_so_far>' });
    const atClose = prefixReport(two, closed);
    assert.equal(atClose.firstChanged, 2);
    assert.equal(atClose.followsHistory, false);
    assert.equal(firstChanged(one, one), one.length);
});

test('cachingDepthFor puts the marker on the reply above the depth-1 block on both Claude routes, with or without a prefill', () => {
    for (const route of ['claude', 'openrouter']) for (const prefill of ['', 'Hale']) {
        const messages = request({ history: historyTo(4), prefill });
        const found = cachingDepthFor(messages, { route });
        assert.ok(found, `${route} ${prefill}`);
        assert.equal(messages[found.above].content, 'Reply 4, the narrator answers.', `${route} prefill=${!!prefill}`);
        assert.equal(found.depth, 1, `${route} prefill=${!!prefill}`);
    }
});

// SillyTavern's own converter and marker code, run on a Claude-shaped request in the fixed layout.
let st = null;
async function sillyTavern() {
    if (st) return st;
    const util = await import(pathToFileURL(path.join(ST_DIR, 'src', 'util.js')).href);
    util.setConfigFilePath(ST_CONFIG);
    st = await import(pathToFileURL(path.join(ST_DIR, 'src', 'prompt-converters.js')).href);
    return st;
}
const names = { userName: 'Heather', charName: 'Hale', startsWithGroupName: () => false };
const markedText = messages => messages.flatMap((m, i) => (Array.isArray(m.content) ? m.content : []).filter(c => c.cache_control).map(c => ({ index: i, role: m.role, text: c.text })));
const prefixUpTo = (messages, index) => JSON.stringify(messages.slice(0, index + 1).map(m => ({ role: m.role, content: (Array.isArray(m.content) ? m.content : []).map(c => c.text) })));

const converter = { skip: !(ST_DIR && fs.existsSync(path.join(ST_DIR, 'src', 'prompt-converters.js'))) && 'RI_ST_DIR is not set' };
test('SillyTavern\'s Claude converter: cachingAtDepth 1 marks the reply above the recall block, and the next turn reads it', converter, async () => {
    const S = await sillyTavern();
    const out = { sillytavern: '1.19.0', layout: 'chapter view above the history, recall block at depth 1, reminder at depth 0, all system role', routes: {} };
    for (const route of ['claude', 'openrouter']) {
        const turn = n => {
            const raw = structuredClone(request({ history: historyTo(n), tracker: '<tracker card="scene">Valen Ford, midday</tracker>' }));
            const depth = cachingDepthFor(raw, { route }).depth;
            if (route === 'claude') {
                const converted = S.convertClaudeMessages(raw, '', true, false, names);
                S.cachingAtDepthForClaude(converted.messages, depth, '5m');
                return { depth, messages: converted.messages };
            }
            const messages = raw.map(m => ({ ...m }));
            S.cachingAtDepthForOpenRouterClaude(messages, depth, '5m');
            return { depth, messages: messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content })) };
        };
        const a = turn(5), b = turn(6);
        const marksA = markedText(a.messages), marksB = markedText(b.messages);
        // turn 5: the marker at depth N sits on reply 5, the message just above the recall block, and no marker sits below a block
        const nearA = marksA.at(-1);
        assert.equal(nearA.text, 'Reply 5, the narrator answers.', `${route}: ${JSON.stringify(marksA)}`);
        const blockAt = a.messages.findIndex(m => m.content.some(c => String(c.text).includes('<recall>')));
        assert.ok(marksA.every(m => m.index < blockAt), `${route}: every marker is above the recall block`);
        // turn 6: the marker at N + 2 lands on reply 5 again, and the prefix up to it is the same bytes, so it reads turn 5's entry
        const readB = marksB.find(m => m.text === 'Reply 5, the narrator answers.');
        assert.ok(readB, `${route}: turn 6 marks reply 5 at N + 2`);
        assert.equal(prefixUpTo(a.messages, nearA.index), prefixUpTo(b.messages, readB.index), `${route}: the cached prefix matches`);
        out.routes[route] = { cachingAtDepth: a.depth, markersTurn5: marksA.map(m => m.text.slice(0, 40)), markersTurn6: marksB.map(m => m.text.slice(0, 40)), messagesAfterConversion: a.messages.length };
        assert.equal(a.depth, 1);
    }
    // today's layout before MB5, for the record: story notes at depth 4 and the update request at depth 0
    const old = request({ history: historyTo(6) }).filter(m => blockOf(m) !== 'recall');
    const notesAt = old.length - 1 - 1 - 4;
    old.splice(notesAt, 0, { role: 'system', content: '[Story notes. ...]' });
    const before = cachingDepthFor(old, { route: 'claude', isBlock: (m, i) => i >= notesAt && m.role === 'system' && i > 2 });
    out.before = { layout: 'story notes at depth 4, request at depth 0', cachingAtDepth: before.depth };
    save('caching-depth', out);
});

// ---------------------------------------------------------------- serialization (5.1, M1c rule 16)

test('serialization is identical across two turns with the same records: the recall block, the chapter view and the prefix', async () => {
    globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, chatMetadata: {} }) };
    const { runRecallTurn } = await import('../src/recall.js');
    const p = await fresh(36);
    const parts = () => ({ embedder: hashEmbedder(), booster: null, db: memoryItems() });
    const host = { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'normal', message: 'Hale checks Night\'s shoe before the ford.' };
    const one = await runRecallTurn({ parts: parts(), host, values: { ...SEARCH } });
    const two = await runRecallTurn({ parts: parts(), host: { ...host }, values: { ...SEARCH } });
    assert.ok(one.block.length > 100);
    assert.equal(Buffer.compare(Buffer.from(one.block), Buffer.from(two.block)), 0, 'the recall block is byte-identical');
    const chapters = chaptersOf(p.chat, p.fold());
    const v1 = chapterView(chapters, { cap: SIZE_CAPS.mid.view }).text, v2 = chapterView(chaptersOf(p.chat, p.fold()), { cap: SIZE_CAPS.mid.view }).text;
    assert.equal(Buffer.compare(Buffer.from(v1), Buffer.from(v2)), 0, 'the chapter view is byte-identical');
    // the block order and tag names are fixed, items in story order
    assert.ok(one.block.startsWith('<recall>\n') && one.block.endsWith('\n</recall>'));
    save('serialization', { recallBytes: Buffer.byteLength(one.block), viewBytes: Buffer.byteLength(v1), identical: { recall: one.block === two.block, view: v1 === v2 }, instruction: MEMORY_INSTRUCTION, reminder: RULE_REMINDER, recall: one.block, view: v1 });
});

// ---------------------------------------------------------------- Theirs and the Tracker book (5.1, 5.4)

test('with Story state on Theirs the recall block carries no scene line; with it on the extension it does', async () => {
    const { runRecallTurn } = await import('../src/recall.js');
    const p = await fresh(36);
    const parts = () => ({ embedder: hashEmbedder(), booster: null, db: memoryItems() });
    const host = { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'normal', message: 'We ride for the ford.' };
    const ours = await runRecallTurn({ parts: parts(), host, values: { ...SEARCH } });
    const theirs = await runRecallTurn({ parts: parts(), host: { ...host, theirs: new Set(['state']) }, values: { ...SEARCH } });
    assert.match(ours.block, /<scene>/);
    assert.doesNotMatch(theirs.block, /<scene>/);
    // theirsFeatures reads SillyTavern's ownership view: choice 'preset' with the extension's text off
    assert.deepEqual([...theirsFeatures({ state: { choice: 'preset', usesExtension: false }, dice: { choice: 'both', usesExtension: true } })], ['state']);
});

test('a feature on Theirs still has its fields captured from the reply', () => {
    const config = normalizeConfig(undefined);
    const effective = { state: false, emotions: true, relationships: true, knowledge: true, plots: true, dice: false };
    const off = captureFields(config, effective).map(f => f.card);
    const forCapture = captureFields(config, captureModules(effective, new Set(['state', 'dice']), { state: true, dice: true })).map(f => f.card);
    const stateCards = [...new Set(forCapture.filter(card => !off.includes(card)))];
    assert.ok(stateCards.length > 0, 'the cards of Story state come back for capture');
    // a feature she switched off in the chat stays off for capture too
    assert.deepEqual(captureFields(config, captureModules(effective, new Set(['state']), { state: false })).map(f => f.card), off);
});

test('with the Tracker book on, no tracker value reaches the recall block', async () => {
    const { runRecallTurn } = await import('../src/recall.js');
    const p = await fresh(36);
    const parts = () => ({ embedder: hashEmbedder(), booster: null, db: memoryItems() });
    const host = { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'normal', message: 'Hale worries for Heather; how do they stand now?', };
    const values = { ...SEARCH, itemCap: 30, tokenCap: 6000 };
    const without = await runRecallTurn({ parts: parts(), host, values });
    const cards = Object.keys(TRACKER_CARDS);
    const withBook = await runRecallTurn({ parts: parts(), host: { ...host, trackerCards: cards }, values });
    const kinds = block => [...block.matchAll(/<(\w+)\b[^>]*>/g)].map(m => m[1]).filter(t => t !== 'recall');
    assert.ok(kinds(without.block).includes('scene'), 'without the book the scene line is in the block');
    assert.ok(without.search.items.some(i => ['emotion', 'relationship'].includes(i.rec?.kind)), 'without the book an emotion or relationship record is admitted');
    assert.ok(!kinds(withBook.block).includes('scene'));
    assert.ok(!withBook.search.items.some(i => ['emotion', 'relationship', 'scene'].includes(i.rec?.kind)), 'no tracker value is admitted');
    // a feature on Theirs puts no values in the book, so recall keeps those records (5.4)
    const carries = trackerCarries(cards, new Set(['emotions']));
    assert.ok(!carries.kinds.has('emotion') && carries.kinds.has('relationship') && carries.sceneLine);
    save('tracker-recall', { without: without.block, withTrackerBook: withBook.block });
});

test('the Tracker book sits at depth 1 within its cap: the Director\'s desk goes first, then the story cards from the end of the tray', () => {
    const entry = (card, words) => ({ card, comment: card, content: `${card}: ${'word '.repeat(words)}`.trim() });
    const entries = [entry('scene', 100), entry('characters', 200), entry('emotions', 150), entry('relationships', 150), entry('directorsDesk', 120)];
    const fits = placeTracker(entries, { cap: SIZE_CAPS.frontier.tracker });
    assert.equal(fits.dropped.length, 0);
    assert.ok(fits.kept.every(e => e.position === 4 && e.depth === 1 && e.constant === true));
    const small = placeTracker(entries, { cap: SIZE_CAPS.small.tracker });
    assert.ok(small.tokens <= SIZE_CAPS.small.tracker, `${small.tokens} tokens`);
    assert.deepEqual(small.dropped.map(d => d.card).slice(0, 2), ['directorsDesk', 'relationships']);
    const theirs = placeTracker(entries, { theirs: new Set(['state']) });
    assert.ok(!theirs.kept.some(e => ['scene', 'characters'].includes(e.card)), 'a feature on Theirs puts no values in the book');
});

// ---------------------------------------------------------------- what upkeep holds out (MB7)

test('upkeep\'s exclusions reach the final block: a replaced entry, a record that repeats her entry, a record outside the recall pool', async () => {
    const { runRecallTurn } = await import('../src/recall.js');
    const p = await fresh(36);
    const origin = { type: 'you', route: 'test' };
    const early = storedMarkOf(p.chat[3]);
    await p.store.record([
        { op: 'add', record: { id: 'story-night', kind: 'fact', subject: 'Night', attribute: 'replaces your entry', text: 'Night was sold at the Saltmar fair and Hale now rides a grey mare.', status: 'current', importance: 7, overrides: { book: 'Lore', uid: 1 } }, origin },
        { op: 'add', record: { id: 'forge', kind: 'fact', subject: 'Brannic', attribute: 'forge', text: 'Brannic keeps the forge at the keep gate and shoes the vanguard horses.', status: 'current', importance: 5 }, origin },
        { op: 'add', record: { id: 'old-thread', kind: 'thread', threadType: 'Open', subject: 'The lost bridle', text: 'Edren searched the gatehouse for the lost bridle of Night.', status: 'done', outcome: 'Edren found it.', importance: 5 }, origin, anchor: { mark: early } },
    ]);
    const parts = () => ({ embedder: hashEmbedder(), booster: null, db: memoryItems() });
    const values = { ...SEARCH, itemCap: 30, tokenCap: 8000, loreShare: 2000, meaningShare: 2000 };
    const host = { chat: p.chat, meta: p.meta, pov: 'Hale', type: 'normal', message: 'I ask about Night, the lost bridle and Brannic at the forge by the keep gate.' };
    const lore = () => ({ chatLore: [
        { world: 'Lore', uid: 1, key: ['night'], content: 'Night is the black stallion of Hale, tall and sure of foot.', comment: 'Night' },
        { world: 'Mine', uid: 7, key: ['brannic'], content: 'Brannic keeps the forge at the keep gate and shoes the vanguard horses.', comment: 'Brannic' },
    ] });
    const L1 = lore();
    const done = await runRecallTurn({ lore: L1, host, parts: parts(), values, managed: name => name === 'Lore' });
    const block = done.block;
    // 1. the entry "The story changed" replaced leaves the host's entries and the block; the record that replaces it is sent
    assert.ok(!L1.chatLore.some(e => e.world === 'Lore' && e.uid === 1), 'the replaced entry left the host request');
    assert.doesNotMatch(block, /black stallion/);
    // 2. a record that only repeats her entry is held out; her entry goes as she wrote it
    assert.ok(!done.search.items.some(i => i.rec?.id === 'forge'), 'the repeating record is not admitted');
    assert.ok(L1.chatLore.some(e => e.world === 'Mine' && e.uid === 7), 'her entry stays with the host');
    // 3. a thread that closed before a chapter close is outside the recall pool
    assert.ok(!done.search.items.some(i => i.rec?.id === 'old-thread'), 'the closed thread is not admitted');
    assert.doesNotMatch(block, /lost bridle/);
    // the control: with no entries and an open thread the same records are found
    await p.store.record([{ op: 'revise', target: ['old-thread'], record: { id: 'old-thread', kind: 'thread', threadType: 'Open', subject: 'The lost bridle', text: 'Edren searched the gatehouse for the lost bridle of Night.', status: 'open', importance: 5 }, origin }]);
    const control = await runRecallTurn({ lore: { chatLore: [] }, host: { ...host, chat: p.chat, meta: p.meta }, parts: parts(), values, managed: () => false });
    assert.ok(control.search.items.some(i => i.rec?.id === 'forge'), 'with no entry of hers the record is sent');
    assert.ok(control.search.items.some(i => i.rec?.id === 'old-thread'), 'an open thread is in the pool');
    save('upkeep-exclusions', { block, control: control.block });
});

// ---------------------------------------------------------------- one memory block

test('a chat with memory in chat data sends no story notes, and notes that remain sit at depth 1', async () => {
    const meta = { ri_memory: { imported: true } };
    globalThis.SillyTavern = { getContext: () => ({ extensionSettings: {}, chatMetadata: meta, chat: [], getCurrentChatId: () => 'c1', name1: 'Heather', name2: 'Hale' }) };
    const W = await import('../src/world.js');
    assert.equal(W.notesRetired(), true);
    const rows = [{ uid: 1, kind: 'character', name: 'Hale', aliases: [], fields: { role: 'captain' }, on: true }];
    assert.equal(W.storyRecall(rows, 'normal', { memory: false, components: { world: true, chapters: true } }).notes, null);
    meta.ri_memory.imported = false;
    assert.equal(W.notesRetired(), false);
    const entry = W.notesEntry('[Story notes]');
    assert.equal(entry.position, 4);
    assert.equal(entry.depth, 1);
});

// ---------------------------------------------------------------- section 13, Injection

async function realEmbedder() {
    const e = createEmbedder({
        loadLibrary: () => import(pathToFileURL(path.join(NODE_LIB, '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')).href),
        device: null,
        configure: env => { env.cacheDir = process.env.RI_MODEL_CACHE || path.join(NODE_LIB, '..', 'modelcache'); },
    });
    assert.equal(await e.load(), true);
    return e;
}

test('section 13, Injection: about 600 memory tokens, at most 1,000 lost cache tokens a turn between closes, the change follows the history', { timeout: 900000 }, async () => {
    const embedder = NODE_LIB ? await realEmbedder() : hashEmbedder();
    const adapter = require(path.join(here, 'mb5_adapter.cjs'));
    await adapter.install({ embedder });
    const R = require(path.join(adapter.HARNESS, 'scen_retrieval.js'));
    const ctx = { embedder, faults: new Set() };
    const row = await R.injection(ctx);
    // the production prefixReport over the same captures
    const run = [...ctx.cache.values()][0];
    const closes = new Set(row.notes.churn.closes);
    const reports = [];
    for (let i = 1; i < run.capture.length; i++) reports.push({ turn: run.capture[i].turn, ...prefixReport(run.capture[i - 1].messages, run.capture[i].messages) });
    const between = reports.filter(r => !closes.has(r.turn));
    const lost = between.map(r => r.lostTokens).sort((a, b) => a - b);
    const ours = { turns: between.length, medianLost: lost[Math.floor(lost.length / 2)], maxLost: lost.at(-1), followsHistory: between.filter(r => r.followsHistory).length };
    const out = { embedder: NODE_LIB ? 'all-MiniLM-L6-v2 q8' : 'deterministic hash embedder', checks: row.checks, notes: row.notes, prefixReport: ours };
    save('injection-row', out);
    for (const c of row.checks) assert.ok(c.pass, `${c.name}: ${c.detail}`);
    assert.equal(ours.followsHistory, ours.turns, 'prefixReport agrees: every turn between closes changes after the history');
    if (embedder.dispose) await embedder.dispose();
});
