// Option bank controls on Random story events and Random writing styles (B37): the pool sheet (one multi-select over
// a category's bank, opened as a partial sheet so the page behind stays in view) and the import box ("Import options
// from a preset or plugin file"). The import reads the file on the device and writes only to "RI Option banks" and
// the block bank.
import { h, button, select, chip } from './dom.js';
import { readImportFile, importGroup, listItems, sendBlocksToBlockBank } from '../bank-import.js';
import { editBankBook, banksNow, addBank, setBankItems, itemBias, BANK_BOOK } from '../banks.js';
import { toast, confirmBox } from '../st.js';
import { fitBottom } from './generate-sheet.js';
import { reportImport, reportFor } from '../import-report.js';
import { openImportReport } from './import-report.js';

let openSheet = null;

const BIAS_CHOICES = Array.from({ length: 21 }, (_, i) => { const n = 10 - i; return { value: n, label: n > 0 ? `+${n}` : String(n) }; });

/** The text on the closed pool control: the ticked count and the bank size. */
export function poolSummary(pool, items) {
    const ids = new Set(items.map(it => it.id));
    const ticked = (pool || []).filter(id => ids.has(id)).length;
    const on = items.filter(it => it.on).length;
    return ticked ? `${ticked} of ${items.length} ticked` : `None ticked: all ${on} that are on`;
}

const sourceText = it => it.source?.ours ? 'Roleplay Instructions' : [it.source?.work || it.source?.file, it.source?.block].filter(Boolean).join(', ');

/**
 * Open the pool sheet for one category. items: the bank's items. pool: the ticked ids. onChange(pool) runs on every
 * tick and on Clear. The sheet closes on Done, Escape or opening another.
 */
export function openPoolSheet({ title, items, pool, onChange, onClose, onBias }) {
    openSheet?.close();
    const doc = globalThis.document;
    const ticked = new Set(pool || []);
    const view = { query: '', group: '' };
    const titleId = `ri-pool-title-${Date.now().toString(36)}`;
    const count = h('p', { class: 'ri-pool-count', 'aria-live': 'polite' });
    const list = h('div', { class: 'ri-pool-list', role: 'group', 'aria-labelledby': titleId });
    const search = h('input', { type: 'search', class: 'ri-pool-search', placeholder: 'Search this bank', 'aria-label': `Search ${title}`,
        oninput: e => { view.query = e.target.value; render(); } });
    const groups = [...new Set(items.map(it => it.group).filter(Boolean))];
    const groupPick = groups.length ? select([{ value: '', label: 'Every item' }, ...groups.map(g => ({ value: g, label: `Imported: ${g.split(':')[1] || g}` }))], '', v => { view.group = v; render(); }, { 'aria-label': 'Show items from' }) : null;
    const changed = () => { onChange([...ticked]); render(); };
    const viewport = globalThis.visualViewport;
    // The host can move the fixed layer, so the sheet is placed against the visible bottom of the screen.
    const place = () => fitBottom(element, viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight);
    const close = () => { element.remove(); doc.removeEventListener('keydown', onKey, true); viewport?.removeEventListener('resize', place); if (openSheet === api) openSheet = null; onClose?.(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const element = h('section', { class: 'ri-pool-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-ri-pool-sheet': '' },
        h('div', { class: 'ri-pool-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-pool-head' },
            h('h2', { class: 'ri-pool-title', id: titleId }, title), count,
            h('div', { class: 'ri-pool-actions' },
                button('Clear', () => { ticked.clear(); changed(); }, { kind: 'ghost', title: 'Untick every item, so a roll draws from the whole bank' }),
                button('Done', close, { kind: 'primary' }))),
        h('div', { class: 'ri-pool-tools' }, search, groupPick),
        onBias ? h('p', { class: 'ri-pool-help', style: { margin: '0', color: 'var(--ri-text-muted)', fontSize: 'var(--ri-type-help)' } }, 'Weight on each value: +10 is about three times as likely, -10 is never rolled. It applies everywhere this bank is used.') : null,
        list);
    function render() {
        const q = view.query.trim().toLowerCase();
        const shown = items.filter(it => (!view.group || it.group === view.group) && (!q || `${it.label} ${it.text} ${sourceText(it)}`.toLowerCase().includes(q)));
        count.textContent = `${[...ticked].filter(id => items.some(it => it.id === id)).length} of ${items.length} ticked. None ticked draws from every item that is on.`;
        list.replaceChildren(...shown.map(it => {
            const box = h('input', { type: 'checkbox', class: 'ri-check', checked: ticked.has(it.id), 'data-ri-pool-item': it.id,
                onchange: () => { if (box.checked) ticked.add(it.id); else ticked.delete(it.id); changed(); } });
            const row = h('label', { class: `ri-pool-row ${it.on ? '' : 'ri-off'}`, style: { flex: '1 1 auto', minWidth: '0' } }, box,
                h('span', { class: 'ri-pool-text' }, h('span', { class: 'ri-pool-label' }, it.label || it.text),
                    it.label && it.label !== it.text ? h('span', { class: 'ri-pool-sub' }, it.text) : null,
                    h('span', { class: 'ri-pool-src' }, `${sourceText(it)}${it.on ? '' : ' (off in the bank)'}${it.new ? ' (new)' : ''}`)));
            if (!onBias) return row;
            // The weight of this value in every roll that draws from the bank: -10 never, 0 normal, +10 about three times as likely.
            const weight = select(BIAS_CHOICES, itemBias(it), v => { const n = Number(v); if (n) it.bias = n; else delete it.bias; onBias(it.id, n); },
                { 'aria-label': `Weight for ${it.label || it.text}`, class: 'ri-input ri-pool-weight', title: '+10 is about three times as likely, -10 is never rolled', style: { flex: '0 0 auto', minWidth: '76px', minHeight: 'var(--ri-hit-size)', alignSelf: 'center' } });
            return h('div', { class: 'ri-pool-item', style: { display: 'flex', alignItems: 'center', gap: 'var(--ri-gap)', borderBottom: '1px solid var(--ri-line-faint)' } }, row, weight);
        }), ...(shown.length ? [] : [h('p', { class: 'ri-empty' }, 'No item matches.')]));
    }
    render();
    doc.body.appendChild(element);
    place();
    viewport?.addEventListener('resize', place);
    doc.addEventListener('keydown', onKey, true);
    const api = { close, element };
    openSheet = api;
    return api;
}

export const closePoolSheet = () => openSheet?.close();

// ---------- import ----------

/** The import box. state lives on the editor route so a redraw keeps it. type: 'event' or 'style'. */
export function importBox(state, type, redraw) {
    const box = h('div', { class: 'ri-sheet-box', 'data-ri-import': '' }, h('div', { class: 'ri-h2' }, 'Import options from a preset or plugin file'));
    box.append(h('div', { class: 'ri-help' }, 'Pick a SillyTavern Chat Completion preset, a LoreBary plugin, a World Info book or a Writer’s Workbench page from this device. The file is only read here; value lists go to the option banks and instruction blocks to the block bank.'));
    const file = h('input', { type: 'file', accept: '.json,.html,.htm,application/json,text/html', 'aria-label': 'File to import', 'data-ri-import-file': '',
        onchange: async () => {
            const f = file.files?.[0];
            if (!f) return;
            try { state.found = readImportFile(f.name, await f.text()); state.error = ''; }
            catch (e) { state.found = null; state.error = e.message; }
            redraw();
        } });
    box.append(h('div', { class: 'ri-control' }, file));
    if (state.error) box.append(h('div', { class: 'ri-note ri-note-warn' }, state.error));
    const found = state.found;
    if (found) {
        const targets = [{ value: '', label: 'New dimension (its own name)' }, ...[...banksNow().values()].filter(b => !b.adult || found.lists.some(l => l.adult)).map(b => ({ value: b.id, label: `${b.name} (${b.items.length})` }))];
        box.append(h('div', { class: 'ri-help' }, `${found.file}: ${found.lists.length} value ${found.lists.length === 1 ? 'list' : 'lists'} and ${found.blocks.length} instruction ${found.blocks.length === 1 ? 'block' : 'blocks'}. Adult lists and sub-lists start unticked.`));
        const rows = h('div', { class: 'ri-versions ri-import-list' });
        for (const l of found.lists) {
            const tick = h('input', { type: 'checkbox', class: 'ri-check', checked: l.tick, 'aria-label': `Import ${l.name}`, onchange: () => { l.tick = tick.checked; } });
            rows.append(h('div', { class: 'ri-version ri-import-row' },
                h('label', { class: 'ri-vpick' }, tick, h('span', { class: 'ri-vbody' }, h('strong', {}, l.name), ` (${l.items.length}): ${l.items.slice(0, 3).map(i => i.label).join(', ')}${l.items.length > 3 ? ', ...' : ''}`)),
                h('div', { class: 'ri-chips' }, chip(`From: ${l.block || l.source?.block || found.file}`, 'ri-chip-group'), chip(l.pick === 'many' ? 'Pick many' : 'Pick one'),
                    l.adult ? chip('Adult') : null, l.nested ? chip('Sub-list') : null, l.outside ? chip("Not in the preset's order") : null),
                h('label', { class: 'ri-num' }, h('span', { class: 'ri-unit' }, 'Into'), select(targets, l.target || '', v => { l.target = v; }, { 'aria-label': `Target for ${l.name}` }))));
        }
        box.append(rows);
        box.append(h('div', { class: 'ri-row' },
            button('Import the ticked lists', async () => {
                const picked = found.lists.filter(l => l.tick);
                if (!picked.length && !found.blocks.length) { toast('info', 'Tick at least one list.'); return; }
                const group = importGroup(found.file);
                let items = 0;
                await editBankBook(book => {
                    for (const l of picked) {
                        const id = l.target || addBank(book, l.name, type, !!l.adult);
                        const entry = Object.values(book.entries).find(e => e?.extensions?.ri?.dim === id);
                        const add = listItems(l, group);
                        items += add.length;
                        setBankItems(book, id, [...entry.extensions.ri.items, ...add]);
                    }
                });
                const blocks = await sendBlocksToBlockBank(found.blocks);
                // B46: compare what was read with what was stored; the sheet opens only when something was lost.
                const now = new Map([...banksNow().values()].flatMap(b => b.items.map(it => [it.id, it])));
                const report = reportImport({ found, picked, group, sent: blocks, items: now });
                if (report) openImportReport(report);
                state.found = null;
                state.done = `${report ? 'Some fields were approximated or left out; see the import report. ' : ''}${items} ${items === 1 ? 'item' : 'items'} from ${picked.length} ${picked.length === 1 ? 'list' : 'lists'} went into "${BANK_BOOK}".${found.blocks.length ? blocks.sent ? ` ${blocks.sent} instruction blocks went to the block bank.` : ` ${blocks.waiting} instruction blocks were found; the block bank is not installed yet, so they were not written.` : ''}`;
                redraw();
            }, { kind: 'primary' }),
            button('Cancel', () => { state.found = null; redraw(); }, { kind: 'ghost' })));
    }
    if (state.done) box.append(h('p', { class: 'ri-note', role: 'status' }, state.done));
    // Imported groups: every item of one import carries its group, so it can be removed as one.
    const groups = new Map();
    for (const b of banksNow().values()) for (const it of b.items) if (it.group) { const g = groups.get(it.group) || { n: 0, banks: new Set() }; g.n++; g.banks.add(b.id); groups.set(it.group, g); }
    if (groups.size) {
        box.append(h('div', { class: 'ri-label' }, 'Imported groups'), ...[...groups].map(([g, info]) => h('div', { class: 'ri-version' },
            h('div', { class: 'ri-vbody' }, `${g.split(':')[1] || g}: ${info.n} ${info.n === 1 ? 'item' : 'items'} in ${info.banks.size} ${info.banks.size === 1 ? 'bank' : 'banks'}`),
            h('div', { class: 'ri-row ri-row-tight' }, reportFor(g.split(':')[1] || g) ? button('Import report', () => openImportReport(reportFor(g.split(':')[1] || g)), { kind: 'ghost' }) : null, button('Remove this group', async () => {
                if (!await confirmBox(`Remove the ${info.n} items of this import from "${BANK_BOOK}"?`)) return;
                await editBankBook(book => {
                    for (const id of info.banks) {
                        const entry = Object.values(book.entries).find(e => e?.extensions?.ri?.dim === id);
                        setBankItems(book, id, entry.extensions.ri.items.filter(it => it.group !== g));
                    }
                });
                redraw();
            }, { kind: 'danger' })))));
    }
    box.append(h('div', { class: 'ri-row' }, button('Close', () => { state.open = false; state.found = null; state.done = ''; redraw(); }, { kind: 'ghost' })));
    return box;
}

