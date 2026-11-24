// B2 touch pass: Options results, titled options, the results cache and the queue sheet on a real
// SillyTavern 1.19.0 host with a mock model and request recorder. Runs at 523 x 1021 (cover screen,
// SillyTavern's mobile layout), 1006 x 909 (inner screen, desktop layout) and 390 x 780, with touch.
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed (default http://127.0.0.1:8153)
//   RI_MOCK_LOG      the recorder's JSON lines file
//   RI_MOCK_DIR      folder of the mock, where delay.txt (ms) and mode.txt ("leaks") steer its answers
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_PROFILE       Chrome profile folder (default C:\pw-b2)
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8153';
const LOG = process.env.RI_MOCK_LOG;
const MOCK_DIR = process.env.RI_MOCK_DIR || (LOG ? path.dirname(LOG) : '');
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B2');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.RI_PROFILE || 'C:\\pw-b2';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

// Background memory calls (capture, chapter, condensed) follow each reply and are not counted; tests/mock.js tags every row with a kind.
const rows = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => !['capture', 'chapter', 'condensed'].includes(row.kind)) : []);
const modelRequests = () => rows().filter(row => !row.url.includes('models'));
const requestCount = () => modelRequests().length;
const since = start => modelRequests().slice(start);
const mock = (name, value) => { if (MOCK_DIR) fs.writeFileSync(path.join(MOCK_DIR, name), String(value)); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function boot(viewport) {
    const context = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME, headless: true, viewport, deviceScaleFactor: 2.0625, hasTouch: true,
        isMobile: viewport.width < 1000, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'],
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
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus && SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin', { state: 'attached', timeout: 30000 });
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.setBarFolded(false);
        Q.saveQuickAction({ id: 'builtin:options:npc', set: '', count: 4, length: 'medium' });
        (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ sheetHeight: 40, text: 'compact', textScale: 100 });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForTimeout(800);
    return { context, page, errors };
}

const rect = (page, selector) => page.evaluate(sel => {
    const node = document.querySelector(sel);
    if (!node || !node.getClientRects().length) return null;
    const box = node.getBoundingClientRect();
    return { x: Math.round(box.x * 10) / 10, y: Math.round(box.y * 10) / 10, w: Math.round(box.width * 10) / 10, h: Math.round(box.height * 10) / 10 };
}, selector);

async function tap(page, selector) {
    const box = await rect(page, selector);
    if (!box) await page.screenshot({ path: path.join(OUT, 'failure.png') });
    assert.ok(box, `${selector} is on screen`);
    await page.touchscreen.tap(box.x + box.w / 2, box.y + Math.min(box.h / 2, 12));
    await page.waitForTimeout(250);
    return box;
}

const tapPin = (page, kind) => tap(page, `#ri_composer_bar .ri-bar-pin[data-kind="${kind}"]`);
const shot = async (page, run, name) => {
    await page.screenshot({ path: path.join(OUT, `${run.label}-${name}.png`) });
    run.shots.push(`${run.label}-${name}.png`);
};
const closeSheet = page => page.evaluate(() => document.querySelector('.ri-gsheet [data-ri-close]')?.click()).then(() => page.waitForTimeout(250));
const composer = page => page.evaluate(() => {
    const box = document.querySelector('#send_textarea');
    return { text: box.value, start: box.selectionStart, end: box.selectionEnd };
});
const setDraft = (page, text, at) => page.evaluate(({ text, at }) => {
    const box = document.querySelector('#send_textarea');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.setSelectionRange(at, at);
    box.blur();
}, { text, at });

/** Everything 4.4 asks of the sheet with results: size, roles, scrolling and the per-card buttons. */
const resultsState = page => page.evaluate(() => {
    const sheet = document.querySelector('.ri-gsheet');
    if (!sheet) return null;
    const body = sheet.querySelector('.ri-gsheet-body');
    const cards = [...sheet.querySelectorAll('.ri-option-card')];
    const px = (node, prop = 'fontSize') => node ? parseFloat(getComputedStyle(node)[prop]) : null;
    const box = sheet.getBoundingClientRect();
    return {
        heightPct: Math.round(box.height / visualViewport.height * 1000) / 10, top: Math.round(box.top), bottom: Math.round(box.bottom),
        scrolls: body.scrollHeight > body.clientHeight + 1, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
        header: [...sheet.querySelectorAll('.ri-results-head > *')].map(node => node.textContent.trim()),
        againAmber: !!sheet.querySelector('.ri-results-head .ri-cost-chip .ri-bar-dot'),
        cards: cards.map(card => ({
            title: card.querySelector('.ri-option-title')?.textContent, incomplete: card.dataset.incomplete === 'true',
            note: card.querySelector('.ri-option-note')?.textContent || '', body: card.querySelector('.ri-option-body')?.textContent || '',
            buttons: [...card.querySelectorAll('button')].map(button => ({ label: button.textContent.trim(), disabled: button.disabled })),
            titlePx: px(card.querySelector('.ri-option-title')), bodyPx: px(card.querySelector('.ri-option-body')),
        })),
        // The type roles' resolved sizes, read from a probe that takes each token as its font size.
        tokens: Object.fromEntries(['label', 'body'].map(role => {
            const probe = document.createElement('span');
            probe.style.fontSize = `var(--ri-type-${role})`;
            sheet.append(probe);
            const size = parseFloat(getComputedStyle(probe).fontSize);
            probe.remove();
            return [role, size];
        })),
        boxHidden: getComputedStyle(sheet.querySelector('.ri-gsheet-box')).display === 'none',
    };
});

async function generate(page) {
    await tap(page, '.ri-gsheet [data-ri-generate]');
}

async function runOptions(page, run) {
    mock('delay.txt', 900);
    mock('mode.txt', '');
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/results-sheet.js`)).clearOptionsCache(), BASE);
    const draft = 'Half a thought';
    await setDraft(page, draft, 5);

    // Tap then Generate: header shows "0 of 4" and Cancel while the request runs.
    let start = requestCount();
    await tapPin(page, 'options');
    const tapRequests = requestCount() - start;
    await page.fill('.ri-gsheet .ri-gsheet-box', 'Someone from the harbor');
    await generate(page);
    const running = await page.evaluate(() => ({
        header: [...document.querySelectorAll('.ri-gsheet .ri-results-head > *')].map(node => node.textContent.trim()),
        cancel: !!document.querySelector('.ri-gsheet [data-ri-cancel]'),
    }));
    await shot(page, run, 'options-running');
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    await page.waitForTimeout(300);
    const shown = await resultsState(page);
    await shot(page, run, 'options-results');
    const sent = since(start);
    run.checks.request = {
        tapRequests, requests: sent.length,
        titledFormat: sent[0]?.body.includes('distinct objects') && sent[0]?.body.includes('\\"title\\"'),
        lengthSentence: sent[0]?.body.includes('four to six sentences'),
        typedInSameRequest: sent[0]?.body.includes('Someone from the harbor'),
    };
    run.checks.running = running;
    run.checks.results = shown;
    assert.equal(tapRequests, 0);
    assert.equal(sent.length, 1);
    assert.ok(run.checks.request.titledFormat && run.checks.request.lengthSentence && run.checks.request.typedInSameRequest);
    assert.deepEqual(running.header, ['0 of 4', 'Cancel']);
    assert.equal(shown.cards.length, 4);
    assert.ok(shown.cards.every(card => card.title && card.body && card.buttons.map(b => b.label).join() === 'Copy,Insert,Send'));
    assert.ok(shown.againAmber, 'Generate again carries the amber dot');
    assert.ok(Math.abs(shown.heightPct - 40) < 1.5, `sheet is 40% (${shown.heightPct})`);

    // Tap and drag on a card's text fire nothing.
    let before = await composer(page);
    start = requestCount();
    await tap(page, '.ri-gsheet .ri-option-card .ri-option-body');
    const body = await rect(page, '.ri-gsheet .ri-gsheet-body');
    await page.evaluate(() => { document.querySelector('.ri-gsheet .ri-gsheet-body').scrollTop = 0; });
    const cdp = await page.context().newCDPSession(page);
    const x = body.x + body.w / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: body.y + body.h - 20 }] });
    for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: body.y + body.h - 20 - step * 25 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const afterBodyTouch = { sheetOpen: !!(await page.$('.ri-gsheet')), composer: await composer(page), requests: requestCount() - start,
        scrolledBy: await page.evaluate(() => document.querySelector('.ri-gsheet .ri-gsheet-body')?.scrollTop) };
    run.checks.cardBodyInert = { ...afterBodyTouch, composerUnchanged: afterBodyTouch.composer.text === before.text };
    assert.ok(afterBodyTouch.sheetOpen && run.checks.cardBodyInert.composerUnchanged && afterBodyTouch.requests === 0);

    // Results sheet height follows the slider; text keeps its size at every height.
    run.checks.slider = [];
    for (const height of [25, 40, 55, 75]) {
        await page.evaluate(async ({ BASE, height }) => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ sheetHeight: height }), { BASE, height });
        await page.waitForTimeout(150);
        const state = await resultsState(page);
        run.checks.slider.push({ setting: height, heightPct: state.heightPct, scrolls: state.scrolls,
            titlePx: state.cards[0].titlePx, bodyPx: state.cards[0].bodyPx });
        if (height === 25 || height === 75) await shot(page, run, `options-slider-${height}`);
    }
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/theme/styles.js`)).saveLook({ sheetHeight: 40 }), BASE);
    assert.ok(run.checks.slider.every(row => row.titlePx === run.checks.slider[0].titlePx && row.bodyPx === run.checks.slider[0].bodyPx));

    // Copy says Copied and fills the clipboard.
    await page.evaluate(() => { document.querySelector('.ri-gsheet .ri-gsheet-body').scrollTop = 0; });
    await tap(page, '.ri-gsheet .ri-option-card [data-ri-copy]');
    run.checks.copy = await page.evaluate(async () => ({
        label: document.querySelector('.ri-gsheet .ri-option-card [data-ri-copy]').textContent.trim(),
        clipboard: await navigator.clipboard.readText().catch(error => `unreadable: ${error.message}`),
        expected: document.querySelector('.ri-gsheet .ri-option-card .ri-option-body').textContent,
    }));
    await shot(page, run, 'options-copied');
    assert.equal(run.checks.copy.label, 'Copied');
    assert.equal(run.checks.copy.clipboard, run.checks.copy.expected);

    // Insert puts the second option at the draft's cursor, closes the sheet and sends nothing.
    start = requestCount();
    const second = shown.cards[1].body;
    await page.evaluate(() => document.querySelectorAll('.ri-gsheet .ri-option-card')[1].scrollIntoView({ block: 'center' }));
    await tap(page, '.ri-gsheet .ri-option-card:nth-of-type(2) [data-ri-insert]');
    const inserted = await composer(page);
    const chatLength = await page.evaluate(() => SillyTavern.getContext().chat.length);
    run.checks.insert = { composer: inserted, expected: draft.slice(0, 5) + second + draft.slice(5),
        cursorAfterInsert: inserted.start === 5 + second.length, sheetClosed: !(await page.$('.ri-gsheet')), requests: requestCount() - start };
    await shot(page, run, 'options-inserted');
    assert.equal(inserted.text, run.checks.insert.expected);
    assert.ok(run.checks.insert.cursorAfterInsert && run.checks.insert.sheetClosed && run.checks.insert.requests === 0);

    // Re-tap with a matching cache: the sheet opens on the saved options with zero requests.
    await setDraft(page, draft, 5);
    start = requestCount();
    await tapPin(page, 'options');
    const cached = await resultsState(page);
    run.checks.cache = { cards: cached.cards.length, requests: requestCount() - start, sameTitles: cached.cards.map(card => card.title).join() === shown.cards.map(card => card.title).join() };
    await shot(page, run, 'options-cached');
    assert.equal(run.checks.cache.cards, 4);
    assert.equal(run.checks.cache.requests, 0);

    // Generate again with a slow answer, then Cancel: the four options already shown stay.
    mock('delay.txt', 4000);
    start = requestCount();
    await tap(page, '.ri-gsheet [data-ri-again]');
    await page.waitForTimeout(300);
    const againRunning = await resultsState(page);
    await shot(page, run, 'options-again-running');
    await tap(page, '.ri-gsheet [data-ri-cancel]');
    await page.waitForTimeout(300);
    const afterCancel = await resultsState(page);
    const status = await page.evaluate(() => document.querySelector('.ri-bar-status-button')?.textContent || '');
    await shot(page, run, 'options-cancelled');
    run.checks.cancel = { headerWhileRunning: againRunning.header, cardsWhileRunning: againRunning.cards.length, cardsAfterCancel: afterCancel.cards.length,
        headerAfterCancel: afterCancel.header, status, requestsMade: requestCount() - start };
    assert.deepEqual(againRunning.header, ['0 of 4', 'Cancel']);
    assert.equal(afterCancel.cards.length, 4);
    assert.deepEqual(afterCancel.header, ['Generate again']);
    await sleep(4300);
    mock('delay.txt', 900);

    // Fewer options than fill the sheet: it shrinks to fit.
    await closeSheet(page);
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/quick-actions.js`)).saveQuickAction({ id: 'builtin:options:npc', count: 1 });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await tapPin(page, 'options');
    await generate(page);
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    await page.waitForTimeout(300);
    const one = await resultsState(page);
    run.checks.shrink = { cards: one.cards.length, heightPct: one.heightPct, scrolls: one.scrolls };
    await shot(page, run, 'options-one');
    assert.ok(one.heightPct < 39, 'one option shrinks the sheet');
    await closeSheet(page);

    // A leaky answer: separator fragments never become cards; a title-only leftover is labelled.
    mock('mode.txt', 'leaks');
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/quick-actions.js`)).saveQuickAction({ id: 'builtin:options:npc', count: 4 });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await tapPin(page, 'options');
    await generate(page);
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    await page.waitForTimeout(300);
    const leaks = await resultsState(page);
    await shot(page, run, 'options-incomplete');
    mock('mode.txt', '');
    run.checks.leaks = leaks.cards.map(card => ({ title: card.title, note: card.note, body: card.body.slice(0, 30), disabled: card.buttons.map(b => b.disabled) }));
    assert.equal(leaks.cards.length, 3);
    assert.ok(!leaks.cards.some(card => /^[-*\s]+$/.test(card.body) && card.body));
    const orphan = leaks.cards.find(card => card.title === 'The Orphaned Title');
    assert.ok(orphan && orphan.note === 'Incomplete option' && orphan.buttons.every(button => button.disabled));
    await closeSheet(page);
}

async function runKeyboard(page, run, viewport) {
    // The keyboard resizes the page on the phone (B16): emulate it by shrinking the viewport by 198 px.
    mock('delay.txt', 300);
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/results-sheet.js`)).clearOptionsCache(), BASE);
    await tapPin(page, 'options');
    await generate(page);
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 198 });
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
        const sheet = document.querySelector('.ri-gsheet').getBoundingClientRect();
        const chat = document.querySelector('#chat').getBoundingClientRect();
        const line = parseFloat(getComputedStyle(document.querySelector('#chat .mes_text') || document.querySelector('#chat')).lineHeight);
        const bar = document.querySelector('#ri_composer_bar').getBoundingClientRect();
        const last = [...document.querySelectorAll('#chat .mes[is_user="false"] .mes_text')].pop()?.getBoundingClientRect();
        return { innerHeight, sheetTop: Math.round(sheet.top), sheetBottom: Math.round(sheet.bottom), chatTop: Math.round(chat.top), line,
            barTop: Math.round(bar.top), chatLineVisible: sheet.top - chat.top >= line - 0.5,
            latest: last && { top: Math.round(last.top), bottom: Math.round(last.bottom) },
            latestReplyVisible: !!last && last.bottom > chat.top && last.top < sheet.top };
    });
    run.checks.keyboard = state;
    await shot(page, run, 'keyboard-open');
    await page.setViewportSize(viewport);
    await page.waitForTimeout(300);
    await closeSheet(page);
    state.spacerGoneAfterClose = await page.evaluate(() => !document.querySelector('#chat').classList.contains('ri-results-open'));
    assert.ok(state.spacerGoneAfterClose, 'the chat spacer goes with the sheet');
    assert.ok(state.chatLineVisible, 'one chat line stays above the sheet');
    assert.ok(state.latestReplyVisible, 'the latest reply shows above the sheet');
    assert.ok(state.sheetBottom <= state.barTop + 1, 'the sheet stands on the bar');
    mock('delay.txt', 900);
}

async function runSend(page, run) {
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/results-sheet.js`)).clearOptionsCache(), BASE);
    await tapPin(page, 'options');
    await generate(page);
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
    const draft = 'Keep this draft';
    await setDraft(page, draft, 4);
    const text = await page.evaluate(() => document.querySelector('.ri-gsheet .ri-option-card .ri-option-body').textContent);
    const length = await page.evaluate(() => SillyTavern.getContext().chat.length);
    await tap(page, '.ri-gsheet .ri-option-card [data-ri-send]');
    await page.waitForFunction(n => SillyTavern.getContext().chat.length > n, length, { timeout: 15000 });
    await page.waitForTimeout(500);
    const after = await page.evaluate(n => {
        const chat = SillyTavern.getContext().chat;
        const user = chat.slice(n).find(message => message.is_user);
        const box = document.querySelector('#send_textarea');
        return { sentAsUser: user?.mes, composer: box.value, cursor: box.selectionStart };
    }, length);
    run.checks.send = { sent: after.sentAsUser === text, composerKeepsDraft: after.composer === draft, cursor: after.cursor };
    await page.waitForFunction(() => document.body.dataset.generating !== 'true', null, { timeout: 30000 });
    await page.waitForTimeout(800);
    await shot(page, run, 'options-sent');
    assert.equal(run.checks.send.sent, true);
    assert.equal(run.checks.send.composerKeepsDraft, true);
    // The new reply makes the cached options stale; a re-tap opens the plain sheet.
    const start = requestCount();
    await tapPin(page, 'options');
    run.checks.send.staleAfterNewReply = { cards: await page.locator('.ri-gsheet .ri-option-card').count(), requests: requestCount() - start };
    await closeSheet(page);
    await setDraft(page, '', 0);
}

async function runQueue(page, run) {
    await page.evaluate(async BASE => {
        const C = await import(`${BASE}/src/quick-action-chat.js`);
        for (const entry of [...(C.quickChat()?.pending || [])]) C.cancelQueued(entry.id);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await tapPin(page, 'direction');
    await tapPin(page, 'direction');
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        const C = await import(`${BASE}/src/quick-action-chat.js`);
        C.queueDirections([], '', { roll: Q.rollQuickActionDie({ stat: 'Wits', who: 'user', target: 12 }) });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    const chip = await page.evaluate(() => document.querySelector('#ri_composer_bar .ri-bar-queue span')?.textContent);
    await tap(page, '#ri_composer_bar .ri-bar-queue');
    const listed = () => page.evaluate(() => ({
        items: [...document.querySelectorAll('.ri-queue-sheet .ri-queue-item')].map(item => ({
            kind: item.dataset.kind, title: item.querySelector('.ri-option-title').textContent,
            buttons: [...item.querySelectorAll('button')].map(button => button.textContent.trim()),
            text: [...item.querySelectorAll('.ri-option-body')].map(node => node.textContent).join(' | '),
        })),
        clearAll: !!document.querySelector('.ri-queue-sheet [data-ri-clear]'),
        chip: document.querySelector('#ri_composer_bar .ri-bar-queue:not([hidden]) span')?.textContent || '',
    }));
    const opened = await listed();
    await shot(page, run, 'queue-open');
    assert.equal(chip, '3');
    assert.equal(opened.items.length, 3);
    assert.deepEqual(opened.items[0].buttons, ['Edit', 'Private', 'Optional', 'Remove']);
    assert.equal(opened.items[2].kind, 'check');
    assert.equal(await page.evaluate(() => /null|false/.test(document.querySelector('.ri-queue-list').textContent)), false);
    assert.ok(opened.clearAll);

    // Visible, Required and an edit change the queued row itself.
    await tap(page, '.ri-queue-sheet .ri-queue-item .ri-queue-toggle');
    await tap(page, '.ri-queue-sheet .ri-queue-item .ri-queue-toggle:nth-of-type(3)');
    await tap(page, '.ri-queue-sheet .ri-queue-item [data-ri-edit]');
    await page.fill('.ri-queue-sheet .ri-queue-item textarea', 'A rival from the harbor walks in.');
    await shot(page, run, 'queue-edit');
    await page.evaluate(() => [...document.querySelectorAll('.ri-queue-sheet .ri-queue-item button')].find(button => button.textContent === 'Save').click());
    await page.waitForTimeout(200);
    const row = await page.evaluate(async BASE => {
        const C = await import(`${BASE}/src/quick-action-chat.js`);
        const first = C.quickChat().pending[0].rows[0];
        return { visibility: first.visibility, required: first.required, text: first.text };
    }, BASE);
    // Remove the second, then Clear all and Undo.
    await tap(page, '.ri-queue-sheet .ri-queue-item:nth-of-type(2) [data-ri-remove]');
    const afterRemove = await listed();
    await tap(page, '.ri-queue-sheet [data-ri-clear]');
    const afterClear = await listed();
    await shot(page, run, 'queue-cleared');
    await tap(page, '.ri-queue-sheet [data-ri-undo]');
    const afterUndo = await listed();
    await shot(page, run, 'queue-edited');
    run.checks.queue = { chip, opened, row, afterRemove: afterRemove.items.length, chipAfterRemove: afterRemove.chip,
        afterClear: afterClear.items.length, chipAfterClear: afterClear.chip, afterUndo: afterUndo.items.length };
    assert.deepEqual(row, { visibility: 'visible', required: true, text: 'A rival from the harbor walks in.' });
    assert.equal(afterRemove.items.length, 2);
    assert.equal(afterClear.items.length, 0);
    assert.equal(afterUndo.items.length, 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Sending a message consumes the queue.
    const start = requestCount();
    await page.evaluate(() => {
        const box = document.querySelector('#send_textarea');
        box.value = 'I look toward the harbor road.';
        box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tap(page, '#send_but');
    await page.waitForFunction(() => document.body.dataset.generating !== 'true' && !document.querySelector('#ri_composer_bar .ri-bar-queue:not([hidden])'), null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    const consumed = await page.evaluate(async BASE => ({
        pending: (await import(`${BASE}/src/quick-action-chat.js`)).quickChat().pending.length,
        chipShown: !!document.querySelector('#ri_composer_bar .ri-bar-queue:not([hidden])'),
    }), BASE);
    const reply = since(start)[0]?.body || '';
    run.checks.queue.consumed = { ...consumed, editedDirectionInReplyRequest: reply.includes('A rival from the harbor walks in.') };
    await shot(page, run, 'queue-consumed');
    assert.equal(consumed.pending, 0);
    assert.equal(consumed.chipShown, false);
}

async function runAt(viewport, label, parts) {
    const { context, page, errors } = await boot(viewport);
    const run = { label, viewport, checks: {}, shots: [], errors };
    results.runs.push(run);
    try {
        run.layout = await page.evaluate(() => ({ innerWidth, mobileLayout: matchMedia('(max-width: 1000px)').matches }));
        for (const part of parts) await part(page, run, viewport);
    } finally {
        run.errors = errors;
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await runAt({ width: 523, height: 1021 }, 'w523', [runOptions, runKeyboard, runSend, runQueue]);
    await runAt({ width: 1006, height: 909 }, 'w1006', [runOptions, runKeyboard, runQueue]);
    await runAt({ width: 390, height: 780 }, 'w390', [async (page, run) => {
        mock('delay.txt', 300);
        await page.evaluate(async BASE => (await import(`${BASE}/src/ui/results-sheet.js`)).clearOptionsCache(), BASE);
        await tapPin(page, 'options');
        await generate(page);
        await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 });
        await page.waitForTimeout(300);
        const state = await resultsState(page);
        run.checks.medium390 = { heightPct: state.heightPct, scrolls: state.scrolls, cards: state.cards.length,
            titlePx: state.cards.map(card => card.titlePx), bodyPx: state.cards.map(card => card.bodyPx), tokens: state.tokens };
        await shot(page, run, 'medium-40');
        assert.ok(state.scrolls);
        assert.ok(state.cards.every(card => card.bodyPx === state.tokens.body && card.titlePx === state.tokens.label));
    }]);
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log('B2 touch pass passed');
})().catch(error => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, failure: error.stack }, null, 2));
    console.error(error);
    process.exit(1);
});
