// Story, Writing and Director tabs: schema-driven, with a few callouts.

import { h } from '../dom.js';
import { callout } from '../controls.js';
import { entriesForTab } from '../model.js';
import { renderSettings, emptyState } from './common.js';

export function createSettingsTab(tabId, ctx) {
    const el = h('div', { class: 'uc2-tab-body' });
    const entries = entriesForTab(ctx.schema, tabId);
    if (tabId === 'story') {
        el.appendChild(callout('amber', 'fa-lightbulb', 'Standing settings.',
            'Each row is one line the narrator treats as law for this story. Grey rows send nothing and keep the preset default.'));
    }
    const before = entry => {
        if (tabId !== 'director') return null;
        if (/showrunner/i.test(entry.key) && entry.type === 'toggle') {
            return callout('purple', 'fa-clapperboard', 'One extra call, after the reply.',
                'The showrunner reads the story after each reply and writes a short note for the next turn. It runs in the background, never before a reply, and a new message or swipe cancels it.');
        }
        if (/reply_card|(^|\.)card$/i.test(entry.key) && entry.type === 'toggle') {
            return callout('info', 'fa-eye', 'Optional peek.',
                'Adds a closed “Behind the scenes” strip under each reply showing the hidden scene state. Display only: nothing from it is sent to the model.');
        }
        return null;
    };
    const wrap = h('div', { class: tabId === 'story' ? 'uc2-acc-list' : '' });
    el.appendChild(wrap);
    const controls = renderSettings(wrap, entries, ctx, { before, flat: tabId === 'story', tabId });
    if (!controls.length) el.appendChild(emptyState('fa-sliders', 'Nothing here yet', 'Settings for this tab load with the suite.'));
    return {
        el,
        refresh(settings) { for (const c of controls) c.update(settings); },
    };
}
