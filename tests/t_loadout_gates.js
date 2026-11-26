// B57: a loadout made from a stack keeps each card's role, position, depth and first reply, and sends the request the stack
// sends; the diagnostics log lists a gated card as left out with the reply it opens at. Drives SillyTavern 1.19.0 with the mock
// model at RI_WIDTH (default 390 x 780, touch) and reads the requests the mock logged (never a rebuilt copy). It checks:
//   - the stack (a block from an imported file with a first reply of 3, and one in the chat at depth 2 as user that she
//     moves to depth 1 as assistant and gates at reply 2) sends replies 1 to 4;
//   - the loadout saved from that stack, selected in a new chat, sends the same blocks, roles and depths at replies 1 to 4;
//   - with the diagnostics log on, reply 1 of the loadout lists the gated cards as left out with the reply they open at;
//   - a loadout saved before B57 (no gate on any block) sends as saved.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE (requests and results.json), RI_WIDTH.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = Number(process.env.RI_WIDTH || 390);
const NARROW = WIDTH < 760;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B57');
fs.mkdirSync(OUT, { recursive: true });
const results = { width: WIDTH, host: process.env.RI_HOST_URL, steps: [] };
const companion = JSON.parse(fs.readFileSync(path.join(__dirname, '../presets/Roleplay Instructions V10.json'), 'utf8'));

const LATE = 'B57 LATE: Something stirs in the hall.';
const DEPTH = 'B57 DEPTH: Remind the narrator of the weather.';
const FILE = 'B57 gates.json';
const fixture = { prompt_order: [{ character_id: 100000, order: ['late', 'depth'].map(identifier => ({ identifier, enabled: true })) }], prompts: [
    { identifier: 'late', name: 'Late Beat', content: `{{if {{getvar::turn}} >= 3}}${LATE}{{/if}}` },
    { identifier: 'depth', name: 'Depth Two', role: 'user', injection_position: 1, injection_depth: 2, content: DEPTH },
] };

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: NARROW ? 780 : 909, hasTouch: true, isMobile: NARROW });
    page.on('pageerror', error => console.error(error.stack));
    const B = L.BASE;
    const ev = (fn, value) => page.evaluate(fn, { B, value });
    let turn = 0;
    // One reply, and the logged request: { text, messages }.
    const send = async label => {
        L.resetLog();
        L.mode({ reply: 'Mira waits.' });
        await L.send(page, `B57 turn ${++turn}.`);
        const rows = L.requests('reply');
        assert.ok(rows.length >= 1, `${label}: a reply request was logged`);
        const row = rows.at(-1);
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-request-${label}.json`), JSON.stringify(row.messages, null, 2));
        return { text: L.text(row), messages: row.messages || [] };
    };
    const isTurn = m => typeof m.content === 'string' && (m.content.includes('B57 turn ') || m.content.trim() === 'Mira waits.');
    // Where a block landed: its role and how many chat messages follow it in the request (null when it is not sent).
    const placed = (messages, needle) => {
        const at = messages.findIndex(m => typeof m.content === 'string' && m.content.includes(needle));
        return at < 0 ? null : { role: messages[at].role, after: messages.slice(at + 1).filter(isTurn).length };
    };
    const shape = r => ({ late: placed(r.messages, LATE), depth: placed(r.messages, DEPTH) });
    const mark = (label, data) => results.steps.push({ label, ...data });
    // A new chat starts at the opening message; reply 1 is the first reply after it, so wait until the opening message is in.
    const freshChat = async () => {
        turn = 0;
        await L.openChat(page);
        await page.waitForFunction(() => { const chat = SillyTavern.getContext().chat; return chat.length === 1 && !chat[0].is_user; }, null, { timeout: 15000 });
    };

    try {
        await L.setupApi(page);
        await ev(async ({ B }) => {
            const S = await import(`${B}/src/store.js`), bank = await import(`${B}/src/preset-bank.js`);
            const st = S.settings();
            for (const name of ['bankStacks', 'bankVersions', 'bankTexts', 'bankImports', 'bankTags', 'importReports']) st[name] = {};
            S.saveSettings();
            bank.resetBank();
        });
        await page.evaluate(async () => {
            const manager = SillyTavern.getContext().getPresetManager('openai');
            for (const name of Object.keys(manager.getPresetList().preset_names)) if (name.includes('B57')) await manager.deletePreset(name);
        });
        await page.evaluate(data => SillyTavern.getContext().getPresetManager('openai').savePreset(data.name, data), companion);
        await L.usePreset(page, companion.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, world: { update: 'all', head: 0 } });
        await freshChat();
        await ev(async ({ B }) => { const V = await import(`${B}/src/v10.js`); if (!V.enabledV10()) throw new Error(`V10 is off on ${V.activePreset()}`); });

        // 1. The stack: both imported blocks in, the depth block moved to depth 1 as assistant and gated at reply 2.
        await ev(async ({ B, value }) => {
            const I = await import(`${B}/src/bank-import.js`), bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
            const found = I.readImportFile(value.file, JSON.stringify(value.data));
            await I.sendBlocksToBlockBank(found.blocks);
            const b = bank.currentBank() || bank.refreshBank('t'), base = V.activePreset();
            const cards = [...b.cards.values()].filter(c => bank.isImportSource(c.source) && c.sourceName === 'B57 gates');
            const keys = cards.map(c => c.key);
            if (keys.length !== 2) throw new Error(`expected 2 imported cards, found ${keys.length}`);
            const key = bank.stackFor(b, base).key;
            bank.includeCards(b, key, keys, { base });
            const depth = cards.find(c => c.name === 'Depth Two').key;
            bank.setCardSending(b, key, depth, { role: 'assistant', depth: 1, notBefore: 2 }, { base });
        }, { file: FILE, data: fixture });
        const stackShapes = [];
        for (let reply = 1; reply <= 4; reply++) {
            const r = await send(`stack-${reply}`);
            stackShapes.push(shape(r));
        }
        assert.equal(stackShapes[0].late, null, 'stack reply 1: the gate-3 block is left out');
        assert.equal(stackShapes[0].depth, null, 'stack reply 1: the gate-2 block is left out');
        assert.deepEqual(stackShapes[1].depth, { role: 'assistant', after: 1 }, 'stack reply 2: depth 1 as assistant');
        assert.equal(stackShapes[1].late, null);
        assert.ok(stackShapes[2].late && stackShapes[3].late, 'stack replies 3 and 4 send the gate-3 block');
        mark('stack', { shapes: stackShapes });

        // 2. Save the loadout from the stack, select it, and start a new chat.
        const name = await ev(async ({ B }) => {
            const lo = await import(`${B}/src/preset-loadouts.js`), wb = await import(`${B}/src/preset-workbench.js`);
            const manager = SillyTavern.getContext().getPresetManager('openai');
            return lo.saveLoadoutFromContext(manager, 'B57 Gates', wb.switchContext());
        });
        const saved = await ev(async ({ B, value }) => {
            const manager = SillyTavern.getContext().getPresetManager('openai');
            const data = manager.getCompletionPresetByName(value) || manager.getPresetList().presets.find((_, i) => manager.getPresetList().preset_names[value] === i);
            return data.prompts.filter(p => p.ri_not_before).map(p => ({ id: p.identifier, gate: p.ri_not_before, pos: p.injection_position, depth: p.injection_depth, role: p.role }));
        }, name);
        mark('loadout', { name, gated: saved });
        assert.ok(saved.some(p => p.gate === 3) && saved.some(p => p.gate === 2 && p.role === 'assistant' && p.depth === 1), `the loadout holds the gates and placement: ${JSON.stringify(saved)}`);
        await L.usePreset(page, name);
        await L.setupApi(page, { preset: null });
        await ev(async ({ B }) => { const wb = await import(`${B}/src/preset-workbench.js`); if (!wb.switchContext()?.marker) throw new Error('the loadout is not selected'); });
        await ev(async ({ B }) => { const S = await import(`${B}/src/store.js`); S.settings().diagnosticsLog = true; S.saveSettings(); });
        await freshChat();
        assert.equal(await ev(async ({ B }) => (await import(`${B}/src/diagnostics-log.js`)).diagnosticsOn()), true, 'the diagnostics log is on');

        // 3. The loadout sends what the stack sent, reply by reply; the log lists the gated cards.
        const loadShapes = [];
        for (let reply = 1; reply <= 4; reply++) {
            const r = await send(`loadout-${reply}`);
            loadShapes.push(shape(r));
            if (reply === 1 || reply === 3) {
                await page.waitForTimeout(2500);
                const rows = await page.evaluate(() => { const m = SillyTavern.getContext().chat.filter(x => !x.is_user && !x.is_system).at(-1); return (m.extra?.ri_diag?.stack || []).map(row => `${row.name}|${row.reason}|${row.why}`); });
                mark(`log-${reply}`, { rows });
                if (reply === 1) {
                    assert.ok(rows.some(row => /^Late Beat\|gate\|.*opens at reply 3$/.test(row)), `reply 1 lists the gate-3 card: ${rows}`);
                    assert.ok(rows.some(row => /^Depth Two\|gate\|.*opens at reply 2$/.test(row)), `reply 1 lists the gate-2 card: ${rows}`);
                } else assert.equal(rows.some(row => /\|gate\|/.test(row)), false, `reply 3 lists no gated card: ${rows}`);
            }
        }
        assert.deepEqual(loadShapes, stackShapes, 'the loadout sends the stack request at replies 1 to 4');
        mark('loadout-shapes', { shapes: loadShapes });

        // 4. A loadout saved before B57 holds no gate: its blocks send from reply 1 as saved.
        await ev(async ({ B, value }) => {
            const manager = SillyTavern.getContext().getPresetManager('openai');
            const { presets, preset_names } = manager.getPresetList();
            const data = structuredClone(presets[preset_names[value]] ?? presets.find((p, i) => preset_names[value] === i));
            for (const p of data.prompts) delete p.ri_not_before;
            await manager.savePreset('B57 Old Gates', data);
        }, name);
        await L.usePreset(page, 'B57 Old Gates');
        await freshChat();
        const old = await send('old-loadout-1');
        assert.ok(placed(old.messages, LATE) && placed(old.messages, DEPTH), 'an older loadout sends its blocks from reply 1');
        mark('old-loadout', { shape: shape(old) });

        assert.deepEqual(errors, [], 'no page errors');
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-results.json`), JSON.stringify(results, null, 2));
        console.log(`B57 loadout gates passed at ${WIDTH}`);
    } catch (error) {
        console.error(error);
        fs.writeFileSync(path.join(OUT, `w${WIDTH}-results.json`), JSON.stringify({ ...results, error: String(error?.stack || error) }, null, 2));
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
})();
