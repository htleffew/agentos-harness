const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1000, height: 1400 });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await L.send(page, 'I open the old door and step into the library.');
        await L.send(page, 'I pick up the red book from the desk.');
        await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); c.setExtensionPrompt('1_memory', 'SUMMARY-MARK: they met in the forest and reached the library.', 0, 0); });
        const ask = async (context, kind) => { L.resetLog(); await page.evaluate(async ({ BASE, context, kind }) => {
            const W = await import(`${BASE}/src/writer.js`); const B = await import(`${BASE}/src/books.js`); const E = await import(`${BASE}/src/events.js`);
            if (kind === 'items') await W.writeItems({ category: E.newCategory('Situation'), theme: 'gothic', count: 3, context, existing: [], others: [] });
            else { const ins = B.newInstruction({ entries: {} }); ins.name = 'T'; await W.writeVersions({ ins, seed: 'The character compliments the user.', count: 3, context }); }
        }, { BASE: L.BASE, context, kind }); return L.text(L.requests()[0]); };
        let t = await ask({});
        assert(!/What is known about the story/.test(t), 'nothing ticked: no story material is sent');
        t = await ask({ card: true, scenario: true, persona: true, summary: true, recent: true, recentCount: 3 });
        console.log(t.slice(t.indexOf('What is known about the story'), t.indexOf('What is known about the story') + 900));
        assert(/Character description: /.test(t) && /SUMMARY-MARK/.test(t) && /The most recent messages of the chat, oldest first:/.test(t), 'everything ticked: card, summary and recent messages are in the prompt');
        const recent = t.split('The most recent messages of the chat, oldest first:')[1];
        assert(/red book from the desk/.test(recent) && !/old door/.test(recent), 'recent messages: only the last 3 are sent');
        t = await ask({ recent: true, recentCount: 10 }, 'items');
        assert(/old door/.test(t) && !/Character description/.test(t) && !/SUMMARY-MARK/.test(t), 'items writer: only what is ticked is sent');
        // who does it: existing or new, by gender
        L.resetLog();
        await page.evaluate(async ({ BASE }) => { const W = await import(`${BASE}/src/writer.js`); const B = await import(`${BASE}/src/books.js`); const ins = B.newInstruction({ entries: {} }); ins.name = 'T'; ins.actor = 'npcFemale'; ins.target = 'npcAny'; await W.writeVersions({ ins, seed: 'Someone flirts.', count: 2, context: {} }); }, { BASE: L.BASE });
        t = L.text(L.requests()[0]);
        console.log(t.split('\n').filter(l => /^Who /.test(l)).join('\n').slice(0, 700));
        assert(/Who does it: any one female character other than \[\[user\]\]: the roleplay AI chooses either a woman or girl who is already in the story/.test(t) && /Who it happens to: any one character other than \[\[user\]\]/.test(t), 'who does it: "any female character, already in the story or new" reaches the AI writer');
        const opts = await page.evaluate(async (BASE) => { const B = await import(`${BASE}/src/books.js`); return [Object.values(B.ACTORS).map(a => a.label), Object.values(B.TARGETS).map(a => a.label)]; }, L.BASE);
        console.log(opts[0]);
        assert(opts[0].length === 7 && opts[1].length === 7 && opts[0].filter(l => /already in the story or new/.test(l)).length === 3, 'the pickers offer any, female and male "already in the story or new" for who does it and who it happens to');
        // the panel
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Expand').click());
        await page.evaluate(async (B) => { const M = await import(`${B}/src/books.js`); const n = 'Ctx ' + Date.now(); await M.createSet(n); const P = await import(`${B}/src/ui/panel.js`); P.app.cache = {}; P.app.tab = 'instructions'; P.app.go({ view: 'set', name: n }); }, L.BASE);
        await page.waitForTimeout(500);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Add instruction').click());
        await page.waitForTimeout(300);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Write versions with AI').click());
        await page.waitForTimeout(300);
        const labels = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-sheet .ri-vpick')].map(l => l.textContent.trim()));
        console.log(labels);
        assert(labels.length === 5 && /Chat summary$/.test(labels[3]) && /most recent chat messages/.test(labels[4]), 'the writer page offers the five choices, and finds the chat summary');
        await page.screenshot({ path: '/tmp/c1.png' });
    } catch (e) { console.log('TEST ERROR', e.stack); }
    console.log('ERRORS', errors.slice(0, 10));
    await browser.close();
})();
