// Real host, touch emulation, mock provider. Short viewport represents the keyboard-open layout.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:700,hasTouch:true,isMobile:true});
    const presetName=`Unrelated touch preset ${Date.now()}`;
    const tap=locator=>locator.tap();
    const toggle=async details=>{
        if (!await details.evaluate(element=>element.open)) await tap(details.locator(':scope > summary'));
    };
    try {
        await L.setupApi(page);
        const original=await page.evaluate(async name=>{
            const host=SillyTavern.getContext(), manager=host.getPresetManager('openai');
            const active=manager.getCompletionPresetByName(manager.getSelectedPresetName());
            const data={...structuredClone(active),name,impersonation_prompt:'Touch original for {{user}}',
                prompts:[...active.prompts,{identifier:'touch-proof',name:'Touch proof block',content:'Foreign original wording',role:'system'}],
                prompt_order:active.prompt_order.map(group=>({...group,order:[...group.order,{identifier:'touch-proof',enabled:true}]}))};
            const edited=structuredClone(data);
            edited.prompts.find(block=>block.identifier==='touch-proof').content='Pre-extension wording';
            edited.impersonation_prompt='Preset wording for {{user}}';
            await manager.savePreset(name,edited);
            return data;
        },presetName);
        await L.usePreset(page,presetName);
        await L.setupApi(page,{preset:null});
        await L.openChat(page);
        L.resetLog();
        const root=page.locator('#ri_root');
        if (!await page.locator('#ri_drawer').isVisible()) await tap(page.locator('#extensions-settings-button > .drawer-toggle'));
        if (!await root.isVisible()) await tap(page.locator('#ri_drawer .inline-drawer-header'));
        const expand=root.locator('[data-ri-expand]');
        if (await expand.isVisible()) await tap(expand);
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
        await upload.getByLabel('Original preset JSON').setInputFiles({name:'Unrelated-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original))});
        await wb.locator(':scope > [role=status]').filter({hasText:'Original preset file linked'}).waitFor();
        await tap(block.getByRole('button',{name:'Restore from original preset file'}));
        await wb.locator(':scope > [role=status]').filter({hasText:'Original file Unrelated-original.json restored'}).waitFor();
        assert.equal(await wording.inputValue(),'Foreign original wording');
        await toggle(block.locator('.ri-variations'));
        assert.deepEqual(await block.getByLabel('Saved variation').locator('option').allTextContents(),['Choose a saved variation','First','Second']);

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
        await tap(voice.getByRole('button',{name:'Restore first saved voice'}));
        assert.equal(await voiceText.inputValue(),'Use a clear first-person observation.');
        const transfer=voices.getByText('Import or export a voice',{exact:true}).locator('..');
        await toggle(transfer);
        const [download]=await Promise.all([page.waitForEvent('download'),tap(transfer.getByRole('button',{name:'Export selected voice'}))]);
        const file=await download.path();
        const voiceFile=JSON.parse(await fs.readFile(file,'utf8'));
        assert.deepEqual(voiceFile.variations.map(entry=>entry.name),['Wry','Earnest']);
        await transfer.getByLabel('Import voice JSON').setInputFiles({name:'Court-chronicler.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(voiceFile))});
        await voices.getByText('Voice and variations imported.').waitFor();
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        console.log('PASS: touch preset variations, order, undo, original sources, blank field, utility default and voice transfer. 0 model requests. 390 × 490 emulated keyboard-open viewport.');
    } catch (error) {
        await page.screenshot({path:'/tmp/ri-dispatch-touch-failure.png'}).catch(()=>{});
        throw error;
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
