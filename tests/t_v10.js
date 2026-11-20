const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const preset = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json', `file://${__filename}`)));

const block = (prose, data) => `${prose}\n<story_update v="2">${JSON.stringify({v:2,...data})}</story_update>`;
const story = (page, fn, value) => page.evaluate(fn,{B:L.BASE,value});

(async () => {
    L.sync();
    const {browser,page,errors} = await L.open();
    try {
        await L.setupApi(page);
        await story(page,async({value})=>{
            await SillyTavern.getContext().getPresetManager('openai').savePreset(value.name,value);
        },preset);
        await L.usePreset(page,preset.name);
        await L.setupApi(page,{preset:null});
        await L.setSettings(page,{check:{mode:'off'},world:{update:'all',head:0},scene:{card:'always'}});
        await L.openChat(page);
        await story(page,async({B})=>{
            const V=await import(`${B}/src/v10.js`);
            if (!V.enabledV10()) throw new Error(`Companion did not activate V10: ${V.activePreset()}`);
            V.savePresetDefault(V.activePreset(),'relationships',undefined);
            const {saveBook}=await import(`${B}/src/st.js`);
            const {blankEntry}=await import(`${B}/src/books.js`);
            const base=`Harbor canon ${Date.now()}`;
            await saveBook(base,{entries:{0:{...blankEntry(0),key:['dock'],constant:false,useProbability:false,comment:'Harbor marker',content:'THE-HARBOR-MARKER: The dock is public.'}}});
            await V.pinBase(base);
            const guidelines=`Harbor guidance ${Date.now()}`;
            await V.createGuidelines(guidelines,'REACTION-GUIDE: Use restrained reactions.');
            await saveBook(guidelines,{entries:{
                0:{...blankEntry(0),comment:'Reaction guide',constant:true,useProbability:false,content:'REACTION-GUIDE: Use restrained reactions.'},
                1:{...blankEntry(1),comment:'Dock guide',constant:true,useProbability:false,content:'DOCK-GUIDE: Keep landing logistics visible.'},
            }});
            V.prefs().guidelines=guidelines;
            V.prefs().guidelineScopes={[guidelines]:{1:{location:'Dock',module:'state'}}};
            V.prefs().modules={roast:true,roastFeedback:true};
            V.prefs().keepTurnGuidance=true;
            const {saveChatState}=await import(`${B}/src/store.js`); saveChatState();
            await V.ensureWorld();
            V.queueCheck('reach the ferry','Agility',12);
        });
        L.resetLog();
        const prelude = '<page:boot>\n1. IDENTITY: PRIVATE-PRELUDE-MARKER\n2. GROUNDING: Harbor\n\n';
        L.mode({chunkMs:320,reply:prelude+block('“I saw the ferry depart,” Seraphina said. “We just missed it,” added Mira. The ferry is gone.\n\nSeraphina thought, *We can still try the bridge.* Mira thought, *The bridge might be closed.*\n\n*No one can be sure.*',{
            scene:{where:'Dock',present:'Seraphina',time:'Late morning',date:'Day 1',weather:'Light rain',minutes:120},
            changes:[{kind:'fact',id:'ferry-gone',text:'The ferry left the dock.',evidence:'The ferry is gone.'},
                {kind:'emotion',id:'seraphina-mood',subject:'Seraphina',text:'Frustrated',axes:{fury:5},evidence:'I saw the ferry depart,'}],
            roast:'The dock has excellent timing, which is to say none.'
        })});
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',true).trigger('change'));
        const progress=page.locator('.ri-v10-progress');
        const sending=L.send(page,'I run to the dock.');
        await progress.getByRole('status').getByText('Waiting for the reply').waitFor();
        await progress.getByRole('status').getByText('Writing the reply').waitFor();
        assert.equal(await progress.locator('li[data-status="done"]').count(),1);
        assert.equal(await progress.locator('li[data-status="done"] .ri-progress-light').textContent(),'✓');
        await page.locator('#chat .last_mes .ri-stream-preview').waitFor({state:'attached'});
        assert.equal(await page.locator('#chat .last_mes .mes_text').isVisible(),false);
        await page.emulateMedia({reducedMotion:'reduce'});
        assert.equal(await progress.locator('[data-status="active"] .ri-progress-light').evaluate(node=>getComputedStyle(node).animationName),'none');
        await progress.getByRole('status').getByText('Receiving the story update').waitFor();
        assert.equal(await progress.locator('li[data-status="done"]').count(),2);
        await progress.getByRole('status').getByText('Story state ready').waitFor();
        assert.equal(await progress.locator('li[data-status="done"]').count(),4);
        await sending;
        await progress.waitFor({state:'detached'});
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',false).trigger('change'));
        await page.waitForFunction(async B=>(await import(`${B}/src/v10.js`)).rowsForWorld().then(rows=>rows.some(x=>x.name==='ferry-gone')),L.BASE);
        assert.equal(L.requests().length,1);
        assert.match(L.text(L.requests()[0]),/Resolved action check/);
        assert.match(L.text(L.requests()[0]),/ordinary quoted dialogue/);
        assert.doesNotMatch(L.text(L.requests()[0]),/in square brackets on its own/);
        assert.equal(L.text(L.requests()[0]).split('THE-HARBOR-MARKER').length-1,1);
        assert.equal(L.text(L.requests()[0]).split('REACTION-GUIDE').length-1,1);
        assert.doesNotMatch(L.text(L.requests()[0]),/DOCK-GUIDE/);
        assert.match(L.text(L.requests()[0]),/I run to the dock/);
        const state=await story(page,async({B})=>{
            const V=await import(`${B}/src/v10.js`);
            const msg=SillyTavern.getContext().chat.at(-1);
            return {rec:msg.extra.roleplay_instructions,mes:msg.mes,records:(await V.rowsForWorld()).map(V.readRecord).filter(Boolean),speakers:V.prefs().speakers};
        });
        assert.match(state.rec.v10Request,/Resolved action check/);
        assert(!state.mes.includes('story_update'));
        assert.doesNotMatch(state.mes,/PRIVATE-PRELUDE-MARKER|<page:/);
        assert.match(state.rec.v10Plan,/PRIVATE-PRELUDE-MARKER/); assert.equal(state.rec.v10Minutes,120);
        assert.equal(state.rec.v10Lore.find(x=>x.role==='Base World').confirmed,true);
        assert.equal(state.rec.v10Lore.find(x=>x.role==='Guidelines').confirmed,true);
        assert(state.rec.v10Lore.every(entry=>!Object.hasOwn(entry,'text')));
        assert.equal(state.records.length,2); assert.equal(state.records.find(x=>x.kind==='emotion').axes.fury,5);
        assert(Object.values(state.speakers).some(x=>x.name==='Seraphina'));
        const latest=page.locator('#chat .last_mes');
        const header=latest.locator('.ri-scene-header');
        assert.deepEqual(await header.locator('dt').allTextContents(),['Time','Date','Location','Weather']);
        assert.deepEqual(await header.locator('dd').allTextContents(),['Late morning','Day 1','Dock','Light rain']);
        assert.equal(await header.evaluate(node=>node.nextElementSibling?.classList.contains('mes_text')),true);
        for (const name of ['Viewpoint & player agency','Cast, motives & voice','Scene beats & pacing','Prose & dialogue craft','Consequences, combat & payoffs']) {
            const marker=preset.prompts.find(prompt=>prompt.name===name).content.split('. ')[0];
            assert.equal(L.text(L.requests()[0]).split(marker).length-1,1,name);
        }
        await latest.locator('.ri-v10-console').waitFor();
        await latest.locator('.ri-v10-lore').waitFor();
        const planning = latest.locator('.ri-v10-plan');
        assert.equal(await planning.evaluate(el=>el.open),false);
        await planning.locator('summary').click();
        assert.match(await planning.innerText(),/PRIVATE-PRELUDE-MARKER/);
        const colored = await latest.locator('.ri-speaker-text').evaluateAll(spans=>spans.map(span=>({
            speaker:span.dataset.speaker,color:getComputedStyle(span).color,italic:!!span.closest('em, i'),text:span.textContent
        })));
        assert.equal(colored.length,4);
        assert.equal(colored[0].speaker,'seraphina');
        assert.equal(colored[1].speaker,'mira');
        assert.notEqual(colored[0].color,colored[1].color);
        assert.deepEqual(colored.slice(2).map((item,index)=>[item.italic,item.speaker,item.color]),colored.slice(0,2).map(item=>[true,item.speaker,item.color]));
        assert(!colored.some(item=>item.text.includes('No one can be sure')));
        assert.doesNotMatch(state.mes,/\[(Seraphina|Mira)\]/);
        const historical = '[Seraphina] “First line.” She laughed. [Seraphina] “Second line.”';
        const redrawMessage = value => story(page,async({B,value})=>{
            const c=SillyTavern.getContext();
            const id=c.chat.length-1, message=c.chat[id];
            message.mes=value;
            c.updateMessageBlock(id,message);
            (await import(`${B}/src/ui/v10.js`)).refreshDialogue();
            return message.mes;
        },value);
        assert.equal(await redrawMessage(historical),historical);
        assert.equal(await latest.locator('.mes_text .ri-speaker-label[hidden]').count(),2);
        assert.equal(await latest.locator('.mes_text .ri-speaker-text[data-speaker="seraphina"]').count(),2);
        assert.doesNotMatch(await latest.locator('.mes_text').innerText(),/\[Seraphina\]/);
        await redrawMessage(state.mes);
        assert.equal(await latest.locator('.ri-v10-console').evaluate(x=>x.open),false);
        assert.match(await latest.locator('.ri-v10-console .ri-reply-chip-rail').textContent(),/Dock.*2 changes/);
        assert.match(await latest.locator('.ri-v10-lore .ri-reply-chip-rail').first().textContent(),/2 confirmed/);
        assert.equal(await latest.locator('.ri-reply-roast').evaluate(x=>x.open),false);
        await latest.locator('.ri-v10-console > summary').click();
        await latest.getByRole('tab',{name:'Changes'}).click();
        assert.match(await latest.getByRole('tabpanel',{name:'Changes'}).innerText(),/ferry/);
        L.mode({reply:'[Seraphina] “The lamp lights up.”\n<story_update v="2">{invalid</story_update>'});
        await L.send(page,'Wait by the lamp.');
        const lamp = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes);
        assert.match(lamp,/Seraphina said, “The lamp lights up.”/);
        assert.doesNotMatch(lamp,/\[Seraphina\]/);
        assert.match(L.text(L.requests().at(-1)),/Out-of-story voice feedback/);
        assert.match(L.text(L.requests().at(-1)),/DOCK-GUIDE/);
        assert.doesNotMatch(L.text(L.requests().at(-1)),/PRIVATE-PRELUDE-MARKER/);
        assert.doesNotMatch(L.text(L.requests().at(-1)),/Resolved action check/);
        const previous = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.time);
        L.mode({reply:block('The wind drops.',{scene:{elapsed:3},repair:previous,
            changes:[{kind:'fact',id:'wind-drops',text:'The wind has dropped.',evidence:'The wind drops.'}],
            repairChanges:[{kind:'fact',id:'lamp-lit',text:'The lamp is lit.',evidence:'The lamp lights up.'}]
        })});
        await L.send(page,'Listen.');
        assert.match(L.text(L.requests().at(-1)),/recover a missing state change/);
        assert.equal(L.requests().length,3);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Minutes),123);
        const idle=()=>story(page,async({B})=>(await import(`${B}/src/worldflow.js`)).worldIdle());
        const read=()=>story(page,async({B})=>{
            const V=await import(`${B}/src/v10.js`);
            return [...V.recordMap(await V.rowsForWorld()).values()];
        });
        await idle();
        assert((await read()).some(record=>record.id==='lamp-lit' && record.source===previous));
        await story(page,async({B})=>{
            const V=await import(`${B}/src/v10.js`);
            const {saveV10Record}=await import(`${B}/src/worldflow.js`);
            await saveV10Record({kind:'seed',id:'bell',text:'An old bell waits for its keeper.',due:200,payoff:'LOCKED-BELL-PAYOFF',schedule:true});
            V.prefs().modules.dice=false;
            V.prefs().guidelinesOn=false;
        });
        L.mode({reply:block('The snow falls below the lamp.',{scene:{elapsed:4},changes:[
            {kind:'seed',id:'bell',status:'done',text:'The bell rang.',evidence:'The snow falls below the lamp.'},
            {kind:'fact',id:'snow',text:'It began snowing.',evidence:'The snow falls below the lamp.'}
        ]})});
        await L.send(page,'Watch the street.');
        await idle();
        const next=L.text(L.requests().at(-1));
        assert.match(next,/bell \[seed, open, prerequisites pending\]/);
        assert.doesNotMatch(next,/LOCKED-BELL-PAYOFF|REACTION-GUIDE|Resolved action check|recover a missing state change/);
        assert.equal((await read()).find(x=>x.id==='bell').status,'open');
        assert.deepEqual(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Plot.find(row=>row.id==='bell')),
            {id:'bell',eligible:false,recalled:true});
        L.mode({reply:block('Rain falls instead.',{scene:{elapsed:2},changes:[{kind:'fact',id:'rain',text:'Rain has started.',evidence:'Rain falls instead.'}]})});
        await story(page,async({B})=>(await import(`${B}/src/engine.js`)).guideSwipe('Change the snow to rain.'));
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('Rain falls instead.'));
        await idle();
        const records=await read();
        assert(!records.some(x=>x.id==='snow'));
        assert(records.some(x=>x.id==='rain'));
        assert(records.some(x=>x.id==='lamp-lit'));
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Minutes),125);
        assert.equal(L.requests().length,5);
        await page.evaluate(()=>SillyTavern.getContext().swipe.left());
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('The snow falls'));
        await idle();
        assert((await read()).some(x=>x.id==='snow'));
        assert(!(await read()).some(x=>x.id==='rain'));
        await page.evaluate(()=>SillyTavern.getContext().swipe.right());
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('Rain falls'));
        await idle();
        assert((await read()).some(x=>x.id==='rain'));
        assert(!(await read()).some(x=>x.id==='snow'));
        const parent=await story(page,async({B})=>{
            const W=await import(`${B}/src/world.js`);
            return {chat:SillyTavern.getContext().getCurrentChatId(),world:W.chatWorld()};
        });
        await L.slash(page,'/branch-create 3');
        await page.waitForFunction(before=>SillyTavern.getContext().getCurrentChatId()!==before,parent.chat);
        await page.waitForFunction(async ({B,world})=>{
            const W=await import(`${B}/src/world.js`);
            return !!W.chatWorld() && world!==W.chatWorld();
        },{B:L.BASE,world:parent.world});
        await idle();
        const branch=await read();
        assert(branch.some(x=>x.id==='ferry-gone'));
        assert(!branch.some(x=>['rain','snow','wind-drops','lamp-lit','bell'].includes(x.id)));
        assert.equal(L.requests().length,5);
        await L.openChat(page);
        L.mode({reply:block('[Seraphina] “The brass key is yours.”',{scene:{where:'Gate',present:'Seraphina',minutes:10},
            changes:[{kind:'fact',id:'brass-key',text:'Seraphina gave the player a brass key.',evidence:'The brass key is yours.'}]
        })});
        const draft=await story(page,async({B})=>(await import(`${B}/src/v10.js`)).draftOpening({direction:'Begin at the gate.'}));
        assert.match(draft.prose,/brass key/);
        assert.equal(L.requests().length,6);
        assert.match(L.text(L.requests().at(-1)),/Begin at the gate/);
        assert(!(await read()).some(x=>x.id==='brass-key'));
        await story(page,async({B,value})=>(await import(`${B}/src/engine.js`)).acceptV10Opening(value,value.prose),draft);
        await idle();
        assert((await read()).some(x=>x.id==='brass-key'));
        assert.equal(L.requests().length,6);
        const navigation = page.locator('#ri_root');
        await page.evaluate(()=>{
            const drawer=document.querySelector('#ri_drawer .ri-home');
            if (drawer) drawer.style.display='block';
        });
        const go = name => navigation.locator(`[data-ri-group="${name.toLowerCase()}"]`);
        // Programmatic clicks keep this test independent of the host's Extensions-drawer layout.
        await go('Story').evaluate(el=>el.click());
        assert.equal(await navigation.locator('[aria-current="page"]').textContent(),'Opening');
        await navigation.locator('[data-ri-page="facts"]').evaluate(el=>el.click());
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/Chat Facts/);
        await go('Setup').evaluate(el=>el.click());
        const scope = name => navigation.locator(`[data-module-scope="${name}"]`);
        const relationships = navigation.locator('[data-module="relationships"]');
        const choice = relationships.locator('select');
        const chosen = () => choice.evaluate(el=>el.selectedOptions[0].label);
        const status = () => relationships.locator('.ri-module-status').textContent();
        const setChoice = value => choice.evaluate((el,next)=>{
            el.value=next;
            el.dispatchEvent(new Event('change',{bubbles:true}));
        },value);
        assert.equal(await relationships.locator('select').count(),1);
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/Active preset: Roleplay Instructions V10/);
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/Viewpoint & player agency · On/);
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/Story workflow for this chat/);
        assert.equal(await scope('chat').getAttribute('aria-pressed'),'true');
        assert.equal(await chosen(),'On');
        assert.equal(await status(),'On in this chat');
        await setChoice('off');
        await scope('preset').evaluate(el=>el.click());
        assert.equal(await chosen(),'On');
        await setChoice('on');
        assert.match(await relationships.textContent(),/This chat keeps its own setting \(Off\)/);
        await setChoice('off');
        await scope('chat').evaluate(el=>el.click());
        assert.equal(await chosen(),'Off');
        await relationships.locator('button').filter({hasText:'Reset to preset setting (Off)'}).evaluate(el=>el.click());
        assert.equal(await chosen(),'Off');
        assert.match(await relationships.textContent(),/Following the preset setting/);
        await scope('preset').evaluate(el=>el.click());
        await relationships.locator('button').filter({hasText:'Reset to extension setting (On)'}).evaluate(el=>el.click());
        assert.equal(await status(),'Default for this preset: On');
        assert.match(await navigation.locator('[data-module="dice"]').textContent(),/regular replies proceed without a roll/i);
        await navigation.locator('[data-ri-page="display"]').evaluate(el=>el.click());
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/Show Reply planning/);
        await navigation.locator('button').filter({hasText:'Review World Info selections'}).evaluate(el=>el.click());
        assert.equal(await navigation.locator('[aria-current="page"]').textContent(),'What Was Sent');
        assert.match(await navigation.locator('#ri_panel_page').textContent(),/found the entry text in the assembled request/);
        await navigation.locator('button').filter({hasText:'World Info display settings'}).evaluate(el=>el.click());
        assert.equal(await navigation.locator('[aria-current="page"]').textContent(),'Reply Display');
        await go('Story').evaluate(el=>el.click());
        assert.equal(await navigation.locator('[aria-current="page"]').textContent(),'Chat Facts');
        await navigation.locator('[data-ri-page="books"]').evaluate(el=>el.click());
        const uploaded = `Uploaded harbor ${Date.now()}`;
        const bookFile = { name:`${uploaded}.json`, mimeType:'application/json', buffer:Buffer.from(JSON.stringify({
            entries:{4:{uid:4,key:['harbor'],content:'The harbor closes after sundown.',constant:false,disable:false}}
        })) };
        const assign = async () => {
            await navigation.locator('input[type=file]').setInputFiles(bookFile);
            await navigation.locator('button').filter({hasText:'Upload and assign Base World'}).evaluate(el=>el.click());
        };
        const savedBase = name => page.waitForFunction(name=>SillyTavern.getContext().chatMetadata.roleplay_instructions.v10.base?.name===name,name);
        await assign();
        await savedBase(uploaded);
        const stored = await story(page,async({B,value})=>{
            const {loadBook}=await import(`${B}/src/st.js`);
            return loadBook(value);
        },uploaded);
        assert.deepEqual(stored.entries[4].key,['harbor']);
        await assign();
        await savedBase(`${uploaded} (2)`);
        assert.equal(L.requests().length,6);
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',true).trigger('change'));
        L.mode({chunkMs:350,reply:'She counts the lights in the harbor. '.repeat(50)});
        await page.evaluate(()=>{
            globalThis.jQuery('#send_textarea').val('Look out at the harbor.').trigger('input');
            globalThis.jQuery('#send_but').trigger('click');
        });
        await progress.getByRole('status').getByText('Writing the reply').waitFor();
        await page.locator('#mes_stop').click();
        await progress.waitFor({state:'detached'});
        assert.deepEqual(errors,[]);
        console.log('PASS v10 host: companion preset, native updates, pinned lore, guidelines, dice, repairs, plot gates, clock, speaker colors, streaming progress, cancellation, console, opening, saved-swipe navigation and branch rollback');
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
