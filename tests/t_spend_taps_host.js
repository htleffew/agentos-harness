// B59 browser suite: every paid call counts toward the monthly ceiling, tapped or not, on a real SillyTavern 1.19 host.
//   1. With the ceiling reached, Close the chapter here (tapped in the message menu), Write a chapter now,
//      Write the synopsis and start and Draft entries are refused with the ceiling line and the mock records no paid
//      request. The last three run the function their button calls (writeChapterNow, hostCarryOver().start, draftEntries).
//   2. At the ceiling, a chain with a free route after the paid one still answers, and the meter does not move.
//   3. Below the ceiling, each tapped paid call adds a call and its cost to the meter.
// The paid route is a Connection Profile at the mock's IPv4-mapped IPv6 address: SillyTavern reaches the mock, and the
// extension bills it as a paid provider because the address is not a local one. No real model is called.
// Run with the host variables of tests/README.md, at 523 x 1021 with touch. Evidence goes to RI_EVIDENCE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const port = Number(process.env.RI_MOCK_PORT || 8124);
const PAID_URL = `http://[::ffff:127.0.0.1]:${port}/v1`;
const PAID_MODEL = 'b59-paid-model';
const PRICE = { in: 2, out: 2 };
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B59');
fs.mkdirSync(dir, { recursive: true });
const out = { checks: {} };
const paidRows = () => L.requests('all').filter(row => row.model === PAID_MODEL || /b59-paid-model/.test(String(row.body || ''))).length;
const allRows = () => L.requests('all').length;

const spendState = page => page.evaluate(async B => (await import(`${B}/src/spend.js`)).spendState(), B);
const ceilingLine = page => page.evaluate(async B => (await import(`${B}/src/spend.js`)).CEILING_LINE, B);
async function setLimits(page, ceiling) {
    await page.evaluate(async ({ B, ceiling }) => { (await import(`${B}/src/spend.js`)).setSpendLimits({ ceiling, warning: ceiling }); (await import(`${B}/src/routing.js`)).resetRouteHealth(); }, { B, ceiling });
}
/** chains: { job: [entries] }; functions: { operation: change } for Setup, Connections. */
async function routes(page, { chains = {}, functions = {} }) {
    await page.evaluate(async ({ B, chains, functions }) => {
        const R = await import(`${B}/src/routing.js`);
        const E = await import(`${B}/src/execution.js`);
        for (const [job, chain] of Object.entries(chains)) R.setJobChain(job, chain);
        for (const [operation, change] of Object.entries(functions)) E.setExecutionSetting(operation, change);
        R.resetRouteHealth();
    }, { B, chains, functions });
}
const paidStep = { route: 'override', profileId: 'p-paid', price: PRICE };

async function lastToast(page, before) {
    await page.waitForFunction(n => document.querySelectorAll('#toast-container .toast-message').length > n || [...document.querySelectorAll('#toast-container .toast-message')].some(t => !/Writing the chapter/.test(t.textContent)), before, { timeout: 30000 });
    await page.waitForTimeout(400);
    return [...await page.locator('#toast-container .toast-message').allInnerTexts()].filter(t => !/Writing the chapter/.test(t)).at(-1) || '';
}
async function clearToasts(page) { await page.evaluate(() => { globalThis.toastr?.clear?.(); document.querySelectorAll('#toast-container').forEach(n => n.remove()); }); await page.waitForTimeout(300); }

/** Close the chapter here, tapped in SillyTavern's message menu. Returns the toast it shows. */
async function closeChapterTap(page) {
    await clearToasts(page);
    await L.openMenuEntry(page, 'close-chapter');
    return lastToast(page, 0);
}
/** Write a chapter now: the function its button on Story, Story World calls; the button shows the error's message. */
const writeChapterTap = page => page.evaluate(async B => {
    try { const name = await (await import(`${B}/src/chapters.js`)).writeChapterNow(); return `Saved "${name}"`; } catch (error) { return error.message; }
}, B);
const synopsis = page => page.evaluate(async B => {
    try { await (await import(`${B}/src/memory/carry-over.js`)).hostCarryOver().then(r => r.start({})); return 'started'; } catch (error) { return error.message; }
}, B);
const draft = page => page.evaluate(async B => {
    const res = await (await import(`${B}/src/memory/behavior-books.js`)).draftEntries('A storm closes the mountain pass for a night.', { kind: 'event' });
    return res.ok ? 'drafted' : res.reason;
}, B);

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: 523, height: 1021, hasTouch: true, isMobile: true });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await page.evaluate(({ url, model }) => {
            const c = SillyTavern.getContext();
            const cm = c.extensionSettings.connectionManager ||= { profiles: [] };
            cm.profiles = [{ id: 'p-paid', name: 'Paid test profile', api: 'custom', model, 'api-url': url, preset: 'Default' }];
        }, { url: PAID_URL, model: PAID_MODEL });
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        for (let n = 1; n <= 3; n++) await L.send(page, `We ride for the pass, turn ${n}.`);
        await page.waitForTimeout(2500);
        const CEILING = await ceilingLine(page);
        assert.match(CEILING, /monthly spend ceiling is reached/);
        assert.match(CEILING, /Setup, Connections, Spend/);

        // 1. At the ceiling, every one of the four buttons is refused and no paid request leaves.
        await setLimits(page, 0);
        await routes(page, { chains: { carryOver: [paidStep] }, functions: { chapterSummary: { mode: 'fixed', profileId: 'p-paid', fallback: false } } });
        const before = { paid: paidRows(), rows: allRows(), meter: (await spendState(page)).calls.length };
        const refused = {
            close: await closeChapterTap(page),
            write: await writeChapterTap(page),
            synopsis: await synopsis(page),
            draft: await draft(page),
        };
        out.checks.refused = refused;
        await page.screenshot({ path: path.join(dir, 'refused-523.png') });
        for (const [button, text] of Object.entries(refused)) assert.equal(text, CEILING, `${button}: refused with the ceiling line`);
        assert.equal(paidRows(), before.paid, 'no paid request reached the mock');
        assert.equal(allRows(), before.rows, 'no request of any kind left for the four refused taps');
        assert.equal((await spendState(page)).calls.length, before.meter, 'nothing was added to the meter');

        // 2. At the ceiling, a free route after the paid one still answers (the Main API here is the local mock).
        await routes(page, { chains: { carryOver: [paidStep, { route: 'main' }] }, functions: { chapterSummary: { mode: 'fixed', profileId: 'p-paid', fallback: true } } });
        const freeBefore = { paid: paidRows(), rows: allRows(), meter: (await spendState(page)).calls.length };
        const answered = { draft: await draft(page), close: await closeChapterTap(page) };
        out.checks.freeLeft = answered;
        assert.equal(answered.draft, 'drafted', 'Draft entries answered on the free route');
        assert.match(answered.close, /^Saved "|^The chapter was written\./, 'Close the chapter here answered on the free route');
        assert.ok(allRows() > freeBefore.rows, 'the free route was asked');
        assert.equal(paidRows(), freeBefore.paid, 'still no paid request');
        assert.equal((await spendState(page)).calls.length, freeBefore.meter, 'the meter did not move');

        // 3. Below the ceiling, each tapped paid call adds a call and its cost.
        await setLimits(page, 5);
        await routes(page, { chains: { carryOver: [paidStep], chapter: [paidStep] }, functions: { chapterSummary: { mode: 'auto' } } });
        for (let n = 4; n <= 5; n++) await L.send(page, `The snow keeps falling, turn ${n}.`);
        await page.waitForTimeout(2000);
        const metered = out.checks.metered = {};
        const tap = async (name, run) => {
            const s0 = await spendState(page), p0 = paidRows();
            const result = await run();
            const s1 = await spendState(page);
            metered[name] = { result, paidRequests: paidRows() - p0, calls: s1.calls.length - s0.calls.length, added: Number((s1.total - s0.total).toFixed(6)),
                jobs: s1.calls.slice(s0.calls.length).map(c => c.job) };
            assert.ok(metered[name].paidRequests >= 1, `${name}: sent on the paid route`);
            assert.equal(metered[name].calls, metered[name].paidRequests, `${name}: each paid request is one call on the meter`);
            assert.ok(metered[name].added > 0, `${name}: its cost is added`);
        };
        await tap('draft', () => draft(page));
        await tap('close', () => closeChapterTap(page));
        for (let n = 6; n <= 7; n++) await L.send(page, `The fire burns low, turn ${n}.`);
        await page.waitForTimeout(2000);
        await tap('write', () => writeChapterTap(page));
        await tap('synopsis', () => synopsis(page));
        out.checks.metered = metered;
        await L.openPanel(page, 'spend');
        await page.screenshot({ path: path.join(dir, 'spend-523.png') });
        const help = await page.locator('#ri-spend').innerText();
        assert.match(help, /Every paid model call the extension makes counts toward the ceiling, tapped or in the background/);
        assert.doesNotMatch(help, /Taps and chat replies through your main connection stay outside/);
        out.checks.errors = errors.filter(e => !/net::ERR|status of 5\d\d|Failed to fetch/.test(e));
        assert.deepEqual(out.checks.errors, [], 'no page errors');
        console.log('PASS t_spend_taps_host');
    } catch (error) {
        console.error('FAIL', error.stack || error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, 'spend-taps-host.json'), JSON.stringify(out, null, 2));
        await browser.close();
    }
})();
