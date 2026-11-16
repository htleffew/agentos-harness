// 5.3: the world keeps itself up to date. The update block is asked for, lifted out of the reply and filed with no
// extra request; duplicates, your own entries, locked entries and out-of-character turns; undo on swipe, delete and
// by hand; threads that build; things ordered into the scene and what happens when they are carried out.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said, and he meant it.';
const reply = (lines, hud = 'Hale') => `${PROSE}\n\n<scene_cast>\nLocation: Fruit market\nActive Speakers: ${hud}\n</scene_cast>\n\n<story_update>\n${lines.join('\n')}\n</story_update>`;
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE); await page.waitForTimeout(250); const all = L.requests(); const chat = all.filter(r => !/"done"/.test(L.text(r)) || !/quote/.test(L.text(r))); const rq = chat[chat.length - 1]; return { n: all.length, chatN: chat.length, text: L.text(rq), messages: rq.messages }; };
const world = (page) => page.evaluate(async (B) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const d = await W.loadWorld(id); return W.listWorld(d, id).map(w => ({ kind: w.kind, name: w.name, status: w.status, auto: w.auto, locked: w.locked, at: w.at, f: w.fields })); }, L.BASE);
const find = (list, kind, name) => list.find(w => w.kind === kind && w.name === name);
const last = (page) => page.evaluate(() => { const ch = globalThis.SillyTavern.getContext().chat; const m = ch[ch.length - 1]; const r = m.extra?.roleplay_instructions; return { mes: m.mes, swipe: Array.isArray(m.swipes) ? m.swipes[m.swipe_id] : null, update: r?.update || null, items: (r?.items || []).map(i => ({ name: i.name, status: i.status, text: i.text, worldOrder: i.worldOrder || null, notes: !!i.notes, misses: i.misses })) }; });
const addEntries = (page, items) => page.evaluate(async ([B, items]) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const data = await W.loadWorld(id); for (const x of items) { const w = W.newWorldEntry(data, x.kind); Object.assign(w, { name: x.name, aliases: x.aliases || [], status: x.status || w.status, locked: !!x.locked }); Object.assign(w.fields, x.fields || {}); W.writeWorldEntry(data, w, id); } await W.saveWorld(id, data); }, [L.BASE, items]);
const patchEntry = (page, name, patch) => page.evaluate(async ([B, name, patch]) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const data = await W.loadWorld(id); const w = W.listWorld(data, id).find(x => x.name === name); Object.assign(w, patch.top || {}); Object.assign(w.fields, patch.fields || {}); W.writeWorldEntry(data, w, id); await W.saveWorld(id, data); }, [L.BASE, name, patch]);
const newWorld = async (page, name, S) => { await L.openChat(page); return page.evaluate(async ([B, name, S]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, S); W.setChatWorld(id); return id; }, [L.BASE, name, S]); };
const ws = (page, patch) => L.setSettings(page, { world: patch });
const logs = (page) => page.evaluate(async (B) => (await import(`${B}/src/log.js`)).logEntries().reverse().filter(e => e.what === 'Story world update').map(e => ({ result: e.result, details: e.details, got: e.got })), L.BASE);
const idle = (page) => page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE);

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await ws(page, { budget: 800, place: 'depth', depth: 4, lookback: 4, update: 'all', build: 0, head: 0, minAge: 6, bring: { thread: true, seed: true, activity: true, secret: false } });
        await page.evaluate(async (B) => { (await import(`${B}/src/log.js`)).clearLog(); }, L.BASE);
        const t = Date.now();
        const S = 'Flow book ' + t;

        // ----- A. the request for the block goes out with the reply; no extra AI request
        await newWorld(page, 'Flow story', S);
        const empty = await send(page, 'I arrive at the market.');
        assert(empty.n === 1 && /\[Story update\. After the story text of this reply, add one block/.test(empty.text) && /On file\. People: none yet\./.test(empty.text), 'ask: a world with no entries still asks for the update block, so it can fill itself');
        await addEntries(page, [
            { kind: 'character', name: 'Hale', aliases: ['the captain'], fields: { role: 'captain of the Gull', who: 'Proud and exact.', wants: 'A crew he can trust', knows: 'The tide turns at noon' } },
            { kind: 'thread', name: 'The invitation', fields: { open: 'Hale asked you to sail and has no answer yet' } },
            { kind: 'secret', name: 'The letter', fields: { secret: 'Hale burned the letter XSECRETX', holder: 'Hale' } },
            { kind: 'seed', name: 'The locked drawer', fields: { detail: 'A drawer in the chart room is locked', payoff: 'The key turns up' } },
        ]);

        // ----- B. a reply with a block: lifted out, filed, recorded, logged
        L.mode({ reply: reply([
            'person: Mira | fruit seller | Blunt and warm',
            'person: Hale | captain | A second Hale that must not be made',
            'person: The Captain | captain | Another name of Hale',
            'wants: Hale | To leave before the tide turns',
            '- knows: Hale | Mira saw him burn the letter',
            'knows: Hale | Mira saw him burn the letter.',
            '**believes**: Hale | Mira will keep quiet',
            'place: Fruit market | A market on the east square',
            'thread: The missing key | Nobody knows who took the key',
            'moved: The invitation | Hale asked a second time',
            "secret: Mira's night walk | Mira | Mira went to the lighthouse at night",
            'planted: The torn sail | A sail in the hold is torn',
            'elsewhere: The stranger | A stranger | is asking about the Gull',
            'wants: Name | what they want now',
            'plans: Nobody On File | to do something',
            'scene: continues',
        ]) });
        const b = await send(page, 'I say hello.');
        const mb = await last(page);
        let w = await world(page);
        console.log('changes:', JSON.stringify(mb.update.changes.map(c => `${c.type}:${c.name}${c.field ? '.' + c.field : ''}`)));
        assert(b.n === 1, 'requests: asking for the block and filing it makes no extra AI request');
        assert(/On file\. People: Hale\. Places: none yet\..*Open threads: The invitation\. Kept secrets: The letter\. Planted details: The locked drawer\./.test(b.text) && !/XSECRETX/.test(b.text.slice(b.text.indexOf('[Story update.'))), 'ask: the request lists the names on file, and a kept secret only by its title');
        assert(!/story_update/.test(mb.mes) && mb.mes.includes('You look wonderful tonight') && mb.mes.includes('<scene_cast>') && (mb.swipe === null || !/story_update/.test(mb.swipe)), 'lift: the block is taken out of the reply, and the rest of the reply is left as it was');
        const hale = find(w, 'character', 'Hale'); const mira = find(w, 'character', 'Mira');
        assert(w.filter(x => x.kind === 'character').length === 2 && mira && mira.auto && mira.f.role === 'fruit seller' && mira.f.who === 'Blunt and warm', 'file: a new person is added and marked as automatic; a person on file (by name or other name) is not added again');
        assert(hale.f.wants === 'To leave before the tide turns' && hale.f.who === 'Proud and exact.' && hale.f.role === 'captain of the Gull' && !hale.auto, 'file: in an entry you wrote, what the person wants is brought up to date and who they are stays as written');
        assert(hale.f.knows === 'The tide turns at noon; Mira saw him burn the letter' && hale.f.believes === 'Mira will keep quiet', 'file: something learned is added to what the person knows, once, and line marks such as "-" and "**" are read through');
        const inv = find(w, 'thread', 'The invitation');
        assert(inv.status === 'stirring' && inv.f.latest === 'Hale asked a second time' && find(w, 'thread', 'The missing key')?.status === 'quiet', 'file: a thread that moved goes up one step with what happened; a new thread starts quiet');
        assert(find(w, 'place', 'Fruit market')?.auto && find(w, 'secret', "Mira's night walk")?.f.holder === 'Mira' && find(w, 'seed', 'The torn sail')?.at?.n === 2 && find(w, 'activity', 'The stranger')?.f.what === 'is asking about the Gull', 'file: a place, a secret, a planted detail (with the reply it was made in) and something going on elsewhere are added');
        assert(mb.update.changes.length === 11 && mb.update.ops.length === 14, 'file: a line copied from the form is left out, and a line about someone not on file changes nothing: ' + mb.update.ops.length + ' lines, ' + mb.update.changes.length + ' changes');
        const lg = await logs(page);
        assert(lg.length >= 1 && /update block had 14 lines\. 11 changes were made/.test(lg[lg.length - 1].result) && lg[lg.length - 1].details.includes('Added character: Mira') && lg[lg.length - 1].details.some(d => /^The invitation: went from "Quiet" to "Stirring" \(the story moved it\)/.test(d)) && /story_update/.test(lg[lg.length - 1].got), 'log: the Log tab has what the block said and each change in plain words');

        // the next request: the block is not sent back, the new entries are on file and in the notes
        L.mode({ reply: PROSE });
        const c = await send(page, 'I buy a pear from Mira.');
        const asst = c.messages.filter(m => m.role === 'assistant').map(m => m.content).join('\n');
        assert(!/story_update/.test(asst) && /On file\. People: Hale, Mira\. Places: Fruit market\./.test(c.text) && /Open threads:\n- The invitation \[stirring\]\. What is open: Hale asked you to sail and has no answer yet\. What happened last: Hale asked a second time\./.test(c.text), 'next reply: no old block is sent back, and the filed entries are in the request and in the story notes');
        const lg2 = await logs(page);
        assert(/had no update block/.test(lg2[lg2.length - 1].result), 'log: a reply with no block is noted in the Log');

        // ----- C. "leave my own entries alone", a locked entry, and off
        await ws(page, { update: 'auto' });
        L.mode({ reply: reply(['wants: Hale | To stay ashore', 'wants: Mira | To sell every pear', 'person: Otto | ferryman | Quiet']) });
        await send(page, 'I wait.');
        w = await world(page);
        assert(find(w, 'character', 'Hale').f.wants === 'To leave before the tide turns' && find(w, 'character', 'Mira').f.wants === 'To sell every pear' && find(w, 'character', 'Otto'), 'own entries: with "leave my own entries alone", only entries the extension added are changed, and new ones are still added');
        await ws(page, { update: 'all' });
        await patchEntry(page, 'Mira', { top: { locked: true } });
        L.mode({ reply: reply(['wants: Mira | To close early', 'wants: Hale | To find the key']) });
        await send(page, 'I wait more.');
        w = await world(page);
        assert(find(w, 'character', 'Mira').f.wants === 'To sell every pear' && find(w, 'character', 'Hale').f.wants === 'To find the key', 'locked: an entry set to "keep it as I wrote it" is left alone');
        await ws(page, { update: 'off' });
        L.mode({ reply: reply(['person: Never | nobody | must not be filed']) });
        const off = await send(page, 'I look at the sea.');
        const moff = await last(page);
        w = await world(page);
        assert(!/\[Story update\./.test(off.text) && !/story_update/.test(moff.mes) && !find(w, 'character', 'Never'), 'off: no block is asked for, a block that comes anyway is still taken out, and nothing is filed');
        await ws(page, { update: 'all' });

        // ----- D. an out-of-character turn files nothing
        L.mode({ reply: reply(['person: Oocman | nobody | must not be filed']) });
        const ooc = await send(page, '(OOC: what do you think of the story so far?)');
        w = await world(page);
        assert(!/\[Story update\./.test(ooc.text) && !find(w, 'character', 'Oocman') && !/story_update/.test((await last(page)).mes), 'out of character: no block is asked for and nothing is filed');

        // ----- E. swipe, swipe back, delete, undo by hand
        await newWorld(page, 'Swipe story', S);
        await addEntries(page, [{ kind: 'character', name: 'Hale', fields: { role: 'captain', wants: 'A crew' } }]);
        L.mode({ reply: reply(['person: Greta | a guide | Careful', 'wants: Hale | To reach the pass']) });
        await send(page, 'First.');
        w = await world(page);
        assert(find(w, 'character', 'Greta') && find(w, 'character', 'Hale').f.wants === 'To reach the pass', 'swipe: the first reply is filed');
        L.mode({ reply: reply(['person: Otto | ferryman | Quiet', 'wants: Hale | To cross the river']) });
        L.resetLog(); await L.swipe(page); await L.waitChecks(page); await idle(page); await page.waitForTimeout(300);
        w = await world(page);
        const swReq = L.text(L.requests().slice(-1)[0]);
        assert(!find(w, 'character', 'Greta') && find(w, 'character', 'Otto') && find(w, 'character', 'Hale').f.wants === 'To cross the river', 'swipe: what the swiped-away reply filed is undone, and the new reply is filed');
        assert(/On file\. People: Hale\./.test(swReq) && !/Greta/.test(swReq.slice(swReq.indexOf('[Story update.'))), 'swipe: the new reply is written without the facts of the reply it replaces');
        await page.evaluate(() => globalThis.jQuery('#chat .last_mes .swipe_left').trigger('click'));
        await page.waitForTimeout(1500); await idle(page); await page.waitForTimeout(300);
        w = await world(page);
        assert(find(w, 'character', 'Greta') && !find(w, 'character', 'Otto') && find(w, 'character', 'Hale').f.wants === 'To reach the pass', 'swipe back: going back to the first reply brings its facts back and takes the other reply\'s away');
        L.mode({ reply: reply(['person: Ilse | baker | Cheerful', 'wants: Greta | To rest']) });
        await send(page, 'Second.');
        // keep Greta by hand, then delete both replies
        await patchEntry(page, 'Greta', { top: { auto: false } });
        await L.slash(page, '/del 4'); await page.waitForTimeout(900); await idle(page); await page.waitForTimeout(300);
        w = await world(page);
        console.log('after delete:', JSON.stringify(w.map(x => `${x.name}:${x.f.wants || ''}`)));
        assert(!find(w, 'character', 'Ilse') && find(w, 'character', 'Hale').f.wants === 'A crew', 'delete: deleting the replies undoes what they filed, back to what you wrote');
        assert(find(w, 'character', 'Greta') && find(w, 'character', 'Greta').f.wants === '', 'delete: an automatic entry you made your own is kept, and the line a deleted reply set in it is undone');
        L.mode({ reply: reply(['person: Ilse | baker | Cheerful', 'wants: Hale | To buy bread']) });
        await send(page, 'Third.');
        const idx = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length - 1);
        await page.evaluate(async ([B, idx]) => { const F = await import(`${B}/src/worldflow.js`); await F.undoReplyChanges(idx); }, [L.BASE, idx]);
        w = await world(page);
        const undone = (await last(page)).update.undone;
        L.mode({ reply: PROSE });
        await send(page, 'Fourth.');
        const w2 = await world(page);
        assert(undone && !find(w, 'character', 'Ilse') && find(w, 'character', 'Hale').f.wants === 'A crew' && !find(w2, 'character', 'Ilse'), 'undo: "Undo these changes" takes back one reply\'s changes, and they stay undone');

        // ----- E2. a continued reply keeps what its first part filed
        await newWorld(page, 'Continue story', S);
        L.mode({ reply: reply(['person: Anna | a singer | Bold']) });
        await send(page, 'Start.');
        L.mode({ reply: reply([' person: Bert | a drummer | Shy']) });
        L.resetLog();
        await page.evaluate(() => { globalThis.jQuery('#option_continue').trigger('click'); });
        await page.waitForTimeout(1500); await L.idle(page); await idle(page); await page.waitForTimeout(400);
        w = await world(page);
        const cont = await last(page);
        console.log('after continue:', JSON.stringify(w.map(x => x.name)), 'changes:', cont.update?.changes.length, 'requests:', L.requests().length);
        assert(find(w, 'character', 'Anna') && find(w, 'character', 'Bert') && cont.update.changes.length === 2 && !/story_update/.test(cont.mes), 'continue: a continued reply keeps what its first part filed and adds what the rest filed');

        // ----- F. a thread builds by itself
        await newWorld(page, 'Build story', S);
        await addEntries(page, [{ kind: 'character', name: 'Hale', fields: { role: 'captain' } }, { kind: 'thread', name: 'The invitation', fields: { open: 'Hale asked you to sail', sets_off: 'Hale asks one last time' } }]);
        await ws(page, { build: 2 });
        L.mode({ reply: PROSE });
        const steps = [];
        for (let i = 0; i < 9; i++) { await send(page, 'build ' + i); steps.push(find(await world(page), 'thread', 'The invitation').status); }
        console.log('thread by itself:', steps.join(' '));
        assert(steps.join() === 'quiet,quiet,stirring,stirring,building,building,ready,ready,ready', 'build: an open thread goes up one step every two replies and stops at "about to come to a head"');
        const why = (await last(page)).update;
        const lgB = await logs(page);
        assert(lgB.some(e => e.details.some(d => /went from "Building" to "About to come to a head" \(2 replies went by with no movement\)/.test(d))), 'build: each step is in the Log with its reason');
        await ws(page, { build: 0 });

        // ----- G. something ready is ordered into the scene; it counts as the one new thing; the check decides
        await L.setSettings(page, { check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'off' }, perReply: 1 });
        const ins = await page.evaluate(async ([B, S]) => { const K = await import(`${B}/src/books.js`); const St = await import(`${B}/src/store.js`); const d = { entries: {} }; const x = K.newInstruction(d); Object.assign(x, { name: 'I', chance: 100, wait: 0, sentAs: 'system', versions: [{ text: '{{char}} must do thing A1 to {{user}}.', keep: false }] }); K.writeInstruction(d, x); const a = await K.createSet('Orders ' + Date.now(), 'instructions', d, S); const cs = St.chatState(); cs.activeSets = [a]; St.saveChatState(); return a; }, [L.BASE, S]);
        await ws(page, { head: 100 });
        L.mode({ reply: PROSE, done: false });
        const kinds = [];
        let order = null;
        // A missed instruction is sent again twice before anything new starts, so the order gets a turn about every third reply.
        for (let i = 0; i < 40 && !order; i++) { const r = await send(page, 'head ' + i); const o = /the open matter "The invitation" must come to a head/.test(r.text); const a = /thing A1/.test(r.text); kinds.push(o && a ? 'both' : o ? 'order' : a ? 'ins' : 'none'); if (o) order = r; }
        console.log('one new thing per reply:', kinds.join(' '));
        assert(order && !kinds.includes('both') && !kinds.includes('none'), 'order: a thread that is about to come to a head is ordered into the scene, and it shares the one new thing per reply with the instruction set');
        assert(/\[System note: In this reply, the open matter "The invitation" must come to a head: Hale asked you to sail\. What brings it on: Hale asks one last time\. It happens in the scene, where it can be seen and heard\. User's words, choices and thoughts are theirs to write\.\]/.test(order.text), 'order: the wording is an order for this reply, with the line about your words');
        let m = await last(page);
        const it = m.items.find(i => i.worldOrder);
        assert(it && it.name === 'Open thread: The invitation' && it.status === 'overdue' && find(await world(page), 'thread', 'The invitation').status === 'ready', 'order: when the check says it did not happen, the thread stays where it was and the order is overdue');
        L.mode({ reply: PROSE });
        const again = await send(page, 'again');
        m = await last(page);
        await idle(page);
        const itA = m.items.find(i => i.worldOrder);
        assert(/Overdue\. This was ordered in the last reply and it did not happen\. It must happen in this reply: the open matter "The invitation"/.test(again.text) && !/thing A1/.test(again.text) && itA.status === 'done', 'order: it is sent again alone with firmer wording, and the check then finds it');
        const tw = find(await world(page), 'thread', 'The invitation');
        const lgG = await logs(page);
        assert(tw.status === 'happening' && (await last(page)).update.changes.some(c => c.type === 'status' && c.after === 'happening') && lgG.some(e => e.details.some(d => /went from "About to come to a head" to "Happening now" \(it was ordered into the scene and it happened\)/.test(d))), 'order: when it happens, the thread is marked "Happening now", stored with the reply and written to the Log');

        // planted details: one you wrote can be ordered in at once; a new automatic one waits; a secret only when allowed
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });
        await page.evaluate(async (B) => { const St = await import(`${B}/src/store.js`); const cs = St.chatState(); cs.activeSets = []; St.saveChatState(); }, L.BASE);
        await newWorld(page, 'Seed story', S);
        await addEntries(page, [{ kind: 'character', name: 'Hale', fields: { role: 'captain' } }, { kind: 'secret', name: 'The letter', fields: { secret: 'Hale burned the letter XSECRETX', holder: 'Hale' } }]);
        await ws(page, { head: 100, minAge: 3, bring: { thread: true, seed: true, activity: true, secret: false } });
        L.mode({ reply: reply(['planted: The torn sail | A sail in the hold is torn']) });
        const s0 = await send(page, 's0');
        L.mode({ reply: reply([]) });
        const seen = [];
        for (let i = 1; i <= 5; i++) { const r = await send(page, 's' + i); seen.push(/a detail planted earlier must matter now: A sail in the hold is torn/.test(r.text) ? 'order' : /must come out/.test(r.text) ? 'secret' : '-'); }
        console.log('planted detail made at reply 1:', seen.join(' '));
        assert(seen.join(' ') === '- - order - -', 'order: a planted detail waits the set number of replies, is ordered in once, and with checking off it counts as paid off when sent');
        assert(find(await world(page), 'seed', 'The torn sail').status === 'paid', 'order: the planted detail is marked "Paid off"');
        await ws(page, { bring: { thread: true, seed: true, activity: true, secret: true } });
        const sec = await send(page, 'now the secret');
        const secW = find(await world(page), 'secret', 'The letter');
        const after = await send(page, 'after');
        assert(/a secret must come out: Hale burned the letter XSECRETX \(it is Hale's secret\)\. Someone in the scene learns it by seeing it, hearing it or being told\./.test(sec.text) && secW.status === 'out' && /The letter: Hale burned the letter XSECRETX\. This is out in the open\./.test(after.text), 'order: with secrets allowed, the secret of someone in the scene is ordered out, marked "Out in the open", and then sent in full');
        await ws(page, { head: 0, bring: { thread: true, seed: true, activity: true, secret: false } });

        // ----- H. the panel
        await click(page, 'Expand');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'world'; P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^Planted details \(1\)/.test(x.textContent)), null, { timeout: 8000 });
        const ui = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#ri_root .ri-chip')].map(c => c.textContent), titles: [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent), fields: [...document.querySelectorAll('#ri_root .ri-field .ri-label')].map(x => x.textContent.trim()) }));
        assert(ui.chips.includes('Added automatically') && ui.titles.includes('Keeping the world up to date') && ui.fields.includes('Keep the world up to date from each reply') && ui.fields.includes('A kept secret of someone in the scene'), 'panel: automatic entries are marked, and the tab has the settings for keeping the world up to date');
        await page.evaluate(() => { [...document.querySelectorAll('#ri_root .ri-card-name')].find(b => b.textContent === 'The torn sail').click(); });
        await page.waitForTimeout(400);
        const ed = await page.evaluate(() => document.querySelector('#ri_root .ri-body').textContent);
        assert(/The extension added this entry from a reply\. Saving it here makes it yours\./.test(ed) && /Let the extension keep this entry up to date/.test(ed), 'panel: the editor says an entry was added automatically and offers to keep it as written');
        await click(page, 'Save planted detail');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^Planted details \(1\)/.test(x.textContent)), null, { timeout: 8000 });
        assert(find(await world(page), 'seed', 'The torn sail').auto === false, 'panel: saving an automatic entry makes it yours');
        L.mode({ reply: reply(['person: Mira | fruit seller | Blunt and warm']) });
        await send(page, 'one more');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'sent'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(500);
        const sentUi = await page.evaluate(() => { const c = [...document.querySelectorAll('#ri_root .ri-sentitem')].find(x => /what this reply changed/.test(x.textContent)); return c ? { text: c.textContent, undo: [...c.querySelectorAll('button')].some(b => b.textContent === 'Undo these changes') } : null; });
        assert(sentUi && /Added character: Mira/.test(sentUi.text) && /Filed automatically/.test(sentUi.text) && sentUi.undo, 'panel: What Was Sent lists what the reply changed in the world, with a button to undo it');
        await page.screenshot({ path: '/tmp/s53_sent.png' });
        await click(page, 'Undo these changes');
        await idle(page); await page.waitForTimeout(500);
        assert(!find(await world(page), 'character', 'Mira'), 'panel: the undo button takes the changes back');
        await L.setSettings(page, { check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' } });
        await ws(page, { update: 'all', build: 10, head: 20, minAge: 6 });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
function click(page, text, root = '#ri_root') { return page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text) || [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]); }
