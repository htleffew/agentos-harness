// Undercurrent 2: content access (docs/CONTENT_SCHEMA.md) and prompt-text overrides (diff-against-default).
// The loader is the only non-pure part (a guarded dynamic import); everything else is pure.

import { clone, getPath, setPath, isPlainObject } from './util.js';

/** An empty but well-formed content object: the suite still runs (static slots empty) if content is missing. */
export function emptyContent() {
    return {
        version: 0, voices: ['loud', 'plain'], slots: {}, impersonation: '', personas: [], options: { story: { fields: [] } },
        models: [], envelope: { blocks: [] }, jobs: {}, directive_phrases: {},
    };
}

/**
 * Load content: extension/src/content.js (default export + CONTENT_SETTINGS) when present, else `fallback()`.
 * @param {{url?:string|URL, fallback?:() => Promise<object>|object, importer?:(url)=>Promise<any>}} o
 * @returns {Promise<{content:object, contentSettings:object[]|null, source:string}>}
 */
export async function loadContent({ url, fallback, importer = u => import(u) } = {}) {
    if (url) {
        try {
            const mod = await importer(String(url));
            const content = mod?.default || mod?.content;
            if (isPlainObject(content)) {
                return { content, contentSettings: Array.isArray(mod.CONTENT_SETTINGS) ? mod.CONTENT_SETTINGS : null, source: 'content.js' };
            }
        } catch { /* not built yet */ }
    }
    if (typeof fallback === 'function') {
        try {
            const r = await fallback();
            if (isPlainObject(r?.content)) return { contentSettings: null, source: 'fallback', ...r };
            if (isPlainObject(r)) return { content: r, contentSettings: null, source: 'fallback' };
        } catch { /* ignore */ }
    }
    return { content: emptyContent(), contentSettings: null, source: 'empty' };
}

/**
 * Every editable text in content as a path (array elements addressed by id), for the prompt editor.
 * @returns {{path:string, label:string}[]}
 */
export function listPromptPaths(content) {
    const out = [];
    const c = content || {};
    for (const [slot, val] of Object.entries(c.slots || {})) {
        if (isPlainObject(val)) for (const [k, v] of Object.entries(val)) if (typeof v === 'string') out.push({ path: `slots.${slot}.${k}`, label: `${slot} (${k})` });
    }
    if (typeof c.impersonation === 'string') out.push({ path: 'impersonation', label: 'impersonation' });
    for (const p of c.personas || []) {
        if (!p?.id) continue;
        for (const k of ['taste', 'ooc', 'identity_loud', 'identity_plain']) if (typeof p[k] === 'string') out.push({ path: `personas.${p.id}.${k}`, label: `persona ${p.id} ${k}` });
    }
    for (const [group, list] of Object.entries(c.options || {})) {
        if (group === 'story') continue;
        for (const o of Array.isArray(list) ? list : []) if (o?.id && typeof o.text === 'string') out.push({ path: `options.${group}.${o.id}.text`, label: `${group}: ${o.label || o.id}` });
    }
    for (const f of c.options?.story?.fields || []) {
        if (!f?.id) continue;
        if (typeof f.line === 'string') out.push({ path: `options.story.fields.${f.id}.line`, label: `story ${f.id} line` });
        for (const o of f.options || []) if (o?.id && typeof o.text === 'string') out.push({ path: `options.story.fields.${f.id}.options.${o.id}.text`, label: `story ${f.id}: ${o.label || o.id}` });
    }
    for (const m of c.models || []) {
        if (!m?.id || !isPlainObject(m.note)) continue;
        for (const [k, v] of Object.entries(m.note)) if (typeof v === 'string') out.push({ path: `models.${m.id}.note.${k}`, label: `model ${m.id} (${k})` });
    }
    for (const b of c.envelope?.blocks || []) {
        if (!b?.id) continue;
        for (const k of ['template', 'rule']) if (typeof b[k] === 'string') out.push({ path: `envelope.blocks.${b.id}.${k}`, label: `envelope ${b.id} ${k}` });
    }
    for (const [job, val] of Object.entries(c.jobs || {})) {
        if (isPlainObject(val)) for (const [k, v] of Object.entries(val)) if (typeof v === 'string') out.push({ path: `jobs.${job}.${k}`, label: `job ${job} ${k}` });
    }
    for (const [k, v] of Object.entries(c.directive_phrases || {})) {
        if (typeof v === 'string') out.push({ path: `directive_phrases.${k}`, label: `phrase ${k}` });
    }
    return out;
}

/** Content with prompt overrides applied (a clone; the base is never mutated). Unknown paths are ignored. */
export function applyOverrides(content, overrides) {
    const keys = Object.keys(overrides || {});
    if (!keys.length) return content;
    const out = clone(content);
    for (const path of keys) {
        const cur = getPath(out, path);
        if (typeof cur !== 'string') continue;
        setPath(out, path, String(overrides[path]));
    }
    return out;
}

/** Find an element in a content option list by id. */
export function findOption(list, id) {
    if (!Array.isArray(list)) return null;
    return list.find(o => o && String(o.id) === String(id)) || null;
}
