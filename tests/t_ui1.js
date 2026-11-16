const h = require('./h.js');
const click = (page, text, root = '#ri_root') => page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text || x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]);
(async () => {
    const { browser, page, errors } = await h.open({ width: 1100, height: 1500 });
    try {
        await h.setupApi(page);
        await h.openChat(page);
        await click(page, 'Expand');
        await page.waitForTimeout(300);
        await page.screenshot({ path: '/tmp/s1_empty.png' });
        await click(page, 'Open a lorebook');
        await page.waitForTimeout(300);
        await page.evaluate(() => { const s = document.querySelector('#ri_root .ri-pick select'); s.value = 'char_feelings_bank'; s.dispatchEvent(new Event('change')); });
        await click(page, 'Open', '#ri_root .ri-pick');
        await page.waitForTimeout(800);
        console.log('instructions:', await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-inscard')].map(c => c.querySelector('.ri-card-name').textContent + ' | ' + [...c.querySelectorAll('.ri-chip')].map(x => x.textContent).join('; '))));
        await page.screenshot({ path: '/tmp/s2_set.png' });
        await page.evaluate(() => document.querySelector('#ri_root .ri-inscard .ri-card-name').click());
        await page.waitForTimeout(500);
        await page.screenshot({ path: '/tmp/s3_edit.png', fullPage: false });
        await page.evaluate(() => document.querySelector('#ri_root .ri-body').scrollTo(0, 1400));
        await page.waitForTimeout(200);
        await page.screenshot({ path: '/tmp/s4_edit2.png' });
    } catch (e) { console.log('TEST ERROR', e.message); await page.screenshot({ path: '/tmp/s_err.png' }); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
