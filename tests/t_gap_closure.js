const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const {browser,page,errors} = await L.open({width:390,height:820});
    const run = (fn,value) => page.evaluate(fn,{base:L.BASE,value});
    const go = value => run(async ({base,value})=>{
        const {app} = await import(base+'/src/ui/panel.js');
        app.openPage(value);
    },value);
    const root = page.locator('#ri_root');
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await L.setSettings(page,{check:{mode:'off'},world:{head:0},summary:{on:false,onSceneEnd:false,hide:true}});
        const book = await run(async ({base})=>{
            const V=await import(base+'/src/v10.js');
            const W=await import(base+'/src/worldflow.js');
            V.prefs().enabled=true;
            await W.saveV10Record({kind:'fact',id:'pilot-canon',text:'MODEL-DELTA-FACT. The harbor pilot has the amber permit.'},{create:true});
            return V.ensureWorld();
        });
        const savedRule = () => run(async ({base,value})=>{
            const S=await import(base+'/src/st.js');
            const W=await import(base+'/src/world.js');
            return W.listWorld(await S.loadBook(value),value).find(row=>row.name==='pilot-canon').activation;
        },book);
        await root.locator('button').filter({hasText:/^Expand$/}).evaluate(el=>el.click());
        await go('world');
        await root.getByRole('button',{name:'See this chat’s World Info books'}).click();
        assert.equal(await page.evaluate(()=>document.activeElement.id),'ri-chat-book-inventory');
        const catalog = root.locator('.ri-book-catalog > .ri-card').filter({has:page.getByText(book,{exact:true})});
        await catalog.getByText('Edit or delete entries',{exact:true}).click();
        const entry = catalog.locator('.ri-book-entry').filter({has:page.getByText('pilot-canon',{exact:true})});
        await entry.getByRole('button',{name:'Edit',exact:true}).click();
        assert.match(await entry.getByRole('textbox',{name:'Record text',exact:true}).inputValue(),/MODEL-DELTA-FACT/);
        await entry.getByText('Help choosing triggers',{exact:true}).click();
        L.mode({reply:JSON.stringify({keywords:['delta beacon','Delta Beacon','/.* /','skip this one']})});
        L.resetLog();
        await entry.getByRole('button',{name:'Suggest trigger phrases with AI'}).click();
        await entry.getByRole('checkbox',{name:'skip this one',exact:true}).uncheck();
        await entry.getByRole('button',{name:'Add checked phrases to draft'}).click();
        assert.equal(await entry.getByRole('textbox',{name:'Trigger phrases',exact:true}).inputValue(),'delta beacon');
        assert.equal(await savedRule(),null);
        assert.equal(L.requests().length,1);
        assert.match(L.text(L.requests()[0]),/MODEL-DELTA-FACT/);
        await entry.getByLabel('Keyword source',{exact:true}).selectOption('assistant');
        await entry.getByLabel('Keep active for replies',{exact:true}).fill('1');
        await entry.getByLabel('Cooldown (replies)',{exact:true}).fill('1');
        await entry.getByRole('button',{name:'Save entry',exact:true}).click();
        await entry.getByText(/Previous model reply.*Sticky 1.*Cooldown 1 replies/).waitFor();
        assert.deepEqual(await savedRule(),{mode:'triggered',keys:['delta beacon'],source:'assistant',chance:100,sticky:1,cooldown:1,window:6,after:0});

        const send = async (input,reply,shouldRecall) => {
            L.mode({reply});
            L.resetLog();
            await L.send(page,input);
            assert.equal(L.requests().length,1);
            assert.equal(L.text(L.requests()[0]).includes('MODEL-DELTA-FACT'),shouldRecall);
        };
        await send('I point to the delta beacon.','The delta beacon flashed.',false);
        await send('I wait.','Only waves answered.',true);
        const context = await run(async({base})=>(await import(base+'/src/context-budget.js')).lastContext());
        assert.ok(context.lore.tokens>0);
        await send('I keep watching.','The delta beacon flashed again.',true);
        await send('I count ten seconds.','The delta beacon stayed lit.',false);
        await send('I write a note.','The harbor pilot approached.',true);

        await go('context');
        await root.getByLabel('Protect recent history by',{exact:true}).selectOption('tokens');
        const budget = root.getByLabel('Recent history token budget (number)',{exact:true});
        await budget.fill('250');
        await budget.dispatchEvent('change');
        await root.getByText('Keep the story so far in chapters',{exact:true}).locator('..').getByRole('combobox').selectOption('on');
        await root.getByLabel('Write a chapter at least every',{exact:true}).fill('0');
        await root.getByLabel('Write a chapter at least every',{exact:true}).dispatchEvent('change');
        await root.getByLabel('Summarize at estimated tokens',{exact:true}).fill('300');
        await root.getByLabel('Summarize at estimated tokens',{exact:true}).dispatchEvent('change');
        const summary = JSON.stringify({title:'The pilot arrives',summary:'The pilot approached the group at the dock.'});
        const longReply = 'WHOLE_RECENT_REPLY ' + 'The tide moved in. '.repeat(80) + 'END_OF_RECENT_REPLY';
        L.mode({reply:longReply,goal:summary});
        L.resetLog();
        await L.send(page,'I greet the pilot.');
        await page.waitForFunction(async ({base,book})=>{
            const S=await import(base+'/src/st.js');
            const W=await import(base+'/src/world.js');
            const C=await import(base+'/src/chapters.js');
            return !C.chapterBusy() && W.listWorld(await S.loadBook(book),book).some(row=>row.name==='The pilot arrives');
        },{base:L.BASE,book},{timeout:20000});
        assert.equal(L.requests().length,2);
        assert.match(L.text(L.requests()[1]),/I point to the delta beacon[\s\S]*END_OF_RECENT_REPLY/);
        const hidden = await run(async ({base})=>{
            const S=await import(base+'/src/st.js');
            return S.ctx().chat.filter(S.isHidden).map(message=>message.mes);
        });
        assert.ok(hidden.some(text=>text.includes('I point to the delta beacon')));
        assert.ok(!hidden.some(text=>text.includes('WHOLE_RECENT_REPLY')));
        L.mode({reply:'The pilot nodded.',goal:summary});
        L.resetLog();
        await L.send(page,'I ask about the crossing.');
        assert.doesNotMatch(L.text(L.requests()[0]),/I point to the delta beacon/);
        assert.match(L.text(L.requests()[0]),/WHOLE_RECENT_REPLY[\s\S]*END_OF_RECENT_REPLY/);
        await budget.fill('10000');
        await budget.dispatchEvent('change');
        await root.getByRole('button',{name:'Apply to saved chapters now'}).click();
        await page.waitForFunction(async base=>{
            const S=await import(base+'/src/st.js');
            return !S.ctx().chat.some(S.isHidden);
        },L.BASE);
        assert.equal(L.requests().length,1);
        assert.deepEqual(errors,[]);
        console.log('PASS trigger suggestions, role-specific recall, sticky and cooldown, token cadence and whole-message history in SillyTavern');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
