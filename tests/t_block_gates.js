// B56: the block bank keeps a block's reply-number gate, its in-chat position and depth, its reply types and its role, and
// the stack sends them. Drives SillyTavern 1.19.0 with the mock model by touch at RI_WIDTH (default 390, the phone width)
// and reads the request the mock logged (never a rebuilt copy). It checks:
//   - importing a preset file keeps notBefore, the in-chat position, depth, reply types and role, and the import report
//     names none of them, on the first import and on a re-import;
//   - a block with notBefore 5 is left out of replies 1 to 4 (a swipe of reply 4 included) and sent from reply 5 on;
//   - a block in the chat at depth 2 reaches the request two chat messages from the end with its role; a block for
//     continue only stays out of a normal reply;
//   - the card shows the gate, position and role; the Placement editor changes them and the next request follows;
//     Use the source placement takes her values back;
//   - an import record and stack saved before B56 (no placement, gate or her values) send as before.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE (screenshots, requests and results.json), RI_WIDTH.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = Number(process.env.RI_WIDTH || 390);
const NARROW = WIDTH < 760;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B56');
fs.mkdirSync(OUT, { recursive: true });
const results = { width: WIDTH, host: process.env.RI_HOST_URL, steps: [] };
const companion = JSON.parse(fs.readFileSync(path.join(__dirname, '../presets/Roleplay Instructions V10.json'), 'utf8'));

const LATE = 'B56 LATE: Something stirs in the hall.';
const DEPTH = 'B56 DEPTH: Remind the narrator of the weather.';
const CONT = 'B56 CONTINUE ONLY: pick up the sentence where it stopped.';
const OLD = 'B56 OLD RECORD: keep the lamps lit.';
const FILE = 'B56 gates.json';
const fixture = { prompt_order: [{ character_id: 100000, order: ['late', 'depth', 'cont'].map(identifier => ({ identifier, enabled: true })) }], prompts: [
    { identifier: 'late', name: 'Late Beat', content: `{{if {{getvar::turn}} >= 5}}${LATE}{{/if}}` },
    { identifier: 'depth', name: 'Depth Two', role: 'user', injection_position: 1, injection_depth: 2, content: DEPTH },
    { identifier: 'cont', name: 'Continue Only', injection_position: 1, injection_depth: 1, injection_trigger: ['continue'], content: CONT },
] };

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: NARROW ? 780 : 909, hasTouch: true, isMobile: NARROW });
    page.on('pageerror', error => console.error(error.stack));
    const B = L.BASE;
    const ev = (fn, value) => page.evaluate(fn, { B, value });
    const shot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(OUT, `w${WIDTH}-${name}.png`) }); };
    const root = page.locator('#ri-bank-page');
    const tap = async locator => {
        await locator.scrollIntoViewIfNeeded();
        const box = await locator.boundingBox();
        assert.ok(box, 'the control is on screen');
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(200);
    };
    const openPresets = () => ev(async ({ B }) => { const { app } = await import(`${B}/src/ui/panel.js`); await app.openPage('memory'); await app.openPage('presets', { focusPage: true }); await app.setExpanded(true); })
        .then(() => root.waitFor({ state: 'attached' })).then(() => page.waitForTimeout(600));
    const view = async name => { if (NARROW) await tap(root.locator(name === 'bank' ? '#ri-bk-view-bank' : '#ri-bk-view-stack')); };
    const card = text => root.locator('.ri-bk-card[data-where="stack"]').filter({ has: page.locator(':scope > .ri-bk-line .ri-bk-name', { hasText: new RegExp(`^${text}$`) }) }).first();
    const expand = async locator => { if (!await locator.locator(':scope > .ri-bk-detail').count()) await tap(locator.locator(':scope > .ri-bk-line .ri-bk-name')); };
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    // The stored stack item of a card, by its name.
    const item = name => ev(async ({ B, value }) => {
        const bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
        const b = bank.currentBank() || bank.refreshBank('t');
        const s = bank.stackFor(b, V.activePreset());
        return bank.storedStack(s.key).cards.find(entry => entry.name === value) || null;
    }, name);
    let turn = 0;
    // One reply, and the logged request: { text, messages, reply }.
    const send = async (label, how = 'send') => {
        L.resetLog();
        L.mode({ reply: 'Mira waits.' });
        if (how === 'swipe') await L.swipe(page);
        else if (how === 'continue') { await L.slash(page, '/continue'); await L.idle(page); }
        else await L.send(page, `B56 turn ${++turn}.`);
        const rows = L.requests('reply');
        assert.ok(rows.length >= 1, `${label}: a reply request was logged`);
        const row = rows.at(-1);
        const text = L.text(row);
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-request-${label}.json`), JSON.stringify(row.messages, null, 2));
        return { text, messages: row.messages || [] };
    };
    const isTurn = m => typeof m.content === 'string' && (m.content.includes('B56 turn ') || m.content.trim() === 'Mira waits.');
    // Where a block landed: its role and how many chat messages follow it in the request.
    const placed = (messages, needle) => {
        const at = messages.findIndex(m => typeof m.content === 'string' && m.content.includes(needle));
        if (at < 0) return null;
        return { role: messages[at].role, after: messages.slice(at + 1).filter(isTurn).length, before: messages.slice(0, at).filter(isTurn).length };
    };
    const mark = (label, data) => results.steps.push({ label, ...data });

    try {
        await L.setupApi(page);
        await ev(async ({ B }) => {
            const S = await import(`${B}/src/store.js`), bank = await import(`${B}/src/preset-bank.js`);
            const st = S.settings();
            for (const name of ['bankStacks', 'bankVersions', 'bankTexts', 'bankImports', 'bankTags', 'importReports']) st[name] = {};
            S.saveSettings();
            bank.resetBank();
        });
        await page.evaluate(data => SillyTavern.getContext().getPresetManager('openai').savePreset(data.name, data), companion);
        await L.usePreset(page, companion.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, world: { update: 'all', head: 0 } });
        await L.openChat(page);
        await ev(async ({ B }) => { const V = await import(`${B}/src/v10.js`); if (!V.enabledV10()) throw new Error(`V10 is off on ${V.activePreset()}`); });

        // 1. Import twice through the import's own path; nothing these blocks hold is reported lost.
        const imported = await ev(async ({ B, value }) => {
            const I = await import(`${B}/src/bank-import.js`), R = await import(`${B}/src/import-report.js`);
            const run = async () => {
                const found = I.readImportFile(value.file, JSON.stringify(value.data));
                const sent = await I.sendBlocksToBlockBank(found.blocks);
                return { report: R.reportImport({ found, picked: [], group: I.importGroup(found.file, 1), sent, items: new Map() }), stored: sent.stored?.[0]?.stored || [], counts: sent.stored?.[0] };
            };
            const first = await run(), again = await run();
            return { first: first.report, again: again.report, stored: again.stored, kept: again.counts?.kept };
        }, { file: FILE, data: fixture });
        assert.equal(imported.first, null, 'the first import reports nothing lost');
        assert.equal(imported.again, null, 'a re-import reports nothing lost');
        const rec = Object.fromEntries(imported.stored.map(r => [r.name, r]));
        assert.equal(rec['Late Beat'].notBefore, 5, 'the gate is stored');
        assert.deepEqual([rec['Depth Two'].placement.position, rec['Depth Two'].placement.depth, rec['Depth Two'].role], [1, 2, 'user'], 'position, depth and role are stored');
        assert.deepEqual(rec['Continue Only'].placement.triggers, ['continue'], 'the reply types are stored');
        assert.equal(imported.kept, 3, 'the re-import keeps every block as it was');
        mark('import', { stored: imported.stored.map(r => ({ name: r.name, role: r.role, placement: r.placement, notBefore: r.notBefore || 0 })) });

        // 2. Put the three blocks in the stack (her taps through the bank functions).
        await ev(async ({ B }) => {
            const bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
            const b = bank.currentBank() || bank.refreshBank('t'), base = V.activePreset();
            const keys = [...b.cards.values()].filter(c => bank.isImportSource(c.source) && c.sourceName === 'B56 gates').map(c => c.key);
            if (keys.length !== 3) throw new Error(`expected 3 imported cards, found ${keys.length}`);
            bank.includeCards(b, bank.stackFor(b, base).key, keys, { base });
        });

        // 3. Replies 1 to 4 leave the gated block out (a swipe of reply 4 too); reply 5 sends it.
        for (let reply = 1; reply <= 4; reply++) {
            const r = await send(`reply-${reply}`);
            assert.equal(r.text.includes(LATE), false, `reply ${reply}: the block that starts at reply 5 is left out`);
            assert.equal(r.text.includes(CONT), false, `reply ${reply}: the continue-only block is left out of a normal reply`);
            // Every reply sends the stack's blocks, also when the scene job of the last reply or a token count lands while
            // this one is being built.
            const where = placed(r.messages, DEPTH);
            assert.ok(where, `reply ${reply}: the depth block is sent`);
            if (reply === 2) {
                assert.equal(where.after, 2, 'the depth block sits two chat messages from the end');
                assert.equal(where.role, 'user', 'the depth block keeps its role');
                mark('depth-2', where);
            }
        }
        const swiped = await send('reply-4-swipe', 'swipe');
        assert.equal(swiped.text.includes(LATE), false, 'a swipe of reply 4 is still reply 4');
        const fifth = await send('reply-5');
        assert.ok(fifth.text.includes(LATE), 'reply 5 sends the gated block');
        assert.equal(fifth.text.includes('getvar::turn'), false, 'the gate macro is not sent');
        assert.equal(placed(fifth.messages, LATE).before, 0, 'the gated block is in stack order, ahead of the chat');
        mark('gate', { leftOutThrough: 4, sentAt: 5 });
        const cont = await send('continue', 'continue');
        assert.ok(cont.text.includes(CONT), 'continue sends the continue-only block');
        mark('continue-only', placed(cont.messages, CONT));

        // 4. The cards show the gate, position and role.
        await openPresets();
        await view('stack');
        const late = card('Late Beat'), depth = card('Depth Two');
        await late.waitFor({ state: 'attached' });
        assert.match(await late.locator(':scope > .ri-bk-meta').textContent(), /From reply 5/);
        const depthMeta = await depth.locator(':scope > .ri-bk-meta').textContent();
        assert.match(depthMeta, /In the chat, depth 2/);
        assert.match(depthMeta, /As user/);
        assert.match(await card('Continue Only').locator(':scope > .ri-bk-meta').textContent(), /In the chat, depth 1/);
        await depth.scrollIntoViewIfNeeded();
        await shot('1-chips');
        // A background job that lands (the scene job after a reply) redraws the panel; the page keeps its place.
        const top = async () => (await depth.boundingBox())?.y;
        const shown = await top();
        await ev(async ({ B }) => { (await import(`${B}/src/ui/panel.js`)).render(); });
        await page.waitForTimeout(100);
        assert.equal(await top(), shown, 'a background redraw moved the stack');

        // 5. The Placement editor: depth 1 as assistant; the next request follows.
        await expand(depth);
        await tap(depth.locator('.ri-bk-tools button', { hasText: /^Placement$/ }));
        const editor = depth.locator('[data-placement-editor]');
        await editor.waitFor({ state: 'visible' });
        assert.match(await editor.textContent(), /read again each time/, 'the editor says what the placement costs');
        await editor.locator('[data-placement="depth"]').fill('1');
        await editor.locator('[data-placement="role"]').selectOption('assistant');
        assert.ok(await overflow() <= 1, 'no sideways scroll with the editor open');
        const controls = await editor.locator('button, select, input').evaluateAll(list => list.map(el => el.getBoundingClientRect().height));
        assert.ok(controls.every(height => height >= 32), `editor controls meet the hit size: ${controls}`);
        await shot('2-placement-editor');
        await tap(editor.locator('button', { hasText: /^Save placement$/ }));
        const saved = await item('Depth Two');
        assert.deepEqual(saved.set, { role: 'assistant', depth: 1 }, 'her values save on the stack card');
        assert.match(await card('Depth Two').locator(':scope > .ri-bk-meta').textContent(), /Placed by you/);
        const moved = await send('after-placement');
        const where = placed(moved.messages, DEPTH);
        assert.deepEqual([where.after, where.role], [1, 'assistant'], 'the next request sends it at depth 1 as assistant');
        mark('placement-edit', where);

        // 6. The first reply set in the editor: 12 holds the gated block back again; Use the source placement brings it back.
        await openPresets();
        await view('stack');
        await expand(card('Late Beat'));
        await tap(card('Late Beat').locator('.ri-bk-tools button', { hasText: /^Placement$/ }));
        const lateEditor = card('Late Beat').locator('[data-placement-editor]');
        await lateEditor.locator('[data-placement="notBefore"]').fill('12');
        await tap(lateEditor.locator('button', { hasText: /^Save placement$/ }));
        assert.match(await card('Late Beat').locator(':scope > .ri-bk-meta').textContent(), /From reply 12/);
        const held = await send('gate-12');
        assert.equal(held.text.includes(LATE), false, 'her first reply of 12 holds the block back');
        await expand(card('Late Beat'));
        if (!await card('Late Beat').locator('[data-placement-editor]').count()) await tap(card('Late Beat').locator('.ri-bk-tools button', { hasText: /^Placement$/ }));
        await tap(card('Late Beat').locator('[data-placement-editor] button', { hasText: /^Use the source placement$/ }));
        assert.equal((await item('Late Beat')).set, undefined, 'her values are taken back');
        const back = await send('gate-source');
        assert.ok(back.text.includes(LATE), 'the source gate of 5 applies again');
        mark('gate-edit', { held: true, back: true });

        // 7. Saved before B56: an import record with no placement or gate and a stack card with none of her values.
        const oldSent = await ev(async ({ B, value }) => {
            const S = await import(`${B}/src/store.js`), bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
            S.settings().bankImports.old0000001 = { id: 'old0000001', file: 'Old file.json', name: 'Old file', at: 1, blocks: [{ id: 'old-rule', name: 'Old Rule', text: value, role: 'system' }], lineage: { 'old-rule': 'Old Rule' } };
            S.saveSettings();
            const b = bank.refreshBank('t'), base = V.activePreset();
            const key = bank.stackFor(b, base).key;
            bank.includeCards(b, key, ['imp:old0000001::old-rule'], { base });
            const stored = bank.storedStack(key).cards.find(entry => entry.name === 'Old Rule');
            return { stored, plan: bank.stackPlan(bank.currentBank(), bank.storedStack(key), base).find(entry => entry.name === 'Old Rule') };
        }, OLD);
        assert.ok(!('notBefore' in oldSent.stored) && !('set' in oldSent.stored), 'the stack card holds no B56 fields');
        assert.equal(oldSent.plan.notBefore, 0);
        assert.equal(oldSent.plan.placement.position, 0);
        const old = await send('old-record');
        assert.ok(old.text.includes(OLD), 'an old record is sent from the start');
        assert.equal(placed(old.messages, OLD).before, 0, 'in stack order, as before');
        mark('old-record', { sent: true });

        assert.deepEqual(errors, [], 'no page errors');
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-results.json`), JSON.stringify(results, null, 2));
        console.log(`B56 block gates passed at ${WIDTH}`);
    } catch (error) {
        console.error(error);
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-results.json`), JSON.stringify({ ...results, error: String(error?.stack || error) }, null, 2));
        process.exitCode = 1;
    } finally { await browser.close(); }
})();
