import { taskLabels } from './destinations.js';
import {
    actionLibrary, applyQuickActionVariation, editQuickActionSource, linkedQuickAction, listQuickActions, loadQuickActionSources, moveQuickAction,
    QUICK_ACTION_FAMILIES, QUICK_ACTION_VARIABLES, quickActionOwner, quickActionRestorePreview, quickActionScope, readQuickAction, recoverQuickAction,
    relinkQuickAction, removeQuickAction, resolveQuickAction, restoreQuickAction, restoreQuickActionLibrary, rollQuickAction,
    resolveQuickActionText, saveQuickAction, saveQuickActionVariation, standaloneQuickAction, undoQuickActionLibrary,
} from '../quick-actions.js';
import { exportQuickActionLibrary, importQuickActionData, inspectQuickActionImport } from '../quick-action-import.js';
import { add, button, clear, download, field, h, insertAtCursor, select, textArea, textInput } from './dom.js';

const append = (parent, ...children) => add(parent, children);
const row = (...children) => h('div', { class: 'ri-qa-library-row' }, children);
const block = (...children) => h('div', { class: 'ri-qa-library-block' }, children);
const readOnly = text => h('div', { class: 'ri-qa-exact' }, text);
const check = (label, checked, onChange) => {
    const input = h('input', { type: 'checkbox', checked, onchange: event => onChange(event.target.checked) });
    return h('label', { class: 'ri-qa-library-check' }, input, label);
};
const details = (label, ...children) => h('details', { class: 'ri-qa-library-details' }, h('summary', {}, label), children);

function actionMatches(query) {
    const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return item => {
        const fields = [item.title, item.text, item.category, item.book, item.setName, item.categoryName,
            item.source?.book, item.source?.set, item.source?.snapshot, quickActionOwner(item)];
        const text = fields.join(' ').toLowerCase();
        return words.every(word => text.includes(word));
    };
}

function nextGroup(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
}

const restoreName = action => ({
    'built-in': 'Restore built-in', imported: 'Restore imported version', translated: 'Restore imported version', linked: 'Restore saved source link',
}[action.origin] || 'Restore first saved version');

function actionOptions(action) {
    return {
        family: action?.family || 'steer',
        id: action?.id,
        title: action?.title || '',
        text: action?.text || '',
        category: action?.category || '',
        delivery: { visibility: 'private', required: false, ...action?.delivery },
        enabled: action?.enabled !== false,
        hidden: !!action?.hidden,
        twistTypes: action?.twistTypes?.slice(),
        source: action?.source,
        literalMacros: !!action?.literalMacros,
    };
}

/** Mount the library inside the existing Quick actions sheet. The caller retains its draft and selection. */
export function renderQuickActionLibrary(host, {
    family = 'steer', mode = 'browse', state = {}, onSelect, onChange, onPin, onCancelPending,
    onRestore, onUndo, onOpenTool, onClose, getPins = () => [], initialDirection = '',
} = {}) {
    const library = h('section', { class: 'ri-qa-library', 'aria-label': 'Quick action library' });
    const status = h('p', { class: 'ri-qa-library-status', role: 'status', ariaLive: 'polite' });
    const body = block();
    const ui = state;
    const mount = Symbol();
    const sourceFamily = family || 'steer';
    if (ui.sourceFamily !== sourceFamily || mode==='browse' && ui.page==='browse') ui.sources = null;
    ui.sourceFamily = sourceFamily;
    ui.mount = mount;
    ui.loading = false;
    ui.onSources = null;
    const next = (page, properties = {}) => {
        if (page==='browse' && ui.page!=='browse') ui.sources = null;
        Object.assign(ui, { page, error: '', ...properties });
        draw();
    };
    const info = message => { ui.error = message; status.textContent = message; };
    const run = fn => async event => {
        try { await fn(event); }
        catch (error) { info(error.message || String(error)); }
    };
    const changed = (message, action) => {
        onChange?.(action);
        info(message);
        draw();
    };
    const pinned = action => getPins().some(pin => pin.reference === action.id);
    const setPin = action => {
        const remove = pinned(action);
        onPin(action.id, action.title, action.family);
        changed((remove ? 'Unpinned ' : 'Pinned ') + action.title + '.', action);
    };
    const pinButton = action => onPin && button((pinned(action) ? 'Unpin ' : 'Pin ') + action.title, run(() => setPin(action)));
    const initial = mode === 'add' ? 'editor' : mode;
    if (!ui.page || ui.family !== family || ui.root !== initial) {
        Object.assign(ui, { family, root: initial, page: initial, search: '', preview: null, error: '' });
        if (initial === 'editor') ui.edit = { ...actionOptions({ family: sourceFamily }), text: initialDirection };
    }
    const tab = name => button(name === 'manage' ? taskLabels.manage : taskLabels.browse, () => next(name));
    const back = (page = ui.root === 'editor' ? 'manage' : ui.root) => button('Back to library', () => next(page));
    const addButtons = () => (family ? [family] : Object.keys(QUICK_ACTION_FAMILIES)).map(destination =>
        button(QUICK_ACTION_FAMILIES[destination].add, () => edit({ family: destination, text: initialDirection })));
    const destinationLabel = action => !family && h('span', { class: 'ri-help' }, QUICK_ACTION_FAMILIES[action.family]?.name);

    function mountSources(onLoaded) {
        if (ui.sources) return;
        ui.onSources = onLoaded;
        if (ui.loading) return;
        ui.loading = true;
        loadQuickActionSources({ family: sourceFamily }).then(sources => {
            if (ui.mount !== mount) return;
            ui.sources = sources;
            ui.loading = false;
            if (library.isConnected && ui.page === 'browse') ui.onSources?.();
        }).catch(error => {
            if (ui.mount !== mount) return;
            ui.loading = false;
            ui.sources = [];
            if (library.isConnected && ui.page === 'browse') { ui.onSources?.(); info(error.message); }
        });
    }

    function edit(action) {
        next('editor', { edit: actionOptions(action), variant: '', compare: false });
    }

    function exactSource(source, options = {}) {
        try {
            const resolved = resolveQuickAction(source, { variables: { direction: initialDirection }, sources: ui.sources || [], ...options });
            next('source-preview', { preview: { source, resolved, options, edited: resolved.text } });
        } catch (error) {
            next('source-preview', { preview: { source, options, resolved: null } });
            info(error.message);
        }
    }

    function roll(scope, allowLiteral = false) {
        const resolved = rollQuickAction(ui.sources || [], { scope, allowLiteral });
        next('source-preview', { preview: { resolved, scope, options: { allowLiteral }, edited: resolved.text } });
    }

    function recipe(source) {
        const selections = {};
        const controls = (source.choices || []).map(category => {
            const values = [{ label: 'Roll from eligible ingredients', value: '' },
                ...category.items.filter(item => item.available).map(item => ({ label: item.text, value: item.id }))];
            return field(category.name, '', select(values, '', value => {
                if (value) selections[category.id] = [value];
                else delete selections[category.id];
            }));
        });
        return details('Choose recipe ingredients', controls, button('Roll with these choices', () => exactSource(source, { ingredients: selections })));
    }

    function sourceRow(source, children) {
        const label = source.version !== undefined ? 'Version ' + (source.version + 1)
            : source.itemId ? source.text : source.title;
        const selectSource = event => {
            if (ui.relink) {
                event.stopPropagation();
                relinkQuickAction(ui.relink, source);
                ui.relink = null;
                next('manage');
                changed('Source link updated.');
            } else exactSource(source);
        };
        return block(row(button(label, run(selectSource), { disabled: !source.enabled }),
            !source.enabled && h('span', {}, source.unavailable)), children);
    }

    function renderBrowse() {
        const search = textInput(ui.search, value => {
            ui.search = value;
            renderPool();
        }, { type: 'search', placeholder: 'Search this library', 'aria-label': 'Search quick actions' });
        const pool = block();
        append(body, row(tab('manage'), addButtons()), search, pool);
        function renderPool() {
            clear(pool);
            const query = ui.search.trim().toLowerCase();
            const matches = actionMatches(query);
            const actions = listQuickActions(family).filter(matches);
            const sources = ui.sources || [];
            if (!ui.relink) {
                const direct = actions.map(action => row(
                    button(action.title, run(() => {
                        if (action.operation === 'queue') return onCancelPending?.();
                        if (action.source && !ui.sources) throw new Error('Wait for sources to finish loading.');
                        exactSource(action);
                    })),
                    h('span', { class: 'ri-help' }, quickActionOwner(action)),
                    destinationLabel(action),
                    button('Edit ' + action.title, () => edit(action)),
                    pinButton(action),
                ));
                if (direct.length) {
                    const group = details('Buttons · ' + direct.length, direct);
                    group.open = !!query;
                    pool.append(group);
                }
            }
            if (!ui.sources) {
                pool.append(h('p', {}, 'Loading source books…'));
                return;
            }
            if (!sources.length) {
                pool.append(h('p', {}, 'Import a World Info book or create a button to add a source.'));
                return;
            }
            if (!ui.relink) {
                const count = sources.filter(entry => entry.enabled && entry.version === undefined && !entry.itemId).length;
                pool.append(row(button('Roll across everything', run(() => roll({})), { disabled: !count }),
                    h('span', { class: 'ri-help' }, count + ' eligible source entries')));
            }
            if (ui.relink) pool.append(h('p', {}, 'Choose the exact entry, version or ingredient to link.'));
            const categories = new Map();
            for (const source of sources) nextGroup(categories, source.category, source);
            for (const [category, entries] of categories) {
                const sets = new Map();
                for (const source of entries) nextGroup(sets, source.set, source);
                const setCards = [];
                for (const [set, setEntries] of sets) {
                    const entryGroups = new Map();
                    for (const source of setEntries) nextGroup(entryGroups, source.key, source);
                    const entryCards = [];
                    for (const group of entryGroups.values()) {
                        if (!group.some(matches)) continue;
                        const [first, ...variants] = group;
                        const versions = variants.filter(item => item.version !== undefined).map(item => sourceRow(item));
                        const facets = new Map();
                        for (const variant of variants.filter(item => item.itemId)) nextGroup(facets, variant.categoryName, variant);
                        const ingredients = [...facets].map(([name, items]) => details(name, items.map(item => sourceRow(item))));
                        entryCards.push(sourceRow(first,
                            variants.length ? details('Versions and ingredients', versions, ingredients) : null));
                    }
                    if (!entryCards.length) continue;
                    const active = quickActionScope(sources, { set }).filter(entry => entry.enabled && entry.version === undefined && !entry.itemId).length;
                    const group = details(setEntries[0].setName + ' · ' + setEntries[0].book,
                        !ui.relink && button('Roll this set · ' + active + ' eligible', run(() => roll({ set })), { disabled: !active }), entryCards);
                    group.open = !!query;
                    setCards.push(group);
                }
                if (setCards.length) {
                    const active = quickActionScope(sources, { category }).filter(entry => entry.enabled && entry.version === undefined && !entry.itemId).length;
                    const group = details(category,
                        !ui.relink && button('Roll ' + category + ' · ' + active + ' eligible', run(() => roll({ category })), { disabled: !active }), setCards);
                    group.open = !!query;
                    pool.append(group);
                }
            }
        }
        renderPool();
        mountSources(renderPool);
    }

    function renderPreview() {
        const current = ui.preview;
        const { source, resolved, scope, options } = current;
        append(body, row(back('browse'), h('strong', {}, resolved?.title || source?.title || 'Roll')));
        const reference = source || ui.sources?.find(value => value.key === resolved?.sources[0]?.key && value.version === undefined && !value.itemId);
        if (reference) append(body, h('p', {}, [quickActionOwner(reference), reference.setName, reference.categoryName].filter(Boolean).join(' · ')));
        if (resolved) append(body, destinationLabel(resolved));
        if (resolved) {
            append(body, field('Exact direction', 'Edit this copy for this selection.', textArea(current.edited, value => { current.edited = value; })),
                h('p', {}, 'Runs in code · 0 model calls'),
                resolved.draw?.size && h('p', {}, 'Draw from ' + resolved.draw.size + ' eligible source ' + (resolved.draw.size === 1 ? 'entry' : 'entries')),
                row(button('Select direction', run(() => {
                    if (!current.edited.trim()) throw new Error('Enter a direction before selecting it.');
                    if (!onSelect) throw new Error('Open this library from a quick action destination.');
                    onSelect({ ...resolved, text: current.edited }, source || reference);
                }), { kind: 'primary' }),
                source && onPin && button('Pin this direction', run(() => {
                    const action = source.origin === 'source' ? linkedQuickAction(source, resolved.text) : source;
                    if (!pinned(action)) setPin(action);
                    else info(action.title + ' is already pinned.');
                }))),
                row(scope && button('Reroll this scope', run(() => roll(scope, options.allowLiteral))),
                    scope && onPin && button('Pin this roll scope', run(() => {
                        const title = scope.set ? 'Roll ' + (reference?.setName || scope.set) : scope.category ? 'Roll ' + scope.category : 'Roll across everything';
                        const action = saveQuickAction({ family: sourceFamily, title, category: 'Saved rolls', text: '', source: { scope }, origin: 'linked' });
                        onPin(action.id, action.title, action.family);
                        changed('Pinned ' + title + '.', action);
                    })),
                    button('Make standalone copy', run(() => {
                        const action = standaloneQuickAction(source || { title: resolved.title, family: resolved.family }, current.edited);
                        changed('Saved an independent button.', action);
                        edit(action);
                    })),
                ));
        } else if (source) {
            const wording = source.text || source.source?.snapshot || '';
            append(body, h('p', {}, 'Review this source and choose a recovery action.'),
                wording && field('Saved wording', '', readOnly(wording)),
                button('Keep unresolved variables literally', () => exactSource(source, { ...options, allowLiteral: true })),
                source.source && button('Relink', () => next('browse', { relink: source.id })),
                wording && button('Make standalone copy', run(() => {
                    const action = standaloneQuickAction(source);
                    changed('Saved an independent button.', action);
                    edit(action);
                })));
        }
        const unresolved = resolveQuickActionText(reference?.text || source?.text || '', { direction: initialDirection }, source?.family).unresolved;
        const slots = [...new Set(unresolved.map(token => /^\{\{([^{}]+)\}\}$/.exec(token)?.[1]?.trim()).filter(Boolean))];
        if (slots.length) {
            const variables = { ...options.variables };
            append(body, details('Fill direction variables', slots.map(slot => {
                const choices = (ui.sources || []).filter(candidate => candidate.enabled && candidate.sourceKind === slot && candidate.text &&
                    (slot !== 'instruction' || candidate.version !== undefined));
                return field(QUICK_ACTION_VARIABLES[slot] || slot, '', choices.length
                    ? select([{ label: 'Choose a source', value: '' }, ...choices.map(candidate => ({ label: candidate.title + ' · ' + candidate.book, value: candidate.id }))],
                        '', value => { variables[slot] = choices.find(candidate => candidate.id === value)?.text; })
                    : textInput('', value => { variables[slot] = value; }));
            }), button('Preview resolved direction', () => exactSource(source, { ...options, variables: { direction: initialDirection, ...variables } }))));
        }
        if (reference?.choices && source?.origin === 'source') append(body, recipe(reference));
        if (source?.secretText) {
            let audience = '';
            append(body, details('Reveal this secret', field('Who may learn it', '', textInput('', value => { audience = value; })),
                button('Preview explicit reveal', run(() => {
                    if (!audience.trim()) throw new Error('Name who may learn the secret.');
                    exactSource(source, { ...options, revealTo: audience });
                }))));
        }
        if (source?.origin === 'source' && (source.version !== undefined || source.itemId)) {
            let newText = source.text;
            append(body, details('Edit source in ' + source.book, h('p', {}, 'Saving changes this World Info entry for every chat that uses it.'),
                field('Source wording', '', textArea(newText, value => { newText = value; })),
                button('Save source wording', run(async () => {
                    await editQuickActionSource(source, newText);
                    next('browse', { sources: null });
                    changed('Saved source in ' + source.book + '.');
                }))));
        }
    }

    function renderEditor() {
        const draft = ui.edit || (ui.edit = actionOptions({ family: sourceFamily, text: initialDirection }));
        const item = draft.id ? readQuickAction(draft.id) : null;
        const prompt = textArea(draft.text, value => { draft.text = value; });
        let variable = 'user';
        append(body, row(back('manage'), h('strong', {}, item ? 'Edit button' : QUICK_ACTION_FAMILIES[draft.family].add)),
            field('Button name', '', textInput(draft.title, value => { draft.title = value; })),
            field('Direction', item?.source ? 'Leave empty to follow live source wording.' : '', prompt),
            details('Options',
                field('Category', '', textInput(draft.category, value => { draft.category = value; })),
                draft.family === 'steer' ? [
                    field('Delivery', '', select([{ label: 'Private system note', value: 'private' }, { label: 'Visible OOC', value: 'visible' }],
                        draft.delivery.visibility, value => { draft.delivery.visibility = value; })),
                    check('Required direction', draft.delivery.required, value => { draft.delivery.required = value; }),
                ] : null,
                check('Enabled', draft.enabled, value => { draft.enabled = value; }),
                check('Keep unresolved variables literally', draft.literalMacros, value => { draft.literalMacros = value; }),
                draft.twistTypes && field('Twist types', 'One type per line.', textArea(draft.twistTypes.join('\n'), value => { draft.twistTypes = value.split('\n'); })),
                field('Insert a variable', '', select(Object.entries(QUICK_ACTION_VARIABLES).map(([value, label]) => ({ value, label })),
                    variable, value => { variable = value; })),
                button('Insert variable', () => insertAtCursor(prompt, '{{' + variable + '}}'))),
            row(button('Save button', run(() => {
                const saved = saveQuickAction(draft);
                next('manage');
                changed('Saved ' + saved.title + '.', saved);
            }), { kind: 'primary' }),
            onClose && button('Return to direction', onClose)));
        if (!item) return;
        append(body, h('p', {}, item.status + ' · ' + quickActionOwner(item)),
            row(button('Compare changes', () => { ui.compare = !ui.compare; draw(); }),
                button(restoreName(item), () => next('restore-item', { restore: item.id })),
                button('Duplicate', run(() => {
                    if (item.source) return exactSource(item);
                    const saved = standaloneQuickAction(item);
                    edit(saved);
                    changed('Created independent copy.', saved);
                })),
                onPin && button(pinned(item) ? 'Unpin button' : 'Pin button', run(() => setPin(item))),
                item.source && button('Relink source', () => next('browse', { relink: item.id })),
                item.source && draft.text.trim() && button('Follow live source wording', run(() => {
                    const saved = saveQuickAction({ id: item.id, text: '' });
                    edit(saved);
                    changed('The button follows its linked source.', saved);
                })),
            ));
        if (ui.compare) {
            const values = actionOptions(item);
            const differences = [
                ['Button name', item.baseline.title, values.title],
                ['Direction', item.baseline.text, values.text],
                ['Category', item.baseline.category, values.category],
                ['Delivery', item.baseline.delivery?.visibility, values.delivery.visibility],
                ['Required direction', !!item.baseline.delivery?.required, !!values.delivery.required],
                ['Enabled', item.baseline.enabled, values.enabled],
                ['Hidden', item.baseline.hidden, values.hidden],
                ['Source', item.baseline.source, values.source],
                ['Twist types', item.baseline.twistTypes, values.twistTypes],
                ['Keep unresolved variables literally', !!item.baseline.literalMacros, !!values.literalMacros],
            ].filter(([, original, value]) => JSON.stringify(original) !== JSON.stringify(value));
            const show = (label, value) => {
                if (label === 'Delivery') return value === 'visible' ? 'Visible OOC' : 'Private system note';
                if (typeof value === 'boolean') return value ? 'Yes' : 'No';
                if (value === undefined || value === '') return 'Empty';
                return typeof value === 'string' ? value : JSON.stringify(value);
            };
            append(body, block(h('strong', {}, 'Saved changes'),
                differences.length ? differences.map(([label, original, value]) => block(h('strong', {}, label),
                    h('span', {}, 'Original'), readOnly(show(label, original)), h('span', {}, 'Current'), readOnly(show(label, value)))) : h('p', {}, 'All fields match their baseline.')));
        }
        append(body, details('Named variations',
            field('Variation name', '', textInput(ui.variant, value => { ui.variant = value; })),
            button('Save as a variation', run(() => {
                saveQuickActionVariation(item.id, ui.variant, draft);
                ui.variant = '';
                changed('Saved variation.');
            })),
            item.variations.map(variant => row(h('span', {}, variant.name), button('Apply ' + variant.name, run(() => {
                const saved = applyQuickActionVariation(item.id, variant.name);
                edit(saved);
                changed('Applied ' + variant.name + '.', saved);
            }))))));
    }

    function renderManage() {
        const actions = listQuickActions(family, { includeHidden: true });
        const results = block();
        append(body, row(tab('browse'), addButtons()),
            row(button('Import JSON', () => next('import')),
                button('Export library', () => next('export')),
                actionLibrary().undo && button('Undo last library change', run(() => {
                    const undoId = actionLibrary().undo?.id;
                    if (undoQuickActionLibrary()) onUndo?.(undoId);
                    changed('Previous library restored.');
                }))),
            field('Find a button to manage', '', textInput(ui.manageSearch || '', value => {
                ui.manageSearch = value;
                renderManagedButtons();
            }, { type: 'search' })), results);
        function renderManagedButtons() {
            clear(results);
            const matches = actionMatches(ui.manageSearch);
            const active = actions.filter(action => !action.removed);
            const groups = new Map();
            for (const action of active) nextGroup(groups, action.family, action);
            for (const item of active.filter(matches)) {
                const siblings = groups.get(item.family);
                const index = siblings.indexOf(item);
                append(results, block(row(h('strong', {}, item.title), h('span', {}, item.hidden ? 'Hidden built-in' : !item.enabled ? 'Disabled' : item.status)),
                    row(h('span', { class: 'ri-help' }, quickActionOwner(item)), destinationLabel(item)),
                    row(button('Edit ' + item.title, () => edit(item)),
                        button('Move up', () => { if (moveQuickAction(item.id, -1)) changed('Moved ' + item.title + ' up.'); }, { disabled: index === 0 }),
                        button('Move down', () => { if (moveQuickAction(item.id, 1)) changed('Moved ' + item.title + ' down.'); }, { disabled: index + 1 === siblings.length })),
                    row(button(item.hidden ? 'Show button' : item.origin === 'built-in' ? 'Hide button' : 'Remove button', run(() => {
                        if (item.hidden) recoverQuickAction(item.id);
                        else removeQuickAction(item.id);
                        changed(item.hidden ? 'Button restored.' : 'Button removed from the menu.');
                    })),
                    item.enabled && !item.hidden && pinButton(item))));
            }
            const removed = actions.filter(item => item.removed && matches(item));
            if (removed.length) append(results, details('Recently removed · ' + removed.length,
                removed.map(item => row(h('span', {}, item.title), button('Recover ' + item.title, run(() => {
                    recoverQuickAction(item.id);
                    changed('Recovered ' + item.title + '.');
                }))))));
            if (!results.childElementCount) append(results, h('p', {}, 'No buttons match your search.'));
        }
        renderManagedButtons();
        if (actionLibrary().imports.length) append(body, details('Imported Quick Reply files',
            actionLibrary().imports.map(item => row(h('span', {}, item.name), button('Inspect ' + item.name, run(() => {
                next('import', { inspection: inspectQuickActionImport(item.original), selected: new Set() });
            }))))));
        append(body, row(family && button('Restore this menu', () => next('restore', { scope: family, layout: false })),
            button('Restore full library', () => next('restore', { scope: '', layout: false }))));
    }

    function renderRestore() {
        const scope = ui.scope;
        const preview = quickActionRestorePreview(scope, ui.layout);
        const pins = getPins().filter(pin => !scope || pin.family === scope);
        append(body, row(back('manage'), h('strong', {}, scope ? 'Restore ' + QUICK_ACTION_FAMILIES[scope].name : 'Restore the entire library')),
            field('Restore mode', '', select([
                { label: 'Restore built-in buttons only', value: 'buttons' }, { label: 'Return to shipped layout', value: 'layout' },
            ], ui.layout ? 'layout' : 'buttons', value => next('restore', { layout: value === 'layout' }))),
            h('p', {}, 'Restore built-ins: ' + (preview.restore.map(item => item.title).join(', ') || 'None')),
            ui.layout && h('p', {}, 'Reset button order and archive ' + (preview.archive.map(item => item.title).join(', ') || 'no custom buttons') + '.'),
            ui.layout && h('p', {}, pins.length ? 'Pins removed from this chat · ' + pins.map(pin => pin.title).join(', ')
                : 'This chat has no pins in the selected scope.'),
            button('Apply library restore', run(() => {
                const result = restoreQuickActionLibrary(scope, { layout: ui.layout });
                if (ui.layout) onRestore?.({ family: scope, undoId: actionLibrary().undo?.id, ...result });
                next('manage');
                changed('Library restored. Undo is available.');
            }), { kind: 'primary' }));
    }

    function renderRestoreItem() {
        const item = readQuickAction(ui.restore);
        append(body, row(button('Back to editor', () => next('editor')), h('strong', {}, restoreName(item)),
            ), h('p', {}, 'This restores the name, wording and settings of ' + item.title + '. Named variations remain available.'),
            field('Baseline name', '', readOnly(item.baseline.title)),
            field('Baseline wording', '', readOnly(item.baseline.text || 'Follow live source')),
            item.family === 'steer' && field('Baseline delivery', '', readOnly(
                (item.baseline.delivery?.visibility === 'visible' ? 'Visible OOC' : 'Private system note') +
                (item.baseline.delivery?.required ? ' · Required direction' : ' · Nudge'))),
            button('Confirm button restore', run(() => {
                restoreQuickAction(item.id);
                edit(readQuickAction(item.id));
                changed('Restored ' + item.title + '.');
            }), { kind: 'primary' }));
    }

    function inspect(value, filename) {
        const inspection = inspectQuickActionImport(value, filename);
        next('import', { inspection, selected: new Set() });
    }

    function renderImport() {
        const upload = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: run(async event => {
            const file = event.target.files[0];
            if (file) inspect(await file.text(), file.name);
        }) });
        append(body, row(back('manage'), h('strong', {}, 'Import JSON')),
            field('Select a JSON file', 'Roleplay Instructions library, World Info, or Quick Reply export.',
                button('Choose JSON file', () => {
                    upload.value = '';
                    upload.click();
                }), upload),
            details('Paste JSON instead', textArea(ui.pasted || '', value => { ui.pasted = value; }, { 'aria-label': 'Paste import JSON' }),
                button('Inspect pasted JSON', run(() => inspect(ui.pasted || '', '')))));
        const preview = ui.inspection;
        if (!preview) return;
        append(body, h('strong', {}, preview.name), h('p', {}, preview.entries.length + ' entries · Runs in code'),
            preview.type === 'quick-reply' && h('p', {}, preview.recognized
                ? 'Inspect the visible launcher and automatic hooks. Choose the translations to install.'
                : 'This file can be inspected and preserved as data. It has no verified translations.'),
            preview.entries.map(entry => details(entry.title + ' · ' + entry.kind, h('p', {}, entry.reason),
                entry.triggers?.length && h('p', {}, 'Trigger flags · ' + entry.triggers.join(', ')),
                entry.commands?.length && h('p', {}, 'Commands found · ' + entry.commands.map(command => '/' + command).join(', ')),
                entry.modelCommands?.length && h('p', {}, 'Original script contains model generation commands.'),
                entry.writeCommands?.length && h('p', {}, 'Original writes · ' + entry.writeCommands.map(command => '/' + command).join(', ')),
                entry.requires?.length && h('p', {}, 'State references · ' + entry.requires.join(', ')),
                entry.translation && check('Install this translation', ui.selected.has(entry.id), checked => {
                    if (checked) ui.selected.add(entry.id); else ui.selected.delete(entry.id);
                }),
                entry.translation?.text && readOnly(entry.translation.text),
                entry.tool && onOpenTool && button('Open ' + entry.tool, () => onOpenTool(entry.tool)),
                entry.original && details('Original JSON', readOnly(JSON.stringify(entry.original, null, 2))))),
            button(preview.type === 'quick-reply' ? 'Import reviewed file and selected translations' : 'Import reviewed JSON', run(async () => {
                const result = await importQuickActionData(preview, { selected: [...ui.selected] });
                next('manage', { inspection: null, selected: new Set(), sources: null });
                const count = result.actions + (result.actions === 1 ? ' button.' : ' buttons.');
                changed(result.book ? 'Imported ' + result.book + '. Open Browse to use its sets.'
                    : 'Imported ' + count + (preview.type === 'quick-reply' ? ' Original scripts are available for inspection.' : ''));
            }), { kind: 'primary' }));
    }

    function renderExport() {
        const value = exportQuickActionLibrary();
        const copy = textArea(value, () => {}, { readOnly: true, 'aria-label': 'Library export JSON' });
        append(body, row(back('manage'), h('strong', {}, 'Export library')),
            button('Download library JSON', () => {
                if (!download('roleplay-instructions-quick-actions.json', value)) info('Use the copyable JSON field below.');
            }, { kind: 'primary' }),
            button('Copy library JSON', run(async () => {
                if (!navigator.clipboard?.writeText) {
                    copy.focus();
                    copy.select();
                    info('Use your device’s Copy control for the selected JSON.');
                } else {
                    try { await navigator.clipboard.writeText(value); info('Library JSON copied.'); }
                    catch { copy.focus(); copy.select(); info('Use your device’s Copy control for the selected JSON.'); }
                }
            })),
            field('Library export JSON', '', copy));
    }

    const pages = {
        browse: renderBrowse, manage: renderManage, editor: renderEditor, 'source-preview': renderPreview,
        'restore-item': renderRestoreItem, restore: renderRestore, import: renderImport, export: renderExport,
    };
    function draw() {
        info(ui.error);
        clear(body);
        pages[ui.page]?.();
    }
    library.append(status, body);
    host.append(library);
    draw();
    return library;
}
