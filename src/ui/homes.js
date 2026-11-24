// One home per control (DESIGN.md 3.4, audit 02 section 2). A control that more than one page used to show
// has one home; every other page shows a link row that lands on it. The table below is the single list of
// those controls: the page that holds each one and the pages that link to it. tests/t_page_moves.js reads
// it and checks the live pages against it.
import { h, button } from './dom.js';
import { promptEditor, promptGroup } from './prompts.js';

import { HOMES } from './home-table.js';
export { HOMES };

const pageLabel = {
    memory:'Setup, Memory', display:'Setup, Look', world:'Story, Story World', books:'Story, World Info', writing:'Direction, Writing',
    v10:'Setup, Features', checks:'Direction, Action checks', portrayal:'Story, Characters', 'set-rules':'Direction, Random sets',
    context:'Review, Context', settings:'Setup, Connections', sets:'Direction, Random sets', presets:'Setup, Presets',
};

/** The selector that finds the real control inside a home. */
export const homeSelector = key => `[data-control="${key}"] :is(input:not([type="hidden"]),select,textarea,button,summary)`;

/** Mark a node as the one home of a control. */
export function home(key, node) {
    if (!HOMES[key]) throw new Error(`Unknown control home: ${key}`);
    node.dataset.control = key;
    return node;
}

/**
 * A link row that lands on the control's home. Pass app when the page has it; otherwise the panel is found when the link is tapped.
 * An anchor selector in the options lands on a part of the home, such as one feature's row, instead of its first control.
 */
export function homeLink(app, keys, text, { anchor } = {}) {
    const list = [keys].flat();
    const key = list[0];
    const target = HOMES[key];
    if (!target) throw new Error(`Unknown control home: ${key}`);
    if (list.some(item => HOMES[item]?.page !== target.page)) throw new Error(`One link reaches one page: ${list.join(', ')}`);
    const where = pageLabel[target.page] || target.page;
    return h('div', { class:'ri-note ri-home-link', 'data-home-link':list.join(' ') },
        h('span', {}, text || `${target.label} is set in ${where}.`),
        button(`Open ${where}`, async () => {
            const view = app || (await import('./panel.js')).app;
            // A link row drawn outside the panel (the quick action sheet) has no open panel to land in, so the menu opens full screen.
            const outside = !!view.root && !view.root.contains(document.activeElement);
            const opened = await view.openPage(target.page, { anchor:anchor || homeSelector(key) });
            if (outside && opened !== false) await view.setExpanded(true);
        }, { kind:'ghost' }));
}

/**
 * A prompt slot: the editor of stored prompts that sits beside the feature using them. The same stored
 * prompt shows in Setup, Prompts; the slot carries the stored prompts' ids so a test can compare them.
 */
export function slot(ids, label, options = {}) {
    const { bare, ...rest } = options;
    // A bare slot lists the editors with no fold, for a place that already sits inside a fold of its own.
    const group = bare ? h('div', { class: 'ri-prompt-bare' }, ids.map(id => promptEditor(id, { onChange: rest.onChange })))
        : promptGroup(ids, label, rest);
    group.dataset.promptSlot = '';
    group.dataset.promptIds = ids.join(' ');
    return group;
}
