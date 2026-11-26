// MB9: Continue in a new chat (memory DESIGN 8.3). The extension's own modules run in Node on a host in SillyTavern's shape and the
// Writer call is scripted. The parent chat is left as it is, the carry-over book is bound to the fresh chat and names the parent,
// no sentence of the book or the opening shares a run of eight words with the parent's last 50 replies, and secrets keep the fixed
// holder line the holder rule reads.
//   node --test tests/t_carry_over.js
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const NAMES = { char: 'Hale of Verath', user: 'Mira' };
const t0 = Date.parse('2026-11-25T10:00:00Z');
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { [KEY]: {} }, chatMetadata: {}, getCurrentChatId: () => 'x', eventSource: { on() {} }, eventTypes: {} }) };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const CO = await import('../src/memory/carry-over.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const BW = await import('../src/memory/book-writer.js');
const SE = await import('../src/memory/search.js');

function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? NAMES.user : NAMES.char, is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const replyText = i => `Hale checked the harbor ledger entry ${i} before the tide came in at the east pier. The rope store held ${i + 40} coils for the morning crews. Brannic signed the receipt and sealed the crate without a word.`;

/** A parent chat of 120 exchanges whose records are filed by hand: people, a trait, a place, an item, a thread, a secret, a locked stat sheet. */
async function parent() {
    const chat = [message(0, 'Hale waits at the east pier.')];
    for (let i = 1; i <= 120; i++) chat.push(message(chat.length, `I ask about entry ${i}.`, true), message(chat.length + 1, replyText(i)));
    const meta = {};
    const store = S.createStore({ chat: () => chat, meta: () => meta, chatId: () => 'parent-chat', save: async () => {}, now: () => t0 });
    store.marks();
    const last = F.storedMark(chat.at(-1));
    const at = { mark: last };
    // a sentence of the old chat, copied word for word into a record, which the book must not carry
    const copied = replyText(120).split('. ')[0] + '.';
    await store.record([
        { op: 'add', record: { id: 'hale', kind: 'person', subject: 'Hale of Verath', aliases: ['Hale', 'the warden'], text: 'Hale is the warden of the east pier.', importance: 9 }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'brannic', kind: 'person', subject: 'Brannic', text: 'Brannic is the harbor clerk who keeps the ledger.', importance: 7 }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'trait-hale', kind: 'trait', subject: 'Hale', text: 'Hale pays in silver and keeps every receipt.' }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'rel-hale-brannic', kind: 'relationship', subject: 'Hale', other: 'Brannic', text: 'Hale trusts Brannic with the ledger.' }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'east-pier', kind: 'place', subject: 'East pier', aliases: ['the pier'], text: 'The east pier has six berths and a toll booth.' }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'copied', kind: 'fact', subject: 'Harbor ledger', text: copied }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'rope', kind: 'item', subject: 'Rope store', holder: 'Hale', text: 'The rope store holds 160 coils.' }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'toll', kind: 'thread', threadType: 'Plotline', subject: 'Missing toll', text: 'Forty silver pieces of toll are missing from the booth.', endsWhen: 'the thief is named', importance: 8 }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'secret-toll', kind: 'secret', subject: 'Toll thief', text: 'Brannic took the missing toll to pay a debt.', holders: ['Brannic', 'Hale'], importance: 9 }, origin: { type: 'capture' }, anchor: at },
        { op: 'add', record: { id: 'sheet:hale', kind: 'stat sheet', subject: 'Hale of Verath', text: 'Strength 2, Wits 1, Will 3' }, origin: { type: 'inference' }, anchor: at },
    ]);
    await store.lock(['sheet:hale']);
    return { chat, meta, store, copied };
}

/** The host a run needs: the open chat switches from the parent to a fresh one when newChat runs. */
async function harness({ answer, fail = false } = {}) {
    const p = await parent();
    const books = new Map();
    const cur = { chat: p.chat, meta: p.meta, id: 'parent-chat' };
    const calls = [];
    const state = { newChats: 0, recall: [], saves: 0, opening: '' };
    const deps = {
        chat: () => cur.chat, meta: () => cur.meta, chatId: () => cur.id, chatName: () => cur.id, names: () => NAMES, key: KEY,
        runChain: async (chain, options) => {
            calls.push({ chain, options });
            if (fail) return { ok: false, reason: 'No route in the chain answered.', waiting: false };
            return { ok: true, value: answer || {}, route: 'desktop', model: 'gemma4:12b' };
        },
        chainFor: job => [{ route: 'desktop', model: 'gemma4:12b' }, { job }],
        newChat: async () => {
            state.newChats += 1;
            cur.id = 'child-chat';
            cur.chat = [message(0, 'The greeting of the card.')];
            cur.meta = { [F.MEMORY]: { v: 1, imported: { v: 1 }, log: [], seq: 0 } };
        },
        chatInfo: () => ({ id: cur.id, name: cur.id, avatar: 'hale.png', group: '' }),
        childStore: () => S.createStore({ chat: () => cur.chat, meta: () => cur.meta, chatId: () => cur.id, save: async () => {}, now: () => t0 }),
        loadBook: async name => books.get(name) || { entries: {} }, saveBook: async (name, data) => { books.set(name, structuredClone(data)); },
        bindBook: name => { cur.meta.world_info = name; }, markRecall: name => state.recall.push(name),
        setOpening: text => { state.opening = text; cur.chat[0].mes = text; },
        save: async () => { state.saves += 1; }, now: () => t0,
    };
    return { p, books, cur, calls, state, deps, runner: CO.createCarryOver(deps) };
}

const goodAnswer = () => ({
    synopsis: 'Hale of Verath holds the east pier as warden. The pier has six berths and a toll booth, and forty silver pieces of toll are missing from the booth. Brannic keeps the harbor ledger and Hale lets him hold it. Hale pays in silver and keeps every receipt. The rope store holds 160 coils for the morning crews. The warden wants the thief named before the next tide, and the clerk has agreed to open the ledger to him. Mira has been asking about each entry in the ledger, one at a time, and Hale has answered each one with the figure from the ledger. The next step is the count of the toll booth, which Hale set for dawn.',
    opening: 'Dawn found Hale at the toll booth with the ledger open on the counter and the keys in his hand. He counted the silver twice and set the tally beside the entries Brannic had signed. When he was done he waved Mira over to the counter and read the figures aloud, one berth at a time, so that she could check them against her own notes before the crews arrived at the east pier for the morning tide.',
});

const runsOf = h => CO.replyRuns(h.p.chat);
const textsOf = data => [...Object.values(data.entries)].flatMap(e => [e.comment, e.content, ...(e.key || [])]);

// ---------------------------------------------------------------- the eight-word run

test('a sentence that shares a run of eight words with the parent\'s last 50 replies is dropped, and so is one that completes a run across a sentence', () => {
    const chat = [message(0, 'start')];
    for (let i = 1; i <= 60; i++) chat.push(message(chat.length, 'ask', true), message(chat.length, `Reply ${i} says the old harbor bell rang twice before the gates were closed for the night.`));
    const runs = CO.replyRuns(chat);
    const out = CO.dropSharedSentences('The bell was repaired. The old harbor bell rang twice before the gates were closed. Nothing else changed in the town.', runs);
    assert.equal(out.text, 'The bell was repaired. Nothing else changed in the town.');
    assert.equal(out.dropped.length, 1);
    // only the last 50 replies count: a run from reply 1 is free to use
    const early = [message(0, 'start')];
    early.push(message(1, 'ask', true), message(2, 'The earliest reply keeps a lantern burning at the quay every single night of the year.'));
    for (let i = 0; i < 50; i++) early.push(message(early.length, 'ask', true), message(early.length, `Later reply ${i} is about something else entirely and mentions nothing shared.`));
    assert.equal(CO.sharesRun('A lantern burning at the quay every single night of the year.', CO.replyRuns(early)), false);
    assert.equal(CO.sharesRun('A lantern burning at the quay every single night of the year.', CO.replyRuns(early, { last: 60 })), true);
    // seven shared words are fine, eight are not
    assert.equal(CO.sharesRun('the old harbor bell rang twice before', runs), false);
    assert.equal(CO.sharesRun('the old harbor bell rang twice before the', runs), true);
    // a run that crosses two sentences drops the sentence that finishes it
    const spans = CO.dropSharedSentences('The old harbor bell rang. Twice before the gates were closed for the night.', runs);
    assert.equal(CO.sharesRun(spans.text, runs), false);
});

// ---------------------------------------------------------------- the whole flow

test('Continue in a new chat leaves the parent as it was and binds a carry-over book that names it', async () => {
    const h = await harness({ answer: goodAnswer() });
    const before = JSON.stringify([h.p.chat, h.p.meta]);
    const foldBefore = F.fold(h.p.chat, h.p.meta, { cache: false }).key;
    const out = await h.runner.start({ opening: true });
    assert.equal(JSON.stringify([h.p.chat, h.p.meta]), before, 'the parent chat and its metadata are byte for byte the same');
    assert.equal(F.fold(h.p.chat, h.p.meta, { cache: false }).key, foldBefore, 'the parent\'s fold is identical');
    assert.equal(h.calls.length, 1, 'one Writer call');
    assert.equal(h.calls[0].options.job, 'carryOver');
    assert.equal(h.state.newChats, 1);
    assert.equal(out.book, 'RI Carry-over, child-chat');
    const book = h.books.get(out.book);
    assert.equal(h.cur.meta.world_info, out.book, 'the book is the chat\'s own book in SillyTavern');
    assert.deepEqual(h.state.recall, [out.book], 'Recall manages this book is on');
    const marker = BW.bookMarkerOf(book);
    assert.equal(marker.kind, 'carry-over');
    assert.equal(marker.chat.id, 'child-chat');
    // the first entry is disabled and names the parent chat and the reply the book reflects
    const stamp = Object.values(book.entries)[0];
    assert.equal(stamp.disable, true);
    assert.match(stamp.content, /Carried over from the chat "parent-chat" at reply 120/);
    // the synopsis is a Constant entry
    const synopsis = Object.values(book.entries).find(e => e.comment === 'Story so far');
    assert.equal(synopsis.constant, true);
    assert.match(synopsis.content, /warden/);
    // a main character, a keyword entry and a thread
    const hale = Object.values(book.entries).find(e => e.comment === 'Character: Hale of Verath');
    assert.deepEqual(hale.key, ['Hale of Verath', 'Hale', 'the warden']);
    assert.match(hale.content, /Traits: Hale pays in silver/);
    assert.match(hale.content, /Standing: Hale trusts Brannic/);
    assert.ok(Object.values(book.entries).some(e => e.comment === 'Place: East pier' && e.key.includes('the pier')));
    assert.ok(Object.values(book.entries).some(e => e.comment === 'Thread: Missing toll' && /Ends when the thief is named/.test(e.content)));
    // every entry is an ordinary World Info entry, so the book opens in SillyTavern's World Info screen with the extension off
    for (const e of Object.values(book.entries)) {
        assert.ok(Number.isInteger(e.uid) && Array.isArray(e.key) && typeof e.content === 'string' && typeof e.comment === 'string', `entry ${e.uid} has the fields World Info reads`);
    }
    assert.equal(h.state.opening.startsWith('Dawn found Hale'), true, 'the opening replaces the card greeting in the new chat');
    assert.equal(h.cur.meta[F.MEMORY].carry.parent.name, 'parent-chat');
    assert.equal(h.state.saves, 1);
});

test('the book and the opening share no run of eight words with the parent\'s last 50 replies', async () => {
    const dirty = goodAnswer();
    dirty.synopsis += ' Hale checked the harbor ledger entry 120 before the tide came in at the east pier.';
    dirty.opening = `${dirty.opening} The rope store held 160 coils for the morning crews and Brannic signed the receipt.`;
    const h = await harness({ answer: dirty });
    const out = await h.runner.start({ opening: true });
    const runs = runsOf(h);
    const book = h.books.get(out.book);
    for (const text of textsOf(book)) assert.equal(CO.sharesRun(text, runs), false, `entry text: ${text.slice(0, 80)}`);
    assert.equal(CO.sharesRun(h.state.opening, runs), false, 'the opening');
    assert.equal(CO.sharesRun(Object.values(book.entries).map(e => e.content).join(' '), runs), false, 'the whole book read as one text');
    assert.ok(out.dropped >= 2, `the copied sentences were dropped (${out.dropped})`);
    // the record that was a copy of a reply has no entry left, and its sentence is not in the book
    assert.equal(Object.values(book.entries).some(e => e.comment === 'Fact: Harbor ledger'), false);
    // no message text goes to the Writer either
    const sent = h.calls[0].options;
    assert.equal(CO.sharesRun(`${sent.system} ${sent.user}`, runs), false, 'the prompt carries records, never a reply');
    assert.doesNotMatch(sent.user, /I ask about entry/);
});

test('a secret keeps the fixed holder line the holder rule reads, and the book can leave secrets out', async () => {
    const h = await harness({ answer: goodAnswer() });
    const out = await h.runner.start({});
    const book = h.books.get(out.book);
    const secret = Object.values(book.entries).find(e => e.comment === 'Secret: Toll thief');
    assert.match(secret.content, /\nKnown to: Brannic, Hale\.$/);
    assert.equal(SE.loreHolderOk(secret.content, 'Brannic'), true);
    assert.equal(SE.loreHolderOk(secret.content, 'Mira'), false, 'a character who does not hold it is not sent it');
    // the stat sheet is a disabled entry that names its lock
    const sheet = Object.values(book.entries).find(e => e.comment === 'Stats: Hale of Verath');
    assert.equal(sheet.disable, true);
    assert.match(sheet.content, /Strength 2, Wits 1, Will 3\nLocked: all\./);
    const quiet = await harness({ answer: goodAnswer() });
    const bare = await quiet.runner.start({ leaveSecretsOut: true });
    const noSecrets = Object.values(quiet.books.get(bare.book).entries);
    assert.equal(noSecrets.some(e => /^Secret:/.test(e.comment)), false);
    assert.equal(noSecrets.some(e => /Brannic took the missing toll/.test(e.content)), false);
});

test('the stat sheets start in the new chat from the book, locked where they were locked', async () => {
    const h = await harness({ answer: goodAnswer() });
    await h.runner.start({});
    const child = F.fold(h.cur.chat, h.cur.meta, { cache: false });
    const sheet = child.byId.get('sheet:hale');
    assert.equal(sheet.kind, 'stat sheet');
    assert.equal(sheet.text, 'Strength 2, Wits 1, Will 3');
    assert.equal(sheet.locked, true);
    assert.equal(child.current.filter(r => r.kind !== 'stat sheet').length, 0, 'every other record of the new chat starts empty');
});

test('the new chat finds what the parent found: each probe fires the entry that holds its answer', async () => {
    const h = await harness({ answer: goodAnswer() });
    const out = await h.runner.start({});
    const entries = Object.values(h.books.get(out.book).entries).filter(e => !e.disable);
    // SillyTavern's keyword scan: a Constant entry always fires, any other fires when one of its keys is in the text
    const fires = text => entries.filter(e => e.constant || e.key.some(k => text.toLowerCase().includes(k.toLowerCase())));
    const probes = [
        ['Where is the warden of the pier these days?', /warden of the east pier/i],
        ['What happened to the toll in the booth?', null],
        ['Who keeps the ledger? Brannic does.', /harbor clerk who keeps the ledger/i],
        ['How many berths does the east pier have?', /six berths/i],
        ['Does Hale still pay in silver?', /pays in silver/i],
    ];
    const parentView = F.fold(h.p.chat, h.p.meta, { cache: false }).current;
    for (const [probe, expect] of probes) {
        const found = fires(probe);
        if (expect) assert.ok(found.some(e => expect.test(e.content)), `probe "${probe}" reaches its answer`);
        else assert.ok(found.some(e => e.comment === 'Thread: Missing toll') || found.some(e => /toll/i.test(e.content)), `probe "${probe}"`);
        // a probe the parent's records answered is one a keyword or the synopsis reaches in the new chat
        assert.ok(found.length > 0);
    }
    assert.ok(parentView.length >= 9);
});

test('a Writer call that no route answers starts nothing: no new chat, no book, the parent as it was', async () => {
    const h = await harness({ fail: true });
    const before = JSON.stringify([h.p.chat, h.p.meta]);
    await assert.rejects(() => h.runner.start({}), /No route answered the Writer call/);
    assert.equal(h.state.newChats, 0);
    assert.equal(h.books.size, 0);
    assert.equal(JSON.stringify([h.p.chat, h.p.meta]), before);
    // an answer the checks cut to nothing is refused the same way
    const empty = await harness({ answer: { synopsis: 'Hale checked the harbor ledger entry 120 before the tide came in at the east pier.', opening: '' } });
    await assert.rejects(() => empty.runner.start({}), /too short after the checks/);
    assert.equal(empty.state.newChats, 0);
});

test('the Writer prompt holds records and chapter accounts in the report register and names no secret', async () => {
    const h = await harness({ answer: goodAnswer() });
    const plan = h.runner.prepare({ opening: true, wish: 'Open at dawn.' });
    assert.match(plan.request.user, /People:\n- Hale of Verath \(also: Hale, the warden\)/);
    assert.match(plan.request.user, /Open threads:\n- Missing toll \(Plotline\)/);
    assert.match(plan.request.user, /What the player wants from the new chat: Open at dawn\./);
    assert.match(plan.request.user, /incident report/);
    assert.match(plan.request.user, /Name no secret in it/);
    assert.doesNotMatch(plan.request.user, /Brannic took the missing toll/);
    assert.equal(plan.request.schema.additionalProperties, false);
    const without = h.runner.prepare({});
    assert.match(without.request.user, /"opening": an empty string/);
});

test('the report register applies to the synopsis: a sentence with mood outside a stated line is cut', () => {
    const out = CO.readSynopsis({ synopsis: `Hale holds the east pier as warden. Hale felt terrified and the mood was ominous. The pier has six berths and a toll booth, and forty silver pieces of toll are missing. ${'Brannic keeps the harbor ledger for the pier and the booth. '.repeat(4)}`, opening: '' }, new Set());
    assert.doesNotMatch(out.synopsis, /terrified|ominous/);
    assert.match(out.synopsis, /six berths/);
    assert.equal(out.moods, 1);
});
