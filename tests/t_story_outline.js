// B52: the long-range story outline. Two parts in one file.
//   node --test tests/t_story_outline.js   the pure parts: free-only chains, the 40-reply interval, edits kept, the
//                                          request, the answer, and the outline inside the Director's desk entry only
//   node tests/t_story_outline.js          also the browser check on a host with the mock (run_browser.sh runs it this
//                                          way): tap through the Generate sheet, the outline in the reply request only
//                                          inside the Director's desk entry, her edit kept, a failed answer keeping the
//                                          old outline, the 40-reply run, and a chain with only paid routes making no
//                                          request. RI_WIDTH (default 390) and RI_EVIDENCE for story-outline-<width>.json.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
    EVERY, buildOutlineRequest, freeChain, isDue, outlineDeskLines, outlineLines, outlineOf, readOutline, skipReason, OUTLINE_SYSTEM,
} from '../src/story-outline.js';
import { JOBS, RECOMMENDED_CHAINS } from '../src/routing.js';
import { trackerEntries, trackerVariables } from '../src/tracker-book.js';
import { MEMORY } from '../src/memory/fold.js';

// ---------------------------------------------------------------- node

test('the outline job is marked free-only and shares the Writer chain of the chapter call', () => {
    assert.equal(JOBS.outline.freeOnly, true);
    assert.equal(JOBS.outline.chain, 'chapter');
    assert.equal(JOBS.outline.tier, 'writer');
});

test('freeChain keeps the desktop, the NanoGPT plan and free tiers, and drops paid routes, the phone and a paid Main API', () => {
    const steps = freeChain(RECOMMENDED_CHAINS.chapter, { mainCost: () => 'paid' }).map(s => s.route);
    assert.deepEqual(steps, ['desktop', 'nanogpt', 'googleFree']);
    assert.deepEqual(freeChain([{ route: 'main' }], { mainCost: () => 'local' }).map(s => s.route), ['main']);
    assert.deepEqual(freeChain([{ route: 'main' }], { mainCost: () => 'plan' }).map(s => s.route), ['main']);
    assert.deepEqual(freeChain([{ route: 'main' }, { route: 'openrouter' }, { route: 'phone' }], { mainCost: () => 'paid' }), []);
    assert.deepEqual(freeChain([{ route: 'openrouterFree' }, { route: 'x', profileId: 'p1' }, { route: 'x', profileId: 'p2' }],
        { profileCost: e => (e.profileId === 'p1' ? 'plan' : 'paid') }).map(s => s.profileId || s.route), ['openrouterFree', 'p1']);
});

test('the run is due every 40 replies; an edit kept as written and a wait for a free route hold it back', () => {
    const base = outlineOf({});
    assert.equal(EVERY, 40);
    assert.equal(isDue(base, 39), false);
    assert.equal(isDue(base, 40), true);
    assert.equal(isDue({ ...base, reply: 40 }, 79), false);
    assert.equal(isDue({ ...base, reply: 40 }, 80), true);
    assert.equal(isDue({ ...base, reply: 90 }, 50), false, 'replies deleted below the last run wait a full interval again');
    assert.equal(skipReason({ ...base, text: 'A: b', edited: true, keep: true }, 40), 'kept edit');
    assert.equal(skipReason({ ...base, text: 'A: b', edited: true, keep: false }, 40), '');
    assert.equal(skipReason({ ...base, waitUntil: 2000 }, 40, 1000), 'waiting for a free route');
    assert.equal(skipReason({ ...base, waitUntil: 500 }, 40, 1000), '');
    assert.equal(outlineOf({ [MEMORY]: { outline: { text: 'x' } } }).keep, true, 'her edit is kept by default');
});

const RECORDS = [
    { id: 't1', kind: 'thread', threadType: 'Plotline', subject: 'The ledger', text: 'Marten holds the ledger of the Valen debts.', endsWhen: 'the ledger reaches the magistrate', status: 'open', importance: 8 },
    { id: 't2', kind: 'thread', threadType: 'Pending', subject: 'The toll', text: 'The bridge toll is due.', story_time: 'Day 5, noon', status: 'current' },
    { id: 't3', kind: 'thread', threadType: 'Open', subject: 'The paused feud', text: 'Dorn and the miller.', paused: true, status: 'open' },
    { id: 't4', kind: 'thread', threadType: 'Open', subject: 'The closed matter', text: 'Settled at the inn.', status: 'done' },
    { id: 'p1', kind: 'person', subject: 'Marten', text: 'Clerk of the Valen bank.', status: 'current' },
    { id: 'c1', kind: 'chapter', title: 'The Gilded Hound', subject: 'The Gilded Hound', text: 'Hale met Marten in the taproom and agreed to carry the ledger east for 30 silver.', status: 'current' },
];

test('the request carries open threads with their ends-when lines, leaves paused and closed threads out, and carries rules and the current outline', () => {
    const req = buildOutlineRequest({ records: RECORDS, cast: ['Hale', 'You'], rules: ['When the relationship level is at least 7, send a direction'], current: { text: 'The magistrate: Hale reaches the court.', edited: true } });
    assert.match(req.user, /Plotline: The ledger\. Marten holds the ledger of the Valen debts\. Ends when the ledger reaches the magistrate\./);
    assert.match(req.user, /Pending: The toll\. .* Due Day 5, noon\./);
    assert.doesNotMatch(req.user, /paused feud/);
    assert.doesNotMatch(req.user, /closed matter/);
    assert.match(req.user, /person \| Marten \| Clerk of the Valen bank\./);
    assert.match(req.user, /Chapter "The Gilded Hound": Hale met Marten/);
    assert.match(req.user, /Story rules the player set/);
    assert.match(req.user, /Current outline, as the player edited it\. .*\n- The magistrate: Hale reaches the court\./);
    assert.match(req.user, /^Cast: Hale, You\./);
    assert.equal(req.system, OUTLINE_SYSTEM);
    assert.match(OUTLINE_SYSTEM, /register of an incident report/);
    assert.doesNotMatch(OUTLINE_SYSTEM + req.user, new RegExp('[\\u2013\\u2014]'), 'no em or en dashes in model-facing text');
    assert.ok(req.user.length + req.system.length < 12000, `request size ${req.user.length + req.system.length}`);
    const empty = buildOutlineRequest({});
    assert.match(empty.user, /Open threads:\n\(none on file\)/);
});

test('an answer makes one "Title: events" line per chapter; an answer with no chapters makes nothing', () => {
    assert.equal(readOutline({ chapters: [{ title: 'The court.', events: 'Hale hands the ledger to the magistrate on Day 6.' }, { title: '', events: '' }] }),
        'The court: Hale hands the ledger to the magistrate on Day 6.');
    assert.equal(readOutline({ goal: 'x' }), '');
    assert.equal(readOutline(null), '');
    const many = readOutline({ chapters: Array.from({ length: 9 }, (_, i) => ({ title: `C${i}`, events: 'e' })) });
    assert.equal(many.split('\n').length, 5);
    assert.deepEqual(outlineLines('1. One\n\n- Two \u{1F525}\n  '), ['One', 'Two']);
});

const KEY = 'roleplay_instructions';
test('the outline reaches the Tracker book only as lines of the Director\'s desk entry, publishes no variable, and leaves with Theirs', () => {
    const latest = { tracker: { scene: { place: 'The taproom' } }, plan: 'Hale asks about the ledger.' };
    const text = 'The court: Hale hands the ledger to the magistrate.';
    const entries = trackerEntries(latest, { enabled: new Set(['scene.place']), outline: text });
    const desk = entries.filter(e => e.card === 'directorsDesk');
    assert.equal(desk.length, 1);
    assert.match(desk[0].content, /^Director's desk\nHale asks about the ledger\.\nLong-range outline, for you alone/);
    assert.match(desk[0].content, /1\. The court: Hale hands the ledger to the magistrate\.$/);
    assert.equal(entries.filter(e => e.content.includes('magistrate')).length, 1, 'only the desk carries it');
    assert.deepEqual(trackerVariables(entries), { ri_scene_place: 'The taproom', ri_plan: 'Hale asks about the ledger.' });
    const alone = trackerEntries(null, { outline: text });
    assert.equal(alone.length, 1);
    assert.equal(alone[0].card, 'directorsDesk');
    assert.deepEqual(trackerVariables(alone), {});
    assert.deepEqual(trackerEntries(latest, { theirs: new Set(['plots']), outline: text }).filter(e => e.card === 'directorsDesk'), []);
    assert.deepEqual(trackerEntries(null, { outline: '' }), []);
    assert.deepEqual(outlineDeskLines('  '), []);
    void KEY;
});

// ---------------------------------------------------------------- browser

const browser = !process.env.NODE_TEST_CONTEXT && process.env.RI_HOST_URL;
if (browser) runBrowser().catch(error => { console.error(error); process.exitCode = 1; });

async function runBrowser() {
    const require = createRequire(import.meta.url);
    const L = require('./lib.js');
    const B = L.BASE;
    const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = 780;
    const EV = process.env.RI_EVIDENCE || '';
    const out = { width: WIDTH, checks: [] };
    const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };
    const textOf = r => (r.messages || []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
    const outlineRows = () => L.requests('all').filter(r => textOf(r).includes('You plan the long-range course of a roleplay story'));
    const replyRows = () => L.requests('all').filter(r => r.kind === 'reply' && !textOf(r).includes('You plan the long-range course'));
    const ANSWER = { chapters: [{ title: 'The magistrate', events: 'Hale carries the ledger to the magistrate at Valen and trades it for the 30 silver Marten promised.' }, { title: 'The toll', events: 'The bridge toll falls due at noon on Day 5 and Dorn demands it at the gate.' }] };
    const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); const O = await import(`${B}/src/story-outline.js`); return !!Q.desktopQueue().stats().running || O.outlineBusy(); }, B); if (!busy) break; } await page.waitForTimeout(1500); };
    const state = page => page.evaluate(async B => (await import(`${B}/src/story-outline.js`)).currentOutline(), B);

    L.sync(); L.mode({}); L.resetLog();
    const { browser: chrome, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 30, maxExchanges: 60 } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        await L.send(page, 'I sit down at the table.');
        await settle(page);
        // an open thread with its ends-when line, and a paused one
        await page.evaluate(async B => {
            const S = await import(`${B}/src/memory/store.js`);
            await S.memoryStore().record([
                { op: 'add', record: { id: 'th-ledger', kind: 'thread', threadType: 'Plotline', subject: 'The ledger', text: 'Marten holds the ledger of the Valen debts.', endsWhen: 'the ledger reaches the magistrate', status: 'open' }, origin: { type: 'you' }, reason: 'B52 test' },
                { op: 'add', record: { id: 'th-feud', kind: 'thread', threadType: 'Open', subject: 'The miller feud', text: 'Dorn and the miller argue over water rights.', paused: true, status: 'open' }, origin: { type: 'you' }, reason: 'B52 test' },
            ]);
        }, B);

        // ------------------------------------------------ tap: the button opens the Generate sheet; Close makes no call
        await L.openPanel(page, 'story-outline');
        const write = page.locator('[data-outline-write]');
        check('the Direction, Goal page shows Write the outline now with its Cost chip', await write.isVisible() && (await write.getAttribute('data-ri-model-cost')) === '1 model call · free route');
        if (EV) await page.screenshot({ path: path.join(EV, `story-outline-${WIDTH}-page.png`) });
        L.resetLog();
        await write.tap();
        const sheet = page.locator('.ri-gsheet[data-ri-memory]');
        check('a tap opens the Generate sheet first', await sheet.isVisible());
        if (EV) await page.screenshot({ path: path.join(EV, `story-outline-${WIDTH}-sheet.png`) });
        await sheet.locator('[data-ri-close]').tap();
        await page.waitForTimeout(600);
        check('Close on the sheet makes no call', outlineRows().length === 0, String(outlineRows().length));

        // ------------------------------------------------ Generate: one call on the free Main API (a local server here)
        L.mode({ goal: JSON.stringify(ANSWER) });
        await write.tap();
        await sheet.locator('[data-ri-generate]').tap();
        await settle(page);
        let rows = outlineRows();
        check('Generate makes exactly one outline call', rows.length === 1, String(rows.length));
        const sent = rows[0] ? textOf(rows[0]) : '';
        check('the call reads the open thread and its ends-when line', /The ledger\. Marten holds the ledger.*Ends when the ledger reaches the magistrate\./.test(sent));
        check('the call leaves the paused thread out', !sent.includes('miller feud'));
        let s = await state(page);
        check('the outline is saved from the answer', /^The magistrate: Hale carries the ledger/.test(s?.text || '') && s.route === 'main', JSON.stringify(s));
        const spend = await page.evaluate(async B => (await import(`${B}/src/spend.js`)).spendState(), B);
        check('spend shows no paid row for the outline', !spend.calls.some(c => c.job === 'outline') && spend.reserved === 0, JSON.stringify({ total: spend.total, calls: spend.calls.length }));
        out.spend = spend;

        // ------------------------------------------------ the next reply request carries it only inside the Director's desk entry
        L.mode({}); L.resetLog();
        await L.send(page, 'I ask Marten about the ledger.');
        await settle(page);
        const reply = replyRows().at(-1);
        const all = reply ? textOf(reply) : '';
        const hits = all.split('Hale carries the ledger to the magistrate').length - 1;
        const at = all.indexOf('Hale carries the ledger');
        const before = all.slice(Math.max(0, all.lastIndexOf("Director's desk", at)), at);
        check('the reply request carries the outline once', hits === 1, String(hits));
        check('it sits inside the Director\'s desk entry', at > 0 && before.startsWith("Director's desk") && before.includes('Long-range outline'), before.slice(0, 200));
        const carrying = L.requests('all').filter(r => !textOf(r).includes('You plan the long-range course') && textOf(r).includes('Hale carries the ledger to the magistrate'));
        const outside = carrying.filter(r => { const t = textOf(r); const i = t.indexOf('Hale carries the ledger'); return r.kind !== 'reply' || !t.slice(Math.max(0, t.lastIndexOf("Director's desk", i)), i).startsWith("Director's desk"); });
        check('no background call carries it, and every reply request has it inside the Director\'s desk', outside.length === 0, `${carrying.length} carrying; outside: ${outside.map(r => r.kind).join(',')}`);

        // ------------------------------------------------ her edit sticks; the next reply carries her text
        await L.openPanel(page, 'story-outline');
        const box = page.locator('[data-outline-text]');
        await box.fill('The court: Hale hands the ledger to the magistrate before the toll falls due.');
        await page.waitForTimeout(1800);
        s = await state(page);
        check('her edit is saved and marked as hers', s.edited === true && s.keep === true && s.text.startsWith('The court:'), JSON.stringify(s));
        L.resetLog();
        await L.send(page, 'I wait for an answer.');
        await settle(page);
        check('the next reply request carries her edited text', textOf(replyRows().at(-1) || {}).includes('Hale hands the ledger to the magistrate before the toll'));

        // ------------------------------------------------ the 40-reply run: with "Keeps your text" it makes no call
        await page.evaluate(async B => { const c = globalThis.SillyTavern.getContext(); const O = await import(`${B}/src/story-outline.js`); c.chatMetadata.ri_memory.outline.reply = O.storyReplies(c.chat) + 1 - O.EVERY; }, B);
        L.resetLog(); L.mode({ goal: JSON.stringify(ANSWER) });
        await L.send(page, 'I count the coins.');
        await settle(page);
        check('a due run over her kept edit makes no call', outlineRows().length === 0 && (await state(page)).text.startsWith('The court:'), String(outlineRows().length));

        // ------------------------------------------------ with "Rewrites it" the due run sends her text and rewrites it
        await page.evaluate(async B => { await (await import(`${B}/src/story-outline.js`)).setKeepEdits(false); }, B);
        await page.evaluate(async B => { const c = globalThis.SillyTavern.getContext(); const O = await import(`${B}/src/story-outline.js`); c.chatMetadata.ri_memory.outline.reply = O.storyReplies(c.chat) + 1 - O.EVERY; }, B);
        L.resetLog();
        await L.send(page, 'I put the coins away.');
        await settle(page);
        rows = outlineRows();
        s = await state(page);
        check('the 40th reply runs one call by itself after capture', rows.length === 1, String(rows.length));
        check('the run reads her edited text as the current outline', rows[0] && /Current outline, as the player edited it[\s\S]*Hale hands the ledger to the magistrate before the toll/.test(textOf(rows[0])));
        check('the run rewrites her edit with the answer', s.text.startsWith('The magistrate:') && s.edited === false, JSON.stringify(s));
        const replyAt = s.reply;

        // ------------------------------------------------ a failed answer keeps the old outline and waits for the next interval
        L.mode({ goal: JSON.stringify({ goal: 'nothing usable' }) }); L.resetLog();
        const res = await page.evaluate(async B => (await import(`${B}/src/story-outline.js`)).runOutline({ tap: true }), B);
        s = await state(page);
        check('a failed answer keeps the old outline', !res.ok && s.text.startsWith('The magistrate:') && /could not be used/.test(s.problem), JSON.stringify({ res, s }));
        check('a failed answer resets the interval', s.reply >= replyAt && s.waitUntil === 0, JSON.stringify(s));

        // ------------------------------------------------ a chain of paid routes only: it waits and makes no request
        await page.evaluate(async B => { const R = await import(`${B}/src/routing.js`); R.setJobChain('chapter', [{ route: 'openrouter', model: 'x' }, { route: 'phone' }]); }, B);
        L.resetLog(); L.mode({ goal: JSON.stringify(ANSWER) });
        const paid = await page.evaluate(async B => (await import(`${B}/src/story-outline.js`)).runOutline({ tap: true }), B);
        await page.waitForTimeout(800);
        check('with no free route it waits and makes no request', !paid.ok && paid.waiting && L.requests('all').length === 0, JSON.stringify(paid));
        await page.evaluate(async B => { (await import(`${B}/src/routing.js`)).setJobChain('chapter', null); }, B);

        // ------------------------------------------------ Clear takes it out of the Director's desk
        await L.openPanel(page, 'story-outline');
        await page.locator('[data-outline-clear]').tap();
        await page.waitForTimeout(1200);
        const book = await page.evaluate(async B => { const T = await import(`${B}/src/tracker-book.js`); const b = await T.trackerBook().read(); return JSON.stringify(b?.entries || {}); }, B);
        check('Clear empties the outline and the Tracker book no longer carries it', !(await state(page)).text && !book.includes('Long-range outline'), '');
        if (EV) await page.screenshot({ path: path.join(EV, `story-outline-${WIDTH}-cleared.png`) });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check('no horizontal page scroll', overflow <= 0, String(overflow));
        const bad = errors.filter(e => /story.?outline/i.test(e));
        check('no page errors from the outline', !bad.length, bad.join(' | '));
    } finally {
        L.mode({});
        if (EV) fs.writeFileSync(path.join(EV, `story-outline-${WIDTH}.json`), JSON.stringify(out, null, 2));
        await chrome.close();
    }
}
