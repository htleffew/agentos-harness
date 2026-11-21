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

        await composer.fill('I hold the original draft.');
        await composer.evaluate(input=>input.setSelectionRange(2,9,'backward'));
        await tap(page,'Quick actions');
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

        await page.evaluate(async base=>{
            const {setExecutionSetting}=await import(base+'/src/execution.js');
            setExecutionSetting('playerDraft',{profileId:'missing-ux-route'});
        },L.BASE);
        await tap(page,'Quick actions');
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
        assert.match(await panel.locator('.ri-body').innerText(),/selected version 1/);
        assert.equal(await panel.getByLabel('Regenerate the latest reply',{exact:true}).count(),0);
        await tap(panel,'Back to chat');
        await tap(first,'Generate an alternate reply');
        assert.match(await sheet.getByRole('heading').innerText(),/Generate an alternate reply/);
        await tap(sheet,'Close');
        await tap(first,'Correct story facts');
        await panel.getByLabel('Correct story fact',{exact:true}).fill('The keeper left a sealed letter.');
        const chat=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.evaluate(()=>SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
        await page.waitForFunction(()=>document.querySelector('#ri_root [aria-label="Correct story fact"]')?.value==='');
        assert.equal(await panel.getByLabel('Correct story fact',{exact:true}).inputValue(),'');
        assert.equal(await panel.getByLabel('Recovered correct story fact').count(),0);
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),chat);
        await panel.getByLabel('Recovered correct story fact').waitFor();
        assert.equal(await panel.getByLabel('Recovered correct story fact').inputValue(),'The keeper left a sealed letter.');
        evidence.push({case:'unsaved panel edit recovered only in its originating chat',requests:L.requests().length});
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        evidence.push({case:'direct older reply actions',target:2,version:1,requests:0});
        console.log('PASS phone-width task finder, return navigation, scoped receipt and correction, and composer ownership');
    } catch(error) {
        await page.screenshot({path:'/tmp/ri-extension-ux-failure.png'}).catch(()=>{});
        throw error;
    } finally {
        if (process.env.RI_UX_CAPTURE) fs.writeFileSync(process.env.RI_UX_CAPTURE,JSON.stringify({
            host:'SillyTavern 1.19.0',preset:process.env.RI_UX_PRESET || 'Default',viewport:[390,475],touch:true,evidence,errors,
        },null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
