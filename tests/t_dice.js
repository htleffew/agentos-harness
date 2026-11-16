// 5.7: dice rolled in code with stats, where an event comes from, hiding what a chapter covers, and counting the
// messages in the finished prompt.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const idle = async (page) => { await page.evaluate(async (B) => { const F = await import(`${B}/src/worldflow.js`); const C = await import(`${B}/src/chapters.js`); await F.worldIdle(); for (let i = 0; i < 100 && C.chapterBusy(); i++) await new Promise(r => setTimeout(r, 100)); await F.worldIdle(); }, L.BASE); await page.waitForTimeout(300); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, all, text: L.text(chat[chat.length - 1] || all[0]) }; };
const lastDice = (page) => page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; const r = c[c.length - 1].extra?.roleplay_instructions; const it = (r?.items || []).find(i => i.dice); return it ? { dice: it.dice, text: it.text, asked: r.asked } : null; });

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });
        const t = Date.now();

        // ----- A. dice: the arithmetic and the outcome are done in code
        const unit = await page.evaluate(async (B) => {
            const D = await import(`${B}/src/dice.js`);
            const tiers = [[1, 0], [1, 20], [20, -20], [5, 2], [5, 3], [9, 2], [10, 2], [15, 1], [15, 2], [20, 1], [20, 2]].map(([n, m]) => D.outcome(n, n + m));
            return { tiers };
        }, L.BASE);
        assert(unit.tiers.join('|') === 'fails badly|succeeds well|fails badly|fails|partly succeeds|partly succeeds|succeeds|succeeds|succeeds well|succeeds well|succeeds brilliantly', 'dice: the total alone decides, so a natural 1 with +20 succeeds well and a natural 20 with -20 fails badly');

        await L.openChat(page);
        await L.setSettings(page, { dice: { on: true, user: true, char: true, others: true, stats: ['Strength', 'Wits'] } });
        await page.evaluate(async (B) => { const D = await import(`${B}/src/dice.js`); D.setStat('user', 'Wits', 3); D.setStat('char', 'Strength', 9); D.setStat('user', 'Agility', 40); D.setStat('char', 'Wits', -1); }, L.BASE);
        const r1 = await send(page, 'I try to climb the wall.');
        const d1 = await lastDice(page);
        console.log('dice:', JSON.stringify(d1.dice));
        const D_AG = await page.evaluate(async (B) => (await import(`${B}/src/dice.js`)).sheet('user').Agility, L.BASE);
        const u = d1.dice.find(x => x.who === 'user'); const c = d1.dice.find(x => x.who === 'char'); const o = d1.dice.find(x => x.who === 'others');
        const sums = u.stats.every(s => s.total === u.natural + s.mod) && c.stats.every(s => s.total === c.natural + s.mod);
        assert(u && c && o && u.natural >= 1 && u.natural <= 20 && sums && u.stats.find(s => s.name === 'Wits').mod === 3 && D_AG === 20 && c.stats.find(s => s.name === 'Strength').mod === 9 && o.stats.length === 0, 'dice: one d20 each for {{user}}, {{char}} and the others; each stat modifier is added in code, and a modifier is kept between -20 and +20');
        assert(/Dice for this reply, already rolled\. Use a result only when/.test(r1.text) && /Roll nothing yourself and change no number\./.test(r1.text) && new RegExp(`the d20 rolled ${u.natural}`).test(r1.text) && r1.n === 1, 'dice: the results are sent with the reply, with the rule to use them only for real stakes, and no extra AI request is made');
        // a swipe keeps the roll
        L.resetLog(); await L.swipe(page); await L.waitChecks(page); await idle(page);
        const sw = L.text(L.requests().filter(r => r.messages.length > 2).slice(-1)[0] || {});
        assert(sw.includes(`rolled`) && (sw.match(/the d20 rolled (\d+)/) || [])[1] === String(u.natural), 'dice: a swipe sends the same roll again');
        // out of character: no dice
        const ooc = await send(page, 'OOC: how are you?');
        assert(!/Dice for this reply/.test(ooc.text), 'dice: an out-of-character message gets no dice');
        // the question rides along with a check
        await L.makeSet(page, 'Dice ins ' + t, [{ name: 'I', versions: ['A1'] }]);
        await L.setSettings(page, { check: { mode: 'full', maxResend: 0, holdNew: false, regenOnMiss: false, agency: 'off' } });
        const ck = await send(page, 'I pick the lock.');
        const creq = ck.all.map(r => L.text(r)).find(x => /ID q1:/.test(x)) || '';
        assert(/ID q1: The answer to this question about the reply is yes: The reply settled an attempt with one of the dice results/.test(creq) && ck.n === 2, 'dice: whether the reply used a result is asked with the check that runs anyway');
        await L.setSettings(page, { check: { mode: 'off' }, dice: { others: false, char: false } });
        const only = await send(page, 'again');
        const d2 = await lastDice(page);
        assert(d2.dice.length === 1 && d2.dice[0].who === 'user' && !/Any other character/.test(only.text), 'dice: each side can be switched off');
        await L.setSettings(page, { dice: { on: false } });
        assert(!/Dice for this reply/.test((await send(page, 'off')).text), 'dice: off sends no dice');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'settings'; P.app.render(); }, L.BASE);
        await L.setSettings(page, { dice: { on: true, user: true, char: true, others: true } });
        await page.evaluate(async (B) => { (await import(`${B}/src/ui/panel.js`)).app.render(); }, L.BASE);
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Expand'); if (b) b.click(); });
        await page.waitForTimeout(500);
        const st = await page.evaluate(() => ({ titles: [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent.trim()), labels: [...document.querySelectorAll('#ri_root .ri-label')].map(x => x.textContent.trim()) }));
        assert(st.titles.includes('Dice') && st.labels.some(l => /^Stats for .* \(kept with this character card\)$/.test(l)) && st.labels.some(l => /\(kept with this persona\)$/.test(l)), 'panel: Settings has a Dice section with stat boxes for the character and the persona');
        await page.screenshot({ path: '/tmp/s57_dice.png' });
        await L.setSettings(page, { dice: { on: false } });

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
        assert(ev.bad === 0 && ev.pairs.includes('world:world') && ev.pairs.includes('char:char') && ev.pairs.includes('other:other') && ev.pairs.some(p => p.endsWith(':any')), 'origins: the driver is picked first and only situations from the same place are picked with it; an unmarked situation fits every driver');
        assert(ev.drivers.join() === 'world' && ev.order.join() === 'Situation,Who drives it', 'origins: a driver is only offered when there is a situation that fits it, and the parts are still sent in the order of the lists');
        assert(ev.inferred.join() === 'char,world,other' && ev.defaults.join() === 'char,other,other,other,world', 'origins: a new set marks its drivers, and an older set\'s drivers are read from their words');
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

        // ----- C. hide what a chapter covers
        await L.openChat(page);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, ''); W.setChatWorld(id); }, [L.BASE, 'Dice world ' + t]);
        await L.setSettings(page, { summary: { on: true, onSceneEnd: false, every: 0, hide: true, keepShown: 6 }, world: { update: 'off' } });
        L.mode({ reply: PROSE });
        for (let i = 0; i < 6; i++) await send(page, 'm' + i);
        L.mode({ goal: JSON.stringify({ title: 'Morning', when: 'Day 1', summary: 'Things happened HIDEMARK', people: [], places: [], settled: '' }) });
        const res = await page.evaluate(async (B) => { const C = await import(`${B}/src/chapters.js`); await C.writeChapterNow(); const S = await import(`${B}/src/st.js`); const c = globalThis.SillyTavern.getContext().chat; return { reach: S.chatReach(), hidden: c.map((m, i) => m.is_system ? i : -1).filter(i => i >= 0), len: c.length, shown: [...document.querySelectorAll('#chat .mes[is_system="true"]')].length }; }, L.BASE);
        console.log('hide:', JSON.stringify(res));
        assert(res.len === 13 && res.hidden.join() === '1,2,3,4,5,6' && res.shown === 6, 'hide: after a chapter, the messages it covers are hidden from the AI except the newest 6, and the opening message is never hidden');
        L.mode({ reply: PROSE });
        const after = await send(page, 'next');
        assert(!/\bm0\b|\bm1\b|\bm2\b/.test(after.text) && /\bm4\b/.test(after.text) && /HIDEMARK/.test(after.text), 'hide: hidden messages are left out of what is sent, and the chapter that covers them is sent in their place');
        const reach = await page.evaluate(async (B) => (await import(`${B}/src/st.js`)).chatReach(), L.BASE);
        console.log('reach after:', JSON.stringify(reach));
        assert(reach.hidden === 6 && reach.last === reach.open - 1 && reach.cut === 0, 'count: the messages in the finished prompt are counted, and with nothing left out by another extension no cut is reported');
        await page.evaluate(async (B) => { const S = await import(`${B}/src/st.js`); S.notePromptSent([{ role: 'system', content: 'x' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]); }, L.BASE);
        const cut = await page.evaluate(async (B) => (await import(`${B}/src/st.js`)).chatReach(), L.BASE);
        assert(cut.last === 2 && cut.cut === cut.open - 3, 'count: when another extension leaves messages out of the prompt (as Message Limit does), the number left out is shown');
        // deleting the reply the chapter belongs to shows them again
        await L.slash(page, '/del 4'); await page.waitForTimeout(900); await idle(page);
        const back = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.filter(m => m.is_system).length);
        assert(back === 0, 'hide: deleting the reply the chapter belongs to shows the hidden messages again');
        await L.setSettings(page, { summary: { on: false, hide: true, keepShown: 30, onSceneEnd: true, every: 20 }, world: { update: 'all' } });

        // ----- C2. a branch keeps the chapters from before the point where it branched
        await L.setSettings(page, { summary: { on: true, onSceneEnd: false, every: 0, hide: false }, world: { update: 'off' } });
        L.mode({ reply: PROSE });
        for (let i = 0; i < 3; i++) await send(page, 'b' + i);
        L.mode({ goal: JSON.stringify({ title: 'Before the fork', when: '', summary: 'FORKMARK things happened', people: [], places: [], settled: '' }) });
        await page.evaluate(async (B) => { const C = await import(`${B}/src/chapters.js`); await C.writeChapterNow(); }, L.BASE);
        const lastId = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length - 1);
        const origChat = await page.evaluate(() => globalThis.SillyTavern.getContext().getCurrentChatId());
        await L.slash(page, `/branch-create ${lastId}`); await page.waitForTimeout(2500);
        const inBranch = await page.evaluate(async (B) => { const c = globalThis.SillyTavern.getContext(); const C = await import(`${B}/src/chapters.js`); const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const d = await W.loadWorld(id); return { chat: c.getCurrentChatId(), covered: C.coveredUpTo(W.listWorld(d, id)) }; }, L.BASE);
        L.mode({ reply: PROSE });
        const br = await send(page, 'in the branch');
        console.log('branch:', JSON.stringify(inBranch), origChat);
        assert(inBranch.chat !== origChat && inBranch.covered >= 1 && /The story so far:\n- Before the fork: FORKMARK things happened\./.test(br.text), 'branch: a branch keeps the chapters written before the point where it branched, sends the newest in full, and does not write them again');
        await L.setSettings(page, { summary: { on: false, hide: true }, world: { update: 'all' } });

        // ----- D. the new chapter button is in What Was Sent
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'sent'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Start a new chapter in a new chat').click());
        await page.waitForTimeout(600);
        const sheet = await page.evaluate(async (B) => ({ tab: (await import(`${B}/src/ui/panel.js`)).app.tab, text: document.querySelector('#ri_root').textContent }), L.BASE);
        assert(sheet.tab === 'world' && /What you want for the new chapter/.test(sheet.text), 'panel: "Start a new chapter in a new chat" at the top of What Was Sent opens the new chapter sheet');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);

        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
