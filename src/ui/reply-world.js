import { AXES, KIND_MODULE, PLOT_KINDS, readRecord } from '../v10.js';
import { WORLD_KINDS } from '../world.js';
import { readReplyWorld } from '../reply-world.js';
import { button, h } from './dom.js';
import { replyChip } from './reply-cards.js';
import { editableReplySlots, storySlots } from '../memory-journal.js';

const views = [
    ['Portrayal',['profile'],['character']],
    ['Emotions',['emotion'],[]],
    ['Relationships',['relationship'],[]],
    ['Knowledge',['knowledge'],['character']],
    ['Facts',['fact'],['place','faction','secret']],
    ['Plot',PLOT_KINDS,['thread','seed','activity']],
];
const knowledgeFields = ['knows','believes','suspects','wrong'];
const axeLabels = { tenderness:'Tenderness', fury:'Fury', dread:'Dread', yearning:'Yearning' };
const statusLabels = { open:'Open', done:'Resolved', retired:'Retired' };
const words = value => String(value || '').replace(/[-_]+/g,' ');
const join = (values, format = String) => Array.isArray(values) ? values.map(format).join(', ') : '';
const labelFor = kind => WORLD_KINDS[kind === 'seed' ? 'payoff' : kind]?.label;

function fields(items) {
    const present = items.filter(([,value]) => value !== undefined && value !== null && value !== '' && value !== false);
    return present.length ? h('dl',{class:'ri-world-fields'},present.map(([label,value])=>h('div',{},
        h('dt',{},label),h('dd',{},value)))) : null;
}

function entryCard(title, chips, content) {
    return h('li',{class:'ri-world-record'},
        h('div',{class:'ri-world-record-head'},h('strong',{},title),h('div',{class:'ri-reply-chip-rail'},chips)),
        ...content);
}

function structuredCard(record, audit, emotionTiming) {
    const { kind, id, subject, text, other, target, quote, status } = record;
    const title = [subject || words(id),other || target].filter(Boolean).join(' → ');
    const chips = [
        replyChip(labelFor(kind),'sky'),
        emotionTiming && replyChip(emotionTiming,emotionTiming==='Recorded this reply' ? 'mint' : 'slate'),
        record.basis && replyChip(words(record.basis),'indigo'),
        record.private && replyChip('Private to character','slate'),
        status && replyChip(statusLabels[status] || status,status==='done' ? 'mint' : 'indigo'),
        record.protected && replyChip('Protected','mint'),
        record.schedule && replyChip('Scheduled opportunity','indigo'),
        audit?.recalled && replyChip('Recalled for this reply','sky'),
        audit && replyChip(audit.eligible ? 'Eligible' : 'Prerequisites pending',audit.eligible ? 'mint' : 'slate'),
        audit?.offered && replyChip('Offered for this reply','indigo'),
    ];
    const axes = AXES.filter(key=>Number.isInteger(record.axes?.[key]) && record.axes[key]>=0 && record.axes[key]<=10);
    const meters = axes.length ? h('div',{class:'ri-world-meters','aria-label':'Last recorded emotion scores'},
        axes.map(key=>h('div',{class:'ri-world-meter','data-axis':key},
            h('span',{},axeLabels[key]),h('meter',{min:0,max:10,value:record.axes[key],'aria-label':axeLabels[key]}),
            h('span',{},`${record.axes[key]} / 10`)))) : null;
    const trip = record.travel;
    const details = fields([
        ['Voice',record.voice],['Facet',record.facet],['Also known as',join(record.aliases)],
        ['Portrayal sources',join(record.baseline?.sources)],
        ['Outward behavior',record.outward],['Coexisting feeling',record.counterweight],['Perspective',record.perspective],
        ['Whereabouts',record.whereabouts],['Location requirement',record.location],['Parent arc',words(record.parent)],
        ['Prerequisites',join(record.requires,words)],['Due at story minute',record.due],
        ['Travel',trip && `${trip.from} → ${trip.to} · earliest arrival at story minute ${trip.earliest}`],
        ['Schedule',record.schedule && `Weight ${record.weight ?? 1} · ${record.spacing ?? 0} replies between offers`],
        ['Possible payoff',record.payoff],['Outcome',record.outcome],
        ['Related record',words(record.link)],['Base World',record.baseEntry && `${record.baseBook || 'Base World'} · entry ${record.baseEntry}`],
        ['Relationship to Base World',words(record.baseRelation)],
    ]);
    const evidence = quote && h('details',{class:'ri-world-evidence'},h('summary',{},'Source evidence'),h('blockquote',{},quote));
    return entryCard(title,chips,[text && h('p',{class:'ri-world-record-text'},text),meters,details,evidence]);
}

function legacyCard(row, view) {
    const def = WORLD_KINDS[row.kind];
    const state = def.steps?.find(([key]) => key === row.status)?.[1];
    const selected = def.fields.filter(({key}) => {
        if (row.kind === 'character') return knowledgeFields.includes(key) === (view === 'Knowledge');
        if (row.kind === 'secret' && row.status!=='out' && row.show!=='full') return key === 'holder' || key === 'shadow';
        return true;
    });
    const details = fields(selected.map(({key,label})=>[label,row.fields[key]]));
    if (!details && row.kind!=='secret') return null;
    return entryCard(row.name,[replyChip(def.label,'sky'),state && replyChip(state,'indigo'),
        row.locked && replyChip('Protected','mint')],[details || h('p',{},'A secret is recorded.')]);
}

export function replyWorldTabs(index, modules, reply) {
    let snapshot;
    const load = () => snapshot ||= readReplyWorld(index).catch(error=>{snapshot=undefined;throw error;});
    const parts = views.filter(([,kinds])=>kinds.some(kind=>modules[KIND_MODULE[kind]])).map(([view,kinds,legacy])=>[
        view, null, async function render(panel) {
            panel.replaceChildren(h('p',{class:'ri-help',role:'status'},'Reading saved story state…'));
            try {
                const { rows, records, partial } = await load();
                const items = records || rows.flatMap(row=>{
                    const record = readRecord(row);
                    return record ? [{...record,protected:record.protected || row.locked}] : [];
                });
                const audit = new Map((reply.v10Plot || []).map(item=>[item.id,{...item,offered:item.id===reply.v10Offer}]));
                const updated = new Set((reply.v10Changes || []).map(item=>item.id));
                const cards = items.filter(record=>kinds.includes(record.kind) && modules[KIND_MODULE[record.kind]])
                    .map(record=>structuredCard(record,view==='Plot' ? audit.get(record.id) : null,
                        view==='Emotions' && (updated.has(record.id) ? 'Recorded this reply' : 'Earlier record')));
                if (view!=='Plot' || modules.plots) cards.push(...rows.filter(row=>legacy.includes(row.kind) && !readRecord(row))
                    .map(row=>legacyCard(row,view)).filter(Boolean));
                panel.replaceChildren(
                    h('div',{class:'ri-reply-chip-rail'},
                        replyChip(reply.update?.pending || storySlots().slice(-editableReplySlots()).some(row=>row.index===index) &&
                            editableReplySlots() && !reply.update?.changes?.length ? 'Recent · editable' : 'Filed','slate')),
                    reply.memoryUncertain && h('p',{class:'ri-note ri-note-warn',role:'status'},reply.memoryUncertain),
                    ...(cards.length ? [h('ul',{class:'ri-world-records'},cards)] :
                        [h('p',{class:'ri-help'},'No saved records in this section for this reply.')]),
                    ...(partial ? [h('p',{class:'ri-help'},'Showing the records that could be verified for this reply.')] : []));
            } catch (error) {
                panel.replaceChildren(h('p',{class:'ri-help',role:'status'},error.message),
                    button('Retry',()=>render(panel),{kind:'ghost'}));
            }
        },
    ]);
    return {parts,reset:()=>{snapshot=undefined;}};
}
