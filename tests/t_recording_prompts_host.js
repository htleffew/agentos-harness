// B60 on a real SillyTavern 1.19 host with touch and the mock model: she edits one Recording prompt on the Prompts page,
// sends a reply, and the capture request the mock logged carries her edited text (and the other Recording prompts) in its
// system part. With the Emotions module off, the next capture carries none of the Emotions Recording prompt.
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = Number(process.env.RI_HEIGHT || 780);
const B = L.BASE;
const EDIT = 'Write each lasting feeling as the outward act that shows it, naming who it is aimed at. B60 marker.';
const check = (name, pass, detail = '') => { console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };
const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); const s = Q.desktopQueue().stats(); return !!(s.running || s.waiting); }, B).catch(() => false); if (!busy) break; } await page.waitForTimeout(1200); };
const captures = () => L.requests('capture');
const systemOf = row => (row?.messages || []).filter(m => m.role === 'system').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        const ids = ['timingUpdate', 'structuredFacts', 'structuredPortrayal', 'structuredRelationships', 'structuredKnowledge', 'structuredEmotions', 'structuredOutcomes', 'structuredSchedule'];

        // ------------------------------------------------------------ her edit, made on the Prompts page
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.openPage('prompts', { focusPage: true }); await app.setExpanded(true); }, B);
        await page.waitForTimeout(800);
        const mirror = page.locator('#ri_root .ri-prompts-home [data-ri-prompt="structuredEmotions"]').first();
        check('the Prompts page lists the Emotions Recording prompt', await mirror.count() === 1);
        // Find it the way she would: type its name in "Find a prompt", open its family, then open the prompt.
        await page.locator('#ri_root .ri-prompts-home input[type=search]').first().fill('Recording emotional state');
        await page.waitForTimeout(400);
        const family = page.locator('#ri_root .ri-prompts-family').filter({ has: page.locator('[data-ri-prompt="structuredEmotions"]') }).first();
        if (!(await family.evaluate(node => node.open))) await family.locator('summary').first().tap();
        await mirror.scrollIntoViewIfNeeded();
        if (!(await mirror.evaluate(node => node.open === true))) await mirror.locator('summary').first().tap();
        const editor = mirror;   // the mirrored prompt is itself the editor (details.ri-prompt-editor)
        await editor.locator('textarea').fill(EDIT);
        await editor.getByRole('button', { name: 'Update', exact: true }).tap();
        await page.waitForTimeout(400);
        const stored = await page.evaluate(async B => (await import(`${B}/src/store.js`)).settings().prompts?.structuredEmotions?.text, B);
        check('her edit is stored', stored === EDIT, stored);
        const texts = await page.evaluate(async ({ B, ids }) => { const P = await import(`${B}/src/prompts.js`); return Object.fromEntries(ids.map(id => [id, P.promptText(id)])); }, { B, ids });
        await page.evaluate(async B => { const { app } = await import(`${B}/src/ui/panel.js`); await app.setExpanded(false); }, B);

        // ------------------------------------------------------------ a reply on the mock, then its capture
        const before = captures().length;
        await L.send(page, 'I hand Hale the sealed letter and wait for his answer.');
        await settle(page);
        const first = captures().slice(before).at(-1);
        const system = systemOf(first);
        check('the reply was captured by one call on the mock', captures().length - before >= 1 && !!first, `${captures().length - before} capture rows`);
        check('the capture request carries her edited Recording prompt', system.includes(EDIT), system.slice(-400));
        const missing = ids.filter(id => !system.includes(texts[id]));
        check('every Recording prompt of the modules that are on goes out', !missing.length, missing.join(', '));
        check('the Recording guidance sits in the system part before the field list', system.indexOf('Recording guidance') > 0 && system.indexOf('Recording guidance') < Math.max(system.indexOf('Fields to fill in state'), system.indexOf('No state fields are switched on')));

        // ------------------------------------------------------------ Emotions off: none of its Recording prompts
        await page.evaluate(async B => { const S = await import(`${B}/src/store.js`); const st = S.chatState(); ((st.v10 ||= {}).modules ||= {}).emotions = false; S.saveChatState(); }, B);
        const mid = captures().length;
        await L.send(page, 'I ask Hale who else has seen the seal.');
        await settle(page);
        const second = systemOf(captures().slice(mid).at(-1));
        check('with Emotions off the capture request has no Emotions Recording prompt', !!second && !second.includes(EDIT), second ? 'absent' : 'no capture row');
        check('the other modules\' Recording prompts still go out', !!second && second.includes(texts.structuredRelationships) && second.includes(texts.timingUpdate));
        check('no page errors', !errors.length, errors.join(' | '));
    } catch (error) {
        console.log('FAIL', error.stack || error.message);
        process.exitCode = 1;
    } finally {
        await page.evaluate(async B => { const S = await import(`${B}/src/store.js`); const st = S.settings(); delete st.prompts; S.saveSettings(); }, B).catch(() => {});
        await browser.close();
    }
})();
