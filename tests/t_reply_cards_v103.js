const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');
const preset = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));

(async () => {
    L.sync();
    const {browser,page} = await L.open();
    try {
        await L.setupApi(page);
        const name = 'Roleplay Instructions V10.3';
        await page.evaluate(async ({preset,name})=>{
            const c = SillyTavern.getContext();
            const retained = new Set(['main','chatHistory','worldInfoBefore','worldInfoAfter']);
            for (const row of preset.prompt_order) for (const prompt of row.order) prompt.enabled = retained.has(prompt.identifier);
            await c.getPresetManager('openai').savePreset(name,{...preset,name});
        },{preset,name});
        await L.usePreset(page,name);
        await L.setupApi(page,{preset:null});
        await page.evaluate(()=>{
            const $ = jQuery;
            $('#oai_max_context_unlocked').prop('checked',true).trigger('change');
            $('#openai_max_context').val(16384).trigger('input');
        });
        await L.openChat(page);
        await L.setSettings(page,{check:{mode:'off'},summary:{on:false},world:{head:0},scene:{card:'always'},cards:{on:false}});
        await page.evaluate(async base=>{
            const V = await import(`${base}/src/v10.js`);
            assertPaired(V.pairedPreset(),V.activePreset());
            const p = V.prefs();
            p.generatePlan = true;
            p.modules = {roast:true};
            await SillyTavern.getContext().saveMetadata();
            function assertPaired(enabled,name) { if (!enabled) throw new Error(`Companion matching failed for ${name}`); }
        },L.BASE);
        const block = data => `<story_update v="2">${JSON.stringify({v:2,...data})}</story_update>`;
        L.mode({reply:'<reply_plan>Follow the dock scene.</reply_plan>\n\nMira held up the lantern.\n'+
            block({scene:{where:'Dock',when:'Wednesday, Day 2, morning, grey clouds rolling in',present:'Mira'},
                characters:[{name:'Mira',heart:'Relieved',evidence:'Mira held up the lantern.'}],roast:'Mira finally let the light do the talking.'})});
        L.resetLog();
        await L.send(page,'I look for Mira.');
        const prompt = L.text(L.requests()[0]);
        assert.match(prompt,/put a brief outline of intended beats/i);
        assert.match(prompt,/Include this string even when no story facts changed/);
        const latest = page.locator('#chat .last_mes');
        const header = latest.locator('.ri-scene-header');
        assert.deepEqual(await header.locator('dd').allTextContents(),['morning','Wednesday, Day 2','Dock','grey clouds rolling in']);
        assert.equal(await latest.locator('.ri-v10-plan').evaluate(el=>el.open),false);
        assert.equal(await latest.locator('.ri-reply-roast').evaluate(el=>el.open),false);
        assert.match(await latest.locator('.ri-reply-roast').textContent(),/light do the talking/);
        assert.match(await latest.locator('.ri-v10-console').textContent(),/Mira/);
        assert.doesNotMatch(await latest.locator('.mes_text').textContent(),/Follow the dock scene|light do the talking/);

        L.mode({reply:'[Time: afternoon | Location: Gate]\n\nMira walked to the gate.\n'+
            block({scene:{where:'Gate',present:'Mira'}})+'\n<roast>The gate earned its own introduction.</roast>'});
        await L.send(page,'I follow Mira.');
        assert.deepEqual(await header.locator('dd').allTextContents(),['afternoon','Wednesday, Day 2','Gate','grey clouds rolling in']);
        assert.equal(await header.locator('.ri-scene-header-weather dd').getAttribute('title'),'Last established weather');
        assert.match(await latest.locator('.ri-reply-roast').textContent(),/earned its own introduction/);

        L.mode({reply:'Mira looked up.\n'+block({scene:{where:'Gate',weather:'Steady rain'}})});
        await L.send(page,'I look up too.');
        assert.equal(await header.locator('.ri-scene-header-weather dd').textContent(),'Steady rain');
        assert.equal(await latest.locator('.ri-reply-roast').count(),0);
        const issues = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.cardIssues);
        assert.ok(issues.some(issue=>issue.includes('no readable Roast')));
        assert.ok(issues.some(issue=>issue.includes('no readable outline')));
        await latest.locator('.ri-v10-console > summary').click();
        await latest.getByRole('tab',{name:'Notes',exact:true}).click();
        assert.match(await latest.getByRole('tabpanel',{name:'Notes',exact:true}).innerText(),/no readable Roast/);
        L.mode({reply:'Mira stepped off the path.\n\n<state:world>\n<time>4:15 PM</time>\n<loc>Path</loc>\n<weather>Heavy rain</weather>\n</state:world>'});
        await L.send(page,'I step aside.');
        assert.deepEqual(await header.locator('dd').allTextContents(),['4:15 PM','Wednesday, Day 2','Path','Heavy rain']);
        L.mode({reply:'Mira read the dated register.\n'+block({scene:{date:'2024-02-28',time:'11:58 PM'}})});
        await L.send(page,'I wait at the path until just before midnight.');
        L.mode({reply:'SUMMARY:\nMira waited with the register.\n\nFIRST MESSAGE:\nMira closed the register.\n<chapter_scene>{"elapsed":4}</chapter_scene>'});
        L.resetLog();
        await page.evaluate(async base=>{
            const C=await import(base+'/src/chapters.js');
            const E=await import(base+'/src/engine.js');
            const draft=await C.draftNewChapter('Four minutes later.');
            if (draft.scene.time!=='12:02 AM' || draft.scene.date!=='2024-02-29') throw new Error(JSON.stringify(draft.scene));
            await C.startNewChapter(draft,E.burnedSoFar);
        },L.BASE);
        const opening=page.locator('#chat .mes[mesid="0"] .ri-scene-header');
        assert.deepEqual(await opening.locator('dd').allTextContents(),['12:02 AM','2024-02-29','Path','Heavy rain']);
        L.mode({reply:'Mira held the door.\n'+block({scene:{elapsed:2}})});
        await L.send(page,'I follow her.');
        assert.equal(L.requests().length,2);
        assert.match(L.text(L.requests().at(-1)),/Time: 12:02 AM\nDate: 2024-02-29/);
        assert.match(L.text(L.requests().at(-1)),/Current exact story minute: 4\./);
        assert.equal(await header.locator('.ri-scene-header-time dd').textContent(),'12:04 AM');
        console.log('PASS V10.3 companion, actual planning and Roast requests, separate collapsed cards, weather recovery and missing-card diagnostics');
    } finally { await browser.close(); }
})().catch(error=>{ console.error(error); process.exitCode = 1; });
