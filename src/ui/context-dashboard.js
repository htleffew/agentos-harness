import { memoryComponents } from '../components.js';
import { setMemoryComponent } from '../hide.js';
import { h, button, field, section, select, toggle, howItWorks } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { isChatOpen, hasEvent, toast, ctx, KEY } from '../st.js';
import { applyHistoryWindow, otherSummaryOn } from '../chapters.js';
import { catchUp as catchUpRunner, describe, pending, tapPlan, routeWord } from '../memory/catchup.js';
import { hostCarryOver } from '../memory/carry-over.js';
import { memoryActive } from '../memory/import.js';
import { fold as foldMemory } from '../memory/fold.js';
import { gateModelButtons } from './memory-settings.js';
import { refreshUnderReplies } from './sent.js';
import { home, homeLink, slot } from './homes.js';
import { chatWorld, filingStatus, refileStory } from '../records.js';
import { historyPreview, chapterPreview, lastContext, lastLayout } from '../context-budget.js';
import { editableReplySlots } from '../memory-journal.js';
import { executionAction, executionDetails, functionExecution } from './execution.js';
import { storyNotesFields, storyNotesBudget, worldUpkeepFields, worldUpdatePrompts, nextReplyPreview } from './world.js';
import { enabledV10 } from '../v10.js';
import { numberInput } from './dom.js';

const number = n => Number(n || 0).toLocaleString();
const approx = n => `~${number(n)} tokens`;
const row = (name, value, help = '') => h('div', { class: 'ri-context-metric' }, h('div', { class: 'ri-context-metric-label' }, name), h('strong', {}, value), help ? h('div', { class: 'ri-help' }, help) : null);

const catchUpPlan = () => { try { return ctx().chatMetadata?.ri_memory?.catchup || null; } catch { return null; } };
const catchUpWaiting = () => { try { const c = ctx(); return pending(c.chat || [], { result: foldMemory(c.chat || [], c.chatMetadata || {}), key: KEY }).count; } catch { return 0; } };

/**
 * The catch-up status line ("Catching up on the desktop: part 3 of 9" with Cancel, or the ask card). It repaints itself when the
 * runner reports a change and stops listening once it leaves the page. Setup, Memory shows it, and the Story World page can too.
 */
export function catchUpStatusLine() {
    const holder = h('div', { class: 'ri-catchup-status', 'data-ri-catchup-line': '' });
    let off = null;
    const draw = () => {
        const plan = catchUpPlan();
        const view = plan ? describe(plan) : null;
        holder.replaceChildren(...(view?.text && view.state !== 'declined' ? [h('p', { class: 'ri-note', role: 'status', 'aria-live': 'polite' }, view.text),
            view.cancel ? button('Cancel', async () => { try { await (await catchUpRunner()).cancel(); } catch (error) { toast('error', error.message); } }, { kind: 'ghost' }) : null] : []));
    };
    draw();
    catchUpRunner().then(runner => { off = runner.onChange(() => { if (!holder.isConnected) off?.(); else draw(); }); draw(); }).catch(() => {});
    return holder;
}

/** Catch up, rebuild and continue in a new chat. Its one home is Setup, Memory ("This chat"). */
function historyTools(app, components) {
    const on = isChatOpen() && memoryActive();
    const memory = () => (settings().memory ||= {});
    const holder = h('div', { class: 'ri-catchup', 'data-ri-catchup': '' });
    const run = async (work, done) => {
        try { const out = await work(); if (done) toast('success', done(out)); }
        catch (error) { toast('error', error.message); }
        finally { refreshUnderReplies(); paint(); }
    };
    const runner = () => catchUpRunner();
    const catchUpButton = executionAction(button('Catch up this chat', () => run(async () => (await runner()).startTapped(), plan => `Catching up on ${routeWord(plan.route)}. The status line shows each part.`), { kind: 'primary' }), 'Catch-up calls, counted when the route is checked');
    const rebuildButton = executionAction(button('Rebuild from all chat history', () => run(async () => (await runner()).rebuild(), plan => `Rebuilding on ${routeWord(plan.route)}. Undo is on this page until you start something else.`), { kind: 'ghost' }), 'Rebuild calls, counted when the route is checked');
    const win = components.hide && !!chatWorld() && button('Apply to saved chapters now', async () => {
        win.disabled = true;
        try { await applyHistoryWindow(); refreshUnderReplies(); app.render(); }
        catch (error) { toast('error', error.message); }
        finally { win.disabled = false; }
    }, { kind: 'ghost' });

    function continueForm() {
        const wish = h('textarea', { class: 'ri-input', rows: 3, placeholder: 'Optional: what the new chat should open on', 'aria-label': 'What the new chat should open on' });
        const opening = h('input', { type: 'checkbox', 'aria-label': 'Write an opening message too' });
        const secrets = h('input', { type: 'checkbox', 'aria-label': 'Leave secrets out of the book' });
        const go = executionAction(button('Write the synopsis and start', () => run(async () => (await hostCarryOver()).start({ opening: opening.checked, wish: wish.value, leaveSecretsOut: secrets.checked }),
            out => `The new chat is open. The carry-over book "${out.book}" is bound to it, and the old chat is unchanged.`), { kind: 'primary', disabled: !on }), '1 model call (the Writer)');
        return h('details', { class: 'ri-card ri-tight', 'data-ri-continue': '' }, h('summary', {}, 'Continue in a new chat'),
            h('p', { class: 'ri-help' }, ['Starts a fresh chat with the same character. The story’s canon and current state go into a carry-over book bound to the new chat, and the old chat is not changed.', howItWorks('The old chat’s habits stay behind: no message text and no example replies. This is one Writer call.')]),
            wish,
            h('label', { class: 'ri-row' }, opening, 'Write an opening message too'),
            h('label', { class: 'ri-row' }, secrets, 'Leave secrets out of the book'),
            h('p', { class: 'ri-help' }, 'With the extension on, a secret fires only for the characters it names. With it switched off, SillyTavern has no holder rule, so a secret fires by keyword for any character.'),
            go);
    }

    function paint() {
        const plan = catchUpPlan();
        const view = plan ? describe(plan) : null;
        const count = on ? catchUpWaiting() : 0;
        const running = view?.state === 'running';
        const parts = [];
        if (!on) parts.push(h('p', { class: 'ri-muted' }, isChatOpen() ? 'This chat has not moved its memory into chat data yet.' : 'Open a chat.'));
        if (view?.text && view.state !== 'declined') parts.push(h('p', { class: 'ri-note', role: 'status', 'aria-live': 'polite', 'data-ri-catchup-line': '' }, view.text));
        if (view?.ask) {
            const ask = view.ask;
            parts.push(h('div', { class: 'ri-card ri-tight', 'data-ri-catchup-ask': '' },
                h('p', {}, `Catch-up would use ${routeWord(ask.route)}: ${ask.line}.`),
                h('div', { class: 'ri-row' },
                    executionAction(button('Run now', () => run(async () => (await runner()).runNow(), p => `Catching up on ${routeWord(p.route)}.`), { kind: 'primary' }), ask.line),
                    view.state === 'asking' ? button('Wait for the desktop', () => run(async () => (await runner()).waitForDesktop()), { kind: 'ghost' }) : null,
                    button('Not now', () => run(async () => (await runner()).notNow()), { kind: 'ghost' }))));
        }
        if (running) parts.push(button('Cancel', () => run(async () => (await runner()).cancel(), () => 'Catch-up cancelled. What was filed stays.'), { kind: 'ghost' }));
        if (view?.resume) parts.push(executionAction(button('Resume', () => run(async () => (await runner()).resume()), { kind: 'primary' }), 'The remaining map calls'));
        if (view?.undo) parts.push(button('Undo rebuild', () => run(async () => (await runner()).undoRebuild(), out => (out.undone ? `Rebuild undone: ${out.restored} earlier records are back.` : out.reason)), { kind: 'ghost' }));
        if (!running) {
            catchUpButton.disabled = !on || count === 0;
            rebuildButton.disabled = !on || !(ctx().chat || []).some((m, i) => i > 0 && m && !m.is_user && !m.is_system);
            parts.push(h('div', { class: 'ri-row' }, catchUpButton),
                h('p', { class: 'ri-help' }, count ? `${count} ${count === 1 ? 'exchange is' : 'exchanges are'} not in memory yet. Catch-up files them in order and resumes if the app closes.` : 'Every reply is in memory.'),
                h('div', { class: 'ri-row' }, rebuildButton),
                h('p', { class: 'ri-help' }, 'Retires every record a model made in one entry, then catches up from the first message. Your locked records and edits stay, and Undo is one tap.'));
        }
        parts.push(h('div', { class: 'ri-row', 'data-ri-catchup-free': '' }, h('span', {}, 'Catch up by itself on free routes'), toggle(memory().catchUpFree !== false, value => { memory().catchUpFree = value; saveSettings(); }, 'Catch up by itself on free routes')),
            h('p', { class: 'ri-help' }, 'On: a chat that opens with 20 or more exchanges not in memory starts catch-up by itself when your desktop, your NanoGPT plan or an on-phone model can do it well. Off, or when none can, it asks first with the route, the calls, the time and the cost.'),
            form, win || null);
        holder.replaceChildren(...parts.filter(Boolean));
        gateModelButtons(holder);
        refreshCosts();
    }

    /** Fill the Cost chips from the route check (no model call): calls, time and cost on the route a tap would use. */
    async function refreshCosts() {
        if (!on) return;
        try {
            const r = await runner();
            const seen = await r.assess({});
            catchUpButton.dataset.riModelCost = tapPlan(seen).line;
            const all = await r.assess({ rebuild: true });
            rebuildButton.dataset.riModelCost = tapPlan(all).line;
        } catch { /* the chips keep their placeholder text */ }
    }

    // the Continue form is built once, so a repaint while you type keeps its text, its checkboxes and whether it is open
    const form = continueForm();
    paint();
    if (on) runner().then(r => { const off = r.onChange(() => { if (!holder.isConnected) off(); else paint(); }); }).catch(() => {});
    return home('catch-up', section('This chat',
        h('p', { class: 'ri-help' }, 'Reads the replies memory has not filed yet, in order, and writes records and chapters from them. Chapters then hide the messages they cover, as the Chapters settings say.'),
        components.chapters ? null : h('p', { class: 'ri-note' }, 'Chapter summaries are off for this chat, so catch-up files records and the chapters it writes do not hide messages until you turn them on.'),
        holder));
}

/**
 * Setup, Memory: every memory setting in one place. Recall, Budgets, Upkeep and the "This chat" block.
 * The Story, Story World page and Review, Context link here and keep none of these controls.
 */
export function renderMemory(body, app) {
    const st = settings(), o = st.summary;
    const components = memoryComponents();
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
    const control=(key,label,hint,value)=>field(label,hint,select([{value:'on',label:'On'},{value:'off',label:'Off'}],value?'on':'off',next=>{setMemoryComponent(key,next==='on');save();},{'aria-label':label,disabled:!isChatOpen() || key==='hide' && !components.chapters}));

    const recall = section('Recall',
        h('p',{class:'ri-help'},'Memory switches apply to this chat; thresholds, history windows and budgets are extension-wide defaults.'),
        isChatOpen() && !chatWorld() && h('div',{class:'ri-note ri-note-warn'},
            'Chapter settings are saved. Automatic summaries and hiding are paused until this chat has a Story World.',
            button('Open Story World, World Info',()=>app.openPage('books',{anchor:'#ri-world-create'}),{kind:'ghost'})),
        otherSummaryOn() && components.chapters && h('p',{class:'ri-note ri-note-warn'},'SillyTavern’s own Summarize also adds a summary. Choose the summary source in Setup.'),
        control('world','World Info recall','Include the pinned Base World and relevant Story World entries. World Info remains under SillyTavern control.',components.world),
        control('chapters','Chapter summaries','Write and recall chapter summaries. Each new chapter uses one model call.',components.chapters),
        control('hide','Exclude summarized messages from prompts','Enable Chapter summaries first. Only saved chapters can hide messages.',components.hide),
        ...storyNotesFields(app),
        field('Protect recent history by','Choose how to size the full-text window for covered history. The opening and unsummarized messages stay available.',
            select([{value:'messages',label:'Message count'},{value:'tokens',label:'Estimated tokens'}],historyUnit,
                value=>{o.historyUnit=value;save();},{'aria-label':'Protect recent history by'})),
        field(label, useTokens ? 'Keeps whole messages inside the estimated budget and always protects the newest two story messages.'
            : 'Protects this many recent story messages.',
            h('div', {class:'ri-context-slider'}, range, amount, h('span', {class:'ri-unit'},historyUnit)), preview));
    recall.id='ri-memory-settings';

    const budgets = section('Budgets',
        h('p',{class:'ri-help'},'Approximate token room for each part of the memory sent with a reply.'),
        h('div', {class:'ri-grid2'},
            storyNotesBudget(app),
            numeric('Chapter notes budget', o.budget, 100, 6000, 'tokens', n => {o.budget=n;}, 'Approximate text budget for the story so far.'),
            home('state-budget', field('Current state prompt budget','Approximate room for scene and character state; lines that do not fit are left out.',
                numberInput(st.cards.stateBudget || 350,{min:100,max:1000,unit:'tokens',label:'Current state prompt budget'},value=>{st.cards.stateBudget=value;saveSettings();})))),
        slot(['stateContext'],'Customize current-state guidance'));
    budgets.id='ri-memory-budgets';

    const upkeep = section('Upkeep',
        ...worldUpkeepFields(app),
        worldUpdatePrompts(),
        field('Earlier replies kept editable',
            editableReplySlots() ? `The Story World book holds filed facts; recent changes appear in reply cards and Recall. ${editableReplySlots()} editable slots in total.`
                : 'Automatic Story World changes file as soon as a reply is accepted.',
            select([{value:'-1',label:'File immediately'},...Array.from({length:21},(_,n)=>({value:String(n),label:String(n)}))],
                String(editableReplySlots()-1), value=>{st.world.editableReplies=Number(value);save();},
                {'aria-label':'Earlier replies kept editable'})),
        h('details',{class:'ri-card ri-tight'},h('summary',{},'Chapter organization'),
            field('Move finished records into chapters','Keeps completed threads and events with the chapter that covers them.',
                choose(o.retire!==false,value=>{o.retire=value;})),
            numeric('Recent chapters eligible for full recall',o.keep,1,10,'chapters',n=>{o.keep=n;},'The chapter budget also limits recall.'),
            numeric('Combine older chapters when there are more than',o.roll,2,50,'chapters',n=>{o.roll=n;},'Combining follows the saved automatic request setting.')),
        h('div',{class:'ri-row'},
            button('Chapter summary connection & automatic requests',()=>app.openSetting('settings','ri-operation-chapterSummary'),{kind:'ghost'}),
            button('Chapter combine connection & automatic requests',()=>app.openSetting('settings','ri-operation-chapterCombine'),{kind:'ghost'})),
        h('div', {class:'ri-grid2'},
            field('Write a chapter when the scene ends', 'Requires Story World updates and at least the minimum number of replies.', choose(o.onSceneEnd !== false, v => {o.onSceneEnd=v;})),
            numeric('Minimum replies for a scene-end chapter', o.minReplies, 1, 100, 'replies', n => {o.minReplies=n;}, 'A reply is a model message.'),
            numeric('Write a chapter at least every', o.every, 0, 200, 'replies', n => {o.every=n;}, 'Set 0 to disable the reply-count threshold.'),
            numeric('Summarize at estimated tokens',o.everyTokens || 0,0,1000000,'tokens',n=>{o.everyTokens=n;},
                'After an accepted reply, a chapter is written when unsummarized text reaches this estimate. Set 0 to turn the token threshold off.')),
        isChatOpen() && Number(o.every) > 0 ? (() => { const c = chapterPreview(Number(o.every)); return h('div', {class:'ri-help'}, `The latest ${c.replies} model replies and their surrounding messages contain about ${number(c.tokens)} tokens across ${c.messages} messages. This is a preview of recent text, not the exact next chapter.`); })() : null,
        homeLink(app,'write-chapter','Write a chapter now is in Story, Story World, The story so far.'));
    upkeep.id='ri-memory-upkeep';

    body.append(recall, budgets, upkeep);
    if (isChatOpen()) body.append(historyTools(app, components));
}

/** Review, Context: what this chat sends now. Memory settings and chapter actions live in Setup, Memory and Story, Story World. */
export function renderContext(body, app) {
    const st=settings(), o=st.summary;
    const historyUnit=o.historyUnit==='tokens' ? 'tokens' : 'messages';
    const target=Number(historyUnit==='tokens' ? o.keepTokens : o.keepShown) || (historyUnit==='tokens' ? 8000 : 30);
    const hasWorld=isChatOpen() && !!chatWorld();
    const filing=filingStatus();
    const retryFiling=button('Retry filing',async()=>{
        retryFiling.disabled=true;
        try { await refileStory();refreshUnderReplies();app.render(); }
        catch(error) { toast('error',error.message); }
        finally { retryFiling.disabled=false; }
    },{kind:'ghost'});
    const memorySection=section('Memory status',
        h('p',{class:'ri-help'},'What memory filed for this chat and what the next request holds.'),
        hasWorld && h('p',{class:'ri-help',role:'status'},`Filed through reply ${filing.filed} · ${filing.pending} editable records with changes · ${filing.uncertain} replies need review.`),
        filing.error && h('div',{class:'ri-note ri-note-warn',role:'status'},filing.error,retryFiling),
        homeLink(app,'catch-up','Memory settings, catch up and rebuild are in Setup, Memory.'),
        hasWorld && homeLink(app,'write-chapter','Write a chapter now is in Story, Story World, The story so far.'));
    memorySection.id='ri-memory-status';
    body.append(memorySection);
    if (!isChatOpen()) return;
    const p = historyPreview(target,historyUnit), last = lastContext();
    body.appendChild(section('This chat now', h('div', {class:'ri-context-grid'},
        row('Story messages', number(p.total), 'Includes messages hidden from the AI.'),
        row('Currently visible', number(p.open), 'SillyTavern may omit more when assembling a request.'),
        row('Exclude from prompts', number(p.hidden), 'Still readable in the chat.'))));
    const content = [];
    if (!hasEvent('CHAT_COMPLETION_PROMPT_READY')) content.push(h('div', {class:'ri-note ri-note-warn'}, 'SillyTavern does not expose the assembled chat-completion prompt. A last-request breakdown is unavailable.'));
    else if (!last) content.push(h('div', {class:'ri-note'}, 'No assembled chat-completion request has been observed in this chat since opening or reloading the app. Send a reply to see its breakdown.'));
    else {
        const metric = (name, data) => row(name, data.chars ? approx(data.tokens) : (data.unmatched ? 'Not recognized' : 'None recognized'), data.unmatched ? `${number(data.unmatched)} prepared passage${data.unmatched === 1 ? '' : 's'} could not be matched; the actual amount may be higher.` : 'Recognized text only.');
        content.push(h('div', {class:'ri-context-grid'},
            row('Whole request', approx(last.total), 'All visible text in the assembled request; excludes model-specific overhead.'),
            row('Recent conversation recognized', `${number(last.history.count)} messages · ${approx(last.history.tokens)}`, last.history.unmatched ? `${number(last.history.unmatched)} visible chat messages were not matched; they may have been omitted, trimmed or reformatted.` : 'Full messages recognized in the request.'),
            metric('Story World notes', last.notes), metric('Chapter summaries', last.chapters), metric('Recalled World Info and structured records',last.lore),
            metric('Story events and world orders', last.events), metric('Other extension instructions', last.other), metric('Scene, state and update instructions', last.updates)));
        if (last.unsupportedContent) content.push(h('div', {class:'ri-note ri-note-warn'}, 'The request contains non-text content, which is not included in these estimates.'));
        content.push(h('div', {class:'ri-help'}, ['This is the last request observed in this session, not a prediction of the next reply.', howItWorks('Matching can miss text changed by a preset or another extension, and categories are partial, so they do not add up to the total. SillyTavern or the provider may change the request afterward. Text is estimated at roughly four characters per token, so counts vary by model and language.')]));
    }
    body.appendChild(section('Last observed request', ...content));
    const mem = lastLayout();
    if (mem) {
        const at = (index, what) => index >= 0 ? `Message ${number(index + 1)} · ${approx(mem.layout.tokens[what] || 0)}` : 'Not in the request';
        body.appendChild(section('Memory in the last request',
            mem.cut.length ? h('div', {class:'ri-note ri-note-problem', role:'status'}, `SillyTavern cut the ${mem.cut.join(' and the ')} to fit the context size of ${number(mem.size?.context || 0)} tokens. Raise the context size or lower the chapter view and recall sizes in Setup, Memory.`) : null,
            h('div', {class:'ri-context-grid'},
                row('Memory notes', mem.layout.instruction >= 0 ? `Message ${number(mem.layout.instruction + 1)}` : 'Not in the request', 'The fixed rules about records, at the end of the main prompt.'),
                row('Chapter view', at(mem.layout.view, 'view'), 'Directly above the chat history; it changes only when a chapter closes.'),
                row('Recall block', at(mem.layout.recall, 'recall'), 'Above your last message (depth 1).'),
                row('First changed message', mem.cache ? `${number(mem.cache.firstChanged + 1)} of ${number(mem.cache.messages)}` : 'First request of this chat', mem.cache ? `About ${approx(mem.cache.lostTokens)} after it were sent again uncached. ${mem.cache.followsHistory ? 'The change follows the history.' : 'The change starts above the history: a chapter closed, or something above the history changed.'}` : ''),
                row('Model size', `${mem.size?.key || 'mid'}`, mem.size?.manual ? 'Chosen in Setup, Memory.' : `From the context size of ${number(mem.size?.context || 0)} tokens.`))));
    }
    const holder = h('div', { id: 'ri-next-preview' }, h('div', { class: 'ri-muted' }, 'Loading…'));
    body.appendChild(holder);
    nextReplyPreview(chatWorld()).then(node => holder.replaceChildren(node)).catch(error => holder.replaceChildren(h('div', { class:'ri-empty' }, error.message)));
}
