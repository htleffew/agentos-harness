// No emoji anywhere the extension writes or draws (DESIGN.md 1.1, DECISIONS 2026-11-23).
// Fails on any character with emoji presentation or an emoji variation selector (U+FE0F)
// in the extension's code, styles, prompts and shipped presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/gu;

// Lines that recognize text the host or a model wrote; the extension itself writes none of it.
const MATCHERS = [
    { file: 'src/state.js', why: 'reads scene header symbols from model replies', line: /const symbols = \{/ },
    { file: 'src/reply-format.js', why: 'detects a model-written header line', line: /\/\^\\s\*\\\[\(\?:/ },
    { file: 'src/v10.js', why: 'matches the names of prompt blocks in her installed presets', line: /HOST_OVERLAPS|Card Fidelity/ },
];
// Known strings that break the rule in files another ticket owns. Each is reported as a todo
// with its owner so it stays visible; removing the emoji turns the todo into a pass.
const PENDING = [
    { file: 'src/defaults.js', owner: 'B7 (string sweep) or the Writing guidance owner', line: /Samples of the voice/ },
];

function files(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files(path, out);
        else if (/\.(js|mjs|cjs|json|css|html)$/.test(name)) out.push(path);
    }
    return out;
}

export function emojiHits(text) {
    return text.split('\n').flatMap((line, index) => {
        const found = line.match(EMOJI);
        return found ? [{ line: index + 1, text: line, found }] : [];
    });
}

const scanned = [...files(join(root, 'src')), ...files(join(root, 'presets')), join(root, 'index.js'), join(root, 'style.css')];
const results = scanned.map(path => ({ file: relative(root, path).replaceAll('\\', '/'), hits: emojiHits(readFileSync(path, 'utf8')) }));

test('the detector catches emoji presentation and the variation selector', () => {
    assert.equal(emojiHits('plain text, arrows \u2192 and stars \u2605 and blocks \u2588').length, 0);
    assert.equal(emojiHits('a check \u2713 and diamond \u25C6').length, 0);
    assert.equal(emojiHits('a mask \u{1F3AD}').length, 1);
    assert.equal(emojiHits('heart \u2764\uFE0F').length, 1);
});

test('no emoji in user-facing strings and prompt text', () => {
    const violations = [];
    for (const { file, hits } of results) for (const hit of hits) {
        const allowed = [...MATCHERS, ...PENDING].some(rule => rule.file === file && rule.line.test(hit.text));
        if (!allowed) violations.push(`${file}:${hit.line} ${hit.found.join(' ')}`);
    }
    assert.deepEqual(violations, []);
});

for (const pending of PENDING) {
    const open = results.find(result => result.file === pending.file)?.hits.some(hit => pending.line.test(hit.text));
    test(`${pending.file}: emoji in a prompt sample, owned by ${pending.owner}`, { todo: open ? 'remove the emoji from this prompt text' : false }, () => {
        assert.ok(!open);
    });
}
