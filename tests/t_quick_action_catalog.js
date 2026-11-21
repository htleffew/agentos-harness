const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const L = require('./lib.js');
const { syntheticKeel } = require('./fixtures/quick-action-keel.cjs');

(async () => {
    L.sync();
    const requests = [];
    const setupPage = async page => {
        // SillyTavern loads the Horde status selector even for a local/offline catalog test.
        await page.route('**/api/horde/text-models', route => route.fulfill({ json: [] }));
        await page.route('**/api/horde/status', route => route.fulfill({ json: { ok: false } }));
        page.on('request', request => {
            if (/\/api\/(?:backends\/.+\/generate|horde\/generate-text)/.test(request.url())) requests.push(request.url());
        });
    };
    const { browser, page, errors } = await L.open({ width: 390, height: 820, hasTouch: true, isMobile: true, setupPage });
    page.setDefaultTimeout(12000);
    try {
        await L.openChat(page);
        const sheet = page.locator('.ri-quick-sheet');
        const tap = async label => (label === 'Quick actions' ? page : sheet).getByRole('button', { name: label, exact: true }).tap();
        const chooseJSON = async (name, value) => {
            const chooser = page.waitForEvent('filechooser');
            await tap('Choose JSON file');
            await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
        };
        const suffix = Date.now().toString(36);
        const cueName = 'Remember the audience ' + suffix;
        const bookName = 'Touch Catalog ' + suffix;
        const sourceName = 'Read the room ' + suffix;
        const composer = page.locator('#send_textarea');
        await composer.fill('Half a player reply');
        await composer.evaluate(node => node.setSelectionRange(5, 8));
        await tap('Quick actions');
        await tap('Manage');

        await tap('Add nudge');
        await sheet.getByLabel('Button name', { exact: true }).fill(cueName);
        await sheet.getByLabel('Direction', { exact: true }).fill('Let who can hear this shape what is said aloud.');
        await page.setViewportSize({ width: 390, height: 430 });
        await sheet.getByText('Options', { exact: true }).tap();
        await sheet.getByLabel('Delivery', { exact: true }).selectOption('visible');
        await tap('Save button');
        await tap('Edit ' + cueName);
        await sheet.getByText('Named variations', { exact: true }).tap();
        await sheet.getByLabel('Variation name', { exact: true }).fill('At the docks');
        await sheet.getByLabel('Direction', { exact: true }).fill('Use only what people on the dock can hear.');
        await tap('Save as a variation');
        await tap('Restore first saved version');
        await tap('Confirm button restore');
        assert.equal(await sheet.getByLabel('Direction', { exact: true }).inputValue(), 'Let who can hear this shape what is said aloud.');
        await tap('Back to library');
        const action = sheet.locator('.ri-qa-library-block').filter({ has: page.getByRole('button', { name: 'Edit ' + cueName, exact: true }) }).last();
        await action.getByRole('button', { name: 'Move up', exact: true }).tap();
        await action.getByRole('button', { name: 'Remove button', exact: true }).tap();
        await sheet.getByText(/^Recently removed · /).tap();
        await tap('Recover ' + cueName);

        const book = {
            entries: {
                11: { uid: 11, comment: sourceName, content: 'Match the room.', constant: true, probability: 0,
                    key: [], extensions: { ri: { type: 'instruction', versions: [{ text: 'Watch the doors.' }, { text: 'Match the room.' }] } } },
            }, extensions: { ri: { v: 1, kind: 'instructions' } },
        };
        await tap('Import JSON');
        await chooseJSON(bookName + '.json', book);
        await sheet.getByText(sourceName + ' · instruction', { exact: true }).waitFor();
        await tap('Import reviewed JSON');
        await sheet.getByRole('status').filter({ hasText: 'Imported ' + bookName }).waitFor();
        await tap('Export library');
        const download = page.waitForEvent('download');
        await tap('Download library JSON');
        const file = await download;
        assert.equal(file.suggestedFilename(), 'roleplay-instructions-quick-actions.json');
        const exported = JSON.parse(await fs.readFile(await file.path(), 'utf8'));
        const saved = Object.values(exported.library.actions).find(item => item.title === cueName);
        assert.equal(saved.variations[0].name, 'At the docks');
        assert.equal(saved.delivery.visibility, 'visible');
        await tap('Back to library');

        const keel = syntheticKeel();
        keel.name += ' ' + suffix;
        for (const entry of keel.qrList) entry.label += ' ' + suffix;
        await tap('Import JSON');
        await chooseJSON('Synthetic Keel.json', keel);
        await sheet.getByText('23 entries · Runs in code', { exact: true }).waitFor();
        assert.equal(await sheet.getByText(/· Automatic hook$/).count(), 2);
        assert.equal(await sheet.getByText(/· Visible launcher$/).count(), 1);
        const outfit = sheet.locator('details').filter({ has: page.getByText('Original title 15 ' + suffix + ' · Direction with text', { exact: true }) }).last();
        await outfit.locator(':scope > summary').tap();
        await outfit.getByText('Install this translation', { exact: true }).tap();
        await tap('Import reviewed file and selected translations');
        await sheet.getByRole('status').filter({ hasText: 'Imported 1 button.' }).waitFor();
        assert.equal(await sheet.getByRole('button', { name: 'Edit Original title 15 ' + suffix, exact: true }).count(), 1);
        assert.equal(await sheet.getByRole('button', { name: 'Edit Original title 19 ' + suffix, exact: true }).count(), 0);

        await tap('Browse all');
        await sheet.getByLabel('Search quick actions', { exact: true }).fill(sourceName);
        await sheet.getByText('Versions and ingredients', { exact: true }).tap();
        await tap('Version 2');
        assert.equal(await sheet.getByLabel('Exact direction', { exact: true }).inputValue(), 'Match the room.');
        await tap('Pin this direction');
        await tap('Select direction');
        await sheet.getByText('Exact wording', { exact: true }).waitFor({ state: 'attached' });
        await tap('Close');
        assert.equal(await composer.inputValue(), 'Half a player reply');
        assert.deepEqual(await composer.evaluate(node => [node.selectionStart, node.selectionEnd]), [5, 8]);
        assert.equal(requests.length, 0, JSON.stringify(requests));
        assert.deepEqual(errors, []);
        console.log('Chromium ' + browser.version() + ' touch emulation at 390×820 and 390×430. Created, varied, restored, reordered, recovered, inspected 23 Keel entries with two inert hooks, imported, exported, searched, selected and pinned. Zero outgoing generation requests.');
    } catch (error) {
        console.error('Quick actions screen on failure:', await page.locator('.ri-quick-sheet').first().innerText().catch(() => 'Closed'));
        throw error;
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
