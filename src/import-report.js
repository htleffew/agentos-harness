// Import report (B46). After a preset or plugin file is read into the block bank and the option banks, code compares what
// the file held with what was stored. The report exists only when something was approximated or left out; a clean
// import keeps its short confirmation and nothing else. No model call: every check is a comparison of data.
//
// A row is { where, field, held, kept }: the block or list, the field, what the file held, what RI kept.
import { plainName, listItems } from './bank-import.js';
import { settings, saveSettings } from './store.js';

const ROLES = ['system', 'user', 'assistant'];
const clip = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}...` : t; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const approx = (where, field, held, kept) => ({ kind: 'approximated', where, field, held: clip(held), kept: clip(kept) });
const left = (where, field, held, kept = 'Not kept') => ({ kind: 'left out', where, field, held: clip(held), kept: clip(kept) });

/** What the file held that the readers do not keep. parsed: the JSON object, or the HTML text for a Workbench page. */
export function sourceLosses(format, parsed, result) {
    const rows = [];
    if (format === 'preset') {
        const read = new Set((result.blocks || []).map(b => b.source?.block));
        for (const p of parsed.prompts || []) {
            const name = plainName(p.name || p.identifier);
            if (!read.has(name)) continue;
            // The block bank keeps the in-chat position, depth and reply types (B56); storedLosses checks what it stored.
            if (p.role && !ROLES.includes(p.role)) rows.push(approx(name, 'Role', p.role, 'system'));
        }
    } else if (format === 'plugin') {
        for (const entry of Object.values(parsed.entries || {})) {
            const name = plainName(entry.name || entry.comment || `Entry ${entry.uid}`);
            const groups = entry.triggerGroups || [];
            if (groups.length > 1) rows.push(left(name, 'Trigger groups', `${groups.length} groups`, 'Only the first group'));
            for (const [kind, actions] of Object.entries(entry.actions || {})) {
                const skipped = [].concat(actions || []).filter(a => a?.type !== 'add_message' || !Array.isArray(a.pool));
                if (skipped.length) rows.push(left(name, 'Actions', `${plural(skipped.length, 'action')} of type ${[...new Set(skipped.map(a => a?.type || kind))].join(', ')}`));
            }
        }
        for (const d of result.data || []) rows.push(left(d.name, 'Plugin data', plural(d.count, 'entry', 'entries')));
    } else if (format === 'worldbook') {
        const entries = Object.values(parsed.entries || {});
        const keyed = entries.filter(e => (e.key || []).length);
        if (keyed.length) rows.push(left(plural(keyed.length, 'entry', 'entries'), 'Trigger keys', keyed.slice(0, 2).map(e => (e.key || []).join(', ')).join('; '), 'Text only; the block bank sends by stack, not by key'));
    } else if (format === 'workbench') {
        const manual = (result.blocks || []).find(b => b.name === 'Field Manual');
        if (manual && manual.text.length >= 20000) rows.push(approx('Field Manual', 'Text', 'More than 20000 characters', 'The first 20000 characters'));
    }
    for (const l of result.lists || []) if (l.stripped) rows.push(approx(l.name, 'Text', `${plural(l.stripped, 'item')} with macros or comments`, 'The visible wording, macros taken out'));
    return rows;
}

/**
 * Compare the read blocks and items with what was stored. blocks: the read blocks; records: the block bank's stored
 * records for this file; expected: [{ where, id, label, text }] items that were written; stored: Map of id to the item
 * read back from the bank.
 */
export function storedLosses({ blocks = [], records = [], expected = [], stored = new Map() } = {}) {
    const rows = [];
    const pool = [...records];
    for (const b of blocks) {
        const name = String(b.name || b.source?.block || 'Imported block');
        if (!String(b.text || '').trim()) { rows.push(left(name, 'Text', 'Empty', 'Block not stored')); continue; }
        const at = pool.findIndex(r => r.name === name);
        const rec = at >= 0 ? pool.splice(at, 1)[0] : null;
        if (!rec) { rows.push(left(name, 'Block', 'In the file', 'Not found in the block bank')); continue; }
        if (rec.text !== b.text) rows.push(approx(name, 'Text', b.text, rec.text));
        if (b.role && rec.role !== b.role) rows.push(approx(name, 'Role', b.role, rec.role));
        if (Number.isFinite(b.notBefore) && rec.notBefore !== b.notBefore) rows.push(left(name, 'Not before', `Reply ${b.notBefore}`, 'Sent from the first reply'));
        const kept = rec.placement || {};
        const depth = b.injection_depth === undefined ? 4 : b.injection_depth;
        if (b.injection_position === 1 && (kept.position !== 1 || kept.depth !== depth)) {
            rows.push(left(name, 'Position', `In the chat, ${depth} messages from the end`,
                kept.position === 1 ? `In the chat, ${kept.depth} messages from the end` : 'Placed by its place in the stack'));
        }
        const only = Array.isArray(b.injection_trigger) ? b.injection_trigger.filter(t => typeof t === 'string') : [];
        if (only.length && JSON.stringify(kept.triggers || []) !== JSON.stringify(only)) rows.push(left(name, 'Only for', only.join(', '), 'Sent for every kind of reply'));
    }
    for (const it of expected) {
        const got = stored.get(it.id);
        if (!got) { rows.push(left(it.where, 'Value', it.label || it.text, 'Not found in the bank')); continue; }
        if (got.text !== it.text) rows.push(approx(it.where, 'Text', it.text, got.text));
        else if ((got.label || '') !== (it.label || '')) rows.push(approx(it.where, 'Label', it.label, got.label));
    }
    return rows;
}

/** The report for one import: { file, at, approximated, leftOut, clean }. */
export function buildReport(file, rows, at = Date.now()) {
    const all = (rows || []).filter(Boolean);
    const approximated = all.filter(r => r.kind === 'approximated').map(({ kind, ...r }) => r);
    const leftOut = all.filter(r => r.kind === 'left out').map(({ kind, ...r }) => r);
    return { file: String(file), at, approximated, leftOut, clean: !approximated.length && !leftOut.length };
}

/**
 * The whole comparison for one finished import. found: readImportFile's result; picked: the lists written; group: their
 * import group; sent: sendBlocksToBlockBank's result; items: Map of id to every item now in the option banks.
 * Keeps the report and returns it, or null when nothing was lost.
 */
export function reportImport({ found, picked = [], group, sent = {}, items = new Map() }) {
    const expected = picked.flatMap(l => listItems(l, group).map(it => ({ where: l.name, id: it.id, label: it.label, text: it.text })));
    const records = (sent.stored || []).flatMap(r => r.stored || []);
    const rows = [...(found.losses || []), ...storedLosses({ blocks: sent.sent ? found.blocks : [], records, expected, stored: items })];
    return rememberReport(buildReport(found.file, rows));
}

/** The key a report is kept under: the same text importGroup puts in its second segment. */
export const reportKey = file => String(file).replace(/[^\w.-]+/g, '_').slice(0, 60);

/** Keep this import's report, replacing the last one for the same file; a clean import clears it. Returns the report when it has losses. */
export function rememberReport(report) {
    const st = settings();
    if (!st.importReports || typeof st.importReports !== 'object' || Array.isArray(st.importReports)) st.importReports = {};
    const key = reportKey(report.file);
    if (report.clean) delete st.importReports[key]; else st.importReports[key] = report;
    saveSettings();
    return report.clean ? null : report;
}

/** The kept report for a file name or group key, or null. */
export function reportFor(file) {
    const reports = settings().importReports;
    return (reports && Object.hasOwn(reports, reportKey(file)) ? reports[reportKey(file)] : null) || null;
}
