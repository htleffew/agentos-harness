// Undercurrent 2: envelope parser (BUILD_SPEC §3.1). Pure; never throws.
//
// Finds the LAST <UC> section in a raw message (missing </UC> tolerated), or, when there is no wrapper, a run of known
// block tags at the very end of the message. Inside, each known block runs to its close tag, or (missing close) to the
// next known tag / the end, and is flagged truncated. Reasoning (<think>…</think>) is ignored so a drafted envelope in
// the model's thinking never counts.
//
// Result: { ok, found: 'wrapped'|'bare'|'none', truncated, blocks: [{id, tag, attrs, body, lines, truncated}] }

import { CORE_BLOCKS, normTag, tagPattern } from './registry.js';

const matcherCache = new Map();

function matcherFor(registry) {
    const list = (Array.isArray(registry) && registry.length ? registry : CORE_BLOCKS).filter(b => b && b.tag);
    const key = list.map(b => `${b.id}:${b.tag}:${b.repeating ? 1 : 0}`).join('|');
    if (matcherCache.has(key)) return matcherCache.get(key);
    const byNorm = new Map();
    for (const b of list) byNorm.set(normTag(b.tag), b);
    const alt = list.map(b => tagPattern(b.tag)).join('|');
    const m = {
        byNorm,
        open: new RegExp(`<\\s*(${alt})(?=[\\s>/:=])([^>\\n]*)>`, 'gi'),
        close: new RegExp(`<\\s*\\/\\s*(${alt})\\s*>`, 'gi'),
    };
    if (matcherCache.size > 32) matcherCache.clear();
    matcherCache.set(key, m);
    return m;
}

const UC_OPEN = /<\s*UC(?:\s[^>\n]*)?\s*>/gi;
const UC_CLOSE = /<\s*\/\s*UC\s*>/i;

function decodeEntities(text) {
    return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
}

/** Remove reasoning sections. An unclosed leading <think> means the whole text is reasoning, keep only what follows none. */
function stripReasoning(text) {
    let t = text.replace(/<\s*(think|thinking|reasoning)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    // A dangling close (the opening was stripped by the API, e.g. reasoning returned separately): drop everything before it.
    const dangling = t.search(/<\s*\/\s*(think|thinking|reasoning)\s*>/i);
    if (dangling >= 0 && !/<\s*(think|thinking|reasoning)\s*>/i.test(t.slice(0, dangling))) {
        t = t.slice(t.indexOf('>', dangling) + 1);
    }
    return t;
}

const QUOTED_ATTR = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|“([^”]*)”|([^\s>"']+))/g;

function parseAttrs(raw) {
    const attrs = {};
    const s = String(raw ?? '');
    let m;
    QUOTED_ATTR.lastIndex = 0;
    while ((m = QUOTED_ATTR.exec(s))) {
        const v = m[2] ?? m[3] ?? m[4] ?? m[5] ?? '';
        attrs[m[1].toLowerCase()] = v.trim();
    }
    if (!attrs.name) {
        // <Intimacy: Name> or <Intimacy Name>
        const bare = s.replace(QUOTED_ATTR, '').replace(/^[\s:=-]+/, '').replace(/["'“”/]+/g, '').trim();
        if (bare && !/=/.test(bare)) attrs.name = bare;
    }
    return attrs;
}

const NOISE_LINE = /^(?:```[\w-]*|---+|\*\*\*+|<\/?\s*(?:details|summary)[^>]*>)$/i;

function cleanBody(body) {
    return String(body ?? '')
        .replace(/<\s*\/?\s*UC\s*>/gi, '')
        .replace(/<\s*\/?\s*(details|summary)[^>]*>/gi, '')
        .replace(/^\s*```[\w-]*\s*$/gm, '')
        .trim();
}

function splitLines(body) {
    return body.split(/\r?\n/).map(l => l.trim()).filter(l => l && !NOISE_LINE.test(l));
}

/** All known opening tags in `text` with positions. */
function findOpens(text, matcher) {
    const out = [];
    const re = matcher.open;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
        const block = matcher.byNorm.get(normTag(m[1]));
        if (!block) continue;
        const selfClosing = /\/\s*$/.test(m[2]);
        out.push({ block, index: m.index, end: m.index + m[0].length, attrRaw: selfClosing ? m[2].replace(/\/\s*$/, '') : m[2], selfClosing });
    }
    return out;
}

/** First close tag for `block` at or after `from`; {index, end} or null. */
function findClose(text, block, from, matcher) {
    const re = matcher.close;
    re.lastIndex = from;
    let m;
    while ((m = re.exec(text))) {
        if (matcher.byNorm.get(normTag(m[1])) === block) return { index: m.index, end: m.index + m[0].length };
    }
    return null;
}

/** Scan a region into blocks. */
function scanBlocks(text, matcher, opens = findOpens(text, matcher)) {
    const blocks = [];
    for (let i = 0; i < opens.length; i++) {
        const o = opens[i];
        const nextOpen = i + 1 < opens.length ? opens[i + 1].index : -1;
        let body;
        let truncated = false;
        let end;
        if (o.selfClosing) {
            body = '';
            end = o.end;
        } else {
            const close = findClose(text, o.block, o.end, matcher);
            if (close && (nextOpen < 0 || close.index <= nextOpen)) {
                body = text.slice(o.end, close.index);
                end = close.end;
            } else {
                const stop = nextOpen < 0 ? text.length : nextOpen;
                body = text.slice(o.end, stop);
                end = stop;
                truncated = true;
            }
        }
        const attrs = o.block.repeating ? parseAttrs(o.attrRaw) : {};
        const cleaned = cleanBody(body);
        let lines = splitLines(cleaned);
        if (o.block.repeating && !attrs.name && lines.length) {
            const nm = lines[0].match(/^\**\s*name\s*\**\s*[:=]\s*(.+)$/i);
            if (nm) {
                attrs.name = nm[1].replace(/["'“”*]/g, '').trim();
                lines = lines.slice(1);
            }
        }
        blocks.push({ id: o.block.id, tag: o.block.tag, attrs, body: cleaned, lines, truncated, index: o.index, end });
    }
    return blocks;
}

function dedupe(blocks, matcher) {
    const repeating = new Set([...matcher.byNorm.values()].filter(b => b.repeating).map(b => b.id));
    const lastIdx = new Map();
    blocks.forEach((b, i) => { if (!repeating.has(b.id)) lastIdx.set(b.id, i); });
    return blocks
        .filter((b, i) => repeating.has(b.id) || lastIdx.get(b.id) === i)
        .map(b => ({ id: b.id, tag: b.tag, attrs: b.attrs, body: b.body, lines: b.lines, truncated: b.truncated }));
}

const TAIL_NOISE = /^(?:\s|```[\w-]*|<\s*\/\s*UC\s*>|---+)*$/i;

/** Blocks at the very end of the text without a <UC> wrapper. */
function bareTail(text, matcher) {
    const opens = findOpens(text, matcher);
    if (!opens.length) return null;
    const all = scanBlocks(text, matcher, opens);
    // Walk back from the last block while blocks are contiguous (only whitespace/noise between them).
    const last = all[all.length - 1];
    if (!TAIL_NOISE.test(text.slice(last.end))) return null;
    let start = all.length - 1;
    while (start > 0) {
        const gap = text.slice(all[start - 1].end, all[start].index);
        if (!TAIL_NOISE.test(gap)) break;
        start--;
    }
    return all.slice(start);
}

/**
 * Parse the envelope out of a raw reply.
 * @param {string} raw chat[i].mes
 * @param {object[]} [registry] blockRegistry(content); defaults to the core blocks
 */
export function parseEnvelope(raw, registry = null) {
    try {
        let text = typeof raw === 'string' ? raw : String(raw ?? '');
        if (!text) return { ok: false, found: 'none', truncated: false, blocks: [] };
        if (!/<\s*UC/i.test(text) && /&lt;/i.test(text)) text = decodeEntities(text);
        text = stripReasoning(text);
        const matcher = matcherFor(registry);

        const opens = [];
        UC_OPEN.lastIndex = 0;
        let m;
        while ((m = UC_OPEN.exec(text))) opens.push({ index: m.index, end: m.index + m[0].length });
        for (let i = opens.length - 1; i >= 0; i--) {
            const after = text.slice(opens[i].end);
            const close = after.search(UC_CLOSE);
            const region = close >= 0 ? after.slice(0, close) : after;
            const blocks = dedupe(scanBlocks(region, matcher), matcher);
            if (blocks.length) return { ok: true, found: 'wrapped', truncated: close < 0, blocks };
        }
        const tail = bareTail(text, matcher);
        if (tail && tail.length) return { ok: true, found: 'bare', truncated: false, blocks: dedupe(tail, matcher) };
        return { ok: false, found: opens.length ? 'wrapped' : 'none', truncated: false, blocks: [] };
    } catch (error) {
        return { ok: false, found: 'none', truncated: false, blocks: [], error: String(error?.message || error) };
    }
}

/** Remove every envelope (and stray block tags) from a text: for job context and display cleaners. */
export function stripEnvelope(raw, registry = null) {
    try {
        let t = String(raw ?? '');
        t = t.replace(/<\s*UC(?:\s[^>\n]*)?\s*>[\s\S]*?(?:<\s*\/\s*UC\s*>|$)/gi, '');
        const tail = bareTail(t, matcherFor(registry));
        if (tail && tail.length) t = t.slice(0, tail[0].index);
        return t.trim();
    } catch {
        return String(raw ?? '');
    }
}

