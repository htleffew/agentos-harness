// Undercurrent 2: content-driven settings.
// CONTENT exports CONTENT_SETTINGS from extension/src/content.js. Until it does (or when an entry is missing), this
// module derives equivalent schema entries from the content object itself, so the suite always has a working surface.
// Slot builders never hard-code keys: they resolve each ROLE to the schema key that serves it (role, optionsRef or key).

/** Canonical role -> default key + content reference. CONTENT may use other keys as long as `role` or `optionsRef` match. */
export const ROLES = Object.freeze({
    persona: { key: 'persona', ref: 'personas', tab: 'narrator', section: 'Narrator', label: 'Narrator persona', type: 'select', scope: 'setup' },
    rule_voice: { key: 'rule_voice', ref: 'rule_voice', tab: 'narrator', section: 'Narrator', label: 'Rule voice', type: 'select', scope: 'setup' },
    author_voice: { key: 'author_voice', ref: 'voice', tab: 'narrator', section: 'Narrator', label: 'Author voice', type: 'select', scope: 'setup' },
    length: { key: 'length', ref: 'length', tab: 'writing', section: 'Writing', label: 'Reply length', type: 'select', scope: 'setup' },
    dialogue: { key: 'dialogue', ref: 'dialogue', tab: 'writing', section: 'Writing', label: 'Dialogue share', type: 'select', scope: 'setup' },
    thoughts: { key: 'thoughts', ref: 'thoughts', tab: 'writing', section: 'Writing', label: '{{char}} thoughts', type: 'select', scope: 'setup' },
    pronouns: { key: 'pronouns', ref: 'pronouns', tab: 'writing', section: 'Writing', label: '{{user}} pronouns', type: 'select', scope: 'setup' },
    model_family: { key: 'model_family', ref: 'models', tab: 'writing', section: 'Model', label: 'Model family', type: 'select', scope: 'setup' },
    explicitness: { key: 'explicitness', ref: 'explicitness', tab: 'story', section: 'Story Config', label: 'Content rating', type: 'select', scope: 'story' },
    tone: { key: 'tone', ref: 'tone', tab: 'story', section: 'Story Config', label: 'Tone', type: 'select', scope: 'story' },
    genre: { key: 'genre', ref: 'genre', tab: 'story', section: 'Story Config', label: 'Genre', type: 'select', scope: 'story' },
});

/** Strip `content.` / `options.` prefixes so 'options.length' and 'length' compare equal. */
export function normRef(ref) {
    return String(ref ?? '').replace(/^content\./, '').replace(/^options\./, '').trim();
}

const storyRefs = id => [`story.fields.${id}`, `story.${id}`];

/** Default option id of a content option list (the one flagged default, else the first). */
export function defaultOptionId(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const d = list.find(o => o && o.default);
    return String((d || list[0])?.id ?? '');
}

/** The option list a role reads from content. */
export function optionsForRole(content, role) {
    const c = content || {};
    switch (role) {
        case 'persona': return Array.isArray(c.personas) ? c.personas : [];
        case 'rule_voice':
            if (Array.isArray(c.options?.rule_voice)) return c.options.rule_voice;
            return (Array.isArray(c.voices) ? c.voices : ['loud', 'plain']).map(v => (typeof v === 'string' ? { id: v, label: v, text: '' } : v));
        case 'model_family': return [{ id: 'auto', label: 'Auto-detect', text: '' }, ...(Array.isArray(c.models) ? c.models : [])];
        case 'author_voice': return Array.isArray(c.options?.voice) ? c.options.voice : [];
        default: return Array.isArray(c.options?.[ROLES[role]?.ref]) ? c.options[ROLES[role].ref] : [];
    }
}

function roleDefault(content, role) {
    if (role === 'model_family') return 'auto';
    if (role === 'rule_voice') {
        const list = optionsForRole(content, role);
        return list.some(o => o.id === 'loud') ? 'loud' : defaultOptionId(list);
    }
    if (role === 'author_voice' || role === 'genre') {
        const list = optionsForRole(content, role);
        const d = list.find(o => o && o.default);
        return String(d?.id ?? (list.some(o => o.id === 'none') ? 'none' : defaultOptionId(list)));
    }
    return defaultOptionId(optionsForRole(content, role));
}

/** Schema entries derived from content (used when CONTENT_SETTINGS is missing, or to fill its gaps). */
export function deriveContentSettings(content) {
    const out = [];
    for (const [role, r] of Object.entries(ROLES)) {
        out.push({
            key: r.key, role, tab: r.tab, section: r.section, type: r.type, default: roleDefault(content, role),
            optionsRef: r.ref === 'personas' || r.ref === 'models' ? r.ref : `options.${r.ref}`,
            label: r.label, help: '', advanced: false, scope: r.scope,
        });
    }
    const fields = Array.isArray(content?.options?.story?.fields) ? content.options.story.fields : [];
    for (const f of fields) {
        if (!f || !f.id) continue;
        out.push({
            key: `story.${f.id}`, role: `story:${f.id}`, tab: 'story', section: 'Story Config', type: f.free_text ? 'chips' : 'select',
            default: f.default ?? defaultOptionId(f.options), optionsRef: `story.${f.id}`, label: f.label || f.id, help: '',
            advanced: false, scope: 'story', free_text: !!f.free_text, icon: f.icon || '',
        });
    }
    return out;
}

/**
 * Merge CONTENT_SETTINGS (authoritative when present) with derived entries for any role it does not cover.
 * @returns {object[]}
 */
export function contentSettingsFor(content, provided) {
    const given = Array.isArray(provided) ? provided.filter(e => e && e.key) : [];
    const derived = deriveContentSettings(content);
    const out = [...given];
    for (const d of derived) {
        if (findRoleEntry(given, d.role)) continue;
        if (given.some(g => g.key === d.key)) continue;
        out.push(d);
    }
    return out;
}

/** The schema entry serving a role: explicit `role`, else matching optionsRef, else the canonical key. */
export function findRoleEntry(schema, role) {
    const list = Array.isArray(schema) ? schema : [];
    const byRole = list.find(e => e && e.role === role);
    if (byRole) return byRole;
    if (role.startsWith('story:')) {
        const id = role.slice(6);
        const refs = storyRefs(id);
        return list.find(e => e && refs.includes(normRef(e.optionsRef))) || list.find(e => e && e.key === `story.${id}`) || null;
    }
    const r = ROLES[role];
    if (!r) return null;
    return list.find(e => e && normRef(e.optionsRef) === r.ref) || list.find(e => e && e.key === r.key) || null;
}

/** Map every role (and every story field) to the schema key that holds its value. */
export function resolveRoleKeys(schema, content) {
    const keys = {};
    for (const role of Object.keys(ROLES)) keys[role] = findRoleEntry(schema, role)?.key || ROLES[role].key;
    keys.story = {};
    const fields = Array.isArray(content?.options?.story?.fields) ? content.options.story.fields : [];
    for (const f of fields) {
        if (!f?.id) continue;
        keys.story[f.id] = findRoleEntry(schema, `story:${f.id}`)?.key || `story.${f.id}`;
    }
    return keys;
}
