const assert = require('node:assert/strict');
const L = require('./lib.js');

(async () => {
    L.sync();
    const { browser, page } = await L.open({ width: 430, height: 820 });
    try {
        await L.setupApi(page);
        await L.openChat(page);
        const root = page.locator('#ri_root');
        await root.locator('button').filter({ hasText: /^Expand$/ }).evaluate(button => button.click());
        const sets = await page.evaluate(async base => {
            const B = await import(`${base}/src/books.js`);
            const E = await import(`${base}/src/events.js`);
            const { app } = await import(`${base}/src/ui/panel.js`);
            const suffix = Date.now();
            const home = `Delete shared fixture ${suffix}`;
            const instructions = await B.createSet(`Delete instructions ${suffix}`, 'instructions', { entries: {} }, home);
            await B.editSet(instructions, data => {
                for (const name of ['Keep this instruction', 'Remove this copy']) {
                    const draft = B.newInstruction(data, instructions);
                    draft.name = name;
                    draft.versions = [{ text: '{{char}} must greet {{user}}.', keep: false }];
                    B.writeInstruction(data, draft, instructions);
                }
            });
            const eventData = { entries: {} };
            E.writeEvent(eventData, E.newEvent('Roadside event'));
            const events = await B.createSet(`Delete events ${suffix}`, 'events', eventData, '');
            const styleData = { entries: {} };
            E.writeEvent(styleData, E.newStyle('Writing style fixture'));
            const style = await B.createSet(`Delete style ${suffix}`, 'style', styleData, home);
            app.tab = 'instructions';
            app.go({ view: 'set', name: instructions });
            return { home, instructions, events, style };
        }, L.BASE);

        const doomed = root.locator('.ri-inscard').filter({ hasText: 'Remove this copy' });
        const confirm = page.locator('dialog[open]');
        await doomed.getByRole('button', { name: 'Delete', exact: true }).click();
        assert.match(await confirm.textContent(), /Remove this copy.*all its versions/s);
        await confirm.locator('.popup-button-cancel').click();
        assert.equal(await doomed.count(), 1);

        await doomed.getByRole('button', { name: 'Delete', exact: true }).click();
        await confirm.locator('.popup-button-ok').click();
        await doomed.waitFor({ state: 'detached' });
        await root.locator('.ri-inscard').filter({ hasText: 'Keep this instruction' }).waitFor();
        const shared = await page.evaluate(async ([base, sets]) => {
            const B = await import(`${base}/src/books.js`);
            const data = await B.loadSet(sets.instructions);
            const kept = B.listInstructions(data, sets.instructions);
            return { kept: kept.map(row => row.name), next: B.freeUid(data), count: Object.keys(data.entries).length };
        }, [L.BASE, sets]);
        assert.deepEqual(shared, { kept: ['Keep this instruction'], next: 3, count: 2 });

        for (const [tab, route, name, label, open] of [
            ['events', 'eroute', sets.events, 'Delete story event set', true],
            ['style', 'sroute', sets.style, 'Delete writing style set', false],
        ]) {
            await page.evaluate(async ([base, tab, route]) => {
                const { app } = await import(`${base}/src/ui/panel.js`);
                app.tab = tab;
                app[route] = { view: 'list' };
                app.render();
            }, [L.BASE, tab, route]);
            const title = name.split(' › ').at(-1);
            const card = root.locator('.ri-setcard').filter({ hasText: title });
            if (open) await card.getByRole('button', { name: 'Open' }).click();
            await (open ? root.locator('.ri-savebar') : card).getByRole('button', { name: label, exact: true }).click();
            await confirm.locator('.popup-button-ok').click();
            await card.waitFor({ state: 'detached' });
        }
        const saved = await page.evaluate(async ([base, sets]) => {
            const { ctx } = await import(`${base}/src/st.js`);
            const fetchBook = async name => {
                const response = await fetch('/api/worldinfo/get', {
                    method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ name }),
                });
                return response.json();
            };
            const home = await fetchBook(sets.home);
            const events = await fetchBook(sets.events);
            return { shared: Object.values(home.entries).map(e => e.comment), events: Object.keys(events.entries),
                nextSharedUid: home.extensions.riNextUid, nextEventUid: events.extensions.riNextUid };
        }, [L.BASE, sets]);
        assert.deepEqual(saved, { shared: ['Keep this instruction'], events: [], nextSharedUid: 3, nextEventUid: 1 });
        console.log('PASS instruction, event and style deletion with confirmation, book retention and shared-entry isolation');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
