// Shared, text-only headers for the independently collapsible reply cards.
import { h } from './dom.js';

export function replyChip(text, tone = 'slate') {
    return h('span',{class:'ri-reply-chip','data-tone':tone},text);
}

export function replyCardHeader({ icon, eyebrow, title, subtitle = '', badges = [], chips = [] }) {
    return h('summary', { class: 'ri-reply-head' },
        h('span', { class: 'ri-reply-symbol', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'ri-reply-heading' },
            eyebrow ? h('span', { class: 'ri-reply-eyebrow' }, eyebrow) : null,
            h('span', { class: 'ri-reply-title' }, title),
            subtitle ? h('span', { class: 'ri-reply-subtitle' }, subtitle) : null,
            chips.length ? h('span',{class:'ri-reply-chip-rail'},chips.map(({text,tone})=>replyChip(text,tone))) : null),
        badges.length ? h('span', { class: 'ri-reply-badges', 'aria-hidden': 'true' }, badges.map(label => h('span', { class: 'ri-reply-badge' }, label))) : null,
        h('span', { class: 'ri-reply-chevron', 'aria-hidden': 'true' }, '⌄'));
}
