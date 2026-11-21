const L = require('./lib.js');
const assert = require('node:assert/strict');
const idleWorld = async page => { await page.evaluate(async B => (await import(`${B}/src/worldflow.js`)).worldIdle(), L.BASE); await page.waitForTimeout(300); };

async function customizeGuidedFraming(page) {
 const drawer = page.locator('#extensions-settings-button > .drawer-toggle');
 const root = page.locator('#ri_root');
 if (!await page.locator('#ri_drawer').isVisible()) await drawer.tap();
 if (!await root.isVisible()) await page.locator('#ri_drawer .inline-drawer-header').tap();
 await root.getByRole('navigation',{name:'Roleplay sections'}).getByRole('button',{name:'Setup',exact:true}).tap();
 await root.getByRole('button',{name:'Settings',exact:true}).tap();
 const group = root.locator('.ri-prompt-group').filter({hasText:'Customize guided-turn instructions'});
 await group.locator(':scope > summary').tap();
 const editor = group.locator('.ri-prompt-editor').filter({hasText:'Guided swipe framing'});
 await editor.locator(':scope > summary').tap();
 await editor.getByRole('textbox',{name:'Guided swipe framing'}).fill('V8_GUIDED_CUSTOM {direction}');
 await editor.getByRole('button',{name:'Save instruction',exact:true}).tap();
 await editor.getByRole('status').filter({hasText:'Saved.'}).waitFor();
 await drawer.tap();
}

async function openGuidedSheet(page) {
 await page.locator('#chat .last_mes .ri-guided').getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
 return page.getByRole('dialog',{name:'Generate an alternate reply'});
}

(async () => {
 L.sync(); const {browser,page,errors}=await L.open({width:390,height:820,hasTouch:true,isMobile:true});
 try {
  await L.setupApi(page); await L.setSettings(page,{check:{mode:'off'},perReply:0,scene:{track:true,card:'always'},cards:{on:true,most:1,roast:false},world:{update:'all',build:0,head:0},summary:{on:false,hide:false}}); await L.openChat(page);
  await page.evaluate(async B=>{const K=await import(`${B}/src/books.js`),W=await import(`${B}/src/world.js`),E=await import(`${B}/src/events.js`),S=await import(`${B}/src/store.js`);const d={entries:{}},w=W.newWorldEntry(d,'character');w.name='Seraphina';w.fields.wants='BEFORE_THE_TURN';W.writeWorldEntry(d,w);W.setChatWorld(await K.createSet(`Guided world ${Date.now()}`,'world',d,''));const x=E.newEvent('Guided event');x.chance=100;x.wait=0;x.categories=[E.newCategory('Situation',['ORIGINAL_EVENT_MARKER'])];const ed={entries:{}};E.writeEvent(ed,x);const eid=await K.createSet(`Guided event ${Date.now()}`,'events',ed,'');const cs=S.chatState();cs.activeSets=[eid];S.saveChatState();},L.BASE);
  L.resetLog(); await page.evaluate(async B=>{const P=await import(`${B}/src/prompts.js`); P.savePrompt('worldUpdate','V8_WORLD_CUSTOM'); P.savePrompt('profile','V8_PROFILE_CUSTOM'); P.savePrompt('event','V8_EVENT_CUSTOM {parts}');},L.BASE);
  await customizeGuidedFraming(page);
  assert.equal(L.requests().length,0);
  L.mode({reply:'A wrong turn.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\nwants: Seraphina | WRONG_WORLD_VALUE\n<profile name="Seraphina">\nMind: WRONG_MIND_VALUE\n</profile>\n</story_update>'}); L.resetLog();await L.send(page,'We talk.');await idleWorld(page);
  const original=L.text(L.requests().at(-1));assert.match(original,/ORIGINAL_EVENT_MARKER/);assert.match(original,/V8_WORLD_CUSTOM/);assert.match(original,/V8_PROFILE_CUSTOM/);assert.match(original,/V8_EVENT_CUSTOM/);assert.match(original,/<story_update>/);
  await page.evaluate(async B=>{const S=await import(`${B}/src/state.js`);const c=SillyTavern.getContext();S.editState(c.chat.length-1,'Seraphina','mind','DISCARDED_OVERRIDE_MARKER',true);},L.BASE);
  await page.evaluate(async B=>(await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(),L.BASE);
  const sheet=await openGuidedSheet(page);
  await sheet.getByRole('textbox',{name:'Your direction'}).fill('GUIDED_DIRECTION: Let her decline calmly.');
  L.resetLog();
  await sheet.getByRole('button',{name:'Generate alternate reply',exact:true}).tap();
  await sheet.getByRole('status').filter({hasText:/protected state or scene correction/i}).waitFor();
  assert.equal(L.requests().length,0);
  await sheet.getByRole('button',{name:'Close',exact:true}).tap();
  await page.evaluate(async B=>{const S=await import(`${B}/src/state.js`);const c=SillyTavern.getContext();S.editState(c.chat.length-1,'Seraphina','mind','DISCARDED_OVERRIDE_MARKER',false);},L.BASE);
  await page.evaluate(async B=>{const S=await import(`${B}/src/store.js`);S.chatState().lastScan=null;S.saveChatState();},L.BASE);
  L.mode({reply:'She calmly declines.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\nwants: Seraphina | NEW_WORLD_VALUE\n<profile name="Seraphina">\nMind: NEW_MIND_VALUE\n</profile>\n</story_update>'});L.resetLog();
  await page.evaluate(async B=>(await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(),L.BASE);
  await openGuidedSheet(page);
  await sheet.getByRole('textbox',{name:'Your direction'}).fill('GUIDED_DIRECTION: Let her decline calmly.');
  await sheet.getByRole('button',{name:'Generate alternate reply',exact:true}).tap();
  await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('She calmly declines.'),null,{timeout:60000});await idleWorld(page);
  const prompt=L.text(L.requests().at(-1));assert.match(prompt,/GUIDED_DIRECTION/);assert.match(prompt,/V8_GUIDED_CUSTOM/);assert.match(prompt,/BEFORE_THE_TURN/);assert.doesNotMatch(prompt,/WRONG_WORLD_VALUE|WRONG_MIND_VALUE|ORIGINAL_EVENT_MARKER|DISCARDED_OVERRIDE_MARKER/);
  const result=await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld();return {rows:W.listWorld(await W.loadWorld(id),id),m:SillyTavern.getContext().chat.at(-1)}},L.BASE);assert.equal(result.rows.find(x=>x.name==='Seraphina').fields.wants,'NEW_WORLD_VALUE');assert(!result.m.mes.includes('GUIDED_DIRECTION'));assert(result.m.extra.roleplay_instructions.guided);
  await sheet.getByRole('button',{name:'Close',exact:true}).tap();
  // Existing swipes can be revisited. A guided replacement must not silently
  // navigate to another saved swipe instead of generating the requested one.
  await page.evaluate(()=>SillyTavern.getContext().swipe.left()); await page.waitForTimeout(500); await idleWorld(page);
  const old=await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld();return W.listWorld(await W.loadWorld(id),id).find(x=>x.name==='Seraphina').fields.wants},L.BASE);assert.equal(old,'WRONG_WORLD_VALUE');
  const blocked=await page.evaluate(async B=>{try{await (await import(`${B}/src/engine.js`)).guideSwipe('Try another direction');return ''}catch(e){return e.message}},L.BASE);assert.match(blocked,/newest existing swipe/i);
  await page.evaluate(()=>SillyTavern.getContext().swipe.right()); await page.waitForTimeout(500); await idleWorld(page);
  const returned=await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld();return W.listWorld(await W.loadWorld(id),id).find(x=>x.name==='Seraphina').fields.wants},L.BASE);assert.equal(returned,'NEW_WORLD_VALUE');
  L.mode({reply:'The scene continues.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\n</story_update>'});L.resetLog();await L.send(page,'What happens next?');await idleWorld(page);assert.doesNotMatch(L.text(L.requests().at(-1)),/GUIDED_DIRECTION|DISCARDED_OVERRIDE_MARKER|WRONG_MIND_VALUE|WRONG_WORLD_VALUE/);
  // The optional repeat mode keeps the original turn's event deliberately.
  L.mode({reply:'She considers the proposal.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\n</story_update>'});L.resetLog();
  await page.evaluate(async B=>(await import(`${B}/src/engine.js`)).guideSwipe('REPEAT_DIRECTION', {repeatOrders:true}),L.BASE);
  await page.waitForFunction(()=>SillyTavern.getContext().chat.at(-1)?.mes?.includes('She considers the proposal.'),null,{timeout:60000});await idleWorld(page);
  const repeated=L.text(L.requests().at(-1));assert.match(repeated,/REPEAT_DIRECTION/);assert.match(repeated,/ORIGINAL_EVENT_MARKER/);
  await page.evaluate(async B=>{const P=await import(`${B}/src/prompts.js`);P.restorePrompt('event');if(P.promptStatus('event').customized || !P.promptStatus('guided').customized) throw Error('Independent restore failed');},L.BASE);
  await page.evaluate(async B=>{const P=await import(`${B}/src/prompts.js`);P.savePrompt('systemVersions','V8_SYSTEM_WRITER');P.savePrompt('versionRules','V8_WRITER_RULES');},L.BASE);
  L.mode({writer:JSON.stringify(['[[char]] must greet [[user]].'])});L.resetLog();
  await page.evaluate(async B=>(await import(`${B}/src/writer.js`)).writeVersions({ins:{name:'Greeting',actor:'char',target:'user',sentAs:'system',versions:[]},seed:'greet',count:1,context:{}}),L.BASE);
  const writing=L.text(L.requests().at(-1));assert.match(writing,/V8_SYSTEM_WRITER/);assert.match(writing,/V8_WRITER_RULES/);assert.match(writing,/Return only a JSON list/);
  await page.waitForTimeout(2500);await page.reload();await page.waitForFunction(()=>globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'),null,{timeout:90000});await page.waitForTimeout(1500);
  const persisted=await page.evaluate(async B=>(await import(`${B}/src/prompts.js`)).promptStatus('guided').customized,L.BASE);assert(persisted);
  await page.evaluate(async B=>{const P=await import(`${B}/src/prompts.js`);for(const id of ['worldUpdate','profile','event','guided','systemVersions','versionRules'])P.restorePrompt(id)},L.BASE);
  console.log('PASS v8 custom prompts with guided swipe: isolated prompt, rollback, one-turn direction, swipe navigation and optional order repeat');if(errors.length) console.log('browser errors',errors.slice(0,5));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
