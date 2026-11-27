// 5.1: one world book. Sets kept as groups inside a shared lorebook, per-chat on and off, limits, the cap, burn,
// moving a set in and out without losing versions, timing or what the chats recorded, and the Settings section.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const active = (page, ids) => page.evaluate(async ([B, ids]) => { const S = await import(`${B}/src/store.js`); const cs = S.chatState(); cs.activeSets = ids; S.saveChatState(); }, [L.BASE, ids]);
const sendAndMarks = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); const rq = L.chatRequests().slice(-1)[0]; return { marks: L.marks(rq).sort(), text: L.text(rq) }; };
const click = (page, text, root = '#ri_root') => page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text) || [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]);
/** Make an instruction set through createSet. home: '' = its own lorebook, or a shared lorebook name. */
const makeIn = (page, home, name, instructions, opts = {}) => page.evaluate(async ({ B, home, name, instructions, opts }) => {
    const K = await import(`${B}/src/books.js`);
    const data = { entries: {} };
    instructions.forEach((x, i) => {
        const ins = K.newInstruction(data);
        Object.assign(ins, { name: x.name || `Ins ${i}`, chance: x.chance ?? 100, keep: x.keep ?? 0, wait: x.wait ?? 0, once: !!x.once, sentAs: 'system', versions: x.versions.map(v => ({ text: `{{char}} must do thing ${v} to {{user}}.`, keep: false })) });
        K.writeInstruction(data, ins);
    });
    const id = await K.createSet(name, 'instructions', data, home);
    if (opts.limit) K.patchSet(id, { limit: opts.limit, max: opts.max || 2 });
    return id;
}, { B: L.BASE, home, name, instructions, opts });
const book = (page, name) => page.evaluate(async (name) => JSON.parse(JSON.stringify(await globalThis.SillyTavern.getContext().loadWorldInfo(name))), name);
const worlds = (page) => page.evaluate(() => globalThis.SillyTavern.getContext().getWorldInfoNames());
const chatLore = (page, name) => page.evaluate((name) => { const c = globalThis.SillyTavern.getContext(); if (name) c.chatMetadata.world_info = name; else delete c.chatMetadata.world_info; c.saveMetadata(); }, name);

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        const t = Date.now();
        const S = 'World ' + t;

        // ----- A. where new sets go by default
        const def = await page.evaluate(async (B) => {
            const St = await import(`${B}/src/store.js`); const st = St.settings(); const keep = st.sets;
            st.sets = {}; delete st.home; const fresh = St.settings().home;
            st.sets = { x: {} }; delete st.home; const upgrade = St.settings().home;
            st.sets = keep; st.home = '';
            return { fresh, upgrade, name: St.HOME_BOOK };
        }, L.BASE);
        assert(def.fresh === def.name && def.upgrade === '', 'default: a new install keeps every set in one shared lorebook; an install that already has sets stays as it is');

        // ----- B. four sets of three kinds in one lorebook
        await L.openChat(page);
        const X = await makeIn(page, S, 'Alpha', [{ name: 'A', versions: ['A1'] }, { name: 'B', versions: ['B1'] }]);
        const Y = await makeIn(page, S, 'Beta', [{ name: 'C', versions: ['C1'] }, { name: 'D', versions: ['D1'] }]);
        const made = await page.evaluate(async ([B, S]) => {
            const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`);
            const ev = E.newEvent('Happenings'); Object.assign(ev, { chance: 100, keep: 0, wait: 0, notBefore: 0 });
            ev.categories = [E.newCategory('What happens', ['thing P1 happens nearby', 'thing P2 happens nearby'], { burn: true })];
            const d1 = { entries: {} }; E.writeEvent(d1, ev); const evId = await K.createSet('Happenings', 'events', d1, S);
            const sty = E.newStyle('Voice'); sty.categories = [E.newCategory('Prose style', ['thing S1 in every sentence'], { mode: 'new' })];
            const d2 = { entries: {} }; E.writeEvent(d2, sty); const styId = await K.createSet('Voice', 'style', d2, S);
            return { evId, styId, lists: { instructions: K.knownSets('instructions'), events: K.knownSets('events'), style: K.knownSets('style') } };
        }, [L.BASE, S]);
        const names = await worlds(page);
        let data = await book(page, S);
        const tags = Object.values(data.entries).map(e => e.extensions.ri.set).sort().join();
        console.log('ids:', X, '|', Y, '|', made.evId, '|', made.styId, 'tags:', tags, 'groups:', JSON.stringify(data.extensions.ri.groups));
        assert(names.includes(S) && !['Alpha', 'Beta', 'Happenings', 'Voice'].some(n => names.includes(n)), 'shared: four sets were made and there is one lorebook');
        assert(tags === 'Alpha,Alpha,Beta,Beta,Happenings,Voice' && new Set(Object.keys(data.entries)).size === 6, 'shared: every entry carries its set name, and no two entries share a number');
        assert(data.extensions.ri.shared && Object.keys(data.extensions.ri.groups).sort().join() === 'Alpha,Beta,Happenings,Voice' && data.extensions.ri.groups.Happenings.kind === 'events' && data.extensions.ri.groups.Voice.kind === 'style', 'shared: the lorebook file lists its sets and what kind each is');
        assert(made.lists.instructions.includes(X) && made.lists.instructions.includes(Y) && made.lists.events.includes(made.evId) && made.lists.style.includes(made.styId), 'shared: each set is listed in the tab for its kind');

        // ----- C. on and off per chat, inside one lorebook
        await active(page, [X]);
        const onlyX = (await sendAndMarks(page, 'c1')).marks.join('');
        await active(page, [X, Y]);
        const both = (await sendAndMarks(page, 'c2')).marks.join('');
        await active(page, []);
        const none = (await sendAndMarks(page, 'c3')).marks.join('');
        console.log('on/off:', onlyX, both, JSON.stringify(none));
        assert(onlyX === 'A1B1' && both === 'A1B1C1D1' && none === '', 'shared: a set is on or off per chat by itself, even though it shares its lorebook');

        // ----- D. each set keeps its own limit, and the cap counts across them
        await page.evaluate(async ([B, X]) => { (await import(`${B}/src/books.js`)).patchSet(X, { limit: 'one' }); }, [L.BASE, X]);
        await active(page, [X, Y]);
        const lim = []; for (let i = 0; i < 3; i++) lim.push((await sendAndMarks(page, 'd' + i)).marks.join(''));
        console.log('limit one on Alpha:', JSON.stringify(lim));
        assert(lim.every(m => /^(A1|B1)C1D1$/.test(m)), 'shared: "one per reply" on one set holds that set to one and leaves the other set alone');
        const info = await page.evaluate(async ([B, X]) => (await import(`${B}/src/books.js`)).setInfo(X), [L.BASE, X]);
        assert(info.shared && info.limit === 'one', 'shared: changing a limit keeps where the set lives');
        await page.evaluate(async ([B, X]) => { (await import(`${B}/src/books.js`)).patchSet(X, { limit: 'none' }); }, [L.BASE, X]);
        await L.setSettings(page, { perReply: 1 });
        const cap = []; for (let i = 0; i < 4; i++) cap.push((await sendAndMarks(page, 'cap' + i)).marks);
        await L.setSettings(page, { perReply: 0 });
        console.log('cap 1:', JSON.stringify(cap));
        assert(cap.every(m => m.length === 1) && new Set(cap.flat()).size >= 2, 'shared: with "one thing per reply", one instruction goes out per reply across the sets in the lorebook');

        // ----- E. story events and writing style inside the shared lorebook
        await L.openChat(page);
        await active(page, [made.evId, made.styId]);
        const ev = []; for (let i = 0; i < 3; i++) ev.push((await sendAndMarks(page, 'e' + i)).marks.join(''));
        console.log('event + style:', JSON.stringify(ev));
        assert(new Set([ev[0].replace('S1', ''), ev[1].replace('S1', '')]).size === 2 && /^P[12]S1$/.test(ev[0]) && /^P[12]S1$/.test(ev[1]) && ev[2] === 'S1', 'shared: the event set rolls and retires its items, and the style goes with every reply');

        // ----- F. the shared lorebook attached by World Info itself
        await L.openChat(page);
        // an entry that belongs to no set: plain lore the user keeps in the same lorebook
        await page.evaluate(async ([B, S]) => {
            const c = globalThis.SillyTavern.getContext(); const K = await import(`${B}/src/books.js`);
            const d = await c.loadWorldInfo(S); const uid = K.freeUid(d);
            d.entries[uid] = { ...K.blankEntry(uid), comment: 'Plain lore', content: 'PLAINLORE the harbour bell rings at noon.', constant: true, probability: 100, useProbability: false };
            await c.saveWorldInfo(S, d, true);
        }, [L.BASE, S]);
        await active(page, [X]);
        const notAttached = await sendAndMarks(page, 'f0');
        await chatLore(page, S);
        const attached = await sendAndMarks(page, 'f1');
        console.log('attached:', notAttached.marks.join(''), /PLAINLORE/.test(notAttached.text), '|', attached.marks.join(''), /PLAINLORE/.test(attached.text));
        assert(notAttached.marks.join('') === 'A1B1' && !/PLAINLORE/.test(notAttached.text), 'shared: with the lorebook not attached, only the sets that are on are sent');
        assert(attached.marks.join('') === 'A1B1' && /PLAINLORE/.test(attached.text), 'shared: attached in World Info, plain entries are sent as they are and sets that are off for the chat stay out');
        const recs = (await L.records(page)).filter(r => r.rec);
        assert(recs.slice(-1)[0].rec.items.length === 2, 'shared: the record holds the two instructions and leaves the plain entry alone');
        await L.setSettings(page, { enabled: false });
        const off = await sendAndMarks(page, 'f2');
        await L.setSettings(page, { enabled: true });
        await chatLore(page, '');
        console.log('extension off:', off.marks.join(''));
        assert(['A1', 'B1', 'C1', 'D1'].every(m => off.marks.includes(m)) && /PLAINLORE/.test(off.text) && !/\{\{random|\{\{getvar/.test(off.text), 'shared: with the extension off and the lorebook attached, every entry works as an ordinary lorebook entry');

        // ----- G. move a set from its own lorebook into the shared one: versions, timing and records carry over
        await L.openChat(page);
        const own = 'Mover ' + t;
        const M = await makeIn(page, '', own, [{ name: 'Waiter', versions: ['W1'], wait: 3 }, { name: 'Onetime', versions: ['O1'], once: true }, { name: 'Cycler', versions: ['V1', 'V2', 'V3'] }]);
        assert(M === own && (await worlds(page)).includes(own), 'move: a set made with "a lorebook of its own" has its own lorebook');
        await active(page, [M]);
        const g1 = (await sendAndMarks(page, 'g1')).marks;          // reply 1: W1, O1, one of V
        const g2 = (await sendAndMarks(page, 'g2')).marks;          // reply 2: one of V (W waits, O retired)
        const before = JSON.stringify(await book(page, own));
        const res = await page.evaluate(async ([B, M, S]) => { const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/engine.js`); const r = await K.moveSet(M, S); await E.setsMoved(); return { r, info: K.setInfo(r.id), on: (await import(`${B}/src/store.js`)).chatState().activeSets }; }, [L.BASE, M, S]);
        console.log('moved:', JSON.stringify(res.r), 'active:', JSON.stringify(res.on));
        assert(res.info.shared && res.info.book === S && res.info.name === own && res.on.join() === res.r.id, 'move: the set is now a group in the shared lorebook, and it stays on for the open chat');
        assert(JSON.stringify(await book(page, own)) === before, 'move: the lorebook it came from is left exactly as it was');
        data = await book(page, S);
        const movedEntries = Object.values(data.entries).filter(e => e.extensions?.ri?.set === own);
        const waiter = movedEntries.find(e => /Waiter/.test(e.comment)); const cycler = movedEntries.find(e => /Cycler/.test(e.comment));
        assert(movedEntries.length === 3 && cycler.extensions.ri.versions.length === 3 && waiter.cooldown === JSON.parse(before).entries[0].cooldown && movedEntries.every(e => e.extensions.ri.was.length === 1 && e.extensions.ri.was[0].startsWith(own + '.')), 'move: every entry is copied whole (versions and timing) and remembers the key it had');
        const g3 = (await sendAndMarks(page, 'g3')).marks;          // reply 3: W still waiting
        const g4 = (await sendAndMarks(page, 'g4')).marks;          // reply 4: W still waiting
        const g5 = (await sendAndMarks(page, 'g5')).marks;          // reply 5: W is back
        console.log('timeline:', JSON.stringify([g1, g2, g3, g4, g5]));
        const vs = [g1, g2, g3].map(m => m.find(x => /^V/.test(x)));
        assert(g1.includes('W1') && !g2.includes('W1') && !g3.includes('W1') && !g4.includes('W1') && g5.includes('W1'), 'move: a wait that started before the move is still counted after it (sent at reply 1, back at reply 5)');
        assert(g1.includes('O1') && [g2, g3, g4, g5].every(m => !m.includes('O1')), 'move: an "only once" instruction that happened before the move stays retired after it');
        assert(new Set(vs).size === 3, 'move: versions keep taking turns across the move (three replies, three different versions): ' + vs.join());
        // a swipe right after a move repeats the same instructions
        const lastMarks = g5.join();
        L.resetLog(); await L.swipe(page); await L.waitChecks(page);
        const sw = L.marks(L.chatRequests().slice(-1)[0]).sort().join();
        assert(sw === lastMarks, 'move: a swipe after the move repeats the same instructions: ' + sw);

        // a second chat that had the set on under its old name
        await L.openChat(page);
        await active(page, [M]);                                   // the old id, as an older chat would have it
        await page.evaluate(async (B) => { await (await import(`${B}/src/engine.js`)).setsMoved(); }, L.BASE);
        const older = await page.evaluate(async (B) => (await import(`${B}/src/store.js`)).chatState().activeSets, L.BASE);
        const o1 = (await sendAndMarks(page, 'h1')).marks;
        assert(older.join() === res.r.id && o1.includes('W1') && o1.includes('O1'), 'move: a chat that had the set on under its old name still has it on, and starts fresh');

        // ----- H. move it out again, into a lorebook of its own
        const out = await page.evaluate(async ([B, id]) => { const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/engine.js`); const r = await K.moveSet(id, ''); await E.setsMoved(); return { r, info: K.setInfo(r.id), on: (await import(`${B}/src/store.js`)).chatState().activeSets }; }, [L.BASE, res.r.id]);
        data = await book(page, S);
        const outBook = await book(page, out.r.id);
        console.log('moved out:', out.r.id, 'entries left with its tag:', Object.values(data.entries).filter(e => e.extensions?.ri?.set === own).length);
        assert(!out.info.shared && out.r.id === own + ' 2' && out.on.join() === out.r.id, 'move out: the set gets a lorebook of its own (the spare copy keeps the old name), and stays on');
        assert(!Object.values(data.entries).some(e => e.extensions?.ri?.set === own) && !data.extensions.ri.groups[own] && Object.keys(data.extensions.ri.groups).length === 4, 'move out: its entries and its name are gone from the shared lorebook, and the other sets are untouched');
        assert(Object.keys(outBook.entries).length === 3 && Object.values(outBook.entries).every(e => !e.extensions.ri.set && e.extensions.ri.was.length === 2), 'move out: three entries, no set name on them, both earlier keys remembered');
        const o2 = (await sendAndMarks(page, 'h2')).marks;
        assert(!o2.includes('W1') && !o2.includes('O1') && o2.some(x => /^V/.test(x)), 'move out: the wait and the retired instruction carry on after the second move');

        // ----- I. edits made in the panel keep an entry in its set
        const edit = await page.evaluate(async ([B, X]) => {
            const K = await import(`${B}/src/books.js`);
            const d = await K.loadSet(X);
            const list = K.listInstructions(d, X);
            const ins = list[0]; ins.versions.push({ text: '{{char}} must do thing A2 to {{user}}.', keep: false }); K.writeInstruction(d, ins, X);
            const add = K.newInstruction(d, X); add.name = 'New one'; add.versions = [{ text: '{{char}} must do thing N1 to {{user}}.', keep: false }]; K.writeInstruction(d, add, X);
            await K.saveSet(X, d);
            const d2 = await K.loadSet(X);
            const exp = await K.exportSet(X);
            return { count: list.length, after: K.listInstructions(d2, X).map(i => i.name), suggested: add.name === 'New one', tag: d2.entries[add.uid].extensions.ri.set, total: Object.keys(d2.entries).length,
                exp: { n: Object.keys(exp.entries).length, uids: Object.keys(exp.entries).join(), tagged: Object.values(exp.entries).some(e => e.extensions.ri.set), kind: exp.extensions.ri.kind, shared: !!exp.extensions.ri.shared } };
        }, [L.BASE, X]);
        console.log('edit:', JSON.stringify(edit));
        assert(edit.count === 2 && edit.after.length === 3 && edit.tag === 'Alpha', 'edit: a set lists only its own instructions, and a new instruction is saved into its set');
        assert(edit.exp.n === 3 && edit.exp.uids === '0,1,2' && !edit.exp.tagged && !edit.exp.shared && edit.exp.kind === 'instructions', 'export: one set from a shared lorebook exports as a lorebook file of its own');

        // ----- J. remove from the list, then open the shared lorebook again
        const back = await page.evaluate(async ([B, Y, S]) => {
            const K = await import(`${B}/src/books.js`);
            K.forgetSet(Y);
            const gone = !K.knownSets('instructions').includes(Y);
            const added = await K.adoptSet(S);
            return { gone, added, here: K.knownSets('instructions').includes(Y), info: K.setInfo(Y) };
        }, [L.BASE, Y, S]);
        assert(back.gone && back.added.join() === Y && back.here && back.info.shared, 'open: a set removed from the list comes back when its shared lorebook is opened, and sets already listed are not added twice');
        const clash = await page.evaluate(async ([B, S]) => { const K = await import(`${B}/src/books.js`); try { await K.createSet('Alpha', 'instructions', { entries: {} }, S); return 'made'; } catch (e) { return e.message; } }, [L.BASE, S]);
        assert(/already in the shared World Info book/.test(clash), 'create: a second set with the same name in the same lorebook is refused with a reason: ' + clash);

        // ----- K. the panel
        await L.setSettings(page, { home: S });
        await L.openPanel(page);
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'set-rules'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(400);
        const ui = await page.evaluate(([S, own2]) => {
            const sec = [...document.querySelectorAll('#ri_root .ri-section, #ri_root details, #ri_root section')].reverse().find(s => /Where your sets are kept/.test(s.textContent) && s.querySelector('.ri-where'));
            const rows = [...sec.querySelectorAll('.ri-where')].map(r => ({ name: r.querySelector('.ri-where-name').firstChild.textContent, kind: r.querySelector('.ri-where-kind').textContent, value: r.querySelector('select').value }));
            return { home: sec.querySelector('select').value, mine: rows.filter(r => (['Alpha', 'Beta', 'Happenings', 'Voice'].includes(r.name) && r.value === S) || r.name === own2), moveAll: [...sec.querySelectorAll('button')].map(b => b.textContent).find(x => /^Move all/.test(x)) || '' };
        }, [S, out.r.id]);
        console.log('settings:', JSON.stringify(ui));
        assert(ui.home === S && ui.mine.length === 5 && ui.mine.filter(r => r.value === S).length === 4 && ui.mine.find(r => r.name === out.r.id).value === '', 'panel: Settings shows where new sets go and where each set is kept');
        assert(/^Move all/.test(ui.moveAll), 'panel: a button offers to move the sets that are elsewhere into the shared lorebook');
        await page.evaluate(() => { const sec = [...document.querySelectorAll('#ri_root .ri-section, #ri_root details, #ri_root section')].reverse().find(s => /Where your sets are kept/.test(s.textContent) && s.querySelector('.ri-where')); sec.scrollIntoView(); });
        await page.screenshot({ path: '/tmp/s51_where.png' });
        // move one set with the control in Settings
        await page.evaluate(([name, S]) => { const row = [...document.querySelectorAll('#ri_root .ri-where')].find(r => r.querySelector('.ri-where-name').firstChild.textContent === name); const sel = row.querySelector('select'); sel.value = S; sel.dispatchEvent(new Event('change', { bubbles: true })); }, [out.r.id, S]);
        await page.waitForFunction((name) => { const row = [...document.querySelectorAll('#ri_root .ri-where')].find(r => r.querySelector('.ri-where-name').firstChild.textContent === name); return row && row.querySelector('select').value !== ''; }, out.r.id, { timeout: 10000 });
        const afterUi = await page.evaluate(async ([B, S, own2]) => { const K = await import(`${B}/src/books.js`); return K.knownSets('instructions').map(K.setInfo).filter(i => i.name === own2).map(i => `${i.book}|${i.name}|${i.was.length}`); }, [L.BASE, S, out.r.id]);
        console.log('moved with the control:', JSON.stringify(afterUi));
        assert(afterUi.length === 1 && afterUi[0].startsWith(S + '|'), 'panel: choosing a lorebook in Settings moves the set there');
        // a new set made with the panel's own button goes into the shared lorebook
        await L.addSet(page, 'instructions', 'Made in panel');
        await page.waitForFunction(() => document.querySelector('#ri_root .ri-h2')?.textContent === 'Made in panel' && /Kept in the shared World Info book/.test(document.querySelector('#ri_root .ri-kept')?.textContent || ''), null, { timeout: 8000 });
        const panelMade = await page.evaluate(async ([B, S]) => { const K = await import(`${B}/src/books.js`); const P = await import(`${B}/src/ui/panel.js`); return { route: P.app.route.name, info: K.setInfo(P.app.route.name), kept: document.querySelector('#ri_root .ri-kept').textContent, title: document.querySelector('#ri_root .ri-h2').textContent }; }, [L.BASE, S]);
        console.log('panel set:', JSON.stringify(panelMade));
        assert(panelMade.info.shared && panelMade.info.book === S && panelMade.title === 'Made in panel' && panelMade.kept.includes(S), 'panel: "Add instruction set" puts the new set into the shared lorebook and the card says where it is kept');
        await page.screenshot({ path: '/tmp/s51_set.png' });
        assert(!(await worlds(page)).includes('Made in panel'), 'panel: no extra lorebook was made for it');
        // delete a set that lives in the shared lorebook, with the panel's button
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'instructions'; P.app.go({ view: 'sets' }); }, L.BASE);
        await page.waitForTimeout(400);
        const nBefore = Object.keys((await book(page, S)).entries).length;
        await page.evaluate((S) => { const card = [...document.querySelectorAll('#ri_root .ri-setcard')].find(c => c.querySelector('.ri-card-name')?.textContent === 'Made in panel' && c.querySelector('.ri-kept')?.textContent.includes(S)); [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete this set').click(); }, S);
        await page.waitForSelector('dialog[open] .popup-button-ok', { timeout: 5000 });
        await page.click('dialog[open] .popup-button-ok');
        await page.waitForFunction((S) => ![...document.querySelectorAll('#ri_root .ri-setcard')].some(c => c.querySelector('.ri-card-name')?.textContent === 'Made in panel' && c.querySelector('.ri-kept')?.textContent.includes(S)), S, { timeout: 8000 });
        data = await book(page, S);
        await makeIn(page, '', 'Standalone deletion ' + t, [{versions:['Z1']}]);
        await page.evaluate(async B => (await import(`${B}/src/ui/panel.js`)).app.render(), L.BASE);
        const ownHasDelete = await page.evaluate(() => { const card = [...document.querySelectorAll('#ri_root .ri-setcard')].find(c => /Kept in a World Info book of its own/.test(c.textContent)); return card && [...card.querySelectorAll('button')].some(b => b.textContent.trim() === 'Delete this set'); });
        assert(!data.extensions.ri.groups['Made in panel'] && data.extensions.ri.groups.Alpha && Object.keys(data.entries).length === nBefore, 'delete: "Delete this set" removes the set from the shared lorebook and leaves the other sets alone');
        assert(ownHasDelete, 'delete: a set with a lorebook of its own also offers the delete control');
        await L.setSettings(page, { home: '' });
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
