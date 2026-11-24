const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./h_memory.js');

const place = (name,description)=>`place: ${name} | ${description}`;
const answer = (prose,...lines)=>prose+'\n<story_update>\n'+lines.join('\n')+'\n</story_update>';

(async()=>{
    const {browser,page,errors} = await H.openMemory();
    try {
        const disabled = await H.assertOnlyExtension(page);
        const world = await H.newWorld(page,'Editable mixed timeline');
        await page.evaluate(async base=>{
            (await import(base+'/src/v10.js')).prefs().enabled = true;
            await SillyTavern.getContext().saveMetadata();
        },H.BASE);
        H.resetLog();
        const originalBell = 'The ivory bell rests on the oak table.';
        const bridge = 'A tall stone bridge spans the river.';
        const sample = [
            [originalBell+' '+bridge,[place('Bell Chamber',originalBell),place('Bridge',bridge)]],
            ['A red seal hangs above the gate.',[place('Original Gate','A red seal hangs above the gate.')]],
            ['A silver lamp shines in the hall.',[place('Silver Hall','A silver lamp shines in the hall.')]],
            ['An amber light flickers by the pier.',[place('Amber Pier','An amber light flickers by the pier.')]],
            ['Wind stirs leaves in the orchard.',[place('Orchard','Wind stirs leaves in the orchard.')]],
            ['The old tower overlooks the city.',[place('Old Tower','The old tower overlooks the city.')]],
        ];
        for (const [index,[prose,lines]] of sample.entries()) {
            H.mode({reply:answer(prose,...lines)});
            await H.send(page,`I investigate place ${index+1}.`);
            if (index===1) {
                const replacement = 'A blue ribbon hangs above the gate.';
                H.mode({reply:answer(replacement,place('Revised Gate',replacement))});
                await H.openReplyAction(page,'swipe');
                const sheet = page.getByRole('dialog',{name:'Generate an alternate reply'});
                await sheet.getByLabel('Your direction',{exact:true}).fill('Replace the red seal with a blue ribbon.');
                await sheet.getByRole('button',{name:'Generate alternate reply',exact:true}).tap();
                await H.result(sheet,'Reply updated.');
                assert.equal(H.fact((await H.memory(page)).effective,'Revised Gate'),replacement);
                await H.closeSheet(sheet);
            }
        }
        const six = await H.memory(page);
        assert.equal(six.journal.filed,0);
        assert.equal(six.journal.pending,6);
        assert.equal(six.physical.length,0);
        assert.equal(six.effective.length,7);
        assert.equal(H.fact(six.effective,'Original Gate'),undefined);
        const newest = six.messages.at(-1);
        const extra = 'A blue lantern lights the tower stair.';
        H.mode({reply:answer(extra,place('Tower Stair',extra))});
        await H.openReplyAction(page,'continue');
        const continuation = page.getByRole('dialog',{name:'Continue this reply'});
        await continuation.getByRole('button',{name:'Continue this reply',exact:true}).tap();
        await H.result(continuation,'Reply updated.');
        await H.closeSheet(continuation);
        const continued = await H.memory(page);
        assert(continued.messages.at(-1).mes.startsWith(newest.mes));
        assert.equal(continued.messages.at(-1).rec.time,newest.rec.time);
        assert.equal(continued.journal.pending,6);
        assert.equal(H.fact(continued.effective,'Tower Stair'),extra);
        assert.equal(continued.physical.length,0);

        await H.openQuickActions(page);
        await page.getByRole('dialog',{name:'Quick actions'}).getByRole('button',{name:'Draft my reply',exact:true}).tap();
        const draft = page.getByRole('dialog',{name:'Draft my reply'});
        H.mode({});
        await draft.getByRole('button',{name:'Give me choices · 1 model call',exact:true}).tap();
        await H.result(draft,'3 of 3 choices received.');
        await H.closeSheet(draft);
        const helped = await H.memory(page);
        assert.equal(helped.messages.length,six.messages.length);
        assert.equal(helped.journal.pending,6);
        assert.equal(helped.physical.length,0);

        const oldest = page.locator('#chat .mes[mesid="2"]');
        const beforeMark = helped.messages[2].rec.update.pending.revision;
        await oldest.locator('summary').filter({hasText:'Story state'}).first().tap();
        await oldest.getByRole('tab',{name:'Facts',exact:true}).tap();
        await oldest.getByText(originalBell,{exact:true}).last().waitFor();
        await oldest.locator('.mes_edit').tap({force:true});
        const editedProse = 'The ivory bell sits by the wall. '+bridge;
        await oldest.locator('textarea.edit_textarea').fill(editedProse);
        await oldest.locator('.mes_edit_done').tap();
        await page.waitForFunction(()=>/evidence/.test(SillyTavern.getContext().chat[2].extra.roleplay_instructions.memoryUncertain || ''));
        const edited = await H.memory(page);
        assert.equal(edited.messages[2].mes,editedProse);
        assert.notEqual(edited.messages[2].rec.update.pending.revision.fingerprint,beforeMark.fingerprint);
        assert.equal(edited.messages[2].rec.update.pending.changes.length,1);
        assert.equal(H.fact(edited.effective,'Bell Chamber'),undefined);
        assert.equal(H.fact(edited.effective,'Bridge'),bridge);
        assert.equal(edited.physical.length,0);
        const details = oldest.locator('details.ri-v10-console').filter({hasText:'Story state'});
        if (!await details.evaluate(node=>node.open)) await details.locator(':scope > summary').tap();
        await oldest.getByRole('tab',{name:'Facts',exact:true}).tap();
        await oldest.getByText('Recent · editable',{exact:true}).waitFor();
        await oldest.getByText(bridge,{exact:true}).first().waitFor();
        assert.equal(await oldest.getByText(originalBell,{exact:true}).count(),0);

        H.mode({reply:answer('A lantern swings above the bridge.',place('New Lantern','A lantern swings above the bridge.'))});
        await H.send(page,'I look across the Bridge toward the tower.');
        const modelRequest = H.requests().at(-1);
        assert(!H.text(modelRequest).includes(originalBell));
        assert(H.text(modelRequest).includes(bridge));
        const seventh = await H.memory(page);
        assert.equal(seventh.journal.filed,1);
        assert.deepEqual(seventh.physical.map(row=>row.name),['Bridge']);
        assert.equal(seventh.messages[2].rec.update.filedByJournal[0].revision.fingerprint,
            edited.messages[2].rec.update.pending.revision.fingerprint);
        const savedChat = await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId());
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>globalThis.SillyTavern?.getContext && !document.getElementById('preloader'),{},{timeout:45000});
        if (await page.evaluate(()=>SillyTavern.getContext().getCurrentChatId())!==savedChat) {
            await H.openChat(page,{fresh:false});
            await page.evaluate(async name=>SillyTavern.getContext().openCharacterChat(name.replace(/\.jsonl$/,'')),savedChat);
        }
        await page.waitForFunction(()=>SillyTavern.getContext().chat.length===15,{},{timeout:45000});
        const reloaded = await H.memory(page);
        assert.equal(reloaded.world,world);
        assert.deepEqual(reloaded.physical,seventh.physical);
        assert.deepEqual(reloaded.effective,seventh.effective);
        assert.equal(reloaded.messages[2].mes,editedProse);
        assert.equal(H.requests().length,10);
        assert.deepEqual(errors,[]);
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify({
            capture:'D-ST-A36',host:'SillyTavern 1.19.0',viewport:[390,760],touch:true,preset:'Default',disabled,
            world,ordinary:7,swipe:1,continuation:1,helper:1,oldest:{before:beforeMark,edited:edited.messages[2].rec.update.pending.revision,prose:editedProse},
            six:six.journal,continued:continued.journal,helped:helped.journal,afterEdit:edited.journal,reloaded:reloaded.journal,
            physical:reloaded.physical,effective:reloaded.effective,modelRequest,errors,
        },null,2)+'\n');
        console.log('PASS touch swipe, continuation, helper, old edit, edited promotion and reload');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
