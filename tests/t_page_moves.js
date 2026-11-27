// B6: page moves, one home per control, record adapter. A player's pass over every page of the menu at 523 x 1021
// (mobile layout) and 1006 x 909 (desktop layout) with touch on a real SillyTavern 1.19.0 host and the mock model.
// It checks that each section is in its new home, that each duplicated control has exactly one home with links
// elsewhere, that every prompt slot names a stored prompt and shows that prompt's text, that Facts and Plot are
// filters of Story World, and that no page overflows sideways. Fails on any page error.
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
    // MB10: a chat whose memory lives in chat data shows the record browser
    world: { has: ['The story so far', 'Write a chapter now', 'Start a new chapter in a new chat', 'Story World book'],
        gone: ['Jump to section', 'How story notes are sent', 'Keeping the world up to date', 'What would be sent with the next reply', 'Make a new story world'] },
    books: { has: ['Story World', 'World Info books for this chat'], gone: ['Create this chat’s Story World'] },
    facts: { has: ['Chat Facts'], gone: [] },
    plots: { has: ['Plot Records'], gone: [] },
    'set-rules': { has: ['New things in one reply', 'Where your sets are kept', 'Pacing', 'Follow-through checks', 'World orders', 'Tags to skip'], gone: [] },
    writing: { has: ['Live writing guidance', 'Continuity guidance', 'Reply screening', 'New NPC names to avoid'], gone: [] },
    'stat-sheets': { has: ['Stats in use'], gone: [] },
    context: { has: ['Memory status', 'This chat now', 'Next reply preview'], gone: ['Catch up or rebuild this chat', 'Write a chapter now', 'Conversation and memory'] },
    v10: { has: ['Features', 'Quick action bar', 'Advanced prompts'], gone: ['Active preset', 'Room for Recall', 'Catch up this chat', 'Roleplay Instructions extension'] },
    memory: { has: ['Recall', 'Budgets', 'Upkeep', 'This chat', 'Room for Recall', 'Current state prompt budget', 'Keep the world up to date from each reply'], gone: [] },
    settings: { has: ['Connections & automatic requests', 'What the AI writes for you'], gone: ['Pronouns for', 'Legacy dice defaults', 'Pacing', 'Appearance & about', 'Accent colour', 'Where your sets are kept'] },
    display: { has: ['Reply Display'], gone: ['Commentator voice', 'Character cards', 'Story state under replies'] },
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
        return tree.flatMap(top => top.nested.flatMap(nested => nested.pages.map(item => ({ id: item.id, top: top.id, nested: nested.id, bridge: !!item.bridge, sub: !!item.sub }))));
    }, BASE);
    out.tree = ids;
    const known = new Set(ids.map(item => item.id));
    for (const id of ['state', 'opening', 'corrections', 'portrayal', 'emotion', 'speakers', 'world', 'facts', 'plots', 'books', 'instructions', 'events', 'style',
        'set-rules', 'goals', 'writing', 'stat-sheets', 'sent', 'context', 'log', 'v10', 'memory', 'settings', 'display']) {
        if (!known.has(id)) out.missing.push(id);
    }
    assert.deepEqual(out.missing, [], `${tag}: pages missing from the tree`);
    // MB10: Facts and Plot are filters of Story World (UI design 3.5), so the menu lists 19 pages.
    const nestedOf = id => ids.find(item => item.id === id)?.nested;
    assert.equal(nestedOf('facts'), 'story-world');
    assert.equal(nestedOf('plots'), 'story-world');
    assert.equal(new Set(ids.map(item => item.nested)).size, 19); // B58 added Setup, Help
    assert.equal(nestedOf('memory'), 'memory');
    assert.equal(nestedOf('set-rules'), 'random-sets');

    await page.evaluate(async BASE => { const P = await import(`${BASE}/src/ui/panel.js`); await P.app.setExpanded(true); }, BASE);
    const controls = {}, links = {}, slots = [];
    for (const { id, bridge, sub } of ids) {
        // A set editor opens from the list of sets; B27 below visits it in its editor states.
        if (bridge || sub) continue;
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
        if (['world', 'books', 'memory', 'set-rules', 'context', 'v10', 'settings', 'writing', 'stat-sheets', 'portrayal', 'display', 'state', 'opening'].includes(id)) {
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

    // B27: one list of sets, the set editors opened from it, and one home for the wording, impersonation and Roast editors.
    const snapshot = () => page.evaluate(() => {
        const root = document.querySelector('#ri_root'), body = root.querySelector('#ri_panel_page');
        return {
            page: body.dataset.page,
            sections: [...root.querySelectorAll('.ri-shell-section')].map(node => node.textContent),
            titles: [...body.querySelectorAll('.ri-section-title')].map(node => node.textContent.trim()),
            buttons: [...body.querySelectorAll('button')].map(node => node.textContent.trim()),
            controls: [...body.querySelectorAll('[data-control]')].map(node => node.dataset.control),
            links: [...body.querySelectorAll('[data-home-link]')].flatMap(node => node.dataset.homeLink.split(' ')),
            bare: [...body.querySelectorAll('.ri-prompt-editor')].filter(node => !node.closest('[data-prompt-ids]')).length,
            slots: [...body.querySelectorAll('[data-prompt-ids]')].map(node => ({
                ids: node.dataset.promptIds.split(' '),
                texts: [...node.querySelectorAll('.ri-prompt-editor textarea')].map(area => ({ label: area.getAttribute('aria-label'), value: area.value })),
            })),
            cards: [...body.querySelectorAll('.ri-setcard .ri-card-name')].map(node => node.textContent.trim()),
            overflow: body.scrollWidth > body.clientWidth + 1 || root.scrollWidth > root.clientWidth + 1,
        };
    });
    const routes = () => page.evaluate(async BASE => {
        const { app } = await import(`${BASE}/src/ui/panel.js`);
        return { tab: app.tab, route: app.route.view, eroute: app.eroute.view, sroute: app.sroute.view, ename: app.eroute.name, history: app.history.length };
    }, BASE);
    const open = async id => { await page.evaluate(async ({ BASE, id }) => (await import(`${BASE}/src/ui/panel.js`)).app.openPage(id, { via: 'tab' }), { BASE, id }); await page.waitForTimeout(600); };
    const press = async (selector, text) => {
        const target = page.locator(selector, text ? { hasText: new RegExp(`^${text}$`) } : undefined).first();
        await target.scrollIntoViewIfNeeded();
        await target.tap();
        await page.waitForTimeout(700);
    };
    const keep = (name, seen) => { for (const item of seen.slots) slots.push({ page: name, ...item }); assert.equal(seen.bare, 0, `${tag}: ${name} draws every prompt editor through slot()`); assert.equal(seen.overflow, false, `${tag}: ${name} does not overflow sideways`); };

    const stamp = Date.now();
    const made = await page.evaluate(async ({ BASE, stamp }) => {
        const K = await import(`${BASE}/src/books.js`), E = await import(`${BASE}/src/events.js`);
        const instructionId = await K.createSet(`B27 orders ${stamp}`);
        const ev = E.newEvent(`B27 happenings ${stamp}`); ev.categories = [E.newCategory('Situation', ['a letter arrives'])];
        const d1 = { entries: {} }; E.writeEvent(d1, ev);
        const eventId = await K.createSet(`B27 happenings ${stamp}`, 'events', d1);
        const sty = E.newStyle(`B27 voice ${stamp}`); sty.categories = [E.newCategory('Mood', ['dry wit'])];
        const d2 = { entries: {} }; E.writeEvent(d2, sty);
        const styleId = await K.createSet(`B27 voice ${stamp}`, 'style', d2);
        return { instructionId, eventId, styleId };
    }, { BASE, stamp });

    await open('sets');
    const list = await snapshot();
    out.setList = { sections: list.sections, titles: list.titles, cards: list.cards };
    assert.equal(list.page, 'sets');
    assert.equal(list.buttons.filter(text => text === 'Add set').length, 1, `${tag}: one Add set button`);
    assert.deepEqual(list.buttons.filter(text => /^Add (instruction|story event|writing style) set$/.test(text)), [], `${tag}: no per-kind add buttons`);
    for (const title of ['Instruction sets', 'Story event sets', 'Writing style sets']) assert.ok(list.titles.includes(title), `${tag}: the list has the group "${title}"`);
    // B41 adds Story rules beside the sets
    assert.deepEqual(list.sections, ['All sets', 'Story rules', 'Sets and pacing'], `${tag}: the sections row lists the list, Story rules and Sets and pacing only`);
    for (const name of ['B27 orders', 'B27 happenings', 'B27 voice']) assert.ok(list.cards.some(card => card.startsWith(name)), `${tag}: the list shows ${name}`);
    for (const key of ['instruction-wording', 'event-wording', 'style-wording']) assert.equal(list.controls.filter(item => item === key).length, 1, `${tag}: ${key} has one home on the list`);
    keep('sets', list);
    await page.screenshot({ path: path.join(OUT, `${tag}-random-sets-list.png`) });

    // Each kind opens from its card into its own editor page, and Back returns to the list.
    const names = { instructions: 'orders', events: 'happenings', style: 'voice' };
    const pageOf = { instructions: 'instructions', events: 'events', style: 'style' };
    for (const kind of ['instructions', 'events', 'style']) {
        await page.locator('.ri-setcard', { hasText: `B27 ${names[kind]}` }).first().locator('button', { hasText: /^Open$/ }).tap();
        await page.waitForTimeout(800);
        const at = await routes();
        assert.equal(at.tab, pageOf[kind], `${tag}: ${kind} opens in its own page`);
        assert.equal(at.history, 1, `${tag}: ${kind} keeps the way back`);
        await press('[data-ri-back]');
        assert.equal((await routes()).tab, 'sets', `${tag}: Back from ${kind} returns to the list`);
    }

    // The editor states: the wording editors are links, the other prompts are slots, and no editor is bare.
    await page.locator('.ri-setcard', { hasText: 'B27 orders' }).first().locator('button', { hasText: /^Open$/ }).tap();
    await page.waitForTimeout(700);
    await press('button', 'Add instruction');
    const instructionEditor = await snapshot();
    assert.ok(instructionEditor.links.includes('instruction-wording'), `${tag}: the instruction editor links to the wording home`);
    assert.deepEqual(instructionEditor.controls.filter(item => item.endsWith('-wording')), [], `${tag}: the instruction editor holds no wording editor`);
    keep('instructions-editor', instructionEditor);
    await page.screenshot({ path: path.join(OUT, `${tag}-instruction-editor.png`) });
    await press('[data-ri-back]');
    for (const kind of ['events', 'style']) {
        await page.locator('.ri-setcard', { hasText: `B27 ${names[kind]}` }).first().locator('button', { hasText: /^Open$/ }).tap();
        await page.waitForTimeout(800);
        const editor = await snapshot();
        assert.ok(editor.links.includes(kind === 'events' ? 'event-wording' : 'style-wording'), `${tag}: the ${kind} editor links to the wording home`);
        assert.deepEqual(editor.controls.filter(item => item.endsWith('-wording')), [], `${tag}: the ${kind} editor holds no wording editor`);
        keep(`${kind}-editor`, editor);
        if (kind === 'events') {
            // The route survives a trip through the link and Back.
            const before = await routes();
            await press('[data-home-link="event-wording"] button');
            const landed = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page').dataset.page, focus: document.activeElement?.closest('[data-control]')?.dataset.control }));
            assert.deepEqual(landed, { page: 'sets', focus: 'event-wording' }, `${tag}: the link lands on the wording home`);
            await press('[data-ri-back]');
            const after = await routes();
            assert.deepEqual([after.tab, after.eroute, after.ename], ['events', 'edit', before.ename], `${tag}: Back restores the open event set`);
        }
        await press('[data-ri-back]');
    }

    // One Add set button creates every kind.
    for (const kind of ['instructions', 'events', 'style']) {
        await open('sets');
        await press('button', 'Add set');
        await page.locator('[data-add-set] select').first().selectOption(kind);
        await page.locator('[data-add-set] input[type="text"]').first().fill(`B27 added ${kind} ${stamp}`);
        await press('[data-add-set] button', 'Create');
        const at = await routes();
        assert.equal(at.tab, pageOf[kind], `${tag}: Add set makes ${kind} and opens its editor`);
        await press('[data-ri-back]');
    }

    // New chapter: the Sent card links to Story, Story World.
    await open('sent');
    await press('[data-home-link="new-chapter"] button');
    const chapter = await page.evaluate(() => ({ page: document.querySelector('#ri_panel_page').dataset.page, focus: document.activeElement?.closest('[data-control]')?.dataset.control }));
    assert.deepEqual(chapter, { page: 'world', focus: 'new-chapter' }, `${tag}: the Sent link lands on the new chapter control`);

    // The impersonation prompts have one home; the quick action editor shows a link beside its preview.
    const inspector = await page.evaluate(async BASE => {
        const I = await import(`${BASE}/src/ui/impersonation.js`);
        const node = I.impersonationInspector({ editable: false });
        const full = I.impersonationInspector();
        return { editors: node.querySelectorAll('.ri-prompt-editor').length, link: !!node.querySelector('[data-home-link="impersonation-prompts"]'),
            fullEditors: full.querySelectorAll('[data-prompt-ids="playerDraft playerChoices playerExpansion"] .ri-prompt-editor').length };
    }, BASE);
    assert.deepEqual(inspector, { editors: 0, link: true, fullEditors: 3 }, `${tag}: impersonation editors live in the home only`);

    // A chat change returns the menu to the list with every set route at its root.
    await open('sets');
    await page.locator('.ri-setcard', { hasText: 'B27 happenings' }).first().locator('button', { hasText: /^Open$/ }).tap();
    await page.waitForTimeout(800);
    assert.equal((await routes()).eroute, 'edit');
    await page.evaluate(async () => { await SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'); });
    await page.waitForTimeout(2500);
    const afterChat = await routes();
    assert.deepEqual([afterChat.tab, afterChat.route, afterChat.eroute, afterChat.sroute], ['sets', 'sets', 'list', 'list'], `${tag}: a chat change resets the set routes and lands on the list`);


    // B31: the extension's cards are in the stack on Setup, Presets; editing one in the bank page (B36 retired the block editor's
    // Extension cards fold) goes through slot(), shows the stored prompt, and her saved wording is a version equal to that stored text.
    await page.evaluate(async BASE => {
        const P = await import(`${BASE}/src/prompts.js`);
        P.savePrompt('emotionSensitivity', 'B31 saved wording. Sensitivity: {sensitivity}.');
        // The chat changed above; the structured workflow is switched on again for this chat.
        const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`);
        V.prefs().enabled = true; S.saveChatState();
    }, BASE);
    await open('presets');
    await page.waitForSelector('#ri-bank-page .ri-bk-card[data-where="stack"]', { state: 'attached', timeout: 15000 });
    assert.equal(await page.locator('#ri-preset-workbench, #ri-preset-switches').count(), 0, `${tag}: the block editor and the switches are retired`);
    const cardKeys = await page.evaluate(() => [...document.querySelectorAll('#ri-bank-page .ri-bk-card[data-where="stack"]')].map(node => node.dataset.bankCard));
    out.riCards = cardKeys;
    const MP = await page.evaluate(async BASE => (await import(`${BASE}/src/module-layout.js`)).MODULE_PROMPTS, BASE);
    const FT = await page.evaluate(async BASE => Object.keys((await import(`${BASE}/src/preset-library.js`)).FEATURES), BASE);
    const ownedCards = await page.evaluate(async BASE => {
        const bank = await import(`${BASE}/src/preset-bank.js`), V = await import(`${BASE}/src/v10.js`);
        return { bank: [...bank.currentBank().sources.get('ri').cards.map(card => card.id)], on: bank.featureOn(V.activePreset()) };
    }, BASE);
    assert.deepEqual([...ownedCards.bank].sort(), [...FT].sort(), `${tag}: the bank holds one extension card for every feature`);
    for (const feature of FT.filter(item => ownedCards.on[item])) assert.ok(cardKeys.includes(`ri::${feature}`), `${tag}: the stack lists the extension card for ${feature}, which is on`);
    assert.ok(cardKeys.includes('v::ri-emotions'), `${tag}: her saved wording is a card beside the clean card`);
    // Open each extension card's editor in turn (one is open at a time) and read the slots it draws.
    const pressIn = (key, text) => page.evaluate(({ key, text }) => {
        const card = [...document.querySelectorAll('#ri-bank-page .ri-bk-card[data-where="stack"]')].find(node => node.dataset.bankCard === key);
        const control = [...(card?.querySelectorAll('button') || [])].find(node => (text ? node.textContent.trim() === text : node.classList.contains('ri-bk-name')));
        if (!control || (!text && control.getAttribute('aria-expanded') === 'true')) return false;
        control.click();
        return true;
    }, { key, text });
    const riSlots = { slots: [], bare: 0, overflow: false };
    for (const key of cardKeys.filter(item => item.startsWith('ri::') || item === 'v::ri-emotions')) {
        await pressIn(key, '');
        await page.waitForTimeout(150);
        assert.ok(await pressIn(key, 'Edit'), `${tag}: the ${key} card has an Edit tool`);
        await page.waitForTimeout(250);
        const seen = await snapshot();
        riSlots.slots.push(...seen.slots); riSlots.bare += seen.bare; riSlots.overflow ||= seen.overflow;
        await pressIn(key, 'Edit');
        await pressIn(key, '');
    }
    // These slots are checked against the stored text right here, while her saved wording is in place (the generic pass at the end
    // reads the stored prompts after it is restored).
    assert.equal(riSlots.bare, 0, `${tag}: ri-cards draws every prompt editor through slot()`);
    assert.equal(riSlots.overflow, false, `${tag}: ri-cards does not overflow sideways`);
    out.riSlots = riSlots.slots.map(item => item.ids);
    for (const feature of FT.filter(item => ownedCards.on[item] && !['roast', 'roastFeedback'].includes(item))) {
        assert.ok(riSlots.slots.some(item => item.ids.join(' ') === MP[feature].join(' ')), `${tag}: the ${feature} card edits ${MP[feature].join(', ')} through slot()`);
    }
    const emotionSlot = riSlots.slots.find(item => item.ids.includes('emotionSensitivity'));
    const emotionStored = await page.evaluate(async BASE => (await import(`${BASE}/src/prompts.js`)).promptText('emotionSensitivity'), BASE);
    assert.ok(emotionSlot.texts.some(area => area.value === emotionStored && emotionStored.startsWith('B31 saved wording')), `${tag}: the card's editor shows the stored text`);
    const wordingText = await page.evaluate(async BASE => {
        const bank = await import(`${BASE}/src/preset-bank.js`), ri = await import(`${BASE}/src/preset-bank-ri.js`);
        ri.syncRiVersions();
        return bank.getVersion('ri-emotions')?.text;
    }, BASE);
    const featureStored = await page.evaluate(async ({ BASE, ids }) => { const P = await import(`${BASE}/src/prompts.js`); return ids.map(id => P.promptText(id)).join('\n\n'); }, { BASE, ids: MP.emotions });
    assert.equal(wordingText, featureStored, `${tag}: her version is the stored text of the prompts the card edits, joined`);
    assert.ok(wordingText.startsWith(emotionStored), `${tag}: her version carries the Prompts page's stored text`);
    await page.screenshot({ path: path.join(OUT, `${tag}-extension-cards.png`) });
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/prompts.js`)).restorePrompt('emotionSensitivity');
        (await import(`${BASE}/src/preset-bank-ri.js`)).syncRiVersions();
    }, BASE);

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
