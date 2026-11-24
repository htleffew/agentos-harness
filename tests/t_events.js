const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const parts = r => { const m = L.text(r).match(/built from these parts: (.*?)\. Fit it to/); if (!m) return null; const o = {}; for (const p of m[1].split('; ')) { const i = p.indexOf(': '); o[p.slice(0, i)] = p.slice(i + 2); } return o; };
async function makeEvents(page, name, opts = {}) {
    await page.evaluate(async ({ BASE, name, opts }) => {
        const E = await import(`${BASE}/src/events.js`); const B = await import(`${BASE}/src/books.js`); const S = await import(`${BASE}/src/store.js`);
        const ev = E.newEvent(name);
        Object.assign(ev, { chance: opts.chance ?? 100, wait: opts.wait ?? 0, keep: opts.keep ?? 0 });
        const A = E.newCategory('Alpha', ['a1', 'a2', 'a3', 'a4']);
        const Bc = E.newCategory('Beta', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], { mode: 'keepRandom', keepMin: 2, keepMax: 2 });
        const C = E.newCategory('Gamma', ['c1', 'c2', 'c3'], { mode: 'keepFixed' }); C.fixed = C.items[1].id;
        const D = E.newCategory('Delta', ['d1', 'd2', 'd3', 'd4', 'd5'], { count: 2, itemWait: 1, useAll: false });
        const Ec = E.newCategory('Epsilon', ['e1', 'e2'], { on: false });
        const F = E.newCategory('Zeta', ['{{char}} smiles at {{user}}', 'z2 secret', 'z3'], { neverTags: 'dark' }); F.items[1].tags = 'dark'; F.items[2].always = true;
        ev.categories = [A, Bc, C, D, Ec, F];
        const data = { entries: {} }; E.writeEvent(data, ev);
        await B.createSet(name, 'events', data);
        const cs = S.chatState(); cs.activeSets = [name]; S.saveChatState();
    }, { BASE: L.BASE, name, opts });
}
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1000, height: 1400 });
    try {
        await L.setupApi(page);
        await page.evaluate(async B => (await import(`${B}/src/prompts.js`)).restorePrompt('event'), L.BASE);
        await L.setSettings(page, { showUnder: 'off', check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' } });
        // ---- A: dice and category rules ----
        await L.openChat(page); L.resetLog();
        const name = 'Ev ' + Date.now();
        await makeEvents(page, name);
        for (let i = 0; i < 8; i++) { await L.send(page, 'm' + i); await L.waitChecks(page); }
        let P = L.chatRequests().map(parts);
        console.log(P.map(p => p ? `${p.Alpha}|${p.Beta}|${p.Gamma}|${p.Delta}|${p.Zeta}` : 'none').join('\n'));
        assert(P.length === 8 && P.every(Boolean), 'A: an event order is in each of 8 prompts');
        assert(new Set(P.slice(0, 4).map(p => p.Alpha)).size === 4 && new Set(P.slice(4, 8).map(p => p.Alpha)).size === 4, 'A: "use every item before repeating" gives all 4 items in each round');
        assert([0, 2, 4, 6].every(i => P[i].Beta === P[i + 1].Beta) && [1, 3, 5].every(i => P[i].Beta !== P[i + 1].Beta), 'A: "keep for 2 events" holds the pick for 2 events, then changes');
        assert(P.every(p => p.Gamma === 'c2'), 'A: "keep until I turn it off" always uses the chosen item');
        assert(P.every(p => p.Delta.split(' and ').length === 2 && new Set(p.Delta.split(' and ')).size === 2) && P.slice(1).every((p, i) => !p.Delta.split(' and ').some(x => P[i].Delta.split(' and ').includes(x))), 'A: 2 items per pick, and an item sits out the next event');
        assert(P.every(p => !('Epsilon' in p)), 'A: a category that is off is left out');
        assert(P.every(p => p.Zeta === 'z3'), 'A: an always-included item is used; a never-use tag is respected');
        const sent = L.text(L.chatRequests()[0]).match(/\[System note: In this reply, an event must happen[^\]]*\]/);
        console.log(sent && sent[0]);
        assert(!!sent && /theirs to write\.\]$/.test(sent[0]), 'A: sent as a system note order');
        let recs = (await L.records(page)).filter(r => r.rec);
        assert(recs.length === 8 && recs.every(r => r.rec.items[0].status === 'done'), 'A: every event is recorded and checked');
        // ---- B: swipe repeats the same event; deleting rewinds the dice ----
        await L.swipe(page);
        P = L.chatRequests().map(parts);
        assert(JSON.stringify(P[8]) === JSON.stringify(P[7]), 'B: a swipe sends the same event again');
        await L.slash(page, '/del 4'); await page.waitForTimeout(500);   // back to after event 6
        await L.send(page, 'again 7'); await L.waitChecks(page); await L.send(page, 'again 8'); await L.waitChecks(page);
        P = L.chatRequests().map(parts);
        const round2 = [P[4], P[5], P[9], P[10]].map(p => p.Alpha);
        console.log('B round 2 after delete:', round2, 'Beta:', P[4].Beta, P[5].Beta, P[9].Beta, P[10].Beta);
        assert(new Set(round2).size === 4, 'B: after deleting 2 events, the round of items carries on from the events that are left');
        assert(P[9].Beta === P[10].Beta && P[9].Beta !== P[5].Beta, 'B: the kept pick also carries on from the events that are left');
        // ---- C: saved lorebook text works with the extension off ----
        const content = await page.evaluate(async (n) => Object.values((await globalThis.SillyTavern.getContext().loadWorldInfo(n)).entries)[0].content, name);
        console.log(content.slice(0, 330));
        assert(/Alpha: \{\{random::a1::a2::a3::a4\}\}; Beta: \{\{random::/.test(content) && /Gamma: c2;/.test(content) && !/Epsilon/.test(content) && !/z2 secret/.test(content), 'C: the lorebook entry holds a {{random}} list per category for use with the extension off');
        // ---- D: the panel ----
        await L.openPanel(page);
        await L.openPanel(page, 'events');
        await page.waitForTimeout(600);
        await page.evaluate((n) => [...document.querySelectorAll('#ri_root .ri-setcard .ri-card-name')].find(b => b.textContent === n).click(), name);
        await page.waitForTimeout(800);
        await page.evaluate(() => { const d = document.querySelectorAll('#ri_root details.ri-fold'); d[0].open = true; d[0].dispatchEvent(new Event('toggle')); });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Write items with AI').click());
        await page.waitForTimeout(300);
        await page.evaluate(() => { const f = [...document.querySelectorAll('#ri_root .ri-field')].find(x => x.querySelector('.ri-label')?.textContent === 'Kind of story'); const el = f.querySelector('input'); el.value = 'gothic estate'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Write the items').click());
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root button')].some(b => b.textContent === 'Add the ticked items'), null, { timeout: 20000 });
        await page.screenshot({ path: '/tmp/e1_ai.png' });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Add the ticked items').click());
        await page.waitForTimeout(300);
        const count = await page.evaluate(() => document.querySelectorAll('#ri_root details.ri-fold')[0].querySelectorAll('.ri-version').length);
        assert(count > 4, `D: items written with AI are added to the category (${count} items now)`);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Roll an example event').click());
        await page.waitForTimeout(300);
        const example = await page.evaluate(() => document.querySelector('#ri_root .ri-preview').textContent);
        console.log('example:', example.slice(0, 200));
        assert(/an event must happen in the story, built from these parts: Alpha: /.test(example) && !/\{\{/.test(example), 'D: "Roll an example event" shows the exact text');
        await page.evaluate(() => document.querySelector('#ri_root .ri-body').scrollTo(0, 0));
        await page.screenshot({ path: '/tmp/e2_edit.png' });
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Save story event set').click());
        await page.waitForTimeout(1200);
        await page.screenshot({ path: '/tmp/e3_list.png' });
        const wreq = L.requests().find(r => /story ingredients/.test(L.text(r)));
        console.log('--- items prompt ---\n' + L.text(wreq).slice(0, 1200));
    } catch (e) { process.exitCode = 1; console.log('TEST ERROR', e.stack); await page.screenshot({ path: '/tmp/e_err.png' }); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
