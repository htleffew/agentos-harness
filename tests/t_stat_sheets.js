// B22: dice and stat sheets with no host. Run with: node --test tests/t_stat_sheets.js
// Covers the six degrees over every margin from -25 to +25, stance, the verdict text, the judgment call before a reply
// (detection fixtures with the pass rate, NPC attempts, the die button), the request recorder for Dice off, swipes and
// branches, the Sent receipt words, stat sheet inference from the card, an NPC's sheet in its World Info book, an NPC made
// during play, and edits that stick. A fake host records every model request and extension prompt.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const listeners = new Map();
const prompts = new Map();
const requests = [];
const books = new Map();
let answers = [];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles: [] }, disabledExtensions: [] },
    saveSettingsDebounced() {}, saveMetadata() {}, saveMetadataDebounced() {},
    getCurrentChatId: () => 'chat-1', chat: [], chatMetadata: {}, name1: 'Mira', name2: 'Captain Hale', characterId: 0,
    characters: [{ avatar: 'hale.png', description: 'A scarred harbor captain, strong as an ox and slow to trust.', personality: 'Stern.', scenario: '' }],
    powerUserSettings: { persona_description: 'Mira is a quick-witted smuggler with nimble fingers.' },
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    ConnectionManagerRequestService: { getSupportedProfiles: () => [] },
    substituteParams: text => String(text).replaceAll('{{user}}', host.name1).replaceAll('{{char}}', host.name2),
    setExtensionPrompt: (key, value, position, depth) => prompts.set(key, { value, position, depth }),
    eventTypes: Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHAT_CHANGED', 'CHAT_CREATED'].map(n => [n, n])),
    eventSource: { on: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); } },
    getWorldInfoNames: () => [...books.keys()],
    loadWorldInfo: async name => structuredClone(books.get(name)),
    saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
    // The main connection: the stat sheet chain ends on it in this host. Every request is recorded.
    generateRaw: async args => { requests.push({ kind: 'sheets', args }); return answers.shift() ?? '{"sheets":[]}'; },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {} };
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const emit = async (name, ...args) => { for (const fn of listeners.get(name) || []) await fn(...args); };

const dice = await import('../src/dice.js');
const judgeMod = await import('../src/dice-judge.js');
const sheets = await import('../src/stat-sheets.js');
const routing = await import('../src/routing.js');
const store = await import('../src/store.js');
const decide = await import('../src/memory/decide.js');
await judgeMod.startDice();
// No v10 preset in this host: the feature switch reads only the Dice setting.
dice.setDiceFeatureReader(null);

// The judgment routes: a desktop that answers from `judgeAnswer`, recorded as a model request.
let judgeAnswer = () => ({ attempts: [] });
const judged = [];
const desktopDeps = {
    lane: fn => fn(), phoneReady: async () => false, jev: async () => ({ skipped: 'off in this test' }),
    desktop: async ({ system, user }) => { judged.push({ system, user }); return { value: judgeAnswer(user), model: 'gemma4:12b' }; },
};

function reset() {
    host.extensionSettings[KEY] = {};
    host.chatMetadata = {};
    host.chat = [];
    prompts.clear(); requests.length = 0; judged.length = 0; answers = []; books.clear();
    judgeAnswer = () => ({ attempts: [] });
    decide.resetJudgmentHealth();
    judgeMod.setJudgeDeps(desktopDeps);
    routing.setJobChain('statSheets', [{ route: 'main' }]);
    store.settings().dice.on = true;
}

const user = text => ({ is_user: true, name: 'Mira', mes: text, extra: {} });
const reply = text => ({ is_user: false, name: 'Captain Hale', mes: text, swipe_id: 0, swipes: [text], swipe_info: [{ extra: {} }], extra: {} });

// ---------------------------------------------------------------- degrees and the roll

test('every margin from -25 to +25 maps to exactly one of the six degrees at the ruled bands', () => {
    const expect = m => m >= 5 ? 'Overwhelming success' : m >= 2 ? 'Success' : m >= 0 ? 'Partial success' : m >= -2 ? 'Partial failure' : m >= -4 ? 'Failure' : 'Overwhelming failure';
    for (let m = -25; m <= 25; m++) {
        const hits = dice.DEGREES.filter(d => m >= d.min && m <= d.max);
        assert.equal(hits.length, 1, `margin ${m} falls in one band`);
        assert.equal(dice.degreeOf(m).label, expect(m), `margin ${m}`);
    }
    for (const [m, label] of [[5, 'Overwhelming success'], [4, 'Success'], [2, 'Success'], [1, 'Partial success'], [0, 'Partial success'], [-1, 'Partial failure'], [-2, 'Partial failure'], [-3, 'Failure'], [-4, 'Failure'], [-5, 'Overwhelming failure']]) assert.equal(dice.degreeOf(m).label, label, `edge ${m}`);
});

test('a roll is d20 plus the actor\'s modifier against the difficulty, and stance moves the step one place within Easy and Extreme', () => {
    reset();
    sheets.setStatByHand('user', 'Charm', 2);
    const r = dice.rollAttempt({ actor: 'user', attempt: 'persuade the lord', stat: 'Charm', step: 'Hard', stance: 'resisting' }, { random: () => 12 });
    assert.deepEqual({ die: r.die, mod: r.mod, total: r.total, dc: r.dc, step: r.step, margin: r.margin, degree: r.degree }, { die: 13, mod: 2, total: 15, dc: 17, step: 'Very hard', margin: -2, degree: 'Partial failure' });
    assert.equal(dice.difficultyOf('Easy', 'helping').dc, 8, 'Easy stays Easy');
    assert.equal(dice.difficultyOf('Extreme', 'resisting').dc, 20, 'Extreme stays Extreme');
    assert.equal(dice.difficultyOf('Fair', 'helping').moved, 'Easy');
});

test('the verdict carries one line per roll, no number and the rule to keep dice out of the prose', () => {
    reset();
    const rolls = [dice.rollAttempt({ actor: 'user', attempt: 'to pick the lock', stat: 'Agility', step: 'Hard', stance: 'neutral' }, { random: () => 19 }),
        dice.rollAttempt({ actor: 'Brannic', attempt: 'grab the satchel', stat: 'Strength', step: 'Fair', stance: 'resisting' }, { random: () => 0 })];
    const text = dice.verdictText(rolls);
    const lines = text.split('\n').filter(l => l.startsWith('- '));
    assert.equal(lines.length, 2, 'one verdict per roll');
    assert.match(lines[0], /^- Mira's attempt to pick the lock: overwhelming success, so /);
    assert.match(lines[1], /^- Brannic's attempt to grab the satchel: overwhelming failure, so /);
    assert.doesNotMatch(text, /\d/, 'no die, total, modifier or difficulty number is sent');
    assert.doesNotMatch(text, /d20|natural/i);
    assert.match(text, /Keep dice, rolls, numbers, stats and degree names out of the prose/);
    assert.doesNotMatch(text, /[\u2013\u2014]/, 'no en or em dash');
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, 'no emoji');
    assert.equal(dice.lineText(rolls[0]), 'Mira: Pick the lock, Agility, Hard: 20 vs 14, overwhelming success · d20 20 +0', 'the one line ends with the die and the stat modifier');
});

// ---------------------------------------------------------------- detection

// Attempts and non-attempts, with the attempt the judge returns for each. The code route is measured as well: it is
// the floor the judgment falls back to when no model answers.
const FIXTURES = [
    { message: 'I try to pick the lock on the strongbox before the guard turns.', attempt: true, stat: 'Agility' },
    { message: 'I lunge at Brannic and try to wrestle the knife from him.', attempt: true, stat: 'Strength' },
    { message: 'I attempt to convince the harbormaster that we are wine merchants.', attempt: true, stat: 'Charm' },
    { message: 'I search the cabin for the hidden ledger.', attempt: true, stat: 'Senses' },
    { message: 'I climb the rigging to reach the crow\'s nest in the storm.', attempt: true, stat: 'Agility' },
    { message: 'I try to decipher the coded letter.', attempt: true, stat: 'Wits' },
    { message: 'I sneak past the sleeping dockhands.', attempt: true, stat: 'Agility' },
    { message: 'I resist the urge to answer his taunt and hold my nerve.', attempt: true, stat: 'Will' },
    { message: '"Good evening, Captain," I say, smiling.', attempt: false },
    { message: '"Do you think it will rain tomorrow?" I ask.', attempt: false },
    { message: '(OOC: can we skip to the morning?)', attempt: false },
    { message: '"I missed you," I whisper.', attempt: false },
    { message: 'I nod and say, "Lead the way."', attempt: false },
    { message: '"Thank you for the tea," I tell her.', attempt: false },
];

test('detection: a judgment call runs for a turn with action and returns actor, attempt, stat, difficulty and stance; no attempt means no roll', async () => {
    reset();
    judgeAnswer = userText => {
        const message = userText.split('Player message: ')[1] || '';
        const hit = FIXTURES.find(f => f.message === message);
        return { attempts: hit?.attempt ? [{ actor: 'user', attempt: message.slice(2, 40), stat: hit.stat, difficulty: 'Hard', stance: 'neutral' }] : [] };
    };
    let modelPass = 0, codePass = 0;
    for (const f of FIXTURES) {
        judged.length = 0;
        const { rolls, receipt } = await judgeMod.judgeTurn({ message: f.message, lastReply: '', scene: '', npcNames: [] }, { deps: desktopDeps });
        if ((rolls.length > 0) === f.attempt && (!f.attempt || rolls[0].stat === f.stat)) modelPass++;
        if (f.attempt) {
            assert.equal(judged.length, 1, `a judgment call ran for: ${f.message}`);
            for (const key of ['actor', 'attempt', 'stat', 'step', 'stance']) assert.ok(rolls[0][key], `${key} is set`);
        } else assert.equal(rolls.length, 0, `no roll for: ${f.message}`);
        if (!f.attempt && receipt.skipped) assert.equal(judged.length, 0, 'a turn with no action by anyone sends no call');
        // The code route alone (no model answers).
        const code = await judgeMod.judgeTurn({ message: f.message }, { deps: { ...desktopDeps, desktop: async () => { throw new TypeError('Failed to fetch'); } } });
        if ((code.rolls.length > 0) === f.attempt) codePass++;
        decide.resetJudgmentHealth();
    }
    console.log(`detection pass rate: judgment ${modelPass}/${FIXTURES.length}, code fallback alone ${codePass}/${FIXTURES.length}`);
    assert.equal(modelPass, FIXTURES.length);
    assert.ok(codePass >= FIXTURES.length - 2, `the code fallback misses at most two fixtures (${codePass}/${FIXTURES.length})`);
});

test('an NPC attempt is detected and rolled with the NPC\'s own stats', async () => {
    reset();
    sheets.applyInferred('Brannic', { name: 'Brannic', stats: { Strength: 4 } });
    judgeAnswer = () => ({ attempts: [{ actor: 'Brannic', attempt: 'grab the satchel from Mira', stat: 'Strength', difficulty: 'Fair', stance: 'resisting' }] });
    const { rolls } = await judgeMod.judgeTurn({ message: 'I hold the satchel close.', lastReply: 'Brannic lunges for the satchel.', npcNames: ['Brannic'] }, { deps: desktopDeps, random: () => 9 });
    assert.equal(rolls.length, 1);
    assert.deepEqual({ actor: rolls[0].actor, name: rolls[0].name, mod: rolls[0].mod, total: rolls[0].total, dc: rolls[0].dc }, { actor: 'Brannic', name: 'Brannic', mod: 4, total: 14, dc: 14 });
    assert.match(judged[0].user, /NPCs in the scene: Brannic\./);
    assert.match(judged[0].user, /Last reply: Brannic lunges/);
});

test('the die button queues a named roll whose stat and difficulty replace detection for that attempt', async () => {
    reset();
    host.chat = [user('I try to pick the lock.')];
    dice.queueRoll({ actor: 'user', stat: 'Wits', dc: 17 });
    judgeAnswer = () => ({ attempts: [{ actor: 'user', attempt: 'pick the lock', stat: 'Agility', difficulty: 'Easy', stance: 'neutral' },
        { actor: 'Brannic', attempt: 'shout for the guard', stat: 'Charm', difficulty: 'Fair', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    const turn = judgeMod.pendingTurn();
    const mine = turn.rolls.filter(r => r.actor === 'user');
    assert.equal(mine.length, 1, 'one roll for her attempt');
    assert.deepEqual({ stat: mine[0].stat, dc: mine[0].dc, attempt: mine[0].attempt, source: mine[0].source }, { stat: 'Wits', dc: 17, attempt: 'pick the lock', source: 'die button' });
    assert.ok(turn.rolls.some(r => r.actor === 'Brannic'), 'the NPC attempt is still rolled');
    assert.equal(dice.queuedRoll(), null, 'the queued roll is used once');
    assert.match(prompts.get(dice.DICE_PROMPT_KEY).value, /Mira's attempt to pick the lock/);
    assert.deepEqual([prompts.get(dice.DICE_PROMPT_KEY).position, prompts.get(dice.DICE_PROMPT_KEY).depth], [1, 0], 'in chat at depth 0');
});

// ---------------------------------------------------------------- the turn, swipes, branches and Dice off

test('the reply stores its rolls with its swipe; a swipe judges and rolls again; a continue keeps; a branch copies', async () => {
    reset();
    host.chat = [user('I try to climb the wall.')];
    judgeAnswer = () => ({ attempts: [{ actor: 'user', attempt: 'climb the wall', stat: 'Agility', difficulty: 'Hard', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    assert.equal(judged.length, 1, 'one judgment call before the reply');
    host.chat.push(reply('She climbs.'));
    await emit('MESSAGE_RECEIVED', 1);
    await emit('GENERATION_ENDED');
    assert.equal(prompts.get(dice.DICE_PROMPT_KEY).value, '', 'the verdict leaves once the reply is done');
    const first = dice.diceOf(host.chat[1]);
    assert.equal(first.rolls.length, 1);
    assert.equal(host.chat[1].swipe_info[0].extra[KEY].dice.rolls[0].die, first.rolls[0].die, 'kept in the swipe slot too');
    assert.equal(first.judge.words, '1 model call · extra request', 'the Sent receipt carries the extension-added call words');
    // a swipe: SillyTavern adds the new swipe (with empty extra), then generates; judgment and roll run again
    const m = host.chat[1];
    m.swipes.push(''); m.swipe_info.push({ extra: {} }); m.swipe_id = 1; m.extra = {};
    judged.length = 0;
    judgeAnswer = () => ({ attempts: [{ actor: 'user', attempt: 'climb the wall', stat: 'Strength', difficulty: 'Easy', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'swipe', {}, false);
    assert.equal(judged.length, 1, 'a swipe sends one new judgment call');
    assert.match(String(judged[0].user), /I try to climb the wall/, 'the swipe judges the message the swiped reply answered');
    assert.equal(judgeMod.pendingTurn().rolls[0].stat, 'Strength', 'the swipe is told its own roll'); assert.equal(prompts.get(dice.DICE_PROMPT_KEY).value, dice.verdictText(judgeMod.pendingTurn().rolls));
    m.mes = 'She climbs again.'; m.swipes[1] = m.mes;
    await emit('MESSAGE_RECEIVED', 1);
    const second = dice.diceOf(m, 1);
    assert.equal(second.rolls[0].stat, 'Strength', 'the new swipe holds its own roll');
    assert.equal(second.swipe, 1);
    assert.equal(dice.diceOf(m, 0).rolls[0].stat, 'Agility', 'the first swipe keeps its own roll');
    assert.equal(dice.diceOf(m, 0).rolls[0].die, first.rolls[0].die);
    // going back to the first swipe: SillyTavern restores that swipe's extra
    m.swipe_id = 0; m.mes = m.swipes[0]; m.extra = structuredClone(m.swipe_info[0].extra);
    assert.equal(dice.rollsOf(m)[0].stat, 'Agility', 'swiping back shows the earlier swipe\'s roll');
    // a continue keeps the continued swipe's roll and sends no judgment call
    judged.length = 0;
    await emit('GENERATION_AFTER_COMMANDS', 'continue', {}, false);
    assert.equal(judged.length, 0, 'a continue sends no judgment call');
    await emit('MESSAGE_RECEIVED', 1);
    assert.equal(dice.diceOf(m).rolls[0].die, first.rolls[0].die, 'the continue keeps the continued swipe\'s roll unchanged');
    // a branch is a copy of the messages with their data
    const branch = structuredClone(host.chat);
    assert.deepEqual(dice.rollsOf(branch[1]), dice.rollsOf(m), 'a branch copies its rolls');
    assert.deepEqual(dice.diceOf(branch[1], 1)?.rolls, second.rolls, 'a branch copies the other swipe\'s roll too');
});

test('a queued die-button roll applies to the swipe it was queued for, then clears', async () => {
    reset();
    host.chat = [user('I try to climb the wall.'), reply('She climbs.')];
    const m = host.chat[1];
    m.swipes.push(''); m.swipe_info.push({ extra: {} }); m.swipe_id = 1;
    dice.queueRoll({ actor: 'user', attempt: 'climb the wall', stat: 'Wits', step: 'Easy' });
    await emit('GENERATION_AFTER_COMMANDS', 'swipe', {}, false);
    assert.equal(dice.queuedRoll(), null, 'the queue clears');
    await emit('MESSAGE_RECEIVED', 1);
    assert.equal(dice.diceOf(m, 1).rolls[0].stat, 'Wits', 'the swipe holds the queued roll');
    assert.equal(dice.diceOf(m, 1).rolls[0].source, 'die button');
});

test('with Dice off no judgment call runs, nothing rolls and nothing is sent', async () => {
    reset();
    store.settings().dice.on = false;
    host.chat = [user('I try to climb the wall.')];
    judgeAnswer = () => ({ attempts: [{ actor: 'user', attempt: 'climb', stat: 'Agility', difficulty: 'Hard', stance: 'neutral' }] });
    await emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
    host.chat.push(reply('She climbs.'));
    await emit('MESSAGE_RECEIVED', 1);
    assert.equal(judged.length, 0, 'request recorder: zero dice calls');
    assert.equal(prompts.get(dice.DICE_PROMPT_KEY).value, '');
    assert.equal(dice.diceOf(host.chat[1]), null);
    assert.throws(() => dice.queueRoll({ actor: 'user', stat: 'Wits' }), /Dice are off/);
    // the preset's Dice feature on Theirs counts as off too
    store.settings().dice.on = true;
    dice.setDiceFeatureReader(() => false);
    assert.equal(dice.diceOn(), false);
    dice.setDiceFeatureReader(null);
});

test('a reply saved before degrees keeps its result', () => {
    reset();
    const old = reply('Old reply.');
    old.extra[KEY] = { v10Check: { actor: 'user', name: 'Mira', action: 'force the door', stat: 'Strength', dc: 14, mod: 1, natural: 9, total: 10, result: 'failure' } };
    const [r] = dice.rollsOf(old);
    assert.deepEqual({ degree: r.degree, total: r.total, dc: r.dc, die: r.die }, { degree: 'failure', total: 10, dc: 14, die: 9 }, 'shown as it was rolled');
});

// ---------------------------------------------------------------- stat sheets

test('at chat start one call infers the persona\'s and the character\'s sheets from the card, each stat with a reason', async () => {
    reset();
    answers = [JSON.stringify({ sheets: [
        { who: 'Mira', stats: [{ stat: 'Agility', value: 3, reason: 'nimble fingers' }, { stat: 'Wits', value: 2, reason: 'quick-witted' }] },
        { who: 'Captain Hale', stats: [{ stat: 'Strength', value: 4, reason: 'strong as an ox' }, { stat: 'Charm', value: -1, reason: 'slow to trust' }] },
    ] })];
    const res = await sheets.inferChatSheets();
    assert.equal(res.ok, true);
    assert.equal(requests.length, 1, 'one model call');
    const sent = JSON.stringify(requests[0].args);
    assert.match(sent, /quick-witted smuggler/, 'the persona is sent');
    assert.match(sent, /scarred harbor captain/, 'the character card is sent');
    assert.equal(dice.sheet('user').Agility, 3);
    assert.equal(dice.sheet('char').Strength, 4);
    assert.equal(sheets.sheetOf('char').reasons.Strength, 'strong as an ox');
    assert.equal(await sheets.inferChatSheets(), null, 'once per chat');
});

test('an edited stat is marked as hers and inference run again leaves it unchanged', async () => {
    reset();
    answers = [JSON.stringify({ sheets: [{ who: 'Mira', stats: [{ stat: 'Agility', value: 3, reason: 'nimble' }] }] })];
    await sheets.inferChatSheets();
    dice.setStat('user', 'Agility', -2);
    assert.equal(sheets.sheetOf('user').mine.Agility, true, 'marked as hers');
    answers = [JSON.stringify({ sheets: [{ who: 'Mira', stats: [{ stat: 'Agility', value: 5, reason: 'nimble' }, { stat: 'Wits', value: 2, reason: 'clever' }] }] })];
    await sheets.inferChatSheets({ force: true });
    assert.equal(dice.sheet('user').Agility, -2, 'her value is unchanged');
    assert.equal(dice.sheet('user').Wits, 2, 'other values still infer');
});

test('an NPC described in a World Info book gets its sheet from that book, stored there as one added entry; her entries stay as written', async () => {
    reset();
    const book = { entries: {
        0: { uid: 0, key: ['Brannic'], comment: 'Brannic', content: 'Brannic is a hulking dockhand who can lift a cask alone but cannot read.', disable: false },
        1: { uid: 1, key: ['harbor'], comment: 'The harbor', content: 'Fog most mornings.', disable: false },
    } };
    books.set('Harbor book', structuredClone(book));
    host.chatMetadata.world_info = 'Harbor book';
    answers = [JSON.stringify({ sheets: [{ who: 'Brannic', stats: [{ stat: 'Strength', value: 5, reason: 'lift a cask alone' }, { stat: 'Wits', value: -2, reason: 'cannot read' }] }] })];
    const sheet = await sheets.inferNpcSheet('Brannic');
    assert.equal(sheet.stats.Strength, 5);
    assert.equal(sheet.source, 'book');
    assert.match(JSON.stringify(requests[0].args), /hulking dockhand/, 'inferred from that book');
    const saved = books.get('Harbor book');
    assert.equal(Object.keys(saved.entries).length, 3, 'one entry added');
    assert.deepEqual(saved.entries[0], book.entries[0], 'her entry stays byte for byte');
    assert.deepEqual(saved.entries[1], book.entries[1]);
    const added = saved.entries[2];
    assert.equal(added.comment, 'Stats: Brannic');
    assert.equal(added.disable, true, 'the added entry is disabled, so it is never sent');
    assert.match(added.content, /Strength: \+5/);
    // a later chat reads the sheet back from the book with no call
    host.chatMetadata = { world_info: 'Harbor book' };
    requests.length = 0;
    const again = await sheets.inferNpcSheet('Brannic');
    assert.equal(again.stats.Strength, 5);
    assert.equal(requests.length, 0);
});

test('an NPC who first acts during play gets a plain sheet at once and an inferred one stored with the chat', async () => {
    reset();
    answers = [JSON.stringify({ sheets: [{ who: 'Old Tess', stats: [{ stat: 'Senses', value: 3, reason: 'watches everything' }] }] })];
    const pending = sheets.inferNpcSheet('Old Tess', { storyText: 'Old Tess watches everything from her stall.' });
    const sheet = await pending;
    assert.equal(sheet.source, 'play');
    assert.equal(sheet.stats.Senses, 3);
    assert.ok(host.chatMetadata[KEY].statSheets['npc:old tess'], 'stored with the chat');
    assert.equal(books.size, 0, 'no book written');
});

test('the judge\'s request and every dice string hold no emoji and no dash', () => {
    const texts = [judgeMod.JUDGE_SYSTEM, judgeMod.judgeUser({ message: 'I try.', lastReply: 'He waits.', scene: 'Dock', npcNames: ['Brannic'] }), sheets.SHEET_SYSTEM,
        dice.VERDICT_HEAD, dice.VERDICT_RULE, dice.USER_RULE, ...dice.DEGREES.flatMap(d => [d.label, d.means]), judgeMod.JUDGE_CALL_WORDS, sheets.sheetEntryText('Brannic', { Strength: 2 })];
    for (const text of texts) {
        assert.doesNotMatch(text, /\p{Extended_Pictographic}|\uFE0F/u, text);
        assert.doesNotMatch(text, /[\u2013\u2014]/, text);
    }
});
