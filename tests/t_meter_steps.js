// B40: meters move in steps that code applies. Node suite, no host.
//   node --test tests/t_meter_steps.js
import assert from 'node:assert/strict';
import test from 'node:test';

const host = { chat: [], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale', characters: [], characterId: 0, getCurrentChatId: () => 'b40', eventSource: { on() {} }, eventTypes: {}, saveSettingsDebounced() {}, saveMetadataDebounced() {} };
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const K = await import('../src/cards/catalog.js');
const T = await import('../src/ui/card-templates.js');

const KEY = 'roleplay_instructions';
const every = K.captureFields(K.normalizeConfig((() => {
    const all = { on: {}, mode: {} };
    for (const { card, section, key } of K.allFields()) { all.on[key] = true; all.on[K.sectionKey(card.id, section.id)] = true; }
    for (const card of K.CARDS) all.mode[card.id] = 'tray';
    return all;
})()));
const meterFields = every.filter(f => f.type === 'meter' || f.type === 'gauge');
const mk = (extra = {}) => ({ name: 'Hale', is_user: false, mes: 'x', swipe_id: 0, swipes: ['x'], swipe_info: [{ extra: {} }], extra });
const withTracker = tracker => mk({ [KEY]: { tracker } });
const move = (step, reason = 'r') => ({ step, reason });
const stateOf = (axes, level) => ({
    emotions: [{ name: 'Hale', axes }],
    relationships: [{ name: 'Hale', level }],
});

test('the request asks for { step, reason } with step -5 to 5 and no absolute meter value', () => {
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'a', prose: 'b', reply: 1 }], fields: every });
    const state = req.schema.properties.state.properties;
    const axis = state.emotions.items.properties.axes.properties.fury;
    assert.deepEqual(Object.keys(axis.properties).sort(), ['reason', 'step']);
    assert.deepEqual(axis.properties.step.enum, [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    const level = state.relationships.items.properties.level;
    assert.ok([].concat(level.type).includes('object'));
    assert.ok(!state.relationships.items.properties.change, 'the gauge step carries the reason, so no separate change field');
    const op = req.schema.properties.ops.items.properties.axes.properties.dread;
    assert.deepEqual(op.properties.step.enum.length, 11);
    assert.match(req.system, /step, reason|\{ step, reason \}/);
    // the read schema accepts an out-of-range step so code can clamp it
    const read = C.captureReadSchema(every);
    assert.equal(read.properties.state.properties.emotions.items.properties.axes.properties.fury.properties.step.enum, undefined);
});

test('value = previous value + step, held between 0 and 10; a missing previous value starts at 5', () => {
    const chat = [mk(), mk(), withTracker({ emotions: [{ name: 'Hale', axes: { tenderness: 9, fury: 1, dread: 5, yearning: 5 } }], relationships: [{ name: 'Hale', level: 8 }] }), mk()];
    const state = stateOf({ tenderness: move(4, 'she took his hand'), fury: move(-5, 'he laughed'), dread: move(2), yearning: move(0) }, move(-3, 'she left the table'));
    const out = C.applySteps(state, meterFields, { chat, index: 3, key: KEY });
    assert.deepEqual(out.state.emotions[0].axes, { tenderness: 10, fury: 0, dread: 7, yearning: 5 });
    assert.equal(out.state.relationships[0].level, 5);
    assert.equal(out.state.emotions[0].axes_steps.tenderness.step, 4);
    assert.equal(out.state.emotions[0].axes_steps.tenderness.reason, 'she took his hand');
    // no previous reply: start at 5
    const first = C.applySteps(stateOf({ tenderness: move(2) }, move(1)), meterFields, { chat: [mk(), mk()], index: 1, key: KEY });
    assert.equal(first.state.emotions[0].axes.tenderness, 7);
    assert.equal(first.state.emotions[0].axes.fury, 5);
    assert.equal(first.state.relationships[0].level, 6);
    // the chat's starting inference replaces 5
    const meta = { ri_memory: { meterStart: { relationships: { hale: { level: 2 } } } } };
    const seeded = C.applySteps(stateOf({}, move(1)), meterFields, { chat: [mk(), mk()], index: 1, key: KEY, meta });
    assert.equal(seeded.state.relationships[0].level, 3);
});

test('a step outside -5..5 is clamped and logged; a missing step counts as 0', () => {
    const chat = [mk(), mk()];
    const out = C.applySteps(stateOf({ tenderness: move(9, 'big'), fury: { reason: 'no step' }, dread: undefined }, move(-8)), meterFields, { chat, index: 1, key: KEY });
    assert.equal(out.state.emotions[0].axes.tenderness, 10);
    assert.equal(out.state.emotions[0].axes.fury, 5);
    assert.equal(out.state.relationships[0].level, 0);
    assert.ok(out.notes.some(n => /tenderness.*clamped to 5/.test(n)), out.notes.join('|'));
    assert.ok(out.notes.some(n => /fury.*no step/.test(n)));
    assert.ok(out.notes.some(n => /level.*clamped to -5/.test(n)));
});

test('old chats: the last absolute value is the starting point and nothing is rewritten', () => {
    const old = withTracker({ emotions: [{ name: 'Hale', axes: { tenderness: 3, fury: 8, dread: 0, yearning: 6 } }], relationships: [{ name: 'Hale', level: { v: 7, from: 12 }, change: 'trust up' }] });
    const before = structuredClone(old);
    const chat = [mk(), old, mk()];
    const out = C.applySteps(stateOf({ tenderness: move(1) }, move(1)), meterFields, { chat, index: 2, key: KEY });
    assert.equal(out.state.emotions[0].axes.tenderness, 4);
    assert.equal(out.state.emotions[0].axes.fury, 8);
    assert.equal(out.state.relationships[0].level, 8);
    assert.deepEqual(old, before);
});

test('each swipe recomputes from its own previous value', () => {
    // two replies; reply 2 has two swipes, each captured against reply 1's showing value, and reply 3 follows the showing one
    const chat = [mk(), withTracker({ relationships: [{ name: 'Hale', level: 5 }] }), mk()];
    const swipeA = C.applySteps(stateOf({}, move(3, 'a')), meterFields, { chat, index: 2, key: KEY });
    const swipeB = C.applySteps(stateOf({}, move(-2, 'b')), meterFields, { chat, index: 2, key: KEY });
    const stamp = (message, applied, swipe) => {
        message.swipe_id = swipe; message.swipe_info[swipe] ||= { extra: {} };
        C.stampMessage(message, { hash: `h${swipe}`, at: 1, tracker: C.trackerFrom(applied.state, meterFields), key: KEY });
    };
    stamp(chat[2], swipeA, 0);
    const first = structuredClone(chat[2].extra[KEY].tracker);
    chat[2].swipes.push('y'); stamp(chat[2], swipeB, 1);
    assert.equal(first.relationships[0].level, 8);
    assert.equal(chat[2].swipe_info[0].extra[KEY].tracker.relationships[0].level, 8);
    assert.equal(chat[2].extra[KEY].tracker.relationships[0].level, 3);
    assert.deepEqual(chat[2].extra[KEY].tracker.relationships[0].change, { delta: -2, reason: 'b' });
    // the next reply steps from whichever swipe shows
    chat.push(mk());
    const next = C.applySteps(stateOf({}, move(1)), meterFields, { chat, index: 3, key: KEY });
    assert.equal(next.state.relationships[0].level, 4);
});

test('a value she sets by hand locks it; later steps start from her value', () => {
    const reply1 = withTracker({ emotions: [{ name: 'Hale', axes: { tenderness: 4, fury: 4, dread: 4, yearning: 4 } }] });
    assert.ok(C.setMeterByHand(reply1, KEY, { card: 'emotions', name: 'Hale', field: 'axes', axis: 'fury', value: 9 }));
    assert.equal(reply1.extra[KEY].tracker.emotions[0].axes.fury, 9);
    // a repeat capture of the same reply keeps her value over previous + step
    const again = C.applySteps(stateOf({ fury: move(-4) }, move(0)), meterFields, { chat: [mk(), reply1], index: 1, key: KEY, own: reply1.extra[KEY].tracker });
    assert.equal(again.state.emotions[0].axes.fury, 9);
    // the next reply starts from her value
    const next = C.applySteps(stateOf({ fury: move(-2) }, move(0)), meterFields, { chat: [mk(), reply1, mk()], index: 2, key: KEY });
    assert.equal(next.state.emotions[0].axes.fury, 7);
});

test('emotion records step too: op axes become whole values from the record before', () => {
    const records = [{ id: 'hale-mood', kind: 'emotion', subject: 'Hale', axes: { tenderness: 6, fury: 2, dread: 2, yearning: 2 } }];
    const out = C.stepOps([{ op: 'revise', id: 'hale-mood', subject: 'Hale', axes: { tenderness: move(-9), fury: move(3) } }], { records, chat: [mk(), mk()], index: 1, key: KEY });
    assert.deepEqual(out.ops[0].axes, { tenderness: 1, fury: 5 });
    assert.ok(out.notes.length === 1);
});

test('the change chip shows the step and its reason as captured; a step of 0 shows no chip', () => {
    const text = node => (node?.textContent ?? '');
    assert.equal(T.changeChip(0, 'nothing moved'), null);
    assert.equal(T.changeChip(0), null);
});
