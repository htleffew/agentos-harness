// Undercurrent 2: model family detection (content.models[].match against the connected model id) and reasoning mode.
// Pure.

const reCache = new Map();
function toRegExp(pattern) {
    const key = String(pattern);
    if (reCache.has(key)) return reCache.get(key);
    let re;
    try { re = new RegExp(key, 'i'); } catch { re = null; }
    reCache.set(key, re);
    return re;
}

/**
 * Family id for a model id. First content model whose `match` patterns hit wins; else 'generic' (when declared) or ''.
 * @param {string} modelId
 * @param {object[]} models content.models
 */
export function detectFamily(modelId, models) {
    const id = String(modelId ?? '').trim();
    const list = Array.isArray(models) ? models : [];
    if (id) {
        for (const m of list) {
            const pats = Array.isArray(m?.match) ? m.match : (m?.match ? [m.match] : []);
            for (const p of pats) {
                const re = toRegExp(p);
                if (re ? re.test(id) : id.toLowerCase().includes(String(p).toLowerCase())) return String(m.id);
            }
        }
    }
    return list.some(m => m?.id === 'generic') ? 'generic' : '';
}

/** The effective family: a setting value other than 'auto'/'' overrides detection. */
export function resolveFamily(setting, modelId, models) {
    const s = String(setting ?? '').trim();
    if (s && s !== 'auto' && (Array.isArray(models) ? models : []).some(m => m?.id === s)) return s;
    return detectFamily(modelId, models);
}

const NATIVE_HINT = /(?:^|[-_/.:\s])(?:r1|reasoner|reasoning|thinking|think)(?:$|[-_/.:\s])/i;

/**
 * Reasoning mode for uc_think: 'native' | 'prompted' | 'off'.
 * setting 'auto' → native when the model id matches the family's `reasoning_match` (e.g. a ":thinking" variant), else
 * the family's `reasoning`; a family marked 'auto' is native when the id looks like a reasoning variant.
 */
export function reasoningMode(setting, family, modelId, models) {
    const s = String(setting ?? 'auto');
    if (s === 'native' || s === 'prompted' || s === 'off') return s;
    const fam = (Array.isArray(models) ? models : []).find(m => m?.id === family);
    const id = String(modelId ?? '');
    for (const p of Array.isArray(fam?.reasoning_match) ? fam.reasoning_match : []) {
        const re = toRegExp(p);
        if (re && re.test(id)) return 'native';
    }
    const r = String(fam?.reasoning ?? 'auto');
    if (r === 'native' || r === 'prompted' || r === 'off') return r;
    return NATIVE_HINT.test(id) ? 'native' : 'prompted';
}
