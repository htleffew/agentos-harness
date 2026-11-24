// MB7 browser suite on a SillyTavern 1.19.0 host with the mock model, touch at 412 x 900:
//   1. The tray's Story changes card shows a code merge with Undo and Restore; Undo and Restore each survive a page reload.
//   2. A World Info book with additions opens in SillyTavern's World Info screen, holds only SillyTavern's own fields, and
//      its export opens there as well.
// Run with the host variables of tests/README.md. RI_EVIDENCE names the screenshot folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'MB7');
fs.mkdirSync(dir, { recursive: true });
const out = { run: new Date().toISOString(), checks: {} };

const fold = (page, id) => page.evaluate(async ({ B, id }) => {
    const F = await import(`${B}/src/memory/fold.js`);
    const c = SillyTavern.getContext();
    const r = F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get(id);
    return r ? { status: r.status, text: r.text, mergedInto: r.mergedInto || '' } : null;
}, { B: L.BASE, id });

/** Reload the page and open the same chat again, as a person reopening the app does. */
async function reload(page) {
    const chatId = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'), null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async chatId => {
        const c = SillyTavern.getContext();
        if (c.getCurrentChatId() === chatId) return;
        const idx = c.characters.findIndex(x => x.name);
        if (String(c.characterId) !== String(idx)) await c.selectCharacterById(idx);
        await new Promise(r => setTimeout(r, 800));
        if (c.getCurrentChatId() !== chatId) await c.openCharacterChat(chatId);
    }, chatId);
    await page.waitForFunction(id => SillyTavern.getContext().getCurrentChatId() === id && (SillyTavern.getContext().chat || []).length >= 5, chatId, { timeout: 30000 });
    await page.waitForTimeout(2500);
}

/** Open the reply tray of the last reply on its Story changes card and return the card's panel. */
async function storyChangesCard(page, name) {
    const tray = page.locator('#chat .last_mes .ri-tray:not(.ri-tray-loading)');
    await tray.waitFor({ timeout: 30000 });
    // The compact tray lists one line per card; the line opens its card. The expanded tray shows the cards as tabs.
    const line = tray.locator('.ri-tray-line', { hasText: 'Story changes' });
    const tab = tray.getByRole('tab', { name: /Story changes/ });
    const target = await line.isVisible().catch(() => false) ? line : tab;
    if (!await target.isVisible().catch(() => false)) await tray.locator('.ri-tray-summary').tap();
    await target.tap({ timeout: 10000 }).catch(async error => {
        fs.writeFileSync(path.join(dir, `${name}-tray.html`), await tray.evaluate(node => node.outerHTML));
        await page.locator('#chat .last_mes').screenshot({ path: path.join(dir, `${name}-fail.png`) });
        throw error;
    });
    const section = tray.locator('.ri-story-changes');
    await section.waitFor({ timeout: 15000 });
    await page.locator('#chat .last_mes').screenshot({ path: path.join(dir, `${name}.png`) });
    return section;
}

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: 412, height: 900, hasTouch: true, isMobile: true });
    try {
        const preset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'Roleplay Instructions V10.json'), 'utf8'));
        await L.setupApi(page);
        await page.evaluate(async value => { await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name, value); }, preset);
        await L.usePreset(page, preset.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(() => !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 });
        const answer = op => ({ decisions: { durable_change: !!op, scene_ended: false, out_of_character: false }, ops: op ? [op] : [], state: { scene: { place: 'Elerian Keep gatehouse', time: 'Day 1, dawn', present: ['Hale'] } } });
        L.mode({ capture: answer({ op: 'add', id: 'gate-bar', target: [], kind: 'fact', subject: 'Elerian Keep gate', attribute: 'bar', text: 'The gate of Elerian Keep is barred with an iron beam.', quote: 'Reply' }) });
        await L.send(page, 'I check the gate.');
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        L.mode({ capture: answer(null) });
        await L.send(page, 'I walk to the courtyard.');
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return !!F.fold(c.chat, c.chatMetadata).byId.get('gate-bar'); }, L.BASE, { timeout: 30000 });

        // The same fact filed again on the newest reply (as a catch-up or an import can), then upkeep after the reply.
        const zero = await page.evaluate(async B => {
            const S = await import(`${B}/src/memory/store.js`);
            const U = await import(`${B}/src/memory/upkeep.js`);
            const c = SillyTavern.getContext();
            await S.memoryStore().recordOnReply(c.chat.length - 1, [{ op: 'add', record: { id: 'gate-bar-2', kind: 'fact', subject: 'Elerian Keep gate', attribute: 'bar', text: 'The gate of Elerian Keep is barred with an iron beam.', status: 'current', importance: 5 }, origin: { type: 'catch-up' } }]);
            return U.afterReply();
        }, L.BASE);
        out.checks.afterReply = zero;
        assert.equal(zero.merges, 1, 'level 0 merged the identical records in code');
        assert.equal((await fold(page, 'gate-bar-2')).status, 'merged');

        // Undo from the Story changes card, then reload.
        await reload(page);
        let card = await storyChangesCard(page, 'story-changes-merge');
        const mergeRow = card.locator('.ri-c-row', { hasText: 'Merged' });
        assert.equal(await mergeRow.count(), 1, 'the card lists the code merge');
        assert.ok(await mergeRow.getByRole('button', { name: 'Undo', exact: true }).isVisible());
        assert.ok(await mergeRow.getByRole('button', { name: /Restore gate-bar-2/ }).isVisible(), 'and Restore for the record it retired');
        await mergeRow.getByRole('button', { name: 'Undo', exact: true }).tap();
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('gate-bar-2')?.status === 'current'; }, L.BASE, { timeout: 15000 });
        await page.waitForTimeout(1500);
        await reload(page);
        out.checks.afterUndoReload = await fold(page, 'gate-bar-2');
        assert.equal(out.checks.afterUndoReload.status, 'current', 'Undo survives a reload');
        card = await storyChangesCard(page, 'story-changes-undone');
        assert.ok(await card.locator('.ri-c-row', { hasText: 'Merged' }).getByText(/reverted/).count() >= 1, 'the card shows the merge as reverted');

        // Restore: merge again, tap Restore on the card, reload.
        await page.evaluate(async B => {
            const U = await import(`${B}/src/memory/upkeep.js`);
            const S = await import(`${B}/src/memory/store.js`);
            const F = await import(`${B}/src/memory/fold.js`);
            const c = SillyTavern.getContext();
            await S.memoryStore().record(U.levelZero(F.fold(c.chat, c.chatMetadata, { cache: false })).merges);
        }, L.BASE);
        assert.equal((await fold(page, 'gate-bar-2')).status, 'merged');
        await reload(page);
        card = await storyChangesCard(page, 'story-changes-restore');
        await card.getByRole('button', { name: /Restore gate-bar-2/ }).first().tap();
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('gate-bar-2')?.status === 'current'; }, L.BASE, { timeout: 15000 });
        await page.waitForTimeout(1500);
        await reload(page);
        out.checks.afterRestoreReload = await fold(page, 'gate-bar-2');
        assert.equal(out.checks.afterRestoreReload.status, 'current', 'Restore survives a reload');
        console.log('PASS Story changes card: Undo and Restore survive a reload');

        // A book with additions in SillyTavern's World Info screen, and its export.
        // The Hale of Verath book when docs/ is present (a release ships tests/ without it), else three entries in its shape.
        const loreFile = path.join(__dirname, '..', 'docs', 'roleplay-cards', 'hale-of-verath', 'Hale of Verath - World Info.json');
        const entry = (uid, comment, key, content) => ({ uid, displayIndex: uid, comment, key, keysecondary: [], content, constant: false, selective: true, disable: false, order: 100, position: 0 });
        const lore = fs.existsSync(loreFile) ? JSON.parse(fs.readFileSync(loreFile, 'utf8')) : { entries: {
            0: entry(0, 'Night', ['Night', "Hale's horse"], "Night is Hale's black destrier."),
            1: entry(1, 'Ser Marten Drey', ['Marten', 'Drey'], 'Ser Marten Drey is a knight of the Vanguard.'),
            2: entry(2, 'Saltmar', ['Saltmar'], 'Saltmar is a fort on a tidal marsh.') } };
        const wi = await page.evaluate(async ({ B, lore }) => {
            const A = await import(`${B}/src/memory/additions.js`);
            const st = await import(`${B}/src/st.js`);
            const c = SillyTavern.getContext();
            const name = 'MB7 additions book';
            await c.saveWorldInfo(name, lore, true);
            await c.updateWorldInfoList?.();
            const records = [
                { id: 'night-shoe', kind: 'fact', subject: 'Night', text: "Hobb fitted Night with a new iron shoe on the left fore.", status: 'current', importance: 7, versions: [{ entry: 'x', anchor: { mark: 'm-test' } }] },
                { id: 'pip', kind: 'person', subject: 'Pip', text: 'Pip is a fishing boy at the Saltmar causeway.', aliases: ['the fishing boy'], status: 'current', importance: 6, versions: [{ entry: 'y', anchor: { mark: 'm-test' } }] },
                { id: 'marten-name', kind: 'fact', subject: 'Marten', text: 'The riders call Marten the rear knight.', aliases: ['the rear knight'], status: 'current', importance: 4, versions: [{ entry: 'z', anchor: { mark: 'm-test' } }] },
            ];
            const meta = {};
            const run = await A.runAdditions({ books: [{ name, roles: ['Host chat attachment'] }], io: { loadBook: st.loadBook, saveBook: st.saveBook, now: () => Date.now() }, meta, records, atClose: true });
            const saved = await st.loadBook(name);
            const exported = A.exportBook(saved);
            await c.saveWorldInfo(`${name} export`, exported, true);
            await c.updateWorldInfoList?.();
            return { made: run.made.map(r => ({ kind: r.kind, uid: r.uid, value: r.value })), entries: Object.keys(saved.entries).length, foreign: A.foreignFields(saved), exportedSame: JSON.stringify(exported) === JSON.stringify(saved) };
        }, { B: L.BASE, lore });
        out.checks.worldInfo = wi;
        assert.deepEqual(wi.made.map(r => r.kind).sort(), ['entry', 'key', 'line']);
        assert.deepEqual(wi.foreign, []);
        assert.ok(wi.exportedSame, 'the export is the book itself: nothing of ours to strip');
        // SillyTavern's editor shows 25 entries a page by default; one page of 50 lists the whole book.
        await page.evaluate(() => SillyTavern.getContext().accountStorage.setItem('WI_PerPage', '50'));
        for (const name of ['MB7 additions book', 'MB7 additions book export']) {
            const opened = await page.evaluate(async ({ B, name }) => (await import(`${B}/src/chat-books.js`)).openHostBook(name), { B: L.BASE, name });
            assert.ok(opened, `${name} opens in the World Info editor`);
            await page.waitForFunction(n => document.querySelectorAll('#world_popup_entries_list .world_entry').length >= n, wi.entries, { timeout: 20000 });
            const shown = await page.evaluate(() => ({
                entries: document.querySelectorAll('#world_popup_entries_list .world_entry').length,
                titles: [...document.querySelectorAll('#world_popup_entries_list .world_entry textarea[name="comment"]')].map(t => t.value),
            }));
            assert.equal(shown.entries, wi.entries, `${name}: every entry is listed`);
            assert.ok(shown.titles.includes('Pip'), `${name}: the added entry is listed by its title`);
            await page.screenshot({ path: path.join(dir, `world-info-${name.endsWith('export') ? 'export' : 'book'}.png`) });
            out.checks[`editor:${name}`] = shown.entries;
        }
        console.log('PASS a book with additions and its export open in the World Info screen with SillyTavern\'s own fields only');
        out.errors = [...errors];
        assert.deepEqual(errors, []);
    } finally {
        fs.writeFileSync(path.join(dir, 'upkeep-browser.json'), JSON.stringify(out, null, 1));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
