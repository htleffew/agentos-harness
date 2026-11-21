// 5.6: the close-out. Reply counting that survives hidden messages, what the AI is sent from the chat, notes on
// "who does it" and "who it happens to", versions checked against who does it, and the story so far for the AI writer.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const idle = async (page) => { await page.evaluate(async (B) => { await (await import(`${B}/src/worldflow.js`)).worldIdle(); }, L.BASE); await page.waitForTimeout(250); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, text: L.text(chat[chat.length - 1] || all[0]) }; };

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0 });
        const t = Date.now();

        // ----- A. hidden messages: replies are still counted
        await L.openChat(page);
        await L.makeSet(page, 'Close ins ' + t, [{ name: 'I', versions: ['A1'] }]);
        await L.setSettings(page, { pace: { phasesOn: true, phases: [{ name: 'Hold', from: 1, chance: 0, line: '' }, { name: 'Go', from: 3, chance: 100, line: '' }] } });
        const seen = [];
        for (let i = 0; i < 4; i++) seen.push(/thing A1/.test((await send(page, 'h' + i)).text) ? 'I' : '-');
        const before = await page.evaluate(async (B) => (await import(`${B}/src/st.js`)).chatReach(), L.BASE);
        await L.slash(page, '/hide 0-6'); await page.waitForTimeout(600);
        const after = await page.evaluate(async (B) => (await import(`${B}/src/st.js`)).chatReach(), L.BASE);
        const r5 = await send(page, 'h4');
        const phase = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext().chat; return c[c.length - 1].extra?.roleplay_instructions?.pace?.phase?.name; });
        console.log('hidden:', seen.join(' '), JSON.stringify(before), JSON.stringify(after), phase);
        assert(seen.join(' ') === '- - I I' && after.hidden === 7 && after.open === before.open - 7, 'hidden: seven older messages were hidden from the AI');
        assert(/thing A1/.test(r5.text) && phase === 'Go' && !/h0|h1/.test(r5.text.replace(/thing A1/g, '')), 'hidden: the reply after that is still counted as reply 5, so the story phase that started at reply 3 stays, while the hidden messages are left out of what is sent');
        assert(before.last === before.open - 1 && before.cut === 0, 'reach: the messages in the finished prompt of the last reply are counted, and nothing was left out');

        // what the AI is sent, in Settings
        await page.evaluate(async (B) => { (await import(`${B}/src/context-budget.js`)).captureContext([{ role: 'system', content: 'only the preset' }]); }, L.BASE);
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); await P.app.openPage('context'); }, L.BASE);
        await page.evaluate(() => { const b = [...document.querySelectorAll('#ri_root button')].find(x => x.textContent.trim() === 'Expand'); if (b) b.click(); });
        await page.waitForTimeout(500);
        const st = await page.evaluate(() => document.querySelector('#ri_root').textContent);
        assert(/Last observed request/.test(st) && /Hidden from AI7/.test(st) && /visible chat messages were not matched/.test(st), 'reach: Context & Memory reports hidden messages and unmatched visible messages');
        await L.setSettings(page, { pace: { phasesOn: false } });

        // ----- B. who does it, who it happens to, and versions
        const notes = await page.evaluate(async (B) => {
            const V = await import(`${B}/src/validate.js`);
            return {
                same: V.pairingNote('char', 'char'), fine: V.pairingNote('char', 'user'), bothNew: V.pairingNote('new', 'new'), bothAny: V.pairingNote('npcAny', 'npcAny'), other: V.pairingNote('other', 'other'), ok2: V.pairingNote('npcFemale', 'user'),
                noChar: V.actorNote('A stranger must hand {{user}} a letter.', 'char'), hasChar: V.actorNote('{{char}} must hand {{user}} a letter.', 'char'),
                world: V.actorNote('{{char}} must close the window.', 'world'), worldOk: V.actorNote('The wind must slam the window shut next to {{char}}.', 'world'),
                fresh: V.actorNote('{{char}} must greet {{user}}.', 'new'), any: V.actorNote('{{char}} must greet {{user}}.', 'npcAny'),
            };
        }, L.BASE);
        assert(/does this to themself/.test(notes.same) && notes.fine === '' && /two people arrive at once/.test(notes.bothNew) && /may choose the same person for both/.test(notes.bothAny) && /nobody fits/i.test(notes.other) && notes.ok2 === '', 'pairing: a pairing that gives the AI writer little to work with gets a note, and an ordinary pairing gets none');
        assert(/does not name \{\{char\}\}/.test(notes.noChar) && notes.hasChar === '' && /"the surroundings do it"/.test(notes.world) && notes.worldOk === '' && /"someone new does it"/.test(notes.fresh) && notes.any === '', 'versions: a version that disagrees with who does it gets one line of advice, and one that agrees gets none');
        // in the editor
        await page.evaluate(async ([B, name]) => { const P = await import(`${B}/src/ui/panel.js`); const K = await import(`${B}/src/books.js`); const data = await K.loadSet(name); const ins = K.listInstructions(data, name)[0]; ins.actors = ['world']; ins.targets = ['new']; P.app.tab = 'instructions'; P.app.route = { view: 'edit', set: name, name, draft: ins, data }; P.app.render(); }, [L.BASE, 'Close ins ' + t]);
        await page.waitForTimeout(600);
        const ed = await page.evaluate(() => ({ text: document.querySelector('#ri_root').textContent, flags: [...document.querySelectorAll('#ri_root .ri-flag-warn')].map(x => x.textContent) }));
        console.log('editor flags:', JSON.stringify(ed.flags).slice(0, 300));
        assert(/The surroundings act on someone who has not appeared yet/.test(ed.text) && /You can keep it as it is/.test(ed.text) && ed.flags.some(f => /"the surroundings do it", and this version has \{\{char\}\} do it/.test(f)), 'editor: the note on the pairing and the advice on the version are shown, and saving stays allowed');
        await page.screenshot({ path: '/tmp/s56_editor.png' });

        // ----- C. the story so far, for the AI writer
        await L.openChat(page);
        await L.setSettings(page, { writer: { eventScene: true } });
        const ask = async () => { L.resetLog(); L.mode({ writer: '["a letter arrives"]', reply: PROSE }); await page.evaluate(async (B) => { const W = await import(`${B}/src/writer.js`); const E = await import(`${B}/src/events.js`); await W.writeItems({ category: E.newCategory('Situation'), theme: 'harbour', count: 1, context: { summary: true }, existing: [], others: [] }); }, L.BASE); return L.text(L.requests()[0]); };
        const none = await ask();
        await page.evaluate(() => globalThis.SillyTavern.getContext().setExtensionPrompt('1_memory', 'STMARK they met in the forest.', 0, 0));
        const stOnly = await ask();
        await page.evaluate(async ([B, name]) => {
            const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const S = await import(`${B}/src/store.js`);
            const d = { entries: {} };
            const chat = String(globalThis.SillyTavern.getContext().getCurrentChatId());
            const w = W.newWorldEntry(d, 'chapter'); Object.assign(w, { name: 'At the market', span: { chat, from: 1, to: 3 } }); Object.assign(w.fields, { summary: 'Hale asked you to sail OWNMARK', when: 'Day 3' }); W.writeWorldEntry(d, w);
            const id = await K.createSet(name, 'world', d, ''); W.setChatWorld(id);
            S.settings().summary.on = true;
        }, [L.BASE, 'Close world ' + t]);
        L.mode({ reply: PROSE });
        await send(page, 'hello');
        const own = await ask();
        const labels = await page.evaluate(async (B) => { const W = await import(`${B}/src/writer.js`); return { label: W.CONTEXT_PARTS.find(p => p[0] === 'summary')[1], found: !!W.findSummary() }; }, L.BASE);
        await page.evaluate(async (B) => { globalThis.SillyTavern.getContext().setExtensionPrompt('1_memory', '', 0, 0); (await import(`${B}/src/store.js`)).settings().summary.on = false; }, L.BASE);
        assert(!/Summary of the story so far/.test(none) && /Summary of the story so far: STMARK they met in the forest\./.test(stOnly), 'writer: with no chapters, a summary kept by SillyTavern is shown to the AI writer, and with neither nothing is');
        assert(/Summary of the story so far: At the market \(Day 3\): Hale asked you to sail OWNMARK\./.test(own) && !/STMARK/.test(own) && labels.found && /your chapters/.test(labels.label), 'writer: with chapters in the story world, the extension\'s own story so far is shown to the AI writer in place of SillyTavern\'s summary');

        await L.setSettings(page, { perReply: 0, check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' }, writer: { eventScene: false } });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
