// B60: the Recording prompts reach every capture. The capture request carries the Recording prompt text of the modules that
// are on, read through promptText so her saved wording goes out; a module that is off sends none of its prompts. The
// capture chain is replaced by a scripted answer, so no model is called.
//   node --test tests/t_recording_prompts.js
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const t0 = Date.parse('2026-11-27T10:00:00Z');
function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? 'Heather' : 'Hale of Verath', is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [message(0, 'Hale waits at the gatehouse of Elerian Keep.')],
    chatMetadata: {}, extensionSettings: { [KEY]: { enabled: true } }, name1: 'Heather', name2: 'Hale of Verath', characters: [{ name: 'Hale of Verath' }], characterId: 0,
    getCurrentChatId: () => 'b60-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const S = await import('../src/memory/store.js');
const K = await import('../src/cards/catalog.js');
const P = await import('../src/prompts.js');
const V10 = await import('../src/v10.js');

const RECORDING = ['timingUpdate', 'structuredFacts', 'structuredPortrayal', 'structuredRelationships', 'structuredKnowledge', 'structuredEmotions', 'structuredOutcomes', 'structuredSchedule'];
const ALL_ON = { ...V10.DEFAULT_MODULES };
const allOff = { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } };
const store = S.memoryStore();
const say = (player, reply) => { const n = host.chat.length; host.chat.push(message(n, player, true), message(n + 1, reply)); return n + 1; };
async function captureSystem(modules, reply = 'Hale lifted the bar from the gate.') {
    const sent = [];
    const index = say('I open the gate.', reply);
    const res = await C.runCapture([index], { modules, store, settingsValue: allOff,
        runChainFn: async request => { sent.push(request); return { ok: true, value: { decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [], state: {} }, route: 'desktop', model: 'gemma4:12b' }; } });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(sent.length, 1, 'one capture call per reply');
    return sent[0].system;
}

test('every Recording prompt of the modules that are on, in her saved wording, is in the capture request', async () => {
    const EDIT = 'Write each lasting feeling as the outward act that shows it, naming who it is aimed at.';
    host.extensionSettings[KEY].prompts = { structuredEmotions: { text: EDIT } };
    try {
        const system = await captureSystem(ALL_ON);
        for (const id of RECORDING) assert.ok(system.includes(P.promptText(id)), `${id} goes out with capture`);
        assert.ok(system.includes(EDIT), 'her saved wording is what goes out');
        assert.ok(!system.includes(P.PROMPTS.structuredEmotions.text), 'the shipped default of an edited prompt stays out');
        // Stable before volatile: the Recording text sits in the system part, after the fixed rules and before the field list.
        const at = system.indexOf('Recording guidance');
        assert.ok(at > system.indexOf(C.CAPTURE_RULES.split('\n').at(-1)), 'after the capture rules');
        assert.ok(at < system.indexOf('No state fields are switched on'), 'before the field list');
    } finally { delete host.extensionSettings[KEY].prompts; }
});

test('a module that is off sends none of its Recording prompts', async () => {
    const without = async (off, absent, present) => {
        const system = await captureSystem({ ...ALL_ON, ...Object.fromEntries(off.map(k => [k, false])) });
        for (const id of absent) assert.ok(!system.includes(P.promptText(id)), `${id} stays out with ${off.join(' and ')} off`);
        for (const id of present) assert.ok(system.includes(P.promptText(id)), `${id} still goes out with ${off.join(' and ')} off`);
    };
    await without(['emotions'], ['structuredEmotions'], ['structuredRelationships', 'timingUpdate']);
    await without(['relationships'], ['structuredRelationships'], ['structuredEmotions']);
    await without(['knowledge'], ['structuredKnowledge'], ['structuredFacts']);
    await without(['state'], ['timingUpdate', 'structuredPortrayal'], ['structuredFacts']);
    await without(['worldEvents'], ['structuredSchedule'], ['structuredOutcomes']);
    await without(['plots', 'worldEvents'], ['structuredOutcomes', 'structuredSchedule'], ['structuredFacts']);
    const none = await captureSystem(Object.fromEntries(Object.keys(ALL_ON).map(k => [k, false])));
    assert.ok(!none.includes('Recording guidance'), 'with every module off nothing is added');
    for (const id of RECORDING) assert.ok(!none.includes(P.promptText(id)), `${id} absent with every module off`);
});

test('the capture prefix stays the same across replies, and the chapter call carries the same Recording text', async () => {
    const a = await captureSystem(ALL_ON, 'Hale counted the sentries on the wall.');
    const b = await captureSystem(ALL_ON, 'The rain stopped before midnight.');
    assert.equal(a, b, 'a routine new reply leaves the system part unchanged');
    const rest = [say('We wait.', 'They waited at the ford.')];
    const ride = await C.remainderForChapter(rest[0], { store, settingsValue: allOff, modules: ALL_ON });
    const carried = C.chapterWithCapture(ride).system;
    for (const id of RECORDING) assert.ok(carried.includes(P.promptText(id)), `${id} rides in the chapter call`);
    await ride.commit({ decisions: { durable_change: false }, ops: [], state: [] });
});

test('the opening contract still carries every Recording prompt in its own form', () => {
    const contract = V10.updateContract(ALL_ON, true);
    for (const id of RECORDING) assert.ok(contract.includes(P.promptText(id)), `${id} in the opening contract`);
    assert.match(contract, /^After the visible prose, include one <story_update v="2">/);
});

test('added size for a typical capture with every module on', () => {
    const added = `Recording guidance from the player's settings. Follow it within the answer form above:\n${V10.recordingPrompts(ALL_ON).join('\n')}`;
    // About four characters per token for English prose.
    const tokens = Math.round(added.length / 4);
    console.log(`B60 added capture text: ${added.length} characters, about ${tokens} tokens`);
    assert.ok(tokens < 600, `the added text stays short (${tokens} tokens)`);
});
