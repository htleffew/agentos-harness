import { BOOK_TRIGGER_SOURCES, bookTriggerSource } from '../book-triggers.js';
import { h, field, button, select, textInput, textArea } from './dom.js';
import { ctx, isReply, loadBook, saveBook, confirmBox, toast } from '../st.js';
import { sharedId, setInfo, blankEntry, freeUid } from '../books.js';
import { chatWorld, readWorldEntry, writeWorldEntry, WORLD_KINDS, isWorldEntry } from '../world.js';
import { recordManualWorldChange, enqueue } from '../worldflow.js';
import { pinBase, prefs } from '../v10.js';
import { restoreChapterHistory } from '../hide.js';
import { ACTIVATION_MODES, readActivation } from '../recall.js';

const terms = value => String(value || '').split(/\r?\n/).map(part=>part.trim()).filter(Boolean);
const input = (label,value,control = textInput) => control(value,()=>{},{'aria-label':label});
const number = (label,value,min,max) => h('input',{type:'number',value,min,max,'aria-label':label});
const toggle = (label,checked) => h('input',{type:'checkbox',checked,'aria-label':label});
const option = (value,label) => ({value,label});
const checkbox = (label,control) => h('label',{class:'ri-row'},control,label);
const problem = error => toast('error',error.message || String(error));

async function updateBook(name, entries, action) {
    const local = prefs();
    await enqueue(async()=>{
        if (local!==prefs()) throw new Error('The chat changed.');
        const data = await loadBook(name);
        if (!data?.entries) throw new Error('This World Info book could not be loaded.');
        for (const shown of entries) {
            if (JSON.stringify(data.entries[shown.uid])!==JSON.stringify(shown)) throw new Error('An entry changed since you opened it. Reload the book and try again.');
        }
        if (local!==prefs()) throw new Error('The chat changed.');
        action(data);
        await saveBook(name,data);
        if (local!==prefs()) return;
        const world = chatWorld();
        const info = world ? setInfo(world) : null;
        for (const entry of entries) if (info?.book===name && isWorldEntry(entry) &&
            (!info.shared || entry.extensions?.ri?.set===info.group)) recordManualWorldChange(world,entry.uid,entry,data.entries[entry.uid] || null);
        if (local?.base?.name===name) await pinBase(name);
        if (entries.some(entry=>entry.extensions?.ri?.kind==='chapter' && !data.entries[entry.uid])) restoreChapterHistory();
    },{propagate:true});
}

function editEntry(name, entry, target, refresh, reusable, adding = false) {
    const panel = h('div',{class:'ri-card ri-state-editor'});
    const row = isWorldEntry(entry) ? readWorldEntry(entry) : null;
    const title = input('Entry title',entry.comment || '');
    const enabled = toggle('Enabled',!entry.disable);
    const controls = [];
    panel.append(field('Entry title','',title),checkbox('Enabled',enabled));
    let apply;
    if (row) {
        const aliases = input('Aliases',row.aliases.join('\n'),textArea);
        const keep = toggle('Protect from automated updates',row.locked);
        const existing = row.activation;
        const labels = {default:'Use the entry type’s normal rules',always:'Always eligible',triggered:'When a trigger matches',window:'For an initial window, then on triggers',off:'Never recall'};
        const mode = select(ACTIVATION_MODES.map(key=>option(key,labels[key])),existing?.mode || 'default',()=>{}, {'aria-label':'Activation'});
        const keys = input('Trigger phrases',(existing?.keys || row.aliases).join('\n'),textArea);
        const sticky = number('Keep active for replies',existing?.sticky || 0,0,100);
        const chance = number('Chance (%)',existing?.chance ?? 100,0,100);
        const window = number('Initial window (replies)',existing?.window ?? 6,0,200);
        const inputs = WORLD_KINDS[row.kind].fields.map(item=>[item.key,input(item.label,row.fields[item.key],item.long ? textArea : textInput),item.label]);
        const states = WORLD_KINDS[row.kind].steps;
        const status = states ? select(states.map(([value,label])=>option(value,label)),row.status,()=>{},{'aria-label':'Story status'}) : null;
        panel.append(field('Aliases','One per line.',aliases),checkbox('Protect from automated updates',keep),
            field('Activation','Uses the extension’s recall budget and applicable knowledge and plot rules.',mode),
            field('Trigger phrases','One phrase per line. Matches recent visible conversation.',keys),
            field('Keep active for replies','Number of later replies after a fresh match.',sticky),
            field('Chance (%)','Applied once to each eligible turn.',chance),
            field('Initial window (replies)','Applies to the window mode. Editing an existing rule keeps its original starting reply.',window),
            status && field('Story status','',status),
            ...inputs.map(([,control,label])=>field(label,'',control)));
        apply = data => {
            row.name=title.value;
            row.on=enabled.checked;
            row.aliases=terms(aliases.value);
            row.locked=keep.checked;
            if (status) row.status=status.value;
            for (const [key,control] of inputs) row.fields[key]=control.value;
            if (WORLD_KINDS[row.kind].fields.some(item=>item.key==='data')) {
                const parsed = JSON.parse(row.fields.data);
                const original = JSON.parse(entry.extensions.ri.fields.data);
                if (!parsed || Array.isArray(parsed) || parsed.id!==original.id || parsed.kind!==original.kind || typeof parsed.text!=='string') {
                    throw new Error('Preserve the structured record ID and kind, and provide its text.');
                }
            }
            row.activation=readActivation({mode:mode.value,keys:terms(keys.value),sticky:Number(sticky.value),
                chance:Number(chance.value),window:Number(window.value),after:existing?.mode==='window' ? existing.after : (ctx().chat || []).slice(1).filter(isReply).length});
            const group=entry.extensions?.ri?.set;
            writeWorldEntry(data,row,group ? sharedId(name,group) : name);
        };
        controls.push(chance,sticky,window,...inputs.map(([,control])=>control));
    } else {
        const constant = toggle('Always active',entry.constant);
        const sourceOptions = Object.entries(BOOK_TRIGGER_SOURCES).filter(([key]) => key === 'chat' || ctx().registerMacro);
        const triggerSource = select(sourceOptions.map(([key,label]) => option(key,label)), bookTriggerSource(entry), () => {}, {'aria-label':'Keyword source'});
        const keys = input('Primary triggers',(entry.key || []).join('\n'),textArea);
        const secondary = input('Secondary triggers',(entry.keysecondary || []).join('\n'),textArea);
        const logic = select(['Any secondary','At least one absent','None present','All present'].map((name,i)=>option(String(i),name)),
            String(entry.selectiveLogic || 0),()=>{},{'aria-label':'Secondary trigger rule'});
        const chance = number('Chance (%)',entry.useProbability===false ? 100 : entry.probability ?? 100,0,100);
        const sticky = number('Native sticky messages',entry.sticky || 0,0,1000);
        const cooldown = number('Cooldown (host messages)',entry.cooldown || 0,0,1000);
        const content = input('Entry content',entry.content || '',textArea);
        const extensionData = input('Extension data',JSON.stringify(entry.extensions || {},null,2),textArea);
        panel.append(field('Entry content','',content),checkbox('Always active',constant),
            reusable && field('Keyword source', ctx().registerMacro
                ? 'Applies when Always active is off. Scoped sources check the latest visible message of that role.'
                : 'This host supports the recent-chat scan. Role-specific matching requires host macro support.',triggerSource),
            field('Primary triggers','One word, phrase, or /pattern/i per line. Always-active entries ignore these keys.',keys),
            field('Secondary triggers','One per line.',secondary),field('Secondary trigger rule','',logic),
            field('Chance (%)','The host rolls for activation.',chance),
            field('Sticky (host messages)','Uses the host’s message-based timing.',sticky),
            field('Cooldown (host messages)','Wait before it can activate again.',cooldown),
            h('details',{},h('summary',{},'Advanced extension data'),field('Extension data','JSON metadata used by the existing set or other extensions.',extensionData)));
        apply = data => {
            const uid = adding ? freeUid(data) : entry.uid;
            const next = adding ? (data.entries[uid] = { ...blankEntry(uid), ignoreBudget:false }) : data.entries[uid];
            const extensions = JSON.parse(extensionData.value);
            if (!extensions || Array.isArray(extensions) || typeof extensions!=='object') throw new Error('Extension data must be a JSON object.');
            if (reusable && ctx().registerMacro) {
                if (triggerSource.value === 'chat') delete extensions.riTriggerSource;
                else extensions.riTriggerSource = triggerSource.value;
            }
            Object.assign(next,{comment:title.value.trim(),disable:!enabled.checked,constant:constant.checked,
                key:terms(keys.value),keysecondary:terms(secondary.value),selective:terms(secondary.value).length>0,selectiveLogic:Number(logic.value),
                probability:Number(chance.value),useProbability:Number(chance.value)!==100,sticky:Number(sticky.value) || null,cooldown:Number(cooldown.value) || null,content:content.value,extensions});
        };
        controls.push(chance,sticky,cooldown);
    }
    const save = button('Save entry',async()=>{
        if (controls.some(control=>!control.checkValidity())) return;
        if (adding && (!title.value.trim() || !panel.querySelector('[aria-label="Entry content"]')?.value.trim())) {
            problem(new Error('Enter a title and entry content.'));
            return;
        }
        save.disabled=true;
        try {await updateBook(name,adding ? [] : [entry],apply);await refresh();}
        catch(error) {problem(error);save.disabled=false;}
    },{kind:'primary'});
    panel.append(h('div',{class:'ri-row'},save,button('Cancel',()=>target.replaceChildren(),{kind:'ghost'})));
    target.replaceChildren(panel);
    title.focus();
}

export function bookEntryEditor(name, { reusable = false } = {}) {
    const content = h('div');
    const editor = h('div');
    const root = h('details',{class:'ri-book-entry-editor'},h('summary',{},'Edit or delete entries'),
        reusable && button('Add entry', () => editEntry(name, { ...blankEntry(0), constant:false, probability:100, content:'' }, editor, refresh, true, true)),
        content,editor);
    async function refresh() {
        editor.replaceChildren();
        content.replaceChildren(h('p',{class:'ri-help'},'Loading entries…'));
        try {
            const data = await loadBook(name);
            if (!data?.entries) throw new Error('This World Info book could not be read.');
            const entries = Object.values(data.entries);
            const checked = new Set();
            const remove = button('Delete selected entries',async()=>{
                const selected = entries.filter(entry=>checked.has(entry.uid));
                if (!selected.length || !await confirmBox(`Delete ${selected.length} selected entries from “${name}”? This removes them from the physical book for every chat that uses it.`)) return;
                remove.disabled=true;
                try {
                    await updateBook(name,selected,book=>{for (const entry of selected) delete book.entries[entry.uid];});
                    await refresh();
                } catch(error) {problem(error);remove.disabled=false;}
            },{disabled:true});
            const batchMode = select([option('always','Always eligible'),option('triggered','When a trigger matches'),option('off','Off')],'triggered',()=>{},
                {'aria-label':'Selected entries activation'});
            const batchKeys = input('Selected entries triggers','',textArea);
            const batchChance = number('Selected entries chance (%)',100,0,100);
            const batchSticky = number('Selected entries sticky',0,0,100);
            const batchSource = reusable && ctx().registerMacro ? select([
                option('', 'Keep current source'), ...Object.entries(BOOK_TRIGGER_SOURCES).map(([value,label]) => option(value,label)),
            ], '', () => {}, {'aria-label':'Selected entries keyword source'}) : null;
            const batch = button('Apply recall settings to selected',async()=>{
                const selected = entries.filter(entry=>checked.has(entry.uid));
                if (!selected.length || !batchChance.checkValidity() || !batchSticky.checkValidity()) return;
                const mode = batchMode.value, keys = terms(batchKeys.value);
                if (mode==='triggered' && !keys.length) {problem(new Error('Enter at least one trigger phrase.'));return;}
                batch.disabled=true;
                try {
                    await updateBook(name,selected,book=>{
                        for (const entry of selected) {
                            const stored = book.entries[entry.uid];
                            const chance = Number(batchChance.value), sticky = Number(batchSticky.value);
                            if (isWorldEntry(stored)) {
                                stored.extensions.ri.activation=readActivation({mode,keys,chance,sticky});
                            } else if (mode==='off') stored.disable=true;
                            else {
                                Object.assign(stored,{disable:false,constant:mode==='always',key:keys,
                                    useProbability:chance!==100,probability:chance,sticky:sticky || null});
                                if (batchSource?.value) {
                                    stored.extensions ||= {};
                                    if (batchSource.value === 'chat') delete stored.extensions.riTriggerSource;
                                    else stored.extensions.riTriggerSource = batchSource.value;
                                }
                            }
                        }
                    });
                    await refresh();
                } catch (error) {problem(error);batch.disabled=false;}
            },{disabled:true});
            const checks = entries.map(entry=>toggle(`Select ${entry.comment || entry.uid}`,false));
            const all = toggle('Select all entries',false);
            const set = (entry,index,value) => {
                checks[index].checked=value;
                if (value) checked.add(entry.uid); else checked.delete(entry.uid);
                remove.disabled=batch.disabled=!checked.size;
                all.checked=checked.size===entries.length;
                all.indeterminate=checked.size>0 && checked.size<entries.length;
            };
            all.addEventListener('change',()=>{const value=all.checked;entries.forEach((entry,index)=>set(entry,index,value));});
            content.replaceChildren(entries.length ? h('div',{},
                h('div',{class:'ri-row'},checkbox('Select all entries',all),remove),
                h('details',{},h('summary',{},'Change recall settings for selected entries'),
                    field('Activation','',batchMode),field('Triggers','One phrase per line.',batchKeys),
                    batchSource && field('Keyword source', '', batchSource),
                    field('Chance (%)','',batchChance),field('Sticky','Replies for Story World entries. Host messages for native entries.',batchSticky),batch),
                h('ul',{class:'ri-chat-books'},entries.map((entry,index)=>{
                    checks[index].addEventListener('change',()=>set(entry,index,checks[index].checked));
                    return h('li',{class:'ri-row'},checkbox(entry.comment || `Entry ${entry.uid}`,checks[index]),
                        reusable && !isWorldEntry(entry) ? h('span',{class:'ri-help'},entry.disable ? 'Off' : `${entry.constant ? 'Always eligible' : BOOK_TRIGGER_SOURCES[bookTriggerSource(entry)]} · ${entry.useProbability === false ? 100 : entry.probability ?? 100}% chance`) : null,
                        button('Edit',()=>editEntry(name,entry,editor,refresh,reusable),{kind:'ghost'}));
                }))) : h('p',{class:'ri-help'},'This book has no entries.'));
        } catch(error) {content.replaceChildren(h('p',{role:'status'},error.message));}
    }
    root.addEventListener('toggle',()=>{if (root.open && !content.childElementCount) refresh();});
    return root;
}
