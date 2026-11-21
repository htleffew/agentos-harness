import { h, button, section, textArea, textInput } from './dom.js';
import { promptGroup } from './prompts.js';
import { ctx, isChatOpen } from '../st.js';
import { chatState } from '../store.js';
import { applyStoryCorrection, findCorrectionSources, suggestCorrectionEdits } from '../corrections.js';

function openMessage(index) {
    const host = ctx();
    if (typeof host.executeSlashCommandsWithOptions==='function') {
        return host.executeSlashCommandsWithOptions('/chat-jump '+index);
    }
    document.querySelector('#chat .mes[mesid="'+index+'"]')?.scrollIntoView({block:'center'});
}

const sourceHelp = source => ['lore','card'].includes(source.kind) ? 'Uses a corrected copy in this chat.' :
    source.user ? 'Edits the original player message if selected.' : source.active===false ? 'This entry is currently disabled.' : '';

function sourceRow(source, proposal, exact) {
    const selected = h('input',{type:'checkbox',checked:!!proposal && !source.user,'aria-label':'Apply edit to '+source.label});
    const found = exact ? source.before.toLowerCase().indexOf(exact.toLowerCase()) : -1;
    const defaultQuote = proposal?.quote ?? (found>=0 ? source.before.slice(found,found+exact.length) : '');
    const quote = textArea(defaultQuote,()=>{},{rows:2,'aria-label':'Exact source quotation'});
    const replacement = textArea(proposal?.replacement || '',()=>{},{rows:2,'aria-label':'Source replacement'});
    const location = [
        source.span && 'Chapter covers replies '+source.span.from+'–'+source.span.to+(source.span.chat ? ' in '+source.span.chat : ''),
        source.kind==='world' && source.evidenceAt>=0 && 'Filed from chat message '+(source.evidenceAt+1),
        source.kind==='world' && source.copies?.length>1 && 'Also filed from '+source.copies.slice(1).map(i=>i+1).join(', '),
        sourceHelp(source),
    ].filter(Boolean).join(' · ');
    const preview = h('details',{},h('summary',{},'Read the source text'),h('pre',{class:'ri-v10-prompt-text'},source.before));
    const node = h('details',{class:'ri-card ri-tight',open:!!proposal},
        h('summary',{},source.label),
        location && h('p',{class:'ri-help'},location),
        source.quote && h('blockquote',{class:'ri-help'},source.quote),
        source.evidenceAt>=0 && button('Jump to source message',()=>openMessage(source.evidenceAt),{kind:'ghost'}),
        preview,h('label',{class:'ri-field'},'Exact wording to replace',quote),
        h('label',{class:'ri-field'},'Replacement text',replacement),
        h('label',{class:'ri-row'},selected,'Apply this edit'));
    return {node,selected,edit:()=>({id:source.id,quote:quote.value,replacement:replacement.value})};
}

export function correctionEditor({focus = -1, onSaved = () => {}} = {}) {
    const startChat = ctx().getCurrentChatId?.();
    const truth = textArea('',()=>{},{rows:3,maxLength:1000,'aria-label':'Correct story fact',placeholder:'The bridge was built of stone. Mira only learned that when she reached the river.'});
    const wording = textInput('',()=>{},{maxLength:400,'aria-label':'Wrong wording (optional)',placeholder:'Optional exact phrase to look for'});
    const status = h('p',{class:'ri-help',role:'status'});
    const results = h('div',{class:'ri-list'});
    let review, rows=[], shown=0, proposals=[];
    const save = button('Save correction and checked source edits',async()=>{
        save.disabled=true;
        try {
            const correction = await applyStoryCorrection(review,rows.filter(row=>row.selected.checked).map(row=>row.edit()),truth.value);
            status.textContent = correction.sources.length ? 'Saved '+correction.sources.length+' source edits and the accepted correction.' :
                'Saved the accepted fact for this chat. No source edits were selected.';
            results.replaceChildren();
            review = null;
            onSaved(correction);
            import('./sent.js').then(module=>module.refreshUnderReplies());
        } catch (error) { status.textContent=error.message; }
        finally { save.disabled=!review; }
    },{kind:'primary',disabled:true});
    const more = button('Show more source matches',()=>{
        for (const source of ordered().slice(shown,shown+25)) {
            const row=sourceRow(source,proposals.find(proposal=>proposal.id===source.id),review.wording);
            rows.push(row);
            results.insertBefore(row.node,more);
        }
        shown=rows.length;
        more.hidden=shown>=review.sources.length;
    },{kind:'ghost'});
    const ordered = () => [...review.sources].sort((a,b)=>
        Number(proposals.some(proposal=>proposal.id===b.id))-Number(proposals.some(proposal=>proposal.id===a.id)));
    const search = button('Find source matches',()=>run(false));
    const trace = button('Trace and draft with AI',()=>run(true));
    async function run(useModel) {
        if (ctx().getCurrentChatId?.()!==startChat) return;
        search.disabled=trace.disabled=save.disabled=true;
        status.textContent=useModel ? 'Tracing the correction…' : 'Searching story sources…';
        results.replaceChildren();
        try {
            review=await findCorrectionSources({truth:truth.value,wording:wording.value,focus});
            proposals=useModel ? await suggestCorrectionEdits(review) : [];
            rows=[]; shown=0;
            results.replaceChildren(more);
            more.click();
            status.textContent=review.sources.length ? review.sources.length+' possible sources. Review the wording and check the edits you want to apply.' :
                'No source matched. You can save the accepted fact for this chat or search with more specific wording.';
        } catch (error) { status.textContent=error.message; review=null; }
        finally { search.disabled=trace.disabled=false; save.disabled=!review; }
    }
    const invalidate = () => { review=null; save.disabled=true; results.replaceChildren(); };
    truth.addEventListener('input',invalidate);
    wording.addEventListener('input',invalidate);
    return h('div',{class:'ri-guided-body'},
        h('p',{class:'ri-help'},'Describe what the story should treat as true. Find saved sources directly or use one AI request to propose edits. Review any changes to the transcript, summaries, or lore before saving.'),
        h('label',{class:'ri-field'},'Correct story fact',truth),
        h('label',{class:'ri-field'},'Wrong wording, optional',wording),
        h('div',{class:'ri-row'},search,trace),
        promptGroup(['traceCorrection'],'Customize correction tracing'),
        status,results,save);
}

export function renderCorrections(body) {
    if (!isChatOpen()) return;
    const list = h('div',{class:'ri-list'});
    const renderHistory = () => {
        const corrections = [...(chatState()?.storyCorrections || [])].reverse();
        list.replaceChildren(...corrections.map(correction=>h('details',{class:'ri-card ri-tight'},
            h('summary',{},correction.truth),
            h('ul',{},correction.sources.map(source=>h('li',{},source.label+(['lore','card'].includes(source.kind) ? ' · this chat' : '')))))));
        list.hidden=!corrections.length;
    };
    body.append(section('Correct story facts',correctionEditor({onSaved:renderHistory})),list);
    renderHistory();
}
