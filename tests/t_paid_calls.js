// B59: every paid call counts toward the monthly ceiling, tapped or not. Run with: node --test tests/t_paid_calls.js
//   1. The call site inventory: every place in src/ that can send a model call is listed below with how it meets the
//      ceiling. The test counts each send primitive per file, so a new call site (or a call moved to another file) fails
//      until it is listed here with its check.
//   2. runChain meters a tapped paid step as it meters a background one; at the ceiling a tap reads CEILING_LINE and
//      sends nothing, and a free route later in the chain still answers.
//   3. The four tapped buttons her ruling names (Write a chapter now, Close the chapter here, Write the synopsis and start,
//      Draft entries) and a Fixed Main API or Connection Profile sent directly: refused at the ceiling with no paid request,
//      and each adds its cost below it.
// A fake host sends through a recording OpenAI-compatible mock, as t_routing.js does. No real model is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'roleplay_instructions';

// ---------------------------------------------------------------- 1. the call site inventory

// Each send primitive, counted per file. Comment lines are left out, so a comment never counts as a call.
const PRIMITIVES = {
    askFull: /(?<!function )\baskFull\(/g,                  // st.js transport: a profile, a saved key or the Main API
    runChain: /(?<!function )\brunChain\(/g,                // routing.js chain runner
    runJob: /\brunJob\b/g,                                  // routing.js chain runner by job (references, since stat-sheets passes it on)
    runOperationChain: /(?<!function )\brunOperationChain\(/g, // execution.js: a function's chain from Setup, Connections
    aiRequest: /(?<!function )\brequest\(\{/g,             // ai.js request(): every function of Setup, Connections
    runAdditional: /(?<!function )\brunAdditional\(/g,      // execution.js: an authorized call with a receipt
    sendRequest: /\.sendRequest\(/g,                        // SillyTavern's Connection Profile service
    processRequest: /\.processRequest\(/g,                  // SillyTavern's chat completion service
    generateRaw: /\.generateRaw\(/g,                        // SillyTavern's Main API generation
    hostGenerate: /\.generate\(['"]/g,                      // SillyTavern's own reply request (Swipe, Continue, Impersonate)
    phoneModel: /\bphoneModel\(\{/g,                        // the on-phone model
    fetchImpl: /\bfetchImpl\(/g,                            // a direct HTTP call
};

// How each kind of site meets the ceiling.
const HOW = {
    chain: 'runChain: every paid step reserves, is skipped at the ceiling and is recorded (routing.js)',
    ai: 'ai.js request(): a chain through runOperationChain, else meterCall on the Fixed Main API or Connection Profile',
    meter: 'meterCall (routing.js) around the direct send',
    reserve: 'reserveSpend before the send, recordSpend after (the Jev decisions endpoint)',
    transport: 'the transport itself; its callers are the metered sites listed here',
    local: 'the desktop route only, which is local and never paid',
    reply: 'SillyTavern\'s own reply request (Swipe, Continue, Impersonate, Regenerate), outside the ceiling like every chat reply',
    noModel: 'no model call: a file download or a local embedding',
};

const INVENTORY = {
    'src/ai.js': { counts: { askFull: 1, runOperationChain: 1, runAdditional: 1 }, how: ['meter', 'chain'],
        note: 'request(): the chain path (Automatic, or Fixed with fallback) and the direct path (Fixed alone), metered' },
    'src/banks.js': { counts: { runJob: 1 }, how: ['chain'], note: 'Smooth the rolled parts, a tap on the capture chain' },
    'src/book-keywords.js': { counts: { aiRequest: 1 }, how: ['ai'], note: 'Suggest Primary Keywords' },
    'src/broken-reply.js': { counts: { hostGenerate: 1 }, how: ['reply'], note: 'Regenerate a broken reply' },
    'src/chapters.js': { counts: { runOperationChain: 2, aiRequest: 4 }, how: ['chain', 'ai'],
        note: 'Close the chapter here and Write a chapter now (writerCall), chapter close, combine, new chapter, starter world' },
    'src/corrections.js': { counts: { aiRequest: 1 }, how: ['ai'], note: 'Trace a story correction' },
    'src/engine.js': { counts: { aiRequest: 1, runAdditional: 1 }, how: ['ai', 'reply'], note: 'Follow-through check; Automatically replace a missed reply is a Swipe' },
    'src/execution.js': { counts: { runChain: 1 }, how: ['chain'], note: 'runOperationChain' },
    'src/guided-turns.js': { counts: { aiRequest: 2, runAdditional: 1, hostGenerate: 1 }, how: ['ai', 'reply'], note: 'Give me choices, Draft from this choice; Write my next message is Impersonate' },
    'src/help.js': { counts: { runChain: 1 }, how: ['chain'], note: 'A help question' },
    'src/memory/behavior-books.js': { counts: { runChain: 1 }, how: ['chain'], note: 'Draft entries' },
    'src/memory/capture.js': { counts: { runChain: 1 }, how: ['chain'], note: 'Capture after each reply' },
    'src/memory/carry-over.js': { counts: { runChain: 2 }, how: ['chain'], note: 'Write the synopsis and start' },
    'src/memory/catchup.js': { counts: { runChain: 4 }, how: ['chain'], note: 'Catch-up, its route test, rebuild Tidy' },
    'src/memory/decide.js': { counts: { askFull: 1, runChain: 1, fetchImpl: 1 }, how: ['local', 'chain', 'reserve'], note: 'Judgment calls: desktop, Jev router, Jev decisions' },
    'src/memory/embed.js': { counts: { fetchImpl: 2 }, how: ['noModel'], note: 'Search runtime download and the desktop embedding booster' },
    'src/memory/phone-model.js': { counts: { fetchImpl: 1 }, how: ['noModel'], note: 'On-phone model download' },
    'src/memory/queue.js': { counts: { askFull: 1 }, how: ['local'], note: 'Desktop warm-up' },
    'src/memory/upkeep.js': { counts: { runChain: 1 }, how: ['chain'], note: 'Tidy' },
    'src/preset-conflicts.js': { counts: { aiRequest: 1 }, how: ['ai'], note: 'Check conflicts' },
    'src/quick-action-chat.js': { counts: { hostGenerate: 1 }, how: ['reply'], note: 'A quick action sent as a chat message' },
    'src/routing.js': { counts: { askFull: 2, runChain: 1, runJob: 1, phoneModel: 1 }, how: ['transport', 'chain'], note: 'runChain itself' },
    'src/st.js': { counts: { askFull: 1, sendRequest: 2, processRequest: 1, generateRaw: 1, hostGenerate: 2 }, how: ['transport', 'reply'], note: 'askFull, and Continue' },
    'src/stat-sheets.js': { counts: { runJob: 3 }, how: ['chain'], note: 'Stat sheets at chat start and per new character' },
    'src/story-outline.js': { counts: { runChain: 1 }, how: ['chain'], note: 'Story outline (free routes only)' },
    'src/ui/cards/choices.js': { counts: { runChain: 1 }, how: ['chain'], note: 'The Choices card' },
    'src/v10.js': { counts: { aiRequest: 1 }, how: ['ai'], note: 'Draft or read an opening' },
    'src/world.js': { counts: { aiRequest: 1 }, how: ['ai'], note: 'Draft a Story World entry' },
    'src/writer.js': { counts: { aiRequest: 4 }, how: ['ai'], note: 'Writer versions, items, rewrite, goal' },
};

function scan() {
    const files = [];
    const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
    walk(path.join(ROOT, 'src'));
    files.push(path.join(ROOT, 'index.js'));
    const found = {};
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8').split('\n').filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
        for (const [name, pattern] of Object.entries(PRIMITIVES)) {
            const n = (text.match(pattern) || []).length;
            if (n) (found[path.relative(ROOT, file).split(path.sep).join('/')] ||= {})[name] = n;
        }
    }
    return found;
}
const source = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('every call site that can reach a paid route is listed with how it checks the ceiling', () => {
    const found = scan();
    for (const [file, counts] of Object.entries(found)) {
        assert.ok(INVENTORY[file], `${file} sends a model call (${JSON.stringify(counts)}) and is not in the B59 inventory; list it with how it meets the ceiling`);
        assert.deepEqual(counts, INVENTORY[file].counts, `${file}: the send primitives changed; list each new call site with its check`);
    }
    for (const [file, row] of Object.entries(INVENTORY)) {
        assert.ok(found[file], `${file} is listed but sends nothing now`);
        for (const how of row.how) assert.ok(HOW[how], `${file}: unknown check ${how}`);
    }
});

test('the inventory reader fails a new call site', () => {
    const text = 'const x = await askFull({ user: "x" });\n// askFull( in a comment\nawait runChain(chain, {});';
    const n = name => (text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').match(PRIMITIVES[name]) || []).length;
    assert.equal(n('askFull'), 1);
    assert.equal(n('runChain'), 1);
});

test('each check the inventory names is in the code', () => {
    const routing = source('src/routing.js');
    // runChain: a paid step is paid whatever background says; nothing reads background before the ceiling check.
    assert.match(routing, /const paid = stepCostClass\(item, target\) === 'paid';/);
    assert.doesNotMatch(routing, /paid = [^;]*background/);
    assert.match(routing, /if \(paid && !canSpend\(estimate\)\)/);
    assert.match(routing, /const reservation = paid \? reserveSpend/);
    // ai.js: the direct path is wrapped in meterCall; the chain path goes through runOperationChain.
    const ai = source('src/ai.js');
    assert.match(ai, /meterCall\(\{cost,route:profileId \? 'override' : 'main',job:chainJob\(operation\)\},\s*\(\)=>askFull\(/);
    // decide.js: the Jev decisions endpoint reserves before it sends.
    const decide = source('src/memory/decide.js');
    assert.ok(decide.indexOf('reserveSpend({ route: \'openrouter\'') < decide.indexOf('await fetchImpl(JEV_ENDPOINT'));
    // The two local-only direct calls resolve the desktop route, which is never paid.
    assert.match(decide, /async function askDesktop[\s\S]*?route === 'desktop'[\s\S]*?askFull\(/);
    assert.match(source('src/memory/queue.js'), /resolveRoute\(\{ route: 'desktop' \}\)[\s\S]*?askFull\(/);
    // No caller asks runChain to skip the meter: background only changes words and notes now.
    for (const file of Object.keys(INVENTORY)) assert.doesNotMatch(source(file), /background\s*&&\s*cost|paid\s*&&\s*background/, file);
});

// ---------------------------------------------------------------- the fake host

const requests = [];
const replies = new Map();
const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
        const body = JSON.parse(data || '{}');
        requests.push({ url: req.url, body });
        const plan = replies.get(body.model) || {};
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: plan.content ?? '{"facts":["The gate is open."]}' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1000, completion_tokens: 100, ...(plan.cost !== undefined ? { cost: plan.cost } : {}) } }));
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
    return extractData ? { content: json.choices[0].message.content, reasoning: '' } : json;
}

const profiles = [
    { id: 'p-nano', name: 'NanoGPT', api: 'nanogpt', model: 'nano-model', preset: '' },
    { id: 'p-or', name: 'OpenRouter', api: 'openrouter', model: 'paid-model', preset: '' },
];
const rawCalls = [];
let rawAnswer = '{"facts":["The gate is open."]}';
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], chatMetadata: {}, characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    generateRaw: async args => { rawCalls.push(args); return rawAnswer; },
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
globalThis.toastr = { warning() {}, info() {}, error() {}, success() {} };

const routing = await import('../src/routing.js');
const spend = await import('../src/spend.js');
const execution = await import('../src/execution.js');
const { runChain, resetRouteHealth, setJobChain } = routing;
const schema = { name: 'capture', value: { type: 'object', required: ['facts'], properties: { facts: { type: 'array', items: { type: 'string' } } } } };
const PAID = { route: 'openrouter', model: 'paid-model', price: { in: 1, out: 1 } };
const FREE = { route: 'nanogpt', model: 'nano-model' };
const paidRequests = () => requests.filter(r => r.body.model === 'paid-model').length;

function reset({ ceiling = 5 } = {}) {
    requests.length = 0;
    rawCalls.length = 0;
    replies.clear();
    resetRouteHealth();
    spend.resetSpendReservations();
    host.extensionSettings[KEY] = {};
    host.chatCompletionSettings = { chat_completion_source: 'openrouter', custom_include_body: '' };
    spend.setSpendLimits({ ceiling, warning: ceiling });
}
const atCeiling = () => reset({ ceiling: 0 });

// ---------------------------------------------------------------- 2. runChain

test('a tapped paid step is metered as a background one is', async () => {
    reset();
    replies.set('paid-model', { cost: 0.25 });
    const res = await runChain([PAID], { job: 'capture', user: 'x', schema, background: false });
    assert.equal(res.ok, true);
    const state = spend.spendState();
    assert.equal(state.total, 0.25, 'the reported cost is on the meter');
    assert.equal(state.routes.openrouter.calls, 1);
    assert.equal(state.calls[0].job, 'capture');
});

test('at the ceiling a tapped paid step is refused with the ceiling line and sends nothing', async () => {
    atCeiling();
    const res = await runChain([PAID], { job: 'carryOver', user: 'x', schema, background: false });
    assert.equal(res.ok, false);
    assert.equal(res.waiting, true);
    assert.equal(res.reason, spend.CEILING_LINE);
    assert.match(res.reason, /monthly spend ceiling is reached/);
    assert.match(res.reason, /Setup, Connections, Spend/);
    assert.equal(paidRequests(), 0);
    assert.match(res.attempts[0].receipt, /skipped, the monthly spend ceiling is reached/);
    // A background job still reads the paused line, which the queue and Spend look for.
    const job = await runChain([PAID], { job: 'capture', user: 'x', schema });
    assert.match(job.reason, /^Paused, monthly ceiling reached/);
});

test('at the ceiling a free route later in the chain still answers', async () => {
    atCeiling();
    const res = await runChain([PAID, FREE], { job: 'carryOver', user: 'x', schema, background: false });
    assert.equal(res.ok, true);
    assert.equal(res.route, 'nanogpt');
    assert.equal(paidRequests(), 0, 'no paid request');
    assert.equal(spend.spendState().calls.length, 0, 'nothing is added to the meter');
});

test('a paid answer that cannot be used is still billed, and a free route after it answers', async () => {
    reset();
    replies.set('paid-model', { cost: 0.05, content: 'Not JSON at all.' });
    const res = await runChain([PAID, FREE], { job: 'carryOver', user: 'x', schema, background: false });
    assert.equal(res.ok, true);
    assert.equal(res.route, 'nanogpt');
    const state = spend.spendState();
    assert.equal(state.routes.openrouter.calls, 1, 'the paid request that came back unusable is on the meter');
    assert.equal(state.total, 0.05);
    assert.equal(state.reserved, 0, 'its reservation is settled');
});

test('the Main API on a paid provider is a paid step, and a local one is not', async () => {
    atCeiling();
    const refused = await runChain([{ route: 'main' }], { job: 'capture', user: 'x', schema, background: false });
    assert.equal(refused.reason, spend.CEILING_LINE);
    assert.equal(rawCalls.length, 0, 'no Main API request');
    host.chatCompletionSettings = { chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:5001/v1' };
    const local = await runChain([{ route: 'main' }], { job: 'capture', user: 'x', schema, background: false });
    assert.equal(local.ok, true, 'a local Main API answers at the ceiling');
    assert.equal(rawCalls.length, 1);
});

// ---------------------------------------------------------------- 3. the tapped buttons and the direct sends

test('meterCall: refused at the ceiling before the send, metered below it, free calls pass through', async () => {
    atCeiling();
    let sent = 0;
    await assert.rejects(routing.meterCall({ cost: 'paid', route: 'main', job: 'carryOver' }, async () => { sent++; return { text: 'x' }; }),
        error => error.kind === 'ceiling' && error.message === spend.CEILING_LINE);
    assert.equal(sent, 0, 'nothing is sent');
    const free = await routing.meterCall({ cost: 'plan', route: 'nanogpt' }, async () => { sent++; return { text: 'x' }; });
    assert.equal(free.text, 'x');
    assert.equal(sent, 1, 'a plan route passes at the ceiling');
    reset();
    await routing.meterCall({ cost: 'paid', route: 'override', job: 'carryOver' }, async () => ({ text: 'x', cost: 0.4, usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const state = spend.spendState();
    assert.equal(state.total, 0.4);
    assert.equal(state.calls[0].basis, 'usage');
    assert.deepEqual(state.calls[0].tokens, { in: 10, out: 5 });
    await assert.rejects(routing.meterCall({ cost: 'paid' }, async () => { throw new Error('down'); }), /down/);
    assert.equal(spend.spendState().reserved, 0, 'a failed send lets its reservation go');
});

test('Close the chapter here and Write a chapter now: the Writer call refuses at the ceiling and meters below it', async () => {
    // Both buttons call writerCall in chapters.js: runOperationChain('chapterSummary', { background: false }).
    const chapters = source('src/chapters.js');
    assert.match(chapters, /writeChapterJob\(span, \{ why: 'you asked for it', manual: true \}\)/, 'Close the chapter here is manual');
    assert.match(chapters, /export async function writeChapterNow\(\)[\s\S]*?if \(memoryActive\(\)\) return closeChapterHere\(\);/, 'Write a chapter now closes the chapter the same way');
    assert.match(chapters, /label: `Chapter close, messages \$\{span.from\} to \$\{span.to\}`, signal, background: !manual/);
    atCeiling();
    execution.setExecutionSetting('chapterSummary', { mode: 'fixed', profileId: 'p-or' });
    const refused = await execution.runOperationChain('chapterSummary', { user: 'x', schema, background: false });
    assert.equal(refused.reason, spend.CEILING_LINE);
    assert.equal(paidRequests(), 0);
    reset();
    execution.setExecutionSetting('chapterSummary', { mode: 'fixed', profileId: 'p-or' });
    replies.set('paid-model', { cost: 0.3 });
    const ok = await execution.runOperationChain('chapterSummary', { user: 'x', schema, background: false });
    assert.equal(ok.ok, true);
    assert.equal(spend.spendState().total, 0.3, 'the tapped chapter call is on the meter');
});

test('Write the synopsis and start: refused at the ceiling with the ceiling line, metered below it', async () => {
    const { createCarryOver } = await import('../src/memory/carry-over.js');
    const runner = () => createCarryOver({ chat: () => [], meta: () => ({}), chatId: () => 'chat-1', chatName: () => 'chat-1', names: () => ({ user: 'Mira', char: 'Captain' }),
        key: KEY, runChain: (chain, options) => runChain(chain, options), chainFor: job => routing.chainFor(job),
        newChat: async () => { throw new Error('stop after the call'); } });
    atCeiling();
    setJobChain('carryOver', [PAID]);
    await assert.rejects(runner().start({}), error => error.message === spend.CEILING_LINE);
    assert.equal(paidRequests(), 0, 'no paid request');
    reset();
    setJobChain('carryOver', [PAID]);
    replies.set('paid-model', { cost: 0.2, content: JSON.stringify({ synopsis: 'word '.repeat(60).trim() }) });
    await runner().start({}).catch(() => {});
    assert.equal(paidRequests(), 1);
    assert.equal(spend.spendState().total, 0.2, 'the synopsis call is on the meter');
});

test('Draft entries: refused at the ceiling with the ceiling line, metered below it', async () => {
    const { draftEntries } = await import('../src/memory/behavior-books.js');
    atCeiling();
    setJobChain('carryOver', [PAID]);
    const refused = await draftEntries('A storm closes the pass.', { kind: 'event', context: host });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, spend.CEILING_LINE);
    assert.equal(paidRequests(), 0);
    reset();
    setJobChain('carryOver', [PAID]);
    replies.set('paid-model', { cost: 0.15, content: '{"entries":[]}' });
    await draftEntries('A storm closes the pass.', { kind: 'event', context: host });
    assert.ok(paidRequests() >= 1);
    assert.equal(spend.spendState().calls.length, paidRequests(), 'each Draft entries call is on the meter');
    // At the ceiling with a free route after the paid one, the draft still runs.
    atCeiling();
    setJobChain('carryOver', [PAID, FREE]);
    await draftEntries('A storm closes the pass.', { kind: 'event', context: host });
    assert.equal(paidRequests(), 0);
    assert.ok(requests.some(r => r.body.model === 'nano-model'), 'the free route answered');
});

test('a Fixed Main API or Connection Profile sent directly is metered, tapped or automatic', async () => {
    const ai = await import('../src/ai.js');
    // Write a goal fixed to the Main API alone is one step, so ai.js sends it directly.
    atCeiling();
    execution.setExecutionSetting('writerGoal', { mode: 'fixed', profileId: '' });
    assert.equal(execution.executionPreview('writerGoal').viaChain, false, 'one step: the direct path');
    await assert.rejects(ai.request({ operation: 'writerGoal', authorization: 'manual', what: 'Write a goal', user: 'x', tokens: 50 }),
        error => error.message === spend.CEILING_LINE);
    assert.equal(rawCalls.length, 0, 'no Main API request at the ceiling');
    reset();
    execution.setExecutionSetting('writerGoal', { mode: 'fixed', profileId: '' });
    rawAnswer = 'A goal.';
    await ai.request({ operation: 'writerGoal', authorization: 'manual', what: 'Write a goal', user: 'x', tokens: 50 });
    assert.equal(rawCalls.length, 1);
    assert.equal(spend.spendState().routes.main.calls, 1, 'the paid Main API call is on the meter');
    assert.equal(spend.spendState().calls[0].basis, 'unpriced', 'the Main API reports no price');
    // A Fixed paid Connection Profile on the direct path.
    execution.setExecutionSetting('writerGoal', { mode: 'fixed', profileId: 'p-or' });
    replies.set('paid-model', { content: 'A goal.' });
    await ai.request({ operation: 'writerGoal', authorization: 'manual', what: 'Write a goal', user: 'x', tokens: 50 });
    assert.equal(spend.spendState().routes.override.calls, 1, 'the paid Connection Profile call is on the meter');
    // A tap through a chain (Automatic) refused at the ceiling reads the ceiling line alone.
    atCeiling();
    execution.setExecutionSetting('writerGoal', { mode: 'auto' });
    setJobChain('carryOver', [PAID]);
    host.chatCompletionSettings = { chat_completion_source: 'openrouter', custom_include_body: '' };
    await assert.rejects(ai.request({ operation: 'writerGoal', authorization: 'manual', what: 'Write a goal', user: 'x', tokens: 50 }),
        error => error.message === spend.CEILING_LINE);
    assert.equal(paidRequests() + rawCalls.length, 0);
});
