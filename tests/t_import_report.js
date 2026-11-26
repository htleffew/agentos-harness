// B46: the import report. Node part: the comparison of what a file held with what was stored, over a clean fixture and
// a fixture that carries fields RI cannot keep. No host, no model call. The sheet at 390 px is t_import_report_host.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const settingsRoot = {};
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: settingsRoot, chat: [], saveSettingsDebounced() {} }) };
let I; let R; let B;
const ready = (async () => {
    I = await import(pathToFileURL(path.join(root, 'src/bank-import.js')).href);
    R = await import(pathToFileURL(path.join(root, 'src/import-report.js')).href);
    B = await import(pathToFileURL(path.join(root, 'src/banks.js')).href);
})();

const order = ids => [{ character_id: 100000, order: ids.map(identifier => ({ identifier, enabled: true })) }];
const clean = { prompt_order: order(['a', 'b']), prompts: [
    { identifier: 'a', name: 'Voice', role: 'user', content: 'Write in close third person, past tense.' },
    { identifier: 'b', name: 'Tone', content: 'Keep the tone warm and plain.' },
] };
const lossy = { prompt_order: order(['a', 'b', 'c']), prompts: [
    { identifier: 'a', name: 'Depth Note', role: 'tool', injection_position: 1, injection_depth: 2, injection_trigger: ['continue'], content: 'Remind the narrator of the weather.' },
    { identifier: 'b', name: 'Late Beat', content: '{{if {{getvar::turn}} >= 5}}Something stirs in the hall.{{/if}}' },
    { identifier: 'c', name: 'Moods', content: 'Mood: {{random::calm {{char}} sits::tense, jaw set::eerie quiet settles}}' },
] };
const plugin = { meta: { tag: 'PLUGIN' }, entries: { 1: { name: 'Nudge', triggerGroups: [{ chance: 50 }, { chance: 10 }], actions: { a: [{ type: 'add_message', pool: ['One long note that stands alone as a block of text.'] }, { type: 'set_variable' }] } } }, variables: { mood: 1, pace: 2 } };

/** What the import button does, minus the sheet: read, write the ticked lists and blocks, then compare. */
async function runImport(name, data) {
    await ready;
    const found = I.readImportFile(name, JSON.stringify(data));
    const group = I.importGroup(found.file, 1700000000000);
    const book = { entries: {} };
    const picked = found.lists.filter(l => l.tick);
    for (const l of picked) {
        const id = B.addBank(book, l.name, 'event', false);
        const entry = Object.values(book.entries).find(e => e?.extensions?.ri?.dim === id);
        B.setBankItems(book, id, [...entry.extensions.ri.items, ...I.listItems(l, group)]);
    }
    const items = new Map(Object.values(book.entries).flatMap(e => e.extensions.ri.items.map(it => [it.id, it])));
    const sent = await I.sendBlocksToBlockBank(found.blocks);
    return { found, report: R.reportImport({ found, picked, group, sent, items }) };
}

test('an import that keeps every field shows no report', async () => {
    const { found, report } = await runImport('clean.json', clean);
    assert.equal(found.blocks.length, 2);
    assert.equal(report, null);
    assert.equal(R.reportFor('clean.json'), null);
});

test('an import that drops or approximates a field names each loss', async () => {
    const { report } = await runImport('lossy.json', lossy);
    assert.ok(report && !report.clean);
    const find = (list, where, field) => list.find(r => r.where === where && r.field === field);
    assert.ok(find(report.approximated, 'Depth Note', 'Role'), 'unsupported role approximated');
    assert.equal(find(report.approximated, 'Depth Note', 'Role').kept, 'system');
    // B56: the block bank keeps the in-chat position and depth, the reply types and the reply-number gate.
    assert.equal(find(report.leftOut, 'Depth Note', 'Position'), undefined, 'the in-chat position is kept');
    assert.equal(find(report.leftOut, 'Depth Note', 'Only for'), undefined, 'the reply types are kept');
    assert.equal(find(report.leftOut, 'Late Beat', 'Not before'), undefined, 'the reply-number gate is kept');
    assert.ok(report.approximated.some(r => r.where === 'Mood' && r.field === 'Text'), 'macro taken out of a value');
    for (const row of [...report.approximated, ...report.leftOut]) assert.ok(row.where && row.field && row.held && row.kept);
});

test('a position or gate RI cannot represent is still reported (B56)', async () => {
    const odd = { prompt_order: order(['a', 'b']), prompts: [
        { identifier: 'a', name: 'Odd Depth', injection_position: 1, injection_depth: '2', content: 'A depth written as text.' },
        { identifier: 'b', name: 'Counter', content: 'Count {{setvar::turn::1}}{{if {{getvar::turn}} >= 3}}late{{/if}} here.' },
    ] };
    const { report } = await runImport('odd.json', odd);
    const find = (where, field) => report.leftOut.find(r => r.where === where && r.field === field);
    assert.match(find('Odd Depth', 'Position').held, /2 messages from the end/);
    assert.match(find('Odd Depth', 'Position').kept, /4 messages from the end/);
    assert.match(find('Counter', 'Not before').held, /Reply 3/, 'a gate inside other text stays the preset macro');
});

test('a plugin reports skipped actions, extra trigger groups and its data tables', async () => {
    const { report } = await runImport('plugin.json', plugin);
    assert.ok(report.leftOut.some(r => r.where === 'Nudge' && r.field === 'Trigger groups'));
    assert.ok(report.leftOut.some(r => r.where === 'Nudge' && r.field === 'Actions' && /set_variable/.test(r.held)));
    assert.ok(report.leftOut.some(r => r.where === 'variables' && r.field === 'Plugin data'));
});

test('the report is kept until the next import of the same file, and a clean re-import clears it', async () => {
    await runImport('again.json', lossy);
    assert.ok(R.reportFor('again.json')?.approximated.length);
    assert.equal(R.reportFor(R.reportKey('again.json')).file, 'again.json');
    await runImport('again.json', clean);
    assert.equal(R.reportFor('again.json'), null);
});

test('a stored value that differs from the one read is approximated, and a missing one is left out', async () => {
    await ready;
    const rows = R.storedLosses({ expected: [{ where: 'List', id: 'x', label: 'A', text: 'one' }, { where: 'List', id: 'y', label: 'B', text: 'two' }, { where: 'List', id: 'z', label: 'C', text: 'three' }],
        stored: new Map([['x', { label: 'A', text: 'one' }], ['y', { label: 'B', text: 'tw' }]]) });
    assert.deepEqual(rows.map(r => `${r.kind}:${r.field}`), ['approximated:Text', 'left out:Value']);
});

test('the comparison makes no model call', async () => {
    await ready;
    const src = require('node:fs').readFileSync(path.join(root, 'src/import-report.js'), 'utf8');
    assert.ok(!/\bfetch\(|generateRaw|generateQuiet|callModel|ai\.js/.test(src));
});
