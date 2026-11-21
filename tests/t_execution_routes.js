// SillyTavern connection and streaming capability. Use two isolated mock API endpoints.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');
const { setupApi: reconnectMain } = require('./h.js');

const alternatePort = Number(process.env.RI_ALT_MOCK_PORT);
const alternateMode = process.env.RI_ALT_MOCK_MODE;
const alternateLog = process.env.RI_ALT_MOCK_LOG;
if (!alternatePort || !alternateMode || !alternateLog) throw new Error('Set RI_ALT_MOCK_PORT, RI_ALT_MOCK_MODE and RI_ALT_MOCK_LOG.');
const profile = {id:'ri-execution-alternate',name:'Fixture alternate',mode:'cc',api:'custom',model:'mock-alternate',
    'api-url':`http://127.0.0.1:${alternatePort}/v1`,exclude:[]};
const alternateRequests = () => fs.existsSync(alternateLog)
    ? fs.readFileSync(alternateLog,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
const reset = () => { L.resetLog(); if (fs.existsSync(alternateLog)) fs.unlinkSync(alternateLog); };
const setAlternate = value => fs.writeFileSync(alternateMode,JSON.stringify(value));
const count = (request,text) => L.text(request).split(text).length-1;

(async()=>{
    L.sync();
    L.mode({});
    setAlternate({});
    const {browser,page,errors}=await L.open({width:390,height:720,hasTouch:true,isMobile:true});
    const fixture=Date.now();
    const presetA=`Execution alpha ${fixture}`,presetB=`Execution beta ${fixture}`;
    const alpha='E_FIXTURE_ALPHA Write my next action.';
    const beta='E_FIXTURE_BETA Write my next words.';
    const capture=[];
    let disabled;
    const tap=control=>control.tap();
    const sheet=page.locator('.ri-quick-sheet');
    const captureRoute=(id,state={})=>{
        capture.push({id,...state,main:L.requests().map(excerpt),alternate:alternateRequests().map(excerpt)});
        if (process.env.RI_EXECUTION_CAPTURE) fs.writeFileSync(process.env.RI_EXECUTION_CAPTURE,
            JSON.stringify({host:'1.19.0 7e8663c',viewport:[390,490],disabled,capture},null,2)+'\n');
    };
    function excerpt({url,model,stream,messages}) {
        return {url,model,stream,messages:messages.filter(message=>/E_FIXTURE|thing A9|Return only playable|Return a JSON array of 3 strings|"done"/.test(String(message.content)))};
    }
    const openDraft=async()=>{
        await tap(page.getByRole('button',{name:'Quick actions',exact:true}));
        await tap(sheet.getByRole('button',{name:'Draft my reply',exact:true}));
    };
    const close=()=>tap(sheet.getByRole('button',{name:'Close',exact:true}));
    const panel=page.locator('#ri_root');
    const returnToDraft=()=>tap(panel.getByRole('button',{name:'Back to Quick actions',exact:true}));
    const direction=sheet.getByRole('textbox',{name:'Your direction'});
    const generate=()=>tap(sheet.getByRole('button',{name:'Generate my draft · 1 model call',exact:true}));
    const result=()=>sheet.locator('[data-quick-results]').waitFor();
    const waitWording=text=>page.waitForFunction(text=>{
        const dialog=document.querySelector('.ri-quick-sheet');
        return !dialog?.querySelector('[data-quick-error]') && [...(dialog?.querySelectorAll('[data-quick-results] textarea') || [])].some(input=>input.value.includes(text));
    },text);
    const receipt=operation=>page.evaluate(async({base,operation})=>{
        return (await import(`${base}/src/execution.js`)).executionReceipt(operation);
    },{base:L.BASE,operation});
    const setting=(operation,change)=>page.evaluate(async({base,operation,change})=>{
        (await import(`${base}/src/execution.js`)).setExecutionSetting(operation,change);
    },{base:L.BASE,operation,change});
    const putProfile=remove=>page.evaluate(({profile,remove})=>{
        const host=SillyTavern.getContext();
        const settings=host.extensionSettings.connectionManager;
        settings.profiles=settings.profiles.filter(item=>item.id!==profile.id);
        if (!remove) settings.profiles.push(profile);
        host.saveSettingsDebounced();
    },{profile,remove});
    const tapDraftConnection=async()=>{
        const execution=sheet.locator('.ri-execution').filter({hasText:'Generate my draft'});
        await tap(execution.locator(':scope > summary'));
        const stage=execution.locator('.ri-execution-stage').filter({has:page.getByText('Generate my draft',{exact:true})});
        await tap(stage.getByRole('button',{name:'Connection settings'}));
        await panel.getByRole('combobox',{name:'Generate my draft connection'}).selectOption(profile.id);
        await returnToDraft();
    };
    const toggleAutomatic=async (label,value)=>{
        await tap(page.getByRole('button',{name:'Quick actions',exact:true}));
        await tap(sheet.getByRole('button',{name:'Edit preset prompts',exact:true}));
        await tap(panel.locator('[data-ri-page="settings"]'));
        const control=panel.getByRole('combobox',{name:label,exact:true});
        assert.equal(await control.inputValue(),value==='on' ? 'off' : 'on');
        await control.selectOption(value);
        await tap(panel.getByRole('button',{name:'Close full screen',exact:true}));
        await close();
    };
    try {
        await L.setupApi(page,{legacyAutomation:false});
        disabled=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.disabledExtensions);
        assert(!disabled.includes('connection-manager'),'This separate capability fixture requires the bundled Connection Manager.');
        await page.evaluate(async({presetA,presetB,alpha,beta})=>{
            const host=SillyTavern.getContext(),manager=host.getPresetManager('openai');
            const starting=manager.getCompletionPresetByName(manager.getSelectedPresetName());
            for (const [name,prompt] of [[presetA,alpha],[presetB,beta]]) {
                await manager.savePreset(name,{...structuredClone(starting),name,impersonation_prompt:prompt});
            }
        },{presetA,presetB,alpha,beta});
        await L.usePreset(page,presetA);
        await L.setupApi(page,{preset:null,legacyAutomation:false});
        await L.openChat(page);
        await putProfile(false);
        await setting('playerDraft',{profileId:''});
        await setting('playerChoices',{profileId:''});
        await L.send(page,'E_FIXTURE_PLAYER I watch the door.');

        reset();
        await tap(page.getByRole('button',{name:'Quick actions',exact:true}));
        await tap(sheet.getByRole('button',{name:'Steer the next reply',exact:true}));
        await tap(sheet.getByText('Action roll',{exact:true}));
        await tap(sheet.getByRole('button',{name:'Roll d20',exact:true}));
        const codeExecution=sheet.locator('.ri-execution-code');
        await tap(codeExecution.locator(':scope > summary'));
        assert.deepEqual((await codeExecution.locator('dt').allTextContents()).slice(0,2),['Execution','Calls']);
        assert.match(await codeExecution.innerText(),/Runs in code[\s\S]*0 model calls/);
        assert.equal(L.requests().length+alternateRequests().length,0);
        captureRoute('E-48-ROLL',{execution:await codeExecution.innerText()});
        await close();

        await openDraft();
        await direction.fill('E_FIXTURE_NATIVE Keep my answer brief.');
        await page.setViewportSize({width:390,height:490});
        const inspector=sheet.locator('.ri-impersonation').first();
        await tap(inspector.locator(':scope > summary'));
        assert.match(await inspector.textContent(),new RegExp(alpha));
        await generate();
        await result();
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,0);
        assert.equal(count(L.requests()[0],'E_FIXTURE_ALPHA'),1);
        assert.equal(count(L.requests()[0],'E_FIXTURE_NATIVE'),1);
        assert.equal((await receipt('playerDraft')).route,'Native impersonation');
        captureRoute('E-30-NATIVE',{receipt:await receipt('playerDraft')});

        reset();
        await page.evaluate(()=>{
            const input=document.querySelector('#send_textarea');
            input.value='E_FIXTURE original composer';
            input.setSelectionRange(2,8);
            input.dispatchEvent(new Event('input',{bubbles:true}));
            jQuery('#stream_toggle').prop('checked',true).trigger('change');
        });
        const partial='I tuck the brass key under the loose mat';
        L.mode({player:`${partial}. Then I walk away.`,chunkMs:120,streamFailAfter:1});
        await direction.fill('E_FIXTURE_STREAM Keep the key near.');
        await generate();
        const error=sheet.locator('[data-quick-error]');
        await error.waitFor();
        assert.match(await error.textContent(),/stream stopped before the draft finished/i);
        await tap(sheet.getByText('Raw output and recovery',{exact:true}));
        assert.equal(await sheet.getByRole('textbox',{name:'Partial result'}).inputValue(),partial);
        assert(await sheet.getByRole('button',{name:'Use edited wording'}).isDisabled());
        assert.equal(L.requests().length,1);
        assert.equal(L.requests()[0].stream,true);
        assert.deepEqual(await page.locator('#send_textarea').evaluate(el=>[el.value,el.selectionStart,el.selectionEnd]),['E_FIXTURE original composer',2,8]);
        const failed=await receipt('playerDraft');
        assert.equal(failed.attempts,1);
        assert.equal(failed.outcome,'failed');
        assert.equal(failed.partialText,partial);
        captureRoute('E-23-PARTIAL',{receipt:failed});
        L.mode({player:'I return for the brass key.'});
        await tap(error.getByRole('button',{name:/Retry with the same directions/}));
        await result();
        await waitWording('I return for the brass key.');
        assert.equal(L.requests().length,2);
        assert.equal(count(L.requests()[1],'E_FIXTURE_STREAM'),1);
        captureRoute('E-23-RETRY',{receipt:await receipt('playerDraft')});
        await page.evaluate(()=>jQuery('#stream_toggle').prop('checked',false).trigger('change'));

        reset();
        L.mode({player:''});
        await direction.fill('E_FIXTURE_EMPTY Try opening the door.');
        await generate();
        await error.waitFor();
        assert.match(await error.textContent(),/empty draft|empty answer/i);
        const empty=await receipt('playerDraft');
        assert.equal(empty.attempts,1);
        assert.equal(empty.outcome,'failed');
        assert.equal(L.requests().length,1);
        captureRoute('E-51-EMPTY',{receipt:empty});

        await direction.fill('E_FIXTURE_SWITCH Keep the unsaved direction.');
        const baseSource=inspector.getByRole('combobox',{name:'Base for direct player helpers',exact:true});
        if (!await inspector.evaluate(element=>element.open)) await tap(inspector.locator(':scope > summary'));
        await baseSource.selectOption('extension');
        assert.equal(await direction.inputValue(),'E_FIXTURE_SWITCH Keep the unsaved direction.');
        await close();
        await L.usePreset(page,presetB);
        await L.setupApi(page,{preset:null,legacyAutomation:false});
        await openDraft();
        assert.equal(await direction.inputValue(),'E_FIXTURE_SWITCH Keep the unsaved direction.');
        await tap(inspector.locator(':scope > summary'));
        assert.match(await inspector.textContent(),new RegExp(beta));
        assert.doesNotMatch(await inspector.textContent(),new RegExp(alpha));
        assert.equal(await baseSource.inputValue(),'preset');
        const alphaOverride=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.roleplay_instructions.impersonationByPreset);
        assert.equal(alphaOverride[JSON.stringify(['openai',presetA])],'extension');
        assert.equal(alphaOverride[JSON.stringify(['openai',presetB])],undefined);
        reset();
        L.mode({player:'I answer from the second preset.'});
        await generate();
        await waitWording('I answer from the second preset.');
        assert.equal(L.requests().length,1);
        assert.equal(count(L.requests()[0],'E_FIXTURE_BETA'),1);
        assert.equal(count(L.requests()[0],'E_FIXTURE_SWITCH'),1);
        captureRoute('E-30-NATIVE-BETA',{receipt:await receipt('playerDraft'),firstPresetSource:alphaOverride[JSON.stringify(['openai',presetA])],secondPresetSource:'host preset'});
        await direction.fill('E_FIXTURE_NAMED Keep my alternate draft concise.');
        await tapDraftConnection();
        reset();
        L.mode({});
        setAlternate({player:'I answer over the second fixture route.'});
        await generate();
        await waitWording('I answer over the second fixture route.');
        assert.equal(L.requests().length,0);
        assert.equal(alternateRequests().length,1);
        assert.equal(alternateRequests()[0].model,profile.model);
        assert.equal(count(alternateRequests()[0],'E_FIXTURE_BETA'),1);
        assert.equal(count(alternateRequests()[0],'E_FIXTURE_NAMED'),1);
        assert.equal(count(alternateRequests()[0],'E_FIXTURE_ALPHA'),0);
        assert.equal((await receipt('playerDraft')).route,'Player-only helper');
        assert.equal(await page.locator('#settings_preset_openai option:checked').textContent(),presetB);
        captureRoute('E-30-NAMED',{receipt:await receipt('playerDraft')});

        await close();
        const originalChat=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForFunction(()=>SillyTavern?.getContext()?.extensionSettings?.roleplay_instructions?.execution?.functions?.playerDraft?.profileId==='ri-execution-alternate');
        await reconnectMain(page);
        await tap(page.locator('.recentChat').filter({hasText:originalChat}).first());
        await page.waitForFunction(id=>SillyTavern.getContext().getCurrentChatId()===id,originalChat);
        await L.openChat(page);
        assert.notEqual(await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId()),originalChat);
        await L.send(page,'E_FIXTURE_SECOND_CHAT I check the door again.');
        reset();
        await openDraft();
        await generate();
        await result();
        await tap(sheet.getByRole('button',{name:'Give me choices · 1 model call',exact:true}));
        await waitWording('I raise a hand');
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,1);
        assert.equal(alternateRequests()[0].model,profile.model);
        const choiceExecution=sheet.locator('.ri-execution-additional').filter({hasText:'Give me choices'});
        await tap(choiceExecution.locator(':scope > summary'));
        assert.deepEqual((await choiceExecution.locator('dt').allTextContents()).slice(0,3),['Execution','Calls','Connection']);
        assert.match(await choiceExecution.innerText(),/Additional model request[\s\S]*1 model call expected[\s\S]*Main API/);
        assert.equal(L.requests().length+alternateRequests().length,2);
        captureRoute('E-50-RELOADED',{draft:await receipt('playerDraft'),choices:await receipt('playerChoices'),execution:await choiceExecution.innerText()});

        await close();
        await page.evaluate(port=>{
            jQuery('#main_api').val('textgenerationwebui').trigger('change');
            jQuery('#textgen_type').val('ooba').trigger('change');
            jQuery('#textgenerationwebui_api_url_text').val(`http://127.0.0.1:${port}`).trigger('input');
            jQuery('#streaming_textgenerationwebui').prop('checked',false).trigger('input');
            jQuery('#api_button_textgenerationwebui').trigger('click');
        },Number(process.env.RI_MOCK_PORT || 8124));
        await page.waitForFunction(()=>SillyTavern.getContext().mainApi==='textgenerationwebui' && SillyTavern.getContext().onlineStatus!=='no_connection');
        reset();
        await openDraft();
        await direction.fill('E_FIXTURE_TEXT_API I examine the door.');
        await tap(sheet.getByRole('button',{name:'Give me choices · 1 model call',exact:true}));
        await waitWording('I raise a hand');
        assert.equal(alternateRequests().length,0);
        assert.equal(L.requests().length,1);
        assert.equal(L.requests()[0].messages[0].role,'text');
        assert.match((await receipt('playerChoices')).connection,/Main API \(textgenerationwebui/);
        captureRoute('E-50-SWITCHED-API',{receipt:await receipt('playerChoices')});

        await close();
        await L.setupApi(page,{preset:null,legacyAutomation:false});
        await setting('playerDraft',{profileId:profile.id});
        await putProfile(true);
        await openDraft();
        await direction.fill('E_FIXTURE_MISSING Preserve this direction.');
        assert(await sheet.getByRole('button',{name:'Generate my draft · 1 model call',exact:true}).isDisabled());
        assert.match(await sheet.textContent(),/saved connection profile.*unavailable/i);
        const problem=sheet.getByRole('status').filter({hasText:/saved connection profile.*unavailable/i});
        await tap(problem.locator('..').getByRole('button',{name:'Connection settings',exact:true}));
        const unavailable=panel.getByRole('combobox',{name:'Generate my draft connection'});
        assert.equal(await unavailable.inputValue(),profile.id);
        await unavailable.selectOption('');
        await returnToDraft();
        assert.equal(await direction.inputValue(),'E_FIXTURE_MISSING Preserve this direction.');
        reset();
        L.mode({player:'I try the main route again.'});
        await generate();
        await waitWording('I try the main route again.');
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,0);
        assert.equal(count(L.requests()[0],'E_FIXTURE_MISSING'),1);
        captureRoute('E-50-RECOVER-MAIN',{receipt:await receipt('playerDraft')});
        await close();

        await L.setSettings(page,{perReply:1,check:{mode:'full',regenOnMiss:true,agency:'off'}});
        await setting('instructionCheck',{profileId:profile.id,automatic:false});
        await setting('automaticSwipe',{automatic:false});
        await L.makeSet(page,`Execution required ${fixture}`,[{name:'Bring the cup',versions:['A9'],sentAs:'system'}]);
        reset();
        L.mode({reply:'The captain studies his journal.',done:false});
        await L.send(page,'E_FIXTURE_DISABLED I wait.');
        await L.waitChecks(page);
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,0);
        captureRoute('E-49-OFF');

        await toggleAutomatic('Check whether directions happened automatic requests','on');
        reset();
        await L.send(page,'E_FIXTURE_BLOCKED I wait for the cup.');
        await L.waitChecks(page);
        const blocked=await receipt('instructionCheck');
        assert.equal(blocked.outcome,'blocked');
        assert.equal(blocked.authorization,'automatic');
        assert.equal(blocked.attempts,0);
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,0);
        await tap(page.getByRole('button',{name:'Quick actions',exact:true}));
        await tap(sheet.getByRole('button',{name:'Reply Notes',exact:true}));
        const newest=page.locator('#ri_root .ri-sentcard').first();
        await tap(newest.getByRole('button',{name:/Check this reply again/}));
        await L.waitChecks(page);
        const manual=await receipt('instructionCheck');
        assert.equal(manual.authorization,'manual');
        assert.equal(manual.outcome,'blocked');
        assert.equal(manual.attempts,0);
        assert.equal(L.requests().length,1);
        const reviewExecution=newest.locator('.ri-execution-additional').filter({hasText:'Check that it happened'});
        await tap(reviewExecution.locator(':scope > summary'));
        assert.match(await reviewExecution.innerText(),/Additional model request[\s\S]*Unavailable profile[\s\S]*Attempts used[\s\S]*0/);
        captureRoute('E-50-MISSING',{automatic:blocked,manual,review:await reviewExecution.innerText()});
        await tap(page.locator('#ri_root').getByRole('button',{name:'Close full screen',exact:true}));

        await putProfile(false);
        setAlternate({done:false});
        reset();
        await L.send(page,'E_FIXTURE_CHECK I wait once more.');
        await L.waitChecks(page);
        assert.equal(L.requests().length,1);
        assert.equal(alternateRequests().length,1);
        assert.equal(alternateRequests()[0].model,profile.model);
        assert.equal((await receipt('instructionCheck')).authorization,'automatic');
        captureRoute('E-49-CHECK',{receipt:await receipt('instructionCheck')});

        await toggleAutomatic('Automatically replace a missed reply automatic requests','on');
        reset();
        await L.send(page,'E_FIXTURE_REPLACEMENT I still wait for the cup.');
        await page.waitForFunction(async base=>{
            const execution=(await import(`${base}/src/execution.js`)).executionReceipt('automaticSwipe');
            return execution && ['completed','failed','cancelled'].includes(execution.outcome);
        },L.BASE);
        await L.waitChecks(page);
        const replacement=await receipt('automaticSwipe');
        assert.equal(replacement.attempts,1);
        assert.equal(replacement.outcome,'completed');
        assert.equal(L.requests().length,2);
        assert.equal(alternateRequests().length,2);
        const swipeState=await page.evaluate(()=>{
            const last=SillyTavern.getContext().chat.at(-1);
            return {swipe:last.swipe_id,receipt:last.extra.roleplay_instructions.automaticSwipeExecution};
        });
        assert.equal(swipeState.swipe,1);
        assert.equal(swipeState.receipt.id,replacement.id);
        captureRoute('E-49-REPLACEMENT',{receipt:replacement,acceptedSwipe:swipeState.swipe});

        const unexpected=errors.filter(error=>!(error.startsWith('CONSOLE SyntaxError: Expected property name') && error.includes('StreamingProcessor.streamData')));
        assert.deepEqual(unexpected,[]);
        console.log('PASS: native partial stream and explicit retry, two preset bases, phone execution controls, persisted named routing, and automatic checker authorization.');
    } catch (error) {
        await page.screenshot({path:'/tmp/ri-execution-routes-failure.png'}).catch(()=>{});
        console.error(await sheet.locator('[data-quick-error]').allTextContents());
        throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
