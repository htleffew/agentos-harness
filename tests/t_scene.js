// 5.10: who is present, where and when, kept by the extension under any preset, and the scene card.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'The fire crackled. "You look wonderful tonight," Hale said quietly.';
const block = (lines) => `${PROSE}\n\n<story_update>\n${lines.join('\n')}\n</story_update>`;
const idle = async (page) => { await page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE); await page.waitForTimeout(400); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, text: L.text(chat[chat.length - 1] || all[0]) }; };
const last = (page) => page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; const m = c[c.length - 1]; const el = document.querySelector(`#chat .mes[mesid="${c.length - 1}"]`); return { mes: m.mes, scene: m.extra?.roleplay_instructions?.scene || null, card: el?.querySelector('.ri-scene')?.textContent || null }; });

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1400 });
    try {
        await L.setupApi(page);   // SillyTavern's Default preset: no HUD, no tracker
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, scene: { track: true, card: 'auto' }, world: { update: 'all', head: 0, build: 0 } });
        const t = Date.now();

        // ----- with no story world
        await L.openChat(page);
        L.mode({ reply: block(['present: Hale, Mira', 'where: The camp by the river', 'when: Day 3, evening, clear and cold', 'scene: continues']) });
        const r1 = await send(page, 'I sit by the fire.');
        const l1 = await last(page);
        console.log('scene:', JSON.stringify(l1));
        assert(/\[Scene\. After the story text of this reply, add one block/.test(r1.text) && /present: everyone in the scene at the end of this reply other than \{\{user\}\}|present: everyone in the scene at the end of this reply other than /.test(r1.text) && r1.n === 1, 'ask: with no story world and a preset with no tracker, every reply is still asked for who is present, where and when, with no extra AI request');
        assert(l1.scene && l1.scene.present === 'Hale, Mira' && l1.scene.where === 'The camp by the river' && l1.scene.when === 'evening' && l1.scene.date === 'Day 3' && l1.scene.weather === 'clear and cold' && !/story_update|present:/.test(l1.mes), 'keep: the three lines are kept on the reply and taken out of its text');
        assert(/Timeevening/.test(l1.card || '') && /LocationThe camp by the river/.test(l1.card || '') && /PresentHale, Mira/.test(l1.card || ''), 'card: a scene card under the reply shows when, where and who is present');
        await page.screenshot({ path: '/tmp/s510_card.png' });
        // story events can count who is present from the lines
        await page.evaluate(async ([B, name]) => { const E = await import(`${B}/src/events.js`); const K = await import(`${B}/src/books.js`); const S = await import(`${B}/src/store.js`); const ev = E.newEvent(name); Object.assign(ev, { chance: 100, wait: 0, keep: 0 }); const c = E.newCategory('Situation', ['everyone talks at once CROWDMARK']); c.items[0].min = 2; ev.categories = [c]; const d = { entries: {} }; E.writeEvent(d, ev); const id = await K.createSet(name, 'events', d, ''); S.chatState().activeSets = [id]; S.saveChatState(); }, [L.BASE, 'Scene events ' + t]);
        L.mode({ reply: block(['present: Hale', 'where: The camp', 'when: Day 3, night']) });
        const r2 = await send(page, 'Mira leaves.');
        const r3 = await send(page, 'I wait.');
        assert(/CROWDMARK/.test(r2.text) && !/CROWDMARK/.test(r3.text), 'count: story event items that need two people use the count from the scene lines, which works under any preset');
        await page.evaluate(async (B) => { const S = await import(`${B}/src/store.js`); S.chatState().activeSets = []; S.saveChatState(); }, L.BASE);

        // ----- with a story world: someone present and unnamed in the text still gets their entry
        await L.openChat(page);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const d = { entries: {} }; for (const [n, role] of [['Hale', 'captain QUIETHALE'], ['Mira', 'fruit seller QUIETMIRA'], ['Otto', 'ferryman QUIETOTTO']]) { const w = W.newWorldEntry(d, 'character'); w.name = n; w.fields.role = role; W.writeWorldEntry(d, w); } const id = await K.createSet(name, 'world', d, ''); W.setChatWorld(id); }, [L.BASE, 'Scene world ' + t]);
        L.mode({ reply: block(['present: Hale, Mira', 'where: The camp', 'when: Day 4, morning', 'scene: continues']) });
        const w1 = await send(page, 'Good morning.');
        assert(/present: everyone in the scene at the end of this reply/.test(w1.text) && /person: Name \| their role in the story/.test(w1.text), 'ask: with a story world, the scene lines are part of the one update block');
        L.mode({ reply: PROSE });
        const w2 = await send(page, 'I look at the river.');
        const notes = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; const it = (c[c.length - 1].extra.roleplay_instructions.items || []).find(i => i.notes); return it?.notes || null; });
        console.log('notes:', JSON.stringify(notes && { present: notes.present, how: notes.how }));
        assert(/QUIETMIRA/.test(w2.text) && !/QUIETOTTO/.test(w2.text) && notes && /scene state/.test(notes.how), 'notes: Mira is unnamed in the story text but present by the scene lines, so her entry is sent, and someone not present is left out');

        // ----- a reply with its own tracker: no second card
        L.mode({ reply: `${PROSE}\n\n<scene_cast>\nLocation: The camp\nActive Speakers: Hale\n</scene_cast>\n\n<story_update>\npresent: Hale\nwhere: The camp\nwhen: Day 4, noon\n</story_update>` });
        await send(page, 'Lunch.');
        const l4 = await last(page);
        assert(l4.scene && l4.scene.when === 'noon' && l4.scene.date === 'Day 4' && l4.card === null, 'card: under a reply that draws its own tracker, the scene card stays hidden, and the lines are still kept');
        await L.setSettings(page, { scene: { card: 'always' } });
        await page.evaluate(async (B) => { (await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(); }, L.BASE);
        assert(/Timenoon/.test((await last(page)).card || ''), 'card: set to "Always", the card is shown under every reply');

        // ----- out of character, and off
        L.mode({ reply: 'Fine, thanks.' });
        const ooc = await send(page, 'OOC: how are you?');
        assert(!/present: everyone in the scene/.test(ooc.text), 'ooc: an out-of-character message is not asked for the scene lines');
        await L.setSettings(page, { scene: { track: false } });
        await L.openChat(page);
        L.mode({ reply: PROSE });
        const off = await send(page, 'hello');
        assert(!/\[Scene\./.test(off.text) && (await last(page)).card === null, 'off: with "Keep track of who is present, where and when" off, nothing is asked and no card is drawn');
        await L.setSettings(page, { scene: { track: true, card: 'auto' } });

        // ----- the panel
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'settings'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        const titles = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent.trim()));
        assert(titles.includes('Scene'), 'panel: Settings has a Scene section');
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
