// Undercurrent 2 · FEATURES — memory archive: which messages leave the prompt, addressed by uc_id ranges (never by index).
//
// Tiers (counting non-system messages from the newest backwards):
//   working  — the last `window` messages: always sent raw;
//   archived — older messages grouped into chunks of `chunk` messages; excluded from the prompt by the interceptor and
//              represented by their summary (when summaries are on) and by keyword/semantic recall of their raw text;
//   pending  — older than the window but not yet in a complete chunk, or (summaries on) a chunk whose summary is not
//              ready yet and that is still within two chunks of the window: sent raw until processed.
// A chunk is stored as {id:"<firstUid>..<lastUid>", uids[], hashes[], storyTime, summary:{text, hashes[], storyTime}|null}.
// Every reconcile re-validates the stored chunks against the chat as it stands:
//   - a chunk whose messages were deleted, re-ordered, or that fell back into the working window is dropped (its
//     messages return to the prompt, then re-chunk);
//   - an edited message changes its hash; the chunk keeps its boundaries but its summary no longer matches (stale) →
//     the summary is ignored and a new summary job is queued.
// Raw chunk text is never stored: it is read from the chat itself (the messages are only hidden from the prompt).

import { str, hashText } from '../common/text.js';
import { uidOf } from '../common/chat.js';
import { cleanReply } from '../common/text.js';

const hashMemo = new WeakMap();
function msgHash(m) {
    const mes = str(m?.mes);
    const hit = hashMemo.get(m);
    if (hit && hit.mes === mes) return hit.hash;
    const hash = hashText(mes);
    try { hashMemo.set(m, { mes, hash }); } catch { /* frozen or primitive */ }
    return hash;
}

/** Non-system messages with their uid and hash (messages without a uid can never be archived). */
export function indexChat(chat) {
    const out = [];
    const list = Array.isArray(chat) ? chat : [];
    for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m || typeof m !== 'object' || m.is_system) continue;
        out.push({ pos: i, uid: uidOf(m), hash: msgHash(m), m });
    }
    return out;
}

/** In-story time recorded in the last <Scene> of the chunk's replies ('' when none). */
export function storyTimeOf(msgs) {
    for (let i = msgs.length - 1; i >= 0; i--) {
        const mes = str(msgs[i].m?.mes);
        if (msgs[i].m?.is_user || !/<Scene\b/i.test(mes)) continue;
        const scene = mes.slice(mes.search(/<Scene\b/i));
        const t = scene.match(/(?:^|[|>\n])\s*time\s*:\s*([^|\n<]+)/i);
        if (t && t[1].trim()) return t[1].trim().slice(0, 80);
    }
    return '';
}

function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Reconcile stored chunks with the chat.
 * @param {object[]} chat ctx.chat
 * @param {object[]} stored chunks from the store
 * @param {{window:number, chunk:number, summaries:boolean, summaryLookup?:(id, hashes) => object|null}} opts
 *   summaryLookup re-uses a summary computed earlier for exactly the same range and text.
 * @returns {{chunks:object[], changed:boolean, all:object[], working:number, archivedUids:Set<string>, pendingCount:number, needSummary:object[]}}
 */
export function reconcile(chat, stored, { window = 30, chunk = 10, summaries = true, summaryLookup = null } = {}) {
    const all = indexChat(chat);
    const W = Math.max(2, Math.round(window));
    const C = Math.max(2, Math.round(chunk));
    const archCount = Math.max(0, all.length - W);
    const arch = all.slice(0, archCount);
    const posOf = new Map();
    arch.forEach((x, i) => { if (x.uid) posOf.set(x.uid, i); });

    const covered = new Array(archCount).fill(false);
    const valid = [];
    let changed = false;
    for (const ch of Array.isArray(stored) ? stored : []) {
        const uids = Array.isArray(ch?.uids) ? ch.uids : [];
        const idx = uids.map(u => posOf.get(u));
        const ok = uids.length > 0 && idx.every((p, i) => p !== undefined && p === idx[0] + i && !covered[p]);
        if (!ok) { changed = true; continue; }
        idx.forEach(p => { covered[p] = true; });
        const hashes = idx.map(p => arch[p].hash);
        if (!sameList(hashes, ch.hashes)) changed = true;
        const same = sameList(hashes, ch.hashes) && typeof ch.storyTime === 'string';
        valid.push({ ...ch, hashes, first: idx[0], storyTime: same ? ch.storyTime : storyTimeOf(idx.map(p => arch[p])) });
    }
    // Chunk the uncovered runs. A run that ends at the working window only forms complete chunks; a run boxed in by
    // older chunks (after a delete) can never grow, so it is chunked whole (a short remainder joins the last piece).
    let s = 0;
    while (s < archCount) {
        if (covered[s] || !arch[s].uid) { s++; continue; }
        let e = s;
        while (e + 1 < archCount && !covered[e + 1] && arch[e + 1].uid) e++;
        const tail = !covered.slice(e + 1).some(Boolean);
        const len = e - s + 1;
        const pieces = [];
        if (tail) {
            for (let k = 0; k + C <= len; k += C) pieces.push([s + k, s + k + C - 1]);
        } else {
            for (let k = 0; k < len; k += C) pieces.push([s + k, Math.min(e, s + k + C - 1)]);
            const last = pieces[pieces.length - 1];
            if (pieces.length > 1 && last[1] - last[0] + 1 < C / 2) { pieces.pop(); pieces[pieces.length - 1][1] = last[1]; }
        }
        for (const [a, b] of pieces) {
            const msgs = arch.slice(a, b + 1);
            valid.push({ id: `${msgs[0].uid}..${msgs[msgs.length - 1].uid}`, uids: msgs.map(x => x.uid), hashes: msgs.map(x => x.hash), storyTime: storyTimeOf(msgs), summary: null, first: a });
            for (let p = a; p <= b; p++) covered[p] = true;
            changed = true;
        }
        s = e + 1;
    }
    valid.sort((x, y) => x.first - y.first);
    // Exclusion: with summaries on, an unsummarized chunk stays in the prompt while it is among the 2 newest chunks.
    const archivedUids = new Set();
    const needSummary = [];
    const chunks = valid.map((ch, i) => {
        if (typeof summaryLookup === 'function' && !(ch.summary && sameList(ch.summary.hashes, ch.hashes))) {
            const hit = summaryLookup(ch.id, ch.hashes);
            if (hit && str(hit.text) && sameList(hit.hashes, ch.hashes)) { ch.summary = hit; changed = true; }
        }
        const summaryValid = !!(ch.summary && str(ch.summary.text) && sameList(ch.summary.hashes, ch.hashes));
        const fromEnd = valid.length - 1 - i;
        const archived = !summaries || summaryValid || fromEnd >= 2;
        if (archived) for (const u of ch.uids) archivedUids.add(u);
        if (summaries && !summaryValid) needSummary.push(ch);
        const { first: _f, ...rest } = ch;
        return { ...rest, summaryValid, archived };
    });
    const pendingCount = arch.length - chunks.filter(c => c.archived).reduce((n, c) => n + c.uids.length, 0);
    return { chunks, changed, all, working: Math.min(W, all.length), archivedUids, pendingCount, needSummary };
}

/** Storable form of chunks (no derived flags). */
export function storable(chunks) {
    return chunks.map(c => ({ id: c.id, uids: c.uids, hashes: c.hashes, storyTime: c.storyTime || '', summary: c.summary || null }));
}

/** "Name: text" lines of a chunk's messages (story prose only), for summaries and recall. */
export function chunkMessages(chunk, all, { userName = '', charName = '' } = {}) {
    const byUid = new Map(all.filter(x => x.uid).map(x => [x.uid, x]));
    return chunk.uids.map(u => byUid.get(u)).filter(Boolean).map((x) => {
        const name = str(x.m.name) || (x.m.is_user ? userName || '{{user}}' : charName || '{{char}}');
        const text = x.m.is_user ? str(x.m.mes).trim() : cleanReply(x.m.mes);
        return { uid: x.uid, name, text, isUser: !!x.m.is_user };
    }).filter(x => x.text);
}
