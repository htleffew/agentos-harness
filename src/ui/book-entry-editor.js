import { BOOK_TRIGGER_SOURCES, bookTriggerSource } from '../book-triggers.js';
import { h, field, button, select, textInput, textArea } from './dom.js';
import { ctx, isReply, loadBook, saveBook, confirmBox, toast, worldNames, parseJson } from '../st.js';
import { sharedId, setInfo, blankEntry, freeUid, removeEntries } from '../books.js';
import { chatWorld, readWorldEntry, writeWorldEntry, WORLD_KINDS, isWorldEntry } from '../world.js';
import { recordManualWorldChange, enqueue } from '../worldflow.js';
import { pinBase, prefs, readRecord, reusableAssignments } from '../v10.js';
import { restoreChapterHistory } from '../hide.js';
import { ACTIVATION_MODES, readActivation, recallTiming, RECALL_SOURCES } from '../recall.js';
import { suggestEntryKeywords } from '../book-keywords.js';
import { promptGroup } from './prompts.js';

const terms = value => String(value || '').split(/\r?\n/).map(part=>part.trim()).filter(Boolean);
const input = (label,value,control = textInput) => control(value,()=>{},{'aria-label':label});
const number = (label,value,min,max) => h('input',{type:'number',class:'ri-input ri-input-num',inputMode:'numeric',value,min,max,'aria-label':label});
const toggle = (label,checked) => h('input',{type:'checkbox',checked,'aria-label':label});
const option = (value,label) => ({value,label});
const checkbox = (label,control) => h('label',{class:'ri-row'},control,label);
const problem = error => toast('error',error.message || String(error));
const sourceChoices = sources => Object.entries(sources).map(([value,label])=>option(value,label));

async function updateBook(name, entries, action) {
    const local = prefs();
    await enqueue(async()=>{
        if (local!==prefs()) throw new Error('The chat changed.');
        const data = structuredClone(await loadBook(name));
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
        if (info?.book===name && entries.some(entry=>{
            if (entry.extensions?.ri?.kind!=='chapter' || (info.shared && entry.extensions.ri.set!==info.group)) return false;
            const saved=data.entries[entry.uid];
            return !saved || saved.disable || saved.extensions?.ri?.activation?.mode==='off';
        })) restoreChapterHistory();
    },{propagate:true});
}

const BOOK_MODES = { off:'Disabled', always:'Always eligible', triggered:'Keyword triggered', vector:'Vector matching' };
const bookMode = entry => entry.disable ? 'off' : entry.constant ? 'always' : entry.vectorized ? 'vector' : 'triggered';
const chanceOf = entry => entry.useProbability ? entry.probability ?? 100 : 100;
const titleOf = entry => entry.comment || `Entry ${entry.uid}`;

function applyBookMode(entry, mode) {
    entry.disable = mode === 'off';
    if (entry.disable) return;
    entry.constant = mode === 'always';
    entry.vectorized = mode === 'vector';
}

function entryTiming(entry) {
    if (isWorldEntry(entry)) {
        const rule = readWorldEntry(entry).activation;
        if (entry.disable || rule?.mode === 'off') return 'Disabled';
        if (!rule) return 'Story World recall rules';
        return recallTiming(rule);
    }
    const mode = bookMode(entry);
    const source = mode === 'triggered' ? ` · ${BOOK_TRIGGER_SOURCES[bookTriggerSource(entry)]}` : '';
    return `${BOOK_MODES[mode]}${source} · ${chanceOf(entry)}% chance · Sticky ${entry.sticky || 0} · Cooldown ${entry.cooldown || 0} messages`;
}

function keywordHelp(keys, source, whenApplied = () => {}) {
    const status=h('p',{class:'ri-help',role:'status'});
    const suggestions=h('div');
    const generate=button('Suggest trigger phrases with AI',async()=>{
        generate.disabled=true;
        suggestions.replaceChildren();
        status.textContent='Reading this entry…';
        try {
            const phrases=await suggestEntryKeywords(source());
            if (!phrases.length) { status.textContent='No suitable phrases were returned.'; return; }
            const checks=phrases.map(phrase=>({phrase,control:toggle(phrase,true)}));
            status.textContent='Review the suggestions before adding them to the draft.';
            suggestions.append(...checks.map(({phrase,control})=>checkbox(phrase,control)),
                button('Add checked phrases to draft',()=>{
                    const selected=checks.filter(({control})=>control.checked).map(({phrase})=>phrase);
                    if (!selected.length) return;
                    keys.value=[...new Set([...terms(keys.value),...selected])].join('\n');
                    whenApplied();
                    keys.dispatchEvent(new Event('input',{bubbles:true}));
                    suggestions.replaceChildren();
                    status.textContent='Added to the draft. Save the entry to apply the changes.';
                },{kind:'ghost'}));
        } catch(error) { status.textContent=error.message; }
        finally { generate.disabled=false; }
    },{kind:'ghost'});
    return h('details',{},h('summary',{},'Help choosing triggers'),
        h('p',{class:'ri-help'},'One optional model request reads the entry’s title and text. Review and edit its suggestions before saving.'),
        generate,status,suggestions,promptGroup(['bookKeywords','systemBookKeywords'],'Customize keyword suggestion prompts'));
}

function editEntry(name, entry, target, refresh, reusable, adding = false, cancel = () => target.replaceChildren()) {
    const panel = h('div',{class:'ri-card ri-state-editor'});
    const dirty = () => { panel.dataset.riDirty=''; };
    panel.addEventListener('input',dirty);
    panel.addEventListener('change',dirty);
    const row = isWorldEntry(entry) ? readWorldEntry(entry) : null;
    const title = input('Entry title',entry.comment || '');
    const enabled = toggle('Enabled',!entry.disable);
    const controls = [];
    panel.append(field('Entry title','',title));
    if (row) panel.append(checkbox('Enabled',enabled));
    let apply;
    if (row) {
        const aliases = input('Aliases',row.aliases.join('\n'),textArea);
        const keep = toggle('Protect from automated updates',row.locked);
        const existing = row.activation;
        const labels = {default:'Use the entry type’s normal rules',always:'Always eligible',triggered:'When a trigger matches',window:'For an initial window, then on triggers',off:'Never recall'};
        const mode = select(ACTIVATION_MODES.map(key=>option(key,labels[key])),existing?.mode || 'default',()=>{}, {'aria-label':'Activation'});
        const keys = input('Trigger phrases',(existing?.keys || row.aliases).join('\n'),textArea);
        const sticky = number('Keep active for replies',existing?.sticky || 0,0,100);
        const cooldown = number('Cooldown (replies)',existing?.cooldown || 0,0,1000);
        const triggerSource = select(sourceChoices(RECALL_SOURCES),existing?.source || 'chat',()=>{},{'aria-label':'Keyword source'});
        const chance = number('Chance (%)',existing?.chance ?? 100,0,100);
        const window = number('Initial window (replies)',existing?.window ?? 6,0,200);
        const structured = parseJson(row.fields.data,{object:true});
        const inputs = WORLD_KINDS[row.kind].fields.filter(item=>item.key!=='data' || !structured)
            .map(item=>[item.key,input(item.label,row.fields[item.key],item.long ? textArea : textInput),item.label]);
        const recordText = structured && input('Record text',structured.text,textArea);
        const recordData = structured && input('Structured fields',JSON.stringify({...structured,text:undefined},null,2),textArea);
        const states = WORLD_KINDS[row.kind].steps;
        const status = states ? select(states.map(([value,label])=>option(value,label)),row.status,()=>{},{'aria-label':'Story status'}) : null;
        panel.append(recordText && field('Record text','',recordText),
            field('Aliases','One per line.',aliases),checkbox('Protect from automated updates',keep),
            field('Activation','Uses the extension’s recall budget and applicable knowledge and plot rules.',mode),
            field('Trigger phrases','One word, phrase or /pattern/i per line.',keys),
            field('Keyword source','Choose which conversation text the triggers scan.',triggerSource),
            keywordHelp(keys,()=>({title:title.value,text:recordText?.value || inputs.map(([,control])=>control.value).filter(Boolean).join('\n')}),
                ()=>{if (mode.value==='default') mode.value='triggered';}),
            field('Keep active for replies','Number of later replies after a fresh match.',sticky),
            field('Cooldown (replies)','Wait this many replies after the active replies before the entry can start again.',cooldown),
            field('Chance (%)','Applied once to each eligible turn.',chance),
            field('Initial window (replies)','Applies to the window mode. Editing an existing rule keeps its original starting reply.',window),
            status && field('Story status','',status),
            ...inputs.map(([,control,label])=>field(label,'',control)),
            recordData && h('details',{},h('summary',{},'Advanced record fields'),
                field('Structured fields','Preserve the record’s ID and kind. Use Record text above to edit the narrative content.',recordData)));
        apply = data => {
            row.name=title.value;
            row.on=enabled.checked;
            row.aliases=terms(aliases.value);
            row.locked=keep.checked;
            if (status) row.status=status.value;
            for (const [key,control] of inputs) row.fields[key]=control.value;
            if (recordData) {
                const parsed = JSON.parse(recordData.value);
                if (!parsed || Array.isArray(parsed) || parsed.id!==structured.id || parsed.kind!==structured.kind || !recordText.value.trim()) {
                    throw new Error('Preserve the structured record ID and kind, and enter record text.');
                }
                row.fields.data=JSON.stringify({...parsed,text:recordText.value.trim()});
            }
            row.activation=readActivation({mode:mode.value,keys:terms(keys.value),sticky:Number(sticky.value),
                source:triggerSource.value,cooldown:Number(cooldown.value),chance:Number(chance.value),window:Number(window.value),
                after:existing?.mode==='window' ? existing.after : (ctx().chat || []).slice(1).filter(isReply).length});
            if (row.activation?.mode==='triggered' && !row.activation.keys.length) throw new Error('Enter at least one trigger phrase.');
            const group=entry.extensions?.ri?.set;
            writeWorldEntry(data,row,group ? sharedId(name,group) : name);
        };
        controls.push(chance,sticky,cooldown,window,...inputs.map(([,control])=>control));
    } else {
        const originalMode = bookMode(entry);
        const choices = Object.entries(BOOK_MODES).filter(([key]) => key !== 'vector' || reusable || entry.vectorized);
        const activation = select(choices.map(([value,label]) => option(value,label)), originalMode, () => {}, {'aria-label':'Activation'});
        const sourceOptions = Object.entries(BOOK_TRIGGER_SOURCES).filter(([key]) => key === 'chat' || ctx().registerMacro);
        const triggerSource = select(sourceOptions.map(([key,label]) => option(key,label)), bookTriggerSource(entry), () => {}, {'aria-label':'Keyword source'});
        const keys = input('Primary triggers',(entry.key || []).join('\n'),textArea);
        const secondary = input('Secondary triggers',(entry.keysecondary || []).join('\n'),textArea);
        const logic = select(['Any secondary','At least one absent','None present','All present'].map((name,i)=>option(String(i),name)),
            String(entry.selectiveLogic || 0),()=>{},{'aria-label':'Secondary trigger rule'});
        const chance = number('Chance (%)',chanceOf(entry),0,100);
        const sticky = number('Native sticky messages',entry.sticky || 0,0,1000);
        const cooldown = number('Cooldown (host messages)',entry.cooldown || 0,0,1000);
        const content = input('Entry content',entry.content || '',textArea);
        const extensionData = input('Extension data',JSON.stringify(entry.extensions || {},null,2),textArea);
        panel.append(field('Entry content','',content),
            field('Activation','Always eligible uses chance and timing alone. Keyword triggered requires a match. Vector matching uses the host’s World Info vector search when enabled.',activation),
            field('Keyword source', ctx().registerMacro
                ? 'Keyword-triggered entries can match the latest visible message of one role.'
                : 'This host supports the recent-chat scan. Role-specific matching requires host macro support.',triggerSource),
            field('Primary triggers','One word, phrase, or /pattern/i per line.',keys),
            keywordHelp(keys,()=>({title:title.value,text:content.value})),
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
            if (ctx().registerMacro) {
                if (triggerSource.value === 'chat') delete extensions.riTriggerSource;
                else extensions.riTriggerSource = triggerSource.value;
            }
            if (adding || activation.value !== originalMode) applyBookMode(next, activation.value);
            const secondaryKeys = terms(secondary.value);
            const selective = secondary.value === (entry.keysecondary || []).join('\n') ? next.selective : secondaryKeys.length > 0;
            Object.assign(next,{comment:title.value.trim(),
                key:terms(keys.value),keysecondary:secondaryKeys,selective,selectiveLogic:Number(logic.value),
                sticky:Number(sticky.value) || null,cooldown:Number(cooldown.value) || null,content:content.value,extensions});
            if (adding || Number(chance.value)!==Number(chanceOf(entry))) {
                next.probability=Number(chance.value);
                next.useProbability=next.probability!==100;
            }
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
    panel.append(h('div',{class:'ri-row'},save,button('Cancel',cancel,{kind:'ghost'})));
    target.replaceChildren(panel);
    title.focus();
}

export function receiptEntryEditor(receipt, back, entryOptions) {
    const info = setInfo(receipt.book);
    const name = receipt.sourceBook || info.book;
    const group = receipt.sourceGroup ?? info.group;
    const controls = h('div',{class:'ri-row'});
    const status = h('p',{class:'ri-help',role:'status'},'Loading entry…');
    const target = h('div');
    const scope = h('div');
    const root = h('div',{},controls,h('h3',{},receipt.title),h('p',{class:'ri-help'},name),
        h('p',{class:'ri-help'},'This reply recorded the selection shown below. Saved edits change how the entry works in future replies wherever the book is used.'),
        h('p',{class:'ri-help'},[receipt.confirmed ? 'Confirmed in prompt' : 'Delivery unconfirmed',receipt.delivery,receipt.timing].filter(Boolean).join(' · ')),
        status,target,scope);
    controls.append(button(receipt.fromReview ? 'Back to What Was Sent' : 'Back to World Info books',back,{kind:'ghost'}));
    const saved = () => {
        target.replaceChildren();
        status.textContent = 'Entry saved.';
        controls.append(button('Edit entry again',load,{kind:'ghost'}));
        controls.lastElementChild.focus();
    };
    async function load() {
        controls.querySelector('button:nth-child(2)')?.remove();
        status.textContent = 'Loading entry…';
        try {
            const data = worldNames().includes(name) && await loadBook(name);
            if (!root.isConnected) return;
            const entries = Object.values(data?.entries || {}).filter(entry=>!group || entry.extensions?.ri?.set===group);
            const structured = ['Chat Facts','Plot Records'].includes(receipt.role);
            const matches = entries.filter(entry=>receipt.uid == null
                ? (entry.comment || entry.key?.[0] || titleOf(entry))===receipt.title
                : structured ? isWorldEntry(entry) && readRecord(readWorldEntry(entry))?.id===receipt.uid
                    : String(entry.uid)===String(receipt.uid));
            if (matches.length !== 1) {
                status.textContent = matches.length ? 'Several entries match this older receipt. Open the book list to choose an entry.'
                    : 'This entry is no longer available in the recorded book.';
                return;
            }
            status.textContent = '';
            const reusable = prefs()?.base?.name===name || reusableAssignments().some(book=>book.name===name);
            const options = entryOptions?.(name,matches[0]);
            scope.replaceChildren(...(options ? [options] : []));
            editEntry(name,structuredClone(matches[0]),target,saved,reusable,false,back);
        } catch(error) {
            if (root.isConnected) status.textContent = error.message;
        }
    }
    queueMicrotask(()=>{if (root.isConnected) load();});
    return root;
}

export function bookEntryEditor(name, { reusable = false, entryOptions = null } = {}) {
    const content = h('div');
    const editor = h('div');
    const count = h('span',{class:'ri-help'});
    const root = h('details',{class:'ri-book-entry-editor'},h('summary',{},h('strong',{},'Edit or delete entries'),count),
        h('p',{class:'ri-help'},'This edits the World Info book. Changes apply in every chat that uses it.'),
        h('div',{class:'ri-row'},
            reusable && button('Add entry', () => editEntry(name, { ...blankEntry(0), constant:false, probability:100, content:'' }, editor, refresh, true, true)),
            button('Reload entries', refresh, {kind:'ghost'})),
        editor,content);
    async function removeEntriesFromBook(selected, control) {
        if (!selected.length || control.disabled) return;
        const selection = selected.length === 1 ? `“${titleOf(selected[0])}”` : `${selected.length} selected entries`;
        control.disabled = true;
        try {
            if (!await confirmBox(`Delete ${selection} from “${name}”? This removes the entries for every chat using the book.`)) return;
            await updateBook(name, selected, data => removeEntries(data, selected));
            await refresh();
        } catch(error) { problem(error); }
        finally { control.disabled = false; }
    }
    async function refresh() {
        editor.replaceChildren();
        content.replaceChildren(h('p',{class:'ri-help'},'Loading entries…'));
        try {
            const data = await loadBook(name);
            if (!data?.entries) throw new Error('This World Info book could not be read.');
            const entries = Object.values(structuredClone(data.entries));
            count.textContent = ` · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`;
            const checked = new Set();
            const remove = button('Delete selected entries', () => removeEntriesFromBook(entries.filter(entry=>checked.has(entry.uid)), remove), {disabled:true});
            const batchMode = select([option('','Keep current activation'),option('always','Always eligible'),option('triggered','When a trigger matches'),option('off','Off')],'',()=>{},
                {'aria-label':'Selected entries activation'});
            const batchKeys = input('Selected entries triggers','',textArea);
            const clearKeys = toggle('Clear triggers for selected entries',false);
            const batchChance = number('Selected entries chance (%)','',0,100);
            const batchSticky = number('Selected entries sticky','',0,100);
            const batchCooldown = entries.some(entry=>!isWorldEntry(entry))
                ? number('Selected entries cooldown','',0,1000) : null;
            const managedCooldown = entries.some(isWorldEntry) ? number('Selected entries cooldown (replies)','',0,1000) : null;
            const batchSource = managedCooldown || ctx().registerMacro ? select([
                option('', 'Keep current source'), ...sourceChoices(RECALL_SOURCES),
            ], '', () => {}, {'aria-label':'Selected entries keyword source'}) : null;
            const batch = button('Apply recall settings to selected',async()=>{
                const selected = entries.filter(entry=>checked.has(entry.uid));
                if (!selected.length || [batchChance,batchSticky,batchCooldown,managedCooldown].some(input=>input && !input.checkValidity())) return;
                const mode = batchMode.value;
                const setKeys = clearKeys.checked || !!batchKeys.value.trim();
                const keys = clearKeys.checked ? [] : terms(batchKeys.value);
                const chance = batchChance.value === '' ? undefined : Number(batchChance.value);
                const sticky = batchSticky.value === '' ? undefined : Number(batchSticky.value);
                const cooldown = batchCooldown?.value ? Number(batchCooldown.value) : undefined;
                const managedWait = managedCooldown?.value ? Number(managedCooldown.value) : undefined;
                const source = batchSource?.value;
                if (!(mode || setKeys || chance!==undefined || sticky!==undefined || cooldown!==undefined || managedWait!==undefined || source)) {
                    problem(new Error('Enter a recall setting to change.')); return;
                }
                const currentKeys = entry => isWorldEntry(entry)
                    ? readWorldEntry(entry).activation?.keys || readWorldEntry(entry).aliases : entry.key || [];
                if (selected.some(entry=>(mode==='triggered' || !mode && isWorldEntry(entry) && readWorldEntry(entry).activation?.mode==='triggered') &&
                    !(setKeys ? keys : currentKeys(entry)).length)) {
                    problem(new Error('Each keyword-triggered entry needs at least one trigger phrase.')); return;
                }
                if (source && source!=='chat' && !ctx().registerMacro && selected.some(entry=>!isWorldEntry(entry))) {
                    problem(new Error('This host cannot scan a single role for native entries.')); return;
                }
                if (!mode && (setKeys || chance!==undefined || sticky!==undefined || managedWait!==undefined || source) &&
                    selected.some(entry=>isWorldEntry(entry) && !readWorldEntry(entry).activation)) {
                    problem(new Error('Choose an activation for entries using Story World defaults.')); return;
                }
                batch.disabled=true;
                try {
                    await updateBook(name,selected,book=>{
                        for (const entry of selected) {
                            const stored = book.entries[entry.uid];
                            if (isWorldEntry(stored)) {
                                if (!(mode || setKeys || chance!==undefined || sticky!==undefined || managedWait!==undefined || source)) continue;
                                const rule = readWorldEntry(stored).activation;
                                stored.extensions.ri.activation=readActivation({...rule,mode:mode || rule?.mode,
                                    keys:setKeys ? keys : currentKeys(entry),chance:chance ?? rule?.chance,sticky:sticky ?? rule?.sticky,
                                    source:source || rule?.source,cooldown:managedWait ?? rule?.cooldown});
                            } else {
                                if (mode) applyBookMode(stored,mode);
                                if (setKeys) stored.key=keys;
                                if (chance!==undefined) Object.assign(stored,{probability:chance,useProbability:chance!==100});
                                if (sticky!==undefined) stored.sticky=sticky || null;
                                if (cooldown!==undefined) stored.cooldown=cooldown || null;
                                if (source) {
                                    stored.extensions ||= {};
                                    if (source === 'chat') delete stored.extensions.riTriggerSource;
                                    else stored.extensions.riTriggerSource=source;
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
                    h('p',{class:'ri-help'},'Only the settings you fill in are changed. Check each entry’s row for its saved activation and chance.'),
                    field('Activation','',batchMode),field('Triggers','One phrase per line. Leave blank to keep current triggers.',batchKeys),
                    checkbox('Clear triggers for selected entries',clearKeys),
                    batchSource && field('Keyword source', '', batchSource),
                    field('Chance (%)','Leave blank to keep each entry’s current chance.',batchChance),field('Sticky','Replies for Story World entries. Host messages for native entries. Leave blank to keep the current value.',batchSticky),
                    batchCooldown && field('Cooldown (host messages)','Applies to native entries. Leave blank to keep the current cooldown.',batchCooldown),
                    managedCooldown && field('Cooldown (replies)','Applies to Story World entries. Leave blank to keep the current cooldown.',managedCooldown),
                    batch),
                h('ul',{class:'ri-chat-books'},entries.map((entry,index)=>{
                    checks[index].addEventListener('change',()=>set(entry,index,checks[index].checked));
                    const localEditor = h('div');
                    const deleteEntry = button('Delete', () => removeEntriesFromBook([entry], deleteEntry), {kind:'danger'});
                    const world = isWorldEntry(entry) ? readWorldEntry(entry) : null;
                    const keys = world ? world.activation?.keys || world.aliases : [...(entry.key || []), ...(entry.keysecondary || [])];
                    const text = world ? Object.entries(world.fields).filter(([,value])=>value).map(([key,value]) => {
                        if (key==='data') return readRecord(world)?.text || value;
                        const label = WORLD_KINDS[world.kind].fields.find(field=>field.key===key)?.label || key;
                        return `${label}\n${value}`;
                    }).join('\n\n') : entry.content;
                    return h('li',{class:'ri-book-entry'},
                        checkbox(titleOf(entry),checks[index]),
                        h('p',{class:'ri-help'},entryTiming(entry)),
                        keys.length ? h('p',{class:'ri-help'},`Keywords: ${keys.join(' · ')}`) : null,
                        h('details',{class:'ri-book-text'},h('summary',{},'View full entry'),
                            h('pre',{},text || 'This entry has no content.')),
                        h('div',{class:'ri-row'},
                            button('Edit',()=>editEntry(name,entry,localEditor,refresh,reusable),{kind:'ghost'}),deleteEntry),
                        entryOptions?.(entry),localEditor);
                }))) : h('p',{class:'ri-help'},'This book has no entries.'));
        } catch(error) { count.textContent = ''; content.replaceChildren(h('p',{role:'status'},error.message)); }
    }
    root.addEventListener('toggle',()=>{if (root.open && !content.childElementCount) refresh();});
    return root;
}
