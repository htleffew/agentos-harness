// Menu search (DESIGN.md 3.2): one field that finds pages, sections and single settings, with
// SillyTavern's own words as synonyms. A result opens the page, unfolds its section and focuses the control.
//
// The index has three parts: every page in the tree, the SillyTavern terms below, and the sections and
// settings read from each page's rendered controls (harvest), which the shell records as pages draw.

// SillyTavern words and where each lives in this menu. `land` names a control on the page: `anchor` is a
// selector, `match` the start of a section title or field label.
export const SILLYTAVERN_TERMS = [
    { words:['author’s note','author\'s note','authors note','author note'], label:'Author’s Note',
        targets:[{ page:'writing' }, { page:'sets' }],
        help:'Ongoing guidance sent with each reply lives in Direction, Writing; one-off orders roll from Random sets.' },
    { words:['impersonate','impersonation','write my next message'], label:'Impersonate',
        targets:[{ page:'bridge-bar' }, { page:'v10', match:'Advanced prompts' }],
        help:'Impersonate is a quick action on the bar; its prompt is with the advanced prompts.' },
    { words:['summarize','summary','summaries','story so far'], label:'Summarize',
        targets:[{ page:'world' }, { page:'context' }],
        help:'Chapters and the story so far are written in Story World and reviewed in Context.' },
    { words:['world info','lorebook','lorebooks','lore'], label:'World Info',
        targets:[{ page:'books' }] },
    { words:['pronouns','pronoun'], label:'Pronouns',
        targets:[{ page:'portrayal', match:'Pronouns for' }] },
    { words:['budget','token budget','context size','tokens'], label:'Budget',
        targets:[{ page:'memory', match:'Current state prompt budget' }, { page:'memory', match:'Room for story notes' }] },
    { words:['persona','user persona'], label:'Persona', targets:[{ page:'portrayal', match:'Pronouns for' }] },
    { words:['swipe','regenerate','continue'], label:'Swipe, Regenerate and Continue', targets:[{ page:'bridge-bar' }] },
    { words:['connection profile','connection profiles','api connection','api'], label:'Connection Profile',
        targets:[{ page:'settings', anchor:'#ri-model-request-settings' }] },
    { words:['preset','presets'], label:'Presets', targets:[{ page:'bridge-presets' }] },
    // SillyTavern's prompt manager is the list of prompt blocks; here that list is Setup, Prompts.
    { words:['prompt manager'], label:'Prompt Manager', targets:[{ page:'prompts' }, { page:'bridge-prompts' }],
        help:'Every prompt the extension sends is listed in Setup, Prompts, each editable in place.' },
    { words:['quick reply','quick replies','qr'], label:'Quick Reply', targets:[{ page:'bridge-bar' }, { page:'bridge-library' }] },
    { words:['theme','font size','ui theme'], label:'Theme and sizes', targets:[{ page:'look' }, { page:'display' }] },
    { words:['dice','roll'], label:'Dice', targets:[{ page:'checks' }] },
    { words:['objective','objectives'], label:'Objective', targets:[{ page:'goals' }] },
    { words:['vector storage','vectors','data bank'], label:'Vector Storage and Data Bank', targets:[{ page:'memory' }] },
    { words:['prompt itemization','itemized prompt'], label:'Prompt itemization', targets:[{ page:'sent' }] },
    { words:['chat history','exclude from prompts','hide messages'], label:'Chat history', targets:[{ page:'context' }] },
    { words:['extensions','modules'], label:'Features', targets:[{ page:'v10', anchor:'#ri-modules' }] },
];

const fold = text => String(text ?? '').toLowerCase().replace(/[’‘`]/g,'\'').replace(/\s+/g,' ').trim();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// A word matches at the start of a word in the terms, so "pronoun" finds "Pronouns" and "he" misses "the".
const hasWord = (terms, word) => new RegExp(`(^|[^\\p{L}\\p{N}'])${escape(word)}`,'u').test(terms);
const DATA_PAGES = new Set(['sent', 'log']);
const STOP = new Set(['a','an','the','to','of','for','my','and','in','on','i','how','do']);

/** Split a query into SillyTavern terms it names and the plain words left over. */
export function parseQuery(query) {
    let text = ` ${fold(query)} `;
    const terms = [];
    const phrases = SILLYTAVERN_TERMS.flatMap(term => term.words.map(word => [fold(word), term]))
        .sort((a,b)=>b[0].length-a[0].length);
    for (const [phrase, term] of phrases) {
        const at = text.search(new RegExp(`(^|[^\\p{L}\\p{N}'])${escape(phrase)}(?=$|[^\\p{L}\\p{N}])`,'u'));
        if (at < 0) continue;
        if (!terms.includes(term)) terms.push(term);
        text = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}'])${escape(phrase)}(?=$|[^\\p{L}\\p{N}])`,'u'),'$1 ');
    }
    const words = (text.match(/[\p{L}\p{N}']+/gu) || []).map(word=>word.replace(/^'+|'+$/g,'')).filter(word=>word && !STOP.has(word));
    return { terms, words };
}

/**
 * Entries for every page of a built tree (destinations.buildTree).
 * @returns {{kind:'page', page:string, label:string, path:string, terms:string}[]}
 */
export function pageEntries(tree) {
    return tree.flatMap(top => top.nested.flatMap(nested => nested.pages.filter(page => !page.sub).map((page, index) => ({
        kind:'page', page:page.id, label:index === 0 ? nested.label : page.label,
        path:index === 0 ? `${top.label} › ${nested.label}` : `${top.label} › ${nested.label} › ${page.label}`,
        help:page.help || nested.help || '',
        terms:fold([page.label, nested.label, top.label, page.help, nested.help, page.aliases].join(' ')),
    }))));
}

/** Sections and settings a rendered page offers, read from its controls. */
export function harvest(body, page) {
    if (!body?.querySelectorAll) return [];
    const out = [];
    const seen = new Set();
    const push = (kind, text, extra = {}) => {
        const label = String(text || '').replace(/\s+/g,' ').trim();
        if (!label || label.length > 90 || seen.has(kind + label)) return;
        seen.add(kind + label);
        out.push({ kind, page, label, match:label, ...extra, terms:fold([label, extra.help].join(' ')) });
    };
    // Review pages list replies and requests by their content, which is data and stays out of the index.
    if (!DATA_PAGES.has(page)) for (const node of body.querySelectorAll('.ri-section-title, :scope details > summary, h3')) {
        if (node.closest('[data-ri-shell], .ri-prompt-editor')) continue;
        const text = [...node.childNodes].filter(kid => !kid.classList?.contains('ri-prompt-badge')).map(kid => kid.textContent).join(' ');
        push('section', text);
    }
    for (const node of body.querySelectorAll('.ri-field')) {
        const caption = node.querySelector(':scope > .ri-label');
        const control = node.querySelector('input:not([type="hidden"]), select, textarea, [role="switch"], button');
        push('setting', caption?.textContent, { help:node.querySelector(':scope > .ri-help')?.textContent || '',
            anchor:control?.id ? `#${control.id}` : undefined });
    }
    for (const node of body.querySelectorAll('[role="switch"][aria-label]')) {
        if (node.closest('.ri-field') || node.closest('[data-ri-shell]')) continue;
        push('setting', node.getAttribute('aria-label'), { anchor:node.id ? `#${node.id}` : undefined, focusOnly:true });
    }
    for (const node of body.querySelectorAll('.ri-prompt-editor textarea[aria-label]')) {
        if (node.closest('[data-ri-shell]')) continue;
        const label = node.getAttribute('aria-label');
        push('prompt', label, { anchor:`.ri-prompt-editor textarea[aria-label="${label.replace(/["\\]/g,'\\$&')}"]` });
    }
    // Field ids made by dom.field() change on every draw; keep only ids a page sets itself.
    for (const entry of out) if (entry.anchor?.startsWith('#ri-field-')) delete entry.anchor;
    return out;
}

/**
 * Rank entries for a query. SillyTavern terms put their targets first; plain words must all appear.
 * @param {object[]} entries page entries plus harvested ones
 * @param {string} query
 * @param {(id:string)=>string} pathOf how the navigation names a page, for harvested results
 */
export function searchMenu(entries, query, pathOf = id => id) {
    const { terms, words } = parseQuery(query);
    if (!terms.length && !words.length) return [];
    const results = [];
    const key = item => `${item.page}|${item.anchor || ''}|${item.match || ''}|${item.kind}`;
    const seen = new Set();
    const add = (item, score) => {
        const id = key(item);
        if (seen.has(id)) return;
        seen.add(id);
        results.push({ ...item, score });
    };
    for (const term of terms) for (const target of term.targets) {
        const page = entries.find(item => item.kind === 'page' && item.page === target.page);
        if (!page) continue;
        const setting = target.match && entries.find(item => item.kind !== 'page' && item.page === target.page && fold(item.label).startsWith(fold(target.match)));
        add({ ...(setting || page), kind:target.match || target.anchor ? 'setting' : 'page',
            label:setting?.label || (target.match ? target.match : page.label),
            path:target.match || target.anchor ? pathOf(target.page) : page.path,
            anchor:target.anchor || setting?.anchor, match:target.match ? (setting?.label || target.match) : undefined,
            synonym:term.label, help:term.help || page.help }, words.length ? 100 : 300);
    }
    // Plain matching also reads every word of the query, so "Dice guidance" finds that prompt by its own name.
    const all = (fold(query).match(/[\p{L}\p{N}']+/gu) || []).map(word => word.replace(/^'+|'+$/g,'')).filter(word => word && !STOP.has(word));
    const whole = fold(query);
    for (const plain of [words, all]) if (plain.length) for (const item of entries) {
        if (!plain.every(word => hasWord(item.terms, word))) continue;
        const name = fold(item.label);
        const score = (name.startsWith(whole) ? 200 : 0) + plain.filter(word => hasWord(name, word)).length * 3
            + (item.kind === 'page' ? 2 : item.kind === 'section' ? 1 : 0);
        add({ ...item, path:item.path || pathOf(item.page) }, score);
    }
    return results.sort((a,b)=>b.score-a.score).slice(0, 30);
}
