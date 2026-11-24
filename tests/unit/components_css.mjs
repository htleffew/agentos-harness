// B8: the stylesheets draw from tokens only, keep zero radius on menu components, hold the 12 px type floor
// and carry the reduced-motion, more-contrast and forced-colors blocks. The accent picker is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const files = ['style.css', ...readdirSync(join(root, 'src/ui')).filter(name => name.endsWith('.css')).map(name => `src/ui/${name}`)];
const css = Object.fromEntries(files.map(file => [file, readFileSync(join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')]));
const outsideTokens = Object.entries(css);

test('no color literal outside the token file', () => {
    for (const [file, text] of outsideTokens) {
        assert.deepEqual(text.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|hwb\(|oklch\(/g) || [], [], `${file} has a color literal`);
    }
});

test('no font size under 12 px is written in a stylesheet', () => {
    for (const [file, text] of outsideTokens) {
        for (const [, size] of text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(size) >= 12, `${file} sets ${size}px`);
    }
});

test('menu components keep zero radius; only story style cards and the round dot differ', () => {
    for (const file of ['style.css', 'src/ui/components.css']) {
        for (const [, value] of css[file].matchAll(/border-radius:\s*([^;]+);/g)) {
            assert.match(value.trim(), /^(0|var\(--ri-radius\)|var\(--ri-style-corner\)|50%)$/, `${file} sets border-radius ${value}`);
        }
    }
});

test('motion, contrast and forced-colors blocks exist', () => {
    const components = css['src/ui/components.css'];
    for (const query of ['prefers-reduced-motion: reduce', 'prefers-contrast: more', 'forced-colors: active']) assert.ok(components.includes(query), query);
    assert.match(components, /outline:\s*2px solid var\(--ri-focus\)/);
});

test('the accent picker is removed', () => {
    assert.ok(!readFileSync(join(root, 'src/ui/settings.js'), 'utf8').includes('Accent colour'));
    assert.ok(!/data-accent="(magenta|yellow|violet)"/.test(css['src/ui/components.css']));
});

test('one disclosure marker: no stylesheet draws its own triangle, plus or chevron text', () => {
    for (const [file, text] of outsideTokens) {
        if (file.endsWith('components.css')) continue;
        assert.ok(!/summary::before\s*\{[^}]*content:\s*['"][▸▾+\-›⌄▶]/.test(text), `${file} draws a disclosure marker`);
    }
});
