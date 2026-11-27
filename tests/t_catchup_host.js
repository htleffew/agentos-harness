// MB9 browser suite on a SillyTavern 1.19.0 host with the mock model, touch at 390 x 780: catch-up, rebuild and Continue in a new chat.
//   1. A chat with 150 exchanges and no memory asks first (the host has no free route), names the failed test, and Not now holds it.
//   2. Catch up this chat opens the Generate sheet first; Generate runs parts in story order with the status line "Catching up on
//      the Main API: part n of m"; Cancel keeps what was filed; Resume finishes; every reply carries a stamp.
//   3. A second catch-up has nothing to read and files nothing.
//   4. Rebuild retires every model-made record in one entry and Undo rebuild puts them back in one tap.
//   5. Continue in a new chat writes one Writer call, opens a fresh chat and binds a carry-over book that names the parent.
// The mock answers the map calls from mode.capture (the map prompt opens with the capture prompt's first line) and the Writer
// call from mode.reply. Run with the host variables of tests/README.md. RI_EVIDENCE names the screenshot folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'MB9');
fs.mkdirSync(dir, { recursive: true });
const width = Number(process.env.RI_WIDTH || 390), height = Number(process.env.RI_HEIGHT || 780);
const out = { run: new Date().toISOString(), viewport: { width, height }, checks: {}, shots: [] };
const B = L.BASE;
const delayFile = process.env.RI_MOCK_DIR ? path.join(process.env.RI_MOCK_DIR, 'delay.txt') : '';

const MAP_ANSWER = {
    decisions: { durable_change: true, scene_ended: false, out_of_character: false }, state: { scene: { place: 'Salt Dock', time: 'Day 3', present: ['Hale'] } },
    ops: [{ op: 'add', id: 'salt-crates', target: [], kind: 'fact', subject: 'Salt crates', text: 'Hale counted the salt crates at the Salt Dock.', quote: 'counted the salt crates at the Salt Dock', exchange: 1 }],
    chapters: [],
    scene: { place: 'Salt Dock', time: 'Day 3', present: ['Hale'] },
};
const WRITER_ANSWER = {
    synopsis: 'Hale of Verath tallies salt shipments at the Salt Dock for the harbor ledger. The dock keeps a ledger with a numbered entry for each shipment, and Hale checks each entry against the crates on the quay. Mira asks about one shipment after another and Hale answers with the figure from the ledger. The tally has reached shipment 150 and the next count is set for the morning tide. The dock has six berths, a toll booth and a rope store, and the clerk signs each receipt before a crate leaves the quay. No shipment has been lost and no entry has been changed.',
    opening: 'The morning tide had not yet turned when Hale unlocked the toll booth and laid the ledger open on the counter. He called the first berth, then the second, and read each total aloud to Mira as the crews rolled their crates along the quay in the gray light. When the count reached the sixth berth he closed the book and looked up to see what she had made of the figures.',
};

async function shot(page, name) {
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    out.shots.push(file);
}
async function openPage(page, id) { await L.openPanel(page, id, {}); await page.waitForTimeout(900); }
const named = (scope, text) => scope.locator('button').filter({ hasText: text }).filter({ hasNotText: /^$/ }).first();
const kinds = () => L.requests('all').filter(r => r.kind === 'capture').length;
const sheetCount = page => page.locator('.ri-gsheet[data-ri-memory]').count();

/** Tap a model-calling button: the sheet opens and nothing is sent until Generate. */
async function tapGenerate(page, label) {
    const button = named(page.locator('#ri_panel_page'), label);
    await button.scrollIntoViewIfNeeded();
    const before = L.requests('all').length;
    await button.tap();
    await page.waitForSelector('.ri-gsheet[data-ri-memory]', { timeout: 5000 });
    assert.equal(L.requests('all').length, before, `${label}: the sheet opens before any request`);
    await page.waitForTimeout(300);
    await page.locator('.ri-gsheet[data-ri-memory] [data-ri-generate]').tap();
    await page.waitForTimeout(500);
    assert.equal(await sheetCount(page), 0, `${label}: Generate closes the sheet`);
}

const plan = page => page.evaluate(() => globalThis.SillyTavern.getContext().chatMetadata?.ri_memory?.catchup || null);
const waitState = (page, states, timeout = 120000) => page.waitForFunction(s => s.includes(globalThis.SillyTavern.getContext().chatMetadata?.ri_memory?.catchup?.state), states, { timeout });
const lineText = page => page.locator('#ri_panel_page [data-ri-catchup-line]').first().innerText().catch(() => '');
const records = page => page.evaluate(async B => {
    const F = await import(`${B}/src/memory/fold.js`);
    const c = SillyTavern.getContext();
    const r = F.fold(c.chat, c.chatMetadata, { cache: false });
    return { current: r.current.map(x => `${x.kind}:${x.id}`), chapters: r.current.filter(x => x.kind === 'chapter').length, facts: r.current.filter(x => x.kind === 'fact').length, retire: (c.chatMetadata.ri_memory.log || []).filter(e => e.op === 'retire').length };
}, B);

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width, height, hasTouch: true, isMobile: true });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(() => !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 });

        // ---- the chat: 150 exchanges nobody captured
        await page.evaluate(async n => {
            const c = SillyTavern.getContext();
            const fill = i => Array.from({ length: 13 }, (_, k) => `The dock ledger lists ${i * 7 + k} entries for berth ${(i + k) % 6 + 1} and crate lot ${i * 13 + k}.`).join(' ');
            const make = (name, user, mes, i) => ({ name, is_user: user, is_system: false, send_date: new Date(Date.now() + i * 1000).toISOString(), mes, swipe_id: 0, swipes: [mes], swipe_info: [{ send_date: new Date().toISOString(), extra: {} }], extra: {} });
            for (let i = 1; i <= n; i++) c.chat.push(make(c.name1, true, `I ask Hale about shipment ${i}.`, i * 2), make(c.name2, false, `Hale counted the salt crates at the Salt Dock for shipment ${i}. ${fill(i)}`, i * 2 + 1));
            await c.saveChat();
        }, 150);
        const parentId = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
        L.mode({ capture: MAP_ANSWER, reply: JSON.stringify(WRITER_ANSWER) });

        // ---- 1. asks first, naming the failed test
        await page.waitForTimeout(2500);
        const kindsBefore = kinds();
        const verdict = await page.evaluate(async B => (await (await import(`${B}/src/memory/catchup.js`)).catchUp()).evaluate({ probe: false }), B);
        assert.equal(verdict.asked, true, 'no free route on this host, so catch-up asks first');
        await openPage(page, 'memory');
        const ask = page.locator('[data-ri-catchup-ask]');
        await ask.waitFor({ timeout: 5000 });
        assert.match(await ask.innerText(), /Catch-up would use the Main API: \d+ model calls? and 1 Cleanup call, about \d+ minutes?/);
        assert.match(await page.locator('#ri_panel_page [data-ri-catchup-line]').first().innerText(), /No free route is set up on this device/);
        assert.equal(kinds(), kindsBefore, 'asking made no model call');
        await ask.scrollIntoViewIfNeeded();
        await shot(page, 'ask-card');
        await named(ask, 'Not now').tap();
        await page.waitForTimeout(500);
        assert.equal((await plan(page)).state, 'declined');
        out.checks.asked = true;

        // ---- 2. Catch up this chat: the sheet, the status line, Cancel, Resume
        if (delayFile) fs.writeFileSync(delayFile, '1500');
        await tapGenerate(page, 'Catch up this chat');
        await page.waitForFunction(() => /Catching up on the Main API: part \d+ of \d+/.test(document.querySelector('#ri_panel_page [data-ri-catchup-line]')?.textContent || ''), null, { timeout: 30000 });
        assert.match(await lineText(page), /Catching up on the Main API: part \d+ of \d+/);
        await page.locator('#ri_panel_page [data-ri-catchup-line]').first().scrollIntoViewIfNeeded();
        await shot(page, 'status-line');
        await page.waitForFunction(() => (SillyTavern.getContext().chatMetadata?.ri_memory?.catchup?.filed || 0) > 0, null, { timeout: 60000 });
        await named(page.locator('#ri_panel_page [data-ri-catchup]'), 'Cancel').tap();
        await waitState(page, ['cancelled']);
        await page.waitForTimeout(2500);
        const cancelled = await plan(page);
        assert.ok(cancelled.filed > 0 && cancelled.filed < cancelled.exchanges, `cancelled part way: ${cancelled.filed} of ${cancelled.exchanges} filed`);
        assert.match(await lineText(page), /cancelled after \d+ of \d+ exchanges/);
        await shot(page, 'cancelled');
        const filedAtCancel = cancelled.filed;
        await page.waitForTimeout(3500);
        assert.equal((await plan(page)).filed, filedAtCancel, 'nothing more is read after Cancel');
        if (delayFile) fs.writeFileSync(delayFile, '200');
        await tapGenerate(page, 'Resume');
        await waitState(page, ['done'], 240000);
        const done = await plan(page);
        assert.ok(done.filed >= 140, `the exchanges nobody had captured were read (${done.filed} of the first 145)`);
        await page.waitForFunction(() => /Caught up:/.test(document.querySelector('#ri_panel_page [data-ri-catchup-line]')?.textContent || ''), null, { timeout: 30000 });
        assert.match(await lineText(page), /Caught up: \d+ exchanges read, \d+ records/);
        await openPage(page, 'world');
        await page.waitForFunction(() => /Caught up:/.test(document.querySelector('#ri_panel_page [data-ri-catchup-line]')?.textContent || ''), null, { timeout: 15000 });
        out.checks.storyWorldLine = true;
        await openPage(page, 'memory');
        const unstamped = await page.evaluate(() => SillyTavern.getContext().chat.filter((m, i) => i > 0 && !m.is_user && !m.extra?.ri_memory?.capture).length);
        assert.equal(unstamped, 0, 'every reply carries a stamp, so capture leaves it alone');
        const state = await records(page);
        assert.equal(state.facts, 1, 'the one fact is filed once, however many parts repeat it');
        out.checks.parts = { calls: done.calls, estimate: done.total };
        const callsDuring = kinds();
        assert.ok(callsDuring >= done.calls, 'the mock saw the map calls');
        await openPage(page, 'memory');
        await shot(page, 'done');

        // ---- 3. nothing left to read
        const again = await page.evaluate(async B => { const r = await (await import(`${B}/src/memory/catchup.js`)).catchUp(); try { await r.startTapped(); return 'started'; } catch (e) { return e.message; } }, B);
        assert.match(again, /Nothing waits/);
        assert.equal(await named(page.locator('#ri_panel_page'), 'Catch up this chat').isDisabled(), true, 'the button is off when every reply is filed');

        // ---- 4. Rebuild and Undo rebuild
        const before = await records(page);
        await tapGenerate(page, 'Rebuild from all chat history');
        await waitState(page, ['done'], 240000);
        await page.waitForFunction(() => /Rebuilt:/.test(document.querySelector('#ri_panel_page [data-ri-catchup-line]')?.textContent || ''), null, { timeout: 30000 });
        const rebuilt = await records(page);
        assert.equal(rebuilt.retire, before.retire + 1, 'one entry retired every model-made record');
        assert.equal(rebuilt.facts, 1);
        await named(page.locator('#ri_panel_page [data-ri-catchup]'), 'Undo rebuild').tap();
        await page.waitForFunction(() => /Rebuild undone/.test(document.querySelector('#ri_panel_page [data-ri-catchup-line]')?.textContent || '') || globalThis.SillyTavern.getContext().chatMetadata?.ri_memory?.catchup?.state === 'undone', null, { timeout: 15000 });
        const undone = await records(page);
        assert.equal(undone.facts, 1, 'the earlier record is back and the rebuild\'s own is retired');
        out.checks.rebuild = { retired: rebuilt.retire - before.retire };

        // ---- 5. Continue in a new chat
        const parentReplies = await page.evaluate(() => SillyTavern.getContext().chat.filter(m => !m.is_user).slice(-50).map(m => m.mes));
        const writerBefore = L.requests('all').length;
        await page.locator('#ri_panel_page [data-ri-continue] > summary').tap();
        await page.locator('#ri_panel_page [data-ri-continue] input[aria-label="Write an opening message too"]').check();
        await page.locator('#ri_panel_page [data-ri-continue]').scrollIntoViewIfNeeded();
        await shot(page, 'continue-form');
        await named(page.locator('#ri_panel_page [data-ri-continue]'), 'Write the synopsis and start').tap();
        await page.waitForSelector('.ri-gsheet[data-ri-memory]', { timeout: 5000 });
        assert.equal(L.requests('all').length, writerBefore, 'the sheet comes before the Writer call');
        await page.locator('.ri-gsheet[data-ri-memory] [data-ri-generate]').tap();
        await page.waitForFunction(id => SillyTavern.getContext().getCurrentChatId() !== id && !!SillyTavern.getContext().chatMetadata?.world_info, parentId, { timeout: 60000 });
        assert.equal(L.requests('all').length - writerBefore, 1, 'one Writer call');
        const book = await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            const name = c.chatMetadata.world_info;
            const data = await c.loadWorldInfo(name);
            return { name, entries: Object.values(data.entries).map(e => ({ comment: e.comment, content: e.content, key: e.key, constant: e.constant, disable: e.disable })), kind: data.extensions?.ri_generated?.kind, opening: c.chat[0]?.mes || '', carry: c.chatMetadata.ri_memory?.carry || null };
        });
        assert.match(book.name, /^RI Carry-over, /);
        assert.equal(book.kind, 'carry-over');
        assert.match(book.entries[0].content, new RegExp(`Carried over from the chat "${parentId}"`));
        assert.equal(book.entries.find(e => e.comment === 'Story so far').constant, true);
        assert.equal(book.carry.parent.name, parentId);
        const runsClean = await page.evaluate(async ({ B, replies, texts }) => {
            const CO = await import(`${B}/src/memory/carry-over.js`);
            const runs = new Set();
            for (const r of replies) { const w = CO.wordsOf(r); for (let i = 0; i + 8 <= w.length; i++) runs.add(w.slice(i, i + 8).join(' ')); }
            return texts.every(t => !CO.sharesRun(t, runs));
        }, { B, replies: parentReplies, texts: [...book.entries.map(e => e.content), book.opening] });
        assert.ok(runsClean, 'no run of eight words is shared with the parent\'s last 50 replies');
        assert.match(book.opening, /^The morning tide had not yet turned/, 'the opening replaced the card\'s greeting');
        await openPage(page, 'memory');
        await shot(page, 'new-chat');
        out.checks.continue = { book: book.name, entries: book.entries.length };

        const fatal = errors.filter(e => !/favicon|Failed to load resource|net::ERR|WebSocket|Unexpected token '<'/.test(String(e)));
        assert.deepEqual(fatal, [], 'no page errors');
        out.errors = errors.length;
        fs.writeFileSync(path.join(dir, 'catchup-host.json'), JSON.stringify(out, null, 2));
        console.log('PASS t_catchup_host', JSON.stringify(out.checks));
    } catch (error) {
        console.error('FAIL', error);
        await page.screenshot({ path: path.join(dir, 'fail.png') }).catch(() => {});
        process.exitCode = 1;
    } finally {
        if (delayFile) { try { fs.rmSync(delayFile); } catch { /* none */ } }
        await browser.close();
    }
})();
