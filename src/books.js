import { promptText } from './prompts.js';
// Instruction sets. A set is kept in a lorebook of its own, or as a group inside a shared lorebook.
// One instruction is one World Info entry.
import { loadBook, saveBook, refreshWorldList, worldNames } from './st.js';
import { settings, saveSettings, FORMS } from './store.js';

export const USER_LINE = " {{user}}'s words, choices and thoughts are theirs to write.";

/** How an instruction is sent. role: 0 system, 1 user, 2 assistant, null keeps the entry's own role. */
export const SENT_AS = {
    system: { label: 'System note', help: 'A note from the system, in square brackets.', role: 0, pre: '[System note: In this reply, ', post: `${USER_LINE}]` },
    ooc: { label: 'Out-of-character note', help: 'An [OOC: ...] note, sent as if you wrote it.', role: 1, pre: '[OOC: In this reply, ', post: `${USER_LINE}]` },
    char: { label: 'Line spoken by the character', help: 'The version text alone, sent as the character.', role: 2, pre: '', post: '' },
    plain: { label: 'Exactly as written', help: 'The version text alone, with nothing added.', role: null, pre: '', post: '' },
};

const NPC = {
    npcAny: { label: 'Any character other than you, already in the story or new', text: 'any one character other than {{user}}: the roleplay AI chooses either a character who is already in the story (this can be {{char}}) or a new one who arrives. Word the version so that this choice stays open, for example "A character other than {{user}}, one already in the story or a new arrival, must ..."' },
    npcFemale: { label: 'Any female character other than you, already in the story or new', text: 'any one female character other than {{user}}: the roleplay AI chooses either a woman or girl who is already in the story (this can be {{char}} if {{char}} is female) or a new one who arrives. Word the version so that this choice stays open, for example "A female character other than {{user}}, one already in the story or a new arrival, must ...", and use she and her for this character' },
    npcMale: { label: 'Any male character other than you, already in the story or new', text: 'any one male character other than {{user}}: the roleplay AI chooses either a man or boy who is already in the story (this can be {{char}} if {{char}} is male) or a new one who arrives. Word the version so that this choice stays open, for example "A male character other than {{user}}, one already in the story or a new arrival, must ...", and use he and him for this character' },
    other: { label: 'A named character who is present, other than you', text: 'a named character who is present in the scene and is neither {{char}} nor {{user}}' },
    new: { label: 'Someone new', text: 'a new person who has not appeared in the story yet' },
};

export const ACTORS = {
    char: { label: 'The character ({{char}})', text: 'the character, {{char}}' },
    model: { label: 'The model (writing the reply)', text: 'the AI model composing the next reply' },
    unspecified: { label: 'Unspecified', text: 'follow the direction as written. Leave the choice open if it does not name an actor, and only include an actor when the direction calls for one' },
    ...NPC,
    world: { label: 'The surroundings', text: 'the surroundings (weather, a place, an object, an animal, a crowd); no person acts' },
};

export const TARGETS = {
    user: { label: 'You ({{user}})', text: '{{user}}' },
    char: { label: 'The character ({{char}})', text: 'the character, {{char}}' },
    unspecified: { label: 'Unspecified', text: 'follow the direction as written. Only name a target or subject if the direction calls for one' },
    ...NPC,
};

/** Read current pools and legacy single selections. */
export function choicesOf(values, options, fallback) {
    const allowed = Array.isArray(values) ? [...new Set(values.filter(value => typeof value === 'string' && Object.hasOwn(options, value)))]
        : typeof values === 'string' && Object.hasOwn(options, values) ? [values] : [];
    return allowed.length ? allowed : [fallback];
}

export function instructionActors(instruction) {
    const [legacy] = choicesOf(instruction.actor, ACTORS, 'char');
    const pool = choicesOf(instruction.actors, ACTORS, legacy);
    return pool.includes('model') ? ['model'] : pool;
}

export function instructionTargets(instruction) {
    const [legacy] = choicesOf(instruction.target, TARGETS, 'user');
    return choicesOf(instruction.targets, TARGETS, legacy);
}

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
    if (!misses) {
        if (sentAs === 'system' || sentAs === 'ooc') return `${sentAs === 'ooc' ? '[OOC: ' : '[System note: '}${promptText('instructionOrder', { instruction: body })}${USER_LINE}]`;
        return `${w.pre}${body}${w.post}`;
    }
    const open = sentAs === 'ooc' ? '[OOC: ' : '[System note: ';
    return `${open}${promptText(misses === 1 ? 'overdueOrder' : 'finalOrder', { instruction: body })}${USER_LINE}]`;
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
    const actors = instructionActors(saved || {});
    const targets = instructionTargets(saved || {});
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
        once: !!saved?.once,
        sentAs,
        position: Number(entry.position ?? 0),
        depth: Number(entry.depth ?? 1),
        actor: actors[0], target: targets[0], actors, targets,
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
export function newInstruction(data, id = '') {
    const uid = freeUid(data);
    const count = id ? entriesOf(data, id).length : Object.keys(data.entries || {}).length;
    return {
        uid, name: `Instruction ${count + 1}`, on: true, when: 'always', words: '', pattern: '',
        chance: 10, keep: 0, wait: 5, notBefore: 0, group: '', weight: 100, sendTogether: '', once: false,
        sentAs: 'system', position: 4, depth: 1, actor: 'char', target: 'user', versions: [], notes: '',
        order: 100, managed: true, isNew: true,
    };
}

/** Write the panel's view of an instruction back into its World Info entry. */
export function writeInstruction(data, ins, id = '') {
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
    const actors = instructionActors(ins);
    const targets = instructionTargets(ins);
    const ri = {
        v: 1,
        sentAs: ins.sentAs,
        actor: actors[0], target: targets[0], actors, targets,
        sendTogether: ins.sendTogether.trim(),
        once: !!ins.once,
        notes: ins.notes,
        versions: ins.versions.map(v => ({ text: String(v.text).trim(), keep: !!v.keep })).filter(v => v.text),
    };
    keepTags(ri, entry.extensions?.ri, id);
    entry.extensions = { ...(entry.extensions || {}), ri };
    entry.content = buildContent(ri);
    return entry;
}

// ---------- instruction sets ----------
//
// A set has an id. A set in a lorebook of its own has that lorebook's name as its id. A set inside a shared
// lorebook has the id "Lorebook › Set name", and its entries carry the set name in extensions.ri.set.
// A shared lorebook can also hold entries that belong to no set. Those are left to World Info as they are.

export const KINDS = ['instructions', 'events', 'style', 'world'];
const SEP = ' › ';
export const sharedId = (book, group) => `${book}${SEP}${group}`;

/** Where a set is kept and how it is limited. */
export function setInfo(id) {
    const o = settings().sets[id] || {};
    const shared = !!(o.book && o.group);
    return {
        id, shared, book: shared ? String(o.book) : String(id), group: shared ? String(o.group) : '', name: shared ? String(o.group) : String(id),
        limit: LIMITS[o.limit] ? o.limit : 'none', max: Math.max(1, Math.round(Number(o.max) || 2)), kind: KINDS.includes(o.kind) ? o.kind : 'instructions',
        was: Array.isArray(o.was) ? o.was : [],
    };
}

export const setName = id => setInfo(id).name;

/** Sets in the list. kind: 'instructions' (Random Instructions), 'events' (Random Story Events) or 'style'. */
export function knownSets(kind = 'instructions') {
    const st = settings();
    const exists = new Set(worldNames());
    return Object.keys(st.sets).map(setInfo).filter(i => exists.has(i.book) && i.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(i => i.id);
}

export function setOptions(id) {
    const i = setInfo(id);
    return { limit: i.limit, max: i.max, kind: i.kind };
}

/** Change a set's options and keep where it lives. */
export function patchSet(id, patch) {
    const st = settings();
    st.sets[id] = { ...(st.sets[id] || {}), ...patch };
    saveSettings();
}

/** Shared lorebooks in use, by name. */
export function sharedBooks() {
    const st = settings();
    const exists = new Set(worldNames());
    return [...new Set(Object.values(st.sets).filter(o => o.book && o.group).map(o => String(o.book)))].filter(n => exists.has(n)).sort((a, b) => a.localeCompare(b));
}

/** The set an entry belongs to, or '' when it is in no set in the list. The entry carries its lorebook in "world". */
export function setOfEntry(e) {
    const sets = settings().sets;
    const g = e?.extensions?.ri?.set;
    if (g) { const id = sharedId(e.world, g); if (sets[id]?.book === e.world) return id; }
    return sets[e?.world] && !sets[e.world].book ? e.world : '';
}

/** A set's current id, for an id it had before it was moved. */
export function canonSet(id) {
    const sets = settings().sets;
    if (sets[id]) return id;
    return Object.keys(sets).find(k => Array.isArray(sets[k].was) && sets[k].was.includes(id)) || id;
}

/** The entries of one set inside its lorebook's data. */
export function entriesOf(data, id) {
    const info = setInfo(id);
    const all = Object.values(data?.entries || {});
    return info.shared ? all.filter(e => e?.extensions?.ri?.set === info.group) : all;
}

export function freeUid(data) {
    const uids = Object.values(data?.entries || {}).map(e => Number(e.uid)).filter(Number.isFinite);
    return uids.length ? Math.max(...uids) + 1 : 0;
}

/** Carry an entry's set name and former keys over to its rewritten extension data. */
export function keepTags(ri, old, id = '') {
    if (Array.isArray(old?.was) && old.was.length) ri.was = [...old.was];
    const info = id ? setInfo(id) : null;
    if (info?.shared) ri.set = info.group;
    else if (!info && old?.set) ri.set = old.set;
    return ri;
}

export async function loadSet(id) {
    const data = await loadBook(setInfo(id).book);
    if (!data || typeof data !== 'object') return null;
    if (!data.entries || typeof data.entries !== 'object') data.entries = {};
    return data;
}

export async function saveSet(id, data) {
    const i = setInfo(id);
    const was = i.was.length ? { was: [...i.was] } : {};
    if (i.shared) {
        const old = data.extensions?.ri?.shared ? data.extensions.ri : {};
        data.extensions = { ...(data.extensions || {}), ri: { v: 2, shared: true, groups: { ...(old.groups || {}), [i.group]: { kind: i.kind, limit: i.limit, max: i.max, ...was } } } };
    } else {
        data.extensions = { ...(data.extensions || {}), ri: { v: 1, limit: i.limit, max: i.max, kind: i.kind, ...was } };
    }
    await saveBook(i.book, data);
}

export function cleanSetName(name) {
    return String(name ?? '').replace(/[\\/:*?"<>|›]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Read a lorebook that is to hold sets as groups. Returns fresh data when the lorebook does not exist yet. */
async function openShared(book) {
    const st = settings();
    if (st.sets[book] && !st.sets[book].book) throw new Error(`"${book}" is the lorebook of a set that is kept on its own. Pick another lorebook to share.`);
    if (!worldNames().includes(book)) return { entries: {} };
    const data = await loadBook(book);
    if (!data || typeof data !== 'object') throw new Error(`The lorebook "${book}" could not be read.`);
    if (!data.entries || typeof data.entries !== 'object') data.entries = {};
    return data;
}

/** A name for a new group that no other group in that lorebook has. */
function freeGroup(book, data, name) {
    const st = settings();
    const taken = n => !!st.sets[sharedId(book, n)] || !!data.extensions?.ri?.groups?.[n];
    if (!taken(name)) return name;
    for (let i = 2; i < 500; i++) if (!taken(`${name} ${i}`)) return `${name} ${i}`;
    throw new Error(`A set named "${name}" is already in the shared lorebook "${book}". Pick another name.`);
}

/**
 * Make a set. home: '' keeps it in a lorebook of its own with the set's name; a lorebook name keeps it as a group
 * inside that shared lorebook. Left out, the place chosen in Settings is used.
 */
export async function createSet(name, kind = 'instructions', data = { entries: {} }, home = undefined) {
    name = cleanSetName(name);
    if (!name) throw new Error('Type a name first.');
    const st = settings();
    home = cleanSetName(home === undefined ? st.home : home);
    if (!home) {
        if (worldNames().includes(name) || st.sets[name]) throw new Error(`A lorebook named "${name}" already exists. Pick another name.`);
        st.sets[name] = { limit: 'none', max: 2, kind };
        saveSettings();
        await saveSet(name, data);
        await refreshWorldList();
        return name;
    }
    const book = await openShared(home);
    const id = sharedId(home, name);
    if (st.sets[id] || book.extensions?.ri?.groups?.[name]) throw new Error(`A set named "${name}" is already in the shared lorebook "${home}". Pick another name.`);
    for (const e of Object.values(data.entries || {})) {
        const uid = freeUid(book);
        book.entries[uid] = { ...e, uid, displayIndex: uid, extensions: { ...(e.extensions || {}), ri: { ...(e.extensions?.ri || {}), set: name } } };
    }
    st.sets[id] = { limit: 'none', max: 2, kind, book: home, group: name };
    saveSettings();
    await saveSet(id, book);
    await refreshWorldList();
    return id;
}

/**
 * Add a lorebook that already exists to the list. A lorebook of its own becomes one set and its file is left as it
 * is until you edit it. A shared lorebook adds every set kept inside it. Returns the ids that were added.
 */
export async function adoptSet(name) {
    const data = await loadBook(name);
    if (!data || typeof data !== 'object') throw new Error(`The lorebook "${name}" could not be read.`);
    const st = settings();
    const saved = data.extensions?.ri;
    const opts = o => ({ limit: LIMITS[o?.limit] ? o.limit : 'none', max: Math.max(1, Number(o?.max) || 2), kind: KINDS.includes(o?.kind) ? o.kind : 'instructions', ...(Array.isArray(o?.was) && o.was.length ? { was: [...o.was] } : {}) });
    if (saved?.shared && saved.groups && typeof saved.groups === 'object') {
        const added = [];
        for (const [group, o] of Object.entries(saved.groups)) {
            const id = sharedId(name, group);
            if (st.sets[id]) continue;
            st.sets[id] = { ...opts(o), book: name, group };
            added.push(id);
        }
        saveSettings();
        return added;
    }
    st.sets[name] = opts(saved);
    saveSettings();
    return [name];
}

export function forgetSet(id) {
    const st = settings();
    delete st.sets[id];
    saveSettings();
}

/**
 * Move a set. home: '' gives it a lorebook of its own; a lorebook name puts it into that shared lorebook.
 * Every entry is copied whole (versions, timing, notes). Each copy remembers the key it had before, so what the
 * chats recorded about it still counts. The lorebook it came from is left in place when it was the set's own.
 * Returns { id, from, keys: [[old key, new key]] }.
 */
export async function moveSet(id, home) {
    const st = settings();
    const from = setInfo(id);
    if (!st.sets[id]) throw new Error('That set is no longer in the list.');
    home = cleanSetName(home);
    if (from.shared ? home === from.book : !home) return { id, from: id, keys: [] };
    const source = await loadSet(id);
    if (!source) throw new Error(`The lorebook "${from.book}" could not be read.`);
    const moving = entriesOf(source, id).sort((a, b) => (Number(a.displayIndex ?? a.uid) - Number(b.displayIndex ?? b.uid)) || (a.uid - b.uid));
    const opts = { limit: from.limit, max: from.max, kind: from.kind, was: [...new Set([...from.was, id])] };
    const keys = [];
    let target, newId, group = '';
    if (home) {
        target = await openShared(home);
        group = freeGroup(home, target, from.name);
        newId = sharedId(home, group);
    } else {
        let name = cleanSetName(from.name);
        if (worldNames().includes(name) || st.sets[name]) { let i = 2; while (worldNames().includes(`${name} ${i}`) || st.sets[`${name} ${i}`]) i++; name = `${name} ${i}`; }
        target = { entries: {} };
        newId = name;
    }
    const targetBook = home || newId;
    for (const e of moving) {
        const uid = freeUid(target);
        const copy = structuredClone(e);
        const ri = { ...(copy.extensions?.ri || {}) };
        ri.was = [...new Set([...(Array.isArray(ri.was) ? ri.was : []), `${from.book}.${e.uid}`])];
        if (group) ri.set = group; else delete ri.set;
        copy.uid = uid; copy.displayIndex = uid;
        copy.extensions = { ...(copy.extensions || {}), ri };
        target.entries[uid] = copy;
        keys.push([`${from.book}.${e.uid}`, `${targetBook}.${uid}`]);
    }
    st.sets[newId] = group ? { ...opts, book: home, group } : opts;
    delete st.sets[id];
    saveSettings();
    await saveSet(newId, target);
    if (from.shared) {
        // Take the set out of the shared lorebook it came from.
        for (const e of moving) delete source.entries[e.uid];
        const ri = source.extensions?.ri;
        if (ri?.groups) { const groups = { ...ri.groups }; delete groups[from.group]; source.extensions = { ...source.extensions, ri: { ...ri, groups } }; }
        await saveBook(from.book, source);
    }
    await refreshWorldList();
    return { id: newId, from: id, keys };
}

/** Delete a set that is kept inside a shared lorebook: its entries and its name are taken out of that lorebook. */
export async function deleteSharedSet(id) {
    const i = setInfo(id);
    if (!i.shared) throw new Error('This set has a lorebook of its own. Delete that lorebook in World Info.');
    const data = await loadSet(id);
    if (!data) throw new Error(`The lorebook "${i.book}" could not be read.`);
    for (const e of entriesOf(data, id)) delete data.entries[e.uid];
    const ri = data.extensions?.ri;
    if (ri?.groups) { const groups = { ...ri.groups }; delete groups[i.group]; data.extensions = { ...data.extensions, ri: { ...ri, groups } }; }
    forgetSet(id);
    await saveBook(i.book, data);
}

/** One set as a lorebook file of its own, for export. */
export async function exportSet(id) {
    const data = await loadSet(id);
    if (!data) return null;
    const i = setInfo(id);
    if (!i.shared) return data;
    const out = { entries: {}, extensions: { ri: { v: 1, limit: i.limit, max: i.max, kind: i.kind } } };
    entriesOf(data, id).forEach((e, n) => {
        const copy = structuredClone(e);
        const ri = { ...(copy.extensions?.ri || {}) };
        delete ri.set; delete ri.was;
        copy.uid = n; copy.displayIndex = n;
        copy.extensions = { ...(copy.extensions || {}), ri };
        out.entries[n] = copy;
    });
    return out;
}

export function listInstructions(data, id = '') {
    return (id ? entriesOf(data, id) : Object.values(data.entries || {}))
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
