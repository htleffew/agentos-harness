// Reputation (DESIGN 6.2, from Pura's Reputation Tracker): per group or source, how the player character is seen, which
// way it is moving and why. Capture writes "Group | how they see the player character | rising, falling or steady | why".
import { h } from '../dom.js';
import { foldedValue, row, rows } from '../card-templates.js';
import { headed, icon, itemsOf, partsOf, pick, read, trackerOf } from './shared.js';

export const id = 'reputation';

const TRENDS = [[/ris|up|improv|warm|grow|better/i, 'rising', 'fa-caret-up', 'Rising'], [/fall|down|wors|cool|sour|drop/i, 'falling', 'fa-caret-down', 'Falling'],
    [/stead|same|stable|flat|unchanged/i, 'steady', 'fa-minus', 'Steady']];

/** One standing: { group, view, trend, why }. trend is rising, falling, steady or ''. */
export function readStanding(item) {
    const trendOf = text => TRENDS.find(([pattern]) => pattern.test(text || ''))?.[1] || '';
    if (typeof item === 'object') return { group: pick(item, 'group', 'source', 'name'), view: pick(item, 'view', 'standing', 'text'), trend: trendOf(pick(item, 'trend', 'direction')), why: pick(item, 'why', 'reason') };
    const parts = partsOf(item);
    if (parts.length > 1) {
        const [group, view = '', third = '', ...rest] = parts;
        const trend = trendOf(third);
        return { group, view, trend, why: [trend ? '' : third, ...rest].filter(Boolean).join(' · ') };
    }
    const [group, view] = headed(item);
    return { group, view, trend: '', why: '' };
}

export function trendMark(trend) {
    const found = TRENDS.find(([, id]) => id === trend);
    if (!found) return null;
    const [, , mark, word] = found;
    return h('span', { class: 'ri-c-change', 'data-dir': trend === 'rising' ? 'up' : trend === 'falling' ? 'down' : 'same' }, icon(mark), h('span', {}, word));
}

export function render(env, { footer }) {
    if (!env.on('standing')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'reputation')?.standing, env);
    const list = itemsOf(value).map(readStanding).filter(item => item.group || item.view);
    if (!list.length) return null;
    const lead = list.find(item => item.trend && item.trend !== 'steady') || list[0];
    return { first: [lead.group, lead.view].filter(Boolean).join(': '), body: () => [
        rows(list.map(item => row(item.group || 'Seen as', [foldedValue(item.view), trendMark(item.trend), item.why ? h('span', { class: 'ri-c-note' }, foldedValue(item.why)) : null].filter(Boolean)))),
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
