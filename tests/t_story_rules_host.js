// B41 on a real SillyTavern host with the mock model: a story rule fires from a captured relationship level, its private
// direction reaches the request, the firing is stored with the reply on its swipe, a swipe away and a delete take it back
// so a once-only rule fires again, the page lists the rule on Direction, Random sets with a link from Story, Characters,
// and the rules add no model call. Set RI_WIDTH (390 or 1006) and RI_EVIDENCE for story-rules-<width>.json.
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');

const WIDTH = Number(process.env.RI_WIDTH || 390), HEIGHT = 900;
const EV = process.env.RI_EVIDENCE || '';
const B = L.BASE;
const out = { width: WIDTH, checks: [], dumps: {} };
const check = (name, pass, detail = '') => { out.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? `| ${detail}` : ''); if (!pass) process.exitCode = 1; };

const DIRECTION = 'RULE_DIRECTION_ALPHA: Hale offers the key.';
const textOf = m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
const replyRequests = () => L.requests('all').filter(r => /^Reply \d+\./.test(r.answer || ''));
const lastReplyText = () => (replyRequests().at(-1)?.messages || []).map(textOf).join('\n');
const settle = async page => { for (let i = 0; i < 50; i++) { await page.waitForTimeout(400); const busy = await page.evaluate(async B => { const Q = await import(`${B}/src/memory/queue.js`); return !!Q.desktopQueue().stats().running; }, B); if (!busy) break; } await page.waitForTimeout(1500); };
const turn = async (page, text) => { await L.send(page, text); await settle(page); };
const captureState = (pair, step) => ({
    decisions: { durable_change: false, scene_ended: false, out_of_character: false }, ops: [],
    state: { relationships: [{ name: pair, pair, level: { step, reason: 'She takes his hand.' } }] },
});
/** The fired rule ids stored on the last reply's showing swipe. */
const firedOnLast = page => page.evaluate(async B => {
    const R = await import(`${B}/src/story-rules.js`);
    const chat = globalThis.SillyTavern.getContext().chat;
    const last = [...chat].reverse().find(m => !m.is_user);
    return (R.rulesOf(last)?.fired || []).map(f => f.id);
}, B);

(async () => {
    L.sync(); L.mode({}); L.resetLog();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: HEIGHT, hasTouch: true, isMobile: WIDTH < 600 });
    page.setDefaultTimeout(30000);
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' }, summary: { on: true, hide: true, minExchanges: 30, maxExchanges: 60 }, trayCards: { on: { 'relationships.level': true } } });
        await L.openChat(page);
        await page.waitForFunction(async B => (await import(`${B}/src/memory/import.js`)).memoryActive(), B, { timeout: 30000 });
        const names = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); return { persona: c.name1, char: c.name2 }; });
        const pair = `${names.char} and ${names.persona}`;
        // a once-only rule: when the pair's level is at least 7, send a private direction
        await page.evaluate(async ({ B, pair, DIRECTION }) => {
            const R = await import(`${B}/src/story-rules.js`);
            R.saveRules('', [{ id: 'level7', when: { kind: 'field', number: 'relationships.level', subject: pair, op: 'atLeast', value: 7 }, then: { kind: 'direction', text: DIRECTION }, repeat: { kind: 'once' } }]);
        }, { B, pair, DIRECTION });

        // ------------------------------------------------------------ reply 1: the level moves 5 to 8; nothing fires yet
        L.mode({ capture: captureState(pair, 3) });
        L.resetLog();
        await turn(page, 'I take his hand.');
        check('the first reply carries no rule direction', !lastReplyText().includes('RULE_DIRECTION_ALPHA'), '');
        const level = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); const m = [...c.chat].reverse().find(x => !x.is_user); return m?.extra?.roleplay_instructions?.tracker?.relationships?.[0]?.level; });
        check('capture applied the B40 step: the level is 8', Number(level) === 8, String(level));
        const preview = await page.evaluate(async B => (await import(`${B}/src/story-rules.js`)).upcoming()?.fired?.map(f => f.id) || [], B);
        check('after the capture commit the rule shows as ready for the next reply', preview.includes('level7'), preview.join(','));

        // ------------------------------------------------------------ reply 2: the rule fires, its direction is in the request
        L.mode({ capture: captureState(pair, 0) });
        await turn(page, 'I ask what he is hiding.');
        const all = lastReplyText();
        check('the private direction reaches the reply request', all.includes(DIRECTION), (all.match(/Story rule directions[^\n]*\n[^\n]*/) || ['none'])[0]);
        check('the firing is stored with the reply on its swipe', (await firedOnLast(page)).includes('level7'), (await firedOnLast(page)).join(','));
        const lines = await page.evaluate(async B => { const U = await import(`${B}/src/ui/story-rules.js`); const c = globalThis.SillyTavern.getContext(); return U.firedRuleLines([...c.chat].reverse().find(m => !m.is_user)); }, B);
        out.dumps.lines = lines;
        check('the Sent card lines name the condition in words', lines.length === 1 && /relationship level of .* is at least 7 \(.* is 8\)/.test(lines[0]), lines[0] || 'none');

        // ------------------------------------------------------------ reply 3: once only, so no direction
        L.mode({ capture: captureState(pair, 0) });
        await turn(page, 'I wait.');
        check('a once-only rule does not fire again', !lastReplyText().includes('RULE_DIRECTION_ALPHA') && !(await firedOnLast(page)).length, '');

        // ------------------------------------------------------------ delete reply 3 and 2: reply 2's firing leaves the chat
        await page.evaluate(async () => { await globalThis.SillyTavern.getContext().executeSlashCommandsWithOptions('/del 4'); });
        await settle(page);
        L.mode({ capture: captureState(pair, 0) });
        await turn(page, 'I ask again what he is hiding.');
        check('after a delete takes the firing back, the once-only rule fires again', lastReplyText().includes(DIRECTION) && (await firedOnLast(page)).includes('level7'), '');

        // ------------------------------------------------------------ a swipe away: the new swipe decides again, swiping back restores
        await page.evaluate(() => { document.querySelector('#chat .mes.last_mes .swipe_right')?.click(); });
        await settle(page);
        check('a new swipe of the firing reply fires the rule again', lastReplyText().includes(DIRECTION) && (await firedOnLast(page)).includes('level7'), String(replyRequests().length));
        const swipes = await page.evaluate(() => { const c = globalThis.SillyTavern.getContext(); const m = c.chat.at(-1); return { id: m.swipe_id, slots: (m.swipe_info || []).map(s => (s?.extra?.ri_rules?.fired || []).map(f => f.id).join(',')) }; });
        out.dumps.swipes = swipes;
        check('each swipe keeps its own stored firing', swipes.slots.filter(s => s === 'level7').length >= 2, JSON.stringify(swipes));

        // ------------------------------------------------------------ the page: one home beside Random sets, a link from Story, Characters
        const page1 = await page.evaluate(async B => {
            const R = await import(`${B}/src/ui/page-registry.js`);
            const rules = R.registeredPage('story-rules'), link = R.registeredPage('story-rules-link');
            const body = document.createElement('div');
            rules.render(body, null);
            const lb = document.createElement('div');
            link.render(lb, null);
            return { group: rules.group, tab: rules.tab, linkGroup: link.group, linkTab: link.tab, cards: body.querySelectorAll('[data-story-rule]').length,
                sentence: body.querySelector('[data-rule-sentence]')?.textContent || '', code: body.querySelectorAll('textarea').length, link: lb.textContent };
        }, B);
        out.dumps.page = page1;
        check('the rules page sits on Direction, Random sets', page1.group === 'direction' && page1.tab === 'random-sets', JSON.stringify(page1).slice(0, 200));
        check('Story, Characters links to it', page1.linkGroup === 'story' && page1.linkTab === 'characters' && /Direction, Random sets/.test(page1.link), page1.link);
        check('a rule reads as one sentence and its only text box is the direction wording', page1.cards === 1 && /once in this chat\.$/.test(page1.sentence) && page1.code === 1, page1.sentence);
        // the live panel: the page opens, a picker change rewrites the sentence, and nothing scrolls sideways
        await L.openPanel(page, 'story-rules');
        const shown = await page.evaluate(() => { const r = document.querySelector('#ri_root [data-story-rule]'); return { here: !!r, wide: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
        check('the page opens in the menu with the rule', shown.here, JSON.stringify(shown));
        check('no sideways scroll on the rules page', !shown.wide, JSON.stringify(shown));
        await page.locator('#ri_root select[aria-label="How often"]').selectOption('every');
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => document.querySelector('#ri_root [data-rule-sentence]')?.textContent || '');
        check('changing a picker rewrites the rule sentence', /at most every 5 replies\.$/.test(after), after);
        if (EV) await page.screenshot({ path: path.join(EV, `story-rules-${WIDTH}.png`), fullPage: false });
        await page.locator('#ri_root select[aria-label="How often"]').selectOption('once');
        await page.waitForTimeout(300);

        // ------------------------------------------------------------ no model call from the rules
        L.resetLog();
        await page.evaluate(async B => { const R = await import(`${B}/src/story-rules.js`); for (let i = 0; i < 5; i++) R.refresh(); }, B);
        await page.waitForTimeout(1000);
        check('checking the rules makes no model call', L.requests('all').length === 0, `${L.requests('all').length} requests`);
        L.resetLog();
        L.mode({ capture: captureState(pair, 0) });
        await turn(page, 'I nod.');
        const kinds = L.requests('all').map(r => r.kind);
        check('a reply with rules in force makes only the reply and its capture', kinds.filter(k => k === 'reply').length === 1 && kinds.every(k => ['reply', 'capture'].includes(k)), kinds.join(','));
        out.errors = errors.slice(0, 10);
        check('no page error', !errors.some(e => /roleplay-instructions/.test(String(e))), errors.slice(0, 3).join(' | '));
    } catch (error) {
        check('the run finished', false, String(error?.stack || error).slice(0, 600));
    } finally {
        if (EV) fs.writeFileSync(path.join(EV, `story-rules-${WIDTH}.json`), JSON.stringify(out, null, 1));
        await browser.close();
    }
})();
