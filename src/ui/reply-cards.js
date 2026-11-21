import { h } from './dom.js';
import { STATE_FIELDS } from '../state.js';
import { AXES } from '../v10.js';

export function replyChip(text, tone = 'slate') {
    return h('span',{class:'ri-reply-chip','data-tone':tone},text);
}

export function revealReplyBody(card,panel) {
    requestAnimationFrame(()=>{
        const chat = card.closest('#chat');
        if (!chat || !card.open || !panel) return;
        const composer = document.querySelector('#send_form')?.getBoundingClientRect();
        const bottom = Math.min(innerHeight,chat.getBoundingClientRect().bottom,composer?.height ? composer.top : Infinity);
        const pos = panel.getBoundingClientRect();
        if (pos.top + Math.min(72,pos.height) > bottom) card.firstElementChild.scrollIntoView({block:'center'});
    });
}

export function replyCardHeader({ icon, eyebrow, title, subtitle = '', badges = [], chips = [], status }) {
    return h(status ? 'div' : 'summary', { class: 'ri-reply-head',onclick:status ? undefined : event=>{
        const head = event.currentTarget;
        const card = head.parentElement;
        if (card?.tagName==='DETAILS' && !card.open) revealReplyBody(card,head.nextElementSibling);
    } },
        h('span', { class: 'ri-reply-symbol', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'ri-reply-heading' },
            eyebrow ? h('span', { class: 'ri-reply-eyebrow' }, eyebrow) : null,
            h('span', { class: 'ri-reply-title' }, title),
            subtitle ? h('span', { class: 'ri-reply-subtitle' }, subtitle) : null,
            chips.length ? h('span',{class:'ri-reply-chip-rail'},chips.map(({text,tone})=>replyChip(text,tone))) : null),
        badges.length ? h('span', { class: 'ri-reply-badges', 'aria-hidden': 'true' }, badges.map(label => h('span', { class: 'ri-reply-badge' }, label))) : null,
        status || h('span', { class: 'ri-reply-chevron', 'aria-hidden': 'true' }, '⌄'));
}

export function storyStateChips(people, changes) {
    return [
        people && {text:`${people} ${people===1 ? 'character' : 'characters'}`,tone:'sky'},
        changes && {text:`${changes} ${changes===1 ? 'change' : 'changes'}`,tone:'mint'},
    ].filter(Boolean);
}

export function loreChips(entries, confirmed) {
    return [{text:`${entries} ${entries===1 ? 'entry' : 'entries'}`,tone:'sky'},
        confirmed && {text:`${confirmed} confirmed in prompt`,tone:'mint'}].filter(Boolean);
}

function roastEmphasis(line) {
    const pieces = [];
    let end = 0;
    for (const match of line.matchAll(/\*\*([^*]+)\*\*|\*([^*]+)\*/g)) {
        pieces.push(line.slice(end, match.index), match[1] ? h('strong',{},match[1]) : h('em',{},match[2]));
        end = match.index + match[0].length;
    }
    pieces.push(line.slice(end));
    return pieces;
}

export function roastCard(text, attrs = {}, status) {
    const paragraphs = text.trim().split(/\r?\n\s*/).filter(Boolean);
    return h(status ? 'div' : 'details', {class:'ri-roast ri-reply-card ri-reply-roast',...attrs},
        replyCardHeader({icon:'“',title:'Roast',subtitle:'Reader reaction',status}),
        !status && h('blockquote',{class:'ri-roast-v ri-reply-quote'},paragraphs.map(line=>h('p',{},roastEmphasis(line)))),
        !status && executionDetails({label:'Reader reaction',stage:'reply',connection:'Original reply connection',attempts:0,
            outcome:'completed',result:'Generated in the character reply.'}));
}

export function replyGlance({scene,people,profiles,records,changed,hasSavedTabs,pending = {}}, openTab) {
    const card = (kind,tab,...children) => h(openTab ? 'button' : 'div',{
        class:`ri-glance-card ri-glance-${kind}`,
        type:openTab ? 'button' : undefined,
        onclick:openTab ? ()=>openTab(tab) : undefined,
    },children);
    const skeleton = () => h('span',{class:'ri-card-skeleton','aria-hidden':'true'});
    const order = new Set(changed.map(person=>person.name));
    const info = new Map(profiles.map(profile=>[profile.subject,profile]));
    const cast = [...people, ...profiles.filter(profile=>!people.some(person=>person.name===profile.subject))
        .map(profile=>({name:profile.subject,fields:{}}))];
    cast.sort((a,b)=>Number(order.has(b.name))-Number(order.has(a.name)));
    const castCards = cast.flatMap(person=>{
        const lines = STATE_FIELDS.filter(([key])=>person.fields[key]);
        const profile = info.get(person.name);
        const preview = profile?.facet || profile?.text;
        if (!lines.length && !preview) return [];
        return [card('person',person.name,
            h('span',{class:'ri-glance-title'},h('span',{class:'ri-glance-emblem','aria-hidden':'true'}),person.name),
            lines.length ? h('span',{class:'ri-glance-fields'},lines.map(([key,label])=>
                h('span',{class:'ri-glance-field','data-state':key},h('span',{},label),h('span',{},person.fields[key]))))
                : h('span',{class:'ri-glance-copy'},preview))];
    }).slice(0,3);
    if (pending.cast && !castCards.length) {
        castCards.push(card('person',null,
            h('span',{class:'ri-glance-title'},h('span',{class:'ri-glance-emblem','aria-hidden':'true'}),'Characters'),
            h('span',{class:'ri-glance-fields'},STATE_FIELDS.map(([key,label])=>
                h('span',{class:'ri-glance-field','data-state':key},h('span',{},label),skeleton())))));
    }
    const filed = records.filter(record=>record.kind==='fact' || (record.kind==='event' && record.status==='done'));
    const emotion = hasSavedTabs && records.find(record=>record.kind==='emotion' && AXES.some(axis=>Number.isInteger(record.axes?.[axis])));
    const scenePreview = scene.environment || (!castCards.length && scene.present) || scene.where;
    const contextCards = [
        (scenePreview || pending.scene) && card('scene','Scene',
            h('span',{class:'ri-glance-title'},'Scene'),h('span',{class:'ri-glance-copy'},scenePreview || skeleton())),
        emotion && card('emotions','Emotions',
            h('span',{class:'ri-glance-title'},'Emotions'),h('span',{class:'ri-glance-copy'},emotion.subject),
            h('span',{class:'ri-glance-axes'},AXES.filter(axis=>Number.isInteger(emotion.axes[axis])).map(axis=>
                h('span',{class:'ri-glance-axis','data-axis':axis},h('span',{},axis),
                    h('meter',{min:0,max:10,value:emotion.axes[axis],'aria-label':axis}),h('span',{},`${emotion.axes[axis]}/10`))))),
        (filed.length>0 || pending.changes) && card('changes','Changes',
            h('span',{class:'ri-glance-title'},'Story changes'),!filed.length && skeleton(),filed.slice(0,2).map(record=>h('span',{class:'ri-glance-copy'},record.text))),
    ].filter(Boolean);
    return castCards.length || contextCards.length ? h('div',{class:'ri-reply-glance',role:'group','aria-label':'Story state at a glance'},
        castCards.length>0 && h('div',{class:'ri-glance-cast'},castCards),
        contextCards.length>0 && h('div',{class:'ri-glance-context'},contextCards)) : null;
}
import { executionDetails } from './execution.js';
