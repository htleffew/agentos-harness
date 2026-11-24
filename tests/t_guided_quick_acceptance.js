// Phone-width acceptance for historical scope, player context, recovery and all Fresh start routes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const h = require('./lib.js');

const marker = {
    past: 'REPEATED_CLOCK_OPENING', future: 'FUTURE_MISSING_GEARS', secret: 'NPC_ONLY_CLOCK_TUNNEL',
    place: 'CLOCK_STAIR_LANDING', known: 'KNOWN_SAFE_LEVER', offscreen: 'OFFSCREEN_QUAYSIDE_FIRE',
    oldCue: 'EXPIRED_CLOCK_DIRECTION', current: 'CURRENT_CLOCK_DIRECTION', ordinary: 'ORDINARY_MODEL_CLOCK_NUDGE',
    own: 'PLAYER_CONSERVATOR', npc: 'NPC_CLOCK_GUARD', fragment: 'UNSENT_PLAYER_FRAGMENT',
};
const sourceTitle = 'Untriggered clock tunnel';
const oldOpening = `${marker.past} The guard counts to seven.`;
const choiceTexts = ['I ask about the lever.', 'I step away from the stairs.', 'I set the key on the stone ledge.'];
const containsOnce = (text, expected) => assert.equal(text.split(expected).length - 1, 1, expected);
const excludes = (text, avoided) => { for (const name of avoided) assert(!text.includes(name), name); };

async function makeStoryWorld(page) {
    return page.evaluate(async ({ base, marker, sourceTitle }) => {
        const { settings, saveSettings } = await import(`${base}/src/store.js`);
        const { saveSet } = await import(`${base}/src/books.js`);
        const { setChatWorld, newWorldEntry, writeWorldEntry } = await import(`${base}/src/world.js`);
        const host = SillyTavern.getContext();
        const id = `Guided clock fixture ${Date.now()}`;
        settings().sets[id] = { kind: 'world' };
        const data = { entries: {} };
        const add = (kind, name, fields, changes = {}) => {
            const row = Object.assign(newWorldEntry(data, kind), { name }, changes);
            Object.assign(row.fields, fields);
            writeWorldEntry(data, row, id);
        };
        add('character', host.name2, { who: `${marker.npc} The guard never repairs the clock.`, role: 'Clock guard' });
        add('secret', sourceTitle, { holder: host.name2, secret: `${marker.secret} The guard plans to open the tunnel after midnight.` }, { show: 'full', status: 'kept' });
        add('secret', 'Player lever memory', { holder: host.name1, secret: `${marker.known} A red stripe marks the brake lever.` }, { status: 'kept' });
        add('place', 'Clock stair', { what: `${marker.place} The stone landing near the stairs.` });
        await saveSet(id, data);
        await host.updateWorldInfoList();
        setChatWorld(id);
        host.powerUserSettings.persona_description = `${marker.own} I maintain antique mechanisms.`;
        saveSettings();
        return { id, player: host.name1, npc: host.name2 };
    }, { base: h.BASE, marker, sourceTitle });
}

async function setScene(page, marker, names) {
    await page.evaluate(async ({ base, marker, names }) => {
        const state = await import(`${base}/src/state.js`);
        state.editScene('where', marker.place, false);
        state.editScene('present', `${names.player}, ${names.npc}`, false);
    }, { base: h.BASE, marker, names });
}

async function ordinaryInstruction(page, name) {
    await page.evaluate(async ({ base, name, text }) => {
        const { settings, chatState, saveChatState, saveSettings } = await import(`${base}/src/store.js`);
        const { saveSet, newInstruction, writeInstruction } = await import(`${base}/src/books.js`);
        if (!name) { chatState().activeSets = []; saveChatState(); return; }
        settings().sets[name] = { limit: 'none', max: 3 };
        const book = { entries: {} }, instruction = newInstruction(book);
        Object.assign(instruction, { name, actor: 'model', chance: 100, wait: 0, versions: [{ text }] });
        writeInstruction(book, instruction);
        await saveSet(name, book);
        await SillyTavern.getContext().updateWorldInfoList();
        chatState().activeSets = [name];
        saveChatState();
        saveSettings();
    }, { base: h.BASE, name, text: `${marker.ordinary} Write the guard’s gestures in precise language.` });
}

(async () => {
    h.sync();
    const { browser, page, errors } = await h.open({ width: 390, height: 740, hasTouch: true, isMobile: true });
    const sheet = page.locator('.ri-quick-sheet');
    const composer = page.locator('#send_textarea');
    const tap = (name, scope = sheet) => scope.getByRole('button', { name, exact: typeof name === 'string' }).first().tap();
    const exactText = (name, scope = sheet) => scope.getByText(name, { exact: true });
    const open = family => h.openQuickActions(page).then(() => tap(family));
    const close = () => tap('Close');
    const direction = () => sheet.getByRole('textbox', { name: 'Your direction', exact: true });
    const chat = () => page.evaluate(() => SillyTavern.getContext().chat.map(message => message.mes));
    const acceptedState = () => page.evaluate(async base => {
        const host = SillyTavern.getContext();
        const { quickChat } = await import(`${base}/src/quick-action-chat.js`);
        const { chatWorld, loadWorld } = await import(`${base}/src/world.js`);
        const world = chatWorld();
        return JSON.parse(JSON.stringify({ chat: host.chat, world: world && await loadWorld(world), queue: quickChat().pending }));
    }, h.BASE);
    const fresh = async () => {
        if (!(await sheet.getByLabel('Duration', { exact: true }).isVisible())) await exactText('Fresh start').tap();
        await sheet.getByLabel('Duration', { exact: true }).selectOption('one');
    };
    const preset = process.env.RI_GUIDED_PRESET || 'Roleplay Instructions V10';
    const initialPreset = preset === 'Default' ? 'Roleplay Instructions V10' : 'Default';
    let disabled = [];
    const record = (id, extra = {}) => {
        const requests = h.requests();
        assert.equal(requests.length, 1, id);
        if (process.env.RI_GUIDED_CAPTURE) fs.appendFileSync(process.env.RI_GUIDED_CAPTURE,
            JSON.stringify({ id, preset, disabled, request: requests[0], ...extra }) + '\n');
        return h.text(requests[0]);
    };
    const answer = async (text, message) => {
        h.mode({ reply: text });
        await h.send(page, message);
    };
    const oldReply = index => h.openReplyAction(page, 'swipe', index);
    const saved = () => exactText('Reply updated.').waitFor({ timeout: 20000 });
    const draftReady = () => exactText('Draft ready to edit.').waitFor({ timeout: 20000 });
    const choicesReady = count => exactText(`${count} of 3 choices received.`).waitFor({ timeout: 20000 });
    const playerRequest = (capture, cue = '') => {
        assert(capture.includes(marker.own));
        assert(capture.includes(marker.known));
        assert(capture.includes(marker.fragment));
        assert(capture.includes(marker.place));
        assert.match(capture, /first-person point of view/);
        for (const stop of [marker.secret, marker.offscreen, marker.npc, marker.future]) assert(!capture.includes(stop), stop);
        if (cue) containsOnce(capture, cue);
    };

    try {
        h.mode({});
        await h.openChat(page);
        await h.setupApi(page, { preset: initialPreset, legacyAutomation: false });
        assert.equal(await page.locator('#settings_preset_openai option:checked').textContent(), initialPreset);
        disabled = await h.assertQuietHost(page);
        const names = await makeStoryWorld(page);
        await open('Steer the next reply');
        await direction().fill(`${marker.oldCue} Have the guard gesture toward the clock.`);
        await sheet.getByLabel('Delivery', { exact: true }).selectOption('visible');
        await tap('Queue with my next message');
        await close();
        await answer(oldOpening, 'I check the clock chain.');
        await setScene(page, marker, names);
        await answer(oldOpening + ` ${marker.future} The guard sees missing gears. ${marker.offscreen} The distant quay is burning.`,
            'I set my lamp on the landing.');
        await setScene(page, marker, names);

        const later = (await chat()).slice(3);
        await oldReply(2);
        await direction().fill('Let me hear the chain move. HISTORICAL_SCOPE_CONTROL');
        h.resetLog();
        h.mode({ reply: 'The guard turns a brass key.' });
        await tap('Generate alternate reply · 1 model call');
        await saved();
        const bounded = record('GA16-bounded', { laterBefore: later, laterAfter: (await chat()).slice(3), world: names.id });
        excludes(bounded, [marker.future, marker.secret, marker.offscreen, marker.oldCue]);
        containsOnce(bounded, 'HISTORICAL_SCOPE_CONTROL');
        assert.deepEqual((await chat()).slice(3), later);
        await close();

        await oldReply(2);
        await tap('Browse directions');
        await sheet.getByRole('searchbox', { name: 'Search quick actions' }).fill(sourceTitle);
        await tap(sourceTitle);
        await exactText('Reveal this secret').tap();
        await sheet.getByRole('textbox', { name: 'Who may learn it' }).fill(names.player);
        await tap('Preview explicit reveal');
        await tap('Select direction');
        h.resetLog();
        h.mode({ reply: 'The guard points at the tunnel map.' });
        await tap('Generate alternate reply · 1 model call');
        await saved();
        const history = await page.evaluate(() => SillyTavern.getContext().chat[2].extra.roleplay_instructions.guided);
        const bolder = record('GA16-explicit-source', { history });
        containsOnce(bolder, marker.secret);
        excludes(bolder, [marker.future, marker.offscreen]);
        assert.deepEqual(history.additionalSources.map(source => [source.book, source.title]), [[names.id, sourceTitle]]);
        await sheet.locator('.ri-execution').filter({ hasText: 'Selected extra sources' }).locator(':scope > summary').tap();
        await exactText('Selected extra sources').waitFor();
        assert.match(await sheet.locator('.ri-execution dd').filter({ hasText: names.id }).textContent(), /Untriggered clock tunnel/);
        assert.equal(h.requests().length, 1);
        await close();

        // Switch the actual preset before invoking any of the four resets.
        await h.setupApi(page, { preset, legacyAutomation: false });
        assert.equal(await page.locator('#settings_preset_openai option:checked').textContent(), preset);
        await ordinaryInstruction(page, `Plain random model instruction ${Date.now()}`);
        h.resetLog();
        await answer(oldOpening, 'I listen for the clockworks.');
        const normal = record('GA54-random-control', { initialPreset, activePreset: preset });
        assert(normal.includes(marker.ordinary));
        assert(normal.includes(marker.past));
        assert(!normal.includes('Choose new phrasing, reactions and scene movement'));
        await ordinaryInstruction(page, '');
        await setScene(page, marker, names);

        const reset = (sent, detail, { includes = [], excludes: additional = [] } = {}) => {
            containsOnce(sent, detail);
            assert(sent.includes('Choose new phrasing, reactions and scene movement'));
            assert(sent.includes(marker.place));
            excludes(sent, [marker.past, marker.oldCue, marker.ordinary, ...additional]);
            for (const value of includes) assert(sent.includes(value), value);
        };

        await open('Steer the next reply');
        await direction().fill(`${marker.current}_STEER Ground the next beat in the clock stair.`);
        await fresh();
        await tap('Queue with my next message');
        await close();
        h.resetLog();
        await answer('The guard settles his lamp beside the stair.', 'CURRENT_SEND I raise one hand.');
        reset(record('GA54-steer', { initialPreset, activePreset: preset }), `${marker.current}_STEER`, { includes: ['CURRENT_SEND'] });

        await open('Generate an alternate reply');
        await direction().fill(`${marker.current}_SWIPE Keep the lamp low.`);
        await fresh();
        h.resetLog();
        h.mode({ reply: 'The guard rests a small lamp on the landing.' });
        await tap('Generate alternate reply');
        await saved();
        reset(record('GA54-swipe', { initialPreset, activePreset: preset }), `${marker.current}_SWIPE`, { includes: ['CURRENT_SEND'] });
        await close();

        const prefix = (await chat()).at(-1);
        await open('Continue this reply');
        await direction().fill(`${marker.current}_CONTINUE Have him walk to the stairs.`);
        await fresh();
        h.resetLog();
        h.mode({ reply: 'He steps toward the stairs.' });
        await tap('Continue this reply');
        await saved();
        reset(record('GA54-continue', { initialPreset, activePreset: preset, prefix, resultingText: (await chat()).at(-1) }),
            `${marker.current}_CONTINUE`, { includes: [prefix] });
        assert((await chat()).at(-1).startsWith(prefix));
        await close();
        await setScene(page, marker, names);

        await composer.fill(marker.fragment);
        await open('Draft my reply');
        await direction().fill(`${marker.current}_DRAFT Use something I know about the lever.`);
        await fresh();
        h.resetLog();
        h.mode({ player: 'I point to the red stripe and identify the brake lever.' });
        await tap('Generate my draft · 1 model call');
        await draftReady();
        const playerReset = record('GA54-draft', { initialPreset, activePreset: preset });
        reset(playerReset, `${marker.current}_DRAFT`, { includes: [marker.fragment, marker.known], excludes: [prefix] });
        playerRequest(playerReset);
        assert.equal(await composer.inputValue(), marker.fragment);
        await close();

        await page.evaluate(async base => {
            const { impersonationSource, setImpersonationSource } = await import(`${base}/src/impersonation.js`);
            setImpersonationSource(impersonationSource(), 'extension');
        }, h.BASE);
        const templates = [
            ['Respond naturally as me', 'fits how I have spoken', 'I check the latch before I reply.'],
            ['Do something bold', 'decisive action', 'I put the only key on the landing and name my price.'],
            ['Introduce an NPC', 'introduce someone', 'I call the caretaker over from the open doorway.'],
            ['Initiate an intimate moment', 'invitation that fits', 'I offer my hand and ask whether we can sit together.'],
            ['Continue an intimate moment', 'respond to the intimacy', 'I take his offered hand and sit beside him.'],
            ['Introduce a plot twist', 'Twist type: Revelation.', 'I lift up my own duplicate key and admit I made it.'],
        ];
        for (const [name, cue, text] of templates) {
            await open('Draft my reply');
            await tap(name);
            if (name === 'Introduce a plot twist') await sheet.getByLabel('Twist type', { exact: true }).selectOption('Revelation');
            const qualifier = `TEMPLATE_QUALIFIER ${name}. Keep the landing in view.`;
            await direction().fill(qualifier);
            h.resetLog();
            h.mode({ player: text });
            await tap('Generate my draft · 1 model call');
            await draftReady();
            const sent = record(`GA27-${name}`, { fixtureOutput: text });
            playerRequest(sent, cue);
            containsOnce(sent, qualifier);
            assert.equal(await sheet.locator('[data-quick-results] textarea').first().inputValue(), text);
            assert.equal(await composer.inputValue(), marker.fragment);
            await close();
        }

        await open('Draft my reply');
        await tap('Do something bold');
        const retryDirection = 'GA27_RETRY Keep my hands on the lever.';
        await direction().fill(retryDirection);
        h.resetLog();
        h.mode({ fail: true });
        await tap('Generate my draft · 1 model call');
        await sheet.getByRole('button', { name: /Retry with the same directions/ }).waitFor({ timeout: 20000 });
        containsOnce(record('GA27-failed-attempt'), retryDirection);
        assert.equal(await composer.inputValue(), marker.fragment);
        assert.equal(await direction().inputValue(), retryDirection);
        h.resetLog();
        h.mode({ player: 'I grip the brake lever and call out before I pull.' });
        await tap(/Retry with the same directions/);
        await draftReady();
        const retry = record('GA27-explicit-retry');
        playerRequest(retry, 'decisive action');
        containsOnce(retry, retryDirection);
        await close();

        // This viewport change simulates space left by a phone keyboard. The
        // browser touch context keeps the textarea focused across the resize.
        const prior = await acceptedState();
        h.resetLog();
        await open('Draft my reply');
        await tap('Make it more dramatic');
        await tap(/Make it more dramatic/);
        await tap('Do something bold');
        const optionText = 'I want to remain within sight of the stair. CYOA_TYPED_QUALIFIER';
        await direction().fill(optionText);
        await page.setViewportSize({ width: 390, height: 360 });
        assert(await direction().evaluate(input => document.activeElement === input));
        await close();
        await open('Draft my reply');
        assert.equal(await direction().inputValue(), optionText);
        assert.equal(h.requests().length, 0);
        h.mode({ choices: JSON.stringify(choiceTexts) });
        await tap('Give me choices · 1 model call');
        await choicesReady(3);
        const choices = record('GA45-choices', { keyboardViewport: '390 × 360', fixtureOutput: choiceTexts });
        playerRequest(choices, 'decisive action');
        containsOnce(choices, optionText);
        assert(!choices.includes('Raise the stakes of my next choice'));
        const cards = sheet.locator('[data-quick-results] article');
        const edit = 'I offer to check the lever aloud.';
        await cards.first().locator('textarea').fill(edit);
        await tap('Use this wording', cards.first());
        assert.equal(await composer.inputValue(), edit);
        assert.equal(h.requests().length, 1);
        await open('Draft my reply');
        await tap('Dismiss', cards.first());
        assert.equal(await cards.count(), 2);
        await tap('Recover previous composer draft');
        assert.equal(await composer.inputValue(), marker.fragment);
        assert.equal(h.requests().length, 1);

        await open('Draft my reply');
        h.resetLog();
        const expansion = 'I touch the red stripe and ask whether the lever is safe.';
        h.mode({ player: expansion });
        await tap('Draft from this choice · 1 model call', cards.first());
        await draftReady();
        playerRequest(record('GA45-expand', { fixtureOutput: expansion }), choiceTexts[1]);
        assert.equal(await cards.first().locator('textarea').inputValue(), expansion);
        assert.equal(await composer.inputValue(), marker.fragment);
        assert.deepEqual(await acceptedState(), prior);
        await close();
        await page.setViewportSize({ width: 390, height: 740 });

        for (const [caseId, raw] of [
            ['mixed-list', '1. Keep talking\n- **Try the lever** — I ask about the lever.\n---\n• [Your choice]\n2) I step away from the stairs.\n- I begin to'],
            ['truncated-list', '["I ask about the lever.", {"text":"I step away from the stairs."}, "I begin to'],
            ['empty', ''],
        ]) {
            await open('Draft my reply');
            h.resetLog();
            h.mode({ choices: raw });
            await tap('Give me choices · 1 model call');
            if (raw) {
                await choicesReady(2);
                const recovered = await sheet.locator('[data-quick-results] article textarea').evaluateAll(fields => fields.map(field => field.value));
                assert.deepEqual(recovered, choiceTexts.slice(0, 2));
                await exactText('Raw output and recovery').tap();
                const partial = sheet.getByRole('textbox', { name: 'Partial result' });
                assert.equal(await partial.inputValue(), raw);
                const use = sheet.getByRole('button', { name: 'Use edited wording', exact: true });
                assert(await use.isDisabled());
                if (caseId === 'mixed-list') {
                    const manual = 'I point out the red stripe before I reach for the lever.';
                    await partial.fill(manual);
                    await use.tap();
                    assert.equal(await composer.inputValue(), manual);
                    assert.equal(h.requests().length, 1);
                    await open('Draft my reply');
                    await tap('Recover previous composer draft');
                    assert.equal(await composer.inputValue(), marker.fragment);
                    await open('Draft my reply');
                }
            } else {
                await sheet.getByRole('button', { name: /Retry with the same directions/ }).waitFor({ timeout: 20000 });
            }
            record(`GA17-${caseId}`, { raw });
            assert.equal(await composer.inputValue(), marker.fragment);
            assert.deepEqual(await acceptedState(), prior);
            await close();
        }

        assert.deepEqual(errors.filter(error => !/No message generated|empty response|Fixture provider unavailable/i.test(error)), []);
        console.log(`PASS guided acceptance ${preset} after ${initialPreset} · GA16 historical scope, GA17 damaged results, GA27 templates, GA45 recovery, GA46 player boundary, GA54 four Fresh start routes`);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
