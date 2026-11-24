// B33: the check list notes in code. Run with: node --test tests/t_preset_checks.js
// Every text here is invented. Plans are shaped like stackPlan() output; the last integration test builds one from the real bank.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkList, overlap, shingles, variableEvents, notesFor, summary, cardLink, NEAR_COPY, NEAR_DUPLICATE, NOTE_KINDS } from '../src/preset-checks.js';

let serial = 0;
function card(name, text, extra = {}) {
    const id = extra.id || `c${++serial}`;
    const source = extra.source || 'p:alpha';
    return { key: `${source}::${id}`, id, name, text, on: true, source, sourceName: extra.sourceName || 'Alpha', marker: false, landmark: false, tags: [], verdicts: {},
        group: 'main', origin: '', versionOf: '', ...extra };
}
const landmark = (id, on = true) => card(id, '', { id, key: `base::${id}`, source: 'base', sourceName: 'Alpha', marker: true, landmark: true, on });
const byKind = (list, kind) => list.notes.filter(item => item.kind === kind);
const WORDS = 'amber lantern river quill harbor meadow copper thistle orbit velvet canyon ember signal marble willow cipher atlas fable pebble drift'.split(' ');
const words = (count, seed = 1) => Array.from({ length: count }, (_, i) => `${WORDS[(i * 7 + seed * 3) % WORDS.length]}${seed}n${i}`).join(' ');
const withEdits = (text, every) => text.split(' ').map((word, i) => i % every === every - 1 ? `${word}x` : word).join(' ');

test('same text names every card that holds it and says all are sent', () => {
    const body = 'Describe each room by what a character would touch first and what they would notice last.';
    const plan = [card('Prose Rules', body), card('Room Rules', body, { source: 'p:beta', sourceName: 'Beta' }), card('Spare', body, { source: 'p:gamma', sourceName: 'Gamma' }),
        card('Other', 'A different instruction about pacing that shares nothing with the others at all.'), landmark('chatHistory')];
    const list = checkList(plan);
    const [item] = byKind(list, 'same-text');
    assert.equal(byKind(list, 'same-text').length, 1);
    assert.deepEqual(item.cards.map(c => c.source), ['Alpha', 'Beta', 'Gamma']);
    assert.match(item.text, /Same text in Prose Rules \(Alpha\), Room Rules \(Beta\) and Spare \(Gamma\); all are sent\./);
    assert.equal(byKind(list, 'near-copy').length, 0);
    for (const ref of item.cards) assert.equal(ref.link, cardLink(ref.key));
});

test('a clean card beside her customized version is noted as a near copy with the percentage', () => {
    const clean = words(100);
    const mine = withEdits(clean, 33);
    const pct = overlap(clean, mine);
    assert.ok(pct >= NEAR_COPY && pct < NEAR_DUPLICATE, `fixture overlap ${pct}`);
    const plan = [card('Prose Rules', clean, { key: 'base::prose', id: 'prose', source: 'base' }),
        card('Prose Rules', mine, { key: 'v::1', id: '1', source: 'v', sourceName: 'Mine', origin: 'p:alpha' }), landmark('chatHistory')];
    const list = checkList(plan);
    const [item] = byKind(list, 'near-copy');
    assert.ok(item, 'a near copy note');
    assert.equal(item.nearDuplicate, false);
    assert.match(item.text, new RegExp(`is a ${Math.round(pct * 100)} percent copy of Prose Rules \\(Alpha\\)`));
    assert.deepEqual(item.cards.map(c => c.key), ['base::prose', 'v::1']);
    assert.deepEqual(item.cards.map(c => c.source), ['Alpha', 'Mine']);
});

test('95 percent and over is called a near duplicate; under 80 percent gets no note', () => {
    const long = words(220, 2);
    const nearly = long.split(' ').map((word, i) => i === 100 ? 'zzz' : word).join(' ');
    assert.ok(overlap(long, nearly) >= NEAR_DUPLICATE);
    const far = withEdits(words(60, 4), 3);
    assert.ok(overlap(words(60, 4), far) < NEAR_COPY);
    const list = checkList([card('Long', long), card('Long copy', nearly, { source: 'p:beta', sourceName: 'Beta' }), card('Short', words(60, 4)), card('Short edited', far)]);
    const notes = byKind(list, 'near-copy');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].nearDuplicate, true);
    assert.match(notes[0].text, /near duplicate/);
});

test('blocks of 40 characters or fewer are not compared for near copies, and cards that are off are not read', () => {
    const short = 'Keep replies under four paragraphs.';
    assert.ok(short.length <= 40);
    const long = words(80, 3);
    const plan = [card('A', short), card('B', short.replace('four', 'five')), card('C', long), card('D', withEdits(long, 12), { on: false })];
    const list = checkList(plan);
    assert.equal(byKind(list, 'near-copy').length, 0);
    assert.equal(byKind(list, 'same-text').length, 0);
});

test('a P1 verdict is a note only when an RI card for the feature is also on', () => {
    const preset = card('Dice Rolls', 'Roll a die for every risky action and report the number in the reply.', { tags: ['dice'], verdicts: { dice: 'duplicative' } });
    const clash = card('Status block', 'Print a status block after each reply with stats and location.', { tags: ['state'], verdicts: { state: 'contradictory' }, source: 'p:beta', sourceName: 'Beta' });
    const fine = card('Notes', 'Complementary guidance about names that adds a small reminder to the reply.', { tags: ['knowledge'], verdicts: { knowledge: 'complementary' } });
    const ri = card('Dice', 'The extension rolls in code.', { id: 'dice', key: 'ri::dice', source: 'ri', sourceName: 'Roleplay Instructions', group: 'ri' });
    const riOff = card('Story state', 'State record.', { id: 'state', key: 'ri::state', source: 'ri', sourceName: 'Roleplay Instructions', group: 'ri', on: false });
    const list = checkList([preset, clash, fine, ri, riOff], { rules: { [`${preset.key}|dice`]: 'adds dice rules beside the extension dice' } });
    const notes = byKind(list, 'verdict');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].feature, 'dice');
    assert.equal(notes[0].verdict, 'duplicative');
    assert.match(notes[0].text, /Dice Rolls \(Alpha\) duplicates Dice \(Roleplay Instructions\): adds dice rules beside the extension dice\./);
    assert.deepEqual(notes[0].cards.map(c => c.key), [preset.key, 'ri::dice']);
    const contra = checkList([clash, { ...riOff, on: true }]).notes.find(item => item.kind === 'verdict');
    assert.equal(contra.verdict, 'contradictory');
    assert.match(contra.text, /conflicts with/);
});

test('a version of an RI feature counts as the RI card for a verdict', () => {
    const preset = card('Roast', 'Add a comic reaction after every reply the model writes in the story.', { verdicts: { roast: 'duplicative' } });
    const mine = card('Roast', 'My own roast wording that is long enough to matter in the stack.', { key: 'v::9', id: '9', source: 'v', sourceName: 'Mine', origin: 'ri', versionOf: 'roast', group: 'ri' });
    assert.equal(byKind(checkList([preset, mine]), 'verdict').length, 1);
});

test('pick-one groups with two or more on are noted; one on is not', () => {
    const pov = [card('[PICK 1: POV] First person', 'Write in first person.'), card('[PICK 1: POV] Third person', 'Write in third person.'), card('[PICK 1: POV] Second person', 'Write in second person.', { on: false })];
    const tone = [card('[PICK 1: Tone] Warm', 'Keep a warm tone.'), card('[PICK 1: Tone] Dry', 'Keep a dry tone.', { on: false })];
    const list = checkList([...pov, ...tone]);
    const notes = byKind(list, 'pick-one');
    assert.equal(notes.length, 1);
    assert.equal(notes[0].group, 'POV');
    assert.match(notes[0].text, /Pick one: POV has 2 on/);
    assert.deepEqual(notes[0].cards.map(c => c.name), ['[PICK 1: POV] First person', '[PICK 1: POV] Third person']);
});

test('a variable read before any card sets it is noted, with the later setter', () => {
    const reader = card('Greeting', 'Open with {{getvar::mood}} and a short greeting for the scene.');
    const setter = card('Mood', 'Pick a mood. {{setvar::mood::calm}}');
    const list = checkList([reader, setter]);
    const [item] = byKind(list, 'variable-early');
    assert.ok(item);
    assert.equal(item.variable, 'mood');
    assert.equal(item.neverSet, false);
    assert.match(item.text, /Greeting \(Alpha\) reads the variable mood before Mood \(Alpha\) sets it\./);
    assert.deepEqual(item.cards.map(c => c.name), ['Greeting', 'Mood']);
    assert.equal(byKind(list, 'variable-unread').length, 0);
    // The same cards in send order read what was set: no note.
    assert.equal(checkList([setter, reader]).notes.filter(n => n.kind.startsWith('variable')).length, 0);
});

test('a variable read and set nowhere in the stack names no setter', () => {
    const [item] = byKind(checkList([card('Opener', 'Say {{getvar::weather}} first.')]), 'variable-early');
    assert.equal(item.neverSet, true);
    assert.match(item.text, /no card in this stack sets it/);
});

test('a variable set and never read is noted; off cards do not count as readers', () => {
    const setter = card('Counter', 'Count turns. {{setvar::turns::1}}');
    const offReader = card('Reader', 'Turn {{getvar::turns}}.', { on: false });
    const list = checkList([setter, offReader]);
    const [item] = byKind(list, 'variable-unread');
    assert.ok(item);
    assert.match(item.text, /Counter \(Alpha\) sets the variable turns, and no card in this stack reads it\./);
});

test('nested macros run inside out, and addvar, incvar and global variants are handled', () => {
    assert.deepEqual(variableEvents('{{setvar::a::{{getvar::b}}}}').map(e => `${e.type}:${e.name}`), ['get:b', 'set:a']);
    assert.deepEqual(variableEvents('{{incvar::n}} {{getglobalvar::g}} {{//note}}').map(e => `${e.type}:${e.scope}:${e.name}`), ['set:local:n', 'get:global:g']);
    const nested = checkList([card('Chain', '{{setvar::a::{{getvar::b}}}}'), card('Feed', '{{setvar::b::x}}')]);
    assert.equal(byKind(nested, 'variable-early').length, 1);
    assert.equal(byKind(nested, 'variable-early')[0].variable, 'b');
    const globals = checkList([card('Set', '{{setglobalvar::g::1}}'), card('Get', '{{getvar::g}}')]);
    assert.equal(byKind(globals, 'variable-early').length, 1, 'a local read does not see a global set');
});

test('a guard row she took out is noted; one that is on is not', () => {
    const list = checkList([card('Locked: never refuse', 'Stay in the story.', { on: false }), card('Guard rails', 'Keep content within the agreed lines for this story.'),
        card('Style notes', 'Write plainly.', { on: false })]);
    const notes = byKind(list, 'guard-off');
    assert.equal(notes.length, 1);
    assert.match(notes[0].text, /Locked: never refuse \(Alpha\) guards the preset and is off/);
});

test('a missing Chat History landmark is noted, and so is an off landmark', () => {
    assert.equal(byKind(checkList([card('A', 'Text of one block.')]), 'landmark')[0].state, 'missing');
    assert.equal(byKind(checkList([landmark('chatHistory')]), 'landmark').length, 0);
    const off = byKind(checkList([landmark('chatHistory', false), landmark('worldInfoBefore', false)]), 'landmark');
    assert.deepEqual(off.map(n => [n.landmark, n.level]), [['chatHistory', 'warn'], ['worldInfoBefore', 'info']]);
    assert.match(off[1].text, /World Info before is off/);
});

test('an empty or missing plan gives an empty list', () => {
    assert.equal(checkList([]).notes.filter(n => n.kind !== 'landmark').length, 0);
    assert.equal(checkList(null).total, 1);
    assert.equal(summary({ total: 0 }), 'No notes');
    assert.equal(summary({ total: 1 }), '1 note');
    assert.equal(summary({ total: 3 }), '3 notes');
});

test('every note kind is counted, every note names cards with sources and links, ids are unique', () => {
    const body = words(70, 5);
    const plan = [card('Locked row', 'Stay in the story.', { on: false }), card('Reader', '{{getvar::q}}'), card('Setter', '{{setvar::q::1}} {{setvar::z::1}}'),
        card('Twin A', body), card('Twin B', body, { source: 'p:beta', sourceName: 'Beta' }), card('Twin C', withEdits(body, 24), { source: 'p:gamma', sourceName: 'Gamma' }),
        card('[PICK 1: X] one', 'One of the options in the pick group.'), card('[PICK 1: X] two', 'Two of the options in the pick group.'),
        card('Dice Rolls', 'Roll a die for each risky action in the scene and report the number.', { verdicts: { dice: 'duplicative' } }),
        card('Dice', 'Code rolls.', { id: 'dice', key: 'ri::dice', source: 'ri', sourceName: 'Roleplay Instructions', group: 'ri' })];
    const list = checkList(plan);
    assert.deepEqual(Object.keys(list.counts), NOTE_KINDS);
    for (const kind of NOTE_KINDS) assert.ok(list.counts[kind] > 0, `${kind} present`);
    assert.equal(new Set(list.notes.map(n => n.id)).size, list.notes.length);
    for (const item of list.notes.filter(n => n.kind !== 'landmark')) {
        assert.ok(item.cards.length > 0);
        for (const ref of item.cards) { assert.ok(ref.name && ref.source && ref.key); assert.equal(ref.link, cardLink(ref.key)); }
    }
    assert.ok(notesFor(list, 'ri::dice').length >= 1);
});

test('the notes change nothing: plan, stack and request are identical before and after, and a frozen plan is read without a write', () => {
    const body = words(70, 6);
    const stack = { v: 1, key: 'preset:Alpha', base: 'Alpha', cards: [{ key: 'a', on: true }, { key: 'b', on: false }, { key: 'c', on: true }], ri: [{ key: 'ri::dice', on: true }] };
    const plan = [card('Locked row', 'Stay in the story.', { on: false, key: 'b' }), card('Twin A', body, { key: 'a' }), card('Twin B', withEdits(body, 9), { key: 'c' }),
        card('Reader', '{{getvar::q}}', { key: 'ri::dice' }), landmark('chatHistory', false)];
    const request = p => p.filter(item => item.on).map(item => `${item.sendId || item.key}\u0000${item.role || 'system'}\u0000${item.text}`);
    const before = { plan: JSON.stringify(plan), stack: JSON.stringify(stack), request: request(plan) };
    const frozen = plan.map(item => Object.freeze({ ...item, tags: Object.freeze([...item.tags]), verdicts: Object.freeze({ ...item.verdicts }) }));
    Object.freeze(frozen);
    const list = checkList(frozen);
    assert.ok(list.total > 0);
    assert.equal(JSON.stringify(plan), before.plan);
    assert.equal(JSON.stringify(stack), before.stack);
    assert.deepEqual(request(plan), before.request);
    assert.deepEqual(request(frozen), before.request);
    for (const item of list.notes) for (const ref of item.cards) assert.ok(plan.some(p => p.key === ref.key));
});

test('timing: 220 cards with copies, variables and verdicts', () => {
    const plan = [];
    for (let i = 0; i < 220; i++) {
        const family = i % 22;                        // ten copies of each of 22 base texts
        const base = words(40 + (family % 6) * 40, family);
        const text = i % 10 === 0 ? base : i % 10 < 6 ? withEdits(base, 7 + (i % 10)) : words(40 + (i % 9) * 30, 40 + i);
        plan.push(card(`Block ${i}`, i % 15 === 0 ? `${text} {{setvar::v${i % 7}::1}}` : i % 15 === 1 ? `${text} {{getvar::v${i % 7}}}` : text,
            { source: `p:s${i % 12}`, sourceName: `Source ${i % 12}`, on: i % 13 !== 0, verdicts: i % 17 === 0 ? { dice: 'duplicative' } : {} }));
    }
    plan.push(card('Dice', 'Code rolls.', { id: 'dice', key: 'ri::dice', source: 'ri', sourceName: 'Roleplay Instructions', group: 'ri' }), landmark('chatHistory'));
    const t0 = performance.now();
    const cold = checkList(plan);
    const coldMs = performance.now() - t0;
    const warm = [];
    for (let i = 0; i < 9; i++) { const t = performance.now(); checkList(plan); warm.push(performance.now() - t); }
    warm.sort((a, b) => a - b);
    const median = warm[4];
    console.log(`TIMING 222 cards: cold ${coldMs.toFixed(1)} ms (shingling included), warm median ${median.toFixed(1)} ms, worst ${warm[8].toFixed(1)} ms; ${cold.total} notes ${JSON.stringify(cold.counts)}`);
    assert.ok(cold.counts['near-copy'] > 0 && cold.counts['same-text'] > 0);
    assert.ok(median < 50, `warm median ${median} ms`);
    assert.ok(coldMs < 150, `cold ${coldMs} ms`);
    assert.equal(shingles(plan[0].text), shingles(plan[0].text), 'shingles are memoized per text');
});

test('timing, worst case: 220 cards that are all single-word variants of one 300 word text', () => {
    const base = words(300, 9).split(' ');
    const plan = Array.from({ length: 220 }, (_, i) => card(`Variant ${i}`, base.map((word, at) => at === i + 40 ? `${word}v` : word).join(' '), { source: `p:s${i % 12}`, sourceName: `Source ${i % 12}` }));
    const t0 = performance.now();
    const list = checkList(plan);
    const ms = performance.now() - t0;
    console.log(`TIMING worst case 220 mutually near cards: ${ms.toFixed(1)} ms, ${list.counts['near-copy']} near copy notes`);
    assert.equal(list.counts['near-copy'], 219, 'one note per copy, against its closest earlier card');
    assert.ok(ms < 150, `worst case (alone it takes about 45 ms; the bound allows for parallel test load) ${ms} ms`);
});

// ---------------------------------------------------------------------------------------------------------------------
// The real bank: a plan from stackPlan() with a clean card beside her customized version, and the stack unchanged by the notes.
test('a plan from the real bank gives the near copy note and leaves the stack and plan untouched', async () => {
    const chat = { roleplay_instructions: { v10: { enabled: true } } };
    const stored = {}; let names = {}, presets = [], selected = 'Alpha';
    const host = { mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } }, chatMetadata: chat, getCurrentChatId: () => 'A', saveMetadataDebounced() {}, saveSettingsDebounced() {},
        chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1', eventTypes: {}, eventSource: { on() {}, async emit() {} },
        getPresetManager: () => ({ getSelectedPresetName: () => selected, getPresetList: () => ({ preset_names: names, presets }), async savePreset() {} }) };
    globalThis.SillyTavern = { getContext: () => host };
    const bank = await import('../src/preset-bank.js');
    const { settings } = await import('../src/store.js');
    const blk = (identifier, name, content, extra = {}) => ({ identifier, name, content, role: 'system', system_prompt: false, injection_position: 0, ...extra });
    const prose = words(100, 8);
    const prompts = [blk('main', 'Main Prompt', 'Alpha main prompt text for this invented preset.'), blk('prose', 'Prose Rules', prose), blk('read', 'Reader', 'Open with {{getvar::tone}}.'),
        blk('set', 'Setter', 'Choose a tone. {{setvar::tone::dry}}'), { identifier: 'chatHistory', name: 'chatHistory', marker: true, system_prompt: true }];
    const data = { temperature: 1, openai_max_context: 32000, prompts, extensions: {}, prompt_order: [{ character_id: 100001, order: prompts.map(p => ({ identifier: p.identifier, enabled: true })) }] };
    presets = [data]; names = { Alpha: 0 }; host.chatCompletionSettings = structuredClone(data);
    for (const key of ['bankVersions', 'bankStacks', 'bankTexts', 'bankSources', 'bankTags']) delete settings()[key];
    bank.resetBank();
    const b = bank.refreshBank('test');
    const stack = bank.stackFor(b, 'Alpha', data);
    const version = bank.createVersion(b, 'base::prose', { label: 'Mine', text: withEdits(prose, 33), base: 'Alpha' });
    const edited = bank.includeCard(b, stack.key, bank.versionKey(version.id), { base: 'Alpha' });
    const live = bank.stackFor(b, 'Alpha', data);
    const planBefore = JSON.stringify(bank.stackPlan(b, live, 'Alpha')), stackBefore = JSON.stringify(live);
    const list = checkList(bank.stackPlan(b, live, 'Alpha'));
    assert.ok(byKind(list, 'near-copy').length === 1, JSON.stringify(list.notes.map(n => n.text)));
    assert.equal(byKind(list, 'variable-early')[0].variable, 'tone');
    assert.equal(JSON.stringify(bank.stackPlan(b, bank.stackFor(b, 'Alpha', data), 'Alpha')), planBefore);
    assert.equal(JSON.stringify(bank.stackFor(b, 'Alpha', data)), stackBefore);
    void edited;
});
