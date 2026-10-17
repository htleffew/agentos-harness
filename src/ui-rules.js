// Undercurrent — Chance Rules panel. Renders with strings and handles events by delegation on one root element.
// No SillyTavern globals: index.js passes an `api` object.
//
// api = {
//   getState(): {settings, options?, starterPacks?}   settings = extensionSettings.undercurrent.rules (see resolveRuleSet)
//   mutate(fn): void|Promise                          fn(settings) edits the settings in place; the api saves them
//   importFile(text, fileName): report|Promise<report> import + store (see importIntoSettings); report from importLoreBary
//   exportPack(packId): void|Promise                  download the pack JSON (packJson builds the text)
//   testRoll?(): result|Promise<result>               evaluateRules output for this turn, not committed
//   notify?(message, kind)                             toast
// }
//
// The settings helpers below are pure functions of the settings object so they can be tested without a DOM.

import { resolveRuleSet, describeTriggers, parseRuleJson, normalizeRule } from './rules.js';
import { importLoreBary, exportRules } from './lorebary.js';
import { STARTER_PACKS } from './rulepacks.js';
import { isPlainObject, deepClone } from './util.js';

export const MY_RULES_PACK = { id: 'my_rules', name: 'My rules', description: 'Rules you added by hand.', default_enabled: true };

// ---------------------------------------------------------------------------------------------------------------------
// Settings helpers (pure: mutate the given settings object)

export function ensureRulesSettings(s) {
    const out = isPlainObject(s) ? s : {};
    if (!isPlainObject(out.packs)) out.packs = {};
    if (!Array.isArray(out.user_packs)) out.user_packs = [];
    if (!isPlainObject(out.edits)) out.edits = {};
    return out;
}

function userPackOf(s, ruleId) {
    return (s.user_packs || []).find(up => (up.rules || []).some(r => r.id === ruleId)) || null;
}

export function setPackEnabled(s, packId, on) {
    ensureRulesSettings(s);
    s.packs[packId] = { ...(s.packs[packId] || {}), enabled: !!on };
    return s;
}

export function setRuleEnabled(s, rule, on) {
    ensureRulesSettings(s);
    const up = userPackOf(s, rule.id);
    if (up) {
        up.rules = up.rules.map(r => (r.id === rule.id ? { ...r, enabled: !!on } : r));
    } else {
        s.edits[rule.id] = { ...deepClone(s.edits[rule.id] || rule), enabled: !!on };
    }
    return s;
}

/** Save an edited or new rule. Built-in rules are stored as edits; new rules go to the "My rules" pack. */
export function saveRule(s, rule, { isNew = false } = {}) {
    ensureRulesSettings(s);
    const clean = deepClone(rule);
    const up = isNew ? null : userPackOf(s, clean.id);
    if (up) {
        up.rules = up.rules.map(r => (r.id === clean.id ? { ...clean, pack: undefined } : r));
        return s;
    }
    if (!isNew) {
        s.edits[clean.id] = clean;
        return s;
    }
    let mine = s.user_packs.find(p => p.pack?.id === MY_RULES_PACK.id);
    if (!mine) {
        mine = { pack: { ...MY_RULES_PACK }, rules: [] };
        s.user_packs.push(mine);
    }
    mine.rules = [...mine.rules.filter(r => r.id !== clean.id), { ...clean, pack: undefined }];
    return s;
}

export function deleteRule(s, ruleId) {
    ensureRulesSettings(s);
    const up = userPackOf(s, ruleId);
    if (up) up.rules = up.rules.filter(r => r.id !== ruleId);
    else s.edits[ruleId] = null;
    return s;
}

/** Undo edits/deletion of a built-in rule. */
export function resetRule(s, ruleId) {
    ensureRulesSettings(s);
    delete s.edits[ruleId];
    return s;
}

export function addUserPack(s, pack, rules) {
    ensureRulesSettings(s);
    const entry = { pack: deepClone(pack), rules: deepClone(rules).map(r => ({ ...r, pack: undefined })) };
    s.user_packs = [...s.user_packs.filter(p => p.pack?.id !== pack.id), entry];
    return s;
}

export function removeUserPack(s, packId) {
    ensureRulesSettings(s);
    s.user_packs = s.user_packs.filter(p => p.pack?.id !== packId);
    delete s.packs[packId];
    return s;
}

/** Import text (LoreBary plugin, lorebook or Undercurrent pack) and store it as a user pack. Returns the report. */
export function importIntoSettings(s, text, opts = {}) {
    const report = importLoreBary(text, opts);
    if (report.pack && report.rules.length) {
        const starterIds = new Set((opts.starterPacks || STARTER_PACKS).map(p => p.pack.id));
        if (starterIds.has(report.pack.id)) report.pack.id = `${report.pack.id}_imported`;
        addUserPack(s, report.pack, report.rules);
    }
    return report;
}

/** JSON text of a pack as currently resolved (built-in + edits, or a user pack). */
export function packJson(s, packId, { starterPacks = STARTER_PACKS, options } = {}) {
    const { packs, rules } = resolveRuleSet(s, starterPacks, options);
    const p = packs.find(x => x.id === packId);
    if (!p) return null;
    return JSON.stringify(exportRules({ ...p, default_enabled: p.enabled }, rules.filter(r => r.pack === packId)), null, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Rendering

export function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

const RULE_TEMPLATE = {
    id: 'my_new_rule',
    name: 'New rule',
    priority: 3,
    logic: 'all',
    triggers: [{ type: 'chance', pct: 15 }],
    cooldown: 3,
    action: { type: 'inject', pool: ['{{random_present}} does one small thing that shows they are {{mood}}.'], pick: 'random', placement: 'note' },
};

export function renderShell() {
    return `<div class="uc-rules">
  <div class="uc-rules-bar">
    <button type="button" class="menu_button" data-act="add">Add rule</button>
    <button type="button" class="menu_button" data-act="pick-lorebary" title="LoreBary plugin or lorebook JSON">Import LoreBary</button>
    <button type="button" class="menu_button" data-act="pick-pack">Import pack</button>
    <button type="button" class="menu_button" data-act="test" data-needs="testRoll">Test roll</button>
    <input type="file" accept=".json,application/json" data-file="lorebary" hidden>
    <input type="file" accept=".json,application/json" data-file="pack" hidden>
  </div>
  <div data-slot="report"></div>
  <div data-slot="editor"></div>
  <div data-slot="test"></div>
  <div data-slot="packs"></div>
</div>`;
}

function ruleRow(rule, s) {
    const edited = Object.prototype.hasOwnProperty.call(s.edits || {}, rule.id) && s.edits[rule.id] !== null;
    const meta = [describeTriggers(rule)];
    if (rule.cooldown) meta.push(`cooldown ${rule.cooldown}`);
    if (rule.sticky) meta.push(`sticky ${rule.sticky}`);
    if (rule.max_fires) meta.push(`max ${rule.max_fires}`);
    meta.push(`p${rule.priority}`);
    if (rule.action.type !== 'inject') meta.push(rule.action.type.replace('_', ' '));
    return `<li class="uc-rule${rule.enabled ? '' : ' is-off'}" data-rule="${escapeHtml(rule.id)}">
  <label class="uc-rule-toggle" title="Enable this rule"><input type="checkbox" data-act="rule-toggle" ${rule.enabled ? 'checked' : ''}><span class="uc-rule-name">${escapeHtml(rule.name)}${edited ? ' <em class="uc-badge">edited</em>' : ''}</span></label>
  <div class="uc-rule-meta">${escapeHtml(meta.join(' · '))}</div>
  ${rule.note ? `<div class="uc-rule-note">${escapeHtml(rule.note)}</div>` : ''}
  <div class="uc-rule-actions">
    <button type="button" class="menu_button" data-act="edit">Edit</button>
    ${edited ? '<button type="button" class="menu_button" data-act="reset">Reset</button>' : ''}
    <button type="button" class="menu_button" data-act="delete">Delete</button>
  </div>
</li>`;
}

/** Ids of a built-in pack's rules the user deleted. */
export function deletedBuiltins(s, packId, starterPacks = STARTER_PACKS) {
    const sp = (starterPacks || []).find(p => p.pack.id === packId);
    const edits = s?.edits || {};
    return sp ? sp.rules.map(r => r.id).filter(id => Object.prototype.hasOwnProperty.call(edits, id) && edits[id] === null) : [];
}

export function renderPacks(resolved, s, openPacks = new Set(), starterPacks = STARTER_PACKS) {
    if (!resolved.packs.length) return '<p class="uc-rules-empty">No packs yet.</p>';
    return resolved.packs.map(p => {
        const rules = resolved.rules.filter(r => r.pack === p.id);
        return `<details class="uc-pack${p.enabled ? '' : ' is-off'}" data-pack="${escapeHtml(p.id)}" ${openPacks.has(p.id) ? 'open' : ''}>
  <summary>
    <label class="uc-pack-toggle" title="Enable this pack"><input type="checkbox" data-act="pack-toggle" ${p.enabled ? 'checked' : ''}></label>
    <span class="uc-pack-name">${escapeHtml(p.name)}</span>
    <span class="uc-pack-count">${rules.length}${p.builtin ? '' : ' · imported'}</span>
  </summary>
  ${p.description ? `<p class="uc-pack-desc">${escapeHtml(p.description)}</p>` : ''}
  <div class="uc-pack-actions">
    <button type="button" class="menu_button" data-act="export">Export</button>
    ${p.builtin ? '' : '<button type="button" class="menu_button" data-act="remove-pack">Remove pack</button>'}
    ${p.builtin && deletedBuiltins(s, p.id, starterPacks).length ? `<button type="button" class="menu_button" data-act="restore-deleted">Restore ${deletedBuiltins(s, p.id, starterPacks).length} deleted</button>` : ''}
  </div>
  <ul class="uc-rule-list">${rules.map(r => ruleRow(r, s)).join('')}</ul>
</details>`;
    }).join('');
}

export function renderEditor({ ruleId = '', text = '', errors = [], isNew = false } = {}) {
    return `<div class="uc-rule-editor" data-editing="${escapeHtml(ruleId)}" data-new="${isNew ? '1' : ''}">
  <div class="uc-editor-head">${isNew ? 'New rule' : `Edit <code>${escapeHtml(ruleId)}</code>`} (JSON)</div>
  <textarea class="text_pole" rows="16" spellcheck="false" data-field="rule-json">${escapeHtml(text)}</textarea>
  ${errors.length ? `<ul class="uc-errors">${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : ''}
  <div class="uc-editor-actions">
    <button type="button" class="menu_button" data-act="save">Save</button>
    <button type="button" class="menu_button" data-act="cancel">Cancel</button>
  </div>
</div>`;
}

export function renderReport(report) {
    if (!report) return '';
    const list = (title, items, fmt) => (items?.length ? `<details class="uc-report-list"><summary>${escapeHtml(title)} (${items.length})</summary><ul>${items.slice(0, 200).map(i => `<li>${fmt(i)}</li>`).join('')}</ul></details>` : '');
    return `<div class="uc-report">
  <div class="uc-report-head"><b>${report.pack ? escapeHtml(report.pack.name) : 'Import'}</b> — ${report.rules?.length || 0} rule(s) created, ${report.skipped?.length || 0} skipped
    <button type="button" class="menu_button uc-report-close" data-act="close-report" aria-label="Close">×</button></div>
  ${(report.notes || []).length ? `<ul class="uc-report-notes">${report.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
  ${list('Skipped entries', report.skipped, i => `${escapeHtml(i.entry)} — ${escapeHtml(i.reason)}`)}
  ${list('Removed lines', report.removed, i => `${escapeHtml(i.entry)}: <q>${escapeHtml(i.line)}</q> — ${escapeHtml(i.reason)}`)}
  ${list('Flagged names', report.flagged, i => `${escapeHtml(i.entry)} (${escapeHtml((i.names || []).join(', '))}): <q>${escapeHtml(i.line)}</q>`)}
</div>`;
}

export function renderTest(result) {
    if (!result) return '';
    if (result.skipped) return `<div class="uc-test"><b>Test roll</b>: ${escapeHtml(result.trace?.[0]?.reason || 'nothing evaluated')} <button type="button" class="menu_button uc-report-close" data-act="close-test" aria-label="Close">×</button></div>`;
    const fired = result.fired || [];
    const rows = fired.map(f => `<li><code>${escapeHtml(f.rule)}</code> <span class="uc-test-kind">${escapeHtml(f.placement)}${f.sticky ? ' · sticky' : ''}</span><br>${escapeHtml(f.text)}</li>`).join('');
    const misses = (result.trace || []).filter(t => !/^fired|sticky/.test(t.reason) && !['disabled', 'pack off', 'triggers not met'].includes(t.reason));
    return `<div class="uc-test">
  <div class="uc-report-head"><b>Test roll</b> — ${fired.length} would fire (not saved)
    <button type="button" class="menu_button uc-report-close" data-act="close-test" aria-label="Close">×</button></div>
  ${rows ? `<ul class="uc-test-list">${rows}</ul>` : '<p class="uc-rules-empty">Nothing fires this turn.</p>'}
  ${(result.varSets || []).length ? `<p class="uc-test-vars">Variables: ${escapeHtml(result.varSets.map(v => `${v.name}=${v.value}`).join(', '))}</p>` : ''}
  ${misses.length ? `<details class="uc-report-list"><summary>Triggered but held back (${misses.length})</summary><ul>${misses.map(m => `<li><code>${escapeHtml(m.id)}</code> — ${escapeHtml(m.reason)}</li>`).join('')}</ul></details>` : ''}
</div>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Mounting

/**
 * Mount the panel into `root` (an element). Returns {refresh, destroy}.
 */
export function mountRulesPanel(root, api) {
    if (!root || !api) throw new Error('mountRulesPanel needs a root element and an api object');
    if (!root.querySelector('.uc-rules')) root.innerHTML = renderShell();
    const el = root.querySelector('.uc-rules');
    const slot = name => el.querySelector(`[data-slot="${name}"]`);
    const open = new Set();
    let editing = null; // {ruleId, isNew}
    const notify = (m, k = 'info') => { try { api.notify?.(m, k); } catch { /* ignore */ } };

    const state = () => {
        const st = api.getState() || {};
        const settings = st.settings || {};
        const resolved = resolveRuleSet(settings, st.starterPacks || STARTER_PACKS, st.options);
        return { settings, resolved, options: st.options, starterPacks: st.starterPacks || STARTER_PACKS };
    };
    const refresh = () => {
        const { settings, resolved, starterPacks } = state();
        slot('packs').innerHTML = renderPacks(resolved, settings, open, starterPacks);
        const t = el.querySelector('[data-needs="testRoll"]');
        if (t) t.hidden = typeof api.testRoll !== 'function';
    };
    const apply = async (fn) => {
        await api.mutate(fn);
        refresh();
    };
    const ruleOf = (id) => state().resolved.rules.find(r => r.id === id) || null;
    const showEditor = (opts) => {
        editing = { ruleId: opts.ruleId, isNew: !!opts.isNew };
        slot('editor').innerHTML = renderEditor(opts);
        slot('editor').querySelector('textarea')?.focus?.();
    };
    const closeEditor = () => { editing = null; slot('editor').innerHTML = ''; };
    const readFile = (input) => new Promise((resolve, reject) => {
        const f = input.files && input.files[0];
        if (!f) { resolve(null); return; }
        if (typeof f.text === 'function') { f.text().then(t => resolve({ text: t, name: f.name }), reject); return; }
        const r = new FileReader();
        r.onload = () => resolve({ text: String(r.result || ''), name: f.name });
        r.onerror = () => reject(r.error);
        r.readAsText(f);
    });

    const onClick = async (ev) => {
        const btn = ev.target.closest?.('[data-act]');
        if (!btn || !el.contains(btn) || btn.matches('input[type="checkbox"]')) return;
        const act = btn.dataset.act;
        const ruleId = btn.closest('[data-rule]')?.dataset.rule;
        const packId = btn.closest('[data-pack]')?.dataset.pack;
        try {
            switch (act) {
                case 'add': showEditor({ ruleId: '', text: JSON.stringify(RULE_TEMPLATE, null, 2), isNew: true }); break;
                case 'edit': {
                    const r = ruleOf(ruleId);
                    if (r) { const { pack: _p, ...rest } = r; showEditor({ ruleId, text: JSON.stringify(rest, null, 2) }); }
                    break;
                }
                case 'cancel': closeEditor(); break;
                case 'save': {
                    const text = slot('editor').querySelector('textarea')?.value ?? '';
                    const parsed = parseRuleJson(text, { options: state().options });
                    if (!parsed.ok) { showEditor({ ruleId: editing?.ruleId || '', text, errors: parsed.errors, isNew: editing?.isNew }); break; }
                    const rule = parsed.rule;
                    if (!editing?.isNew && editing?.ruleId && rule.id !== editing.ruleId) rule.id = editing.ruleId;
                    if (editing?.isNew && ruleOf(rule.id)) { showEditor({ ruleId: '', text, errors: [`A rule with id "${rule.id}" already exists.`], isNew: true }); break; }
                    const isNew = !!editing?.isNew;
                    await apply(s => saveRule(s, rule, { isNew }));
                    if (isNew) open.add(MY_RULES_PACK.id);
                    closeEditor();
                    refresh();
                    notify('Rule saved.', 'success');
                    break;
                }
                case 'delete': if (ruleId) { await apply(s => deleteRule(s, ruleId)); notify('Rule deleted.'); } break;
                case 'restore-deleted': if (packId) await apply(s => deletedBuiltins(s, packId, state().starterPacks).forEach(id => resetRule(s, id))); break;
                case 'reset': if (ruleId) await apply(s => resetRule(s, ruleId)); break;
                case 'export': if (packId) await api.exportPack(packId); break;
                case 'remove-pack': if (packId) await apply(s => removeUserPack(s, packId)); break;
                case 'pick-lorebary': el.querySelector('[data-file="lorebary"]')?.click(); break;
                case 'pick-pack': el.querySelector('[data-file="pack"]')?.click(); break;
                case 'test': slot('test').innerHTML = renderTest(await api.testRoll()); break;
                case 'close-report': slot('report').innerHTML = ''; break;
                case 'close-test': slot('test').innerHTML = ''; break;
                default: break;
            }
        } catch (e) {
            notify(`Chance rules: ${e?.message || e}`, 'error');
        }
    };

    const onChange = async (ev) => {
        const t = ev.target;
        try {
            if (t.matches?.('[data-act="pack-toggle"]')) {
                const packId = t.closest('[data-pack]')?.dataset.pack;
                if (packId) await apply(s => setPackEnabled(s, packId, t.checked));
            } else if (t.matches?.('[data-act="rule-toggle"]')) {
                const r = ruleOf(t.closest('[data-rule]')?.dataset.rule);
                if (r) await apply(s => setRuleEnabled(s, r, t.checked));
            } else if (t.matches?.('input[type="file"][data-file]')) {
                const file = await readFile(t);
                t.value = '';
                if (!file) return;
                const report = await api.importFile(file.text, file.name);
                if (report?.pack) open.add(report.pack.id);
                slot('report').innerHTML = renderReport(report);
                refresh();
            }
        } catch (e) {
            notify(`Chance rules: ${e?.message || e}`, 'error');
        }
    };

    const onToggle = (ev) => {
        const d = ev.target;
        if (d?.matches?.('details.uc-pack')) {
            if (d.open) open.add(d.dataset.pack); else open.delete(d.dataset.pack);
        }
    };
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('toggle', onToggle, true);
    refresh();
    return {
        refresh,
        destroy() {
            el.removeEventListener('click', onClick);
            el.removeEventListener('change', onChange);
            el.removeEventListener('toggle', onToggle, true);
        },
    };
}

export { normalizeRule };
