// Tiny DOM builder. Strings are always inserted as text nodes, so nothing from cards, chats or
// models can become markup. There is no innerHTML anywhere in the UI.

/**
 * h('div', {class:'a b', data:{k:'v'}, attrs:{role:'tab'}, aria:{label:'x'}, on:{click:fn}, text:'…'}, ...children)
 * Children: Node | string | number | null | false | array (flattened).
 */
export function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    applyProps(el, props);
    append(el, children);
    return el;
}

export function applyProps(el, props) {
    if (!props) return el;
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        switch (k) {
            case 'class':
                el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
                break;
            case 'data':
                for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) el.dataset[dk] = String(dv);
                break;
            case 'attrs':
                for (const [ak, av] of Object.entries(v)) if (av !== undefined && av !== null && av !== false) el.setAttribute(ak, av === true ? '' : String(av));
                break;
            case 'aria':
                for (const [ak, av] of Object.entries(v)) if (av !== undefined && av !== null) el.setAttribute(`aria-${ak}`, String(av));
                break;
            case 'on':
                for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
                break;
            case 'text':
                el.textContent = String(v);
                break;
            case 'vars':
                for (const [vk, vv] of Object.entries(v)) if (vv !== undefined && vv !== null) el.style.setProperty(vk, String(vv));
                break;
            default:
                if (k in el) el[k] = v;
                else el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    return el;
}

export function append(el, children) {
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false || c === true) continue;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

/** Font Awesome icon (decorative). */
export function icon(name, extra = '') {
    return h('i', { class: `fa-solid ${name} ${extra}`.trim(), aria: { hidden: 'true' } });
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

/** Replace an element's text only when it changed (keeps selection/caret elsewhere stable). */
export function setText(el, text) {
    const t = String(text ?? '');
    if (el.textContent !== t) el.textContent = t;
}

export function debounce(fn, ms) {
    let t = null;
    const d = (...args) => {
        clearTimeout(t);
        t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
    d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
    d.cancel = () => { clearTimeout(t); t = null; };
    return d;
}

let uid = 0;
export const nextId = (p = 'uc2') => `${p}-${++uid}`;

/** Await a value that may or may not be a promise; never throws. */
export async function settle(fnOrValue, fallback = null) {
    try {
        const v = typeof fnOrValue === 'function' ? fnOrValue() : fnOrValue;
        return (await v) ?? fallback;
    } catch (err) {
        console.warn('[Undercurrent UI]', err);
        return fallback;
    }
}

/** Call an optional api method safely; returns fallback when absent or failing. */
export function call(api, method, ...args) {
    try {
        if (api && typeof api[method] === 'function') return api[method](...args);
    } catch (err) {
        console.warn(`[Undercurrent UI] api.${method} failed`, err);
    }
    return undefined;
}

export function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function isPhone() {
    try { return window.matchMedia('(max-width: 768px)').matches; } catch { return false; }
}

/** localStorage with try/catch (private windows, TauriTavern webviews). */
export const store = {
    get(key, fallback = null) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch { return fallback; }
    },
    set(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
};

/**
 * Scroll `el` into view inside ONE scroll container only. Element.scrollIntoView also scrolls every scrollable
 * ancestor (the overlay, the page): on phones that shifted the whole modal sideways (found in the e2e run at 390px).
 * @param {Element} el
 * @param {Element} scroller
 * @param {{axis?:'x'|'y', align?:'center'|'start', smooth?:boolean}} [o]
 */
export function scrollWithin(el, scroller, { axis = 'y', align = 'start', smooth = false } = {}) {
    if (!el || !scroller || typeof scroller.scrollTo !== 'function') return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
    if (axis === 'x') {
        const delta = align === 'center' ? (er.left + er.width / 2) - (sr.left + sr.width / 2) : er.left - sr.left;
        scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior });
    } else {
        const delta = align === 'center' ? (er.top + er.height / 2) - (sr.top + sr.height / 2) : er.top - sr.top;
        scroller.scrollTo({ top: scroller.scrollTop + delta, behavior });
    }
}

