// B58: the reference guide and the help assistant's request. Runs with node --test, no SillyTavern needed.
//   1. Coverage: every menu page, card, quick action, background job and setting has a guide entry. The test lists each
//      one that has none.
//   2. assets/help/generated/app.json agrees with what the code holds (pages, cards, quick actions, jobs, prompts), so a
//      change in the code that the guide data misses fails here; tests/t_help_host.js checks the drawn controls.
//   3. Each page file has its title and the three hand-written sections, and every link in the guide opens something real.
//   4. assets/help/index.md is current (RI_HELP_WRITE=1 writes it).
//   5. Search finds a control by its label, and the request keeps its fixed part first and the question last.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const HELP = path.join(root, 'assets', 'help');
const app = JSON.parse(fs.readFileSync(path.join(HELP, 'generated', 'app.json'), 'utf8'));
// Files may be checked out with CRLF endings on Windows; every check reads them with LF.
const read = file => fs.readFileSync(path.join(HELP, file), 'utf8').replace(/\r\n/g, '\n');
const exists = file => fs.existsSync(path.join(HELP, file));
const load = rel => import(pathToFileURL(path.join(root, rel)).href);
const fold = text => String(text).toLowerCase().replace(/[’‘]/g, '\'').replace(/\s+/g, ' ');
// The prose of a guide file: links down to their words, bold and code marks removed.
const prose = file => fold(read(file).replace(/\[([^\]]+)\]\((page|help):[^)]*\)/g, '$1').replace(/\*\*|`/g, ''));

// A minimal SillyTavern for the modules that read settings when they are imported or called.
globalThis.SillyTavern = { getContext: () => ({ extensionSettings: { roleplay_instructions: {} }, chatMetadata: {}, saveSettingsDebounced() {} }) };

const pagesWithFiles = () => app.pages.filter(page => !page.sub);
const none = (list, what) => assert.equal(list.length, 0, `${list.length} ${what}:\n${list.join('\n')}`);

// ---------------------------------------------------------------------------------------------
// 1. Coverage
// ---------------------------------------------------------------------------------------------
test('every menu page, card, quick action, background job and setting has a guide entry', async () => {
    const { FEATURES } = await load('src/help.js');
    const missing = [];
    for (const page of pagesWithFiles()) if (!exists(`pages/${page.id}.md`)) missing.push(`page ${page.id} (${page.top} › ${page.nested} › ${page.label}): no pages/${page.id}.md`);
    for (const page of app.pages.filter(item => item.sub)) {
        const lead = app.pages.find(item => !item.sub && item.top === page.top && item.nested === page.nested);
        if (!lead || !exists(`pages/${lead.id}.md`) || !prose(`pages/${lead.id}.md`).includes(fold(page.label))) missing.push(`page ${page.id}: its label "${page.label}" is not in the entry of ${lead?.id}`);
    }
    for (const feature of FEATURES) if (!exists(`features/${feature.id}.md`)) missing.push(`feature ${feature.id}: no features/${feature.id}.md`);
    const cards = prose('features/reply-cards.md');
    for (const card of app.cards) if (!cards.includes(fold(card.label))) missing.push(`card ${card.id} "${card.label}": not in features/reply-cards.md`);
    const quick = prose('features/quick-actions.md');
    for (const kind of app.quickActionKinds) if (!quick.includes(fold(kind.name))) missing.push(`quick action kind ${kind.kind} "${kind.name}": not in features/quick-actions.md`);
    for (const action of app.builtinQuickActions) if (!quick.includes(fold(action.title))) missing.push(`quick action ${action.id} "${action.title}": not in features/quick-actions.md`);
    const jobs = prose('features/jobs.md');
    for (const job of app.jobs) if (!jobs.includes(fold(job.label))) missing.push(`background job ${job.id} "${job.label}": not in features/jobs.md`);
    // A setting's entry is its page's entry: the hand-written text, and the Controls list the Help page draws from app.json.
    for (const [id, controls] of Object.entries(app.controls)) {
        const page = app.pages.find(item => item.id === id);
        if (!page) missing.push(`settings of ${id}: the page is not in the menu tree of app.json`);
        else if (!exists(`pages/${id}.md`)) for (const control of controls) missing.push(`${control.kind} "${control.label}" on ${id}: its page has no entry`);
    }
    // Every prompt is in the guide's prompt list, drawn from app.json.
    const { catalogFor } = await load('src/help.js');
    const listed = new Set(catalogFor(app, 'prompt-list').map(item => item.label));
    for (const prompt of app.prompts) if (!listed.has(prompt.label)) missing.push(`prompt ${prompt.id}: not in the prompt list`);
    none(missing, 'with no guide entry');
});

test('the hand-written text names most settings by their label (recorded, so the share can be watched)', () => {
    let named = 0, total = 0;
    const unnamed = [];
    for (const [id, controls] of Object.entries(app.controls)) {
        if (!exists(`pages/${id}.md`)) continue;
        const text = prose(`pages/${id}.md`);
        for (const control of controls.filter(item => item.kind === 'setting')) {
            total++;
            if (text.includes(fold(control.label))) named++; else unnamed.push(`${id}: ${control.label}`);
        }
    }
    const share = total ? named / total : 1;
    console.log(`settings named in the hand-written text: ${named} of ${total} (${Math.round(share * 100)}%)`);
    if (process.env.HELP_DUMP) fs.writeFileSync(process.env.HELP_DUMP, unnamed.join('\n'));
    assert.ok(share >= 0.8, `at least four in five settings are named in the prose (${named} of ${total})`);
});

// ---------------------------------------------------------------------------------------------
// 2. app.json agrees with the code
// ---------------------------------------------------------------------------------------------
test('the guide data agrees with the pages, cards, quick actions, jobs and prompts in the code', async () => {
    const stale = [];
    const ids = new Set(app.pages.map(page => page.id));
    const destinations = await load('src/ui/destinations.js');
    for (const page of destinations.pages) if (!page.bridge && !ids.has(page.id)) stale.push(`page ${page.id} from destinations.js`);
    const walk = dir => fs.readdirSync(dir).flatMap(name => { const full = path.join(dir, name); return fs.statSync(full).isDirectory() ? walk(full) : name.endsWith('.js') ? [full] : []; });
    for (const file of walk(path.join(root, 'src'))) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/registerPage\(\{\s*id:\s*'([^']+)'/g)) if (!ids.has(match[1])) stale.push(`page ${match[1]} registered in ${path.relative(root, file)}`);
        for (const match of source.matchAll(/export const (\w*PAGE\w*) = '([^']+)'/g)) if (new RegExp(`registerPage\\(\\{\\s*id:\\s*${match[1]}\\b`).test(source) && !ids.has(match[2])) stale.push(`page ${match[2]} registered in ${path.relative(root, file)}`);
    }
    const { CARDS } = await load('src/cards/catalog.js');
    assert.deepEqual(app.cards.map(card => card.id), CARDS.map(card => card.id), 'the card catalog');
    const { JOBS } = await load('src/routing.js');
    assert.deepEqual(app.jobs.map(job => job.id), Object.keys(JOBS), 'the background jobs');
    const { PROMPTS } = await load('src/prompts.js');
    assert.deepEqual(app.prompts.map(prompt => prompt.id), Object.keys(PROMPTS), 'the prompt list');
    const quick = fs.readFileSync(path.join(root, 'src', 'quick-actions.js'), 'utf8');
    const kinds = [...quick.slice(quick.indexOf('QUICK_ACTION_KINDS = Object.freeze({'), quick.indexOf('const kindByFamily')).matchAll(/^    (\w+): \{ name: '([^']+)'/gm)].map(match => match[1]);
    assert.deepEqual(app.quickActionKinds.map(kind => kind.kind), kinds, 'the quick action kinds');
    const titles = new Set(app.builtinQuickActions.map(action => action.title));
    for (const match of quick.matchAll(/builtIn\('\w+', '[\w-]+', '([^']+)'/g)) if (!titles.has(match[1])) stale.push(`built-in quick action "${match[1]}"`);
    for (const match of quick.matchAll(/^\s+\['[\w-]+', '([^']+)', '/gm)) if (!titles.has(match[1])) stale.push(`built-in quick action "${match[1]}"`);
    none(stale, 'in the code and missing from assets/help/generated/app.json (run tests/t_help_host.js with RI_HELP_WRITE=1)');
});

// ---------------------------------------------------------------------------------------------
// 3. The files themselves
// ---------------------------------------------------------------------------------------------
test('each entry has its title, the three hand-written sections and some words of its own', async () => {
    const { FEATURES } = await load('src/help.js');
    const bad = [];
    const files = [...pagesWithFiles().map(page => `pages/${page.id}.md`), ...FEATURES.map(feature => `features/${feature.id}.md`)];
    for (const file of files.filter(exists)) {
        const text = read(file);
        if (!/^# \S/.test(text)) bad.push(`${file}: no title line`);
        for (const head of ['## What it does', '## Model calls and cost', '## Why it works this way']) if (!text.includes(`\n${head}\n`)) bad.push(`${file}: no "${head}"`);
        const words = text.replace(/^#.*$/gm, '').split(/\s+/).filter(Boolean).length;
        if (words < 80) bad.push(`${file}: ${words} words`);
        if (/generated:/.test(text)) bad.push(`${file}: a generated marker is left in`);
    }
    const ids = [...pagesWithFiles().map(page => page.id), ...FEATURES.map(feature => feature.id)];
    const twice = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (twice.length) bad.push(`entry ids used twice: ${twice.join(', ')}`);
    none(bad, 'problems');
});

test('every link in the guide opens a page, a control on it, or another entry', async () => {
    const { FEATURES } = await load('src/help.js');
    const entries = new Set([...pagesWithFiles().map(page => page.id), ...FEATURES.map(feature => feature.id)]);
    const files = [...fs.readdirSync(path.join(HELP, 'pages')).map(name => `pages/${name}`), ...fs.readdirSync(path.join(HELP, 'features')).map(name => `features/${name}`), 'index.md'];
    const bad = [];
    for (const file of files) for (const match of read(file).matchAll(/\]\((page|help):([\w-]+)(?:#([^)]*))?\)/g)) {
        const [, scheme, id, label] = match;
        if (scheme === 'help' && !entries.has(id)) bad.push(`${file}: help:${id} is no entry`);
        if (scheme === 'page' && !app.pages.some(page => page.id === id)) bad.push(`${file}: page:${id} is no page`);
        if (scheme === 'page' && label && !(app.controls[id] || []).some(control => fold(control.label).startsWith(fold(label)))) bad.push(`${file}: page:${id}#${label} matches no control on that page`);
    }
    none(bad, 'broken links');
});

// ---------------------------------------------------------------------------------------------
// 4. The index
// ---------------------------------------------------------------------------------------------
async function indexMarkdown() {
    const { FEATURES, placeOf } = await load('src/help.js');
    const lines = ['# Guide index', '', 'One entry for every page of the menu, by top tab, then one for each feature that spans several pages. Setup, Help shows the same list, and each page header has a Help link to its own entry.', ''];
    for (const top of [...new Set(app.pages.map(page => page.top))]) {
        lines.push(`## ${top}`, '');
        for (const page of pagesWithFiles().filter(item => item.top === top)) lines.push(`- [${page.label}](help:${page.id}), ${placeOf(app, page.id)}`);
        lines.push('');
    }
    lines.push('## Features', '', ...FEATURES.map(feature => `- [${feature.title}](help:${feature.id})`), '');
    return lines.join('\n');
}

test('assets/help/index.md lists every entry', async () => {
    const want = await indexMarkdown();
    if (process.env.RI_HELP_WRITE) fs.writeFileSync(path.join(HELP, 'index.md'), want);
    assert.equal(read('index.md').replace(/\r\n/g, '\n'), want, 'index.md is current; run with RI_HELP_WRITE=1 to write it');
});

// ---------------------------------------------------------------------------------------------
// 5. Search and the request
// ---------------------------------------------------------------------------------------------
async function guideWithIndex() {
    const H = await load('src/help.js');
    const guide = await H.loadGuide(async file => read(file));
    return { H, guide, index: H.guideIndex(guide) };
}

test('search finds a control by its label, and an entry by its words', async () => {
    const { guide, index } = await guideWithIndex();
    assert.ok(guide.docs.every(doc => !doc.missing), 'every entry file loads');
    const control = app.controls.memory.find(item => item.kind === 'setting');
    const hits = index.search(control.label);
    assert.equal(hits[0].control?.label, control.label, `"${control.label}" finds that control first`);
    assert.equal(hits[0].doc.id, 'memory');
    const spend = index.search('monthly spend ceiling');
    assert.ok(spend.slice(0, 5).some(hit => hit.doc.id === 'spend'), 'the Spend entry ranks near the top for its words');
    assert.equal(index.search('').length, 0);
});

test('the request: the fixed part first, the ranked entries next, the question last', async () => {
    const { H, index } = await guideWithIndex();
    const entries = H.rankEntries(index, 'How do I reorder the routes a background job tries?');
    assert.ok(entries.length >= 1 && entries.length <= 3, 'one to three entries');
    assert.ok(entries.some(entry => entry.doc.id === 'background-jobs'), 'the Background jobs entry is among them');
    const one = H.helpRequest({ question: 'How do I reorder the routes a background job tries?', entries });
    const two = H.helpRequest({ question: 'Where is the spend ceiling?', entries: H.rankEntries(index, 'Where is the spend ceiling?') });
    assert.equal(one.system, H.HELP_SYSTEM, 'the system part is fixed');
    assert.equal(one.system, two.system, 'it is the same for every question');
    assert.match(one.user, /^Guide pages:/);
    assert.match(one.user, /\n\nQuestion: How do I reorder the routes a background job tries\?$/, 'the question comes last');
    assert.ok(!/Her live settings/.test(one.user) && !/The latest reply/.test(one.user), 'no live state or reply unless given');
    const live = H.helpRequest({ question: 'Why?', entries, live: 'Settings: {}', reply: 'She smiles.' });
    assert.ok(live.user.indexOf('Her live settings') < live.user.indexOf('The latest reply') && live.user.indexOf('The latest reply') < live.user.indexOf('Question: Why?'), 'live state, then the reply, then the question');
    assert.ok(!/\p{Emoji_Presentation}|[–—]/u.test(H.HELP_SYSTEM), 'no emoji or dashes in the fixed part');
    assert.ok(!/\b(don't|do not|never|avoid)\b/i.test(H.HELP_SYSTEM), 'the fixed part says what to do');
});

test('askHelp sends one request per question, and none for a question no entry matches', async () => {
    const { H, guide, index } = await guideWithIndex();
    const calls = [];
    const run = async (chain, options) => { calls.push({ chain, options }); return { ok: true, text: 'Open Setup, Spend.', route: 'main', attempts: [{ n: 1, of: 1, outcome: 'completed', label: 'Main API' }] }; };
    const chain = [{ route: 'main' }];
    const yes = await H.askHelp({ question: 'Where is the spend ceiling?', guide, index, chain, run });
    assert.equal(calls.length, 1, 'one request');
    assert.equal(calls[0].chain, chain, 'on the chain given');
    // A tap: runChain meters every paid step whatever background says (B59), and a tap refused at the ceiling reads the ceiling line.
    assert.equal(calls[0].options.background, false, 'a question is a tap');
    assert.equal(calls[0].options.job, 'help');
    assert.ok(yes.covered && yes.sources.length >= 1, 'covered, with its sources');
    const not = await H.askHelp({ question: 'Kilimanjaro?', guide, index, chain, run });
    assert.equal(calls.length, 1, 'no request for a question no entry matches');
    assert.equal(not.covered, false);
    assert.ok(H.saysNotCovered(not.text));
    const silent = async () => ({ ok: true, text: `${H.NOT_COVERED} The closest page is Setup, Spend.`, attempts: [] });
    assert.equal((await H.askHelp({ question: 'Where is the spend ceiling?', guide, index, chain, run: silent })).covered, false, 'an answer that says so is marked not covered');
});

test('live state leaves out keys, tokens and saved chat text, and the stack is names and switches only', async () => {
    const H = await load('src/help.js');
    const text = H.redactSettings({ enabled: true, openrouterKey: 'sk-secret', voice: { url: 'http://100.1.1.1', key: 'k-1' }, interruptedDrafts: { a: 'what she was typing' }, routing: { token: 't' }, summary: { budget: 800 }, long: 'x'.repeat(400) });
    assert.ok(!/sk-secret|k-1|"t"|what she was typing/.test(text), 'secrets and drafts are left out');
    assert.match(text, /"enabled":true/);
    assert.match(text, /"budget":800/);
    assert.ok(text.length < 400, 'long text is cut');
    const stack = H.stackSummary({ base: 'Default', cards: [{ name: 'Main Prompt', on: true, source: 'base', role: 'system', text: 'SECRET BODY' }], ri: [{ name: 'Dice', on: false, source: 'ri' }] });
    assert.match(stack, /^Base preset: Default\non  Main Prompt \(base\), system\noff  Dice \(ri\), Roleplay Instructions$/);
    assert.ok(!stack.includes('SECRET BODY'));
});

test('the default help chain is desktop, NanoGPT plan, free OpenRouter, then the Main API (B59)', async () => {
    const H = await load('src/help.js');
    const { RECOMMENDED_CHAINS, ROUTES } = await load('src/routing.js');
    const chain = H.defaultHelpChain(RECOMMENDED_CHAINS);
    assert.deepEqual(chain.map(entry => entry.route), ['desktop', 'nanogpt', 'openrouterFree', 'main']);
    assert.ok(chain.slice(0, -1).every(entry => ['local', 'plan', 'free'].includes(ROUTES[entry.route].cost)), 'no paid route before the Main API');
});

test('a help route list saved in 10.0.51 gains the Main API at its end once (B59)', async () => {
    const H = await load('src/help.js');
    const saved = { chain: [{ route: 'nanogpt' }, { route: 'desktop', timeoutMs: 60000 }] };
    assert.equal(H.addMainToSavedHelpChain(saved), true);
    assert.deepEqual(saved.chain.map(entry => entry.route), ['nanogpt', 'desktop', 'main']);
    assert.equal(H.addMainToSavedHelpChain(saved), false, 'the addition runs once');
    assert.equal(saved.chain.filter(entry => entry.route === 'main').length, 1);
    // She removes it afterwards: it stays removed.
    saved.chain = saved.chain.filter(entry => entry.route !== 'main');
    assert.equal(H.addMainToSavedHelpChain(saved), false);
    assert.deepEqual(saved.chain.map(entry => entry.route), ['nanogpt', 'desktop']);
    // A 10.0.51 list that already held the Main API keeps one, in her place.
    const own = { chain: [{ route: 'main' }, { route: 'desktop' }] };
    assert.equal(H.addMainToSavedHelpChain(own), true);
    assert.deepEqual(own.chain.map(entry => entry.route), ['main', 'desktop']);
    // No saved list: the default already ends on the Main API, nothing to add.
    assert.equal(H.addMainToSavedHelpChain({}), false);
    assert.equal(H.addMainToSavedHelpChain(undefined), false);
});
