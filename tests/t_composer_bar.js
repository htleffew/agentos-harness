// B1 touch pass: the composer bar, Generate sheet and size settings on a real SillyTavern 1.19.0 host
// with the mock model and its request recorder. Runs at 523 x 1021 (cover screen, SillyTavern's mobile
// layout) and 1006 x 909 (inner screen, desktop layout) with touch input, then 390 px for the message box.
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed (default http://127.0.0.1:8133)
//   RI_MOCK_LOG      the recorder's JSON lines file (tests/mock.js or any recorder writing {url, body} rows)
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8133';
const LOG = process.env.RI_MOCK_LOG;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B1');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };
const requestCount = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).length : 0);
const requestsSince = start => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(start).map(line => JSON.parse(line)) : []);

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
        document.querySelector('#api_button_openai')?.click();
    });
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus && SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin', { state: 'attached', timeout: 30000 });
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.setBarFolded(false);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForTimeout(800);
    return { page, errors };
}

const rect = (page, selector) => page.evaluate(sel => {
    const node = document.querySelector(sel);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
}, selector);

async function setLook(page, look) {
    await page.evaluate(async ({ BASE, look }) => {
        const { saveLook } = await import(`${BASE}/src/ui/theme/styles.js`);
        saveLook(look);
    }, { BASE, look });
    await page.waitForTimeout(250);
}

async function measure(page) {
    return page.evaluate(() => {
        const box = node => { const r = node.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
        const bar = document.querySelector('#ri_composer_bar');
        const pin = bar.querySelector('.ri-bar-pin:not([hidden])');
        const glyph = pin.querySelector('i');
        const dotNode = bar.querySelector('.ri-bar-pin .ri-bar-dot');
        const pins = [...bar.querySelectorAll('.ri-bar-pin')];
        const fold = bar.querySelector('.ri-bar-fold');
        const face = bar.querySelector('.ri-bar-fold-face');
        const row = bar.querySelector('.ri-bar-row');
        return {
            bar: box(bar), row: box(row), target: box(pin), glyph: parseFloat(getComputedStyle(glyph).fontSize),
            gap: parseFloat(getComputedStyle(row).columnGap), dot: dotNode ? box(dotNode) : null,
            handleVisible: box(face), handleHit: box(fold), pinsShown: pins.filter(node => !node.hidden).length, pinsTotal: pins.length,
            messageBox: box(document.querySelector('#send_textarea')),
            extensionInLeftSendForm: !!document.querySelector('#leftSendForm [class*="ri-"], #leftSendForm [id^="ri_"]'),
            extensionInSendForm: !!document.querySelector('#send_form [class*="ri-"], #send_form [id^="ri_"]'),
            barBeforeSendForm: bar.nextElementSibling?.id,
            dots: pins.map(node => ({ kind: node.dataset.kind, dot: !!node.querySelector('.ri-bar-dot'), label: node.getAttribute('aria-label') })),
        };
    });
}

async function pinMany(page, count) {
    return page.evaluate(async ({ BASE, count }) => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        const bar = Q.composerBar();
        const saved = [...bar.pins];
        for (const action of Q.listQuickActions('', { allKinds: true })) if (bar.pins.length < count) Q.pinToBar(action.id, true);
        const { renderBar } = await import(`${BASE}/src/ui/composer-bar.js`);
        renderBar();
        return saved;
    }, { BASE, count });
}

async function restorePins(page, pins) {
    await page.evaluate(async ({ BASE, pins }) => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.composerBar().pins = pins;
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, { BASE, pins });
}

async function tapPin(page, kind, title) {
    const selector = title ? `#ri_composer_bar .ri-bar-pin[title="${title}"]` : `#ri_composer_bar .ri-bar-pin[data-kind="${kind}"]`;
    const box = await rect(page, selector);
    assert.ok(box, `pin ${title || kind} is on the bar`);
    await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2);
    await page.waitForTimeout(250);
    return box;
}

async function touch(page, type, points) {
    page.riTouch ||= await page.context().newCDPSession(page);
    await page.riTouch.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function shot(page, name) {
    await page.screenshot({ path: path.join(OUT, name) });
    return `${name}`;
}

async function sheetState(page) {
    return page.evaluate(() => {
        const sheet = document.querySelector('.ri-gsheet');
        if (!sheet) return null;
        const box = sheet.querySelector('.ri-gsheet-box');
        return {
            title: sheet.querySelector('.ri-gsheet-title').textContent,
            cost: sheet.querySelector('.ri-gsheet-cost').textContent,
            costDot: !!sheet.querySelector('.ri-gsheet-cost .ri-bar-dot'),
            saved: sheet.querySelector('.ri-gsheet-saved span').textContent,
            boxLabel: sheet.querySelector('.ri-gsheet-label').textContent,
            boxValue: box.value,
            boxFocused: document.activeElement === box,
            generate: sheet.querySelector('[data-ri-generate]').textContent,
            generateDot: !!sheet.querySelector('[data-ri-generate] .ri-bar-dot'),
            rect: (r => ({ top: r.top, bottom: r.bottom, h: r.height }))(sheet.getBoundingClientRect()),
            innerHeight, viewportBottom: visualViewport.offsetTop + visualViewport.height, barTop: document.querySelector("#ri_composer_bar").getBoundingClientRect().top,
        };
    });
}

async function closeSheet(page) {
    const box = await rect(page, '.ri-gsheet [data-ri-close]');
    if (box) await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2);
    await page.waitForTimeout(250);
}

async function run(browser, label, viewport) {
    const { page, errors } = await boot(browser, viewport);
    const run = { label, viewport, checks: {}, shots: [] };
    results.runs.push(run);
    const ensureReply = async () => {
        const has = await page.evaluate(() => SillyTavern.getContext().chat.some(message => !message.is_user && !message.is_system));
        if (has) return;
        await page.evaluate(() => { jQuery('#send_textarea').val('I watch the gate.').trigger('input'); jQuery('#send_but').trigger('click'); });
        await page.waitForFunction(() => { const chat = SillyTavern.getContext().chat; return !chat.at(-1).is_user; }, null, { timeout: 60000 });
    };
    await ensureReply();
    await page.evaluate(() => document.querySelector('#chat').scrollTo(0, 1e6));

    // 4.10 measurements, Compact then Comfortable, with enough pins to overflow into More.
    for (const size of ['compact', 'comfortable']) {
        await setLook(page, { text: size, icons: size, targets: size, textScale: 100, iconScale: 100, targetScale: 100 });
        const saved = await pinMany(page, 14);
        await page.waitForTimeout(300);
        const open = await measure(page);
        run.shots.push(await shot(page, `${label}-${size}-open.png`));
        await restorePins(page, saved);
        await page.touchscreen.tap(...await (async () => { const b = await rect(page, '#ri_composer_bar .ri-bar-fold'); return [b.x + b.w / 2, b.y + b.h - 4]; })());
        await page.waitForTimeout(250);
        const folded = { bar: await rect(page, '#ri_composer_bar'), strip: await rect(page, '#ri_composer_bar .ri-bar-strip'),
            handle: await rect(page, '#ri_composer_bar .ri-bar-fold-face'), state: await page.evaluate(() => document.querySelector('#ri_composer_bar').dataset.folded) };
        run.shots.push(await shot(page, `${label}-${size}-folded.png`));
        await page.touchscreen.tap(...await (async () => { const b = await rect(page, '#ri_composer_bar .ri-bar-fold'); return [b.x + b.w / 2, b.y + b.h - 4]; })());
        await page.waitForTimeout(250);
        run.checks[size] = { open, folded };
    }
    await setLook(page, { text: 'compact', icons: 'compact', targets: 'compact' });

    // Taps open the sheet with no request; Close makes none.
    const zero = {};
    run.checks.tapThenClose = zero;
    for (const [kind, title] of [['options'], ['swipe', 'Swipe'], ['continue'], ['impersonate']]) {
        const before = requestCount();
        await tapPin(page, kind, title);
        const state = await sheetState(page);
        zero[kind] = { sheet: state };
        assert.ok(state, `${kind} opens the Generate sheet`);
        if (kind === 'options' || kind === 'swipe') run.shots.push(await shot(page, `${label}-sheet-${kind}.png`));
        await closeSheet(page);
        await page.waitForTimeout(400);
        zero[kind] = { sheet: state, requestsAfterTapAndClose: requestCount() - before, sheetGone: !(await sheetState(page)) };
        assert.equal(zero[kind].requestsAfterTapAndClose, 0, `${kind}: tap then Close makes no request`);
        assert.equal(state.boxFocused, false, `${kind}: the text box takes no focus on open`);
        assert.ok(Math.abs(state.rect.bottom - state.barTop) < 2 && state.rect.top > 0, `${kind}: the sheet stands on the bar, on screen`);
    }
    run.checks.tapThenClose = zero;

    // Draft kept after Close, and Escape closes too.
    await tapPin(page, 'continue');
    await page.fill('.ri-gsheet .ri-gsheet-box', 'Keep this draft');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await tapPin(page, 'continue');
    run.checks.draftKept = (await sheetState(page)).boxValue;
    assert.equal(run.checks.draftKept, 'Keep this draft');
    await page.fill('.ri-gsheet .ri-gsheet-box', '');
    await closeSheet(page);

    // Pointer cancellation: sliding off cancels the tap, and a hold opens the popover with no job run.
    const swipeBox = await rect(page, '#ri_composer_bar .ri-bar-pin[data-kind="swipe"]');
    const cx = swipeBox.x + swipeBox.w / 2, cy = swipeBox.y + swipeBox.h / 2;
    await touch(page, 'touchStart', [{ x: cx, y: cy }]);
    await touch(page, 'touchMove', [{ x: cx, y: cy - 60 }]);
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(300);
    const slideOff = !(await sheetState(page));
    await touch(page, 'touchStart', [{ x: cx, y: cy }]);
    await page.waitForTimeout(650);
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(300);
    const pop = await page.evaluate(() => {
        const node = document.querySelector('.ri-bar-pop');
        return node && { title: node.querySelector('.ri-bar-pop-title').textContent, cost: node.querySelector('.ri-bar-pop-cost').textContent,
            buttons: [...node.querySelectorAll('button')].map(button => button.textContent) };
    });
    const holdOpenedSheet = !!(await sheetState(page));
    run.shots.push(await shot(page, `${label}-hold-popover.png`));
    await page.keyboard.press('Escape');
    run.checks.pointer = { slideOffCancels: slideOff, holdPopover: pop, holdOpenedSheet };
    assert.ok(slideOff, 'sliding off cancels the tap');
    assert.deepEqual(pop.buttons, ['Edit', 'Move left', 'Move right', 'Unpin']);
    assert.equal(holdOpenedSheet, false);

    // Options: typed text rides in the same request as the saved prompt; results grow in the sheet.
    let start = requestCount();
    await tapPin(page, 'options');
    await page.fill('.ri-gsheet .ri-gsheet-box', 'Make one of them a smuggler');
    const generate = await rect(page, '.ri-gsheet [data-ri-generate]');
    await page.touchscreen.tap(generate.x + generate.w / 2, generate.y + generate.h / 2);
    await page.waitForTimeout(250);
    const running = await page.evaluate(() => ({
        stop: document.querySelector('.ri-bar-status-button')?.textContent,
        disabled: [...document.querySelectorAll('#ri_composer_bar .ri-bar-pin')].map(node => ({ kind: node.dataset.kind, disabled: node.disabled })),
        live: document.querySelector('#ri_composer_bar [aria-live]')?.textContent,
    }));
    run.shots.push(await shot(page, `${label}-options-running.png`));
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    await page.waitForTimeout(300);
    run.shots.push(await shot(page, `${label}-options-results.png`));
    let sent = requestsSince(start).filter(row => !row.url.includes('models'));
    run.checks.options = { running, requests: sent.length,
        typedAndPromptInOneRequest: sent.length === 1 && sent[0].body.includes('Make one of them a smuggler') && sent[0].body.includes('Suggest a new NPC'),
        cards: await page.locator('.ri-gsheet .ri-option-card').count() };
    assert.equal(run.checks.options.typedAndPromptInOneRequest, true);
    assert.equal(running.disabled.filter(row => ['options', 'swipe', 'continue', 'impersonate'].includes(row.kind)).every(row => row.disabled), true);
    assert.equal(running.disabled.filter(row => ['review', 'direction'].includes(row.kind)).every(row => !row.disabled), true);
    run.checks.options.sheetHeightShare = await page.evaluate(() => Math.round(document.querySelector('.ri-gsheet').getBoundingClientRect().height / visualViewport.height * 100));
    await closeSheet(page);

    // 4.6 states: ready with the sheet closed, Stop to cancel, and a failure with its recovery.
    const generateNow = async () => {
        const button = await rect(page, '.ri-gsheet [data-ri-generate]');
        await page.touchscreen.tap(button.x + button.w / 2, button.y + button.h / 2);
        await page.waitForTimeout(150);
    };
    await tapPin(page, 'options');
    await generateNow();
    await closeSheet(page);
    await page.waitForSelector('.ri-bar-status-button[data-tone="ready"]', { timeout: 30000 });
    const ready = await page.evaluate(() => document.querySelector('.ri-bar-status-button').textContent);
    run.shots.push(await shot(page, `${label}-status-ready.png`));
    const view = await rect(page, '.ri-bar-status-button');
    await page.touchscreen.tap(view.x + view.w / 2, view.y + view.h / 2);
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 5000 });
    const viewed = await page.locator('.ri-gsheet .ri-option-card').count();
    await closeSheet(page);
    start = requestCount();
    await tapPin(page, 'options');
    await generateNow();
    const stop = await rect(page, '.ri-bar-status-button[data-tone="call"]');
    await page.touchscreen.tap(stop.x + stop.w / 2, stop.y + stop.h / 2);
    await page.waitForTimeout(200);
    const cancelled = await page.evaluate(() => document.querySelector('.ri-bar-status-button')?.textContent || '');
    run.shots.push(await shot(page, `${label}-status-cancelled.png`));
    await closeSheet(page);
    await page.waitForTimeout(3300);
    const clearedAfter3s = !(await page.evaluate(() => document.querySelector('.ri-bar-status-button')));
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/quick-actions.js`)).saveQuickAction({ id: 'builtin:options:npc', set: 'missing-set' });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await tapPin(page, 'options');
    await generateNow();
    await page.waitForSelector('.ri-gsheet [data-ri-retry]', { timeout: 10000 });
    const failure = await page.evaluate(() => ({ status: document.querySelector('.ri-bar-status-button')?.textContent,
        corner: document.querySelector('.ri-bar-pin[data-kind="options"]').dataset.failed,
        error: document.querySelector('.ri-gsheet-error').textContent,
        buttons: [...document.querySelectorAll('.ri-gsheet-error button')].map(button => button.textContent) }));
    run.shots.push(await shot(page, `${label}-status-failed.png`));
    await closeSheet(page);
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/quick-actions.js`)).restoreQuickAction('builtin:options:npc');
        (await import(`${BASE}/src/ui/composer-bar.js`)).setBarStatus({ state: 'idle' });
    }, BASE);
    run.checks.states = { ready, viewed, cancelled, clearedAfter3s, failure };
    assert.equal(ready, 'View 4');
    assert.equal(viewed, 4);
    assert.match(cancelled, /Cancelled/);
    assert.deepEqual(failure.buttons, ['Retry', 'Connection settings']);

    // Swipe with a saved direction plus typed text: one request carries both.
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.saveQuickAction({ id: 'builtin:swipe:plain', text: 'Let the responding character show what they feel through what they say and do.' });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    start = requestCount();
    await tapPin(page, 'swipe');
    run.checks.swipeSheet = await sheetState(page);
    await page.fill('.ri-gsheet .ri-gsheet-box', 'Mention the rain on the shutters');
    const swipeGenerate = await rect(page, '.ri-gsheet [data-ri-generate]');
    await page.touchscreen.tap(swipeGenerate.x + swipeGenerate.w / 2, swipeGenerate.y + swipeGenerate.h / 2);
    await page.waitForTimeout(400);
    run.checks.swipeSheetClosedOnGenerate = !(await sheetState(page));
    run.checks.swipeRunning = await page.evaluate(() => document.querySelector('.ri-bar-status-button')?.textContent || '');
    await page.waitForFunction(() => !document.querySelector('.ri-bar-status-button[data-tone="reply"]'), null, { timeout: 60000 });
    await page.waitForTimeout(800);
    sent = requestsSince(start).filter(row => !row.url.includes('models'));
    const swipeRequest = sent.find(row => row.body.includes('Mention the rain on the shutters'));
    run.checks.swipe = { requests: sent.length,
        typedAndSavedInOneRequest: !!swipeRequest && swipeRequest.body.includes('show what they feel through what they say and do') };
    assert.equal(run.checks.swipe.typedAndSavedInOneRequest, true);
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.restoreQuickAction('builtin:swipe:plain');
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);

    // Code-only kinds: Direction queues on one tap with no request; Review opens What was sent.
    start = requestCount();
    await tapPin(page, 'direction');
    await page.waitForTimeout(300);
    run.checks.direction = { requests: requestCount() - start, queueChip: await page.evaluate(() => document.querySelector('.ri-bar-queue:not([hidden])')?.textContent || ''),
        live: await page.evaluate(() => document.querySelector('#ri_composer_bar [aria-live]')?.textContent) };
    run.shots.push(await shot(page, `${label}-queued.png`));
    assert.equal(run.checks.direction.requests, 0);
    await page.evaluate(async BASE => {
        const { quickChat } = await import(`${BASE}/src/quick-action-chat.js`);
        quickChat().pending = [];
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    start = requestCount();
    await tapPin(page, 'review');
    await page.waitForTimeout(800);
    run.checks.review = { requests: requestCount() - start, page: await page.evaluate(() => document.querySelector('#ri_panel_page')?.dataset.page) };
    run.shots.push(await shot(page, `${label}-review.png`));
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);

    // /ri-bar toggles; a hidden send form row moves the bar above the chat form.
    run.checks.slash = await page.evaluate(async () => {
        const host = SillyTavern.getContext();
        await host.executeSlashCommandsWithOptions('/ri-bar');
        const hidden = getComputedStyle(document.querySelector('#ri_composer_bar')).display === 'none';
        await host.executeSlashCommandsWithOptions('/ri-bar');
        return { hiddenAfterFirst: hidden, shownAfterSecond: getComputedStyle(document.querySelector('#ri_composer_bar')).display !== 'none' };
    });
    run.checks.fallbackPlacement = await page.evaluate(async BASE => {
        const form = document.querySelector('#send_form');
        form.style.display = 'none';
        const { placeBar } = await import(`${BASE}/src/ui/composer-bar.js`);
        placeBar();
        const bar = document.querySelector('#ri_composer_bar');
        const hiddenRow = { placement: bar.dataset.placement, next: bar.nextElementSibling?.id };
        form.style.display = '';
        placeBar();
        return { hiddenRow, restored: { placement: bar.dataset.placement, next: bar.nextElementSibling?.id } };
    }, BASE);

    // Switched off: only the dimmed strip.
    await page.evaluate(async BASE => {
        const { settings } = await import(`${BASE}/src/store.js`);
        settings().enabled = false;
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    run.checks.off = { bar: await rect(page, '#ri_composer_bar'), strip: await rect(page, '#ri_composer_bar .ri-bar-strip'),
        row: await rect(page, '#ri_composer_bar .ri-bar-row') };
    run.shots.push(await shot(page, `${label}-off.png`));
    await page.evaluate(async BASE => {
        const { settings } = await import(`${BASE}/src/store.js`);
        settings().enabled = true;
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);

    // Fold persists across a reload.
    await page.evaluate(async BASE => { const Q = await import(`${BASE}/src/quick-actions.js`); Q.setBarFolded(true); SillyTavern.getContext().saveSettings?.(); }, BASE);
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(async () => {
        const host = SillyTavern.getContext();
        if (host.characterId === undefined) await host.selectCharacterById(host.characters.findIndex(item => item.name));
    });
    await page.waitForSelector('#ri_composer_bar .ri-bar-strip', { state: 'visible', timeout: 60000 });
    await page.waitForTimeout(800);
    run.checks.foldAfterReload = await page.evaluate(() => document.querySelector('#ri_composer_bar')?.dataset.folded);
    run.shots.push(await shot(page, `${label}-folded-after-reload.png`));
    assert.equal(run.checks.foldAfterReload, 'true');
    await page.evaluate(async BASE => { const Q = await import(`${BASE}/src/quick-actions.js`); Q.setBarFolded(false); SillyTavern.getContext().saveSettings?.();
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar(); }, BASE);

    // Setup, Look is a registered page; a fixture page registers and renders without panel edits.
    run.checks.registry = await page.evaluate(async BASE => {
        const { registerPage } = await import(`${BASE}/src/ui/page-registry.js`);
        registerPage({ id: 'b1-fixture', group: 'review', label: 'Fixture page', render: body => body.append(Object.assign(document.createElement('p'), { id: 'b1-fixture-body', textContent: 'Fixture rendered' })) });
        const { app } = await import(`${BASE}/src/ui/panel.js`);
        await app.openPage('b1-fixture', { focusPage: true });
        await app.setExpanded(true);
        await new Promise(resolve => setTimeout(resolve, 400));
        const fixture = { body: document.querySelector('#b1-fixture-body')?.textContent, nav: !!document.querySelector('[data-ri-page="b1-fixture"]') };
        await app.openPage('look', { focusPage: true });
        await new Promise(resolve => setTimeout(resolve, 400));
        return { fixture, look: { title: document.querySelector('[data-ri-heading]')?.textContent, nav: !!document.querySelector('[data-ri-page="look"]'),
            controls: [...document.querySelectorAll('#ri-look legend')].map(node => node.textContent) } };
    }, BASE);
    run.shots.push(await shot(page, `${label}-look.png`));
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);
    assert.equal(run.checks.registry.fixture.body, 'Fixture rendered');
    run.errors = errors;
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, 'w523', { width: 523, height: 1021 });
        await run(browser, 'w1006', { width: 1006, height: 909 });
        const { page } = await boot(browser, { width: 390, height: 780 });
        results.at390 = await measure(page);
        await page.screenshot({ path: path.join(OUT, 'w390-open.png') });
        // SillyTavern's own width: the message box measured with the extension's bar taken out of the page.
        results.at390.messageBoxWithoutBar = await page.evaluate(() => {
            const bar = document.querySelector('#ri_composer_bar'), next = bar.nextElementSibling;
            bar.remove();
            const width = Math.round(document.querySelector('#send_textarea').getBoundingClientRect().width * 10) / 10;
            next.before(bar);
            return width;
        });
        assert.equal(results.at390.extensionInSendForm, false);
        assert.equal(results.at390.messageBox.w, results.at390.messageBoxWithoutBar);
        await page.close();
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
        await browser.close();
    }
    console.log('B1 touch pass complete');
})().catch(error => { console.error(error); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, error: String(error.stack || error) }, null, 1)); process.exit(1); });
