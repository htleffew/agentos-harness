import assert from 'node:assert/strict';
let id = 'chat-a';
const chat = [
 {mes:'Opening line', is_user:false},
 {mes:'Hello there', is_user:true},
 {mes:'She greets you.', is_user:false},
 {mes:'The hidden past', is_user:true,is_system:true},
 {mes:'The latest reply.', is_user:false},
];
globalThis.SillyTavern = { getContext:()=>({chat,getCurrentChatId:()=>id,substituteParams:s=>s}) };
const C = await import('../../src/context-budget.js');
assert.equal(C.historyPreview(4).count,4);
assert.equal(C.historyPreview(4).hidden,1);
assert.deepEqual(C.chapterPreview(1),{ replies:1,messages:2,tokens:9 });
const notes='[Story notes.\nThe story so far:\n- A brief chapter.\nOpen threads:\n- A clue.]';
const event='[An event must happen: thunder.]';
const ask='[Please output <story_update>.]';
const prompt=[{role:'system',content:`${notes}\n${event}\n${ask}`},{role:'assistant',content:'Opening line'},{role:'user',content:'Hello there'},{role:'assistant',content:'She greets you.'},{role:'assistant',content:'The latest reply.'}];
const r=C.captureContext(prompt,{items:[{notes:{},text:notes},{event:{},text:event},{text:'not in the prompt'}],ask});
assert.equal(r.history.count,4);assert.equal(r.history.unmatched,0);assert(r.chapters.tokens>0);assert(r.notes.tokens>0);assert(r.events.tokens>0);assert(r.updates.tokens>0);assert.equal(r.other.unmatched,1);
assert.equal(C.lastContext(),r);id='chat-b';assert.equal(C.lastContext(),null);
const m=C.captureContext([{role:'user',content:[{type:'text',text:'Hi'},{type:'image_url',image_url:{url:'x'}}]}]);assert(m.unsupportedContent);
console.log('context budget: protected-window previews, last-request matching, unmatched data, chat isolation and non-text warning passed');
