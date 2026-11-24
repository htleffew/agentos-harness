// Verify which source reached an actual assembled SillyTavern request.
const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const companion = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json',`file://${__filename}`)));

(async () => {
    L.sync();
    const {browser,page,errors} = await L.open();
    const ext = (fn,value) => page.evaluate(fn,{B:L.BASE,value});
    // The Presets card owns the choice (B27): the module row shows a link to its switch, no select, and the stored owner follows the card.
    const checkOwner = async expected => {
        const row = page.locator('#ri_root [data-module="relationships"]');
        assert.equal(await row.locator('#ri-owner-relationships').count(),0);
        assert.equal(await row.locator('[data-home-link="feature-owner"]').count(),1);
        assert.equal(await row.getByText('Recheck these host blocks').count(),0);
        assert.equal(await ext(async({B})=>(await import(`${B}/src/v10.js`)).moduleOwnership().relationships?.choice),expected);
    };
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
        // B5's shell has no page chooser; Preset & Extension (Setup, Features) opens through the shell.
        const openModules = () => ext(async({B})=>{ const {app}=await import(`${B}/src/ui/panel.js`); await app.openPage('v10',{focusPage:true}); });
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
        assert.match(await row.textContent(),/Extension default for this preset: Off/);
        await scope('chat');
        assert.match(await row.textContent(),/Off in this chat/);
        assert.match(await row.textContent(),/Following the extension default saved for this preset/);
        L.resetLog();
        assert.equal(n(await send('Is anyone at the door?'),extensionRule),0);
        await set('on');
        assert.match(await row.textContent(),/On in this chat/);
        assert.equal(n(await send('I listen.'),extensionRule),1);
        await row.locator('button').filter({hasText:'Use extension default for this preset (Off)'}).evaluate(el=>el.click());
        assert.equal(n(await send('I wait.'),extensionRule),0);
        await setting.evaluate(el=>el.focus());
        await switchTo(imported);
        // The page no longer prints "Active preset: <name>"; wait for the extension to see the switch, then redraw.
        await page.waitForFunction(async ({B,name})=>(await import(`${B}/src/v10.js`)).activePreset()===name,{B:L.BASE,name:imported.name});
        // The imported preset is a recognised one with two name-matched blocks, so the Presets card owns the sides:
        // a memory feature starts on Ours, and Theirs hands it to the host preset. The module page mirrors that choice.
        const sides = side => ext(async({B,value})=>{
            const wb=await import(`${B}/src/preset-workbench.js`), context=wb.switchContext();
            wb.setSwitches(context,Object.fromEntries(context.features.switched.map(item=>[item.key,value])));
            (await import(`${B}/src/ui/panel.js`)).app.render();
        },side);
        await sides('theirs');
        await openModules();
        assert.match(await row.textContent(),/Internal States Template · On in host preset/);
        assert.equal(await page.locator('#ri_root').getByLabel('Request a reply plan',{exact:true}).count(),0);
        assert.equal(await row.locator('#ri-module-relationships').count(),0);
        await checkOwner('preset');
        let text = await send('I knock.');
        assert.match(text,/HOST-ANTITHESIS-FIXTURE/);
        assert.doesNotMatch(text,/Scene and character checks:/);
        assert.equal(n(text,hostRule),1);
        assert.equal(n(text,extensionRule),0);
        await sides('ours');
        await openModules();
        await checkOwner('both');
        assert.equal(await row.locator('#ri-module-relationships').isDisabled(),false);
        text = await send('I take one step inside.');
        assert.doesNotMatch(text,/HOST-ANTITHESIS-FIXTURE/);
        assert.match(text,/Scene and character checks:/);
        assert.equal(n(text,hostRule),0);
        assert.equal(n(text,extensionRule),1);
        await set('off');
        assert.match(await row.textContent(),/The extension is selected. Turn the module on/);
        text=await send('I pause.');
        assert.equal(n(text,hostRule),0);
        assert.equal(n(text,extensionRule),0);
        await switchTo(companion);
        assert.equal(n(await send('I close the door.'),extensionRule),0);
        await openModules();
        await scope('preset');
        await row.locator('button').filter({hasText:'Use extension factory default (On)'}).evaluate(el=>el.click());
        assert.match(await row.textContent(),/Extension default for this preset: On/);
        await page.evaluate(()=>{
            const order=SillyTavern.getContext().chatCompletionSettings.prompt_order.find(row=>row.character_id===100001);
            order.order.find(row=>row.identifier==='ri-check-physical').enabled=true;
        });
        text=await send('I hold the door open.');
        assert.match(text,/Check positions, physical reach, lines of sight/);
        assert.doesNotMatch(text,/Ground the action in the established surroundings/);
        assert.match(text,/Give NPCs practical aims of their own/);
        await ext(async({B})=>(await import(`${B}/src/ui/panel.js`)).app.openPage('writing'));
        await page.locator('#ri_root').getByText('Host preset · Check: Physical',{exact:true}).waitFor({state:'attached'});
        assert.equal(L.requests().length,8);
        assert.deepEqual(errors,[]);
        console.log('PASS module ownership: inherited preset values, chat override and reset, separate preset blocks and exclusive instructions on the wire.');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
