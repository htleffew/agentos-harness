const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const wording = r => { const t = L.text(r); return /Final\. This must happen early/.test(t) ? 'final' : /Overdue\. This was ordered/.test(t) ? 'overdue' : L.marks(r).length ? 'first' : 'none'; };
const queue = (page) => page.evaluate(() => (globalThis.SillyTavern.getContext().chatMetadata.roleplay_instructions?.overdue || []).map(o => o.name + o.misses));
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        await L.setSettings(page, { enabled: true, showUnder: 'off', check: { mode: 'off', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' } });

        // ---- A: delete back to the start; timers from deleted replies are cleared ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tDelA' + Date.now(), [{ name: 'X', versions: ['X1', 'X2', 'X3'], keep: 1, wait: 3 }]);
        for (let i = 0; i < 4; i++) await L.send(page, 'm' + i);
        await L.slash(page, '/del 8'); await page.waitForTimeout(500);
        for (let i = 0; i < 3; i++) await L.send(page, 'n' + i);
        let seq = L.chatRequests().map(r => L.marks(r).join('') ? 'S' : '-').join('');
        console.log('A:', seq);
        assert(seq === 'SS--' + 'SS-', 'A: after deleting everything back to the greeting, the instruction is free to fire again and its timing starts over');

        // ---- E: swipe after deleting later messages repeats that reply's own instructions ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tDelE' + Date.now(), ['A', 'B', 'C', 'D', 'E', 'F'].map(k => ({ name: k, chance: 50, versions: [k + '1', k + '2'] })));
        for (let i = 0; i < 3; i++) await L.send(page, 'm' + i);
        await L.slash(page, '/del 2'); await page.waitForTimeout(500);
        await L.swipe(page); await L.swipe(page);
        let reqs = L.chatRequests(); let m = reqs.map(r => L.marks(r).sort().join(','));
        console.log('E:', m);
        assert(m[3] === m[1] && m[4] === m[1], 'E: after deleting the last exchange, swiping the reply before it repeats that reply\'s own instructions');

        await L.setSettings(page, { check: { mode: 'full' } });
        // ---- B: a waiting re-send is dropped when its reply is deleted ----
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await L.makeSet(page, 'tDelB' + Date.now(), [{ name: 'X', versions: ['X1', 'X2'], wait: 50 }]);
        await L.send(page, 'one'); await L.waitChecks(page);
        const q1 = await queue(page);
        await L.slash(page, '/del 2'); await page.waitForTimeout(500);
        const q2 = await queue(page);
        await L.send(page, 'one again'); await L.waitChecks(page);
        reqs = L.chatRequests();
        console.log('B:', q1, q2, reqs.map(wording));
        assert(q1.length === 1 && q2.length === 0 && wording(reqs[1]) === 'first', 'B: deleting the reply that missed drops its re-send; the chat starts fresh from there');

        // ---- B2: deleting the re-send reply puts the earlier state back ----
        await L.send(page, 'two'); await L.waitChecks(page);   // overdue wording, missed again -> final queued
        const q3 = await queue(page);
        await L.slash(page, '/del 2'); await page.waitForTimeout(500);
        const q4 = await queue(page);
        await L.send(page, 'two again'); await L.waitChecks(page);
        reqs = L.chatRequests();
        console.log('B2:', q3, q4, reqs.map(wording));
        assert(q3[0] === 'X2' && q4[0] === 'X1' && wording(reqs[3]) === 'overdue', 'B2: deleting the reply that carried the reminder goes back one step: the first reminder is waiting again');

        // ---- C: branch ----
        const ids = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return c.chat.map((m, i) => (!m.is_user && m.extra?.roleplay_instructions) ? i : -1).filter(i => i >= 0); });
        await L.slash(page, `/branch-create ${ids[0]}`); await page.waitForTimeout(2500);
        const info = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { len: c.chat.length, queue: (c.chatMetadata.roleplay_instructions?.overdue || []).map(o => o.name + o.misses), active: c.chatMetadata.roleplay_instructions?.activeSets?.length, recs: c.chat.filter(m => m.extra?.roleplay_instructions).length }; });
        L.resetLog();
        await L.send(page, 'in the branch'); await L.waitChecks(page);
        console.log('C:', JSON.stringify(info), L.chatRequests().map(wording));
        assert(info.active === 1 && info.recs === 1 && info.queue.join() === 'X1' && wording(L.chatRequests()[0]) === 'overdue', 'C: a branch keeps the set turned on and the records up to the branch point, and continues from the state at that reply');

        // ---- D: editing the newest reply checks it again ----
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await L.makeSet(page, 'tEdit' + Date.now(), [{ name: 'X', versions: ['X1', 'X2'], wait: 50 }]);
        await L.send(page, 'one'); await L.waitChecks(page);
        const qa = await queue(page);
        L.mode({});
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); const id = c.chat.length - 1; c.chat[id].mes += ' She does the thing.'; await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, id); });
        await page.waitForTimeout(800); await L.waitChecks(page);
        const qb = await queue(page);
        const st = (await L.records(page)).filter(r => r.rec)[0].rec.items[0].status;
        await L.send(page, 'two'); await L.waitChecks(page);
        console.log('D:', qa, qb, st, L.chatRequests().map(wording));
        assert(qa.length === 1 && qb.length === 0 && st === 'done' && wording(L.chatRequests()[1]) === 'none', 'D: after you edit the newest reply it is checked again; once it shows Done nothing is re-sent');
    } catch (e) { console.log('TEST ERROR', e.stack); }
    L.mode({});
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
