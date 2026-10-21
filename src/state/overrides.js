// Undercurrent 2: user overrides of derived state (chat_metadata.undercurrent2.overrides), applied last. Pure.
// Shape: { [entity]: { [field]: value } } with entity 'char:<name>' | 'scene' | 'tracker' | 'fact'.
//   char:<name>  field = 'mood' | 'mind.mood' | 'profile.role' | 'offscreen' | 'intimacy.limits' (array of strings) ...
//   scene        field = 'place' | 'time' | 'present' (array or comma list) ...
//   tracker      field = 'phase' | 'next_beat' ...
//   fact         field = the fact text; value true adds it, false removes it
// The output records which fields were overridden in state.overridden so the UI can offer "clear override".

import { clone, isPlainObject, normKey } from '../core/util.js';
import { MIND_FIELDS } from '../envelope/fields.js';

function ensureChar(state, name) {
    const n = normKey(name);
    const key = Object.keys(state.characters).find(k => normKey(k) === n) || String(name).trim();
    if (!state.characters[key]) {
        state.characters[key] = { name: key, mind: {}, profile: {}, intimacy: { likes: [], dislikes: [], limits: [], history: [] }, firstSeen: state.turn, lastSeen: state.turn, offscreen: '' };
    }
    return state.characters[key];
}

function setDotted(obj, path, value) {
    const segs = path.split('.');
    let cur = obj;
    for (let i = 0; i < segs.length - 1; i++) {
        if (!isPlainObject(cur[segs[i]])) cur[segs[i]] = {};
        cur = cur[segs[i]];
    }
    cur[segs[segs.length - 1]] = value;
}

function asEvidence(v) {
    const list = Array.isArray(v) ? v : String(v ?? '').split('\n');
    return list.map(x => (typeof x === 'string' ? { text: x.trim(), quote: '', turn: null, ucId: 'override' } : { text: String(x?.text ?? ''), quote: String(x?.quote ?? ''), turn: null, ucId: 'override' }))
        .filter(x => x.text);
}

/** Returns a new state with overrides applied (input untouched). */
export function applyOverrides(state, overrides) {
    if (!isPlainObject(overrides) || !Object.keys(overrides).length) return state;
    const out = clone(state);
    out.overridden = {};
    for (const [entity, fields] of Object.entries(overrides)) {
        if (!isPlainObject(fields)) continue;
        const applied = [];
        if (entity.startsWith('char:')) {
            const name = entity.slice(5).trim();
            if (!name) continue;
            const ch = ensureChar(out, name);
            for (const [field, value] of Object.entries(fields)) {
                if (value === undefined || value === null) continue;
                let path = field;
                if (MIND_FIELDS.includes(field)) path = `mind.${field}`;
                if (/^intimacy\.(likes|dislikes|limits|history)$/.test(path)) {
                    setDotted(ch, path, asEvidence(value));
                } else {
                    setDotted(ch, path, clone(value));
                }
                applied.push(field);
            }
            if (applied.length) {
                const k = `char:${ch.name}`;
                out.overridden[k] = [...new Set([...(out.overridden[k] || []), ...applied])];
            }
        } else if (entity === 'scene' || entity === 'tracker') {
            for (const [field, value] of Object.entries(fields)) {
                if (value === undefined || value === null) continue;
                if (entity === 'scene' && field === 'present') {
                    out.scene.present = Array.isArray(value) ? value.map(String) : String(value).split(/\s*,\s*/).filter(Boolean);
                } else {
                    out[entity][field] = clone(value);
                }
                applied.push(field);
            }
            if (applied.length) out.overridden[entity] = applied;
        } else if (entity === 'fact') {
            for (const [text, value] of Object.entries(fields)) {
                const n = normKey(text);
                if (!n) continue;
                const idx = out.facts.findIndex(f => normKey(f.text) === n);
                if (value === false) {
                    if (idx >= 0) out.facts.splice(idx, 1);
                } else if (idx < 0) {
                    out.facts.push({ text, since: out.turn, ucId: 'override' });
                }
                applied.push(text);
            }
            if (applied.length) out.overridden.fact = applied;
        }
    }
    return out;
}

/** Set one override in an overrides object (mutates; value undefined/null clears). Returns the object. */
export function setOverrideIn(overrides, entity, field, value) {
    const o = isPlainObject(overrides) ? overrides : {};
    if (!entity || field === undefined || field === null || field === '') return o;
    if (value === undefined || value === null) {
        if (isPlainObject(o[entity])) {
            delete o[entity][field];
            if (!Object.keys(o[entity]).length) delete o[entity];
        }
        return o;
    }
    if (!isPlainObject(o[entity])) o[entity] = {};
    o[entity][field] = clone(value);
    return o;
}
