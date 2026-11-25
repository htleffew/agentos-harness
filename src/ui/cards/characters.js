// Characters, Conditions (DESIGN 6.2, from Pura's Status and Conditions Tracker): each character's conditions with a
// severity mark, a Font Awesome icon and the word (mild, moderate, severe), so colour is never the only signal.
// Capture writes "sprained ankle (moderate); fever (mild)" per character.
import { h } from '../dom.js';
import { row, rows, severityMark, unwrap } from '../card-templates.js';
import { itemsOf, pick, present, replyNumberAt, section, trackerOf } from './shared.js';

export const id = 'characters';

const LEVELS = [[/sever|critical|grave|serious|heavy/i, 'severe'], [/moderate|medium|significant/i, 'moderate'], [/mild|minor|slight|light/i, 'mild']];
const levelOf = text => LEVELS.find(([pattern]) => pattern.test(text || ''))?.[1] || '';

/** One condition: { text, level }. */
export function readCondition(item) {
    if (typeof item === 'object') return { text: pick(item, 'condition', 'text', 'name'), level: levelOf(pick(item, 'severity', 'level')) };
    const bracket = /^(.*?)\s*[([]\s*([^)\]]{3,20})\s*[)\]]\s*$/.exec(item);
    if (bracket && levelOf(bracket[2])) return { text: bracket[1].trim(), level: levelOf(bracket[2]) };
    const lead = /^(mild|moderate|severe)\s*[:,-]\s*(.+)$/i.exec(item);
    if (lead) return { text: lead[2].trim(), level: lead[1].toLowerCase() };
    return { text: String(item).trim(), level: '' };
}

export function extend(env) {
    if (!env.on('conditions')) return null;
    const current = replyNumberAt(env.id);
    const people = (Array.isArray(trackerOf(env.view.rec, 'characters')) ? trackerOf(env.view.rec, 'characters') : [])
        .filter(item => item && typeof item === 'object' && String(item.name ?? '').trim() && present(unwrap(item.conditions).value))
        .map(item => {
            const { value, from } = unwrap(item.conditions);
            return { name: String(item.name).trim(), from, list: itemsOf(value, { semi: true }).map(readCondition).filter(entry => entry.text) };
        }).filter(person => person.list.length);
    if (!people.length) return null;
    const worst = people.flatMap(person => person.list.map(entry => ({ ...entry, name: person.name }))).sort((a, b) => ['severe', 'moderate', 'mild', ''].indexOf(a.level) - ['severe', 'moderate', 'mild', ''].indexOf(b.level))[0];
    return { first: `${worst.name}: ${worst.text}${worst.level ? ` (${worst.level})` : ''}`, nodes: () => [
        section('Conditions', rows(people.map(person => row(person.name, h('span', { class: 'ri-c-conditions' }, person.list.map(entry => severityMark(entry.level, entry.text))), { from: person.from, current }))),
            { iconName: 'fa-kit-medical', count: people.reduce((sum, person) => sum + person.list.length, 0), id: 'conditions' })] };
}
