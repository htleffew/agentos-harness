// B51: weights on option-bank and story-event items. The node part checks the odds over 10,000 seeded rolls; the
// browser part (only when RI_HOST_URL is set) checks the weight control on an item row at 390 x 780 with touch.
//
// Environment (browser part): RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const extensionSettings = {};
globalThis.SillyTavern = { getContext: () => ({ extensionSettings, chat: [{ is_user: false, mes: 'The last reply.' }], saveSettingsDebounced() {} }) };
const load = rel => import(pathToFileURL(path.join(root, rel)).href);
const ROLLS = 10000;

let B; let E;
const ready = (async () => { B = await load('src/banks.js'); E = await load('src/events.js'); })();

const eventOf = cat => ({ type: 'event', categories: [cat] });
const idsOf = (cat, seed) => E.rollEvent(eventOf(cat), null, { seed }).parts[0].ids;

test('a +10 item comes up about three times as often as a 0 item, and a -10 item never', async () => {
    await ready;
    const cat = E.newCategory('Weights', ['zero', 'plus ten', 'minus ten', 'zero too']);
    cat.items[1].bias = 10; cat.items[2].bias = -10;
    const ri = E.readEvent({ uid: 1, disable: false, extensions: { ri: { type: 'event', categories: [cat] } } }, 'x');
    const counts = {};
    for (let s = 0; s < ROLLS; s++) { const id = idsOf(ri.categories[0], s)[0]; counts[id] = (counts[id] || 0) + 1; }
    const [zero, plus, minus, zero2] = ri.categories[0].items.map(it => counts[it.id] || 0);
    assert.equal(minus, 0, 'a -10 item is never rolled');
    assert.ok(Math.abs(plus / ((zero + zero2) / 2) - 3) < 0.35, `+10 vs 0 ratio ${(plus / ((zero + zero2) / 2)).toFixed(2)} is about 3`);
    assert.ok(Math.abs(zero / zero2 - 1) < 0.15, 'two items at 0 come up about equally');
});

test('weights between the ends scale smoothly and an always item at -10 is still left out', async () => {
    await ready;
    assert.equal(B.itemOdds({ weight: 1 }), 1);
    assert.ok(Math.abs(B.itemOdds({ bias: 10 }) - 3) < 1e-9);
    assert.ok(B.itemOdds({ bias: 5 }) > 1 && B.itemOdds({ bias: 5 }) < 3 && B.itemOdds({ bias: -5 }) < 1 && B.itemOdds({ bias: -5 }) > 0);
    assert.equal(B.itemOdds({ bias: -10 }), 0);
    const cat = E.newCategory('Always', ['kept', 'never']);
    cat.items[1].bias = -10; cat.items[1].always = true;
    for (let s = 0; s < 200; s++) assert.deepEqual(idsOf(cat, s), [cat.items[0].id]);
    assert.deepEqual(E.usable(cat).map(it => it.text), ['kept']);
});

test('existing items read 0, are not rewritten, and a saved weight survives a reload', async () => {
    await ready;
    const old = E.normalItem({ id: 'a', text: 'old', weight: 1 });
    assert.equal('bias' in old, false, 'no bias field is added to an item that has none');
    assert.equal(B.itemBias(old), 0);
    const set = E.normalItem({ id: 'b', text: 'new', bias: 7 });
    assert.equal(set.bias, 7);
    assert.equal(E.normalItem({ id: 'c', text: 'x', bias: 99 }).bias, 10, 'clamped to +10');
    assert.equal(E.normalItem({ id: 'd', text: 'x', bias: -99 }).bias, -10, 'clamped to -10');
    const same = [3, 4, 5].map(seed => idsOf(E.newCategory('Same', ['a', 'b', 'c', 'd', 'e']), seed).length);
    assert.deepEqual(same, [1, 1, 1]);
});

test('a roll with no weights reads the same picks as before (whole weights keep the old draw)', async () => {
    await ready;
    const rnd1 = B.seededRandom(42); const rnd2 = B.seededRandom(42);
    const items = [{ w: 1 }, { w: 3 }, { w: 2 }];
    const a = B.pickSeeded(items, x => x.w, 3, rnd1).map(x => x.w);
    let r = rnd2(6); const expect = []; const pool = [...items];
    while (pool.length) { let i = 0; const total = pool.reduce((s, x) => s + x.w, 0); if (expect.length) r = rnd2(total); while (r >= pool[i].w) { r -= pool[i].w; i++; } expect.push(pool.splice(i, 1)[0].w); }
    assert.deepEqual(a, expect);
});

test('the old weight is gone: weight 5 rolls the same as no weight, and saving drops the field', async () => {
    await ready;
    assert.equal(B.itemOdds({ weight: 5 }), B.itemOdds({}));
    assert.equal(B.itemOdds({ weight: 20, bias: 4 }), B.itemOdds({ bias: 4 }));
    const make = withWeight => {
        const cat = E.newCategory('Old', ['a', 'b', 'c', 'd']);
        cat.items.forEach((it, i) => { delete it.weight; if (withWeight) it.weight = i === 0 ? 5 : 1; });
        return E.readEvent({ uid: 1, disable: false, extensions: { ri: { type: 'event', categories: [cat] } } }, 'x').categories[0];
    };
    const old = make(true), plain = make(false);
    const texts = (cat, seed) => idsOf(cat, seed).map(id => cat.items.find(it => it.id === id).text);
    for (let s = 0; s < 300; s++) assert.deepEqual(texts(old, s), texts(plain, s), `seed ${s}`);
    assert.ok(old.items.every(it => !('weight' in it)), 'weight is dropped when a set loads');
    const data = { entries: {} };
    E.writeEvent(data, { ...E.newEvent('Saved'), categories: [{ ...old, items: old.items.map(it => ({ ...it, weight: 5 })) }] });
    const entry = E.findEventEntry(data, 'event');
    const saved = E.readEvent(entry, 'x').categories[0].items;
    assert.ok(saved.every(it => !('weight' in it)), 'weight is dropped when a set is read back');
    assert.ok(!JSON.stringify(entry.extensions.ri).includes('"weight"'), 'weight is not in the saved entry');
});

test('a bank value keeps its weight in the bank book and rolls by it; the old weight is dropped there too', async () => {
    await ready;
    const bank = { id: 'wt', name: 'Wt', kind: 'event', items: [{ id: 'x', text: 'x', weight: 9 }, { id: 'y', text: 'y', bias: 10 }, { id: 'z', text: 'z', bias: -10 }] };
    const entry = B.bankEntry(1, bank);
    const items = entry.extensions.ri.items;
    assert.ok(items.every(it => !('weight' in it)));
    assert.deepEqual(items.map(it => it.bias ?? 0), [0, 10, -10]);
    assert.deepEqual(items.map(B.itemOdds).map(n => Math.round(n * 100) / 100), [1, 3, 0]);
});

// ---------- the control on a phone ----------
if (process.env.RI_HOST_URL) {
    test('the weight control sits on the item row at 390 px, sets the weight and saves it', async () => {
        const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
        const H = require('./h.js');
        const HOST = process.env.RI_HOST_URL;
        const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B51');
        const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
        const BASE = '/scripts/extensions/third-party/roleplay-instructions';
        fs.mkdirSync(OUT, { recursive: true });
        const browser = await chromium.launch({ executablePath: CHROME, headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: true, colorScheme: 'dark' });
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(HOST, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
            await page.evaluate(() => { for (const b of document.querySelectorAll('dialog[open] .popup-button-ok')) b.click(); });
            await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
            await H.setupApi(page);
            const stamp = Date.now();
            const setId = await page.evaluate(async ({ BASE, stamp }) => {
                const host = SillyTavern.getContext();
                const idx = host.characters.findIndex(item => item.name);
                if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
                await new Promise(r => setTimeout(r, 800));
                await host.executeSlashCommandsWithOptions('/newchat');
                await new Promise(r => setTimeout(r, 1500));
                const K = await import(`${BASE}/src/books.js`), Ev = await import(`${BASE}/src/events.js`), S = await import(`${BASE}/src/store.js`);
                const ev = Ev.newEvent(`B51 weights ${stamp}`); ev.chance = 100; ev.wait = 0;
                ev.categories = [Ev.newCategory('Weighted', ['first item', 'second item', 'third item'])];
                const data = { entries: {} }; Ev.writeEvent(data, ev);
                const id = await K.createSet(`B51 weights ${stamp}`, 'events', data, '');
                S.chatState().activeSets = [id]; S.saveChatState();
                return id;
            }, { BASE, stamp });
            await page.evaluate(async ({ BASE, setId }) => {
                const P = await import(`${BASE}/src/ui/panel.js`), U = await import(`${BASE}/src/ui/events.js`);
                await P.app.setExpanded(true);
                await U.openEventSet(P.app, setId, U.EVENT_KINDS.events);
            }, { BASE, setId });
            await page.waitForTimeout(800);
            await page.locator('details.ri-fold', { has: page.locator('.ri-sent-title', { hasText: /^Weighted$/ }) }).first().locator(':scope > summary').tap();
            await page.waitForTimeout(400);
            const control = page.locator('select[aria-label="Weight for second item"]');
            await control.scrollIntoViewIfNeeded();
            const box = await control.boundingBox();
            assert.ok(box.height >= 32 && box.width >= 44, `the control is a touch target (${box.width} x ${box.height})`);
            const options = await control.locator('option').allTextContents();
            assert.equal(options.length, 21);
            assert.deepEqual([options[0], options[10], options[20]], ['+10', '0', '-10']);
            assert.equal(await control.inputValue(), '0', 'an item starts at 0');
            await control.selectOption('10');
            await page.screenshot({ path: path.join(OUT, 'w390-weight-control.png') });
            const over = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > window.innerWidth + 1, panel: document.querySelector('#ri_root').scrollWidth > document.querySelector('#ri_root').clientWidth + 1 }));
            assert.deepEqual(over, { page: false, panel: false }, 'no sideways overflow at 390 px');
            await page.locator('button', { hasText: /^Save story event set$/ }).tap();
            await page.waitForTimeout(1500);
            const saved = await page.evaluate(async ({ BASE, setId }) => {
                const K = await import(`${BASE}/src/books.js`), Ev = await import(`${BASE}/src/events.js`);
                const data = await K.loadSet(setId);
                const entry = Ev.findEventEntry(data, 'event');
                return Ev.readEvent(entry, 'x').categories[0].items.map(it => it.bias ?? 0);
            }, { BASE, setId });
            assert.deepEqual(saved, [0, 10, 0], 'the weight is saved on that item only');
            assert.deepEqual(errors, [], 'no page errors');
            await page.close();
        } finally { await browser.close(); }
    });

    test('a bank value has a weight control in the pool sheet at 390 px that saves to RI Option banks', async () => {
        const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');
        const H = require('./h.js');
        const HOST = process.env.RI_HOST_URL;
        const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B51b');
        const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
        const BASE = '/scripts/extensions/third-party/roleplay-instructions';
        fs.mkdirSync(OUT, { recursive: true });
        const browser = await chromium.launch({ executablePath: CHROME, headless: true });
        try {
            const page = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: true, colorScheme: 'dark' });
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            await page.goto(HOST, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
            await page.evaluate(() => { for (const b of document.querySelectorAll('dialog[open] .popup-button-ok')) b.click(); });
            await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
            await H.setupApi(page);
            const stamp = Date.now();
            const setId = await page.evaluate(async ({ BASE, stamp }) => {
                const host = SillyTavern.getContext();
                const idx = host.characters.findIndex(item => item.name);
                if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
                await new Promise(r => setTimeout(r, 800));
                await host.executeSlashCommandsWithOptions('/newchat');
                await new Promise(r => setTimeout(r, 1500));
                const K = await import(`${BASE}/src/books.js`), Ev = await import(`${BASE}/src/events.js`), S = await import(`${BASE}/src/store.js`);
                const ev = Ev.newEvent(`B51b banks ${stamp}`); ev.chance = 100; ev.wait = 0;
                const data = { entries: {} }; Ev.writeEvent(data, ev);
                const id = await K.createSet(`B51b banks ${stamp}`, 'events', data, '');
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
            const card = page.locator('details.ri-fold', { has: page.locator('.ri-sent-title', { hasText: /^Situation$/ }) }).first();
            await card.locator(':scope > summary').tap();
            await page.waitForTimeout(400);
            const pool = card.locator('[data-ri-pool]');
            await pool.scrollIntoViewIfNeeded();
            await pool.tap();
            await page.waitForSelector('[data-ri-pool-sheet]');
            const controls = page.locator('[data-ri-pool-sheet] select.ri-pool-weight');
            assert.equal(await controls.count(), 72, 'every value in the 72-value bank has a weight control');
            const first = controls.first();
            const label = await first.getAttribute('aria-label');
            const box = await first.boundingBox();
            assert.ok(box.height >= 32 && box.width >= 44, `a touch target (${box.width} x ${box.height})`);
            assert.equal(await first.inputValue(), '0');
            await first.selectOption('7');
            await page.waitForTimeout(1500);
            await page.screenshot({ path: path.join(OUT, 'w390-bank-weight.png') });
            const over = await page.evaluate(() => { const s = document.querySelector('[data-ri-pool-sheet]'); const d = document.documentElement; return { page: d.scrollWidth > innerWidth + 1, sheet: s.scrollWidth > s.clientWidth + 1 }; });
            assert.deepEqual(over, { page: false, sheet: false }, 'no sideways overflow at 390 px');
            const saved = await page.evaluate(async () => {
                const book = await SillyTavern.getContext().loadWorldInfo('RI Option banks');
                const items = Object.values(book.entries).filter(e => e?.extensions?.ri?.type === 'bank').flatMap(e => e.extensions.ri.items);
                return { biased: items.filter(it => it.bias).map(it => [it.label || it.text, it.bias]), n: items.length, weights: items.filter(it => 'weight' in it).length };
            });
            assert.equal(saved.biased.length, 1, 'one value carries a weight');
            assert.equal(saved.biased[0][1], 7);
            assert.ok(label.includes(saved.biased[0][0]), 'it is the value that was changed');
            assert.equal(saved.weights, 0, 'the bank keeps no old weight field');
            assert.deepEqual(errors, [], 'no page errors');
            await page.close();
        } finally { await browser.close(); }
    });
}
