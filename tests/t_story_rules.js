// B41: story rules on tracker values, records and story time. Node suite, no host.
//   node --test tests/t_story_rules.js
import assert from 'node:assert/strict';
import test from 'node:test';

const host = { chat: [], chatMetadata: {}, extensionSettings: {}, name1: 'Heather', name2: 'Hale', characters: [], characterId: 0, getCurrentChatId: () => 'b41', eventSource: { on() {} }, eventTypes: {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, setExtensionPrompt() {} };
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const R = await import('../src/story-rules.js');
const P = await import('../src/pacing.js');

const KEY = 'roleplay_instructions';
const user = (mes = 'hi') => ({ is_user: true, mes, name: 'Heather' });
const reply = (tracker = null, extra = {}) => ({ is_user: false, name: 'Hale', mes: 'x', swipe_id: 0, swipes: ['x'], swipe_info: [{ extra: {} }], extra: { [KEY]: { ...(tracker ? { tracker } : {}), ...extra } } });
const rel = (level, step = 0) => ({ relationships: [{ name: 'Hale and Heather', level, level_steps: { step, reason: 'r' } }] });
const fury = (value, step = 0) => ({ emotions: [{ name: 'Marla', axes: { tenderness: 5, fury: value, dread: 5, yearning: 5 }, axes_steps: { fury: { step, reason: 'r' } } }] });

/** Run a chat forward: at each reply, decide with the chat before it and store the firing, as the host side does. */
function play(rules, trackers) {
    const chat = [reply()];
    const out = [];
    for (const t of trackers) {
        chat.push(user());
        const end = chat.length;
        const d = R.decide(rules, R.ruleView(chat, {}, end), chat, end);
        const message = reply(t);
        R.storeRules(message, d);
        chat.push(message);
        out.push(d.fired.map(f => f.id));
    }
    return { chat, out };
}

test('a rule is only pickers and the effect wording, and normalRule reads every value through its picker range', () => {
    const r = R.normalRule({ when: { kind: 'field', number: 'emotions.axes.fury', subject: 'Marla', op: 'atLeast', value: 99, formula: 'x>1' }, then: { kind: 'direction', text: 'Marla snaps.' }, repeat: { kind: 'every', every: 0 } });
    assert.equal(r.when.value, 10);
    assert.equal(r.when.formula, undefined);
    assert.equal(r.repeat.every, 1);
    assert.deepEqual(Object.keys(R.EFFECTS), ['direction', 'add', 'available']);
    assert.equal(R.ruleSentence(r), 'When Marla\'s fury is at least 10, send the private direction "Marla snaps.", at most every 1 reply.');
    const step = R.normalRule({ when: { kind: 'step', number: 'characters.ego', value: 0 } });
    assert.equal(step.when.number, 'emotions.axes.tenderness', 'a step needs a value that moves in steps');
    assert.equal(step.when.value, 1);
});

test('conditions: a card field against a number, a B40 step, a Pending thread due, the reply count', () => {
    const field = { when: { kind: 'field', number: 'relationships.level', op: 'atLeast', value: 7 } };
    assert.equal(R.checkCondition(field, { tracker: rel(8) }).met, true);
    assert.equal(R.checkCondition(field, { tracker: rel(6) }).met, false);
    assert.equal(R.checkCondition({ when: { ...field.when, op: 'atMost', value: 6 } }, { tracker: rel(6) }).met, true);
    assert.match(R.checkCondition(field, { tracker: rel(8) }).why, /Hale and Heather is 8/);
    const up = { when: { kind: 'step', number: 'emotions.axes.fury', subject: 'Marla', value: 3 } };
    assert.equal(R.checkCondition(up, { tracker: fury(8, 3) }).met, true);
    assert.equal(R.checkCondition(up, { tracker: fury(8, 2) }).met, false);
    assert.equal(R.checkCondition({ when: { ...up.when, value: -2 } }, { tracker: fury(3, -4) }).met, true);
    assert.equal(R.checkCondition({ when: { ...up.when, subject: 'Hale' } }, { tracker: fury(8, 5) }).met, false, 'another subject does not count');
    const due = { when: { kind: 'due', amount: 2, unit: 'hours' } };
    assert.equal(R.checkCondition(due, { minute: 600, threads: [{ text: 'The ransom', due: 700 }] }).met, true);
    assert.equal(R.checkCondition(due, { minute: 600, threads: [{ text: 'The ransom', due: 800 }] }).met, false);
    assert.equal(R.checkCondition(due, { minute: null, threads: [{ text: 'The ransom', due: 610 }] }).met, false);
    const count = { when: { kind: 'replies', value: 3 } };
    assert.equal(R.checkCondition(count, { reply: 2 }).met, false);
    assert.equal(R.checkCondition(count, { reply: 3 }).met, true);
});

test('a due time is read against the minute it was filed and that reply\'s clock', () => {
    assert.equal(R.dueMinute('in two hours', { filed: 100 }), 220);
    assert.equal(R.dueMinute('3 days from now', { filed: 0 }), 3 * 1440);
    assert.equal(R.dueMinute('tomorrow', { filed: 50 }), 1490);
    assert.equal(R.dueMinute('at dawn', { filed: 1000, clock: 22 * 60 }), 1000 + 8 * 60);
    assert.equal(R.dueMinute('tomorrow at 9 PM', { filed: 0, clock: 20 * 60 }), 60 + 1440);
    assert.equal(R.dueMinute('when the moon is right', { filed: 0 }), null);
    assert.equal(R.clockOf('21:40'), 21 * 60 + 40);
});

test('Pending threads come from the fold with their due minute', () => {
    const filedAt = reply({ scene: { time: '20:00' } }, { v10Minutes: 300 });
    filedAt.extra.ri_memory = { mark: 'm1', entries: [{ id: 'e1', op: 'add', record: { id: 'ransom', kind: 'thread', threadType: 'Pending', subject: 'The ransom drop', text: 'The ransom is due.', story_time: 'in one hour', status: 'current' }, anchor: { mark: 'm1', swipe: 0 }, origin: { type: 'capture' }, at: 1, seq: 1 }] };
    const chat = [reply(), user(), filedAt];
    const threads = R.pendingThreads(chat, {}, chat.length);
    assert.equal(threads.length, 1);
    assert.equal(threads[0].due, 360);
});

test('repeat: once, each time it becomes true (false to true only), at most every N replies', () => {
    const levels = [8, 8, 6, 8, 8, 6, 8].map(l => rel(l));
    const base = { when: { kind: 'field', number: 'relationships.level', op: 'atLeast', value: 7 }, then: { kind: 'direction', text: 'd' } };
    // the condition at reply n reads the values captured on the reply before it, so the first reply reads nothing
    const once = R.normalRule({ ...base, id: 'once', repeat: { kind: 'once' } });
    assert.deepEqual(play([once], levels).out.map(x => x.length), [0, 1, 0, 0, 0, 0, 0]);
    const rises = R.normalRule({ ...base, id: 'rises', repeat: { kind: 'rises' } });
    // reply 1 has no values (false), reply 2 reads 8: false to true fires; 3 reads 8: stays true; 4 reads 6: false;
    // 5 reads 8: fires; 6 reads 8; 7 reads 6
    assert.deepEqual(play([rises], [...levels, rel(8)]).out.map(x => x.length), [0, 1, 0, 0, 1, 0, 0, 1]);
    const strict = R.normalRule({ ...base, id: 'strict', repeat: { kind: 'rises' } });
    const chat = [reply(), user(), reply(rel(9)), user()];
    assert.equal(R.decide([strict], R.ruleView(chat, {}, 4), chat, 4).fired.length, 0, 'no stored state: it waits for a false');
    const every = R.normalRule({ ...base, id: 'every', repeat: { kind: 'every', every: 2 } });
    assert.deepEqual(play([every], [8, 8, 8, 8, 8].map(l => rel(l))).out.map(x => x.length), [0, 1, 0, 1, 0]);
    const off = R.normalRule({ ...base, id: 'off', on: false });
    assert.deepEqual(play([off], levels).out.flat(), []);
});

test('a firing is stored per swipe; a swipe away, a delete or a branch cut before it lets a once-only rule fire again', () => {
    const rule = R.normalRule({ id: 'o', when: { kind: 'replies', value: 2 }, then: { kind: 'direction', text: 'd' } });
    const { chat } = play([rule], [null, null, null]);
    assert.equal(R.rulesOf(chat[4]).fired[0].id, 'o');
    assert.equal(chat[4].swipe_info[0].extra[R.RULES].fired[0].id, 'o', 'the swipe slot keeps its own copy');
    // a new swipe of reply 2: SillyTavern copies extra, the copy names swipe 0 and does not count for swipe 1
    chat[4].swipe_id = 1; chat[4].swipes.push('y'); chat[4].swipe_info.push({ extra: structuredClone(chat[4].extra) });
    assert.equal(R.rulesOf(chat[4]), null);
    let end = R.endFor(chat.slice(0, 5), 'swipe');
    assert.equal(end, 4);
    assert.equal(R.decide([rule], R.ruleView(chat, {}, end), chat, end).fired.length, 1, 'the swipe being written fires it again');
    chat[4].swipe_id = 0;
    assert.equal(R.decide([rule], R.ruleView(chat, {}, chat.length), chat, chat.length).fired.length, 0, 'swiped back: it already fired');
    const cut = chat.slice(0, 3);   // a delete of reply 2, or a branch from reply 1
    assert.equal(R.decide([rule], R.ruleView(cut, {}, cut.length), cut, cut.length).fired.length, 1);
});

test('available and add: held out of rolls until fired, add lasts until the set rolls', () => {
    const avail = R.normalRule({ id: 'a', when: { kind: 'replies', value: 2 }, then: { kind: 'available', set: 'S', cat: 'c1', item: 'i1', label: 'A storm' } });
    const add = R.normalRule({ id: 'b', when: { kind: 'replies', value: 2 }, then: { kind: 'add', set: 'S', cat: 'c2', item: 'i2', label: 'A letter' } });
    assert.deepEqual([...R.heldIds([avail, add])].sort(), ['i1', 'i2']);
    assert.deepEqual([...R.grantsFrom([reply()], 1)], []);
    const { chat } = play([avail, add], [null, null]);
    assert.deepEqual([...R.grantsFrom(chat, chat.length)].sort(), ['i1', 'i2']);
    // reply 3 rolled the set's category c2: the added item is spent, the available one stays
    chat.push(user(), reply(null, { items: [{ roll: { cats: [{ id: 'c2' }] } }] }));
    assert.deepEqual([...R.grantsFrom(chat, chat.length)], ['i1']);
    assert.deepEqual([...R.grantsFrom(chat.slice(0, 3), 3)], [], 'deleting the reply it fired on takes it back');
});

test('itemFits holds an item a rule names until the rule fires', () => {
    host.chatMetadata = { [KEY]: { storyRules: [{ id: 'a', when: { kind: 'replies', value: 2 }, then: { kind: 'available', set: 'S', cat: 'c', item: 'held' } }] } };
    host.chat = [reply(), user(), reply(), user()];
    R.refresh();
    assert.equal(P.itemFits({ id: 'held', text: 't' }, null), false);
    assert.equal(P.itemFits({ id: 'other', text: 't' }, null), true);
    R.beforeReply('normal');
    assert.equal(P.itemFits({ id: 'held', text: 't' }, { count: 1 }), true, 'the reply that fires it can roll it');
    host.chatMetadata = {};
    R.refresh();
});

test('the direction goes out as one private block; firings read in words for the Sent card', () => {
    const fired = R.decide([R.normalRule({ id: 'x', when: { kind: 'field', number: 'emotions.axes.fury', subject: 'Marla', op: 'atLeast', value: 7 }, then: { kind: 'direction', text: 'Marla throws the cup.' } })],
        { reply: 4, tracker: fury(8) }, [reply()], 1).fired;
    assert.match(R.directionText(fired), /Marla throws the cup\./);
    assert.deepEqual(R.firedLines(fired), ['When Marla\'s fury is at least 7 (Marla\'s fury is 8): send the private direction "Marla throws the cup.", once in this chat.']);
    assert.equal(R.directionText([]), '');
    assert.doesNotMatch(R.firedLines(fired).join(' ') + R.directionText(fired), /[–—]/);
});
