// Pages built in parallel register here, so their tickets leave the panel file alone (DESIGN.md 11.2).
// Today's panel and B5's menu shell read the same registry through registryView().
const pages = new Map();
const views = [];

const required = ['id', 'group', 'label', 'render'];

/**
 * Register a page module.
 * @param {{id:string, group:string, label:string, render:(body:HTMLElement, app:object)=>void,
 *   help?:string, subgroup?:string, aliases?:string, withoutChat?:boolean, order?:number}} page
 */
export function registerPage(page) {
    for (const key of required) if (!page?.[key]) throw new Error(`A registered page needs ${key}.`);
    if (typeof page.render !== 'function') throw new Error('A registered page needs a render function.');
    const entry = { help: '', ...page };
    const replacing = pages.has(entry.id);
    pages.set(entry.id, entry);
    for (const view of views) place(view, entry, replacing);
    return () => unregisterPage(entry.id);
}

export function unregisterPage(id) {
    if (!pages.delete(id)) return false;
    for (const view of views) for (const group of view.groups) group.pages = group.pages.filter(page => page.id !== id);
    return true;
}

export const registeredPage = id => pages.get(id) || null;
export const registeredPages = () => [...pages.values()];

function place(view, entry, replacing) {
    const group = view.groups.find(item => item.id === entry.group);
    if (!group) return;
    if (replacing) group.pages = group.pages.filter(page => page.id !== entry.id);
    const at = Number.isFinite(entry.order) ? Math.min(entry.order, group.pages.length) : group.pages.length;
    group.pages.splice(at, 0, entry);
}

/**
 * Wrap a navigation source (today's destinations.js, later B5's shell) so registered pages
 * appear in its groups, resolve as destinations and turn up in Find a tool.
 */
export function registryView({ destination, findDestinations, groups }) {
    const view = { groups: groups.map(group => ({ ...group, pages: [...group.pages] })) };
    views.push(view);
    for (const entry of pages.values()) place(view, entry, false);
    const section = id => view.groups.find(group => group.id === id)?.label || '';
    return {
        groups: view.groups,
        destination(id) {
            const entry = pages.get(id);
            return entry ? { ...entry, section: section(entry.group) } : destination(id);
        },
        findDestinations(query) {
            const words = String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
            const extra = words.length ? registeredPages().filter(entry => {
                const terms = [entry.label, entry.help, entry.subgroup, entry.aliases, section(entry.group)].join(' ').toLowerCase();
                return words.every(word => terms.includes(word));
            }).map(entry => ({ ...entry, section: section(entry.group) })) : [];
            return [...extra, ...findDestinations(query)];
        },
    };
}

/** Render a registered page into the panel body. Returns false when the id is not registered. */
export function renderRegistered(id, body, app) {
    const entry = pages.get(id);
    if (!entry) return false;
    entry.render(body, app);
    return true;
}
