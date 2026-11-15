// Shows what World Info's own timers do when it is handed a window of recent messages (extension turned off).
const L = require('./lib.js');
(async () => {
    L.sync(); L.mode({});
    const { browser, page } = await L.open();
    await L.setupApi(page);
    await L.setSettings(page, { enabled: false });
    await L.openChat(page); L.resetLog();
    const name = 'tNative' + Date.now();
    await L.makeSet(page, name, [{ name: 'N', versions: ['N1', 'N2'], wait: 2 }], { activate: false });
    await page.evaluate(async (n) => { const c = globalThis.SillyTavern.getContext(); c.chatMetadata.world_info = n; await c.saveMetadata(); }, name);
    for (let i = 0; i < 10; i++) await L.send(page, 'm' + i);
    console.log(`window=${process.env.RI_WINDOW || 0}:`, L.chatRequests().map(r => L.marks(r).length ? 'S' : '-').join(''));
    await L.setSettings(page, { enabled: true }); await page.waitForTimeout(2000);
    await browser.close();
})();
