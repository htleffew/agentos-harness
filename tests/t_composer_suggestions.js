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
        await tap(sheet,'Customize quick actions');
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
        const choices = Array.from({length:8},(_,i)=>`Visitor ${i+1} arrives at the gate.`);
        L.mode({reply:JSON.stringify(choices),delayMs:550});
        const icon = toolbar.getByRole('button',{name:'Gate arrivals · 1 model call'});
        assert.equal((await icon.textContent()).trim(),'');
        await icon.locator('.fa-key').waitFor();
        await icon.tap();
        await sheet.getByText('Generating 8 options…',{exact:true}).waitFor();
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
        for (const count of [1,4]) {
            await tap(toolbar,'More actions');
            await tap(sheet,'Customize quick actions');
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
        await sheet.getByText('Activate the configured Random Instruction Set in this chat.',{exact:true}).waitFor();
        assert.equal(L.requests().length,0);
        await tap(sheet,'Close');
        console.log('PASS icon-only one-tap generation with one request for 1, 4 and 8 options, custom prompt and active-set draw, inactive-set guard, preserved composer');
    } finally {
        L.mode({});
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
