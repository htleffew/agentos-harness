const fs = require('node:fs');
const assert = require('node:assert/strict');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors} = await L.open({width:390,height:760,hasTouch:true,isMobile:true,
        setupPage:page=>page.route('**/api/horde/**',route=>route.fulfill({json:route.request().url().endsWith('/status') ? {ok:true} : []}))});
    try {
        page.setDefaultTimeout(12000);
        await L.setupApi(page,{legacyAutomation:false});
        await L.setSettings(page,{check:{mode:'off'},world:{editableReplies:-1,update:'all',build:0,head:0},summary:{on:false}});
        await L.openChat(page);
        const world = await page.evaluate(async base=>{
            const {createSet} = await import(base+'/src/books.js');
            const {setChatWorld} = await import(base+'/src/world.js');
            const name = await createSet(`Historical Memory ${Date.now()}`,'world',{entries:{}},'');
            setChatWorld(name);
            return name;
        },L.BASE);
        const read = () => page.evaluate(async ({base,world})=>{
            const {loadDurableWorld,worldIdle} = await import(base+'/src/worldflow.js');
            const {listWorld} = await import(base+'/src/world.js');
            await worldIdle();
            const rows = listWorld(await loadDurableWorld(world),world);
            const messages = SillyTavern.getContext().chat.map(message=>({
                text:message.mes,swipe:message.swipe_id,uncertain:message.extra?.roleplay_instructions?.memoryUncertain || '',
            }));
            return {rows,messages};
        },{base:L.BASE,world});
        const later = 'Rey touched the tower door. The gate is open.';
        L.mode({reply:'Rey pocketed the heavy brass key.\n<story_update>\nperson: Rey | Courier | Rey pocketed the heavy brass key\n</story_update>'});
        await L.send(page,'Rey walks beside me.');
        L.mode({reply:later+'\n<story_update>\nknows: Rey | The brass key opens the tower\nplace: Gate | The gate is open.\n</story_update>'});
        await L.send(page,'I wait at the tower.');
        const initial = await read();
        assert.equal(initial.rows.find(row=>row.name==='Rey').fields.knows,'The brass key opens the tower');
        await L.setSettings(page,{world:{editableReplies:5}});

        L.resetLog();
        L.mode({reply:'The heavy brass key stays on the desk.'});
        await page.locator('#chat .mes[mesid="2"]').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
        const sheet = page.getByRole('dialog',{name:'Generate an alternate reply'});
        const disclosure = await sheet.getByText(/1 later replies and 1 dependent cards/).innerText();
        await sheet.getByLabel('Your direction',{exact:true}).fill('Rey leaves the key on the desk.');
        await sheet.getByRole('button',{name:'Generate alternate reply · 1 model call',exact:true}).tap();
        await sheet.getByRole('status').filter({hasText:'Reply updated.'}).waitFor();
        const replaced = await read();
        assert.equal(replaced.messages[2].text,'The heavy brass key stays on the desk.');
        assert.equal(replaced.messages[4].text,later);
        assert.match(replaced.messages[4].uncertain,/earlier reply/);
        assert.deepEqual(replaced.rows.map(row=>row.name),['Gate']);
        assert.equal(L.requests().length,1);
        const generated = L.requests()[0];
        assert(!L.text(generated).includes(later));
        await sheet.getByRole('button',{name:'Close',exact:true}).tap();

        const corrections = page.locator('#chat .last_mes .ri-guided-correction');
        await corrections.locator(':scope > summary').tap();
        await corrections.getByLabel('Correct story fact',{exact:true}).fill('The gate is closed.');
        await corrections.getByRole('button',{name:'Repair facts only',exact:true}).tap();
        await corrections.getByRole('status').filter({hasText:/repaired 1/}).waitFor();
        const repaired = await read();
        assert.equal(repaired.rows.find(row=>row.name==='Gate').fields.what,'The gate is closed.');
        assert.equal(repaired.messages[4].text,later);
        assert.equal(L.requests().length,1);
        assert.deepEqual(errors,[]);
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify({
            capture:'D-ST-H3',viewport:[390,760],touch:true,disclosure,ordinaryBeforeReplacement:2,
            additionalReplacementAttempts:1,additionalRepairAttempts:0,world,initial,replaced,repaired,generated,errors,
        },null,2));
        console.log('PASS historical touch-guided replacement and filed source repair');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
