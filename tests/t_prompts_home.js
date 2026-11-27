// B9: Setup, Prompts and the mirrored prompt editor, on a real SillyTavern host with touch emulation.
// Environment: RI_HOST_URL, RI_MOCK_LOG, RI_PLAYWRIGHT, RI_CHROME, RI_PROFILE, RI_EVIDENCE (see t_integration.js).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8247';
const LOG = process.env.RI_MOCK_LOG;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B9');
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const modelRequests = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => !['capture', 'chapter', 'condensed'].includes(row.kind)).length : 0);
const results = { host: HOST, runs: [] };

async function run(tag, viewport) {
    fs.mkdirSync(OUT, { recursive: true });
    const context = await chromium.launchPersistentContext(`${process.env.RI_PROFILE || 'C:/pw-B9'}-${tag}`, { executablePath: process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true, viewport, hasTouch: true, isMobile: viewport.width < 1000, deviceScaleFactor: 2, colorScheme: 'dark', args: ['--no-sandbox'] });
    const page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    const out = { tag, viewport, checks: {}, shots: [] };
    results.runs.push(out);
    const shot = async name => { const file = `${tag}-${name}.png`; await page.screenshot({ path: path.join(OUT, file) }); out.shots.push(file); };
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext && document.getElementById('send_textarea'), null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { for (const b of document.querySelectorAll('dialog[open] .popup-button-ok')) b.click(); });
    await page.waitForSelector('#ri_root', { state: 'attached', timeout: 30000 });
    const open = id => page.evaluate(async ({ B, id }) => {
        const { app } = await import(`${B}/src/ui/panel.js`);
        await app.openPage(id, { focusPage: true });
        await app.setExpanded(true);
        await new Promise(resolve => setTimeout(resolve, 500));
    }, { B: BASE, id });
    const shotEl = async (name, locator) => { const file = `${tag}-${name}.png`; await locator.screenshot({ path: path.join(OUT, file) }); out.shots.push(file); };
    const settle = () => page.waitForTimeout(250);
    const root = page.locator('#ri_root');
    const before = modelRequests();

    // Reset any stored state a previous run left.
    await page.evaluate(async B => {
        const store = await import(`${B}/src/store.js`);
        const st = store.settings();
        delete st.prompts; delete st.promptVariations; store.saveSettings();
    }, BASE);

    // 1. Every prompt listed once, grouped by family, with a chip and a variation count.
    await open('prompts');
    const listing = await page.evaluate(async B => {
        const home = await import(`${B}/src/ui/prompts-home.js`);
        const ids = [...document.querySelectorAll('#ri_root .ri-prompts-home [data-ri-prompt]')].map(node => node.dataset.riPrompt);
        const listed = home.listedPromptIds();
        return { ids, listed, unmapped: listed.filter(id => !home.promptPages(id).length && !id.startsWith('voice-')),
            families: [...document.querySelectorAll('#ri_root .ri-prompts-family')].map(node => node.dataset.family),
            chips: [...document.querySelectorAll('#ri_root .ri-prompts-home .ri-mirror > summary')].every(node => node.querySelector('.ri-prompt-badge') && /variation/.test(node.querySelector('.ri-prompt-count')?.textContent || '')) };
    }, BASE);
    assert.equal(new Set(listing.ids).size, listing.ids.length, 'a prompt appears twice');
    assert.deepEqual([...listing.ids].sort(), [...listing.listed].sort());
    assert.deepEqual(listing.unmapped, []);
    assert.deepEqual(listing.families, ['story', 'direction', 'reply', 'setup']);
    assert.ok(listing.chips);
    out.checks.listed = { prompts: listing.ids.length, families: listing.families };
    await shot('prompts-home');

    // 2. A slot with an unknown id shows a Problem note.
    const problem = await page.evaluate(async B => {
        const { promptGroup, promptEditor } = await import(`${B}/src/ui/prompts.js`);
        const group = promptGroup(['guided', 'noSuchPrompt']);
        const alone = promptEditor('alsoMissing');
        return { notes: group.querySelectorAll('.ri-note-problem').length, editors: group.querySelectorAll('.ri-prompt-editor').length,
            lead: group.querySelector('.ri-note-problem strong')?.textContent, alone: alone.classList.contains('ri-note-problem') };
    }, BASE);
    assert.deepEqual(problem, { notes: 1, editors: 1, lead: 'Problem', alone: true });
    out.checks.unknownId = problem;

    // 3. Two open views of one stored prompt: an edit in either shows in the other at once.
    await page.evaluate(async B => {
        const { app } = await import(`${B}/src/ui/panel.js`);
        await app.setExpanded(false);
        const { mirroredPrompt } = await import(`${B}/src/ui/prompt-mirror.js`);
        const host = document.createElement('div');
        host.id = 'b9-views';
        host.style.cssText = 'position:fixed;inset:0;padding-top:70px;scroll-padding:80px 0;overflow:auto;z-index:2147483000;background:#111';
        for (const name of ['a', 'b']) {
            const slot = document.createElement('div');
            slot.className = 'ri-root';
            slot.dataset.view = name;
            slot.append(mirroredPrompt('guided', { open: true }));
            host.append(slot);
        }
        document.body.append(host);
    }, BASE);
    const viewA = page.locator('#b9-views [data-view=a] .ri-prompt-editor'), viewB = page.locator('#b9-views [data-view=b] .ri-prompt-editor');
    await viewA.locator('textarea').fill('First edit beside the feature {direction}');
    await viewA.getByRole('button', { name: 'Update', exact: true }).tap();
    await settle();
    assert.equal(await viewB.locator('textarea').inputValue(), 'First edit beside the feature {direction}');
    assert.equal(await viewB.locator('.ri-prompt-badge').textContent(), 'Customized');
    await viewB.locator('textarea').fill('Second edit on the Prompts page {direction}');
    await viewB.getByRole('button', { name: 'Update', exact: true }).tap();
    await settle();
    assert.equal(await viewA.locator('textarea').inputValue(), 'Second edit on the Prompts page {direction}');
    const record = await page.evaluate(async B => (await import(`${B}/src/store.js`)).settings().prompts.guided.text, BASE);
    assert.equal(record, 'Second edit on the Prompts page {direction}');
    out.checks.twoViews = { stored: record };
    await page.locator('#b9-views').evaluate(node => node.scrollTo(0, 0));
    await shotEl('two-views', page.locator('#b9-views'));

    // 4. SillyTavern's verbs: Save as, Rename, Update, Delete, Undo delete, Export, Import, Restore default prompt.
    await viewA.locator('textarea').fill('Alpha wording {direction}');
    await viewA.getByRole('button', { name: 'Save as', exact: true }).tap();
    await viewA.getByLabel('Variation name', { exact: true }).fill('Alpha');
    await viewA.locator('.ri-prompt-name').getByRole('button', { name: 'Save', exact: true }).tap();
    await settle();
    assert.deepEqual(await viewB.getByLabel('Variation', { exact: true }).locator('option').allTextContents(), ['No variation', 'Alpha']);
    assert.match(await viewB.locator('.ri-prompt-count').textContent(), /1 variation/);
    await viewA.getByRole('button', { name: 'Rename', exact: true }).tap();
    await viewA.getByLabel('Variation name', { exact: true }).fill('Beta');
    await viewA.locator('.ri-prompt-name').getByRole('button', { name: 'Rename', exact: true }).tap();
    await settle();
    assert.deepEqual(await viewB.getByLabel('Variation', { exact: true }).locator('option').allTextContents(), ['No variation', 'Beta']);
    await viewA.locator('textarea').fill('Beta wording changed {direction}');
    await viewA.getByRole('button', { name: 'Update', exact: true }).tap();
    await settle();
    const [download] = await Promise.all([page.waitForEvent('download'), viewA.getByRole('button', { name: 'Export', exact: true }).tap()]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.name, 'Beta');
    assert.equal(exported.value, 'Beta wording changed {direction}');
    await viewA.getByRole('button', { name: 'Delete', exact: true }).tap();
    await settle();
    assert.deepEqual(await viewB.getByLabel('Variation', { exact: true }).locator('option').allTextContents(), ['No variations saved']);
    await viewA.getByRole('button', { name: 'Undo delete Beta' }).tap();
    await settle();
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), viewA.getByRole('button', { name: 'Import', exact: true }).tap()]);
    await chooser.setFiles({ name: 'v.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exported, name: 'Gamma', value: 'Gamma wording {direction}' })) });
    await settle();
    await viewB.getByLabel('Variation', { exact: true }).selectOption({ label: 'Gamma' });
    await settle();
    assert.equal(await viewA.locator('textarea').inputValue(), 'Gamma wording {direction}');
    await viewA.getByRole('button', { name: 'Restore default prompt', exact: true }).tap();
    await settle();
    assert.equal(await viewB.locator('.ri-prompt-badge').textContent(), 'Default');
    assert.equal(await viewB.locator('details').count(), 0, 'the editor holds no fold of its own');
    out.checks.verbs = { exported: exported.name };
    await shotEl('verbs', viewA);
    await page.locator('#b9-views').evaluate(node => node.remove());

    // 5. The foot row opens Setup, Prompts filtered to the page, with the customized count.
    await page.evaluate(async B => {
        const P = await import(`${B}/src/prompts.js`);
        P.savePrompt('guided', 'Foot row wording {direction}');
    }, BASE);
    await open('settings');
    const foot = root.locator('.ri-shell-foot-link');
    await foot.waitFor();
    const footText = (await foot.textContent()).trim();
    assert.match(footText, /^Prompts for this page \(1 customized\)$/);
    await foot.tap();
    await settle();
    const filtered = await page.evaluate(() => ({ title: document.querySelector('#ri_root .ri-prompts-filter strong')?.textContent,
        ids: [...document.querySelectorAll('#ri_root .ri-prompts-home [data-ri-prompt]')].map(node => node.dataset.riPrompt) }));
    assert.match(filtered.title, /^Prompts for /);
    assert.ok(filtered.ids.includes('guided') && filtered.ids.includes('checker') && !filtered.ids.includes('event'));
    out.checks.footRow = { footText, listed: filtered.ids.length };
    await shot('filtered');
    // The edit made on Prompts shows beside the feature.
    await root.locator('.ri-prompts-home [data-ri-prompt=guided] > summary').tap();
    const home = root.locator('.ri-prompts-home [data-ri-prompt=guided]');
    await home.locator('textarea').fill('Edited on the Prompts page {direction}');
    await home.getByRole('button', { name: 'Update', exact: true }).tap();
    await settle();
    await open('settings');
    await root.locator('.ri-prompt-group').filter({ hasText: 'Customize guided-turn instructions' }).locator(':scope > summary').tap();
    const beside = root.locator('[data-ri-prompt=guided]');
    await beside.locator(':scope > summary').tap();
    assert.equal(await beside.locator('textarea').inputValue(), 'Edited on the Prompts page {direction}');
    await shot('beside-feature');

    // 6. Fold depth: the editor is the item level, two on a feature page, at most four on Prompts.
    const depth = await page.evaluate(() => {
        const nest = (node, stop) => { let n = 0; for (let p = node.parentElement; p && p !== stop; p = p.parentElement) if (p.tagName === 'DETAILS') n++; return n; };
        const body = document.querySelector('#ri_panel_page');
        const editors = [...body.querySelectorAll('.ri-prompt-editor')];
        return { deepest: Math.max(...editors.map(node => nest(node, body) + 1)), inner: Math.max(...editors.map(node => node.querySelectorAll('details').length)) };
    });
    assert.ok(depth.deepest <= 2 && depth.inner === 0, JSON.stringify(depth));
    await open('prompts');
    await root.getByRole('button', { name: 'Show every prompt' }).tap();
    await root.locator('.ri-prompts-family[data-family=story] > summary').tap();
    await root.locator('[data-ri-prompt=timingUpdate] > summary').tap();
    const homeDepth = await page.evaluate(() => {
        const body = document.querySelector('#ri_panel_page');
        const node = body.querySelector('[data-ri-prompt=timingUpdate]');
        let n = 1; for (let p = node.parentElement; p && p !== body; p = p.parentElement) if (p.tagName === 'DETAILS') n++;
        return { depth: n, inner: node.querySelectorAll('details').length };
    });
    assert.ok(homeDepth.depth <= 4 && homeDepth.inner === 0, JSON.stringify(homeDepth));
    out.checks.foldDepth = { feature: depth, prompts: homeDepth };
    await shot('prompts-open-editor');

    // 7. No emoji in any prompt text or label this page shows.
    const emoji = await page.evaluate(async B => {
        const { PROMPTS } = await import(`${B}/src/prompts.js`);
        const pattern = /\p{Extended_Pictographic}|\uFE0F/u;
        return Object.entries(PROMPTS).filter(([, def]) => pattern.test(def.label + def.text + def.help)).map(([id]) => id);
    }, BASE);
    out.checks.emojiPrompts = emoji;
    assert.equal(modelRequests(), before, 'the prompt editors made a model request');
    assert.deepEqual(errors, []);
    await page.evaluate(async B => { const P = await import(`${B}/src/prompts.js`); P.restorePrompt('guided'); }, BASE);
    await context.close();
}

(async () => {
    await run('w523', { width: 523, height: 1021 });
    await run('w1006', { width: 1006, height: 909 });
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS: t_prompts_home', JSON.stringify(results.runs.map(r => r.checks.listed)));
})().catch(error => { console.error(error); process.exitCode = 1; });
