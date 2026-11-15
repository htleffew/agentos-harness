const L = require('./lib.js');
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open();
    await L.setupApi(page); await L.setSettings(page, { check: { mode: 'off' } });
    for (const [keep, wait] of [[2, 2], [1, 1], [0, 2], [0, 1], [3, 0], [1, 3]]) {
        await L.openChat(page); L.resetLog();
        await L.makeSet(page, `tF${keep}${wait}` + Date.now(), [{ name: 'F', versions: ['F1', 'F2', 'F3', 'F4'], keep, wait }]);
        for (let i = 0; i < 10; i++) await L.send(page, 'k' + i);
        const seq = L.chatRequests().map(r => L.marks(r).join('') || '--');
        // expected pattern: (keep+1) sends, wait gaps, repeat
        const exp = []; let i = 0; while (exp.length < 10) { for (let k = 0; k <= keep && exp.length < 10; k++) exp.push('S'); for (let w = 0; w < wait && exp.length < 10; w++) exp.push('-'); }
        const got = seq.map(s => s === '--' ? '-' : 'S').join('');
        console.log(`${got === exp.join('') ? 'PASS' : 'FAIL'} keep ${keep} wait ${wait}: ${seq.join(' ')}`);
    }
    console.log('ERRORS', errors.slice(0, 5));
    await browser.close();
})();
