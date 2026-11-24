// Runtime recognition of the selected preset against the P1 preset library (DESIGN.md 7).
// The map in presets/preset-families.json is a compact copy of docs/ux-overhaul/presets/preset-families.json,
// written by compactFamilies(); tests/t_preset_switch.js fails when the two drift apart.

export const LIBRARY_SCHEMA = 'roleplay-instructions/preset-library@1';

// One label, starting side and one-line effect per feature. The starting sides follow decisions 6 and 7.
export const FEATURES = Object.freeze({
    style: { label: 'Writing style', start: 'theirs', ours: 'Sends the extension’s live writing guidance.' },
    preflight: { label: 'Continuity guidance', start: 'theirs', ours: 'Sends scene and character reminders with each reply.' },
    state: { label: 'Story state', start: 'ours', ours: 'Tracks the scene, time and date and draws the state cards.' },
    knowledge: { label: 'Character knowledge', start: 'theirs', ours: 'Keeps who knows what as records.' },
    emotions: { label: 'Emotions', start: 'ours', ours: 'Keeps each character’s emotion scales and draws the card.' },
    relationships: { label: 'Relationships', start: 'ours', ours: 'Keeps relationship records and draws the card.' },
    plots: { label: 'Story threads', start: 'theirs', ours: 'Keeps arcs, planted details and off-screen agendas.' },
    worldEvents: { label: 'Plot offers', start: 'theirs', ours: 'Offers an optional development by chance.' },
    dice: { label: 'Dice', start: 'ours', ours: 'Rolls in code and sends one verdict.' },
    colors: { label: 'Dialogue colors', start: 'ours', ours: 'Colors each speaker’s dialogue.' },
    roast: { label: 'Roast', start: 'theirs', ours: 'Writes a comic reaction to each reply.' },
    roastFeedback: { label: 'Roast feedback', start: 'theirs', ours: 'Sends the previous roast with the next request.' },
});
export const FEATURE_KEYS = Object.keys(FEATURES);
// Features the memory build records; the bulk switch "Theirs for everything except memory" leaves these on Ours.
export const MEMORY_FEATURES = Object.freeze(['state', 'knowledge', 'relationships', 'emotions', 'plots']);
export const startingSwitches = () => Object.fromEntries(FEATURE_KEYS.map(key => [key, FEATURES[key].start]));

// Host stock rows and the TauriTavern Agent rows never count toward recognition (P1 recognition rule).
const STOCK = new Set(['main', 'nsfw', 'jailbreak', 'chatHistory', 'worldInfoBefore', 'worldInfoAfter', 'enhanceDefinitions',
    'dialogueExamples', 'charDescription', 'charPersonality', 'scenario', 'personaDescription']);
const HOST_NAMES = new Set(['agent system prompt', 'agent task', 'agent results']);

/** Drop emoji from text the extension displays (decision of 23 November); matching never uses it. */
export const plainName = text => String(text ?? '').replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '').replace(/\s+/g, ' ').trim();

// SHA-256 in plain code, since crypto.subtle is missing on a phone that reaches SillyTavern over plain http.
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
    0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const length = bytes.length, total = ((length + 9 + 63) >> 6) << 6;
    const data = new Uint8Array(total);
    data.set(bytes); data[length] = 0x80;
    const view = new DataView(data.buffer);
    view.setUint32(total - 8, Math.floor(length / 0x20000000)); view.setUint32(total - 4, (length << 3) >>> 0);
    const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotate = (x, n) => (x >>> n) | (x << (32 - n));
    for (let offset = 0; offset < total; offset += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotate(w[i - 15], 7) ^ rotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotate(w[i - 2], 17) ^ rotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
            const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0; });
    }
    return [...hash].map(word => word.toString(16).padStart(8, '0')).join('');
}

/** The P1 block hash: NFC, CRLF to LF, whitespace runs to one space, trimmed, first 16 hex characters. */
export function blockHash(text) {
    const normal = String(text ?? '').normalize('NFC').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
    return normal ? sha256Hex(normal).slice(0, 16) : '';
}

const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
function compactModules(modules) {
    return Object.fromEntries(Object.entries(modules || {}).filter(([key]) => Object.hasOwn(FEATURES, key)).map(([key, item]) => [key,
        { verdict: item.verdict, ids: item.block_ids || [], rule: item.rule || '' }]));
}
const profileSummary = item => ({ name: item.preset, kind: item.kind, models: item.models || [], reasoning: item.reasoning || null,
    description: item.description || '', on: (item.toggles_on || []).map(row => row.id), off: (item.toggles_off || []).map(row => row.id) });

/** Reduce the P1 analyst map to what recognition and the Presets page read at run time. */
export function compactFamilies(full) {
    const editions = [];
    for (const family of full.families || []) for (const edition of family.editions || []) {
        const recognize = edition.recognize || {};
        editions.push({
            key: `${family.id}/${edition.id}`, family: family.id, familyLabel: family.label, label: edition.label,
            distinct: !!family.keep_distinct,
            recognize: { mode: recognize.mode, ids: recognize.ids || [], hashes: recognize.hashes || [], main: recognize.main_hash || null,
                own: recognize.own_ids || 0, ...pick({ twins: recognize.identical_to }, ['twins']) },
            modules: compactModules(edition.modules), optional: compactModules(edition.optional_modules),
            profiles: (edition.model_profiles || []).map(profileSummary), overrides: (edition.overrides || []).map(profileSummary),
        });
    }
    return { schema: LIBRARY_SCHEMA, source: 'docs/ux-overhaul/presets/preset-families.json', generated: full.generated, editions };
}

/** JSON with every character past ASCII escaped, so the shipped map holds no literal emoji. */
export const asciiJson = value => JSON.stringify(value).replace(/[\u{7F}-\u{10FFFF}]/gu,
    ch => [...Array(ch.length).keys()].map(i => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''));

let cached = null;
/** Fetch the shipped map once; a host that cannot serve it falls back to name matching. */
export function loadLibrary(url = new URL('../presets/preset-families.json', import.meta.url).href) {
    cached ||= fetch(url).then(response => response.ok ? response.json() : null).catch(() => null)
        .then(data => data?.schema === LIBRARY_SCHEMA ? data : null);
    return cached;
}
export const resetLibraryCache = () => { cached = null; };

/** Block rows of a preset object (prompts plus the global prompt order), with hashes. */
export function presetBlocks(data) {
    const order = data?.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order
        || data?.prompt_order?.[0]?.order || [];
    const flags = new Map(order.filter(row => row?.identifier).map(row => [row.identifier, row.enabled === true]));
    return (Array.isArray(data?.prompts) ? data.prompts : []).filter(block => block?.identifier).map(block => ({
        id: block.identifier, name: String(block.name || block.identifier), content: String(block.content || ''),
        marker: !!block.marker, listed: flags.has(block.identifier), enabled: flags.get(block.identifier) === true,
        hash: block.marker ? '' : blockHash(block.content),
    }));
}

/** Score a preset against every edition with the P1 rule; returns the best match at 0.5 or above, else null. */
export function recognize(data, library) {
    if (!library?.editions?.length) return null;
    const blocks = presetBlocks(data);
    const ids = new Set(blocks.filter(block => !STOCK.has(block.id) && !HOST_NAMES.has(block.name.toLowerCase())).map(block => block.id));
    const hashes = new Set(blocks.filter(block => block.hash).map(block => block.hash));
    const large = new Set(blocks.filter(block => block.hash && block.content.length > 40).map(block => block.hash));
    const share = (list, set) => list.length ? list.filter(item => set.has(item)).length / list.length : 0;
    let best = null;
    for (const edition of library.editions) {
        const r = edition.recognize;
        let score;
        if (r.mode === 'coverage-pair') score = (share(r.ids, ids) + share(r.hashes, large)) / 2;
        else score = Math.max(share(r.ids, ids), share(r.hashes, hashes), r.main && hashes.has(r.main) ? 1 : 0);
        const tiebreak = Math.min(ids.size, r.own) / Math.max(ids.size, r.own, 1) / 1000;
        const total = Math.round(score * 1000) / 1000 + tiebreak;
        if (!best || total > best.total) best = { edition, score: Math.round(score * 1000) / 1000, total };
    }
    return best && best.score >= 0.5 ? { edition: best.edition, score: best.score } : null;
}

const VERDICT_CHIP = { duplicative: 'Duplicate', contradictory: 'Conflict' };
export const verdictChip = verdict => VERDICT_CHIP[verdict] || '';

/**
 * The features both sides offer for one preset. A recognised edition lists its duplicate and conflicting modules
 * (and switched-off optional ones when she turned their blocks on); complementary blocks go to Works alongside.
 * An unrecognised preset falls back to the name tables through nameMatch(block) and is marked "Matched by block name".
 */
export function presetFeatures(blocks, edition, nameMatch = () => []) {
    const byId = new Map(blocks.map(block => [block.id, block]));
    const switched = [], alongside = [];
    if (edition) {
        for (const key of FEATURE_KEYS) {
            const main = edition.modules?.[key];
            const optional = edition.optional?.[key];
            const present = ids => (ids || []).map(id => byId.get(id)).filter(Boolean);
            const mainBlocks = present(main?.ids);
            const optionalBlocks = present(optional?.ids).filter(block => block.enabled);
            const item = main && mainBlocks.length ? { ...main, blocks: mainBlocks } : optional && optionalBlocks.length ? { ...optional, blocks: optionalBlocks } : null;
            if (!item) continue;
            const row = { key, label: FEATURES[key].label, verdict: item.verdict, rule: item.rule, blocks: item.blocks, matchedBy: 'library' };
            (item.verdict === 'complementary' ? alongside : switched).push(row);
        }
        return { switched, alongside };
    }
    const grouped = new Map();
    for (const block of blocks) if (!block.marker) for (const key of nameMatch(block)) {
        if (!Object.hasOwn(FEATURES, key)) continue;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(block);
    }
    for (const key of FEATURE_KEYS) if (grouped.has(key)) {
        switched.push({ key, label: FEATURES[key].label, verdict: 'duplicative', rule: '', blocks: grouped.get(key), matchedBy: 'name' });
    }
    return { switched, alongside };
}

/** The model profile whose model tags match the selected model, if any. */
export function activeProfile(edition, model) {
    const name = String(model || '').toLowerCase();
    if (!edition || !name) return null;
    return edition.profiles.find(profile => profile.models.some(tag => name.includes(String(tag).toLowerCase()))) || null;
}
