// MB10 browser suite on a SillyTavern 1.19.0 host with the mock model, touch at 390 x 780 (RI_WIDTH, RI_HEIGHT):
//   1. What was sent: the record of each request is saved at send time per reply and swipe, with the recall block, held-out
//      list, sizes and cache line; a past reply's view is unchanged by a later record edit, a settings change and a
//      chapter close; the next request is built in code.
//   2. Setup, Memory: seven sections, the status pill, the review list with File as my edit (clipped to 300 characters)
//      and Dismiss.
//   3. Story, Story World: the filters (Facts and Plot among them, the old nested tabs gone, 18 pages), Lock, Pin, Undo
//      and Restore, a meter set by hand, temperament, a thread's "ends when" line and Paused switch, Memory from this reply;
//      Add record on Facts and Plot with the old record form, filed as her locked record, and Edit (fixadd).
//   4. Export as World Info book: a new book SillyTavern's World Info screen opens, secrets left out by default, chat
//      data unchanged. Open as World Info book.
//   5. Story, World Info: each book's kind and both switches; a book with chance or group fields is Behavior with
//      "Recall manages this book" off; New behavior book and Receive story events.
//   6. The message menu's two memory entries; "Newest chapters in full" reaches the chapter view; Tidy is not queued
//      while "Tidy automatically" is off.
// Run with the host variables of tests/README.md. RI_EVIDENCE names the screenshot folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'MB10');
fs.mkdirSync(dir, { recursive: true });
const width = Number(process.env.RI_WIDTH || 390), height = Number(process.env.RI_HEIGHT || 780);
const out = { run: new Date().toISOString(), viewport: { width, height }, checks: {}, shots: [] };
const B = L.BASE;

const answer = (ops, scene = { place: 'Elerian Keep gatehouse', time: 'Day 1, dawn', present: ['Hale'] }, extra = {}) => ({
    decisions: { durable_change: ops.length > 0, scene_ended: false, out_of_character: false }, ops, state: { scene, ...extra } });

async function shot(page, name) {
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    out.shots.push(file);
    return file;
}

/** Open a page of the menu full screen and wait for its body to settle. */
async function openPage(page, id, options = {}) {
    await L.openPanel(page, id, options);
    await page.waitForTimeout(900);
    return page.locator('#ri_root #ri_panel_page');
}

const fold = (page, id) => page.evaluate(async ({ B, id }) => {
    const F = await import(`${B}/src/memory/fold.js`);
    const c = SillyTavern.getContext();
    const r = F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get(id);
    return r ? { status: r.status, text: r.text, locked: !!r.locked, temperament: r.temperament || null, endsWhen: r.endsWhen || '', paused: !!r.paused } : null;
}, { B, id });

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width, height, hasTouch: true, isMobile: true });
    try {
        const preset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'Roleplay Instructions V10.json'), 'utf8'));
        await L.setupApi(page);
        await page.evaluate(async value => { await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name, value); }, preset);
        await L.usePreset(page, preset.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(() => !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 });

        // ---- three replies that file people, facts, a thread and a secret
        L.mode({ capture: answer([
            { op: 'add', id: 'hale', target: [], kind: 'person', subject: 'Hale', text: 'Hale is the gate warden of Elerian Keep.', quote: 'Reply' },
            { op: 'add', id: 'gate-bar', target: [], kind: 'fact', subject: 'Elerian Keep gate', attribute: 'bar', text: 'The gate of Elerian Keep is barred with an iron beam.', quote: 'Reply' },
        ], undefined, { emotions: [{ name: 'Hale', axes: { tenderness: 1, fury: 0, dread: 1, yearning: 0 } }] }) });
        await L.send(page, 'I check the gate with Hale.');
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        L.mode({ capture: answer([
            { op: 'add', id: 'smugglers', target: [], kind: 'thread', thread_type: 'Plotline', subject: 'Smugglers at the docks', text: 'Smugglers unload crates at the east dock at night.', quote: 'Reply' },
            { op: 'add', id: 'hale-debt', target: [], kind: 'secret', subject: 'Hale', holders: ['Hale'], text: 'Hale owes the smugglers forty silver.', quote: 'Reply' },
        ]) });
        await L.send(page, 'We walk to the docks.');
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        L.mode({ capture: answer([]) });
        await L.send(page, 'I ask Hale about the crates.');
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); const f = F.fold(c.chat, c.chatMetadata, { cache: false }); return ['hale', 'gate-bar', 'smugglers', 'hale-debt'].every(id => f.byId.get(id)); }, B, { timeout: 30000 });

        // ---- 1. What was sent: saved per reply and swipe at send time
        const saved = await page.evaluate(async B => {
            const W = await import(`${B}/src/ui/what-was-sent.js`);
            const c = SillyTavern.getContext();
            const last = c.chat.length - 1;
            const { record, essentials } = await W.savedFor(last);
            return { last, record, essentials, extra: c.chat[last].extra?.ri_sent || null };
        }, B);
        out.checks.saved = { index: saved.last, recall: saved.record?.recall?.length, held: saved.record?.held?.length, sizes: saved.record?.sizes, cache: saved.record?.cache, essentials: saved.essentials };
        assert.ok(saved.record, 'the latest reply has a saved request record');
        assert.equal(saved.record.v, 1);
        assert.ok(saved.record.sizes.total > 0, 'the record holds the size of the whole request');
        assert.ok(saved.record.cache && Number.isInteger(saved.record.cache.firstChanged), 'the cache line compares with the previous request');
        assert.ok(saved.essentials && saved.extra && saved.extra.swipe === saved.essentials.swipe, 'the reply carries the record ids in its extra, per swipe');
        assert.ok(Array.isArray(saved.record.recall) && Array.isArray(saved.record.held), 'recall and held-out lists are saved');
        for (const r of saved.record.recall) assert.ok(r.scores && 'relevance' in r.scores && 'recency' in r.scores && 'importance' in r.scores, 'each recalled item has its three scores');

        // A swipe saves its own record and keeps the first one under its own swipe.
        await L.swipe(page);
        await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        const swiped = await page.evaluate(async ({ B, last }) => {
            const W = await import(`${B}/src/ui/what-was-sent.js`);
            const F = await import(`${B}/src/memory/fold.js`);
            const D = await import(`${B}/src/memory/device-db.js`);
            const c = SillyTavern.getContext();
            const m = c.chat[last];
            const now = await W.savedFor(last);
            const first = await D.deviceDb().get(W.dbKey(c.getCurrentChatId(), F.storedMark(m), 0));
            return { swipe: F.swipeOf(m), nowSwipe: now.record?.swipe, firstAt: first?.at, nowAt: now.record?.at };
        }, { B, last: saved.last });
        out.checks.swipe = swiped;
        assert.equal(swiped.nowSwipe, swiped.swipe, 'the showing swipe has its own record');
        assert.ok(swiped.firstAt && swiped.firstAt !== swiped.nowAt, 'the first swipe keeps its record');

        // A past reply's view is unchanged by a later record edit, a settings change and a chapter close.
        const before = JSON.stringify(saved.record);
        await page.evaluate(async B => {
            const S = await import(`${B}/src/memory/store.js`);
            const St = await import(`${B}/src/store.js`);
            await S.memoryStore().record([{ op: 'revise', target: ['gate-bar'], record: { id: 'gate-bar', kind: 'fact', subject: 'Elerian Keep gate', attribute: 'bar', text: 'The gate of Elerian Keep stands open.', status: 'current' }, origin: { type: 'you' } }]);
            St.settings().summary.size = 'small'; St.saveSettings();
            const Ch = await import(`${B}/src/chapters.js`);
            await Ch.closeChapterHere(1).catch(() => '');
        }, B);
        const after = await page.evaluate(async ({ B, i }) => {
            const W = await import(`${B}/src/ui/what-was-sent.js`);
            const D = await import(`${B}/src/memory/device-db.js`);
            const F = await import(`${B}/src/memory/fold.js`);
            const c = SillyTavern.getContext();
            return D.deviceDb().get(W.dbKey(c.getCurrentChatId(), F.storedMark(c.chat[i]), 0));
        }, { B, i: saved.last });
        assert.equal(JSON.stringify(after), before, 'the saved view of the first swipe is byte for byte the same');
        out.checks.pastUnchanged = true;
        await page.evaluate(async B => { const St = await import(`${B}/src/store.js`); delete St.settings().summary.size; St.saveSettings(); }, B);

        // The page: the next request and a past reply.
        let body = await openPage(page, 'what-was-sent');
        await body.locator('[data-ri-sent-view="next"] .ri-section-title', { hasText: 'Recall block' }).waitFor({ timeout: 20000 });
        for (const part of ['Chapter view', 'Recall block', 'Held out', 'Sizes', 'Cache', 'Tracker book', 'Behavior entries and roll', 'Trim warnings']) assert.ok(await body.locator('.ri-section-title', { hasText: part }).count() >= 1, `What was sent shows ${part}`);
        await shot(page, 'what-was-sent-next');
        await body.locator('select[aria-label="Request to show"]').selectOption(String(saved.last));
        await page.waitForTimeout(1200);
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator(`[data-ri-sent-view="${saved.last}"] [data-ri-cache]`).waitFor({ timeout: 20000 });
        await shot(page, 'what-was-sent-past');

        // ---- 6a. Newest chapters in full reaches the chapter view: two chapters, then 1 and 2 in full
        const closeAtLast = () => page.evaluate(async B => {
            const Ch = await import(`${B}/src/chapters.js`);
            return Ch.closeChapterHere(SillyTavern.getContext().chat.length - 1).catch(e => e.message);
        }, B);
        out.checks.chapterCloses = [await closeAtLast()];
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.setExpanded(false); }, B);
        for (const text of ['Hale lifts a crate lid.', 'We count the crates.']) {
            await L.send(page, text);
            await page.waitForFunction(() => !document.querySelector('#chat .ri-tray-loading'), null, { timeout: 30000 });
        }
        out.checks.chapterCloses.push(await closeAtLast());
        const full = await page.evaluate(async B => {
            const Ch = await import(`${B}/src/chapters.js`);
            const St = await import(`${B}/src/store.js`);
            const seen = {};
            for (const n of [1, 2]) { St.settings().summary.fullChapters = n; seen[n] = { setting: Ch.fullChapters(), full: Ch.chapterState().view.full?.length ?? 0, chapters: Ch.chapterState().chapters.filter(x => x.valid).length }; }
            delete St.settings().summary.fullChapters; St.saveSettings();
            return seen;
        }, B);
        out.checks.fullChapters = full;
        assert.equal(full[1].setting, 1);
        assert.equal(full[2].setting, 2);
        assert.ok(full[2].chapters >= 2, 'two chapters closed');
        assert.equal(full[1].full, 1, 'one chapter in full');
        assert.equal(full[2].full, 2, 'two chapters in full');

        // ---- 6b. Tidy is not queued while Tidy automatically is off
        const tidy = await page.evaluate(async B => {
            const U = await import(`${B}/src/memory/upkeep.js`);
            const Q = await import(`${B}/src/memory/queue.js`);
            const St = await import(`${B}/src/store.js`);
            const c = SillyTavern.getContext();
            // count the Tidy jobs upkeep hands the queue
            const q = Q.desktopQueue();
            const enqueue = q.enqueue;
            let queued = 0;
            q.enqueue = job => { if (job?.kind === 'tidy') queued++; return enqueue.call(q, job); };
            const count = () => queued;
            (St.settings().memory ||= {}).tidy = false;
            U.upkeepState(c.chatMetadata).every = 1; U.upkeepState(c.chatMetadata).last = { reply: 0, at: Date.now() };
            const off = await U.afterReply();
            const offCount = count();
            St.settings().memory.tidy = true;
            U.upkeepState(c.chatMetadata).every = 1; U.upkeepState(c.chatMetadata).last = { reply: 0, at: Date.now() };
            const on = await U.afterReply();
            const onCount = count();
            delete St.settings().memory.tidy; St.saveSettings();
            q.enqueue = enqueue;
            return { offDue: off.due, offCount, onDue: on.due, onCount };
        }, B);
        out.checks.tidy = tidy;
        assert.ok(tidy.offDue, 'a Tidy run was due');
        assert.equal(tidy.offCount, 0, 'no Tidy job while Tidy automatically is off');
        assert.ok(tidy.onCount >= 1, 'with it on the due run is queued');

        // ---- 2. Setup, Memory
        body = await openPage(page, 'memory');
        const sections = await body.evaluate(node => [...node.querySelectorAll(':scope > .ri-section > .ri-section-title, :scope > .ri-section > .ri-section-head > .ri-section-title')].map(n => n.textContent.trim()));
        out.checks.memorySections = sections;
        for (const name of ['Status', 'Recall', 'Budgets', 'Chapters', 'Upkeep', 'This chat']) assert.ok(sections.includes(name), `Setup, Memory has ${name}`);
        assert.ok(sections.some(s => s.startsWith('Review list')), 'Setup, Memory has the Review list');
        const pill = await page.evaluate(async B => (await import(`${B}/src/ui/memory-settings.js`)).memoryPill(), B);
        out.checks.pill = pill;
        assert.match(pill, /^ON · [A-Z]+ · US\$\d+\.\d\d$/, 'the status pill reads ON, the route and the spend');
        await shot(page, 'memory-top');

        // Review list: a clash flag Dismissed, an edit typed into the generated book filed and clipped.
        await page.evaluate(async B => {
            const S = await import(`${B}/src/memory/store.js`);
            const SW = await import(`${B}/src/memory/story-world-book.js`);
            await S.memoryStore().record([
                { op: 'flag', origin: { type: 'upkeep', route: 'code' }, reason: 'The story contradicts your entry.', record: { kind: 'entry-clash', pair: 'p1', subject: 'Night', a: { book: 'Hale of Verath', uid: 3, text: 'Night is a black mare.' }, b: { text: 'Night is a dapple-grey mare.', quote: 'the dapple-grey mare' } } },
                { op: 'flag', origin: { type: 'upkeep', route: 'code' }, reason: 'You edited the generated book.', record: { kind: SW.FLAG_KIND, book: 'RI Story World, test', entryId: 9, recordId: 'gate-bar', title: 'Fact: Elerian Keep gate', keys: ['Elerian Keep gate'], content: 'The gate of Elerian Keep '.padEnd(420, 'is old and heavy and '), text: 'x', sig: 'sig-1' } },
            ]);
        }, B);
        body = await openPage(page, 'memory', { anchor: '#ri-review-list' });
        const flags = body.locator('#ri-review-list [data-ri-flag]');
        assert.equal(await flags.count(), 2, 'both flags wait on the review list');
        await page.locator('#ri-review-list').scrollIntoViewIfNeeded();
        await shot(page, 'memory-review-list');
        await body.locator('[data-ri-flag-kind="you-edited-the-generated-book"]').getByRole('button', { name: 'File as my edit' }).tap();
        await page.waitForTimeout(1500);
        body = page.locator('#ri_root #ri_panel_page');
        const filed = await body.locator('[data-ri-review-status]').textContent();
        out.checks.fileEdit = filed;
        assert.match(filed, /shortened to 300 characters/, 'a clipped filed edit says so');
        const gate = await fold(page, 'gate-bar');
        assert.ok(gate.locked && gate.text.length <= 300, 'the record holds her edit, locked, at most 300 characters');
        await body.locator('[data-ri-flag-kind="entry-clash"]').getByRole('button', { name: 'Dismiss' }).tap();
        await page.waitForTimeout(1500);
        assert.equal(await page.locator('#ri-review-list [data-ri-flag]').count(), 0, 'the review list is empty');

        // ---- 3. Story World
        const tree = await page.evaluate(async B => {
            const D = await import(`${B}/src/ui/destinations.js`), R = await import(`${B}/src/ui/page-registry.js`);
            const t = D.buildTree(R.registeredPages());
            return { nested: t.map(top => top.nested.map(n => n.id)), facts: D.locate(t, 'facts')?.nested.id, plots: D.locate(t, 'plots')?.nested.id, count: t.reduce((s, top) => s + top.nested.length, 0) };
        }, B);
        out.checks.tree = tree;
        assert.deepEqual(tree.nested[0], ['scene', 'characters', 'story-world', 'world-info'], 'Story has four nested tabs');
        assert.equal(tree.count, 19, 'navigation lists 19 nested tabs (B13 retired Action checks; B58 added Setup, Help)');
        assert.equal(tree.facts, 'story-world');
        assert.equal(tree.plots, 'story-world');

        // The Emotions card's values on the newest reply, as capture writes them while that card is on.
        await page.evaluate(() => {
            const c = SillyTavern.getContext();
            const m = c.chat[c.chat.length - 1];
            const rec = (m.extra ||= {}).roleplay_instructions ||= {};
            rec.tracker = { ...(rec.tracker || {}), emotions: [{ name: 'Hale', axes: { tenderness: 2, fury: 1, dread: 3, yearning: 0 } }] };
        });
        body = await openPage(page, 'world');
        await body.locator('[data-ri-filter="people"]').waitFor({ timeout: 15000 });
        for (const f of ['people', 'facts', 'plot', 'secrets', 'chapters', 'retired', 'needs']) assert.equal(await body.locator(`[data-ri-filter="${f}"]`).count(), 1, `filter ${f}`);
        await shot(page, 'story-world-people');
        // Temperament on the person row
        const temper = body.locator('[data-ri-temperament="hale"]');
        await temper.locator('summary').tap();
        await temper.locator('select[aria-label="Hale Fury speed"]').selectOption('1.5');
        await page.waitForTimeout(1200);
        assert.equal((await fold(page, 'hale')).temperament?.fury, 1.5, 'temperament set through setTemperament');
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-temperament="hale"] summary').tap();
        await body.locator('[data-ri-temperament="hale"]').scrollIntoViewIfNeeded();
        await shot(page, 'story-world-temperament');
        // A meter set by hand
        const meter = body.locator('[data-ri-record="hale"] [data-ri-meter="emotions.axes.dread"] input');
        assert.equal(await meter.count(), 1, 'the person row shows the dread meter');
        {
            await meter.fill('6'); await meter.dispatchEvent('change');
            await page.waitForTimeout(1200);
            const set = await page.evaluate(async B => { const T = await import(`${B}/src/tracker-book.js`); const t = T.latestTracker(SillyTavern.getContext().chat).tracker; return { dread: t.emotions?.find(x => x.name === 'Hale')?.axes?.dread, locks: t.locks || [] }; }, B);
            out.checks.meter = set;
            assert.equal(set.dread, 6, 'the meter holds her value');
            assert.ok(set.locks.length >= 1, 'and is locked');
        }
        body = page.locator('#ri_root #ri_panel_page');
        // Lock and Pin, then Undo the lock from the record's history
        await body.locator('[data-ri-record="hale"]').getByRole('button', { name: 'Lock', exact: true }).tap();
        await page.waitForTimeout(1200);
        assert.ok((await fold(page, 'hale')).locked, 'Lock locks the record');
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-record="hale"]').getByRole('button', { name: 'Pin', exact: true }).tap();
        await page.waitForTimeout(1200);
        assert.ok(await page.evaluate(() => (SillyTavern.getContext().chatMetadata.ri_memory.pins || []).includes('hale')), 'Pin is kept in chat data');
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-record="hale"] .ri-record-history summary').tap();
        await body.locator('[data-ri-record="hale"] .ri-record-history li', { hasText: 'Locked' }).getByRole('button', { name: 'Undo' }).tap();
        await page.waitForTimeout(1200);
        assert.equal((await fold(page, 'hale')).locked, false, 'Undo in the record\'s history takes the lock back');
        // Plot filter: the thread's ends-when line and Paused switch
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-filter="plot"]').tap();
        await page.waitForTimeout(900);
        body = page.locator('#ri_root #ri_panel_page');
        const ends = body.locator('[data-ri-thread="smugglers"] input[aria-label="Smugglers at the docks ends when"]');
        await ends.fill('The smugglers are caught or leave the city.');
        await ends.dispatchEvent('change');
        await page.waitForTimeout(1200);
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-thread="smugglers"] [role="switch"]').tap();
        await page.waitForTimeout(1200);
        const thread = await fold(page, 'smugglers');
        out.checks.thread = thread;
        assert.equal(thread.endsWhen, 'The smugglers are caught or leave the city.', 'the ends-when line is saved');
        assert.equal(thread.paused, true, 'Paused is saved');
        await page.locator('[data-ri-thread="smugglers"]').scrollIntoViewIfNeeded();
        await shot(page, 'story-world-plot');
        // Facts through its own page id
        body = await openPage(page, 'facts');
        await body.locator('[data-ri-records="facts"]').waitFor({ timeout: 15000 });
        assert.ok(await body.locator('[data-ri-record="gate-bar"]').count() === 1, 'Facts filter lists the fact');
        await shot(page, 'story-world-facts');
        // Add record on Facts and Plot (fixadd): the old record form, filed in chat data as her locked record with every
        // field the form offers kept in the record's view; Edit revises the same record. No model call.
        {
            const youRecord = id => page.evaluate(async ({ B, id }) => {
                const F = await import(`${B}/src/memory/fold.js`);
                const c = SillyTavern.getContext();
                const r = F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get(id);
                if (!r) return null;
                const versions = r.versions || [];
                return { kind: r.kind, threadType: r.threadType || '', text: r.text, locked: !!r.locked, status: r.status, data: JSON.parse(r.view?.fields?.data || 'null'), versions: versions.length };
            }, { B, id });
            const origins = id => page.evaluate(() => { const c = SillyTavern.getContext(); return (c.chatMetadata.ri_memory.log || []).map(e => ({ op: e.op, origin: e.origin?.type, route: e.origin?.route || '', target: e.target || [], id: e.record?.id || '' })); }).then(rows => rows.filter(row => row.id === id || row.target.includes(id)));
            L.resetLog();
            const addRow = body.getByRole('button', { name: 'Add record', exact: true });
            await addRow.tap();
            await body.getByText('This chat · Saves to the current story records.').waitFor();
            assert.deepEqual(await body.getByLabel('Record type', { exact: true }).locator('option').allTextContents(), ['fact'], 'Facts offers the fact type');
            for (const label of ['Record ID', 'Subject or speaker', 'Record text', 'Relevance aliases', 'Related plot record ID', 'Base World entry', 'Relationship to Base World']) assert.equal(await body.getByLabel(label, { exact: true }).count(), 1, `the fact form has ${label}`);
            await body.getByLabel('Subject or speaker', { exact: true }).fill('Eastern gate');
            await body.getByLabel('Record text', { exact: true }).fill('Heather told the general she would not marry Lord Valyren. The eastern gate stays barred until dawn.');
            await body.getByLabel('Relevance aliases', { exact: true }).fill('east gate, gatehouse');
            await body.locator('[data-ri-record-editor]').scrollIntoViewIfNeeded();
            await shot(page, 'story-world-add-fact-form');
            await body.getByRole('button', { name: 'Save record', exact: true }).tap();
            await body.locator('[data-ri-record="you-eastern-gate"]').waitFor({ timeout: 15000 });
            const fact = await youRecord('you-eastern-gate');
            out.checks.addFact = fact;
            assert.equal(fact.kind, 'fact');
            assert.equal(fact.text, 'Heather told the general she would not marry Lord Valyren. The eastern gate stays barred until dawn.', 'her text is kept as she typed it');
            assert.ok(fact.locked, 'Protect (on by default) locks her record');
            assert.deepEqual(fact.data.aliases, ['east gate', 'gatehouse'], 'the form\'s aliases are kept in the record\'s view');
            assert.equal(fact.data.source, 'user');
            const factLog = await origins('you-eastern-gate');
            assert.deepEqual(factLog.map(row => [row.op, row.origin]), [['add', 'you'], ['lock', 'you']], 'filed as your record, then locked');
            await body.locator('[data-ri-record="you-eastern-gate"]').scrollIntoViewIfNeeded();
            await shot(page, 'story-world-add-fact-saved');
            // Plot: a seed with its payoff and due minute, then Edit
            await body.locator('[data-ri-filter="plot"]').tap();
            body = page.locator('#ri_root #ri_panel_page');
            await body.locator('[data-ri-filter="plot"][aria-pressed="true"]').waitFor({ timeout: 15000 });
            await page.waitForTimeout(900);
            await body.getByRole('button', { name: 'Add record', exact: true }).tap();
            const type = body.getByLabel('Record type', { exact: true });
            await type.locator('option').first().waitFor({ state: 'attached', timeout: 15000 });
            const plotTypes = await type.locator('option').allTextContents();
            assert.ok(plotTypes.includes('seed') && plotTypes.every(t => ['arc', 'seed', 'agenda', 'event'].includes(t)), `Plot offers the plot types whose features are on: ${plotTypes}`);
            await type.selectOption('seed');
            for (const label of ['Status', 'Parent arc ID', 'Required location', 'Due story minute', 'Optional payoff guidance', 'Established outcome', 'Selection weight', 'Minimum spacing in replies']) assert.equal(await body.getByLabel(label, { exact: true }).count(), 1, `the plot form has ${label}`);
            await body.getByLabel('Record ID', { exact: true }).fill('broken-bell');
            await body.getByLabel('Record text', { exact: true }).fill('A cracked bell hangs over the eastern gate.');
            await body.getByLabel('Optional payoff guidance', { exact: true }).fill('The bell rings when the vanguard returns.');
            await body.getByLabel('Due story minute', { exact: true }).fill('120');
            await body.locator('[data-ri-record-editor]').scrollIntoViewIfNeeded();
            await shot(page, 'story-world-add-plot-form');
            await body.getByRole('button', { name: 'Save record', exact: true }).tap();
            await body.locator('[data-ri-record="you-broken-bell"]').waitFor({ timeout: 15000 });
            let seed = await youRecord('you-broken-bell');
            assert.equal(seed.kind, 'thread');
            assert.equal(seed.threadType, 'Seed');
            assert.equal(seed.data.payoff, 'The bell rings when the vanguard returns.');
            assert.equal(seed.data.due, 120);
            body = page.locator('#ri_root #ri_panel_page');
            await body.locator('[data-ri-record="you-broken-bell"]').getByRole('button', { name: 'Edit', exact: true }).tap();
            const editText = body.getByLabel('Record text', { exact: true });
            assert.equal(await editText.inputValue(), 'A cracked bell hangs over the eastern gate.', 'Edit opens her record');
            assert.ok(await body.getByLabel('Record type', { exact: true }).isDisabled(), 'the type is fixed on Edit');
            await editText.fill('A cracked bell hangs over the eastern gate. The keeper oils it each night.');
            await body.getByLabel('Status', { exact: true }).selectOption('done');
            await body.getByRole('button', { name: 'Save record', exact: true }).tap();
            await page.waitForFunction(async ({ B }) => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return /oils it/.test(F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('you-broken-bell')?.text || ''); }, { B }, { timeout: 15000 });
            seed = await youRecord('you-broken-bell');
            out.checks.editSeed = seed;
            assert.equal(seed.status, 'done', 'Status done closes the thread');
            assert.equal(seed.data.payoff, 'The bell rings when the vanguard returns.', 'Edit keeps the fields she did not change');
            assert.ok(seed.locked, 'still locked');
            assert.deepEqual((await origins('you-broken-bell')).map(row => row.op), ['add', 'lock', 'revise'], 'Edit revises the same record');
            assert.equal(L.requests().length, 0, 'Add record and Edit make no model call');
            // Chapters, Retired and Needs you offer no Add record
            for (const f of ['chapters', 'retired', 'needs']) {
                await page.locator(`#ri_root #ri_panel_page [data-ri-filter="${f}"]`).tap();
                await page.waitForTimeout(600);
                assert.equal(await page.locator('#ri_root #ri_panel_page').getByRole('button', { name: 'Add record', exact: true }).count(), 0, `${f} has no Add record`);
            }
            body = page.locator('#ri_root #ri_panel_page');
        }
        // Retired: supersede the fact by code, then Restore it
        await page.evaluate(async B => { const S = await import(`${B}/src/memory/store.js`); await S.memoryStore().record([{ op: 'retire', target: ['hale-debt'], origin: { type: 'upkeep', route: 'code' }, reason: 'test' }]); }, B);
        body = await openPage(page, 'world');
        await body.locator('[data-ri-filter="retired"]').tap();
        await page.waitForTimeout(900);
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('[data-ri-record="hale-debt"]').getByRole('button', { name: 'Restore' }).tap();
        await page.waitForTimeout(1200);
        assert.equal((await fold(page, 'hale-debt')).status, 'current', 'Restore brings the record back');
        // Undo from the history of automatic changes
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator('#ri-story-world-history summary').tap();
        await page.waitForTimeout(500);
        await page.locator('#ri-story-world-history').scrollIntoViewIfNeeded();
        await shot(page, 'story-world-history');
        // The story so far and the book actions
        await page.locator('#ri-story-so-far').scrollIntoViewIfNeeded();
        await shot(page, 'story-world-story-so-far');

        // ---- the tray's Plot card: type (its section), title, status and the quote that last moved the thread
        await page.evaluate(async B => {
            const C = await import(`${B}/src/cards/catalog.js`);
            const T = await import(`${B}/src/ui/tray-settings.js`);
            let config = C.setMode(T.trayCardConfig(), 'plot', 'tray');
            config = { ...config, on: { ...config.on, [C.sectionKey('plot', 'plotlines')]: true } };
            T.saveCardConfig(config);
            const { app } = await import(`${B}/src/ui/panel.js`);
            await app.setExpanded(false);
            (await import(`${B}/src/ui/sent.js`)).refreshUnderReplies();
        }, B);
        await page.waitForTimeout(1500);
        const plotRow = await page.evaluate(async B => {
            const P = await import(`${B}/src/ui/cards/plot.js`);
            const c = SillyTavern.getContext();
            const t = P.threadsAt(c.chat.length - 1).find(r => r.id === 'smugglers');
            return t ? { quote: t.quote || '', row: P.threadRow(t) } : null;
        }, B);
        out.checks.plotCard = plotRow;
        assert.ok(plotRow?.quote, 'the thread carries the quote of its newest version');
        assert.ok(plotRow.row.note.includes(`"${plotRow.quote}"`), 'the Plot card row shows that quote');
        const tray = page.locator('#chat .last_mes .ri-tray:not(.ri-tray-loading)');
        await tray.waitFor({ timeout: 30000 });
        const line = tray.locator('.ri-tray-line', { hasText: 'Plot' });
        const tab = tray.getByRole('tab', { name: /^Plot/ });
        // A tray on the Strip shows neither; tapping its summary opens it, and only then is the Plot line or tab chosen.
        const shown = async () => await line.first().isVisible().catch(() => false) || await tab.first().isVisible().catch(() => false);
        if (!await shown() && await tray.getAttribute('data-view') === 'strip') {
            await tray.locator('.ri-tray-summary').tap();
            await page.waitForFunction(() => document.querySelector('#chat .last_mes .ri-tray:not(.ri-tray-loading)')?.dataset.view !== 'strip', null, { timeout: 10000 });
        }
        // Compact lists only the cards with a first line; Expanded has a tab for every card.
        if (!await shown()) await tray.locator('.ri-tray-view[aria-label="Expanded"]').tap();
        const target = await line.first().isVisible().catch(() => false) ? line : tab;
        await target.first().tap({ timeout: 10000 });
        await page.waitForTimeout(800);
        const plotText = await tray.textContent();
        assert.ok(plotText.includes('Plotlines') && plotText.includes('Smugglers'), 'the Plot card draws the plotline');
        await page.locator('#chat .last_mes').screenshot({ path: path.join(dir, 'plot-card-quote.png') });
        out.shots.push(path.join(dir, 'plot-card-quote.png'));

        // ---- 4. Export as World Info book
        const snapshot = () => page.evaluate(() => { const c = SillyTavern.getContext(); return JSON.stringify([c.chatMetadata.ri_memory?.log || [], c.chat.map(m => m.extra?.ri_memory || null)]); });
        await openPage(page, 'world');
        const chatBefore = await snapshot();
        await page.locator('#ri-story-world-book').scrollIntoViewIfNeeded();
        await shot(page, 'story-world-book');
        await page.locator('#ri-story-world-book').getByRole('button', { name: 'Export as World Info book' }).tap();
        await page.locator('#ri-story-world-book [role="status"]', { hasText: 'Saved' }).waitFor({ timeout: 20000 });
        const exported = await page.evaluate(async () => {
            const text = document.querySelector('#ri-story-world-book [role="status"]').textContent;
            const name = text.match(/Saved "([^"]+)"/)[1];
            const c = SillyTavern.getContext();
            const data = await c.loadWorldInfo(name);
            return { name, entries: Object.values(data?.entries || {}).map(e => e.content), marker: !!data?.extensions?.roleplay_instructions_generated };
        });
        out.checks.export = { name: exported.name, entries: exported.entries.length };
        assert.ok(exported.entries.length >= 2, 'the export holds the records');
        assert.ok(!exported.entries.some(t => /forty silver/.test(t)), 'secrets left out by default');
        assert.equal(await snapshot(), chatBefore, 'chat data unchanged by the export');
        // SillyTavern's World Info screen opens it
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.setExpanded(false); }, B);
        const opened = await page.evaluate(async ({ B, name }) => {
            await (await import(`${B}/src/st.js`)).refreshWorldList();
            await new Promise(r => setTimeout(r, 800));
            return (await import(`${B}/src/chat-books.js`)).openHostBook(name);
        }, { B, name: exported.name });
        assert.ok(opened, 'the World Info editor finds the exported book');
        await page.waitForTimeout(2000);
        const listed = await page.locator('#world_popup_entries_list .world_entry').count();
        out.checks.export.listedInWorldInfo = listed;
        assert.ok(listed >= 2, 'SillyTavern\'s World Info screen lists the exported entries');
        await shot(page, 'export-world-info');
        await page.evaluate(() => { if (document.querySelector('#WorldInfo').getClientRects().length) document.querySelector('#WIDrawerIcon')?.click(); });

        // ---- 5. Story, World Info, Books and memory
        await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            await c.saveWorldInfo('Docks events', { entries: { 0: { uid: 0, key: ['docks'], keysecondary: [], comment: 'Raid', content: 'The watch raids the docks.', constant: false, selective: false, probability: 20, useProbability: true, group: 'Story events', disable: false, order: 100, position: 4, depth: 1 } } }, true);
            await c.updateWorldInfoList?.();
        });
        await page.evaluate(async B => { (await import(`${B}/src/book-triggers.js`)).setRecallManages('Docks events', true); await (await import(`${B}/src/st.js`)).refreshWorldList(); }, B);
        body = await openPage(page, 'books-memory');
        const docks = body.locator('[data-ri-book="Docks events"]');
        await docks.waitFor({ timeout: 20000 });
        assert.equal(await docks.getAttribute('data-ri-book-kind'), 'behavior', 'a book with chance and group fields is Behavior');
        assert.equal(await docks.locator('[role="switch"]').getAttribute('aria-checked'), 'false', 'with "Recall manages this book" off');
        assert.ok(await docks.locator('select[aria-label="Story may add to Docks events"]').count() === 1, 'and its Story may add switch');
        const exportedRow = body.locator(`[data-ri-book="${exported.name}"]`);
        assert.equal(await exportedRow.getAttribute('data-ri-book-kind'), 'reference', 'the exported book is an ordinary book');
        await docks.scrollIntoViewIfNeeded();
        await shot(page, 'world-info-books');
        await body.locator('#ri-behavior-books select[aria-label="Receive story events"]').selectOption('Docks events');
        await page.waitForTimeout(1200);
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chatMetadata.ri_memory.behavior?.receive), 'Docks events', 'Receive story events is kept in chat data');
        await page.locator('#ri-behavior-books').scrollIntoViewIfNeeded();
        await shot(page, 'world-info-behavior');

        // ---- 6c. The message menu entries, and Memory from this reply
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.setExpanded(false); (await import(`${B}/src/ui/message-menu.js`)).refreshMessageMenu(); }, B);
        const firstReply = await page.evaluate(() => SillyTavern.getContext().chat.findIndex((m, i) => i > 0 && !m.is_user));
        const ids = await page.evaluate(i => [...document.querySelectorAll(`#chat .mes[mesid="${i}"] .ri-mes-button`)].map(n => n.dataset.riEntry), firstReply);
        out.checks.menu = ids;
        assert.ok(ids.includes('close-chapter') && ids.includes('memory-reply'), 'the message menu carries both memory entries');
        await L.openMenuEntry(page, 'memory-reply', firstReply);
        await page.waitForTimeout(1200);
        body = page.locator('#ri_root #ri_panel_page');
        await body.locator(`[data-ri-reply-filter="${firstReply}"]`).waitFor({ timeout: 15000 });
        assert.ok(await body.locator('[data-ri-record="hale"]').count() === 1, 'Memory from this reply lists what it filed');
        await shot(page, 'story-world-from-reply');

        // ---- Review, Replies: the Sent card links to What was sent and lists the story rules that fired (B41)
        const lastReply = await page.evaluate(async B => {
            const R = await import(`${B}/src/story-rules.js`);
            const c = SillyTavern.getContext();
            const i = c.chat.length - 1;
            const ex = c.chat[i].extra.roleplay_instructions ||= {};
            ex.items ||= [];
            R.storeRules(c.chat[i], { fired: [{ when: 'Hale trust is 8 or more', why: 'trust 8', then: { kind: 'direction', text: 'Hale shares what he knows about the crates.' }, repeat: 'once in this chat' }] });
            return i;
        }, B);
        body = await openPage(page, 'sent');
        const card = body.locator(`#ri-review-reply-${lastReply}`);
        await card.waitFor({ timeout: 15000 });
        if (!await card.evaluate(node => node.open)) await card.locator('summary').first().tap();
        await card.locator('[data-story-rules-fired]').waitFor({ timeout: 10000 });
        assert.match(await card.locator('[data-story-rules-fired]').textContent(), /Hale trust is 8 or more/, 'the Sent card lists the story rule that fired');
        await card.locator('[data-story-rules-fired]').scrollIntoViewIfNeeded();
        await shot(page, 'sent-card-rules');
        await card.getByRole('button', { name: 'What the model saw' }).tap();
        await page.waitForTimeout(1500);
        assert.equal(await page.locator(`#ri_root [data-ri-sent-view="${lastReply}"]`).count(), 1, 'What the model saw opens What was sent on that reply');

        // ---- touch pass: no page overflows sideways and buttons are reachable
        const overflow = [];
        for (const id of ['memory', 'world', 'what-was-sent', 'books-memory']) {
            await openPage(page, id);
            const wide = await page.evaluate(() => { const b = document.querySelector('#ri_root #ri_panel_page'); return b.scrollWidth > b.clientWidth + 1 || document.querySelector('#ri_root').scrollWidth > document.querySelector('#ri_root').clientWidth + 1; });
            if (wide) overflow.push(id);
        }
        out.checks.overflow = overflow;
        assert.deepEqual(overflow, [], 'no page overflows sideways');
        const bad = errors.filter(e => !/favicon|net::ERR|Failed to fetch|ResizeObserver/.test(e));
        out.checks.errors = bad;
        assert.deepEqual(bad, [], 'no page errors');
        out.pass = true;
        console.log('PASS t_memory_ui');
    } catch (error) {
        out.pass = false;
        out.error = String(error?.stack || error);
        await page.screenshot({ path: path.join(dir, 'fail.png') }).catch(() => {});
        console.error(error);
        process.exitCode = 1;
    } finally {
        fs.writeFileSync(path.join(dir, 'memory-ui.json'), JSON.stringify(out, null, 2));
        await browser.close();
    }
})();
