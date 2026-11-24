// B2: titled options, the results cache and the queue sheet's model (DESIGN.md 4.4 and 4.5).
import assert from 'node:assert/strict';
import test from 'node:test';

const key = 'roleplay_instructions';
const out = [];
let answer = '';
const chat = [
    { name: 'Captain', is_user: false, mes: 'The gate stands open.', send_date: 'greeting', extra: { [key]: {} } },
    { name: 'Mira', is_user: true, mes: 'I step inside.', send_date: 'user-1' },
    { name: 'Captain', is_user: false, mes: 'The Captain raises his lantern.', send_date: 'reply-1', swipe_id: 0, extra: { [key]: {} } },
];
const host = {
    chat, name1: 'Mira', name2: 'Captain', mainApi: 'openai', getCurrentChatId: () => 'results-sheet-test',
    characters: [{ name: 'Captain', description: 'A tired gate captain.' }], characterId: 0,
    powerUserSettings: {}, chatCompletionSettings: {}, chatMetadata: { [key]: {} }, extensionSettings: { [key]: {} }, saveChat: async () => {},
    substituteParams: value => value.replaceAll('{{user}}', 'Mira').replaceAll('{{char}}', 'Captain'),
    generateRaw: async args => { out.push(structuredClone(args)); return answer; },
};
globalThis.SillyTavern = { getContext: () => host };
// dom.js prepares a canvas at load; a stub document lets the UI modules load without a page.
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), querySelector: () => null, documentElement: {}, body: { dataset: {} } };
globalThis.MutationObserver ??= class { observe() {} };

const { optionsFormat, parseOptions, runGuidedTurn, guidedTarget } = await import('../../src/guided-turns.js');
const { cachedOptions, cardModel, clearOptionsCache, optionsCacheKey, progressText, rememberOptions } = await import('../../src/ui/results-sheet.js');
const { queueItems, updateQueuedRow } = await import('../../src/ui/queue-sheet.js');
const { optionsRequest } = await import('../../src/quick-actions.js');

test('reads titled options from a JSON answer', () => {
    const { options, partial } = parseOptions('[{"title":"The Lantern Keeper","text":"Old Maren arrives with keys."},{"title":"A Courier","text":"A rider reins in hard."}]', 2);
    assert.deepEqual(options, [
        { title: 'The Lantern Keeper', text: 'Old Maren arrives with keys.', incomplete: false },
        { title: 'A Courier', text: 'A rider reins in hard.', incomplete: false },
    ]);
    assert.equal(partial, false);
});

test('drops separator fragments and keeps title-only leftovers as incomplete with no text', () => {
    const { options } = parseOptions('["The Keeper: Old Maren arrives.", "---", "* * *", {"title":"Orphan","text":"---"}]', 4);
    assert.deepEqual(options.map(option => [option.title, option.text, option.incomplete]), [
        ['The Keeper', 'Old Maren arrives.', false],
        ['Orphan', '', true],
    ]);
    assert.ok(options.every(option => !/^[-*\s]+$/.test(option.text) || !option.text));
});

test('salvages a cut-off answer: complete options stay, the last one is marked incomplete', () => {
    const cut = parseOptions('[{"title":"One","text":"Body one."},{"title":"Two","text":"Body two stops mid', 4);
    assert.deepEqual(cut.options, [
        { title: 'One', text: 'Body one.', incomplete: false },
        { title: 'Two', text: 'Body two stops mid', incomplete: true },
    ]);
    assert.equal(cut.partial, true);
    const titleOnly = parseOptions('[{"title":"One","text":"Body one."},{"title":"Orphan"', 4);
    assert.deepEqual(titleOnly.options[1], { title: 'Orphan', text: '', incomplete: true });
});

test('reads plain-text answers with bold titles, separators, numbered lists and emoji titles', () => {
    const bold = parseOptions('**The Keeper** — Old Maren arrives.\n\n---\n\n**The Courier**: A rider reins in.\n\n***', 4).options;
    assert.deepEqual(bold.map(option => [option.title, option.text]), [['The Keeper', 'Old Maren arrives.'], ['The Courier', 'A rider reins in.']]);
    const numbered = parseOptions('1. The Keeper\nOld Maren arrives at dusk.\n2. The Courier\nA rider reins in.', 4).options;
    assert.deepEqual(numbered.map(option => option.title), ['The Keeper', 'The Courier']);
    const fenced = parseOptions('```json\n[{"name":"\u{1F5DD}️ Keeper","description":"Keeper\\nOld Maren arrives.\\n---"}]\n```', 4).options;
    assert.deepEqual(fenced, [{ title: 'Keeper', text: 'Old Maren arrives.', incomplete: false }]);
    assert.deepEqual(parseOptions('', 4).options, []);
});

test('the Options request asks for titled objects of the set length and carries typed text in the same request', async () => {
    out.length = 0;
    answer = JSON.stringify([{ title: 'The Keeper', text: 'Old Maren arrives. She carries keys.' }, { title: 'The Courier', text: 'A rider arrives.' }]);
    const config = optionsRequest({ title: 'NPC options', count: 2, length: 'short', prompt: 'Suggest a new NPC.' });
    const result = await runGuidedTurn('draft', { mode: 'choices', suggestions: config, direction: 'Someone from the harbor.', target: guidedTarget() });
    assert.equal(out.length, 1);
    const sent = JSON.stringify(out[0]);
    assert.ok(sent.includes('Write each option in two or three sentences.'));
    assert.ok(sent.includes(JSON.stringify(optionsFormat(2)).slice(1, -1)));
    assert.ok(sent.includes('Someone from the harbor.'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.choices.map(option => option.title), ['The Keeper', 'The Courier']);
});

test('the results cache matches on chat, reply, swipe, text and settings', () => {
    clearOptionsCache();
    const action = { id: 'builtin:options:npc', count: 4, length: 'medium', prompt: 'P', title: 'NPC options' };
    const target = { index: 2, swipe: 0, text: 'The Captain raises his lantern.' };
    const keyFor = change => optionsCacheKey({ chat: 'chat-a', target: { ...target, ...change.target }, action: { ...action, ...change.action } });
    const base = keyFor({});
    rememberOptions(action, [{ title: 'A', text: 'B.', incomplete: false }], base);
    assert.deepEqual(cachedOptions(action, base), [{ title: 'A', text: 'B.', incomplete: false }]);
    for (const change of [{ target: { swipe: 1 } }, { target: { text: 'Edited.' } }, { target: { index: 4 } }, { action: { count: 5 } }, { action: { length: 'short' } }]) {
        rememberOptions(action, [{ title: 'A', text: 'B.' }], base);
        assert.equal(cachedOptions(action, keyFor(change)), null, JSON.stringify(change));
    }
    rememberOptions(action, [{ title: 'A', text: 'B.' }], base);
    assert.equal(cachedOptions(action, optionsCacheKey({ chat: 'chat-b', target, action })), null);
    assert.ok(cachedOptions(action, base), 'another chat leaves this chat\'s results in place');
    assert.equal(optionsCacheKey({ chat: 'c', target, action }).includes('lantern'), false);
});

test('cards name incomplete options and only usable ones carry text', () => {
    assert.deepEqual(cardModel({ title: 'Orphan', text: '', incomplete: true }, 1), { title: 'Orphan', text: '', incomplete: true, usable: false });
    assert.deepEqual(cardModel({ title: '', text: 'Body.' }, 2), { title: 'Option 3', text: 'Body.', incomplete: false, usable: true });
    assert.equal(progressText(2, 4), '2 of 4');
});

test('queue items list directions and action checks, and edits respect sent bindings', () => {
    const state = {
        pending: [
            { id: 'd1', rows: [{ title: 'Bring in conflict', text: 'A rival arrives.', visibility: 'private', required: false }] },
            { id: 'c1', rows: [], roll: { text: 'd20 14 against 12: success' } },
            { id: 'd2', rows: [{ text: 'Bound row.', visibility: 'visible', required: true }] },
        ],
        bindings: [{ entries: [{ id: 'd2' }] }],
    };
    const items = queueItems(state);
    assert.deepEqual(items.map(item => [item.kind, item.title, item.bound]), [
        ['direction', 'Bring in conflict', false], ['check', 'Action check', false], ['direction', 'Direction 3', true]]);
    assert.equal(items[1].roll, 'd20 14 against 12: success');
    assert.equal(updateQueuedRow(state, 'd1', 0, { visible: true, required: true, text: 'A rival walks in.' }), true);
    assert.deepEqual(state.pending[0].rows[0], { title: 'Bring in conflict', text: 'A rival walks in.', visibility: 'visible', required: true });
    assert.equal(updateQueuedRow(state, 'd1', 0, { text: '   ' }), false);
    assert.equal(updateQueuedRow(state, 'd2', 0, { visible: false }), false);
    assert.equal(state.pending[2].rows[0].visibility, 'visible');
});
