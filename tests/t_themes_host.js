// B17 in the browser: story styles on the reply tray, the one-time suggestion chip, the Setup pages for themes and story styles,
// and the matching SillyTavern theme. Drives SillyTavern 1.19.0 with the mock model at RI_WIDTH (default 390 x 780, touch).
//   - four fixture cards (noir, sci-fi, fantasy, plain) each draw the Strip chip with the expected style, and the request
//     recorder shows no request beyond the reply and its background memory calls;
//   - the chip, the Expanded header and Setup, Look, Story style each change the chat's style; it is saved in the chat; the
//     Setup default applies to a new chat; the tray's controls keep the terminal look while the card body changes;
//   - the page network log lists no address outside the host, and the four bundled font files load from the extension folder;
//   - Setup, Look, Theme: pick, Save as, Export, Import (a file with CSS is refused), Bind to this chat, and the matching
//     SillyTavern theme saves under "Roleplay Instructions, Emerald" without switching the current theme.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE (screenshots and results.json), RI_WIDTH, RI_ST_DATA.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WIDTH = Number(process.env.RI_WIDTH || 390);
const NARROW = WIDTH < 760;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B17');
fs.mkdirSync(OUT, { recursive: true });
const results = { width: WIDTH, host: process.env.RI_HOST_URL, steps: [] };
const mark = (label, data = {}) => { results.steps.push({ label, ...data }); console.log('ok', label); };

const CARDS = {
    noir: 'Detective Hale works the night shift at the precinct in 1940s Port Alder. Rain-slick streets, a speakeasy, a femme fatale in a trench coat.',
    scifi: 'Commander Hale of the starship Meridian. The colony on the third planet went dark and an android crew holds the orbit.',
    parchment: 'Sir Hale is a knight of the kingdom of Verath. A prophecy, a cursed sword and a wizard who casts a spell in a ruined castle.',
    modern: 'Hale is a barista who likes bad puns and takes the bus to a small shop on Elm Street.',
};
const LABEL = { parchment: 'Parchment', noir: 'Noir', scifi: 'Sci-fi readout', modern: 'Modern minimal' };
const REPLY = 'Hale pushes the door open and the hall beyond is dark. "Stay close," she says, and steps inside.';

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: WIDTH, height: NARROW ? 780 : 909, hasTouch: true, isMobile: NARROW });
    page.on('pageerror', error => console.error(error.stack));
    const hostOrigin = new URL(process.env.RI_HOST_URL).origin;
    const seen = [];
    page.on('request', request => seen.push(request.url()));
    const B = L.BASE;
    const shot = async (name, target) => {
        const file = `b17-w${WIDTH}-${name}.png`;
        if (target) await page.locator(target).first().screenshot({ path: path.join(OUT, file) }); else await page.screenshot({ path: path.join(OUT, file) });
        return file;
    };
    await L.setupApi(page);
    await page.evaluate(async BASE => {
        const S = await import(`${BASE}/src/store.js`);
        S.settings().enabled = true;
        S.settings().showUnder = 'off';
        S.saveSettings();
        // The host's default content selects fantasy World Info books globally; the fixtures below set the setting words themselves.
        globalThis.jQuery('#world_info').val([]).trigger('change');
    }, B);

    const newChat = async (description) => {
        await page.evaluate(async ({ description, BASE }) => {
            const host = SillyTavern.getContext();
            const idx = host.characters.findIndex(item => item.name);
            if (String(host.characterId) !== String(idx)) await host.selectCharacterById(idx);
            await new Promise(resolve => setTimeout(resolve, 600));
            host.characters[idx].description = description;
            // The default card is a fantasy character; blank its other setting fields so the fixture text decides.
            const blank = { personality: '', scenario: '', first_mes: 'Hale looks up.', mes_example: '', system_prompt: '' };
            Object.assign(host.characters[idx], blank);
            host.characters[idx].data = { ...(host.characters[idx].data || {}), ...blank, description, tags: [], extensions: { ...(host.characters[idx].data?.extensions || {}), world: '' } };
            host.characters[idx].tags = [];
            await host.executeSlashCommandsWithOptions('/newchat');
            await new Promise(resolve => setTimeout(resolve, 1200));
            const V = await import(`${BASE}/src/v10.js`), S = await import(`${BASE}/src/store.js`);
            V.prefs().enabled = true;
            S.saveChatState();
        }, { description, BASE: B });
        await page.waitForFunction(() => { const chat = SillyTavern.getContext().chat; return chat.length === 1 && !chat[0].is_user; }, null, { timeout: 15000 });
    };
    const reply = async () => {
        L.resetLog();
        L.mode({ reply: REPLY });
        await L.send(page, 'I follow her to the door.');
        await page.waitForSelector('#chat .last_mes .ri-tray:not(.ri-tray-loading)', { timeout: 30000 });
        await page.waitForTimeout(900);
    };
    const tray = '#chat .last_mes .ri-tray:not(.ri-tray-loading)';
    const chatStyle = () => page.evaluate(async BASE => (await import(`${BASE}/src/story-style.js`)).chatStoryStyle(), B);
    const trayStyle = () => page.evaluate(sel => document.querySelector(sel)?.dataset.riStoryStyle, tray);
    // SillyTavern offers to import a card's embedded World Info book when the card is selected; the fixtures decline.
    const decline = async () => { for (let i = 0; i < 3; i++) { const button = page.locator('dialog[open] .popup-button-cancel, dialog[open] .popup-button-close').first(); if (!await button.count()) break; await button.click(); await page.waitForTimeout(300); } };
    const tap = async locator => { await decline(); await locator.scrollIntoViewIfNeeded(); await locator.tap(); await page.waitForTimeout(350); };

    // ---- the suggestion, one fixture card at a time ----
    results.suggestions = {};
    for (const [expected, text] of Object.entries(CARDS)) {
        await newChat(text);
        await reply();
        const rows = L.requests('all');
        const kinds = rows.map(row => row.kind);
        const chip = page.locator(`${tray} .ri-tray-style-chip`);
        if (expected === 'modern' && await chip.count()) {
            console.log('DEBUG', await page.evaluate(async BASE => { const m = await import(`${BASE}/src/story-style.js`), c = await import(`${BASE}/src/chat-books.js`);
                return { text: (m.cardText() + '\n' + await m.bookText()).slice(0, 600), score: m.scoreStyles(m.cardText() + '\n' + await m.bookText()), books: c.chatBooks().map(b => [b.name, b.active, b.roles]) }; }, B));
        }
        if (expected === 'modern') {
            assert.equal(await chip.count(), 0, 'a plain card draws no chip');
            assert.equal(await page.evaluate(async BASE => (await import(`${BASE}/src/story-style.js`)).pendingSuggestion(), B), '');
        } else {
            await chip.waitFor({ timeout: 8000 });
            assert.match(await chip.innerText(), new RegExp(`Story style: ${LABEL[expected]}, suggested`));
        }
        const saved = await page.evaluate(() => SillyTavern.getContext().chatMetadata.roleplay_instructions.storyStyleSuggestion);
        assert.equal(saved.style, expected, `${expected} fixture suggests ${expected}`);
        assert.ok(kinds.every(kind => ['reply', 'capture', 'chapter', 'condensed'].includes(kind)), `${expected}: only the reply and its background memory calls (${kinds.join(', ')})`);
        assert.equal(kinds.filter(kind => kind === 'reply').length, 1, `${expected}: one reply request`);
        results.suggestions[expected] = { saved, requestKinds: kinds };
        if (expected !== 'modern') await shot(`chip-${expected}`, '#chat .last_mes');
        mark(`suggestion ${expected}`, { saved });
    }

    // ---- the choice: chip, Expanded header, Setup ----
    await newChat(CARDS.noir);
    await reply();
    assert.equal(await trayStyle(), 'modern', 'before a choice the tray follows the default');
    await tap(page.locator(`${tray} .ri-tray-style-chip`));
    assert.ok(await page.locator(`${tray} .ri-style-grid`).isVisible(), 'the chip opens the choice');
    await shot('picker-open', '#chat .last_mes');
    await tap(page.locator(`${tray} .ri-style-sample[data-style="noir"]`));
    assert.equal(await chatStyle(), 'noir');
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chatMetadata.roleplay_instructions.storyStyle), 'noir', 'saved in the chat file');
    assert.equal(await trayStyle(), 'noir');
    assert.equal(await page.locator(`${tray} .ri-tray-style-chip`).count(), 0, 'the chip is gone once she chose');
    mark('chip choice saves with the chat');

    // The same fixture reply in all four styles, in the Expanded view, with the terminal controls above the card body.
    await page.evaluate(async BASE => { (await import(`${BASE}/src/ui/reply-tray.js`)); }, B);
    await tap(page.locator(`${tray} .ri-tray-view[aria-label="Expanded"]`));
    results.styles = {};
    // Pick through the Expanded header, as she does; a module the test imports would not reach the extension's own listeners.
    const pickInTray = async id => {
        if (!await page.locator(`${tray} .ri-style-grid`).count()) await tap(page.locator(`${tray} .ri-tray-style-open`));
        await tap(page.locator(`${tray} .ri-style-sample[data-style="${id}"]`));
        await page.waitForFunction(({ sel, id }) => document.querySelector(sel)?.dataset.riStoryStyle === id, { sel: tray, id }, { timeout: 8000 });
        await page.waitForTimeout(300);
    };
    for (const id of ['parchment', 'noir', 'scifi', 'modern']) {
        await pickInTray(id);
        if (!await page.locator(`${tray} .ri-tray-view[aria-label="Expanded"][aria-pressed="true"]`).count()) await tap(page.locator(`${tray} .ri-tray-view[aria-label="Expanded"]`));
        const read = await page.evaluate(sel => {
            const root = document.querySelector(sel);
            const panel = root.querySelector('.ri-tray-panel'), chips = root.querySelector('.ri-tray-chips'), strip = root.querySelector('.ri-tray-strip');
            const style = node => node ? getComputedStyle(node) : null;
            return { style: root.dataset.riStoryStyle, panelBg: style(panel)?.backgroundColor, panelColor: style(panel)?.color, panelFont: style(panel)?.fontFamily,
                panelRadius: style(panel)?.borderBottomLeftRadius, chipFont: style(chips)?.fontFamily, stripBg: style(strip)?.backgroundColor, stripFont: style(strip)?.fontFamily,
                fontsLoaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => font.family) };
        }, tray);
        results.styles[id] = read;
        assert.equal(read.style, id);
        assert.equal(read.chipFont, read.stripFont, `${id}: the tray's own controls keep one face`);
        assert.match(read.chipFont, /RI Plex Mono/, `${id}: the controls keep the terminal face`);
        await shot(`style-${id}`, '#chat .last_mes');
        mark(`style ${id} drawn`, { panelBg: read.panelBg, panelFont: read.panelFont });
    }
    const expectBg = { parchment: 'rgb(27, 21, 14)', noir: 'rgb(15, 15, 16)', scifi: 'rgb(3, 16, 15)', modern: 'rgb(20, 21, 24)' };
    for (const [id, read] of Object.entries(results.styles)) assert.equal(read.panelBg, expectBg[id], `${id} surface`);
    assert.match(results.styles.parchment.panelFont, /RI EB Garamond/);
    assert.match(results.styles.noir.panelFont, /RI Courier Prime/);
    assert.match(results.styles.scifi.panelFont, /RI Plex Mono/);
    assert.match(results.styles.modern.panelFont, /system-ui/);
    for (const family of ['RI EB Garamond', 'RI Courier Prime']) {
        assert.ok(await page.evaluate(family => document.fonts.check(`16px "${family}"`), family), `${family} is available`);
    }

    // Expanded header
    await tap(page.locator(`${tray} .ri-tray-style-open`));
    await shot('expanded-header-picker', '#chat .last_mes');
    await pickInTray('scifi');
    assert.equal(await chatStyle(), 'scifi');
    assert.equal(await trayStyle(), 'scifi');
    mark('Expanded header changes the style');

    // Setup, Look, Story style
    await L.openPanel(page, 'look-story-style');
    await page.waitForSelector('#ri-story-style .ri-style-sample', { timeout: 10000 });
    await shot('setup-story-style');
    await tap(page.locator('#ri-story-style .ri-style-sample[data-style="parchment"]').nth(1));
    assert.equal(await chatStyle(), 'parchment', 'the This chat grid changes the chat');
    await tap(page.locator('#ri-story-style .ri-style-sample[data-style="noir"]').first());
    const defaults = await page.evaluate(async BASE => (await import(`${BASE}/src/story-style.js`)).defaultStoryStyle(), B);
    assert.equal(defaults, 'noir', 'Setup default saved');
    mark('Setup, Look, Story style');

    // The Setup default applies to a chat that has chosen nothing.
    await page.evaluate(async BASE => { (await import(`${BASE}/src/ui/panel.js`)).app.setExpanded(false); }, B);
    await newChat(CARDS.modern);
    await reply();
    assert.equal(await chatStyle(), '');
    assert.equal(await trayStyle(), 'noir', 'a chat with no choice follows the Setup default');
    mark('Setup default applies to a chat with no choice');

    // ---- themes ----
    await L.openPanel(page, 'look-theme');
    await page.waitForSelector('#ri-theme', { timeout: 10000 });
    await shot('setup-theme');
    await tap(page.locator('#ri-theme .ri-theme-list [data-theme="sapphire"]'));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.riTheme), 'sapphire');
    const chromeValue = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ri-chrome').trim());
    assert.equal(chromeValue.toUpperCase(), '#6AA8FF');
    await shot('theme-sapphire');
    await tap(page.locator('#ri-theme .ri-theme-list [data-theme="violet"]'));
    await shot('theme-violet');
    await tap(page.locator('#ri-theme .ri-theme-list [data-theme="emerald"]'));
    mark('three themes switch');

    // Save as
    await tap(page.locator('#ri-theme-save'));
    await page.locator('dialog[open] input.popup-input, dialog[open] textarea').first().fill('B17 Night');
    await page.locator('dialog[open] .popup-button-ok').click();
    await page.waitForTimeout(600);
    const state = await page.evaluate(() => SillyTavern.getContext().extensionSettings.roleplay_instructions.themes);
    assert.deepEqual(state.variations.map(item => item.name), ['B17 Night']);
    assert.equal(state.active, 'v-b17-night');
    // Export
    const [download] = await Promise.all([page.waitForEvent('download'), tap(page.locator('#ri-theme-export'))]);
    const exported = path.join(OUT, `b17-w${WIDTH}-export.json`);
    await download.saveAs(exported);
    const data = JSON.parse(fs.readFileSync(exported, 'utf8'));
    assert.equal(data.name, 'B17 Night');
    assert.deepEqual(Object.keys(data).sort(), ['base', 'chrome', 'density', 'format', 'iconWeight', 'name', 'scanlines', 'version']);
    // Import: a file with CSS is refused, a clean one is added.
    const dirty = path.join(OUT, `b17-w${WIDTH}-dirty.json`);
    fs.writeFileSync(dirty, JSON.stringify({ ...data, name: 'Dirty', css: 'body { display: none }' }));
    await page.setInputFiles('#ri-theme input[type=file]', dirty);
    await page.waitForTimeout(600);
    assert.equal((await page.evaluate(() => SillyTavern.getContext().extensionSettings.roleplay_instructions.themes.variations)).length, 1, 'the file with CSS was refused');
    const clean = path.join(OUT, `b17-w${WIDTH}-clean.json`);
    fs.writeFileSync(clean, JSON.stringify({ ...data, name: 'B17 Imported', chrome: '#FF8AD8' }));
    await page.setInputFiles('#ri-theme input[type=file]', clean);
    await page.waitForTimeout(800);
    const variations = await page.evaluate(() => SillyTavern.getContext().extensionSettings.roleplay_instructions.themes.variations);
    assert.deepEqual(variations.map(item => item.name), ['B17 Night', 'B17 Imported']);
    assert.equal(await page.evaluate(() => document.querySelector('style#ri-imported, style[data-ri-imported]') === null), true, 'no style element was added by the import');
    mark('Save as, Export and Import (CSS refused)');
    // Bind to this chat
    await tap(page.locator('#ri-theme-bind'));
    assert.equal(await page.evaluate(() => SillyTavern.getContext().chatMetadata.roleplay_instructions.theme), 'v-b17-imported');
    await shot('theme-bound');
    mark('Bind to this chat');

    // The matching SillyTavern theme
    const before = await page.evaluate(() => ({ theme: SillyTavern.getContext().powerUserSettings.theme, selected: document.querySelector('#themes')?.value }));
    await L.mode({});
    const [response] = await Promise.all([page.waitForResponse(res => res.url().endsWith('/api/themes/save')), tap(page.locator('#ri-theme-st'))]);
    assert.equal(response.status(), 200);
    const after = await page.evaluate(() => ({ theme: SillyTavern.getContext().powerUserSettings.theme, selected: document.querySelector('#themes')?.value,
        options: [...document.querySelectorAll('#themes option')].map(option => option.value) }));
    assert.deepEqual({ theme: after.theme, selected: after.selected }, before, 'the current SillyTavern theme is untouched');
    const stName = `Roleplay Instructions, ${state.active === 'v-b17-night' ? 'B17 Imported' : 'B17 Imported'}`;
    assert.ok(after.options.includes(stName), `${stName} is selectable`);
    if (process.env.RI_ST_DATA) {
        const file = path.join(process.env.RI_ST_DATA, 'default-user/themes', `${stName}.json`);
        assert.ok(fs.existsSync(file), 'the theme file exists on the host');
        results.stThemeFile = file;
    }
    mark('matching SillyTavern theme', { name: stName });

    // ---- no network address outside the host, and the four font files from the extension folder ----
    // The host's own embeddings extension fetches a model from huggingface.co; the check is on fonts and styles, which must all come from the host.
    const outside = seen.filter(url => /^https?:/.test(url) && new URL(url).origin !== hostOrigin && (/\.(woff2?|ttf|otf|css)(\?|$)/i.test(url) || /fonts\.(googleapis|gstatic)/.test(url)));
    results.otherOutsideRequests = [...new Set(seen.filter(url => /^https?:/.test(url) && new URL(url).origin !== hostOrigin).map(url => new URL(url).origin))];
    const fontFiles = seen.filter(url => url.includes('/assets/fonts/story/'));
    results.network = { outside, fontFiles: [...new Set(fontFiles.map(url => url.split('/').pop()))] };
    assert.deepEqual(outside, [], 'nothing left the host');
    assert.ok(results.network.fontFiles.length >= 2, 'the bundled faces loaded from the extension');
    mark('network log', results.network);

    results.errors = errors;
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(OUT, `b17-w${WIDTH}-results.json`), JSON.stringify(results, null, 2));
    await browser.close();
    console.log('PASS t_themes_host');
})().catch(error => { console.error(error); process.exit(1); });
