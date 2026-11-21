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
        for (const name of ['index.js', 'manifest.json', 'style.css', 'src']) fs.cpSync(path.join(process.env.RI_EXTENSION_SOURCE, name), path.join(target, name), { recursive: true });
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
// Tests run under SillyTavern's Default preset unless they pick another one, so one test cannot change the next.
const setupApi = async (page, { preset = 'Default', legacyAutomation = true } = {}) => { if (preset) { await usePreset(page, preset); for (let i = 0; i < 3; i++) { const ok = await page.$('dialog[open] .popup-button-ok'); if (!ok) break; await ok.click(); await page.waitForTimeout(400); } } await h.setupApi(page); await setSettings(page, { enabled: true, perReply: 0, home: '', summary: { on: false, historyUnit: 'messages', everyTokens: 0 }, pace: { quiet: 0, silent: 0, phasesOn: false }, dice: { on: false }, writer: { eventScene: false }, scene: { track: false, card: 'auto' }, cards: { on: false, most: 2, roast: true }, showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' } });
    const functions = Object.fromEntries(['chapterSummary','chapterCombine','instructionCheck','automaticSwipe']
        .map(operation=>[operation,{profileId:'',automatic:legacyAutomation}]));
    await setSettings(page,{world:{editableReplies:legacyAutomation ? -1 : 5},execution:{functions}});
    await page.waitForTimeout(1200);
};
module.exports = { ...h, setupApi, usePreset, BASE, sync, mode, resetLog, requests, chatRequests, text, marks, makeSet, setSettings, records, waitChecks };
