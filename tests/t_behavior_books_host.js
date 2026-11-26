// MB12 browser suite on a SillyTavern 1.19.0 host with the mock model, touch at 412 x 900 (memory DESIGN 7.6):
//   1. A third-party behavior book imported through SillyTavern's own import is a behavior book and opens in its World Info
//      screen.
//   2. SillyTavern's real scan fires the same entries of that book with the extension on and off over RI_MB12_TURNS real
//      generations (default 200), Math.random seeded per turn; with the extension on each reply stores the ids that fired.
//   3. New behavior book and Draft entries (one Writer call through the mock): the entries sit at depth 1 with the system
//      role. On a turn where the event fires, the first changed message of the request is at depth 1; the fired id is
//      stored per swipe and reaches capture, which files the event as a Thread; the one-shot event is disabled, with Undo.
//   4. A chapter close files event seeds into the book the extension made; deleting the chapter takes them back out.
//   5. Export: only SillyTavern's fields, the same bytes as SillyTavern's own Export, byte-identical after taking back the
//      logged additions, and the exported file imports and opens in the World Info screen.
// Run with the host variables of tests/README.md. RI_EVIDENCE names the folder for screenshots and behavior-host.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const TURNS = Number(process.env.RI_MB12_TURNS || 200);
const SEED = Number(process.env.RI_MB12_SEED || 7);
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'MB12');
fs.mkdirSync(dir, { recursive: true });
const FIXTURE = path.join(__dirname, 'fixtures', 'mb12', 'Story events and styles.json');
const NAME = 'Story events and styles';
const out = { run: new Date().toISOString(), turns: TURNS, seed: SEED, checks: {} };
const pass = (name, detail = '') => console.log(`PASS ${name}${detail ? ` | ${detail}` : ''}`);
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const replyRows = () => L.requests('all').filter(r => r.kind === 'reply');

// The words of the turns cycle through the book's keys, so keyed entries, the NOT ANY filter and the AND ALL filter all
// get turns that can fire them.
const LINES = [
    'I ask Hale whether the courier from Valen has come.', 'We ride to the ford and wait for the toll.', 'I watch Night graze in the paddock.',
    'Heather looks at Hale across the fire.', 'Marten checks the girths before we leave.', 'The wind smells of brine from Saltmar.',
    'Rain starts as Night shakes her mane.', 'I ask about the dispatch from Valen.', 'Heather and Hale share the last of the bread.',
    'A storm darkens the sky over the ford.', 'I tell Marten to take the rear.', 'We camp on the road and count the wagons.',
];
const lineOf = i => `${LINES[i % LINES.length]} (turn ${i + 1})`;

async function settle(page) {
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(300);
        const busy = await page.evaluate(async B => { try { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running || !!Q.desktopQueue().stats().queued; } catch { return false; } }, B).catch(() => false);
        if (!busy) break;
    }
    await page.waitForTimeout(400);
}

/** Install the per-turn seeded Math.random and the test's own record of what SillyTavern's scan activated. */
async function watchScan(page) {
    await page.evaluate(({ seed, name }) => {
        const c = SillyTavern.getContext();
        const ev = c.eventTypes;
        const real = globalThis.__mb12Real ||= Math.random;
        const mulberry = a => () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
        // one row per real generation, in order: the generation number seeds its rolls in both runs
        globalThis.__mb12 = { fired: [], gen: null };
        if (globalThis.__mb12Wired) return;
        globalThis.__mb12Wired = true;
        c.eventSource.on(ev.GENERATION_STARTED, (type, opts, dry) => {
            // a dry run (token counts) or a quiet generation started meanwhile belongs to no turn and leaves the turn's record alone
            if (dry || type === 'quiet' || opts?.quiet_prompt) return;
            globalThis.__mb12.fired.push([]);
            (globalThis.__mb12.types ||= []).push(`${type} at ${c.chat.length}, book ${c.chatMetadata.world_info || 'none'}`);
            globalThis.__mb12.gen = { type, n: globalThis.__mb12.fired.length };
        });
        // The last listener of WORLDINFO_ENTRIES_LOADED runs just before a scan rolls. Every scan of a turn starts from the
        // turn's seed (the chat length), so a dry run SillyTavern makes to count tokens neither shifts nor shares the rolls of
        // the real scan. Dry runs save no timed effects.
        c.eventSource.on(ev.WORLDINFO_ENTRIES_LOADED, () => { if (globalThis.__mb12.gen) Math.random = mulberry(seed * 100003 + c.chat.length); });
        c.eventSource.on(ev.WORLD_INFO_ACTIVATED, list => {
            const g = globalThis.__mb12.gen;
            if (!g || g.done) return;
            g.done = true;
            globalThis.__mb12.fired[g.n - 1] = list.filter(e => e.world === name).map(e => Number(e.uid)).sort((a, b) => a - b);
            (globalThis.__mb12.others ||= [])[g.n - 1] = list.filter(e => e.world !== name).map(e => `${e.world}: ${String(e.comment || e.uid).slice(0, 40)}`);
        });
        c.eventSource.on(ev.GENERATION_ENDED, () => { Math.random = real; });
    }, { seed: SEED, name: NAME });
}

/** A fresh chat with the imported book bound to it. */
async function bookChat(page, name = NAME) {
    await L.openChat(page);
    // with the extension loaded, the chat's memory moves into chat data when it opens; bind the book after that save
    await page.waitForFunction(() => !document.querySelector('#ri_root') || !!SillyTavern.getContext().chatMetadata?.ri_memory?.imported, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(async name => { const c = SillyTavern.getContext(); c.chatMetadata.world_info = name; await c.saveMetadata(); }, name);
    await page.waitForTimeout(800);
}

/** RI_MB12_TURNS generations; returns { fired: [ids per turn], stored: [ids per reply] }. */
async function seededRun(page, label) {
    await bookChat(page);
    await watchScan(page);
    const t = Date.now();
    for (let i = 0; i < TURNS; i++) {
        // With the extension on, capture and upkeep from the last reply run in the background. Any Math.random call they
        // make while a scan awaits a listener takes a draw from the seeded stream, so wait for them before every turn.
        if (label === 'extension on') await settle(page);
        await L.send(page, lineOf(i));
        if (i % 25 === 24) { console.log(`  ${label}: ${i + 1} turns, ${Math.round((Date.now() - t) / 1000)} s`); await settle(page); }
    }
    await settle(page);
    const got = await page.evaluate(({ name, turns }) => {
        const c = SillyTavern.getContext();
        const fired = globalThis.__mb12.fired, stored = [];
        for (let i = 1; i < c.chat.length; i++) {
            const m = c.chat[i];
            if (m.is_user || m.is_system) continue;
            const v = m.extra?.ri_fired;
            stored.push(v && v.swipe === (m.swipe_id || 0) ? v.entries.filter(e => e.book === name).map(e => Number(e.uid)).sort((a, b) => a - b) : null);
        }
        return { fired, stored: stored.slice(0, turns), types: globalThis.__mb12.types || [], others: globalThis.__mb12.others || [], chatId: c.getCurrentChatId() };
    }, { name: NAME, turns: TURNS });
    console.log(`  ${label}: ${got.fired.length} turns in ${Math.round((Date.now() - t) / 1000)} s, ${got.fired.flat().length} firings`);
    return got;
}

async function reload(page) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'), null, { timeout: 90000 });
    await page.waitForTimeout(2000);
}

async function setExtension(page, on) {
    // SillyTavern's own switch in Extensions, Manage extensions: it saves the settings before it returns
    await page.evaluate(async on => {
        const X = await import('/scripts/extensions.js');
        const id = 'third-party/roleplay-instructions';
        const off = (SillyTavern.getContext().extensionSettings.disabledExtensions || []).includes(id);
        if (on && off) await X.enableExtension(id, false);
        if (!on && !off) await X.disableExtension(id, false);
        // a settings save already in flight can land after this one; wait until the server holds the switch
        const c = SillyTavern.getContext();
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 500));
            const res = await fetch('/api/settings/get', { method: 'POST', headers: c.getRequestHeaders(), body: '{}' });
            const saved = JSON.parse((await res.json()).settings || '{}').extension_settings?.disabledExtensions || [];
            if (saved.includes(id) === !on) return;
            if (i % 4 === 3) await (await import('/script.js')).saveSettings();
        }
        throw new Error('The extension switch was not saved.');
    }, on);
    await reload(page);
    const loaded = await page.evaluate(() => !!document.querySelector('#ri_root, .ri-composer-bar, [data-ri-tab]'));
    return loaded;
}

async function openBookInEditor(page, name) {
    const opened = await page.evaluate(async ({ B, name }) => (await import(`${B}/src/chat-books.js`)).openHostBook(name), { B, name });
    assert.ok(opened, `${name} opens in the World Info editor`);
    await page.waitForFunction(() => document.querySelectorAll('#world_popup_entries_list .world_entry').length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    return page.evaluate(() => ({
        entries: document.querySelectorAll('#world_popup_entries_list .world_entry').length,
        titles: [...document.querySelectorAll('#world_popup_entries_list .world_entry textarea[name="comment"]')].map(t => t.value),
    }));
}

async function closeEditor(page) {
    await page.evaluate(() => { const d = document.querySelector('#WIDrawerIcon'); if (document.querySelector('#WorldInfo.openDrawer')) d?.click(); });
    await page.waitForTimeout(500);
}

async function importFile(page, file) {
    await page.setInputFiles('#world_import_file', file);
    const name = path.basename(file, '.json');
    await page.waitForFunction(n => (SillyTavern.getContext().getWorldInfoNames?.() || []).includes(n), name, { timeout: 20000 });
    await page.waitForTimeout(800);
    return name;
}

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: 412, height: 900, hasTouch: true, isMobile: true });
    page.setDefaultTimeout(60000);
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await page.evaluate(() => SillyTavern.getContext().accountStorage.setItem('WI_PerPage', '50'));

        // ------------------------------------------------------------ 1. import through SillyTavern's own import
        await page.evaluate(n => SillyTavern.getContext().getWorldInfoNames().includes(n) && import('/scripts/world-info.js').then(W => W.deleteWorldInfo(n)), NAME);
        await importFile(page, FIXTURE);
        const imported = await page.evaluate(async ({ B, name }) => {
            const BB = await import(`${B}/src/memory/behavior-books.js`);
            const data = await SillyTavern.getContext().loadWorldInfo(name);
            return { listed: (await BB.listBooks({ names: [name] }))[0], stText: JSON.stringify(data), foreign: BB.foreignParts(data) };
        }, { B, name: NAME });
        assert.equal(imported.listed.kind, 'behavior');
        assert.equal(imported.stText, JSON.stringify(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))), 'SillyTavern stored the file as given');
        let shown = await openBookInEditor(page, NAME);
        assert.equal(shown.entries, 12);
        await page.screenshot({ path: path.join(dir, 'import-world-info.png') });
        await closeEditor(page);
        out.checks.import = { kind: imported.listed.kind, traits: imported.listed.traits, editorEntries: shown.entries };
        pass('an imported third-party book with chance, groups and cooldowns is listed as a behavior book and opens in the World Info screen', JSON.stringify(imported.listed.traits));

        // ------------------------------------------------------------ 2. the same entries fire with the extension on and off
        const on = await seededRun(page, 'extension on');
        assert.equal(await setExtension(page, false), false, 'the extension is not loaded');
        await L.setupApi(page, { preset: null }).catch(() => {});
        const off = await seededRun(page, 'extension off');
        assert.equal(await setExtension(page, true), true, 'the extension is loaded again');
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        const firstDiff = on.fired.findIndex((ids, i) => JSON.stringify(ids) !== JSON.stringify(off.fired[i]));
        out.checks.seeded = { turns: on.fired.length, firings: on.fired.flat().length, firstDifference: firstDiff, perEntry: Object.fromEntries([...Array(12).keys()].map(u => [u, on.fired.filter(f => f.includes(u)).length])),
            storedMatches: on.stored.every((s, i) => JSON.stringify(s) === JSON.stringify(on.fired[i])), storedOff: off.stored.filter(Boolean).length };
        fs.writeFileSync(path.join(dir, 'seeded-runs.json'), JSON.stringify({ seed: SEED, on: on.fired, off: off.fired, storedOn: on.stored, typesOn: on.types, typesOff: off.types, othersOn: on.others, othersOff: off.others }, null, 0));
        assert.equal(on.fired.length, TURNS);
        assert.deepEqual(on.fired, off.fired, `the same entries fire with the extension on and off (first difference at turn ${firstDiff + 1})`);
        assert.ok(on.fired.flat().length > TURNS, 'the book fires on most turns');
        assert.ok(out.checks.seeded.storedMatches, 'with the extension on each reply stores exactly the ids that fired, per swipe');
        assert.equal(out.checks.seeded.storedOff, 0, 'with the extension off nothing is stored');
        const events = on.fired.map(f => f.filter(u => u <= 2).length);
        assert.ok(Math.max(...events) <= 1, 'inclusion group "Story events": at most one event a turn');
        pass(`SillyTavern's scan fires the same entries with the extension on and off over ${TURNS} seeded generations`, `${out.checks.seeded.firings} firings, seed ${SEED}`);

        // ------------------------------------------------------------ 3. a book the extension makes, a fired event, capture
        L.resetLog();
        await L.setSettings(page, { summary: { on: true, hide: true, minExchanges: 3, maxExchanges: 4 } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        L.mode({ behaviorDraft: { entries: [{ kind: 'event', title: 'Rival courier', content: 'A rival courier from Valen rides in asking for Hale.', people: [], places: ['Valen'], once: true }] } });
        const made = await page.evaluate(async B => {
            const BB = await import(`${B}/src/memory/behavior-books.js`);
            const c = SillyTavern.getContext();
            if (c.getWorldInfoNames().includes('RI Story events')) await (await import('/scripts/world-info.js')).deleteWorldInfo('RI Story events');
            const name = await BB.createBehaviorBook('RI Story events');
            const draft = await BB.draftEntries('a rival courier turns up now and then');
            const uids = await BB.saveDrafts(name, draft.items);
            c.chatMetadata.world_info = name;
            await c.saveMetadata();
            const data = await c.loadWorldInfo(name);
            return { name, uids, preview: draft.preview, entry: data.entries[uids[0]], foreign: BB.foreignParts(data), receive: BB.receiveBookOf(c.chatMetadata) };
        }, B);
        assert.equal(L.requests('behavior').length, 1, 'Draft entries is one Writer call');
        assert.deepEqual([made.entry.depth, made.entry.role, made.entry.position, made.entry.probability, made.entry.group, made.entry.cooldown], [1, 0, 4, 10, 'Story events', 10]);
        assert.deepEqual(made.foreign, [], 'nothing of ours inside the book');
        assert.equal(made.receive, 'RI Story events');
        shown = await openBookInEditor(page, 'RI Story events');
        await page.screenshot({ path: path.join(dir, 'made-book-world-info.png') });
        await closeEditor(page);
        out.checks.made = { entry: made.entry, editor: shown };
        pass('New behavior book and Draft entries: one Writer call, the entry at depth 1 with the system role, nothing of ours in the book');

        // capture files the place and the knight, so seeds can name them
        const answer = ops => ({ decisions: { durable_change: !!ops.length, scene_ended: false, out_of_character: false }, ops, state: { scene: { place: 'Elerian Keep gate', time: 'Day 1, dusk', present: ['Hale'] } } });
        L.mode({ capture: answer([]), reply: 'Reply. Hale waits at the gate of Elerian Keep while the wind turns cold.' });
        // turn 1: the event does not fire (rolls high); two swipes, the second with the roll forced low so it fires
        await page.evaluate(() => { globalThis.__mb12Force = 0.99; const r = globalThis.__mb12Real ||= Math.random; const c = SillyTavern.getContext(); if (!globalThis.__mb12ForceWired) { globalThis.__mb12ForceWired = true; c.eventSource.on(c.eventTypes.WORLDINFO_ENTRIES_LOADED, () => { if (globalThis.__mb12Force != null) Math.random = () => globalThis.__mb12Force; }); c.eventSource.on(c.eventTypes.GENERATION_ENDED, () => { Math.random = r; }); } });
        await L.send(page, 'I wait at the gate with Hale and watch the road east for riders from Valen.');
        await settle(page);
        await L.swipe(page);
        await settle(page);
        const quiet = replyRows().at(-1);
        L.mode({ capture: answer([{ op: 'add', id: 'courier-valen', target: [], kind: 'thread', thread_type: 'Open', subject: 'Courier from Valen', text: 'A rival courier from Valen rode in and asked for Hale at the gate.', quote: 'A rival courier from Valen rode in' }]),
            reply: 'A rival courier from Valen rode in at dusk and asked for Hale by name. Hale met him at the gate.' });
        await page.evaluate(() => { globalThis.__mb12Force = 0; });
        await L.swipe(page);
        await settle(page);
        await page.evaluate(() => { globalThis.__mb12Force = null; });
        const fired = replyRows().at(-1);
        const prev = quiet.messages, next = fired.messages;
        const at = (() => { const n = Math.min(prev.length, next.length); for (let i = 0; i < n; i++) if (prev[i].role !== next[i].role || textOf(prev[i]) !== textOf(next[i])) return i; return n; })();
        const after = next.slice(at + 1).map(textOf);
        const eventAt = next.findIndex(m => textOf(m).includes('A rival courier from Valen rides in asking for Hale.'));
        const lastUser = next.map(m => m.role).lastIndexOf('user');
        const dump = list => list.map((m, i) => `${i} ${m.role} ${textOf(m).slice(0, 70).replace(/\n/g, ' ')}`);
        out.checks.depth = { messages: next.length, firstChanged: at, eventAt, lastUser, after: after.map(t => t.slice(0, 80)), dumpQuiet: dump(prev), dumpFired: dump(next) };
        assert.ok(eventAt >= 0, 'the event is in the request where it fired');
        assert.equal(eventAt, at, 'the first changed message is the fired event');
        assert.equal(lastUser, at + 1, 'one message follows it in the chat: the newest player message (depth 1)');
        assert.ok(after.slice(1).every(t => /^Reminder: write from the point of view/.test(t)), 'only the depth 0 reminder follows that');
        pass('on a turn where the event fires, the first changed message of the request is at depth 1', `message ${at} of ${next.length}`);

        const stored = await page.evaluate(async B => {
            const F = await import(`${B}/src/memory/fold.js`);
            const c = SillyTavern.getContext();
            const m = c.chat.at(-1);
            const rec = F.fold(c.chat, c.chatMetadata, { cache: false }).byId.get('courier-valen');
            const data = await c.loadWorldInfo('RI Story events');
            return { swipe: m.swipe_id, perSwipe: (m.swipe_info || []).map(s => s.extra?.ri_fired ? s.extra.ri_fired.entries.filter(e => e.book === 'RI Story events').map(e => `${e.book}#${e.uid}`) : null), shown: (m.extra?.ri_fired?.entries || []).map(e => `${e.book}#${e.uid}`), thread: rec ? { kind: rec.kind, type: rec.threadType, text: rec.text } : null, disabled: data.entries[0].disable, log: c.chatMetadata.ri_memory?.behavior?.disabled || [] };
        }, B);
        const captureRow = L.requests('capture').filter(r => textOf(r.messages.at(-1)).includes('A rival courier from Valen rode in')).at(-1);
        out.checks.capture = { stored, captureLine: (captureRow ? captureRow.messages.map(textOf).join('\n').match(/Behavior entries that fired: [^\n]*/) || [''] : [''])[0] };
        assert.deepEqual(stored.perSwipe.slice(0, 3), [[], [], ['RI Story events#0']], 'each swipe stores its own list; the event is stored with the swipe it fired on, and only there');
        assert.match(out.checks.capture.captureLine, /Rival courier/, 'the fired event reaches capture');
        assert.deepEqual(stored.thread, { kind: 'thread', type: 'Open', text: 'A rival courier from Valen rode in and asked for Hale at the gate.' }, 'the reply that acts on it files it as a Thread');
        assert.equal(stored.disabled, true, 'the one-shot event is disabled after it played');
        pass('the fired id is stored per swipe, reaches capture, the reply files a Thread, and the one-shot event is disabled');
        await page.evaluate(async B => { const FE = await import(`${B}/src/memory/fired-entries.js`); const c = SillyTavern.getContext(); await FE.undoOneShot(c.chatMetadata.ri_memory.behavior.disabled.at(-1).id); }, B);
        assert.equal(await page.evaluate(async () => (await SillyTavern.getContext().loadWorldInfo('RI Story events')).entries[0].disable), false, 'Undo enables it again');
        pass('Undo of the one-shot disable enables the entry again');

        // ------------------------------------------------------------ 4. event seeds from a chapter close
        L.mode({ capture: answer([
            { op: 'add', id: 'valen', target: [], kind: 'place', subject: 'Valen', text: 'Valen is the port the couriers ride from.', quote: 'Hale waits at the gate' },
            { op: 'add', id: 'marten', target: [], kind: 'person', subject: 'Ser Marten Drey', text: 'Ser Marten Drey rides at the rear of the column.', quote: 'Hale waits at the gate' },
        ]), reply: 'Reply. Hale waits at the gate of Elerian Keep while the wind turns cold.', chapterSeeds: ['Ser Marten Drey brings word from Valen that the toll has doubled.', 'A rider named Corvane Ashgrove arrives from Quillhaven.'] });
        for (let i = 0; i < 5; i++) { await L.send(page, `I keep watch at the gate, hour ${i + 1}.`); await settle(page); }
        await page.waitForFunction(async B => { const F = await import(`${B}/src/memory/fold.js`); const c = SillyTavern.getContext(); return F.fold(c.chat, c.chatMetadata, { cache: false }).current.some(r => r.kind === 'chapter' && r.seeds?.length); }, B, { timeout: 60000 });
        await L.send(page, 'I ask Hale who rides in.');
        await settle(page);
        await page.waitForFunction(async () => Object.keys((await SillyTavern.getContext().loadWorldInfo('RI Story events')).entries).length >= 2, null, { timeout: 30000 });
        const seeded = await page.evaluate(async B => {
            const c = SillyTavern.getContext();
            const data = await c.loadWorldInfo('RI Story events');
            const U = await import(`${B}/src/memory/upkeep.js`);
            return { entries: Object.values(data.entries).map(e => ({ uid: e.uid, comment: e.comment, content: e.content, key: e.key, probability: e.probability, group: e.group, cooldown: e.cooldown, depth: e.depth, role: e.role })),
                rows: U.historyRows(c.chat, c.chatMetadata, { jobs: ['additions'] }).map(r => ({ label: r.label, undo: !!r.undo, text: r.text })), log: c.chatMetadata.ri_memory.additions.filter(r => r.event) };
        }, B);
        const seedEntry = seeded.entries.find(e => /Ser Marten Drey brings word/.test(e.content));
        assert.ok(seedEntry, 'the grounded seed is an entry in the book the extension made');
        assert.ok(!seeded.entries.some(e => /Corvane/.test(e.content)), 'the seed naming no one in the records is dropped');
        assert.deepEqual([seedEntry.probability, seedEntry.group, seedEntry.cooldown, seedEntry.depth, seedEntry.role], [10, 'Story events', 10, 1, 0]);
        assert.deepEqual(seedEntry.key, ['Ser Marten Drey', 'Valen']);
        assert.ok(seeded.rows.some(r => r.label === 'Entry added: RI Story events' && r.undo), 'listed in History with Undo');
        shown = await openBookInEditor(page, 'RI Story events');
        assert.ok(shown.titles.some(t => /^Story event: Ser Marten Drey/.test(t)));
        await page.screenshot({ path: path.join(dir, 'seed-world-info.png') });
        await closeEditor(page);
        out.checks.seeds = seeded;
        pass('a chapter close files its grounded seed into the book the extension made, with Undo; the invented one is dropped');
        // delete the chapter's last message: its entry leaves the book
        const lastMark = seeded.log[0].source.mark;
        await page.evaluate(async ({ B, mark }) => {
            const F = await import(`${B}/src/memory/fold.js`);
            const c = SillyTavern.getContext();
            const i = c.chat.findIndex(m => F.storedMark(m) === mark);
            await c.executeSlashCommandsWithOptions(`/cut ${i}`);
        }, { B, mark: lastMark });
        await page.waitForFunction(async () => !Object.values((await SillyTavern.getContext().loadWorldInfo('RI Story events')).entries).some(e => /Ser Marten Drey brings word/.test(e.content)), null, { timeout: 30000 });
        pass('deleting the chapter\'s message removes the event entry it created');

        // ------------------------------------------------------------ 5. export and round trip
        const exp = await page.evaluate(async ({ B, name }) => {
            const BB = await import(`${B}/src/memory/behavior-books.js`);
            const ES = await import(`${B}/src/memory/event-seeds.js`);
            const A = await import(`${B}/src/memory/additions.js`);
            const U = await import(`${B}/src/memory/upkeep.js`);
            const c = SillyTavern.getContext();
            const before = JSON.stringify(await c.loadWorldInfo(name));
            // the imported book receives this chat's story events at Keywords, lines and entries
            await U.setBookLevel(name, 'full');
            await BB.setReceiveBook(name);
            c.chatMetadata.ri_memory.behavior.seeded = [];
            const r = await ES.seedChapters();
            const text = await BB.exportBook(name, { download: false });
            const exported = JSON.parse(text);
            const rows = c.chatMetadata.ri_memory.additions.filter(x => x.book === name);
            return { before, added: r.added.length, route: r.route, text, foreign: BB.foreignParts(exported), entries: Object.keys(exported.entries).length, back: JSON.stringify(A.withoutAdditions(exported, rows)) };
        }, { B, name: NAME });
        out.checks.export = { added: exp.added, route: exp.route, foreign: exp.foreign, entries: exp.entries, roundTrip: exp.back === exp.before };
        assert.equal(exp.route, 'entry');
        assert.ok(exp.added >= 1, 'the seed reached the imported book as a logged addition');
        assert.deepEqual(exp.foreign, [], 'the export holds only SillyTavern\'s own fields');
        assert.equal(exp.back, exp.before, 'the export, with the logged additions taken back, is byte-identical to the book as imported');
        // SillyTavern's own Export writes the same bytes
        await openBookInEditor(page, NAME);
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#world_popup_export')]);
        const stExport = fs.readFileSync(await download.path(), 'utf8');
        assert.equal(stExport, exp.text, 'SillyTavern\'s own Export writes the same file');
        await closeEditor(page);
        // the exported file imports and opens in the World Info screen
        const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mb12-')), `${NAME} export.json`);
        fs.writeFileSync(tmp, exp.text);
        fs.copyFileSync(tmp, path.join(dir, 'exported-book.json'));
        await page.evaluate(n => SillyTavern.getContext().getWorldInfoNames().includes(n) && import('/scripts/world-info.js').then(W => W.deleteWorldInfo(n)), `${NAME} export`);
        const again = await importFile(page, tmp);
        shown = await openBookInEditor(page, again);
        assert.equal(shown.entries, exp.entries, 'every entry of the export is listed in the World Info screen');
        await page.screenshot({ path: path.join(dir, 'export-world-info.png') });
        await closeEditor(page);
        pass('the exported book holds only SillyTavern fields, matches SillyTavern\'s Export, round-trips byte-identical apart from logged additions and opens in the World Info screen');

        out.errors = [...errors];
        assert.deepEqual(errors.filter(e => !/net::ERR|Failed to fetch/.test(e)), []);
    } finally {
        fs.writeFileSync(path.join(dir, 'behavior-host.json'), JSON.stringify(out, null, 1));
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
