// B25: three follow-ups from the first integration pass, on a real SillyTavern 1.19.0 host with touch input at
// 523 x 1021 (mobile layout) and 1006 x 909 (desktop layout).
//   1. The fold handle and Pathweaver's handle each get their own tap, folded or not and with Pathweaver's bar
//      open or minimized; with nothing under the handle it stays centered where B1 puts it.
//   2. A chat change leaves the menu on the page it shows, a cross-linked page included, and the reopen rule of
//      B5 (last page reached through the tabs) still applies when the menu is closed and opened.
//   3. Restoring a built-in quick action from the Library saves at once: a reload straight after keeps it.
//
// Pathweaver (SillyTavern-Pathweaver) must be enabled on the host. Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8255';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B25');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
}

async function openChat(page) {
    await page.evaluate(async () => {
        const host = SillyTavern.getContext();
        await host.selectCharacterById(host.characters.findIndex(item => item.name));
        await new Promise(resolve => setTimeout(resolve, 800));
        await host.executeSlashCommandsWithOptions('/newchat');
    });
    await page.waitForSelector('#ri_composer_bar .ri-bar-fold', { timeout: 30000 });
    await page.waitForTimeout(1200);
}

const setFold = (page, folded) => page.evaluate(async ({ BASE, folded }) => {
    (await import(`${BASE}/src/quick-actions.js`)).setBarFolded(folded);
    (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
}, { BASE, folded });

const setPathweaver = async (page, minimized) => {
    // Pathweaver redraws its bar from its own setting, so the test taps its handle instead of editing the class.
    if (await page.evaluate(() => document.querySelector('.pw_action_bar').classList.contains('minimized')) !== minimized) {
        const where = await points(page);
        await page.touchscreen.tap(where.theirs.x, where.theirs.y);
    }
    await page.waitForTimeout(600);
};

/** Where a finger lands on each handle: the lower part of the fold face, the middle of Pathweaver's button. */
const points = page => page.evaluate(() => {
    const mine = document.querySelector('#ri_composer_bar .ri-bar-fold').getBoundingClientRect();
    const theirs = document.querySelector('.pw_minimize_btn').getBoundingClientRect();
    return { mine: { x: mine.x + mine.width / 2, y: mine.y + mine.height - 6 }, theirs: { x: theirs.x + theirs.width / 2, y: theirs.y + theirs.height / 2 },
        mineBox: { x: mine.x, y: mine.y, w: mine.width, h: mine.height }, theirsBox: { x: theirs.x, y: theirs.y, w: theirs.width, h: theirs.height } };
});

const state = page => page.evaluate(() => ({ folded: document.querySelector('#ri_composer_bar').dataset.folded,
    pwMinimized: document.querySelector('.pw_action_bar').classList.contains('minimized'),
    shift: document.querySelector('#ri_composer_bar .ri-bar-fold').style.getPropertyValue('--ri-fold-shift') }));

const owner = (page, point) => page.evaluate(({ x, y }) => {
    const top = document.elementFromPoint(x, y);
    return top?.closest('.ri-bar-fold') ? 'ours' : top?.closest('.pw_minimize_btn') ? 'theirs' : (top?.className || top?.tagName || 'nothing').toString();
}, point);

async function handles(page, out, shot) {
    out.handles = [];
    for (const pwMinimized of [false, true]) {
        for (const folded of [false, true]) {
            await setPathweaver(page, pwMinimized);
            await setFold(page, folded);
            await page.waitForTimeout(500);
            const label = `pw-${pwMinimized ? 'min' : 'open'}-bar-${folded ? 'folded' : 'open'}`;
            const where = await points(page);
            const row = { label, before: await state(page), ours: await owner(page, where.mine), theirs: await owner(page, where.theirs) };
            await shot(label);
            assert.equal(row.ours, 'ours', `${label}: a finger on our handle lands on our handle`);
            assert.equal(row.theirs, 'theirs', `${label}: a finger on Pathweaver's handle lands on Pathweaver's`);
            // Our handle: the bar folds or opens, Pathweaver stays as it was.
            await page.touchscreen.tap(where.mine.x, where.mine.y);
            await page.waitForTimeout(400);
            row.afterOurs = await state(page);
            assert.equal(row.afterOurs.folded, String(!folded), `${label}: our tap toggles the bar`);
            assert.equal(row.afterOurs.pwMinimized, pwMinimized, `${label}: our tap leaves Pathweaver alone`);
            // Pathweaver's handle: its bar minimizes or opens, ours stays as it was.
            const again = await points(page);
            row.theirsOwnerAfterOurs = await owner(page, again.theirs);
            await page.touchscreen.tap(again.theirs.x, again.theirs.y);
            await page.waitForTimeout(500);
            row.afterTheirs = await state(page);
            assert.equal(row.afterTheirs.pwMinimized, !pwMinimized, `${label}: Pathweaver's tap toggles its bar (${JSON.stringify([where, again, row])})`);
            assert.equal(row.afterTheirs.folded, row.afterOurs.folded, `${label}: Pathweaver's tap leaves our bar alone`);
            out.handles.push(row);
        }
    }
    // Nothing under the handle: it stays centered, where B1 puts it.
    await page.evaluate(() => document.querySelector('.pw_action_bar')?.remove());
    await setFold(page, false);
    await page.waitForTimeout(300);
    await page.evaluate(() => dispatchEvent(new Event('resize')));
    await page.waitForTimeout(300);
    out.alone = await page.evaluate(() => {
        const fold = document.querySelector('#ri_composer_bar .ri-bar-fold').getBoundingClientRect(), bar = document.querySelector('#ri_composer_bar').getBoundingClientRect();
        return { offCenter: Math.abs(fold.x + fold.width / 2 - (bar.x + bar.width / 2)), shift: document.querySelector('#ri_composer_bar .ri-bar-fold').style.getPropertyValue('--ri-fold-shift') };
    });
    assert.ok(out.alone.offCenter < 1, 'alone, the handle stays centered');
    await shot('alone');
}

async function menuStaysOnChatChange(page, out) {
    const shell = () => page.evaluate(() => document.querySelector('#ri_panel_page')?.dataset.page);
    await page.evaluate(async BASE => {
        const { app } = await import(`${BASE}/src/ui/panel.js`);
        await app.setExpanded(true);
        await app.openPage('log', { via: 'tab' }); // the page reached through the tabs
    }, BASE);
    await page.waitForTimeout(400);
    const tabPage = await shell();
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.openPage('writing'); }, BASE);
    await page.waitForTimeout(400);
    const linked = await shell();
    assert.notEqual(linked, tabPage, 'the cross-link moved the menu');
    await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'); });
    await page.waitForTimeout(1800);
    const afterChat = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page')?.dataset.page, chat: SillyTavern.getContext().getCurrentChatId() }));
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); await app.setExpanded(true); }, BASE);
    await page.waitForTimeout(400);
    const reopened = await shell();
    out.chatChange = { tabPage, linked, afterChat, reopened };
    assert.equal(afterChat.page, linked, 'a chat change leaves the cross-linked page on screen');
    assert.equal(reopened, tabPage, 'closing and opening the menu returns to the tab page');
}

async function restoreSaves(page, out) {
    const id = 'builtin:swipe:plain';
    const title = await page.evaluate(async ({ BASE, id }) => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        const shipped = Q.readQuickAction(id).title;
        Q.saveQuickAction({ id, title: `${shipped} edited` });
        return shipped;
    }, { BASE, id });
    await page.waitForTimeout(2500); // the edit itself reaches the server through SillyTavern's delayed save
    await page.evaluate(async ({ BASE }) => {
        const { app } = await import(`${BASE}/src/ui/panel.js`);
        await app.setExpanded(true);
        await app.openPage('quick-library');
    }, { BASE });
    await page.waitForSelector(`#ri-qa-library [data-action-id="${id}"] [data-ri-edit]`, { timeout: 15000 });
    await page.locator(`#ri-qa-library [data-action-id="${id}"] [data-ri-edit]`).tap();
    await page.waitForSelector('[data-ri-restore]', { timeout: 15000 });
    const edited = await page.evaluate(async ({ BASE, id }) => (await import(`${BASE}/src/quick-actions.js`)).readQuickAction(id).title, { BASE, id });
    assert.equal(edited, `${title} edited`);
    await page.locator('[data-ri-restore]').tap();
    const started = Date.now();
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    const after = await page.evaluate(async ({ BASE, id }) => (await import(`${BASE}/src/quick-actions.js`)).readQuickAction(id).title, { BASE, id });
    out.restore = { shipped: title, edited, afterReload: after, msBeforeReload: Date.now() - started };
    assert.equal(after, title, 'the restore survived a reload straight after it');
}

async function run(browser, tag, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const out = { tag, viewport, shots: [] };
    results.runs.push(out);
    const shot = async name => { const file = `${tag}-${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); out.shots.push(file); };
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await ready(page);
    await openChat(page);
    assert.ok(await page.locator('.pw_action_bar').count(), 'Pathweaver is enabled on this host');
    await handles(page, out, shot);
    await menuStaysOnChatChange(page, out);
    await restoreSaves(page, out);
    out.errors = errors;
    assert.deepEqual(errors, []);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, 'w523', { width: 523, height: 1021 });
        await run(browser, 'w1006', { width: 1006, height: 909 });
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
        await browser.close();
    }
    console.log('shell follow-ups: passed');
})().catch(error => { console.error(error); process.exit(1); });
