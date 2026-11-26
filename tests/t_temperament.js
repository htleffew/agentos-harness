// B48: temperament on every person record. A speed per meter axis and relationship level, 0.5 (guarded) to 1.5 (volatile),
// 1 by default. Capture infers it once when it first files the person, inside the call it already makes; applySteps scales
// each step by it; her edit sticks. Node suite, no host.
//   node --test tests/t_temperament.js
import assert from 'node:assert/strict';
import test from 'node:test';

const t0 = Date.parse('2026-11-25T12:00:00Z');
function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? 'Heather' : 'Hale', is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [message(0, 'Hale waits at the gate.')], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale', characters: [{ name: 'Hale' }], characterId: 0,
    getCurrentChatId: () => 'b48-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const V = await import('../src/memory/validate.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const K = await import('../src/cards/catalog.js');
const T = await import('../src/memory/temperament.js');

const every = K.captureFields(K.normalizeConfig((() => {
    const all = { on: {}, mode: {} };
    for (const { card, section, key } of K.allFields()) { all.on[key] = true; all.on[K.sectionKey(card.id, section.id)] = true; }
    for (const card of K.CARDS) all.mode[card.id] = 'tray';
    return all;
})()));
const move = (step, reason = 'r') => ({ step, reason });
const stateOf = (name, step, levelStep = step) => ({
    emotions: [{ name, axes: { tenderness: move(step), fury: move(step), dread: move(step), yearning: move(step) } }],
    relationships: [{ name, level: move(levelStep) }],
});
const op = o => ({ target: [], kind: 'person', subject: '', ...o });
const check = (ops, prose, records = []) => V.checkCapture({ decisions: { durable_change: true }, ops }, { prose, player: '', mark: 'm', swipe: 0 }, { records });
const store = S.memoryStore();
const off = { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } };

test('the request asks for a temperament only on an add that files a person for the first time, with no added call', () => {
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'y', reply: 1 }], fields: [] });
    assert.match(req.system, /temperament: on an op add that files a person for the first time/);
    assert.match(req.system, /Every other op leaves temperament null/);
    const t = req.schema.properties.ops.items.properties.temperament;
    assert.deepEqual(Object.keys(t.properties).sort(), ['dread', 'fury', 'level', 'tenderness', 'yearning']);
    assert.ok(t.type.includes('null'), 'the strict schema lets every other op send null');
    assert.equal(Object.keys(req.schema.properties).length, Object.keys(C.captureSchema([]).properties).length);
});

test('a first filing keeps the temperament, held between 0.5 and 1.5; a person already filed keeps the one on file', () => {
    const prose = 'Old Marta met Hale at the gate, slow to speak and slower to trust.';
    const first = check([op({ op: 'add', id: 'marta', subject: 'Marta', text: 'Marta keeps the gatehouse.', quote: 'Old Marta met Hale at the gate', temperament: { tenderness: 0.6, fury: 3, dread: 0.2, yearning: null, level: 'x' } })], prose);
    assert.deepEqual(first.inputs[0].record.temperament, { tenderness: 0.6, fury: 1.5, dread: 0.5 });
    const records = [{ ...first.inputs[0].record, status: 'current' }];
    // A second add, a revise and a supersede for a filed person do not take a new temperament and carry the filed one.
    const again = check([op({ op: 'revise', id: 'marta', target: ['marta'], subject: 'Marta', text: 'Marta keeps the gatehouse and its keys.', quote: 'Old Marta met Hale at the gate', temperament: { fury: 1.5 } })], prose, records);
    assert.deepEqual(again.inputs[0].record.temperament, { tenderness: 0.6, fury: 1.5, dread: 0.5 });
    const changed = check([op({ op: 'supersede', id: 'marta-2', target: ['marta'], subject: 'Marta', text: 'Marta now keeps the east tower.', quote: 'Old Marta met Hale at the gate', temperament: { tenderness: 1.5 } })], prose, records);
    assert.equal(changed.inputs[0].record.temperament.tenderness, 0.6);
    const second = check([op({ op: 'add', id: 'marta-b', subject: 'Marta', attribute: 'post', text: 'Marta serves as gate warden.', quote: 'Old Marta met Hale at the gate', temperament: { fury: 1.5 } })], prose, records);
    assert.equal(second.inputs[0]?.record?.temperament, undefined, 'an add for a filed person asks nothing of the temperament');
    // Another kind never takes one.
    const fact = check([op({ op: 'add', id: 'gate', kind: 'place', subject: 'The gate', text: 'The gate stands open.', quote: 'met Hale at the gate', temperament: { fury: 1.5 } })], prose);
    assert.equal(fact.inputs[0].record.temperament, undefined);
});

test('steps scale by the speed (0.5, 1, 1.5) and clamp to 0 to 10', () => {
    const run = (speed, step, before = 5) => {
        const temperaments = new Map([['hale', { tenderness: speed, fury: speed, dread: speed, yearning: speed, level: speed }]]);
        const state = stateOf('Hale', step);
        const chat = [];
        const meta = {};
        // The start value is 5; a first reply moves from it.
        const out = C.applySteps(state, every, { chat, index: 0, key: 'k', meta, temperaments });
        return { out, em: out.state.emotions[0], rel: out.state.relationships[0] };
    };
    const slow = run(0.5, 4), plain = run(1, 4), fast = run(1.5, 4);
    assert.equal(slow.em.axes.fury, 7);
    assert.equal(plain.em.axes.fury, 9);
    assert.equal(fast.em.axes.fury, 10, '5 + 6 clamps to 10');
    assert.equal(slow.rel.level, 7);
    assert.equal(fast.rel.level, 10);
    assert.deepEqual(slow.em.axes_steps.fury, { step: 2, reason: 'r' }, 'the step kept is the one applied');
    const down = run(1.5, -5);
    assert.equal(down.em.axes.dread, 0, '5 - 8 clamps to 0');
    assert.equal(run(0.5, -3).em.axes.dread, 3, '-3 at 0.5 rounds away from zero to -2');
    assert.equal(run(1.5, 1).em.axes.dread, 7, '1 at 1.5 rounds to 2');
});

test('each axis and the level use their own speed', () => {
    const temperaments = new Map([['hale', { tenderness: 0.5, fury: 1.5, level: 0.5 }]]);
    const out = C.applySteps(stateOf('Hale', 2), every, { temperaments });
    assert.equal(out.state.emotions[0].axes.tenderness, 6);
    assert.equal(out.state.emotions[0].axes.fury, 8);
    assert.equal(out.state.emotions[0].axes.dread, 7, 'an axis with no speed moves at 1');
    assert.equal(out.state.relationships[0].level, 6);
});

test('a person with no temperament, and a chat from before B48, move at 1', () => {
    const plain = C.applySteps(stateOf('Hale', 3), every, {});
    const mapped = C.applySteps(stateOf('Hale', 3), every, { temperaments: T.temperamentMap([{ id: 'hale', kind: 'person', subject: 'Hale', status: 'current', text: 'x' }]) });
    const stranger = C.applySteps(stateOf('Nobody', 3), every, { temperaments: new Map([['hale', { fury: 1.5 }]]) });
    for (const out of [plain, mapped, stranger]) {
        assert.equal(out.state.emotions[0].axes.fury, 8);
        assert.equal(out.state.relationships[0].level, 8);
    }
    assert.equal(T.speedFor(undefined, 'fury'), 1);
    assert.equal(T.speedFor({ fury: 'bad' }, 'fury'), 1);
});

test('the Emotion record a reply files scales its axes by the same speed', () => {
    const records = [{ id: 'marta', kind: 'person', subject: 'Marta', status: 'current', text: 'x', temperament: { dread: 1.5 } }];
    const temperaments = T.temperamentMap(records);
    const ops = [{ op: 'add', kind: 'emotion', subject: 'Marta', axes: { dread: { step: 2, reason: 'q' }, fury: { step: 2, reason: 'q' } } }];
    const out = C.stepOps(ops, { records, temperaments });
    assert.equal(out.ops[0].axes.dread, 8);
    assert.equal(out.ops[0].axes.fury, 7);
});

test('capture files the temperament from the one answer and scales the same reply\'s steps; a later capture does not change it and her edit sticks', async () => {
    host.chat = [message(0, 'Hale waits at the gate.')];
    host.chatMetadata = { ri_memory: { imported: true } };
    const say = (player, reply) => { const n = host.chat.length; host.chat.push(message(n, player, true), message(n + 1, reply)); return n + 1; };
    const first = say('I greet her.', 'Old Marta met Hale at the gate and raised her lantern against his face.');
    store.marks();
    const sent = [];
    const answerOf = (ops, state = {}) => ({ decisions: { durable_change: true, scene_ended: false, out_of_character: false }, time: { elapsed: 5, cue: null }, state, ops });
    const runWith = async (index, answer) => C.runCapture([index], { runChainFn: async request => { sent.push(request); return { ok: true, value: answer, route: 'desktop', model: 'gemma4:12b' }; }, store, settingsValue: { trayCards: {} }, modules: {} });
    const res1 = await runWith(first, answerOf([{ op: 'add', id: 'marta', target: [], kind: 'person', subject: 'Marta', text: 'Marta keeps the gatehouse.', quote: 'Old Marta met Hale at the gate', temperament: { tenderness: 0.5, fury: 1.5, dread: 1, yearning: 1, level: 0.5 } }], { emotions: [{ name: 'Marta', axes: { tenderness: move(4), fury: move(4), dread: move(4), yearning: move(0) } }] }));
    assert.ok(res1.ok);
    const axes = host.chat[first].extra.roleplay_instructions.tracker.emotions.find(e => e.name === 'Marta').axes;
    assert.deepEqual([axes.tenderness, axes.fury, axes.dread, axes.yearning], [7, 10, 9, 5], 'the steps of the reply that files her scale by the temperament it files');
    assert.equal(sent.length, 1, 'one request');
    assert.deepEqual(F.fold(host.chat, host.chatMetadata).byId.get('marta').temperament, { tenderness: 0.5, fury: 1.5, dread: 1, yearning: 1, level: 0.5 });

    // Her edit.
    assert.equal((await T.setTemperament('marta', { fury: 0.8 }, { store })).committed, true);
    assert.deepEqual(F.fold(host.chat, host.chatMetadata).byId.get('marta').temperament, { tenderness: 0.5, fury: 0.8, dread: 1, yearning: 1, level: 0.5 });
    assert.equal((await T.setTemperament('missing', { fury: 1 }, { store })).committed, false);

    // A later capture that files the person again and revises the record leaves her values.
    const second = say('I ask her name.', 'Marta lowered the lantern. "Keeper of this gate for thirty years," she said.');
    const res2 = await runWith(second, answerOf([{ op: 'revise', id: 'marta', target: ['marta'], kind: 'person', subject: 'Marta', text: 'Marta has kept the gatehouse for thirty years.', quote: 'Keeper of this gate for thirty years', temperament: { fury: 1.5, tenderness: 1.5 } }]));
    assert.ok(res2.ok);
    assert.deepEqual(F.fold(host.chat, host.chatMetadata).byId.get('marta').temperament, { tenderness: 0.5, fury: 0.8, dread: 1, yearning: 1, level: 0.5 });
});

test('a delete or branch that removes the first filing removes the temperament with the record', async () => {
    const before = F.fold(host.chat, host.chatMetadata);
    assert.ok(before.byId.get('marta').temperament);
    const gone = host.chat.slice(0, 1);
    const after = F.fold(gone, host.chatMetadata);
    assert.equal(after.byId.get('marta'), undefined);
});
