// MB8: the background job queue, model residency, judgment routes and the on-phone model. Run with:
// node --test tests/t_queue.js
// The queue runs on a fake clock, so the hour of play and the idle window take no real time.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
let pending = [];
const profiles = [
    { id: 'p-desktop', name: 'Gemma over Tailscale', api: 'custom', model: 'gemma4:12b', 'api-url': 'http://100.97.15.107:11434/v1', preset: '' },
    { id: 'p-or', name: 'OpenRouter', api: 'openrouter', model: 'x', preset: '' },
];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter' },
    ConnectionManagerRequestService: {
        getSupportedProfiles: () => profiles,
        sendRequest: (profileId, messages, tokens, custom = {}) => new Promise((resolve, reject) => {
            const call = { profileId, messages, resolve, reject };
            pending.push(call);
            custom.signal?.addEventListener('abort', () => reject(custom.signal.reason || new Error('aborted')));
        }),
    },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {} };
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const queueMod = await import('../src/memory/queue.js');
const decide = await import('../src/memory/decide.js');
const phone = await import('../src/memory/phone-model.js');
const routing = await import('../src/routing.js');
const spend = await import('../src/spend.js');
const { createQueue, memoryStore, captureCandidates, revOf } = queueMod;

const MIN = 60 * 1000;
function fakeClock(start = Date.parse('2026-11-23T20:00:00Z')) {
    let now = start;
    return { now: () => now, advance: ms => { now += ms; } };
}

/** A handler that answers on the desktop and records the order jobs ran in. */
function recorder(ran, { route = 'desktop' } = {}) {
    return { run: async job => { ran.push(job.key); return { ok: true, route, value: {} }; }, commit: async () => {} };
}

test('an hour of scripted play on the desktop route records zero model swaps', async () => {
    const clock = fakeClock();
    const ran = [];
    const events = [];
    const warm = async () => true;
    const q = createQueue({ clock: clock.now, warm, timers: false, onEvent: e => events.push(e),
        handlers: { capture: recorder(ran), chapter: recorder(ran), tidyScreen: recorder(ran), booster: recorder(ran) } });
    await q.warmUp();
    // A turn every two minutes for an hour: a judgment call before the reply, capture after it, a chapter every ten
    // turns, booster indexing on the embedding model, and a tidy screen on d3:4b that must wait for an idle window.
    for (let turn = 0; turn < 30; turn++) {
        clock.advance(2 * MIN);
        q.activity();
        const judged = await q.desktopTurn(async () => ({ route: 'desktop', model: 'gemma4:12b', value: {} }), { deadline: clock.now() + 1000 });
        assert.equal(judged.route, 'desktop');
        await q.enqueue({ chatId: 'c', kind: 'capture', subject: `m${turn}`, order: turn, model: 'gemma4:12b', sources: { [`m${turn}`]: revOf(`reply ${turn}`) } });
        await q.enqueue({ chatId: 'c', kind: 'booster', subject: `m${turn}`, order: turn, model: 'nomic-embed-text', sources: { [`m${turn}`]: revOf(`reply ${turn}`) } });
        if (turn % 10 === 9) await q.enqueue({ chatId: 'c', kind: 'chapter', subject: `ch${turn}`, order: turn, model: 'gemma4:12b', sources: { ch: String(turn) } });
        if (turn % 5 === 0) await q.enqueue({ chatId: 'c', kind: 'tidyScreen', subject: `pair${turn}`, model: 'd3:4b', sources: { pair: String(turn) } });
        await q.pump();
    }
    const stats = q.stats();
    assert.equal(stats.swaps, 0, 'no swap in an hour of play');
    assert.equal(events.filter(e => e.type === 'swap').length, 0);
    assert.deepEqual(stats.loaded.sort(), ['gemma4:12b', 'nomic-embed-text'], 'the chat model and the embedding model stay loaded together');
    assert.equal(stats.held, 6, 'the six d3:4b screens wait for an idle window');
    assert.ok(!ran.some(key => key.includes('tidyScreen')));
    assert.equal(ran.filter(key => key.includes('capture')).length, 30);
});

test('idle-window grouping: three jobs for a second model cost one swap out and one back', async () => {
    const clock = fakeClock();
    const ran = [];
    const warms = [];
    const q = createQueue({ clock: clock.now, timers: false, warm: async model => { warms.push(model); return true; },
        handlers: { tidyScreen: recorder(ran), capture: recorder(ran) } });
    await q.warmUp();
    for (const n of [1, 2, 3]) await q.enqueue({ chatId: 'c', kind: 'tidyScreen', subject: `pair${n}`, model: 'd3:4b', sources: { pair: String(n) } });
    q.activity();
    await q.pump();
    assert.equal(ran.length, 0, 'nothing runs during play');
    clock.advance(10 * MIN);
    await q.pump();
    assert.deepEqual(ran, ['c|tidyScreen|pair1', 'c|tidyScreen|pair2', 'c|tidyScreen|pair3'], 'the three run as one group');
    assert.equal(q.stats().swaps, 2, 'one swap out, one back');
    assert.deepEqual(warms, ['gemma4:12b', 'gemma4:12b'], 'the resident model loads again after the group');
    assert.deepEqual(q.stats().loaded, ['gemma4:12b']);
    // The end of a session opens the window at once.
    await q.enqueue({ chatId: 'c', kind: 'tidyScreen', subject: 'pair4', model: 'd3:4b', sources: { pair: '4' } });
    q.activity();
    await q.endSession();
    assert.equal(ran.at(-1), 'c|tidyScreen|pair4');
    assert.equal(q.stats().swaps, 4);
});

test('play resuming during a group stops it after the running job and loads the resident model again', async () => {
    const clock = fakeClock();
    const ran = [];
    let q;
    const handler = { run: async job => { ran.push(job.key); if (ran.length === 1) q.activity(); return { ok: true, route: 'desktop' }; }, commit: async () => {} };
    q = createQueue({ clock: clock.now, timers: false, warm: async () => true, handlers: { tidyScreen: handler } });
    await q.warmUp();
    for (const n of [1, 2, 3]) await q.enqueue({ chatId: 'c', kind: 'tidyScreen', subject: `p${n}`, model: 'd3:4b', sources: { p: String(n) } });
    clock.advance(11 * MIN);
    await q.pump();
    assert.equal(ran.length, 1, 'the running job finished and the rest wait');
    assert.deepEqual(q.stats().loaded, ['gemma4:12b']);
    assert.equal(q.stats().swaps, 2);
});

test('a killed app resumes its queue with no duplicate job', async () => {
    const shared = memoryStore();
    const clock = fakeClock();
    let calls = 0;
    // The first app is killed while capture runs: its handler never returns.
    const first = createQueue({ store: shared, clock: clock.now, timers: false, handlers: { capture: { run: () => { calls++; return new Promise(() => {}); } } } });
    await first.enqueue({ chatId: 'c', kind: 'capture', subject: 'm1', order: 1, sources: { m1: 'r1' } });
    first.pump();
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 1);
    const committed = [];
    const second = createQueue({ store: shared, clock: clock.now, timers: false,
        handlers: {
            capture: { run: async () => { calls++; return { ok: true, route: 'desktop' }; }, commit: async job => committed.push(job.key) },
            chapter: { run: async () => ({ ok: true, route: 'desktop' }), commit: async job => committed.push(job.key) },
        } });
    await second.open();
    assert.equal(second.jobs().length, 1);
    assert.equal(second.jobs()[0].state, 'queued', 'the interrupted job waits again');
    await second.enqueue({ chatId: 'c', kind: 'capture', subject: 'm1', order: 1, sources: { m1: 'r1' } });
    assert.equal(second.jobs().length, 1, 'a repeat merges');
    await second.pump();
    assert.deepEqual(committed, ['c|capture|m1'], 'filed once');
    // A capture job is guarded by the reply's capture stamp; other jobs by their done record.
    const chapter = { chatId: 'c', kind: 'chapter', subject: 'ch1', order: 1, sources: { ch1: 'r1' } };
    await second.enqueue(chapter);
    await second.pump();
    await second.enqueue(chapter);
    assert.equal(second.jobs().length, 0, 'a job already filed for these sources is not added again');
});

test('with the device database cleared, reopening a chat rebuilds the missing work; a saved result files nothing', async () => {
    const chat = [
        { is_user: false, mes: 'Opening.', send_date: 'a' },
        { is_user: true, mes: 'I wave.', send_date: 'b' },
        { is_user: false, mes: 'Reply one.', send_date: 'c' },
        { is_user: true, mes: 'I run.', send_date: 'd' },
        { is_user: false, mes: 'Reply two.', send_date: 'e' },
    ];
    const captured = new Set(['a']);
    const db = memoryStore();
    await db.clear();
    const committed = [];
    const q = createQueue({ store: db, timers: false, handlers: { capture: {
        run: async () => ({ ok: true, route: 'desktop' }),
        commit: async job => committed.push(job.subject),
        // MB2's record store already holds the records of reply c: a retry finds them and files nothing.
        saved: async job => job.subject === 'c',
    } } });
    const added = await q.rebuild(captureCandidates(chat, { chatId: 'chat-1', captured: m => captured.has(m.send_date) }));
    assert.deepEqual(added, ['chat-1|capture|c', 'chat-1|capture|e']);
    await q.pump();
    assert.deepEqual(committed, ['e'], 'the job whose result was saved files nothing');
    // Both replies now carry their capture stamp, as the commit writes it.
    captured.add('c'); captured.add('e');
    assert.deepEqual(await q.rebuild(captureCandidates(chat, { chatId: 'chat-1', captured: m => captured.has(m.send_date) })), []);
    // An edited reply is new work: its stamp no longer matches its text.
    chat[4].mes = 'Reply two, edited.';
    captured.delete('e');
    const again = await q.rebuild(captureCandidates(chat, { chatId: 'chat-1', captured: m => captured.has(m.send_date) }));
    assert.deepEqual(again, ['chat-1|capture|e']);
});

test('a reply deleted and sent again with the same words in the same minute is captured again', async () => {
    const db = memoryStore();
    await db.clear();
    const committed = [];
    const q = createQueue({ store: db, timers: false, handlers: { capture: { run: async () => ({ ok: true, route: 'desktop' }), commit: async job => committed.push(job.subject) } } });
    const reply = { is_user: false, mes: 'Same words.', send_date: 'minute-1' };
    await q.rebuild(captureCandidates([reply], { chatId: 'chat-1' }));
    await q.pump();
    // The reply and its records were deleted; the new reply has the same key and sources and no capture stamp.
    const again = await q.rebuild(captureCandidates([{ ...reply }], { chatId: 'chat-1' }));
    assert.deepEqual(again, ['chat-1|capture|minute-1']);
    await q.pump();
    assert.deepEqual(committed, ['minute-1', 'minute-1']);
});

test('a job whose sources changed while it ran is replaced, and the old result is not filed', async () => {
    let release;
    const committed = [];
    const q = createQueue({ timers: false, handlers: { capture: {
        run: () => release ? Promise.resolve({ ok: true, route: 'desktop' }) : new Promise(resolve => { release = () => resolve({ ok: true, route: 'desktop' }); }),
        commit: async job => committed.push(job.rev),
    } } });
    await q.enqueue({ chatId: 'c', kind: 'capture', subject: 'm', sources: { m: 'v1' } });
    const pumping = q.pump();
    await new Promise(resolve => setTimeout(resolve, 5));
    await q.enqueue({ chatId: 'c', kind: 'capture', subject: 'm', sources: { m: 'v2' } });
    release();
    await pumping;
    await new Promise(resolve => setTimeout(resolve, 5));
    await q.pump();
    assert.equal(committed.length, 1);
    assert.equal(committed[0], queueMod.sourcesRev({ m: 'v2' }));
});

test('captures within a chat run oldest uncaptured reply first, and priorities hold', async () => {
    const ran = [];
    const q = createQueue({ timers: false, handlers: { capture: recorder(ran), chapter: recorder(ran), tidy: recorder(ran), booster: recorder(ran) } });
    await q.enqueue({ chatId: 'c', kind: 'booster', subject: 'b', order: 0, sources: { b: '1' } });
    await q.enqueue({ chatId: 'c', kind: 'tidy', subject: 't', sources: { t: '1' } });
    for (const n of [9, 3, 7, 1]) await q.enqueue({ chatId: 'c', kind: 'capture', subject: `m${n}`, order: n, sources: { [`m${n}`]: 'x' } });
    await q.enqueue({ chatId: 'c', kind: 'chapter', subject: 'ch', sources: { ch: '1' } });
    await q.pump();
    assert.deepEqual(ran, ['c|capture|m1', 'c|capture|m3', 'c|capture|m7', 'c|capture|m9', 'c|chapter|ch', 'c|tidy|t', 'c|booster|b']);
});

test('a judgment call waits for a running job only until its deadline; a late one is dropped', async () => {
    let release;
    const q = createQueue({ timers: false, handlers: { capture: { run: () => new Promise(resolve => { release = () => resolve({ ok: true, route: 'desktop' }); }), commit: async () => {} } } });
    await q.enqueue({ chatId: 'c', kind: 'capture', subject: 'm', sources: { m: '1' } });
    q.pump();
    await new Promise(resolve => setTimeout(resolve, 5));
    let ran = false;
    const late = await q.desktopTurn(async () => { ran = true; return {}; }, { deadline: Date.now() + 60 });
    assert.deepEqual(late, { late: true });
    assert.equal(ran, false);
    setTimeout(() => release(), 20);
    const onTime = await q.desktopTurn(async () => ({ route: 'desktop', ok: true }), { deadline: Date.now() + 500 });
    assert.equal(onTime.route, 'desktop');
});

test('paid calls reserve their estimate before dispatch, and a timed-out call counts as spent', async () => {
    pending = [];
    spend.resetSpendReservations();
    routing.resetRouteHealth();
    routing.setJobChain('capture', [{ route: 'openrouter', model: 'paid-model', price: { in: 1, out: 1 }, timeoutMs: 150 }]);
    const handler = { run: (job, { signal }) => routing.runJob('capture', { user: 'x'.repeat(4000), tokens: 1000, signal }), commit: async () => {} };
    const q = createQueue({ timers: false, handlers: { capture: handler } });
    await q.enqueue({ chatId: 'c', kind: 'capture', subject: 'm', sources: { m: '1' } });
    const before = spend.spendState().total;
    const pumping = q.pump();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pending.length, 1, 'the request is out');
    assert.ok(spend.spendState().reserved > 0, 'its estimate is held against the ceiling while it runs');
    await pumping;
    const after = spend.spendState();
    assert.equal(after.reserved, 0);
    assert.ok(after.total - before > 0, 'the timed-out call is counted');
    assert.equal(after.calls.at(-1).basis, 'reserved');
    routing.setJobChain('capture', null);
});

test('code screens out turns of talk alone; an attempt with no attempt words still reaches the judgment call', () => {
    assert.equal(decide.screenTurn('"Good morning," I say. "Did you sleep?"').skip, true);
    assert.equal(decide.screenTurn('((OOC: can we skip to the inn?))').skip, true);
    assert.equal(decide.screenTurn('"Fine," I say.', { threads: [{ kind: 'plan', by: 'npc', status: 'open' }] }).skip, false, 'an open NPC plan sends the turn on');
    const silent = decide.screenTurn('I go for the ledge before the bridge gives way.');
    assert.equal(silent.skip, false);
    assert.equal(silent.attemptWords, false);
    assert.equal(decide.screenTurn('I try to pick the lock.').attemptWords, true);
    assert.equal(decide.statFromText('I persuade the guard'), 'Charm');
    assert.equal(decide.actorFromText('Kael lunges at the guard.', ['Kael']), 'Kael');
});

const answer = { attempt: true, actor: 'user', stat: 'Agility', difficulty: 'Hard', stance: 'resisting' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('judgment routes: desktop within 1 s, then the phone, then Jev, then code', async () => {
    decide.resetJudgmentHealth();
    routing.resetRouteHealth();
    const lane = (fn, options) => fn(options);
    const input = { message: 'I go for the ledge.' };
    const desk = await decide.judgeDice(input, { lane, desktop: async () => { await wait(30); return { text: JSON.stringify(answer), model: 'gemma4:12b' }; }, phoneReady: async () => true });
    assert.equal(desk.route, 'desktop');
    assert.deepEqual(desk.value, answer);
    assert.ok(desk.ms < 1000);

    // A desktop that is slow is left at 1 s and the phone answers with two one-word items.
    const asked = [];
    const slow = await decide.judgeDice(input, { lane, desktop: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
        phoneReady: async () => true, phoneAsk: async (q, options) => { asked.push(options); return options.includes('yes') ? 'yes' : '3'; } });
    assert.equal(slow.route, 'phone');
    assert.ok(slow.attempts[0].outcome === 'late' && slow.attempts[0].ms >= 990 && slow.attempts[0].ms < 1200, 'left at the 1 s limit');
    assert.equal(asked.length, 2);
    assert.deepEqual(slow.value, { attempt: true, actor: 'user', stat: 'Wits', difficulty: 'Hard', stance: 'neutral' });

    // With no network at all the desktop fails at once and the phone still judges the attempt.
    decide.resetJudgmentHealth();
    const offline = await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane, desktop: async () => { throw new TypeError('Failed to fetch'); },
        phoneReady: async () => true, phoneAsk: async (q, options) => options.includes('yes') ? 'yes' : '2' });
    assert.equal(offline.route, 'phone');
    assert.equal(offline.value.stat, 'Agility');
    // The miss is remembered, so the next call goes straight to the phone.
    let desktopCalled = false;
    const next = await decide.judgeDice(input, { lane, desktop: async () => { desktopCalled = true; return {}; }, phoneReady: async () => true, phoneAsk: async (q, o) => o[0] });
    assert.equal(desktopCalled, false);
    assert.equal(next.attempts[0].outcome, 'skipped');

    // No phone model and Jev off: code's default rolls clear attempt words at Fair.
    const code = await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane, desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false,
        jev: async () => ({ skipped: 'no OpenRouter connection' }) });
    assert.equal(code.route, 'code');
    assert.deepEqual(code.value, { attempt: true, actor: 'user', stat: 'Agility', difficulty: 'Fair', stance: 'neutral' });
    assert.ok(code.attempts.some(a => a.route === 'jev' && a.outcome === 'skipped'));

    // A turn of talk alone sends nothing.
    let any = false;
    const talk = await decide.judgeDice({ message: '"Hello," I say.' }, { lane, desktop: async () => { any = true; return {}; } });
    assert.equal(talk.skipped, true);
    assert.equal(any, false);
});

test('with no desktop and no phone model, the Jev slot runs through SillyTavern\'s OpenRouter connection and is metered', async () => {
    decide.resetJudgmentHealth();
    routing.resetRouteHealth();
    spend.resetSpendReservations();
    pending = [];
    const before = spend.spendState().total;
    const run = decide.judgeDice({ message: 'I try to climb the wall.' }, { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false });
    await wait(20);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].profileId, 'p-or', 'sent through the saved OpenRouter profile, so the key stays in SillyTavern');
    pending[0].resolve({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: 'stop' }], usage: { prompt_tokens: 150, completion_tokens: 30 } });
    const res = await run;
    assert.equal(res.route, 'jev');
    assert.equal(res.model, 'typesafe/jev-router');
    assert.ok(spend.spendState().total > before, 'counted toward the ceiling');
    assert.doesNotMatch(JSON.stringify(host.extensionSettings[KEY]), /sk-|api_key/i);
});

test('judgment timing on the desktop route over 50 turns stays at 0.5 s or less at the median and never past 1 s', { timeout: 60000 }, async () => {
    decide.resetJudgmentHealth();
    const times = [];
    for (let i = 0; i < 50; i++) {
        const delay = i % 10 === 9 ? 1500 : 200 + (i % 5) * 50;
        const res = await decide.judgeDice({ message: `I try move ${i}.` }, { lane: fn => fn(), phoneReady: async () => false, jev: async () => ({ skipped: 'off' }),
            desktop: ({ signal }) => new Promise((resolve, reject) => { const t = setTimeout(() => resolve({ text: JSON.stringify(answer) }), delay); signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }); }) });
        times.push(res.attempts[0].ms);
    }
    times.sort((a, b) => a - b);
    assert.ok(times[25] <= 500, `median ${times[25]} ms`);
    assert.ok(times.at(-1) < 1100, `slowest ${times.at(-1)} ms`);
});

test('no writing job is ever sent to the on-phone model', async () => {
    routing.resetRouteHealth();
    let phoneCalls = 0;
    routing.registerPhoneModel(async () => { phoneCalls++; return { text: '{}' }; });
    for (const job of ['capture', 'statSheets', 'chapter', 'storySoFar', 'tidy', 'catchUp', 'carryOver']) {
        const chain = routing.chainFor(job).concat([{ route: 'phone', model: 'gemma-4-e2b-litert' }]);
        const res = await routing.runChain(chain.filter(e => e.route === 'phone'), { job, user: 'x' });
        assert.equal(res.ok, false);
        assert.match(res.attempts[0].receipt, /judgment calls only/);
    }
    assert.equal(phoneCalls, 0);
    await assert.rejects(phone.phoneRunner({ user: 'x', schema: { value: { type: 'object', properties: { facts: { type: 'array' } } } } }), /one-word items only/);
    routing.registerPhoneModel(null);
});

// A Cache API and a LiteRT-LM runtime that keep everything in memory.
function fakeCaches() {
    const stores = new Map();
    return {
        stores,
        async open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const map = stores.get(name);
            return {
                async match(url) { return map.has(url) ? new Response(map.get(url)) : undefined; },
                async put(url, response) { map.set(url, new Uint8Array(await response.arrayBuffer())); },
                async delete(url) { return map.delete(url); },
            };
        },
        async delete(name) { return stores.delete(name); },
    };
}
function fakeRuntime(words) {
    const created = [];
    return { created, loader: async () => ({ Engine: { create: async options => { created.push(options); return {
        createConversation: async () => ({ async *sendMessageStreaming() { yield { content: [{ type: 'text', text: `${words.shift() ?? 'no'} because` }] }; }, cancel() {}, delete: async () => {} }),
        delete: async () => {},
    }; } } }) };
}
const fakeFetch = (counter) => async () => { counter.n++; return new Response(new Uint8Array(1000), { headers: { 'content-length': '1000' } }); };

test('the on-phone model downloads by itself on Wi-Fi, waits on mobile data, and never after Delete', async () => {
    const caches = fakeCaches();
    phone.setPhoneRuntime({ caches, loader: fakeRuntime([]).loader });
    store.clear();
    const got = { n: 0 };
    const notes = [];
    // Mobile data: nothing downloads until the phone joins Wi-Fi.
    const listeners = [];
    const cellular = { type: 'cellular', addEventListener: (_, fn) => listeners.push(fn), removeEventListener() {} };
    assert.equal(await phone.autoDownloadPhoneModel({ connection: cellular, fetchImpl: fakeFetch(got), note: t => notes.push(t) }), 'waiting');
    assert.equal(got.n, 0);
    cellular.type = 'wifi';
    listeners.forEach(fn => fn());
    await wait(20);
    assert.equal(got.n, 1, 'downloaded once on Wi-Fi');
    assert.ok(notes.some(t => /2\.0 GB/.test(t)) && notes.some(t => /ready/.test(t)), 'visible progress notes');
    assert.equal(routing.detectRoutes().phone?.kind, 'phone', 'offered to the judgment chain');
    // Cached: the next start registers it with no download.
    assert.equal(await phone.autoDownloadPhoneModel({ connection: { type: 'wifi' }, fetchImpl: fakeFetch(got) }), 'cached');
    assert.equal(got.n, 1);
    // After Delete it stays off until Download is tapped.
    await phone.deletePhoneModel();
    assert.equal(await phone.autoDownloadPhoneModel({ connection: { type: 'wifi' }, fetchImpl: fakeFetch(got) }), 'declined');
    assert.equal(got.n, 1);
    assert.equal((await phone.phoneModelStatus()).action, 'Download');
    await phone.tapDownloadPhoneModel({ fetchImpl: fakeFetch(got) });
    assert.equal(got.n, 2);
    // Where the network type is unknown it waits for the first idle moment.
    await phone.deletePhoneModel();
    store.clear();
    let idle = null;
    assert.equal(await phone.autoDownloadPhoneModel({ connection: undefined, whenIdle: fn => { idle = fn; }, fetchImpl: fakeFetch(got) }), 'waiting');
    assert.equal(got.n, 2);
    await idle();
    assert.equal(got.n, 3);
    routing.registerPhoneModel(null);
});

test('a cold start loads the phone model from the cache with no network, and answers one word', async () => {
    const caches = fakeCaches();
    const runtime = fakeRuntime(['Yes', '4']);
    phone.setPhoneRuntime({ caches, loader: runtime.loader });
    store.clear();
    await phone.tapDownloadPhoneModel({ fetchImpl: fakeFetch({ n: 0 }) });
    await phone.unloadPhoneModel();
    phone.setPhoneRuntime({ caches, loader: runtime.loader });
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('no network'); };
    try {
        assert.equal(await phone.askOneWord('Is this an attempt?', ['yes', 'no']), 'yes');
        assert.equal(await phone.askOneWord('How hard?', ['1', '2', '3', '4', '5']), '4');
        assert.match(runtime.created[0].model, /^blob:/, 'the engine reads the cached file');
    } finally { globalThis.fetch = realFetch; }
    routing.registerPhoneModel(null);
});
