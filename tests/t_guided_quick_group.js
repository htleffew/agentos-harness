// Verify a real host group swipe by touch without a speaker-selection request.
const assert = require('node:assert/strict');
const h = require('./lib.js');

(async () => {
    h.sync();
    h.mode({});
    const { browser, page, errors } = await h.open({ width: 390, height: 720, hasTouch: true, isMobile: true });
    let fixture;
    try {
        await h.openChat(page);
        await h.setupApi(page);
        fixture = await page.evaluate(async () => {
            const { duplicateCharacter } = await import('/script.js');
            const { group_activation_strategy, group_generation_mode, openGroupById } = await import('/scripts/group-chats.js');
            const host = SillyTavern.getContext();
            const original = host.characters[0].avatar;
            const copy = await duplicateCharacter({ avatar: original, silent: true });
            const chat = `RI-guided-fixture-${Date.now()}`;
            const response = await fetch('/api/groups/create', { method: 'POST', headers: host.getRequestHeaders(), body: JSON.stringify({
                name: 'RI guided group fixture', members: [original, copy], allow_self_responses: false,
                activation_strategy: group_activation_strategy.NATURAL, generation_mode: group_generation_mode.SWAP,
                chat_id: chat, chats: [chat],
            }) });
            if (!response.ok) throw new Error('Unable to create the group fixture.');
            const group = await response.json();
            await host.getCharacters();
            return { group: group.id, copy, opened: await openGroupById(group.id) };
        });
        assert(fixture.opened);
        await page.waitForFunction(() => SillyTavern.getContext().groupId && SillyTavern.getContext().onlineStatus !== 'no_connection');
        h.mode({ reply: 'The watch officer looks down at the key.' });
        await h.send(page, 'GROUP_PLAYER_CONTRIBUTION I hold up the key.');
        h.resetLog();
        h.mode({ reply: 'The bell keeper offers to answer.' });
        await page.getByRole('button', { name: 'Quick actions', exact: true }).tap();
        const sheet = page.getByRole('dialog');
        await sheet.getByRole('button', { name: 'Guide a swipe', exact: true }).tap();
        await sheet.getByRole('textbox', { name: 'Your direction', exact: true }).fill('GROUP_ONCE Let the bell keeper answer.');
        await sheet.getByRole('button', { name: 'Generate swipe', exact: true }).tap();
        await page.waitForFunction(() => SillyTavern.getContext().chat.at(-1).mes === 'The bell keeper offers to answer.');
        assert.equal(h.requests().length, 1);
        const sent = h.text(h.requests()[0]);
        assert(sent.includes('GROUP_PLAYER_CONTRIBUTION'));
        assert.equal(sent.split('GROUP_ONCE').length - 1, 1);
        assert.deepEqual(errors, []);
        console.log('capture C8 · group chat · Quick actions → Guide a swipe → direction → Generate swipe · one request with current player text and the chosen direction');
    } finally {
        if (fixture) await page.evaluate(async ({ group, copy }) => {
            const headers = SillyTavern.getContext().getRequestHeaders();
            await fetch('/api/groups/delete', { method: 'POST', headers, body: JSON.stringify({ id: group }) });
            if (copy) await fetch('/api/characters/delete', { method: 'POST', headers, body: JSON.stringify({ avatar_url: copy, delete_chats: true }) });
        }, fixture).catch(() => {});
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
