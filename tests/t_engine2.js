const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const six = (o = {}) => ['A', 'B', 'C', 'D', 'E', 'F'].map((k, i) => ({ name: k, versions: [k + '1', k + '2'], chance: o.chance ?? 100, sendTogether: o.together ? (i < 2 ? 'g1' : i < 4 ? 'g2' : '') : '' }));
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        // ---- C: swipe and regenerate repeat the same instructions; Pick again rolls fresh ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tC' + Date.now(), six({ chance: 50 }));
        await L.send(page, 'one'); await L.send(page, 'two');
        for (let i = 0; i < 4; i++) await L.swipe(page);
        await L.regenerate(page);
        let reqs = L.chatRequests();
        let seq = reqs.map(r => L.marks(r).sort().join(','));
        console.log('C marks:', seq);
        assert(reqs.length === 7 && seq.slice(1).every(s => s === seq[1]), 'C: 4 swipes and 1 regenerate carry the same instructions and versions as the original reply');
        let got = new Set();
        for (let i = 0; i < 6; i++) { await page.evaluate(async (B) => { const E = await import(`${B}/src/engine.js`); await E.pickAgainNow(); }, L.BASE); await page.waitForTimeout(600); await L.idle(page); got.add(L.marks(L.chatRequests().slice(-1)[0]).sort().join(',')); }
        console.log('C pick again results:', [...got]);
        assert(got.size > 1, 'C: Pick again rolls fresh');

        // ---- D: limits ----
        for (const [limit, max, test, label] of [
            ['one', 2, m => m.length === 1, 'One per reply: exactly 1'],
            ['max', 2, m => m.length === 2, 'At most 2: exactly 2 when 6 are ready'],
            ['together', 2, m => { const g = m.map(x => 'AB'.includes(x[0]) ? 'g1' : 'CD'.includes(x[0]) ? 'g2' : x[0]); return new Set(g).size === 1 && (g[0].length === 1 ? m.length === 1 : m.length === 2); }, 'One Send-together group: one whole group only'],
            ['none', 2, m => m.length === 6, 'No limit: all 6'],
        ]) {
            await L.openChat(page); L.resetLog();
            await L.makeSet(page, 'tD' + limit + Date.now(), six({ together: true }), { limit, max });
            for (let i = 0; i < 6; i++) await L.send(page, 'm' + i);
            const all = L.chatRequests().map(r => L.marks(r));
            console.log(`D ${limit}:`, all.map(m => m.join('')).join(' | '));
            assert(all.length === 6 && all.every(test), `D: ${label}`);
            if (limit === 'together') assert(new Set(all.map(m => m[0][0])).size > 1, 'D: different groups get their turn');
        }

        // ---- E: quiet and impersonate carry nothing and do not use up timers ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tE' + Date.now(), [{ name: 'E', versions: ['E1'], wait: 3 }]);
        await L.send(page, 'start');
        const t0 = await page.evaluate(() => JSON.stringify(globalThis.SillyTavern.getContext().chatMetadata.timedWorldInfo));
        await L.slash(page, '/gen say hi'); await L.idle(page);
        await L.slash(page, '/impersonate'); await L.idle(page);
        const t1 = await page.evaluate(() => JSON.stringify(globalThis.SillyTavern.getContext().chatMetadata.timedWorldInfo));
        const all = L.requests().filter(r => !/"done"/.test(L.text(r)));
        console.log('E requests:', all.map(r => L.marks(r).join('') || '-'), 'timers same:', t0 === t1);
        assert(all.length === 3 && L.marks(all[0]).length === 1 && L.marks(all[1]).length === 0 && L.marks(all[2]).length === 0 && t0 === t1, 'E: quiet and impersonate carry no instruction and leave timers alone');
        await page.evaluate(() => globalThis.jQuery('#send_textarea').val('').trigger('input'));

        // ---- F: keep sending for 2 more replies, same version; then wait ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tF' + Date.now(), [{ name: 'F', versions: ['F1', 'F2', 'F3'], keep: 2, wait: 2 }]);
        for (let i = 0; i < 8; i++) await L.send(page, 'k' + i);
        seq = L.chatRequests().map(r => L.marks(r).join('') || '-');
        console.log('F marks:', seq);
        assert(seq[0] !== '-' && seq[0] === seq[1] && seq[1] === seq[2] && seq[3] === "-" && seq[4] === "-" && seq[5] !== "-" && seq[5] !== seq[0] && seq[5] === seq[6] && seq[6] === seq[7], 'F: sent 3 replies with one version, waits 2 replies, then a new version');
        const recs = await L.records(page);
        console.log('F kinds:', recs.filter(r => r.rec).map(r => r.rec.items[0].kind));
    } catch (e) { console.log('TEST ERROR', e.stack); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
