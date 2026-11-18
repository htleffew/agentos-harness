const L = require('./lib.js');
const assert = require('node:assert/strict');
const wait = async page => { await page.evaluate(async B => (await import(`${B}/src/worldflow.js`)).worldIdle(), L.BASE); await page.waitForTimeout(250); };
const block = (want, mind) => `Story ${want}.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\nwants: Seraphina | ${want}\n<profile name="Seraphina">\nMind: ${mind}\n</profile>\n</story_update>`;
const world = page => page.evaluate(async B => { const W=await import(`${B}/src/world.js`); const id=W.chatWorld(), d=id && await W.loadWorld(id); return { id, rows:d ? W.listWorld(d,id) : [] }; },L.BASE);
(async () => {
 L.sync(); const {browser,page,errors}=await L.open();
 try {
  await L.setupApi(page); await L.setSettings(page,{check:{mode:'off'},perReply:0,scene:{track:true,card:'always'},cards:{on:true,most:1,roast:false},world:{update:'all',build:0,head:0,copyOnBranch:true},summary:{on:false,hide:false}}); await L.openChat(page);
  await page.evaluate(async B => {const K=await import(`${B}/src/books.js`),W=await import(`${B}/src/world.js`); const d={entries:{}};const w=W.newWorldEntry(d,'character');w.name='Seraphina';w.fields.wants='Beginning';W.writeWorldEntry(d,w);W.setChatWorld(await K.createSet(`History ${Date.now()}`,'world',d,''));},L.BASE);
  for (const [want,mind] of [['First','First mind'],['Second','Second mind'],['Third','Third mind']]) {
   L.mode({reply:block(want,mind)}); await L.send(page,want); await wait(page);
   if (want === 'First') await page.evaluate(async B=>{const S=await import(`${B}/src/state.js`);S.editState(SillyTavern.getContext().chat.length-1,'Seraphina','mind','Earlier correction',true);},L.BASE);
   if (want === 'Second') await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),F=await import(`${B}/src/worldflow.js`),id=W.chatWorld(),d=await W.loadWorld(id),w=W.listWorld(d,id).find(x=>x.name==='Seraphina'),before=structuredClone(d.entries[w.uid]);w.fields.flaw='A later manual fact';W.writeWorldEntry(d,w,id);await W.saveWorld(id,d);F.recordManualWorldChange(id,w.uid,before,d.entries[w.uid]);},L.BASE);
  }
  const before=await world(page); assert.equal(before.rows.find(w=>w.name==='Seraphina').fields.wants,'Third');
  const ids=await page.evaluate(() => SillyTavern.getContext().chat.map((m,i)=>m.extra?.roleplay_instructions?.stateChanges?.length ? i : -1).filter(i=>i>=0));
  await page.evaluate(async B=>{const S=await import(`${B}/src/state.js`);S.editState(SillyTavern.getContext().chat.length-1,'Seraphina','mind','Future correction',true);},L.BASE);
  await L.slash(page,`/branch-create ${ids[0]}`);await page.waitForTimeout(1500);await wait(page);
  const branch=await world(page); const st=await page.evaluate(async B=>(await import(`${B}/src/state.js`)).stateAt(),L.BASE);
  assert.notEqual(branch.id,before.id); assert.equal(branch.rows.find(w=>w.name==='Seraphina').fields.wants,'First'); assert.equal(branch.rows.find(w=>w.name==='Seraphina').fields.flaw,''); assert.equal(st.seraphina.fields.mind,'Earlier correction');
  const source=await page.evaluate(async ([B,id])=>{const W=await import(`${B}/src/world.js`);return W.listWorld(await W.loadWorld(id),id).find(w=>w.name==='Seraphina').fields.wants},[L.BASE,before.id]); assert.equal(source,'Third');
  console.log('PASS deep branch rewinds world and excludes future protected correction');
  await L.openChat(page); await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`);W.setChatWorld('');},L.BASE); L.mode({reply:block('No world','Only mind')}); await L.send(page,'No world'); await wait(page);
  const branchId=await page.evaluate(()=>SillyTavern.getContext().chat.length-1); await L.slash(page,`/branch-create ${branchId}`);await page.waitForTimeout(1500);await wait(page); const empty=await world(page); assert(empty.id); assert.deepEqual(empty.rows,[]); console.log('PASS branch without parent world creates its own book');
  await L.openChat(page); await page.evaluate(async B=>{const K=await import(`${B}/src/books.js`),W=await import(`${B}/src/world.js`);const d={entries:{}};const w=W.newWorldEntry(d,'character');w.name='Seraphina';w.fields.wants='Beginning';W.writeWorldEntry(d,w);W.setChatWorld(await K.createSet(`Delete ${Date.now()}`,'world',d,''));},L.BASE);
  for (const value of ['One','Two','Three']) {L.mode({reply:block(value,value)});await L.send(page,value);await wait(page);}
  await page.evaluate(async B=>{const S=await import(`${B}/src/state.js`);S.editState(SillyTavern.getContext().chat.length-1,'Seraphina','body','Protected injury',true);},L.BASE);
  // Delete two complete turns in one host event.
  await L.slash(page,'/del 4'); await page.waitForTimeout(800);await wait(page); const rewound=await world(page); assert.equal(rewound.rows.find(w=>w.name==='Seraphina').fields.wants,'One'); console.log('PASS multi-message deletion reverts newest world changes first');
  const remaining=await page.evaluate(()=>SillyTavern.getContext().chat.length-1);await L.slash(page,`/branch-create ${remaining}`);await page.waitForTimeout(1500);await wait(page);
  const kept=await page.evaluate(async B=>(await import(`${B}/src/state.js`)).stateAt(),L.BASE);assert.equal(kept.seraphina.fields.body,'Protected injury');console.log('PASS protected correction survives deletion and subsequent branch');
  for (const value of ['Four','Five']) {L.mode({reply:block(value,value)});await L.send(page,value);await wait(page);}
  await L.setSettings(page,{summary:{on:true,onSceneEnd:false,every:0,hide:false}});
  await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld(),d=await W.loadWorld(id),w=W.newWorldEntry(d,'chapter');w.name='Manual chapter';w.fields.summary='MANUAL_STALE_SUMMARY';w.span={chat:String(SillyTavern.getContext().getCurrentChatId()),from:1,to:3};W.writeWorldEntry(d,w,id);await W.saveWorld(id,d);},L.BASE);
  const editId=await page.evaluate(()=>SillyTavern.getContext().chat.findIndex(m=>m.mes?.startsWith('Story One.')));
  await page.evaluate(async id=>{const c=SillyTavern.getContext(); c.chat[id].mes='Changed earlier story.'; await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,id);},editId);await wait(page);
  const edited=await page.evaluate(async B=>{const c=SillyTavern.getContext(), S=await import(`${B}/src/state.js`);return {state:S.stateAt(), review:c.chatMetadata.roleplay_instructions.historyNeedsReview, stale:c.chat.filter(m=>m.extra?.roleplay_instructions?.stateStale).length}},L.BASE);
  assert(edited.review); assert(edited.stale>=3); assert(!edited.state.seraphina?.fields.mind); const w=await world(page);assert.equal(w.rows.find(w=>w.name==='Seraphina').fields.wants,'Beginning'); console.log('PASS old edit withdraws dependent generated state and world updates');
  const notes = await page.evaluate(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld(); return W.buildNotes(W.listWorld(await W.loadWorld(id),id))?.text || '';},L.BASE); assert.doesNotMatch(notes,/MANUAL_STALE_SUMMARY/); console.log('PASS overlapping manual chapter withheld during review');
  // Explicit rebuild uses one additional request, leaves the proposal editable,
  // and only updates state and the world after the user applies it.
  await page.evaluate(async B=>{const UI=await import(`${B}/src/ui/state.js`);const host=document.createElement('div');host.id='history-review';document.body.append(host);window.renderHistory=()=>{host.replaceChildren();UI.renderCurrentState(host,window.renderHistory)};window.renderHistory();},L.BASE);
  L.resetLog(); L.mode({reply:'<story_update>\npresent: Seraphina\nwhere: Tower\nwhen: Dawn\nwants: Seraphina | Rebuilt\n<profile name="Seraphina">\nMind: Begin again\n</profile>\n</story_update>'});
  const review=page.locator('#history-review'); await review.getByRole('button',{name:'Rebuild state from the edited story'}).click(); await review.getByRole('button',{name:'Draft a state update with AI'}).click();
  await page.waitForFunction(()=>document.querySelector('#history-review .ri-state-editor textarea')?.value.includes('Begin again'),null,{timeout:30000});
  assert.equal((await world(page)).rows.find(w=>w.name==='Seraphina').fields.wants,'Beginning');
  await review.getByRole('button',{name:'Apply reviewed update'}).click(); await wait(page);
  await page.waitForFunction(async B=>{const W=await import(`${B}/src/world.js`),id=W.chatWorld();return W.listWorld(await W.loadWorld(id),id).find(w=>w.name==='Seraphina')?.fields.wants==='Rebuilt'},L.BASE,{timeout:15000});
  assert.equal(L.requests().length,1); const rebuilt=await page.evaluate(async B=>(await import(`${B}/src/state.js`)).stateAt(),L.BASE);assert.equal(rebuilt.seraphina.fields.mind,'Begin again');console.log('PASS reviewed rebuild makes one request and applies only after approval');
  const latest=await page.evaluate(()=>SillyTavern.getContext().chat.length-1);await page.evaluate(async id=>{const c=SillyTavern.getContext();c.chat[id].mes='Edited newest reply.';await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED,id)},latest);await wait(page);
  const newest=await page.evaluate(async B=>({state:(await import(`${B}/src/state.js`)).stateAt(),review:SillyTavern.getContext().chatMetadata.roleplay_instructions.historyNeedsReview}),L.BASE);assert(newest.review);assert(!newest.state.seraphina?.fields.mind);console.log('PASS latest edit withdraws outdated state');
  console.log('browser errors', errors.slice(0,5));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
