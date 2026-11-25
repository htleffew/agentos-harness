// B42 host pass: [[OOC: ...]] notes through a real SillyTavern 1.19.0 send, read back from the mock model's request
// log. Runs at 390 x 780 with touch (the send is a tap on the send button) and 1006 x 909 (Enter sends).
// Checks: the marker is gone from the saved and shown message; the request carries the note once as a private
// direction beginning OOC:; the Sent card lists it; a swipe sends it again; an edit of the message cannot bring the
// marker back; a note alone is refused with no request; RI never reads the message as an aside or files the note.
//
// Environment: RI_HOST_URL, RI_MOCK_LOG, RI_PLAYWRIGHT, RI_CHROME, RI_PROFILE, RI_EVIDENCE as in t_wrap_buttons.js.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright-core');

const HOST = process.env.RI_HOST_URL || 'http://127.0.0.1:8251';
const LOG = process.env.RI_MOCK_LOG;
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B42');
const CHROME = process.env.RI_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = process.env.RI_PROFILE || 'C:\\pw-b42';
const BASE = '/scripts/extensions/third-party/roleplay-instructions';
const results = { host: HOST, runs: [] };

const allRows = () => (LOG && fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
const replyRows = () => allRows().filter(row => row.kind === 'reply' && !row.url.includes('models'));
const textOf = message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
        const Q = await import(`${BASE}/src/quick-actions.js`);
        Q.setBarFolded(false);
        (await import(`${BASE}/src/inline-direction.js`)).saveInlineSettings({ marker: true, ooc: true, italic: true, quote: true });
        (await import(`${BASE}/src/ui/composer-bar.js`)).renderBar();
    }, BASE);
    await page.evaluate(() => SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
    await page.waitForTimeout(1500);
    return { context, page, errors };
}

const idle = page => page.waitForFunction(() => !document.body.dataset.generating || document.body.dataset.generating === 'false', null, { timeout: 60000 })
    .then(() => sleep(600));
const chat = page => page.evaluate(() => SillyTavern.getContext().chat.map(m => ({ user: !!m.is_user, mes: m.mes, notes: m.extra?.riInlineNotes || null,
    directions: m.extra?.roleplay_instructions?.quickActions?.directions?.map(d => d.text) || null, swipes: m.swipes?.length || 0 })));
const setBox = (page, text) => page.evaluate(text => {
    const box = document.querySelector('#send_textarea');
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
}, text);

/** Send with a real tap on the send button, or Enter on the desktop layout. */
async function sendNow(page, how) {
    if (how === 'enter') {
        await page.focus('#send_textarea');
        await page.keyboard.press('Enter');
    } else {
        const box = await page.evaluate(() => { const r = document.querySelector('#send_but').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.touchscreen.tap(box.x, box.y);
    }
}
async function sendAndWait(page, how, text) {
    const before = (await chat(page)).length;
    await setBox(page, text);
    await sendNow(page, how);
    await page.waitForFunction(b => { const c = SillyTavern.getContext().chat; return c.length >= b + 2 && !c.at(-1).is_user && c.at(-1).mes; }, before, { timeout: 60000 });
    await idle(page);
}
const shot = async (page, run, name) => {
    await page.screenshot({ path: path.join(OUT, `${run.label}-${name}.png`) });
    run.shots.push(`${run.label}-${name}.png`);
};

async function pass(page, run, how) {
    const c = run.checks;
    const start = replyRows().length;
    // 1. Marker in the middle: cut from the saved and shown message, sent once as a private OOC: direction.
    await sendAndWait(page, how, 'I raise the lantern. [[OOC: keep it hushed]] The corridor waits.');
    let log = await chat(page);
    const user = log.findLast(row => row.user), userIndex = log.lastIndexOf(user);
    assert.equal(user.mes, 'I raise the lantern. The corridor waits.');
    assert.deepEqual(user.notes, ['OOC: keep it hushed']);
    const shown = await page.evaluate(i => document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`)?.textContent || '', userIndex);
    assert.equal(/\[\[|hushed/.test(shown), false, 'the shown message has no marker');
    let rows = replyRows().slice(start);
    assert.equal(rows.length, 1, 'one reply request');
    const request = rows[0].messages;
    const joined = request.map(textOf).join('\n');
    const notes = request.filter(m => m.role === 'system' && /Direction: OOC: keep it hushed/.test(textOf(m)));
    assert.equal(notes.length, 1, 'the note rides the request once');
    assert.equal(textOf(notes[0]), 'Directions for the current reply.\nDirection: OOC: keep it hushed');
    assert.equal(joined.split('keep it hushed').length - 1, 1, 'the note text appears once in the whole request');
    const player = request.findLast(m => m.role === 'user');
    assert.equal(textOf(player).includes('I raise the lantern. The corridor waits.'), true);
    assert.equal(/\[\[OOC/.test(joined), false, 'no marker in the request');
    assert.ok(request.indexOf(notes[0]) < request.lastIndexOf(player), 'the note comes before the player message');
    c.send = { how, user: user.mes, shown, request: request.map(m => ({ role: m.role, text: textOf(m).slice(0, 200) })).slice(-4) };
    // The note shows in the Sent card for that reply.
    const replyIndex = log.length - 1;
    assert.deepEqual(log[replyIndex].directions, ['OOC: keep it hushed']);
    c.sentCard = log[replyIndex].directions;
    // RI read the message as a story turn: it is not an aside, and capture never filed the note as story.
    assert.equal(await page.evaluate(async BASE => (await import(`${BASE}/src/worldflow.js`)).isOocTurn(), BASE), false);
    await sleep(1500);
    const background = allRows().filter(row => ['capture', 'chapter', 'condensed'].includes(row.kind));
    assert.equal(background.some(row => row.messages.map(textOf).join('\n').includes('keep it hushed')), false, 'capture never sees the note');
    await shot(page, run, 'after-send');
    // 2. Swipe: the note goes again; the player message is unchanged.
    const beforeSwipe = replyRows().length;
    await page.evaluate(() => globalThis.jQuery('#chat .last_mes .swipe_right').trigger('click'));
    await page.waitForFunction(n => SillyTavern.getContext().chat.at(-1).swipes?.length >= n, 2, { timeout: 60000 });
    await idle(page);
    rows = replyRows().slice(beforeSwipe);
    assert.equal(rows.length, 1);
    const again = rows[0].messages.filter(m => m.role === 'system' && /Direction: OOC: keep it hushed/.test(textOf(m)));
    assert.equal(again.length, 1, 'the swipe sends the note again');
    assert.equal(textOf(rows[0].messages.findLast(m => m.role === 'user')).includes('I raise the lantern. The corridor waits.'), true);
    c.swipe = { notes: again.length };
    // 3. Edit the saved message in SillyTavern: the marker text does not come back; a swipe still sends the note.
    await page.evaluate(i => {
        const mes = document.querySelector(`#chat .mes[mesid="${i}"]`);
        mes.querySelector('.mes_edit').click();
    }, userIndex);
    await page.waitForSelector(`#chat .mes[mesid="${userIndex}"] .edit_textarea`);
    const editing = await page.evaluate(i => document.querySelector(`#chat .mes[mesid="${i}"] .edit_textarea`).value, userIndex);
    assert.equal(/\[\[|hushed/.test(editing), false, 'the edit box holds no marker');
    await page.evaluate(i => {
        const mes = document.querySelector(`#chat .mes[mesid="${i}"]`);
        const area = mes.querySelector('.edit_textarea');
        area.value = 'I raise the lantern high. The corridor waits.';
        area.dispatchEvent(new Event('input', { bubbles: true }));
        mes.querySelector('.mes_edit_done').click();
    }, userIndex);
    await page.waitForTimeout(600);
    log = await chat(page);
    assert.equal(log[userIndex].mes, 'I raise the lantern high. The corridor waits.');
    assert.deepEqual(log[userIndex].notes, ['OOC: keep it hushed']);
    const beforeEdit = replyRows().length;
    await page.evaluate(() => globalThis.jQuery('#chat .last_mes .swipe_right').trigger('click'));
    await page.waitForFunction(n => SillyTavern.getContext().chat.at(-1).swipes?.length >= n, 3, { timeout: 60000 });
    await idle(page);
    rows = replyRows().slice(beforeEdit);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].messages.filter(m => m.role === 'system' && /OOC: keep it hushed/.test(textOf(m))).length, 1);
    assert.equal(rows[0].messages.map(textOf).join('\n').includes('I raise the lantern high.'), true);
    c.edit = { mes: log[userIndex].mes };
    // 4. A message of notes only is refused: no request, no new message, the text stays, a note shows on the bar.
    const countBefore = (await chat(page)).length, requestsBefore = replyRows().length;
    await setBox(page, '[[OOC: only a note]]');
    await sendNow(page, how);
    await page.waitForTimeout(1200);
    assert.equal((await chat(page)).length, countBefore, 'no message was added');
    assert.equal(replyRows().length, requestsBefore, 'no reply request was made');
    assert.equal(await page.evaluate(() => document.querySelector('#send_textarea').value), '[[OOC: only a note]]');
    const notice = await page.evaluate(() => document.querySelector('#ri_composer_bar .ri-bar-notice')?.textContent || '');
    assert.match(notice, /Note alone/);
    c.alone = { notice };
    await shot(page, run, 'note-alone');
    await setBox(page, 'a few words');
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => !!document.querySelector('#ri_composer_bar .ri-bar-notice')), false, 'the note clears when the box changes');
    // 5. Several markers, in order, in one request.
    await sendAndWait(page, how, 'Next [[OOC: first thing]] and [[OOC: second thing]] done.');
    rows = replyRows().slice(-1);
    const several = rows[0].messages.find(m => m.role === 'system' && /first thing/.test(textOf(m)));
    assert.equal(textOf(several), 'Directions for the current reply.\nDirection: OOC: first thing\nDirection: OOC: second thing');
    c.several = textOf(several);
    // 6. Marker Off: the message goes as typed, with no direction.
    await page.evaluate(async BASE => (await import(`${BASE}/src/inline-direction.js`)).saveInlineSettings({ marker: false }), BASE);
    await sendAndWait(page, how, 'Stay [[OOC: x]] put.');
    rows = replyRows().slice(-1);
    assert.equal(textOf(rows[0].messages.findLast(m => m.role === 'user')).includes('Stay [[OOC: x]] put.'), true);
    assert.equal(rows[0].messages.some(m => /Direction: OOC: x/.test(textOf(m))), false);
    c.off = true;
    await page.evaluate(async BASE => (await import(`${BASE}/src/inline-direction.js`)).saveInlineSettings({ marker: true }), BASE);
}

async function runAt(viewport, label, how) {
    const { context, page, errors } = await boot(viewport);
    const run = { label, viewport, checks: {}, shots: [] };
    results.runs.push(run);
    try {
        await pass(page, run, how);
        assert.deepEqual(errors, [], 'no page errors');
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await runAt({ width: 390, height: 780 }, 'host390', 'tap');
    await runAt({ width: 1006, height: 909 }, 'host1006', 'enter');
    fs.writeFileSync(path.join(OUT, 'results-host.json'), JSON.stringify(results, null, 2));
    console.log('B42 host pass passed');
})().catch(error => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'results-host.json'), JSON.stringify({ ...results, failure: error.stack }, null, 2));
    console.error(error);
    process.exit(1);
});
