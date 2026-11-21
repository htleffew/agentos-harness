import { adoptSet, cleanSetName, setInfo } from './books.js';
import { newId } from './events.js';
import { actionLibrary, QUICK_ACTION_FAMILIES, quickActionFingerprint, readQuickAction } from './quick-actions.js';
import { refreshWorldList, saveBook, worldNames } from './st.js';
import { saveSettings, settings } from './store.js';

const FORMAT = 'roleplay-instructions/quick-actions';
const shelf = {
    1: 'Plot twist',
    2: 'Slow the pace',
    12: 'Increase intensity',
    13: 'Soften the intensity',
    16: 'Raise the stakes',
};
const forms = { 9: 'Direct the scene', 14: 'Skip time', 15: 'Describe an outfit', 17: 'Introduce the scene' };
const existingTools = { 4: 'Chapters', 5: 'Chapters', 6: 'Chapters', 7: 'Chapters', 8: 'Chapters', 11: 'Chapters', 22: 'Notes', 23: 'Notes' };
const clone = value => structuredClone(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
let lorebookImports = Promise.resolve();

function applyLibrary(label, edit) {
    const library = actionLibrary();
    const { actions, order, imports } = library;
    const undo = { id: newId(), label, actions: clone(actions), order: clone(order), imports: clone(imports) };
    const result = edit(library);
    library.undo = undo;
    saveSettings();
    return result;
}

export function exportQuickActionLibrary() {
    const { actions, order, imports } = actionLibrary();
    return JSON.stringify({ format: FORMAT, version: 1, library: { actions, order, imports } }, null, 2);
}

function explicitHook(entry, body, after) {
    const flag = after ? entry.executeOnAi : entry.executeBeforeGeneration || entry.executeOnBeforeGeneration || entry.executeOnUser;
    const markers = after ? /(?:keel_|keel\b).*(?:snapshot|objective|twist|check|state)/is
        : /(?:keel_|keel\b).*(?:snapshot|objective|twist|before|state)/is;
    return Boolean(flag && markers.test(body));
}

function injectionText(body) {
    // Match the final injection in a recognized script. The command is never dispatched or evaluated.
    const injection = /(?:^|\|\s*)\/inject\s+((?:\w+=(?:"[^"]*"|'[^']*'|[^\s|]+)\s+)+)([^|\r\n]+)(?=\s*(?:\||$))/gim;
    const match = [...body.matchAll(injection)].findLast(([, args]) => /\bid=(?:["']?keel_oneshot["']?)(?:\s|$)/i.test(args)
        && /\bephemeral=(?:true|1)(?:\s|$)/i.test(args));
    if (!match) return '';
    return match[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
}

function candidate(entry, recognized) {
    const id = Number(entry.id);
    const body = entry.message;
    const answer = { id, title: entry.label || `Entry ${id}`, visible: !entry.isHidden, kind: 'Inert script', reason: 'No supported translation', original: clone(entry) };
    if (!recognized) return answer;
    if (id === 10 && !entry.isHidden && /\/(?:buttons|popup|input|qr-set|run)\b/.test(body)) {
        return { ...answer, kind: 'Visible launcher', reason: 'Open Quick actions from the chat composer.' };
    }
    if ([19, 20].includes(id) && explicitHook(entry, body, id === 19)) {
        return { ...answer, kind: 'Automatic hook', reason: id === 19 ? 'After reply · preserved as inert data' : 'Before generation · preserved as inert data' };
    }
    if (existingTools[id]) return { ...answer, reason: 'Existing Roleplay Instructions workflow', tool: existingTools[id] };
    if (id === 3 && /\/(?:flushinject|uninject|inject)\b[^\r\n|]*\bkeel_oneshot\b/i.test(body)) {
        return { ...answer, kind: 'Queue shortcut', reason: 'Opens pending directions. You select what to cancel.',
            translation: { title: 'Cancel pending directions', family: 'steer', text: '', operation: 'queue' } };
    }
    if (!Object.hasOwn(shelf, id) && !Object.hasOwn(forms, id)) return answer;
    const direction = injectionText(body);
    if (!direction || direction.startsWith('/') || Boolean(entry.executeOnAi || entry.executeOnUser || entry.executeOnStartup || entry.executeOnChatChange)) return answer;
    const collectsInput = /(?:^|\|\s*)\/input\b/i.test(body);
    const requiresDirection = Object.hasOwn(forms, id);
    const userSlot = /\{\{\s*(?:pipe|input|getvar::(?:keel_[\w-]+))\s*\}\}/gi;
    if (requiresDirection !== collectsInput || (requiresDirection && !direction.match(userSlot))) return answer;
    const text = direction.replace(userSlot, '{{direction}}').replace(/^\[\s*(?:OOC|System note)\s*:\s*(.*?)\s*\]$/i, '$1');
    return {
        ...answer, kind: requiresDirection ? 'Direction with text' : 'Immediate direction',
        reason: 'Native button queues an editable one-use direction with your next message.',
        translation: { title: entry.label || forms[id] || shelf[id], family: 'steer', text, requiresDirection,
            delivery: { visibility: /^\[\s*OOC\s*:/i.test(direction) ? 'visible' : 'private', required: false } },
    };
}

function inspectQuickReplies(value) {
    const ids = new Set(value.qrList.map(entry => Number(entry.id)));
    const launcher = value.qrList.find(entry => Number(entry.id) === 10 && !entry.isHidden);
    const recognized = /\bkeel\b/i.test(value.name || '') && ids.size === 23
        && Array.from({ length: 23 }, (_, index) => index + 1).every(id => ids.has(id))
        && value.qrList.filter(entry => !entry.isHidden).length === 1
        && /\/(?:buttons|popup|input|qr-set|run)\b/.test(launcher?.message || '')
        && value.qrList.some(entry => Number(entry.id) === 19 && explicitHook(entry, entry.message, true))
        && value.qrList.some(entry => Number(entry.id) === 20 && explicitHook(entry, entry.message, false));
    return {
        type: 'quick-reply', name: String(value.name || 'Quick Reply export'), recognized,
        entries: value.qrList.map(entry => {
            const commands = [...new Set([...entry.message.matchAll(/(?:^|[|\n])\s*\/([\w-]+)/g)].map(match => match[1].toLowerCase()))];
            const requires = [...new Set(entry.message.match(/\bkeel_[\w-]+\b/gi) || [])];
            const triggers = Object.entries(entry).filter(([key, enabled]) => /^execute(?:On|Before)/.test(key) && enabled === true).map(([key]) => key);
            return { ...candidate(entry, recognized), commands, requires, triggers,
                modelCommands: commands.filter(command => /^gen(?:erate|raw)?$/.test(command)),
                writeCommands: commands.filter(command => /^(?:set(?:global)?var|del(?:global)?var|inject|flushinject|createentry|setentryfield|send|sendas)$/.test(command)) };
        }),
        original: clone(value),
    };
}

function inspectBook(value, filename) {
    const entries = Object.values(value.entries);
    if (!entries.every(entry => record(entry) && /^(?:0|[1-9]\d*)$/.test(String(entry.uid)) && Number.isSafeInteger(Number(entry.uid))
        && typeof entry.content === 'string')) throw new Error('Each World Info entry needs a numeric UID and text content.');
    if (new Set(entries.map(entry => Number(entry.uid))).size !== entries.length) throw new Error('The lorebook has duplicate UIDs.');
    const name = cleanSetName(value.name || filename.replace(/\.json$/i, '') || 'Imported lorebook');
    if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Choose a different book name.');
    return { type: 'lorebook', name, original: clone(value), entries: entries.map(entry => ({
        id: Number(entry.uid), title: String(entry.comment || ('Entry ' + entry.uid)), kind: String(entry.extensions?.ri?.type || 'Instruction'),
        reason: entry.disable ? 'Disabled in the source' : 'Available to browse once imported',
    })) };
}

export function inspectQuickActionImport(input, filename = '') {
    let value;
    try { value = typeof input === 'string' ? JSON.parse(input) : input; } catch { throw new Error('This file contains invalid JSON.'); }
    if (!record(value)) throw new Error('Choose a library, World Info, or Quick Reply JSON object.');
    if (value.format === FORMAT && value.version === 1 && record(value.library?.actions)) {
        return { type: 'library', name: 'Quick actions library', original: clone(value), entries: Object.values(value.library.actions)
            .filter(item => record(item) && typeof item.title === 'string' && Object.hasOwn(QUICK_ACTION_FAMILIES, item.family))
            .map(item => ({ id: item.id, title: item.title, kind: QUICK_ACTION_FAMILIES[item.family].name, reason: 'Editable button' })) };
    }
    if (value.version === 2 && Array.isArray(value.qrList) && value.qrList.length > 0
        && value.qrList.every(entry => record(entry) && typeof entry.message === 'string')) return inspectQuickReplies(value);
    if (record(value.entries)) return inspectBook(value, filename);
    throw new Error('This JSON does not match a supported library, World Info, or Quick Reply format.');
}

function safeFields(value) {
    const raw = record(value) ? value : {};
    return {
        title: String(raw.title || '').trim(), text: String(raw.text || ''), category: String(raw.category || ''),
        hidden: !!raw.hidden, enabled: raw.enabled !== false,
        delivery: { visibility: raw.delivery?.visibility === 'visible' ? 'visible' : 'private', required: !!raw.delivery?.required },
        ...(record(raw.source) ? { source: clone(raw.source) } : {}),
        ...(Array.isArray(raw.twistTypes) ? { twistTypes: raw.twistTypes.map(String) } : {}),
        ...(raw.requiresDirection ? { requiresDirection: true } : {}),
        ...(raw.literalMacros ? { literalMacros: true } : {}),
    };
}

function importLibrary(inspection) {
    const exported = inspection.original.library;
    const actions = Object.entries(exported.actions).flatMap(([id, raw]) => {
        if (!record(raw) || !Object.hasOwn(QUICK_ACTION_FAMILIES, raw.family)) return [];
        const fields = safeFields(raw);
        const previous = readQuickAction(id);
        const canUseBuiltin = previous?.origin === 'built-in' && previous.family === raw.family;
        const canKeepId = /^action:[\w.~-]{1,151}$/.test(id) &&
            (!previous || (previous.family === raw.family && JSON.stringify(safeFields(previous.baseline)) === JSON.stringify(safeFields(raw.baseline))));
        const queue = raw.origin === 'translated' && raw.operation === 'queue' && raw.family === 'steer';
        const portableOrigin = raw.origin === 'standalone' || raw.origin === 'translated' ||
            raw.origin === 'linked' && fields.source ? raw.origin : 'imported';
        if (!fields.title || (!fields.text.trim() && !fields.source && !queue)) return [];
        const item = {
            ...fields, id: canUseBuiltin || canKeepId ? id : 'action:' + newId(), family: raw.family,
            origin: canUseBuiltin ? 'built-in' : portableOrigin,
            baseline: raw.baseline?.title ? safeFields(raw.baseline) : fields,
            baselineRevision: Number(raw.baselineRevision) || 1,
            variations: Array.isArray(raw.variations) ? raw.variations.filter(value => typeof value?.name === 'string').map(value => ({
                name: value.name, fields: safeFields(value.fields),
            })) : [],
            ...(raw.removed && !canUseBuiltin ? { removed: true } : {}),
            ...(queue ? { operation: 'queue' } : {}),
        };
        return [{ id, item }];
    });
    const ids = new Map(actions.map(({ id, item }) => [id, item.id]));
    return applyLibrary('Import library', library => {
        for (const { item } of actions) library.actions[item.id] = item;
        if (Array.isArray(exported.order)) {
            const order = exported.order.map(id => ids.get(id)).filter(Boolean);
            library.order = [...order, ...library.order.filter(id => !order.includes(id))];
        }
        for (const item of Array.isArray(exported.imports) ? exported.imports.filter(record) : []) {
            if (library.imports.some(saved => saved.fingerprint === item.fingerprint)) continue;
            library.imports.push(clone(item));
        }
        return { actions: actions.length, book: '' };
    });
}

async function importLorebook(inspection) {
    const taken = new Set([...worldNames(), ...Object.keys(settings().sets).map(id => setInfo(id).book)].map(name => name.toLowerCase()));
    const base = inspection.name;
    let name = base;
    for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = base + ' ' + suffix;
    const source = clone(inspection.original);
    source.entries = Object.fromEntries(Object.values(source.entries).map(entry => {
        const uid = Number(entry.uid);
        return [uid, { ...entry, uid, automationId: '' }];
    }));
    await saveBook(name, source);
    await refreshWorldList();
    const sets = await adoptSet(name);
    return { actions: 0, book: name, sets };
}

/** Import reviewed data. A Quick Reply conversion receives the user's selected IDs explicitly. */
export async function importQuickActionData(inspection, { selected = [] } = {}) {
    // Reinspect at the trust boundary, since a caller could have edited the preview object.
    const verified = inspectQuickActionImport(inspection.original, inspection.name);
    if (verified.type === 'library') return importLibrary(verified);
    if (verified.type === 'lorebook') {
        const pending = lorebookImports.catch(() => {}).then(() => importLorebook(verified));
        lorebookImports = pending;
        return pending;
    }
    const chosen = new Set(selected.map(Number));
    const fingerprint = quickActionFingerprint(verified.original);
    const translations = verified.entries.filter(entry => chosen.has(entry.id) && entry.translation);
    return applyLibrary('Import Quick Reply file', library => {
        const previous = library.imports.find(item => item.fingerprint === fingerprint);
        const translated = previous?.translated || {};
        let actions = 0;
        for (const entry of translations) {
            if (translated[entry.id] && library.actions[translated[entry.id]]) continue;
            const id = 'action:' + newId();
            const fields = safeFields({ ...entry.translation, category: verified.name });
            library.actions[id] = {
                ...fields, id, family: 'steer', origin: 'translated', baseline: clone(fields), baselineRevision: 1,
                ...(entry.translation.operation ? { operation: entry.translation.operation } : {}),
            };
            translated[entry.id] = id;
            actions++;
        }
        if (previous) previous.translated = translated;
        else library.imports.push({ fingerprint, name: verified.name, original: verified.original, translated });
        return { actions, book: '' };
    });
}
