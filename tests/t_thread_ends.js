// B49: story threads end on a written condition and can pause. Capture writes the "ends when" line when it opens a thread,
// checks it on each reply inside the call it already makes, completes the thread when it is met, and pauses or resumes it.
// Paused threads stay on file and leave the pacing pool. Node suite, no host.
//   node --test tests/t_thread_ends.js
import assert from 'node:assert/strict';
import test from 'node:test';

const t0 = Date.parse('2026-11-25T11:00:00Z');
function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? 'Heather' : 'Hale', is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [message(0, 'Hale holds an unsigned letter in the gatehouse.')], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale', characters: [{ name: 'Hale' }], characterId: 0,
    getCurrentChatId: () => 'b49-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const V = await import('../src/memory/validate.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const K = await import('../src/cards/catalog.js');
const I = await import('../src/memory/import.js');
const T = await import('../src/memory/thread-state.js');
const P = await import('../src/pacing.js');

const store = S.memoryStore();
const say = (player, reply) => { const n = host.chat.length; host.chat.push(message(n, player, true), message(n + 1, reply)); return n + 1; };
const op = o => ({ target: [], kind: 'thread', subject: '', ...o });
const durable = { decisions: { durable_change: true } };
const check = (ops, prose, records = []) => V.checkCapture({ ...durable, ops }, { prose, player: '', mark: 'm', swipe: 0 }, { records });
const off = { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } };
const LETTER = 'The unsigned letter arrived at dawn and Hale does not know who sent it.';
const ENDS = 'when Hale learns who sent the letter';

let opened;
test('a thread opened by capture carries an "ends when" line, asked for by the request and stored on the record', async () => {
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'y', reply: 1 }], fields: [] });
    assert.match(req.system, /ends_when: one plain line naming what has to happen/);
    const props = req.schema.properties.ops.items.properties;
    assert.ok(props.ends_when && props.thread_state, 'the schema carries both fields');
    assert.deepEqual(props.thread_state.enum.filter(Boolean), ['open', 'paused']);

    opened = say('I open the gate.', 'A rider left the unsigned letter at the gate at dawn. Hale read it twice and did not know the hand.');
    store.marks();
    const res = check([op({ op: 'add', id: 'letter', threadType: undefined, thread_type: 'Plotline', subject: 'Hale', text: LETTER, ends_when: ENDS, quote: 'left the unsigned letter at the gate at dawn' })], host.chat[opened].mes);
    assert.equal(res.inputs[0].record.endsWhen, ENDS);
    assert.equal(res.inputs[0].record.threadType, 'Plotline');
    await store.commit(store.begin(opened), res.inputs);
    const rec = F.fold(host.chat, host.chatMetadata).byId.get('letter');
    assert.equal(rec.endsWhen, ENDS);
    // The next request shows the stored line beside the thread.
    const next = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'The letter lay on the table.', reply: 2 }], records: F.fold(host.chat, host.chatMetadata).records, fields: [] });
    assert.match(next.user, new RegExp(`letter \\| thread/Plotline \\| Hale \\| .*\\| ends when ${ENDS}`));
});

test('a reply that does not meet the condition leaves the thread open; one that meets it completes the thread with the reply as evidence', async () => {
    const quiet = say('I wait.', 'Hale spent the day mending the gatehouse roof.');
    const none = check([], host.chat[quiet].mes, F.fold(host.chat, host.chatMetadata).records);
    assert.equal(none.inputs.length, 0);
    store.marks();
    await store.commit(store.begin(quiet), none.inputs);
    assert.equal(F.fold(host.chat, host.chatMetadata).byId.get('letter').status, 'current');

    const met = say('I ask the rider.', '"Lord Darius sent it," the rider said. Hale folded the letter into his coat.');
    store.marks();
    const records = F.fold(host.chat, host.chatMetadata).records;
    const res = check([op({ op: 'complete', id: 'letter', target: ['letter'], subject: 'Hale', text: 'Hale learned the letter came from Lord Darius.', outcome: 'Lord Darius sent the letter.', quote: 'Lord Darius sent it' })], host.chat[met].mes, records);
    assert.equal(res.inputs[0].op, 'complete');
    assert.equal(res.inputs[0].evidence[0].quote, 'Lord Darius sent it');
    await store.commit(store.begin(met), res.inputs);
    const done = F.fold(host.chat, host.chatMetadata).byId.get('letter');
    assert.equal(done.status, 'done');
    assert.equal(done.outcome, 'Lord Darius sent the letter.');
});

test('a thread the story sets aside is paused, keeps its text, type and line, and resumes; a pause or resume that repeats the text still files', async () => {
    const at = say('I ride south.', 'Hale put the letter away and rode south to the harvest fair, and the mystery waited.');
    store.marks();
    const open = check([op({ op: 'add', id: 'harvest', thread_type: 'Pending', subject: 'Hale', text: 'The harvest fair opens at the river on the fifth day.', ends_when: 'when the harvest fair closes', quote: 'rode south to the harvest fair' })], host.chat[at].mes);
    await store.commit(store.begin(at), open.inputs);
    let records = F.fold(host.chat, host.chatMetadata).records;

    const pauseAt = say('I rest.', 'Hale stayed at the inn two days and spoke of nothing but the weather, and the harvest fair stood forgotten.');
    store.marks();
    const pause = check([op({ op: 'revise', id: 'harvest', target: ['harvest'], subject: 'Hale', text: 'The harvest fair opens at the river on the fifth day.', thread_state: 'paused', quote: 'the harvest fair stood forgotten' })], host.chat[pauseAt].mes, records);
    assert.equal(pause.inputs.length, 1, 'a pause is a change even though the text repeats');
    assert.equal(pause.inputs[0].record.paused, true);
    assert.equal(pause.inputs[0].record.threadType, 'Pending', 'a revise keeps the thread type');
    assert.equal(pause.inputs[0].record.endsWhen, 'when the harvest fair closes', 'a revise keeps the line');
    await store.commit(store.begin(pauseAt), pause.inputs);
    records = F.fold(host.chat, host.chatMetadata).records;
    const paused = records.find(r => r.id === 'harvest');
    assert.equal(paused.paused, true);
    assert.equal(paused.status, 'current', 'a paused thread stays on file');
    assert.match(C.buildCaptureRequest({ exchanges: [{ player: 'x', prose: 'Hale heard the harvest fair crowd sing.', reply: 9 }], records, fields: [] }).user, /harvest \| thread\/Pending[^\n]*\| paused/);

    const back = say('I go to the fair.', 'The harvest fair opened at the river, and Hale walked its length at noon.');
    store.marks();
    const resume = check([op({ op: 'revise', id: 'harvest', target: ['harvest'], subject: 'Hale', text: 'The harvest fair opens at the river on the fifth day.', thread_state: 'open', quote: 'The harvest fair opened at the river' })], host.chat[back].mes, records);
    assert.equal(resume.inputs[0].record.paused, false);
    await store.commit(store.begin(back), resume.inputs);
    assert.equal(!!F.fold(host.chat, host.chatMetadata).byId.get('harvest').paused, false);

    // An unchanged revise is still dropped.
    const same = check([op({ op: 'revise', id: 'harvest', target: ['harvest'], subject: 'Hale', text: 'The harvest fair opens at the river on the fifth day.', quote: 'The harvest fair opened at the river' })], host.chat[back].mes, F.fold(host.chat, host.chatMetadata).records);
    assert.equal(same.inputs.length, 0);
});

test('paused threads leave the pool story event items draw from, and come back when resumed', () => {
    const entry = (uid, name, data) => ({ uid, name, kind: 'thread', on: true, status: 'open', aliases: [], fields: { open: `${name} matter`, ...(data ? { data: JSON.stringify(data) } : {}) }, at: null });
    const list = [entry(1, 'Letter', null), entry(2, 'Fair', { paused: true }), entry(3, 'Toll', { paused: false })];
    const meta = { chat: 'x', n: 5 };
    assert.deepEqual(P.worldOffers(list, [], meta).threads.map(t => t.name).sort(), ['Letter', 'Toll']);
    assert.equal(P.itemFits({ need: 'thread' }, { threads: P.worldOffers([list[1]], [], meta).threads }), false, 'an item that waits on an open thread skips it');
    const resumed = [list[0], entry(2, 'Fair', { paused: false })];
    assert.deepEqual(P.worldOffers(resumed, [], meta).threads.map(t => t.name).sort(), ['Fair', 'Letter']);
    // A record's own view carries the state into the Story World entry.
    const view = I.viewOfRecord({ id: 'harvest', kind: 'thread', threadType: 'Pending', subject: 'Hale', text: 'fair', endsWhen: 'when it closes', paused: true, status: 'current' }, 7);
    assert.equal(T.isPaused(view), true);
    assert.equal(T.endsWhenOf(view), 'when it closes');
});

test('her edits: the setters change the line and the status and the next fold shows them', async () => {
    const fold = () => F.fold(host.chat, host.chatMetadata).byId.get('harvest');
    assert.equal((await T.setThreadEnds('harvest', 'when the fair ends on the ninth day')).committed, true);
    assert.equal(fold().endsWhen, 'when the fair ends on the ninth day');
    assert.equal((await T.setThreadPaused('harvest', true)).committed, true);
    assert.equal(T.isPaused(fold()), true);
    assert.equal((await T.setThreadPaused('harvest', false)).committed, true);
    assert.equal(T.isPaused(fold()), false);
    assert.equal(fold().threadType, 'Pending');
    assert.equal((await T.setThreadPaused('no-such-thread', true)).committed, false);
});

test('capture makes one model call for the reply and files the thread fields from that answer', async () => {
    host.chat = [message(0, 'Hale waits.')];
    host.chatMetadata = { ri_memory: { imported: true } };
    const n = host.chat.length;
    host.chat.push(message(n, 'I knock.', true), message(n + 1, 'A courier left a sealed writ for Hale. It named a debt but not who held it.'));
    store.marks();
    const sent = [];
    const answer = { decisions: { durable_change: true, scene_ended: false, out_of_character: false }, time: { elapsed: 5, cue: null }, state: {}, ops: [
        { op: 'add', id: 'writ', target: [], kind: 'thread', thread_type: 'Plotline', subject: 'Hale', text: 'A sealed writ names a debt of Hale but not its holder.', ends_when: 'when Hale learns who holds the debt', quote: 'A courier left a sealed writ for Hale' },
    ] };
    const res = await C.runCapture([n + 1], { runChainFn: async request => { sent.push(request); return { ok: true, value: answer, route: 'desktop', model: 'gemma4:12b' }; }, store, settingsValue: off });
    assert.ok(res.ok);
    assert.equal(sent.length, 1);
    assert.equal(F.fold(host.chat, host.chatMetadata).byId.get('writ').endsWhen, 'when Hale learns who holds the debt');
});

test('threads that fell due in a typed time skip ride the capture request once, the reply rules on them, and the skip is marked ruled', async () => {
    host.chat = [message(0, 'Hale waits.')];
    host.chatMetadata = { ri_memory: { imported: true } };
    const filed = say('I ask about the fair.', 'The harvest fair opens at the river on the fifth day, the steward told Hale.');
    store.marks();
    const pre = check([op({ op: 'add', id: 'harvest', thread_type: 'Pending', subject: 'Hale', text: 'The harvest fair opens at the river on the fifth day.', ends_when: 'when the fair closes', quote: 'The harvest fair opens at the river on the fifth day' })], host.chat[filed].mes);
    await store.commit(store.begin(filed), pre.inputs);
    const n = host.chat.length;
    host.chat.push(message(n, 'Three days later.', true), message(n + 1, 'Three days on, Hale reached the river and the harvest fair had closed.'));
    const reply = host.chat[n + 1];
    reply.extra.roleplay_instructions = { v10SceneBreak: { due: [{ id: 'harvest', text: 'The harvest fair opens at the river on the fifth day.', due: 5 }] } };
    store.marks();
    const call = C.captureCall(host.chat, [n + 1], { records: [], fields: [], key: 'roleplay_instructions' });
    assert.match(call.user, /Due during the time skip: The harvest fair opens at the river on the fifth day\./);
    assert.match(call.system, /Pending threads listed as due during the time skip/);
    const plain = C.captureCall(host.chat, [n + 1], { records: [], fields: [], key: 'other' });
    assert.doesNotMatch(plain.user, /Due during the time skip/);
    assert.doesNotMatch(plain.system, /time skip/, 'the system text is unchanged when nothing is due');

    const sent = [];
    const answer = { decisions: { durable_change: true, scene_ended: false, out_of_character: false }, time: { elapsed: 4320, cue: 'Three days on' }, state: {}, ops: [
        { op: 'complete', id: 'harvest', target: ['harvest'], kind: 'thread', subject: 'Hale', text: 'The harvest fair closed before Hale arrived.', outcome: 'The fair had closed.', quote: 'the harvest fair had closed' },
    ] };
    const res = await C.runCapture([n + 1], { runChainFn: async request => { sent.push(request); return { ok: true, value: answer, route: 'desktop', model: 'gemma4:12b' }; }, store, settingsValue: off });
    assert.ok(res.ok);
    assert.equal(sent.length, 1, 'no extra call');
    assert.match(sent[0].user, /Due during the time skip/);
    assert.equal(reply.extra.roleplay_instructions.v10SceneBreak.ruled, true);
    assert.equal(F.fold(host.chat, host.chatMetadata).byId.get('harvest').status, 'done');
    // Once ruled, a later request leaves the line out.
    assert.doesNotMatch(C.captureCall(host.chat, [n + 1], { records: [], fields: [], key: 'roleplay_instructions' }).user, /Due during the time skip/);
});
