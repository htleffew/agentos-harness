// The Log tab: every request made to the AI, newest first, with what was sent and what came back.
import { h, button, foldCard, chip, download, textInput, select } from './dom.js';
import { logEntries, clearLog, logText, logTime, logStatus } from '../log.js';
import { toast, confirmBox } from '../st.js';
import { executionScope } from '../execution.js';
import { guidedTarget } from '../guided-context.js';
import { taskLabels } from './destinations.js';

export function renderLog(body,app) {
    const list = logEntries();
    const status=h('p',{class:'ri-help',role:'status'});
    body.appendChild(h('div', { class: 'ri-intro' }, 'Every time this extension asks the AI for something (writing versions, items or a goal, and checking a reply), it is written down here with what was sent, what came back and, when it failed, why. The log stays on this device. It keeps the last 120 requests.'));
    body.appendChild(h('div', { class: 'ri-row' },
        button('Copy the log', async () => {
            const text = logText();
            try { await navigator.clipboard.writeText(text); status.textContent='Copied the complete request log.'; }
            catch { if (download('roleplay-instructions-log.txt', text)) toast('info', 'Copying is not allowed here, so the log was saved as a file.'); else toast('error', 'The log could not be copied or saved.'); }
        }, { kind: 'ghost', disabled: !list.length }),
        button('Save the log as a file', () => {
            status.textContent=download('roleplay-instructions-log.txt',logText()) ? 'Requested a download of the complete log.' : 'The file could not be saved.';
        }, { kind: 'ghost', disabled: !list.length }),
        button('Clear the log', async () => {
            const reviewed=logEntries();
            if (!await confirmBox(`Clear all ${reviewed.length} saved request log entries from this device?`)) return;
            const current=logEntries();
            if (current.length===reviewed.length && current.every((entry,index)=>entry===reviewed[index])) clearLog();
            else status.textContent='The log changed while you reviewed it. Open Clear the log again to see the current count.';
        }, { kind: 'ghost', disabled: !list.length })),status);
    if (!list.length) {
        body.appendChild(h('div', { class: 'ri-empty' }, 'The log is empty. It fills in when you press one of the "with AI" buttons, or when a reply is checked.'));
        return;
    }
    const records=h('div',{class:'ri-list'});
    const summary=h('p',{class:'ri-help',role:'status'});
    const query=textInput(app.logQuery || '',value=>{app.logQuery=value;filter();},{type:'search','aria-label':'Search request log',placeholder:'Search by operation or result'});
    const outcome=select(['All outcomes','Completed','Failed','Other'].map((label,index)=>({label,value:String(index)})),
        app.logOutcome || '0',value=>{app.logOutcome=value;filter();},{'aria-label':'Request outcome'});
    function filter() {
        const words=query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const rows=list.filter(entry=>{
            const state=entry.ok===true ? '1' : entry.ok===false ? '2' : '3';
            return (outcome.value==='0' || outcome.value===state) &&
                words.every(word=>`${entry.what} ${entry.result || ''}`.toLowerCase().includes(word));
        });
        summary.textContent=rows.length ? `Showing ${rows.length} of ${list.length} logged requests.` : 'No requests match. Clear the search or change the outcome.';
        records.replaceChildren(...rows.map(renderEntry));
    }
    body.append(h('div',{class:'ri-row'},query,outcome),summary,records);
    filter();
    function renderEntry(e) {
        const target=e.reply?.scope===executionScope() && guidedTarget(e.reply.index);
        const exact=target && target.swipe===e.reply.swipe && target.fingerprint===e.reply.fingerprint;
        const state = chip(logStatus(e),e.ok===true ? 'ri-chip-done' : e.ok===false ? 'ri-chip-warn' : 'ri-chip-group');
        return foldCard(
            [h('span', { class: 'ri-log-head' }, h('span', { class: 'ri-log-what' }, e.what), state), h('span', { class: 'ri-muted' }, logTime(e.time)), e.result ? h('span', { class: e.ok === false ? 'ri-log-fail' : 'ri-log-result' }, e.result) : null],
            [
                e.details.length ? h('ul', { class: 'ri-log-list' }, e.details.map(d => h('li', {}, d))) : null,
                e.sent ? h('div', { class: 'ri-log-label' }, 'What was sent') : null,
                e.sent ? h('pre', { class: 'ri-pre' }, e.sent) : null,
                (e.sent || e.got) ? [h('div', { class: 'ri-log-label' }, 'What came back'),
                    h('pre', { class: 'ri-pre' }, e.got || '(nothing)')] : null,
                exact && button(taskLabels.review,()=>app.openPage('sent',{reply:target,anchor:`#ri-review-reply-${target.index}`,focusPage:true}),{kind:'ghost'}),
            ],
            { cls: e.ok === false ? 'ri-log-failed' : '' });
    }
}
