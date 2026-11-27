// MB14: roll records in memory and the judgment route. Run with: node --test tests/t_rolls.js
// A fake SillyTavern host records every model request. Covers: the request log over the 54-turn M1g story plus fixtures
// (no judgment call on a turn with no action by anyone; an attempt without attempt words still reaches the call); the six
// degrees at every band edge; each swipe's own roll, switching swipes, delete, edit and branch (memory DESIGN 13, Dice row,
// as DECISIONS 2026-11-26 rules swipes); capture reading the turn's rolls; the phone route with the desktop unreachable,
// its route and timing kept with the reply; and judgment and stat sheet spend in the month's total.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const KEY = 'roleplay_instructions';
const FAKE_KEY = 'sk-or-FAKE-not-a-real-key-0000';
const listeners = new Map();
const prompts = new Map();
const profiles = [];
const sent = [];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, saveMetadata() {}, saveMetadataDebounced() {}, saveChat: async () => {}, saveChatDebounced() {},
    getCurrentChatId: () => 'chat-1', chat: [], chatMetadata: {}, name1: 'Mira', name2: 'Captain Hale', characterId: 0,
    characters: [{ avatar: 'hale.png', description: 'A scarred harbor captain, strong as an ox.', personality: '', scenario: '' }],
    powerUserSettings: { persona_description: 'Mira is a quick-witted smuggler.' },
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    ConnectionManagerRequestService: {
        getSupportedProfiles: () => profiles,
        // A paid OpenRouter profile for the stat sheet spend test: it answers one sheet.
        async sendRequest(profileId, prompt, maxTokens, custom = {}) {
            sent.push({ profileId, prompt });
            const content = JSON.stringify({ sheets: [{ who: 'Mira', stats: [{ stat: 'Wits', value: 2, reason: '"quick-witted"' }] }] });
            return custom.extractData !== false ? { content, reasoning: '' } : { choices: [{ message: { content } }] };
        },
    },
    substituteParams: text => String(text).replaceAll('{{user}}', host.name1).replaceAll('{{char}}', host.name2),
    setExtensionPrompt: (key, value, position, depth) => prompts.set(key, { value, position, depth }),
    eventTypes: Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_CREATED'].map(n => [n, n])),
    eventSource: { on: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } },
    getWorldInfoNames: () => [], loadWorldInfo: async () => null, saveWorldInfo: async () => {},
    generateRaw: async () => '{"sheets":[]}',
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {} };
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
// OpenRouter's decisions endpoint for the Jev step; nothing else leaves this process.
const decisionCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://openrouter.ai/api/alpha/decisions') {
        decisionCalls.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ answers: { attempt: { noul: 0.92 }, stat: { choice: 'Agility', confidence: 0.9 }, difficulty: { choice: 'Hard', confidence: 0.8 }, stance: { choice: 'neutral', confidence: 0.7 } },
            usage: { input_tokens: 420, output_tokens: 0, cost: 0.000018 } }));
    }
    if (String(url) === '/api/backends/chat-completions/status') return new Response(JSON.stringify({ error: true }));
    return realFetch(url, init);
};
const emit = async (name, ...args) => { for (const fn of listeners.get(name) || []) await fn(...args); };

const dice = await import('../src/dice.js');
const judgeMod = await import('../src/dice-judge.js');
const sheets = await import('../src/stat-sheets.js');
const routing = await import('../src/routing.js');
const store = await import('../src/store.js');
const decide = await import('../src/memory/decide.js');
const spend = await import('../src/spend.js');
const rolls = await import('../src/memory/rolls.js');
await judgeMod.startDice();
dice.setDiceFeatureReader(null);

// The desktop route, recorded: every judgment request it receives is one line of the request log.
const judged = [];
let judgeAnswer = () => ({ attempts: [] });
const desktopDeps = {
    lane: fn => fn(), phoneReady: async () => false, jev: async () => ({ skipped: 'off in this test' }),
    desktop: async ({ user }) => { judged.push(user); return { value: judgeAnswer(user), model: 'gemma4:12b' }; },
};

function reset() {
    host.extensionSettings[KEY] = {};
    host.chatMetadata = {};
    host.chat = [];
    prompts.clear(); judged.length = 0; decisionCalls.length = 0; sent.length = 0; profiles.length = 0;
    judgeAnswer = () => ({ attempts: [] });
    decide.resetJudgmentHealth();
    routing.resetRouteHealth();
    spend.resetSpendReservations();
    judgeMod.setJudgeDeps(desktopDeps);
    store.settings().dice.on = true;
}

const user = text => ({ is_user: true, name: 'Mira', mes: text, extra: {} });
const reply = text => ({ is_user: false, name: 'Captain Hale', mes: text, swipe_id: 0, swipes: [text], swipe_info: [{ extra: {} }], extra: {} });

// ---------------------------------------------------------------- the request log

const STORY = JSON.parse(fs.readFileSync(new URL('../docs/ux-overhaul/memory/evidence/MB11/fixtures/story100.json', import.meta.url), 'utf8'));

// Turns of talk alone send nothing; an attempt written with no attempt word still reaches the call.
const NO_ACTION = [
    '"Good evening, Captain," I say, smiling.',
    '"Do you think it will rain tomorrow?" I ask.',
    '(OOC: can we skip to the morning?)',
    '((brb, dinner))',
    '"I missed you," I whisper.',
];
const PLAIN_ATTEMPTS = [
    'I put my shoulder to the door until the hinges give.',
    'I draw my sword and step between them.',
    'I pocket the letter while his back is turned.',
    'I vault the fence and sprint for the trees.',
];

test('request log: no judgment call on a turn with no action by anyone; every other turn of the 54-turn story and every plain attempt reaches it', async () => {
    reset();
    const log = [];
    let lastReply = STORY.greeting;
    for (const t of STORY.turns.slice(0, 54)) {
        judged.length = 0;
        const input = { message: t.player, lastReply, scene: '', npcNames: [] };
        const screen = judgeMod.screenDiceTurn(input);
        const { receipt } = await judgeMod.judgeTurn(input, { deps: desktopDeps });
        log.push({ n: t.n, calls: judged.length, skipped: receipt.skipped, reason: receipt.reason });
        assert.equal(judged.length, screen.skip ? 0 : 1, `turn ${t.n}: ${screen.skip ? 'no call' : 'one call'}`);
        if (screen.skip) assert.ok(!screen.action && !screen.openNpcMove, `turn ${t.n} is skipped only with no action by anyone`);
        lastReply = t.prose;
    }
    const calls = log.filter(r => r.calls).length;
    const skipped = log.filter(r => r.skipped);
    console.log(`54-turn story: ${calls} judgment calls, ${skipped.length} turns of talk alone with none (turns ${skipped.map(r => r.n).join(', ')})`);
    assert.equal(calls + skipped.length, 54);
    // a turn of the story with an action and no attempt word: "I go with Hale to the stable to look at Night."
    assert.equal(log.find(r => r.n === 2).calls, 1);
    for (const message of NO_ACTION) {
        judged.length = 0;
        const { receipt, rolls: made } = await judgeMod.judgeTurn({ message, lastReply: 'Hale pours the tea.' }, { deps: desktopDeps });
        assert.equal(judged.length, 0, `no call: ${message}`);
        assert.equal(receipt.skipped, true);
        assert.equal(made.length, 0);
    }
    for (const message of PLAIN_ATTEMPTS) {
        assert.doesNotMatch(message, /\b(try|tries|attempt)/i, 'no attempt word');
        judged.length = 0;
        await judgeMod.judgeTurn({ message, lastReply: '' }, { deps: desktopDeps });
        assert.equal(judged.length, 1, `reaches the judgment call: ${message}`);
    }
    // talk alone while an NPC's threat is still under way keeps the call
    judged.length = 0;
    await judgeMod.judgeTurn({ message: '"You will not have it," I say.', lastReply: 'Brannic tries to wrestle the satchel from your hands.', npcNames: ['Brannic'] }, { deps: desktopDeps });
    assert.equal(judged.length, 1, 'an open NPC move keeps the call');
    judged.length = 0;
    await judgeMod.judgeTurn({ message: '"Wait," I say.', threads: [{ kind: 'pending', status: 'open', by: 'npc', threat: true }] }, { deps: desktopDeps });
    assert.equal(judged.length, 1, 'an open Pending threat keeps the call');
});

// ---------------------------------------------------------------- the record

test('margins at each band edge map to the six degrees, and a roll record carries every field', () => {
    const edges = [[25, 'overwhelming-success'], [5, 'overwhelming-success'], [4, 'success'], [2, 'success'], [1, 'partial-success'], [0, 'partial-success'],
        [-1, 'partial-failure'], [-2, 'partial-failure'], [-3, 'failure'], [-4, 'failure'], [-5, 'overwhelming-failure'], [-25, 'overwhelming-failure']];
    for (const [margin, id] of edges) assert.equal(rolls.degreeFor(margin).id, id, `margin ${margin}`);
    for (let m = -25; m <= 25; m++) assert.equal(rolls.DEGREES.filter(d => m >= d.min && m <= d.max).length, 1, `margin ${m} in one band`);
    reset();
    const raw = dice.rollAttempt({ actor: 'user', attempt: 'climb the wall', stat: 'Agility', step: 'Hard', stance: 'resisting', route: 'desktop', model: 'gemma4:12b' }, { random: () => 13 });
    const record = rolls.rollRecord(raw);
    assert.deepEqual(Object.keys(record), rolls.ROLL_FIELDS);
    assert.deepEqual({ die: record.die, total: record.total, difficulty: record.difficulty, margin: record.margin, degree: record.degree, step: record.step },
        { die: 14, total: 14, difficulty: 17, margin: -3, degree: 'Failure', step: 'Very hard' });
    assert.equal(record.margin, record.total - record.difficulty);
});

// ---------------------------------------------------------------- swipes, switching, delete, edit, branch

test('each swipe keeps its own roll; switching swipes shows each; deleting the reply removes it; editing her message rolls again; a branch keeps its rolls', async () => {
    reset();
    host.chat = [user('I try to climb the wall.')];
    judgeAnswer = text => ({ attempts: [{ actor: 'user', attempt: /rope/.test(text) ? 'climb the rope' : 'climb the wall', stat: /rope/.test(text) ? 'Strength' : 'Agility', difficulty: 'Hard', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    host.chat.push(reply('She climbs.'));
    await emit('MESSAGE_RECEIVED', 1);
    const m = host.chat[1];
    const first = rolls.rollsAt(m);
    assert.equal(first.length, 1);
    assert.equal(first[0].stat, 'Agility');
    assert.match(rolls.captureRollLines(m), /^Mira attempts to climb the wall; Agility d20 \d+ \+0 = \d+ against 14 \(Hard\): /, 'capture is told the turn\'s roll');
    // a swipe: one judgment call and its own roll
    m.swipe_info[0].extra = structuredClone(m.extra);
    m.swipes.push(''); m.swipe_info.push({ extra: {} }); m.swipe_id = 1; m.extra = {};
    judged.length = 0;
    judgeAnswer = () => ({ attempts: [{ actor: 'user', attempt: 'climb the wall', stat: 'Wits', difficulty: 'Easy', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'swipe', {}, false);
    m.mes = 'She finds the handholds.'; m.swipes[1] = m.mes;
    await emit('MESSAGE_RECEIVED', 1);
    assert.equal(judged.length, 1, 'a swipe sends one judgment call');
    assert.equal(rolls.rollsAt(m)[0].stat, 'Wits', 'the new swipe holds its own roll');
    assert.equal(rolls.rollsAt(m, 0)[0].stat, 'Agility', 'the first swipe keeps its roll');
    // switching swipes
    m.swipe_info[1].extra = structuredClone(m.extra);
    m.swipe_id = 0; m.mes = m.swipes[0]; m.extra = structuredClone(m.swipe_info[0].extra);
    assert.equal(rolls.rollsAt(m)[0].stat, 'Agility', 'swipe 0 shows its roll');
    assert.deepEqual(rolls.chatRolls(host.chat).map(r => r.rolls[0].stat), ['Agility']);
    m.swipe_id = 1; m.mes = m.swipes[1]; m.extra = structuredClone(m.swipe_info[1].extra);
    assert.equal(rolls.rollsAt(m)[0].stat, 'Wits', 'swipe 1 shows its roll');
    // a branch copies the messages with their rolls, both swipes
    const branch = structuredClone(host.chat);
    assert.deepEqual(rolls.rollsAt(branch[1]), rolls.rollsAt(m));
    assert.deepEqual(rolls.rollsAt(branch[1], 0), rolls.rollsAt(m, 0));
    // editing her message: the next version of the reply judges the edited text and rolls afresh
    host.chat[0].mes = 'I try to climb the rope.';
    m.swipe_info[1].extra = structuredClone(m.extra);
    m.swipes.push(''); m.swipe_info.push({ extra: {} }); m.swipe_id = 2; m.extra = {};
    judged.length = 0;
    judgeAnswer = text => ({ attempts: [{ actor: 'user', attempt: /rope/.test(text) ? 'climb the rope' : 'climb the wall', stat: /rope/.test(text) ? 'Strength' : 'Agility', difficulty: 'Hard', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'swipe', {}, false);
    m.mes = 'She climbs the rope.'; m.swipes[2] = m.mes;
    await emit('MESSAGE_RECEIVED', 1);
    assert.equal(judged.length, 1);
    assert.match(judged[0], /Player message: I try to climb the rope\./, 'the edited message is judged');
    assert.deepEqual([rolls.rollsAt(m)[0].attempt, rolls.rollsAt(m)[0].stat], ['climb the rope', 'Strength'], 'a new roll for the edited attempt');
    // deleting the reply removes its rolls
    host.chat.splice(1, 1);
    assert.deepEqual(rolls.chatRolls(host.chat), [], 'no roll is left');
});

// ---------------------------------------------------------------- the phone route

test('with the desktop unreachable and the phone model downloaded, an attempt is judged on the phone; the route and timing stay with the reply', async () => {
    reset();
    const phoneDeps = { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => true,
        phoneAsk: async (question, options) => (/yes or no/.test(question) ? 'yes' : options[2]), jev: async () => ({ skipped: 'not reached' }) };
    const { rolls: made, receipt } = await judgeMod.judgeTurn({ message: 'I try to climb the wall.' }, { deps: phoneDeps });
    assert.equal(receipt.route, 'phone');
    assert.equal(receipt.model, 'gemma-4-e2b-litert');
    assert.deepEqual(receipt.tried.map(t => `${t.route}:${t.outcome}`), ['desktop:failed', 'phone:answered']);
    assert.ok(Number.isFinite(receipt.tried[1].ms), 'the phone\'s own time is recorded');
    assert.equal(made[0].route, 'phone');
    assert.equal(made[0].stat, 'Agility', 'code takes the stat from the kind of action');
    host.chat = [user('I try to climb the wall.'), reply('She climbs.')];
    dice.storeRolls(host.chat[1], made, receipt);
    const [timing] = rolls.judgmentTimings(host.chat);
    assert.deepEqual([timing.route, timing.model], ['phone', 'gemma-4-e2b-litert']);
    assert.ok(timing.tried.find(t => t.route === 'phone').ms >= 0, 'timing kept with the reply');
    assert.equal(rolls.rollsAt(host.chat[1])[0].route, 'phone', 'the roll names its route for the Sent card');
    // a desktop that does not answer at all hands over to the phone after its 1 s limit
    decide.resetJudgmentHealth();
    const started = Date.now();
    const late = await judgeMod.judgeTurn({ message: 'I try to climb the wall.' }, { deps: { ...phoneDeps, desktop: () => new Promise(() => {}) } });
    const waited = Date.now() - started;
    assert.equal(late.receipt.route, 'phone');
    assert.equal(late.receipt.tried[0].outcome, 'late');
    assert.ok(waited >= 1000 && waited < 1500, `phone took over ${waited} ms after the desktop was asked`);
});

// ---------------------------------------------------------------- spend

test('judgment and stat sheet spend show in the month\'s total; a judgment on Jev counts toward the ceiling', async () => {
    reset();
    host.extensionSettings[KEY].spend = { ceiling: 5, warning: 4 };
    const start = spend.spendState().total;
    decide.setJevKey(FAKE_KEY);
    const downDeps = { lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false };
    const { rolls: made, receipt } = await judgeMod.judgeTurn({ message: 'I try to climb the wall.' }, { deps: downDeps });
    assert.equal(receipt.route, 'jev');
    assert.equal(made.length, 1);
    assert.equal(decisionCalls.length, 1);
    let state = spend.spendState();
    const judgment = state.calls.find(c => c.job === 'judgment');
    assert.equal(judgment.usd, 0.000018);
    assert.equal(judgment.route, 'openrouter');
    // a stat sheet call on a paid route
    profiles.push({ id: 'p-or', name: 'OpenRouter', api: 'openrouter', model: 'paid-a', preset: '' });
    routing.setJobChain('statSheets', [{ route: 'openrouter', model: 'paid-a', price: { in: 100, out: 100 } }]);
    const res = await sheets.inferChatSheets({ force: true });
    assert.equal(res.ok, true);
    assert.equal(sent.length, 1, 'one stat sheet call');
    state = spend.spendState();
    const sheetCall = state.calls.find(c => c.job === 'statSheets');
    assert.ok(sheetCall && sheetCall.usd > 0, 'the stat sheet call is metered');
    assert.equal(Math.round((state.total - start) * 1e6), Math.round((judgment.usd + sheetCall.usd) * 1e6), 'both in the month\'s total');
    // at the ceiling the Jev slot is skipped and code answers
    spend.setSpendLimits({ ceiling: state.total });
    decide.resetJudgmentHealth();
    const capped = await judgeMod.judgeTurn({ message: 'I try to climb the wall.' }, { deps: downDeps });
    assert.equal(capped.receipt.route, 'code', 'no paid judgment past the ceiling');
    assert.equal(decisionCalls.length, 1);
    decide.setJevKey('');
});
