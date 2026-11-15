const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        await L.setSettings(page, { enabled: true, showUnder: 'off', check: { mode: 'full', agency: 'off', regenOnMiss: false } });
        await L.openChat(page); L.resetLog();
        const name = 'cfb100 ' + Date.now();
        const before = await page.evaluate(async ([B, name]) => {
            const c = globalThis.SillyTavern.getContext();
            const d = await c.loadWorldInfo('char_feelings_bank');
            for (const e of Object.values(d.entries)) { e.probability = 100; e.cooldown = 0; e.sticky = 0; }
            await c.saveWorldInfo(name, d, true); await c.updateWorldInfoList();
            const M = await import(`${B}/src/books.js`); const S = await import(`${B}/src/store.js`);
            await M.adoptSet(name); const cs = S.chatState(); cs.activeSets = [name]; S.saveChatState();
            return JSON.stringify(await c.loadWorldInfo(name));
        }, [L.BASE, name]);
        for (let i = 0; i < 6; i++) { await L.send(page, 'm' + i); await L.waitChecks(page); }
        const reqs = L.chatRequests();
        const notes = reqs.map(r => [...L.text(r).matchAll(/\[SYSTEM NOTE: ([^\]]*)\]/g)].map(m => m[1]));
        console.log(notes.map(n => n.join(' || ')).join('\n'));
        assert(notes.every(n => n.length === 1 && !/\{\{|::/.test(n[0])), 'import: each prompt has exactly one note from the Only-one group, with names filled in');
        const recs = (await L.records(page)).filter(r => r.rec);
        assert(recs.length === 6 && recs.every(r => r.rec.items.length === 1 && r.rec.items[0].text.startsWith('[SYSTEM NOTE:')), 'import: every reply has a record with the exact text');
        const after = await page.evaluate(async (name) => JSON.stringify(await globalThis.SillyTavern.getContext().loadWorldInfo(name)), name);
        assert(before === after, 'import: opening and using the lorebook leaves its file unchanged');
    } catch (e) { console.log('TEST ERROR', e.stack); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
