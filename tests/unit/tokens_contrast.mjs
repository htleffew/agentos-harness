// Contrast floors for every token pair of DESIGN.md 1.3 and every story style pair of 1.12.
// Values are read from the token files present, so an edit that drops a pair fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const themeDir = join(root, 'src/ui/theme');

export function luminance(hex) {
    const value = hex.replace('#', '');
    const channels = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255)
        .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function ratio(a, b) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

/** Every selector block of a CSS file as { selector, tokens }. */
function blocks(css) {
    const out = [];
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const tokens = {};
        for (const [, name, value] of match[2].matchAll(/(--ri-[\w-]+)\s*:\s*([^;]+);/g)) tokens[name] = value.trim();
        out.push({ selector: match[1].trim(), tokens });
    }
    return out;
}

const tokenCss = readFileSync(join(themeDir, 'tokens.css'), 'utf8');
const base = blocks(tokenCss).find(block => block.selector === ':root').tokens;
const hex = name => {
    const value = base[name];
    assert.match(value || '', /^#[0-9A-Fa-f]{6}$/, `${name} is a six-digit color`);
    return value;
};
const check = (label, fg, bg, floor) => {
    const value = ratio(fg, bg);
    assert.ok(value >= floor, `${label}: ${fg} on ${bg} is ${value.toFixed(2)}, below ${floor}`);
    return value;
};

const surfaces = ['--ri-surface', '--ri-raised'];
const families = ['story', 'direction', 'reply', 'review', 'setup', 'call', 'problem'];
const inks = [...families, 'focus', 'select'];

test('neutrals meet their floors on both surfaces', () => {
    for (const surface of surfaces) {
        check(`--ri-text on ${surface}`, hex('--ri-text'), hex(surface), 4.5);
        check(`--ri-text-muted on ${surface}`, hex('--ri-text-muted'), hex(surface), 4.5);
        check(`--ri-line on ${surface}`, hex('--ri-line'), hex(surface), 3);
    }
});

test('every family and reserved ink reads as text and as a fill', () => {
    for (const ink of inks) {
        for (const surface of surfaces) check(`--ri-${ink} on ${surface}`, hex(`--ri-${ink}`), hex(surface), 4.5);
        check(`black text on --ri-${ink}`, hex('--ri-on-ink'), hex(`--ri-${ink}`), 4.5);
    }
});

test('tints carry ink, body and muted text; edges pass 3.0', () => {
    for (const family of families) {
        const tint = hex(`--ri-${family}-tint`);
        check(`--ri-${family} on its tint`, hex(`--ri-${family}`), tint, 4.5);
        check(`body text on --ri-${family}-tint`, hex('--ri-text'), tint, 4.5);
        check(`muted text on --ri-${family}-tint`, hex('--ri-text-muted'), tint, 4.5);
    }
    for (const ink of inks) check(`--ri-${ink}-line on surface`, hex(`--ri-${ink}-line`), hex('--ri-surface'), 3);
});

test('teal Direction #14B8A6 passes with the figures in 1.3', () => {
    assert.equal(hex('--ri-direction').toUpperCase(), '#14B8A6');
    assert.equal(ratio('#14B8A6', hex('--ri-surface')).toFixed(1), '7.8');
    assert.equal(ratio('#14B8A6', hex('--ri-raised')).toFixed(1), '7.2');
    assert.equal(ratio('#000000', '#14B8A6').toFixed(1), '8.4');
});

test('the checker itself rejects a failing pair', () => {
    assert.throws(() => check('sample', '#333333', '#0B0E14', 4.5));
    assert.throws(() => check('sample edge', '#1C2433', '#0B0E14', 3));
});

function storyStyles() {
    const styles = [];
    const collect = (file, css) => {
        for (const block of blocks(css)) {
            if (!block.tokens['--ri-style-surface']) continue;
            styles.push({ name: `${file} ${block.selector}`, tokens: block.tokens });
        }
    };
    collect('tokens.css', tokenCss);
    const extra = join(themeDir, 'story-styles');
    if (existsSync(extra)) for (const file of readdirSync(extra).filter(name => name.endsWith('.css'))) {
        collect(file, readFileSync(join(extra, file), 'utf8'));
    }
    return styles;
}

test('every story style pairing passes (Modern minimal default plus any style present)', () => {
    const styles = storyStyles();
    assert.ok(styles.length >= 1, 'at least the default story style is defined');
    for (const { name, tokens } of styles) {
        for (const key of ['surface', 'ink', 'muted', 'accent', 'rule', 'face', 'corner']) {
            assert.ok(tokens[`--ri-style-${key}`], `${name} sets --ri-style-${key}`);
        }
        const surface = tokens['--ri-style-surface'];
        for (const key of ['ink', 'muted', 'accent']) check(`${name} ${key}`, tokens[`--ri-style-${key}`], surface, 4.5);
        check(`${name} rule`, tokens['--ri-style-rule'], surface, 3);
        // Reserved meanings stay: no story style uses amber or red as its accent.
        assert.notEqual(tokens['--ri-style-accent'].toUpperCase(), hex('--ri-call').toUpperCase());
        assert.notEqual(tokens['--ri-style-accent'].toUpperCase(), hex('--ri-problem').toUpperCase());
    }
});
