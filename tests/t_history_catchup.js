// MB9: catch-up, rebuild and the route tests (memory DESIGN 8.1 and 8.2). The extension's own modules run in Node on a host in
// SillyTavern's shape, and the model is scripted, so every check here runs with no model and no network.
//   node --test tests/t_history_catchup.js
// A 300-exchange chat with no memory is caught up on a fake queue: the call counts match M1f's estimate per route class, a
// restart at any part resumes with no duplicate record, a repeat adds nothing, scripted route states pick the route 8.1 names or
// ask first naming the failed test, and Rebuild and Clear undo in one tap and keep your locked records.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const t0 = Date.parse('2026-11-25T10:00:00Z');
const NAMES = { char: 'Hale of Verath', user: 'Mira' };

function message(i, text, user = false) {
    const send_date = new Date(t0 + i * 60000).toISOString();
    return { name: user ? NAMES.user : NAMES.char, is_user: user, mes: text, send_date, swipe_id: 0, swipes: [text], swipe_info: [{ send_date, extra: {} }], extra: {} };
}
const host = {
    chat: [], chatMetadata: {}, extensionSettings: { [KEY]: {} }, name1: NAMES.user, name2: NAMES.char, characters: [{ name: NAMES.char }], characterId: 0,
    getCurrentChatId: () => 'mb9-chat', saveChat: async () => {}, saveSettingsDebounced() {}, saveMetadataDebounced() {}, saveMetadata() {},
    eventSource: { on() {} }, eventTypes: {}, mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter' },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };

const CU = await import('../src/memory/catchup.js');
const F = await import('../src/memory/fold.js');
const S = await import('../src/memory/store.js');
const SF = await import('../src/memory/story-so-far.js');
const R = await import('../src/routing.js');

// ---------------------------------------------------------------- a chat of 300 exchanges and a scripted model

const THINGS = ['salt', 'rope', 'lantern', 'ledger', 'barge', 'toll', 'gate', 'cart', 'seal', 'tar'];
function replyText(i) {
    const sentences = [`Hale counted ${i * 3} crates of salt at the Salt Dock on day ${Math.ceil(i / 10)}.`];
    for (let k = 0; sentences.join(' ').length < 1500; k++) sentences.push(`The ${THINGS[(i + k) % 10]} ledger listed ${i * 7 + k} entries for the ${THINGS[(i * 3 + k) % 10]} barge number ${i + k}.`);
    if (i % 10 === 0) sentences.push('\n\n* * *');
    return sentences.join(' ');
}
const userText = i => `I ask Hale about shipment ${i}, and I check the ${THINGS[i % 10]} list for the day.`;

function build(exchanges = 300) {
    const chat = [message(0, 'Hale waits at the Salt Dock.')];
    for (let i = 1; i <= exchanges; i++) chat.push(message(chat.length, userText(i), true), message(chat.length + 1, replyText(i)));
    return chat;
}

/** A model that files one record for every fifth exchange and closes a chapter at every tenth exchange it is shown as new. */
function model({ calls = [], mood = false, repeat = false, keepOpen = false } = {}) {
    return async (chain, options) => {
        const entry = chain[0];
        calls.push({ route: entry.route, job: options.job, user: options.user, label: options.label });
        const shown = [...options.user.matchAll(/Exchange (\d+) \[(new|recorded)\]\n\[([^\]]+)\] Player: ([\s\S]*?)\n\[([^\]]+)\] [^:\n]+: ([\s\S]*?)(?=\n\nExchange \d+ \[|\n\nThe story goes on|\n\nThe last exchange ends|\n\nThis is the last)/g)]
            .map(m => ({ n: Number(m[1]), status: m[2], pmark: m[3], rmark: m[5], prose: m[6], i: Number((m[6].match(/counted (\d+) crates/) || [])[1]) / 3 }));
        const ops = shown.filter(x => x.status === 'new' && x.i % 5 === 0).map(x => ({
            op: 'add', id: `shipment-${x.i}`, target: [], kind: 'fact', subject: `Shipment ${x.i}`, text: mood ? `Hale felt terrified about shipment ${x.i}.` : `Hale counted ${x.i * 3} crates of salt for shipment ${x.i}.`,
            quote: `counted ${x.i * 3} crates of salt`, exchange: x.n,
        }));
        if (repeat) ops.push(...ops);
        if (process.env.RI_DEBUG) console.log(`call ${calls.length}: ${shown.length} shown, ${shown.filter(x => x.status === 'new').length} new, first i=${shown[0]?.i}, last i=${shown.at(-1)?.i}, ops ${ops.length}, closeLast ${/ends a scene/.test(options.user)}`);
        const chapters = [];
        const groups = Math.floor(shown.length / 10);
        for (let g = 1; g <= groups; g++) {
            const part = shown.slice((g - 1) * 10, g * 10);
            if (g === groups && shown.length % 10 === 0 && (keepOpen || !/The last exchange ends a scene/.test(options.user))) break;
            const lines = part.map(x => `Hale counted ${x.i * 3} crates of salt at the Salt Dock in the tally for day ${Math.ceil(x.i / 10)}.`);
            for (let k = 0; k < 6; k++) lines.push(`Mira checked ledger line ${part[0].i + k} against the dock tally.`);
            chapters.push({
                first_exchange: part[0].n, last_exchange: part.at(-1).n, title: `Shipments ${part[0].i} to ${part.at(-1).i}`, start_time: '', end_time: '',
                evidence: [part[0], part[4], part[9]].map(x => ({ message: x.rmark, quote: `counted ${x.i * 3} crates of salt` })),
                summary: mood ? `${lines.join(' ')} Hale felt terrified and the mood was ominous.` : lines.join(' '), people: ['Hale', 'Mira'], places: ['Salt Dock'], threads_opened: [], threads_closed: [], importance: 5, secrets: [],
            });
        }
        return { ok: true, value: { ops, chapters, scene: { place: 'Salt Dock', time: `Day ${Math.ceil((shown.at(-1)?.i || 1) / 10)}`, present: ['Hale', 'Mira'] } }, route: entry.route, model: entry.model || 'scripted', attempts: [] };
    };
}

/** One queue for a run: jobs wait in order and the pump runs them one at a time, as the device queue does. */
function fakeQueue() {
    const jobs = [];
    const q = {
        jobs, ran: 0, run: null, limit: Infinity, failures: 0,
        enqueue: async job => { const key = `${job.chatId}|${job.kind}|${job.subject}`; if (!jobs.some(j => j.key === key)) jobs.push({ ...job, key, tries: 0, payload: job.payload }); },
        pump: async () => {
            while (jobs.length && q.ran < q.limit) {
                const job = jobs.shift();
                q.ran += 1;
                const res = await q.run(job, { signal: new AbortController().signal });
                if (!res.ok) { job.tries += 1; q.failures += 1; if (job.tries < 6) jobs.unshift(job); else break; }
            }
        },
    };
    return q;
}

const FACTS = { desktop: { found: true, reachable: true, model: 'gemma4:12b' }, nanogpt: { found: true, reachable: true, model: 'deepseek/deepseek-v4.1-flash' }, charging: null };
const chainFor = job => R.RECOMMENDED_CHAINS[job] || R.RECOMMENDED_CHAINS.catchUp;

/** The runner over a given chat. snapshot(): what the last save wrote, so a test can restart the app from it. */
function setup({ chat = build(), facts = FACTS, calls = [], memory = { catchUpFree: true }, script = model({ calls }), saveFails = 0 } = {}) {
    const meta = {};
    const state = { chat, meta, saved: null, saves: 0, saveFails, counts: { cleanup: 0, condensed: 0, index: 0 } };
    const hostFor = () => ({ chat: () => state.chat, meta: () => state.meta, chatId: () => 'mb9-chat', now: () => Date.now(), save: async () => { await state.save(); } });
    state.save = async () => {
        state.saves += 1;
        if (state.saveFails && state.saves === state.saveFails) throw new Error('killed before the save');
        state.saved = JSON.stringify({ chat: state.chat, meta: state.meta });
    };
    const store = S.createStore({ chat: () => state.chat, meta: () => state.meta, chatId: () => 'mb9-chat', save: () => state.save(), now: () => Date.now() });
    const queue = fakeQueue();
    const deps = {
        chat: () => state.chat, meta: () => state.meta, chatId: () => 'mb9-chat', names: () => NAMES, key: KEY, store, save: () => state.save(),
        runChain: script, chainFor, enqueue: job => queue.enqueue(job), pump: () => {}, now: () => Date.now(), memorySettings: () => memory,
        facts: async () => (typeof facts === 'function' ? facts() : facts), askRoute: () => ({ route: 'openrouter', price: { in: 0.0498, out: 0.1992 } }),
        stages: { cleanup: async () => { state.counts.cleanup += 1; }, condensed: async () => { state.counts.condensed += 1; }, index: async () => { state.counts.index += 1; } },
    };
    const runner = CU.createCatchUp(deps);
    queue.run = (job, options) => runner.run(job, options);
    return { state, store, runner, queue, deps, hostFor };
}

/** Restart the app from what the last save wrote: a new chat object, a new runner and an empty queue. */
function restart(old, extra = {}) {
    const saved = JSON.parse(old.state.saved);
    const next = setup({ chat: saved.chat, ...extra });
    next.state.meta = saved.meta;
    next.state.saved = old.state.saved;
    return next;
}

const entriesOf = chat => chat.flatMap(m => F.swipeEntries(m));
const ids = result => result.records.map(r => r.id);

// ---------------------------------------------------------------- the estimate

test('a 300-exchange chat makes the call counts of M1f on each route class, plus one Cleanup call', () => {
    const chat = build();
    const waiting = CU.pending(chat, { key: KEY });
    assert.equal(waiting.count, 300);
    const local = CU.estimateRun({ tokens: waiting.tokens, route: 'desktop' });
    const mid = CU.estimateRun({ tokens: waiting.tokens, route: 'nanogpt' });
    const frontier = CU.estimateRun({ tokens: waiting.tokens, route: 'openrouter' });
    assert.ok(local.calls >= 14 && local.calls <= 17, `local ${local.calls}`);
    assert.equal(mid.calls, 9);
    assert.ok(frontier.calls >= 4 && frontier.calls <= 5, `frontier ${frontier.calls}`);
    assert.equal(local.cleanup, 1);
    // cutting at scene boundaries gives the same counts as the estimate, give or take the open scene
    for (const [route, est] of [['desktop', local], ['nanogpt', mid], ['openrouter', frontier]]) {
        const chunks = CU.cutChunks(chat, { key: KEY }, CU.CHUNK[CU.CLASS_OF[route]]);
        assert.ok(Math.abs(chunks.length - est.calls) <= 2, `${route}: ${chunks.length} chunks, estimate ${est.calls}`);
    }
    // a chunk ends at a scene boundary once 80 percent of its target is in
    const cut = CU.cutChunks(chat, { key: KEY }, CU.CHUNK.local);
    const boundaries = cut.slice(0, -1).filter(c => /\* \* \*/.test(c.exchanges.at(-1).prose)).length;
    assert.ok(boundaries >= cut.length - 3, `most chunks end on a scene break: ${boundaries} of ${cut.length - 1}`);
});

// ---------------------------------------------------------------- a whole run

test('catch-up on the desktop files records and chapters in order and adds nothing the second time', async () => {
    const calls = [];
    const t = setup({ calls });
    const plan = await t.runner.start({ mode: 'auto', route: 'desktop', tokens: CU.pending(t.state.chat, { key: KEY }).tokens, count: 300, est: CU.estimateRun({ tokens: CU.pending(t.state.chat, { key: KEY }).tokens, route: 'desktop' }) });
    await t.queue.pump();
    const maps = calls.filter(c => c.job === 'catchUp');
    assert.ok(maps.length >= 14 && maps.length <= 17, `map calls ${maps.length}`);
    assert.equal(t.state.counts.cleanup, 1, 'one Cleanup stage');
    assert.equal(t.state.counts.condensed, 1);
    assert.equal(t.state.counts.index, 1);
    assert.equal(t.runner.plan().state, 'done');
    assert.ok(calls.every(c => c.route === 'desktop'), 'every call ran on the route the tests picked');
    const result = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.equal(new Set(ids(result)).size, ids(result).length, 'no duplicate record id');
    const shipments = result.current.filter(r => /^shipment-/.test(r.id));
    assert.equal(shipments.length, 60, 'one record for every fifth exchange');
    const chapters = result.current.filter(r => r.kind === 'chapter');
    assert.ok(chapters.length >= 20, `${chapters.length} chapters`);
    assert.ok(entriesOf(t.state.chat).concat(t.state.meta.ri_memory.log).every(e => e.origin.type === 'catch-up'), 'every entry names catch-up as its origin');
    // every reply carries a stamp, so capture leaves it alone, and the watermark is the last reply
    assert.ok(t.state.chat.filter(m => !m.is_user).slice(1).every(m => m.extra.ri_memory.capture?.route === 'catch-up'));
    assert.equal(t.state.meta.ri_memory.capture.watermark.reply, 300);
    // chapters follow each other with no gap and no overlap, in story order
    const marks = chapters.map(c => [c.covers[0].mark, c.covers.at(-1).mark]);
    const index = new Map(t.state.chat.map((m, i) => [F.storedMark(m), i]));
    if (process.env.RI_DEBUG) console.log(marks.map(([a, b]) => `${index.get(a)}-${index.get(b)}`).join(' '));
    for (let k = 1; k < marks.length; k++) assert.equal(index.get(marks[k][0]), index.get(marks[k - 1][1]) + 1, `chapter ${k} starts where chapter ${k - 1} ended`);
    // the report register: no mood language in a chapter or a record, outside a stated line
    for (const r of result.current.filter(x => ['chapter', 'fact'].includes(x.kind))) assert.deepEqual(SF.moodHits(r.text), [], r.id);
    // a repeated catch-up has nothing to read and files nothing
    const before = entriesOf(t.state.chat).length + t.state.meta.ri_memory.log.length;
    const again = await t.runner.evaluate({ probe: false });
    assert.equal(again.skipped, 'few');
    assert.equal(CU.pending(t.state.chat, { result: F.fold(t.state.chat, t.state.meta), key: KEY }).count, 0);
    await assert.rejects(() => t.runner.startTapped(), /Nothing waits/);
    assert.equal(entriesOf(t.state.chat).length + t.state.meta.ri_memory.log.length, before);
    assert.equal(plan.kind, 'catch-up');
});

test('every map call after the first sends the stored records as an exclusion list and a digest of the story state', async () => {
    const calls = [];
    const t = setup({ calls, chat: build(80), script: model({ calls, keepOpen: true }) });
    const seen = await t.runner.assess({});
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await t.queue.pump();
    assert.match(calls[0].user, /Stored records[^\n]*\n\(none yet\)/);
    assert.match(calls[0].user, /nothing is on record yet/);
    assert.ok(calls.length >= 2);
    assert.match(calls[1].user, /\| fact \| Shipment \d+ \| Hale counted/, 'the second call lists what the first filed');
    assert.match(calls[1].user, /Scene at the end of the last stretch: place Salt Dock/);
    assert.match(calls[1].user, /\[recorded\]/, 'exchanges of an open scene come back as context');
    // a model that answers with the same records again adds none of them twice
    const repeat = setup({ chat: build(80), script: model({ repeat: true }) });
    await repeat.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await repeat.queue.pump();
    const result = F.fold(repeat.state.chat, repeat.state.meta, { cache: false });
    assert.equal(new Set(ids(result)).size, ids(result).length);
    assert.equal(result.current.filter(r => r.kind === 'fact').length, 16);
});

// ---------------------------------------------------------------- killed mid-way

test('killing the app mid-catch-up and reopening resumes at the next part with no duplicate record', async () => {
    const whole = setup({ calls: [] });
    const seen = await whole.runner.assess({});
    await whole.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await whole.queue.pump();
    const reference = F.fold(whole.state.chat, whole.state.meta, { cache: false });

    // the app stops after five parts; the chat comes back from the last save
    const first = setup({});
    await first.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    first.queue.limit = 5;
    await first.queue.pump();
    assert.equal(first.runner.plan().state, 'running');
    const callsAfter = [];
    const second = restart(first, { calls: callsAfter, script: model({ calls: callsAfter }) });
    assert.equal(second.runner.plan().state, 'running', 'the plan travels with the chat');
    const missing = second.runner.missingWork(second.state.chat, 'mb9-chat');
    assert.equal(missing.length, 1, 'the rebuilder names the next part');
    const out = await second.runner.evaluate({ probe: false });
    assert.equal(out.resumed, true);
    await second.queue.pump();
    assert.equal(second.runner.plan().state, 'done');
    const resumed = F.fold(second.state.chat, second.state.meta, { cache: false });
    assert.equal(new Set(ids(resumed)).size, ids(resumed).length, 'no duplicate id after the restart');
    assert.equal(resumed.current.filter(r => /^shipment-/.test(r.id)).length, 60);
    assert.deepEqual(ids(resumed).sort(), ids(reference).filter(id => !id.startsWith('ch-')).concat(ids(resumed).filter(id => id.startsWith('ch-'))).sort(), 'the same records as an uninterrupted run');
    assert.ok(callsAfter.length < 17, 'the resumed run did not start over');
    assert.ok(callsAfter[0].user.includes('Exchange 1 [new]') || callsAfter[0].user.includes('Exchange 1 [recorded]'));
});

test('a save that fails after the entries were made loses the whole part, and the restart files it once', async () => {
    const first = setup({ chat: build(60), saveFails: 3 });
    const seen = await first.runner.assess({});
    await first.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await assert.rejects(() => first.queue.pump(), /killed before the save/);
    const second = restart(first);
    await second.runner.evaluate({ probe: false });
    await second.queue.pump();
    const result = F.fold(second.state.chat, second.state.meta, { cache: false });
    assert.equal(new Set(ids(result)).size, ids(result).length);
    assert.equal(result.current.filter(r => /^shipment-/.test(r.id)).length, 12);
    assert.equal(CU.pending(second.state.chat, { result, key: F.MEMORY ? KEY : KEY }).count, 0);
});

// ---------------------------------------------------------------- route states

const down = route => ({ ...FACTS, [route]: { ...FACTS[route], reachable: false } });
const choose = (facts, { tokens = 120000, free = true, speeds = {} } = {}) => CU.chooseRoute({ facts, tokens, free, askRoute: 'openrouter', askPrice: { in: 0.0498, out: 0.1992 }, speeds });

test('scripted route states start catch-up on the route 8.1 names, or ask first naming the failed test', () => {
    // desktop up and proven: it runs by itself
    let c = choose(FACTS);
    assert.deepEqual([c.mode, c.route], ['auto', 'desktop']);
    // desktop down: the NanoGPT plan takes it
    c = choose(down('desktop'));
    assert.deepEqual([c.mode, c.route], ['auto', 'nanogpt']);
    // desktop down and the job over 5 percent of the weekly allowance: ask, and name that test
    c = choose(down('desktop'), { tokens: 2900000 });
    assert.equal(c.mode, 'ask');
    assert.match(c.failed[0].text, /Desktop: no valid answer in the last 10 minutes/);
    c = choose({ ...down('desktop'), nanogpt: { ...FACTS.nanogpt, weekly: 2000000 } });
    assert.equal(c.mode, 'ask');
    const nano = c.trials.find(t => t.route === 'nanogpt');
    assert.match(nano.failed.find(f => f.id === 'room').text, /NanoGPT: over 5 percent of this week's allowance/);
    // the allowance test is just under and just over 5 percent
    assert.equal(choose({ nanogpt: FACTS.nanogpt }, { tokens: 2800000 }).trials[0].tests.find(t => t.id === 'room').ok, false, 'a job of 2.8M tokens needs about 3M and fails');
    assert.equal(choose({ nanogpt: FACTS.nanogpt }, { tokens: 2000000 }).trials[0].tests.find(t => t.id === 'room').ok, true);
    // a slow route fails the 30 minute test; the next free route runs it
    c = choose(FACTS, { speeds: { desktop: { perCall: 200 } } });
    assert.deepEqual([c.mode, c.route], ['auto', 'nanogpt']);
    c = choose({ desktop: FACTS.desktop }, { speeds: { desktop: { perCall: 200 } } });
    assert.equal(c.mode, 'ask');
    assert.match(c.failed[0].text, /Desktop: about \d+ minutes, over 30/);
    // a model nobody measured is not proven
    c = choose({ desktop: { ...FACTS.desktop, model: 'qwen3:30b' } });
    assert.match(c.failed[0].text, /has not passed the catch-up bar/);
    // a window under 12,000 tokens does not fit
    c = choose({ desktop: { ...FACTS.desktop, context: 8192 } });
    assert.match(c.failed[0].text, /a context of 8,192 tokens is under 12,000/);
    // the on-phone model: a fast model with a 16,000 window runs only while charging
    const phone = charging => choose({ phone: { found: true, reachable: true, model: 'gemma4:12b', context: 16000 }, charging }, { tokens: 15000, speeds: { phone: { perCall: 120 } } });
    assert.deepEqual([phone(true).mode, phone(true).route], ['auto', 'phone']);
    assert.equal(phone(false).mode, 'ask');
    assert.match(phone(false).failed[0].text, /runs only while the phone is charging/);
    // the measured Gemma 4 E2B writes 6.6 tokens a second and fails for any catch-up past a few exchanges
    assert.equal(choose({ phone: { found: true, reachable: true, model: 'gemma-4-e2b-litert', context: 4096 }, charging: true }).mode, 'ask');
    // the setting is off: it asks even when a free route would pass
    c = choose(FACTS, { free: false });
    assert.equal(c.mode, 'ask');
    assert.match(c.failed[0].text, /Catch up by itself on free routes is off/);
    assert.equal(c.route, 'desktop');
    // no route set up
    c = choose({});
    assert.equal(c.mode, 'ask');
    assert.match(c.failed[0].text, /No free route/);
});

test('the ask card names the route, the call count, the time and the cost', () => {
    const c = choose(down('desktop'), { tokens: 2900000 });
    assert.equal(c.route, 'openrouter');
    assert.ok(c.cost > 0 && c.cost < 5, `cost ${c.cost}`);
    const line = CU.costLine(c.est, { free: false, cost: c.cost, route: c.route });
    assert.match(line, /\d+ model calls and 1 Cleanup call, about \d+ minutes, about US\$\d+\.\d\d on OpenRouter/);
    assert.match(CU.costLine(CU.estimateRun({ tokens: 120000, route: 'desktop' }), { route: 'desktop' }), /free on the desktop$/);
});

test('opening a chat with 20 or more exchanges starts catch-up by itself on a free route that passes, and asks otherwise', async () => {
    const auto = setup({ chat: build(30) });
    const out = await auto.runner.evaluate({ probe: false });
    assert.equal(out.started, true);
    assert.equal(auto.runner.plan().route, 'desktop');
    assert.equal(auto.runner.status().text.startsWith('Catching up on the desktop: part 1 of'), true);
    const few = setup({ chat: build(19) });
    assert.equal((await few.runner.evaluate({})).skipped, 'few');
    assert.equal(few.runner.plan(), null);
    // the Setup switch off: a free route that passes still asks
    const off = setup({ chat: build(30), memory: { catchUpFree: false } });
    const asked = await off.runner.evaluate({});
    assert.equal(asked.asked, true);
    assert.equal(off.runner.plan().state, 'asking');
    assert.match(off.runner.status().text, /Catch up by itself on free routes is off/);
    assert.equal(off.queue.jobs.length, 0, 'nothing was queued');
    // the desktop is down and the plan is over budget: it asks and names the desktop
    const closed = setup({ chat: build(30), facts: down('desktop') });
    assert.equal((await closed.runner.evaluate({})).started, true, 'NanoGPT passes, so it runs there');
    assert.equal(closed.runner.plan().route, 'nanogpt');
    const none = setup({ chat: build(30), facts: { desktop: { ...FACTS.desktop, reachable: false }, charging: null } });
    await none.runner.evaluate({});
    assert.equal(none.runner.plan().state, 'asking');
    assert.match(none.runner.status().text, /Desktop: no valid answer in the last 10 minutes/);
    // the three answers on the card
    await none.runner.waitForDesktop();
    assert.equal(none.runner.plan().state, 'waiting');
    await none.runner.notNow();
    assert.equal(none.runner.plan().state, 'declined');
    assert.equal((await none.runner.evaluate({})).skipped, 'declined');
    await none.runner.runNow();
    assert.equal(none.runner.plan().state, 'running');
    assert.equal(none.runner.plan().mode, 'now');
    assert.equal(none.runner.plan().route, 'openrouter');
});

// ---------------------------------------------------------------- cancel, rebuild, undo

test('cancel stops after the part in hand, keeps what was filed and can be resumed', async () => {
    const t = setup({ chat: build(120) });
    const seen = await t.runner.assess({});
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    t.queue.limit = 2;
    await t.queue.pump();
    const filed = t.runner.plan().filed;
    assert.ok(filed > 0);
    assert.equal(await t.runner.cancel(), true);
    t.queue.limit = Infinity;
    await t.queue.pump();
    assert.equal(t.runner.plan().state, 'cancelled');
    assert.equal(t.runner.plan().filed, filed, 'nothing more was read');
    assert.match(t.runner.status().text, /cancelled after \d+ of 120 exchanges/);
    assert.equal(await t.runner.resume(), true);
    await t.queue.pump();
    assert.equal(t.runner.plan().state, 'done');
    assert.equal(CU.pending(t.state.chat, { result: F.fold(t.state.chat, t.state.meta), key: KEY }).count, 0);
});

test('Rebuild retires every model-made record in one entry, keeps your locked records and edits, and undoes in one tap', async () => {
    const t = setup({ chat: build(60) });
    const seen = await t.runner.assess({});
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await t.queue.pump();
    // you lock one record and write another
    const mine = F.fold(t.state.chat, t.state.meta, { cache: false }).current.find(r => /^shipment-/.test(r.id));
    await t.store.lock([mine.id]);
    await t.store.record([{ op: 'add', record: { id: 'my-note', kind: 'fact', subject: 'My note', text: 'The harbor master is Edda.' }, origin: { type: 'you' }, anchor: null }]);
    const before = F.fold(t.state.chat, t.state.meta, { cache: false }).current.map(r => r.id).sort();
    const calls = [];
    t.deps.runChain = model({ calls });   // the rebuild is scripted afresh
    const rebuilt = CU.createCatchUp({ ...t.deps, runChain: model({ calls }) });
    t.queue.run = (job, options) => rebuilt.run(job, options);
    const plan = await rebuilt.rebuild();
    assert.equal(plan.kind, 'rebuild');
    assert.equal(plan.retired.count > 10, true);
    const retired = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.ok(retired.byId.get(mine.id).status !== 'retired', 'the locked record stays in force');
    assert.ok(retired.byId.get('my-note').status !== 'retired', 'your own record stays in force');
    const retiredEntries = t.state.meta.ri_memory.log.filter(e => e.op === 'retire');
    assert.equal(retiredEntries.length, 1, 'one entry retires them all');
    assert.equal(retiredEntries[0].anchor, null, 'unanchored, so a deleted reply cannot bring them back');
    await t.queue.pump();
    assert.equal(rebuilt.plan().state, 'done');
    assert.ok(calls.length >= 3, 'the rebuild read the chat from its first message');
    assert.match(calls[0].user, /Exchange 1 \[new\]/);
    const after = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.equal(after.current.filter(r => /^shipment-/.test(r.id) && r.id !== mine.id).length > 0, true);
    // one tap undoes the whole rebuild: the earlier records are back and the rebuild's own are retired
    const undone = await rebuilt.undoRebuild();
    assert.equal(undone.undone, true);
    const restored = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.deepEqual(restored.current.filter(r => !r.id.startsWith('ch-')).map(r => r.id).sort(), before.filter(id => !id.startsWith('ch-')), 'the records are as they were before the rebuild');
    assert.ok(restored.byId.get(mine.id).locked, 'the lock survived both');
});

test('what the model returns passes the capture checks and the report register before anything is filed', async () => {
    const t = setup({ chat: build(40), script: model({ mood: true }) });
    const seen = await t.runner.assess({});
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await t.queue.pump();
    const result = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.equal(result.current.filter(r => /^shipment-/.test(r.id)).length, 0, 'records with mood language outside a stated line are dropped');
    for (const chapter of result.current.filter(r => r.kind === 'chapter')) assert.deepEqual(SF.moodHits(chapter.text), [], 'mood sentences are cut out of a chapter before it is filed');
    assert.ok(result.current.filter(r => r.kind === 'chapter').length > 0, 'the rest of each chapter is filed');
    assert.ok(t.runner.plan().dropped > 0);
    assert.equal(CU.stripMood('Hale counted 12 crates. Hale felt terrified. He said "I am afraid".'), 'Hale counted 12 crates. He said "I am afraid".');
});

test('an answer the checks cannot use files nothing for those exchanges and the part retries', async () => {
    let n = 0;
    const flaky = async (chain, options) => {
        n += 1;
        if (n === 1) return { ok: false, reason: 'No route in the chain answered.', waiting: false };
        return model()(chain, options);
    };
    const t = setup({ chat: build(30), script: flaky });
    const seen = await t.runner.assess({});
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens: seen.tokens, count: seen.count, est: seen.decision.est });
    await t.queue.pump();
    assert.equal(t.queue.failures, 1);
    assert.equal(t.runner.plan().state, 'done');
});

test('the tapped catch-up uses the Run now chain only when no free route passes, inside the ceiling', async () => {
    const free = setup({ chat: build(30) });
    assert.equal((await free.runner.startTapped()).route, 'desktop');
    assert.equal(free.runner.plan().mode, 'tapped');
    const none = setup({ chat: build(30), facts: { desktop: { ...FACTS.desktop, reachable: false }, charging: null } });
    const plan = await none.runner.startTapped();
    assert.equal(plan.mode, 'now');
    assert.equal(plan.route, 'openrouter');
    await none.queue.pump();
    assert.equal(none.runner.plan().state, 'done');
});

test('the setting key is the one Setup, Memory writes and the runner reads', () => {
    const t = setup({ memory: {} });
    assert.equal(t.deps.memorySettings().catchUpFree !== false, true, 'on when the key is absent');
    const c = CU.chooseRoute({ facts: FACTS, tokens: 100000, free: t.deps.memorySettings().catchUpFree !== false });
    assert.equal(c.mode, 'auto');
});

test('a 300-exchange chat catches up within M1f\'s call estimate on a mid route and on a frontier route, plus one Cleanup call', async () => {
    for (const [route, low, high] of [['nanogpt', 8, 10], ['openrouter', 4, 6]]) {
        const calls = [];
        const t = setup({ calls });
        const tokens = CU.pending(t.state.chat, { key: KEY }).tokens;
        await t.runner.start({ mode: 'now', route, tokens, count: 300, est: CU.estimateRun({ tokens, route }) });
        await t.queue.pump();
        const maps = calls.filter(c => c.route === route);
        assert.ok(maps.length >= low && maps.length <= high, `${route}: ${maps.length} map calls`);
        assert.equal(t.state.counts.cleanup, 1);
        assert.equal(t.runner.plan().state, 'done');
    }
});

test('a scene left open at the end of every part still finishes with a bounded number of calls', async () => {
    const calls = [];
    const t = setup({ calls, script: model({ calls, keepOpen: true }) });
    const tokens = CU.pending(t.state.chat, { key: KEY }).tokens;
    await t.runner.start({ mode: 'auto', route: 'desktop', tokens, count: 300, est: CU.estimateRun({ tokens, route: 'desktop' }) });
    await t.queue.pump();
    assert.equal(t.runner.plan().state, 'done');
    assert.ok(calls.length <= 32, `${calls.length} map calls with every last scene left open`);
    const result = F.fold(t.state.chat, t.state.meta, { cache: false });
    assert.equal(result.current.filter(r => r.kind === 'fact').length, 60);
});
