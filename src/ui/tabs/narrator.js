// Narrator tab: persona cards (name, taste, OOC sample, ACTIVE pill, accent colour) + rule voice, author voice, OOC.

import { h, icon } from '../dom.js';
import { entriesForTab, getPath, personaAccent, personaLine } from '../model.js';
import { renderSettings, emptyState } from './common.js';

function firstSentence(text, max = 150) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
    const s = m ? m[1] : t;
    return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function createNarratorTab(ctx) {
    const el = h('div', { class: 'uc2-tab-body' });
    const entries = entriesForTab(ctx.schema, 'narrator');
    const personaEntry = entries.find(e => e.optionsRef === 'personas' || e.display === 'cards' || e.display === 'persona' || /persona$/i.test(e.key));
    const personas = Array.isArray(ctx.content?.personas) ? ctx.content.personas : [];
    const cards = [];
    let current = null;

    if (personaEntry && personas.length) {
        const grid = h('div', { class: 'uc2-persona-grid', attrs: { role: 'radiogroup' }, aria: { label: 'Narrator persona' } });
        for (const p of personas) {
            const accent = personaAccent(p);
            const card = h('button', { class: ['uc2-card', 'uc2-persona', p.wild ? 'is-wild' : ''], type: 'button',
                attrs: { role: 'radio' }, aria: { checked: 'false' }, data: { id: p.id }, vars: { '--uc2-accent': accent } },
            h('span', { class: 'uc2-card-strip', aria: { hidden: 'true' } }),
            h('span', { class: 'uc2-persona-top' },
                h('span', { class: 'uc2-persona-mono', aria: { hidden: 'true' } }, String(p.name || p.id || '?').slice(0, 1).toUpperCase()),
                h('span', { class: 'uc2-persona-name' }, p.name || p.id),
                p.wild ? h('span', { class: 'uc2-mini-pill uc2-mini-wild' }, 'Wild') : null,
                h('span', { class: 'uc2-active-pill' }, icon('fa-check'), 'Active')),
            h('span', { class: 'uc2-persona-taste' }, personaLine(p)),
            p.ooc ? h('span', { class: 'uc2-persona-ooc' }, icon('fa-comment-dots'), h('span', {}, firstSentence(p.ooc.replace(/^\s*out of character\s*[,:;-]?\s*/i, '').replace(/^./, c => c.toUpperCase()), 120))) : null);
            card.addEventListener('click', () => {
                mark(p.id);
                ctx.set(personaEntry.key, p.id);
            });
            grid.appendChild(card);
            cards.push(card);
        }
        el.appendChild(h('div', { class: 'uc2-section' },
            h('h3', { class: 'uc2-section-label' }, 'Narrator persona'),
            h('p', { class: 'uc2-section-note' }, personaEntry.help || 'Taste, event appetite and out-of-character voice. Never appears in the story.'),
            grid));
    } else if (!entries.length) {
        el.appendChild(emptyState('fa-masks-theater', 'No personas loaded', 'Narrator personas come from the suite content.'));
    }

    const mark = id => {
        current = id;
        for (const c of cards) {
            const on = c.dataset.id === String(id);
            c.setAttribute('aria-checked', String(on));
            c.classList.toggle('is-active', on);
        }
    };

    const rest = h('div', {});
    el.appendChild(rest);
    const controls = renderSettings(rest, entries, ctx, { skip: e => e === personaEntry, tabId: 'narrator',
        label: sec => (personaEntry && sec === personaEntry.section ? 'Voice' : undefined) });

    return {
        el,
        refresh(settings) {
            if (personaEntry) {
                const v = getPath(settings, personaEntry.key) ?? personaEntry.default;
                if (v !== current) mark(v);
            }
            for (const c of controls) c.update(settings);
        },
    };
}
