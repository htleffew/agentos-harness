const assert = require('node:assert/strict');
const L = require('./lib.js');

(async ()=>{
    L.sync();
    const {browser,page} = await L.open();
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await L.setSettings(page,{summary:{on:false,hide:false},world:{update:'all',head:0},check:{mode:'off'}});
        const story = (fn,value) => page.evaluate(fn,{base:L.BASE,value});
        const fixture = await story(async ({base})=>{
            const c = SillyTavern.getContext();
            const V = await import(base+'/src/v10.js');
            const W = await import(base+'/src/world.js');
            const S = await import(base+'/src/st.js');
            const B = await import(base+'/src/books.js');
            const WF = await import(base+'/src/worldflow.js');
            const T = await import(base+'/src/story-refresh.js');
            V.prefs().enabled = true;
            const wid = await V.ensureWorld();
            const book = {entries:{}};
            const add = (kind,name,fields) => {
                const row=Object.assign(W.newWorldEntry(book,kind),{name,auto:true});
                Object.assign(row.fields,fields);
                W.writeWorldEntry(book,row,wid);
                return row.uid;
            };
            const row = add('fact','bridge-material',{data:JSON.stringify({id:'bridge-material',kind:'fact',subject:'Bridge',text:'The bridge is made of oak.',source:111,quote:'The bridge is made of oak.'})});
            const chapter = add('chapter','The bridge crossing',{summary:'They saw the bridge. The bridge is made of oak.'});
            await W.saveWorld(wid,book);
            const baseBook = 'Correction test canon '+Date.now();
            await S.saveBook(baseBook,{entries:{0:{...B.blankEntry(0),constant:true,useProbability:false,comment:'Bridge',
                content:'The bridge is made of oak.'}}});
            await S.refreshWorldList();
            await V.pinBase(baseBook);
            c.chat.push({is_user:true,name:c.name1,send_date:'u1',mes:'I inspect the bridge.'},
                {name:c.name2,send_date:'a1',mes:'The bridge is made of oak.',swipes:['The bridge is made of oak.','Alternate prose.'],swipe_id:0,swipe_info:[{},{}],
                    extra:{roleplay_instructions:{v:1,v10:true,time:111,items:[],scene:{where:'Bridge'},update:{world:wid,changes:[]}}}});
            WF.attachChanges(111,wid,[{type:'create',uid:row,kind:'fact',name:'bridge-material'}],{persist:false});
            T.rememberStoryTimeline();
            const {app} = await import(base+'/src/ui/panel.js');
            [...app.root.querySelectorAll('button')].find(button=>button.textContent.trim()==='Expand')?.click();
            app.openPage('corrections');
            return {wid,row,chapter,baseBook};
        });
        const edited = 'The bridge is made of stone.';
        const wrong = 'The bridge is made of oak.';
        const edits = [
            'world:'+fixture.row+':text','world:'+fixture.chapter+':summary','message:2',
            'lore:'+JSON.stringify([fixture.baseBook,'0']),
        ].map(id=>({id,quote:wrong,replacement:edited}));
        L.mode({reply:JSON.stringify({edits:[...edits,{id:'not-a-source',quote:wrong,replacement:'Bad guess'}]})});
        L.resetLog();
        const panel = page.locator('#ri_panel_page');
        await panel.getByLabel('Correct story fact',{exact:true}).fill(edited);
        await panel.getByLabel('Wrong wording (optional)',{exact:true}).fill(wrong);
        await panel.getByRole('button',{name:'Trace and draft with AI',exact:true}).click();
        await panel.getByRole('status').filter({hasText:/possible sources/}).waitFor();
        assert.equal(await panel.getByText(/Filed from chat message 3/).count(),1);
        await panel.getByRole('button',{name:'Save correction and checked source edits',exact:true}).click();
        await panel.getByRole('status').filter({hasText:/Saved 4 source edits/}).waitFor();
        assert.equal(L.requests().length,1);
        const read = () => story(async ({base})=>{
            const W = await import(base+'/src/world.js');
            const S = await import(base+'/src/store.js');
            const G = await import(base+'/src/chapters.js');
            const c = SillyTavern.getContext();
            return {world:W.chatWorld(), rows:W.listWorld(await W.loadWorld(W.chatWorld()),W.chatWorld()),
                corrections:S.chatState().storyCorrections, chat:c.chat, status:G.historyCatchUpStatus()};
        });
        const current = await read();
        assert.equal(current.chat[2].mes,edited);
        assert.deepEqual(current.chat[2].swipes,[edited,'Alternate prose.']);
        assert.equal(current.corrections[0].sources.length,4);
        assert.match(current.rows.find(row=>row.uid===fixture.chapter).fields.summary,/stone/);
        const stone = current.rows.find(row=>row.uid===fixture.row);
        assert.equal(JSON.parse(stone.fields.data).text,edited);
        assert.equal(stone.locked,true);
        const canon = await story(async ({base,value})=>(await (await import(base+'/src/st.js')).loadBook(value)).entries[0].content,fixture.baseBook);
        assert.equal(canon,wrong);

        await page.locator('#ri_root').getByRole('button',{name:'Close full screen',exact:true}).evaluate(button=>button.click());
        L.resetLog();
        L.mode({reply:'Mira moved slowly. She held a red lantern.'});
        await L.send(page,'I look toward the bridge.');
        const prompt = L.text(L.requests()[0]);
        assert.match(prompt,/Accepted story corrections/);
        assert.match(prompt,/made of stone/);
        assert.doesNotMatch(prompt,/made of oak/);
        L.resetLog();
        const repair = {summary:'Mira showed the blue lantern.',world:[],scene:{where:'Bridge',present:'Mira'},sceneEvidence:'She held a blue lantern.',
            characters:[],changes:[{id:'lantern',kind:'fact',text:'Mira held a blue lantern.',subject:'Mira',evidence:'She held a blue lantern.'}]};
        L.mode({reply:JSON.stringify(repair)});
        await story(async ({base})=>{
            const c=SillyTavern.getContext(), message=c.chat.at(-1);
            message.mes='Mira moved slowly. She held a blue lantern.';
            await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,c.chat.length-1);
        });
        async function waitForRecord(name) {
            for (let tries=0;tries<75;tries++) {
                const snapshot=await read();
                if (snapshot.rows.some(row=>row.name===name) && !snapshot.status?.running) return snapshot;
                await page.waitForTimeout(250);
            }
            throw new Error('Automatic refresh did not file '+name);
        }
        const refreshed = await waitForRecord('lantern');
        assert.equal(refreshed.rows.filter(row=>row.kind==='chapter').length,1);
        assert.equal(JSON.parse(refreshed.rows.find(row=>row.name==='lantern').fields.data).text,'Mira held a blue lantern.');
        assert.equal(refreshed.chat.at(-1).extra.roleplay_instructions.stateStale,false);
        assert.equal(L.requests().length,1);
        const update = (prose,id) => prose+'\n<story_update v="2">'+JSON.stringify({v:2,changes:[{id,kind:'fact',subject:'Mira',text:prose,evidence:prose}]})+'</story_update>';
        L.mode({reply:update('Mira raised a red banner.','banner')});
        await L.send(page,'What is hanging over the bridge?');
        L.mode({reply:update('Mira carried a compass.','compass')});
        await L.send(page,'What is Mira carrying?');
        await waitForRecord('compass');
        L.mode({reply:JSON.stringify({summary:'Mira carried a compass.',world:[],characters:[],
            changes:[{id:'remaining-compass',kind:'fact',subject:'Mira',text:'Mira carried a compass.',evidence:'Mira carried a compass.'}]})});
        L.resetLog();
        await story(async ({base})=>{
            const host=SillyTavern.getContext();
            await (await import(base+'/src/worldflow.js')).worldIdle();
            (await import(base+'/src/story-refresh.js')).rememberStoryTimeline();
            host.chat.splice(5,2);
            await host.eventSource.emit(host.eventTypes.MESSAGE_DELETED,host.chat.length);
        });
        const deleted = await waitForRecord('remaining-compass');
        assert.ok(deleted.rows.every(row=>row.name!=='banner'));
        assert.equal(L.requests().length,1);
        assert.doesNotMatch(L.text(L.requests()[0]),/raised a red banner/);

        L.mode({reply:JSON.stringify({summary:'Mira reached the harbor.',world:[],characters:[],
            scene:{where:'Harbor',present:'Mira'},sceneEvidence:'Mira reached the harbor.',
            changes:[{id:'branch-harbor',kind:'fact',subject:'Mira',text:'Mira reached the harbor.',evidence:'Mira reached the harbor.'}]})});
        L.resetLog();
        const branchAt = await story(async ()=>{
            const host=SillyTavern.getContext();
            host.chat.push({name:host.name1,is_user:true,send_date:'branch-u',mes:'I follow Mira.'},
                {name:host.name2,send_date:'branch-a',mes:'Mira reached the harbor.'});
            await host.saveChat();
            return host.chat.length-1;
        });
        await L.slash(page,'/branch-create '+branchAt);
        const branch=await waitForRecord('branch-harbor');
        assert.notEqual(branch.world,fixture.wid);
        assert.equal(branch.chat.at(-1).extra.roleplay_instructions.scene.where,'Harbor');
        assert.ok(branch.rows.some(row=>row.name==='bridge-material' && JSON.parse(row.fields.data).text===edited));
        assert.ok(await story(async ({base,value})=>{
            const W=await import(base+'/src/world.js');
            return W.listWorld(await W.loadWorld(value),value).every(row=>row.name!=='branch-harbor');
        },fixture.wid));
        assert.equal(L.requests().length,1);
        console.log('PASS corrected original transcript, chapter and record, patched pinned lore in chat only, actual request precedence, and automatic edit, batch deletion and branch refresh');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
