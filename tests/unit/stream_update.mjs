import assert from 'node:assert/strict';
import { streamUpdate } from '../../src/stream-update.js';

const opening = 'Visible prose.\n<story_update v="2">';
assert.equal(streamUpdate('Visible prose.'),null);
assert.equal(streamUpdate('<story_update v="1">{"v":1}'),null);
assert.deepEqual(streamUpdate(`${opening}{"v":2,"scene":{"where":"Dock"`),[]);
const section = {id:'scene',title:'Scene',value:{where:'Dock'},detail:'Dock · Rain'};
const withScene = `${opening}{"v":2,"scene":{"where":"Dock","weather":"Rain"},`;
assert.deepEqual(streamUpdate(withScene),[section]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[{"text":"A } ] , \\"quoted\\" detail."}`),[section]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[{"text":"A } ] , \\"quoted\\" detail."}],"roast":"Work`),[
    section,{id:'changes',title:'Story changes',value:[],detail:'1 change'},
]);
assert.deepEqual(streamUpdate(`${withScene}"changes":[],"characters":[{},{}],"repairChanges":[{}],"roast":"Done"}`).map(item=>item.id),
    ['scene','cast','changes','repair','roast']);
assert.deepEqual(streamUpdate(`${opening}{"v":1,"scene":{"where":"Dock"}}`),[]);

const cast = [
    {name:'Mira',mind:'Find the ferry',body:'clear',evidence:'Visible prose'},
    {name:'Sam',heart:'Worried',evidence:'Visible prose'},
    {name:'Kai',heart:'Calm',evidence:'Something else'},
];
const records = [
    {kind:'fact',id:'ferry',text:'The ferry left',evidence:'Visible prose'},
    {kind:'fact',id:'missing',text:'Unchecked',evidence:'Other prose'},
    {kind:'emotion',id:'mira',subject:'Mira',text:'Hurrying',axes:{fury:5,dread:99},evidence:'Visible prose'},
];
const arrived = streamUpdate(opening+JSON.stringify({v:2,characters:cast,changes:records}),'Sam');
assert.deepEqual(arrived[0].value,[{name:'Mira',fields:{mind:'Find the ferry'}}]);
assert.deepEqual(arrived[1].value.map(record=>record.id),['ferry','mira']);
assert.deepEqual(arrived[1].value[1].axes,{fury:5});
