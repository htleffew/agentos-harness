// Saved settings (per app) and per-chat state.
import { ctx, KEY, names, characterKey, setChatVariable, isChatOpen } from './st.js';
import { DEFAULT_WORDS, DEFAULT_WRITER_RULES, DEFAULT_VOICE, OLD_VOICE_START } from './defaults.js';

export const FORMS = ['they', 'them', 'their', 'theirs', 'themself'];
export const PRONOUN_SETS = {
    she: ['she', 'her', 'her', 'hers', 'herself'],
    he: ['he', 'him', 'his', 'his', 'himself'],
    they: ['they', 'them', 'their', 'theirs', 'themself'],
    it: ['it', 'it', 'its', 'its', 'itself'],
};
export const PRONOUN_LABELS = { she: 'she / her', he: 'he / him', they: 'they / them', it: 'it / its', custom: 'Other (type your own)' };

const DEFAULTS = {
    enabled: true,
    perReply: 1,                 // how many new things may start in one reply, across every set and the goal (0 = no cap)
    sets: {},                    // set id -> { limit: 'none' | 'one' | 'together' | 'max', max: 2, kind, book?, group?, was? }
                                 //   a set in a lorebook of its own: id is the lorebook name. Inside a shared lorebook: book and group are set.
    profileId: '',               // AI connection for writing and checking ('' = same as the chat)
    check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' },
    showUnder: 'off',            // 'off' | 'display' | 'saved'
    world: {
        copyOnBranch: true,   // a branch gets its own copy of the story world the first time it is opened
        budget: 600, place: 'depth', depth: 4, lookback: 4,   // story notes: room in tokens, where they go, how many messages are read for names
        update: 'all',        // keeping the world up to date from each reply: 'all' | 'auto' (only entries the extension added) | 'off'
        build: 10,            // an open thread moves up one step after this many replies without movement (0 = never by itself)
        head: 20,             // chance (%) each reply that something ready is ordered into the scene (0 = never)
        minAge: 6,            // replies a planted detail or a thing going on elsewhere must wait before it can be ordered into the scene
        bring: { thread: true, seed: true, activity: true, secret: false },   // what may be ordered into the scene
    },
    summary: {
        on: true,             // keep the story so far in chapters, in the chat's story world
        retire: true,         // what is finished (settled threads, secrets that came out...) is written into the chapter and turned off
        onSceneEnd: true,     // write a chapter when the update block says the scene ended
        minReplies: 4,        // and at least this many replies have gone by since the last chapter
        every: 20,            // write a chapter after this many replies in any case (0 = only when a scene ends, or by hand)
        keep: 2,              // newest chapters of the chat that are always sent in full
        roll: 8,              // when a chat has more chapters than this, the older ones are combined into one
        budget: 800,          // room in tokens for the story so far
        hide: true,           // hide from the AI the messages a chapter covers (they stay in the chat)
        keepShown: 30,        // the newest messages are never hidden this way
    },
    pace: {
        quiet: 2,             // after a big event has happened, nothing new starts for this many replies (0 = off)
        silent: 4,            // a character of the story world who is in the scene and has gone unnamed in the story text for this many replies is ordered to speak or act (0 = off)
        phasesOn: false,      // story phases by reply number
        phases: [             // each phase starts at reply "from"; "chance" is a percentage of the usual chance that something new starts; "line" is sent with every reply of the phase
            { name: 'Opening', from: 1, chance: 50, line: '' },
            { name: 'Rising', from: 11, chance: 100, line: '' },
            { name: 'Long run', from: 41, chance: 125, line: '' },
        ],
    },
    scene: { track: true, card: 'auto' },   // ask every reply for who is present, where and when; draw the scene card ('auto': only under replies with no HUD of their own)
    cards: { on: true, most: 2, roast: true, previousRoast: false, voice: DEFAULT_VOICE },   // character profile cards and the roast, asked for in the same block as the scene lines
    dice: { on: true, user: true, char: true, others: true, stats: ['Strength', 'Agility', 'Wits', 'Charm', 'Will', 'Senses'], sheets: {} },   // rolled in code; sheets: stat modifiers per character card and persona
    words: { on: true, tell: true, list: DEFAULT_WORDS },   // words to flag in AI-written text; "tell" also asks the AI writer to leave them out
    writer: { count: 10, moreRoom: false, eventScene: false, rules: DEFAULT_WRITER_RULES, context: { card: false, scenario: false, persona: false, summary: false, recent: false, recentCount: 10 } },
    pronounMemory: { char: {}, user: {} },
    expanded: false,
};

function fill(target, defaults) {
    for (const [k, v] of Object.entries(defaults)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            if (!target[k] || typeof target[k] !== 'object') target[k] = {};
            fill(target[k], v);
        } else if (target[k] === undefined) {
            target[k] = v;
        }
    }
    return target;
}

export const HOME_BOOK = 'Roleplay Instructions';

export function settings() {
    const root = ctx().extensionSettings;
    if (!root[KEY] || typeof root[KEY] !== 'object') root[KEY] = {};
    const st = fill(root[KEY], DEFAULTS);
    // The starting voice of 5.11.0 (never edited) becomes the Gremlin voice.
    if (typeof st.cards?.voice === 'string' && st.cards.voice.startsWith(OLD_VOICE_START)) st.cards.voice = DEFAULT_VOICE;
    // Where new sets are kept: '' = each in a lorebook of its own, or the name of the shared lorebook.
    // A new install keeps everything in one lorebook. An install that already has sets stays as it is.
    if (typeof st.home !== 'string') st.home = Object.keys(st.sets).length ? '' : HOME_BOOK;
    return st;
}

export function saveSettings() {
    try { ctx().saveSettingsDebounced(); } catch { /* not fatal */ }
}

/** Per-chat state, stored in the chat file. Returns null when no chat is open. */
export function chatState() {
    if (!isChatOpen()) return null;
    const meta = ctx().chatMetadata;
    if (!meta) return null;
    if (!meta[KEY] || typeof meta[KEY] !== 'object') meta[KEY] = {};
    const cs = meta[KEY];
    if (!Array.isArray(cs.activeSets)) cs.activeSets = [];
    if (!cs.picks || typeof cs.picks !== 'object') cs.picks = {};
    if (!cs.used || typeof cs.used !== 'object') cs.used = {};
    if (!Array.isArray(cs.overdue)) cs.overdue = [];
    if (cs.lastScan === undefined) cs.lastScan = null;
    if (!cs.locks || typeof cs.locks !== 'object') cs.locks = {};       // "lorebook.uid" -> { categoryId: [itemIds] } picks locked for this chat
    if (typeof cs.world !== 'string') cs.world = '';                     // the id of the story world this chat uses
    if (!cs.presets || typeof cs.presets !== 'object') cs.presets = {};   // set id -> name of the saved category settings this chat uses
    return cs;
}

export function saveChatState() {
    const c = ctx();
    try { (c.saveMetadataDebounced || c.saveMetadata)(); } catch { /* not fatal */ }
}

/** Pronouns for this chat: { char: { preset, custom[5] }, user: { preset, custom[5] } }. */
export function chatPronouns() {
    const cs = chatState();
    const st = settings();
    const mem = st.pronounMemory;
    const fallback = role => {
        const key = role === 'char' ? characterKey() : `persona:${names().user}`;
        const saved = mem[role]?.[key];
        return saved ? structuredClone(saved) : { preset: 'they', custom: [...PRONOUN_SETS.they] };
    };
    if (!cs) return { char: fallback('char'), user: fallback('user') };
    if (!cs.pronouns) cs.pronouns = { char: fallback('char'), user: fallback('user') };
    for (const role of ['char', 'user']) {
        if (!cs.pronouns[role]) cs.pronouns[role] = fallback(role);
        if (!Array.isArray(cs.pronouns[role].custom) || cs.pronouns[role].custom.length !== 5) cs.pronouns[role].custom = [...PRONOUN_SETS.they];
    }
    return cs.pronouns;
}

export function pronounForms(role) {
    const p = chatPronouns()[role];
    return p.preset === 'custom' ? p.custom.map(x => String(x || '').trim() || 'they') : PRONOUN_SETS[p.preset] || PRONOUN_SETS.they;
}

export function setPronouns(role, preset, custom) {
    const p = chatPronouns()[role];
    p.preset = preset;
    if (Array.isArray(custom)) p.custom = custom.slice(0, 5);
    const st = settings();
    const key = role === 'char' ? characterKey() : `persona:${names().user}`;
    if (key) st.pronounMemory[role][key] = structuredClone(p);
    saveSettings();
    saveChatState();
    applyPronouns();
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/** Write the pronoun chat variables that saved versions refer to. */
export function applyPronouns() {
    if (!isChatOpen()) return;
    for (const role of ['char', 'user']) {
        const forms = pronounForms(role);
        FORMS.forEach((f, i) => {
            setChatVariable(`ri_${role}_${f}`, forms[i]);
            setChatVariable(`ri_${role}_${cap(f)}`, cap(forms[i]));
        });
    }
}
