// Themes (DESIGN.md 1.11) and the story style pickers (1.12): three built-in dark themes, saved variations that hold tokens
// only, Export and Import as JSON, Bind to this chat, and the matching SillyTavern theme. Pages: Setup, Look, Theme and
// Setup, Look, Story style. Colors live in src/ui/theme/themes/*.css and src/ui/theme/story-styles/*.css.
import { chatState, saveChatState, saveSettings, settings } from '../store.js';
import { confirmBox, ctx, inputBox, isChatOpen, LOG, on, toast } from '../st.js';
import { STORY_STYLES, STYLE_FILES, askModelStyle, chatStoryStyle, clearModelSuggestion, defaultStoryStyle, effectiveStoryStyle, modelSuggestion, onStoryStyleChange,
    setChatStoryStyle, setDefaultStoryStyle, styleLabel } from '../story-style.js';
import { add, download, h } from './dom.js';
import { registerPage } from './page-registry.js';

const root = new URL('../../', import.meta.url);

export const THEMES = Object.freeze([
    { id: 'emerald', name: 'Emerald', chrome: '#3FE39B' },
    { id: 'sapphire', name: 'Sapphire', chrome: '#6AA8FF' },
    { id: 'violet', name: 'Violet', chrome: '#B98CFF' },
]);
export const DEFAULT_THEME = 'emerald';
export const ICON_WEIGHTS = Object.freeze({ regular: 'Regular', heavy: 'Heavy' });
export const DENSITIES = Object.freeze({ compact: 'Compact', comfortable: 'Comfortable' });
export const EXPORT_FORMAT = 'ri-theme';
// The ink must read on the lightest menu surface (--ri-raised), which is the hardest of the three.
export const SURFACES = Object.freeze({ bg: '#05070A', surface: '#0B0E14', raised: '#121722' });
export const INK_FLOOR = 4.5;
const MAX_VARIATIONS = 24;
const VARIATION_KEYS = ['format', 'version', 'name', 'base', 'chrome', 'iconWeight', 'density', 'scanlines'];

// ---------- color math ----------

const HEX = /^#[0-9a-fA-F]{6}$/;
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = parts => `#${parts.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function luminance(hex) {
    const [r, g, b] = channels(hex).map(v => v / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function ratio(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}
/** `ink` at `amount` over `surface`, as the 65% edge of 1.3 does. */
export function mix(ink, surface, amount) {
    const a = channels(ink), b = channels(surface);
    return toHex(a.map((v, i) => v * amount + b[i] * (1 - amount)));
}
const rgba = (hex, alpha) => `rgba(${channels(hex).join(', ')}, ${alpha})`;

function toHsl(hex) {
    const [r, g, b] = channels(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(hue * 60 + 360) % 360, s, l];
}
function fromHsl([hue, s, l]) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hue / 60) % 6];
    return toHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** The ink moved in lightness until it passes `floor` on every menu surface; `shifted` says whether it moved. */
export function fitInk(hex, floor = INK_FLOOR, surfaces = Object.values(SURFACES)) {
    const ok = value => surfaces.every(surface => ratio(value, surface) >= floor);
    if (!HEX.test(hex)) return { hex: THEMES[0].chrome, shifted: true };
    const start = hex.toUpperCase();
    if (ok(start)) return { hex: start, shifted: false };
    const [hue, s, l] = toHsl(start);
    for (let step = 1; step <= 100; step++) {
        const next = fromHsl([hue, s, Math.min(1, l + step * 0.01)]);
        if (ok(next)) return { hex: next, shifted: true };
    }
    return { hex: '#FFFFFF', shifted: true };
}

// ---------- themes and variations ----------

const builtIn = id => THEMES.find(theme => theme.id === id) || null;

/** The tokens a theme sets, as { '--ri-chrome': value }. A variation's ink is fitted first. */
export function chromeTokens(chrome) {
    const ink = fitInk(chrome).hex;
    return { '--ri-chrome': ink, '--ri-chrome-line': mix(ink, SURFACES.surface, 0.65), '--ri-chrome-glow': rgba(ink, 0.45), '--ri-chrome-scan': rgba(ink, 0.05) };
}

const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f<>{}"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const slug = value => cleanName(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';

/** A clean variation record, or null when it is not one. Only tokens survive: a name, a base, a color and three choices. */
export function normalizeVariation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = cleanName(raw.name);
    if (!name) return null;
    const base = builtIn(raw.base) ? raw.base : DEFAULT_THEME;
    return {
        id: typeof raw.id === 'string' && /^[a-z0-9-]{1,48}$/.test(raw.id) ? raw.id : `v-${slug(name)}`,
        name, base,
        chrome: HEX.test(raw.chrome) ? raw.chrome.toUpperCase() : builtIn(base).chrome,
        iconWeight: Object.hasOwn(ICON_WEIGHTS, raw.iconWeight) ? raw.iconWeight : 'regular',
        density: Object.hasOwn(DENSITIES, raw.density) ? raw.density : 'compact',
        scanlines: raw.scanlines !== false,
    };
}

export function themeState(st = settings()) {
    const saved = st.themes && typeof st.themes === 'object' ? st.themes : {};
    const variations = (Array.isArray(saved.variations) ? saved.variations : []).map(normalizeVariation).filter(Boolean).slice(0, MAX_VARIATIONS);
    const known = id => !!builtIn(id) || variations.some(variation => variation.id === id);
    st.themes = { active: known(saved.active) ? saved.active : DEFAULT_THEME, variations };
    return st.themes;
}

export const allThemes = (state = themeState()) => [...THEMES.map(theme => ({ ...theme, built: true })), ...state.variations];

/** The chat's bound theme when it has one that still exists, else the active theme. */
export function effectiveThemeId(cs = isChatOpen() ? chatState() : null, state = themeState()) {
    const bound = cs?.theme;
    return typeof bound === 'string' && allThemes(state).some(theme => theme.id === bound) ? bound : state.active;
}

export function resolveTheme(id, state = themeState()) {
    const found = allThemes(state).find(theme => theme.id === id) || allThemes(state)[0];
    if (found.built) return { ...found, base: found.id, iconWeight: 'regular', density: 'compact', scanlines: true };
    return found;
}

/** Write the theme onto <html>: the base id picks the stylesheet's tokens, a variation's own tokens go inline. */
export function applyTheme(doc = globalThis.document) {
    const html = doc?.documentElement;
    if (!html?.style) return null;
    const theme = resolveTheme(effectiveThemeId());
    html.dataset.riTheme = theme.base;
    html.dataset.riIconWeight = theme.iconWeight;
    html.dataset.riDensity = theme.density;
    html.dataset.riScanlines = theme.scanlines ? 'on' : 'off';
    const tokens = chromeTokens(theme.chrome);
    for (const [name, value] of Object.entries(tokens)) {
        if (theme.built) html.style.removeProperty(name); else html.style.setProperty(name, value);
    }
    doc.dispatchEvent?.(new CustomEvent('ri-theme-change', { detail: { id: theme.id } }));
    return theme;
}

function saveState(change) {
    const st = settings();
    st.themes = { ...themeState(st), ...change };
    saveSettings();
    return themeState(st);
}

export function chooseTheme(id) {
    saveState({ active: id });
    applyTheme();
}

/** Save the editor's values as a named variation of `base`; a name already used is replaced. */
export function saveVariation(values) {
    const state = themeState();
    const variation = normalizeVariation(values);
    if (!variation) return null;
    const rest = state.variations.filter(item => item.id !== variation.id);
    saveState({ variations: [...rest, variation].slice(-MAX_VARIATIONS), active: variation.id });
    applyTheme();
    return variation;
}

export function deleteVariation(id) {
    const state = themeState();
    saveState({ variations: state.variations.filter(item => item.id !== id), active: state.active === id ? DEFAULT_THEME : state.active });
    const cs = isChatOpen() ? chatState() : null;
    if (cs?.theme === id) { delete cs.theme; saveChatState(); }
    applyTheme();
}

/** Bind (or release) the chat's theme. */
export function bindChatTheme(id) {
    const cs = chatState();
    if (!cs) return false;
    if (id) cs.theme = id; else delete cs.theme;
    saveChatState();
    applyTheme();
    return true;
}

// ---------- Export and Import ----------

export function exportTheme(theme) {
    const resolved = theme.built ? { ...theme, base: theme.id, iconWeight: 'regular', density: 'compact', scanlines: true } : theme;
    return JSON.stringify({ format: EXPORT_FORMAT, version: 1, name: resolved.name, base: resolved.base, chrome: resolved.chrome,
        iconWeight: resolved.iconWeight, density: resolved.density, scanlines: resolved.scanlines }, null, 2);
}

/**
 * Read a theme file. Only the token keys are accepted: a file with any other key, or a value that is not
 * a six-digit color or one of the listed choices, is refused whole, so no raw CSS can arrive this way.
 */
export function parseImport(text) {
    let data;
    try { data = JSON.parse(String(text)); } catch { return { ok: false, error: 'That file is not a theme file.' }; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.format !== EXPORT_FORMAT) return { ok: false, error: 'That file is not a theme file.' };
    const extra = Object.keys(data).filter(key => !VARIATION_KEYS.includes(key));
    if (extra.length) return { ok: false, error: 'A theme file holds colors and choices only. This one has more, so it was not imported.' };
    if (!HEX.test(data.chrome)) return { ok: false, error: 'The accent color in that file is not a six-digit color.' };
    if (data.iconWeight !== undefined && !Object.hasOwn(ICON_WEIGHTS, data.iconWeight)) return { ok: false, error: 'The icon weight in that file is not one of Regular or Heavy.' };
    if (data.density !== undefined && !Object.hasOwn(DENSITIES, data.density)) return { ok: false, error: 'The density in that file is not one of Compact or Comfortable.' };
    if (data.scanlines !== undefined && typeof data.scanlines !== 'boolean') return { ok: false, error: 'Scanlines in that file must be on or off.' };
    const variation = normalizeVariation({ ...data, id: undefined });
    return variation ? { ok: true, variation } : { ok: false, error: 'That file has no name.' };
}

// ---------- the matching SillyTavern theme ----------

export const stThemeName = name => `Roleplay Instructions, ${name}`;

/** The SillyTavern theme object for a theme: its own current settings with the colors of this theme. Pure. */
export function buildStTheme(theme, current = {}) {
    const ink = fitInk(theme.chrome).hex;
    const color = hex => rgba(hex, 1);
    return {
        ...current,
        name: stThemeName(theme.name),
        main_text_color: color('#DDE3EE'),
        italics_text_color: color('#9AA4B5'),
        underline_text_color: color('#A3AEC2'),
        quote_text_color: color(ink),
        blur_tint_color: color(SURFACES.bg),
        chat_tint_color: color(SURFACES.surface),
        user_mes_blur_tint_color: color(SURFACES.raised),
        bot_mes_blur_tint_color: color(SURFACES.surface),
        shadow_color: 'rgba(0, 0, 0, 0.5)',
        border_color: color(mix(ink, SURFACES.surface, 0.65)),
    };
}

const ST_THEME_KEYS = ['blur_strength', 'main_text_color', 'italics_text_color', 'underline_text_color', 'quote_text_color', 'blur_tint_color',
    'chat_tint_color', 'user_mes_blur_tint_color', 'bot_mes_blur_tint_color', 'shadow_color', 'shadow_width', 'border_color', 'font_scale',
    'fast_ui_mode', 'waifuMode', 'avatar_style', 'chat_display', 'toastr_position', 'noShadows', 'chat_width', 'timer_enabled',
    'timestamps_enabled', 'timestamp_model_icon', 'mesIDDisplay_enabled', 'hideChatAvatars_enabled', 'message_token_count_enabled',
    'expand_message_actions', 'enableZenSliders', 'enableLabMode', 'hotswap_enabled', 'custom_css', 'bogus_folders',
    'zoomed_avatar_magnification', 'reduced_motion', 'compact_input_area', 'show_swipe_num_all_messages', 'click_to_edit', 'media_display'];

/**
 * Save the matching theme through SillyTavern's own theme endpoint under a new name. The current SillyTavern theme
 * is not switched: the new one is added to the theme list for her to pick.
 */
export async function saveMatchingStTheme(theme, host = ctx()) {
    const power = host.powerUserSettings || {};
    const current = Object.fromEntries(ST_THEME_KEYS.filter(key => power[key] !== undefined).map(key => [key, power[key]]));
    const object = buildStTheme(theme, current);
    const response = await fetch('/api/themes/save', { method: 'POST', headers: host.getRequestHeaders(), body: JSON.stringify(object) });
    if (!response.ok) throw new Error('SillyTavern could not save the theme.');
    const list = globalThis.document?.querySelector('#themes');
    if (list && ![...list.options].some(option => option.value === object.name)) {
        const option = globalThis.document.createElement('option');
        option.value = object.name;
        option.textContent = object.name;
        list.append(option);
    }
    return object.name;
}

// ---------- styles ----------

const SHEETS = [
    ['emerald', 'src/ui/theme/themes/emerald.css'], ['sapphire', 'src/ui/theme/themes/sapphire.css'], ['violet', 'src/ui/theme/themes/violet.css'],
    ['chrome', 'src/ui/theme/themes/chrome.css'], ['story-faces', 'src/ui/theme/story-styles/faces.css'],
    ...Object.values(STYLE_FILES).map(file => [`story-${file}`, `src/ui/theme/story-styles/${file}.css`]),
];

/** Add the theme and story style sheets once. The faces load from the extension folder; nothing is fetched from elsewhere. */
export function loadThemeSheets(doc = globalThis.document) {
    if (!doc?.head) return;
    for (const [name, path] of SHEETS) {
        const id = `ri-theme-${name}`;
        if (doc.getElementById(id)) continue;
        const link = doc.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = new URL(path, root).href;
        doc.head.append(link);
    }
}

// ---------- pages ----------

const icon = name => h('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });

export function renderThemePage(body) {
    loadThemeSheets();
    const state = themeState();
    const chatOpen = isChatOpen();
    const cs = chatOpen ? chatState() : null;
    const activeId = effectiveThemeId(cs, state);
    const active = resolveTheme(activeId, state);
    const host = h('div', { class: 'ri-look ri-theme-page', id: 'ri-theme' });
    const rerender = () => { const fresh = h('div'); renderThemePage(fresh); host.replaceWith(fresh.firstChild); };
    const draft = { name: active.name, base: active.base, chrome: active.chrome, iconWeight: active.iconWeight, density: active.density, scanlines: active.scanlines };

    const list = h('div', { class: 'ri-theme-list', role: 'group', 'aria-label': 'Themes' }, allThemes(state).map(theme => h('button', {
        type: 'button', class: 'ri-bar-btn', 'data-theme': theme.id, 'aria-pressed': String(theme.id === state.active),
        onclick: () => { chooseTheme(theme.id); rerender(); } },
    h('span', { class: 'ri-theme-swatch', style: { '--ri-swatch': theme.chrome } }), theme.name)));

    const fit = fitInk(draft.chrome);
    const note = h('p', { class: 'ri-theme-note', role: 'status' }, fit.shifted ? `That color is too dim to read on the menu surfaces, so ${fit.hex} is used instead.` : '');
    if (!fit.shifted) note.hidden = true;
    const picker = h('input', { type: 'color', id: 'ri-theme-chrome', value: fit.hex.toLowerCase(), 'aria-label': 'Chrome accent color',
        onchange: event => { draft.chrome = event.target.value.toUpperCase(); const next = fitInk(draft.chrome);
            note.textContent = next.shifted ? `That color is too dim to read on the menu surfaces, so ${next.hex} is used instead.` : ''; note.hidden = !next.shifted; } });
    const choice = (legend, key, choices) => h('fieldset', { class: 'ri-tray-setting' }, h('legend', {}, legend),
        h('div', { class: 'ri-look-choices' }, Object.entries(choices).map(([value, label]) => h('button', { type: 'button', class: 'ri-bar-btn',
            'aria-pressed': String(draft[key] === value), onclick: event => { draft[key] = value; for (const sibling of event.currentTarget.parentNode.children) sibling.setAttribute('aria-pressed', String(sibling === event.currentTarget)); } }, label))));
    const scan = h('fieldset', { class: 'ri-tray-setting' }, h('legend', {}, 'Scanlines and grid'),
        h('div', { class: 'ri-look-choices' }, [[true, 'On'], [false, 'Off']].map(([value, label]) => h('button', { type: 'button', class: 'ri-bar-btn',
            'aria-pressed': String(draft.scanlines === value), onclick: event => { draft.scanlines = value; for (const sibling of event.currentTarget.parentNode.children) sibling.setAttribute('aria-pressed', String(sibling === event.currentTarget)); } }, label))),
        h('p', { class: 'ri-help' }, 'They show only on the full screen menu backdrop and switch off with reduced motion or higher contrast.'));

    const saveAs = async () => {
        const name = await inputBox('Name this theme', cleanName(draft.name) === active.name && active.built ? `${active.name} copy` : draft.name);
        if (!name) return;
        const saved = saveVariation({ ...draft, name });
        toast('success', saved ? `Saved ${saved.name}.` : 'That name cannot be used.');
        rerender();
    };
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'aria-label': 'Import a theme file',
        onchange: async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            const result = parseImport(await file.text());
            if (!result.ok) { toast('error', result.error); return; }
            const saved = saveVariation(result.variation);
            toast('success', `Imported ${saved.name}.`);
            rerender();
        } });
    const actions = h('div', { class: 'ri-theme-actions' },
        h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-save', onclick: saveAs }, icon('fa-floppy-disk'), 'Save as'),
        h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-export', onclick: () => download(`ri-theme-${slug(active.name)}.json`, exportTheme(active)) }, icon('fa-file-export'), 'Export'),
        h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-import', onclick: () => fileInput.click() }, icon('fa-file-import'), 'Import'),
        chatOpen ? h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-bind', 'aria-pressed': String(cs?.theme === state.active),
            onclick: () => { bindChatTheme(cs?.theme === state.active ? '' : state.active); rerender(); } }, icon('fa-link'), 'Bind to this chat') : null,
        !active.built ? h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-delete',
            onclick: async () => { if (await confirmBox(`Delete ${active.name}?`)) { deleteVariation(active.id); rerender(); } } }, icon('fa-trash'), 'Delete') : null,
        fileInput);
    const matching = h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-theme-st',
        onclick: async () => {
            try { const name = await saveMatchingStTheme(active); toast('success', `Saved the SillyTavern theme ${name}. Pick it in User Settings when you want it.`); }
            catch (error) { toast('error', error.message); console.warn(LOG, 'matching SillyTavern theme', error); }
        } }, icon('fa-palette'), 'Save a matching SillyTavern theme');

    add(host, [
        h('p', { class: 'ri-help' }, 'A theme dresses the menus and controls. Every theme keeps the same black surfaces and family colors, so a color means the same thing in all of them.'),
        list,
        chatOpen && cs?.theme ? h('p', { class: 'ri-help' }, `This chat is bound to ${resolveTheme(effectiveThemeId(cs, state), state).name}.`) : null,
        h('div', { class: 'ri-theme-field' }, h('label', { for: 'ri-theme-chrome' }, 'Chrome accent'), picker), note,
        choice('Icon weight', 'iconWeight', ICON_WEIGHTS), choice('Density', 'density', DENSITIES), scan,
        actions,
        h('p', { class: 'ri-help' }, 'Save as keeps your changes under a name. A saved theme holds colors and choices only, no styles, so an imported file cannot change anything else.'),
        h('h3', { class: 'ri-tray-subhead' }, 'SillyTavern'),
        h('p', { class: 'ri-help' }, `Saves a SillyTavern theme named "${stThemeName(active.name)}" with this theme's colors. Your current SillyTavern theme stays as it is and stays selectable.`),
        matching]);
    body.append(host);
}

function styleSample(style, pressed, choose) {
    return h('button', { type: 'button', class: 'ri-style-sample', 'data-ri-story-style': style.id, 'data-style': style.id, 'aria-pressed': String(pressed), onclick: choose },
        h('span', { class: 'ri-style-name' }, style.label),
        h('span', {}, 'The door was already open.'),
        h('span', { class: 'ri-style-line' }, style.face));
}

/** The four styles as buttons. `current` is the one in use; `suggested` gets a mark. Used by the pages and the tray. */
export function styleChoices(current, choose, { suggested = '' } = {}) {
    loadThemeSheets();
    return h('div', { class: 'ri-style-grid', role: 'group', 'aria-label': 'Story style' }, STORY_STYLES.map(style => {
        const node = styleSample(style, style.id === current, () => choose(style.id));
        if (style.id === suggested) node.querySelector('.ri-style-line').textContent = 'Suggested for this chat';
        return node;
    }));
}

/**
 * B61: the Suggest with a model button, the status line under it and, once a usable answer is in, a button that applies
 * it. Nothing is sent until she taps; the answer is a suggestion and the chat's style changes only on the second tap.
 * apply(id) makes the choice. The state lives in story-style.js, so a redraw of the tray keeps it.
 */
export function modelSuggestControl(apply) {
    const box = h('div', { class: 'ri-style-model' });
    const draw = () => {
        const now = modelSuggestion();
        const busy = now.state === 'asking';
        const kids = [h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-style-ask-model', disabled: busy, 'aria-busy': String(busy),
            onclick: () => { askModelStyle(); } }, h('span', { class: 'ri-call-dot', 'aria-label': 'Extension model call' }), 'Suggest with a model')];
        if (now.state === 'done') {
            const same = now.style === effectiveStoryStyle();
            kids.push(same ? null : h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-style-use-model', onclick: () => { clearModelSuggestion(); apply(now.style); } }, `Use ${styleLabel(now.style)}`));
        }
        const text = now.state === 'done' ? (now.style === effectiveStoryStyle() ? `A model suggests ${styleLabel(now.style)}, which this chat already uses.` : `A model suggests ${styleLabel(now.style)}. Tap Use to apply it.`) : now.note;
        kids.push(text ? h('p', { class: 'ri-help ri-style-model-note', id: 'ri-style-model-note', role: 'status', 'data-state': now.state }, text) : null);
        box.replaceChildren(...kids.filter(Boolean));
    };
    draw();
    const off = onStoryStyleChange(() => { if (!box.isConnected) off(); else draw(); });
    return box;
}

export function renderStoryStylePage(body) {
    loadThemeSheets();
    const chatOpen = isChatOpen();
    const host = h('div', { class: 'ri-look ri-story-style-page', id: 'ri-story-style' });
    const rerender = () => { const fresh = h('div'); renderStoryStylePage(fresh); host.replaceWith(fresh.firstChild); };
    add(host, [
        h('p', { class: 'ri-help' }, 'Story cards in the reply tray take a style; the menus and tray controls keep the terminal look. The scene header line keeps SillyTavern’s chat font.'),
        h('h3', { class: 'ri-tray-subhead' }, 'Default for every chat'),
        styleChoices(defaultStoryStyle(), id => { setDefaultStoryStyle(id); rerender(); })]);
    if (chatOpen) {
        const own = chatStoryStyle();
        add(host, [h('h3', { class: 'ri-tray-subhead' }, 'This chat'),
            styleChoices(own || defaultStoryStyle(), id => { setChatStoryStyle(id); rerender(); }),
            modelSuggestControl(id => { setChatStoryStyle(id); rerender(); }),
            h('p', { class: 'ri-help' }, own ? 'This chat has its own style.' : 'This chat follows the default.'),
            own ? h('button', { type: 'button', class: 'ri-bar-btn', id: 'ri-style-use-default', onclick: () => { setChatStoryStyle(''); rerender(); } }, 'Use the default for this chat') : null]);
    }
    body.append(host);
}

let mounted = false;
export function mountThemes() {
    loadThemeSheets();
    applyTheme();
    if (mounted) return;
    mounted = true;
    registerPage({ id: 'look-theme', group: 'setup', subgroup: 'Look', label: 'Theme', withoutChat: true,
        help: 'Pick a theme for the menus and controls, save variations, share them, or save a matching SillyTavern theme.',
        aliases: 'themes emerald sapphire violet accent colors chrome scanlines density icon weight export import bind sillytavern theme', render: body => renderThemePage(body) });
    registerPage({ id: 'look-story-style', group: 'setup', subgroup: 'Look', label: 'Story style', withoutChat: true,
        help: 'Choose how story cards look in the reply tray: Parchment, Noir, Sci-fi readout or Modern minimal.',
        aliases: 'story styles parchment noir sci-fi readout modern minimal cards font face', render: body => renderStoryStylePage(body) });
    on('CHAT_CHANGED', () => applyTheme());
}
