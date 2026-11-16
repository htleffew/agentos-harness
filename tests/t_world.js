// 5.2: the story world. Entries, who is present (header, HUD, names), the notes block, the budget, secrets,
// swipes, where the notes go, the extension off, other chats, and the Story World tab.
const L = require('./lib.js');
const assert = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const click = (page, text, root = '#ri_root') => page.evaluate(([text, root]) => { const b = [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim() === text) || [...document.querySelectorAll(`${root} button`)].find(x => x.textContent.trim().startsWith(text)); if (!b) throw new Error('no button ' + text); b.click(); }, [text, root]);
const setField = (page, label, value) => page.evaluate(([label, value]) => { const f = [...document.querySelectorAll('#ri_root .ri-field')].find(x => x.querySelector('.ri-label')?.textContent.trim().toLowerCase() === label.toLowerCase()); if (!f) throw new Error('no field ' + label); const el = f.querySelector('input,textarea,select'); el.value = value; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [label, value]);
const notesOf = (t) => { const m = t.match(/\[Story notes\.[\s\S]*?\n[\s\S]*?\]/); if (!m) return ''; const start = t.indexOf('[Story notes.'); let depth = 0; for (let i = start; i < t.length; i++) { if (t[i] === '[') depth++; else if (t[i] === ']') { depth--; if (!depth) return t.slice(start, i + 1); } } return m[0]; };
const send = async (page, text) => { L.resetLog(); await L.send(page, text); await L.waitChecks(page); const all = L.requests(); const rq = all[all.length - 1]; return { n: all.length, text: L.text(rq), notes: notesOf(L.text(rq)), messages: rq.messages }; };
const HUD = (present, extra = '') => `Hale stood by the stall with his arms folded. "You are late," he said.

<sola_hud digest="Day 3 · 9:10 in the morning">
<scene_cast>
Location: The fruit market on the east square
Active Speakers: ${present}
Ambient NPCs: a boy stacking crates
Observable Facts: Hale is two paces away.
</scene_cast>
<profile name="Hale">
Who: A ship's captain.
Why: He is proud.
</profile>${extra}
</sola_hud>`;
/** Add entries to a world. items: [{ kind, name, aliases, fields, status, show, on }] */
const addEntries = (page, id, items) => page.evaluate(async ([B, id, items]) => {
    const W = await import(`${B}/src/world.js`);
    const data = await W.loadWorld(id);
    for (const x of items) { const w = W.newWorldEntry(data, x.kind); Object.assign(w, { name: x.name, aliases: x.aliases || [], status: x.status || w.status, show: x.show || 'shadow', on: x.on !== false }); Object.assign(w.fields, x.fields || {}); W.writeWorldEntry(data, w, id); }
    await W.saveWorld(id, data);
}, [L.BASE, id, items]);
const patchEntry = (page, id, name, patch) => page.evaluate(async ([B, id, name, patch]) => {
    const W = await import(`${B}/src/world.js`);
    const data = await W.loadWorld(id);
    const w = W.listWorld(data, id).find(x => x.name === name);
    Object.assign(w, patch.top || {}); Object.assign(w.fields, patch.fields || {});
    W.writeWorldEntry(data, w, id); await W.saveWorld(id, data);
}, [L.BASE, id, name, patch]);
const makeWorld = (page, name, home) => page.evaluate(async ([B, name, home]) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const id = await K.createSet(name, 'world', { entries: {} }, home); W.setChatWorld(id); return id; }, [L.BASE, name, home]);
const worldSettings = (page, patch) => L.setSettings(page, { world: patch });

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    try {
        await L.setupApi(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await worldSettings(page, { budget: 600, place: 'depth', depth: 4, lookback: 4 });
        const t = Date.now();
        const S = 'Notes book ' + t;
        await L.openChat(page);

        // ----- A. a world in the shared lorebook, with one entry of every kind
        const id = await makeWorld(page, 'Harbour story', S);
        await addEntries(page, id, [
            { kind: 'character', name: 'Hale', aliases: ['the captain'], fields: { role: 'captain of the Gull', who: 'Proud. Grew up poor and built his own crew.', strength: 'Decides quickly', flaw: 'Takes lateness as an insult', voice: 'Short, dry sentences', wants: 'A crew he can trust', plans: 'Sail tomorrow', knows: 'The harbour master is leaving', believes: 'You do not take him seriously', suspects: 'Mira talks too much', wrong: 'He thinks Mira dislikes him' } },
            { kind: 'character', name: 'Mira', fields: { role: 'fruit seller', who: 'Blunt and warm.', wants: 'To see Hale happy' } },
            { kind: 'character', name: 'Old Tom', aliases: ['Tom'], fields: { role: 'lighthouse keeper', wants: 'To be left alone' } },
            { kind: 'place', name: 'Fruit market', fields: { what: 'A market on the east square', layout: 'Two rows of stalls' } },
            { kind: 'place', name: 'Lighthouse', fields: { what: 'A white tower on the point' } },
            { kind: 'faction', name: 'The Gull crew', aliases: ['the crew'], fields: { what: 'Twelve sailors', wants: 'A good season' } },
            { kind: 'thread', name: 'The invitation', status: 'stirring', fields: { open: 'Hale asked you to sail and has no answer yet', people: 'Hale' } },
            { kind: 'thread', name: 'The old race', status: 'done', fields: { open: 'Who won the race ZZDONE' } },
            { kind: 'secret', name: 'The letter', fields: { secret: 'Hale burned the letter XSECRETX from his brother', holder: 'Hale', known: 'Mira' } },
            { kind: 'secret', name: 'Tom and the lamp', fields: { secret: 'Tom let the lamp go out YSECRETY', holder: 'Old Tom', shadow: 'Old Tom has a secret about the lamp.' } },
            { kind: 'seed', name: 'The locked drawer', fields: { detail: 'A drawer in the chart room is locked', payoff: 'The key turns up' } },
            { kind: 'activity', name: 'Act one', fields: { who: 'Mira', what: 'is looking for a letter', step: 'she has asked two neighbours' } },
            { kind: 'activity', name: 'Act two', fields: { who: 'The harbour master', what: 'is packing to leave' } },
            { kind: 'activity', name: 'Act three', fields: { who: 'A stranger', what: 'is asking about the Gull' } },
            { kind: 'activity', name: 'Act four', fields: { who: 'ZZFOURTH', what: 'is doing a fourth thing' } },
        ]);
        const file = await page.evaluate(async (S) => JSON.parse(JSON.stringify(await globalThis.SillyTavern.getContext().loadWorldInfo(S))), S);
        const hale = Object.values(file.entries).find(e => e.comment === 'Hale');
        console.log('stored Hale:', JSON.stringify({ key: hale.key, constant: hale.constant, set: hale.extensions.ri.set, type: hale.extensions.ri.type, content: hale.content.slice(0, 90) }));
        assert(Object.keys(file.entries).length === 15 && file.extensions.ri.groups['Harbour story'].kind === 'world' && Object.values(file.entries).every(e => e.extensions.ri.type === 'world' && e.extensions.ri.set === 'Harbour story'), 'world: fifteen entries are kept as a group of kind "world" in the shared lorebook');
        assert(hale.key.join() === 'Hale,the captain' && hale.constant === false && hale.content.startsWith('[Character] Hale (captain of the Gull)'), 'world: an entry is stored as an ordinary lorebook entry keyed by its name and other names');

        // ----- B. who is present is read from the HUD; the notes go out with no extra request
        L.mode({ reply: HUD('Hale') });
        const first = await send(page, 'I walk up to the stall.');          // no reply yet to read: names in the last messages
        const second = await send(page, 'I say good morning.');             // reads the HUD of reply 1
        console.log('--- notes with the second message ---\n' + second.notes);
        assert(first.n === 1 && second.n === 1, 'requests: sending story notes makes no extra AI request (one request per reply): ' + [first.n, second.n]);
        assert(/In this scene:\n- Hale \(captain of the Gull\)\. Who they are: Proud\. Grew up poor and built his own crew\./.test(second.notes) && /What they are wrong about: He thinks Mira dislikes him\./.test(second.notes), 'present: the character named by the HUD is sent in full');
        assert(!/- Mira \(fruit seller\)/.test(second.notes) && !/Old Tom \(lighthouse/.test(second.notes), 'present: characters who are not in the scene and not named are left out');
        assert(/Where:\n- Fruit market \(A market on the east square\)\. How it is laid out: Two rows of stalls\./.test(second.notes) && !/Lighthouse/.test(second.notes), 'place: the place named by the HUD is sent, the other place is not');
        assert(/Open threads:\n- The invitation \[stirring\]\. What is open: Hale asked you to sail and has no answer yet\./.test(second.notes) && !/ZZDONE/.test(second.notes), 'threads: an open thread is always sent with its status, a finished one is not');
        const acts = (second.notes.match(/Going on elsewhere:\n((?:- .*\n?)*)/) || ['', ''])[1].trim().split('\n');
        assert(acts.length === 3 && !/ZZFOURTH/.test(second.notes), 'elsewhere: at most three things going on elsewhere are sent');
        assert(/Secrets:\n- Hale has a secret\./.test(second.notes) && !/XSECRETX/.test(second.notes) && !/YSECRETY|about the lamp/.test(second.notes), 'secrets: a kept secret of someone in the scene is sent as one line, without the secret itself; other people\'s secrets stay out');
        assert(/Planted earlier:\n- The locked drawer \[planted\]\. The detail, as it appeared in the story: A drawer in the chart room is locked\./.test(second.notes), 'planted details are sent while there is room');
        const sys = second.messages.filter(m => /\[Story notes\./.test(typeof m.content === 'string' ? m.content : ''));
        const idx = second.messages.indexOf(sys[0]);
        assert(sys.length === 1 && sys[0].role === 'system' && second.messages.length - 1 - idx >= 3, 'placement: the notes are one system message a few messages up from the end');
        const rec = await page.evaluate(() => { const ch = globalThis.SillyTavern.getContext().chat; const it = ch[ch.length - 1].extra.roleplay_instructions.items.find(x => x.notes); return it ? { name: it.name, noCheck: it.noCheck, status: it.status, notes: it.notes, same: it.text.startsWith('[Story notes.') } : null; });
        console.log('record:', JSON.stringify(rec));
        assert(rec && rec.name === 'Story notes' && rec.noCheck && rec.same && rec.notes.present.join() === 'Hale' && rec.notes.place === 'Fruit market' && rec.notes.how === 'the HUD', 'record: What Was Sent keeps the notes, who was read as present, the place and where that was read from');
        assert(rec.notes.missing.join() === 'a boy stacking crates', 'record: someone the scene names who has no entry is listed: ' + rec.notes.missing.join(' | '));

        // ----- C. secrets: the whole secret with an order to keep it, and a secret that is out
        await patchEntry(page, id, 'The letter', { top: { show: 'full' } });
        const full = await send(page, 'I wait.');
        assert(/XSECRETX/.test(full.notes) && /It is still kept: it stays unsaid and unseen in the story until an order says it comes out\./.test(full.notes), 'secrets: "the whole secret" sends it with the order that it stays kept');
        await patchEntry(page, id, 'The letter', { top: { status: 'out' } });
        const out = await send(page, 'I wait again.');
        assert(/XSECRETX/.test(out.notes) && /This is out in the open\./.test(out.notes) && !/still kept/.test(out.notes), 'secrets: once it is out in the open, the whole of it is sent as known');
        await patchEntry(page, id, 'The letter', { top: { status: 'kept', show: 'shadow' } });

        // ----- D. two people in the HUD; names in the messages bring in other entries
        L.mode({ reply: HUD('Hale, Mira') });
        await send(page, 'I look around.');
        const two = await send(page, 'I ask about Old Tom and the lighthouse.');
        console.log('--- present Hale and Mira, Tom and the lighthouse named ---\n' + two.notes);
        assert(/- Hale \(captain/.test(two.notes) && /- Mira \(fruit seller\)\. Who they are: Blunt and warm\./.test(two.notes), 'present: both people named by the HUD are sent');
        assert(/Also relevant:\n(?:- .*\n)*- Old Tom \(lighthouse keeper\)\. What they want: To be left alone\./.test(two.notes + '\n') && /- Lighthouse \(A white tower on the point\)\./.test(two.notes), 'named: a person and a place that the last message names are added in short form');
        assert(/Old Tom has a secret about the lamp\./.test(two.notes) && !/YSECRETY/.test(two.notes), 'secrets: a secret whose keeper is named is sent as its own one line');

        // ----- E. a scene header, and a plain "Present:" line
        L.mode({ reply: '<mobile_header location="LIGHTHOUSE, THE POINT" time="9:12 PM" atmosphere="Wind" present="Old Tom, a gull" />\nThe lamp turned slowly.' });
        await send(page, 'I climb the stairs.');
        const head = await send(page, 'I knock.');
        const hereOf = (n) => (n.match(/In this scene:\n((?:- .*\n?)*)/) || ['', ''])[1];
        assert(/^- Old Tom \(lighthouse keeper\)/.test(hereOf(head.notes)) && /Where:\n- Lighthouse/.test(head.notes) && !/Hale/.test(hereOf(head.notes)), 'present: a scene header with present="..." and location="..." is read');
        L.mode({ reply: 'The square was quiet.\n\nPresent: Mira, the captain\nLocation: Fruit market' });
        await send(page, 'I go back.');
        const plain = await send(page, 'I sit down.');
        assert(/- Hale \(captain/.test(plain.notes) && /- Mira \(fruit seller\)/.test(plain.notes) && /Where:\n- Fruit market/.test(plain.notes), 'present: a plain "Present:" line is read, and another name of a character counts ("the captain")');

        // ----- F. no header and no HUD: names in the last messages
        await L.openChat(page);
        await page.evaluate(async ([B, id]) => { (await import(`${B}/src/world.js`)).setChatWorld(id); }, [L.BASE, id]);
        L.mode({ reply: 'Mira waved from behind her stall and went back to her pears.' });
        await send(page, 'I walk through the market.');
        const names = await send(page, 'I wave back.');
        const recN = await page.evaluate(() => { const ch = globalThis.SillyTavern.getContext().chat; return ch[ch.length - 1].extra.roleplay_instructions.items.find(x => x.notes).notes; });
        assert(/In this scene:\n- Mira \(fruit seller\)/.test(names.notes) && !/- Hale \(captain/.test(names.notes) && recN.how === 'names in the last messages', 'present: with no header and no HUD, a character named in the last messages counts as present');

        // ----- G. the budget shortens people in the scene; a swipe repeats the same notes
        L.mode({ reply: HUD('Hale, Mira') });
        await send(page, 'I greet them both.');
        await worldSettings(page, { budget: 100 });
        const tight = await send(page, 'I listen.');
        console.log('--- budget 100 ---\n' + tight.notes);
        assert(/- Hale \(captain of the Gull\)\. What they want: A crew he can trust\./.test(tight.notes) && !/Who they are: Proud/.test(tight.notes) && !/Planted earlier/.test(tight.notes), 'budget: when room is short, people in the scene are sent in short form and the extras are left out');
        assert(/Open threads:/.test(tight.notes), 'budget: open threads are still sent');
        await worldSettings(page, { budget: 600 });
        const before = (await send(page, 'I answer him.')).notes;
        L.resetLog(); await L.swipe(page); await L.waitChecks(page);
        const sw = notesOf(L.text(L.requests().slice(-1)[0]));
        assert(before.length > 200 && sw === before, 'swipe: a swipe sends exactly the same story notes again');

        // ----- H. where the notes go
        await worldSettings(page, { place: 'after' });
        const after = await send(page, 'I nod.');
        const inSys = after.messages.find(m => /\[Story notes\./.test(typeof m.content === 'string' ? m.content : ''));
        assert(!!after.notes && after.messages.indexOf(inSys) < 3, 'placement: "with the lorebook entries" puts the notes near the top of the prompt');
        await worldSettings(page, { place: 'depth' });

        // ----- I. with instruction sets: notes do not use up the one new thing per reply
        const ins = await page.evaluate(async ([B, S]) => { const K = await import(`${B}/src/books.js`); const St = await import(`${B}/src/store.js`); const d = { entries: {} }; ['A1', 'B1'].forEach((v, i) => { const x = K.newInstruction(d); Object.assign(x, { name: 'I' + i, chance: 100, wait: 0, sentAs: 'system', versions: [{ text: `{{char}} must do thing ${v} to {{user}}.`, keep: false }] }); K.writeInstruction(d, x); }); const a = await K.createSet('Orders', 'instructions', d, S); const cs = St.chatState(); cs.activeSets = [a]; St.saveChatState(); return a; }, [L.BASE, S]);
        await L.setSettings(page, { perReply: 1 });
        const both = await send(page, 'I smile.');
        const marks = [...both.text.matchAll(/thing ([A-Z]\d)/g)].map(m => m[1]);
        await L.setSettings(page, { perReply: 0 });
        assert(marks.length === 1 && !!both.notes && (both.text.match(/theirs to write/g) || []).length === 1, 'together: one instruction and the story notes go out in the same reply, in the same lorebook, with the line about your words once');
        await page.evaluate(async (B) => { const St = await import(`${B}/src/store.js`); const cs = St.chatState(); cs.activeSets = []; St.saveChatState(); }, L.BASE);

        // ----- J. the lorebook attached in World Info: with the extension on, entries do not also go out one by one
        const chatLore = (name) => page.evaluate((name) => { const c = globalThis.SillyTavern.getContext(); if (name) c.chatMetadata.world_info = name; else delete c.chatMetadata.world_info; c.saveMetadata(); }, name);
        await chatLore(S);
        const att = await send(page, 'I talk to Hale and Mira about Old Tom.');
        assert(!!att.notes && !/\[Character\] /.test(att.text), 'attached: with the extension on, world entries are sent only inside the notes block');
        await L.setSettings(page, { enabled: false });
        const off = await send(page, 'I talk to Hale about Old Tom.');
        await L.setSettings(page, { enabled: true });
        await chatLore('');
        assert(!off.notes && /\[Character\] Hale \(captain of the Gull\)/.test(off.text) && /\[Character\] Old Tom/.test(off.text) && !/\[Place\] Lighthouse/.test(off.text), 'extension off: with the lorebook attached, an entry is sent as an ordinary lorebook entry when its name appears');

        // ----- K. another chat, another world in the same lorebook
        await L.openChat(page);
        L.mode({});
        const none = await send(page, 'Hale and Mira and Old Tom.');
        assert(!none.notes && !/\[Character\]/.test(none.text), 'other chat: a chat with no world gets no story notes');
        const id2 = await makeWorld(page, 'Mountain story', S);
        await addEntries(page, id2, [{ kind: 'character', name: 'Greta', fields: { role: 'a guide', wants: 'To reach the pass' } }, { kind: 'thread', name: 'The pass', fields: { open: 'Whether the pass is open' } }]);
        const other = await send(page, 'I meet Greta and think of Hale.');
        assert(/- Greta \(a guide\)/.test(other.notes) && /The pass/.test(other.notes) && !/Hale \(captain|The invitation|Fruit market/.test(other.notes), 'other chat: a second world in the same lorebook sends only its own entries');

        // ----- L. moving a world keeps it as this chat's world
        const moved = await page.evaluate(async ([B, id2]) => { const K = await import(`${B}/src/books.js`); const E = await import(`${B}/src/engine.js`); const W = await import(`${B}/src/world.js`); const r = await K.moveSet(id2, ''); await E.setsMoved(); return { id: r.id, now: W.chatWorld(), info: K.setInfo(r.id) }; }, [L.BASE, id2]);
        const afterMove = await send(page, 'I ask Greta the way.');
        assert(moved.now === moved.id && !moved.info.shared && moved.info.kind === 'world' && /- Greta \(a guide\)/.test(afterMove.notes), 'move: a world moved to a lorebook of its own is still this chat\'s world and is still sent');

        // ----- M. the Story World tab
        await L.openChat(page);
        await L.setSettings(page, { home: S });
        await click(page, 'Expand');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'world'; P.app.wroute = { view: 'list' }; P.app.render(); }, L.BASE);
        await page.waitForTimeout(300);
        await click(page, 'Make a new story world');
        await page.waitForSelector('dialog[open] .popup-input', { timeout: 5000 });
        const suggested = await page.inputValue('dialog[open] .popup-input');
        await page.fill('dialog[open] .popup-input', 'Panel world');
        await page.click('dialog[open] .popup-button-ok');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^Characters \(0\)/.test(x.textContent)), null, { timeout: 8000 });
        assert(/story$/.test(suggested), 'panel: a new world is offered a name from the character: ' + suggested);
        await click(page, 'Add a character');
        await page.waitForTimeout(300);
        // with AI
        L.mode({ goal: JSON.stringify({ name: 'Ilse', aliases: ['the baker'], role: 'baker on the square', who: 'Cheerful. Up before dawn.', strength: 'Patient', flaw: '', voice: 'Sings while she talks', wants: 'A bigger oven', plans: '', knows: ['The market opens late on Sundays', 'Hale owes nobody'], believes: '', suspects: '', wrong: '' }) });
        await click(page, 'Write this entry with AI');
        await page.waitForTimeout(200);
        await setField(page, 'What it is about (you can leave this empty)', 'the baker');
        L.resetLog();
        await click(page, 'Write the entry');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-field')].some(f => f.querySelector('.ri-label')?.textContent.trim() === 'Name' && f.querySelector('input').value === 'Ilse'), null, { timeout: 15000 });
        const wreq = L.requests().find(r => /story notes of a roleplay/.test(L.text(r)));
        const form = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ri_root .ri-field')].map(f => [f.querySelector('.ri-label')?.textContent.trim(), f.querySelector('input,textarea,select')?.value])));
        console.log('form after AI:', JSON.stringify(form).slice(0, 500));
        assert(wreq && /What it is about: the baker/.test(L.text(wreq)) && /"wrong": What they are wrong about\./.test(L.text(wreq)), 'AI: one request asks for the lines of this kind of entry');
        assert(form['Name'] === 'Ilse' && form['Other names'] === 'the baker' && form['Role in the story'] === 'baker on the square' && form['What they know'] === 'The market opens late on Sundays; Hale owes nobody' && form['Main flaw'] === '', 'AI: the answer fills the empty lines, a list becomes one line, and nothing is saved yet');
        const savedYet = await page.evaluate(async ([B]) => { const W = await import(`${B}/src/world.js`); const d = await W.loadWorld(W.chatWorld()); return W.listWorld(d, W.chatWorld()).length; }, [L.BASE]);
        assert(savedYet === 0, 'AI: the entry is in the editor only until Save is pressed');
        const prev = await page.evaluate(() => document.querySelector('#ri_root .ri-preview').textContent);
        assert(/^- Ilse \(baker on the square\)\. Who they are: Cheerful\. Up before dawn\./.test(prev), 'editor: the preview shows what the AI would receive for this entry: ' + prev.slice(0, 80));
        await page.screenshot({ path: '/tmp/s52_edit.png', fullPage: false });
        await click(page, 'Save character');
        await page.waitForFunction(() => [...document.querySelectorAll('#ri_root .ri-section-title')].some(x => /^Characters \(1\)/.test(x.textContent)), null, { timeout: 8000 });
        // a second entry with the same name is flagged, and still saves
        await click(page, 'Add a character');
        await page.waitForTimeout(400);
        await setField(page, 'Name', 'The Baker');
        await page.evaluate(async (B) => { (await import(`${B}/src/ui/panel.js`)).app.render(); }, L.BASE);
        await page.waitForTimeout(300);
        const flags = await page.evaluate(() => [...document.querySelectorAll('#ri_root .ri-flag')].map(f => f.textContent));
        assert(flags.some(f => /^Check: "Ilse" in this world has the same name/.test(f)) && !flags.some(f => /^Must fix/.test(f)), 'flags: a second entry with a name in common is flagged as a check, not blocked: ' + flags.join(' | ').slice(0, 160));
        await setField(page, 'Name', '');
        await click(page, 'Save character');
        await page.waitForTimeout(400);
        const still = await page.evaluate(() => !!document.querySelector('#ri_root .ri-savebar'));
        assert(still, 'flags: an entry with no name is the one thing that cannot be saved');
        await click(page, 'Cancel');
        await page.waitForTimeout(400);
        // the list and the preview of what would be sent
        await click(page, 'Add an open thread');
        await page.waitForTimeout(300);
        await setField(page, 'Short title', 'The oven');
        await setField(page, 'What is open', 'Whether Ilse gets her bigger oven');
        await click(page, 'Save open thread');
        await page.waitForFunction(() => /Open threads:\n- The oven \[quiet\]/.test(document.querySelector('#ri_root .ri-preview')?.textContent || ''), null, { timeout: 8000 });
        const listUi = await page.evaluate(() => ({ titles: [...document.querySelectorAll('#ri_root .ri-section-title')].map(x => x.textContent), kept: document.querySelector('#ri_root .ri-kept')?.textContent, preview: document.querySelector('#ri_root .ri-preview').textContent, world: [...document.querySelectorAll('#ri_root .ri-field')].find(f => /World used by this chat/.test(f.textContent)).querySelector('select').selectedOptions[0].textContent }));
        console.log('list:', JSON.stringify(listUi.titles), listUi.kept, '|', listUi.world);
        assert(listUi.titles.includes('Characters (1)') && listUi.titles.includes('Open threads (1)') && listUi.titles.includes('Secrets (0)') && /Kept in the shared lorebook/.test(listUi.kept) && /^Panel world/.test(listUi.world), 'panel: the tab lists the entries by kind and says where the world is kept');
        assert(/^\[Story notes\./.test(listUi.preview) && /The oven/.test(listUi.preview), 'panel: the tab shows exactly what would be sent with the next reply');
        const exp = await page.evaluate(async (B) => { const K = await import(`${B}/src/books.js`); const W = await import(`${B}/src/world.js`); const d = await K.exportSet(W.chatWorld()); return { n: Object.keys(d.entries).length, kind: d.extensions.ri.kind, tagged: Object.values(d.entries).some(e => e.extensions.ri.set), world: Object.values(d.entries).every(e => e.extensions.ri.type === 'world'), buttons: [...document.querySelectorAll('#ri_root .ri-section')][0].textContent }; }, L.BASE);
        assert(exp.n === 2 && exp.kind === 'world' && !exp.tagged && exp.world && /Export this world/.test(exp.buttons) && /Delete this world/.test(exp.buttons), 'panel: a world can be exported as a lorebook file of its own, and a world in the shared lorebook can be deleted');
        await page.evaluate(() => document.querySelector('#ri_root .ri-body').scrollTo(0, 0));
        await page.screenshot({ path: '/tmp/s52_list.png' });
        // What Was Sent shows the notes
        L.mode({});
        await send(page, 'I say hello to Ilse.');
        await page.evaluate(async (B) => { const P = await import(`${B}/src/ui/panel.js`); P.app.tab = 'sent'; P.app.render(); }, L.BASE);
        await page.waitForTimeout(500);
        const sentUi = await page.evaluate(() => { const c = document.querySelector('#ri_root .ri-sentitem'); return c ? c.textContent : document.querySelector('#ri_root .ri-body').textContent.slice(0, 300); });
        assert(/Story notes/.test(sentUi) && /Read as present/.test(sentUi) && /Ilse/.test(sentUi) && /Sent \(story notes are facts, with nothing to check\)/.test(sentUi), 'panel: What Was Sent shows the story notes and who was read as present: ' + sentUi.slice(0, 140));
        await L.setSettings(page, { home: '', check: { mode: 'full' } });
        console.log('page errors:', JSON.stringify(errors));
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 400));
    } finally { await browser.close(); }
})().catch(e => { console.error('ERROR', e); process.exitCode = 1; });
