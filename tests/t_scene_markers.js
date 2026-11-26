// B50: time skips and scene breaks act at once. The reader, the clock, the due list, the three switches and the hook run
// in Node on a host in SillyTavern's shape, with no model and no browser.
// Run with: node --test tests/t_scene_markers.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceClock, clockNow, dueForCapture, dueInGap, findMarkers, markDueRuled, markerSettings, minutesOf, saveMarkerSettings, takeSceneMarkers }
    from '../src/scene-markers.js';

import { sceneAt } from '../src/state.js';

const KEY = 'roleplay_instructions';
const host = {
    extensionSettings: {}, chatMetadata: {}, chat: [], mainApi: 'openai', characterId: '0', characters: [{ avatar: 'captain.png' }],
    key: 'markers', getCurrentChatId() { return this.key; }, eventTypes: {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, async saveChat() {},
};
const box = { value: '', dispatchEvent() { return true; } };
globalThis.SillyTavern = { getContext: () => host };
globalThis.document = { body: { dataset: {} }, getElementById: () => box, querySelector: selector => selector === '#send_textarea' ? box : null };

const reply = (minutes, extra = {}) => ({ name: 'Captain', is_user: false, mes: 'Reply.', extra: { [KEY]: { v10Minutes: minutes, ...extra } } });
const player = text => ({ name: 'You', is_user: true, mes: text, extra: {} });
function reset(chat) {
    host.chat = chat;
    host.chatMetadata = {};
    host.extensionSettings = {};
    box.value = '';
}
const pendings = [
    { id: 'p1', kind: 'thread', threadType: 'Pending', status: 'current', subject: 'The harvest levy', text: 'The levy is collected.', due: '2000' },
    { id: 'p2', kind: 'thread', threadType: 'Pending', status: 'current', subject: 'Messenger arrives', due: 'in two days' },
    { id: 'p3', kind: 'thread', threadType: 'Pending', status: 'current', subject: 'The trial', due: 'in three weeks' },
    { id: 'p4', kind: 'thread', threadType: 'Pending', status: 'current', subject: 'No due time' },
    { id: 'p5', kind: 'thread', threadType: 'Open', status: 'current', subject: 'Open thread', due: '1500' },
    { id: 'p6', kind: 'thread', threadType: 'Pending', status: 'done', subject: 'Done', due: '1500' },
];
const run = async (text, { type = 'normal', closed = [] } = {}) => {
    box.value = text;
    return takeSceneMarkers({}, type, {}, { closeChapter: async () => { closed.push(1); }, listPending: async () => pendings });
};

test('amounts: words, digits, halves and units', () => {
    assert.equal(minutesOf('three days'), 3 * 1440);
    assert.equal(minutesOf('2 weeks'), 2 * 10080);
    assert.equal(minutesOf('an hour'), 60);
    assert.equal(minutesOf('half an hour'), 30);
    assert.equal(minutesOf('a couple of days later'), 2880);
    assert.equal(minutesOf('next week'), 10080);
    assert.equal(minutesOf('until nightfall'), null);
    assert.equal(minutesOf('a long time'), null);
});

test('the reader finds Time skip, Scene and *** lines', () => {
    assert.deepEqual(findMarkers('Time skip: three days\nWe ride.').skip, { text: 'three days', minutes: 4320 });
    assert.equal(findMarkers('**Time skip:** an hour').skip.minutes, 60);
    assert.equal(findMarkers('time skip a while later').skip, null);
    assert.equal(findMarkers('Scene: the harbour at dawn').scene, true);
    assert.equal(findMarkers('We part.\n***\nMorning.').rule, true);
    assert.equal(findMarkers('* * *').rule, true);
    assert.equal(findMarkers('Nothing special here.').found, false);
    assert.equal(findMarkers('Time skip: soon').skip.minutes, null);
});

test('a *** or Time skip inside a quotation, a code fence or a block quote does not trigger', () => {
    assert.equal(findMarkers('She said, "listen\n***\nto me" and left.').found, false);
    assert.equal(findMarkers('"Time skip: three days" is what the sign said.').found, false);
    assert.equal(findMarkers('"Stop.\nTime skip: three days\nGo."').found, false);
    assert.equal(findMarkers('```\n***\n```').found, false);
    assert.equal(findMarkers('> ***').found, false);
    assert.equal(findMarkers('"Quoted." Then\n***\nlater').rule, true);
});

test('Time skip: three days moves the clock three days before the request', async () => {
    reset([reply(100), player('hi'), reply(1000)]);
    assert.equal(clockNow(), 1000);
    const did = await run('Time skip: three days');
    assert.equal(did.clock.moved, true);
    assert.equal(clockNow(), 1000 + 4320);
    assert.equal(host.chat[2].extra[KEY].v10Minutes, 5320);
    assert.equal(host.chat[0].extra[KEY].v10Minutes, 100);
    assert.equal(host.chat[2].extra[KEY].v10SceneBreak.minutes, 4320);
});

test('the scene date and time the writer reads move with the skip', async () => {
    reset([reply(1000, { scene: { date: 'Day 3', time: '21:40' } })]);
    host.chat[0].extra[KEY].tracker = { scene: { time: { v: 'Day 3, 21:40', from: 1 } } };
    assert.equal(sceneAt(Infinity, { overrides: false }).date, 'Day 3');
    const did = await run('Time skip: three days');
    assert.equal(did.scene.date, 'Day 6');
    assert.equal(did.scene.time, '21:40');
    const now = sceneAt(Infinity, { overrides: false });
    assert.equal(now.date, 'Day 6');
    assert.equal(now.time, '21:40');
});

test('the clock moves on the showing swipe too, and from the chat start when no reply has a clock', async () => {
    const message = reply(500);
    message.swipe_id = 0;
    message.swipe_info = [{ extra: { [KEY]: { v10Minutes: 500 } } }];
    reset([message]);
    await run('Time skip: an hour');
    assert.equal(message.swipe_info[0].extra[KEY].v10Minutes, 560);
    const bare = { is_user: false, mes: 'Hello.', extra: {} };
    reset([bare]);
    host.chatMetadata = {};
    const state = { v10ClockSeed: 100 };
    assert.deepEqual(advanceClock([bare], 60, state), { moved: true, unknown: false, from: 100, to: 160 });
    assert.equal(state.v10ClockSeed, 160);
});

test('an amount that cannot be read marks the clock unknown and leaves the minutes alone', async () => {
    reset([reply(1000)]);
    const did = await run('Time skip: a while later');
    assert.equal(did.clock.unknown, true);
    assert.equal(host.chat[0].extra[KEY].v10Minutes, 1000);
    assert.equal(host.chat[0].extra[KEY].v10SceneBreak.unknown, true);
});

test('the chapter closes at the message for a time skip, a scene line and a break', async () => {
    for (const text of ['Time skip: a day', 'Scene: the docks', 'We rest.\n***\nDawn.']) {
        reset([reply(10)]);
        const closed = [];
        const did = await run(text, { closed });
        assert.equal(did.chapter, true, text);
        assert.equal(closed.length, 1, text);
    }
});

test('a Scene line or break leaves the clock alone', async () => {
    reset([reply(10)]);
    await run('Scene: the docks\n***');
    assert.equal(clockNow(), 10);
    assert.equal(host.chat[0].extra[KEY].v10SceneBreak, undefined);
});

test('Pending threads due inside the gap are listed for capture, then leave the list once ruled', async () => {
    reset([reply(1000)]);
    const did = await run('Time skip: three days');
    assert.deepEqual(did.due.map(item => item.id), ['p1', 'p2']);
    assert.deepEqual(dueForCapture().map(item => item.id), ['p1', 'p2']);
    assert.equal(dueForCapture()[0].text, 'The levy is collected.');
    // The data contract capture reads: extra.roleplay_instructions.v10SceneBreak.due, and ruled === true when done.
    assert.deepEqual(host.chat[0].extra.roleplay_instructions.v10SceneBreak.due[0], { id: 'p1', text: 'The levy is collected.', due: '2000' });
    host.chat[0].extra.roleplay_instructions.v10SceneBreak.ruled = true;
    assert.deepEqual(dueForCapture(), []);
    host.chat[0].extra.roleplay_instructions.v10SceneBreak.ruled = false;
    markDueRuled();
    assert.equal(host.chat[0].extra.roleplay_instructions.v10SceneBreak.ruled, true);
    assert.deepEqual(dueForCapture(), []);
});

test('dueInGap: open and finished threads are skipped; an unreadable skip lists every Pending thread with a due time', () => {
    assert.deepEqual(dueInGap(pendings, { from: 1000, minutes: 60 }).map(item => item.id), []);
    assert.deepEqual(dueInGap(pendings, { from: 1000, minutes: null }).map(item => item.id), ['p1', 'p2', 'p3']);
});

test('each switch off removes its effect', async () => {
    reset([reply(1000)]);
    saveMarkerSettings({ clock: false });
    let closed = [];
    let did = await run('Time skip: three days', { closed });
    assert.equal(clockNow(), 1000);
    assert.equal(did.clock, null);
    assert.equal(did.due.length, 2);
    assert.equal(did.chapter, true);

    reset([reply(1000)]);
    saveMarkerSettings({ clock: true, due: false });
    did = await run('Time skip: three days');
    assert.equal(clockNow(), 5320);
    assert.deepEqual(did.due, []);
    assert.deepEqual(dueForCapture(), []);

    reset([reply(1000)]);
    saveMarkerSettings({ due: true, chapter: false });
    closed = [];
    did = await run('Time skip: three days', { closed });
    assert.equal(did.chapter, false);
    assert.equal(closed.length, 0);
    assert.equal(clockNow(), 5320);
    assert.deepEqual(markerSettings(), { clock: true, chapter: false, due: true });
});

test('a swipe, a quiet request or a skipped generation does nothing', async () => {
    reset([reply(1000)]);
    box.value = 'Time skip: a day';
    const closed = [];
    const deps = { closeChapter: async () => { closed.push(1); }, listPending: async () => pendings };
    assert.equal(await takeSceneMarkers({}, 'swipe', {}, deps), null);
    assert.equal(await takeSceneMarkers({}, 'normal', { quiet_prompt: 'x' }, deps), null);
    assert.equal(await takeSceneMarkers({ skip: true }, 'normal', {}, deps), null);
    assert.equal(clockNow(), 1000);
    assert.equal(closed.length, 0);
});

test('sending the same message again before any reply does not move the clock twice', async () => {
    reset([reply(1000)]);
    await run('Time skip: a day');
    await run('Time skip: a day');
    assert.equal(clockNow(), 1000 + 1440);
});

test('a message with no marker costs nothing', async () => {
    reset([reply(1000)]);
    assert.equal(await run('I open the door.'), null);
});
