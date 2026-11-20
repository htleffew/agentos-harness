import { ctx, KEY, isReply, isStory } from './st.js';

export const ACTIVATION_MODES = ['default','always','triggered','window','off'];

export function readActivation(value) {
    if (!value || !ACTIVATION_MODES.includes(value.mode) || value.mode==='default') return null;
    const bounded = (number,max,fallback) => Number.isFinite(Number(number)) ? Math.max(0,Math.min(max,Math.floor(Number(number)))) : fallback;
    return {
        mode:value.mode,
        keys:Array.isArray(value.keys) ? value.keys.filter(key=>typeof key==='string' && key.trim()).map(key=>key.trim().slice(0,100)).slice(0,50) : [],
        chance:bounded(value.chance,100,100), sticky:bounded(value.sticky,100,0),
        window:bounded(value.window,200,6), after:bounded(value.after,Number.MAX_SAFE_INTEGER,0),
    };
}

function matches(text, key) {
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
    const anchor = lastInput?.send_date ?? lastInput?.mes ?? next;
    return row => {
        const rule = row.activation;
        if (!rule) return {on:true,fresh:false};
        if (rule.mode==='off') return {on:false,fresh:false};
        const uid = String(row.uid);
        if (rule.sticky && replies.slice(-rule.sticky).some(message=>{
            const receipt = message.extra?.[KEY]?.recall;
            return receipt?.book===book && receipt.fresh?.includes(uid);
        })) return {on:true,fresh:false};
        const eligible = rule.mode==='always' ||
            rule.mode==='window' && next<=rule.after+rule.window ||
            ['triggered','window'].includes(rule.mode) && rule.keys.some(key=>matches(input,key));
        const on = eligible && (rule.chance===100 || draw(`${book}:${uid}:${anchor}`)<rule.chance);
        return {on,fresh:on};
    };
}
