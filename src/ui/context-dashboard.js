import { memoryOnly, memoryComponents } from '../components.js';
import { setMemoryComponent } from '../hide.js';
import { h, button, field, section, select } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { isChatOpen, hasEvent, toast } from '../st.js';
import { applyHistoryWindow, catchUpChatHistory, historyCatchUpPreview, historyCatchUpStatus, stopHistoryCatchUp, writeChapterNow, chapterBusy, otherSummaryOn } from '../chapters.js';
import { refreshUnderReplies } from './sent.js';
import { promptGroup } from './prompts.js';
import { chatWorld } from '../world.js';
import { historyPreview, chapterPreview, lastContext } from '../context-budget.js';
import { editableReplySlots, storyJournalStatus } from '../memory-journal.js';
import { syncWorld } from '../worldflow.js';
import { executionReceipt } from '../execution.js';
import { executionAction, executionDetails, executionSettings, functionExecution } from './execution.js';

const number = n => Number(n || 0).toLocaleString();
const approx = n => `~${number(n)} tokens`;
const row = (name, value, help = '') => h('div', { class: 'ri-context-metric' }, h('div', { class: 'ri-context-metric-label' }, name), h('strong', {}, value), help ? h('div', { class: 'ri-help' }, help) : null);

function historyTools(app, components) {
    const status = historyCatchUpStatus();
    const keep = h('input',{type:'checkbox',checked:true});
    const redraw = () => { if (app.tab==='context') app.render(); };
    const run = async rebuild => {
        try { await catchUpChatHistory(redraw,{rebuild,keepAuthored:keep.checked}); }
        catch (error) { toast('error',error.message); }
        finally { refreshUnderReplies(); redraw(); }
    };
    const disabled = !components.chapters || !!status?.running;
    const catchUp = executionAction(button('Catch up this chat',()=>run(false),{kind:'primary',disabled}),'1 model call per batch');
    const rebuild = executionAction(button('Rebuild from all chat history',()=>run(true),{disabled}),'1 model call per batch');
    const catchUpBudget = h('div',{class:'ri-help','aria-live':'polite'},'Calculating current batch count…');
    const rebuildBudget = h('div',{class:'ri-help','aria-live':'polite'},'Calculating current batch count…');
    const budget = (preview,node,action) => {
        const count = preview.count;
        const expected = count>1 ? `up to ${count}` : count;
        action.disabled = disabled || count===0;
        executionAction(action,count===1 ? '1 model call' : `Up to ${count} model calls`);
        node.replaceChildren(count===0 ? h('p',{},'Current coverage has no batches ready for this action.')
            : functionExecution('historyCatchUp',{expected,trigger:`One model request per batch. Stops on the first failure. ${count} batches are ready.`}));
    };
    if (!disabled) historyCatchUpPreview().then(plan=>{
        budget(plan.catchUp,catchUpBudget,catchUp);
        budget(plan.rebuild,rebuildBudget,rebuild);
    }).catch(error=>{
        catchUpBudget.replaceChildren(h('p',{},error.message));
        rebuildBudget.replaceChildren(h('p',{},error.message));
    });
    return section('Catch up or rebuild this chat',
        h('p',{class:'ri-help'},'Read accepted replies in order and write chapters in batches. Each batch uses an AI request. Enabled story features file supported details in this chat’s Story World. Auto-hide and the protected message window apply after chapters are saved.'),
        !components.chapters && h('p',{class:'ri-note'},'Enable Chapter summaries above to use these actions.'),
        status && h('p',{class:'ri-note',role:'status'},status.text),
        status?.running ? button(status.installing ? 'Saving…' : status.stop ? 'Stopping…' : 'Stop after the current request',()=>{stopHistoryCatchUp();redraw();},{disabled:status.stop || status.installing}) :
            h('div',{class:'ri-row'},catchUp),
        !disabled && catchUpBudget,
        h('p',{class:'ri-help'},'Catch-up fills uncovered history and resumes from saved chapters. A fresh rebuild reads the entire chat and switches to a new managed Story World after all chapters are ready. The previous book stays available as a backup.'),
        status?.receipts?.length>0 && executionDetails(status.receipts),
        h('details',{},h('summary',{},'Fresh rebuild options'),
            h('label',{class:'ri-row'},keep,'Keep my authored entries and state corrections'),
            rebuild,
            !disabled && rebuildBudget),
        promptGroup(['chapterSummary','catchUpHistory','systemCatchUp'],'Customize catch-up and rebuild guidance'));
}

export function writeChapterControl(onSaved = () => {}) {
    const status=h('p',{class:'ri-help',role:'status'});
    const action=executionAction(button('Write a chapter now',async()=>{
        action.disabled=true;
        status.textContent='Writing the chapter…';
        try {
            const name=await writeChapterNow();
            status.textContent=`Saved “${name}” to Story World.`;
            refreshUnderReplies();
            onSaved();
        } catch (error) { status.textContent=error.message; }
        finally {
            action.disabled=false;
            receipt.replaceChildren(functionExecution('chapterSummary',{receipt:executionReceipt('chapterSummary')}));
        }
    },{kind:'primary',disabled:chapterBusy()}));
    const receipt=h('div',{},functionExecution('chapterSummary',{receipt:executionReceipt('chapterSummary')}));
    return h('div',{},action,status,receipt);
}

export function renderContext(body, app) {
    const st = settings(), o = st.summary;
    const memory = memoryOnly(), components = memoryComponents();
    const save = () => { saveSettings(); setTimeout(() => app.render(), 0); };
    const choose = (value, set) => select([{value:'on', label:'On'}, {value:'off', label:'Off'}], value ? 'on' : 'off', v => { set(v === 'on'); save(); });
    const numeric = (label, value, min, max, unit, changed, help) => {
        const input = h('input', { type: 'number', class: 'ri-input ri-input-num', min, max, value, 'aria-label': label, onchange: () => {
            const n = Math.max(min, Math.min(max, Math.round(Number(input.value) || min))); input.value = n; changed(n); save();
        }});
        return field(label, help, h('span', { class:'ri-num' }, input, h('span', {class:'ri-unit'}, unit)));
    };
    const historyUnit=o.historyUnit==='tokens' ? 'tokens' : 'messages';
    const useTokens=historyUnit==='tokens';
    const [low,high]=useTokens ? [250,1000000] : [4,400];
    const target=Math.max(low,Math.min(high,Number(useTokens ? o.keepTokens : o.keepShown) || (useTokens ? 8000 : 30)));
    const label=useTokens ? 'Recent history token budget' : 'Recent messages to protect';
    const range = h('input', { type:'range', min:low, max:high, step:useTokens ? 250 : 1, value:target, 'aria-label':label, class:'ri-context-range' });
    const amount = h('input', { type:'number', min:low, max:high, value:target, 'aria-label':`${label} (number)`, class:'ri-input ri-input-num' });
    const preview = h('div', { class:'ri-context-preview', role:'status' });
    function show(n) {
        const p = historyPreview(n,historyUnit);
        preview.textContent = isChatOpen() ? `In this chat, the newest ${p.count} story messages contain ${approx(p.tokens)} of text. The opening message is kept separately.` : 'Open a chat to estimate its recent message text.';
    }
    function setTarget(raw) {
        const n = Math.max(low,Math.min(high,Math.round(Number(raw) || low)));
        range.value = amount.value = String(n);
        if (useTokens) o.keepTokens=n; else o.keepShown=n;
        saveSettings(); show(n);
    }
    range.addEventListener('input', () => setTarget(range.value));
    amount.addEventListener('change', () => setTarget(amount.value));
    show(target);
    const hasWorld = isChatOpen() && !!chatWorld();
    const filing = storyJournalStatus();
    const retryFiling = button('Retry filing',async()=>{
        retryFiling.disabled=true;
        try { await syncWorld(); refreshUnderReplies(); app.render(); }
        catch (error) { toast('error',error.message); }
        finally { retryFiling.disabled=false; }
    },{kind:'ghost'});
    const applyWindow = button('Apply to saved chapters now',async()=>{
        applyWindow.disabled=true;
        try { await applyHistoryWindow();refreshUnderReplies();app.render(); }
        catch (error) { toast('error',error.message); }
        finally { applyWindow.disabled=false; }
    },{kind:'ghost'});
    const memorySection=section('Conversation and memory',
        h('div', { class:'ri-help' }, 'The preset’s Chat History includes the messages still visible to the AI. Chapters summarize older story, and the extension can hide the messages they cover. Keep Chat History enabled to include the recent conversation.'),
        isChatOpen() && !hasWorld && !memory ? h('div', {class:'ri-note ri-note-warn'},
            'Chapter settings are saved. Automatic summaries and hiding are paused until this chat has a Story World.',
            h('div',{class:'ri-row'},button('Open Story World',()=>app.openPage('world'),{kind:'ghost'}))) : null,
        field('Keep the story so far in chapters', 'Each new chapter uses one AI request. A successful chapter is stored in the Story World.', choose(components.chapters, v => setMemoryComponent('chapters',v))),
        !memory && field('Earlier replies kept editable',
            editableReplySlots() ? `The current reply is kept separately · ${editableReplySlots()} total editable slots. The Story World book holds filed facts. Recent changes appear in reply cards and extension recall.`
                : 'Automatic Story World changes file as soon as a reply is accepted.',
            select([{value:'-1',label:'File immediately'},...Array.from({length:21},(_,n)=>({value:String(n),label:String(n)}))],
                String(editableReplySlots()-1), value=>{st.world.editableReplies=Number(value);save();},
                {'aria-label':'Earlier replies kept editable'})),
        hasWorld && h('p',{class:'ri-help',role:'status'},
            `Filed through reply ${filing.filed} · ${filing.pending} editable records with changes · ${filing.uncertain} replies need review.`),
        filing.error && h('div',{class:'ri-note ri-note-warn',role:'status'},filing.error,retryFiling),
        otherSummaryOn() && components.chapters && h('p',{class:'ri-note ri-note-warn'},
            'SillyTavern’s own Summarize is also adding a summary to the prompt in this chat. Choose which summary source to use.'),
        hasWorld && components.chapters && writeChapterControl(),
        hasWorld && components.chapters && h('details',{class:'ri-card ri-tight'},h('summary',{},'Chapter organization'),
            !memory && field('Move finished records into chapters','Keeps completed threads and events with the chapter that covers them.',
                choose(o.retire!==false,value=>{o.retire=value;})),
            numeric('Recent chapters eligible for full recall',o.keep,1,10,'chapters',n=>{o.keep=n;},'The chapter budget also limits recall.'),
            numeric('Combine older chapters when there are more than',o.roll,2,50,'chapters',n=>{o.roll=n;},'Combining follows the saved automatic request setting.')),

        h('details',{},h('summary',{},'Automatic chapter model requests'),
            executionSettings({operation:'chapterSummary',receipt:executionReceipt('chapterSummary')}),
            executionSettings({operation:'chapterCombine',receipt:executionReceipt('chapterCombine')})),
        h('div', {class:'ri-grid2'},
            !memory && field('Write a chapter when the scene ends', 'Requires Story World updates and at least the minimum number of replies.', choose(o.onSceneEnd !== false, v => {o.onSceneEnd=v;})),
            !memory && numeric('Minimum replies for a scene-end chapter', o.minReplies, 1, 100, 'replies', n => {o.minReplies=n;}, 'A reply is a model message.'),
            numeric('Write a chapter at least every', o.every, 0, 200, 'replies', n => {o.every=n;}, 'Set 0 to disable the reply-count threshold.'),
            numeric('Summarize at estimated tokens',o.everyTokens || 0,0,1000000,'tokens',n=>{o.everyTokens=n;},
                'After an accepted reply, write a chapter when unsummarized text reaches this estimate. Whichever enabled threshold is reached first starts the chapter. Set 0 to disable the token threshold.'),
            field('Hide messages covered by a chapter', 'Hidden messages remain readable in the chat. Only successfully saved chapters can hide messages.', choose(components.hide, v => setMemoryComponent('hide',v)))),
        isChatOpen() && Number(o.every) > 0 ? (() => { const c = chapterPreview(Number(o.every)); return h('div', {class:'ri-help'}, `The latest ${c.replies} model replies and their surrounding messages contain about ${number(c.tokens)} tokens across ${c.messages} messages. This is a preview of recent text, not the exact next chapter.`); })() : null,
        field('Protect recent history by','Choose how to size the full-text window for covered history. The opening and unsummarized messages stay available.',
            select([{value:'messages',label:'Message count'},{value:'tokens',label:'Estimated tokens'}],historyUnit,
                value=>{o.historyUnit=value;save();},{'aria-label':'Protect recent history by'})),
        field(label, useTokens ? 'Keeps whole messages inside the estimated budget and always protects the newest two story messages.'
            : 'Protects this many recent story messages.',
            h('div', {class:'ri-context-slider'}, range, amount, h('span', {class:'ri-unit'},historyUnit)), preview),
        hasWorld && components.hide && h('div',{class:'ri-row'},
            applyWindow,
            h('span',{class:'ri-help'},'New summaries use this window automatically. Applying it to saved chapters takes no model request.')),
        h('div', {class:'ri-grid2'},
            numeric('Story World notes budget', st.world.budget, 100, 4000, 'tokens', n => {st.world.budget=n;}, 'Approximate text budget for relevant story facts.'),
            numeric('Chapter notes budget', o.budget, 100, 6000, 'tokens', n => {o.budget=n;}, 'Approximate text budget for the story so far.')));
    memorySection.id='ri-memory-status';
    body.append(memorySection);
    if (!isChatOpen()) return;
    body.appendChild(historyTools(app,components));
    const p = historyPreview(target,historyUnit), last = lastContext();
    body.appendChild(section('This chat now', h('div', {class:'ri-context-grid'},
        row('Story messages', number(p.total), 'Includes messages hidden from the AI.'),
        row('Currently visible', number(p.open), 'The host may omit more when assembling a request.'),
        row('Hidden from AI', number(p.hidden), 'Still readable in the chat.'))));
    const content = [];
    if (!hasEvent('CHAT_COMPLETION_PROMPT_READY')) content.push(h('div', {class:'ri-note ri-note-warn'}, 'This host does not expose the assembled chat-completion prompt. A last-request breakdown is unavailable.'));
    else if (!last) content.push(h('div', {class:'ri-note'}, 'No assembled chat-completion request has been observed in this chat since opening or reloading the app. Send a reply to see its breakdown.'));
    else {
        const metric = (name, data) => row(name, data.chars ? approx(data.tokens) : (data.unmatched ? 'Not recognized' : 'None recognized'), data.unmatched ? `${number(data.unmatched)} prepared passage${data.unmatched === 1 ? '' : 's'} could not be matched; the actual amount may be higher.` : 'Recognized text only.');
        content.push(h('div', {class:'ri-context-grid'},
            row('Whole request', approx(last.total), 'All visible text in the assembled request; excludes model-specific overhead.'),
            row('Recent conversation recognized', `${number(last.history.count)} messages · ${approx(last.history.tokens)}`, last.history.unmatched ? `${number(last.history.unmatched)} visible chat messages were not matched; they may have been omitted, trimmed or reformatted.` : 'Full messages recognized in the request.'),
            metric('Story World notes', last.notes), metric('Chapter summaries', last.chapters), metric('Recalled World Info and structured records',last.lore),
            metric('Story events and world orders', last.events), metric('Other extension instructions', last.other), metric('Scene, state and update instructions', last.updates)));
        if (last.unsupportedContent) content.push(h('div', {class:'ri-note ri-note-warn'}, 'The request contains non-text content, which is not included in these estimates.'));
        content.push(h('div', {class:'ri-help'}, 'This is the last assembled request observed in this session, not a prediction of the next reply. Matching can miss text changed by a preset or another extension. Categories are partial and do not add up to the total. The host or provider may change the request afterward. Text is estimated at roughly four characters per token, so actual counts vary by model and language.'));
    }
    body.appendChild(section('Last observed request', ...content));
}
