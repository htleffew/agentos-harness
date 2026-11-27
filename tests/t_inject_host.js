// MB5 on a real SillyTavern 1.19 host with touch and the mock model: the request layout of memory DESIGN 5.1 in the final
// payload (memory notes in the stable prefix, the chapter view directly above the history, the recall block at depth 1 and
// the reminder at depth 0, no story notes), two consecutive requests compared, a trimmed request at a 4,095-token context
// with the red mark and Review, Context naming the cut, Story state on Theirs, and the Tracker book's cards left out of the
// recall block. The host's mock must answer the capture and chapter prompts (tests/mock.js does).
// Set RI_EVIDENCE to a folder for the screenshots and inject-host.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 523), HEIGHT = Number(process.env.RI_HEIGHT || 1021);
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;
const out = { width: WIDTH, checks: [], dumps: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };
const shot = async (page, name) => { if (EV) await page.screenshot({ path: path.join(EV, `w${WIDTH}-${name}.png`) }); };

const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const chatRequest = () => L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || '')).at(-1);
const dump = r => (r?.messages || []).map((m, i) => ({ i, role: m.role, tokens: Math.ceil(textOf(m).length / 4), head: textOf(m).slice(0, 90).replace(/\n/g, ' ') }));
const settle = async page => { for (let i = 0; i < 40; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running; }, B); if (!busy) break; } await page.waitForTimeout(600); };
const layout = page => page.evaluate(async B => (await import(`${B}/src/context-budget.js`)).lastLayout(), B);
const turn = async (page, text) => { await L.send(page, text); await settle(page); };

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: true });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        // a larger item cap, so the closed chapter's exchange excerpts never crowd out the records each check looks for
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 3, maxExchanges: 6 }, recall: { values: { itemCap: 14 } }, trayCards: { mode: { scene: 'off', characters: 'off', emotions: 'off', relationships: 'off', plan: 'off' } } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });

        // ------------------------------------------------------------ the layout of a request in a chat with memory
        for (let n = 1; n <= 6; n++) await turn(page, `I ask Hale about the road to the ford, part ${n}.`);
        const closed = await page.evaluate(async B => (await import(`${B}/src/chapters.js`)).chapterState().chapters.filter(c => c.valid).length, B);
        check('a chapter closed after six exchanges', closed >= 1, `${closed} chapters`);
        // records as capture files them: the scene, a fact, an emotion and a relationship
        const names = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { persona: c.name1, char: c.name2 }; });
        await page.evaluate(async ({ B, persona, char }) => {
            const { memoryStore } = await import(`${B}/src/memory/store.js`);
            const origin = { type: 'you', route: 'test' };
            await memoryStore().record([
                { op: 'add', record: { id: 'scene', kind: 'scene', subject: 'scene', text: `Place: Valen Ford; Time: midday; Present: ${char}, ${persona}`, status: 'current' }, origin },
                { op: 'add', record: { id: 'ford', kind: 'fact', subject: 'Valen Ford', attribute: 'depth', text: 'Valen Ford is shallow after the rain and the wagons can cross at midday.', status: 'current', importance: 6 }, origin },
                { op: 'add', record: { id: 'worry', kind: 'emotion', subject: char, attribute: 'emotion', text: `${char} worries for ${persona} when the water rises at the ford.`, status: 'current', importance: 5 }, origin },
                { op: 'add', record: { id: 'trust', kind: 'relationship', subject: char, attribute: 'trust', other: persona, text: `${char} and ${persona} trust each other since the night at the gatehouse.`, status: 'current', importance: 5 }, origin },
            ]);
        }, { B, ...names });
        L.resetLog();
        await turn(page, 'I ask Hale whether the ford is safe after the rain.');
        const r1 = chatRequest();
        await turn(page, `I ride beside ${names.char} to Valen Ford and ask if he worries for me and whether he trusts me.`);
        const r2 = chatRequest();
        out.dumps.request1 = dump(r1); out.dumps.request2 = dump(r2);
        const msgs = r2.messages.map(textOf);
        const at = re => msgs.findIndex(t => re.test(t));
        const view = at(/<story_so_far>/), recall = at(/<recall>/), notes = at(/Memory notes\. The story_so_far tags/), reminder = at(/^Reminder: write from the point of view/);
        const firstOpen = at(/part 6\.|whether the ford is safe/);
        const lastUser = msgs.findLastIndex((t, i) => r2.messages[i].role === 'user');
        check('the memory notes sit in the stable prefix, above the chapter view', notes >= 0 && notes < view, `notes at ${notes}, view at ${view}`);
        check('the chapter view sits directly above the open chapter\'s history (prompt dump, SillyTavern 1.19.0)', view >= 0 && firstOpen > view && msgs.slice(view + 1, firstOpen).every((t, k) => r2.messages[view + 1 + k].role !== 'system'), `view at ${view}, first open-chapter message at ${firstOpen}: ${JSON.stringify(out.dumps.request2.slice(Math.max(0, view - 1), view + 3))}`);
        check('the recall block is the depth-1 block, directly above the last user message', recall >= 0 && recall === lastUser - 1, `recall at ${recall}, last user message at ${lastUser}`);
        const ours = msgs[recall] || '';
        check('with Story state on the extension, the recall block carries the scene line and the emotion and relationship records', /<scene>Valen Ford/.test(ours) && /worries for/.test(ours) && /trust each other/.test(ours), ours.slice(0, 400));
        check('the reminder is the depth-0 block, after the last user message', reminder > lastUser, `reminder at ${reminder}`);
        check('the request carries one memory block: no story notes', !msgs.some(t => /\[Story notes|\[Story memory/.test(t)), '');
        const mem = await layout(page);
        check('Review, Context reads the layout of the last request', mem && mem.layout.view === view && mem.cut.length === 0, JSON.stringify(mem?.layout));
        // two consecutive requests: the first changed message is the old recall block or after it
        const a = r1.messages.map(m => ({ role: m.role, content: textOf(m) })), b = r2.messages.map(m => ({ role: m.role, content: textOf(m) }));
        let first = 0; while (first < Math.min(a.length, b.length) && a[first].role === b[first].role && a[first].content === b[first].content) first++;
        const oldRecall = a.findIndex(m => /<recall>/.test(m.content));
        const oldTail = a.length - 3;
        check('between chapter closes the first changed message follows the history', first >= (oldRecall >= 0 ? oldRecall : oldTail), `first changed ${first}, old recall block at ${oldRecall}, ${a.length} then ${b.length} messages`);
        check('the extension\'s comparison agrees', mem?.cache && mem.cache.firstChanged === first && mem.cache.followsHistory, JSON.stringify(mem?.cache));
        out.firstChanged = { first, before: a.length, after: b.length, lostTokens: mem?.cache?.lostTokens };
        await shot(page, '1-chat');

        // ------------------------------------------------------------ Story state on Theirs, then the Tracker book
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); const K = await import(`${B}/src/preset-bank.js`); const bank = K.refreshBank(); const key = K.stackFor(bank, V.activePreset()).key; K.excludeCards(bank, key, ["ri::state","ri::dice"], { base: V.activePreset() }); (await import(`${B}/src/preset-workbench.js`)).syncOwners(); }, B);
        L.resetLog();
        await turn(page, `At Valen Ford I ask ${names.char} if he worries for me and whether he trusts me.`);
        const theirs = chatRequest();
        const theirsText = theirs.messages.map(textOf).join('\n');
        check('with Story state and Dice on Theirs the request carries no extension scene line or dice verdict', /<recall>/.test(theirsText) && !/<scene>/.test(theirsText) && !/Scene header|first line of (the|your) reply/i.test(theirsText) && !/\bverdict\b|\broll(ed)?\b.*\bd20\b/i.test(theirsText), (theirsText.match(/<recall>[\s\S]*?<\/recall>/) || [''])[0].slice(0, 300));
        const captures = L.requests('capture');
        const captureText = captures.map(r => r.messages.map(textOf).join('\n')).join('\n');
        check('capture still files records after the reply, and asks for the scene', captures.length >= 1 && /scene/i.test(captureText), `${captures.length} capture calls`);
        out.dumps.theirs = dump(theirs);
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); const K = await import(`${B}/src/preset-bank.js`); const bank = K.refreshBank(); const key = K.stackFor(bank, V.activePreset()).key; K.includeCards(bank, key, ["ri::state","ri::dice"], { base: V.activePreset() }); (await import(`${B}/src/preset-workbench.js`)).syncOwners(); }, B);
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); c.chatMetadata.ri_memory.trackerBook = { name: 'RI Tracker, test', cards: ['scene', 'characters', 'emotions', 'relationships'] }; });
        L.resetLog();
        await turn(page, `Still at Valen Ford I ask ${names.char} again if he worries for me and whether he trusts me.`);
        const tracked = chatRequest().messages.map(textOf).find(t => /<recall>/.test(t)) || '';
        check('with the Tracker book on, the recall block holds no scene line, emotion or relationship value (final payload)', /<recall>/.test(tracked) && /Valen Ford is shallow/.test(tracked) && !/<scene>|worries for|trust each other/.test(tracked), tracked.slice(0, 300));
        out.dumps.trackerRecall = tracked;
        await page.evaluate(async () => { delete globalThis.SillyTavern.getContext().chatMetadata.ri_memory.trackerBook; });

        // ------------------------------------------------------------ what upkeep holds out (MB7), in the final payload
        await page.evaluate(async ({ B, char }) => {
            const wi = await import('/scripts/world-info.js');
            const data = { entries: {} };
            const night = wi.createWorldInfoEntry('MB5 Lore', data); Object.assign(night, { key: ['Night'], comment: 'Night', content: 'Night is the black stallion of the captain, tall and sure of foot.' });
            const forge = wi.createWorldInfoEntry('MB5 Lore', data); Object.assign(forge, { key: ['Brannic'], comment: 'Brannic', content: 'Brannic keeps the forge at the keep gate and shoes the vanguard horses.' });
            await wi.saveWorldInfo('MB5 Lore', data, true);
            await wi.updateWorldInfoList();
            const c = globalThis.SillyTavern.getContext();
            c.chatMetadata.world_info = 'MB5 Lore';
            await c.saveMetadata();
            const { memoryStore } = await import(`${B}/src/memory/store.js`);
            const { storedMark } = await import(`${B}/src/memory/fold.js`);
            const origin = { type: 'you', route: 'test' };
            await memoryStore().record([
                { op: 'add', record: { id: 'story-night', kind: 'fact', subject: 'Night', attribute: 'replaces your entry', text: 'Night was sold at the Saltmar fair and the captain now rides a grey mare.', status: 'current', importance: 7, overrides: { book: 'MB5 Lore', uid: night.uid } }, origin },
                { op: 'add', record: { id: 'forge', kind: 'fact', subject: 'Brannic', attribute: 'forge', text: 'Brannic keeps the forge at the keep gate and shoes the vanguard horses.', status: 'current', importance: 5 }, origin },
                { op: 'add', record: { id: 'old-thread', kind: 'thread', threadType: 'Open', subject: 'The lost bridle', text: `${char} searched the gatehouse for the lost bridle of Night.`, status: 'done', outcome: 'It was found.', importance: 5 }, origin, anchor: { mark: storedMark(c.chat[3]) } },
            ]);
        }, { B, char: names.char });
        L.resetLog();
        await turn(page, 'I ask about Night, the lost bridle in the gatehouse, and Brannic at the forge by the keep gate.');
        const upkeepText = chatRequest().messages.map(textOf).join('\n');
        const upkeepRecall = (upkeepText.match(/<recall>[\s\S]*?<\/recall>/) || [''])[0];
        check('an entry replaced by "The story changed" is not in the request; the record that replaces it is', !/black stallion of the captain/.test(upkeepText) && /sold at the Saltmar fair/.test(upkeepRecall), upkeepRecall.slice(0, 300));
        // B13b: the turn's Established records list leaves out what the recall block carries or held out, so each record is sent once.
        const copies = re => (upkeepText.match(re) || []).length;
        check('a record that only repeats her entry is held out of the recall block; her entry is sent once and the record is not repeated', !/Brannic keeps the forge/.test(upkeepRecall) && copies(/Brannic keeps the forge/g) === 1, `${copies(/Brannic keeps the forge/g)} copies in the request`);
        check('a record the recall block carries is in the request once', copies(/sold at the Saltmar fair/g) === 1 && /sold at the Saltmar fair/.test(upkeepRecall), `${copies(/sold at the Saltmar fair/g)} copies`);
        check('no record id line of the Established records list repeats a record the recall block carries', !/Established records[^\n]*\n(?:[^\n]*\n)*?story-night \[/.test(upkeepText), '');
        const roleTexts = chatRequest().messages.map(textOf);
        const dupLines = new Map();
        for (const t of roleTexts) for (const line of new Set(t.split('\n').map(x => x.trim()).filter(x => x.length >= 40 && /^[a-z0-9-]+ \[[a-z]+/.test(x)))) dupLines.set(line, (dupLines.get(line) || 0) + 1);
        check('the whole request holds no record line twice', ![...dupLines.values()].some(n => n > 1), JSON.stringify([...dupLines].filter(([, n]) => n > 1)).slice(0, 300));
        check('a record outside the recall pool (a thread closed before the chapter close) is not in the recall block', !/lost bridle/.test(upkeepRecall), '');
        out.dumps.upkeepRecall = upkeepRecall;
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); delete c.chatMetadata.world_info; await c.saveMetadata(); });

        // ------------------------------------------------------------ a trimmed request: 4,095 tokens of context (M1a W10)
        // no chapter closes during the long messages, so the open chapter outgrows the context
        await L.setSettings(page, { summary: { maxExchanges: 40, ceilingShare: 0.95 } });
        await page.evaluate(async () => { const O = await import('/scripts/openai.js'); globalThis.jQuery('#openai_max_context').val(4095).trigger('input'); O.oai_settings.openai_max_context = 4095; O.oai_settings.openai_max_tokens = 300; });
        const long = n => `I tell Hale the long story of the river crossing, part ${n}. ` + 'The water ran high over the stones and the wagons waited on the bank while the riders tested the depth with their lances. '.repeat(55);
        for (let n = 1; n <= 3; n++) await turn(page, long(n));
        const trimmedReq = chatRequest();
        const trimmed = trimmedReq.messages.map(textOf);
        const cut = await layout(page);
        check('at a 4,095-token context SillyTavern trims the chapter view from the request', !trimmed.some(t => /<story_so_far>/.test(t)), `${trimmed.length} messages`);
        check('the trim guard names the cut part', cut?.cut?.includes('chapter view'), JSON.stringify(cut?.cut));
        const mark = await page.evaluate(() => [...document.querySelectorAll('.ri-bar-status-button')].map(b => ({ text: b.textContent, tone: b.dataset.tone })));
        check('the bar\'s status slot shows the red mark', mark.some(m => /Memory cut/.test(m.text) && m.tone === 'problem'), JSON.stringify(mark));
        await shot(page, '2-red-mark');
        await page.evaluate(async () => { const { app } = await import('/scripts/extensions/third-party/roleplay-instructions/src/ui/panel.js'); await app.openPage('context', { focusPage: true }); await app.setExpanded(true); });
        await page.waitForTimeout(1200);
        const named = await page.evaluate(() => document.body.innerText.match(/SillyTavern cut the [^.]*\./)?.[0] || '');
        check('Review, Context names what was cut', /chapter view/.test(named), named);
        const section = await page.$('text=Memory in the last request');
        if (section) await section.scrollIntoViewIfNeeded();
        await shot(page, '3-review-context');
        out.dumps.trimmed = dump(trimmedReq);
        out.errors = errors.slice(0, 10);
        check('no page error', !errors.some(e => /roleplay-instructions/.test(String(e))), errors.slice(0, 3).join(' | '));
    } catch (error) {
        check('the run finished', false, String(error?.stack || error).slice(0, 600));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, `inject-host-${WIDTH}.json`), JSON.stringify(out, null, 1));
        await browser.close();
    }
})();
