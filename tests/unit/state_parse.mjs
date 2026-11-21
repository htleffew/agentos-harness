import assert from 'node:assert/strict';
const context = { name2: 'Hale', name1: 'Mira', chat: [], extensionSettings: {} };
globalThis.SillyTavern = { getContext: () => context };
const { parseUpdate, buildSceneAsk, applyOps } = await import('../../src/worldflow.js');
const { changesFromProfiles, sceneFromReplyHeader, sceneUpdate, sceneAt, snapshotScene, statePrompt } = await import('../../src/state.js');
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

assert.deepEqual(sceneFromReplyHeader('<tracker> 🕘 9:00 AM | Tuesday, May 12, 2026 | Upper garden → terrace | ☁️ Overcast </tracker>\nMira waited.'),
    {time:'9:00 AM',date:'Tuesday, May 12, 2026',where:'Upper garden → terrace',weather:'Overcast'});
assert.deepEqual(sceneFromReplyHeader('Mira waited.\n<sola_hud><date>\nCalendar: Mid-Autumn, 4th Year of the Eclipse\nTime: Dawn\nElapsed: ten minutes\n</date></sola_hud>'),
    {date:'Mid-Autumn, 4th Year of the Eclipse',time:'Dawn'});
assert.deepEqual(sceneFromReplyHeader('[🕰️ 3:45 AM | 🗓️ Wednesday, Month 7, Day 14 | 📍 Mountain road | 🌙 Clear, 38°F]'),
    {time:'3:45 AM',date:'Wednesday, Month 7, Day 14',where:'Mountain road',weather:'Clear, 38°F'});
assert.deepEqual(sceneFromReplyHeader('**Date:** May 2, 2024 | **Time:** 6:30 PM | **Location:** Wharf'),
    {date:'May 2, 2024',time:'6:30 PM',where:'Wharf'});
assert.deepEqual(sceneUpdate({date:'—',weather:'Unknown',time:'',environment:''}),{environment:''});
assert.deepEqual(sceneUpdate({when:'Monday evening'}),{when:'Monday evening'});
context.chat.push({is_system:true,mes:'<tracker>9:00 AM | Tuesday, May 12, 2026 | Garden | Overcast</tracker>'},
    {mes:'Mira walked.',extra:{roleplay_instructions:{scene:{where:'Terrace',time:'9:10 AM',date:'—'}}}});
assert.deepEqual(snapshotScene(1),{date:'Tuesday, May 12, 2026',where:'Terrace',time:'9:10 AM',weather:'Overcast'});
assert.match(statePrompt(),/Date: Tuesday, May 12, 2026/);
context.chat.push({mes:'Mira returned the next evening.',extra:{roleplay_instructions:{scene:{date:'',lastKnownDate:'Last Autumn',daysAfterKnownDate:1,time:'7:00 PM'}}}});
assert.equal(sceneAt().date,undefined);
assert.match(statePrompt(),/Date: Day after Last Autumn/);
