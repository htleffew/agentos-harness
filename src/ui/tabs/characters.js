// Characters tab: known characters from derived state (present first), each expandable with mind and
// intimacy profile. Fields are editable → api.setOverride / api.clearOverride.

import { h, icon, call, nextId } from '../dom.js';
import { entriesForTab, characterList, MIND_FIELDS, INTIMACY_FIELDS, mindValue, evidenceItem, personaAccent } from '../model.js';
import { renderSettings, emptyState } from './common.js';
import { panel } from '../controls.js';

/** Overrides known to the UI: api.getOverrides() when CORE offers it, else per-character flags, else this session. */
function overrideLookup(api, state, sessionEdits) {
    const all = call(api, 'getOverrides');
    return (entity, field) => {
        if (all && typeof all === 'object') {
            const e = all[entity];
            if (e && typeof e === 'object' && Object.prototype.hasOwnProperty.call(e, field)) return true;
            if (Object.prototype.hasOwnProperty.call(all, `${entity}.${field}`)) return true;
        }
        const top = state?.overridden?.[entity]; // CORE: state.overridden = {'char:<name>': ['mind.mood', ...]}
        if (Array.isArray(top) && (top.includes(field) || top.includes(field.replace(/^mind\./, '')))) return true;
        const name = entity.replace(/^char:/, '');
        const ov = state?.characters?.[name]?.overridden;
        if (Array.isArray(ov) && ov.includes(field)) return true;
        if (ov && typeof ov === 'object' && !Array.isArray(ov) && ov[field]) return true;
        return sessionEdits.has(`${entity}|${field}`);
    };
}

export function createCharactersTab(ctx) {
    const el = h('div', { class: 'uc2-tab-body' });
    const entries = entriesForTab(ctx.schema, 'characters');
    const settingsWrap = h('div', {});
    const controls = renderSettings(settingsWrap, entries, ctx, { tabId: 'characters' });
    const listEl = h('div', { class: 'uc2-char-list' });
    const countEl = h('span', { class: 'uc2-count' });
    el.appendChild(panel(null, null,
        h('div', { class: 'uc2-panel-head' }, h('h3', { class: 'uc2-panel-title' }, icon('fa-users'), 'Cast', countEl),
            h('span', { class: 'uc2-panel-note uc2-right' }, 'Present first')),
        listEl));
    if (controls.length) el.appendChild(settingsWrap);

    const expanded = new Set();
    const sessionEdits = new Set();
    let editing = 0;
    let pendingState = null;
    let isOverridden = () => false;

    const entity = name => `char:${name}`;

    function editedBadge(ent, field) {
        if (!isOverridden(ent, field)) return null;
        const clear = h('button', { class: 'uc2-edited', type: 'button', aria: { label: `Clear your edit of ${field}` } },
            icon('fa-pen'), 'edited', icon('fa-xmark'));
        clear.addEventListener('click', e => {
            e.stopPropagation();
            call(ctx.api, 'clearOverride', ent, field);
            sessionEdits.delete(`${ent}|${field}`);
            draw(ctx.getState());
        });
        return clear;
    }

    function startEdit(cell, ent, field, value, multiline) {
        editing++;
        cell.classList.add('is-editing');
        const input = multiline
            ? h('textarea', { class: 'uc2-textarea uc2-textarea-sm', rows: 4, aria: { label: `Edit ${field}` } })
            : h('input', { class: 'uc2-input', type: 'text', aria: { label: `Edit ${field}` } });
        input.value = value;
        const done = save => {
            if (!cell.classList.contains('is-editing')) return;
            cell.classList.remove('is-editing');
            editing--;
            if (save) {
                const raw = input.value;
                const next = multiline ? raw.split('\n').map(s => s.trim()).filter(Boolean) : raw.trim();
                call(ctx.api, 'setOverride', ent, field, next);
                sessionEdits.add(`${ent}|${field}`);
            }
            const st = pendingState || ctx.getState();
            pendingState = null;
            draw(st);
        };
        const ok = h('button', { class: 'uc2-btn uc2-btn-sm uc2-btn-live', type: 'button' }, icon('fa-check'), 'Save');
        const cancel = h('button', { class: 'uc2-btn uc2-btn-sm', type: 'button' }, 'Cancel');
        ok.addEventListener('click', () => done(true));
        cancel.addEventListener('click', () => done(false));
        input.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.stopPropagation(); done(false); }
            if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); done(true); }
        });
        const editor = h('div', { class: 'uc2-inline-editor' }, input, h('div', { class: 'uc2-inline-actions' }, cancel, ok));
        cell.querySelector('.uc2-cell-body').replaceChildren(editor);
        input.focus();
    }

    function mindCell(c, f) {
        const ent = entity(c.name);
        const field = `mind.${f.id}`;
        const value = mindValue(c.mind, f);
        const editBtn = h('button', { class: 'uc2-icon-btn uc2-cell-edit', type: 'button', aria: { label: `Edit ${f.label} for ${c.name}` } }, icon('fa-pen'));
        const cell = h('div', { class: ['uc2-cell', f.id === 'secret' ? 'is-secret' : '', value ? '' : 'is-empty'] },
            h('div', { class: 'uc2-cell-head' }, icon(f.icon), h('span', {}, f.label), editedBadge(ent, field), editBtn),
            h('div', { class: 'uc2-cell-body' },
                f.id === 'secret' && value
                    ? h('span', { class: 'uc2-secret', attrs: { tabindex: '0' }, aria: { label: 'Secret (focus or hover to reveal)' } }, value)
                    : (value || '—')));
        editBtn.addEventListener('click', () => startEdit(cell, ent, field, value, false));
        return cell;
    }

    function intimacyCell(c, f) {
        const ent = entity(c.name);
        const field = `intimacy.${f.id}`;
        const items = (Array.isArray(c.intimacy?.[f.id]) ? c.intimacy[f.id] : []).map(evidenceItem).filter(i => i.text || i.quote);
        const editBtn = h('button', { class: 'uc2-icon-btn uc2-cell-edit', type: 'button', aria: { label: `Edit ${f.label} for ${c.name}` } }, icon('fa-pen'));
        const cell = h('div', { class: ['uc2-cell', `uc2-int-${f.id}`, items.length ? '' : 'is-empty'] },
            h('div', { class: 'uc2-cell-head' }, icon(f.icon), h('span', {}, f.label), h('span', { class: 'uc2-count' }, String(items.length)), editedBadge(ent, field), editBtn),
            h('div', { class: 'uc2-cell-body' }, items.length
                ? h('ul', { class: 'uc2-evidence' }, items.map(i => h('li', {}, h('span', {}, i.text), i.quote ? h('q', { class: 'uc2-quote' }, i.quote) : null)))
                : '—'));
        const asText = items.map(i => (i.quote ? `${i.text} "${i.quote}"` : i.text)).join('\n');
        editBtn.addEventListener('click', () => startEdit(cell, ent, field, asText, true));
        return cell;
    }

    function charCard(c) {
        const bodyId = nextId('uc2-char');
        const open = expanded.has(c.name);
        const mood = mindValue(c.mind, MIND_FIELDS[0]);
        const anyEdit = [...MIND_FIELDS.map(f => `mind.${f.id}`), ...INTIMACY_FIELDS.map(f => `intimacy.${f.id}`)]
            .some(f => isOverridden(entity(c.name), f));
        const where = c.present ? h('span', { class: 'uc2-mini-pill uc2-mini-live' }, 'Present')
            : c.offscreen ? h('span', { class: 'uc2-mini-pill' }, icon('fa-person-walking-arrow-right'), 'Off-screen')
                : h('span', { class: 'uc2-mini-pill' }, c.lastSeen ? `Seen turn ${c.lastSeen}` : 'Known');
        const head = h('button', { class: 'uc2-char-head', type: 'button', aria: { expanded: String(open), controls: bodyId } },
            h('span', { class: 'uc2-avatar', aria: { hidden: 'true' }, vars: { '--uc2-accent': personaAccent(c.name) } }, c.name.slice(0, 1).toUpperCase()),
            h('span', { class: 'uc2-char-titles' },
                h('span', { class: 'uc2-char-name' }, c.name, anyEdit ? h('span', { class: 'uc2-edited-dot', attrs: { title: 'Has your edits' } }) : null),
                h('span', { class: 'uc2-char-sub' }, c.offscreen && !c.present ? c.offscreen : (mood ? `Mood: ${mood}` : 'No mind recorded yet'))),
            where,
            icon('fa-chevron-down', 'uc2-acc-chev'));
        const body = h('div', { class: 'uc2-char-body', id: bodyId, hidden: !open },
            h('div', { class: 'uc2-subhead' }, icon('fa-brain'), 'Mind'),
            h('div', { class: 'uc2-cell-grid' }, MIND_FIELDS.map(f => mindCell(c, f))),
            h('div', { class: 'uc2-subhead' }, icon('fa-heart'), 'Intimacy profile'),
            h('div', { class: 'uc2-cell-grid' }, INTIMACY_FIELDS.map(f => intimacyCell(c, f))));
        const card = h('div', { class: ['uc2-char', c.present ? 'is-present' : '', open ? 'is-open' : ''], data: { name: c.name } }, head, body);
        head.addEventListener('click', () => {
            const nowOpen = body.hidden;
            body.hidden = !nowOpen;
            head.setAttribute('aria-expanded', String(nowOpen));
            card.classList.toggle('is-open', nowOpen);
            if (nowOpen) expanded.add(c.name); else expanded.delete(c.name);
        });
        return card;
    }

    function draw(state) {
        if (editing > 0) { pendingState = state; return; }
        isOverridden = overrideLookup(ctx.api, state, sessionEdits);
        const list = characterList(state);
        countEl.textContent = String(list.length);
        if (!list.length) {
            listEl.replaceChildren(emptyState('fa-user-group', 'No characters yet', 'They appear here as the story introduces them, with what they want, know and hide.'));
            return;
        }
        listEl.replaceChildren(...list.map(charCard));
    }

    return {
        el,
        refresh(settings) { for (const c of controls) c.update(settings); },
        onState(state) { draw(state); },
        isBusy: () => editing > 0,
    };
}

