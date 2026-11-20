const assert = require('node:assert/strict');
const L = require('./lib.js');

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open();
    try {
        await L.setupApi(page);
        await L.setSettings(page,{check:{mode:'off'},summary:{on:true,every:0},world:{head:0}});
        await L.openChat(page);
        const setup=await page.evaluate(async B=>{
            const st=await import(`${B}/src/st.js`);
            const {blankEntry}=await import(`${B}/src/books.js`);
            const V=await import(`${B}/src/v10.js`);
            const W=await import(`${B}/src/world.js`);
            const state=await import(`${B}/src/store.js`);
            const vals={base:`Audit base ${Date.now()}`,behavior:`Audit guidance ${Date.now()}`};
            await st.saveBook(vals.base,{entries:{0:{...blankEntry(0),comment:'A ferry rule',content:'Starting canon',constant:true,useProbability:false}}});
            await st.refreshWorldList();
            await V.pinBase(vals.base);
            await V.createGuidelines(vals.behavior,'A writing rule.');
            V.selectGuidelines(vals.behavior);
            await V.ensureWorld();
            vals.original=W.chatWorld();
            state.chatState().sceneSeed={time:'Wednesday, Month 7, Day 14, 3:45 AM, Clear 38°F',where:'The pass'};
            V.prefs().enabled=true;
            await st.ctx().saveMetadata();
            return vals;
        },L.BASE);
        await L.makeSet(page,`Audit random instructions ${Date.now()}`,[{versions:['A1']}]);
        const books=page.locator('#ri_root [data-book-name]');
        const bookRow=name=>books.filter({has:page.getByText(name,{exact:true})});
        const open=()=>page.locator('#ri_root [data-ri-page="books"]').evaluate(el=>el.click());
        await open();
        const initial=await books.evaluateAll(rows=>rows.map(row=>row.textContent));
        assert(initial.some(row=>row.includes(setup.original) && row.includes('Chapter summaries')));
        assert(initial.some(row=>row.includes(setup.behavior)));
        assert(initial.some(row=>row.includes('Random Instructions')));
        const native=bookRow(setup.base);
        await native.locator('summary').first().evaluate(el=>el.click());
        await native.locator('button').filter({hasText:/^Edit$/}).evaluate(el=>el.click());
        await native.locator('[aria-label="Entry content"]').evaluate(el=>el.value='UPDATED-BASE-CANON');
        await native.locator('button').filter({hasText:'Save entry'}).evaluate(el=>el.click());
        await page.waitForFunction(async ({B,name})=>{
            const V=await import(`${B}/src/v10.js`);
            return V.prefs().base?.entries?.[0]?.content==='UPDATED-BASE-CANON' && V.prefs().base.name===name;
        },{B:L.BASE,name:setup.base});
        const result=await page.evaluate(async B=>{
            const {startNewChapter}=await import(`${B}/src/chapters.js`);
            const {burnedSoFar}=await import(`${B}/src/engine.js`);
            const W=await import(`${B}/src/world.js`);
            await startNewChapter({summary:'CLEAR-CONTINUITY-MARKER',first:'The morning is quiet.'},burnedSoFar);
            const book=W.chatWorld(), data=await W.loadWorld(book);
            const chapter=W.listWorld(data,book).find(row=>row.rollup && row.on);
            return {book,activation:chapter.activation};
        },L.BASE);
        assert.notEqual(result.book,setup.original);
        assert.equal(result.activation.window,6);
        assert.equal(result.activation.mode,'window');
        await open();
        assert.match(await bookRow(setup.original).textContent(),/Earlier or source Story World/);
        assert.match(await bookRow(result.book).textContent(),/Chapter summaries/);
        const scene=await page.evaluate(async B=>(await import(`${B}/src/state.js`)).snapshotScene(0),L.BASE);
        assert.equal(scene.date,'Wednesday, Month 7, Day 14');
        assert.equal(scene.weather,'Clear 38°F');
        assert.equal(scene.time,'3:45 AM');
        assert.match(await page.locator('#chat .ri-scene-header').first().textContent(),/Wednesday.*Clear 38°F/);
        await open();
        const inherited=bookRow(result.book);
        await inherited.locator('summary').first().evaluate(el=>el.click());
        await inherited.locator('button').filter({hasText:/^Edit$/}).evaluate(el=>el.click());
        await inherited.locator('[aria-label="Activation"]').evaluate(el=>el.value='off');
        await inherited.locator('button').filter({hasText:'Save entry'}).evaluate(el=>el.click());
        await page.waitForFunction(async B=>{
            const V=await import(`${B}/src/v10.js`);
            return (await V.rowsForWorld()).some(row=>row.rollup && row.activation?.mode==='off');
        },L.BASE);
        L.mode({reply:'The road is clear.'});
        L.resetLog();
        await L.send(page,'I look ahead.');
        assert.doesNotMatch(L.text(L.requests()[0]),/CLEAR-CONTINUITY-MARKER/);
        await open();
        await inherited.locator('summary').first().evaluate(el=>{el.parentElement.open=true;});
        await inherited.locator('[aria-label="Select all entries"]').evaluate(el=>el.click());
        await inherited.locator('button').filter({hasText:'Delete selected entries'}).evaluate(el=>el.click());
        await page.locator('dialog[open] .popup-button-ok').click();
        await page.waitForFunction(async B=>{
            const V=await import(`${B}/src/v10.js`);
            return !(await V.rowsForWorld()).some(row=>row.rollup);
        },L.BASE);
        const original=await page.evaluate(async ({B,name})=>(await (await import(`${B}/src/st.js`)).loadBook(name)).entries,{B:L.BASE,name:setup.original});
        assert(!JSON.stringify(original).includes('CLEAR-CONTINUITY-MARKER'));
        assert.deepEqual(errors,[]);
        console.log('PASS chat books: catalog, native editing, isolated chapter book, carryover policy and date/weather fields');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
