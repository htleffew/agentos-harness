// Memory tab: enable toggle, allocation dashboard (working / archived / summarized, tokens saved), settings.

import { h, icon, setText, call, settle } from '../dom.js';
import { entriesForTab, memorySegments, formatTokens } from '../model.js';
import { renderSettings } from './common.js';
import { callout, panel, buildControl } from '../controls.js';

export function createMemoryTab(ctx) {
    const el = h('div', { class: 'uc2-tab-body' });
    const entries = entriesForTab(ctx.schema, 'memory');
    const enableEntry = entries.find(e => e.type === 'toggle' && /(^|\.)enabled?$/.test(e.key));

    el.appendChild(callout('green', 'fa-circle-info', 'Cache-friendly by design.',
        'Recalled memories go after the chat history, so the cached prefix of your prompt stays the same. Archiving makes no model calls; summaries are an optional background job after replies.'));

    const controls = [];
    if (enableEntry) {
        const ctl = buildControl({ ...enableEntry, icon: enableEntry.icon || 'fa-memory' }, ctx);
        ctl.el.classList.add('uc2-row-hero');
        el.appendChild(ctl.el);
        controls.push(ctl);
    }

    // Dashboard
    const saved = h('span', { class: 'uc2-glow-pill' }, icon('fa-floppy-disk'), h('span', {}, '~0 tokens kept out'));
    const bar = h('div', { class: 'uc2-membar', attrs: { role: 'img' } });
    const segEls = {};
    const legend = h('div', { class: 'uc2-legend' });
    for (const id of ['summarized', 'archived', 'working']) {
        segEls[id] = h('span', { class: `uc2-seg uc2-seg-${id}` });
        bar.appendChild(segEls[id]);
    }
    const legendCounts = {};
    for (const [id, label] of [['summarized', 'Summarized'], ['archived', 'Archived'], ['working', 'Working']]) {
        legendCounts[id] = h('b', {}, '0');
        legend.appendChild(h('span', { class: 'uc2-legend-item' }, h('span', { class: `uc2-dot uc2-seg-${id}` }), label, legendCounts[id]));
    }
    const status = h('div', { class: 'uc2-membar-status' });
    const runBtn = h('button', { class: 'uc2-btn uc2-btn-sm', type: 'button' }, icon('fa-wand-magic-sparkles'), 'Summarize now');
    runBtn.addEventListener('click', () => { call(ctx.api, 'runJob', 'memory_summary'); refreshStats(); });
    const dash = panel(null, null,
        h('div', { class: 'uc2-panel-head' }, h('h3', { class: 'uc2-panel-title' }, icon('fa-chart-gantt'), 'Context allocation'), saved),
        legend, bar,
        h('div', { class: 'uc2-membar-caps' }, h('span', {}, '← Oldest'), h('span', {}, 'Newest →')),
        h('div', { class: 'uc2-panel-foot' }, status, runBtn));
    dash.classList.add('uc2-dash');
    el.appendChild(dash);

    const rest = h('div', {});
    el.appendChild(rest);
    controls.push(...renderSettings(rest, entries, ctx, { skip: e => e === enableEntry, tabId: 'memory' }));

    async function refreshStats() {
        const stats = await settle(() => call(ctx.api, 'memoryStats'), null);
        const m = memorySegments(stats);
        for (const s of m.segments) {
            segEls[s.id].style.setProperty('--uc2-w', `${s.pct}%`);
            segEls[s.id].hidden = s.count === 0;
            setText(legendCounts[s.id], String(s.count));
        }
        bar.setAttribute('aria-label', m.segments.map(s => `${s.label} ${s.count}`).join(', '));
        setText(saved.lastChild, `~${formatTokens(m.tokensSaved)} tokens kept out`);
        setText(status, m.total ? `${m.total} messages · ${m.segments[2].count} sent raw` : 'No messages yet');
        bar.classList.toggle('is-empty', !m.total);
    }

    return {
        el,
        refresh(settings) { for (const c of controls) c.update(settings); },
        onState() { refreshStats(); },
        onShow() { refreshStats(); },
    };
}
