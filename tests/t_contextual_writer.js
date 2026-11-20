const assert = require('node:assert/strict');
const L = require('./lib.js');

function field(page, label) {
    return page.locator('#ri_root .ri-field').filter({ has: page.locator('.ri-label').getByText(label, { exact: true }) })
        .locator('input, textarea, select').first();
}

async function openPrompt(page, groupLabel, promptLabel) {
    const group = page.locator('#ri_root .ri-prompt-group').filter({ has: page.getByText(groupLabel, { exact: true }) });
    await group.locator(':scope > summary').click();
    const prompt = group.locator('.ri-prompt-editor').filter({ has: page.getByText(promptLabel, { exact: true }) });
    await prompt.locator('summary').first().click();
    return { group, prompt, box: prompt.getByRole('textbox', { name: promptLabel }) };
}

(async () => {
    L.sync();
    const { browser, page } = await L.open({ width: 430, height: 820 });
    try {
        await L.setupApi(page);
        await L.openChat(page, { fresh: true });
        const root = page.locator('#ri_root');
        await root.locator('button').filter({ hasText: /^Expand$/ }).evaluate(button => button.click());
        const name = await page.evaluate(async base => {
            const B = await import(`${base}/src/books.js`);
            const { app } = await import(`${base}/src/ui/panel.js`);
            const P = await import(`${base}/src/prompts.js`);
            for (const prompt of ['instructionOrder', 'modelVersionRules', 'systemVersions']) P.restorePrompt(prompt);
            const context = SillyTavern.getContext();
            context.characters[context.characterId].personality = 'Fidelity fixture: reserved under pressure.';
            const data = { entries: {} };
            const draft = B.newInstruction(data);
            Object.assign(draft, { name: 'Reanchor personality', chance: 100, wait: 0 });
            const id = await B.createSet(`Contextual writer ${Date.now()}`);
            app.tab = 'instructions';
            app.go({ view: 'edit', name: id, draft });
            return id;
        }, L.BASE);

        await field(page, 'Actor').selectOption('unspecified');
        await field(page, 'Actor').selectOption('model');
        await field(page, 'Target or subject').selectOption('unspecified');
        const framing = await openPrompt(page, 'Customize in-chat instruction wording', 'Instruction framing');
        await framing.box.fill('FRAMING_MARKER {instruction}');
        await framing.prompt.getByRole('button', { name: 'Save prompt' }).click();
        assert.match(await root.locator('.ri-preview').textContent(), /FRAMING_MARKER.*last five replies/);
        await framing.prompt.getByRole('button', { name: 'Restore default' }).click();
        assert.doesNotMatch(await root.locator('.ri-preview').textContent(), /FRAMING_MARKER/);

        await root.getByRole('button', { name: 'Write versions with AI' }).click();
        const seed = field(page, 'What should the model do?');
        await seed.fill("Review the last five replies for speech and behavior that depart from {{char}}'s personality ({{personality}}). Use that to avoid flattening in the next reply.");
        const writing = await openPrompt(page, 'Customize Write with AI prompts', 'Writing model-directed versions');
        const defaultRules = await writing.box.inputValue();
        const save = writing.prompt.getByRole('button', { name: 'Save prompt' });
        const restore = writing.prompt.getByRole('button', { name: 'Restore default' });
        await writing.box.fill(`${defaultRules}\n- REANCHOR_MARKER`);
        L.resetLog();
        await save.click();
        assert.match(await writing.group.locator(':scope > summary').textContent(), /Customized \(1\)/);
        await restore.click();
        assert.equal(await writing.box.inputValue(), defaultRules);
        await writing.prompt.getByRole('button', { name: 'Undo restore' }).click();
        assert.match(await writing.box.inputValue(), /REANCHOR_MARKER/);
        assert.match(await seed.inputValue(), /\{\{personality\}\}/);
        assert.equal(L.requests().length, 0);

        L.mode({ writer: JSON.stringify(["Review the last five replies against [[char]]'s personality ([[personality]]). Correct any flattening in the next reply."]) });
        await root.getByRole('button', { name: 'Write the versions' }).click();
        const add = root.getByRole('button', { name: 'Add the ticked versions' });
        await add.waitFor();
        const request = L.text(L.requests().at(-1));
        assert.match(request, /REANCHOR_MARKER/);
        assert.match(request, /the AI model composing the next reply/);
        assert.match(request, /last five replies.*\[\[char\]\].*\[\[personality\]\]/);
        assert.doesNotMatch(request, /Name a concrete action|Fidelity fixture/);
        await add.click();
        await root.getByRole('button', { name: 'Save instruction', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('#ri_root .ri-savebar'));
        const saved = await page.evaluate(async ([base, name]) => {
            const B = await import(`${base}/src/books.js`);
            const S = await import(`${base}/src/store.js`);
            const P = await import(`${base}/src/prompts.js`);
            S.chatState().activeSets = [name];
            S.saveChatState();
            P.restorePrompt('modelVersionRules');
            return B.listInstructions(await B.loadSet(name), name)[0];
        }, [L.BASE, name]);
        assert.equal(saved.actor, 'model');
        assert.equal(saved.target, 'unspecified');
        assert.match(saved.versions[0].text, /\{\{personality\}\}/);

        L.mode({ reply: 'She answered carefully.' });
        L.resetLog();
        await L.send(page, 'What happens next?');
        await L.waitChecks(page);
        const requests = L.requests();
        assert.equal(requests.length, 1);
        assert.match(L.text(requests[0]), /Review the last five replies against .* personality \(Fidelity fixture: reserved under pressure\.\)/);
        const item = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.items[0]);
        assert.equal(item.noCheck, true);
        assert.equal(item.modelDirection, true);

        for (const [tab, route, label] of [
            ['events', 'eroute', 'Complication item guidance'],
            ['style', 'sroute', 'Writing style items'],
        ]) {
            await page.evaluate(async ([base, tab, route]) => {
                const E = await import(`${base}/src/events.js`);
                const { app } = await import(`${base}/src/ui/panel.js`);
                const draft = tab === 'events' ? E.newEvent('Test event') : E.newStyle('Test style');
                const cat = E.newCategory('Complication', []);
                draft.categories = [cat];
                app.tab = tab;
                app[route] = { view: 'edit', name: 'Fixture', draft, open: { [cat.id]: true } };
                app.render();
            }, [L.BASE, tab, route]);
            const group = root.locator('.ri-prompt-contextual').filter({ has: page.getByText('Customize Write with AI prompts', { exact: true }) });
            assert.equal(await group.getByText(label, { exact: true }).count(), 1);
            await root.getByRole('button', { name: 'Write items with AI' }).click();
            assert.equal(await root.locator('.ri-sheet-box').getByText(label, { exact: true }).count(), 1);
        }
        console.log('PASS contextual writer prompts, independent restore, and model guidance on a normal reply');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
