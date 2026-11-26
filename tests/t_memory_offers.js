// What a story event item may ask for in a chat whose memory lives in chat data: open threads, kept secrets of someone
// present and plans of present people, read from capture's records as the Story World views recall reads. Legacy chats
// keep worldOffers as it was. Node suite, no host.
//   node --test tests/t_memory_offers.js
import assert from 'node:assert/strict';
import test from 'node:test';

const host = {
    chat: [{ name: 'Hale', is_user: false, mes: 'Hale waits at the gate.', swipe_id: 0, swipes: ['Hale waits at the gate.'], extra: {} }], chatMetadata: {}, extensionSettings: {},
    name1: 'Heather', name2: 'Hale', characters: [{ name: 'Hale' }], characterId: 0,
    getCurrentChatId: () => 'offers-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const I = await import('../src/memory/import.js');
const W = await import('../src/world.js');
const P = await import('../src/pacing.js');
const R = await import('../src/story-rules.js');

const rec = o => ({ status: 'current', aliases: [], ...o });
const records = [
    rec({ id: 'letter', kind: 'thread', threadType: 'Open', subject: 'Hale', text: 'Nobody knows who sent the unsigned letter.', endsWhen: 'when Hale learns who sent it' }),
    rec({ id: 'toll', kind: 'thread', threadType: 'Pending', subject: 'Mara', text: 'The bridge toll is due at dusk.' }),
    rec({ id: 'fair', kind: 'thread', threadType: 'Seed', subject: 'Hale', text: 'The harvest fair opens on the fifth day.', paused: true }),
    rec({ id: 'oath', kind: 'thread', threadType: 'Plotline', subject: 'Hale', text: 'Hale swore to find his brother.', status: 'done' }),
    rec({ id: 'road', kind: 'thread', threadType: 'Plan', subject: 'Hale', text: 'Hale means to leave by the north road.' }),
    rec({ id: 'mara-plan', kind: 'thread', threadType: 'Plan', subject: 'Mara', text: 'Mara means to sell the mill.' }),
    rec({ id: 'debt', kind: 'secret', subject: 'Hale', holders: ['Hale'], text: 'Hale owes the guild a hundred crowns.' }),
    rec({ id: 'ring', kind: 'secret', subject: 'Mara', holders: ['Mara'], text: 'Mara stole the ring.' }),
];
/** The rows prepareWorld reads in a memory chat: each record's view written as book data, then listed. */
function rowsOf(list) {
    const data = { entries: {}, extensions: { riFromMemory: true } };
    list.forEach((r, i) => W.writeWorldEntry(data, I.viewOfRecord(r, i + 1), 'offers-book'));
    return W.listWorld(data, 'offers-book');
}
const meta = { chat: 'offers-chat', n: 4 };

test('capture records become offers: open threads, kept secrets of someone present, plans of present people', () => {
    const rows = rowsOf(records);
    assert.ok(rows.some(r => r.kind === 'arc') && rows.some(r => r.kind === 'knowledge') && rows.some(r => r.kind === 'agenda'), 'the views carry the structured kinds');
    const o = P.memoryOffers(rows, ['Hale'], meta);
    const threadText = o.threads.map(t => t.text).join('\n');
    assert.match(threadText, /Nobody knows who sent the unsigned letter; it ends when Hale learns who sent it/);
    assert.match(threadText, /The bridge toll is due at dusk/);
    assert.doesNotMatch(threadText, /harvest fair/, 'a paused thread leaves the pool');
    assert.doesNotMatch(threadText, /swore to find/, 'a done thread leaves the pool');
    assert.deepEqual(o.secrets.map(s => s.text), ["Hale's secret (Hale owes the guild a hundred crowns)"], 'only the secret of someone present');
    assert.deepEqual(o.plans.map(p => p.text), ["Hale's plan (Hale means to leave by the north road)"], 'only the plan of someone present');
    const both = P.memoryOffers(rows, ['Hale', 'Mara'], meta);
    assert.equal(both.secrets.length, 2);
    assert.equal(both.plans.length, 2);
});

test('an item that needs a thread fits and is filled with the thread text; a held item stays held', () => {
    const rows = rowsOf(records);
    const scene = { count: 1, ...P.memoryOffers(rows, ['Hale'], meta) };
    const item = { id: 'x', text: 'Something stirs about [thread].', need: 'thread' };
    assert.equal(P.itemFits(item, scene), true);
    const filled = P.fillNeed(item, scene, l => l[0]);
    assert.match(filled.text, /^Something stirs about the open matter \(Nobody knows who sent the unsigned letter; it ends when Hale learns who sent it\)\.$/);
    assert.equal(filled.used.kind, 'thread');
    assert.equal(P.itemFits({ text: 'a', need: 'secret' }, scene), true);
    assert.equal(P.itemFits({ text: 'a', need: 'plan' }, scene), true);
    // Nothing open: the item waits.
    const none = { count: 1, ...P.memoryOffers(rowsOf(records.filter(r => ['fair', 'oath'].includes(r.id))), ['Hale'], meta) };
    assert.equal(P.itemFits(item, none), false);
    // B41: a story rule's held item stays out whatever the scene offers.
    const saved = host.chatMetadata;
    host.chatMetadata = { roleplay_instructions: { storyRules: [{ id: 'a', when: { kind: 'replies', value: 50 }, then: { kind: 'available', set: 'S', cat: 'c', item: 'x' } }] } };
    R.refresh();
    assert.equal(R.ruleHeld(item), true);
    assert.equal(P.itemFits(item, scene), false, 'an open thread does not release an item a rule holds');
    host.chatMetadata = saved;
    R.refresh();
    assert.equal(P.itemFits(item, scene), true);
});

test('imported entries of today\'s kinds still offer in a memory chat, and legacy worldOffers is unchanged', () => {
    const legacy = [
        { uid: 1, name: 'Letter', kind: 'thread', on: true, status: 'open', aliases: [], fields: { open: 'who sent it' }, at: null },
        { uid: 2, name: 'Debt', kind: 'secret', on: true, status: 'kept', aliases: [], fields: { secret: 'He owes the guild.', holder: 'Hale' }, at: null },
    ];
    const old = P.worldOffers(legacy, ['Hale'], meta);
    assert.deepEqual(old.threads.map(t => t.text), ['the open matter "Letter" (who sent it)']);
    assert.equal(old.secrets.length, 1);
    const mixed = P.memoryOffers([...legacy, ...rowsOf(records)], ['Hale'], meta);
    assert.equal(mixed.threads[0].text, old.threads[0].text, 'imported threads come first, as worldOffers reads them');
    assert.equal(mixed.secrets.length, 2);
    // Legacy reads only today's kinds: capture records offer nothing there, as before.
    const fromRecords = P.worldOffers(rowsOf(records), ['Hale'], meta);
    assert.deepEqual([fromRecords.threads.length, fromRecords.secrets.length, fromRecords.plans.length], [0, 0, 0]);
});
