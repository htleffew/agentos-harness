// Test helpers: drive a local SillyTavern with headless Chrome.
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const BASE = process.env.RI_HOST_URL || 'http://127.0.0.1:8123';
async function open({ width = 1280, height = 900 } = {}) {
    const browser = await chromium.launch({ executablePath: process.env.RI_CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    page.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/favicon|Failed to load resource|^AbortReason/.test(t)) errors.push('CONSOLE ' + t.slice(0, 300)); });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'), null, { timeout: 90000 });
    await page.waitForTimeout(1500);
    // Test-only: hand World Info a window of the last N messages (0 = everything), like a summarizer does.
    await page.evaluate((w) => localStorage.setItem('ri_test_window', w), process.env.RI_WINDOW || '0');
    // First-run popup(s)
    for (let i = 0; i < 4; i++) {
        const ok = await page.$('dialog[open] .popup-button-ok');
        if (!ok) break;
        const input = await page.$('dialog[open] input.popup-input');
        if (input) await input.fill('Sam');
        await ok.click(); await page.waitForTimeout(600);
    }
    return { browser, page, errors };
}
async function setupApi(page) {
    await page.evaluate(async () => {
        const $ = globalThis.jQuery;
        $('#main_api').val('openai').trigger('change');
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val('http://127.0.0.1:8124/v1').trigger('input');
        $('#custom_model_id').val('mock-model').trigger('input');
        if ($('#stream_toggle').prop('checked')) $('#stream_toggle').prop('checked', false).trigger('change');
        $('#api_button_openai').trigger('click');
    });
    await page.waitForFunction(() => globalThis.SillyTavern.getContext().onlineStatus && globalThis.SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
}
async function openChat(page, { fresh = true } = {}) {
    await page.evaluate(async (fresh) => {
        const c = globalThis.SillyTavern.getContext();
        const idx = c.characters.findIndex(x => x.name);
        if (String(c.characterId) !== String(idx)) await c.selectCharacterById(idx);
        await new Promise(r => setTimeout(r, 800));
        if (fresh) await c.executeSlashCommandsWithOptions('/newchat');
    }, fresh);
    await page.waitForTimeout(1200);
}
async function idle(page, timeout = 60000) {
    await page.waitForTimeout(400);
    await page.waitForFunction(() => document.body.dataset.generating !== 'true' && !document.querySelector('#mes_stop:not([style*="display: none"])'), null, { timeout });
    await page.waitForTimeout(500);
}
async function send(page, text) {
    const before = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length);
    await page.evaluate((text) => { const $ = globalThis.jQuery; $('#send_textarea').val(text).trigger('input'); $('#send_but').trigger('click'); }, text);
    await page.waitForFunction((b) => { const ch = globalThis.SillyTavern.getContext().chat; return ch.length >= b + 2 && !ch[ch.length - 1].is_user; }, before, { timeout: 60000 });
    await idle(page);
}
async function swipe(page) {
    const info = await page.evaluate(() => { const ch = globalThis.SillyTavern.getContext().chat; const m = ch[ch.length - 1]; return { n: (m.swipes || []).length }; });
    await page.evaluate(() => globalThis.jQuery('#chat .last_mes .swipe_right').trigger('click'));
    await page.waitForFunction((n) => { const ch = globalThis.SillyTavern.getContext().chat; const m = ch[ch.length - 1]; return (m.swipes || []).length > Math.max(n, 1) - (n === 0 ? 0 : 0) && m.mes && m.mes !== '...'; }, info.n, { timeout: 60000 });
    await idle(page);
}
async function regenerate(page) {
    await page.evaluate(() => globalThis.jQuery('#option_regenerate').trigger('click'));
    await page.waitForTimeout(800);
    await idle(page);
}
async function slash(page, cmd) {
    await page.evaluate(async (cmd) => { await globalThis.SillyTavern.getContext().executeSlashCommandsWithOptions(cmd); }, cmd);
    await page.waitForTimeout(500);
}
module.exports = { open, setupApi, openChat, idle, send, swipe, regenerate, slash, BASE };
