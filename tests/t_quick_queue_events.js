const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

const ingredient='QARESIN_LANTERN';
const privateMarker='QASYSTEM_CURRENT';
const visibleMarker='QAOOC_CURRENT';
const quote='The caretaker sets a bronze lantern on the quay.';
const allMarkers=new RegExp([ingredient,privateMarker,visibleMarker].join('|'));

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:620,hasTouch:true,isMobile:true});
    const capture=[];
    const sheet=page.locator('.ri-quick-sheet');
    const composer=page.locator('#send_textarea');
    const tap=(name,scope=sheet)=>scope.getByRole('button',{name,exact:typeof name==='string'}).first().tap();
    const open=()=>L.openQuickActions(page);
    const close=()=>tap('Close');
    const family=async label=>{await open();await tap(label);};
    const type=text=>sheet.getByRole('textbox',{name:'Your direction'}).fill(text);
    const once=(request,text)=>assert.equal(L.text(request).split(text).length-1,1,text);
    const record=(name, expected=1)=>{
        const requests=L.requests();
        assert.equal(requests.length,expected,name);
        capture.push({name,requests});
        return requests;
    };
    const send=async text=>{
        const before=await page.evaluate(()=>SillyTavern.getContext().chat.length);
        await composer.fill(text);
        await page.locator('#send_but').tap();
        await page.waitForFunction(before=>SillyTavern.getContext().chat.length>=before+2,before);
        await L.idle(page,16000);
    };
    const snapshot=()=>page.evaluate(async base=>{
        const {quickChat}=await import(base+'/src/quick-action-chat.js');
        const {burnedSoFar}=await import(base+'/src/engine.js');
        const {worldIdle,loadEffectiveWorld}=await import(base+'/src/worldflow.js');
        const {chatWorld,listWorld}=await import(base+'/src/world.js');
        await worldIdle();
        const chat=SillyTavern.getContext().chat;
        const world=chatWorld();
        const rows=world ? listWorld(await loadEffectiveWorld(world),world).map(row=>row.name) : [];
        return {queue:quickChat().pending, playerText:chat.findLast(message=>message.is_user)?.mes,
            reply:chat.at(-1)?.mes, swipes:chat.at(-1)?.swipes,
            receipt:chat.at(-1)?.extra?.roleplay_instructions?.quickActions,
            booked:[...burnedSoFar().keys],world:rows,
            preset:document.querySelector('#settings_preset_openai option:checked')?.textContent.trim()};
    },L.BASE);
    const queue=async (text,visibility)=>{
        await family('Steer the next reply');
        await type(text);
        await sheet.getByLabel('Delivery',{exact:true}).selectOption(visibility);
        await tap('Queue with my next message');
        await close();
    };
    let set;
    const nudge='Quay positioning '+Date.now();
    const queueEvent=async ()=>{
        await family('Steer the next reply');
        await tap('Browse directions');
        await sheet.getByRole('searchbox',{name:'Search quick actions'}).fill(set);
        await tap(/^Story event: Lantern arrives$/);
        await tap('Select direction');
        await sheet.getByLabel('Delivery',{exact:true}).selectOption('default');
        await tap('Queue with my next message');
        await close();
    };
    const swipe=async text=>{
        await page.locator('#chat .last_mes').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
        await type(text);
        await tap('Generate alternate reply');
        await sheet.getByText('Reply updated.',{exact:true}).waitFor();
    };
    try {
        page.setDefaultTimeout(18000);
        await L.setupApi(page,{legacyAutomation:false});
        if (process.env.RI_QUEUE_PRESET) {
            await L.usePreset(page,process.env.RI_QUEUE_PRESET);
            await page.evaluate(()=>jQuery('#openai_max_context').val(16384).trigger('input'));
        }
        await page.evaluate(async base=>{
            const {restoreQuickAction}=await import(base+'/src/quick-actions.js');
            for (const id of ['emotional','conflict']) restoreQuickAction(`builtin:swipe:${id}`);
        },L.BASE);
        await L.setSettings(page,{world:{editableReplies:5,update:'all',head:0,build:0},scene:{track:true},summary:{on:false}});
        await L.openChat(page);
        const disabled=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.disabledExtensions);
        assert(disabled.includes('quick-reply') && disabled.includes('memory'));
        set=await page.evaluate(async ({base,ingredient})=>{
            const {newEvent,newCategory,writeEvent}=await import(base+'/src/events.js');
            const {createSet}=await import(base+'/src/books.js');
            const {setChatWorld,newWorldEntry,writeWorldEntry}=await import(base+'/src/world.js');
            const data={entries:{}};
            const event=newEvent('Lantern arrives');
            event.categories=[newCategory('Arrival',[ingredient])];
            writeEvent(data,event);
            const name=await createSet('Lantern test '+Date.now(),'events',data,'');
            const world={entries:{}};
            const gate=newWorldEntry(world,'place');
            gate.name='Quay Gate';
            gate.fields.what='The quay gate is open.';
            writeWorldEntry(world,gate);
            setChatWorld(await createSet('Queue world '+Date.now(),'world',world,''));
            return name;
        },{base:L.BASE,ingredient});

        L.mode({reply:'The caretaker checks the empty quay.'});
        await send('I stop by the quay.');
        L.resetLog();
        await family('Steer the next reply');
        await tap('Create saved nudge');
        await sheet.getByLabel('Button name',{exact:true}).fill(nudge);
        await sheet.getByLabel('Direction',{exact:true}).fill(privateMarker+' Ask her to check the quay.');
        await tap('Save button');
        const option=sheet.locator('.ri-quick-shelf-option').filter({has:page.getByRole('button',{name:nudge,exact:true})});
        await tap('Pin',option);
        await tap('Queue '+nudge);
        await sheet.getByText('Queued with your next player message.').waitFor();
        await close();
        await queue(visibleMarker+' Let the night remain still.','visible');
        await queueEvent();
        assert.equal(L.requests().length,0);
        assert.equal((await snapshot()).queue.length,3);

        L.mode({});
        await family('Draft my reply');
        await type('I ask who works the quay.');
        await tap('Generate my draft · 1 model call');
        const ready=sheet.getByText('Draft ready to edit.',{exact:true});
        const helper=sheet.getByRole('button',{name:'Draft through direct helper · 1 model call',exact:true});
        if (await ready.or(helper).first().waitFor().then(()=>helper.isVisible())) await helper.tap();
        await ready.waitFor();
        const draft=record('A26: draft before send')[0];
        assert.doesNotMatch(L.text(draft),allMarkers);
        await close();
        assert.equal((await snapshot()).queue.length,3);
        L.resetLog();
        L.mode({reply:'The caretaker looks down at the quay.'});
        await page.locator('#chat .last_mes').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
        const pin=sheet.locator('.ri-quick-shelf-option').filter({has:page.getByRole('button',{name:'More emotional',exact:true})});
        await tap('Pin',pin);
        await tap('Swipe with More emotional');
        await sheet.getByText('Reply updated.',{exact:true}).waitFor();
        const emotion='Let the responding character show what they feel through what they say and do.';
        const conflict='Have a character pursue a goal that pushes against someone else’s immediate goal.';
        const pinned=record('A24/A26: keyboard-free pinned swipe')[0];
        once(pinned,emotion);
        assert.doesNotMatch(L.text(pinned),allMarkers);
        await close();

        L.resetLog();
        L.mode({reply:'The caretaker considers the boundary.'});
        await page.locator('#chat .last_mes').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
        await tap('Customize');
        await sheet.getByText('Available directions',{exact:true}).tap();
        await tap('Bring in conflict');
        await type('Let the scene remain quiet.');
        await tap('Browse directions');
        await tap('Back');
        assert.equal(await sheet.getByRole('textbox',{name:'Your direction'}).inputValue(),'Let the scene remain quiet.');
        await tap('Generate alternate reply');
        await sheet.getByText('Reply updated.',{exact:true}).waitFor();
        const combined=record('A24/A26: two saved cues and free text')[0];
        for (const text of [emotion,conflict,'Let the scene remain quiet.']) once(combined,text);
        assert.doesNotMatch(L.text(combined),allMarkers);
        await close();
        assert.equal((await snapshot()).queue.length,3);

        L.resetLog();
        L.mode({fail:true});
        await composer.fill('I ask what she can see.');
        await page.locator('#send_but').tap();
        await page.waitForFunction(marker=>SillyTavern.getContext().chat.at(-1)?.is_user &&
            SillyTavern.getContext().chat.at(-1)?.mes.includes(marker),visibleMarker);
        await L.idle(page,16000);
        assert.equal((await snapshot()).queue.length,3);

        L.mode({reply:'The quay remains empty.\n<direction_evidence>'+JSON.stringify({Q1:quote})+'</direction_evidence>'});
        await composer.fill('An unsent next sentence.');
        await composer.evaluate(input=>input.setSelectionRange(3,11));
        await open();
        await tap(/^Pending directions/);
        await tap('Retry reply to this message');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes==='The quay remains empty.');
        await L.idle(page,16000);
        for (const request of record('A26: failed ordinary send and explicit retry',2)) {
            for (const marker of [ingredient,privateMarker,visibleMarker]) once(request,marker);
        }
        assert.equal(await composer.inputValue(),'An unsent next sentence.');
        assert.deepEqual(await composer.evaluate(input=>[input.selectionStart,input.selectionEnd]),[3,11]);
        const missed=await snapshot();
        assert.equal(missed.queue.length,0);
        assert.equal(missed.playerText.split(visibleMarker).length-1,1);
        assert.doesNotMatch(missed.playerText,/QASYSTEM_CURRENT|QARESIN_LANTERN/);
        assert.equal(missed.receipt.attempts,2);
        assert.equal(missed.receipt.directions.find(cue=>cue.required).verification,'unverified');
        assert.equal(missed.booked.some(key=>key.startsWith(set+'.')),false);
        assert(missed.world.every(name=>!/lantern/i.test(name)));
        capture.at(-1).state=missed;
        await close();

        await queueEvent();
        L.resetLog();
        const legacyUpdate='place: Bronze lantern | The caretaker sets a bronze lantern on the quay.';
        const structured={v:2,changes:[{kind:'fact',id:'bronze-lantern-location',text:quote,evidence:quote}]};
        const update=process.env.RI_QUEUE_PRESET==='Roleplay Instructions V10'
            ? '<story_update v="2">'+JSON.stringify(structured)+'</story_update>'
            : '<story_update>\n'+legacyUpdate+'\n</story_update>';
        L.mode({reply:quote+'\n<direction_evidence>'+JSON.stringify({Q1:quote})+'</direction_evidence>\n'+update});
        await send('I stay by the quay.');
        once(record('A9: accepted event')[0],ingredient);
        const accepted=await snapshot();
        assert.equal(accepted.reply,quote);
        assert.equal(accepted.receipt.directions.find(cue=>cue.required).verification,'evidenced');
        assert.equal(accepted.receipt.directions.find(cue=>cue.required).evidence,quote);
        assert.equal(accepted.booked.some(key=>key.startsWith(set+'.')),true);
        assert(accepted.world.some(name=>/lantern/i.test(name)),JSON.stringify(accepted.world));
        capture.at(-1).state=accepted;
        const reply=page.locator('#chat .last_mes');
        await reply.getByText('Directions sent with this reply',{exact:true}).tap();
        await reply.getByText('Evidence found in this reply',{exact:false}).waitFor();

        L.resetLog();
        L.mode({reply:'The caretaker walks back to the empty pier.'});
        await swipe('The lantern delivery never occurs.');
        const replacement=record('A9: replacement removes event')[0];
        assert.doesNotMatch(L.text(replacement),allMarkers);
        const revised=await snapshot();
        assert(revised.world.every(name=>!/lantern/i.test(name)));
        assert.equal(revised.booked.some(key=>key.startsWith(set+'.')),false);
        assert.equal(revised.swipes[0],quote);
        capture.at(-1).state=revised;
        await sheet.getByLabel('Selected version',{exact:true}).selectOption('0');
        const restored=await snapshot();
        assert(restored.world.some(name=>/lantern/i.test(name)));
        assert.equal(restored.receipt.directions.find(cue=>cue.required).verification,'evidenced');
        assert.equal(L.requests().length,1);
        capture.push({name:'A9: reselect accepted swipe',state:restored,additionalRequests:0});
        await close();

        L.resetLog();
        const corrections=page.locator('#chat .last_mes .ri-guided-correction');
        await corrections.locator(':scope > summary').tap();
        await corrections.getByLabel('Correct story fact',{exact:true}).fill('The quay gate is closed.');
        await corrections.getByRole('button',{name:'Repair facts only',exact:true}).tap();
        await corrections.getByRole('status').filter({hasText:/repaired 1/i}).waitFor();
        const corrected=await page.evaluate(async base=>{
            const {loadEffectiveWorld,worldIdle}=await import(base+'/src/worldflow.js');
            const {chatWorld,listWorld}=await import(base+'/src/world.js');
            await worldIdle();
            const id=chatWorld();
            return listWorld(await loadEffectiveWorld(id),id).find(row=>row.name==='Quay Gate')?.fields.what;
        },L.BASE);
        assert.equal(corrected,'The quay gate is closed.');
        await open();
        await tap('Context & Memory');
        await page.locator('#ri_root').getByText('Context & Memory',{exact:true}).first().waitFor();
        assert.equal(L.requests().length,0);
        capture.push({name:'A15: repair and inspect memory from the same chat',corrected,additionalRequests:0,preset:(await snapshot()).preset});
        await page.locator('#ri_root').getByRole('button',{name:'Close full screen',exact:true}).tap();
        await close();

        await page.evaluate(port=>{
            const $=globalThis.jQuery;
            $('#main_api').val('textgenerationwebui').trigger('change');
            $('#textgen_type').val('ooba').trigger('change');
            $('#textgenerationwebui_api_url_text').val(`http://127.0.0.1:${port}`).trigger('input');
            $('#streaming_textgenerationwebui').prop('checked',false).trigger('input');
            $('#api_button_textgenerationwebui').trigger('click');
        },Number(process.env.RI_MOCK_PORT || 8124));
        await page.waitForFunction(()=>SillyTavern.getContext().mainApi==='textgenerationwebui' &&
            SillyTavern.getContext().onlineStatus!=='no_connection');
        await queue('QATEXT_PRIVATE Put the lamp down.','private');
        await queue('QATEXT_VISIBLE Keep the air still.','visible');
        L.resetLog();
        L.mode({reply:'The caretaker sits on the quay.'});
        await send('I check the gate in the mist.');
        const text=record('A1: ordinary Text Completion sends both queued destinations')[0];
        once(text,'QATEXT_PRIVATE');
        once(text,'QATEXT_VISIBLE');
        assert.doesNotMatch(L.text(text),allMarkers);
        const textState=await snapshot();
        assert.equal(textState.receipt.observedRoute,'Text Completion');
        assert.equal(textState.queue.length,0);
        capture.at(-1).state=textState;
        L.resetLog();
        await send('I look over the water.');
        assert.doesNotMatch(L.text(record('A1: subsequent Text Completion lacks spent directions')[0]),/QATEXT_PRIVATE|QATEXT_VISIBLE/);
        console.log('PASS queued event proof, swipe rollback, retry and Text Completion delivery');
    } catch(error) {
        await page.screenshot({path:'/tmp/ri-quick-queue-failure.png'}).catch(()=>{});
        throw error;
    } finally {
        L.mode({});
        if (process.env.RI_QUEUE_CAPTURE) fs.writeFileSync(process.env.RI_QUEUE_CAPTURE,JSON.stringify({
            host:'SillyTavern 1.19.0',viewport:[390,620],touch:true,preset:process.env.RI_QUEUE_PRESET || 'Default',
            capture,errors,
        },null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
