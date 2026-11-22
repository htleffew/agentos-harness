// The Log tab: every request made to the AI, newest first, with what was sent and what came back.
import { h, button, foldCard, chip, download, textInput, select } from './dom.js';
import { logEntries, clearLog, logText, logTime, logStatus } from '../log.js';
import { executionScope } from '../execution.js';
import { guidedTarget } from '../guided-context.js';
import { taskLabels } from './destinations.js';

export function renderLog(body,app) {
    const list = logEntries();
    const status=h('p',{class:'ri-help',id:'ri-log-feedback',role:'status',tabIndex:-1},app.logStatus || '');
    const report=text=>{
        app.logStatus=text;
        const current=app.body?.querySelector('#ri-log-feedback');
        if (current) current.textContent=text;
    };
    function redrawLog(focus) {
        app.render();
        const control=app.body.querySelector(focus);
        (control?.disabled ? app.body.querySelector('#ri-log-feedback') : control)?.focus();
    }
    const review=app.logClearReviewed;
    const clear=button('Clear the log',()=>{
        app.logClearReviewed=logEntries();
        redrawLog('#ri-keep-log');
    },{kind:'ghost',disabled:!list.length || !!review});
    clear.id='ri-clear-log';
    const keep=review && button('Keep the log',()=>{
        app.logClearReviewed=null;
        redrawLog('#ri-clear-log');
    });
    if (keep) keep.id='ri-keep-log';
    const confirmation=review && h('div',{class:'ri-note ri-note-warn',role:'group','aria-label':'Confirm clear request log'},
        h('p',{},`Clear ${review.length===1?'1 saved request log entry':`all ${review.length} saved request log entries`} from this device?`),
        h('div',{class:'ri-row'},keep,button('Confirm clear',()=>{
            app.logClearReviewed=null;
            const current=logEntries();
            if (current.length===review.length && current.every((entry,index)=>entry===review[index])) {
                clearLog();
                report(`Cleared ${review.length} request log ${review.length===1?'entry':'entries'}.`);
            } else report('The log changed while you reviewed it. Open Clear the log again to see the current count.');
            redrawLog('#ri-clear-log');
        },{kind:'primary'})));
    body.appendChild(h('div', { class: 'ri-intro' }, 'See what the extension sent, what came back, and why a request failed. The last 120 entries stay on this device.'));
    body.appendChild(h('div', { class: 'ri-row' },
        button('Copy the log', async () => {
            const text = logText();
            try { await navigator.clipboard.writeText(text); report('Copied the complete request log.'); }
            catch {
                report(download('roleplay-instructions-log.txt', text)
                    ? 'Clipboard access is unavailable. A log download was requested.' : 'The log could not be copied or saved.');
            }
        }, { kind: 'ghost', disabled: !list.length }),
        button('Save the log as a file', () => {
            report(download('roleplay-instructions-log.txt',logText()) ? 'Requested a download of the complete log.' : 'The file could not be saved.');
        }, { kind: 'ghost', disabled: !list.length }),
        clear),confirmation,status);
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
