// Composer bar logic without a page: kinds and cost words, the quick action schema and migration,
// pointer cancellation, pin fitting, the Generate sheet's words, size settings and the page registry.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    accessibleName, BAR_DEFAULT_PINS, barPins, composerBar, costWords, kindOf, listQuickActions, migrateComposerBar, moveBarPin,
    optionsRequest, pinToBar, QUICK_ACTION_KINDS, readQuickAction, saveQuickAction, setBarFolded,
} from '../../src/quick-actions.js';
import { LOOK_DEFAULTS, normalizeLook } from '../../src/ui/theme/styles.js';
import { registerPage, registryView, renderRegistered, unregisterPage } from '../../src/ui/page-registry.js';
import * as destinations from '../../src/ui/destinations.js';

// dom.js prepares a canvas at load; a stub document lets the UI modules load without a page.
globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const { createPressTracker, fitPins, HOLD_MS } = await import('../../src/ui/composer-bar.js');
const { sheetText } = await import('../../src/ui/generate-sheet.js');

let host;
beforeEach(() => {
    host = { name1: 'Elin', name2: 'Tavi', extensionSettings: {}, chat: [], chatMetadata: {}, getCurrentChatId: () => 'A',
        saveSettingsDebounced() {} };
    globalThis.SillyTavern = { getContext: () => host };
});

test('kinds carry their call type; only Options adds a model call', () => {
    assert.deepEqual(Object.keys(QUICK_ACTION_KINDS), ['options', 'swipe', 'continue', 'impersonate', 'direction', 'check', 'review']);
    const calls = Object.fromEntries(Object.entries(QUICK_ACTION_KINDS).map(([kind, def]) => [kind, def.call]));
    assert.deepEqual(calls, { options: 'extra', swipe: 'reply', continue: 'reply', impersonate: 'reply', direction: 'code', check: 'code', review: 'code' });
    assert.equal(costWords('options', 'DeepSeek V3'), '1 model call · extra request · DeepSeek V3');
    assert.equal(costWords('swipe', 'DeepSeek V3'), 'SillyTavern’s reply request · DeepSeek V3');
    assert.equal(costWords('review', 'DeepSeek V3'), 'Runs in code');
    assert.equal(accessibleName({ title: 'NPC options', kind: 'options' }), 'NPC options, 1 model call, extra request');
    assert.equal(accessibleName({ title: 'Swipe', family: 'swipe' }), 'Swipe, SillyTavern’s reply request');
    assert.equal(kindOf({ family: 'draft' }), 'impersonate');
    assert.equal(kindOf({ family: 'steer' }), 'direction');
});

test('first load pins the 4.11 defaults in order; new Options start at 4 Medium', () => {
    assert.deepEqual(composerBar().pins, [...BAR_DEFAULT_PINS]);
    assert.deepEqual(barPins().map(action => [action.title, action.kind]),
        [['NPC options', 'options'], ['Swipe', 'swipe'], ['Continue', 'continue'], ['Review', 'review'], ['Bring in conflict', 'direction']]);
    const npc = readQuickAction('builtin:options:npc');
    assert.equal(npc.count, 4);
    assert.equal(npc.length, 'medium');
    assert.match(optionsRequest(npc).prompt, /four to six sentences\.$/);
    const added = saveQuickAction({ kind: 'options', title: 'Rumors', prompt: 'Suggest rumors.', count: 4, length: 'medium' });
    assert.equal(added.kind, 'options');
    assert.equal(optionsRequest(added).count, 4);
    assert.throws(() => saveQuickAction({ kind: 'options', title: 'Empty', prompt: ' ' }), /prompt/);
    // Bar kinds stay out of the older family lists, which keep working as before.
    assert.ok(!listQuickActions().some(action => action.barOnly || action.family === 'options'));
    assert.ok(listQuickActions('', { allKinds: true }).some(action => action.id === 'builtin:review:sent'));
    // Ask first and Card tap does are gone from the schema.
    assert.ok(!('askFirst' in npc) && !('cardTap' in npc));
});

test('existing composer slots migrate without loss', () => {
    host.extensionSettings.roleplay_instructions = {
        quickToolbarShortcuts: ['suggestions', 'steer', 'draft', 'suggestions', 'action:custom-1', 'swipe'],
        quickToolbarSuggestions: { 2: { icon: 'fa-feather' }, 3: { label: 'Rumors', icon: 'fa-key', count: 6, prompt: 'Suggest rumors.', set: 'set-a' } },
    };
    host.extensionSettings.roleplay_instructions.quickActions = { actions: { 'custom-1': { family: 'swipe', title: 'Rain', text: 'Mention the rain.', delivery: {} } } };
    const bar = migrateComposerBar();
    assert.deepEqual(bar.pins, [...BAR_DEFAULT_PINS, 'builtin:draft:plain', 'action:migrated-options-3', 'custom-1', 'builtin:swipe:plain']
        .filter((id, index, all) => all.indexOf(id) === index));
    const rumors = readQuickAction('action:migrated-options-3');
    assert.deepEqual([rumors.title, rumors.icon, rumors.count, rumors.prompt, rumors.set, rumors.kind], ['Rumors', 'fa-key', 6, 'Suggest rumors.', 'set-a', 'options']);
    assert.equal(optionsRequest(rumors).prompt, 'Suggest rumors.');
    assert.equal(readQuickAction('builtin:draft:plain').icon, 'fa-feather');
    assert.equal(bar.notes.length, 1);
});

test('pins move, unpin and fold, and the fold persists in settings', () => {
    assert.equal(moveBarPin('builtin:swipe:plain', -1), true);
    assert.equal(composerBar().pins[0], 'builtin:swipe:plain');
    assert.equal(moveBarPin('builtin:swipe:plain', -1), false);
    assert.equal(pinToBar('builtin:review:sent', false), true);
    assert.ok(!composerBar().pins.includes('builtin:review:sent'));
    assert.equal(pinToBar('builtin:check:d20', true), true);
    setBarFolded(true);
    assert.equal(host.extensionSettings.roleplay_instructions.quickActions.bar.folded, true);
});

test('a tap acts on release inside the icon; move-off, scroll and hold cancel it', () => {
    const timers = [];
    const events = [];
    const tracker = createPressTracker({ onTap: () => events.push('tap'), onHold: () => events.push('hold'),
        setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: id => { if (timers[id - 1]) timers[id - 1].fn = () => {}; } });
    tracker.down({ x: 10, y: 10 });
    assert.equal(timers[0].ms, HOLD_MS);
    tracker.up({ inside: true });
    assert.deepEqual(events, ['tap']);
    tracker.down({ x: 10, y: 10 });
    tracker.up({ inside: false });
    tracker.down({ x: 10, y: 10 });
    tracker.move({ x: 10, y: 40 });
    tracker.up({ inside: true });
    tracker.down({ x: 10, y: 10 });
    tracker.cancel();
    tracker.up({ inside: true });
    tracker.down({ x: 10, y: 10 });
    timers.at(-1).fn();
    tracker.up({ inside: true });
    assert.deepEqual(events, ['tap', 'hold']);
});

test('pins that fit at 523 px: 9 in Compact and 6 in Comfortable', () => {
    // Widths measured in SillyTavern 1.19.0 at 523 px: row 523 with 4 or 8 px side padding, status slot hit + 96 px.
    assert.equal(fitPins({ width: 515, hit: 32, gap: 4, status: 128, more: 32, count: 14 }).shown, 9);
    assert.equal(fitPins({ width: 507, hit: 44, gap: 8, status: 140, more: 44, count: 14 }).shown, 6);
    assert.deepEqual(fitPins({ width: 515, hit: 32, gap: 4, status: 128, more: 32, count: 5 }), { shown: 5, overflow: 0, fits: 9 });
    assert.equal(fitPins({ width: 515, hit: 32, gap: 4, status: 128, more: 32, queue: 40, count: 14 }).shown, 8);
});

test('the Generate sheet matches the 4.4 table for its four kinds', () => {
    const npc = { title: 'NPC options', kind: 'options', count: 4, prompt: 'Suggest a new NPC.' };
    assert.deepEqual(sheetText('options', npc, 'DeepSeek V3'), { title: 'NPC options', cost: '1 model call · extra request · DeepSeek V3', call: 'extra', dot: true,
        boxLabel: 'Steer these options', generate: 'Generate 4 options', saved: 'Prompt: Suggest a new NPC.' });
    const swipe = sheetText('swipe', { title: 'More emotional', text: 'Let them show it.' });
    assert.deepEqual([swipe.boxLabel, swipe.generate, swipe.dot, swipe.saved], ['Add to this swipe', 'Swipe', false, 'Direction: More emotional']);
    assert.equal(sheetText('swipe', { title: 'Swipe', text: '' }).saved, 'No saved direction');
    assert.deepEqual([sheetText('continue', { title: 'Continue' }).boxLabel, sheetText('continue', { title: 'Continue' }).generate], ['Add to this continue', 'Continue']);
    const me = sheetText('impersonate', { title: 'Impersonate' });
    assert.deepEqual([me.boxLabel, me.generate, me.cost], ['Add to my message', 'Impersonate', 'SillyTavern’s reply request']);
    assert.equal(sheetText('options', { ...npc, count: 1 }).generate, 'Generate 1 option');
    assert.throws(() => sheetText('direction', { title: 'x' }));
});

test('size settings clamp to their ranges', () => {
    assert.deepEqual(normalizeLook(undefined), { ...LOOK_DEFAULTS });
    const look = normalizeLook({ text: 'comfortable', textScale: 90, icons: 'huge', iconScale: 200, targets: 'comfortable', targetScale: 85, sheetHeight: 42 });
    assert.deepEqual(look, { text: 'comfortable', textScale: 100, icons: 'compact', iconScale: 130, targets: 'comfortable', targetScale: 85, sheetHeight: 40 });
});

test('a registered page joins the navigation and renders without panel edits', () => {
    const view = registryView(destinations);
    const rendered = [];
    registerPage({ id: 'fixture-page', group: 'review', label: 'Fixture page', help: 'A test page.', aliases: 'zebra', render: body => rendered.push(body) });
    assert.ok(view.groups.find(group => group.id === 'review').pages.some(page => page.id === 'fixture-page'));
    assert.equal(view.destination('fixture-page').section, 'Review');
    assert.equal(view.destination('sent').id, 'sent');
    assert.equal(view.findDestinations('zebra')[0].id, 'fixture-page');
    assert.equal(renderRegistered('fixture-page', 'BODY', {}), true);
    assert.deepEqual(rendered, ['BODY']);
    assert.equal(renderRegistered('sent', 'BODY', {}), false);
    // A view made later also sees pages registered earlier.
    assert.ok(registryView(destinations).groups.find(group => group.id === 'review').pages.some(page => page.id === 'fixture-page'));
    unregisterPage('fixture-page');
    assert.ok(!view.groups.find(group => group.id === 'review').pages.some(page => page.id === 'fixture-page'));
    assert.throws(() => registerPage({ id: 'x', group: 'review', label: 'X' }), /render/);
});
