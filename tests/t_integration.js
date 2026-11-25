// Integration pass as a player on a real SillyTavern 1.19.0 host with the mock model, at 523 x 1021 (mobile layout)
// and 1006 x 909 (desktop layout) with touch: open a chat, tap NPC options on the bar, Insert an option, send, watch
// the reply tray fill, open the menu, search "World Info", open Setup, Presets and flip one switch on a fixture preset,
// fold and unfold the bar, reload, and confirm the state survives. Fails on any page error.
//
// Environment:
//   RI_HOST_URL      SillyTavern with this checkout installed
//   RI_MOCK_LOG      the recorder's JSON lines file (rows with url and body)
//   RI_PLAYWRIGHT    path to playwright-core (default: require('playwright-core'))
//   RI_CHROME        Chrome executable
//   RI_EVIDENCE      folder for screenshots and results.json
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8231';
const LOG = process.env.RI_MOCK_LOG;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/integration-1');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const FIXTURE = 'Integration plain fixture';
// Background memory calls (capture, chapter, condensed) follow each reply and are not counted; tests/mock.js tags every row with a kind.
const rows = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => !['capture', 'chapter', 'condensed'].includes(row.kind)) : []);
const results = { host: HOST, runs: [] };

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
}

async function tap(page, selector) {
    const node = page.locator(selector).first();
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    assert.ok(box, `${selector} is on screen`);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
}

async function openSwitches(page) {
    if (!await page.locator('#ri-preset-switches').evaluate(node => node.open)) await tap(page, '#ri-preset-switches > summary');
    await page.waitForSelector('#ri-switch-dice', { timeout: 10000 });
}

async function run(browser, tag, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const out = { tag, viewport, checks: {}, shots: [] };
    results.runs.push(out);
    const shot = async name => { const file = `${tag}-${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); out.shots.push(file); };
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await ready(page);

    // A fixture preset the library recognises by block name (Dice Rolls and Prose Rules), and a fresh chat.
    await page.evaluate(async ({ name, mock }) => {
        const host = SillyTavern.getContext(), manager = host.getPresetManager('openai');
        const base = structuredClone(manager.getCompletionPresetByName('Default'));
        const blocks = [{ identifier: 'int-dice', name: 'Dice Rolls', content: 'Roll a d20 for every attempt.', role: 'system', system_prompt: false },
            { identifier: 'int-prose', name: 'Prose Rules', content: 'Write tight prose.', role: 'system', system_prompt: false }];
        // Fresh wording in every block, so no library edition claims the preset and the blocks are matched by name.
        base.prompts = [...base.prompts.filter(p => !p.identifier.startsWith('int-')).map((p, i) => (p.marker || !p.content ? p : { ...p, content: `Integration fixture block ${i}.` })), ...blocks];
        for (const group of base.prompt_order) group.order = [...group.order.filter(e => !e.identifier.startsWith('int-')), ...blocks.map(b => ({ identifier: b.identifier, enabled: true }))];
        await manager.savePreset(name, base);
        const select = document.querySelector('#settings_preset_openai');
        const option = [...select.options].find(o => o.textContent.trim() === name);
        jQuery(select).val(option.value).trigger('change');
        await new Promise(resolve => setTimeout(resolve, 1500));
        for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click();
        // The preset carries a connection of its own; point it back at the mock.
        jQuery('#chat_completion_source').val('custom').trigger('change');
        jQuery('#custom_api_url_text').val(mock).trigger('input');
        jQuery('#custom_model_id').val('mock-model').trigger('input');
        document.querySelector('#api_button_openai')?.click();
        await new Promise(resolve => setTimeout(resolve, 1500));
        const idx = host.characters.findIndex(item => item.name);
        if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
        await new Promise(resolve => setTimeout(resolve, 800));
        await host.executeSlashCommandsWithOptions('/newchat');
    }, { name: FIXTURE, mock: `http://127.0.0.1:${process.env.RI_MOCK_PORT || 8232}/v1` });
    await page.waitForTimeout(1500);
    await page.evaluate(async BASE => {
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.restoreQuickAction('builtin:options:npc'); // the shipped NPC options, whatever an earlier suite saved
        Q.setBarFolded(false);
        // The reply tray belongs to the Structured story workflow; turn it on for this chat as Setup, Features does.
        const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`);
        V.prefs().enabled = true;
        S.saveChatState();
        (await import(`${BASE}/src/ui/results-sheet.js`)).clearOptionsCache();
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin[data-kind="options"]', { timeout: 30000 });
    const chatId = await page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
    await shot('1-chat');

    // NPC options from the bar, then Insert.
    let start = rows().length;
    await tap(page, '#ri_composer_bar .ri-bar-pin[data-kind="options"]');
    assert.equal(rows().length, start, 'a tap only opens the sheet');
    await shot('2-sheet');
    await tap(page, '.ri-gsheet [data-ri-generate]');
    await page.waitForSelector('.ri-gsheet .ri-option-card', { timeout: 30000 }).catch(async error => { await shot('fail-options'); throw error; });
    await page.waitForTimeout(300);
    out.checks.options = { cards: await page.locator('.ri-gsheet .ri-option-card').count(), requests: rows().length - start };
    await shot('3-options');
    assert.equal(out.checks.options.cards, 4);
    assert.equal(out.checks.options.requests, 1);
    const firstBody = await page.locator('.ri-gsheet .ri-option-card').first().evaluate(node => node.innerText);
    await tap(page, '.ri-gsheet .ri-option-card [data-ri-insert]');
    const inserted = await page.locator('#send_textarea').inputValue();
    out.checks.insert = { sheetClosed: !(await page.locator('.ri-gsheet').count()), inserted: inserted.slice(0, 60) };
    assert.ok(inserted.length > 40 && firstBody.includes(inserted.slice(0, 30)), 'the option is in the message box');
    await shot('4-inserted');

    // Send and watch the reply tray fill.
    start = rows().length;
    await tap(page, '#send_but');
    await page.waitForFunction(() => { const chat = SillyTavern.getContext().chat; return chat.length >= 3 && !chat.at(-1).is_user && document.body.dataset.generating !== 'true'; }, null, { timeout: 60000 });
    await page.waitForSelector('#chat .last_mes .ri-tray', { timeout: 30000 });
    // MB3: the Strip says Capturing until capture after the reply has filed the tray.
    const capturedIn = Date.now();
    await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
    out.checks.captureMs = Date.now() - capturedIn;
    await page.waitForTimeout(800);
    out.checks.reply = { requests: rows().length - start, tray: await page.locator('#chat .last_mes .ri-tray').count(),
        trayLoadingLeft: await page.locator('#chat .ri-tray-loading').count(), playerSent: await page.evaluate(() => SillyTavern.getContext().chat.at(-2).mes.slice(0, 60)) };
    await shot('5-reply-tray');
    assert.equal(out.checks.reply.tray, 1);
    assert.equal(out.checks.reply.trayLoadingLeft, 0);
    assert.ok(out.checks.reply.requests >= 1);

    // Open the menu from the Extensions drawer and search "World Info".
    await tap(page, '#extensions-settings-button > .drawer-toggle');
    if (!await page.locator('#ri_root').isVisible()) await tap(page, '#ri_drawer .inline-drawer-header');
    const full = page.locator('#ri_root').getByRole('button', { name: 'Full screen', exact: true });
    if (await full.count()) await tap(page, '#ri_root [aria-label="Full screen"]');
    await shot('6-menu');
    await tap(page, '[data-ri-search]');
    await page.fill('#ri-menu-search', 'World Info');
    await page.waitForTimeout(900);
    out.checks.search = { results: await page.evaluate(() => [...document.querySelectorAll('.ri-shell-result')].slice(0, 4).map(node => node.innerText.replace(/\s+/g, ' '))) };
    await shot('7-search');
    await tap(page, '.ri-shell-result');
    await page.waitForTimeout(400);
    out.checks.search.landed = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page')?.dataset.page, nested: document.querySelector('[data-ri-nested][aria-current="page"]')?.dataset.riNested }));
    await shot('8-world-info');
    assert.equal(out.checks.search.landed.nested, 'world-info');

    // Setup, Presets: flip Dice from its starting side. Sides saved by earlier runs on this host would hide the default.
    await page.evaluate(async BASE => { delete (await import(`${BASE}/src/store.js`)).settings().presetSwitches; }, BASE);
    await tap(page, '[data-ri-tab="setup"]');
    await tap(page, '[data-ri-nested="presets"]');
    // B32: the Ours or Theirs switches sit folded at the foot of the page, retiring, open only while a feature is on Ours.
    await page.waitForSelector('#ri-switch-dice', { state: 'attached', timeout: 30000 }).catch(async error => { await shot('fail-presets'); throw error; });
    await openSwitches(page);
    const before = await page.locator('#ri-switch-dice').getAttribute('data-side');
    // B24: a feature nobody has chosen is on Both, and the switch offers three sides.
    assert.equal(before, 'both', 'the default side is Both');
    assert.deepEqual(await page.locator('#ri-switch-dice .ri-ps-seg').allTextContents(), ['Ours', 'Theirs', 'Both']);
    await page.locator('#ri-switch-dice').scrollIntoViewIfNeeded();
    await shot('8b-presets-both-default');
    const label = { ours: 'Ours', theirs: 'Theirs', both: 'Both' };
    const target = before === 'ours' ? 'Theirs' : 'Ours';
    const seg = page.locator('#ri-switch-dice .ri-ps-seg').filter({ hasText: target });
    await seg.scrollIntoViewIfNeeded();
    const segBox = await seg.boundingBox();
    await page.touchscreen.tap(segBox.x + segBox.width / 2, segBox.y + segBox.height / 2);
    await page.waitForTimeout(500);
    const after = await page.locator('#ri-switch-dice').getAttribute('data-side');
    out.checks.presets = { page: await page.evaluate(() => document.querySelector('#ri_panel_page')?.dataset.page), before, after,
        sections: await page.evaluate(() => [...document.querySelectorAll('.ri-shell-section')].map(node => node.textContent)) };
    await page.locator('#ri-switch-dice').scrollIntoViewIfNeeded();
    await shot('9-presets-switched');
    assert.notEqual(after, before);
    assert.ok(out.checks.presets.sections.includes('Cleanup'), 'B18 Cleanup sits in the Presets nested tab');

    // Close the menu, fold and unfold the bar, then leave it folded for the reload.
    await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);
    if (await page.locator('#extensions-settings-button > .drawer-content.openDrawer').count()) await tap(page, '#extensions-settings-button > .drawer-toggle');
    const fold = async () => {
        // The handle moves while the menu drawer closes and the send area settles; tap it once it holds still.
        const handle = page.locator('#ri_composer_bar .ri-bar-fold');
        let box = await handle.boundingBox();
        for (let i = 0; i < 10; i++) {
            await page.waitForTimeout(150);
            const next = await handle.boundingBox();
            if (next.x === box.x && next.y === box.y) break;
            box = next;
        }
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 4);
        await page.waitForTimeout(300);
        return page.evaluate(() => document.querySelector('#ri_composer_bar').dataset.folded);
    };
    out.checks.fold = { first: await fold() };
    await shot('10-folded');
    out.checks.fold.second = await fold();
    out.checks.fold.third = await fold();
    assert.deepEqual([out.checks.fold.first, out.checks.fold.second, out.checks.fold.third], ['true', 'false', 'true']);

    // Reload: the chat, the folded bar, the switch and the menu page survive.
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    // SillyTavern opens on its welcome screen after a reload; the player reopens the chat from the character.
    out.checks.chatOpenAfterReload = await page.evaluate(id => SillyTavern.getContext().getCurrentChatId() === id, chatId);
    if (!out.checks.chatOpenAfterReload) {
        await page.evaluate(async id => {
            const host = SillyTavern.getContext();
            await host.selectCharacterById(host.characters.findIndex(item => item.name));
            await new Promise(resolve => setTimeout(resolve, 800));
            if (host.getCurrentChatId() !== id) await host.openCharacterChat(id);
        }, chatId);
    }
    await page.waitForTimeout(1500);
    out.checks.afterReload = await page.evaluate(chatId => ({ chat: SillyTavern.getContext().getCurrentChatId() === chatId,
        messages: SillyTavern.getContext().chat.length, folded: document.querySelector('#ri_composer_bar')?.dataset.folded,
        tray: document.querySelectorAll('#chat .ri-tray').length }), chatId);
    await shot('11-after-reload');
    assert.equal(out.checks.afterReload.chat, true);
    assert.ok(out.checks.afterReload.messages >= 3);
    assert.equal(out.checks.afterReload.folded, 'true');
    assert.ok(out.checks.afterReload.tray >= 1);
    // Reopen the menu on Presets and read the switch the way a player sees it.
    await tap(page, '#extensions-settings-button > .drawer-toggle');
    if (!await page.locator('#ri_root').isVisible()) await tap(page, '#ri_drawer .inline-drawer-header');
    await page.waitForTimeout(500);
    out.checks.afterReload.reopenedPage = await page.evaluate(() => document.querySelector('#ri_panel_page')?.dataset.page);
    if (!await page.locator('#ri-switch-dice').count()) {
        await tap(page, '[data-ri-tab="setup"]');
        await tap(page, '[data-ri-nested="presets"]');
    }
    await page.waitForSelector('#ri-switch-dice', { state: 'attached', timeout: 15000 });
    await openSwitches(page);
    out.checks.afterReload.diceSide = await page.locator('#ri-switch-dice').getAttribute('data-side');
    await page.locator('#ri-switch-dice').scrollIntoViewIfNeeded();
    await shot('12-presets-after-reload');
    assert.equal(out.checks.afterReload.diceSide, after, 'the switch survives the reload');
    assert.equal(out.checks.afterReload.reopenedPage, 'presets', 'the menu reopens where it was');

    // Leave the bar open and the switch where it started for the next width.
    const flipBack = page.locator('#ri-switch-dice .ri-ps-seg').filter({ hasText: label[before] });
    const backBox = await flipBack.boundingBox();
    await page.touchscreen.tap(backBox.x + backBox.width / 2, backBox.y + backBox.height / 2);
    await page.evaluate(async BASE => { (await import(`${BASE}/src/quick-actions.js`)).setBarFolded(false); }, BASE);
    await page.waitForTimeout(1200);
    out.errors = errors;
    assert.deepEqual(errors, []);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, 'w523', { width: 523, height: 1021 });
        await run(browser, 'w1006', { width: 1006, height: 909 });
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
        await browser.close();
    }
    console.log('integration pass: passed');
})().catch(error => { console.error(error); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, error: String(error.stack || error) }, null, 1)); process.exit(1); });
