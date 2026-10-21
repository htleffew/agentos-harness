// Undercurrent 2: {{uc.*}} placeholder computation and filling (docs/CONTENT_SCHEMA.md). Pure.
// ST macros ({{user}}, {{char}}) are left untouched here; CORE runs substituteParams on the finished slot value.

import { findOption } from '../core/content.js';
import { replaceAllLiteral } from '../core/util.js';

export const PLACEHOLDER_RE = /\{\{\s*uc\.([a-z0-9_]+)\s*\}\}/gi;

export const PLACEHOLDERS = Object.freeze([
    'persona_name', 'persona_identity', 'length_rule', 'dialogue_rule', 'thoughts_rule', 'pronoun_rule', 'explicitness_rule',
    'genre_rule', 'tone_rule', 'voice_rule', 'persona_taste', 'persona_ooc', 'config_lines', 'banlist', 'model_note',
]);

/** Pick a voiced text: obj[voice], else the other voice. Strings pass through. */
export function voiced(obj, voice) {
    if (typeof obj === 'string') return obj;
    if (!obj || typeof obj !== 'object') return '';
    if (typeof obj[voice] === 'string') return obj[voice];
    for (const v of ['plain', 'loud']) if (typeof obj[v] === 'string') return obj[v];
    return '';
}

/**
 * Fill {{uc.x}} placeholders. A line whose placeholders all resolve empty is dropped; unknown names are empty.
 * @param {string} text
 * @param {Record<string,string>} values
 */
export function fillPlaceholders(text, values) {
    const src = String(text ?? '');
    if (!src.includes('{{')) return src;
    const out = [];
    for (const line of src.split('\n')) {
        const names = [...line.matchAll(PLACEHOLDER_RE)].map(m => m[1].toLowerCase());
        if (!names.length) { out.push(line); continue; }
        const vals = names.map(n => String(values?.[n] ?? ''));
        if (vals.every(v => !v.trim())) continue;
        out.push(line.replace(PLACEHOLDER_RE, (_, n) => String(values?.[n.toLowerCase()] ?? '')));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Names of the placeholders used in a text. */
export function placeholdersIn(text) {
    return [...String(text ?? '').matchAll(PLACEHOLDER_RE)].map(m => m[1].toLowerCase());
}

/** Text of the selected option; an unknown id falls back to the list's default option (then the first). */
function optionText(list, id) {
    const arr = Array.isArray(list) ? list : [];
    const o = findOption(arr, id) || arr.find(x => x && x.default) || arr[0];
    return o && typeof o.text === 'string' ? o.text : '';
}

/** One line "- Also banned: a; b; c" from user ban words (text or list) and provider contributions. */
export function banlistLine(...sources) {
    const items = [];
    for (const src of sources) {
        const list = Array.isArray(src) ? src : String(src ?? '').split(/\r?\n|;/);
        for (const x of list) for (const part of String(x ?? '').replace(/^-\s*Also banned:\s*/i, '').split(/\r?\n|;/)) {
            const t = part.trim();
            if (t && !items.includes(t)) items.push(t);
        }
    }
    return items.length ? `- Also banned: ${items.join('; ')}` : '';
}

/** The persona currently selected (falls back to the default persona, then the first). */
export function selectedPersona(content, id) {
    const list = Array.isArray(content?.personas) ? content.personas : [];
    return findOption(list, id) || list.find(p => p?.default) || list[0] || null;
}

/** Story Config lines from the story fields (option text, or free text when the field allows it). */
export function configLines(content, settings, storyKeys) {
    const fields = Array.isArray(content?.options?.story?.fields) ? content.options.story.fields : [];
    const lines = [];
    for (const f of fields) {
        if (!f?.id) continue;
        const key = storyKeys?.[f.id] ?? `story.${f.id}`;
        const raw = settings && Object.hasOwn(settings, key) ? settings[key] : f.default;
        const vals = Array.isArray(raw) ? raw : [raw];
        const texts = [];
        for (const v of vals) {
            if (v === undefined || v === null || String(v).trim() === '') continue;
            const opt = findOption(f.options, v);
            const t = opt ? String(opt.text ?? '') : (f.free_text ? String(v) : '');
            if (t.trim()) texts.push(t.trim());
        }
        if (!texts.length) continue;
        if (typeof f.line !== 'string' || !f.line.trim()) continue;
        lines.push(`- ${replaceAllLiteral(f.line, '{value}', texts.join(', '))}`);
    }
    return lines.join('\n');
}

/**
 * Every {{uc.*}} value for the current settings. Deterministic given (content, settings, persona description, family).
 * @param {object} o
 * @param {object} o.content effective content
 * @param {object} o.settings effective settings
 * @param {object} o.roles role → key map (settings/contentSettings.js resolveRoleKeys)
 * @param {string} [o.family] model family id
 * @param {Record<string,string[]>} [o.extra] provider contributions to placeholders (e.g. {banlist:[...]})
 */
export function computePlaceholders({ content, settings, roles, family = '', extra = {} }) {
    const s = settings || {};
    const c = content || {};
    const opts = c.options || {};
    const voice = s[roles.rule_voice] === 'plain' ? 'plain' : 'loud';
    const p = selectedPersona(c, s[roles.persona]);
    const v = {};
    v.persona_name = p?.name ? String(p.name) : '';
    v.persona_identity = p ? String(p[`identity_${voice}`] ?? '') : '';
    v.persona_taste = p?.taste ? String(p.taste) : '';
    v.persona_ooc = s['narrator.ooc'] !== false && p?.ooc ? String(p.ooc) : '';
    v.length_rule = optionText(opts.length, s[roles.length]);
    v.dialogue_rule = optionText(opts.dialogue, s[roles.dialogue]);
    v.thoughts_rule = optionText(opts.thoughts, s[roles.thoughts]);
    v.explicitness_rule = optionText(opts.explicitness, s[roles.explicitness]);
    v.genre_rule = optionText(opts.genre, s[roles.genre]);
    v.tone_rule = optionText(opts.tone, s[roles.tone]);
    v.voice_rule = optionText(opts.voice, s[roles.author_voice]);
    // Auto pronouns: the option text tells the model to read {{user}}'s persona (no guessing in code).
    v.pronoun_rule = optionText(opts.pronouns, s[roles.pronouns]);
    v.config_lines = configLines(c, s, roles.story);
    const fam = (Array.isArray(c.models) ? c.models : []).find(m => m?.id === family);
    v.model_note = fam ? voiced(fam.note, voice) : '';
    v.banlist = banlistLine(s['ban_words'], extra?.banlist);
    for (const [name, list] of Object.entries(extra || {})) {
        if (name === 'banlist') continue;
        const add = (Array.isArray(list) ? list : [list]).map(x => String(x ?? '').trim()).filter(Boolean).join('\n');
        if (!add) continue;
        v[name] = v[name] ? `${v[name]}\n${add}` : add;
    }
    return v;
}
