// B58: the reference guide and the help assistant's request. Everything here except askHelp runs in code with no host
// state, so tests/t_help.js runs it in node: loading and parsing the guide, the word search over it (MB4's MiniSearch
// index), and the request the assistant sends.
//
// The guide ships in assets/help/: one hand-written Markdown file per menu page (pages/<id>.md) and per feature
// (features/<id>.md), an index, and generated/app.json, which tests/t_help_host.js writes from the running extension:
// the menu tree, every section, setting and prompt each page draws (label, help text, starting value), the card catalog,
// the quick action kinds and built-ins, the background jobs and the prompt list. The Help page draws a page's "Where it is"
// line and its Controls list from app.json, so the guide lists every control the code draws.
//
// One question sends one request on the help route chain (Setup, Help), on her tap. Search, ranking, sources, links and
// the coverage checks stay in code. A question no guide page matches is answered here with no request.
import { createWordIndex } from './memory/search.js';

/** The features with a guide file of their own, in the order the index lists them. */
export const FEATURES = Object.freeze([
    { id: 'getting-around', title: 'Getting around the menu' },
    { id: 'model-calls', title: 'Model calls, routes and cost' },
    { id: 'reply-cards', title: 'Reply tray cards' },
    { id: 'quick-actions', title: 'Quick actions' },
    { id: 'jobs', title: 'Background jobs' },
    { id: 'prompt-list', title: 'Prompts' },
    { id: 'glossary', title: 'Words this guide uses' },
    { id: 'help-assistant', title: 'The help assistant' },
]);

/** The sentence an answer starts with when the guide pages leave the question open. Code reads it to mark the answer. */
export const NOT_COVERED = 'The guide does not cover this.';

/** The fixed part of every help request. It stays the same for every question, so a route that caches a prefix reuses it. */
export const HELP_SYSTEM = [
    'You are the help assistant inside Roleplay Instructions, an extension for SillyTavern. You answer questions about how the extension works and where each of its controls lives.',
    'Answer from the guide pages in the message. Each page starts with its title and the place it holds in the extension menu, written as the menu names it, for example "Setup, Connections".',
    'When the pages answer the question, give the answer in two to five plain sentences and name the menu place of the control involved.',
    `When the pages leave the question open, start the answer with "${NOT_COVERED}" and then name the closest page, if one is close.`,
    'She makes every change herself. Describe the steps she takes and leave her settings as they are.',
    'When the message carries her live settings and stack, read them to explain what her own setup does.',
    'Write plain sentences in English, with no headings and no tables.',
].join('\n');

const fold = text => String(text ?? '').toLowerCase().replace(/[’‘`]/g, '\'').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- reading the guide

/**
 * Split one guide file into its title and sections. Headings start sections; a section keeps its own text as written.
 * @returns {{title:string, intro:string, sections:{heading:string, level:number, text:string}[]}}
 */
export function parseGuide(markdown) {
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let title = '';
    const sections = [];
    let current = { heading: '', level: 1, lines: [] };
    for (const line of lines) {
        const head = /^(#{1,3})\s+(.*)$/.exec(line);
        if (head && head[1].length === 1 && !title) { title = head[2].trim(); continue; }
        if (head) {
            sections.push(current);
            current = { heading: head[2].replace(/\*\*/g, '').trim(), level: head[1].length, lines: [] };
            continue;
        }
        current.lines.push(line);
    }
    sections.push(current);
    const out = sections.map(section => ({ heading: section.heading, level: section.level, text: section.lines.join('\n').trim() }))
        .filter(section => section.heading || section.text);
    const intro = out[0] && !out[0].heading ? out.shift().text : '';
    return { title, intro, sections: out };
}

/** Markdown down to the words a person reads, for search and for the request. */
export function plainText(markdown) {
    return String(markdown || '').replace(/\[([^\]]+)\]\((page|help):[^)]*\)/g, '$1').replace(/\*\*|`/g, '').replace(/^#+\s*/gm, '').trim();
}

const CALL_WORDS = { extra: '1 model call, extra request', reply: 'SillyTavern’s reply request', code: 'runs in code' };

/** The lists a feature entry draws from app.json, so it names every card, quick action, job and prompt the code has. */
export function catalogFor(app, featureId) {
    if (featureId === 'reply-cards') return (app.cards || []).map(card => ({ kind: 'card', label: card.label, help: card.effect }));
    if (featureId === 'quick-actions') {
        return [...(app.quickActionKinds || []).map(kind => ({ kind: 'kind', label: kind.name, help: CALL_WORDS[kind.call] || '' })),
            ...(app.builtinQuickActions || []).map(action => ({ kind: 'built-in', label: action.title, help: (app.quickActionKinds || []).find(kind => kind.kind === action.kind)?.name || '' }))];
    }
    if (featureId === 'jobs') {
        return (app.jobs || []).map(job => ({ kind: 'job', label: job.label,
            help: `${job.tier.charAt(0).toUpperCase()}${job.tier.slice(1)} tier${job.follows ? `; uses the routes of ${(app.jobs.find(item => item.id === job.follows) || {}).label || job.follows}` : ''}` }));
    }
    if (featureId === 'prompt-list') return (app.prompts || []).map(prompt => ({ kind: 'prompt', label: prompt.label, help: '' }));
    return [];
}

/** The page a page id's guide entry lives on: its own file, else the lead page of its nested tab. */
export function entryFor(app, pageId) {
    const page = app?.pages?.find(item => item.id === pageId);
    if (!page) return null;
    if (!page.sub) return page.id;
    return app.pages.find(item => item.nested === page.nested && item.top === page.top && !item.sub)?.id || null;
}

/** The menu place of a page, as the menu names it: "Setup › Connections › Spend". */
export function placeOf(app, pageId) {
    const page = app?.pages?.find(item => item.id === pageId);
    if (!page) return '';
    return page.label === page.nested || page.lead ? `${page.top} › ${page.nested}` : `${page.top} › ${page.nested} › ${page.label}`;
}

/**
 * Load the guide: app.json, then one file per page that has its own entry and one per feature.
 * @param {(path:string)=>Promise<string>} read reads a file under assets/help/ as text
 */
export async function loadGuide(read) {
    const app = JSON.parse(await read('generated/app.json'));
    const pages = app.pages.filter(page => !page.sub);
    const files = [...pages.map(page => ({ id: page.id, kind: 'page', path: `pages/${page.id}.md` })),
        ...FEATURES.map(feature => ({ id: feature.id, kind: 'feature', path: `features/${feature.id}.md` }))];
    const texts = await Promise.all(files.map(file => read(file.path).catch(() => '')));
    const docs = files.map((file, index) => {
        const parsed = parseGuide(texts[index]);
        const page = file.kind === 'page' ? app.pages.find(item => item.id === file.id) : null;
        const subs = page ? app.pages.filter(item => item.sub && item.nested === page.nested && item.top === page.top).map(item => item.id) : [];
        return {
            id: file.id, kind: file.kind, path: file.path, markdown: texts[index], missing: !texts[index],
            title: parsed.title || page?.label || FEATURES.find(item => item.id === file.id)?.title || file.id,
            place: page ? placeOf(app, page.id) : '', page: page?.id || null, top: page?.top || '',
            intro: parsed.intro, sections: parsed.sections,
            controls: page ? [page.id, ...subs].flatMap(id => (app.controls[id] || []).map(control => ({ ...control, page: id }))) : [],
            items: file.kind === 'feature' ? catalogFor(app, file.id) : [],
        };
    });
    return { app, docs, byId: new Map(docs.map(doc => [doc.id, doc])) };
}

// ---------------------------------------------------------------- search

/**
 * The word search over the guide: one unit per section of each entry and one per control. Returns a search function
 * whose hits carry the entry, the section or control, and the score. A control whose label starts with the query comes
 * first, so typing a control's label finds that control.
 */
export function guideIndex(guide) {
    const words = createWordIndex();
    const units = new Map();
    for (const doc of guide.docs) {
        const head = `${doc.title} ${doc.place}`;
        const add = (id, text, unit) => { units.set(id, unit); words.add({ id, text }); };
        add(`${doc.id}#0`, `${head} ${plainText(doc.intro)}`, { doc, section: null });
        doc.sections.forEach((section, index) => add(`${doc.id}#${index + 1}`, `${head} ${section.heading} ${plainText(section.text)}`, { doc, section }));
        doc.controls.forEach((control, index) => add(`${doc.id}@${index}`, `${control.label} ${control.label} ${control.help || ''} ${doc.title}`, { doc, control }));
        doc.items.forEach((item, index) => add(`${doc.id}!${index}`, `${item.label} ${item.label} ${item.help || ''} ${doc.title}`, { doc, section: { heading: item.label, level: 3, text: item.help || '' } }));
    }
    return {
        size: () => units.size,
        search(query, limit = 20) {
            const whole = fold(query);
            if (!whole) return [];
            const ranked = words.search(query, 200).map(hit => ({ ...units.get(hit.id), score: hit.score }));
            for (const doc of guide.docs) for (const control of doc.controls) {
                if (fold(control.label).startsWith(whole) && !ranked.some(hit => hit.control === control)) ranked.push({ doc, control, score: 0 });
            }
            const exact = hit => (hit.control && fold(hit.control.label).startsWith(whole) ? 2 : 0) + (fold(hit.doc.title) === whole ? 1 : 0);
            return ranked.sort((a, b) => exact(b) - exact(a) || b.score - a.score).slice(0, limit);
        },
    };
}

/** The entries a question ranks highest, each once, best first. */
export function rankEntries(index, question, count = 3) {
    const out = [];
    for (const hit of index.search(question, 60)) {
        let entry = out.find(item => item.doc === hit.doc);
        if (!entry) { if (out.length >= count) continue; entry = { doc: hit.doc, score: hit.score, controls: [], sections: [] }; out.push(entry); }
        if (hit.control && entry.controls.length < 3) entry.controls.push(hit.control);
        if (hit.section && entry.sections.length < 3) entry.sections.push(hit.section);
    }
    return out;
}

// ---------------------------------------------------------------- the request

/** One guide entry as the request carries it: title and menu place first, then its text, cut to fit. */
export function entryText(doc, max = 3600) {
    const head = `${doc.title}${doc.place ? ` (menu place: ${doc.place.replace(/ › /g, ', ')})` : ' (a feature of the extension)'}`;
    const body = plainText([doc.intro, ...doc.sections.map(section => `${section.heading}\n${section.text}`)].join('\n\n'));
    const controls = doc.controls.filter(control => control.kind === 'setting').slice(0, 40)
        .map(control => `- ${control.label}${control.value ? ` (starts as ${control.value})` : ''}${control.help ? `: ${control.help}` : ''}`).join('\n');
    const items = doc.items.map(item => `- ${item.label}${item.help ? `: ${item.help}` : ''}`).join('\n');
    const text = `${body}${controls ? `\n\nSettings on this page:\n${controls}` : ''}${items ? `\n\nListed from the extension:\n${items}` : ''}`;
    return `${head}\n${text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')} [cut]` : text}`;
}

/**
 * The request for one question. The fixed system part comes first and stays the same for every question; the guide
 * entries the search ranked come next, then the live state when she allowed it, then the question last.
 * @returns {{system:string, user:string, sources:string[]}}
 */
export function helpRequest({ question, entries, live = '', reply = '' }) {
    const parts = [`Guide pages:\n\n${entries.map(entry => entryText(entry.doc)).join('\n\n---\n\n')}`];
    if (live) parts.push(`Her live settings and stack, read now:\n${live}`);
    if (reply) parts.push(`The latest reply in her chat, which she chose to include:\n${reply}`);
    parts.push(`Question: ${String(question).trim()}`);
    return { system: HELP_SYSTEM, user: parts.join('\n\n'), sources: entries.map(entry => entry.doc.id) };
}

/** Whether an answer says the guide does not cover the question. */
export const saysNotCovered = text => fold(text).includes(fold(NOT_COVERED)) || /\bguide does not (cover|say|mention)\b/i.test(String(text || ''));

// ---------------------------------------------------------------- live state

const SECRET = /key|token|secret|password|auth|cookie/i;
// Saved text that comes from her chats, never sent with live state: drafts, caches and logs kept in the settings.
const CHAT_TEXT = /draft|cache|history|^logs?$|Logs?$|recent|lastReply|lastMessage|results/i;

/** Her settings with keys, tokens and any chat text left out and long text cut, as compact JSON. */
export function redactSettings(value, max = 7000) {
    const seen = new WeakSet();
    const text = JSON.stringify(value, (key, item) => {
        if (key && (SECRET.test(key) || CHAT_TEXT.test(key))) return undefined;
        if (typeof item === 'string') return item.length > 160 ? `${item.slice(0, 157)}...` : item;
        if (item && typeof item === 'object') { if (seen.has(item)) return undefined; seen.add(item); }
        return item;
    });
    return text && text.length > max ? `${text.slice(0, max)} [cut]` : text || '{}';
}

/** The active stack as names and switches only: the base preset and each block with its side and on or off. */
export function stackSummary(stack) {
    if (!stack) return 'No stack: no preset is selected.';
    const row = card => `${card.on ? 'on' : 'off'}  ${card.name || card.id}${card.source ? ` (${card.source})` : ''}${card.role ? `, ${card.role}` : ''}`;
    return [`Base preset: ${stack.base}`, ...(stack.cards || []).map(row), ...(stack.ri || []).map(card => `${row(card)}, Roleplay Instructions`)].join('\n');
}

// ---------------------------------------------------------------- the route

/** The help chain she starts with: the desktop model, then the free routes of MB1's capture chain. */
export function defaultHelpChain(recommended) {
    const free = new Set(['nanogpt', 'openrouterFree', 'googleFree']);
    return (recommended?.capture || []).filter(entry => entry.route === 'desktop' || free.has(entry.route))
        .map(entry => (entry.route === 'desktop' ? { ...entry, timeoutMs: 60000 } : { ...entry }));
}

/**
 * Ask one question. Ranks the guide, builds the request and sends it once through the help chain (routing.runChain,
 * which tries each route in order). A question no entry matches gets the not-covered answer with no request.
 * Paid routes count toward the monthly ceiling, as background calls do.
 */
export async function askHelp({ question, guide, index, chain, live = '', reply = '', signal, onAttempt, run }) {
    const entries = rankEntries(index, question);
    if (!entries.length) return { ok: true, called: false, covered: false, text: `${NOT_COVERED} No guide page matches these words.`, sources: [], entries, attempts: [] };
    const request = helpRequest({ question, entries, live, reply });
    const runChain = run || (await import('./routing.js')).runChain;
    const result = await runChain(chain, { job: 'help', label: 'Help question', system: request.system, user: request.user, tokens: 700,
        signal, background: true, onAttempt });
    return { ...result, called: true, covered: result.ok && !saysNotCovered(result.text), sources: request.sources, entries, request };
}
