// Options quick action on the composer bar: the saved count, prompt and Random Instruction Set travel in one request,
// the draft and its selection survive, a re-tap is free, and a missing set fails before any request.
// Rewritten for B1 to B3: the bolt launcher, the suggestion slots and the "Configure quick actions" sheet are gone.
// Their touch, sheet, cancel and cache checks now live in t_composer_bar.js, t_results_sheet.js and
// t_quick_action_setup.js; the 12-option request text moved to the titled format ("distinct objects").
const assert = require('node:assert/strict');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors} = await L.open({width:523,height:1021,hasTouch:true,isMobile:true});
    const ext = (fn,value)=>page.evaluate(fn,{B:L.BASE,value});
    const save = patch=>ext(async({B,value})=>{
        (await import(`${B}/src/quick-actions.js`)).saveQuickAction({id:'builtin:options:npc',...value});
        (await import(`${B}/src/ui/results-sheet.js`)).clearOptionsCache();
        (await import(`${B}/src/ui/composer-bar.js`)).renderBar();
    },patch);
    const tapAt = async selector=>{
        const box = await page.locator(selector).first().boundingBox();
        assert.ok(box,selector);
        await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
        await page.waitForTimeout(250);
    };
    const pin = '#ri_composer_bar .ri-bar-pin[data-kind="options"]';
    try {
        await L.setupApi(page,{legacyAutomation:false});
        await L.openChat(page);
        await L.send(page,'I stop beside the gate.');
        const name = 'Composer instruction ' + Date.now();
        await L.makeSet(page,name,[{name:'Gate cue',versions:['A1']}]);
        await ext(async({B})=>{ const Q=await import(`${B}/src/quick-actions.js`); Q.setBarFolded(false); (await import(`${B}/src/ui/composer-bar.js`)).renderBar(); });
        const composer = page.locator('#send_textarea');
        await composer.fill('My unsent reply.');
        await composer.evaluate(node=>node.setSelectionRange(3,8,'backward'));

        for (const count of [8,1,12,4]) {
            await save({count,prompt:'Describe distinct visitors to this gate. GATE-ACTION-PROMPT',set:name});
            L.resetLog();
            await tapAt(pin);
            assert.equal(L.requests().length,0,'a tap only opens the sheet');
            await tapAt('.ri-gsheet [data-ri-generate]');
            await page.waitForFunction(()=>document.querySelector('.ri-gsheet .ri-option-card, .ri-gsheet [data-ri-retry]'),null,{timeout:30000})
                .catch(async error=>{ await page.screenshot({path:`${process.env.RI_EVIDENCE || '.'}/options-${count}.png`}); throw error; });
            assert.equal(await page.locator('.ri-gsheet .ri-option-card').count(),count,`${count} cards`);
            assert.equal(L.requests().length,1,`one request for ${count}`);
            const text = L.text(L.requests()[0]);
            assert.match(text,new RegExp(`exactly ${count} distinct objects`));
            assert.match(text,/GATE-ACTION-PROMPT/);
            assert.match(text,/thing A1/,'the saved set rolls into the request');
            await tapAt('.ri-gsheet [data-ri-close]');
            assert.equal(await composer.inputValue(),'My unsent reply.');
            assert.deepEqual(await composer.evaluate(node=>[node.selectionStart,node.selectionEnd,node.selectionDirection]),[3,8,'backward']);
        }
        // Reopening the last results is free.
        L.resetLog();
        await tapAt(pin);
        await page.locator('.ri-gsheet .ri-option-card').first().waitFor();
        assert.equal(await page.locator('.ri-gsheet .ri-option-card').count(),4);
        assert.equal(L.requests().length,0,'reopening completed options is free');
        await tapAt('.ri-gsheet [data-ri-close]');

        // A set that is no longer active fails before any request, with Retry.
        await ext(async({B,value})=>{
            const {chatState,saveChatState}=await import(`${B}/src/store.js`);
            chatState().activeSets=chatState().activeSets.filter(set=>set!==value); saveChatState();
        },name);
        await save({set:'missing-set'});
        L.resetLog();
        await tapAt(pin);
        await tapAt('.ri-gsheet [data-ri-generate]');
        await page.locator('.ri-gsheet [data-ri-retry]').waitFor({timeout:10000});
        assert.equal(L.requests().length,0,'a missing set makes no request');
        await tapAt('.ri-gsheet [data-ri-close]');
        await ext(async({B})=>(await import(`${B}/src/quick-actions.js`)).restoreQuickAction('builtin:options:npc'));
        await page.waitForTimeout(1500); // the host saves settings on a debounce; let the restore reach disk
        assert.deepEqual(errors,[]);
        console.log('PASS options quick action: one request for 1, 4, 8 and 12 options with the saved prompt and set, free reopen, preserved draft and backward selection, set preflight with no request');
    } finally {
        L.mode({});
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
