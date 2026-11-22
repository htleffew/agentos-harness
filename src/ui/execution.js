import { h, field, select } from './dom.js';
import { listProfiles } from '../st.js';
import { EXECUTION_OPERATIONS, EXECUTION_STAGES, executionPreview, executionSetting, setExecutionSetting } from '../execution.js';

const detailsRow = (label,value) => value === undefined || value === '' ? null : [h('dt',{},label),h('dd',{},String(value))];

function callBudget(item) {
    if (item.stage==='code') return '0 model calls';
    if (item.stage==='reply') return '0 additional model calls';
    if (item.expected==='1 per batch') return '1 model call per batch';
    const expected=item.expected ?? 1;
    return `${expected} model call${expected===1 ? '' : 's'} expected`;
}

export function executionAction(button, expected = '1 model call') {
    button.dataset.riModelCost=expected;
    button.setAttribute('aria-description',expected);
    return button;
}

export function functionExecution(operation, { receipt = false, ...options } = {}) {
    return executionDetails(receipt || executionPreview(operation,options));
}

const openSettings = id => import('./panel.js').then(({app})=>app.openSetting('settings',`ri-operation-${id}`));

export function executionDetails(stage, { onSettings, allowSettings = true, summary } = {}) {
    const stages = Array.isArray(stage) ? stage : [stage];
    const first = stages[0], style = EXECUTION_STAGES[first?.stage] || EXECUTION_STAGES.code;
    const title = summary ?? (stages.length > 1 ? 'How it ran · multiple stages' : `How it ran · ${style.label}`);
    return h('details',{class:`ri-execution ri-execution-${first?.stage || 'code'}`},
        h('summary',{style:{minHeight:'44px',display:'flex',alignItems:'center',gap:'.5em'}},h('span',{'aria-hidden':'true'},style.icon),title),
        ...stages.filter(Boolean).map(item=>{
            const type = EXECUTION_STAGES[item.stage] || EXECUTION_STAGES.code;
            const count = callBudget(item);
            const target = typeof item.target==='object' ? item.target?.label || item.target?.id : item.target;
            const history = typeof item.history==='string' ? item.history : item.history?.mode;
            const historyLabel = history==='substituted' ? 'Request-local history substitution'
                : history==='retained' ? 'Host history retains prior prose' : history;
            const observed = typeof item.history==='object' && item.history && Object.hasOwn(item.history,'observed')
                ? item.history.observed ? ' · observed' : ' · delivery unverified' : '';
            const hasSettings=allowSettings && item.stage==='additional' && Object.hasOwn(EXECUTION_OPERATIONS,item.operation);
            const extraSources=Array.isArray(item.additionalSources) && item.additionalSources.map(({book,title,set,uid})=>
                [title || `Entry ${uid}`,set,book].filter(Boolean).join(' · ')).join('\n');
            return h('div',{class:'ri-execution-stage'},h('strong',{},item.label),
                h('dl',{},detailsRow('Execution',type.label),detailsRow('Calls',count),detailsRow('Connection',item.connection),
                    detailsRow('Route',item.observedRoute || item.route),detailsRow('History',historyLabel && historyLabel+observed),
                    detailsRow('Trigger',item.trigger),detailsRow('Target',target),detailsRow('Selected extra sources',extraSources || ''),detailsRow('Attempts used',item.attempts),
                    detailsRow('Outcome',item.outcome),detailsRow('Result',item.result)),
                item.partialText && h('details',{},h('summary',{style:{minHeight:'44px'}},'Partial output'),
                    h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},item.partialText)),
                item.problem && h('p',{role:'status'},item.problem),
                hasSettings && (onSettings
                    ? h('button',{type:'button',class:'ri-btn',style:{minHeight:'44px'},onclick:event=>onSettings(item.operation,event.currentTarget)},'Connection settings')
                    : h('button',{type:'button',class:'ri-btn',onclick:()=>openSettings(item.operation)},'Connection settings')));
        }));
}

export function executionSettings({ operation, receipt, onChange = () => {}, canonical = false } = {}) {
    if (!canonical) return h('button',{type:'button',class:'ri-btn',onclick:()=>openSettings(operation)},'Connection settings');
    const operations = operation ? [[operation,EXECUTION_OPERATIONS[operation]]] : Object.entries(EXECUTION_OPERATIONS);
    const profiles = listProfiles();
    return h('div',{class:'ri-execution-settings'},
        !operation && h('p',{class:'ri-help'},'Choose a connection for each function. Main API follows the host connection. Automatic model work starts off.'),
        ...operations.filter(([,def])=>def).map(([id,def])=>{
            const setting = executionSetting(id);
            const options = [{value:'',label:'Main API'},...profiles.map(profile=>({value:profile.id,label:profile.name}))];
            if (setting.profileId && !profiles.some(profile=>profile.id===setting.profileId)) {
                options.push({value:setting.profileId,label:`Unavailable profile (${setting.profileId})`});
            }
            const disclosure = h('div');
            const refresh = prior => {
                const stage = prior?.operation===id ? prior : executionPreview(id,{trigger:def.automatic});
                const detail=executionDetails(stage,{allowSettings:false});
                disclosure.replaceChildren(...detail.querySelectorAll(':scope > .ri-execution-stage'));
            };
            const onSetting = change => { setExecutionSetting(id,change); refresh(); onChange(id); };
            const connection = !def.mainOnly && field('Connection',setting.migrated ? 'Uses the previous shared connection until you choose a value here.' : '',
                select(options,setting.profileId,value=>onSetting({profileId:value}),{'aria-label':`${def.label} connection`,style:{minHeight:'44px'}}));
            const automatic = def.automatic && field('Automatic requests',`${def.automatic} Budget is one request per trigger.`,
                select([{value:'off',label:'Off'},{value:'on',label:'On'}],setting.automatic ? 'on' : 'off',value=>onSetting({automatic:value==='on'}),
                    {'aria-label':`${def.label} automatic requests`,style:{minHeight:'44px'}}));
            refresh(receipt);
            return h('details',{id:`ri-operation-${id}`,class:'ri-card ri-tight','data-ri-operation':id,open:!!operation},
                h('summary',{style:{minHeight:'44px',alignContent:'center'}},def.label),
                def.mainOnly && h('p',{class:'ri-help'},'The host starts this generation through Main API.'),connection,disclosure,automatic);
        }));
}
