const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: 390, height: 820 });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root = page.locator('#ri_root');
        await L.openPanel(page);
        const names = await page.evaluate(async base => {
            const V = await import(`${base}/src/v10.js`);
            const B = await import(`${base}/src/books.js`);
            const S = await import(`${base}/src/st.js`);
            const { app } = await import(`${base}/src/ui/panel.js`);
            V.prefs().enabled = true;
            const tag = Date.now();
            const upload = async (name, role, entries) => V.uploadReusableBook(
                new File([JSON.stringify({ entries })], `${name} ${tag}.json`), role);
            const odds = await upload('Odds fixture', 'reference', {
                0: { ...B.blankEntry(0), comment: 'An occasional clue', content: 'A clue.', probability: 10,
                    useProbability: true, constant: true, key: ['Archive'], cooldown: 10, sticky: 2 },
                1: { ...B.blankEntry(1), comment: 'A rarer clue', content: 'A different clue.', probability: 3,
                    useProbability: undefined, constant: false, key: ['Archive door'], cooldown: 12, sticky: 4 },
                2: { ...B.blankEntry(2), comment: 'A disabled roll', content: 'No roll.', probability: 15,
                    useProbability: false, constant: false, key: ['Study'] },
            });
            const pinned = await upload('Base fixture', 'base', {
                0: { ...B.blankEntry(0), comment: 'Old road', content: 'DISPOSABLE_BASE_MARK', constant: true, probability: 100 },
            });
            const story = await V.ensureWorld();
            S.ctx().chatMetadata.world_info = pinned;
            app.openPage('books');
            return { odds, pinned, story };
        }, L.BASE);
        const card = name => root.locator('.ri-book-catalog > .ri-card')
            .filter({ has: page.getByText(name, { exact: true }) });
        const assigned = root.locator('.ri-assigned-book').filter({ has: page.getByText(names.odds, { exact: true }) });
        await assigned.getByText('Edit or delete entries', { exact: true }).click();
        await assigned.getByText(/Always eligible · 10% chance · Sticky 2 · Cooldown 10 messages/).waitFor();
        await assigned.getByText(/Keyword triggered.*3% chance · Sticky 4 · Cooldown 12 messages/).waitFor();
        await assigned.getByText('Change recall settings for selected entries', { exact: true }).click();
        const chanceField = assigned.getByLabel('Selected entries chance (%)', { exact: true });
        assert.equal(await chanceField.inputValue(), '');
        assert.equal(await assigned.getByLabel('Selected entries activation', { exact: true }).inputValue(), '');
        const contrast = control => control.evaluate(element => {
            const css = getComputedStyle(element);
            const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number)
                .map(channel => channel / 255).map(channel => channel <= 0.04045
                    ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
                .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            const foreground = luminance(css.webkitTextFillColor);
            const background = luminance(css.backgroundColor);
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        assert.ok(await contrast(chanceField) >= 4.5);
        await assigned.getByLabel('Select all entries', { exact: true }).check();
        await assigned.getByLabel('Selected entries cooldown', { exact: true }).fill('7');
        await assigned.getByRole('button', { name: 'Apply recall settings to selected', exact: true }).click();
        await assigned.getByText(/10% chance · Sticky 2 · Cooldown 7 messages/).waitFor();
        const stored = await page.evaluate(async ([base, name]) => {
            const { loadBook } = await import(`${base}/src/st.js`);
            return Object.values((await loadBook(name)).entries).map(entry =>
                [entry.probability, entry.useProbability, entry.constant, entry.key, entry.sticky, entry.cooldown]);
        }, [L.BASE, names.odds]);
        assert.deepEqual(stored, [
            [10, true, true, ['Archive'], 2, 7],
            [3, true, false, ['Archive door'], 4, 7],
            [15, false, false, ['Study'], null, 7],
        ]);
        const open = path => page.evaluate(async ([base, name]) => {
            const { app } = await import(`${base}/src/ui/panel.js`);
            app.openPage(name);
        }, [L.BASE, path]);
        await open('emotion');
        assert.ok(await contrast(root.getByLabel('Persistence in replies', { exact: true })) >= 4.5);
        L.mode({ reply: 'The scene continues.' });
        L.resetLog();
        await L.send(page, 'I look down the old road.');
        assert.match(L.text(L.requests()[0]), /DISPOSABLE_BASE_MARK/);
        await open('books');
        await card(names.odds).getByRole('button', { name: 'Remove from this chat', exact: true }).click();
        await assigned.waitFor({ state: 'detached' });
        const pinnedCopy = await page.evaluate(async base => (await import(`${base}/src/v10.js`)).prefs().base, L.BASE);
        await card(names.pinned).getByRole('button', { name: 'Remove from this chat', exact: true }).click();
        await card(names.pinned).getByText(/Removed from this chat/).waitFor();
        await card(names.story).getByRole('button', { name: 'Remove from this chat', exact: true }).click();
        await card(names.story).getByText(/Earlier or source Story World/).waitFor();

        const state = () => page.evaluate(async base => {
            const { chatWorld } = await import(`${base}/src/world.js`);
            const { chatState } = await import(`${base}/src/store.js`);
            const { worldNames, ctx } = await import(`${base}/src/st.js`);
            return { book: chatWorld(), detached: chatState().worldDetached, base: chatState().v10.base,
                attachment: ctx().chatMetadata.world_info, names: worldNames() };
        }, L.BASE);
        const detached = await state();
        assert.ok(detached.detached);
        assert.equal(detached.book, '');
        assert.equal(detached.base, null);
        assert.equal(detached.attachment, undefined);
        assert.ok(Object.values(names).every(name => detached.names.includes(name)));
        await card(names.story).getByRole('button', { name: 'Hide from list', exact: true }).click();
        await card(names.story).waitFor({ state: 'detached' });
        await root.getByRole('button', { name: 'Show hidden books', exact: true }).click();
        await card(names.story).getByRole('button', { name: 'Show in list', exact: true }).waitFor();

        await page.evaluate(name => { SillyTavern.getContext().chatMetadata.world_info = name; }, names.pinned);
        L.resetLog();
        await L.send(page, 'What do I see?');
        assert.doesNotMatch(L.text(L.requests()[0]), /DISPOSABLE_BASE_MARK/);
        assert.equal((await state()).book, '');
        await open('books');
        await card(names.pinned).getByRole('button', { name: 'Delete book everywhere', exact: true }).click();
        await page.locator('dialog[open] .popup-button-cancel').click();
        assert.ok((await state()).names.includes(names.pinned));
        await card(names.pinned).getByRole('button', { name: 'Delete book everywhere', exact: true }).click();
        await page.locator('dialog[open] .popup-button-ok').click();
        await card(names.pinned).getByText('Referenced by this chat. The host no longer lists this book.', { exact: true }).waitFor();
        assert.ok(!(await state()).names.includes(names.pinned));
        const cached = await page.evaluate(async ([base, oldPin]) => {
            const V = await import(`${base}/src/v10.js`);
            V.prefs().base = oldPin;
            const lore = { chatLore: [] };
            try {
                await V.addConfiguredBooks(lore, [lore.chatLore], {}, {});
                return { pin: V.baseWorld(), entries: lore.chatLore };
            } finally { V.prefs().base = null; }
        }, [L.BASE, pinnedCopy]);
        assert.deepEqual(cached, { pin: null, entries: [] });
        await card(names.odds).getByRole('button',{name:'Open in World Info',exact:true}).click();
        await page.locator('#WorldInfo').waitFor({state:'visible'});
        assert.equal(await root.evaluate(node=>node.classList.contains('ri-expanded')),false);
        assert.equal(await page.locator('#world_editor_select option:checked').textContent(),names.odds);
        assert.deepEqual(errors, []);
        console.log('PASS book odds, numeric contrast, removal, historical cards and confirmed host deletion');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
