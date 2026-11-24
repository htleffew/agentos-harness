// B38: model request settings default to the routed desktop. Run with: node --test tests/t_execution_defaults.js
// Every function is Automatic (its tier chain) or Fixed (one connection that sticks, with an optional fall back). The
// screen and the receipt name the route that resolveChain returns, for every function, whether the shared profile is
// inherited or she saved a connection for the function herself.
import assert from 'node:assert/strict';
import test from 'node:test';

const KEY = 'roleplay_instructions';
const profiles = [
    { id: 'p-desktop', name: 'Gemma over Tailscale', api: 'custom', model: 'gemma4:12b', 'api-url': 'http://100.97.15.107:11434/v1' },
    { id: 'p-nano', name: 'nanogpt z-ai/glm-5.2 Sola', api: 'nanogpt', model: 'z-ai/glm-5.2' },
    { id: 'p-or', name: 'OpenRouter flash', api: 'openrouter', model: 'deepseek/flash' },
];
const host = {
    extensionSettings: { [KEY]: {}, connectionManager: { profiles }, disabledExtensions: [] },
    saveSettingsDebounced() {}, getCurrentChatId: () => 'chat-1', chat: [], characters: [], name1: 'Mira', name2: 'Captain',
    mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openrouter' },
    ConnectionManagerRequestService: { getSupportedProfiles: () => profiles, sendRequest: async () => ({}) },
};
globalThis.SillyTavern = { getContext: () => host };
const reset = (extra = {}) => { host.extensionSettings[KEY] = { ...extra }; };

const { EXECUTION_OPERATIONS, OPERATION_JOBS, executionPreview, executionSetting, resolveChain, chainSummary, firstStep, setExecutionSetting, automaticAllowed } =
    await import('../src/execution.js');
const { chainFor } = await import('../src/routing.js');
const ops = Object.keys(EXECUTION_OPERATIONS);
const TAPPED = ['playerDraft', 'playerChoices', 'playerExpansion', 'historicalSwipe', 'historicalContinue'];
const NANO = 'nanogpt z-ai/glm-5.2 Sola';

// What the preview must say for the chain the resolver returned, built from that chain alone.
function expectedConnection(op, chain) {
    const { mode, fallback } = executionSetting(op);
    if (mode === 'auto') return `Automatic: ${chainSummary(chain)}. Runs first today: ${firstStep(chain)}`;
    const head = chain[0].route === 'override' ? `Connection profile: ${profiles.find(p => p.id === chain[0].profileId).name}` : null;
    if (fallback) return `${head ?? 'Main API'}. If it fails, falls back to ${chainSummary(chain.slice(1))}`;
    return head;
}

test('the preview names the route resolveChain runs, for every function, with an inherited legacy profile', () => {
    reset({ profileId: 'p-nano' });
    for (const op of ops) {
        const chain = resolveChain(op), preview = executionPreview(op);
        const expected = expectedConnection(op, chain);
        if (expected) assert.equal(preview.connection, expected, op);
        else assert.match(preview.connection, /^Main API/, op);
        assert.equal(preview.profileId, chain[0].route === 'override' ? chain[0].profileId : '', op);
        assert.ok(!chain.some(entry => entry.profileId === 'p-nano'), `${op}: the inherited shared profile fixes nothing`);
        if (OPERATION_JOBS[op]) assert.equal(chain[0].route, 'desktop', `${op} starts on the desktop`);
    }
});

test('the preview names the route resolveChain runs, for every function, with a profile she saved herself', () => {
    for (const op of ops) {
        if (EXECUTION_OPERATIONS[op].mainOnly) continue;
        for (const fallback of [false, true]) {
            reset({ profileId: 'p-or' });
            setExecutionSetting(op, { mode: 'fixed', profileId: 'p-nano', fallback });
            const chain = resolveChain(op);
            assert.deepEqual(chain[0], { route: 'override', profileId: 'p-nano' }, op);
            assert.equal(chain.length > 1, fallback, `${op} fallback ${fallback}`);
            const preview = executionPreview(op);
            assert.equal(preview.connection, expectedConnection(op, chain), op);
            assert.ok(preview.connection.startsWith(`Connection profile: ${NANO}`), op);
            assert.equal(preview.profileId, 'p-nano', op);
        }
    }
});

test('Automatic labels each step with its kind, the profile name and the step that runs first today', () => {
    reset();
    const text = executionPreview('chapterSummary').connection;
    assert.match(text, /^Automatic: Tailscale: Desktop over Tailscale \(Gemma over Tailscale\), then Backup: NanoGPT \(nanogpt z-ai\/glm-5\.2 Sola\), then Backup: free tiers, then /);
    assert.match(text, /, then Main: Main API\. Runs first today: Tailscale: Desktop over Tailscale \(Gemma over Tailscale\)$/);
    assert.deepEqual(resolveChain('chapterSummary'), chainFor('chapter'));
});

test('Fixed sticks: Main API or a profile is the only route unless fall back is on', () => {
    reset();
    for (const pick of ['', 'p-or']) {
        setExecutionSetting('chapterSummary', { mode: 'fixed', profileId: pick });
        assert.equal(executionSetting('chapterSummary').mode, 'fixed');
        const chain = resolveChain('chapterSummary');
        assert.equal(chain.length, 1, 'no desktop or other route is substituted');
        assert.equal(chain[0].route, pick ? 'override' : 'main');
        assert.equal(executionSetting('chapterSummary').fallback, false, 'fall back is off by default');
    }
    setExecutionSetting('chapterSummary', { fallback: true });
    assert.equal(executionSetting('chapterSummary').profileId, 'p-or', 'the checkbox keeps the pick');
    assert.deepEqual(resolveChain('chapterSummary'), [{ route: 'override', profileId: 'p-or' }, ...chainFor('chapter')]);
    setExecutionSetting('chapterSummary', { profileId: '' });
    const onMain = resolveChain('chapterSummary');
    assert.equal(onMain[0].route, 'main');
    assert.deepEqual(onMain.slice(1).map(e => e.route), chainFor('chapter').map(e => e.route).filter(r => r !== 'main'), 'the chain follows Main API without repeating it');
    setExecutionSetting('chapterSummary', { mode: 'auto' });
    assert.deepEqual(resolveChain('chapterSummary'), chainFor('chapter'));
    assert.equal(executionSetting('chapterSummary').fallback, false);
});

test('job-backed functions start Automatic, tapped functions start Fixed on Main API, and saved picks stay Fixed', () => {
    reset({ profileId: 'p-nano' });
    for (const op of ops) {
        if (EXECUTION_OPERATIONS[op].mainOnly) continue;
        assert.equal(executionSetting(op).mode, OPERATION_JOBS[op] ? 'auto' : 'fixed', op);
    }
    for (const op of TAPPED) {
        assert.deepEqual(resolveChain(op), [{ route: 'main' }], op);
        assert.match(executionPreview(op).connection, /^Main API/, op);
    }
    // A profile saved before modes existed stays Fixed on that profile.
    for (const op of ['playerDraft', 'playerChoices', 'playerExpansion', 'chapterSummary']) {
        reset();
        host.extensionSettings[KEY].execution = { version: 1, functions: { [op]: { profileId: 'p-nano', automatic: false } } };
        assert.equal(executionSetting(op).mode, 'fixed', op);
        assert.deepEqual(resolveChain(op), [{ route: 'override', profileId: 'p-nano' }], op);
        assert.equal(executionPreview(op).connection, `Connection profile: ${NANO}`, op);
    }
});

test('automatic requests default on for summaries, combining and the directions check, and off for replacing a reply', () => {
    reset();
    for (const op of ['chapterSummary', 'chapterCombine', 'instructionCheck']) assert.equal(automaticAllowed(op), true, op);
    assert.equal(automaticAllowed('automaticSwipe'), false);
    assert.equal(automaticAllowed('factRepair'), false);
    setExecutionSetting('chapterSummary', { automatic: false });
    assert.equal(automaticAllowed('chapterSummary'), false, 'her own switch is kept');
    setExecutionSetting('chapterSummary', { mode: 'fixed', profileId: 'p-or' });
    assert.equal(automaticAllowed('chapterSummary'), false, 'choosing a connection leaves the switch alone');
    setExecutionSetting('instructionCheck', { profileId: 'p-or' });
    assert.equal(automaticAllowed('instructionCheck'), true);
    assert.throws(() => setExecutionSetting('automaticSwipe', { profileId: 'p-or' }));
});
