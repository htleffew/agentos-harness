// B42: [[OOC: ...]] notes inside her message. The parser, the wrap math, the settings and the whole send, swipe and edit
// path run in Node on a host in SillyTavern's shape, so every check here runs with no model and no browser.
// Run with: node --test tests/t_inline_direction.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { INLINE_DEFAULTS, NOTES_KEY, NOTE_TITLE, WRAPS, bindInlineNotes, bindReplayedNotes, boxHoldsOnlyNotes, extractInlineNotes,
    inlineActive, inlineSettings, saveInlineSettings, shownWraps, takeInlineNotes, wrapSelection } from '../src/inline-direction.js';
import { isOutOfCharacter } from '../src/memory/capture.js';
import { activeQuickPlan, applyQuickPrompt, bindQuickReply, finishQuickReply, playerContribution, quickChat, startQuickReply }
    from '../src/quick-action-chat.js';

const events = ['MESSAGE_SENT', 'CHAT_COMPLETION_PROMPT_READY', 'WORLDINFO_SCAN_DONE', 'WORLDINFO_ENTRIES_LOADED', 'GENERATE_BEFORE_COMBINE_PROMPTS', 'GENERATE_AFTER_COMBINE_PROMPTS'];
const KEY = 'roleplay_instructions';
const host = {
    extensionSettings: {}, chatMetadata: {}, chat: [], mainApi: 'openai', characterId: '0', characters: [{ avatar: 'captain.png' }],
    key: 'inline parent', getCurrentChatId() { return this.key; }, eventTypes: Object.fromEntries(events.map(name => [name, name])),
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, async saveChat() {},
};
const box = { value: '', dispatchEvent() { return true; } };
globalThis.SillyTavern = { getContext: () => host };
globalThis.Event = class { constructor(type) { this.type = type; } };
globalThis.document = { body: { dataset: {} }, getElementById: () => box, querySelector: selector => selector === '#send_textarea' ? box : null };

function reset() {
    host.chat = [];
    host.chatMetadata = {};
    host.extensionSettings = {};
    host.key = 'inline parent';
    host.mainApi = 'openai';
    box.value = '';
}

const asideOnWorldflow = text => /^[\s(\[<*]*OOC\b/i.test(text);

// ---------- the parser ----------

test('cuts a marker from anywhere in the message and keeps the words around it apart', () => {
    assert.deepEqual(extractInlineNotes('I open the door [[OOC: make it creak]] and step inside.'),
        { text: 'I open the door and step inside.', notes: ['OOC: make it creak'], found: true, only: false });
    assert.equal(extractInlineNotes('[[OOC: slow burn]] I walk to the bar.').text, 'I walk to the bar.');
    assert.equal(extractInlineNotes('I walk to the bar. [[OOC: slow burn]]').text, 'I walk to the bar.');
    assert.equal(extractInlineNotes('Line one.\n[[OOC: x]]\nLine two.').text, 'Line one.\nLine two.');
    assert.equal(extractInlineNotes('She said, [[OOC: x]]"Hello."').text, 'She said, "Hello."');
    assert.equal(extractInlineNotes('plain text').found, false);
    assert.equal(extractInlineNotes('plain text').text, 'plain text');
});

test('several markers join in order, each keeping OOC:', () => {
    const found = extractInlineNotes('One [[OOC: first]] two [[ooc :  second\n thought ]] three [[OOC: third]].');
    assert.deepEqual(found.notes, ['OOC: first', 'OOC: second thought', 'OOC: third']);
    assert.equal(found.text, 'One two three.');
});

test('an empty marker is removed and sends nothing; an unclosed one stays as typed', () => {
    const empty = extractInlineNotes('Hello [[OOC: ]] there');
    assert.deepEqual([empty.text, empty.notes], ['Hello there', []]);
    assert.equal(extractInlineNotes('Hello [[OOC: no end').text, 'Hello [[OOC: no end');
    assert.equal(extractInlineNotes('Hello [[OOC: no end').found, false);
    assert.equal(extractInlineNotes('[[note: not ours]] hi').found, false);
});

test('a message of markers only reports only, with its notes', () => {
    const found = extractInlineNotes('  [[OOC: make it rain]]  ');
    assert.equal(found.only, true);
    assert.equal(found.text, '');
    assert.deepEqual(found.notes, ['OOC: make it rain']);
    box.value = '[[OOC: a]] [[OOC: b]]';
    assert.equal(boxHoldsOnlyNotes(), true);
    box.value = '[[OOC: a]] and words';
    assert.equal(boxHoldsOnlyNotes(), false);
});

test('a cleaned marker never makes the message an aside (capture isOutOfCharacter, worldflow isOocTurn)', () => {
    const pieces = ['', 'hello', '(', '((', '[', 'OOC: z', '*', '<', ' ', '\n', '"hi"', '(OOC', '[OOC'];
    const marker = ['[[OOC: n]]', '[[OOC: a]] [[OOC: b]]'];
    let checked = 0;
    for (const left of pieces) for (const right of pieces) for (const m of marker) for (const mid of ['', ' ']) {
        const source = left + mid + m + mid + right;
        const found = extractInlineNotes(source);
        const neutral = (left + mid + '§' + mid + right).trim();
        const noteLess = !isOutOfCharacter(neutral) && !asideOnWorldflow(neutral);
        if (noteLess) {
            assert.equal(isOutOfCharacter(found.text), false, JSON.stringify(source));
            assert.equal(asideOnWorldflow(found.text), false, JSON.stringify(source));
        }
        for (const note of found.notes) assert.equal(found.text.includes(note.slice(5)), false);
        assert.equal(/\[\[OOC/i.test(found.text), false);
        checked++;
    }
    assert.ok(checked > 600);
    // The two cases a plain join would trip.
    assert.equal(isOutOfCharacter(extractInlineNotes('([[OOC: x]](hi)').text), false);
    assert.equal(isOutOfCharacter(extractInlineNotes('[[[OOC: x]]OOC: z').text), false);
    assert.equal(asideOnWorldflow(extractInlineNotes('[[[OOC: x]]OOC: z').text), false);
});

// ---------- the wrap math ----------

test('a wrap with no selection inserts the pair and leaves the cursor between the marks', () => {
    for (const wrap of WRAPS) {
        const result = wrapSelection('I say hi', 3, 3, wrap);
        assert.equal(result.value, 'I s' + wrap.open + wrap.close + 'ay hi');
        assert.equal(result.start, 3 + wrap.open.length);
        assert.equal(result.end, result.start);
    }
    assert.deepEqual(wrapSelection('', 0, 0, 'ooc'), { value: '[[OOC: ]]', start: 7, end: 7 });
    assert.deepEqual(wrapSelection('ab', 2, 2, 'italic'), { value: 'ab**', start: 3, end: 3 });
    assert.deepEqual(wrapSelection('ab', 0, 0, 'quote'), { value: '""ab', start: 1, end: 1 });
});

test('a wrap with text selected wraps it and leaves the cursor after the closing mark', () => {
    assert.deepEqual(wrapSelection('She waves hello now', 4, 15, 'italic'), { value: 'She *waves hello* now', start: 17, end: 17 });
    const quoted = wrapSelection('say hello now', 4, 9, 'quote');
    assert.equal(quoted.value, 'say "hello" now');
    assert.equal(quoted.start, 11);
    const note = wrapSelection('go on make it rain', 6, 18, 'ooc');
    assert.equal(note.value, 'go on [[OOC: make it rain]]');
    assert.equal(note.start, note.value.length);
    // The wrapped note is read back by the parser.
    assert.deepEqual(extractInlineNotes(note.value).notes, ['OOC: make it rain']);
});

test('settings default on, each switch is off on its own, and the OOC button follows the marker', () => {
    reset();
    assert.deepEqual(inlineSettings(), INLINE_DEFAULTS);
    assert.deepEqual(shownWraps().map(wrap => wrap.id), ['ooc', 'italic', 'quote']);
    saveInlineSettings({ italic: false });
    assert.deepEqual(shownWraps().map(wrap => wrap.id), ['ooc', 'quote']);
    saveInlineSettings({ marker: false });
    assert.deepEqual(shownWraps().map(wrap => wrap.id), ['quote']);
    assert.deepEqual(inlineSettings(), { marker: false, ooc: true, italic: false, quote: true });
    assert.equal(inlineActive(), false);
});

// ---------- the send, the request, the swipe and the edit ----------

const startGen = (type = 'normal') => {
    const gen = { type };
    startQuickReply(gen, {});
    return gen;
};
async function sendFromBox(text) {
    box.value = text;
    const gen = startGen();
    const taken = takeInlineNotes(gen, 'normal', {});
    const message = { is_user: true, mes: box.value, extra: {} };
    host.chat.push(message);
    const index = host.chat.length - 1;
    await bindQuickReply(gen, index);
    await bindInlineNotes(gen, index);
    return { gen, message, taken };
}
function accept(plan, type = 'normal') {
    const record = { type }, reply = { mes: 'A reply', extra: { [KEY]: record }, swipe_id: 0, swipe_info: [{ extra: {} }] };
    host.chat.push(reply);
    finishQuickReply(plan, reply, record);
    return { record, reply };
}
const requestFor = message => [{ role: 'system', content: 'Standing prefix' }, { role: 'user', content: playerContribution(message) }];

test('the note leaves the saved message and goes out once as a private direction that keeps OOC:', async () => {
    reset();
    const { gen, message, taken } = await sendFromBox('I look at the sea [[OOC: keep the storm offstage]] and sigh.');
    assert.deepEqual(taken, ['OOC: keep the storm offstage']);
    assert.equal(box.value, 'I look at the sea and sigh.');
    assert.equal(message.mes, 'I look at the sea and sigh.');
    assert.equal(/\[\[|keep the storm/.test(message.mes), false);
    assert.deepEqual(message.extra[NOTES_KEY], ['OOC: keep the storm offstage']);
    const row = quickChat().pending[0].rows[0];
    assert.deepEqual([row.text, row.title, row.visibility, row.required], ['OOC: keep the storm offstage', NOTE_TITLE, 'private', false]);
    const plan = activeQuickPlan(gen);
    const request = requestFor(message);
    const receipt = applyQuickPrompt(request, plan);
    assert.equal(request.length, 3);
    assert.equal(request[1].role, 'system');
    assert.equal(request[1].content, 'Directions for the current reply.\nDirection: OOC: keep the storm offstage');
    assert.equal(request.at(-1).content, 'I look at the sea and sigh.');
    assert.equal(receipt.directions[0].text, 'OOC: keep the storm offstage');
    plan.confirmed = true;
    const { record } = accept(plan);
    assert.equal(quickChat().pending.length, 0);
    assert.equal(record.quickActions.directions[0].text, 'OOC: keep the storm offstage');
    assert.equal(record.quickActions.outcome, 'accepted');
});

test('several markers go out in order in one request', async () => {
    reset();
    const { gen, message } = await sendFromBox('First [[OOC: one]] then [[OOC: two]] last.');
    const request = requestFor(message);
    applyQuickPrompt(request, activeQuickPlan(gen));
    assert.equal(request[1].content, 'Directions for the current reply.\nDirection: OOC: one\nDirection: OOC: two');
    assert.equal(request.at(-1).content, 'First then last.');
});

test('a swipe sends the note again, and a later message does not', async () => {
    reset();
    const { gen, message } = await sendFromBox('I knock. [[OOC: make them hesitate]]');
    const plan = activeQuickPlan(gen);
    applyQuickPrompt(requestFor(message), plan);
    plan.confirmed = true;
    accept(plan);
    assert.equal(quickChat().pending.length, 0);
    // Swipe: the player message is the one before the last reply.
    const swipe = { type: 'swipe' };
    startQuickReply(swipe, {});
    assert.equal(activeQuickPlan(swipe), null);
    assert.deepEqual(takeInlineNotes(swipe, 'swipe', {}), ['OOC: make them hesitate']);
    await bindReplayedNotes(swipe);
    const again = activeQuickPlan(swipe);
    assert.ok(again);
    const request = requestFor(message);
    applyQuickPrompt(request, again);
    assert.equal(request[1].content, 'Directions for the current reply.\nDirection: OOC: make them hesitate');
    assert.equal(request.at(-1).content, 'I knock.');
    again.confirmed = true;
    const second = accept(again, 'swipe');
    assert.equal(second.record.quickActions.directions[0].text, 'OOC: make them hesitate');
    assert.equal(quickChat().pending.length, 0);
    assert.deepEqual(message.extra[NOTES_KEY], ['OOC: make them hesitate']);
    // The next player message carries no note, so the swipe of its reply sends none.
    const next = await sendFromBox('I open the door.');
    assert.equal(next.taken.length, 0);
    accept(null);
    const later = { type: 'swipe' };
    assert.deepEqual(takeInlineNotes(later, 'swipe', {}), []);
    await bindReplayedNotes(later);
    assert.equal(activeQuickPlan(later), null);
});

test('editing the saved message never brings the marker back and the note still goes with a swipe', async () => {
    reset();
    const { gen, message } = await sendFromBox('I wait. [[OOC: keep it quiet]]');
    const plan = activeQuickPlan(gen);
    applyQuickPrompt(requestFor(message), plan);
    plan.confirmed = true;
    accept(plan);
    message.mes = 'I wait by the gate.';
    assert.equal(/\[\[|keep it quiet/.test(message.mes), false);
    const swipe = { type: 'swipe' };
    startQuickReply(swipe, {});
    assert.deepEqual(takeInlineNotes(swipe, 'swipe', {}), ['OOC: keep it quiet']);
    await bindReplayedNotes(swipe);
    const request = requestFor(message);
    applyQuickPrompt(request, activeQuickPlan(swipe));
    assert.equal(request.at(-1).content, 'I wait by the gate.');
    assert.match(request[1].content, /Direction: OOC: keep it quiet/);
});

test('with the marker Off, or a host that cannot queue directions, the message is sent as typed', async () => {
    reset();
    saveInlineSettings({ marker: false });
    let sent = await sendFromBox('Stay [[OOC: x]] put.');
    assert.equal(sent.message.mes, 'Stay [[OOC: x]] put.');
    assert.equal(quickChat().pending.length, 0);
    reset();
    host.mainApi = 'kobold';
    host.eventTypes = Object.fromEntries(events.filter(name => name !== 'GENERATE_AFTER_COMBINE_PROMPTS').map(name => [name, name]));
    sent = await sendFromBox('Stay [[OOC: x]] put.');
    assert.equal(sent.message.mes, 'Stay [[OOC: x]] put.');
    host.eventTypes = Object.fromEntries(events.map(name => [name, name]));
});

test('quiet, automatic and impersonate generations leave the message box alone', async () => {
    reset();
    box.value = 'Hold [[OOC: x]] this.';
    for (const [type, opts] of [['quiet', {}], ['impersonate', {}], ['normal', { automatic_trigger: true }], ['normal', { quiet_prompt: 'x' }]]) {
        assert.deepEqual(takeInlineNotes({ type }, type, opts), []);
        assert.equal(box.value, 'Hold [[OOC: x]] this.');
    }
    assert.equal(quickChat().pending.length, 0);
});
