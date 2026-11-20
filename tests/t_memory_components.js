const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');
const companion = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open();
    try {
        await L.setupApi(page);
        const preset=structuredClone(companion);
        preset.name='Host-owned writing fixture';
        preset.prompts.find(p=>p.identifier==='main').content='HOST-WRITING: Continue in the selected author style.';
        preset.prompts=preset.prompts.filter(p=>!p.identifier.startsWith('ri-craft-'));
        for (const group of preset.prompt_order) group.order=group.order.filter(row=>!row.identifier.startsWith('ri-craft-'));
        await page.evaluate(preset=>SillyTavern.getContext().getPresetManager('openai').savePreset(preset.name,preset),preset);
        await L.usePreset(page,preset.name);
        await L.setupApi(page,{preset:null});
        await L.setSettings(page,{world:{head:100,update:'all'},scene:{track:true,card:'always'},dice:{on:true},
            summary:{on:true,hide:true,keepShown:4,every:3,onSceneEnd:true}});
        await L.openChat(page);
        await L.makeSet(page,`Memory-only test set ${Date.now()}`,[{versions:['A1'],chance:100}]);
        await page.evaluate(async B=>{
            const V=await import(`${B}/src/v10.js`);
            const {saveBook}=await import(`${B}/src/st.js`);
            const {blankEntry}=await import(`${B}/src/books.js`);
            const base=`Memory test lore ${Date.now()}`;
            await saveBook(base,{entries:{0:{...blankEntry(0),constant:true,useProbability:false,content:'BASE-MEMORY-MARKER: The ferry runs at dusk.'}}});
            await V.pinBase(base);
            const guidance=`Memory test guidelines ${Date.now()}`;
            await V.createGuidelines(guidance,'EXTENSION-WRITING-MARKER');
            V.prefs().guidelines=guidance;
            V.prefs().enabled=true;
        },L.BASE);
        await page.locator('[data-ri-page="v10"]').evaluate(el=>el.click());
        const pick=(label,value)=>page.locator(`#ri_root select[aria-label="${label}"]`).evaluate((node,value)=>{
            node.value=value;
            node.dispatchEvent(new Event('change',{bubbles:true}));
        },value);
        await pick('Story workflow for this chat','memory');
        assert.equal(await page.locator('[aria-label="Story workflow for this chat"]').inputValue(),'memory');
        const chapter={title:'Ferry signed',summary:'CHAPTER-MEMORY-MARKER: Mira signed the ferry ledger.',when:'Evening',people:['Mira'],places:['The ferry']};
        const reply='Mira signed the ledger.\n<state:world>RAW-HOST-STATE</state:world>';
        const send=async text=>{
            L.mode({reply,goal:JSON.stringify(chapter)});
            L.resetLog();
            await L.send(page,text);
            const requests=L.requests();
            const chat=requests.find(x=>x.answer===reply);
            assert(chat);
            const wire=L.text(chat);
            assert.match(wire,/HOST-WRITING/);
            assert.doesNotMatch(wire,/thing A1|EXTENSION-WRITING-MARKER|<story_update|Resolved action check|d20|Current exact story minute/);
            assert.equal(await page.locator('#chat .last_mes .ri-guided, #chat .last_mes .ri-scene-header, #chat .last_mes .ri-v10-console').count(),0);
            return wire;
        };
        assert.match(await send('Old dialogue one.'),/BASE-MEMORY-MARKER/);
        assert.match(await send('Old dialogue two.'),/RAW-HOST-STATE/);
        await send('I watch the ledger.');
        await page.waitForFunction(async B=>{
            const V=await import(`${B}/src/v10.js`);
            return (await V.rowsForWorld()).some(row=>row.kind==='chapter' && row.fields.summary.includes('CHAPTER-MEMORY-MARKER'));
        },L.BASE);
        assert.equal(L.requests().length,2);
        assert.doesNotMatch(L.text(L.requests()[1]),/RAW-HOST-STATE/);
        await page.waitForFunction(()=>SillyTavern.getContext().chat[1].is_system===true);
        await pick('World Info recall','off');
        const recalled=await send('I leave the ferry.');
        assert.match(recalled,/CHAPTER-MEMORY-MARKER/);
        assert.doesNotMatch(recalled,/Old dialogue one|BASE-MEMORY-MARKER/);
        await pick('Auto-hide summarized messages','off');
        await page.waitForFunction(()=>!SillyTavern.getContext().chat[1].is_system);
        const restored=await send('I walk home.');
        assert.match(restored,/CHAPTER-MEMORY-MARKER/);
        assert.match(restored,/Old dialogue one/);
        await pick('Chapter summaries','off');
        await pick('World Info recall','on');
        const factsOnly=await send('The ferry sails on.');
        assert.match(factsOnly,/BASE-MEMORY-MARKER/);
        assert.doesNotMatch(factsOnly,/CHAPTER-MEMORY-MARKER/);
        assert.equal(L.requests().length,1);
        assert.deepEqual(errors,[]);
        console.log('PASS memory profile: host-owned writing and state, separate lore and chapters, chapter request, auto-hide and restoration');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
