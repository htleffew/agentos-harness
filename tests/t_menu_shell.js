// B5 touch pass: the menu shell on a real SillyTavern 1.19.0 host with the mock model. Runs at 523 x 1021
// (cover screen, SillyTavern's mobile layout) and 1006 x 909 (inner screen, desktop layout) with touch input.
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed (default http://127.0.0.1:8175)
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8175';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B5');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

async function boot(browser, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(async () => {
        for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click();
        const host = SillyTavern.getContext();
        if (host.characterId === undefined) await host.selectCharacterById(host.characters.findIndex(item => item.name));
    });
    await page.waitForSelector('#ri_root', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);
    return { page, errors };
}

const shell = page => page.evaluate(() => {
    const box = node => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const head = document.querySelector('.ri-shell-head');
    return {
        head: box(head), rows: [...head.children].map(row => box(row).h),
        top: document.querySelector('[data-ri-tab][aria-current="page"]')?.dataset.riTab,
        nested: document.querySelector('[data-ri-nested][aria-current="page"]')?.dataset.riNested,
        title: document.querySelector('[data-ri-heading]')?.textContent,
        pill: document.querySelector('.ri-shell-pill')?.textContent,
        help: document.querySelector('.ri-shell-help')?.textContent,
        back: document.querySelector('[data-ri-back]')?.getAttribute('aria-label') || null,
        page: document.querySelector('#ri_panel_page')?.dataset.page,
        content: box(document.querySelector('.ri-shell-page')),
    };
});

async function tap(page, selector) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.tap(selector);
    await page.waitForTimeout(250);
}

async function run(browser, viewport, tag) {
    const { page, errors } = await boot(browser, viewport);
    const out = { viewport, tag };
    const shot = name => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) });
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ targets: 'compact', text: 'compact', icons: 'compact' });
        const { app } = await import(`${BASE}/src/ui/panel.js`);
        await app.setExpanded(true);
    }, BASE);
    await page.waitForTimeout(400);

    // Five top tabs, the nested row, and the header measured in Compact and Comfortable.
    await tap(page, '[data-ri-tab="story"]');
    out.compact = await shell(page);
    assert.equal(out.compact.head.h, 120);
    assert.deepEqual(out.compact.rows, [40, 48, 32]);
    assert.equal(await page.locator('[data-ri-tab]').count(), 5);
    await shot('header-compact');
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ targets: 'comfortable' }), BASE);
    await page.waitForTimeout(250);
    out.comfortable = await shell(page);
    assert.equal(out.comfortable.head.h, 148);
    await shot('header-comfortable');
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ targets: 'compact' }), BASE);
    await page.waitForTimeout(250);

    // Two taps to any page: from a page in another top tab, tap the top tab then the nested tab.
    const tree = await page.evaluate(() => [...document.querySelectorAll('[data-ri-tab]')].map(node => node.dataset.riTab));
    out.twoTaps = [];
    for (const top of tree) {
        const start = top === 'story' ? 'review' : 'story';
        await tap(page, `[data-ri-tab="${start}"]`);
        await tap(page, `[data-ri-tab="${top}"]`);
        const nested = await page.evaluate(() => [...document.querySelectorAll('[data-ri-nested]')].map(node => ({ id: node.dataset.riNested, label: node.textContent })));
        for (const item of nested) {
            await tap(page, `[data-ri-tab="${start}"]`);
            await tap(page, `[data-ri-tab="${top}"]`);
            await tap(page, `[data-ri-nested="${item.id}"]`);
            const now = await shell(page);
            assert.equal(now.nested, item.id);
            assert.equal(now.title, item.label);
            // The active nested tab is wholly inside the visible row.
            const inView = await page.evaluate(() => {
                const row = document.querySelector('.ri-shell-nested').getBoundingClientRect();
                const tab = document.querySelector('[data-ri-nested][aria-current="page"]').getBoundingClientRect();
                return tab.left >= row.left - 1 && tab.right <= row.right + 1;
            });
            assert(inView, `${item.id} active tab out of view`);
            out.twoTaps.push({ from: start, top, nested: item.id, taps: 2, title: now.title, pill: now.pill, inView });
        }
    }
    await tap(page, '[data-ri-tab="story"]');
    await tap(page, '[data-ri-nested="world-info"]');
    out.nestedScroll = await page.evaluate(() => { const row = document.querySelector('.ri-shell-nested'); return { scrollLeft: row.scrollLeft, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth }; });
    await shot('nested-scrolled');
    await tap(page, '[data-ri-tab="setup"]');
    await tap(page, '[data-ri-nested="prompts"]');
    await shot('setup-prompts');
    // With Comfortable text at 130% the nested row overflows; it scrolls and keeps the active tab in view.
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ text: 'comfortable', textScale: 130, targets: 'comfortable' }), BASE);
    out.overflow = [];
    for (const [top, nested] of [['setup', 'prompts'], ['story', 'world-info'], ['story', 'scene']]) {
        await tap(page, `[data-ri-tab="${top}"]`);
        await tap(page, `[data-ri-nested="${nested}"]`);
        await page.waitForTimeout(200);
        const state = await page.evaluate(() => {
            const row = document.querySelector('.ri-shell-nested');
            const box = row.getBoundingClientRect();
            const tab = document.querySelector('[data-ri-nested][aria-current="page"]').getBoundingClientRect();
            return { scrollLeft: Math.round(row.scrollLeft), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth,
                inView: tab.left >= box.left - 1 && tab.right <= box.right + 1 };
        });
        assert(state.inView, `${nested} out of view at large text`);
        out.overflow.push({ nested, ...state });
        if (nested === 'world-info') await shot('nested-overflow-scrolled');
    }
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ text: 'compact', textScale: 100, targets: 'compact' }), BASE);
    await page.waitForTimeout(200);

    // Page anatomy: icon, title, pill, help and the Prompts foot row.
    await tap(page, '[data-ri-tab="direction"]');
    out.anatomy = await page.evaluate(() => ({
        icon: !!document.querySelector('.ri-shell-pageicon'), pill: document.querySelector('.ri-shell-pill')?.textContent,
        help: document.querySelector('.ri-shell-help')?.textContent, foot: document.querySelector('.ri-shell-foot-link')?.textContent || null,
    }));
    assert(out.anatomy.icon && out.anatomy.pill && out.anatomy.help);
    assert.match(out.anatomy.foot, /^Prompts for this page \(\d+ customized\)$/);
    await shot('page-anatomy');
    await tap(page, '.ri-shell-foot-link');
    out.footOpens = await shell(page);
    assert.equal(out.footOpens.nested, 'prompts');
    out.footList = await page.locator('.ri-prompts-home [data-ri-prompt]').count();
    assert(out.footList > 0);
    await shot('prompts-filtered');

    // Registered pages land in their nested tab: B1's Look, B3's Bar and Library and B12's Presets replace the
    // stand-ins; a fixture with no matching tab gets a nested tab of its own.
    await page.evaluate(async BASE => {
        const { registerPage } = await import(`${BASE}/src/ui/page-registry.js`);
        const page = (id, group, label) => registerPage({ id, group, label, help: `${label} fixture.`, withoutChat: true,
            render: body => body.append(Object.assign(document.createElement('p'), { id: `${id}-body`, textContent: `${label} fixture rendered` })) });
        page('b5-spend', 'setup', 'Spend');
    }, BASE);
    await tap(page, '[data-ri-tab="quick"]');
    out.registered = { bar: await shell(page) };
    assert.equal(out.registered.bar.page, 'quick-bar');
    await tap(page, '[data-ri-nested="library"]');
    out.registered.library = (await shell(page)).page;
    assert.equal(out.registered.library, 'quick-library');
    await shot('registered-bar');
    await tap(page, '[data-ri-tab="setup"]');
    await tap(page, '[data-ri-nested="presets"]');
    out.registered.presets = (await shell(page)).page;
    assert.equal(out.registered.presets, 'presets');
    await tap(page, '[data-ri-nested="look"]');
    out.registered.look = (await shell(page)).page;
    assert.equal(out.registered.look, 'look');
    out.registered.spendTab = await page.evaluate(() => [...document.querySelectorAll('[data-ri-nested]')].at(-1).textContent);
    await page.evaluate(async BASE => {
        const { unregisterPage } = await import(`${BASE}/src/ui/page-registry.js`);
        for (const id of ['b5-spend']) unregisterPage(id);
    }, BASE);

    // Search: SillyTavern words, landing on the control with its folds open, and a Back that names its place.
    await tap(page, '[data-ri-tab="review"]');
    await tap(page, '[data-ri-nested="request-log"]');
    out.search = {};
    const search = async (query, name, ready) => {
        if (!await page.locator('#ri-menu-search').count()) await tap(page, '[data-ri-search]');
        await page.fill('#ri-menu-search', query);
        await page.waitForTimeout(900);
        if (ready) await page.waitForFunction(re => [...document.querySelectorAll('.ri-shell-result')].some(node => new RegExp(re).test(node.innerText.replace(/\s+/g, ' '))), ready.source, { timeout: 20000 });
        const list = await page.evaluate(() => [...document.querySelectorAll('.ri-shell-result')].slice(0, 4).map(node => node.innerText.replace(/\s+/g, ' ')));
        if (name) await shot(name);
        await tap(page, '.ri-shell-result');
        await page.waitForTimeout(400);
        const landed = await page.evaluate(() => {
            const active = document.activeElement;
            return { page: document.querySelector('#ri_panel_page').dataset.page, tag: active?.tagName,
                label: active?.getAttribute('aria-label') || active?.labels?.[0]?.textContent || active?.textContent?.slice(0, 60),
                foldsOpen: (() => { const all = []; for (let d = active?.closest('details'); d; d = d.parentElement?.closest('details')) all.push(d.open); return all; })(),
                back: document.querySelector('[data-ri-back]')?.getAttribute('aria-label') || null };
        });
        return { query, list, landed };
    };
    out.search.authorsNote = await search('Author\'s Note', 'search-authors-note');
    assert.equal(out.search.authorsNote.landed.page, 'writing');
    assert.equal(out.search.authorsNote.landed.back, 'Back to Review, Request log');
    await shot('back-named');
    await tap(page, '[data-ri-back]');
    assert.equal((await shell(page)).page, 'log');
    // The pronouns and budget fields show only in V10 mode, which follows the active preset; pin it for this chat
    // so another suite's preset choice cannot hide them (the Characters page is a V10 page).
    const pinned = await page.evaluate(async BASE => {
        const { chatState } = await import(`${BASE}/src/store.js`);
        const state = chatState();
        if (!state) return false;
        state.v10 = { ...(state.v10 || {}), enabled: true };
        return true;
    }, BASE);
    assert.ok(pinned, 'a chat is open for the pronouns and budget searches');
    out.search.pronouns = await search('pronouns', 'search-pronouns');
    assert.equal(out.search.pronouns.landed.page, 'portrayal');
    assert.equal(out.search.pronouns.landed.tag, 'SELECT');
    await shot('landed-pronouns');
    out.search.budget = await search('budget');
    assert.match(out.search.budget.landed.label || '', /budget/i, JSON.stringify(out.search.budget));
    out.search.impersonate = await search('impersonate');
    out.search.summarize = await search('summarize');
    assert.equal(out.search.summarize.landed.page, 'world');
    out.search.worldInfo = await search('World Info');
    assert.equal(out.search.worldInfo.landed.page, 'books');
    out.search.foldedPrompt = await search('Dice guidance', 'search-folded', /Dice guidance PROMPT/);
    assert.equal(out.search.foldedPrompt.landed.tag, 'TEXTAREA');
    assert(out.search.foldedPrompt.landed.foldsOpen.length && out.search.foldedPrompt.landed.foldsOpen.every(Boolean));
    await shot('landed-folded-prompt');

    // Reopening lands on the last page reached through tabs, after a cross-link and after a reload.
    await tap(page, '[data-ri-tab="review"]');
    await tap(page, '[data-ri-nested="request-log"]');
    await search('pronouns');
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); await app.setExpanded(true); }, BASE);
    await page.waitForTimeout(300);
    out.reopen = (await shell(page)).page;
    assert.equal(out.reopen, 'log');
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#ri_root', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(true); }, BASE);
    await page.waitForTimeout(300);
    out.reopenAfterReload = (await shell(page)).page;
    await page.evaluate(async () => { const host = SillyTavern.getContext(); if (host.characterId === undefined) await host.selectCharacterById(host.characters.findIndex(item => item.name)); });
    await page.waitForTimeout(1500);
    out.reopenAfterChat = (await shell(page)).page;
    assert.equal(out.reopenAfterChat, 'log');
    assert.equal(out.reopenAfterReload, 'log');

    // Breadcrumbs inside a sub-view replace the in-page backs.
    const setName = await page.evaluate(async BASE => {
        const { createSet } = await import(`${BASE}/src/books.js`);
        const name = await createSet(`B5 crumbs ${Date.now() % 100000}`);
        return name;
    }, BASE);
    await tap(page, '[data-ri-tab="direction"]');
    await page.evaluate(async ({ BASE, setName }) => { const { app } = await import(`${BASE}/src/ui/panel.js`); app.cache = {}; app.go({ view: 'set', name: setName }); }, { BASE, setName });
    await page.waitForTimeout(900);
    const crumbState = () => page.evaluate(() => ({
        crumbs: [...document.querySelectorAll('.ri-shell-crumbs li')].map(node => node.textContent.replace(/[›\s]+/g, ' ').trim()),
        visibleInPageBacks: [...document.querySelectorAll('#ri_panel_page button')].filter(node => !node.closest('[data-ri-shell]') && /Back to/i.test(node.textContent) && node.getClientRects().length).length,
        headerBack: !!document.querySelector('[data-ri-back]'),
    }));
    out.crumbs = { set: await crumbState() };
    assert.equal(out.crumbs.set.visibleInPageBacks, 0);
    assert.equal(out.crumbs.set.crumbs[0], 'Random sets');
    await shot('breadcrumbs-set');
    const addInstruction = page.locator('#ri_panel_page button', { hasText: /^Add (an )?instruction$/ });
    if (await addInstruction.count()) {
        await addInstruction.first().tap();
        await page.waitForTimeout(600);
        out.crumbs.edit = await crumbState();
        assert.equal(out.crumbs.edit.crumbs.length, 3);
        assert.equal(out.crumbs.edit.visibleInPageBacks, 0);
        await shot('breadcrumbs-edit');
        await page.locator('.ri-shell-crumbs button').first().tap();
        await page.waitForTimeout(300);
        if (await page.locator('dialog[open] .popup-button-ok').count()) await page.locator('dialog[open] .popup-button-ok').first().tap();
        await page.waitForTimeout(600);
    } else {
        await page.locator('.ri-shell-crumbs button').first().tap();
        await page.waitForTimeout(600);
    }
    out.crumbs.afterRoot = await page.evaluate(async BASE => (await import(`${BASE}/src/ui/panel.js`)).app.route.view, BASE);
    assert.equal(out.crumbs.afterRoot, 'sets');
    await page.evaluate(async ({ BASE, setName }) => { const { deleteSet } = await import(`${BASE}/src/books.js`); await deleteSet?.(setName); }, { BASE, setName }).catch(() => {});

    out.errors = errors;
    results.runs.push(out);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, { width: 523, height: 1021 }, 'w523');
        await run(browser, { width: 1006, height: 909 }, 'w1006');
        // The content column at 1006 px caps at 720 px and centers.
        const last = results.runs.at(-1);
        assert(last.compact.content.w <= 720, `content ${last.compact.content.w}`);
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
        await browser.close();
    }
    console.log('menu shell touch pass: passed');
})().catch(error => { console.error(error); process.exit(1); });
