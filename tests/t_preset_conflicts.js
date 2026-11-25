// B34: the block bank conflict call. Run with: node --test tests/t_preset_conflicts.js
// A fake SillyTavern context stands in for the host and a scripted function stands in for the model; no real call is made.
// Every text here is invented.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shipped = JSON.parse(readFileSync(root + 'presets/preset-families.json', 'utf8'));
const companionFile = JSON.parse(readFileSync(root + 'presets/Roleplay Instructions V10.json', 'utf8'));

// ---------------------------------------------------------------------------------------------------------------------
// The fake host
const chats = { A: {} };
let stored = {}, names = {}, presets = [], selected = '';
const manager = {
    getSelectedPresetName: () => selected,
    getPresetList: () => ({ preset_names: names, presets }),
    async savePreset(name, data) { put(name, structuredClone(data)); },
};
const handlers = new Map();
const eventTypes = { OAI_PRESET_CHANGED_AFTER: 'oai_preset_changed_after', OAI_PRESET_IMPORT_READY: 'oai_preset_import_ready', PRESET_CHANGED: 'preset_changed',
    PRESET_DELETED: 'preset_deleted', PRESET_RENAMED: 'preset_renamed', SETTINGS_LOADED_AFTER: 'settings_loaded_after', CHAT_CHANGED: 'chat_id_changed' };
const host = {
    mainApi: 'openai', extensionSettings: { roleplay_instructions: { enabled: true } },
    get chatMetadata() { return chats.A; }, getCurrentChatId: () => 'A', saveMetadataDebounced() {}, saveSettingsDebounced() {},
    chatCompletionSettings: null, getChatCompletionModel: () => 'z-ai/glm-5.1', getPresetManager: () => manager, eventTypes,
    eventSource: { on(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); }, async emit() {} },
};
function put(name, data) {
    if (Object.hasOwn(names, name)) Object.assign(presets[names[name]], data);
    else { presets.push(data); names[name] = presets.length - 1; }
    stored[name] = presets[names[name]];
}
globalThis.SillyTavern = { getContext: () => host };

const bank = await import('../src/preset-bank.js');
const { settings, chatState } = await import('../src/store.js');
const conflicts = await import('../src/preset-conflicts.js');
const { checkList } = await import('../src/preset-checks.js');
const { PROMPTS, promptText } = await import('../src/prompts.js');
const { EXECUTION_OPERATIONS } = await import('../src/execution.js');
const v10 = await import('../src/v10.js');

chats.A.roleplay_instructions = { v10: { enabled: true } };
const block = (identifier, name, content, extra = {}) => ({ identifier, name, content, role: 'system', system_prompt: false, injection_position: 0, ...extra });
const marker = identifier => ({ identifier, name: identifier, marker: true, system_prompt: true });
const presetOf = (blocks, enabled) => ({ temperature: 1, openai_max_context: 32000, prompts: blocks, extensions: {},
    prompt_order: [{ character_id: 100001, order: blocks.map(b => ({ identifier: b.identifier, enabled: enabled.includes(b.identifier) })) }] });

const POV_FIRST = 'Write every reply in first person, from the point of view of the character who is speaking, and never describe the scene from outside.';
const POV_THIRD = 'Write every reply in third person limited, naming the character, and never use the word I for the narrator.';
const HARMLESS = 'Keep sentences short and concrete, and prefer one strong detail to three weak ones.';
const alpha = () => presetOf([block('main', 'Main Prompt', 'Alpha main prompt text.'), block('a-pov', 'Voice', POV_FIRST), block('a-keep', 'Short sentences', HARMLESS),
    marker('worldInfoBefore'), block('a-dice', 'Dice Rolls', 'Roll a die for each risky action and report the number.'), marker('chatHistory')],
    ['main', 'a-pov', 'a-keep', 'worldInfoBefore', 'a-dice', 'chatHistory']);
const beta = () => presetOf([block('main', 'Main Prompt', 'Beta main prompt text.'), block('b-pov', 'Narration', POV_THIRD), block('b-keep', 'Concrete detail', HARMLESS),
    marker('chatHistory')], ['main', 'b-pov', 'b-keep', 'chatHistory']);

function reset() {
    const st = settings();
    for (const name of ['bankVersions', 'bankStacks', 'bankTexts', 'bankSources', 'bankTags', 'presetSwitches', 'bankConflicts']) delete st[name];
    chats.A = { roleplay_instructions: { v10: { enabled: true } } };
    bank.resetBank(); bank.useBankLibrary(shipped); bank.useCompanionFile(null);
    names = {}; presets = []; stored = {};
    for (const [name, data] of [['Alpha', alpha()], ['Beta', beta()], ['Roleplay Instructions V10', companionFile]]) put(name, structuredClone(data));
    selected = 'Alpha'; host.chatCompletionSettings = structuredClone(stored.Alpha);
    const b = bank.refreshBank('test');
    const stack = bank.stackFor(b, 'Alpha');
    return { b, stack, key: stack.key, plan: () => bank.stackPlan(bank.currentBank(), bank.storedStack(stack.key), 'Alpha') };
}
const betaKey = (b, id) => bank.cardKey(bank.presetSource(b.sids.Beta), id);

// Hand-built plans for the validator tests: shaped like stackPlan() output.
let serial = 0;
function card(name, text, extra = {}) {
    const id = extra.id || `c${++serial}`, source = extra.source || 'p:alpha';
    return { key: `${source}::${id}`, id, name, text, on: true, source, sourceName: extra.sourceName || 'Alpha', marker: false, landmark: false, tags: [], verdicts: {}, group: 'main', origin: '', versionOf: '', role: 'system', ...extra };
}

// The scripted model. It reads the call's own input, as a model does, and returns the pair that disagrees on point of view.
// It leaves identical harmless lines out only when the stored prompt tells it to.
const asksForProblemsOnly = () => /Leave out harmless repetition/.test(promptText('conflictCheck'));
function scripted({ onCall = () => {} } = {}) {
    const calls = [];
    const ask = async ({ user, repair }) => {
        const input = JSON.parse(user.split('\n\nYour previous answer')[0]);
        calls.push({ user, repair, input });
        onCall(calls.length);
        const text = block => block.text ?? block.excerpts.join(' ');
        const out = [];
        const first = input.blocks.find(b => /first person/.test(text(b))), third = input.blocks.find(b => /third person/.test(text(b)));
        if (first && third) out.push({ a: first.key, b: third.key, kind: 'contradiction', reason: 'One asks for first person and the other for third person.',
            problem: 'The reply could switch narrator voice from one paragraph to the next.', a_span: 'Write every reply in first person', b_span: 'Write every reply in third person limited' });
        if (!asksForProblemsOnly()) {
            const seen = new Map();
            for (const b of input.blocks) { const prior = seen.get(text(b)); if (prior && text(b) === HARMLESS) out.push({ a: prior.key, b: b.key, kind: 'duplication', reason: 'Same advice.', problem: 'None.', a_span: 'Keep sentences short', b_span: 'Keep sentences short' }); else seen.set(text(b), b); }
        }
        return { text: JSON.stringify(out) };
    };
    return { ask, calls };
}

// ---------------------------------------------------------------------------------------------------------------------

test('valid findings keep only the listed fields and resolve to both cards with sources and spans', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    const model = scripted();
    const done = await conflicts.runConflictCheck(key, plan(), { ask: model.ask });
    assert.equal(done.findings.length, 1);
    const [item] = conflicts.conflictItems(key, plan()).items;
    assert.equal(item.conflictKind, 'contradiction');
    assert.deepEqual(item.cards.map(c => c.name), ['Voice', 'Narration']);
    assert.deepEqual(item.cards.map(c => c.source), ['Alpha', 'Beta']);
    assert.deepEqual(item.cards.map(c => c.span), ['Write every reply in first person', 'Write every reply in third person limited']);
    assert.match(item.reason, /first person/);
    assert.match(item.problem, /switch narrator voice/);
    assert.ok(item.cards.every(c => c.link.startsWith('#bank-card=')));
    assert.deepEqual(Object.keys(done.findings[0]).filter(k => ['a', 'b', 'kind', 'reason', 'problem', 'a_span', 'b_span'].includes(k)).length, 7);
    assert.ok(b);
});

test('findings with unknown or equal keys, an unknown kind, an empty problem or spans absent from the card are dropped and counted', () => {
    const one = card('One', 'Always answer in two short paragraphs, no more and no fewer than that.'), two = card('Two', 'Answer in six long paragraphs with a closing line for every speaker.');
    const off = card('Off', 'A block that is off and so is never sent to the model at all.', { on: false });
    const good = { a: one.key, b: two.key, kind: 'overlap', reason: 'Two length targets.', problem: 'The reply length could swing.', a_span: 'two short paragraphs', b_span: 'six long paragraphs' };
    const parsed = [
        good,
        { ...good, a: 'p:alpha::nope' },                                   // unknown key
        { ...good, b: one.key },                                           // equal keys
        { ...good, b: off.key },                                           // a card that is off is not an input key
        { ...good, kind: 'clash' },                                        // unknown kind
        { ...good, problem: '   ' },                                       // empty problem
        { ...good, reason: '' },                                           // empty reason
        { ...good, a_span: 'a sentence the block never says' },            // span absent
        { ...good, b_span: undefined },                                    // span missing
        { ...good, fix: 'delete block two', apply: true },                 // extra fields are ignored, the item stands but repeats
        'not an item', null,
    ];
    const result = conflicts.validateFindings(parsed, conflicts.callCards([one, two, off]));
    assert.equal(result.received, 12);
    assert.equal(result.findings.length, 1);
    assert.deepEqual(Object.keys(result.findings[0]).sort(), ['a', 'a_span', 'b', 'b_span', 'kind', 'problem', 'reason']);
    assert.deepEqual(result.dropped, { keys: 5, kind: 1, reason: 1, problem: 1, span: 2, duplicate: 1, noted: 0, limit: 0 });
    assert.equal(result.droppedTotal, 11);
    assert.match(conflicts.droppedText(result.dropped), /11 dropped: 5 unknown or equal keys, 1 unknown kind, 1 empty reason, 1 empty problem line, 2 spans not in their blocks, 1 repeated finding/);
});

test('a span survives case, curly quotes and an ellipsis, and is cut to 15 words', () => {
    const long = 'Never summarize the scene after the fact, never skip the middle of an exchange, and always let each speaker finish a thought before the next begins.';
    const one = card('One', `He said “don't stop” and left. ${long}`), two = card('Two', 'Summaries are required at the end of every scene.');
    const make = (a_span, b_span = 'Summaries are required') => [{ a: one.key, b: two.key, kind: 'contradiction', reason: 'r', problem: 'p', a_span, b_span }];
    const run = parsed => conflicts.validateFindings(parsed, conflicts.callCards([one, two]));
    assert.equal(run(make('…DON’T stop…')).findings.length, 1);
    assert.equal(run(make('"Never summarize the scene after the fact"')).findings.length, 1);
    const trimmed = run(make(long)).findings[0].a_span;
    assert.equal(trimmed.split(' ').length, conflicts.SPAN_WORDS);
    assert.ok(long.startsWith(trimmed));
});

test('the call counts what it dropped in the receipt and the stored result keeps the counts', async () => {
    const { key, plan } = reset();
    const p = plan(), [x, y] = p.filter(c => c.on && !c.marker);
    const answer = JSON.stringify([
        { a: x.key, b: y.key, kind: 'overlap', reason: 'Two things.', problem: 'The reply could drift.', a_span: x.text.split(' ').slice(0, 3).join(' '), b_span: y.text.split(' ').slice(0, 3).join(' ') },
        { a: x.key, b: 'ghost::1', kind: 'overlap', reason: 'r', problem: 'p', a_span: 'x', b_span: 'y' },
        { a: x.key, b: y.key, kind: 'overlap', reason: 'r', problem: '', a_span: 'x', b_span: 'y' },
    ]);
    const done = await conflicts.runConflictCheck(key, p, { ask: async () => ({ text: answer }) });
    assert.equal(done.receipt.received, 3);
    assert.equal(done.receipt.kept, 1);
    assert.equal(done.receipt.droppedTotal, 2);
    assert.deepEqual([done.receipt.dropped.keys, done.receipt.dropped.problem], [1, 1]);
    assert.match(done.receipt.summary, /1 finding; 2 dropped: 1 unknown or equal key, 1 empty problem line\. 1 model call\./);
    assert.deepEqual(conflicts.storedConflicts(key).receipt, done.receipt);
});

test('the stored prompt asks only for problems; two identical harmless lines and one point-of-view contradiction give the contradiction alone', async () => {
    const text = promptText('conflictCheck');
    assert.match(text, /Report only items that could make the reply worse/);
    assert.match(text, /Leave out harmless repetition/);
    assert.match(text, /Report and recommend nothing/);
    assert.match(text, /\[\] when nothing could cause a problem/);
    assert.equal(Object.hasOwn(PROMPTS, 'parityEvaluation'), false, 'the parity prompt is gone');
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov'), betaKey(b, 'b-keep')], { base: 'Alpha' });
    const p = plan();
    assert.equal(p.filter(c => c.on && c.text === HARMLESS).length, 2, 'the fixture holds two identical harmless lines');
    const model = scripted();
    const done = await conflicts.runConflictCheck(key, p, { ask: model.ask });
    assert.equal(done.findings.length, 1);
    assert.equal(done.findings[0].kind, 'contradiction');
    assert.equal(model.calls.length, 1);
    // The identical lines reach the model as code notes, and a duplication finding for them is not repeated.
    assert.ok(model.calls[0].input.notes.some(n => n.kind === 'same-text'));
    const again = conflicts.validateFindings([{ a: p.find(c => c.id === 'a-keep').key, b: betaKey(b, 'b-keep'), kind: 'duplication', reason: 'Same.', problem: 'Twice.', a_span: 'Keep sentences short', b_span: 'Keep sentences short' }],
        conflicts.callCards(p), { notes: checkList(p).notes });
    assert.equal(again.findings.length, 0);
    assert.equal(again.dropped.noted, 1);
});

test('the call reads the stack in send order with her customized text and the code notes as context', async () => {
    const { b, key, plan } = reset();
    const version = bank.createVersion(b, betaKey(b, 'b-pov'), { label: 'Hers', text: 'Write every reply in third person limited and use the word I only inside speech.' });
    bank.includeCards(bank.currentBank(), key, [bank.versionKey(version.id)], { base: 'Alpha' });
    const input = conflicts.conflictInput(plan());
    assert.deepEqual(input.blocks.map(x => x.key), plan().filter(c => c.on && !c.marker && c.text.trim()).map(c => c.key), 'send order, markers and empty cards left out');
    assert.ok(input.blocks.some(x => /inside speech/.test(x.text)), 'her text is read');
    assert.ok(input.blocks.some(x => x.source === 'Roleplay Instructions'), 'the extension cards are read');
    assert.ok(Array.isArray(input.notes));
    assert.equal(input.blocks.some(x => x.text?.includes('{{//')), false, 'comment macros are not sent to the model');
    // Beyond the per-block budget a block arrives as three excerpts.
    const huge = [card('Huge', 'word '.repeat(5000)), card('Other', 'short')];
    const big = conflicts.conflictInput(huge);
    assert.equal(big.blocks[0].excerpts.length, 3);
    assert.equal(big.blocks[1].text, 'short');
});

test('nothing is applied: stacks, owners, switches and the plan are identical before and after a call', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    v10.setModuleOwner?.('Alpha', 'dice', 'preset');
    const shape = () => JSON.stringify({ stacks: settings().bankStacks, texts: settings().bankTexts, versions: settings().bankVersions, switches: settings().presetSwitches,
        owners: chatState()?.v10?.moduleOwners, plan: plan(), presets: stored, list: checkList(plan()) .notes.map(n => n.id) });
    const before = shape();
    const model = scripted();
    const done = await conflicts.runConflictCheck(key, plan(), { ask: model.ask });
    assert.equal(done.findings.length, 1);
    assert.equal(shape(), before);
    conflicts.keepBoth(key, plan(), done.findings[0].a, done.findings[0].b);
    assert.equal(shape(), before, 'Keep both changes nothing in the stack');
    assert.equal(model.calls.length, 1);
});

test('a call is made only by runConflictCheck: reading the plan, the notes, the stored result and the stack makes none', async () => {
    const { b, key, plan } = reset();
    let calls = 0;
    const model = scripted({ onCall: () => { calls++; } });
    for (let i = 0; i < 3; i++) {
        bank.refreshBank('open'); checkList(plan()); conflicts.conflictInput(plan()); conflicts.conflictItems(key, plan()); conflicts.storedConflicts(key);
        conflicts.stackStamp(plan());
    }
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    bank.excludeCards(bank.currentBank(), key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    assert.equal(calls, 0);
    await conflicts.runConflictCheck(key, plan(), { ask: model.ask });
    assert.equal(calls, 1);
});

test('Stack changed since the check shows after an include, an exclude, a move or an edit, and clears when the stack is as checked', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    await conflicts.runConflictCheck(key, plan(), { ask: scripted().ask });
    const fresh = () => conflicts.conflictItems(key, plan());
    assert.equal(fresh().stale, false);
    assert.equal(fresh().staleText, '');
    const cur = () => bank.currentBank();
    const povA = bank.cardKey(bank.SOURCE_BASE, 'a-pov'), dice = bank.cardKey(bank.SOURCE_BASE, 'a-dice');

    bank.excludeCards(cur(), key, [dice], { base: 'Alpha' });
    assert.equal(fresh().stale, true, 'exclude');
    assert.equal(fresh().staleText, 'Stack changed since the check');
    bank.undoStack(cur(), key);
    assert.equal(fresh().stale, false, 'undo returns to the checked stack');

    bank.includeCards(cur(), key, [betaKey(b, 'b-keep')], { base: 'Alpha' });
    assert.equal(fresh().stale, true, 'include');
    bank.undoStack(cur(), key);
    assert.equal(fresh().stale, false);

    bank.moveCard(cur(), key, povA, 0, { base: 'Alpha' });
    assert.equal(fresh().stale, true, 'move');
    bank.undoStack(cur(), key);
    assert.equal(fresh().stale, false);

    const version = bank.createVersion(cur(), povA, { label: 'Hers', text: 'Write every reply in first person and keep it brief.' });
    bank.includeCards(cur(), key, [bank.versionKey(version.id)], { base: 'Alpha' });
    await conflicts.runConflictCheck(key, plan(), { ask: scripted().ask });
    assert.equal(fresh().stale, false);
    bank.editVersion(version.id, { text: 'Write every reply in first person and keep it long.' });
    assert.equal(fresh().stale, true, 'edit');
});

test('Keep both marks a pair as seen until either card text changes', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    bank.excludeCards(bank.currentBank(), key, [bank.cardKey(bank.SOURCE_BASE, 'a-pov')], { base: 'Alpha' });
    const version = bank.createVersion(bank.currentBank(), bank.cardKey(bank.SOURCE_BASE, 'a-pov'), { label: 'Hers', text: POV_FIRST });
    bank.includeCards(bank.currentBank(), key, [bank.versionKey(version.id)], { base: 'Alpha' });
    const model = scripted();
    const done = await conflicts.runConflictCheck(key, plan(), { ask: model.ask });
    assert.ok(done.findings.length >= 1);
    const first = conflicts.conflictItems(key, plan());
    assert.equal(first.open.length, first.items.length);
    const target = first.items[0];
    assert.equal(conflicts.keepBoth(key, plan(), target.cards[0].key, target.cards[1].key), true);
    let after = conflicts.conflictItems(key, plan());
    assert.equal(after.items[0].seen, true);
    assert.equal(after.open.length, first.items.length - 1);
    // An include elsewhere changes the stack but not either card: the pair stays seen, the list says the stack changed.
    bank.includeCards(bank.currentBank(), key, [betaKey(b, 'b-keep')], { base: 'Alpha' });
    after = conflicts.conflictItems(key, plan());
    assert.equal(after.stale, true);
    assert.equal(after.items[0].seen, true);
    // Her kept pair survives a new check while neither text changes.
    await conflicts.runConflictCheck(key, plan(), { ask: model.ask });
    assert.equal(conflicts.conflictItems(key, plan()).items[0].seen, true);
    // Editing either card of the pair brings it back.
    const keyOfVersion = bank.versionKey(version.id);
    const editedSide = target.cards.some(c => c.key === keyOfVersion) ? version.id : null;
    assert.ok(editedSide, 'the fixture pair holds her customized version');
    bank.editVersion(version.id, { text: `${POV_FIRST} Keep it brief.` });
    after = conflicts.conflictItems(key, plan());
    assert.equal(after.items.find(i => i.cards.some(c => c.key === keyOfVersion)).seen, false);
    assert.equal(after.stale, true);
});

test('an unreadable answer gets one repair retry with the problem named; a second unreadable answer stops with the stack untouched', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    const good = (await scripted().ask({ user: conflicts.conflictInput(plan()).user })).text;
    let n = 0;
    const calls = [];
    const flaky = async ({ user, repair }) => { calls.push({ user, repair }); n++; return { text: n === 1 ? 'I found two conflicts but here is no list.' : good }; };
    const done = await conflicts.runConflictCheck(key, plan(), { ask: flaky });
    assert.equal(done.receipt.calls, 2);
    assert.equal(done.receipt.repaired, true);
    assert.equal(done.findings.length, 1);
    assert.equal(calls[0].repair, false);
    assert.equal(calls[1].repair, true);
    assert.match(calls[1].user, /Your previous answer could not be used\./);
    assert.match(calls[1].user, /not a JSON array of \{a, b, kind, reason, problem, a_span, b_span\}/);
    assert.match(calls[1].user, /I found two conflicts/, 'the previous answer rides along');
    assert.match(done.receipt.summary, /2 model calls \(one repair retry\)/);

    const before = JSON.stringify(settings().bankStacks);
    let tries = 0;
    await assert.rejects(conflicts.runConflictCheck(key, plan(), { ask: async () => { tries++; return { text: 'still no list' }; } }), /unreadable list of conflicts/);
    assert.equal(tries, 2, 'one retry and no more');
    assert.equal(JSON.stringify(settings().bankStacks), before);
});

test('an answer whose every item is dropped is repaired once; the repair names the reasons', async () => {
    const { b, key, plan } = reset();
    bank.includeCards(b, key, [betaKey(b, 'b-pov')], { base: 'Alpha' });
    const wrong = JSON.stringify([{ a: 'x', b: 'y', kind: 'contradiction', reason: 'r', problem: 'p', a_span: 's', b_span: 't' }, { a: plan()[0].key, b: plan()[1].key, kind: 'nope', reason: 'r', problem: 'p', a_span: 's', b_span: 't' }]);
    const good = (await scripted().ask({ user: conflicts.conflictInput(plan()).user })).text;
    let n = 0, second = '';
    const done = await conflicts.runConflictCheck(key, plan(), { ask: async ({ user }) => { n++; if (n === 2) second = user; return { text: n === 1 ? wrong : good }; } });
    assert.equal(done.receipt.calls, 2);
    assert.equal(done.findings.length, 1);
    assert.match(second, /Every item was dropped \(2 dropped: 1 unknown or equal key, 1 unknown kind\)/);
    // An answer that is a plain empty list is a finished answer: no retry.
    n = 0;
    const none = await conflicts.runConflictCheck(key, plan(), { ask: async () => { n++; return { text: '[]' }; } });
    assert.equal(n, 1);
    assert.equal(none.findings.length, 0);
    assert.match(none.receipt.summary, /^No problems found\. 1 model call\.$/);
    // Fenced and wrapped answers read the same.
    const fenced = await conflicts.runConflictCheck(key, plan(), { ask: async () => ({ text: '```json\n' + good + '\n```' }) });
    assert.equal(fenced.findings.length, 1);
    const wrapped = await conflicts.runConflictCheck(key, plan(), { ask: async () => ({ text: JSON.stringify({ findings: JSON.parse(good) }) }) });
    assert.equal(wrapped.findings.length, 1);
});

test('a note callback on the answer is told how it went; fewer than two blocks make no call', async () => {
    const notes = [];
    const one = [card('Only', 'The one block that is on, with nothing to compare it against at all.')];
    let called = 0;
    const done = await conflicts.checkConflicts(one, { ask: async () => { called++; return { text: '[]' }; } });
    assert.equal(called, 0);
    assert.match(done.receipt.summary, /nothing to compare and no model call was made/);
    const two = [card('A', 'Write the reply in one paragraph of about eighty words exactly.'), card('B', 'Write the reply in four paragraphs of about two hundred words each.')];
    await conflicts.checkConflicts(two, { ask: async () => ({ text: '[]', note: (text, ok) => notes.push([text, ok]) }) });
    assert.deepEqual(notes, [['No problems found. 1 model call.', true]]);
});

test('the parity comparison and hand pairing are gone; stored pairs still read as tags', async () => {
    const workbench = await import('../src/preset-workbench.js');
    assert.equal(workbench.evaluateParity, undefined);
    assert.equal(workbench.savePair, undefined);
    const source = readFileSync(root + 'src/ui/preset-workbench.js', 'utf8') + readFileSync(root + 'src/preset-workbench.js', 'utf8') + readFileSync(root + 'src/prompts.js', 'utf8');
    for (const word of ['parityEvaluation', 'evaluateParity', 'savePair', 'Use this match', 'Choose matching features by hand', 'Compare with 1 model call']) assert.equal(source.includes(word), false, word);
    assert.ok(Object.hasOwn(EXECUTION_OPERATIONS, 'presetParity'), 'the operation entry stays for the routing chain');
    settings().promptPairs = { Alpha: { 'a-dice': ['dice', 'ghost'] } };
    assert.deepEqual(v10.blockCompanions({ id: 'a-dice', name: 'Dice Rolls' }, 'Alpha'), ['dice']);
    delete settings().promptPairs;
});

test('the stored conflict call stays small even for a 200-block stack', async () => {
    const cards = Array.from({ length: 200 }, (_, i) => card(`Block ${i}`, `Block ${i} says to describe scene number ${i} with careful, concrete, sensory language. `.repeat(8)));
    const started = performance.now();
    const input = conflicts.conflictInput(cards, { notes: [] });
    assert.ok(performance.now() - started < 500);
    assert.ok(input.user.length < 200000, `input ${input.user.length}`);
    assert.equal(input.blocks.length, 200);
});

test('B36: no Ours or Theirs control and no file block editor remain in the extension UI; the name rules live in preset-checks only', () => {
    const files = ['src/ui/presets-page.js', 'src/ui/preset-workbench.js', 'src/ui/home-table.js', 'src/ui/v10.js'];
    const source = files.map(file => readFileSync(root + file, 'utf8')).join('\n');
    for (const word of ['presetBlockEditor', "id:'ri-preset-workbench'", 'ri-preset-switches', 'ri-switch-', 'bulkSwitches', 'undoBulkSwitches', 'pinSwitches', 'setSwitches', 'Ours for everything', 'Kept on:', 'Save preset block']) assert.equal(source.includes(word), false, word);
    assert.equal(source.includes("'data-side'"), false, 'no Ours, Theirs, Both segmented control');
    for (const file of files) assert.equal(/pick\\s\*\(\?:1\|one\)|\\block\(\?:ed\)\?/.test(readFileSync(root + file, 'utf8')), false, `${file} holds no lock or pick-one regex`);
    assert.match(readFileSync(root + 'src/preset-checks.js', 'utf8'), /const LOCK = [\s\S]*const PICK = /);
});
