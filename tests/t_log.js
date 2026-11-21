// 4.1.0: flags instead of blocks, the false alarm from the tablet, failure reasons, and the Log tab.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const click = (page, text, root = '#ri_root') => page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text) || [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]);
const setField = (page, label, value) => page.evaluate(([label, value]) => { const f = [...document.querySelectorAll('#ri_root .ri-field')].find(x => x.querySelector('.ri-label')?.textContent.trim().toLowerCase() === label.toLowerCase()); if (!f) throw new Error('no field ' + label); const el = f.querySelector('input,textarea,select'); el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [label, value]);
const write = (page, { count = 5, existing = [] } = {}) => page.evaluate(async ([B, count, existing]) => {
    const W = await import(`${B}/src/writer.js`); const K = await import(`${B}/src/books.js`); const S = await import(`${B}/src/store.js`);
    const ins = K.newInstruction({ entries: {} }); ins.name = 'Test'; ins.versions = existing.map(text => ({ text, keep: false }));
    try { const r = await W.writeVersions({ ins, seed: 'The character compliments the user.', count, context: S.settings().writer.context }); return { ok: true, n: r.length }; }
    catch (e) { return { ok: false, message: e.message }; }
}, [L.BASE, count, existing]);
const log = (page) => page.evaluate(async (B) => (await import(`${B}/src/log.js`)).logEntries(), L.BASE);
const clearLog = (page) => page.evaluate(async (B) => (await import(`${B}/src/log.js`)).clearLog(), L.BASE);
(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 800, height: 1280 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { writer: { moreRoom: false } });
        await L.openChat(page); L.resetLog(); await clearLog(page);

        // ----- flags
        const v = await page.evaluate(async (B) => { const V = await import(`${B}/src/validate.js`); const c = t => { const r = V.validateVersion(t); return r.checks.length + r.blocks.length * 10; };
            const clean = ['The bridge under {{user}} must crack and splinter, timbers snapping with sharp reports.', 'A sudden collapse of the cavern ceiling must rain stone down onto {{user}}, blocking the passage behind {{user.them}}.', 'The floor beneath {{user}} gives way.', '{{char}} must ask what {{user}} wants.', 'A messenger must arrive before {{user}} can react.', '{{char}} must set the cup where {{user}} can see it.', '{{char}} must make {{user}} laugh.', '{{char}} must stay close when {{user}} leaves the room.', 'Someone {{user}} knows must walk in.', '{{char}} must take {{user}} by the hand.'];
            const flagged = ['{{user}} decides to kiss {{char}}.', '{{user}} must open the door.', '{{char}} and {{user}} must dance.', '{{char}} must make {{user}} say yes.', '{{char}} smiles. {{user}} smiles back.', '{{char}} must describe {{user}}\'s thoughts.'];
            return { clean: clean.map(c), flagged: flagged.map(c), empty: c('   '), drives: ["{{user}}", "{{user}} alone", "{{user}}'s landlord", "a stranger who knows {{user}}"].map(V.userDrives) }; }, L.BASE);
        console.log(JSON.stringify(v));
        assert(v.clean.every(n => n === 0), 'flag: {{user}} as the place or the target is clean (bridge from the tablet screenshot, "what {{user}} wants", "before {{user}} can react", "make {{user}} laugh")');
        assert(v.flagged.every(n => n === 1), 'flag: {{user}} as the subject of the order is a "Check" flag and blocks nothing');
        assert(v.empty === 10, 'flag: only an empty version is a hard stop');
        assert(JSON.stringify(v.drives) === '[true,true,false,false]', 'flag: in a driver list only {{user}} themself is flagged, "{{user}}\'s landlord" is clean');

        // ----- failure reasons
        L.mode({ writerNeedsRoom: 999999 });
        let r = await write(page);
        console.log('empty:', r.message);
        assert(!r.ok && /empty answer/.test(r.message) && /retry with more room could not produce an answer/.test(r.message) && /Log tab/.test(r.message), 'reason: an empty answer says so, and says a second try was made');
        let e = await log(page);
        assert(e.length === 2 && e.every(x => x.ok === false) && /second try/.test(e[0].what) && e[1].details.some(d => /Room for the answer: \d+ tokens/.test(d)) && /compliments the user/.test(e[1].sent), 'log: both tries are logged with room, connection and what was sent');
        const rooms = L.requests().filter(q => /Return only a JSON list of strings/.test(L.text(q))).map(q => q.max_tokens);
        console.log('rooms asked for:', rooms);
        assert(rooms.length === 2 && rooms[1] > rooms[0] * 2, 'retry: the second try asks for more room');

        await clearLog(page); L.mode({ writer: '<think>I should think about this for a very long time and never finish' });
        r = await write(page);
        console.log('thinking:', r.message);
        assert(!r.ok && /spent its whole room for the answer \(\d+ tokens\) on thinking/.test(r.message), 'reason: an answer that is only thinking says the room ran out');

        await clearLog(page); L.mode({ writer: '{"oops": 1}' });
        r = await write(page);
        console.log('unreadable:', r.message);
        assert(!r.ok && /no versions could be read/.test(r.message) && /It began: "\{"oops": 1\}"/.test(r.message), 'reason: an unreadable answer shows how it began');
        e = await log(page);
        assert(e.length === 1 && e[0].ok === false && e[0].got.includes('oops') && /no versions could be read/.test(e[0].result), 'log: the whole answer is kept with the reason');

        await clearLog(page); L.mode({ writer: JSON.stringify(['{{char}} must pay {{user}} a compliment.', '{{char}} must smile at {{user}}.']) });
        r = await write(page, { existing: ['{{char}} must pay {{user}} a compliment.', '{{char}} must smile at {{user}}.'] });
        console.log('same:', r.message);
        assert(!r.ok && /wrote 2 versions, and every one matches a version this instruction already has/.test(r.message), 'reason: all duplicates says so');

        // ----- a second try that works turns "more room" on
        await clearLog(page); L.mode({ writerNeedsRoom: 2000 });
        r = await write(page);
        const more = await page.evaluate(async (B) => (await import(`${B}/src/store.js`)).settings().writer.moreRoom, L.BASE);
        e = await log(page);
        console.log('retry worked:', JSON.stringify(r), 'moreRoom', more, e.map(x => `${x.what} ${x.ok}`));
        assert(r.ok && r.n === 5 && more === true && e[0].ok === true && /second try/.test(e[0].what) && e[1].ok === false, 'retry: an empty first answer is fixed by a second try, and "more room" turns itself on');
        r = await write(page);
        e = await log(page);
        assert(r.ok && e[0].ok === true && !/second try/.test(e[0].what), 'retry: with "more room" on, the first try is enough');

        // ----- Log tab
        await click(page, 'Expand');
        await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-tab')].find(t => t.textContent === 'Log').click());
        await page.waitForTimeout(300);
        const tab = await page.evaluate(() => ({ cards: document.querySelectorAll('#ri_root .ri-fold').length, failed: document.querySelectorAll('#ri_root .ri-log-failed').length, buttons: [...document.querySelectorAll('#ri_root .ri-body button')].map(b => b.textContent) }));
        console.log(JSON.stringify(tab));
        assert(tab.cards === 3 && tab.failed === 1 && tab.buttons.includes('Copy the log') && tab.buttons.includes('Clear the log'), 'Log tab: one card per request, failed ones marked');
        await page.evaluate(() => document.querySelector('#ri_root .ri-log-failed summary').click());
        await page.screenshot({ path: '/tmp/s_log.png' });
        const text = await page.evaluate(async (B) => (await import(`${B}/src/log.js`)).logText(), L.BASE);
        assert(/--- What was sent ---/.test(text) && /--- What came back ---/.test(text) && /Failed/.test(text), 'Log tab: the copied text holds what was sent and what came back');

        // ----- a flagged version can be ticked, added and saved
        L.mode({ writer: JSON.stringify(['{{char}} must pay {{user}} a compliment about {{user.their}} work.', '{{char}} must ask what {{user}} wants.', 'User decides to kiss Seraphina.', '{{char}} must take {{user}} by the hand.', '{{char}} must tell {{user}} one thing {{char.they}} admires.']) }); await L.setSettings(page, { writer: { moreRoom: false } });
        const name = 'Flag set ' + Date.now();
        await page.evaluate(async ([B, name]) => { const M = await import(`${B}/src/books.js`); await M.createSet(name); const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'instructions'; P.app.cache = {}; P.app.go({ view: 'set', name }); }, [L.BASE, name]);
        await page.waitForTimeout(500);
        await click(page, 'Add instruction'); await page.waitForTimeout(300);
        await setField(page, 'Name of this instruction', 'Flagged');
        await click(page, 'Write versions with AI'); await page.waitForTimeout(300);
        await setField(page, 'What should happen', 'Anything.');
        await setField(page, 'How many versions to write', '5');
        await click(page, 'Write the versions');
        await page.waitForFunction(() => document.querySelectorAll('#ri_root .ri-sheet .ri-version').length > 0, null, { timeout: 20000 });
        const before = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-sheet .ri-version')].map(x => ({ t: x.querySelector('.ri-vbody').textContent.slice(0, 40), checked: x.querySelector('input').checked, disabled: x.querySelector('input').disabled, check: !!x.querySelector('.ri-flag-check'), cls: x.className })));
        console.log(JSON.stringify(before));
        const idx = before.findIndex(x => x.check);
        assert(idx >= 0 && !before[idx].checked && !before[idx].disabled && /ri-version-flagged/.test(before[idx].cls), 'review: the flagged version is unticked and can be ticked');
        await page.screenshot({ path: '/tmp/s_flag.png' });
        await page.evaluate((i) => document.querySelectorAll('#ri_root .ri-sheet .ri-version')[i].querySelector('input').click(), idx);
        await click(page, 'Add the ticked versions'); await page.waitForTimeout(300);
        await click(page, 'Save instruction'); await page.waitForTimeout(1200);
        const saved = await page.evaluate(async (name) => { const d = await globalThis.SillyTavern.getContext().loadWorldInfo(name); const en = Object.values(d.entries)[0]; return en ? en.extensions.ri.versions.map(x => x.text) : null; }, name);
        console.log('saved:', JSON.stringify(saved));
        assert(saved && saved.length === 5 && saved.some(t => /^\{\{user\}\} decides/.test(t)), 'save: an instruction with a flagged version saves');

        // ----- the reply check is logged
        await page.evaluate(() => [...document.querySelectorAll('#ri_root button')].find(b => b.textContent === 'Close full screen').click());
        await clearLog(page);
        await L.makeSet(page, 'Log check ' + Date.now(), [{ name: 'One', versions: ['A1'] }]);
        await L.send(page, 'Hello'); await L.waitChecks(page);
        e = await log(page);
        console.log(e.map(x => `${x.what} | ${x.ok} | ${x.result}`));
        assert(e.some(x => x.what === 'Check that it happened' && x.ok === true && /marked 1 of 1 instruction as done/.test(x.result)), 'log: the check after a reply is logged with its result');
        // ----- the line about {{user}}'s words is said once per reply
        await L.makeSet(page, 'Once ' + Date.now(), [{ name: 'A', versions: ['A1'] }, { name: 'B', versions: ['B1'] }, { name: 'C', versions: ['C1'] }]);
        L.resetLog(); await L.send(page, 'Again'); await L.waitChecks(page);
        const req = L.chatRequests().slice(-1)[0];
        const said = (L.text(req).match(/theirs to write/g) || []).length;
        const got = L.marks(req).sort().join('');
        const recs = (await L.records(page)).slice(-1)[0].rec.items.map(x => /theirs to write\.\]$/.test(x.text));
        console.log('user line said', said, 'times; notes', got, recs);
        assert(said === 1 && got === 'A1B1C1' && recs.filter(Boolean).length === 1 && recs[recs.length - 1] === true, 'once: three notes in one reply carry the line about {{user}} once, on the last note, and What Was Sent shows the same');
        await page.evaluate(() => globalThis.SillyTavern.getContext().swipe.right()); await L.idle(page); await L.waitChecks(page);
        const req2 = L.chatRequests().slice(-1)[0];
        assert((L.text(req2).match(/theirs to write/g) || []).length === 1 && L.marks(req2).sort().join('') === 'A1B1C1', 'once: a swipe sends the same three notes with the line once');
        // ----- SillyTavern counting tokens (a dry run) in the middle of a reply must not change what is sent
        await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); globalThis.__dry = 0; c.eventSource.on(c.eventTypes.GENERATION_STARTED, (type, opts, dry) => { if (!dry) { globalThis.__dry++; c.generate('normal', {}, true).catch(() => {}); } }); });
        let agree = 0, once = 0;
        for (let i = 0; i < 5; i++) {
            L.resetLog(); await L.send(page, 'Race ' + i); await L.waitChecks(page);
            const rq = L.chatRequests().slice(-1)[0];
            const sent = (L.text(rq).match(/\[System note: In this reply,[^\]]*\]/g) || []).sort().join('|');
            const rec = (await L.records(page)).slice(-1)[0].rec;
            const kept = (rec ? rec.items.map(x => x.text) : []).sort().join('|');
            if (sent && sent === kept) agree++;
            if ((L.text(rq).match(/theirs to write/g) || []).length === 1) once++;
        }
        const dry = await page.evaluate(() => globalThis.__dry);
        console.log('dry runs started during replies:', dry, 'record equals request:', agree, 'of 5; line once:', once, 'of 5');
        assert(dry >= 5 && agree === 5 && once === 5, 'dry run during a reply: the record on the reply is exactly what was sent, every time');
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
