// Rules tab: chance settings, rule packs with enable switches, LoreBary import.

import { h, icon, call, settle, setText } from '../dom.js';
import { entriesForTab } from '../model.js';
import { renderSettings, emptyState } from './common.js';
import { panel, switchEl, setSwitch, callout } from '../controls.js';

function packView(p) {
    return {
        id: String(p.id ?? p.name ?? ''),
        name: String(p.name ?? p.label ?? p.id ?? 'Pack'),
        description: String(p.description ?? p.desc ?? ''),
        count: Array.isArray(p.rules) ? p.rules.length : Number(p.count ?? p.ruleCount ?? 0) || 0,
        enabled: !!(p.enabled ?? p.on),
        source: String(p.source ?? (p.imported ? 'imported' : '')),
    };
}

export function createRulesTab(ctx) {
    const el = h('div', { class: 'uc2-tab-body' });
    const entries = entriesForTab(ctx.schema, 'rules');
    const controls = renderSettings(el, entries, ctx, { tabId: 'rules' });

    const listEl = h('div', { class: 'uc2-stack' });
    el.appendChild(panel('Rule packs', 'fa-layer-group', listEl));
    let packs = [];

    async function loadPacks() {
        const raw = await settle(() => call(ctx.api, 'listRulePacks'), []);
        packs = (Array.isArray(raw) ? raw : []).map(packView);
        draw();
        ctx.onPacks?.(packs);
    }

    function draw() {
        if (!packs.length) {
            listEl.replaceChildren(emptyState('fa-dice', 'No packs loaded', 'Starter packs ship with the suite; LoreBary imports appear here too.'));
            return;
        }
        listEl.replaceChildren(...packs.map(p => {
            const sw = switchEl(p.enabled, `Enable ${p.name}`);
            const row = h('div', { class: ['uc2-row', 'uc2-toggle-row', p.enabled ? 'is-on' : ''] },
                h('div', { class: 'uc2-row-text' },
                    h('div', { class: 'uc2-row-label' }, icon('fa-dice-d20', 'uc2-row-icon'), p.name,
                        h('span', { class: 'uc2-count' }, `${p.count} rule${p.count === 1 ? '' : 's'}`),
                        p.source === 'imported' ? h('span', { class: 'uc2-mini-pill' }, 'Imported') : null),
                    p.description ? h('div', { class: 'uc2-row-help' }, p.description) : null),
                sw);
            const flip = e => {
                e?.stopPropagation();
                p.enabled = !p.enabled;
                setSwitch(sw, p.enabled);
                row.classList.toggle('is-on', p.enabled);
                call(ctx.api, 'setRulePackEnabled', p.id, p.enabled);
                ctx.onPacks?.(packs);
            };
            row.addEventListener('click', flip);
            sw.addEventListener('click', flip);
            return row;
        }));
    }

    // LoreBary import
    const ta = h('textarea', { class: 'uc2-textarea', rows: 6, spellcheck: false,
        attrs: { placeholder: 'Paste LoreBary chance rules (JSON or text export)…' }, aria: { label: 'LoreBary rules to import' } });
    const result = h('div', { class: 'uc2-import-result', attrs: { role: 'status', 'aria-live': 'polite' } });
    const btn = h('button', { class: 'uc2-btn uc2-btn-brand', type: 'button' }, icon('fa-file-import'), 'Import');
    btn.addEventListener('click', async () => {
        const text = ta.value.trim();
        if (!text) { setText(result, 'Paste something to import first.'); return; }
        btn.disabled = true;
        const res = await settle(() => call(ctx.api, 'importLoreBary', text), { ok: false, added: 0, warnings: ['Import is not available.'] });
        btn.disabled = false;
        const warnings = Array.isArray(res?.warnings) ? res.warnings : [];
        result.replaceChildren(
            h('div', { class: res?.ok ? 'uc2-ok' : 'uc2-bad' }, icon(res?.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'),
                res?.ok ? `Added ${Number(res.added) || 0} rule${Number(res.added) === 1 ? '' : 's'}.` : 'Nothing imported.'),
            warnings.length ? h('ul', { class: 'uc2-warn-list' }, warnings.slice(0, 12).map(w => h('li', {}, String(w)))) : null);
        if (res?.ok) { ta.value = ''; loadPacks(); }
    });
    el.appendChild(panel('Import from LoreBary', 'fa-file-import',
        callout('info', 'fa-circle-info', null, 'Imported rules become a pack you can switch off like any other. Nothing runs a model call: rules are dice and keyword triggers.'),
        ta, h('div', { class: 'uc2-panel-foot' }, result, btn)));

    return {
        el,
        refresh(settings) { for (const c of controls) c.update(settings); },
        onShow() { loadPacks(); },
        load: loadPacks,
    };
}
