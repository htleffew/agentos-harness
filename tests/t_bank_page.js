// B32: the bank and stack page (Setup, Presets). Drives SillyTavern 1.19.0 with the mock model by touch at one width
// (RI_WIDTH, default 523; run again with 1006) and checks every acceptance criterion against the real stack in settings and
// the real request the mock logged:
//   - copies of one edition share one stack, and a row only one copy holds shows "In another copy" on the other;
//   - blocks read from a file land in the bank through intakeBlocks; subtext and ambient switch on from the bank page and
//     reach the request without their event set rolling;
//   - the layout at the width (segmented views, the By feature grid, Compare as a sheet or as columns, placement mode);
//   - every loaded preset is in the bank with no add control; importing and deleting a preset while the page is open, and
//     a silent change found when the page opens again;
//   - Changed in source on the bank and stack cards, Take the new text only on her tap;
//   - Edit, Compare with clean, Reset to clean (asks first), Delete version; the clean card and her version both sent;
//   - source chip, tokens and include control on every card; a tap updates the stack count in the same task;
//   - opening, refreshing, switching views, Compare and a shortcut preview leave the stack unchanged; Apply and its undo;
//   - Move with Place here and the step buttons by tap; targets follow the size tokens and the size setting.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE (screenshots and results JSON), RI_WIDTH.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = Number(process.env.RI_WIDTH || 523);
const NARROW = WIDTH < 760;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B32');
fs.mkdirSync(OUT, { recursive: true });
const results = { width: WIDTH, host: process.env.RI_HOST_URL, checks: {} };
const companion = JSON.parse(fs.readFileSync(path.join(__dirname, '../presets/Roleplay Instructions V10.json'), 'utf8'));

const PROSE_A = 'Keep sentences short and concrete. Name one sense in every paragraph.';
const PROSE_B = 'Keep sentences short and concrete. Write the scene in past tense.';
const PROSE_B2 = 'Keep sentences short and concrete. Write the scene in present tense now.';
const MINE = 'Keep sentences short. Name one smell in every paragraph, always.';
const COPY_ONLY = 'B32 COPY ROW: only the second copy of the edition has this row.';
const SUBTEXT = 'B32 SUBTEXT ITEM: someone in the room hides what they want.';
const IMPORTED = 'B32 IMPORTED BLOCK: answer every question with a question.';
const WORDING = 'B32 WORDING: track who owes whom a favour, in one line per pair.';

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: NARROW ? 1021 : 909, hasTouch: true, isMobile: NARROW });
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
    // Opening the page: from another page, so Setup, Presets draws afresh as when she taps its tab.
    const openPresets = () => ev(async ({ B }) => { const { app } = await import(`${B}/src/ui/panel.js`); await app.openPage('memory'); await app.openPage('presets', { focusPage: true }); await app.setExpanded(true); })
        .then(() => root.waitFor({ state: 'attached' })).then(() => page.waitForTimeout(600));
    const view = async name => { if (NARROW) { await tap(root.locator(name === 'bank' ? '#ri-bk-view-bank' : '#ri-bk-view-stack')); } };
    // The real stack as stored in settings (or the chat pin), and its plan.
    const stack = () => ev(async ({ B }) => {
        const bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
        const b = bank.currentBank() || bank.refreshBank('t');
        const s = bank.stackFor(b, V.activePreset());
        const plan = bank.stackPlan(b, s, V.activePreset());
        return { key: s.key, json: JSON.stringify(bank.storedStack(s.key)), cards: s.cards.map(item => ({ key: item.key, on: item.on })),
            plan: plan.map(item => ({ key: item.key, on: item.on, status: item.status, elsewhere: item.elsewhere, text: item.text, name: item.name })) };
    });
    const storedJson = () => stack().then(s => s.json);
    const send = async label => {
        L.resetLog();
        L.mode({ reply: 'Mira waits.' });
        await L.send(page, 'I wait.');
        const rows = L.requests('reply');
        assert.ok(rows.length >= 1, `${label}: a reply request was logged`);
        const text = L.text(rows.at(-1));
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-request-${label}.txt`), text);
        return text;
    };
    // Open a card's detail unless it is open already (the page keeps open cards across redraws).
    const expand = async locator => { if (!await locator.first().locator(':scope > .ri-bk-detail').count()) await tap(locator.first().locator(':scope > .ri-bk-line .ri-bk-name')); };
    // Select a preset as base and point the connection back at the mock (a preset carries its own source settings).
    const select = async name => { await L.usePreset(page, name); await L.setupApi(page, { preset: null }); };
    const search = async text => {
        await view('bank');
        const box = root.locator('.ri-bk-search');
        await box.fill(text);
        await page.waitForTimeout(200);
    };
    const card = (where, text) => root.locator(`.ri-bk-card[data-where="${where}"]`).filter({ has: page.locator(':scope > .ri-bk-line .ri-bk-name', { hasText: new RegExp(`^${text}$`) }) }).first();
    const ok = async () => { const button = page.locator('dialog[open] .popup-button-ok'); await button.waitFor({ state: 'visible', timeout: 5000 }); await button.click(); await page.waitForTimeout(300); };
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    try {
        await L.setupApi(page);
        // A run starts from no stored stacks, versions, texts or imported files, so a run before it on this host leaves nothing
        // behind (run_browser.sh restores settings between suites; a single run does not).
        await ev(async ({ B }) => {
            const S = await import(`${B}/src/store.js`), bank = await import(`${B}/src/preset-bank.js`);
            const st = S.settings();
            for (const name of ['bankStacks', 'bankVersions', 'bankTexts', 'bankImports', 'bankTags']) st[name] = {};
            delete st.prompts;
            S.saveSettings();
            if (S.chatState()?.v10?.bankPins) { S.chatState().v10.bankPins = {}; S.saveChatState(); }
            bank.resetBank();
            // Loadouts an earlier run saved hold copies of the fixture blocks under the same names.
            const pm = SillyTavern.getContext().getPresetManager('openai');
            for (const entry of bank.listedPresets(pm).filter(entry => /^B32 .* \+ RI /.test(entry.name))) await pm.deletePreset(entry.name);
        });
        // Fixture presets, all invented text: a base, another preset with one shared sentence, and two copies of the companion
        // edition where only the second has one extra row.
        await page.evaluate(async ({ a, b, comp, only }) => {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            const block = (identifier, name, content) => ({ identifier, name, content, role: 'system', system_prompt: false });
            const from = (name, blocks, on = true) => {
                const data = JSON.parse(JSON.stringify(pm.getCompletionPresetByName('Default')));
                data.prompts = [...data.prompts.filter(p => !p.identifier.startsWith('b32-')), ...blocks];
                for (const group of data.prompt_order) group.order = [...group.order.filter(e => !e.identifier.startsWith('b32-')), ...blocks.map(x => ({ identifier: x.identifier, enabled: on }))];
                return pm.savePreset(name, data);
            };
            await from('B32 Base', [block('b32-prose', 'Prose rules', a)]);
            await from('B32 Other', [block('b32-other', 'Other prose', b)]);
            const second = JSON.parse(JSON.stringify(comp));
            second.prompts.push(block('b32-only', 'Copy only row', only));
            for (const group of second.prompt_order) group.order.push({ identifier: 'b32-only', enabled: true });
            await pm.savePreset(comp.name, comp);
            await pm.savePreset(`${comp.name}.432`, second);
        }, { a: PROSE_A, b: PROSE_B, comp: { ...companion, name: 'Roleplay Instructions V10' }, only: COPY_ONLY });

        // 1. Copies of one edition share one stack; the row only the second copy holds reads "In another copy" on the first.
        await L.usePreset(page, 'Roleplay Instructions V10.432');
        await L.setupApi(page, { preset: null });
        await L.openChat(page);
        await ev(async ({ B }) => {
            const S = await import(`${B}/src/store.js`), bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
            const st = S.settings();
            for (const name of ['bankStacks', 'bankVersions', 'bankTexts', 'bankImports', 'bankTags', 'bankConflicts']) st[name] = {};
            S.saveSettings();
            bank.resetBank();
            // A stack made on the second copy holds its extra row, as the starting stack of that copy.
            const b = bank.refreshBank('t');
            const s = bank.stackFor(b, V.activePreset());
            if (!s.cards.some(item => item.key === 'base::b32-only')) bank.includeCards(b, s.key, ['base::b32-only'], { base: V.activePreset() });
        });
        const second = await stack();
        assert.ok(second.plan.some(item => item.key === 'base::b32-only' && item.on && !item.elsewhere), 'on its own copy the row is a base row');
        await select('Roleplay Instructions V10');
        const first = await stack();
        assert.equal(first.key, second.key, 'both copies of the companion edition read one stored stack');
        const row = first.plan.find(item => item.key === 'base::b32-only');
        assert.ok(row, 'the shared stack holds the row from the second copy');
        assert.equal(row.elsewhere, 'Roleplay Instructions V10.432');
        assert.notEqual(row.status, 'removed');
        await openPresets();
        await view('stack');
        const copyCard = card('stack', 'Copy only row');
        assert.match(await copyCard.textContent(), /In another copy: Roleplay Instructions V10\.432/);
        assert.equal(await copyCard.locator('.ri-ps-chip', { hasText: 'Source removed' }).count(), 0);
        const sentCopy = await send('1-copy-row');
        assert.ok(sentCopy.includes(COPY_ONLY), 'the row from the other copy is sent while it is on');
        await copyCard.scrollIntoViewIfNeeded();
        await shot('1-in-another-copy');
        results.checks.edition = { key: first.key, elsewhere: row.elsewhere, sent: true };

        // 2. The base for the rest of the run, with the extension on for this chat (it starts on only for the companion).
        await select('B32 Base');
        await ev(async ({ B }) => { const S = await import(`${B}/src/store.js`); const cs = S.chatState(); cs.v10 = { ...(cs.v10 || {}), enabled: true }; S.saveChatState(); });
        await openPresets();
        const s0 = await storedJson();

        // Layout at this width, and no horizontal page overflow.
        const layout = await page.evaluate(() => {
            const r = document.getElementById('ri-bank-page');
            const vis = sel => { const el = r.querySelector(sel); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; };
            const box = sel => r.querySelector(sel)?.getBoundingClientRect();
            return { width: r.getBoundingClientRect().width, seg: vis('.ri-bk-views'), bank: vis('.ri-bk-bank'), stack: vis('.ri-bk-stack'),
                bankBox: box('.ri-bk-bank'), stackBox: box('.ri-bk-stack') };
        });
        results.checks.layout = layout;
        if (NARROW) {
            assert.ok(layout.seg && layout.stack && !layout.bank, 'at this width one view shows behind Stack and Bank');
            assert.match(await root.locator('#ri-bk-view-stack').textContent(), /Stack \(\d+ · [\d,]+\)/);
        } else {
            assert.ok(layout.width >= 760, `the page is ${layout.width} px wide`);
            assert.ok(!layout.seg && layout.bank && layout.stack, 'bank and stack both visible');
            assert.ok(layout.bankBox.right <= layout.stackBox.left + 1, 'the bank sits left of the stack');
            assert.ok(layout.bankBox.width / layout.width > 0.3 && layout.bankBox.width / layout.width < 0.5, 'the bank takes about 40 percent');
        }
        assert.equal(await overflow(), 0, 'no horizontal page overflow');

        // 3. Every loaded Chat Completion preset is in the bank; no control adds a source.
        const listed = await page.evaluate(async B => {
            const bank = await import(`${B}/src/preset-bank.js`);
            const names = bank.listedPresets(SillyTavern.getContext().getPresetManager('openai')).map(entry => entry.name);
            const b = bank.currentBank();
            const sources = [...b.sources.values()].filter(s => s.kind === 'preset' || s.kind === 'companion').map(s => s.name);
            return { names, sources };
        }, B);
        assert.deepEqual([...new Set(listed.sources)].sort(), [...new Set(listed.names)].sort(), 'the bank lists exactly the loaded presets');
        assert.equal(await root.getByRole('button', { name: /add (a )?(source|preset)|choose a preset/i }).count(), 0, 'no add-a-source control');
        results.checks.everyPreset = { presets: listed.names.length };

        // Importing and deleting a preset while the page is open updates the bank.
        await page.evaluate(() => { const pm = SillyTavern.getContext().getPresetManager('openai'); const d = JSON.parse(JSON.stringify(pm.getCompletionPresetByName('Default')));
            d.prompts.push({ identifier: 'b32-late', name: 'Late arrival', content: 'B32 LATE: a preset imported while the page is open.', role: 'system' }); return pm.savePreset('B32 Late', d); });
        await page.evaluate(() => SillyTavern.getContext().eventSource.emit('oai_preset_import_ready', {}));
        await search('Late arrival');
        await root.locator('.ri-bk-results .ri-bk-card').first().waitFor({ state: 'attached', timeout: 8000 });
        await shot('2-import-while-open');
        // As SillyTavern's delete button does: delete, then the PRESET_DELETED event.
        await page.evaluate(async () => { const c = SillyTavern.getContext(); const pm = c.getPresetManager('openai'); await pm.deletePreset('B32 Late');
            await c.eventSource.emit(c.eventTypes.PRESET_DELETED, { apiId: 'openai', name: 'B32 Late' }); });
        for (let i = 0; i < 40 && await root.locator('.ri-bk-results .ri-bk-card').count(); i++) { await page.waitForTimeout(250); await search('Late arrival'); }
        assert.equal(await root.locator('.ri-bk-results .ri-bk-card').count(), 0, 'a deleted preset leaves the bank');
        // Opening the page rereads the list: a change with no host event is found on the next open.
        await page.evaluate(() => { const pm = SillyTavern.getContext().getPresetManager('openai'); const list = pm.getPresetList(); const i = Array.isArray(list.preset_names) ? list.preset_names.indexOf('B32 Other') : list.preset_names['B32 Other'];
            list.presets[i].prompts.find(p => p.identifier === 'b32-other').name = 'Other prose renamed'; });
        await openPresets();
        await search('Other prose renamed');
        assert.equal(await root.locator('.ri-bk-results .ri-bk-card').count(), 1, 'the reopened page read the silent change');
        await page.evaluate(() => { const pm = SillyTavern.getContext().getPresetManager('openai'); const list = pm.getPresetList(); const i = Array.isArray(list.preset_names) ? list.preset_names.indexOf('B32 Other') : list.preset_names['B32 Other'];
            list.presets[i].prompts.find(p => p.identifier === 'b32-other').name = 'Other prose'; });
        await select('B32 Base');
        await openPresets();
        assert.equal(await storedJson(), s0, 'opening the page and refreshing the bank left the stack unchanged');

        // 4. A tap in the bank: source chip, tokens and include control on the card; the stack count moves in the same task.
        await search('Other prose');
        const other = root.locator('.ri-bk-results .ri-bk-card').filter({ hasText: 'Other prose' }).first();
        assert.equal(await other.locator('.ri-bk-src').count(), 1);
        assert.match(await other.locator('.ri-bk-tok').textContent(), /\d+ tokens/);
        assert.equal(await other.locator('.ri-bk-inc[role="switch"]').count(), 1);
        const sameTask = await page.evaluate(() => {
            const read = () => Number(document.getElementById('ri-bk-total').dataset.cards);
            const before = read();
            const control = [...document.querySelectorAll('#ri-bank-page .ri-bk-results .ri-bk-card')].find(el => el.textContent.includes('Other prose')).querySelector('.ri-bk-inc');
            control.click();
            const after = read();
            const seg = document.getElementById('ri-bk-view-stack')?.textContent || '';
            return { before, after, seg };
        });
        assert.equal(sameTask.after, sameTask.before + 1, 'the stack count changed before the task ended');
        const s1 = await stack();
        const otherItem = s1.plan.find(item => item.name === 'Other prose');
        assert.ok(otherItem?.on, 'the stored stack holds the card, on');
        results.checks.sameFrame = sameTask;
        await shot('3-bank-tap');
        // Every card on the page carries the three parts.
        const parts = await page.evaluate(() => [...document.querySelectorAll('#ri-bank-page .ri-bk-card')].filter(el => !el.querySelector('.ri-bk-fill'))
            .map(el => ({ src: !!el.querySelector('.ri-bk-src'), tok: !!el.querySelector('.ri-bk-tok'), inc: !!el.querySelector('.ri-bk-inc') })));
        assert.ok(parts.length > 3 && parts.every(p => p.src && p.tok && p.inc), 'every card has its source chip, tokens and include control');

        // 5. Changed in source: the bank and stack cards say so; the stack keeps the old text until she taps Take the new text.
        await page.evaluate(({ b2 }) => { const pm = SillyTavern.getContext().getPresetManager('openai'); const d = JSON.parse(JSON.stringify(pm.getCompletionPresetByName('B32 Other')));
            d.prompts.find(p => p.identifier === 'b32-other').content = b2; return pm.savePreset('B32 Other', d); }, { b2: PROSE_B2 });
        await select('B32 Base');
        await openPresets();
        await search('Other prose');
        assert.equal(await root.locator('.ri-bk-results .ri-bk-card').filter({ hasText: 'Other prose' }).first().locator('.ri-ps-chip', { hasText: 'Changed in source' }).count(), 1, 'the bank card shows Changed in source');
        await view('stack');
        const changed = card('stack', 'Other prose');
        assert.equal(await changed.locator('.ri-ps-chip', { hasText: 'Changed in source' }).count(), 1, 'the stack card shows Changed in source');
        const old = await send('5-before-take');
        assert.ok(old.includes(PROSE_B) && !old.includes(PROSE_B2), 'the old text is sent until her tap');
        await openPresets(); await view('stack');
        await expand(card('stack', 'Other prose'));
        await shot('4-changed-in-source');
        await tap(card('stack', 'Other prose').getByRole('button', { name: 'Take the new text' }));
        const fresh = await send('5-after-take');
        assert.ok(fresh.includes(PROSE_B2) && !fresh.includes(PROSE_B), 'the new text is sent after her tap');

        // 6. Edit makes a version marked Yours; the clean card stays; Compare with clean; both in the stack as two cards.
        await openPresets(); await view('stack');
        const prose = card('stack', 'Prose rules');
        await expand(prose);
        await tap(prose.getByRole('button', { name: 'Edit' }));
        await prose.locator('.ri-bk-edit').fill(MINE);
        await prose.getByLabel('Version name').fill('Smell');
        await tap(prose.getByRole('button', { name: 'Save as my version' }));
        const versions = await ev(async ({ B }) => Object.values((await import(`${B}/src/store.js`)).settings().bankVersions).filter(v => v.text.includes('smell')));
        assert.equal(versions.length, 1);
        assert.equal(versions[0].sourceId, 'b32-prose');
        assert.equal(versions[0].sourceName, 'B32 Base');
        const cleanNow = await page.evaluate(() => SillyTavern.getContext().getPresetManager('openai').getCompletionPresetByName('B32 Base').prompts.find(p => p.identifier === 'b32-prose').content);
        assert.equal(cleanNow, PROSE_A, 'the preset file is unchanged');
        const vKey = `v::${versions[0].id}`;
        const versionRow = root.locator(`.ri-bk-card[data-where="bank"][data-bank-card="${vKey}"]`).first();
        await versionRow.waitFor({ state: 'attached' });
        assert.match(await versionRow.textContent(), /Yours, from B32 Base/);
        await expand(versionRow);
        await tap(root.locator(`.ri-bk-card[data-bank-card="${vKey}"]`).first().getByRole('button', { name: 'Compare with clean' }));
        const diff = root.locator('.ri-bk-diff').first();
        assert.ok(await diff.locator('ins').count() > 0 && await diff.locator('del').count() > 0, 'the word diff marks added and removed words');
        await shot('5-version-diff');
        await tap(root.locator(`.ri-bk-card[data-bank-card="${vKey}"]`).first().locator('.ri-bk-inc'));
        const both = await stack();
        assert.ok(both.plan.some(item => item.key === 'base::b32-prose' && item.on) && both.plan.some(item => item.key === vKey && item.on), 'clean card and version both on');
        assert.equal(await root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${vKey}"]`).count() + await root.locator('.ri-bk-card[data-where="stack"][data-stack-key="base::b32-prose"]').count(), 2, 'two cards in the stack');
        const twoSent = await send('6-clean-and-version');
        assert.ok(twoSent.includes(PROSE_A) && twoSent.includes(MINE), 'both texts reach the request');
        // Reset to clean asks first; Cancel leaves the version; OK resets it. Delete version removes the record.
        await openPresets(); await view('stack');
        const vStack = root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${vKey}"]`);
        await expand(vStack);
        await tap(vStack.getByRole('button', { name: 'Reset to clean' }));
        await page.locator('dialog[open] .popup-button-cancel').click(); await page.waitForTimeout(300);
        assert.equal((await ev(async ({ B, value }) => (await import(`${B}/src/store.js`)).settings().bankVersions[value].text, versions[0].id)), MINE, 'Cancel keeps her text');
        await tap(vStack.getByRole('button', { name: 'Reset to clean' })); await ok();
        assert.equal((await ev(async ({ B, value }) => (await import(`${B}/src/store.js`)).settings().bankVersions[value].text, versions[0].id)), PROSE_A, 'OK resets to the clean text');
        await openPresets(); await view('stack');
        await expand(root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${vKey}"]`));
        await tap(root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${vKey}"]`).getByRole('button', { name: 'Delete version' })); await ok();
        assert.equal(await ev(async ({ B, value }) => !!(await import(`${B}/src/store.js`)).settings().bankVersions[value], versions[0].id), false);
        await tap(root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${vKey}"] .ri-bk-inc`));
        results.checks.version = { id: versions[0].id };

        // 7. Move by taps: Move shows Place here targets with no drag; the step buttons move one place.
        await openPresets(); await view('stack');
        const order = async () => (await stack()).cards.map(item => item.key);
        const before = await order();
        await tap(card('stack', 'Other prose').getByRole('button', { name: 'Move', exact: true }));
        const targets = root.locator('.ri-bk-place');
        assert.ok(await targets.count() > 3, 'placement mode shows Place here targets');
        assert.equal(await root.locator('.ri-bk-placebar').count(), 1, 'the bar offers Cancel');
        await shot('6-placement');
        await tap(targets.first());
        const moved = await order();
        assert.equal(moved[0], before.find(key => key.endsWith('::b32-other')), 'the card moved to the first place');
        await tap(card('stack', 'Other prose').locator('.ri-bk-step', { hasText: 'Down' }));
        assert.equal((await order())[1], moved[0], 'one step down');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#ri-bank-page [draggable="true"]')].length), 0, 'nothing needs a drag');
        results.checks.move = { before: before.slice(0, 3), after: (await order()).slice(0, 3) };

        // 8. Batch select with undo, and Compare for two cards.
        const sBatch = await storedJson();
        await tap(card('stack', 'Other prose').locator('.ri-bk-pick'));
        // By key: the deleted version of Prose rules is still in the stack under the same name, left out.
        await tap(root.locator('.ri-bk-card[data-where="stack"][data-stack-key="base::b32-prose"] .ri-bk-pick'));
        await tap(root.locator('.ri-bk-batch').getByRole('button', { name: 'Take out' }));
        const off = await stack();
        const pair = off.plan.filter(item => item.key === 'base::b32-prose' || item.key.endsWith('::b32-other'));
        assert.ok(pair.length === 2 && pair.every(item => !item.on), 'both taken out');
        await tap(root.getByRole('button', { name: 'Undo' }).first());
        assert.equal(JSON.parse(await storedJson()).cards.map(c => c.on).join(), JSON.parse(sBatch).cards.map(c => c.on).join(), 'undo puts both back');
        const sCompare = await storedJson();
        await tap(root.locator('.ri-bk-batch').getByRole('button', { name: 'Compare' }));
        // Narrow, the sheet is drawn beside the page section so it is fixed to the screen.
        const sheet = page.locator('.ri-bk-compare');
        await sheet.waitFor({ state: 'visible' });
        const geo = await sheet.evaluate(el => ({ position: getComputedStyle(el).position, height: el.getBoundingClientRect().height, vh: innerHeight,
            bottom: Math.round(el.getBoundingClientRect().bottom), inPage: !!el.closest('#ri-bank-page'),
            cols: el.querySelectorAll('.ri-bk-compare-col').length, shared: el.querySelectorAll('u.ri-bk-shared').length,
            slider: !!el.querySelector('input[type="range"]') && getComputedStyle(el.querySelector('input[type="range"]')).display !== 'none',
            dots: el.querySelectorAll('.ri-bk-dot').length, colsSide: (() => { const c = [...el.querySelectorAll('.ri-bk-compare-col')].map(x => x.getBoundingClientRect()); return c.length > 1 && Math.abs(c[0].top - c[1].top) < 2; })() }));
        results.checks.compare = geo;
        assert.equal(geo.cols, 2);
        assert.ok(geo.shared >= 2, 'the shared sentence is underlined in both');
        if (NARROW) {
            assert.equal(geo.position, 'fixed', 'a partial sheet over the chat');
            assert.ok(!geo.inPage && Math.abs(geo.bottom - geo.vh) <= 2, `the sheet sits on the bottom of the screen (${geo.bottom} of ${geo.vh})`);
            assert.ok(Math.abs(geo.height - geo.vh * 0.4) < 8, `the sheet starts at 40 percent (${geo.height} of ${geo.vh})`);
            assert.ok(geo.slider && geo.dots === 2, 'a height slider and the pager dots');
            await sheet.locator('input[type="range"]').evaluate(el => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
            const grown = await sheet.evaluate(el => el.getBoundingClientRect().height);
            assert.ok(Math.abs(grown - geo.vh * 0.6) < 8, 'the slider sets the height');
        } else {
            assert.ok(geo.colsSide, 'columns side by side over the bank');
        }
        await shot('7-compare');
        assert.equal(await storedJson(), sCompare, 'opening Compare left the stack unchanged');
        await tap(sheet.getByRole('button', { name: 'Close' }));
        await tap(root.locator('.ri-bk-batch').getByRole('button', { name: 'Clear' }));

        // 9. By feature: the grid at this width; a shortcut's preview changes nothing; Apply changes; Undo shortcut restores.
        await page.evaluate(async B => { const bank = await import(`${B}/src/preset-bank.js`); const b = bank.currentBank(); const sid = b.sids['B32 Base'];
            bank.setCardTags(`p:${sid}::b32-prose`, ['style']); const o = b.sids['B32 Other']; bank.setCardTags(`p:${o}::b32-other`, ['style']); }, B);
        const sFeature = await storedJson();
        await openPresets();
        await search('');
        await tap(root.locator('.ri-bk-seg .ri-ps-seg', { hasText: 'By feature' }));
        const lane = root.locator('.ri-bk-lane[data-lane="style"]');
        await lane.waitFor({ state: 'attached' });
        const grid = await lane.locator('.ri-bk-lane-cols').evaluate(el => ({ columns: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length,
            flow: getComputedStyle(el).gridAutoFlow, sources: el.querySelectorAll('.ri-bk-col').length,
            cellWidth: el.querySelector('.ri-bk-cell')?.getBoundingClientRect().width, heads: [...el.querySelectorAll('.ri-bk-col-head')].filter(h => getComputedStyle(h).display !== 'none').length }));
        results.checks.byFeature = grid;
        if (NARROW) assert.equal(grid.columns, 2, 'two columns at this width');
        else { assert.match(grid.flow, /column/); assert.ok(grid.heads >= 2 && grid.heads <= 3 || grid.sources > 3, 'one column per source'); }
        await tap(lane.getByRole('button', { name: 'Only RI' }));
        await lane.locator('.ri-bk-preview').waitFor({ state: 'attached' });
        assert.equal(await storedJson(), sFeature, 'switching views and the shortcut preview left the stack unchanged');
        await shot('8-by-feature');
        await tap(lane.getByRole('button', { name: 'Apply' }));
        const applied = await stack();
        assert.ok(!applied.plan.find(item => item.name === 'Prose rules').on, 'Only RI took the preset prose card out');
        await tap(root.getByRole('button', { name: 'Undo shortcut' }));
        assert.equal(JSON.parse(await storedJson()).cards.map(c => `${c.key}:${c.on}`).join(), JSON.parse(sFeature).cards.map(c => `${c.key}:${c.on}`).join(), 'Undo shortcut restores the lane');
        await tap(root.locator('.ri-bk-seg .ri-ps-seg', { hasText: 'By source' }));

        // 10. Blocks read from a file land in the bank as a source of their own with lineage, and wait for her tap.
        const sImport = await storedJson();
        const intake = await page.evaluate(async ({ B, text }) => {
            const I = await import(`${B}/src/bank-import.js`);
            return I.sendBlocksToBlockBank([{ name: 'Question rule', text, source: { file: 'B32 plugin.json', block: 'Question rule' } }]);
        }, { B, text: IMPORTED });
        assert.equal(intake.sent, 1);
        await search('Question rule');
        const imported = root.locator('.ri-bk-results .ri-bk-card').filter({ hasText: 'Question rule' }).first();
        await imported.waitFor({ state: 'attached' });
        assert.match(await imported.locator('.ri-bk-src').textContent(), /B32 plugin/);
        assert.equal(await storedJson(), sImport, 'an import puts nothing in the stack');
        await expand(imported);
        assert.match(await root.locator('.ri-bk-results .ri-bk-card').filter({ hasText: 'Question rule' }).first().textContent(), /From the file B32 plugin\.json, block Question rule/);
        await tap(root.locator('.ri-bk-results .ri-bk-card').filter({ hasText: 'Question rule' }).first().locator('.ri-bk-inc'));
        const withImport = await send('10-imported-block');
        assert.ok(withImport.includes(IMPORTED), 'the imported block is sent once she puts it in');
        await shot('9-imported');

        // 11. Subtext and ambient switch on from the bank page; the subtext reaches the request with no roll of the event set.
        const setId = await page.evaluate(async ({ B, text }) => {
            const K = await import(`${B}/src/books.js`), E = await import(`${B}/src/events.js`), S = await import(`${B}/src/store.js`);
            const event = E.newEvent(`B32 layers ${Date.now()}`);
            event.chance = 0; event.wait = 0;
            const cat = event.categories.find(c => c.bank === 'subtext');
            cat.bank = ''; cat.items = [{ id: 'b32s', text, on: true, weight: 1, tags: '', always: false, gate: { reply: 0, die: 1, dur: [2, 3], rest: [0, 0] } }];
            const data = { entries: {} }; E.writeEvent(data, event);
            const id = await K.createSet(event.name, 'events', data, '');
            S.chatState().activeSets = [id]; S.saveChatState();
            // Sets left by an earlier run on this host start with both layers off, so the tap below switches subtext on.
            const P = await import(`${B}/src/ui/preset-bank.js`); await P.setEventLayer('subtext', false); await P.setEventLayer('ambient', false);
            return id;
        }, { B, text: SUBTEXT });
        const quiet = await send('11-layer-off');
        assert.ok(!quiet.includes(SUBTEXT), 'nothing gated is sent while the layer is off');
        await openPresets(); await view('bank'); await search('');
        const layer = root.locator('#ri-bk-layers [data-layer="subtext"] [role="switch"]');
        await layer.waitFor({ state: 'attached', timeout: 8000 });
        await tap(layer);
        await page.waitForFunction(() => document.querySelector('#ri-bk-layers [data-layer="subtext"] [role="switch"]')?.getAttribute('aria-checked') === 'true');
        const stored = await page.evaluate(async ({ B, id }) => { const K = await import(`${B}/src/books.js`); const d = await K.loadSet(id); const ri = Object.values(d.entries)[0].extensions.ri;
            return { alone: ri.gatesAlone, on: ri.categories.find(c => c.gate && c.items?.some(i => i.id === 'b32s'))?.on, chance: ri.chance }; }, { B, id: setId });
        assert.deepEqual([stored.alone, stored.on], [true, true]);
        await shot('10-event-layers');
        const loud = await send('11-layer-on');
        assert.ok(loud.includes(SUBTEXT), 'the subtext reaches the request');
        const record = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra?.roleplay_instructions?.items?.map(it => it.key) || []);
        assert.ok(record.some(key => key.endsWith('#gates')), 'it went out as its own item');
        results.checks.layers = { stored, record };

        // 12. Targets follow the size tokens and the size setting.
        await openPresets(); await view('stack');
        const sizes = () => page.evaluate(() => {
            const r = document.getElementById('ri-bank-page');
            const px = name => parseFloat(getComputedStyle(r).getPropertyValue(name)) || 0;
            const heights = sel => [...r.querySelectorAll(sel)].filter(el => el.getBoundingClientRect().height).map(el => Math.round(el.getBoundingClientRect().height));
            return { hit: getComputedStyle(r).getPropertyValue('--ri-hit-size').trim(), min: px('--ri-hit-min'), inc: heights('.ri-bk-inc'), btn: heights('.ri-bk-step'), place: heights('.ri-bk-place') };
        });
        const compact = await sizes();
        await ev(async ({ B }) => (await import(`${B}/src/ui/theme/styles.js`)).saveLook({ targets: 'comfortable' }));
        await page.waitForTimeout(300);
        const comfy = await sizes();
        await ev(async ({ B }) => (await import(`${B}/src/ui/theme/styles.js`)).saveLook({ targets: 'compact' }));
        results.checks.sizes = { compact: { min: compact.min, inc: compact.inc.slice(0, 3), btn: compact.btn.slice(0, 3) }, comfortable: { inc: comfy.inc.slice(0, 3), btn: comfy.btn.slice(0, 3) } };
        assert.ok(compact.btn.every(v => v >= compact.min), 'every step button meets the minimum target');
        assert.ok(Math.max(...comfy.btn) > Math.max(...compact.btn), 'the size setting grows the targets');

        // 13. Her saved wording of an extension card whose stored prompt is gone (a loadout opened on a device whose Prompts
        // page lacks it): the card stays in the stack, shows Source removed with the text it came with, keeps sending that
        // text until she takes it out, the feature sends none of its own text meanwhile, and with the card out the feature
        // reads the stored prompt again (the shipped default).
        await ev(async ({ B, value }) => (await import(`${B}/src/prompts.js`)).savePrompt('structuredRelationships', value), WORDING);
        await openPresets(); await view('stack');
        const wordingKey = 'v::ri-relationships';
        const wordingCard = root.locator(`.ri-bk-card[data-where="stack"][data-stack-key="${wordingKey}"]`);
        await wordingCard.waitFor({ state: 'attached' });
        const sWording = await storedJson();
        await ev(async ({ B }) => (await import(`${B}/src/prompts.js`)).restorePrompt('structuredRelationships'));
        await openPresets(); await view('stack');
        const gone = await stack();
        assert.deepEqual(gone.plan.filter(item => item.key === wordingKey).map(item => [item.status, item.text]), [['removed', WORDING]], 'the card keeps the text it came with');
        assert.deepEqual(JSON.parse(await storedJson()).ri.map(item => [item.key, item.on]), JSON.parse(sWording).ri.map(item => [item.key, item.on]), 'the RI group is unchanged');
        await expand(wordingCard);
        assert.equal(await wordingCard.locator('.ri-ps-chip', { hasText: 'Source removed' }).count(), 1, 'Source removed on the card');
        assert.match(await wordingCard.locator('.ri-bk-detail').textContent(), /keeps sending the text below/);
        await shot('12-wording-source-removed');
        const wordingSent = await send('13-wording-removed');
        assert.ok(wordingSent.includes(WORDING), 'the card keeps sending the text it came with, as the page says');
        const mode = await ev(async ({ B }) => (await import(`${B}/src/preset-bank-ri.js`)).riGroup()?.modes?.relationships);
        assert.equal(mode, 'none', 'the feature sends no text of its own while her wording card sends it, so it goes out once');
        await openPresets(); await view('stack');
        await tap(wordingCard.locator('.ri-bk-inc'));
        const wordingOut = await send('13-wording-taken-out');
        assert.ok(!wordingOut.includes(WORDING), 'taken out by her tap, it is no longer sent');
        const modeAfter = await ev(async ({ B }) => (await import(`${B}/src/preset-bank-ri.js`)).riGroup()?.modes?.relationships);
        assert.equal(modeAfter, 'stored', 'with the card out, the feature reads the stored prompt again, the shipped default');
        results.checks.wordingRemoved = { status: 'removed', sentUntilTakenOut: true, mode };

        // 14. A selected loadout: a block the prompt manager has on that the loadout leaves out is a note in the check list.
        const loadout = await ev(async ({ B }) => {
            const LO = await import(`${B}/src/preset-loadouts.js`), WB = await import(`${B}/src/preset-workbench.js`);
            const pm = SillyTavern.getContext().getPresetManager('openai');
            const name = await LO.saveLoadoutFromContext(pm, `Check ${Date.now() % 100000}`, WB.switchContext());
            const data = JSON.parse(JSON.stringify(pm.getCompletionPresetByName(name)));
            const order = data.prompt_order.find(group => String(group.character_id) === '100001').order;
            const turned = order.filter(entry => entry.enabled === false && entry.identifier !== LO.MARKER_ROW).map(entry => entry.identifier);
            for (const entry of order) if (turned.includes(entry.identifier)) entry.enabled = true;
            await pm.savePreset(name, data);
            return { name, turned };
        });
        assert.ok(loadout.turned.length > 0, 'the loadout keeps some blocks off');
        await select(loadout.name);
        const sLoadout = await storedJson();
        await openPresets(); await view('stack');
        const notes = root.locator('#ri-bk-checks [data-note="loadout-left-out"]');
        await notes.first().waitFor({ state: 'attached' });
        assert.equal(await notes.count(), loadout.turned.length, 'one note per block turned on in the prompt manager');
        assert.match(await notes.first().textContent(), /this loadout left it out/);
        assert.equal(await storedJson(), sLoadout, 'the note changes nothing in the stack');
        await root.locator('#ri-bk-checks').scrollIntoViewIfNeeded();
        await shot('13-loadout-note');
        results.checks.loadoutNotes = { loadout: loadout.name, notes: await notes.count() };
        await select('B32 Base');

        // Nothing excluded or reordered without a tap: the last check reads the stack, reopens the page and reads it again.
        const end = await storedJson();
        await openPresets(); await view('bank'); await view('stack');
        assert.equal(await storedJson(), end);
        assert.equal(await overflow(), 0);
        await shot('11-final');
        results.errors = errors;
        assert.deepEqual(errors.filter(e => /PAGEERROR/.test(e)), [], 'no page errors');
        console.log(`PASS t_bank_page at ${WIDTH} px`);
    } catch (error) { console.log(errors.join(' | ')); await page.screenshot({ path: path.join(OUT, `w${WIDTH}-failed.png`) }).catch(() => {}); results.failed = String(error?.stack || error); throw error;
    } finally {
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-results.json`), JSON.stringify(results, null, 2));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exit(1); });
