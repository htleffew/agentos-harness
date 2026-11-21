import { canonSet, entriesOf } from './books.js';
import { ctx, KEY, isReply } from './st.js';
import { chatState } from './store.js';
import { chatWorld, listWorld, loadWorld } from './world.js';
import { revertChanges, worldIdle } from './worldflow.js';
import { readRecord } from './v10.js';
import { projectStoryJournal } from './memory-journal.js';

// Rewind a private copy. The reply viewer never changes the book or unhides messages.
export function worldAtReply(data, world, chat, index, manual = [], chatId, root = null) {
    const matches = id => id && canonSet(id) === world;
    const anchors = new Set(['seed']);
    const recordIndices = new Map();
    let replyCount = 0;
    const future = [];
    for (const [position, message] of chat.entries()) {
        const record = message?.extra?.[KEY];
        if (record?.time) recordIndices.set(String(record.time), position);
        if (position <= index) {
            if (record?.time) anchors.add(`record:${record.time}`);
            if (message?.send_date) anchors.add(`message:${message.send_date}`);
            if (position && isReply(message)) replyCount++;
        } else if (record?.update && !record.update.undone && matches(record.update.world)) {
            future.push({ time: Number(record.time), changes: record.update.changes });
        }
    }
    for (const edit of manual) if (matches(edit.world) && edit.anchor && !anchors.has(edit.anchor)) {
        future.push({ time: Number(edit.time), edit });
    }
    const entries = Object.fromEntries(entriesOf(data,world).map(entry=>[entry.uid,entry]));
    const copy = { entries: structuredClone(entries) };
    const conflicts = new Set();
    for (const item of future.sort((a,b) => b.time - a.time)) {
        if (!item.edit) {
            revertChanges(copy, world, (item.changes || []).filter(change => change.type !== 'hide'), { conflicts });
            continue;
        }
        const { uid, before, after } = item.edit;
        if (conflicts.has(uid)) continue;
        if (JSON.stringify(copy.entries[uid] || null) !== JSON.stringify(after)) conflicts.add(uid);
        else if (before) copy.entries[uid] = structuredClone(before);
        else delete copy.entries[uid];
    }
    const effective = projectStoryJournal(copy,world,{chat,root,before:index+1});
    const rows = listWorld(effective.data, world).filter(row => {
        if (!row.on || conflicts.has(row.uid)) return false;
        if (row.kind==='chapter' && row.span) {
            const terminal = recordIndices.get(String(row.span.time));
            if (terminal !== undefined && terminal>index || row.span.chat===chatId && row.span.to>replyCount) return false;
        }
        const source = recordIndices.get(String(readRecord(row)?.source));
        if (source !== undefined) return source <= index && !chat[source]?.extra?.[KEY]?.stateStale;
        return !row.at || row.at.chat !== chatId || row.at.n <= replyCount;
    });
    return { rows, partial: conflicts.size > 0 || effective.conflicts.length > 0 };
}

export function timelineDependents(index) {
    const later = (ctx().chat || []).slice(index+1).filter(isReply);
    return {
        replies:later.length,
        cards:later.filter(message=>message.extra?.[KEY]?.scene || message.extra?.[KEY]?.update).length,
        filed:later.filter(message=>message.extra?.[KEY]?.update?.changes?.length).length,
    };
}

export async function readReplyWorld(index) {
    const host = ctx(), chat = host.chat, root = chatState(), id = host.getCurrentChatId?.();
    const target = chat?.[index], record = target?.extra?.[KEY];
    await worldIdle();
    const world = chatWorld();
    const stored = record?.update?.world;
    const data = world && (!stored || canonSet(stored) === world) ? await loadWorld(world) : null;
    const current = ctx();
    if (current.chat !== chat || current.getCurrentChatId?.() !== id || chatState() !== root ||
        chatWorld() !== world || chat?.[index] !== target || target?.extra?.[KEY] !== record) {
        throw new Error('The reply changed. Open its Story State card again.');
    }
    if (data?.entries) return worldAtReply(data, world, chat, index, root?.manualWorldChanges, id, root);
    const records = new Map();
    for (const message of (chat || []).slice(0,index+1)) {
        const saved = message?.extra?.[KEY];
        if (saved?.stateStale || saved?.update?.undone) continue;
        if (stored && saved?.update?.world && canonSet(saved.update.world) !== canonSet(stored)) continue;
        for (const entry of saved?.v10Changes || []) records.set(entry.id,entry);
    }
    return { rows: [], records: [...records.values()], partial: true };
}
