import assert from 'node:assert/strict';
globalThis.SillyTavern = { getContext: () => ({ name2: 'Hale', name1: 'Mira', chat: [], extensionSettings: {} }) };
const { parseUpdate, buildSceneAsk, applyOps } = await import('../../src/worldflow.js');
const { changesFromProfiles } = await import('../../src/state.js');
const parsed = parseUpdate('Story.\n<story_update>\npresent: Hale\nwhere: Inn\nwhen: Night\nenvironment: Broken window\n<profile name="Hale">\nMind: Protect the letter\nBody: CLEAR\n</profile>\n</story_update>');
assert.equal(parsed.clean, 'Story.');
assert.equal(parsed.scene.environment, 'Broken window');
assert.deepEqual(changesFromProfiles(parsed.profiles), [{ name: 'Hale', fields: { mind: 'Protect the letter', body: null } }]);
const ask = buildSceneAsk();
assert.match(ask, /Mind:/);
assert.match(ask, /omit unchanged/i);
assert.doesNotMatch(ask, /Will not:/);
console.log('update parsing, clear semantics and state request: passed');

const cleared = parseUpdate('Story.\n<story_update>\nperson: CLEAR\nplace: clear.\ngroup: RESOLVED\nthread: CLEAR\nplanted: CLEAR\nelsewhere: CLEAR\nenvironment: CLEAR\n</story_update>');
assert.deepEqual(cleared.ops,[]);
assert.equal(cleared.scene.environment,'');
const world={entries:{}};
assert.deepEqual(applyOps(world,'',[
    {k:'person',a:'CLEAR'}, {k:'thread',a:'CLEAR'}, {k:'planted',a:'CLEAR'}, {k:'elsewhere',a:'CLEAR'},
],{chat:'legacy',n:0}),[]);
assert.deepEqual(world.entries,{});
