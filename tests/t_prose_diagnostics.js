const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const L = require('./lib.js');

const evidence = [
    'The harbor watch patrols the southern pier in rain.',
    'The bakery workers carry the sacks through freezing streets.',
    'The soldiers set their lanterns by the carriage gate.',
];
const replacement = 'The watch grants the fishermen leave for the evening.';
const edit = 'The bakery workers board their wagon at sunrise.';
const viewport = { width:390, height:820, hasTouch:true, isMobile:true };
const mockIds = rows => rows.map(({ messages,answer }, index) => {
    const previous = rows[index-1]?.messages || [];
    let sharedPrefixMessages = 0;
    while (sharedPrefixMessages < Math.min(messages.length,previous.length) &&
        JSON.stringify(previous[sharedPrefixMessages]) === JSON.stringify(messages[sharedPrefixMessages])) sharedPrefixMessages++;
    return {
        id:`h4-${index+1}`, answer, sha256:crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
        sharedPrefixMessages, firstChangedRole:messages[sharedPrefixMessages]?.role ?? null, providerCacheMetrics:null,
        writing:messages.filter(message=>message.role==='system' && /Writing review:|Current writing guidance/.test(String(message.content)))
            .flatMap(message=>String(message.content).split('\n').filter(line=>/Writing review:|Current writing guidance|of the last \d+ story replies/.test(line))),
    };
});
const messageIndex = (page, prose) => page.evaluate(prose=>SillyTavern.getContext().chat.findIndex(row=>row.mes===prose),prose);

async function sendByTouch(page, text, reply) {
    const composer = page.locator('#send_textarea');
    await composer.tap();
    await composer.fill(text);
    L.mode({reply});
    await page.locator('#send_but').tap();
    await page.waitForFunction(expected=>SillyTavern.getContext().chat.at(-1)?.mes?.startsWith(expected),reply.split('\n')[0]);
    await L.idle(page);
}

async function showNotes(page, index) {
    const reply = page.locator(`#chat .mes[mesid="${index}"]`);
    const card = reply.locator('[data-reply-fold="notes"]');
    if (await card.count()) {
        if (!await card.getAttribute('open').then(open=>open!==null)) await card.locator('summary').first().tap();
        return card;
    }
    const console = reply.locator('[data-reply-fold="console"]');
    if (!await console.getAttribute('open').then(open=>open!==null)) await console.locator('summary').first().tap();
    await console.getByRole('tab',{ name:'Notes' }).tap();
    return console;
}

async function enableReview(page) {
    if (!await page.locator('#ri_drawer').isVisible()) await page.locator('#extensions-settings-button > .drawer-toggle').tap();
    const root = page.locator('#ri_root');
    if (!await root.isVisible()) await page.locator('#ri_drawer .inline-drawer-header').tap();
    await root.getByRole('navigation',{name:'Roleplay sections'}).getByRole('button',{name:'Direction',exact:true}).tap();
    await root.getByRole('button',{name:'Writing Guidance',exact:true}).tap();
    const review = root.getByLabel('Review recent writing with the reply',{exact:true});
    assert.equal(await review.inputValue(),'off');
    await review.selectOption('on');
    await root.getByLabel('Show turn length and dialogue share',{exact:true}).selectOption('on');
    await page.locator('#extensions-settings-button > .drawer-toggle').tap();
}

async function selectCompanion(page) {
    const drawer = page.locator('#ai-config-button > .drawer-toggle');
    await drawer.tap();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#import_oai_preset').tap();
    await (await chooser).setFiles(require.resolve('../presets/Roleplay Instructions V10.json'));
    const overwrite = page.locator('dialog[open]').filter({hasText:'Overwrite?'}).locator('.popup-button-ok');
    if (await overwrite.isVisible()) await overwrite.tap();
    await page.waitForFunction(()=>document.querySelector('#settings_preset_openai option:checked')?.textContent.trim()==='Roleplay Instructions V10');
    await drawer.tap();
}

(async () => {
    L.sync();
    const { browser,page,errors } = await L.open(viewport);
    try {
        const disabled = await page.evaluate(async ()=>{
            const response = await fetch('/api/extensions/discover');
            if (!response.ok) throw new Error('Could not inspect the isolated extension setup.');
            const context = SillyTavern.getContext();
            const names = (await response.json()).map(extension=>extension.name).filter(name=>name!=='third-party/roleplay-instructions');
            const changed = names.some(name=>!context.extensionSettings.disabledExtensions?.includes(name));
            context.extensionSettings.disabledExtensions = names;
            if (changed) context.saveSettingsDebounced();
            return { names, changed };
        });
        if (disabled.changed) {
            await page.waitForTimeout(1400);
            await page.reload({waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>globalThis.SillyTavern?.getContext && !document.getElementById('preloader'));
        }
        await L.openChat(page);
        const companion = process.env.RI_PROSE_COMPANION === '1';
        if (companion) await selectCompanion(page);
        await L.setupApi(page,{legacyAutomation:false,preset:companion ? null : 'Default'});
        await page.waitForFunction(()=>!document.querySelector('#send_but').classList.contains('displayNone'));
        L.resetLog();
        for (const [index,prose] of evidence.entries()) await sendByTouch(page,`Move the story forward, turn ${index+1}.`,prose);
        await enableReview(page);
        const labels = await page.evaluate(async base=>{
            const { prepareProseDiagnostics }=await import(`${base}/src/prose-diagnostics.js`);
            return prepareProseDiagnostics(SillyTavern.getContext().chat,{mode:'normal',audit:true}).candidates.map(({label,prose})=>({label,prose}));
        },L.BASE);
        const examples=evidence.map(prose=>({reply:labels.find(row=>row.prose===prose)?.label,evidence:prose}));
        assert.ok(examples.every(row=>row.reply),'host included all three eligible source replies');
        const findings=[{pattern:'recap',examples}];
        const owner='Nora pinched the candle flame.';
        await sendByTouch(page,'Show me what the lamplighter does.',`${owner}\n<writing_notes>${JSON.stringify({findings})}</writing_notes>`);
        const ownerIndex=await messageIndex(page,owner);
        assert.ok(ownerIndex>0,'structured metadata is absent from visible prose');
        const before=await showNotes(page,ownerIndex);
        await before.getByText(/3 of 3 cited replies still support/).waitFor();
        await before.getByText(/words · about \d+% in quotation marks/).waitFor();

        const first=await messageIndex(page,evidence[0]);
        const second=await messageIndex(page,evidence[1]);
        await page.evaluate(async ({first,replacement})=>{
            const context=SillyTavern.getContext(), target=context.chat[first];
            const alternate={send_date:'2026-11-21T19:30:00.000Z',extra:{}};
            target.swipes=[target.mes,replacement];
            target.swipe_info=[{send_date:target.send_date,extra:structuredClone(target.extra)},alternate];
            target.swipe_id=0;
            await context.swipe.to(null,'right',{message:target,source:'swipe_picker',forceSwipeId:1,forceDuration:0});
        },{first,replacement});
        await page.waitForFunction(({first,replacement})=>SillyTavern.getContext().chat[first]?.mes===replacement,{first,replacement});
        const secondReply=page.locator(`#chat .mes[mesid="${second}"]`);
        await secondReply.locator('.mes_edit').tap({force:true});
        await secondReply.locator('textarea.edit_textarea').fill(edit);
        await secondReply.locator('.mes_edit_done').tap();
        await page.waitForFunction(({second,edit})=>SillyTavern.getContext().chat[second]?.mes===edit,{second,edit});
        const after=await showNotes(page,ownerIndex);
        await after.getByText(/1 of 3 cited replies still support/).waitFor();

        const next='The shop closes when the last visitor leaves.';
        await sendByTouch(page,'What happens after the lights go down?',next);
        const nextIndex=await messageIndex(page,next);
        await (await showNotes(page,nextIndex)).getByText(/Included in the reply request/).waitFor();
        await sendByTouch(page,'Check the far side of the square.','The market stalls fold against the wind.');

        const captured=L.requests();
        assert.equal(captured.length,6,'only the six ordinary reply requests were sent');
        assert.match(L.text(captured[3]),/Writing review: Look at the last/);
        assert.doesNotMatch(L.text(captured[3]),/Current writing guidance/);
        assert.match(L.text(captured[4]),/1 of the last [45] story replies restated/);
        assert.doesNotMatch(L.text(captured[4]),/freezing streets|southern pier in rain|<writing_notes>\{"findings":\[\{"pattern":"recap","examples":\[\{"reply":"R\d","evidence":"The harbor/);
        assert.doesNotMatch(L.text(captured[5]),/Current writing guidance|of the last [45] story replies restated/);
        assert.ok(captured[4].messages.some(message=>String(message.content).includes(replacement)));
        assert.ok(captured[4].messages.some(message=>String(message.content).includes(edit)));
        const state=await page.evaluate(({ownerIndex,nextIndex})=>{
            const { chat,chatMetadata }=SillyTavern.getContext();
            return {
                earlier:chat[ownerIndex].extra.roleplay_instructions.proseDiagnostics,
                next:chat[nextIndex].extra.roleplay_instructions.proseDiagnostics,
                spent:chatMetadata.roleplay_instructions.proseDiagnostics.spent,
            };
        },{ownerIndex,nextIndex});
        assert.equal(state.earlier.audits[0].evidence.length,3);
        assert.equal(state.next.delivery.findings[0].count,1);
        assert.equal(state.next.delivery.outcome,'confirmed');
        assert.equal(state.spent.length,1);
        if (process.env.RI_DIAGNOSTICS_CAPTURE) fs.writeFileSync(process.env.RI_DIAGNOSTICS_CAPTURE,JSON.stringify({
            fixture:'Synthetic harbor and bakery revisions', viewport, preset:companion ? 'Roleplay Instructions V10' : 'Default',
            host:{name:'SillyTavern',version:require(path.resolve(process.env.RI_ST_DIR || '/tmp/src/st','package.json')).version,
                browser:browser.version(),provider:'OpenAI-compatible loopback mock'}, enabled:['Roleplay Instructions'],
            disabled:disabled.names,requests:mockIds(captured),
            observed:['Notes opened by touch before and after edits','Host historical swipe switched through native swipe.to','Older source changed through message edit controls'],
            state, errors,
        },null,2)+'\n');
        assert.deepEqual(errors,[]);
        console.log(`PASS H4/A21 ${companion ? 'companion' : 'Default'} ordinary request capture, three-to-one evidence, phone-width touch Notes, and one-use delivery`);
    } finally {
        L.mode({});
        await browser.close();
    }
})().catch(error=>{ console.error(error); process.exitCode=1; });
