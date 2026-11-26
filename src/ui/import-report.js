// The import report sheet (B46): what an import approximated or left out, grouped, one row per block or value.
// It opens only when the import lost something. It reuses the pool sheet's bottom-sheet frame.
import { h, button } from './dom.js';
import { fitBottom } from './generate-sheet.js';

let openSheet = null;

const rowView = r => h('div', { class: 'ri-version ri-report-row', 'data-ri-report-row': '', style: { display: 'block', borderBottom: '1px solid var(--ri-line-faint)', padding: 'var(--ri-gap) 0', overflowWrap: 'anywhere' } },
    h('strong', {}, r.where), ` (${r.field})`,
    h('div', { class: 'ri-pool-sub', style: { display: 'block' } }, `The file held: ${r.held}`),
    h('div', { class: 'ri-pool-sub', style: { display: 'block' } }, `RI kept: ${r.kept}`));

function group(title, id, rows) {
    if (!rows.length) return null;
    return h('section', { 'data-ri-report-group': id }, h('h3', { class: 'ri-h2', style: { margin: 'var(--ri-pad) 0 0' } }, `${title} (${rows.length})`), ...rows.map(rowView));
}

/** Open the report sheet for one report ({ file, approximated, leftOut }). Closes on Close or Escape. */
export function openImportReport(report) {
    openSheet?.close();
    const doc = globalThis.document;
    const viewport = globalThis.visualViewport;
    const titleId = `ri-report-title-${Date.now().toString(36)}`;
    const place = () => fitBottom(element, viewport ? viewport.offsetTop + viewport.height : globalThis.innerHeight);
    const close = () => { element.remove(); doc.removeEventListener('keydown', onKey, true); viewport?.removeEventListener('resize', place); if (openSheet === api) openSheet = null; };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const element = h('section', { class: 'ri-pool-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, 'data-ri-import-report': '' },
        h('div', { class: 'ri-pool-grab', 'aria-hidden': 'true' }),
        h('header', { class: 'ri-pool-head' },
            h('h2', { class: 'ri-pool-title', id: titleId }, 'Import report'),
            h('p', { class: 'ri-pool-count' }, `${report.file}: some fields were approximated or left out. Everything else came in as it was.`),
            h('div', { class: 'ri-pool-actions' }, button('Close', close, { kind: 'primary' }))),
        h('div', { class: 'ri-pool-list' }, group('Approximated', 'approximated', report.approximated), group('Left out', 'left-out', report.leftOut)));
    doc.body.appendChild(element);
    place();
    viewport?.addEventListener('resize', place);
    doc.addEventListener('keydown', onKey, true);
    const api = { close, element };
    openSheet = api;
    return api;
}
