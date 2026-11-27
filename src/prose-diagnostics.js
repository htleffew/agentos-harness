import { DEFAULT_STORY_AVOID, STORY_BOOKKEEPING_WORDS } from './defaults.js';
import { storyRevision } from './history-source.js';
import { ctx, KEY, isReply, isStory, sub } from './st.js';
import { playerContribution as authoredContribution } from './quick-action-chat.js';
import { promptText } from './prompts.js';

const WINDOW = 5;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const COMMON = new Set('about above after again along also been before being both down from have here into just like more most over same some such than that them then there these they this those through very were what when where which while will with would your'.split(' '));
const NOTES_TAG = /<writing_notes\b[^>]*>[\s\S]*?(?:<\/writing_notes\s*>|$)/gi;
const OOC = /^[\s(\[<*]*OOC\b/i;
const REACTION = /\b(?:jaw (?:worked|locked|clenched|tightened)|knuckles (?:whitened|went white)|breath (?:caught|hitched)|throat (?:closed|tightened)|lips parted|shoulders (?:lifted|tensed|tightened)|fingers (?:curled|tightened)|heart (?:raced|hammered)|swallowed hard|clenched (?:his|her|their) jaw)\b/i;

const patterns = {
    echo: ['echoed a span of player wording', 'Answer the player’s meaning in the speaker’s own words.'],
    opening: ['used the same opening words', 'Open with the character’s answer, choice or a concrete change in the scene.'],
    reaction: ['opened with a familiar physical reaction', 'Open with an answer, a practical action or a change in the surroundings.'],
    'reaction-echo': ['opened with a physical reaction followed by an echo of the player', 'Open with the character’s answer, choice or a concrete change in the scene. Respond in the character’s own words.'],
    question: ['ended with a question', 'Close on a decision, action or change that gives the player something to respond to.'],
    sentence: ['repeated a full sentence from the recent scene', 'Advance the current moment with a fresh action or answer.'],
    wording: ['used wording on the local preference list', 'Show the consequence through a specific action, decision or reply.'],
    bookkeeping: ['used administrative wording', 'Describe the concrete consequence or the character’s next decision in plain language.'],
    narration: ['repeated negative clauses in narration', 'Describe what the character actually says, does or notices. Preserve an absence or refusal when it changes the scene.'],
    recap: ['restated details the scene had already established', 'Start from what the characters know and move their situation forward.'],
    voice: ['gave distinct speakers interchangeable phrasing', 'Give each speaker words that fit their relationship, goal and way of speaking.'],
    pacing: ['paused the action at the same point in a scene beat', 'Let the action alter the situation before the next reflective beat.'],
};

const semanticPatterns = ['reaction-echo', 'recap', 'voice', 'pacing', 'narration'];
const bookkeepingWords = new Set(STORY_BOOKKEEPING_WORDS);

function words(text) {
    return String(text ?? '').normalize('NFKC').toLowerCase().replaceAll('’', "'")
        .replace(/<\/?(?:em|i|strong|b|p|br|blockquote|q|div|span)\b[^>]*>/g,' ')
        .replace(/&(?:l[ds]quo|r[ds]quo|quot|apos|nbsp);/g,' ').match(WORD) || [];
}

function phrase(text) { return words(text).join(' '); }
const padded = text => ` ${phrase(text)} `;
const exactPhrase = (text, quoted) => quoted && padded(text).includes(` ${quoted} `);
const contentWords = tokens => tokens.filter(token => token.length > 3 && !COMMON.has(token));
const sameRevision = (left, right) => left?.turn === right?.turn && left?.swipe === right?.swipe && left?.fingerprint === right?.fingerprint;
const sourceKey = source => JSON.stringify([source.turn, source.swipe, source.fingerprint]);

function plain(value) {
    return extractProseNotes(value).text
        .replace(/\s*<(sent_instructions|story_update|reply_plan|tracker|thinking|think|analysis|roast)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
        .trim();
}

function playerContribution(chat, index) {
    for (let at = index - 1; at >= 0; at--) {
        const message = chat[at];
        if (isStory(message) && message.is_user) {
            const text = authoredContribution(message);
            return OOC.test(text) ? '' : plain(text);
        }
    }
    return '';
}

function timeline(chat, end = chat.length) {
    const rows = [];
    for (let index = end - 1; index >= 0 && rows.length < WINDOW; index--) {
        const message = chat[index];
        if (!isReply(message)) continue;
        const prose = plain(message.mes);
        if (!prose || OOC.test(prose) || message.extra?.[KEY]?.proseDiagnostics?.story === false) continue;
        const source = storyRevision({ ...message, mes: prose }, index);
        rows.push({ index, prose, source, hidden: message.is_system, player: playerContribution(chat, index), saved: message.extra?.[KEY]?.proseDiagnostics });
    }
    return rows.reverse();
}

// A shared entity or topic is insufficient. Compare contiguous word spans after removing formatting and punctuation.
export function playerEcho(prose, contribution) {
    const left = words(prose);
    const right = words(contribution);
    const width = 7;
    if (left.length < width || right.length < width) return null;
    const starts = new Map();
    for (let index = 0; index <= right.length - width; index++) {
        const span = right.slice(index, index + width);
        if (contentWords(span).length >= 3) {
            const key = span.join(' ');
            if (!starts.has(key)) starts.set(key, index);
        }
    }
    for (let index = 0; index <= left.length - width; index++) {
        const match = starts.get(left.slice(index, index + width).join(' '));
        if (match === undefined) continue;
        let length = width;
        while (length < 14 && left[index + length] !== undefined && left[index + length] === right[match + length]) length++;
        return { at: index, text: left.slice(index, index + length).join(' ') };
    }
    return null;
}

function strictTerms(prose, avoid) {
    const text = padded(prose);
    const terms = String(avoid ?? DEFAULT_STORY_AVOID).split(/\r?\n/)
        .map(term => term.trim()).filter(Boolean);
    return [...new Map(terms.map(term => [phrase(term), term]))]
        .filter(([key]) => key && text.includes(` ${key} `));
}
const sentenceWords = prose => prose.split(/(?<=[.!?])\s+/).map(phrase).filter(text => words(text).length >= 7);
const firstSeven = prose => words(prose).slice(0, 7).join(' ');
const endsWithQuestion = prose => /\?[”"'’*\])]*\s*$/.test(prose);

function localMatches(row, rows, avoid) {
    const { prose, player } = row;
    const echo = playerEcho(prose, player);
    const opening = firstSeven(prose);
    const sentences = sentenceWords(prose);
    const matches = new Map();
    const recentMatches = new Map();
    const mark = (kind, evidence) => { matches.set(kind, evidence); };
    const markRepeating = (kind, evidence, related) => {
        if (!related.length) return;
        mark(kind,evidence);
        recentMatches.set(kind,related.map(other=>other.source));
    };
    if (echo) mark('echo', echo.text);
    const initialBeat = words(prose).slice(0, 16).join(' ');
    const reaction = initialBeat.match(REACTION)?.[0];
    if (reaction) {
        mark('reaction', reaction);
        if (echo?.at >= words(initialBeat.slice(0, initialBeat.indexOf(reaction))).length + words(reaction).length && echo.at < 42) {
            mark('reaction-echo', `${reaction} · ${echo.text}`);
        }
    }
    if (words(opening).length === 7) markRepeating('opening',opening,rows.filter(other=>other!==row && firstSeven(other.prose)===opening));
    if (endsWithQuestion(prose)) mark('question', prose.slice(-100));
    const repeatedSentence = sentences.find((sentence,index) => sentences.indexOf(sentence) < index);
    if (repeatedSentence) mark('sentence', repeatedSentence);
    const sameSentences = rows.filter(other=>other!==row && sentenceWords(other.prose).some(sentence=>sentences.includes(sentence)));
    if (sameSentences.length) markRepeating('sentence', sentences.find(sentence=>sameSentences.some(other=>sentenceWords(other.prose).includes(sentence))), sameSentences);
    const avoidMatches = strictTerms(prose, avoid);
    for (const [kind, family] of [['bookkeeping', true], ['wording', false]]) {
        const hits = avoidMatches.filter(([key]) => bookkeepingWords.has(key) === family).map(([,term]) => term);
        if (hits.length) mark(kind, hits.join(', '));
    }
    const narration = prose.replace(/“[^”]*”|"[^"\n]*"/g, '');
    const negative = narration.match(/\b(?:he|she|they|it|i)\s+(?:didn['’]t|did not)\b/gi) || [];
    const stacked = narration.match(/\bnot\s+[^,.!?;\n]{2,65},\s+not\s+[^,.!?;\n]{2,65}/i)?.[0];
    if (negative.length >= 2 || stacked) mark('narration', stacked || negative.join(' · '));
    return { matches, recentMatches };
}

function metricsFor(prose) {
    const count = words(prose).length;
    const quoted = [...prose.matchAll(/“([^”]+)”|"([^"\n]+)"/gu)].reduce((sum, match) => sum + words(match[1] || match[2]).length, 0);
    return { words: count, dialogue: count ? Math.round(quoted / count * 100) : 0 };
}

function localNotes(row, rows, avoid) {
    const { matches } = localMatches(row, rows, avoid);
    const malformed = row.prose.split('\n').filter(line=>/^\[[^\]\n]{1,64}\][ \t]*[“"]/.test(line) && !/(?:“[^”]+”|"[^"]+")/.test(line)).length;
    const labels = {
        echo: 'Player wording echoed',
        opening: 'Opening repeated',
        reaction: 'Familiar physical reaction in the opening',
        'reaction-echo': 'Physical reaction followed by echoed player wording',
        question: 'Question ending',
        sentence: 'Repeated sentence',
        wording: 'Stock phrases matched',
        bookkeeping: 'Bookkeeping word-family matches',
        narration: 'Narration to check for repeated negative clauses',
    };
    const notes = [...matches].flatMap(([kind,evidence]) => {
        if (kind === 'question' && rows.filter(other=>endsWithQuestion(other.prose)).length < 3) return [];
        return [`${labels[kind]} · ${evidence.slice(0,240)}`];
    });
    if (malformed) notes.unshift(`${malformed} speaker line${malformed === 1 ? '' : 's'} with unclosed quotation marks.`);
    return notes;
}

export function extractProseNotes(raw, { streaming = false } = {}) {
    const value = String(raw ?? '');
    const tagged = [...value.matchAll(NOTES_TAG)];
    let text = tagged.length ? value.replace(NOTES_TAG, '').trimEnd() : value;
    const partial = streaming && /\s*<\/?([a-z_]*)$/i.exec(text);
    if (partial && 'writing_notes'.startsWith(partial[1].toLowerCase())) text = text.slice(0,partial.index);
    const payload = tagged.length === 1 && /^<writing_notes\s*>([\s\S]{0,12000})<\/writing_notes\s*>$/i.exec(tagged[0][0])?.[1];
    let parsed;
    if (payload) {
        try { parsed = JSON.parse(payload); } catch { /* keep the prose and use local diagnostics */ }
    }
    return { text, findings: Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 5) : [], found: tagged.length > 0 };
}

function auditedFindings(raw, candidates, confirmed) {
    if (!candidates.length || confirmed === false) return [];
    const byKind = new Map();
    for (const candidate of raw) {
        const kind = candidate?.pattern;
        if (!semanticPatterns.includes(kind) || !Array.isArray(candidate.examples)) continue;
        const evidence = byKind.get(kind) || new Map();
        for (const item of candidate.examples.slice(0, WINDOW)) {
            const row = candidates.find(entry=>entry.label===item?.reply && entry.sent !== false);
            const text = typeof item?.evidence === 'string' ? item.evidence.trim() : '';
            const tokens = words(text);
            if (!row || text.length > 260 || tokens.length < 5 || contentWords(tokens).length < 2 || !exactPhrase(row.prose, tokens.join(' '))) continue;
            evidence.set(sourceKey(row.source), { source: row.source, text, label: row.label });
        }
        if (evidence.size) byKind.set(kind,evidence);
    }
    return [...byKind].map(([kind,evidence])=>({ kind, evidence:[...evidence.values()] })).slice(0, 3);
}

function liveAudits(rows, owner) {
    if (!sameRevision(owner.source, owner.saved?.source)) return [];
    return (owner.saved.audits || []).flatMap(audit => {
        const evidence = audit.evidence.filter(example => rows.some(row => sameRevision(row.source, example.source) && exactPhrase(row.prose, phrase(example.text))));
        return evidence.length ? [{ kind:audit.kind, evidence }] : [];
    });
}

function nudgeFor(rows, owner, avoid) {
    const byKind = new Map();
    const results = rows.map(row => localMatches(row, rows, avoid));
    const { matches, recentMatches } = results.at(-1);
    for (const kind of matches.keys()) {
        const evidence = recentMatches.get(kind) ?? results.flatMap((result,index) => result.matches.has(kind) ? [rows[index].source] : []);
        const distinct = new Map([...evidence,owner.source].map(source=>[sourceKey(source),source]));
        const min = kind==='question' ? 3 : ['opening','reaction','reaction-echo'].includes(kind) ? 2 : 1;
        if (distinct.size >= min) byKind.set(kind, distinct);
    }
    for (const { kind, evidence } of liveAudits(rows, owner)) {
        const distinct = byKind.get(kind) || new Map();
        for (const example of evidence) distinct.set(sourceKey(example.source), example.source);
        byKind.set(kind, distinct);
    }
    if (byKind.has('reaction-echo')) {
        byKind.delete('echo');
        byKind.delete('reaction');
    }
    return [...byKind].sort((a,b)=>b[1].size-a[1].size).slice(0,3).map(([kind,evidence])=>({
        kind, count:evidence.size, window:rows.length, sources:[...evidence.values()],
    }));
}

function nudgeText(nudge) {
    const [observed, direction] = patterns[nudge.kind];
    return `${nudge.count} of the last ${nudge.window} story replies ${observed}. This reply: ${direction}`;
}

function auditPrompt(count) {
    if (count < 2) return '';
    return [
        promptText('proseReview',{count}),
        'Use reaction-echo for a physical reaction followed by the player’s wording; recap for repeated explanations; voice for speakers sharing the same voice; pacing for scenes losing forward motion; narration for negative descriptions whose removal preserves meaning.',
        '<writing_notes>{"findings":[{"pattern":"recap","examples":[{"reply":"R1","evidence":"exact words from that story reply"}]}]}</writing_notes>',
    ].join('\n');
}

/** Run during an ordinary reply only. Source excerpts and configured preference words remain local. */
export function prepareProseDiagnostics(chat, {mode, audit = false, fresh = false, state, avoid, connection} = {}) {
    if (mode !== 'normal' || fresh) return null;
    const rows = timeline(chat);
    const owner = rows.at(-1);
    if (!owner) return null;
    const chatId = String(ctx().getCurrentChatId?.() || '');
    const key = sourceKey(owner.source);
    const ledger = state?.proseDiagnostics;
    const spent = ledger?.chatId === chatId && (ledger.spent || []).includes(key);
    const nudge = spent ? [] : nudgeFor(rows, owner, avoid);
    const candidates = audit ? rows.filter(row=>!row.hidden).map((row,index)=>({ ...row, saved:undefined, label:`R${index+1}` })) : [];
    const ask = auditPrompt(candidates.length);
    const nudgePrompt = nudge.length ? ['Current writing guidance', ...nudge.map(nudgeText)].join('\n') : '';
    const prompt = [ask,nudgePrompt].filter(Boolean).join('\n');
    if (!prompt) return null;
    return { prompt, chatId, owner:owner.source, key, nudge, nudgePrompt, candidates:ask ? candidates : [], connection };
}

export function confirmProseDiagnostics(plan, messages) {
    if (!plan || !Array.isArray(messages)) return;
    const all = messages.flatMap(({ content })=>Array.isArray(content) ? content.map(part=>part?.text || '') : typeof content==='string' ? [content] : []);
    const full = all.join('\n');
    plan.confirmed = full.includes(sub(plan.prompt).trim());
    plan.nudgeConfirmed = !!plan.nudgePrompt && full.includes(plan.nudgePrompt);
    const history = messages.filter(row=>row.role==='assistant').flatMap(row=>Array.isArray(row.content) ? row.content.map(part=>part?.text || '') : [row.content]);
    for (const candidate of plan.candidates) {
        const sample = words(candidate.prose).slice(-12).join(' ');
        candidate.sent = !!sample && history.some(content=>exactPhrase(content,sample));
    }
}

/** Called after cleaning and accepting prose. Consume one-use guidance only after that acceptance. */
export function acceptProseDiagnostics(chat, index, {plan, findings = [], avoid, metrics = false, legacyNotes = [], eligible = true, state} = {}) {
    if (!eligible) return { story:false };
    const chatId = String(ctx().getCurrentChatId?.() || '');
    if (plan && plan.chatId !== chatId) plan = null;
    const rows = timeline(chat, index+1);
    const owner = rows.at(-1);
    if (owner?.index !== index) return null;
    const audits = auditedFindings(findings, plan?.candidates || [], plan?.confirmed);
    const notes = [...legacyNotes.filter(note=>note.startsWith('New NPC names')), ...localNotes(owner, rows, avoid)];
    const delivered = plan?.nudge.length > 0 && plan.nudgeConfirmed !== false;
    const delivery = plan?.nudge.length ? {
        owner:plan.owner, outcome:plan.nudgeConfirmed===true ? 'confirmed' : delivered ? 'selected' : 'omitted', findings:plan.nudge,
    } : null;
    if (delivered && state) {
        const ledger = state.proseDiagnostics;
        const previous = ledger?.chatId === chatId ? ledger.spent || [] : [];
        state.proseDiagnostics = { chatId, spent:[...new Set([...previous, plan.key])].slice(-40) };
    }
    return {
        story:true, source:owner.source, notes, audits, delivery,
        auditRequested:!!plan?.candidates.length,
        auditConfirmed:plan?.confirmed ?? null,
        connection:plan?.connection ?? null,
        metrics:metrics ? metricsFor(owner.prose) : null,
    };
}

/** Revalidate each displayed evidence item against the currently selected revisions. */
export function proseDiagnosticsNotes(chat, index, {avoid, metrics = false} = {}) {
    const saved = chat[index]?.extra?.[KEY]?.proseDiagnostics;
    if (!saved?.story) return null;
    // Later edits and swipes can change the active evidence of an earlier review. Retain its original receipt.
    const atReply = timeline(chat,index+1);
    const owner = atReply.at(-1);
    if (owner?.index !== index) return null;
    const current = sameRevision(owner.source,saved.source);
    const notes = current ? saved.notes : localNotes(owner,atReply,avoid);
    const details = [];
    if (current) for (const audit of saved.audits) {
        const active = liveAudits(atReply,owner).find(finding=>finding.kind===audit.kind)?.evidence || [];
        const label = patterns[audit.kind][0];
        details.push({
            heading:`Model review · ${active.length} of ${audit.evidence.length} cited replies still support: ${label}`,
            items:audit.evidence.map(item=>`${item.label} · ${item.text}${active.some(example=>sameRevision(example.source,item.source)) ? '' : ' (revision changed)'}`),
        });
    }
    if (current && saved.delivery) {
        const outcome = {confirmed:'Included in the reply request', selected:'Selected for the reply request (delivery unavailable)', omitted:'Omitted by SillyTavern'}[saved.delivery.outcome];
        details.push({ heading:`Writing guidance · ${outcome}`,items:saved.delivery.findings.map(nudgeText) });
    }
    return { notes, details, metrics:metrics ? metricsFor(owner.prose) : current ? saved.metrics : null,
        auditRequested:current && saved.auditRequested, auditConfirmed:saved.auditConfirmed,
        usedReply:current && (!!saved.delivery || saved.auditRequested), connection:saved.connection };
}
