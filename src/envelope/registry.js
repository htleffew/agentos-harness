// Undercurrent 2: envelope block registry (BUILD_SPEC §3.1). Pure.
// CORE declares the known blocks, their shape and gates; CONTENT supplies order, tag spelling, template and rule text.
// Each block: {id, tag, repeating, attrs, required:'always'|'when_changed'|'when_new', gate(settings), template, rule}.

const on = key => s => !s || s[key] !== false;

export const CORE_BLOCKS = Object.freeze([
    { id: 'scene', tag: 'Scene', repeating: false, attrs: [], required: 'always', gate: () => true },
    { id: 'minds', tag: 'Minds', repeating: false, attrs: [], required: 'when_changed', gate: on('envelope.block.minds') },
    { id: 'threads', tag: 'Threads', repeating: false, attrs: [], required: 'when_changed', gate: on('envelope.block.threads') },
    { id: 'facts', tag: 'Facts', repeating: false, attrs: [], required: 'when_changed', gate: on('envelope.block.facts') },
    {
        id: 'intimacy', tag: 'Intimacy', repeating: true, attrs: ['name'], required: 'when_changed',
        gate: s => on('envelope.block.intimacy')(s) && on('intimacy.enabled')(s),
    },
    { id: 'new_character', tag: 'New_Character', repeating: true, attrs: ['name'], required: 'when_new', gate: on('envelope.block.new_character') },
    { id: 'tracker', tag: 'Tracker', repeating: false, attrs: [], required: 'always', gate: () => true },
]);

const VALID_TAG = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * Registry for a content object: content order first (unknown content blocks are kept, gated by
 * `envelope.block.<id>`), then any core block content did not list. Core gates and shapes always apply.
 * @returns {object[]}
 */
export function blockRegistry(content) {
    const coreById = new Map(CORE_BLOCKS.map(b => [b.id, b]));
    const out = [];
    const seen = new Set();
    for (const cb of Array.isArray(content?.envelope?.blocks) ? content.envelope.blocks : []) {
        if (!cb || !cb.id || seen.has(cb.id)) continue;
        const core = coreById.get(cb.id);
        const tag = VALID_TAG.test(String(cb.tag ?? '')) ? String(cb.tag) : (core?.tag || '');
        if (!tag) continue;
        seen.add(cb.id);
        out.push({
            ...(core || { repeating: !!cb.repeating, attrs: cb.repeating ? ['name'] : [], required: cb.required || 'when_changed', gate: on(`envelope.block.${cb.id}`) }),
            id: String(cb.id),
            tag,
            template: typeof cb.template === 'string' ? cb.template : '',
            rule: typeof cb.rule === 'string' ? cb.rule : '',
            label: cb.label || cb.id,
        });
    }
    for (const b of CORE_BLOCKS) if (!seen.has(b.id)) out.push({ ...b, template: '', rule: '', label: b.id });
    return out;
}

/** Blocks enabled under the current settings, in registry order. */
export function enabledBlocks(registry, settings) {
    return (registry || []).filter(b => {
        try { return b.gate ? b.gate(settings || {}) : true; } catch { return true; }
    });
}

/** Normalized tag name used for matching model output: lower-case, separators removed. */
export function normTag(tag) {
    return String(tag ?? '').toLowerCase().replace(/[\s_-]+/g, '');
}

/** Regex source matching a tag and its separator variants (New_Character ~ New Character ~ NewCharacter ~ New-Character). */
export function tagPattern(tag) {
    return String(tag).split(/[_\s-]+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ _-]?');
}

/** Every tag (block tags + the UC wrapper) for display/prompt cleaners. */
export function allTags(registry) {
    return ['UC', ...(registry || []).map(b => b.tag)];
}
