// B8 touch pass: components and type across the menu on a real SillyTavern 1.19.0 host with the mock model, at 523 x 1021
// (cover screen, mobile layout) and 1006 x 909 (inner screen, desktop layout) with touch input.
// Visits every nested tab, checks the 12 px type floor, zero radius on controls and the violet focus ring, then
// repeats a page under reduced motion, more contrast and forced colors with a screenshot of each and a check that
// switch, tab and focus states stay distinguishable.
//
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME and RI_EVIDENCE as in t_menu_shell.js.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8175';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B8');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
    await page.locator('#extensions-settings-button > .drawer-toggle').tap();
    if (!await page.locator('#ri_root').isVisible()) await page.locator('#ri_drawer .inline-drawer-header').first().tap();
    const full = page.locator('#ri_root [aria-label="Full screen"]');
    if (await full.count()) await full.first().tap();
    await page.waitForSelector('.ri-shell-head', { timeout: 15000 });
    return { page, errors };
}

/** Visible text elements under the menu whose computed size is under 12 px, and controls with a rounded corner. */
const scan = page => page.evaluate(() => {
    const root = document.querySelector('#ri_root');
    const small = [], round = [];
    const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
    for (const node of root.querySelectorAll('*')) {
        if (!visible(node)) continue;
        const style = getComputedStyle(node);
        const own = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
        if (own && parseFloat(style.fontSize) < 11.99) small.push(`${node.tagName.toLowerCase()}.${node.className} ${style.fontSize} "${node.textContent.trim().slice(0, 24)}"`);
        if (node.matches('button, input, select, textarea, summary, .ri-card, .ri-section, .ri-chip, .ri-note, .ri-switch') && !node.matches('input[type=checkbox], input[type=radio], input[type=range]') && !node.closest('.ri-tray, .ri-reply-stack, .ri-under')) {
            const radius = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map(k => parseFloat(style[k]));
            if (radius.some(value => value > 0)) round.push(`${node.tagName.toLowerCase()}.${node.className} ${radius.join('/')}`);
        }
    }
    return { small, round };
});

async function visitPages(page) {
    const pages = [];
    const tops = await page.$$eval('[data-ri-tab]', nodes => nodes.map(node => node.dataset.riTab));
    for (const top of tops) {
        await page.locator(`[data-ri-tab="${top}"]`).first().tap();
        await page.waitForTimeout(150);
        const nested = await page.$$eval('[data-ri-nested]', nodes => nodes.map(node => node.dataset.riNested));
        for (const id of nested) {
            await page.locator(`[data-ri-nested="${id}"]`).first().tap();
            await page.waitForTimeout(200);
            pages.push({ top, id, ...(await scan(page)) });
        }
    }
    return pages;
}

const states = page => page.evaluate(() => {
    const css = (node, key) => node && getComputedStyle(node)[key];
    const switches = [...document.querySelectorAll('#ri_root .ri-switch')];
    const on = switches.find(node => node.getAttribute('aria-checked') === 'true');
    const off = switches.find(node => node.getAttribute('aria-checked') === 'false');
    const tab = document.querySelector('.ri-shell-subtab[aria-current="page"]');
    const button = document.querySelector('#ri_root .ri-btn');
    return {
        switches: switches.length,
        onBorder: css(on, 'borderTopColor'), offBorder: css(off, 'borderTopColor'),
        onKnob: on && getComputedStyle(on.firstElementChild).transform, offKnob: off && getComputedStyle(off.firstElementChild).transform,
        tabUnderline: tab && [css(tab, 'borderBottomWidth'), css(tab, 'borderBottomStyle'), css(tab, 'boxShadow')].join(' '),
        buttonTransition: css(button, 'transitionDuration'), buttonBorderStyle: css(button, 'borderTopStyle'),
    };
});

async function run(browser, viewport, tag) {
    const { page, errors } = await boot(browser, viewport);
    const out = { tag, viewport, shots: [], checks: {} };
    results.runs.push(out);
    const shot = async name => { const file = `${tag}-${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); out.shots.push(file); };

    const visited = await visitPages(page);
    out.checks.pages = visited.length;
    out.checks.small = visited.flatMap(item => item.small.map(text => `${item.top}/${item.id}: ${text}`));
    out.checks.round = visited.flatMap(item => item.round.map(text => `${item.top}/${item.id}: ${text}`));

    // The Features page carries switches, buttons, chips and notes; it is the page repeated under each preference.
    await page.locator('[data-ri-tab="setup"]').first().tap();
    await page.locator('[data-ri-nested="features"]').first().tap();
    await page.waitForTimeout(300);
    await shot('1-features-default');
    out.checks.default = await states(page);

    // Focus ring: Tab onto a control and read its outline.
    await page.evaluate(() => document.querySelector('#ri_root .ri-btn, #ri_root .ri-switch')?.focus());
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    out.checks.focus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return { outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, offset: style.outlineOffset, tag: document.activeElement.tagName }; });
    await shot('2-focus');

    for (const [name, media] of [['reduced-motion', { reducedMotion: 'reduce' }], ['more-contrast', { contrast: 'more' }], ['forced-colors', { forcedColors: 'active' }]]) {
        await page.emulateMedia({ colorScheme: 'dark', ...media });
        await page.waitForTimeout(250);
        out.checks[name] = await states(page);
        await shot(`3-${name}`);
        await page.locator('[data-ri-tab="story"]').first().tap();
        await page.waitForTimeout(250);
        await shot(`4-${name}-story`);
        await page.locator('[data-ri-tab="setup"]').first().tap();
        await page.waitForTimeout(250);
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: null, contrast: null, forcedColors: null });

    assert.deepEqual(out.checks.small, [], 'no text under 12 px at the default scale');
    assert.deepEqual(out.checks.round, [], 'controls and cards have zero radius');
    assert.match(out.checks.focus.outline, /^2px solid rgb\(185, 140, 255\)/, 'the focus ring is the 2 px violet ring');
    assert.ok(out.checks.default.switches > 0, 'the Features page has switches');
    for (const name of ['default', 'reduced-motion', 'more-contrast', 'forced-colors']) {
        const state = out.checks[name];
        assert.notEqual(state.onKnob, state.offKnob, `${name}: the switch knob moves with the state`);
        assert.ok(/^[2-9]px solid/.test(state.tabUnderline || "") || /-2px 0px 0px inset/.test(state.tabUnderline || ""), `${name}: the selected tab keeps an underline (${state.tabUnderline})`);
    }
    assert.notEqual(out.checks.default.onBorder, out.checks.default.offBorder, 'an on switch has its own edge color');
    assert.match(out.checks['reduced-motion'].buttonTransition, /^0s/, 'reduced motion makes state changes instant');
    assert.equal(out.checks.default.buttonTransition.split(',')[0].trim(), '0.06s', 'state changes step in 60 ms');
    out.errors = errors;
    assert.deepEqual(errors, []);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, { width: 523, height: 1021 }, 'w523');
        await run(browser, { width: 1006, height: 909 }, 'w1006');
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
        await browser.close();
    }
    console.log('components pass: passed');
})().catch(error => { console.error(error); process.exit(1); });
