// Story event items that need an open thread or a kept secret, in a chat whose memory lives in chat data, on a real
// SillyTavern host with the mock model. Reply 1: with an open thread on file the thread item rolls and the request carries
// that thread's text; a paused thread is never used; the secret item waits while nobody is listed in the scene. Reply 2:
// the scene lists Hale, so his secret fills the secret item; the thread is done, so the thread item waits. No extra
// model call. Set RI_WIDTH (390 or 1006) and RI_EVIDENCE for memory-offers-<width>.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = 900;
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;
const out = { width: WIDTH, checks: [], dumps: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };

const OPEN = 'THREAD_ALPHA nobody knows who sent the unsigned letter';
const SECRET = 'SECRET_ALPHA Hale owes the guild a hundred crowns';
const PAUSED = 'THREAD_PAUSED the harvest fair opens on the fifth day';
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const replyRequests = () => L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || ''));
const lastReplyText = () => (replyRequests().at(-1)?.messages || []).map(textOf).join('\n');
// The story event orders in a request (recall may still list a paused thread: it stays on file).
const eventNotes = text => (text.match(/\[System note: In this reply, an event must happen[^\]]*\]/g) || []).join('\n');
const lineWith = (text, mark) => (text.match(new RegExp(`[^\\n]*${mark}[^\\n]*`)) || ['none'])[0].slice(0, 300);
const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running; }, B); if (!busy) break; } await page.waitForTimeout(1500); };
const turn = async (page, text) => { await L.send(page, text); await settle(page); };
const addRecords = (page, list) => page.evaluate(async ({ B, list }) => {
    const S = await import(`${B}/src/memory/store.js`);
    return S.memoryStore().record(list.map(record => ({ op: record.op || 'add', ...(record.target ? { target: record.target } : {}), record: { status: 'current', aliases: [], ...record.record }, origin: { type: 'you' }, reason: 'Seeded by the suite.' })));
}, { B, list });
const storedItems = page => page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); const m = [...c.chat].reverse().find(x => !x.is_user); return JSON.stringify(m?.extra?.roleplay_instructions?.items || []); });

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        await page.evaluate(async B => (await import(`${B}/src/prompts.js`)).restorePrompt('event'), B);
        await L.setSettings(page, { showUnder: 'off', check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        const world = await page.evaluate(async B => (await import(`${B}/src/world.js`)).chatWorld(), B);
        check('the chat keeps its memory in chat data, with no Story World book', !world, world);
        const seeded = await addRecords(page, [
            { record: { id: 'letter', kind: 'thread', threadType: 'Plotline', subject: 'Hale', text: OPEN, endsWhen: 'when Hale learns who sent it' } },
            { record: { id: 'fair', kind: 'thread', threadType: 'Seed', subject: 'Hale', text: PAUSED, paused: true } },
            { record: { id: 'debt', kind: 'secret', subject: 'Hale', holders: ['Hale'], text: SECRET } },
        ]);
        check('an open thread, a paused thread and a secret are filed', seeded?.committed, String(seeded?.entries?.length));
        // Two story event sets: one whose item needs an open thread, one whose item needs a kept secret.
        await page.evaluate(async B => {
            const E = await import(`${B}/src/events.js`); const Bk = await import(`${B}/src/books.js`); const S = await import(`${B}/src/store.js`);
            const make = async (name, cat, text, need) => {
                const ev = E.newEvent(name);
                Object.assign(ev, { chance: 100, wait: 0, keep: 0 });
                const c = E.newCategory(cat, [text]);
                c.items[0].need = need;
                ev.categories = [c];
                const data = { entries: {} }; E.writeEvent(data, ev);
                await Bk.createSet(name, 'events', data);
                return name;
            };
            const stamp = Date.now();
            const names = [await make(`Threads ${stamp}`, 'Hook', 'EVENT_OMEGA turns on [thread].', 'thread'), await make(`Secrets ${stamp}`, 'Hidden', 'SECRET_OMEGA presses on [secret].', 'secret')];
            const cs = S.chatState(); cs.activeSets = names; S.saveChatState();
        }, B);

        // ------------------------------------------------------------ reply 1: the thread item rolls, filled with the open thread
        L.resetLog();
        await turn(page, 'I read the letter again.');
        const first = lastReplyText();
        out.dumps.first = { thread: lineWith(first, 'EVENT_OMEGA'), secret: lineWith(first, 'SECRET_OMEGA') };
        check('the item that needs an open thread rolls', first.includes('EVENT_OMEGA'), out.dumps.first.thread);
        check('it is filled with the open thread text and its ends-when line', first.includes(`EVENT_OMEGA turns on the open matter (${OPEN}; it ends when Hale learns who sent it)`), out.dumps.first.thread);
        check('the paused thread is not used by any event', !eventNotes(first).includes('THREAD_PAUSED'), '');
        check('the secret item waits while nobody is listed in the scene', !first.includes('SECRET_OMEGA'), out.dumps.first.secret);
        let kinds = L.requests('all').map(r => r.kind);
        check('the reply makes only the reply and its capture', kinds.filter(k => k === 'reply').length === 1 && kinds.every(k => ['reply', 'capture'].includes(k)), kinds.join(','));
        const stored = await storedItems(page);
        check('the reply record keeps the filled item', stored.includes('THREAD_ALPHA'), stored.slice(0, 200));

        // ------------------------------------------------------------ reply 2: Hale is in the scene; the thread is done
        await addRecords(page, [{ op: 'revise', target: ['letter'], record: { id: 'letter', kind: 'thread', threadType: 'Plotline', subject: 'Hale', text: OPEN, status: 'done' } }]);
        const scene = await page.evaluate(async B => (await import(`${B}/src/world.js`)).readScene('normal').present, B);
        check('the capture listed Hale in the scene', /Hale/.test(scene), scene);
        L.resetLog();
        await turn(page, 'I ask Hale about the guild.');
        const second = lastReplyText();
        out.dumps.second = { thread: lineWith(second, 'EVENT_OMEGA'), secret: lineWith(second, 'SECRET_OMEGA') };
        check('the item that needs a kept secret is filled with the secret of Hale, who is present', second.includes(`SECRET_OMEGA presses on Hale's secret (${SECRET})`), out.dumps.second.secret);
        check('with no open thread the thread item waits, and the paused thread is not used', !second.includes('EVENT_OMEGA') && !eventNotes(second).includes('THREAD_PAUSED'), out.dumps.second.thread);
        kinds = L.requests('all').map(r => r.kind);
        check('the second reply makes only the reply and its capture', kinds.filter(k => k === 'reply').length === 1 && kinds.every(k => ['reply', 'capture'].includes(k)), kinds.join(','));
        if (EV) await page.screenshot({ path: path.join(EV, `memory-offers-${WIDTH}.png`), fullPage: false });
        out.errors = errors.slice(0, 10);
        check('no page error', !errors.some(e => /roleplay-instructions/.test(String(e))), errors.slice(0, 3).join(' | '));
    } catch (error) {
        check('the run finished', false, String(error?.stack || error).slice(0, 600));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, `memory-offers-${WIDTH}.json`), JSON.stringify(out, null, 1));
        await browser.close();
    }
})();
