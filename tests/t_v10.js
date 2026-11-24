const L = require('./lib.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const preset = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json', `file://${__filename}`)));

const block = (prose, data) => `${prose}\n<story_update v="2">${JSON.stringify({v:2,...data})}</story_update>`;
const story = (page, fn, value) => page.evaluate(fn,{B:L.BASE,value});
// MB3: story state reaches memory through capture after each reply (memory DESIGN 7.2). The mock answers the capture call
// with `capture`, written here as the entries the reply's update block used to carry, and chat requests are counted
// without the capture calls.
const cap = (...ops) => ({decisions:{durable_change:ops.length>0,scene_ended:false,out_of_character:false},ops,state:{}});
const add = (kind,id,text,quote,extra={}) => ({op:'add',id,target:[],kind,subject:'',text,quote,...extra});
const chatRequests = () => L.requests().filter(request=>!/You keep the records of a roleplay story/.test(L.text(request)));

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
        await page.evaluate(()=>{
            const $ = jQuery;
            $('#oai_max_context_unlocked').prop('checked',true).trigger('change');
            $('#openai_max_context').val(16384).trigger('input');
        });
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
        await page.setViewportSize({width:390,height:process.env.RI_CAPTURE_DIR ? 988 : 844});
        L.resetLog();
        const prelude = '<page:boot>\n1. IDENTITY: PRIVATE-PRELUDE-MARKER\n2. GROUNDING: Harbor\n\n';
        L.mode({chunkMs:320,reply:prelude+block('“I saw the ferry depart,” Seraphina said. “We just missed it,” added Mira. The ferry is gone.\n\nSeraphina thought, *We can still try the bridge.* Mira thought, *The bridge might be closed.*\n\n*No one can be sure.*',{
            scene:{where:'Dock',present:'Seraphina',time:'11:55 PM',date:'Day 1',weather:'Light rain',minutes:120},
            characters:[{name:'Seraphina',mind:'Reach the bridge',heart:'Disappointed',body:'Ready to walk',psyche:'Still hopeful',evidence:'We just missed it'}],
            changes:[{kind:'fact',id:'ferry-gone',text:'The ferry left the dock.',evidence:'The ferry is gone.'},
                {kind:'emotion',id:'seraphina-mood',subject:'Seraphina',text:'Frustrated',axes:{fury:5},evidence:'I saw the ferry depart,'}],
            roast:'The dock has excellent timing, which is to say none.'
        }),capture:cap(add('fact','ferry-gone','The ferry left the dock.','The ferry is gone.'),
            add('emotion','seraphina-mood','Frustrated','I saw the ferry depart,',{subject:'Seraphina',axes:{fury:5}}))});
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',true).trigger('change'));
        // B10 replaced the streaming progress card and the cards under each reply with the reply tray. Its loading
        // Strip, arrival chips, views and exits are covered by tests/t_reply_tray.js and the B10 touch pass; the old
        // glance, console and skeleton assertions are retired. Here the reply streams and the tray takes its place.
        await L.send(page,'I run to the dock.');
        await page.locator('#chat .last_mes .ri-tray').first().waitFor({state:'attached'});
        if (process.env.RI_CAPTURE_DIR) await page.locator('#chat .last_mes').screenshot({path:process.env.RI_CAPTURE_DIR+'/saved.png'});
        await page.setViewportSize({width:1280,height:900});
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',false).trigger('change'));
        // waitForFunction takes a truthy promise as done, so the capture is waited for by polling a plain value.
        await page.waitForFunction(B=>{
            import(`${B}/src/v10.js`).then(V=>V.rowsForWorld()).then(rows=>{ globalThis.__riFerry = rows.some(x=>x.name==='ferry-gone'); });
            return globalThis.__riFerry === true;
        },L.BASE,{timeout:30000,polling:250});
        assert.equal(chatRequests().length,1);
        assert.match(L.text(chatRequests()[0]),/Resolved action check/);
        assert.match(L.text(chatRequests()[0]),/Scene and character checks:/);
        assert.match(L.text(chatRequests()[0]),/ordinary quoted dialogue/);
        assert.doesNotMatch(L.text(chatRequests()[0]),/in square brackets on its own/);
        assert.equal(L.text(chatRequests()[0]).split('THE-HARBOR-MARKER').length-1,1);
        assert.equal(L.text(chatRequests()[0]).split('REACTION-GUIDE').length-1,1);
        assert.doesNotMatch(L.text(chatRequests()[0]),/DOCK-GUIDE/);
        assert.match(L.text(chatRequests()[0]),/I run to the dock/);
        for (const name of ['Craft: Decisive NPCs','Craft: New NPCs','Craft: Voice hold','Craft: Reply length','Craft: Self-check']) {
            const marker=preset.prompts.find(prompt=>prompt.name===name).content.replace(/\{\{\/\/[\s\S]*?\}\}/g,'').split('. ')[0];
            assert.equal(L.text(chatRequests()[0]).split(marker).length-1,1,name);
        }
        assert.doesNotMatch(L.text(chatRequests()[0]),/Use the player character as the single viewpoint|Space scheduled developments across the time/);
        // B15: comment macros, their annotation keys, heading marker rows and the README stay out of the request.
        assert.doesNotMatch(L.text(chatRequests()[0]),/\{\{\/\/|@category|@tooltip|@default-enabled|@pairs/);
        for (const heading of preset.prompts.filter(prompt=>/^ri-head-/.test(prompt.identifier))) assert(!L.text(chatRequests()[0]).includes(heading.name),heading.name);
        assert(chatRequests()[0].messages.every(message=>String(message.content ?? '').trim()),'no empty message');
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
        // B10 moved the scene header into the reply tray's Strip (place, time and weather); the old header box is gone.
        const stripScene=()=>latest.locator('.ri-tray-scene-text').first().textContent();
        for (const part of ['Dock','11:55 PM','Light rain']) assert((await stripScene()).includes(part),part);
        for (const name of ['Craft: Viewpoint','Craft: Cast & voice','Craft: Scene pacing','Craft: Prose','Craft: Consequences']) {
            const marker=preset.prompts.find(prompt=>prompt.name===name).content.replace(/\{\{\/\/[\s\S]*?\}\}/g,'').split('. ')[0];
            assert.equal(L.text(chatRequests()[0]).split(marker).length-1,1,name);
        }
        // The console, lore and planning cards under the reply were removed by B10; the plan stays on the record
        // (state.rec.v10Plan above) and the tray cards are B11's.
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
        // Retired with the cards under the reply (B10): console chips, the lore list with its entry editor link,
        // and the Changes tab. The entry editor itself is covered by the World Info page suites.
        for (const part of ['Dock','11:55 PM']) assert((await stripScene()).includes(part),part);
        assert.equal(chatRequests().length,1);
        L.mode({reply:'[Seraphina] “The lamp lights up.”\n<story_update v="2">{invalid</story_update>',capture:{...cap(add('fact','lamp-lit','The lamp is lit.','The lamp lights up.')),time:{elapsed:0,cue:'The lamp lights up.'}}});
        await L.send(page,'Wait by the lamp.');
        const lamp = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).mes);
        assert.match(L.text(chatRequests().at(-1)),/Time: 11:55 PM\nDate: Day 1/);
        assert.match(lamp,/Seraphina said, “The lamp lights up.”/);
        assert.doesNotMatch(lamp,/\[Seraphina\]/);
        assert.match(L.text(chatRequests().at(-1)),/Out-of-story voice feedback/);
        assert.match(L.text(chatRequests().at(-1)),/DOCK-GUIDE/);
        assert.doesNotMatch(L.text(chatRequests().at(-1)),/PRIVATE-PRELUDE-MARKER/);
        assert.doesNotMatch(L.text(chatRequests().at(-1)),/Resolved action check/);
        const previous = await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.time);
        L.mode({reply:block('The wind drops.',{scene:{elapsed:3},repair:previous,
            changes:[{kind:'fact',id:'wind-drops',text:'The wind has dropped.',evidence:'The wind drops.'}],
            repairChanges:[{kind:'fact',id:'lamp-lit',text:'The lamp is lit.',evidence:'The lamp lights up.'}]
        }),capture:cap(add('fact','wind-drops','The wind has dropped.','The wind drops.'))});
        await L.send(page,'Listen.');
        // The repair request of the update block retired with it: capture read the lamp reply on its own.
        assert.doesNotMatch(L.text(chatRequests().at(-1)),/recover a missing state change/);
        assert.equal(chatRequests().length,3);
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Minutes),123);
        const idle=async()=>{
            await story(page,async({B})=>(await import(`${B}/src/worldflow.js`)).worldIdle());
            await page.waitForFunction(B=>{
                import(`${B}/src/memory/capture.js`).then(C=>{ const m=SillyTavern.getContext().chat.at(-1); globalThis.__riCaptured = !m || m.is_user || C.isCaptured(m); });
                return globalThis.__riCaptured === true;
            },L.BASE,{timeout:30000,polling:250});
            await page.evaluate(()=>{ delete globalThis.__riCaptured; });
        };
        const read=()=>story(page,async({B})=>{
            const V=await import(`${B}/src/v10.js`);
            return [...V.recordMap(await V.rowsForWorld()).values()];
        });
        await idle();
        assert((await read()).some(record=>record.id==='lamp-lit'));
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
        ]}),capture:cap(add('fact','snow','It began snowing.','The snow falls below the lamp.'))});
        await L.send(page,'Watch the street.');
        await idle();
        const next=L.text(chatRequests().at(-1));
        assert.match(next,/Time: 11:58 PM\nDate: Day 1/);
        for (const part of ['12:02 AM','Dock','Light rain']) assert((await stripScene()).includes(part),part);
        assert.match(next,/bell \[seed, open, prerequisites pending\]/);
        assert.doesNotMatch(next,/LOCKED-BELL-PAYOFF|REACTION-GUIDE|Resolved action check|recover a missing state change/);
        assert.equal((await read()).find(x=>x.id==='bell').status,'open');
        assert.deepEqual(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Plot.find(row=>row.id==='bell')),
            {id:'bell',eligible:false,recalled:true});
        L.mode({reply:block('Rain falls instead.',{scene:{elapsed:2},changes:[{kind:'fact',id:'rain',text:'Rain has started.',evidence:'Rain falls instead.'}]}),
            capture:cap(add('fact','rain','Rain has started.','Rain falls instead.'))});
        await story(page,async({B})=>(await import(`${B}/src/engine.js`)).guideSwipe('Change the snow to rain.'));
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('Rain falls instead.'));
        await idle();
        const records=await read();
        assert(!records.some(x=>x.id==='snow'));
        assert(records.some(x=>x.id==='rain'));
        assert(records.some(x=>x.id==='lamp-lit'));
        assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.at(-1).extra.roleplay_instructions.v10Minutes),125);
        for (const part of ['12:00 AM','Dock','Light rain']) assert((await stripScene()).includes(part),part);
        assert.match(L.text(chatRequests().at(-1)),/Time: 11:58 PM\nDate: Day 1/);
        assert.equal(chatRequests().length,5);
        await page.evaluate(()=>SillyTavern.getContext().swipe.left());
        await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('The snow falls'));
        await idle();
        assert((await read()).some(x=>x.id==='snow'));
        for (const part of ['12:02 AM','Dock','Light rain']) assert((await stripScene()).includes(part),part);
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
        const branchClock=await story(page,async({B})=>{
            const {sceneAt,storyMinuteAt}=await import(`${B}/src/state.js`);
            return [sceneAt().time,sceneAt().date,storyMinuteAt()];
        });
        assert.deepEqual(branchClock,['11:55 PM','Day 1',120]);
        assert.equal(chatRequests().length,5);
        await L.openChat(page);
        L.mode({reply:block('[Seraphina] “The brass key is yours.”',{scene:{where:'Gate',present:'Seraphina',minutes:10},
            changes:[{kind:'fact',id:'brass-key',text:'Seraphina gave the player a brass key.',evidence:'The brass key is yours.'}]
        }),capture:cap(add('fact','brass-key','Seraphina gave the player a brass key.','The brass key is yours.'))});
        const draft=await story(page,async({B})=>(await import(`${B}/src/v10.js`)).draftOpening({direction:'Begin at the gate.'}));
        assert.match(draft.prose,/brass key/);
        assert.equal(chatRequests().length,6);
        assert.match(L.text(chatRequests().at(-1)),/Begin at the gate/);
        assert(!(await read()).some(x=>x.id==='brass-key'));
        await story(page,async({B,value})=>(await import(`${B}/src/engine.js`)).acceptV10Opening(value,value.prose),draft);
        await idle();
        assert((await read()).some(x=>x.id==='brass-key'));
        assert.equal(chatRequests().length,6);
        // The old page chooser, the Setup module scope controls and the Preset & Extension workbench were replaced
        // by B5's menu shell (tests/t_menu_shell.js) and B12's Presets page (tests/t_preset_switch.js); those
        // navigation and scope assertions are retired. The books page is opened through the shell.
        const navigation = page.locator('#ri_root');
        await story(page,async({B})=>{const {app}=await import(`${B}/src/ui/panel.js`); await app.openPage('books',{focusPage:true});});
        const uploaded = `Uploaded harbor ${Date.now()}`;
        const bookFile = { name:`${uploaded}.json`, mimeType:'application/json', buffer:Buffer.from(JSON.stringify({
            entries:{4:{uid:4,key:['harbor'],content:'The harbor closes after sundown.',constant:false,disable:false}}
        })) };
        const assign = async () => {
            await navigation.getByLabel('Base World JSON file').setInputFiles(bookFile);
            await navigation.locator('button').filter({hasText:'Upload and assign Base World'}).evaluate(el=>el.click());
        };
        const savedBase = name => page.waitForFunction(name=>SillyTavern.getContext().chatMetadata.roleplay_instructions.v10.base?.name===name,name)
            .catch(async error=>{ console.error('base is',await page.evaluate(()=>SillyTavern.getContext().chatMetadata.roleplay_instructions.v10.base?.name),
                await navigation.locator('#ri_panel_page').innerText().then(t=>t.slice(0,600)).catch(()=>'')); throw error; });
        await assign();
        await savedBase(uploaded);
        const stored = await story(page,async({B,value})=>{
            const {loadBook}=await import(`${B}/src/st.js`);
            return loadBook(value);
        },uploaded);
        assert.deepEqual(stored.entries[4].key,['harbor']);
        await page.waitForTimeout(1500); // the page redraws after the first upload; pick the file on the redrawn form
        await assign();
        await savedBase(`${uploaded} (2)`);
        assert.equal(chatRequests().length,6);
        await page.evaluate(()=>globalThis.jQuery('#stream_toggle').prop('checked',true).trigger('change'));
        L.mode({chunkMs:350,reply:block('She counts the lights in the harbor.',{
            scene:{where:'UNSAVED-HARBOR'},
            changes:[{kind:'fact',id:'unsaved-harbor',text:'Unfinished data. '.repeat(60),evidence:'She counts the lights'}],
        }),capture:cap()});
        await page.evaluate(()=>{
            globalThis.jQuery('#send_textarea').val('Look out at the harbor.').trigger('input');
            globalThis.jQuery('#send_but').trigger('click');
        });
        await page.locator('#chat .ri-tray-loading').first().waitFor({state:'attached'});
        await page.waitForTimeout(2500);
        await page.locator('#mes_stop').click();
        await L.idle(page);
        assert(!(await read()).some(row=>row.id==='unsaved-harbor'));
        assert.equal(await page.locator('#chat .ri-tray-scene-text').filter({hasText:'UNSAVED-HARBOR'}).count(),0);
        assert.deepEqual(errors,[]);
        console.log('PASS v10 host: companion preset, records captured after each reply, pinned lore, guidelines, dice, plot gates, clock, speaker colors, reply tray, cancellation, opening, saved-swipe navigation and branch rollback');
    } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
