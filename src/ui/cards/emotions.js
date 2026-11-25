// Emotions, Turn psychology (DESIGN 6.2, from Deus Psychological States): per character, the side of them the moment
// brings out, how they read it, the feeling it stirred, what it made them do and where they end the turn. The axes
// above it are the saved emotion records (reply-world.js); these rows are capture's per-character values for the reply.
import { rows } from '../card-templates.js';
import { section, subject, subjectRows, trackerOf } from './shared.js';

export const id = 'emotions';

export const TURN_FIELDS = Object.freeze([['side', 'Side it brings out'], ['read', 'How they read it'], ['feeling', 'Feeling it stirred'],
    ['acted', 'What it made them do'], ['ends', 'Where they end the turn']]);

export function extend(env) {
    if (!env.section('turn')) return null;
    const people = subjectRows(env, trackerOf(env.view.rec, 'emotions'), TURN_FIELDS);
    if (!people.length) return null;
    const lead = people[0].item;
    const word = [lead.feeling, lead.ends, lead.side].map(value => (value && typeof value === 'object' ? value.v : value)).find(Boolean);
    return { first: [people[0].name, word].filter(Boolean).join(': '), nodes: () => [
        section('Turn psychology', people.map(person => subject(person.name, rows(person.rows))), { iconName: 'fa-brain', count: people.length, id: 'turn' })] };
}
