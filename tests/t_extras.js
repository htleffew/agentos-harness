const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const ev = r => { const m = L.text(r).match(/built from these parts: (.*?)\. Fit it to/); if (!m) return null; const o = {}; for (const p of m[1].split('; ')) { const i = p.indexOf(': '); o[p.slice(0, i)] = p.slice(i + 2); } return o; };
const sty = r => { const m = L.text(r).match(/write the story prose in this style: (.*?)\. This style applies/); if (!m) return null; const o = {}; for (const p of m[1].split('; ')) { const i = p.indexOf(': '); o[p.slice(0, i)] = p.slice(i + 2); } return o; };
const run = (page, fn, arg) => page.evaluate(async ({ BASE, fn, arg }) => { const mods = { E: await import(`${BASE}/src/events.js`), B: await import(`${BASE}/src/books.js`), S: await import(`${BASE}/src/store.js`), G: await import(`${BASE}/src/engine.js`) }; return await (new Function('m', 'arg', `return (${fn})(m, arg)`))(mods, arg); }, { BASE: L.BASE, fn: fn.toString(), arg });
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1000, height: 1400 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { showUnder: 'off', check: { mode: 'off' } });
        // ---- A: never together, linger, saved settings per chat ----
        await L.openChat(page); L.resetLog();
        const name = 'Ex ' + Date.now();
        await run(page, async (m, name) => {
            const e = m.E.newEvent(name); Object.assign(e, { chance: 100, wait: 0 });
            const time = m.E.newCategory('Time', [['t-past', 'past'], ['t-future', 'future']]);
            const tone = m.E.newCategory('Tone', [['o-past', 'past'], ['o-future', 'future']]);
            const hold = m.E.newCategory('Hold', ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'], { mode: 'keepRandom', keepMin: 1, keepMax: 1, changeChance: 1 });
            const pick = m.E.newCategory('Pick', ['k1', 'k2', 'k3', 'k4']);
            e.categories = [time, tone, hold, pick]; e.neverTogether = 'past+future';
            const fast = m.E.snapshotSettings(e.categories); fast.cats[hold.id].changeChance = 100; fast.cats[pick.id].on = false;
            e.presets = { Fast: fast };
            const data = { entries: {} }; m.E.writeEvent(data, e);
            await m.B.createSet(name, 'events', data);
            const cs = m.S.chatState(); cs.activeSets = [name]; m.S.saveChatState();
        }, name);
        for (let i = 0; i < 8; i++) await L.send(page, 'm' + i);
        let P = L.chatRequests().map(ev);
        console.log(P.map(p => `${p.Time}|${p.Tone}|${p.Hold}|${p.Pick}`).join('\n'));
        assert(P.every(p => p.Time.slice(2) === p.Tone.slice(2)), 'A: "never together" keeps past and future items apart in every roll');
        assert(new Set(P.map(p => p.Hold)).size <= 2, 'A: with a 1% chance to change, a kept pick stays on after its time is over');
        await run(page, (m, name) => { const cs = m.S.chatState(); cs.presets[name] = 'Fast'; m.S.saveChatState(); }, name);
        for (let i = 0; i < 4; i++) await L.send(page, 'f' + i);
        P = L.chatRequests().map(ev);
        console.log(P.slice(8).map(p => `${p.Hold}|${p.Pick || '-'}`).join('\n'));
        assert(new Set(P.slice(8).map(p => p.Hold)).size === 4 && P.slice(8).every(p => !('Pick' in p)), 'A: saved settings chosen for this chat apply right away (pick changes every event; one category off)');

        // ---- B: buttons on one picked item ----
        const key = await run(page, () => { const c = globalThis.SillyTavern.getContext(); return c.chat[c.chat.length - 1].extra.roleplay_instructions.items[0].key; });
        const last = await run(page, () => { const c = globalThis.SillyTavern.getContext(); return c.chat[c.chat.length - 1].extra.roleplay_instructions.items[0].parts; });
        const holdPart = last.find(p => p.name === 'Hold');
        await run(page, async (m, a) => { await m.G.rerollPartNow(a.key, a.catId); }, { key, catId: holdPart.catId });
        await page.waitForTimeout(800); await L.idle(page);
        P = L.chatRequests().map(ev);
        console.log('pick again:', P[11].Hold, '->', P[12].Hold, '| others:', P[11].Time, P[12].Time, P[11].Tone, P[12].Tone);
        assert(P[12].Hold !== P[11].Hold && P[12].Time === P[11].Time && P[12].Tone === P[11].Tone, 'B: "Pick again" on one item changes that category only');
        const now = await run(page, () => { const c = globalThis.SillyTavern.getContext(); return c.chat[c.chat.length - 1].extra.roleplay_instructions.items[0].parts; });
        const hp = now.find(p => p.name === 'Hold');
        await run(page, (m, a) => m.G.setLock(a.key, a.catId, a.ids), { key, catId: hp.catId, ids: hp.ids });
        for (let i = 0; i < 3; i++) await L.send(page, 'l' + i);
        P = L.chatRequests().map(ev);
        assert(P.slice(13).every(p => p.Hold === P[12].Hold), 'B: "Lock for this chat" keeps that pick in every later event');
        await run(page, (m, a) => m.G.setLock(a.key, a.catId, null), { key, catId: hp.catId });
        await L.send(page, 'u0'); await L.send(page, 'u1');
        P = L.chatRequests().map(ev);
        assert(new Set(P.slice(15).map(p => p.Hold)).size === 2 || P[16].Hold !== P[12].Hold, 'B: unlocking lets the dice pick again');

        // ---- C: rules checked without AI ----
        await L.openChat(page); L.resetLog();
        const sname = 'Rules ' + Date.now();
        await run(page, async (m, sname) => {
            const e = m.E.newStyle(sname);
            const rule = m.E.newCategory('Rule', [['nothing spoken aloud', 'rule:no-dialogue'], ['two sentences per paragraph at most', 'rule:max-sentences-2']], { mode: 'new', count: 2 });
            e.categories = [rule];
            const data = { entries: {} }; m.E.writeEvent(data, e);
            await m.B.createSet(sname, 'style', data);
            const cs = m.S.chatState(); cs.activeSets = [sname]; m.S.saveChatState();
        }, sname);
        await L.send(page, 'r0');
        L.mode({ reply: 'Reply 1. She walks to the window.' });
        await L.send(page, 'r1');
        L.mode({});
        const rules = await run(page, () => globalThis.SillyTavern.getContext().chat.filter(x => x.extra?.roleplay_instructions?.items?.length).map(x => x.extra.roleplay_instructions.items[0].rules));
        console.log('rules:', JSON.stringify(rules));
        assert(rules.length === 2 && rules[0].some(r => /spoken/.test(r.label) && !r.ok) && rules[1].every(r => r.ok) && rules[1].length === 2, 'C: rule tags are checked against the reply without AI (not followed, then followed)');
        assert(L.requests().filter(r => /"done"/.test(L.text(r))).length === 0, 'C: no AI request is used for rule checks');

        // ---- D: the panel shows it ----
        await L.openPanel(page);
        await L.openPanel(page, 'sent');
        await page.waitForTimeout(600);
        const txt = await page.evaluate(() => document.querySelector('#ri_root .ri-body').innerText);
        assert(/RULES CHECKED/i.test(txt) && /Followed: nothing spoken aloud/.test(txt) && /Lock for this chat/.test(txt) && /Keep until I turn it off/.test(txt) && /Pick again/.test(txt), 'D: What Was Sent shows rule results and the three buttons on each picked item');
        await page.screenshot({ path: '/tmp/x1.png' });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-part button')].find(b => b.textContent === 'Keep until I turn it off').click());
        await page.waitForTimeout(1500);
        const mode = await run(page, async (m, sname) => { const d = await m.B.loadSet(sname); const c = Object.values(d.entries)[0].extensions.ri.categories[0]; return c.mode + ':' + !!c.fixed; }, sname);
        assert(mode === 'keepFixed:true', 'D: "Keep until I turn it off" changes the set itself');
        await L.openPanel(page, 'events');
        await page.waitForTimeout(400);
        await page.evaluate((n) => [...document.querySelectorAll('#ri_root .ri-setcard .ri-card-name')].find(b => b.textContent === n).click(), name);
        await page.waitForTimeout(800);
        const edit = await page.evaluate(() => document.querySelector('#ri_root .ri-body').innerText);
        assert(/In use: "past" with "future"/.test(edit) && /SETTINGS USED IN THIS CHAT/i.test(edit) && /Fast/.test(edit), 'D: the set editor shows the never-together pairs and the saved settings');
        await page.evaluate(() => document.querySelector('#ri_root .ri-body').scrollTo(0, 99999));
        await page.screenshot({ path: '/tmp/x2.png' });
    } catch (e) { console.log('TEST ERROR', e.stack); await page.screenshot({ path: '/tmp/x_err.png' }); }
    L.mode({});
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
