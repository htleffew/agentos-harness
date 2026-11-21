import { memoryOnly } from '../components.js';
import { refreshReplyProgress } from './reply-progress.js';
import { refreshDialogue } from './v10.js';
import { enabledV10, effectiveModules, KIND_MODULE, checkText } from '../v10.js';
import { replyCardHeader, replyChip, replyGlance, revealReplyBody, roastCard } from './reply-cards.js';
import { replyWorldTabs } from './reply-world.js';
import { chatWorld } from '../world.js';
import { refreshGuidedControl } from './guided.js';
import { snapshotState, snapshotScene, sceneDateLabel } from '../state.js';
import { characterStateCard, sceneEditor } from './state.js';
// What Was Sent tab, and the optional section under each reply.
import { h, button, foldCard, chip } from './dom.js';
import { recentRecords, statusLabel, sendAgain, undoDone, cancelResend, pickAgainNow, overdueList, checkAgain, clearQueue, rerollPartNow, setLock, isLocked } from '../engine.js';
import { loadSet, saveSet, entriesOf, canonSet, setName, setInfo, readInstruction, setOfEntry } from '../books.js';
import { BOOK_TRIGGER_SOURCES } from '../book-triggers.js';
import { shownChanges, describeChange, undoReplyChanges } from '../worldflow.js';
import { writeEvent, readEvent } from '../events.js';
import { toast } from '../st.js';
import { settings } from '../store.js';
import { ctx, KEY, isChatOpen, isReply, loadBook } from '../st.js';

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

async function editDirectionEntry(set, uid, book) {
    try {
        const chat = ctx().getCurrentChatId?.();
        if (!set && book) {
            const entry = (await loadBook(book))?.entries?.[uid];
            if (entry) set = setOfEntry({...entry,world:book});
        }
        set = canonSet(set);
        if (!Object.hasOwn(settings().sets,set)) throw new Error('This entry’s set is no longer available.');
        const {kind} = setInfo(set);
        const data = await loadSet(set);
        const entry = data && entriesOf(data,set).find(item=>String(item.uid)===String(uid));
        if (ctx().getCurrentChatId?.()!==chat) return;
        if (!entry) throw new Error('This entry is no longer in its set.');
        const {app} = await import('./panel.js');
        if (!await app.openPage(kind) || ctx().getCurrentChatId?.()!==chat) return;
        if (kind==='instructions') app.go({view:'edit',name:set,draft:readInstruction(entry)});
        else {
            app[kind==='events' ? 'eroute' : 'sroute'] = {view:'edit',name:set,draft:readEvent(entry,setName(set)),open:{}};
            app.render();
        }
        if (!app.root.classList.contains('ri-expanded')) await app.setExpanded(true);
    } catch(error) { toast('error',error.message); }
}

function itemRow(id, rec, it, index, withButtons) {
    const kv = (k, v) => h('div', { class: 'ri-kv' }, h('span', { class: 'ri-k' }, k), h('span', { class: 'ri-v' }, v));
    const buttons = [];
    const set = canonSet(it.set || it.world);
    const rule = it.recallRule;
    if (withButtons && Object.hasOwn(settings().sets,set) && setInfo(set).kind==='instructions' && it.uid!=null) {
        buttons.push(button('Edit this instruction',()=>editDirectionEntry(set,it.uid),{kind:'ghost'}));
    }
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
            rule && kv('Instruction settings at selection',[
                rule.when==='always' ? 'Always eligible' : `${rule.when==='pattern' ? 'Pattern' : 'Keyword'} · ${BOOK_TRIGGER_SOURCES[rule.triggerSource] || 'Recent chat'}`,
                `${rule.chance}% configured chance`,
                rule.keep>0 && `keep for ${rule.keep} ${rule.keep===1 ? 'reply' : 'replies'}`,
                rule.wait>0 && `wait ${rule.wait} ${rule.wait===1 ? 'reply' : 'replies'}`,
            ].filter(Boolean).join(' · ')),
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
    const open = async (page, control) => {
        const {app} = await import('./panel.js');
        await app.openSetting(page,control);
    };
    return [
        rec.v10Request ? h('details',{class:'ri-sentitem'},h('summary',{},'Story guidance sent'),
            h('pre',{class:'ri-v10-prompt-text'},rec.v10Request)) : null,
        withButtons && rec.v10 && h('div',{class:'ri-note'},
            h('p',{},rec.v10Request ? 'Exact story guidance is available above.'
                : rec.v10Guidance === true ? 'The extension confirmed story guidance was sent. Exact text was not saved for this reply.'
                    : rec.v10Guidance === false ? 'The extension could not confirm story guidance in this request.'
                        : 'This reply has no saved guidance receipt.'),
            h('div',{class:'ri-row'},
                button('Edit writing guidance',()=>open('writing','ri-profile-style'),{kind:'ghost'}),
                button('Guidance receipt settings',()=>open('display','ri-keepTurnGuidance'),{kind:'ghost'}))),
        rec.cardIssues?.length ? h('div',{class:'ri-note ri-note-warn'},rec.cardIssues.map(issue=>h('p',{},issue))) : null,
        rec.v10Check ? h('div',{class:'ri-note'},checkText(rec.v10Check)) : null,
        rec.v10Offer ? h('div',{class:'ri-note'},`Optional plot opportunity offered: ${rec.v10Offer}`) : null,
        rec.v10Lore?.length ? h('details',{class:'ri-sentitem'},h('summary',{},'World Info selections'),
            h('ul',{class:'ri-changes'},rec.v10Lore.map(entry=>h('li',{},[
                `${entry.title} · ${entry.book || 'Story World'}${entry.role ? ` (${entry.role})` : ''}`,
                entry.confirmed ? 'Confirmed in prompt' : 'Delivery unconfirmed', entry.delivery, entry.timing,
            ].filter(Boolean).join(' · '), ' ', loreEntryButton(entry,true))))) : null,
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
    if (rec.v10Request || rec.v10Guidance===true) also.push('story guidance');
    if (rec.v10Lore?.length) also.push('World Info');
    if (rec.v10Offer) also.push('plot opportunity');
    if (rec.v10Check) also.push('action check');
    if (rec.items.some(i => i.noCheck && !i.notes && !i.pace && !('goalTask' in i))) also.push('writing style');
    if (rec.items.some(i => i.noCheck && 'goalTask' in i)) also.push('goal');
    const changed = shownChanges(rec.update?.changes).length;
    const world = changed && !rec.update.undone ? [`${changed} ${changed === 1 ? 'change' : 'changes'} to the story world`] : [];
    if (rec.pace?.quiet) world.push('nothing new started (quiet after a big event)');
    if (!n) return [also.length ? `${also.join(', ')} sent` : '', ...world].filter(Boolean).join(' · ') || (rec.v10 ? 'No saved delivery details' : 'nothing sent');
    const done = rec.items.filter(i => i.status === 'done').length;
    const waiting = rec.items.filter(i => ['overdue', 'queued'].includes(i.status)).length;
    const parts = [`${n} ${n === 1 ? 'instruction' : 'instructions'}${also.length ? ` and ${also.join(', ')}` : ''} sent`, ...world];
    if (rec.checking) parts.push('checking');
    else { if (done) parts.push(`${done} done`); if (waiting) parts.push(`${waiting} will be sent again`); }
    return parts.join(' · ');
}

export function renderSent(body, app) {
    if (!isChatOpen()) return;
    const st = settings();
    if (enabledV10()) body.append(h('div',{class:'ri-note'},
        'Open World Info selections to see the source books and activation settings. Confirmed means the extension found the text in the assembled request. Entries marked Story notes block went through one shared block.',
        h('div',{class:'ri-row'},button('World Info display settings',()=>app.openPage('display'),{kind:'ghost'}))));
    const waiting = overdueList();
    if (waiting.length) body.appendChild(h('div', { class: 'ri-note ri-note-warn' }, `Waiting to be sent again with the next reply: ${waiting.map(o => o.name).join(', ')}.`,
        h('div', { class: 'ri-row ri-row-tight' }, button('Do not send these again', () => clearQueue(), { kind: 'ghost' }))));
    if (st.check.mode === 'off') body.appendChild(h('div', { class: 'ri-note' }, 'Instruction follow-through checks are off. Turn on “Check that it happened” in Settings to see Done and Overdue for required instructions here.'));
    // The way to carry the story into a new chat, kept where it is easy to find.
    body.appendChild(h('div', { class: 'ri-row ri-row-tight' }, button('Start a new chapter in a new chat', () => {
        import('./panel.js').then((P) => { P.app.tab = 'world'; P.app.wroute = { view: 'list', sheet: { kind: 'chapter', wish: '', busy: false, error: '', draft: null } }; P.app.render(); });
    }, { kind: 'ghost', title: 'One AI request writes a detailed summary and a first message for you to change. A new chat then opens that carries the story on. This chat stays as it is.' })));
    const records = recentRecords(30);
    if (!records.length) {
        body.appendChild(h('div', { class: 'ri-empty' }, 'No reply receipts yet. Receipts appear after the extension records a reply with story guidance, World Info, or other extension instructions.'));
        return;
    }
    let reply = 0;
    const labels = (ctx().chat || []).map((message,index)=>index && isReply(message) ? 'Reply '+(++reply) : 'Opening');
    records.forEach((r, i) => {
        body.appendChild(foldCard(
            [h('span', { class: 'ri-sent-title' }, labels[r.id]+(r.isLast ? ' (newest)' : '')), h('span', { class: 'ri-sent-sub' }, summaryLine(r.rec))],
            recordBody(r.id, r.rec, r.isLast, true), { open: i === 0, cls: 'ri-sentcard' }));
    });
}

// ---------- under each reply (display only) ----------

function underBlock(id, rec) {
    return h('div', { class: 'ri-root ri-under', 'data-accent': 'sky' },
        foldCard([h('span', { class: 'ri-sent-title' }, 'What was sent with this reply'), h('span', { class: 'ri-sent-sub' }, summaryLine(rec))], recordBody(id, rec, false, false), { cls: 'ri-sentcard' }));
}

// A reply that draws its own HUD (a preset tracker) needs no scene card from the extension.
const OWN_HUD = /<(scene_cast|sola_hud|internal_states|profile|status|tracker|hud)\b|\bpresent\s*=\s*"|^\s*(present|location)\s*:/im;

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
    const v10 = enabledV10();
    const mode = st.enabled && !memoryOnly() ? (st.scene?.card || 'auto') : 'off';
    const seen = new Set();
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const id = Number(mes.getAttribute('mesid'));
        const m = chat[id], rec = m?.extra?.[KEY], block = mes.querySelector('.mes_block');
        if (!block || !rec || m.is_user || mode === 'off' || (mode === 'auto' && OWN_HUD.test(String(m.mes || '')))) continue;
        const sc = st.scene?.track !== false ? snapshotScene(id) : {};
        const all = st.cards?.on ? snapshotState(id) : {};
        const names = String(sc.present || '').toLocaleLowerCase();
        const people = Object.values(all).filter(p => !names || names.includes(p.name.toLocaleLowerCase()));
        for (const profile of st.cards?.on ? rec.profiles || [] : []) {
            if (names && !names.includes(String(profile.name || '').toLocaleLowerCase())) continue;
            let person = people.find(p => p.name.toLocaleLowerCase() === String(profile.name || '').toLocaleLowerCase());
            if (!person && Object.keys(profile.stable || {}).length) { person = { name: profile.name, fields: {}, protected: {} }; people.push(person); }
            if (person) person.foundation = profile.stable || {};
        }
        if (v10 || rec.v10) continue;
        const roast = st.cards?.on && st.cards.roast !== false ? rec.roast : '';
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
        if (roast) outer.append(roastCard(roast,{'data-card-key':'roast'}));
        for (const card of outer.querySelectorAll('.ri-reply-card')) card.open = openCards.has(card.dataset.cardKey);
        const under = block.querySelector(':scope > .ri-under');
        if (old) old.replaceWith(outer); else if (under) block.insertBefore(outer, under); else block.appendChild(outer);
    }
    for (const el of document.querySelectorAll('#chat .mes .ri-story-state')) if (!seen.has(el.closest('.mes'))) el.remove();
    for (const el of document.querySelectorAll('#chat .mes .ri-scene, #chat .mes .ri-cards')) if (!el.closest('.ri-story-state')) el.remove();
}

function replyTabs(parts, active, id) {
    const list=h('div',{class:'ri-tabs',role:'tablist','aria-label':'Reply details'});
    const panels=h('div',{class:'ri-v10-panels'});
    const ids=parts.map(([name])=>name);
    const initial=Math.max(0,ids.indexOf(active));
    const tabs=[];
    const loaded = new Set();
    let selected = initial;
    function loadSelected() {
        const load = parts[selected]?.[2];
        if (!load || loaded.has(selected) || !list.closest('details')?.open) return;
        loaded.add(selected);
        load(panels.children[selected]);
    }
    function activate(index,focus=false) {
        selected = index;
        tabs.forEach((tab,i)=>{
            tab.setAttribute('aria-selected',String(i===index));
            tab.tabIndex=i===index ? 0 : -1;
            tab.classList.toggle('ri-tab-on',i===index);
            panels.children[i].hidden=i!==index;
        });
        if (focus) tabs[index]?.focus();
        loadSelected();
    }
    parts.forEach(([label,content],i)=>{
        const tab=h('button',{class:'ri-tab',type:'button',role:'tab',id:`ri-reply-${id}-tab-${i}`,'aria-controls':`ri-reply-${id}-panel-${i}`,'data-tab':label,onclick:()=>activate(i)},label);
        tab.addEventListener('keydown',event=>{
            const next={ArrowLeft:(i+parts.length-1)%parts.length,ArrowRight:(i+1)%parts.length,Home:0,End:parts.length-1}[event.key];
            if(next!==undefined){event.preventDefault();activate(next,true);}
        });
        list.append(tab);tabs.push(tab);
        panels.append(h('div',{role:'tabpanel',id:`ri-reply-${id}-panel-${i}`,'aria-labelledby':tab.id},content));
    });
    activate(initial);
    return {list,panels,loadSelected,reset:()=>loaded.clear(),choose(label){
        const index = ids.indexOf(label);
        if (index<0) return null;
        activate(index,true);
        return panels.children[index];
    }};
}

function loreEntryButton(entry, fromReview) {
    if (!entry.book) return null;
    const managed = entry.managedSet || ['Random Instructions','Random Story Events','Random Writing Style'].includes(entry.role);
    const label = managed ? 'Open in Direction' : 'View entry settings';
    const control = button(label,async()=>{
        if (managed) return editDirectionEntry(entry.managedSet,entry.uid,entry.book);
        const { app } = await import('./panel.js');
        await app.openLoreEntry({...entry,fromReview});
    },{kind:'ghost'});
    control.setAttribute('aria-label',`${label} for ${entry.title}`);
    return control;
}

function replyLoreRows(lore) {
    return h('ul',{class:'ri-lore-receipt'},lore.map(entry=>h('li',{},
        h('div',{class:'ri-lore-receipt-title'},h('strong',{},entry.title),h('span',{},entry.book || 'Story World')),
        h('div',{class:'ri-reply-chip-rail'},entry.role && replyChip(entry.role,'indigo'),
            replyChip(entry.confirmed ? 'Confirmed in prompt' : 'Delivery unconfirmed',entry.confirmed ? 'mint' : 'slate'),
            entry.delivery && replyChip(entry.delivery,'slate'),
            entry.timing && replyChip(entry.timing,'slate')),
        loreEntryButton(entry,false))));
}

function updateSceneHeader(mes,id,scene) {
    const area = mes.querySelector('.mes_text');
    if (!area) return;
    const existing = area.parentElement.querySelector(':scope > .ri-scene-header');
    if (!scene) { existing?.remove(); return; }
    const days = scene.daysAfterKnownDate;
    const date = sceneDateLabel(scene);
    const fields = [['Time',scene.time ?? scene.when],['Date',date],['Location',scene.where],['Weather',scene.weather]];
    const record = ctx().chat?.[id]?.extra?.[KEY];
    if (id===0 && !record && !fields.some(([,value])=>value)) { existing?.remove(); return; }
    const inherited = !!record?.weatherInherited && !Object.hasOwn(record?.sceneSnapshotEdits || {},'weather');
    const stamp = JSON.stringify([fields,inherited,scene.lastKnownDate,days]);
    if (existing?.dataset.scene === stamp) return;
    const header = h('div',{class:'ri-scene-header','aria-label':'Scene details','data-scene':stamp},
        h('dl',{},fields.map(([label,value])=>h('div',{class:`ri-scene-header-${label.toLowerCase()}`},
            h('dt',{},label==='Date' ? (!scene.date && scene.lastKnownDate && !days ? 'Last known date' : 'Story date') : label),
            h('dd',{title:label==='Weather' && inherited ? 'Last established weather' :
                label==='Date' && !scene.date && days && scene.lastKnownDate ? `Last full date: ${scene.lastKnownDate}` : undefined},
                value || h('span',{class:'ri-scene-header-empty'},label==='Date' ? 'Awaiting story date' : '—'))))));
    if (existing) existing.replaceWith(header);
    else area.before(header);
}

function refreshV10Replies(chat) {
    const enabled=settings().enabled;
    const native=enabledV10();
    const modules=effectiveModules();
    const root=ctx().chatMetadata?.[KEY];
    const local=root?.v10 || {};
    const world=chatWorld();
    const manualVersion=root?.manualWorldChanges?.at(-1)?.time;
    const latestReply=chat.findLastIndex(isReply);
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const id=Number(mes.getAttribute('mesid'));
        const msg=chat[id];
        const rec=msg?.extra?.[KEY] || (native && id===0 && root?.chapterOf && world ? {time:'chapter-opening'} : null);
        const block=mes.querySelector('.mes_block');
        if (!block) continue;
        const old=block.querySelector(':scope > .ri-v10-reply');
        const showHeader = enabled && !memoryOnly() && (native || rec?.v10) && isReply(msg);
        const show = showHeader && !!rec;
        const snapshot=showHeader ? snapshotScene(id) : null;
        updateSceneHeader(mes,id,snapshot);
        if (!show) {old?.remove();continue;}
        const showConsole=settings().scene?.card !== 'off';
        const showState=showConsole && (settings().scene?.card !== 'auto' || !OWN_HUD.test(msg.mes || ''));
        const sc=showState && modules.state ? snapshot : {};
        const people=showState && modules.state ? Object.values(snapshotState(id)).filter(p=>!sc.present || sc.present.toLowerCase().includes(p.name.toLowerCase())) : [];
        const records=(rec.v10Changes || []).filter(record=>modules[KIND_MODULE[record.kind]]);
        const profiles=showState && modules.state ? rec.v10Profiles || [] : [];
        const planning=local.showPlanning !== false ? rec.v10Plan : '';
        const roast=local.showRoast!==false ? rec.roast : '';
        const lore=local.showLore!==false ? rec.v10Lore || [] : [];
        const responseKey=`${rec.time}:${msg.swipe_id ?? 0}`;
        const stamp=JSON.stringify([responseKey,showConsole,modules,world,manualVersion,id===latestReply,sc,people,profiles,records,planning,roast,lore,
            rec.v10Check,rec.v10Offer,rec.v10Plot,rec.v10Invalid,rec.v10Issues,rec.v10Diagnostics,rec.cardIssues,rec.stateOutdated]);
        if (old?.dataset.responseKey===responseKey && (old.dataset.stamp===stamp || old.querySelector('.ri-state-editor'))) continue;
        const out=h('div',{class:'ri-root ri-v10-reply ri-reply-stack','data-accent':'sky'});
        out.dataset.stamp=stamp;
        out.dataset.responseKey=responseKey;
        const parts=[];
        const redraw=()=>{out.querySelectorAll('.ri-state-editor').forEach(form=>form.remove());out.dataset.stamp='';refreshUnderReplies();};
        if (Object.keys(sc).length) {
            const scene=sceneCard(sc);
            const edit=h('div',{class:'ri-state-body'});
            edit.append(button('Edit this scene snapshot',()=>edit.replaceChildren(sceneEditor(sc,redraw,{historicalId:id})),{kind:'ghost'}));
            parts.push(['Scene',[scene.children[1],edit]]);
        }
        const showProfile = profile => profile ? h('div',{class:'ri-state-body'},h('p',{},profile.text),
            profile.voice && h('p',{class:'ri-help'},`Voice · ${profile.voice}`),profile.facet && h('p',{class:'ri-help'},`Facet · ${profile.facet}`)) : null;
        for (const person of people) {
            const card=characterStateCard(person,id,redraw,{historical:true,replyCard:true});
            parts.push([person.name,[card.children[1],showProfile(profiles.find(profile=>profile.subject===person.name))]]);
        }
        for (const profile of profiles.filter(profile=>!people.some(person=>person.name===profile.subject))) parts.push([profile.subject,showProfile(profile)]);
        const saved = showConsole && native ? replyWorldTabs(id,modules,rec) : null;
        if (saved) parts.push(...saved.parts);
        if (records.length) parts.push(['Changes',h('ul',{class:'ri-lore-receipt'},records.map(record=>h('li',{},
            h('div',{class:'ri-lore-receipt-title'},h('strong',{},record.subject || record.id),h('span',{},record.text)),
            replyChip(record.kind,record.kind === 'fact' ? 'mint' : 'indigo'))))]);
        if (rec.v10Check || rec.v10Offer || rec.v10Invalid || rec.v10Issues?.length || rec.stateOutdated || rec.v10Diagnostics?.length || rec.cardIssues?.length) parts.push(['Notes',[
            rec.v10Check && h('p',{},checkText(rec.v10Check)),
            rec.v10Offer && h('p',{},`Offered plot development: ${rec.v10Offer}`),
            rec.v10Invalid && h('p',{},'Some structured changes could not be applied.'),
            rec.stateOutdated && h('p',{},'This reply was edited. Its previous state is out of date.'),
            (rec.v10Issues || []).map(note=>h('p',{},note)),
            (rec.v10Diagnostics || []).map(note=>h('p',{},note)),
            (rec.cardIssues || []).map(note=>h('p',{},note)),
        ]]);
        if (showConsole && parts.length) {
            const tabs = replyTabs(parts,old?.querySelector('[role=tab][aria-selected=true]')?.dataset.tab,id);
            const consoleCard = h('details',{class:'ri-reply-card ri-v10-console','data-reply-fold':'console'},
                replyCardHeader({icon:'◇',title:'Story state',chips:[
                people.length && {text:`${people.length} ${people.length===1 ? 'character' : 'characters'}`,tone:'sky'},
                records.length && {text:`${records.length} ${records.length===1 ? 'change' : 'changes'}`,tone:'mint'},
                ].filter(Boolean)}),tabs.list,tabs.panels);
            consoleCard.addEventListener('toggle',()=>{
                if (consoleCard.open) tabs.loadSelected();
                else {tabs.reset();saved?.reset();}
            });
            const glance = id===latestReply && replyGlance({scene:sc,people,profiles,records,changed:rec.stateChanges || [],hasSavedTabs:!!saved},label=>{
                consoleCard.open=true;
                revealReplyBody(consoleCard,tabs.choose(label));
            });
            if (glance) out.append(glance);
            out.append(consoleCard);
        }
        if (planning) out.append(h('details',{class:'ri-reply-card ri-v10-plan','data-reply-fold':'planning'},
            replyCardHeader({icon:'≋',title:'Reply planning'}),
            h('pre',{class:'ri-v10-prompt-text ri-reply-quote'},planning)));
        if(roast) out.append(roastCard(roast,{'data-reply-fold':'roast'}));
        if(lore.length) out.append(h('details',{class:'ri-reply-card ri-v10-lore','data-reply-fold':'lore'},
            replyCardHeader({icon:'▤',title:'World Info',chips:[
                {text:`${lore.length} ${lore.length===1 ? 'entry' : 'entries'}`,tone:'sky'},
                ...(lore.some(entry=>entry.confirmed) ? [{text:`${lore.filter(entry=>entry.confirmed).length} confirmed in prompt`,tone:'mint'}] : []),
            ]}),replyLoreRows(lore)));
        if(old?.dataset.responseKey===responseKey) for(const fold of out.querySelectorAll('[data-reply-fold]')) {
            fold.open=!!old.querySelector(`[data-reply-fold="${fold.dataset.replyFold}"]`)?.open;
        }
        if(!out.childElementCount) old?.remove();
        else if(old) old.replaceWith(out);
        else block.insertBefore(out,block.querySelector(':scope > .ri-guided'));
    }
    refreshDialogue();
}

export function refreshUnderReplies() {
    try { refreshReplyProgress(); } catch (e) { console.warn('[Roleplay Instructions] reply progress',e); }
    try { refreshGuidedControl(); } catch (e) { console.warn('[Roleplay Instructions] guided swipe', e); }
    try { refreshStoryState(ctx().chat || []); refreshV10Replies(ctx().chat || []); } catch (e) { console.warn('[Roleplay Instructions] story state', e); }
    try {
        const st = settings();
        const show = st.enabled && !memoryOnly() && st.showUnder === 'display';
        const chat = ctx().chat || [];
        const seen = new Set();
        if (show) {
            for (const mes of document.querySelectorAll('#chat .mes')) {
                const id = Number(mes.getAttribute('mesid'));
                const rec = chat[id]?.extra?.[KEY];
                const block = mes.querySelector('.mes_block');
                if (!(rec?.items?.length || rec?.v10Lore?.length || rec?.v10Request || rec?.v10Check || rec?.v10Offer) || !block) continue;
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
