const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./h_memory.js');

const label = 'Write a chapter summary';
const summary = JSON.stringify({title:'Crossing the harbour',summary:'The captain crossed the harbour.',people:['Captain'],places:['Harbour']});
const options = {on:true,hide:false,retire:false,every:0,everyTokens:0,onSceneEnd:false,minReplies:2,roll:8};

async function chapterSettings(page,operation,state) {
    const pane=await H.tapPanel(page,'Review','Context & Memory');
    const opening=pane.getByText('Automatic chapter model requests',{exact:true});
    if (!await opening.evaluate(node=>node.parentElement.open)) await opening.tap();
    const setting=pane.getByLabel(operation+' automatic requests',{exact:true});
    await setting.selectOption(state ? 'on' : 'off');
    const functionSettings = setting.locator('xpath=ancestor::details[1]');
    assert.match(await functionSettings.innerText(),/Budget is one request per trigger/);
    assert.equal(await functionSettings.getByLabel(operation+' connection',{exact:true}).inputValue(),'');
    await H.closePanel(page);
}

async function chapterReceipt(page,outcome) {
    await page.waitForFunction(async ({base,outcome})=>{
        const {chapterBusy}=await import(base+'/src/chapters.js');
        const {executionReceipt}=await import(base+'/src/execution.js');
        return !chapterBusy() && executionReceipt('chapterSummary')?.outcome===outcome;
    },{base:H.BASE,outcome});
    return (await H.memory(page)).chapter;
}

(async()=>{
    const {browser,page,errors} = await H.openMemory();
    try {
        const disabled=await H.assertOnlyExtension(page);
        const evidence={host:'SillyTavern 1.19.0',viewport:[390,760],touch:true,preset:'Default',disabled};
        await H.setSettings(page,{world:{editableReplies:-1}});
        for (const [kind,config,trigger,why] of [
            ['count',{every:2},'The captain keeps walking.',/2 filed replies/],
            ['scene',{onSceneEnd:true},'The captain reaches the quay.\n<story_update>\nscene: ended\n</story_update>',/the scene ended/],
            ['tokens',{everyTokens:400},('The captain takes smaller steps around scattered ropes and rough planks. ').repeat(36),/unsummarized story reached about 400 tokens/],
        ]) {
            await H.setSettings(page,{summary:{...options,...config}});
            await H.newWorld(page,'Chapter '+kind);
            await chapterSettings(page,label,false);
            H.resetLog();
            H.mode({goal:summary,reply:'The captain pauses.'});
            await H.send(page,`${kind} threshold, opening exchange.`);
            H.mode({goal:summary,reply:trigger});
            await H.send(page,`${kind} threshold, reached with automation off.`);
            assert.equal(H.requests().length,2);
            assert.equal(H.due().length,0);
            assert.equal((await H.memory(page)).physical.length,0);
            await chapterSettings(page,label,true);
            assert.equal(H.requests().length,2);
            H.mode({goal:summary,reply:kind === 'scene' ? trigger : 'The captain walks onward.'});
            await H.send(page,`${kind} threshold, reached with automation on.`);
            const receipt=await chapterReceipt(page,'completed');
            assert.equal(receipt.attempts,1);
            assert.equal(receipt.authorization,'automatic');
            assert.match(receipt.result,why);
            assert.equal(H.due().length,1);
            assert.equal(H.requests().length,4);
            evidence[kind]={capture:`D-ST-A49-${kind}`,automaticOffCalls:0,afterEnableCalls:1,summaryRequest:H.due()[0],receipt};
            console.log(`PASS ${kind} threshold with automation off, then on`);
        }

        await H.setSettings(page,{summary:{...options,every:1,roll:2,keep:1}});
        await H.newWorld(page,'Chapter combine');
        await chapterSettings(page,label,true);
        await chapterSettings(page,'Combine older chapters',false);
        H.resetLog();
        H.mode({goal:summary,reply:'The captain advances along the harbour.'});
        for (let number=1;number<=3;number++) {
            await H.send(page,`Chapter combine example [${number}].`);
            await page.waitForFunction(async ({base,number})=>{
                const {chapterBusy}=await import(base+'/src/chapters.js');
                const {executionReceipt}=await import(base+'/src/execution.js');
                return !chapterBusy() && executionReceipt('chapterSummary')?.target.to===number;
            },{base:H.BASE,number});
        }
        const combined = ()=>H.requests().filter(request=>H.text(request).includes('Combine these summaries of the earlier parts'));
        assert.equal(combined().length,0);
        assert.equal(H.requests().length,6);
        await chapterSettings(page,'Combine older chapters',true);
        await H.send(page,'Chapter combine example [4].');
        await page.waitForFunction(async base=>{
            const {chapterBusy}=await import(base+'/src/chapters.js');
            const {executionReceipt}=await import(base+'/src/execution.js');
            return !chapterBusy() && executionReceipt('chapterCombine')?.outcome==='completed';
        },H.BASE);
        assert.equal(combined().length,1);
        assert.equal(H.requests().length,9);
        evidence.combine={capture:'D-ST-A49-combine',automaticOffCalls:0,afterEnableCalls:1,request:combined()[0]};

        await H.setSettings(page,{summary:{...options,every:1}});
        await H.newWorld(page,'Manual chapter retry');
        await chapterSettings(page,'Combine older chapters',false);
        H.resetLog();
        let blank;
        const blankSummary = route=>{
            const body=route.request().postData() || '';
            if (blank || !body.includes('Write the summary of one part of a roleplay story')) return route.continue();
            blank=body;
            return route.fulfill({json:{choices:[{message:{role:'assistant',content:''},finish_reason:'stop'}]}});
        };
        await page.route('**/api/backends/chat-completions/generate',blankSummary);
        H.mode({goal:summary,reply:'The captain walks toward the quay.'});
        await H.send(page,'Trigger the blank automatic chapter.');
        const failed=await chapterReceipt(page,'failed');
        assert(blank);
        assert.equal(failed.attempts,1);
        assert.match(failed.result,/empty answer/);
        await page.unroute('**/api/backends/chat-completions/generate',blankSummary);
        await H.send(page,'Wait for explicit recovery.');
        assert.equal(H.requests().length,2);
        const story=await H.tapPanel(page,'Story','Story World');
        await story.getByRole('button',{name:/^Write a chapter now/}).tap();
        const retried=await chapterReceipt(page,'completed');
        assert.equal(retried.authorization,'manual');
        assert.equal(retried.attempts,1);
        assert.equal(H.requests().length,3);
        evidence.blankChapter={capture:'D-ST-A51-chapter-blank',injectedBlankHostResponse:JSON.parse(blank),failed,retried,automaticRepeatCalls:0};
        await H.closePanel(page);

        await H.setSettings(page,{summary:{...options,every:2},world:{editableReplies:-1,update:'off'}});
        await H.newWorld(page,'Chapter catch-up');
        await chapterSettings(page,label,false);
        for (let number=1;number<=5;number++) {
            H.mode({reply:`Accepted batch story [${number}].`});
            await H.send(page,`Accepted batch prompt [${number}].`);
        }
        H.resetLog();
        H.mode({reply:summary});
        const ctx=await H.tapPanel(page,'Review','Context & Memory');
        const catchUp=ctx.getByRole('button',{name:/^Catch up this chat/});
        await page.waitForFunction(()=>[...document.querySelectorAll('#ri_panel_page button')].some(node=>
            node.textContent==='Catch up this chat' && node.dataset.riModelCost==='Up to 3 model calls'));
        assert.equal(H.requests().length,0);
        let failure;
        const providerError = route=>{
            const body=route.request().postData() || '';
            if (failure || !body.includes('Accepted batch story [3]')) return route.continue();
            failure=JSON.parse(body);
            return route.fulfill({status:503,json:{error:{message:'Fixture provider temporarily unavailable'}}});
        };
        await page.route('**/api/backends/chat-completions/generate',providerError);
        await catchUp.tap();
        await ctx.getByRole('status').filter({hasText:/1 batch saved in this run/}).waitFor();
        const first=(await H.memory(page)).catchUp;
        assert.equal(first.receipts.length,2);
        assert.deepEqual(first.receipts.map(r=>[r.target.from,r.target.to,r.attempts,r.outcome]),
            [[1,2,1,'completed'],[3,4,1,'failed']]);
        assert(failure);
        assert.equal(H.requests().length,1);
        await page.unroute('**/api/backends/chat-completions/generate',providerError);
        await page.waitForFunction(()=>[...document.querySelectorAll('#ri_panel_page button')].some(node=>
            node.textContent==='Catch up this chat' && node.dataset.riModelCost==='Up to 2 model calls'));
        await catchUp.tap();
        await ctx.getByRole('status').filter({hasText:/Saved 2 chapters/}).waitFor();
        const retry=(await H.memory(page)).catchUp;
        assert.deepEqual(retry.receipts.map(r=>[r.target.from,r.target.to,r.attempts,r.outcome]),
            [[3,4,1,'completed'],[5,5,1,'completed']]);
        assert.equal(H.requests().length,3);
        const receipts=ctx.locator('details.ri-execution').filter({hasText:'Catch up story history, replies 3–4'});
        await receipts.locator(':scope > summary').tap();
        await receipts.getByText('Replies 5–5',{exact:true}).waitFor();
        assert.equal(await receipts.getByText('Attempts used',{exact:true}).count(),2);
        assert.deepEqual(errors,[]);
        evidence.catchUp={capture:'D-ST-A51-catch-up',firstPreview:3,retryPreview:2,first:first.receipts,retry:retry.receipts,
            hostProviderError:failure,mockRequests:H.requests()};
        if (process.env.RI_MEMORY_EVIDENCE) fs.writeFileSync(process.env.RI_MEMORY_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
        console.log('PASS chapter count, scene, token and combine authorization, blank recovery, and catch-up batch receipts');
    } finally {
        await browser.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
