// Undercurrent 2 · FEATURES — story stall detection (shared by ticguard and events). Code only.
// A story stalls when the last few replies keep the same place and time and add nothing durable (no Facts, Threads or
// New_Character blocks in their envelopes), or when the newest reply is nearly identical in content to the one before.

import { str, contentTokens, jaccard } from './text.js';
import { anchor, cleanOf } from './chat.js';

function sceneField(mes, field) {
    const m = str(mes).match(/<Scene\b[^>]*>([\s\S]*?)(?:<\/Scene>|<\/UC>|$)/i);
    if (!m) return '';
    const f = m[1].match(new RegExp(`(?:^|\\|)\\s*${field}\\s*:\\s*([^|\\n]*)`, 'i'));
    return f ? f[1].trim().toLowerCase() : '';
}

function addsSomething(mes) {
    return /<(?:Facts|Threads|New_Character)\b/i.test(str(mes));
}

/** {stalled, reason: 'static'|'samey'|''} for the reply before the turn anchor. */
export function stallOf(ctx, { window = 3, samey = 0.55 } = {}) {
    const a = anchor(ctx);
    if (!a.reply) return { stalled: false, reason: '' };
    const recent = [...a.previous.slice(-(window - 1)), a.reply];
    if (recent.length >= window) {
        const places = recent.map(m => sceneField(m.mes, 'place'));
        const times = recent.map(m => sceneField(m.mes, 'time'));
        const same = list => list[0] && list.every(x => x === list[0]);
        if (same(places) && same(times) && !recent.some(m => addsSomething(m.mes))) return { stalled: true, reason: 'static' };
    }
    const prev = a.previous[a.previous.length - 1];
    if (prev && jaccard(contentTokens(cleanOf(a.reply)), contentTokens(cleanOf(prev))) >= samey) return { stalled: true, reason: 'samey' };
    return { stalled: false, reason: '' };
}
