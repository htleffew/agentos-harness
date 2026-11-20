import assert from 'node:assert/strict';
import { streamUpdate } from '../../src/stream-update.js';

const opening = 'Visible prose.\n<story_update v="2">';
assert.equal(streamUpdate('Visible prose.'),null);
assert.equal(streamUpdate('<story_update v="1">{"v":1}'),null);
assert.deepEqual(streamUpdate(`${opening}{"v":2,"scene":{"where":"Dock"`),[]);
const section = {id:'scene',title:'Scene',detail:'Dock · Rain'};
const withScene = `${opening}{"v":2,"scene":{"where":"Dock","weather":"Rain"},`;
assert.deepEqual(streamUpdate(withScene),[section]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[{"text":"A } ] , \\"quoted\\" detail."}`),[section]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[{"text":"A } ] , \\"quoted\\" detail."}],"roast":"Work`),[
    section,{id:'changes',title:'Story changes',detail:'1 change'},
]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[],"characters":[{},{}],"repairChanges":[{}],"roast":"Done"}`).map(item=>item.id),
    ['scene','cast','changes','repair','roast']);
assert.deepEqual(streamUpdate(`${opening}{"v":1,"scene":{"where":"Dock"}}`),[]);
