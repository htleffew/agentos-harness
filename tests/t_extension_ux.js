const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:475,hasTouch:true,isMobile:true});
    const panel=page.locator('#ri_root');
    const sheet=page.locator('.ri-quick-sheet');
    const composer=page.locator('#send_textarea');
    const tap=(root,name)=>root.getByRole('button',{name,exact:true}).tap();
    const title=()=>panel.locator('[data-ri-heading]').innerText();
    const evidence=[];
    try {
        await L.setupApi(page,{legacyAutomation:false});
        if (process.env.RI_UX_PRESET) await L.usePreset(page,process.env.RI_UX_PRESET);
        await L.openChat(page);
        await page.evaluate(async base=>{
            const {settings,saveSettings}=await import(base+'/src/store.js');
            const {refreshComposerToolbar}=await import(base+'/src/ui/quick-actions.js');
            delete settings().quickToolbarShortcuts;
            delete settings().quickToolbarHiddenFamilies;
            saveSettings();
            refreshComposerToolbar();
        },L.BASE);
        L.mode({reply:'The keeper opens the eastern gate.'});
        await L.send(page,'I wait beside the gate.');
        L.mode({reply:'The keeper holds the lantern above the steps.'});
        await L.send(page,'I look toward the steps.');
        await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        if (!await panel.isVisible()) await page.locator('#ri_drawer .inline-drawer-header').tap();
        await tap(panel,'Expand');
        assert.equal(await title(),'Current State');

        L.resetLog();
        await panel.getByText('Find a tool',{exact:true}).tap();
        const finder=panel.getByRole('searchbox',{name:'Find a tool'});
        for (const [query,result] of [['fix a fact','Corrections · Story'],['Roast','Reply Display · Setup'],
            ['lorebook','Reusable Lorebooks · Story'],['connection','Settings · Setup']]) {
            await finder.fill(query);
            await panel.getByRole('button',{name:result,exact:true}).waitFor();
        }
        await finder.fill('fix a fact');
        await tap(panel,'Corrections · Story');
        assert.equal(await title(),'Corrections');
        await tap(panel,'Back');
        assert.equal(await title(),'Current State');
        assert.equal(await finder.inputValue(),'fix a fact');
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Corrections · Story');
        await finder.fill('swipe');
        await tap(panel,'Generate an alternate reply · Chat');
        await sheet.getByRole('heading',{name:'Generate an alternate reply'}).waitFor();
        await tap(sheet,'Close');
        await panel.locator('[data-ri-heading]').waitFor();
        assert.equal(await title(),'Current State');
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Generate an alternate reply · Chat');
        evidence.push({case:'tool search and return',requests:L.requests().length,destinations:['Corrections','Reply Display','Reusable Lorebooks','Settings']});
        await tap(panel,'Close full screen');
        const drawer=page.locator('#extensions-settings-button > .drawer-content.openDrawer');
        if (await drawer.count()) await page.locator('#extensions-settings-button > .drawer-toggle').tap();

        const toolbar=page.locator('#ri_quick_toolbar_actions');
        const entry=page.getByRole('button',{name:'Quick actions',exact:true});
        const draftSelection=()=>composer.evaluate(input=>[document.activeElement===input,input.selectionStart,input.selectionEnd,input.selectionDirection]);
        const layout=()=>toolbar.evaluate(strip=>{
            const form=document.querySelector('#send_form').getBoundingClientRect();
            const input=document.getElementById('send_textarea');
            const send=document.getElementById('send_but');
            const {x,y,width,height}=send.getBoundingClientRect();
            const toolbar=strip.getBoundingClientRect();
            const launcher=document.querySelector('.ri-quick-entry');
            const controls=[launcher,...strip.querySelectorAll('button')].filter(button=>button.getClientRects().length);
            return {above:!toolbar.height || toolbar.bottom<=form.top,composerWidth:input.getBoundingClientRect().width,
                height:toolbar.height,inline:launcher.closest('#send_form')?.id==='send_form',
                sendReachable:send.contains(document.elementFromPoint(x+width/2,y+height/2)),
                fits:controls.every(button=>button.scrollWidth<=button.clientWidth+1),
                targets:controls.map(button=>[button.offsetWidth,button.offsetHeight])};
        });
        if (await entry.getAttribute('aria-expanded')==='true') await entry.tap();
        const multiline='I watch the gate.\nThe guard raises the lantern.\nI stay in the shadows.';
        for (const width of [320,390]) {
            await page.setViewportSize({width,height:475});
            await composer.fill(multiline);
            await composer.evaluate(input=>input.setSelectionRange(2,9,'backward'));
            assert.equal(await entry.getAttribute('aria-expanded'),'false');
            const collapsed=await layout();
            await entry.tap();
            assert.equal(await entry.getAttribute('aria-expanded'),'true');
            assert.deepEqual(await draftSelection(),[true,2,9,'backward']);
            const expanded=await layout();
            for (const [state,size] of [['collapsed',collapsed],['expanded',expanded]]) {
                assert.equal(size.composerWidth,collapsed.composerWidth,`${state} at ${width} px`);
                assert.ok(size.inline);
                assert.ok(size.above && size.sendReachable && size.fits,`${state} controls at ${width} px`);
                assert.ok(size.targets.every(([w,h])=>w>=44 && h>=44),`${state} touch targets at ${width} px`);
            }
            assert.deepEqual([collapsed.targets.length,expanded.targets.length],[1,4]);
            assert.equal(collapsed.height,0);
            assert.ok(expanded.height<=45);
            for (const label of ['Steer the next reply','Draft my reply']) {
                await tap(toolbar,label);
                assert.equal(await sheet.getByRole('heading').innerText(),label);
                const editor=sheet.getByRole('textbox',{name:'Your direction',exact:true});
                assert.equal(await editor.evaluate(input=>document.activeElement===input),true);
                await page.keyboard.type('A direction for the editor.');
                assert.equal(await composer.inputValue(),multiline);
                await editor.fill('');
                if (label==='Draft my reply') {
                    const costs=sheet.locator('summary').filter({hasText:'Draft and choice costs'});
                    assert.ok(await costs.evaluate(node=>{
                        const {x,y,width,height}=node.getBoundingClientRect();
                        return node.contains(document.elementFromPoint(x+width/2,y+height/2));
                    }),'Costs are reachable from the first draft view');
                    await costs.tap();
                    const preview=costs.locator('..');
                    await preview.getByText('Give me choices',{exact:true}).waitFor();
                    await preview.getByText(/Using the wording in the composer takes no model call/).waitFor();
                    await costs.tap();
                }
                await tap(sheet,'Close');
                assert.deepEqual(await draftSelection(),[true,2,9,'backward']);
            }
            await entry.tap();
            assert.equal(await composer.inputValue(),multiline);
            assert.deepEqual(await draftSelection(),[true,2,9,'backward']);
            evidence.push({case:'expand, open shortcuts and collapse with a focused multiline composer',viewport:[width,475],collapsed,expanded,requests:L.requests().length});
        }
        await page.setViewportSize({width:320,height:475});
        await toolbar.evaluate(strip=>{strip.style.fontSize='200%';});
        await entry.focus();
        await entry.press('Enter');
        assert.equal(await entry.getAttribute('aria-expanded'),'true');
        const large=await layout();
        assert.ok(large.sendReachable && large.fits && large.above,'Toolbar at 200% text');
        await entry.press('Space');
        assert.equal(await entry.getAttribute('aria-expanded'),'false');
        await toolbar.evaluate(strip=>strip.style.removeProperty('font-size'));
        evidence.push({case:'keyboard toggle at 200% text',viewport:[320,475],expanded:large,requests:L.requests().length});

        await composer.focus();
        await L.openQuickActions(page);
        const customize=sheet.getByRole('button',{name:'Customize quick actions',exact:true});
        assert.ok(await customize.evaluate(node=>{
            const {x,y,width,height}=node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(x+width/2,y+height/2));
        }),'Library management is tappable from the first view of More actions');
        await tap(sheet,'Browse directions');
        await sheet.getByRole('searchbox',{name:'Search quick actions'}).fill('forest');
        await tap(sheet,'Manage quick actions');
        assert.equal(await title(),'Preset & Extension');
        const library=panel.locator('#ri-composer-library');
        await library.getByLabel('Find a button to manage').waitFor();
        await panel.getByLabel('Composer shortcut 1').selectOption('continue');
        await tap(panel,'Back to Quick actions');
        assert.equal(await sheet.getByRole('heading').first().innerText(),'Browse directions');
        assert.equal(await sheet.getByRole('searchbox',{name:'Search quick actions'}).inputValue(),'forest');
        await tap(sheet,'Close');
        assert.deepEqual(await draftSelection(),[true,2,9,'backward']);
        await tap(toolbar,'Continue this reply');
        await sheet.getByRole('heading',{name:'Continue this reply',exact:true}).waitFor();
        await tap(sheet,'Close');
        assert.equal(L.requests().length,0);
        evidence.push({case:'library management initial reach and Browse directions return',viewport:[320,475],requests:0});
        await page.setViewportSize({width:390,height:475});

        await composer.fill('I hold the original draft.');
        await composer.evaluate(input=>input.setSelectionRange(2,9,'backward'));
        await L.openQuickActions(page);
        assert.equal(await sheet.getByRole('button',{name:'Close',exact:true}).evaluate(node=>document.activeElement===node),true);
        await sheet.getByText('Review and settings',{exact:true}).tap();
        await tap(sheet,'Context & Memory');
        await panel.locator('#ri-memory-status').waitFor();
        assert.equal(await title(),'Context & Memory');
        await tap(panel,'Back to Quick actions');
        await sheet.getByRole('heading',{name:'Quick actions'}).waitFor();
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Context & Memory');
        await tap(sheet,'Close');
        assert.equal(await composer.inputValue(),'I hold the original draft.');
        assert.deepEqual(await composer.evaluate(input=>[input.selectionStart,input.selectionEnd,input.selectionDirection]),[2,9,'backward']);
        evidence.push({case:'chat to memory and return',requests:L.requests().length,selection:[2,9,'backward']});

        await L.openQuickActions(page);
        await tap(sheet,'Steer the next reply');
        const direction=sheet.getByRole('textbox',{name:'Your direction'});
        assert.equal(await direction.evaluate(node=>document.elementFromPoint(node.getBoundingClientRect().left+5,
            node.getBoundingClientRect().top+5)===node),true,'Freeform input is visible before scrolling past saved directions');
        await direction.fill('Keep the next reply away from the gate.');
        await tap(sheet,'Queue with my next message');
        const queued=sheet.locator('.ri-quick-footer').getByRole('status');
        assert.equal(await queued.innerText(),'Queued with your next player message.');
        assert.equal(await queued.evaluate(node=>node.getBoundingClientRect().bottom<=visualViewport.height),true);
        assert.equal(L.requests().length,0);
        await tap(sheet,'Undo queue');
        assert.equal(await queued.innerText(),'Direction removed.');
        await tap(sheet,'Close');
        assert.equal(await composer.inputValue(),'I hold the original draft.');
        evidence.push({case:'visible freeform direction, queue confirmation and Undo',requests:0});

        await page.evaluate(async base=>{
            const {setExecutionSetting}=await import(base+'/src/execution.js');
            setExecutionSetting('playerDraft',{profileId:'missing-ux-route'});
        },L.BASE);
        await L.openQuickActions(page);
        await tap(sheet,'Draft my reply');
        await sheet.getByLabel('Your direction').fill('Keep the original question.');
        const blocked=sheet.getByRole('status').filter({hasText:/saved connection profile.*unavailable/i});
        await blocked.locator('..').getByRole('button',{name:'Connection settings'}).tap();
        assert.equal(await title(),'Settings');
        const connection=panel.getByRole('combobox',{name:'Generate my draft connection'});
        assert.equal(await connection.inputValue(),'missing-ux-route');
        await connection.selectOption('');
        await tap(panel,'Back to Quick actions');
        assert.equal(await sheet.getByLabel('Your direction').inputValue(),'Keep the original question.');
        assert.equal(L.requests().length,0);
        await tap(sheet,'Close');
        evidence.push({case:'blocked function settings and return',operation:'playerDraft',requests:0});

        const first=page.locator('#chat .mes[mesid="2"]');
        await tap(first,'Review this reply');
        assert.equal(await title(),'What Was Sent');
        const receipt=panel.locator('#ri-review-reply-2');
        assert.equal(await receipt.evaluate(node=>node.open),true);
        assert.match(await receipt.locator('summary').first().innerText(),/Reply 1[\s\S]*Version 1/i);
        await tap(panel,'Back to chat');
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Review this reply');
        await tap(first,'Correct story facts');
        assert.equal(await title(),'Corrections');
        assert.match(await panel.locator('#ri-correction-target').innerText(),/Reply 1[\s\S]*selected version 1/);
        assert.equal(await panel.getByLabel('Regenerate the latest reply',{exact:true}).count(),0);
        const fact='The eastern gate stayed closed.';
        await panel.getByLabel('Correct story fact',{exact:true}).fill(fact);
        await tap(panel,'Apply correction');
        const saved=panel.getByText(fact,{exact:true});
        await saved.tap();
        await tap(saved.locator('..'),'Review reply 1');
        assert.equal(await receipt.evaluate(node=>node.open),true);
        await tap(panel,'Back');
        assert.equal(await title(),'Corrections');
        const prose=panel.getByText('Read the selected reply',{exact:true});
        await prose.tap();
        assert.match(await prose.locator('..').innerText(),/The keeper opens the eastern gate/);
        await tap(panel,'Back to chat');
        const replyOrigin=first.getByRole('button',{name:'Correct story facts',exact:true});
        assert.equal(await replyOrigin.evaluate(node=>{
            const {left,top,width,height}=node.getBoundingClientRect();
            return node.contains(document.elementFromPoint(left+width/2,top+height/2));
        }),true);
        await tap(first,'Generate an alternate reply');
        assert.match(await sheet.getByRole('heading').innerText(),/Generate an alternate reply/);
        await tap(sheet,'Close');
        await tap(first,'Correct story facts');
        await panel.getByLabel('Correct story fact',{exact:true}).fill('The keeper left a sealed letter.');
        const chat=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.evaluate(()=>SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
        await page.waitForFunction(()=>document.querySelector('#ri_root [aria-label="Correct story fact"]')?.value==='');
        const otherChat=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        assert.equal(await panel.getByLabel('Correct story fact',{exact:true}).inputValue(),'');
        assert.equal(await panel.getByLabel('Recovered correct story fact').count(),0);
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),chat);
        await panel.getByLabel('Recovered correct story fact').waitFor();
        assert.equal(await panel.getByLabel('Recovered correct story fact').inputValue(),'The keeper left a sealed letter.');
        await panel.getByLabel('Correct story fact',{exact:true}).fill('The lantern was already lit.');
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),otherChat);
        await panel.getByLabel('Recovered correct story fact').waitFor({state:'detached'});
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),chat);
        const recovered=panel.getByLabel('Recovered correct story fact');
        await recovered.first().waitFor();
        assert.deepEqual(await recovered.evaluateAll(inputs=>inputs.map(input=>input.value)),[
            'The lantern was already lit.','The keeper left a sealed letter.',
        ]);
        const newest=panel.getByText('Unsaved work from Corrections (1 of 2)',{exact:true}).locator('..');
        await tap(newest,'Dismiss recovered draft');
        assert.equal(await recovered.inputValue(),'The keeper left a sealed letter.');
        evidence.push({case:'independent unsaved edits recovered only in their originating chat',drafts:2,requests:L.requests().length});
        await tap(panel,'Close full screen');
        if (await drawer.count()) await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        for (const expanded of [false,true]) {
            const saved=page.waitForResponse(response=>response.url().endsWith('/api/settings/save') && response.ok() &&
                response.request().postDataJSON()?.extension_settings?.roleplay_instructions?.quickToolbarExpanded===expanded);
            await entry.tap();
            await saved;
            await page.reload();
            await page.waitForFunction(()=>globalThis.SillyTavern?.getContext()?.characters?.length>0);
            await L.openChat(page,{fresh:false});
            assert.equal(await entry.getAttribute('aria-expanded'),String(expanded));
        }
        evidence.push({case:'restore collapsed and expanded preferences on reload',requests:L.requests().length});
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        evidence.push({case:'direct older reply actions',target:2,version:1,requests:0});
        console.log('PASS phone-width collapsible toolbar, stable composer width, saved preference, task finder, exact reply and draft recovery');
    } catch(error) {
        await page.screenshot({path:'/tmp/ri-extension-ux-failure.png'}).catch(()=>{});
        throw error;
    } finally {
        if (process.env.RI_UX_CAPTURE) fs.writeFileSync(process.env.RI_UX_CAPTURE,JSON.stringify({
            host:'SillyTavern 1.19.x',preset:process.env.RI_UX_PRESET || 'Default',viewport:[390,475],touch:true,evidence,errors,
        },null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
