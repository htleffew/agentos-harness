// V1: which words of a reply are spoken, by whom, in what pieces and with what pauses. All of it runs in code.
//
// Spoken dialogue is the text in double quotes. Each quote goes to the nearest named character (Le Paire's split,
// A19 section 2.3): a name the attribution in dialogue.js reads from a speech verb, else the cast name closest to the
// quote in its paragraph (a line of the reply), else the main character. Narration and thoughts are not
// read in V1. A quote is cut into lines of one sentence, or one clause of a long sentence, under about 230
// characters, with numbers and abbreviations spelled out, and each line gets a fixed seed so a replay or a redo of one
// line repeats it (her King County settings, references/voice-chatterbox.md).
import { dialogueAttributions } from '../dialogue.js';

export const MAX_LINE = 230;
/** Pauses after a line, in seconds: her King County values. */
export const PAUSE = Object.freeze({ clause: 0.2, sentence: 0.38, paragraph: 0.7 });

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORDINAL = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
const SCALES = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/** A whole number in words, with a hyphen inside the tens ("forty-two"). */
export function numberWords(value) {
    let n = Math.floor(Math.abs(Number(value)));
    if (!Number.isFinite(n)) return String(value);
    const sign = Number(value) < 0 ? 'minus ' : '';
    if (n < 20) return sign + ONES[n];
    if (n < 100) return sign + TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
    if (n < 1000) return sign + `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`;
    for (const [size, name] of SCALES) {
        if (n >= size) {
            const rest = n % size;
            return sign + `${numberWords(Math.floor(n / size))} ${name}${rest ? ` ${numberWords(rest)}` : ''}`;
        }
    }
    return sign + String(n);
}

/** "first", "twenty-second", "one hundredth". */
export function ordinalWords(value) {
    const words = numberWords(value);
    return words.replace(/([a-z]+)$/, last => ORDINAL[last] || (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`));
}

/** A year read the way people say it: "nineteen ninety-nine", "two thousand five", "twenty twenty-six". */
export function yearWords(year) {
    const n = Number(year);
    if (n >= 2000 && n < 2010) return numberWords(n);
    const high = Math.floor(n / 100), low = n % 100;
    if (low === 0) return `${numberWords(high)} hundred`;
    return `${numberWords(high)} ${low < 10 ? `oh ${numberWords(low)}` : numberWords(low)}`;
}

const digitsWords = text => [...text].map(d => ONES[Number(d)]).join(' ');

/** A decimal in words: "sixty-five point zero". */
function decimalWords(text) {
    const [whole, part] = text.split('.');
    return part === undefined ? numberWords(Number(whole)) : `${numberWords(Number(whole || 0))} point ${digitsWords(part)}`;
}

// Abbreviations a voice model reads badly. Titles are spelled before a capitalised name only.
const TITLES = [[/\bMr\.(?=\s+\p{Lu})/gu, 'Mister'], [/\bMrs\.(?=\s+\p{Lu})/gu, 'Missus'], [/\bMs\.(?=\s+\p{Lu})/gu, 'Miz'],
    [/\bDr\.(?=\s+\p{Lu})/gu, 'Doctor'], [/\bSt\.(?=\s+\p{Lu})/gu, 'Saint'], [/\bProf\.(?=\s+\p{Lu})/gu, 'Professor'],
    [/\bCapt\.(?=\s+\p{Lu})/gu, 'Captain'], [/\bLt\.(?=\s+\p{Lu})/gu, 'Lieutenant'], [/\bSgt\.(?=\s+\p{Lu})/gu, 'Sergeant']];
const WORDS = [[/\bvs\.?(?=\s)/gi, 'versus'], [/\betc\./gi, 'et cetera'], [/\be\.g\.,?/gi, 'for example'], [/\bi\.e\.,?/gi, 'that is'],
    [/\bapprox\./gi, 'about'], [/\s&\s/g, ' and '], [/\bw\/(?=\s)/gi, 'with'], [/\bOK\b/g, 'okay'], [/\bNo\.\s*(?=\d)/g, 'number ']];
const SCALE_WORD = '(?:thousand|million|billion|trillion)';

/** Numbers, money, percentages, times, ordinals and abbreviations spelled out, so the voice reads them as people do. */
export function spellOut(input) {
    let text = String(input ?? '');
    for (const [pattern, word] of [...TITLES, ...WORDS]) text = text.replace(pattern, word);
    text = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
    text = text.replace(new RegExp(`([$£€])\\s?(\\d+(?:\\.\\d+)?)(?:\\s?(${SCALE_WORD}|[kKmMbB])\\b)?`, 'g'), (_, mark, amount, scale) => {
        const unit = { $: 'dollars', '£': 'pounds', '€': 'euros' }[mark];
        const big = { k: 'thousand', m: 'million', b: 'billion' }[String(scale || '').toLowerCase()] || scale || '';
        if (!big && /\.\d\d$/.test(amount)) {
            const [whole, cents] = amount.split('.');
            const centWord = { $: 'cents', '£': 'pence', '€': 'cents' }[mark];
            return `${numberWords(Number(whole))} ${unit}${Number(cents) ? ` and ${numberWords(Number(cents))} ${centWord}` : ''}`;
        }
        return `${decimalWords(amount)}${big ? ` ${big}` : ''} ${unit}`;
    });
    text = text.replace(/(\d+(?:\.\d+)?)\s?%/g, (_, n) => `${decimalWords(n)} percent`);
    text = text.replace(/\b(\d{1,2}):(\d{2})(?:\s?([ap])\.?m\.?)?/gi, (_, hour, minute, half) => {
        const m = Number(minute);
        const tail = half ? ` ${half.toLowerCase() === 'a' ? 'a m' : 'p m'}` : '';
        return `${numberWords(Number(hour))} ${m === 0 ? (half ? '' : "o'clock") : m < 10 ? `oh ${numberWords(m)}` : numberWords(m)}`.trim() + tail;
    });
    text = text.replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n) => ordinalWords(Number(n)));
    text = text.replace(/\b(1[1-9]\d\d|20\d\d)s\b/g, (_, year) => yearWords(year).replace(/([a-z]+)$/, last => last.endsWith('y') ? `${last.slice(0, -1)}ies` : `${last}s`));
    text = text.replace(/(?<!\d|\d\.)\b(1[1-9]\d\d|20\d\d)\b(?!\d|\.\d)/g, (_, year) => yearWords(year));
    text = text.replace(/(?<!\d|\d\.)(\d+\.\d+|\d+)(?!\d|\.\d)/g, value => decimalWords(value));
    return text.replace(/[ \t]{2,}/g, ' ');
}

/**
 * A quote's speech cut into lines: one sentence each, a sentence over the limit cut at the clause mark nearest its
 * middle (then at the space nearest it), so no piece is rendered cold. Each line says how it ends.
 */
export function splitLines(quote, max = MAX_LINE) {
    const text = String(quote || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g)?.map(s => s.trim()).filter(Boolean) || [text];
    const out = [];
    const cut = sentence => {
        if (sentence.length <= max) { out.push({ text: sentence, end: 'sentence' }); return; }
        const middle = sentence.length / 2;
        const marks = [...sentence.matchAll(/[,;:—–]\s/g)].map(m => m.index + 1).filter(i => i > 20 && i < sentence.length - 20);
        const spaces = [...sentence.matchAll(/\s/g)].map(m => m.index);
        const pick = list => list.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
        const at = pick(marks) ?? pick(spaces) ?? max;
        const head = sentence.slice(0, at).trim(), tail = sentence.slice(at).trim();
        if (head.length > max) cut(head); else out.push({ text: head, end: 'clause' });
        cut(tail);
    };
    for (const sentence of sentences) cut(sentence);
    return out;
}

/** A 31-bit seed fixed by the line and the voice, so the same line in the same voice always starts the same way. */
export function seedFor(text, voice = '') {
    let hash = 0x811c9dc5;
    for (const ch of `${voice}\u0000${text}`) {
        hash ^= ch.codePointAt(0);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash & 0x7fffffff;
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const compare = name => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The cast member a name means: a full name, or the first word of a cast name. */
export function castMember(name, cast) {
    const want = compare(name);
    if (!want) return null;
    return cast.find(member => compare(member.name) === want) || cast.find(member => compare(member.name).split(' ')[0] === want) || null;
}

/** Where each cast name (full or first word) appears in a stretch of text outside quotes: [{ member, start, end }]. */
function mentions(text, cast, quotes) {
    const found = [];
    for (const member of cast) {
        const forms = [...new Set([member.name, String(member.name).split(/\s+/)[0]].filter(form => form && form.length > 1))];
        for (const form of forms) {
            for (const match of text.matchAll(new RegExp(`(?<![\\p{L}])${escape(form)}(?![\\p{L}])`, 'gu'))) {
                const start = match.index, end = start + match[0].length;
                if (quotes.some(q => start >= q.start && start < q.end)) continue;
                found.push({ member, start, end });
            }
        }
    }
    return found;
}

/**
 * The spoken quotes of a reply with their speakers: [{ text, speaker, how, paragraph }]. cast is
 * [{ name, key }]; main is the cast member who speaks an unattributed quote. how says which rule chose the speaker.
 */
export function quoteSpeakers(reply, { cast = [], main = null } = {}) {
    const text = String(reply || '');
    const spans = dialogueAttributions(text);
    const quotes = spans.map(span => ({ start: span.start, end: span.end }));
    const names = mentions(text, cast, quotes);
    const out = [];
    for (const span of spans) {
        // A paragraph is a line of the reply; quotes never cross a line break.
        const lineStart = text.lastIndexOf('\n', span.start - 1) + 1;
        const paragraph = (text.slice(0, lineStart).match(/\n+/g) || []).length;
        const lineEndAt = text.indexOf('\n', span.end);
        const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
        let speaker = null, how = '';
        const attributed = castMember(span.name, cast);
        if (attributed) { speaker = attributed; how = 'named'; }
        if (!speaker) {
            const near = names.filter(item => item.start >= lineStart && item.end <= lineEnd)
                .map(item => ({ ...item, distance: item.end <= span.start ? span.start - item.end : item.start - span.end }))
                .sort((a, b) => a.distance - b.distance)[0];
            if (near) { speaker = near.member; how = 'nearest name'; }
        }
        if (!speaker && main) { speaker = main; how = 'main character'; }
        const inner = text.slice(span.start + 1, span.end - 1).trim();
        out.push({ text: inner, speaker, how, paragraph, start: span.start, end: span.end });
    }
    return out;
}

/**
 * The lines a reply is read in: [{ text, said, speaker, how, pause, seedText }]. said is the quote as written; text is
 * the spelled-out line the voice reads. pause is the silence after the line.
 */
export function replyLines(reply, options = {}) {
    const quotes = quoteSpeakers(String(reply || '').replace(/\*+([^*\n]+)\*+/g, '$1'), options);
    const lines = [];
    quotes.forEach((quote, index) => {
        const next = quotes[index + 1];
        const pieces = splitLines(spellOut(quote.text), options.max || MAX_LINE);
        pieces.forEach((piece, at) => {
            const last = at === pieces.length - 1;
            const pause = !last ? PAUSE[piece.end] : !next ? 0 : next.paragraph !== quote.paragraph ? PAUSE.paragraph : PAUSE.sentence;
            lines.push({ text: piece.text, said: quote.text, speaker: quote.speaker, how: quote.how, pause });
        });
    });
    return lines.filter(line => /[\p{L}\p{N}]/u.test(line.text));
}
