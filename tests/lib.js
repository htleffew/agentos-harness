const fs = require('fs');
const h = require('./h.js');
const MOCK_MODE = process.env.RI_MOCK_MODE || '/tmp/mock-mode.json';
const MOCK_LOG = process.env.RI_MOCK_LOG || '/tmp/mock-requests.jsonl';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const sync = () => {
    if (process.env.RI_ST_DIR && process.env.RI_EXTENSION_SOURCE) {
        const path = require('path');
        const target = path.join(process.env.RI_ST_DATA || path.join(process.env.RI_ST_DIR, 'data'), 'default-user/extensions/roleplay-instructions');
        fs.rmSync(target, { recursive: true, force: true });
        fs.mkdirSync(target, { recursive: true });
        for (const name of ['index.js', 'manifest.json', 'style.css', 'src', 'assets', 'presets', 'vendor'].filter(name => fs.existsSync(path.join(process.env.RI_EXTENSION_SOURCE, name)))) fs.cpSync(path.join(process.env.RI_EXTENSION_SOURCE, name), path.join(target, name), { recursive: true });
    } else require('child_process').execSync('rm -rf /tmp/src/st/data/default-user/extensions/roleplay-instructions && mkdir -p /tmp/src/st/data/default-user/extensions/roleplay-instructions && cp -r /home/claude/ri/v5/. /tmp/src/st/data/default-user/extensions/roleplay-instructions/');
};
const mode = (m) => fs.writeFileSync(MOCK_MODE, JSON.stringify(m || {}));
const resetLog = () => { try { fs.unlinkSync(MOCK_LOG); } catch { } };
// Rows carry the kind tagged by tests/mock.js (reply, capture, chapter, condensed, options, draft, check, writer).
// With no argument a suite counts the requests it made itself: every kind except the background memory calls that
// follow each reply (capture, chapter, condensed). Pass a kind or a list of kinds to count those, or 'all' for every row.
const BACKGROUND_KINDS = ['capture', 'chapter', 'condensed'];
const requests = (kinds) => {
    let rows;
    try { rows = fs.readFileSync(MOCK_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
    if (kinds === 'all') return rows;
    if (kinds) return rows.filter(row => [].concat(kinds).includes(row.kind));
    return rows.filter(row => !BACKGROUND_KINDS.includes(row.kind));
};
const text = r => (r.messages || []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
const chatRequests = () => requests().filter(r => /^Reply \d+\./.test(r.answer));
const marks = r => [...text(r).matchAll(/thing ([A-Z]\d)/g)].map(m => m[1]);
/** instructions: [{ name, chance, keep, wait, group, sendTogether, versions: ['A1', ...], sentAs }] */
async function makeSet(page, name, instructions, { limit = 'none', max = 2, activate = true } = {}) {
    await page.evaluate(async ({ BASE, name, instructions, limit, max, activate }) => {
        const B = await import(`${BASE}/src/books.js`);
        const S = await import(`${BASE}/src/store.js`);
        const st = S.settings();
        st.sets[name] = { limit, max };
        const data = { entries: {} };
        instructions.forEach((x, i) => {
            const ins = B.newInstruction(data);
            Object.assign(ins, { name: x.name || `Ins ${i}`, chance: x.chance ?? 100, keep: x.keep ?? 0, wait: x.wait ?? 0, group: x.group || '', sendTogether: x.sendTogether || '', sentAs: x.sentAs || 'system', weight: x.weight ?? 100,
                versions: x.versions.map(v => ({ text: `{{char}} must do thing ${v} to {{user}}.`, keep: false })) });
            B.writeInstruction(data, ins);
        });
        await B.saveSet(name, data);
        await globalThis.SillyTavern.getContext().updateWorldInfoList();
        if (activate) { const cs = S.chatState(); cs.activeSets = [name]; S.saveChatState(); }
        S.saveSettings();
    }, { BASE, name, instructions, limit, max, activate });
}
const setSettings = (page, patch) => page.evaluate(async ({ BASE, patch }) => { const S = await import(`${BASE}/src/store.js`); const st = S.settings(); for (const [k, v] of Object.entries(patch)) { if (v && typeof v === 'object') Object.assign(st[k] ||= {}, v); else st[k] = v; } S.saveSettings(); }, { BASE, patch });
const records = (page) => page.evaluate(() => globalThis.SillyTavern.getContext().chat.map((m, i) => ({ i, user: m.is_user, rec: m.extra?.roleplay_instructions?.items?.length ? { items: m.extra.roleplay_instructions.items.map(x => ({ name: x.name, status: x.status, misses: x.misses, kind: x.kind, quote: x.quote, text: x.text })), agency: m.extra.roleplay_instructions.agency, note: m.extra.roleplay_instructions.note } : null })).filter(x => !x.user));
const waitChecks = async (page) => { await page.waitForFunction(() => !globalThis.SillyTavern.getContext().chat.some(m => m.extra?.roleplay_instructions?.checking), null, { timeout: 30000 }); await page.waitForTimeout(300); };
const usePreset = (page, name) => page.evaluate(async (name) => { const $ = globalThis.jQuery; const sel = document.querySelector('#settings_preset_openai'); const opt = [...sel.options].find(o => o.textContent.trim() === name); if (!opt || sel.value === opt.value) return; $(sel).val(opt.value).trigger('change'); await new Promise(r => setTimeout(r, 1500)); }, name);
async function openQuickActions(page) {
    // B28: the launcher toolbar is gone. The bar's More menu opens the sheet with every quick action, as the launcher did.
    const folded=page.getByRole('button',{name:'Open quick actions',exact:true});
    if (await folded.isVisible().catch(()=>false)) await folded.tap();
    await page.getByRole('toolbar',{name:'Quick actions'}).getByRole('button',{name:'More quick actions',exact:true}).tap();
    await page.getByRole('button',{name:'All quick actions',exact:true}).tap();
}
// Tests run under SillyTavern's Default preset unless they pick another one, so one test cannot change the next.
const setupApi = async (page, { preset = 'Default', legacyAutomation = true } = {}) => { if (preset) { await usePreset(page, preset); for (let i = 0; i < 3; i++) { const ok = await page.$('dialog[open] .popup-button-ok'); if (!ok) break; await ok.click(); await page.waitForTimeout(400); } } await h.setupApi(page); await page.evaluate(async BASE => { const S = await import(`${BASE}/src/store.js`); const st = S.settings(); delete st.prompts; delete st.promptVariations; delete st.roastVoiceId; S.saveSettings(); }, BASE); await setSettings(page, { enabled: true, perReply: 0, home: '', summary: { on: false, historyUnit: 'messages', everyTokens: 0 }, pace: { quiet: 0, silent: 0, phasesOn: false }, dice: { on: false }, writer: { eventScene: false }, scene: { track: false, card: 'auto' }, cards: { on: false, most: 2, roast: true }, showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' } });
    const functions = Object.fromEntries(['chapterSummary','chapterCombine','instructionCheck','automaticSwipe']
        .map(operation=>[operation,{profileId:'',automatic:legacyAutomation}]));
    await setSettings(page,{world:{editableReplies:legacyAutomation ? -1 : 5},execution:{functions}});
    await page.waitForTimeout(1200);
};
module.exports = { ...h, setupApi, usePreset, openQuickActions, BASE, sync, mode, resetLog, requests, chatRequests, text, marks, makeSet, setSettings, records, waitChecks };

// Touch navigation uses the mobile chooser and retains the desktop route buttons.
async function panelClick(root, name) {
    let control=root.getByRole('button',{name,exact:true});
    if (!await control.isVisible().catch(()=>false)) {
        const trigger=root.locator('.ri-page-chooser-trigger');
        if(await trigger.isVisible()) {
            await trigger.tap();
            const target=root.locator('#ri-page-chooser [data-ri-page]').filter({hasText:name});
            await target.tap();
            return;
        }
    }
    await control.tap();
}
module.exports.panelClick=panelClick;

// B4: the card under each reply is gone. A reply's quick action sheet opens as the bar opens it, and the two message menu
// entries (What was sent, Correct a story fact) open from SillyTavern's own message menu.
async function openReplyAction(page, family, index) {
    await page.evaluate(async ({ BASE, family, index }) => {
        const chat = SillyTavern.getContext().chat;
        const id = index ?? chat.findLastIndex(message => !message.is_user && !message.is_system);
        (await import(BASE + '/src/ui/quick-actions.js')).openQuickActions(family, id, document.querySelector('#send_textarea'));
    }, { BASE, family, index });
}
async function openMenuEntry(page, entry, index) {
    const id = index ?? await page.evaluate(() => SillyTavern.getContext().chat.findLastIndex(message => !message.is_user && !message.is_system));
    const mes = page.locator('#chat .mes[mesid="' + id + '"]');
    const control = mes.locator('.ri-mes-button[data-ri-entry="' + entry + '"]');
    await page.waitForTimeout(400);
    if (!await control.isVisible()) await mes.locator('.extraMesButtonsHint').click();
    await control.click();
    await page.waitForTimeout(800);
    return page.locator('#ri_root');
}
Object.assign(module.exports, { openReplyAction, openMenuEntry });

// B28: the old "Expand" button is gone. The menu opens full screen through the app object; a page id lands on that page.
async function openPanel(page, id, options = {}) {
    await page.evaluate(async ({ BASE, id, options }) => {
        const { app } = await import(BASE + '/src/ui/panel.js');
        // Leaving a page with an unsent draft asks first, and the answer comes from the test, so the wait is bounded.
        if (id) await Promise.race([app.openPage(id, { focusPage: true, ...options }), new Promise(resolve => setTimeout(resolve, 1500))]);
        await app.setExpanded(true);
    }, { BASE, id, options });
    await page.waitForTimeout(300);
}
// Host isolation for the suites that read the next request: SillyTavern's Summarize extension must put nothing into the prompt.
// The host may keep its Quick Replies on, since the quick action bar sits beside them and they add nothing to a prompt.
async function assertQuietHost(page) {
    const state = await page.evaluate(() => {
        const host = SillyTavern.getContext();
        return { disabled: host.extensionSettings.disabledExtensions || [], summary: String(host.extensionPrompts?.['1_memory']?.value || '') };
    });
    if (!state.disabled.includes('memory') && state.summary) throw new Error('The host Summarize extension adds text to the prompt: ' + state.summary.slice(0, 80));
    return state.disabled;
}
// Two taps through the shell: the top tab, then the nested tab (ids from src/ui/destinations.js).
async function goTab(page, top, nested) {
    await openPanel(page);
    await page.evaluate(({ top, nested }) => {
        document.querySelector(`#ri_root [data-ri-tab="${top}"]`).click();
        if (nested) document.querySelector(`#ri_root [data-ri-nested="${nested}"]`).click();
    }, { top, nested });
    await page.waitForTimeout(300);
}
// B27: one list of sets with one Add set button. Kinds: instructions, events, style. The new set opens in its editor.
async function addSet(page, kind, name) {
    await openPanel(page, 'sets');
    await page.locator('#ri_root').getByRole('button', { name: 'Add set', exact: true }).click();
    await page.locator('#ri_root select[aria-label="Kind of set"]').selectOption(kind);
    await page.locator('#ri_root input[aria-label="Name for the new set"]').fill(name);
    await page.locator('#ri_root').getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(1200);
}
Object.assign(module.exports, { openPanel, assertQuietHost, goTab, addSet });
