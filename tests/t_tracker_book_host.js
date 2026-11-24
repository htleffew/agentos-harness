// B21 on a real SillyTavern 1.19 host with touch and the mock model: the Tracker World Info book written after capture, read
// back from the host's World Info editor, and its entries found once in the final request the mock logged, after the recall
// block. Swipe, edit, delete and branch each rewrite the book; Theirs leaves it empty of that feature; an edit typed in the
// book is replaced at the next rewrite. The mock's capture answer is set per step, so the values are the ones capture filed.
// Set RI_WIDTH (390 or 1006) and RI_EVIDENCE for the screenshots and tracker-host-<width>.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = Number(process.env.RI_HEIGHT || (WIDTH < 600 ? 900 : 900));
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;
const out = { width: WIDTH, checks: [], dumps: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };
const shot = async (page, name) => { if (EV) await page.screenshot({ path: path.join(EV, `w${WIDTH}-${name}.png`) }); };

const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const chatRequest = () => L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || '')).at(-1);
const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running; }, B); if (!busy) break; } await page.waitForTimeout(1800); };
const turn = async (page, text) => { await L.send(page, text); await settle(page); };
const bookName = page => page.evaluate(() => `RI Tracker, ${globalThis.SillyTavern.getContext().getCurrentChatId()}`);
const readBook = (page, name) => page.evaluate(async name => { const d = await globalThis.SillyTavern.getContext().loadWorldInfo(name); return d && Object.keys(d.entries || {}).length ? JSON.parse(JSON.stringify(d)) : null; }, name);
const body = data => Object.values(data?.entries || {}).filter(e => e.extensions?.ri_generated?.id !== 'stamp');
const titles = data => body(data).map(e => e.comment);
const sceneOf = data => body(data).find(e => e.comment === 'Scene')?.content || '';
/** Wait for the book to read as the test expects, up to a bound. */
async function waitBook(page, name, ok, ms = 12000) {
    const until = Date.now() + ms; let data = null;
    while (Date.now() < until) { data = await readBook(page, name); if (data && ok(data)) return data; await page.waitForTimeout(500); }
    return data;
}
const captureState = (place, names, extra = {}) => ({
    decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [],
    state: {
        scene: { place, time: 'Day 3, Thursday, 21:40', weather: 'rain, cold', present: names },
        characters: [{ name: names[0], doing: 'Wiping the same cup', mind: 'Counting exits' }, { name: names[1], doing: 'Reading the ledger', mind: 'Weighing the offer' }, { name: 'Dorn', doing: 'Asleep upstairs', mind: 'Nothing' }],
        emotions: [{ name: names[0], axes: { tenderness: 2, fury: 1, dread: 4, yearning: 0 }, outward: 'Calm', counterweight: 'Relief' }],
        relationships: [{ name: `${names[0]} and ${names[1]}`, pair: `${names[0]} and ${names[1]}`, level: 3 }],
        ...extra,
    },
});

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 30, maxExchanges: 60 }, recall: { values: { itemCap: 14 } }, trayCards: { on: { 'relationships.level': true } } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        const names = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { persona: c.name1, char: c.name2 }; });
        const present = [names.char, names.persona];
        const name = await bookName(page);
        out.book = name;

        // ------------------------------------------------------------ written after each capture
        L.mode({ capture: captureState('The Gilded Hound, taproom', present) });
        await turn(page, 'I step into the taproom and ask for the quiet table.');
        let data = await waitBook(page, name, d => titles(d).includes('Scene'));
        check('after the capture one book named for the chat holds the values', !!data && titles(data).includes('Scene'), `${name}: ${titles(data).join(' | ')}`);
        const t = titles(data);
        check('one entry per enabled card: scene, characters, emotions and relationships', ['Scene', `Characters: ${names.char}`, `Emotions: ${names.char}`, `Relationships: ${names.char} and ${names.persona}`].every(x => t.includes(x)), t.join(' | '));
        check('one entry per present character, none for the character who is not present', t.includes(`Characters: ${names.persona}`) && !t.includes('Characters: Dorn'), t.join(' | '));
        check('the first entry is disabled and says edits are replaced and where values are corrected', data.entries[0].disable === true && /replaced at the next rewrite/.test(data.entries[0].content) && /Correct a story fact/.test(data.entries[0].content), data.entries[0].content.slice(0, 160));
        check('the entries are Constant, at depth 1', body(data).every(e => e.constant === true && e.position === 4 && e.depth === 1 && e.disable === false));
        check('no emoji in any entry', !Object.values(data.entries).some(e => /\p{Extended_Pictographic}/u.test(`${e.comment}${e.content}`)));
        const meta = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.SillyTavern.getContext().chatMetadata.ri_memory.trackerBook || null)));
        check('chat data names the cards the book carries and its size', meta && meta.cards.includes('scene') && meta.tokens > 0 && meta.cap > 0, JSON.stringify(meta)?.slice(0, 200));
        out.dumps.book = body(data).map(e => ({ comment: e.comment, content: e.content }));

        // ------------------------------------------------------------ Story, World Info and Review, Context
        await page.evaluate(async () => { const { app } = await import('/scripts/extensions/third-party/roleplay-instructions/src/ui/panel.js'); await app.openPage('books', { focusPage: true }); await app.setExpanded(true); });
        await page.waitForTimeout(1200);
        const tab = page.locator('#ri_root').getByText('Tracker book', { exact: true }).first();
        check('Story, World Info lists the section "Tracker book"', await tab.count() > 0, '');
        if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(600); }
        const visible = await page.evaluate(() => document.querySelector('#ri-tracker-book')?.innerText || '');
        check('the section states the reply, the size against its limit and lists the entries', !/null|undefined/.test(visible) && /Reflects reply \d+/.test(visible) && /tokens? of/.test(visible) && /Scene/.test(visible), visible.replace(/\n/g, ' | ').slice(0, 300));
        await page.evaluate(() => document.querySelector('#ri-tracker-book')?.scrollIntoView());
        await page.waitForTimeout(300);
        await shot(page, '1-tracker-book-section');
        await page.evaluate(async () => { const { app } = await import('/scripts/extensions/third-party/roleplay-instructions/src/ui/panel.js'); await app.openPage('context', { focusPage: true }); await app.setExpanded(true); });
        await page.waitForTimeout(1200);
        const reviewTab = page.locator('#ri_root').getByText('Tracker book', { exact: true }).first();
        if (await reviewTab.count()) { await reviewTab.click().catch(() => {}); await page.waitForTimeout(600); }
        const size = await page.evaluate(() => document.querySelector('#ri-tracker-size')?.innerText || '');
        check('Review, Context shows the total size of the book', /Tracker book holds [\d,]+ tokens? of [\d,]+ tokens?/.test(size), size);
        await shot(page, '2-review-context');
        await page.evaluate(async () => { const { app } = await import('/scripts/extensions/third-party/roleplay-instructions/src/ui/panel.js'); await app.setExpanded(false); });

        // ------------------------------------------------------------ the host's World Info editor and its Export
        const opened = await page.evaluate(async ({ B, name }) => {
            const { openHostBook } = await import(`${B}/src/chat-books.js`);
            const ok = openHostBook(name);
            await new Promise(r => setTimeout(r, 1800));
            const select = document.querySelector('#world_editor_select');
            const rows = document.querySelectorAll('#world_popup_entries_list .world_entry');
            return { ok, selected: select?.selectedOptions?.[0]?.textContent?.trim() || '', rows: rows.length, comments: [...document.querySelectorAll('#world_popup_entries_list .world_entry [name="comment"]')].map(x => x.value) };
        }, { B, name });
        check('the book is in SillyTavern\'s World Info editor, entry for entry', opened.selected === name && opened.rows === Object.keys(data.entries).length && opened.comments.includes('Scene'), JSON.stringify(opened).slice(0, 300));
        await shot(page, '3-world-info-editor');
        const exported = await page.evaluate(async name => {
            const c = globalThis.SillyTavern.getContext();
            const r = await fetch('/api/worldinfo/get', { method: 'POST', headers: c.getRequestHeaders(), body: JSON.stringify({ name }) });
            const j = await r.json();
            return { ok: r.ok, entries: Object.values(j.entries || {}).map(e => e.comment) };
        }, name);
        check('the book exports through SillyTavern as an ordinary book', exported.ok && exported.entries.includes('Scene'), exported.entries.join(' | '));
        await page.evaluate(() => { document.querySelector('#WIDrawerIcon')?.click(); });
        await page.waitForTimeout(400);

        // ------------------------------------------------------------ the request
        L.resetLog();
        L.mode({ capture: captureState('The Gilded Hound, taproom', present) });
        await turn(page, 'I ask who sits by the fire.');
        const req = chatRequest();
        const msgs = req.messages.map(textOf);
        const all = msgs.join('\n');
        const hits = (all.match(/Place: The Gilded Hound, taproom/g) || []).length;
        const tracker = msgs.findIndex(t => /Place: The Gilded Hound, taproom/.test(t));
        const recall = msgs.findIndex(t => /<recall>/.test(t));
        check('the final request carries each tracker value once', hits === 1 && (all.match(/Counting exits/g) || []).length === 1 && (all.match(/tenderness 2/g) || []).length === 1, `${hits} hits of the place`);
        check('the tracker entries are the depth-1 block, with the recall block before them', tracker >= 0 && (recall < 0 || tracker >= recall) && (recall < 0 || tracker - recall <= 1), `recall at ${recall}, tracker at ${tracker}`);
        const recallText = msgs[recall] || '';
        check('the recall block holds no scene line, emotion or relationship record', !/<scene>/.test(recallText) && !/Wiping the same cup/.test(recallText), recallText.slice(0, 200));
        check('the disabled first entry is not sent', !/replaced at the next rewrite/.test(all));
        out.dumps.request = req.messages.map((m, i) => ({ i, role: m.role, head: textOf(m).slice(0, 120).replace(/\n/g, ' ') }));

        // ------------------------------------------------------------ a swipe, an edit, a delete
        L.mode({ capture: captureState('The cellar stairs', present) });
        await page.evaluate(() => { const swipe = document.querySelector('#chat .mes.last_mes .swipe_right'); swipe?.click(); });
        await settle(page);
        data = await waitBook(page, name, d => /cellar stairs/.test(sceneOf(d)));
        check('a new swipe rewrites the book to the values of the swipe shown', /cellar stairs/.test(sceneOf(data)) && !/Gilded Hound/.test(sceneOf(data)), sceneOf(data));
        await page.evaluate(() => { document.querySelector('#chat .mes.last_mes .swipe_left')?.click(); });
        data = await waitBook(page, name, d => /Gilded Hound/.test(sceneOf(d)));
        check('swiping back rewrites it to the first swipe\'s values', /Gilded Hound/.test(sceneOf(data)), sceneOf(data));
        // an edit: capture reads the edited reply again
        L.mode({ capture: captureState('The attic', present) });
        await page.evaluate(async () => {
            const c = globalThis.SillyTavern.getContext();
            const i = c.chat.length - 1;
            c.chat[i].mes = c.chat[i].mes + ' The lamp went out.';
            if (c.chat[i].swipes) c.chat[i].swipes[c.chat[i].swipe_id] = c.chat[i].mes;
            await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, i);
            // capture reads the edited reply again: the text no longer matches the stamp, so the reply is due
            const { queueCapture } = await import('/scripts/extensions/third-party/roleplay-instructions/src/memory/capture.js');
            const { effectiveModules } = await import('/scripts/extensions/third-party/roleplay-instructions/src/v10.js');
            await queueCapture({ modules: effectiveModules() });
        });
        await settle(page);
        data = await waitBook(page, name, d => /attic/.test(sceneOf(d)));
        check('an edit that capture reads rewrites the book', /attic/.test(sceneOf(data)), sceneOf(data));
        // a delete: the book goes back to the reply before it
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/del 1'); });
        await settle(page);
        data = await waitBook(page, name, d => !/attic/.test(sceneOf(d)));
        check('a delete rewrites the book to the reply before it', !!data && /Gilded Hound/.test(sceneOf(data)), sceneOf(data));

        // ------------------------------------------------------------ an edit typed in the book is replaced at the next rewrite
        await page.evaluate(async name => {
            const c = globalThis.SillyTavern.getContext();
            const d = await c.loadWorldInfo(name);
            const scene = Object.values(d.entries).find(e => e.comment === 'Scene');
            scene.content = 'Place: somewhere I typed in the editor';
            await c.saveWorldInfo(name, d, true);
        }, name);
        const typed = await readBook(page, name);
        check('an edit made in the World Info editor is saved', /typed in the editor/.test(sceneOf(typed)));
        await page.evaluate(async B => { const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().write(); }, B);
        data = await readBook(page, name);
        check('the next rewrite replaces it', /Gilded Hound/.test(sceneOf(data)) && !/typed in the editor/.test(sceneOf(data)), sceneOf(data));

        // ------------------------------------------------------------ Theirs
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); V.setModuleOwner(V.activePreset(), 'state', 'preset'); const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().write(); }, B);
        data = await readBook(page, name);
        const theirsTitles = titles(data);
        check('Story state on Theirs puts no scene or character values in the book', !!data && !theirsTitles.some(x => /^Scene|^Characters/.test(x)) && theirsTitles.some(x => /^Emotions|^Relationships/.test(x)), theirsTitles.join(' | '));
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); V.setModuleOwner(V.activePreset(), 'state', undefined); const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().write(); }, B);

        // ------------------------------------------------------------ a branch gets its own book
        L.mode({ capture: captureState('The roof', present) });
        const before = JSON.stringify(await readBook(page, name));
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/branch-create ' + (c.chat.length - 1)); });
        await page.waitForTimeout(3500);
        const branchName = await bookName(page);
        data = await waitBook(page, branchName, d => titles(d).includes('Scene'), 15000);
        const probe = await page.evaluate(async B => { const { trackerBook } = await import(`${B}/src/tracker-book.js`); const c = globalThis.SillyTavern.getContext(); const b = trackerBook(); return { receipts: b.receipts().slice(-3), name: b.name(), imported: !!c.chatMetadata?.ri_memory?.imported, tb: c.chatMetadata?.ri_memory?.trackerBook?.name, msgs: c.chat.length, hasTracker: c.chat.map(m => !!m.extra?.roleplay_instructions?.tracker) }; }, B);
        out.dumps.branchProbe = probe;
        check('a branch has its own Tracker book, with the copied values', branchName !== name && !!data && /Gilded Hound/.test(sceneOf(data)), `${branchName}: ${sceneOf(data)} ${JSON.stringify(probe)}`);
        await turn(page, 'In the branch I climb to the roof.');
        data = await waitBook(page, branchName, d => /roof/.test(sceneOf(d)));
        const trunk = JSON.stringify(await readBook(page, name));
        check('later changes in the branch never reach the first chat\'s book', /roof/.test(sceneOf(data)) && trunk === before, '');
        out.errors = errors.slice(0, 10);
        check('no page error', !errors.some(e => /roleplay-instructions/.test(String(e))), errors.slice(0, 3).join(' | '));
    } catch (error) {
        check('the run finished', false, String(error?.stack || error).slice(0, 600));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, `tracker-host-${WIDTH}.json`), JSON.stringify(out, null, 1));
        await browser.close();
    }
})();
