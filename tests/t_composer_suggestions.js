const assert = require('node:assert/strict');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page} = await L.open({width:320,height:475,hasTouch:true,isMobile:true});
    try {
        await L.setupApi(page,{legacyAutomation:false});
        await L.openChat(page);
        await L.send(page,'I stop beside the gate.');
        const name = 'Composer instruction ' + Date.now();
        await L.makeSet(page,name,[{name:'Gate cue',versions:['A1']}]);
        const composer = page.locator('#send_textarea');
        const toolbar = page.locator('.ri-quick-toolbar');
        const panel = page.locator('#ri_root');
        const sheet = page.locator('.ri-quick-sheet');
        const tap = (scope,name)=>scope.getByRole('button',{name,exact:true}).tap();
        const launcher = page.getByRole('button',{name:'Quick actions',exact:true});
        if (await launcher.getAttribute('aria-expanded')==='false') await launcher.tap();
        await tap(toolbar,'More actions');
        await tap(sheet,'Configure quick actions');
        await panel.locator('#ri-composer-slot-0 > summary').tap();
        await panel.getByLabel('Composer shortcut 1',{exact:true}).selectOption('suggestions');
        const slot = panel.locator('.ri-composer-slot').first();
        await slot.getByLabel('Button name',{exact:true}).fill('Gate arrivals');
        await slot.getByLabel('Icon',{exact:true}).selectOption('fa-key');
        await slot.getByLabel('Number of options',{exact:true}).selectOption('8');
        await slot.getByLabel('Generation prompt',{exact:true}).fill('Describe distinct visitors to this gate. GATE-ACTION-PROMPT');
        await slot.getByLabel('Active Random Instruction Set').selectOption(name);
        await tap(panel,'Back to Quick actions');
        await tap(sheet,'Close');

        await composer.fill('My unsent reply.');
        await composer.evaluate(node=>node.setSelectionRange(3,8,'backward'));
        L.resetLog();
        const choices = Array.from({length:12},(_,i)=>`Visitor ${i+1} arrives at the gate.`);
        L.mode({reply:JSON.stringify(choices),delayMs:550});
        const icon = toolbar.getByRole('button',{name:'Gate arrivals · 1 model call'});
        assert.equal((await icon.textContent()).trim(),'1 model call');
        await icon.locator('.fa-key').waitFor();
        await tap(toolbar,'Request details for Gate arrivals');
        assert.equal(L.requests().length,0);
        assert.equal(await sheet.locator('.ri-execution-settings').count(),0);
        await tap(sheet,'Close');
        await icon.evaluate(node=>{node.click();node.click();});
        await sheet.getByText('Generating 8 options…',{exact:true}).waitFor();
        await tap(sheet,'Close');
        const operation=page.locator('.ri-composer-operation');
        await operation.getByText('8 of 8 options ready.',{exact:true}).waitFor();
        await launcher.tap();
        assert.equal(await toolbar.evaluate(node=>node.getBoundingClientRect().height),0);
        await tap(operation,'View results');
        await sheet.getByText('8 of 8 options ready.',{exact:true}).waitFor();
        await sheet.getByText(choices[7],{exact:true}).waitFor();
        assert.equal(L.requests().length,1);
        const messages = L.requests()[0].messages;
        assert.match(messages.find(message=>message.role==='system').content,/GATE-ACTION-PROMPT/);
        assert.match(L.text(L.requests()[0]),/exactly 8 distinct suggestions/);
        assert.match(L.text(L.requests()[0]),/thing A1/);
        await tap(sheet,'Close');
        assert.equal(await composer.inputValue(),'My unsent reply.');
        assert.deepEqual(await composer.evaluate(node=>[node.selectionStart,node.selectionEnd,node.selectionDirection]),[3,8,'backward']);
        await launcher.tap();
        await icon.tap();
        await sheet.getByText(choices[7],{exact:true}).waitFor();
        assert.equal(L.requests().length,1,'Reopening completed choices is free');
        await tap(sheet,'Close');
        for (const count of [1,12,4]) {
            await tap(toolbar,'More actions');
            await tap(sheet,'Configure quick actions');
            if(!await slot.evaluate(node=>node.open)) await slot.locator(':scope > summary').tap();
            await slot.getByLabel('Number of options',{exact:true}).selectOption(String(count));
            await tap(panel,'Back to Quick actions');
            await tap(sheet,'Close');
            L.resetLog();
            L.mode({reply:JSON.stringify(choices.slice(0,count))});
            await icon.tap();
            await sheet.getByText(`${count} of ${count} options ready.`,{exact:true}).waitFor();
            assert.equal(L.requests().length,1);
            await tap(sheet,'Close');
        }

        L.resetLog();
        L.mode({reply:JSON.stringify(choices.slice(0,4)),delayMs:900});
        const dispatched = page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/generate'));
        await icon.tap();
        await tap(sheet,'Generate again · 1 model call');
        await dispatched;
        await tap(sheet,'Cancel request');
        await sheet.getByText('Generation cancelled.',{exact:true}).waitFor();
        assert.equal(await sheet.getByText('Option 1',{exact:true}).count(),0);
        await tap(sheet,'Close');

        await page.evaluate(async ({base,name})=>{
            const {chatState,saveChatState}=await import(base+'/src/store.js');
            chatState().activeSets=chatState().activeSets.filter(set=>set!==name);
            saveChatState();
        },{base:L.BASE,name});
        L.resetLog();
        await icon.tap();
        await tap(sheet,'Retry · 1 model call');
        await sheet.getByText('Activate the configured Random Instruction Set in this chat.',{exact:true}).waitFor();
        assert.equal(L.requests().length,0);
        await tap(sheet,'Close');
        // Cancel while an uncached source is loading: no request reaches the model.
        await page.evaluate(async ({base,name})=>{
            const {chatState,saveChatState,settings}=await import(base+'/src/store.js');
            chatState().activeSets.push(name);saveChatState();
            settings().quickToolbarSuggestions[0].prompt+=' LOADING_FIXTURE';
            (await import(base+'/src/ui/quick-actions.js')).refreshComposerToolbar();
            const {worldInfoCache}=await import('/scripts/world-info.js');worldInfoCache.delete(name);
        },{base:L.BASE,name});
        let releaseSource;
        const sourceGate=new Promise(resolve=>{releaseSource=resolve;});
        const sourceStarted=page.waitForRequest(request=>request.url().includes('/api/worldinfo/get') && request.postDataJSON()?.name===name);
        await page.route('**/api/worldinfo/get',async route=>{
            if(route.request().postDataJSON()?.name===name) await sourceGate;
            await route.continue();
        });
        await icon.tap();
        await sourceStarted;
        await tap(sheet,'Cancel request');
        releaseSource();
        await sheet.getByText('Generation cancelled.',{exact:true}).waitFor();
        assert.equal(L.requests().length,0,'Cancelling source loading does not dispatch');
        await tap(sheet,'Close');
        await page.unroute('**/api/worldinfo/get');
        console.log('PASS single-tap generation, double-tap guard, free details/reopen, independent result status, zero-height collapse, one request for 1/4/8/12 options, set preflight, explicit retry and preserved backward selection');
    } finally {
        L.mode({});
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
