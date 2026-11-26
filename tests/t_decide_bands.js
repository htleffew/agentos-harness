// MB15: the unsure band on judgment answers. Run with: node --test tests/t_decide_bands.js
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const FAKE_KEY = 'sk-or-FAKE-not-a-real-key-0000';
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles: [] }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter', custom_include_body: '' },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    getPresetManager: () => ({ getCompletionPresetByName: () => undefined }),
    ConnectionManagerRequestService: { getSupportedProfiles: () => [] },
};
globalThis.SillyTavern = { getContext: () => host };
globalThis.toastr = { warning() {}, info() {}, error() {} };
const calls = [];
let plan = null;
globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ answers: plan, usage: { input_tokens: 100, output_tokens: 0 } }), { status: 200 });
};
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const decide = await import('../src/memory/decide.js');
const { readBand, BANDS, DICE, ASIDE } = decide;

const downDeps = () => ({ lane: fn => fn(), desktop: async () => { throw new TypeError('Failed to fetch'); }, phoneReady: async () => false });
const diceAnswers = attempt => ({ attempt: { noul: attempt }, stat: { choice: 'Agility' }, difficulty: { choice: 'Hard' }, stance: { choice: 'neutral' } });

test('each judgment question carries 0.7 and 0.3 cuts and a default of no', () => {
    for (const key of ['attempt', 'aside']) assert.deepEqual({ ...BANDS[key] }, { upper: 0.7, lower: 0.3, default: false });
    assert.equal(DICE.decision.bands.attempt, BANDS.attempt);
    assert.equal(ASIDE.decision.bands.aside, BANDS.aside);
});

test('at or above the upper cut is yes, at or below the lower cut is no, between takes the default', () => {
    const b = BANDS.attempt;
    assert.deepEqual(readBand(0.7, b), { yes: true, unsure: false, score: 0.7 });
    assert.deepEqual(readBand(0.99, b), { yes: true, unsure: false, score: 0.99 });
    assert.deepEqual(readBand(0.3, b), { yes: false, unsure: false, score: 0.3 });
    assert.deepEqual(readBand(0.01, b), { yes: false, unsure: false, score: 0.01 });
    for (const score of [0.31, 0.5, 0.51, 0.69]) assert.deepEqual(readBand(score, b), { yes: false, unsure: true, score });
    assert.equal(readBand(0.5, { upper: 0.7, lower: 0.3, default: true }).yes, true, 'a yes default would apply in the band');
    for (const bad of [undefined, null, 'x', NaN]) assert.deepEqual(readBand(bad, b), { yes: false, unsure: false, score: null });
});

test('fromAnswers uses the band for attempt and aside', () => {
    assert.equal(DICE.decision.fromAnswers(diceAnswers(0.51), { message: 'I try to climb.' }).attempt, false, '0.51 no longer rolls');
    assert.equal(DICE.decision.fromAnswers(diceAnswers(0.7), { message: 'I try to climb.' }).attempt, true);
    assert.equal(ASIDE.decision.fromAnswers({ aside: { noul: 0.6 } }).aside, false);
    assert.equal(ASIDE.decision.fromAnswers({ aside: { noul: 0.85 } }).aside, true);
});

test('the receipt names the score and says the default applied, and a settled score has none', () => {
    assert.deepEqual(decide.unsureReceipts(diceAnswers(0.52), DICE.decision.bands),
        ['attempt scored 0.52, between 0.3 and 0.7, so the default (no) applied']);
    assert.deepEqual(decide.unsureReceipts(diceAnswers(0.93), DICE.decision.bands), []);
    assert.deepEqual(decide.unsureReceipts({}, DICE.decision.bands), []);
});

test('an unsure score adds no call: one decisions request, no other route, the receipt on the result', async () => {
    decide.resetJudgmentHealth();
    decide.setJevKey(FAKE_KEY);
    calls.length = 0;
    plan = diceAnswers(0.55);
    const res = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    assert.equal(calls.length, 1, 'the same one call as a settled score');
    assert.equal(res.route, 'jev');
    assert.equal(res.value.attempt, false);
    assert.deepEqual(res.unsure, ['attempt scored 0.55, between 0.3 and 0.7, so the default (no) applied']);
    const jev = res.attempts.find(a => a.route === 'jev');
    assert.equal(jev.outcome, 'answered');
    assert.match(jev.reason, /attempt scored 0.55/);

    calls.length = 0;
    plan = diceAnswers(0.93);
    const sure = await decide.judgeDice({ message: 'I try to climb the wall.' }, downDeps());
    assert.equal(calls.length, 1);
    assert.equal(sure.value.attempt, true);
    assert.equal('unsure' in sure, false);
});
