// B45: SillyTavern's phone layout on every touch screen, however wide (DECISIONS.md, 2026-11-25).
// At 820 x 880, 1040 x 1080 and 1280 x 1200 with touch, every top-bar drawer and the character panel opens full width
// and takes taps; RI's menu, composer bar, fold handle and reply tray work at the wide sizes; resizing across 1000 px
// switches with no reload; with the switch off, or with a mouse, SillyTavern's desktop layout is unchanged.
//
// Environment: RI_HOST_URL, RI_MOCK_PORT, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE, and RI_ST_DIR, RI_ST_DATA and
// RI_EXTENSION_SOURCE to copy this checkout into the host (tests/README.md).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const L = require('./lib.js');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8281';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B45');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = L.BASE;
const DRAWERS = ['ai-config-button', 'sys-settings-button', 'advanced-formatting-button', 'WI-SP-button', 'user-settings-button',
    'backgrounds-button', 'extensions-settings-button', 'persona-management-button', 'rightNavHolder'];
const PHONE = { width: 820, height: 880 };
const WIDE = [{ width: 1040, height: 1080 }, { width: 1280, height: 1200 }];
const results = { host: HOST, media: null, sizes: [], ri: [], resize: null, off: null, mouse: null };
const size = v => `${v.width}x${v.height}`;

async function boot(browser, viewport, touch = true) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(HOST, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0 && !document.getElementById('preloader'), null, { timeout: 90000 });
    await page.waitForSelector('#ri_root', { state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForTimeout(400);
    return { page, errors };
}

async function tapBox(page, box) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
}

const box = (page, selector) => page.evaluate(selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), width: r.width, height: r.height };
}, selector);

/** Open a drawer the way she does: a tap on its top-bar icon. */
async function toggleDrawer(page, id, touch = true) {
    const icon = page.locator(`#${id} .drawer-toggle`).first();
    if (touch) await tapBox(page, await icon.boundingBox()); else await icon.click();
    await page.waitForTimeout(700);
}

const drawerBox = (page, id) => page.evaluate(id => {
    const node = document.querySelector(`#${id} .drawer-content`), r = node.getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), open: node.classList.contains('openDrawer'),
        sheld: Math.round(document.querySelector('#sheld').getBoundingClientRect().width) };
}, id);

/**
 * Tap the first visible control in the open drawer and report where the tap landed. A capture listener swallows the
 * click, so the tap proves the control receives it without changing any SillyTavern setting.
 */
async function tapControl(page, id) {
    const target = await page.evaluate(id => {
        const content = document.querySelector(`#${id} .drawer-content`);
        const controls = [...content.querySelectorAll('input:not([type=hidden]), select, textarea, .menu_button, .right_menu_button, .character_select')];
        const control = controls.find(node => {
            const r = node.getBoundingClientRect();
            return r.width > 8 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        });
        if (!control) return null;
        control.dataset.riProbe = 'target';
        globalThis.__riTap = null;
        globalThis.__riSwallow = event => {
            globalThis.__riTap = event.target.closest('[data-ri-probe]') ? 'control' : (event.target.id || event.target.className || event.target.tagName);
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        addEventListener('click', globalThis.__riSwallow, true);
        const r = control.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, name: control.id || control.className };
    }, id);
    assert.ok(target, `${id}: a control is on screen`);
    await tapBox(page, target);
    const landed = await page.evaluate(() => {
        removeEventListener('click', globalThis.__riSwallow, true);
        document.querySelector('[data-ri-probe]')?.removeAttribute('data-ri-probe');
        return globalThis.__riTap;
    });
    return { control: target.name, landed };
}

async function drawers(browser, viewport) {
    const { page, errors } = await boot(browser, viewport);
    const run = { size: size(viewport), coarse: await page.evaluate(() => matchMedia('(pointer: coarse)').matches), drawers: {} };
    assert.equal(run.coarse, true, 'the page sees a touch screen');
    for (const id of DRAWERS) {
        await toggleDrawer(page, id);
        const measured = await drawerBox(page, id);
        assert.equal(measured.open, true, `${run.size} ${id} opens`);
        assert.ok(Math.abs(measured.x) <= 2, `${run.size} ${id} starts at the left edge (x ${measured.x})`);
        assert.ok(Math.abs(measured.w - viewport.width) <= 2, `${run.size} ${id} is full width (${measured.w} of ${viewport.width})`);
        assert.ok(Math.abs(measured.sheld - viewport.width) <= 2, `${run.size} the chat column is full width (${measured.sheld})`);
        const file = `b45-${run.size}-${id}.png`;
        await page.screenshot({ path: path.join(OUT, file) });
        const tap = await tapControl(page, id);
        assert.equal(tap.landed, 'control', `${run.size} ${id}: a tap on ${tap.control} reaches it (landed on ${tap.landed})`);
        run.drawers[id] = { ...measured, tap, shot: file };
        await toggleDrawer(page, id);
        assert.equal((await drawerBox(page, id)).open, false, `${run.size} ${id} closes on a second tap`);
    }
    // One drawer at a time, as on the phone.
    await toggleDrawer(page, 'ai-config-button');
    await toggleDrawer(page, 'WI-SP-button');
    run.oneAtATime = { first: (await drawerBox(page, 'ai-config-button')).open, second: (await drawerBox(page, 'WI-SP-button')).open };
    assert.deepEqual(run.oneAtATime, { first: false, second: true });
    await toggleDrawer(page, 'WI-SP-button');
    run.errors = errors;
    assert.deepEqual(errors, []);
    await page.close();
    return run;
}

/** RI's own surfaces at a wide size: composer bar, fold handle, reply tray, the menu, and the switch on Look. */
async function riSurfaces(browser, viewport) {
    const { page, errors } = await boot(browser, viewport);
    const run = { size: size(viewport) };
    const shot = async name => { const file = `b45-${run.size}-ri-${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); return file; };
    await L.setupApi(page);
    await page.evaluate(async BASE => {
        const host = SillyTavern.getContext();
        const idx = host.characters.findIndex(item => item.name);
        if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
        await new Promise(resolve => setTimeout(resolve, 800));
        await host.executeSlashCommandsWithOptions('/newchat');
        await new Promise(resolve => setTimeout(resolve, 1200));
        const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`), Q = await import(`${BASE}/src/quick-actions.js`);
        V.prefs().enabled = true;
        S.saveChatState();
        Q.setBarFolded(false);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForSelector('#ri_composer_bar .ri-bar-fold', { timeout: 30000 });
    await L.send(page, 'I step through the gate and look around.');
    await page.waitForSelector('#chat .last_mes .ri-tray', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(600);

    const bar = await box(page, '#ri_composer_bar');
    const tray = await box(page, '#chat .last_mes .ri-tray');
    run.bar = bar;
    run.tray = tray;
    assert.ok(bar.w > viewport.width - 40 && bar.x >= 0 && bar.x + bar.w <= viewport.width + 1, `${run.size} the bar spans the full-width chat (${bar.x}, ${bar.w})`);
    assert.ok(tray.w > 200 && tray.x >= 0 && tray.x + tray.w <= viewport.width + 1, `${run.size} the reply tray sits inside the screen (${tray.x}, ${tray.w})`);
    run.shots = { chat: await shot('chat') };

    // The fold handle is on top where it is drawn, and a tap folds and opens the bar.
    const fold = await box(page, '#ri_composer_bar .ri-bar-fold');
    run.foldOnTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.ri-bar-fold'), { x: fold.x + fold.width / 2, y: fold.y + fold.height / 2 });
    assert.equal(run.foldOnTop, true, `${run.size} nothing covers the fold handle`);
    await tapBox(page, fold);
    run.folded = await page.evaluate(() => document.querySelector('#ri_composer_bar').dataset.folded);
    assert.equal(run.folded, 'true');
    run.shots.folded = await shot('folded');
    await tapBox(page, await box(page, '#ri_composer_bar .ri-bar-fold'));
    assert.equal(await page.evaluate(() => document.querySelector('#ri_composer_bar').dataset.folded), 'false');

    // The menu opens and its tabs take taps.
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/panel.js`)).app.setExpanded(true), BASE);
    await page.waitForSelector('.ri-shell-head', { timeout: 15000 });
    await page.waitForTimeout(400);
    await tapBox(page, await box(page, '[data-ri-tab="setup"]'));
    run.menu = { tab: await page.evaluate(() => document.querySelector('[data-ri-tab][aria-current="page"]')?.dataset.riTab), head: await box(page, '.ri-shell-head') };
    assert.equal(run.menu.tab, 'setup', `${run.size} a tap on Setup opens it`);
    assert.ok(run.menu.head.x >= 0 && run.menu.head.x + run.menu.head.w <= viewport.width + 1, `${run.size} the menu header is on screen`);
    run.shots.menu = await shot('menu');

    // The switch on Look: Off gives SillyTavern's desktop layout back at once, On returns the phone layout.
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/panel.js`)).app.openPage('look', { focusPage: true }), BASE);
    await page.waitForSelector('#ri-touch-layout', { timeout: 15000 });
    await page.locator('#ri-touch-layout').scrollIntoViewIfNeeded();
    run.shots.look = await shot('look-on');
    await tapBox(page, await page.locator('#ri-touch-layout button', { hasText: 'Off' }).boundingBox());
    run.switchOff = await page.evaluate(() => ({ flag: document.documentElement.dataset.riTouchLayout, sheld: Math.round(document.querySelector('#sheld').getBoundingClientRect().width),
        pressed: document.querySelector('#ri-touch-layout [aria-pressed="true"]')?.textContent, saved: SillyTavern.getContext().extensionSettings.roleplay_instructions?.phoneLayoutOnTouch }));
    assert.deepEqual({ flag: run.switchOff.flag, pressed: run.switchOff.pressed, saved: run.switchOff.saved }, { flag: 'off', pressed: 'Off', saved: false });
    assert.ok(run.switchOff.sheld < viewport.width * 0.75, `${run.size} switch off: the desktop half-width chat returns (${run.switchOff.sheld})`);
    run.shots.lookOff = await shot('look-off');
    await tapBox(page, await page.locator('#ri-touch-layout button', { hasText: 'On' }).boundingBox());
    run.switchOn = await page.evaluate(() => ({ flag: document.documentElement.dataset.riTouchLayout, sheld: Math.round(document.querySelector('#sheld').getBoundingClientRect().width) }));
    assert.equal(run.switchOn.flag, 'on');
    assert.ok(Math.abs(run.switchOn.sheld - viewport.width) <= 2, `${run.size} switch on: full width again (${run.switchOn.sheld})`);
    run.errors = errors;
    assert.deepEqual(errors, []);
    await page.waitForTimeout(2500); // SillyTavern saves settings on a debounce; let On reach the server
    await page.close();
    return run;
}

/** Fold to unfold and rotate with the page open: the layout follows with no reload. */
async function resize(browser) {
    const { page } = await boot(browser, PHONE);
    await page.evaluate(() => { globalThis.__riNoReload = true; });
    const steps = [];
    for (const viewport of [PHONE, WIDE[0], { width: 1080, height: 1040 }, WIDE[1], PHONE]) {
        await page.setViewportSize(viewport);
        await page.waitForTimeout(500);
        await toggleDrawer(page, 'rightNavHolder');
        const measured = await drawerBox(page, 'rightNavHolder');
        steps.push({ size: size(viewport), ...measured, sameDocument: await page.evaluate(() => globalThis.__riNoReload === true) });
        await toggleDrawer(page, 'rightNavHolder');
        assert.ok(Math.abs(measured.w - viewport.width) <= 2, `${size(viewport)} after resizing: the character panel is full width (${measured.w})`);
    }
    assert.ok(steps.every(step => step.sameDocument), 'no reload');
    await page.close();
    return steps;
}

/** The switch off on a touch screen, and a mouse at the same size, both give SillyTavern's own desktop layout. */
async function desktopKept(browser) {
    const measure = async page => {
        const out = {};
        for (const id of ['rightNavHolder', 'ai-config-button', 'extensions-settings-button']) {
            await toggleDrawer(page, id, false);
            out[id] = await drawerBox(page, id);
            await toggleDrawer(page, id, false);
        }
        return out;
    };
    const viewport = WIDE[0];
    const off = await boot(browser, viewport);
    await off.page.evaluate(async BASE => (await import(`${BASE}/src/ui/touch-layout.js`)).setTouchLayout(false), BASE);
    await off.page.waitForTimeout(400);
    const offLayout = await measure(off.page);
    await off.page.screenshot({ path: path.join(OUT, `b45-${size(viewport)}-switch-off-extensions.png`) });
    await off.page.evaluate(async BASE => (await import(`${BASE}/src/ui/touch-layout.js`)).setTouchLayout(true), BASE);
    await off.page.waitForTimeout(2500); // SillyTavern saves settings on a debounce; let On reach the server
    await off.page.close();

    const mouse = await boot(browser, viewport, false);
    const mouseInfo = await mouse.page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, flag: document.documentElement.dataset.riTouchLayout }));
    const mouseLayout = await measure(mouse.page);
    await mouse.page.close();
    assert.deepEqual(mouseInfo, { coarse: false, flag: 'on' }, 'the mouse page has the switch on and no touch');
    for (const id of Object.keys(offLayout)) {
        assert.ok(Math.abs(offLayout[id].sheld - viewport.width / 2) <= 2, `switch off: SillyTavern's half-width chat (${offLayout[id].sheld})`);
        assert.ok(offLayout[id].w < viewport.width - 100, `switch off: ${id} keeps its desktop width (${offLayout[id].w})`);
        for (const key of ['x', 'w', 'sheld']) assert.ok(Math.abs(offLayout[id][key] - mouseLayout[id][key]) <= 2, `mouse and switch off agree on ${id} ${key}`);
    }
    return { off: offLayout, mouse: mouseLayout };
}

/** touchMedia, read from the module the extension loads. */
async function mediaRows(browser) {
    const { page } = await boot(browser, PHONE);
    const rows = await page.evaluate(async BASE => {
        const { touchMedia, phoneBreakpoint } = await import(`${BASE}/src/ui/touch-layout.js`);
        const mobile = [...document.styleSheets].find(sheet => /mobile-styles\.css/.test(sheet.href || ''));
        return {
            breakpoint: phoneBreakpoint(),
            phone: touchMedia('screen and (max-width: 1000px)'),
            landscape: touchMedia('screen and (max-width: 1000px) and (orientation: landscape)'),
            desktop: touchMedia('screen and (min-width: 1001px)'),
            range: touchMedia('(width <= 1000px)'),
            other: touchMedia('(max-width: 768px)'),
            live: mobile ? [...mobile.cssRules].find(rule => rule.media)?.media.mediaText : null,
            desktopLive: [...document.styleSheets].flatMap(sheet => { try { return [...sheet.cssRules]; } catch { return []; } })
                .find(rule => rule.media && /min-width: 1001px/.test(rule.media.mediaText))?.media.mediaText,
        };
    }, BASE);
    await page.close();
    assert.equal(rows.breakpoint, 1000);
    assert.equal(rows.phone, 'screen and (max-width: 1000px), screen and (pointer: coarse)');
    assert.equal(rows.landscape, 'screen and (max-width: 1000px) and (orientation: landscape), screen and (pointer: coarse) and (orientation: landscape)');
    assert.equal(rows.desktop, 'screen and (min-width: 1001px) and (not (pointer: coarse))');
    assert.equal(rows.range, '(width <= 1000px), (pointer: coarse)');
    assert.equal(rows.other, null);
    assert.equal(rows.live, 'screen and (max-width: 1000px), screen and (pointer: coarse)', 'SillyTavern\'s own phone rule now also matches touch');
    assert.match(rows.desktopLive, /\(min-width: 1001px\) and \(not \(pointer: coarse\)\)/, 'the desktop-only rule is parsed, not dropped');
    return rows;
}

(async () => {
    L.sync();
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        results.media = await mediaRows(browser);
        console.log('media rows', JSON.stringify(results.media));
        for (const viewport of [PHONE, ...WIDE]) {
            const run = await drawers(browser, viewport);
            results.sizes.push(run);
            console.log(run.size, Object.entries(run.drawers).map(([id, d]) => `${id} x${d.x} w${d.w} tap:${d.tap.landed}`).join(' | '));
        }
        // Each wide drawer matches its 820 layout: same left edge, full width, same height where the screen allows it.
        const phone = results.sizes[0].drawers;
        for (const run of results.sizes.slice(1)) for (const id of DRAWERS) {
            const wide = run.drawers[id], narrow = phone[id];
            assert.ok(Math.abs(wide.x - narrow.x) <= 2, `${run.size} ${id} left edge matches 820`);
            assert.ok(wide.h >= narrow.h - 4, `${run.size} ${id} is at least as tall as at 820 (${wide.h} vs ${narrow.h})`);
        }
        for (const viewport of WIDE) {
            const run = await riSurfaces(browser, viewport);
            results.ri.push(run);
            console.log(run.size, 'ri', JSON.stringify({ bar: run.bar, tray: run.tray, fold: run.foldOnTop, menu: run.menu.tab, off: run.switchOff.sheld, on: run.switchOn.sheld }));
        }
        results.resize = await resize(browser);
        console.log('resize', JSON.stringify(results.resize.map(step => [step.size, step.w])));
        const kept = await desktopKept(browser);
        results.off = kept.off;
        results.mouse = kept.mouse;
        console.log('desktop kept', JSON.stringify(kept));
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        console.log('B45 touch layout: PASS');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
