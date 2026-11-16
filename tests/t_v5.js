// 5.0: one new thing per reply across every module, and burn after it happens.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const setGoal = (page, g) => page.evaluate(async ({ BASE, g }) => { const G = await import(`${BASE}/src/goals.js`); const cur = G.goals(); Object.assign(cur, G.blankGoal(), { on: true, goal: '{{char}} wants {{user}} to trust {{char.them}}' }, g);
    cur.steps = (g.steps || []).map(k => ({ id: 'id' + k, text: `do thing ${k} to {{user}}`, on: true })); cur.actions = (g.actions || []).map(k => ({ id: 'id' + k, text: `do thing ${k} to {{user}}`, on: true })); G.saveGoals(); }, { BASE: L.BASE, g });
const active = (page, names) => page.evaluate(async ([B, names]) => { const S = await import(`${B}/src/store.js`); const cs = S.chatState(); cs.activeSets = names; S.saveChatState(); }, [L.BASE, names]);
const sendAndMarks = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); const rq = L.chatRequests().slice(-1)[0]; return { marks: L.marks(rq), text: L.text(rq) }; };
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1200 });
    try {
        await L.setupApi(page);
        const def = await page.evaluate(async (B) => { const S = await import(`${B}/src/store.js`); delete S.settings().perReply; return S.settings().perReply; }, L.BASE);
        assert(def === 1, 'cap: the default is one new thing per reply');
        await L.openChat(page);
        const t = Date.now();
        // ----- A. two sets, five instructions all at 100%
        await L.makeSet(page, 'Cap A ' + t, [{ name: 'A', versions: ['A1'] }, { name: 'B', versions: ['B1'] }, { name: 'C', versions: ['C1'] }]);
        await L.makeSet(page, 'Cap B ' + t, [{ name: 'D', versions: ['D1'] }, { name: 'E', versions: ['E1'] }]);
        await active(page, ['Cap A ' + t, 'Cap B ' + t]);
        await L.setSettings(page, { perReply: 1 });
        const one = []; for (let i = 0; i < 4; i++) one.push((await sendAndMarks(page, 'one ' + i)).marks);
        console.log('cap 1:', JSON.stringify(one));
        assert(one.every(m => m.length === 1) && new Set(one.flat()).size >= 2, 'cap 1: five instructions are ready, exactly one goes out each reply, and different ones get a turn');
        await L.setSettings(page, { perReply: 2 });
        const two = (await sendAndMarks(page, 'two')).marks;
        await L.setSettings(page, { perReply: 0 });
        const all = (await sendAndMarks(page, 'all')).marks;
        assert(two.length === 2 && all.length === 5, 'cap 2 sends two; cap 0 (off) sends all five');

        // ----- B. something kept for more replies uses up the room
        await L.openChat(page);
        await L.makeSet(page, 'Cap K ' + t, [{ name: 'K', versions: ['K1'], keep: 2 }]);
        await L.makeSet(page, 'Cap N ' + t, [{ name: 'N', versions: ['N1'] }]);
        await L.setSettings(page, { perReply: 0 });
        await active(page, ['Cap K ' + t]);
        const k0 = (await sendAndMarks(page, 'k0')).marks;               // K starts
        await active(page, ['Cap K ' + t, 'Cap N ' + t]);
        await L.setSettings(page, { perReply: 1 });
        const k1 = (await sendAndMarks(page, 'k1')).marks; const k2 = (await sendAndMarks(page, 'k2')).marks;
        console.log('kept:', JSON.stringify([k0, k1, k2]));
        assert(k0.join() === 'K1' && k1.join() === 'K1' && k2.join() === 'K1', 'cap: an instruction that is kept for two more replies goes alone until it ends');

        // ----- C. the goal task counts, the goal line does not
        await L.openChat(page);
        await L.makeSet(page, 'Cap G ' + t, [{ name: 'G', versions: ['G1'] }]);
        await active(page, ['Cap G ' + t]);
        await setGoal(page, { chance: 100, waitMin: 0, waitMax: 0, steps: [], actions: ['T1', 'T2'] });
        const mixed = []; let lines = 0;
        for (let i = 0; i < 6; i++) { const r = await sendAndMarks(page, 'goal ' + i); mixed.push(r.marks); if (/wants User to trust/.test(r.text)) lines++; }
        console.log('goal and instruction:', JSON.stringify(mixed), 'goal line in', lines, 'of 6');
        assert(mixed.every(m => m.length === 1) && lines === 6, 'cap 1 with a goal: each reply has one thing (the instruction or a goal task), and the goal line goes with every reply');
        await setGoal(page, { on: false, chance: 0, steps: [], actions: [] });

        // ----- D. only once per chat
        await L.openChat(page);
        await L.setSettings(page, { perReply: 0 });
        const once = 'Once ' + t;
        await L.makeSet(page, once, [{ name: 'X', versions: ['X1'] }, { name: 'Y', versions: ['Y1'] }]);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const d = await K.loadSet(name); const e = Object.values(d.entries).find(x => /X/.test(x.comment)); const ins = K.readInstruction(e); ins.once = true; K.writeInstruction(d, ins); await K.saveSet(name, d); }, [L.BASE, once]);
        await active(page, [once]);
        const o = []; for (let i = 0; i < 3; i++) o.push((await sendAndMarks(page, 'once ' + i)).marks.sort().join(''));
        console.log('once:', JSON.stringify(o));
        assert(o[0] === 'X1Y1' && o[1] === 'Y1' && o[2] === 'Y1', 'once: after it happened it is retired, and the other instruction carries on');
        await L.slash(page, '/del 6'); await page.waitForTimeout(600);
        const again = (await sendAndMarks(page, 'again')).marks.sort().join('');
        assert(again === 'X1Y1', 'once: delete the replies where it happened and it can happen again');
        L.mode({ done: false });
        await L.openChat(page); await active(page, [once]);
        const miss = []; for (let i = 0; i < 2; i++) miss.push((await sendAndMarks(page, 'miss ' + i)).marks.includes('X1'));
        L.mode({});
        assert(miss[0] && miss[1], 'once: it is not retired while the check says it has not happened');

        // ----- E. story event items retire once they happened
        await L.openChat(page);
        const evName = 'Burn ' + t;
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/events.js`);
            const ev = E.newEvent(name); Object.assign(ev, { chance: 100, keep: 0, wait: 0, notBefore: 0 });
            ev.categories = [E.newCategory('What happens', ['thing P1 happens nearby', 'thing P2 happens nearby', 'thing P3 happens nearby'], { burn: true }), E.newCategory('Tone', ['calm', 'loud'])];
            const data = { entries: {} }; E.writeEvent(data, ev); await K.createSet(name, 'events', data); }, [L.BASE, evName]);
        await active(page, [evName]);
        const ev = []; for (let i = 0; i < 5; i++) ev.push((await sendAndMarks(page, 'event ' + i)).marks.join(''));
        console.log('events:', JSON.stringify(ev));
        assert(new Set(ev.slice(0, 3)).size === 3 && ev.slice(0, 3).every(x => /^P[123]$/.test(x)) && ev[3] === '' && ev[4] === '', 'burn: three items happen once each, then the event has nothing left and stops');
        const defaults = await page.evaluate(async (B) => (await import(`${B}/src/events.js`)).newEvent('x').categories.map(c => `${c.name}:${c.burn}`), L.BASE);
        assert(defaults.join() === 'Situation:true,Complication:true,What it puts at stake:false,Who drives it:false,Tone:false', 'burn: a new story event set retires its situations and complications by default');
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
