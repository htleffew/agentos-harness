// Every Font Awesome name the extension uses exists in the host's Font Awesome Free 6.5.2 stylesheet
// (DESIGN.md 1.7). Point RI_FA_CSS at SillyTavern's public/css/fontawesome.min.css, or RI_ST_DIR at
// a SillyTavern 1.19.0 checkout; without either the host check is skipped and says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STYLE_CLASSES = new Set(['fa-solid', 'fa-regular', 'fa-brands', 'fa-fw', 'fa-spin', 'fa-lg', 'fa-xs', 'fa-sm', 'fa-xl', 'fa-2x', 'fa-3x']);

function files(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files(path, out);
        else if (/\.js$/.test(name)) out.push(path);
    }
    return out;
}

export function iconNames(text) {
    return [...text.matchAll(/(?<![\w-])fa-[a-z0-9]+(?:-[a-z0-9]+)*/g)].map(match => match[0]).filter(name => !STYLE_CLASSES.has(name));
}

const used = [...new Set([...files(join(root, 'src')), join(root, 'index.js')].flatMap(path => iconNames(readFileSync(path, 'utf8'))))].sort();
const candidates = [process.env.RI_FA_CSS, process.env.RI_ST_DIR && join(process.env.RI_ST_DIR, 'public/css/fontawesome.min.css')].filter(Boolean);
const hostCss = candidates.find(path => existsSync(path));

test('the extension names its icons with plain fa- class names', () => {
    assert.ok(used.length > 10, `found ${used.length} icon names`);
    assert.ok(used.includes('fa-wand-magic-sparkles') && used.includes('fa-dice-d20'));
});

test('every icon exists in the host Font Awesome 6.5.2 stylesheet', { skip: hostCss ? false : 'set RI_FA_CSS or RI_ST_DIR to check against the host' }, () => {
    const css = readFileSync(hostCss, 'utf8');
    assert.match(css.slice(0, 300), /Font Awesome Free 6\.5\.2/);
    const missing = used.filter(name => !new RegExp(`\\.${name}:(?:before|after)|\\.${name}[,{]`).test(css));
    assert.deepEqual(missing, []);
});
