// B19: the background spend ceiling, route notices and the Jev step. Run with: node --test tests/t_spend_ceiling.js
// A fake host sends through a recording OpenAI-compatible mock (as t_routing.js does). The price table below is the
// fixture: each model's reply reports the cost its entry's price would charge for the 1000 and 100 tokens it returns.
// The API key in these tests is an obvious fake and is checked to stay out of every log, note and toast.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';

const KEY = 'roleplay_instructions';
const FAKE_KEY = 'sk-or-FAKE-not-a-real-key-0000';
const requests = [];
const replies = new Map();
const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
        const body = JSON.parse(data || '{}');
        requests.push({ url: req.url, body });
        const plan = replies.get(body.model) || {};
        if (plan.status) {
            res.writeHead(plan.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: plan.message || `status ${plan.status}` } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: plan.content ?? '{"facts":["The gate is open."]}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => server.close());

async function generate(data, extractData, signal) {
    const url = data.chat_completion_source === 'custom' ? data.custom_url : base;
    const response = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: data.messages, model: data.model, max_tokens: data.max_tokens }), signal });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(String(json.error?.message || 'Response not OK'));
    return extractData ? { content: json.choices[0].message.content, reasoning: '' } : json;
}

const profiles = [
    { id: 'p-desktop', name: 'Desktop local', api: 'custom', model: 'gemma4:12b', 'api-url': base, preset: '' },
    { id: 'p-nano', name: 'NanoGPT', api: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash', preset: '' },
    { id: 'p-or', name: 'OpenRouter', api: 'openrouter', model: 'z-ai/glm-5.3-flash', preset: '' },
];
const toasts = [];
const rawCalls = [];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    generateRaw: async args => { rawCalls.push(args); return '{"facts":["The gate is open."]}'; },
    ChatCompletionService: { processRequest: (data, options, extractData, signal) => generate(data, extractData, signal) },
    ConnectionManagerRequestService: {
        getSupportedProfiles: () => profiles,
        async sendRequest(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
            const profile = profiles.find(p => p.id === profileId);
            return generate({ stream: false, messages: prompt, max_tokens: maxTokens, model: profile.model, chat_completion_source: profile.api,
                custom_url: profile['api-url'], ...overridePayload }, custom.extractData !== false, custom.signal);
        },
    },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning: text => toasts.push(text), info() {}, error() {} };

// The probe endpoint and OpenRouter's decisions endpoint are answered here; everything else goes to the mock.
let probeUp = true;
let probes = 0;
const decisionCalls = [];
let decisionPlan = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) === '/api/backends/chat-completions/status') {
        probes += 1;
        return probeUp ? new Response(JSON.stringify({ data: [{ id: 'gemma4:12b' }] })) : new Response(JSON.stringify({ error: true }));
    }
    if (String(url) === 'https://openrouter.ai/api/alpha/decisions') {
        decisionCalls.push({ headers: Object.fromEntries(Object.entries(init.headers)), body: JSON.parse(init.body) });
        const plan = decisionPlan || {};
        if (plan.throws) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify(plan.body || {}), { status: plan.status || 200 });
    }
    return realFetch(url, init);
};

// dom.js prepares a canvas at load; a stub document lets the UI module load without a page (as tests/unit/composer_bar.mjs does).
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const routing = await import('../src/routing.js');
const spend = await import('../src/spend.js');
const decide = await import('../src/memory/decide.js');
const queueMod = await import('../src/memory/queue.js');
const logMod = await import('../src/log.js');
const view = await import('../src/ui/connections-spend.js');
const { runChain, chainFor, resetRouteHealth, registerPhoneModel, JOBS, ROUTES, RECOMMENDED_CHAINS } = routing;

const schema = { name: 'capture', value: { type: 'object', required: ['facts'], properties: { facts: { type: 'array', items: { type: 'string' } } } } };
const MIN = 60 * 1000;
function reset() {
    requests.length = 0;
    rawCalls.length = 0;
    replies.clear();
    toasts.length = 0;
    probeUp = true;
    probes = 0;
    decisionCalls.length = 0;
    decisionPlan = null;
    resetRouteHealth();
    spend.resetSpendReservations();
    decide.resetJudgmentHealth();
    registerPhoneModel(null);
    host.extensionSettings[KEY] = {};
    host.chatCompletionSettings = { chat_completion_source: 'openrouter', custom_include_body: '' };
    view.resetSpendView();
}
const noNano = () => profiles.splice(profiles.findIndex(p => p.id === 'p-nano'), 1);
const restoreNano = saved => profiles.splice(1, 0, ...saved);

// ---- The ceiling ----

test('the ceiling defaults to US$5 with the warning at US$4 and can be changed', () => {
    reset();
    const state = spend.spendState();
    assert.equal(state.ceiling, 5);
    assert.equal(state.warning, 4);
    assert.equal(spend.DEFAULT_CEILING, 5);
    assert.equal(spend.DEFAULT_WARNING, 4);
    const after = spend.setSpendLimits({ ceiling: 8, warning: 6 });
    assert.deepEqual([after.ceiling, after.warning], [8, 6]);
    assert.equal(host.extensionSettings[KEY].spend.ceiling, 8, 'saved in the extension settings');
});

// The price table is the fixture. A call to a model costs in * 1000 + out * 100 per million tokens.
const PRICES = { 'paid-a': { in: 100, out: 100 }, 'paid-b': { in: 200, out: 0 } };
const priceOf = model => (PRICES[model].in * 1000 + PRICES[model].out * 100) / 1e6;

test('a mocked price table fills the meter, warns once, pauses paid jobs at the ceiling and lets free routes carry on', async () => {
    reset();
    spend.setSpendLimits({ ceiling: 0.5, warning: 0.4 });
    const paid = [{ route: 'openrouter', model: 'paid-a', price: PRICES['paid-a'] }];
    assert.equal(priceOf('paid-a'), 0.11);
    // Four calls at 0.11 reach 0.44: past the warning, under the ceiling.
    for (let i = 0; i < 4; i++) assert.equal((await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 })).ok, true);
    let state = spend.spendState();
    assert.equal(state.total, 0.44);
    assert.equal(state.routes.openrouter.calls, 4);
    assert.equal(toasts.length, 1, 'one warning toast');
    let notes = view.activeNotes();
    assert.deepEqual(notes.map(n => n.kind), ['warning']);
    assert.match(notes[0].text, /US\$0\.44 of US\$0\.50 used this month/);
    // Spend lists the route, its calls and its cost.
    const row = view.spendRows().find(r => r.id === 'openrouter');
    assert.equal(row.calls, 4);
    assert.equal(row.usd, 0.44);
    assert.equal(view.summaryLine(), 'US$0.44 of US$0.50 used, US$0.06 left, 4 calls');
    // The fifth call still fits under the ceiling; the sixth is paused.
    await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 });
    state = spend.spendState();
    assert.ok(state.total >= 0.5, 'the ceiling is reached');
    assert.equal(toasts.length, 1, 'the warning shows once per month');
    assert.deepEqual(view.activeNotes().map(n => n.kind).sort(), ['ceiling', 'warning']);
    const before = requests.length;
    const blocked = await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.waiting, true);
    assert.match(blocked.reason, /^Paused, monthly ceiling reached/);
    assert.equal(requests.length, before, 'no paid request past the ceiling');
    // A free route in the same chain still answers.
    const mixed = await runChain([{ route: 'desktop', model: 'gemma4:12b' }, ...paid], { job: 'capture', user: 'x', schema });
    assert.equal(mixed.ok, true);
    assert.equal(mixed.route, 'desktop');
    // The queue shows each paused job with its words.
    const q = queueMod.createQueue({ store: queueMod.memoryStore(), timers: false, resident: ['paid-a'],
        handlers: { capture: { run: async () => { const r = await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 }); return { ok: r.ok, route: r.route, waiting: r.waiting, reason: r.reason }; }, commit: async () => {} } } });
    await q.enqueue({ chatId: 'c', kind: 'capture', subject: '1', sources: { a: '1' } });
    await q.pump();
    const paused = view.pausedJobs(q.jobs());
    assert.equal(paused.length, 1);
    assert.equal(paused[0].text, 'Paused, monthly ceiling reached');
    assert.equal(paused[0].label, 'Capture');
    // Raising the ceiling lets a paid job run again.
    spend.setSpendLimits({ ceiling: 5 });
    assert.equal((await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 })).ok, true);
});

test('the warning and the ceiling reach the notes once a month, and the meter resets on the first', async () => {
    reset();
    spend.setSpendLimits({ ceiling: 0.3, warning: 0.2 });
    const paid = [{ route: 'openrouter', model: 'paid-b', price: PRICES['paid-b'] }];
    for (let i = 0; i < 3; i++) await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 });
    assert.equal(view.activeNotes().filter(n => n.kind === 'warning').length, 1);
    assert.equal(toasts.length, 1);
    assert.equal(view.dismissNote(view.activeNotes().find(n => n.kind === 'warning').id), true);
    assert.equal(view.activeNotes().some(n => n.kind === 'warning'), false, 'dismissed');
    await runChain(paid, { job: 'capture', user: 'x', schema, tokens: 10 });
    assert.equal(view.activeNotes().some(n => n.kind === 'warning'), false, 'a dismissed warning does not return in the same month');
    const next = new Date(); next.setMonth(next.getMonth() + 1, 1);
    assert.equal(spend.spendState(next.getTime()).total, 0);
    assert.equal(view.summaryLine(next.getTime()), 'US$0.00 of US$0.30 used, US$0.30 left, 0 calls');
    assert.deepEqual(view.activeNotes(next.getTime()), [], 'the month notes go with the month');
});

test('Spend shows calls and cost per route, with free and local routes counted at no cost', async () => {
    reset();
    replies.set('gemma4:12b', {});
    for (let i = 0; i < 3; i++) await runChain([{ route: 'desktop', model: 'gemma4:12b' }], { job: 'capture', user: 'x', schema });
    await runChain([{ route: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash' }], { job: 'capture', user: 'x', schema });
    await runChain([{ route: 'openrouter', model: 'paid-a', price: PRICES['paid-a'] }], { job: 'capture', user: 'x', schema, tokens: 10 });
    const rows = Object.fromEntries(view.spendRows().map(r => [r.id, r]));
    assert.equal(rows.desktop.calls, 3);
    assert.equal(rows.desktop.usd, 0);
    assert.equal(rows.desktop.kind, 'Local');
    assert.equal(rows.nanogpt.calls, 1);
    assert.equal(rows.nanogpt.kind, 'Plan');
    assert.equal(rows.openrouter.calls, 1);
    assert.equal(rows.openrouter.usd, 0.11);
    assert.deepEqual(['desktop', 'phone', 'nanogpt', 'openrouterFree', 'googleFree', 'openrouter', 'main'].map(id => Boolean(rows[id])), Array(7).fill(true));
    assert.equal(view.summaryLine(), 'US$0.11 of US$5.00 used, US$4.89 left, 5 calls');
    // Health: the route in use, and its last answer.
    assert.equal(rows.openrouter.inUse, true);
    assert.ok(rows.desktop.lastAnswered > 0);
});

test('every background job runs free and local routes ahead of paid ones', () => {
    reset();
    const rank = { local: 0, plan: 1, free: 2, paid: 3, main: 4 };
    for (const job of Object.keys(JOBS)) {
        const chain = chainFor(job).filter(entry => entry.route !== 'phone');
        const costs = chain.map(entry => rank[ROUTES[entry.route].cost]);
        assert.deepEqual(costs, [...costs].sort((a, b) => a - b), `${job} tries the cheapest route first`);
    }
    for (const [job, chain] of Object.entries(RECOMMENDED_CHAINS)) {
        const firstPaid = chain.findIndex(entry => ROUTES[entry.route].cost === 'paid');
        const lastFree = chain.map(entry => ['local', 'plan', 'free'].includes(ROUTES[entry.route].cost)).lastIndexOf(true);
        if (firstPaid >= 0) assert.ok(lastFree < firstPaid, `${job} has no free or local route after a paid one`);
    }
});

test('chat replies through the main connection never count toward the ceiling', async () => {
    reset();
    spend.setSpendLimits({ ceiling: 0.01, warning: 0.005 });
    const { askFull } = await import('../src/st.js');
    const reply = await askFull({ user: 'The reply the chat model writes.', tokens: 100 });
    assert.ok(reply.text !== undefined);
    assert.equal(spend.spendState().total, 0, 'a main-connection request is not metered');
    // A tapped action through a paid main connection is outside the ceiling; the same job in the background is not.
    const tapped = await runChain([{ route: 'main' }], { job: 'capture', user: 'x', schema, background: false });
    assert.equal(tapped.ok, true);
    assert.equal(spend.spendState().routes.main, undefined, 'a tapped call is not metered');
    assert.deepEqual(view.activeNotes(), [], 'and raises no note');
    const background = await runChain([{ route: 'main' }], { job: 'capture', user: 'x', schema });
    assert.equal(background.ok, true);
    assert.equal(spend.spendState().routes.main.calls, 1, 'a background call on a paid main connection is metered');
});

// ---- The route notices ----

const chainOf = () => chainFor('capture');

test('a fallback shows one note per outage, checks the route only when a job needs it, and a back note follows', async () => {
    reset();
    const saved = [];
    probeUp = false;
    let t = 1_000_000;
    const run = async () => runChain(chainOf(), { job: 'capture', user: 'x', schema, clock: () => t });
    // Outage one: the desktop does not answer its 4 s probe, the NanoGPT plan takes the job.
    const first = await run();
    assert.equal(first.route, 'nanogpt');
    assert.equal(probes, 1);
    let notes = view.activeNotes();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'fallback');
    assert.equal(notes[0].text, 'Desktop unreachable; background jobs on NanoGPT');
    assert.equal(notes[0].paid, false);
    // The same outage shows nothing more, and the desktop is not probed again inside 10 minutes.
    t += 3 * MIN;
    await run();
    assert.equal(probes, 1, 'no second probe inside 10 minutes');
    assert.equal(view.activeNotes().length, 1, 'the same outage shows the note once');
    // She dismisses it. Ten minutes on, one more probe happens because a job needs the route; the outage is the same.
    assert.equal(view.dismissNote(notes[0].id), true);
    t += 11 * MIN;
    await run();
    assert.equal(probes, 2, 'at most one check per 10 minutes while the route is down');
    assert.deepEqual(view.activeNotes(), [], 'a dismissed note does not return for the same outage');
    // With no job, nothing asks the desktop: waiting 40 minutes costs no probe.
    t += 40 * MIN;
    assert.equal(probes, 2, 'no polling');
    // The desktop returns: a "back" note shows once.
    probeUp = true;
    const back = await run();
    assert.equal(back.route, 'desktop');
    notes = view.activeNotes();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, 'back');
    assert.equal(notes[0].text, 'Desktop back; background jobs on the desktop again');
    await run();
    assert.equal(view.activeNotes().length, 1, 'the back note shows once');
    assert.equal(view.dismissNote(notes[0].id), true);
    await run();
    assert.deepEqual(view.activeNotes(), [], 'a dismissed back note does not return');
    // Outage two shows the fallback again; the desktop returning clears it and shows the back note in its place.
    probeUp = false;
    t += 30 * MIN;
    await run();
    notes = view.activeNotes();
    assert.deepEqual(notes.map(n => n.kind), ['fallback'], 'a new outage shows a new note');
    probeUp = true;
    t += 30 * MIN;
    await run();
    assert.deepEqual(view.activeNotes().map(n => n.kind), ['back'], 'the outage note clears itself and the back note shows');
    void saved;
});

test('a fallback to a paid route says so', async () => {
    reset();
    probeUp = false;
    const nano = noNano();
    try {
        replies.set('inclusionai/ling-3.2-flash:free', { status: 429 });
        replies.set('deepseek/deepseek-v4.1-flash', { content: '{"facts":[]}' });
        const run = await runChain(chainOf(), { job: 'capture', user: 'x', schema });
        assert.equal(run.route, 'openrouter');
        const [note] = view.activeNotes();
        assert.equal(note.kind, 'fallback');
        assert.equal(note.paid, true);
        assert.equal(note.text, 'Desktop unreachable; background jobs on OpenRouter (paid, within your US$5.00 monthly ceiling)');
    } finally { restoreNano(nano); }
});

test('a tapped action that runs elsewhere raises no note, and a job that fails everywhere shows none until one runs', async () => {
    reset();
    probeUp = false;
    await runChain(chainOf(), { job: 'capture', user: 'x', schema, background: false });
    assert.deepEqual(view.activeNotes(), []);
    replies.set('deepseek/deepseek-v4.1-flash', { status: 503 });
    const failed = await runChain([{ route: 'desktop' }, { route: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash' }], { job: 'capture', user: 'x', schema });
    assert.equal(failed.ok, false);
    assert.deepEqual(view.activeNotes(), [], 'no job ran elsewhere, so there is nothing to say yet');
    const rows = Object.fromEntries(view.spendRows().map(r => [r.id, r]));
    assert.ok(rows.desktop.lastFailure > 0, 'the failure is on the route health');
});

test('Spend lists each route\'s last answer, last failure with its reason, and the route in use', async () => {
    reset();
    probeUp = false;
    await runChain(chainOf(), { job: 'capture', user: 'x', schema });
    const rows = Object.fromEntries(view.spendRows().map(r => [r.id, r]));
    assert.ok(rows.desktop.lastFailure > 0);
    assert.match(rows.desktop.failureReason, /no answer to the 4 s probe/);
    assert.ok(rows.desktop.downUntil > Date.now(), 'skipped until a time');
    assert.equal(rows.desktop.inUse, false);
    assert.equal(rows.nanogpt.inUse, true);
    assert.ok(rows.nanogpt.lastAnswered > 0);
});

test('the judgment route reports a desktop that did not answer, and the on-phone model takes the fallback note', async () => {
    reset();
    const answer = { attempt: true, actor: 'user', stat: 'Agility', difficulty: 'Hard', stance: 'neutral' };
    const run = await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); },
        phoneReady: async () => true, phoneAsk: async (question, options) => (/yes or no/.test(question) ? 'yes' : options[2]), jev: async () => ({ skipped: 'off' }) });
    assert.equal(run.route, 'phone');
    const [note] = view.activeNotes();
    assert.equal(note.kind, 'fallback');
    assert.equal(note.text, 'Desktop unreachable; background jobs on the on-phone model');
    void answer;
});

test('the module asks nothing on its own: no timers, no polling, and one source of probes', () => {
    const source = fs.readFileSync(new URL('../src/ui/connections-spend.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /setInterval|setTimeout|requestIdleCallback/);
    assert.doesNotMatch(source, /probeCustomUrl|fetch\(/);
});

// ---- The Jev step ----

const diceAnswers = {
    answers: {
        attempt: { noul: 0.93 }, stat: { choice: 'Agility', confidence: 0.9 }, difficulty: { choice: 'Hard', confidence: 0.8 }, stance: { choice: 'resisting', confidence: 0.7 },
    },
    usage: { input_tokens: 420, output_tokens: 0, cost: 0.000018 },
};
const routerAnswer = { attempt: true, actor: 'user', stat: 'Wits', difficulty: 'Fair', stance: 'neutral' };
const downDeps = extra => ({ lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false, ...extra });

test('with her key saved, the Jev step calls jev-1.13 on OpenRouter\'s decisions endpoint and meters it', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    assert.equal(decide.hasJevKey(), true);
    decisionPlan = { body: diceAnswers };
    const res = await decide.judgeDice({ message: 'I try to climb the wall.', scene: 'A courtyard at dusk.' }, downDeps());
    assert.equal(res.route, 'jev');
    assert.equal(res.model, 'typesafe/jev-1.13');
    assert.deepEqual(res.value, { attempt: true, actor: 'user', stat: 'Agility', difficulty: 'Hard', stance: 'resisting' });
    assert.equal(decisionCalls.length, 1);
    const call = decisionCalls[0];
    assert.equal(call.headers.Authorization, `Bearer ${FAKE_KEY}`, 'the key is sent to OpenRouter');
    assert.equal(call.body.model, 'typesafe/jev-1.13');
    assert.equal(call.body.state.message, 'I try to climb the wall.');
    assert.deepEqual(Object.keys(call.body.questions), ['attempt', 'stat', 'difficulty', 'stance']);
    assert.equal(call.body.questions.attempt.type, 'noul');
    assert.equal(call.body.questions.stat.type, 'choice');
    assert.deepEqual(Object.keys(call.body.questions.difficulty.criteria), ['Easy', 'Fair', 'Hard', 'Very hard', 'Extreme']);
    assert.equal(requests.length, 0, 'nothing went through SillyTavern\'s connection');
    const state = spend.spendState();
    assert.equal(state.routes.openrouter.calls, 1, 'counted toward the ceiling');
    assert.equal(state.calls[0].model, 'typesafe/jev-1.13');
    assert.equal(state.calls[0].usd, 0.000018);
    assert.equal(state.calls[0].job, 'judgment');
});

test('the Jev step reads the aside question as a noul answer', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    decisionPlan = { body: { answers: { aside: { noul: 0.88 } }, usage: { input_tokens: 100, output_tokens: 0 } } };
    const aside = await decide.judge(decide.ASIDE, { message: 'Quick question for you, outside the story.' }, downDeps());
    assert.deepEqual([aside.route, aside.value], ['jev', { aside: true }]);
    assert.equal(spend.spendState().calls[0].basis, 'catalog', 'with no cost reported the catalog price is used');
    assert.equal(spend.spendState().calls[0].usd, 0.000004);
});

test('when jev-1.13 fails, the Jev step falls back to jev-router through her saved connection', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    replies.set('typesafe/jev-router', { content: JSON.stringify(routerAnswer) });
    for (const plan of [{ status: 500, body: { error: { message: `upstream failed for ${FAKE_KEY}` } } }, { throws: true }, { body: { answers: {} } }]) {
        decisionPlan = plan;
        decisionCalls.length = 0;
        requests.length = 0;
        const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
        assert.equal(res.route, 'jev');
        assert.equal(res.model, 'typesafe/jev-router', 'the router answered');
        assert.equal(decisionCalls.length, 1, 'jev-1.13 was tried first');
        assert.equal(requests.length, 1, 'then one request through the saved OpenRouter connection');
        const tried = res.attempts.find(a => a.route === 'jev-1.13');
        assert.equal(tried.outcome, 'failed');
        assert.ok(!JSON.stringify(res.attempts).includes(FAKE_KEY), 'the failure text holds no key');
    }
});

test('when jev-1.13 and the router both fail, both attempts are listed and code answers', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    decisionPlan = { status: 503, body: { error: { message: 'unavailable' } } };
    replies.set('typesafe/jev-router', { status: 503 });
    const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    assert.equal(res.route, 'code');
    assert.deepEqual(res.attempts.filter(a => a.route.startsWith('jev')).map(a => `${a.route}:${a.outcome}`), ['jev-1.13:failed', 'jev:failed']);
    assert.equal(spend.spendState().total, 0, 'the failed decision call is released, not charged');
});

test('with no key saved, the Jev step goes straight to jev-router and the endpoint is never called', async () => {
    reset();
    assert.equal(decide.hasJevKey(), false);
    replies.set('typesafe/jev-router', { content: JSON.stringify(routerAnswer) });
    const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    assert.equal(res.model, 'typesafe/jev-router');
    assert.equal(decisionCalls.length, 0);
    assert.ok(!res.attempts.some(a => a.route === 'jev-1.13'));
});

test('at the ceiling the Jev step sends nothing to OpenRouter', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    spend.setSpendLimits({ ceiling: 0, warning: 0 });
    decisionPlan = { body: diceAnswers };
    const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    assert.equal(res.route, 'code');
    assert.equal(decisionCalls.length, 0);
    assert.equal(requests.length, 0);
});

test('the key is stored only in the extension settings and appears in no log, note, toast or receipt', async () => {
    reset();
    decide.setJevKey(FAKE_KEY);
    decisionPlan = { status: 500, body: { error: { message: `bad key ${FAKE_KEY}` } } };
    replies.set('typesafe/jev-router', { content: JSON.stringify(routerAnswer) });
    const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    spend.setSpendLimits({ ceiling: 0.00001, warning: 0.000005 });
    await decide.judgeDice({ message: 'I try to climb the wall again.' }, downDeps());
    const settings = host.extensionSettings[KEY];
    assert.equal(settings.jev.key, FAKE_KEY, 'saved in the extension settings');
    const elsewhere = JSON.stringify({ ...settings, jev: undefined });
    assert.ok(!elsewhere.includes(FAKE_KEY), 'nowhere else in the settings');
    assert.ok(!JSON.stringify(logMod.logEntries()).includes(FAKE_KEY), 'not in the request log');
    assert.ok(!JSON.stringify(res).includes(FAKE_KEY), 'not in the result');
    assert.ok(!toasts.join('\n').includes(FAKE_KEY), 'not in a toast');
    assert.ok(!JSON.stringify(view.activeNotes()).includes(FAKE_KEY), 'not in a note');
    assert.ok(!JSON.stringify(requests).includes(FAKE_KEY), 'not sent through the saved connection');
    assert.equal(decide.setJevKey(''), false, 'Remove key clears it');
    assert.equal(host.extensionSettings[KEY].jev.key, undefined);
});

test('the Jev step sends the key to OpenRouter only', () => {
    const source = fs.readFileSync(new URL('../src/memory/decide.js', import.meta.url), 'utf8');
    assert.equal((source.match(/Authorization/g) || []).length, 1, 'one place builds the header');
    assert.match(source, /JEV_ENDPOINT = 'https:\/\/openrouter\.ai\//);
    assert.doesNotMatch(source, /console\.(log|warn|error)/);
    const ui = fs.readFileSync(new URL('../src/ui/connections-spend.js', import.meta.url), 'utf8');
    assert.doesNotMatch(ui, /console\.log|jevKey\(\)/, 'the page never reads the saved key back');
});
