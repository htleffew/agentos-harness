const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:475,hasTouch:true,isMobile:true});
    try {
        await L.setupApi(page,{legacyAutomation:false});
        await L.openChat(page);
        L.resetLog();
        const samples=await page.evaluate(async base=>{
            const {app}=await import(base+'/src/ui/panel.js');
            const {listQuickActions,saveQuickAction}=await import(base+'/src/quick-actions.js');
            const prefix='UX benchmark preset action ';
            const present=new Set(listQuickActions().map(action=>action.title));
            for (let i=0;i<160;i++) {
                if (!present.has(prefix+i)) saveQuickAction({family:'steer',title:prefix+i,text:'Let the gate open quietly.'});
            }
            const availableActions=listQuickActions().length;
            const button=(root,text)=>[...root.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
            const layout=node=>node.getBoundingClientRect().height;
            const waitDOM=async predicate=>{
                const until=performance.now()+3000;
                while (!predicate()) {
                    if (performance.now()>until) throw new Error('The benchmark control did not appear.');
                    await new Promise(requestAnimationFrame);
                }
            };
            async function sample(measure) {
                await measure();
                const values=[];
                for (let i=0;i<7;i++) values.push(Math.round(100*await measure())/100);
                return {values,median:[...values].sort((a,b)=>a-b)[3]};
            }
            // B28: the launcher toolbar is gone. The bar's More menu opens the sheet with every quick action.
            const fold=document.querySelector('[aria-label="Open quick actions"]');
            if (fold) fold.click();
            const launcher=document.querySelector('.ri-bar-more');
            const openAll=()=>{
                launcher.click();
                [...document.querySelectorAll('.ri-bar-pop button')].find(node=>node.textContent.trim()==='All quick actions').click();
                return document.querySelector('.ri-quick-sheet');
            };
            const openSheet=await sample(()=>{
                const start=performance.now();
                const sheet=openAll();
                layout(sheet);
                sheet.querySelector('[data-quick-close]').click();
                return performance.now()-start;
            });
            await app.setExpanded(true);
            const switchPage=await sample(async()=>{
                await app.openPage('display');
                const start=performance.now();
                await app.openPage('settings');
                layout(app.body);
                return performance.now()-start;
            });
            const tool=app.body.querySelector('#ri-find-tool');
            const findTool=tool && await sample(()=>{
                tool.closest('details').open=true;
                const start=performance.now();
                tool.value=tool.value==='connection'?'lorebook':'connection';
                tool.dispatchEvent(new Event('input',{bubbles:true}));
                layout(app.body.querySelector('.ri-tool-results'));
                return performance.now()-start;
            });
            await app.setExpanded(false);
            const sheet=openAll();
            (button(sheet,'Browse directions') || button(sheet,'Browse all')).click();
            const searchField=()=>document.querySelector('.ri-quick-scroll[data-view="browse"] input[type="search"]');
            await waitDOM(searchField);
            const filterLibrary=await sample(()=>{
                const search=searchField();
                const start=performance.now();
                search.value=search.value?'':'UX benchmark preset action 15';
                search.dispatchEvent(new Event('input',{bubbles:true}));
                layout(document.querySelector('.ri-quick-sheet'));
                return performance.now()-start;
            });
            return {openSheet,switchPage,findTool,filterLibrary,fixtureActions:160,availableActions};
        },L.BASE);
        assert.deepEqual(errors,[]);
        assert.equal(L.requests().length,0);
        const result={viewport:[390,475],unit:'milliseconds',host:'SillyTavern 1.19.0',samples,requests:0};
        if (process.env.RI_UX_CAPTURE) fs.writeFileSync(process.env.RI_UX_CAPTURE,JSON.stringify(result,null,2)+'\n');
        console.log(result);
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
