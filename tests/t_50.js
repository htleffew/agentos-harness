const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' }, showUnder: 'off' });
        await L.openChat(page); L.resetLog();
        const ins = ['A', 'B', 'C', 'D', 'E', 'F'].map((k, i) => ({ name: k, chance: 30, wait: i % 3, keep: i === 0 ? 1 : 0, versions: [1, 2, 3, 4].map(n => k + n) }));
        await L.makeSet(page, 't50' + Date.now(), ins, { limit: 'max', max: 2 });
        const t = Date.now();
        for (let i = 0; i < 50; i++) { await L.send(page, 'm' + i); await L.waitChecks(page); }
        console.log('50 replies in', Math.round((Date.now() - t) / 1000), 's');
        const reqs = L.chatRequests();
        const recs = (await L.records(page)).slice(1); // skip the greeting
        let ok = reqs.length === 50 && recs.length === 50, withAny = 0, total = 0, newCount = 0;
        const perReply = [];
        reqs.forEach((r, i) => {
            const inPrompt = L.marks(r).sort().join(',');
            const inRecord = (recs[i].rec?.items || []).map(x => (x.text.match(/thing ([A-Z]\d)/) || [])[1]).sort().join(',');
            const fresh = (recs[i].rec?.items || []).filter(x => x.kind === 'new').length;
            if (inPrompt !== inRecord) { ok = false; console.log('MISMATCH at', i, inPrompt, '|', inRecord); }
            if (fresh > 2) { ok = false; console.log('LIMIT BROKEN at', i, inRecord); }
            if (inPrompt) withAny++;
            total += inPrompt ? inPrompt.split(',').length : 0; newCount += fresh;
            perReply.push(inPrompt || '-');
        });
        console.log(perReply.join(' | '));
        console.log(`replies with an instruction: ${withAny}/50, instructions sent: ${total}, new: ${newCount}`);
        assert(ok, '50 replies: the prompt and the What Was Sent record match on every reply, and at most 2 new instructions per reply');
        const statuses = recs.flatMap(r => (r.rec?.items || []).map(x => x.status));
        assert(statuses.length === total && statuses.every(s => s === 'done'), '50 replies: every sent instruction has a status');
    } catch (e) { console.log('TEST ERROR', e.stack); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
