// B4 touch pass at 523 x 1021 (mobile layout) and 1006 x 909 (desktop layout): a 200-message chat with no card under any
// reply, SillyTavern's message menu showing What was sent and Correct a story fact on AI replies only, each entry opening
// its page with that reply selected, and the newest reply's Sent card carrying execution details and directions.
//
// Environment (same as t_integration.js): RI_HOST_URL, RI_MOCK_PORT, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8241';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B4');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const MESSAGES = 200;
const results = { host: HOST, runs: [] };

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_root', { state: 'attached', timeout: 30000 });
}

async function tap(page, locator) {
    const node = typeof locator === 'string' ? page.locator(locator).first() : locator;
    await node.scrollIntoViewIfNeeded();
    const box = await node.boundingBox();
    assert.ok(box, 'the control is on screen');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(350);
}

/** A fresh chat of MESSAGES messages; every AI reply has a receipt, and the newest has a quick action with directions. */
async function seedChat(page) {
    await page.evaluate(async ({ BASE, count, mock }) => {
        const host = SillyTavern.getContext();
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val(mock).trigger('input');
        $('#custom_model_id').val('mock-model').trigger('input');
        document.querySelector('#api_button_openai')?.click();
        await new Promise(resolve => setTimeout(resolve, 1200));
        const idx = host.characters.findIndex(item => item.name);
        if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
        await new Promise(resolve => setTimeout(resolve, 800));
        await host.executeSlashCommandsWithOptions('/newchat');
        await new Promise(resolve => setTimeout(resolve, 1200));
        const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`);
        V.prefs().enabled = true;
        S.saveChatState();
        const chat = SillyTavern.getContext().chat;
        const char = chat[0]?.name || 'Seraphina';
        for (let i = chat.length; i < count; i++) {
            const user = i % 2 === 1;
            const message = { name: user ? 'Sam' : char, is_user: user, is_system: false, send_date: new Date(Date.now() - (count - i) * 60000).toISOString(),
                mes: user ? `I step to the gate and listen. (${i})` : `The gate creaks and a lantern swings in the dark. (${i})`, extra: {} };
            if (!user) message.extra.roleplay_instructions = { time: Date.now() - (count - i) * 60000, items: [], v10: true };
            chat.push(message);
        }
        const last = chat.findLastIndex(m => !m.is_user);
        chat[last].extra.roleplay_instructions.quickActions = { stage: 'reply', label: 'Alternate reply', trigger: 'You tapped Swipe on the bar.', attempts: 1, outcome: 'Complete',
            directions: [{ title: 'Turn toward the door', text: 'Have Mira look at the door before she answers.', visibility: 'private', required: true, verification: 'evidenced', evidence: 'Mira glanced at the door.' }] };
        await host.saveChat();
        await host.reloadCurrentChat();
    }, { BASE, count: MESSAGES, mock: `http://127.0.0.1:${process.env.RI_MOCK_PORT || 8242}/v1` });
    await page.waitForFunction(count => SillyTavern.getContext().chat.length >= count && document.querySelectorAll('#chat .mes').length > 5, MESSAGES, { timeout: 60000 });
    await page.waitForTimeout(1500);
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
    await seedChat(page);
    await page.evaluate(async BASE => (await import(`${BASE}/src/ui/sent.js`)).refreshUnderReplies(), BASE);
    await page.waitForTimeout(800);

    // 1. No card under any reply.
    const mounted = await page.evaluate(() => ({ messages: SillyTavern.getContext().chat.length, rendered: document.querySelectorAll('#chat .mes').length,
        replies: document.querySelectorAll('#chat .mes:not([is_user="true"])').length, card: document.querySelectorAll('#chat .ri-guided, #chat .ri-guided-actions').length,
        trays: document.querySelectorAll('#chat .ri-tray').length }));
    out.checks.noCard = mounted;
    assert.equal(mounted.messages, MESSAGES);
    assert.equal(mounted.card, 0, 'no card under any reply');
    assert.ok(mounted.trays >= 1, 'the reply tray draws');
    await shot('1-chat');

    // 2. The menu holds both entries on AI replies and none on the player's messages.
    const entries = await page.evaluate(() => [...document.querySelectorAll('#chat .mes')].map(node => ({ id: Number(node.getAttribute('mesid')), user: node.getAttribute('is_user') === 'true',
        entries: [...node.querySelectorAll('.extraMesButtons > .ri-mes-button')].map(item => item.dataset.riEntry) })));
    out.checks.entries = { replies: entries.filter(item => !item.user).length, players: entries.filter(item => item.user).length };
    // MB10: a chat whose memory lives in chat data also gets Close the chapter here and Memory from this reply
    const chatMemory = await page.evaluate(() => !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported);
    const want = chatMemory ? 'sent,correct,close-chapter,memory-reply' : 'sent,correct';
    assert.ok(entries.filter(item => !item.user).every(item => item.entries.join() === want), `every AI reply has the entries ${want}`);
    assert.ok(entries.filter(item => item.user).every(item => item.entries.length === 0), 'no entry on the player\'s messages');

    // 3. An older reply: open SillyTavern's menu by touch and use each entry.
    const older = entries.filter(item => !item.user).at(-4);
    const mes = `#chat .mes[mesid="${older.id}"]`;
    out.checks.olderReply = await page.evaluate(selector => { const node = document.querySelector(selector), hint = node?.querySelector('.extraMesButtonsHint');
        return { display: node && getComputedStyle(node).display, hint: hint && JSON.stringify(hint.getBoundingClientRect()), count: document.querySelectorAll(selector).length }; }, mes);
    await shot('1b-before-menu');
    for (const [entry, label, wantPage] of [['sent', 'What was sent', 'sent'], ['correct', 'Correct a story fact', 'corrections'], ...(chatMemory ? [['memory-reply', 'Memory from this reply', 'world']] : [])]) {
        // SillyTavern leaves the menu open after the panel closes, so only a closed menu needs its hint tapped.
        if (!await page.locator(`${mes} .ri-mes-button[data-ri-entry="${entry}"]`).isVisible()) await tap(page, `${mes} .extraMesButtonsHint`);
        const button = page.locator(`${mes} .ri-mes-button[data-ri-entry="${entry}"]`);
        const box = await button.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width, `${label} is inside the screen`);
        if (entry === 'sent') await shot('2-menu-open');
        assert.equal(await button.getAttribute('title'), label);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForFunction(want => document.querySelector('#ri_panel_page')?.dataset.page === want, wantPage, { timeout: 15000 });
        await page.waitForTimeout(500);
        const landed = await page.evaluate(({ id, entry }) => {
            const target = document.querySelector(`#ri-review-reply-${id}`);
            return { page: document.querySelector('#ri_panel_page')?.dataset.page, selected: entry === 'memory-reply' ? !!document.querySelector(`[data-ri-reply-filter="${id}"]`) : entry === 'sent' ? !!target && target.getBoundingClientRect().height > 0
                : /Reply|swipe|version|\d/.test(document.querySelector('#ri-correction-target')?.textContent || ''),
                heading: (document.querySelector('#ri-correction-target')?.textContent || '').slice(0, 120), card: target?.textContent.slice(0, 80) };
        }, { id: older.id, entry });
        out.checks[`open-${entry}`] = landed;
        assert.ok(landed.selected, `${label} opens with reply ${older.id} selected`);
        await shot(`3-${entry}`);
        await page.evaluate(async BASE => { const { app } = await import(`${BASE}/src/ui/panel.js`); await app.setExpanded(false); }, BASE);
        if (await page.locator('#extensions-settings-button > .drawer-content.openDrawer').count()) await tap(page, '#extensions-settings-button > .drawer-toggle');
        await page.waitForTimeout(400);
        await shot(`3-${entry}-closed`);
    }

    // 4. The newest reply's Sent card carries the execution details and the directions sent.
    const latest = await page.evaluate(() => SillyTavern.getContext().chat.findLastIndex(m => !m.is_user));
    await page.evaluate(async ({ BASE, latest }) => (await import(`${BASE}/src/ui/sent.js`)).refreshUnderReplies(), { BASE, latest });
    await page.waitForTimeout(500);
    const chip = page.locator(`#chat .mes[mesid="${latest}"] .ri-tray [data-card="sent"], #chat .mes[mesid="${latest}"] .ri-tray-line`).filter({ hasText: /Sent/ }).first();
    await tap(page, chip);
    await page.waitForSelector(`#chat .mes[mesid="${latest}"] .ri-tray-panel`, { timeout: 15000 });
    const sent = await page.evaluate(id => { const panel = document.querySelector(`#chat .mes[mesid="${id}"] .ri-tray-panel`);
        return { label: panel?.getAttribute('aria-label'), execution: !!panel?.querySelector('.ri-execution'), directions: /Directions sent with this reply/.test(panel?.textContent || '') }; }, latest);
    out.checks.sentCard = sent;
    await page.locator(`#chat .mes[mesid="${latest}"] .ri-tray-panel details`).first().evaluate(node => { node.open = true; });
    await page.locator(`#chat .mes[mesid="${latest}"] .ri-tray-panel details:has(> summary:text-is("Directions sent with this reply"))`).evaluate(node => { node.open = true; });
    await page.locator(`#chat .mes[mesid="${latest}"] .ri-tray-panel`).scrollIntoViewIfNeeded();
    await shot('4-sent-card');
    assert.equal(sent.label, 'Sent');
    assert.ok(sent.execution, 'execution details are in the Sent card');
    assert.ok(sent.directions, 'directions sent are in the Sent card');

    out.checks.pageErrors = errors;
    assert.deepEqual(errors, []);
    await page.close();
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    try {
        await run(browser, 'w523', { width: 523, height: 1021 });
        await run(browser, 'w1006', { width: 1006, height: 909 });
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        console.log('PASS B4 message menu: no card, both entries by touch, Sent card');
    } catch (error) {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        console.error(error);
        process.exitCode = 1;
    } finally { await browser.close(); }
})();
