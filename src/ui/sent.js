// What Was Sent tab, and the optional section under each reply.
import { h, button, foldCard, chip } from './dom.js';
import { recentRecords, statusLabel, sendAgain, undoDone, cancelResend, pickAgainNow, overdueList, checkAgain, clearQueue, rerollPartNow, setLock, isLocked } from '../engine.js';
import { loadSet, saveSet } from '../books.js';
import { writeEvent, readEvent } from '../events.js';
import { toast } from '../st.js';
import { settings } from '../store.js';
import { ctx, KEY, isChatOpen } from '../st.js';

const KIND = { new: 'New', continuing: 'Kept sending', resend: 'Sent again', repeat: 'New' };

function statusChip(it, checking) {
    if (checking && it.status === 'sent') return chip('Checking...', 'ri-chip-wait');
    const cls = { done: 'ri-chip-done', overdue: 'ri-chip-warn', pending: 'ri-chip-warn', missed: 'ri-chip-bad', continuing: 'ri-chip-wait', queued: 'ri-chip-warn' }[it.status] || '';
    return chip(statusLabel(it), cls);
}

/** "Keep until I turn it off": change the set itself so this category always uses this item. */
async function keepInSet(it, part) {
    try {
        const data = await loadSet(it.world);
        const entry = data?.entries?.[it.uid];
        if (!entry?.extensions?.ri?.categories) throw new Error('The set could not be read.');
        const ev = readEvent(entry, String(entry.comment || '').replace(/^(Story event|Writing style): /, ''));
        const cat = ev.categories.find(c => c.id === part.catId);
        if (!cat) throw new Error('That category is no longer in the set.');
        cat.mode = 'keepFixed'; cat.fixed = part.ids[0];
        writeEvent(data, ev);
        await saveSet(it.world, data);
        toast('success', `"${part.name}" now keeps "${part.items[0]}" until you turn it off in the set.`);
    } catch (e) { toast('error', `Could not change the set: ${e.message}`); }
}

function partRows(it, isLast, withButtons) {
    return h('div', { class: 'ri-parts' }, it.parts.map(part => {
        const locked = part.catId ? isLocked(it.key, part.catId) : false;
        const buttons = withButtons && part.catId ? h('div', { class: 'ri-row ri-row-tight' },
            isLast ? button('Pick again', () => rerollPartNow(it.key, part.catId), { kind: 'ghost', title: 'Pick a different item for this category only, and write a new reply' }) : null,
            button(locked ? 'Unlock for this chat' : 'Lock for this chat', () => setLock(it.key, part.catId, locked ? null : part.ids), { kind: 'ghost', title: locked ? 'Let the dice pick for this category again in this chat' : 'Use this pick for the rest of this chat. The set itself is unchanged.' }),
            button('Keep until I turn it off', () => keepInSet(it, part), { kind: 'ghost', title: 'Change the set so this category always uses this item, in every chat' })) : null;
        return h('div', { class: 'ri-part' }, h('span', { class: 'ri-k' }, part.name), h('span', { class: 'ri-v' }, part.items.join(' and '), locked ? chip('Locked for this chat', 'ri-chip-keep') : null), buttons);
    }));
}

function itemRow(id, rec, it, index, withButtons) {
    const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
    const buttons = [];
    if (withButtons && !it.noCheck && !('goalTask' in it)) {
        if (it.status === 'done') buttons.push(button('Undo done', () => undoDone(id, index), { kind: 'ghost', title: 'Mark it as not done, so it is sent again' }));
        if (it.status === 'overdue' || it.status === 'queued') buttons.push(button('Do not send again', () => cancelResend(id, index), { kind: 'ghost' }));
        else buttons.push(button('Send again', () => sendAgain(id, index), { kind: 'ghost', title: 'Send this instruction again with the next reply' }));
    }
    return h('div', { class: 'ri-sentitem' },
        h('div', { class: 'ri-sent-top' }, h('span', { class: 'ri-sent-name' }, it.name), statusChip(it, rec.checking)),
        h('div', { class: 'ri-grid' },
            'goalTask' in it ? (it.goalTask ? kv(it.goalTask.type === 'step' ? 'One-time step' : 'Repeatable action', it.goalTask.text) : null) : kv('Instruction set', it.world),
            kv('Why it was sent', `${KIND[it.kind] || 'New'}${it.misses ? ` (reminder ${it.misses})` : ''}${it.repeat ? ', same as before the swipe' : ''}`),
            kv('Exact text sent', it.text),
            Array.isArray(it.rules) && it.rules.length ? kv('Rules checked', it.rules.map(r => `${r.ok ? 'Followed' : 'Not followed'}: ${r.label}`).join('  |  ')) : null,
            it.quote ? kv('Shown by this part of the reply', `"${it.quote}"`) : null),
        Array.isArray(it.parts) && it.parts.length ? [h('div', { class: 'ri-label' }, 'What the dice picked'), partRows(it, rec === recentRecords(1)[0]?.rec, withButtons)] : null,
        buttons.length ? h('div', { class: 'ri-row ri-row-tight' }, buttons) : null);
}

function recordBody(id, rec, isLast, withButtons) {
    return [
        rec.agency ? h('div', { class: 'ri-note ri-note-warn' }, `The reply wrote for you: "${rec.agency.quote}"`) : null,
        rec.note ? h('div', { class: 'ri-note' }, rec.note) : null,
        rec.items.map((it, i) => itemRow(id, rec, it, i, withButtons)),
        withButtons && isLast ? h('div', { class: 'ri-row' },
            button('Pick again and write a new reply', () => pickAgainNow(), { title: 'Roll the instructions for this reply again and swipe to a new reply' }),
            settings().check.mode === 'off' ? null : button('Check this reply again', () => checkAgain(id), { kind: 'ghost', title: 'Use this after you edit the reply by hand' })) : null,
    ];
}

function summaryLine(rec) {
    const n = rec.items.length;
    if (rec.items.every(i => i.noCheck)) return rec.items.some(i => 'goalTask' in i) ? (rec.items.length > 1 ? 'goal and writing style sent' : 'goal sent') : 'writing style sent';
    const done = rec.items.filter(i => i.status === 'done').length;
    const waiting = rec.items.filter(i => ['overdue', 'queued'].includes(i.status)).length;
    const parts = [`${n} ${n === 1 ? 'instruction' : 'instructions'} sent`];
    if (rec.checking) parts.push('checking');
    else { if (done) parts.push(`${done} done`); if (waiting) parts.push(`${waiting} will be sent again`); }
    return parts.join(' · ');
}

export function renderSent(body) {
    if (!isChatOpen()) return;
    const st = settings();
    const waiting = overdueList();
    if (waiting.length) body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `Waiting to be sent again with the next reply: ${waiting.map(o => o.name).join(', ')}.`,
        h('div', { class: 'ri-row ri-row-tight' }, button('Do not send these again', () => clearQueue(), { kind: 'ghost' }))));
    if (st.check.mode === 'off') body.appendChild(h('div', { class: 'ri-note' }, 'Checking is off, so replies are not checked. Turn on "Check that it happened" in Settings to see Done and Overdue here.'));
    const records = recentRecords(30);
    if (!records.length) {
        body.appendChild(h('div', { class: 'ri-empty' }, 'Nothing has been sent in this chat yet. Turn an instruction set on for this chat in the Random Instructions tab, then send a message.'));
        return;
    }
    records.forEach((r, i) => {
        body.appendChild(foldCard(
            [h('span', { class: 'ri-sent-title' }, `Reply ${r.id}${r.isLast ? ' (newest)' : ''}`), h('span', { class: 'ri-sent-sub' }, summaryLine(r.rec))],
            recordBody(r.id, r.rec, r.isLast, true), { open: i === 0, cls: 'ri-sentcard' }));
    });
}

// ---------- under each reply (display only) ----------

function underBlock(id, rec) {
    return h('div', { class: 'ri-root ri-under', 'data-accent': 'sky' },
        foldCard([h('span', { class: 'ri-sent-title' }, 'What was sent with this reply'), h('span', { class: 'ri-sent-sub' }, summaryLine(rec))], recordBody(id, rec, false, false), { cls: 'ri-sentcard' }));
}

export function refreshUnderReplies() {
    try {
        const st = settings();
        const show = st.enabled && st.showUnder === 'display';
        const chat = ctx().chat || [];
        const seen = new Set();
        if (show) {
            for (const mes of document.querySelectorAll('#chat .mes')) {
                const id = Number(mes.getAttribute('mesid'));
                const rec = chat[id]?.extra?.[KEY];
                const block = mes.querySelector('.mes_block');
                if (!rec?.items?.length || !block) continue;
                const stamp = JSON.stringify([rec.time, rec.checking, rec.items.map(i => [i.status, i.quote]), rec.agency?.quote]);
                const old = block.querySelector(':scope > .ri-under');
                seen.add(mes);
                if (old && old.dataset.stamp === stamp) continue;
                const wasOpen = !!old?.querySelector('details')?.open;
                const fresh = underBlock(id, rec);
                fresh.dataset.stamp = stamp;
                if (wasOpen) fresh.querySelector('details').open = true;
                if (old) old.replaceWith(fresh); else block.appendChild(fresh);
            }
        }
        for (const el of document.querySelectorAll('#chat .mes .ri-under')) if (!seen.has(el.closest('.mes'))) el.remove();
    } catch (e) { console.warn('[Roleplay Instructions] under-replies', e); }
}
