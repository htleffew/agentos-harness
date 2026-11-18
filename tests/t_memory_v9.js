const L=require('./lib.js');
const assert=require('node:assert/strict');
(async()=>{L.sync();const {browser,page,errors}=await L.open();try {
 await L.setupApi(page);await L.setSettings(page,{check:{mode:'off'},perReply:0,scene:{track:true},cards:{on:false},world:{update:'all',build:0,head:0},summary:{on:true,onSceneEnd:false,every:2,hide:true,keepShown:4,roll:8}});await L.openChat(page);
 await page.evaluate(async B=>{const K=await import(`${B}/src/books.js`),W=await import(`${B}/src/world.js`);W.setChatWorld(await K.createSet(`Memory ${Date.now()}`,'world',{entries:{}},''));},L.BASE);
 L.mode({reply:'A calm answer.\n<story_update>\nwhere: Hall\nwhen: Today\n</story_update>',goal:JSON.stringify({title:'The hall',when:'Today',summary:'A conversation in the hall.',people:[],places:['Hall'],settled:''})});L.resetLog();
 for(let i=1;i<=4;i++) {await L.send(page,`HISTORY_MARKER_${i}`);await page.waitForTimeout(700);await page.waitForFunction(async B=>!(await import(`${B}/src/chapters.js`)).chapterBusy(),L.BASE,{timeout:30000});await page.evaluate(async B=>(await import(`${B}/src/worldflow.js`)).worldIdle(),L.BASE);}
 const state=await page.evaluate(()=>SillyTavern.getContext().chat.map(m=>({text:m.mes,hidden:!!m.is_system})));assert(state.find(m=>m.text.includes('HISTORY_MARKER_1')).hidden);assert(!state.find(m=>m.text.includes('HISTORY_MARKER_4')).hidden);assert(!state[0].hidden);
 await L.send(page,'HISTORY_MARKER_5');const prompt=L.text(L.requests().findLast(r=>r.answer.includes('A calm answer.')));assert(!prompt.includes('HISTORY_MARKER_1'));assert(prompt.includes('HISTORY_MARKER_4'));assert(prompt.includes('A conversation in the hall.'));
 const chapters=L.requests().filter(r=>/Write the summary of one part/.test(L.text(r)));assert.equal(chapters.length,2);
 assert.deepEqual(errors,[]);console.log('PASS chapter schedule, protected newest messages, hidden history omitted and summary included in next request');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
