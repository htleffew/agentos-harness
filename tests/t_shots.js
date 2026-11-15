const L = require('./lib.js');
(async () => {
    L.sync(); L.mode({});
    for (const [w, hgt, tag] of [[800, 1280, 'tab'], [412, 900, 'phone']]) {
        const { browser, page, errors } = await L.open({ width: w, height: hgt });
        try {
            await L.setupApi(page);
            await L.setSettings(page, { enabled: true, showUnder: 'display', check: { mode: 'full', agency: 'flag', regenOnMiss: false } });
            await L.openChat(page, { fresh: tag === 'tab' });
            if (tag === 'tab') { await L.makeSet(page, 'Feelings demo', [{ name: 'Pays a compliment', chance: 100, versions: ['A1', 'A2', 'A3'] }, { name: 'Picks a fight', chance: 5, wait: 7, versions: ['B1', 'B2'] }], { limit: 'one' }); await L.send(page, 'Hello'); await L.waitChecks(page); }
            await page.evaluate(() => globalThis.jQuery('#extensions-settings-button .drawer-toggle').trigger('click'));
            await page.waitForTimeout(700);
            await page.evaluate(() => { document.querySelector('#ri_drawer .inline-drawer-toggle').click(); });
            await page.waitForTimeout(500);
            await page.evaluate(() => document.querySelector('#ri_root').scrollIntoView({ block: 'start' }));
            await page.waitForTimeout(300);
            await page.screenshot({ path: `/tmp/t_${tag}_1.png` });
            await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-tab')].find(t => t.textContent === 'Settings').click());
            await page.waitForTimeout(300);
            await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Expand').click());
            await page.waitForTimeout(300);
            await page.screenshot({ path: `/tmp/t_${tag}_2.png` });
            await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-tab')].find(t => t.textContent === 'What Was Sent').click());
            await page.waitForTimeout(700);
            await page.screenshot({ path: `/tmp/t_${tag}_3.png` });
            await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Close full screen').click());
            await page.evaluate(() => globalThis.jQuery('#extensions-settings-button .drawer-toggle').trigger('click'));
            await page.waitForTimeout(500);
            await page.evaluate(() => { document.querySelectorAll('#chat .mes .ri-under details').forEach(d => d.open = true); document.querySelector('#chat').scrollTo(0, 99999); });
            await page.waitForTimeout(800);
            await page.screenshot({ path: `/tmp/t_${tag}_4.png` });
        } catch (e) { console.log('TEST ERROR', tag, e.message); await page.screenshot({ path: `/tmp/t_${tag}_err.png` }); }
        console.log(tag, 'ERRORS', errors.slice(0, 5));
        await browser.close();
    }
})();
