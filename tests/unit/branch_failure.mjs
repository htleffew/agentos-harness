import assert from 'node:assert/strict';
let savedWorlds = 0;
const rec = { time: 1, items: [], scene: { present:'Hale' }, stateChanges: [{name:'Hale',fields:{mind:'Wait'}}], update: { world:'Parent', undone:false, ops:[], changes:[{uid:1,type:'set',field:'wants',before:'A',after:'B'}] } };
const c = {
 chat:[{mes:'Story',extra:{roleplay_instructions:rec}}],
 chatMetadata:{main_chat:'parent',integrity:'branch',roleplay_instructions:{world:'Parent',worldOwner:'parent',worldLog:{chat:'parent',items:{'1':{world:'Parent',changes:rec.update.changes}}}}},
 extensionSettings:{roleplay_instructions:{sets:{Parent:{kind:'world'}},world:{copyOnBranch:true}}},
 getCurrentChatId:()=> 'branch', loadWorldInfo:async()=>{throw new Error('unavailable')}, saveWorldInfo:async()=>{savedWorlds++}, saveChat:async()=>{}, saveMetadataDebounced:()=>{}, getWorldInfoNames:()=>['Parent'],
};
globalThis.SillyTavern={getContext:()=>c};
const {syncWorld,invalidateAfterEdit}=await import('../../src/worldflow.js');
await syncWorld();
assert.equal(c.chatMetadata.roleplay_instructions.world,'');
assert.equal(c.chatMetadata.roleplay_instructions.branchPendingWorld,'Parent');
assert.equal(savedWorlds,0);
await invalidateAfterEdit(0);
assert.equal(savedWorlds,0);
assert.equal(rec.stateStale,true);
assert.equal(rec.update.undone,true);
console.log('failed branch copy disconnects parent and never writes it: passed');
