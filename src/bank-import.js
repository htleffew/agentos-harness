// Import options from a preset or plugin file (A12 c.3, B37). Reads her own copy of a file as data: JSON is parsed
// and HTML is read as text. Nothing in the file is run, logged or sent. One import yields two outputs: value lists for
// the option banks and instruction blocks for the block bank, so neither fills the other.
//
// Every candidate list passes the same four tests, in order:
//   1. Size and shape: at least 3 items, each 300 characters or fewer, with no headings, numbered rules or XML wrappers.
//   2. Parallel items: items that are wordings of one long text are one instruction block with its wordings kept.
//   3. Chance gates: most items empty, a dot or a digit and one real item is a chance on one block.
//   4. Everything else is an instruction block.

export const MAX_ITEM = 300;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu;
const DECOR = /[─━═┈✧⸝·▸│\u261D]/g;
const ADULT = /\b(nsfw|explicit|sexual|sex|kink|smut|intimacy|ecchi|hentai|horny|pervert|dead dove|erotic|lewd|porn)/i;

/** A name with icons and decoration taken out. */
export const plainName = s => String(s ?? '').replace(EMOJI, '').replace(DECOR, ' ').replace(/\s+/g, ' ').trim();
const stripComments = s => String(s ?? '').replace(/\{\{\/\/[\s\S]*?\}\}/g, '');
const stripMacros = s => String(s ?? '').replace(/\{\{(?:trim|\/if|else)\}\}/g, '').replace(/\{\{[^{}]*\}\}/g, '').trim();
const words = s => new Set(String(s).toLowerCase().match(/[a-z']{3,}/g) || []);
function overlap(a, b) {
    const x = words(a); const y = words(b);
    if (!x.size || !y.size) return 0;
    let n = 0; for (const w of x) if (y.has(w)) n++;
    return n / Math.min(x.size, y.size);
}

/** Split every {{random::...}} in a text at macro depth zero. Returns [{ label, items, start, end, nested }]. */
export function randomLists(text) {
    const out = [];
    const s = String(text ?? '');
    let at = 0;
    while ((at = s.indexOf('{{random::', at)) >= 0) {
        let depth = 0; let end = -1;
        for (let j = at; j < s.length; j++) {
            if (s.startsWith('{{', j)) { depth++; j++; } else if (s.startsWith('}}', j)) { depth--; j++; if (!depth) { end = j + 1; break; } }
        }
        if (end < 0) break;
        const inner = s.slice(at + 10, end - 2);
        const items = []; let cur = ''; depth = 0;
        for (let j = 0; j < inner.length; j++) {
            if (inner.startsWith('{{', j)) { depth++; cur += '{{'; j++; continue; }
            if (inner.startsWith('}}', j)) { depth--; cur += '}}'; j++; continue; }
            if (!depth && inner.startsWith('::', j)) { items.push(cur); cur = ''; j++; continue; }
            cur += inner[j];
        }
        items.push(cur);
        const lineStart = s.lastIndexOf('\n', at) + 1;
        const before = s.slice(lineStart, at);
        const setvar = before.match(/\{\{setvar::([a-z0-9_]+)::\s*$/i);
        const label = setvar ? plainName(setvar[1].replace(/_/g, ' ')) : plainName(stripMacros(before).replace(/\{\{[^}]*$/, '').replace(/[*#:]/g, ''));
        out.push({ label, items: items.map(x => x.trim()), start: at, end, nested: /\{\{setvar::[^:}]+::\s*$/.test(s.slice(Math.max(0, at - 60), at)) });
        at = end;
    }
    return out;
}

/** The text of one random item: a nested setvar list keeps its longest value; other macros are taken out. */
function itemText(raw) {
    const vals = [...String(raw).matchAll(/\{\{setvar::[^:}]+::([^{}]*)\}\}/g)].map(m => m[1].trim());
    if (vals.length) return vals.sort((a, b) => b.length - a.length)[0];
    return stripMacros(raw).trim();
}

const shaped = t => t.length <= MAX_ITEM && !/^\s*#/m.test(t) && !/^\s*\d+\.\s/m.test(t) && !/<\/?[a-z_]+>/i.test(t);
const blankish = t => !String(t).trim() || /^[.\s\d]*$/.test(String(t).trim());

/**
 * The four tests on one candidate list. Returns { kind: 'list', items } | { kind: 'wordings', wordings }
 * | { kind: 'chance', item, chance } | { kind: 'block' }.
 */
export function classify(rawItems) {
    const items = rawItems.map(x => String(x).trim());
    const real = items.filter(t => !blankish(t));
    // 3. Chance gate: most items empty, a dot or a digit, one real item.
    if (items.length >= 3 && real.length === 1 && items.length - real.length >= items.length / 2) return { kind: 'chance', item: real[0], chance: Math.round(100 / items.length) };
    // 2. Wordings of one long text.
    if (real.length >= 2 && real.every(t => t.length > MAX_ITEM)) {
        let close = true;
        for (let i = 1; i < real.length; i++) if (overlap(real[0], real[i]) < 0.6) close = false;
        if (close) return { kind: 'wordings', wordings: real };
    }
    // 1. Size and shape.
    if (real.length >= 3 && real.every(shaped)) return { kind: 'list', items: real };
    return { kind: 'block' };
}

const labelOf = t => (String(t).match(/^([^:;]{1,60})[:;]\s/) || [])[1]?.trim() || String(t).split(/[.,;]/)[0].trim().slice(0, 60);
const toItems = (texts, more = () => ({})) => texts.map((t, i) => ({ label: plainName(labelOf(t)), text: t, ...more(t, i) }));

/** Drop exact and near duplicate lists (the same items under a second name). */
function dedupe(lists) {
    const out = [];
    for (const l of lists) {
        const key = l.items.map(i => i.text.toLowerCase().replace(/[^a-z]/g, '')).sort().join('|');
        const twin = out.find(o => o.key === key || (o.items.length === l.items.length && l.items.every((it, i) => overlap(it.text, o.items[i].text) > 0.8)));
        if (twin) continue;
        out.push({ ...l, key });
    }
    return out.map(({ key, ...l }) => l);
}

// ---------- SillyTavern Chat Completion presets ----------

const HEADER = /---|──|pick one|pick many|choose/i;
const isHeader = b => !String(b.content ?? '').trim() || HEADER.test(b.name || '');
const pickOf = name => /pick many|choose as many|as many as|pick any|pick several/i.test(name) ? 'many' : 'one';

function readPreset(p, file) {
    const lists = []; const blocks = [];
    let order = [];
    for (const g of p.prompt_order || []) if ((g.order || []).length > order.length) order = g.order;
    const byId = new Map((p.prompts || []).map(x => [x.identifier, x]));
    const seq = order.map(o => byId.get(o.identifier)).filter(Boolean);
    const inOrder = new Set(seq);
    const rest = (p.prompts || []).filter(x => !inOrder.has(x));
    const used = new Set();
    const rouletteUsed = new Set();
    const src = (b) => ({ file, block: plainName(b.name || b.identifier) });

    // Roulettes: blocks that raise the same counter and roll against it are options of one dimension.
    const roulettes = new Map();
    const ROULETTE_NAMES = { genre_count: 'Genre', lens_count: 'Voice lens', aff_count: "Author's style", qc_count: 'Writing habits' };
    for (const b of [...seq, ...rest]) {
        const c = String(b.content || '');
        const eligible = c.match(/\{\{addvar::(wp|exp)_eligible::1\}\}/);
        const counter = (c.match(/\{\{incvar[: ]+([a-z_]+_count)\s*\}\}/) || [])[1] || (eligible ? `${eligible[1]}_eligible` : '');
        const sub = c.match(/\{\{if !\{\{getvar::sub_([a-z0-9]+)_dur\}\}/);
        let dim = '';
        let more = {};
        if (sub) {
            dim = 'Hidden subtext';
            const tier = (c.match(/\[ACTIVE SUBTEXT: [^|\]]+\| ([A-Z]+)\]/) || [])[1] || '';
            more = { gate: { tier: tier.toLowerCase(), reply: Number((c.match(/\.t >= (\d+)/) || [])[1] || 0), die: Number((c.match(/roll 1d(\d+)/) || [])[1] || 1), dur: [2, 3], rest: [10, 15] } };
        } else if (counter === 'wp_eligible') dim = 'Ambient pulse';
        else if (counter === 'exp_eligible') dim = 'Rule for this reply';
        else if (counter) dim = ROULETTE_NAMES[counter] || plainName(counter.replace(/_count$/, '').replace(/_/g, ' ')).replace(/^./, ch => ch.toUpperCase());
        if (!dim) continue;
        const visible = (c.match(/(?:candidate_text::|\[ACTIVE SUBTEXT[^\]]*\]\s*\n)([\s\S]*?)(?:\}\}\{\{\/if\}\}|\n?\{\{\/if\}\})/) || [])[1];
        const comment = ((c.match(/^\{\{\/\/([\s\S]*?)\}\}/) || [])[1] || '').split('\n').map(x => x.trim()).filter(x => x && !/^Enable|^Pick/.test(x));
        const text = plainName(stripMacros(visible ? visible.replace(/^\[[^\]]*\]\s*/, '') : comment.slice(1).join(' ') || comment.join(' ')));
        if (!roulettes.has(dim)) roulettes.set(dim, { name: dim, items: [], pick: 'one', block: plainName(b.name), source: src(b), adult: false, roulette: true });
        const list = roulettes.get(dim);
        list.items.push({ label: plainName(b.name.split('──').pop()), text: text || plainName(b.name), ...more });
        if (ADULT.test(b.name || '')) list.items[list.items.length - 1].adult = true;
        used.add(b); rouletteUsed.add(b);
        // Nested lists inside a roulette option are offered as sub-lists of that option, unticked.
        for (const r of randomLists(stripComments(c))) {
            const texts = r.items.map(itemText).filter(Boolean);
            const k = classify(texts);
            if (k.kind === 'list') lists.push({ name: `${plainName(b.name)}: ${r.label || 'sub-list'}`, items: toItems(k.items), pick: 'one', block: plainName(b.name), source: src(b), nested: true, adult: ADULT.test(b.name || '') });
        }
    }
    for (const l of roulettes.values()) if (l.items.length) lists.push(l);

    // Menu groups: a header block opens a group; each block after it, until the next header, is one option.
    const groups = (list, outside) => {
        for (let i = 0; i < list.length; i++) {
            if (!isHeader(list[i]) || used.has(list[i])) continue;
            const opts = [];
            // A group ends at the next header, or at a block that reads as rules or holds its own random lists.
            for (let j = i + 1; j < list.length && !isHeader(list[j]); j++) {
                if (/^\s*#|^\s*\d+\.\s/m.test(list[j].content || '') || /\{\{random::/.test(list[j].content || '')) break;
                if (!used.has(list[j]) && !/readme/i.test(list[j].name || '')) opts.push(list[j]);
            }
            if (opts.length < 2) continue;
            const wrap = opts.map(o => (String(o.content || '').match(/<([a-z_]+)>/i) || [])[1]).filter(Boolean);
            const shared = wrap.length >= opts.length / 2 && new Set(wrap).size === 1;
            const items = opts.map(o => ({ label: plainName(String(o.name).replace(/\(.*$/, '')), text: plainName(stripMacros(stripComments(o.content)).replace(/<\/?[a-z_]+>\s*/gi, '').replace(/^\s*-\s*/, '')) || plainName(o.name) })).filter(it => it.label);
            if (items.length < 2) continue;
            // A group is a value list when its header says pick one or pick many, or when most options are short.
            // A group of long toggles is a set of instruction blocks.
            const short = items.filter(it => it.text.length <= MAX_ITEM).length;
            if (!/pick|choose/i.test(list[i].name || '') && short < items.length / 2) continue;
            const name = plainName(String(list[i].name).replace(/\(.*$/, '').replace(/[-─]+/g, ' ')) || 'Menu';
            lists.push({ name, items, pick: pickOf(list[i].name), block: plainName(list[i].name), source: src(list[i]), adult: ADULT.test(list[i].name || '') || opts.some(o => ADULT.test(`${o.name} ${o.content}`)), sharedTag: shared ? wrap[0] : '', ...(outside ? { outside: true } : {}) });
            for (const o of opts) used.add(o);
            used.add(list[i]);
        }
    };
    groups(seq, false);
    // Blocks outside the order are offered under "Not in the preset's order" for her to place.
    const loose = rest.filter(b => !used.has(b) && String(b.content || '').trim() && String(b.content).length < 1200 && !/\{\{random/.test(b.content));
    if (loose.length >= 2) {
        lists.push({ name: "Not in the preset's order", items: loose.map(b => ({ label: plainName(b.name), text: plainName(stripMacros(stripComments(b.content)).replace(/<\/?[a-z_]+>\s*/gi, '')) })), pick: 'many', block: '', source: { file, block: '' }, outside: true, adult: false });
        for (const b of loose) used.add(b);
    }

    // Inline lists, chance gates and the blocks themselves.
    for (const b of [...seq, ...rest]) {
        if (rouletteUsed.has(b) || isHeader(b)) continue;
        const content = String(b.content || '');
        const body = stripComments(content);
        let gate = null; let wordings = null;
        for (const r of randomLists(body)) {
            if (r.nested && !r.label) continue;
            const texts = r.items.map(itemText);
            const k = classify(texts);
            if (k.kind === 'list') lists.push({ name: r.label || plainName(b.name), items: toItems(k.items), pick: 'one', block: plainName(b.name), source: src(b), adult: ADULT.test(`${b.name} ${r.label}`) });
            else if (k.kind === 'chance') gate = { chance: k.chance };
            else if (k.kind === 'wordings') wordings = k.wordings;
        }
        const dice = body.match(/\{\{roll 1d(\d+)\}\}/);
        const after = body.match(/getvar::turn\}\}\s*>=\s*(\d+)/);
        if (!body.trim() || (used.has(b) && !gate && !wordings && !randomLists(body).length)) continue;
        blocks.push({ name: plainName(b.name || b.identifier), text: content, source: src(b), ...(gate ? { chance: gate.chance } : dice ? { chance: Math.round(100 / Number(dice[1])) } : {}),
            ...(after ? { notBefore: Number(after[1]) } : {}), ...(wordings ? { wordings } : {}), ...(inOrder.has(b) ? {} : { outside: true }) });
    }
    return { lists: dedupe(lists), blocks };
}

// ---------- LoreBary plugins ----------

function readPlugin(p, file) {
    const lists = []; const blocks = []; const data = [];
    for (const entry of Object.values(p.entries || {})) {
        const name = plainName(entry.name || entry.comment || `Entry ${entry.uid}`);
        const trig = (entry.triggerGroups || [])[0] || {};
        const timing = { ...(trig.chance != null ? { chance: Number(trig.chance) } : {}), ...(trig.messageCountInterval ? { wait: Number(trig.messageCountInterval) } : {}) };
        for (const action of Object.values(entry.actions || {}).flat()) {
            if (action?.type !== 'add_message' || !Array.isArray(action.pool)) continue;
            const texts = action.pool.map(x => String(typeof x === 'string' ? x : x?.content ?? x?.text ?? ''));
            const k = classify(texts);
            if (k.kind === 'list') lists.push({ name, items: toItems(k.items), pick: 'one', block: name, source: { file, block: name }, adult: ADULT.test(name) });
            else blocks.push({ name, text: k.kind === 'wordings' ? k.wordings[0] : texts.join('\n\n'), source: { file, block: name }, ...(k.kind === 'wordings' ? { wordings: k.wordings } : {}), ...timing });
        }
    }
    for (const agent of p.agents || []) {
        const name = plainName(agent.name || 'Agent');
        const prompt = [agent.systemPrompt, agent.userPromptTemplate].filter(Boolean).join('\n\n');
        blocks.push({ name, text: prompt, source: { file, block: name }, background: true });
        const fields = [...String(agent.userPromptTemplate || '').matchAll(/^([A-Z][A-Z /]{2,}):/gm)].map(m => m[1].trim());
        if (fields.length >= 3) lists.push({ name: `${name}: brief fields`, items: fields.map(f => ({ label: f, text: f })), pick: 'many', block: name, source: { file, block: name }, nested: true, adult: false });
    }
    for (const key of ['variables', 'switches', 'tables']) {
        const v = p[key];
        const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0;
        if (n) data.push({ name: key, count: n });
    }
    return { lists: dedupe(lists), blocks, data };
}

// ---------- Writer's Workbench HTML ----------

function decodeEntities(s) {
    return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function readWorkbench(html, file) {
    const lists = []; const blocks = [];
    // Script text is searched as text for array literals of string pairs. It is never run.
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
    for (const m of scripts.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*\[\s*(\[[\s\S]*?\])\s*\];/g)) {
        const pairs = [...m[2].matchAll(/\[\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\]/g)].map(x => x[2].replace(/\\"/g, '"'));
        const k = classify(pairs);
        if (k.kind === 'list') lists.push({ name: plainName(m[1].replace(/_/g, ' ').toLowerCase()), items: toItems(k.items), pick: 'one', block: m[1], source: { file, block: m[1] }, adult: false });
    }
    // <select> elements with written options.
    const markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    for (const m of markup.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/gi)) {
        const opts = [...m[2].matchAll(/<option[^>]*>([^<]*)<\/option>/gi)].map(x => decodeEntities(x[1]).trim()).filter(t => t && !/^(unspecified|choose|none|select)/i.test(t));
        const k = classify(opts);
        if (k.kind !== 'list') continue;
        const attr = m[1].match(/(?:data-k|id|aria-label)="([^"]+)"/);
        lists.push({ name: plainName((attr?.[1] || 'Options').replace(/[-_]/g, ' ')), items: toItems(k.items), pick: 'one', block: attr?.[1] || 'select', source: { file, block: attr?.[1] || 'select' }, adult: false });
    }
    // Hint lines "Label, then a dash and a comma list" are offered as character-detail lists, unticked.
    const text = decodeEntities(markup.replace(/<[^>]+>/g, '\n'));
    for (const m of text.matchAll(/^\s*([A-Z][A-Za-z ]{2,40})\s+[—–-]\s+([^\n]{10,300})$/gm)) {
        const items = m[2].split(',').map(x => x.trim().replace(/\.$/, '')).filter(Boolean);
        if (items.length >= 3 && items.every(x => x.length <= 60)) lists.push({ name: plainName(m[1]), items: toItems(items), pick: 'many', block: 'Field hint', source: { file, block: 'Field hint' }, nested: true, adult: ADULT.test(m[1]) });
    }
    // Field Manual prose goes to the block bank.
    const manual = text.match(/Field Manual[\s\S]{0,20000}/);
    if (manual) blocks.push({ name: 'Field Manual', text: manual[0].replace(/\n{2,}/g, '\n').trim().slice(0, 20000), source: { file, block: 'Field Manual' } });
    return { lists: dedupe(lists), blocks };
}

// ---------- a plain World Info book ----------

function readWorldBook(book, file) {
    const lists = []; const blocks = [];
    for (const e of Object.values(book.entries || {})) {
        const name = plainName(e.comment || (e.key || [])[0] || `Entry ${e.uid}`);
        const found = randomLists(stripComments(e.content));
        let listed = false;
        for (const r of found) {
            const k = classify(r.items.map(itemText));
            if (k.kind === 'list') { lists.push({ name: r.label || name, items: toItems(k.items), pick: 'one', block: name, source: { file, block: name }, adult: ADULT.test(name) }); listed = true; }
        }
        if (!listed && String(e.content || '').trim()) blocks.push({ name, text: String(e.content), source: { file, block: name } });
    }
    return { lists: dedupe(lists), blocks };
}

/**
 * Read one file she picked. name: its file name; text: its contents as text. Returns
 * { format, lists, blocks, data } where lists start ticked unless adult or nested.
 */
export function readImportFile(name, text) {
    const file = String(name || 'file');
    let result; let format;
    if (/^\s*</.test(text) || /\.html?$/i.test(file)) { format = 'workbench'; result = readWorkbench(String(text), file); }
    else {
        let p;
        try { p = JSON.parse(text); } catch { throw new Error('This file is not JSON or HTML, so nothing could be read from it.'); }
        if (Array.isArray(p?.prompts)) { format = 'preset'; result = readPreset(p, file); }
        else if (p?.entries && (Array.isArray(p.agents) || p.meta?.tag === 'PLUGIN' || p._lorebary)) { format = 'plugin'; result = readPlugin(p, file); }
        else if (p?.entries && typeof p.entries === 'object') { format = 'worldbook'; result = readWorldBook(p, file); }
        else throw new Error('This file is not a Chat Completion preset, a LoreBary plugin, a World Info book or a Writer\'s Workbench page.');
    }
    const lists = result.lists.map((l, i) => ({ ...l, id: `l${i}`, tick: !l.adult && !l.nested && !l.items.some(it => it.adult) }));
    return { format, file, lists, blocks: result.blocks, data: result.data || [] };
}

/** The import group id that marks every item of one import, so they can be filtered and removed together. */
export const importGroup = (file, when = Date.now()) => `import:${String(file).replace(/[^\w.-]+/g, '_').slice(0, 60)}:${when.toString(36)}`;

/**
 * Bank items for one found list, marked with its source and group. target: an existing bank id; the caller makes a
 * new bank for "New dimension".
 */
export function listItems(list, group) {
    const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
    return list.items.map((it, i) => ({ id: `${group}:${slug(list.name)}:${i}:${slug(it.label)}`, label: it.label, text: it.text, on: true, tags: '',
        source: { file: list.source?.file || '', block: list.source?.block || list.block || '', imported: true }, group, ...(it.gate ? { gate: it.gate } : {}) }));
}

/**
 * The block side of an import goes to the block bank (A11, ticket B29). Until that intake is merged this seam reports
 * that the block bank is not there, and nothing is written. intake: the block bank's intake function, when known.
 */
export async function sendBlocksToBlockBank(blocks, intake = null) {
    let take = intake;
    if (!take) {
        try { take = (await import('./preset-bank.js')).intakeBlocks; } catch { take = null; }
    }
    if (typeof take !== 'function') return { sent: 0, waiting: blocks.length, reason: 'The block bank is not installed yet.' };
    await take(blocks.map(b => ({ ...b, origin: 'import' })));
    return { sent: blocks.length, waiting: 0 };
}
