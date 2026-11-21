import { ctx, KEY, isReply } from './st.js';
import { chatState } from './store.js';

const stop = new Set('the that this with from have instead changed should wrong correct actually were was not they their there said where into about then only been and for its theirs what which fact facts'.split(' '));
export const correctionTerms = value => [...new Set(String(value || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(word=>!stop.has(word));

export function replaceUnique(value, quote, replacement) {
    const start = value.indexOf(quote);
    if (!quote || start<0 || value.indexOf(quote,start+1)>=0) return null;
    return value.slice(0,start)+replacement+value.slice(start+quote.length);
}

export function correctedLoreEntry(entry, book = entry.world) {
    let content = entry.content;
    for (const item of chatState()?.storyCorrections || []) for (const source of item.sources || []) {
        if (source.kind!=='lore' || source.book!==book || String(source.uid)!==String(entry.uid) || typeof content!=='string') continue;
        const revised = replaceUnique(content,source.quote,source.replacement);
        if (revised!==null) content = revised;
    }
    return content===entry.content ? entry : {...entry,content};
}

export function characterCorrectionFields() {
    const host = ctx();
    const card = host.characters?.[host.characterId];
    if (!card) return [];
    const fields = host.getCharacterCardFields?.() || {};
    const uid = card.avatar || String(host.characterId);
    return ['description','personality','scenario'].flatMap(field=>{
        const before = card[field] || card.data?.[field] || fields[field];
        if (typeof before!=='string' || !before.trim()) return [];
        let after = before;
        for (const correction of chatState()?.storyCorrections || []) for (const source of correction.sources || []) {
            if (source.kind==='card' && source.uid===uid && source.field===field) {
                after = replaceUnique(after,source.quote,source.replacement) ?? after;
            }
        }
        return [{uid,field,before,after}];
    });
}

export function storyCorrectionPrompt(present = '', where = '', material = '') {
    const chat = ctx().chat || [];
    const evidence = new Set(correctionTerms([present,where,material,...chat.slice(-5).map(message=>message.mes)].join(' ')));
    const turns = chat.slice(1).filter(isReply).length;
    const items = (chatState()?.storyCorrections || []).slice().reverse().filter(item=>
        turns <= (item.replyNo ?? 0) + 2 || (item.terms || []).some(term=>evidence.has(term)));
    const lines = [];
    let size = 0;
    for (const [index,item] of items.entries()) {
        if (items.slice(0,index).some(newer=>newer.sources?.some(source=>source.quote===item.truth &&
            source.replacement!==item.truth))) continue;
        if (!item.truth || size+item.truth.length>1600) continue;
        lines.push('- '+item.truth);
        size += item.truth.length+3;
    }
    return lines.length ? '[Accepted story corrections. Treat these as canon when older narration, summaries or lore disagree. Preserve differences between established truth and what an individual character knows.\n'+lines.join('\n')+']' : '';
}

export function isRejectedStoryClaim(text) {
    const normalized = String(text || '').trim().toLowerCase().replace(/[.!?]+$/,'');
    if (normalized.length<16) return false;
    const changes = (chatState()?.storyCorrections || []).flatMap(item=>item.sources || []);
    const match = changes.findLast(source=>source.kind==='world' && source.field==='text' &&
        [source.quote,source.replacement].some(value=>value.trim().toLowerCase().replace(/[.!?]+$/,'')===normalized));
    return !!match && match.quote.trim().toLowerCase().replace(/[.!?]+$/,'')===normalized;
}

export function correctionMessageAnchor(message) {
    const rec = message?.extra?.[KEY];
    return rec?.time ? 'record:'+rec.time : message?.send_date ? 'message:'+message.send_date : '';
}
