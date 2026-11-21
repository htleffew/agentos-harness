// Verify native group swipes and continuation through the phone controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
const h = require('./lib.js');

const cases = [
    { id: 'single', cast: 'Bell keeper', direction: 'Let the exchange settle for a moment.', reply: 'The bell keeper explains the worn key.' },
    { id: 'multiple', cast: 'Bell keeper, Toll clerk', direction: 'Follow whichever person has more to say about the key.', reply: 'The toll clerk asks where the key came from.' },
    { id: 'arrival', cast: 'Bell keeper, Toll clerk', direction: 'Leave room for a plausible arrival from the bridge.', reply: 'A courier reaches the landing, holding a sealed parcel.' },
    { id: 'specified', cast: 'Bell keeper, Toll clerk', direction: 'Let the bell keeper answer the last question.', reply: 'The bell keeper names the lock it fits.' },
];

async function verifyCastMatrix(page, type, preset) {
    const history = [];
    for (let index = 0; index < 6; index++) {
        const reply = `CAST_HISTORY_${index} The watch officer studies the key at step ${index}.`;
        history.push(reply);
        h.mode({ reply });
        await h.send(page, index === 5 ? `${type.toUpperCase()}_PLAYER_CONTRIBUTION I hold up the key.` : `I look at step ${index}.`);
    }
    for (const scenario of cases) {
        const place = `CAST_SCENE_${scenario.id.toUpperCase()}`;
        await page.evaluate(async ({ cast, place }) => {
            const host = SillyTavern.getContext();
            const index = host.chat.slice(0, -1).findLastIndex(message => !message.is_user && !message.is_system);
            const reply = host.chat[index], record = reply?.extra?.roleplay_instructions;
            if (!record) throw new Error('The fixture has no accepted prior reply.');
            record.scene = { ...record.scene, present: `${host.name1}, ${cast}`, where: place };
            const selected = reply.swipe_info?.[reply.swipe_id];
            if (selected) (selected.extra ||= {}).roleplay_instructions = structuredClone(record);
            await host.saveChat();
        }, { cast: scenario.cast, place });
        h.resetLog();
        h.mode({ reply: scenario.reply });
        await page.getByRole('button', { name: 'Quick actions', exact: true }).tap();
        const sheet = page.locator('.ri-quick-sheet');
        await sheet.getByRole('button', { name: 'Generate an alternate reply', exact: true }).tap();
        const exactDirection = `${scenario.direction} CAST_CURRENT_${scenario.id.toUpperCase()}`;
        await sheet.getByRole('textbox', { name: 'Your direction', exact: true }).fill(exactDirection);
        assert.equal(h.requests().length, 0);
        assert.equal(await sheet.getByRole('combobox', { name: /speaker/i }).count(), 0);
        await sheet.getByRole('button', { name: 'Generate alternate reply', exact: true }).tap();
        await sheet.getByText('Reply updated.', { exact: true }).waitFor({ timeout: 20000 });
        const request = h.requests()[0];
        assert.equal(h.requests().length, 1);
        const sent = h.text(request);
        assert(sent.includes(`${type.toUpperCase()}_PLAYER_CONTRIBUTION`));
        assert(sent.includes(place), place);
        assert(sent.includes(scenario.cast), scenario.cast);
        assert.equal(sent.split(exactDirection).length - 1, 1);
        for (const prior of history.slice(0, 5)) assert(sent.includes(prior), prior);
        assert.equal(await page.evaluate(() => SillyTavern.getContext().chat.at(-1).mes), scenario.reply);
        if (process.env.RI_GUIDED_CAPTURE) fs.appendFileSync(process.env.RI_GUIDED_CAPTURE,
            JSON.stringify({ id: `GA22-${type}-${scenario.id}`, preset, place, scenario, request }) + '\n');
        await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
    }
}

async function verifyGroupDraftOwnership(page, fixture, preset) {
    const composer = page.locator('#send_textarea');
    const draft = 'I keep the brass key in my pocket.';
    const selection = { start: 2, end: 20, direction: 'backward' };
    const composerState = () => composer.evaluate(input => ({
        value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
    }));
    await composer.fill(draft);
    await composer.evaluate((input, { start, end, direction }) => {
        input.setSelectionRange(start, end, direction);
        input.dispatchEvent(new Event('select', { bubbles: true }));
    }, selection);
    const switchTo = chat => page.evaluate(async ({ group, chat }) => {
        const { openGroupChat } = await import('/scripts/group-chats.js');
        const host = SillyTavern.getContext();
        await openGroupChat(group, chat);
        if (host.chat !== SillyTavern.getContext().chat || SillyTavern.getContext().getCurrentChatId() !== chat) {
            throw new Error('Expected the host to reuse the array for the requested group chat.');
        }
    }, { group: fixture.group, chat });

    h.resetLog();
    h.mode({ reply: 'The bell keeper closes the iron door.', delayMs: 4500 });
    await page.getByRole('button', { name: 'Quick actions', exact: true }).tap();
    const sheet = page.locator('.ri-quick-sheet');
    await sheet.getByRole('button', { name: 'Continue this reply', exact: true }).tap();
    await sheet.getByRole('button', { name: 'Continue this reply', exact: true }).tap();
    for (let attempt = 0; !h.requests().length && attempt < 100; attempt++) await delay(50);
    assert.equal(h.requests().length, 1);
    assert.equal(await composer.inputValue(), '');
    await switchTo(fixture.other);
    await page.waitForFunction(async base => !(await import(`${base}/src/st.js`)).isGenerating(), h.BASE);
    const destination = await composerState();
    assert.equal(destination.value, '');
    await switchTo(fixture.chat);
    const origin = await composerState();
    assert.deepEqual(origin, { value: draft, ...selection });
    const request = h.requests()[0];
    assert.equal(h.requests().length, 1);
    assert(!h.text(request).includes(draft));
    if (process.env.RI_GUIDED_CAPTURE) fs.appendFileSync(process.env.RI_GUIDED_CAPTURE,
        JSON.stringify({ id: 'GO47-group-draft-hold', preset, origin, destination, reusedArray: true, request }) + '\n');
}

(async () => {
    h.sync();
    h.mode({});
    const { browser, page, errors } = await h.open({ width: 390, height: 720, hasTouch: true, isMobile: true });
    let fixture;
    try {
        await h.openChat(page);
        const preset = process.env.RI_GUIDED_PRESET || 'Default';
        await h.setupApi(page, { preset, legacyAutomation: false });
        await verifyCastMatrix(page, 'solo', preset);
        fixture = await page.evaluate(async () => {
            const { duplicateCharacter } = await import('/script.js');
            const { group_activation_strategy, group_generation_mode, openGroupById } = await import('/scripts/group-chats.js');
            const host = SillyTavern.getContext();
            const original = host.characters[0].avatar;
            const copy = await duplicateCharacter({ avatar: original, silent: true });
            const chat = `RI-guided-fixture-${Date.now()}`;
            const other = `${chat}-other`;
            const response = await fetch('/api/groups/create', { method: 'POST', headers: host.getRequestHeaders(), body: JSON.stringify({
                name: 'RI guided group fixture', members: [original, copy], allow_self_responses: false,
                activation_strategy: group_activation_strategy.NATURAL, generation_mode: group_generation_mode.SWAP,
                chat_id: chat, chats: [chat, other],
            }) });
            if (!response.ok) throw new Error('Unable to create the group fixture.');
            const group = await response.json();
            await host.getCharacters();
            return { group: group.id, chat, other, copy, opened: await openGroupById(group.id) };
        });
        assert(fixture.opened);
        await page.waitForFunction(() => SillyTavern.getContext().groupId && SillyTavern.getContext().onlineStatus !== 'no_connection');
        await verifyCastMatrix(page, 'group', preset);
        await verifyGroupDraftOwnership(page, fixture, preset);
        assert.deepEqual(errors, []);
        console.log(`PASS GA22 ${preset} · solo and group cases for one respondent, ensemble, plausible arrival and named direction · one native request each`);
        console.log(`PASS GO47 ${preset} · original group composer and selection restored after a native continuation switches group chat`);
    } finally {
        if (fixture) await page.evaluate(async ({ group, copy }) => {
            const headers = SillyTavern.getContext().getRequestHeaders();
            await fetch('/api/groups/delete', { method: 'POST', headers, body: JSON.stringify({ id: group }) });
            if (copy) await fetch('/api/characters/delete', { method: 'POST', headers, body: JSON.stringify({ avatar_url: copy, delete_chats: true }) });
        }, fixture).catch(() => {});
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
