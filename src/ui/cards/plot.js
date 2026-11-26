// Plot (DESIGN 6.2): one card for the thread trackers of all four presets. The Plot sections follow the memory
// design's Thread kind: capture files a thread record with its thread type (Open, Plotline, Track, Seed, Detail,
// Pending, Plan or Elsewhere), and each section reads the records of its types as they stood at this reply.
// Open threads, Plotlines, Planted details and Elsewhere draw from the older saved records too (reply-world.js); a
// section that card already drew is left to it, so a thread shows once. Tracks (Vexa's parallel story tracks with their
// last beats) and Pending events (Pura's promises, deadlines and threats with their stakes) come only from here.
import { timelineRows } from '../card-templates.js';
import { MEMORY, fold as foldChat, swipeEntries } from '../../memory/fold.js';
import { ctx } from '../../st.js';
import { partsOf, section } from './shared.js';

export const id = 'plot';

/** The sections this module draws and the thread types each reads. */
export const THREAD_SECTIONS = Object.freeze({
    threads: ['Open'], plotlines: ['Plotline'], tracks: ['Track'], elsewhere: ['Elsewhere', 'Plan'], details: ['Seed', 'Detail'], pending: ['Pending'],
});
const LABELS = Object.freeze({ threads: 'Open threads', plotlines: 'Plotlines', tracks: 'Tracks', elsewhere: 'Elsewhere', details: 'Planted details', pending: 'Pending events' });
const ICONS = Object.freeze({ threads: 'fa-circle-dot', plotlines: 'fa-scroll', tracks: 'fa-code-branch', elsewhere: 'fa-binoculars', details: 'fa-seedling', pending: 'fa-hourglass-half' });

/** The section headings a panel already shows, so a section the older card drew is not drawn twice. */
function drawnHeadings(panel) {
    try { return new Set([...(panel?.querySelectorAll?.('.ri-c-head') || [])].map(node => node.textContent.replace(/\d+$/, '').trim())); } catch { return new Set(); }
}

const STATUS = { done: 'done', resolved: 'done', failed: 'failed', retired: 'retired' };

/** The thread records of the chat as they stood at chat index `index`. */
export function threadsAt(index, host = ctx()) {
    try {
        const records = foldChat(host.chat || [], host.chatMetadata || {}, { before: index + 1 }).records || [];
        const threads = records.filter(record => record?.kind === 'thread');
        // the quote that last moved each thread (memory DESIGN 12.2): the evidence of its newest counted version
        const quotes = new Map();
        for (const message of host.chat || []) for (const e of swipeEntries(message)) if (e?.evidence?.[0]?.quote) quotes.set(e.id, e.evidence[0].quote);
        for (const e of host.chatMetadata?.[MEMORY]?.log || []) if (e?.evidence?.[0]?.quote) quotes.set(e.id, e.evidence[0].quote);
        return threads.map(record => {
            const quote = [...(record.versions || [])].reverse().map(v => quotes.get(v.entry)).find(Boolean);
            return quote ? { ...record, quote } : record;
        });
    } catch (error) {
        console.warn('[Roleplay Instructions] plot threads', error);
        return [];
    }
}

/** A timeline row for one thread record. A Pending record's text may carry "event | stakes | when". */
export function threadRow(record) {
    const [text, ...rest] = partsOf(record.text || record.subject || '');
    const due = record.story_time || record.due || '';
    const quote = record.quote ? `"${record.quote.length > 90 ? `${record.quote.slice(0, 87).trimEnd()}...` : record.quote}"` : '';
    const note = [record.subject && record.subject !== text ? record.subject : '', ...rest, due && `due ${due}`, quote].filter(Boolean).join(' · ');
    return { text, status: STATUS[record.status], note: note || undefined };
}

export function extend(env) {
    const wanted = Object.keys(THREAD_SECTIONS).filter(sectionId => env.section(sectionId) && env.on(sectionId));
    if (!wanted.length) return null;
    const threads = threadsAt(env.id);
    const groups = wanted.map(sectionId => [sectionId, threads.filter(record => THREAD_SECTIONS[sectionId].includes(record.threadType))]).filter(([, list]) => list.length);
    if (!groups.length) return null;
    const open = groups.flatMap(([, list]) => list).find(record => !STATUS[record.status]);
    return { first: open ? partsOf(open.text || open.subject)[0] : '', nodes: panel => {
        const drawn = drawnHeadings(panel);
        return groups.filter(([sectionId]) => !drawn.has(LABELS[sectionId])).map(([sectionId, list]) =>
            section(LABELS[sectionId], timelineRows(list.map(threadRow)), { iconName: ICONS[sectionId], count: list.length, id: sectionId }));
    } };
}
