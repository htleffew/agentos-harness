import assert from 'node:assert/strict';
import test from 'node:test';
import { activeQuickPlan, applyQuickPrompt, applyQuickText, bindQuickReply, failQuickReply, finishQuickReply, freshRemaining,
    hasQuickEvidence, observeQuickTextAnchor, playerContribution, queueDirections, quickChat, queuedRetry, reconcileQuickDelivery, retryQueuedReply, splitQuickEvidence, startQuickReply, stopFreshStart, stripStoredQuickDirections, stripStoredQuickText }
    from '../../src/quick-action-chat.js';

const events = ['MESSAGE_SENT','CHAT_COMPLETION_PROMPT_READY','WORLDINFO_SCAN_DONE','WORLDINFO_ENTRIES_LOADED','GENERATE_BEFORE_COMBINE_PROMPTS','GENERATE_AFTER_COMBINE_PROMPTS'];
const KEY = 'roleplay_instructions';
const host = {
    extensionSettings:{}, chatMetadata:{}, chat:[], mainApi:'openai', characterId:'0', characters:[{avatar:'captain.png'}],
    key:'test parent', getCurrentChatId(){return this.key;}, eventTypes:Object.fromEntries(events.map(name=>[name,name])),
    saveSettingsDebounced(){}, saveMetadataDebounced(){}, async saveChat(){},
};
const composer = {value:''};
globalThis.SillyTavern = {getContext:()=>host};
globalThis.document = {body:{dataset:{}},getElementById:()=>composer};

function reset() {
    host.chat=[];
    host.chatMetadata={};
    host.key='test parent';
    host.mainApi='openai';
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
    const automatic={type:'normal'};
    startQuickReply(automatic,{automatic_trigger:true});
    assert.equal(automatic.quickDelivery,false);
    assert.equal(activeQuickPlan(automatic)?.freshStart,true);
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
    host.mainApi='openai';
    host.chatMetadata=parent;
    assert.equal(freshRemaining(),1);
    stopFreshStart();
    assert.equal(freshRemaining(),0);
    assert.equal(quickChat().pending.length,1);
});

test('Text Completion puts directions on the native player entry and keeps the host output prefix',async()=>{
    reset();
    host.mainApi='textgenerationwebui';
    queueDirections([],'Tell her to lower the lamp.');
    queueDirections([],'The tide stays out.',{visibility:'visible',required:true});
    const gen=start();
    const player=await send(gen,'I touch the lantern.');
    const plan=activeQuickPlan(gen);
    const actual='[input]'+player.mes+'[/input]';
    observeQuickTextAnchor({finalMesSend:[{message:actual}]},plan);
    const assembled=applyQuickText(stripStoredQuickText('Standing prefix\n'+actual+'\n[output]'),plan);
    assert.match(assembled,/^Standing prefix\nDirections/);
    assert.match(assembled,/Required direction Q1\. The tide stays out\.\)\[\/input\]\n\[output\]$/);
    assert.equal(assembled.split('The tide stays out.').length-1,1);
    assert.equal(plan.snapshot.receipt.observedRoute,'Text Completion');
    assert.equal(plan.confirmed,true);
    assert.equal(applyQuickText('Separate helper prompt',plan),'Separate helper prompt');
});

test('restores the queue after interrupted acknowledgment and retries an existing player turn with a draft',async()=>{
    reset();
    queueDirections([],'Look past the gate.');
    const first=await send(start(),'I ask about the old path.');
    composer.value='/newchat remains unsent';
    host.generate=async (operation,opts)=>{
        assert.equal(operation,'normal');
        assert.equal(opts.depth,1);
        assert.equal(composer.value,'/newchat remains unsent');
        const request=[{role:'user',content:first.mes}];
        const plan=activeQuickPlan(start());
        const receipt=applyQuickPrompt(request,plan);
        assert.match(request[0].content,/Look past the gate/);
        const historical={...receipt,outcome:'accepted'};
        host.chat.push({mes:'The path bends left.',swipe_info:[{extra:{[KEY]:{quickActions:historical}}}]});
    };
    await retryQueuedReply();
    assert.equal(composer.value,'/newchat remains unsent');
    assert.equal(quickChat().pending.length,1);
    reconcileQuickDelivery();
    assert.equal(quickChat().lastReceipt.outcome,'accepted');
    assert.equal(quickChat().pending.length,0);
    delete host.generate;
});

test('requires an accepted prose quote and keeps evidence metadata out of the story',()=>{
    const prose='She raises a bronze lantern.';
    const result=splitQuickEvidence(prose+'\n<direction_evidence>{"Q1":"She raises a bronze lantern.","Q2":"He throws the door open."}</direction_evidence>\n<story_update>when: dusk</story_update>');
    assert.equal(result.text,prose+'\n<story_update>when: dusk</story_update>');
    assert.equal(hasQuickEvidence(prose,result.evidence.get('Q1')),true);
    assert.equal(hasQuickEvidence(prose,result.evidence.get('Q2')),false);
    assert.equal(splitQuickEvidence(prose+'<direction_evid',{streaming:true}).text,prose);
    assert.equal(splitQuickEvidence(prose+'<direction_evidence>{invalid').text,prose);
});
