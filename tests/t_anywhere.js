// 5.8: story events that work in any setting. The rules given to the AI writer for each kind of list, the scene left
// out of event lists, the line in the event order, the stakes list, the rewrite, and the works-anywhere mark.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const ask = async (page, cat, extra = {}) => { L.resetLog(); await page.evaluate(async ([B, cat, extra]) => { const W = await import(`${B}/src/writer.js`); const E = await import(`${B}/src/events.js`); const c = E.newCategory(cat.name); if (cat.driver) c.driver = true; await W.writeItems({ category: c, theme: 'a fantasy march', count: 4, context: { card: true, recent: true, summary: true, recentCount: 5 }, existing: [], others: [], ...extra }); }, [L.BASE, cat, extra]); return L.text(L.requests()[0]); };

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, writer: { eventScene: false } });
        const t = Date.now();
        await L.openChat(page);
        L.mode({ reply: 'They marched past the ruined bridge SCENEMARK.' });
        await L.send(page, 'We cross the river.');
        L.mode({});

        // ----- 1. the rules for each kind of list
        const sit = await ask(page, { name: 'Situation' });
        const comp = await ask(page, { name: 'Complication' });
        const drv = await ask(page, { name: 'Who drives it', driver: true });
        const tone = await ask(page, { name: 'Tone' });
        const stake = await ask(page, { name: 'What it puts at stake' });
        const any = '- It works in any setting of this story. Test it: it makes sense in a camp, inside a house, on a road, on a ship and on a city street.';
        assert([sit, comp, drv, tone, stake].every(x => x.includes(any)) && !/Concrete enough to act on/.test(sit), 'rules: every story event list is told that items must work in any setting, with the test of five settings');
        assert(/Say what kind of thing happens and who it reaches/.test(sit) && /"a bridge collapses under the column" needs a bridge and a column/.test(sit), 'rules: Situation items say what happens and to whom, with a good example and a too-specific one');
        assert(/Say how the situation gets harder for the people in it/.test(comp) && /"the rope frays halfway across"/.test(comp) && !/bridge collapses/.test(comp), 'rules: Complication items say how things get harder, with their own examples');
        assert(/Name a role in the story, not a person tied to one place, group or trade/.test(drv) && /quartermaster of the column/.test(drv), 'rules: Who drives it items name a role, not a person tied to one place');
        assert(/Name a feeling, not a place, a sound or the weather/.test(tone) && /Say what is at stake and for whom/.test(stake), 'rules: Tone items name a feeling, and stakes items say what is at stake for whom');
        const style = await page.evaluate(async (B) => { const W = await import(`${B}/src/writer.js`); const E = await import(`${B}/src/events.js`); return 0; }, L.BASE);

        // ----- 2. the current scene is left out of event lists unless asked for
        assert(!/SCENEMARK/.test(sit) && /What is known about the story\. Use it for the kind of story and the people in it\. The items still have to work in any setting/.test(sit), 'scene: the recent messages and the story so far are left out of story event lists to start with, and the card is still read');
        await L.setSettings(page, { writer: { eventScene: true } });
        const withScene = await ask(page, { name: 'Situation' });
        await L.setSettings(page, { writer: { eventScene: false } });
        assert(/SCENEMARK/.test(withScene), 'scene: with "Let the AI read where the story is now" on, the recent messages are read too');

        // ----- 6. the works-anywhere mark
        assert(/Return only a JSON list of objects, one per item, each with "text" \(the item\) and "anywhere"/.test(sit), 'mark: the AI says for each item whether it works in every setting, in the same request');
        L.mode({ writer: JSON.stringify([{ text: 'news arrives that shakes [[char]]', anywhere: true }, { text: 'the bridge gives way', anywhere: false }, 'a stranger appears']) });
        const got = await page.evaluate(async (B) => { const W = await import(`${B}/src/writer.js`); const E = await import(`${B}/src/events.js`); return W.writeItems({ category: E.newCategory('Situation'), theme: 'x', count: 3, context: {}, existing: [], others: [] }); }, L.BASE);
        assert(got.map(x => `${x.text}:${x.anywhere}`).join('|') === 'news arrives that shakes {{char}}:true|the bridge gives way:false|a stranger appears:null', 'mark: the answer is read with its mark, and a plain list still works');

        // ----- 3. the line in the event order
        const order = await page.evaluate(async (B) => { const E = await import(`${B}/src/events.js`); const c = E.newCategory('Situation', ['a bridge collapses under the column']); return E.rollEvent({ type: 'event', categories: [c] }, null).text; }, L.BASE);
        assert(/If a part names something that is not in this scene, keep what that part does to the people and change how it happens\./.test(order), 'order: every story event tells the AI to keep what a part does and change how it happens when the part names something not in the scene');

        // ----- 4. the stakes list
        const st = await page.evaluate(async (B) => { const E = await import(`${B}/src/events.js`); const cats = E.defaultCategories(); const s = cats.find(c => c.name === E.STAKES_NAME); return { names: cats.map(c => c.name), n: s.items.length, burn: s.burn, roles: cats.map(c => E.listRole(c)), first: s.items[0].text }; }, L.BASE);
        assert(st.names.join() === 'Situation,Complication,What it puts at stake,Who drives it,Tone' && st.n === 10 && !st.burn && st.first === '{{user}} is in immediate mortal danger' && st.roles.join() === 'situation,complication,stake,driver,tone', 'stakes: a new set has a list of what an event puts at stake, with ten items that work anywhere, and every list is read as its kind');

        // the panel: older set, add the stakes list, rewrite, scene choice
        const OLD = 'Anywhere ' + t;
        await page.evaluate(async ([B, name]) => {
            const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`);
            const ev = E.newEvent(name);
            ev.categories = [E.newCategory('Situation', ['a bridge collapses under the column', 'the supply wagon loses a wheel', 'news arrives that changes everything']), ev.categories.find(c => c.driver)];
            const d = { entries: {} }; E.writeEvent(d, ev); await K.createSet(name, 'events', d, '');
            const P = await import(`${B}/src/ui/panel.js`); const data = await K.loadSet(name); const draft = E.readEvent(E.findEventEntry(data, 'event', name), name);
            P.app.tab = 'events'; P.app.eroute = { view: 'edit', name, draft, open: { [draft.categories[0].id]: true } }; P.app.render();
        }, [L.BASE, OLD]);
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Expand'); if (b) b.click(); });
        await page.waitForTimeout(500);
        const click = (text) => page.evaluate((text) => { const b = [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === text); if (!b) throw new Error('no button ' + text); b.click(); }, text);
        await click('Add the list "What it puts at stake"');
        await page.waitForTimeout(300);
        const after = await page.evaluate(async (B) => (await import(`${B}/src/ui/panel.js`)).app.eroute.draft.categories.map(c => c.name), L.BASE);
        assert(after.join() === 'Situation,What it puts at stake,Who drives it', 'panel: an older set gets a button that adds the stakes list, placed before Who drives it');
        await click('Make these work anywhere');
        await page.waitForTimeout(300);
        L.mode({ writer: JSON.stringify(['the way ahead gives out under someone', 'something everyone relies on breaks', 'news arrives that changes everything']) }); L.resetLog();
        await click('Rewrite the items');
        await page.waitForFunction(() => /Use the ticked rewrites/.test(document.querySelector('#ri_root').textContent), null, { timeout: 10000 });
        const rq = L.text(L.requests()[0]);
        const sheet = await page.evaluate(() => document.querySelector('#ri_root .ri-sheet-box').textContent);
        assert(/1\. a bridge collapses under the column\n2\. the supply wagon loses a wheel\n3\. news arrives that changes everything/.test(rq) && /Keep what the item does to the people/.test(rq) && /An item that already works anywhere comes back exactly as it was/.test(rq) && L.requests().length === 1, 'rewrite: one request sends the numbered items with the rules for working anywhere');
        console.log('sheet:', sheet.slice(0, 700));
        assert(/2 of 3 items were rewritten/.test(sheet) && /Was: a bridge collapses under the columnNow: the way ahead gives out under someone/.test(sheet) && !/Was: news arrives/.test(sheet), 'rewrite: only the items that changed are shown, each with what it was and what it is now');
        await page.screenshot({ path: '/tmp/s58_rewrite.png' });
        await page.evaluate(() => { const boxes = [...document.querySelectorAll('#ri_root .ri-sheet-box .ri-version input')]; boxes[1].checked = false; boxes[1].dispatchEvent(new Event('change', { bubbles: true })); });
        await click('Use the ticked rewrites');
        await page.waitForTimeout(300);
        const items = await page.evaluate(async (B) => (await import(`${B}/src/ui/panel.js`)).app.eroute.draft.categories[0].items.map(i => i.text), L.BASE);
        assert(items.join('|') === 'the way ahead gives out under someone|the supply wagon loses a wheel|news arrives that changes everything', 'rewrite: only the ticked rewrites are used, and each item keeps its place');
        // the AI box: the scene choice and the works-anywhere flag
        await click('Write items with AI');
        await page.waitForTimeout(300);
        const aiText = await page.evaluate(() => document.querySelector('#ri_root .ri-sheet-box').textContent);
        assert(/Let the AI read where the story is now/.test(aiText) && /Off \(recommended\)/.test(aiText), 'panel: the AI box has the choice to read where the story is now, off to start with');
        L.mode({ writer: JSON.stringify([{ text: 'news arrives that shakes [[char]]', anywhere: true }, { text: 'the bridge gives way', anywhere: false }]) });
        await page.evaluate(() => { const f = [...document.querySelectorAll('#ri_root .ri-sheet-box .ri-field')][0]; const el = f.querySelector('input'); el.value = 'a march'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        await click('Write the items');
        await page.waitForFunction(() => /Add the ticked items/.test(document.querySelector('#ri_root').textContent), null, { timeout: 10000 });
        const rev = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-sheet-box .ri-version')].map(v => ({ t: v.querySelector('.ri-vbody').textContent, on: v.querySelector('input').checked, flag: /needs a particular place/.test(v.textContent) })));
        assert(rev.length === 2 && rev[0].on && !rev[0].flag && !rev[1].on && rev[1].flag, 'mark: an item the AI says needs a particular setting is marked and starts unticked');
        await page.screenshot({ path: '/tmp/s58_review.png' });

        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
