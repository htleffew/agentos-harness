import { canonSet, editSet, entriesOf, knownSets, loadSet, readInstruction, rollInt, setInfo, toEdit, writeInstruction } from './books.js';
import { eventChoices, isEvent, isStyle, newId, readEvent, rollEvent, withPreset, writeEvent } from './events.js';
import { MOD_MAX, MOD_MIN, outcome, sheet } from './dice.js';
import { countPresent, worldOffers } from './pacing.js';
import { blockedEventTags } from './state.js';
import { ctx, KEY, names } from './st.js';
import { chatState, FORMS, pronounForms, saveSettings, settings } from './store.js';
import { chatWorld, DONE, isWorldEntry, listWorld, readScene, readWorldEntry, WORLD_KINDS } from './world.js';
import { loadEffectiveWorld } from './worldflow.js';

export const QUICK_ACTION_FAMILIES = {
    steer: { name: 'Steer the next reply', add: 'Add nudge' },
    swipe: { name: 'Guide a swipe', add: 'Add swipe option' },
    continue: { name: 'Continue this reply', add: 'Add continuation option' },
    draft: { name: 'Draft my reply', add: 'Add player draft option' },
};

export const QUICK_ACTION_VARIABLES = {
    user: 'Player name',
    char: 'Character name',
    persona: 'Player description',
    card: 'Character description',
    scenario: 'Card scenario',
    direction: 'Direction supplied when used',
    seed: 'Selected planted detail',
    secret: 'Selected secret cue',
    thread: 'Selected thread',
    twist: 'Selected twist',
    instruction: 'Selected instruction',
    style: 'Selected writing style',
    event: 'Selected story event',
    roll: 'Recorded die result',
};
export const QUICK_ACTION_TWISTS = ['Revelation', 'Reversal', 'Interruption', 'Misunderstanding', 'Unexpected arrival'];

const revision = 1;
const clone = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && /^[\w:.~-]{1,160}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const content = value => String(value ?? '');
const textKey = text => content(text).replace(/\s+/g, ' ').trim().toLowerCase();
const defaultDelivery = { visibility: 'private', required: false };

const sharedDirections = [
    ['emotional', 'More emotional', 'Let the responding character show what they feel through what they say and do.'],
    ['romantic', 'More romantic', 'Let the responding character express attraction or affection in a way that fits their relationship.'],
    ['conflict', 'Bring in conflict', 'Have a character pursue a goal that pushes against someone else’s immediate goal.'],
    ['twist', 'Add a plot twist', 'Introduce a concrete development that changes what the characters can do next.'],
    ['character', 'Back to character', 'Ground the responding character’s choices and speech in their card and established behavior.'],
    ['fix-facts', 'Fix world facts', 'Apply the established facts and show how they affect the characters’ choices.'],
];

const builtIn = (family, key, title, text, extra = {}) => ({
    id: 'builtin:' + family + ':' + key, family, title, text, category: '', delivery: { ...defaultDelivery },
    origin: 'built-in', templateRevision: revision, enabled: true, ...extra,
});
const builtinActions = [
    builtIn('steer', 'dress-me', 'Dress me', 'Describe the outfit {{user}} wears for this scene. Use the occasion and their established taste.'),
    ...['swipe', 'continue'].flatMap(family => sharedDirections.map(([key, title, text]) =>
        builtIn(family, key, title, text, key === 'fix-facts' ? { operation: 'repair' } : {}))),
    builtIn('draft', 'natural', 'Respond naturally as me', 'Write a response that fits how I have spoken and acted so far.'),
    builtIn('draft', 'bold', 'Do something bold', 'Give me a decisive action that puts something I care about at stake.'),
    builtIn('draft', 'npc', 'Introduce an NPC', 'Have me introduce someone through what I can say or do in this scene.'),
    builtIn('draft', 'intimate-start', 'Initiate an intimate moment', 'Give me an invitation that fits our relationship and leaves room for their response.'),
    builtIn('draft', 'intimate-continue', 'Continue an intimate moment', 'Show how I choose to respond to the intimacy already present.'),
    builtIn('draft', 'twist', 'Introduce a plot twist', 'Give me a revelation or action within my knowledge that changes what I can do next.', { twistTypes: QUICK_ACTION_TWISTS }),
    builtIn('draft', 'drama', 'Make it more dramatic', 'Raise the stakes of my next choice through what I can plausibly say or do.'),
];
const builtinById = new Map(builtinActions.map(action => [action.id, action]));

export function actionLibrary() {
    const cfg = settings();
    cfg.quickActions = object(cfg.quickActions) ? cfg.quickActions : {};
    const library = cfg.quickActions;
    library.version ??= revision;
    library.actions = object(library.actions) ? library.actions : {};
    library.order = Array.isArray(library.order) ? library.order : [];
    library.imports = Array.isArray(library.imports) ? library.imports : [];
    return library;
}

function actionFields(data) {
    const delivery = object(data.delivery) ? data.delivery : {};
    const extra = {};
    if (object(data.source)) extra.source = clone(data.source);
    if (Array.isArray(data.twistTypes)) extra.twistTypes = data.twistTypes.map(content).map(type => type.trim()).filter(Boolean);
    if (data.requiresDirection) extra.requiresDirection = true;
    if (data.literalMacros) extra.literalMacros = true;
    return {
        title: content(data.title).trim(),
        text: content(data.text),
        category: content(data.category).trim(),
        enabled: data.enabled !== false,
        hidden: !!data.hidden,
        delivery: { visibility: delivery.visibility === 'visible' ? 'visible' : 'private', required: !!delivery.required },
        ...extra,
    };
}

function publicAction(id, saved) {
    const shipped = builtinById.get(id);
    if (!shipped && !saved) return null;
    const base = saved?.baseline || actionFields(shipped || saved);
    const current = { ...actionFields(shipped || saved), ...(saved || {}) };
    const fields = actionFields(current);
    const changed = [...new Set([...Object.keys(fields), ...Object.keys(base)])].some(key => JSON.stringify(fields[key]) !== JSON.stringify(base[key]));
    const updated = shipped && saved && saved.baselineRevision < shipped.templateRevision;
    const origin = shipped?.origin || current.origin;
    return {
        ...current,
        id,
        family: shipped?.family || current.family,
        origin,
        operation: shipped?.operation || (current.origin === 'translated' && current.operation === 'queue' ? 'queue' : ''),
        baseline: clone(base),
        variations: clone(current.variations || []),
        changed,
        status: updated ? 'Updated default available' : changed ? 'Customized'
            : ({ 'built-in': 'Default', translated: 'Imported', imported: 'Imported', linked: 'Follows source' }[origin] || 'First saved version'),
    };
}

export function readQuickAction(id) {
    if (!validId(id)) return null;
    return publicAction(id, actionLibrary().actions[id]);
}

export function listQuickActions(family = '', { includeHidden = false } = {}) {
    const library = actionLibrary();
    const ids = [...new Set([...library.order, ...builtinById.keys(), ...Object.keys(library.actions)])];
    return ids.map(readQuickAction).filter(action => action && (!family || action.family === family)
        && (includeHidden || (action.enabled && !action.hidden && !action.removed)));
}

function snapshotLibrary(state, label) {
    const { actions, order, imports } = state;
    state.undo = { id: newId(), label, actions: clone(actions), order: clone(order), imports: clone(imports) };
}

function updateLibrary(label, update) {
    const library = actionLibrary();
    snapshotLibrary(library, label);
    const result = update(library);
    saveSettings();
    return result;
}

export function undoQuickActionLibrary() {
    const library = actionLibrary();
    const undo = library.undo;
    if (!undo) return false;
    Object.assign(library, { actions: undo.actions, order: undo.order, imports: undo.imports });
    delete library.undo;
    saveSettings();
    return true;
}

function writeAction(library, data, previous, id) {
    const fields = actionFields(data);
    const family = previous?.family || data.family;
    if (!Object.hasOwn(QUICK_ACTION_FAMILIES, family)) throw new Error('Choose a quick action destination.');
    if (!fields.title || (!fields.text.trim() && !fields.source && data.operation !== 'queue')) {
        throw new Error('Enter a button name and a direction.');
    }
    const item = {
        ...fields, family, id, origin: previous?.origin || data.origin || 'standalone',
        baseline: clone(previous?.baseline || fields),
        baselineRevision: previous?.baselineRevision ?? builtinById.get(id)?.templateRevision ?? revision,
        variations: clone(previous?.variations || []),
    };
    if (data.operation === 'queue' && item.origin === 'translated') item.operation = 'queue';
    if (previous?.removed) item.removed = true;
    library.actions[id] = item;
    return publicAction(id, item);
}

export function saveQuickAction(data) {
    const previous = readQuickAction(data.id);
    const id = previous?.id || ('action:' + newId());
    const merged = { ...previous, ...data };
    // Validate before replacing the previous Undo record.
    const draft = { actions: {} };
    writeAction(draft, merged, previous, id);
    return updateLibrary(previous ? 'Edit button' : 'Add button', library => {
        library.actions[id] = draft.actions[id];
        return publicAction(id, library.actions[id]);
    });
}

export function removeQuickAction(id) {
    const current = readQuickAction(id);
    if (!current) return false;
    return updateLibrary('Remove button', library => {
        if (builtinById.has(id)) writeAction(library, { ...current, hidden: true }, current, id);
        else library.actions[id] = { ...library.actions[id], removed: true };
        return true;
    });
}

export function recoverQuickAction(id) {
    const current = readQuickAction(id);
    if (!current) return false;
    return updateLibrary('Recover button', library => {
        writeAction(library, { ...current, hidden: false }, current, id);
        delete library.actions[id].removed;
        return true;
    });
}

export function restoreQuickAction(id) {
    const current = readQuickAction(id);
    if (!current) return false;
    return updateLibrary('Restore button', library => {
        restoreAction(library, current);
        return true;
    });
}

function restoreAction(library, current) {
    const shipped = builtinById.get(current.id);
    const base = shipped ? actionFields(shipped) : current.baseline;
    const previous = { ...current, baseline: base, baselineRevision: shipped?.templateRevision ?? current.baselineRevision };
    writeAction(library, { ...base, operation: current.operation }, previous, current.id);
}

export function quickActionRestorePreview(family = '', layout = false) {
    const scope = listQuickActions(family, { includeHidden: true });
    return {
        restore: scope.filter(action => action.origin === 'built-in'),
        archive: layout ? scope.filter(action => action.origin !== 'built-in' && !action.removed) : [],
    };
}

export function restoreQuickActionLibrary(family = '', { layout = false } = {}) {
    const preview = quickActionRestorePreview(family, layout);
    return updateLibrary('Restore library', library => {
        for (const action of preview.restore) restoreAction(library, action);
        for (const action of preview.archive) library.actions[action.id].removed = true;
        if (layout) library.order = library.order.filter(id => family && readQuickAction(id)?.family !== family);
        return preview;
    });
}

export function moveQuickAction(id, offset) {
    const action = readQuickAction(id);
    if (!action) return false;
    const siblingIds = listQuickActions(action.family, { includeHidden: true }).filter(sibling => !sibling.removed).map(sibling => sibling.id);
    const index = siblingIds.indexOf(id);
    const destination = index + Math.sign(offset);
    if (index < 0 || destination < 0 || destination >= siblingIds.length || destination === index) return false;
    [siblingIds[index], siblingIds[destination]] = [siblingIds[destination], siblingIds[index]];
    return updateLibrary('Reorder buttons', library => {
        const others = library.order.filter(key => !siblingIds.includes(key));
        library.order = [...others, ...siblingIds];
        return true;
    });
}

export function saveQuickActionVariation(id, name, values) {
    const current = readQuickAction(id);
    name = content(name).trim();
    if (!current || !name) throw new Error('Enter a variation name.');
    const variant = { name, fields: actionFields({ ...current, ...values }) };
    if (!variant.fields.title || (!variant.fields.text.trim() && !variant.fields.source && current.operation !== 'queue')) {
        throw new Error('Enter a button name and a direction.');
    }
    return updateLibrary('Save variation', library => {
        writeAction(library, current, current, id);
        library.actions[id].variations = [...current.variations.filter(value => value.name !== name), variant];
        return variant;
    });
}

export function applyQuickActionVariation(id, name) {
    const current = readQuickAction(id);
    const variant = current?.variations.find(value => value.name === name);
    return variant ? saveQuickAction({ ...variant.fields, id }) : null;
}

export function quickActionFingerprint(value) {
    let fingerprint = 2166136261;
    for (const character of JSON.stringify(value) || '') {
        fingerprint = Math.imul(fingerprint ^ character.codePointAt(0), 16777619);
    }
    return (fingerprint >>> 0).toString(36);
}

const groups = { instructions: 'Instructions', events: 'Story Events', style: 'Writing Style', world: 'Story World' };

function sourcePointer(source) {
    return {
        book: source.book, set: source.set, uid: source.uid, fingerprint: source.fingerprint,
        ...(source.version !== undefined ? { version: source.version, versionFingerprint: source.versionFingerprint } : {}),
        ...(source.categoryId ? { categoryId: source.categoryId, itemId: source.itemId } : {}),
    };
}

function liveSource(pointer, sources) {
    const matches = sources.filter(row => {
        const sameLocation = pointer.book === row.book && pointer.set === row.set && String(pointer.uid) === String(row.uid);
        const moved = pointer.set !== row.set && canonSet(pointer.set) === row.set && row.formerKeys.includes(pointer.book + '.' + pointer.uid);
        if (!sameLocation && !moved) return false;
        if (pointer.version !== undefined) {
            return pointer.version === row.version && pointer.versionFingerprint === row.versionFingerprint;
        }
        return pointer.categoryId === row.categoryId && pointer.itemId === row.itemId && row.version === undefined;
    });
    if (matches.length !== 1) throw new Error(matches.length ? 'The linked source is ambiguous. Relink it or make a standalone copy.' : 'The linked source is missing or changed. Relink it or make a standalone copy.');
    const match = matches[0];
    if (pointer.version === undefined && !pointer.itemId && match.fingerprint !== pointer.fingerprint) {
        throw new Error('The linked source changed. Review the source and relink it.');
    }
    return match;
}

function worldRows(entry, family) {
    const row = readWorldEntry(entry);
    const tags = entry.extensions?.ri || {};
    const kind = row.kind;
    if (!['seed', 'thread', 'secret', 'plot_twist', 'twist'].includes(kind) || DONE[kind] === row.status) return null;
    // These story records can include material that a player has yet to see.
    if (family === 'draft') return null;
    const text = kind === 'secret' ? (row.status === 'out' ? row.fields.secret : row.fields.shadow ||
        (row.fields.holder ? row.fields.holder + ' is keeping something private.' : 'Someone here is keeping something private.'))
        : row.fields.detail || row.fields.open || row.fields.summary || Object.values(row.fields).find(Boolean);
    if (!text) return null;
    return { text: kind === 'secret' && row.status !== 'out' ? 'Foreshadow this detail: ' + text : text,
        enabled: row.on && !row.locked, sourceKind: kind, secret: kind === 'secret', worldKind: WORLD_KINDS[kind]?.label,
        secretText: kind === 'secret' && row.status !== 'out' ? row.fields.secret : '', locked: !!tags.locked };
}

function historyForSources(cs) {
    const recipes = new Map();
    const completed = new Set(cs?.burned?.keys || []);
    const burned = new Map(Object.entries(cs?.burned?.ids || {}).map(([key, ids]) => [key, new Set(ids)]));
    const checkingOff = settings().check.mode === 'off';
    for (const key of Object.keys(cs?.unburn || {})) {
        burned.delete(key);
        completed.delete(key);
    }
    for (const turn of ctx().chat || []) {
        const record = turn.extra?.[KEY];
        for (const [key, value] of Object.entries(record?.states || {})) recipes.set(key, value);
        for (const item of record?.items || []) {
            if (item.event) recipes.set(item.key, item.event);
            if (item.status !== 'done' && !(!item.quickAction && (checkingOff || item.noCheck) && item.status === 'sent')) continue;
            if (cs?.unburn?.[item.key] && Number(record.time) <= Number(cs.unburn[item.key])) continue;
            completed.add(item.key);
            const ids = burned.get(item.key) || new Set();
            for (const part of item.parts || []) for (const id of part.ids || []) ids.add(id);
            burned.set(item.key, ids);
        }
    }
    return { recipes, burned, completed };
}

function sourceAliases(book, entry) {
    return [...new Set([book + '.' + entry.uid, ...(entry.extensions?.ri?.was || [])])];
}

function readSourceRows(entry, info, family, options) {
    const key = info.book + '.' + entry.uid;
    const aliases = sourceAliases(info.book, entry);
    const base = {
        id: 'source:' + quickActionFingerprint([info.id, entry.uid]),
        key, uid: entry.uid, family, title: entry.comment || info.name,
        category: groups[info.kind], set: info.id, setName: info.name, book: info.book,
        formerKeys: aliases, origin: 'source', enabled: !entry.disable,
        fingerprint: quickActionFingerprint([entry.content, entry.extensions?.ri?.type]),
    };
    if (info.kind === 'world') {
        const row = isWorldEntry(entry) ? worldRows(entry, family) : null;
        return row ? [{ ...base, ...row }] : [];
    }
    if (info.kind === 'instructions' && !isEvent(entry) && !isStyle(entry) && !isWorldEntry(entry)) {
        const instruction = readInstruction(entry);
        const versions = instruction.versions.map((version, index) => ({ ...version, index })).filter(version => version.text.trim());
        if (!versions.length) return [];
        const delivery = { visibility: instruction.sentAs === 'ooc' ? 'visible' : 'private', required: ['ooc', 'system'].includes(instruction.sentAs) };
        const used = aliases.map(alias => options.cs?.used?.[alias]).find(Array.isArray) || [];
        const pick = aliases.map(alias => options.cs?.picks?.[alias]).find(Boolean);
        const once = instruction.once && aliases.some(alias => options.history.completed.has(alias));
        const row = { ...base, sourceKind: 'instruction', delivery, versions, used, pick,
            enabled: base.enabled && !once, unavailable: once ? 'Already happened in this chat' : '' };
        return [row, ...versions.map(({ index, text }) => ({
            ...row, id: base.id + ':version:' + index, version: index,
            versionFingerprint: quickActionFingerprint(text), text,
        }))];
    }
    if (info.kind === 'events' && !isEvent(entry) || info.kind === 'style' && !isStyle(entry)) return [];
    const type = info.kind === 'style' ? 'style' : 'event';
    if (family === 'draft' && type === 'event') return [];
    const recipe = withPreset({ ...entry.extensions.ri, ...readEvent(entry, base.title) }, options.cs?.presets?.[info.id]);
    const recipeOpts = {
        manual: true,
        locks: aliases.map(alias => options.cs?.locks?.[alias]).find(Boolean),
        burned: new Set(aliases.flatMap(alias => [...(options.history.burned.get(alias) || [])])),
        blockedTags: options.blockedTags,
        scene: options.scene,
    };
    const previous = aliases.map(alias => options.history.recipes.get(alias)).find(Boolean);
    const choices = eventChoices(recipe, previous, recipeOpts);
    const hasChoices = category => category.items.some(item => item.available);
    const available = choices.some(hasChoices) && choices.every(category => !category.required || hasChoices(category));
    const root = { ...base, sourceKind: type, recipe, recipeOpts, previous,
        delivery: { visibility: recipe.sentAs === 'ooc' ? 'visible' : 'private', required: type === 'event' },
        enabled: base.enabled && available, unavailable: available ? '' : 'No ingredients fit the current scene and locks', choices };
    return [root, ...choices.flatMap(category => category.items.map(item => ({
        ...root, id: base.id + ':ingredient:' + quickActionFingerprint([category.id, item.id]),
        categoryId: category.id, categoryName: category.name, itemId: item.id, text: item.text,
        enabled: base.enabled && item.available, unavailable: item.reason,
    })))];
}

/** The same catalog powers browsing, exact picks and scoped rolls. Records from another chat or a detached book stay out. */
export async function loadQuickActionSources({ family = 'steer', scene, sets } = {}) {
    const cs = chatState();
    const world = chatWorld();
    const activeScene = readScene('normal');
    const effective = world ? await loadEffectiveWorld(world).catch(() => null) : null;
    const offers = effective ? worldOffers(listWorld(effective, world), String(activeScene.present || '').split(/[,;]+/),
        { chat: ctx().getCurrentChatId?.(), n: (ctx().chat || []).length }) : {};
    if (family === 'draft') {
        delete offers.threads;
        delete offers.secrets;
        delete offers.plans;
    }
    const options = {
        cs, history: historyForSources(cs), blockedTags: blockedEventTags(),
        scene: scene || { count: countPresent(activeScene.present), ...offers },
    };
    const ids = sets || [...knownSets('instructions'), ...knownSets('events'), ...knownSets('style'), ...[world].filter(Boolean)];
    const excluded = new Set(cs?.excludedHostBooks || []);
    const rows = await Promise.all(ids.map(async id => {
        const info = setInfo(id);
        if (excluded.has(info.book)) return [];
        const book = id === world ? effective : await loadSet(id).catch(() => null);
        return entriesOf(book, id).flatMap(entry => {
            if (!entry || entry.uid === undefined) return [];
            try { return readSourceRows(entry, info, family, options); }
            catch {
                return [{
                    id: 'source:' + quickActionFingerprint([id, entry.uid]), key: info.book + '.' + entry.uid,
                    set: id, setName: info.name, book: info.book, uid: entry.uid, family, origin: 'source', formerKeys: [],
                    title: entry.comment || 'Entry ' + entry.uid, category: groups[info.kind], enabled: false,
                    unavailable: 'The source data could not be read. Open the source book to repair it.',
                }];
            }
        });
    }));
    if (cs !== chatState()) throw new Error('The open chat changed. Reopen Browse to load its sources.');
    return rows.flat().map(row => row.enabled ? row : { ...row, unavailable: row.unavailable || 'Disabled in its source' });
}

function randomIndex(length, random) {
    return random ? Math.min(length - 1, Math.max(0, Math.floor(random() * length))) : rollInt(length);
}

export function planQuickActionVersion(versions, used, previous, random) {
    const available = versions.map(version => version.index);
    if (!available.length) return { index: undefined, used: [] };
    let cycle = (used || []).filter(index => available.includes(index));
    let pool = available.filter(index => !cycle.includes(index));
    if (!pool.length) {
        pool = available.filter(index => available.length === 1 || index !== previous?.idx);
        cycle = [];
    }
    const index = pool[randomIndex(pool.length, random)];
    return { index, used: [...new Set([...cycle, index])] };
}

function variableValue(key, variables, family) {
    if (Object.hasOwn(variables, key)) return variables[key];
    const role = /^(char|user)(?:\.([a-z]+))?$/i.exec(key);
    if (role) {
        const name = role[1].toLowerCase();
        if (!role[2]) return names()[name];
        const index = FORMS.indexOf(role[2].toLowerCase());
        if (index < 0) return undefined;
        const value = pronounForms(name)[index];
        return /^[A-Z]/.test(role[2]) ? value.charAt(0).toUpperCase() + value.slice(1) : value;
    }
    const host = ctx();
    const card = host.characters?.[host.characterId];
    if (key === 'persona') return host.powerUserSettings?.persona_description ?? host.power_user?.persona_description;
    if (key === 'card' && family !== 'draft') return card?.description;
    if (key === 'scenario' && family !== 'draft') return card?.scenario;
    return undefined;
}

/** Resolve read-only built-ins and explicit values. Unknown or stateful host expressions remain literal. */
export function resolveQuickActionText(text, variables = {}, family) {
    const unresolved = new Set();
    const source = toEdit(text);
    const resolved = source.replace(/\{\{([^{}]+)\}\}/g, (token, raw) => {
        const value = variableValue(raw.trim(), variables, family);
        if (value !== undefined && value !== null && String(value).trim()) return String(value);
        unresolved.add(token);
        return token;
    });
    for (const partial of source.replace(/\{\{[^{}]+\}\}/g, '').match(/\{\{[^\n]*|[^\s{]*\}\}/g) || []) unresolved.add(partial);
    return { text: resolved, unresolved: [...unresolved] };
}

export function resolveQuickAction(actionOrSource, options = {}) {
    const { sources = [], variables = {}, twist = '', ingredients = {}, random, allowLiteral = false, revealTo = '' } = options;
    const action = typeof actionOrSource === 'string' ? readQuickAction(actionOrSource) : actionOrSource;
    if (!action || action.enabled === false || action.hidden || action.removed) throw new Error(action?.unavailable || 'This quick action is unavailable.');
    if (action.source?.scope) {
        const rolled = rollQuickAction(sources, { ...options, scope: action.source.scope });
        return { ...rolled, id: action.id, family: action.family, title: action.title };
    }
    const source = action.origin === 'source' ? action : action.source ? liveSource(action.source, sources) : null;
    if (source?.enabled === false) throw new Error(source.unavailable || 'The linked source is disabled.');
    const delivery = action.delivery || source?.delivery || defaultDelivery;
    const effects = [];
    const identities = [];
    let text = action.text || '';
    let result;
    if (source) {
        const identity = sourcePointer(source);
        identities.push({ ...identity, key: source.key, title: source.title });
        if (source.recipe) {
            const explicit = { ...ingredients };
            if (source.itemId) explicit[source.categoryId] = [source.itemId];
            const rolled = rollEvent(source.recipe, source.previous, { ...source.recipeOpts, explicit });
            if (!rolled?.text) throw new Error('No recipe result fits those ingredients and the current story locks.');
            result = rolled.parts;
            text = action.origin === 'source' || !action.text.trim() ? rolled.text : action.text;
            effects.push({ kind: 'recipe', key: source.key, set: source.set, book: source.book, uid: source.uid,
                title: source.title, version: rolled.text, sentAs: source.recipe.sentAs, event: rolled.state,
                parts: rolled.parts, requireEvidence: source.sourceKind === 'event' });
        } else if (source.versions) {
            const version = source.version !== undefined
                ? { index: source.version, used: [...new Set([...source.used, source.version])] }
                : planQuickActionVersion(source.versions, source.used, source.pick, random);
            const picked = source.versions.find(value => value.index === version.index);
            if (!picked) throw new Error('The selected version is missing. Choose a new version.');
            result = version.index;
            text = action.origin === 'source' || !action.text.trim() ? picked.text : action.text;
            effects.push({ kind: 'instruction', key: source.key, set: source.set, book: source.book, uid: source.uid,
                title: source.title, version: picked.text, index: version.index, used: version.used });
        } else {
            const fromSource = source.secretText && revealTo.trim() && action.family !== 'draft'
                ? 'Reveal the following to ' + revealTo.trim() + ' in the scene: ' + source.secretText : source.text;
            text = action.origin === 'source' || !action.text.trim() ? fromSource : action.text;
        }
    }
    if (action.requiresDirection && !String(variables.direction || '').trim()) throw new Error('Enter a direction before using this button.');
    if (action.twistTypes?.includes(twist)) text += '\nTwist type: ' + twist + '.';
    const resolved = resolveQuickActionText(text, variables, action.family);
    if (resolved.unresolved.length && !allowLiteral && !action.literalMacros) {
        throw new Error('Replace unresolved variables or choose to keep them literally: ' + resolved.unresolved.join(', '));
    }
    return {
        id: action.id, family: action.family, title: action.title, text: resolved.text, sources: identities,
        visibility: delivery.visibility, required: !!delivery.required, draw: result === undefined ? null : { id: 'draw:' + newId(), value: result },
        effects, operation: action.operation || '', unresolved: resolved.unresolved,
        embedsDirection: text.includes('{{direction}}') && Boolean(variables.direction),
    };
}

export function quickActionScope(sources, { category, set, key } = {}) {
    return sources.filter(row => (!category || row.category === category) && (!set || row.set === set)
        && (!key || row.key === key));
}

export function rollQuickAction(sources, { scope = {}, ...options } = {}) {
    const pool = quickActionScope(sources, scope).filter(row => row.enabled && row.version === undefined && !row.itemId);
    if (!pool.length) throw new Error('No eligible entries in this selection.');
    const row = pool[randomIndex(pool.length, options.random)];
    const resolved = resolveQuickAction(row, options);
    return { ...resolved, draw: { id: 'draw:' + newId(), value: resolved.draw?.value ?? row.key, scope: { ...scope }, size: pool.length } };
}

export function rollQuickActionDie({ stat = '', who = 'user', target = null, random } = {}) {
    const modifier = Math.max(MOD_MIN, Math.min(MOD_MAX, Math.round(Number(sheet(who)[stat]) || 0)));
    const natural = randomIndex(20, random) + 1;
    const total = natural + modifier;
    const threshold = target === null || target === '' || !Number.isFinite(Number(target)) ? null : Number(target);
    const result = threshold === null ? outcome(natural, total) : total >= threshold ? 'succeeds' : 'fails';
    return {
        id: 'draw:' + newId(), kind: 'd20', natural, modifier, total, target: threshold, result, stat, who,
        text: 'The d20 rolled ' + natural + (stat ? ' for ' + stat : '') + ' with modifier ' + modifier + ', for a total of ' + total
            + (threshold === null ? '' : ' against a target of ' + threshold) + '. The attempt ' + result + '.',
    };
}

export function linkedQuickAction(source, exact = '') {
    const pointer = sourcePointer(source);
    const previous = listQuickActions(source.family).find(action => action.source &&
        Object.entries(pointer).every(([key, value]) => action.source[key] === value));
    if (previous) return previous;
    return saveQuickAction({
        family: source.family, title: source.title + (source.version === undefined ? '' : ' · Version ' + (source.version + 1)),
        text: '', category: source.category, origin: 'linked', delivery: source.delivery,
        source: { ...pointer, snapshot: exact || source.text || '' },
    });
}

export function relinkQuickAction(id, source) {
    const action = readQuickAction(id);
    if (!action || action.family !== source.family) throw new Error('Choose a source for this action’s destination.');
    return saveQuickAction({ id, source: { ...sourcePointer(source), snapshot: source.text || '' } });
}

export function standaloneQuickAction(action, exact = '') {
    return saveQuickAction({
        family: action.family, title: action.title, text: exact || action.text || action.source?.snapshot, category: action.category,
        delivery: action.delivery, twistTypes: action.twistTypes,
    });
}

export async function editQuickActionSource(source, text) {
    if (!text.trim() || (source.version === undefined && !source.itemId)) throw new Error('Choose a version or recipe ingredient and enter its wording.');
    return editSet(source.set, data => {
        const entry = entriesOf(data, source.set).find(row => String(row.uid) === String(source.uid));
        if (!entry) throw new Error('This source was removed. Refresh Browse.');
        if (source.version !== undefined) {
            const instruction = readInstruction(entry);
            const version = instruction.versions[source.version];
            if (!version || quickActionFingerprint(version.text) !== source.versionFingerprint) throw new Error('The version changed. Refresh Browse before editing.');
            version.text = text;
            writeInstruction(data, instruction, source.set);
        } else {
            const recipe = readEvent(entry, source.title);
            const item = recipe.categories.find(category => category.id === source.categoryId)?.items.find(value => value.id === source.itemId);
            if (!item || item.text !== source.text) throw new Error('The ingredient changed. Refresh Browse before editing.');
            item.text = text;
            writeEvent(data, recipe, source.set);
        }
    });
}
