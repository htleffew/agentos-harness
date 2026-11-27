// B13: the parity check of DESIGN.md section 8 on a real host, one block per row, with the request recorder (the mock's
// log) and phone-width screenshots. A Legacy chat is a chat whose saved state still carries the retired flags (the
// Story workflow select's `v10.enabled = false`, Memory only's `components.mode = 'memory'`) and whose replies carry
// Legacy records (scene lines, profile blocks and a roast in the reply record, with no `v10` mark).
// RI_WIDTH and RI_HEIGHT set the viewport (default 523 x 1021 with touch, the cover screen; 1006 x 909 for the inner screen).
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');
const width = Number(process.env.RI_WIDTH || 523), height = Number(process.env.RI_HEIGHT || (width < 768 ? 1021 : 909));
const touch = width < 768;
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B13');
fs.mkdirSync(dir, { recursive: true });
const results = { width, height, rows: {} };
const check = (row, ok, msg) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} [${row}] ${msg}`);
    (results.rows[row] ||= []).push({ ok: !!ok, msg });
    if (!ok) process.exitCode = 1;
};
const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}-${width}.png`), fullPage: false });
const B = L.BASE;
// The scene header line of DESIGN.md 6.8 (place, story time, weather, present).
const HEADER = '**◆ Harbor wharf, east pier** · ◷ Day 2, 21:40 · ≈ rain · ◎ Hale';
const PROSE = `${HEADER}\n\nHale waits by the rail. "The tide turns soon," he said.`;
const STYLE = 'Write direct, concrete fiction';
const CHECKS = 'Scene and character checks';
const HEADER_ASK = 'Begin the reply with one scene header line';
const lastReplyText = () => { const rows = L.requests('reply'); return rows.length ? L.text(rows.at(-1)) : ''; };
const idle = page => page.evaluate(async B => {
    const F = await import(`${B}/src/worldflow.js`); await F.worldIdle();
}, B);
const sent = [];
async function send(page, text) {
    L.resetLog();
    await L.send(page, text);
    await idle(page);
    await page.waitForTimeout(600);
    const reply = lastReplyText();
    sent.push({ text, reply });
    return { reply, own: L.requests().length };
}
const chatState = (page, fn, arg) => page.evaluate(async ({ B, fn, arg }) => {
    const S = await import(`${B}/src/store.js`);
    const cs = S.chatState();
    const out = new Function('cs', 'arg', fn)(cs, arg);
    S.saveChatState();
    return out;
}, { B, fn: String(fn), arg });
async function trayLines(page, index) {
    await page.evaluate(async B => { for (const t of document.querySelectorAll('#chat .ri-tray')) t.dataset.stamp = ''; (await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(); }, B);
    await page.waitForTimeout(700);
    return page.evaluate(index => {
        const mes = document.querySelector(`#chat .mes[mesid="${index}"]`);
        const tray = mes?.querySelector('.ri-tray:not(.ri-tray-loading)');
        if (!tray) return { tray: false, lines: [], text: '' };
        return { tray: true, lines: [...tray.querySelectorAll('.ri-tray-line')].map(line => line.innerText.replace(/\s+/g, ' ').trim()), text: tray.innerText.replace(/\s+/g, ' ') };
    }, index);
}

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width, height, hasTouch: touch, isMobile: touch });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, dice: { on: false } });
        // The cards the rows read start On in the tray (every card starts Off for a new chat, decision 26 November).
        await page.evaluate(async B => {
            const C = await import(`${B}/src/cards/catalog.js`);
            const T = await import(`${B}/src/ui/tray-settings.js`);
            let config = T.trayCardConfig();
            for (const id of ['scene', 'characters', 'roast', 'notes']) config = C.setMode(config, id, 'tray');
            T.saveCardConfig(config);
        }, B);
        await L.openChat(page);

        // ----- Settings backup: written before anything Legacy is read, holding the custom Legacy prompts, and read back in.
        const backup = await page.evaluate(async B => {
            const S = await import(`${B}/src/store.js`);
            const R = await import(`${B}/src/legacy-retire.js`);
            const st = S.settings();
            st.prompts = { ...(st.prompts || {}), scene: { text: 'MY-LEGACY-SCENE {what}{sceneRule}', base: 'x' }, profile: { text: 'MY-LEGACY-PROFILE', base: 'y' }, dice: { text: 'MY-LEGACY-DICE', base: 'z' } };
            const auto = st[R.BACKUP_KEY] || null;
            const saved = auto?.path ? await fetch(auto.path.startsWith('/') ? auto.path : `/${auto.path}`).then(r => r.ok ? r.text() : '').catch(() => '') : '';
            const file = R.backupFile('B13 parity check.');
            const read = R.readBackup(file.text);
            delete st.prompts.scene; delete st.prompts.profile; delete st.prompts.dice;
            const restored = R.restoreBackup(file.text);
            const after = S.settings().prompts || {};
            return { auto, saved: saved.slice(0, 80), schema: read.schema, inFile: ['scene', 'profile', 'dice'].filter(id => read.settings.prompts?.[id]?.text?.startsWith('MY-LEGACY')),
                restored, back: ['scene', 'profile', 'dice'].filter(id => after[id]?.text?.startsWith('MY-LEGACY')), kept: S.settings()[R.BACKUP_KEY]?.name === auto?.name };
        }, B);
        check('backup', backup.auto?.name && /settings-backup@1/.test(backup.saved), `the automatic backup exists in SillyTavern's user files before retirement (${backup.auto?.name})`);
        check('backup', backup.inFile.length === 3, `custom Legacy scene, profile and dice prompts are in the backup file (${backup.inFile.join(', ')})`);
        check('backup', backup.back.length === 3 && backup.kept, `reading the file back in restores them and keeps the record of the automatic backup (${JSON.stringify(backup.restored)})`);
        await L.openPanel(page, 'settings');
        await page.locator('#ri-legacy-backup').scrollIntoViewIfNeeded().catch(() => {});
        const backupUi = await page.evaluate(() => ({ text: document.querySelector('#ri-legacy-backup')?.innerText || '', save: [...document.querySelectorAll('#ri_root button')].some(b => b.textContent.trim() === 'Save a backup file'),
            restore: !!document.querySelector('#ri_root input[type=file][aria-label="Settings backup file to restore"]') && [...document.querySelectorAll('#ri_root button')].some(b => b.textContent.trim() === 'Restore from a backup file' && b.offsetHeight > 0) }));
        check('backup', backupUi.save && backupUi.restore && backupUi.text.includes('settings-backup'), 'Setup, Connections shows the backup, Save a backup file and Restore from a backup file');
        await shot(page, 'backup');
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B);

        // ----- Legacy scene tracking, character state tracking and the Legacy reply stack: a saved Legacy reply converts once
        // into the records the tray reads; old chats show their scene, carried state, portrayal and roast on tray cards.
        await chatState(page, 'cs.v10 = { ...(cs.v10 || {}), modules: { roast: true } };');
        // Capture answers with no scene of its own, so the tray shows what the converted record holds.
        L.mode({ reply: PROSE, capture: { decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [], state: {} } });
        const fixture = await page.evaluate(async B => {
            const c = SillyTavern.getContext();
            const t = Date.now();
            c.chat.push({ name: c.name1, is_user: true, is_system: false, send_date: new Date().toISOString(), mes: 'I look around the mill.', extra: {} });
            const rec = { v: 1, items: [], type: 'normal', time: t, scene: { where: 'Old mill', when: 'Dusk', present: 'Hale', environment: 'Fog on the water' },
                profiles: [{ name: 'Hale', now: { mind: 'Find the ledger', feels: 'Wary of the miller' }, stable: { who: 'A harbor clerk who keeps the tide tables', voice: 'Clipped and dry' } }],
                roast: 'Fog again, a bold choice for a mystery.' };
            c.chat.push({ name: c.name2, is_user: false, is_system: false, send_date: new Date().toISOString(), mes: 'Hale ran a finger along the dusty shelf.', swipes: ['Hale ran a finger along the dusty shelf.'], swipe_id: 0,
                swipe_info: [{ send_date: new Date().toISOString(), extra: { roleplay_instructions: rec } }], extra: { roleplay_instructions: rec } });
            await c.saveChat();
            await c.reloadCurrentChat();
            await new Promise(r => setTimeout(r, 1500));
            const h = SillyTavern.getContext();
            const R = await import(`${B}/src/legacy-retire.js`);
            const S = await import(`${B}/src/state.js`);
            const KEY = 'roleplay_instructions';
            const meta = h.chatMetadata[KEY] ||= {};
            const before = { mind: S.stateAt().hale?.fields?.mind || '' };
            delete meta.legacyConverted;   // the first open of a chat saved before the update
            const first = await R.convertOpenChat();
            const second = await R.convertOpenChat();
            const index = h.chat.findIndex(m => m.mes === 'Hale ran a finger along the dusty shelf.');
            if (index < 0) return { error: 'the fixture reply is missing after the reload', length: h.chat.length, last: String(h.chat.at(-1)?.mes || '').slice(0, 60) };
            const saved = h.chat[index].extra?.[KEY] || {};
            return { index, before, first, second, mind: S.stateAt().hale?.fields?.mind, heart: S.stateAt().hale?.fields?.heart, where: S.snapshotScene(index).where,
                profile: saved.v10Profiles?.[0], converted: saved.legacyConverted, swipeConverted: h.chat[index].swipe_info?.[0]?.extra?.[KEY]?.legacyConverted };
        }, B);
        if (fixture.error) throw new Error(JSON.stringify(fixture));
        check('legacy state', !fixture.before.mind, `before the conversion no Legacy reader gives the profile block's state (${JSON.stringify(fixture.before)})`);
        check('legacy state', fixture.first.converted === 1 && fixture.second.skipped && fixture.second.reason === 'already converted', `the chat converts once (${JSON.stringify([fixture.first, fixture.second])})`);
        check('legacy state', fixture.mind === 'Find the ledger' && fixture.heart === 'Wary of the miller' && fixture.where === 'Old mill', 'the converted record carries the scene and the Mind and Heart state');
        check('legacy state', /harbor clerk/.test(fixture.profile?.text || '') && fixture.profile?.voice === 'Clipped and dry' && fixture.converted === 1 && fixture.swipeConverted === 1, 'the profile block\'s lasting lines become the portrayal the Characters card reads');
        const oldTray = await trayLines(page, fixture.index);
        const oldText = oldTray.lines.join(' | ');
        check('legacy stack', oldTray.tray && /Old mill/.test(oldText) && /Hale/.test(oldText) && /Fog again/.test(oldText), `the old reply's tray shows its scene, its character and its roast (${oldText})`);
        await page.evaluate(index => document.querySelector(`#chat .mes[mesid="${index}"] .ri-tray`)?.scrollIntoView({ block: 'center' }), fixture.index);
        await shot(page, 'old-chat-tray');
        // Characters card, expanded: the converted Mind value and the portrayal.
        const people = await page.evaluate(async index => {
            const tray = document.querySelector(`#chat .mes[mesid="${index}"] .ri-tray`);
            const line = [...tray.querySelectorAll('.ri-tray-line')].find(b => /Characters/i.test(b.innerText));
            line?.click();
            await new Promise(r => setTimeout(r, 1200));
            const t = document.querySelector(`#chat .mes[mesid="${index}"] .ri-tray`);
            return (t?.querySelector('.ri-tray-panel') || t)?.innerText.replace(/\s+/g, ' ') || '';
        }, fixture.index);
        check('legacy state', /Find the ledger/.test(people) && /Wary of the miller/.test(people), `the Characters card shows the converted Mind and Heart values (${people.slice(0, 200)})`);
        await shot(page, 'old-chat-characters');

        // A new reply's header line fills the Scene card with the same fields.
        const fresh = await send(page, 'I walk out to the pier.');
        const newIndex = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
        const newTray = await trayLines(page, newIndex);
        check('legacy scene', /Harbor wharf/.test(newTray.lines.join(' ')) && /21:40/.test(newTray.lines.join(' ')), `a new reply's header line fills the Scene card (${newTray.lines.join(' | ')})`);
        check('workflow', fresh.reply.includes(HEADER_ASK) && fresh.reply.includes(STYLE), 'a chat saved before the update gets the Structured request: the scene header instruction and the writing guidance');
        await shot(page, 'new-reply-tray');

        // ----- Story workflow select: a chat saved in each old mode sends the same request blocks as the same chat without the flag.
        const blocks = text => [STYLE, CHECKS, HEADER_ASK, 'Current story state'].filter(marker => text.includes(marker));
        const modes = {};
        for (const [label, flags] of [['Legacy', 'cs.v10.enabled = false; delete cs.components;'], ['Memory only', 'delete cs.v10.enabled; cs.components = { ...(cs.components || {}), mode: "memory" };'],
            ['Follow active preset', 'delete cs.v10.enabled; if (cs.components) delete cs.components.mode;']]) {
            await chatState(page, flags);
            modes[label] = blocks((await send(page, `I check the knots (${label}).`)).reply);
        }
        await chatState(page, 'delete cs.v10.enabled; if (cs.components) delete cs.components.mode;');
        const structured = blocks((await send(page, 'I check the knots again.')).reply);
        for (const [label, list] of Object.entries(modes)) check('workflow', JSON.stringify(list) === JSON.stringify(structured) && list.length >= 3, `${label} chat: the request carries the same blocks as Structured (${list.join(', ')})`);

        // ----- Memory only: the extension's writing features off, memory on. The request keeps the memory blocks and drops the rest.
        await chatState(page, 'cs.v10.modules = { style: false, preflight: false, colors: false, dice: false, worldEvents: false, roast: false, roastFeedback: false };');
        const memoryOnly = await send(page, 'I listen to the water.');
        check('memory only', !memoryOnly.reply.includes(STYLE) && !memoryOnly.reply.includes(CHECKS) && memoryOnly.reply.includes(HEADER_ASK) && memoryOnly.reply.includes('Current story state'),
            'with every non-memory feature off in Setup, Features, the request keeps the scene header and story state and leaves out writing guidance and scene checks');
        check('memory only', memoryOnly.own === 1, `no extra request beside the reply (${memoryOnly.own})`);
        await chatState(page, 'cs.v10.modules = { roast: true };');

        // ----- Story state under replies: with story state on Theirs (module off) the tray shows none of its cards; on Ours it does.
        await chatState(page, 'cs.v10.modules = { roast: true, state: false };');
        const last = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
        const theirs = await trayLines(page, last);
        check('story state', !theirs.lines.some(line => /^(Scene|Characters)\b/i.test(line)), `story state on Theirs: no Scene or Characters card (${theirs.lines.join(' | ')})`);
        const theirsReq = await send(page, 'I count the boats.');
        check('story state', !theirsReq.reply.includes('Current story state'),'story state on Theirs: the request carries none of the extension\'s story state');
        await chatState(page, 'cs.v10.modules = { roast: true };');
        const ours = await trayLines(page, await page.evaluate(() => SillyTavern.getContext().chat.length - 1));
        check('story state', ours.lines.some(line => /^Scene\b/i.test(line)), `story state on Ours: the Scene card is back (${ours.lines.join(' | ')})`);

        // ----- Current state prompt budget: one control in Setup, Memory, Budgets; its value changes the state block's size.
        await page.evaluate(async B => {
            const S = await import(`${B}/src/store.js`);
            const cs = S.chatState();
            const c = SillyTavern.getContext();
            const rec = c.chat.at(-1).extra.roleplay_instructions;
            rec.stateChanges = [...(rec.stateChanges || []), ...['Hale', 'Mira', 'Brannic', 'Oskar', 'Tamsin', 'Wren'].map(name => ({ name, fields: { mind: `${name} weighs every word said on the pier tonight and plans the next move with care, counting each boat that comes in and each that leaves, and what the harbor master would pay to know`, heart: `${name} feels torn between loyalty to the crew and fear of the harbor master, and the fear grows with every lamp that goes out along the quay`, body: `${name} is tired from the long walk along the sea wall, with salt in a cut on one hand and wet boots that have not dried since the morning`, psyche: `${name} keeps the old debt secret and believes the miller knows about it, which colors every answer given on the pier tonight` } }))];
            rec.scene = { ...(rec.scene || {}), present: 'Hale, Mira, Brannic, Oskar, Tamsin, Wren' };
            S.saveChatState(); await c.saveChat();
        }, B);
        const stateSize = async budget => {
            await L.setSettings(page, { cards: { stateBudget: budget } });
            const r = await send(page, `I wait (${budget}).`);
            const at = r.reply.indexOf('[Current story state');
            return at < 0 ? 0 : r.reply.slice(at, r.reply.indexOf(']', at) + 1).length;
        };
        const small = await stateSize(100), large = await stateSize(1000);
        const budgetHome = await page.evaluate(async B => {
            const H = await import(`${B}/src/ui/home-table.js`);
            return { home: H.HOMES['state-budget'].page, homes: Object.values(H.HOMES).filter(h => /state prompt budget/i.test(h.label)).length };
        }, B);
        check('state budget', small > 0 && large > small, `changing the budget changes the state block in the request (${small} then ${large} characters)`);
        check('state budget', budgetHome.home === 'memory' && budgetHome.homes === 1, 'one control, in Setup, Memory');
        await L.openPanel(page, 'memory');
        const budgetUi = await page.evaluate(() => [...document.querySelectorAll('#ri_root input[aria-label="Current state prompt budget"]')].length);
        check('state budget', budgetUi === 1, 'Setup, Memory, Budgets draws the one control');
        await shot(page, 'state-budget');
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B);

        // ----- The roast and Include the previous roast: Roast on, a Roast card follows the reply; Roast feedback on, the next request carries it.
        await chatState(page, 'cs.v10.modules = { roast: true, roastFeedback: true };');
        L.mode({ reply: `${PROSE}\n\n<roast>The pier again, and the tide still refuses to cooperate.</roast>` });
        const roasted = await send(page, 'I tie off the boat.');
        const roastIndex = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
        const roastTray = await trayLines(page, roastIndex);
        const roastMes = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes);
        check('roast', /<roast>/.test(roasted.reply) && roastTray.lines.some(line => /^Roast\b.*tide still refuses/i.test(line)) && !/<roast>|tide still refuses/.test(roastMes),
            `Roast on: the request asks for it, a Roast card follows the reply and the reply text keeps prose only (${roastTray.lines.join(' | ')})`);
        L.mode({ reply: PROSE });
        const feedback = await send(page, 'I look at the sky.');
        check('roast', /tide still refuses to cooperate/.test(feedback.reply), 'Roast feedback on: the next request carries the previous roast');
        await chatState(page, 'cs.v10.modules = { roast: true, roastFeedback: false };');
        const noFeedback = await send(page, 'I look at the sea.');
        check('roast', !/tide still refuses to cooperate/.test(noFeedback.reply), 'Roast feedback off: the previous roast stays out of the request');
        await shot(page, 'roast-card');

        // ----- Legacy dice defaults: saved stats appear in Stats, and a queued roll uses the same modifier.
        const dice = await page.evaluate(async B => {
            const S = await import(`${B}/src/store.js`);
            const SS = await import(`${B}/src/stat-sheets.js`);
            const D = await import(`${B}/src/dice.js`);
            const st = S.settings();
            st.dice.sheets = { ...(st.dice.sheets || {}), [SS.legacyKey('user')]: { Agility: 3, Wits: -1 } };
            S.saveSettings();
            const roll = D.rollAttempt({ actor: 'user', attempt: 'leap to the boat', stat: 'Agility', step: 'Fair', stance: 'neutral' }, { random: () => 9 });
            return { mod: SS.modifierOf('user', 'Agility'), roll };
        }, B);
        await L.openPanel(page, 'stat-sheets');
        const statUi = await page.evaluate(() => ({ agility: document.querySelector('#ri_root .ri-stat-sheet[data-subject="user"] input[data-stat="Agility"]')?.value,
            wits: document.querySelector('#ri_root .ri-stat-sheet[data-subject="user"] input[data-stat="Wits"]')?.value, list: !!document.querySelector('#ri_root input[aria-label="Stats in use"]') }));
        check('dice', statUi.agility === '3' && statUi.wits === '-1' && statUi.list, `saved stats appear in Story, Characters, Stats, with the stat list (${JSON.stringify(statUi)})`);
        check('dice', dice.mod === 3 && dice.roll?.mod === 3 && dice.roll.total === dice.roll.die + 3, `a roll adds the same modifier as before (${JSON.stringify({ mod: dice.mod, die: dice.roll?.die, total: dice.roll?.total })})`);
        await shot(page, 'stats-page');
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B);

        // ----- New NPC names to avoid: the saved list appears in Reply screening, and a reply using a listed name gets a screening note.
        await chatState(page, 'cs.v10.avoidNpcNames = "Elara\\nSeraphine";');
        L.mode({ reply: `${HEADER}\n\nA stranger named Elara stepped off the boat. Elara smiled at the crew.` });
        await send(page, 'I greet the newcomer.');
        const npcIndex = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
        const npcNotes = await page.evaluate(index => { const rec = SillyTavern.getContext().chat[index].extra.roleplay_instructions || {}; return [...(rec.v10Diagnostics || []), ...(rec.proseDiagnostics?.notes || []).map(n => n.text || String(n))]; }, npcIndex);
        check('npc names', npcNotes.some(note => /New NPC names on your avoid list: Elara/.test(note)), `a reply using a listed name gets a screening note (${npcNotes.join(' | ').slice(0, 200)})`);
        await L.openPanel(page, 'writing');
        const npcUi = await page.evaluate(() => { const box = document.querySelector('#ri_root [data-control="npc-avoid"] textarea'); return box ? box.value : ''; });
        check('npc names', /Elara/.test(npcUi), 'the saved list appears in Direction, Writing, Reply screening');
        await shot(page, 'reply-screening');
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B);
        L.mode({ reply: PROSE });

        // ----- Legacy plot opportunity: a plot offer fires at the saved chance and shows with its reply.
        await chatState(page, 'cs.v10.modules = { worldEvents: true, plots: true };');
        await L.setSettings(page, { world: { head: 100 } });
        const offered = await send(page, 'I wait for something to happen.');
        const offerIndex = await page.evaluate(() => SillyTavern.getContext().chat.length - 1);
        const offerRec = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions?.v10Offer || '');
        const offerTray = await trayLines(page, offerIndex);
        await L.setSettings(page, { world: { head: 0 } });
        const none = await send(page, 'I keep waiting.');
        check('plot offer', /introduce one plausible outside development/.test(offered.reply) && !!offerRec, `at the saved chance of 100 the request carries the plot offer and the reply keeps it (${offerRec})`);
        check('plot offer', !/introduce one plausible outside development/.test(none.reply), 'at a saved chance of 0 no offer goes out');
        check('plot offer', /Offered plot development/i.test(offerTray.text) || offerTray.lines.some(line => /^Notes\b/i.test(line)), `the offer shows with its reply in the tray (${offerTray.lines.join(' | ')})`);
        await L.setSettings(page, { world: { head: 20 } });

        // ----- Colored dialogue without regex: each speaker's dialogue shows in their saved color, drawn by the extension.
        await chatState(page, 'cs.v10.modules = { colors: true }; cs.v10.speakers = { "speaker:hale": { name: "Hale", aliases: ["hale"], color: "#D9822B" } };');
        L.mode({ reply: `${HEADER}\n\n"The tide turns soon," Hale said. "Keep the lamp low."` });
        await send(page, 'I lower the lamp.');
        const color = await page.evaluate(async B => {
            const V = await import(`${B}/src/v10.js`);
            const span = [...document.querySelectorAll('#chat .last_mes .mes_text .ri-speaker-text')].find(node => node.dataset.speaker === 'hale');
            if (!span) return null;
            const probe = document.createElement('span');
            probe.style.color = V.displayColor('#D9822B', span) || V.displayColor('#D9822B', null);
            document.body.append(probe);
            const want = getComputedStyle(probe).color;
            probe.remove();
            return { color: getComputedStyle(span).color, want, text: span.textContent, saved: V.prefs().speakers['speaker:hale']?.color };
        }, B);
        check('dialogue colors', !!color && /tide turns soon/.test(color.text) && color.color === color.want && color.saved === '#D9822B', `Hale's dialogue is drawn in his saved color (${JSON.stringify(color)})`);
        await page.evaluate(() => document.querySelector('#chat .last_mes')?.scrollIntoView({ block: 'center' }));
        await shot(page, 'dialogue-colors');
        L.mode({ reply: PROSE });

        // ----- No Legacy control or wording in the menu: every page of the tree, read with a chat open.
        const sweep = await page.evaluate(async B => {
            const D = await import(`${B}/src/ui/destinations.js`);
            const R = await import(`${B}/src/ui/page-registry.js`);
            const { app } = await import(`${B}/src/ui/panel.js`);
            const ids = [...new Set([...D.pages.filter(p => !p.bridge).map(p => p.id), ...R.registeredPages().map(p => p.id)])];
            const found = [];
            for (const id of ids) {
                await Promise.race([app.openPage(id, { focusPage: true }), new Promise(r => setTimeout(r, 1500))]);
                await new Promise(r => setTimeout(r, 150));
                const text = document.querySelector('#ri_root')?.innerText || '';
                for (const word of [/\bLegacy\b/i, /Memory only/i, /story workflow/i, /Action checks/i, /Follow active preset/i]) {
                    const at = text.search(word);
                    if (at >= 0) found.push(`${id}: ${text.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, ' ')}`);
                }
            }
            const tree = D.tabs.flatMap(t => t.nested.map(n => n.id));
            return { pages: ids.length, found, actionTab: tree.includes('action-checks'), select: !!document.querySelector('#ri-story-workflow') };
        }, B);
        check('menu', sweep.found.length === 0 && !sweep.actionTab && !sweep.select, `no Legacy control or wording on any of ${sweep.pages} pages (${sweep.found.join('; ') || 'none'})`);
        await L.openPanel(page, 'v10');
        await shot(page, 'features');
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false), B);

        check('host', errors.filter(e => !/ResizeObserver/.test(e)).length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
    } catch (error) {
        console.log('ERROR', error && error.stack || error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, `parity-${width}.json`), JSON.stringify(results, null, 2));
        if (process.env.RI_DUMP) fs.writeFileSync(process.env.RI_DUMP, JSON.stringify(sent, null, 1));
        await browser.close();
    }
})();
