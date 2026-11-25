// Knowledge and secrets (DESIGN 6.2): one card for the four knowledge trackers (Vexa Memory, Deus Hidden Truths,
// Pura Secrets Tracker and our Knowledge). "Who knows what" comes from the saved knowledge records (reply-world.js);
// this module adds Secrets with their owner and who else knows, False beliefs with the truth, and What each person
// remembers, from capture's values for the reply.
import { h } from '../dom.js';
import { chipList, foldedValue, row, rows, timelineRows } from '../card-templates.js';
import { headed, itemsOf, labelled, partsOf, pick, read, section, trackerOf } from './shared.js';

export const id = 'knowledge';

/** One secret: { text, owner, known: [names] }. */
export function readSecret(item) {
    if (typeof item === 'object') {
        const known = item.known ?? item.knownBy ?? item.holders ?? [];
        return { text: pick(item, 'secret', 'text'), owner: pick(item, 'owner', 'holder'), known: Array.isArray(known) ? known.map(String) : String(known).split(/\s*,\s*/).filter(Boolean) };
    }
    const out = { text: '', owner: '', known: [] };
    for (const part of partsOf(item)) {
        const [key, value] = labelled(part);
        if (/owner|holder|kept by/.test(key)) out.owner = value;
        else if (/known|knows|also/.test(key)) out.known = value.split(/\s*,\s*|\s+and\s+/).filter(Boolean);
        else out.text = out.text ? `${out.text} ${part}` : part;
    }
    return out;
}

/** One false belief: { who, belief, truth }. */
export function readBelief(item) {
    if (typeof item === 'object') return { who: pick(item, 'who', 'name', 'holder'), belief: pick(item, 'belief', 'believes', 'text'), truth: pick(item, 'truth', 'actually') };
    const [head, ...rest] = partsOf(item);
    const match = /^(.{1,60}?)\s+(?:believes|thinks|is sure)(?:\s+that)?\s*:?\s+([\s\S]+)$/i.exec(head);
    const truth = rest.map(labelled).find(([key]) => /truth|actually|really/.test(key))?.[1] || '';
    if (match) return { who: match[1].trim(), belief: match[2].trim(), truth };
    const [who, belief] = headed(head);
    return { who, belief, truth };
}

/** Remembered items grouped by person: [[name, [memories]]]. */
export function byPerson(items) {
    const groups = new Map();
    for (const item of items) {
        const [name, text] = typeof item === 'object' ? [pick(item, 'name', 'who'), pick(item, 'text', 'memory', 'remembers')] : headed(item);
        const key = name || 'Unnamed';
        if (!groups.has(key)) groups.set(key, []);
        if (text) groups.get(key).push(text);
    }
    return [...groups.entries()];
}

export function extend(env) {
    const saved = trackerOf(env.view.rec, 'knowledge') || {};
    const secrets = env.on('secrets') ? itemsOf(saved.secrets).map(readSecret).filter(item => item.text) : [];
    const beliefs = env.on('beliefs') ? itemsOf(saved.beliefs).map(readBelief).filter(item => item.belief) : [];
    const remembered = env.on('remembers') ? byPerson(itemsOf(saved.remembers)) : [];
    if (!secrets.length && !beliefs.length && !remembered.length) return null;
    const mark = read(saved.secrets ?? saved.beliefs ?? saved.remembers, env).mark;
    const first = secrets[0]?.text || (beliefs[0] && `${beliefs[0].who} believes ${beliefs[0].belief}`) || remembered[0]?.[1][0] || '';
    return { first, nodes: () => [
        section('Secrets', timelineRows(secrets.map(item => ({ node: h('span', { class: 'ri-c-secret' }, foldedValue(item.text),
            chipList([item.owner && { text: `Kept by ${item.owner}`, tone: 'indigo' }, ...item.known.map(name => ({ text: `${name} knows` }))].filter(Boolean))) }))),
        { iconName: 'fa-user-secret', count: secrets.length, id: 'secrets' }),
        section('False beliefs', rows(beliefs.map(item => row(item.who || 'Someone', [foldedValue(item.belief), item.truth ? h('span', { class: 'ri-c-note' }, `Truth: ${item.truth}`) : null]))),
            { iconName: 'fa-circle-question', count: beliefs.length, id: 'beliefs' }),
        section('What each person remembers', rows(remembered.map(([name, list]) => row(name, list.length > 1 ? h('ul', { class: 'ri-c-list' }, list.map(text => h('li', {}, foldedValue(text)))) : list[0]))),
            { iconName: 'fa-brain', count: remembered.length, id: 'remembers' }),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
    ] };
}
