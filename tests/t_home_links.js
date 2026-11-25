// B28 (B27 criterion 2): the Roast link row in the Presets block editor and the impersonation link row in the quick action
// sheet each land on their home in Setup, Features. Touch emulation at 390 x 820 on a real SillyTavern host with the mock model.
const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: 390, height: 820, hasTouch: true, isMobile: true });
    try {
        await L.usePreset(page, 'Roleplay Instructions V10');
        await L.setupApi(page, { preset: null });
        await L.openChat(page);
        await page.evaluate(async B => {
            const V = await import(`${B}/src/v10.js`);
            V.prefs().enabled = true;
            V.prefs().modules = { ...(V.prefs().modules || {}), roast: true };
        }, L.BASE);
        const landed = () => page.evaluate(async B => {
            const { app } = await import(`${B}/src/ui/panel.js`);
            return { tab: app.tab, expanded: app.root.classList.contains('ri-expanded') };
        }, L.BASE);

        // Setup, Look: the Roast link row lands on the Roast voice home (the Presets block editor that also carried one is retired, B36).
        await L.openPanel(page, 'display');
        for (let pass = 0; pass < 3; pass++) {
            await page.evaluate(() => { for (const fold of document.querySelectorAll('#ri_panel_page details')) fold.open = true; });
            await page.waitForTimeout(400);
        }
        const roastRow = page.locator('#ri_panel_page [data-home-link="roast-voice"]').first();
        await roastRow.waitFor({ timeout: 10000 });
        await roastRow.scrollIntoViewIfNeeded();
        await roastRow.getByRole('button', { name: /^Open Setup/ }).tap();
        await page.waitForSelector('#ri_panel_page [data-control="roast-voice"]', { timeout: 10000 });
        const roast = await landed();
        assert.equal(roast.tab, 'v10', 'the Roast link row lands on Setup, Features');
        assert.equal(roast.expanded, true);
        const roastVisible = await page.evaluate(() => {
            const home = document.querySelector('#ri_panel_page [data-control="roast-voice"]');
            const box = home.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.top < innerHeight;
        });
        assert.equal(roastVisible, true, 'the Roast voice home is on screen');
        console.log('PASS Roast link row on Setup, Look lands on its home');

        // The quick action sheet for Draft my reply: the impersonation prompts have a link row that opens their home.
        await page.evaluate(async B => (await (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false)), L.BASE);
        await L.openQuickActions(page);
        const sheet = page.locator('.ri-quick-sheet');
        await sheet.getByRole('button', { name: 'Draft my reply', exact: true }).first().tap();
        const impersonationRow = sheet.locator('[data-home-link="impersonation-prompts"]');
        await impersonationRow.waitFor({ state: 'attached', timeout: 10000 });
        await impersonationRow.evaluate(node => { for (let item = node; item; item = item.parentElement) if (item.tagName === 'DETAILS') item.open = true; });
        await impersonationRow.waitFor({ timeout: 10000 });
        assert.equal(await impersonationRow.count(), 1, 'the sheet shows one impersonation link row');
        await impersonationRow.getByRole('button', { name: /^Open Setup/ }).tap();
        await page.waitForSelector('#ri_panel_page [data-control="impersonation-prompts"]', { timeout: 10000 });
        const impersonation = await landed();
        assert.equal(impersonation.tab, 'v10', 'the impersonation link row lands on Setup, Features');
        assert.equal(impersonation.expanded, true);
        console.log('PASS impersonation link row in the quick action sheet lands on its home');
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
