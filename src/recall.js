import { ctx, KEY, isReply, isStory } from './st.js';
import { BOOK_TRIGGER_SOURCES, scopedTriggerTexts } from './book-triggers.js';

export const ACTIVATION_MODES = ['default','always','triggered','window','off'];
export const RECALL_SOURCES = {...BOOK_TRIGGER_SOURCES,chat:'Recent visible conversation'};

export function readActivation(value) {
    if (!value || !ACTIVATION_MODES.includes(value.mode) || value.mode==='default') return null;
    const bounded = (number,max,fallback) => Number.isFinite(Number(number)) ? Math.max(0,Math.min(max,Math.floor(Number(number)))) : fallback;
    return {
        mode:value.mode,
        keys:Array.isArray(value.keys) ? value.keys.filter(key=>typeof key==='string' && key.trim()).map(key=>key.trim().slice(0,100)).slice(0,50) : [],
        source:Object.hasOwn(RECALL_SOURCES,value.source) ? value.source : 'chat',
        chance:bounded(value.chance,100,100), sticky:bounded(value.sticky,100,0), cooldown:bounded(value.cooldown,1000,0),
        window:bounded(value.window,200,6), after:bounded(value.after,Number.MAX_SAFE_INTEGER,0),
    };
}

export function recallTiming(rule) {
    if (!rule || rule.mode==='off') return '';
    const mode = {always:'Always eligible',triggered:'Keyword triggered',window:`First ${rule.window} replies, then keywords`}[rule.mode];
    return `${mode} · ${RECALL_SOURCES[rule.source]} · ${rule.chance}% chance · Sticky ${rule.sticky} · Cooldown ${rule.cooldown} replies`;
}

function matches(text, key) {
    const pattern = /^\/(.+)\/([gimsuy]*)$/.exec(key);
    if (pattern) {
        try { return new RegExp(pattern[1],pattern[2]).test(text); } catch { return false; }
    }
    const normalize = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const term = normalize(key);
    return !!term && ` ${normalize(text)} `.includes(` ${term} `);
}

function draw(seed) {
    let hash = 2166136261;
    for (const char of seed) hash = Math.imul(hash ^ char.codePointAt(0),16777619);
    return (hash >>> 0) % 100;
}

export function recallPolicy(book, type = 'normal') {
    const original = ctx().chat || [];
    const replace = ['swipe','regenerate','continue'].includes(type) && !original.at(-1)?.is_user;
    const chat = replace ? original.slice(0,-1) : original;
    const replies = chat.slice(1).filter(isReply);
    // Manual summaries and generated turns share the same reply numbering.
    const next = replies.length + 1;
    const lastInput = [...chat].reverse().find(message=>message.is_user && isStory(message));
    const input = chat.slice(-8).filter(message=>isStory(message) && !message.is_system).map(message=>message.mes || '').join('\n');
    const sources = {...scopedTriggerTexts(chat,'normal'),chat:input};
    const anchor = lastInput?.send_date ?? lastInput?.mes ?? next;
    return row => {
        const rule = row.activation;
        if (!rule) return {on:true,fresh:false};
        if (rule.mode==='off') return {on:false,fresh:false};
        const uid = String(row.uid);
        const last = rule.sticky || rule.cooldown ? replies.slice(-rule.sticky-rule.cooldown).findLastIndex(message=>{
            const receipt = message.extra?.[KEY]?.recall;
            return receipt?.book===book && receipt.fresh?.includes(uid);
        }) : -1;
        if (last>=0) {
            const distance=Math.min(replies.length,rule.sticky+rule.cooldown)-last;
            return {on:distance<=rule.sticky,fresh:false};
        }
        const eligible = rule.mode==='always' ||
            rule.mode==='window' && next<=rule.after+rule.window ||
            ['triggered','window'].includes(rule.mode) && !!sources[rule.source] && rule.keys.some(key=>matches(sources[rule.source],key));
        const on = eligible && (rule.chance===100 || draw(`${book}:${uid}:${next}:${anchor}`)<rule.chance);
        return {on,fresh:on};
    };
}
