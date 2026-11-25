// Director's desk (DESIGN 6.2): the extension's reply plan (drawn by reply-cards.js) with Course, Pressure, Branches
// and Graded beside it, from Sola's Director's Desk and Horizon, Deus Undercurrents, Momentum Engine and Conflict, and
// Pura's Direction Menu. The plan reaches the model only as the Tracker book's Director's desk entry (tracker-book.js);
// these sections are tracker values capture saves on the reply, published in that same entry.
import { h } from '../dom.js';
import { foldedValue, row, rows } from '../card-templates.js';
import { itemsOf, read, section, trackerOf } from './shared.js';

export const id = 'plan';

export function extend(env) {
    const saved = trackerOf(env.view.rec, 'plan') || {};
    const text = key => (env.on(key) ? String(read(saved[key], env).value ?? '').trim() : '');
    const course = text('course'), pressure = text('pressure'), graded = text('graded');
    const branches = env.on('branches') ? itemsOf(saved.branches) : [];
    if (!course && !pressure && !graded && !branches.length) return null;
    return { first: course || pressure || branches[0] || graded, nodes: () => [
        rows([row('Course', course), row('Pressure', pressure), row('Graded', graded)]),
        branches.length && section('Branches', h('ol', { class: 'ri-c-list ri-c-branches' }, branches.map(item => h('li', {}, foldedValue(typeof item === 'string' ? item : item.text || item.title || '')))),
            { iconName: 'fa-code-fork', count: branches.length, id: 'branches' }),
    ] };
}
