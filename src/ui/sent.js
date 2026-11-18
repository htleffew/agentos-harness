import { replyCardHeader } from './reply-cards.js';
import { refreshGuidedControl } from './guided.js';
import { snapshotState, snapshotScene } from '../state.js';
import { characterStateCard, sceneEditor } from './state.js';
// What Was Sent tab, and the optional section under each reply.
import { h, button, foldCard, chip } from './dom.js';
import { recentRecords, statusLabel, sendAgain, undoDone, cancelResend, pickAgainNow, overdueList, checkAgain, clearQueue, rerollPartNow, setLock, isLocked } from '../engine.js';
import { loadSet, saveSet, entriesOf, canonSet, setName } from '../books.js';
import { shownChanges, describeChange, undoReplyChanges } from '../worldflow.js';
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
        // The set may have been moved since this reply, so it is found by its id now and by the category it holds.
        const id = canonSet(it.set || it.world);
        const data = await loadSet(id);
        const entry = entriesOf(data, id).find(e => (e.extensions?.ri?.categories || []).some(c => c.id === part.catId));
        if (!entry) throw new Error('The set could not be read.');
        const ev = readEvent(entry, String(entry.comment || '').replace(/^(Story event|Writing style): /, ''));
        const cat = ev.categories.find(c => c.id === part.catId);
        if (!cat) throw new Error('That category is no longer in the set.');
        cat.mode = 'keepFixed'; cat.fixed = part.ids[0];
        writeEvent(data, ev, id);
        await saveSet(id, data);
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
            it.notes ? [
                kv('Read as present', it.notes.present?.length ? `${it.notes.present.join(', ')} (read from ${it.notes.how || 'the reply'})` : 'Nobody who has an entry'),
                it.notes.place ? kv('Place', it.notes.place) : null,
                it.notes.missing?.length ? kv('Named in the scene, with no entry yet', it.notes.missing.join(', ')) : null,
                kv('Size', `about ${it.notes.tokens} tokens, ${it.notes.ids?.length || 0} ${it.notes.ids?.length === 1 ? 'entry' : 'entries'}`),
            ] : it.pace ? kv('Story phase', it.pace) : it.worldOrder ? kv('From the story world', it.worldOrder.label || it.name) : 'goalTask' in it ? (it.goalTask ? kv(it.goalTask.type === 'step' ? 'One-time step' : 'Repeatable action', it.goalTask.text) : null) : kv('Instruction set', setName(canonSet(it.set || it.world))),
            kv('Why it was sent', it.notes ? `This chat has a story world${it.repeat ? ', same as before the swipe' : ''}` : `${KIND[it.kind] || 'New'}${it.misses ? ` (reminder ${it.misses})` : ''}${it.repeat ? ', same as before the swipe' : ''}`),
            kv('Exact text sent', it.text),
            Array.isArray(it.rules) && it.rules.length ? kv('Rules checked', it.rules.map(r => `${r.ok ? 'Followed' : 'Not followed'}: ${r.label}`).join('  |  ')) : null,
            it.quote ? kv('Shown by this part of the reply', `"${it.quote}"`) : null),
        Array.isArray(it.parts) && it.parts.length ? [h('div', { class: 'ri-label' }, 'What the dice picked'), partRows(it, rec === recentRecords(1)[0]?.rec, withButtons)] : null,
        buttons.length ? h('div', { class: 'ri-row ri-row-tight' }, buttons) : null);
}

/** What this reply changed in the story world, with a way to undo it. */
function worldChanges(id, rec, withButtons) {
    const list = shownChanges(rec.update?.changes);
    if (!list.length) return null;
    return h('div', { class: 'ri-sentitem' },
        h('div', { class: 'ri-sent-top' }, h('span', { class: 'ri-sent-name' }, 'Story world: what this reply changed'), chip(rec.update.undone ? 'Undone' : 'Filed automatically', rec.update.undone ? 'ri-chip-wait' : 'ri-chip-done')),
        h('ul', { class: 'ri-changes' }, list.map(c => h('li', {}, describeChange(c)))),
        withButtons && !rec.update.undone ? h('div', { class: 'ri-row ri-row-tight' }, button('Undo these changes', () => undoReplyChanges(id), { kind: 'ghost', title: 'Take back what this reply added to or changed in the story world. Lines you changed since are left as they are.' })) : null);
}

/** Pacing: the story phase this reply was written in, and whether new things were held back. */
function paceNote(rec) {
    const p = rec.pace;
    if (!p) return null;
    const lines = [];
    if (p.phase) lines.push(`Story phase: ${p.phase.name}${p.phase.chance === 100 ? '' : ` (new things start at ${p.phase.chance}% of their usual chance)`}.`);
    if (p.quiet) lines.push(`Nothing new was started with this reply: it is quiet after "${p.quiet.name}" happened${p.quiet.left > 1 ? `, for ${p.quiet.left - 1} more ${p.quiet.left - 1 === 1 ? 'reply' : 'replies'}` : ''}.`);
    return lines.length ? h('div', { class: 'ri-note' }, lines.join(' ')) : null;
}

/** The questions the writing style asked about the reply, with the answers of the check. */
function askedRows(rec) {
    if (!Array.isArray(rec.asked) || !rec.asked.length) return null;
    return h('div', { class: 'ri-sentitem' },
        h('div', { class: 'ri-sent-top' }, h('span', { class: 'ri-sent-name' }, 'Questions about the reply')),
        h('ul', { class: 'ri-changes' }, rec.asked.map(a => h('li', {}, `${a.q} ${a.yes === null ? 'The check gave no answer.' : a.yes ? 'Yes.' : 'No.'}${a.quote ? ` Shown by: "${a.quote}"` : ''} (${a.pick === 'Dice' ? 'about the dice' : `asked while the writing style pick was "${a.pick}"`})`))));
}

function recordBody(id, rec, isLast, withButtons) {
    return [
        rec.guided ? h('div', { class: 'ri-note' }, `Guided swipe: ${rec.guided.direction} (${rec.guided.repeatOrders ? 'previous orders repeated' : 'previous orders left out'})`) : null,
        rec.agency ? h('div', { class: 'ri-note ri-note-warn' }, `The reply wrote for you: "${rec.agency.quote}"`) : null,
        rec.note ? h('div', { class: 'ri-note' }, rec.note) : null,
        paceNote(rec),
        rec.usedUp ? h('div', { class: 'ri-note ri-note-warn' }, `Used up in this chat with this reply: ${rec.usedUp.join(', ')}. Every item of its main list has happened. "Bring the used items back" in the Random Story Events tab starts it again for this chat.`) : null,
        rec.items.map((it, i) => itemRow(id, rec, it, i, withButtons)),
        askedRows(rec),
        worldChanges(id, rec, withButtons),
        withButtons && isLast ? h('div', { class: 'ri-row' },
            button('Pick again and write a new reply', () => pickAgainNow(), { title: 'Roll the instructions for this reply again and swipe to a new reply' }),
            settings().check.mode === 'off' ? null : button('Check this reply again', () => checkAgain(id), { kind: 'ghost', title: 'Use this after you edit the reply by hand' })) : null,
    ];
}

function summaryLine(rec) {
    // Say what went with the reply by its right name: instructions are counted, the rest is named.
    const orders = rec.items.filter(i => !i.noCheck);
    const n = orders.length;
    const also = [];
    if (rec.items.some(i => i.notes)) also.push('story notes');
    if (rec.items.some(i => i.noCheck && !i.notes && !i.pace && !('goalTask' in i))) also.push('writing style');
    if (rec.items.some(i => i.noCheck && 'goalTask' in i)) also.push('goal');
    const changed = shownChanges(rec.update?.changes).length;
    const world = changed && !rec.update.undone ? [`${changed} ${changed === 1 ? 'change' : 'changes'} to the story world`] : [];
    if (rec.pace?.quiet) world.push('nothing new started (quiet after a big event)');
    if (!n) return [also.length ? `${also.join(', ')} sent` : '', ...world].filter(Boolean).join(' · ') || 'nothing sent';
    const done = rec.items.filter(i => i.status === 'done').length;
    const waiting = rec.items.filter(i => ['overdue', 'queued'].includes(i.status)).length;
    const parts = [`${n} ${n === 1 ? 'instruction' : 'instructions'}${also.length ? ` and ${also.join(', ')}` : ''} sent`, ...world];
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
    // The way to carry the story into a new chat, kept where it is easy to find.
    body.appendChild(h('div', { class: 'ri-row ri-row-tight' }, button('Start a new chapter in a new chat', () => {
        import('./panel.js').then((P) => { P.app.tab = 'world'; P.app.wroute = { view: 'list', sheet: { kind: 'chapter', wish: '', busy: false, error: '', draft: null } }; P.app.render(); });
    }, { kind: 'ghost', title: 'One AI request writes a detailed summary and a first message for you to change. A new chat then opens that carries the story on. This chat stays as it is.' })));
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

// A reply that draws its own HUD (a preset tracker) needs no scene card from the extension.
const OWN_HUD = /<(scene_cast|sola_hud|profile|status|tracker|hud)\b|\bpresent\s*=\s*"|^\s*(present|location)\s*:/im;

/** The scene card: when, where and who is present, from the reply's own scene lines. */
function sceneCard(sc) {
    const fields = [['where', 'Location'], ['when', 'Time'], ['present', 'Present'], ['environment', 'Environment']];
    const values = h('div', { class: 'ri-reply-fields' }, fields.filter(([key]) => sc[key]).map(([key, label]) =>
        h('div', { class: 'ri-scene-row ri-reply-field' }, h('span', { class: 'ri-scene-k' }, label), h('span', { class: 'ri-scene-v ri-reply-value' }, sc[key]))));
    return h('details', { class: 'ri-scene ri-reply-card ri-reply-scene', 'data-card-key': 'scene' },
        replyCardHeader({ icon: '◇', eyebrow: 'The story so far', title: 'Scene', subtitle: [sc.where, sc.when].filter(Boolean).join(' · ') }), values);
}

/** One collapsed view of the state after each reply. */
function refreshStoryState(chat) {
    const st = settings();
    const mode = st.enabled ? (st.scene?.card || 'auto') : 'off';
    const seen = new Set();
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const id = Number(mes.getAttribute('mesid'));
        const m = chat[id], rec = m?.extra?.[KEY], block = mes.querySelector('.mes_block');
        if (!block || !rec || m.is_user || mode === 'off' || (mode === 'auto' && OWN_HUD.test(String(m.mes || '')))) continue;
        const sc = snapshotScene(id);
        const all = snapshotState(id);
        const names = String(sc.present || '').toLocaleLowerCase();
        const people = Object.values(all).filter(p => !names || names.includes(p.name.toLocaleLowerCase()));
        for (const profile of rec.profiles || []) {
            if (names && !names.includes(String(profile.name || '').toLocaleLowerCase())) continue;
            let person = people.find(p => p.name.toLocaleLowerCase() === String(profile.name || '').toLocaleLowerCase());
            if (!person && Object.keys(profile.stable || {}).length) { person = { name: profile.name, fields: {}, protected: {} }; people.push(person); }
            if (person) person.foundation = profile.stable || {};
        }
        const roast = st.cards?.roast !== false ? rec.roast : '';
        if (!Object.keys(sc).length && !people.length && !roast) continue;
        const stamp = JSON.stringify([sc, people, roast, rec.stateOutdated, rec.snapshotEdits]);
        const old = block.querySelector(':scope > .ri-story-state');
        seen.add(mes);
        const responseKey = `${rec.time || ''}:${m.swipe_id ?? 0}`;
        if (old && old.dataset.responseKey === responseKey && (old.dataset.stamp === stamp || old.querySelector('.ri-state-editor'))) continue;
        const openCards = new Set(old?.dataset.responseKey === responseKey ? [...old.querySelectorAll('.ri-reply-card[open]')].map(card => card.dataset.cardKey) : []);
        const outer = h('div', { class: 'ri-root ri-story-state ri-reply-stack', 'data-accent': 'sky' });
        outer.dataset.stamp = stamp;
        outer.dataset.responseKey = responseKey;
        const refreshCards = () => { outer.querySelectorAll('.ri-state-editor').forEach(editor => editor.remove()); outer.dataset.stamp = ''; refreshUnderReplies(); };
        if (rec.stateOutdated) outer.append(h('div', { class: 'ri-note ri-note-warn' }, 'This reply was edited; its recorded state may be out of date.'));
        if (Object.keys(sc).length) {
            const scene = sceneCard(sc);
            const slot = h('div', { class: 'ri-state-body ri-reply-actions' });
            slot.append(button('Edit this scene snapshot', () => slot.replaceChildren(sceneEditor(sc, refreshCards, { historicalId: id })), { kind: 'ghost' }));
            scene.append(slot); outer.append(scene);
        }
        for (const person of people) outer.append(characterStateCard(person, id, refreshCards, { historical: true, replyCard: true }));
        if (roast) outer.append(h('details', { class: 'ri-roast ri-reply-card ri-reply-roast', 'data-card-key': 'roast' },
            replyCardHeader({ icon: '✦', eyebrow: 'A voice from the sidelines', title: 'Roast' }),
            h('div', { class: 'ri-roast-v ri-reply-quote' }, roast)));
        for (const card of outer.querySelectorAll('.ri-reply-card')) card.open = openCards.has(card.dataset.cardKey);
        const under = block.querySelector(':scope > .ri-under');
        if (old) old.replaceWith(outer); else if (under) block.insertBefore(outer, under); else block.appendChild(outer);
    }
    for (const el of document.querySelectorAll('#chat .mes .ri-story-state')) if (!seen.has(el.closest('.mes'))) el.remove();
    for (const el of document.querySelectorAll('#chat .mes .ri-scene, #chat .mes .ri-cards')) if (!el.closest('.ri-story-state')) el.remove();
}

export function refreshUnderReplies() {
    try { refreshGuidedControl(); } catch (e) { console.warn('[Roleplay Instructions] guided swipe', e); }
    try { refreshStoryState(ctx().chat || []); } catch (e) { console.warn('[Roleplay Instructions] story state', e); }
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
