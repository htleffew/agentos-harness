// 5.9: a branch gets its own copy of the story world.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const PROSE = 'Hale stood by the stall. "You look wonderful tonight," he said.';
const reply = (lines) => `${PROSE}\n\n<story_update>\n${lines.join('\n')}\n</story_update>`;
const idle = async (page) => { await page.evaluate(async (B) => { const F = await import(`${B}/src/worldflow.js`); const C = await import(`${B}/src/chapters.js`); await F.worldIdle(); for (let i = 0; i < 100 && C.chapterBusy(); i++) await new Promise(r => setTimeout(r, 100)); await F.worldIdle(); }, L.BASE); await page.waitForTimeout(300); };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); await idle(page); const all = L.requests(); const chat = all.filter(r => r.messages.length > 2); return { n: all.length, text: L.text(chat[chat.length - 1] || all[0]) }; };
const worldOf = (page, id) => page.evaluate(async ([B, id]) => { const W = await import(`${B}/src/world.js`); const wid = id || W.chatWorld(); const d = await W.loadWorld(wid); return { id: wid, entries: W.listWorld(d, wid).map(w => ({ uid: w.uid, kind: w.kind, name: w.name, on: w.on, f: w.fields, span: w.span })) }; }, [L.BASE, id]);
const chatInfo = (page) => page.evaluate(async (B) => { const c = globalThis.SillyTavern.getContext(); const S = await import(`${B}/src/store.js`); const cs = S.chatState(); return { chat: c.getCurrentChatId(), world: cs.world, from: cs.worldFrom || '', owner: cs.worldOwner || '', mark: c.chatMetadata?.integrity || '' }; }, L.BASE);

(async () => {
    L.sync(); L.mode({ reply: PROSE });
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, perReply: 0, world: { update: 'all', build: 0, head: 0, copyOnBranch: true }, summary: { on: true, onSceneEnd: false, every: 0, hide: false } });
        const t = Date.now();
        for (const home of ['', 'Branch home ' + t]) {
            const where = home ? 'shared lorebook' : 'lorebook of its own';
            await L.openChat(page);
            await page.evaluate(async ([B, name, home]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, home); W.setChatWorld(id); }, [L.BASE, 'Branch world ' + (home ? 'S ' : 'O ') + t, home]);
            L.mode({ reply: reply(['person: Hale | captain of the Gull | Proud', 'thread: The missing crate | A crate went missing']) });
            await send(page, 'one');
            L.mode({ reply: reply(['wants: Hale | To sail at dawn']) });
            await send(page, 'two');
            L.mode({ goal: JSON.stringify({ title: 'At the market', when: '', summary: 'BRANCHMARK things happened', people: ['Hale'], places: [], settled: '' }) });
            await page.evaluate(async (B) => { await (await import(`${B}/src/chapters.js`)).writeChapterNow(); }, L.BASE);
            const orig = await chatInfo(page);
            const origWorld = await worldOf(page);
            // branch from the newest message
            const lastId = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length - 1);
            await L.slash(page, `/branch-create ${lastId}`); await page.waitForTimeout(2500); await idle(page);
            const br = await chatInfo(page);
            const brWorld = await worldOf(page);
            const brName = await page.evaluate(async ([B, id]) => (await import(`${B}/src/books.js`)).setInfo(id), [L.BASE, br.world]);
            console.log(where, 'orig:', JSON.stringify(orig), 'branch:', JSON.stringify(br), 'name:', brName.name, brName.shared ? brName.book : '');
            assert(br.chat !== orig.chat && br.world !== orig.world && br.from === orig.world && /\(branch\)$/.test(brName.name) && brName.shared === !!home && (!home || brName.book === home), `branch (${where}): the branch gets its own copy of the world, named "(branch)", kept where the original is`);
            const sig = (w) => w.entries.map(e => `${e.kind}:${e.name}:${e.f.wants || ''}`).sort().join('|');
            assert(sig(brWorld) === sig(origWorld) && brWorld.entries.length === 3, `branch (${where}): the copy has every entry of the original, chapters included`);
            // the branch keeps its chapter and moves on in the copy
            L.mode({ reply: reply(['wants: Hale | To stay ashore', 'person: Otto | ferryman | Quiet']) });
            const b1 = await send(page, 'in the branch');
            assert(/BRANCHMARK things happened/.test(b1.text), `branch (${where}): the branch still sends the chapter from before it branched`);
            const after = await worldOf(page);
            const origNow = await worldOf(page, orig.world);
            const hale = (w) => w.entries.find(e => e.name === 'Hale').f.wants;
            assert(hale(after) === 'To stay ashore' && after.entries.some(e => e.name === 'Otto') && hale(origNow) === 'To sail at dawn' && !origNow.entries.some(e => e.name === 'Otto'), `branch (${where}): what the branch files changes only the copy, and the original stays as it was`);
            // deleting in the branch undoes in the copy only
            await L.slash(page, '/del 4'); await page.waitForTimeout(900); await idle(page);
            const del = await worldOf(page);
            const origDel = await worldOf(page, orig.world);
            console.log(where, 'after delete:', JSON.stringify(del.entries.map(e => `${e.name}:${e.on}:${e.f.wants || ''}`)), JSON.stringify(origDel.entries.map(e => `${e.name}:${e.on}:${e.f.wants || ''}`)));
            assert(!del.entries.some(e => e.name === 'Otto') && hale(del) === 'To sail at dawn' && !del.entries.some(e => e.kind === 'chapter') && hale(origDel) === 'To sail at dawn' && origDel.entries.some(e => e.kind === 'chapter') && origDel.entries.some(e => e.name === 'The missing crate'), `branch (${where}): deleting replies in the branch undoes what they filed in the copy (the chapter goes with its reply), and the original keeps everything`);
            // opening the branch again does not copy again; the original chat keeps its world
            await page.evaluate(async (chat) => { await globalThis.SillyTavern.getContext().openCharacterChat(chat); }, orig.chat.replace(/\.jsonl$/, '')); await page.waitForTimeout(1500); await idle(page);
            const back = await chatInfo(page);
            await page.evaluate(async (chat) => { await globalThis.SillyTavern.getContext().openCharacterChat(chat); }, br.chat.replace(/\.jsonl$/, '')); await page.waitForTimeout(1500); await idle(page);
            const again = await chatInfo(page);
            assert(back.world === orig.world && !back.from && again.world === br.world, `branch (${where}): going back to the original chat keeps its world, and opening the branch again does not copy again`);
        }
        // off: the branch shares the world
        await L.setSettings(page, { world: { copyOnBranch: false } });
        await L.openChat(page);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, ''); W.setChatWorld(id); }, [L.BASE, 'Shared world ' + t]);
        L.mode({ reply: PROSE });
        await send(page, 'one');
        const o2 = await chatInfo(page);
        const last2 = await page.evaluate(() => globalThis.SillyTavern.getContext().chat.length - 1);
        await L.slash(page, `/branch-create ${last2}`); await page.waitForTimeout(2500); await idle(page);
        const b2 = await chatInfo(page);
        assert(b2.chat !== o2.chat && b2.world === o2.world, 'off: with "A branch gets its own copy of the world" off, the branch shares the world');
        await L.setSettings(page, { world: { copyOnBranch: true }, summary: { on: false } });
        // a new chapter shares the world on purpose and is never copied
        await L.openChat(page);
        await page.evaluate(async ([B, name]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, ''); W.setChatWorld(id); }, [L.BASE, 'Chapter world ' + t]);
        await send(page, 'one');
        const o3 = await chatInfo(page);
        await page.evaluate(async (B) => { const C = await import(`${B}/src/chapters.js`); const E = await import(`${B}/src/engine.js`); await C.startNewChapter({ summary: 'S', first: 'F' }, E.burnedSoFar); }, L.BASE);
        await page.waitForTimeout(1500); await idle(page);
        const n3 = await chatInfo(page);
        assert(n3.chat !== o3.chat && n3.world === o3.world && !n3.from, 'new chapter: a new chapter in a new chat keeps sharing the world, and is not copied as a branch');
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
