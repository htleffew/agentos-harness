// B46 on a real host: importing a file that loses fields opens the import report sheet at 390 px with each loss named
// under Approximated and Left out; the report can be reopened from the imported group; a clean file opens no sheet;
// no model request is made. Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_LOG, RI_EVIDENCE.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
const H = require('./h.js');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8283';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B46');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOG = process.env.RI_MOCK_LOG || '';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const LOSSY = path.join(__dirname, 'fixtures/banks/import-lossy.json');
const CLEAN = path.join(__dirname, 'fixtures/banks/import-clean.json');
fs.mkdirSync(OUT, { recursive: true });
const requestCount = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => !['capture', 'chapter', 'condensed'].includes(row.kind)).length : 0);

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const results = { host: HOST };
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: true, colorScheme: 'dark' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(HOST, { waitUntil: 'networkidle' });
        await ready(page);
        await H.setupApi(page);
        const stamp = Date.now();
        const setId = await page.evaluate(async ({ BASE, stamp }) => {
            const host = SillyTavern.getContext();
            const idx = host.characters.findIndex(item => item.name);
            if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
            await new Promise(resolve => setTimeout(resolve, 800));
            await host.executeSlashCommandsWithOptions('/newchat');
            await new Promise(resolve => setTimeout(resolve, 1500));
            const K = await import(`${BASE}/src/books.js`), E = await import(`${BASE}/src/events.js`), S = await import(`${BASE}/src/store.js`);
            const ev = E.newEvent(`B46 report ${stamp}`); ev.chance = 100; ev.wait = 0;
            const data = { entries: {} }; E.writeEvent(data, ev);
            const id = await K.createSet(`B46 report ${stamp}`, 'events', data, '');
            S.chatState().activeSets = [id]; S.saveChatState();
            return id;
        }, { BASE, stamp });
        await page.evaluate(async ({ BASE, setId }) => {
            const P = await import(`${BASE}/src/ui/panel.js`), U = await import(`${BASE}/src/ui/events.js`);
            await P.app.setExpanded(true);
            await U.openEventSet(P.app, setId, U.EVENT_KINDS.events);
        }, { BASE, setId });
        await page.waitForTimeout(1200);
        const before = requestCount();
        const openImport = async () => {
            const b = page.locator('button', { hasText: /^Import options from a preset or plugin file$/ });
            if (await b.count()) { await b.scrollIntoViewIfNeeded(); await b.tap(); }
        };
        const importFile = async file => {
            await openImport();
            await page.locator('[data-ri-import-file]').setInputFiles(file);
            await page.waitForSelector('[data-ri-import] button:has-text("Import the ticked lists")');
            await page.locator('[data-ri-import] button', { hasText: /^Import the ticked lists$/ }).tap();
            await page.waitForSelector('[data-ri-import] .ri-note[role=status]');
        };

        // A clean file: the short confirmation only, no sheet.
        await importFile(CLEAN);
        await page.waitForTimeout(400);
        assert.equal(await page.locator('[data-ri-import-report]').count(), 0, 'a clean import opens no report');
        results.clean = await page.locator('[data-ri-import] .ri-note[role=status]').textContent();
        assert.ok(!/approximated/.test(results.clean));

        // A file that loses fields: the sheet opens, grouped, readable at 390 px.
        await importFile(LOSSY);
        await page.waitForSelector('[data-ri-import-report]');
        const sheet = await page.evaluate(() => {
            const s = document.querySelector('[data-ri-import-report]'); const r = s.getBoundingClientRect();
            return { groups: [...s.querySelectorAll('[data-ri-report-group]')].map(g => g.dataset.riReportGroup), rows: s.querySelectorAll('[data-ri-report-row]').length,
                text: s.textContent, wide: s.scrollWidth > s.clientWidth + 1, page: document.documentElement.scrollWidth > window.innerWidth + 1, top: r.top, bottom: r.bottom, vh: window.innerHeight,
                close: [...s.querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(); return { t: b.textContent, h: q.height }; }) };
        });
        results.sheet = sheet;
        assert.deepEqual(sheet.groups, ['approximated', 'left-out']);
        assert.ok(sheet.rows >= 4 && /Depth Note/.test(sheet.text) && /Odd Depth/.test(sheet.text) && /Position/.test(sheet.text) && /Counted Beat/.test(sheet.text), 'each loss is named');
        // B56: the block bank keeps a depth, the reply types and a gate around the whole block, so those are not listed.
        assert.ok(!/Late Beat/.test(sheet.text) && !/Only for/.test(sheet.text), 'fields RI keeps are not reported');
        assert.ok(!sheet.wide && !sheet.page, 'no sideways overflow');
        assert.ok(sheet.top > 0 && sheet.bottom <= sheet.vh + 1, 'the sheet sits inside the screen');
        assert.ok(sheet.close.every(b => b.h >= 32), 'buttons meet the hit size');
        await page.screenshot({ path: path.join(OUT, 'w390-report-sheet.png') });
        await page.locator('[data-ri-import-report] button', { hasText: /^Close$/ }).tap();
        assert.equal(await page.locator('[data-ri-import-report]').count(), 0);

        // Reopen from the imported group.
        await openImport();
        const again = page.locator('[data-ri-import] button', { hasText: /^Import report$/ });
        await again.first().scrollIntoViewIfNeeded();
        await again.first().tap();
        await page.waitForSelector('[data-ri-import-report]');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('[data-ri-import-report]').count(), 0);

        assert.equal(requestCount(), before, 'no model request');
        assert.deepEqual(errors, [], 'no page errors');
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        console.log('B46 import report passed');
    } catch (e) {
        console.error(e); process.exitCode = 1;
    } finally { await browser.close(); }
})();
