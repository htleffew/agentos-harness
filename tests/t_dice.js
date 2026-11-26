// B22 dice on a real host, then the 5.7 rows on where an event comes from and lists that retire their items.
// Dice: the judgment call before each reply (request recorder: mock kind 'dice'), the verdict in the reply request with no
// raw roll, the roll stored with its swipe, the Roll card's one line, Dice display Hidden, the Sent card's receipt, the die
// button, Dice off, the stat sheets at chat start, the Stats card and Story, Characters, Stats with an edit that sticks.
// RI_WIDTH and RI_HEIGHT set the viewport (default 390 x 780 with touch; 1006 x 909 for the inner screen).
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');
const V10 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'Roleplay Instructions V10.json'), 'utf8'));
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const width = Number(process.env.RI_WIDTH || 390), height = Number(process.env.RI_HEIGHT || 780);
const touch = width < 768;
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B22');
fs.mkdirSync(dir, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(dir, `${name}-${width}.png`), fullPage: false });
const mockUrl = `http://127.0.0.1:${Number(process.env.RI_MOCK_PORT || 8124)}/v1`;
const idle = async (page) => { await page.evaluate(async (B) => { const F = await import(`${B}/src/worldflow.js`); const C = await import(`${B}/src/chapters.js`); await F.worldIdle(); for (let i = 0; i < 100 && C.chapterBusy(); i++) await new Promise(r => setTimeout(r, 100)); await F.worldIdle(); }, L.BASE); await page.waitForTimeout(300); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.kind === 'reply' && r.messages.length > 2); return { n: all.length, all, dice: L.requests('dice'), text: L.text(chat[chat.length - 1] || all[0]) }; };
const lastRolls = (page) => page.evaluate(async (B) => { const D = await import(`${B}/src/dice.js`); const c = globalThis.SillyTavern.getContext().chat; const m = c[c.length - 1]; return { rolls: D.rollsOf(m), swipe: m.swipe_id, slot: m.swipe_info?.[m.swipe_id]?.extra?.roleplay_instructions?.dice?.rolls || null, judge: D.diceOf(m)?.judge || null }; }, L.BASE);
const attempts = list => JSON.stringify({ attempts: list });
const CLIMB = { actor: 'user', attempt: 'climb the harbor wall', stat: 'Agility', difficulty: 'Hard', stance: 'neutral' };
const BRANNIC = { actor: 'Brannic', attempt: 'grab the satchel', stat: 'Strength', difficulty: 'Fair', stance: 'resisting' };
const SHEETS = JSON.stringify({ sheets: [{ who: 'Sam', stats: [{ stat: 'Agility', value: 3, reason: 'nimble fingers' }] }, { who: 'CHAR', stats: [{ stat: 'Strength', value: 4, reason: 'strong as an ox' }] }] });
const trayText = (page) => page.evaluate(() => { const t = [...document.querySelectorAll('#chat .mes')].at(-1)?.querySelector('.ri-tray'); return t ? t.innerText : ''; });

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width, height, hasTouch: touch, isMobile: touch, setupPage: async p => {
        // The desktop route's probe answers at once, so the judgment call goes to the mock as the desktop.
        await p.route('**/api/backends/chat-completions/status', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'gemma4:12b' }] }) }));
    } });
    try {
        await L.setupApi(page);
        // The reply tray draws under v10 replies, so the dice rows run with the V10 preset, as on her phone.
        await page.evaluate(async (value) => { await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name, value); }, V10);
        await L.usePreset(page, V10.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });
        const t = Date.now();

        // ----- A. dice
        await page.evaluate(async ({ B, mockUrl }) => {
            const c = SillyTavern.getContext();
            const cm = c.extensionSettings.connectionManager ||= { profiles: [] };
            cm.profiles = [...(cm.profiles || []).filter(p => p.id !== 'p-b22-desktop'), { id: 'p-b22-desktop', name: 'Desktop', api: 'custom', model: 'gemma4:12b', 'api-url': mockUrl, preset: 'Default' }];
            const R = await import(`${B}/src/routing.js`); R.resetRouteHealth(); R.setRouteBinding('desktop', { profileId: 'p-b22-desktop' });
            (await import(`${B}/src/memory/decide.js`)).resetJudgmentHealth();
        }, { B: L.BASE, mockUrl });
        await L.openChat(page);
        const names = await page.evaluate(() => { const c = SillyTavern.getContext(); return { user: c.name1, char: c.name2 }; });
        L.mode({ reply: PROSE, sheets: SHEETS.replace('Sam', names.user).replace('CHAR', names.char), dice: attempts([]) });
        L.resetLog();
        await L.setSettings(page, { dice: { on: true, display: 'line' } });
        // chat start: a new chat with Dice on infers both sheets in one call
        await page.evaluate(async (B) => { const S = await import(`${B}/src/stat-sheets.js`); await S.inferChatSheets(); }, L.BASE);
        const start = await page.evaluate(async (B) => { const D = await import(`${B}/src/dice.js`); const S = await import(`${B}/src/stat-sheets.js`); return { user: D.sheet('user'), char: D.sheet('char'), why: S.sheetOf('char')?.reasons }; }, L.BASE);
        const sheetCalls = L.requests('sheets');
        assert(sheetCalls.length === 1 && start.user.Agility === 3 && start.char.Strength === 4 && start.why?.Strength === 'strong as an ox' && /Character "/.test(L.text(sheetCalls[0])),
            `stat sheets: one call at chat start infers the persona's and the character's sheets from the card, each with a reason (${JSON.stringify(start)})`);

        // B22b: the Roll card starts Off for a new chat, and no Roll line draws until she turns it on
        L.mode({ reply: PROSE, dice: attempts([CLIMB]) });
        const fresh = await page.evaluate(async (B) => { const Q = await import(`${B}/src/ui/tray-settings.js`); const C = await import(`${B}/src/cards/catalog.js`); const cfg = Q.trayCardConfig(); return { mode: C.cardMode(cfg, 'roll'), label: C.MODES[C.cardMode(cfg, 'roll')] }; }, L.BASE);
        const off0 = await send(page, 'I try to climb the harbor wall before the watch turns.');
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(800);
        const offTray = await page.evaluate(() => { const t = [...document.querySelectorAll('#chat .mes')].at(-1)?.querySelector('.ri-tray'); return { text: t ? t.innerText : '', lines: document.querySelectorAll('#chat .mes:last-child .ri-c-oneline').length }; });
        assert(fresh.mode === 'off' && fresh.label === 'Off' && off0.dice.length === 1 && offTray.lines === 0 && !/\bRoll\b/.test(offTray.text),
            `Roll card: starts Off for a new chat, and no Roll line draws although the reply was rolled (${JSON.stringify({ fresh, lines: offTray.lines })})`);

        // detection, the verdict and the stored roll
        await page.evaluate(async (B) => { const Q = await import(`${B}/src/ui/tray-settings.js`); const C = await import(`${B}/src/cards/catalog.js`); let cfg = Q.trayCardConfig(); for (const id of ['roll', 'stats', 'sent']) cfg = C.setMode(cfg, id, 'tray'); cfg = C.setOn(cfg, 'roll:lines', true); cfg = C.setOn(cfg, 'stats:sheets', true); Q.saveCardConfig(cfg); }, L.BASE);
        const r1 = await send(page, 'I try to climb the harbor wall before the watch turns.');
        const d1 = await lastRolls(page);
        const roll = d1.rolls[0] || {};
        console.log('roll:', JSON.stringify(roll), 'dice calls:', r1.dice.length);
        assert(r1.dice.length === 1 && /You set up dice for one turn/.test(L.text(r1.dice[0])) && /Player message: I try to climb/.test(L.text(r1.dice[0])),
            'detection: one judgment call runs before the reply (request recorder)');
        assert(d1.rolls.length === 1 && roll.stat === 'Agility' && roll.mod === 3 && roll.total === roll.die + 3 && roll.dc === 14 && roll.margin === roll.total - 14 && !!roll.degree,
            'roll: d20 plus the stat modifier against the difficulty, with its degree');
        assert(new RegExp(`${names.user}'s attempt to climb the harbor wall: ${roll.degree.toLowerCase()}`).test(r1.text) && /Keep dice, rolls, numbers, stats and degree names out of the prose/.test(r1.text)
            && !new RegExp(`d20|\\b${roll.total} vs`).test(r1.text), 'verdict: the reply request carries one verdict with the rule, and no raw roll');
        assert(d1.slot && d1.slot[0].die === roll.die, 'stored: the roll is in the reply\'s chat data with its swipe');

        // the Roll card: one line ending with the die and the modifier
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(800);
        // Open a card by its label: a Compact line, else an Expanded chip.
        const LABEL = { roll: 'Roll', stats: 'Stats', sent: 'Sent' };
        const openCard = async (id) => page.evaluate((label) => {
            const tray = [...document.querySelectorAll('#chat .mes')].at(-1)?.querySelector('.ri-tray');
            const button = [...(tray?.querySelectorAll('.ri-tray-line, .ri-tray-chip') || [])].find(b => (b.querySelector('.ri-tray-line-label')?.textContent || b.textContent).trim() === label);
            button?.click();
            return !!button;
        }, LABEL[id]);
        const lineOf = () => page.evaluate(() => { const lines = [...document.querySelectorAll('#chat .mes:last-child .ri-c-oneline')]; return lines.map(l => l.innerText.replace(/\s+/g, ' ').trim()); });
        let lines = await lineOf();
        if (!lines.length) { await openCard('roll'); await page.waitForTimeout(500); lines = await lineOf(); }
        console.log('roll lines:', JSON.stringify(lines), 'tray:', (await trayText(page)).slice(0, 300));
        assert(lines.length === 1 && new RegExp(`Climb the harbor wall, Agility, Hard: ${roll.total} vs 14, ${roll.degree.toLowerCase()}`).test(lines[0]) && new RegExp(`d20 ${roll.die} \\+3$`).test(lines[0]),
            'Roll card: one line per roll, ending with the die and the stat modifier');
        const expanded = await page.evaluate(() => !!document.querySelector('#chat .mes:last-child .ri-roll-full, #chat .mes:last-child details.ri-roll'));
        assert(!expanded, 'Roll card: no expanded roll view exists');
        await page.locator('#chat .mes').last().scrollIntoViewIfNeeded();
        await shot(page, 'roll-line');

        // a swipe judges and rolls again, and stores its roll on that swipe only (B22b)
        const SWIPE_CLIMB = { ...CLIMB, stat: 'Strength', difficulty: 'Easy' };
        L.mode({ reply: PROSE, dice: attempts([SWIPE_CLIMB]) });
        L.resetLog(); await L.swipe(page); await L.waitChecks(page); await idle(page);
        const sw = await lastRolls(page);
        const swText = L.text(L.requests().filter(r => r.kind === 'reply').slice(-1)[0] || {});
        const swDice = L.requests('dice');
        const bySwipe = await page.evaluate(async (B) => { const D = await import(`${B}/src/dice.js`); const m = globalThis.SillyTavern.getContext().chat.at(-1); return [0, 1].map(i => D.diceOf(m, i)?.rolls?.[0] || null); }, L.BASE);
        console.log('swipe rolls:', JSON.stringify(bySwipe), 'dice calls:', swDice.length);
        assert(swDice.length === 1 && /Player message: I try to climb/.test(L.text(swDice[0])), 'swipe: one dice judgment call, on the message the swiped reply answered (request recorder)');
        assert(sw.swipe === 1 && sw.rolls[0]?.stat === 'Strength' && sw.slot?.[0]?.stat === 'Strength' && bySwipe[0]?.stat === 'Agility' && bySwipe[0]?.die === roll.die
            && swText.includes(`${names.user}'s attempt to climb the harbor wall`), 'swipe: the new swipe holds its own roll, the first swipe keeps its own');
        // swiping back shows the earlier swipe's roll in the Roll card and its verdict in the Sent card
        await page.evaluate(() => globalThis.jQuery('#chat .last_mes .swipe_left').trigger('click'));
        await page.waitForFunction(() => globalThis.SillyTavern.getContext().chat.at(-1).swipe_id === 0, null, { timeout: 15000 });
        await idle(page);
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(800);
        const back1 = await lastRolls(page);
        let backLines = await lineOf();
        if (!backLines.length) { await openCard('roll'); await page.waitForTimeout(500); backLines = await lineOf(); }
        assert(back1.swipe === 0 && back1.rolls[0]?.die === roll.die && back1.rolls[0]?.stat === 'Agility' && backLines.length === 1 && new RegExp(`Agility, Hard: ${roll.total} vs 14`).test(backLines[0]),
            `swipe back: the Roll card shows the first swipe's own roll (${JSON.stringify(backLines)})`);
        await openCard('sent'); await page.waitForTimeout(600);
        const backSent = await page.evaluate(() => [...document.querySelectorAll('#chat .mes')].at(-1)?.querySelector('.ri-c-sent-dice')?.innerText || '');
        assert(/Agility, Hard/.test(backSent) && !/Strength, Easy/.test(backSent), 'swipe back: the Sent card shows the first swipe\'s verdict and roll');
        // a continue keeps the continued swipe's roll and sends no dice call
        L.resetLog();
        await page.evaluate(() => globalThis.jQuery('#option_continue').trigger('click'));
        await page.waitForTimeout(1500); await L.waitChecks(page); await idle(page);
        const cont = await lastRolls(page);
        assert(L.requests('dice').length === 0 && cont.swipe === 0 && cont.rolls[0]?.die === roll.die && cont.rolls[0]?.stat === 'Agility',
            `continue: no dice call, the continued swipe keeps its roll (dice calls ${L.requests('dice').length}, die ${cont.rolls[0]?.die})`);
        L.mode({ reply: PROSE, dice: attempts([CLIMB]) });

        // Hidden: nothing in the tray, the verdict still goes, and the roll stays in the Sent card
        await page.evaluate(async (B) => { (await import(`${B}/src/dice.js`)).setDiceDisplay('hidden'); await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        L.mode({ reply: PROSE, dice: attempts([CLIMB, BRANNIC]) });
        const r2 = await send(page, 'I try to climb the harbor wall again while Brannic grabs at my satchel.');
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(800);
        const d2 = await lastRolls(page);
        const hiddenLines = await lineOf();
        assert(r2.dice.length === 1 && d2.rolls.length === 2 && /Brannic's attempt to grab the satchel/.test(r2.text) && hiddenLines.length === 0,
            'Hidden: no roll line in the tray, the verdicts are still sent');
        const brannic = d2.rolls.find(r => r.actor === 'Brannic');
        const npcSheet = await page.evaluate(async (B) => (await import(`${B}/src/stat-sheets.js`)).sheetOf('Brannic'), L.BASE);
        assert(brannic && brannic.name === 'Brannic' && npcSheet && ['play', 'book'].includes(npcSheet.source), 'NPC: an NPC attempt is rolled with the NPC\'s sheet, made during play and stored with the chat');
        await openCard('sent');
        await page.waitForTimeout(600);
        const sentText = await page.evaluate(() => [...document.querySelectorAll('#chat .mes')].at(-1)?.querySelector('.ri-c-sent-dice')?.innerText || '');
        console.log('sent dice:', sentText.replace(/\s+/g, ' '));
        assert(/Dice judgment, 1 model call · extra request/.test(sentText) && /Brannic: Grab the satchel/.test(sentText), 'Sent card: the judgment call shows with the extension-added call words, and the hidden rolls stay there');
        await shot(page, 'hidden-sent');
        await page.evaluate(async (B) => { (await import(`${B}/src/dice.js`)).setDiceDisplay('line'); }, L.BASE);

        // the Stats card: an edit is marked as hers and inference run again leaves it
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(600);
        // B22b: the Stats card draws in the latest reply's tray only, and moves when a new reply arrives
        const statsTrays = () => page.evaluate(() => [...document.querySelectorAll('#chat .mes')].filter(m => m.querySelector('.ri-tray')).map(m => ({ id: m.getAttribute('mesid'), stats: [...m.querySelectorAll('.ri-tray-line, .ri-tray-chip')].some(b => (b.querySelector('.ri-tray-line-label')?.textContent || b.textContent).trim() === 'Stats') })));
        const trays1 = await statsTrays();
        const latestId = await page.evaluate(() => String(SillyTavern.getContext().chat.length - 1));
        console.log('stats trays:', JSON.stringify(trays1));
        assert(trays1.length >= 3 && trays1.filter(t => t.stats).length === 1 && trays1.find(t => t.stats)?.id === latestId, 'Stats card: drawn in the latest reply\'s tray only, no older reply has it');
        L.mode({ reply: PROSE, dice: attempts([]) });
        await send(page, 'I wait and watch the harbor.');
        await page.evaluate(async (B) => { await (await import(`${B}/src/ui/stat-sheet.js`)).redrawTrays(); }, L.BASE);
        await page.waitForTimeout(800);
        const trays2 = await statsTrays();
        const latestId2 = await page.evaluate(() => String(SillyTavern.getContext().chat.length - 1));
        assert(latestId2 !== latestId && trays2.filter(t => t.stats).length === 1 && trays2.find(t => t.stats)?.id === latestId2, 'Stats card: moves to the new reply when a new reply arrives');
        await openCard('stats');
        await page.waitForTimeout(500);
        const input = page.locator('#chat .mes').last().locator(`.ri-stat-sheet[data-subject="user"] input[data-stat="Agility"]`);
        let edited = false;
        if (await input.count()) { await input.fill('-2'); await input.dispatchEvent('change'); edited = true; }
        else await page.evaluate(async (B) => (await import(`${B}/src/dice.js`)).setStat('user', 'Agility', -2), L.BASE);
        await page.locator('#chat .mes').last().scrollIntoViewIfNeeded();
        await shot(page, 'stats-card');
        L.mode({ reply: PROSE, sheets: JSON.stringify({ sheets: [{ who: names.user, stats: [{ stat: 'Agility', value: 5, reason: 'nimble' }] }] }) });
        await page.evaluate(async (B) => (await import(`${B}/src/stat-sheets.js`)).inferChatSheets({ force: true }), L.BASE);
        const after = await page.evaluate(async (B) => { const S = await import(`${B}/src/stat-sheets.js`); return { v: S.statsOf('user').Agility, mine: !!S.sheetOf('user').mine?.Agility }; }, L.BASE);
        assert(after.v === -2 && after.mine, `Stats: an edited value (${edited ? 'typed in the Stats card' : 'set by code'}) is marked as hers and inference run again leaves it unchanged`);

        // Story, Characters, Stats
        await L.openPanel(page, 'stat-sheets', {});
        await page.waitForTimeout(800);
        const pageText = await page.evaluate(() => document.querySelector('#ri_root')?.innerText || '');
        assert(/Stats/.test(pageText) && /yours/.test(pageText) && /Brannic/.test(pageText), 'Story, Characters, Stats lists every sheet with her value marked yours');
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(sideways <= 1, `no sideways scroll on the Stats page (${sideways})`);
        await shot(page, 'stats-page');

        // Setup, Look, Reply tray: the Dice display row, tapped
        await L.openPanel(page, 'reply-tray', {});
        await page.waitForSelector('#ri-dice-display', { timeout: 10000 });
        const row = page.locator('#ri-dice-display');
        await row.scrollIntoViewIfNeeded();
        await row.getByRole('button', { name: 'Hidden', exact: true }).click();
        await page.waitForTimeout(400);
        const tapped = await page.evaluate(async (B) => (await import(`${B}/src/dice.js`)).diceDisplay(), L.BASE);
        await shot(page, 'display-row');
        await page.locator('#ri-dice-display').getByRole('button', { name: 'One line', exact: true }).click();
        await page.waitForTimeout(400);
        const back = await page.evaluate(async (B) => (await import(`${B}/src/dice.js`)).diceDisplay(), L.BASE);
        assert(tapped === 'hidden' && back === 'line', 'Setup, Look, Reply tray: the Dice display row sets One line or Hidden');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); await P.app.setExpanded?.(false); }, L.BASE).catch(() => {});

        // the die button: a named roll replaces detection for that attempt
        // Close any open menu page, set the Action check to Wits at 17, then tap it in More.
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); await P.app.setExpanded?.(false); }, L.BASE).catch(() => {});
        await page.evaluate(async (B) => {
            const Q = await import(`${B}/src/quick-actions.js`);
            const action = Q.listQuickActions('', { allKinds: true }).find(a => Q.kindOf(a) === 'check');
            Q.saveQuickAction({ id: action.id, stat: 'Wits', difficulty: '17' });
        }, L.BASE);
        const folded = page.getByRole('button', { name: 'Open quick actions', exact: true });
        if (await folded.isVisible().catch(() => false)) await folded.click();
        await page.getByRole('toolbar', { name: 'Quick actions' }).getByRole('button', { name: 'More quick actions', exact: true }).click();
        await page.waitForTimeout(400);
        await shot(page, 'die-button-more');
        await page.getByRole('button', { name: /^Action check/ }).first().click();
        await page.waitForTimeout(500);
        const queued = await page.evaluate(async (B) => ({ action: true, roll: (await import(`${B}/src/dice.js`)).queuedRoll(),
            status: document.querySelector('.ri-bar-status')?.textContent || '' }), L.BASE);
        console.log('queued:', JSON.stringify(queued));
        L.mode({ reply: PROSE, dice: attempts([CLIMB]) });
        const r3 = await send(page, 'I try to climb the harbor wall one more time.');
        const d3 = await lastRolls(page);
        assert(queued.roll?.stat === 'Wits' && queued.roll?.dc === 17 && d3.rolls.length === 1 && d3.rolls[0].stat === 'Wits' && d3.rolls[0].dc === 17 && d3.rolls[0].source === 'die button' && r3.dice.length === 1,
            'die button: the queued roll\'s stat and difficulty replace detection for that attempt');

        // Dice off: no judgment call, nothing rolls, the die button leaves the bar and More
        await L.setSettings(page, { dice: { on: false } });
        const hidden = await page.evaluate(async (B) => { const Q = await import(`${B}/src/quick-actions.js`); return { more: Q.listQuickActions('', { allKinds: true }).some(a => Q.kindOf(a) === 'check'), bar: Q.barPins().some(a => Q.kindOf(a) === 'check') }; }, L.BASE);
        await page.getByRole('toolbar', { name: 'Quick actions' }).getByRole('button', { name: 'More quick actions', exact: true }).click();
        await page.waitForTimeout(400);
        const inMore = await page.getByRole('button', { name: /^Action check/ }).count();
        await shot(page, 'dice-off-more');
        await page.keyboard.press('Escape');
        hidden.more = hidden.more || inMore > 0;
        const off = await send(page, 'I try to climb the harbor wall.');
        const d4 = await lastRolls(page);
        assert(off.dice.length === 0 && L.requests('sheets').length === 0 && !/Dice verdicts/.test(off.text) && d4.rolls.length === 0 && !hidden.more && !hidden.bar,
            'Dice off: zero dice calls, no verdict, no roll, and the die button is hidden from the bar and More');
        const noEmoji = !/\p{Extended_Pictographic}/u.test(JSON.stringify([d1, d2, d3]) + r1.text + r2.text + sentText);
        assert(noEmoji, 'no emoji in any dice text');
        await L.setSettings(page, { dice: { on: false } });

        // The 5.7 rows below ran with the Default preset before B22.
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });

        // ----- A2. lists that retire their items run out at different times
        const burn = await page.evaluate(async (B) => {
            const E = await import(`${B}/src/events.js`);
            const sit = E.newCategory('Situation', ['s1', 's2', 's3'], { burn: true });
            const comp = E.newCategory('Complication', ['c1'], { burn: true });
            const tone = E.newCategory('Tone', ['calm', 'tense']);
            const ri = { type: 'event', categories: [sit, comp, tone] };
            const burned = new Set(); const out = []; let st = null;
            for (let i = 0; i < 4; i++) {
                const r = E.rollEvent(ri, st, { burned }); if (!r) { out.push('none'); continue; } st = r.state;
                for (const p of r.parts) for (const id of p.ids) burned.add(id);
                out.push(r.parts.map(p => p.name[0]).join('') + (r.state.usedUp ? '-' + r.state.usedUp.join('') : ''));
            }
            return { out, status: E.burnStatus(ri, burned) };
        }, L.BASE);
        console.log('burn:', JSON.stringify(burn));
        assert(burn.out.join(' ') === 'SCT ST-Complication ST-Complication none' && burn.status.usedUp && burn.status.lists.map(l => `${l.name}:${l.left}/${l.total}${l.main ? '*' : ''}`).join() === 'Situation:0/3*,Complication:0/1', 'retire: a shorter list that is used up is left out of later events, and the set stops when its main list is used up');
        const us = await page.evaluate(async ([B, t]) => {
            const S = await import(`${B}/src/store.js`); const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`);
            const ev = E.newEvent('Burn ' + t); Object.assign(ev, { chance: 100, wait: 0, keep: 0 });
            ev.categories = [E.newCategory('Situation', ['only once BURNMARK'], { burn: true })];
            const d = { entries: {} }; E.writeEvent(d, ev); const id = await K.createSet('Burn ' + t, 'events', d, '');
            S.chatState().activeSets = [id]; S.saveChatState(); return id;
        }, [L.BASE, t]);
        await L.setSettings(page, { check: { mode: 'off' } });
        const b1 = await send(page, 'burn one');
        const b2 = await send(page, 'burn two');
        const b2rec = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; return c[c.length - 1].extra?.roleplay_instructions?.usedUp || null; });
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'events'; P.app.eroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForTimeout(900);
        const card = await page.evaluate(() => document.querySelector('#ri_root').textContent);
        console.log('burn run:', /BURNMARK/.test(b1.text), /BURNMARK/.test(b2.text), JSON.stringify(b2rec), card.slice(card.indexOf('Burn ' + t), card.indexOf('Burn ' + t) + 500));
        assert(/BURNMARK/.test(b1.text) && !/BURNMARK/.test(b2.text) && b2rec && b2rec[0] === 'Burn ' + t && /Situation: 0 of 1 \(main list\)/.test(card) && /Used up in this chat/.test(card), 'retire: when a set is used up, the reply says so, you are told once, and the set card shows what is left of each list');
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Bring the used items back').click());
        await page.waitForTimeout(600);
        const b3 = await send(page, 'burn three');
        assert(/BURNMARK/.test(b3.text), 'retire: "Bring the used items back" lets the set pick its items again in this chat');
        await page.evaluate(async (B) => { const S = await import(`${B}/src/store.js`); S.chatState().activeSets = []; S.saveChatState(); }, L.BASE);

        // ----- B. where an event comes from
        const ev = await page.evaluate(async (B) => {
            const E = await import(`${B}/src/events.js`);
            const sit = E.newCategory('Situation', ['a storm rolls in', 'a letter arrives with news', '{{char}} makes a confession', '{{char}} plans a surprise', 'a stranger asks for help', 'something unexpected happens']);
            ['world', 'world', 'char', 'char', 'other', ''].forEach((f, i) => { if (f) sit.items[i].from = f; });
            const drv = E.defaultCategories().find(c => c.driver);
            const ri = { type: 'event', categories: [sit, drv] };
            const pairs = new Set(); let st = null; let bad = 0;
            for (let i = 0; i < 200; i++) {
                const r = E.rollEvent(ri, st); st = r.state;
                const s = r.parts.find(p => p.name === 'Situation').items[0]; const d = r.parts.find(p => p.name === 'Who drives it').items[0];
                const so = sit.items.find(x => x.text === s).from || ''; const dOrigin = E.originOf(drv.items.find(x => x.text === d), drv);
                if (so && so !== dOrigin) bad++;
                pairs.add(`${dOrigin}:${so || 'any'}`);
            }
            // a driver whose origin has nothing left is not offered
            const sit2 = E.newCategory('Situation', ['a storm rolls in']); sit2.items[0].from = 'world';
            const drivers = new Set(); for (let i = 0; i < 40; i++) drivers.add(E.originOf(drv.items.find(x => x.text === E.rollEvent({ type: 'event', categories: [sit2, drv] }, null).parts.find(p => p.name === 'Who drives it').items[0]), drv));
            const old = E.newCategory('Who drives it', ['{{char}}', 'the surroundings: weather', 'a stranger'], { driver: true });
            return { bad, pairs: [...pairs].sort(), drivers: [...drivers], order: E.rollEvent(ri, null).parts.map(p => p.name), inferred: old.items.map(it => E.originOf(it, old)), defaults: drv.items.map(it => it.from) };
        }, L.BASE);
        console.log('origins:', JSON.stringify(ev));
        L.mode({ writer: '["a gust slams a door"]' }); L.resetLog();
        await page.evaluate(async (B) => { const W = await import(`${B}/src/writer.js`); const E = await import(`${B}/src/events.js`); await W.writeItems({ category: E.newCategory('Situation'), theme: 'harbour', count: 1, context: {}, existing: [], others: ['Who drives it'], origin: 'world' }); }, L.BASE);
        assert(/- Every item is an event that starts in the surroundings: weather, a place, an object, an animal, a crowd, or news arriving\./.test(L.text(L.requests()[0])), 'origins: "Write items with AI" writes items for the place you choose');

        // the origin choice is in the AI box of a story event list
        await page.evaluate(async ([B, name]) => { const P = await import(`${B}/src/ui/panel.js`); const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`); const data = await K.loadSet(name); const draft = E.readEvent(E.findEventEntry(data, 'event', name), name); P.app.tab = 'events'; P.app.eroute = { view: 'edit', name, draft, open: { [draft.categories[0].id]: true } }; P.app.render(); }, [L.BASE, us]);
        await page.waitForTimeout(500);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Write items with AI').click());
        await page.waitForTimeout(400);
        const box = await page.evaluate(() => document.querySelector('#ri_root .ri-sheet-box')?.textContent || '');
        assert(/Where these events come from/.test(box), 'origins: the "Write items with AI" box has the choice of where the events come from');
        await page.screenshot({ path: '/tmp/s57_origin.png' });


        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
