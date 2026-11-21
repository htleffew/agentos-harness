// Exercise the bundled writing prompts through the host's Prompt Manager and verify the outgoing messages.
const assert = require('node:assert/strict');
const preset = require('../presets/Roleplay Instructions V10.json');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page } = await L.open();
    try {
        await L.setupApi(page);
        const drawer = page.locator('#ai-config-button > .drawer-toggle');
        await drawer.click();
        const presets = page.locator('#settings_preset_openai');
        const installed = await presets.getByRole('option', { name: preset.name, exact: true }).count();
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#import_oai_preset').click();
        const saved = page.waitForResponse(response => response.url().endsWith('/api/presets/save') && response.request().method() === 'POST');
        await (await chooser).setFiles(require.resolve('../presets/Roleplay Instructions V10.json'));
        if (installed) await page.locator('dialog[open]').filter({hasText:'Overwrite?'}).locator('.popup-button-ok').click();
        assert.equal((await saved).ok(), true, 'host saved the imported JSON');
        await page.waitForFunction(name => document.querySelector('#settings_preset_openai option:checked')?.textContent.trim() === name, preset.name);
        await drawer.click();
        await L.setupApi(page, { preset: null });
        await L.openChat(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await page.locator('#ai-config-button > .drawer-toggle').click();
        const expected = preset.prompt_order.find(group => group.character_id === 100001).order;
        const blocks = preset.prompts.filter(prompt => prompt.identifier.startsWith('ri-'));
        const list = page.locator('#completion_prompt_manager_list');
        const form = page.locator('#completion_prompt_manager_popup_entry_form_prompt');
        const sent = async (inverted) => {
            await page.locator('#ai-config-button > .drawer-toggle').click();
            L.mode({reply: 'Mira checks the tide table.'});
            await L.send(page, inverted ? 'Check the next high tide.' : 'Read the tide table.');
            const text = L.text(L.requests().at(-1));
            for (const block of blocks) {
                const enabled = expected.find(entry => entry.identifier === block.identifier).enabled;
                assert.equal(text.includes(block.content), inverted ? !enabled : enabled, block.name);
            }
            await page.locator('#ai-config-button > .drawer-toggle').click();
        };
        await sent(false);
        for (const block of blocks) {
            const row = list.locator('[data-pm-identifier="' + block.identifier + '"]');
            await row.locator('.prompt-manager-edit-action').click();
            assert.equal(await form.inputValue(), block.content, block.name);
            await page.locator('#completion_prompt_manager_popup_entry_form_close').click();
            await row.locator('.prompt-manager-toggle-action').click();
        }
        await sent(true);
        console.log('Passed. Read and toggled all ' + blocks.length + ' companion craft/check blocks. Both complete prompt configurations matched the captured provider requests.');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
