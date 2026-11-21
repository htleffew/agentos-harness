// Exercise the native preset save path and inspect the request delivered to the local model.
const L=require('./lib.js'), assert=require('node:assert/strict'), fs=require('node:fs');
(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open();
    page.on('pageerror',error=>console.error(error.stack));
    const preset=JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));
    preset.name='Roleplay Instructions V10.432';
    preset.prompts.push({identifier:'review-relationships',name:'Internal States Template',role:'system',content:'HOST_REL_432',system_prompt:false});
    for(const order of preset.prompt_order)order.order.push({identifier:'review-relationships',enabled:true});
    const root=page.locator('#ri_root'), wb=root.locator('.ri-preset-workbench');
    const block=wb.locator('[data-preset-block="review-relationships"]');
    const click=locator=>locator.click();
    const open=async locator=>{if(!await locator.evaluate(el=>el.open))await click(locator.locator(':scope > summary'));};
    const pageTab=tab=>click(root.locator(`[data-ri-page="${tab}"]`));
    const pick=(locator,value)=>locator.evaluate((el,val)=>{el.value=val;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    const input=(locator,value)=>locator.evaluate((el,val)=>{el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
    const waitMessage=msg=>wb.locator(':scope > [role=status]').filter({hasText:msg}).waitFor({state:'attached',timeout:7000});
    try {
        await L.setupApi(page);
        await page.evaluate(data=>SillyTavern.getContext().getPresetManager('openai').savePreset(data.name,data),preset);
        await L.usePreset(page,preset.name);await L.setupApi(page,{preset:null});await L.openChat(page);
        if(!await page.locator('#ri_drawer').isVisible())await page.locator('#extensions-settings-button > .drawer-toggle').click();
        if(!await root.isVisible())await page.locator('#ri_drawer .inline-drawer-header').click();
        await click(root.locator('[data-ri-expand]'));await click(root.locator('[data-ri-group="setup"]'));
        await pageTab('v10');await open(wb);await open(block);
        const source=block.getByLabel('Instruction sources for relationships and Internal States Template',{exact:true});
        assert.equal(await source.inputValue(),'preset');
        await input(block.getByLabel('Preset instruction',{exact:true}),'HOST_EDIT_432');
        await click(block.getByRole('button',{name:'Save preset block',exact:true}));await waitMessage('Preset wording saved');
        assert.match(await block.locator(':scope > summary').textContent(),/Edited/);
        const order=()=>page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompt_order.find(g=>g.character_id===100001).order.map(e=>e.identifier));
        const before=await order();await click(block.getByRole('button',{name:'Move up',exact:true}));await waitMessage('Preset order saved');
        assert.equal((await order()).indexOf('review-relationships'),before.indexOf('review-relationships')-1);
        await L.setSettings(page,{check:{mode:'off'}});
        for(const mode of ['both','extension','none','preset']){
            await pick(source,mode);
            await page.waitForFunction(({mode})=>document.querySelector('[aria-label="Instruction sources for relationships and Internal States Template"]')?.value===mode && !document.querySelector('.ri-preset-workbench > div')?.inert,{mode});
            L.mode({reply:'Mira waits.'}); L.resetLog();await L.send(page,'I wait. '+mode);
            const request=L.text(L.requests()[0]);
            assert.equal(request.includes('HOST_EDIT_432'),['both','preset'].includes(mode),'host '+mode);
            assert.equal(request.includes('For a relationship use subject and other'),['both','extension'].includes(mode),'extension '+mode);
        }
        await click(block.getByRole('button',{name:'Restore before extension edits'}));await waitMessage('Before extension edits restored');
        assert.equal(await block.getByLabel('Preset instruction',{exact:true}).inputValue(),'HOST_REL_432');
        assert.deepEqual(await order(),before);
        const add=wb.locator('details').filter({has:page.getByText('Add a preset block',{exact:true})}).last();
        await open(add);await input(add.getByLabel('New block name'),'Live addition');await input(add.getByLabel('New instruction'),'ADDED_432');
        await click(add.getByRole('button',{name:'Add to end of preset'}));await waitMessage('Added an enabled');
        const added=wb.locator('details[data-preset-block]').filter({has:page.getByText('Live addition · On · Edited',{exact:true})});
        await open(added);await click(added.getByRole('button',{name:'Restore before extension edits'}));await waitMessage('Before extension edits restored');
        assert.equal(await added.count(),0);
        const compare=wb.locator('details').filter({has:page.getByText('Compare preset and extension with AI',{exact:true})}).last();
        await open(compare);
        L.resetLog();L.mode({reply:JSON.stringify([{id:'review-relationships',module:'roast',coverage:'partial',reason:'Fixture example.'}])});
        await click(compare.getByRole('button',{name:'Compare with one model call'}));await waitMessage('Comparison complete');
        assert.equal(L.requests().length,1);
        await click(compare.getByRole('button',{name:'Use this match'}));await open(block);
        assert.equal(await block.getByLabel('Instruction sources for roast and Internal States Template',{exact:true}).count(),1);
        const placement=block.locator('details').filter({has:page.getByText('Placement and generation triggers',{exact:true})}).last();
        await open(placement);await pick(placement.getByLabel('Prompt placement'),'absolute');
        await input(placement.getByLabel('Messages from the end'),'2');await input(placement.getByLabel('Priority at this depth'),'42');
        await placement.getByLabel('swipe',{exact:true}).check();
        await click(block.getByRole('button',{name:'Save preset block',exact:true}));await waitMessage('Preset wording saved');
        const saved=await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompts.find(p=>p.identifier==='review-relationships'));
        assert.equal(saved.injection_depth,2);assert.equal(saved.injection_order,42);assert.deepEqual(saved.injection_trigger,['swipe']);
        await click(block.getByRole('button',{name:'Restore before extension edits'}));await waitMessage('Before extension edits restored');
        const extOrder=wb.locator('details').filter({has:page.getByText('Extension instruction order',{exact:true})}).last();
        await open(extOrder);
        const colorSection=extOrder.locator(':scope > details').filter({has:page.getByText('Dialogue colors',{exact:true})});
        await open(colorSection);await click(colorSection.getByRole('button',{name:'Move earlier'}));
        await extOrder.getByText('Dialogue colors · Order changed',{exact:true}).waitFor({state:'attached'});
        L.resetLog();L.mode({reply:'Mira studies the compass.'});await L.send(page,'I take out the compass.');
        const reordered=L.text(L.requests()[0]);
        assert.ok(reordered.indexOf('Use ordinary quoted dialogue')>=0 && reordered.indexOf('Use ordinary quoted dialogue')<reordered.indexOf('Scene and character checks:'),'extension order changed the request');
        const moved=extOrder.locator(':scope > details').filter({has:page.getByText('Dialogue colors · Order changed',{exact:true})});
        await open(moved);await click(moved.getByRole('button',{name:'Restore module position'}));
        await pageTab('display');
        const voices=root.locator('details').filter({has:page.getByText('Roast commentator voice and feedback',{exact:true})}).last();
        await open(voices);const picker=voices.getByLabel('Commentator voice',{exact:true});
        const previousVoice=await picker.inputValue();await pick(picker,'voiceDetective');
        const voice=voices.locator('.ri-prompt-editor').first();await open(voice);await input(voice.locator('textarea'),'DETECTIVE_TEST_432');
        await click(voice.getByRole('button',{name:'Save instruction'}));
        assert.match(await picker.locator('option:checked').textContent(),/Customized/);
        await page.evaluate(async base=>{(await import(base+'/src/v10.js')).prefs().modules.roast=true;},L.BASE);
        L.resetLog();await L.send(page,'What happened?');assert.match(L.text(L.requests()[0]),/DETECTIVE_TEST_432/);
        await pageTab('display');await open(voices);await open(voice);await click(voice.getByRole('button',{name:'Restore default'}));
        assert.doesNotMatch(await picker.locator('option:checked').textContent(),/Customized/);
        await pick(picker,previousVoice);
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
                await L.usePreset(page,name);await pageTab('v10');
                await root.getByText('Active preset: '+name,{exact:true}).waitFor();await open(wb);
                await wb.locator('[data-preset-block]').first().waitFor({state:'attached'});
                const visibleIds=await wb.locator('[data-preset-block]').evaluateAll(rows=>rows.map(row=>row.dataset.presetBlock));
                const ids=new Set(reference.prompts.map(p=>p.identifier));
                const source=reference.prompt_order.find(g=>String(g.character_id)==='100001').order.map(e=>e.identifier).filter(id=>ids.has(id));
                assert.deepEqual(visibleIds.slice(0,source.length),source);
                for(const id of ids)assert(visibleIds.includes(id),id);
                console.log(path.basename(file)+': '+source.length+' ordered, '+ids.size+' supplied blocks accounted for.');
            }
        }
        assert.deepEqual(errors,[]);console.log('PASS: native order, text, all four combinations on the wire, add, per-block restore and a customized commentator in a real request.');
    }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
