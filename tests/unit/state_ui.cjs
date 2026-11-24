const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!p.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (error, data) => { if (error) { res.writeHead(404); return res.end(); } res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(data); });
});
(async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({ executablePath: process.env.RI_CHROME || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
 try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/README.md`);
  await page.evaluate(async () => {
    document.body.innerHTML = '<main id="root"></main>';
    const record = { scene: { where: 'Inn', present: 'Hale' }, stateChanges: [{ name: 'Hale', fields: { mind: 'Wait' } }] };
    const chat = [{ mes: 'story', extra: { roleplay_instructions: record } }];
    const c = { chat, chatMetadata: {}, saveChat: () => {}, saveMetadataDebounced: () => {}, extensionSettings: {}, getCurrentChatId: () => 'chat' };
    window.SillyTavern = { getContext: () => c };
    const UI = await import('/src/ui/state.js');
    window.renderState = () => { const root = document.querySelector('#root'); root.replaceChildren(); UI.renderCurrentState(root, window.renderState); };
    window.renderState();
  });
  await page.locator('summary', { hasText: 'Hale' }).click();
  await page.getByRole('button', { name: 'Edit state', exact: true }).click();
  await page.locator('.ri-state-editor textarea').first().fill('Guard the door');
  await page.getByRole('button', { name: 'Save state', exact: true }).click();
  const actual = await page.evaluate(async () => (await import('/src/state.js')).stateAt().hale);
  assert.equal(actual.fields.mind, 'Guard the door'); assert.equal(actual.protected.mind, true);
  await page.getByText('Scene', {exact:true}).locator('xpath=self::summary').click();
  await page.getByRole('button', { name: 'Edit scene', exact: true }).click();
  await page.locator('.ri-state-editor textarea').nth(1).fill('Tower');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  assert.equal(await page.evaluate(async () => (await import('/src/state.js')).sceneAt().where), 'Tower');
  await page.evaluate(async () => { const UI=await import('/src/ui/state.js'), S=await import('/src/state.js'); const card=UI.characterStateCard(S.snapshotState(0).hale, 0, () => {}, { historical:true }); document.querySelector('#root').replaceChildren(card); });
  await page.locator('summary', { hasText: 'Hale' }).click();
  await page.getByRole('button', { name: 'Edit this snapshot', exact: true }).click();
  await page.locator('.ri-state-editor textarea').first().fill('Historical correction');
  await page.getByRole('button', { name: 'Save snapshot only', exact: true }).click();
  assert.equal(await page.evaluate(async () => (await import('/src/state.js')).snapshotState(0).hale.fields.mind), 'Historical correction');
  assert.equal(await page.evaluate(async () => (await import('/src/state.js')).stateAt().hale.fields.mind), 'Guard the door');
  assert.deepEqual(errors, []);
  console.log('browser editor: protected character and scene changes and historical isolation passed');
 } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
