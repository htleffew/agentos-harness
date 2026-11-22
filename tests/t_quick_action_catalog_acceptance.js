const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const L = require('./lib.js');
const { syntheticKeel } = require('./fixtures/quick-action-keel.cjs');

const families = [
    ['steer', 'Steer the next reply', 'Create saved nudge', 'Queue with my next message'],
    ['swipe', 'Generate an alternate reply', 'Create saved alternate direction', 'Generate alternate reply'],
    ['continue', 'Continue this reply', 'Create saved continuation direction', 'Continue this reply'],
    ['draft', 'Draft my reply', 'Create saved draft direction', 'Generate my draft · 1 model call'],
];
const words = marker => 'Use the established setting. ' + marker;
const exact = text => ({ name: text, exact: true });
const nativeBook = (name, kind, entries) => ({ name, entries: Object.fromEntries(entries.map(row => [row.uid, row])), extensions: { ri: { kind } } });
const instruction = (uid, comment, count, disable = false) => ({
    uid, comment, constant: true, content: comment, disable, key: [], probability: 0,
    extensions: { ri: { type: 'instruction', sentAs: 'system', versions: Array.from({ length: count }, (_, i) => ({ text: comment + ' wording ' + (i + 1) })) } },
});
const recipe = (uid, comment, choices) => ({
    uid, comment, constant: true, content: comment, key: [], probability: 0,
    extensions: { ri: { type: 'event', categories: Object.entries(choices).map(([id, items]) => ({
        id, name: id, on: true, count: 1, items: items.map(([id, text]) => ({ id, text, on: true })),
    })) } },
});

(async () => {
    L.sync();
    L.mode({});
    await fs.rm(process.env.RI_MOCK_LOG || '/tmp/mock-requests.jsonl', { force: true });
    const { browser, page, errors } = await L.open({ width: 390, height: 760, hasTouch: true, isMobile: true, setupPage: async page => {
        await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
        await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
    } });
    page.setDefaultTimeout(15000);
    const quick = page.locator('.ri-quick-sheet');
    const panel = page.locator('#ri_root');
    const library = panel.locator('#ri-composer-library');
    let sheet = quick;
    const composer = page.locator('#send_textarea');
    const evidence = { host: 'SillyTavern 1.19.0', browser: 'Chromium ' + browser.version(),
        mode: 'Touch emulation at 390 × 760 and 390 × 430', provider: 'Isolated OpenAI-compatible mock', cases: {} };
    const begin = id => evidence.cases[id] = { taps: [], status: 'In progress' };
    let current;
    const tap = async (label, scope = sheet) => {
        current?.taps.push(label);
        await scope.getByRole('button', exact(label)).first().tap();
        if (scope===quick && label==='Manage quick actions') {
            await library.getByLabel('Action family').waitFor();
            sheet = library;
        }
    };
    const open = () => L.openQuickActions(page);
    const close = async () => {
        if (sheet===library) {
            await panel.getByRole('button',exact('Back to Quick actions')).tap();
            sheet = quick;
        }
        await tap('Close');
    };
    const openFamily = async name => { await open(); await tap(name); };
    const manage = async () => {
        await open();
        await tap('Configure quick actions');
        if (!await library.evaluate(node=>node.open)) await library.locator(':scope > summary').tap();
        const family=library.getByLabel('Action family');
        if (await family.inputValue()) await family.selectOption('');
        sheet = library;
        const manageButton=library.getByRole('button',exact('Manage quick actions'));
        if (await manageButton.isVisible()) await manageButton.tap();
    };
    const notice = (name, timeout = 25000) => sheet.getByRole('status').filter({ hasText: name }).first().waitFor({ timeout });
    const fill = (label, value) => sheet.getByLabel(label, { exact: true }).fill(value);
    const show = async (text, scope = sheet) => {
        current?.taps.push(text);
        await scope.getByText(text, { exact: true }).first().tap();
    };
    const submit = (fixture, scope = sheet) => tap(fixture[3], scope);
    const send = async text => {
        const before = await page.evaluate(() => SillyTavern.getContext().chat.length);
        await composer.fill(text);
        current?.taps.push('Send');
        await page.locator('#send_but').tap();
        await page.waitForFunction(count => SillyTavern.getContext().chat.length === count + 2, before);
        await L.idle(page, 20000);
    };
    const state = () => page.evaluate(async base => {
        const Q = await import(base + '/src/quick-actions.js');
        const S = await import(base + '/src/quick-action-chat.js');
        const host = SillyTavern.getContext();
        return {
            chat: host.getCurrentChatId(),
            actions: Q.listQuickActions('', { includeHidden: true }),
            active: Q.listQuickActions().map(item => item.id), order: Q.actionLibrary().order,
            pins: S.quickChat().pins, pending: S.quickChat().pending.map(entry => entry.rows.map(row => row.text)),
            turns: host.chat.map(row => ({ mes: row.mes, user: !!row.is_user, swipe: row.swipe_id || 0 })),
        };
    }, L.BASE);
    const capture = (label, markers, from) => {
        const requests = L.requests().slice(from);
        assert.equal(requests.length, 1, label + ' request count');
        const request = requests[0], sent = L.text(request);
        for (const marker of markers) assert.equal(sent.split(marker).length - 1, 1, label + ' marker ' + marker);
        return { label, at: request.t, sha256: crypto.createHash('sha256').update(JSON.stringify(request.messages)).digest('hex'),
            roles: request.messages.map(message => message.role), once: markers };
    };
    const label = (prefix, scope = sheet) => scope.getByRole('textbox', exact(prefix));
    const snapshotAction = async title => (await state()).actions.find(row => row.title === title);
    const rowFor = title => sheet.locator('.ri-qa-library-block').filter({ has: page.getByRole('button', exact('Edit ' + title)) }).last();
    const date = Date.now().toString(36);
    const titles = families.map(([id]) => 'Catalog test ' + id + ' ' + date);
    const reload = async () => {
        await page.waitForTimeout(1700);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.querySelector('#send_textarea') && !document.getElementById('preloader'));
        await L.openChat(page, { fresh: false });
        await L.setupApi(page, { legacyAutomation: false });
        await page.locator('.ri-quick-toolbar:not([hidden])').waitFor();
    };
    async function importFile(name, value, confirm = 'Import reviewed JSON') {
        await tap('Import JSON');
        await chooseFile(name, value);
        await tap(confirm);
    }
    async function chooseFile(name, value) {
        const chooser = page.waitForEvent('filechooser');
        await tap('Choose JSON file');
        await (await chooser).setFiles({ name: name + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
        current?.taps.push('Selected file · ' + name + '.json');
    }
    async function editText(title, text) {
        await tap('Edit ' + title);
        await fill('Direction', text);
        await tap('Save button');
        await notice('Saved ' + title);
    }
    async function restoreItem(title, restore) {
        await tap('Edit ' + title);
        await tap(restore);
        await tap('Confirm button restore');
        await notice('Restored ' + title);
        await tap('Back to library');
    }
    async function evidenceFile() {
        if (process.env.RI_CATALOG_EVIDENCE) await fs.writeFile(process.env.RI_CATALOG_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n');
    }

    try {
        await L.setupApi(page, { legacyAutomation: false });
        await L.setSettings(page, { world: { head: 0 }, summary: { on: false } });
        await L.openChat(page);
        evidence.preset = await page.locator('#settings_preset_openai option:checked').textContent();
        assert.equal(evidence.preset.trim(), 'Default');
        const setup = await page.evaluate(async base => {
            const { chatState, saveChatState } = await import(base + '/src/store.js');
            const host = SillyTavern.getContext();
            // Rerunning on the same disposable host keeps older fixture imports out of this chat's pool.
            chatState().excludedHostBooks = host.getWorldInfoNames().filter(name => /^(Reanchor|Shocking arc|Other event set) [a-z0-9]+$/.test(name));
            saveChatState();
            return { disabled: host.extensionSettings.disabledExtensions, active: chatState().activeSets, world: chatState().world,
                qrNodes: document.querySelectorAll('#qr--bar, #qr--popout').length };
        }, L.BASE);
        assert(setup.disabled.includes('quick-reply') && setup.disabled.includes('memory'));
        assert.deepEqual(setup.active, []);
        assert.equal(setup.world, '');
        assert.equal(setup.qrNodes, 0);
        evidence.setup = setup;
        L.mode({ reply: 'She waits with her lantern by the gate.' });
        await send('I step into the hallway.');
        const start41 = L.requests().length;

        current = begin('A41');
        await page.setViewportSize({ width: 390, height: 430 });
        for (const [index, fixture] of families.entries()) {
            await openFamily(fixture[1]);
            assert.equal(await sheet.getByRole('button',exact(fixture[2])).count(),0);
            await tap('Manage quick actions');
            await tap(fixture[2]);
            await fill('Button name', titles[index]);
            await fill('Direction', words('QACUE' + index));
            await tap('Save button');
            await sheet.getByRole('button', exact('Edit ' + titles[index])).waitFor();
            await close();
        }
        assert.equal(L.requests().length, start41);
        const beforeReload = await state();
        await reload();
        assert.equal((await state()).chat, beforeReload.chat);
        current.captures = [];
        for (const [index, fixture] of families.entries()) {
            const before = await state();
            const requestCount = L.requests().length;
            await openFamily(fixture[1]);
            await tap(titles[index]);
            await fill('Your direction', 'Add one specific detail. QATEXT' + index);
            await submit(fixture);
            if (index === 0) {
                await notice('Queued with your next player message.');
                assert.deepEqual((await state()).pending.at(-1), [words('QACUE0'), 'Add one specific detail. QATEXT0']);
                assert.equal(L.requests().length, requestCount);
                await close();
                L.mode({ reply: 'She sets the lantern on the ledge.' });
                await send('I point to the gate. QAPLAYER0');
            } else {
                await notice(index === 3 ? 'Draft ready to edit.' : 'Reply updated.');
                await close();
            }
            const after = await state();
            if (index === 1) {
                assert.equal(after.turns.at(-1).swipe, before.turns.at(-1).swipe + 1);
                L.mode({ reply: 'Then she takes a step toward the door.' });
            }
            if (index === 2) assert(after.turns.at(-1).mes.startsWith(before.turns.at(-1).mes));
            if (index === 3) assert.deepEqual(after.turns, before.turns);
            current.captures.push({ ...capture(fixture[0], ['QACUE' + index, 'QATEXT' + index], requestCount),
                turns: [before.turns.length, after.turns.length], targetSwipe: after.turns.at(-1).swipe, pending: after.pending.length });
        }
        current.status = 'Pass';
        current.savedRequests = 0;
        await evidenceFile();

        current = begin('A42');
        const start42 = L.requests().length;
        const revised = titles[0] + ' revised';
        await manage();
        await tap('Edit ' + titles[0]);
        await fill('Button name', revised);
        await fill('Direction', words('QAREVISED'));
        await show('Options');
        await sheet.getByLabel('Delivery', { exact: true }).selectOption('visible');
        await sheet.getByText('Required direction', { exact: true }).tap();
        await tap('Save button');
        await tap('Edit ' + revised);
        assert((await snapshotAction(revised)).changed);
        await show('Named variations');
        await fill('Variation name', 'At the quay');
        await tap('Save as a variation');
        await tap('Compare changes');
        const diff = sheet.locator('.ri-qa-library-block').filter({ has: page.getByText('Saved changes', { exact: true }) }).last();
        for (const text of [titles[0], revised, words('QACUE0'), words('QAREVISED'), 'Private system note', 'Visible OOC', 'Required direction', 'No', 'Yes']) {
            assert((await diff.innerText()).includes(text), 'Missing diff ' + text);
        }
        current.changedFields = ['Button name', 'Direction', 'Delivery', 'Required direction'];
        await tap('Restore first saved version');
        await tap('Confirm button restore');
        await notice('Restored ' + revised);
        const restored = await snapshotAction(titles[0]);
        assert.deepEqual(restored.delivery, { visibility: 'private', required: false });
        assert.equal(restored.variations[0].fields.title, revised);
        await tap('Back to library');
        await tap('Remove button', rowFor(titles[0]));
        await close();
        await reload();
        await manage();
        await sheet.getByText(/^Recently removed · /).tap();
        await tap('Recover ' + titles[0]);
        const recovered = await snapshotAction(titles[0]);
        assert.equal(recovered.id, restored.id);
        assert.equal(recovered.text, words('QACUE0'));
        assert.equal(recovered.variations[0].fields.text, words('QAREVISED'));
        await tap('Edit ' + titles[0]);
        await show('Named variations');
        await tap('Apply At the quay');
        assert.deepEqual((await snapshotAction(revised)).delivery, { visibility: 'visible', required: true });
        await tap('Restore first saved version');
        await tap('Confirm button restore');
        await notice('Restored ' + revised);
        assert.equal(L.requests().length, start42);
        await close();
        current.status = 'Pass';
        current.id = recovered.id;
        current.variation = recovered.variations[0].name;
        current.requests = 0;
        await evidenceFile();

        current = begin('A43');
        const start43 = L.requests().length;
        await openFamily(families[0][1]);
        await tap(titles[0]);
        await fill('Your direction', 'Leave this queue snapshot in place. QAQUEUE');
        await submit(families[0]);
        await notice('Queued with your next player message.');
        await tap('Manage quick actions');
        if ((await snapshotAction('Dress me')).hidden) await tap('Show button', rowFor('Dress me'));
        await editText('Dress me', words('QAOUTFITOVERRIDE'));
        await tap('Hide button', rowFor('Dress me'));
        await tap('Pin ' + titles[0]);
        await close();
        await openFamily(families[1][1]);
        await tap('Manage quick actions');
        await editText('More emotional', words('QASWIPEBUILTIN'));
        await tap('Move up', rowFor(titles[1]));
        await tap('Pin ' + titles[1]);
        await close();
        const layout = await state();
        await openFamily(families[0][1]);
        await tap('Manage quick actions');
        await tap('Restore this menu');
        await sheet.getByLabel('Restore mode', { exact: true }).selectOption('layout');
        assert.match(await sheet.innerText(), /Restore Steer the next reply/);
        assert((await sheet.innerText()).includes('Pins removed from this chat · ' + titles[0]));
        await tap('Apply library restore');
        await notice('Library restored.');
        const scoped = await state();
        assert(!scoped.active.includes(recovered.id));
        assert(scoped.pins.some(pin => pin.title === titles[1]));
        assert(!scoped.pins.some(pin => pin.title === titles[0]));
        assert.equal((await snapshotAction('More emotional')).text, words('QASWIPEBUILTIN'));
        assert.equal((await snapshotAction('Dress me')).hidden, false);
        assert.deepEqual(scoped.pending, layout.pending);
        await tap('Undo last library change');
        await notice('Previous library restored.');
        assert.deepEqual((await state()).pins, layout.pins);
        await close();
        await manage();
        await tap('Restore full library');
        await sheet.getByLabel('Restore mode', { exact: true }).selectOption('layout');
        assert.match(await sheet.innerText(), /Restore the entire library/);
        await tap('Apply library restore');
        await notice('Library restored.');
        assert.deepEqual((await state()).pins, []);
        assert.deepEqual((await state()).pending, layout.pending);
        assert(!(await state()).active.includes(recovered.id));
        await close();
        await reload();
        await manage();
        await tap('Undo last library change');
        await notice('Previous library restored.');
        const undone = await state();
        assert.deepEqual(undone.pins, layout.pins);
        assert.deepEqual(undone.order, layout.order);
        assert.deepEqual(undone.active, layout.active);
        assert.deepEqual(undone.pending, layout.pending);
        assert.deepEqual((await snapshotAction(titles[0])).variations, recovered.variations);
        assert.equal((await snapshotAction('Dress me')).hidden, true);
        assert.equal(L.requests().length, start43);
        await close();
        current.status = 'Pass';
        current.state = { pins: undone.pins.map(pin => pin.title), order: undone.order, pending: undone.pending, requests: 0 };
        await evidenceFile();

        current = begin('A25');
        const start25 = L.requests().length;
        const reanchor = 'Reanchor ' + date, arc = 'Shocking arc ' + date, other = 'Other event set ' + date;
        const plot = 'A messenger arrives with a forged note.';
        await manage();
        await importFile(reanchor, nativeBook(reanchor, 'instructions', [
            instruction('1', 'Reanchor personality ' + date, 21), instruction('2', 'One ordinary cue ' + date, 1),
            instruction('3', 'Disabled instruction ' + date, 2, true),
        ]));
        await notice('Imported ' + reanchor);
        await importFile(arc, nativeBook(arc, 'events', [recipe('1', 'Shocking arc ' + date, {
            Development: [['messenger', plot], ['alarm', 'A bell rings.']],
            Consequence: [['door', 'The door swings shut.']],
        })]));
        await notice('Imported ' + arc);
        await importFile(other, nativeBook(other, 'events', [recipe('1', 'Distant subplot ' + date, { Development: [['ship','A ship docks.']] })]));
        await notice('Imported ' + other);
        await tap('Browse directions');
        await sheet.getByText(/eligible source entries/).waitFor();
        const corpus = await page.evaluate(async base => {
            const Q = await import(base + '/src/quick-actions.js');
            const sources = await Q.loadQuickActionSources();
            const roots = sources.filter(row => row.enabled && row.version === undefined && !row.itemId);
            const draws = roots.map((_, i) => Q.rollQuickAction(sources, { random: () => (i + 0.1) / roots.length }));
            return { roots: roots.map(row => row.key), drawn: draws.map(value => value.sources[0].key),
                size: draws.map(value => value.draw.size), eventBooks: roots.filter(row=>row.sourceKind==='event').map(row=>row.book) };
        }, L.BASE);
        assert.deepEqual(corpus.drawn, corpus.roots);
        assert(corpus.size.every(size => size === corpus.roots.length));
        await tap('Roll across everything');
        assert.match(await sheet.innerText(), new RegExp('Draw from ' + corpus.roots.length + ' eligible source entries'));
        await tap('Back to library');
        await show('Story Events');
        const category = sheet.locator('details').filter({ has: page.getByText('Story Events', { exact: true }) }).last();
        const eventDraw = category.getByRole('button', { name: /^Roll Story Events · [0-9]+ eligible$/ });
        current.taps.push('Roll Story Events');
        await eventDraw.tap();
        const eventPreview=await sheet.innerText();
        assert(corpus.eventBooks.includes(arc) && corpus.eventBooks.includes(other));
        assert(corpus.eventBooks.some(book=>eventPreview.includes('World Info · ' + book)));
        await tap('Back to library');
        await fill('Search quick actions', arc);
        const set = sheet.locator('details').filter({ has: page.getByText(arc + ' · ' + arc, { exact: true }) }).last();
        await tap('Roll this set · 1 eligible', set);
        assert.match(await sheet.innerText(), /Draw from 1 eligible source entry/);
        assert((await sheet.innerText()).includes('World Info · ' + arc));
        await tap('Reroll this scope');
        assert((await sheet.innerText()).includes('World Info · ' + arc));
        await tap('Back to library');
        await tap(arc);
        await show('Choose recipe ingredients');
        await sheet.getByLabel('Development', { exact: true }).selectOption('messenger');
        await tap('Roll with these choices');
        assert((await label('Exact direction').inputValue()).includes(plot));
        assert((await label('Exact direction').inputValue()).includes('The door swings shut.'));
        await tap('Back to library');
        await show('Versions and ingredients');
        await show('Development');
        await tap(plot);
        assert((await label('Exact direction').inputValue()).includes(plot));
        await tap('Back to library');
        await fill('Search quick actions', reanchor);
        await show('Versions and ingredients');
        await tap('Version 3');
        assert.equal(await label('Exact direction').inputValue(), 'Reanchor personality ' + date + ' wording 3');
        await tap('Pin this direction');
        assert.equal(L.requests().length, start25);
        current.state = { ...corpus, requests: 0, recipeIngredient: plot, selected: await label('Exact direction').inputValue() };
        current.status = 'Pass';
        await evidenceFile();

        current = begin('A7');
        const start7 = L.requests().length;
        await show('Edit source in ' + reanchor);
        await fill('Source wording', words('QALINKEDIT'));
        await tap('Save source wording');
        await notice('Saved source in ' + reanchor);
        await fill('Search quick actions', reanchor);
        await sheet.getByText(/eligible source entries/).waitFor();
        await tap('Reanchor personality ' + date + ' · Version 3');
        assert.equal(await label('Exact direction').inputValue(), words('QALINKEDIT'));
        assert((await sheet.innerText()).includes('World Info · ' + reanchor));
        await tap('Back to library');
        await tap('Manage quick actions');
        await editText('More emotional', words('QABUILTINONE'));
        await editText('More romantic', words('QABUILTINTWO'));
        await restoreItem('More emotional', 'Restore built-in');
        const expected = await state();
        assert.equal(expected.actions.find(row => row.title === 'More emotional').status, 'Default');
        assert.equal(expected.actions.find(row => row.title === 'More romantic').text, words('QABUILTINTWO'));
        assert.equal(expected.actions.find(row => row.title === 'More romantic').status, 'Customized');
        await close();
        await reload();
        await manage();
        const download = page.waitForEvent('download');
        await tap('Export library');
        await tap('Download library JSON');
        const file = await download;
        const exported = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
        await tap('Back to library');
        await importFile('Catalog round trip', exported);
        await notice('Imported ');
        assert.equal((await snapshotAction('More emotional')).status, 'Default');
        assert.equal((await snapshotAction('More romantic')).text, words('QABUILTINTWO'));
        assert.equal((await snapshotAction(titles[0])).status, 'First saved version');
        const link = await snapshotAction('Reanchor personality ' + date + ' · Version 3');
        assert.equal(link.source.snapshot, words('QALINKEDIT'));
        assert.equal(link.status, 'Follows source');
        await tap('Browse directions');
        await fill('Search quick actions', reanchor);
        await sheet.getByText(/eligible source entries/).waitFor();
        await tap('Reanchor personality ' + date + ' · Version 3');
        assert.equal(await label('Exact direction').inputValue(), words('QALINKEDIT'));
        await tap('Back to library');
        await tap('Manage quick actions');
        assert.equal(L.requests().length, start7);
        current.status = 'Pass';
        current.state = { linked: link.source, restored: 'More emotional', unrelated: ['More romantic', titles[0]], requests: 0 };
        await evidenceFile();

        current = begin('A29');
        const start29 = L.requests().length;
        const lot = Object.fromEntries(Array.from({ length: 160 }, (_, i) => {
            const id = 'action:catalog-bulk-' + date + '-' + i;
            return [id, { id, family: families[i % 4][0], title: 'Shelf sample ' + date + ' ' + i, text: 'Pause at the door before acting.', origin: 'standalone' }];
        }));
        await importFile('Large quick action library', { format: 'roleplay-instructions/quick-actions', version: 1, library: { actions: lot } });
        await notice('Imported 160 buttons.');
        await tap('Browse directions');
        await fill('Search quick actions', 'More emotional');
        await sheet.getByText('Roleplay Instructions · Built-in', { exact: true }).first().waitFor();
        await tap('Pin More emotional');
        await tap('Edit More emotional');
        await fill('Direction', words('QA29OVERRIDE'));
        await tap('Save button');
        await restoreItem('More emotional', 'Restore built-in');
        assert.equal((await snapshotAction('More romantic')).text, words('QABUILTINTWO'));
        assert((await state()).pins.some(pin => pin.title === 'More emotional'));
        const keel = syntheticKeel();
        keel.name += ' ' + date;
        keel.qrList[14].label = 'Describe the borrowed outfit ' + date;
        await tap('Import JSON');
        await chooseFile('Keel synthetic', keel);
        await sheet.getByText('23 entries · Runs in code', { exact: true }).waitFor();
        const outfit = sheet.locator('details').filter({ has: page.getByText(keel.qrList[14].label + ' · Direction with text', { exact: true }) }).last();
        await show(keel.qrList[14].label + ' · Direction with text');
        await show('Install this translation', outfit);
        await tap('Import reviewed file and selected translations');
        await notice('Imported 1 button.');
        await close();
        await openFamily('Steer the next reply');
        await fill('Your direction', 'A borrowed raincoat. QAOUTFIT');
        await show('Available directions');
        await tap(keel.qrList[14].label);
        await tap('Queue with my next message');
        await notice('Queued with your next player message.');
        assert.deepEqual((await state()).pending.at(-1), ['Apply this idea: A borrowed raincoat. QAOUTFIT.']);
        assert.equal(L.requests().length, start29);
        const scriptState = await page.evaluate(() => ({
            local: SillyTavern.getContext().chatMetadata.variables || {},
            registered: Object.keys(SillyTavern.getContext().extensionPrompts || {}),
        }));
        assert(!JSON.stringify(scriptState).includes('keel_'));
        await close();
        current.status = 'Pass';
        current.state = { importedButtons: 160, owner: 'Roleplay Instructions · Built-in', disabledQuickReply: true,
            queued: (await state()).pending.at(-1), requests: 0 };
        assert.deepEqual(errors, []);
        await evidenceFile();
        console.log('A7, A25, A29, A41–A43 passed with touch emulation. ' + Object.keys(evidence.cases).length + ' cases.');
    } catch (error) {
        if (current) {
            current.status = 'Fail';
            current.error = error.message;
        }
        evidence.errors = errors;
        await evidenceFile();
        console.error(await sheet.innerText().catch(() => 'Sheet closed'));
        throw error;
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
