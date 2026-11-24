const assert = require('node:assert/strict');
const { basename } = require('node:path');
const { readFileSync } = require('node:fs');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page } = await L.open({ width: 430, height: 820 });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root = page.locator('#ri_root');
        await L.openPanel(page);
        const names = await page.evaluate(async base => {
            const V = await import(`${base}/src/v10.js`);
            const B = await import(`${base}/src/books.js`);
            const { app } = await import(`${base}/src/ui/panel.js`);
            V.prefs().enabled = true;
            const tag = Date.now();
            const add = (name, entries, role) => {
                const data = { entries: Object.fromEntries(entries.map((entry, uid) => [uid, {
                    ...B.blankEntry(uid), ...entry, useProbability: false, position: 0,
                }])) };
                return V.uploadReusableBook(new File([JSON.stringify(data)], `${name} ${tag}.json`), role);
            };
            const user = await add('User nudge', [
                { comment: 'User entry', content: 'USER_NUDGE_MARK', constant: false, key: ['Playerkey'] },
                { comment: 'Sticky nudge', content: 'STICKY_NUDGE_MARK', constant: false, key: ['Playerkey'],
                    sticky: 5, extensions: { riTriggerSource: 'user' } },
                { comment: 'Random reminder', content: 'RANDOM_ZERO_MARK', constant: true },
            ], 'guidelines');
            const assistant = await add('Model nudge', [
                { comment: 'Model entry', content: 'MODEL_NUDGE_MARK', constant: false, key: ['Modelkey'],
                    extensions: { riTriggerSource: 'assistant' } },
            ], 'guidelines');
            const locations = await add('Places', [{ content: 'DOCK_LORE_MARK', constant: false, key: ['Dockside'] }], 'reference');
            const people = await add('People', [{ content: 'PERSON_LORE_MARK', constant: false, key: ['Dockside'] }], 'reference');
            app.openPage('books');
            return { user, assistant, locations, people };
        }, L.BASE);

        const sampleFiles = JSON.parse(process.env.RI_SAMPLE_BOOKS || '[]');
        if (sampleFiles.length) {
            await root.getByLabel('Reusable book JSON files').setInputFiles(sampleFiles);
            await root.getByRole('button', { name: 'Upload and assign books' }).click();
            await page.waitForFunction(async base => {
                const { reusableAssignments } = await import(`${base}/src/v10.js`);
                return reusableAssignments().length === 6;
            }, L.BASE);
            for (const file of sampleFiles) {
                const row = root.locator(`[data-book-name^="${basename(file, '.json')}"]`);
                await row.waitFor();
                const name = await row.getAttribute('data-book-name');
                const entries = await page.evaluate(async ([base, name]) => {
                    const { loadBook } = await import(`${base}/src/st.js`);
                    return (await loadBook(name)).entries;
                }, [L.BASE, name]);
                assert.deepEqual(entries, JSON.parse(readFileSync(file, 'utf8')).entries);
                const card = root.locator('.ri-card').filter({ has: page.getByText(name, { exact: true }) })
                    .filter({ has: page.getByRole('button', { name: 'Pause in this chat', exact: true }) });
                await card.getByRole('button', { name: 'Pause in this chat', exact: true }).click();
            }
        }

        const row = root.locator('[data-book-name]').filter({ has: page.getByText(names.user, { exact: true }) });
        assert.ok(await row.evaluate(card => card.classList.contains('ri-assigned-book')));
        await row.getByRole('button', { name:'Pause in this chat' }).waitFor();
        await row.getByText('Edit or delete entries', { exact: true }).click();
        const userEntry = row.locator('.ri-book-entry').filter({ hasText:'User entry' });
        await userEntry.getByText('View full entry', { exact:true }).click();
        assert.equal(await userEntry.locator('pre').innerText(), 'USER_NUDGE_MARK');
        assert.match(await userEntry.innerText(), /Keyword triggered.*Sticky 0.*Cooldown 0 messages/s);
        await userEntry.getByText('Chat-specific conditions', { exact:true }).click();
        await userEntry.getByText('Use this entry in this chat', { exact:true }).waitFor();
        const edit = comment => row.locator('li').filter({ hasText: comment }).getByRole('button', { name: 'Edit', exact: true });
        await edit('User entry').click();
        await row.getByLabel('Keyword source', { exact: true }).selectOption('user');
        await row.getByRole('button', { name: 'Save entry' }).click();
        await row.locator('li').filter({ hasText: 'User entry' }).getByText(/Latest user message · 100% chance/).waitFor();
        await edit('Random reminder').click();
        await row.getByLabel('Chance (%)', { exact: true }).fill('0');
        await row.getByRole('button', { name: 'Save entry' }).click();
        await row.getByText(/Always eligible · 0% chance/).waitFor();

        L.mode({ reply: 'The guide mentioned Modelkey.' });
        L.resetLog();
        await L.send(page, 'Playerkey, Modelkey and Dockside.');
        let prompt = L.text(L.requests()[0]);
        assert.match(prompt, /USER_NUDGE_MARK/);
        assert.match(prompt, /STICKY_NUDGE_MARK/);
        assert.match(prompt, /DOCK_LORE_MARK/);
        assert.match(prompt, /PERSON_LORE_MARK/);
        assert.doesNotMatch(prompt, /MODEL_NUDGE_MARK|RANDOM_ZERO_MARK/);
        const receipt = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Lore);
        assert.ok(receipt.some(entry => entry.title === 'User entry' && entry.confirmed &&
            entry.timing === 'Keyword · Latest user message · 100% chance'));
        assert.ok(receipt.every(entry => entry.title !== 'Random reminder'));
        L.mode({ reply: 'The guide went on.' });
        L.resetLog();
        await L.send(page, 'Continue.');
        prompt = L.text(L.requests()[0]);
        assert.match(prompt, /MODEL_NUDGE_MARK/);
        assert.match(prompt, /STICKY_NUDGE_MARK/);
        assert.doesNotMatch(prompt, /USER_NUDGE_MARK|RANDOM_ZERO_MARK/);
        await root.getByLabel('Reusable book role').selectOption('reference');
        await root.getByText('Create an empty book', { exact: true }).click();
        const plainName = `New locations ${Date.now()}`;
        await root.getByLabel('New book name').fill(plainName);
        await root.getByRole('button', { name: 'Create and assign' }).click();
        const newRow = root.locator('[data-book-name]').filter({ has: page.getByText(plainName, { exact: true }) });
        await newRow.getByText('Edit or delete entries', { exact: true }).click();
        await newRow.getByRole('button', { name: 'Add entry' }).click();
        await newRow.getByLabel('Entry title').fill('Old bridge');
        await newRow.getByLabel('Entry content').fill('BRIDGE_REFERENCE_MARK');
        await newRow.getByLabel('Primary triggers').fill('Old bridge');
        await newRow.getByRole('button', { name: 'Save entry' }).click();
        await newRow.getByText('Old bridge', { exact: true }).waitFor();
        await page.evaluate(() => {
            globalThis.jQuery('#world_info_budget').val(100).trigger('input');
        });
        L.resetLog();
        await L.send(page, 'They cross the Old bridge.');
        assert.ok(L.text(L.requests()[0]).includes('BRIDGE_REFERENCE_MARK'));

        const bridge = newRow.locator('.ri-book-entry').filter({hasText:'Old bridge'});
        // A reply can refresh the Reusable Lorebooks page and collapse the book editor.
        const manager = newRow.locator('.ri-book-entry-editor');
        if (!await manager.evaluate(element=>element.open)) await newRow.getByText('Edit or delete entries',{exact:true}).click();
        await bridge.getByRole('button',{name:'Edit',exact:true}).click();
        await bridge.getByLabel('Activation',{exact:true}).selectOption('vector');
        await bridge.getByRole('button',{name:'Save entry'}).click();
        await bridge.getByText(/Vector matching · 100% chance/).waitFor();
        await bridge.getByRole('button',{name:'Edit',exact:true}).click();
        await bridge.getByLabel('Activation',{exact:true}).selectOption('always');
        await bridge.getByLabel('Chance (%)',{exact:true}).fill('27');
        await bridge.getByLabel('Native sticky messages',{exact:true}).fill('3');
        await bridge.getByLabel('Cooldown (host messages)',{exact:true}).fill('8');
        await bridge.getByRole('button',{name:'Save entry'}).click();
        await bridge.getByText(/Always eligible · 27% chance · Sticky 3 · Cooldown 8 messages/).waitFor();
        await bridge.getByRole('button',{name:'Edit',exact:true}).click();
        await bridge.getByLabel('Activation',{exact:true}).selectOption('off');
        await bridge.getByRole('button',{name:'Save entry'}).click();
        await bridge.getByText(/Disabled · 27% chance · Sticky 3 · Cooldown 8 messages/).waitFor();
        const dialog = page.locator('dialog[open]');
        await bridge.getByRole('button',{name:'Delete',exact:true}).click();
        await dialog.locator('.popup-button-cancel').click();
        await bridge.waitFor();
        await bridge.getByRole('button',{name:'Delete',exact:true}).click();
        await dialog.locator('.popup-button-ok').click();
        await newRow.getByText('This book has no entries.').waitFor();
        const guideline = root.locator('.ri-assigned-book').filter({has:page.getByText(names.assistant,{exact:true})});
        await guideline.getByRole('button',{name:'Copy to Random Instructions'}).click();
        await root.getByRole('button',{name:'Add instruction',exact:true}).waitFor();
        const draft = await page.evaluate(async base => {
            const { app } = await import(`${base}/src/ui/panel.js`);
            const B = await import(`${base}/src/books.js`);
            const S = await import(`${base}/src/store.js`);
            const set = app.route.name;
            await B.editSet(set, book => {
                const entry = B.newInstruction(book,set);
                Object.assign(entry,{ name:'Phrase feedback', when:'words', words:'landed like', chance:100, wait:0,
                    actor:'model', target:'unspecified', versions:[{text:'PHRASE_FEEDBACK_MARK. Use plain wording for the reaction.'}] });
                B.writeInstruction(book,entry,set);
            });
            const book = await B.loadSet(set);
            const entries = B.listInstructions(book,set);
            app.cache[set] = book;
            app.render();
            return { inactive:!S.chatState().activeSets.includes(set), copied:entries.find(entry=>entry.name==='Model entry') };
        }, L.BASE);
        assert.ok(draft.inactive);
        assert.equal(draft.copied.actor,'model');
        assert.equal(draft.copied.triggerSource,'assistant');
        assert.equal(draft.copied.words,'Modelkey');
        await root.locator('.ri-inscard').filter({hasText:'Phrase feedback'}).getByRole('button',{name:'Edit',exact:true}).click();
        await root.getByLabel('Where to look',{exact:true}).selectOption('assistant');
        await root.getByRole('button',{name:'Save instruction',exact:true}).click();
        await root.getByRole('button',{name:'Add instruction',exact:true}).waitFor();
        await root.getByRole('switch',{name:/on or off for this chat/}).click();

        L.mode({reply:'It landed like a stone.'});
        L.resetLog();
        await L.send(page,'I used the words landed like.');
        assert.equal(L.requests().length,1);
        assert.doesNotMatch(L.text(L.requests()[0]),/PHRASE_FEEDBACK_MARK/);

        L.mode({reply:'She flinched.'});
        L.resetLog();
        await L.send(page,'And then?');
        assert.equal(L.requests().length,1);
        assert.match(L.text(L.requests()[0]),/PHRASE_FEEDBACK_MARK/);

        const dedicated = `Dedicated instruction book ${Date.now()}`;
        await L.makeSet(page,dedicated,[{name:'Managed-only instruction',versions:['M1'],chance:100}],{activate:false});
        const toggleDedicated = active => page.evaluate(async ([base,name,on])=>{
            const {assignReusableBook} = await import(`${base}/src/v10.js`);
            const {chatState,saveChatState} = await import(`${base}/src/store.js`);
            const context = SillyTavern.getContext();
            context.chatMetadata.world_info = name;
            assignReusableBook(name,'guidelines');
            chatState().activeSets = on ? [name] : [];
            saveChatState();
        },[L.BASE,dedicated,active]);
        await toggleDedicated(false);
        L.resetLog();
        await L.send(page,'What happens next?');
        assert.doesNotMatch(L.text(L.requests()[0]),/thing M1/);
        await toggleDedicated(true);
        L.resetLog();
        await L.send(page,'I step forward.');
        assert.equal((L.text(L.requests()[0]).match(/thing M1/g) || []).length,1);
        const managed = await page.evaluate(() => SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Lore);
        assert.ok(managed.some(entry=>entry.title==='Managed-only instruction' && entry.role==='Random Instructions' && entry.confirmed));
        console.log('PASS multiple guideline/reference imports, editable triggers and role-specific prompt delivery');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
