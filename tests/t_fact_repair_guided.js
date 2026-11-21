const assert = require('node:assert/strict');
const fs = require('node:fs');
const legacy = require('./fixtures/legacy-story-memory.json');
const H = require('./h_memory.js');

function record(reply, world) {
    return {time:Date.now()+reply,items:[],type:'normal',update:{world,ops:[],ended:false,changes:[]}};
}

(async()=>{
    const {browser,page,errors} = await H.openMemory();
    try {
        const disabled = await H.assertOnlyExtension(page);
        const evidence = {host:'SillyTavern 1.19.0',viewport:[390,760],touch:true,preset:'Default',disabled};
        for (const contradiction of [true,false]) {
            await H.newWorld(page,contradiction ? 'Clear repair' : 'Ambiguous repair');
            H.resetLog();
            H.mode({reply:'The gate is open.\n<story_update>\nplace: Gate | The gate is open.\n</story_update>'});
            await H.send(page,contradiction ? 'The gate is closed.' : 'I watch the gate.');
            const sheet = await H.repairSheet(page);
            await sheet.getByRole('button',{name:'Audit world facts',exact:true}).tap();
            await H.result(sheet,'Source repair reviewed.');
            const state = await H.memory(page);
            const repair = sheet.getByText(contradiction ? /Updated sources.*Gate/ : /evidence did not establish a unique correction/);
            await repair.first().waitFor();
            assert.equal(H.requests().length,1);
            assert.equal(state.corrections.length,Number(contradiction));
            assert.equal(H.fact(state.effective,'Gate'),contradiction ? 'The gate is closed.' : 'The gate is open.');
            assert.equal(state.physical.length,0);
            evidence[contradiction ? 'clear' : 'ambiguous'] = {capture:contradiction ? 'D-ST-A28-clear' : 'D-ST-A35-ambiguous',
                correctionCount:state.corrections.length,story:state.messages.at(-1).mes,physical:state.physical,
                effective:state.effective,requestCount:H.requests().length,visibleResult:await repair.first().innerText()};
            await H.closeSheet(sheet);
        }

        await H.setSettings(page,{world:{editableReplies:-1}});
        const world = await H.newWorld(page,'Legacy managed');
        const legacyRecords = legacy.replies.map((_,index)=>record(index+1,world));
        const unrelated = await page.evaluate(async ({base,fixture,records,world})=>{
            const {KEY} = await import(base+'/src/st.js');
            const {createSet} = await import(base+'/src/books.js');
            const {newWorldEntry,writeWorldEntry,saveWorld} = await import(base+'/src/world.js');
            const {creationFingerprint} = await import(base+'/src/worldflow.js');
            const host = SillyTavern.getContext(), id = host.getCurrentChatId();
            const seed = (rows,name,manage) => {
                const data = {entries:{}};
                for (const {kind,name:title,fields,auto,locked,sourceReply} of rows) {
                    const row = newWorldEntry(data,kind);
                    Object.assign(row,{name:title,auto:!!auto,locked:!!locked,at:sourceReply ? {chat:id,n:sourceReply} : null});
                    Object.assign(row.fields,fields);
                    writeWorldEntry(data,row,name);
                    if (manage && sourceReply) records[sourceReply-1].update.changes.push({
                        uid:row.uid,name:row.name,kind:row.kind,type:'create',createdState:creationFingerprint(row),
                    });
                }
                return data;
            };
            const other = await createSet(`Separate legacy book ${Date.now()}`,'world',seed(fixture.unrelated,'',false),'');
            await saveWorld(world,seed(fixture.managed,world,true));
            fixture.replies.forEach(({player,story,scene},index)=>{
                const rec = records[index];
                if (scene) rec.scene = scene;
                host.chat.push({name:host.name1,is_user:true,mes:player,send_date:new Date(rec.time-10).toISOString(),extra:{}},
                    {name:host.name2,is_user:false,mes:story,send_date:new Date(rec.time).toISOString(),extra:{[KEY]:rec},
                        swipe_id:0,swipes:[story],swipe_info:[{send_date:new Date(rec.time).toISOString(),extra:{[KEY]:rec}}]});
            });
            delete host.chatMetadata[KEY].worldLog;
            await host.saveChat();
            await host.saveMetadata();
            await host.reloadCurrentChat();
            return other;
        },{base:H.BASE,fixture:legacy,records:legacyRecords,world});
        const preflight = await H.memory(page);
        assert.equal(preflight.messages.length,15);
        assert.equal(preflight.messages[2].rec.update.changes[0].entry,undefined);
        assert.equal(preflight.messages[2].rec.memoryRevision,undefined);

        const context = await H.tapPanel(page,'Review','Context & Memory');
        await context.getByLabel('Earlier replies kept editable',{exact:true}).selectOption('5');
        await context.getByText(/6 total editable slots/).waitFor();
        await H.closePanel(page);
        H.resetLog();
        H.mode({reply:'The gate is open beside the lantern.\n<story_update>\nplace: Pier | The lamp lights the stone pier.\nenvironment: The gate is open.\n</story_update>'});
        await H.send(page,'I watch the gate with the captain.');
        let state = await H.memory(page);
        assert.equal(H.fact(state.physical,'Gate'),'The gate is open.');
        assert.equal(H.fact(state.effective,'Pier'),'The lamp lights the stone pier.');
        assert.equal(H.fact(state.physical,'Pier'),undefined);

        const sheet = await H.repairSheet(page);
        await sheet.getByRole('button',{name:'More emotional',exact:true}).tap();
        await sheet.getByLabel('Your direction',{exact:true}).fill('The gate is closed; let the captain sound relieved.');
        H.resetLog();
        H.mode({fail:true,reply:'The gate is closed. The captain lets out a breath.'});
        await sheet.getByRole('button',{name:/^Generate alternate reply/}).tap();
        const retry = sheet.getByRole('button',{name:/Retry with the same directions/});
        await retry.waitFor({timeout:30000});
        state = await H.memory(page);
        assert.equal(H.requests().length,1);
        assert.equal(state.corrections.length,1);
        assert.equal(state.corrections[0].truth,'The gate is closed');
        assert.equal(H.fact(state.physical,'Gate'),'The gate is closed.');
        assert(state.corrections[0].sources.some(source=>source.kind==='world' && source.evidenceAt===2));
        assert(state.corrections[0].sources.some(source=>source.kind==='scene' && source.evidenceAt===14));
        assert(!JSON.stringify(state.corrections).includes('captain sound relieved'));
        const failed = H.requests()[0];
        const correctionId = state.corrections[0].id;
        H.mode({reply:'The gate is closed. The captain lets out a breath.\n<story_update>\nplace: Courtyard | The courtyard lies beyond the tower.\n</story_update>'});
        await retry.tap();
        await H.result(sheet,'Reply updated.');
        const execution = sheet.locator('details.ri-execution').filter({hasText:'How it ran · multiple stages'});
        await execution.locator(':scope > summary').tap();
        await execution.getByText('Runs in code',{exact:true}).waitFor();
        await execution.getByText('Uses the reply request',{exact:true}).waitFor();
        const receipt = await execution.innerText();
        const regenerated = await H.memory(page);
        assert.equal(H.requests().length,2);
        assert.equal(regenerated.corrections.length,1);
        assert.equal(regenerated.corrections[0].id,correctionId);
        const playerDirection = 'The gate is closed; let the captain sound relieved.';
        const styleDirection = 'Let the responding character show what they feel through what they say and do.';
        for (const sent of H.requests()) {
            assert.equal(H.text(sent).split(playerDirection).length-1,1);
            assert.equal(H.text(sent).split(styleDirection).length-1,1);
        }
        assert.equal(H.fact(regenerated.effective,'Courtyard'),'The courtyard lies beyond the tower.');
        assert.equal(H.fact(regenerated.effective,'Pier'),undefined);
        assert.equal(H.fact(regenerated.physical,'Compass'),'The compass points north.');
        const originalSelector = sheet.getByLabel('Selected version',{exact:true});
        await originalSelector.selectOption('0');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1).swipe_id===0);
        await sheet.getByText(/swipe 1 · revision/).first().waitFor();
        const original = await H.memory(page);
        assert.match(original.messages.at(-1).mes,/gate is open beside the lantern/);
        assert.equal(H.fact(original.effective,'Pier'),'The lamp lights the stone pier.');
        assert.equal(H.fact(original.effective,'Courtyard'),undefined);
        assert.equal(H.fact(original.physical,'Gate'),'The gate is closed.');
        await originalSelector.selectOption('1');
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1).swipe_id===1);
        await sheet.getByText(/swipe 2 · revision/).first().waitFor();
        await H.closeSheet(sheet);

        const repairs = await H.tapPanel(page,'Story','Corrections');
        await repairs.locator('details.ri-card').filter({hasText:'The gate is closed'}).last().locator(':scope > summary').tap();
        await repairs.getByRole('button',{name:'Undo source repair',exact:true}).last().tap();
        await page.waitForFunction(()=>!SillyTavern.getContext().chatMetadata.roleplay_instructions.storyCorrections?.length);
        const undone = await H.memory(page);
        assert.match(undone.messages.at(-1).mes,/lets out a breath/);
        assert.equal(H.fact(undone.physical,'Gate'),'The gate is open.');
        assert.equal(H.fact(undone.physical,'Compass'),'The compass points north.');
        const unaffected = await page.evaluate(async ({base,name})=>{
            const {loadDurableWorld} = await import(base+'/src/worldflow.js');
            const {listWorld} = await import(base+'/src/world.js');
            return listWorld(await loadDurableWorld(name),name);
        },{base:H.BASE,name:unrelated});
        assert.equal(H.fact(unaffected,'Gate'),'The gate is open.');
        assert.equal(H.requests().length,2);
        assert.deepEqual(errors,[]);
        evidence.combined = {capture:'D-ST-A35-A40',fixture:'legacy-story-memory.json',correctionId,attempts:[failed,H.requests()[1]],receipt,
            oldSource:regenerated.corrections[0].sources,corrected:regenerated.physical,originalSwipeFacts:original.effective,
            alternateFacts:regenerated.effective,afterUndo:undone.physical,unrelated:unaffected,status:'failed then explicit retry'};
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
        console.log('PASS generic audit, ambiguous evidence, combined one-attempt recovery, swipes and legacy source ownership');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
