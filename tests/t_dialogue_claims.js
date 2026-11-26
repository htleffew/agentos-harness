// MB18: dialogue files like narration. A claim spoken in a line files the same way as one the narration states: a plain trait
// or fact with the speaker kept as the source and the line as evidence; the "said that" rule is retired. Node suite, no host.
//   node --test tests/t_dialogue_claims.js
import assert from 'node:assert/strict';
import test from 'node:test';

const t0 = Date.parse('2026-11-25T10:00:00Z');
function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? 'Heather' : 'Mira', is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [message(0, 'Mira waits in the tea room.')], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Mira', characters: [{ name: 'Mira' }], characterId: 0,
    getCurrentChatId: () => 'mb18-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const C = await import('../src/memory/capture.js');
const V = await import('../src/memory/validate.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const K = await import('../src/cards/catalog.js');

const op = o => ({ target: [], kind: 'trait', subject: '', ...o });
const durable = { decisions: { durable_change: true } };
const check = (ops, prose, records = []) => V.checkCapture({ ...durable, ops }, { prose, player: '', mark: 'm', swipe: 0 }, { records });

test('the capture request carries the one filing rule for spoken and narrated claims and no "said that" rule', () => {
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'I pour.', prose: '"I hate tea," Mira said.', reply: 1 }], fields: [] });
    assert.match(req.system, /files the same way whether a character speaks it or the narration states it/);
    assert.match(req.system, /secret records/);
    assert.match(req.system, /op supersede/);
    assert.doesNotMatch(req.system, /said that/);
    assert.doesNotMatch(req.system, /filed as what that speaker said/);
});

test('"I hate tea", said by Mira, files a trait on Mira with the speaker as source and the line as evidence', () => {
    const prose = '"I hate tea," Mira said, and pushed the cup away.';
    const res = check([op({ op: 'add', id: 'mira-tea', subject: 'Mira', text: 'Mira hates tea.', quote: 'I hate tea' })], prose);
    assert.equal(res.inputs.length, 1);
    const rec = res.inputs[0].record;
    assert.equal(rec.kind, 'trait');
    assert.equal(rec.subject, 'Mira');
    assert.equal(rec.text, 'Mira hates tea.');
    assert.deepEqual(rec.source, { speaker: 'Mira' });
    assert.equal(res.inputs[0].evidence[0].quote, 'I hate tea');
});

test('"Hale hates tea", said by Mira, files a trait on Hale with Mira as the source', () => {
    const prose = '"Hale hates tea," Mira said. "He drinks coffee."';
    const res = check([op({ op: 'add', id: 'hale-tea', subject: 'Hale', text: 'Hale hates tea.', quote: 'Hale hates tea' })], prose);
    const rec = res.inputs[0].record;
    assert.equal(rec.subject, 'Hale');
    assert.equal(rec.text, 'Hale hates tea.');
    assert.deepEqual(rec.source, { speaker: 'Mira' });
});

test('a narrated claim files the same trait with no source', () => {
    const res = check([op({ op: 'add', id: 'mira-tea', subject: 'Mira', text: 'Mira hates tea.', quote: 'Mira hates tea' })], 'Everyone at court knew Mira hates tea.');
    assert.equal(res.inputs[0].record.source, undefined);
    assert.equal(res.inputs[0].record.text, 'Mira hates tea.');
});

test('a later contradiction, spoken or narrated, supersedes the record; the old record stays in history and Undo restores it', async () => {
    host.chat = [message(0, 'Mira waits in the tea room.')];
    const store = S.memoryStore();
    const say = (player, reply) => { const n = host.chat.length; host.chat.push(message(n, player, true), message(n + 1, reply)); return n + 1; };
    const first = say('I pour her a cup.', '"I hate tea," Mira said, and pushed the cup away.');
    store.marks();
    const res1 = check([op({ op: 'add', id: 'mira-tea', subject: 'Mira', text: 'Mira hates tea.', quote: 'I hate tea' })], host.chat[first].mes);
    await store.commit(store.begin(first), res1.inputs);
    let folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('mira-tea').status, 'current');

    // Spoken contradiction.
    const second = say('I pour again.', '"Actually, I love tea," Mira said, and took the cup.');
    store.marks();
    const res2 = check([op({ op: 'supersede', id: 'mira-tea-2', target: ['mira-tea'], subject: 'Mira', text: 'Mira loves tea.', quote: 'Actually, I love tea' })], host.chat[second].mes, folded.records);
    assert.equal(res2.inputs[0].op, 'supersede');
    assert.deepEqual(res2.inputs[0].record.source, { speaker: 'Mira' });
    const done = await store.commit(store.begin(second), res2.inputs);
    folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('mira-tea').status, 'replaced');
    assert.equal(folded.byId.get('mira-tea').replacedBy, 'mira-tea-2');
    assert.equal(folded.byId.get('mira-tea-2').status, 'current');
    assert.ok(store.history('mira-tea').length >= 2, 'the old record keeps its history');

    // Narrated contradiction.
    const third = say('I wait.', 'By the end of the week Mira refused all tea again.');
    store.marks();
    const res3 = check([op({ op: 'supersede', id: 'mira-tea-3', target: ['mira-tea-2'], subject: 'Mira', text: 'Mira refuses tea.', quote: 'Mira refused all tea again' })], host.chat[third].mes, folded.records);
    await store.commit(store.begin(third), res3.inputs);
    folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('mira-tea-2').status, 'replaced');
    assert.equal(folded.byId.get('mira-tea-3').status, 'current');

    // Undo the spoken supersede: the entry goes, the older record returns.
    const undo = done.entries.find(e => e.op === 'supersede');
    await store.revert(undo.id);
    folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('mira-tea').status, 'current');
});

test('a lie the story exposes and a secret some characters know file through the secret and false-belief records', () => {
    const prose = '"The ford is safe," Garrick said. Hale found the ford mined. Only Garrick and Lord Darius knew the ford was mined.';
    const res = check([
        op({ op: 'add', id: 'ford-mined', kind: 'secret', subject: 'Garrick', text: 'Garrick and Lord Darius know the ford is mined.', holders: ['Garrick', 'Lord Darius'], quote: 'Only Garrick and Lord Darius knew the ford was mined' }),
        op({ op: 'add', id: 'hale-ford', kind: 'secret', subject: 'Hale', text: 'Hale was told the ford is safe, and it is mined.', holders: ['Hale'], believes: 'The ford is safe.', quote: 'The ford is safe' }),
    ], prose);
    assert.equal(res.inputs.length, 2);
    assert.deepEqual(res.inputs[0].record.holders, ['Garrick', 'Lord Darius']);
    assert.equal(res.inputs[1].record.believes, 'The ford is safe.');
    assert.deepEqual(res.inputs[1].record.source, { speaker: 'Garrick' });
});

test('a feeling stated aloud moves the Emotions card and files no trait', () => {
    const prose = '"I\'m scared," Mira said, and gripped the rail.';
    const res = check([
        op({ op: 'add', id: 'mira-scared', subject: 'Mira', text: 'Mira is scared.', quote: "I'm scared" }),
        op({ op: 'add', id: 'mira-dread', kind: 'emotion', subject: 'Mira', text: 'Mira said she is scared.', quote: "I'm scared", axes: { dread: 7 } }),
    ], prose);
    assert.deepEqual(res.inputs.map(i => i.record.kind), ['emotion']);
    assert.match(res.dropped[0].why, /mood language/);
    assert.equal(res.inputs[0].record.axes.dread, 7);
    // The request asks for the step on the emotion axes.
    const req = C.buildCaptureRequest({ exchanges: [{ player: 'x', prose, reply: 1 }], fields: [] });
    assert.match(req.system, /moves that person's emotion axes and files no trait/);
});

test('capture makes one model call for the reply: the answer files the claims with no second request', async () => {
    host.chat = [message(0, 'Mira waits in the tea room.')];
    host.chatMetadata = {};
    const store = S.memoryStore();
    const n = host.chat.length;
    host.chat.push(message(n, 'I pour.', true), message(n + 1, '"I hate tea," Mira said. "Hale hates tea too."'));
    store.marks();
    host.chatMetadata.ri_memory = { ...(host.chatMetadata.ri_memory || {}), imported: true };
    const sent = [];
    const answer = { decisions: { durable_change: true, scene_ended: false, out_of_character: false }, time: { elapsed: 5, cue: null }, state: {}, ops: [
        { op: 'add', id: 'mira-tea', target: [], kind: 'trait', subject: 'Mira', text: 'Mira hates tea.', quote: 'I hate tea' },
        { op: 'add', id: 'hale-tea', target: [], kind: 'trait', subject: 'Hale', text: 'Hale hates tea.', quote: 'Hale hates tea too', speaker: 'Mira' },
    ] };
    const run = async request => { sent.push(request); return { ok: true, value: answer, route: 'desktop', model: 'gemma4:12b' }; };
    const off = { trayCards: { mode: Object.fromEntries(K.CARDS.map(c => [c.id, 'off'])) } };
    const res = await C.runCapture([n + 1], { runChainFn: run, store, settingsValue: off });
    assert.ok(res.ok);
    assert.equal(sent.length, 1, 'one request for the reply');
    assert.doesNotMatch(sent[0].system, /said that/);
    const folded = F.fold(host.chat, host.chatMetadata);
    assert.equal(folded.byId.get('mira-tea').text, 'Mira hates tea.');
    assert.deepEqual(folded.byId.get('hale-tea').source, { speaker: 'Mira' });
});
