// What the parity cards (B20) share: reading a reply's saved tracker values, splitting a captured value into items and
// parts, and the small pieces every card draws with. The values are those capture saves per reply and swipe
// (src/cards/catalog.js, header): a string, a number, a list, or { v, from } when carried from an earlier reply.
// Capture writes one item per list entry and "a | b | c" for the parts of one item (catalog HINTS); a card also reads
// an object item with named fields, so a richer capture answer draws the same way.
import { h } from '../dom.js';
import { carried, notRequestedLine, row, sectionHead, unwrap } from '../card-templates.js';
import { notRequested } from '../../cards/catalog.js';
import { ctx, isReply } from '../../st.js';

export const icon = (name, extra = '') => h('i', { class: `fa-solid ${name} ${extra}`.trim(), 'aria-hidden': 'true' });
export const present = value => value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length);
export const fold = value => String(value ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const firstLine = text => String(text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';

/** The saved values of one card on a reply record: an object, a list of per-subject objects, or undefined. */
export const trackerOf = (rec, cardId) => (rec?.tracker && typeof rec.tracker === 'object' ? rec.tracker[cardId] : undefined);

/** The number of the reply at chat index `index` (the opening is 0), the same count "from reply 12" uses. */
export function replyNumberAt(index, chat = safeChat()) {
    let number = 0;
    for (let at = 1; at <= index && at < chat.length; at++) if (isReply(chat[at])) number++;
    return number;
}

function safeChat() { try { return ctx().chat || []; } catch { return []; } }

/** A saved value with where it came from: { value, from, mark } where mark is the "from reply 12" note or null. */
export function read(raw, env) {
    const { value, from } = unwrap(raw);
    return { value, from, mark: carried(from, replyNumberAt(env?.id ?? 0)) };
}

const BULLET = /^\s*(?:[-*•·]|\d+[.)])\s+/;

/**
 * A value as a list of items. A list keeps its entries; an object is one item; text splits into lines, and also at
 * semicolons when `semi` is set. Bullets and numbering at the start of a line are dropped.
 */
export function itemsOf(raw, { semi = false } = {}) {
    const value = unwrap(raw).value;
    if (!present(value)) return [];
    if (Array.isArray(value)) return value.map(item => unwrap(item).value).filter(present).map(item => (typeof item === 'string' ? item.replace(BULLET, '').trim() : item)).filter(present);
    if (typeof value === 'object') return [value];
    return String(value).split(semi ? /\r?\n|;\s*/ : /\r?\n/).map(line => line.replace(BULLET, '').trim()).filter(Boolean);
}

/**
 * Per-subject values of a card (characters, emotions, relationships): one entry per saved subject with its rows, for
 * the [key, label] fields that are on and have a value. A carried value keeps its "from reply 12" mark.
 */
export function subjectRows(env, raw, fields) {
    const current = replyNumberAt(env.id);
    return (Array.isArray(raw) ? raw : []).filter(item => item && typeof item === 'object' && String(item.name ?? '').trim())
        .map(item => ({ name: String(item.name).trim(), item, rows: fields.filter(([key]) => env.on(key)).map(([key, label]) => {
            const { value, from } = unwrap(item[key]);
            return present(value) ? row(label, Array.isArray(value) ? value.join(', ') : String(value), { from, current }) : null;
        }).filter(Boolean) }))
        .filter(entry => entry.rows.length);
}

/** The parts of one item written "a | b | c". */
export const partsOf = text => String(text ?? '').split(/\s*\|\s*/).map(part => part.trim());

/** "Name: rest" as [name, rest] when the head is a short label; otherwise ['', text]. */
export function headed(text) {
    const match = /^([^:\n]{1,60}?):\s+([\s\S]+)$/.exec(String(text ?? '').trim());
    return match ? [match[1].trim(), match[2].trim()] : ['', String(text ?? '').trim()];
}

/** "owner: Hale" as ['owner', 'Hale']; a part without a short label gives ['', part]. */
export function labelled(part) {
    const match = /^([\p{L} ]{2,24}):\s*([\s\S]*)$/u.exec(String(part ?? '').trim());
    return match ? [match[1].trim().toLowerCase(), match[2].trim()] : ['', String(part ?? '').trim()];
}

/** Text of an item that may be a string or an object with one of `keys`. */
export const pick = (item, ...keys) => {
    if (typeof item !== 'object' || item === null) return '';
    for (const key of keys) if (present(item[key])) return Array.isArray(item[key]) ? item[key].join(', ') : String(item[key]);
    return '';
};

/** A section with its heading; nothing when it has nothing to show. */
export function section(label, nodes, { iconName, count, id } = {}) {
    const kept = [nodes].flat(6).filter(Boolean);
    if (!kept.length) return null;
    return h('section', { class: 'ri-c-section', 'data-section': id || undefined }, sectionHead(label, { icon: iconName, count }), kept);
}

/** A block for one subject: a name in the accent and what follows. */
export function subject(name, nodes, { mark, attrs = {} } = {}) {
    const kept = [nodes].flat(6).filter(Boolean);
    if (!kept.length) return null;
    return h('section', { class: 'ri-c-person', 'data-subject': name || undefined, ...attrs },
        h('div', { class: 'ri-c-person-head' }, h('strong', {}, name || 'Unnamed'), mark || null), kept);
}

/** The "Not requested" line of a card, linking each switched-off section to its switch. */
export const footerOf = (env, openSwitch) => notRequestedLine(notRequested(env.config, env.def.id), openSwitch);

/** Copy text to the clipboard, with the selected-textarea fallback older WebViews need. */
export async function copyText(text) {
    try {
        await globalThis.navigator.clipboard.writeText(text);
        return true;
    } catch {
        const doc = globalThis.document;
        const area = h('textarea', { value: text, readOnly: true, style: { position: 'fixed', left: '-9999px', top: '0' } });
        doc.body.append(area);
        area.select();
        let ok = false;
        try { ok = doc.execCommand('copy'); } catch { ok = false; }
        area.remove();
        return ok;
    }
}

/** A small button in the card's own row of actions. */
export function cardButton(label, iconName, onclick, { aria, title, extraClass = '' } = {}) {
    return h('button', { type: 'button', class: `ri-bar-btn ri-c-action ${extraClass}`.trim(), 'aria-label': aria || label, title: title || undefined, onclick },
        icon(iconName), h('span', {}, label));
}

/** A button that runs `work` and shows its result word for two seconds. */
export function actionButton(label, iconName, work, opts = {}) {
    const node = cardButton(label, iconName, async event => {
        event?.stopPropagation?.();
        let word = '';
        try { word = await work(); } catch (error) { word = error?.message || 'Failed'; console.warn('[Roleplay Instructions] card action', error); }
        const text = node.lastChild;
        if (!word || !text) return;
        text.textContent = word;
        setTimeout(() => { text.textContent = label; }, 2000);
    }, opts);
    return node;
}
