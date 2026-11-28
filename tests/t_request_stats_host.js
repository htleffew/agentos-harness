// B62 browser suite: the request stats on Setup, Connections, Spend, on a real SillyTavern 1.19 host with the mock.
//   1. After one reply with its capture and one tapped call (Draft entries), today's row counts every extension request
//      the mock logged and leaves the reply out; tapping the day lists one row per job, and the jobs add up to the day.
//   2. The 7-day job table names the same jobs; the tables fit 360 px with no sideways scroll.
//   3. Clear stats asks first: Cancel keeps the rows, OK empties both tables.
// Run with the host variables of tests/README.md, at 360 x 780 with touch (RI_WIDTH changes the width). No real model.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const W = Number(process.env.RI_WIDTH || 360);
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B62');
fs.mkdirSync(dir, { recursive: true });
const out = { width: W, checks: {} };
// Every request the mock logged that is not SillyTavern's own reply request.
const extensionRows = () => L.requests('all').filter(row => row.kind !== 'reply');
const entries = page => page.evaluate(async B => (await import(`${B}/src/request-stats.js`)).requestEntries(), B);

const draft = page => page.evaluate(async B => {
    const res = await (await import(`${B}/src/memory/behavior-books.js`)).draftEntries('A storm closes the mountain pass for a night.', { kind: 'event' });
    return res.ok ? 'drafted' : res.reason;
}, B);

async function popup(page, which) {
    const button = page.locator(`dialog[open] .popup-button-${which}`);
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
    await page.waitForTimeout(400);
}

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: W, height: 780, hasTouch: true, isMobile: true });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        // Start from no stats and an empty mock log, so the counts below are this suite's own.
        await page.evaluate(async B => (await import(`${B}/src/request-stats.js`)).clearRequestStats(), B);
        await page.waitForTimeout(1500);
        L.resetLog();
        await page.evaluate(async B => (await import(`${B}/src/request-stats.js`)).clearRequestStats(), B);

        // 1. One reply with its capture, then one tapped call.
        await L.send(page, 'We ride for the pass before the snow.');
        await page.waitForFunction(async B => (await import(`${B}/src/request-stats.js`)).requestEntries().some(e => e.j === 'capture'), B, { timeout: 60000 });
        await page.waitForTimeout(2500);
        assert.equal(await draft(page), 'drafted', 'Draft entries answered');
        await page.waitForTimeout(1500);
        const list = await entries(page);
        const rows = extensionRows();
        out.checks.entries = list.map(e => ({ job: e.j, route: e.r, in: e.i, out: e.o, estimated: !!e.e }));
        out.checks.mockKinds = rows.map(r => r.kind);
        assert.ok(L.requests('all').some(r => r.kind === 'reply'), 'the reply went to the mock');
        assert.equal(list.length, rows.length, 'one entry per extension request the mock logged, the reply left out');
        const jobs = [...new Set(list.map(e => e.j))];
        assert.ok(jobs.includes('capture'), 'capture is counted');
        assert.ok(jobs.length >= 2, `the tapped call has its own job: ${jobs.join(', ')}`);

        // The Spend page shows today's row with that count.
        await L.openPanel(page, 'spend');
        const table = page.locator('#ri-stats-days');
        await table.waitFor({ state: 'visible', timeout: 10000 });
        const today = table.locator('tr.ri-stats-dayrow').first();
        assert.match(await today.locator('th').innerText(), /Today/);
        assert.equal(await today.locator('td[data-cell="requests"]').innerText(), String(list.length), 'today shows the right count');
        await page.screenshot({ path: path.join(dir, `stats-${W}.png`), fullPage: false });

        // Tapping the day lists its jobs; the jobs add up to the day.
        const toggle = today.locator('button.ri-stats-day');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.tap();
        await page.waitForTimeout(300);
        assert.equal(await page.locator('#ri-stats-days button.ri-stats-day').first().getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ri-stats-day')), true, 'focus stays on the day');
        const jobRows = await page.locator('#ri-stats-days tr.ri-stats-job').evaluateAll(trs => trs.map(tr => ({ job: tr.dataset.job, n: Number(tr.querySelector('td[data-cell="requests"]').textContent) })));
        out.checks.jobRows = jobRows;
        assert.deepEqual(jobRows.map(r => r.job).sort(), jobs.sort(), 'one row per job');
        for (const row of jobRows) assert.equal(row.n, list.filter(e => e.j === row.job).length, `${row.job}: its own count`);
        assert.equal(jobRows.reduce((sum, r) => sum + r.n, 0), list.length, 'the jobs add up to the day');
        await page.locator('#ri-stats-days').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(dir, `stats-day-open-${W}.png`), fullPage: false });

        // 2. The 7-day table and the fit at this width.
        const week = await page.locator('#ri-stats-week tbody tr').evaluateAll(trs => trs.map(tr => tr.dataset.job));
        assert.deepEqual([...week].sort(), jobs.sort());
        const fit = await page.evaluate(() => {
            const spend = document.querySelector('#ri-spend');
            const tables = [...spend.querySelectorAll('.ri-stats-table')].map(t => ({ right: t.getBoundingClientRect().right, width: t.scrollWidth, box: t.clientWidth }));
            return { viewport: innerWidth, page: document.scrollingElement.scrollWidth, spendScroll: spend.scrollWidth, spendBox: spend.clientWidth, tables };
        });
        out.checks.fit = fit;
        assert.ok(fit.page <= fit.viewport, 'no sideways scroll on the page');
        assert.ok(fit.spendScroll <= fit.spendBox + 1, 'no sideways scroll inside Spend');
        for (const t of fit.tables) assert.ok(t.right <= fit.viewport + 0.5 && t.width <= t.box + 1, 'each table fits');

        // 3. Clear stats asks first.
        const clear = page.locator('#ri-spend button', { hasText: 'Clear stats' });
        await clear.scrollIntoViewIfNeeded();
        await clear.tap();
        await popup(page, 'cancel');
        assert.equal((await entries(page)).length, list.length, 'Cancel keeps the stats');
        assert.equal(await page.locator('#ri-stats-days').count(), 1);
        await page.locator('#ri-spend button', { hasText: 'Clear stats' }).tap();
        await popup(page, 'ok');
        await page.waitForFunction(() => !document.querySelector('#ri-stats-days'), null, { timeout: 5000 });
        assert.equal((await entries(page)).length, 0);
        const text = await page.locator('#ri-spend').innerText();
        assert.match(text, /No requests in the last 31 days\./);
        assert.match(text, /No requests in the last 7 days\./);
        assert.match(text, /Request stats cleared\./);
        assert.equal(await page.locator('#ri-spend button', { hasText: 'Clear stats' }).count(), 0);
        await page.screenshot({ path: path.join(dir, `stats-cleared-${W}.png`), fullPage: false });
        out.checks.errors = errors.filter(e => !/net::ERR|status of 5\d\d|Failed to fetch/.test(e));
        assert.deepEqual(out.checks.errors, [], 'no page errors');
        console.log('PASS t_request_stats_host');
    } catch (error) {
        console.error('FAIL', error.stack || error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, `request-stats-host-${W}.json`), JSON.stringify(out, null, 2));
        await browser.close();
    }
})();
