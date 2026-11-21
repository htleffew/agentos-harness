// Request/state integration on SillyTavern with a local model fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./lib.js');

(async () => {
    h.sync();
    h.mode({});
    const { browser, page, errors } = await h.open({ width: 390, height: 720, hasTouch: true, isMobile: true });
    try {
        await h.openChat(page);
        const preset = process.env.RI_GUIDED_PRESET || 'Default';
        await h.setupApi(page, { preset });
        await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection' &&
            SillyTavern.getContext().chat.length > 0 && document.body.dataset.generating !== 'true');
        assert.equal(await page.locator('#settings_preset_openai option:checked').textContent(), preset);
        const disabled = await page.evaluate(() => SillyTavern.getContext().extensionSettings.disabledExtensions);
        const capture = (id, receipt) => {
            if (process.env.RI_GUIDED_CAPTURE) fs.appendFileSync(process.env.RI_GUIDED_CAPTURE,
                JSON.stringify({ id, preset, disabled, request: h.requests()[0], receipt }) + '\n');
        };
        const before = 'EARLY_SWIPED_PROSE The captain reads the clock.';
        const latest = 'TARGET_SWIPED_PROSE The captain closes his journal.';
        h.mode({ reply: before });
        await h.send(page, 'EARLY_PLAYER_INPUT I ask about the clock.');
        h.mode({ reply: latest });
        await h.send(page, 'CURRENT_PLAYER_INPUT I point at his journal.');
        await page.evaluate(async base => {
            const c = SillyTavern.getContext();
            c.chatCompletionSettings.impersonation_prompt = 'DISTINCTIVE_IMPERSONATION Write the player’s next contribution.';
            const {impersonationSource,setImpersonationSource}=await import(`${base}/src/impersonation.js`);
            setImpersonationSource(impersonationSource(),'preset');
            c.powerUserSettings.persona_description = 'DISTINCTIVE_PERSONA I repair clocks.';
            c.chat.at(-1).extra.roleplay_instructions.v10Changes = [{
                id: 'npc-only', kind: 'knowledge', subject: c.name2, private: true, text: 'OFFSCREEN_NPC_SECRET',
            }];
            document.querySelector('#send_textarea').value = '/newchat UNSENT_COMPOSER_FRAGMENT';
            document.querySelector('#send_textarea').setSelectionRange(2, 6);
        },h.BASE);

        const run = (family, options = {}) => page.evaluate(async ({ base, family, options }) => {
            const actions = await import(`${base}/src/guided-turns.js`);
            const target = actions.guidedTarget(options.index);
            return actions.runGuidedTurn(family, { ...options, target });
        }, { base: h.BASE, family, options });

        h.resetLog();
        const draft = await run('draft', { direction: 'ONE_DRAFT_DIRECTION' });
        assert.equal(draft.receipt.route, 'Native impersonation');
        assert.equal(draft.receipt.attempts, 1);
        assert.match(draft.text, /^I /);
        assert.equal(h.requests().length, 1);
        const impersonation = h.text(h.requests()[0]);
        for (const needle of ['DISTINCTIVE_IMPERSONATION', 'DISTINCTIVE_PERSONA', 'ONE_DRAFT_DIRECTION', 'UNSENT_COMPOSER_FRAGMENT'])
            assert.equal(impersonation.split(needle).length - 1, 1, needle);
        for (const excluded of ['OFFSCREEN_NPC_SECRET', 'TARGET_SWIPED_PROSE']) assert(!impersonation.includes(excluded), excluded);
        const composer = () => page.locator('#send_textarea').evaluate(input => [input.value, input.selectionStart, input.selectionEnd]);
        const fragment = ['/newchat UNSENT_COMPOSER_FRAGMENT', 2, 6];
        assert.deepEqual(await composer(), fragment);
        capture('C1', draft.receipt);
        console.log('capture C1 · host impersonation · one call · preset base, player persona and direction once · composer selection preserved');

        h.resetLog();
        const choices = await run('draft', { mode: 'choices', direction: 'ONE_CHOICES_DIRECTION' });
        assert.equal(choices.choices.length, 3);
        assert.equal(choices.receipt.route, 'Player-only helper');
        assert.equal(h.requests().length, 1);
        assert.equal(h.text(h.requests()[0]).split('ONE_CHOICES_DIRECTION').length - 1, 1);
        assert.deepEqual(await composer(), fragment);
        capture('C2', choices.receipt);
        console.log('capture C2 · one helper call · three choices · no composer mutation');

        h.resetLog();
        h.mode({ reply: 'The captain slides the journal over.' });
        const swipe = await run('swipe', { freshStart: true, direction: 'ONE_SWIPE_DIRECTION' });
        assert.equal(swipe.receipt.route, 'Host swipe');
        assert.equal(swipe.receipt.attempts, 1);
        assert.equal(h.requests().length, 1);
        const swiped = h.text(h.requests()[0]);
        assert.equal(swiped.split('ONE_SWIPE_DIRECTION').length - 1, 1);
        assert(swiped.includes('CURRENT_PLAYER_INPUT'));
        for (const excluded of ['EARLY_SWIPED_PROSE', 'EARLY_PLAYER_INPUT', 'TARGET_SWIPED_PROSE']) assert(!swiped.includes(excluded), excluded);
        assert.deepEqual(await composer(), fragment);
        capture('C3', swipe.receipt);
        console.log('capture C3 · one host swipe · Fresh start substituted old prose · current player text kept');

        h.resetLog();
        h.mode({ reply: 'He taps the leather spine.' });
        const continued = await run('continue', { freshStart: true, direction: 'ONE_CONTINUE_DIRECTION' });
        assert.equal(continued.receipt.route, 'Host continuation');
        assert.equal(continued.receipt.attempts, 1);
        assert.equal(h.requests().length, 1);
        assert.equal(h.text(h.requests()[0]).split('ONE_CONTINUE_DIRECTION').length - 1, 1);
        assert.deepEqual(await composer(), fragment);
        const text = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes);
        assert(text.startsWith('The captain slides the journal over.'));
        assert(text.includes('He taps the leather spine.'));
        await page.evaluate(async ({ base, undo }) => (await import(`${base}/src/guided-turns.js`)).undoGuidedContinuation(undo), { base: h.BASE, undo: continued.undo });
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes), 'The captain slides the journal over.');
        capture('C4', continued.receipt);
        console.log('capture C4 · one host continuation · exact prefix and compose selection · undo restored selected version');

        h.resetLog();
        const recovered = await run('draft', { forceHelper: true, direction: 'ONE_EXPLICIT_HELPER_DIRECTION' });
        assert.equal(recovered.receipt.route, 'Player-only helper');
        assert.equal(h.requests().length, 1);
        assert.equal(h.text(h.requests()[0]).split('DISTINCTIVE_IMPERSONATION').length - 1, 1);
        assert.equal(h.text(h.requests()[0]).split('ONE_EXPLICIT_HELPER_DIRECTION').length - 1, 1);
        assert.deepEqual(await composer(), fragment);
        capture('C7', recovered.receipt);
        console.log('capture C7 · explicit helper path retained the active preset base and the unsent slash text');

        await page.evaluate(port => {
            const $ = globalThis.jQuery;
            $('#main_api').val('textgenerationwebui').trigger('change');
            $('#textgen_type').val('ooba').trigger('change');
            $('#textgenerationwebui_api_url_text').val(`http://127.0.0.1:${port}`).trigger('input');
            $('#streaming_textgenerationwebui').prop('checked', false).trigger('input');
            $('#api_button_textgenerationwebui').trigger('click');
        }, Number(process.env.RI_MOCK_PORT || 8124));
        await page.waitForFunction(() => SillyTavern.getContext().mainApi === 'textgenerationwebui' && SillyTavern.getContext().onlineStatus !== 'no_connection');
        h.resetLog();
        h.mode({ reply: 'The captain holds the journal beneath the lamp.' });
        const retained = await run('swipe', { freshStart: true, direction: 'ONE_RETAINED_DIRECTION' });
        assert.equal(retained.receipt.history.mode, 'retained');
        assert.equal(retained.receipt.attempts, 1);
        assert.equal(h.requests().length, 1);
        const sent = h.text(h.requests()[0]);
        assert(sent.includes('EARLY_SWIPED_PROSE'));
        assert(sent.includes('CURRENT_PLAYER_INPUT'));
        assert(sent.includes('Choose new phrasing'));
        assert.equal(sent.split('ONE_RETAINED_DIRECTION').length - 1, 1);
        capture('C5', retained.receipt);
        console.log('capture C5 · one Text Completion host swipe · retained history disclosed and observed · Fresh start instruction present');

        h.resetLog();
        h.mode({ reply: 'The captain gives away the time.' });
        const later = () => page.evaluate(() => SillyTavern.getContext().chat.slice(3).map(message => message.mes));
        const laterProse = await later();
        const historical = await run('swipe', { index: 2, direction: 'ONE_HISTORICAL_DIRECTION', roll: { text: 'A d20 roll totals 9.', total: 9 } });
        assert.equal(historical.receipt.route, 'Bounded reply helper');
        assert.equal(h.requests().length, 1);
        const old = h.text(h.requests()[0]);
        assert(old.includes('EARLY_SWIPED_PROSE'));
        assert.equal(old.split('ONE_HISTORICAL_DIRECTION').length - 1, 1);
        assert.equal(old.split('A d20 roll totals 9.').length - 1, 1);
        for (const excluded of ['CURRENT_PLAYER_INPUT', 'OFFSCREEN_NPC_SECRET', 'The captain holds the journal beneath the lamp.']) assert(!old.includes(excluded), excluded);
        assert.deepEqual(await later(), laterProse);
        const choose = swipe => page.evaluate(async ({ base, swipe }) => {
            const actions = await import(`${base}/src/guided-turns.js`);
            return actions.selectGuidedVersion(actions.guidedTarget(2), swipe);
        }, { base: h.BASE, swipe });
        const original = await choose(0);
        const replacement = await choose(1);
        assert.equal(original.text, before);
        assert.equal(replacement.text, 'The captain gives away the time.');
        assert.equal(h.requests().length, 1);
        assert.deepEqual(await later(), laterProse);
        capture('C6', historical.receipt);
        console.log('capture C6 · historical helper bounded to the target · later prose unchanged · original and alternate selected with no additional calls');

        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
