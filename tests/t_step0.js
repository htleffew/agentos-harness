const h = require('./h.js');
(async () => {
    const { browser, page, errors } = await h.open();
    try {
        await h.setupApi(page);
        await h.openChat(page);
        await page.evaluate(() => globalThis.jQuery('#extensionsMenuButton').length);
        await page.evaluate(async () => { document.getElementById('ri_test_clear').click(); document.getElementById('ri_test_create').click(); });
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.getElementById('ri_test_auto').click());
        await page.waitForTimeout(3000);
        await page.evaluate(() => document.getElementById('ri_test_model').click());
        await page.waitForTimeout(4000);
        for (let i = 0; i < 6; i++) await h.send(page, 'Hello ' + i);
        for (let i = 0; i < 3; i++) await h.swipe(page);
        await h.slash(page, '/del 1');
        await h.send(page, 'One more');
        console.log(await page.evaluate(() => document.getElementById('ri_test_log').value));
    } catch (e) { console.log('TEST ERROR', e.message); console.log(await page.evaluate(() => document.getElementById('ri_test_log')?.value).catch(() => '')); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
