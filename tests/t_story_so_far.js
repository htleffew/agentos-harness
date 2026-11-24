// MB6: chapters, hiding at request assembly and the story so far (memory DESIGN 6). Run with:
//   node --test tests/t_story_so_far.js
// The pure rules of src/memory/story-so-far.js run on chats in SillyTavern's own shape through the real memory store and
// fold; the host flow of src/chapters.js runs against a fake SillyTavern context whose Main API answers the Writer's
// calls, so the queue, the Writer chain, the checks, the repair retry and the generate interceptor all run as in the app.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MEMORY, fold, storedMark, proseOf, revisionOf } from '../src/memory/fold.js';
import { createStore } from '../src/memory/store.js';
import * as S from '../src/memory/story-so-far.js';

const KEY = 'roleplay_instructions';
const T0 = Date.parse('2026-11-20T18:00:00.000Z');

// ---------------------------------------------------------------- a chat in SillyTavern's shape

function line(n, where) {
    return `Hale and Heather rode to ${where} on day ${n}. They counted ${n * 3} wagons at the crossing, paid the ferryman ${n} silver marks and agreed to leave at dawn. Edren loaded ${n + 2} sacks of grain.`;
}

/** A chat: the greeting, then exchanges; scenes: the place of each reply, by exchange number from 1. */
function makeChat(exchanges, place = n => (n <= 7 ? 'Marrow Ford' : n <= 14 ? 'Elerian Keep' : n <= 21 ? 'Aldermarch' : 'Verath Road')) {
    const chat = [{ name: 'Hale', is_user: false, mes: 'The column waits at the gate of Elerian Keep.', send_date: new Date(T0).toISOString(), extra: {} }];
    for (let n = 1; n <= exchanges; n++) addExchange(chat, n, place(n));
    return chat;
}
function addExchange(chat, n, where) {
    const t = T0 + chat.length * 60000;
    chat.push({ name: 'Heather', is_user: true, mes: `I ask Hale about the road to ${where}, exchange ${n}.`, send_date: new Date(t).toISOString(), extra: {} });
    const text = line(n, where);
    chat.push({ name: 'Hale', is_user: false, mes: text, send_date: new Date(t + 30000).toISOString(), swipe_id: 0, swipes: [text], swipe_info: [{ send_date: new Date(t + 30000).toISOString(), extra: {} }], extra: { [KEY]: { scene: { where } } } });
}
const hostOf = (chat, meta, id = 'c1') => ({ chat: () => chat, meta: () => meta, chatId: () => id, save: async () => {}, now: (() => { let t = T0; return () => ++t; })() });

/** A scripted Writer answer for chat[from..to] that passes the checks, or one with a quote that is in no message. */
function goodAnswer(chat, from, to, { badQuote = false } = {}) {
    const msgs = chat.slice(from, to + 1).filter(S.storyMessage);
    const evidence = msgs.filter(m => !m.is_user).slice(0, 3).map(m => ({ message: storedMark(m), quote: badQuote ? 'words that are in no reply at all' : proseOf(m).slice(0, 48) }));
    const summary = msgs.filter(m => !m.is_user).map(m => proseOf(m)).join(' ').split(' ').slice(0, 180).join(' ');
    return { evidence, title: 'The crossing', start_time: 'Day 1', end_time: 'Day 7', summary, people: ['Hale', 'Heather', 'Edren'], places: ['Marrow Ford'], threads_opened: [], threads_closed: [], importance: 6, secrets: [{ text: 'Edren carries a letter for the general.', holders: ['Edren'] }], final_changes: [], event_seeds: [] };
}
const CAST = [{ name: 'Hale', aliases: ['Hale of Verath'] }, { name: 'Heather', aliases: [] }, { name: 'Edren', aliases: [] }];

async function closeInStore(store, chat, from, to, id) {
    const answer = goodAnswer(chat, from, to);
    const record = S.chapterRecord(answer, { chat, from, to, id });
    await store.record([{ op: id ? 'revise' : 'add', target: id ? [id] : [], record, origin: { type: 'chapter', route: 'test' }, anchor: { mark: record.to } }], { save: false });
    return record;
}

// ---------------------------------------------------------------- when a chapter closes (6.1)

test('a chapter closes at a scene end after at least 6 exchanges, at 20 exchanges, and never before 6', () => {
    const chat = makeChat(8);
    createStore(hostOf(chat, {})).marks();
    const d = S.closeDecision(chat, [], { ceiling: 24000 });
    assert.equal(d.close, true);
    assert.equal(d.why, 'the scene ended');
    assert.equal(chat[d.to].mes, line(7, 'Marrow Ford'), 'closes through the reply before the new scene');
    const early = makeChat(5, n => (n <= 4 ? 'Marrow Ford' : 'Elerian Keep'));
    createStore(hostOf(early, {})).marks();
    assert.equal(S.closeDecision(early, [], { ceiling: 24000 }).close, false, 'a scene end after 4 exchanges does not close');
    const long = makeChat(20, () => 'Marrow Ford');
    createStore(hostOf(long, {})).marks();
    const cap = S.closeDecision(long, [], { ceiling: 24000 });
    assert.equal(cap.close, true);
    assert.match(cap.why, /20 exchanges/);
});

test('with defaults a 30-exchange chat produces a chapter (M1a W3)', () => {
    const chat = makeChat(30, () => 'Marrow Ford');
    createStore(hostOf(chat, {})).marks();
    let closed = 0;
    for (let k = 1; k < chat.length; k++) {
        const d = S.closeDecision(chat.slice(0, k + 1), [], { ceiling: 24000 });
        if (d.close) { closed = S.repliesIn(chat, d.from, d.to).length; break; }
    }
    assert.ok(closed > 0 && closed <= 20, `a chapter closed after ${closed} exchanges`);
});

test('the open chapter closes at its share of the request ceiling, so SillyTavern never trims history', () => {
    const chat = makeChat(7, () => 'Marrow Ford');
    createStore(hostOf(chat, {})).marks();
    const d = S.closeDecision(chat, [], { ceiling: 800 });
    assert.equal(d.close, true);
    assert.match(d.why, /ceiling/);
});

// ---------------------------------------------------------------- the chapter call and its checks (6.2)

test('the chapter call quotes first; code checks every quote against its message and every name against the cast', () => {
    const chat = makeChat(7);
    createStore(hostOf(chat, {})).marks();
    const prompt = S.chapterPrompt({ chat, from: 1, to: 14, cast: CAST, titles: ['The gate'] });
    assert.ok(prompt.indexOf('"evidence"') < prompt.indexOf('"summary"'), 'evidence is asked before the summary');
    assert.match(prompt, /incident report/);
    assert.match(prompt, new RegExp(`\\[${storedMark(chat[2])}\\] Hale:`));
    assert.deepEqual(Object.keys(S.CHAPTER_SCHEMA.value.properties)[0], 'evidence');
    const good = goodAnswer(chat, 1, 14);
    assert.deepEqual(S.checkChapter(good, { chat, from: 1, to: 14, cast: CAST }).problems, []);
    const bad = goodAnswer(chat, 1, 14, { badQuote: true });
    assert.ok(S.checkChapter(bad, { chat, from: 1, to: 14, cast: CAST }).problems.some(p => /not in message/.test(p)));
    const stranger = { ...good, people: ['Hale', 'Lord Mortimer'] };
    assert.ok(S.checkChapter(stranger, { chat, from: 1, to: 14, cast: CAST }).problems.some(p => /Lord Mortimer/.test(p)));
    const moody = { ...good, summary: `${good.summary} Heather felt a wave of dread and her heart sank.` };
    assert.ok(S.checkChapter(moody, { chat, from: 1, to: 14, cast: CAST }).mood.length >= 2, 'mood outside a stated line is found');
    const stated = { ...good, summary: `${good.summary} Heather said, "I am afraid of the ford."` };
    assert.deepEqual(S.checkChapter(stated, { chat, from: 1, to: 14, cast: CAST }).mood, [], 'a feeling inside a stated line passes');
});

// ---------------------------------------------------------------- hiding at assembly and the boundary (6.3)

test('messages leave the request only while a valid chapter covers them, and the view goes in at their place', async () => {
    const chat = makeChat(10);
    const meta = {};
    const store = createStore(hostOf(chat, meta));
    store.marks();
    await closeInStore(store, chat, 1, 14);
    const chapters = S.chaptersOf(chat, fold(chat, meta));
    assert.equal(chapters.length, 1);
    assert.equal(chapters[0].valid, true);
    const covered = S.coverage(chapters);
    assert.equal(covered.size, 14);
    const view = S.chapterView(chapters, { cap: 1000 });
    const prompt = chat.filter(m => !m.is_system).map(m => ({ ...m }));
    const out = S.leaveOut(prompt, covered, view.text);
    assert.equal(out.removed, 14);
    assert.equal(prompt[0].mes, chat[0].mes, 'the greeting stays');
    assert.equal(prompt[1].extra.ri_chapter_view, true, 'the chapter view sits where the covered messages were');
    assert.equal(prompt[1].extra.type, 'narrator', 'SillyTavern sends it with the system role');
    assert.equal(prompt[2].mes, chat[15].mes, 'the open chapter follows word for word');
    assert.match(prompt[1].mes, /<chapter n="1" title="The crossing"/);
    assert.match(prompt[1].mes, /<secret known_by="Edren">/, 'a secret line is labelled with its holders, never bare');
});

test('a branch cut inside a chapter, an edit and a delete each send the affected messages raw', async () => {
    const base = () => { const chat = makeChat(10); const meta = {}; const store = createStore(hostOf(chat, meta)); store.marks(); return { chat, meta, store }; };
    // Edit inside the chapter: it goes stale, its messages go raw, and it waits for its rebuild.
    {
        const { chat, meta, store } = base();
        await closeInStore(store, chat, 1, 14);
        chat[6].mes = `${chat[6].mes} An edited line.`;
        chat[6].swipes[0] = chat[6].mes;
        const chapters = S.chaptersOf(chat, fold(chat, meta));
        assert.equal(chapters[0].valid, false, 'an edit inside the chapter makes its coverage invalid');
        assert.equal(S.coverage(chapters).size, 0, 'the edited chapter\'s messages go raw');
        const prompt = chat.map(m => ({ ...m }));
        S.leaveOut(prompt, S.coverage(chapters), S.chapterView(chapters).text);
        assert.equal(prompt.filter(m => !m.extra?.ri_chapter_view).length, chat.length, 'every message is in the request');
        assert.equal(S.chapterView(chapters).text, '', 'no view stands in for messages that are sent raw');
    }
    // Delete inside the chapter.
    {
        const { chat, meta, store } = base();
        await closeInStore(store, chat, 1, 14);
        chat.splice(5, 1);
        const chapters = S.chaptersOf(chat, fold(chat, meta));
        assert.equal(chapters[0].valid, false);
        assert.equal(S.coverage(chapters).size, 0, 'a delete inside the chapter sends the rest raw');
    }
    // Swipe of the chapter's last reply.
    {
        const { chat, meta, store } = base();
        await closeInStore(store, chat, 1, 14);
        const m = chat[14];
        m.swipes.push('Another version of the reply.'); m.swipe_info.push({ send_date: m.send_date, extra: structuredClone(m.extra) }); m.swipe_id = 1; m.mes = m.swipes[1];
        assert.equal(S.coverage(S.chaptersOf(chat, fold(chat, meta))).size, 0, 'a swipe of a covered reply sends the chapter raw');
    }
    // Branch cut inside the chapter: the branch holds the chat up to message 9 and a copy of the metadata.
    {
        const { chat, meta, store } = base();
        await closeInStore(store, chat, 1, 14);
        const branch = structuredClone(chat.slice(0, 10));
        const branchMeta = structuredClone(meta);
        const chapters = S.chaptersOf(branch, fold(branch, branchMeta));
        assert.equal(S.coverage(chapters).size, 0, 'a chapter cut by the branch covers nothing there');
        const gaps = S.gaps(branch, chapters);
        assert.equal(chapters.length, 0, 'its anchor is not in the branch, so the chapter is not in force there');
        assert.equal(gaps.length, 0, 'the open chapter of the branch starts after the greeting');
        assert.equal(S.openStart(chapters), 1);
        // The main chat keeps its chapter.
        assert.equal(S.coverage(S.chaptersOf(chat, fold(chat, meta))).size, 14);
    }
});

// ---------------------------------------------------------------- the story so far and the view (6.4, 5.3)

test('the condensed account reads stored chapter records alone, shorter with age, with arcs for the oldest', () => {
    const chapters = Array.from({ length: 18 }, (_, i) => ({ id: `ch-${i + 1}`, n: i + 1, valid: true, record: { title: `Part ${i + 1}`, text: `Chapter ${i + 1} text. `.repeat(40), places: [i < 6 ? 'Marrow Ford' : 'Verath Road'], when: { start: `Day ${i + 1}` } } }));
    const older = chapters.slice(0, -2);
    const plan = S.condensedPlan(older, { budgetTokens: 5000 });
    assert.equal(plan.at(-1).target, 90, 'the chapter just behind the full ones gets about 90 words');
    assert.equal(plan.at(-2).target, 90);
    assert.equal(plan.at(-3).target, 30, 'an older chapter gets about 30 words');
    assert.equal(plan[0].kind, 'arc', 'the oldest chapters fold into an arc');
    assert.ok(plan[0].ids.length >= 4 && plan[0].ids.length <= 6, 'an arc holds four to six chapters');
    const tight = S.condensedPlan(older, { budgetTokens: 300 });
    assert.ok(tight.reduce((s, p) => s + p.target, 0) < plan.reduce((s, p) => s + p.target, 0), 'targets shrink to fit the budget');
    const { inputs } = S.condensedInputs(older, { budgetTokens: 1500 });
    assert.ok(inputs.every(p => ['chapter', 'arc'].includes(p.kind)));
    const prompt = S.condensedPrompt(inputs);
    assert.doesNotMatch(prompt, /<condensed>|<story_so_far>/, 'no earlier condensed account is an input');
    // Past the route's input, the oldest span reads arc records.
    const big = S.condensedInputs(older, { budgetTokens: 1500, inputTokens: 200 });
    assert.ok(big.needArcs.length >= 1, 'arc records are asked for first when the records pass the route input');
    const arc = S.arcRecord({ title: 'The ford', summary: 'x' }, big.needArcs[0]);
    const withArc = S.condensedInputs(older, { budgetTokens: 1500, inputTokens: 200, arcs: [arc] });
    assert.ok(withArc.inputs.some(p => p.kind === 'arc' && p.record === arc), 'a written arc record stands in for its chapters');
});

test('the newest chapter is always in the view under its cap (regression of commit cac01c8)', () => {
    const mk = (n, words) => ({ id: `ch-${n}`, n, valid: true, record: { title: `Part ${n}`, text: `The column crossed the river at dawn number ${n}. `.repeat(words / 9), when: {} } });
    // Two long chapters that alone pass the budget: the newest stays, the older one is shortened, story order holds.
    const two = [mk(1, 600), mk(2, 400)];
    const v = S.chapterView(two, { cap: 800 });
    assert.ok(v.tokens <= 800, `the view is ${v.tokens} tokens against 800`);
    assert.match(v.text, /<chapter n="2"/, 'the newest chapter reaches the request');
    assert.ok(v.text.indexOf('<chapter n="1"') < v.text.indexOf('<chapter n="2"'), 'chapters stay in story order');
    // Many chapters on the small cap: the condensed targets shrink first and the two newest stay in full.
    const many = Array.from({ length: 12 }, (_, i) => mk(i + 1, 180));
    const small = S.chapterView(many, { cap: 1000 });
    assert.ok(small.tokens <= 1000);
    assert.match(small.text, /<chapter n="12"/);
    assert.match(small.text, /<chapter n="11"/);
    assert.match(small.text, /<condensed>/);
    assert.deepEqual(small.full, ['ch-11', 'ch-12']);
});

test('a Writer-made condensed account is used only while it was built from exactly the chapters it stands for', () => {
    const mk = n => ({ id: `ch-${n}`, n, valid: true, record: { title: `Part ${n}`, text: `Chapter ${n} happened at the ford with ${n} riders.`, when: {} } });
    const chapters = [mk(1), mk(2), mk(3), mk(4)];
    const inputs = [{ id: 'ch-1', kind: 'chapter', ids: ['ch-1'], target: 30, record: chapters[0].record }, { id: 'ch-2', kind: 'chapter', ids: ['ch-2'], target: 30, record: chapters[1].record }];
    const answer = { parts: [{ id: 'ch-1', text: 'Writer text one.' }, { id: 'ch-2', text: 'Writer text two.' }] };
    assert.deepEqual(S.checkCondensed(answer, inputs).problems, []);
    const condensed = S.condensedRecord(answer, inputs);
    assert.match(S.chapterView(chapters, { condensed }).text, /Writer text one/);
    assert.equal(S.chapterView(chapters, { condensed }).condensedFrom, 'writer');
    // A fifth chapter changes what is older than the two newest: code makes the account until the Writer rebuilds it.
    const five = [...chapters, mk(5)];
    assert.equal(S.chapterView(five, { condensed }).condensedFrom, 'code');
    assert.doesNotMatch(S.chapterView(five, { condensed }).text, /Writer text one/);
    assert.ok(S.checkCondensed({ parts: [{ id: 'ch-1', text: 'x' }] }, inputs).problems.some(p => /ch-2 is missing/.test(p)));
});

// ---------------------------------------------------------------- the host flow through src/chapters.js

function fakeHost() {
    const calls = [];
    const host = {
        chat: [], chatMetadata: {}, id: 'flow-1', mode: {}, name1: 'Heather', name2: 'Hale', maxContext: 16384,
        extensionSettings: { [KEY]: { enabled: true, summary: { on: true, hide: true } } },
        eventSource: { on() {} }, eventTypes: {},
        getCurrentChatId() { return host.id; },
        async saveChat() {}, saveMetadataDebounced() {},
        async generateRaw({ prompt, systemPrompt }) {
            const user = prompt.map(m => m.content).join('\n');
            calls.push({ system: systemPrompt, user });
            if (/Write the record of one chapter/.test(user)) {
                const labelled = [...user.matchAll(/^\[(\S+)\] (\w+): (.+)$/gm)].map(m => ({ label: m[1], name: m[2], text: m[3] }));
                const replies = labelled.filter(x => x.name === 'Hale');
                const bad = host.mode.failChapter;
                const evidence = replies.slice(0, 3).map(x => ({ message: x.label, quote: bad ? 'words that are in no reply at all' : x.text.slice(0, 48) }));
                const summary = replies.map(x => x.text).join(' ').split(' ').slice(0, 170).join(' ');
                return JSON.stringify({ evidence, title: `Part at ${(replies[0]?.text.match(/rode to ([A-Z]\w+(?: [A-Z]\w+)?)/) || [])[1] || 'the road'}`, start_time: '', end_time: '', summary, people: ['Hale', 'Heather', 'Edren'], places: [], threads_opened: [], threads_closed: [], importance: 6, secrets: [], final_changes: [], event_seeds: [] });
            }
            if (/Condense these stored chapter records/.test(user)) {
                const parts = [...user.matchAll(/^\[(\S+)\] target (\d+) words\. (.+)$/gm)].map(m => ({ id: m[1], text: m[3].split(' ').slice(0, Number(m[2])).join(' ') }));
                return JSON.stringify({ parts });
            }
            return 'Plain reply.';
        },
    };
    globalThis.SillyTavern = { getContext: () => host };
    return { host, calls };
}

async function openChat(host, exchanges, id) {
    host.id = id;
    host.chat = makeChat(exchanges);
    host.chatMetadata = { [MEMORY]: { v: 1, seq: 0, log: [], imported: { at: T0 } } };
    const { memoryStore } = await import('../src/memory/store.js');
    memoryStore().marks();
}

const runQueue = async () => { const { desktopQueue } = await import('../src/memory/queue.js'); for (let i = 0; i < 4; i++) await desktopQueue().pump(); };
const coreChatOf = host => host.chat.filter(m => !m.is_system).map(m => ({ ...m }));

test('the host closes chapters through the queue and the Writer chain; the interceptor leaves covered messages out', async () => {
    const { host, calls } = fakeHost();
    const C = await import('../src/chapters.js');
    const H = await import('../src/hide.js');
    C.startChapters();
    await openChat(host, 8, 'flow-close');
    await C.queueChapterWork();
    await runQueue();
    let state = C.chapterState();
    assert.equal(state.chapters.length, 1, 'one chapter closed at the scene end');
    assert.equal(state.chapters[0].valid, true);
    const log = host.chatMetadata[MEMORY].log.filter(e => e.record?.kind === 'chapter');
    assert.equal(log.length, 1);
    assert.equal(log[0].origin.type, 'chapter');
    assert.ok(log[0].evidence?.length >= 1, 'the entry keeps its evidence quotes');
    assert.equal(calls.filter(c => /Condense these stored/.test(c.user)).length, 0, 'no condensed call at the first close');
    const prompt = coreChatOf(host);
    await globalThis[H.INTERCEPTOR](prompt, 16384, () => {}, 'normal');
    const sent = H.lastChapterAssembly();
    assert.equal(sent.removed, 14, 'the 14 covered messages left the request');
    assert.equal(sent.inserted, true, 'the chapter view went into the same request');
    assert.ok(prompt.some(m => m.extra?.ri_chapter_view && /<chapter n="1"/.test(m.mes)));
    assert.equal(host.chat.filter(m => m.is_system).length, 0, 'no hidden flag was stored on any message');
    // Two more scenes: the third close rebuilds the condensed account from the stored chapter records.
    for (let n = 9; n <= 22; n++) {
        addExchange(host.chat, n, n <= 14 ? 'Elerian Keep' : n <= 21 ? 'Aldermarch' : 'Verath Road');
        (await import('../src/memory/store.js')).memoryStore().marks();
        await C.queueChapterWork();
        await runQueue();
    }
    state = C.chapterState();
    assert.equal(state.chapters.length, 3, 'three chapters closed');
    const condensedCalls = calls.filter(c => /Condense these stored/.test(c.user));
    assert.equal(condensedCalls.length, 1, 'one condensed call, at the third close');
    assert.doesNotMatch(condensedCalls[0].user, /<condensed>|<story_so_far>/, 'the condensed call reads chapter records, never an earlier account');
    assert.ok(condensedCalls[0].user.includes(`[${state.chapters[0].id}]`), 'its input is the oldest chapter record');
    assert.equal(state.view.condensedFrom, 'writer');
    const p2 = coreChatOf(host);
    await globalThis[H.INTERCEPTOR](p2, 16384, () => {}, 'normal');
    const view = p2.find(m => m.extra?.ri_chapter_view).mes;
    assert.match(view, /<condensed>/);
    assert.match(view, /<chapter n="3"/, 'the newest closed chapter is in the request');
    assert.ok(S.tokensOf(view) <= C.chapterSize().view, 'the view stays under the small cap');
});

test('a forced chapter-call failure leaves the messages in the request, and the receipt offers Repair', async () => {
    const { host, calls } = fakeHost();
    const C = await import('../src/chapters.js');
    const H = await import('../src/hide.js');
    C.startChapters();
    await openChat(host, 8, 'flow-fail');
    host.mode.failChapter = true;
    await C.queueChapterWork();
    await runQueue();
    assert.equal(calls.filter(c => /Write the record of one chapter/.test(c.user)).length, 2, 'one call and one repair retry');
    assert.match(calls.filter(c => /Write the record of one chapter/.test(c.user))[1].user, /could not be used: The quote/, 'the repair sends the error back');
    assert.equal(C.chapterState().chapters.length, 0, 'no chapter was filed');
    const prompt = coreChatOf(host);
    await globalThis[H.INTERCEPTOR](prompt, 16384, () => {}, 'normal');
    assert.equal(prompt.length, host.chat.length, 'every message stays in the request');
    const failures = C.chapterFailures();
    assert.equal(failures.length, 1);
    assert.ok(failures[0].answer.includes('words that are in no reply'), 'the receipt keeps the bad answer for Repair');
    const { logEntries } = await import('../src/log.js');
    assert.ok(logEntries().some(e => e.status === 'Repair' && /Repair/.test(e.result)));
    // Repair: the answer fixed by hand files the chapter.
    const fixed = JSON.parse(failures[0].answer);
    const replies = host.chat.slice(1, 15).filter(m => !m.is_user);
    fixed.evidence = replies.slice(0, 2).map(m => ({ message: storedMark(m), quote: proseOf(m).slice(0, 40) }));
    await assert.rejects(C.repairChapter(failures[0].id, '{"evidence": []}'), /evidence list is empty/);
    await C.repairChapter(failures[0].id, JSON.stringify(fixed));
    assert.equal(C.chapterState().chapters.length, 1);
    assert.equal(C.chapterFailures().length, 0);
});

test('a stale chapter sends its messages raw and is rebuilt as soon as the Writer route is free', async () => {
    const { host } = fakeHost();
    const C = await import('../src/chapters.js');
    const H = await import('../src/hide.js');
    const I = await import('../src/memory/import.js');
    const { desktopQueue } = await import('../src/memory/queue.js');
    C.startChapters();
    await openChat(host, 8, 'flow-stale');
    await C.queueChapterWork();
    await runQueue();
    const id = C.chapterState().chapters[0].id;
    host.chat[4].mes = `${host.chat[4].mes} Edren counted the sacks twice.`;
    host.chat[4].swipes[0] = host.chat[4].mes;
    assert.equal(C.chapterState().chapters[0].valid, false);
    const prompt = coreChatOf(host);
    await globalThis[H.INTERCEPTOR](prompt, 16384, () => {}, 'normal');
    assert.equal(prompt.length, host.chat.length, 'the edited chapter\'s messages go raw');
    // MB2 queues the rebuild of a stale chapter; the chapter handler runs it on the Writer chain.
    for (const job of I.chapterJobs()) await desktopQueue().enqueue(job);
    await runQueue();
    const after = C.chapterState().chapters;
    assert.equal(after.length, 1);
    assert.equal(after[0].id, id, 'the rebuilt chapter keeps its id');
    assert.equal(after[0].valid, true, 'its coverage is valid again');
    assert.ok(after[0].record.text.includes('counted the sacks twice') || after[0].record.covers.some(c => c.hash === revisionOf(host.chat[4]).hash));
});

test('a swipe of the newest reply leaves out no chapter that covers it, and the generation type is honored', async () => {
    const { host } = fakeHost();
    const C = await import('../src/chapters.js');
    C.startChapters();
    await openChat(host, 7, 'flow-swipe');
    await C.closeChapterHere();
    const state = C.chapterState({ forRequest: 'swipe' });
    assert.equal(state.chapters[0].valid, false, 'a chapter that covers the reply being swiped is not used for that request');
    assert.equal(C.chapterState().chapters[0].valid, true);
});

test('a chapter close schedules one write of the generated Story World book (MB13)', async () => {
    const { host } = fakeHost();
    const C = await import('../src/chapters.js');
    C.startChapters();
    let writes = 0;
    C.useStoryWorldBook(() => ({ schedule() { writes += 1; } }));
    try {
        await openChat(host, 8, 'flow-book');
        await C.queueChapterWork();
        await runQueue();
        assert.equal(C.chapterState().chapters.length, 1);
        assert.equal(writes, 1, 'one close, one scheduled write');
        await C.queueChapterWork();
        await runQueue();
        assert.equal(writes, 1, 'no close, no write');
    } finally { C.useStoryWorldBook(null); }
});
