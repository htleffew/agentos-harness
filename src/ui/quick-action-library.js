import { taskLabels } from './destinations.js';
import {
    actionLibrary, applyQuickActionVariation, editQuickActionSource, linkedQuickAction, listQuickActions, loadQuickActionSources, moveQuickAction,
    QUICK_ACTION_FAMILIES, QUICK_ACTION_VARIABLES, quickActionOwner, quickActionRestorePreview, quickActionScope, readQuickAction, recoverQuickAction,
    relinkQuickAction, removeQuickAction, resolveQuickAction, restoreQuickAction, restoreQuickActionLibrary, rollQuickAction,
    resolveQuickActionText, saveQuickAction, saveQuickActionVariation, standaloneQuickAction, undoQuickActionLibrary,
} from '../quick-actions.js';
import { exportQuickActionLibrary, importQuickActionData, inspectQuickActionImport } from '../quick-action-import.js';
import { add, button, captureView, clear, download, field, h, insertAtCursor, restoreView, select, textArea, textInput } from './dom.js';
import { composerBar, costWords, kindOf, pinToBar, QUICK_ACTION_KINDS } from '../quick-actions.js';
import { registerPage } from './page-registry.js';
import { renderBar } from './composer-bar.js';
import { renderBarPage } from './quick-action-bar-editor.js';
import { connectionOperation, draftError, draftOf, draftToAction, KIND_ORDER, NAME_LIMIT, renderActionEditor } from './quick-action-fields.js';

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

/** Mount the library in a quick action sheet or the extension panel. */
export function renderQuickActionLibrary(host, {
    family = 'steer', mode = 'browse', state = {}, onSelect, onChange, onPin, onCancelPending,
    onRestore, onUndo, onOpenTool, onClose, onNavigate, getPins = () => [], selectionOnly = false, initialDirection = '',
} = {}) {
    if (selectionOnly) { onPin=undefined; mode='browse'; }
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
    const drafts=ui.drafts ||= new Map();
    const draftKey=action=>action?.id || `new:${action.family}`;
    const isEdited=()=>ui.page==='editor' && ui.edit && JSON.stringify(ui.edit)!==JSON.stringify(ui.original);
    function keepDraft() {
        if (isEdited()) drafts.set(draftKey(ui.edit),{edit:ui.edit,original:ui.original});
    }
    const next = (page, properties = {}) => {
        if (page!=='editor') keepDraft();
        if (page==='browse' && ui.page!=='browse') ui.sources = null;
        Object.assign(ui, { page, error: '', ...properties });
        draw();
        const title = body.querySelector('[data-ri-library-editor-title]');
        const scroll = library.closest('.ri-quick-scroll');
        if (scroll) scroll.scrollTop = 0;
        else (title || library).scrollIntoView({block:'start'});
        title?.focus({preventScroll:true});
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
    if (ui.reenter || !ui.page || ui.family !== family || ui.root !== initial) {
        keepDraft();
        Object.assign(ui, { family, root: initial, page: initial, search: '', preview: null, error: '', reenter:false });
        if (initial === 'editor') Object.assign(ui,editorState({family:sourceFamily,text:initialDirection}));
    }
    const tab = name => button(name === 'manage' ? taskLabels.manage : taskLabels.browse, () => onNavigate(name));
    const back = (page = ui.root === 'editor' ? 'manage' : ui.root) => button('Back to library', () => {
        const origin=ui.page==='editor' && ui.editorOrigin?.page===page && ui.editorOrigin.view;
        next(page);
        if (origin) restoreView(library.closest('.ri-quick-scroll, .ri-body'),origin);
    });
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

    function editorState(action) {
        const original=actionOptions(action);
        return drafts.get(draftKey(original)) || {edit:structuredClone(original),original};
    }

    function edit(action,{replace=false}={}) {
        if (['manage','browse'].includes(ui.page)) {
            ui.editorOrigin={page:ui.page,view:captureView(library.closest('.ri-quick-scroll, .ri-body'))};
        }
        if (replace) drafts.delete(draftKey(action));
        else keepDraft();
        next('editor', { ...editorState(action), variant: '', compare: false });
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
        append(body, row(tab('manage'), !selectionOnly && addButtons()), search, pool);
        function renderPool() {
            clear(pool);
            const query = ui.search.trim().toLowerCase();
            const matches = actionMatches(query);
            const actions = listQuickActions(family).filter(action=>(onCancelPending || action.operation!=='queue') && matches(action));
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
                    !selectionOnly && button('Edit ' + action.title, () => edit(action)),
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
                row(onSelect && button('Select direction', run(() => {
                    if (!current.edited.trim()) throw new Error('Enter a direction before selecting it.');
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
                    !selectionOnly && button('Make standalone copy', run(() => {
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
                !selectionOnly && source.source && button('Relink', () => next('browse', { relink: source.id })),
                wording && !selectionOnly && button('Make standalone copy', run(() => {
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
        if (!selectionOnly && source?.origin === 'source' && (source.version !== undefined || source.itemId)) {
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
        const discard=button('Discard draft',()=>{
            drafts.delete(draftKey(draft));
            ui.edit=structuredClone(ui.original);
            draw();
        },{kind:'ghost'});
        discard.dataset.riActionDiscard='';
        discard.hidden=!isEdited();
        let variable = 'user';
        append(body, row(back('manage'), h('h3',{'data-ri-library-editor-title':'',tabIndex:-1},
            item ? `Edit ${item.title}` : QUICK_ACTION_FAMILIES[draft.family].add)),
            h('p',{class:'ri-help'},'Extension-wide · Saves to your library across chats. Pins and queued directions belong to this chat.'),
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
                drafts.delete(draftKey(draft));
                ui.original=structuredClone(draft);
                next('manage');
                changed('Saved ' + saved.title + '.', saved);
            }), { kind: 'primary' }),discard,
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
                    edit(saved,{replace:true});
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
                edit(saved,{replace:true});
                changed('Applied ' + variant.name + '.', saved);
            }))))));
    }

    function renderManage() {
        const actions = listQuickActions(family, { includeHidden: true });
        const results = block();
        append(body, field('Find a button to manage', '', textInput(ui.manageSearch || '', value => {
            ui.manageSearch = value;
            renderManagedButtons();
        }, { type: 'search' })), row(onNavigate && tab('browse'), addButtons()),
            row(button('Import JSON', () => next('import')),
                button('Export library', () => next('export')),
                actionLibrary().undo && button('Undo last library change', run(() => {
                    const undoId = actionLibrary().undo?.id;
                    if (undoQuickActionLibrary()) onUndo?.(undoId);
                    changed('Previous library restored.');
                }))), results);
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
                    row(h('span', { class: 'ri-help' }, quickActionOwner(item)), destinationLabel(item),
                        drafts.has(item.id) && h('span',{class:'ri-help'},'Unsaved draft')),
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
                edit(readQuickAction(item.id),{replace:true});
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
    for (const event of ['input','change']) body.addEventListener(event,()=>{
        const discard=body.querySelector('[data-ri-action-discard]');
        if (discard) discard.hidden=!isEdited();
    });
    library.append(status, body);
    host.append(library);
    draw();
    return library;
}

// ---------------------------------------------------------------------------------------------
// Quick actions, Library (DESIGN.md 4.3 and 4.7). One page lists every quick action by kind, with Pin, Edit,
// Duplicate and Delete on each row, plus Import and Export; Edit opens the editor of 4.3 in the same page.
// ---------------------------------------------------------------------------------------------
const view = { mode: 'list', id: '', kind: '', draft: null, original: null, wantPinned: false, query: '', message: '', error: '', inspection: null, selected: new Set(), pasted: '' };
const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
const iconOf = action => action.icon || QUICK_ACTION_KINDS[kindOf(action)]?.icon || 'fa-star';

/** Open the editor for a saved quick action the next time the Library page renders (the bar's Edit buttons call this). */
export function requestQuickActionEdit(id) {
    Object.assign(view, { mode: 'edit', id, kind: '', draft: null, original: null, error: '', message: '', query: '' });
}

/** Open the editor for a new quick action of a kind. */
export function requestNewQuickAction(kind) {
    Object.assign(view, { mode: 'edit', id: '', kind, draft: null, original: null, error: '', message: '', query: '' });
}

/** A copy of a saved action as a new standalone one; the copy keeps its kind and settings. */
export function duplicateQuickAction(id) {
    const source = readQuickAction(id);
    if (!source) return null;
    const draft = draftOf(source);
    delete draft.id;
    delete draft.family;
    delete draft.hidden;
    draft.title = `${source.title} copy`.slice(0, NAME_LIMIT).trim();
    return saveQuickAction({ ...draftToAction({ ...draft, barOnly: source.barOnly }), origin: 'standalone' });
}

const pinnedNow = id => composerBar().pins.includes(id);

function matchesQuery(query) {
    const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    return action => {
        const text = [action.title, QUICK_ACTION_KINDS[kindOf(action)]?.name, action.text, action.prompt, action.category].join(' ').toLowerCase();
        return words.every(word => text.includes(word));
    };
}

export function renderLibraryPage(body, app) {
    const host = h('div', { class: 'ri-qa-page ri-qa-library-page', id: 'ri-qa-library' });
    body.append(host);
    const say = text => { view.message = text; view.error = ''; };
    const fail = error => { view.error = error?.message || String(error); view.message = ''; };
    const open = (page, options) => app?.openPage?.(page, { focusPage: true, ...options });
    const openConnections = () => open('settings', { anchor: `#ri-model-request-settings [data-ri-operation="${connectionOperation(view.draft?.kind)}"]` });
    const openPrompts = async () => { if (!await open('prompts')) await open('v10'); };
    const refreshBar = () => { try { renderBar(); } catch { /* the bar is not mounted yet */ } };
    const live = () => h('p', { class: view.error ? 'ri-qa-error' : 'ri-help', role: view.error ? 'alert' : 'status', 'aria-live': 'polite' }, view.error || view.message);

    function draw(focusSelector) {
        const parts = view.mode === 'edit' ? drawEditor() : view.mode === 'import' ? drawImport() : drawList();
        host.replaceChildren(...[parts].flat(Infinity).filter(Boolean));
        if (focusSelector) host.querySelector(focusSelector)?.focus({ preventScroll: true });
    }

    function drawList() {
        const matches = matchesQuery(view.query);
        const all = listQuickActions('', { allKinds: true, includeHidden: true });
        const active = all.filter(action => !action.removed && !action.hidden);
        const gone = all.filter(action => action.removed || action.hidden);
        const undo = actionLibrary().undo;
        const kindPick = h('select', { class: 'ri-input', 'aria-label': 'Kind of quick action to add', 'data-ri-new-kind': '' },
            KIND_ORDER.map(kind => h('option', { value: kind }, QUICK_ACTION_KINDS[kind].name)));
        const groups = KIND_ORDER.map(kind => {
            const rows = active.filter(action => kindOf(action) === kind && matches(action));
            if (!rows.length) return null;
            const def = QUICK_ACTION_KINDS[kind];
            return h('details', { class: 'ri-qa-details', open: true, 'data-kind': kind },
                h('summary', {}, icon(def.icon), ` ${def.name} · ${rows.length}`),
                h('p', { class: 'ri-help' }, costWords(kind)),
                h('ul', { class: 'ri-qa-list' }, rows.map(listItem)));
        }).filter(Boolean);
        return [
            h('div', { class: 'ri-qa-head' }, icon('fa-bolt'), h('span', { class: 'ri-qa-head-title' }, 'Library'), h('span', { class: 'ri-qa-pill' }, `${active.length} QUICK ACTIONS`)),
            h('p', { class: 'ri-help' }, 'Every quick action, by kind. Pin the ones you use to the bar; edit a name, icon, prompt or direction once and play needs no setup.'),
            h('div', { class: 'ri-qa-row' }, kindPick,
                h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-ri-new': '', onclick: () => { requestNewQuickAction(kindPick.value); draw(); } }, 'Add')),
            h('div', { class: 'ri-qa-row' },
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-import': '', onclick: () => { Object.assign(view, { mode: 'import', inspection: null, selected: new Set(), error: '', message: '' }); draw(); } }, 'Import'),
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-export': '', onclick: exportLibrary }, 'Export'),
                undo && h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-undo': '', onclick: () => { if (undoQuickActionLibrary()) { say('Restored the library as it was.'); refreshBar(); draw(); } } }, `Undo: ${undo.label}`)),
            textInput(view.query, value => { view.query = value; refilter(); }, { type: 'search', placeholder: 'Search quick actions', 'aria-label': 'Search quick actions' }),
            live(),
            h('div', { class: 'ri-qa-groups' }, groups.length ? groups : h('p', { class: 'ri-help' }, view.query ? 'No quick action matches. Try another word.' : 'No quick actions yet. Add one above.')),
            gone.length ? h('details', { class: 'ri-qa-details', 'data-ri-deleted': '' }, h('summary', {}, `Deleted · ${gone.length}`),
                h('ul', { class: 'ri-qa-list' }, gone.map(action => h('li', { class: 'ri-qa-item', 'data-action-id': action.id },
                    h('span', { class: 'ri-qa-pin-text' }, h('strong', {}, action.title), h('span', { class: 'ri-help' }, QUICK_ACTION_KINDS[kindOf(action)]?.name)),
                    h('button', { type: 'button', class: 'ri-bar-btn', 'aria-label': `Restore ${action.title}`, onclick: () => { recoverQuickAction(action.id); say(`${action.title} restored.`); refreshBar(); draw(); } }, 'Restore'))))) : null,
        ];
    }

    // Typing in the search box redraws the groups only, so the box keeps its focus and cursor.
    function refilter() {
        const search = host.querySelector('input[type="search"]');
        const hadFocus = document.activeElement === search;
        const caret = search?.selectionStart;
        draw();
        const fresh = host.querySelector('input[type="search"]');
        if (hadFocus && fresh) { fresh.focus({ preventScroll: true }); fresh.setSelectionRange?.(caret, caret); }
    }

    function listItem(action) {
        const kind = kindOf(action);
        const pinned = pinnedNow(action.id);
        const status = action.status && !['Default', 'First saved version', 'Follows source'].includes(action.status) ? action.status : '';
        const control = (label, onClick, extra = {}) => h('button', { type: 'button', class: 'ri-bar-btn', 'aria-label': `${label} ${action.title}`, onclick: onClick, ...extra }, label);
        return h('li', { class: 'ri-qa-item', 'data-action-id': action.id, 'data-kind': kind, 'data-ink': QUICK_ACTION_KINDS[kind]?.ink || 'setup' },
            h('span', { class: 'ri-qa-pin-icon' }, icon(iconOf(action)), kind === 'options' && h('span', { class: 'ri-qa-dot', 'aria-hidden': 'true' })),
            h('span', { class: 'ri-qa-pin-text' }, h('strong', {}, action.title),
                h('span', { class: 'ri-help' }, [costWords(kind), status, pinned ? 'On the bar' : ''].filter(Boolean).join(' · '))),
            h('span', { class: 'ri-qa-item-actions' },
                control(pinned ? 'Unpin' : 'Pin', () => {
                    pinToBar(action.id, !pinned);
                    say(`${action.title} ${pinned ? 'unpinned' : 'pinned'}.`);
                    refreshBar();
                    draw(`[data-action-id="${CSS.escape(action.id)}"] [data-ri-pin]`);
                }, { 'data-ri-pin': '', 'aria-pressed': String(pinned) }),
                control('Edit', () => { requestQuickActionEdit(action.id); draw(); bringIntoView(); }, { 'data-ri-edit': '' }),
                control('Duplicate', () => {
                    try { const copy = duplicateQuickAction(action.id); say(`Duplicated as ${copy.title}.`); } catch (error) { fail(error); }
                    draw();
                }, { 'data-ri-duplicate': '' }),
                control('Delete', () => {
                    removeQuickAction(action.id);
                    say(`${action.title} deleted. Undo is at the top.`);
                    refreshBar();
                    draw();
                }, { 'data-ri-delete': '' })));
    }

    const bringIntoView = () => host.scrollIntoView?.({ block: 'start' });

    async function exportLibrary() {
        const value = exportQuickActionLibrary();
        if (download('roleplay-instructions-quick-actions.json', value)) say('Exported the library as a JSON file.');
        else fail(new Error('This device would not download the file. Copy the JSON below instead.'));
        draw();
        if (view.error) host.append(h('textarea', { class: 'ri-input ri-textarea', readOnly: true, rows: 6, 'aria-label': 'Library export JSON', value }));
    }

    function drawEditor() {
        let action = view.id ? readQuickAction(view.id) : null;
        if (view.id && !action) { Object.assign(view, { mode: 'list', id: '', draft: null }); return drawList(); }
        const kind = action ? kindOf(action) : view.kind;
        if (!view.draft) {
            view.draft = draftOf(action, kind);
            view.original = action ? structuredClone(view.draft) : null;
            view.wantPinned = action ? pinnedNow(action.id) : false;
        }
        const draft = view.draft;
        const editor = h('div', { class: 'ri-qa-editor' });
        renderActionEditor(editor, {
            draft, original: action, pinned: view.wantPinned, onPinned: on => { view.wantPinned = on; },
            openConnections, openPrompts, openBar: () => open('quick-bar'),
        });
        const back = () => { Object.assign(view, { mode: 'list', id: '', draft: null, original: null, error: '' }); draw(); bringIntoView(); };
        const errorLine = h('p', { class: 'ri-qa-error', role: 'alert' });
        const save = () => {
            const problem = draftError(draft, action?.title || '');
            if (problem) { errorLine.textContent = problem; editor.querySelector('input')?.focus({ preventScroll: true }); return; }
            try {
                const saved = saveQuickAction(draftToAction(draft));
                if (view.wantPinned !== pinnedNow(saved.id)) pinToBar(saved.id, view.wantPinned);
                refreshBar();
                Object.assign(view, { mode: 'list', id: '', draft: null, original: null });
                say(`Saved ${saved.title}.`);
                draw();
                bringIntoView();
            } catch (error) { errorLine.textContent = error.message || String(error); }
        };
        const restore = action?.origin === 'built-in' && action.changed
            ? h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-restore': '', onclick: () => {
                restoreQuickAction(action.id);
                view.draft = null;
                say(`${action.title} restored to its built-in settings.`);
                refreshBar();
                draw();
            } }, 'Restore built-in settings') : null;
        return [
            h('nav', { class: 'ri-qa-crumbs', 'aria-label': 'Breadcrumb' },
                h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', onclick: back }, 'Library'),
                h('span', { 'aria-hidden': 'true' }, ' › '),
                h('span', { class: 'ri-qa-head-title', 'data-ri-editor-title': '', tabIndex: -1 }, action ? `Edit ${action.title}` : `New ${QUICK_ACTION_KINDS[kind].name}`)),
            editor, errorLine,
            h('div', { class: 'ri-qa-row ri-qa-foot' },
                h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-ri-save': '', onclick: save }, 'Save quick action'),
                h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-cancel': '', onclick: back }, 'Cancel'), restore),
        ];
    }

    function drawImport() {
        const back = () => { view.mode = 'list'; view.inspection = null; draw(); };
        const inspect = (value, name) => {
            try { view.inspection = inspectQuickActionImport(value, name); view.error = ''; } catch (error) { view.inspection = null; fail(error); }
            draw();
        };
        const upload = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async event => {
            const file = event.target.files[0];
            if (file) inspect(await file.text(), file.name);
        } });
        const preview = view.inspection;
        return [
            h('nav', { class: 'ri-qa-crumbs', 'aria-label': 'Breadcrumb' },
                h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-text', onclick: back }, 'Library'), h('span', { 'aria-hidden': 'true' }, ' › '),
                h('span', { class: 'ri-qa-head-title' }, 'Import')),
            h('p', { class: 'ri-help' }, 'A Roleplay Instructions library, a World Info book or a Quick Reply export. You review what is in the file before anything is added.'),
            h('div', { class: 'ri-qa-row' }, h('button', { type: 'button', class: 'ri-bar-btn', 'data-ri-choose-file': '', onclick: () => { upload.value = ''; upload.click(); } }, 'Choose a JSON file'), upload),
            h('details', { class: 'ri-qa-details' }, h('summary', {}, 'Paste JSON instead'),
                textArea(view.pasted, value => { view.pasted = value; }, { 'aria-label': 'Paste import JSON', rows: 5 }),
                h('button', { type: 'button', class: 'ri-bar-btn', onclick: () => inspect(view.pasted, '') }, 'Review pasted JSON')),
            live(),
            preview && [
                h('h4', { class: 'ri-qa-section-title' }, preview.name),
                h('p', { class: 'ri-help' }, `${preview.entries.length} ${preview.entries.length === 1 ? 'entry' : 'entries'} · Runs in code`),
                preview.entries.slice(0, 40).map(entry => h('details', { class: 'ri-qa-details' }, h('summary', {}, `${entry.title} · ${entry.kind}`),
                    h('p', { class: 'ri-help' }, entry.reason || ''),
                    entry.translation && h('label', { class: 'ri-qa-switch' }, h('input', { type: 'checkbox', checked: view.selected.has(entry.id), onchange: event => {
                        if (event.target.checked) view.selected.add(entry.id); else view.selected.delete(entry.id);
                    } }), h('span', {}, 'Install this translation')))),
                h('button', { type: 'button', class: 'ri-bar-btn ri-bar-btn-primary', 'data-ri-import-now': '', onclick: async () => {
                    try {
                        const result = await importQuickActionData(preview, { selected: [...view.selected] });
                        view.mode = 'list';
                        view.inspection = null;
                        say(result.book ? `Imported ${result.book}.` : `Imported ${result.actions} ${result.actions === 1 ? 'quick action' : 'quick actions'}.`);
                        refreshBar();
                    } catch (error) { fail(error); }
                    draw();
                } }, 'Import reviewed file'),
            ],
        ];
    }

    draw();
    if (view.mode === 'edit') host.querySelector('[data-ri-editor-title]')?.focus({ preventScroll: true });
}

// Both pages register through B1's page registry, so they join today's panel without an edit to panel.js and B5's
// Quick actions tab places them by `tab` and `nested`.
registerPage({ id: 'quick-bar', group: 'quick', label: 'Bar', tab: 'bar', withoutChat: true,
    help: 'Choose which quick actions sit above the message box and in what order, globally or for this chat.',
    aliases: 'composer bar pins move up move down unpin this chat global overflow more toolbar', render: (body, app) => renderBarPage(body, app) });
registerPage({ id: 'quick-library', group: 'quick', label: 'Library', tab: 'library', withoutChat: true,
    help: 'Every quick action by kind: pin, edit, duplicate, delete, import and export.',
    aliases: 'quick actions edit options swipe continue impersonate direction action check review prompt icon import export library', render: (body, app) => renderLibraryPage(body, app) });
