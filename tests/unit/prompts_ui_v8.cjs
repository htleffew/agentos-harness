const { chromium } = require(process.env.RI_PLAYWRIGHT || 'playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const server = http.createServer((req,res)=>{const p=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+path.sep)){res.writeHead(403);return res.end()}fs.readFile(p,(e,data)=>{if(e){res.writeHead(404);return res.end()}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/html');res.end(data)})});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.RI_CHROME||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/README.md`);
 await page.evaluate(async()=>{document.body.innerHTML='<main id="root"></main>';const settings={};window.SillyTavern={getContext:()=>({extensionSettings:settings,saveSettingsDebounced:()=>{}})};const UI=await import('/src/ui/prompts.js');document.querySelector('#root').append(UI.promptGroup(['guided','checker']));});
 await page.locator('.ri-prompt-group > summary').click();const guided=page.locator('.ri-prompt-editor').filter({hasText:'Guided swipe framing'});await guided.locator('summary').first().click();
 await guided.locator('textarea').fill('no placeholder');await guided.getByRole('button',{name:'Update',exact:true}).click();assert.match(await guided.locator('[role="status"]').textContent(),/required placeholder/);
 await guided.locator('textarea').fill('USER DIRECTION {direction}');await guided.getByRole('button',{name:'Update',exact:true}).click();assert.match(await guided.locator('.ri-prompt-badge').textContent(),/Customized/);
 const checker=page.locator('.ri-prompt-editor').filter({hasText:'Instruction checker guidance'});await checker.locator('summary').first().click();await checker.locator('textarea').fill('CHECKER CUSTOM');await checker.getByRole('button',{name:'Update',exact:true}).click();
 await guided.getByRole('button',{name:'Restore default prompt',exact:true}).click();assert.match(await guided.locator('.ri-prompt-badge').textContent(),/Default/);assert.equal(await checker.locator('textarea').inputValue(),'CHECKER CUSTOM');
 await guided.getByRole('button',{name:'Undo restore'}).click();assert.equal(await guided.locator('textarea').inputValue(),'USER DIRECTION {direction}');assert.equal(await page.locator('button').filter({hasText:/test prompt/i}).count(),0);assert.deepEqual(errors,[]);
 console.log('prompt editor: validation, save, individual restore, undo and no test action: passed');
 }finally{await browser.close();server.close()}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
