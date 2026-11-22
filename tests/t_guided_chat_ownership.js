// SillyTavern reuses the chat array while opening a different conversation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const h = require('./lib.js');

(async () => {
    h.sync();
    h.mode({});
    const { browser, page, errors } = await h.open({ width: 390, height: 740, hasTouch: true, isMobile: true });
    const sheet = page.locator('.ri-quick-sheet');
    const composer = page.locator('#send_textarea');
    const tap = (name, scope = sheet) => scope.getByRole('button', { name, exact: typeof name === 'string' }).first().tap();
    const open = family => h.openQuickActions(page).then(() => family && tap(family));
    const close = () => tap('Close');
    const selectDraftSource = name => page.evaluate(async ({ base, name }) => {
        const { impersonationSource, setImpersonationSource } = await import(`${base}/src/impersonation.js`);
        setImpersonationSource(impersonationSource(), name);
    }, { base: h.BASE, name });
    const chatId = () => page.evaluate(() => SillyTavern.getContext().getCurrentChatId());
    const conversation = () => page.evaluate(() => SillyTavern.getContext().chat.map(m => m.mes));
    const selected = () => page.evaluate(() => {
        const m = SillyTavern.getContext().chat.at(-1);
        return { text: m.mes, swipe: m.swipe_id, versions: [...m.swipes] };
    });
    const switchTo = async id => {
        await page.evaluate(async id => {
            const host = SillyTavern.getContext();
            window.riArrayBeforeSwitch = host.chat;
            await host.openCharacterChat(id);
        }, id);
        assert.equal(await chatId(), id);
        assert(await page.evaluate(() => SillyTavern.getContext().chat === window.riArrayBeforeSwitch));
    };
    const waitRequests = async count => {
        const deadline = Date.now() + 10000;
        while (h.requests().length < count && Date.now() < deadline) await delay(50);
        assert.equal(h.requests().length, count);
    };
    const waitDraftReceipt = (id, outcome, result) => page.waitForFunction(async ({ base, id, outcome, result }) => {
        const { executionReceipt } = await import(`${base}/src/execution.js`);
        const receipt = executionReceipt('playerDraft', id);
        return receipt?.outcome === outcome && (!result || receipt.result === result);
    }, { base: h.BASE, id, outcome, result }, { timeout: 20000 });
    const age = () => page.evaluate(async base => (await import(`${base}/src/quick-action-chat.js`)).freshRemaining(), h.BASE);
    const preset = process.env.RI_GUIDED_PRESET || 'Default';
    const capture = (id, state) => {
        if (process.env.RI_GUIDED_CAPTURE) fs.appendFileSync(process.env.RI_GUIDED_CAPTURE,
            JSON.stringify({ id, preset, requests: h.requests(), state }) + '\n');
    };

    try {
        await h.openChat(page);
        await h.setupApi(page, { preset, legacyAutomation: false });
        assert.equal(await page.locator('#settings_preset_openai option:checked').textContent(), preset);
        const a = await chatId();
        h.mode({ reply: 'The keeper waits near the first stair.' });
        await h.send(page, 'I ask to borrow the red key.');
        h.mode({ reply: 'The keeper holds the red key over the ledge.' });
        await h.send(page, 'I watch the key carefully.');
        const aBefore = await conversation();
        const aComposer = 'A_ORIGIN_DRAFT I start to ask about the key.';
        await composer.fill(aComposer);

        await h.openChat(page);
        const b = await chatId();
        assert.notEqual(b, a);
        h.mode({ reply: 'The conductor checks the clock.' });
        await h.send(page, 'I look for the train schedule.');
        const bBefore = await conversation();
        const bComposer = 'B_OTHER_DRAFT I study the train schedule.';
        await composer.fill(bComposer);
        await switchTo(a);
        assert.equal(await composer.inputValue(), aComposer);

        await selectDraftSource('extension');
        h.resetLog();
        h.mode({ player: 'I ask the keeper about the red key.' });
        await open('Draft my reply');
        await tap('Generate my draft · 1 model call');
        await sheet.getByText('Draft ready to edit.', { exact: true }).waitFor();
        await tap('Dismiss');
        assert.equal(await sheet.locator('[data-quick-results] article').count(), 0);
        assert.equal(await composer.inputValue(), aComposer);
        assert.equal(h.requests().length, 1);
        await close();

        const second = 'I describe the red key and ask whether I may carry it.';
        h.mode({ player: second, delayMs: 4500 });
        await open('Draft my reply');
        await tap('Generate my draft · 1 model call');
        await waitRequests(2);
        await close();
        await switchTo(b);
        const cancelledFromOther = await page.evaluate(async base => (await import(`${base}/src/guided-turns.js`)).cancelGuidedTurn(), h.BASE);
        assert.equal(cancelledFromOther, '');
        await waitDraftReceipt(a, 'completed', 'One player draft is ready.');
        await open('Draft my reply');
        assert.equal(await sheet.locator('[data-quick-results] article').count(), 0);
        assert.equal(await composer.inputValue(), bComposer);
        assert.deepEqual(await conversation(), bBefore);
        await close();
        await switchTo(a);
        await open('Draft my reply');
        const candidates = sheet.locator('[data-quick-results] article');
        await candidates.first().waitFor({ timeout: 5000 }).catch(async error => {
            throw new Error(`${error.message}\n${await sheet.innerText()}`);
        });
        assert.equal(await candidates.count(), 1);
        assert.equal(await candidates.first().locator('textarea').inputValue(), second);
        assert.equal(await composer.inputValue(), aComposer);
        await tap('Use this wording', candidates.first());
        assert.equal(await composer.inputValue(), second);
        await open('Draft my reply');
        await tap('Recover previous composer draft');
        assert.equal(await composer.inputValue(), aComposer);
        assert.deepEqual(await conversation(), aBefore);
        const drafts = h.requests();
        assert.equal(drafts.length, 2);
        for (const request of drafts) {
            assert(h.text(request).includes(aComposer));
            assert(!h.text(request).includes(bComposer));
        }
        capture('GO8-direct-drafts', { a, b, aComposer, bComposer, second, reusedArray: true, cancelledFromOther });

        // A native impersonation uses the host composer while receiving. A
        // late completion must never restore its origin's text into chat B.
        await selectDraftSource('preset');
        h.resetLog();
        h.mode({ player: 'I lower the key on the brass ledge.', delayMs: 4500 });
        await open('Draft my reply');
        await tap('Generate my draft · 1 model call');
        await waitRequests(1);
        await close();
        await switchTo(b);
        await waitDraftReceipt(a, 'cancelled');
        assert.equal(await composer.inputValue(), bComposer);
        assert.deepEqual(await conversation(), bBefore);
        capture('GO8-native-cancel', { a, b, bComposer, reusedArray: true });
        await switchTo(a);
        assert.equal(await composer.inputValue(), aComposer);

        h.resetLog();
        h.mode({ reply: 'The keeper sets the red key on the railing.' });
        await open('Generate an alternate reply');
        await tap('Generate alternate reply');
        await sheet.getByText('Reply updated.', { exact: true }).waitFor();
        await close();
        const baseline = await selected();
        assert(baseline.versions.length >= 2);
        h.resetLog();
        h.mode({ reply: 'He steps back from the railing.' });
        await open('Continue this reply');
        await tap('Continue this reply');
        await sheet.getByText('Reply updated.', { exact: true }).waitFor();
        const appended = await selected();
        assert.equal(appended.swipe, baseline.swipe);
        assert(appended.text.startsWith(baseline.text));
        assert(appended.text.includes('He steps back'));
        assert.deepEqual(appended.versions.filter((_, index) => index !== baseline.swipe), baseline.versions.filter((_, index) => index !== baseline.swipe));
        await tap('Undo continuation');
        await sheet.getByText('Continuation undone.', { exact: true }).waitFor();
        assert.deepEqual(await selected(), baseline);
        await waitRequests(1);
        capture('GO47-native-undo', { baseline, appended, undone: await selected() });
        await close();

        h.resetLog();
        h.mode({ reply: 'The keeper leaves through a second doorway.', delayMs: 4500 });
        const historical = page.locator('#chat .mes[mesid="2"]');
        await tap('Continue this reply', historical);
        await tap('Continue this reply · 1 model call');
        await waitRequests(1);
        await close();
        await historical.locator('.mes_edit').tap({ force: true });
        const manual = 'The keeper kneels near the lower stair.';
        await historical.locator('textarea').fill(manual);
        await historical.locator('.mes_edit_done').tap();
        await tap('Continue this reply', historical);
        await sheet.getByRole('button', { name: /Retry with the same directions/ }).waitFor({ timeout: 20000 });
        assert.equal((await conversation())[2], manual);
        assert.deepEqual(await selected(), baseline);
        await waitRequests(1);
        capture('GO47-stale-historical-edit', { manual, after: (await conversation())[2], later: await selected() });
        await close();

        h.resetLog();
        await open('Steer the next reply');
        await sheet.getByRole('textbox', { name: 'Your direction' }).fill('ORIGIN_FIVE_ACTION Bring the stair landing into view.');
        await sheet.getByText('Fresh start', { exact: true }).tap();
        await sheet.getByLabel('Duration', { exact: true }).selectOption('five');
        await tap('Queue with my next message');
        await close();
        h.mode({ reply: 'The keeper lights the landing.' });
        await h.send(page, 'I look toward the landing.');
        assert.equal(await age(), 4);
        assert.equal(h.text(h.requests()[0]).split('ORIGIN_FIVE_ACTION').length - 1, 1);
        await switchTo(b);
        assert.equal(await age(), 0);
        h.mode({ reply: 'The conductor hands over a timetable.' });
        await h.send(page, 'I read the departure board.');
        assert.equal(h.requests().length, 2);
        assert.doesNotMatch(h.text(h.requests()[1]), /ORIGIN_FIVE_ACTION|Choose new phrasing/);
        await switchTo(a);
        assert.equal(await age(), 4);
        await open();
        await sheet.getByText('Fresh start · 4 story replies remaining', { exact: true }).waitFor();
        await tap('Stop');
        assert.equal(await age(), 0);
        assert.equal(h.requests().length, 2);
        await close();
        h.mode({ reply: 'The keeper closes the stair door.' });
        await h.send(page, 'I move away from the landing.');
        assert.equal(h.requests().length, 3);
        assert.doesNotMatch(h.text(h.requests()[2]), /ORIGIN_FIVE_ACTION|Choose new phrasing/);
        capture('GO55-switch-and-stop', { a, b, counts: [4, 0, 4, 0] });
        assert.deepEqual(errors.filter(error => !/AbortError|aborted|cancelled/i.test(error)), []);
        console.log(`PASS guided chat ownership ${preset} · A8 delayed and native chat switches · A47 exact undo and stale edit rejection · A55 chat-scoped countdown and Stop`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
