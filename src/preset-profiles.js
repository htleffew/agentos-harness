// Per-model profiles (DESIGN.md 7, ticket B23). B18 stores each retired preset's context size, and image settings that
// differed, as a model profile in extensions.roleplay_instructions.modelProfiles on the preset that stays. This module
// applies the matching profile to SillyTavern's live settings when the selected model or preset changes. The saved preset
// file never changes: values go to the live settings object and the host's own controls only.
import { ctx } from './st.js';
import { activePreset } from './v10.js';
import { storedProfiles, profileForModel, entriesOf, contextOf, CONTEXT_FIELD } from './preset-cleanup.js';

// Host controls that mirror a live setting. A value with no control here is written to the live settings object alone.
const CONTROLS = Object.freeze({
    [CONTEXT_FIELD]: '#openai_max_context',
    inline_image_quality: '#openai_inline_image_quality',
    media_inlining: '#openai_media_inlining',
    request_images: '#openai_request_images',
});

const lower = value => String(value ?? '').trim().toLowerCase();
/** The model name without its provider path: "z-ai/glm-5.1" gives "glm-5.1". */
const bareModel = model => lower(model).split('/').pop();

/**
 * The profile that follows a model. An exact match names the model itself (the whole id or its name without the provider);
 * otherwise the closest family match of B18 applies (a tag such as glm inside the model name).
 * Returns { profile, match: 'exact' | 'family' } or null.
 */
export function matchProfile(data, model) {
    const name = lower(model);
    if (!name) return null;
    const list = storedProfiles(data);
    if (!list.length) return null;
    const bare = bareModel(model);
    const exact = list.filter(item => (item.models || []).some(tag => [name, bare].includes(lower(tag))));
    if (exact.length) return { profile: exact.find(item => item.current) || exact[0], match: 'exact' };
    const family = profileForModel(data, model);
    return family ? { profile: family, match: 'family' } : null;
}

/** The live values a profile carries: its context size when it has one, then every kept setting. */
export function profileValues(profile) {
    const values = {};
    const context = Number(profile?.contextSize);
    if (profile?.contextSize !== null && profile?.contextSize !== undefined && profile?.contextSize !== '' && Number.isFinite(context) && context > 0) values[CONTEXT_FIELD] = context;
    for (const [key, value] of Object.entries(profile?.settings && typeof profile.settings === 'object' ? profile.settings : {})) {
        if (key !== CONTEXT_FIELD && value !== undefined && typeof value !== 'object') values[key] = value;
    }
    return values;
}

/** Write one live value, through the host's own control when the page has it so its counters and handlers follow. */
function setLive(live, key, value) {
    const doc = globalThis.document;
    const element = doc && CONTROLS[key] ? doc.querySelector(CONTROLS[key]) : null;
    let next = value;
    if (key === CONTEXT_FIELD && element) {
        const max = Number(element.getAttribute?.('max'));
        if (max > 0) next = Math.min(next, max);
    }
    live[key] = next;
    if (!element) return next;
    if (typeof next === 'boolean') element.checked = next; else element.value = String(next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return next;
}

const saved = (name, manager) => entriesOf(manager).find(entry => entry.name === name)?.data || null;
const presetManager = () => ctx().getPresetManager?.('openai');

const state = { lastModel: null, applied: null, model: '', preset: '', match: null };
const listeners = new Set();
export const onProfileChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => { for (const fn of listeners) { try { fn(); } catch (error) { console.warn('Roleplay Instructions profile listener failed.', error); } } };
export const resetProfileState = () => { state.lastModel = null; state.applied = null; state.model = ''; state.preset = ''; state.match = null; };

/**
 * Apply the profile for the selected model and preset to the live settings. reason is 'model' or 'preset'. A model event
 * that repeats the model already handled does nothing, so a context size she edited after a switch stays until the model
 * changes. A preset event always applies, since the host has just reloaded the preset's own values.
 * With no matching profile the preset's own values stay; a value an earlier profile set is returned to the preset's saved one.
 * Returns the list of { key, from, to } changes made.
 */
export function syncProfile(reason = 'model') {
    const c = ctx();
    if (c.mainApi && c.mainApi !== 'openai') return [];
    const live = c.chatCompletionSettings;
    const preset = activePreset();
    if (!live || !preset) return [];
    const model = c.getChatCompletionModel?.() || '';
    if (reason === 'preset') state.applied = null;
    else if (state.lastModel === model && state.applied?.preset === preset) return [];
    state.lastModel = model;
    state.model = model;
    state.preset = preset;
    const manager = presetManager();
    const file = saved(preset, manager) || live;
    const found = matchProfile(file, model);
    state.match = found;
    const values = found ? profileValues(found.profile) : {};
    const changes = [];
    const previous = state.applied?.preset === preset ? state.applied : null;
    // Values an earlier profile set that this model's profile does not carry go back to the preset's own.
    for (const key of previous ? Object.keys(previous.values) : []) {
        if (key in values || !(key in file) || file[key] === undefined) continue;
        const from = live[key];
        const to = setLive(live, key, file[key]);
        if (from !== to) changes.push({ key, from, to });
    }
    for (const [key, value] of Object.entries(values)) {
        const from = live[key];
        const to = setLive(live, key, value);
        if (from !== to) changes.push({ key, from, to });
    }
    state.applied = found && Object.keys(values).length ? { preset, id: found.profile.id, values: { ...values }, set: Object.fromEntries(Object.keys(values).map(key => [key, live[key]])) } : null;
    notify();
    return changes;
}

/** What the Presets card shows: the stored profiles of the selected preset, which one follows the model and what is live now. */
export function profileStatus() {
    const c = ctx();
    const preset = activePreset();
    const live = c.chatCompletionSettings;
    const model = c.getChatCompletionModel?.() || '';
    const file = preset ? saved(preset, presetManager()) || live : null;
    const profiles = storedProfiles(file);
    const found = matchProfile(file, model);
    const applied = state.applied && state.applied.preset === preset && found && state.applied.id === found.profile.id ? state.applied : null;
    const edited = applied ? Object.keys(applied.set).filter(key => live?.[key] !== applied.set[key]) : [];
    return { preset, model, profiles, active: found?.profile || null, match: found?.match || null, applied: !!applied,
        values: found ? profileValues(found.profile) : {}, edited, live: contextOf(live), own: contextOf(file) };
}
