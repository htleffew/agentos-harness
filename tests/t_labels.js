// B7: glossary sweep and help text. Runs with node --test, no host needed.
// Scans every string literal in src/ui and the user-text files of src (DESIGN.md 2, audit 03) for:
//   1. retired names from DESIGN.md 2.1 and 2.2 and Appendix B,
//   2. help text of more than two sentences outside a "How it works" disclosure,
//   3. Shift-click and hover hints,
//   4. screen references that the navigation does not list,
//   5. emoji (the B1 rule, repeated here for every string this ticket touches).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

// ---------------------------------------------------------------------------------------------
// A small JavaScript lexer that returns the string literals of a source file.
// Template literals keep \u0001 where an expression sits; literals inside an expression come out
// on their own. A literal inside a call to howItWorks(...) carries how:true.
// ---------------------------------------------------------------------------------------------
function literals(src) {
    const out = [];
    const n = src.length;
    let i = 0, line = 1, last = '';
    const frames = [];
    let pendingHow = false;
    let how = null;
    const KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'else', 'do', 'new', 'await', 'yield']);
    const emit = (text, l, kind, extra = {}) => out.push({ text, line: l, kind, how: !!how, ...extra });
    function templateText(frame) {
        while (i < n) {
            const c = src[i];
            if (c === '`') { i++; emit(frame.text, frame.line, 't'); last = '"'; return; }
            if (c === '$' && src[i + 1] === '{') { i += 2; frame.text += '\u0001'; frames.push({ frame, depth: 0 }); last = '('; return; }
            if (c === '\\') { const d = src[i + 1]; frame.text += d === 'n' ? '\n' : d; if (d === '\n') line++; i += 2; continue; }
            if (c === '\n') line++;
            frame.text += c; i++;
        }
    }
    while (i < n) {
        const c = src[i];
        if (c === '\n') { line++; i++; continue; }
        if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
        if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
        if (c === "'" || c === '"') {
            const l = line; let s = ''; i++;
            while (i < n && src[i] !== c) {
                if (src[i] === '\\') { const d = src[i + 1]; s += d === 'n' ? '\n' : d === 't' ? '\t' : d; if (d === '\n') line++; i += 2; continue; }
                if (src[i] === '\n') break;
                s += src[i++];
            }
            i++; emit(s, l, 's'); last = '"'; continue;
        }
        if (c === '`') { const frame = { text: '', line }; i++; templateText(frame); continue; }
        if (c === '{') { if (frames.length) frames[frames.length - 1].depth++; last = '{'; i++; continue; }
        if (c === '}') {
            if (frames.length) {
                const top = frames[frames.length - 1];
                if (top.depth === 0) { frames.pop(); i++; templateText(top.frame); continue; }
                top.depth--;
            }
            last = '}'; i++; continue;
        }
        if (c === '(') { if (how) how.depth++; else if (pendingHow) how = { depth: 1 }; pendingHow = false; last = '('; i++; continue; }
        if (c === ')') { if (how && --how.depth === 0) how = null; last = ')'; i++; continue; }
        if (c === '/') {
            if (last === '' || last === 'r' || /[(,=:[!&|?{};+\-*%<>~^]/.test(last)) {
                i++;
                while (i < n && src[i] !== '/' && src[i] !== '\n') {
                    if (src[i] === '\\') i++;
                    else if (src[i] === '[') { i++; while (i < n && src[i] !== ']' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } }
                    i++;
                }
                i++;
                while (/[a-z]/.test(src[i] || '')) i++;
                last = ')'; continue;
            }
            i++; last = '/'; continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
            let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
            const word = src.slice(i, j);
            pendingHow = word === 'howItWorks';
            last = KEYWORDS.has(word) ? 'r' : 'a';
            i = j; continue;
        }
        if (/\d/.test(c)) { while (i < n && /[\w.]/.test(src[i])) i++; last = 'a'; continue; }
        pendingHow = false;
        last = c; i++;
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// What counts as user text
// ---------------------------------------------------------------------------------------------
function walk(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full, out);
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}
const rel = file => path.relative(root, file).replaceAll('\\', '/');

// Files outside src/ui whose literals reach the screen (labels, toasts, receipts, dialogs). Model prompts
// and defaults are not scanned: they are what the model reads, and the glossary words for the extension's
// own features are matched there by code, not by a person reading them.
const USER_TEXT_FILES = [
    'src/execution.js', 'src/books.js', 'src/book-keywords.js', 'src/ai.js', 'src/guided-turns.js', 'src/quick-actions.js',
    'src/quick-action-chat.js', 'src/quick-action-import.js', 'src/recall.js', 'src/worldflow.js', 'src/preset-loadouts.js',
    'src/routing.js', 'src/impersonation.js', 'src/v10.js', 'src/engine.js', 'src/st.js', 'src/preset-workbench.js', 'src/chat-books.js', 'src/book-triggers.js', 'src/prose-diagnostics.js', 'src/chapters.js', 'src/world.js', 'src/context-budget.js', 'src/recall.js',
];
// Files that mix labels with the prompts the model reads. They are checked for retired names and screen references only;
// the model-facing text in them is kept by the rules below.
const PROMPT_HEAVY = ['src/v10.js', 'src/engine.js', 'src/chapters.js', 'src/world.js', 'src/prose-diagnostics.js'];
const files = [...walk(path.join(root, 'src/ui')), ...USER_TEXT_FILES.map(f => path.join(root, f))];

// A literal is text a person reads when it has a space, or starts with a capital letter.
// Module paths, CSS classes, ids and keys are not.
function isUserText(text) {
    if (!text || /^\.{1,2}\//.test(text)) return false;
    if (/^[a-z0-9_.:#[\]="'*>~|+,@%-]+$/i.test(text) && !/^[A-Z][a-z]+$/.test(text)) return false;
    if (/^[a-z][\w-]*(:[\w-]+)*$/.test(text)) return false;
    // CSS selectors and class lists: no capital letter and every word carries a hyphen, dot, hash, bracket or equals sign.
    if (!/[A-Z]/.test(text) && text.split(' ').every(word => /[-_.#[\]=:\u0001]/.test(word))) return false;
    return /[A-Za-z]/.test(text);
}

const cache = new Map();
function textsOf(file) {
    if (!cache.has(file)) {
        const source = fs.readFileSync(file, 'utf8');
        const lines = source.split('\n');
        const name = rel(file);
        cache.set(file, literals(source).filter(item => isUserText(item.text) && !/\bconsole\.(warn|log|error|info|debug)\(/.test(lines[item.line - 1] || ''))
            .map(item => ({ ...item, file: name, promptHeavy: PROMPT_HEAVY.includes(name) })));
    }
    return cache.get(file);
}
const allTexts = () => files.flatMap(textsOf);
const readable = () => allTexts().filter(item => !item.promptHeavy);
// Fails with the whole list; set LABELS_DUMP to a file path to collect every finding while sweeping.
const none = list => {
    if (process.env.LABELS_DUMP) fs.appendFileSync(process.env.LABELS_DUMP, list.map(line => `${line}\n`).join(''));
    assert.equal(list.length, 0, `${list.length} found:\n${list.join('\n')}`);
};
const show = item => `${item.file}:${item.line} ${item.text.replace(/\n/g, ' ').replace(/\u0001/g, '${}').slice(0, process.env.LABELS_FULL ? 700 : 110)}`;

// A literal that is a keyword for search, so old words still find the right page.
const SEARCH_KEYWORD_FILES = ['src/ui/menu-search.js'];
const isAlias = item => SEARCH_KEYWORD_FILES.includes(item.file) || item.aliasLine;
function markAliases(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const item of textsOf(file)) item.aliasLine = [...(lines[item.line - 1] || '').matchAll(/\baliases\s*:\s*(['"`])(.*?)\1/g)].some(match => match[2] === item.text);
}
for (const file of files) markAliases(file);

// ---------------------------------------------------------------------------------------------
// 1. Retired names (DESIGN.md 2.1, 2.2 and Appendix B)
// ---------------------------------------------------------------------------------------------
const RETIRED = [
    [/\balternate (reply|replies|version|direction)\b|\bgenerate (an )?alternate\b|^Alternate$/i, 'Swipe'],
    [/guided swipe|historical swipe|guided regeneration|write a new reply right away|pick again and write/i, 'Swipe, Regenerate'],
    [/continue this reply/i, 'Continue'],
    [/draft my reply|generate my draft|player draft|player choices|player message|\bthe player\b|\bby player\b|player helpers|player request|player-only/i, 'Impersonate, Persona, your message'],
    [/lore ?books?/i, 'World Info book'],
    [/secondary triggers?|trigger phrases?|\bkeyword[- ]triggered\b|\balways eligible\b|^Triggers$|^Trigger$|\bclear triggers\b|\bthe triggers\b|\bon triggers\b|choosing triggers|\btriggers? (match|scan)|when a trigger/i, 'Primary Keywords, Optional Filter, Constant, Normal'],
    [/chance \(%\)|keep active for replies/i, 'Trigger %, Sticky'],
    [/starting rules/i, 'Restore default prompt'],
    [/hidden from ai|auto-hide/i, 'Exclude from prompts'],
    [/\bhost\b/i, 'SillyTavern'],
    [/queue shortcut|this shortcut|saved actions?\b|composer quick actions?/i, 'Quick action, Quick action bar'],
    [/\bcyoa\b|\bsuggestions?\b/i, 'Options'],
    [/\bsteer(s|ing)?\b|\bnudges?\b|\bcues?\b|private system note/i, 'Direction'],
    [/model requests?|\bai requests?\b|\bai calls?\b/i, 'Model call'],
    [/story record storage|\bstory notes?\b|foundation at this reply|\bsnapshots?\b/i, 'Story World, Recall, Story state, Who they are'],
    [/legacy dice|scene and character checks|checks for this chat|check that it happened|local prose screening/i, 'Action check, Continuity guidance, Follow-through check, Reply screening'],
    [/autonomous world events?|plot opportunit|reader reaction/i, 'Plot offer, Roast'],
    [/\bglance\b|story state stack/i, 'Reply tray'],
    [/\bmodules?\b/i, 'Feature'],
    [/extension-owned|preset-owned/i, 'Ours, Theirs'],
    [/ask first|run sheet|card style|card theme|time header|mobile header|saved combination|preset copy|tracker lorebook|state book/i, 'Generate sheet, Story style, Scene header, Loadout, Tracker World Info book'],
    [/^Opening$|opening \(page\)|\bmain greeting\b/i, 'First message'],
];

// Strings that must keep a retired word, with the reason. Match on file and text.
const KEEP = [
    { file: 'src/v10.js', match: /player|^Scene and character checks:/, why: 'default prompt text and a request heading the model reads' },
    { file: 'src/engine.js', match: /plot opportunity/, why: 'request text the model reads' },
    { file: 'src/prose-diagnostics.js', match: /player/, why: 'review prompt the model reads' },
    { file: 'src/chapters.js', match: /story notes|lorebook/, why: 'prompts and record text the model reads' },
    { file: 'src/world.js', match: /[Ss]tory notes/, why: 'name of the notes book and the entry text the model reads; renaming would orphan her books' },
    { file: 'src/context-budget.js', match: /Story notes block/, why: 'matches receipts saved before the rename' },
    { file: 'src/chat-books.js', any: true, why: 'role keys that src/memory/additions.js reads; the Story page shows them with SillyTavern in place of Host' },
    { file: 'src/ui/cards/choices.js', why: 'model prompt for the Options call, not shown as help', any: true },
    { file: 'src/ui/card-templates.js', why: 'names of cards and template text of SillyTavern presets she may have installed', match: /CYOA/ },
];
const kept = item => KEEP.some(rule => rule.file === item.file && (rule.any || rule.match.test(item.text)));

test('no retired name from the glossary appears in user text', () => {
    const found = [];
    for (const item of allTexts()) {
        if (isAlias(item) || kept(item)) continue;
        for (const [pattern, use] of RETIRED) if (pattern.test(item.text)) found.push(`${show(item)}  [use: ${use}]`);
    }
    none(found);
});

test('the retired-name patterns match what they should', () => {
    const hits = text => RETIRED.filter(([pattern]) => pattern.test(text)).length;
    for (const bad of ['Generate an alternate reply', 'Guided swipe', 'Continue this reply', 'Draft my reply', 'Reusable lorebooks',
        'Always eligible', 'Chance (%)', 'the host preset', 'Steer the next reply', 'One AI request reads it', 'Room for story notes',
        'Scene and character checks', 'Reader reaction', 'Extension modules', 'Opening', 'A model request']) {
        assert.ok(hits(bad) > 0, `${bad} is caught`);
    }
    for (const good of ['Swipe', 'Continue', 'Impersonate', 'World Info book', 'Constant', 'Trigger %', 'SillyTavern', 'Direction',
        '1 model call', 'Recall', 'Alternate Greetings', 'First message', 'Reply screening', 'Roast']) {
        assert.equal(hits(good), 0, `${good} is allowed`);
    }
});

test('World Info book replaces every lorebook wording', () => {
    const found = allTexts().filter(item => !isAlias(item) && /lore ?books?/i.test(item.text)).map(show);
    none(found);
});

// ---------------------------------------------------------------------------------------------
// 2. Help text: one or two sentences, mechanism under How it works (DESIGN.md 2.3 item 3)
// ---------------------------------------------------------------------------------------------
const sentences = text => text.replace(/\u0001/g, 'X').split(/(?<=[.!?])\s+(?=[A-Z“"‘(0-9])/).filter(part => part.trim());
const NOT_HELP = [
    { file: 'src/ui/cards/choices.js', why: 'model prompt' },
    { file: 'src/guided-turns.js', match: /^Use the active player/, why: 'model prompt for Impersonate' },
    { file: 'src/worldflow.js', match: /^\[The story before this chat/, why: 'model prompt for the carry-over chat' },
    { file: 'src/ui/quick-action-fields.js', match: /^[a-z-]+:[\w ]+,/, why: 'icon search words' },
];
test('help text is one or two sentences, with the mechanism under a How it works disclosure', () => {
    const found = [];
    for (const item of readable()) {
        if (item.how || item.text.length < 50 || !/ /.test(item.text)) continue;
        if (NOT_HELP.some(rule => rule.file === item.file && (!rule.match || rule.match.test(item.text)))) continue;
        const count = sentences(item.text).length;
        if (count > 2) found.push(`${count} sentences: ${show(item)}`);
    }
    none(found);
});

test('help text keeps its plumbing out of sight: no tags, regex scripts or chat variables outside How it works', () => {
    const found = readable().filter(item => !item.how && / regex\b|<sent_instructions>|\{\{getvar|\brule:[a-z]/.test(item.text) && !item.text.startsWith('{{') && !isAlias(item)).map(show);
    none(found);
});

// ---------------------------------------------------------------------------------------------
// 3. No Shift-click or hover hints; a phone has tap and press and hold (DESIGN.md 2.3 item 6)
// ---------------------------------------------------------------------------------------------
test('no Shift-click, right-click or hover hints remain', () => {
    const found = readable().filter(item => !isAlias(item) && /shift[- +]?click|right[- ]?click|\bhover(ing)?\b|\bmouse over\b|\bctrl[- ]click/i.test(item.text)).map(show);
    none(found);
});

// ---------------------------------------------------------------------------------------------
// 4. Every screen reference matches the navigation list (DESIGN.md 2.3 item 1)
// ---------------------------------------------------------------------------------------------
function navigation(destinations) {
    const norm = text => String(text).toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    const tabs = new Map();
    for (const top of destinations.tabs) tabs.set(norm(top.label), { top, names: new Set(top.nested.map(nested => norm(nested.label))) });
    for (const page of destinations.pages) {
        const entry = tabs.get(norm(page.section));
        if (entry && !page.bridge) entry.names.add(norm(page.label));
    }
    // Pages that other files register into a nested tab (page-registry.js): group, tab, subgroup and label.
    const groupLabel = { story: 'story', direction: 'direction', quick: 'quick actions', review: 'review', setup: 'setup' };
    for (const file of walk(path.join(root, 'src')).concat([path.join(root, 'index.js')])) {
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/registerPage\(\{([^}]*)\}/g)) {
            const body = match[1];
            const group = /group:\s*'([a-z]+)'/.exec(body)?.[1];
            const label = /label:\s*'([^']+)'/.exec(body)?.[1];
            const sub = /subgroup:\s*'([^']+)'/.exec(body)?.[1];
            const entry = tabs.get(groupLabel[group]);
            if (!entry) continue;
            if (label) entry.names.add(norm(label));
            if (sub) entry.names.add(norm(sub));
        }
    }
    return { tabs, norm, all: new Set([...tabs.values()].flatMap(entry => [...entry.names]).concat([...tabs.keys()])) };
}

// "Setup, Prompts", "Story, Story World, The story so far", "Setup → Reply display"
const REFERENCE = /\b(Story|Direction|Quick actions|Review|Setup)(?:,| →| ›) ([A-Z][\w&-]*(?: [\w&-]+){0,3})/g;
// The words after the tab name hold a page name when some leading run of them is one.
const namesPage = (nav, entry, words) => {
    const parts = words.split(' ');
    return !!entry && parts.some((_, k) => entry.names.has(nav.norm(parts.slice(0, k + 1).join(' '))));
};
// Dead names from audit 02: places the menu never had, or names it no longer has.
const DEAD = [
    [/\bin Settings\b|\bSettings tab\b|\bSettings page\b/, 'Setup, Connections or the page that holds the control'],
    [/\bthe Log tab\b|\bLog tab\b/, 'Review, Request log'],
    [/\bWhat Was Sent\b/, 'What was sent'],
    [/\bRandom Story Events tab\b|\bRandom story events tab\b/, 'Direction, Random sets'],
    [/Reusable Lorebooks|Keeping the story so far/i, 'Story, World Info'],
    [/\bthe (Prompts|Features|Memory|Connections|Presets|Context|Replies|Library|Bar|Look|Writing|Goal|Scene|Characters) (page|tab)\b/, 'a full reference: "Setup, Prompts"'],
];

test('every screen reference names a page the navigation lists', async () => {
    const destinations = await import(pathToFileURL(path.join(root, 'src/ui/destinations.js')).href);
    const nav = navigation(destinations);
    const bad = [];
    for (const item of allTexts()) {
        if (isAlias(item)) continue;
        for (const match of item.text.replace(/\u0001/g, '').matchAll(REFERENCE)) {
            const entry = nav.tabs.get(nav.norm(match[1]));
            if (!namesPage(nav, entry, match[2])) bad.push(`${show(item)}  [no "${match[1]}, ${match[2]}"]`);
        }
        for (const [pattern, use] of DEAD) if (pattern.test(item.text)) bad.push(`${show(item)}  [use: ${use}]`);
    }
    none(bad);
});

test('the reference check reads the navigation and fails a name that is not in it', async () => {
    const destinations = await import(pathToFileURL(path.join(root, 'src/ui/destinations.js')).href);
    const nav = navigation(destinations);
    const ok = text => [...text.matchAll(REFERENCE)].every(match => namesPage(nav, nav.tabs.get(nav.norm(match[1])), match[2]));
    assert.ok(ok('Turn it on in Setup, Memory.'));
    assert.ok(ok('Open Setup, Prompts'));
    assert.ok(ok('Edit it in Story, World Info.'));
    assert.ok(ok('Chosen in Review, Request log.'));
    assert.ok(!ok('Turn it on in Setup, Settings.'));
    assert.ok(!ok('Open Direction, Action checks'));
    assert.ok(!ok('See Review, Log.'));
});

// ---------------------------------------------------------------------------------------------
// 5. No emoji in anything a person reads (B1's rule, for every string this ticket touches)
// ---------------------------------------------------------------------------------------------
test('no emoji in user text', () => {
    const emoji = /\p{Emoji_Presentation}|️/u;
    none(readable().filter(item => emoji.test(item.text)).map(show));
});

test('no em or en dash in user text', () => {
    none(readable().filter(item => /[–—]/.test(item.text)).map(show));
});

test('the scan reads the files it should', () => {
    assert.ok(files.length > 60, 'src/ui files are scanned');
    assert.ok(allTexts().length > 3000, 'a few thousand literals are read');
    assert.ok(allTexts().some(item => item.text === 'Features'), 'the lexer finds labels');
    const sample = literals("a('One. Two. Three.', howItWorks('Three. Four. Five.'), `x ${'inner text'} y`)");
    assert.deepEqual(sample.map(item => [item.text, item.how]), [['One. Two. Three.', false], ['Three. Four. Five.', true], ['inner text', false], ['x \u0001 y', false]]);
});
