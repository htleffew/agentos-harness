// B61 browser suite: the Suggest with a model button in the story style pickers, on a real SillyTavern 1.19 host at 360 px.
//   1. Opening a chat, the Story style page and the tray picker send no request.
//   2. On Setup, Look, Story style: the button fits at 360 px under the style list (no sideways scroll, the list's own
//      columns unchanged), one tap sends one request carrying the four ids and the card text, the answer shows as a
//      suggestion, the chat's style is unchanged until Use is tapped, and Use changes it.
//   3. The mock answering an unknown id: nothing changes and the note says the model gave no usable answer.
//   4. The tray picker carries the same button and the same one-request behavior.
//   5. At the ceiling with only a paid route, the button sends nothing, shows the ceiling line and leaves the word-matching
//      suggestion (the pending chip) as it was.
// The paid route is a Connection Profile at the mock's IPv4-mapped IPv6 address, billed as a paid provider. No real model.
// Run with the host variables of tests/README.md. Evidence goes to RI_EVIDENCE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const WIDTH = Number(process.env.RI_WIDTH || 360);
const port = Number(process.env.RI_MOCK_PORT || 8124);
const PAID_URL = `http://[::ffff:127.0.0.1]:${port}/v1`;
const PAID_MODEL = 'b61-paid-model';
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B61');
fs.mkdirSync(dir, { recursive: true });
const out = { width: WIDTH, checks: {} };
const styleRows = () => L.requests('all').filter(row => /You choose how the story cards of a roleplay look/.test(L.text(row)));
const paidRows = () => L.requests('all').filter(row => row.model === PAID_MODEL || /b61-paid-model/.test(String(row.body || '')));

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: 780, hasTouch: true, isMobile: true });
    const imp = (file, fn, arg) => page.evaluate(async ({ B, file, fn, arg }) => { const value = (await import(`${B}/src/${file}`))[fn]; return typeof value === 'function' ? value(arg) : value; }, { B, file, fn, arg });
    const chatStyle = () => imp('story-style.js', 'chatStoryStyle');
    const tap = async locator => { await locator.scrollIntoViewIfNeeded(); await locator.tap(); await page.waitForTimeout(400); };
    const note = async () => (await page.locator('#ri-style-model-note').first().innerText().catch(() => '')).trim();
    const waitNote = async re => { await page.waitForFunction(re => new RegExp(re).test(document.querySelector('#ri-style-model-note')?.textContent || ''), re.source, { timeout: 30000 }); return note(); };
    try {
        await L.setupApi(page);
        await page.evaluate(async B => { const S = await import(`${B}/src/store.js`); S.settings().enabled = true; S.saveSettings(); globalThis.jQuery('#world_info').val([]).trigger('change'); }, B);
        await L.openChat(page);
        await page.evaluate(async B => {
            const host = SillyTavern.getContext();
            const card = host.characters[host.characterId];
            card.description = 'Detective Hale works the night shift at the precinct in 1940s Port Alder. Rain-slick streets and a speakeasy.';
            (await import(`${B}/src/v10.js`)).prefs().enabled = true;
            await (await import(`${B}/src/store.js`)).saveChatState();
        }, B);
        await page.evaluate(async B => {
            const cs = (await import(`${B}/src/store.js`)).chatState();
            cs.storyStyleSuggestion = { style: 'noir', state: 'pending' };
            (await import(`${B}/src/store.js`)).saveChatState();
        }, B);
        await page.waitForTimeout(1500);

        // 1. No request from a chat load, the page opening or the picker opening.
        await L.openPanel(page, 'look-story-style');
        await page.waitForSelector('#ri-story-style .ri-style-sample', { timeout: 10000 });
        await page.waitForTimeout(800);
        assert.equal(styleRows().length, 0, 'no style request when the chat loads or the page opens');
        out.checks.noRequestOnOpen = true;

        // 2. The button fits at 360 px under the list.
        const fit = await page.evaluate(() => {
            const page = document.querySelector('#ri-story-style');
            const grids = [...page.querySelectorAll('.ri-style-grid')];
            const thisChat = grids[1];
            const btn = page.querySelector('#ri-style-ask-model').getBoundingClientRect();
            const grid = thisChat.getBoundingClientRect();
            const cols = getComputedStyle(thisChat).gridTemplateColumns.split(' ').length;
            return { btnTop: btn.top, btnLeft: btn.left, btnRight: btn.right, gridBottom: grid.bottom, cols, vw: document.documentElement.clientWidth,
                scrollW: document.documentElement.scrollWidth, count: page.querySelectorAll('#ri-style-ask-model').length, text: page.querySelector('#ri-style-ask-model').textContent };
        });
        out.checks.fit = fit;
        assert.equal(fit.count, 1, 'one button on the page (the This chat picker)');
        assert.match(fit.text, /Suggest with a model/);
        assert.ok(fit.btnTop >= fit.gridBottom - 1, 'the button sits under the style list');
        assert.ok(fit.btnLeft >= 0 && fit.btnRight <= fit.vw, 'the button is inside the screen');
        assert.ok(fit.scrollW <= fit.vw, `no sideways scroll (${fit.scrollW} of ${fit.vw})`);
        await page.screenshot({ path: path.join(dir, `page-before-${WIDTH}.png`) });

        L.mode({ reply: 'scifi' });
        L.resetLog();
        const before = await chatStyle();
        await tap(page.locator('#ri-style-ask-model'));
        const shown = await waitNote(/A model suggests Sci-fi readout/);
        assert.equal(styleRows().length, 1, 'one tap sends one request');
        const row = styleRows()[0];
        for (const id of ['parchment', 'noir', 'scifi', 'modern']) assert.ok(L.text(row).includes(`${id}: `), `the request names ${id}`);
        assert.match(L.text(row), /1940s Port Alder/, 'the request carries the card text');
        assert.equal(await chatStyle(), before, 'the chat style is unchanged until she applies it');
        assert.ok(await page.locator('#ri-style-use-model').isVisible(), 'a Use button appears');
        out.checks.suggested = shown;
        await page.screenshot({ path: path.join(dir, `page-suggested-${WIDTH}.png`) });
        await tap(page.locator('#ri-style-use-model'));
        assert.equal(await chatStyle(), 'scifi', 'Use applies the suggestion to this chat');
        assert.equal(styleRows().length, 1, 'applying sent nothing');

        // 3. An unknown id changes nothing.
        L.mode({ reply: 'steampunk' });
        await page.waitForSelector('#ri-style-ask-model');
        await tap(page.locator('#ri-style-ask-model'));
        const unusable = await waitNote(/The model gave no usable answer/);
        assert.equal(styleRows().length, 2);
        assert.equal(await chatStyle(), 'scifi', 'the choice is unchanged');
        assert.equal(await page.locator('#ri-style-use-model').count(), 0, 'no Use button for an unusable answer');
        out.checks.unusable = unusable;
        await page.screenshot({ path: path.join(dir, `page-unusable-${WIDTH}.png`) });

        // 4. The tray picker. Clear the choice, send a reply, open the picker from the chip or the Expanded header.
        await page.evaluate(async B => { (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false); const S = await import(`${B}/src/story-style.js`); S.setChatStoryStyle(''); const cs = (await import(`${B}/src/store.js`)).chatState(); cs.storyStyleSuggestion = { style: 'noir', state: 'pending' }; (await import(`${B}/src/store.js`)).saveChatState(); S.clearModelSuggestion(); }, B);
        L.mode({ reply: 'The door is open.' });
        await L.send(page, 'I follow her to the door.');
        const tray = '#chat .last_mes .ri-tray:not(.ri-tray-loading)';
        await page.waitForSelector(tray, { timeout: 30000 });
        await page.waitForTimeout(900);
        L.resetLog();
        const chip = page.locator(`${tray} .ri-tray-style-chip`);
        const open = page.locator(`${tray} .ri-tray-style-open`);
        if (await open.count()) await tap(open); else await tap(chip);
        await page.waitForSelector(`${tray} #ri-style-ask-model`, { timeout: 8000 });
        assert.equal(styleRows().length, 0, 'opening the tray picker sends nothing');
        L.mode({ reply: 'parchment' });
        await tap(page.locator(`${tray} #ri-style-ask-model`));
        await page.waitForFunction(sel => /A model suggests Parchment/.test(document.querySelector(`${sel} #ri-style-model-note`)?.textContent || ''), tray, { timeout: 30000 });
        assert.equal(styleRows().length, 1, 'the tray picker sends one request');
        assert.equal(await chatStyle(), '', 'nothing applied yet');
        await page.screenshot({ path: path.join(dir, `tray-suggested-${WIDTH}.png`) });
        await tap(page.locator(`${tray} #ri-style-use-model`));
        assert.equal(await chatStyle(), 'parchment', 'Use in the tray applies it');
        out.checks.tray = true;

        // 5. The ceiling with only a paid route.
        await page.evaluate(async ({ B, url, model }) => {
            const c = SillyTavern.getContext();
            const cm = c.extensionSettings.connectionManager ||= { profiles: [] };
            cm.profiles = [{ id: 'p-paid', name: 'Paid test profile', api: 'custom', model, 'api-url': url, preset: 'Default' }];
            const R = await import(`${B}/src/routing.js`);
            const Sp = await import(`${B}/src/spend.js`);
            Sp.setSpendLimits({ ceiling: 0, warning: 0 });
            R.setJobChain('capture', [{ route: 'override', profileId: 'p-paid', price: { in: 2, out: 2 } }]);
            R.resetRouteHealth();
            const S = await import(`${B}/src/story-style.js`);
            S.setChatStoryStyle('');
            const cs = (await import(`${B}/src/store.js`)).chatState();
            cs.storyStyleSuggestion = { style: 'noir', state: 'pending' };
            (await import(`${B}/src/store.js`)).saveChatState();
            S.clearModelSuggestion();
        }, { B, url: PAID_URL, model: PAID_MODEL });
        const ceiling = await imp('spend.js', 'CEILING_LINE');
        await L.openPanel(page, 'look-story-style');
        await page.waitForSelector('#ri-style-ask-model', { timeout: 10000 });
        const rowsBefore = L.requests('all').length;
        await tap(page.locator('#ri-style-ask-model'));
        const line = await waitNote(/monthly spend ceiling is reached/);
        assert.equal(line, ceiling, 'the note is the ceiling line');
        assert.equal(paidRows().length, 0, 'no paid request reached the mock');
        assert.equal(L.requests('all').length, rowsBefore, 'no request of any kind left');
        assert.equal(await imp('story-style.js', 'pendingSuggestion'), 'noir', 'the word-matching suggestion is kept');
        assert.equal(await chatStyle(), '', 'the style is unchanged');
        await page.screenshot({ path: path.join(dir, `page-ceiling-${WIDTH}.png`) });
        out.checks.ceiling = line;

        out.checks.errors = errors.filter(e => !/net::ERR|status of 5\d\d|Failed to fetch/.test(e));
        assert.deepEqual(out.checks.errors, [], 'no page errors');
        console.log('PASS t_story_style_model_host');
    } catch (error) {
        console.error('FAIL', error.stack || error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, `story-style-model-host-${WIDTH}.json`), JSON.stringify(out, null, 2));
        await browser.close();
    }
})();
