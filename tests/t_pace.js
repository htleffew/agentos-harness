// 5.5: pacing and style. Story event items that wait for the story world or for people in the scene, big events
// and the quiet after them, story phases, a character who has gone quiet, what a style item adds while it is the
// pick, the word list, and the rules given to the AI writer.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const hud = (who) => `${PROSE}\n\n<scene_cast>\nLocation: Fruit market\nActive Speakers: ${who}\n</scene_cast>`;
const idle = async (page) => { await page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE); await page.waitForTimeout(250); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, all, text: L.text(chat[chat.length - 1] || all[0]) }; };
const lastRec = (page) => page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; const r = c[c.length - 1].extra?.roleplay_instructions; return r ? { pace: r.pace, asked: r.asked, items: r.items.map(i => ({ name: i.name, text: i.text, big: i.big, status: i.status, pace: i.pace, worldOrder: i.worldOrder })) } : null; });

/** A story event set with one category. items: [text | { text, need, min }]. */
async function eventSet(page, name, items, opts = {}) {
    return page.evaluate(async ({ BASE, name, items, opts }) => {
        const E = await import(`${BASE}/src/events.js`); const B = await import(`${BASE}/src/books.js`); const S = await import(`${BASE}/src/store.js`);
        const known = S.settings().sets[name];
        const ev = E.newEvent(name);
        Object.assign(ev, { chance: opts.chance ?? 100, wait: 0, keep: 0, big: !!opts.big });
        const cat = E.newCategory('Situation', items.map(x => typeof x === 'string' ? x : x.text), { useAll: false });
        items.forEach((x, i) => { if (typeof x === 'object') Object.assign(cat.items[i], { need: x.need, min: x.min }); });
        ev.categories = [cat];
        if (known) { const data = await B.loadSet(name); const old = E.findEventEntry(data, 'event', name); ev.uid = old.uid; E.writeEvent(data, ev, name); await B.saveSet(name, data); }
        else { const data = { entries: {} }; E.writeEvent(data, ev); await B.createSet(name, 'events', data); }
        const cs = S.chatState(); if (!cs.activeSets.includes(name) && opts.on !== false) cs.activeSets.push(name); S.saveChatState();
    }, { BASE: L.BASE, name, items, opts });
}
const setsOn = (page, names) => page.evaluate(async ([B, names]) => { const S = await import(`${B}/src/store.js`); S.chatState().activeSets = names; S.saveChatState(); }, [L.BASE, names]);
async function world(page, name, entries) {
    return page.evaluate(async ([B, name, entries]) => {
        const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`);
        const d = { entries: {} };
        const chat = String(globalThis.SillyTavern.getContext().getCurrentChatId());
        for (const [kind, nm, fields, extra] of entries) { const w = W.newWorldEntry(d, kind); Object.assign(w, { name: nm }, extra && extra.at ? { at: { chat, n: extra.at } } : {}, extra && extra.status ? { status: extra.status } : {}); Object.assign(w.fields, fields); W.writeWorldEntry(d, w); }
        const id = await K.createSet(name, 'world', d, '');
        W.setChatWorld(id);
        return id;
    }, [L.BASE, name, entries]);
}

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, world: { update: 'off', build: 0, head: 0, budget: 800 } });
        const t = Date.now();

        // ----- A. the dice, on their own
        const unit = await page.evaluate(async (B) => {
            const E = await import(`${B}/src/events.js`);
            const cat = E.newCategory('Situation', ['[thread] comes up again', 'someone nearly finds out [secret]', 'a quarrel breaks out', 'what was planned begins']);
            Object.assign(cat.items[0], { need: 'thread' }); Object.assign(cat.items[1], { need: 'secret' }); Object.assign(cat.items[2], { min: 3 }); Object.assign(cat.items[3], { need: 'plan' });
            const ri = { type: 'event', categories: [cat] };
            const none = { count: 1, threads: [], secrets: [], plans: [] };
            const full = { count: 3, threads: [{ uid: 1, name: 'Old', text: 'the open matter "Old" (who took the crate)' }, { uid: 2, name: 'New', text: 'the open matter "New"' }], secrets: [{ uid: 3, name: 'S', text: "Hale's secret (he wrote the letter)" }], plans: [{ uid: 4, name: 'Hale', text: "Hale's plan (to sail at dawn)" }] };
            const texts = new Set(); let st = null;
            for (let i = 0; i < 40; i++) { const r = E.rollEvent(ri, st, { scene: full }); st = r.state; texts.add(r.parts[0].items[0]); }
            return { none: E.rollEvent(ri, null, { scene: none }), texts: [...texts].sort(), preview: E.rollEvent(ri, null).parts[0].items[0], kept: E.normalItem({ text: 'x', need: 'plan', min: 2, dEvent: ' a  b ', junk: 1 }) };
        }, L.BASE);
        console.log('dice:', JSON.stringify(unit.texts));
        assert(unit.none === null, 'dice: when every item of a list waits for something the scene does not have, no event is rolled');
        assert(unit.texts.join('|') === ['a quarrel breaks out', "someone nearly finds out Hale's secret (he wrote the letter)", 'the open matter "Old" (who took the crate) comes up again', "what was planned begins, about Hale's plan (to sail at dawn)"].sort().join('|'), 'dice: with everything on offer every item is used, the oldest open thread and the secret are written in, and a plan is added to an item that has no mark for it');
        assert(/\[(thread|secret)\]|quarrel|planned/.test(unit.preview) && unit.kept.need === 'plan' && unit.kept.min === 2 && unit.kept.dEvent === 'a b' && !('junk' in unit.kept), 'dice: the example roll in the editor ignores the conditions, and an item keeps its condition when it is saved');

        // ----- B. in a chat: an item waits for the story world and for people in the scene
        await L.openChat(page);
        const EV = 'Pace events ' + t;
        await eventSet(page, EV, [{ text: '[thread] comes up again NEEDMARK', need: 'thread' }]);
        L.mode({ reply: hud('Hale') });
        const b0 = await send(page, 'one');
        assert(!/NEEDMARK/.test(b0.text), 'needs: with no story world, an item that waits for an open thread is left out and no event is sent');
        await world(page, 'Pace world ' + t, [
            ['character', 'Hale', { role: 'captain', plans: 'To sail at dawn PLANMARK' }], ['character', 'Mira', { role: 'fruit seller' }],
            ['thread', 'The missing crate', { open: 'A crate went missing OLDMARK' }], ['thread', 'The invitation', { open: 'Hale was invited NEWMARK' }, { at: 1 }],
            ['secret', 'The letter', { holder: 'Hale', secret: 'Hale wrote the letter himself SECRETMARK' }],
        ]);
        const b1 = await send(page, 'two');
        assert(/Situation: the open matter "The missing crate" \(A crate went missing OLDMARK\) comes up again NEEDMARK/.test(b1.text) && !/NEWMARK\) comes up/.test(b1.text), 'needs: with a story world, the item is used and the thread that has gone longest without moving is written into it');
        await eventSet(page, EV, [{ text: 'someone nearly finds out [secret]', need: 'secret' }]);
        const b2 = await send(page, 'three');
        assert(/Situation: someone nearly finds out Hale's secret \(Hale wrote the letter himself SECRETMARK\)/.test(b2.text), 'needs: an item that waits for a secret gets a kept secret of someone in the scene, and the AI is told what it is');
        await eventSet(page, EV, [{ text: '[plan] begins', need: 'plan' }]);
        const b3 = await send(page, 'four');
        assert(/Situation: Hale's plan \(To sail at dawn PLANMARK\) begins/.test(b3.text), 'needs: an item that waits for a plan gets the plan of someone in the scene');
        await eventSet(page, EV, [{ text: 'everyone talks at once CROWDMARK', min: 2 }]);
        const b4 = await send(page, 'five');
        L.mode({ reply: hud('Hale, Mira') });
        await send(page, 'six');     // this reply's HUD names two people; the next reply is rolled with two in the scene
        const b5 = await send(page, 'seven');
        assert(!/CROWDMARK/.test(b4.text) && /CROWDMARK/.test(b5.text), 'present: an item set to "at least 2 characters in the scene" waits until the HUD names two');

        // ----- C. a big event, and the quiet after it
        await L.openChat(page);
        await L.makeSet(page, 'Pace ins ' + t, [{ name: 'I', versions: ['A1'] }]);
        const BIG = 'Pace big ' + t;
        await eventSet(page, BIG, ['a storm arrives BIGMARK'], { big: true });
        await setsOn(page, ['Pace ins ' + t, BIG]);
        await L.setSettings(page, { pace: { quiet: 2 } });
        L.mode({ reply: PROSE });
        const seen = [];
        for (let i = 0; i < 5; i++) { const r = await send(page, 'q' + i); seen.push(`${/BIGMARK/.test(r.text) ? 'E' : '-'}${/thing A1/.test(r.text) ? 'I' : '-'}`); }
        const quietRec = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat.filter(m => !m.is_user); return c.slice(1).map(m => m.extra?.roleplay_instructions?.pace?.quiet || null); });
        console.log('big and quiet:', seen.join(' '), JSON.stringify(quietRec));
        assert(seen.join(' ') === 'EI -- -- EI --', 'quiet: after a big event has happened, nothing new starts for 2 replies, and then things start again');
        assert(quietRec[1] && quietRec[1].left === 2 && /Pace big/.test(quietRec[1].name) && quietRec[2].left === 1 && !quietRec[3], 'quiet: the record on each quiet reply says what happened and how long the quiet lasts');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'sent'; P.app.render(); }, L.BASE);
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Expand'); if (b) b.click(); });
        await page.waitForTimeout(500);
        const sentText = await page.evaluate(() => document.querySelector('#ri_root').textContent);
        assert(/Nothing new was started with this reply: it is quiet after "Story event: Pace big/.test(sentText) || /nothing new started \(quiet after a big event\)/.test(sentText), 'quiet: What Was Sent says why nothing new was started');
        await L.setSettings(page, { pace: { quiet: 0 } });
        const noQuiet = await send(page, 'q5');
        const noQuiet2 = await send(page, 'q6');
        assert(/BIGMARK/.test(noQuiet.text) && /BIGMARK/.test(noQuiet2.text), 'quiet: with the setting at 0, a big event is followed by the next one right away');

        // ----- D. story phases
        await L.openChat(page);
        await setsOn(page, ['Pace ins ' + t]);
        await L.setSettings(page, { pace: { phasesOn: true, phases: [{ name: 'Hold', from: 1, chance: 0, line: 'People are being met PHASEMARK.' }, { name: 'Go', from: 3, chance: 100, line: '' }] } });
        const ph = [];
        for (let i = 0; i < 4; i++) { const r = await send(page, 'p' + i); ph.push(`${/thing A1/.test(r.text) ? 'I' : '-'}${/the story is in its phase "Hold"\. People are being met PHASEMARK\./.test(r.text) ? 'L' : '-'}`); }
        const phRec = await lastRec(page);
        console.log('phases:', ph.join(' '), JSON.stringify(phRec.pace));
        assert(ph.join(' ') === '-L -L I- I-', 'phases: a phase with chance 0 starts nothing new and sends its own line; the next phase starts at its reply number and sends things again');
        assert(phRec.pace?.phase?.name === 'Go', 'phases: the record on a reply says which phase it was written in');
        await L.setSettings(page, { pace: { phasesOn: false } });

        // ----- E. a character of the world who has gone quiet
        await L.openChat(page);
        await setsOn(page, []);
        await world(page, 'Quiet world ' + t, [['character', 'Hale', { role: 'captain' }], ['character', 'Mira', { role: 'fruit seller', wants: 'To be asked along' }]]);
        await L.setSettings(page, { pace: { silent: 2 } });
        L.mode({ reply: hud('Hale, Mira') });
        const sl = [];
        for (let i = 0; i < 4; i++) { const r = await send(page, 's' + i); sl.push(/Mira must speak or act in this reply, in a way that fits who Mira is and what Mira wants \(To be asked along\)\./.test(r.text) ? 'O' : '-'); }
        const slRec = await lastRec(page);
        console.log('silent:', sl.join(' '), JSON.stringify(slRec.items.map(i => i.name)));
        assert(sl.join(' ') === '- - - O' && !/Hale must speak/.test((await send(page, 's4')).text), 'silent: a character who was in the scene for 2 replies and is named in the story text of neither is ordered to speak or act; one who is named gets no order');
        assert(slRec.items.some(i => /In the scene and unnamed for 2 replies: Mira/.test(i.name)), 'silent: What Was Sent names the order and why it was made');
        await L.setSettings(page, { pace: { silent: 0 } });
        assert(!/must speak or act/.test((await send(page, 's5')).text), 'silent: with the setting at 0, no such order is made');

        // ----- F. what a writing style item adds while it is the pick
        await L.openChat(page);
        const ST = 'Pace style ' + t;
        await page.evaluate(async ({ BASE, name }) => {
            const E = await import(`${BASE}/src/events.js`); const B = await import(`${BASE}/src/books.js`);
            const ev = E.newStyle(name);
            const cat = E.newCategory('Prose style', ['tense and quick STYLEMARK'], { mode: 'keepFixed' });
            cat.fixed = cat.items[0].id;
            Object.assign(cat.items[0], { dEvent: 'The event starts with no warning DIREVENT', dCheck: 'Does the reply end on something happening?', dNext: 'What was set up in the last reply now happens DIRNEXT.' });
            ev.categories = [cat];
            const data = { entries: {} }; E.writeEvent(data, ev); await B.createSet(name, 'style', data);
        }, { BASE: L.BASE, name: ST });
        await eventSet(page, BIG, ['a storm arrives BIGMARK'], { big: false, on: false });
        await setsOn(page, [ST]);
        await L.setSettings(page, { check: { mode: 'full', maxResend: 0, holdNew: false, regenOnMiss: false, agency: 'off' } });
        L.mode({ reply: PROSE });
        const f1 = await send(page, 'd1');
        assert(/STYLEMARK/.test(f1.text) && !/DIRNEXT/.test(f1.text) && f1.n === 1, 'style item: with only the style sent, its question makes no AI request, and the first reply has no carried note');
        await setsOn(page, [ST, BIG]);
        const f2 = await send(page, 'd2');
        const creq = f2.all.map(r => L.text(r)).find(x => /Decide for each instruction whether the reply carried it out/.test(x)) || '';
        const f2rec = await lastRec(page);
        console.log('asked:', JSON.stringify(f2rec.asked));
        assert(/Situation: a storm arrives BIGMARK\. Fit it to the people, place and facts already established\. The event starts with no warning DIREVENT\./.test(f2.text), 'style item: its sentence is added to a story event that starts while it is the pick');
        assert(/A note carried over from the style of the last reply: What was set up in the last reply now happens DIRNEXT\./.test(f2.text), 'style item: its note is sent with the reply after one written under it');
        assert(/ID q1: The answer to this question about the reply is yes: Does the reply end on something happening\?/.test(creq) && f2.n === 2 && f2rec.asked?.[0]?.yes === true && /wonderful/.test(f2rec.asked[0].quote), 'style item: its question rides along with the check that runs anyway, and the answer is kept on the reply');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'sent'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        assert(/Questions about the replyDoes the reply end on something happening\? Yes\./.test(await page.evaluate(() => document.querySelector('#ri_root').textContent)), 'style item: What Was Sent shows the question and the answer');
        await page.screenshot({ path: '/tmp/s55_sent.png' });

        // ----- G. the word list and the rules given to the AI writer
        const words = await page.evaluate(async (B) => {
            const V = await import(`${B}/src/validate.js`); const W = await import(`${B}/src/world.js`); const P = await import(`${B}/src/pacing.js`); const S = await import(`${B}/src/store.js`); const E = await import(`${B}/src/events.js`);
            const out = {};
            out.version = V.validateVersion('{{char}} must hand the ledgers to {{user}} and name the debt.').warns.filter(w => /word list/.test(w));
            out.clean = V.validateVersion('{{char}} must invite {{user}} to the harbour.').warns.filter(w => /word list/.test(w));
            const d = { entries: {} }; const w = W.newWorldEntry(d, 'character'); w.name = 'Hale'; w.fields.who = 'A clerk who keeps every permit.';
            out.entry = W.entryFlags(w).warns.filter(x => /word list/.test(x));
            out.hits = P.wordHits('The mask cracked and the Tapestry shifted. Costume, landlord.');
            S.settings().words.on = false;
            out.off = V.validateVersion('{{char}} must name the debt.').warns.filter(x => /word list/.test(x)).length;
            S.settings().words.on = true;
            const style = E.newStyle('x').categories.flatMap(c => c.items.map(i => i.text)).join(' | ');
            out.defaults = { plain: /people say plainly what they mean/.test(style), old: /implied by action|understatement|temperature|on edge|scared|nervous/.test(style) };
            return out;
        }, L.BASE);
        console.log('words:', JSON.stringify(words));
        assert(words.version.length === 1 && /"ledgers", "debt"/.test(words.version[0]) && words.clean.length === 0 && /"permit", "clerk"/.test(words.entry[0] || ''), 'words: a version and a story world entry that use words from the list get one line naming them, and plain text gets none');
        assert(words.hits.join() === 'shifted,cracked,mask,Tapestry' && words.off === 0, 'words: whole words only (costume and landlord are left alone), a star stands for any ending, and off flags nothing');
        assert(words.defaults.plain && !words.defaults.old, 'defaults: the starting writing style lists are in plain words');
        L.mode({ writer: '["a letter arrives", "a debt is called in"]' }); L.resetLog();
        const wr = await page.evaluate(async (B) => { const Wr = await import(`${B}/src/writer.js`); const S = await import(`${B}/src/store.js`); const a = await Wr.writeItems({ category: { name: 'Situation' }, theme: 'a harbour town', count: 2, context: {}, existing: [], others: [] }); S.settings().words.tell = false; S.settings().writer.rules = 'Only kind things happen RULEMARK'; await Wr.writeItems({ category: { name: 'Situation' }, theme: 'a harbour town', count: 2, context: {}, existing: ['zzz'], others: [] }); S.settings().words.tell = true; const P = await import(`${B}/src/pacing.js`); S.settings().writer.rules = P.DEFAULT_WRITER_RULES; return a.map(x => x.text); }, L.BASE);
        const wreq = L.requests().map(r => L.text(r));
        assert(/Rules about content, which come before everything else:\n- Plain statements in literal words\./.test(wreq[0]) && /- Prices, payments, debts, ownership, records, paperwork, officials and enforced rules are left out\./.test(wreq[0]) && /These words stay out of what you write \(a star stands for any ending\): ledger\*, debt\*/.test(wreq[0]), 'writer: every writing request carries the rules and the word list');
        assert(/- Only kind things happen RULEMARK/.test(wreq[1]) && !/These words stay out/.test(wreq[1]) && wr.length === 2, 'writer: the rules are yours to change, and the word list can be left out of the request');

        // ----- H. the panel
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'settings'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(500);
        const setText = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent.trim()));
        const setLabels = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-field .ri-label')].map(x => x.textContent.trim()));
        assert(setText.includes('Pacing') && setText.includes('What the AI writes for you') && ['Quiet after a big event (replies)', 'Order a character who has gone quiet (replies)', 'Story phases', 'Rules given to the AI writer', 'Your word list'].every(x => setLabels.includes(x)), 'panel: Settings has the pacing settings, the rules for the AI writer and the word list');
        await page.screenshot({ path: '/tmp/s55_settings.png', fullPage: false });
        // an item's condition is set in the editor and kept when the set is saved
        await page.evaluate(async ([B, name]) => { const P = await import(`${B}/src/ui/panel.js`); const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`); const data = await K.loadSet(name); const entry = E.findEventEntry(data, 'event', name); P.app.tab = 'events'; const draft = E.readEvent(entry, name); P.app.eroute = { view: 'edit', name, draft, open: { [draft.categories[0].id]: true } }; P.app.render(); }, [L.BASE, BIG]);
        await page.waitForTimeout(500);
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_root .ri-version button')].find(x => x.textContent.trim() === 'Edit'); b.click(); });
        await page.waitForTimeout(300);
        const editLabels = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-version-editing .ri-label')].map(x => x.textContent.trim()));
        await page.evaluate(() => { const f = [...document.querySelectorAll('#ri_root .ri-version-editing .ri-field')].find(x => /Use this item only when/.test(x.textContent)); const sel = f.querySelector('select'); sel.value = 'thread'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
        await page.waitForTimeout(300);
        await page.evaluate(() => { [...document.querySelectorAll('#ri_root .ri-version-editing button')].find(x => x.textContent.trim() === 'Done').click(); });
        await page.waitForTimeout(300);
        const chips = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-version .ri-chip')].map(x => x.textContent.trim()));
        await page.screenshot({ path: '/tmp/s55_item.png' });
        await page.evaluate(() => { [...document.querySelectorAll('#ri_root .ri-savebar button')].find(x => /^Save/.test(x.textContent.trim())).click(); });
        await page.waitForTimeout(1200);
        const saved = await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`); const data = await K.loadSet(name); const ev = E.readEvent(E.findEventEntry(data, 'event', name), name); return ev.categories[0].items[0]; }, [L.BASE, BIG]);
        assert(editLabels.includes('Use this item only when') && editLabels.includes('Characters in the scene, at least') && chips.includes('Only when: there is an open thread') && saved.need === 'thread', 'panel: an item\'s condition is chosen in the editor, shown on the item, and kept when the set is saved');
        await L.setSettings(page, { perReply: 0, check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' }, pace: { quiet: 2, silent: 4, phasesOn: false, phases: [{ name: 'Opening', from: 1, chance: 50, line: '' }, { name: 'Rising', from: 11, chance: 100, line: '' }, { name: 'Long run', from: 41, chance: 125, line: '' }] }, world: { update: 'all', build: 10, head: 20 } });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
