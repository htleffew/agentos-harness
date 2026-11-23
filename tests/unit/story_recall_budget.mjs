import assert from 'node:assert/strict';
import test from 'node:test';

const chat = [
    { mes:'Mira waited.',extra:{roleplay_instructions:{scene:{present:'Mira',where:'Harbor'}}} },
    { mes:'I look for the blue lantern.',is_user:true },
];
const context = {chat,chatMetadata:{},extensionSettings:{},name1:'Player',name2:'Mira',getCurrentChatId:()=> 'current'};
globalThis.SillyTavern = {getContext:()=>context};
const {buildNotes} = await import('../../src/world.js');
const {settings} = await import('../../src/store.js');
const {readActivation} = await import('../../src/recall.js');

let nextUid = 0;
const row = (kind,name,fields,options={}) => ({uid:++nextUid,kind,name,fields,on:true,aliases:[],...options});
const seed = (name,options) => row('seed',name,{detail:'A detail to remember.'},{status:'planted',...options});
const thread = (name,people) => row('thread',name,{people,open:'A question remains open.'},{status:'quiet'});

test('keeps scene ties and explicit activations, excluding unrelated records', () => {
    const scene = row('character','Mira',{role:'ferryman',wants:'An answer'});
    const place = row('place','Harbor',{what:'The northern landing'});
    const named = seed('The lantern',{aliases:['blue lantern']});
    const unrelated = seed('Cracked mirror');
    const missedKeyword = seed('Keep away',{activation:readActivation({mode:'triggered',keys:['mirror']})});
    const matchedKeyword = seed('Bring a rope',{activation:readActivation({mode:'triggered',keys:['blue lantern']})});
    const zeroChance = seed('Lighthouse bell',{activation:readActivation({mode:'always',chance:0})});
    const relevant = Array.from({length:6},(_,index)=>thread(`Open matter ${index}`,'Mira'));
    const distant = thread('Distant wedding','Jules');
    const notes = buildNotes([scene,place,named,unrelated,missedKeyword,matchedKeyword,zeroChance,...relevant,distant],
        'normal',{budget:400,lookback:4},{chapters:false});
    for (const entry of [scene,place,named,matchedKeyword]) assert.ok(notes.ids.includes(entry.uid));
    for (const entry of [unrelated,missedKeyword,zeroChance,distant]) assert.ok(!notes.ids.includes(entry.uid));
    assert.equal(relevant.filter(entry=>notes.ids.includes(entry.uid)).length,3);
});

test('includes formatting in both budgets and suppresses chapters covered by a rollup', () => {
    const history = {chat:'prior',from:1,to:30};
    const rollup = row('chapter','Earlier account',{summary:'Events of earlier chapters are recorded here. '.repeat(100)},
        {rollup:true,span:history});
    const covered = row('chapter','Covered chapter',{summary:'Covered long ago.',people:'Mira'},
        {span:{...history,to:10}});
    const characters = Array.from({length:14},(_,index)=>row('character',`Guest ${index}`,
        {role:'crew',wants:'The crew wishes to come home safely. '.repeat(60)}));
    const savedScene = chat[0].extra.roleplay_instructions.scene;
    chat[0].extra.roleplay_instructions.scene = {...savedScene,present:characters.map(entry=>entry.name).join(', ')};
    settings().summary.budget = 100;
    try {
        const notes = buildNotes([rollup,covered,...characters],'normal',{budget:100,lookback:4},{chapters:true});
        assert.ok(notes.ids.includes(rollup.uid));
        assert.ok(!notes.ids.includes(covered.uid));
        assert.ok(notes.ids.length < characters.length + 1);
        assert.ok(notes.tokens <= 200);
        assert.doesNotMatch(notes.text,/Covered long ago/);

        rollup.fields.summary = 'Mira ferried the crew north.';
        const shortNotes = buildNotes([rollup,covered],'normal',{budget:100,lookback:4},{chapters:true});
        assert.deepEqual(shortNotes.ids,[rollup.uid]);
    } finally {
        chat[0].extra.roleplay_instructions.scene = savedScene;
    }
});

test('Memory only sends a stored fact whose record holds an empty alias list', () => {
    const data = JSON.stringify({kind:'fact',subject:'Mira',aliases:[],text:'Mira owes the ferryman two silver marks.'});
    const fact = row('fact','Mira debt',{data});
    const notes = buildNotes([fact],'normal',{budget:400,lookback:4},{chapters:false,memory:true});
    assert.ok(notes.ids.includes(fact.uid));
    assert.match(notes.text,/two silver marks/);
});
