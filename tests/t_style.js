const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const style = r => { const m = L.text(r).match(/write the story prose in this style: (.*?)\. This style applies/); if (!m) return null; const o = {}; for (const p of m[1].split('; ')) { const i = p.indexOf(': '); o[p.slice(0, i)] = p.slice(i + 2); } return o; };
async function makeStyle(page, name) {
    await page.evaluate(async ({ BASE, name }) => {
        const E = await import(`${BASE}/src/events.js`); const B = await import(`${BASE}/src/books.js`); const S = await import(`${BASE}/src/store.js`);
        const ev = E.newStyle(name);
        const mood = E.newCategory('Mood', ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], { mode: 'keepRandom', keepMin: 3, keepMax: 3, after: 'it drives one choice' });
        const prose = E.newCategory('Prose', ['p1', 'p2', 'p3'], { mode: 'keepFixed' }); prose.fixed = prose.items[2].id;
        const rule = E.newCategory('Rule', ['r1', 'r2', 'r3', 'r4'], { mode: 'new', chance: 100, restAfter: 1 });
        const off = E.newCategory('Sense', ['s1'], { on: false });
        const pov = E.newCategory('Point of view', ['v1'], { on: true, locked: true });
        ev.categories = [mood, prose, rule, off, pov];
        const data = { entries: {} }; E.writeEvent(data, ev);
        await B.createSet(name, 'style', data);
        const cs = S.chatState(); cs.activeSets = [...cs.activeSets, name]; S.saveChatState();
    }, { BASE: L.BASE, name });
}
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1000, height: 1400 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' } });
        // ---- A: style alone ----
        await L.openChat(page); L.resetLog();
        const name = 'St ' + Date.now();
        await makeStyle(page, name);
        for (let i = 0; i < 8; i++) { await L.send(page, 'm' + i); await L.waitChecks(page); }
        let P = L.chatRequests().map(style);
        console.log(P.map(p => p ? `${p.Mood}|${p.Prose}|${p.Rule || '-'}` : 'none').join('\n'));
        assert(P.length === 8 && P.every(Boolean), 'A: a style order is in each of 8 prompts');
        assert(P[0].Mood === P[1].Mood && P[1].Mood === P[2].Mood && P[3].Mood !== P[2].Mood && P[3].Mood === P[5].Mood && P[6].Mood !== P[5].Mood, 'A: the mood is kept for 3 replies, then changes');
        assert(P.every(p => /\(it drives one choice\)$/.test(p.Mood)), 'A: the words added after the pick are sent');
        assert(P.every(p => p.Prose === 'p3'), 'A: "keep until I turn it off" always uses the chosen item');
        assert([0, 2, 4, 6].every(i => P[i].Rule) && [1, 3, 5, 7].every(i => !P[i].Rule), 'A: a rule with "rest 1 reply" is never used two replies in a row');
        assert(P.every(p => !('Sense' in p) && !('Point of view' in p)), 'A: categories that are off or locked are left out');
        const full = L.text(L.chatRequests()[0]).match(/\[System note: In this reply, write the story prose[^\]]*\]/);
        console.log(full && full[0]);
        assert(full && /applies to the story prose only/.test(full[0]) && /a required instruction wins over any style choice/.test(full[0]), 'A: the order carries the scope line and "a required instruction wins"');
        assert(L.requests().filter(r => /"done"/.test(L.text(r))).length === 0, 'A: writing style alone never triggers a check request');
        const recs = (await L.records(page)).filter(r => r.rec);
        assert(recs.length === 8 && recs.every(r => r.rec.items.length === 1 && r.rec.items[0].status === 'sent'), 'A: every reply has a record of the style that was sent');
        await L.swipe(page);
        P = L.chatRequests().map(style);
        assert(JSON.stringify(P[8]) === JSON.stringify(P[7]), 'A: a swipe sends the same style again');
        await L.slash(page, '/del 4'); await page.waitForTimeout(500);   // back to after reply 6
        await L.send(page, 'again 7'); await L.send(page, 'again 8');
        P = L.chatRequests().map(style);
        console.log('after delete:', [P[9], P[10]].map(p => `${p.Mood}|${p.Rule || '-'}`));
        assert(P[9].Mood !== P[5].Mood && P[9].Mood === P[10].Mood && !!P[9].Rule && !P[10].Rule, 'A: after deleting 2 replies, mood and rule timing carry on from the replies that are left');

        // ---- B: style together with an instruction that is overdue ----
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await L.makeSet(page, 'tSI' + Date.now(), [{ name: 'X', versions: ['X1'], wait: 50 }]);
        await makeStyle(page, 'St2 ' + Date.now());
        for (let i = 0; i < 3; i++) { await L.send(page, 'b' + i); await L.waitChecks(page); }
        L.mode({});
        const reqs = L.chatRequests();
        const kinds = reqs.map(r => { const t = L.text(r); return /Final\. This must happen early/.test(t) ? 'final' : /Overdue\. This was ordered/.test(t) ? 'overdue' : L.marks(r).length ? 'first' : 'none'; });
        console.log('B:', kinds, reqs.map(r => !!style(r)));
        assert(JSON.stringify(kinds) === JSON.stringify(['first', 'overdue', 'final']) && reqs.every(r => !!style(r)), 'B: style keeps going with every reply while an instruction is overdue and re-sent');
        const creq = L.requests().filter(r => /"done"/.test(L.text(r)));
        assert(creq.length === 3 && creq.every(r => !/write the story prose/.test(L.text(r).split('INSTRUCTIONS:')[1])), 'B: the check covers the instruction and leaves the style out');

        // ---- C: the panel ----
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Expand').click());
        await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-tab')].find(t => t.textContent === 'Random Writing Style').click());
        await page.waitForTimeout(500);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Add writing style set').click());
        await page.waitForTimeout(500);
        const nm = 'Default style ' + Date.now();
        await page.evaluate((nm) => { const d = document.querySelector('dialog[open]'); const i = d.querySelector('input, textarea'); i.value = nm; i.dispatchEvent(new Event('input', { bubbles: true })); d.querySelector('.popup-button-ok').click(); }, nm);
        await page.waitForTimeout(1500);
        const cats = await page.evaluate(() => [...document.querySelectorAll('#ri_root details.ri-fold')].map(d => d.querySelector('.ri-sent-title').textContent + ' / ' + d.querySelector('.ri-sent-sub').textContent));
        console.log(cats.join('\n'));
        assert(cats.length === 8 && /Locked/.test(cats[7]) && /17 items/.test(cats[0]), 'C: a new set comes with 8 categories; mood has 17 items; point of view is locked');
        const seen = new Set();
        for (let i = 0; i < 4; i++) { await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === "Roll the next reply's style").click()); await page.waitForTimeout(200); seen.add(await page.evaluate(() => document.querySelector('#ri_root .ri-preview').textContent)); }
        console.log([...seen][0]);
        assert(seen.size === 1 && /mood: .*\(this mood drives at least one of Seraphina's choices/.test([...seen][0]) && !/\{\{/.test([...seen][0]), 'C: the example shows the exact style order, and mood and prose style hold steady across 4 replies');
        await page.evaluate(() => { const d = document.querySelectorAll('#ri_root details.ri-fold'); d[0].open = true; d[0].dispatchEvent(new Event('toggle')); d[7].open = true; d[7].dispatchEvent(new Event('toggle')); });
        await page.waitForTimeout(400);
        await page.screenshot({ path: '/tmp/st1.png' });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Save writing style set').click());
        await page.waitForTimeout(1200);
        const content = await page.evaluate(async (n) => Object.values((await globalThis.SillyTavern.getContext().loadWorldInfo(n)).entries)[0].content, nm);
        assert(/write the story prose in this style: \{\{char\}\}'s mood: \{\{random::on edge::irritable/.test(content), 'C: the saved lorebook entry works with the extension off');
        await page.screenshot({ path: '/tmp/st2.png' });
    } catch (e) { console.log('TEST ERROR', e.stack); await page.screenshot({ path: '/tmp/st_err.png' }); }
    L.mode({});
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
