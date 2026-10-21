// Undercurrent 2: the settings schema = CORE entries + CONTENT_SETTINGS + FEATURES' featureSchema (BUILD_SPEC §4).
// Every entry: {key, tab, section, type, default, options|optionsRef, label, help, advanced, scope}.
// The everyday surface stays small: CORE adds only a handful of visible controls; tuning knobs are `advanced`.

import { contentSettingsFor } from './contentSettings.js';
import { clone } from '../core/util.js';

export const TABS = Object.freeze(['story', 'narrator', 'writing', 'director', 'characters', 'memory', 'rules', 'advanced']);
export const TYPES = Object.freeze(['toggle', 'select', 'chips', 'text', 'textarea', 'number', 'slider', 'order']);

/** Envelope blocks the user may switch off (scene and tracker are always on: they carry the in-reply director). */
export const OPTIONAL_BLOCKS = Object.freeze(['minds', 'threads', 'facts', 'intimacy', 'new_character']);

export const CORE_SCHEMA = Object.freeze([
    { key: 'narrator.ooc', tab: 'narrator', section: 'Narrator', type: 'toggle', default: true, label: 'OOC replies in persona',
        help: 'When you ask out of character, the narrator answers in its persona voice.', advanced: false, scope: 'setup' },
    { key: 'writing.reasoning', tab: 'writing', section: 'Reasoning', type: 'select', default: 'auto', label: 'Reasoning mode',
        options: [
            { id: 'auto', label: 'Auto', text: 'Native when the model reasons on its own, otherwise prompted.' },
            { id: 'native', label: 'Native', text: 'The model plans silently.' },
            { id: 'prompted', label: 'Prompted', text: 'Planning steps in a <think> block before the prose.' },
            { id: 'off', label: 'Off', text: 'No planning steps.' },
        ], help: 'How the planning steps are requested.', advanced: false, scope: 'setup' },
    { key: 'ban_words', tab: 'writing', section: 'Prose', type: 'textarea', default: '', label: 'Extra banned phrases',
        help: 'One per line. Sent as a single "Also banned" line.', advanced: true, scope: 'setup' },
    { key: 'envelope.compact', tab: 'director', section: 'Hidden state', type: 'toggle', default: true, label: 'Compact envelope',
        help: 'Scene and Tracker every turn; the other blocks only when something changed.', advanced: false, scope: 'setup' },
    { key: 'display.reply_card', tab: 'director', section: 'Hidden state', type: 'toggle', default: false, label: 'Tracker card under replies',
        help: 'A closed "Behind the scenes" strip under each reply.', advanced: false, scope: 'setup' },
    ...OPTIONAL_BLOCKS.map(id => ({
        key: `envelope.block.${id}`, tab: 'director', section: 'Envelope blocks', type: 'toggle', default: true,
        label: `Block: ${id.replace('_', ' ')}`, help: 'Ask the model for this block in the hidden envelope.', advanced: true, scope: 'setup',
    })),
    { key: 'jobs.profile', tab: 'advanced', section: 'Background jobs', type: 'select', default: '', optionsRef: 'connectionProfiles',
        label: 'Connection profile for background jobs', help: 'Empty = the current connection.', advanced: true, scope: 'setup' },
    { key: 'jobs.timeout', tab: 'advanced', section: 'Background jobs', type: 'number', default: 60, min: 10, max: 600, step: 5,
        label: 'Job timeout (seconds)', help: '', advanced: true, scope: 'setup' },
    { key: 'budget.uc_cast', tab: 'advanced', section: 'Turn block budgets', type: 'number', default: 160, min: 0, max: 1000, step: 10,
        label: 'Cast budget (words)', help: '', advanced: true, scope: 'setup' },
    { key: 'budget.uc_directive', tab: 'advanced', section: 'Turn block budgets', type: 'number', default: 120, min: 0, max: 1000, step: 10,
        label: 'Directive budget (words)', help: '', advanced: true, scope: 'setup' },
    { key: 'budget.uc_recall', tab: 'advanced', section: 'Turn block budgets', type: 'number', default: 200, min: 0, max: 2000, step: 10,
        label: 'Recall budget (words)', help: '', advanced: true, scope: 'setup' },
    { key: 'dev.debug', tab: 'advanced', section: 'Developer', type: 'toggle', default: false, label: 'Debug log',
        help: 'Log slot builds and job traffic to the browser console.', advanced: true, scope: 'setup' },
]);

const VALID_TAB = new Set(TABS);

function normalizeEntry(e, source) {
    const out = { advanced: false, scope: 'setup', help: '', ...e, source };
    if (!VALID_TAB.has(out.tab)) out.tab = 'advanced';
    if (!out.section) out.section = '';
    if (!out.label) out.label = out.key;
    return out;
}

/**
 * Build the full schema. First declaration of a key wins (core, then content, then features); duplicates are reported.
 * @param {{content?:object, contentSettings?:object[], featureSchema?:object[], featureDefaults?:object}} parts
 * @returns {{schema:object[], duplicates:string[]}}
 */
export function buildSchema({ content = null, contentSettings = null, featureSchema = [], featureDefaults = {} } = {}) {
    const seen = new Map();
    const duplicates = [];
    const add = (list, source) => {
        for (const e of Array.isArray(list) ? list : []) {
            if (!e || typeof e.key !== 'string' || !e.key) continue;
            if (seen.has(e.key)) { duplicates.push(`${e.key} (${source} vs ${seen.get(e.key).source})`); continue; }
            seen.set(e.key, normalizeEntry(clone(e), source));
        }
    };
    add(CORE_SCHEMA, 'core');
    add(contentSettingsFor(content, contentSettings), 'content');
    add(featureSchema, 'features');
    const fd = featureDefaults && typeof featureDefaults === 'object' ? featureDefaults : {};
    for (const [k, v] of Object.entries(fd)) {
        const e = seen.get(k);
        if (e && e.default === undefined) e.default = clone(v);
        else if (!e) seen.set(k, normalizeEntry({ key: k, tab: 'advanced', type: typeof v === 'boolean' ? 'toggle' : typeof v === 'number' ? 'number' : 'text', default: clone(v), hidden: true, advanced: true }, 'features'));
    }
    return { schema: [...seen.values()], duplicates };
}

/** {key: default} for a schema. */
export function defaultsOf(schema) {
    const out = {};
    for (const e of schema || []) out[e.key] = clone(e.default);
    return out;
}

/** Count of everyday (non-advanced, non-hidden) controls. BUILD_SPEC §4: keep it ≤ 40. */
export function everydayCount(schema) {
    return (schema || []).filter(e => !e.advanced && !e.hidden).length;
}
