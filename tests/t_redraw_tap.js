// B63: a background redraw never swallows her tap. Drives SillyTavern 1.19.0 with the mock model at phone width with touch.
//   A. On Setup, Presets she presses the Stack and Bank switch at the moment a reply from the mock lands and its background
//      updates redraw the page. Each press is a real touch held 200 ms (CDP touchStart, then touchEnd), started inside
//      the 80 ms between a background change and the redraw it schedules. The tap takes effect on all 20 tries, the
//      element under the finger stays in the page until it lifts (before B63, 12 to 17 of 20 were replaced), the page
//      still redraws once after the finger lifts, and the scroll stays where it was.
//   B. The same with a mouse press held 200 ms, 20 tries driven by the host's own change event (MESSAGE_UPDATED). Before
//      B63 none of the 20 took effect: the click of a press whose element was replaced lands on the parent both copies share.
//   C. With the Sent card in the tray, she taps it (a 200 ms touch) as each of 10 mock replies lands; it opens and stays
//      open and filled across that reply's capture, a forced rebuild of the tray and a further background update.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE, RI_WIDTH (default 412), RI_TRIES (default 20),
// RI_CARDS (default 10).
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');
const V10 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'Roleplay Instructions V10.json'), 'utf8'));

const WIDTH = Number(process.env.RI_WIDTH || 412);
const TRIES = Number(process.env.RI_TRIES || 20);
const HOLD = 200;
const CARDS = Number(process.env.RI_CARDS || 10);
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B63');
fs.mkdirSync(OUT, { recursive: true });
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) { failed++; process.exitCode = 1; } };

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: WIDTH, height: 915, hasTouch: true, isMobile: true });
    page.on('pageerror', error => console.error(error.stack));
    const B = L.BASE;
    const shot = name => page.screenshot({ path: path.join(OUT, `w${WIDTH}-${name}.png`) });
    const cdp = await page.context().newCDPSession(page);
    try {
        await L.setupApi(page);
        // The reply tray draws under v10 replies, so the run uses the V10 preset, as on her phone.
        await page.evaluate(async (value) => { await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name, value); }, V10);
        await L.usePreset(page, V10.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });
        await L.openChat(page);
        await L.send(page, 'I wait by the stall.');

        // Every change the engine announces is counted, so a press can start the moment one lands.
        await page.evaluate(async B => {
            const E = await import(`${B}/src/engine.js`);
            const t = globalThis.__riB63 = { changes: 0, pressed: null, lost: 0 };
            E.onChange(() => { t.changes++; });
            // The element under each press: a press whose element left the page before the finger lifted counts as lost.
            for (const type of ['pointerdown', 'touchstart']) document.addEventListener(type, event => { t.pressed = event.target; }, true);
            for (const type of ['pointerup', 'touchend']) document.addEventListener(type, () => { if (t.pressed && !t.pressed.isConnected) t.lost++; t.pressed = null; }, true);
        }, B);
        const openPresets = () => page.evaluate(async B => {
            const { app } = await import(`${B}/src/ui/panel.js`);
            await app.openPage('memory'); await app.openPage('presets', { focusPage: true }); await app.setExpanded(true);
        }, B).then(() => page.locator('#ri-bank-page').waitFor({ state: 'attached' })).then(() => page.waitForTimeout(600));
        await openPresets();
        // The open page: which view the switch shows, a mark on the drawn page body (a redraw replaces it) and the scroll.
        const state = () => page.evaluate(() => {
            const body = document.getElementById('ri_panel_page');
            return { view: document.getElementById('ri-bank-page')?.dataset.view, marked: body?.dataset.b63 === '1', scroll: body?.scrollTop ?? -1 };
        });
        const mark = () => page.evaluate(() => { const body = document.getElementById('ri_panel_page'); if (body) body.dataset.b63 = '1'; });
        const centre = async selector => {
            const control = page.locator(selector);
            await control.scrollIntoViewIfNeeded();
            const box = await control.boundingBox();
            return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        };
        const touchHold = async ({ x, y }) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await page.waitForTimeout(HOLD);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        const mouseHold = async ({ x, y }) => {
            await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(HOLD); await page.mouse.up();
        };
        // One try: aim at the switch for the other view, wait for the next background change, press, then check.
        const tryOnce = async (i, { press, cause }) => {
            const before = await state();
            const want = before.view === 'bank' ? 'stack' : 'bank';
            const at = await centre(`#ri-bk-view-${want}`);
            await mark();
            const scroll = (await state()).scroll;
            const seen = await page.evaluate(() => { globalThis.__riB63.lost = 0; return globalThis.__riB63.changes; });
            await cause();
            await page.waitForFunction(n => globalThis.__riB63.changes > n, seen, { polling: 'raf', timeout: 30000 });
            await press(at);
            await page.waitForTimeout(400);
            const after = await state();
            const lost = await page.evaluate(() => globalThis.__riB63.lost);
            return { i, want, view: after.view, redrawn: !after.marked, lost, scroll, after: after.scroll };
        };
        const run = async (label, options) => {
            const rows = [];
            for (let i = 0; i < TRIES; i++) {
                rows.push(await tryOnce(i, options));
                await options.settle?.();
            }
            const missed = rows.filter(row => row.view !== row.want);
            fs.writeFileSync(path.join(OUT, `w${WIDTH}-${label}.json`), JSON.stringify(rows, null, 1));
            console.log(label, JSON.stringify({ tries: rows.length, missed: missed.length, redrawn: rows.filter(row => row.redrawn).length }));
            return { rows, missed };
        };

        // A. A reply from the mock lands while she presses: the reply, its capture and every update after it.
        const reply = async () => {
            L.mode({ reply: PROSE });
            const before = await page.evaluate(() => { const $ = globalThis.jQuery; const n = globalThis.SillyTavern.getContext().chat.length;
                $('#send_textarea').val('I look at the stall.').trigger('input'); $('#send_but').trigger('click'); return n; });
            // Her message and the reply to it are both in the chat.
            await page.waitForFunction(n => { const c = globalThis.SillyTavern.getContext().chat; return c.length >= n + 2 && !c.at(-1).is_user && c.at(-1).mes && c.at(-1).mes !== '...'; }, before, { timeout: 60000, polling: 'raf' });
        };
        const a = await run('touch-reply', { press: touchHold, cause: reply, settle: () => L.idle(page) });
        check(!a.missed.length, `A: a touch held on the Stack and Bank switch as a reply lands takes effect on ${TRIES - a.missed.length} of ${TRIES} tries`);
        check(a.rows.every(row => !row.lost), `A: the element under her finger stays in the page until she lifts it (${a.rows.filter(row => row.lost).length} replaced)`);
        check(a.rows.every(row => row.redrawn), `A: the page still redraws after each background update (${a.rows.filter(row => row.redrawn).length} of ${TRIES})`);
        check(a.rows.every(row => Math.abs(row.after - row.scroll) <= 1), 'A: the page keeps its scroll position across each redraw');
        await shot('a-touch');

        // B. A mouse press while the host announces a background update (as when a capture or upkeep job ends).
        const update = () => page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return c.eventSource.emit(c.eventTypes.MESSAGE_UPDATED, c.chat.length - 1); });
        const b = await run('mouse-update', { press: mouseHold, cause: update });
        check(!b.missed.length, `B: a mouse press on the switch as a background update lands takes effect on ${TRIES - b.missed.length} of ${TRIES} tries`);
        check(b.rows.every(row => !row.lost), `B: the element under the pointer stays in the page until it is released (${b.rows.filter(row => row.lost).length} replaced)`);
        check(b.rows.every(row => row.redrawn), `B: the page still redraws after each background update (${b.rows.filter(row => row.redrawn).length} of ${TRIES})`);

        // C. The Sent card under the latest reply stays open and filled across background updates.
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.setExpanded(false); }, B);
        // The Sent card is in the tray, as when she turns it on in Setup, Look, Reply tray, and what was sent is shown.
        await L.setSettings(page, { showUnder: 'display' });
        await page.evaluate(async B => { const Q = await import(`${B}/src/ui/tray-settings.js`); const cfg = Q.trayCardConfig(); Q.saveCardConfig({ ...cfg, mode: { ...cfg.mode, sent: 'tray' } }); }, B);
        const sent = () => page.evaluate(() => {
            const tray = document.querySelector(`#chat .mes[mesid="${globalThis.SillyTavern.getContext().chat.length - 1}"] .ri-tray:not(.ri-tray-loading)`);
            return { selected: tray?.dataset.selected || '', view: tray?.dataset.view || '', text: (tray?.querySelector('.ri-tray-panel[aria-label="Sent"]')?.innerText || '').trim().length, id: tray?.dataset.reply };
        });
        // The centre of the latest tray's Sent chip (Expanded view), or of its Expanded view button when the chips are not drawn.
        const sentTarget = () => page.evaluate(() => {
            const tray = document.querySelector(`#chat .mes[mesid="${globalThis.SillyTavern.getContext().chat.length - 1}"] .ri-tray:not(.ri-tray-loading)`);
            const chip = [...(tray?.querySelectorAll('.ri-tray-chip') || [])].find(b => b.textContent.trim() === 'Sent');
            const control = chip || tray?.querySelector('.ri-tray-view[aria-label="Expanded"]');
            if (!control) return null;
            control.scrollIntoView({ block: 'center' });
            const box = control.getBoundingClientRect();
            return { chip: !!chip, x: box.left + box.width / 2, y: box.top + box.height / 2 };
        });
        const tapAt = async ({ x, y }) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await page.waitForTimeout(HOLD);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        // She taps Sent as the reply lands (one tap on Expanded first when the tray shows another view).
        const steps = [];
        const openSent = async () => {
            for (let step = 0; step < 2; step++) {
                const target = await sentTarget();
                steps.push(target ? (target.chip ? 'chip' : 'expanded') : 'none');
                if (!target) return false;
                await tapAt(target);
                if (target.chip) return true;
                await page.waitForTimeout(150);
            }
            return false;
        };
        let kept = 0;
        const sentRows = [];
        for (let i = 0; i < CARDS; i++) {
            await reply();
            await page.waitForFunction(() => !!document.querySelector(`#chat .mes[mesid="${globalThis.SillyTavern.getContext().chat.length - 1}"] .ri-tray:not(.ri-tray-loading)`), null, { timeout: 30000, polling: 'raf' });
            await page.evaluate(() => { globalThis.__riB63.lost = 0; });
            const opened = await openSent();
            const lost = await page.evaluate(() => globalThis.__riB63.lost);
            const first = await sent();
            await L.idle(page);
            await page.evaluate(async B => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, B);
            await update();
            await page.waitForTimeout(500);
            const last = await sent();
            sentRows.push({ i, opened, lost, steps: steps.splice(0), first, last });
            if (opened && !lost && last.view === 'expanded' && last.selected === 'sent' && last.text > 0) kept++;
        }
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-sent.json`), JSON.stringify(sentRows, null, 1));
        console.log('sent', JSON.stringify(sentRows));
        check(kept === CARDS, `C: the Sent card tapped as a reply lands opens and stays open and filled across its background updates (${kept} of ${CARDS})`);
        await shot('c-sent');

        const real = errors.filter(e => !/WebSocket|net::ERR|favicon|ResizeObserver/.test(e));
        check(!real.length, `no page errors (${real.slice(0, 3).join(' | ')})`);
    } catch (error) {
        console.error(error.stack || error);
        process.exitCode = 1;
    } finally {
        await browser.close();
        console.log(failed ? `${failed} FAILED` : 'ALL PASS');
    }
})();
