const L = require('./lib.js');
(async () => {
    L.sync(); L.mode({ done: false });
    const { browser, page, errors } = await L.open();
    page.on('console', m => { const t = m.text(); if (/Roleplay|swipe|WI\] Adding/i.test(t)) console.log('LOG', t.slice(0, 200)); });
    await L.setupApi(page);
    await L.setSettings(page, { enabled: true, showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: true, agency: 'off' } });
    await L.openChat(page); L.resetLog();
    await L.makeSet(page, 'tRegen' + Date.now(), [{ name: 'R', versions: ['R1', 'R2'], wait: 50 }]);
    await page.evaluate((text) => { const $ = globalThis.jQuery; $('#send_textarea').val(text).trigger('input'); $('#send_but').trigger('click'); }, 'go');
    for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(1500);
        console.log(await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); const m = c.chat[c.chat.length - 1]; return JSON.stringify({ gen: document.body.dataset.generating, len: c.chat.length, swipes: (m.swipes || []).length, sid: m.swipe_id, mes: (m.mes || '').slice(0, 30), rec: m.extra?.roleplay_instructions?.items?.map(x => x.status + x.misses), state: c.swipe?.state?.() }); }));
    }
    console.log('reqs', L.requests().map(r => (r.answer || '').slice(0, 30)));
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close(); L.mode({});
})();
