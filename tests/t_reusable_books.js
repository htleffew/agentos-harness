const assert = require('node:assert/strict');
const { basename } = require('node:path');
const { readFileSync } = require('node:fs');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page } = await L.open({ width: 430, height: 820 });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root = page.locator('#ri_root');
        await root.locator('button').filter({ hasText: /^Expand$/ }).evaluate(button => button.click());
        const names = await page.evaluate(async base => {
            const V = await import(`${base}/src/v10.js`);
            const B = await import(`${base}/src/books.js`);
            const { app } = await import(`${base}/src/ui/panel.js`);
            V.prefs().enabled = true;
            const tag = Date.now();
            const add = (name, entries, role) => {
                const data = { entries: Object.fromEntries(entries.map((entry, uid) => [uid, {
                    ...B.blankEntry(uid), ...entry, useProbability: false, position: 0,
                }])) };
                return V.uploadReusableBook(new File([JSON.stringify(data)], `${name} ${tag}.json`), role);
            };
            const user = await add('User nudge', [
                { comment: 'User entry', content: 'USER_NUDGE_MARK', constant: false, key: ['Playerkey'] },
                { comment: 'Sticky nudge', content: 'STICKY_NUDGE_MARK', constant: false, key: ['Playerkey'],
                    sticky: 5, extensions: { riTriggerSource: 'user' } },
                { comment: 'Random reminder', content: 'RANDOM_ZERO_MARK', constant: true },
            ], 'guidelines');
            const assistant = await add('Model nudge', [
                { comment: 'Model entry', content: 'MODEL_NUDGE_MARK', constant: false, key: ['Modelkey'],
                    extensions: { riTriggerSource: 'assistant' } },
            ], 'guidelines');
            const locations = await add('Places', [{ content: 'DOCK_LORE_MARK', constant: false, key: ['Dockside'] }], 'reference');
            const people = await add('People', [{ content: 'PERSON_LORE_MARK', constant: false, key: ['Dockside'] }], 'reference');
            app.openPage('books');
            return { user, assistant, locations, people };
        }, L.BASE);

        const sampleFiles = JSON.parse(process.env.RI_SAMPLE_BOOKS || '[]');
        if (sampleFiles.length) {
            await root.getByLabel('Reusable book JSON files').setInputFiles(sampleFiles);
            await root.getByRole('button', { name: 'Upload and assign books' }).click();
            await page.waitForFunction(async base => {
                const { reusableAssignments } = await import(`${base}/src/v10.js`);
                return reusableAssignments().length === 6;
            }, L.BASE);
            for (const file of sampleFiles) {
                const row = root.locator(`[data-book-name^="${basename(file, '.json')}"]`);
                await row.waitFor();
                const name = await row.getAttribute('data-book-name');
                const entries = await page.evaluate(async ([base, name]) => {
                    const { loadBook } = await import(`${base}/src/st.js`);
                    return (await loadBook(name)).entries;
                }, [L.BASE, name]);
                assert.deepEqual(entries, JSON.parse(readFileSync(file, 'utf8')).entries);
                const card = root.locator('.ri-card').filter({ has: page.getByText(name, { exact: true }) })
                    .filter({ has: page.getByRole('button', { name: 'Pause in this chat', exact: true }) });
                await card.getByRole('button', { name: 'Pause in this chat', exact: true }).click();
            }
        }

        const row = root.locator('[data-book-name]').filter({ has: page.getByText(names.user, { exact: true }) });
        await row.getByText('Edit or delete entries', { exact: true }).click();
        const edit = comment => row.locator('li').filter({ hasText: comment }).getByRole('button', { name: 'Edit', exact: true });
        await edit('User entry').click();
        await row.getByLabel('Keyword source', { exact: true }).selectOption('user');
        await row.getByRole('button', { name: 'Save entry' }).click();
        await row.locator('li').filter({ hasText: 'User entry' }).getByText(/Latest user message · 100% chance/).waitFor();
        await edit('Random reminder').click();
        await row.getByLabel('Chance (%)', { exact: true }).fill('0');
        await row.getByRole('button', { name: 'Save entry' }).click();
        await row.getByText(/Always eligible · 0% chance/).waitFor();

        L.mode({ reply: 'The guide mentioned Modelkey.' });
        L.resetLog();
        await L.send(page, 'Playerkey, Modelkey and Dockside.');
        let prompt = L.text(L.requests()[0]);
        assert.match(prompt, /USER_NUDGE_MARK/);
        assert.match(prompt, /STICKY_NUDGE_MARK/);
        assert.match(prompt, /DOCK_LORE_MARK/);
        assert.match(prompt, /PERSON_LORE_MARK/);
        assert.doesNotMatch(prompt, /MODEL_NUDGE_MARK|RANDOM_ZERO_MARK/);
        L.mode({ reply: 'The guide went on.' });
        L.resetLog();
        await L.send(page, 'Continue.');
        prompt = L.text(L.requests()[0]);
        assert.match(prompt, /MODEL_NUDGE_MARK/);
        assert.match(prompt, /STICKY_NUDGE_MARK/);
        assert.doesNotMatch(prompt, /USER_NUDGE_MARK|RANDOM_ZERO_MARK/);
        await root.getByLabel('Reusable book role').selectOption('reference');
        await root.getByText('Create an empty book', { exact: true }).click();
        const plainName = `New locations ${Date.now()}`;
        await root.getByLabel('New book name').fill(plainName);
        await root.getByRole('button', { name: 'Create and assign' }).click();
        const newRow = root.locator('[data-book-name]').filter({ has: page.getByText(plainName, { exact: true }) });
        await newRow.getByText('Edit or delete entries', { exact: true }).click();
        await newRow.getByRole('button', { name: 'Add entry' }).click();
        await newRow.getByLabel('Entry title').fill('Old bridge');
        await newRow.getByLabel('Entry content').fill('BRIDGE_REFERENCE_MARK');
        await newRow.getByLabel('Primary triggers').fill('Old bridge');
        await newRow.getByRole('button', { name: 'Save entry' }).click();
        await newRow.getByText('Old bridge', { exact: true }).waitFor();
        await page.evaluate(() => {
            globalThis.jQuery('#world_info_budget').val(100).trigger('input');
        });
        L.resetLog();
        await L.send(page, 'They cross the Old bridge.');
        assert.ok(L.text(L.requests()[0]).includes('BRIDGE_REFERENCE_MARK'));
        console.log('PASS multiple guideline/reference imports, editable triggers and role-specific prompt delivery');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
