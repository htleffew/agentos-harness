// B37 on a real host: option bank pools, pick counts, a seeded roll with its record and replay, a reply that carries
// its roll record with no extra model request, and an import of a fixture file. Touch at 523 x 1021 (mobile layout)
// and 1006 x 909 (desktop layout) on SillyTavern 1.19.0 with the mock model. Fails on any page error or sideways overflow.
//
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_LOG, RI_EVIDENCE (screenshots and results.json).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
const H = require('./h.js');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8283';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B37');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const LOG = process.env.RI_MOCK_LOG || '';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const FIXTURE = path.join(__dirname, 'fixtures/banks/preset-inline.json');
fs.mkdirSync(OUT, { recursive: true });
const results = { host: HOST, runs: [] };
const requestCount = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => !['capture', 'chapter', 'condensed'].includes(row.kind)).length : 0);

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
}

const overflow = page => page.evaluate(() => {
    const doc = document.documentElement; const root = document.querySelector('#ri_root'); const sheet = document.querySelector('[data-ri-pool-sheet]');
    return { page: doc.scrollWidth > window.innerWidth + 1, panel: !!root && root.scrollWidth > root.clientWidth + 1, sheet: !!sheet && sheet.scrollWidth > sheet.clientWidth + 1 };
});

async function run(browser, tag, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const out = { tag, viewport };
    results.runs.push(out);
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
        const ev = E.newEvent(`B37 banks ${stamp}`); ev.chance = 100; ev.wait = 0;
        const data = { entries: {} }; E.writeEvent(data, ev);
        const id = await K.createSet(`B37 banks ${stamp}`, 'events', data, '');
        S.chatState().activeSets = [id]; S.saveChatState();
        return id;
    }, { BASE, stamp });
    await page.evaluate(async ({ BASE, setId }) => {
        const P = await import(`${BASE}/src/ui/panel.js`), U = await import(`${BASE}/src/ui/events.js`);
        await P.app.setExpanded(true);
        await U.openEventSet(P.app, setId, U.EVENT_KINDS.events);
    }, { BASE, setId });
    await page.waitForFunction(BANK => globalThis.SillyTavern.getContext().getWorldInfoNames().includes(BANK), 'RI Option banks', { timeout: 20000 });
    await page.waitForTimeout(800);
    out.bankBook = await page.evaluate(async () => {
        const book = await SillyTavern.getContext().loadWorldInfo('RI Option banks');
        const entries = Object.values(book.entries);
        return { entries: entries.length, allDisabled: entries.every(e => e.disable === true) };
    });
    assert.ok(out.bankBook.entries >= 40 && out.bankBook.allDisabled, `${tag}: first use makes RI Option banks with one disabled entry per dimension`);

    // Open the Situation category (a 72-item bank) and its pool sheet by touch.
    const card = name => page.locator('details.ri-fold', { has: page.locator('.ri-sent-title', { hasText: new RegExp(`^${name}$`) }) }).first();
    await card('Situation').locator(':scope > summary').tap();
    await page.waitForTimeout(400);
    const pool = card('Situation').locator('[data-ri-pool]');
    await pool.scrollIntoViewIfNeeded();
    out.closedBefore = await pool.textContent();
    await pool.tap();
    await page.waitForSelector('[data-ri-pool-sheet]');
    const sheet = await page.evaluate(() => {
        const s = document.querySelector('[data-ri-pool-sheet]'); const list = s.querySelector('.ri-pool-list');
        const row = s.querySelector('.ri-pool-label'); const body = document.querySelector('#ri_root');
        return { height: s.getBoundingClientRect().height, top: s.getBoundingClientRect().top, vh: window.innerHeight, rows: s.querySelectorAll('.ri-pool-row').length,
            scrolls: list.scrollHeight > list.clientHeight, rowFont: parseFloat(getComputedStyle(row).fontSize), bodyFont: parseFloat(getComputedStyle(body).fontSize),
            search: !!s.querySelector('input[type=search]'), clear: [...s.querySelectorAll('button')].some(b => b.textContent === 'Clear') };
    });
    out.sheet = sheet;
    assert.equal(sheet.rows, 72, `${tag}: the sheet lists the whole 72-item bank`);
    assert.ok(sheet.height <= sheet.vh * 0.61 && sheet.top > 0, `${tag}: the sheet is a partial sheet with the page behind still in view`);
    assert.ok(sheet.scrolls, `${tag}: the list scrolls`);
    assert.ok(sheet.rowFont >= 12 && sheet.rowFont >= sheet.bodyFont - 1, `${tag}: text keeps its size in the sheet`);
    assert.ok(sheet.search && sheet.clear, `${tag}: the sheet has a search box and Clear`);
    const rows = page.locator('[data-ri-pool-sheet] .ri-pool-row');
    for (const i of [0, 1, 2]) await rows.nth(i).tap();
    await rows.nth(1).tap();
    await rows.nth(40).scrollIntoViewIfNeeded();
    await rows.nth(40).tap();
    out.sheetCount = await page.locator('.ri-pool-count').textContent();
    assert.match(out.sheetCount, /^3 of 72 ticked/, `${tag}: taps tick and untick`);
    await page.screenshot({ path: path.join(OUT, `${tag}-1-pool-sheet.png`) });
    await page.locator('.ri-pool-search').fill('stranger');
    await page.waitForTimeout(200);
    out.searchRows = await rows.count();
    assert.ok(out.searchRows > 0 && out.searchRows < 72, `${tag}: the search narrows the list`);
    await page.screenshot({ path: path.join(OUT, `${tag}-2-pool-search.png`) });
    out.overflowSheet = await overflow(page);
    assert.deepEqual(out.overflowSheet, { page: false, panel: false, sheet: false }, `${tag}: no sideways overflow with the sheet open`);
    await page.locator('[data-ri-pool-sheet] button', { hasText: /^Done$/ }).tap();
    out.closedAfter = await pool.textContent();
    assert.match(out.closedAfter, /3 of 72 ticked/, `${tag}: the closed control shows the ticked count`);

    // Pick count 2 with one value per beat on Tone.
    await card('Tone').locator(':scope > summary').tap();
    await page.waitForTimeout(300);
    const count = card('Tone').locator('input[aria-label="Pick count for Tone"]');
    await count.scrollIntoViewIfNeeded();
    await count.tap(); await count.fill('2'); await count.blur();
    await page.waitForTimeout(400);
    await card('Tone').locator('select[aria-label="How the picks of Tone share the reply"]').selectOption('beat');
    await page.screenshot({ path: path.join(OUT, `${tag}-3-pick-count.png`) });

    // A seeded roll in the editor, its record, and the replay.
    const before = requestCount();
    const rollButton = page.locator('button', { hasText: /^Roll an example event$/ });
    await rollButton.scrollIntoViewIfNeeded();
    await rollButton.tap();
    await page.waitForSelector('[data-ri-roll-record]');
    await page.locator('[data-ri-roll-record]').scrollIntoViewIfNeeded();
    out.preview = await page.locator('.ri-preview').textContent();
    assert.match(out.preview, /Tone: one for each beat, in turn: /, `${tag}: the pick count and send rule reach the order`);
    await page.locator('[data-ri-roll-record] button', { hasText: /^Roll again with this seed$/ }).tap();
    await page.waitForTimeout(300);
    out.replay = await page.locator('[data-ri-replay]').textContent();
    assert.match(out.replay, /^Same values as the saved roll/, `${tag}: Roll again with this seed reproduces the roll`);
    await page.screenshot({ path: path.join(OUT, `${tag}-4-roll-record.png`) });
    assert.equal(requestCount(), before, `${tag}: rolling in the editor makes no request`);
    out.overflowEditor = await overflow(page);
    assert.deepEqual(out.overflowEditor, { page: false, panel: false, sheet: false }, `${tag}: no sideways overflow in the editor`);

    // Save the set, then send a reply: the roll travels in the one reply request and its record stays with the reply.
    await page.locator('.ri-savebar button', { hasText: /^Save story event set$/ }).tap();
    await page.waitForTimeout(1200);
    const sent = requestCount();
    await H.send(page, 'An evening at the inn.');
    await page.waitForTimeout(1500);
    out.reply = await page.evaluate(() => {
        const chat = SillyTavern.getContext().chat; const rec = chat[chat.length - 1].extra?.roleplay_instructions;
        const it = (rec?.items || []).find(x => x.roll);
        return it ? { seed: it.roll.seed, cats: it.roll.cats.length, drawn: it.roll.drawn.map(d => d.texts.length), pool: it.roll.cats.find(c => c.name === 'Situation')?.pool?.length } : null;
    });
    // The requests of this reply: the reply itself and, with checking on, the follow-through check after it. None is a roll.
    const made = LOG ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => !['capture', 'chapter', 'condensed'].includes(r.kind)).slice(sent) : [];
    const textOf = r => (r.messages || []).map(m => String(m.content)).join('\n');
    out.replyRequests = made.map(r => (/You check whether instructions were carried out/.test(textOf(r)) ? 'check' : /rolled story parts/.test(textOf(r)) ? 'polish' : 'reply'));
    assert.ok(out.reply && Number.isInteger(out.reply.seed), `${tag}: the reply keeps its roll record`);
    assert.equal(out.reply.pool, 3, `${tag}: the record keeps the saved pool`);
    if (LOG) { assert.equal(out.replyRequests.filter(k => k === 'reply').length, 1, `${tag}: one reply request`); assert.ok(!out.replyRequests.includes('polish'), `${tag}: no polish request with polish off`); assert.match(textOf(made[0]), /an event must happen in the story, built from these parts: Situation: /, `${tag}: the rolled event rides the reply request`); }

    // What was sent shows the record and replays it.
    await page.evaluate(async BASE => { const P = await import(`${BASE}/src/ui/panel.js`); await P.app.openPage('sent', { via: 'tab' }); }, BASE);
    await page.waitForTimeout(900);
    const sentRecord = page.locator('[data-ri-roll-record]').first();
    await sentRecord.scrollIntoViewIfNeeded();
    await sentRecord.locator('button', { hasText: /^Roll again with this seed$/ }).tap();
    await page.waitForTimeout(800);
    out.sentReplay = await sentRecord.locator('[data-ri-replay]').textContent();
    assert.match(out.sentReplay, /^Same values as the saved roll/, `${tag}: What was sent replays the saved roll`);
    await page.screenshot({ path: path.join(OUT, `${tag}-5-sent-record.png`) });

    // Import a fixture file by touch.
    await page.evaluate(async ({ BASE, setId }) => { const P = await import(`${BASE}/src/ui/panel.js`), U = await import(`${BASE}/src/ui/events.js`); await U.openEventSet(P.app, setId, U.EVENT_KINDS.events); }, { BASE, setId });
    await page.waitForTimeout(800);
    const importButton = page.locator('button', { hasText: /^Import options from a preset or plugin file$/ });
    await importButton.scrollIntoViewIfNeeded();
    await importButton.tap();
    await page.locator('[data-ri-import-file]').setInputFiles(FIXTURE);
    await page.waitForSelector('.ri-import-row');
    out.importRows = await page.locator('.ri-import-row').count();
    await page.locator('[data-ri-import]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, `${tag}-6-import-sheet.png`) });
    out.overflowImport = await overflow(page);
    assert.deepEqual(out.overflowImport, { page: false, panel: false, sheet: false }, `${tag}: no sideways overflow on the import sheet`);
    await page.locator('[data-ri-import] button', { hasText: /^Import the ticked lists$/ }).tap();
    await page.waitForSelector('[data-ri-import] .ri-note[role=status]');
    out.importDone = await page.locator('[data-ri-import] .ri-note[role=status]').textContent();
    out.imported = await page.evaluate(async () => {
        const book = await SillyTavern.getContext().loadWorldInfo('RI Option banks');
        return Object.values(book.entries).flatMap(e => e.extensions.ri.items).filter(i => i.group && i.source?.file === 'preset-inline.json').length;
    });
    assert.ok(out.imported >= 11, `${tag}: the ticked lists went into RI Option banks with their source`);
    await page.screenshot({ path: path.join(OUT, `${tag}-7-import-done.png`) });
    await page.locator('[data-ri-import] button', { hasText: /^Remove this group$/ }).first().tap();
    await page.evaluate(() => { for (const b of document.querySelectorAll('dialog[open] .popup-button-ok')) b.click(); });
    await page.waitForTimeout(1200);
    out.afterRemove = await page.evaluate(async () => {
        const book = await SillyTavern.getContext().loadWorldInfo('RI Option banks');
        return Object.values(book.entries).flatMap(e => e.extensions.ri.items).filter(i => i.group).length;
    });
    assert.equal(out.afterRemove, 0, `${tag}: an import is removed as one group`);
    out.errors = errors;
    assert.deepEqual(errors, [], `${tag}: no page errors`);
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, 'w523', { width: 523, height: 1021 });
        await run(browser, 'w1006', { width: 1006, height: 909 });
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        console.log('B37 bank UI passed');
    } catch (e) {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, error: e.message }, null, 2));
        console.error(e); process.exitCode = 1;
    } finally { await browser.close(); }
})();
