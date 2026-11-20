import { memoryComponents, memoryOnly } from './components.js';
import { promptText } from './prompts.js';
import { sceneAt, sceneProtected } from './state.js';
// The story world: characters, places, factions, secrets, threads, planted details and things going on elsewhere.
// A world is a set of kind 'world', kept like any other set (a lorebook of its own, or a group in a shared one).
// A chat uses one world. Before each reply the extension reads who is present, picks the entries that matter
// within a budget, and sends them as one block of story notes. No AI request is made for any of this.
import { ctx, KEY, names, parseJson, isReply } from './st.js';
import { request } from './ai.js';
import { settings, chatState, saveChatState } from './store.js';
import { blankEntry, entriesOf, freeUid, keepTags, loadSet, saveSet, canonSet, setInfo, knownSets } from './books.js';
import { contextText, STORY_LEAD } from './writer.js';
import { wordFlag, writerRules, rememberStory } from './pacing.js';

export const NOTES_WORLD = 'Roleplay Instructions story notes';
export const isNotes = e => e?.world === NOTES_WORLD;
export const isWorldEntry = e => e?.extensions?.ri?.type === 'world';

const F = (key, label, help = '', long = false) => ({ key, label, help, long });

/** The kinds of entry, the lines each one has, and its steps of status (first step is the starting one). */
export const WORLD_KINDS = {
    character: {
        label: 'Character', plural: 'Characters', add: 'Add a character', nameLabel: 'Name', nameHelp: 'The name the story uses for this person.',
        fields: [
            F('role', 'Role in the story', 'Who this person is to the story, in a few words. Example: captain of the Gull.'),
            F('who', 'Who they are', 'Personality and background, in two or three plain facts.', true),
            F('strength', 'Main strength'), F('flaw', 'Main flaw'),
            F('voice', 'How they talk', 'Rhythm, word choice, habits of speech.'),
            F('orientation', 'Orientation', 'As their card or the story states it.'),
            F('boundary', 'Enduring boundaries', 'Established limits that should guide future behavior.', true),
            F('wants', 'What they want', 'Right now, and in the long run.', true),
            F('plans', 'What they plan to do next'),
            F('knows', 'What they know', 'Things this person saw, heard or was told.', true),
            F('believes', 'What they believe'), F('suspects', 'What they suspect'), F('wrong', 'What they are wrong about'),
        ],
        short: ['role', 'boundary', 'wants'],
    },
    place: {
        label: 'Place', plural: 'Places', add: 'Add a place', nameLabel: 'Name', nameHelp: 'The name the story uses for this place.',
        fields: [F('what', 'What it is'), F('layout', 'How it is laid out'), F('people', 'Who is usually there'), F('goes', 'What goes on there')],
        short: ['what'],
    },
    faction: {
        label: 'Group', plural: 'Groups', add: 'Add a group', nameLabel: 'Name', nameHelp: 'A family, crew, guild, court, gang, team or any other group.',
        fields: [F('what', 'What it is'), F('wants', 'What it wants'), F('leader', 'Who leads it'), F('members', 'Who belongs to it')],
        short: ['what', 'wants'],
    },
    secret: {
        label: 'Secret', plural: 'Secrets', add: 'Add a secret', nameLabel: 'Short title', nameHelp: 'For your own list. Example: Tom and the fire.',
        fields: [
            F('secret', 'The secret, in full', 'Plain statement of fact. Example: Tom started the fire.', true),
            F('holder', 'Whose secret it is', 'The name of the person who keeps it.'),
            F('known', 'Who else knows it'),
            F('shadow', 'The one line the AI is shown while it is kept', 'Example: Tom has a secret about the fire. Left empty, the AI is told only that this person has a secret.'),
        ],
        steps: [['kept', 'Kept'], ['out', 'Out in the open']],
        short: ['shadow'],
    },
    thread: {
        label: 'Open thread', plural: 'Open threads', add: 'Add an open thread', nameLabel: 'Short title', nameHelp: 'Example: The invitation to the ball.',
        fields: [
            F('open', 'What is open', 'The question or matter that is not settled yet.', true),
            F('people', 'Who is involved'),
            F('sets_off', 'What would bring it to a head'),
            F('ignored', 'What happens if it is left alone'),
            F('latest', 'What happened last'),
        ],
        steps: [['quiet', 'Quiet'], ['stirring', 'Stirring'], ['building', 'Building'], ['ready', 'About to come to a head'], ['happening', 'Happening now'], ['done', 'Finished']],
        short: ['open', 'latest'],
    },
    seed: {
        label: 'Planted detail', plural: 'Planted details', add: 'Add a planted detail', nameLabel: 'Short title', nameHelp: 'Example: The locked drawer.',
        fields: [F('detail', 'The detail, as it appeared in the story', '', true), F('payoff', 'What it could lead to')],
        steps: [['planted', 'Planted'], ['noticed', 'Noticed'], ['paid', 'Paid off']],
        short: ['detail'],
    },
    activity: {
        label: 'Going on elsewhere', plural: 'Going on elsewhere', add: 'Add something going on elsewhere', nameLabel: 'Short title', nameHelp: 'Example: Mira looks for the letter.',
        fields: [F('who', 'Who is doing it'), F('what', 'What they are doing', '', true), F('ties', 'How it ties to the story'), F('step', 'Where it stands now')],
        steps: [['going', 'Going on'], ['done', 'Finished']],
        short: ['who', 'what', 'step'],
    },
    chapter: {
        label: 'Chapter', plural: 'The story so far', add: 'Add a chapter by hand', nameLabel: 'Title', nameHelp: 'A short title for this part of the story.',
        fields: [
            F('summary', 'What happened', 'A plain account of this part of the story, in the past tense.', true),
            F('when', 'When it took place'), F('people', 'Who was in it'), F('places', 'Where it took place'),
            F('settled', 'What was settled or came out'),
            F('closed', 'What was finished in it', 'Threads that were settled, secrets that came out, planted details that paid off and things elsewhere that finished. Filled in when the chapter is written.'),
        ],
        short: ['summary'],
    },
};
const recordLabels = { fact:'Story fact', profile:'Character portrayal', knowledge:'Character knowledge',
    emotion:'NPC emotion', relationship:'Relationship', arc:'Arc milestone', agenda:'Off-screen agenda', event:'Story event', payoff:'Scheduled seed' };
for (const [kind,label] of Object.entries(recordLabels)) WORLD_KINDS[kind] = {
    label, plural: label, add: `Add ${label.toLowerCase()}`, nameLabel:'Record title',
    fields:[F('data','Structured record','Edit this record on its dedicated Chat Facts, Plot Records, or Characters page.',true)], short:[],
};
export const isStructuredWorldKind = kind => Object.hasOwn(recordLabels,kind);
export const KIND_ORDER = ['chapter', 'character', 'place', 'faction', 'thread', 'secret', 'seed', 'activity', ...Object.keys(recordLabels)];
export const DONE = { thread: 'done', seed: 'paid', activity: 'done' };
export const MAX_ACTIVITIES = 3;
/** The record times of the replies now in the open chat. A branch shares these with the chat it came from, up to where it branched. */
export function chatTimes() {
    const out = new Set();
    for (const m of ctx().chat || []) { const t = m?.extra?.[KEY]?.time; if (t) out.add(String(t)); }
    return out;
}

/**
 * Does this chapter belong to the open chat? A chapter is tied to the last reply it covers, so it belongs to every
 * chat that has that reply: the chat it was written in, and any branch made after it. Older chapters with no reply
 * time belong to the chat they were written in.
 */
export function chapterIsMine(w, chatId, times = chatTimes()) {
    if (w?.span?.time) return times.has(String(w.span.time));
    return w?.span?.chat === chatId;
}

/** The two titles a combined account of earlier chapters is given by the extension. */
export const ROLL_NAMES = ['Before the latest chapters', 'The story before this chat'];

const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- which world this chat uses ----------

/** The id of this chat's world, or '' when it has none. Follows a world that was moved. */
export function chatWorld() {
    const cs = chatState();
    if (!cs?.world) return '';
    const id = canonSet(cs.world);
    if (id !== cs.world) { cs.world = id; saveChatState(); }
    return settings().sets[id] && setInfo(id).kind === 'world' ? id : '';
}

export function setChatWorld(id) {
    // The chat that picks a world is the owner of it, so it is not copied later as if this were a branch.
    try { const c = ctx(); const cs0 = chatState(); if (cs0) cs0.worldOwner = String(c.chatMetadata?.integrity || c.getCurrentChatId?.() || ''); } catch { /* only a mark */ }
    const cs = chatState();
    if (!cs) return;
    cs.world = id || '';
    delete cs.branchPendingWorld;
    saveChatState();
}

export const knownWorlds = () => knownSets('world');

// ---------- reading and writing entries ----------

/** The panel's view of one world entry. */
export function readWorldEntry(entry) {
    const ri = entry.extensions?.ri || {};
    const kind = WORLD_KINDS[ri.kind] ? ri.kind : 'character';
    const def = WORLD_KINDS[kind];
    const fields = {};
    for (const f of def.fields) fields[f.key] = String(ri.fields?.[f.key] ?? '');
    return {
        uid: entry.uid, kind, name: String(entry.comment || ''), on: !entry.disable,
        aliases: (Array.isArray(ri.aliases) ? ri.aliases : []).map(clean).filter(Boolean),
        fields,
        status: def.steps ? (def.steps.some(s => s[0] === ri.status) ? ri.status : def.steps[0][0]) : '',
        show: ri.show === 'full' ? 'full' : 'shadow',
        auto: !!ri.auto,          // added by the extension from a reply, and not yet saved by hand
        locked: !!ri.locked,      // "keep this entry as I wrote it": automatic updates leave it alone
        at: ri.at && typeof ri.at === 'object' ? { chat: String(ri.at.chat || ''), n: Number(ri.at.n) || 0 } : null,   // the chat and reply where it was made or last moved
        span: ri.span && typeof ri.span === 'object' ? { chat: String(ri.span.chat || ''), from: Number(ri.span.from) || 0, to: Number(ri.span.to) || 0, ...(ri.span.time ? { time: String(ri.span.time) } : {}) } : null,   // a chapter: the replies it covers
        rollup: !!ri.rollup,      // a chapter that holds everything before the newer chapters
    };
}

export function newWorldEntry(data, kind) {
    const def = WORLD_KINDS[kind] || WORLD_KINDS.character;
    return { uid: freeUid(data), kind, name: '', on: true, aliases: [], fields: Object.fromEntries(def.fields.map(f => [f.key, ''])), status: def.steps ? def.steps[0][0] : '', show: 'shadow', auto: false, locked: false, at: null, span: null, rollup: false, isNew: true };
}

const label = (kind, key) => WORLD_KINDS[kind].fields.find(f => f.key === key)?.label || key;
const stepLabel = (kind, status) => WORLD_KINDS[kind].steps?.find(s => s[0] === status)?.[1] || '';

/** One entry as plain text. full: every line that has text. Otherwise only the kind's short lines. */
export function renderEntry(w, { full = true } = {}) {
    const def = WORLD_KINDS[w.kind];
    const name = clean(w.name) || def.label;
    const val = k => clean(w.fields[k]);
    const sentence = t => (/[.!?]$/.test(t) ? t : `${t}.`);
    if (w.kind === 'secret') {
        const holder = val('holder');
        if (w.status === 'out') return `${name}: ${sentence(val('secret'))}${val('known') ? ` Known to: ${val('known')}.` : ''} This is out in the open.`;
        if (w.show === 'full') return `${name}: ${sentence(val('secret'))}${holder ? ` It is ${holder}'s secret.` : ''}${val('known') ? ` Known to: ${val('known')}.` : ''} It is still kept: it stays unsaid and unseen in the story until an order says it comes out.`;
        return val('shadow') || (holder ? `${holder} has a secret.` : `${name}: there is a secret here.`);
    }
    if (w.kind === 'chapter') {
        const all = `${name}${val('when') ? ` (${val('when')})` : ''}: ${sentence(val('summary'))}${val('settled') ? ` Settled: ${sentence(val('settled'))}` : ''}${val('closed') ? ` Finished in it: ${sentence(val('closed'))}` : ''}`;
        if (full) return all;
        const brief = val('summary');
        return `${name}${val('when') ? ` (${val('when')})` : ''}: ${brief.length > 240 ? `${brief.slice(0, 240).replace(/\s+\S*$/, '')}...` : sentence(brief)}`;
    }
    const keys = full ? def.fields.map(f => f.key) : def.short;
    // "Hale (captain of the Gull)": the first line of a person, place or group goes in brackets after the name.
    const leadKey = { character: 'role', place: 'what', faction: 'what' }[w.kind];
    const lead = leadKey && keys.includes(leadKey) && val(leadKey) ? ` (${val(leadKey).replace(/[.]+$/, '')})` : '';
    if (Object.hasOwn(recordLabels,w.kind)) return name;
    const parts = keys.filter(k => k !== leadKey && val(k)).map(k => `${label(w.kind, k)}: ${val(k).replace(/[.]+$/, '')}`);
    const status = def.steps && w.status ? ` [${stepLabel(w.kind, w.status).toLowerCase()}]` : '';
    return `${name}${lead}${status}${parts.length ? `. ${parts.join('. ')}.` : '.'}`;
}

/** Write the panel's view of a world entry into its lorebook entry. id: the world (a set id). */
export function writeWorldEntry(data, w, id) {
    if (!data.entries) data.entries = {};
    let entry = data.entries[w.uid];
    if (!entry) { entry = blankEntry(w.uid); data.entries[w.uid] = entry; }
    const def = WORLD_KINDS[w.kind];
    entry.comment = clean(w.name) || def.label;
    entry.disable = !w.on;
    // With the extension off this is an ordinary lorebook entry: it is sent when its name appears in the chat.
    entry.constant = false;
    entry.key = Object.hasOwn(recordLabels,w.kind) ? [] : [...new Set([clean(w.name), ...w.aliases.map(clean)].filter(Boolean))];
    entry.useProbability = false; entry.probability = 100;
    entry.sticky = null; entry.cooldown = null; entry.delay = null;
    entry.position = 4; entry.depth = 4; entry.role = 0;   // in the chat, a few messages up: works with every preset
    entry.excludeRecursion = true; entry.preventRecursion = true;
    const ri = {
        v: 1, type: 'world', kind: w.kind,
        aliases: w.aliases.map(clean).filter(Boolean),
        fields: Object.fromEntries(def.fields.map(f => [f.key, String(w.fields[f.key] ?? '').trim()])),
    };
    if (def.steps) ri.status = w.status || def.steps[0][0];
    if (w.kind === 'secret') ri.show = w.show === 'full' ? 'full' : 'shadow';
    if (w.auto) ri.auto = true;
    if (w.locked) ri.locked = true;
    if (w.at) ri.at = { chat: w.at.chat, n: w.at.n };
    if (w.span) ri.span = { chat: w.span.chat, from: w.span.from, to: w.span.to, ...(w.span.time ? { time: String(w.span.time) } : {}) };
    if (w.rollup) ri.rollup = true;
    keepTags(ri, entry.extensions?.ri, id);
    entry.extensions = { ...(entry.extensions || {}), ri };
    entry.content = `[${def.label}] ${renderEntry({ ...w, show: w.kind === 'secret' ? w.show : 'shadow' })}`;
    return entry;
}

/** Every entry of a world, as the panel sees them. */
export function listWorld(data, id) {
    return entriesOf(data, id).filter(isWorldEntry).map(readWorldEntry)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
}

/** Things to look at before saving. blocks stop the save; the rest are only shown. */
export function entryFlags(w, others = []) {
    const blocks = [], checks = [], warns = [];
    const def = WORLD_KINDS[w.kind];
    if (!clean(w.name)) blocks.push(`Give this ${def.label.toLowerCase()} a name.`);
    const mine = new Set([clean(w.name), ...w.aliases.map(clean)].filter(Boolean).map(x => x.toLowerCase()));
    const twin = others.find(o => o.uid !== w.uid && o.kind === w.kind && [o.name, ...o.aliases].some(n => mine.has(clean(n).toLowerCase())));
    if (twin) checks.push(`"${twin.name}" in this world has the same name or another name in common. If they are the same, keep one entry.`);
    if (!def.fields.some(f => clean(w.fields[f.key]))) warns.push('Every line is empty, so nothing would be sent for this entry.');
    const size = Math.round(renderEntry(w).length / 4);
    if (size > 220 && w.kind !== 'chapter') warns.push(`This entry is about ${size} tokens. Long entries use up the room for story notes quickly.`);
    if (w.kind === 'secret' && clean(w.fields.secret) && !clean(w.fields.holder)) warns.push('Say whose secret it is, so it can be sent when that person is in the scene.');
    if (w.kind !== 'chapter') { const hit = wordFlag(def.fields.map(f => w.fields[f.key]).join(' \n ')); if (hit) warns.push(hit); }
    return { blocks, checks, warns };
}

// ---------- who is present ----------

export const HUD_BLOCKS = /<(sola_hud|scene_cast|profile|heart|roast|story_notes|sent_instructions)\b[\s\S]*?<\/\1>/gi;

/**
 * What the newest reply says about the scene. type: the kind of generation under way, so a reply that is being
 * replaced is left out. Returns { present: text, location: text, how } where how says where it was read from.
 */
export function readScene(type = 'normal') {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    let reply = '';
    let own = null;
    for (let i = end - 1; i >= 0; i--) { const m = chat[i]; if (m && !m.is_user && !m.is_system && m.mes) { reply = String(m.mes); own = m.extra?.[KEY]?.stateStale ? null : m.extra?.[KEY]?.scene || null; break; } }
    const out = { present: '', location: '', how: '' };
    // The reply's own scene lines come first: the extension asked for them, so they are there under any preset.
    const corrected = sceneAt(type === 'swipe' ? end : Infinity, { overrides: true });
    if (corrected?.present || sceneProtected('present')) return { present: corrected.present, location: corrected.where || '', how: 'the scene state' };
    if (own?.present) return { present: own.present, location: own.where || '', how: 'the scene lines of the newest reply' };
    if (!reply) return out;
    const parts = [];
    const attr = (name) => { const m = reply.match(new RegExp(`<[a-z_]+\\b[^>]*\\b${name}\\s*=\\s*"([^"]*)"`, 'i')); return m ? m[1] : ''; };
    const header = attr('present');
    if (header) { parts.push(header); out.how = 'the scene header'; }
    out.location = attr('location');
    const cast = reply.match(/<scene_cast\b[^>]*>([\s\S]*?)<\/scene_cast>/i);
    const lines = (cast ? cast[1] : reply).split('\n');
    const line = (re) => { const l = lines.find(x => re.test(x)); return l ? l.replace(re, '').trim() : ''; };
    if (cast) {
        const who = [line(/^\s*Active Speakers?[^:]*:/i), line(/^\s*Ambient NPCs?[^:]*:/i)].filter(Boolean);
        if (who.length) { parts.push(...who); out.how = out.how ? `${out.how} and the HUD` : 'the HUD'; }
        if (!out.location) out.location = line(/^\s*Location[^:]*:/i);
    }
    const cards = [...reply.matchAll(/<(?:profile|heart)\b[^>]*\b(?:name|char)\s*=\s*"([^"]+)"/gi)].map(m => m[1]);
    if (cards.length) { parts.push(...cards); if (!out.how) out.how = 'the HUD'; }
    if (!parts.length) {
        const plain = line(/^\s*(?:\*\*)?(?:Present|Characters present|In the scene|Who is here)(?:\*\*)?\s*:/i);
        if (plain) { parts.push(plain); out.how = 'a "Present" line in the reply'; }
        if (!out.location) out.location = line(/^\s*(?:\*\*)?(?:Location|Place|Where)(?:\*\*)?\s*:/i);
    }
    out.present = parts.join(', ');
    return out;
}

/** The last few messages as one text, with HUD blocks taken out. */
function recentText(type, lookback) {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    const out = [];
    for (let i = end - 1; i >= 0 && out.length < lookback; i--) { const m = chat[i]; if (m && !m.is_system && m.mes) out.push(String(m.mes).replace(HUD_BLOCKS, ' ')); }
    return out.join('\n');
}

/** Does this text name this entry? Whole words, any letter case. */
export function namedIn(text, w) {
    let score = 0;
    const hit = (n) => n.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    if (hit(clean(w.name))) score += 10;
    for (const a of w.aliases) if (hit(clean(a))) score += 3;
    return score;
}

/** Story notes sent with each of the last few replies, read from the records, so entries can take turns. */
function sentLately(type, turns = 3) {
    const chat = ctx().chat || [];
    let end = chat.length;
    if (type === 'swipe' || type === 'continue') end -= 1;
    const counts = new Map();
    let seen = 0;
    for (let i = end - 1; i >= 0 && seen < turns; i--) {
        const m = chat[i];
        if (!isReply(m)) continue;
        seen++;
        for (const it of m.extra?.[KEY]?.items || []) for (const uid of it.notes?.extra || []) counts.set(uid, (counts.get(uid) || 0) + 1);
    }
    return counts;
}

/**
 * Choose what to send and write the block. list: the world's entries as readWorldEntry gives them.
 * Returns null when there is nothing to send, else { text, tokens, ids, extra, present, missing, place, how }.
 */
export function buildNotes(list, type = 'normal', opts = settings().world,
    { chapters = memoryComponents().chapters, memory = false } = {}) {
    const on = list.filter(w => w.on);
    if (!on.length) return null;
    const budget = Math.max(100, Math.round(Number(opts.budget) || 600)) * 4; // in characters
    const scene = readScene(type);
    const recent = recentText(type, Math.max(1, Math.round(Number(opts.lookback) || 4)));
    const by = kind => on.filter(w => w.kind === kind);
    const n = names();

    // Who is present: named by the header or the HUD. With neither, anyone named in the last messages.
    const chars = by('character');
    let present = scene.present ? chars.filter(w => namedIn(scene.present, w)) : [];
    let how = scene.how;
    if (!scene.present) { present = chars.filter(w => namedIn(recent, w)); how = present.length ? 'names in the last messages' : ''; }
    // People the reply says are here and the world has no entry for.
    const missing = scene.present
        ? scene.present.split(/,|\band\b|;|\//i).map(clean).filter(x => x && x.length < 40 && !/^(none|alone|nobody|no one|n\/a|-)$/i.test(x))
            .filter(x => !chars.some(w => namedIn(x, w)) && !new RegExp(`^${esc(n.user)}$`, 'i').test(x))
        : [];

    const places = by('place');
    const place = (scene.location ? places.filter(w => namedIn(scene.location, w)) : [])[0] || places.map(w => [w, namedIn(recent, w)]).filter(x => x[1]).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const sections = [];
    const ids = [];
    const extra = [];
    let used = 0;
    const room = (text) => used + text.length <= budget;
    const take = (section, w, text, isExtra = false) => {
        used += text.length + 3;
        section.lines.push(`- ${text}`);
        ids.push(w.uid);
        if (isExtra) extra.push(w.uid);
    };
    const section = (title) => { const s = { title, lines: [] }; sections.push(s); return s; };

    // 0. The story so far has room of its own: what came before the newer chapters, older chapters whose people or
    //    places are in play (in short), and the newest chapters of this chat in full.
    const sum = settings().summary;
    if (chapters) {
        const chatId = String(ctx().getCurrentChatId?.() || '');
        const story = section('The story so far');
        const sRoom = Math.max(100, Math.round(Number(sum.budget) || 800)) * 4;
        let sUsed = 0;
        const put = (w, text) => { if (sUsed + text.length > sRoom && sUsed > 0) return false; sUsed += text.length + 3; story.lines.push(`- ${text}`); ids.push(w.uid); return true; };
        const times = chatTimes();
        const cs = chatState();
        const invalidFrom = cs?.historyNeedsReview ? Number(cs.historyInvalidFrom) || 0 : 0;
        // Keep the user's edited chapter in the world, but do not send it until
        // they have reviewed a chapter that overlaps the altered story.
        const chapters = by('chapter').filter(w => !(invalidFrom && w.span && chapterIsMine(w, chatId, times) && Number(w.span.to) >= invalidFrom)).sort((a, b) => (a.span?.to || 0) - (b.span?.to || 0) || a.uid - b.uid);
        // A combined account of this chat already holds the chapters up to where it ends; those count as older ones.
        const ownRoll = chapters.find(w => w.rollup && chapterIsMine(w, chatId, times));
        const mine = chapters.filter(w => !w.rollup && chapterIsMine(w, chatId, times) && !(ownRoll && w.span.to <= ownRoll.span.to));
        const newest = mine.slice(-Math.max(1, Math.round(Number(sum.keep) || 2)));
        // The combined account is titled for the chat it is read in: it is either the earlier part of this chat, or
        // everything from the chat this one carries on from.
        const rollTitle = (w) => (ROLL_NAMES.includes(w.name) ? { ...w, name: chapterIsMine(w, chatId, times) ? ROLL_NAMES[0] : ROLL_NAMES[1] } : w);
        for (const w of chapters.filter(x => x.rollup)) put(w, renderEntry(rollTitle(w)));
        const sceneText = `${scene.present} ${scene.location} ${recent}`;
        for (const w of chapters.filter(x => !x.rollup && !newest.includes(x))) {
            const about = `${w.fields.people}, ${w.fields.places}`.split(/,|;|\band\b/i).map(clean).filter(x => x.length >= 3);
            if (about.some(n => namedIn(sceneText, { name: n, aliases: [] }))) put(w, renderEntry(w, { full: false }));
        }
        for (const w of newest) put(w, renderEntry(w));
        // The AI writer can be shown the same account ("What to show the AI").
        rememberStory(story.lines.map(l => l.replace(/^- /, '')).join('\n'));
    }

    // 1. Open threads and things going on elsewhere are short and always in view.
    const threads = section('Open threads');
    for (const w of by('thread').filter(w => w.status !== DONE.thread)) take(threads, w, renderEntry(w, { full: false }));
    const elsewhere = section('Going on elsewhere');
    for (const w of by('activity').filter(w => w.status !== DONE.activity).sort((a, b) => a.uid - b.uid).slice(0, MAX_ACTIVITIES)) take(elsewhere, w, renderEntry(w, { full: false }));

    // 2. The people in the scene, in full while there is room, then in short.
    const here = section('In this scene');
    for (const w of present) {
        const full = renderEntry(w);
        take(here, w, room(full) ? full : renderEntry(w, { full: false }));
    }
    const where = section('Where');
    if (place) { const full = renderEntry(place); take(where, place, room(full) ? full : renderEntry(place, { full: false })); }

    // 3. Secrets that belong to someone in the scene, or that the last messages name.
    const secrets = section('Secrets');
    const presentText = present.map(w => [w.name, ...w.aliases].join(' ')).join(' ');
    for (const w of by('secret')) {
        const about = { name: clean(w.fields.holder), aliases: [] };
        // Its keeper is in the scene, its keeper or its own title is named in the last messages, or someone who knows it is in the scene.
        const tied = (about.name && (present.some(p => namedIn(about.name, p) || namedIn(presentText, about)) || namedIn(recent, about))) || namedIn(recent, w) || present.some(p => namedIn(clean(w.fields.known), p));
        if (!tied) continue;
        const text = renderEntry(w);
        if (room(text)) take(secrets, w, text);
    }

    // 4. Planted details and everything else the last messages name, best match first. These take turns when room is short.
    const lately = sentLately(type);
    const rest = on.filter(w => !ids.includes(w.uid) && ['seed', 'character', 'place', 'faction'].includes(w.kind) && !(w.kind === 'seed' && w.status === DONE.seed))
        .map(w => { const named = namedIn(recent, w) + (w.kind === 'seed' ? 4 : 0); return { w, named, score: named - 5 * (lately.get(w.uid) || 0) }; })
        // Anything named stays in the running. When room is short, what was sent lately goes to the back of the line.
        .filter(x => x.named > 0).sort((a, b) => b.score - a.score);
    const planted = section('Planted earlier');
    const also = section('Also relevant');
    for (const { w } of rest) {
        const text = renderEntry(w, { full: false });
        if (!room(text)) continue;
        take(w.kind === 'seed' ? planted : also, w, text, true);
    }

    if (memory) {
        const facts = section('Relevant facts');
        const evidence = `${scene.present} ${scene.location} ${recent}`;
        for (const entry of by('fact')) {
            const fact = parseJson(entry.fields.data);
            if (fact?.kind !== 'fact' || typeof fact.text !== 'string') continue;
            const names = [fact.subject,...(Array.isArray(fact.aliases) ? fact.aliases : [])].filter(x=>typeof x==='string' && x.trim());
            const title = String(entry.name || '').replace(/[-_]/g,' ');
            if (!names.length && title.length>=5) names.push(title);
            if (!fact.protected && !names.some(name=>namedIn(evidence,{name,aliases:[]}))) continue;
            if (room(fact.text)) take(facts,entry,fact.text);
        }
    }
    const body = sections.filter(s => s.lines.length).map(s => `${s.title}:\n${s.lines.join('\n')}`).join('\n');
    if (!body) return null;
    const text = memory ? `[Story memory\n${body}]` : `[Story notes. ${promptText('storyNotes')}\n${body}]`;
    return { text, tokens: Math.round(text.length / 4), ids, extra, present: present.map(w => w.name), missing, place: place?.name || '', location: clean(scene.location), how };
}

export function storyRecall(list, type = 'normal', { memory = memoryOnly(), components = memoryComponents() } = {}) {
    const rows = list.filter(row=>row.kind==='chapter' ||
        components.world && (!memory || ['character','place','faction','fact'].includes(row.kind)));
    return { rows, notes:buildNotes(rows,type,settings().world,{ chapters:components.chapters, memory }) };
}

/** Load this chat's world and build the notes for the reply that is about to be written. */
export async function notesForChat(type = 'normal') {
    const id = chatWorld();
    if (!id) return null;
    const data = await loadSet(id).catch(() => null);
    if (!data) return null;
    return storyRecall(listWorld(data,id),type).notes;
}

/** The lorebook entry that carries the story notes. It is made for each scan and is in no lorebook. */
export function notesEntry(text) {
    const o = settings().world;
    const place = o.place === 'before' ? { position: 0 } : o.place === 'after' ? { position: 1 } : { position: 4, depth: Math.max(0, Math.round(Number(o.depth) || 4)) };
    return {
        uid: 0, world: NOTES_WORLD, comment: 'Story notes', content: text, key: [], keysecondary: [],
        constant: true, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 90, depth: 4, role: 0, ...place,
        disable: false, ignoreBudget: true, excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 0,
        probability: 100, useProbability: false, group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '',
        sticky: null, cooldown: null, delay: null, triggers: [], outletName: '', displayIndex: 0,
        characterFilter: { isExclude: false, names: [], tags: [] }, extensions: { ri: { type: 'notes' } },
    };
}

// ---------- write an entry with AI ----------

/** One background request that fills in the lines of one entry. Returns { name, aliases, fields }. */
export async function writeWorldEntryWithAI({ kind, about, context, existing = [] }) {
    const def = WORLD_KINDS[kind];
    const keys = def.fields.map(f => f.key);
    const lines = [
        `Write one entry for the story notes of a roleplay. The entry is about a ${def.label.toLowerCase()}.`,
        '',
        about ? `What it is about: ${about}` : `Choose a ${def.label.toLowerCase()} that the story below has shown and that has no entry yet.`,
        '',
        'Return these keys:',
        `- "name": ${def.nameHelp}`,
        '- "aliases": a list of other names the story uses for it. An empty list when there are none.',
        ...def.fields.map(f => `- "${f.key}": ${f.label}.${f.help ? ` ${f.help}` : ''}`),
        '',
        'Rules:',
        promptText('entryWriterRules'),
    ];
    if (existing.length) lines.push('', `Entries that already exist (write a different one): ${existing.slice(0, 40).join(', ')}`);
    { const story = contextText(context); if (story) lines.push('', STORY_LEAD.replace(', and still use the placeholders for names', ''), story); }
    lines.push('', ...writerRules());
    lines.push('', `Return only a JSON object with the keys "name", "aliases", ${keys.map(k => `"${k}"`).join(', ')}.`);
    const res = await request({ what: `Write a ${def.label.toLowerCase()} entry`, system: 'You keep the story notes of a roleplay. You answer with JSON only.', user: lines.join('\n'), tokens: 900, profileId: settings().profileId });
    const answer = String(res.text);
    const obj = parseJson(answer.slice(Math.max(0, answer.indexOf('{'))));
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Object.keys(obj).some(k => k === 'name' || keys.includes(k))) {
        const began = clean(answer).slice(0, 140);
        const why = `The AI answered, but no entry could be read from the answer. It began: "${began}". The Log tab has the whole answer.`;
        res.note(why, false);
        throw new Error(why);
    }
    const out = { name: clean(obj.name), aliases: (Array.isArray(obj.aliases) ? obj.aliases : []).filter(x => typeof x === 'string').map(clean).filter(Boolean), fields: {} };
    for (const k of keys) out.fields[k] = typeof obj[k] === 'string' ? obj[k].trim() : Array.isArray(obj[k]) ? obj[k].filter(x => typeof x === 'string').join('; ') : '';
    res.note(`An entry named "${out.name || 'no name'}" with ${keys.filter(k => out.fields[k]).length} of ${keys.length} lines filled in was read.`, true);
    return out;
}

export { saveSet as saveWorld, loadSet as loadWorld };
