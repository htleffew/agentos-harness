// Setup, Presets (DESIGN.md 7): the preset card, the per-feature Ours or Theirs switch, Works alongside,
// the preset's blocks, a read-only document view, its regex scripts and saved loadouts.
// The page registers through B1's page registry, so it appears in today's panel and in B5's shell alike.
import { h, button } from './dom.js';
import { registerPage } from './page-registry.js';
import { presetBlockEditor } from './preset-workbench.js';
import { ctx, on, confirmBox, isChatOpen } from '../st.js';
import { activePreset, enabledV10 } from '../v10.js';
import { FEATURES, plainName, verdictChip, activeProfile } from '../preset-library.js';
import { profileStatus, profileValues, syncProfile, onProfileChange } from '../preset-profiles.js';
import { listLoadouts, saveLoadout, updateLoadout, renameLoadout, deleteLoadout, loadoutConflicts, loadoutName } from '../preset-loadouts.js';
import { ensureLibrary, libraryStatus, switchContext, resolvedSwitches, switchScope, setSwitches, pinSwitches, bulkSwitches,
    bulkUndoAvailable, undoBulkSwitches, featureBlockIds, blockFeatures, workingCopyOff, currentMarker, applyWorkingCopy, restoreWorkingCopy,
    onPresetSelected, syncOwners, onSwitchChange, editPresetBlock, presetBlockRevision } from '../preset-workbench.js';

export const PAGE_ID = 'presets';
const hint = text => h('p', { class: 'ri-help' }, text);
const chip = (text, kind = '') => h('span', { class: `ri-ps-chip${kind ? ' ri-ps-chip-' + kind : ''}` }, text);
const manager = () => ctx().getPresetManager?.('openai');
const state = { status: '', loadoutName: '', renaming: null };

/** Who supplies a feature now, for a feature page or the Features list; a tap opens the switch. */
export function supplierChip(key, app) {
    const context = switchContext();
    const item = context?.features.switched.find(row => row.key === key);
    if (!item) return null;
    const side = resolvedSwitches(context)[key];
    const text = side === 'ours' ? 'Ours' : `Theirs: ${item.blocks.map(block => plainName(block.name)).join(', ')}`;
    return h('button', { type: 'button', class: `ri-ps-chip ri-ps-chip-${side}`, title: 'Change who supplies this feature',
        onclick: () => app?.openPage?.(PAGE_ID, { anchor: `#ri-switch-${key}` }) }, text);
}

function segmented(key, side, onPick) {
    const option = value => h('button', { type: 'button', class: 'ri-ps-seg', 'aria-pressed': String(side === value),
        onclick: () => side !== value && onPick(value) }, value === 'ours' ? 'Ours' : 'Theirs');
    return h('div', { class: 'ri-ps-segmented', role: 'group', 'aria-label': `Who supplies ${FEATURES[key].label}` }, option('ours'), option('theirs'));
}

const size = value => Number(value).toLocaleString('en-US');
const valueText = (key, value) => key === 'openai_max_context' ? `context size ${size(value)}` : `${key.replace(/_/g, ' ')} ${String(value)}`;

/** One line on the card: which profile follows the selected model, what it set and whether she has changed it since. */
function profileRow(follow, libraryProfile) {
    const { active, values, edited, live } = follow;
    if (!active) return libraryProfile ? h('p', { class: 'ri-ps-meta' }, `Model profile: ${plainName(libraryProfile.name)}`)
        : follow.profiles.length ? h('p', { class: 'ri-ps-meta', id: 'ri-profile-line' }, `No model profile follows ${follow.model || 'the selected model'}; the preset's own values stay.`) : null;
    const parts = Object.entries(values).map(([key, value]) => valueText(key, value));
    const note = edited.length ? ` You changed it to ${live === null ? 'another value' : size(live)}; that stays until the model changes.` : '';
    return h('p', { class: 'ri-ps-meta', id: 'ri-profile-line', 'data-profile': active.id },
        `Model profile: ${plainName(active.label)}${parts.length ? `, ${parts.join(', ')}` : ''} (${follow.match === 'exact' ? 'exact match' : 'family match'}).${note} `,
        edited.length ? chip('Edited', 'edited') : null);
}

/** Every model profile stored on the preset, with the one that follows the selected model marked. */
function modelProfiles(follow) {
    if (!follow.profiles.length) return null;
    const now = follow.live === null ? 'not set' : size(follow.live);
    return h('details', { class: 'ri-ps-fold', id: 'ri-model-profiles' }, h('summary', {}, `Model profiles (${follow.profiles.length})`),
        hint(follow.model ? `Selected model: ${follow.model}. Context size now ${now}. A profile sets its values when the model or preset changes and the saved preset file stays as it is.`
            : 'Select a model to see which profile follows it.'),
        follow.profiles.map(item => {
            const values = Object.entries(profileValues(item)).map(([key, value]) => valueText(key, value));
            return h('div', { class: 'ri-ps-line', 'data-profile': item.id }, h('strong', {}, plainName(item.label) || item.id),
                item.id === follow.active?.id ? chip('Follows the selected model', 'on') : null,
                item.models?.length ? chip(item.models.join(', ')) : chip('No model named'),
                h('p', { class: 'ri-ps-meta' }, values.length ? values.join(', ') : 'Sets nothing'));
        }));
}

function presetCard(context, app, rerender) {
    const { edition, marker } = context;
    const model = ctx().getChatCompletionModel?.() || '';
    const profile = activeProfile(edition, model);
    const follow = profileStatus();
    const off = workingCopyOff(context);
    const status = libraryStatus();
    const recognition = marker ? `Loadout of ${marker.base}` : edition ? `${edition.familyLabel}, edition ${edition.label}`
        : status === 'loading' ? 'Reading the preset library' : context.companion ? 'Roleplay Instructions companion preset' : 'Not in the preset library';
    const name = h('input', { class: 'ri-input', value: state.loadoutName, maxLength: 60, 'aria-label': 'Loadout name',
        placeholder: 'Short name, for example Noir nights', oninput: event => { state.loadoutName = event.target.value; preview.textContent = previewText(); save.disabled = !state.loadoutName.trim(); } });
    const save = button('Save as loadout', async () => {
        try {
            const saved = await saveLoadout(manager(), { preset: marker?.base || context.preset, name: state.loadoutName, data: context.data, marker: currentMarker(context) });
            state.loadoutName = ''; state.status = `Saved ${saved}. It is now the selected preset.`;
        } catch (error) { state.status = error.message || String(error); }
        rerender();
    }, { kind: 'primary', disabled: !state.loadoutName.trim() });
    const previewText = () => { try { return `Saves as ${loadoutName(marker?.base || context.preset, state.loadoutName)}`; } catch { return 'Saves as <preset> + RI <name>'; } };
    const preview = h('p', { class: 'ri-help' }, previewText());
    const changes = h('details', { class: 'ri-ps-fold' }, h('summary', {}, 'What changes'),
        marker ? hint('A loadout is sent exactly as saved. The switches below come from its marker.')
            : off.length ? h('ul', {}, off.map(id => context.blocks.find(block => block.id === id)).filter(Boolean)
                .map(block => h('li', {}, `${plainName(block.name)}: off in the working copy`))) : hint('The working copy matches the preset; every listed feature is on Theirs.'),
        h('ul', {}, context.features.switched.map(item => h('li', {}, `${item.label}: ${resolvedSwitches(context)[item.key] === 'ours' ? 'the extension supplies it' : 'the preset supplies it; the extension sends none of its text'}`))));
    const overrides = edition?.overrides?.length ? h('details', { class: 'ri-ps-fold' }, h('summary', {}, `Overrides (${edition.overrides.length})`),
        edition.overrides.map(item => h('div', { class: 'ri-ps-line' }, h('strong', {}, plainName(item.name)), chip(item.kind === 'customization' ? 'Yours' : item.kind), hint(plainName(item.description))))) : null;
    const profiles = modelProfiles(follow);
    const family = edition?.profiles?.length ? h('details', { class: 'ri-ps-fold' }, h('summary', {}, `Profiles in the preset family (${edition.profiles.length})`),
        hint(model ? `Selected model: ${model}. A profile follows the model it names.` : 'Select a model to see which profile follows it.'),
        edition.profiles.map(item => h('div', { class: 'ri-ps-line' }, h('strong', {}, plainName(item.name)),
            item === profile && chip('Follows the selected model', 'on'), item.models.length && chip(item.models.join(', ')), hint(plainName(item.description))))) : null;
    return h('section', { class: 'ri-ps-card', id: 'ri-preset-card' },
        h('div', { class: 'ri-ps-card-head' }, h('strong', { class: 'ri-ps-title' }, plainName(context.preset) || context.preset),
            edition?.distinct && chip('Distinct', 'distinct'), marker && chip('Loadout', 'ours')),
        h('p', { class: 'ri-ps-meta' }, recognition, context.score !== null && !marker ? ` · match ${Math.round(context.score * 100)}%` : ''),
        profileRow(follow, profile),
        edition?.distinct && hint('Evening Truth presets stay distinct presets, one per model.'),
        overrides, profiles, family, changes,
        !context.companion && h('details', { class: 'ri-ps-fold', open: !!state.loadoutName }, h('summary', {}, 'Save as loadout'),
            hint('Writes a new SillyTavern preset with the working copy’s blocks and a hidden marker of every switch. This preset stays as it is.'),
            name, preview, save));
}

function conflictFixes(context, conflict, rerender) {
    return h('div', { class: 'ri-ps-conflict' }, chip('Conflict', 'conflict'),
        h('span', {}, `${conflict.blocks.map(block => plainName(block.name)).join(', ')} is on again in SillyTavern’s prompt manager.`),
        button('Turn the block off', async () => {
            try {
                for (const block of conflict.blocks) await editPresetBlock(context.preset, block.id, { type: 'enabled', value: false, expected: presetBlockRevision(block.id) });
                state.status = 'Block turned off in the loadout.';
            } catch (error) { state.status = error.message || String(error); }
            rerender();
        }), button(`Set ${FEATURES[conflict.key].label} to Theirs`, () => { setSwitches(context, { [conflict.key]: 'theirs' }); state.status = `${FEATURES[conflict.key].label} set to Theirs.`; rerender(); }, { kind: 'ghost' }));
}

function switchList(context, rerender) {
    const switches = resolvedSwitches(context);
    const conflicts = new Map(loadoutConflicts(context.marker, switches, context.blocks, featureBlockIds(context)).map(item => [item.key, item]));
    const owners = blockFeatures(context);
    const scope = switchScope(context);
    const { switched, alongside } = context.features;
    if (context.companion) return h('section', { class: 'ri-ps-switches' }, hint('The Roleplay Instructions companion preset pairs with the extension, so each feature runs once and there is nothing to switch.'));
    const rows = switched.map(item => {
        const side = switches[item.key];
        const theirs = item.blocks.map(block => plainName(block.name)).join(', ');
        const conflict = conflicts.get(item.key);
        const blocksOff = context.marker && side === 'theirs' && item.blocks.every(block => !block.enabled);
        const kept = side === 'ours' && !context.marker ? item.blocks.filter(block => (owners.get(block.id) || []).some(key => switches[key] === 'theirs')) : [];
        return h('div', { class: 'ri-ps-row', id: `ri-switch-${item.key}`, tabindex: -1, 'data-feature': item.key, 'data-side': side },
            h('div', { class: 'ri-ps-row-head' }, h('strong', {}, item.label), verdictChip(item.verdict) && chip(verdictChip(item.verdict), item.verdict === 'contradictory' ? 'conflict' : 'tag'),
                item.matchedBy === 'name' && chip('Matched by block name')),
            h('div', { class: 'ri-ps-sides' },
                h('p', { class: 'ri-ps-side' }, h('b', {}, 'Ours: '), FEATURES[item.key].ours),
                h('p', { class: 'ri-ps-side' }, h('b', {}, 'Theirs: '), theirs)),
            segmented(item.key, side, value => { setSwitches(context, { [item.key]: value }); rerender(); }),
            item.rule && h('p', { class: 'ri-help' }, item.rule),
            kept.length ? hint(`Kept on: ${kept.map(block => `${plainName(block.name)} also serves ${(owners.get(block.id) || [])
                .filter(key => switches[key] === 'theirs').map(key => FEATURES[key].label).join(' and ')}, which is on Theirs`).join('; ')}.`) : null,
            conflict && conflictFixes(context, conflict, rerender),
            blocksOff && h('div', { class: 'ri-ps-conflict' }, chip('Blocks off', 'tag'), h('span', {}, 'This loadout keeps the preset’s blocks for it off.'),
                button('Turn the blocks on', async () => {
                    try { for (const block of item.blocks) await editPresetBlock(context.preset, block.id, { type: 'enabled', value: true, expected: presetBlockRevision(block.id) }); state.status = 'Blocks turned on in the loadout.'; }
                    catch (error) { state.status = error.message || String(error); }
                    rerender();
                })));
    });
    const scopeLine = isChatOpen() ? h('div', { class: 'ri-ps-scope' },
        h('span', {}, scope === 'chat' ? 'Pinned to this chat.' : context.marker ? `Saved in the loadout ${context.preset}.` : `Saved for ${context.edition ? context.edition.label : context.preset}; every chat on it follows.`),
        button(scope === 'chat' ? 'Unpin from this chat' : 'Pin to this chat', () => { pinSwitches(context, scope !== 'chat'); rerender(); }, { kind: 'ghost' }))
        : hint('Open a chat to pin switches to it.');
    const undo = bulkUndoAvailable(context) && button('Undo', () => { undoBulkSwitches(context); state.status = 'Switches restored.'; rerender(); }, { kind: 'ghost' });
    return h('section', { class: 'ri-ps-switches', id: 'ri-preset-switches' },
        h('h4', { class: 'ri-ps-heading' }, `Features both sides offer (${switched.length})`),
        !enabledV10() && hint('Roleplay Instructions is off for this chat, so the extension supplies nothing and the preset is sent as it is.'),
        scopeLine,
        switched.length ? h('div', { class: 'ri-ps-bulk' },
            button('Theirs for everything except memory', () => { bulkSwitches(context, 'theirs'); state.status = 'Theirs for everything except memory.'; rerender(); }, { kind: 'ghost' }),
            button('Ours for everything', () => { bulkSwitches(context, 'ours'); state.status = 'Ours for everything.'; rerender(); }, { kind: 'ghost' }), undo)
            : hint('This preset offers none of the extension’s features, so the extension supplies them all.'),
        rows,
        alongside.length ? h('details', { class: 'ri-ps-fold' }, h('summary', {}, `Works alongside (${alongside.length})`),
            alongside.map(item => h('div', { class: 'ri-ps-line' }, h('strong', {}, item.label), h('span', {}, ` ${item.blocks.map(block => plainName(block.name)).join(', ')}`), item.rule && hint(item.rule)))) : null);
}

function documentView(context) {
    const off = new Set(workingCopyOff(context));
    const order = context.data.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order || [];
    const byId = new Map(context.blocks.map(block => [block.id, block]));
    const parts = order.filter(entry => entry.enabled && !off.has(entry.identifier)).map(entry => byId.get(entry.identifier)).filter(Boolean)
        .map(block => block.marker ? `[${plainName(block.name)}: filled by SillyTavern]` : `## ${plainName(block.name)}\n${block.content}`);
    return h('details', { class: 'ri-ps-fold' }, h('summary', {}, 'Document view of the working copy'),
        hint('Read only. Blocks in their send order with the working copy applied; macros are shown unexpanded.'),
        h('pre', { class: 'ri-ps-doc', tabindex: 0 }, parts.join('\n\n')));
}

function regexScripts(context) {
    const scripts = Array.isArray(context.data.extensions?.regex_scripts) ? context.data.extensions.regex_scripts : [];
    const where = { 1: 'your messages', 2: 'replies', 3: 'slash commands', 5: 'World Info', 6: 'reasoning' };
    return h('details', { class: 'ri-ps-fold' }, h('summary', {}, `Regex scripts the preset carries (${scripts.length})`),
        scripts.length ? scripts.map(script => h('div', { class: 'ri-ps-line' }, h('strong', {}, plainName(script.scriptName) || 'Unnamed script'),
            script.disabled ? chip('Off') : chip('On', 'on'),
            h('p', { class: 'ri-ps-meta' }, `Applies to ${(script.placement || []).map(value => where[value] || `place ${value}`).join(', ') || 'nothing'}`,
                script.promptOnly ? ' · prompt only' : '', script.markdownOnly ? ' · display only' : ''),
            h('code', { class: 'ri-ps-code' }, String(script.findRegex || '')))) : hint('This preset carries no regex scripts.'));
}

function loadoutsSection(rerender) {
    const list = listLoadouts(manager());
    const selected = activePreset();
    return h('section', { class: 'ri-ps-loadouts', id: 'ri-preset-loadouts' }, h('h4', { class: 'ri-ps-heading' }, `Loadouts (${list.length})`),
        list.length ? list.map(item => {
            const short = item.name.startsWith(`${item.marker.base} + RI `) ? item.name.slice(item.marker.base.length + 6) : item.name;
            const ours = Object.entries(item.marker.switches).filter(([, side]) => side === 'ours').map(([key]) => FEATURES[key].label);
            const renaming = state.renaming === item.name;
            const input = h('input', { class: 'ri-input', value: short, maxLength: 60, 'aria-label': `New name for ${item.name}` });
            return h('div', { class: 'ri-ps-line ri-ps-loadout', 'data-loadout': item.name },
                h('strong', {}, plainName(item.name)), item.name === selected && chip('Selected', 'on'),
                h('p', { class: 'ri-ps-meta' }, `Ours: ${ours.join(', ') || 'none'}; ${item.marker.off.length} preset blocks off`),
                renaming ? h('div', { class: 'ri-row ri-row-tight' }, input, button('Rename', async () => {
                    try { const next = await renameLoadout(manager(), item.name, input.value); state.status = `Renamed to ${next}.`; state.renaming = null; }
                    catch (error) { state.status = error.message || String(error); }
                    rerender();
                }, { kind: 'primary' }), button('Cancel', () => { state.renaming = null; rerender(); }, { kind: 'ghost' }))
                    : h('div', { class: 'ri-row ri-row-tight' },
                        button('Rename', () => { state.renaming = item.name; rerender(); }, { kind: 'ghost' }),
                        button('Update', async () => {
                            try {
                                const context = switchContext(selected);
                                if (item.name !== selected || !context) throw new Error('Select this loadout first; Update writes the switches shown above into it.');
                                await updateLoadout(manager(), item.name, context.data, currentMarker(context));
                                state.status = `Updated ${item.name} from the current switches.`;
                            } catch (error) { state.status = error.message || String(error); }
                            rerender();
                        }, { kind: 'ghost', title: 'Update from the current switches', disabled: item.name !== selected }),
                        button('Delete', async () => {
                            if (!await confirmBox(`Delete the preset ${item.name}? SillyTavern removes the file.`)) return;
                            try { await deleteLoadout(manager(), item.name); state.status = `Deleted ${item.name}.`; }
                            catch (error) { state.status = error.message || String(error); }
                            rerender();
                        }, { kind: 'ghost' })));
        }) : hint('Save a working copy as a loadout from the preset card to list it here.'));
}

let redraw = null;
export function renderPresetsPage(body, app) {
    ensureLibrary();
    const host = h('div', { class: 'ri-ps', id: 'ri-presets-page' });
    const rerender = () => { const fresh = h('div'); renderPresetsPage(fresh, app); host.replaceWith(...fresh.childNodes); };
    redraw = rerender;
    const preset = activePreset();
    const context = switchContext(preset);
    if (!preset || !context) {
        host.append(hint(ctx().mainApi && ctx().mainApi !== 'openai' ? 'Presets here are Chat Completion presets. Switch the Main API to Chat Completion.' : 'Select a Chat Completion preset in SillyTavern to see its features.'), loadoutsSection(rerender));
        body.append(host);
        return;
    }
    host.append(h('p', { class: 'ri-help', role: 'status', id: 'ri-presets-status' }, state.status),
        presetCard(context, app, rerender), switchList(context, rerender), presetBlockEditor(preset, app), documentView(context), regexScripts(context), loadoutsSection(rerender));
    body.append(host);
}

let styled = false;
function loadPageStyles() {
    if (styled || !globalThis.document) return;
    styled = true;
    document.head.append(h('link', { rel: 'stylesheet', id: 'ri-presets-page-css', href: new URL('./presets-page.css', import.meta.url).href }));
}

let mounted = false;
export function mountPresetsPage() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    mounted = true;
    loadPageStyles();
    registerPage({ id: PAGE_ID, group: 'setup', label: 'Presets', withoutChat: true, order: 0,
        help: 'Choose Ours or Theirs for each feature the preset also offers, read its blocks and save loadouts.',
        aliases: 'preset ours theirs switch loadout working copy blocks regex document conflict duplicate', render: renderPresetsPage });
    ensureLibrary();
    on('GENERATION_STARTED', () => { try { applyWorkingCopy(); } catch (error) { restoreWorkingCopy(); console.warn('Roleplay Instructions working copy failed.', error); } });
    for (const name of ['CHAT_COMPLETION_PROMPT_READY', 'GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, restoreWorkingCopy);
    on('OAI_PRESET_CHANGED_AFTER', () => { state.status = ''; onPresetSelected(); syncProfile('preset'); });
    for (const name of ['CHATCOMPLETION_MODEL_CHANGED', 'CHATCOMPLETION_SOURCE_CHANGED']) on(name, () => syncProfile('model'));
    onProfileChange(() => { if (document.getElementById('ri-presets-page')) redraw?.(); });
    on('CHAT_CHANGED', () => syncOwners());
    onSwitchChange(() => document.dispatchEvent(new CustomEvent('ri-preset-switch-change')));
}
try { mountPresetsPage(); } catch (error) { console.warn('Roleplay Instructions could not add Setup, Presets.', error); }
