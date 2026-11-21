import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    actionLibrary, applyQuickActionVariation, editQuickActionSource, linkedQuickAction, listQuickActions, loadQuickActionSources,
    moveQuickAction, readQuickAction, recoverQuickAction, removeQuickAction, resolveQuickAction, restoreQuickAction, restoreQuickActionLibrary,
    rollQuickAction, rollQuickActionDie, saveQuickAction, saveQuickActionVariation, undoQuickActionLibrary,
} from '../../src/quick-actions.js';
import { exportQuickActionLibrary, importQuickActionData, inspectQuickActionImport } from '../../src/quick-action-import.js';
import { chatState } from '../../src/store.js';
import { KEY } from '../../src/st.js';
import keelFixture from '../fixtures/quick-action-keel.cjs';

const { syntheticKeel, translations } = keelFixture;

let host, books, observed;
beforeEach(() => {
    books = new Map();
    observed = { saves: 0, calls: 0, substitutions: 0 };
    host = {
        name1: 'Elin', name2: 'Tavi', extensionSettings: {}, chat: [], chatMetadata: {},
        getCurrentChatId: () => 'A',
        saveSettingsDebounced() { observed.saves++; },
        getWorldInfoNames: () => [...books.keys()],
        loadWorldInfo: async name => structuredClone(books.get(name)),
        saveWorldInfo: async (name, data) => books.set(name, structuredClone(data)),
        updateWorldInfoList: async () => {},
        generateRaw: async () => { observed.calls++; throw new Error('Unexpected generation'); },
        substituteParams() { observed.substitutions++; throw new Error('Unknown expressions must never be evaluated'); },
    };
    globalThis.SillyTavern = { getContext: () => host };
});


function book(kind, entries) {
    return { entries: Object.fromEntries(entries.map(entry => [entry.uid, entry])), extensions: { ri: { v: 1, kind } } };
}

function instruction(uid, title, count, disable = false) {
    const versions = Array.from({ length: count }, (_, index) => ({ text: title + ' version ' + (index + 1), keep: false }));
    return {
        uid, comment: title, content: versions[0].text, constant: true, disable, probability: 0, cooldown: 51,
        extensions: { ri: { v: 1, sentAs: 'system', versions } },
    };
}

function recipe(type, title, categories) {
    const definitions = categories.map(([name, on, items, extra]) => ({
        id: name.toLowerCase(), name, on, chance: 0, count: 1, useAll: true,
        items: items.map(([id, text, props]) => ({ id, text, ...props })), ...extra,
    }));
    return { uid: 1, comment: title, content: title, disable: false, probability: 0, extensions: { ri: { type, categories: definitions } } };
}

test('each destination owns standalone buttons, baselines, variations, ordering, recovery, and library round-trip', async () => {
    const ids = [];
    for (const family of ['steer', 'swipe', 'continue', 'draft']) {
        const item = saveQuickAction({ family, title: family + ' custom', text: 'Write for {{user}}.', category: 'My buttons' });
        ids.push(item.id);
        assert.equal(listQuickActions(family).find(row => row.id === item.id).text, 'Write for {{user}}.');
        assert.equal(resolveQuickAction(item).text, 'Write for Elin.');
    }
    const [id] = ids;
    const defaultSwipe = listQuickActions('swipe')[0];
    const defaultSteer = listQuickActions('steer')[0];
    assert.equal(defaultSteer.status, 'Default');
    saveQuickAction({ id: defaultSwipe.id, text: 'Make Tavi speak calmly.' });
    saveQuickAction({ id: defaultSteer.id, text: 'Describe a raincoat.' });
    saveQuickAction({ id, title: 'Revised cue', text: 'Tell Tavi something.', delivery: { required: true, visibility: 'visible' } });
    saveQuickActionVariation(id, 'At the docks', { text: 'Mention the docks.' });
    applyQuickActionVariation(id, 'At the docks');
    assert.equal(readQuickAction(id).text, 'Mention the docks.');
    assert.equal(readQuickAction(id).delivery.visibility, 'visible');
    restoreQuickAction(id);
    restoreQuickAction(defaultSwipe.id);
    assert.equal(readQuickAction(id).text, 'Write for {{user}}.');
    assert.equal(readQuickAction(id).title, 'steer custom');
    assert.equal(readQuickAction(id).variations.length, 1);
    assert.equal(readQuickAction(defaultSteer.id).text, 'Describe a raincoat.');

    moveQuickAction(id, -1);
    assert.equal(listQuickActions('steer')[0].id, id);
    removeQuickAction(id);
    assert.ok(!listQuickActions('steer').some(item => item.id === id));
    assert.equal(readQuickAction(id).removed, true);
    recoverQuickAction(id);
    assert.equal(readQuickAction(id).removed, undefined);
    removeQuickAction(defaultSteer.id);
    assert.equal(readQuickAction(defaultSteer.id).hidden, true);
    restoreQuickActionLibrary('steer', { layout: true });
    assert.equal(readQuickAction(defaultSteer.id).hidden, false);
    assert.equal(readQuickAction(id).removed, true);
    undoQuickActionLibrary();
    assert.equal(readQuickAction(defaultSteer.id).hidden, true);
    assert.equal(readQuickAction(id).removed, undefined);

    const json = exportQuickActionLibrary();
    host.extensionSettings = {};
    const preview = inspectQuickActionImport(json);
    await importQuickActionData(preview);
    assert.equal(readQuickAction(defaultSteer.id).text, 'Describe a raincoat.');
    const imported = listQuickActions('steer').find(item => item.title === 'steer custom');
    assert.equal(imported.id, id);
    assert.equal(imported.baseline.text, 'Write for {{user}}.');
    assert.equal(imported.variations[0].name, 'At the docks');
    assert.equal(observed.calls, 0);
});

test('native exports supply shared and standalone sources through the same browse and draw pools', async () => {
    const reanchor = instruction(1, 'Reanchor personality', 21);
    const desire = Array.from({ length: 6 }, (_, index) => instruction(index + 2, 'Desire ' + (index + 1), [10, 1, 20, 8, 6, 7][index], index === 5));
    const arc = recipe('event', 'Shocking arc', [
        ['Situation', true, [['arrival', 'The captain arrives'], ['fire', 'Fire splits the room']]],
        ['Driver', true, [['npc', 'A stranger', { from: 'other' }]], { driver: true }],
        ['Tone', true, [['stirring', 'Tense', { weight: 4 }], ['calm', 'Calm']]],
    ]);
    const style = recipe('style', 'Random writing', [
        ['Prose style', true, [['crisp', 'Crisp prose']]],
        ['Inactive', false, [['poem', 'Use verse']]],
    ]);
    const instructions = [
        { ...reanchor, extensions: { ri: { ...reanchor.extensions.ri, set: 'Reanchor' } } },
        { ...instruction(12, 'Emotional Tone', 5), extensions: { ri: { ...instruction(12, 'Emotional Tone', 5).extensions.ri, set: 'Emotionality' } } },
    ];
    const shared = { ...book('instructions', instructions), extensions: { ri: { shared: true, groups: { Reanchor: { kind: 'instructions' }, Emotionality: { kind: 'instructions' } } } } };
    assert.deepEqual((await importQuickActionData(inspectQuickActionImport(shared, 'Shared.json'))).sets, ['Shared › Reanchor', 'Shared › Emotionality']);
    for (const [json, label] of [[book('instructions', desire), 'Desires'], [book('events', [arc]), 'Arc'], [book('style', [style]), 'Style']]) {
        const inspection = inspectQuickActionImport(JSON.stringify(json), label + '.json');
        assert.equal((await importQuickActionData(inspection)).book, label);
    }
    const cs = chatState();
    cs.used['Shared.1'] = [0, 1];
    cs.locks['Arc.1'] = { tone: ['stirring'] };
    const sources = await loadQuickActionSources();
    const base = sources.filter(row => row.version === undefined && !row.itemId);
    assert.equal(base.filter(row => row.sourceKind === 'instruction').length, 8);
    assert.equal(base.filter(row => row.sourceKind === 'event').length, 1);
    assert.equal(base.filter(row => row.sourceKind === 'style').length, 1);
    assert.equal(base.filter(row => row.enabled).length, 9);
    assert.equal(sources.find(row => row.itemId === 'poem').unavailable, 'Category disabled');
    assert.equal(sources.find(row => row.itemId === 'calm').unavailable, 'Another ingredient is locked');

    const reanchor3 = sources.find(row => row.title === 'Reanchor personality' && row.version === 2);
    const selected = resolveQuickAction(reanchor3);
    assert.equal(selected.text, 'Reanchor personality version 3');
    assert.equal(selected.effects[0].index, 2);
    assert.deepEqual(selected.effects[0].used, [0, 1, 2]);
    assert.deepEqual(cs.used['Shared.1'], [0, 1], 'preview must leave the cycle untouched');
    const linked = linkedQuickAction(reanchor3);
    assert.equal(resolveQuickAction(linked, { sources }).sources[0].key, 'Shared.1');
    await editQuickActionSource(reanchor3, 'Fresh version text');
    const updated = await loadQuickActionSources();
    assert.throws(() => resolveQuickAction(linked, { sources: updated }), /missing or changed/);

    const locked = resolveQuickAction(sources.find(row => row.itemId === 'fire'));
    assert.deepEqual(locked.effects[0].parts.map(part => part.ids), [['fire'], ['npc'], ['stirring']]);
    assert.deepEqual(cs.locks['Arc.1'], { tone: ['stirring'] });
    assert.equal(rollQuickAction(sources, { scope: { category: 'Story Events' } }).draw.size, 1);
    assert.equal(rollQuickAction(sources, { scope: { set: 'Shared › Reanchor' }, random: () => 0 }).text, 'Reanchor personality version 3');
    assert.equal(rollQuickAction(sources, { random: () => 0 }).draw.size, 9);
    assert.throws(() => rollQuickAction(sources, { scope: { set: 'absent' } }), /No eligible entries/);
    assert.equal(observed.calls, 0);
});

test('Keel inspection preserves 23 items, flags two hooks, and translates only explicit reviewed choices', async () => {
    const fixture = syntheticKeel();
    const inspection = inspectQuickActionImport(JSON.stringify(fixture), 'Keel.json');
    assert.equal(inspection.recognized, true);
    assert.equal(inspection.entries.length, 23);
    assert.deepEqual(inspection.entries.filter(item => item.kind === 'Automatic hook').map(item => item.id), [19, 20]);
    assert.equal(inspection.entries.find(item => item.id === 10).kind, 'Visible launcher');
    assert.deepEqual(inspection.entries.filter(item => item.translation).map(item => item.id), translations);
    assert.equal(inspection.entries.find(item => item.id === 22).tool, 'Notes');
    assert.equal(inspection.entries.find(item => item.id === 11).tool, 'Chapters');
    assert.deepEqual(await importQuickActionData(inspection, { selected: [3, 15, 16, 19, 20] }), { actions: 3, book: '' });
    assert.deepEqual(actionLibrary().imports[0].original, fixture);
    assert.deepEqual((await importQuickActionData(inspection, { selected: [3, 15] })).actions, 0);
    const outfit = listQuickActions('steer').find(item => item.title === 'Original title 15');
    assert.throws(() => resolveQuickAction(outfit), /Enter a direction/);
    const cue = resolveQuickAction(outfit, { variables: { direction: 'A blue coat' } });
    assert.equal(cue.embedsDirection, true);
    assert.equal(cue.text, 'Apply this idea: A blue coat.');
    assert.equal(resolveQuickAction(listQuickActions('steer').find(item => item.operation === 'queue')).operation, 'queue');
    assert.equal(listQuickActions('steer').find(item => item.title === 'Original title 16').text, 'Write direction number 16.');
    const exported = JSON.parse(exportQuickActionLibrary());
    assert.deepEqual(exported.library.imports[0].original, fixture);
    const tampered = syntheticKeel();
    tampered.qrList[0].message = '/setvar key=x secret';
    assert.equal(inspectQuickActionImport(tampered).entries[0].translation, undefined);
    tampered.qrList.find(item => item.id === 19).executeOnAi = false;
    assert.equal(inspectQuickActionImport(tampered).entries.filter(item => item.translation).length, 0);
    assert.equal(observed.calls, 0);
    assert.equal(observed.substitutions, 0);
});

test('local macro and die resolution uses registered values and never evaluates imported commands', () => {
    const cue = { id: 'x', family: 'steer', enabled: true, title: 'Cue', text: 'Write for {{user}} using {{setvar::sneak::on}}.' };
    assert.throws(() => resolveQuickAction(cue), /setvar/);
    const literal = resolveQuickAction(cue, { allowLiteral: true });
    assert.equal(literal.text, 'Write for Elin using {{setvar::sneak::on}}.');
    assert.equal(observed.substitutions, 0);
    const first = rollQuickActionDie({ target: 12, random: () => 0.5 });
    const second = rollQuickActionDie({ target: 12, random: () => 0.5 });
    assert.equal(first.total, 11);
    assert.equal(second.total, first.total);
    assert.notEqual(first.id, second.id);
    assert.equal(first.result, 'fails');
    assert.equal(host.chatMetadata[KEY], undefined, 'local resolution must not write a turn');
});
