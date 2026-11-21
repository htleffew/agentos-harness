// The Log tab: every request made to the AI, newest first, with what was sent and what came back.
import { h, button, foldCard, chip, download } from './dom.js';
import { logEntries, clearLog, logText, logTime, logStatus } from '../log.js';
import { toast, confirmBox } from '../st.js';

export function renderLog(body) {
    const list = logEntries();
    body.appendChild(h('div', { class: 'ri-intro' }, 'Every time this extension asks the AI for something (writing versions, items or a goal, and checking a reply), it is written down here with what was sent, what came back and, when it failed, why. The log stays on this device. It keeps the last 120 requests.'));
    body.appendChild(h('div', { class: 'ri-row' },
        button('Copy the log', async () => {
            const text = logText();
            try { await navigator.clipboard.writeText(text); toast('success', 'The log was copied.'); }
            catch { if (download('roleplay-instructions-log.txt', text)) toast('info', 'Copying is not allowed here, so the log was saved as a file.'); else toast('error', 'The log could not be copied or saved.'); }
        }, { kind: 'ghost', disabled: !list.length }),
        button('Save the log as a file', () => { if (!download('roleplay-instructions-log.txt', logText())) toast('error', 'The file could not be saved.'); }, { kind: 'ghost', disabled: !list.length }),
        button('Clear the log', async () => { if (await confirmBox('Clear the whole log?')) clearLog(); }, { kind: 'ghost', disabled: !list.length })));
    if (!list.length) {
        body.appendChild(h('div', { class: 'ri-empty' }, 'The log is empty. It fills in when you press one of the "with AI" buttons, or when a reply is checked.'));
        return;
    }
    for (const e of list) {
        const state = chip(logStatus(e),e.ok===true ? 'ri-chip-done' : e.ok===false ? 'ri-chip-warn' : 'ri-chip-group');
        body.appendChild(foldCard(
            [h('span', { class: 'ri-log-head' }, h('span', { class: 'ri-log-what' }, e.what), state), h('span', { class: 'ri-muted' }, logTime(e.time)), e.result ? h('span', { class: e.ok === false ? 'ri-log-fail' : 'ri-log-result' }, e.result) : null],
            [
                e.details.length ? h('ul', { class: 'ri-log-list' }, e.details.map(d => h('li', {}, d))) : null,
                e.sent ? h('div', { class: 'ri-log-label' }, 'What was sent') : null,
                e.sent ? h('pre', { class: 'ri-pre' }, e.sent) : null,
                (e.sent || e.got) ? [h('div', { class: 'ri-log-label' }, 'What came back'),
                    h('pre', { class: 'ri-pre' }, e.got || '(nothing)')] : null,
            ],
            { cls: e.ok === false ? 'ri-log-failed' : '' }));
    }
}
