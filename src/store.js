// Saved settings (per app) and per-chat state.
import { ctx, KEY, names, characterKey, setChatVariable, isChatOpen } from './st.js';

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
    sets: {},                    // lorebook name -> { limit: 'none' | 'one' | 'together' | 'max', max: 2 }
    profileId: '',               // AI connection for writing and checking ('' = same as the chat)
    check: { mode: 'full', maxResend: 2, holdNew: true, regenOnMiss: false, agency: 'flag' },
    showUnder: 'off',            // 'off' | 'display' | 'saved'
    writer: { count: 10, includeCard: false },
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

export function settings() {
    const root = ctx().extensionSettings;
    if (!root[KEY] || typeof root[KEY] !== 'object') root[KEY] = {};
    return fill(root[KEY], DEFAULTS);
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
