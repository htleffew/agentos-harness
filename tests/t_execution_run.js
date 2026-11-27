// B38: the run walks resolveChain. Run with: node --test tests/t_execution_run.js
// Automatic falls down the chain, Fixed sends only to its pick, fall back continues, and the ceiling skips paid routes.
// The fake host is the one of t_routing.js (a recording OpenAI-compatible mock behind SillyTavern 1.19 request shapes).
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

const { request } = await import('../src/ai.js');
const { runOperationChain } = await import('../src/execution.js');
const NANO_MODEL = 'deepseek/deepseek-v4.1-flash';
const OR_MODEL = 'z-ai/glm-5.3-flash';
const models = () => requests.map(item => item.body.model);
const ask = (authorization = 'manual') => request({ operation: 'instructionCheck', authorization, what: 'Check that it happened', user: 'Did the gate open?', tokens: 50 });
const ceilingReached = () => { host.extensionSettings[KEY].spend = { month: spend.monthOf(), total: 5, ceiling: 5, warning: 4, warned: true, routes: {}, calls: [] }; };

test('Automatic with the desktop down falls to the next route and How it ran names it', async () => {
    reset();
    probeUp = false;
    const result = await ask();
    assert.equal(result.receipt.outcome, 'completed');
    assert.deepEqual(models(), [NANO_MODEL], 'the desktop is never called; the NanoGPT plan answers');
    assert.match(result.receipt.observedRoute, /^Backup: NanoGPT/);
    assert.match(result.receipt.observedRoute, new RegExp(NANO_MODEL));
    assert.ok(result.receipt.chainLog.some(line => /skipped|no answer/.test(line) || /answered/.test(line)));
    assert.match(result.receipt.chainLog[0], /Desktop over Tailscale.*no answer to the 4 s probe/);
});

test('Automatic with the desktop up answers on the desktop', async () => {
    reset();
    const result = await ask();
    assert.deepEqual(models(), ['gemma4:12b']);
    assert.match(result.receipt.observedRoute, /^Tailscale: Desktop over Tailscale/);
});

test('Fixed with fall back off fails visibly and sends only to the pick', async () => {
    reset();
    setExecutionSetting('instructionCheck', { mode: 'fixed', profileId: 'p-or' });
    replies.set(OR_MODEL, { status: 500, message: 'provider overloaded' });
    await assert.rejects(ask(), error => /provider overloaded/.test(error.message) && error.receipt.outcome === 'failed' && /provider overloaded/.test(error.receipt.result));
    assert.deepEqual(models(), [OR_MODEL], 'no desktop or other route is tried');
    replies.clear();
});

test('Fixed with fall back on continues down the chain after the pick', async () => {
    reset();
    setExecutionSetting('instructionCheck', { mode: 'fixed', profileId: 'p-or', fallback: true });
    replies.set(OR_MODEL, { status: 500, message: 'provider overloaded' });
    const result = await ask();
    assert.deepEqual(models(), [OR_MODEL, 'gemma4:12b'], 'her pick first, then the desktop at the head of the chain');
    assert.match(result.receipt.observedRoute, /^Tailscale: Desktop over Tailscale/);
    replies.clear();
});

test('a paid route is skipped at the ceiling, for a Fixed pick and for Automatic', async () => {
    reset();
    ceilingReached();
    setExecutionSetting('instructionCheck', { mode: 'fixed', profileId: 'p-or' });
    await assert.rejects(ask('automatic'), error => /monthly spend ceiling/.test(error.message));
    assert.equal(requests.length, 0, 'the paid pick is not called');
    // Automatic, desktop and plan down: the paid routes and the paid Main API are skipped and the job waits.
    reset();
    ceilingReached();
    probeUp = false;
    replies.set(NANO_MODEL, { status: 500, message: 'plan unavailable' });
    replies.set('inclusionai/ling-3.2-flash:free', { status: 429, message: 'rate limited' });
    // B59: a tap reads the ceiling line alone; the same check run automatically reads the paused line.
    await assert.rejects(ask(), error => error.message === spend.CEILING_LINE);
    assert.deepEqual(models(), [NANO_MODEL, 'inclusionai/ling-3.2-flash:free'], 'only the plan and free routes were tried');
    resetRouteHealth();
    setExecutionSetting('instructionCheck', { automatic: true });
    await assert.rejects(ask('automatic'), error => /Paused, monthly ceiling reached/.test(error.message));
    replies.clear();
});

test('the Writer queue job follows a connection fixed for the chapter summary', async () => {
    reset();
    setExecutionSetting('chapterSummary', { mode: 'fixed', profileId: 'p-or' });
    const run = await runOperationChain('chapterSummary', { user: 'x', schema });
    assert.equal(run.ok, true);
    assert.deepEqual(models(), [OR_MODEL]);
});
