const assert = require('node:assert/strict');
const L = require('./lib.js');

async function openMemory() {
    L.sync();
    const app = await L.open({width:390,height:760,hasTouch:true,isMobile:true,
        setupPage:page=>page.route('**/api/horde/**',route=>route.fulfill({json:route.request().url().endsWith('/status') ? {ok:true} : []}))});
    app.page.setDefaultTimeout(16000);
    await L.setupApi(app.page,{legacyAutomation:false});
    await L.setSettings(app.page,{check:{mode:'off'},world:{editableReplies:5,update:'all',build:0,head:0},summary:{on:false}});
    return app;
}

async function newWorld(page,label) {
    await L.openChat(page);
    return page.evaluate(async ({base,label})=>{
        const {createSet} = await import(base+'/src/books.js');
        const {setChatWorld} = await import(base+'/src/world.js');
        const id = await createSet(`${label} ${Date.now()}`,'world',{entries:{}},'');
        setChatWorld(id);
        return id;
    },{base:L.BASE,label});
}

async function memory(page) {
    return page.evaluate(async base=>{
        const {KEY} = await import(base+'/src/st.js');
        const {listWorld,chatWorld} = await import(base+'/src/world.js');
        const {loadDurableWorld,loadEffectiveWorld,worldIdle} = await import(base+'/src/worldflow.js');
        const {storyJournalStatus} = await import(base+'/src/memory-journal.js');
        const {chapterBusy,historyCatchUpStatus} = await import(base+'/src/chapters.js');
        const {executionReceipt} = await import(base+'/src/execution.js');
        await worldIdle();
        const world = chatWorld(), host = SillyTavern.getContext();
        return {world,physical:listWorld(await loadDurableWorld(world),world),effective:listWorld(await loadEffectiveWorld(world),world),
            journal:storyJournalStatus(),busy:chapterBusy(),chapter:executionReceipt('chapterSummary'),catchUp:historyCatchUpStatus(),
            corrections:host.chatMetadata[KEY]?.storyCorrections || [],
            messages:host.chat.map(({mes,send_date,is_user,swipe_id,swipes,extra})=>({mes,send_date,is_user,swipe_id,swipes,rec:extra?.[KEY]}))};
    },L.BASE);
}

async function tapPanel(page,group,target) {
    const extension = page.locator('#extensions-settings-button > .drawer-toggle');
    const header = page.locator('#ri_drawer .inline-drawer-header');
    const root = page.locator('#ri_root');
    if (!await page.locator('#ri_root.ri-expanded').isVisible()) {
        const drawer = page.locator('#rm_extensions_block.openDrawer');
        if (!await drawer.count()) await extension.tap();
        await drawer.waitFor();
        if (!await root.isVisible()) await header.tap();
        await root.getByRole('button',{name:'Expand',exact:true}).tap();
        await page.locator('#ri_root.ri-expanded').waitFor();
    }
    await root.getByRole('button',{name:group,exact:true}).tap();
    await root.getByRole('button',{name:target,exact:true}).tap();
    return root.locator('#ri_panel_page');
}

async function closePanel(page) {
    const close = page.locator('#ri_root').getByRole('button',{name:'Close full screen',exact:true});
    if (await close.isVisible()) {
        await close.tap();
        await page.locator('#ri_root.ri-expanded').waitFor({state:'detached'});
    }
    if (await page.locator('#rm_extensions_block.openDrawer').count()) {
        await page.locator('#extensions-settings-button > .drawer-toggle').tap();
        await page.locator('#rm_extensions_block.openDrawer').waitFor({state:'detached'});
    }
}

async function repairSheet(page,index) {
    const message = index===undefined ? '#chat .last_mes' : `#chat .mes[mesid="${index}"]`;
    await page.locator(message).getByRole('button',{name:'Generate an alternate reply',exact:true}).tap();
    const dialog = page.getByRole('dialog',{name:'Generate an alternate reply'});
    await dialog.getByRole('button',{name:'Fix world facts',exact:true}).tap();
    return dialog;
}

const fact = (rows,title,field='what')=>rows.find(row=>row.name===title)?.fields[field];
const due = () => L.requests().filter(request=>L.text(request).includes('Write the summary of one part of a roleplay story'));
const result = (scope,text) => scope.getByRole('status').filter({hasText:text}).first().waitFor();
const closeSheet = async (dialog) => dialog.getByRole('button',{name:'Close',exact:true}).tap();
const assertOnlyExtension = async (page) => {
    const disabled = await page.evaluate(()=>SillyTavern.getContext().extensionSettings.disabledExtensions);
    assert(disabled.includes('quick-reply') && disabled.includes('memory'));
    return disabled;
};

module.exports={...L,openMemory,newWorld,memory,tapPanel,closePanel,repairSheet,fact,due,result,closeSheet,assertOnlyExtension};
