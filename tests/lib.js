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
        for (const name of ['index.js', 'manifest.json', 'style.css', 'src', 'assets', 'presets'].filter(name => fs.existsSync(path.join(process.env.RI_EXTENSION_SOURCE, name)))) fs.cpSync(path.join(process.env.RI_EXTENSION_SOURCE, name), path.join(target, name), { recursive: true });
    } else require('child_process').execSync('rm -rf /tmp/src/st/data/default-user/extensions/roleplay-instructions && mkdir -p /tmp/src/st/data/default-user/extensions/roleplay-instructions && cp -r /home/claude/ri/v5/. /tmp/src/st/data/default-user/extensions/roleplay-instructions/');
};
const mode = (m) => fs.writeFileSync(MOCK_MODE, JSON.stringify(m || {}));
const resetLog = () => { try { fs.unlinkSync(MOCK_LOG); } catch { } };
const requests = () => { try { return fs.readFileSync(MOCK_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
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
    const toolbar=page.getByRole('group',{name:'Quick actions toolbar'});
    const toggle=page.getByRole('button',{name:'Quick actions',exact:true});
    if (await toggle.getAttribute('aria-expanded')==='false') await toggle.tap();
    await toolbar.getByRole('button',{name:'More actions',exact:true}).tap();
}
// Tests run under SillyTavern's Default preset unless they pick another one, so one test cannot change the next.
const setupApi = async (page, { preset = 'Default', legacyAutomation = true } = {}) => { if (preset) { await usePreset(page, preset); for (let i = 0; i < 3; i++) { const ok = await page.$('dialog[open] .popup-button-ok'); if (!ok) break; await ok.click(); await page.waitForTimeout(400); } } await h.setupApi(page); await setSettings(page, { enabled: true, perReply: 0, home: '', summary: { on: false, historyUnit: 'messages', everyTokens: 0 }, pace: { quiet: 0, silent: 0, phasesOn: false }, dice: { on: false }, writer: { eventScene: false }, scene: { track: false, card: 'auto' }, cards: { on: false, most: 2, roast: true }, showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' } });
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
