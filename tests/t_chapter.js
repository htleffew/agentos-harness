// 5.4: the story so far in chapters, "New chapter" into a new chat, and a starter world from the character card.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const click = (page, text, root = '#ri_root') => page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text) || [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]);
const PROSE = (n) => `Hale stood by the stall PROSEMARK${n}. "You look wonderful tonight," he said.`;
const reply = (n, scene, lines = []) => `${PROSE(n)}\n\n<scene_cast>\nLocation: Fruit market HUDMARK\nActive Speakers: Hale\n</scene_cast>\n\n<story_update>\n${[...lines, `scene: ${scene}`].join('\n')}\n</story_update>`;
const idle = async (page) => { await page.evaluate(async (B) => { const F = await import(`${B}/src/worldflow.js`); const C = await import(`${B}/src/chapters.js`); await F.worldIdle(); for (let i = 0; i < 100 && C.chapterBusy(); i++) await new Promise(r => setTimeout(r, 100)); await F.worldIdle(); }, L.BASE); await page.waitForTimeout(350); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => /"role":"user"|role/.test(JSON.stringify(r.messages)) && r.messages.length > 2); return { n: all.length, all, text: L.text(chat[chat.length - 1] || all[all.length - 1]) }; };
const world = (page) => page.evaluate(async (B) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); if (!id) return []; const d = await W.loadWorld(id); return W.listWorld(d, id).map(w => ({ kind: w.kind, name: w.name, on: w.on, auto: w.auto, span: w.span, rollup: w.rollup, f: w.fields })); }, L.BASE);
const chapters = async (page) => (await world(page)).filter(w => w.kind === 'chapter');
const newWorld = async (page, name, S) => { await L.openChat(page); return page.evaluate(async ([B, name, S]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, S); W.setChatWorld(id); return id; }, [L.BASE, name, S]); };
const CH = (title, extra = {}) => JSON.stringify({ title, when: 'Day 3, morning', summary: `Hale asked you to sail and you said you would think about it. SUMMARK ${title}`, people: ['Hale', 'Mira'], places: ['Fruit market'], settled: 'Hale agreed to wait until noon', ...extra });
const logs = (page) => page.evaluate(async (B) => (await import(`${B}/src/log.js`)).logEntries().reverse().map(e => ({ what: e.what, ok: e.ok, result: e.result })), L.BASE);

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, onSceneEnd: true, minReplies: 2, every: 0, keep: 2, roll: 8, budget: 800 }, world: { budget: 800, place: 'depth', depth: 4, lookback: 4, update: 'all', build: 0, head: 0 } });
        await page.evaluate(async (B) => { (await import(`${B}/src/log.js`)).clearLog(); }, L.BASE);
        const t = Date.now();
        const S = 'Chapter book ' + t;

        // ----- A. a chapter is written when a scene ends
        await newWorld(page, 'Chapter story', S);
        L.mode({ reply: reply(1, 'continues', ['person: Hale | captain of the Gull | Proud', 'thread: The missing crate | A crate went missing from the Gull', 'secret: The letter | Hale | Hale wrote the letter himself', 'planted: The amulet | Hale wears a cracked amulet']), goal: CH('At the market') });
        const r1 = await send(page, 'I arrive USERMARK1.');
        L.mode({ reply: reply(2, 'continues', ['settled: The missing crate | Mira found it behind the stall', 'out: The letter | Mira']), goal: CH('At the market') });
        const r2 = await send(page, 'I say hello USERMARK2.');
        assert(r1.n === 1 && r2.n === 1 && (await chapters(page)).length === 0, 'chapter: while the scene continues, no chapter is written and no extra request is made');
        L.mode({ reply: reply(3, 'ended'), goal: CH('At the market') });
        const r3 = await send(page, 'I leave for the harbour USERMARK3.');
        let ch = await chapters(page);
        const creq = r3.all.find(r => /Write the summary of one part of a roleplay story/.test(L.text(r)));
        console.log('chapter:', JSON.stringify(ch.map(c => ({ name: c.name, span: c.span, auto: c.auto }))), 'requests:', r3.n);
        assert(r3.n === 2 && creq && ch.length === 1 && ch[0].name === 'At the market' && ch[0].span.from === 1 && ch[0].span.to === 3 && ch[0].auto, 'chapter: when the block says the scene ended, one AI request writes a chapter for the replies since the last one');
        const ct = L.text(creq);
        assert(['PROSEMARK1', 'PROSEMARK2', 'PROSEMARK3', 'USERMARK1', 'USERMARK3'].every(x => ct.includes(x)) && !/HUDMARK|story_update|scene: ended/.test(ct), 'chapter: the request holds the messages of that stretch, without HUD or update blocks');
        assert(ch[0].f.people === 'Hale, Mira' && ch[0].f.places === 'Fruit market' && ch[0].f.when === 'Day 3, morning' && /SUMMARK/.test(ch[0].f.summary), 'chapter: the answer is filed as an entry with what happened, when, who and where');
        const w3 = await world(page);
        const off = (n) => w3.find(w => w.name === n)?.on === false;
        console.log('finished:', JSON.stringify(ch[0].f.closed));
        assert(ch[0].f.closed === 'The thread "The missing crate" was settled: Mira found it behind the stall. A secret came out about Hale: Hale wrote the letter himself.' && off('The missing crate') && off('The letter') && w3.find(w => w.name === 'The amulet').on && w3.find(w => w.name === 'Hale').on, 'finished: a settled thread and a secret that came out are written into the chapter and turned off, and what is still open stays on');
        const lg = await logs(page);
        assert(lg.some(e => e.what === 'Write a chapter of the story so far' && e.ok === true && /covers replies 1 to 3 \(the scene ended\)/.test(e.result)), 'chapter: the Log says which replies the chapter covers and why it was written');

        // the chapter is sent with the notes; a scene that ends too soon waits
        L.mode({ reply: reply(4, 'ended'), goal: CH('Too soon') });
        const r4 = await send(page, 'I walk to the harbour.');
        assert(/The story so far:\n- At the market \(Day 3, morning\): Hale asked you to sail and you said you would think about it\. SUMMARK At the market\. Settled: Hale agreed to wait until noon\./.test(r4.text), 'sent: the newest chapter goes out in full at the top of the story notes');
        assert(/Finished in it: The thread "The missing crate" was settled/.test(r4.text) && !/Open threads:\n- The missing crate/.test(r4.text), 'sent: what was finished is sent as part of the chapter and no longer as an open thread');
        assert(r4.n === 1 && (await chapters(page)).length === 1, 'chapter: a scene that ends before the set number of replies is joined to the next chapter');

        // ----- B. a chapter after a set number of replies; deleting the last reply it covers removes it
        await L.setSettings(page, { summary: { onSceneEnd: false, every: 2 } });
        L.mode({ reply: reply(5, 'continues', ['paid: The amulet | It opened the lock']), goal: CH('On the quay') });
        await send(page, 'I look at the ships.');
        ch = await chapters(page);
        assert(ch.length === 2 && ch[1].name === 'On the quay' && ch[1].span.from === 4 && ch[1].span.to === 5, 'chapter: with "after this many replies" set to 2, replies 4 and 5 become the next chapter');
        assert(/The planted detail "The amulet" paid off/.test(ch[1].f.closed) && (await world(page)).find(w => w.name === 'The amulet').on === false, 'finished: a planted detail that paid off is written into the chapter and turned off');
        await L.slash(page, '/del 2'); await page.waitForTimeout(900); await idle(page);
        ch = await chapters(page);
        assert(ch.length === 1 && ch[0].name === 'At the market', 'chapter: deleting the last reply a chapter covers removes that chapter, and earlier chapters stay');
        const am = (await world(page)).find(w => w.name === 'The amulet');
        assert(am.on === true && off('The missing crate'), 'finished: deleting that reply turns back on what its chapter had taken in, and what an earlier chapter took in stays off');

        // ----- C. by hand, from the panel
        await L.setSettings(page, { summary: { every: 0 } });
        await click(page, 'Expand');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'world'; P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^The story so far \(1\)/.test(x.textContent)), null, { timeout: 8000 });
        L.mode({ goal: CH('The walk') }); L.resetLog();
        await click(page, 'Write a chapter now');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^The story so far \(2\)/.test(x.textContent)), null, { timeout: 15000 });
        ch = await chapters(page);
        const ui = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#ri_root .ri-chip')].map(c => c.textContent), fields: [...document.querySelectorAll('#ri_root .ri-field .ri-label')].map(x => x.textContent.trim()) }));
        assert(ch[1].name === 'The walk' && ch[1].span.from === 4 && ch[1].span.to === 4 && ui.chips.includes('Replies 4 to 4') && ui.fields.includes('Keep the story so far in chapters'), 'panel: "Write a chapter now" summarises everything since the last chapter, and the tab lists the chapters with the replies they cover');
        await click(page, 'Write a chapter now');
        await page.waitForFunction(() => /already in a chapter/.test(document.querySelector('#ri_root')?.textContent || ''), null, { timeout: 8000 });
        assert(true, 'panel: when every reply is already in a chapter, it says so and makes no request');
        await page.screenshot({ path: '/tmp/s54_world.png' });

        // SillyTavern's own summary
        const warn = await page.evaluate(async (B) => { const c = globalThis.SillyTavern.getContext(); const C = await import(`${B}/src/chapters.js`); const before = C.otherSummaryOn(); c.extensionPrompts['1_memory'] = { value: 'A summary from SillyTavern.', position: 0, depth: 0 }; const P = await import(`${B}/src/ui/panel.js`); P.app.render(); await new Promise(r => setTimeout(r, 200)); const shown = /SillyTavern's own Summarize is also adding a summary/.test(document.querySelector('#ri_root').textContent); delete c.extensionPrompts['1_memory']; return { before, shown }; }, L.BASE);
        assert(!warn.before && warn.shown, 'warning: when SillyTavern\'s own summary is also in the prompt, the tab says so');

        // ----- D. older chapters are combined when they pile up
        await L.setSettings(page, { summary: { every: 1, roll: 2, keep: 1 } });
        L.mode({ reply: reply(6, 'continues'), goal: JSON.stringify({ title: 'Chapter A', when: '', summary: 'COMBINED everything before. Also chapter text A.', people: ['Hale'], places: ['Harbour'], settled: '' }) });
        const ra = await send(page, 'a');
        ch = await chapters(page);
        console.log('after roll-up:', JSON.stringify(ch.map(c => `${c.name}${c.rollup ? ' (rollup)' : ''}:${c.span.from}-${c.span.to}`)));
        const roll = ch.find(c => c.rollup);
        assert(ra.all.some(r => /Combine these summaries of the earlier parts/.test(L.text(r))) && roll && roll.name === 'Before the latest chapters' && roll.span.to === 4 && ch.filter(c => !c.rollup).length === 1 && ch.find(c => !c.rollup).name === 'Chapter A', 'combine: with more chapters than the setting allows, one request combines the older ones and the newest stays');
        L.mode({ reply: reply(7, 'continues'), goal: CH('Chapter B') });
        await L.setSettings(page, { summary: { every: 0 } });
        const rb = await send(page, 'b');
        assert(/The story so far:\n- Before the latest chapters: COMBINED everything before\. Also chapter text A\.\n- Chapter A: COMBINED/.test(rb.text), 'combine: the combined account is sent first, then the newest chapter');

        // an older chapter is sent only when its people or places come up
        await page.evaluate(async (B) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const d = await W.loadWorld(id); const w = W.newWorldEntry(d, 'chapter'); Object.assign(w, { name: 'The mountain road', span: { chat: 'another chat', from: 1, to: 9 } }); Object.assign(w.fields, { summary: 'Greta led the way over the pass OLDMARK.', people: 'Greta', places: 'The pass' }); W.writeWorldEntry(d, w, id); await W.saveWorld(id, d); }, L.BASE);
        L.mode({ reply: reply(8, 'continues') });
        const no = await send(page, 'I look at the water.');
        const yes = await send(page, 'I think about Greta.');
        assert(!/OLDMARK/.test(no.text) && /- The mountain road: Greta led the way over the pass OLDMARK\./.test(yes.text), 'older: a chapter from before is sent only when someone or somewhere in it comes up');

        // ----- E. New chapter: a new chat that carries the story over
        const before = await page.evaluate(async ([B, S]) => {
            const K = await import(`${B}/src/books.js`); const St = await import(`${B}/src/store.js`); const G = await import(`${B}/src/goals.js`);
            const d = { entries: {} };
            [['X1', true], ['Y1', false]].forEach(([v, once], i) => { const x = K.newInstruction(d); Object.assign(x, { name: 'I' + i, chance: 100, wait: 0, once, sentAs: 'system', versions: [{ text: `{{char}} must do thing ${v} to {{user}}.`, keep: false }] }); K.writeInstruction(d, x); });
            const a = await K.createSet('Carry orders', 'instructions', d, S);
            const cs = St.chatState(); cs.activeSets = [a]; St.saveChatState();
            St.setPronouns('char', 'she');
            const g = G.goals(); Object.assign(g, G.blankGoal(), { on: true, goal: '{{char}} wants {{user}} to trust {{char.them}}', chance: 0, steps: [{ id: 's1', text: 'tell {{user}} a secret', on: true, doneManual: true }, { id: 's2', text: 'ask {{user}} for help', on: true }], actions: [] }); G.saveGoals();
            return { chat: globalThis.SillyTavern.getContext().getCurrentChatId(), set: a, world: (await import(`${B}/src/world.js`)).chatWorld() };
        }, [L.BASE, S]);
        L.mode({ reply: reply(9, 'continues') });
        const once1 = await send(page, 'c');       // X1 (only once) and Y1 go out; with checking off X1 has now happened for good
        assert(/thing X1/.test(once1.text) && /thing Y1/.test(once1.text), 'carry: before the new chapter, the "only once" instruction is sent once');
        const oldLen = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length);
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'world'; P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        await click(page, 'Start a new chapter in a new chat');
        await page.waitForTimeout(300);
        await page.evaluate(() => { const f = [...document.querySelectorAll('#ri_root .ri-field')].find(x => /What you want for the new chapter/.test(x.textContent)); const el = f.querySelector('input'); el.value = 'the next morning on the ship WISHMARK'; el.dispatchEvent(new Event('input', { bubbles: true })); });
        L.mode({ reply: 'SUMMARY:\nHale asked you to sail. You agreed at noon. LONGSUMMARK\n\nFIRST MESSAGE:\nThe gulls woke first. FIRSTMARK "Good morning," Hale said from the wheel.' });
        L.resetLog();
        await click(page, 'Write the summary and the first message');
        await page.waitForFunction(() => document.querySelectorAll('#ri_root .ri-sheet-box textarea').length === 2, null, { timeout: 15000 });
        const dreq = L.text(L.requests().slice(-1)[0]);
        const draft = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-sheet-box textarea')].map(x => x.value));
        assert(/A roleplay story is moving into a new chat/.test(dreq) && /WISHMARK/.test(dreq) && /Chapters written so far/.test(dreq) && /Before the latest chapters: COMBINED/.test(dreq) && /PROSEMARK9/.test(dreq) && !/PROSEMARK1\b/.test(dreq), 'new chapter: one request gets the chapters, the story notes, your wish and the story since the last chapter');
        assert(/LONGSUMMARK$/.test(draft[0]) && /^The gulls woke first\. FIRSTMARK/.test(draft[1]), 'new chapter: the summary and the first message are shown for you to change');
        await page.evaluate(() => { const ta = document.querySelectorAll('#ri_root .ri-sheet-box textarea')[1]; ta.value += ' EDITMARK'; ta.dispatchEvent(new Event('input', { bubbles: true })); });
        await click(page, 'Start the new chat');
        await page.waitForFunction((old) => { const c = globalThis.SillyTavern.getContext(); return c.getCurrentChatId() && c.getCurrentChatId() !== old && c.chat.length === 1 && /EDITMARK/.test(c.chat[0].mes); }, before.chat, { timeout: 20000 });
        await page.waitForTimeout(1200); await idle(page);
        const after = await page.evaluate(async (B) => {
            const c = globalThis.SillyTavern.getContext(); const St = await import(`${B}/src/store.js`); const W = await import(`${B}/src/world.js`); const G = await import(`${B}/src/goals.js`);
            const cs = St.chatState(); const g = G.goals();
            return { chat: c.getCurrentChatId(), first: c.chat[0].mes, shown: document.querySelector('#chat .mes .mes_text')?.textContent || '', sets: cs.activeSets, world: W.chatWorld(), she: St.pronounForms('char')[0], goal: g.goal, steps: g.steps.map(s => `${s.id}:${!!s.doneManual}`), burned: cs.burned?.keys?.length || 0, of: cs.chapterOf };
        }, L.BASE);
        console.log('new chat:', JSON.stringify(after));
        assert(after.chat !== before.chat && /^The gulls woke first\. FIRSTMARK .* EDITMARK$/.test(after.first) && /FIRSTMARK/.test(after.shown), 'new chapter: a new chat opens with your edited first message in place of the greeting');
        assert(after.sets.join() === before.set && after.world && after.world !== before.world && after.she === 'she' && /wants/.test(after.goal) && after.steps.join() === 's1:true,s2:false' && after.burned >= 1 && after.of === before.chat, 'new chapter: the active sets, an independent Story World, the pronouns, the goal with its finished step and what has happened for good are carried over');
        ch = await chapters(page);
        const carried = ch.find(c => c.rollup && c.on);
        assert(carried && carried.name === 'The story before this chat' && /LONGSUMMARK/.test(carried.f.summary) && !carried.auto, 'new chapter: the summary is kept in the world as "The story before this chat"');
        L.mode({ reply: reply(1, 'continues') });
        const n1 = await send(page, 'Good morning.');
        assert(/The story so far:\n- The story before this chat: Hale asked you to sail\. You agreed at noon\. LONGSUMMARK\./.test(n1.text) && !/thing X1/.test(n1.text) && /thing Y1/.test(n1.text), 'new chapter: the summary is sent with the first reply, and an instruction that had happened for good is still retired');
        const oldStill = await page.evaluate(async ([old, len]) => { const c = globalThis.SillyTavern.getContext(); const list = await c.getPastCharacterChats?.() || []; return list.some(x => String(x.file_name || '').replace(/\.jsonl$/, '') === old) ? 'listed' : (list.length ? 'missing' : 'unknown'); }, [before.chat, oldLen]);
        assert(oldStill !== 'missing', 'new chapter: the chat you were in is still there: ' + oldStill);

        // going back: the old chat is as it was, and the combined account is titled for the chat it is read in
        const back = await page.evaluate(async ([old, B]) => { const c = globalThis.SillyTavern.getContext(); if (!c.openCharacterChat) return null; await c.openCharacterChat(old); await new Promise(r => setTimeout(r, 1200)); const St = await import(`${B}/src/store.js`); return { id: c.getCurrentChatId(), len: c.chat.length, first: c.chat[0].mes, sets: St.chatState().activeSets.length }; }, [before.chat, L.BASE]);
        console.log('back in the old chat:', JSON.stringify(back).slice(0, 300));
        assert(back && back.id === before.chat && back.len === oldLen && !/FIRSTMARK/.test(back.first), 'new chapter: going back, the old chat has every message it had and its own first message');
        L.mode({ reply: reply(10, 'continues') });
        const ob = await send(page, 'Back in the old chat.');
        assert(!/LONGSUMMARK/.test(ob.text) && /COMBINED/.test(ob.text), 'new chapter: the source book retains its original combined summary');

        // starting without a world creates a physical Story World for the continuation
        await L.openChat(page);
        L.mode({ reply: PROSE(1) });
        await send(page, 'No world here.');
        const made = await page.evaluate(async (B) => { const C = await import(`${B}/src/chapters.js`); const E = await import(`${B}/src/engine.js`); await C.startNewChapter({ summary: 'A short story with no world NOWORLDMARK.', first: 'It was morning again.' }, E.burnedSoFar); await new Promise(r => setTimeout(r, 1200)); const c = globalThis.SillyTavern.getContext(); return { first:c.chat[0].mes, world:(await import(`${B}/src/world.js`)).chatWorld() }; }, L.BASE);
        const nw = await send(page, 'Hello again.');
        assert(made.first === 'It was morning again.' && made.world && /NOWORLDMARK/.test(nw.text), 'new chapter: creates a native Story World for a formerly worldless chat and recalls the summary');

        // ----- F. a starter world from the character card
        await newWorld(page, 'Starter story', S);
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'world'; P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        await click(page, 'Fill this world from the character card');
        await page.waitForTimeout(300);
        L.mode({ reply: '<story_update>\nperson: Seraphina | guardian of the forest | Gentle and watchful\nwants: Seraphina | To keep the traveller safe\nplace: The glade | A clearing with a healing spring\nthread: The beasts | Something drove the beasts toward the road\nsecret: The spring | Seraphina | The spring is drying up\nplanted: The amulet | Seraphina wears a cracked amulet\nperson: Nobody | should be unticked | x\n</story_update>' });
        L.resetLog();
        await click(page, 'Read the card and propose entries');
        await page.waitForFunction(() => document.querySelectorAll('#ri_root .ri-sheet-box .ri-version').length === 7, null, { timeout: 15000 });
        const sreq = L.text(L.requests().slice(-1)[0]);
        assert(/Set up the story notes for a roleplay/.test(sreq) && /Character description:/.test(sreq) && /The opening message of this chat:/.test(sreq) && /Include Seraphina\. Leave out User\./.test(sreq), 'starter: one request reads the character card and the opening message of the chat');
        await page.evaluate(() => { const rows = [...document.querySelectorAll('#ri_root .ri-sheet-box .ri-version')]; const row = rows.find(r => /Nobody/.test(r.textContent)); const cb = row.querySelector('input'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
        assert((await world(page)).length === 0, 'starter: nothing is added until you say so');
        await click(page, 'Add the ticked lines to the world');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^Characters \(1\)/.test(x.textContent)), null, { timeout: 10000 });
        const sw = await world(page);
        console.log('starter world:', JSON.stringify(sw.map(w => `${w.kind}:${w.name}`)));
        const ser = sw.find(w => w.name === 'Seraphina');
        assert(sw.length === 5 && ser && ser.auto && ser.f.role === 'guardian of the forest' && ser.f.wants === 'To keep the traveller safe' && sw.some(w => w.kind === 'secret' && w.f.holder === 'Seraphina') && !sw.some(w => w.name === 'Nobody'), 'starter: the ticked lines become entries, marked as automatic, and an unticked line is left out');
        await page.screenshot({ path: '/tmp/s54_starter.png' });
        await L.setSettings(page, { check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' }, summary: { on: true, onSceneEnd: true, minReplies: 4, every: 20, keep: 2, roll: 8, budget: 800 }, world: { update: 'all', build: 10, head: 20 } });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
