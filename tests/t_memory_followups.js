// MB19 browser suite (memory menu follow-ups from MB10) on a SillyTavern 1.19.0 host with the mock model, touch at 390 x 780:
//   1. Every model-calling button on the memory pages (Tidy now, Catch up, Rebuild, Close the chapter here, Write a chapter
//      now) opens the Generate sheet first. Opening it and Close make no model request; Generate runs the job.
//   2. "Memory on for this chat": off stops capture and recall for this chat only and keeps its records; on resumes them.
//   3. "Clear this chat's memory": removes the records and the generated book's entries; the one Undo restores exactly.
//   4. Open threads rows on the Plot card show the quote that last moved the thread, with no sideways scroll at 390 px.
// Run with the host variables of tests/README.md. RI_EVIDENCE names the screenshot folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'MB19');
fs.mkdirSync(dir, { recursive: true });
const width = Number(process.env.RI_WIDTH || 390), height = Number(process.env.RI_HEIGHT || 780);
const out = { run: new Date().toISOString(), viewport: { width, height }, checks: {}, shots: [] };
const B = L.BASE;

const answer = (ops, scene = { place: 'Elerian Keep gatehouse', time: 'Day 1, dawn', present: ['Hale'] }) => ({
    decisions: { durable_change: ops.length > 0, scene_ended: false, out_of_character: false }, ops, state: { scene } });

async function shot(page, name) {
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    out.shots.push(file);
}

async function openPage(page, id) {
    await L.openPanel(page, id, {});
    await page.waitForTimeout(900);
}

/** A button by its visible text; the Cost chip's pseudo text is part of its accessible name, so roles do not match. */
const named = (scope, text) => scope.locator('button').filter({ hasText: text }).filter({ hasNotText: /^$/ }).first();
const total = () => L.requests('all').length;
const sheetCount = page => page.locator('.ri-gsheet[data-ri-memory]').count();
const settle = page => page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });

/** Every stored entry of the open chat, in a form two reads can be compared on. */
const entriesOf = page => page.evaluate(async B => {
    const F = await import(`${B}/src/memory/fold.js`);
    const c = SillyTavern.getContext();
    const replies = c.chat.map(m => [F.storedMark(m), JSON.stringify(F.swipeEntries(m)), JSON.stringify((m.swipe_info || []).map(i => i?.extra?.ri_memory?.entries || []))]);
    return JSON.stringify({ replies, log: c.chatMetadata.ri_memory.log });
}, B);
const foldCount = page => page.evaluate(async B => {
    const F = await import(`${B}/src/memory/fold.js`);
    const c = SillyTavern.getContext();
    return F.fold(c.chat, c.chatMetadata, { cache: false }).records.length;
}, B);

/** Tap a model-calling button: the sheet opens, nothing is requested, Close leaves the chat as it was. */
async function sheetBeforeCall(page, name, label) {
    const button = named(page.locator('#ri_panel_page'), label);
    await button.scrollIntoViewIfNeeded().catch(async e => { out.vis = await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_panel_page button')].find(x => /Tidy now/.test(x.textContent)); const r = b?.getBoundingClientRect(); let p = b, hid = []; while (p && p !== document.body) { const s = getComputedStyle(p); if (s.display === 'none' || s.visibility === 'hidden' || p.hidden) hid.push(p.className || p.tagName); p = p.parentElement; } return { r: r && [r.width, r.height], hid, disabled: b?.disabled, aria: b?.getAttribute('aria-hidden') }; }); throw e; });
    const before = total();
    await button.tap();
    await page.waitForSelector('.ri-gsheet[data-ri-memory]', { timeout: 5000 });
    assert.equal(await sheetCount(page), 1, `${label} opens the Generate sheet`);
    assert.match(await page.locator('.ri-gsheet[data-ri-memory] .ri-gsheet-cost').innerText(), /model call/, `${label} sheet shows the Cost chip`);
    await page.waitForTimeout(400);
    await shot(page, `sheet-${name}`);
    await page.locator('.ri-gsheet[data-ri-memory] [data-ri-close]').tap();
    await page.waitForTimeout(400);
    assert.equal(await sheetCount(page), 0, `${label} sheet closes`);
    assert.equal(total(), before, `${label}: opening the sheet and Close make no request`);
}

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width, height, hasTouch: true, isMobile: true });
    try {
        const preset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'Roleplay Instructions V10.json'), 'utf8'));
        await L.setupApi(page);
        await page.evaluate(async value => { await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name, value); }, preset);
        await L.usePreset(page, preset.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(() => !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 });

        // a chat world, so the tray's saved-record cards read rows (the legacy path reply-world.js draws)
        await page.evaluate(async B => {
            const { createSet } = await import(`${B}/src/books.js`);
            const W = await import(`${B}/src/world.js`);
            const id = await createSet(`MB19 world ${Date.now()}`, 'world', { entries: {} }, '');
            W.setChatWorld(id);
            // an open thread the world already holds, which the story's own thread of the same name later moves
            const data = await W.loadWorld(id);
            const entry = W.newWorldEntry(data, 'thread');
            entry.name = 'Smugglers at the docks';
            entry.fields.open = 'Who unloads the crates at the east dock.';
            W.writeWorldEntry(data, entry, id);
            await W.saveWorld(id, data);
        }, B);
        L.mode({ capture: answer([
            { op: 'add', id: 'hale', target: [], kind: 'person', subject: 'Hale', text: 'Hale is the gate warden of Elerian Keep.', quote: 'Reply' },
            { op: 'add', id: 'smugglers', target: [], kind: 'thread', thread_type: 'Open', subject: 'Smugglers at the docks', text: 'Smugglers unload crates at the east dock at night.', quote: 'Reply' },
        ]) });
        await L.send(page, 'I check the gate with Hale.');
        await settle(page);
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); const f = F.fold(c.chat, c.chatMetadata, { cache: false }); return ['hale', 'smugglers'].every(id => f.byId.get(id)); }, B, { timeout: 30000 });
        L.mode({ capture: answer([]) });
        await L.send(page, 'We walk to the docks.');
        await settle(page);
        await page.waitForTimeout(1500);

        // ---- 1. The Generate sheet before every model-calling button
        await openPage(page, 'memory');
        await sheetBeforeCall(page, 'tidy', 'Tidy now');
        const upkeepOn = named(page.locator('#ri_panel_page'), 'Catch up this chat');
        if (await upkeepOn.isEnabled()) await sheetBeforeCall(page, 'catch-up', 'Catch up this chat');
        else out.checks.catchUpDisabled = true;
        const rebuild = named(page.locator('#ri_panel_page'), 'Rebuild from all chat history');
        if (await rebuild.isEnabled()) await sheetBeforeCall(page, 'rebuild', 'Rebuild from all chat history');
        // Generate runs Tidy for real: the page reports the outcome, and the sheet is gone.
        await named(page.locator('#ri_panel_page'), 'Tidy now').tap();
        await page.waitForSelector('.ri-gsheet[data-ri-memory]');
        await page.locator('.ri-gsheet[data-ri-memory] [data-ri-generate]').tap();
        await page.waitForTimeout(800);
        assert.equal(await sheetCount(page), 0, 'Generate closes the sheet');
        assert.ok(await page.locator('.toast, #toast-container .toast').filter({ hasText: /tidy/i }).count() >= 1, 'Generate ran Tidy and reported its outcome');

        await page.evaluate(async B => { (await import(`${B}/src/hide.js`)).setMemoryComponent('chapters', true); }, B);
        await openPage(page, 'world');
        await sheetBeforeCall(page, 'close-chapter', 'Close the chapter here');
        await sheetBeforeCall(page, 'write-chapter', 'Write a chapter now');
        const chaptersBefore = L.requests('chapter').length;
        await named(page.locator('#ri_panel_page'), 'Close the chapter here').tap();
        await page.waitForSelector('.ri-gsheet[data-ri-memory]');
        await page.locator('.ri-gsheet[data-ri-memory] [data-ri-generate]').tap();
        await page.waitForFunction(n => true, chaptersBefore);
        await page.waitForTimeout(4000);
        assert.ok(L.requests('chapter').length > chaptersBefore, 'Generate on Close the chapter here makes the chapter request');
        out.checks.sheets = 'ok';

        // ---- 2. Memory on for this chat
        await openPage(page, 'memory');
        const meta = () => page.evaluate(() => ({ off: SillyTavern.getContext().chatMetadata.ri_memory.off === true }));
        const recordsBefore = await entriesOf(page);
        const chatOn = page.locator('[data-ri-memory-on] [role="switch"]');
        await chatOn.scrollIntoViewIfNeeded();
        await shot(page, 'this-chat-on');
        assert.equal(await chatOn.getAttribute('aria-checked'), 'true', 'memory starts on');
        await chatOn.tap();
        await page.waitForTimeout(800);
        assert.deepEqual(await meta(), { off: true }, 'the switch turns memory off for this chat');
        assert.equal(await entriesOf(page), recordsBefore, 'turning memory off keeps every record');
        const captureBefore = L.requests('capture').length;
        L.mode({ capture: answer([{ op: 'add', id: 'late', target: [], kind: 'fact', subject: 'Late', text: 'A fact filed while memory is off.', quote: 'Reply' }]) });
        await L.send(page, 'I wait at the gate.');
        await page.waitForTimeout(4000);
        assert.equal(L.requests('capture').length, captureBefore, 'no capture request while memory is off');
        const offState = await page.evaluate(async B => {
            const F = await import(`${B}/src/memory/fold.js`);
            const c = SillyTavern.getContext();
            return { late: !!F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('late'), note: c.extensionPrompts?.RI_MEMORY_NOTES?.value || '' };
        }, B);
        assert.equal(offState.late, false, 'nothing is filed while memory is off');
        assert.equal(offState.note, '', 'no memory instruction is sent while memory is off');
        await openPage(page, 'memory');
        await shot(page, 'this-chat-off');
        await page.locator('[data-ri-memory-on] [role="switch"]').tap();
        await page.waitForTimeout(800);
        assert.deepEqual(await meta(), { off: false }, 'the switch turns memory back on');
        L.mode({ capture: answer([{ op: 'add', id: 'back', target: [], kind: 'fact', subject: 'Back', text: 'A fact filed once memory is on again.', quote: 'Reply' }]) });
        await L.send(page, 'I knock on the gate.');
        await settle(page);
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return !!F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('back'); }, B, { timeout: 30000 });
        out.checks.memoryOff = 'ok';

        // ---- 4 (before Clear). Open threads rows show the quote that last moved the thread
        const plot = await page.evaluate(async B => {
            const R = await import(`${B}/src/ui/reply-world.js`);
            const C = await import(`${B}/src/cards/catalog.js`);
            await (await import(`${B}/src/memory/story-world-book.js`)).storyWorld().write();
            const c = SillyTavern.getContext();
            const index = c.chat.length - 1;
            const panel = document.createElement('div');
            panel.style.cssText = 'position:fixed;top:0;left:0;width:100%;background:#10141a;color:#dde3ea;z-index:99999;padding:8px';
            panel.className = 'ri-tray-panel';
            document.body.append(panel);
            const config = C.setMode(C.normalizeConfig(undefined), 'plot', 'tray');
            const modules = new Proxy({}, { get: () => true });
            await R.renderWorldCard('plot', panel, { load: R.replyWorld(index).load, modules, reply: c.chat[index].extra?.ri || {}, index, config, openSwitch: () => {} });
            const rows = [...panel.querySelectorAll('.ri-c-timeline li')].map(li => li.innerText);
            const wide = panel.scrollWidth > panel.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1;
            const loaded = await R.replyWorld(index).load(); return { rows, wide, html: panel.innerText, kinds: (loaded.rows || []).map(r => [r.kind, r.name, r.fields?.data?.slice(0, 80)]), recs: (loaded.records || []).length };
        }, B);
        out.checks.plot = plot;
        assert.ok(/Smugglers/.test(plot.html) && /Last moved by/.test(plot.html) && /Last moved by\s*"[^"]{3,}"/.test(plot.html), `the Open threads row shows the last quote: ${JSON.stringify(plot)}`);
        assert.equal(plot.wide, false, 'no sideways scroll at 390 px');
        await shot(page, 'open-threads-quote');
        await page.evaluate(() => document.querySelector('.ri-tray-panel[style*="fixed"]')?.remove());

        // ---- 3. Clear this chat's memory, with one Undo that restores exactly
        await openPage(page, 'memory');
        const bookName = await page.evaluate(async B => {
            const S = await import(`${B}/src/memory/story-world-book.js`);
            const book = S.storyWorld();
            await book.write();
            return book.name();
        }, B);
        const bookEntries = () => page.evaluate(async ({ B, bookName }) => {
            const st = await import(`${B}/src/st.js`);
            const data = await st.loadBook(bookName);
            return Object.keys(data?.entries || {}).filter(uid => { const marker = data.entries[uid]?.extensions?.ri_generated; return marker && marker.id !== 'stamp'; }).length;
        }, { B, bookName });
        const recordsFull = await entriesOf(page);
        const foldFull = await foldCount(page);
        const bookFull = await bookEntries();
        assert.ok(foldFull > 0 && bookFull > 0, `there is something to clear (${foldFull} records, ${bookFull} book entries)`);
        const clear = named(page.locator('#ri_panel_page'), 'Clear this chat');
        await clear.scrollIntoViewIfNeeded();
        await clear.tap();
        await page.waitForSelector('[data-ri-clear-undo]', { timeout: 10000 });
        assert.equal(await foldCount(page), 0, 'Clear removes this chat\'s records');
        assert.equal(await bookEntries(), 0, 'Clear removes the generated book\'s entries');
        await page.locator('[data-ri-clear-undo]').scrollIntoViewIfNeeded();
        await shot(page, 'cleared-undo');
        await named(page.locator('[data-ri-clear-undo]'), 'Undo').tap();
        await page.waitForFunction(() => !document.querySelector('[data-ri-clear-undo]'), null, { timeout: 10000 });
        assert.equal(await entriesOf(page), recordsFull, 'Undo restores every entry exactly');
        assert.equal(await foldCount(page), foldFull, 'the fold is as before');
        assert.equal(await bookEntries(), bookFull, 'the generated book is as before');
        out.checks.clear = { foldFull, bookFull };

        // ---- touch pass
        const overflow = [];
        for (const id of ['memory', 'world']) {
            await openPage(page, id);
            const wide = await page.evaluate(() => { const b = document.querySelector('#ri_panel_page'); return b.scrollWidth > b.clientWidth + 1 || document.querySelector('#ri_root').scrollWidth > document.querySelector('#ri_root').clientWidth + 1; });
            if (wide) overflow.push(id);
        }
        assert.deepEqual(overflow, [], 'no page overflows sideways');
        const bad = errors.filter(e => !/favicon|net::ERR|Failed to fetch|ResizeObserver/.test(e));
        out.checks.errors = bad;
        assert.deepEqual(bad, [], 'no page errors');
        out.pass = true;
        console.log('PASS t_memory_followups');
    } catch (error) {
        out.pass = false;
        out.error = String(error?.stack || error);
        out.buttons = 0;
        await page.screenshot({ path: path.join(dir, 'fail.png') }).catch(() => {});
        console.error(error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, 'memory-followups.json'), JSON.stringify(out, null, 2));
        await browser.close();
    }
})();
