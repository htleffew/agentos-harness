// The menu tree of DESIGN.md 3.1: five top tabs, each with its nested tabs, and the pages that sit in them.
// The shell in panel.js and the search in menu-search.js read this one list.
export const taskLabels = {
    alternate:'Swipe',
    generateAlternate:'Swipe',
    continue:'Continue',
    corrections:'Correct story facts',
    review:'Review this reply',
    browse:'Browse directions',
    manage:'Manage quick actions',
};

// Top tabs with their family color (DESIGN.md 1.2) and nested tabs with their icons (1.7).
export const tabs = [
    { id:'story', label:'Story', short:'Story', family:'story', icon:'fa-book-open', nested:[
        { id:'scene', label:'Scene', icon:'fa-location-dot', help:'The scene of this chat, its opening and the facts you correct.' },
        { id:'characters', label:'Characters', icon:'fa-masks-theater', help:'How each character is portrayed, what they feel and how their dialogue looks.' },
        { id:'story-world', label:'Story World', icon:'fa-globe', help:'The lasting records of this story and the story so far.' },
        { id:'world-info', label:'World Info', icon:'fa-book', help:'World Info books for this chat and the books every chat can use.' },
    ] },
    { id:'direction', label:'Direction', short:'Direction', family:'direction', icon:'fa-compass', nested:[
        { id:'random-sets', label:'Random sets', icon:'fa-dice', help:'Instruction, event and writing style sets that roll for each reply.' },
        { id:'goal', label:'Goal', icon:'fa-bullseye', help:'A goal a character works toward, step by step.' },
        { id:'writing', label:'Writing', icon:'fa-pen-nib', help:'Guidance for how replies are written and what screening checks.' },
    ] },
    { id:'quick', label:'Quick actions', short:'Quick', family:'reply', icon:'fa-bolt', nested:[
        { id:'bar', label:'Bar', icon:'fa-bars-staggered', help:'The quick actions pinned on the bar above the message box.' },
        { id:'library', label:'Library', icon:'fa-layer-group', help:'Every saved quick action, by kind.' },
    ] },
    { id:'review', label:'Review', short:'Review', family:'review', icon:'fa-magnifying-glass', nested:[
        { id:'replies', label:'Replies', icon:'fa-receipt', help:'What was sent with each reply and why.' },
        { id:'context', label:'Context', icon:'fa-brain', help:'What this chat sends now and how much room it takes.' },
        { id:'request-log', label:'Request log', icon:'fa-clock-rotate-left', help:'Every request the extension made and how it ended.' },
    ] },
    { id:'setup', label:'Setup', short:'Setup', family:'setup', icon:'fa-sliders', nested:[
        { id:'features', label:'Features', icon:'fa-toggle-on', help:'Turn each feature on or off for this chat or preset.' },
        { id:'presets', label:'Presets', icon:'fa-puzzle-piece', help:'The active preset and which side supplies each feature.' },
        { id:'memory', label:'Memory', icon:'fa-database', help:'How story memory is kept, recalled and budgeted.' },
        { id:'connections', label:'Connections', icon:'fa-plug', help:'Which connection each job uses and what the extension may do on its own.' },
        { id:'look', label:'Look', icon:'fa-palette', help:'Sizes, reply tray display and the look of the menu.' },
        { id:'prompts', label:'Prompts', icon:'fa-terminal', help:'Every prompt the extension sends, in one list.' },
        { id:'help', label:'Help', icon:'fa-circle-question', help:'The reference guide, and a help assistant that answers from it.' },
    ] },
];

// Pages, in nested-tab order. A nested tab with several pages shows them as a row of sections until
// B6 merges them. A bridge stands in for a nested tab whose page another ticket builds, and links to
// where its settings live today; a registered page with the nested tab's name replaces it.
const PAGES = [
    { id:'state', tab:'scene', label:'Current scene', help:'Review the active scene and character state.' },
    { id:'opening', tab:'scene', label:'First message', help:'Choose a greeting or prepare a first message. It comes first while the chat holds only its first message.', aliases:'first message greeting' },
    { id:'corrections', tab:'scene', label:'Correct story facts', help:'Find, correct or undo a story fact.', aliases:'fix a fact correct source repair wrong facts' },
    { id:'portrayal', tab:'characters', label:'Portrayal & knowledge', help:'Pronouns, character portrayal and who knows a fact.', aliases:'persona character card npc pronouns' },
    { id:'emotion', tab:'characters', label:'Emotions & relationships', help:'Review a character or relationship pair.' },
    { id:'speakers', tab:'characters', label:'Dialogue colors', help:'Review or change speaker colors.' },
    { id:'world', tab:'story-world', label:'Story World', help:'The lasting records of this chat, its entries by kind and the story so far.', aliases:'story record storage world info source book story so far chapter new chapter continue in a new chat' },
    // Facts and Plot are filters of Story World (UI design 3.5); their ids open it with the filter set (src/ui/story-world.js).
    { id:'facts', tab:'story-world', sub:true, label:'Facts', help:'The Facts filter of Story World.', aliases:'chat facts edit fact provenance source' },
    { id:'plots', tab:'story-world', sub:true, label:'Plot', help:'The Plot filter of Story World.', aliases:'plot records arcs threads planted details agendas events' },
    { id:'books', tab:'world-info', label:'World Info books', help:'Assign books to the chat or edit their entries.', aliases:'lorebook world info import source' },
    { id:'sets', tab:'random-sets', label:'All sets', help:'Every instruction, story event and writing style set in one list.', aliases:'random instructions random story events random writing style add set' },
    // The three editors open from the list of sets. They are pages of their own so each keeps its route state, and they stay out of the sections row.
    { id:'instructions', tab:'random-sets', sub:true, label:'Random instructions', help:'Manage instruction sets, triggers and versions.' },
    { id:'events', tab:'random-sets', sub:true, label:'Random story events', help:'Manage event sets, eligibility and rolls.' },
    { id:'style', tab:'random-sets', sub:true, label:'Random writing style', help:'Manage writing categories and wording.' },
    { id:'goals', tab:'goal', label:'Character goals', help:'Set a goal and order its steps.', aliases:'objective' },
    { id:'writing', tab:'writing', label:'Writing guidance', help:'Edit ongoing guidance and reply screening, including new NPC names to avoid.', aliases:'writing review diagnostics prose npc names avoid stock phrases' },
    { id:'bridge-bar', tab:'bar', label:'Bar', withoutChat:true, aliases:'pins composer toolbar',
        bridge:{ page:'v10', anchor:'#ri-composer-settings', text:'The bar’s pins are set in Setup, Features, Quick action bar until this page is built.' } },
    { id:'bridge-library', tab:'library', label:'Library', withoutChat:true, aliases:'manage quick actions saved actions',
        bridge:{ page:'v10', anchor:'#ri-composer-library', text:'The library opens from Setup, Features, Quick action bar until this page is built.' } },
    { id:'sent', tab:'replies', label:'What was sent', help:'Inspect a reply’s directions, sources and execution.', aliases:'receipt review reply notes swipe alternate version' },
    { id:'context', tab:'context', label:'Context & memory', help:'What this chat sends now, memory filing status and the next reply preview.', aliases:'summary recall history filing next reply preview token' },
    { id:'log', tab:'request-log', label:'Request log', help:'Inspect request outcomes or export the log.', withoutChat:true },
    { id:'v10', tab:'features', label:'Features', help:'Turn each feature on or off and edit the Roast voice.', aliases:'preset prompt impersonation modules extensions workflow roast reply plan version', withoutChat:true },
    { id:'bridge-presets', tab:'presets', label:'Presets', withoutChat:true,
        bridge:{ page:'v10', match:'Active preset', text:'The active preset is shown in Setup, Features until this page is built.' } },
    { id:'bridge-memory', tab:'memory', label:'Memory', withoutChat:true, aliases:'budget recall',
        bridge:{ page:'memory', anchor:'#ri-memory-settings', text:'Memory settings sit in Setup, Memory.' } },
    { id:'settings', tab:'connections', label:'Connections', help:'Which connection each job uses and what the AI writes for you.', aliases:'connection profile provider request automation more room writer rules word list', withoutChat:true },
    { id:'display', tab:'look', label:'Reply display', help:'Choose which reply cards and commentator voice appear.', aliases:'roast commentator notes card visual tray' },
    // B58: src/ui/help.js draws this page through the registry; it is listed here so the tab has its page in every tree.
    { id:'help', tab:'help', label:'Help', help:'The reference guide with search, and a help assistant that answers from it.', aliases:'help guide reference manual assistant question how where explain documentation', withoutChat:true },
    { id:'bridge-prompts', tab:'prompts', label:'Prompts', withoutChat:true, aliases:'prompt manager instructions',
        bridge:{ page:'v10', anchor:'#ri-planning-prompts', text:'Each page lists its own prompts at its foot. The advanced prompts sit in Setup, Features until this page is built.' } },
];

const nestedIndex = new Map(tabs.flatMap(top => top.nested.map(nested => [nested.id, { ...nested, top:top.id }])));
export const nestedTab = id => nestedIndex.get(id) || null;
export const topTab = id => tabs.find(top => top.id === id) || null;
const topOf = nestedId => nestedIndex.get(nestedId)?.top;

const decorate = page => {
    const top = topTab(topOf(page.tab));
    return { ...page, group:top.id, section:top.label, subgroup:nestedTab(page.tab).label };
};
export const pages = PAGES.map(decorate);

// Hints from the running app that the static list cannot know. panel code sets them once.
const hints = { openingFirst: () => false };
export const setTreeHints = next => Object.assign(hints, next);

// The registry wrapper in page-registry.js reads groups: one per top tab.
export const groups = tabs.map(top => ({ id:top.id, label:top.label, accent:top.family,
    pages:pages.filter(page => page.group === top.id) }));

// Names other tickets may use for a top tab when they register a page.
const GROUP_ALIASES = { characters:'story', quick:'quick', 'quick-actions':'quick', quickactions:'quick', quick_actions:'quick',
    reply:'quick', bar:'quick', settings:'setup' };
export const normalizeGroup = id => {
    const key = String(id ?? '').toLowerCase();
    return tabs.some(top => top.id === key) ? key : GROUP_ALIASES[key] || key || undefined;
};

const slug = value => String(value ?? '').toLowerCase().replace(/&/g,'and').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'');

/**
 * Place a registered page (src/ui/page-registry.js) in the tree. A page names its nested tab with `tab`;
 * failing that, its id, subgroup or label is matched against the nested tabs of its top tab. A page that
 * matches none gets a nested tab of its own at the end of its top tab, so it is never lost.
 */
export function placeRegistered(entry) {
    const topId = normalizeGroup(entry.group);
    const top = topTab(topId) || topTab('setup');
    const wanted = [entry.tab, entry.id, entry.subgroup, entry.label].map(slug).filter(Boolean);
    const nested = top.nested.find(item => wanted.includes(item.id) || wanted.includes(slug(item.label)));
    const names = nested && [nested.id, slug(nested.label)];
    const leads = !!nested && [entry.id, entry.label].map(slug).some(name => names.includes(name));
    return { top:top.id, tab:nested?.id || `registered-${slug(entry.id)}`, leads,
        extraTab:nested ? null : { id:`registered-${slug(entry.id)}`, label:entry.label, icon:entry.icon || 'fa-file-lines', help:entry.help || '', top:top.id } };
}

/**
 * The tree with registered pages placed: each top tab's nested tabs, each nested tab's pages in order.
 * A registered page that leads a nested tab comes first there and replaces that tab's bridge.
 */
export function buildTree(registered = []) {
    const extra = new Map();
    const placed = registered.map(entry => {
        const place = placeRegistered(entry);
        if (place.extraTab && !extra.has(place.extraTab.id)) extra.set(place.extraTab.id, place.extraTab);
        return { ...entry, group:place.top, section:topTab(place.top).label, tab:place.tab, leads:place.leads, registered:true };
    });
    const registeredIds = new Set(placed.map(page => page.id));
    return tabs.map(top => {
        const nested = [...top.nested, ...[...extra.values()].filter(item => item.top === top.id)].map(item => {
            const own = placed.filter(page => page.tab === item.id);
            const base = pages.filter(page => page.tab === item.id && !registeredIds.has(page.id));
            const leading = own.filter(page => page.leads);
            const rest = own.filter(page => !page.leads).sort((a,b)=>(a.order ?? 999)-(b.order ?? 999));
            let list = [...leading, ...base, ...rest];
            if (own.length) list = list.filter(page => !page.bridge);
            if (item.id === 'scene' && hints.openingFirst()) list = [...list.filter(page => page.id === 'opening'), ...list.filter(page => page.id !== 'opening')];
            return { ...item, top:top.id, pages:list.map(page => ({ ...page, subgroup:item.label })) };
        });
        return { ...top, nested };
    });
}

/** Find a page in a built tree; returns {top, nested, page} or null. */
export function locate(tree, id) {
    for (const top of tree) for (const nested of top.nested) {
        const page = nested.pages.find(item => item.id === id);
        if (page) return { top, nested, page };
    }
    return null;
}

export const destination = id => pages.find(page=>page.id===id);
export const startingPage = hasChat => hasChat ? 'state' : 'v10';

/** How the navigation names a page ("Setup, Prompts"; a section of a shared nested tab adds its own name). */
export function pathName(tree, id) {
    const found = locate(tree, id);
    if (!found) return '';
    const { top, nested, page } = found;
    return nested.pages.length > 1 && nested.pages[0].id !== page.id && !page.sub
        ? `${nested.label}, ${page.label}` : `${top.label}, ${nested.label}`;
}

// groups, destination and findDestinations form the navigation interface page-registry.registryView wraps.
export function findDestinations(query) {
    const words = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word=>!['a','an','the'].includes(word)) || [];
    if (!words.length) return [];
    return pages.filter(page=>!page.bridge).flatMap(page=>{
        const name = page.label.toLowerCase();
        const terms = [name,page.section,page.subgroup,page.help,page.aliases].join(' ').toLowerCase();
        if (!words.every(word=>terms.includes(word))) return [];
        const score = words.filter(word=>name.includes(word)).length;
        return [{page,score}];
    }).sort((a,b)=>b.score-a.score).map(({page})=>page);
}
