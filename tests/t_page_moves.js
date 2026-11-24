// B6: page moves, one home per control, record adapter. A player's pass over every page of the menu at 523 x 1021
// (mobile layout) and 1006 x 909 (desktop layout) with touch on a real SillyTavern 1.19.0 host and the mock model.
// It checks that each section is in its new home, that each duplicated control has exactly one home with links
// elsewhere, that every prompt slot names a stored prompt and shows that prompt's text, that Facts and Plot stay
// separate tabs, and that no page overflows sideways. Fails on any page error.
//
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_EVIDENCE (screenshots and results.json).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8243';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B6');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
fs.mkdirSync(OUT, { recursive: true });
const results = { host: HOST, runs: [] };

// Section names that must be present in their new home, and names that must be gone from the old one.
const MOVES = {
    state: { has: ['Current story state'], gone: ['Save event limits'] },
    portrayal: { has: ['Pronouns', 'Portrayal & Knowledge'], gone: ['New NPC names to avoid'] },
    world: { has: ['The story world of this chat', 'The story so far', 'Write a chapter now', 'Start a new chapter in a new chat'],
        gone: ['Jump to section', 'How story notes are sent', 'Keeping the world up to date', 'What would be sent with the next reply', 'Make a new story world'] },
    books: { has: ['Story World', 'World Info books for this chat'], gone: ['Create this chat’s Story World'] },
    facts: { has: ['Chat Facts'], gone: [] },
    plots: { has: ['Plot Records'], gone: [] },
    'set-rules': { has: ['New things in one reply', 'Where your sets are kept', 'Pacing', 'Follow-through checks', 'World orders', 'Tags to skip'], gone: [] },
    writing: { has: ['Live writing guidance', 'Scene and character checks', 'Reply screening', 'New NPC names to avoid'], gone: [] },
    checks: { has: ['Stats'], gone: [] },
    context: { has: ['Memory status', 'This chat now', 'Next reply preview'], gone: ['Catch up or rebuild this chat', 'Write a chapter now', 'Conversation and memory'] },
    v10: { has: ['Extension modules', 'Composer quick actions', 'Advanced prompts'], gone: ['Active host preset', 'Room for story notes', 'Catch up this chat'] },
    memory: { has: ['Recall', 'Budgets', 'Upkeep', 'This chat', 'Room for story notes', 'Current state prompt budget', 'Keep the world up to date from each reply'], gone: [] },
    settings: { has: ['Connections & automatic requests', 'What the AI writes for you'], gone: ['Pronouns for', 'Legacy dice defaults', 'Pacing', 'Appearance & about', 'Accent colour', 'Where your sets are kept'] },
    display: { has: ['Reply Display', 'Story state under replies'], gone: ['Commentator voice'] },
};

async function ready(page) {
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(() => { for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click(); });
    await page.waitForSelector('#ri_composer_bar', { state: 'attached', timeout: 30000 });
}

async function run(browser, tag, viewport) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2.0625, hasTouch: true, isMobile: viewport.width < 1000, colorScheme: 'dark' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const out = { tag, viewport, pages: {}, overflow: [], missing: [], slots: 0 };
    results.runs.push(out);
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await ready(page);

    // A fresh chat, the structured workflow, a Story World, chapters on and dice on, so every control has a home to show.
    await page.evaluate(async BASE => {
        const host = SillyTavern.getContext();
        const idx = host.characters.findIndex(item => item.name);
        if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
        await new Promise(resolve => setTimeout(resolve, 800));
        await host.executeSlashCommandsWithOptions('/newchat');
        await new Promise(resolve => setTimeout(resolve, 1500));
        const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`), H = await import(`${BASE}/src/hide.js`);
        V.prefs().enabled = true;
        S.settings().dice.on = true;
        S.saveSettings(); S.saveChatState();
        H.setMemoryComponent('world', true);
        H.setMemoryComponent('chapters', true);
        await V.ensureWorld();
    }, BASE);
    await page.waitForTimeout(1200);

    const ids = await page.evaluate(async BASE => {
        const D = await import(`${BASE}/src/ui/destinations.js`), R = await import(`${BASE}/src/ui/page-registry.js`);
        const tree = D.buildTree(R.registeredPages());
        return tree.flatMap(top => top.nested.flatMap(nested => nested.pages.map(item => ({ id: item.id, top: top.id, nested: nested.id, bridge: !!item.bridge }))));
    }, BASE);
    out.tree = ids;
    const known = new Set(ids.map(item => item.id));
    for (const id of ['state', 'opening', 'corrections', 'portrayal', 'emotion', 'speakers', 'world', 'facts', 'plots', 'books', 'instructions', 'events', 'style',
        'set-rules', 'goals', 'writing', 'checks', 'sent', 'context', 'log', 'v10', 'memory', 'settings', 'display']) {
        if (!known.has(id)) out.missing.push(id);
    }
    assert.deepEqual(out.missing, [], `${tag}: pages missing from the tree`);
    // Facts and Plot stay separate nested tabs.
    const nestedOf = id => ids.find(item => item.id === id)?.nested;
    assert.equal(nestedOf('facts'), 'facts');
    assert.equal(nestedOf('plots'), 'plot');
    assert.notEqual(nestedOf('facts'), nestedOf('plots'));
    assert.equal(nestedOf('memory'), 'memory');
    assert.equal(nestedOf('set-rules'), 'random-sets');

    await page.evaluate(async BASE => { const P = await import(`${BASE}/src/ui/panel.js`); await P.app.setExpanded(true); }, BASE);
    const controls = {}, links = {}, slots = [];
    for (const { id, bridge } of ids) {
        if (bridge) continue;
        await page.evaluate(async ({ BASE, id }) => { const P = await import(`${BASE}/src/ui/panel.js`); await P.app.openPage(id, { via: 'tab' }); }, { BASE, id });
        await page.waitForTimeout(700);
        const seen = await page.evaluate(() => {
            const root = document.querySelector('#ri_root');
            const body = root.querySelector('#ri_panel_page');
            const text = body.innerText;
            return {
                controls: [...body.querySelectorAll('[data-control]')].map(node => node.dataset.control),
                links: [...body.querySelectorAll('[data-home-link]')].flatMap(node => node.dataset.homeLink.split(' ')),
                slots: [...body.querySelectorAll('[data-prompt-ids]')].map(node => ({
                    ids: node.dataset.promptIds.split(' '),
                    texts: [...node.querySelectorAll('.ri-prompt-editor textarea')].map(area => ({ label: area.getAttribute('aria-label'), value: area.value })),
                })),
                text,
                details: [...body.querySelectorAll('summary, .ri-section-title, .ri-label, .ri-h2, h3')].map(node => node.textContent.trim()),
                overflow: body.scrollWidth > body.clientWidth + 1 || root.scrollWidth > root.clientWidth + 1,
                heading: root.querySelector('[data-ri-heading]')?.textContent || '',
            };
        });
        out.pages[id] = { heading: seen.heading, controls: seen.controls, links: seen.links, slots: seen.slots.map(item => item.ids) };
        if (seen.overflow) out.overflow.push(id);
        controls[id] = seen.controls; links[id] = seen.links;
        for (const item of seen.slots) slots.push({ page: id, ...item });
        const move = MOVES[id];
        if (move) {
            const haystack = `${seen.text}\n${seen.details.join('\n')}`;
            for (const wanted of move.has) assert.ok(haystack.includes(wanted), `${tag}: ${id} shows "${wanted}"`);
            for (const absent of move.gone) assert.ok(!seen.details.some(title => title.startsWith(absent)), `${tag}: ${id} no longer shows "${absent}"`);
        }
        if (['world', 'books', 'memory', 'set-rules', 'context', 'v10', 'settings', 'writing', 'checks', 'portrayal', 'display', 'state', 'opening'].includes(id)) {
            await page.screenshot({ path: path.join(OUT, `${tag}-${id}.png`) });
        }
    }
    assert.deepEqual(out.overflow, [], `${tag}: pages that overflow sideways`);

    // One home per control: the table in homes.js against the live pages.
    const homes = await page.evaluate(async BASE => (await import(`${BASE}/src/ui/homes.js`)).HOMES, BASE);
    out.homes = {};
    const unlinked = [];
    for (const [key, home] of Object.entries(homes)) {
        const holders = Object.entries(controls).filter(([, list]) => list.includes(key)).map(([id]) => id);
        const counts = Object.values(controls).flat().filter(item => item === key).length;
        out.homes[key] = { home: home.page, holders, links: Object.entries(links).filter(([, list]) => list.includes(key)).map(([id]) => id) };
        assert.equal(counts, 1, `${tag}: control "${key}" has one home (found ${counts} in ${holders.join(', ') || 'no page'})`);
        assert.deepEqual(holders, [home.page], `${tag}: control "${key}" lives on ${home.page}`);
        for (const linkPage of home.links) {
            if (!known.has(linkPage)) continue;
            if (!(links[linkPage] || []).includes(key)) out.homes[key].noLink = [...(out.homes[key].noLink || []), linkPage];
        }
        if (out.homes[key].noLink) unlinked.push(`${key} <- ${out.homes[key].noLink.join(', ')}`);
    }
    assert.deepEqual(unlinked, [], `${tag}: links missing`);

    // Prompt slots: every slot names stored prompts, and each editor shows the stored prompt's text.
    const stored = await page.evaluate(async BASE => {
        const P = await import(`${BASE}/src/prompts.js`), S = await import(`${BASE}/src/store.js`);
        const list = {};
        for (const [id, def] of Object.entries(P.PROMPTS)) list[id] = { label: def.label, text: S.settings().prompts?.[id]?.text ?? def.text };
        for (const record of (await import(`${BASE}/src/voices.js`)).voiceRecords()) list[record.id] = { label: record.name, text: S.settings().prompts?.[record.id]?.text };
        return list;
    }, BASE);
    out.slots = slots.length;
    assert.ok(slots.length >= 10, `${tag}: pages carry prompt slots (${slots.length})`);
    for (const slot of slots) {
        for (const id of slot.ids) assert.ok(stored[id], `${tag}: slot on ${slot.page} names a stored prompt (${id})`);
        const labels = new Map(slot.ids.map(id => [stored[id]?.label, stored[id]?.text]));
        for (const area of slot.texts) {
            if (!labels.has(area.label)) continue;
            assert.equal(area.value, labels.get(area.label), `${tag}: ${slot.page} slot shows the stored text of "${area.label}"`);
        }
    }

    // A home link lands on its control: tap one on Connections and read the page that opens.
    await page.evaluate(async BASE => { const P = await import(`${BASE}/src/ui/panel.js`); await P.app.openPage('settings', { via: 'tab' }); }, BASE);
    await page.waitForTimeout(500);
    const link = page.locator('[data-home-link="state-budget"] button').first();
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
    const landed = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page')?.dataset.page, focus: document.activeElement?.closest('[data-control]')?.dataset.control }));
    out.linkLanding = landed;
    assert.equal(landed.page, 'memory');
    assert.equal(landed.focus, 'state-budget');
    await page.screenshot({ path: path.join(OUT, `${tag}-link-landing.png`) });

    assert.deepEqual(errors, [], `${tag}: page errors`);
    await page.close();
}

(async () => {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    try {
        await run(browser, '523', { width: 523, height: 1021 });
        await run(browser, '1006', { width: 1006, height: 909 });
    } finally {
        fs.writeFileSync(path.join(OUT, 'page-moves-results.json'), JSON.stringify(results, null, 2));
        await browser.close();
    }
    console.log('page moves: passed');
})().catch(error => { console.error(error); process.exit(1); });
