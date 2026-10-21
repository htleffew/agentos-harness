// Reply card: hides the envelope's display anchor under every AI message (always) and, when the card
// setting is on, appends a closed "Behind the scenes" fold-out drawn from that message's raw `mes`.
// Pure function of `mes` (stamped by hash), so swipes/edits just redraw. Never runs while streaming,
// never touches a message being edited.
//
// ST 1.18 renders the preset's display regex output `<details class="uc-env-src">` through DOMPurify
// with a hook that prefixes every class with `custom-` (public/scripts/chats.js:1920-1929), so the DOM
// anchor is `details.custom-uc-env-src`. style.css hides both spellings with no JS needed.

import { h, icon, call } from './dom.js';
import { cardModel, parseEnvelopeFallback, hashStr, getPath, entriesForTab } from './model.js';
import { onStEvents, isStreaming, rawMessage } from './st-adapter.js';

const ANCHOR_SEL = 'details.custom-uc-env-src, details.uc-env-src';
const REFRESH_MS = 100;
const ST_EVENTS = ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED',
    'MORE_MESSAGES_LOADED', 'CHAT_CHANGED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_DELETED'];

let parserPromise = null;
/** CORE's pure parser (extension/src/envelope/parse.js) when present; the local fallback otherwise. */
export function loadParser() {
    if (!parserPromise) {
        parserPromise = import(new URL('../envelope/parse.js', import.meta.url).href)
            .then(m => {
                const fn = m.parseEnvelope || m.parse || m.default;
                return typeof fn === 'function' ? (text => { try { return fn(text) || { ok: false, blocks: [] }; } catch { return parseEnvelopeFallback(text); } }) : parseEnvelopeFallback;
            })
            .catch(() => parseEnvelopeFallback);
    }
    return parserPromise;
}

/** Remove stray `[[uc_…]]` text that slipped past the preset regex (display only; `mes` untouched). */
export function scrubStrayTags(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('[[uc_')) hits.push(walker.currentNode);
    for (const n of hits) n.nodeValue = n.nodeValue.replace(/\[\[uc_[A-Za-z0-9_.:-]*\]?\]?/g, '');
}

function renderSection(sec) {
    const headBits = [icon(sec.icon), h('span', {}, sec.title)];
    if (sec.subtitle) headBits.push(h('span', { class: 'uc2-rc-subtitle' }, sec.subtitle));
    if (sec.truncated) headBits.push(h('span', { class: 'uc2-rc-cut', attrs: { title: 'The model stopped before closing this block' } }, 'cut'));
    const body = [];
    if (sec.rows.length) {
        body.push(h('dl', { class: 'uc2-rc-kv' }, sec.rows.map(r => [
            h('dt', {}, r.label || '·'), h('dd', {}, r.value)])));
    }
    for (const g of sec.groups) {
        body.push(h('div', { class: 'uc2-rc-group' },
            g.name ? h('div', { class: 'uc2-rc-name' }, g.name) : null,
            h('dl', { class: 'uc2-rc-kv' }, g.rows.map(r => [h('dt', {}, r.label || '·'),
                h('dd', { class: /secret/i.test(r.label) ? 'uc2-rc-secret' : '', attrs: /secret/i.test(r.label) ? { tabindex: '0' } : {} }, r.value)]))));
    }
    if (sec.items.length) {
        body.push(h('ul', { class: 'uc2-rc-facts' }, sec.items.map(i => h('li', { class: i.sign === '-' ? 'is-gone' : i.sign === '+' ? 'is-new' : '' },
            h('span', { class: 'uc2-rc-sign', aria: { label: i.sign === '-' ? 'no longer true' : 'new' } }, i.sign || '•'), h('span', {}, i.text)))));
    }
    return h('section', { class: `uc2-rc-sec uc2-rc-${sec.id}` }, h('h4', { class: 'uc2-rc-h' }, headBits), body);
}

export function buildCard(model, stamp, open = false) {
    const chips = model.chips.map(c => h('span', { class: 'uc2-rc-chip' }, icon(c.icon), h('span', {}, c.text)));
    const details = h('details', { class: 'uc2-reply-card', data: { stamp } },
        h('summary', { class: 'uc2-rc-sum' },
            icon('fa-eye-low-vision', 'uc2-rc-lead'),
            h('span', { class: 'uc2-rc-title' }, 'Behind the scenes'),
            h('span', { class: 'uc2-rc-chips' }, chips),
            model.truncated ? h('span', { class: 'uc2-rc-cut' }, 'cut') : null,
            icon('fa-chevron-down', 'uc2-rc-chev')),
        h('div', { class: 'uc2-rc-body' }, model.sections.map(renderSection)));
    details.open = !!open;
    return details;
}

export function createReplyCards(api) {
    let timer = null;
    let destroyed = false;
    const unsubs = [];

    const cardKey = () => {
        const schema = call(api, 'getSchema');
        const e = entriesForTab(Array.isArray(schema) ? schema : [], 'director').find(x => x.type === 'toggle' && /card/i.test(x.key));
        return e?.key || 'director.card';
    };
    const cardOn = () => {
        const v = getPath(call(api, 'getSettings') || {}, cardKey());
        return v === true && call(api, 'isActive') !== false;
    };

    async function run() {
        timer = null;
        if (destroyed) return;
        // Never draw mid-reply. GENERATION_ENDED schedules again; the slow re-check covers event ordering
        // (ST clears body[data-generating] in activateSendButtons, which can run after the last render event).
        if (isStreaming()) { timer = setTimeout(run, 400); return; }
        const chatEl = document.getElementById('chat');
        if (!chatEl) return;
        const on = cardOn();
        const parse = on ? await loadParser() : null;
        for (const mes of chatEl.querySelectorAll(':scope > .mes')) {
            const textEl = mes.querySelector('.mes_text');
            if (!textEl) continue;
            if (textEl.querySelector('.edit_textarea, #curEditTextarea')) continue; // being edited
            if (mes.getAttribute('is_user') === 'true') continue;
            for (const a of textEl.querySelectorAll(ANCHOR_SEL)) a.classList.add('uc2-env-hidden');
            scrubStrayTags(textEl);
            const existing = [...mes.querySelectorAll('.uc2-reply-card')];
            const raw = on && mes.getAttribute('is_system') !== 'true' ? rawMessage(mes.getAttribute('mesid'))?.mes : null;
            if (!raw || !/<\s*(UC|Scene|Tracker)\b/i.test(raw)) { existing.forEach(n => n.remove()); continue; }
            const stamp = hashStr(raw);
            if (existing.length === 1 && existing[0].dataset.stamp === stamp) continue;
            const model = cardModel(parse(raw));
            const wasOpen = existing.some(n => n.open);
            existing.forEach(n => n.remove());
            if (!model.ok) continue;
            textEl.after(buildCard(model, stamp, wasOpen));
        }
    }

    function schedule() {
        if (destroyed || timer) return;
        timer = setTimeout(run, REFRESH_MS);
    }

    unsubs.push(onStEvents(ST_EVENTS, schedule));
    if (typeof api?.on === 'function') {
        for (const ev of ['chat', 'settings']) {
            try { api.on(ev, schedule); unsubs.push(() => call(api, 'off', ev, schedule)); } catch { /* ignore */ }
        }
    }
    schedule();

    return {
        refresh: schedule,
        runNow: run,
        destroy() {
            destroyed = true;
            clearTimeout(timer);
            for (const u of unsubs) u();
            document.querySelectorAll('#chat .uc2-reply-card').forEach(n => n.remove());
        },
    };
}
