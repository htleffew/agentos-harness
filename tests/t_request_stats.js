// B62: request stats per job and per day. Run with: node --test tests/t_request_stats.js
//   1. runChain records one entry per request on a local, a plan, a free, a paid and the Main API route; reported usage
//      wins over the estimate; a request that failed still counts; a paid entry carries its cost.
//   2. The direct paths count too: meterCall (a Fixed Main API or Connection Profile), the judgment call's desktop and
//      on-phone items, the Jev decisions endpoint and the desktop warm-up.
//   3. The store keeps 31 days and a capped list of entries; the daily totals, the 7-day job summary and Clear.
// A fake host sends through a recording OpenAI-compatible mock, as t_spend_ceiling.js does. No real model is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

const KEY = 'roleplay_instructions';
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
            res.end(JSON.stringify({ error: { message: `status ${plan.status}` } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: '{"facts":["The gate is open."]}' }, finish_reason: 'stop' }],
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
const MAIN_ANSWER = '{"facts":["The lamp is lit."]}';
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    generateRaw: async () => MAIN_ANSWER,
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
globalThis.toastr = { warning() {}, info() {}, error() {} };

let decisionPlan = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) === '/api/backends/chat-completions/status') return new Response(JSON.stringify({ data: [{ id: 'gemma4:12b' }] }));
    if (String(url) === 'https://openrouter.ai/api/alpha/decisions') return new Response(JSON.stringify(decisionPlan || {}), { status: 200 });
    return realFetch(url, init);
};

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const routing = await import('../src/routing.js');
const spend = await import('../src/spend.js');
const stats = await import('../src/request-stats.js');
const decide = await import('../src/memory/decide.js');
const queueMod = await import('../src/memory/queue.js');
const view = await import('../src/ui/connections-spend.js');
const { runChain, meterCall, resetRouteHealth, registerPhoneModel } = routing;

const schema = { name: 'capture', value: { type: 'object', required: ['facts'], properties: { facts: { type: 'array', items: { type: 'string' } } } } };
const DAY = 24 * 60 * 60 * 1000;
const PRICE = { in: 100, out: 100 };
function reset() {
    requests.length = 0;
    replies.clear();
    decisionPlan = null;
    resetRouteHealth();
    spend.resetSpendReservations();
    decide.resetJudgmentHealth();
    registerPhoneModel(null);
    host.extensionSettings[KEY] = {};
    host.chatCompletionSettings = { chat_completion_source: 'openrouter', custom_include_body: '' };
    view.resetSpendView();
}
const entries = () => stats.requestEntries();

// ---------------------------------------------------------------- 1. route chains

test('each route a chain sends to adds one entry: local, plan, free, paid and the Main API', async () => {
    reset();
    const user = 'The gate creaks open.';
    for (const step of [{ route: 'desktop', model: 'gemma4:12b' }, { route: 'nanogpt', model: 'plan-model' }, { route: 'openrouterFree', model: 'free-model' },
        { route: 'openrouter', model: 'paid-model', price: PRICE }, { route: 'main' }]) {
        const run = await runChain([step], { job: 'capture', user, schema, tokens: 50 });
        assert.equal(run.ok, true, `${step.route} answered`);
    }
    const list = entries();
    assert.deepEqual(list.map(e => e.r), ['desktop', 'nanogpt', 'openrouterFree', 'openrouter', 'main']);
    assert.ok(list.every(e => e.j === 'capture'), 'every entry names its job');
    // Usage from the response wins over the estimate: 1000 and 100 tokens, though the prompt is a few dozen characters.
    for (const e of list.slice(0, 4)) {
        assert.equal(e.i, 1000, `${e.r} reads its reported tokens in`);
        assert.equal(e.o, 100, `${e.r} reads its reported tokens out`);
        assert.equal(e.e, undefined, `${e.r} is not marked estimated`);
    }
    // Only the paid route carries a cost: catalog price for 1000 in and 100 out at US$100 per million each.
    assert.deepEqual(list.map(e => e.c || 0), [0, 0, 0, 0.11, 0]);
    assert.equal(spend.spendState().routes.openrouter.calls, 1, 'the paid request is on the meter as well');
    // The Main API reports no usage: the counts are estimated from the text and marked.
    const main = list[4];
    assert.equal(main.e, 1);
    assert.ok(main.i > 0 && main.i < 1000, `tokens in estimated from the prompt: ${main.i}`);
    assert.equal(main.o, Math.ceil(MAIN_ANSWER.length / 4));
    const [today] = stats.dailyStats();
    assert.equal(today.requests, 5);
    assert.equal(today.usd, 0.11);
    assert.equal(today.estimated, 1);
});

test('a request that failed still counts, marked failed, and the next route adds its own entry', async () => {
    reset();
    replies.set('broken', { status: 500 });
    const run = await runChain([{ route: 'nanogpt', model: 'broken' }, { route: 'openrouterFree', model: 'free-model' }], { job: 'chapter', user: 'x', schema });
    assert.equal(run.ok, true);
    const list = entries();
    assert.equal(list.length, 2);
    assert.equal(list[0].f, 1, 'the failed request is marked');
    assert.equal(list[0].o, 0);
    assert.equal(list[1].f, undefined);
    assert.ok(list.every(e => e.j === 'chapter'));
});

test('a skipped route sends nothing and adds no entry', async () => {
    reset();
    spend.setSpendLimits({ ceiling: 0 });
    const run = await runChain([{ route: 'openrouter', model: 'paid-model', price: PRICE }], { job: 'capture', user: 'x', schema });
    assert.equal(run.waiting, true);
    assert.equal(entries().length, 0);
    assert.equal(requests.length, 0);
});

test('a repair request is a second entry', async () => {
    reset();
    let n = 0;
    host.generateRaw = async () => (++n === 1 ? 'not json' : MAIN_ANSWER);
    try {
        const run = await runChain([{ route: 'main' }], { job: 'tidy', user: 'x', schema });
        assert.equal(run.ok, true);
        assert.equal(entries().length, 2);
    } finally { host.generateRaw = async () => MAIN_ANSWER; }
});

test('statJob names a function of Setup, Connections in place of its chain job', async () => {
    reset();
    await runChain([{ route: 'openrouterFree', model: 'free-model' }], { job: 'carryOver', statJob: 'writerGoal', user: 'x' });
    assert.equal(entries()[0].j, 'writerGoal');
    assert.equal(view.statJobName('writerGoal'), 'Draft a character goal');
    assert.equal(view.statJobName('capture'), 'Capture');
    assert.equal(view.statJobName('help'), 'Help question');
    assert.equal(view.statJobName('warmUp'), 'Desktop warm-up');
});

// ---------------------------------------------------------------- 2. direct paths

test('meterCall counts a free and a paid direct call, with the estimate from the prompt length', async () => {
    reset();
    await meterCall({ cost: 'free', route: 'main', job: 'carryOver', statJob: 'bookKeywords', chars: 400 }, async () => ({ text: 'abcd'.repeat(5), raw: 'abcd'.repeat(5) }));
    await meterCall({ cost: 'paid', route: 'override', job: 'carryOver', statJob: 'newChapter', chars: 40 },
        async () => ({ text: 'ok', raw: 'ok', cost: 0.02, usage: { prompt_tokens: 300, completion_tokens: 30 } }));
    await assert.rejects(meterCall({ cost: 'free', route: 'main', job: 'carryOver', chars: 8 }, async () => { throw new Error('down'); }));
    const [free, paid, failed] = entries();
    assert.deepEqual([free.j, free.i, free.o, free.e, free.c], ['bookKeywords', 100, 5, 1, undefined]);
    assert.deepEqual([paid.j, paid.i, paid.o, paid.e, paid.c], ['newChapter', 300, 30, undefined, 0.02]);
    assert.deepEqual([failed.j, failed.f, failed.i], ['carryOver', 1, 2]);
});

test('judgment calls count each request: the desktop, each on-phone item and the Jev decisions endpoint', async () => {
    reset();
    await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); },
        phoneReady: async () => true, phoneAsk: async (question, options) => (/yes or no/.test(question) ? 'yes' : options[2]), jev: async () => ({ skipped: 'off' }) });
    const phone = entries().filter(e => e.r === 'phone');
    assert.ok(phone.length >= 2, `one entry per one-word item: ${phone.length}`);
    assert.ok(phone.every(e => e.j === 'judgment' && e.e === 1));
    // The desktop route through the real askFull: one entry with the reported usage.
    reset();
    await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane: fn => fn(), phoneReady: async () => false, jev: async () => ({ skipped: 'off' }) }).catch(() => {});
    const desk = entries().filter(e => e.r === 'desktop');
    assert.equal(desk.length, 1);
    assert.deepEqual([desk[0].j, desk[0].i, desk[0].o], ['judgment', 1000, 100]);
    // The Jev decisions endpoint, with the cost it reports.
    reset();
    decide.setJevKey('sk-or-FAKE-not-a-real-key-0000');
    decisionPlan = { answers: { attempt: 'yes', stat: 'Agility', difficulty: 'Hard', stance: 'resisting' }, usage: { input_tokens: 120, output_tokens: 6, cost: 0.00002 } };
    await decide.judgeDice({ message: 'I try to climb the wall.' }, { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false });
    const jev = entries().filter(e => e.m === 'typesafe/jev-1.13');
    assert.equal(jev.length, 1);
    assert.deepEqual([jev[0].j, jev[0].r, jev[0].i, jev[0].o, jev[0].c], ['judgment', 'openrouter', 120, 6, 0.00002]);
    decide.setJevKey('');
});

test('the desktop warm-up is one entry', async () => {
    reset();
    assert.equal(await queueMod.warmDesktop('gemma4:12b'), true);
    const [warm] = entries();
    assert.deepEqual([warm.j, warm.r, warm.m], ['warmUp', 'desktop', 'gemma4:12b']);
});

// ---------------------------------------------------------------- 3. the store

test('entries and days older than 31 days are dropped', () => {
    reset();
    const now = new Date(2026, 10, 27, 12).getTime();
    stats.recordRequest({ job: 'capture', usage: { in: 10, out: 1 } }, now - 40 * DAY);
    stats.recordRequest({ job: 'capture', usage: { in: 10, out: 1 } }, now - 30 * DAY);
    stats.recordRequest({ job: 'capture', usage: { in: 10, out: 1 } }, now);
    const days = stats.dailyStats(now).map(row => row.day);
    assert.deepEqual(days, [stats.dayOf(now), stats.dayOf(now - 30 * DAY)], 'today first, the 40-day-old day gone');
    assert.equal(stats.requestEntries(now).length, 2);
    assert.equal(stats.dailyStats(now + 2 * DAY).length, 1, 'the 30-day-old day leaves as time passes');
});

test('the cap holds: full entries stop at MAX_ENTRIES while the daily totals keep counting', () => {
    reset();
    const now = new Date(2026, 10, 27, 12).getTime();
    for (let i = 0; i < stats.MAX_ENTRIES + 50; i++) stats.recordRequest({ job: i % 2 ? 'capture' : 'judgment', usage: { in: 100, out: 10 } }, now + i);
    assert.equal(stats.requestEntries(now + 1000).length, stats.MAX_ENTRIES);
    const [today] = stats.dailyStats(now + 1000);
    assert.equal(today.requests, stats.MAX_ENTRIES + 50);
    assert.deepEqual(today.jobs.map(j => j.job), ['capture', 'judgment']);
    const size = JSON.stringify(host.extensionSettings[KEY].requestStats).length;
    assert.ok(size < 80000, `the stored stats stay small: ${size} characters`);
});

test('the 7-day job summary gives requests per day and the median request size', () => {
    reset();
    const now = new Date(2026, 10, 27, 12).getTime();
    for (const [age, tin] of [[0, 100], [1, 300], [2, 200], [8, 9000]]) stats.recordRequest({ job: 'capture', usage: { in: tin, out: 0 } }, now - age * DAY);
    for (let i = 0; i < 14; i++) stats.recordRequest({ job: 'judgment', inChars: 40, outChars: 4 }, now - (i % 7) * DAY);
    const week = stats.weeklyJobStats(now);
    assert.deepEqual(week.map(j => j.job), ['judgment', 'capture']);
    const capture = week.find(j => j.job === 'capture');
    assert.equal(capture.requests, 3, 'the 8-day-old request is outside the week');
    assert.equal(capture.medianTokens, 200);
    assert.equal(capture.perDay, 0.4);
    const judgment = week.find(j => j.job === 'judgment');
    assert.equal(judgment.perDay, 2);
    assert.equal(judgment.medianTokens, 11);
    assert.equal(view.dayName(stats.dayOf(now), now), 'Today');
    assert.equal(view.dayName(stats.dayOf(now - DAY), now), 'Yesterday');
});

test('Clear empties the stats and leaves the spend meter alone', async () => {
    reset();
    await runChain([{ route: 'openrouter', model: 'paid-model', price: PRICE }], { job: 'capture', user: 'x', schema });
    let heard = 0;
    const stop = stats.onRequestStats(() => { heard += 1; });
    stats.clearRequestStats();
    stop();
    assert.equal(heard, 1);
    assert.equal(stats.dailyStats().length, 0);
    assert.equal(entries().length, 0);
    assert.equal(spend.spendState().routes.openrouter.calls, 1);
});

test('a stats problem never stops a request', async () => {
    reset();
    host.extensionSettings[KEY].requestStats = { days: { broken: null }, entries: 'not a list' };
    const run = await runChain([{ route: 'openrouterFree', model: 'free-model' }], { job: 'capture', user: 'x', schema });
    assert.equal(run.ok, true);
    assert.equal(stats.dailyStats()[0].requests, 1, 'the damaged day is dropped and the new entry counts');
});
