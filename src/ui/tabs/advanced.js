// Advanced tab: suite on/off, settings (connection profile, timeout, prompt editor, debug),
// background job status, payload preview.

import { h, icon, call, settle, setText, scrollWithin } from '../dom.js';
import { entriesForTab, payloadModel, formatTokens } from '../model.js';
import { renderSettings } from './common.js';
import { panel, switchEl, setSwitch, callout } from '../controls.js';
import { createPromptEditor } from './prompts.js';

const JOBS = [
    { kind: 'showrunner', label: 'Showrunner', icon: 'fa-clapperboard' },
    { kind: 'memory_summary', label: 'Memory summary', icon: 'fa-memory' },
    { kind: 'seed_profile', label: 'Seed profile', icon: 'fa-seedling' },
];

export function createAdvancedTab(ctx) {
    const el = h('div', { class: 'uc2-tab-body' });

    // Suite on/off
    const sw = switchEl(true, 'Undercurrent active');
    const suiteRow = h('div', { class: 'uc2-row uc2-toggle-row uc2-row-hero is-on' },
        h('div', { class: 'uc2-row-text' },
            h('div', { class: 'uc2-row-label' }, icon('fa-power-off', 'uc2-row-icon'), 'Undercurrent active'),
            h('div', { class: 'uc2-row-help' }, 'Off pauses the suite: static rules stay, the per-turn block is left empty, no background jobs run. Same as /uc-off.')),
        sw);
    const paintSuite = on => { setSwitch(sw, on); suiteRow.classList.toggle('is-on', on); };
    const flipSuite = e => {
        e?.stopPropagation();
        const on = sw.getAttribute('aria-checked') !== 'true';
        paintSuite(on);
        call(ctx.api, 'setActive', on);
        ctx.onActive?.(on);
    };
    suiteRow.addEventListener('click', flipSuite);
    sw.addEventListener('click', flipSuite);
    el.appendChild(suiteRow);

    // Schema-driven settings (everything on this tab is visible; prompt editor sections included)
    const entries = entriesForTab(ctx.schema, 'advanced');
    const controls = renderSettings(el, entries, ctx, { tabId: 'advanced' });

    // Jobs
    const jobState = h('div', { class: 'uc2-job-state' });
    const jobErr = h('div', { class: 'uc2-job-error', hidden: true });
    const runBtns = JOBS.map(j => {
        const b = h('button', { class: 'uc2-btn uc2-btn-sm', type: 'button' }, icon(j.icon), j.label);
        b.addEventListener('click', () => { call(ctx.api, 'runJob', j.kind); refreshJobs(); });
        return b;
    });
    el.appendChild(panel('Background jobs', 'fa-list-check',
        h('p', { class: 'uc2-panel-note' }, 'Jobs run one at a time, only after a reply, and step aside when you send.'),
        jobState, jobErr, h('div', { class: 'uc2-btn-row' }, runBtns)));

    async function refreshJobs() {
        const st = await settle(() => call(ctx.api, 'jobStatus'), null);
        const running = st?.running;
        jobState.replaceChildren(
            h('span', { class: ['uc2-mini-pill', running ? 'uc2-mini-ai' : 'uc2-mini-live'] },
                icon(running ? 'fa-spinner' : 'fa-circle-check', running ? 'fa-spin' : ''), running ? `Running: ${running}` : 'Idle'),
            h('span', { class: 'uc2-mini-pill' }, `${Number(st?.queued) || 0} queued`));
        const err = st?.lastError ? String(st.lastError?.message ?? st.lastError) : '';
        jobErr.hidden = !err;
        setText(jobErr, err ? `Last error: ${err}` : '');
    }

    // Payload preview
    const previewHost = h('div', { class: 'uc2-payload' });
    const previewMeta = h('span', { class: 'uc2-panel-note' });
    const buildBtn = h('button', { class: 'uc2-btn uc2-btn-dev', type: 'button' }, icon('fa-code'), 'Build preview');
    const copyBtn = h('button', { class: 'uc2-btn uc2-btn-sm', type: 'button', hidden: true }, icon('fa-copy'), 'Copy');
    let lastText = '';
    buildBtn.addEventListener('click', () => buildPreview());
    copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(lastText); setText(previewMeta, 'Copied.'); } catch { setText(previewMeta, 'Copy failed.'); }
    });
    const previewPanel = panel(null, null,
        h('div', { class: 'uc2-panel-head' }, h('h3', { class: 'uc2-panel-title' }, icon('fa-code'), 'Payload preview'), h('span', { class: 'uc2-mini-pill uc2-mini-ai' }, 'Dev')),
        callout('purple', 'fa-flask', null, 'A dry run of the next request with your current settings. Nothing is sent.'),
        h('div', { class: 'uc2-btn-row' }, buildBtn, copyBtn, previewMeta),
        previewHost);
    previewPanel.id = 'uc2-payload-panel';
    el.appendChild(previewPanel);

    const prompts = createPromptEditor(ctx.api);
    if (prompts) el.appendChild(prompts.el);

    async function buildPreview() {
        buildBtn.disabled = true;
        setText(previewMeta, 'Building…');
        const payload = await settle(() => call(ctx.api, 'previewPayload'), null);
        buildBtn.disabled = false;
        const msgs = payloadModel(payload);
        if (!msgs.length) { setText(previewMeta, 'No preview available (is a chat open?).'); previewHost.replaceChildren(); copyBtn.hidden = true; return; }
        lastText = msgs.map(m => `===== [${m.role.toUpperCase()}] =====\n${m.content}`).join('\n\n');
        const total = msgs.reduce((a, m) => a + m.chars, 0);
        setText(previewMeta, `${msgs.length} messages · ~${formatTokens(total / 3.5)} tokens`);
        copyBtn.hidden = false;
        previewHost.replaceChildren(...msgs.map(m => h('details', { class: `uc2-msg uc2-role-${m.roleClass}` },
            h('summary', {},
                h('span', { class: 'uc2-role' }, m.role),
                h('span', { class: 'uc2-msg-preview' }, m.preview),
                h('span', { class: 'uc2-msg-chars' }, `${m.chars.toLocaleString()} ch`)),
            h('pre', { class: 'uc2-pre' }, m.content))));
    }

    return {
        el,
        refresh(settings) { for (const c of controls) c.update(settings); prompts?.refresh(); },
        onShow() { refreshJobs(); paintSuite(call(ctx.api, 'isActive') !== false); prompts?.show(); },
        onJobs() { refreshJobs(); },
        showPayload() {
            scrollWithin(previewPanel, previewPanel.closest('.uc2-scroll'), { axis: 'y', align: 'start', smooth: true });
            if (!previewHost.childElementCount) buildPreview();
        },
        isActive: () => call(ctx.api, 'isActive') !== false,
    };
}
