// Older reply actions, exact receipts, corrections and per-chat draft recovery on a phone-width touch host.
// Retired with the UI they drove: the collapsible toolbar and its saved preference (B1's composer bar, covered by
// t_composer_bar.js), Find a tool (B5's search, t_menu_shell.js), the quick sheet's memory return, direction queue and
// blocked-connection return (B2's queue sheet and B1's failure state, t_results_sheet.js and t_composer_bar.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:475,hasTouch:true,isMobile:true});
    const panel=page.locator('#ri_root');
    const sheet=page.locator('.ri-quick-sheet');
    const composer=page.locator('#send_textarea');
    const tap=(root,name)=>L.panelClick(root,name);
    // B5's heading names the nested tab; the page id says which page of it is open.
    const title=()=>panel.locator('#ri_panel_page').getAttribute('data-page');
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
        await tap(panel,'Full screen');
        const drawer=page.locator('#extensions-settings-button > .drawer-content.openDrawer');
        L.resetLog();
        await tap(panel,'Close full screen');
        if (await drawer.count()) await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        const first=page.locator('#chat .mes[mesid="2"]');
        await tap(first,'Review this reply');
        assert.equal(await title(),'sent');
        const receipt=panel.locator('#ri-review-reply-2');
        assert.equal(await receipt.evaluate(node=>node.open),true);
        assert.match(await receipt.locator('summary').first().innerText(),/Reply 1[\s\S]*Version 1/i);
        await tap(panel,'Back to chat');
        assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'Review this reply');
        await tap(first,'Correct story facts');
        assert.equal(await title(),'corrections');
        assert.match(await panel.locator('#ri-correction-target').innerText(),/Reply 1[\s\S]*selected version 1/);
        assert.equal(await panel.getByLabel('Regenerate the latest reply',{exact:true}).count(),0);
        const fact='The eastern gate stayed closed.';
        await panel.getByLabel('Correct story fact',{exact:true}).fill(fact);
        await tap(panel,'Apply correction');
        const saved=panel.getByText(fact,{exact:true});
        await saved.tap();
        await tap(saved.locator('..'),'Review reply 1');
        assert.equal(await receipt.evaluate(node=>node.open),true);
        await panel.locator('[data-ri-back]').first().tap(); // B5's one Back names its destination
        assert.equal(await title(),'corrections');
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
        // On a chat change B5's shell returns to the last page reached through the tabs, so the test opens
        // Correct story facts again in each chat, as a player would from that chat's reply.
        const corrections=async()=>{
            await page.waitForTimeout(1200);
            // Not awaited: a page with unsaved edits asks before it is left, and that question must not hang the test.
            await page.evaluate(async B=>{const {app}=await import(`${B}/src/ui/panel.js`);app.openPage('corrections',{focusPage:true});},L.BASE);
            await page.waitForTimeout(400);
        };
        await page.evaluate(()=>SillyTavern.getContext().executeSlashCommandsWithOptions('/newchat'));
        await corrections();
        const otherChat=await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.waitForFunction(()=>(document.querySelector('#ri_root [aria-label="Correct story fact"]')?.value ?? '')==='',null,{timeout:10000});
        assert.equal(await panel.getByLabel('Recovered correct story fact').count(),0);
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),chat);
        await corrections();
        await panel.getByLabel('Recovered correct story fact').waitFor();
        assert.equal(await panel.getByLabel('Recovered correct story fact').inputValue(),'The keeper left a sealed letter.');
        await panel.getByLabel('Correct story fact',{exact:true}).fill('The lantern was already lit.');
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),otherChat);
        await corrections();
        await panel.getByLabel('Recovered correct story fact').waitFor({state:'detached'});
        await page.evaluate(chat=>SillyTavern.getContext().openCharacterChat(chat),chat);
        await corrections();
        const recovered=panel.getByLabel('Recovered correct story fact');
        await recovered.first().waitFor();
        assert.deepEqual(await recovered.evaluateAll(inputs=>inputs.map(input=>input.value)),[
            'The lantern was already lit.','The keeper left a sealed letter.',
        ]);
        const newest=panel.getByText('Unsaved work from Correct story facts (1 of 2)',{exact:true}).locator('..');
        await tap(newest,'Dismiss recovered draft');
        assert.equal(await recovered.inputValue(),'The keeper left a sealed letter.');
        evidence.push({case:'independent unsaved edits recovered only in their originating chat',drafts:2,requests:L.requests().length});
        await tap(panel,'Close full screen');
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        evidence.push({case:'direct older reply actions',target:2,version:1,requests:0});
        console.log('PASS phone-width older reply actions, exact receipts, corrections and per-chat draft recovery');
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
