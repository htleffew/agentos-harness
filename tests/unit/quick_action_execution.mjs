import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from '../../src/ai.js';
import { impersonationSource, draftImpersonation, setImpersonationSource, saveImpersonationField } from '../../src/impersonation.js';
import { automaticAllowed, executionPreview, executionReceipt, runAdditional, setExecutionSetting } from '../../src/execution.js';
import { promptOwner, listVariations, saveVariation, setVariationRemoved } from '../../src/prompt-variations.js';
import { exportVoice, importVoice, createVoice } from '../../src/voices.js';
import { roastVoiceText, savePrompt, restorePrompt } from '../../src/prompts.js';
import { editPresetBlock, linkPresetRestoreFile, presetBlockRevision, presetBlockVariation, presetRows } from '../../src/preset-workbench.js';

test('an additional action dispatches once through the selected route and blocks missing or unauthorized routes',async()=>{
    const requests=[];
    let backend='an answer',chat='chat-a';
    const model={
        mainApi:'openai',chatCompletionSettings:{chat_completion_source:'custom'},getChatCompletionModel:()=> 'main-model',
        extensionSettings:{connectionManager:{profiles:[{id:'small',name:'Small model'}]}},getCurrentChatId:()=>chat,
        generateRaw:async args=>{requests.push(['main',args]);if (backend instanceof Error) throw backend;return backend;},
        ConnectionManagerRequestService:{sendRequest:async (id,messages,tokens,options)=>{
            requests.push([id,messages,tokens,options]);return {content:backend};
        }},
    };
    globalThis.SillyTavern={getContext:()=>model};
    assert.equal(executionPreview('playerDraft').connection,'Main API (openai · custom · main-model)');
    assert.equal(automaticAllowed('chapterSummary'),false);
    await assert.rejects(runAdditional('chapterSummary',{authorization:'automatic'},()=>{throw new Error('called');}),
        error=>error.receipt.attempts===0 && error.receipt.outcome==='blocked');
    assert.equal(requests.length,0);
    const work={operation:'playerDraft',authorization:'manual',what:'Draft my reply',system:'Standing instruction',user:'Current direction'};
    const first=await request(work);
    assert.equal(first.receipt.attempts,1);
    assert.equal(first.receipt.outcome,'completed');
    first.note('Read the draft.');
    assert.equal(executionReceipt('playerDraft','chat-a').result,'Read the draft.');
    setExecutionSetting('playerDraft',{profileId:'small'});
    chat='chat-b';
    const second=await request({...work,useProfilePreset:false});
    assert.equal(second.receipt.profileId,'small');
    assert.deepEqual(requests[1][1],[{role:'system',content:work.system},{role:'user',content:work.user}]);
    assert.equal(requests[1][3].includePreset,false);
    model.extensionSettings.connectionManager.profiles=[];
    await assert.rejects(request(work),error=>error.receipt.attempts===0 && /unavailable/.test(error.message));
    assert.equal(requests.length,2);
    setExecutionSetting('playerDraft',{profileId:''});
    backend='';
    await assert.rejects(request(work),error=>error.receipt.attempts===1 && /empty answer/.test(error.message));
    assert.equal(requests.length,3);
    backend=Object.assign(new Error('stream broke'),{partialText:'I take a step'});
    await assert.rejects(request(work),error=>error.receipt.attempts===1 && error.receipt.partialText==='I take a step');
    assert.equal(requests.length,4);
    setExecutionSetting('chapterSummary',{automatic:true});
    backend='a chapter';
    const chapter=await request({operation:'chapterSummary',authorization:'automatic',what:'Chapter summary',user:'Current chapter'});
    assert.equal(chapter.receipt.attempts,1);
    const abort=new AbortController(); abort.abort();
    await assert.rejects(request({...work,signal:abort.signal}),error=>error.name==='AbortError' && error.receipt.attempts===0);
    assert.equal(requests.length,5);

    model.characters=[{avatar:'first.png'},{avatar:'second.png'}];
    model.characterId=0;
    const firstCharacter=await request(work);
    model.characterId=1;
    assert.equal(executionReceipt('playerDraft'),null);
    assert.equal(executionReceipt('playerDraft',chat,'char:first.png').id,firstCharacter.receipt.id);

    const midstream=new AbortController();
    model.generateRaw=async()=>{midstream.abort();return 'I kept waiting.';};
    await assert.rejects(request({...work,signal:midstream.signal}),error=>error.receipt.attempts===1 &&
        error.receipt.outcome==='cancelled' && error.receipt.partialText==='I kept waiting.');

    firstCharacter.receipt.outcome='cancelled';
    firstCharacter.note('Discarded the result.',false);
    assert.equal(executionReceipt('playerDraft',chat,'char:first.png').outcome,'cancelled');
});

test('preset fields keep distinct sources, draft variations survive restore, and stale targets fail closed',async()=>{
    const source={name:'Imported',impersonation_prompt:'My cue for {{user}}',prompts:['a','b','c'].map(identifier=>({identifier,name:identifier,content:identifier,role:'system',foreign:{tag:identifier}})),
        prompt_order:[{character_id:100001,order:['a','b','c'].map(identifier=>({identifier,enabled:true}))}]};
    const stored=structuredClone(source),live=structuredClone(source),write=[];
    let preset='Imported';
    const host={mainApi:'openai',chatCompletionSettings:live,extensionSettings:{},substituteParams:value=>value.replaceAll('{{user}}','Alex'),
        getPresetManager:()=>({getSelectedPresetName:()=>preset,getCompletionPresetByName:()=>stored,savePreset:async (name,value)=>write.push([name,structuredClone(value)])})};
    globalThis.SillyTavern={getContext:()=>host};
    assert.equal(draftImpersonation().expanded,'My cue for Alex');
    assert.equal(draftImpersonation({mode:'native'}).include,false);
    setImpersonationSource(impersonationSource(),'extension');
    assert.equal(draftImpersonation().kind,'extension');
    preset='Other';
    assert.equal(draftImpersonation().expanded,'My cue for Alex');
    preset='Imported';
    live.impersonation_prompt='Read {{lastMessage}}';
    setImpersonationSource(impersonationSource(),'preset');
    assert.equal(draftImpersonation().privateMacro,true);
    assert.doesNotMatch(draftImpersonation().expanded,/lastMessage/);
    live.impersonation_prompt='My cue for {{user}}';
    const blank=await saveImpersonationField(impersonationSource(),'');
    assert.equal(blank.kind,'blank');
    assert.equal(blank.status,'Blank host field');
    assert.equal(write[0][1].impersonation_prompt,'');
    setImpersonationSource(blank,'preset');
    assert.equal(draftImpersonation().expanded,'');
    host.mainApi='textgenerationwebui';
    host.powerUserSettings={instruct:{enabled:true,preset:'Plain',last_input_sequence:'USER:'}};
    assert.equal(impersonationSource().kind,'instruct');
    assert.equal(impersonationSource().text,'USER:');
    assert.equal(impersonationSource().writable,false);
    assert.equal(draftImpersonation().source,'Extension player draft instruction');
    host.powerUserSettings.instruct.enabled=false;
    assert.equal(impersonationSource().kind,'opaque');
    assert.equal(impersonationSource().text,null);
    assert.equal(draftImpersonation().host.status,'Host wording unavailable');
    host.mainApi='openai';
    const manager=host.getPresetManager;
    delete host.getPresetManager;
    live.impersonation_prompt='A readable cue from a read-only host.';
    assert.equal(impersonationSource().status,'Read-only host wording');
    assert.equal(draftImpersonation().expanded,live.impersonation_prompt);
    await assert.rejects(saveImpersonationField(impersonationSource(),'Change read-only text'),/read-only/);
    host.getPresetManager=manager;
    const row=presetRows().find(item=>item.id==='b');
    const owner=promptOwner('preset',preset,row.id);
    const first=saveVariation(owner,{name:'First',value:{...presetBlockVariation(row),content:'New {{char}} words'}});
    const second=saveVariation(owner,{name:'Second',value:{...first.value,role:'assistant',triggers:['swipe']}});
    const stale=presetBlockRevision('b');
    await editPresetBlock(preset,'b',{type:'move',delta:1});
    await assert.rejects(editPresetBlock(preset,'b',{type:'variation',value:first.value,expected:stale}),/block changed/);
    await editPresetBlock(preset,'c',{type:'text',name:'c',content:'Neighbor edit',role:'system'});
    await editPresetBlock(preset,'b',{type:'variation',value:second.value});
    assert.equal(presetRows().find(item=>item.id==='b').role,'assistant');
    assert.deepEqual(live.prompt_order[0].order.map(item=>item.identifier),['a','b','c']);
    const original=structuredClone(source); original.prompts[1].content='From the original file';
    linkPresetRestoreFile(preset,'Imported.json',original);
    await editPresetBlock(preset,'b',{type:'restore',from:'file'});
    assert.equal(live.prompts[1].content,'From the original file');
    await editPresetBlock(preset,'b',{type:'undo'});
    assert.equal(live.prompts[1].content,'New {{char}} words');
    await editPresetBlock(preset,'b',{type:'restore',from:'before'});
    assert.equal(live.prompts[1].content,source.prompts[1].content);
    assert.equal(live.prompts[2].content,'Neighbor edit');
    assert.deepEqual(live.prompts[1].foreign,{tag:'b'});
    setVariationRemoved(owner,second.id,true);
    assert.equal(listVariations(owner).length,1);
    setVariationRemoved(owner,second.id,false);
    assert.equal(listVariations(owner).length,2);
});

test('a custom commentator restores and carries active text and independent variations through export',()=>{
    globalThis.SillyTavern={getContext:()=>host};
    const host={extensionSettings:{}};
    const voice=createVoice('Court chronicler','Speak with medieval precision.');
    const owner=promptOwner('extension',voice.id);
    saveVariation(owner,{name:'Aloof',value:'Stay remote and precise.'});
    saveVariation(owner,{name:'Warm',value:'Speak warmly and precisely.'});
    savePrompt(voice.id,'Speak warmly and precisely.');
    assert.equal(roastVoiceText(),'Speak warmly and precisely.');
    const file=exportVoice(voice.id);
    restorePrompt(voice.id);
    assert.equal(roastVoiceText(),voice.text);
    const other=importVoice(file);
    assert.notEqual(other.id,voice.id);
    assert.equal(listVariations(promptOwner('extension',other.id)).length,2);
    assert.equal(listVariations(owner).length,2);
    assert.equal(roastVoiceText(),'Speak warmly and precisely.');
});
