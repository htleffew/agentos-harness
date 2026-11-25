// B44 on a real SillyTavern host with the mock model: the Tracker book's values are also set as chat variables with stable
// ri_ names. Checks the names, a preset block that reads {{getvar::ri_scene_place}} in a real request, the swipe, delete and
// edit resets before the next generation, a card or field switched off clearing what it set, and that none of it makes a
// model call. Set RI_WIDTH (390 or 1006) and RI_EVIDENCE for tracker-vars-<width>.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = 900;
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;
const out = { width: WIDTH, checks: [], dumps: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };

const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const chatRequest = () => L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || '')).at(-1);
const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running; }, B); if (!busy) break; } await page.waitForTimeout(1800); };
const turn = async (page, text) => { await L.send(page, text); await settle(page); };
/** Every ri_ chat variable the tracker book set, as { name: value }. */
const vars = page => page.evaluate(() => {
    const all = globalThis.SillyTavern.getContext().chatMetadata?.variables || {};
    return Object.fromEntries(Object.entries(all).filter(([k]) => /^ri_(scene|character|emo|rel|plan)(_|$)/.test(k)));
});
/** Wait for the variables to read as the test expects, up to a bound. */
async function waitVars(page, ok, ms = 12000) {
    const until = Date.now() + ms; let got = {};
    while (Date.now() < until) { got = await vars(page); if (ok(got)) return got; await page.waitForTimeout(400); }
    return got;
}
const captureState = (place, names, extra = {}) => ({
    decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [],
    state: {
        scene: { place, time: 'Day 3, Thursday, 21:40', weather: 'rain, cold', present: names },
        characters: [{ name: names[0], doing: 'Wiping the same cup', mind: 'Counting exits' }, { name: names[1], doing: 'Reading the ledger', mind: 'Weighing the offer' }],
        emotions: [{ name: names[0], axes: { tenderness: 2, fury: 1, dread: 4, yearning: 0 }, outward: 'Calm', counterweight: 'Relief' }],
        relationships: [{ name: `${names[0]} and ${names[1]}`, pair: `${names[0]} and ${names[1]}`, level: { step: -2, reason: 'She keeps her distance.' } }],
        ...extra,
    },
});
const part = text => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').replace(/[^\p{L}\p{N}]+/gu, '_');

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        // a preset block that reads the tracker's place, in the host's own preset
        await page.evaluate(async () => {
            const pm = globalThis.SillyTavern.getContext().getPresetManager('openai');
            const cur = JSON.parse(JSON.stringify(pm.getCompletionPresetByName(pm.getSelectedPresetName())));
            cur.prompts.push({ identifier: 'ri-b44-probe', name: 'B44 probe', role: 'system', content: 'PROBE_PLACE[{{getvar::ri_scene_place}}]', system_prompt: false, marker: false });
            for (const group of cur.prompt_order) group.order.push({ identifier: 'ri-b44-probe', enabled: true });
            await pm.savePreset('B44 probe preset', cur);
        });
        await L.usePreset(page, 'B44 probe preset'); await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 30, maxExchanges: 60 }, recall: { values: { itemCap: 14 } }, trayCards: { on: { 'relationships.level': true } } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        const names = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { persona: c.name1, char: c.name2 }; });
        const present = [names.char, names.persona];
        const charKey = part(names.char), pairKey = part(`${names.char} and ${names.persona}`);

        // ------------------------------------------------------------ set after capture, with stable names
        L.mode({ capture: captureState('The Gilded Hound, taproom', present) });
        await turn(page, 'I step into the taproom and ask for the quiet table.');
        let v = await waitVars(page, x => x.ri_scene_place);
        out.dumps.vars = v;
        check('the Scene values are set with stable names', v.ri_scene_place === 'The Gilded Hound, taproom' && /Day 3/.test(v.ri_scene_time) && v.ri_scene_weather === 'rain, cold', JSON.stringify(v).slice(0, 300));
        check('a present character gets ri_character_<name>_<field>', v[`ri_character_${charKey}_mind`] === 'Counting exits', Object.keys(v).join(' '));
        check('a relationship gets ri_rel_<pair>_level', String(v[`ri_rel_${pairKey}_level`]) === '3', Object.keys(v).join(' '));
        check('an emotion gets ri_emo_<name>_<field>', Object.keys(v).some(k => k.startsWith(`ri_emo_${charKey}_`)), Object.keys(v).join(' '));
        check('the pronoun variables are left alone', await page.evaluate(() => globalThis.SillyTavern.getContext().variables.local.get('ri_char_they') !== undefined), '');
        const book = await page.evaluate(async name => { const d = await globalThis.SillyTavern.getContext().loadWorldInfo(name); return d ? Object.values(d.entries).map(e => e.content).join('\n') : ''; }, `RI Tracker, ${await page.evaluate(() => globalThis.SillyTavern.getContext().getCurrentChatId())}`);
        const everyValueInBook = Object.values(v).every(value => book.includes(String(value)));
        check('every variable holds a value the Tracker book publishes', everyValueInBook && Object.keys(v).length >= 6, `${Object.keys(v).length} variables`);

        // ------------------------------------------------------------ a preset block reads the current place in a real request
        L.resetLog();
        L.mode({ capture: captureState('The wine cellar', present) });
        await turn(page, 'I ask who sits by the fire.');
        let req = chatRequest();
        let all = req.messages.map(textOf).join('\n');
        check('a preset block with getvar sends the current place in the request', /PROBE_PLACE\[The Gilded Hound, taproom\]/.test(all), (all.match(/PROBE_PLACE\[[^\]]*\]/) || ['none'])[0]);
        v = await waitVars(page, x => x.ri_scene_place === 'The wine cellar');
        check('after the next capture the variables hold that reply\'s place', v.ri_scene_place === 'The wine cellar', v.ri_scene_place);

        // ------------------------------------------------------------ swipe, delete and edit reset them at once
        L.mode({ capture: captureState('The cellar stairs', present) });
        await page.evaluate(() => { document.querySelector('#chat .mes.last_mes .swipe_right')?.click(); });
        await settle(page);
        v = await waitVars(page, x => x.ri_scene_place === 'The cellar stairs');
        check('a new swipe sets the values of the swipe shown', v.ri_scene_place === 'The cellar stairs', v.ri_scene_place);
        await page.evaluate(() => { document.querySelector('#chat .mes.last_mes .swipe_left')?.click(); });
        v = await waitVars(page, x => x.ri_scene_place === 'The wine cellar', 4000);
        check('swiping back resets them to the first swipe, before any rewrite of the book', v.ri_scene_place === 'The wine cellar', v.ri_scene_place);
        await page.evaluate(async () => { const c = globalThis.SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/del 1'); });
        await settle(page);
        v = await waitVars(page, x => x.ri_scene_place === 'The Gilded Hound, taproom');
        check('a delete resets them to the reply before it', v.ri_scene_place === 'The Gilded Hound, taproom', v.ri_scene_place);
        L.resetLog();
        L.mode({ capture: captureState('The roof', present) });
        await turn(page, 'I climb to the roof.');
        all = chatRequest().messages.map(textOf).join('\n');
        check('the next request reads the reset value', /PROBE_PLACE\[The Gilded Hound, taproom\]/.test(all), (all.match(/PROBE_PLACE\[[^\]]*\]/) || ['none'])[0]);
        await waitVars(page, x => x.ri_scene_place === 'The roof');

        // ------------------------------------------------------------ no model call
        L.resetLog();
        for (let i = 0; i < 3; i++) await page.evaluate(async B => { const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().syncVars(); }, B);
        await page.evaluate(() => globalThis.SillyTavern.getContext().eventSource.emit(globalThis.SillyTavern.getContext().eventTypes.GENERATION_STARTED, 'normal', {}, true));
        await page.waitForTimeout(1000);
        check('setting the variables makes no model call', L.requests('all').length === 0, `${L.requests('all').length} requests`);

        // ------------------------------------------------------------ a field or card that is off sets nothing and clears what it set
        await L.setSettings(page, { trayCards: { on: { 'relationships.level': false } } });
        await page.evaluate(async B => { const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().syncVars(); }, B);
        v = await vars(page);
        check('a field switched off clears its variable', !Object.keys(v).some(k => k.endsWith('_level')) && !!v.ri_scene_place, Object.keys(v).join(' '));
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); V.setModuleOwner(V.activePreset(), 'state', 'preset'); const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().write(); }, B);
        v = await vars(page);
        check('Story state on Theirs clears the Scene and character variables and keeps the others', !Object.keys(v).some(k => /^ri_(scene|character)_/.test(k)) && Object.keys(v).some(k => k.startsWith('ri_emo_')), Object.keys(v).join(' '));
        L.resetLog();
        await turn(page, 'I look around.');
        all = chatRequest().messages.map(textOf).join('\n');
        check('a preset block reading a cleared variable gets nothing', !/PROBE_PLACE\[The/.test(all), (all.match(/PROBE_PLACE\[[^\]]*\]/) || ['none'])[0]);
        await page.evaluate(async B => { const V = await import(`${B}/src/v10.js`); V.setModuleOwner(V.activePreset(), 'state', undefined); const { trackerBook } = await import(`${B}/src/tracker-book.js`); await trackerBook().write(); }, B);
        v = await vars(page);
        check('turning the card back on sets them again', !!v.ri_scene_place, v.ri_scene_place);
        out.errors = errors.slice(0, 10);
        check('no page error', !errors.some(e => /roleplay-instructions/.test(String(e))), errors.slice(0, 3).join(' | '));
    } catch (error) {
        check('the run finished', false, String(error?.stack || error).slice(0, 600));
        console.log('DIAG', JSON.stringify(await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { preset: c.getPresetManager('openai').getSelectedPresetName(), chat: c.chat.map(m => (m.mes || '').slice(0, 80)), toast: [...document.querySelectorAll('.toast')].map(t => t.innerText) }; }).catch(e => String(e))), errors.slice(0, 5));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, `tracker-vars-${WIDTH}.json`), JSON.stringify(out, null, 1));
        await browser.close();
    }
})();
