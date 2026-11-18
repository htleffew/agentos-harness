import { h, field, section, select } from './dom.js';
import { settings, saveSettings } from '../store.js';
import { isChatOpen, hasEvent } from '../st.js';
import { chatWorld } from '../world.js';
import { historyPreview, chapterPreview, lastContext } from '../context-budget.js';

const number = n => Number(n || 0).toLocaleString();
const approx = n => `~${number(n)} tokens`;
const row = (name, value, help = '') => h('div', { class: 'ri-context-metric' }, h('div', { class: 'ri-context-metric-label' }, name), h('strong', {}, value), help ? h('div', { class: 'ri-help' }, help) : null);

export function renderContext(body, app) {
    const st = settings(), o = st.summary;
    const save = () => { saveSettings(); setTimeout(() => app.render(), 0); };
    const choose = (value, set) => select([{value:'on', label:'On'}, {value:'off', label:'Off'}], value ? 'on' : 'off', v => { set(v === 'on'); save(); });
    const numeric = (label, value, min, max, unit, changed, help) => {
        const input = h('input', { type: 'number', class: 'ri-input ri-input-num', min, max, value, 'aria-label': label, onchange: () => {
            const n = Math.max(min, Math.min(max, Math.round(Number(input.value) || min))); input.value = n; changed(n); save();
        }});
        return field(label, help, h('span', { class:'ri-num' }, input, h('span', {class:'ri-unit'}, unit)));
    };
    const target = Math.max(4, Math.min(400, Number(o.keepShown) || 30));
    const range = h('input', { type:'range', min:4, max:400, step:1, value:target, 'aria-label':'Recent messages to protect', class:'ri-context-range' });
    const amount = h('input', { type:'number', min:4, max:400, value:target, 'aria-label':'Recent messages to protect (number)', class:'ri-input ri-input-num' });
    const preview = h('div', { class:'ri-context-preview', role:'status' });
    function show(n) {
        const p = historyPreview(n);
        preview.textContent = isChatOpen() ? `In this chat, the newest ${p.count} story messages contain ${approx(p.tokens)} of text. The opening message is kept separately.` : 'Open a chat to estimate its recent message text.';
    }
    function setTarget(raw) {
        const n = Math.max(4, Math.min(400, Math.round(Number(raw) || 4)));
        range.value = amount.value = String(n); o.keepShown = n; saveSettings(); show(n);
    }
    range.addEventListener('input', () => setTarget(range.value));
    amount.addEventListener('change', () => setTarget(amount.value));
    show(target);
    const hasWorld = isChatOpen() && !!chatWorld();
    body.appendChild(section('Conversation and memory',
        h('div', { class:'ri-help' }, 'The preset’s Chat History includes the messages still visible to the AI. Chapters summarize older story, and the extension can hide the messages they cover. Keep Chat History enabled to include the recent conversation.'),
        isChatOpen() && !hasWorld ? h('div', {class:'ri-note ri-note-warn'}, 'This chat has no Story World. Select or create one in Story World before automatic chapter summaries and hiding can work.') : null,
        field('Keep the story so far in chapters', 'Each new chapter uses one AI request. A successful chapter is stored in the Story World.', choose(o.on !== false, v => {o.on=v;})),
        h('div', {class:'ri-grid2'},
            field('Write a chapter when the scene ends', 'Requires Story World updates and at least the minimum number of replies.', choose(o.onSceneEnd !== false, v => {o.onSceneEnd=v;})),
            numeric('Minimum replies for a scene-end chapter', o.minReplies, 1, 100, 'replies', n => {o.minReplies=n;}, 'A reply is a model message.'),
            numeric('Write a chapter at least every', o.every, 0, 200, 'replies', n => {o.every=n;}, '0 disables this timer; scene-end and manual chapters still work.'),
            field('Hide messages covered by a chapter', 'Hidden messages remain readable in the chat. Only successfully saved chapters can hide messages.', choose(o.hide !== false, v => {o.hide=v;}))),
        isChatOpen() && Number(o.every) > 0 ? (() => { const c = chapterPreview(Number(o.every)); return h('div', {class:'ri-help'}, `The latest ${c.replies} model replies and their surrounding messages contain about ${number(c.tokens)} tokens across ${c.messages} messages. This is a preview of recent text, not the exact next chapter.`); })() : null,
        field('Recent messages to protect', 'The newest messages and the opening message are not hidden by this feature. This is a minimum, not a hard cap: unsummarized messages and messages added between chapter writes remain visible. Changes take effect when a later chapter is written; increasing this number does not automatically unhide older messages.',
            h('div', {class:'ri-context-slider'}, range, amount, h('span', {class:'ri-unit'}, 'messages')), preview),
        h('div', {class:'ri-grid2'},
            numeric('Story World notes budget', st.world.budget, 100, 4000, 'tokens', n => {st.world.budget=n;}, 'Approximate text budget for relevant story facts.'),
            numeric('Chapter notes budget', o.budget, 100, 6000, 'tokens', n => {o.budget=n;}, 'Approximate text budget for the story so far.'))));
    if (!isChatOpen()) return;
    const p = historyPreview(target), last = lastContext();
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
            metric('Story World notes', last.notes), metric('Chapter summaries', last.chapters), metric('Story events and world orders', last.events), metric('Other extension instructions', last.other), metric('Scene, state and update instructions', last.updates)));
        if (last.unsupportedContent) content.push(h('div', {class:'ri-note ri-note-warn'}, 'The request contains non-text content, which is not included in these estimates.'));
        content.push(h('div', {class:'ri-help'}, 'This is the last assembled request observed in this session, not a prediction of the next reply. Matching can miss text changed by a preset or another extension. Categories are partial and do not add up to the total. The host or provider may change the request afterward. Text is estimated at roughly four characters per token, so actual counts vary by model and language.'));
    }
    body.appendChild(section('Last observed request', ...content));
}
