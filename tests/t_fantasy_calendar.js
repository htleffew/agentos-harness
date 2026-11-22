const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

const calendarLine = 'Use the story calendar with 30 days in each month.';
const reply = (prose, elapsed) => `${prose}\n<story_update v="2">${JSON.stringify({v:2,scene:elapsed===undefined ? {} : {elapsed}})}</story_update>`;

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:320,height:475,hasTouch:true,isMobile:true});
    const preset=process.env.RI_CALENDAR_PRESET || 'Default';
    const panel=page.locator('#ri_root');
    const composer=page.locator('#send_textarea');
    const header=page.locator('#chat .last_mes .ri-scene-header');
    const dateField=header.locator('.ri-scene-header-date dd');
    const stateCard=panel.locator('.ri-profile').filter({has:page.getByText('Scene',{exact:true})});
    const cases=[];
    const send=async(prose,text)=>{
        await composer.fill(text);
        await page.locator('#send_but').tap();
        await page.waitForFunction(answer=>SillyTavern.getContext().chat.at(-1)?.mes?.includes(answer),prose);
        await L.idle(page);
    };
    const expectDate=async(date,time)=>{
        assert.equal(await dateField.innerText(),date);
        assert.equal(await header.locator('.ri-scene-header-time dd').innerText(),time);
        assert.equal(await dateField.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true);
    };
    const openState=async()=>{
        if (!await page.locator('#ri_drawer').isVisible()) await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        if (!await panel.isVisible()) await page.locator('#ri_drawer .inline-drawer-header').tap();
        await panel.getByRole('button',{name:'Expand',exact:true}).tap();
        if (!await stateCard.evaluate(node=>node.open)) await stateCard.locator(':scope > summary').tap();
    };
    const closeState=async()=>{
        await panel.getByRole('button',{name:'Close full screen',exact:true}).tap();
        if (await page.locator('#extensions-settings-button > .drawer-content.openDrawer').count()) {
            await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        }
    };
    try {
        await L.setupApi(page,{legacyAutomation:false});
        if (preset!=='Default') await L.usePreset(page,preset);
        await L.openChat(page);
        await page.evaluate(async ({base,preset})=>{
            // Give the full companion preset, card examples, and current turn room in the same fixture.
            jQuery('#oai_max_context_unlocked').prop('checked',true).trigger('change');
            jQuery('#openai_max_context').val(16384).trigger('input');
            const {activePreset,prefs}=await import(base+'/src/v10.js');
            const {saveChatState}=await import(base+'/src/store.js');
            if (activePreset()!==preset) throw new Error(`Expected active preset ${preset}.`);
            prefs().enabled=true;
            saveChatState();
        },{base:L.BASE,preset});
        L.resetLog();
        await openState();
        await stateCard.getByRole('button',{name:'Edit scene',exact:true}).tap();
        const date=stateCard.getByRole('textbox',{name:'Date',exact:true});
        await stateCard.getByRole('textbox',{name:'Time',exact:true}).fill('11:58 PM');
        await date.fill('Frostfall 31, 310');
        await stateCard.getByRole('button',{name:'Save scene',exact:true}).tap();
        assert.match(await date.evaluate(node=>node.validationMessage),/day from 1 to 30/);
        await date.fill('Frostfall 30, 310');
        await stateCard.getByRole('button',{name:'Save scene',exact:true}).tap();
        assert.equal(L.requests().length,0);
        cases.push({action:'edit date and time',date:'Frostfall 30, 310',time:'11:58 PM',requests:0});
        await closeState();

        const first='The guard rings the midnight bell.';
        L.mode({reply:reply(first,4)});
        await send(first,'I wait for midnight.');
        await expectDate('Deepwinter 1, 311','12:02 AM');

        const second='The late watch moves to the wharf.';
        L.mode({reply:'<tracker>23:59 | Day 30 of Snowfall, Year 350 | Wharf | Snowfall</tracker>\n'+reply(second)});
        await send(second,'I turn to the last watch in Year 350.');
        await expectDate('Day 30 of Snowfall, Year 350','23:59');
        assert.equal(await header.locator('.ri-scene-header-weather dd').innerText(),'Snowfall');

        const third='The watch ends two minutes later.';
        L.mode({reply:reply(third,2)});
        await send(third,'I watch for another two minutes.');
        await expectDate('Wolfsblood 1, 350','00:01');
        await openState();
        await stateCard.getByText('Wolfsblood 1, 350',{exact:true}).waitFor();
        await closeState();

        const requests=L.requests();
        assert.equal(requests.length,3);
        const sentDates=['Frostfall 30, 310','Deepwinter 1, 311','Day 30 of Snowfall, Year 350'];
        const shownDates=['Deepwinter 1, 311','Day 30 of Snowfall, Year 350','Wolfsblood 1, 350'];
        const contributions=['I wait for midnight.','I turn to the last watch in Year 350.','I watch for another two minutes.'];
        for (const [index,request] of requests.entries()) {
            assert.ok(request.messages.some(message=>message.role==='user' && message.content===contributions[index]));
            const state=request.messages.map(message=>message.content).find(content=>String(content).includes(calendarLine));
            assert.ok(state,`Expected the calendar in request ${index+1} with ${preset}.`);
            assert.ok(state.includes(`Date: ${sentDates[index]}`));
            assert.match(state,/Winter \(Deepwinter, Snowfall, Wolfsblood\).*Autumn \(Harvest, Leafturn, Frostfall\)/);
            assert.equal(L.text(request).split(calendarLine).length-1,1);
            cases.push({action:'ordinary reply',requestDate:sentDates[index],headerDate:shownDates[index],
                calendarGuidance:state.split('\n').find(line=>line.includes(calendarLine)),requests:1});
        }
        assert.deepEqual(errors,[]);
        if (process.env.RI_CALENDAR_CAPTURE) fs.writeFileSync(process.env.RI_CALENDAR_CAPTURE,
            JSON.stringify({host:'SillyTavern 1.19.0',preset,viewport:[320,475],touch:true,contextTokens:16384,cases},null,2)+'\n');
        console.log(`PASS fantasy calendar on ${preset}. Touch scene edits, midnight and year rollover, legacy tracker and ordinary requests.`);
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
