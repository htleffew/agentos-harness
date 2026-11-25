// Map (DESIGN 6.2, from Vexa's World Map): the current room as a text grid with who and what stands where. Capture
// writes the grid lines and then one legend line per letter ("H: Hale"); the legend draws as chips under the grid.
import { h } from '../dom.js';
import { chipList, textGrid } from '../card-templates.js';
import { read, trackerOf } from './shared.js';

export const id = 'map';
const MAX_COLUMNS = 32;
const LEGEND = /^\s*([^\s:=]{1,3})\s*[:=]\s+(\S.*)$/u;

/** Grid lines and legend items of a saved grid value. */
export function splitGrid(value) {
    const lines = (Array.isArray(value) ? value.map(String) : String(value ?? '').split(/\r?\n/)).map(line => line.replace(/\s+$/, ''));
    const grid = [], legend = [];
    for (const line of lines) {
        if (!line.trim()) continue;
        const key = LEGEND.exec(line);
        if (key && grid.length) legend.push({ mark: key[1], text: key[2].trim() });
        else grid.push(line.length > MAX_COLUMNS ? line.slice(0, MAX_COLUMNS) : line);
    }
    // Strip code fences a model may wrap the grid in.
    return { grid: grid.filter(line => !/^\s*```/.test(line)), legend };
}

export function render(env, { footer }) {
    if (!env.on('grid')) return null;
    const { value, mark } = read(trackerOf(env.view.rec, 'map')?.grid, env);
    const { grid, legend } = splitGrid(value);
    if (!grid.length) return null;
    const first = legend.length ? legend.map(item => item.text).join(', ') : `Room grid, ${grid.length} rows`;
    return { first, body: () => [
        textGrid(grid),
        legend.length ? h('div', { class: 'ri-c-legend' }, chipList(legend.map(item => ({ text: `${item.mark} ${item.text}`, title: `${item.mark} marks ${item.text}` })), { label: 'Legend' })) : null,
        mark ? h('p', { class: 'ri-c-unrequested' }, mark) : null,
        footer(env)] };
}
