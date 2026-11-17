// 5.11: character profile cards and the roast, asked for in the update block and drawn by the extension under any preset.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'The fire crackled. "You look wonderful tonight," Hale said quietly.';
const HALE_FULL = ['<profile name="Hale">', 'Who: A ship captain who lost his crew. He is proud and loyal.', 'Strength: He keeps calm under pressure', 'Flaw: He will not ask for help', 'Voice: Short sentences, dry jokes', 'Orientation: Bisexual',
    'Wants: To make Mira smile tonight, and to sail again', 'Thinks: Mira is braver than she lets on', 'Feels: Hale feels hopeful', 'Shows: A small smile', 'Keeps private: He is afraid she will leave', 'Will not: Talk about the wreck', 'Why: His pride keeps the fear behind a joke', '</profile>'];
const HALE_NOW = ['<profile name="Hale">', 'Wants: To keep the fire going', 'Thinks: The night is quiet', 'Feels: Hale feels calm', 'Shows: He hums', 'Keeps private: He misses the sea', 'Will not: Leave the camp', 'Why: He is loyal to the people he travels with', '</profile>'];
const MIRA_NOW = ['<profile name="Mira">', 'Wants: To hear the story of the wreck', 'Thinks: Hale is hiding something', 'Feels: Mira feels curious', 'Shows: She leans closer', 'Keeps private: She already knows part of it', 'Will not: Push him tonight', 'Why: She is patient', '</profile>'];
const ROAST = ['<roast>', 'LMAOOO Hale really said "you look wonderful" with his WHOLE chest?!? captain of feelings fr xD', '</roast>'];
const block = (lines) => `${PROSE}\n\n<story_update>\n${lines.join('\n')}\n</story_update>`;
const idle = async (page) => { await page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE); await page.waitForTimeout(400); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); await page.evaluate(async (B) => { (await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(); }, L.BASE); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, text: L.text(chat[chat.length - 1] || all[0]) }; };
const last = (page) => page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; const m = c[c.length - 1]; const el = document.querySelector(`#chat .mes[mesid="${c.length - 1}"]`); const r = m.extra?.roleplay_instructions || {}; const block = el?.querySelector('.mes_block'); return { mes: m.mes, profiles: r.profiles || null, roast: r.roast || '', cards: el?.querySelector('.ri-cards')?.textContent || null, names: [...(el?.querySelectorAll('.ri-profile > summary') || [])].map(x => x.textContent), order: block ? [...block.children].map(x => x.className.split(' ').find(c => /^ri-(scene|cards|under)$/.test(c))).filter(Boolean) : [] }; });
const world = (page) => page.evaluate(async (B) => { const W = await import(`${B}/src/world.js`); const id = W.chatWorld(); const d = await W.loadWorld(id); return W.listWorld(d, id).map(w => ({ kind: w.kind, name: w.name, f: w.fields, auto: w.auto })); }, L.BASE);

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1400 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, scene: { track: true, card: 'always' }, cards: { on: true, most: 2, roast: true }, world: { update: 'all', head: 0, build: 0 } });
        const t = Date.now();

        // ----- with no story world
        await L.openChat(page);
        L.mode({ reply: block(['present: Hale, Mira', 'where: The camp', 'when: Day 3, evening', 'scene: continues', ...HALE_FULL, ...MIRA_NOW, ...ROAST]) });
        const r1 = await send(page, 'I sit by the fire.');
        const l1 = await last(page);
        console.log('ask:', r1.text.slice(r1.text.indexOf('[Scene.'), r1.text.indexOf('[Scene.') + 1800));
        assert(r1.n === 1 && /<profile name="[^"]+">/.test(r1.text) && /Keeps private: what they think or feel and do not say/.test(r1.text) && /Profiles on file: none yet/.test(r1.text), 'ask: the profile form is part of the one block, with no extra AI request, and nobody is on file yet');
        assert(/Roast: The commentator is Gremlin, a viewer who just watched this reply/.test(r1.text) && /<roast>/.test(r1.text) && !/reaction to the previous reply was/.test(r1.text), "ask: the roast form and the commentator's voice are sent; with no earlier roast, none is quoted");
        assert(/2 profiles at most/.test(r1.text) && /never gets one/.test(r1.text), 'ask: the most profiles in one reply and the rule for {{user}} are sent');
        assert(!/<profile|<roast|story_update|Wants:/.test(l1.mes) && l1.mes.includes('You look wonderful tonight'), 'lift: the profiles and the roast are taken out of the reply text');
        const hale = (l1.profiles || []).find(p => p.name === 'Hale'), mira = (l1.profiles || []).find(p => p.name === 'Mira');
        assert(hale && hale.stable.flaw === 'He will not ask for help' && hale.stable.orientation === 'Bisexual' && hale.now.feels === 'Hale feels hopeful' && hale.now.why && mira && mira.now.willnot === 'Push him tonight' && !Object.keys(mira.stable).length, 'keep: each profile is kept on the reply, split into who they are and what is going on now');
        assert(/LMAOOO Hale/.test(l1.roast), 'keep: the roast is kept on the reply');
        assert(JSON.stringify(l1.names) === '["Hale","Mira"]' && /Keeps privateHe is afraid she will leave/.test(l1.cards || '') && /RoastLMAOOO/.test(l1.cards || '') && /Who they areWhoA ship captain/.test(l1.cards || ''), 'card: a card for each person and the roast at the bottom are drawn under the reply');
        assert(JSON.stringify(l1.order) === '["ri-scene","ri-cards"]', 'card: the scene card comes first, then the character cards');
        await page.screenshot({ path: '/tmp/s511_cards.png' });

        L.mode({ reply: block(['present: Hale', 'where: The camp', 'when: Day 3, night', ...HALE_NOW, '<roast>', 'bro is HUMMING now?? the character development is real 😭', '</roast>']) });
        const r2 = await send(page, 'I listen to the night.');
        const l2 = await last(page);
        assert(/Profiles on file: Hale\./.test(r2.text) && /reaction to the previous reply was: LMAOOO Hale really said/.test(r2.text), 'ask: Hale is now on file, and the previous roast is sent so the next one can answer it');
        const h2 = (l2.profiles || [])[0];
        assert(h2 && h2.now.shows === 'He hums' && h2.stable.voice === 'Short sentences, dry jokes', 'carry: a profile with only the lines of now gets who the person is from the earlier card in this chat');

        // ----- a swipe: the replaced reply's roast is not quoted
        L.mode({ reply: block(['present: Hale', 'where: The camp', 'when: Day 3, night', ...HALE_NOW, '<roast>', 'SWIPEROAST', '</roast>']) });
        L.resetLog(); await L.swipe(page); await L.waitChecks(page); await idle(page);
        const sw = L.text(L.requests().slice(-1)[0]);
        assert(/reaction to the previous reply was: LMAOOO/.test(sw) && !/HUMMING/.test(sw), 'swipe: the roast quoted is the one before the reply being replaced');

        // ----- written outside the block
        L.mode({ reply: `${PROSE}\n\n<story_update>\npresent: Hale\nwhere: The camp\nwhen: Day 4\n</story_update>\n\n${MIRA_NOW.join('\n')}\n${ROAST.join('\n')}` });
        await send(page, 'Morning.');
        const l3 = await last(page);
        assert(!/<profile|<roast|Wants:/.test(l3.mes) && (l3.profiles || [])[0]?.name === 'Mira' && /LMAOOO/.test(l3.roast), 'lift: a profile and a roast written after the block are taken out and kept too');

        // ----- with a story world
        await L.openChat(page);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const d = { entries: {} }; const w = W.newWorldEntry(d, 'character'); w.name = 'Hale'; w.fields.role = 'captain'; w.fields.who = 'A captain HALEOWNWHO'; W.writeWorldEntry(d, w); const id = await K.createSet(name, 'world', d, ''); W.setChatWorld(id); }, [L.BASE, 'Cards world ' + t]);
        L.mode({ reply: block(['present: Hale, Mira', 'where: The camp', 'when: Day 5', 'scene: continues', ...HALE_FULL, '<profile name="Mira">', 'Who: A fruit seller from the coast', 'Strength: Patience', 'Flaw: Stubborn', 'Voice: Warm and quick', 'Orientation: Straight', ...MIRA_NOW.slice(1), ...ROAST]) });
        const w1 = await send(page, 'Good morning.');
        const ww = await world(page);
        const wh = ww.find(w => w.name === 'Hale'), wm = ww.find(w => w.name === 'Mira');
        assert(/person: Name \| their role in the story/.test(w1.text) && /<profile name=/.test(w1.text) && /Profiles on file: none yet/.test(w1.text), 'ask: with a story world, the profile form is part of the same update block');
        assert(wh && wh.f.who === 'A captain HALEOWNWHO' && wh.f.flaw === 'He will not ask for help' && wh.f.orientation === 'Bisexual' && wh.f.wants === 'To make Mira smile tonight, and to sail again', "world: Hale's entry gets the lines it did not have, keeps the one you wrote, and his wants are kept up to date");
        assert(wm && wm.auto && wm.f.voice === 'Warm and quick' && wm.f.strength === 'Patience', 'world: a new person with a full profile gets an entry of their own');
        const lw = await last(page);
        assert(/HALEOWNWHO/.test(lw.cards || ''), 'card: the card shows who the person is as the story world has it');
        L.mode({ reply: block(['present: Hale', ...HALE_NOW]) });
        const w2 = await send(page, 'Later.');
        assert(/Profiles on file: Hale, Mira\./.test(w2.text), 'ask: people whose entry has who they are are on file, so they are not asked for again');
        L.mode({ reply: block(['present: Hale', ...HALE_NOW]) });
        L.resetLog(); await L.swipe(page); await L.waitChecks(page); await idle(page);
        const ww2 = await world(page);
        assert(ww2.find(w => w.name === 'Mira') && ww2.find(w => w.name === 'Hale').f.flaw === 'He will not ask for help', 'swipe: replacing a later reply leaves what the earlier reply filed');

        // ----- settings: one profile, roast off, cards off, scene lines off
        await L.setSettings(page, { cards: { most: 1, roast: false } });
        L.mode({ reply: PROSE });
        const o1 = await send(page, 'Next.');
        assert(/Nobody else gets one/.test(o1.text) && !/<roast>|Roast:/.test(o1.text), 'settings: one profile at most, and with the roast off it is not asked for');
        await L.setSettings(page, { cards: { on: false, most: 2, roast: true } });
        const o2 = await send(page, 'Next.');
        assert(!/<profile/.test(o2.text) && /present: everyone in the scene/.test(o2.text), 'settings: with the cards off, no profile is asked for and the scene lines still are');
        await L.openChat(page);
        await L.setSettings(page, { cards: { on: true }, scene: { track: false } });
        L.mode({ reply: block([...HALE_NOW, ...ROAST]) });
        const o3 = await send(page, 'Hello.');
        const l4 = await last(page);
        assert(/\[Scene\./.test(o3.text) && /<profile name=/.test(o3.text) && !/present: everyone in the scene/.test(o3.text) && (l4.profiles || [])[0]?.name === 'Hale', 'settings: with the scene lines off and the cards on, only the cards are asked for, and they are kept');
        await L.setSettings(page, { cards: { on: false } });
        await page.evaluate(async (B) => { (await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(); }, L.BASE);
        assert((await last(page)).cards === null, 'settings: with the cards off, no card is drawn');
        L.mode({ reply: 'Fine.' });
        await L.setSettings(page, { cards: { on: true }, scene: { track: true } });
        const ooc = await send(page, 'OOC: how are you?');
        assert(!/<profile/.test(ooc.text), 'ooc: an out-of-character message is not asked for profiles');

        // ----- the panel
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'settings'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        const titles = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent.trim()));
        const help = await page.evaluate(() => document.querySelector('#ri_root')?.textContent || '');
        assert(titles.includes('Character cards') && /The commentator's voice/.test(help) && !/\{\{char\}\} always/.test(help), 'panel: Settings has a Character cards section with the commentator\'s voice, using the character\'s name');
        await L.setSettings(page, { cards: { on: false } });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
