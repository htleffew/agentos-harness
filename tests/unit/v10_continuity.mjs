import assert from 'node:assert/strict';

const chat = [];
const context = {
    chat, chatMetadata:{}, extensionSettings:{}, name1:'Player', name2:'Mira', characterId:0,
    getCurrentChatId:()=> 'test',
    characters:[{personality:'Patient and curious',mes_example:'Mira says, “Start at the beginning.”'}],
};
globalThis.SillyTavern = {getContext:()=>context};

const {
    activePreset, extractUpdate, normalizeRecord, DEFAULT_MODULES:modules, gate, prepareTurn, prefs,
    portrayalSources, baselineFor, effectivePortrayal, guidelineEligible,
} = await import('../../src/v10.js');
const {stateAt, changesFromProfiles} = await import('../../src/state.js');
const wrap = value => '<story_update v="2">'+JSON.stringify({v:2,...value})+'</story_update>';
const save = record => ({on:true,kind:record.kind==='seed' ? 'payoff' : record.kind,fields:{data:JSON.stringify(record)}});
const accepted = (time,value={}) => ({mes:'Mira waits at Dock.',extra:{roleplay_instructions:{v10:true,time,v10SceneId:1,...value}}});
const greeting = 'Mira says, “I need to sit down.”';
const update = wrap({scene:{where:'Dock',date:'Day 2',time:42},
    characters:[{name:'Mira',body:'Tired',evidence:'I need to sit down.',psyche:3},
        {name:'Player',heart:'Curious',evidence:'Mira says'}]});
const opening = extractUpdate(update,{sourceProse:greeting});
assert.deepEqual(opening.scene,{where:'Dock',date:'Day 2'});
assert.equal(opening.profiles.length,1);
assert.equal(opening.issues.length,2);
assert.equal(extractUpdate(update,{sourceProse:greeting,allowPlayerThoughts:true}).profiles.length,2);
assert.equal(extractUpdate(update).profiles.length,0);

chat.push(accepted(1,{scene:{where:'Dock'},stateChanges:changesFromProfiles(opening.profiles)}));
assert.equal(stateAt().mira.fields.body,'Tired');
assert.equal(stateAt(Infinity,{includeTemporary:false}).mira.fields.body,undefined);
chat.push(accepted(2,{scene:{where:'Dock'}}));
assert.equal(stateAt().mira.fields.body,'Tired');
chat.push(accepted(3,{scene:{where:'Dock'}}));
assert.equal(stateAt().mira.fields.body,undefined);
chat.pop();
chat.push(accepted(3,{scene:{where:'Cabin'},stateChanges:[{name:'Mira',fields:{body:'Uses a cane'}}]}),accepted(4),accepted(5));
assert.equal(stateAt().mira.fields.body,'Uses a cane');

const knowledge = {kind:'knowledge',id:'seen-bell',subject:'Mira',text:'The bell warned the town.',evidence:'the bell warned the town',basis:'observed'};
const rows = new Map();
const valid = {modules,rows,evidence:'Mira saw that the bell warned the town.'};
assert(normalizeRecord(knowledge,valid));
assert.equal(normalizeRecord({...knowledge,evidence:'A leaf fell.'},{...valid,evidence:'Mira saw a leaf. A leaf fell.'}),null);
const seed = {id:'ring',kind:'seed',status:'open',text:'The town has a bell.',payoff:'The bell calls the hidden ferryman.',requires:['seen-bell']};
rows.set('seen-bell',{...knowledge,basis:'rumor'});
assert.equal(gate(seed,rows,200,{}),false);
rows.set('seen-bell',knowledge);
assert.equal(gate(seed,rows,200,{}),true);
const payoff = {...seed,status:'done',outcome:'The ferryman brought the missing lantern.'};
assert(!normalizeRecord({...payoff,evidence:'Snow started.'},{...valid,evidence:'Snow started.'}));
assert(normalizeRecord({...payoff,evidence:payoff.outcome},{...valid,evidence:payoff.outcome,clock:200}));
rows.set('old',{kind:'arc',status:'retired',realized:true});
assert.equal(gate({...seed,requires:['old']},rows,200,{}),true);

const agenda = {id:'mira-trip',kind:'agenda',status:'done',subject:'Mira',text:'Walked to Pine Harbor',
    whereabouts:'Pine Harbor',travel:{from:'Dock',to:'Pine Harbor',departed:120,minutes:60},evidence:'Mira arrived in Pine Harbor'};
assert.equal(normalizeRecord(agenda,{...valid,evidence:agenda.evidence,clock:161}),null);
assert.equal(normalizeRecord(agenda,{...valid,evidence:agenda.evidence,clock:180}).travel.earliest,180);

const canonical = portrayalSources([]);
const source = baselineFor(canonical,'Mira');
assert.equal(source.text,'Patient and curious');
const profile = {kind:'profile',id:'mira',subject:'Mira',text:'Impulsive',voice:'Shouts',facet:'Impatient from the storm',facetScene:1};
assert.equal(effectivePortrayal(profile,source).text,source.text);
assert.equal(effectivePortrayal({...profile,profileFields:{text:{locked:true}}},source).text,profile.text);
chat.length=0;
chat.push(accepted(1));
assert.match(prepareTurn([save(profile),save(seed)],{present:'Mira',where:'Dock'},'normal',modules).text,/Current facet: Impatient/);
assert.doesNotMatch(prepareTurn([save(profile),save(seed)],{present:'Mira',where:'Dock'},'normal',modules).text,/hidden ferryman/);
chat.push(accepted(2,{v10SceneEnded:true}));
assert.doesNotMatch(prepareTurn([save(profile)],{present:'Mira',where:'Dock'},'normal',modules).text,/Current facet/);

const local = prefs();
local.guidelines='Story guide';
local.guidelineScopes={'Story guide':{0:{module:'plots',location:'Dock',character:'Mira'}}};
assert(guidelineEligible({uid:0},local,{where:'Dock',present:'Mira, Cass'},modules));
assert(!guidelineEligible({uid:0},local,{where:'Dock',present:'Cass'},modules));
assert(!guidelineEligible({uid:0},local,{where:'Dock',present:'Mira'},{...modules,plots:false}));
assert(guidelineEligible({uid:1},local,{},modules));

context.getPresetManager=()=>({getSelectedPresetName:()=> 'Roleplay Instructions V10'});
context.mainApi='openai';
assert.equal(activePreset(),'Roleplay Instructions V10');
context.mainApi='textgenerationwebui';
assert.equal(activePreset(),'');

const {normalizeScene} = await import('../../src/state.js');
assert.deepEqual(normalizeScene({time:'Wednesday, Month 7, Day 14, 3:45 AM, Clear 38°F'}),{
    time:'3:45 AM',date:'Wednesday, Month 7, Day 14',weather:'Clear 38°F',
});
assert.deepEqual(normalizeScene({time:'Late morning'}),{time:'Late morning'});
assert.equal(normalizeScene({time:'Day 4, 9:15 PM, Snow',weather:'Rain'}).weather,'Rain');
