const L = require('./lib.js');
const assert = require('node:assert/strict');
(async () => {
 L.sync(); const {browser,page,errors}=await L.open();
 try {
  await L.setupApi(page); await L.setSettings(page,{check:{mode:'off'},perReply:0,scene:{track:true,card:'always'},cards:{on:true,most:1,roast:false},world:{update:'all',build:0,head:0},summary:{on:true,hide:true,keepShown:30,every:20,onSceneEnd:false}}); await L.openChat(page);
  await page.evaluate(async B=>{const K=await import(`${B}/src/books.js`),W=await import(`${B}/src/world.js`),E=await import(`${B}/src/events.js`),S=await import(`${B}/src/store.js`);const d={entries:{}},w=W.newWorldEntry(d,'character');w.name='Seraphina';w.fields.wants='To find the lost map';W.writeWorldEntry(d,w);W.setChatWorld(await K.createSet(`Context world ${Date.now()}`,'world',d,''));const x=E.newEvent('Context event');x.chance=100;x.wait=0;x.categories=[E.newCategory('Situation',['A window rattles'])];const ed={entries:{}};E.writeEvent(ed,x);const eid=await K.createSet(`Context event ${Date.now()}`,'events',ed,'');S.chatState().activeSets=[eid];S.saveChatState();},L.BASE);
  L.mode({reply:'Seraphina looks at the window.\n<story_update>\npresent: Seraphina\nwhere: Inn\nwhen: Night\n</story_update>'}); L.resetLog(); await L.send(page,'The wind rises outside.');
  const sent=L.text(L.requests().at(-1));;assert.match(sent,/window rattles/);assert.match(sent,/<story_update>/);
  const stats=await page.evaluate(async B=>(await import(`${B}/src/context-budget.js`)).lastContext(),L.BASE);
  assert(stats, 'host exposed final request');assert(stats.total>0);assert(stats.history.count>0);assert(stats.events.tokens>0, JSON.stringify(stats));assert(stats.updates.tokens>0, JSON.stringify(stats));
  await page.evaluate(async B=>{const P=await import(`${B}/src/ui/panel.js`);P.app.tab='context';document.body.append(P.app.root);P.app.render();},L.BASE);
  const view=page.locator('#ri_root');assert(await view.getByText('Last observed request').count());assert(await view.getByText('Keep Chat History enabled', {exact:false}).count());
  const range=view.getByRole('slider',{name:'Recent messages to protect'});await range.fill('12');assert.match(await view.locator('.ri-context-preview').innerText(),/tokens/);
  const count=await page.evaluate(async B=>(await import(`${B}/src/store.js`)).settings().summary.keepShown,L.BASE);assert.equal(count,12);
  const before=L.requests().length;await view.getByLabel('Write a chapter at least every').fill('8');await view.getByLabel('Write a chapter at least every').dispatchEvent('change');assert.equal(L.requests().length,before);
  await page.waitForTimeout(2500);await page.reload();await page.waitForFunction(()=>globalThis.SillyTavern?.getContext && document.getElementById('send_textarea') && !document.getElementById('preloader'),null,{timeout:90000});await page.waitForTimeout(1500);
  const saved=await page.evaluate(async B=>{const o=(await import(`${B}/src/store.js`)).settings().summary;return {keep:o.keepShown,every:o.every};},L.BASE);assert.deepEqual(saved,{keep:12,every:8});
  console.log('PASS real host: observed request, matched story event and update, context controls, no extra requests and persisted settings'); assert.deepEqual(errors, [], 'no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
