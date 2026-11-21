import { ctx, KEY, isReply } from './st.js';
import { settings, chatState } from './store.js';
import { historySourceMatches, storyRevision } from './history-source.js';
import { freeUid, setInfo } from './books.js';
import { isWorldEntry, readWorldEntry, writeWorldEntry } from './world.js';
import { stripStoredQuickText } from './quick-action-chat.js';

const compare = (left,right) => JSON.stringify(left) === JSON.stringify(right);
const bookKey = id => {
    const {book,group} = setInfo(id);
    return JSON.stringify([book,group || '']);
};

export function editableReplySlots() {
    const value = Number(settings().world.editableReplies);
    return Number.isFinite(value) ? Math.max(0,Math.min(51,Math.trunc(value)+1)) : 6;
}

export function storySlots(chat = ctx().chat || []) {
    return chat.flatMap((message,index)=>index > 0 && isReply(message) ? [{message,index,rec:message.extra?.[KEY]}] : []);
}

export function revisionMatches(message,index,revision) {
    return !!revision && compare(storyRevision(message,index),revision);
}

export function pendingStoryPatches(chat,index,pending) {
    if (!pending.historySource?.length || historySourceMatches(chat,index,pending.historySource)) return pending.changes;
    return pending.changes.filter(change=>!change.historyDerived);
}

/** Physical writers share UID space with editable changes and their saved swipes. */
export function reserveStoryUids(data,world,chat=ctx().chat || [],root=chatState()) {
    const next = freeUid(data);
    const reservations = [
        ...(root?.storyJournalCarry || []).filter(pending=>pending.world===world),
        ...chat.flatMap(message=>[message,...(message?.swipe_info || [])].flatMap(holder=>{
            const update = holder?.extra?.[KEY]?.update;
            return update?.world===world && update.pending ? [update.pending] : [];
        })),
    ];
    let reservedNext = next;
    for (const pending of reservations) for (const change of pending.changes) {
        const uid = Number(change.uid);
        if (Number.isSafeInteger(uid) && uid>=reservedNext) reservedNext=uid+1;
    }
    if (reservedNext>next) data.extensions = {...data.extensions,riNextUid:reservedNext};
    return data;
}

export function pendingWriteId(world, pending) {
    return JSON.stringify([bookKey(world),pending.chat,pending.revision.turn,pending.revision.swipe,pending.revision.fingerprint]);
}

export function wasPromoted(data,world,pending) {
    return Object.hasOwn(data.extensions?.riPendingWrites || {},pendingWriteId(world,pending));
}

export function markPromoted(data,world,pending) {
    data.extensions ||= {};
    (data.extensions.riPendingWrites ||= {})[pendingWriteId(world,pending)] = true;
}

export function unmarkPromoted(data,world,pending) {
    if (data.extensions?.riPendingWrites) delete data.extensions.riPendingWrites[pendingWriteId(world,pending)];
}

/** Validate a patch against the live book and replay its compatible changes. */
export function replayStoryPatch(data,world,changes) {
    const info = setInfo(world);
    const applied = [];
    const conflicts = [];
    const rejected = new Set();
    for (const change of changes) {
        const {uid,field,entry,before,after} = change;
        const original = data.entries?.[uid];
        const row = isWorldEntry(original) && (!info.shared || original.extensions.ri.set === info.group)
            ? readWorldEntry(original) : null;
        if (!rejected.has(uid) && change.type === 'create' && !original && entry) {
            writeWorldEntry(data,structuredClone(entry),world);
            applied.push(change);
            continue;
        }
        const matches = row && (change.correctionId ? row.locked === change.beforeLocked : !row.locked) &&
            (!change.kind || row.kind === change.kind) && (!change.name || row.name === change.name);
        if (matches && !rejected.has(uid) && change.type !== 'create') {
            if (change.type === 'set' && row.fields[field] === before) row.fields[field] = after;
            else if (change.type === 'status' && row.status === before &&
                (!Object.hasOwn(change,'beforeAt') || compare(row.at,change.beforeAt))) {
                row.status = after;
                if (Object.hasOwn(change,'afterAt')) row.at = change.afterAt;
            } else if (change.type === 'clock' && compare(row.at,change.beforeAt)) row.at = change.afterAt;
            else {
                conflicts.push(change);
                continue;
            }
            if (change.correctionId) row.locked = true;
            writeWorldEntry(data,row,world);
            applied.push(change);
            continue;
        }
        if (!matches || change.type === 'create') rejected.add(uid);
        conflicts.push(change);
    }
    return {applied,conflicts};
}

export function projectStoryJournal(data,world,{before=Infinity,continuing,chat=ctx().chat || [],root=chatState()} = {}) {
    const copy = structuredClone(data);
    const conflicts = [];
    for (const carried of root?.storyJournalCarry || []) {
        if (carried.world !== world || wasPromoted(copy,world,carried)) continue;
        const result = replayStoryPatch(copy,world,carried.changes);
        conflicts.push(...result.conflicts);
    }
    for (const {message,index,rec} of storySlots(chat)) {
        if (index >= before) break;
        const pending = rec?.update?.pending;
        if (!pending || rec.update.world !== world || rec.update.undone || rec.stateStale ||
            rec.time !== continuing && !revisionMatches(message,index,pending.revision) || wasPromoted(copy,world,pending)) continue;
        const result = replayStoryPatch(copy,world,pendingStoryPatches(chat,index,pending));
        conflicts.push(...result.conflicts);
    }
    return {data:copy,conflicts};
}

/** The newest slots are excluded from chapter coverage even when they held no world changes. */
export function filedThrough(chat = ctx().chat || []) {
    const slots = storySlots(chat);
    let through = Math.max(0,slots.length-editableReplySlots());
    while (through<slots.length) {
        const update = slots[through].rec?.update;
        if (!update?.changes?.length || update.undone || update.pending || update.windowVersion) break;
        through++;
    }
    const outstanding = slots.slice(0,through).findIndex(({rec})=>rec?.update?.pending);
    return outstanding >= 0 ? outstanding : through;
}

export function storyJournalStatus() {
    const slots = storySlots();
    const pending = slots.filter(({rec})=>!!rec?.update?.pending).length + (chatState()?.storyJournalCarry?.length || 0);
    const uncertain = slots.filter(({rec})=>!!rec?.memoryUncertain).length;
    return {pending,uncertain,filed:filedThrough(),error:chatState()?.storyJournalError || chatState()?.historicalMemoryError || ''};
}

export function carryStoryJournal(data,world,chat,root) {
    const slots = storySlots(chat);
    const inherited = (root.storyJournalCarry || []).filter(pending=>pending.world===world && !wasPromoted(data,world,pending))
        .map(pending=>({...structuredClone(pending),remaining:Math.max(1,pending.remaining-slots.length)}));
    const recent = slots.flatMap(({message,index,rec},position)=>{
        const pending = rec?.update?.pending;
        if (!pending || rec.update.world!==world || !revisionMatches(message,index,pending.revision) ||
            rec.update.undone || rec.stateStale || wasPromoted(data,world,pending)) return [];
        const previous = slots[position-1]?.index ?? 0;
        const player = chat.slice(previous+1,index).findLast(item=>item.is_user);
        const source = {reply:position+1,speaker:message.name || '',
            text:String(message.mes || '').replace(/\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/gi,''),
            playerText:stripStoredQuickText(String(player?.mes || '')),scene:structuredClone(rec.scene || {})};
        const changes = pendingStoryPatches(chat,index,pending);
        if (!changes.length) return [];
        return [{...structuredClone(pending),changes:structuredClone(changes),world,source,
            remaining:Math.max(1,editableReplySlots()-slots.length+position+1)}];
    });
    return [...inherited,...recent];
}
