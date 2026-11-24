// MB1: background transport, route chains and the spend meter. Run with: node --test tests/t_routing.js
// The fake host below sends through a recording OpenAI-compatible mock over HTTP. Its request service follows
// SillyTavern 1.19 (public/scripts/extensions/shared.js sendRequest, custom-request.js createRequestData) and its
// server step follows src/endpoints/backends/chat-completions.js for the custom, nanogpt and openrouter sources, so the
// recorded body is what a provider receives.
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
        if (plan.hang) return;
        const send = () => {
            if (plan.status) {
                res.writeHead(plan.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: plan.message || `status ${plan.status}` } }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            const message = plan.tool ? { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'commit_memory_ops', arguments: plan.tool } }] }
                : { role: 'assistant', content: plan.content ?? '{"facts":["The gate is open."]}' };
            res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: plan.finish || 'stop' }],
                usage: { prompt_tokens: 1000, completion_tokens: 100, ...(plan.cost !== undefined ? { cost: plan.cost } : {}) } }));
        };
        if (plan.delayMs) setTimeout(send, plan.delayMs); else send();
    });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/v1`;
test.after(() => server.close());

// SillyTavern's server step for the three sources the chains use.
const NANOGPT_MAP = { min: 'none', low: 'minimal', medium: 'low', high: 'medium', max: 'high' };
const yamlLines = text => Object.fromEntries(String(text || '').split('\n').filter(l => l.includes(':')).map(l => {
    const at = l.indexOf(':');
    return [l.slice(0, at).trim(), l.slice(at + 1).trim()];
}));
function serverBody(data) {
    const source = data.chat_completion_source;
    let bodyParams = {};
    let url = base;
    if (source === 'openrouter') {
        bodyParams = { reasoning: { exclude: !data.include_reasoning } };
        if (data.reasoning_effort) bodyParams.reasoning.effort = data.reasoning_effort;
    } else if (source === 'custom') {
        url = data.custom_url;
        Object.assign(bodyParams, yamlLines(data.custom_include_body));
    } else if (source === 'nanogpt') {
        if (data.reasoning_effort) bodyParams.reasoning = { effort: NANOGPT_MAP[data.reasoning_effort] };
    }
    if (Array.isArray(data.tools) && data.tools.length) { bodyParams.tools = data.tools; bodyParams.tool_choice = data.tool_choice; }
    if (data.json_schema) bodyParams.response_format = { type: 'json_schema', json_schema: { name: data.json_schema.name, strict: data.json_schema.strict ?? true, schema: data.json_schema.value } };
    return { url, body: { messages: data.messages, model: data.model, max_tokens: data.max_tokens, stream: data.stream, ...bodyParams } };
}
async function generate(data, extractData, signal) {
    const { url, body } = serverBody(data);
    const response = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    const json = await response.json();
    if (!response.ok || json.error) throw new Error(String(json.error?.message || 'Response not OK'));
    if (!extractData) return json;
    return { content: json.choices[0].message.content, reasoning: '' };
}

const profiles = [
    { id: 'p-desktop', name: 'Desktop local', api: 'custom', model: 'gemma4:12b', 'api-url': base, preset: 'Background', 'secret-id': 'never-read' },
    { id: 'p-nano', name: 'NanoGPT', api: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash', preset: '' },
    { id: 'p-or', name: 'OpenRouter', api: 'openrouter', model: 'z-ai/glm-5.3-flash', preset: '' },
    { id: 'p-alt', name: 'Alternate', api: 'openrouter', model: 'alt-model', preset: '' },
];
const presets = { Background: { custom_include_body: 'temperature: 0.2\nreasoning_effort: low' } };
const rawCalls = [];
let rawAnswers = [];
const toasts = [];
let probeUp = true;
let probeHang = false;
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: name => presets[name] }),
    generateRaw: async args => { rawCalls.push(structuredClone(args)); return rawAnswers.shift() ?? ''; },
    ChatCompletionService: { processRequest: (data, options, extractData, signal) => generate({ use_sysprompt: true, ...data }, extractData, signal) },
    ConnectionManagerRequestService: {
        getSupportedProfiles: () => profiles,
        async sendRequest(profileId, prompt, maxTokens, custom = {}, overridePayload = {}) {
            const profile = profiles.find(p => p.id === profileId);
            // includePreset copies the preset's Additional Parameters into the payload before the override is spread.
            const fromPreset = custom.includePreset && presets[profile.preset] ? { custom_include_body: presets[profile.preset].custom_include_body } : {};
            return generate({ stream: false, messages: prompt, max_tokens: maxTokens, model: profile.model, chat_completion_source: profile.api,
                custom_url: profile['api-url'], ...fromPreset, ...overridePayload }, custom.extractData !== false, custom.signal);
        },
    },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning: text => toasts.push(text), info() {}, error() {} };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) === '/api/backends/chat-completions/status') {
        if (probeHang) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
        return probeUp ? new Response(JSON.stringify({ data: [{ id: 'gemma4:12b' }] })) : new Response(JSON.stringify({ error: true }));
    }
    return realFetch(url, init);
};

const { askFull } = await import('../src/st.js');
const routing = await import('../src/routing.js');
const spend = await import('../src/spend.js');
const { resolveChain, setExecutionSetting } = await import('../src/execution.js');
const { runChain, runJob, chainFor, RECOMMENDED_CHAINS, ROUTES, resetRouteHealth, registerPhoneModel, setRouteBinding, DOWN_MS, PROBE_MS } = routing;

const schema = { name: 'capture', value: { type: 'object', required: ['facts'], properties: { facts: { type: 'array', items: { type: 'string' } } } } };
const last = () => requests.at(-1).body;
function reset() {
    requests.length = 0;
    rawCalls.length = 0;
    rawAnswers = [];
    replies.clear();
    toasts.length = 0;
    probeUp = true;
    probeHang = false;
    resetRouteHealth();
    spend.resetSpendReservations();
    host.extensionSettings[KEY] = {};
    host.chatCompletionSettings = { chat_completion_source: 'openrouter', custom_include_body: '' };
    registerPhoneModel(null);
}

test('a Custom (OpenAI-compatible) profile sends response_format with the schema and reasoning_effort none', async () => {
    reset();
    const res = await askFull({ system: 'File the changes.', user: 'The gate opens.', tokens: 300, profileId: 'p-desktop', model: 'gemma4:12b', schema, effort: 'none' });
    const body = last();
    assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'capture', strict: true, schema: schema.value } });
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.temperature, '0.2', 'the other Additional Parameters of the profile stay as written');
    assert.equal(body.model, 'gemma4:12b');
    assert.deepEqual(JSON.parse(res.text), { facts: ['The gate is open.'] });
    assert.equal(res.usage.prompt_tokens, 1000);
});

test('NanoGPT and OpenRouter carry the schema or one forced tool, and the effort per tier', async () => {
    reset();
    const efforts = { quick: 'none', writer: 'low', cleanup: 'high' };
    for (const [tier, effort] of Object.entries(efforts)) {
        await askFull({ user: 'x', profileId: 'p-nano', model: 'deepseek/deepseek-v4.1-flash', schema, effort });
        assert.equal(last().reasoning.effort, effort, `NanoGPT receives ${effort} for ${tier}`);
        assert.deepEqual(last().response_format.json_schema.schema, schema.value);
        await askFull({ user: 'x', profileId: 'p-or', model: 'deepseek/deepseek-v4.1-flash', schema, effort });
        assert.equal(last().reasoning.effort, effort, `OpenRouter receives ${effort} for ${tier}`);
        assert.equal(last().reasoning.exclude, true);
    }
    replies.set('z-ai/glm-5.3-flash', { tool: '{"facts":["A tool answer."]}' });
    const res = await askFull({ user: 'x', profileId: 'p-or', model: 'z-ai/glm-5.3-flash', schema, mode: 'tool', toolName: 'commit_memory_ops', effort: 'none' });
    assert.equal(last().response_format, undefined);
    assert.equal(last().tools.length, 1);
    assert.deepEqual(last().tools[0].function.parameters, schema.value);
    assert.deepEqual(last().tool_choice, { type: 'function', function: { name: 'commit_memory_ops' } });
    assert.deepEqual(JSON.parse(res.text), { facts: ['A tool answer.'] });
    // In a chain, an entry whose catalog lists tools and no schema support is sent the forced tool.
    reset();
    replies.set('tool-only', { tool: '{"facts":["Through the chain."]}' });
    const run = await runChain([{ route: 'openrouterFree', model: 'tool-only', caps: { schema: false, tools: true } }], { job: 'capture', user: 'x', schema });
    assert.equal(run.ok, true);
    assert.equal(last().tool_choice.function.name, 'commit_memory_ops');
    assert.equal(last().reasoning.effort, 'none', 'the Quick tier asks for no reasoning');
});

test('the Main API states the schema in the prompt and sends one repair with the error', async () => {
    reset();
    rawAnswers = ['The facts are: the gate is open.', '{"facts":["The gate is open."]}'];
    const run = await runChain([{ route: 'main' }], { job: 'capture', system: 'File the changes.', user: 'The gate opens.', schema });
    assert.equal(run.ok, true);
    assert.deepEqual(run.value, { facts: ['The gate is open.'] });
    assert.equal(rawCalls.length, 2);
    assert.match(rawCalls[0].systemPrompt, /JSON schema/);
    assert.match(rawCalls[0].systemPrompt, /"required":\["facts"\]/);
    assert.match(rawCalls[1].prompt[0].content, /Your previous answer:\nThe facts are: the gate is open\./);
    assert.match(rawCalls[1].prompt[0].content, /The answer held no JSON\./);
    reset();
    rawAnswers = ['{"facts":"one"}', '{"facts":"still one"}'];
    const failed = await runChain([{ route: 'main' }], { job: 'capture', user: 'x', schema });
    assert.equal(failed.ok, false);
    assert.equal(rawCalls.length, 2, 'one repair only');
    assert.match(rawCalls[1].prompt[0].content, /answer\.facts should be array/);
    assert.equal(failed.attempts[0].outcome, 'invalid');
});

test('a dead desktop passes the job on within 4 s and stays skipped for 10 minutes', async () => {
    reset();
    probeHang = true;
    assert.equal(PROBE_MS, 4000);
    let now = 1_000_000;
    const clock = () => now + (Date.now() - started);
    const started = Date.now();
    const chain = chainFor('capture');
    const run = await runChain(chain, { job: 'capture', user: 'The gate opens.', schema, clock });
    const elapsed = Date.now() - started;
    assert.equal(run.ok, true);
    assert.equal(run.route, 'nanogpt');
    assert.ok(elapsed < 4600, `moved on after ${elapsed} ms`);
    assert.equal(run.attempts[0].outcome, 'down');
    assert.match(run.attempts[0].receipt, /^Attempt 1 of 5: Desktop over Tailscale/);
    assert.match(run.attempts[1].receipt, /^Attempt 2 of 5: NanoGPT plan \(deepseek\/deepseek-v4\.1-flash\) answered/);
    // Within 10 minutes the desktop is skipped without a probe; after them it is tried again.
    probeHang = false;
    probeUp = true;
    const again = await runChain(chain, { job: 'capture', user: 'x', schema, clock });
    assert.match(again.attempts[0].receipt, /skipped, down until/);
    assert.equal(again.route, 'nanogpt');
    now += DOWN_MS + 1000;
    const later = await runChain(chain, { job: 'capture', user: 'x', schema, clock });
    assert.equal(later.route, 'desktop');
    assert.equal(later.attempts.length, 1);
});

test('a timed-out or failed route passes the job on; refusal and rate limit pass it on too', async () => {
    reset();
    replies.set('slow', { delayMs: 3000 });
    replies.set('limited', { status: 429, message: 'Rate limit exceeded: free-models-per-day' });
    replies.set('refusing', { content: '', finish: 'content_filter' });
    const chain = [
        { route: 'openrouterFree', model: 'slow', timeoutMs: 300 },
        { route: 'openrouterFree', model: 'limited', profileId: 'p-alt' },
        { route: 'googleFree', model: 'refusing', profileId: 'p-alt' },
        { route: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash' },
    ];
    const run = await runChain(chain, { job: 'capture', user: 'x', schema });
    assert.deepEqual(run.attempts.map(a => a.outcome), ['timeout', 'rate-limit', 'refusal', 'completed']);
    assert.ok(run.attempts[0].ms < 1500);
    assert.equal(run.route, 'nanogpt');
    assert.ok(run.attempts.every((a, i) => a.receipt.startsWith(`Attempt ${i + 1} of 4`)));
    const health = routing.routeHealth();
    assert.equal(health['openrouterFree:p-alt'].down, true, 'a rate-limited free tier is skipped for 10 minutes');
    assert.equal(health['openrouterFree:p-or'].down, true, 'a timed-out route is skipped for 10 minutes');
    assert.equal(health['googleFree:p-alt']?.down ?? false, false, 'a refusal leaves the route up');
});

test('paid spend is metered: a warning at US$4 once, and paid entries skipped at US$5 while jobs wait', async () => {
    reset();
    replies.set('priced', { cost: 1.5 });
    replies.set('catalog-priced', {});
    const paid = [{ route: 'openrouter', model: 'priced', price: { in: 100, out: 100 } }];
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await runChain(paid, { job: 'capture', user: 'x', schema }));
    assert.ok(runs.every(r => r.ok));
    let state = spend.spendState();
    assert.equal(state.total, 4.5);
    assert.equal(state.routes.openrouter.calls, 3);
    assert.equal(state.calls[0].basis, 'usage');
    assert.equal(toasts.length, 1, 'one warning');
    assert.match(toasts[0], /US\$4\.50 of the US\$5\.00 ceiling/);
    const fourth = await runChain(paid, { job: 'capture', user: 'x', schema });
    assert.equal(fourth.ok, true, 'US$4.50 plus the estimate fits under US$5 only when the estimate is small');
    state = spend.spendState();
    assert.ok(state.total >= 5);
    assert.equal(toasts.length, 1, 'the warning shows once per month');
    const blocked = await runChain(paid, { job: 'capture', user: 'x', schema });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.waiting, true);
    assert.match(blocked.attempts[0].receipt, /skipped, the monthly spend ceiling is reached/);
    // A tapped action stays outside the ceiling and is not metered.
    const tapped = await runChain(paid, { job: 'capture', user: 'x', schema, background: false });
    assert.equal(tapped.ok, true);
    assert.equal(spend.spendState().routes.openrouter.calls, 4);
    // The meter resets on the first of the month.
    const next = new Date(); next.setMonth(next.getMonth() + 1, 1);
    assert.equal(spend.spendState(next.getTime()).total, 0);
    // Without a reported cost the catalog price is used.
    reset();
    await runChain([{ route: 'openrouter', model: 'catalog-priced', price: { in: 0.10, out: 0.50 } }], { job: 'capture', user: 'x', schema });
    state = spend.spendState();
    assert.equal(state.calls[0].basis, 'catalog');
    assert.equal(state.total, 0.00015);
});

test('a paid call that times out is counted at its reservation', async () => {
    reset();
    replies.set('hung', { hang: true });
    const run = await runChain([{ route: 'openrouter', model: 'hung', timeoutMs: 200, price: { in: 1, out: 1 } }], { job: 'capture', user: 'x'.repeat(400), tokens: 1000, schema });
    assert.equal(run.ok, false);
    assert.equal(run.attempts[0].outcome, 'timeout');
    const state = spend.spendState();
    assert.equal(state.calls[0].basis, 'reserved');
    assert.equal(state.total, 0.0011);
});

test('chains put the desktop, the NanoGPT plan and free tiers ahead of paid routes', () => {
    reset();
    const rank = { local: 0, plan: 1, free: 2, paid: 3, main: 4 };
    for (const [job, chain] of Object.entries(RECOMMENDED_CHAINS)) {
        // The on-phone model sits outside the order: writing jobs skip it and judgment calls end on it.
        const costs = chain.filter(entry => entry.route !== 'phone').map(entry => rank[ROUTES[entry.route].cost]);
        assert.deepEqual(costs, [...costs].sort((a, b) => a - b), `${job} runs cheapest first`);
        assert.equal(chain[0].route, 'desktop', `${job} starts on the desktop`);
    }
    assert.deepEqual(chainFor('capture').map(e => e.route), ['desktop', 'nanogpt', 'openrouterFree', 'openrouter', 'main']);
    assert.ok(chainFor('chapter').some(e => e.route === 'googleFree'));
    assert.ok(chainFor('capture').some(e => e.route === 'openrouterFree' && /:free$/.test(e.model)));
    assert.deepEqual(chainFor('statSheets'), chainFor('capture'));
});

test('with the desktop down and the ceiling reached, capture ends on a free route or waits', async () => {
    reset();
    host.extensionSettings[KEY].spend = { month: spend.monthOf(), total: 5, ceiling: 5, warning: 4, warned: true, routes: {}, calls: [] };
    probeUp = false;
    replies.set('deepseek/deepseek-v4.1-flash', { status: 503, message: 'NanoGPT is unavailable' });
    const onFree = await runChain(chainFor('capture'), { job: 'capture', user: 'x', schema });
    assert.equal(onFree.ok, true);
    assert.equal(onFree.route, 'openrouterFree');
    reset();
    host.extensionSettings[KEY].spend = { month: spend.monthOf(), total: 5, ceiling: 5, warning: 4, warned: true, routes: {}, calls: [] };
    host.chatCompletionSettings = { chat_completion_source: 'openrouter' };
    probeUp = false;
    replies.set('deepseek/deepseek-v4.1-flash', { status: 503 });
    replies.set('inclusionai/ling-3.2-flash:free', { status: 429 });
    const waits = await runChain(chainFor('capture'), { job: 'capture', user: 'x', schema });
    assert.equal(waits.ok, false);
    assert.equal(waits.waiting, true);
    assert.match(waits.reason, /Paused, monthly ceiling reached/);
    assert.deepEqual(waits.attempts.map(a => a.outcome), ['down', 'down', 'rate-limit', 'skipped', 'skipped']);
    assert.equal(rawCalls.length, 0, 'the Main API on a paid provider is skipped at the ceiling too');
    assert.equal(requests.some(r => r.body.model === 'deepseek/deepseek-v4.1-flash' && r.body.reasoning?.exclude !== undefined), false, 'no paid OpenRouter call');
});

test('the on-phone model takes judgment calls and is skipped for writing jobs', async () => {
    reset();
    const phone = [];
    registerPhoneModel(async request => { phone.push(request); return { text: '{"facts":[]}', value: { facts: [] } }; });
    probeUp = false;
    const judged = await runJob('judgment', { user: 'Does Mira try to pick the lock?', schema });
    assert.equal(judged.route, 'phone');
    assert.equal(phone.length, 1);
    const writing = await runChain([{ route: 'phone', model: 'gemma-4-e2b-litert' }, { route: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash' }], { job: 'catchUp', user: 'x', schema });
    assert.equal(writing.route, 'nanogpt');
    assert.match(writing.attempts[0].receipt, /skipped, the on-phone model takes judgment calls only/);
    assert.equal(phone.length, 1);
    assert.ok(RECOMMENDED_CHAINS.catchUp.some(e => e.route === 'phone'));
    // Without the downloaded model the route is unavailable and skipped.
    registerPhoneModel(null);
    resetRouteHealth();
    probeUp = false;
    const none = await runJob('judgment', { user: 'x', schema });
    assert.equal(none.ok, false);
    assert.match(none.attempts[1].receipt, /no connection on this host carries this route/);
});

test('saved per-operation profiles keep routing their operation', async () => {
    reset();
    setExecutionSetting('chapterSummary', { profileId: 'p-alt' });
    assert.deepEqual(resolveChain('chapterSummary'), [{ route: 'override', profileId: 'p-alt' }], 'a saved profile overrides the tier chain');
    assert.deepEqual(resolveChain('chapterCombine').map(e => e.route), chainFor('storySoFar').map(e => e.route));
    const run = await runChain(resolveChain('chapterSummary'), { job: 'chapter', user: 'x', schema });
    assert.equal(run.ok, true);
    assert.equal(last().model, 'alt-model', 'the profile model is used when the entry names none');
    assert.match(run.attempts[0].receipt, /^Attempt 1 of 1: Saved connection profile/);
    // The tier chains apply from the first run with no approval step; the older shared profile routes only the
    // functions that have no tier chain.
    reset();
    host.extensionSettings[KEY].profileId = 'p-nano';
    assert.equal(resolveChain('historyCatchUp')[0].route, 'desktop');
    assert.equal(host.extensionSettings[KEY].routing?.accepted, undefined, 'no acceptance flag is read or written');
    assert.deepEqual(resolveChain('automaticSwipe'), [{ route: 'main' }]);
});

test('routes are detected with no user action, and her Gemma-over-Tailscale profile is the desktop', async () => {
    reset();
    const extra = [
        { id: 'p-lan', name: 'Home LAN', api: 'custom', model: 'qwen3.5:9b', 'api-url': 'http://10.0.0.100:11434/v1', preset: '' },
        { id: 'p-gemma-ts', name: 'Gemma over Tailscale', api: 'custom', model: 'gemma4:12b', 'api-url': 'http://100.97.15.107:11434/v1', preset: '' },
        { id: 'p-cloud', name: 'Cloud custom', api: 'custom', model: 'x', 'api-url': 'https://api.example.com/v1', preset: '' },
    ];
    profiles.unshift(...extra);
    try {
        const found = routing.detectRoutes();
        assert.equal(found.desktop.profileId, 'p-gemma-ts', 'the tailnet profile with the resident model wins');
        assert.equal(found.desktop.detected, true);
        assert.equal(found.nanogpt.profileId, 'p-nano');
        assert.equal(found.openrouter.profileId, 'p-or');
        assert.equal(found.main.kind, 'main');
        assert.equal(found.phone, undefined, 'no phone route until the model is registered');
        registerPhoneModel(async () => ({ text: '{}' }));
        assert.equal(routing.detectRoutes().phone.kind, 'phone');
        assert.equal(routing.resolveRoute({ route: 'desktop' }).profileId, 'p-gemma-ts');
        assert.equal(host.extensionSettings[KEY].routing?.routes?.desktop, undefined, 'detection saves no binding; nothing waits for approval');
        // A binding set by hand still wins.
        setRouteBinding('desktop', { profileId: 'p-lan' });
        assert.equal(routing.resolveRoute({ route: 'desktop' }).profileId, 'p-lan');
    } finally { profiles.splice(0, extra.length); }
});

test('a paid entry runs only when no free route answered, and within the ceiling', async () => {
    reset();
    replies.set('gemma4:12b', { status: 503 });
    replies.set('deepseek/deepseek-v4.1-flash', { content: '{"facts":[]}' });
    const free = await runJob('capture', { user: 'x', schema });
    assert.equal(free.route, 'nanogpt', 'the plan answers and nothing paid is sent');
    assert.equal(spend.spendState().total, 0);
    reset();
    replies.set('gemma4:12b', { status: 503 });
    replies.set('inclusionai/ling-3.2-flash:free', { status: 429 });
    const nano = profiles.splice(profiles.findIndex(p => p.id === 'p-nano'), 1);
    try {
        const paid = await runJob('capture', { user: 'x', schema });
        assert.equal(paid.route, 'openrouter');
        assert.ok(spend.spendState().total > 0, 'the paid call is metered');
        reset();
        replies.set('gemma4:12b', { status: 503 });
        replies.set('inclusionai/ling-3.2-flash:free', { status: 429 });
        spend.setSpendLimits({ ceiling: 0 });
        const stopped = await runJob('capture', { user: 'x', schema });
        assert.ok(!requests.some(r => r.body.model === 'deepseek/deepseek-v4.1-flash'), 'no paid request past the ceiling');
        assert.ok(stopped.attempts.some(a => /ceiling/.test(a.receipt)));
    } finally { profiles.splice(1, 0, ...nano); }
});

test('route bindings: a saved key with no profile becomes a direct route', async () => {
    reset();
    const saved = profiles.splice(1, 1);
    try {
        assert.equal(routing.resolveRoute({ route: 'nanogpt' }), null);
        setRouteBinding('nanogpt', { direct: true });
        assert.deepEqual(routing.resolveRoute({ route: 'nanogpt' }), { kind: 'direct', source: 'nanogpt' });
        const run = await runChain([{ route: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash' }], { job: 'tidy', user: 'x', schema });
        assert.equal(run.ok, true);
        assert.equal(last().reasoning.effort, 'high', 'the Cleanup tier asks for high effort');
    } finally { profiles.splice(1, 0, ...saved); }
});

test('the extension stores and logs no key values', async () => {
    reset();
    await runChain(chainFor('capture'), { job: 'capture', user: 'x', schema });
    const { logEntries } = await import('../src/log.js');
    const stored = JSON.stringify([host.extensionSettings[KEY].routing, host.extensionSettings[KEY].spend, logEntries()]);
    assert.ok(logEntries().length > 0);
    assert.doesNotMatch(stored, /never-read|secret-id|api_key|Bearer/i);
});
