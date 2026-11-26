// B17: the three built-in themes (contrast on each theme's surfaces), saved variations, Export and Import with tokens only,
// Bind to this chat, and the matching SillyTavern theme.
// Run with: node --test tests/t_themes.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, test } from 'node:test';

globalThis.document ??= { createElement: () => ({ getContext: () => ({}) }), documentElement: {}, body: {} };
globalThis.MutationObserver ??= class { observe() {} };
const themes = await import('../src/ui/themes.js');
const { ratio } = await import('./unit/tokens_contrast.mjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = name => readFileSync(join(root, 'src/ui/theme/themes', name), 'utf8');
const base = readFileSync(join(root, 'src/ui/theme/tokens.css'), 'utf8');
const value = (text, name) => text.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();

let host, html, saves, posts;
beforeEach(() => {
    saves = 0; posts = [];
    html = { dataset: {}, style: { props: {}, setProperty(name, v) { this.props[name] = v; }, removeProperty(name) { delete this.props[name]; } } };
    globalThis.document.documentElement = html;
    globalThis.document.dispatchEvent = () => {};
    globalThis.document.querySelector = () => null;
    host = { extensionSettings: {}, chatMetadata: {}, getCurrentChatId: () => 'chat-a', saveSettingsDebounced() { saves++; }, saveMetadataDebounced() { saves++; },
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        powerUserSettings: { blur_strength: 10, custom_css: '.mine { color: red; }', font_scale: 1.1, main_text_color: 'rgba(1, 2, 3, 1)', chat_width: 55 } };
    globalThis.SillyTavern = { getContext: () => host };
});

const FILES = { emerald: 'emerald.css', sapphire: 'sapphire.css', violet: 'violet.css' };

test('Emerald, Sapphire and Violet ship, Emerald first and the default', () => {
    assert.deepEqual(themes.THEMES.map(theme => theme.id), ['emerald', 'sapphire', 'violet']);
    assert.equal(themes.DEFAULT_THEME, 'emerald');
    assert.equal(themes.themeState().active, 'emerald');
});

test('every pair passes on each theme: the chrome ink on all three surfaces, black text on the ink, the edge at 3.0', () => {
    for (const theme of themes.THEMES) {
        const sheet = css(FILES[theme.id]);
        assert.equal(value(sheet, '--ri-chrome').toUpperCase(), theme.chrome);
        for (const surface of ['--ri-bg', '--ri-surface', '--ri-raised']) {
            assert.ok(ratio(theme.chrome, value(base, surface)) >= 4.5, `${theme.id} ink on ${surface}`);
        }
        assert.ok(ratio('#000000', theme.chrome) >= 4.5, `${theme.id} fill`);
        assert.ok(ratio(value(sheet, '--ri-chrome-line'), value(base, '--ri-surface')) >= 3, `${theme.id} edge`);
        assert.equal(value(sheet, '--ri-chrome-line').toUpperCase(), themes.mix(theme.chrome, value(base, '--ri-surface'), 0.65), 'the edge is the ink at 65%');
        // The family inks and surfaces are the same in every theme: a theme sheet sets chrome tokens and nothing else.
        const names = [...sheet.matchAll(/(--ri-[\w-]+)\s*:/g)].map(match => match[1]);
        assert.deepEqual(names.sort(), ['--ri-chrome', '--ri-chrome-glow', '--ri-chrome-line', '--ri-chrome-scan']);
    }
    assert.equal(themes.SURFACES.surface, value(base, '--ri-surface'));
    assert.equal(themes.SURFACES.raised, value(base, '--ri-raised'));
    assert.equal(themes.SURFACES.bg, value(base, '--ri-bg'));
});

test('violet stays an accent: no theme sheet sets a surface', () => {
    for (const file of Object.values(FILES)) assert.doesNotMatch(css(file), /--ri-(bg|surface|raised|void)\s*:/);
});

test('an ink that is too dim is shifted in lightness until it passes and the editor is told', () => {
    const dim = themes.fitInk('#1A4D3A');
    assert.equal(dim.shifted, true);
    for (const surface of Object.values(themes.SURFACES)) assert.ok(ratio(dim.hex, surface) >= 4.5);
    assert.deepEqual(themes.fitInk('#3FE39B'), { hex: '#3FE39B', shifted: false });
    assert.equal(themes.fitInk('not a color').shifted, true);
});

test('applying a built-in theme sets the base id and clears inline tokens; a variation sets its own', () => {
    themes.applyTheme();
    assert.equal(html.dataset.riTheme, 'emerald');
    assert.equal(html.dataset.riScanlines, 'on');
    assert.deepEqual(html.style.props, {});
    themes.chooseTheme('violet');
    assert.equal(html.dataset.riTheme, 'violet');
    const saved = themes.saveVariation({ name: 'Dim blue', base: 'sapphire', chrome: '#123456', iconWeight: 'heavy', density: 'comfortable', scanlines: false });
    assert.equal(html.dataset.riTheme, 'sapphire');
    assert.equal(html.dataset.riIconWeight, 'heavy');
    assert.equal(html.dataset.riDensity, 'comfortable');
    assert.equal(html.dataset.riScanlines, 'off');
    assert.ok(ratio(html.style.props['--ri-chrome'], themes.SURFACES.raised) >= 4.5, 'the saved ink was fitted');
    assert.equal(themes.themeState().active, saved.id);
    assert.ok(saves > 0, 'saved with the settings');
});

test('Save as keeps a variation, Delete removes it and falls back to Emerald', () => {
    const one = themes.saveVariation({ name: 'Night', base: 'emerald', chrome: '#55FFAA' });
    assert.deepEqual(themes.themeState().variations.map(item => item.name), ['Night']);
    themes.saveVariation({ name: 'Night', base: 'emerald', chrome: '#66FFBB' });
    assert.equal(themes.themeState().variations.length, 1, 'the same name replaces');
    themes.deleteVariation(one.id);
    assert.equal(themes.themeState().variations.length, 0);
    assert.equal(themes.themeState().active, 'emerald');
    assert.equal(themes.saveVariation({ name: '   ', chrome: '#55FFAA' }), null);
});

test('Export writes tokens only and Import round trips them', () => {
    const saved = themes.saveVariation({ name: 'Night', base: 'violet', chrome: '#55FFAA', iconWeight: 'heavy', density: 'comfortable', scanlines: false });
    const text = themes.exportTheme(saved);
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['base', 'chrome', 'density', 'format', 'iconWeight', 'name', 'scanlines', 'version']);
    const back = themes.parseImport(text);
    assert.equal(back.ok, true);
    assert.deepEqual({ ...back.variation, id: '' }, { ...saved, id: '' });
    const builtIn = JSON.parse(themes.exportTheme({ ...themes.THEMES[1], built: true }));
    assert.equal(builtIn.base, 'sapphire');
});

test('an imported file carries tokens only: raw CSS, extra keys and bad values are refused whole', () => {
    const good = { format: 'ri-theme', version: 1, name: 'Ok', base: 'emerald', chrome: '#55FFAA' };
    assert.equal(themes.parseImport(JSON.stringify(good)).ok, true);
    for (const bad of [{ css: 'body { display: none }' }, { custom_css: '.x{}' }, { style: 'a' }, { chrome: 'url(javascript:1)' }, { chrome: '#55FFAA; } body { x: y' },
        { iconWeight: 'x{}' }, { density: 'wide' }, { scanlines: 'yes' }, { format: 'other' }]) {
        assert.equal(themes.parseImport(JSON.stringify({ ...good, ...bad })).ok, false, JSON.stringify(bad));
    }
    assert.equal(themes.parseImport('{not json').ok, false);
    assert.equal(themes.parseImport('[]').ok, false);
    const name = themes.parseImport(JSON.stringify({ ...good, name: '<img src=x onerror=1>{}"`' })).variation.name;
    assert.doesNotMatch(name, /[<>{}"`]/, 'a name cannot carry markup');
    assert.equal(themes.parseImport(JSON.stringify({ ...good, name: 'x'.repeat(100) })).variation.name.length, 40);
});

test('Bind to this chat saves in the chat and wins over the active theme; deleting the theme releases it', () => {
    const night = themes.saveVariation({ name: 'Night', base: 'violet', chrome: '#55FFAA' });
    themes.chooseTheme('sapphire');
    assert.equal(themes.effectiveThemeId(), 'sapphire');
    assert.equal(themes.bindChatTheme(night.id), true);
    assert.equal(host.chatMetadata.roleplay_instructions.theme, night.id, 'stored in the chat file');
    assert.equal(themes.effectiveThemeId(), night.id);
    assert.equal(html.dataset.riTheme, 'violet');
    themes.bindChatTheme('');
    assert.equal(themes.effectiveThemeId(), 'sapphire');
    themes.bindChatTheme(night.id);
    themes.deleteVariation(night.id);
    assert.equal(host.chatMetadata.roleplay_instructions.theme, undefined);
    host.chatMetadata.roleplay_instructions.theme = 'gone';
    assert.equal(themes.effectiveThemeId(), 'sapphire', 'a bound theme that no longer exists is ignored');
});

test('the matching SillyTavern theme saves under a new name, keeps her other settings and does not switch the current theme', async () => {
    assert.equal(themes.stThemeName('Emerald'), 'Roleplay Instructions, Emerald');
    globalThis.fetch = async (url, init) => { posts.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { ok: true }; };
    const name = await themes.saveMatchingStTheme({ ...themes.THEMES[0], built: true }, host);
    assert.equal(name, 'Roleplay Instructions, Emerald');
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/themes/save');
    const theme = posts[0].body;
    assert.equal(theme.name, name);
    assert.equal(theme.quote_text_color, 'rgba(63, 227, 155, 1)');
    assert.equal(theme.blur_tint_color, 'rgba(5, 7, 10, 1)');
    assert.equal(theme.custom_css, '.mine { color: red; }', 'her custom CSS is kept, the extension adds no markup styling');
    assert.equal(theme.font_scale, 1.1);
    assert.equal(theme.chat_width, 55);
    assert.equal(host.powerUserSettings.main_text_color, 'rgba(1, 2, 3, 1)', 'the current SillyTavern settings are untouched');
    assert.equal(host.powerUserSettings.theme, undefined, 'the current theme name is not changed');
    globalThis.fetch = async () => ({ ok: false });
    await assert.rejects(() => themes.saveMatchingStTheme({ ...themes.THEMES[0], built: true }, host));
});

test('no sheet or module loads anything from a network address', () => {
    for (const file of ['chrome.css', ...Object.values(FILES)]) assert.doesNotMatch(css(file), /https?:|@import/);
    assert.doesNotMatch(readFileSync(join(root, 'src/ui/themes.js'), 'utf8'), /https?:\/\/[a-z]/);
});
