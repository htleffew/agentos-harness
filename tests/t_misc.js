const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const wording = r => { const t = L.text(r); return /Final\. This must happen early/.test(t) ? 'final' : /Overdue\. This was ordered/.test(t) ? 'overdue' : L.marks(r).length ? 'first' : 'none'; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        // ---- a: extension turned off, lorebook turned on in World Info for the chat ----
        await L.setSettings(page, { enabled: false, showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' } });
        await L.openChat(page); L.resetLog();
        const nameA = 'tOff' + Date.now();
        await L.makeSet(page, nameA, [{ name: 'Off', versions: ['O1', 'O2', 'O3'] }], { activate: false });
        await page.evaluate(async (n) => { const c = globalThis.SillyTavern.getContext(); c.chatMetadata.world_info = n; await c.saveMetadata(); }, nameA);
        await L.send(page, 'a'); await L.send(page, 'b');
        let reqs = L.chatRequests();
        const offText = L.text(reqs[0]).match(/\[System note: In this reply,[^\]]*\]/);
        console.log('a off:', offText && offText[0], '| records:', (await L.records(page)).filter(r => r.rec).length);
        assert(offText && !/\{\{/.test(offText[0]) && L.marks(reqs[1]).length === 1 && (await L.records(page)).filter(r => r.rec).length === 0, 'a: with the extension off the lorebook still sends a filled-in instruction, and nothing is recorded');
        await L.setSettings(page, { enabled: true });

        // ---- c: write a new reply right away when missed ----
        await L.setSettings(page, { check: { regenOnMiss: true } });
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await L.makeSet(page, 'tRegen' + Date.now(), [{ name: 'R', versions: ['R1', 'R2'], wait: 50 }]);
        await L.send(page, 'go'); await page.waitForTimeout(2500); await L.idle(page); await L.waitChecks(page); await page.waitForTimeout(1500); await L.idle(page); await L.waitChecks(page);
        let kinds = L.chatRequests().map(wording);
        console.log('c after first message:', kinds);
        assert(JSON.stringify(kinds) === JSON.stringify(['first', 'overdue']), 'c: one automatic new reply with Overdue wording, then it stops');
        await L.send(page, 'next'); await L.waitChecks(page);
        kinds = L.chatRequests().map(wording);
        console.log('c after second message:', kinds);
        assert(kinds[2] === 'final', 'c: the next message carries the Final wording');
        await L.setSettings(page, { check: { regenOnMiss: false } }); L.mode({});

        // ---- d: Send again and Undo done from What Was Sent ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tAgain' + Date.now(), [{ name: 'S', versions: ['S1', 'S2'], wait: 50 }]);
        await L.send(page, 'one'); await L.waitChecks(page);
        await page.evaluate(async (B) => { const E = await import(`${B}/src/engine.js`); const id = globalThis.SillyTavern.getContext().chat.length - 1; E.sendAgain(id, 0); }, L.BASE);
        await L.send(page, 'two'); await L.waitChecks(page);
        await page.evaluate(async (B) => { const E = await import(`${B}/src/engine.js`); const id = globalThis.SillyTavern.getContext().chat.length - 1; E.undoDone(id, 0); }, L.BASE);
        await L.send(page, 'three'); await L.waitChecks(page);
        await L.send(page, 'four'); await L.waitChecks(page);
        reqs = L.chatRequests(); kinds = reqs.map(wording);
        console.log('d:', kinds, reqs.map(r => L.marks(r).join('')));
        assert(JSON.stringify(kinds) === JSON.stringify(['first', 'first', 'overdue', 'none']) && new Set(reqs.slice(0, 3).map(r => L.marks(r)[0])).size === 1, 'd: Send again repeats it with normal wording; Undo done sends it with Overdue wording; then it rests');

        // ---- e: continue keeps the same instruction ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tCont' + Date.now(), [{ name: 'K', versions: ['K1', 'K2', 'K3'], chance: 100 }]);
        await L.send(page, 'one'); await L.waitChecks(page);
        await L.slash(page, '/continue'); await page.waitForTimeout(1500); await L.idle(page); await L.waitChecks(page);
        reqs = L.requests().filter(r => !/"done"/.test(L.text(r)));
        console.log('e:', reqs.map(r => L.marks(r).join('')));
        assert(reqs.length === 2 && L.marks(reqs[0])[0] === L.marks(reqs[1])[0] && L.marks(reqs[1]).length === 1, 'e: Continue carries the same instruction and version');

        // ---- f: while one is overdue, new ones are held back ----
        await L.openChat(page); L.resetLog();
        L.mode({ checker: JSON.stringify([{ id: 'a1', done: false, quote: '' }, { id: 'a2', done: true, quote: 'You look wonderful tonight' }]) });
        await L.makeSet(page, 'tHold' + Date.now(), [{ name: 'X', versions: ['X1'], wait: 50 }, { name: 'Y', versions: ['Y1', 'Y2'] }]);
        await L.send(page, 'one'); await L.waitChecks(page);
        const first = L.marks(L.chatRequests()[0]);
        L.mode({});
        await L.send(page, 'two'); await L.waitChecks(page);
        await L.send(page, 'three'); await L.waitChecks(page);
        reqs = L.chatRequests();
        console.log('f:', reqs.map(r => L.marks(r).join(',') + ':' + wording(r)));
        const missedMark = (await L.records(page)).filter(r => r.rec)[0].rec.items.find(x => x.status === 'overdue').text.match(/thing (\w\d)/)[1];
        assert(first.length === 2 && L.marks(reqs[1]).join() === missedMark && wording(reqs[1]) === 'overdue', 'f: the overdue instruction goes alone on the next reply');
        assert(L.marks(reqs[2]).length >= 1 && wording(reqs[2]) === 'first', 'f: new instructions resume after it is done');
    } catch (e) { console.log('TEST ERROR', e.stack); }
    L.mode({});
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
