const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const wording = r => { const t = L.text(r); return /Final\. This must happen early/.test(t) ? 'final' : /Overdue\. This was ordered/.test(t) ? 'overdue' : L.marks(r).length ? 'first' : /'s goal: /.test(t) ? 'goal' : 'none'; };
const setGoal = (page, g) => page.evaluate(async ({ BASE, g }) => { const G = await import(`${BASE}/src/goals.js`); const cur = G.goals(); Object.assign(cur, G.blankGoal(), { on: true, goal: '{{char}} wants {{user}} to trust {{char.them}}' }, g);
    cur.steps = (g.steps || []).map(k => ({ id: 'id' + k, text: `do thing ${k} to {{user}}`, on: true })); cur.actions = (g.actions || []).map(k => ({ id: 'id' + k, text: `do thing ${k} to {{user}}`, on: true })); G.saveGoals(); }, { BASE: L.BASE, g });
const progress = (page) => page.evaluate(async (BASE) => { const G = await import(`${BASE}/src/goals.js`); const p = G.goalProgress('normal'); const g = G.goals(); return { done: [...p.done.keys()], quotes: [...p.done.values()].map(v => v.quote), goalDone: G.goalDone(g, p), pending: p.pending }; }, L.BASE);
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1000, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { agency: 'off' } });
        // ---- A: steps in any order, actions wait, goal done stops everything ----
        await L.openChat(page); L.resetLog();
        await setGoal(page, { chance: 100, waitMin: 2, waitMax: 2, steps: ['S1', 'S2', 'S3'], actions: ['A1'] });
        let doneAt = -1;
        for (let i = 0; i < 16; i++) { await L.send(page, 'm' + i); await L.waitChecks(page); if (doneAt < 0 && (await progress(page)).goalDone) doneAt = i; if (doneAt >= 0 && i >= doneAt + 2) break; }
        let reqs = L.chatRequests(); let seq = reqs.map(r => L.marks(r).join('') || (/'s goal: /.test(L.text(r)) ? 'goal' : '-'));
        console.log('A:', seq.join(' '), '| done at reply', doneAt + 1);
        const sample = L.text(reqs[0]).match(/\[System note: In this reply,[^\]]*\]/)[0];
        console.log(sample);
        assert(/Seraphina must do thing \w\d to User\. How it happens is up to you; it must happen\. This serves Seraphina's goal: Seraphina wants User to trust her\./.test(sample), 'A: the order names the task and the goal, with names and pronouns filled in');
        const steps = seq.filter(x => /^S/.test(x));
        assert(steps.length === 3 && new Set(steps).size === 3, 'A: each one-time step is sent once and ticked off');
        const aIdx = seq.map((x, i) => x === 'A1' ? i : -1).filter(i => i >= 0);
        assert(aIdx.every((v, i) => i === 0 || v - aIdx[i - 1] > 2), `A: the repeatable action waits 2 replies between sends (sent at ${aIdx.map(i => i + 1).join(', ')})`);
        assert(doneAt >= 0 && seq.slice(doneAt + 1).every(x => x === '-') && seq.slice(0, doneAt + 1).every(x => x !== '-'), 'A: the goal goes with every reply until every step is done, then nothing more is sent');
        const pr = await progress(page);
        assert(pr.done.length === 3 && pr.quotes.every(q => q), 'A: every finished step keeps the words that show it');

        // ---- B: a step that does not happen is sent again, with firmer wording, until it does ----
        await L.openChat(page); L.resetLog(); L.mode({ done: false });
        await setGoal(page, { chance: 100, steps: ['S1'], actions: [] });
        for (let i = 0; i < 5; i++) { await L.send(page, 'b' + i); await L.waitChecks(page); }
        L.mode({});
        await L.send(page, 'b5'); await L.waitChecks(page); await L.send(page, 'b6'); await L.waitChecks(page);
        reqs = L.chatRequests();
        console.log('B:', reqs.map(wording));
        assert(JSON.stringify(reqs.map(wording)) === JSON.stringify(['first', 'overdue', 'final', 'final', 'final', 'final', 'none']), 'B: first, overdue, then final for as long as it takes; it stops once it has happened');

        // ---- C: swipe repeats; deleting un-ticks a step ----
        await L.openChat(page); L.resetLog();
        await setGoal(page, { chance: 100, steps: ['S1', 'S2'], actions: [], autoDone: false });
        for (let i = 0; i < 3; i++) { await L.send(page, 'c' + i); await L.waitChecks(page); }
        await L.swipe(page); await L.waitChecks(page);
        reqs = L.chatRequests(); seq = reqs.map(r => L.marks(r).join('') || (/'s goal: /.test(L.text(r)) ? 'goal' : '-'));
        console.log('C:', seq.join(' '));
        assert(new Set(seq.slice(0, 2)).size === 2 && seq[2] === 'goal' && seq[3] === 'goal', 'C: with both steps done only the goal line is sent, and a swipe sends the same');
        await L.slash(page, '/del 4'); await page.waitForTimeout(500);
        const after = await progress(page);
        await L.send(page, 'c again'); await L.waitChecks(page);
        seq = L.chatRequests().map(r => L.marks(r).join('') || 'goal');
        console.log('C after delete: done', after.done, '| next task', seq[4]);
        assert(after.done.length === 1 && seq[4] === seq[1], 'C: deleting the reply that finished a step un-ticks it, and it is sent again');

        // ---- D: repeatable actions are not checked ----
        await L.openChat(page); L.resetLog();
        await setGoal(page, { chance: 100, waitMin: 0, waitMax: 0, steps: [], actions: ['A1', 'A2'] });
        for (let i = 0; i < 3; i++) await L.send(page, 'd' + i);
        assert(L.requests().filter(r => /"done"/.test(L.text(r))).length === 0 && L.chatRequests().every(r => L.marks(r).length === 1), 'D: repeatable actions are sent and never use a check request');

        // ---- E: the panel ----
        await L.openChat(page);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Expand').click());
        await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-tab')].find(t => t.textContent === 'Character Goals').click());
        await page.waitForTimeout(400);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Write a goal with AI').click());
        await page.waitForTimeout(300);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Write the goal').click());
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root button')].some(b => b.textContent === 'Use this goal'), null, { timeout: 20000 });
        await page.screenshot({ path: '/tmp/g1.png' });
        const shown = await page.evaluate(() => document.querySelector('#ri_root .ri-sheet-box').innerText);
        assert(/Seraphina wants User to trust her/.test(shown) && /Shorten it to 8 or fewer/.test(shown) && /ties this to a place, time or object/.test(shown), 'E: the AI goal is shown for review, and a long, specific step is flagged');
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Use this goal').click());
        await page.waitForTimeout(500);
        const state = await page.evaluate(async (BASE) => { const G = await import(`${BASE}/src/goals.js`); const g = G.goals(); return { on: g.on, goal: g.goal, steps: g.steps.length, actions: g.actions.length }; }, L.BASE);
        assert(state.on && state.steps === 5 && state.actions === 5 && state.goal === '{{char}} wants {{user}} to trust {{char.them}}', 'E: "Use this goal" fills the goal, 5 steps and 5 actions and turns it on');
        await page.evaluate(() => document.querySelector('#ri_root .ri-body').scrollTo(0, 0));
        await page.screenshot({ path: '/tmp/g2.png' });
    } catch (e) { console.log('TEST ERROR', e.stack); await page.screenshot({ path: '/tmp/g_err.png' }); }
    L.mode({});
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
