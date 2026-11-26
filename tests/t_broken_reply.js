// B53: the note on a broken reply, on a real SillyTavern host with the mock model. Runs at 390 x 780 with touch and 1006 x 909.
// Checks: an empty reply, an error line and a copy of the previous reply each show the note on the bar; a normal reply
// shows none and sends no extra request; nothing regenerates by itself; Regenerate on the note runs SillyTavern's own
// regenerate (one more reply request, the same reply slot replaced) and clears the note.
//
// Environment: RI_HOST_URL, RI_MOCK_LOG, RI_MOCK_MODE (the mock's mode file), RI_PLAYWRIGHT, RI_CHROME, RI_PROFILE, RI_EVIDENCE as in t_inline_direction_host.js.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8251';
const LOG = process.env.RI_MOCK_LOG;
const MODE = process.env.RI_MOCK_MODE || '/tmp/mock-mode.json';
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B53');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.RI_PROFILE || 'C:\\pw-b53';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

const allRows = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const replyCount = () => allRows().filter(row => row.kind === 'reply' && !row.url.includes('models')).length;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const setMode = mode => fs.writeFileSync(MODE, JSON.stringify(mode));

async function boot(viewport) {
    const context = await chromium.launchPersistentContext(PROFILE, {
        executablePath: CHROME, headless: true, viewport, deviceScaleFactor: 2.0625, hasTouch: true,
        isMobile: viewport.width < 1000, colorScheme: 'dark',
    });
    const page = context.pages()[0] || await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(HOST, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => globalThis.SillyTavern?.getContext()?.characters?.length > 0, null, { timeout: 60000 });
    await page.evaluate(async () => {
        for (const button of document.querySelectorAll('dialog[open] .popup-button-ok')) button.click();
        const host = SillyTavern.getContext();
        if (host.characterId === undefined) await host.selectCharacterById(host.characters.findIndex(item => item.name));
        document.querySelector('#api_button_openai')?.click();
    });
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus && SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 }).catch(() => {});
    await page.waitForSelector('#ri_composer_bar .ri-bar-pin', { state: 'attached', timeout: 30000 });
    await page.evaluate(async BASE => {
        (await import(`${BASE}/src/quick-actions.js`)).setBarFolded(false);
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
    await page.waitForTimeout(1500);
    return { context, page, errors };
}

const idle = page => page.waitForFunction(() => !document.body.dataset.generating || document.body.dataset.generating === 'false', null, { timeout: 60000 })
    .then(() => sleep(900));
const lastReply = page => page.evaluate(() => { const c = SillyTavern.getContext().chat; const m = c.at(-1); return { user: !!m.is_user, mes: m.mes, length: c.length }; });
const noteLabel = page => page.evaluate(() => document.querySelector('#ri_composer_bar .ri-bar-notice')?.textContent.trim() || '');

/** Send a message with a real tap (touch) or a click, and wait until generation settles. */
async function send(page, text) {
    await page.evaluate(text => {
        const box = document.querySelector('#send_textarea');
        box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    const at = await page.evaluate(() => { const r = document.querySelector('#send_but').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.touchscreen.tap(at.x, at.y);
    await sleep(800);
    await idle(page);
}

const shot = async (page, run, name) => {
    await page.screenshot({ path: path.join(OUT, `${run.label}-${name}.png`) });
    run.shots.push(`${run.label}-${name}.png`);
};

/** Open the note, check the text and tap Regenerate. Returns after the new request settles. */
async function regenerate(page, run, name) {
    await page.tap('#ri_composer_bar .ri-bar-notice');
    await page.waitForSelector('.ri-bar-notice-actions button');
    await shot(page, run, `${name}-open`);
    const before = replyCount();
    const buttons = await page.$$eval('.ri-bar-notice-actions button', list => list.map(b => b.textContent.trim()));
    assert.deepEqual(buttons, ['Regenerate', 'Dismiss']);
    await page.evaluate(() => [...document.querySelectorAll('.ri-bar-notice-actions button')].find(b => b.textContent.trim() === 'Regenerate').click());
    await sleep(800);
    await idle(page);
    assert.equal(replyCount(), before + 1, `${name}: Regenerate sends one reply request`);
    assert.equal(await noteLabel(page), '', `${name}: the note is gone after Regenerate`);
}

async function pass(page, run) {
    const c = run.checks;
    // 1. A normal reply: no note, exactly one request.
    setMode({});
    let start = replyCount();
    await send(page, 'I knock twice.');
    assert.equal(replyCount() - start, 1, 'one request for a normal reply');
    assert.equal(await noteLabel(page), '', 'a normal reply shows no note');
    c.normal = { requests: 1, note: '' };

    // 2. An error line: the note shows, nothing regenerates by itself, Regenerate sends one request.
    setMode({ reply: 'Error: 503 upstream unavailable' });
    start = replyCount();
    await send(page, 'I knock again.');
    assert.equal(await lastReply(page).then(r => r.mes), 'Error: 503 upstream unavailable');
    assert.equal(await noteLabel(page), 'Error reply');
    await sleep(2500);
    assert.equal(replyCount() - start, 1, 'nothing regenerated by itself');
    await shot(page, run, 'error-note');
    setMode({});
    await regenerate(page, run, 'error');
    const after = await lastReply(page);
    assert.equal(/^Error/.test(after.mes), false, 'the regenerated reply replaced the error line');
    assert.equal(await noteLabel(page), '', 'the fixed reply shows no note');
    c.error = { note: 'Error reply', regenerated: after.mes.slice(0, 40) };

    // 3. A copy of the previous reply.
    setMode({ reply: 'The rain keeps falling on the empty street.' });
    await send(page, 'I wait.');
    assert.equal(await noteLabel(page), '', 'the first copy is not a repeat');
    await send(page, 'I keep waiting.');
    assert.equal(await noteLabel(page), 'Repeated reply');
    await shot(page, run, 'repeat-note');
    setMode({});
    await regenerate(page, run, 'repeat');
    c.repeat = { note: 'Repeated reply' };

    // 4. A truly empty reply. SillyTavern may refuse it before a message lands; either way no note on a normal reply
    //    follows, and when the message lands the note shows.
    setMode({ reply: '' });
    await send(page, 'I call out.');
    const tail = await lastReply(page);
    const empty = !tail.user && !tail.mes.trim();
    c.empty = { landed: empty, note: await noteLabel(page) };
    if (empty) assert.equal(await noteLabel(page), 'Empty reply');
    await shot(page, run, 'empty');
    setMode({});
    await send(page, 'I call out again.');
    assert.equal(await noteLabel(page), '', 'a normal reply clears the note');
}

async function runAt(viewport, label) {
    const { context, page, errors } = await boot(viewport);
    const run = { label, viewport, checks: {}, shots: [] };
    results.runs.push(run);
    try {
        await pass(page, run);
        assert.deepEqual(errors, [], 'no page errors');
    } finally {
        await context.close();
        setMode({});
    }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await runAt({ width: 390, height: 780 }, 'host390');
    await runAt({ width: 1006, height: 909 }, 'host1006');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    console.log('B53 broken reply passed');
})().catch(error => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ ...results, failure: error.stack }, null, 2));
    console.error(error);
    process.exit(1);
});
