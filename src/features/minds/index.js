// Undercurrent 2 · FEATURES — minds: one compact 'uc_cast' line per relevant character, from derived state.
//
// Who gets a line (never {{user}}):
//   1. characters present (state.scene.present), {{char}} first, then the most recently seen;
//   2. characters named in the latest reply or in what the player just said, when the scene record lags behind;
//   3. absent characters only when the player names them (spoken part only) or a timer thread naming them is due:
//      an off-screen line (what they are doing, how they feel, what they want).
// Line shape: "Name — mood: …; wants: …; plan: …; knows: …; doesn't know: …; secret: …" (empty fields omitted). A
// character under strain (their mood) gets one defense cue chosen from their OWN recorded traits (never hard-coded).
// Priorities follow presence and recency so CORE's word budget drops the least relevant lines first.

import { str, clip, normText, publicPart, cueHits, isPlainObject } from '../common/text.js';
import { anchor, cleanOf, isUser, charName, sameName } from '../common/chat.js';
import { optBool, optNum } from '../common/settings.js';
import { characters, findCharacter, mindOf, profileOf, presentNames, threadsOf } from '../common/state.js';
import { STRAIN_MOODS, DEFENSES, STOPWORDS } from '../common/lexicon.js';

export const DEFAULTS = Object.freeze({
    'minds.enabled': true,
    'minds.max_lines': 4,
    'minds.defenses': true,
});

export const SCHEMA = [
    { key: 'minds.enabled', tab: 'characters', section: 'Minds', type: 'toggle', default: true, label: 'Character minds in the turn',
        help: 'Each present character\'s mood, wants, plan, what they know and don\'t, and secrets ride along with every turn (hidden).', scope: 'story' },
    { key: 'minds.max_lines', tab: 'characters', section: 'Minds', type: 'slider', default: 4, min: 1, max: 8, step: 1, advanced: true, label: 'Characters per turn',
        help: 'At most this many characters get a line (present ones first).', scope: 'setup' },
    { key: 'minds.defenses', tab: 'characters', section: 'Minds', type: 'toggle', default: true, advanced: true, label: 'Defenses under strain',
        help: 'When a character\'s mood shows strain, add how they tend to defend, chosen from their own recorded traits.', scope: 'setup' },
];

const FIELDS = [['mood', 'mood'], ['wants', 'wants'], ['plan', 'plan'], ['knows', 'knows'], ['unknown', 'doesn\'t know'], ['secret', 'secret']];

function mentions(text, name) {
    const n = normText(name);
    if (!n) return false;
    const t = ` ${normText(text)} `;
    if (t.includes(` ${n} `)) return true;
    const first = n.split(' ')[0];
    return n.includes(' ') && first.length >= 3 && !STOPWORDS.has(first) && t.includes(` ${first} `);
}

function defenseFor(ctx, name, c, mood) {
    if (!cueHits(mood, STRAIN_MOODS).length) return '';
    const p = profileOf(c);
    const own = [...Object.values(p), sameName(name, charName(ctx)) ? `${str(ctx?.card?.personality)} ${str(ctx?.card?.description)}` : ''].join(' ');
    let best = null;
    for (const d of DEFENSES) {
        const n = cueHits(own, d.cues).length;
        if (n && (!best || n > best.n)) best = { d, n };
    }
    return best ? best.d.behavior : '';
}

/** The mind line for one character, or '' when nothing is recorded. */
export function mindLine(ctx, name, { offscreen = '', defenses = true } = {}) {
    const rec = findCharacter(ctx, name);
    const c = rec ? rec.c : {};
    const m = mindOf(c);
    const bits = [];
    if (offscreen) bits.push(`off-screen, ${clip(offscreen, 120)}`);
    for (const [k, label] of FIELDS) if (m[k]) bits.push(`${label}: ${clip(m[k], k === 'secret' || k === 'unknown' ? 140 : 110)}`);
    if (defenses && m.mood) {
        const d = defenseFor(ctx, rec?.name || name, c, m.mood);
        if (d) bits.push(`under strain: ${d}`);
    }
    if (!bits.length) return '';
    return `${rec?.name || name} — ${bits.join('; ')}`;
}

function lastSeenRank(c) {
    const v = c?.lastSeen ?? c?.last_seen;
    return Number.isFinite(Number(v)) ? Number(v) : -1;
}

/** Ordered candidates: [{name, kind:'present'|'mentioned'|'offscreen', offscreen?, priority}]. */
export function castCandidates(ctx) {
    const a = anchor(ctx);
    const all = characters(ctx);
    const present = presentNames(ctx);
    const card = charName(ctx);
    const out = [];
    const has = n => out.some(x => sameName(x.name, n));
    const recordedName = n => findCharacter(ctx, n)?.name || n;
    const sorted = [...present].sort((x, y) => {
        if (sameName(x, card)) return -1;
        if (sameName(y, card)) return 1;
        return lastSeenRank(all[recordedName(y)]) - lastSeenRank(all[recordedName(x)]);
    });
    sorted.forEach((n, i) => out.push({ name: recordedName(n), kind: 'present', priority: Math.max(60, 82 - i * 3) }));
    const reply = a.reply ? cleanOf(a.reply) : '';
    const said = a.user ? publicPart(a.user.mes) : '';
    const known = Object.keys(all).filter(n => !isUser(ctx, n) && !has(n));
    for (const n of known) {
        if (mentions(reply.slice(-1500), n) || mentions(said, n)) {
            if (mentions(said, n) && !mentions(reply.slice(-1500), n)) continue; // named only by the player → off-screen path below
            out.push({ name: n, kind: 'mentioned', priority: 58 });
        }
    }
    const th = threadsOf(ctx);
    for (const n of Object.keys(all).filter(x => !isUser(ctx, x) && !has(x))) {
        const off = th.offscreen.find(o => sameName(o.name, n) || mentions(o.name, n))?.text || str(all[n]?.offscreen).trim();
        if (mentions(said, n)) out.push({ name: n, kind: 'offscreen', offscreen: off || 'not here', priority: 52 });
        else {
            const due = th.timers.find(t => t.left !== null && t.left <= 1 && mentions(t.text, n));
            if (due) out.push({ name: n, kind: 'offscreen', offscreen: off || `due: ${due.text}`, priority: 50 });
        }
    }
    return out;
}

export default {
    id: 'minds',
    settingsKeys: Object.keys(DEFAULTS),
    turnLines(ctx) {
        if (!optBool(ctx, 'minds.enabled', true)) return [];
        if (!isPlainObject(ctx?.state)) return [];
        const max = Math.round(optNum(ctx, 'minds.max_lines', 4, 1, 8));
        const defenses = optBool(ctx, 'minds.defenses', true);
        const lines = [];
        for (const c of castCandidates(ctx)) {
            if (lines.length >= max) break;
            const text = mindLine(ctx, c.name, { offscreen: c.kind === 'offscreen' ? c.offscreen : '', defenses });
            if (text) lines.push({ slot: 'uc_cast', text, priority: c.priority, source: `minds:${c.kind}` });
        }
        return lines;
    },
};
