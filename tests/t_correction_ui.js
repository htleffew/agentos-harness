const assert = require('node:assert/strict');
const L = require('./lib.js');
const block = (prose, changes) => prose+'\n<story_update v="2">'+JSON.stringify({v:2,changes})+'</story_update>';

(async()=>{
    L.sync();
    const {browser,page} = await L.open({width:390,height:820});
    try {
        await L.setupApi(page);
        await L.setSettings(page,{world:{head:0},check:{mode:'off'}});
        await L.openChat(page);
        await page.evaluate(async base=>{
            const V = await import(base+'/src/v10.js');
            V.prefs().enabled=true;
            await SillyTavern.getContext().saveMetadata();
        },L.BASE);
        const wrong='The bridge is made of oak.';
        const stone='The bridge is made of stone.';
        L.mode({reply:block(wrong+' The mill bell broke.',[
            {id:'bridge',kind:'fact',subject:'Mira',text:wrong,evidence:wrong},
            {id:'bell-broke',kind:'fact',subject:'Mira',text:'The mill bell broke.',evidence:'The mill bell broke.'},
        ])});
        await L.send(page,'Mira and I look at the bridge.');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1).extra?.roleplay_instructions?.update?.changes?.length===2);
        const opener = page.locator('#chat .last_mes .ri-guided-correction');
        await opener.locator(':scope > summary').click();
        const truth = opener.getByLabel('Correct story fact',{exact:true});
        await truth.fill(stone);
        assert.equal(await opener.getByLabel('Regenerate the latest reply').isChecked(),true);
        await opener.getByText('Find and edit source records',{exact:true}).click();
        const wording=opener.getByLabel('Wrong wording (optional)');
        await wording.fill('Mira is engaged to Rory.');
        await opener.getByRole('button',{name:'Find source matches',exact:true}).click();
        await opener.getByRole('status').filter({hasText:'No source text matched.'}).waitFor();
        assert.equal(await opener.locator('.ri-correction-source').count(),0);
        await wording.fill(wrong);
        await opener.getByRole('button',{name:'Find source matches',exact:true}).click();
        await opener.getByRole('status').filter({hasText:'2 source matches.'}).waitFor();
        assert.equal(await opener.locator('.ri-correction-source').count(),2);
        assert.ok((await opener.locator('.ri-correction-excerpt').allTextContents()).every(value=>value.includes(wrong)));
        const record=opener.locator('.ri-correction-source').filter({hasText:/bridge \/ Text/});
        await record.locator(':scope > summary').click();
        assert.equal(await record.getByLabel('Exact source quotation').isVisible(),false);
        await record.getByText('Edit this source',{exact:true}).click();
        assert.equal(await record.getByLabel('Exact source quotation').inputValue(),wrong);
        await record.getByRole('checkbox',{name:/Apply edit/}).check();
        const save=opener.getByRole('button',{name:'Save correction and regenerate',exact:true});
        assert.equal(await save.isDisabled(),true);
        await record.getByRole('button',{name:'Use my correction text',exact:true}).click();
        assert.equal(await save.isEnabled(),true);
        assert.ok(await opener.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
        L.resetLog();
        L.mode({reply:block(stone+' Mira leaned on the parapet.',[
            {id:'parapet',kind:'fact',subject:'Mira',text:'Mira leaned on the parapet.',evidence:'Mira leaned on the parapet.'},
        ])});
        await save.click();
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1).extra?.roleplay_instructions?.guided?.correctionId);
        const state = () => page.evaluate(async base=>{
            const W=await import(base+'/src/world.js');
            const c=SillyTavern.getContext(), m=c.chat.at(-1), world=W.chatWorld();
            return {swipe:m.swipe_id,swipes:m.swipes,mes:m.mes,rows:W.listWorld(await W.loadWorld(world),world),
                corrections:c.chatMetadata.roleplay_instructions.storyCorrections};
        },L.BASE);
        await page.waitForFunction(()=>!!SillyTavern.getContext().chat.at(-1).extra?.roleplay_instructions?.update?.changes?.length);
        const regenerated=await state();
        assert.equal(regenerated.swipes.length,2);
        assert.match(regenerated.swipes[0],/made of oak/);
        assert.match(regenerated.swipes[1],/made of stone/);
        assert.ok(regenerated.rows.some(row=>row.name==='bridge' && JSON.parse(row.fields.data).text===stone));
        assert.ok(regenerated.rows.every(row=>row.name!=='bell-broke'));
        assert.equal(L.requests().length,1);
        const prompt=L.text(L.requests()[0]);
        assert.match(prompt,/accepted correction.*same point in the story/s);
        assert.match(prompt,/made of stone/);
        assert.doesNotMatch(prompt,/made of oak|mill bell broke/);
        await page.setViewportSize({width:320,height:720});
        const guide=page.locator('#chat .last_mes .ri-guided-swipe');
        await guide.locator(':scope > summary').click();
        assert.ok(await guide.evaluate(node=>node.scrollWidth<=node.clientWidth+1 &&
            [...node.querySelectorAll('textarea, select')].every(control=>control.getBoundingClientRect().right<=node.getBoundingClientRect().right)));
        await guide.locator(':scope > summary').click();
        await page.setViewportSize({width:390,height:820});
        // Select the original with the real host swipe control, then use the extension menu on mobile.
        await L.idle(page);
        await page.locator('#chat .last_mes .swipe_left').click();
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1).swipe_id===0);
        await page.locator('#extensions-settings-button > .drawer-toggle').click();
        await page.locator('#ri_drawer .inline-drawer-header').click();
        const root=page.locator('#ri_root');
        await root.getByRole('button',{name:'Expand',exact:true}).click();
        await root.getByRole('button',{name:'Story',exact:true}).click();
        await root.getByRole('button',{name:'Corrections',exact:true}).click();
        const editor=root.locator('#ri_panel_page');
        await editor.getByLabel('Correct story fact',{exact:true}).fill('The parapet is waist high.');
        await page.route('**/api/backends/chat-completions/generate',route=>route.abort(),{times:1});
        await editor.getByRole('button',{name:'Save correction and regenerate',exact:true}).click();
        await editor.getByRole('button',{name:'Retry guided regeneration',exact:true}).waitFor({timeout:30000});
        const failed=await state();
        assert.equal(failed.swipe,0);
        assert.equal(failed.swipes.length,2);
        assert.equal(failed.corrections.length,2);
        L.mode({reply:'Mira rests her hands on the waist-high parapet.'});
        await editor.getByRole('button',{name:'Retry guided regeneration',exact:true}).click();
        await editor.getByRole('status').filter({hasText:'The revised reply is ready.'}).waitFor();
        const retried=await state();
        assert.equal(retried.swipes.length,3);
        assert.equal(retried.swipe,2);
        assert.deepEqual(retried.swipes.slice(0,2),failed.swipes);
        assert.equal(retried.corrections.length,2);
        await editor.getByLabel('Correct story fact',{exact:true}).fill('Mira wears a green scarf.');
        await editor.getByLabel('Regenerate the latest reply').uncheck();
        L.resetLog();
        await editor.getByRole('button',{name:'Save correction',exact:true}).click();
        await editor.getByRole('status').filter({hasText:'Saved the correction.'}).waitFor();
        assert.equal(L.requests().length,0);
        const bridge = (await state()).rows.find(row=>row.name==='bridge');
        const marble='The bridge is made of marble.';
        await editor.getByLabel('Correct story fact',{exact:true}).fill(marble);
        L.mode({reply:JSON.stringify({edits:[{id:`world:${bridge.uid}:text`,quote:stone,replacement:marble}]})});
        await editor.getByRole('button',{name:'Correct sources with AI',exact:true}).click();
        await editor.getByRole('status').filter({hasText:/Saved 1 source edit/}).waitFor();
        assert.equal(JSON.parse((await state()).rows.find(row=>row.name==='bridge').fields.data).text,marble);
        assert.equal(L.requests().length,1);
        assert.equal(await editor.locator('.ri-correction-source').count(),0);
        const granite='The bridge is made of granite.';
        const modelRequests=[];
        page.on('request',request=>{
            if (request.url().endsWith('/api/backends/chat-completions/generate')) modelRequests.push(request.postData());
        });
        await page.route('**/api/backends/chat-completions/generate',route=>route.fulfill({json:{
            choices:[{message:{role:'assistant',content:JSON.stringify({edits:[
                {id:`world:${bridge.uid}:text`,quote:marble,replacement:granite},
            ]})},finish_reason:'stop'}],
        }}),{times:1});
        await editor.getByLabel('Correct story fact',{exact:true}).fill(granite);
        await editor.getByLabel('Regenerate the latest reply').check();
        L.mode({reply:granite});
        await editor.getByRole('button',{name:'Correct sources with AI',exact:true}).click();
        await editor.getByRole('status').filter({hasText:'The revised reply is ready.'}).waitFor();
        assert.equal(modelRequests.length,2);
        assert.match(modelRequests[0],/sourceExcerpts/);
        assert.match(modelRequests[1],/Regenerate this reply/);
        assert.equal(JSON.parse((await state()).rows.find(row=>row.name==='bridge').fields.data).text,granite);
        console.log('PASS phone-width correction clicks, exact and empty search, guided generation, older swipe, network failure, retry, save only and automatic AI source edits');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
