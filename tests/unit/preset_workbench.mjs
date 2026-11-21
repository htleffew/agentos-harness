import assert from 'node:assert/strict';
import test from 'node:test';
import {editPresetBlock, hasPresetEdit} from '../../src/preset-workbench.js';

test('native save failures, concurrent edits, shared preset data and individual restores',async()=>{
    const original={
        prompts:['a','b','c'].map(identifier=>({identifier,name:identifier,content:identifier,role:'system',extra:{category:'imported'}})),
        prompt_order:[{character_id:100001,order:['a','b','c'].map(identifier=>({identifier,enabled:true}))},{character_id:77,order:[{identifier:'b',enabled:false}]}],
        extensions:{vendor:{version:7}},temperature:0.55,
    };
    const stored=structuredClone(original),live=structuredClone(original);
    live.temperature=0.88;
    let active='Imported',write,blockSave,fail=true;
    const manager={
        getSelectedPresetName:()=>active,
        getPresetList:()=>({preset_names:{Imported:0},presets:[stored]}),
        async savePreset(name,data){
            assert.equal(name,'Imported');if(fail)throw new Error('disk failure');
            if(blockSave)await new Promise(resolve=>write=resolve);
            assert.deepEqual(data.extensions,original.extensions);
            assert.deepEqual(data.prompt_order[1],original.prompt_order[1]);
            assert.equal(data.temperature,0.55);
        },
    };
    const host={mainApi:'openai',chatCompletionSettings:live,extensionSettings:{},saveSettingsDebounced(){},getPresetManager:()=>manager};
    globalThis.SillyTavern={getContext:()=>host};
    await assert.rejects(editPresetBlock(active,'b',{type:'move',delta:-1}),/disk failure/);
    assert.deepEqual(stored,original);assert.equal(hasPresetEdit(active,'b'),false);
    fail=false;blockSave=true;
    const pending=editPresetBlock(active,'b',{type:'move',delta:-1});
    await assert.rejects(editPresetBlock(active,'a',{type:'enabled',value:false}),/saving/);
    write();await pending;blockSave=false;
    assert.equal(live.prompt_order[0].order[0].identifier,'b');
    assert.equal(live.temperature,0.88);
    await editPresetBlock(active,'c',{type:'text',name:'Rewritten',role:'assistant',content:'new words'});
    await editPresetBlock(active,'b',{type:'restore'});
    assert.deepEqual(live.prompt_order,original.prompt_order);
    assert.equal(live.prompts[2].content,'new words');
    assert.equal(hasPresetEdit(active,'c'),true);assert.equal(hasPresetEdit(active,'b'),false);
    blockSave=true;
    const restore=editPresetBlock(active,'c',{type:'restore'});
    active='Different preset';write();await restore;
    assert.deepEqual(stored,original);assert.equal(live.prompts[2].content,'new words');
});
