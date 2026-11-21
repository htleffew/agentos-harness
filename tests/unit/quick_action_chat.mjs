import assert from 'node:assert/strict';
import test from 'node:test';
import { activeQuickPlan, applyQuickPrompt, bindQuickReply, failQuickReply, finishQuickReply, freshRemaining,
    playerContribution, queueDirections, quickChat, queuedRetry, startQuickReply, stopFreshStart, stripStoredQuickDirections }
    from '../../src/quick-action-chat.js';

const events = ['MESSAGE_SENT','CHAT_COMPLETION_PROMPT_READY','WORLDINFO_SCAN_DONE','WORLDINFO_ENTRIES_LOADED'];
const KEY = 'roleplay_instructions';
const host = {
    extensionSettings:{}, chatMetadata:{}, chat:[], mainApi:'openai', characterId:'0', characters:[{avatar:'captain.png'}],
    key:'test parent', getCurrentChatId(){return this.key;}, eventTypes:Object.fromEntries(events.map(name=>[name,name])),
    saveSettingsDebounced(){}, saveMetadataDebounced(){}, async saveChat(){},
};
const composer = {value:''};
globalThis.SillyTavern = {getContext:()=>host};
globalThis.document = {getElementById:()=>composer};

function reset() {
    host.chat=[];
    host.chatMetadata={};
    host.key='test parent';
    composer.value='';
}
function start(type='normal') {
    const gen={type};
    startQuickReply(gen,{});
    return gen;
}
async function send(gen,text) {
    const message={is_user:true,mes:text};
    host.chat.push(message);
    await bindQuickReply(gen,host.chat.length-1);
    return message;
}
function accept(plan,type='normal') {
    const record={type}, message={mes:'A reply',extra:{[KEY]:record},swipe_id:0,swipe_info:[{extra:{}}]};
    host.chat.push(message);
    finishQuickReply(plan,message,record);
    return record;
}

test('holds the exact resolved snapshot through failure and strips expired visible text',async()=>{
    reset();
    const roll={id:'fixture die',text:'The die rolled eleven.'};
    queueDirections([{text:'Only the ordinary reply should contain this.',visibility:'private'}],'', {roll});
    queueDirections([],'Make this visible.',{visibility:'visible'});
    const gen=start();
    const user=await send(gen,'I open the gate.');
    assert.equal(playerContribution(user),'I open the gate.');
    const exactly=()=>[{role:'system',content:'Standing prefix'},{role:'user',content:user.mes}];
    const request=exactly();
    const plan=activeQuickPlan(gen);
    stripStoredQuickDirections(request);
    const first=applyQuickPrompt(request,plan);
    assert.equal(request[0].content,'Standing prefix');
    assert.equal(first.rolls[0].id,roll.id);
    assert.equal(request.at(-1).content,'I open the gate.\n\n(OOC: Make this visible.)');
    failQuickReply(plan);
    for (const type of ['impersonate','quiet','swipe','continue']) assert.equal(activeQuickPlan(start(type)),null);
    assert.equal(queuedRetry(),true);
    const retry=activeQuickPlan(start());
    const again=exactly();
    stripStoredQuickDirections(again);
    const second=applyQuickPrompt(again,retry);
    retry.confirmed=true;
    const accepted=accept(retry);
    assert.deepEqual(again,request);
    assert.equal(accepted.quickActions.attempts,2);
    assert.equal(second.rolls[0].id,roll.id);
    assert.equal(quickChat().pending.length,0);
    assert.equal(queuedRetry(),false);
    const future=exactly();
    stripStoredQuickDirections(future);
    assert.equal(future.at(-1).content,'I open the gate.');
});

test('counts accepted forward slots by surviving chat history and gives a branch its own state',async()=>{
    reset();
    queueDirections([],'',{freshStart:'five'});
    const gen=start();
    await send(gen,'I check the door.');
    const plan=activeQuickPlan(gen);
    applyQuickPrompt([{role:'user',content:'I check the door.'}],plan);
    plan.confirmed=true;
    accept(plan);
    assert.equal(freshRemaining(),4);
    accept(null,'swipe');
    accept(null,'continue');
    assert.equal(freshRemaining(),4);
    for(let index=0;index<4;index++) accept(activeQuickPlan(start()));
    assert.equal(freshRemaining(),0);
    host.chat.pop();
    assert.equal(freshRemaining(),1);
    queueDirections([],'Keep the original source private.');
    const parent=structuredClone(host.chatMetadata);
    host.key='test branch';
    assert.equal(freshRemaining(),0);
    assert.deepEqual(quickChat().pending,[]);
    host.key='test parent';
    host.chatMetadata=parent;
    assert.equal(freshRemaining(),1);
    stopFreshStart();
    assert.equal(freshRemaining(),0);
    assert.equal(quickChat().pending.length,1);
});
