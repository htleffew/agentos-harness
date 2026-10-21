// Undercurrent 2 · FEATURES — read-only views of ctx.chat. Everything is addressed by uc_id (chat[i].extra.uc_id),
// never by index. The "turn anchor" is the latest user message: everything that must be swipe-consistent is keyed by
// its uc_id, so swiping or regenerating the reply to it sees the same anchor and the same cached decisions.

import { str, cleanReply, hashText } from './text.js';

export function uidOf(m) {
    const id = m?.extra?.uc_id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

function isMsg(m) {
    return m !== null && typeof m === 'object';
}

/** Non-system messages in chat order: {pos, uid, isUser, name, mes}. pos is a position in ctx.chat, used only transiently. */
export function messages(ctx) {
    const chat = Array.isArray(ctx?.chat) ? ctx.chat : [];
    const out = [];
    for (let i = 0; i < chat.length; i++) {
        const m = chat[i];
        if (!isMsg(m) || m.is_system) continue;
        out.push({ pos: i, uid: uidOf(m), isUser: !!m.is_user, name: str(m.name), mes: str(m.mes) });
    }
    return out;
}

/**
 * The turn anchor and the reply it answers:
 *   user: the latest user message (the anchor), reply: the latest AI message before it,
 *   replyUser: the user message that reply answered, previous: AI messages before `reply` (oldest first),
 *   turn: 1-based count of user messages up to and including the anchor, userUids: uc_ids of user messages in order.
 * Swiping the newest reply never changes any of these.
 */
export function anchor(ctx) {
    const list = messages(ctx);
    let u = -1;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].isUser) { u = i; break; }
    let r = -1;
    for (let i = (u === -1 ? list.length : u) - 1; i >= 0; i--) if (!list[i].isUser) { r = i; break; }
    let ru = -1;
    for (let i = r - 1; i >= 0; i--) if (list[i].isUser) { ru = i; break; }
    const previous = [];
    for (let i = 0; i < r; i++) if (!list[i].isUser) previous.push(list[i]);
    const userUids = [];
    let turn = 0;
    for (let i = 0; i < list.length; i++) {
        if (!list[i].isUser) continue;
        if (i <= u) turn++;
        userUids.push(list[i].uid || `pos:${list[i].pos}`);
    }
    return {
        list,
        user: u >= 0 ? list[u] : null,
        userKey: u >= 0 ? (list[u].uid || '') : '',
        reply: r >= 0 ? list[r] : null,
        replyUser: ru >= 0 ? list[ru] : null,
        previous,
        turn,
        userUids: userUids.slice(0, turn),
        lastIsReplyAfterAnchor: list.length > 0 && !list[list.length - 1].isUser && (u === -1 || list.length - 1 > u),
    };
}

/** The player's name ({{user}} is also always recognised). */
export function userName(ctx) {
    return str(ctx?.persona?.name).trim();
}

export function charName(ctx) {
    return str(ctx?.card?.name).trim();
}

export function sameName(a, b) {
    return str(a).trim().toLowerCase() !== '' && str(a).trim().toLowerCase() === str(b).trim().toLowerCase();
}

/** True when a name refers to the player ({{user}} or the persona name). */
export function isUser(ctx, name) {
    const n = str(name).trim().toLowerCase();
    if (!n) return false;
    if (n === '{{user}}') return true;
    const u = userName(ctx).toLowerCase();
    return !!u && n === u;
}

const cleanCache = new Map();
/** Cleaned story prose of a message (cached by uid + hash of mes). */
export function cleanOf(m) {
    if (!m) return '';
    const key = `${m.uid}|${hashText(m.mes)}|${m.mes.length}`;
    const hit = cleanCache.get(key);
    if (hit !== undefined) return hit;
    const v = m.isUser ? str(m.mes).trim() : cleanReply(m.mes);
    cleanCache.set(key, v);
    if (cleanCache.size > 600) cleanCache.delete(cleanCache.keys().next().value);
    return v;
}

/** Prune a uid-keyed object to the uids still in the chat (keeping at most `max` newest). */
export function pruneByUids(obj, uids, max = 200) {
    const keep = new Set(uids);
    const out = {};
    const entries = Object.entries(obj || {}).filter(([k]) => keep.has(k.split('#')[0]));
    for (const [k, v] of entries.slice(-max)) out[k] = v;
    return out;
}
