// Generic controls drawn from schema entries. Each control is built once and then updated in place
// (update(settings)) so a change never re-renders the tab, and focus/scroll/caret are preserved.

import { h, icon, setText, debounce, nextId } from './dom.js';
import { resolveOptions, controlKind, getPath, valueSummary, isValueSet, sliderSpec, optionValue, displayText, iconFor, tintFor } from './model.js';

const TEXT_SAVE_MS = 450;

/** One-open-at-a-time accordion group. */
export function accordionGroup() {
    const rows = new Set();
    return {
        add(row) { rows.add(row); },
        open(row) {
            for (const r of rows) r.setOpen(r === row ? !r.isOpen() : false);
        },
    };
}

let macroName = () => '';
/** The modal tells controls the current character's name so {{char}} in labels/help reads naturally. */
export function setMacroName(fn) { macroName = typeof fn === 'function' ? fn : () => ''; }
const show = t => displayText(t, macroName());

function rowText(entry, extra) {
    return h('div', { class: 'uc2-row-text' },
        h('div', { class: 'uc2-row-label' }, iconFor(entry) ? icon(iconFor(entry), 'uc2-row-icon') : null, show(entry.label || entry.key), extra || null),
        entry.help ? h('div', { class: 'uc2-row-help' }, show(entry.help)) : null);
}

function wrapClass(entry, base) {
    return [base, entry.advanced ? 'uc2-adv' : ''];
}

export function switchEl(on, label) {
    return h('button', { class: 'uc2-switch', type: 'button', attrs: { role: 'switch' },
        aria: { checked: String(!!on), label } }, h('span', { class: 'uc2-knob' }));
}

export function setSwitch(sw, on) {
    sw.setAttribute('aria-checked', String(!!on));
}

// --- toggle row --------------------------------------------------------------------------------
function toggleControl(entry, ctx) {
    const sw = switchEl(false, entry.label || entry.key);
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-toggle-row'), data: { key: entry.key } },
        rowText(entry), sw);
    const flip = () => {
        const next = !(sw.getAttribute('aria-checked') === 'true');
        apply(next);
        ctx.set(entry.key, next);
    };
    const apply = on => {
        setSwitch(sw, on);
        row.classList.toggle('is-on', !!on);
    };
    row.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        flip();
    });
    // Native button activation covers Space/Enter; stopPropagation keeps the row handler from flipping twice.
    sw.addEventListener('click', e => { e.stopPropagation(); flip(); });
    return { key: entry.key, el: row, update: s => apply(!!(getPath(s, entry.key) ?? entry.default)) };
}

// --- chip group (single) -----------------------------------------------------------------------
function chipButtons(options, onPick, name) {
    const tray = h('div', { class: 'uc2-chips', attrs: { role: 'radiogroup' }, aria: { label: name } });
    const btns = options.map(o => {
        const b = h('button', { class: 'uc2-chip', type: 'button', attrs: { role: 'radio', title: o.hint || o.text || '' },
            aria: { checked: 'false' }, data: { id: o.id } }, o.label);
        b.addEventListener('click', () => onPick(o.id));
        tray.appendChild(b);
        return b;
    });
    // Arrow keys move within the radio group.
    tray.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        const i = btns.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        const j = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + btns.length) % btns.length;
        btns[j].focus();
    });
    const mark = val => {
        const ids = Array.isArray(val) ? val.map(String) : [String(val ?? '')];
        for (const b of btns) b.setAttribute('aria-checked', String(ids.includes(b.dataset.id)));
    };
    return { tray, mark };
}

function segmentedControl(entry, ctx, resolved) {
    const { tray, mark } = chipButtons(resolved.options, id => { mark(id); ctx.set(entry.key, optionValue(resolved.options, id)); }, show(entry.label));
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-stack-row'), data: { key: entry.key } }, rowText(entry), tray);
    return { key: entry.key, el: row, update: s => mark(getPath(s, entry.key) ?? entry.default) };
}

function multiControl(entry, ctx, resolved) {
    let current = [];
    const { tray, mark } = chipButtons(resolved.options, id => {
        const v = optionValue(resolved.options, id);
        current = current.map(String).includes(id) ? current.filter(x => String(x) !== id) : [...current, v];
        mark(current);
        ctx.set(entry.key, current);
    }, entry.label);
    tray.setAttribute('role', 'group');
    for (const b of tray.children) b.setAttribute('role', 'checkbox');
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-stack-row'), data: { key: entry.key } }, rowText(entry), tray);
    return { key: entry.key, el: row, update: s => { const v = getPath(s, entry.key) ?? entry.default; current = Array.isArray(v) ? [...v] : []; mark(current); } };
}

// --- accordion row (Story Config style) --------------------------------------------------------
function accordionControl(entry, ctx, resolved, group) {
    const field = resolved.field || {};
    const label = show(entry.label || field.label || entry.key);
    const multiline = entry.type === 'textarea';
    const bodyId = nextId('uc2-acc');
    const valueEl = h('span', { class: 'uc2-acc-value' });
    const head = h('button', { class: 'uc2-acc-head', type: 'button', aria: { expanded: 'false', controls: bodyId } },
        icon(iconFor(entry, field) || 'fa-sliders', 'uc2-acc-icon'),
        h('span', { class: 'uc2-acc-label' }, label),
        valueEl,
        icon('fa-chevron-down', 'uc2-acc-chev'));
    const options = resolved.options;
    const freeText = !!(field.free_text || entry.free_text || entry.freeText || entry.type === 'text' || multiline);
    let current = entry.default;

    const pick = id => {
        const v = optionValue(options, id);
        const next = String(current ?? '') === id && isValueSet(entry, v) ? (entry.default ?? '') : v;
        current = next;
        paint();
        if (input) input.value = options.some(o => o.id === String(next)) ? '' : String(next ?? '');
        ctx.set(entry.key, next);
    };
    const chips = options.length ? chipButtons(options, pick, label) : null;
    let input = null;
    let saveText = null;
    if (freeText) {
        input = multiline
            ? h('textarea', { class: 'uc2-textarea uc2-textarea-sm', rows: 4, attrs: { placeholder: entry.placeholder || 'Write it in your own words…', maxlength: '2000' },
                aria: { label } })
            : h('input', { class: 'uc2-input', type: 'text', attrs: { placeholder: entry.placeholder || (options.length ? 'Or write your own…' : 'Write your own…'), maxlength: '300' },
                aria: { label: `${label}: custom value` } });
        saveText = debounce(v => ctx.set(entry.key, v), TEXT_SAVE_MS);
        input.addEventListener('input', () => {
            current = input.value.trim() || (entry.default ?? '');
            paint(false);
            saveText(current);
        });
        input.addEventListener('blur', () => saveText.flush(current));
    }
    const clearBtn = h('button', { class: 'uc2-link-btn', type: 'button' }, icon('fa-rotate-left'), 'Use default');
    clearBtn.addEventListener('click', () => {
        current = entry.default ?? '';
        if (input) input.value = '';
        paint();
        ctx.set(entry.key, current);
    });
    const body = h('div', { class: 'uc2-acc-body', id: bodyId, hidden: true },
        entry.help || field.help ? h('p', { class: 'uc2-acc-hint' }, show(entry.help || field.help)) : null,
        chips ? chips.tray : null,
        input,
        h('div', { class: 'uc2-acc-foot' }, clearBtn));
    const row = h('div', { class: wrapClass(entry, 'uc2-acc'), data: { key: entry.key } }, head, body);
    const tint = [field.color, entry.color].find(c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) || tintFor(field.id || entry.role || entry.key);
    if (tint) row.style.setProperty('--uc2-acc-tint', tint);

    const paint = (syncInput = true) => {
        const sum = valueSummary(entry, current, options);
        setText(valueEl, sum.text);
        row.classList.toggle('is-set', sum.set);
        if (chips) chips.mark(current);
        clearBtn.hidden = !sum.set;
        if (syncInput && input && document.activeElement !== input) {
            input.value = options.some(o => o.id === String(current)) || !sum.set ? '' : String(current ?? '');
        }
    };
    const api = {
        isOpen: () => head.getAttribute('aria-expanded') === 'true',
        setOpen(open) {
            head.setAttribute('aria-expanded', String(open));
            body.hidden = !open;
            row.classList.toggle('is-open', open);
        },
    };
    group?.add(api);
    head.addEventListener('click', () => (group ? group.open(api) : api.setOpen(!api.isOpen())));
    return { key: entry.key, el: row, update: s => { current = getPath(s, entry.key) ?? entry.default; paint(); } };
}

// --- slider ------------------------------------------------------------------------------------
function sliderControl(entry, ctx, resolved) {
    const spec = sliderSpec(entry, resolved.options);
    const id = nextId('uc2-sl');
    const out = h('output', { class: 'uc2-slider-value', attrs: { for: id } });
    const input = h('input', { class: 'uc2-slider', type: 'range', id, min: spec.min, max: spec.max, step: spec.step,
        aria: { label: entry.label || entry.key } });
    const ticks = spec.labels ? h('div', { class: 'uc2-ticks' }, spec.labels.map((l, i) => {
        const b = h('button', { class: 'uc2-tick', type: 'button', data: { v: spec.min + i * spec.step } }, l);
        b.addEventListener('click', () => { input.value = String(spec.min + i * spec.step); onInput(); commit(); });
        return b;
    })) : null;
    const paint = v => {
        const n = Number(v);
        const label = spec.labels ? spec.labels[Math.round((n - spec.min) / spec.step)] : null;
        setText(out, label ?? String(n));
        const pct = spec.max > spec.min ? ((n - spec.min) / (spec.max - spec.min)) * 100 : 0;
        input.style.setProperty('--uc2-fill', `${pct}%`);
        input.setAttribute('aria-valuetext', label ?? String(n));
        if (ticks) for (const t of ticks.children) t.classList.toggle('is-on', Number(t.dataset.v) === n);
    };
    const commit = () => ctx.set(entry.key, Number(input.value));
    const onInput = () => paint(input.value);
    input.addEventListener('input', onInput);
    input.addEventListener('change', commit);
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-stack-row uc2-slider-row'), data: { key: entry.key } },
        rowText(entry, out), input, ticks);
    return { key: entry.key, el: row, update: s => {
        if (document.activeElement === input) return;
        const v = getPath(s, entry.key) ?? entry.default ?? spec.min;
        input.value = String(v);
        paint(v);
    } };
}

// --- dial: a select drawn as a stepped slider (drama 0..3) ------------------------------------
function dialControl(entry, ctx, resolved) {
    const opts = resolved.options;
    const out = h('output', { class: 'uc2-slider-value' });
    const input = h('input', { class: 'uc2-slider', type: 'range', min: 0, max: opts.length - 1, step: 1, aria: { label: show(entry.label || entry.key) } });
    const ticks = h('div', { class: 'uc2-ticks' }, opts.map((o, i) => {
        const b = h('button', { class: 'uc2-tick', type: 'button', data: { i } }, o.label);
        b.addEventListener('click', () => { input.value = String(i); paint(i); commit(); });
        return b;
    }));
    const paint = i => {
        const n = Number(i);
        setText(out, opts[n]?.label ?? '');
        input.style.setProperty('--uc2-fill', `${opts.length > 1 ? (n / (opts.length - 1)) * 100 : 0}%`);
        input.setAttribute('aria-valuetext', opts[n]?.label ?? '');
        for (const t of ticks.children) t.classList.toggle('is-on', Number(t.dataset.i) === n);
    };
    const commit = () => ctx.set(entry.key, opts[Number(input.value)]?.value);
    input.addEventListener('input', () => paint(input.value));
    input.addEventListener('change', commit);
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-stack-row uc2-slider-row'), data: { key: entry.key } }, rowText(entry, out), input, ticks);
    return { key: entry.key, el: row, update: s => {
        if (document.activeElement === input) return;
        const v = getPath(s, entry.key) ?? entry.default;
        const i = Math.max(0, opts.findIndex(o => o.id === String(v)));
        input.value = String(i);
        paint(i);
    } };
}

// --- info row (read-only, e.g. point of view fixed by the user's rules) -----------------------
function infoControl(entry, ctx, resolved) {
    const valueEl = h('span', { class: 'uc2-acc-value' });
    const field = resolved.field || {};
    const row = h('div', { class: wrapClass(entry, 'uc2-acc uc2-acc-info'), data: { key: entry.key } },
        h('div', { class: 'uc2-acc-head', attrs: { role: 'group' }, aria: { label: show(entry.label || entry.key) } },
            icon(iconFor(entry, field) || 'fa-circle-info', 'uc2-acc-icon'),
            h('span', { class: 'uc2-acc-label' }, show(entry.label || field.label || entry.key)),
            valueEl,
            icon('fa-lock', 'uc2-acc-lock')),
        entry.help ? h('p', { class: 'uc2-acc-hint uc2-info-hint' }, show(entry.help)) : null);
    row.style.setProperty('--uc2-acc-tint', tintFor(field.id || entry.key));
    return { key: entry.key, el: row, update: s => {
        const v = getPath(s, entry.key) ?? entry.default;
        const o = resolved.options.find(x => x.id === String(v));
        setText(valueEl, show(o ? o.label : 'Fixed'));
    } };
}

// --- number / text / textarea ------------------------------------------------------------------
function numberControl(entry, ctx) {
    const input = h('input', { class: 'uc2-input uc2-input-num', type: 'number', inputMode: 'numeric',
        min: entry.min, max: entry.max, step: entry.step ?? 1, aria: { label: entry.label || entry.key } });
    const save = debounce(() => {
        const n = Number(input.value);
        if (input.value !== '' && Number.isFinite(n)) ctx.set(entry.key, n);
    }, TEXT_SAVE_MS);
    input.addEventListener('input', save);
    input.addEventListener('blur', () => save.flush());
    const row = h('div', { class: wrapClass(entry, 'uc2-row'), data: { key: entry.key } }, rowText(entry), input);
    return { key: entry.key, el: row, update: s => { if (document.activeElement !== input) input.value = String(getPath(s, entry.key) ?? entry.default ?? ''); } };
}

function textControl(entry, ctx, resolved, multiline) {
    const input = multiline
        ? h('textarea', { class: 'uc2-textarea', rows: entry.rows || 6, spellcheck: false, aria: { label: entry.label || entry.key } })
        : h('input', { class: 'uc2-input', type: 'text', attrs: { placeholder: entry.placeholder || '' }, aria: { label: entry.label || entry.key } });
    const save = debounce(() => ctx.set(entry.key, input.value), TEXT_SAVE_MS);
    input.addEventListener('input', () => { save(); paintEdited(); });
    input.addEventListener('blur', () => save.flush());
    let reset = null;
    const paintEdited = () => {
        if (!reset) return;
        const edited = input.value !== String(entry.default ?? '');
        reset.hidden = !edited;
        row.classList.toggle('is-edited', edited);
    };
    if (multiline) {
        reset = h('button', { class: 'uc2-link-btn uc2-danger-link', type: 'button', aria: { label: `Reset ${entry.label || entry.key} to default` } },
            icon('fa-rotate-left'), 'Reset');
        reset.addEventListener('click', () => {
            save.cancel();
            input.value = String(entry.default ?? '');
            paintEdited();
            ctx.reset(entry.key, entry.default);
        });
    }
    const head = multiline
        ? h('div', { class: 'uc2-field-head' }, rowText(entry), h('span', { class: 'uc2-edited-dot', aria: { hidden: 'true' } }), reset)
        : rowText(entry);
    const row = h('div', { class: wrapClass(entry, multiline ? 'uc2-row uc2-stack-row uc2-prompt-row' : 'uc2-row'), data: { key: entry.key } },
        head, input);
    return { key: entry.key, el: row, update: s => {
        if (document.activeElement !== input) input.value = String(getPath(s, entry.key) ?? entry.default ?? '');
        paintEdited();
    } };
}

// --- order -------------------------------------------------------------------------------------
function orderControl(entry, ctx, resolved) {
    let order = [];
    const list = h('ol', { class: 'uc2-order' });
    const labelOf = id => resolved.options.find(o => o.id === id)?.label || id;
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        draw();
        ctx.set(entry.key, [...order]);
        list.querySelectorAll('button')[Math.max(0, j * 2 + (d > 0 ? 1 : 0))]?.focus();
    };
    const draw = () => {
        list.replaceChildren(...order.map((id, i) => h('li', { class: 'uc2-order-item' },
            h('span', { class: 'uc2-order-n' }, String(i + 1)),
            h('span', { class: 'uc2-order-label' }, labelOf(id)),
            h('button', { class: 'uc2-icon-btn', type: 'button', disabled: i === 0, aria: { label: `Move ${labelOf(id)} up` }, on: { click: () => move(i, -1) } }, icon('fa-arrow-up')),
            h('button', { class: 'uc2-icon-btn', type: 'button', disabled: i === order.length - 1, aria: { label: `Move ${labelOf(id)} down` }, on: { click: () => move(i, 1) } }, icon('fa-arrow-down')))));
    };
    const row = h('div', { class: wrapClass(entry, 'uc2-row uc2-stack-row'), data: { key: entry.key } }, rowText(entry), list);
    return { key: entry.key, el: row, update: s => {
        const v = getPath(s, entry.key) ?? entry.default;
        const next = Array.isArray(v) ? v.map(String) : resolved.options.map(o => o.id);
        if (JSON.stringify(next) !== JSON.stringify(order)) { order = next; draw(); }
    } };
}

/**
 * Build a control for a schema entry. Returns {key, el, update(settings)} or null.
 * ctx: { content, set(key, value), reset(key, default) }
 */
export function buildControl(entry, ctx, group) {
    const resolved = resolveOptions(entry, ctx.content, ctx.extraOptions);
    const kind = controlKind(entry, resolved);
    switch (kind) {
        case 'dial': return dialControl(entry, ctx, resolved);
        case 'info': return infoControl(entry, ctx, resolved);
        case 'toggle': return toggleControl(entry, ctx);
        case 'segmented': return segmentedControl(entry, ctx, resolved);
        case 'multi': return multiControl(entry, ctx, resolved);
        case 'accordion': return accordionControl(entry, ctx, resolved, group);
        case 'slider': return sliderControl(entry, ctx, resolved);
        case 'number': return numberControl(entry, ctx);
        case 'textarea': return textControl(entry, ctx, resolved, true);
        case 'order': return orderControl(entry, ctx, resolved);
        case 'persona': return null; // drawn by the Narrator tab
        default: return textControl(entry, ctx, resolved, false);
    }
}

/** Callout: tinted left-border note. tone: amber | green | purple | red | info */
export function callout(tone, iconName, lead, ...body) {
    return h('div', { class: `uc2-callout uc2-callout-${tone}`, attrs: { role: 'note' } },
        icon(iconName, 'uc2-callout-icon'),
        h('div', { class: 'uc2-callout-text' }, lead ? h('strong', {}, lead) : null, lead ? ' ' : null, ...body));
}

/** Panel with a micro-label title. */
export function panel(title, iconName, ...children) {
    return h('section', { class: 'uc2-panel' },
        title ? h('h3', { class: 'uc2-panel-title' }, iconName ? icon(iconName) : null, title) : null,
        ...children);
}
