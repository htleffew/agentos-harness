// B3 touch pass: Quick actions, Bar and Quick actions, Library on a real SillyTavern 1.19.0 host with touch input at
// 523 x 1021 (cover screen, mobile layout) and 1006 x 909 (inner screen, desktop layout).
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed (default http://127.0.0.1:8143)
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_PROFILE       short folder for Chrome's temporary profile (default C:/pw-b3)
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8143';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B3');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.RI_PROFILE || 'C:/pw-b3';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };
fs.mkdirSync(OUT, { recursive: true });

async function boot(browser, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark', acceptDownloads: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(async () => {
        for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click();
        const host = SillyTavern.getContext();
        if (host.characterId === undefined) await host.selectCharacterById(host.characters.findIndex(item => item.name));
    });
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin', { state: 'attached', timeout: 30000 });
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.setBarFolded(false);
        Q.useChatBar(false);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForTimeout(800);
    return { page, errors };
}

const openPage = (page, id) => page.evaluate(async ({ BASE, id }) => {
    // The panel keeps the page it already shows; go through another page so the target renders fresh.
    const { app: current } = await import(`${BASE}/src/ui/panel.js`);
    if (current.tab === id) await current.openPage(id === 'quick-bar' ? 'quick-library' : 'quick-bar');
    const { app } = await import(`${BASE}/src/ui/panel.js`);
    await app.openPage(id, { focusPage: true });
    await app.setExpanded(true);
}, { BASE, id });

async function tap(page, selector) {
    const node = page.locator(selector).first();
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    assert.ok(box, `${selector} is on screen`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
}

async function touch(page, type, points) {
    page.riTouch ||= await page.context().newCDPSession(page);
    await page.riTouch.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

const barOrder = page => page.evaluate(() => [...document.querySelectorAll('#ri_composer_bar .ri-bar-pin')].map(node => node.dataset.actionId));
const globalPins = page => page.evaluate(async BASE => (await import(`${BASE}/src/quick-actions.js`)).barPins('global').map(action => action.id), BASE);
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, name) }); return name; };

async function run(browser, width, height, label) {
    const { page, errors } = await boot(browser, { width, height });
    const r = { label, width, shots: [] };
    const s = name => shot(page, `w${width}-${name}.png`).then(file => r.shots.push(file));

    // ---- Bar page: Move up, Move down, Unpin by single taps
    await openPage(page, 'quick-bar');
    await page.waitForSelector('#ri-qa-bar .ri-qa-pin');
    const before = await barOrder(page);
    const firstRow = await page.locator('#ri-qa-bar ol .ri-qa-pin').first().getAttribute('data-action-id');
    assert.equal(firstRow, before[0], 'page rows follow the bar order');
    await tap(page, `#ri-qa-bar ol [data-action-id="${before[0]}"] [data-ri-act="move-down"]`);
    const moved = await barOrder(page);
    assert.deepEqual(moved.slice(0, 2), [before[1], before[0]], 'one tap on Move down moves the pin on the bar');
    await tap(page, `#ri-qa-bar ol [data-action-id="${before[0]}"] [data-ri-act="move-up"]`);
    assert.deepEqual(await barOrder(page), before, 'one tap on Move up restores the order');
    const target = before[2];
    await tap(page, `#ri-qa-bar ol [data-action-id="${target}"] [data-ri-act="unpin"]`);
    assert.ok(!(await barOrder(page)).includes(target), 'one tap on Unpin removes the pin');
    await s('bar');
    await tap(page, '#ri-qa-bar [data-ri-pin-list] summary');
    await tap(page, `#ri-qa-bar [data-ri-pin-list] [data-action-id="${target}"] button`);
    assert.ok((await barOrder(page)).includes(target), 'Pin returns it');
    r.singleTapPins = { moveDown: true, moveUp: true, unpin: true, pin: true };

    // ---- Preview agrees with the real bar when many pins overflow
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        for (const action of Q.listQuickActions('', { allKinds: true })) if (Q.composerBar().pins.length < 16) Q.pinToBar(action.id, true);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await openPage(page, 'quick-bar');
    await page.waitForTimeout(500);
    const fit = await page.evaluate(() => {
        const preview = document.querySelector('.ri-qa-prev');
        return { shownPreview: Number(preview.dataset.shown), width: Number(preview.dataset.width), line: document.querySelector('.ri-qa-prev-line').textContent,
            shownBar: [...document.querySelectorAll('#ri_composer_bar .ri-bar-pin')].filter(node => !node.hidden).length, total: document.querySelectorAll('#ri_composer_bar .ri-bar-pin').length,
            overflowChips: document.querySelectorAll('.ri-qa-prev-icon[data-overflow="true"]').length };
    });
    r.previewFit = fit;
    assert.equal(fit.shownPreview, fit.shownBar, 'the preview shows the pins the bar shows');
    assert.ok(fit.overflowChips > 0, 'pins overflow at this size');
    await s('bar-overflow');
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.composerBar().pins = [...Q.BAR_DEFAULT_PINS];
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);

    // ---- This chat: starts as a copy, replaces the global bar for this chat only
    await openPage(page, 'quick-bar');
    const global = await globalPins(page);
    await tap(page, '#ri-qa-bar [data-scope="chat"]');
    assert.deepEqual(await barOrder(page), global, 'This chat starts as a copy');
    const drop = global[1];
    await tap(page, `#ri-qa-bar ol [data-action-id="${drop}"] [data-ri-act="unpin"]`);
    assert.ok(!(await barOrder(page)).includes(drop), 'the chat bar changed');
    assert.deepEqual(await globalPins(page), global, 'the global bar did not');
    await s('bar-this-chat');
    await tap(page, '#ri-qa-bar [data-scope="global"]');
    assert.ok(!(await barOrder(page)).includes(drop), 'while the chat has its own bar the bar keeps it');
    await tap(page, '#ri-qa-bar [data-scope="chat"]');
    await tap(page, '#ri-qa-bar [data-ri-use-global]');
    assert.deepEqual(await barOrder(page), global, 'Use the global bar returns the global pins');
    r.thisChat = { copy: true, replacesOnlyThisChat: true, globalUntouched: true };

    // ---- Library: kinds, dots, Pin, Edit, Duplicate, Delete, Import, Export
    await openPage(page, 'quick-library');
    await page.waitForSelector('#ri-qa-library .ri-qa-groups .ri-qa-item');
    const dots = await page.evaluate(() => [...document.querySelectorAll('#ri-qa-library .ri-qa-groups .ri-qa-item')].map(node => ({ kind: node.dataset.kind, dot: !!node.querySelector('.ri-qa-dot') })));
    assert.ok(dots.length > 10);
    assert.ok(dots.filter(item => item.kind === 'options').every(item => item.dot), 'Options rows carry the amber dot');
    assert.ok(dots.filter(item => item.kind !== 'options').every(item => !item.dot), 'every other row carries none');
    r.library = { rows: dots.length, kinds: [...new Set(dots.map(item => item.kind))], optionsDots: dots.filter(item => item.dot).length };
    await s('library');
    const swipeId = 'builtin:swipe:emotional';
    await tap(page, `#ri-qa-library [data-action-id="${swipeId}"] [data-ri-pin]`);
    assert.ok((await barOrder(page)).includes(swipeId), 'Pin from the Library puts it on the bar');
    await tap(page, `#ri-qa-library [data-action-id="${swipeId}"] [data-ri-pin]`);
    assert.ok(!(await barOrder(page)).includes(swipeId), 'and Unpin takes it off');

    // Edit NPC options: every field of 4.3, the icon grid, save
    await tap(page, '#ri-qa-library [data-action-id="builtin:options:npc"] [data-ri-edit]');
    await page.waitForSelector('.ri-qa-editor');
    const fields = await page.evaluate(() => {
        const text = document.querySelector('.ri-qa-editor').textContent;
        const names = ['Name', 'Icon', 'Show on the bar', 'Connection', 'Count', 'Length', 'Prompt', 'Random Instruction Set', 'Open results automatically', 'Insert mode'];
        return { present: names.filter(name => text.includes(name)), askFirst: /ask first/i.test(text), cardTap: /card tap/i.test(text),
            cost: document.querySelector('.ri-qa-cost-text')?.textContent, dot: !!document.querySelector('.ri-qa-cost .ri-qa-dot'),
            count: document.querySelector('.ri-qa-editor input[type="number"]')?.value, promptLink: /Open Setup, Prompts/.test(text) };
    });
    r.optionsEditor = fields;
    assert.equal(fields.present.length, 10);
    assert.ok(!fields.askFirst && !fields.cardTap);
    assert.equal(fields.count, '4');
    assert.ok(fields.promptLink, 'Prompt links to Setup, Prompts until B9 lands');
    await s('editor-options');
    await tap(page, '.ri-qa-icon-current');
    const grid = await page.evaluate(() => document.querySelectorAll('.ri-qa-icon-grid .ri-qa-icon').length);
    assert.ok(grid >= 55 && grid <= 70, `about 60 icons: ${grid}`);
    await page.fill('.ri-qa-icon-panel input[type="search"]', 'dice');
    const filtered = await page.evaluate(() => [...document.querySelectorAll('.ri-qa-icon-grid .ri-qa-icon')].map(node => node.dataset.icon));
    assert.deepEqual(filtered, ['fa-dice-d20']);
    r.iconGrid = { icons: grid, searchDice: filtered };
    await s('editor-icons');
    await page.fill('.ri-qa-icon-panel input[type="search"]', '');
    await tap(page, '.ri-qa-icon[data-icon="fa-ghost"]');
    await page.fill('.ri-qa-editor input[maxlength]', 'NPC picks');
    await page.fill('.ri-qa-editor input[type="number"]', '5');
    await tap(page, '[data-ri-save]');
    const saved = await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        const action = Q.readQuickAction('builtin:options:npc');
        return { title: action.title, count: action.count, icon: action.icon, barTitle: document.querySelector('#ri_composer_bar .ri-bar-pin[data-kind="options"]')?.title };
    }, BASE);
    assert.deepEqual([saved.title, saved.count, saved.barTitle], ['NPC picks', 5, 'NPC picks']);
    r.saveEdit = saved;
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.saveQuickAction({ id: 'builtin:options:npc', title: 'NPC options', count: 4, icon: '' });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);

    // The cost line follows the saved Connection Profile
    await openPage(page, 'quick-library');
    await tap(page, '#ri-qa-library [data-action-id="builtin:options:npc"] [data-ri-edit]');
    const costBefore = await page.textContent('.ri-qa-cost-text');
    await page.evaluate(async BASE => {
        const { settings, saveSettings } = await import(`${BASE}/src/store.js`);
        const st = settings();
        st.execution ||= {};
        st.execution.functions ||= {};
        st.execution.functions.playerChoices = { profileId: 'deepseek-v3' };
        saveSettings();
    }, BASE);
    await page.focus('.ri-qa-editor input');
    const costAfter = await page.textContent('.ri-qa-cost-text');
    r.costLine = { before: costBefore, after: costAfter };
    assert.match(costBefore, /^1 model call through /);
    assert.match(costAfter, /^1 model call through .*deepseek-v3/);
    await s('editor-cost-line');
    await page.evaluate(async BASE => {
        const { settings, saveSettings } = await import(`${BASE}/src/store.js`);
        delete settings().execution.functions.playerChoices;
        saveSettings();
    }, BASE);
    await tap(page, '[data-ri-cancel]');

    // Swipe editor, Direction editor: directive fields
    await tap(page, '#ri-qa-library [data-action-id="builtin:swipe:emotional"] [data-ri-edit]');
    r.swipeEditor = await page.evaluate(() => {
        const text = document.querySelector('.ri-qa-editor').textContent;
        return ['Direction text', 'Private or Visible', 'Required or Optional', 'Roll a d20 with it', 'Fresh start'].filter(name => text.includes(name));
    });
    assert.equal(r.swipeEditor.length, 5);
    await s('editor-swipe');
    await tap(page, '[data-ri-cancel]');

    // Duplicate, Delete, Undo
    const countBefore = await page.locator('#ri-qa-library .ri-qa-groups .ri-qa-item').count();
    await tap(page, `#ri-qa-library [data-action-id="${swipeId}"] [data-ri-duplicate]`);
    assert.equal(await page.locator('#ri-qa-library .ri-qa-groups .ri-qa-item').count(), countBefore + 1, 'Duplicate adds one');
    const copyId = await page.evaluate(() => [...document.querySelectorAll('#ri-qa-library .ri-qa-item strong')].find(node => node.textContent === 'More emotional copy')?.closest('.ri-qa-item').dataset.actionId);
    assert.ok(copyId, 'the copy is listed');
    await tap(page, `#ri-qa-library [data-action-id="${copyId}"] [data-ri-delete]`);
    assert.equal(await page.locator('#ri-qa-library .ri-qa-groups .ri-qa-item').count(), countBefore, 'Delete removes it');
    await tap(page, '[data-ri-undo]');
    assert.equal(await page.locator('#ri-qa-library .ri-qa-groups .ri-qa-item').count(), countBefore + 1, 'Undo brings it back');
    await tap(page, `#ri-qa-library [data-action-id="${copyId}"] [data-ri-delete]`);
    r.rowActions = { duplicate: true, delete: true, undo: true };

    // Export and Import
    const [download] = await Promise.all([page.waitForEvent('download'), tap(page, '[data-ri-export]')]);
    const exported = fs.readFileSync(await download.path(), 'utf8');
    assert.ok(JSON.parse(exported));
    await tap(page, '[data-ri-import]');
    await page.waitForSelector('[data-ri-choose-file]');
    await page.locator('details summary', { hasText: 'Paste JSON' }).first().click();
    await page.fill('textarea[aria-label="Paste import JSON"]', exported);
    await page.locator('button', { hasText: 'Review pasted JSON' }).click();
    await page.waitForSelector('[data-ri-import-now]', { timeout: 5000 }).catch(async error => { throw new Error(`import review: ${JSON.stringify(errors)} ${error.message}`); });
    r.importExport = { exportBytes: exported.length, reviewShown: true };
    await s('import');
    await page.locator('nav[aria-label="Breadcrumb"] button').click();

    // New action
    await page.selectOption('[data-ri-new-kind]', 'options');
    await tap(page, '[data-ri-new]');
    await page.fill('.ri-qa-editor input[maxlength]', 'Rumors');
    await tap(page, '[data-ri-save]');
    const rumor = await page.evaluate(async BASE => (await import(`${BASE}/src/quick-actions.js`)).listQuickActions('', { allKinds: true }).find(a => a.title === 'Rumors'), BASE);
    assert.equal(rumor.count, 4);
    assert.equal(rumor.length, 'medium');
    r.newOptions = { count: rumor.count, length: rumor.length };

    // Press and hold Edit on the bar opens the Library editor
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);
    await page.waitForTimeout(400);
    const pin = await page.locator('#ri_composer_bar .ri-bar-pin[data-kind="options"]').boundingBox();
    const point = { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2, id: 1 };
    await touch(page, 'touchStart', [point]);
    await page.waitForTimeout(650);
    await touch(page, 'touchEnd', []);
    await page.waitForSelector('.ri-bar-pop');
    await page.locator('.ri-bar-pop button', { hasText: 'Edit' }).first().click();
    await page.waitForSelector('.ri-qa-editor', { timeout: 8000 }).catch(error => { throw new Error(`hold Edit: ${JSON.stringify(errors)} ${error.message}`); });
    r.holdEdit = await page.textContent('[data-ri-editor-title]');
    assert.match(r.holdEdit, /^Edit /);
    await s('hold-edit');
    await tap(page, '[data-ri-cancel]');

    // More is one flat list
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);
    await page.waitForTimeout(400);
    await tap(page, '#ri_composer_bar .ri-bar-more');
    r.more = await page.evaluate(() => {
        const pop = document.querySelector('.ri-bar-pop');
        return { nested: pop.querySelectorAll('details, [aria-haspopup], [role="menu"] [role="menu"]').length, groups: [...pop.querySelectorAll('.ri-bar-pop-group')].map(node => node.textContent), rows: pop.querySelectorAll('.ri-bar-pop-row').length };
    });
    assert.equal(r.more.nested, 0);
    await s('more');

    // Sizes: every control on the two pages is at least 24 px
    await page.keyboard.press('Escape');
    await openPage(page, 'quick-bar');
    r.minTarget = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#ri-qa-bar button:not([disabled])')].map(node => { const b = node.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)); })));
    assert.ok(r.minTarget >= 24, `targets: ${r.minTarget}`);

    r.errors = errors;
    assert.deepEqual(errors, [], 'no page errors');
    await page.close();
    return r;
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, env: { ...process.env, TEMP: PROFILE, TMP: PROFILE } });
    try {
        results.runs.push(await run(browser, 523, 1021, 'cover screen, mobile layout'));
        results.runs.push(await run(browser, 1006, 909, 'inner screen, desktop layout'));
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        await browser.close();
    }
    console.log('B3 touch pass passed');
})().catch(error => { console.error(error); process.exit(1); });
