import { h, button, section, textArea, textInput } from './dom.js';
import { slot } from './homes.js';
import { ctx, KEY, isChatOpen, replyLabels, toast } from '../st.js';
import { chatState } from '../store.js';
import { correctionSwipeTarget, regenerateStoryCorrection } from '../engine.js';
import { applyStoryCorrection, beginStoryCorrection, correctionExcerpt, findCorrectionSources, runFactRepair, suggestCorrectionEdits, undoStoryCorrection } from '../corrections.js';
import { replaceUnique } from '../correction-rules.js';
import { executionPreview, executionReceipt, executionScope } from '../execution.js';
import { executionDetails, executionSettings } from './execution.js';
import { guidedTarget } from '../guided-context.js';
import { separateReply } from '../reply-format.js';

function openMessage(index) {
    const host = ctx();
    if (typeof host.executeSlashCommandsWithOptions==='function') return host.executeSlashCommandsWithOptions('/chat-jump '+index);
    document.querySelector('#chat .mes[mesid="'+index+'"]')?.scrollIntoView({block:'center'});
}

async function undoRepair(id) {
    await undoStoryCorrection(id);
    (await import('./sent.js')).refreshUnderReplies();
}

function sourceRow(source, proposal, review, target, onChange) {
    const editTarget = source.kind==='message' && source.index===target?.index;
    const selected = h('input',{type:'checkbox',checked:!!proposal && !source.user && !editTarget,
        'aria-label':'Apply edit to '+source.label});
    const exact = review.wording;
    const terms = [exact.toLowerCase(),...source.matches].filter(Boolean);
    const preview = correctionExcerpt(source,terms,260);
    const found = exact ? source.before.toLowerCase().indexOf(exact.toLowerCase()) : -1;
    const original = proposal?.quote ?? (found>=0 ? source.before.slice(found,found+exact.length) : preview);
    const quote = textArea(original,()=>{},{rows:2,'aria-label':'Exact source quotation'});
    const replacement = textArea(proposal?.replacement ?? '',()=>{},{rows:2,'aria-label':'Source replacement'});
    const remove = h('input',{type:'checkbox',checked:proposal?.replacement==='', 'aria-label':'Remove the quoted wording'});
    const location = [
        source.span && 'Chapter covers replies '+source.span.from+'–'+source.span.to,
        source.kind==='world' && source.evidenceAt>=0 && (source.pending ? 'Editable · from chat message ' : 'Filed from chat message ')+(source.evidenceAt+1),
        ['lore','card'].includes(source.kind) && 'Uses a corrected copy in this chat.',
        source.user && 'Changes your original message if applied.',
        editTarget && 'Changes the selected original swipe if applied. Leave unchecked to preserve that swipe.',
        source.active===false && 'This entry is disabled.',
    ].filter(Boolean).join(' · ');
    const check = () => {
        if (!selected.checked) return '';
        if (remove.checked===false && !replacement.value.trim()) return 'Enter a replacement or choose Remove the quoted wording.';
        const after = replaceUnique(source.before,quote.value,remove.checked ? '' : replacement.value);
        if (after===null || after===source.before || source.kind==='message' && !after.trim()) {
            return 'Use a quotation that occurs once and enter a different replacement.';
        }
        return '';
    };
    const validation = h('p',{class:'ri-help',role:'status'});
    for (const control of [quote,replacement,selected,remove]) control.addEventListener('input',()=>{
        replacement.disabled=remove.checked;
        validation.textContent=check(); onChange();
    });
    replacement.disabled=remove.checked;
    const edit = h('details',{class:'ri-correction-edit'},h('summary',{},proposal ? 'Review proposed edit' : 'Edit this source'),
        h('label',{class:'ri-field'},'Exact wording to replace',quote),
        h('label',{class:'ri-field'},'Replacement text',replacement),
        h('label',{class:'ri-row'},remove,' Remove the quoted wording'),
        !proposal && button('Use my correction text',()=>{remove.checked=false;replacement.value=review.truth;replacement.dispatchEvent(new Event('input'));},{kind:'ghost'}),
        h('label',{class:'ri-row'},selected,' Apply this edit'),validation);
    const node = h('details',{class:'ri-card ri-tight ri-correction-source'},
        h('summary',{},h('strong',{},source.label),h('span',{class:'ri-correction-excerpt'},preview)),
        location && h('p',{class:'ri-help'},location),
        source.evidenceAt>=0 && button('Jump to source message',()=>openMessage(source.evidenceAt),{kind:'ghost'}),
        proposal && h('dl',{class:'ri-correction-diff'},h('dt',{},'Current'),h('dd',{},proposal.quote),
            h('dt',{},'Proposed'),h('dd',{},proposal.replacement || 'Remove this wording')),
        source.before!==preview && h('details',{},h('summary',{},'Read the full source'),h('pre',{class:'ri-v10-prompt-text'},source.before)),
        edit);
    return {node,selected,check,edit:()=>({id:source.id,quote:quote.value,replacement:remove.checked ? '' : replacement.value})};
}

export function correctionEditor({focus = -1, onSaved = () => {}} = {}) {
    const startChat = ctx().getCurrentChatId?.();
    const scope=executionScope();
    const currentTarget=()=>{
        const latest=correctionSwipeTarget();
        return focus<0 || latest?.index===focus ? latest : null;
    };
    let target = currentTarget();
    const truth = textArea('',()=>{},{rows:3,maxLength:1000,'aria-label':'Correct story fact',placeholder:'The bridge was built of stone.'});
    const wording = textInput('',()=>{},{maxLength:400,'aria-label':'Wrong wording (optional)',placeholder:'Exact phrase in the story or lore'});
    const status = h('p',{class:'ri-help',role:'status'});
    const results = h('div',{class:'ri-list'});
    const regenerate = h('input',{type:'checkbox',checked:!!target,disabled:!target,'aria-label':'Regenerate the latest reply'});
    const auto = h('input',{type:'checkbox','aria-label':'Find and update sources with AI'});
    const cost = h('p',{class:'ri-help','aria-live':'polite'});
    const execution = h('div');
    const manualHint = h('p',{class:'ri-help',hidden:true},'Source edits you checked will be applied. Clear those selections to use automatic source editing.');
    let review, rows=[], found=[], revision=0, busy=false;
    const configure = () => {
        const manual = rows.some(row=>row.selected.checked);
        if (manual) auto.checked=false;
        auto.disabled = busy || manual;
        manualHint.hidden = !manual;
        const requests = Number(auto.checked) + Number(regenerate.checked);
        cost.textContent = requests === 0 ? 'Saves the correction for future replies. No model requests.'
            : requests === 2 ? 'Up to 2 model requests · one to trace sources and one to generate an alternate reply.'
                : auto.checked ? 'Up to 1 model request to find and update sources.' : '1 model request to generate an alternate reply.';
        save.textContent=regenerate.checked ? 'Repair facts and generate alternate' : auto.checked ? 'Find and apply source edits' : 'Apply correction';
        save.disabled = busy || !truth.value.trim() || rows.some(row=>row.check());
        audit.disabled = busy;
        search.disabled = busy || (!truth.value.trim() && !wording.value.trim());
        trace.disabled = busy || !truth.value.trim();
        execution.replaceChildren(executionDetails(executionReceipt('factRepair') ||
            executionPreview('factRepair',{stage:auto.checked ? 'additional' : 'code'})));
    };
    const doc = () => ({truth:truth.value,wording:wording.value,focus});
    const showRetry = (correction, requestedTarget, traceNote) => {
        results.replaceChildren(button('Retry guided regeneration',async event=>{
            const latest = correctionSwipeTarget();
            if (!latest || executionScope()!==scope || latest.chatId!==startChat || latest.message!==requestedTarget.message) {
                status.textContent='The latest reply changed. Open Corrections on the intended reply.';
                return;
            }
            event.currentTarget.disabled=true;
            results.replaceChildren();
            busy=true;configure();
            try {await settle(correction,latest,traceNote);}
            finally {busy=false;configure();}
        },{kind:'ghost'}));
    };
    const settle = async (correction, requestedTarget, traceNote = '') => {
        const count = correction.sources.length;
        const saved = count ? `Saved ${count} source ${count===1 ? 'edit' : 'edits'} and the correction.` : 'Saved the correction.';
        const result = [saved,traceNote].filter(Boolean).join(' ');
        status.textContent = requestedTarget ? result+' Generating the revised reply…' : result;
        if (!requestedTarget) return;
        try {
            await regenerateStoryCorrection(correction,requestedTarget);
            target=currentTarget();
            status.textContent = result+' The revised reply is ready.';
            if (!status.isConnected) toast('success',status.textContent);
        } catch (error) {
            status.textContent = result+' '+error.message;
            if (!status.isConnected) toast('warning',status.textContent);
            showRetry(correction,requestedTarget,traceNote);
        }
    };
    async function commit(useModel) {
        if (busy || executionScope()!==scope) return;
        const requestedTarget = regenerate.checked ? target : null;
        busy=true; configure();
        truth.disabled=wording.disabled=regenerate.disabled=true;
        status.textContent=useModel ? 'Tracing the correction and applying source edits…' : 'Saving the correction…';
        try {
            const edits=rows.filter(row=>row.selected.checked).map(row=>row.edit());
            let traceNote='';
            let correction;
            if (edits.length) correction = await applyStoryCorrection(review || beginStoryCorrection(doc()),edits);
            else {
                const inspected = await runFactRepair({...doc(),useModel});
                const evidence = h('details',{},h('summary',{},`Sources checked (${inspected.checked.length})`),
                    h('ul',{},inspected.checked.map(source=>h('li',{},source))),
                    inspected.protected.length ? h('p',{class:'ri-help'},'Kept the wording of '+inspected.protected.length+' story sources.') : null);
                if (!inspected.correction) {
                    status.textContent=inspected.unresolved.join(' ');
                    results.replaceChildren(evidence);
                    return;
                }
                correction = inspected.correction;
                traceNote = 'Checked '+inspected.checked.length+' sources.';
                results.replaceChildren(evidence);
            }
            rows=[]; review=null;
            truth.value=''; wording.value=''; auto.checked=false; markDraft(); onSaved(correction);
            results.append(button('Undo source repair',async()=>{
                try { await undoRepair(correction.id); results.replaceChildren(); status.textContent='Source repair undone.'; onSaved(); }
                catch (error) { status.textContent=error.message; }
            },{kind:'ghost'}));
            await settle(correction,requestedTarget,traceNote);
            (await import('./sent.js')).refreshUnderReplies();
        } catch (error) { status.textContent=error.message; }
        finally {busy=false;truth.disabled=wording.disabled=false;regenerate.disabled=!target;configure();}
    }
    const save=button('Apply correction',()=>commit(auto.checked),{kind:'primary',disabled:true});
    const audit=button('Repair facts only',async()=>{
        if (busy) return;
        busy=true; configure();
        try {
            const inspected = await runFactRepair(doc());
            status.textContent=inspected.correction
                ? `Checked ${inspected.checked.length} sources and repaired ${inspected.repaired.length}.`
                : inspected.unresolved.join(' ');
            results.replaceChildren(h('details',{},h('summary',{},'Sources checked'),h('ul',{},inspected.checked.map(source=>h('li',{},source)))));
            if (inspected.correction) {
                results.append(button('Undo source repair',async()=>{
                    try { await undoRepair(inspected.correction.id); results.replaceChildren(); status.textContent='Source repair undone.'; onSaved(); }
                    catch (error) { status.textContent=error.message; }
                },{kind:'ghost'}));
                onSaved(inspected.correction);
            }
        } catch (error) { status.textContent=error.message; }
        finally {busy=false;configure();}
    },{kind:'ghost'});
    const more = button('Show more source matches',()=>{
        for (const {source,proposal} of found.slice(rows.length,rows.length+8)) {
            const row=sourceRow(source,proposal,review,target,configure);
            rows.push(row); results.insertBefore(row.node,more);
        }
        more.hidden=rows.length>=found.length;
        configure();
    },{kind:'ghost'});
    const search=button('Find source matches',()=>run(false));
    const trace=button('Trace and draft with AI',()=>run(true));
    async function run(useModel) {
        if (busy || ctx().getCurrentChatId?.()!==startChat) return;
        const started=++revision;
        busy=true;configure();
        status.textContent=useModel ? 'Tracing the correction…' : 'Searching story sources…';
        results.replaceChildren(); rows=[]; review=null;
        try {
            const current=await findCorrectionSources({...doc(),audit:!useModel});
            let proposals=[], traceError='';
            if (useModel) {
                try {proposals=await suggestCorrectionEdits(current);}
                catch(error){traceError=error.message;}
            }
            if (revision!==started || ctx().getCurrentChatId?.()!==startChat) return;
            review=current;
            const proposed = new Map(proposals.map(item=>[item.id,item]));
            const sources = new Map([...current.candidates.filter(item=>proposed.has(item.id)),...current.sources].map(item=>[item.id,item]));
            found=[...sources.values()].map(source=>({source,proposal:proposed.get(source.id)}));
            results.append(more); more.click();
            const count = current.sources.length;
            const matches = count ? `${count} source ${count===1 ? 'match' : 'matches'}.` : 'No source text matched.';
            status.textContent = [matches,useModel && (traceError || (proposals.length ? `${proposals.length} proposed edits to review.` : 'The model found no reliable edits.')),
                !truth.value.trim() && 'Enter the corrected fact before saving.',
                truth.value.trim() && !found.length && 'You can still save the correction.'].filter(Boolean).join(' ');
        } catch(error) { if (revision===started) status.textContent=error.message; }
        finally {busy=false;configure();}
    }
    const invalidate = () => {
        revision++; review=null; rows=[]; results.replaceChildren(); status.textContent=''; configure();
    };
    truth.addEventListener('input',()=>{
        if (!review?.wording) return invalidate();
        review.truth=truth.value.trim();
        status.textContent=review.truth ? 'Review the matching sources before applying the correction.' : 'Enter the corrected fact before saving.';
        configure();
    });
    wording.addEventListener('input',invalidate);
    regenerate.addEventListener('change',configure);
    auto.addEventListener('change',configure);
    configure();
    const unfinished = target && (chatState()?.storyCorrections || []).findLast(item=>
        item.regeneration?.status==='failed' && item.regeneration.recordTime===target.message.extra[KEY].time);
    if (unfinished) {
        status.textContent='The correction was saved. Its guided reply did not finish.';
        showRetry(unfinished,target);
    }
    const form=h('div',{class:'ri-guided-body ri-correction-editor'},
        h('label',{class:'ri-field'},'Correct story fact',truth),
        h('label',{class:'ri-row'},auto,' Find and update sources with AI'),
        manualHint,
        target && h('label',{class:'ri-row'},regenerate,' Regenerate the latest reply'),
        cost,
        h('div',{class:'ri-row'},save,audit),
        execution,
        status,
        h('details',{class:'ri-correction-sources'},h('summary',{},'Find and edit source records'),
            h('label',{class:'ri-field'},'Wrong wording, optional',wording),
            h('p',{class:'ri-help'},'Search by exact wording or by the corrected fact. Saving needs the corrected fact. AI tracing can propose source edits in one additional request.'),
            h('div',{class:'ri-row'},search,trace),
            executionSettings({operation:'factRepair'})),
        slot(['traceCorrection','correctionSwipe','correctionCanon'],'Customize correction prompts'),
        results);
    const markDraft=()=>form.toggleAttribute('data-ri-dirty',Boolean(truth.value.trim() || wording.value.trim()));
    truth.addEventListener('input',markDraft);
    wording.addEventListener('input',markDraft);
    markDraft();
    return form;
}

export function renderCorrections(body, requested, app) {
    if (!isChatOpen()) return;
    const selected=requested && guidedTarget(requested.index);
    if (requested && (!selected || selected.chatId!==requested.chatId || selected.fingerprint!==requested.fingerprint || selected.swipe!==requested.swipe)) {
        body.append(h('p',{class:'ri-note ri-note-warn',role:'status'},'The selected reply or version changed. Return to chat and open Correct story facts on the intended version.'));
        return;
    }
    const list = h('div',{class:'ri-list'});
    const renderHistory = () => {
        const corrections = [...(chatState()?.storyCorrections || [])].reverse();
        const labels=replyLabels();
        list.replaceChildren(...corrections.map(correction=>{
            const reply=correction.reply && guidedTarget(correction.reply.index);
            const existing=reply && reply.fingerprint===correction.reply.fingerprint && reply.swipe===correction.reply.swipe;
            const label=correction.reply && `${existing ? labels[reply.index] : correction.reply.label} · Version ${correction.reply.swipe+1}`;
            const hasReceipt=existing && ctx().chat[reply.index]?.extra?.[KEY];
            return h('details',{class:'ri-card ri-tight'},h('summary',{},correction.truth),
                label && h('p',{class:'ri-help'},existing ? label : `${label} · This version has changed.`),
                hasReceipt && button(`Review ${labels[reply.index].toLowerCase()}`,()=>app.openPage('sent',{
                    reply,anchor:`#ri-review-reply-${reply.index}`,focusPage:true,
                })),
                h('ul',{},correction.sources.map(source=>h('li',{},source.label+(['lore','card'].includes(source.kind) ? ' · this chat' : '')))),
                correction.undo && button('Undo source repair',async()=>{
                    try { await undoRepair(correction.id); renderHistory(); }
                    catch (error) { toast('error',error.message); }
                },{kind:'ghost'}));
        }));
        list.hidden=!corrections.length;
    };
    const form = correctionEditor({focus:selected?.index,onSaved:()=>{
        form.removeAttribute('data-ri-dirty');
        renderHistory();
    }});
    const heading=selected && `${replyLabels()[selected.index]} · ${selected.name} · selected version ${selected.swipe+1}`;
    body.append(section('Correct story facts',
        heading && h('p',{class:'ri-help',id:'ri-correction-target'},heading),form,
        selected && h('details',{},h('summary',{},'Read the selected reply'),
            h('p',{},separateReply(selected.text).text))),list);
    renderHistory();
}
