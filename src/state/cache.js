// Undercurrent 2: cached, incremental derived state (BUILD_SPEC §3.3). Pure.
//
// - Parses are cached by uc_id + hash(mes) (and per message object, so unchanged messages cost one string compare).
// - The fold keeps snapshots of the state after prefixes of the chat (every SNAP_EVERY messages plus the last three),
//   so when only the tail changed (new reply, swipe, edit or delete near the end) the fold restarts from the nearest
//   snapshot instead of from the start. Results are identical to derive() (tested).
// - Overrides are applied on the output only; seed / user names / registry changes force a full recompute.

import { parseEnvelope } from '../envelope/parse.js';
import { applySeed, emptyState, foldMessage, finalizeState, messageKind } from './derive.js';
import { applyOverrides } from './overrides.js';
import { clone, hashText, stableStringify } from '../core/util.js';

const SNAP_EVERY = 32;
const PARSE_CACHE_MAX = 5000;

export function createStateCache({ registry = null, parse = null } = {}) {
    let reg = registry;
    let parseFn = parse || (mes => parseEnvelope(mes, reg));
    const parseCache = new Map(); // `${uc_id}:${hash}` -> parsed
    let perMessage = new WeakMap(); // message object -> {mes, sig, parsed}
    let baseKey = null;
    let sigs = [];
    let snaps = new Map(); // prefix length -> raw (unfinalized) state
    let lastOut = null;
    let lastOutKey = null;
    const stats = { full: 0, incremental: 0, reused: 0, parses: 0 };

    function messageInfo(m) {
        const kind = messageKind(m);
        const mes = String(m?.mes ?? '');
        const ucId = m?.extra?.uc_id || '';
        const prev = m && typeof m === 'object' ? perMessage.get(m) : null;
        if (prev && prev.mes === mes && prev.kind === kind && prev.ucId === ucId) return prev;
        const h = hashText(mes);
        let parsed = null;
        if (kind === 'ai') {
            const pk = `${ucId}:${h}:${mes.length}`;
            parsed = parseCache.get(pk);
            if (!parsed) {
                parsed = parseFn(mes);
                stats.parses++;
                if (parseCache.size >= PARSE_CACHE_MAX) parseCache.delete(parseCache.keys().next().value);
                parseCache.set(pk, parsed);
            }
        }
        const info = { mes, kind, ucId, parsed, sig: `${kind}|${ucId}|${h}|${mes.length}` };
        if (m && typeof m === 'object') perMessage.set(m, info);
        return info;
    }

    function keepSnapshot(len, total) {
        return len === 0 || len % SNAP_EVERY === 0 || len >= total - 3;
    }

    /**
     * Raw state after folding chat[0..len). Updates the snapshot store for the given chat.
     */
    function foldTo(chat, len, opts) {
        const key = stableStringify({ seed: opts.seed ?? null, users: opts.userNames ?? [] });
        const infos = chat.map(messageInfo);
        const newSigs = infos.map(x => x.sig);
        let start = 0;
        if (key === baseKey) {
            let k = 0;
            const n = Math.min(sigs.length, newSigs.length);
            while (k < n && sigs[k] === newSigs[k]) k++;
            // invalidate snapshots past the first difference
            for (const p of [...snaps.keys()]) if (p > k) snaps.delete(p);
            start = Math.max(...[...snaps.keys()].filter(p => p <= Math.min(k, len)), -1);
        } else {
            snaps = new Map();
            start = -1;
        }
        let state;
        if (start < 0) {
            state = applySeed(emptyState(), opts.seed);
            snaps.set(0, clone(state));
            start = 0;
            stats.full++;
        } else {
            state = clone(snaps.get(start));
            stats.incremental++;
        }
        for (let i = start; i < len; i++) {
            foldMessage(state, chat[i], infos[i].parsed, { userNames: opts.userNames ?? [] });
            if (keepSnapshot(i + 1, chat.length)) snaps.set(i + 1, clone(state));
        }
        baseKey = key;
        sigs = newSigs;
        // keep the snapshot store small: drop stale tail snapshots that are no longer near the end
        for (const p of [...snaps.keys()]) {
            if (p > chat.length || (p !== 0 && p % SNAP_EVERY !== 0 && p < chat.length - 3)) snaps.delete(p);
        }
        return state;
    }

    /**
     * Derived state for the whole chat (or a prefix), overrides applied, finalized. Cheap when nothing changed.
     * @param {{chat:object[], seed?:object, overrides?:object, userNames?:string[], length?:number}} o
     */
    function compute({ chat, seed = null, overrides = null, userNames = [], length = undefined }) {
        const list = Array.isArray(chat) ? chat : [];
        const len = Number.isInteger(length) ? Math.max(0, Math.min(length, list.length)) : list.length;
        // fast path: same chat signature, same overrides
        const infos = list.map(messageInfo);
        const outKey = `${len}|${infos.map(x => x.sig).join(',')}|${stableStringify({ seed, overrides, userNames })}`;
        if (lastOut && lastOutKey === outKey) {
            stats.reused++;
            return lastOut;
        }
        const raw = foldTo(list, len, { seed, userNames });
        const out = finalizeState(applyOverrides(raw, overrides));
        lastOut = out;
        lastOutKey = outKey;
        return out;
    }

    return {
        compute,
        setRegistry(next) {
            reg = next;
            if (!parse) parseFn = mes => parseEnvelope(mes, reg);
            parseCache.clear();
            perMessage = new WeakMap();
            baseKey = null;
            snaps = new Map();
            lastOut = null;
            lastOutKey = null;
        },
        /** Parsed envelope of one message (cached). */
        parsedOf(m) {
            return messageInfo(m).parsed || parseFn(String(m?.mes ?? ''));
        },
        reset() {
            baseKey = null;
            sigs = [];
            snaps = new Map();
            lastOut = null;
            lastOutKey = null;
        },
        stats: () => ({ ...stats, snapshots: snaps.size, parseCache: parseCache.size }),
    };
}
