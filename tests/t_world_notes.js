// B39: the story notes block in the real reply request, read from the mock log. It covers the checks the deleted
// t_world sections G and H made: the block under the smallest room (100 tokens), and under each placement (at a
// depth, with the lorebook entries after the card, and before the card).
//
// The block is found by its content and its position, both named once below (BLOCK, blockOf, the placement checks).
// Since MB5 a chat whose memory lives in chat data sends no story notes block; the recall block at depth 1 carries the
// memory (memory DESIGN 5.1). Every chat with messages moves its memory there when it opens, so the block goes out only
// when that move was skipped (a failed backup). The suite clears the moved mark to reach that path, checks the room and
// each placement there at depth 0 or 1, then sets the mark again and checks that no block goes out.
const L = require('./lib.js');
const fs = require('node:fs');
let failed = 0;
const assert = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) { failed++; process.exitCode = 1; } };

// The block as the extension writes it today: one system message that opens with "[Story notes." and its guidance line.
const BLOCK = /^\[Story notes\. /;
const content = m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
const blockOf = request => {
    const at = request.messages.map((m, i) => BLOCK.test(content(m)) ? i : -1).filter(i => i >= 0);
    const text = at.length ? content(request.messages[at[0]]) : '';
    // The entries are the lines after the guidance line; the room for story notes covers these.
    const entries = text.slice(text.indexOf('\n') + 1);
    return { count: at.length, at: at[0] ?? -1, role: at.length ? request.messages[at[0]].role : '', text, entries };
};
const chatRoles = ['user', 'assistant'];

let turn = 0;
// Each reply has its own wording, so no two replies share a capture mark (identical prose in the same minute does).
const HUD = present => `Hale stood by the stall on turn ${++turn}. "You are late," he said.

<sola_hud digest="Day 3 · 9:10 in the morning">
<scene_cast>
Location: The fruit market on the east square
Active Speakers: ${present}
</scene_cast>
</sola_hud>`;

(async () => {
    L.sync(); L.mode({});
    const { browser, page, errors } = await L.open({ width: 1100, height: 1500 });
    const send = async text => {
        L.mode({ reply: HUD('Hale, Mira') });
        L.resetLog();
        await L.send(page, text);
        await L.waitChecks(page);
        const request = L.requests('reply').at(-1);
        return { request, block: blockOf(request) };
    };
    const world = patch => L.setSettings(page, { world: patch });
    try {
        await L.setupApi(page);
        await L.assertQuietHost(page);
        await L.setSettings(page, { check: { mode: 'off' } });
        await world({ budget: 600, place: 'depth', depth: 1, lookback: 4, update: 'all', build: 0, head: 0 });
        await L.openChat(page);
        const home = 'Notes book ' + Date.now();
        await page.evaluate(async ([B, home]) => {
            const K = await import(`${B}/src/books.js`);
            const W = await import(`${B}/src/world.js`);
            const id = await K.createSet('Harbour story', 'world', { entries: {} }, home);
            W.setChatWorld(id);
            const data = await W.loadWorld(id);
            const items = [
                { kind: 'character', name: 'Hale', aliases: ['the captain'], fields: { role: 'captain of the Gull', who: 'Proud. Grew up poor and built his own crew.', flaw: 'Takes lateness as an insult', voice: 'Short, dry sentences', wants: 'A crew he can trust', plans: 'Sail tomorrow' } },
                { kind: 'character', name: 'Mira', fields: { role: 'fruit seller', who: 'Blunt and warm.', wants: 'To see Hale happy' } },
                { kind: 'place', name: 'Fruit market', fields: { what: 'A market on the east square', layout: 'Two rows of stalls' } },
                { kind: 'thread', name: 'The invitation', status: 'stirring', fields: { open: 'Hale asked you to sail and has no answer yet', people: 'Hale' } },
                { kind: 'seed', name: 'The locked drawer', fields: { detail: 'A drawer in the chart room is locked', payoff: 'The key turns up' } },
            ];
            for (const x of items) {
                const w = W.newWorldEntry(data, x.kind);
                Object.assign(w, { name: x.name, aliases: x.aliases || [], status: x.status || w.status, show: 'shadow', on: true });
                Object.assign(w.fields, x.fields);
                W.writeWorldEntry(data, w, id);
            }
            await W.saveWorld(id, data);
        }, [L.BASE, home]);
        // Where the card sits in the request, to tell "before the card" from "with the lorebook entries".
        const card = await page.evaluate(() => { const c = SillyTavern.getContext(); const ch = c.characters[c.characterId]; return String(ch.personality || ch.description || '').trim().slice(0, 40); });
        const cardAt = request => request.messages.findIndex(m => card && content(m).includes(card));
        const moved = async on => page.evaluate(async on => {
            const c = SillyTavern.getContext();
            const mem = c.chatMetadata.ri_memory = c.chatMetadata.ri_memory || {};
            if (on) mem.imported = mem.importedBefore || { v: 1, at: Date.now() };
            else { mem.importedBefore = mem.imported; delete mem.imported; }
            await c.saveMetadata();
            return !!mem.imported;
        }, on);
        assert(await page.evaluate(() => !!SillyTavern.getContext().chatMetadata.ri_memory?.imported), 'the open chat moved its memory into chat data');
        await moved(false);

        await send('I walk up to the stall.');
        // ----- The block at a depth: one system message with one chat message after it.
        const deep = await send('I say good morning.');
        const after1 = deep.request.messages.slice(deep.block.at + 1).filter(m => chatRoles.includes(m.role)).length;
        assert(deep.block.count === 1 && deep.block.role === 'system', `depth: one story notes block, sent as a system message (${deep.block.count}, ${deep.block.role})`);
        assert(after1 === 1, `depth: one chat message follows the block at depth 1 (${after1})`);
        await world({ depth: 4 });
        const clamped = await send('I wave.');
        const afterClamped = clamped.request.messages.slice(clamped.block.at + 1).filter(m => chatRoles.includes(m.role)).length;
        assert(afterClamped === 1, `depth: a stored depth of 4 is sent at depth 1 (${afterClamped})`);
        await world({ depth: 1 });
        assert(/- Hale \(captain of the Gull\)\. Who they are: Proud\./.test(deep.block.entries), 'depth: with room to spare, the person in the scene is sent in full');

        // ----- The smallest room, 100 tokens: the block still goes out, with the person in short form.
        await world({ budget: 100 });
        const tight = await send('I listen.');
        console.log('--- room 100 ---\n' + tight.block.text);
        assert(tight.block.count === 1, 'room 100: the story notes block is in the request');
        assert(/- Hale \(captain of the Gull\)\. What they want: A crew he can trust\./.test(tight.block.entries) && !/Who they are: Proud/.test(tight.block.entries), 'room 100: the person in the scene is sent in short form');
        assert(!/The locked drawer/.test(tight.block.entries), 'room 100: a planted detail nobody named stays out');
        assert(tight.block.entries.length <= 400, `room 100: the entries fit the room of about 400 characters (${tight.block.entries.length})`);
        await world({ budget: 600 });

        // ----- Each placement. "after" is SillyTavern's lorebook entries after the card, "before" is before the card.
        const placed = {};
        for (const place of ['after', 'before', 'depth']) {
            await world({ place });
            const r = await send(`I nod, placement ${place}.`);
            const firstChat = r.request.messages.findIndex(m => chatRoles.includes(m.role));
            placed[place] = { at: r.block.at, card: cardAt(r.request), firstChat, count: r.block.count, of: r.request.messages.length };
            assert(r.block.count === 1 && /- Hale \(captain of the Gull\)/.test(r.block.entries), `placement ${place}: one story notes block with the scene's person (${r.block.count})`);
        }
        console.log('placements', JSON.stringify(placed));
        assert(placed.after.card >= 0 && placed.after.at > placed.after.card && placed.after.at < placed.after.firstChat, 'placement after: the block sits after the card and above the chat history');
        assert(placed.before.card >= 0 && placed.before.at < placed.before.card, 'placement before: the block sits above the card');
        assert(placed.depth.at > placed.depth.firstChat, 'placement depth: the block sits inside the chat history');

        // ----- A chat whose memory lives in chat data sends no story notes block.
        await world({ place: 'depth' });
        await moved(true);
        const memory = await send('I look at the boats.');
        assert(memory.block.count === 0, `memory in chat data: no story notes block (${memory.block.count})`);

        if (process.env.RI_EVIDENCE) {
            fs.mkdirSync(process.env.RI_EVIDENCE, { recursive: true });
            fs.writeFileSync(`${process.env.RI_EVIDENCE}/world-notes.json`, JSON.stringify({ room100: tight.block.text, room100Entries: tight.block.entries.length, depth1After: after1, clampedAfter: afterClamped, memoryBlocks: memory.block.count, placed }, null, 2));
        }
        assert(errors.length === 0, 'no page errors: ' + errors.join(' | ').slice(0, 300));
    } finally { await browser.close(); }
    console.log(failed ? `t_world_notes: ${failed} failed` : 'PASS t_world_notes: the story notes block under the smallest room and under each placement');
})().catch(error => { console.error(error); process.exitCode = 1; });
