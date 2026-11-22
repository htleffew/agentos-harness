// Real host, touch emulation, mock provider. Short viewport represents the keyboard-open layout.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const L = require('./lib.js');
const { setupApi: reconnectMain } = require('./h.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:700,hasTouch:true,isMobile:true});
    const fixture=Date.now();
    const presetName=`Unrelated touch preset ${fixture}`;
    const instructionSet=`Writer touch set ${fixture}`;
    const writerFirst=`First writer version ${fixture}`, writerSecond=`Second writer version ${fixture}`;
    const writerImported=`Imported writer version ${fixture}`;
    const tap=locator=>locator.tap();
    const toggle=async details=>{
        if (!await details.evaluate(element=>element.open)) await tap(details.locator(':scope > summary'));
    };
    const chooseFile=async(control,file)=>{
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),tap(control)]);
        await chooser.setFiles(file);
    };
    const root=page.locator('#ri_root');
    const openPanel=async()=>{
        await L.openQuickActions(page);
        await tap(page.locator('.ri-quick-sheet').getByRole('button',{name:'Edit preset prompts',exact:true}));
        await root.waitFor();
    };
    const openWriter=async()=>{
        await tap(root.locator('[data-ri-group="direction"]'));
        await tap(root.locator('[data-ri-page="instructions"]'));
        await tap(root.getByRole('button',{name:instructionSet,exact:true}));
        await tap(root.getByRole('button',{name:'Talk through the plan',exact:true}));
        await tap(root.getByRole('button',{name:'Write versions with AI',exact:true}));
        const prompts=root.locator('.ri-sheet .ri-prompt-group').filter({hasText:'Customize Write with AI prompts'});
        await toggle(prompts);
        const writing=prompts.locator('.ri-prompt-editor').filter({hasText:'Writing instruction versions'});
        await toggle(writing);
        await toggle(writing.locator('.ri-variations'));
        return writing;
    };
    try {
        await L.setupApi(page);
        const original=await page.evaluate(async name=>{
            const host=SillyTavern.getContext(), manager=host.getPresetManager('openai');
            const active=manager.getCompletionPresetByName(manager.getSelectedPresetName());
            const fixtureBlocks=[{identifier:'touch-proof',name:'Touch proof block',content:'Foreign original wording',role:'system'},
                {identifier:'touch-neighbor',name:'Touch neighboring block',content:'Neighbor original wording',role:'system'}];
            const data={...structuredClone(active),name,impersonation_prompt:'Touch original for {{user}}',
                prompts:[...active.prompts,...fixtureBlocks],
                prompt_order:active.prompt_order.map(group=>({...group,order:[...group.order,...fixtureBlocks.map(block=>({identifier:block.identifier,enabled:true}))]}))};
            const edited=structuredClone(data);
            edited.prompts.find(block=>block.identifier==='touch-proof').content='Pre-extension wording';
            edited.impersonation_prompt='Preset wording for {{user}}';
            await manager.savePreset(name,edited);
            return data;
        },presetName);
        await L.usePreset(page,presetName);
        await L.setupApi(page,{preset:null,legacyAutomation:false});
        await L.openChat(page);
        await L.makeSet(page,instructionSet,[{name:'Talk through the plan',versions:['E32']}],{activate:false});
        await page.evaluate(async base=>{
            const v10=await import(`${base}/src/v10.js`), store=await import(`${base}/src/store.js`);
            (await import(`${base}/src/prompts.js`)).restorePrompt('versionRules');
            const prefs=v10.prefs();
            prefs.enabled=true;
            prefs.modules={...prefs.modules,roast:true,roastFeedback:true};
            store.settings().roastVoiceId='roastVoice';
            store.saveChatState(); store.saveSettings();
        },L.BASE);
        const priorRoast='The first fixture reaction stays in its own card.';
        const roastReply=(prose,roast)=>`${prose}\n<story_update v="2">${JSON.stringify({v:2,roast})}</story_update>`;
        L.mode({reply:roastReply('Mira tests the lock.',priorRoast)});
        await L.send(page,'I show Mira the brass key.');
        await page.locator('#chat .ri-reply-roast').filter({hasText:priorRoast}).waitFor();
        L.resetLog();
        await openPanel();
        await tap(root.locator('[data-ri-group="setup"]'));
        await tap(root.locator('[data-ri-page="v10"]'));

        const wb=root.locator('.ri-preset-workbench');
        const block=wb.locator('[data-preset-block="touch-proof"]');
        await toggle(wb);
        await toggle(block);
        const wording=block.getByLabel('Preset instruction',{exact:true});
        await tap(wording);
        await page.setViewportSize({width:390,height:490});
        await wording.fill('Variant wording with {{char}}');
        let variants=block.locator('.ri-variations');
        await toggle(variants);
        await variants.getByLabel('Variation name',{exact:true}).fill('First');
        await tap(variants.getByRole('button',{name:'Save draft as variation'}));
        await wording.fill('Second variant');
        await variants.getByLabel('Variation name',{exact:true}).fill('Second');
        await tap(variants.getByRole('button',{name:'Save draft as variation'}));
        await tap(block.getByRole('button',{name:'Discard draft'}));
        await toggle(block);
        await tap(block.getByRole('button',{name:'Move up',exact:true}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Preset order saved'}).waitFor();
        const neighbor=wb.locator('[data-preset-block="touch-neighbor"]');
        await toggle(neighbor);
        await neighbor.getByLabel('Preset instruction',{exact:true}).fill('Neighbor edited independently.');
        await tap(neighbor.getByRole('button',{name:'Save preset block',exact:true}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Preset wording saved'}).waitFor();
        await toggle(block);
        variants=block.locator('.ri-variations');
        await toggle(variants);
        const variant=variants.getByLabel('Saved variation');
        await variant.selectOption({label:'First'});
        await tap(variants.getByRole('button',{name:`Apply to ${presetName}`}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Preset variation applied'}).waitFor();
        assert.equal(await wording.inputValue(),'Variant wording with {{char}}');
        await tap(block.getByRole('button',{name:'Restore before extension edits'}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Before extension edits restored'}).waitFor();
        assert.equal(await wording.inputValue(),'Pre-extension wording');
        await tap(block.getByRole('button',{name:'Undo restore'}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Previous preset block restored'}).waitFor();
        assert.equal(await wording.inputValue(),'Variant wording with {{char}}');

        const upload=wb.getByText('Attach an original preset file',{exact:true}).locator('..');
        await toggle(upload);
        await chooseFile(upload.getByRole('button',{name:'Choose original preset JSON'}),{name:'Unrelated-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
        await wb.locator(':scope > [role=status]').filter({hasText:'Original preset file linked'}).waitFor();
        await tap(block.getByRole('button',{name:'Restore from original preset file'}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Original file Unrelated-original.json restored'}).waitFor();
        assert.equal(await wording.inputValue(),'Foreign original wording');
        await toggle(block.locator('.ri-variations'));
        assert.deepEqual(await block.getByLabel('Saved variation').locator('option').allTextContents(),['Choose a saved variation','First','Second']);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.prompts.find(item=>item.identifier==='touch-neighbor').content),'Neighbor edited independently.');

        const inspection=root.locator('.ri-impersonation');
        await toggle(inspection);
        assert.match(await inspection.textContent(),/Preset wording for \{\{user\}\}/);
        const shared=inspection.getByText(`Edit shared preset ${presetName}`,{exact:true}).locator('..');
        await toggle(shared);
        const playerText=shared.getByLabel('Shared impersonation instruction',{exact:true});
        await tap(playerText);
        await playerText.fill('');
        await tap(shared.getByRole('button',{name:'Save shared impersonation prompt'}));
        await shared.getByText('Saved in the active host preset.').waitFor();
        assert.match(await inspection.locator(':scope > summary').textContent(),/Blank host field/);
        await tap(shared.getByRole('button',{name:'Restore from original preset file'}));
        await shared.getByText('Original file Unrelated-original.json restored.').waitFor();
        assert.equal(await playerText.inputValue(),'Touch original for {{user}}');
        await tap(shared.getByRole('button',{name:'Undo restore'}));
        assert.equal(await playerText.inputValue(),'');
        const utility=shared.getByRole('button',{name:'Load host utility default into draft'});
        if (await utility.count()) {
            await tap(utility);
            assert.notEqual(await playerText.inputValue(),'Touch original for {{user}}');
            assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatCompletionSettings.impersonation_prompt),'');
        }

        const dirty=await playerText.inputValue()!=='';
        await tap(root.locator('[data-ri-page="display"]'));
        if (dirty) {
            await page.getByText('Discard your unsaved changes?',{exact:true}).waitFor();
            await tap(page.getByRole('button',{name:'Yes',exact:true}));
        }
        const voices=root.getByText('Roast commentator voice and feedback',{exact:true}).locator('..');
        await toggle(voices);
        const newVoice=voices.getByText('New commentator voice',{exact:true}).locator('..');
        await toggle(newVoice);
        await newVoice.getByLabel('New commentator voice name').fill('Court chronicler');
        await newVoice.getByLabel('New commentator voice direction').fill('Use a clear first-person observation.');
        await tap(newVoice.getByRole('button',{name:'Save new voice'}));
        const voice=voices.locator('.ri-prompt-editor').first();
        await toggle(voice);
        const voiceText=voice.locator('textarea');
        const voiceVariants=voice.locator('.ri-variations');
        await toggle(voiceVariants);
        await voiceText.fill('Offer wry commentary.');
        await voiceVariants.getByLabel('Variation name',{exact:true}).fill('Wry');
        await tap(voiceVariants.getByRole('button',{name:'Save draft as variation'}));
        await voiceText.fill('Offer an earnest observation.');
        await voiceVariants.getByLabel('Variation name',{exact:true}).fill('Earnest');
        await tap(voiceVariants.getByRole('button',{name:'Save draft as variation'}));
        await tap(voiceVariants.getByRole('button',{name:'Apply variation',exact:true}));
        assert.equal(await voiceText.inputValue(),'Offer an earnest observation.');
        await voiceText.fill('Offer an earnest observation with one example.');
        await tap(voice.getByRole('button',{name:'Save instruction',exact:true}));
        await tap(voice.getByRole('button',{name:'Restore first saved voice'}));
        assert.equal(await voiceText.inputValue(),'Use a clear first-person observation.');
        const voiceSelect=voices.getByRole('combobox',{name:'Commentator voice',exact:true});
        const customId=await voiceSelect.inputValue();
        await voiceSelect.selectOption('roastVoice');
        assert.match(await voiceSelect.locator('option:checked').textContent(),/Gremlin/);
        await voiceSelect.selectOption(customId);
        const transfer=voices.getByText('Import or export a voice',{exact:true}).locator('..');
        await toggle(transfer);
        const [download]=await Promise.all([page.waitForEvent('download'),tap(transfer.getByRole('button',{name:'Export selected voice'}))]);
        const file=await download.path();
        const voiceFile=JSON.parse(await fs.readFile(file,'utf8'));
        assert.deepEqual(voiceFile.variations.map(entry=>entry.name),['Wry','Earnest']);
        await chooseFile(transfer.getByRole('button',{name:'Choose voice JSON'}),{name:'Court-chronicler.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(voiceFile))});
        await voices.getByText('Voice and variations imported.').waitFor();
        assert.notEqual(await voiceSelect.inputValue(),customId);
        assert.equal(L.requests().length,0);

        let writing=await openWriter();
        const originalWriting=await writing.locator('textarea').inputValue();
        const writerVariants=()=>writing.locator('.ri-variations');
        for (const [variantName,current] of [[writerFirst,'First writing direction for {{char}}.'],[writerSecond,'Second writing direction for {{user}}.']]) {
            await writing.locator('textarea').fill(current);
            await writerVariants().getByLabel('Variation name',{exact:true}).fill(variantName);
            await tap(writerVariants().getByRole('button',{name:'Save draft as variation'}));
        }
        await writerVariants().getByLabel('Saved variation').selectOption({label:writerFirst});
        const [writerDownload]=await Promise.all([page.waitForEvent('download'),tap(writerVariants().getByRole('button',{name:'Export variation',exact:true}))]);
        const writerFile=JSON.parse(await fs.readFile(await writerDownload.path(),'utf8'));
        assert.match(writerFile.value,/First writing direction for \{\{char\}\}/);
        const importVariation=writerVariants().getByText('Import variation',{exact:true}).locator('..');
        await toggle(importVariation);
        await chooseFile(importVariation.getByRole('button',{name:'Choose variation JSON'}),{name:'Writer variation.json',mimeType:'application/json',
            buffer:Buffer.from(JSON.stringify({...writerFile,name:writerImported}))});
        await writerVariants().getByText('Variation imported.',{exact:true}).waitFor();
        await writerVariants().getByLabel('Saved variation').selectOption({label:writerFirst});
        await tap(writerVariants().getByRole('button',{name:'Apply variation',exact:true}));
        assert.match(await writing.locator('textarea').inputValue(),/First writing direction for \{\{char\}\}/);
        await tap(writing.getByRole('button',{name:'Restore default',exact:true}));
        assert.equal(await writing.locator('textarea').inputValue(),originalWriting);
        await tap(writing.getByRole('button',{name:'Undo restore',exact:true}));
        const chatId=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForFunction(()=>SillyTavern?.getContext()?.extensionSettings?.roleplay_instructions?.promptVariations);
        await reconnectMain(page);
        await tap(page.locator('.recentChat').filter({hasText:chatId}).first());
        await page.waitForFunction(id=>SillyTavern.getContext().getCurrentChatId()===id,chatId);
        await openPanel();
        writing=await openWriter();
        const names=await writerVariants().getByLabel('Saved variation').locator('option').allTextContents();
        assert(names.includes(writerFirst) && names.includes(writerSecond) && names.includes(writerImported));
        assert.match(await writing.locator('textarea').inputValue(),/First writing direction for \{\{char\}\}/);
        await tap(root.locator('[data-ri-group="setup"]'));
        await tap(root.locator('[data-ri-page="v10"]'));
        await toggle(wb);
        await toggle(block);
        assert.equal(await wording.inputValue(),'Foreign original wording');
        await toggle(block.locator('.ri-variations'));
        assert.deepEqual(await block.getByLabel('Saved variation').locator('option').allTextContents(),['Choose a saved variation','First','Second']);
        assert.equal(L.requests().length,0);

        const closePanel=root.getByRole('button',{name:'Close full screen',exact:true});
        if (await closePanel.isVisible()) await tap(closePanel);
        await tap(page.locator('.ri-quick-sheet').getByRole('button',{name:'Close',exact:true}));
        const futureRoast='The second fixture reaction sees a different beat.';
        L.mode({reply:roastReply('Mira turns the key.',futureRoast)});
        await L.send(page,'I ask Mira to turn the key.');
        const wire=L.requests();
        assert.equal(wire.length,1);
        assert.equal(L.text(wire[0]).split('Use a clear first-person observation.').length-1,1);
        assert.match(L.text(wire[0]),/Include this string even when no story facts changed/);
        await page.locator('#chat .ri-reply-roast').filter({hasText:priorRoast}).waitFor();
        const future=page.locator('#chat .ri-reply-roast').filter({hasText:futureRoast});
        await future.waitFor();
        await toggle(future);
        await toggle(future.locator('.ri-execution'));
        assert.match(await future.innerText(),/Uses the reply request[\s\S]*0 additional model calls/);
        const modules=await page.evaluate(async base=>(await import(`${base}/src/v10.js`)).effectiveModules(),L.BASE);
        assert.equal(modules.roastFeedback,true);
        if (process.env.RI_VARIATION_CAPTURE) await fs.writeFile(process.env.RI_VARIATION_CAPTURE,JSON.stringify({
            id:'E-32-34-TOUCH',viewport:[390,490],preset:presetName,editorRequests:0,futureRequests:wire.length,
            roastPrompt:wire[0].messages.find(message=>String(message.content).includes('Use a clear first-person observation.'))?.content,
            priorRoast,futureRoast,roastFeedback:modules.roastFeedback,voices:voiceFile.variations.map(({name})=>name),
        },null,2)+'\n');
        assert.deepEqual(errors,[]);
        console.log('PASS: touch preset and writer variations, order, neighbor edit, undo, source restore, field inspection, voice transfer, and ordinary reply using the imported voice. Editor actions made zero model requests.');
    } catch (error) {
        await page.screenshot({path:'/tmp/ri-dispatch-touch-failure.png'}).catch(()=>{});
        throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
