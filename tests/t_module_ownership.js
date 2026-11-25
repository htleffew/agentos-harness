// B39, reworked in B36b: who places the relationships module's rule, read from the real requests in the mock log.
//
// The Ours or Theirs switch retired (DECISIONS 2026-11-24, Presets compose freely), so a stored Ours or Theirs has no effect.
// With either stored, or none, the preset's block stays in the reply and the extension's Relationships fields reach capture.
// The reply carries no update block (MB3); the module reaches the capture request after each reply through the Relationships
// card's fields (memory DESIGN 5.4 and 7.2). The module switched off removes the fields from capture and leaves the preset's block.
const L = require('./lib.js');
const fs = require('node:fs');
const companion = JSON.parse(fs.readFileSync(new URL('../presets/Roleplay%20Instructions%20V10.json', `file://${__filename}`)));
let failed = 0;
const assert = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) { failed++; process.exitCode = 1; } };

const HOST_RULE = 'HOST-INTERNAL-STATES-PROMPT';
const FILING_RULE = 'For a relationship use subject and other';
const FIELD = 'relationships.pair (Pair, text)';
const KINDS_LINE = /kind is one of [^\n]*\brelationship\b/;
const count = (text, phrase) => text.split(phrase).length - 1;

(async () => {
    L.sync();
    const { browser, page, errors } = await L.open();
    const ext = (fn, value) => page.evaluate(fn, { B: L.BASE, value });
    const imported = structuredClone(companion);
    imported.name = 'Imported ownership fixture';
    const block = { identifier: 'vexa-internal-fixture', name: 'Internal States Template', system_prompt: false, injection_position: 0, role: 'system', content: HOST_RULE };
    imported.prompts.push(block);
    for (const group of imported.prompt_order) group.order.splice(1, 0, { identifier: block.identifier, enabled: true });
    const savePreset = preset => page.evaluate(preset => SillyTavern.getContext().getPresetManager('openai').savePreset(preset.name, preset), preset);
    // What an earlier release stored for every shared feature of the selected preset: it has no effect now.
    const sides = side => ext(async ({ B, value }) => {
        const wb = await import(`${B}/src/preset-workbench.js`), S = await import(`${B}/src/store.js`), context = wb.switchContext();
        (S.settings().presetSwitches ||= {})[context.key] = Object.fromEntries(context.features.switched.map(item => [item.key, value]));
        wb.syncOwners();
    }, side);
    const owner = () => ext(async ({ B }) => { const v = await import(`${B}/src/v10.js`); const o = v.moduleOwnership().relationships; return { choice: o?.choice, module: v.effectiveModules().relationships }; });
    let turn = 0;
    // One reply and the capture that follows it. Each reply has its own wording, so no two share a capture mark.
    const exchange = async label => {
        const prose = `Mira waits at the door and Hale nods to her (${label}, turn ${++turn}).`;
        L.mode({ reply: prose });
        L.resetLog();
        await L.send(page, `I knock on the door (${label}).`);
        let capture;
        for (let i = 0; i < 90 && !capture; i++) {
            capture = L.requests('capture').find(row => L.text(row).includes(prose));
            if (!capture) await page.waitForTimeout(500);
        }
        return { reply: L.text(L.requests('reply').at(-1) || { messages: [] }), capture: capture ? L.text(capture) : '' };
    };
    const evidence = {};
    try {
        await L.setupApi(page);
        await L.assertQuietHost(page);
        await savePreset(companion);
        await savePreset(imported);
        await L.usePreset(page, imported.name);
        await L.setupApi(page, { preset: null });
        await L.setSettings(page, { check: { mode: 'off' } });
        await L.openChat(page);
        await ext(async ({ B }) => (await import(`${B}/src/v10.js`)).prefs().enabled = true);
        await page.waitForFunction(async ({ B, name }) => (await import(`${B}/src/v10.js`)).activePreset() === name, { B: L.BASE, name: imported.name });

        const expected = {
            theirs: { choice: 'both', module: true, host: 1, field: true },
            ours: { choice: 'both', module: true, host: 1, field: true },
            both: { choice: 'both', module: true, host: 1, field: true },
        };
        for (const [side, want] of Object.entries(expected)) {
            await sides(side);
            const own = await owner();
            const { reply, capture } = await exchange(side);
            evidence[side] = { owner: own, hostRuleInReply: count(reply, HOST_RULE), filingRuleInReply: count(reply, FILING_RULE), captureSent: !!capture, relationshipFieldInCapture: capture.includes(FIELD) };
            assert(own.choice === want.choice && own.module === want.module, `${side}: the stored owner is ${want.choice} and the module is ${want.module ? 'on' : 'off'} (${JSON.stringify(own)})`);
            assert(count(reply, HOST_RULE) === want.host, `${side}: the preset's block is in the reply request ${want.host} time(s) (${count(reply, HOST_RULE)})`);
            assert(count(reply, FILING_RULE) === 0 && !/<story_update/.test(reply), `${side}: the reply request carries no filing rule and no update block (MB3)`);
            assert(!!capture, `${side}: a capture request follows the reply`);
            assert(KINDS_LINE.test(capture), `${side}: capture can file a relationship record`);
            assert(capture.includes(FIELD) === want.field, `${side}: the capture request ${want.field ? 'asks' : 'does not ask'} the Relationships fields`);
        }

        // The module switched off in this chat with an Ours stored: the preset's block stays, and capture carries none of the fields.
        await sides('ours');
        await ext(async ({ B }) => { const v = await import(`${B}/src/v10.js`); const S = await import(`${B}/src/store.js`); (v.prefs().modules ||= {}).relationships = false; S.saveChatState(); });
        const off = await exchange('module off');
        evidence.oursModuleOff = { hostRuleInReply: count(off.reply, HOST_RULE), relationshipFieldInCapture: off.capture.includes(FIELD) };
        assert(count(off.reply, HOST_RULE) === 1 && !!off.capture && !off.capture.includes(FIELD), 'module off: the preset block stays in the reply and capture has no Relationships fields');
        await ext(async ({ B }) => { const v = await import(`${B}/src/v10.js`); const S = await import(`${B}/src/store.js`); delete v.prefs().modules.relationships; S.saveChatState(); });

        if (process.env.RI_EVIDENCE) {
            fs.mkdirSync(process.env.RI_EVIDENCE, { recursive: true });
            fs.writeFileSync(`${process.env.RI_EVIDENCE}/module-ownership.json`, JSON.stringify(evidence, null, 2));
        }
        console.log(JSON.stringify(evidence));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
    } finally { await browser.close(); }
    console.log(failed ? `t_module_ownership: ${failed} failed` : 'PASS t_module_ownership: a stored Ours or Theirs changes nothing in the reply and capture requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
