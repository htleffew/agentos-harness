// Quick actions, Bar and Library without a page: the field table of DESIGN.md 4.3, drafts and validation, the icon
// grid, the cost line, This chat pins and the preview arithmetic.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { barPins, composerBar, hasChatBar, listQuickActions, moveBarPin, pinToBar, readQuickAction, saveQuickAction, useChatBar } from '../../src/quick-actions.js';
import { registeredPage } from '../../src/ui/page-registry.js';

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const { costLine, draftError, draftOf, draftToAction, fieldsFor, ICONS, iconMatches, kindDefaults } = await import('../../src/ui/quick-action-fields.js');
const { previewFit, previewWords } = await import('../../src/ui/quick-action-bar-editor.js');
await import('../../src/ui/quick-action-library.js');

let host;
beforeEach(() => {
    host = { name1: 'Elin', name2: 'Tavi', extensionSettings: {}, chat: [], chatMetadata: {}, getCurrentChatId: () => 'A', saveSettingsDebounced() {}, saveMetadata() {} };
    globalThis.SillyTavern = { getContext: () => host };
});

test('every field of the 4.3 table is offered for the kinds that carry it, and no retired field remains', () => {
    assert.deepEqual(fieldsFor('options'), ['title', 'icon', 'pinned', 'connection', 'count', 'length', 'prompt', 'set', 'autoOpen', 'insertMode']);
    assert.deepEqual(fieldsFor('swipe'), ['title', 'icon', 'pinned', 'connection', 'text', 'visibility', 'required', 'rollD20', 'freshStart']);
    assert.deepEqual(fieldsFor('continue'), fieldsFor('swipe'));
    assert.deepEqual(fieldsFor('impersonate'), ['title', 'icon', 'pinned', 'connection', 'prompt', 'insertMode', 'text']);
    assert.deepEqual(fieldsFor('direction'), ['title', 'icon', 'pinned', 'text', 'visibility', 'required', 'rollD20', 'freshStart']);
    assert.deepEqual(fieldsFor('check'), ['title', 'icon', 'pinned', 'stat', 'difficulty', 'who']);
    assert.deepEqual(fieldsFor('review'), ['title', 'icon', 'pinned', 'opens']);
    const all = new Set(['options', 'swipe', 'continue', 'impersonate', 'direction', 'check', 'review'].flatMap(fieldsFor));
    assert.ok(!all.has('askFirst') && !all.has('cardTap'));
});

test('defaults match the table: 4 Medium options, insert at cursor, Private, Optional, Fresh start off', () => {
    const options = kindDefaults('options');
    assert.equal(options.title, 'Options');
    assert.equal(options.count, 4);
    assert.equal(options.length, 'medium');
    assert.equal(options.insertMode, 'insert');
    assert.equal(options.autoOpen, true);
    assert.equal(options.set, '');
    const swipe = kindDefaults('swipe');
    assert.deepEqual(swipe.delivery, { visibility: 'private', required: false });
    assert.equal(swipe.rollD20, false);
    assert.equal(swipe.freshStart, '');
    assert.equal(kindDefaults('review').opens, 'sent');
    assert.equal(kindDefaults('swipe').icon, 'fa-rotate');
});

test('a draft saves only the fields of its kind; a default icon stays unset; empty swipe text lives on the bar', () => {
    const draft = draftOf(null, 'swipe');
    draft.title = 'Gentler';
    const plain = draftToAction(draft);
    assert.equal(plain.icon, '');
    assert.equal(plain.barOnly, true);
    assert.ok(!('count' in plain) && !('prompt' in plain));
    const saved = saveQuickAction(plain);
    assert.equal(saved.kind, 'swipe');
    draft.text = 'Soften the tone.';
    draft.icon = 'fa-feather-pointed';
    draft.delivery.required = true;
    draft.freshStart = 'five';
    const action = draftToAction(draft);
    assert.ok(!action.barOnly);
    const again = saveQuickAction({ ...action, id: saved.id });
    assert.equal(again.icon, 'fa-feather-pointed');
    assert.equal(again.delivery.required, true);
    assert.equal(again.freshStart, 'five');
    assert.ok(listQuickActions('swipe').some(item => item.id === saved.id));
});

test('validation: name required, 20 character limit for new names, Options needs a prompt', () => {
    const draft = draftOf(null, 'options');
    draft.title = '';
    assert.match(draftError(draft), /name/);
    draft.title = 'x'.repeat(21);
    assert.match(draftError(draft), /20/);
    assert.equal(draftError(draft, 'x'.repeat(21)), '');
    draft.title = 'Rumors';
    draft.prompt = '  ';
    assert.match(draftError(draft), /prompt/);
    draft.prompt = 'Suggest rumors.';
    assert.equal(draftError(draft), '');
    const saved = saveQuickAction(draftToAction({ ...draft, count: 6, length: 'short', set: '' }));
    assert.equal(readQuickAction(saved.id).count, 6);
    assert.equal(readQuickAction(saved.id).length, 'short');
});

test('the icon grid holds about 60 icons and filters by name and keyword', () => {
    assert.ok(ICONS.length >= 58 && ICONS.length <= 66, `icons: ${ICONS.length}`);
    assert.equal(new Set(ICONS.map(item => item.icon)).size, ICONS.length);
    assert.ok(iconMatches('dice').some(item => item.icon === 'fa-dice-d20'));
    assert.ok(iconMatches('magic').length >= 1);
    assert.deepEqual(iconMatches('zzzz'), []);
    assert.equal(iconMatches('').length, ICONS.length);
});

test('the cost line names the saved connection with the wording of 4.3', () => {
    assert.equal(costLine('options', 'DeepSeek V3'), '1 model call through DeepSeek V3');
    assert.equal(costLine('swipe', 'DeepSeek V3'), 'SillyTavern’s reply request through DeepSeek V3');
    assert.equal(costLine('impersonate', 'Main API'), 'SillyTavern’s reply request through Main API');
    assert.equal(costLine('review'), 'Runs in code');
});

test('This chat starts as a copy of the global bar, replaces it for the open chat only and leaves the global bar alone', () => {
    const global = [...composerBar().pins];
    assert.equal(hasChatBar(), false);
    assert.equal(useChatBar(true), true);
    assert.equal(hasChatBar(), true);
    assert.deepEqual(composerBar().pins, global);
    assert.ok(pinToBar('builtin:continue:plain', false, 'chat'));
    assert.ok(moveBarPin('builtin:review:sent', -1, 'chat'));
    assert.ok(!composerBar().pins.includes('builtin:continue:plain'));
    assert.deepEqual(barPins('global').map(action => action.id), global);
    assert.ok(!barPins().some(action => action.id === 'builtin:continue:plain'));
    // Global edits while the chat has its own bar do not reach the chat.
    assert.ok(pinToBar('builtin:continue:plain', false, 'global'));
    assert.ok(composerBar().pins.includes('builtin:review:sent'));
    assert.equal(useChatBar(false), true);
    assert.equal(hasChatBar(), false);
    assert.ok(!composerBar().pins.includes('builtin:continue:plain'));
    assert.equal(host.chatMetadata.roleplay_instructions?.quickBar, undefined);
});

test('Move up, Move down and Unpin are single calls that stop at the ends', () => {
    const first = composerBar().pins[0], second = composerBar().pins[1];
    assert.equal(moveBarPin(first, -1), false);
    assert.equal(moveBarPin(first, 1), true);
    assert.equal(composerBar().pins[1], first);
    assert.equal(composerBar().pins[0], second);
    assert.equal(pinToBar(first, false), true);
    assert.ok(!composerBar().pins.includes(first));
    assert.equal(pinToBar(first, true), true);
    assert.equal(composerBar().pins.at(-1), first);
});

test('the preview says which pins overflow at a width', () => {
    // More takes its width first; pins fill the rest. Larger targets overflow earlier.
    assert.equal(previewFit({ width: 300, hit: 32, gap: 4, count: 14 }).shown, 7);
    assert.equal(previewFit({ width: 300, hit: 44, gap: 8, count: 14 }).shown, 4);
    assert.equal(previewFit({ width: 300, hit: 32, gap: 4, count: 3 }).shown, 3);
    // At 523 px the status slot (a target plus 96 px) and More leave room for 9 Compact or 6 Comfortable pins (DESIGN.md 4.10).
    assert.equal(previewFit({ width: 523, hit: 32, gap: 4, count: 14, padding: 8, status: 128 }).shown, 9);
    assert.equal(previewFit({ width: 523, hit: 44, gap: 8, count: 14, padding: 8, status: 140 }).shown, 6);
    assert.equal(previewWords(9, 14), '9 of 14 fit at this width; 5 go to the top of More.');
    assert.equal(previewWords(5, 5), 'All 5 pinned actions fit on the bar at this width.');
    assert.equal(previewWords(0, 0), 'Nothing is pinned yet.');
});

test('both pages lead their nested tab under Quick actions and replace its stand-in', async () => {
    const { buildTree, locate } = await import('../../src/ui/destinations.js');
    const tree = buildTree([registeredPage('quick-bar'), registeredPage('quick-library')]);
    for (const [id, label, nested] of [['quick-bar', 'Bar', 'bar'], ['quick-library', 'Library', 'library']]) {
        const page = registeredPage(id);
        assert.ok(page, id);
        assert.equal(page.label, label);
        assert.equal(typeof page.render, 'function');
        const found = locate(tree, id);
        assert.equal(found.top.id, 'quick');
        assert.equal(found.nested.id, nested);
        assert.deepEqual(found.nested.pages.map(item => item.id), [id]);
    }
});
