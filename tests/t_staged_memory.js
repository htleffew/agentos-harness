const fs = require('node:fs');
const assert = require('node:assert/strict');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors} = await L.open({width:390,height:760,hasTouch:true,isMobile:true,
        setupPage:page=>page.route('**/api/horde/**',route=>route.fulfill({json:route.request().url().endsWith('/status') ? {ok:true} : []}))});
    try {
        await L.setupApi(page,{legacyAutomation:false});
        await L.setSettings(page,{
            check:{mode:'off'},world:{editableReplies:5,update:'all',build:0,head:0},
            summary:{on:true,onSceneEnd:false,every:20,hide:true,keepShown:30,retire:false},
            execution:{version:1,functions:{chapterSummary:{automatic:true,profileId:''}}},
        });
        await L.openChat(page);
        const world = await page.evaluate(async base=>{
            const {createSet} = await import(base+'/src/books.js');
            const {setChatWorld} = await import(base+'/src/world.js');
            const name = await createSet(`Staged Memory ${Date.now()}`,'world',{entries:{}},'');
            setChatWorld(name);
            return name;
        },L.BASE);
        const read = () => page.evaluate(async ({base,world})=>{
            const {loadDurableWorld,loadEffectiveWorld,worldIdle} = await import(base+'/src/worldflow.js');
            const {storyJournalStatus} = await import(base+'/src/memory-journal.js');
            const {listWorld} = await import(base+'/src/world.js');
            await worldIdle();
            const durable = await loadDurableWorld(world);
            const effective = await loadEffectiveWorld(world);
            return {durable:listWorld(durable,world),effective:listWorld(effective,world),status:storyJournalStatus(),
                chat:SillyTavern.getContext().chat.map(({mes,is_system})=>({mes,hidden:!!is_system}))};
        },{base:L.BASE,world});
        const summaries = () => L.requests().filter(record=>L.text(record).includes('Write the summary of one part of a roleplay story'));
        const answer = JSON.stringify({title:'A walk to the pier',summary:'Hale and Rowan crossed the harbour.',people:[],places:['Pier'],settled:''});
        L.resetLog();
        let firstProviderCalls, sixth, seventh, before, after;
        for (let number=1; number<=26; number++) {
            const prose = `Accepted story [${number}] walks along the harbour.`;
            const update = number===1 ? '\n<story_update>\nplace: Pier | An old stone pier reaches the bay\n</story_update>' : '';
            L.mode({reply:prose+update,goal:answer});
            await L.send(page,`PLAYER_MARKER_${number}.`);
            if (number===6) {
                sixth=await read();
                assert.equal(sixth.durable.length,0);
                assert(sixth.effective.some(row=>row.name==='Pier'));
                assert.equal(sixth.status.pending,1);
            }
            if (number===7) {
                seventh=await read();
                assert(seventh.durable.some(row=>row.name==='Pier'));
                assert.equal(seventh.status.filed,1);
                assert.equal(seventh.status.pending,0);
                firstProviderCalls=L.requests().length;
            }
            if (number===25) {
                before=await read();
                assert.equal(before.status.filed,19);
                assert.equal(summaries().length,0);
            }
        }
        await page.waitForFunction(async ({base,world})=>{
            const {loadDurableWorld} = await import(base+'/src/worldflow.js');
            return Object.values((await loadDurableWorld(world)).entries).some(entry=>entry.extensions?.ri?.span?.to===20);
        },{base:L.BASE,world},{timeout:30000});
        after=await read();
        const requests = summaries();
        assert.equal(requests.length,1);
        assert.equal(L.requests().length,27);
        const summary = L.text(requests[0]);
        for (let number=1;number<=20;number++) assert(summary.includes(`Accepted story [${number}]`));
        for (let number=21;number<=26;number++) assert(!summary.includes(`Accepted story [${number}]`));
        assert(after.durable.some(row=>row.span?.from===1 && row.span?.to===20));
        assert(after.chat.slice(1,12).some(message=>message.hidden));
        assert(after.chat.slice(-30).every(message=>!message.hidden));
        await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        await page.locator('#ri_drawer .inline-drawer-header').tap();
        const root = page.locator('#ri_root');
        const expand = root.getByRole('button',{name:'Expand',exact:true});
        if (await expand.isVisible()) await expand.tap();
        await root.getByRole('button',{name:'Story',exact:true}).tap();
        await root.getByRole('button',{name:'Corrections',exact:true}).tap();
        const editor = root.locator('#ri_panel_page');
        await editor.getByText('Find and edit source records',{exact:true}).tap();
        const beforeFact = 'An old stone pier reaches the bay';
        const afterFact = 'An old wooden pier reaches the bay';
        await editor.getByLabel('Wrong wording (optional)').fill(beforeFact);
        await editor.getByRole('button',{name:'Find source matches',exact:true}).tap();
        await editor.getByRole('status').filter({hasText:'Enter the corrected fact before saving.'}).waitFor();
        const repair = editor.locator('.ri-correction-source').filter({hasText:world+' / Pier'});
        assert.equal(await repair.count(),1);
        await editor.getByLabel('Correct story fact',{exact:true}).fill(afterFact);
        await editor.getByLabel('Regenerate the latest reply').tap();
        await repair.locator(':scope > summary').tap();
        await repair.getByText('Edit this source',{exact:true}).tap();
        await repair.getByRole('button',{name:'Use my correction text',exact:true}).tap();
        await repair.getByRole('checkbox',{name:/Apply edit/}).tap();
        await editor.getByRole('button',{name:'Apply correction',exact:true}).tap();
        await editor.getByRole('status').filter({hasText:'Saved 1 source edit'}).waitFor();
        const repaired = (await read()).durable.find(row=>row.name==='Pier');
        assert.equal(repaired.fields.what,afterFact);
        assert.equal(repaired.locked,true);
        await editor.getByRole('button',{name:'Undo source repair',exact:true}).first().tap();
        await editor.getByRole('status').filter({hasText:'Source repair undone.'}).waitFor();
        assert.equal((await read()).durable.find(row=>row.name==='Pier').fields.what,beforeFact);
        assert.equal(L.requests().length,27);
        assert.deepEqual(errors,[]);
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify({
            capture:'D-ST-H1-26',viewport:[390,760],touch:true,world,firstProviderCalls,counts:{ordinary:26,summary:1},
            sixth:sixth.status,seventh:seventh.status,after25:before.status,after26:after.status,
            chapter:after.durable.find(row=>row.span?.from===1 && row.span?.to===20)?.span,
            hidden:after.chat.filter(message=>message.hidden).length,summaryRequest:requests[0],errors,
            repair:{capture:'D-ST-source-repair',olderSourceReply:1,before:beforeFact,after:afterFact,undone:true,modelRequests:0},
        },null,2));
        console.log('PASS staged Story World plus real-host H1 capture at accepted reply 26');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
