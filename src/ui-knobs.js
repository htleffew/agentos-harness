// Undercurrent — settings UI for the knob registry. Rendering is plain strings (pure, unit-testable); bindPanel()
// attaches ONE set of delegated listeners to the panel root and talks to index.js only through the `api` object.
// Mobile-first: single column, 44px touch targets, every action is a visible button (no hover-only affordances).

import { allKnobs, allGroups, groupMeta, deepEqual, coerce } from './knobs.js';
import { templatePlaceholders } from './util.js';

export function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

const domId = key => `uc_knob_${key.replace(/[^a-z0-9]/gi, '_')}`;

/** Should a knob row be visible for these filters? (searching shows advanced matches too) */
export function knobVisible(knob, { query = '', showAdvanced = false, onlyModified = false, modified = false } = {}) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (onlyModified && !modified) return false;
    if (terms.length) {
        const hay = searchText(knob);
        return terms.every(t => hay.includes(t));
    }
    return showAdvanced || !knob.advanced;
}

function searchText(knob) {
    return [knob.key, knob.label, knob.help, groupMeta(knob.group).label, ...(knob.options || []).map(o => `${o.label ?? ''} ${o.value}`)].join(' ').toLowerCase();
}

/** Ordered list value for an order-list knob: stored order, then any option not in it. */
export function orderedItems(knob, value) {
    const opts = (knob.options || []).map(o => String(o.value));
    const list = (Array.isArray(value) ? value : []).filter(v => opts.includes(v));
    for (const o of opts) if (!list.includes(o)) list.push(o);
    return list;
}

/** Move one item up (-1) or down (+1) in an ordered list. */
export function moveItem(list, item, dir) {
    const out = [...list];
    const i = out.indexOf(item);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= out.length) return out;
    [out[i], out[j]] = [out[j], out[i]];
    return out;
}

/** Unknown {{uc_*}} placeholders in a template (warned about in the UI). */
export function unknownPlaceholders(knob, text) {
    const known = new Set((knob.placeholders || []).map(p => p.name));
    return templatePlaceholders(text).filter(n => !known.has(n));
}

function control(knob, value, ctx) {
    const id = domId(knob.key);
    const attr = `id="${id}" data-knob-input="${esc(knob.key)}"`;
    switch (knob.type) {
        case 'bool':
            return `<label class="uc-switch" for="${id}"><input type="checkbox" ${attr}${value ? ' checked' : ''} /><span>${value ? 'On' : 'Off'}</span></label>`;
        case 'number':
        case 'int': {
            const lim = `${Number.isFinite(knob.min) ? ` min="${knob.min}"` : ''}${Number.isFinite(knob.max) ? ` max="${knob.max}"` : ''} step="${knob.step ?? (knob.type === 'int' ? 1 : 'any')}"`;
            if (knob.ui === 'slider') {
                const max = knob.key === 'events.drama' && Number.isFinite(ctx.values?.['events.drama_max']) ? ctx.values['events.drama_max'] : knob.max;
                return `<div class="uc-slider"><input type="range" ${attr} min="${knob.min ?? 0}" max="${max}" step="${knob.step ?? 0.1}" value="${esc(value)}" /><output>${esc(Number(value).toFixed(1))}</output></div>`;
            }
            return `<input type="number" class="text_pole" inputmode="${knob.type === 'int' ? 'numeric' : 'decimal'}" ${attr}${lim} value="${esc(value)}" />`;
        }
        case 'select': {
            let opts = knob.options || [];
            if (knob.ui === 'connection-profile') {
                const profiles = Array.isArray(ctx.connectionProfiles) ? ctx.connectionProfiles : [];
                opts = [{ value: '', label: 'Same as the current connection' }, ...profiles.map(p => ({ value: p.id, label: p.name || p.id }))];
                if (value && !profiles.some(p => p.id === value)) opts.push({ value, label: '(missing profile: falls back to current)' });
            }
            return `<select class="text_pole" ${attr}>${opts.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(value) ? ' selected' : ''}>${esc(o.label ?? o.value)}</option>`).join('')}</select>`;
        }
        case 'text':
            if (knob.ui === 'connection-profile') return control({ ...knob, type: 'select', options: [] }, value, ctx);
            return `<input type="text" class="text_pole" ${attr} value="${esc(value)}" autocomplete="off" />`;
        case 'textarea': {
            const builtin = knob.template && typeof knob.builtin === 'function' ? knob.builtin(ctx.values || {}) : '';
            const shown = value === '' && builtin ? builtin : value;
            const unknown = knob.template ? unknownPlaceholders(knob, shown) : [];
            const warn = unknown.length ? `<small class="uc-warn">Unknown placeholders (render as empty): ${unknown.map(u => `{{${esc(u)}}}`).join(', ')}</small>` : '';
            const docs = knob.placeholders?.length
                ? `<details class="uc-placeholders"><summary>Placeholders</summary><ul>${knob.placeholders.map(p => `<li><code>{{${esc(p.name)}}}</code> ${esc(p.help)}</li>`).join('')}</ul><small>SillyTavern macros such as {{user}} and {{char}} also work.</small></details>`
                : '';
            const restore = knob.template ? `<button type="button" class="menu_button uc-btn" data-act="restore">Restore default</button>` : '';
            return `<textarea class="text_pole uc-textarea${knob.template ? ' uc-template' : ''}" rows="${knob.rows || 4}" ${attr} spellcheck="false">${esc(shown)}</textarea>${warn}${docs}${restore}`;
        }
        case 'list': {
            if (knob.ui === 'order') {
                const items = orderedItems(knob, value);
                const label = v => esc((knob.options || []).find(o => String(o.value) === v)?.label ?? v);
                return `<ol class="uc-order" ${attr}>${items.map((it, n) => `<li data-item="${esc(it)}"><span>${label(it)}</span>`
                    + `<button type="button" class="menu_button uc-btn uc-icon" data-act="up" aria-label="Move up"${n === 0 ? ' disabled' : ''}>↑</button>`
                    + `<button type="button" class="menu_button uc-btn uc-icon" data-act="down" aria-label="Move down"${n === items.length - 1 ? ' disabled' : ''}>↓</button></li>`).join('')}</ol>`;
            }
            if (knob.options?.length) {
                const set = new Set(Array.isArray(value) ? value.map(String) : []);
                return `<div class="uc-chips" ${attr}>${knob.options.map(o => `<label class="uc-chip"><input type="checkbox" data-item="${esc(o.value)}"${set.has(String(o.value)) ? ' checked' : ''} /><span>${esc(o.label ?? o.value)}</span></label>`).join('')}</div>`;
            }
            return `<textarea class="text_pole uc-textarea" rows="${knob.rows || 4}" ${attr} placeholder="One per line">${esc((Array.isArray(value) ? value : []).join('\n'))}</textarea>`;
        }
        case 'json':
            return `<textarea class="text_pole uc-textarea uc-mono" rows="${knob.rows || 4}" ${attr} spellcheck="false">${esc(JSON.stringify(value, null, 2))}</textarea>`;
        default:
            return '';
    }
}

/**
 * One knob row.
 * @param {object} knob
 * @param {{values:object, overrides:object, chatAvailable:boolean, connectionProfiles?:object[], error?:string}} ctx
 */
export function renderKnobRow(knob, ctx = {}) {
    const values = ctx.values || {};
    const value = values[knob.key] ?? knob.default;
    const overridden = !!ctx.overrides && Object.hasOwn(ctx.overrides, knob.key);
    const modified = !deepEqual(value, knob.default);
    const chatOnly = knob.scope === 'chat';
    const cls = ['uc-knob', modified ? 'uc-modified' : '', overridden ? 'uc-chat' : '', knob.advanced ? 'uc-advanced' : ''].filter(Boolean).join(' ');
    const chatToggle = chatOnly
        ? `<span class="uc-scope-note">Per chat</span>`
        : `<label class="uc-chat-toggle"><input type="checkbox" data-act="chat"${overridden ? ' checked' : ''}${ctx.chatAvailable ? '' : ' disabled'} /><span>This chat only</span></label>`;
    return `<div class="${cls}" data-key="${esc(knob.key)}" data-group="${esc(knob.group)}" data-type="${knob.type}">
<div class="uc-knob-head"><label class="uc-knob-label" for="${domId(knob.key)}">${esc(knob.label)}</label>${modified ? '<span class="uc-badge">changed</span>' : ''}${overridden ? '<span class="uc-badge uc-badge-chat">this chat</span>' : ''}</div>
<div class="uc-knob-control">${control(knob, value, ctx)}</div>
${ctx.error ? `<small class="uc-warn" role="alert">${esc(ctx.error)}</small>` : ''}${knob.help ? `<small class="uc-knob-help">${esc(knob.help)}</small>` : ''}
<div class="uc-knob-actions"><code class="uc-key">${esc(knob.key)}</code>${chatToggle}<button type="button" class="menu_button uc-btn" data-act="reset"${modified || overridden ? '' : ' disabled'}>Reset</button></div>
</div>`;
}

export function renderGroup(group, knobs, ctx = {}) {
    const changed = knobs.filter(k => !deepEqual(ctx.values?.[k.key] ?? k.default, k.default)).length;
    return `<details class="uc-group" data-group="${esc(group.id)}"${ctx.open?.has?.(group.id) ? ' open' : ''}>
<summary><span class="uc-group-title">${esc(group.label)}</span><span class="uc-group-count">${knobs.length} settings${changed ? ` · ${changed} changed` : ''}</span></summary>
${group.description ? `<p class="uc-group-desc">${esc(group.description)}</p>` : ''}
<div class="uc-group-actions"><button type="button" class="menu_button uc-btn" data-act="reset-group">Reset this group</button></div>
${knobs.map(k => renderKnobRow(k, ctx)).join('\n')}
</details>`;
}

/**
 * The whole "All settings" panel.
 * @param {object} ctx {values, overrides, chatAvailable, connectionProfiles, profiles:{builtin:[{name,description}], user:[names]}, currentProfile, open:Set}
 */
export function renderPanel(ctx = {}) {
    const knobs = ctx.knobs || allKnobs();
    const groups = allGroups().filter(g => knobs.some(k => k.group === g.id));
    const builtin = ctx.profiles?.builtin || [];
    const user = ctx.profiles?.user || [];
    const opt = (name, label) => `<option value="${esc(name)}"${name === ctx.currentProfile ? ' selected' : ''}>${esc(label)}</option>`;
    return `<div class="uc-knobs-panel">
<div class="uc-knobs-top">
<h3>Undercurrent: all settings</h3>
<input type="search" class="text_pole uc-search" data-act="search" placeholder="Search settings (label, help or key)" aria-label="Search settings" />
<div class="uc-filters">
<label class="uc-chip"><input type="checkbox" data-act="advanced"${ctx.showAdvanced ? ' checked' : ''} /><span>Show advanced</span></label>
<label class="uc-chip"><input type="checkbox" data-act="modified" /><span>Only changed</span></label>
</div>
<small class="uc-chat-state">${ctx.chatAvailable ? '"This chat only" saves a setting into the current chat; it wins over the global value.' : 'Open a chat to set per-chat overrides.'}</small>
</div>
<details class="uc-profiles"${ctx.profilesOpen ? ' open' : ''}><summary>Profiles${ctx.currentProfile ? `: ${esc(ctx.currentProfile)}${ctx.profileModified ? ' (modified)' : ''}` : ''}</summary>
<div class="uc-profile-row">
<select class="text_pole" data-act="profile-select" aria-label="Profile">
<optgroup label="Built-in">${builtin.map(p => opt(p.name, p.name)).join('')}</optgroup>
${user.length ? `<optgroup label="Saved">${user.map(n => opt(n, n)).join('')}</optgroup>` : ''}
</select>
<button type="button" class="menu_button uc-btn" data-act="profile-load">Load</button>
<button type="button" class="menu_button uc-btn" data-act="profile-delete">Delete</button>
</div>
<small class="uc-knob-help" data-role="profile-desc">${esc(builtin.find(p => p.name === ctx.currentProfile)?.description || '')}</small>
<small class="uc-knob-help">Loading a profile resets every setting it does not mention (except Enabled, pause, debug and the hidden-pass connection).</small>
<div class="uc-profile-row"><input type="text" class="text_pole" data-act="profile-name" placeholder="New profile name" aria-label="New profile name" />
<button type="button" class="menu_button uc-btn" data-act="profile-save">Save current as…</button></div>
<div class="uc-profile-row">
<button type="button" class="menu_button uc-btn" data-act="export">Export JSON</button>
<button type="button" class="menu_button uc-btn" data-act="copy">Copy JSON</button>
<label class="menu_button uc-btn uc-file">Import file<input type="file" accept=".json,application/json,text/plain" data-act="import-file" /></label>
</div>
<textarea class="text_pole uc-textarea uc-mono" rows="3" data-act="import-text" placeholder="…or paste a profile JSON here"></textarea>
<button type="button" class="menu_button uc-btn" data-act="import-paste">Import pasted JSON</button>
<button type="button" class="menu_button uc-btn redWarningBG" data-act="reset-all">Reset ALL settings to defaults</button>
</details>
<div class="uc-status" role="status" aria-live="polite"></div>
<div class="uc-groups">
${groups.map(g => renderGroup(g, knobs.filter(k => k.group === g.id), ctx)).join('\n')}
</div>
<p class="uc-empty" hidden>No setting matches.</p>
</div>`;
}

/** Read the raw value from a knob control element (before coercion). */
export function readControl(knob, el) {
    switch (knob.type) {
        case 'bool': return !!el.checked;
        case 'list':
            if (knob.ui === 'order') return [...el.querySelectorAll('li[data-item]')].map(li => li.getAttribute('data-item'));
            if (knob.options?.length) return [...el.querySelectorAll('input[data-item]')].filter(i => i.checked).map(i => i.getAttribute('data-item'));
            return String(el.value ?? '');
        default: return el.value;
    }
}

/**
 * Attach delegated listeners. `api` (implemented in index.js):
 *   context() -> render ctx (values, overrides, chatAvailable, …); set(key, raw, {chat}) -> {ok, reason};
 *   reset(key); setChatOverride(key, on); resetGroup(id); resetAll(); loadProfile(name) -> message;
 *   saveProfile(name) -> message; deleteProfile(name) -> message; exportProfile() -> {filename, text};
 *   importProfile(text) -> message
 */
export function bindPanel(root, api) {
    if (!root || root.__ucBound) return;
    root.__ucBound = true;
    const state = { query: '', showAdvanced: !!root.querySelector('[data-act="advanced"]')?.checked, onlyModified: false };
    const status = (msg, isError = false) => {
        const el = root.querySelector('.uc-status');
        if (el) { el.textContent = msg || ''; el.classList.toggle('uc-warn', !!isError); }
    };
    const rowOf = el => el?.closest?.('.uc-knob');
    const knobOf = row => allKnobs().find(k => k.key === row?.getAttribute('data-key'));

    const rerenderRow = (row, error = '') => {
        const knob = knobOf(row);
        if (!knob) return;
        const wrap = document.createElement('div');
        wrap.innerHTML = renderKnobRow(knob, { ...api.context(), error });
        const fresh = wrap.firstElementChild;
        row.replaceWith(fresh);
        applyFilters();
        return fresh;
    };
    const rerenderAll = () => {
        const open = new Set([...root.querySelectorAll('details.uc-group[open]')].map(d => d.getAttribute('data-group')));
        const profilesOpen = !!root.querySelector('details.uc-profiles')?.open;
        const wrap = document.createElement('div');
        wrap.innerHTML = renderPanel({ ...api.context(), open, profilesOpen, showAdvanced: state.showAdvanced });
        const fresh = wrap.firstElementChild;
        root.replaceChildren(...fresh.childNodes);
        const search = root.querySelector('[data-act="search"]');
        if (search) search.value = state.query;
        const mod = root.querySelector('[data-act="modified"]');
        if (mod) mod.checked = state.onlyModified;
        applyFilters();
    };
    function applyFilters() {
        let any = false;
        for (const g of root.querySelectorAll('details.uc-group')) {
            let shown = 0;
            for (const row of g.querySelectorAll('.uc-knob')) {
                const knob = knobOf(row);
                const vis = !!knob && knobVisible(knob, { ...state, modified: row.classList.contains('uc-modified') || row.classList.contains('uc-chat') });
                row.hidden = !vis;
                if (vis) shown++;
            }
            g.hidden = shown === 0;
            if (state.query && shown) g.open = true;
            any ||= shown > 0;
        }
        const empty = root.querySelector('.uc-empty');
        if (empty) empty.hidden = any;
    }

    const commit = (row, raw) => {
        const knob = knobOf(row);
        if (!knob) return;
        const r = api.set(knob.key, raw, { chat: row.classList.contains('uc-chat') || knob.scope === 'chat' });
        const fresh = rerenderRow(row, r.ok ? '' : r.reason);
        status(r.ok ? `${knob.label}: saved${r.clamped ? ' (clamped to the allowed range)' : ''}${row.classList.contains('uc-chat') || knob.scope === 'chat' ? ' for this chat' : ''}.` : `${knob.label}: ${r.reason}`, !r.ok);
        if (knob.key === 'events.drama_max' || knob.key === 'director.prompt_style') rerenderAll();
        return fresh;
    };

    root.addEventListener('input', (e) => {
        const el = e.target;
        if (el.matches?.('[data-act="search"]')) { state.query = el.value; applyFilters(); return; }
        if (el.matches?.('input[type="range"][data-knob-input]')) {
            const out = el.parentElement?.querySelector('output');
            if (out) out.textContent = Number(el.value).toFixed(1);
        }
    });

    root.addEventListener('change', async (e) => {
        const el = e.target;
        const act = el.getAttribute?.('data-act');
        if (act === 'advanced') { state.showAdvanced = el.checked; applyFilters(); return; }
        if (act === 'modified') { state.onlyModified = el.checked; applyFilters(); return; }
        if (act === 'profile-select') {
            const d = root.querySelector('[data-role="profile-desc"]');
            if (d) d.textContent = (api.context().profiles?.builtin || []).find(p => p.name === el.value)?.description || '';
            return;
        }
        if (act === 'import-file') {
            const file = el.files?.[0];
            if (!file) return;
            const text = await file.text();
            status(api.importProfile(text));
            rerenderAll();
            return;
        }
        if (act === 'chat') {
            const row = rowOf(el);
            const knob = knobOf(row);
            if (!knob) return;
            api.setChatOverride(knob.key, el.checked);
            rerenderRow(row);
            status(el.checked ? `${knob.label}: now set for this chat only.` : `${knob.label}: this chat follows the global value again.`);
            return;
        }
        const row = rowOf(el);
        if (!row) return;
        const knob = knobOf(row);
        const input = el.closest('[data-knob-input]') || el;
        if (!knob || !input.hasAttribute('data-knob-input')) return;
        commit(row, readControl(knob, input));
    });

    root.addEventListener('click', (e) => {
        const btn = e.target.closest?.('[data-act]');
        if (!btn || btn.tagName === 'INPUT' || btn.tagName === 'SELECT' || btn.tagName === 'TEXTAREA') return;
        const act = btn.getAttribute('data-act');
        const row = rowOf(btn);
        const knob = knobOf(row);
        switch (act) {
            case 'reset':
                if (knob) { api.reset(knob.key); rerenderRow(row); status(`${knob.label}: back to default.`); if (knob.key === 'events.drama_max') rerenderAll(); }
                break;
            case 'restore':
                if (knob) { const fresh = commit(row, ''); fresh?.querySelector('textarea')?.focus(); }
                break;
            case 'up':
            case 'down': {
                if (!knob) return;
                const list = row.querySelector('[data-knob-input]');
                const item = btn.closest('li')?.getAttribute('data-item');
                const next = moveItem(readControl(knob, list), item, act === 'up' ? -1 : 1);
                const fresh = commit(row, next);
                fresh?.querySelector(`li[data-item="${CSS.escape(item)}"] [data-act="${act}"]`)?.focus();
                break;
            }
            case 'reset-group': {
                const g = btn.closest('details.uc-group')?.getAttribute('data-group');
                if (g) { api.resetGroup(g); rerenderAll(); status(`${groupMeta(g).label}: back to defaults.`); }
                break;
            }
            case 'reset-all':
                // Two taps instead of window.confirm (unreliable in mobile webviews).
                if (btn.dataset.armed === '1') {
                    api.resetAll(); rerenderAll(); status('All settings back to defaults.');
                } else {
                    btn.dataset.armed = '1';
                    const label = btn.textContent;
                    btn.textContent = 'Tap again to reset everything (this chat\'s overrides too)';
                    setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = label; } }, 5000);
                }
                break;
            case 'profile-load': {
                const name = root.querySelector('[data-act="profile-select"]')?.value;
                if (name) { status(api.loadProfile(name)); rerenderAll(); }
                break;
            }
            case 'profile-delete': {
                const name = root.querySelector('[data-act="profile-select"]')?.value;
                if (name) { status(api.deleteProfile(name)); rerenderAll(); }
                break;
            }
            case 'profile-save': {
                const name = root.querySelector('[data-act="profile-name"]')?.value?.trim();
                if (!name) { status('Type a name for the profile first.', true); break; }
                status(api.saveProfile(name));
                rerenderAll();
                break;
            }
            case 'export': {
                const { filename, text } = api.exportProfile();
                if (typeof api.download === 'function') {
                    Promise.resolve(api.download(filename, text))
                        .then(how => status(how === 'popup' ? 'Downloads are not available here: the JSON was shown for copying.' : `Exported ${filename}.`))
                        .catch(err => status(`Export failed: ${err?.message || err}. Use Copy JSON instead.`, true));
                    break;
                }
                try {
                    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    status(`Exported ${filename}. If nothing downloaded (some mobile builds), use Copy JSON.`);
                } catch (err) {
                    status(`Export failed: ${err?.message || err}. Use Copy JSON instead.`, true);
                }
                break;
            }
            case 'copy': {
                const { text } = api.exportProfile();
                const box = root.querySelector('[data-act="import-text"]');
                Promise.resolve(navigator.clipboard?.writeText?.(text)).then(() => status('Profile JSON copied.')).catch(() => {
                    if (box) { box.value = text; box.select(); }
                    status('Clipboard unavailable: the JSON is in the box below, copy it from there.');
                });
                break;
            }
            case 'import-paste': {
                const text = root.querySelector('[data-act="import-text"]')?.value || '';
                status(api.importProfile(text));
                rerenderAll();
                break;
            }
            default:
                break;
        }
    });

    applyFilters();
}

/** Validate a raw value against a knob without saving it (used by the slash commands' error messages). */
export function checkValue(knob, raw) {
    return coerce(knob, raw);
}
