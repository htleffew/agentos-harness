const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open({ width: 390, height: 830 });
    try {
        await L.setupApi(page);
        await L.setSettings(page,{check:{mode:'off'},world:{head:0},scene:{card:'always'},showUnder:'off'});
        await L.openChat(page);
        await page.evaluate(async base => {
            const V = await import(`${base}/src/v10.js`);
            Object.assign(V.prefs(),{enabled:true,modules:{roast:true}});
            await SillyTavern.getContext().saveMetadata();
        }, L.BASE);
        const reply = (prose, data) => prose+'\n<story_update v="2">'+JSON.stringify({v:2,...data})+'</story_update>';
        const establish = 'Mira tells Rowan that the tide gate is open. She trusts him to watch it.';
        L.mode({reply:reply(establish,{
            scene:{where:'Tide gate',present:'Mira, Rowan',time:'7:00 PM'},
            characters:[{name:'Mira',mind:'Watch the tide',heart:'Hopeful',evidence:'Mira tells Rowan that the tide gate is open.'}],
            changes:[
                {kind:'profile',id:'mira',subject:'Mira',text:'Practical lockkeeper',voice:'Short, direct commands',evidence:establish},
                {kind:'emotion',id:'mira-rowan-emotion',subject:'Mira',target:'Rowan',text:'Warm and wary',
                    axes:{tenderness:7,fury:0},counterweight:'Wary of the tide',outward:'Keeps checking the gate',evidence:establish},
                {kind:'relationship',id:'mira-rowan',subject:'Mira',other:'Rowan',text:'Trusts Rowan to watch the gate',
                    perspective:'Mira relies on his watch',evidence:establish},
                {kind:'knowledge',id:'mira-gate',subject:'Mira',text:'The tide gate is open',basis:'observed',evidence:establish},
                {kind:'fact',id:'gate-open',text:'The tide gate is open',evidence:establish},
                {kind:'agenda',id:'rowan-watch',subject:'Rowan',text:'Watch the tide gate',whereabouts:'At the tide gate',evidence:establish},
            ],roast:'Two guards and one mood.'
        })});
        L.resetLog();
        await L.send(page,'We watch the gate.');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.extra?.roleplay_instructions?.v10Changes?.length===6);
        const previousId = await page.evaluate(()=>SillyTavern.getContext().chat.length-1);
        const previous = page.locator(`#chat .mes[mesid="${previousId}"]`);
        const arrive = 'Mira learns the blue ferry is here and lets herself relax.';
        L.mode({reply:reply(arrive,{changes:[
            {kind:'emotion',id:'mira-rowan-emotion',subject:'Mira',target:'Rowan',text:'At ease',axes:{tenderness:4},evidence:arrive},
            {kind:'fact',id:'blue-ferry',text:'The blue ferry is here',evidence:arrive},
        ],roast:'The ferry finally clocks in.'})});
        await L.send(page,'Do we see the ferry yet?');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.extra?.roleplay_instructions?.v10Changes?.length===2);
        const latest = page.locator('#chat .last_mes');
        const consoleCard = message => message.locator('.ri-v10-console');
        assert.equal(await consoleCard(latest).evaluate(node=>node.open),false);
        assert.equal(await latest.locator('.ri-reply-roast').evaluate(node=>node.open),false);
        assert.match(await latest.locator('.ri-reply-roast').textContent(),/ferry finally/);
        assert.equal(L.requests().length,2);
        await page.evaluate(async base=>{
            const {saveV10Record} = await import(`${base}/src/worldflow.js`);
            const {refreshUnderReplies} = await import(`${base}/src/ui/sent.js`);
            await saveV10Record({kind:'fact',id:'manual-latest',text:'A late note about the bell.'});
            refreshUnderReplies();
        }, L.BASE);
        await consoleCard(latest).locator('summary').first().click();
        const openTab = async (message, name) => {
            const card = consoleCard(message);
            await card.getByRole('tab',{name,exact:true}).click();
            const panel = card.getByRole('tabpanel',{name,exact:true});
            await panel.locator('.ri-world-records').waitFor();
            return panel;
        };
        const currentEmotion = await openTab(latest,'Emotions');
        assert.match(await currentEmotion.innerText(),/Mira → Rowan.*At ease/s);
        assert.equal(await currentEmotion.getByLabel('Tenderness',{exact:true}).evaluate(node=>node.value),4);
        assert.equal(await currentEmotion.getByLabel('Fury',{exact:true}).evaluate(node=>node.value),0);
        assert.match(await (await openTab(latest,'Portrayal')).innerText(),/Short, direct commands/);
        assert.match(await (await openTab(latest,'Relationships')).innerText(),/Mira relies on his watch/);
        assert.match(await (await openTab(latest,'Knowledge')).innerText(),/observed.*Private to character.*tide gate is open/s);
        assert.match(await (await openTab(latest,'Plot')).innerText(),/Off-screen agenda.*Watch the tide gate/s);
        const currentFacts = await (await openTab(latest,'Facts')).innerText();
        assert.match(currentFacts,/blue ferry is here/);
        assert.match(currentFacts,/late note about the bell/);
        assert.ok(await consoleCard(latest).evaluate(node=>node.scrollWidth<=node.clientWidth+1));
        await page.evaluate(async ([base,id])=>{
            SillyTavern.getContext().chat[id].is_system = true;
            (await import(`${base}/src/ui/sent.js`)).refreshUnderReplies();
        }, [L.BASE,previousId]);
        await consoleCard(previous).locator('summary').first().click();
        const oldEmotion = await openTab(previous,'Emotions');
        assert.match(await oldEmotion.innerText(),/Warm and wary/);
        assert.equal(await oldEmotion.getByLabel('Tenderness',{exact:true}).evaluate(node=>node.value),7);
        const oldFacts = await (await openTab(previous,'Facts')).innerText();
        assert.match(oldFacts,/tide gate is open/);
        assert.doesNotMatch(oldFacts,/blue ferry|late note about the bell/);
        assert.equal(L.requests().length,2);
        assert.deepEqual(errors,[]);
        console.log('PASS saved continuity, emotion meters, older replies, manual edits, independent Roast and mobile layout without additional model calls');
    } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
