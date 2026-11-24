// B31: the extension's own cards in the stack reach the real request. Drives SillyTavern 1.19.0 with the mock model and reads
// the request the mock logged (never a rebuilt copy). It checks:
//   - the order of the RI cards in the stack is the order of the guidance in the next request, and the old per-chat module
//     order is read once into that order with every card still on;
//   - with her saved wording and the clean card both in the stack the request carries both texts, clean first; with one it
//     carries that one; with neither the feature sends nothing.
// Environment: RI_HOST_URL, RI_PLAYWRIGHT, RI_CHROME, RI_MOCK_*, RI_EVIDENCE (the request texts and results.json).
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const preset = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json', `file://${__filename}`)));
const OUT = process.env.RI_EVIDENCE || path.join(__dirname, '../docs/ux-overhaul/audit/evidence/build/B31');
fs.mkdirSync(OUT, { recursive: true });
const results = { host: process.env.RI_HOST_URL, steps: [] };

const COLORS = 'Use ordinary quoted dialogue and natural speech attribution';
const EMOTIONS = 'Consider established emotional dimensions and outward bearing';
const WORDING = 'CUSTOM-EMOTION-WORDING: let feelings leak into small gestures.';

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open();
    page.on('pageerror', error => console.error(error.stack));
    const inPage = (fn, value) => page.evaluate(fn, { B: L.BASE, value });
    const stack = () => inPage(async ({ B }) => {
        const bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
        const base = V.activePreset();
        const key = bank.stackFor(bank.currentBank() || bank.refreshBank('t'), base).key;
        return { base, key, ri: bank.storedStack(key).ri.map(item => ({ key: item.key, on: item.on })) };
    });
    const tap = (action, keys) => inPage(async ({ B, value }) => {
        const bank = await import(`${B}/src/preset-bank.js`), V = await import(`${B}/src/v10.js`);
        const base = V.activePreset(), b = bank.currentBank() || bank.refreshBank('t');
        const key = bank.stackFor(b, base).key;
        if (value.action === 'include') bank.includeCards(b, key, value.keys, { base });
        else if (value.action === 'exclude') bank.excludeCards(b, key, value.keys, { base });
        else if (value.action === 'step') bank.stepCard(b, key, value.keys[0], value.delta, { base });
    }, { action, keys: [].concat(keys).map(item => item.key ?? item), delta: keys.delta });
    const send = async (label, text = 'I wait.') => {
        L.resetLog();
        L.mode({ reply: 'Mira waits.' });
        await L.send(page, text);
        const rows = L.requests('reply');
        assert.ok(rows.length >= 1, `${label}: the mock logged a reply request`);
        const body = L.text(rows.at(-1));
        fs.writeFileSync(path.join(OUT, `request-${label}.txt`), body);
        return body;
    };
    const count = (body, needle) => body.split(needle).length - 1;
    const mark = (label, data) => results.steps.push({ label, ...data });

    try {
        await L.setupApi(page);
        await page.evaluate(data => SillyTavern.getContext().getPresetManager('openai').savePreset(data.name, data), preset);
        await L.usePreset(page, preset.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' }, world: { update: 'all', head: 0 } });
        await L.openChat(page);
        await inPage(async ({ B }) => {
            const V = await import(`${B}/src/v10.js`), S = await import(`${B}/src/store.js`);
            if (!V.enabledV10()) throw new Error(`The companion did not activate V10: ${V.activePreset()}`);
            V.prefs().modules = { colors: true, emotions: true };
            S.saveChatState();
            await V.ensureWorld();
        });

        // 1. The factory order: dialogue colors before emotions.
        const first = await send('1-factory-order');
        assert.ok(first.includes(COLORS) && first.includes(EMOTIONS), 'both features reach the request');
        assert.ok(first.indexOf(COLORS) < first.indexOf(EMOTIONS), 'factory order: dialogue colors, then emotions');
        const start = await stack();
        assert.ok(start.ri.every(item => item.on), 'a new stack has every RI card on');
        mark('factory', { order: [first.indexOf(COLORS), first.indexOf(EMOTIONS)], stack: start.ri.length });

        // 2. The old per-chat order is read once: emotions first. Every card stays on.
        await inPage(async ({ B }) => {
            const V = await import(`${B}/src/v10.js`), S = await import(`${B}/src/store.js`);
            V.prefs().moduleOrder = ['emotions', 'colors', 'style', 'preflight', 'state', 'plots', 'knowledge', 'relationships', 'worldEvents', 'dice', 'roastFeedback', 'roast'];
            delete V.prefs().moduleOrderRead;
            S.saveChatState();
        });
        const second = await send('2-old-order-read-once');
        assert.ok(second.indexOf(EMOTIONS) < second.indexOf(COLORS), 'the old order moves emotions first');
        const read = await stack();
        assert.deepEqual(read.ri.map(item => item.key).filter(key => !['ri::emotions', 'ri::colors'].includes(key)).sort(),
            start.ri.map(item => item.key).filter(key => !['ri::emotions', 'ri::colors'].includes(key)).sort(), 'no card left the stack');
        assert.deepEqual(read.ri.map(item => item.on), read.ri.map(() => true), 'every card is still on');
        assert.equal(read.ri.length, start.ri.length);
        assert.equal(await inPage(async ({ B }) => (await import(`${B}/src/v10.js`)).prefs().moduleOrderRead), true);
        mark('old-order', { order: read.ri.map(item => item.key).slice(0, 4), stackAfter: read.ri });
        // Read once: a later change to the old record changes nothing.
        await inPage(async ({ B }) => { const V = await import(`${B}/src/v10.js`); V.prefs().moduleOrder = ['colors', 'emotions']; });
        const again = await send('3-old-order-not-read-again');
        assert.ok(again.indexOf(EMOTIONS) < again.indexOf(COLORS), 'the old record is not read a second time');

        // 3. Her tap on a card's step button changes the next request.
        await tap('step', Object.assign(['ri::emotions'], { delta: 1 }));
        const stepped = await send('4-after-step');
        assert.ok(stepped.indexOf(COLORS) < stepped.indexOf(EMOTIONS), 'one step later puts emotions after dialogue colors');
        const after = await stack();
        assert.deepEqual(after.ri.map(item => item.key).slice(0, 2), ['ri::colors', 'ri::emotions']);
        mark('step', { order: after.ri.map(item => item.key).slice(0, 4) });

        // 4. Her saved wording: a version beside the clean card; the request keeps carrying her wording.
        await inPage(async ({ B, value }) => {
            const P = await import(`${B}/src/prompts.js`);
            P.savePrompt('emotionSensitivity', `${value} Sensitivity: {sensitivity}.`);
        }, WORDING);
        const folded = await send('5-saved-wording');
        assert.ok(folded.includes(WORDING), 'her wording reaches the request');
        assert.equal(folded.includes(EMOTIONS), false, 'the shipped wording is not sent beside it until she puts the clean card back');
        const wordingStack = await stack();
        const keys = wordingStack.ri.map(item => item.key);
        assert.equal(keys[keys.indexOf('ri::emotions') + 1], 'v::ri-emotions');
        mark('saved-wording', { keys: keys.slice(0, 5), on: wordingStack.ri.slice(0, 5).map(item => item.on) });

        // 5. Both in the stack: both texts, clean first.
        await tap('include', ['ri::emotions']);
        const both = await send('6-both');
        assert.equal(count(both, WORDING), 1, 'her wording is sent once');
        assert.equal(count(both, EMOTIONS), 1, 'the shipped wording is sent once');
        assert.ok(both.indexOf(EMOTIONS) < both.indexOf(WORDING), 'the clean card comes first');
        assert.ok(both.indexOf(COLORS) < both.indexOf(EMOTIONS), 'the group order still holds');

        // 6. One at a time.
        await tap('exclude', ['v::ri-emotions']);
        const clean = await send('7-clean-only');
        assert.ok(clean.includes(EMOTIONS) && !clean.includes('CUSTOM-EMOTION-WORDING'), 'the clean card alone sends the shipped wording');
        await tap('include', ['v::ri-emotions']);
        await tap('exclude', ['ri::emotions']);
        const mine = await send('8-wording-only');
        assert.ok(mine.includes(WORDING) && !mine.includes(EMOTIONS), 'her version alone sends her wording');

        // 7. Neither card: the feature sends none of its text.
        await tap('exclude', ['v::ri-emotions']);
        const none = await send('9-neither');
        assert.ok(!none.includes(WORDING) && !none.includes(EMOTIONS), 'a feature with both cards out sends nothing');
        assert.ok(none.includes(COLORS), 'the other cards are unaffected');
        mark('final', { stack: (await stack()).ri.slice(0, 5) });
        assert.deepEqual(errors, [], 'page errors');
    } finally {
        fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
        await browser.close();
    }
    console.log('ri cards: passed');
})().catch(error => { console.error(error); process.exit(1); });
