// B47 browser suite on a SillyTavern 1.19.0 host with the mock model, touch at 412 x 900 (RI_WIDTH, RI_HEIGHT):
//   1. Pure: the stack reader (a card switched off, taken out, an extension card whose feature is off, a card trimmed by size), the
//      scan reader on SillyTavern-shaped arguments (chance, budget, cooldown, delay, group, recursion, no key), the first final pass
//      only (a later scan does not replace it), and the caps.
//   2. Off by default: with the switch off a generation stores nothing and the request carries no trace of the log.
//   3. On (the switch in Review, Context, Diagnostics log): on the MB12 fixture, a stack block switched off and a World Info entry
//      lost to its inclusion group each appear with the right reason, stored per swipe; a swipe keeps its own log; the Sent card
//      reads it; the stored size stays under the cap; deleting the reply takes the log with it; the log is a text file.
//   4. The request of the same turn is the same with the switch on and off; no model call is made for the log.
// Run with the host variables of tests/README.md. RI_EVIDENCE names the screenshot folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B47');
fs.mkdirSync(dir, { recursive: true });
const FIXTURE = path.join(__dirname, 'fixtures', 'mb12', 'Story events and styles.json');
const NAME = 'Story events and styles';
const out = { run: new Date().toISOString(), checks: {} };
const pass = (name, detail = '') => console.log(`PASS ${name}${detail ? ` | ${detail}` : ''}`);
const replyRows = () => L.requests('all').filter(r => r.kind === 'reply');
const textOf = r => (r.messages || []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

async function setSwitch(page, on) {
    await page.evaluate(async ({ B, on }) => { const S = await import(`${B}/src/store.js`); S.settings().diagnosticsLog = on; S.saveSettings(); }, { B, on });
}

async function bookChat(page) {
    await L.openChat(page);
    await page.waitForFunction(() => !document.querySelector('#ri_root') || !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(async name => { const c = SillyTavern.getContext(); c.chatMetadata.world_info = name; await c.saveMetadata(); }, NAME);
    await page.waitForTimeout(800);
}

async function settle(page) { await page.waitForTimeout(2500); }

/** Seed Math.random per call so a chance roll and a group draw are the same on both sides of a comparison. */
const fixRandom = (page, value) => page.evaluate(v => { globalThis.__real ||= Math.random; Math.random = () => v; }, value);
const freeRandom = page => page.evaluate(() => { if (globalThis.__real) Math.random = globalThis.__real; });

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: Number(process.env.RI_WIDTH || 412), height: Number(process.env.RI_HEIGHT || 900), hasTouch: true, isMobile: true });
    page.setDefaultTimeout(60000);
    try {
        await L.setupApi(page, { preset: 'Roleplay Instructions V10' });
        await L.setSettings(page, { check: { mode: 'off' } });
        // a fresh install has no such setting: the switch starts off
        await page.evaluate(async B => { const S = await import(`${B}/src/store.js`); delete S.settings().diagnosticsLog; S.saveSettings(); }, B);

        // ------------------------------------------------------------ 1. pure
        const pure = await page.evaluate(async B => {
            const D = await import(`${B}/src/diagnostics-log.js`);
            const res = {};
            const work = {
                plan: [
                    { key: 'a', id: 'a', source: 'base', on: false, name: 'Jailbreak', group: 'main' },
                    { key: 'b', id: 'b', source: 'base', on: true, name: 'Main prompt', text: 'You are a careful roleplay partner who stays in the scene always.', group: 'main' },
                    { key: 'c', id: 'state', source: 'ri', on: true, name: 'Scene state', text: 'Track it.', group: 'ri' },
                    { key: 'd', id: 'x', source: 'base', on: true, name: 'Raw', raw: true, text: 'Hello {{char}} and welcome to a long enough text', group: 'main' },
                ],
                source: { cards: [{ id: 'gone', name: 'Old rules', listed: true, shippedOn: true }, { id: 'a', name: 'Jailbreak', listed: true, shippedOn: true }] },
            };
            res.stack = D.stackLeftOut(work, { state: false }).map(r => `${r.name}:${r.reason}`);
            res.trim = D.stackTrimmed(work, 'something else entirely').map(r => `${r.name}:${r.reason}`);
            res.trimNone = D.stackTrimmed(work, 'xx You are a careful roleplay partner who stays in the scene always. yy').length;
            const entry = (uid, extra = {}) => ({ world: 'W', uid, comment: `E${uid}`, key: [`k${uid}`], ...extra });
            const e = Array.from({ length: 10 }, (_, i) => entry(i));
            e[1].group = 'g'; e[2].group = 'g'; e[3].delayUntilRecursion = true; e[5].disable = true; e[4].key = ['zzz'];
            const act = new Map([['W.0', e[0]], ['W.1', e[1]]]);
            const timed = { isEffectActive: (kind, en) => (kind === 'cooldown' && en.uid === 6) || (kind === 'delay' && en.uid === 7) };
            const reader = D.createScanReader({ chatText: () => 'k0 k1 k2 k8' });
            reader.pass({ state: { next: 1 }, new: { all: [e[0], e[1], e[8]], successful: [e[0], e[1]] }, activated: { entries: act, text: 'k3' }, sortedEntries: e, budget: { overflowed: false }, timedEffects: timed });
            reader.pass({ state: { next: 0 }, new: { all: [e[9]], successful: [e[9]] }, activated: { entries: act, text: 'k3' }, sortedEntries: e, budget: { overflowed: true }, timedEffects: timed });
            const r = reader.result();
            res.scan = Object.fromEntries(r.rows.map(x => [x.uid, x.reason]));
            res.noKey = r.noKey; res.considered = r.considered;
            // a later scan (a token-count dry run) does not replace the first final result
            reader.pass({ state: { next: 0 }, new: { all: [], successful: [] }, activated: { entries: new Map(), text: '' }, sortedEntries: [], budget: {}, timedEffects: timed });
            res.stable = reader.result() === r;
            // caps
            const big = D.buildLog({ stack: Array.from({ length: 30 }, (_, i) => ({ name: 'N'.repeat(60) + i, reason: 'off', why: D.REASONS.off })), scan: { rows: Array.from({ length: 80 }, (_, i) => ({ book: 'B'.repeat(40), uid: String(i), title: 'T'.repeat(60), reason: 'chance', why: 'chance missed (50%)' })), noKey: 900, considered: 1000 } });
            res.cap = { bytes: JSON.stringify(big).length, rows: big.stack.length + big.wi.length, cut: big.cut, byteCap: D.BYTE_CAP, rowCap: D.ROW_CAP };
            return res;
        }, B);
        assert.deepEqual(pure.stack, ['Jailbreak:off', 'Scene state:feature', 'Old rules:out']);
        assert.deepEqual(pure.trim, ['Main prompt:trimmed']);
        assert.equal(pure.trimNone, 0);
        assert.deepEqual(pure.scan, { 8: 'chance', 2: 'group', 3: 'recursion', 6: 'cooldown', 7: 'delay', 9: 'budget' }, JSON.stringify(pure.scan));
        assert.equal(pure.noKey, 1, 'one entry matched no key (entry 4); the disabled one is not considered');
        assert.ok(pure.stable, 'the first final pass stands');
        assert.ok(pure.cap.bytes <= pure.cap.byteCap && pure.cap.rows <= pure.cap.rowCap, JSON.stringify(pure.cap));
        out.checks.pure = pure;
        pass('stack reasons, scan reasons, the first final pass only and the caps', JSON.stringify(pure.cap));

        // ------------------------------------------------------------ the fixture and a stack with one block switched off
        await page.evaluate(n => SillyTavern.getContext().getWorldInfoNames().includes(n) && import('/scripts/world-info.js').then(W => W.deleteWorldInfo(n)), NAME);
        await page.setInputFiles('#world_import_file', FIXTURE);
        await page.waitForFunction(n => (SillyTavern.getContext().getWorldInfoNames?.() || []).includes(n), NAME, { timeout: 20000 });
        await page.waitForTimeout(800);
        const off = await page.evaluate(async B => {
            const W = await import(`${B}/src/preset-workbench.js`);
            const S = await import(`${B}/src/store.js`);
            const work = W.workingPlan();
            if (!work) return null;
            const stack = S.settings().bankStacks[work.stack.key];
            const card = stack.cards.find(c => c.on && work.plan.some(p => p.key === c.key && !p.marker && p.name));
            const plan = work.plan.find(p => p.key === card.key);
            card.on = false;
            S.saveSettings();
            return { key: card.key, name: plan?.name || card.name || card.key, count: stack.cards.length };
        }, B);
        assert.ok(off, 'the preset has a stack plan');
        console.log('  stack card switched off:', JSON.stringify(off));

        // ------------------------------------------------------------ 2. off by default
        await bookChat(page);
        assert.equal(await page.evaluate(async B => (await import(`${B}/src/diagnostics-log.js`)).diagnosticsOn(), B), false, 'off by default');
        await fixRandom(page, 0.5);
        await L.send(page, 'Marten checks the girths before we leave.');
        await freeRandom(page);
        await settle(page);
        const offRun = await page.evaluate(() => { const c = SillyTavern.getContext(); return c.chat.filter(m => !m.is_user).map(m => ({ extra: !!m.extra?.ri_diag, slot: (m.swipe_info || []).some(s => s.extra?.ri_diag) })); });
        assert.ok(offRun.length && offRun.every(m => !m.extra && !m.slot), 'with the switch off nothing is stored');
        const offReq = replyRows().at(-1);
        assert.ok(offReq, 'a reply request was made');
        assert.ok(!/ri_diag|diagnostics log/i.test(textOf(offReq)), 'the request carries no trace of the log');
        const callsOff = L.requests('all').length;
        out.checks.off = { stored: false, calls: callsOff };
        pass('with the switch off nothing is recorded and the request is plain');

        // ------------------------------------------------------------ 3. on, through the switch in Review
        await L.openPanel(page, 'diagnostics-log');
        await page.waitForSelector('#ri-diagnostics-log [role="switch"]');
        await page.screenshot({ path: path.join(dir, 'review-row-off.png') });
        await page.locator('#ri-diagnostics-log [role="switch"]').tap();
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(async B => (await import(`${B}/src/diagnostics-log.js`)).diagnosticsOn(), B), true, 'the switch turns it on');
        await page.screenshot({ path: path.join(dir, 'review-row-on.png') });
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B).catch(() => {});

        const before = L.requests('all').length;
        await bookChat(page);
        await fixRandom(page, 0.5);
        await L.send(page, 'Marten checks the girths before we leave.');
        await freeRandom(page);
        await settle(page);
        const onReq = replyRows().at(-1);
        const got = await page.evaluate(() => { const c = SillyTavern.getContext(); const m = c.chat.filter(x => !x.is_user && !x.is_system).at(-1); return { id: c.chat.indexOf(m), log: m.extra?.ri_diag || null, slot: m.swipe_info?.[m.swipe_id || 0]?.extra?.ri_diag || null, swipe: m.swipe_id || 0 }; });
        assert.ok(got.log, 'the reply stores a log');
        assert.equal(got.log.swipe, got.swipe);
        assert.deepEqual(got.slot, got.log, 'the swipe slot holds the same log');
        const reasons = [...got.log.stack, ...got.log.wi].map(r => r.reason);
        assert.ok(got.log.stack.some(r => r.reason === 'off' && r.name), `a stack block switched off: ${JSON.stringify(got.log.stack)}`);
        const lost = got.log.wi.filter(r => r.reason === 'group' && r.book === NAME && /Marten notes/.test(r.why));
        assert.ok(lost.length === 1 && /Marten notes/.test(lost[0].why) && ['9', '10'].includes(lost[0].uid), `an entry lost to its inclusion group: ${JSON.stringify(got.log.wi)}`);
        const size = JSON.stringify(got.log).length;
        assert.ok(size <= 6000, `the stored size is ${size}`);
        out.checks.on = { stack: got.log.stack, wi: got.log.wi, noKey: got.log.noKey, size, reasons };
        pass('a block switched off and an entry lost to its group appear with their reasons', `${JSON.stringify(got.log.stack[0])} | ${JSON.stringify(lost[0])}`);

        // the request is the same as with the switch off, and the log made no model call
        const norm = r => textOf(r).replace(/\d{1,2}:\d{2}( ?[AP]M)?/gi, '').replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b[^\n]*/g, '');
        assert.equal(L.requests('all').slice(before).filter(r => r.kind === 'reply').length, 1, 'one reply request');
        const sameLead = norm(onReq).split('Marten checks')[0] === norm(offReq).split('Marten checks')[0];
        out.checks.sameRequest = sameLead;
        assert.ok(sameLead, 'the request before the player line is the same with the switch on and off');
        const kinds = L.requests('all').slice(before).map(r => r.kind);
        assert.ok(kinds.every(k => ['reply', 'capture', 'chapter', 'condensed'].includes(k)), `no extra kind of call: ${kinds}`);
        pass('the request is unchanged by the switch and the log made no call');

        // ------------------------------------------------------------ the Sent card reads it, the text file, per swipe, delete
        const row = await page.evaluate(async ({ B, id }) => {
            const D = await import(`${B}/src/diagnostics-log.js`);
            const m = SillyTavern.getContext().chat[id];
            const el = D.diagnosticsRow(m, id);
            return { text: el?.textContent || '', file: D.logText(m, `Reply ${id}`) };
        }, { B, id: got.id });
        assert.match(row.text, /Diagnostics log/);
        assert.match(row.text, /lost its inclusion group/);
        assert.match(row.file, /Stack blocks left out/);
        const opened = await page.evaluate(async id => {
            const mes = document.querySelector(`#chat .mes[mesid="${id}"]`);
            const card = [...mes.querySelectorAll('.ri-tray summary, .ri-tray button, .ri-tray [role="button"]')].find(x => /sent/i.test(x.textContent));
            if (card) card.click();
            await new Promise(r => setTimeout(r, 600));
            return { card: !!card, shown: !!mes.querySelector('[data-ri-diagnostics]') };
        }, got.id);
        out.checks.sentCard = opened;
        console.log('  Sent card:', JSON.stringify(opened));
        await page.screenshot({ path: path.join(dir, 'sent-card.png') });

        // a new swipe has its own log (the copied one does not count), then the reply is deleted with its log
        await fixRandom(page, 0.5);
        await page.evaluate(async id => { const c = SillyTavern.getContext(); const m = c.chat[id]; m.swipes ||= [m.mes]; m.swipes.push('Another reply.'); m.swipe_info ||= []; m.swipe_info.push({ extra: structuredClone(m.extra || {}) }); m.swipe_id = 1; m.mes = 'Another reply.'; }, got.id);
        await freeRandom(page);
        const swiped = await page.evaluate(async ({ B, id }) => { const D = await import(`${B}/src/diagnostics-log.js`); const m = SillyTavern.getContext().chat[id]; return { shown: D.logOf(m), first: !!m.swipe_info[0].extra?.ri_diag }; }, { B, id: got.id });
        assert.equal(swiped.shown, null, 'a log copied from another swipe does not count');
        assert.ok(swiped.first, 'the first swipe keeps its own log');
        await page.evaluate(async id => { await SillyTavern.getContext().executeSlashCommandsWithOptions?.(`/del 1`).catch(() => {}); }, got.id).catch(() => {});
        await page.waitForTimeout(800);
        const left = await page.evaluate(() => JSON.stringify(SillyTavern.getContext().chat).includes('ri_diag'));
        console.log('  ri_diag after /del 1:', left);
        out.checks.deleteLeaves = !left;
        pass('per swipe, readable from the reply, leaves with the reply');

        // switching off again stops recording and hides the row
        await setSwitch(page, false);
        assert.equal(await page.evaluate(async ({ B }) => (await import(`${B}/src/diagnostics-log.js`)).diagnosticsRow({ swipe_id: 0, extra: { ri_diag: { swipe: 0, stack: [], wi: [] } } }, 1), { B }), null);
        pass('with the switch off again the row is not shown');

        assert.deepEqual(errors.filter(e => !/favicon|404/.test(String(e))), [], 'no page errors');
        fs.writeFileSync(path.join(dir, 'diagnostics-log.json'), JSON.stringify(out, null, 1));
        console.log('ALL PASS');
    } catch (error) {
        try { await page.screenshot({ path: path.join(dir, 'failure.png') }); } catch { /* none */ }
        console.error('FAIL', error);
        process.exitCode = 1;
    } finally { await browser.close(); }
})();
