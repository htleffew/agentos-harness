const L = require('./lib.js');
(async () => {
    const { browser, page } = await L.open({ width: 800, height: 1280 });
    await page.evaluate(() => globalThis.jQuery('#extensions-settings-button .drawer-toggle').trigger('click'));
    await page.waitForTimeout(700);
    await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Expand')?.click());
    await page.waitForTimeout(400);
    console.log(await page.evaluate(() => { const o = document.getElementById('ri_overlay'); const cs = getComputedStyle(o); const d = document.querySelector('#rm_extensions_block'); const ds = getComputedStyle(d); const hold = getComputedStyle(document.querySelector('#top-settings-holder')); const el = document.elementFromPoint(400, 300); return JSON.stringify({ overlay: { pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor, rect: o.getBoundingClientRect(), parent: o.parentElement.tagName, display: cs.display }, drawer: { z: ds.zIndex, pos: ds.position }, hold: { z: hold.zIndex, pos: hold.position }, top: el.id + '.' + el.className, bodyTransform: getComputedStyle(document.body).transform, rootRect: document.getElementById('ri_root').getBoundingClientRect() }); }));
    await browser.close();
})();
