import assert from 'node:assert/strict';
let book={entries:{}}, writes=0;
const cs={world:'World',worldOwner:'chat',worldLog:{chat:'chat',items:{}}};
const chat=[];
const c={ chat, chatMetadata:{integrity:'chat',roleplay_instructions:cs}, extensionSettings:{roleplay_instructions:{sets:{World:{kind:'world'}},world:{update:'all'}}}, getCurrentChatId:()=> 'chat', loadWorldInfo:async()=>structuredClone(book), saveWorldInfo:async(_n,d)=>{book=structuredClone(d);writes++}, saveMetadataDebounced:()=>{},saveChat:async()=>{},getWorldInfoNames:()=>['World'],name2:'Hale',name1:'User' };
globalThis.SillyTavern={getContext:()=>c};
const W=await import('../../src/world.js'), F=await import('../../src/worldflow.js');
const w=W.newWorldEntry(book,'character');w.name='Hale';w.fields.wants='Wrong';W.writeWorldEntry(book,w,'World');
const change={uid:w.uid,kind:'character',type:'set',field:'wants',before:'Before',after:'Wrong'};
const rec={time:100,items:[],update:{world:'World',ops:[],changes:[change]}}; chat.push({mes:'wrong',extra:{roleplay_instructions:rec}});cs.worldLog.items['100']={world:'World',changes:[change]};
let tx=await F.prepareGuidedSwipe(0);assert.equal(W.listWorld(book,'World')[0].fields.wants,'Before');assert(cs.worldLog.items['100']);
await F.restoreGuidedSwipe(tx);assert.equal(W.listWorld(book,'World')[0].fields.wants,'Wrong');assert(cs.worldLog.items['100']);
const manually=W.listWorld(book,'World')[0];manually.fields.wants='User correction';W.writeWorldEntry(book,manually,'World');
await assert.rejects(F.prepareGuidedSwipe(0),/changed since this reply/);assert.equal(W.listWorld(book,'World')[0].fields.wants,'User correction');
const reset=W.listWorld(book,'World')[0];reset.fields.wants='Wrong';W.writeWorldEntry(book,reset,'World');tx=await F.prepareGuidedSwipe(0);
const concurrent=W.listWorld(book,'World')[0];concurrent.fields.wants='Another edit';W.writeWorldEntry(book,concurrent,'World');await F.restoreGuidedSwipe(tx);assert.equal(W.listWorld(book,'World')[0].fields.wants,'Another edit');
assert(writes>=3); console.log('guided transaction: rollback, cancel, conflict and concurrent edit: passed');
// If the host declines to generate a swipe, the transaction is restored and
// the one-shot direction cannot leak into a later request.
const finalReset=W.listWorld(book,'World')[0];finalReset.fields.wants='Wrong';W.writeWorldEntry(book,finalReset,'World');
c.swipe={right:async()=>{}};globalThis.document={body:{dataset:{}}};
const E=await import('../../src/engine.js');let timer;
const realTimeout=globalThis.setTimeout;globalThis.setTimeout=fn=>{timer=fn;return 1};
try { cs.manualWorldChanges=[{anchor:'record:100'}];await assert.rejects(E.guideSwipe('A different direction'),/manually edited/);assert.equal(W.listWorld(book,'World')[0].fields.wants,'Wrong'); await E.guideSwipe('A different direction',{keepManualEdits:true});assert(E.guidedSwipeActive());assert.equal(W.listWorld(book,'World')[0].fields.wants,'Before');timer();await F.worldIdle();assert(!E.guidedSwipeActive());assert.equal(W.listWorld(book,'World')[0].fields.wants,'Wrong'); }
finally {globalThis.setTimeout=realTimeout;}
console.log('guided swipe that does not start restores the world and clears direction: passed');
