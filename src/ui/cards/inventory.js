// Inventory (DESIGN 6.2, from Vexa Inventory and Pura's Item Tracker): items per character with a change chip
// (gained, lost, used, broken, given) and a note on where the item came from or why it counts. Capture writes one line
// per item: "Holder: item (gained) | where it came from or why it counts".
import { h } from '../dom.js';
import { foldedValue, row, rows } from '../card-templates.js';
import { headed, icon, itemsOf, partsOf, pick, read, subject, trackerOf } from './shared.js';

export const id = 'inventory';

export const CHANGES = Object.freeze({
    gained: ['Gained', 'fa-plus'], lost: ['Lost', 'fa-minus'], used: ['Used', 'fa-hand'], broken: ['Broken', 'fa-heart-crack'], given: ['Given', 'fa-hand-holding'],
});
const CHANGE_WORDS = [[/gain|got|found|took|receiv|bought|pick/i, 'gained'], [/lost|stolen|dropp|gone/i, 'lost'], [/used|spent|drank|ate|consum/i, 'used'],
    [/broke|broken|shatter|ruin/i, 'broken'], [/gave|given|handed|traded|sold/i, 'given']];

const changeOf = text => (text ? CHANGE_WORDS.find(([pattern]) => pattern.test(text))?.[1] || '' : '');

/** One item: { holder, item, change, note }. */
export function readItem(entry) {
    if (typeof entry === 'object') {
        return { holder: pick(entry, 'holder', 'owner', 'name'), item: pick(entry, 'item', 'text'), change: changeOf(pick(entry, 'change', 'status')), note: pick(entry, 'note', 'why', 'source') };
    }
    const [head, ...rest] = partsOf(entry);
    const [holder, what] = headed(head);
    const bracket = /^(.*?)\s*\(([^)]{2,24})\)\s*$/.exec(what);
    const change = bracket ? changeOf(bracket[2]) : '';
    return { holder, item: (bracket && change ? bracket[1] : what).trim(), change, note: rest.join(' · ') };
}

export function changeMark(change) {
    const [word, mark] = CHANGES[change] || [];
    if (!word) return null;
    return h('span', { class: 'ri-c-change ri-c-item-change', 'data-change': change }, icon(mark), h('span', {}, word));
}

export function render(env, { footer }) {
    if (!env.on('items')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'inventory')?.items, env);
    const items = itemsOf(value).map(readItem).filter(item => item.item);
    if (!items.length) return null;
    const groups = new Map();
    for (const item of items) {
        const key = item.holder || 'Carried';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    const lead = items.find(item => item.change) || items[0];
    const first = `${lead.holder ? `${lead.holder}: ` : ''}${lead.item}${lead.change ? `, ${CHANGES[lead.change][0].toLowerCase()}` : ''}`;
    const detail = item => {
        const parts = [changeMark(item.change), item.note ? h('span', { class: 'ri-c-note' }, foldedValue(item.note)) : null].filter(Boolean);
        return parts.length ? parts : h('span', { class: 'ri-c-note' }, 'Held');
    };
    return { first, body: () => [
        [...groups.entries()].map(([holder, list]) => subject(holder, rows(list.map(item => row(item.item, detail(item)))))),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
