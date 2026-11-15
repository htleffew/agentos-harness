// Roleplay Instructions: compatibility test (Step 0).
// A throwaway extension that records how World Info behaves on this device.
// It uses only SillyTavern.getContext(), the same way Version 1 will.

const BOOK = 'ri-compat-test';
const TAG = '[ri-test]';
const STORE_KEY = 'ri_compat_test_log';
const MARKERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const ctx = () => globalThis.SillyTavern.getContext();
let lines = [];
let gen = null;          // the generation in progress: { n, type, dryRun }
let genCount = 0;
let removeA = true;

try { lines = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { lines = []; }

function log(msg) {
    const line = `${new Date().toISOString().slice(11, 19)} ${msg}`;
    lines.push(line);
    if (lines.length > 1500) lines = lines.slice(-1500);
    console.log(TAG, msg);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(lines)); } catch { /* storage full or blocked */ }
    const box = document.getElementById('ri_test_log');
    if (box) { box.value = lines.join('\n'); box.scrollTop = box.scrollHeight; }
}

function entry(uid, comment, content, extra = {}) {
    return {
        uid, key: [], keysecondary: [], comment, content,
        constant: true, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true,
        order: 100, position: 4, disable: false, ignoreBudget: true,
        excludeRecursion: true, preventRecursion: true, delayUntilRecursion: 0,
        probability: 100, useProbability: true, depth: 1, outletName: '',
        group: '', groupOverride: false, groupWeight: 100,
        scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null,
        automationId: '', role: 0, sticky: null, cooldown: null, delay: null, triggers: [],
        displayIndex: uid, extensions: { ri_test: { marker: comment } },
        ...extra,
    };
}

function buildBook() {
    const list = [
        entry(0, 'A Chance 50', '[ri-test A]', { probability: 50 }),
        entry(1, 'B Sticky 3 chance 30', '[ri-test B]', { probability: 30, sticky: 3 }),
        entry(2, 'C Cooldown 4', '[ri-test C]', { cooldown: 4 }),
        entry(3, 'D Variable', '[ri-test D {{getvar::ri_test_seed}}]'),
        entry(4, 'E Nested macro', '[ri-test E {{random::{{getvar::ri_test_x}}::plain}}]'),
        entry(5, 'F Group', '[ri-test F]', { group: 'ri_g' }),
        entry(6, 'G Group', '[ri-test G]', { group: 'ri_g' }),
        entry(7, 'H Group', '[ri-test H]', { group: 'ri_g' }),
    ];
    const entries = {};
    for (const e of list) entries[e.uid] = e;
    return { entries, extensions: { ri_test: { made: new Date().toISOString() } } };
}

async function createBook() {
    const c = ctx();
    try {
        await c.saveWorldInfo(BOOK, buildBook(), true);
        if (typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
        const back = await c.loadWorldInfo(BOOK);
        const n = back?.entries ? Object.keys(back.entries).length : 0;
        log(`TEST 5 create lorebook: saved and read back ${n} entries (expected 8); listed in getWorldInfoNames: ${c.getWorldInfoNames?.().includes(BOOK)}`);
    } catch (e) {
        log(`TEST 5 create lorebook FAILED: ${e?.message || e}`);
    }
}

async function autoChecks() {
    const c = ctx();
    const et = c.eventTypes || c.event_types || {};
    log('--- automatic checks ---');
    log(`user agent: ${navigator.userAgent}`);
    log(`TauriTavern: ${globalThis.__TAURI__ || globalThis.__TAURI_INTERNALS__ ? 'yes' : 'no'}; mainApi: ${c.mainApi}; chat completion source: ${c.chatCompletionSettings?.chat_completion_source ?? 'n/a'}`);
    try {
        const r = await fetch('/version', { headers: c.getRequestHeaders?.() });
        log(`/version: ${r.ok ? JSON.stringify(await r.json()) : 'HTTP ' + r.status}`);
    } catch (e) { log(`/version not available: ${e?.message || e}`); }
    for (const name of ['WORLDINFO_ENTRIES_LOADED', 'WORLDINFO_SCAN_DONE', 'WORLD_INFO_ACTIVATED', 'WORLDINFO_FORCE_ACTIVATE', 'GENERATION_STARTED', 'GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'CHAT_COMPLETION_PROMPT_READY', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED']) {
        log(`event ${name}: ${et[name] ? 'present' : 'MISSING'}`);
    }
    for (const name of ['loadWorldInfo', 'saveWorldInfo', 'getWorldInfoNames', 'updateWorldInfoList', 'reloadWorldInfoEditor', 'generateRaw', 'ConnectionManagerRequestService', 'substituteParams', 'saveMetadata', 'setExtensionPrompt', 'callGenericPopup', 'messageFormatter', 'updateMessageBlock', 'variables', 'getTokenCountAsync']) {
        log(`context.${name}: ${c[name] ? 'present' : 'MISSING'}`);
    }
    // Test 5: edit and save an existing lorebook, then read it back.
    try {
        const data = await c.loadWorldInfo(BOOK);
        if (!data) { log('TEST 5 edit: lorebook not found. Press "1. Create the test lorebook" first.'); }
        else {
            const before = data.entries[0].probability;
            data.entries[0].probability = before === 50 ? 51 : 50;
            data.entries[99] = entry(99, 'Z Added by test', '[ri-test Z]', { disable: true });
            await c.saveWorldInfo(BOOK, data, true);
            const back = await c.loadWorldInfo(BOOK);
            const ok = back.entries[0].probability !== before && !!back.entries[99] && !!back.entries[0].extensions?.ri_test && !!back.extensions?.ri_test;
            log(`TEST 5 edit and save: ${ok ? 'PASS' : 'FAIL'} (chance ${before} -> ${back.entries[0].probability}; added entry kept: ${!!back.entries[99]}; custom entry data kept: ${!!back.entries[0].extensions?.ri_test}; custom lorebook data kept: ${!!back.extensions?.ri_test})`);
            back.entries[0].probability = 50; delete back.entries[99];
            await c.saveWorldInfo(BOOK, back, true);
        }
    } catch (e) { log(`TEST 5 edit and save FAILED: ${e?.message || e}`); }
    // Macros outside World Info.
    try {
        c.variables.local.set('ri_test_x', 'nested-ok');
        const outs = new Set();
        for (let i = 0; i < 30; i++) outs.add(c.substituteParams('{{random::{{getvar::ri_test_x}}::plain}}'));
        log(`TEST 4 nested macro via substituteParams, 30 tries gave: ${JSON.stringify([...outs])} (want "nested-ok" and "plain")`);
    } catch (e) { log(`TEST 4 substituteParams FAILED: ${e?.message || e}`); }
    // Connection profiles.
    try {
        const profiles = c.extensionSettings?.connectionManager?.profiles || [];
        log(`connection profiles: ${profiles.length} (${profiles.map(p => `${p.name}:${p.api}`).join(', ') || 'none'})`);
    } catch (e) { log(`connection profiles FAILED: ${e?.message || e}`); }
    log('--- automatic checks done ---');
}

async function modelCheck() {
    const c = ctx();
    log('--- AI connection check (2 short requests) ---');
    try {
        const text = await c.generateRaw({ prompt: [{ role: 'user', content: 'Reply with exactly this JSON and nothing else: ["one","two"]' }], systemPrompt: 'You output JSON only.', responseLength: 60, trimNames: false });
        log(`generateRaw plain: ${JSON.stringify(String(text).slice(0, 200))}`);
    } catch (e) { log(`generateRaw plain FAILED: ${e?.message || e}`); }
    try {
        const schema = { name: 'ri_test', strict: true, value: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'], additionalProperties: false } };
        const text = await c.generateRaw({ prompt: [{ role: 'user', content: 'Give two short words in the items list.' }], systemPrompt: 'You output JSON only.', responseLength: 60, trimNames: false, jsonSchema: schema });
        log(`generateRaw with JSON schema: ${JSON.stringify(String(typeof text === 'string' ? text : JSON.stringify(text)).slice(0, 200))}`);
    } catch (e) { log(`generateRaw with JSON schema FAILED: ${e?.message || e}`); }
    log('--- AI connection check done ---');
}

function timers() {
    const t = ctx().chatMetadata?.timedWorldInfo || {};
    const f = o => Object.entries(o || {}).filter(([k]) => k.startsWith(BOOK)).map(([k, v]) => `${k.split('.').pop()}:${v.start}-${v.end}${v.protected ? 'p' : ''}`).join(',') || '-';
    return `sticky[${f(t.sticky)}] cooldown[${f(t.cooldown)}]`;
}

function chatLen() {
    return (ctx().chat || []).filter(m => !m.is_system).length;
}

function wire() {
    const c = ctx();
    const es = c.eventSource;
    const et = c.eventTypes || c.event_types;

    es.on(et.GENERATION_STARTED, (type, _opts, dryRun) => {
        if (dryRun) { gen = { n: 0, type, dryRun: true }; return; }
        gen = { n: ++genCount, type, dryRun: false };
        const seed = 'seed' + Math.floor(Math.random() * 100000);
        try { c.variables.local.set('ri_test_seed', seed); c.variables.local.set('ri_test_x', 'nested-ok'); } catch { /* reported below */ }
        gen.seed = seed;
        log(`GEN ${gen.n} start type=${type} messages=${chatLen()} seed=${seed} timers before: ${timers()}`);
    });
    if (et.GENERATION_AFTER_COMMANDS) es.on(et.GENERATION_AFTER_COMMANDS, (type, _o, dryRun) => { if (!dryRun && gen) log(`GEN ${gen.n} after-commands type=${type} messages=${chatLen()}`); });

    // Test 1a: add the test lorebook to this chat's entries before the scan (how Version 1 turns a set on per chat).
    if (et.WORLDINFO_ENTRIES_LOADED) es.on(et.WORLDINFO_ENTRIES_LOADED, async (lore) => {
        try {
            const all = [...lore.globalLore, ...lore.characterLore, ...lore.chatLore, ...lore.personaLore];
            if (all.some(e => e.world === BOOK)) { if (gen && !gen.dryRun) log(`GEN ${gen.n} entries-loaded: test lorebook already active by SillyTavern`); return; }
            const data = await ctx().loadWorldInfo(BOOK);
            if (!data?.entries) return;
            const add = Object.values(data.entries).map(e => ({ ...e, world: BOOK }));
            lore.chatLore.push(...add);
            if (gen && !gen.dryRun) log(`GEN ${gen.n} entries-loaded: added ${add.length} test entries to this chat (TEST 1a)`);
        } catch (e) { log(`entries-loaded handler FAILED: ${e?.message || e}`); }
    });

    // Test 1b: change the result after the scan (how Version 1 applies per-reply limits and picks versions).
    if (et.WORLDINFO_SCAN_DONE) es.on(et.WORLDINFO_SCAN_DONE, (args) => {
        try {
            if (!gen || gen.dryRun) return;
            if (args.state?.next) return; // not the final pass
            const map = args.activated?.entries;
            if (!(map instanceof Map)) { log(`GEN ${gen.n} scan-done: activated.entries is not a Map (${typeof map})`); return; }
            const mine = [...map.values()].filter(e => e.world === BOOK);
            const names = mine.map(e => String(e.comment).charAt(0)).sort().join('');
            let note = '';
            if (removeA && map.has(`${BOOK}.0`)) { map.delete(`${BOOK}.0`); note += ' removed A;'; }
            const d = map.get(`${BOOK}.3`);
            if (d) { d.content = `[ri-test D rewritten-${gen.seed}]`; note += ' rewrote D;'; }
            const sticky = mine.filter(e => args.timedEffects?.isEffectActive?.('sticky', e)).map(e => String(e.comment).charAt(0)).join('');
            log(`GEN ${gen.n} scan-done final: fired=${names || '-'} stickyActive=${sticky || '-'}${note} (TEST 1b)`);
        } catch (e) { log(`scan-done handler FAILED: ${e?.message || e}`); }
    });

    if (et.WORLD_INFO_ACTIVATED) es.on(et.WORLD_INFO_ACTIVATED, (list) => {
        if (!gen || gen.dryRun) return;
        const mine = (list || []).filter(e => e.world === BOOK);
        log(`GEN ${gen.n} activated event: ${mine.map(e => String(e.comment).charAt(0)).sort().join('') || '-'} | E text: ${mine.find(e => e.uid === 4)?.content ?? '-'} | timers after: ${timers()}`);
    });

    if (et.CHAT_COMPLETION_PROMPT_READY) es.on(et.CHAT_COMPLETION_PROMPT_READY, (data) => {
        if (!gen || gen.dryRun || data?.dryRun) return;
        const text = (data?.chat || []).map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
        const found = MARKERS.filter(k => text.includes(`[ri-test ${k}`));
        const d = (text.match(/\[ri-test D [^\]]*\]/) || ['-'])[0];
        const e = (text.match(/\[ri-test E [^\]]*\]/) || ['-'])[0];
        log(`GEN ${gen.n} PROMPT SENT contains: ${found.join('') || '-'} | ${d} | ${e} | A present: ${found.includes('A')} (want false when "remove A" is on)`);
    });

    es.on(et.MESSAGE_RECEIVED, (id, type) => { log(`message received id=${id} type=${type} messages=${chatLen()} timers: ${timers()}`); });
    es.on(et.GENERATION_ENDED, () => { if (gen && !gen.dryRun) log(`GEN ${gen.n} ended`); gen = null; });
    if (et.GENERATION_STOPPED) es.on(et.GENERATION_STOPPED, () => { log('generation stopped'); gen = null; });
    es.on(et.MESSAGE_SWIPED, (id) => log(`swiped id=${id} timers: ${timers()}`));
    es.on(et.MESSAGE_DELETED, (len) => log(`message deleted, chat length now ${len}, timers: ${timers()}`));
    es.on(et.CHAT_CHANGED, (id) => log(`chat changed: ${id ? 'a chat is open' : 'no chat'} messages=${chatLen()} timers: ${timers()}`));
}

function panel() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('ri_test_panel')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ri_test_panel';
    wrap.innerHTML = `
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>Roleplay Instructions: compatibility test</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="ri-test-help">This records how World Info behaves on this device. Do these steps in order, in a test chat:
          <ol>
            <li>Press "1. Create the test lorebook".</li>
            <li>Press "2. Run automatic checks".</li>
            <li>Press "3. Test the AI connection" (sends 2 very short requests).</li>
            <li>Send 6 messages in the chat, waiting for each reply.</li>
            <li>Swipe the last reply 5 times.</li>
            <li>Delete the last reply, then send 1 more message.</li>
            <li>Press "Copy the log" and paste it to Claude.</li>
          </ol>
        </div>
        <div class="ri-test-row">
          <div class="menu_button" id="ri_test_create">1. Create the test lorebook</div>
          <div class="menu_button" id="ri_test_auto">2. Run automatic checks</div>
          <div class="menu_button" id="ri_test_model">3. Test the AI connection</div>
        </div>
        <label class="checkbox_label"><input type="checkbox" id="ri_test_removeA" checked> Remove entry A after each scan (tests that the extension can stop an entry from being sent)</label>
        <div class="ri-test-row">
          <div class="menu_button" id="ri_test_copy">Copy the log</div>
          <div class="menu_button" id="ri_test_clear">Clear the log</div>
        </div>
        <textarea id="ri_test_log" readonly></textarea>
      </div>
    </div>`;
    host.appendChild(wrap);
    const $ = id => document.getElementById(id);
    $('ri_test_log').value = lines.join('\n');
    $('ri_test_create').addEventListener('click', createBook);
    $('ri_test_auto').addEventListener('click', autoChecks);
    $('ri_test_model').addEventListener('click', modelCheck);
    $('ri_test_removeA').addEventListener('change', e => { removeA = e.target.checked; log(`setting: remove A after scan = ${removeA}`); });
    $('ri_test_clear').addEventListener('click', () => { lines = []; try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } $('ri_test_log').value = ''; });
    $('ri_test_copy').addEventListener('click', async () => {
        const text = lines.join('\n');
        try { await navigator.clipboard.writeText(text); globalThis.toastr?.success('Log copied.'); }
        catch { const box = $('ri_test_log'); box.focus(); box.select(); try { document.execCommand('copy'); globalThis.toastr?.success('Log copied.'); } catch { globalThis.toastr?.info('Select the text in the box and copy it by hand.'); } }
    });
}

(function init() {
    try { wire(); log('compatibility test extension loaded'); } catch (e) { console.error(TAG, e); }
    const tryPanel = () => { panel(); if (!document.getElementById('ri_test_panel')) setTimeout(tryPanel, 500); };
    tryPanel();
})();
