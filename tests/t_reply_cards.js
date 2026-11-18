const L = require('./lib.js');
const assert = require('node:assert/strict');
(async () => {
 L.sync(); const { browser, page, errors } = await L.open();
 try {
  await L.setupApi(page); await L.setSettings(page,{check:{mode:'off'},perReply:0,scene:{track:true,card:'always'},cards:{on:true,most:1,roast:true,previousRoast:false},world:{update:'off'},showUnder:'off'}); await L.openChat(page);
  L.mode({reply:'The storm breaks.\n<story_update>\npresent: Seraphina\nwhere: The old observatory\nwhen: Late evening\nenvironment: Rain rattles against the glass.\n<profile name="Seraphina">\nMind: Find a safe route home.\nHeart: Torn between hope and worry.\nBody: A bruised shoulder.\nPsyche: Afraid to fail someone again.\n</profile>\n<roast>She has one plan and it is already leaking. Bold strategy.</roast>\n</story_update>'});
  await L.send(page,'We take shelter.');
  const stack=page.locator('#chat .last_mes .ri-reply-stack');await stack.waitFor();
  const cards=stack.locator(':scope > .ri-reply-card');assert.equal(await cards.count(),3);assert.deepEqual(await cards.evaluateAll(els=>els.map(e=>e.open)),[false,false,false]);
  await cards.nth(0).locator('summary').first().click();await cards.nth(1).locator('summary').first().click();await cards.nth(2).locator('summary').first().click();
  assert.match(await cards.nth(0).innerText(),/Rain rattles/);assert.match(await cards.nth(1).innerText(),/Torn between hope/);assert.match(await cards.nth(2).innerText(),/Bold strategy/);
  await page.evaluate(async B=>(await import(`${B}/src/ui/sent.js`)).refreshUnderReplies(),L.BASE);assert.deepEqual(await cards.evaluateAll(els=>els.map(e=>e.open)),[true,true,true]);
  await cards.nth(1).getByRole('button',{name:'Edit this snapshot'}).click();await cards.nth(1).locator('textarea').first().fill('Protect the wounded.');await cards.nth(1).getByRole('button',{name:'Save snapshot only'}).click();
  await page.waitForFunction(()=>!document.querySelector('#chat .last_mes .ri-reply-character .ri-state-editor'));assert.match(await cards.nth(1).innerText(),/Protect the wounded/);assert.deepEqual(await cards.evaluateAll(els=>els.map(e=>e.open)),[true,true,true]);
  await cards.nth(0).getByRole('button',{name:'Edit this scene snapshot'}).click();await cards.nth(0).locator('textarea').nth(1).fill('A sheltered tower');await cards.nth(0).getByRole('button',{name:'Save snapshot only'}).click();await page.waitForFunction(()=>!document.querySelector('#chat .last_mes .ri-reply-scene .ri-state-editor'));assert.match(await cards.nth(0).innerText(),/A sheltered tower/);
  await cards.nth(1).getByRole('button',{name:'Edit this snapshot'}).click();await cards.nth(1).getByRole('button',{name:'Cancel'}).click();await page.waitForFunction(()=>!document.querySelector('#chat .last_mes .ri-reply-character .ri-state-editor'));
  await stack.screenshot({path:'/tmp/ri-reply-desktop.png'});
  await page.setViewportSize({width:390,height:850});await page.waitForTimeout(500);await stack.screenshot({path:'/tmp/ri-reply-mobile.png'});
  const fit=await stack.evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth,cols:getComputedStyle(el.querySelector('.ri-reply-fields')).gridTemplateColumns}));assert(fit.scroll<=fit.client+1,JSON.stringify(fit));assert.equal(fit.cols.split(' ').length,1);
  L.mode({reply:'She waits for the rain.\n<story_update>\npresent: Seraphina\nwhere: The old observatory\nwhen: Late evening\n<profile name="Seraphina">\nMind: Find a safe route home.\n</profile>\n<roast>Still waiting.</roast>\n</story_update>'});await L.swipe(page);await stack.waitFor();assert.deepEqual(await stack.locator('.ri-reply-card').evaluateAll(els=>els.map(e=>e.open)),[false,false,false]);
  await page.evaluate(async B=>{const S=await import(`${B}/src/store.js`);S.settings().scene.card='off';S.saveSettings();(await import(`${B}/src/ui/sent.js`)).refreshUnderReplies();},L.BASE);assert.equal(await stack.count(),0);
  await page.evaluate(async B=>{const S=await import(`${B}/src/store.js`);S.settings().scene.card='always';S.settings().cards.roast=false;S.saveSettings();(await import(`${B}/src/ui/sent.js`)).refreshUnderReplies();},L.BASE);assert.equal(await stack.locator('.ri-reply-card').count(),2);assert.deepEqual(await stack.locator('.ri-reply-card').evaluateAll(els=>els.map(e=>e.open)),[false,false]);
  assert.deepEqual(errors,[]);console.log('PASS reply cards: independent collapsed drawers, scene and character editing, preserved open state, settings and mobile layout');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
