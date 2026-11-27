// B58: Setup, Help. The reference guide with its word search, a Help link in every page header that opens that page's
// entry, the help route chain she orders, and the help assistant's chat sheet. Answers are read only: each lists the
// guide pages it was given and offers a link that opens the right page with the control in view; she makes every change.
import { h, button, toggle, field, select, howItWorks } from './dom.js';
import { registerPage } from './page-registry.js';
import { settings, saveSettings, chatState, saveChatState } from '../store.js';
import { ctx, isChatOpen, profileDetails } from '../st.js';
import { RECOMMENDED_CHAINS, ROUTES } from '../routing.js';
import { askHelp, defaultHelpChain, entryFor, guideIndex, loadGuide, redactSettings, stackSummary } from '../help.js';
import { fitBottom } from './generate-sheet.js';

export const HELP_PAGE = 'help';
const GUIDE = new URL('../../assets/help/', import.meta.url);
const STYLE_ID = 'ri-help-styles';
const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const dot = () => h('span', { class: 'ri-bar-dot', 'aria-hidden': 'true' });

export function loadHelpStyles(doc = globalThis.document) {
    if (!doc?.head || doc.getElementById(STYLE_ID)) return;
    const link = doc.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = new URL('./help.css', import.meta.url).href;
    doc.head.append(link);
}

// ---------------------------------------------------------------- the guide, loaded once

let loading = null;
/** The guide and its search, read once from assets/help/. */
export function guide() {
    loading ||= loadGuide(async file => {
        const response = await globalThis.fetch(new URL(file, GUIDE).href, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`${file}: ${response.status}`);
        return response.text();
    }).then(loaded => ({ ...loaded, index: guideIndex(loaded) }));
    loading.catch(() => { loading = null; });
    return loading;
}

// What the Help page shows: the index, or one entry. A page header's Help link sets the entry before it opens the page.
const view = { doc: '', query: '' };
export function setHelpTarget(pageId) { view.doc = pageId; view.query = ''; }

async function appObject() { return (await import('./panel.js')).app; }

/** Open a menu page, with the control whose label starts with `match` in view, and show the menu full screen. */
async function openControl(page, match = '') {
    const app = await appObject();
    if (!await app.openPage(page, { match, focusPage: true })) return false;
    if (!app.root?.classList.contains('ri-expanded')) await app.setExpanded(true);
    return true;
}

// ---------------------------------------------------------------- the help route chain

/** The routes she can add to the help chain: the named routes, then each saved Connection Profile. */
function routeChoices() {
    const model = route => Object.values(RECOMMENDED_CHAINS).flat().find(entry => entry.route === route) || { route };
    const named = ['desktop', 'nanogpt', 'openrouterFree', 'googleFree', 'openrouter', 'main']
        .map(route => ({ key: route, label: route === 'openrouter' ? 'OpenRouter (paid)' : ROUTES[route].label, entry: { ...model(route), ...(route === 'desktop' ? { timeoutMs: 60000 } : {}) } }));
    const profiles = profileDetails().map(profile => ({ key: `profile:${profile.id}`, label: `Connection Profile: ${profile.name}`, entry: { route: 'profile', profileId: profile.id } }));
    return [...named, ...profiles];
}

export function helpChain() {
    const saved = settings().help?.chain;
    return Array.isArray(saved) && saved.length ? saved.map(entry => ({ ...entry })) : defaultHelpChain(RECOMMENDED_CHAINS);
}

export function setHelpChain(chain) {
    const st = settings();
    st.help ||= {};
    if (chain === null) delete st.help.chain;
    else st.help.chain = chain.map(entry => ({ ...entry }));
    saveSettings();
}

/** How a chain step reads: the route's name, or the saved Connection Profile's name. */
export function stepName(entry) {
    if (entry.profileId) return profileDetails().find(profile => profile.id === String(entry.profileId))?.name || 'A saved Connection Profile';
    return ROUTES[entry.route]?.label || entry.route;
}

function chainEditor(redraw) {
    const chain = helpChain();
    const own = Array.isArray(settings().help?.chain);
    const move = (index, delta) => {
        const next = chain.map(entry => ({ ...entry }));
        [next[index], next[index + delta]] = [next[index + delta], next[index]];
        setHelpChain(next);
        redraw(`[data-help-step="${index + delta}"] [data-move="${delta < 0 ? 'up' : 'down'}"]`);
    };
    const rows = chain.map((entry, index) => h('li', { class: 'ri-help-step', 'data-help-step': String(index), 'data-route': entry.route },
        h('span', { class: 'ri-help-step-name' }, `${index + 1}. ${stepName(entry)}`),
        h('span', { class: 'ri-help-step-actions' },
            h('button', { type: 'button', class: 'ri-btn ri-btn-ghost', 'data-move': 'up', disabled: index === 0, 'aria-label': `Move ${stepName(entry)} up`, onclick: () => move(index, -1) }, 'Up'),
            h('button', { type: 'button', class: 'ri-btn ri-btn-ghost', 'data-move': 'down', disabled: index === chain.length - 1, 'aria-label': `Move ${stepName(entry)} down`, onclick: () => move(index, 1) }, 'Down'),
            h('button', { type: 'button', class: 'ri-btn ri-btn-ghost', 'data-remove': '', disabled: chain.length === 1, 'aria-label': `Remove ${stepName(entry)}`,
                onclick: () => { setHelpChain(chain.filter((_, at) => at !== index)); redraw('[data-help-add]'); } }, 'Remove'))));
    const choices = routeChoices();
    let picked = choices[0]?.key || '';
    const add = select(choices.map(choice => ({ value: choice.key, label: choice.label })), picked, value => { picked = value; }, { 'aria-label': 'Route to add to the help chain', 'data-help-add': '' });
    return h('div', { class: 'ri-help-chain' },
        h('ol', { class: 'ri-help-steps', 'aria-label': 'Routes for help questions, tried in order' }, rows),
        field('Add a route', 'A route joins the end of the list. Each saved Connection Profile is listed by its name.', add),
        h('div', { class: 'ri-row' },
            button('Add', () => { const choice = choices.find(item => item.key === picked); if (choice) { setHelpChain([...chain, choice.entry]); redraw('[data-help-add]'); } }),
            own ? button('Reset to recommended', () => { setHelpChain(null); redraw('[data-help-add]'); }, { kind: 'ghost' }) : null));
}

// ---------------------------------------------------------------- Markdown, drawn as elements

function inline(text, onLink) {
    const out = [];
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((page|help):([\w-]+)(?:#([^)]*))?\)/g;
    let last = 0;
    for (const match of String(text).matchAll(pattern)) {
        if (match.index > last) out.push(String(text).slice(last, match.index));
        if (match[1]) out.push(h('strong', {}, match[1]));
        else if (match[2]) out.push(h('code', {}, match[2]));
        else out.push(h('button', { type: 'button', class: 'ri-help-link', [`data-${match[4]}`]: match[5], onclick: () => onLink(match[5], match[6] || '', match[4]) }, match[3]));
        last = match.index + match[0].length;
    }
    if (last < String(text).length) out.push(String(text).slice(last));
    return out;
}

/** Headings, paragraphs and lists, with bold, code and page links. Nothing is parsed as HTML. */
export function renderMarkdown(markdown, onLink) {
    const nodes = [];
    let list = null;
    let para = [];
    const flush = () => { if (para.length) nodes.push(h('p', {}, inline(para.join(' '), onLink))); para = []; };
    for (const raw of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
        const line = raw.trimEnd();
        const head = /^(#{2,3})\s+(.*)$/.exec(line);
        const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
        if (head) { flush(); list = null; nodes.push(h(head[1].length === 2 ? 'h5' : 'h6', { class: 'ri-help-h' }, inline(head[2], onLink))); continue; }
        if (item) { flush(); if (!list) { list = h('ul', { class: 'ri-help-list' }); nodes.push(list); } list.append(h('li', {}, inline(item[1], onLink))); continue; }
        if (!line.trim()) { flush(); list = null; continue; }
        if (list && /^\s+/.test(raw)) { list.lastChild.append(' ', ...inline(line.trim(), onLink)); continue; }
        list = null;
        para.push(line.trim());
    }
    flush();
    return nodes;
}

// ---------------------------------------------------------------- the page

function controlRow(control, place) {
    return h('li', { class: 'ri-help-control', 'data-control': control.label },
        h('div', { class: 'ri-help-control-head' },
            h('span', { class: 'ri-help-control-label' }, control.label),
            h('span', { class: 'ri-help-control-kind' }, control.kind),
            h('button', { type: 'button', class: 'ri-btn ri-btn-ghost ri-help-show', 'aria-label': `Show ${control.label} in ${place}`, onclick: () => openControl(control.page, control.label) }, 'Show')),
        control.value ? h('p', { class: 'ri-help' }, `Starts as ${control.value}.`) : null,
        control.help ? h('p', { class: 'ri-help' }, control.help) : null);
}

function entryView(g, doc, redraw) {
    // page: links open a menu page (with a control in view after #); help: links open another guide entry here.
    const openLink = (target, match, scheme) => {
        if (scheme === 'help' || target === HELP_PAGE) { view.doc = scheme === 'help' ? target : HELP_PAGE; redraw('[data-help-title]'); return; }
        openControl(target, match);
    };
    const where = doc.place ? h('p', { class: 'ri-help-where' }, icon('fa-location-dot'), ` ${doc.place}`) : null;
    const controls = doc.controls.filter(control => control.kind !== 'section');
    return h('article', { class: 'ri-help-entry', 'data-help-doc': doc.id },
        h('div', { class: 'ri-row' }, button('All guide entries', () => { view.doc = ''; redraw(); }, { kind: 'ghost' }),
            doc.page ? button(`Open ${doc.place.replace(/ › /g, ', ')}`, () => openControl(doc.page)) : null),
        h('h4', { class: 'ri-help-title', tabIndex: -1, 'data-help-title': '' }, doc.title),
        where,
        ...renderMarkdown(doc.markdown.replace(/^# .*\n/, ''), openLink),
        controls.length ? h('h5', { class: 'ri-help-h' }, `Controls on this page (${controls.length})`) : null,
        controls.length ? h('ul', { class: 'ri-help-controls' }, controls.map(control => controlRow(control, doc.place.replace(/ › /g, ', ')))) : null,
        doc.items.length ? h('h5', { class: 'ri-help-h' }, `Listed from the extension (${doc.items.length})`) : null,
        doc.items.length ? h('ul', { class: 'ri-help-controls', 'data-help-items': '' }, doc.items.map(item => h('li', { class: 'ri-help-control', 'data-item': item.label },
            h('div', { class: 'ri-help-control-head' }, h('span', { class: 'ri-help-control-label' }, item.label), h('span', { class: 'ri-help-control-kind' }, item.kind)),
            item.help ? h('p', { class: 'ri-help' }, item.help) : null))) : null);
}

function indexView(g, redraw) {
    const open = id => { view.doc = id; redraw('[data-help-title]'); };
    const tops = [...new Set(g.docs.filter(doc => doc.top).map(doc => doc.top))];
    const item = doc => h('li', {}, h('button', { type: 'button', class: 'ri-help-entry-link', 'data-help-open': doc.id, onclick: () => open(doc.id) },
        h('span', { class: 'ri-help-entry-name' }, doc.title), doc.place ? h('span', { class: 'ri-help-entry-place' }, doc.place) : null));
    return h('div', { class: 'ri-help-index' },
        ...tops.map(top => h('section', {}, h('h5', { class: 'ri-help-h' }, top), h('ul', { class: 'ri-help-entries' }, g.docs.filter(doc => doc.top === top).map(item)))),
        h('section', {}, h('h5', { class: 'ri-help-h' }, 'Features'), h('ul', { class: 'ri-help-entries' }, g.docs.filter(doc => doc.kind === 'feature').map(item))));
}

function resultsView(g, query, redraw) {
    const hits = g.index.search(query, 30);
    const seen = new Set();
    const rows = [];
    for (const hit of hits) {
        const key = hit.control ? `c:${hit.doc.id}:${hit.control.label}` : `d:${hit.doc.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (hit.control) {
            rows.push(h('li', { class: 'ri-help-result', 'data-kind': 'control' },
                h('span', { class: 'ri-help-entry-place' }, hit.doc.place || hit.doc.title),
                h('span', { class: 'ri-help-entry-name' }, hit.control.label),
                h('div', { class: 'ri-row' },
                    button('Show', () => openControl(hit.control.page, hit.control.label)),
                    button('Read the guide', () => { view.doc = hit.doc.id; view.query = ''; redraw('[data-help-title]'); }, { kind: 'ghost' }))));
        } else {
            rows.push(h('li', { class: 'ri-help-result', 'data-kind': 'entry' },
                h('button', { type: 'button', class: 'ri-help-entry-link', 'data-help-open': hit.doc.id, onclick: () => { view.doc = hit.doc.id; view.query = ''; redraw('[data-help-title]'); } },
                    h('span', { class: 'ri-help-entry-name' }, hit.section?.heading ? `${hit.doc.title}, ${hit.section.heading}` : hit.doc.title),
                    hit.doc.place ? h('span', { class: 'ri-help-entry-place' }, hit.doc.place) : null)));
        }
        if (rows.length >= 20) break;
    }
    return h('div', { class: 'ri-help-results' },
        h('p', { class: 'ri-help', role: 'status' }, rows.length ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}.` : 'No match in the guide. Try another word.'),
        h('ul', { class: 'ri-help-entries', 'aria-label': 'Guide search results' }, rows));
}

function renderHelpPage(body, app) {
    loadHelpStyles();
    const host = h('div', { class: 'ri-help-page', id: 'ri-help-page' });
    body.append(host);
    const redraw = focus => draw(focus);
    const content = h('div', { class: 'ri-help-content', 'aria-live': 'polite' });
    const search = h('input', { type: 'search', class: 'ri-input', id: 'ri-help-search', value: view.query, placeholder: 'Search the guide',
        'aria-label': 'Search the guide', autocomplete: 'off', oninput: () => { view.query = search.value; view.doc = ''; fill(); } });
    let guideState = null;
    const fill = () => {
        if (!guideState) { content.replaceChildren(h('p', { class: 'ri-help' }, 'Loading the guide.')); return; }
        if (guideState.error) { content.replaceChildren(h('p', { class: 'ri-note ri-note-warn' }, `The guide did not load: ${guideState.error}`)); return; }
        const doc = view.doc && guideState.byId.get(entryFor(guideState.app, view.doc) || view.doc);
        if (view.query.trim()) content.replaceChildren(resultsView(guideState, view.query.trim(), redraw));
        else content.replaceChildren(doc ? entryView(guideState, doc, redraw) : indexView(guideState, redraw));
    };
    function draw(focus) {
        fill();
        if (focus) requestAnimationFrame(() => host.querySelector(focus)?.focus({ preventScroll: false }));
    }
    const settingsBox = h('div', { class: 'ri-help-settings' });
    const drawSettings = focus => {
        settingsBox.replaceChildren(chainEditor(drawSettings));
        if (focus) requestAnimationFrame(() => settingsBox.querySelector(focus)?.focus());
    };
    drawSettings();
    host.append(
        h('div', { class: 'ri-row ri-help-ask-row' },
            h('button', { type: 'button', class: 'ri-btn ri-btn-primary', 'data-help-ask-open': '', onclick: event => openHelpSheet(event.currentTarget) },
                icon('fa-comments'), ' Ask the help assistant')),
        h('div', { class: 'ri-field ri-help-search-field' }, h('label', { class: 'ri-label', for: 'ri-help-search' }, 'Search the guide'), search),
        content,
        h('details', { class: 'ri-help-settings-fold' }, h('summary', {}, 'Help settings'),
            h('p', { class: 'ri-help' }, 'Each question goes to the first route that answers, in this order.'),
            howItWorks(h('p', {}, 'One question is 1 model call. The desktop model comes first; when it does not answer, the next route takes the question, and a note says which one did. A paid route counts toward your monthly ceiling in Setup, Spend.')),
            settingsBox));
    guide().then(loaded => { guideState = loaded; draw(view.doc ? '[data-help-title]' : ''); }, error => { guideState = { error: String(error?.message || error) }; fill(); });
    fill();
}

// ---------------------------------------------------------------- live state, read only

const helpChat = () => (isChatOpen() ? (chatState().help ||= {}) : null);
export const liveAllowed = () => !!helpChat()?.live;
export function setLiveAllowed(on) {
    const state = helpChat();
    if (!state) return false;
    state.live = !!on;
    saveChatState();
    return true;
}

/** Her settings and the active stack, read now, for a question she allowed it on. Nothing from a chat or a World Info entry. */
export async function liveState() {
    const parts = [];
    try {
        const V = await import('../v10.js');
        parts.push(`Active preset: ${V.activePreset() || 'none'}`, `Features on for this chat: ${JSON.stringify(V.effectiveModules())}`);
    } catch { /* the feature list is optional */ }
    parts.push(`Settings: ${redactSettings(settings())}`);
    try {
        const P = await import('../preset-bank-ri.js');
        parts.push(`Stack:\n${stackSummary(P.riStack())}`);
    } catch { parts.push('Stack: could not be read.'); }
    return parts.join('\n');
}

function latestReply() {
    const chat = ctx().chat || [];
    const message = [...chat].reverse().find(item => !item.is_user && !item.is_system);
    return message ? String(message.mes || '').slice(0, 1500) : '';
}

// ---------------------------------------------------------------- the chat sheet

const transcripts = new Map();
const chatKey = () => String(ctx().chatId || ctx().getCurrentChatId?.() || 'no chat');
let current = null;

/** A note when an earlier route did not answer and a later one did (MB1's fallback note). Names come from her chain. */
export function fallbackNote(attempts = [], chain = []) {
    const name = attempt => (chain[attempt.n - 1] ? stepName(chain[attempt.n - 1]) : attempt.label);
    const answered = attempts.find(item => item.outcome === 'completed');
    const missed = attempts.filter(item => item !== answered && (item.outcome !== 'skipped' || /^down\b/.test(String(item.reason || ''))));
    if (!answered || !missed.length) return '';
    return `${name(missed[0])} did not answer; ${name(answered)} answered on attempt ${answered.n} of ${answered.of}.`;
}

const answeredBy = (result, chain) => {
    const answered = result.attempts?.find(item => item.outcome === 'completed');
    return answered ? (chain[answered.n - 1] ? stepName(chain[answered.n - 1]) : answered.label) : '';
};

// Content words of four letters or more, cut to their first five letters, so "ceiling" meets "ceilings".
const SMALL = new Set('what where which when does have this that with from your into about there they them then than want need make'.split(' '));
const wordsOf = text => new Set((String(text).toLowerCase().match(/[a-z]{4,}/g) || []).filter(word => !SMALL.has(word)).map(word => word.slice(0, 5)));

function answerView(turn) {
    const result = turn.result;
    const body = !result ? h('p', { class: 'ri-help-pending', role: 'status' }, 'Asking.')
        : h('div', { class: 'ri-help-answer-text' }, ...String(result.text || result.reason || 'No answer.').split(/\n{2,}/).map(part => h('p', {}, part.trim())));
    const sources = result?.entries || [];
    // One Show link: the control, among those the search matched, whose label shares the most words with the question.
    const asked = wordsOf(turn.question);
    const best = sources.filter(entry => entry.doc.page).flatMap(entry => entry.controls)
        .map(control => ({ control, shared: [...wordsOf(control.label)].filter(word => asked.has(word)).length }))
        .filter(item => item.shared > 0).sort((a, b) => b.shared - a.shared)[0]?.control;
    const links = best ? [button(`Show ${best.label}`, () => openControl(best.page, best.label), { kind: 'ghost' })] : [];
    const note = result && fallbackNote(result.attempts, turn.chain);
    return h('li', { class: 'ri-help-turn', 'data-help-turn': '', 'data-covered': result ? String(!!result.covered) : '' },
        h('p', { class: 'ri-help-question' }, h('strong', {}, 'You asked: '), turn.question),
        body,
        result && !result.ok && result.called ? h('p', { class: 'ri-note ri-note-warn' }, result.reason || 'No route answered. Check the routes in Setup, Help.') : null,
        note ? h('p', { class: 'ri-help', 'data-help-fallback': '' }, note) : null,
        sources.length ? h('div', { class: 'ri-help-sources', 'data-help-sources': '' },
            h('p', { class: 'ri-help' }, 'From the guide:'),
            h('ul', {}, sources.map(entry => h('li', {}, h('button', { type: 'button', class: 'ri-help-link', 'data-source': entry.doc.id,
                onclick: async () => { setHelpTarget(entry.doc.id); current?.close(); await openControl(HELP_PAGE); } }, entry.doc.place ? `${entry.doc.title} (${entry.doc.place})` : entry.doc.title))))) : null,
        links.length ? h('div', { class: 'ri-row ri-help-links' }, links.slice(0, 2)) : null,
        result?.called ? h('p', { class: 'ri-help ri-help-receipt', 'data-help-receipt': '' }, icon('fa-microchip'), result.ok ? ` 1 model call, answered by ${answeredBy(result, turn.chain)}.` : ' 1 model call, no answer.')
            : result ? h('p', { class: 'ri-help ri-help-receipt' }, 'Answered in code; no model call.') : null);
}

/** Open the help assistant. Opening makes no request; Ask makes one. */
export function openHelpSheet(returnFocus) {
    loadHelpStyles();
    current?.close();
    const doc = globalThis.document;
    const key = chatKey();
    const turns = transcripts.get(key) || [];
    transcripts.set(key, turns);
    const chain = helpChain();
    const first = chain[0] ? stepName(chain[0]) : 'no route';
    const titleId = `ri-help-sheet-${Date.now().toString(36)}`;
    const list = h('ol', { class: 'ri-help-turns', 'aria-live': 'polite' });
    const drawTurns = () => list.replaceChildren(...turns.map(answerView));
    const box = h('textarea', { class: 'ri-gsheet-box ri-help-box', id: `${titleId}-box`, rows: 2, 'aria-label': 'Your question', enterkeyhint: 'send' });
    const chatOpen = isChatOpen();
    const liveSwitch = toggle(liveAllowed(), on => setLiveAllowed(on), 'Let the assistant read this chat’s settings and stack');
    if (!chatOpen) liveSwitch.disabled = true;
    const includeReply = h('input', { type: 'checkbox', id: `${titleId}-reply`, disabled: !chatOpen });
    const status = h('p', { class: 'ri-help', role: 'status' });
    let controller = null;
    const ask = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-help-ask': '', 'aria-label': 'Ask, 1 model call, extra request',
        onclick: () => sheet.ask() }, 'Ask', dot());
    const stop = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', hidden: true, onclick: () => controller?.abort() }, 'Stop');
    const close = h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', 'data-ri-close': '', onclick: () => sheet.close() }, 'Close');
    const element = h('section', { class: 'ri-gsheet ri-help-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-kind': 'help' },
        h('div', { class: 'ri-gsheet-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-gsheet-head' },
            h('div', { class: 'ri-gsheet-titles' }, h('h2', { class: 'ri-gsheet-title', id: titleId, tabIndex: -1 }, 'Help assistant'),
                h('p', { class: 'ri-gsheet-cost', 'data-call': 'extra', 'data-help-cost': '' }, dot(), icon('fa-microchip'), `1 model call · extra request · ${first}`)),
            close),
        h('div', { class: 'ri-gsheet-body' },
            h('p', { class: 'ri-help' }, 'Answers come from the guide and change nothing; each one links to the page where you make the change.'),
            list,
            h('label', { class: 'ri-gsheet-label', for: box.id }, 'Your question'),
            box,
            h('div', { class: 'ri-help-live' }, liveSwitch, h('span', {}, chatOpen ? 'Let the assistant read this chat’s settings and stack' : 'Open a chat to let the assistant read its settings and stack')),
            h('div', { class: 'ri-help-live' }, includeReply, h('label', { for: includeReply.id }, 'Include the latest reply with this question')),
            status,
            h('div', { class: 'ri-gsheet-actions' }, stop, ask)));
    const viewport = globalThis.visualViewport;
    const place = () => {
        const bottom = viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight;
        element.style.setProperty('--ri-room', `${Math.max(160, bottom - (viewport?.offsetTop || 0))}px`);
        fitBottom(element, bottom);
    };
    const keys = event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); sheet.close(); } };
    const sheet = {
        element, box,
        async ask() {
            const question = box.value.trim();
            if (!question || ask.disabled) { if (!question) status.textContent = 'Type a question first.'; return; }
            ask.disabled = true; stop.hidden = false; status.textContent = 'Asking.';
            controller = new AbortController();
            const turn = { question, result: null };
            turns.push(turn);
            drawTurns();
            box.value = '';
            const withReply = includeReply.checked;
            includeReply.checked = false;
            try {
                const g = await guide();
                const steps = helpChain();
                turn.chain = steps;
                turn.result = await askHelp({ question, guide: g, index: g.index, chain: steps, signal: controller.signal,
                    live: liveAllowed() ? await liveState() : '', reply: withReply ? latestReply() : '' });
                status.textContent = turn.result.ok ? (turn.result.covered ? 'Answered.' : 'Answered: the guide does not cover this.') : (turn.result.reason || 'No answer.');
            } catch (error) {
                turn.result = { ok: false, called: false, text: '', reason: `The question could not be asked: ${String(error?.message || error).slice(0, 160)}`, entries: [], attempts: [] };
                status.textContent = turn.result.reason;
            } finally {
                ask.disabled = false; stop.hidden = true; controller = null;
                drawTurns();
                list.lastElementChild?.scrollIntoView({ block: 'nearest' });
            }
        },
        close() {
            if (!element.isConnected) return;
            controller?.abort();
            element.remove();
            doc.removeEventListener('keydown', keys, true);
            viewport?.removeEventListener('resize', place);
            viewport?.removeEventListener('scroll', place);
            if (current === sheet) current = null;
            if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
        },
    };
    box.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sheet.ask(); } });
    doc.body.append(element);
    doc.addEventListener('keydown', keys, true);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    place();
    drawTurns();
    current = sheet;
    element.querySelector('.ri-gsheet-title').focus({ preventScroll: true });
    return sheet;
}

export const helpSheetOpen = () => current;

registerPage({ id: HELP_PAGE, group: 'setup', tab: 'help', label: 'Help', withoutChat: true,
    help: 'The reference guide with search, and a help assistant that answers from it.',
    render: renderHelpPage });
