// Exercise the native preset save path and inspect the request delivered to the local model.
// B36 retired the Presets page block editor and B36b retired adoptOwnEdit with it; the stack, the request and Changed in
// source are read from the bank and the wire. Controls are driven with Playwright actions on a settled panel: each reply's
// memory capture ends with a panel redraw, and a value set on a node that redraw replaced never reaches the page.
const L=require('./lib.js'), assert=require('node:assert/strict'), fs=require('node:fs');
(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open();
    page.on('pageerror',error=>console.error(error.stack));
    const preset=JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));
    preset.name='Roleplay Instructions V10.432';
    preset.prompts.push({identifier:'review-relationships',name:'Internal States Template',role:'system',content:'HOST_REL_432',system_prompt:false});
    for(const order of preset.prompt_order)order.order.push({identifier:'review-relationships',enabled:true});
    const root=page.locator('#ri_root');
    const click=locator=>locator.click();
    const open=async locator=>{
        await locator.evaluate(el=>{for(let p=el;p;p=p.parentElement) if(p.tagName==='DETAILS' && !p.open) p.open=true;});
    };
    // The panel redraws itself when a background job ends (the capture call after each reply ends with changed('checked')),
    // so the page is driven only once it has stopped redrawing: no new panel body for 400 ms.
    const settled=()=>page.evaluate(async()=>{
        let body=document.querySelector('#ri_panel_page'),since=performance.now();
        while(performance.now()-since<400){await new Promise(r=>setTimeout(r,50));const now=document.querySelector('#ri_panel_page');if(now!==body){body=now;since=performance.now();}}
    });
    const pageTab=async tab=>{await page.evaluate(async({B,tab})=>{const {app}=await import(`${B}/src/ui/panel.js`);await app.openPage(tab,{focusPage:true});await app.setExpanded(true);},{B:L.BASE,tab});await settled();};
    // A reply is done for this suite once memory has captured it and the panel redraw that follows has landed.
    const send=async text=>{
        await L.send(page,text);
        await page.waitForFunction(async B=>{const C=await import(B+'/src/memory/capture.js'),chat=SillyTavern.getContext().chat;return C.isCaptured(chat[chat.length-1]);},L.BASE,{timeout:15000,polling:100});
        await settled();
    };
    const pick=(locator,value)=>locator.selectOption(value);
    const input=(locator,value)=>locator.fill(value);
    try {
        await L.setupApi(page);
        await page.evaluate(data=>SillyTavern.getContext().getPresetManager('openai').savePreset(data.name,data),preset);
        await L.usePreset(page,preset.name);await L.setupApi(page,{preset:null});await L.openChat(page);
        // Only a change from outside RI shows Changed in source.
        const sendOnce=async text=>{L.mode({reply:'Mira waits.'});L.resetLog();await send(text);return L.text(L.requests()[0]);};
        const take=(key)=>page.evaluate(async({B,key})=>{const M=await import(B+'/src/preset-bank.js');M.takeNewText(M.currentBank(),key,['base::review-relationships']);},{B:L.BASE,key});
        const outside=content=>page.evaluate(async({B,content})=>{
            const pm=SillyTavern.getContext().getPresetManager('openai');const data=JSON.parse(JSON.stringify(pm.getCompletionPresetByName(pm.getSelectedPresetName())));
            data.prompts.find(p=>p.identifier==='review-relationships').content=content;await pm.savePreset(pm.getSelectedPresetName(),data);
            const M=await import(B+'/src/preset-bank.js');M.refreshBank('test');},{B:L.BASE,content});
        const stackCard=()=>page.evaluate(async B=>{const M=await import(B+'/src/preset-bank.js');const bank=M.refreshBank('test');const stack=M.stackFor(bank);
            const card=M.stackPlan(bank,stack).find(item=>item.key==='base::review-relationships');return card && {status:card.status,text:card.text,stack:stack.key};},L.BASE);
        // Her own edit goes through the bank's Edit (a customized version in the stack), so the preset file never changes by her hand.
        assert.equal((await stackCard()).status,'clean','the stack holds the block before any outside change');
        await L.setSettings(page,{check:{mode:'off'}});
        assert.ok((await sendOnce('I wait.')).includes('HOST_REL_432'),'the block reaches the request with no tap');
        // A change from outside RI (SillyTavern saves the preset) still shows Changed in source and keeps the old text.
        await outside('HOST_OUTSIDE_432');
        const external=await stackCard();
        assert.equal(external.status,'changed','a change from outside RI shows Changed in source');
        assert.match(external.text,/HOST_REL_432/,'the stack card keeps the text it was taken with');
        assert.ok((await sendOnce('Still waiting.')).includes('HOST_REL_432'),'the old text is still sent');
        await take(external.stack);
        assert.ok((await sendOnce('Now.')).includes('HOST_OUTSIDE_432'),'the outside text is sent after Take the new text');
        await outside('HOST_REL_432');await take(external.stack);
        assert.equal((await stackCard()).status,'clean');
        // B34: the conflict call runs only on her tap and lists what could cause a problem; an empty list reads as none found.
        await pageTab('presets');
        const conflicts=root.locator('#ri-conflicts');await conflicts.waitFor({state:'attached',timeout:10000});await conflicts.scrollIntoViewIfNeeded();
        L.resetLog();L.mode({reply:'[]'});
        await page.waitForTimeout(300);assert.equal(L.requests().length,0,'opening the page makes no model call');
        await click(conflicts.getByRole('button',{name:/Check conflicts/}));
        for(let i=0;i<60 && L.requests().length<1;i++)await page.waitForTimeout(150);
        await conflicts.locator('.ri-conf-status').filter({hasText:/Check finished/}).waitFor({state:'attached',timeout:9000});
        assert.equal(L.requests().length,1);
        // B31: the extension order is the order of the Extension cards in the stack; the bank's own calls move one.
        const moveCard=delta=>page.evaluate(async({B,delta})=>{
            const M=await import(B+'/src/preset-bank.js'),R=await import(B+'/src/preset-bank-ri.js'),V=await import(B+'/src/v10.js');
            const preset=V.activePreset(),bank=M.currentBank()||M.refreshBank('test'),stack=R.riStack(bank,preset);
            M.stepCard(bank,stack.key,'ri::colors',delta,{base:preset});
        },{B:L.BASE,delta});
        await moveCard(-1);
        L.resetLog();L.mode({reply:'Mira studies the compass.'});await send('I take out the compass.');
        const reordered=L.text(L.requests()[0]);
        assert.ok(reordered.indexOf('Use ordinary quoted dialogue')>=0 && reordered.indexOf('Use ordinary quoted dialogue')<reordered.indexOf('Scene and character checks:'),'extension order changed the request');
        await moveCard(1);
        await pageTab('v10');
        const voices=root.locator('details').filter({has:page.getByText('Roast commentator voice and feedback',{exact:true})}).last();
        await open(voices);const picker=voices.getByLabel('Commentator voice',{exact:true});
        const previousVoice=await picker.inputValue();await pick(picker,'voiceDetective');
        const voice=voices.locator('.ri-prompt-editor').first();await open(voice);await input(voice.locator('textarea'),'DETECTIVE_TEST_432');
        await click(voice.getByRole('button',{name:'Update',exact:true}));
        // Update saves and relabels the picker in the same tap.
        assert.match(await picker.locator('option:checked').textContent(),/Customized/);
        await page.evaluate(async base=>{const p=(await import(base+"/src/v10.js")).prefs();(p.modules ||= {}).roast=true;},L.BASE);
        L.resetLog();await send('What happened?');assert.match(L.text(L.requests()[0]),/DETECTIVE_TEST_432/);
        await pageTab('v10');await open(voices);await open(voice);await click(voice.getByRole('button',{name:'Restore default prompt',exact:true}));
        assert.doesNotMatch(await picker.locator('option:checked').textContent(),/Customized/);
        await pick(picker,previousVoice);
        // When the stored voice changes outside this picker, the picker and the editor under it move together.
        const follows=await page.evaluate(async B=>{
            const P=await import(B+'/src/ui/prompts.js'),S=await import(B+'/src/store.js'),M=await import(B+'/src/ui/prompt-mirror.js');
            const group=P.roastVoiceEditor([],'z');document.body.append(group);
            const before=S.settings().roastVoiceId;S.settings().roastVoiceId='voiceGamer';M.announcePromptChange('voiceGamer');
            const picked=group.querySelector('select').value,editing=group.querySelector('.ri-prompt-editor')?.dataset.riPrompt;
            if(before===undefined)delete S.settings().roastVoiceId;else S.settings().roastVoiceId=before;group.remove();
            return {picked,editing};
        },L.BASE);
        assert.deepEqual(follows,{picked:'voiceGamer',editing:'voiceGamer'},'the voice editor follows the picker');
        // B36b: the Roast prompt has one stored value. The bank card's slot and the Roast voice home edit the same stored prompt,
        // and the card links to the voice home instead of repeating the voice controls.
        const shared=await page.evaluate(async B=>{
            const H=await import(B+'/src/ui/homes.js'),P=await import(B+'/src/ui/prompts.js'),S=await import(B+'/src/store.js'),T=await import(B+'/src/prompts.js');
            const card=H.slot(['structuredRoast'],'',{bare:true}), voice=P.roastVoiceEditor(['structuredRoast','roastFeedback'],'x');
            const area=node=>[...node.querySelectorAll('textarea')].find(item=>item.closest('[data-prompt-id],.ri-prompt-editor')&&item.value===T.promptText('structuredRoast'));
            const before=T.promptText('structuredRoast');
            const cardArea=card.querySelector('textarea');cardArea.value='SHARED_ROAST_432';cardArea.dispatchEvent(new Event('input',{bubbles:true}));
            const save=[...card.querySelectorAll('button')].find(item=>item.textContent==='Update');save?.click();
            const stored=T.promptText('structuredRoast');
            const voiceAreas=[...voice.querySelectorAll('textarea')].map(item=>item.value);
            const reopened=P.roastVoiceEditor(['structuredRoast'],'y');
            const sees=[...reopened.querySelectorAll('textarea')].some(item=>item.value==='SHARED_ROAST_432');
            [...card.querySelectorAll('button')].find(item=>item.textContent==='Restore default prompt')?.click();
            return {before,stored,sees,restored:T.promptText('structuredRoast')===before,voiceAreas:voiceAreas.length};
        },L.BASE);
        assert.equal(shared.stored,'SHARED_ROAST_432','the bank card slot saves the stored Roast prompt');
        assert.ok(shared.sees,'the Roast voice home shows the same stored prompt');
        assert.ok(shared.restored,'restoring from the card restores it everywhere');
        // Wait for the host's debounced settings write before switching presets or closing the browser.
        if(process.env.RI_ST_DIR) {
            const settingsPath=require('node:path').join(process.env.RI_ST_DATA || require('node:path').join(process.env.RI_ST_DIR,'data'),'default-user/settings.json');
            await require('node:timers/promises').setTimeout(1250);
            const savedVoice=JSON.parse(fs.readFileSync(settingsPath)).extension_settings.roleplay_instructions;
            assert.equal(savedVoice.roastVoiceId,previousVoice);
            assert.equal(savedVoice.prompts?.voiceDetective,undefined);
        }
        if(process.env.RI_REFERENCE_DIR){
            const path=require('node:path'), dir=process.env.RI_REFERENCE_DIR;
            for(const file of fs.readdirSync(dir,{recursive:true}).filter(f=>f.endsWith('.json'))){
                const reference=JSON.parse(fs.readFileSync(path.join(dir,file)));
                const name='Reference '+path.basename(file);
                // Only exercise the actual prompt definitions and order. These fixtures also ship unrelated regex and provider settings.
                await page.evaluate(({name,reference})=>{
                    const pm=SillyTavern.getContext().getPresetManager('openai');
                    return pm.savePreset(name,{...pm.getCompletionPresetByName(pm.getSelectedPresetName()),prompts:reference.prompts,prompt_order:reference.prompt_order});
                },{name,reference});
                await L.usePreset(page,name);await pageTab('presets');
                const visibleIds=await page.evaluate(async({B,name})=>{
                    const M=await import(B+'/src/preset-bank.js'),bank=M.refreshBank('test'),source=bank.sources.get(M.presetSource(bank.sids[name]));
                    return source.cards.map(card=>card.id);
                },{B:L.BASE,name});
                const ids=new Set(reference.prompts.map(p=>p.identifier));
                const source=reference.prompt_order.find(g=>String(g.character_id)==='100001').order.map(e=>e.identifier).filter(id=>ids.has(id));
                assert.deepEqual(visibleIds.filter(id=>source.includes(id)).slice(0,source.length),source);
                for(const id of ids)assert(visibleIds.includes(id),id);
                console.log(path.basename(file)+': '+source.length+' ordered, '+ids.size+' supplied blocks accounted for.');
            }
        }
        assert.deepEqual(errors,[]);console.log('PASS: edited text on the wire, per-block restore, outside changes, the conflict call on tap, extension card order and a customized commentator in a real request.');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
