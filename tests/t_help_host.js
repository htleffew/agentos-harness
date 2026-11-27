// B58 browser suite: Setup, Help, the guide and the help assistant, at 523 and 1006 px with touch.
//   1. Every page, section, setting and prompt the running extension draws is in assets/help/generated/app.json, which the
//      Help page draws as each page's Controls list (RI_HELP_WRITE=1 writes app.json from this run instead of checking it).
//   2. The Help page opens at both widths with no sideways scroll, search finds a control by its label and Show opens its
//      page with the control in view, and each page header's Help link opens that page's entry.
//   3. One question sends exactly one request on the chosen route (request recorder), the Ask button and the cost line carry
//      the amber mark, a paid route counts toward the spend ceiling, and the answer lists its source pages.
//   4. The fixture of covered and uncovered questions: the pass rate is recorded in the evidence file.
//   5. Switching the route to the desktop model or a Connection Profile changes only the route.
//   6. Live state off: no settings or chat text in the request; on: settings and the stack only. The latest reply goes
//      only when she ticks it for that question. A route that does not answer passes the question on with a note.
// Run with the host variables of tests/README.md. Screenshots go to RI_EVIDENCE or docs/ux-overhaul/audit/evidence/build/B58.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const B = L.BASE;
const dir = process.env.RI_EVIDENCE || path.join(__dirname, '..', 'docs', 'ux-overhaul', 'audit', 'evidence', 'build', 'B58');
fs.mkdirSync(dir, { recursive: true });
const APP_JSON = path.join(__dirname, '..', 'assets', 'help', 'generated', 'app.json');
const FIXTURE = require('./fixtures/help-questions.json');
const mockUrl = `http://127.0.0.1:${Number(process.env.RI_MOCK_PORT || 8124)}/v1`;
const WRITE = !!process.env.RI_HELP_WRITE;
const out = { checks: {} };

// Labels that are data on this machine (book names, preset blocks, counts), never controls.
const DATA = /^(Recall manages |Send |Base: |Companion: |▲ |Left out\b)|\d+ presets$|^Roleplay Instructions \d+ blocks|^Edit shared preset |· Default ·/;
const clean = label => String(label).replace(/\s*\(\d+\)$/, '').trim();

/** The tree, every non-sub page's harvested controls with their starting values, and the catalogs, read from the page. */
async function readApp(page) {
    return page.evaluate(async ({ B, data }) => {
        const DATA = new RegExp(data);
        const D = await import(`${B}/src/ui/destinations.js`), R = await import(`${B}/src/ui/page-registry.js`);
        const M = await import(`${B}/src/ui/menu-search.js`);
        const { app } = await import(`${B}/src/ui/panel.js`);
        const tree = D.buildTree(R.registeredPages());
        const pages = [];
        for (const top of tree) for (const nested of top.nested) {
            const listed = nested.pages.filter(p => !p.bridge);
            listed.forEach(p => pages.push({ id: p.id, label: p.label, top: top.label, nested: nested.label, sub: !!p.sub,
                lead: listed.filter(x => !x.sub)[0]?.id === p.id, help: p.help || nested.help || '' }));
        }
        const valueOf = node => {
            if (!node) return '';
            if (node.getAttribute('role') === 'switch') return node.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
            if (node.type === 'checkbox') return node.checked ? 'on' : 'off';
            if (node.tagName === 'SELECT') return node.selectedOptions[0]?.textContent.trim() || '';
            if (node.tagName === 'TEXTAREA') return '';
            const value = String(node.value || '').trim();
            return value.length && value.length <= 40 ? value : '';
        };
        const controls = {};
        for (const p of pages) {
            if (p.sub) continue;
            await app.openPage(p.id, {});
            // Some pages draw their lists after a load (World Info books, the preset stack): wait until two reads agree.
            let before = -1;
            for (let tries = 0; tries < 12; tries++) {
                await new Promise(r => setTimeout(r, 300));
                const count = M.harvest(document.querySelector('#ri_panel_page'), p.id).length;
                if (count === before) break;
                before = count;
            }
            const body = document.querySelector('#ri_panel_page');
            const values = new Map();
            for (const field of body.querySelectorAll('.ri-field')) {
                const label = field.querySelector(':scope > .ri-label')?.textContent.replace(/\s+/g, ' ').trim();
                if (label) values.set(label, valueOf(field.querySelector('input:not([type="hidden"]), select, textarea, [role="switch"]')));
            }
            for (const node of body.querySelectorAll('[role="switch"][aria-label]')) if (!node.closest('.ri-field')) values.set(node.getAttribute('aria-label'), valueOf(node));
            const seen = new Set();
            controls[p.id] = M.harvest(body, p.id).filter(e => !DATA.test(e.label)).map(e => {
                const label = e.label.replace(/\s*\(\d+\)$/, '').trim();
                return { kind: e.kind, label, ...(e.help ? { help: e.help.replace(/\s+/g, ' ').trim() } : {}), ...(values.get(e.label) ? { value: values.get(e.label) } : {}) };
            }).filter(e => !seen.has(e.kind + e.label) && seen.add(e.kind + e.label));
        }
        const C = await import(`${B}/src/cards/catalog.js`);
        const Q = await import(`${B}/src/quick-actions.js`);
        const RT = await import(`${B}/src/routing.js`);
        const P = await import(`${B}/src/prompts.js`);
        return {
            note: 'Written by tests/t_help_host.js with RI_HELP_WRITE=1 from the running extension. Do not edit by hand.',
            pages, controls,
            cards: C.CARDS.map(card => ({ id: card.id, label: card.label, effect: card.effect })),
            quickActionKinds: Object.entries(Q.QUICK_ACTION_KINDS).map(([kind, def]) => ({ kind, name: def.name, call: def.call })),
            builtinQuickActions: Q.builtinQuickActions().map(a => ({ id: a.id, kind: a.kind, title: a.title })),
            jobs: Object.entries(RT.JOBS).map(([id, job]) => ({ id, label: job.label, tier: job.tier, ...(job.chain ? { follows: job.chain } : {}) })),
            prompts: Object.entries(P.PROMPTS).map(([id, def]) => ({ id, label: def.label })),
        };
    }, { B, data: DATA.source });
}

const overflow = page => page.evaluate(() => {
    const p = document.querySelector('#ri_panel_page') || document.body;
    return Math.max(p.scrollWidth - p.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth);
});
const helpRows = () => L.requests('help');
const lastHelp = () => helpRows().at(-1);
const bodyOf = row => { try { return JSON.parse(row.body || '{}'); } catch { return {}; } };
const sentText = row => (row?.messages || []).map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');

async function setChain(page, chain) {
    await page.evaluate(async ({ B, chain }) => { (await import(`${B}/src/ui/help.js`)).setHelpChain(chain); (await import(`${B}/src/routing.js`)).resetRouteHealth(); }, { B, chain });
}

/** Ask through the sheet as she does: type, optionally tick the latest reply, tap Ask, wait for the answer. */
async function ask(page, question, { reply = false } = {}) {
    const sheet = page.locator('.ri-help-sheet');
    if (!await sheet.count()) {
        await L.openPanel(page, 'help');
        await page.locator('[data-help-ask-open]').tap();
        await sheet.waitFor({ timeout: 5000 });
    }
    const before = await sheet.locator('[data-help-turn]').count();
    await sheet.locator('.ri-help-box').fill(question);
    if (reply) await sheet.locator('.ri-help-live input[type="checkbox"]').tap();
    await sheet.locator('[data-help-ask]').tap();
    await page.waitForFunction(n => {
        const turns = document.querySelectorAll('.ri-help-sheet [data-help-turn]');
        return turns.length > n && turns[turns.length - 1].dataset.covered !== '';
    }, before, { timeout: 120000 });
    const turn = sheet.locator('[data-help-turn]').last();
    return { text: await turn.innerText(), covered: await turn.getAttribute('data-covered'), turn };
}

async function phone(width, height, run) {
    const { browser, page, errors } = await L.open({ width, height, hasTouch: true, isMobile: width < 768 });
    try { await run(page); } finally {
        out.checks[`errors-${width}`] = errors.filter(e => !/net::ERR|status of 5\d\d|Failed to fetch/.test(e));
        await browser.close();
    }
}

(async () => {
    L.sync();
    // ---- 1 and 2 at 1006 px: the generated guide data, the Help page, search and every page header's Help link.
    await phone(1006, 909, async page => {
        await L.setupApi(page);
        await L.openChat(page);
        await L.openPanel(page, 'state');
        const live = await readApp(page);
        if (WRITE) {
            // A page shows some sections only in some states (a book list, profiles in a preset family), so a write keeps the
            // controls an earlier run saw and adds the new ones. RI_HELP_WRITE=fresh starts over, for a control the code removed.
            if (process.env.RI_HELP_WRITE !== 'fresh' && fs.existsSync(APP_JSON)) {
                const earlier = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
                for (const [id, list] of Object.entries(earlier.controls || {})) {
                    if (!live.controls[id]) continue;
                    for (const control of list) if (!live.controls[id].some(c => c.kind === control.kind && clean(c.label) === clean(control.label))) live.controls[id].push(control);
                }
            }
            fs.mkdirSync(path.dirname(APP_JSON), { recursive: true });
            fs.writeFileSync(APP_JSON, `${JSON.stringify(live, null, 1)}\n`);
            console.log(`wrote ${APP_JSON}: ${live.pages.length} pages, ${Object.values(live.controls).flat().length} controls`);
            // The extension copy in SillyTavern and the loaded guide predate the file; install it again and reload.
            L.sync();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => globalThis.SillyTavern?.getContext && !document.getElementById('preloader'), null, { timeout: 90000 });
            await page.waitForTimeout(1500);
        }
        const saved = JSON.parse(fs.readFileSync(APP_JSON, 'utf8'));
        const missing = [];
        for (const p of live.pages) if (!saved.pages.some(s => s.id === p.id)) missing.push(`page ${p.id}`);
        for (const [id, list] of Object.entries(live.controls)) for (const c of list) {
            if (!(saved.controls[id] || []).some(s => s.kind === c.kind && clean(s.label) === clean(c.label))) missing.push(`${id}: ${c.kind} "${c.label}"`);
        }
        for (const key of ['cards', 'quickActionKinds', 'builtinQuickActions', 'jobs', 'prompts']) {
            const ids = new Set(saved[key].map(item => item.id || item.kind));
            for (const item of live[key]) if (!ids.has(item.id || item.kind)) missing.push(`${key} ${item.id || item.kind}`);
        }
        out.checks.coverage = { pages: live.pages.length, controls: Object.values(live.controls).flat().length, missing };
        assert.deepEqual(missing, [], `the guide data lists everything the extension draws; run with RI_HELP_WRITE=1 after a change:\n${missing.join('\n')}`);

        // The Help page at 1006 px.
        await L.openPanel(page, 'help');
        await page.waitForSelector('#ri-help-page [data-help-open]', { timeout: 15000 });
        assert.ok(await overflow(page) <= 1, 'no sideways scroll on Setup, Help at 1006 px');
        await page.screenshot({ path: path.join(dir, 'help-index-1006.png') });

        // Search finds a control by its label, and Show opens its page with the control in view.
        const target = saved.controls.memory.find(c => c.kind === 'setting' && /Room for Recall/.test(c.label)) || saved.controls.memory.find(c => c.kind === 'setting');
        await page.locator('#ri-help-search').fill(target.label);
        await page.waitForTimeout(300);
        const first = page.locator('.ri-help-result').first();
        assert.equal(await first.getAttribute('data-kind'), 'control', 'the first result is the control');
        assert.match(await first.innerText(), new RegExp(target.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the result names the control by its label');
        await page.screenshot({ path: path.join(dir, 'help-search-1006.png') });
        await first.getByRole('button', { name: 'Show', exact: true }).tap();
        await page.waitForTimeout(800);
        const landed = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page')?.dataset.page, focus: document.activeElement?.closest('.ri-field')?.querySelector('.ri-label')?.textContent.trim() || document.activeElement?.textContent.trim().slice(0, 60) }));
        assert.equal(landed.page, 'memory', 'Show opens the control\'s page');
        assert.ok(landed.focus && landed.focus.startsWith(target.label.slice(0, 12)), `the control is focused (${landed.focus})`);
        out.checks.search = { query: target.label, landed };

        // Each page header's Help link opens that page's entry.
        const links = [];
        for (const p of saved.pages.filter(x => !x.sub && x.id !== 'help')) {
            await L.openPanel(page, p.id);
            const link = page.locator('#ri_panel_page [data-ri-help-link]');
            assert.equal(await link.count(), 1, `${p.id} has a Help link in its header`);
            if (p.id === 'spend') await page.screenshot({ path: path.join(dir, 'header-link-1006.png') });
            await link.tap();
            await page.waitForSelector('#ri-help-page [data-help-title]', { timeout: 15000 });
            const title = (await page.locator('#ri-help-page [data-help-title]').innerText()).trim();
            const want = (fs.readFileSync(path.join(__dirname, '..', 'assets', 'help', 'pages', `${p.id}.md`), 'utf8').match(/^# (.+)$/m) || [])[1];
            links.push({ page: p.id, title });
            assert.equal(title, want, `the Help link on ${p.id} opens its entry`);
            if (p.id === 'spend') await page.screenshot({ path: path.join(dir, 'help-entry-1006.png') });
        }
        out.checks.headerLinks = links.length;
    });

    // ---- 2 to 6 at 523 px: the page and the assistant.
    await phone(523, 1021, async page => {
        await L.setupApi(page);
        await L.openChat(page);
        await L.send(page, 'The lantern code is ZEPHYR-7731, keep it between us.');
        // A World Info book whose entry must never reach a help request.
        await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            await c.saveWorldInfo('B58 help book', { entries: { 0: { uid: 0, key: ['harbor'], keysecondary: [], comment: 'Harbor', content: 'OBSIDIAN-4242 lies under the harbor.', constant: true, disable: false, order: 100, position: 0 } } }, true);
            await c.updateWorldInfoList?.();
        });
        await page.evaluate(async ({ mockUrl }) => {
            const c = SillyTavern.getContext();
            const cm = c.extensionSettings.connectionManager ||= { profiles: [] };
            cm.profiles = [
                { id: 'p-desk', name: 'Desktop test', api: 'custom', model: 'gemma4:12b', 'api-url': mockUrl, preset: 'Default' },
                { id: 'p-other', name: 'Other test profile', api: 'custom', model: 'help-profile-model', 'api-url': mockUrl, preset: 'Default' },
                { id: 'p-dead', name: 'Desktop that is off', api: 'custom', model: 'gemma4:12b', 'api-url': 'http://127.0.0.1:9/v1', preset: 'Default' },
            ];
        }, { mockUrl });
        await L.openPanel(page, 'memory');
        await page.screenshot({ path: path.join(dir, 'header-link-523.png') });
        await page.locator('#ri_panel_page [data-ri-help-link]').tap();
        await page.waitForSelector('#ri-help-page [data-help-title]', { timeout: 15000 });
        assert.equal((await page.locator('#ri-help-page [data-help-title]').innerText()).trim(), 'Memory', 'the Help link opens the entry at 523 px');
        await page.screenshot({ path: path.join(dir, 'help-entry-523.png') });
        await page.locator('#ri-help-page').getByRole('button', { name: 'All guide entries', exact: true }).tap();
        await page.waitForSelector('#ri-help-page [data-help-open]', { timeout: 15000 });
        assert.ok(await overflow(page) <= 1, 'no sideways scroll on Setup, Help at 523 px');
        await page.screenshot({ path: path.join(dir, 'help-index-523.png') });

        // The help chain she orders: the default starts on the desktop; Add, Up and Reset work by tap.
        const chainNow = () => page.evaluate(async B => (await import(`${B}/src/ui/help.js`)).helpChain().map(e => e.profileId ? `profile:${e.profileId}` : e.route), B);
        await setChain(page, null);
        const start = await chainNow();
        assert.equal(start[0], 'desktop', 'the help chain starts on the desktop model');
        assert.ok(!start.includes('openrouter'), 'the default chain holds no paid OpenRouter route');
        assert.equal(start.at(-1), 'main', 'the Main API is the last fallback (B59)');
        await page.locator('#ri-help-page details.ri-help-settings-fold > summary').tap();
        await page.locator('[data-help-add]').selectOption('profile:p-other');
        await page.locator('.ri-help-chain').getByRole('button', { name: 'Add', exact: true }).tap();
        await page.waitForTimeout(200);
        assert.equal((await chainNow()).at(-1), 'profile:p-other', 'Add puts a saved Connection Profile at the end');
        const n = (await chainNow()).length;
        await page.locator(`[data-help-step="${n - 1}"] [data-move="up"]`).tap();
        await page.waitForTimeout(200);
        assert.equal((await chainNow())[n - 2], 'profile:p-other', 'Up moves it one step');
        await page.locator('#ri-help-page details.ri-help-settings-fold').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(dir, 'help-settings-523.png') });
        await page.locator('.ri-help-chain').getByRole('button', { name: 'Reset to recommended', exact: true }).tap();
        await page.waitForTimeout(200);
        assert.deepEqual(await chainNow(), start, 'Reset restores the recommended chain');

        // 3. One question, one request on the chosen route, with the amber mark and the sources.
        await setChain(page, [{ route: 'main' }]);
        L.resetLog();
        await page.locator('#ri-help-page [data-help-ask-open]').tap();
        const sheet = page.locator('.ri-help-sheet');
        await sheet.waitFor({ timeout: 5000 });
        assert.equal(helpRows().length, 0, 'opening the sheet makes no request');
        const mark = await page.evaluate(() => {
            const btn = document.querySelector('.ri-help-sheet [data-help-ask]');
            const dot = btn?.querySelector('.ri-bar-dot');
            const cost = document.querySelector('.ri-help-sheet [data-help-cost]');
            const amber = getComputedStyle(document.querySelector('.ri-help-sheet')).getPropertyValue('--ri-call').trim();
            return { label: btn?.getAttribute('aria-label'), dot: !!dot, dotColor: dot && getComputedStyle(dot).backgroundColor, costDot: !!cost?.querySelector('.ri-bar-dot'),
                costText: cost?.textContent, call: cost?.dataset.call, amber, width: dot && dot.getBoundingClientRect().width };
        });
        out.checks.mark = mark;
        assert.equal(mark.label, 'Ask, 1 model call, extra request', 'Ask names its cost');
        assert.ok(mark.dot && mark.costDot && mark.call === 'extra', 'the Ask button and the cost line carry the amber dot');
        assert.notEqual(mark.dotColor, 'rgba(0, 0, 0, 0)', 'the dot is drawn');
        assert.match(mark.costText, /1 model call · extra request/);
        const one = await ask(page, 'Where do I change the monthly spend ceiling?');
        assert.equal(helpRows().length, 1, 'one question sends exactly one request');
        assert.equal(one.covered, 'true', 'the guide covers it');
        assert.ok(await one.turn.locator('[data-help-sources] [data-source]').count() >= 1, 'the answer lists its source pages');
        assert.match(await one.turn.locator('[data-help-receipt]').innerText(), /1 model call, answered by Main API/);
        const first = lastHelp();
        const sentFirst = sentText(first);
        assert.match(sentFirst, /^You are the help assistant inside Roleplay Instructions/m, 'the fixed part leads the request');
        assert.ok(sentFirst.indexOf('Guide pages:') < sentFirst.indexOf('Question: '), 'the question comes last, after the guide pages');
        out.checks.oneQuestion = { requests: 1, sources: await one.turn.locator('[data-help-sources] [data-source]').evaluateAll(n => n.map(x => x.dataset.source)) };
        await page.screenshot({ path: path.join(dir, 'help-sheet-523.png') });

        // A link under the answer opens the page with the control in view.
        const show = one.turn.locator('.ri-help-links button').first();
        if (await show.count()) {
            await show.tap();
            await page.waitForTimeout(800);
            out.checks.answerLink = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page')?.dataset.page, focus: document.activeElement?.textContent?.trim().slice(0, 60) }));
            assert.ok(out.checks.answerLink.page, 'the answer link opens a page');
            await L.openPanel(page, 'help');
            await page.locator('#ri-help-page [data-help-ask-open]').tap();
        }

        // The same question twice in a row sends the same system part, so a route with a prefix cache reuses it.
        await ask(page, 'How do I pin a quick action to the bar?');
        const second = lastHelp();
        assert.equal(second.messages[0].content, first.messages[0].content, 'the system part is the same for every question');

        // 5. Switching the route changes only the route.
        const question = 'How do I reorder the routes a background job tries?';
        const routes = {};
        for (const [name, chain] of Object.entries({ main: [{ route: 'main' }], desktop: [{ route: 'desktop', model: 'gemma4:12b', timeoutMs: 60000 }], profile: [{ route: 'profile', profileId: 'p-other' }] })) {
            await setChain(page, chain);
            const before = helpRows().length;
            await ask(page, question);
            assert.equal(helpRows().length, before + 1, `one request on the ${name} route`);
            const row = lastHelp();
            routes[name] = { model: bodyOf(row).model, messages: row.messages.map(m => ({ role: m.role, content: m.content })) };
        }
        out.checks.routes = Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, v.model]));
        assert.deepEqual(routes.desktop.messages, routes.main.messages, 'the desktop route carries the same messages');
        assert.deepEqual(routes.profile.messages, routes.main.messages, 'a Connection Profile carries the same messages');
        assert.equal(routes.desktop.model, 'gemma4:12b', 'the desktop route asks the desktop model');
        assert.equal(routes.profile.model, 'help-profile-model', 'the profile route asks the profile\'s model');

        // A route that does not answer passes the question on, with a note.
        await setChain(page, [{ route: 'profile', profileId: 'p-dead' }, { route: 'main' }]);
        const before = helpRows().length;
        const fell = await ask(page, 'How do I pick a theme for the menu?');
        assert.equal(helpRows().length, before + 1, 'the dead route makes no recorded request and the next route answers once');
        assert.match(await fell.turn.locator('[data-help-fallback]').innerText(), /Desktop that is off did not answer; Main API answered on attempt 2 of 2/);
        out.checks.fallback = await fell.turn.locator('[data-help-fallback]').innerText();

        // 3. A paid route counts toward the spend ceiling.
        await setChain(page, [{ route: 'openrouter', profileId: 'p-other', price: { in: 2, out: 2 } }]);
        const spendBefore = await page.evaluate(async B => (await import(`${B}/src/spend.js`)).spendState(), B);
        await ask(page, 'How do I set a goal for a character?');
        const spendAfter = await page.evaluate(async B => (await import(`${B}/src/spend.js`)).spendState(), B);
        const helpCalls = spendAfter.calls.filter(c => c.job === 'help').length - spendBefore.calls.filter(c => c.job === 'help').length;
        out.checks.spend = { before: spendBefore.total, after: spendAfter.total, helpCalls };
        assert.equal(helpCalls, 1, 'the paid help question is on the spend meter');
        assert.ok(spendAfter.total > spendBefore.total, 'the monthly total grows');

        // 6. Live state off, then on, then the latest reply by tap.
        await setChain(page, [{ route: 'main' }]);
        await ask(page, 'Why is the Roast card not showing?');
        const off = sentText(lastHelp());
        assert.ok(!/Her live settings and stack/.test(off) && !/"enabled":/.test(off), 'with live state off, no setting is in the request');
        assert.ok(!off.includes('ZEPHYR-7731') && !off.includes('OBSIDIAN-4242'), 'with live state off, no chat or World Info text is in the request');
        await sheet.locator('.ri-help-live [role="switch"]').tap();
        await ask(page, 'Why is the Roast card not showing?');
        const on = sentText(lastHelp());
        assert.match(on, /Her live settings and stack, read now:/);
        assert.match(on, /Settings: \{/, 'with live state on, the settings are in the request');
        assert.match(on, /Stack:\n/, 'with live state on, the stack is in the request');
        assert.ok(!on.includes('ZEPHYR-7731'), 'no chat text with live state on');
        assert.ok(!on.includes('OBSIDIAN-4242'), 'no World Info entry text with live state on');
        assert.ok(!/The latest reply in her chat/.test(on), 'the latest reply stays out until she ticks it');
        const allowed = await page.evaluate(async B => (await import(`${B}/src/ui/help.js`)).liveAllowed(), B);
        assert.equal(allowed, true, 'the permission is saved for this chat');
        await ask(page, 'What did the latest reply say?', { reply: true });
        const withReply = sentText(lastHelp());
        assert.match(withReply, /The latest reply in her chat, which she chose to include:\nReply \d+\./, 'the latest reply goes when she ticks it');
        await ask(page, 'And the reply after that?');
        assert.ok(!/The latest reply in her chat/.test(sentText(lastHelp())), 'the tick applies to one question only');
        out.checks.live = { offHasSettings: /Settings: \{/.test(off), onHasSettings: true, onHasStack: true, chatText: false };
        // A new chat starts with live state off.
        await L.openChat(page);
        assert.equal(await page.evaluate(async B => (await import(`${B}/src/ui/help.js`)).liveAllowed(), B), false, 'live state is per chat');
        await page.screenshot({ path: path.join(dir, 'help-live-523.png') });

        // 4. The fixture of covered and uncovered questions, asked through the same path with the mock.
        const results = await page.evaluate(async ({ B, fixture }) => {
            const H = await import(`${B}/src/ui/help.js`);
            const A = await import(`${B}/src/help.js`);
            const g = await H.guide();
            const rows = [];
            for (const [kind, list] of [['covered', fixture.covered], ['uncovered', fixture.uncovered]]) for (const item of list) {
                const r = await A.askHelp({ question: item.q, guide: g, index: g.index, chain: [{ route: 'main' }] });
                const pass = kind === 'covered' ? r.covered && r.sources.some(id => item.entries.includes(id)) : !r.covered;
                rows.push({ kind, q: item.q, pass, covered: r.covered, called: r.called, sources: r.sources, answer: String(r.text).slice(0, 200) });
            }
            return rows;
        }, { B, fixture: FIXTURE });
        const rate = kind => { const list = results.filter(r => r.kind === kind); return { passed: list.filter(r => r.pass).length, of: list.length }; };
        out.checks.fixture = { covered: rate('covered'), uncovered: rate('uncovered'), rows: results };
        console.log(`fixture pass rate: covered ${rate('covered').passed}/${rate('covered').of}, uncovered ${rate('uncovered').passed}/${rate('uncovered').of}`);
        assert.ok(rate('covered').passed / rate('covered').of >= 0.75, 'at least three in four covered questions find their page and an answer');
        assert.equal(rate('uncovered').passed, rate('uncovered').of, 'every uncovered question gets an answer that says so');
        // Leave no test profile, book or chain behind for the next phase or suite.
        await page.evaluate(async () => {
            const c = SillyTavern.getContext();
            c.extensionSettings.connectionManager.profiles = [];
            await c.deleteWorldInfo?.('B58 help book');
            c.saveSettingsDebounced();
        });
        await setChain(page, null);
        await page.waitForTimeout(1500);
    });

    // The sheet at 1006 px.
    await phone(1006, 909, async page => {
        await L.setupApi(page);
        await L.openChat(page);
        await setChain(page, [{ route: 'main' }]);
        await ask(page, 'How do I pick a theme for the menu?');
        assert.ok(await overflow(page) <= 1, 'no sideways scroll at 1006 px');
        await page.screenshot({ path: path.join(dir, 'help-sheet-1006.png') });
    });

    for (const key of Object.keys(out.checks).filter(k => k.startsWith('errors-'))) assert.deepEqual(out.checks[key], [], `no page errors (${key})`);
    fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify(out, null, 1)}\n`);
    console.log('B58 help suite passed');
})().catch(error => {
    try { fs.writeFileSync(path.join(dir, 'results.json'), `${JSON.stringify({ ...out, error: String(error?.stack || error) }, null, 1)}\n`); } catch { /* evidence is best effort */ }
    console.error(error);
    process.exit(1);
});
