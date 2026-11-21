const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./lib.js');

const fixtures = {
    old: 'The indigo bell rang three times.',
    current: 'I point to the brass gate.',
    private: 'State who can see the brass gate. QAPRIVATE',
    visible: 'Let the bell fall silent. QAVISIBLE',
    failure: 'Have her examine the chain. QAFAILRETRY',
    swipe: 'Let her consider how to open the gate. QASWIPE',
    continuation: 'Have her touch the gate. QACONTINUE',
};

(async () => {
    L.sync();
    const {browser,page,errors} = await L.open({width:390,height:740,hasTouch:true,isMobile:true});
    const evidence = { host:'SillyTavern 1.19.0', viewport:'390 × 740, touch emulation', provider:'Local Chat Completion mock', captures:[] };
    const sheet = page.getByRole('dialog',{name:/Quick actions|Steer the next reply|Generate an alternate reply|Continue this reply|Draft my reply|Pending directions|Add nudge|Browse directions|Manage quick actions/});
    const composer = page.locator('#send_textarea');
    const tap = (name,scope=sheet) => scope.getByRole('button',{name,exact:typeof name==='string'}).first().tap();
    const open = () => tap('Quick actions',page);
    const close = () => tap('Close');
    const family = async label => { await open(); await tap(label); };
    const direct = text => sheet.getByRole('textbox',{name:'Your direction'}).fill(text);
    const record = (label) => {
        const requests = L.requests();
        assert(requests.length, label+' produced zero requests');
        evidence.captures.push({label,requests:requests.map(request=>({
            at:request.t, stream:request.stream, roles:request.messages?.map(message=>message.role),
            markers:Object.values(fixtures).filter(value=>L.text(request).includes(value)),
        }))});
        return requests;
    };
    const quickState = () => page.evaluate(async B => (await import(B+'/src/quick-action-chat.js')).quickChat(), L.BASE);
    const captureState = async () => page.evaluate(async B=>{
        const {quickChat,freshRemaining}=await import(B+'/src/quick-action-chat.js');
        const host=SillyTavern.getContext();
        return {pending:quickChat().pending.length,freshRemaining:freshRemaining(),messages:host.chat.length,
            replied:!host.chat.at(-1)?.is_user};
    },L.BASE);
    const send = async text => {
        const count = await page.evaluate(()=>SillyTavern.getContext().chat.length);
        await composer.fill(text);
        await page.locator('#send_but').tap();
        await page.waitForFunction(n=>SillyTavern.getContext().chat.length >= n + 2, count, {timeout:20000});
        await L.idle(page,20000);
    };
    try {
        await L.setupApi(page,{legacyAutomation:false});
        if (process.env.RI_COMPANION_FIXTURE) {
            const presetPath=require.resolve('../presets/Roleplay Instructions V10.json');
            const preset=require(presetPath);
            const drawer=page.locator('#ai-config-button > .drawer-toggle');
            await drawer.tap();
            const installed=await page.locator('#settings_preset_openai').getByRole('option',{name:preset.name,exact:true}).count();
            const chooseFile=page.waitForEvent('filechooser');
            await page.locator('#import_oai_preset').tap();
            const saved=page.waitForResponse(response=>response.url().endsWith('/api/presets/save') && response.request().method()==='POST');
            await (await chooseFile).setFiles(presetPath);
            if (installed) await page.locator('dialog[open]').filter({hasText:'Overwrite?'}).locator('.popup-button-ok').tap();
            assert.equal((await saved).ok(),true);
            await page.waitForFunction(name=>document.querySelector('#settings_preset_openai option:checked')?.textContent.trim()===name,preset.name);
            await drawer.tap();
            await L.setupApi(page,{preset:null,legacyAutomation:false});
        }
        await L.setSettings(page,{summary:{on:false},world:{editableReplies:5,head:0}});
        await L.openChat(page);
        const disabled = await page.evaluate(()=>SillyTavern.getContext().extensionSettings.disabledExtensions);
        assert(disabled.includes('quick-reply') && disabled.includes('memory'));
        evidence.preset = await page.locator('#settings_preset_openai option:checked').textContent();
        evidence.disabled = disabled;
        await composer.fill('An unsent draft to keep.');
        await composer.evaluate(input=>input.setSelectionRange(3,9));
        await open();
        await tap('Browse directions');
        await close();
        assert.equal(await composer.inputValue(),'An unsent draft to keep.');
        assert.deepEqual(await composer.evaluate(input=>[input.selectionStart,input.selectionEnd]),[3,9]);
        assert.equal(await composer.evaluate(input=>input===document.activeElement),true);
        L.resetLog();
        await family('Draft my reply');
        assert.equal(L.requests().length,0);
        await tap('Give me choices · 1 model call');
        await sheet.getByText('3 of 3 choices received.').waitFor({timeout:20000});
        const choiceTop=await sheet.getByRole('textbox',{name:'Choice 1',exact:true}).boundingBox();
        const scrollFrame=await sheet.locator('.ri-quick-scroll').boundingBox();
        assert(choiceTop && choiceTop.y>=scrollFrame.y && choiceTop.y<scrollFrame.y+scrollFrame.height);
        assert.equal(record('QACT-01: blank choices').length,1);
        assert.match(L.text(L.requests()[0]),/An unsent draft to keep\./);
        const editedChoice='I raise a hand and offer to watch the gate.';
        await sheet.getByRole('textbox',{name:'Choice 1',exact:true}).fill(editedChoice);
        await tap('Use this wording');
        assert.match(await composer.inputValue(),/^I raise a hand/);
        await family('Draft my reply');
        await tap('Recover previous composer draft');
        assert.equal(await composer.inputValue(),'An unsent draft to keep.');
        assert.equal(L.requests().length,1);

        const draftChat = await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.evaluate(()=>SillyTavern.getContext().saveChat());
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>globalThis.SillyTavern?.getContext && !document.getElementById('preloader'));
        await L.openChat(page,{fresh:false});
        if (await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId())!==draftChat) {
            await page.evaluate(id=>SillyTavern.getContext().openCharacterChat(id),draftChat);
        }
        await family('Draft my reply');
        await sheet.getByText('Recent drafts and choices',{exact:true}).tap();
        await sheet.getByText(/^Player choices · I raise a hand/).tap();
        await tap('Restore for editing');
        await sheet.getByText('Choices restored for editing.',{exact:true}).waitFor();
        assert.equal(await sheet.getByRole('textbox',{name:'Choice 1',exact:true}).inputValue(),editedChoice);
        assert.equal(L.requests().length,1);
        evidence.captures.push({label:'QACT-CHOICES-RECOVERED: after reload',requests:[],choices:3});
        await close();
        await L.setupApi(page,{preset:null,legacyAutomation:false});

        for (const [name,cue,text] of [
            ['cues only','Do something bold',''],
            ['free text only','','I want to keep the gate in view. QACHOICETEXT'],
            ['cues and free text','Do something bold','Make the offer direct. QACHOICEBOTH'],
        ]) {
            await family('Draft my reply');
            if (cue) {
                await tap(cue);
                await tap(cue);
                await tap(cue);
            }
            if (text) await direct(text);
            L.resetLog();
            await tap('Give me choices · 1 model call');
            await page.waitForFunction(()=>!document.querySelector('.ri-quick-footer button')?.textContent.includes('Running'));
            await sheet.getByText('3 of 3 choices received.').waitFor({timeout:20000});
            const requests=record('QACT-CYOA: '+name);
            assert.equal(requests.length,1);
            if (cue) assert.equal(L.text(requests[0]).split('Give me a decisive action').length-1,1);
            if (text) assert.equal(L.text(requests[0]).split(text).length-1,1);
            if (name==='cues and free text') {
                L.resetLog();
                await tap(/Draft from this choice/);
                await sheet.getByText('Draft ready to edit.',{exact:true}).waitFor({timeout:20000});
                assert.equal(record('QACT-CYOA: explicit choice expansion').length,1);
            }
            await close();
        }

        // The software keyboard reduces the visual viewport on real phones. Resize the
        // browser to model its available height while the textarea owns focus.
        await family('Steer the next reply');
        await direct('Previous private wording. QAPREVIOUS');
        await page.setViewportSize({width:390,height:360});
        const footer = sheet.getByRole('button',{name:'Queue with my next message',exact:true});
        const rect = await footer.boundingBox();
        assert(rect && rect.y >= 0 && rect.y + rect.height <= 360);
        await footer.tap();
        await close();
        await page.setViewportSize({width:390,height:740});
        await family('Steer the next reply');
        await direct(fixtures.visible);
        await sheet.getByLabel('Delivery',{exact:true}).selectOption('visible');
        await tap('Queue with my next message');
        await close();
        await family('Steer the next reply');
        await direct('Cancel this before sending. QACANCELLED');
        await tap('Queue with my next message');
        await tap(/Pending directions/);
        const edit=sheet.locator('article').filter({hasText:'QAPREVIOUS'});
        const cancel=sheet.locator('article').filter({hasText:'QACANCELLED'});
        await tap('Edit wording',edit);
        await edit.getByRole('textbox',{name:'Direction 1'}).fill(fixtures.private);
        await tap('Save wording',edit);
        await tap('Cancel direction',cancel);
        await close();
        assert.equal((await quickState()).pending.length,2);
        L.resetLog();
        await page.evaluate(()=>SillyTavern.getContext().generate('normal',{},true));
        assert.equal(L.requests().length,0);
        assert.equal((await quickState()).pending.length,2);
        L.mode({reply:fixtures.old});
        L.resetLog();
        await send(fixtures.current);
        const ordinary = record('QACT-02: bound ordinary reply');
        assert.equal(ordinary.length,1);
        const sent = L.text(ordinary[0]);
        assert.equal(sent.split('QAPRIVATE').length-1,1);
        assert.equal(sent.split('QAVISIBLE').length-1,1);
        assert.doesNotMatch(sent,/QAPREVIOUS|QACANCELLED/);
        assert.match(sent,/OOC: Let the bell fall silent/);
        assert.equal((await quickState()).pending.length,0);
        evidence.captures.at(-1).state=await captureState();
        const visiblePlayer = await page.evaluate(()=>SillyTavern.getContext().chat.at(-2).mes);
        assert.match(visiblePlayer,/QAVISIBLE/);
        assert.doesNotMatch(visiblePlayer,/QAPRIVATE/);
        await family('Steer the next reply');
        await direct('Use the established setting. QAFRESH');
        await sheet.getByText('Fresh start',{exact:true}).tap();
        await sheet.getByLabel('Duration',{exact:true}).selectOption('five');
        await tap('Queue with my next message');
        await close();
        L.mode({reply:'She sets the lantern down beside the gate.'});
        L.resetLog();
        await send('I take a step toward the gate.');
        const fresh = record('QACT-03: Fresh start on ordinary reply');
        assert.equal(fresh.length,1);
        assert.doesNotMatch(L.text(fresh[0]),/QAPRIVATE|QAVISIBLE|indigo bell rang three times/i);
        assert.match(L.text(fresh[0]),/QAFRESH/);
        const before=ordinary[0].messages, after=fresh[0].messages;
        const firstDifference=before.findIndex((message,index)=>JSON.stringify(message)!==JSON.stringify(after[index]));
        assert(firstDifference>0);
        evidence.captures.at(-1).reusablePrefixMessages=firstDifference;
        evidence.captures.at(-1).state=await captureState();
        assert.equal(await page.evaluate(async B=>(await import(B+'/src/quick-action-chat.js')).freshRemaining(),L.BASE),4);

        L.mode({reply:'She tests the latch with the edge of her sleeve.'});
        L.resetLog();
        await page.locator('#chat .last_mes').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
        await direct(fixtures.swipe);
        await tap('Generate alternate reply');
        await sheet.getByText('Reply updated.',{exact:true}).waitFor({timeout:20000});
        assert.equal(record('QACT-04: reply-level guided swipe').length,1);
        assert.match(L.text(L.requests()[0]),/QASWIPE/);
        assert.doesNotMatch(L.text(L.requests()[0]),/QAPRIVATE|QAVISIBLE|QAFRESH/);
        assert.equal((await captureState()).freshRemaining,4);
        await close();
        const prefix = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes);
        assert.match(prefix,/tests the latch/);
        L.mode({reply:'Then she pulls her sleeve away.'});
        L.resetLog();
        await page.locator('#chat .last_mes').getByRole('button',{name:'Continue this reply',exact:true}).tap();
        await direct(fixtures.continuation);
        await tap('Continue this reply');
        await sheet.getByText('Reply updated.',{exact:true}).waitFor({timeout:20000});
        assert.equal(record('QACT-05: guided continuation').length,1);
        assert.match(L.text(L.requests()[0]),/QACONTINUE/);
        assert((await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes)).startsWith(prefix));
        await tap('Undo continuation');
        await sheet.getByText('Continuation undone.',{exact:true}).waitFor({timeout:8000});
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes),prefix);
        assert.equal((await captureState()).freshRemaining,4);
        await close();

        L.mode({fail:true});
        L.resetLog();
        await family('Draft my reply');
        await direct(fixtures.failure);
        await tap('Give me choices · 1 model call');
        await sheet.getByRole('button',{name:'Retry with the same directions'}).waitFor({timeout:20000});
        assert.equal(record('QACT-06: provider failure').length,1);
        assert.equal(await sheet.getByRole('textbox',{name:'Your direction'}).inputValue(),fixtures.failure);
        L.mode({choices:'["I pocket the key.", "Third person response"]'});
        await tap('Retry with the same directions · 1 model call');
        await sheet.getByText('1 of 3 choices received.').waitFor({timeout:20000});
        assert.equal(record('QACT-07: explicit retry and valid partial result').length,2);
        assert.equal((await quickState()).pending.length,0);
        await close();
        await family('Steer the next reply');
        await direct('Let the character test the chain. OAIRETRY');
        await sheet.getByText('Action roll',{exact:true}).tap();
        await tap('Roll d20');
        await sheet.getByLabel('Delivery',{exact:true}).selectOption('visible');
        await tap('Queue with my next message');
        await close();
        const originalRoll=(await quickState()).pending[0].roll;
        assert(originalRoll?.id);
        L.mode({fail:true});
        L.resetLog();
        await composer.fill('I hold the chain in both hands.');
        await page.locator('#send_but').tap();
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.is_user &&
            SillyTavern.getContext().chat.at(-1).mes.includes('OAIRETRY'));
        await L.idle(page,20000);
        assert.equal(record('QACT-08: failed ordinary reply').length,1);
        assert.equal((await quickState()).pending.length,1);
        assert.equal((await captureState()).freshRemaining,4);
        assert.equal((await quickState()).pending[0].roll.id,originalRoll.id);
        L.mode({reply:'She pulls against the chain.'});
        await open();
        await tap(/Pending directions/);
        await tap('Retry reply to this message');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes==='She pulls against the chain.');
        await L.idle(page,20000);
        const queuedRetry=record('QACT-09: retry of bound outgoing message');
        assert.equal(queuedRetry.length,2);
        for (const request of queuedRetry) {
            assert.equal(L.text(request).split('OAIRETRY').length-1,1);
            assert.equal(L.text(request).split(originalRoll.text).length-1,1);
        }
        assert.equal((await quickState()).pending.length,0);
        evidence.captures.at(-1).state=await captureState();
        assert.equal(evidence.captures.at(-1).state.freshRemaining,3);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-2).mes.split('OAIRETRY').length-1),1);
        await close();
        for (const [action,reply] of [['Keep original roll','She rechecks the chain.'],['Reroll d20','She leaves the chain loose.']]) {
            await page.locator('#chat .last_mes').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
            await sheet.getByText('Action roll',{exact:true}).tap();
            await tap(action);
            L.mode({reply});
            L.resetLog();
            await tap('Generate alternate reply');
            await sheet.getByText('Reply updated.',{exact:true}).waitFor({timeout:20000});
            const sent=record('QACT-ROLL: '+action);
            const roll=await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.guided.roll);
            assert.equal(sent.length,1);
            assert.equal(L.text(sent[0]).split(roll.text).length-1,1);
            assert.equal(roll.id===originalRoll.id,action==='Keep original roll');
            evidence.captures.at(-1).roll=roll;
            assert.equal((await captureState()).freshRemaining,3);
            await close();
        }
        for (let left=2;left>=0;left--) {
            L.mode({reply:'She listens for movement beyond the gate.'});
            L.resetLog();
            await send('I point past the gate. '+left);
            assert.equal((await captureState()).freshRemaining,left);
            assert.match(L.text(L.requests()[0]),/Work from the facts and current direction/);
            record('QACT-FRESH: '+left+' slots remain');
        }
        L.resetLog();
        await send('I move away from the chain.');
        assert.doesNotMatch(L.text(L.requests()[0]),/Work from the facts and current direction/);
        record('QACT-FRESH: expired on next normal reply');

        const set='Reanchor QA '+Date.now();
        await L.makeSet(page,set,[{name:'Reanchor',chance:100,versions:['A1','A2','A3','A4','A5']}]);
        await family('Steer the next reply');
        await tap('Browse directions');
        await sheet.getByLabel('Search quick actions',{exact:true}).fill(set);
        await sheet.getByText('Versions and ingredients',{exact:true}).tap();
        L.resetLog();
        await tap('Version 3');
        assert.match(await sheet.getByLabel('Exact direction',{exact:true}).inputValue(),/thing A3/);
        assert.equal(L.requests().length,0);
        await tap('Select direction');
        await tap('Queue with my next message');
        await close();
        await send('I make room at the gate.');
        const sourceRequest=record('QACT-SOURCE: exact version with matching automatic source');
        assert.equal(sourceRequest.length,1);
        assert.equal(L.text(sourceRequest[0]).split('thing A3').length-1,1);
        assert.doesNotMatch(L.text(sourceRequest[0]),/thing A[1245]/);
        const used=await page.evaluate(async ({base,set})=>{
            const {chatState}=await import(base+'/src/store.js');
            return Object.entries(chatState().used).find(([key])=>key.startsWith(set+'.'))?.[1];
        },{base:L.BASE,set});
        assert.deepEqual(used,[2]);
        evidence.captures.at(-1).acceptedVersions=used;
        evidence.browserErrors=errors;
        console.log('PASS phone-width composer, draft recovery, CYOA, queue delivery, Fresh start, guided swipe, continuation undo and explicit retry');
    } catch (error) {
        evidence.browserErrors=errors;
        evidence.failure=String(error);
        console.error(errors);
        await page.screenshot({path:'/tmp/ri-quick-actions-failure.png'}).catch(()=>{});
        throw error;
    } finally {
        L.mode({});
        if (process.env.RI_EVIDENCE) fs.writeFileSync(path.resolve(process.env.RI_EVIDENCE),JSON.stringify(evidence,null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
