// MB6 (memory DESIGN 6) on a real SillyTavern 1.19 host with the mock model: chapters close in chat data through the
// background queue and the Writer chain, the generate interceptor leaves covered messages out of the request and puts the
// chapter view in their place, the third close rebuilds the condensed account from stored chapter records, a forced
// chapter failure keeps its messages in the request with Repair on the divider, and no hidden flag is stored.
// The host's mock must answer the chapter and condensed prompts (see docs/ux-overhaul/memory/evidence/MB6/README.md).
// Set RI_EVIDENCE to a folder for the screenshots and chapter-host.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const results = [];
const assert = (c, msg, detail = '') => { results.push({ pass: !!c, msg, detail }); console.log((c ? 'PASS ' : 'FAIL ') + msg + (detail ? ` (${detail})` : '')); if (!c) process.exitCode = 1; };
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;

const state = page => page.evaluate(async B => {
    const C = await import(`${B}/src/chapters.js`);
    const I = await import(`${B}/src/memory/import.js`);
    const s = C.chapterState();
    return { active: I.memoryActive(), chapters: s.chapters.map(c => ({ id: c.id, n: c.n, valid: c.valid, count: c.marks.length, title: c.record.title })), view: s.view.text, viewTokens: s.view.tokens, cap: s.size.view,
        condensedFrom: s.view.condensedFrom, failures: C.chapterFailures().length, hidden: globalThis.SillyTavern.getContext().chat.filter(m => m.is_system).length,
        divider: document.querySelector('.ri-chapter-divider')?.textContent || '' };
}, B);
const settle = async page => { for (let i = 0; i < 40; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); const s = Q.desktopQueue().stats(); return !!s.running; }, B); if (!busy) break; } await page.waitForTimeout(600); };
const chatRequest = () => { const all = L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || '')); return all.at(-1); };
// The chat history only: the chapter view and the recall block (which may quote a closed chapter's exchanges, MB4) are memory.
const history = r => (r?.messages || []).filter(m => !/<story_so_far>|<recall>/.test(String(m.content))).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const asText = r => (r?.messages || []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

async function turn(page, n) {
    await L.send(page, `I ask about the road USERMARK${n}.`);
    await settle(page);
}

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: 1006, height: 909, hasTouch: true });
    const out = { closes: [] };
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 3, maxExchanges: 6 } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        assert((await state(page)).active, 'the new chat keeps its memory in chat data');

        // A. The first close at 6 exchanges; the next request leaves those messages out and carries the chapter view.
        for (let n = 1; n <= 6; n++) await turn(page, n);
        let s = await state(page);
        assert(s.chapters.length === 1 && s.chapters[0].valid, 'the open chapter closed at 6 exchanges by default chains', JSON.stringify(s.chapters));
        assert(/^Chapter 1 · .+ · 12 messages/.test(s.divider), 'the chat shows the divider where the open chapter begins', s.divider);
        if (EV) await page.screenshot({ path: path.join(EV, 'divider-w1006.png') });
        L.resetLog();
        await turn(page, 7);
        let sent = asText(chatRequest());
        assert(/<story_so_far>[\s\S]*<chapter n="1"/.test(sent), 'the newest closed chapter is in the next request');
        assert(!/USERMARK1\b|USERMARK6\b/.test(history(chatRequest())), 'the covered messages are left out at assembly');
        assert(/USERMARK7/.test(sent), 'the open chapter is sent word for word');
        const assembly = await page.evaluate(async B => (await import(`${B}/src/hide.js`)).lastChapterAssembly(), B);
        assert(assembly?.removed === 12 && assembly.inserted, 'the interceptor took 12 messages out and put the view in the same request', JSON.stringify(assembly));
        assert(s.hidden === 0, 'no hidden flag is stored on any message');
        assert(L.requests('all').every(r => !/Condense these stored chapter records/.test(asText(r))), 'no condensed call at the first close');
        out.closes.push({ close: 1, request: sent.length });

        // B. Second and third closes: one condensed call, at the third, from chapter records alone.
        L.resetLog();
        for (let n = 8; n <= 18; n++) await turn(page, n);
        s = await state(page);
        const condensed = L.requests('all').filter(r => /Condense these stored chapter records/.test(asText(r)));
        assert(s.chapters.length === 3, 'three chapters closed', String(s.chapters.length));
        assert(condensed.length === 1, 'one condensed call, at the third close', String(condensed.length));
        assert(condensed.every(r => !/<condensed>|<story_so_far>/.test(asText(r))), 'the condensed call reads stored chapter records and no earlier condensed account');
        L.resetLog();
        await turn(page, 19);
        sent = asText(chatRequest());
        assert(/<condensed>[\s\S]*<chapter n="2"[\s\S]*<chapter n="3"/.test(sent), 'the request holds the condensed account, then the two newest chapters in full');
        assert(s.viewTokens <= s.cap, `the chapter view stays under its cap (${s.viewTokens} of ${s.cap} tokens)`);

        // C. An edit inside a closed chapter sends its messages raw until the rebuild lands.
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); const i = c.chat.findIndex(m => /USERMARK9\b/.test(m.mes)); c.chat[i].mes += ' Edited.'; await c.saveChat(); }, null);
        const raw = await page.evaluate(async B => { const C = await import(`${B}/src/chapters.js`); return C.chapterState().chapters.map(c => c.valid); }, B);
        assert(raw[1] === false, 'an edit inside chapter 2 makes its coverage invalid', JSON.stringify(raw));
        await page.evaluate(async B => { const I = await import(`${B}/src/memory/import.js`); const Q = await import(`${B}/src/memory/queue.js`); for (const job of I.chapterJobs()) await Q.desktopQueue().enqueue(job); await Q.desktopQueue().pump(); }, B);
        await settle(page);
        s = await state(page);
        assert(s.chapters.every(c => c.valid), 'the stale chapter was rebuilt as soon as the Writer route was free', JSON.stringify(s.chapters));

        // D. A forced chapter-call failure: the messages stay in the request and the divider offers Repair.
        L.mode({ chapterFail: true });
        for (let n = 20; n <= 25; n++) await turn(page, n);
        s = await state(page);
        assert(s.failures === 1 && s.chapters.length === 3, 'a second bad answer leaves the chapter open', JSON.stringify({ failures: s.failures, chapters: s.chapters.length }));
        assert(/Repair/.test(s.divider), 'the divider offers Repair', s.divider);
        L.resetLog(); L.mode({});
        await turn(page, 26);
        sent = asText(chatRequest());
        assert(/USERMARK20\b/.test(sent) && /USERMARK25\b/.test(sent), 'the failed chapter\'s messages stay in the request');
        if (EV) await page.screenshot({ path: path.join(EV, 'repair-w1006.png') });
        await page.setViewportSize({ width: 523, height: 1021 });
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector('.ri-chapter-divider')?.scrollIntoView({ block: 'center' }));
        if (EV) await page.screenshot({ path: path.join(EV, 'divider-w523.png') });
        // Tap the divider: the summary opens.
        await page.tap('.ri-chapter-divider span[role="button"]');
        await page.waitForTimeout(700);
        const popup = await page.evaluate(() => document.querySelector('dialog[open]')?.textContent || '');
        const newest = (await state(page)).chapters.at(-1);
        assert(newest.n === 4 && newest.valid, 'once the route answers again, the open chapter closes at the next reply', JSON.stringify(newest));
        assert(new RegExp(`Chapter ${newest.n} · `).test(popup), 'a tap on the divider opens the newest chapter summary', popup.slice(0, 120));
        if (EV) await page.screenshot({ path: path.join(EV, 'summary-w523.png') });
        assert(!errors.length, 'no page errors', errors.slice(0, 3).join(' | '));
        out.final = await state(page);
    } catch (e) {
        assert(false, 'the run reaches the end', e.stack.split('\n').slice(0, 3).join(' | '));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, 'chapter-host.json'), JSON.stringify({ results, ...out }, null, 2));
        await browser.close();
    }
})();
