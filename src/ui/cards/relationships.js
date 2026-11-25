// Relationships, Route (DESIGN 6.2, from Pura's Relationship Tracker): per character, the route they are on with the
// other person, where they stand, what they feel, trust and want, what delights and repels them, the moment they keep
// and what would move them next. The pairs above it are the saved relationship records (reply-world.js).
import { rows } from '../card-templates.js';
import { section, subject, subjectRows, trackerOf } from './shared.js';

export const id = 'relationships';

export const ROUTE_FIELDS = Object.freeze([['route', 'Route'], ['stands', 'Where they stand'], ['feels', 'What they feel'], ['trust_want', 'Trust and want'],
    ['delights', 'What delights and repels'], ['moment', 'The moment they keep'], ['next', 'What would move them next']]);

export function extend(env) {
    if (!env.section('route')) return null;
    const people = subjectRows(env, trackerOf(env.view.rec, 'relationships'), ROUTE_FIELDS);
    if (!people.length) return null;
    const lead = people[0].item;
    const word = [lead.route, lead.stands].map(value => (value && typeof value === 'object' ? value.v : value)).find(Boolean);
    return { first: [people[0].name, word].filter(Boolean).join(': '), nodes: () => [
        section('Route', people.map(person => subject(person.name, rows(person.rows))), { iconName: 'fa-signs-post', count: people.length, id: 'route' })] };
}
