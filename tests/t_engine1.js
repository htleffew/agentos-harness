const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        // ---- A: basic send, version cycling, record, check done ----
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, 'tA' + Date.now(), [{ name: 'Alpha', versions: ['A1', 'A2', 'A3'] }]);
        for (let i = 0; i < 4; i++) { await L.send(page, 'hi ' + i); await L.waitChecks(page); }
        let reqs = L.chatRequests();
        let seq = reqs.map(r => L.marks(r).join(','));
        console.log('A marks per prompt:', seq);
        assert(reqs.length === 4 && seq.every(s => /^A\d$/.test(s)), 'A: exactly one instruction in each of 4 prompts');
        assert(new Set(seq.slice(0, 3)).size === 3, 'A: three versions used once each before any repeat');
        assert(seq[3] !== seq[2], 'A: no immediate repeat after the cycle');
        const sample = L.text(reqs[0]).match(/\[System note: In this reply,[^\]]*\]/);
        console.log('A sample:', sample && sample[0]);
        assert(sample && !/\{\{/.test(sample[0]) && /theirs to write\.\]$/.test(sample[0]), 'A: wrapper present and macros filled in');
        let recs = await L.records(page);
        console.log('A records:', JSON.stringify(recs.filter(r => r.rec).map(r => r.rec.items.map(x => x.status + ':' + x.quote))));
        assert(recs.filter(r => r.rec).length === 4 && recs.filter(r => r.rec).every(r => r.rec.items[0].status === 'done' && r.rec.items[0].quote), 'A: every reply has a record marked Done with a quote');

        // ---- B: missed, overdue, final, stop ----
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await L.makeSet(page, 'tB' + Date.now(), [{ name: 'Beta', versions: ['B1', 'B2'], wait: 50 }]);
        for (let i = 0; i < 5; i++) { await L.send(page, 'yo ' + i); await L.waitChecks(page); }
        reqs = L.chatRequests();
        const kinds = reqs.map(r => { const t = L.text(r); return /Final\. This must happen early/.test(t) ? 'final' : /Overdue\. This was ordered/.test(t) ? 'overdue' : L.marks(r).length ? 'first' : 'none'; });
        console.log('B wording per prompt:', kinds, reqs.map(r => L.marks(r).join(',')));
        assert(JSON.stringify(kinds) === JSON.stringify(['first', 'overdue', 'final', 'none', 'none']), 'B: first, overdue, final, then stops');
        recs = await L.records(page);
        console.log('B statuses:', recs.filter(r => r.rec).map(r => r.rec.items.map(x => `${x.status}/${x.misses}/${x.kind}`).join()));
        assert(recs.filter(r => r.rec).map(r => r.rec.items[0].status).join() === 'overdue,overdue,missed', 'B: statuses overdue, overdue, missed');
        assert(new Set(reqs.slice(0, 3).map(r => L.marks(r)[0])).size === 1, 'B: the same version is re-sent');
        L.mode({});
    } catch (e) { console.log('TEST ERROR', e.stack); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
