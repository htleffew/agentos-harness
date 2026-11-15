// Instruction sets. One instruction set is one SillyTavern lorebook; one instruction is one World Info entry.
import { loadBook, saveBook, refreshWorldList, worldNames } from './st.js';
import { settings, saveSettings, FORMS } from './store.js';

const USER_LINE = " {{user}}'s words, choices and thoughts are theirs to write.";

/** How an instruction is sent. role: 0 system, 1 user, 2 assistant, null keeps the entry's own role. */
export const SENT_AS = {
    system: { label: 'System note', help: 'A note from the system, in square brackets.', role: 0, pre: '[System note: In this reply, ', post: `${USER_LINE}]` },
    ooc: { label: 'Out-of-character note', help: 'An [OOC: ...] note, sent as if you wrote it.', role: 1, pre: '[OOC: In this reply, ', post: `${USER_LINE}]` },
    char: { label: 'Line spoken by the character', help: 'The version text alone, sent as the character.', role: 2, pre: '', post: '' },
    plain: { label: 'Exactly as written', help: 'The version text alone, with nothing added.', role: null, pre: '', post: '' },
};

export const ACTORS = {
    char: { label: 'The character ({{char}})', text: 'the character, {{char}}' },
    other: { label: 'Any named character present, other than you', text: 'a named character who is present in the scene and is neither {{char}} nor {{user}}' },
    new: { label: 'Someone new', text: 'a new person who has not appeared in the story yet' },
    world: { label: 'The surroundings', text: 'the surroundings (weather, a place, an object, an animal, a crowd); no person acts' },
};

export const TARGETS = {
    user: { label: 'You ({{user}})', text: '{{user}}' },
    char: { label: 'The character ({{char}})', text: 'the character, {{char}}' },
    other: { label: 'Any named character present, other than you', text: 'a named character who is present in the scene and is neither {{char}} nor {{user}}' },
    new: { label: 'Someone new', text: 'a new person who has not appeared in the story yet' },
};

export const LIMITS = {
    none: { label: 'No limit', help: 'Every instruction that passes its own chance and timing is sent. Only-one groups still apply.' },
    one: { label: 'One per reply', help: 'At most one new instruction from this set is sent with each reply.' },
    together: { label: 'One Send-together group per reply', help: 'Instructions in the same Send-together group can be sent together. Other groups wait for a later reply.' },
    max: { label: 'At most this many per reply', help: 'No more than the number you set are sent with each reply.' },
};

// ---------- timing: the panel shows replies, World Info counts messages (your message and the reply each count 1) ----------

const whole = v => Math.max(0, Math.floor(Number(v) || 0));
/** "Keep sending for N more replies" as a World Info sticky value, and back. */
export const keepToSticky = n => { n = whole(n); return n > 0 ? 2 * n + 1 : 0; };
export const stickyToKeep = s => Math.max(0, Math.ceil(whole(s) / 2) - 1);
/**
 * "Wait N replies" as a World Info cooldown value, and back. When an entry also keeps sending, World Info starts
 * the wait on the reply where the keeping ends, so that reply already counts as one waited reply.
 */
export const waitToCooldown = (n, keep) => { n = whole(n); return n > 0 ? (whole(keep) > 0 ? 2 * n - 1 : 2 * n + 1) : 0; };
export const cooldownToWait = (c, sticky) => { c = whole(c); return c > 0 ? (whole(sticky) > 0 ? Math.ceil(c / 2) : Math.max(0, Math.ceil(c / 2) - 1)) : 0; };
export const replyNumberToDelay = r => { r = Math.max(0, Math.floor(Number(r) || 0)); return r > 1 ? 2 * r - 1 : 0; };
export const delayToReplyNumber = d => { d = Math.max(0, Math.floor(Number(d) || 0)); return d > 0 ? Math.floor((d + 1) / 2) : 0; };

// ---------- placeholders: {{char.they}} in the panel, {{getvar::ri_char_they}} in the lorebook ----------

const FORM_RE = new RegExp(`^(${FORMS.join('|')})$`, 'i');

export function toStore(text) {
    return String(text ?? '').replace(/\{\{(char|user)\.([A-Za-z]+)\}\}/g, (m, role, form) => FORM_RE.test(form) ? `{{getvar::ri_${role}_${form}}}` : m);
}

export function toEdit(text) {
    return String(text ?? '').replace(/\{\{getvar::ri_(char|user)_([A-Za-z]+)\}\}/g, '{{$1.$2}}');
}

/** Make a version safe to sit inside one {{random::a::b}} list. */
function cleanVersion(text) {
    let out = '';
    let depth = 0;
    const s = String(text ?? '').replace(/\s*\n+\s*/g, ' ').trim();
    for (let i = 0; i < s.length; i++) {
        if (s.startsWith('{{', i)) { depth++; out += '{{'; i++; continue; }
        if (s.startsWith('}}', i)) { depth = Math.max(0, depth - 1); out += '}}'; i++; continue; }
        if (depth === 0 && s.startsWith('::', i)) { out += ':'; i++; continue; }
        out += s[i];
    }
    return out;
}

/** Split "{{random::a::b}}" (with macros inside the items) into its items. Returns null when the text has no such list. */
function splitRandom(s) {
    const start = s.indexOf('{{random::');
    if (start < 0) return null;
    let depth = 0;
    let end = -1;
    for (let j = start; j < s.length; j++) {
        if (s.startsWith('{{', j)) { depth++; j++; }
        else if (s.startsWith('}}', j)) { depth--; j++; if (depth === 0) { end = j + 1; break; } }
    }
    if (end < 0) return null;
    const inner = s.slice(start + 10, end - 2);
    const items = [];
    let cur = '';
    depth = 0;
    for (let j = 0; j < inner.length; j++) {
        if (inner.startsWith('{{', j)) { depth++; cur += '{{'; j++; continue; }
        if (inner.startsWith('}}', j)) { depth--; cur += '}}'; j++; continue; }
        if (depth === 0 && inner.startsWith('::', j)) { items.push(cur); cur = ''; j++; continue; }
        cur += inner[j];
    }
    items.push(cur);
    return { pre: s.slice(0, start), post: s.slice(end), items: items.map(x => x.trim()).filter(Boolean) };
}

const parseCache = new Map();

/** Read an entry's text as { sentAs, versions[] } (versions in panel form). Works for lorebooks this extension did not write. */
export function parseContent(content, role = null) {
    const s = String(content ?? '').trim();
    const cacheKey = `${role}|${s}`;
    if (parseCache.has(cacheKey)) return structuredClone(parseCache.get(cacheKey));
    let result;
    const unwrap = (text) => {
        for (const k of ['system', 'ooc']) {
            const w = SENT_AS[k];
            if (text.startsWith(w.pre) && text.endsWith(w.post)) return { sentAs: k, body: text.slice(w.pre.length, text.length - w.post.length) };
        }
        return { sentAs: Number(role) === 2 ? 'char' : 'plain', body: text };
    };
    const outer = unwrap(s);
    const list = splitRandom(outer.body);
    if (list && !list.pre.trim() && !list.post.trim() && list.items.length) {
        result = { sentAs: outer.sentAs, versions: list.items.map(toEdit) };
    } else {
        result = { sentAs: outer.sentAs, versions: outer.body ? [toEdit(outer.body)] : [] };
    }
    if (parseCache.size > 500) parseCache.clear();
    parseCache.set(cacheKey, result);
    return structuredClone(result);
}

/** The text sent for one picked version. misses: 0 first time, 1 overdue, 2 or more final. */
export function wrapText(sentAs, version, misses = 0) {
    const w = SENT_AS[sentAs] || SENT_AS.plain;
    const body = toStore(version).trim();
    if (!misses) return `${w.pre}${body}${w.post}`;
    const open = sentAs === 'ooc' ? '[OOC: ' : '[System note: ';
    const lead = misses === 1
        ? 'Overdue. This was ordered in the last reply and it did not happen. It must happen in this reply: '
        : 'Final. This must happen early in this reply, before anything else develops: ';
    return `${open}${lead}${body}${USER_LINE}]`;
}

/** The entry text saved in the lorebook, so it also works with the extension turned off. */
export function buildContent(ri) {
    const w = SENT_AS[ri.sentAs] || SENT_AS.plain;
    const list = (ri.versions || []).map(v => cleanVersion(toStore(v.text))).filter(Boolean);
    if (!list.length) return '';
    const body = list.length === 1 ? list[0] : `{{random::${list.join('::')}}}`;
    return `${w.pre}${body}${w.post}`;
}

// ---------- reading and writing entries ----------

/** The extension's view of one World Info entry. */
export function readInstruction(entry) {
    const saved = entry.extensions?.ri;
    let sentAs, versions;
    if (saved && Array.isArray(saved.versions)) {
        sentAs = SENT_AS[saved.sentAs] ? saved.sentAs : 'plain';
        versions = saved.versions.map(v => typeof v === 'string' ? { text: v, keep: false } : { text: String(v.text ?? ''), keep: !!v.keep });
    } else {
        const p = parseContent(entry.content, entry.role);
        sentAs = p.sentAs;
        versions = p.versions.map(text => ({ text, keep: false }));
    }
    const keys = Array.isArray(entry.key) ? entry.key : [];
    const isPattern = keys.length === 1 && /^\/.+\/[a-z]*$/i.test(keys[0]);
    return {
        uid: entry.uid,
        name: String(entry.comment || `Instruction ${entry.uid}`),
        on: !entry.disable,
        when: entry.constant ? 'always' : (isPattern ? 'pattern' : 'words'),
        words: isPattern ? '' : keys.join(', '),
        pattern: isPattern ? keys[0] : '',
        chance: entry.useProbability === false ? 100 : Math.max(0, Math.min(100, Number(entry.probability ?? 100))),
        keep: stickyToKeep(entry.sticky),
        wait: cooldownToWait(entry.cooldown, entry.sticky),
        notBefore: delayToReplyNumber(entry.delay),
        group: String(entry.group || ''),
        weight: Number(entry.groupWeight ?? 100) || 100,
        sendTogether: String(saved?.sendTogether || ''),
        sentAs,
        position: Number(entry.position ?? 0),
        depth: Number(entry.depth ?? 1),
        actor: ACTORS[saved?.actor] ? saved.actor : 'char',
        target: TARGETS[saved?.target] ? saved.target : 'user',
        versions,
        notes: String(saved?.notes || ''),
        order: Number(entry.order ?? 100),
        managed: !!saved,
    };
}

export function blankEntry(uid) {
    return {
        uid, key: [], keysecondary: [], comment: '', content: '',
        constant: true, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
        order: 100, position: 4, disable: false, ignoreBudget: true,
        excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 0,
        probability: 10, useProbability: true, depth: 1, outletName: '',
        group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
        automationId: '', role: 0, sticky: null, cooldown: null, delay: null, triggers: [],
        matchPersonaDescription: false, matchCharacterDescription: false, matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false, matchScenario: false, matchCreatorNotes: false,
        characterFilter: { isExclude: false, names: [], tags: [] },
        displayIndex: uid,
    };
}

/** A new instruction with the defaults from the spec. Not yet written into the lorebook. */
export function newInstruction(data) {
    const uids = Object.values(data.entries || {}).map(e => Number(e.uid)).filter(Number.isFinite);
    const uid = uids.length ? Math.max(...uids) + 1 : 0;
    return {
        uid, name: `Instruction ${uids.length + 1}`, on: true, when: 'always', words: '', pattern: '',
        chance: 10, keep: 0, wait: 5, notBefore: 0, group: '', weight: 100, sendTogether: '',
        sentAs: 'system', position: 4, depth: 1, actor: 'char', target: 'user', versions: [], notes: '',
        order: 100, managed: true, isNew: true,
    };
}

/** Write the panel's view of an instruction back into its World Info entry. */
export function writeInstruction(data, ins) {
    if (!data.entries) data.entries = {};
    let entry = data.entries[ins.uid];
    if (!entry) { entry = blankEntry(ins.uid); data.entries[ins.uid] = entry; }
    const before = readInstruction(entry);
    entry.comment = ins.name.trim() || `Instruction ${ins.uid}`;
    entry.disable = !ins.on;
    entry.constant = ins.when === 'always';
    if (ins.when === 'words') entry.key = ins.words.split(',').map(x => x.trim()).filter(Boolean);
    else if (ins.when === 'pattern') entry.key = ins.pattern.trim() ? [ins.pattern.trim()] : [];
    entry.useProbability = true;
    entry.probability = Math.max(0, Math.min(100, Math.round(Number(ins.chance) || 0)));
    // Timing is only rewritten when it changed, so values set by hand in World Info are kept as they are.
    if (ins.isNew || ins.keep !== before.keep || ins.wait !== before.wait) {
        entry.sticky = keepToSticky(ins.keep) || null;
        entry.cooldown = waitToCooldown(ins.wait, ins.keep) || null;
    }
    if (ins.isNew || ins.notBefore !== before.notBefore) entry.delay = replyNumberToDelay(ins.notBefore) || null;
    entry.group = ins.group.trim();
    entry.groupWeight = Math.max(1, Math.round(Number(ins.weight) || 100));
    entry.position = Number(ins.position);
    entry.depth = Math.max(0, Math.round(Number(ins.depth) || 0));
    const role = SENT_AS[ins.sentAs]?.role;
    if (role !== null && role !== undefined) entry.role = role;
    entry.excludeRecursion = true;
    entry.preventRecursion = true;
    entry.order = Number(ins.order) || 100;
    const ri = {
        v: 1,
        sentAs: ins.sentAs,
        actor: ins.actor,
        target: ins.target,
        sendTogether: ins.sendTogether.trim(),
        notes: ins.notes,
        versions: ins.versions.map(v => ({ text: String(v.text).trim(), keep: !!v.keep })).filter(v => v.text),
    };
    entry.extensions = { ...(entry.extensions || {}), ri };
    entry.content = buildContent(ri);
    return entry;
}

// ---------- instruction sets ----------

/** Lorebooks in the list. kind: 'instructions' (Random Instructions) or 'events' (Random Story Events). */
export function knownSets(kind = 'instructions') {
    const st = settings();
    const exists = new Set(worldNames());
    return Object.keys(st.sets).filter(n => exists.has(n) && (st.sets[n].kind || 'instructions') === kind).sort((a, b) => a.localeCompare(b));
}

export function setOptions(name) {
    const st = settings();
    const o = st.sets[name] || {};
    return { limit: LIMITS[o.limit] ? o.limit : 'none', max: Math.max(1, Math.round(Number(o.max) || 2)), kind: o.kind === 'events' ? 'events' : 'instructions' };
}

export async function loadSet(name) {
    const data = await loadBook(name);
    if (!data || typeof data !== 'object') return null;
    if (!data.entries || typeof data.entries !== 'object') data.entries = {};
    return data;
}

export async function saveSet(name, data) {
    const o = setOptions(name);
    data.extensions = { ...(data.extensions || {}), ri: { v: 1, limit: o.limit, max: o.max, kind: o.kind } };
    await saveBook(name, data);
}

export function cleanSetName(name) {
    return String(name ?? '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function createSet(name, kind = 'instructions', data = { entries: {} }) {
    name = cleanSetName(name);
    if (!name) throw new Error('Type a name first.');
    if (worldNames().includes(name)) throw new Error(`A lorebook named "${name}" already exists. Pick another name.`);
    const st = settings();
    st.sets[name] = { limit: 'none', max: 2, kind };
    saveSettings();
    await saveSet(name, data);
    await refreshWorldList();
    return name;
}

/** Add a lorebook that already exists to the list of instruction sets. Its file is left as it is until you edit it. */
export async function adoptSet(name) {
    const data = await loadSet(name);
    if (!data) throw new Error(`The lorebook "${name}" could not be read.`);
    const st = settings();
    const saved = data.extensions?.ri;
    st.sets[name] = { limit: LIMITS[saved?.limit] ? saved.limit : 'none', max: Math.max(1, Number(saved?.max) || 2), kind: saved?.kind === 'events' ? 'events' : 'instructions' };
    saveSettings();
    return name;
}

export function forgetSet(name) {
    const st = settings();
    delete st.sets[name];
    saveSettings();
}

export function listInstructions(data) {
    return Object.values(data.entries || {})
        .map(readInstruction)
        .sort((a, b) => (a.order - b.order) || (a.uid - b.uid));
}

export function estimateTokens(ins) {
    if (!ins.versions.length) return 0;
    const w = SENT_AS[ins.sentAs] || SENT_AS.plain;
    const avg = ins.versions.reduce((n, v) => n + v.text.length, 0) / ins.versions.length;
    return Math.round((avg + w.pre.length + w.post.length) / 4);
}

/** Share of replies (0 to 100) that get at least one new instruction from this list, before waits and limits. */
export function estimateFrequency(list) {
    let none = 1;
    for (const ins of list) {
        if (!ins.on || !ins.versions.length || ins.when !== 'always') continue;
        none *= 1 - Math.max(0, Math.min(100, ins.chance)) / 100;
    }
    return Math.round((1 - none) * 100);
}

export function frequencyText(list) {
    const pct = estimateFrequency(list);
    if (!pct) return 'No instruction is set to be sent yet.';
    const per10 = Math.max(1, Math.round(pct / 10));
    return `About ${pct}% of replies (${pct >= 95 ? 'nearly every reply' : `${per10} in 10`}) start a new instruction, before waits and limits. Around 35% feels lively; over 55% feels crowded.`;
}

// ---------- dice ----------

/** Whole number from 0 to n - 1 from the system's random source. */
export function rollInt(n) {
    if (n <= 1) return 0;
    try {
        const buf = new Uint32Array(1);
        const limit = Math.floor(0x100000000 / n) * n;
        do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
        return buf[0] % n;
    } catch { return Math.floor(Math.random() * n); }
}

/** Pick up to `count` different items, each with a chance in proportion to its weight. */
export function pickWeighted(items, weightOf, count = 1) {
    const pool = [...items];
    const out = [];
    while (pool.length && out.length < count) {
        const weights = pool.map(x => Math.max(1, Math.round(Number(weightOf(x)) || 1)));
        const total = weights.reduce((a, b) => a + b, 0);
        let r = rollInt(total);
        let i = 0;
        while (r >= weights[i]) { r -= weights[i]; i++; }
        out.push(pool.splice(i, 1)[0]);
    }
    return out;
}
