// Shared card templates (DESIGN.md 6.5): label and value rows, block meters, gauges with a change chip, chip lists,
// timeline rows, quote blocks, avatar thumbnails, text grids, star rows, severity marks, emblem icons and the
// one-line roll template. Every card draws from these, so a story style (1.12) dresses them all through the
// --ri-style-* tokens. No emoji: marks are Font Awesome icons or typographic symbols (block characters, stars).
import { h } from './dom.js';

const icon = (name, extra = '') => h('i', { class: `fa-solid ${name} ${extra}`.trim(), 'aria-hidden': 'true' });
const blank = value => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

/** A saved value is a plain value, or { v, from } when it is carried from reply number `from`. */
export function unwrap(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'v')) return { value: raw.v, from: Number.isFinite(Number(raw.from)) ? Number(raw.from) : null };
    return { value: raw, from: null };
}

/** "from reply 12": a muted source mark for a carried value. */
export function carried(from, current) {
    if (from === null || from === undefined || from === current) return null;
    return h('span', { class: 'ri-c-source', title: `Carried from reply ${from}` }, `from reply ${from}`);
}

/** A value longer than this folds to one line and opens to its full text in place. */
export const FOLD_AT = 88;

/** A value that folds when long. The fold keeps the first line visible and the full text one tap away. */
export function foldedValue(text, { limit = FOLD_AT, label = '' } = {}) {
    const value = String(text ?? '');
    if (value.length <= limit) return h('span', { class: 'ri-c-value' }, value);
    return h('details', { class: 'ri-c-fold ri-c-fold-text' },
        h('summary', { title: label ? `${label}: show all` : 'Show all' }, h('span', { class: 'ri-c-clamp' }, value)));
}

/** A label and its value on one line where they fit. `value` may be text, a node, or an array of nodes. */
export function row(label, value, { from, current, tone, foldAt } = {}) {
    if (blank(value)) return null;
    const content = value instanceof Node || Array.isArray(value) ? value : foldedValue(value, { limit: foldAt, label });
    return h('div', { class: 'ri-c-row', 'data-tone': tone, 'data-carried': from !== null && from !== undefined && from !== current ? 'true' : undefined },
        h('span', { class: 'ri-c-label' }, label),
        h('span', { class: 'ri-c-data' }, content, carried(from, current)));
}

/** A group of rows; empty rows are left out and an empty group draws nothing. */
export function rows(list) {
    const kept = list.filter(Boolean);
    return kept.length ? h('div', { class: 'ri-c-rows' }, kept) : null;
}

/** A heading inside a card for one section or one subject. */
export function sectionHead(text, { icon: name, count } = {}) {
    return h('h4', { class: 'ri-c-head' }, name ? icon(name) : null, h('span', {}, text), count ? h('span', { class: 'ri-c-count' }, String(count)) : null);
}

/** `▮▮▮▮▯▯`: a block meter. The number follows so a screen reader and a glance both get the figure. */
export function blockMeter(value, { max = 10, blocks = 10, label = '' } = {}) {
    const n = Math.max(0, Math.min(max, Math.round(Number(value))));
    if (!Number.isFinite(Number(value))) return null;
    const filled = Math.round(n / max * blocks);
    return h('span', { class: 'ri-c-meter', role: 'img', 'aria-label': `${label ? label + ' ' : ''}${n} of ${max}` },
        h('span', { class: 'ri-c-blocks', 'aria-hidden': 'true' }, '▮'.repeat(filled) + '▯'.repeat(blocks - filled)),
        h('span', { class: 'ri-c-figure', 'aria-hidden': 'true' }, `${n}`));
}

/** A change chip: the step capture reported (-5 to +5) with its reason as captured. A step of 0 shows no chip. */
export function changeChip(delta, reason = '') {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) return null;
    const up = n > 0;
    return h('span', { class: 'ri-c-change', 'data-dir': up ? 'up' : 'down', title: reason || undefined },
        icon(up ? 'fa-caret-up' : 'fa-caret-down'), h('span', {}, `${up ? '+' : '−'}${Math.abs(n)}${reason ? ` ${reason}` : ''}`));
}

/** A level gauge with an optional change chip: a thin bar on a rail, the figure after it. */
export function gauge(value, { max = 10, label = '', delta, reason } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const pct = Math.max(0, Math.min(100, n / max * 100));
    return h('span', { class: 'ri-c-gauge' },
        h('span', { class: 'ri-c-rail', role: 'img', 'aria-label': `${label ? label + ' ' : ''}${n} of ${max}` },
            h('span', { class: 'ri-c-fill', style: { width: `${pct}%` } })),
        h('span', { class: 'ri-c-figure', 'aria-hidden': 'true' }, `${n}`),
        changeChip(delta, reason));
}

/** A row of chips. Items are strings or { text, tone, title }. */
export function chipList(items, { label = '' } = {}) {
    const list = (items || []).map(item => typeof item === 'string' ? { text: item } : item).filter(item => item?.text);
    if (!list.length) return null;
    return h('span', { class: 'ri-c-chips', role: 'list', 'aria-label': label || undefined },
        list.map(item => h('span', { class: 'ri-c-chip', role: 'listitem', 'data-tone': item.tone, title: item.title }, item.text)));
}

const STATUS_ICONS = { open: 'fa-circle-dot', done: 'fa-circle-check', resolved: 'fa-circle-check', retired: 'fa-circle-xmark', failed: 'fa-circle-xmark' };
const STATUS_WORDS = { open: 'Open', done: 'Resolved', resolved: 'Resolved', retired: 'Retired', failed: 'Failed' };

/** Timeline rows: a status mark, the text, and a muted note. Items are { text, status, note, when, node }. */
export function timelineRows(items) {
    const list = (items || []).filter(item => item && (item.text || item.node));
    if (!list.length) return null;
    return h('ul', { class: 'ri-c-timeline' }, list.map(item => h('li', { 'data-status': item.status || undefined },
        icon(STATUS_ICONS[item.status] || 'fa-circle', 'ri-c-mark'),
        h('span', { class: 'ri-c-step' },
            item.when ? h('span', { class: 'ri-c-when' }, item.when) : null,
            item.node || foldedValue(item.text),
            item.status ? h('span', { class: 'ri-c-status' }, STATUS_WORDS[item.status] || item.status) : null,
            item.note ? h('span', { class: 'ri-c-note' }, item.note) : null))));
}

/** A quote block, set in the story style's face with its speaker. */
export function quoteBlock(text, { by = '', italic = false, format } = {}) {
    const paragraphs = String(text ?? '').split(/\r?\n\s*/).map(line => line.trim()).filter(Boolean);
    if (!paragraphs.length) return null;
    return h('blockquote', { class: `ri-c-quote${italic ? ' ri-c-italic' : ''}` },
        paragraphs.map(line => h('p', {}, format ? format(line) : line)), by ? h('footer', {}, by) : null);
}

/** A plain list of short lines, each folding when long. */
export function bulletList(items) {
    const list = (items || []).map(item => String(item ?? '').trim()).filter(Boolean);
    if (!list.length) return null;
    return h('ul', { class: 'ri-c-list' }, list.map(text => h('li', {}, foldedValue(text))));
}

/** An avatar thumbnail: the picture when there is one, the first letter otherwise. */
export function avatar(name, src = '') {
    const letter = Array.from(String(name || '?').trim())[0] || '?';
    return h('span', { class: 'ri-c-avatar', 'aria-hidden': 'true', 'data-has-image': src ? 'true' : undefined },
        src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : letter);
}

/** A text grid: monospace cells, one string per row (the Map card, stat sheets). */
export function textGrid(lines) {
    const list = (Array.isArray(lines) ? lines : String(lines ?? '').split(/\r?\n/)).map(String).filter(line => line.length);
    if (!list.length) return null;
    return h('pre', { class: 'ri-c-grid', tabindex: '0', 'aria-label': 'Text grid' }, list.join('\n'));
}

/** `★★★☆☆`: a row of typographic stars for rarity. */
export function starRow(value, { max = 5, label = 'Rarity' } = {}) {
    const n = Math.max(0, Math.min(max, Math.round(Number(value))));
    if (!Number.isFinite(Number(value))) return null;
    return h('span', { class: 'ri-c-stars', role: 'img', 'aria-label': `${label} ${n} of ${max}` },
        h('span', { 'aria-hidden': 'true' }, '★'.repeat(n) + '☆'.repeat(max - n)));
}

const SEVERITY = {
    mild: ['Mild', 'fa-circle-info'],
    moderate: ['Moderate', 'fa-triangle-exclamation'],
    severe: ['Severe', 'fa-circle-exclamation'],
};

/** A severity mark: an icon and the word, so colour is never the only signal. `text` is the condition itself. */
export function severityMark(level, text = '') {
    const [word, mark] = SEVERITY[String(level || '').toLowerCase()] || ['', 'fa-circle'];
    return h('span', { class: 'ri-c-severity', 'data-level': String(level || '').toLowerCase() || undefined },
        icon(mark), text ? h('span', {}, text) : null, word ? h('span', { class: 'ri-c-status' }, word) : null);
}

/** The four faculties and their emblem icons (Sola's Heart Engine), in the order they are asked for. */
export const FACULTIES = Object.freeze([
    { id: 'ego', field: 'ego', label: 'Ego', icon: 'fa-crown' },
    { id: 'nerve', field: 'nerve', label: 'Nerve', icon: 'fa-bolt' },
    { id: 'body', field: 'faculty_body', label: 'Body', icon: 'fa-heart-pulse' },
    { id: 'psyche', field: 'faculty_psyche', label: 'Psyche', icon: 'fa-brain' },
]);

/** An emblem icon with its label and value. A number draws a block meter; anything else draws as text. */
export function emblem(faculty, raw) {
    const { value } = unwrap(raw);
    if (blank(value)) return null;
    const numeric = Number.isFinite(Number(value)) && String(value).trim() !== '';
    return h('div', { class: 'ri-c-emblem', 'data-faculty': faculty.id },
        h('span', { class: 'ri-c-emblem-mark', title: faculty.label }, icon(faculty.icon), h('span', { class: 'ri-c-label' }, faculty.label)),
        numeric ? blockMeter(value, { max: 10, blocks: 5, label: faculty.label }) : h('span', { class: 'ri-c-value' }, String(value)));
}

/**
 * The one-line roll template (6.9). B22 builds its Roll card from this: who, the attempt, the stat, the
 * difficulty, the total against it and the degree, with the die and modifier at the end of the same line.
 */
export function rollLine({ who, attempt, stat, difficulty, total, against, degree, die, modifier }) {
    const head = [attempt, stat, difficulty].filter(Boolean).join(', ');
    const result = Number.isFinite(Number(total)) && Number.isFinite(Number(against)) ? `${total} vs ${against}` : '';
    const tail = [Number.isFinite(Number(die)) ? `d20 ${die}` : '', Number.isFinite(Number(modifier)) ? `${Number(modifier) >= 0 ? '+' : '−'}${Math.abs(Number(modifier))}` : ''].filter(Boolean).join(' ');
    return h('div', { class: 'ri-c-oneline' },
        icon('fa-dice-d20', 'ri-c-mark'),
        h('span', { class: 'ri-c-line-text' }, [who ? `${who}: ` : '', head, result ? `: ${result}` : '', degree ? `, ${String(degree).toLowerCase()}` : ''].join('')),
        tail ? h('span', { class: 'ri-c-line-end' }, tail) : null);
}

/** "Not requested": a dim line naming sections or fields that are switched off, each linking to its switch. */
export function notRequestedLine(items, open) {
    if (!items.length) return null;
    return h('p', { class: 'ri-c-unrequested' }, 'Not requested: ',
        items.map((item, index) => [index ? ', ' : '',
            h('button', { type: 'button', class: 'ri-tray-link ri-c-link', onclick: () => open?.(item.key), title: 'Open the switch in Setup, Look, Reply tray' }, item.label)]).flat());
}
