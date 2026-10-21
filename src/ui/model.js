// Pure UI helpers: no DOM, no ST globals. Unit-tested by tests/unit/ui_*.test.mjs.
// Everything here maps contract data (schema, content, state, envelope) to small view models
// that the DOM renderers in this folder draw.

/** Tabs in rail order. `pinned` items sit at the bottom of the desktop rail. */
export const TABS = [
    { id: 'story', label: 'Story', icon: 'fa-book-open', title: 'Story Config',
        subtitle: 'Standing settings the narrator plays straight, every turn.' },
    { id: 'narrator', label: 'Narrator', icon: 'fa-masks-theater', title: 'Narrator',
        subtitle: 'Who tells the story, and how loudly the rules are spoken.' },
    { id: 'writing', label: 'Writing', icon: 'fa-pen-nib', title: 'Writing',
        subtitle: 'Length, dialogue, inner thoughts and reasoning.' },
    { id: 'director', label: 'Director', icon: 'fa-clapperboard', title: 'Director',
        subtitle: 'Drama, events and the optional showrunner.' },
    { id: 'characters', label: 'Characters', icon: 'fa-users', title: 'Characters',
        subtitle: 'What everyone wants, knows and hides, read from the story so far.' },
    { id: 'memory', label: 'Memory', icon: 'fa-memory', title: 'Memory',
        subtitle: 'Keep long chats lean: archive old messages, recall what matters.' },
    { id: 'rules', label: 'Rules', icon: 'fa-dice-d20', title: 'Chance Rules',
        subtitle: 'Small odds that nudge the world. Starter packs and LoreBary imports.' },
    { id: 'advanced', label: 'Advanced', icon: 'fa-gear', title: 'Advanced', pinned: true,
        subtitle: 'Background jobs, prompt editor, payload preview and debug.' },
];

export const TAB_IDS = TABS.map(t => t.id);

/** Escape a value for use inside HTML text or a double-quoted attribute. */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** CSS `url()` value for a custom property; quotes and control characters are neutralised. */
export function cssUrl(url) {
    if (!url || typeof url !== 'string') return 'none';
    const clean = url.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `url("${clean}")`;
}

/** Look a key up in a flat map ('a.b' as a key) first, then as a nested path. */
export function getPath(obj, key) {
    if (!obj || typeof obj !== 'object' || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    let cur = obj;
    for (const part of String(key).split('.')) {
        if (cur === null || typeof cur !== 'object' || !(part in cur)) return undefined;
        cur = cur[part];
    }
    return cur;
}

/** Normalise a schema `tab` value ('Story', 'story config', 'STORY') to a TABS id. */
export function normalizeTabId(tab) {
    const t = String(tab || '').toLowerCase().trim();
    if (TAB_IDS.includes(t)) return t;
    for (const def of TABS) {
        if (t.startsWith(def.id) || t === def.label.toLowerCase() || t === def.title.toLowerCase()) return def.id;
    }
    if (/chance|rule/.test(t)) return 'rules';
    if (/dev|debug|job|prompt/.test(t)) return 'advanced';
    return 'advanced';
}

/** Schema entries for one tab, in schema order. */
export function entriesForTab(schema, tab) {
    return (Array.isArray(schema) ? schema : []).filter(e => e && e.key && !e.hidden && normalizeTabId(e.tab) === tab);
}

/** Group entries by `section`, keeping first-seen order. Entries without a section share the '' group. */
export function groupSections(entries) {
    const out = [];
    const byName = new Map();
    for (const e of entries) {
        const name = e.section || '';
        if (!byName.has(name)) {
            const g = { section: name, entries: [] };
            byName.set(name, g);
            out.push(g);
        }
        byName.get(name).entries.push(e);
    }
    return out;
}

function normOption(o, i) {
    if (o === null || o === undefined) return null;
    if (typeof o !== 'object') return { id: String(o), value: o, label: String(o), text: '', hint: '' };
    const value = o.id !== undefined ? o.id : (o.value !== undefined ? o.value : i);
    const id = String(value);
    return { id, value, label: String(o.label ?? o.name ?? id), text: o.text ?? '', hint: String(o.hint ?? o.help ?? o.blurb ?? ''), raw: o };
}

/** The stored value for an option id (keeps numbers numeric: drama dial 0..3). */
export function optionValue(options, id) {
    const o = options.find(x => x.id === String(id));
    return o ? o.value : id;
}

/** Find a Story Config field definition for an entry (content.options.story.fields[]). */
export function storyField(entry, content) {
    const fields = getPath(content, 'options.story.fields');
    if (!Array.isArray(fields) || !entry) return null;
    const ref = String(entry.optionsRef || '');
    const tail = String(entry.key).split('.').pop();
    return fields.find(f => f && (ref.endsWith(`.${f.id}`) || ref === f.id || (String(entry.key).startsWith('story.') && f.id === tail))) || null;
}

/**
 * Resolve the option list for a select/chips entry.
 * Accepts `entry.options` (array of strings/objects) or `entry.optionsRef` (dotted path into content:
 * 'options.tone', 'personas', 'options.story.fields.genre' or 'options.story.fields[genre]').
 * Returns { options, field } where `field` is the Story Config field meta when there is one.
 */
export function resolveOptions(entry, content, extra = null) {
    if (!entry) return { options: [], field: null };
    let field = null;
    let list = null;
    if (Array.isArray(entry.options)) list = entry.options;
    else if (entry.optionsRef) {
        const ref = String(entry.optionsRef).replace(/\[(\w+)\]/g, '.$1');
        const val = extra && Array.isArray(extra[ref]) ? extra[ref] : getPath(content, ref);
        if (Array.isArray(val)) list = val;
        else if (val && typeof val === 'object' && Array.isArray(val.options)) { list = val.options; field = val; }
        if (!list) {
            const f = storyField(entry, content);
            if (f) { field = f; list = f.options || []; }
        }
    }
    if (!field && normalizeTabId(entry.tab) === 'story') field = storyField(entry, content);
    if (!list && field) list = field.options || [];
    const options = (list || []).map(normOption).filter(Boolean);
    // Model family: CORE prepends Auto-detect to content.models (settings/contentSettings.js optionsForRole).
    if (entry.optionsRef === 'models' && !options.some(o => o.id === 'auto')) options.unshift({ id: 'auto', value: 'auto', label: 'Auto-detect', text: '', hint: '' });
    return { options, field };
}

/**
 * Map a schema entry to the control the UI draws.
 * 'toggle' | 'slider' | 'dial' | 'number' | 'text' | 'textarea' | 'segmented' | 'accordion' | 'multi' | 'order' | 'persona' | 'info'
 */
export function controlKind(entry, resolved = { options: [], field: null }) {
    const type = String(entry?.type || '').toLowerCase();
    const n = resolved.options.length;
    if (type === 'toggle' || type === 'bool' || type === 'boolean') return 'toggle';
    if (type === 'slider' || type === 'range') return 'slider';
    if (type === 'number') return 'number';
    if (entry?.readonly || entry?.info) return 'info';
    if ((type === 'textarea' || type === 'prompt') && resolved.field) return 'accordion';
    if (type === 'textarea' || type === 'prompt') return 'textarea';
    if (type === 'select' && (entry.display === 'dial' || /drama/i.test(entry.key || '')) && n >= 2 && n <= 7) return 'dial';
    if (type === 'order') return 'order';
    if (type === 'text') return resolved.field ? 'accordion' : 'text';
    if (entry?.display === 'persona' || entry?.display === 'cards' || entry?.optionsRef === 'personas') return 'persona';
    if (type === 'chips' && (Array.isArray(entry.default) || entry.multi)) return 'multi';
    if (type === 'select' || type === 'chips') {
        if (entry.display === 'accordion' || resolved.field) return 'accordion';
        if (entry.display === 'segmented') return 'segmented';
        if (n === 0) return 'text';
        return n <= 5 ? 'segmented' : 'accordion';
    }
    return 'text';
}

const isBlank = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** True when the value is user-chosen (differs from the default and is not blank). */
export function isValueSet(entry, value) {
    if (isBlank(value)) return false;
    const def = entry?.default;
    if (Array.isArray(value) || Array.isArray(def)) return JSON.stringify(value) !== JSON.stringify(def ?? []);
    return String(value) !== String(def ?? '');
}

/** Right-aligned summary for accordion rows: { text, set }. */
export function valueSummary(entry, value, options = []) {
    const set = isValueSet(entry, value);
    const labelOf = v => {
        const o = options.find(x => x.id === String(v));
        return o ? o.label : String(v);
    };
    if (!set) {
        const def = entry?.default;
        const defLabel = isBlank(def) ? '' : (Array.isArray(def) ? def.map(labelOf).join(', ') : labelOf(def));
        return { text: defLabel ? `Default · ${defLabel}` : 'Default', set: false };
    }
    if (Array.isArray(value)) return { text: value.map(labelOf).join(', '), set: true };
    return { text: labelOf(value), set: true };
}

const DRAMA_LABELS = ['Off', 'Normal', 'Spicy', 'Chaos'];

/** Slider bounds and tick labels: from entry.min/max/step, entry.labels or option labels. */
export function sliderSpec(entry, options = []) {
    let labels = Array.isArray(entry?.labels) ? entry.labels.map(String) : null;
    if (!labels && options.length) labels = options.map(o => o.label);
    if (!labels && /drama/i.test(entry?.key || '')) labels = DRAMA_LABELS;
    const min = Number.isFinite(entry?.min) ? entry.min : 0;
    const max = Number.isFinite(entry?.max) ? entry.max : (labels ? min + labels.length - 1 : 10);
    const step = Number.isFinite(entry?.step) ? entry.step : 1;
    return { min, max, step, labels: labels || null };
}

/** Replace ST macros for display only ({{char}} → the character's name, {{user}} → 'you'). */
export function displayText(text, charName) {
    return String(text ?? '')
        .replace(/\{\{char\}\}/gi, charName || 'the character')
        .replace(/\{\{user\}\}/gi, 'you');
}

/** Short persona one-liner: blurb, else taste without a leading "- Narrator taste:" style label. */
export function personaLine(p, max = 160) {
    const raw = String(p?.blurb || p?.taste || '').replace(/^\s*-\s*[^:]{1,30}:\s*/, '').replace(/\s+/g, ' ').trim();
    return raw.length > max ? `${raw.slice(0, max - 1).trimEnd()}…` : raw;
}

/**
 * Hero image layers for a character avatar URL. ST thumbnails (/thumbnail?type=avatar&file=X) are small, so the
 * full-size /characters/X is layered on top, with the thumbnail underneath as a fallback.
 */
export function heroSources(url) {
    if (!url || typeof url !== 'string') return [];
    const m = url.match(/^\/thumbnail\?type=avatar&file=([^&]+)/);
    return m ? [`/characters/${m[1]}`, url] : [url];
}

// Icons and tints for rows when the schema/content does not supply one (UI styling only).
const KEY_ICONS = {
    persona: 'fa-masks-theater', rule_voice: 'fa-bullhorn', author_voice: 'fa-feather-pointed', 'narrator.ooc': 'fa-comment-dots',
    genre: 'fa-masks-theater', tone: 'fa-cloud-sun-rain', explicitness: 'fa-fire',
    length: 'fa-ruler-horizontal', dialogue: 'fa-quote-left', thoughts: 'fa-brain', pronouns: 'fa-user', model_family: 'fa-microchip',
    'writing.reasoning': 'fa-lightbulb', 'display.reply_card': 'fa-eye', 'envelope.compact': 'fa-compress',
    'events.drama': 'fa-bolt', 'memory.enabled': 'fa-memory', 'intimacy.seed': 'fa-seedling',
};
const PREFIX_ICONS = [
    [/^envelope\.block\./, 'fa-cube'], [/^events\./, 'fa-dice'], [/^chance\./, 'fa-dice-d20'], [/^showrunner\./, 'fa-clapperboard'],
    [/^minds\./, 'fa-brain'], [/^intimacy\./, 'fa-heart'], [/^memory\./, 'fa-memory'], [/^ticguard\./, 'fa-shield-halved'],
    [/^critic\./, 'fa-magnifying-glass'], [/^jobs\./, 'fa-list-check'], [/^budget\./, 'fa-scale-balanced'], [/^dev\./, 'fa-bug'],
    [/^writing\./, 'fa-pen-nib'], [/^narrator\./, 'fa-masks-theater'],
];
const FIELD_TINTS = {
    genre: '#f59e0b', setting: '#22c55e', era: '#d97706', pov: '#3b82f6', focus: '#eab308', tone: '#a855f7',
    narrator_presence: '#14b8a6', presence: '#14b8a6', npc_speech: '#0ea5e9', npc_disposition: '#8b5cf6', difficulty: '#ef4444',
    friction: '#f97316', explicitness: '#e11d48', pace: '#10b981', length: '#06b6d4', notes: '#94a3b8',
};

/** Icon for a schema entry: its own, the content field's, a known key, a key prefix, or null. */
export function iconFor(entry, field = null) {
    if (!entry) return null;
    if (entry.icon) return entry.icon;
    if (field?.icon) return field.icon;
    const key = String(entry.key || '');
    if (KEY_ICONS[key]) return KEY_ICONS[key];
    if (entry.role && KEY_ICONS[entry.role]) return KEY_ICONS[entry.role];
    for (const [re, ic] of PREFIX_ICONS) if (re.test(key)) return ic;
    return null;
}

/** Accent tint for an accordion row (Story Config field id or key tail). */
export function tintFor(id) {
    const tail = String(id || '').split('.').pop().split(':').pop();
    return FIELD_TINTS[tail] || personaAccent(tail);
}

/** Deterministic small hash (FNV-1a, 32-bit) as base36. */
export function hashStr(s) {
    let h = 0x811c9dc5;
    const str = String(s ?? '');
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

const ACCENTS = ['#f59e0b', '#a855f7', '#10b981', '#3b82f6', '#f43f5e', '#14b8a6', '#eab308', '#8b5cf6', '#f97316', '#06b6d4'];

/** Accent colour for a persona: its own `accent` when content provides one, else a stable pick by id. */
export function personaAccent(persona) {
    if (persona && typeof persona.accent === 'string' && /^#[0-9a-f]{3,8}$/i.test(persona.accent)) return persona.accent;
    const id = String(persona?.id ?? persona ?? '');
    if (!id || id === 'none') return '#a1a1aa';
    return ACCENTS[parseInt(hashStr(id), 36) % ACCENTS.length];
}

/** Compact token display: 950 → '950', 1234 → '1.2k', 15320 → '15k'. */
export function formatTokens(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '–';
    if (v < 1000) return String(Math.round(v));
    if (v < 10000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return `${Math.round(v / 1000)}k`;
}

/** Memory dashboard bar: segments with percentages (oldest → newest: summarized, archived, working). */
export function memorySegments(stats) {
    const s = stats || {};
    const segs = [
        { id: 'summarized', label: 'Summarized', count: Math.max(0, Number(s.summarized) || 0) },
        { id: 'archived', label: 'Archived', count: Math.max(0, Number(s.archived) || 0) },
        { id: 'working', label: 'Working', count: Math.max(0, Number(s.working) || 0) },
    ];
    const total = segs.reduce((a, b) => a + b.count, 0);
    for (const seg of segs) seg.pct = total ? Math.round((seg.count / total) * 1000) / 10 : 0;
    return { segments: segs, total, tokensSaved: Math.max(0, Number(s.tokensSaved) || 0) };
}

// ---------------------------------------------------------------------------------------------
// Envelope → reply card
// ---------------------------------------------------------------------------------------------

export const BLOCK_META = {
    scene: { title: 'Scene', icon: 'fa-location-dot', order: 1 },
    minds: { title: 'Minds', icon: 'fa-brain', order: 2 },
    threads: { title: 'Threads', icon: 'fa-diagram-project', order: 3 },
    facts: { title: 'Facts', icon: 'fa-list-check', order: 4 },
    intimacy: { title: 'Intimacy', icon: 'fa-heart', order: 5 },
    new_character: { title: 'New character', icon: 'fa-user-plus', order: 6 },
    tracker: { title: 'Tracker', icon: 'fa-compass', order: 7 },
};

const TAG_TO_ID = { scene: 'scene', minds: 'minds', threads: 'threads', facts: 'facts', intimacy: 'intimacy',
    new_character: 'new_character', newcharacter: 'new_character', tracker: 'tracker' };

/**
 * Minimal tolerant parser used only when CORE's envelope/parse.js is not available.
 * Same output shape: { ok, blocks:[{id, attrs, body, lines, truncated}] }. Never throws.
 */
export function parseEnvelopeFallback(text) {
    try {
        const src = String(text ?? '');
        const open = src.toLowerCase().lastIndexOf('<uc>');
        let region;
        if (open >= 0) {
            const rest = src.slice(open + 4);
            const close = rest.toLowerCase().indexOf('</uc>');
            region = close >= 0 ? rest.slice(0, close) : rest;
        } else {
            const m = src.match(/<(Scene|Tracker|Minds|Facts|Threads)\b[\s\S]*$/i);
            if (!m) return { ok: false, blocks: [] };
            region = m[0];
        }
        const blocks = [];
        const tagRe = /<([A-Za-z_]+)((?:\s+[a-z_]+="[^"]*")*)\s*>/g;
        const hits = [];
        let m;
        while ((m = tagRe.exec(region))) {
            const id = TAG_TO_ID[m[1].toLowerCase()];
            if (id) hits.push({ id, tag: m[1], attrsRaw: m[2] || '', start: m.index, bodyStart: tagRe.lastIndex });
        }
        hits.forEach((hit, i) => {
            const limit = i + 1 < hits.length ? hits[i + 1].start : region.length;
            const seg = region.slice(hit.bodyStart, limit);
            const closeIdx = seg.toLowerCase().indexOf(`</${hit.tag.toLowerCase()}>`);
            const body = (closeIdx >= 0 ? seg.slice(0, closeIdx) : seg).trim();
            const attrs = {};
            hit.attrsRaw.replace(/([a-z_]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
            blocks.push({ id: hit.id, attrs, body, lines: body.split('\n').map(l => l.trim()).filter(Boolean),
                truncated: closeIdx < 0 });
        });
        return { ok: blocks.length > 0, blocks };
    } catch {
        return { ok: false, blocks: [] };
    }
}

/** Split 'a: 1 | b: 2' into [['a','1'],['b','2']]; segments without a key become ['', text]. */
export function splitKV(line) {
    return String(line ?? '').split('|').map(s => s.trim()).filter(Boolean).map(seg => {
        const m = seg.match(/^([^:]{1,40}):\s*(.*)$/);
        return m ? [m[1].trim(), m[2].trim()] : ['', seg];
    });
}

/** 'Name — mood: x | wants: y' → { name, pairs } (accepts em dash, en dash, ' - ' or ':' after the name). */
export function splitNamed(line) {
    const m = String(line ?? '').match(/^\s*([^—–|:]{1,60}?)\s*(?:—|–|\s-\s)\s*(.*)$/);
    if (m) return { name: m[1].trim(), pairs: splitKV(m[2]) };
    return { name: '', pairs: splitKV(line) };
}

/**
 * Turn a parsed envelope into a card view model.
 * { ok, truncated, chips:[{icon, text}], sections:[{id, title, icon, subtitle, truncated, rows:[{label, value}],
 *   groups:[{name, rows}], items:[{sign, text}]}] }
 * All values are plain strings; the renderer sets them with textContent.
 */
export function cardModel(parsed) {
    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const sections = [];
    const chips = [];
    let truncated = false;
    for (const b of blocks) {
        const id = TAG_TO_ID[String(b.id || '').toLowerCase()] || String(b.id || 'block');
        const meta = BLOCK_META[id] || { title: b.id || 'Block', icon: 'fa-cube', order: 99 };
        const lines = Array.isArray(b.lines) && b.lines.length ? b.lines : String(b.body || '').split('\n').map(s => s.trim()).filter(Boolean);
        truncated = truncated || !!b.truncated;
        const sec = { id, title: meta.title, icon: meta.icon, order: meta.order, subtitle: '', truncated: !!b.truncated,
            rows: [], groups: [], items: [] };
        if (b.attrs?.name) sec.subtitle = String(b.attrs.name);
        if (id === 'scene' || id === 'tracker') {
            for (const l of lines) for (const [k, v] of splitKV(l)) sec.rows.push({ label: k, value: v });
            if (id === 'scene') {
                const get = k => sec.rows.find(r => r.label.toLowerCase().startsWith(k))?.value;
                const time = get('time');
                const place = get('place');
                if (time) chips.push({ icon: 'fa-clock', text: time });
                if (place) chips.push({ icon: 'fa-location-dot', text: place });
            }
            if (id === 'tracker') {
                const phase = sec.rows.find(r => r.label.toLowerCase() === 'phase')?.value;
                if (phase) chips.push({ icon: 'fa-compass', text: phase });
            }
        } else if (id === 'minds') {
            for (const l of lines) {
                const { name, pairs } = splitNamed(l);
                sec.groups.push({ name, rows: pairs.map(([k, v]) => ({ label: k, value: v })) });
            }
        } else if (id === 'facts') {
            for (const l of lines) {
                const m = l.match(/^([+-])\s*(.*)$/);
                sec.items.push(m ? { sign: m[1], text: m[2] } : { sign: '', text: l });
            }
        } else {
            for (const l of lines) {
                const m = l.match(/^([^:]{1,40}):\s*(.*)$/);
                sec.rows.push(m ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: l });
            }
        }
        sections.push(sec);
    }
    sections.sort((a, b) => a.order - b.order);
    return { ok: sections.length > 0, truncated, chips: chips.slice(0, 3), sections };
}

/** Characters for the Characters tab: present first (scene.present order), then most recently seen. */
export function characterList(state) {
    const chars = state?.characters && typeof state.characters === 'object' ? state.characters : {};
    const presentRaw = state?.scene?.present;
    const present = (Array.isArray(presentRaw) ? presentRaw : String(presentRaw || '').split(','))
        .map(s => String(s).trim()).filter(Boolean);
    const list = Object.entries(chars).map(([name, c]) => ({
        name,
        present: present.includes(name) || !!c?.present,
        offscreen: c?.offscreen || '',
        lastSeen: Number(c?.lastSeen) || 0,
        firstSeen: Number(c?.firstSeen) || 0,
        mind: c?.mind || {},
        profile: c?.profile || {},
        intimacy: c?.intimacy || {},
    }));
    list.sort((a, b) => {
        if (a.present !== b.present) return a.present ? -1 : 1;
        if (a.present && b.present) return present.indexOf(a.name) - present.indexOf(b.name);
        return b.lastSeen - a.lastSeen || a.name.localeCompare(b.name);
    });
    return list;
}

export const MIND_FIELDS = [
    { id: 'mood', label: 'Mood', icon: 'fa-face-meh' },
    { id: 'wants', label: 'Wants', icon: 'fa-crosshairs' },
    { id: 'plan', label: 'Plan', icon: 'fa-chess' },
    { id: 'knows', label: 'Knows', icon: 'fa-eye' },
    { id: 'doesnt_know', label: "Doesn't know", icon: 'fa-eye-slash', aliases: ["doesn't know", 'doesnt know', 'unknown'] },
    { id: 'secret', label: 'Secret', icon: 'fa-user-secret' },
];

export const INTIMACY_FIELDS = [
    { id: 'likes', label: 'Likes', icon: 'fa-heart' },
    { id: 'dislikes', label: 'Dislikes', icon: 'fa-heart-crack' },
    { id: 'limits', label: 'Limits', icon: 'fa-ban' },
    { id: 'history', label: 'History', icon: 'fa-clock-rotate-left' },
];

/** Read a mind field tolerating key spellings. */
export function mindValue(mind, field) {
    if (!mind) return '';
    const keys = [field.id, ...(field.aliases || [])];
    for (const k of keys) if (mind[k] !== undefined && mind[k] !== null) return String(mind[k]);
    return '';
}

/** Normalise one intimacy evidence item to { text, quote }. Accepts strings, {text, quote} or {value, evidence}. */
export function evidenceItem(item) {
    if (item === null || item === undefined) return { text: '', quote: '' };
    if (typeof item === 'string') {
        const m = item.match(/^(.*?)\s*"([^"]+)"\s*$/);
        return m ? { text: m[1].trim(), quote: m[2] } : { text: item, quote: '' };
    }
    return { text: String(item.text ?? item.value ?? ''), quote: String(item.quote ?? item.evidence ?? '') };
}

/** Status pill text per tab. Pure: receives everything it needs. */
export function tabStatus(tab, { settings, schema, content, state, packs, active } = {}) {
    const val = key => getPath(settings, key);
    const findKey = (re, t = tab) => entriesForTab(schema, t).find(e => re.test(e.key));
    switch (tab) {
        case 'story': {
            const entries = entriesForTab(schema, 'story');
            const n = entries.filter(e => isValueSet(e, val(e.key))).length;
            return { text: n ? `${n} set` : 'Defaults', on: n > 0 };
        }
        case 'narrator': {
            const e = entriesForTab(schema, 'narrator').find(x => x.optionsRef === 'personas') || findKey(/persona/);
            const id = e ? val(e.key) ?? e.default : null;
            const p = (content?.personas || []).find(x => x.id === id);
            return { text: p ? p.name : (id ? String(id) : 'Narrator'), on: !!id && id !== 'none' };
        }
        case 'writing': {
            const e = entriesForTab(schema, 'writing').find(x => x.optionsRef === 'options.length') || findKey(/length/);
            if (!e) return { text: 'Writing', on: true };
            const { options } = resolveOptions(e, content);
            const v = val(e.key) ?? e.default;
            return { text: options.find(o => o.id === String(v))?.label || String(v ?? 'Default'), on: true };
        }
        case 'director': {
            const e = findKey(/drama/);
            if (!e) return { text: 'Director', on: true };
            const { options } = resolveOptions(e, content);
            const v = val(e.key) ?? e.default ?? 0;
            const opt = options.find(o => o.id === String(v));
            if (opt) return { text: `Drama · ${opt.label}`, on: options.indexOf(opt) > 0 };
            const spec = sliderSpec(e, options);
            const label = spec.labels ? spec.labels[Number(v) - spec.min] : String(v);
            return { text: `Drama · ${label ?? v}`, on: Number(v) > spec.min };
        }
        case 'characters': {
            const n = Object.keys(state?.characters || {}).length;
            return { text: `${n} known`, on: n > 0 };
        }
        case 'memory': {
            const e = findKey(/enabled?$/);
            const on = !!(e ? val(e.key) ?? e.default : false);
            return { text: on ? 'Enabled' : 'Off', on };
        }
        case 'rules': {
            const list = Array.isArray(packs) ? packs : [];
            const n = list.filter(p => p && (p.enabled ?? p.on)).length;
            return { text: `${n}/${list.length} packs`, on: n > 0 };
        }
        case 'advanced':
            return { text: active === false ? 'Paused' : 'Suite on', on: active !== false };
        default:
            return { text: '', on: false };
    }
}

/** Role → display class for payload preview blocks. */
export function roleClass(role) {
    const r = String(role || '').toLowerCase();
    return ['system', 'user', 'assistant', 'tool'].includes(r) ? r : 'other';
}

/** Payload preview model: [{role, roleClass, chars, preview, content}] (content kept raw; drawn via textContent). */
export function payloadModel(payload) {
    const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
    return msgs.map((m, i) => {
        const content = typeof m?.content === 'string' ? m.content
            : Array.isArray(m?.content) ? m.content.map(p => (p?.type === 'text' ? p.text : `[${p?.type || 'part'}]`)).join('\n')
                : JSON.stringify(m?.content ?? '');
        const firstLine = content.split('\n').find(l => l.trim()) || '';
        return { index: i, role: String(m?.role || 'unknown'), roleClass: roleClass(m?.role), chars: content.length,
            preview: firstLine.slice(0, 90), content };
    });
}
