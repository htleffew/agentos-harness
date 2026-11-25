// Holding back (DESIGN 6.2, from Vexa's Dam): per pair, what a character lets themselves show or say to the other,
// what they keep back, and the strain. Capture writes "Name to Name | shows | holds back | strain".
import { h } from '../dom.js';
import { row, rows } from '../card-templates.js';
import { headed, icon, itemsOf, partsOf, pick, read, subject, trackerOf } from './shared.js';

export const id = 'holding_back';

const STRAIN = [[/\bhigh|breaking|severe|crack/i, 'high', 'fa-gauge-high'], [/\brising|growing|mounting|medium|moderate/i, 'rising', 'fa-gauge'], [/\blow|steady|calm|slight/i, 'low', 'fa-gauge-simple']];

/** One pair from a saved item: { pair, shows, held, strain }. */
export function readDam(item) {
    if (typeof item === 'object') return { pair: pick(item, 'pair', 'name', 'who'), shows: pick(item, 'shows', 'show', 'says'), held: pick(item, 'held', 'holds', 'holding', 'hidden'), strain: pick(item, 'strain', 'pressure') };
    const parts = partsOf(item);
    if (parts.length > 1) {
        const [pair, shows = '', held = '', strain = ''] = parts;
        return { pair, shows, held, strain: strain.replace(/^strain\s*/i, '') };
    }
    const [pair, rest] = headed(item);
    return { pair, shows: '', held: rest, strain: '' };
}

function strainMark(text) {
    if (!text) return null;
    const [, level, mark] = STRAIN.find(([pattern]) => pattern.test(text)) || [null, '', 'fa-gauge'];
    return h('span', { class: 'ri-c-strain', 'data-level': level || undefined }, icon(mark), h('span', {}, text));
}

export function render(env, { footer }) {
    if (!env.on('dam')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'holding_back')?.dam, env);
    const pairs = itemsOf(value).map(readDam).filter(item => item.pair || item.held || item.shows);
    if (!pairs.length) return null;
    const lead = pairs[0];
    return { first: [lead.pair, lead.held || lead.shows].filter(Boolean).join(': '), body: () => [
        pairs.map(item => subject(item.pair, rows([row('Shows', item.shows), row('Holds back', item.held), row('Strain', strainMark(item.strain))]))),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
