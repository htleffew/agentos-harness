// Setup, Presets (DESIGN.md 7): the preset card, the block bank and stack, Works alongside, a read-only document view,
// its regex scripts and saved loadouts.
// The page registers through B1's page registry, so it appears in today's panel and in B5's shell alike.
import { h, button } from './dom.js';
import { registerPage } from './page-registry.js';
import { home } from './homes.js';
import { ctx, on, confirmBox } from '../st.js';
import { activePreset, enabledV10 } from '../v10.js';
import { FEATURES, plainName, activeProfile } from '../preset-library.js';
import { profileStatus, profileValues, syncProfile, onProfileChange } from '../preset-profiles.js';
import { listLoadouts, saveLoadoutFromContext, updateLoadoutFromContext, renameLoadout, deleteLoadout, loadoutName } from '../preset-loadouts.js';
import { ensureLibrary, libraryStatus, switchContext, workingPlan, applyWorkingCopy, restoreWorkingCopy,
    onPresetSelected, syncOwners, onSwitchChange } from '../preset-workbench.js';
import { featureState } from '../preset-bank.js';
import { installBankHooks } from '../preset-bank.js';
import { bankAndStack } from './preset-bank.js';

export const PAGE_ID = 'presets';
const hint = text => h('p', { class: 'ri-help' }, text);
const chip = (text, kind = '') => h('span', { class: `ri-ps-chip${kind ? ' ri-ps-chip-' + kind : ''}` }, text);
const manager = () => ctx().getPresetManager?.('openai');
const state = { status: '', loadoutName: '', renaming: null };
const STATE_LABEL = { ri: 'RI', preset: 'Preset', both: 'Both', off: 'Off' };
const laneId = key => `ri-bk-lane-${String(key).replace(/[^a-zA-Z0-9_-]+/g, '_')}`;
const until = async (find, tries = 40) => { for (let i = 0; i < tries; i++) { const node = find(); if (node) return node; await new Promise(done => setTimeout(done, 50)); } return null; };

/** Open Setup, Presets on one feature's lane in the By feature view of the bank. */
export async function openFeatureLane(key, app) {
    const view = app || (await import('./panel.js')).app;
    await view.openPage(PAGE_ID);
    const press = async selector => {
        const node = await until(() => document.querySelector(selector));
        if (node && node.getAttribute('aria-pressed') !== 'true') node.click();
    };
    // Narrow, the bank is its own view beside the stack; wide, both show and the toggle is hidden.
    const bankTab = await until(() => document.querySelector('#ri-bk-view-bank'));
    if (bankTab?.offsetParent) await press('#ri-bk-view-bank');
    await press('[data-focus-key="bankview|feature"]');
    const lane = await until(() => document.getElementById(laneId(key)));
    if (!lane) return false;
    lane.tabIndex = -1;
    lane.scrollIntoView({ block: 'start' });
    lane.focus({ preventScroll: true });
    return true;
}

/** Who supplies a feature now, read from the stack: RI, Preset, Both or Off. A tap lands on the feature in the By feature view. */
export function supplierChip(key, app) {
    const context = switchContext();
    const plan = context && !context.companion ? workingPlan(context)?.plan : null;
    if (!plan || !FEATURES[key]) return null;
    const { state: supplier } = featureState(plan, key);
    return h('button', { type: 'button', class: `ri-ps-chip ri-ps-chip-${supplier}`, 'data-supplier': supplier, title: `See ${FEATURES[key].label} in the bank, by feature`,
        onclick: () => { openFeatureLane(key, app); } }, `${FEATURES[key].label}: ${STATE_LABEL[supplier]}`);
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
    const status = libraryStatus();
    const recognition = marker ? `Loadout of ${marker.base}` : edition ? `${edition.familyLabel}, edition ${edition.label}`
        : status === 'loading' ? 'Reading the preset library' : context.companion ? 'Roleplay Instructions companion preset' : 'Not in the preset library';
    const name = h('input', { class: 'ri-input', value: state.loadoutName, maxLength: 60, 'aria-label': 'Loadout name',
        placeholder: 'Short name, for example Noir nights', oninput: event => { state.loadoutName = event.target.value; preview.textContent = previewText(); save.disabled = !state.loadoutName.trim(); } });
    const save = button('Save as loadout', async () => {
        try {
            const saved = await saveLoadoutFromContext(manager(), state.loadoutName, context);
            state.loadoutName = ''; state.status = `Saved ${saved}. It is now the selected preset.`;
        } catch (error) { state.status = error.message || String(error); }
        rerender();
    }, { kind: 'primary', disabled: !state.loadoutName.trim() });
    const previewText = () => { try { return `Saves as ${loadoutName(marker?.base || context.preset, state.loadoutName)}`; } catch { return 'Saves as <preset> + RI <name>'; } };
    const preview = h('p', { class: 'ri-help' }, previewText());
    const changes = h('details', { class: 'ri-ps-fold' }, h('summary', {}, 'What changes'),
        marker ? hint('A loadout is sent exactly as saved.') : hint('The working copy matches the preset; the stack above decides what is sent.'));
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
            hint('Writes a new SillyTavern preset with the stack’s blocks in your order and a hidden marker of the stack and your versions. This preset stays as it is.'),
            name, preview, save));
}

function alongsideList(context) {
    const { alongside } = context.features;
    if (context.companion || !alongside.length) return null;
    return h('details', { class: 'ri-ps-fold', id: 'ri-preset-alongside' }, h('summary', {}, `Works alongside (${alongside.length})`),
        !enabledV10() && hint('Roleplay Instructions is off for this chat, so the extension supplies nothing and the preset is sent as it is.'),
        alongside.map(item => h('div', { class: 'ri-ps-line' }, h('strong', {}, item.label), h('span', {}, ` ${item.blocks.map(block => plainName(block.name)).join(', ')}`), item.rule && hint(item.rule))));
}

function documentView(context) {
    const order = context.data.prompt_order?.find?.(group => String(group?.character_id) === '100001')?.order || [];
    const byId = new Map(context.blocks.map(block => [block.id, block]));
    const parts = order.filter(entry => entry.enabled).map(entry => byId.get(entry.identifier)).filter(Boolean)
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

const stackSummary = marker => {
    const cards = [...marker.stack.cards, ...marker.stack.ri];
    const mine = Object.keys(marker.versions).length;
    return `${cards.filter(card => card.on).length} cards on, ${cards.filter(card => !card.on).length} off${mine ? `, ${mine} of your versions` : ''}`;
};

function loadoutsSection(rerender) {
    const list = listLoadouts(manager());
    const selected = activePreset();
    return h('section', { class: 'ri-ps-loadouts', id: 'ri-preset-loadouts' }, h('h4', { class: 'ri-ps-heading' }, `Loadouts (${list.length})`),
        list.length ? list.map(item => {
            const short = item.name.startsWith(`${item.marker.base} + RI `) ? item.name.slice(item.marker.base.length + 6) : item.name;
            const ours = Object.entries(item.marker.switches).filter(([, side]) => side === 'ours').map(([key]) => FEATURES[key].label);
            const both = Object.entries(item.marker.switches).filter(([, side]) => side === 'both').map(([key]) => FEATURES[key].label);
            const renaming = state.renaming === item.name;
            const input = h('input', { class: 'ri-input', value: short, maxLength: 60, 'aria-label': `New name for ${item.name}` });
            return h('div', { class: 'ri-ps-line ri-ps-loadout', 'data-loadout': item.name },
                h('strong', {}, plainName(item.name)), item.name === selected && chip('Selected', 'on'),
                h('p', { class: 'ri-ps-meta' }, item.marker.stack ? stackSummary(item.marker)
                    : `Ours: ${ours.join(', ') || 'none'}${both.length ? `; Both: ${both.join(', ')}` : ''}; ${item.marker.off.length} preset blocks off`),
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
                                if (item.name !== selected || !context) throw new Error('Select this loadout first; Update writes the stack shown above into it.');
                                await updateLoadoutFromContext(manager(), item.name, context);
                                state.status = `Updated ${item.name} from its stack.`;
                            } catch (error) { state.status = error.message || String(error); }
                            rerender();
                        }, { kind: 'ghost', title: 'Update from the current stack', disabled: item.name !== selected }),
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
        presetCard(context, app, rerender), home('feature-owner', bankAndStack(app)), alongsideList(context), documentView(context), regexScripts(context), loadoutsSection(rerender));
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
        help: 'Build the stack the next request sends from the bank of every preset block, the extension’s cards and your versions; save loadouts.',
        aliases: 'preset bank stack block version compare feature supplier loadout working copy blocks regex document conflict duplicate', render: renderPresetsPage });
    ensureLibrary();
    installBankHooks();
    on('GENERATION_STARTED', () => { try { applyWorkingCopy(); } catch (error) { restoreWorkingCopy(); console.warn('Roleplay Instructions working copy failed.', error); } });
    for (const name of ['CHAT_COMPLETION_PROMPT_READY', 'GENERATION_ENDED', 'GENERATION_STOPPED']) on(name, restoreWorkingCopy);
    on('OAI_PRESET_CHANGED_AFTER', () => { state.status = ''; onPresetSelected(); syncProfile('preset'); });
    for (const name of ['CHATCOMPLETION_MODEL_CHANGED', 'CHATCOMPLETION_SOURCE_CHANGED']) on(name, () => syncProfile('model'));
    onProfileChange(() => { if (document.getElementById('ri-presets-page')) redraw?.(); });
    on('CHAT_CHANGED', () => syncOwners());
    onSwitchChange(() => document.dispatchEvent(new CustomEvent('ri-preset-switch-change')));
}
try { mountPresetsPage(); } catch (error) { console.warn('Roleplay Instructions could not add Setup, Presets.', error); }
