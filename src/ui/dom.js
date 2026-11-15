// Small helpers for building the panel with plain DOM.
import { names } from '../st.js';
import { pronounForms, FORMS } from '../store.js';

export function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
        else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids);
    return el;
}

export function add(el, kids) {
    for (const kid of [kids].flat(4)) {
        if (kid === null || kid === undefined || kid === false) continue;
        el.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

export function button(label, onClick, { kind = '', title = '', disabled = false } = {}) {
    return h('button', { type: 'button', class: `ri-btn ${kind ? 'ri-btn-' + kind : ''}`, title, disabled, onclick: onClick }, label);
}

/** An on/off switch. */
export function toggle(checked, onChange, label = '') {
    const btn = h('button', { type: 'button', class: 'ri-switch', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label || 'On or off' }, h('span', { class: 'ri-switch-knob' }));
    btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = btn.getAttribute('aria-checked') !== 'true';
        btn.setAttribute('aria-checked', String(next));
        onChange(next);
    });
    return btn;
}

export function select(options, value, onChange, attrs = {}) {
    const el = h('select', { class: 'ri-input', ...attrs, onchange: () => onChange(el.value) },
        options.map(o => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
    el.value = String(value);
    return el;
}

export function numberInput(value, { min = 0, max = 9999, unit = '' } = {}, onChange) {
    const input = h('input', { type: 'number', class: 'ri-input ri-input-num', inputMode: 'numeric', min, max, value: String(value), oninput: () => {
        let n = Math.round(Number(input.value));
        if (!Number.isFinite(n)) n = min;
        onChange(Math.max(min, Math.min(max, n)));
    } });
    return h('span', { class: 'ri-num' }, input, unit ? h('span', { class: 'ri-unit' }, unit) : null);
}

export function textInput(value, onChange, attrs = {}) {
    const input = h('input', { type: 'text', class: 'ri-input', value: String(value ?? ''), ...attrs, oninput: () => onChange(input.value) });
    return input;
}

export function textArea(value, onChange, attrs = {}) {
    const el = h('textarea', { class: 'ri-input ri-textarea', rows: 3, ...attrs, oninput: () => onChange(el.value) });
    el.value = String(value ?? '');
    return el;
}

/** A labelled setting: plain label on top, the control, one line of help under it. */
export function field(label, help, ...control) {
    return h('div', { class: 'ri-field' },
        h('div', { class: 'ri-label' }, label),
        h('div', { class: 'ri-control' }, control),
        help ? h('div', { class: 'ri-help' }, help) : null);
}

export function section(title, ...kids) {
    return h('div', { class: 'ri-section' }, h('div', { class: 'ri-section-title' }, title), kids);
}

/** A card that opens and closes, in the Neon Sola style. */
export function foldCard(summaryKids, bodyKids, { open = false, cls = '' } = {}) {
    return h('details', { class: `ri-card ri-fold ${cls}`, open },
        h('summary', { class: 'ri-fold-head' }, h('span', { class: 'ri-chevron', 'aria-hidden': 'true' }, '›'), h('span', { class: 'ri-fold-title' }, summaryKids)),
        h('div', { class: 'ri-fold-body' }, bodyKids));
}

export function chip(text, cls = '') {
    return h('span', { class: `ri-chip ${cls}` }, text);
}

const TOKEN = /\{\{(char|user)(?:\.([A-Za-z]+))?\}\}|\{\{[^{}]*\}\}/g;

/** Show a version with its placeholders as small labelled chips, filled in for this chat. */
export function versionText(text) {
    const out = h('span', { class: 'ri-vtext' });
    const s = String(text ?? '');
    const n = names();
    let last = 0;
    for (const m of s.matchAll(TOKEN)) {
        if (m.index > last) out.appendChild(document.createTextNode(s.slice(last, m.index)));
        last = m.index + m[0].length;
        if (m[1]) {
            const role = m[1];
            let shown = role === 'char' ? n.char : n.user;
            if (m[2]) {
                const i = FORMS.indexOf(m[2].toLowerCase());
                if (i >= 0) {
                    shown = pronounForms(role)[i];
                    if (/^[A-Z]/.test(m[2])) shown = shown.charAt(0).toUpperCase() + shown.slice(1);
                }
            }
            out.appendChild(h('span', { class: `ri-token ri-token-${role}`, title: `${m[0]} : ${role === 'char' ? 'the character' : 'you'} in this chat` }, shown));
        } else {
            out.appendChild(h('span', { class: 'ri-token ri-token-raw', title: 'A SillyTavern macro' }, m[0]));
        }
    }
    if (last < s.length) out.appendChild(document.createTextNode(s.slice(last)));
    return out;
}

export function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
}

export function download(filename, text) {
    try {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const a = h('a', { href: url, download: filename, style: { display: 'none' } });
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
        return true;
    } catch { return false; }
}
