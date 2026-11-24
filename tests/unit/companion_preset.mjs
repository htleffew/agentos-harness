import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
// B15: the companion preset's rows, headings, annotations and sampler fields.
const extensionSettings = {};
globalThis.SillyTavern = { getContext: () => ({ extensionSettings, saveSettingsDebounced() {}, name1: 'User', name2: 'Hale', chat: [] }) };
const { stripPresetComments, isCompanionPreset } = await import('../../src/v10.js');
const preset = JSON.parse(readFileSync(new URL('../../presets/Roleplay Instructions V10.json', import.meta.url), 'utf8'));
const byId = new Map(preset.prompts.map(p => [p.identifier, p]));
const KEYS = ['category', 'icon', 'badge', 'tooltip', 'default-enabled', 'alternatives', 'requires', 'pairs', 'cost'];
const comments = text => [...text.matchAll(/\{\{\/\/ (.*?) \}\}/g)].map(m => m[1]);
const annotation = p => Object.fromEntries(comments(p.content).filter(c => c.startsWith('@')).map(c => [c.slice(1, c.indexOf(' ')), c.slice(c.indexOf(' ') + 1)]));

assert(isCompanionPreset(preset.name));
const own = preset.prompts.filter(p => /^ri-(craft|check)-/.test(p.identifier));
assert.equal(own.length, 16);
for (const p of own) {
    assert(p.name.length <= 20, `${p.name} is ${p.name.length} characters`);
    assert(/^(Craft|Profile|Check): \S/.test(p.name), p.name);
    const a = annotation(p);
    assert.deepEqual(Object.keys(a), KEYS, p.identifier);
    assert(a.tooltip.length < 140, `${p.identifier} tooltip`);
    assert(['on', 'off'].includes(a['default-enabled']));
    assert(['style', 'preflight'].includes(a.pairs), p.identifier);
    // The stripped text is the original sentence set: it starts with a capital and has no macro left.
    const text = stripPresetComments(p.content);
    assert(/^[A-Z]/.test(text) && !text.includes('{{//'), p.identifier);
}
assert.equal(stripPresetComments('{{// a }}{{// b }}Hold.'), 'Hold.');

// The annotation default matches the order, in both global orders.
for (const group of preset.prompt_order) {
    const enabled = new Map(group.order.map(e => [e.identifier, e.enabled]));
    for (const p of own) assert.equal(enabled.get(p.identifier), annotation(p)['default-enabled'] === 'on', p.identifier);
    for (const e of group.order) assert(byId.has(e.identifier), `order lists ${e.identifier} with no block`);
    assert.equal(group.order.at(-1).identifier, 'chatHistory');
    assert.equal(group.order[0].identifier, 'ri-readme');
    assert.equal(group.order[1].identifier, 'main');
}
assert.deepEqual(preset.prompt_order[0].order, preset.prompt_order[1].order);

// Headings are empty marker rows, short enough for a phone, with their group's rows between them.
const heads = preset.prompts.filter(p => p.identifier.startsWith('ri-head-'));
assert.deepEqual(heads.map(h => h.name), ['── Host sections ──', '── Writing craft ──', '── Profiles ──', '── Scene checks ──', '── Chat ──']);
for (const h of heads) {
    assert.equal(h.marker, true);
    assert(!h.content && h.name.length <= 20);
}
const order = preset.prompt_order[0].order.map(e => e.identifier);
const groupOf = id => { let g = ''; for (const o of order) { if (o.startsWith('ri-head-')) g = o; if (o === id) return g; } };
assert.equal(groupOf('ri-craft-viewpoint'), 'ri-head-craft');
assert.equal(groupOf('ri-craft-slow'), 'ri-head-profiles');
assert.equal(groupOf('ri-check-continuity'), 'ri-head-checks');
assert.equal(groupOf('worldInfoBefore'), 'ri-head-host');
assert.equal(groupOf('chatHistory'), 'ri-head-chat');

// The README is off, wrapped entirely in one comment macro and sends nothing.
const readme = byId.get('ri-readme');
assert.equal(preset.prompt_order[0].order[0].enabled, false);
assert.equal(stripPresetComments(readme.content), '');
assert(readme.content.length < 1400);

// No emoji and no dashes in any row name or prompt text.
const all = JSON.stringify(preset);
assert.doesNotMatch(all, /\p{Extended_Pictographic}/u);
assert.doesNotMatch(all, /[–—]/);

// Sampler and length fields are set on purpose.
assert.equal(preset.temperature, 1);
assert.equal(preset.top_p, 1);
assert.equal(preset.frequency_penalty, 0);
assert.equal(preset.presence_penalty, 0);
assert(preset.openai_max_tokens >= 1500);
assert(preset.openai_max_context >= preset.openai_max_tokens * 4, "context must leave room for the prompt beside the reply limit");
console.log('companion preset: passed');
