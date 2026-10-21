// Undercurrent 2: interpret parsed envelope blocks into structured records. Pure; tolerant of messy model output.

import { normKey } from '../core/util.js';

/** Values that mean "omitted / unchanged" (template placeholders copied verbatim, dashes, "same"). */
const OMITTED = /^(?:…+|\.{2,}|-+|—+|–+|\?+|unchanged|same|no change|n\/a|na|tbd|\[.*\])$/i;
/** Values that clear a field. */
const CLEARED = /^(?:none|nothing|nobody|no one|empty|null|nil)\.?$/i;

export const MIND_FIELDS = Object.freeze(['mood', 'wants', 'plan', 'knows', 'doesnt_know', 'secret']);

const KEY_ALIASES = {
    weather_light: 'weather', light: 'weather', weather_lighting: 'weather', lighting: 'weather', weather: 'weather',
    location: 'place', loc: 'place', where: 'place', when: 'time', date: 'time',
    doesnt_know: 'doesnt_know', does_not_know: 'doesnt_know', dont_know: 'doesnt_know', unaware: 'doesnt_know', unaware_of: 'doesnt_know',
    want: 'wants', wish: 'wants', desire: 'wants', plans: 'plan', intent: 'plan', intends: 'plan', knowledge: 'knows', know: 'knows',
    secrets: 'secret', hides: 'secret', feeling: 'mood', feels: 'mood', emotion: 'mood',
    next: 'next_beat', nextbeat: 'next_beat', beat: 'next_beat', hidden_state: 'hidden',
    like: 'likes', dislike: 'dislikes', limit: 'limits', boundary: 'limits', boundaries: 'limits', hard_limit: 'limits',
    off_screen: 'offscreen', offscreen: 'offscreen', seed: 'planted', seeds: 'planted', plant: 'planted',
    timer: 'timer', timers: 'timer', clock: 'timer', countdown: 'timer', resolve: 'resolved', done: 'resolved', closed: 'resolved',
    sexual_self: 'sexual_self', sexuality: 'sexual_self', sexual: 'sexual_self',
};

/** Normalize a field key: "Doesn't know" → doesnt_know, "weather/light" → weather. */
export function normField(key) {
    const k = String(key ?? '')
        .toLowerCase()
        .replace(/[*_`#]+/g, ' ')
        .replace(/[‘’']/g, '')
        .replace(/[^a-z0-9/ ]+/g, ' ')
        .trim()
        .replace(/[\s/]+/g, '_');
    return KEY_ALIASES[k] || k;
}

function cleanValue(v) {
    return String(v ?? '')
        .replace(/^\s*[*_]+|[*_]+\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 'omit' | 'clear' | the cleaned value. */
export function classifyValue(v) {
    const c = cleanValue(v);
    if (!c || OMITTED.test(c)) return { kind: 'omit', value: '' };
    if (CLEARED.test(c)) return { kind: 'clear', value: '' };
    return { kind: 'set', value: c };
}

const BULLET = /^\s*(?:[*•·]|\d+[.)])\s+/;

/**
 * Split "key: value | key: value" text (lines and pipes) into ordered [key, value] pairs. Parts without a key continue
 * the previous value.
 */
export function keyValues(text) {
    const pairs = [];
    const parts = String(text ?? '').split(/\r?\n|\s\|\s|\|/);
    for (let raw of parts) {
        raw = raw.replace(BULLET, '').replace(/^\s*-\s+/, '').trim();
        if (!raw) continue;
        const m = raw.match(/^\**\s*([A-Za-z][A-Za-z0-9 '’/_-]{0,30}?)\s*\**\s*:\s*(.*)$/);
        if (m) pairs.push([normField(m[1]), m[2]]);
        else if (pairs.length) pairs[pairs.length - 1][1] += ` ${raw}`;
    }
    return pairs;
}

/** Split a list value "A, B and C" into names. */
export function splitNames(v) {
    return String(v ?? '')
        .split(/\s*(?:,|;|\band\b|&|\/)\s*/i)
        .map(s => s.replace(/^[\s"'*]+|[\s"'*.]+$/g, '').trim())
        .filter(s => s && !OMITTED.test(s) && !CLEARED.test(s));
}

/** Scene → {fields:{time, place, weather, room, ...}, present?:string[]} (only set fields). */
export function parseScene(block) {
    const fields = {};
    let present;
    for (const [k, v] of keyValues(block.lines.join('\n'))) {
        const c = classifyValue(v);
        if (c.kind === 'omit') continue;
        if (k === 'present' || k === 'here' || k === 'characters' || k === 'cast') {
            present = c.kind === 'clear' ? [] : splitNames(c.value);
            continue;
        }
        fields[k] = c.value;
    }
    return { fields, present };
}

/** Tracker → {arc, phase, scene, next_beat, hidden, ...} (only set fields; cleared fields map to ''). */
export function parseTracker(block) {
    const out = {};
    for (const [k, v] of keyValues(block.lines.join('\n'))) {
        const c = classifyValue(v);
        if (c.kind === 'omit') continue;
        out[k] = c.value;
    }
    return out;
}

const NAME_SPLIT = /^\s*(?:[-*•]\s+)?\**\s*([^—–|:]+?)\s*\**\s*(?:—|–|--|:|\s-\s)\s*(.*)$/;

/**
 * Minds → [{name, fields:{mood?, wants?, ...}}]. Fields map to '' when cleared and are absent when omitted.
 * Lines naming the player (userNames) are ignored: the reply never owns the player's mind.
 */
export function parseMinds(block, { userNames = [] } = {}) {
    const users = new Set(userNames.map(normKey).filter(Boolean));
    users.add('{{user}}');
    users.add('user');
    const out = [];
    let cur = null;
    for (const line of block.lines) {
        const m = line.match(NAME_SPLIT);
        let name = m ? m[1].replace(/[*"]/g, '').trim() : '';
        let rest = m ? m[2] : line;
        if (m && (MIND_FIELDS.includes(normField(name)) || !name)) {
            // continuation line "mood: …" for the previous character
            rest = line;
            name = '';
        }
        if (name) {
            cur = { name, fields: {} };
            if (users.has(normKey(name))) { cur.skip = true; }
            out.push(cur);
        }
        if (!cur) continue;
        for (const [k, v] of keyValues(rest)) {
            if (!MIND_FIELDS.includes(k)) continue;
            const c = classifyValue(v);
            if (c.kind === 'omit') continue;
            cur.fields[k] = c.value;
        }
    }
    return out.filter(x => !x.skip && x.name.length <= 60);
}

function splitWho(v) {
    const m = String(v ?? '').match(/^\s*([^—–:]+?)\s*(?:—|–|--|:|\s-\s)\s*(.+)$/);
    if (!m) return { name: '', doing: cleanValue(v) };
    return { name: m[1].replace(/[*"]/g, '').trim(), doing: cleanValue(m[2]).replace(/^doing\s+/i, '') };
}

/** Threads → {offscreen:[{name, doing}], planted:[text], timers:[{text, turnsLeft}], resolved:[text]} */
export function parseThreads(block) {
    const out = { offscreen: [], planted: [], timers: [], resolved: [] };
    for (const line of block.lines) {
        const m = line.replace(BULLET, '').replace(/^\s*-\s+/, '').match(/^\**\s*([A-Za-z][A-Za-z -]{1,20}?)\s*\**\s*:\s*(.*)$/);
        if (!m) continue;
        const k = normField(m[1]);
        const c = classifyValue(m[2]);
        if (c.kind !== 'set') continue;
        if (k === 'offscreen') {
            const w = splitWho(c.value);
            if (w.doing) out.offscreen.push(w);
        } else if (k === 'planted') {
            out.planted.push(c.value);
        } else if (k === 'timer') {
            const n = c.value.match(/\(?\s*(?:turns?\s*left\s*[:=]?\s*(\d+)|(\d+)\s*turns?(?:\s*left)?)\s*\)?/i);
            const turnsLeft = n ? Number(n[1] ?? n[2]) : null;
            const text = cleanValue(c.value.replace(/\(?\s*(?:turns?\s*left\s*[:=]?\s*\d+|\d+\s*turns?(?:\s*left)?)\s*\)?/i, '')).replace(/[\s,;—–-]+$/, '');
            out.timers.push({ text: text || c.value, turnsLeft });
        } else if (k === 'resolved') {
            out.resolved.push(c.value);
        }
    }
    return out;
}

/** Facts → {add:[text], remove:[text]} ("+ fact" newly true, "- fact" no longer true; unprefixed lines add). */
export function parseFacts(block) {
    const add = [];
    const remove = [];
    for (const line of block.lines) {
        const m = line.match(/^\s*([+\-−–])\s*(.+)$/);
        const sign = m ? m[1] : '+';
        const c = classifyValue((m ? m[2] : line).replace(BULLET, ''));
        if (c.kind !== 'set') continue;
        if (sign === '+') add.push(c.value);
        else remove.push(c.value);
    }
    return { add, remove };
}

/** Pull a trailing "quote" (straight or curly) out of a value: {text, quote}. */
export function splitQuote(v) {
    const s = cleanValue(v);
    const m = s.match(/(?:"([^"]+)"|“([^”]+)”)\s*[.)]?\s*$/);
    if (!m) return { text: s, quote: '' };
    const quote = (m[1] ?? m[2]).trim();
    const text = s.slice(0, m.index).replace(/[\s,;:—–-]+$/, '').replace(/\($/, '').trim();
    return { text: text || quote, quote };
}

/** Intimacy name="X" → {name, likes:[{text, quote}], dislikes, limits, history} */
export function parseIntimacy(block) {
    const out = { name: String(block.attrs?.name ?? '').trim(), likes: [], dislikes: [], limits: [], history: [] };
    for (const [k, v] of keyValues(block.lines.join('\n'))) {
        if (!['likes', 'dislikes', 'limits', 'history'].includes(k)) continue;
        const c = classifyValue(v);
        if (c.kind !== 'set') continue;
        out[k].push(k === 'history' ? { text: c.value, quote: '' } : splitQuote(c.value));
    }
    return out;
}

/** New_Character name="X" → {name, profile:{role, look, voice, wants, ikigai, secret, sexual_self, ...}} */
export function parseNewCharacter(block) {
    const profile = {};
    for (const [k, v] of keyValues(block.lines.join('\n'))) {
        const c = classifyValue(v);
        if (c.kind !== 'set') continue;
        if (k === 'name') continue;
        profile[k] = profile[k] ? `${profile[k]}; ${c.value}` : c.value;
    }
    return { name: String(block.attrs?.name ?? '').trim(), profile };
}
