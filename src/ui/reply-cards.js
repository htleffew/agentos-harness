// Shared, text-only headers for the independently collapsible reply cards.
import { h } from './dom.js';

export function replyCardHeader({ icon, eyebrow, title, subtitle = '', badges = [] }) {
    return h('summary', { class: 'ri-reply-head' },
        h('span', { class: 'ri-reply-symbol', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'ri-reply-heading' },
            h('span', { class: 'ri-reply-eyebrow' }, eyebrow),
            h('span', { class: 'ri-reply-title' }, title),
            subtitle ? h('span', { class: 'ri-reply-subtitle' }, subtitle) : null),
        badges.length ? h('span', { class: 'ri-reply-badges', 'aria-hidden': 'true' }, badges.map(label => h('span', { class: 'ri-reply-badge' }, label))) : null,
        h('span', { class: 'ri-reply-chevron', 'aria-hidden': 'true' }, '⌄'));
}
