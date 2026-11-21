const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./h_memory.js');

const update=(prose,...lines)=>prose+'\n<story_update>\n'+lines.join('\n')+'\n</story_update>';

(async()=>{
    const {browser,page,errors} = await H.openMemory();
    try {
        const disabled=await H.assertOnlyExtension(page);
        const world=await H.newWorld(page,'Dependent editable facts');
        await page.evaluate(async ({base,world})=>{
            const {prefs}=await import(base+'/src/v10.js');
            const {newWorldEntry,writeWorldEntry,loadWorld,saveWorld}=await import(base+'/src/world.js');
            prefs().enabled=true;
            const data=await loadWorld(world);
            const row=Object.assign(newWorldEntry(data,'place'),{name:'Lighthouse',locked:true});
            row.fields.what='A lighthouse stands at the eastern headland.';
            writeWorldEntry(data,row,world);
            await saveWorld(world,data);
            await SillyTavern.getContext().saveMetadata();
        },{base:H.BASE,world});
        H.resetLog();
        const pier='An old stone pier reaches the water.';
        const claim='Rey carries the heavy brass key.';
        H.mode({reply:update('Rey pocketed the heavy brass key. '+pier,
            'person: Rey | Courier | Rey pocketed the heavy brass key.',
            'place: Pier | '+pier,'environment: '+claim)});
        await H.send(page,'I watch Rey at the pier.');
        const later='Rey checks inside his coat. Lanterns shine across the dock.';
        H.mode({reply:update(later,'knows: Rey | '+claim,'place: Dock | Lanterns shine across the dock.','environment: '+claim)});
        await H.send(page,'I follow him toward the dock.');
        const before=await H.memory(page);
        assert.equal(H.fact(before.effective,'Rey','knows'),claim.replace(/\.$/,''));
        assert.match(before.messages[4].rec.scene.environment,/^Rey carries the heavy brass key\.?$/);
        assert.deepEqual(before.physical.map(row=>row.name),['Lighthouse']);
        const laterReply=page.locator('#chat .mes[mesid="4"]');
        const story=laterReply.locator('details.ri-v10-console').filter({hasText:'Story state'});
        await story.locator(':scope > summary').tap();
        await story.getByRole('tab',{name:'Knowledge',exact:true}).tap();
        await story.locator('[role="tabpanel"]:visible').getByText(/Rey carries the heavy brass key/).first().waitFor();
        const first=page.locator('#chat .mes[mesid="2"]');
        const revised='The heavy brass key stays on the desk. '+pier;
        await first.locator('.mes_edit').tap({force:true});
        await first.locator('textarea.edit_textarea').fill(revised);
        await first.locator('.mes_edit_done').tap();
        await page.waitForFunction(()=>/current Story World/.test(
            SillyTavern.getContext().chat[4].extra.roleplay_instructions.memoryUncertain || ''));
        const after=await H.memory(page);
        assert.equal(after.messages[2].mes,revised);
        assert.equal(after.messages[4].mes,later);
        assert(!after.messages[4].rec.scene.environment?.includes('carries the heavy brass key'));
        assert.deepEqual(after.effective.map(row=>row.name),['Dock','Lighthouse','Pier']);
        assert.deepEqual(after.physical,before.physical);
        assert.equal(H.requests().length,2);
        if (!await story.evaluate(node=>node.open)) await story.locator(':scope > summary').tap();
        await story.getByRole('tab',{name:'Knowledge',exact:true}).tap();
        await story.getByText(/Some changes could not be applied to the current Story World/).waitFor();
        assert.equal(await story.getByText(/Rey carries the heavy brass key/).count(),0);
        H.mode({reply:'Rey pauses to look out across the water.'});
        await H.send(page,'What can Rey see from the Dock and Pier by the Lighthouse?');
        const request=H.requests().at(-1);
        assert(H.text(request).includes(revised));
        assert(H.text(request).includes('- Dock (Lanterns shine across the dock).'));
        assert(H.text(request).includes('- Lighthouse (A lighthouse stands at the eastern headland).'));
        assert(H.text(request).includes('- Pier (An old stone pier reaches the water).'));
        assert(!H.text(request).includes(claim.replace(/\.$/,'')));
        assert.equal(H.requests().length,3);
        assert.deepEqual(errors,[]);
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify({
            capture:'D-ST-A37',host:'SillyTavern 1.19.0',viewport:[390,760],touch:true,preset:'Default',disabled,
            beforeScene:before.messages[4].rec.scene,afterScene:after.messages[4].rec.scene,
            originalEffective:before.effective,revisedEffective:after.effective,physical:after.physical,
            diagnostic:after.messages[4].rec.memoryUncertain,laterProse:later,ordinary:3,additional:0,request,errors,
        },null,2)+'\n');
        console.log('PASS revised pending dependency, surviving facts, touch cards and assembled recall');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
