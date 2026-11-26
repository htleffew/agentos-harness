const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:320,height:475,hasTouch:true,isMobile:true});
    const panel=page.locator('#ri_root');
    const body=panel.locator('#ri_panel_page');
    // B28: pages open through the app object; the section names the old suite tapped map to page ids.
    const PAGE={'Opening':'opening','Character goals':'goals','Chat facts':'facts','Dialogue colors':'speakers','Emotions & relationships':'emotion','Request log':'log'};
    const click=(name,root=panel)=>PAGE[name] ? L.openPanel(page,PAGE[name]) : root.getByRole('button',{name,exact:true}).tap();
    const scope=async()=>{};
    const openDrawer=()=>L.openPanel(page);
    const evidence=[];
    try {
        await L.setupApi(page,{legacyAutomation:false});
        await page.evaluate(()=>SillyTavern.getContext().executeSlashCommandsWithOptions('/closechat'));
        await page.waitForFunction(()=>!SillyTavern.getContext().getCurrentChatId());
        await openDrawer();
        assert.equal((await panel.locator('[data-ri-heading]').innerText()).toLowerCase(),'features');
        assert.equal(await page.getByRole('toolbar',{name:'Quick actions'}).count(),0);
        await page.evaluate(async B=>(await (await import(`${B}/src/ui/panel.js`)).app.setExpanded(false)),L.BASE);

        await L.usePreset(page,'Roleplay Instructions V10');
        await L.openChat(page);
        await openDrawer();
        await L.openPanel(page);
        assert.equal((await panel.locator('[data-ri-heading]').innerText()).toLowerCase(),'scene');
        L.resetLog();
        evidence.push({case:'first open with and without a chat',destinations:['Preset & Extension','Current scene']});

        await scope('Story');
        await click('Opening');
        const greeting=body.getByLabel('Opening preview',{exact:true});
        const original=await greeting.inputValue();
        const openingDirection=body.getByLabel('Opening direction',{exact:true});
        await openingDirection.fill('Begin outside the eastern gate.');
        assert.equal(L.requests().length,0);
        const generate=body.getByRole('button',{name:/^Generate opening/});
        const openingFeedback=body.locator('#ri-opening-feedback');
        assert.equal(await generate.getAttribute('data-ri-model-cost'),'1 model call');
        L.mode({reply:'<story_update v="2">unreadable</story_update>'});
        await generate.tap();
        await openingFeedback.filter({hasText:'No opening was returned'}).waitFor();
        assert.equal(await greeting.inputValue(),original);
        assert.equal(L.requests().length,1);
        assert.match(L.text(L.requests()[0]),/Begin outside the eastern gate/);
        L.mode({reply:'A reply that arrives after cancellation.',delayMs:2500});
        const started=page.waitForRequest(request=>request.method()==='POST' && /\/generate\b/.test(request.url()));
        await generate.tap();
        await started;
        for (let attempt=0; attempt<30 && L.requests().length<2; attempt++) await page.waitForTimeout(50);
        await click('Cancel opening request',body);
        await openingFeedback.filter({hasText:'Opening request cancelled'}).waitFor();
        assert.equal(await greeting.inputValue(),original);
        assert.equal(await openingDirection.inputValue(),'Begin outside the eastern gate.');
        assert.equal(L.requests().length,2);
        evidence.push({case:'opening initialization, unreadable response and explicit cancellation',previewRequests:0,authorizedRequests:2});
        await click('Character goals');
        await page.locator('dialog[open] .popup-button-ok').tap();
        L.mode({});
        L.resetLog();
        const step=body.getByRole('textbox',{name:'New one-time step'});
        await step.fill('Show the keeper a red key');
        await click('Add this step',body);
        await step.fill('Greet the keeper');
        await click('Add this step',body);
        const rows=body.locator('[id^="ri-goal-"]');
        assert.match(await rows.first().innerText(),/red key/);
        await click('Move down',rows.first());
        assert.match(await rows.first().innerText(),/Greet the keeper/);
        assert.match(await rows.nth(1).innerText(),/red key/);
        assert.match(await page.evaluate(()=>document.activeElement.closest('[id^="ri-goal-"]').textContent),/red key/);
        evidence.push({case:'goal step reorder',focus:'moved step'});

        await scope('Story');
        await click('Chat facts');
        // Story, Facts is the Facts filter of Story World in a chat whose memory lives in chat data (fixadd): Add record
        // files her record there, with the same form the old Chat Facts page had.
        await body.locator('[data-ri-filter="facts"][aria-pressed="true"]').waitFor();
        await click('Add record',body);
        await body.getByText('This chat · Saves to the current story records.').waitFor();
        await body.getByLabel('Record text').fill('The eastern gate is locked.');
        await click('Save record',body);
        const gate=body.locator('[data-ri-records="facts"] [data-ri-record]').filter({hasText:'The eastern gate is locked.'});
        await gate.waitFor();
        assert.match(await gate.innerText(),/Locked/i);
        const finder=body.getByRole('searchbox',{name:'Search the records'});
        await finder.fill('purple hat');
        await body.getByText('No record matches the search.').waitFor();
        await finder.fill('eastern gate');
        await gate.waitFor();
        evidence.push({case:'local record creation and filtering',filter:'eastern gate'});

        await page.evaluate(async base=>{
            const {prefs}=await import(base+'/src/v10.js');
            const {saveChatState}=await import(base+'/src/store.js');
            (prefs().speakers ||= {})['speaker:keeper']={name:'Keeper',aliases:['keeper'],color:'#111111'};
            saveChatState();
        },L.BASE);
        await scope('Story');
        await click('Dialogue colors');
        await body.getByLabel('Color for Keeper').waitFor();
        const saved=body.getByLabel('Color for Keeper');
        assert.equal(await saved.inputValue(),'#111111');
        assert.equal(await body.locator('.ri-speaker-sample').innerText(),'I’m ready when you are.');
        await click('Use automatic color',body);
        assert.notEqual(await saved.inputValue(),'#111111');
        evidence.push({case:'speaker preview and automatic color'});

        await click('Emotions & relationships');
        await click('Add record',body);
        await body.getByLabel('Record type',{exact:true}).selectOption('relationship');
        await body.getByLabel('Subject or speaker',{exact:true}).fill('Rowan');
        await body.getByLabel('Other character',{exact:true}).fill('Mira');
        await body.getByLabel('Record text',{exact:true}).fill('The gatekeeper is still deciding whether to trust the visitor.');
        await body.getByText('This chat · Saves to the current story records.').waitFor();
        await click('Save record',body);
        const pair=body.getByText('Relationship · Rowan · Mira · Protected',{exact:true});
        await pair.tap();
        await click('Edit',pair.locator('..'));
        await body.getByLabel('Subject or speaker',{exact:true}).fill('Mira');
        await body.getByLabel('Other character',{exact:true}).fill('Rowan');
        await click('Save record',body);
        await body.getByText('Relationship · Mira · Rowan · Protected',{exact:true}).waitFor();
        assert.equal(await pair.count(),0);
        evidence.push({case:'relationship edit preserves scope and protection when reversing the pair'});

        const cdp=await page.context().newCDPSession(page);
        await cdp.send('Emulation.setEmulatedVisionDeficiency',{type:'achromatopsia'});
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.evaluate(async base=>{
            const {addLog,clearLog}=await import(base+'/src/log.js');
            clearLog();
            addLog({what:'Local fixture failure',ok:false,result:'The test connection closed.'});
            addLog({what:'Local fixture success',ok:true,result:'Saved.'});
        },L.BASE);
        await scope('Review');
        await click('Request log');
        await body.getByLabel('Request outcome').selectOption('2');
        await body.getByText('Showing 1 of 2 logged requests.').waitFor();
        assert.equal(await body.getByText('Local fixture success',{exact:true}).count(),0);
        const [download]=await Promise.all([page.waitForEvent('download'),click('Save the log as a file',body)]);
        const exported=fs.readFileSync(await download.path(),'utf8');
        assert.match(exported,/Local fixture failure[\s\S]*The test connection closed\./);
        await page.context().grantPermissions(['clipboard-read','clipboard-write']);
        await click('Copy the log',body);
        await body.getByText('Copied the complete request log.').waitFor();
        // The Windows clipboard returns CRLF line ends, so both sides are read with LF only.
        assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),exported.replace(/\r\n/g,'\n'));
        await click('Clear the log',body);
        const confirmation=body.getByRole('group',{name:'Confirm clear request log'});
        await confirmation.getByText('Clear all 2 saved request log entries from this device?').waitFor();
        await click('Keep the log',confirmation);
        await body.getByText('Showing 1 of 2 logged requests.').waitFor();
        await click('Clear the log',body);
        await page.evaluate(async base=>(await import(base+'/src/log.js')).addLog({what:'Fixture entry added while reviewing',ok:true}),L.BASE);
        await body.getByText('Showing 1 of 3 logged requests.').waitFor();
        await click('Confirm clear',confirmation);
        await body.getByText(/The log changed while you reviewed it/).waitFor();
        await click('Clear the log',body);
        await confirmation.getByText('Clear all 3 saved request log entries from this device?').waitFor();
        await click('Confirm clear',confirmation);
        await body.getByText('Cleared 3 request log entries.').waitFor();
        await body.getByText(/^The log is empty/).waitFor();
        assert.equal(await body.getByRole('button',{name:'Clear the log'}).isDisabled(),true);
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        evidence.push({case:'keyboard disclosure in grayscale with reduced motion',requests:0});
        evidence.push({case:'log filter, copy, download and count-confirmed clear',original:2,cleared:3,requests:0});
        console.log('PASS first open, goal ordering, chat fact search, dialogue preview, keyboard disclosure and request log');
    } catch(error) {
        await page.screenshot({path:'/tmp/ri-extension-ux-editors.png'}).catch(()=>{});
        throw error;
    } finally {
        if (process.env.RI_UX_CAPTURE) fs.writeFileSync(process.env.RI_UX_CAPTURE,JSON.stringify({
            host:'SillyTavern 1.19.0',preset:'Roleplay Instructions V10',viewport:[320,475],touch:true,evidence,errors,
        },null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
