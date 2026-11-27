import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const extensionSettings = {}; let saves = 0;
globalThis.SillyTavern = { getContext: () => ({ extensionSettings, saveSettingsDebounced: () => saves++, name1:'User',name2:'Hale',chat:[] }) };
const P = await import('../../src/prompts.js');
const E = await import('../../src/events.js');
const B = await import('../../src/books.js');
const WF = await import('../../src/worldflow.js');
assert.equal(P.validatePrompt('guided', 'Do something'), 'Keep the required placeholder: {direction}.');
assert(P.validatePrompt('guided', '{{direction}}'));
assert(P.validatePrompt('checker', '   '));
assert.equal(P.validatePrompt('guided', 'Follow {direction}'), '');
assert.throws(() => P.savePrompt('event', 'No event placeholder'), /placeholder/);
P.savePrompt('event', 'EVENT CUSTOM: {parts}');
P.savePrompt('guided', 'GUIDANCE {direction} for {{char}}');
assert.equal(P.promptText('guided', {direction:'calmly'}), 'GUIDANCE calmly for {{char}}');
const cat=E.newCategory('Situation',['a knock']);const rolled=E.rollEvent({type:'event',categories:[cat]},null);assert.match(rolled.text,/EVENT CUSTOM: Situation: a knock/);
P.savePrompt('instructionOrder','Please apply {instruction}');assert.match(B.wrapText('system','Hale must wait',0), /Please apply Hale must wait/);
P.savePrompt('instructionAgency','Leave {{user}} free to decide.');
assert.match(B.wrapText('system','Hale must wait'),/Leave \{\{user\}\} free to decide\.]$/);
P.restorePrompt('instructionAgency');
assert.match(B.wrapText('ooc','Hale must wait'),/words, choices and thoughts are theirs to write/);
assert(P.promptStatus('event').customized);
const oldDefault=P.PROMPTS.event.text;P.PROMPTS.event.text='New built-in wording {parts}';assert(P.promptStatus('event').defaultChanged);assert.match(P.promptText('event',{parts:'x'}),/EVENT CUSTOM/);P.PROMPTS.event.text=oldDefault;
P.restorePrompt('event');assert(!P.promptStatus('event').customized);assert(P.promptStatus('guided').customized);
extensionSettings.roleplay_instructions.prompts.guided={text:'bad without token',base:'old'};assert.match(P.promptText('guided',{direction:'SAFE'}),/SAFE/);
assert(saves>=5);console.log('prompt templates, validation, protected format, independent restore and default drift: passed');

extensionSettings.roleplay_instructions.cards.voice='Dry theater critic with a weakness for a good entrance.';
assert.match(P.promptText('roastVoice'),/Dry theater critic/);
assert(P.promptStatus('roastVoice').customized);
P.restorePrompt('roastVoice');
const { DEFAULT_VOICE, PREVIOUS_GREMLIN_VOICE, ORIGINAL_VIEWER_VOICE } = await import('../../src/defaults.js');
assert.equal(P.promptText('roastVoice'),DEFAULT_VOICE);
assert.match(DEFAULT_VOICE,/i keysmash when words fail hfksjdks/);
const st=extensionSettings.roleplay_instructions;
for (const stock of [DEFAULT_VOICE, PREVIOUS_GREMLIN_VOICE, ORIGINAL_VIEWER_VOICE]) {
    st.cards.voice=stock;
    assert.equal(P.promptText('roastVoice'),DEFAULT_VOICE);
    assert.equal(P.promptStatus('roastVoice').customized,false);
}
const edited=ORIGINAL_VIEWER_VOICE+' Give the closing joke to the crow.';
st.cards.voice=edited;
assert.equal(P.promptText('roastVoice'),edited);
P.savePrompt('roastVoice','Use my saved rewrite.');
st.cards.voice=edited;
assert.equal(P.promptText('roastVoice'),'Use my saved rewrite.');

const {DEFAULT_STORY_AVOID, DEFAULT_WRITER_RULES, ORIGINAL_WRITER_RULES} = await import('../../src/defaults.js');
const {settings} = await import('../../src/store.js');
const {writerRules, wordHits} = await import('../../src/pacing.js');
const {updateContract, DEFAULT_MODULES} = await import('../../src/v10.js');
const preset = JSON.parse(readFileSync(new URL('../../presets/Roleplay Instructions V10.json', import.meta.url), 'utf8'));
const normalized = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const flagged = DEFAULT_STORY_AVOID.split('\n').map(normalized);
const ownedText = [
    ...Object.entries(P.PROMPTS).map(([id, prompt]) => [id, prompt.text]),
    ...preset.prompts.map(prompt => [prompt.name, (prompt.content || '').replace(/\{\{\/\/[\s\S]*?\}\}/g, '')]), // comment macros never reach the model
    ['writer rules', DEFAULT_WRITER_RULES],
    ['structured scene', updateContract(DEFAULT_MODULES)],
];
for (const [label, value] of ownedText) {
    assert.doesNotMatch(value,/\b(?:beat|beats|cost|costs|ledger|invoice|archive|filed|filing)\b/i,label);
    assert.deepEqual(flagged.filter(phrase => ` ${normalized(value)} `.includes(` ${phrase} `)),[],label);
}
const config = settings();
config.words.list = 'customscreenmarker';
config.words.tell = true; // Previously this preference injected the full list.
config.writer.rules = ORIGINAL_WRITER_RULES;
assert.deepEqual(wordHits('A customscreenmarker appeared.'),['customscreenmarker']);
assert.doesNotMatch(writerRules().join(' '),/customscreenmarker|paperwork/);
config.writer.rules = 'Keep the user’s own guidance.';
assert.match(writerRules().join(' '),/Keep the user’s own guidance/);
