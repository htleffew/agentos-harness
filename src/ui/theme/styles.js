// Loads the extension's shared stylesheets and bundled font, and applies the size settings
// of Setup, Look (DESIGN.md 1.10) as attributes and scales on <html>.
import { saveSettings, settings } from '../../store.js';

const root = new URL('../../../', import.meta.url);
const SHEETS = [['ri-tokens', 'src/ui/theme/tokens.css'], ['ri-composer-bar', 'src/ui/composer-bar.css']];

export const LOOK_DEFAULTS = Object.freeze({
    text: 'compact', textScale: 100,
    icons: 'compact', iconScale: 100,
    targets: 'compact', targetScale: 100,
    sheetHeight: 40,
});
export const SCALE_RANGE = Object.freeze({ textScale: [100, 130], iconScale: [85, 130], targetScale: [85, 130], sheetHeight: [25, 75] });
const CHOICES = ['compact', 'comfortable'];

const clamp = (value, [low, high], fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(high, Math.max(low, number)) : fallback;
};

/** A clean copy of saved look settings; unknown or out-of-range values fall back to the defaults. */
export function normalizeLook(saved) {
    const look = saved && typeof saved === 'object' ? saved : {};
    const out = {};
    for (const key of ['text', 'icons', 'targets']) out[key] = CHOICES.includes(look[key]) ? look[key] : LOOK_DEFAULTS[key];
    for (const [key, range] of Object.entries(SCALE_RANGE)) out[key] = clamp(look[key], range, LOOK_DEFAULTS[key]);
    out.sheetHeight = Math.round(out.sheetHeight / 5) * 5;
    return out;
}

export function lookSettings() {
    const st = settings();
    st.look = normalizeLook(st.look);
    return st.look;
}

export function saveLook(change) {
    const st = settings();
    st.look = normalizeLook({ ...lookSettings(), ...change });
    saveSettings();
    applyLook(st.look);
    return st.look;
}

export function applyLook(look = lookSettings(), doc = globalThis.document) {
    const html = doc?.documentElement;
    if (!html) return;
    html.dataset.riText = look.text;
    html.dataset.riIcons = look.icons;
    html.dataset.riTargets = look.targets;
    html.style.setProperty('--ri-text-scale', String(look.textScale / 100));
    html.style.setProperty('--ri-icon-scale', String(look.iconScale / 100));
    html.style.setProperty('--ri-hit-scale', String(look.targetScale / 100));
    html.style.setProperty('--ri-sheet-height', String(look.sheetHeight));
    doc.dispatchEvent?.(new CustomEvent('ri-look-change', { detail: { ...look } }));
}

function fontFaces() {
    const file = weight => new URL(`assets/fonts/plex-mono/ibm-plex-mono-latin-${weight}-normal.woff2`, root).href;
    // Latin subset range from the font's own package, so other scripts fall back to the system monospace.
    const range = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
    return [500, 700].map(weight => `@font-face { font-family: 'RI Plex Mono'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${file(weight)}') format('woff2'); unicode-range: ${range}; }`).join('\n');
}

/** Adds the stylesheets and font once; safe to call again. */
export function loadStyles(doc = globalThis.document) {
    if (!doc?.head) return;
    for (const [id, path] of SHEETS) {
        if (doc.getElementById(id)) continue;
        const link = doc.createElement('link');
        link.id = id;
        link.rel = 'stylesheet';
        link.href = new URL(path, root).href;
        doc.head.append(link);
    }
    if (!doc.getElementById('ri-font')) {
        const style = doc.createElement('style');
        style.id = 'ri-font';
        style.textContent = fontFaces();
        doc.head.append(style);
    }
    applyLook(lookSettings(), doc);
}
