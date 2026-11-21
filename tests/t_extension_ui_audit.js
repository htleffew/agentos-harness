const assert = require('node:assert/strict');
const L = require('./lib.js');

const navigation = {
    Story:['Opening','Current State','Corrections','Reusable Lorebooks','Chat Facts','Plot Records','Story World'],
    Characters:['Portrayal & Knowledge','Emotions & Relationships','Character Goals','Dialogue Colors'],
    Direction:['Random Instructions','Random Story Events','Random Writing Style','Writing Guidance','Action Checks'],
    Review:['What Was Sent','Context & Memory','Log'],
    Setup:['Preset & Extension','Reply Display','Settings'],
};
const modules = ['style','preflight','colors','roast','roastFeedback','state','knowledge','emotions',
    'relationships','plots','worldEvents','dice'];

async function auditDisclosures(body) {
    const opened = [];
    const visited = new Set();
    for (;;) {
        const key = await body.locator('details > summary:visible').evaluateAll((summaries, seen)=>{
            for (const node of summaries) {
                const parts=[];
                for (let item=node; item && item.id!=='ri_panel_page'; item=item.parentElement) {
                    parts.push([...item.parentElement.children].indexOf(item));
                }
                const path=parts.join('.');
                if (!seen.includes(path)) {
                    node.dataset.riAuditDisclosure=path;
                    return path;
                }
            }
            return null;
        },[...visited]);
        if (key===null) break;
        visited.add(key);
        const match=body.locator(`summary[data-ri-audit-disclosure="${key}"]`);
        const next=await match.elementHandle({timeout:1000}).catch(()=>null);
        // Opening a disclosure can finish an asynchronous section refresh.
        if (!next || !await next.isVisible()) continue;
        const title=(await next.innerText()).trim();
        if (!await next.evaluate(node=>node.parentElement.open)) {
            try { await next.click({timeout:2000}); }
            catch(error) {
                if (!await next.evaluate(node=>node.isConnected).catch(()=>false)) continue;
                throw error;
            }
            assert.ok(await next.evaluate(node=>!node.isConnected || node.parentElement.open));
            opened.push({summary:next,title});
        }
    }
    // Close deepest first. Each click should return the browser's disclosure to its initial state.
    for (const {summary,title} of opened.reverse()) {
        if (!await summary.isVisible() || !await summary.evaluate(node=>node.parentElement?.open)) continue;
        try { await summary.click({timeout:2000}); }
        catch(error) {
            if (!await summary.evaluate(node=>node.isConnected).catch(()=>false)) continue;
            throw error;
        }
        assert.equal(await summary.evaluate(node=>node.parentElement?.open ?? false),false,title);
    }
    return visited.size;
}

(async()=>{
    L.sync();
    const {browser,page,errors}=await L.open({width:390,height:820});
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root=page.locator('#ri_root'), body=root.locator('#ri_panel_page');
        const openInline=async()=>{
            if (!await page.locator('#ri_drawer').isVisible()) await page.locator('#extensions-settings-button > .drawer-toggle').click();
            if (!await root.isVisible()) await page.locator('#ri_drawer .inline-drawer-header').click();
        };
        await openInline();
        const click=(label)=>root.getByRole('button',{name:label,exact:true}).click();
        const group=(label)=>root.getByRole('navigation',{name:'Roleplay sections'}).getByRole('button',{name:label,exact:true});
        const menu=(label)=>body.getByLabel(label,{exact:true});
        await click('Expand');
        assert.ok(await root.evaluate(node=>node.classList.contains('ri-expanded')));
        await group('Setup').click();
        await click('Preset & Extension');
        const workflow=menu('Story workflow for this chat');
        await workflow.selectOption('memory');
        assert.equal(await body.locator('[data-module]').count(),0);
        await group('Story').click();
        await click('Opening');
        await click('Open workflow settings');
        assert.equal(await workflow.inputValue(),'memory');
        await menu('World Info recall').selectOption('off');
        assert.equal(await menu('World Info recall').inputValue(),'off');
        await menu('World Info recall').selectOption('on');
        await menu('Chapter summaries').selectOption('off');
        assert.equal(await menu('Auto-hide summarized messages').isDisabled(),true);
        await menu('Chapter summaries').selectOption('on');
        await menu('Auto-hide summarized messages').selectOption('off');
        assert.equal(await menu('Auto-hide summarized messages').inputValue(),'off');
        await menu('Auto-hide summarized messages').selectOption('on');
        await workflow.selectOption('off');
        assert.equal(await body.locator('[data-module]').count(),0);
        await workflow.selectOption('inherit');
        assert.equal(await workflow.inputValue(),'inherit');
        await workflow.selectOption('on');
        assert.deepEqual(await body.locator('[data-module]').evaluateAll(nodes=>nodes.map(node=>node.dataset.module)),modules);
        const exerciseModules=async()=>{
            for (const key of modules) {
                const row=body.locator(`[data-module="${key}"]`);
                const select=row.locator('.ri-module-actions select');
                assert.equal(await select.isEnabled(),true,key);
                const original=await select.inputValue();
                const opposite=original==='on'?'off':'on';
                await select.selectOption(opposite);
                assert.equal(await select.inputValue(),opposite,key);
                await row.getByRole('button',{name:/^Use extension /}).click();
                assert.equal(await select.inputValue(),original,key);
            }
        };
        await exerciseModules();
        await click('Extension defaults for this preset');
        assert.equal(await root.getByRole('button',{name:'Extension defaults for this preset'}).getAttribute('aria-pressed'),'true');
        await exerciseModules();
        await click('This chat');
        await group('Direction').click();
        await click('Random Story Events');
        await click('Change autonomous world events');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'ri-module-worldEvents');
        assert.equal(await root.locator('[data-module-scope="chat"]').getAttribute('aria-pressed'),'true');
        const visited = [];
        for (const width of [390,1280]) {
            await page.setViewportSize({width,height:850});
            let opened=0;
            for (const [section,pages] of Object.entries(navigation)) {
                await group(section).click();
                for (const label of pages) {
                    const tab=root.getByRole('navigation',{name:section+' pages'}).getByRole('button',{name:label,exact:true});
                    await tab.click();
                    assert.equal(await tab.getAttribute('aria-current'),'page',label);
                    assert.ok((await body.innerText()).trim().length>0,label);
                    assert.ok(await body.evaluate(node=>node.scrollWidth<=node.clientWidth+2),`${label} overflows at ${width}px`);
                    opened+=await auditDisclosures(body);
                    visited.push(label);
                }
            }
            console.log(`Audited all ${visited.length/(width===390?1:2)} pages and ${opened} reachable disclosures at ${width}px.`);
        }
        await group('Story').click();
        await click('Chat Facts');
        await click('Add record');
        await menu('Record text').fill('A new fact written without an ID.');
        await click('Current State');
        const dialog=page.locator('dialog[open]');
        await dialog.locator('.popup-button-cancel').click();
        assert.equal(await menu('Record text').inputValue(),'A new fact written without an ID.');
        await click('Save record');
        await body.getByText(/Fact · a-new-fact-written-without-an-id/).waitFor();
        await group('Direction').click();
        await click('Writing Guidance');
        const writing=body.locator('details').filter({has:page.getByLabel('Live writing guidance',{exact:true})});
        await writing.locator('summary').click();
        const guidance=menu('Live writing guidance');
        const previous=await guidance.inputValue();
        await guidance.fill('Keep dialogue concise and unmistakably individual.');
        await click('Close full screen');
        assert.equal(await guidance.inputValue(),'Keep dialogue concise and unmistakably individual.');
        await click('Expand');
        await group('Review').click();
        await dialog.locator('.popup-button-cancel').click();
        assert.equal(await guidance.inputValue(),'Keep dialogue concise and unmistakably individual.');
        await writing.getByRole('button',{name:'Discard draft',exact:true}).click();
        assert.equal(await guidance.inputValue(),previous);
        await guidance.fill('Keep dialogue concise and unmistakably individual.');
        await writing.getByRole('button',{name:'Save guidance',exact:true}).click();
        await writing.getByRole('status').filter({hasText:'Saved for this chat.'}).waitFor();
        assert.match(await writing.locator('summary').textContent(),/Customized/);
        await writing.getByRole('button',{name:'Restore default',exact:true}).click();
        assert.equal(await guidance.inputValue(),previous);
        await root.getByRole('button',{name:'Close full screen',exact:true}).focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        assert.ok(await root.evaluate(node=>node.contains(document.activeElement)));
        const power=root.getByRole('switch',{name:'Turn the whole extension on or off'});
        await power.click();
        assert.equal(await power.getAttribute('aria-checked'),'false');
        await power.click();
        assert.equal(await power.getAttribute('aria-checked'),'true');
        await root.getByRole('button',{name:'Close full screen',exact:true}).focus();
        await page.keyboard.press('Escape');
        assert.equal(await root.evaluate(node=>node.classList.contains('ri-expanded')),false);
        await L.setSettings(page,{check:{mode:'off'}});
        L.mode({reply:'Mira puts the compass on the table.'});
        await L.send(page,'I listen to Mira.');
        await openInline();
        await click('Expand');
        await group('Review').click();
        await click('What Was Sent');
        await body.getByText('The extension confirmed story guidance was sent. Exact text was not saved for this reply.').waitFor();
        await click('Edit writing guidance');
        await page.waitForFunction(()=>document.activeElement.id==='ri-profile-style');
        await click('Close full screen');
        const ruleSet=`UI audit rule ${Date.now()}`;
        await L.makeSet(page,ruleSet,[{name:'Receipt example',versions:['RAUDIT'],chance:100,wait:5}]);
        await L.send(page,'I check the compass again.');
        await openInline();
        await click('Expand');
        await group('Review').click();
        await click('What Was Sent');
        const receipt=body.locator('.ri-sentcard').first();
        await receipt.getByText('Always eligible · 100% configured chance · wait 5 replies').waitFor();
        await receipt.getByText('World Info selections',{exact:true}).click();
        await receipt.getByRole('button',{name:'Open in Direction for Receipt example'}).click();
        const name=body.getByPlaceholder('Example: Picks a fight');
        assert.equal(await name.inputValue(),'Receipt example');
        await group('Review').click();
        await click('Edit this instruction');
        assert.equal(await name.inputValue(),'Receipt example');
        assert.deepEqual(errors,[]);
        console.log('PASS extension navigation, nested disclosures, both settings scopes, all extension modules, memory components and both display sizes');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
