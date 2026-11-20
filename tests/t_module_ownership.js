// Verify which source reached an actual assembled SillyTavern request.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const companion = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));

(async () => {
    L.sync();
    const {browser,page,errors} = await L.open();
    const ext = (fn,value) => page.evaluate(fn,{B:L.BASE,value});
    const imported = structuredClone(companion);
    imported.name = 'Imported ownership fixture';
    const prompt = {identifier:'vexa-internal-fixture',name:'Internal States Template',system_prompt:false,injection_position:0,role:'system',content:'HOST-INTERNAL-STATES-PROMPT'};
    const route = {...prompt,identifier:'vexa-routing-fixture',name:'Antithesis - Boot',content:'HOST-ANTITHESIS-FIXTURE'};
    imported.prompts.push(prompt,route);
    for (const group of imported.prompt_order) group.order.splice(1,0,
        ...[prompt,route].map(block=>({identifier:block.identifier,enabled:true})));
    const savePreset = preset=>page.evaluate(preset=>SillyTavern.getContext().getPresetManager('openai').savePreset(preset.name,preset),preset);
    const switchTo = async preset=>{
        await L.usePreset(page,preset.name);
        await L.setupApi(page,{preset:null});
        await L.setSettings(page,{check:{mode:'off'},world:{head:0},scene:{card:'always'}});
    };
    const send = async text=>{
        L.mode({reply:'Mira waits at the door.'});
        await L.send(page,text);
        return L.text(L.requests().at(-1));
    };
    const n = (text,phrase)=>text.split(phrase).length-1;
    const extensionRule = 'For a relationship use subject and other';
    const hostRule = 'HOST-INTERNAL-STATES-PROMPT';
    try {
        await L.setupApi(page);
        await savePreset(companion);
        await savePreset(imported);
        await switchTo(companion);
        await L.openChat(page);
        await ext(async({B})=>(await import(`${B}/src/v10.js`)).prefs().enabled=true);
        const row = page.locator('#ri_root [data-module="relationships"]');
        const openModules = () => page.locator('#ri_root [data-ri-page="v10"]').evaluate(el=>el.click());
        const scope = value => page.locator(`#ri_root [data-module-scope="${value}"]`).evaluate(el=>el.click());
        const setting = row.locator('#ri-module-relationships');
        const set = value => setting.evaluate((el,value)=>{
            el.value=value;
            el.dispatchEvent(new Event('change',{bubbles:true}));
        },value);
        await openModules();
        await scope('preset');
        assert.deepEqual(await setting.locator('option').allTextContents(),['On','Off']);
        await set('off');
        assert.match(await row.textContent(),/Default for this preset: Off/);
        await scope('chat');
        assert.match(await row.textContent(),/Off in this chat/);
        assert.match(await row.textContent(),/Following the preset setting/);
        L.resetLog();
        assert.equal(n(await send('Is anyone at the door?'),extensionRule),0);
        await set('on');
        assert.match(await row.textContent(),/On in this chat/);
        assert.equal(n(await send('I listen.'),extensionRule),1);
        await row.locator('button').filter({hasText:'Reset to preset setting (Off)'}).evaluate(el=>el.click());
        assert.equal(n(await send('I wait.'),extensionRule),0);
        await switchTo(imported);
        await openModules();
        assert.match(await row.textContent(),/Internal States Template · On in host preset/);
        assert.equal(await row.locator('#ri-module-relationships').isDisabled(),true);
        assert.equal(await row.locator('#ri-owner-relationships').inputValue(),'preset');
        let text = await send('I knock.');
        assert.match(text,/HOST-ANTITHESIS-FIXTURE/);
        assert.doesNotMatch(text,/Scene and character checks:/);
        assert.equal(n(text,hostRule),1);
        assert.equal(n(text,extensionRule),0);
        await row.locator('#ri-owner-relationships').evaluate(input=>{
            input.value='extension';input.dispatchEvent(new Event('change',{bubbles:true}));
        });
        assert.match(await row.textContent(),/waiting for these blocks to be off/);
        text = await send('I knock again.');
        assert.equal(n(text,hostRule),1);
        assert.equal(n(text,extensionRule),0);
        // Simulate toggling the host's own prompt in its editor.
        await page.evaluate(ids=>{
            const order=SillyTavern.getContext().chatCompletionSettings.prompt_order.find(row=>row.character_id===100001);
            for (const id of ids) order.order.find(row=>row.identifier===id).enabled=false;
        },[prompt.identifier,route.identifier]);
        await page.locator('#ri_root button').filter({hasText:'Refresh source status'}).evaluate(button=>button.click());
        assert.match(await row.textContent(),/Internal States Template · Off in host preset/);
        assert.equal(await row.locator('#ri-module-relationships').isDisabled(),false);
        text = await send('I take one step inside.');
        assert.doesNotMatch(text,/HOST-ANTITHESIS-FIXTURE/);
        assert.match(text,/Scene and character checks:/);
        assert.equal(n(text,hostRule),0);
        assert.equal(n(text,extensionRule),1);
        await switchTo(companion);
        assert.equal(n(await send('I close the door.'),extensionRule),0);
        await openModules();
        await scope('preset');
        await row.locator('button').filter({hasText:'Reset to extension setting (On)'}).evaluate(el=>el.click());
        assert.match(await row.textContent(),/Default for this preset: On/);
        assert.equal(L.requests().length,7);
        assert.deepEqual(errors,[]);
        console.log('PASS module ownership: inherited preset values, chat override and reset, separate preset blocks and exclusive instructions on the wire.');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
