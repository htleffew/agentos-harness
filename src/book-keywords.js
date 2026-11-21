import { request } from './ai.js';
import { ctx, parseJson } from './st.js';
import { settings } from './store.js';
import { promptText } from './prompts.js';

export async function suggestEntryKeywords({ title, text }) {
    const content=String(text || '').trim();
    if (!content) throw new Error('Enter the entry’s text first.');
    const chat=ctx().getCurrentChatId?.();
    const result=await request({what:'Suggest lorebook trigger phrases',system:promptText('systemBookKeywords'),
        user:`${promptText('bookKeywords')}\nReturn a JSON object with a keywords array of strings.\n${JSON.stringify({title,text:content.slice(0,8000)})}`,
        tokens:400,profileId:settings().profileId,retryEmpty:false});
    if (ctx().getCurrentChatId?.()!==chat) throw new Error('The chat changed before suggestions arrived.');
    const value=parseJson(result.text,{object:true});
    if (!Array.isArray(value?.keywords)) {
        result.note('The keyword list could not be read.',false);
        throw new Error('The model returned an unreadable keyword list.');
    }
    const seen=new Set();
    const phrases=[];
    for (const raw of value.keywords) {
        const phrase=typeof raw==='string' ? raw.trim() : '';
        const key=phrase.toLowerCase();
        if (!phrase || phrase.length>100 || /[\r\n{}]/.test(phrase) || phrase.startsWith('/') || seen.has(key)) continue;
        seen.add(key);
        phrases.push(phrase);
        if (phrases.length===12) break;
    }
    result.note(`Prepared ${phrases.length} trigger phrase suggestions for review.`);
    return phrases;
}
