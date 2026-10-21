// Undercurrent 2: stable message ids (BUILD_SPEC §3.2). Pure (operates on the chat array it is given).
//
// chat[i].extra.uc_id is a uuid shared by every swipe of the message. SillyTavern keeps `extra` PER SWIPE
// (swipe_info[j].extra, restored into chat[i].extra on swipe: public/script.js syncSwipeToMes ~6956), so the id is
// written into every swipe_info entry too; a freshly generated swipe recovers its siblings' id. Duplicate ids inside one
// chat (copied messages) are re-issued so per-message data is never shared by accident.

import { uuid as makeUuid } from '../core/util.js';

/** The uc_id of a message (from extra, else from any swipe), or ''. */
export function idOf(m) {
    if (!m || typeof m !== 'object') return '';
    const own = m.extra?.uc_id;
    if (typeof own === 'string' && own) return own;
    if (Array.isArray(m.swipe_info)) {
        for (const s of m.swipe_info) {
            const id = s?.extra?.uc_id;
            if (typeof id === 'string' && id) return id;
        }
    }
    return '';
}

/**
 * Ensure every message carries a uc_id. Mutates chat messages. Returns how many writes happened (0 = nothing to save).
 * @param {object[]} chat
 * @param {() => string} [newId]
 */
export function ensureIds(chat, newId = makeUuid) {
    if (!Array.isArray(chat)) return 0;
    let writes = 0;
    const used = new Set();
    for (const m of chat) {
        if (!m || typeof m !== 'object') continue;
        let id = idOf(m);
        if (!id || used.has(id)) id = newId();
        used.add(id);
        if (!m.extra || typeof m.extra !== 'object') m.extra = {};
        if (m.extra.uc_id !== id) { m.extra.uc_id = id; writes++; }
        if (Array.isArray(m.swipe_info)) {
            for (const s of m.swipe_info) {
                if (!s || typeof s !== 'object') continue;
                if (!s.extra || typeof s.extra !== 'object') s.extra = {};
                if (s.extra.uc_id !== id) { s.extra.uc_id = id; writes++; }
            }
        }
    }
    return writes;
}

/** Index of the message with this uc_id, or -1. */
export function indexOfId(chat, id) {
    if (!id || !Array.isArray(chat)) return -1;
    for (let i = chat.length - 1; i >= 0; i--) if (idOf(chat[i]) === id) return i;
    return -1;
}
