// B10: reply tray views, which cards show (Theirs and Ours), name matching, and loading on every exit path.
// Run with: node --test tests/t_reply_tray.js
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';

// dom.js prepares a canvas at load; a stub document lets the UI modules load without a page.
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const tray = await import('../src/ui/reply-tray.js');
const { effectiveModules, moduleOwnership } = await import('../src/v10.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let host;
beforeEach(() => {
    host = { name1: 'Heather', name2: 'Hale of Verath', extensionSettings: {}, chat: [], chatMetadata: {}, getCurrentChatId: () => 'chat-a',
        saveSettingsDebounced() {}, saveMetadataDebounced() {} };
    globalThis.SillyTavern = { getContext: () => host };
});

test('latest reply Compact and earlier replies Strip by default; the chat can choose', () => {
    const global = tray.normalizeTray(undefined);
    assert.equal(tray.trayView(true, {}, global), 'compact');
    assert.equal(tray.trayView(false, {}, global), 'strip');
    assert.equal(tray.trayView(true, { latest: 'expanded' }, global), 'expanded');
    assert.equal(tray.trayView(false, { earlier: 'compact' }, global), 'compact');
    assert.equal(tray.normalizeTray({ latest: 'huge' }).latest, 'compact', 'unknown views fall back');
});

test('a per-chat choice of where the tray shows', () => {
    const global = tray.normalizeTray({});
    assert.equal(global.where, 'every');
    assert.deepEqual([true, false].map(latest => tray.trayShows(latest, { where: 'latest' }, global)), [true, false]);
    assert.deepEqual([true, false].map(latest => tray.trayShows(latest, { where: 'none' }, global)), [false, false]);
    assert.deepEqual([true, false].map(latest => tray.trayShows(latest, {}, global)), [true, true]);
    host.chatMetadata.roleplay_instructions = { replyTray: { where: 'latest', latest: 'strip', earlier: 'bogus' } };
    assert.deepEqual(tray.chatTray(), { latest: 'strip', where: 'latest' });
});

test('no fixed height target: the views carry no size rule, and Card size is gone', () => {
    const css = readFileSync(join(root, 'src/ui/reply-tray.css'), 'utf8');
    assert.doesNotMatch(css, /max-height|45vh|(?:^|[^-])height:\s*(?:1[2-9]\d|200)px/m, 'no Compact 120 to 200 px or Expanded 45% cap');
    assert.deepEqual(Object.keys(tray.TRAY_DEFAULTS).sort(), ['cardText', 'cardTextScale', 'earlier', 'latest', 'sceneHeader', 'where']);
    const files = dir => readdirSync(dir).flatMap(name => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)]);
    const hits = files(join(root, 'src')).filter(path => /\.(js|css)$/.test(path) && /Card size|cardSize/.test(readFileSync(path, 'utf8')));
    assert.deepEqual(hits, []);
});

test('Card text works as in 6.5: Compact or Comfortable, 100% to 130%', () => {
    assert.deepEqual(tray.CARD_TEXT, { compact: 'Compact', comfortable: 'Comfortable' });
    assert.equal(tray.normalizeTray({ cardTextScale: 160 }).cardTextScale, 130);
    assert.equal(tray.normalizeTray({ cardTextScale: 90 }).cardTextScale, 100);
    assert.equal(tray.normalizeTray({ cardTextScale: 117 }).cardTextScale, 115, 'steps of 5');
    assert.equal(tray.normalizeTray({ cardText: 'comfortable' }).cardText, 'comfortable');
    const css = readFileSync(join(root, 'src/ui/reply-tray.css'), 'utf8');
    assert.match(css, /--ri-card-label: max\(12px, calc\(12px \* var\(--ri-card-text-scale\)\)\)/);
    assert.match(css, /--ri-card-data: max\(12px, calc\(13px \* var\(--ri-card-text-scale\)\)\)/);
    assert.match(css, /\[data-card-text="comfortable"\][^}]*13px[^}]*14px/s);
});

test('short names match full names: "Hale" finds "Hale of Verath"', () => {
    assert.equal(tray.inScene('Hale, Marten', 'Hale of Verath'), true);
    assert.equal(tray.inScene(['Hale', 'Marten'], 'Marten'), true);
    assert.equal(tray.inScene('Hale of Verath and Marten', 'Hale'), true, 'a saved short name finds the full name in the scene');
    assert.equal(tray.inScene('Hal, Marten', 'Hale of Verath'), false, 'a partial word is no match');
    assert.equal(tray.inScene('Annabel', 'Ann'), false);
    assert.equal(tray.inScene('the captain', 'Ilse Voss', ['the captain']), true, 'any saved short name');
    assert.equal(tray.inScene('', 'Hale of Verath'), true, 'no present list counts everyone');
});

// The Sola fixture: Neon Sola V5 selected, the tracker (scene and characters) set to Theirs, Roast set to Ours.
function solaFixture() {
    host.mainApi = 'openai';
    host.getPresetManager = () => ({ getSelectedPresetName: () => 'Neon Sola V5' });
    host.chatCompletionSettings = { prompts: [{ identifier: 'hud', name: 'Showrunner HUD (State Ledger)' }],
        prompt_order: [{ character_id: 100001, order: [{ identifier: 'hud', enabled: true }] }] };
    host.chatMetadata.roleplay_instructions = { v10: { enabled: true, modules: { roast: true },
        moduleOwners: { 'Neon Sola V5': { state: 'preset', roast: 'extension' } } } };
}
const card = (id, module, extra = {}) => ({ id, label: id, module, first: `${id} value`, ...extra });

test('a feature on Theirs shows none of its cards or Strip marks; features on Ours keep theirs', () => {
    solaFixture();
    assert.equal(moduleOwnership().state.usesExtension, false, 'tracker on Theirs');
    const modules = effectiveModules();
    assert.equal(modules.state, false);
    assert.equal(modules.roast, true, 'Roast on Ours');
    const cards = [
        card('scene', 'state', { strip: { place: 'Elerian Keep stables', time: '06:40' } }),
        card('characters', 'state', { names: ['Hale of Verath', 'Marten'] }),
        card('roast', 'roast'),
        card('emotions', 'emotions'),
        card('sent', undefined, { calls: ['Follow-through check'] }),
    ];
    for (const reply of [{ latest: true }, { latest: false }]) {
        const shown = tray.visibleCards(cards, modules);
        assert.deepEqual(shown.map(item => item.id), ['roast', 'emotions', 'sent'], `under ${reply.latest ? 'the latest' : 'an earlier'} reply`);
        const marks = tray.stripMarks(shown);
        assert.equal(marks.scene, null, 'no scene mark');
        assert.deepEqual(marks.people, [], 'no character marks');
        assert.deepEqual(marks.calls, ['Follow-through check']);
    }
    host.chatMetadata.roleplay_instructions.v10.moduleOwners['Neon Sola V5'] = { state: 'extension', roast: 'preset' };
    const flipped = tray.visibleCards(cards, effectiveModules()).map(item => item.id);
    assert.deepEqual(flipped, ['scene', 'characters', 'emotions', 'sent'], 'switching sides moves the cards with them');
    assert.equal(tray.stripMarks(tray.visibleCards(cards, effectiveModules())).scene.place, 'Elerian Keep stables');
});

const ON = { state: true, worldEvents: true, roast: true };
const section = (id, value) => ({ id, value });

test('loading shows only the Strip: phases Writing the reply and Capturing, a chip per card as it arrives', () => {
    const start = tray.loadingModel({ progress: { phase: 'context', display: {} }, streaming: true, modules: ON });
    assert.deepEqual([start.text, start.chips], ['Writing the reply', []], 'no placeholder ahead of time');
    const writing = tray.loadingModel({ progress: { phase: 'writing', sections: [] }, streaming: true, modules: ON });
    assert.equal(writing.text, 'Writing the reply');
    const receiving = tray.loadingModel({ progress: { phase: 'receiving', sections: [section('scene', { where: 'Stables' })] }, streaming: true, modules: ON });
    assert.equal(receiving.text, 'Capturing');
    assert.deepEqual(receiving.chips.map(chip => [chip.id, chip.state]), [['scene', 'arrived']]);
    const more = tray.loadingModel({ progress: { phase: 'receiving', hasPlan: true, display: { expectsPlan: true, entries: 2 },
        sections: [section('scene', { where: 'Stables' }), section('cast', [{ name: 'Hale' }]), section('changes', []), section('roast', 'Twice.')] }, streaming: true, modules: ON });
    assert.deepEqual(more.chips.map(chip => chip.id), ['scene', 'characters', 'plan', 'roast', 'lore'], 'an empty section lights nothing');
    assert.equal(tray.loadingModel({ progress: { phase: 'filing' }, modules: ON }).text, 'Capturing');
    const theirs = tray.loadingModel({ progress: { phase: 'receiving', sections: [section('scene', { where: 'x' }), section('roast', 'y')] }, modules: { state: false, roast: true } });
    assert.deepEqual(theirs.chips.map(chip => chip.id), ['roast'], 'a Theirs feature lights no chip');
});

test('with streaming off the Strip waits, then fills once at the end', () => {
    for (const phase of ['context', 'waiting', 'filing']) {
        const model = tray.loadingModel({ progress: { phase, display: { expectsPlan: true } }, streaming: false, modules: ON });
        assert.deepEqual(model.chips, [], `${phase}: nothing promised`);
    }
    assert.equal(tray.loadingModel({ progress: { phase: 'waiting' }, streaming: false, modules: ON }).text, 'Waiting for the reply');
    const end = tray.loadingModel({ progress: { phase: 'ready' }, streaming: false, modules: ON, end: 'resolved' });
    assert.equal(end.text, 'Reply captured');
    assert.ok(end.chips.every(chip => chip.state === 'missing'), 'filled once at the end; the tray takes over');
});

test('every exit path ends resolved, failed or stopped', () => {
    const paths = {
        'reply filed': { lastPhase: 'ready' },
        'reply checked with no update': { lastPhase: 'filing' },
        'reply arrived, nothing filed': { lastPhase: 'writing', replyArrived: true },
        'host error, no reply': { lastPhase: 'waiting' },
        'empty reply while streaming': { lastPhase: 'writing' },
        'Stop pressed': { lastPhase: 'writing', stopped: true },
        'Stop after filing began': { lastPhase: 'filing', stopped: true },
        'chat changed': { lastPhase: 'receiving', chatChanged: true },
    };
    const ends = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, tray.loadingExit(path)]));
    assert.deepEqual(ends, {
        'reply filed': 'resolved', 'reply checked with no update': 'resolved', 'reply arrived, nothing filed': 'resolved',
        'host error, no reply': 'failed', 'empty reply while streaming': 'failed',
        'Stop pressed': 'stopped', 'Stop after filing began': 'stopped', 'chat changed': 'stopped',
    });
    const progress = { phase: 'receiving', sections: [section('scene', { where: 'Stables' })] };
    const stopped = tray.loadingModel({ progress, modules: ON, end: 'stopped' });
    assert.equal(stopped.text, 'Stopped; partial content kept');
    assert.deepEqual(stopped.chips.map(chip => `${chip.id}:${chip.state}`), ['scene:arrived', 'characters:missing', 'changes:missing', 'roast:missing'],
        'partial content kept and labeled');
    const failed = tray.loadingModel({ progress, modules: ON, end: 'failed' });
    assert.equal(failed.text, 'The reply did not arrive');
    assert.ok(failed.chips.every(chip => chip.state === 'arrived'), 'a failed Strip promises nothing more');
    for (const end of ['resolved', 'failed', 'stopped']) assert.ok(tray.LOADING_TEXT[end]);
});
