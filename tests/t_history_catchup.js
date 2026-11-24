const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const {browser,page} = await L.open();
    try {
        await L.setupApi(page);
        await L.openChat(page);
        await L.setSettings(page,{summary:{on:true,every:2,hide:true,keepShown:4},world:{update:'all',head:0},check:{mode:'off'}});
        const story = (fn, value) => page.evaluate(fn,{base:L.BASE,value});
        await story(async ({base})=>{
            const c = SillyTavern.getContext();
            const {prefs} = await import(`${base}/src/v10.js`);
            const {chatState} = await import(`${base}/src/store.js`);
            const {app} = await import(`${base}/src/ui/panel.js`);
            prefs().enabled = true;
            chatState().components = {chapters:true,world:true,hide:true};
            for (let turn = 1; turn <= 6; turn++) {
                c.chat.push({is_user:true,name:c.name1,send_date:`test-input-${turn}`,mes:`I watch the dock. INPUT-${turn}`},
                    {is_user:false,name:c.name2,send_date:`test-reply-${turn}`,mes:`Mira held up the blue lantern. Grey clouds covered the dock. REPLY-${turn}`});
            }
            const expand = [...app.root.querySelectorAll('button')].find(button=>button.textContent.trim()==='Expand');
            expand?.click(); app.setExpanded(true);
            app.openPage('memory');
        });
        const payload = JSON.stringify({title:'A lantern at the dock',summary:'Mira held the lantern above the dock.',
            places:['Dock'],people:['Mira'],world:[{line:'place: Dock | The harborside landing',evidence:'Grey clouds covered the dock.'},
                {line:'person: Mira | keeper | The keeper carries a blue lantern',evidence:'Mira held up the blue lantern.'},
                {line:'place: Invented palace | An unsupported place',evidence:'This never appeared.'}],
            scene:{where:'Dock',when:'the day, morning, grey clouds rolling in',time:'06:00',date:'Day 2',present:'Mira'},
            sceneEvidence:'Grey clouds covered the dock.',
            characters:[{name:'Mira',mind:'Watching the dock',evidence:'Mira held up the blue lantern.'}],
            changes:[{id:'blue-lantern',kind:'fact',subject:'Mira',text:'Mira carried a blue lantern.',evidence:'Mira held up the blue lantern.'}]});
        const run = async ({rebuild=false,keep=true,payloadText=payload,success=true}={})=>{
            L.mode({reply:payloadText});
            L.resetLog();
            const result = await story(async ({base,value})=>{
                const C = await import(`${base}/src/chapters.js`);
                try { return await C.catchUpChatHistory(()=>{},{rebuild:value.rebuild,keepAuthored:value.keep}); }
                catch (error) { return {error:error.message}; }
            },{rebuild,keep});
            assert.equal(!result.error,success,result.error);
            return result;
        };
        const read = () => story(async ({base})=>{
            const c = SillyTavern.getContext();
            const W = await import(`${base}/src/world.js`);
            return {wid:W.chatWorld(), rows:W.listWorld(await W.loadWorld(W.chatWorld()),W.chatWorld()),
                hidden:c.chat.flatMap((m,i)=>m.is_system ? [i] : []),
                prose:c.chat.map(m=>m.mes), last:c.chat.at(-1).extra?.roleplay_instructions};
        });

        L.mode({reply:payload});
        L.resetLog();
        await page.locator('#ri_root').getByRole('button',{name:/^Catch up this chat/}).evaluate(button=>button.click());
        await page.locator('#ri_root').getByRole('status').filter({hasText:/Saved 3 chapters/}).waitFor({state:'attached'});
        const first = await read();
        assert.deepEqual(first.rows.filter(row=>row.kind==='chapter').map(row=>[row.span.from,row.span.to]),[[1,2],[3,4],[5,6]]);
        assert.ok(first.rows.some(row=>row.name==='blue-lantern'));
        assert.ok(first.rows.some(row=>row.name==='Dock'));
        assert.ok(first.rows.every(row=>row.name!=='Invented palace'));
        assert.deepEqual(first.hidden,[1,2,3,4,5,6,7,8]);
        assert.equal(first.last.scene.weather,'grey clouds rolling in');
        assert.equal(first.last.scene.date,'Day 2');
        assert.equal(first.last.scene.time,'06:00');
        assert.equal(first.last.v10Minutes,0);
        assert.equal(L.requests().length,3);
        for (let turn = 1; turn <= 6; turn++) assert.equal(L.requests().filter(req=>L.text(req).includes(`INPUT-${turn}`)).length,1);
        assert.equal((await run()).total,0);
        assert.equal(L.requests().length,0);

        await story(async ({base})=>{
            const W = await import(`${base}/src/world.js`);
            const wid = W.chatWorld(), data = await W.loadWorld(wid);
            const added = Object.assign(W.newWorldEntry(data,'place'),{name:'Authored Island'});
            added.fields.what = 'A protected authored detail.';
            W.writeWorldEntry(data,added,wid);
            await W.saveWorld(wid,data);
            const c = SillyTavern.getContext();
            c.chat[5].mes = 'I wait for Mira. EDITED-INPUT-3';
            await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,5);
            await (await import(`${base}/src/worldflow.js`)).worldIdle();
        });
        const edited = await read();
        assert.equal(edited.rows.filter(row=>row.kind==='chapter').length,1);
        assert.deepEqual(edited.hidden,[1,2,3,4]);
        const failed = await run({rebuild:true,payloadText:'{}',success:false});
        assert.match(failed.error,/no usable chapter/);
        assert.deepEqual(await read(),edited);

        const replacement = await run({rebuild:true});
        assert.equal(replacement.done,3);
        assert.equal(L.requests().length,3);
        const rebuilt = await read();
        assert.notEqual(rebuilt.wid,first.wid);
        assert.ok(rebuilt.rows.some(row=>row.name==='Authored Island'));
        assert.deepEqual(rebuilt.prose,edited.prose);
        assert.deepEqual(rebuilt.hidden,first.hidden);
        assert.equal(rebuilt.last.scene.time,'06:00');
        assert.equal(rebuilt.last.v10Minutes,0);
        assert.ok(await story(async ({base,value})=>{
            const W = await import(`${base}/src/world.js`);
            return W.listWorld(await W.loadWorld(value),value).some(row=>row.name==='Authored Island');
        },first.wid));
        await run({rebuild:true,keep:false});
        assert.ok((await read()).rows.every(row=>row.name!=='Authored Island'));
        console.log('PASS initial catch-up, saved coverage, provenance rollback, failed rebuild safety, replacement book and authored data option');
    } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode = 1; });
