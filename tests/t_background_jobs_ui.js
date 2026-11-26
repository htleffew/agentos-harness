// B55 browser suite: Setup, Connections, Background jobs at 390 x 780 with touch.
//   1. Every job in JOBS is listed with its chain; a job that shares a chain says which job it follows.
//   2. Up and Down reorder a chain and Reset restores the recommended one; chainFor(job) changes and persists across a reload.
//   3. Test on a route makes exactly one probe request (recorded at the status endpoint) and shows the time and health.
//   4. No sideways scroll; a screenshot per state in RI_EVIDENCE.
// Run with the host variables of tests/README.md.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B55');
fs.mkdirSync(dir, { recursive: true });
const width = Number(process.env.RI_WIDTH || 390), height = Number(process.env.RI_HEIGHT || 780);
const B = L.BASE;
const mockUrl = `http://127.0.0.1:${Number(process.env.RI_MOCK_PORT || 8124)}/v1`;

const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}-${width}.png`), fullPage: false });
const chainOf = (page, job) => page.evaluate(async ({ B, job }) => { const R = await import(`${B}/src/routing.js`); return R.chainFor(job).map(e => e.route); }, { B, job });
const overflow = page => page.evaluate(() => { const p = document.querySelector('#ri_panel_page') || document.body; return { page: p.scrollWidth - p.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });

(async () => {
    L.sync();
    const probes = [];
    const { browser, page, errors } = await L.open({ width, height, hasTouch: true, isMobile: true, setupPage: async p => {
        await p.route('**/api/backends/chat-completions/status', route => {
            probes.push(JSON.parse(route.request().postData() || '{}'));
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'm' }] }) });
        });
    } });
    try {
        await L.setupApi(page);
        // Saved connections the routes find: a desktop on a local address, and a NanoGPT plan profile.
        await page.evaluate(async ({ B, mockUrl }) => {
            const c = SillyTavern.getContext();
            const cm = c.extensionSettings.connectionManager ||= { profiles: [] };
            cm.profiles = [
                { id: 'p-desktop', name: 'Desktop', api: 'custom', model: 'gemma4:12b', 'api-url': mockUrl, preset: '' },
                { id: 'p-nano', name: 'NanoGPT', api: 'nanogpt', model: 'deepseek/deepseek-v4.1-flash', preset: '' },
            ];
            const R = await import(`${B}/src/routing.js`);
            R.resetRouteHealth();
            for (const job of Object.keys(R.JOBS)) R.setJobChain(job, null);
        }, { B, mockUrl });
        await L.openPanel(page, 'background-jobs', {});
        await page.waitForSelector('#ri-job-list .ri-job', { timeout: 10000 });
        await page.waitForTimeout(600);

        // 1. Every job, with its chain; shared chains name the job they follow.
        const jobs = await page.evaluate(async B => { const R = await import(`${B}/src/routing.js`); return Object.entries(R.JOBS).map(([id, j]) => ({ id, label: j.label, chain: j.chain || '' })); }, B);
        for (const job of jobs) {
            const card = page.locator(`#ri-job-list [data-job="${job.id}"]`);
            assert.equal(await card.count(), 1, `${job.id} is listed`);
            assert.ok(await card.locator('.ri-job-route').count() > 0, `${job.id} shows its chain`);
            if (job.chain) assert.match(await card.locator('.ri-job-follows').innerText(), new RegExp(`Follows ${jobs.find(j => j.id === job.chain).label}`), `${job.id} says which job it follows`);
        }
        await page.locator('#ri-job-list [data-job="capture"]').scrollIntoViewIfNeeded();
        await shot(page, 'jobs');

        // 2. Reorder and Reset.
        const before = await chainOf(page, 'capture');
        const card = page.locator('#ri-job-list [data-job="capture"]');
        assert.equal(await card.locator('.ri-job-reset').count(), 0, 'no Reset while the chain is the recommended one');
        await card.locator('[data-index="1"] [data-move="up"]').tap();
        await page.waitForTimeout(300);
        const moved = await chainOf(page, 'capture');
        assert.deepEqual(moved.slice(0, 2), [before[1], before[0]], 'Up swaps the route with the one above');
        // A job that follows capture shows the new order.
        assert.deepEqual((await chainOf(page, 'choices')), moved, 'a job that follows Capture shows its new order');
        await card.locator('.ri-job-reset').scrollIntoViewIfNeeded();
        await shot(page, 'reordered');
        await page.waitForTimeout(2500);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.SillyTavern?.getContext && !document.getElementById('preloader'), null, { timeout: 90000 });
        await page.waitForTimeout(1500);
        assert.deepEqual(await chainOf(page, 'capture'), moved, 'the order persists across a reload');
        await L.openPanel(page, 'background-jobs', {});
        await page.waitForSelector('#ri-job-list .ri-job', { timeout: 10000 });
        await page.locator('#ri-job-list [data-job="capture"] .ri-job-reset').tap();
        await page.waitForTimeout(300);
        assert.deepEqual(await chainOf(page, 'capture'), before, 'Reset restores the recommended chain');
        assert.deepEqual(await chainOf(page, 'choices'), before, 'and the job that follows it');
        await page.waitForTimeout(2500);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => globalThis.SillyTavern?.getContext && !document.getElementById('preloader'), null, { timeout: 90000 });
        await page.waitForTimeout(1500);
        assert.deepEqual(await chainOf(page, 'capture'), before, 'the reset persists across a reload');
        await L.openPanel(page, 'background-jobs', {});
        await page.waitForSelector('#ri-job-list .ri-job', { timeout: 10000 });

        // 3. Test makes one probe request.
        const rows = page.locator('#ri-job-list [data-job="capture"] .ri-job-route');
        const desktopTest = rows.nth(0).locator('.ri-job-test');
        await desktopTest.scrollIntoViewIfNeeded();
        probes.length = 0;
        const mockBefore = L.requests('all').length;
        await desktopTest.tap();
        await page.waitForFunction(() => document.querySelector('#ri-job-list [data-job="capture"] [data-index="0"] .ri-job-result'), null, { timeout: 8000 });
        assert.equal(probes.length, 1, 'Test on the desktop route makes exactly one probe request');
        assert.match(await rows.nth(0).locator('.ri-job-result').innerText(), /Answered in \d+(\.\d)? (ms|s)\. Healthy/, 'it shows the answer time and health');
        probes.length = 0;
        await rows.nth(1).locator('.ri-job-test').tap();
        await page.waitForFunction(() => document.querySelector('#ri-job-list [data-job="capture"] [data-index="1"] .ri-job-result'), null, { timeout: 8000 });
        assert.equal(probes.length, 1, 'Test on a plan route makes exactly one probe request');
        assert.equal(probes[0].chat_completion_source, 'nanogpt', 'it asks that route\'s own provider');
        assert.equal(L.requests('all').length, mockBefore, 'Test sends no model request');
        // A route nothing carries makes no request and says so.
        probes.length = 0;
        await rows.nth(2).locator('.ri-job-test').tap();
        await page.waitForTimeout(500);
        assert.equal(probes.length, 0, 'a route with no connection makes no request');
        assert.match(await rows.nth(2).locator('.ri-job-result').innerText(), /Not set up/, 'and says it is not set up');
        // Unhealthy: the status endpoint fails.
        await page.unroute('**/api/backends/chat-completions/status');
        await page.route('**/api/backends/chat-completions/status', route => { probes.push(1); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ error: true }) }); });
        probes.length = 0;
        await rows.nth(1).locator('.ri-job-test').tap();
        await page.waitForFunction(() => /Unhealthy/.test(document.querySelector('#ri-job-list [data-job="capture"] [data-index="1"] .ri-job-result')?.textContent || ''), null, { timeout: 8000 });
        assert.equal(probes.length, 1, 'a failed test is still one request');
        await shot(page, 'tested');

        // 4. No sideways scroll.
        const o = await overflow(page);
        assert.ok(o.page <= 0 && o.doc <= 0, `no sideways scroll ${JSON.stringify(o)}`);
        const wide = await page.evaluate(() => [...document.querySelectorAll('#ri-background-jobs *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length);
        assert.equal(wide, 0, 'nothing in the section runs past the screen');
        const small = await page.evaluate(() => [...document.querySelectorAll('#ri-job-list button')].filter(b => { const r = b.getBoundingClientRect(); return r.height < 43 || r.width < 43; }).length);
        assert.equal(small, 0, 'every button is at least 44 px');
        assert.deepEqual(errors, [], 'no page errors');
        console.log('PASS t_background_jobs_ui');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
