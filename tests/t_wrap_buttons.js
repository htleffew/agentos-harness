// B42 touch pass: the three wrap buttons on the composer bar. Runs on a real SillyTavern 1.19.0 host at 390 x 780
// (phone, touch) and 1006 x 909 (inner screen, touch). Checks the buttons' size and names, the pair inserted at the
// cursor, a selection wrapped, the cursor after each, that the message box never loses focus (no blur event while a
// button is tapped) and that SillyTavern sees every change as an input event. Also the switches and press and hold.
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed (default http://127.0.0.1:8251)
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_PROFILE       Chrome profile folder (default C:\pw-b42)
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8251';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B42');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.RI_PROFILE || 'C:\\pw-b42';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

async function boot(viewport) {
    const context = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME, headless: true, viewport, deviceScaleFactor: 2.0625, hasTouch: true,
        isMobile: viewport.width < 1000, colorScheme: 'dark',
    });
    const page = context.pages()[0] || await context.newPage();
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
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin', { state: 'attached', timeout: 30000 });
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.setBarFolded(false);
        if (Q.hasChatBar()) Q.useChatBar(false);
        const { saveInlineSettings } = await import(`${BASE}/src/inline-direction.js`);
        saveInlineSettings({ marker: true, ooc: true, italic: true, quote: true });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForTimeout(800);
    return { context, page, errors };
}

const rect = (page, selector) => page.evaluate(sel => {
    const node = document.querySelector(sel);
    if (!node || !node.getClientRects().length) return null;
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, w: box.width, h: box.height };
}, selector);

async function tap(page, selector) {
    const box = await rect(page, selector);
    assert.ok(box, `${selector} is on screen`);
    await page.touchscreen.tap(box.x + box.w / 2, box.y + box.h / 2);
    await page.waitForTimeout(200);
    return box;
}

/** Press and hold with real touch events, which the tap helper cannot do. */
async function hold(page, selector, ms = 700) {
    const box = await rect(page, selector);
    assert.ok(box, `${selector} is on screen`);
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.w / 2, y: box.y + box.h / 2, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.waitForTimeout(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(250);
}

const wrapSel = id => `#ri_composer_bar .ri-bar-wrap[data-wrap="${id}"]`;
const setBox = (page, text, start, end = start, focus = true) => page.evaluate(({ text, start, end, focus }) => {
    const box = document.querySelector('#send_textarea');
    box.value = text;
    if (focus) box.focus({ preventScroll: true });
    box.setSelectionRange(start, end);
}, { text, start, end, focus });
const readBox = page => page.evaluate(() => {
    const box = document.querySelector('#send_textarea');
    return { text: box.value, start: box.selectionStart, end: box.selectionEnd, focused: document.activeElement === box,
        jq: globalThis.jQuery('#send_textarea').val() };
});
/** Count blur and input events on the box so a tap that steals focus, or hides a change from SillyTavern, is caught. */
const watchBox = page => page.evaluate(() => {
    const box = document.querySelector('#send_textarea');
    globalThis.__box = { blur: 0, input: 0 };
    if (!globalThis.__boxWatched) {
        globalThis.__boxWatched = true;
        box.addEventListener('blur', () => { globalThis.__box.blur++; });
        box.addEventListener('input', () => { globalThis.__box.input++; });
    }
});
const counts = page => page.evaluate(() => ({ ...globalThis.__box }));

async function runAt(viewport, label, steps) {
    const { context, page, errors } = await boot(viewport);
    const run = { label, viewport, checks: {}, shots: [] };
    results.runs.push(run);
    try {
        for (const step of steps) await step(page, run);
        assert.deepEqual(errors, [], 'no page errors');
    } finally {
        await context.close();
    }
}
const shot = async (page, run, name) => {
    await page.screenshot({ path: path.join(OUT, `${run.label}-${name}.png`) });
    run.shots.push(`${run.label}-${name}.png`);
};

/** The buttons: three, named, a real touch target, inside the viewport, drawn as icons. */
async function checkButtons(page, run) {
    const info = await page.evaluate(() => {
        const bar = document.querySelector('#ri_composer_bar').getBoundingClientRect();
        const hit = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ri-hit-size')) || 0;
        return {
            bar: { x: bar.x, right: bar.right, w: bar.width },
            viewport: innerWidth,
            hit,
            buttons: [...document.querySelectorAll('#ri_composer_bar .ri-bar-wrap')].map(node => {
                const box = node.getBoundingClientRect();
                return { wrap: node.dataset.wrap, label: node.getAttribute('aria-label'), title: node.title, w: box.width, h: box.height,
                    left: box.left, right: box.right, icon: node.querySelector('i')?.className, text: node.textContent.trim() };
            }),
            row: [...document.querySelectorAll('#ri_composer_bar .ri-bar-row > *')].map(node => node.className.split(' ')[0]),
        };
    });
    run.checks.buttons = info;
    assert.deepEqual(info.buttons.map(item => item.wrap), ['ooc', 'italic', 'quote']);
    assert.deepEqual(info.buttons.map(item => item.title), ['[[OOC: ]]', '* *', '" "']);
    for (const item of info.buttons) {
        assert.ok(item.w >= 24 && item.h >= 24, `${item.wrap} is at least 24 px (${item.w} x ${item.h})`);
        assert.ok(item.left >= 0 && item.right <= info.viewport, `${item.wrap} is inside the viewport`);
        assert.match(item.icon, /fa-solid fa-/, `${item.wrap} is an icon`);
        assert.equal(item.text, '', `${item.wrap} has no text or emoji`);
        assert.match(item.label, /\[\[OOC: \]\]|\* \*|" "/);
    }
    assert.ok(info.buttons.at(-1).right <= info.bar.right, 'buttons stay inside the bar');
    await shot(page, run, 'bar');
}

/** A tap with no selection, then with a selection, for each button: text, cursor, focus and input events. */
async function checkWrapping(page, run) {
    await watchBox(page);
    const cases = [
        { id: 'ooc', open: '[[OOC: ', close: ']]' },
        { id: 'italic', open: '*', close: '*' },
        { id: 'quote', open: '"', close: '"' },
    ];
    run.checks.wrapping = {};
    for (const wrap of cases) {
        // No selection: the pair at the cursor, the cursor between the marks.
        await setBox(page, 'I say hello now', 5);
        await page.evaluate(() => { globalThis.__box = { blur: 0, input: 0 }; });
        await tap(page, wrapSel(wrap.id));
        let box = await readBox(page);
        const counted = await counts(page);
        assert.equal(box.text, 'I say' + wrap.open + wrap.close + ' hello now', `${wrap.id} pair`);
        assert.equal(box.start, 5 + wrap.open.length, `${wrap.id} cursor between the marks`);
        assert.equal(box.end, box.start);
        assert.equal(box.focused, true, `${wrap.id} keeps the message box focused`);
        assert.equal(counted.blur, 0, `${wrap.id} never blurs the message box`);
        assert.ok(counted.input >= 1, `${wrap.id} tells SillyTavern the text changed`);
        assert.equal(box.jq, box.text, 'SillyTavern reads the new text');
        // Typing continues at the cursor, between the marks.
        await page.keyboard.type('X');
        box = await readBox(page);
        assert.equal(box.text, 'I say' + wrap.open + 'X' + wrap.close + ' hello now', `${wrap.id} typing lands between the marks`);
        // A selection: wrapped, the cursor after the closing mark.
        await setBox(page, 'I say hello now', 6, 11);
        await page.evaluate(() => { globalThis.__box = { blur: 0, input: 0 }; });
        await tap(page, wrapSel(wrap.id));
        box = await readBox(page);
        const counted2 = await counts(page);
        assert.equal(box.text, 'I say ' + wrap.open + 'hello' + wrap.close + ' now', `${wrap.id} wraps the selection`);
        assert.equal(box.start, 6 + wrap.open.length + 5 + wrap.close.length, `${wrap.id} cursor after the closing mark`);
        assert.equal(box.end, box.start);
        assert.equal(box.focused, true);
        assert.equal(counted2.blur, 0);
        run.checks.wrapping[wrap.id] = { empty: { ...counted }, selection: { ...counted2 }, final: box.text };
    }
    // The first tap while the box has no focus focuses it and still places the pair.
    await setBox(page, 'cold', 4, 4, false);
    await page.evaluate(() => document.activeElement?.blur?.());
    await tap(page, wrapSel('quote'));
    const cold = await readBox(page);
    assert.equal(cold.text, 'cold""');
    assert.equal(cold.start, 5);
    assert.equal(cold.focused, true);
    run.checks.wrapping.fromBlurred = cold;
    // Undo is not broken: a second input event stream still works after the wrap.
    await setBox(page, '', 0);
    await tap(page, wrapSel('ooc'));
    await shot(page, run, 'wrap-ooc-empty');
    await page.keyboard.type('keep it quiet');
    await shot(page, run, 'wrap-ooc-typed');
    await setBox(page, '', 0);
    await page.evaluate(() => globalThis.jQuery('#send_textarea').val('').trigger('input'));
}

/** The switches: each button has its own Off, the OOC button follows the marker, press and hold hides one. */
async function checkSwitches(page, run) {
    const shown = () => page.evaluate(() => [...document.querySelectorAll('#ri_composer_bar .ri-bar-wrap')].map(node => node.dataset.wrap));
    const setting = patch => page.evaluate(async ({ BASE, patch }) => {
        (await import(`${BASE}/src/inline-direction.js`)).saveInlineSettings(patch);
        document.dispatchEvent(new Event('ri-look-change'));
    }, { BASE, patch });
    run.checks.switches = {};
    await setting({ italic: false });
    await page.waitForTimeout(150);
    run.checks.switches.italicOff = await shown();
    assert.deepEqual(run.checks.switches.italicOff, ['ooc', 'quote']);
    await setting({ italic: true, marker: false });
    await page.waitForTimeout(150);
    run.checks.switches.markerOff = await shown();
    assert.deepEqual(run.checks.switches.markerOff, ['italic', 'quote']);
    await setting({ marker: true, ooc: false, quote: false });
    await page.waitForTimeout(150);
    assert.deepEqual(await shown(), ['italic']);
    await setting({ ooc: false, italic: false, quote: false });
    await page.waitForTimeout(150);
    run.checks.switches.allOff = await shown();
    assert.deepEqual(run.checks.switches.allOff, []);
    assert.equal(await page.evaluate(() => !!document.querySelector('#ri_composer_bar .ri-bar-wraps')), false);
    await setting({ ooc: true, italic: true, quote: true });
    await page.waitForTimeout(150);
    assert.deepEqual(await shown(), ['ooc', 'italic', 'quote']);
    // Press and hold opens a popover with Hide; Hide turns that one button off and saves the setting.
    await hold(page, wrapSel('quote'));
    const pop = await page.evaluate(() => ({ text: document.querySelector('.ri-bar-pop')?.textContent || '',
        buttons: [...document.querySelectorAll('.ri-bar-pop button')].map(node => node.textContent.trim()) }));
    run.checks.switches.hold = pop;
    assert.ok(pop.buttons.includes('Hide'), 'the popover offers Hide');
    assert.equal((await readBox(page)).text, '', 'a hold wraps nothing');
    await shot(page, run, 'hold-popover');
    await page.evaluate(() => [...document.querySelectorAll('.ri-bar-pop button')].find(node => node.textContent.trim() === 'Hide').click());
    await page.waitForTimeout(250);
    assert.deepEqual(await shown(), ['ooc', 'italic']);
    assert.equal(await page.evaluate(async BASE => (await import(`${BASE}/src/inline-direction.js`)).inlineSettings().quote, BASE), false);
    await setting({ quote: true });
    await page.waitForTimeout(150);
}

/** The Direction page lists the marker and the three buttons, each with On and Off. */
async function checkPage(page, run) {
    const text = await page.evaluate(async BASE => {
        const { renderInlineNotesPage } = await import(`${BASE}/src/ui/inline-direction.js`);
        const body = document.createElement('div');
        document.body.append(body);
        renderInlineNotesPage(body);
        const rows = [...body.querySelectorAll('.ri-field')].map(field => ({ label: field.querySelector('.ri-label')?.textContent,
            options: [...field.querySelectorAll('option')].map(option => option.textContent), value: field.querySelector('select')?.value }));
        body.remove();
        return rows;
    }, BASE);
    run.checks.page = text;
    assert.deepEqual(text.map(row => row.label), ['Notes in [[OOC: ]]', '[[OOC: ]]', '* *', '" "']);
    for (const row of text) assert.deepEqual(row.options, ['On', 'Off']);
    const registered = await page.evaluate(async BASE => (await import(`${BASE}/src/ui/page-registry.js`)).registeredPage('inline-notes'), BASE);
    assert.ok(registered, 'the page is registered in Direction');
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await runAt({ width: 390, height: 780 }, 'w390', [checkButtons, checkWrapping, checkSwitches, checkPage]);
    await runAt({ width: 1006, height: 909 }, 'w1006', [checkButtons, checkWrapping, checkSwitches]);
    fs.writeFileSync(path.join(OUT, 'results-wrap-buttons.json'), JSON.stringify(results, null, 2));
    console.log('B42 wrap buttons passed');
})().catch(error => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'results-wrap-buttons.json'), JSON.stringify({ ...results, failure: error.stack }, null, 2));
    console.error(error);
    process.exit(1);
});
