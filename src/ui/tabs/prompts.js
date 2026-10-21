// Prompt editor (Advanced): every content text CORE exposes via listPromptPaths(), each with its own Reset.
// Storage is CORE's (diff against the shipped default). One row open at a time; rows are built lazily.

import { h, icon, call, debounce, setText } from '../dom.js';
import { panel } from '../controls.js';

const GROUPS = [
    { id: 'all', label: 'All' },
    { id: 'slots', label: 'Slots' },
    { id: 'personas', label: 'Personas' },
    { id: 'options', label: 'Options' },
    { id: 'story', label: 'Story' },
    { id: 'models', label: 'Models' },
    { id: 'envelope', label: 'Envelope' },
    { id: 'jobs', label: 'Jobs' },
];
const PAGE = 40;

/** Pure: group id for a prompt path. */
export function promptGroup(path) {
    const p = String(path || '');
    if (p.startsWith('options.story.')) return 'story';
    const head = p.split('.')[0];
    return GROUPS.some(g => g.id === head) ? head : 'other';
}

/** Pure: filter prompt paths by group and query (label or path, case-insensitive). */
export function filterPrompts(list, group, query) {
    const q = String(query || '').toLowerCase().trim();
    return (Array.isArray(list) ? list : []).filter(it => {
        if (!it?.path) return false;
        if (group && group !== 'all' && promptGroup(it.path) !== group) return false;
        if (!q) return true;
        return String(it.label || '').toLowerCase().includes(q) || it.path.toLowerCase().includes(q);
    });
}

export function createPromptEditor(api) {
    if (typeof api?.listPromptPaths !== 'function') return null;
    let group = 'all';
    let query = '';
    let limit = PAGE;
    let openRow = null;
    let painters = [];

    const search = h('input', { class: 'uc2-input', type: 'search', attrs: { placeholder: 'Search prompts…' }, aria: { label: 'Search prompts' } });
    const chips = h('div', { class: 'uc2-chips uc2-chips-scroll', attrs: { role: 'radiogroup' }, aria: { label: 'Prompt group' } },
        GROUPS.map(g => {
            const b = h('button', { class: 'uc2-chip', type: 'button', attrs: { role: 'radio' }, aria: { checked: String(g.id === group) }, data: { id: g.id } }, g.label);
            b.addEventListener('click', () => {
                group = g.id;
                limit = PAGE;
                for (const c of chips.children) c.setAttribute('aria-checked', String(c.dataset.id === group));
                draw();
            });
            return b;
        }));
    const listEl = h('div', { class: 'uc2-stack uc2-prompt-list' });
    const meta = h('span', { class: 'uc2-panel-note' });
    const more = h('button', { class: 'uc2-btn uc2-btn-sm', type: 'button', hidden: true }, 'Show more');
    more.addEventListener('click', () => { limit += PAGE; draw(); });
    search.addEventListener('input', debounce(() => { query = search.value; limit = PAGE; draw(); }, 180));

    function row(item) {
        const editedPill = h('span', { class: 'uc2-mini-pill uc2-mini-brand' }, 'Edited');
        const head = h('button', { class: 'uc2-acc-head', type: 'button', aria: { expanded: 'false' } },
            icon('fa-file-lines', 'uc2-acc-icon'),
            h('span', { class: 'uc2-acc-label' }, item.label || item.path),
            h('span', { class: 'uc2-acc-value uc2-mono' }, item.path),
            editedPill,
            icon('fa-chevron-down', 'uc2-acc-chev'));
        const wrap = h('div', { class: 'uc2-acc uc2-prompt-acc' }, head);
        let body = null;
        const paintEdited = () => {
            const t = call(api, 'getPromptText', item.path) || {};
            editedPill.hidden = !t.overridden;
            wrap.classList.toggle('is-set', !!t.overridden);
            return t;
        };
        paintEdited();
        painters.push(paintEdited);
        const ctl = {
            setOpen(open) {
                head.setAttribute('aria-expanded', String(open));
                wrap.classList.toggle('is-open', open);
                if (open && !body) {
                    const t = paintEdited();
                    const ta = h('textarea', { class: 'uc2-textarea', rows: 8, spellcheck: false, aria: { label: item.label || item.path } });
                    ta.value = t.value ?? '';
                    const status = h('span', { class: 'uc2-panel-note' });
                    const save = debounce(() => {
                        if (ta.value === (t.default ?? '')) call(api, 'resetPromptText', item.path);
                        else call(api, 'setPromptText', item.path, ta.value);
                        paintEdited();
                        setText(status, 'Saved');
                    }, 450);
                    ta.addEventListener('input', () => { setText(status, ''); save(); });
                    ta.addEventListener('blur', () => save.flush());
                    const reset = h('button', { class: 'uc2-link-btn uc2-danger-link', type: 'button', aria: { label: `Reset ${item.label || item.path} to default` } },
                        icon('fa-rotate-left'), 'Reset to default');
                    reset.addEventListener('click', () => {
                        save.cancel();
                        call(api, 'resetPromptText', item.path);
                        const fresh = paintEdited();
                        ta.value = fresh.value ?? fresh.default ?? '';
                        setText(status, 'Reset');
                    });
                    body = h('div', { class: 'uc2-acc-body uc2-prompt-body' }, ta, h('div', { class: 'uc2-acc-foot' }, status, reset));
                    wrap.appendChild(body);
                }
                if (body) body.hidden = !open;
            },
            isOpen: () => head.getAttribute('aria-expanded') === 'true',
        };
        head.addEventListener('click', () => {
            const willOpen = !ctl.isOpen();
            if (openRow && openRow !== ctl) openRow.setOpen(false);
            ctl.setOpen(willOpen);
            openRow = willOpen ? ctl : null;
        });
        return wrap;
    }

    function draw() {
        const all = call(api, 'listPromptPaths') || [];
        const list = filterPrompts(all, group, query);
        openRow = null;
        painters = [];
        listEl.replaceChildren(...list.slice(0, limit).map(row));
        more.hidden = list.length <= limit;
        setText(meta, `${list.length} of ${all.length} texts`);
    }

    const el = panel(null, null,
        h('div', { class: 'uc2-panel-head' }, h('h3', { class: 'uc2-panel-title' }, icon('fa-pen-to-square'), 'Prompt editor'), meta),
        h('p', { class: 'uc2-panel-note' }, 'Every text the suite sends. Edits are stored only where they differ from the shipped default, so improved defaults still reach you. Placeholders like {{uc.length_rule}} and {{char}} are filled at send time.'),
        search, chips, listEl, more);
    let drawn = false;
    return {
        el,
        show() { if (!drawn) { drawn = true; draw(); } },
        /** Settings changed elsewhere (Reset, scope switch): repaint markers only; never rebuild under the caret. */
        refresh() { for (const p of painters) p(); },
    };
}
