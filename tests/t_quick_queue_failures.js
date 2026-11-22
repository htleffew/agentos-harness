const assert=require('node:assert/strict');
const fs=require('node:fs');
const L=require('./lib.js');

(async()=>{
    L.sync();
    const {page,browser,errors}=await L.open({width:360,height:460,hasTouch:true,isMobile:true});
    const sheet=page.locator('.ri-quick-sheet');
    const composer=page.locator('#send_textarea');
    const taps=[];
    const click=async (name,root=sheet)=>{
        await root.getByRole('button',{name,exact:typeof name==='string'}).first().tap();
        taps.push(String(name));
    };
    const open=()=>L.openQuickActions(page);
    const close=()=>click('Close');
    const family=async label=>{await open();await click(label);};
    const direction=()=>sheet.getByRole('textbox',{name:'Your direction'});
    const currentQueue=()=>page.evaluate(async root=>(await import(root+'/src/quick-action-chat.js')).quickChat().pending,L.BASE);
    const trace=[];
    try {
        page.setDefaultTimeout(12000);
        await L.setupApi(page,{legacyAutomation:false});
        await L.openChat(page);
        const title='Offline action '+Date.now();
        await page.evaluate(async ()=>{(await import('/script.js')).setOnlineStatus('no_connection');});
        L.resetLog();
        await composer.fill('Unsent player draft.');
        await composer.evaluate(input=>input.setSelectionRange(2,8));
        await family('Steer the next reply');
        await click('Create saved nudge');
        await sheet.getByLabel('Button name',{exact:true}).fill(title);
        await sheet.getByLabel('Direction',{exact:true}).fill('Let the cloud clear.');
        await click('Save button');
        await click(title);
        await direction().fill('Local pending wording.');
        assert.equal(L.requests().length,0);
        trace.push({case:'offline authorship',title,typed:await direction().inputValue()});
        await close();
        assert.equal(await composer.inputValue(),'Unsent player draft.');
        assert.deepEqual(await composer.evaluate(input=>[input.selectionStart,input.selectionEnd]),[2,8]);

        const nonce=String(Date.now());
        const set='Unavailable book '+nonce;
        await L.makeSet(page,set,[
            {name:'Unavailable disabled '+nonce,versions:['A1'],chance:100},
            {name:'Unavailable missing '+nonce,versions:['A2'],chance:100},
        ],{activate:false});
        const fixture=await page.evaluate(async ({base,set,nonce})=>{
            const B=await import(base+'/src/books.js');
            const A=await import(base+'/src/quick-actions.js');
            const Q=await import(base+'/src/quick-action-chat.js');
            const data=await B.loadSet(set);
            Object.values(data.entries).find(entry=>entry.comment.endsWith('disabled '+nonce)).disable=true;
            await B.saveSet(set,data);
            const rows=await A.loadQuickActionSources({sets:[set]});
            const link=A.linkedQuickAction(rows.find(row=>row.title==='Unavailable missing '+nonce && row.version===undefined));
            Q.pinQuickAction(link.id,link.title,link.family);
            const bad=A.saveQuickAction({family:'steer',title:'Broken direction '+nonce,text:'Use {{unknown'});
            return {link:link.title,invalid:bad.title};
        },{base:L.BASE,set,nonce});
        await family('Steer the next reply');
        await click('Browse directions');
        await sheet.getByRole('searchbox',{name:'Search quick actions'}).fill(set);
        assert.equal(await sheet.getByRole('button',{name:'Unavailable disabled '+nonce,exact:true}).isDisabled(),true);
        await sheet.getByText('Disabled in this source book',{exact:true}).first().waitFor();
        trace.push({case:'disabled source',reason:'Disabled in this source book'});
        await click('Back');
        await close();
        await page.evaluate(async ({base,set})=>(await import(base+'/src/books.js')).deleteSet(set),{base:L.BASE,set});

        await family('Steer the next reply');
        assert.equal(await direction().inputValue(),'Local pending wording.');
        await click(fixture.link);
        const missing=sheet.getByRole('status').filter({hasText:/linked source is missing or changed/i});
        await missing.waitFor();
        assert.equal(await direction().inputValue(),'Local pending wording.');
        trace.push({case:'missing linked book',reason:await missing.innerText()});
        const directions=sheet.getByText('Available directions',{exact:true});
        if (!await sheet.getByRole('button',{name:fixture.invalid,exact:true}).isVisible()) await directions.tap();
        await click(fixture.invalid);
        const invalid=sheet.getByRole('status').filter({hasText:/unresolved variables/i});
        await invalid.waitFor();
        trace.push({case:'malformed macro',reason:await invalid.innerText()});
        assert.equal(await direction().inputValue(),'Local pending wording.');
        await close();

        const events=await page.evaluate(()=>{
            const host=SillyTavern.getContext(), types=host.eventTypes || host.event_types;
            const saved=types.CHAT_COMPLETION_PROMPT_READY;
            delete types.CHAT_COMPLETION_PROMPT_READY;
            return saved;
        });
        assert(events);
        await family('Steer the next reply');
        const unsupported=sheet.getByRole('status').filter({hasText:/host does not expose.*final prompt/i});
        await unsupported.waitFor();
        assert.equal(await sheet.getByRole('button',{name:'Queue with my next message',exact:true}).isDisabled(),true);
        assert.equal(await direction().inputValue(),'Local pending wording.');
        trace.push({case:'unavailable host event',reason:await unsupported.innerText()});
        await close();
        await page.evaluate(event=>{
            const host=SillyTavern.getContext();
            (host.eventTypes || host.event_types).CHAT_COMPLETION_PROMPT_READY=event;
        },events);
        assert.equal((await currentQueue()).length,0);
        assert.equal(L.requests().length,0);
        assert.deepEqual(errors,[]);
        console.log('PASS disconnected local workflow, disabled and missing sources, malformed macros, missing host events, and draft recovery');
    } catch (error) {
        await page.screenshot({path:'/tmp/ri-queue-failures.png'}).catch(()=>{});
        throw error;
    } finally {
        if (process.env.RI_QUEUE_CAPTURE) fs.writeFileSync(process.env.RI_QUEUE_CAPTURE,JSON.stringify({
            host:'SillyTavern 1.19.0',viewport:[360,460],touch:true,taps,trace,requests:L.requests(),errors,
        },null,2)+'\n');
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
