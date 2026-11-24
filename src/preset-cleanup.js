// Preset cleanup (DESIGN.md 7, ticket B18): retire the 14 exact copies and collapse each group of Evening Truth
// presets that differ only in context size into one preset, after a backup of every Chat Completion preset.
// The plan, the backup and the restore are plain functions over a preset manager, so a fixture library tests them
// without a host. Nothing here runs by itself: the page calls applyCleanup only after her confirmation.
import { sha256Hex, plainName } from './preset-library.js';
import { readMarker, MARKER_KEY } from './preset-loadouts.js';

export const BACKUP_SCHEMA = 'roleplay-instructions/preset-backup@1';
export const CONTEXT_FIELD = 'openai_max_context';

/**
 * The 14 copies of P1: [copy, base, edition key]. A copy has the base's prompt blocks and sampler values and differs
 * only in the context size it saved. Names are the host preset names; two of them carry emoji in the host, so they are listed without it and matched by their plain text.
 */
export const COPIES = Object.freeze([
    ['Atelier 2.1', 'universal - Atelier 2.1', 'atelier/2.1'],
    ['DEUS EX MACHINA V2.5 ST', 'universal - DEUS EX MACHINA V2.5 ST', 'deus-ex-machina/v2.5'],
    ['eval-v1-sillytavern-preset', 'universal - eval-v1-sillytavern-preset', 'eval/v1'],
    ['Floris', 'universal - Floris', 'floris/main'],
    ['Lucid Loom v3.3', 'universal - Lucid Loom v3.3', 'lucid-loom/v3.3'],
    ['luehn9', 'universal - luehn9', 'luehn9/main'],
    ['Simulator Engine v1.0', 'universal - Simulator Engine v1.0', 'simulator-engine/1.0'],
    ['StoryWeaver v1.1', 'universal - StoryWeaver v1.1', 'storyweaver/1.1'],
    ['universal - Nemo Vivarium v1.0 Beta', 'Nemo Vivarium v1.0 Beta', 'nemo-vivarium/1.0-beta'],
    ['voyage-v5-1-sillytavern-preset', 'universal - voyager v5.1', 'voyager/5.1'],
    ['white-lotus-glmkimideepseekgemma', 'universal - white-lotus-latest', 'white-lotus/latest'],
    ['Writer\'s Block Unlimited Version 2', 'universal - Writer\'s Block Unlimited v2', 'writers-block/v2'],
    ['LE_EMOTIONALISM! Version 1.1.5', 'universal - LE_EMOTIONALISM! Version 1.1.5', 'le-emotionalism/1.1.5'],
    ['Sola V3 Flame', 'universal - Sola V3 Flame', 'sola/v3-flame'],
]);

// Fields that record where a preset was last saved or how its connection behaves; they say nothing about what the preset sends, so
// they never decide whether two presets match (P1 method). The three TauriTavern Agent rows are host rows and are left out too.
const CONNECTION = /(_model$|_models$|_models_by_source$|^chat_completion_source$|^reverse_proxy$|^proxy_password$|^custom_|^additional_parameters|^vertexai_|^workers_ai_|^azure_|^aws_bedrock_|^openrouter_|^nanogpt_|^opencode_|^pollinations_|^siliconflow_|^electronhub_|^chutes_|_endpoint$|^bias_presets$|^show_external_models$|^bypass_status_check$)/;
// Image and video attachment handling: not a sampler, so it does not decide a match; a retired preset's differing value is kept in its profile.
const SOFT = /^(inline_image_quality|image_inlining|video_inlining|media_inlining|request_image_.*)$/;
const AGENT_ROWS = new Set(['agent system prompt', 'agent task', 'agent results']);
const MODEL_TAGS = /deepseek|glm|gemini|gemma|kimi|mimo|qwen|minimax|mistral|mixtral/gi;

/** Evening Truth by file name: `ET` as an upper-case token, or "evening truth" with any run of spaces, hyphens or underscores. */
export const isEveningTruth = name => /(^|[^A-Za-z0-9])ET([^A-Za-z0-9]|$)/.test(String(name)) || /evening[\s_-]*truth/i.test(String(name));

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
/** JSON with sorted keys, so equal content compares equal whatever order the keys were saved in. */
export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort(compare).filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}

/** SHA-256 hex; the host's own digest when the page may use it, plain code otherwise (a phone on plain http). */
export async function digest(text) {
    const subtle = globalThis.crypto?.subtle;
    if (subtle && globalThis.isSecureContext !== false) {
        try {
            const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
            return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        } catch { /* fall through */ }
    }
    return sha256Hex(text);
}

/** Every preset of the manager's list as { name, data }, sorted by name. */
export function entriesOf(manager) {
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    if (!names) return [];
    const pairs = Array.isArray(names) ? names.map((name, index) => [name, index]) : Object.entries(names);
    return pairs.map(([name, index]) => ({ name, data: list.presets?.[index] })).filter(entry => entry.data && typeof entry.data === 'object')
        .sort((a, b) => compare(a.name, b.name));
}

/** One digest of the whole library: names and canonical content. */
export const libraryHash = entries => digest(canonical([...entries].sort((a, b) => compare(a.name, b.name)).map(entry => [entry.name, entry.data])));

export const contextOf = data => data?.[CONTEXT_FIELD] !== null && data?.[CONTEXT_FIELD] !== '' && Number.isFinite(Number(data?.[CONTEXT_FIELD])) ? Number(data[CONTEXT_FIELD]) : null;

const normal = text => String(text ?? '').normalize('NFC').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
const globalOrder = data => data?.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order || data?.prompt_order?.[0]?.order || [];
/** The blocks a preset sends in send order: id, text, role, placement and the on flag, without the host Agent rows. */
function blocksOf(data) {
    const prompts = (Array.isArray(data?.prompts) ? data.prompts : []).filter(block => block?.identifier);
    const agent = new Set(prompts.filter(block => AGENT_ROWS.has(String(block.name || '').toLowerCase())).map(block => block.identifier));
    const order = globalOrder(data).filter(row => row?.identifier && !agent.has(row.identifier));
    const enabled = new Map(order.map(row => [row.identifier, row.enabled === true]));
    return canonical([order.map(row => [row.identifier, row.enabled === true]),
        prompts.filter(block => !agent.has(block.identifier)).map(block => [block.identifier, normal(block.content), block.role, block.injection_position,
            block.injection_depth, block.injection_order, block.marker === true, block.system_prompt === true, enabled.get(block.identifier) ?? null])
            .sort((a, b) => compare(a[0], b[0]))]);
}
const extensionsOf = data => {
    const copy = { ...(data?.extensions && typeof data.extensions === 'object' ? data.extensions : {}) };
    const own = copy[MARKER_KEY];
    if (own && typeof own === 'object') {
        const { modelProfiles, ...rest } = own;
        if (Object.keys(rest).length) copy[MARKER_KEY] = rest; else delete copy[MARKER_KEY];
    }
    return canonical(copy);
};
const SKIP = new Set([CONTEXT_FIELD, 'name', 'prompts', 'prompt_order', 'extensions']);

/**
 * True when two presets send the same blocks in the same order with the same regex scripts and extension data, and every
 * sampler field both files carry has the same value. The context size, the connection each was last saved on and fields only
 * one file's host version writes do not count (P1: "same prompt blocks, only the context size differs").
 */
export function sameBesidesContext(a, b) {
    if (blocksOf(a) !== blocksOf(b) || extensionsOf(a) !== extensionsOf(b)) return false;
    for (const key of Object.keys(a || {})) {
        if (SKIP.has(key) || CONNECTION.test(key) || SOFT.test(key) || !(key in (b || {}))) continue;
        if (canonical(a[key]) !== canonical(b[key])) return false;
    }
    return true;
}

const modelTags = name => [...new Set((String(name).match(MODEL_TAGS) || []).map(tag => tag.toLowerCase()))];
const keyOf = name => plainName(name).toLowerCase();

/** The stored context-size profiles of a preset (extension data), as written by cleanup. */
export function storedProfiles(data) {
    const list = data?.extensions?.[MARKER_KEY]?.modelProfiles;
    return Array.isArray(list) ? list.filter(item => item && typeof item === 'object' && typeof item.id === 'string') : [];
}

/** The stored profile that follows a model: a name tag match, the preset's own current one first. */
export function profileForModel(data, model) {
    const name = String(model || '').toLowerCase();
    if (!name) return null;
    const matches = storedProfiles(data).filter(item => (item.models || []).some(tag => name.includes(String(tag).toLowerCase())));
    return matches.find(item => item.current) || matches[0] || null;
}

/** Attachment settings of a retired preset that differ from the survivor's, kept so the profile holds them. */
function softDifferences(data, survivor) {
    const out = {};
    for (const key of Object.keys(data || {})) if (SOFT.test(key) && key in (survivor || {}) && canonical(data[key]) !== canonical(survivor[key])) out[key] = data[key];
    return out;
}
const profileFor = (name, data, survivor = null, { current = false } = {}) => {
    const settings = survivor ? softDifferences(data, survivor) : {};
    return { id: `ctx-${keyOf(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'preset'}-${sha256Hex(name).slice(0, 6)}`, kind: 'context-size', label: plainName(name) || name,
        from: name, models: modelTags(name), contextSize: contextOf(data), ...(Object.keys(settings).length ? { settings } : {}), ...(current ? { current: true } : {}) };
};

/**
 * The cleanup as a list of things to show and then do. entries is entriesOf(manager); protectedNames maps a preset
 * name to the reason it must stay (a Connection Manager profile uses it). Loadouts built on a preset protect it too.
 */
export function planCleanup(entries, { protectedNames = new Map() } = {}) {
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    const byPlain = new Map(entries.map(entry => [keyOf(entry.name), entry]));
    const find = name => byName.get(name) || byPlain.get(keyOf(name)) || null;
    const protectedBy = new Map(protectedNames);
    for (const entry of entries) {
        const marker = readMarker(entry.data);
        if (marker?.base && !protectedBy.has(marker.base)) protectedBy.set(marker.base, `the loadout ${entry.name} is built on it`);
    }
    const copies = COPIES.map(([copyName, baseName, edition]) => {
        const copy = find(copyName), base = find(baseName);
        const row = { edition, copy: copy?.name || copyName, base: base?.name || baseName, copyContext: contextOf(copy?.data), baseContext: contextOf(base?.data) };
        if (!copy) return { ...row, state: 'gone', note: 'Not in the library.' };
        if (!base) return { ...row, state: 'no-base', note: 'Its base is not in the library, so it stays.' };
        if (!sameBesidesContext(copy.data, base.data)) return { ...row, state: 'differs', note: 'It no longer matches its base apart from the context size, so it stays.' };
        const reason = protectedBy.get(copy.name);
        if (reason) return { ...row, state: 'kept', note: `Stays because ${reason}.` };
        return { ...row, state: 'ready', note: '' };
    });
    // The author's own file name (`ET-...`) is the keeper, then the shortest name; each other member must match it besides context size.
    const rank = entry => [/^ET(?![A-Za-z0-9])/.test(entry.name) ? 0 : 1, entry.name.length, entry.name];
    const order = (a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || compare(x[2], y[2]); };
    const pool = entries.filter(entry => isEveningTruth(entry.name)).sort(order);
    const taken = new Set(), groups = [];
    for (const keeper of pool) {
        if (taken.has(keeper.name)) continue;
        const sorted = [keeper, ...pool.filter(entry => entry !== keeper && !taken.has(entry.name) && sameBesidesContext(keeper.data, entry.data))];
        if (sorted.length < 2) continue;
        const rows = sorted.map(entry => ({ name: entry.name, context: contextOf(entry.data), keeper: entry === keeper,
            kept: entry !== keeper && protectedBy.has(entry.name) ? `Stays because ${protectedBy.get(entry.name)}.` : '' }));
        for (const entry of sorted) taken.add(entry.name);
        if (rows.filter(row => !row.kept).length < 2) continue;
        groups.push({ keeper: keeper.name, members: rows, label: plainName(keeper.name) });
    }
    groups.sort((a, b) => compare(a.keeper, b.keeper));
    const ready = copies.filter(item => item.state === 'ready');
    const retired = groups.reduce((sum, group) => sum + group.members.filter(row => !row.keeper && !row.kept).length, 0);
    return { copies, groups, copyCount: ready.length, groupCount: groups.length, groupRetired: retired,
        label: `Retire ${ready.length} cop${ready.length === 1 ? 'y' : 'ies'}, merge ${groups.length} ET group${groups.length === 1 ? '' : 's'}`,
        empty: !ready.length && !groups.length };
}

/** The same plan as a short string, so a confirmed plan can be compared with the library at apply time. */
export const planKey = plan => canonical([plan.copies.filter(item => item.state === 'ready').map(item => [item.copy, item.base, item.copyContext]),
    plan.groups.map(group => [group.keeper, group.members.map(row => [row.name, row.context, row.kept])])]);

// ---- Backup ----

const pad = value => String(value).padStart(2, '0');
/** The one backup file of every Chat Completion preset. */
export async function buildBackup(entries, now = new Date()) {
    const list = [...entries].sort((a, b) => compare(a.name, b.name));
    const hash = await libraryHash(list);
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const data = { schema: BACKUP_SCHEMA, created: now.toISOString(), count: list.length, libraryHash: hash, presets: list.map(entry => ({ name: entry.name, data: entry.data })) };
    return { name: `roleplay-instructions-presets-backup-${stamp}.json`, text: JSON.stringify(data), count: list.length, libraryHash: hash, created: data.created };
}

/** Read a backup file's text; throws a plain sentence when it is not one or its content no longer matches its digest. */
export async function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('That file is not a preset backup.'); }
    if (data?.schema !== BACKUP_SCHEMA || !Array.isArray(data.presets)) throw new Error('That file is not a Roleplay Instructions preset backup.');
    const entries = data.presets.filter(item => item && typeof item.name === 'string' && item.data && typeof item.data === 'object');
    if (entries.length !== data.presets.length || entries.length !== data.count) throw new Error('The backup file is damaged: its preset count does not match.');
    if (await libraryHash(entries) !== data.libraryHash) throw new Error('The backup file is damaged: its content does not match its digest.');
    return { entries, count: entries.length, libraryHash: data.libraryHash, created: data.created };
}

// ---- Writing to the host ----

function slot(manager, name) {
    const list = manager?.getPresetList?.();
    const names = list?.preset_names;
    if (!names) return null;
    const index = Array.isArray(names) ? names.indexOf(name) : names[name];
    return index === undefined || index < 0 ? null : { list, index };
}

function addToList(manager, name, data) {
    const list = manager.getPresetList();
    list.presets.push(data);
    const value = list.presets.length - 1;
    if (Array.isArray(list.preset_names)) list.preset_names[value] = name; else list.preset_names[name] = value;
    // SillyTavern keeps `select` as a jQuery object; a test host may give a selector string.
    const found = typeof manager.select === 'string' ? globalThis.document?.querySelector?.(manager.select) : manager.select?.[0] ?? manager.select;
    const select = found && typeof found.append === 'function' ? found : null;
    if (select) {
        const option = globalThis.document.createElement('option');
        option.value = Array.isArray(list.preset_names) ? name : String(value);
        option.textContent = name;
        select.append(option);
    }
}

/** Save a preset under its name without selecting it, and keep the host's in-memory list in step with the file. */
async function writePreset(manager, name, data) {
    await manager.savePreset(name, data, { skipUpdate: true });
    const found = slot(manager, name);
    if (!found) { addToList(manager, name, structuredClone(data)); return 'created'; }
    const target = found.list.presets[found.index];
    if (target && typeof target === 'object') { for (const key of Object.keys(target)) delete target[key]; Object.assign(target, structuredClone(data)); }
    else found.list.presets[found.index] = structuredClone(data);
    return 'rewritten';
}

async function leaveSelection(manager, doomed, plan) {
    const selected = manager.getSelectedPresetName?.();
    if (!selected || !doomed.has(selected)) return;
    const survivor = plan.get(selected);
    const value = manager.findPreset?.(survivor);
    if (value !== undefined && value !== null && manager.selectPreset) await manager.selectPreset(value);
}

/**
 * Carry out a confirmed plan. The backup must be of this very library (its digest equals the library's now), and the
 * plan must be the one she saw. Survivors are written first; copies and group members are deleted only after every
 * write succeeded.
 */
export async function applyCleanup(manager, confirmedKey, backup, { protectedNames = new Map() } = {}) {
    const entries = entriesOf(manager);
    if (!backup?.libraryHash) throw new Error('Back up the presets first.');
    if (await libraryHash(entries) !== backup.libraryHash) throw new Error('The presets changed after the backup. Back them up again before cleaning up.');
    const plan = planCleanup(entries, { protectedNames });
    if (planKey(plan) !== confirmedKey) throw new Error('The list changed since you reviewed it. Review the new list and confirm again.');
    const byName = new Map(entries.map(entry => [entry.name, entry]));
    const writes = new Map(), doomed = new Map();
    const survivor = name => writes.get(name) || structuredClone(byName.get(name).data);
    const addProfile = (name, profile) => {
        const data = survivor(name);
        data.extensions = data.extensions && typeof data.extensions === 'object' ? data.extensions : {};
        const own = { ...(data.extensions[MARKER_KEY] || {}) };
        own.modelProfiles = [...storedProfiles(data).filter(item => item.id !== profile.id), profile];
        data.extensions[MARKER_KEY] = own;
        writes.set(name, data);
    };
    for (const item of plan.copies.filter(row => row.state === 'ready')) {
        addProfile(item.base, profileFor(item.copy, byName.get(item.copy).data, byName.get(item.base).data));
        doomed.set(item.copy, item.base);
    }
    for (const group of plan.groups) {
        addProfile(group.keeper, profileFor(group.keeper, byName.get(group.keeper).data, null, { current: true }));
        for (const row of group.members) if (!row.keeper && !row.kept) {
            addProfile(group.keeper, profileFor(row.name, byName.get(row.name).data, byName.get(group.keeper).data));
            doomed.set(row.name, group.keeper);
        }
    }
    for (const [name, data] of writes) await writePreset(manager, name, data);
    await leaveSelection(manager, new Set(doomed.keys()), doomed);
    const failed = [];
    for (const name of doomed.keys()) {
        let ok = false;
        try { ok = await manager.deletePreset(name) !== false; } catch { ok = false; }
        if (!ok) failed.push(name);
    }
    return { plan, profilesWritten: writes.size, retired: [...doomed.keys()].filter(name => !failed.includes(name)), failed };
}

/** What a restore would do to the current library. */
export function restoreDiff(entries, backupEntries) {
    const current = new Map(entries.map(entry => [entry.name, entry]));
    const recreate = [], rewrite = [], same = [];
    for (const item of backupEntries) {
        const now = current.get(item.name);
        if (!now) recreate.push(item.name);
        else if (canonical(now.data) !== canonical(item.data)) rewrite.push(item.name);
        else same.push(item.name);
    }
    const kept = new Set(backupEntries.map(item => item.name));
    return { recreate, rewrite, same, added: entries.filter(entry => !kept.has(entry.name)).map(entry => entry.name) };
}

/**
 * Put every preset of a parsed backup back as it was: deleted presets are recreated and changed ones rewritten.
 * Presets made after the backup are left alone and counted.
 */
export async function restoreBackup(manager, backup) {
    const diff = restoreDiff(entriesOf(manager), backup.entries);
    const byName = new Map(backup.entries.map(item => [item.name, item]));
    for (const name of [...diff.recreate, ...diff.rewrite]) await writePreset(manager, name, byName.get(name).data);
    const after = entriesOf(manager).filter(entry => byName.has(entry.name));
    const exact = await libraryHash(after) === backup.libraryHash;
    return { recreated: diff.recreate.length, rewritten: diff.rewrite.length, unchanged: diff.same.length, added: diff.added, exact };
}

// ---- Protected names ----

/** Preset names a Connection Manager profile saved, which a retired preset would leave dangling. */
export function profileProtections(host) {
    const out = new Map();
    const profiles = host?.extensionSettings?.connectionManager?.profiles;
    if (Array.isArray(profiles)) for (const profile of profiles) if (profile?.preset && !out.has(profile.preset)) {
        out.set(profile.preset, `the connection profile ${profile.name || 'unnamed'} uses it`);
    }
    return out;
}
