const assert = require('node:assert/strict');
const L = require('./lib.js');

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
            try { await next.tap({timeout:2000}); }
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
        try { await summary.tap({timeout:2000}); }
        catch(error) {
            if (!await summary.evaluate(node=>node.isConnected).catch(()=>false)) continue;
            throw error;
        }
        assert.equal(await summary.evaluate(node=>node.parentElement?.open ?? false),false,title);
    }
    return visited.size;
}

(async()=>{
    // B5 replaced the page chooser with five top tabs and nested tabs. Retired with the old UI: the Preset & Extension
    // workflow and module scope controls (B12's Presets page and t_module_ownership.js), the Find and page-row
    // navigation, and the receipt links of What was sent (B10 and B11 move receipts into the reply tray).
    L.sync();
    const portraitHeight=Number(process.env.RI_PANEL_HEIGHT || 1021);
    const {browser,page,errors}=await L.open({width:523,height:portraitHeight,hasTouch:true,isMobile:true});
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root=page.locator('#ri_root'), body=root.locator('#ri_panel_page');
        await page.evaluate(async B=>{const {app}=await import(`${B}/src/ui/panel.js`);await app.openPage('state',{focusPage:true});await app.setExpanded(true);},L.BASE);
        assert.ok(await root.evaluate(node=>node.classList.contains('ri-expanded')));
        const tree=await page.evaluate(async B=>{
            const {buildTree}=await import(`${B}/src/ui/destinations.js`);
            const {registeredPages}=await import(`${B}/src/ui/page-registry.js`);
            return buildTree(registeredPages()).map(top=>({id:top.id,nested:top.nested.map(item=>({id:item.id,label:item.label,pages:item.pages.filter(p=>!p.sub).map(p=>({id:p.id,label:p.label}))}))}));
        },L.BASE);
        const visited=[];
        const widths=Object.hasOwn(process.env,'RI_PANEL_WIDTHS')
            ? process.env.RI_PANEL_WIDTHS.split(',').filter(Boolean).map(Number) : [523,1006];
        const textScale=Number(process.env.RI_PANEL_TEXT_SCALE || 0);
        if (textScale) await page.evaluate(scale=>document.documentElement.style.setProperty('--fontScale',scale),textScale);
        for (const width of widths) {
            await page.setViewportSize({width,height:width<1000 ? portraitHeight : 909});
            let opened=0;
            const firstPage=visited.length;
            for (const top of tree) {
                await root.locator(`[data-ri-tab="${top.id}"]`).tap();
                for (const nested of top.nested) {
                    await root.locator(`[data-ri-nested="${nested.id}"]`).tap();
                    assert.equal(await root.locator('[data-ri-heading]').textContent(),nested.label);
                    for (const [index,item] of nested.pages.entries()) {
                        if (nested.pages.length>1 && index>0) await root.locator(`.ri-shell-section[data-ri-page="${item.id}"]`).tap();
                        await page.waitForTimeout(150);
                        assert.ok((await body.innerText()).trim().length>0,`${nested.label}, ${item.label} is empty`);
                        assert.ok(await body.evaluate(node=>node.scrollWidth<=node.clientWidth+2),`${nested.label}, ${item.label} overflows at ${width}px`);
                        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`page scrolls sideways on ${item.label} at ${width}px`);
                        opened+=await auditDisclosures(body);
                        visited.push(`${nested.label}, ${item.label}`);
                    }
                }
            }
            console.log(`Audited all ${visited.length-firstPage} pages and ${opened} reachable disclosures at ${width}px${textScale ? ` and ${textScale*100}% text` : ''}.`);
        }
        const power=root.getByRole('switch',{name:'Turn the whole extension on or off'});
        if (await power.count()) {
            await power.tap();
            assert.equal(await power.getAttribute('aria-checked'),'false');
            await power.tap();
            assert.equal(await power.getAttribute('aria-checked'),'true');
        }
        await root.getByRole('button',{name:'Close full screen',exact:true}).focus();
        await page.keyboard.press('Escape');
        assert.equal(await root.evaluate(node=>node.classList.contains('ri-expanded')),false);
        assert.deepEqual(errors,[]);
        console.log('PASS extension pages in every nested tab at '+widths.join(' and ')+' px, nested disclosures, power switch and Escape');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
