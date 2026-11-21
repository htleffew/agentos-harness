import assert from 'node:assert/strict';
import test from 'node:test';

const key = 'roleplay_instructions';
const player = 'Mira';
const npc = 'Captain';
const playerText = 'I ask whether he took the key.';
const npcSecret = 'The Captain intends to leave through a hidden hatch.';
const user = (text, id) => ({ name: player, is_user: true, mes: text, send_date: id });
const reply = (text, id, extra = {}) => ({ name: npc, is_user: false, mes: text, send_date: id, extra: { [key]: extra } });
const out = [];
let result = '';
const chat = [
    reply('An old opening using an expired pattern.', 'greeting'),
    user('I push the gate.', 'user-1'),
    reply('The Captain raises his lantern.', 'reply-1', { scene: { where: 'Gatehouse', present: 'Mira, Captain' } }),
    user(playerText, 'user-2'),
    reply('The Captain puts one hand in his pocket.', 'reply-2', {
        scene: { where: 'Gatehouse', present: 'Mira, Captain' },
        v10Changes: [
            { id: 'captain-plan', kind: 'knowledge', subject: npc, text: npcSecret, private: true },
            { id: 'mira-key', kind: 'knowledge', subject: player, text: 'The steward loaned me the key.', basis: 'observed', private: true },
        ],
    }),
];
const host = {
    chat, name1: player, name2: npc, mainApi: 'openai', getCurrentChatId: () => 'guided-turn-test',
    characters: [{ name: npc, description: 'He hides a distinctive secret under his sleeve.' }], characterId: 0,
    powerUserSettings: { persona_description: 'Mira repairs locks for a living.' },
    chatCompletionSettings: { impersonation_prompt: 'Distinctive persona instruction from the active preset.' },
    chatMetadata: { [key]: {} }, extensionSettings: { [key]: {} }, saveChat: async () => {},
    substituteParams: value => value.replaceAll('{{user}}', player).replaceAll('{{char}}', npc),
    generateRaw: async args => { out.push(structuredClone(args)); return result; },
};
globalThis.SillyTavern = { getContext: () => host };
const { cancelGuidedTurn, guidedPreview, guidedTarget, guidedVersions, parsePlayerChoices, runGuidedTurn, selectGuidedVersion, undoGuidedContinuation } = await import('../../src/guided-turns.js');
const { preserveContinuationPrefix, projectGuidedRequest } = await import('../../src/guided-context.js');

test('salvages closed choices from an interrupted JSON batch and rejects inert placeholders', () => {
    const partial = parsePlayerChoices('[{"text":"I let the Captain pass."},{"text":"Raise tension"},{"text":"I wait."},{"text":"I ask');
    assert.deepEqual(partial.choices, ['I let the Captain pass.', 'I wait.']);
    assert.equal(partial.partial, true);
    assert.deepEqual(parsePlayerChoices('1. Plot twist\n2. **Wait** — I wait.\n3. [Say something]\n4. I go.').choices, ['I wait.', 'I go.']);
    assert.deepEqual(parsePlayerChoices('```json\n["I open the door.","I wait.","I ask for the key.","I go."]\n```').choices,
        ['I open the door.', 'I wait.', 'I ask for the key.']);
});

test('Fresh start keeps stable host blocks and current contribution and identifies retained history', () => {
    const prefix = { role: 'system', content: 'Standing block' };
    const current = { role: 'user', content: playerText };
    const assistant = { role: 'assistant', content: chat[2].mes };
    const messages = [prefix, { role: 'assistant', content: chat[0].mes }, { role: 'user', content: chat[1].mes }, assistant, current];
    const receipt = projectGuidedRequest(messages, { type: 'swipe', target: guidedTarget(4), freshStart: true, facts: 'The gate is open.' });
    assert.deepEqual(receipt, { mode: 'substituted', removed: 3 });
    assert.equal(messages[0], prefix);
    assert.equal(messages[1], current);
    assert.match(messages.at(-1).content, /The gate is open/);
    const unknown = { role: 'assistant', content: 'A history adapter transformed this passage beyond recognition.' };
    const unrecognized = [prefix, unknown];
    assert.equal(projectGuidedRequest(unrecognized, { freshStart: true }).mode, 'retained');
    assert.equal(unrecognized[1], unknown);
    assert.equal(preserveContinuationPrefix('First line.\n\n', 'First line. Then I hesitate.'), 'First line.\n\nThen I hesitate.');
    assert.equal(preserveContinuationPrefix('First line.', 'It is a different first line.'), null);
});

test('one CYOA helper request contains only player context and selected directions once', async () => {
    result = '["I ask for the key.","I hold the gate open.","I test the lock."]';
    const before = structuredClone(chat);
    const response = await runGuidedTurn('draft', { mode: 'choices', target: guidedTarget(), composer: 'My untouched fragment.',
        cues: ['Keep the exchange brisk.', 'Keep the exchange brisk.'], direction: 'I want to ask about the key.' });
    assert.deepEqual(response.choices, ['I ask for the key.', 'I hold the gate open.', 'I test the lock.']);
    assert.equal(response.receipt.attempts, 1);
    assert.equal(out.length, 1);
    const sent = `${out[0].systemPrompt}\n${out[0].prompt[0].content}`;
    for (const present of ['Mira repairs locks', 'The steward loaned me the key', 'Gatehouse', playerText, 'My untouched fragment.', 'I want to ask about the key.']) assert(sent.includes(present), present);
    assert.equal(sent.match(/Keep the exchange brisk\./g).length, 1);
    assert.equal(sent.match(/Distinctive persona instruction/g).length, 1);
    for (const secret of [npcSecret, 'under his sleeve', chat[4].mes]) assert(!sent.includes(secret), secret);
    assert.deepEqual(chat, before);
});

test('historical helper limits its request to the target timeline and rejects an edit in flight', async () => {
    const target = guidedTarget(2);
    result = 'The Captain lowers his lantern.';
    const later = structuredClone(chat.slice(3));
    const response = await runGuidedTurn('swipe', { target, freshStart: true, direction: 'Bring the lantern down.' });
    assert(response.ok);
    assert.equal(response.receipt.attempts, 1);
    assert.equal(chat[2].swipes[0], target.text);
    assert.equal(chat[2].mes, result);
    assert.deepEqual(chat.slice(3), later);
    const sent = JSON.stringify(out[1]);
    for (const excluded of [target.text, playerText, npcSecret, chat[0].mes]) assert(!sent.includes(excluded), excluded);
    assert(sent.includes('Bring the lantern down.'));
    const originalGenerator = host.generateRaw;
    host.generateRaw = async () => { chat[2].mes = 'Manual edit during generation.'; return 'Candidate generated after the edit.'; };
    try {
        await assert.rejects(runGuidedTurn('continue', { target: guidedTarget(2) }), /selected reply changed/);
        assert.equal(chat[2].mes, 'Manual edit during generation.');
    } finally { host.generateRaw = originalGenerator; }
});

test('continuation preserves exact text, other swipes, later prose, and has a guarded undo', async () => {
    const target = guidedTarget(2), before = structuredClone(chat[2]), later = structuredClone(chat.slice(3));
    result = 'He waits for my answer.';
    const response = await runGuidedTurn('continue', { target });
    assert.equal(chat[2].mes, `${target.text}\n\n${result}`);
    assert.equal(chat[2].swipes[0], before.swipes[0]);
    assert.deepEqual(chat.slice(3), later);
    await undoGuidedContinuation(response.undo);
    assert.deepEqual(chat[2], before);
    await assert.rejects(undoGuidedContinuation(response.undo), /selected reply changed/);
});

test('historical swipes can be selected by extension code without generation', async () => {
    const current = guidedTarget(2), callsBefore = out.length;
    const choices = guidedVersions(current);
    assert.equal(choices.length, 2);
    assert.equal((await selectGuidedVersion(current, 0)).text, choices[0].text);
    assert.equal((await selectGuidedVersion(guidedTarget(2), 1)).text, current.text);
    assert.equal(out.length, callsBefore);
});

test('cancelling a direct Main API helper discards its result before it reaches the target', async () => {
    const target = guidedTarget(2), before = structuredClone(chat);
    const originalGenerator = host.generateRaw;
    let dispatched, finish;
    const ready = new Promise(resolve => { dispatched = resolve; });
    host.generateRaw = () => new Promise(resolve => { finish = resolve; dispatched(); });
    try {
        const pending = runGuidedTurn('continue', { target });
        await ready;
        assert.match(cancelGuidedTurn(), /may finish/);
        finish('The Captain steps through the door.');
        await assert.rejects(pending, error => error.name === 'AbortError' && error.receipt?.attempts === 1);
        assert.deepEqual(chat, before);
    } finally { host.generateRaw = originalGenerator; }
});

test('a helper returns a draft to the originating editor after a chat switch without changing either chat', async () => {
    const target = guidedTarget(), before = structuredClone(chat), other = [reply('Other chat greeting.', 'other')];
    const originalGenerator = host.generateRaw, currentId = host.getCurrentChatId;
    let dispatched, finish;
    const ready = new Promise(resolve => { dispatched = resolve; });
    host.generateRaw = () => new Promise(resolve => { finish = resolve; dispatched(); });
    try {
        const pending = runGuidedTurn('draft', { target, composer: 'The originating composer.' });
        await ready;
        host.chat = other;
        host.getCurrentChatId = () => 'other';
        finish('I put the key in my pocket.');
        const draft = await pending;
        assert.equal(draft.text, 'I put the key in my pocket.');
        assert.equal(draft.receipt.chat, target.chatId);
        assert.equal(other[0].mes, 'Other chat greeting.');
        assert.deepEqual(chat, before);
    } finally {
        host.chat = chat;
        host.getCurrentChatId = currentId;
        host.generateRaw = originalGenerator;
    }
});

test('drafts use the helper when native status is disconnected, and host-context macros stay inert', async () => {
    const original = { ...host }, originalBase = host.chatCompletionSettings.impersonation_prompt;
    host.generate = () => {};
    host.stopGeneration = () => {};
    host.eventSource = { removeListener: () => {} };
    host.eventTypes = { CHAT_COMPLETION_PROMPT_READY: 'prompt-ready', IMPERSONATE_READY: 'draft-ready' };
    host.onlineStatus = 'no_connection';
    try {
        assert.equal(guidedPreview('draft', { target: guidedTarget() }).route, 'Player-only helper');
        host.onlineStatus = 'Valid';
        assert.equal(guidedPreview('draft', { target: guidedTarget() }).route, 'Native impersonation');
        host.chatCompletionSettings.impersonation_prompt = '{{lastMessage}}';
        host.substituteParams = value => value.replaceAll('{{lastMessage}}', npcSecret);
        assert.equal(guidedPreview('draft', { target: guidedTarget() }).route, 'Player-only helper');
        result = 'I wait by the gate.';
        await runGuidedTurn('draft', { direction: 'Keep {{lastMessage}} literal.' });
        const sent = out.at(-1);
        assert(!sent.systemPrompt.includes(npcSecret));
        assert(!sent.prompt[0].content.includes('{{lastMessage}}'));
        assert(sent.prompt[0].content.includes('lastMessage'));
    } finally {
        host.chatCompletionSettings.impersonation_prompt = originalBase;
        for (const prop of ['generate','stopGeneration','eventSource','eventTypes','onlineStatus']) delete host[prop];
        Object.assign(host, original);
    }
});
