// Undercurrent ports — critic: a free code-side rule-violation detector that runs on every reply, plus an optional
// hidden critic pass (default off) that reviews the last reply against the user's rules and returns 0–3 concrete
// corrections for the next turn. Pure logic: builds messages and parses results; index.js sends the hidden call.
//
// Reproduces, natively, the post-reply editor/auditor of an erotica plugin (audit only the newest reply, return a
// short structured verdict) and the prose-auditor/character-anchor agents plus tic detection of a romance engine
// (code-side families with escalating wording; corrections are orders for the NEXT reply only).
//
// Code checks (all heuristics, all knobs): scripting {{user}} (the player's name as the subject of an action/speech
// verb in narration, or narration of the player's inner life), reacting to the player's *private thoughts*, narration
// tense, narration point of view (first or second person outside dialogue and thoughts), missing *private thoughts*,
// missing dialogue, ending on a question or a menu for the player, and an optional word range. Slop and phrase
// repetition are left to the tic guard by default (no double corrections).
//
// Deliberately not reproduced: proof/"pass percent" scores, debt numbers, heat tiers and act taxonomies in the audit,
// confidence thresholds that silently drop audits. Corrections never contain numbers or tracker text.

import {
    kb, ki, kn, kt, kta, klist, makeResolver, str, isUserName, narrationOf, dialogueSpans, thoughtSpans, capNewest,
    renderTemplate, isPlainObject, normText, phraseHits, clip,
} from './common.js';
import { wordCount, tokens, escapeRegex } from '../util.js';

const G = 'Critic';
const P = 'critic.';

export const CRITIC_PATHS = ['observe', 'corrections'];
export const CRITIC_RULES = ['user_script', 'user_interior', 'mindread', 'tense', 'pov_first', 'pov_second', 'thoughts', 'dialogue', 'question_end', 'length', 'banned'];

const USER_VERBS = ['says', 'said', 'asks', 'asked', 'replies', 'replied', 'whispers', 'answers', 'nods', 'nodded', 'smiles', 'smiled', 'laughs',
    'laughed', 'sighs', 'shrugs', 'grins', 'blushes', 'decides', 'decided', 'thinks', 'thought', 'feels', 'felt', 'wonders', 'wants', 'realizes',
    'agrees', 'agreed', 'moans', 'gasps', 'shudders', 'trembles', 'leans', 'reaches', 'kisses', 'kissed', 'steps', 'walks', 'turns', 'murmurs',
    'giggles', 'winces', 'swallows', 'hesitates', 'relaxes', 'melts', 'surrenders', 'climaxes'];
const USER_INTERIOR = ['heart', 'mind', 'thoughts', 'pulse', 'stomach', 'chest', 'cheeks', 'breath', 'resolve', 'desire', 'arousal'];
const PAST_MARKERS = ['was', 'were', 'had', 'said', 'went', 'took', 'saw', 'came', 'looked', 'turned', 'walked', 'asked', 'felt', 'knew', 'thought',
    'stood', 'sat', 'made', 'gave', 'told', 'held', 'smiled', 'laughed', 'nodded', 'pulled', 'pushed', 'stepped', 'reached', 'opened', 'closed'];
const PRESENT_MARKERS = ['is', 'are', 'has', 'says', 'goes', 'takes', 'sees', 'comes', 'looks', 'turns', 'walks', 'asks', 'feels', 'knows', 'thinks',
    'stands', 'sits', 'makes', 'gives', 'tells', 'holds', 'smiles', 'laughs', 'nods', 'pulls', 'pushes', 'steps', 'reaches', 'opens', 'closes'];
const MENU_ENDINGS = ['what do you do', 'what will you do', 'what do you say', 'your move', 'the choice is yours', 'up to you', 'what now', 'do you want to', 'would you like to', 'shall we'];

const DEFAULT_TEXT = {
    user_script: 'You wrote {{user}}\'s own action or words ("{{uc_detail}}"). Never write what {{user}} says, does, decides or feels; stop where {{user}} can answer.',
    user_interior: 'You narrated {{user}}\'s inner life ("{{uc_detail}}"). {{user}}\'s thoughts, feelings and body responses belong to the player.',
    mindread: 'A character reacted to {{user}}\'s private thought ("{{uc_detail}}"). Text in asterisks is never heard or known.',
    tense: 'Narration slipped into {{uc_detail}} tense; keep the narration in {{uc_expected}} tense.',
    pov_first: 'Narration slipped into first person ("{{uc_detail}}"); first person belongs only inside *thoughts* and dialogue.',
    pov_second: 'Narration addressed someone as "you" ("{{uc_detail}}"); narrate in third person.',
    thoughts: 'Weave in {{char}}\'s private first-person thoughts in *asterisks*.',
    dialogue: 'Characters other than {{user}} should speak in quotes this reply.',
    question_end: 'The reply ended by asking the player what happens next ("{{uc_detail}}"); end on a beat instead.',
    length: 'Length was {{uc_detail}} words; aim for {{uc_expected}}.',
    banned: 'Banned phrasing appeared: {{uc_detail}}.',
};

export const CRITIC_PLACEHOLDERS = [
    { name: 'uc_detail', help: 'The offending text (or a count).' },
    { name: 'uc_expected', help: 'What was expected (tense, word range).' },
    { name: 'uc_rules', help: 'The user\'s rules (critic prompt).' },
    { name: 'uc_max', help: 'Max corrections (critic prompt).' },
    { name: 'uc_findings', help: 'Code-side findings, one per line (critic prompt).' },
];

export const CRITIC_SYSTEM = `You are the line editor of an interactive story. You do not continue the story and you do not praise. You read the LATEST REPLY (and the player's message before it) and check it against the author's rules below. Report only faults that are plainly present in the text.

Author's rules:
{{uc_rules}}

Return ONLY JSON: {"corrections":["..."]} with 0 to {{uc_max}} items. Each item is one short order for the writer of the NEXT reply, specific to this text (quote the offending words), saying what to do instead. Never tell the writer what {{user}} says, does, thinks or feels. If the reply is clean: {"corrections":[]}.`;

export const CRITIC_RULES_TEXT = `- Never write {{user}}'s words, voluntary actions, thoughts or feelings, and never read {{user}}'s mind. Things may happen to {{user}}; {{user}} is never puppeted.
- Text in asterisks in {{user}}'s message is private thought: no character hears or reacts to it. Only text in double quotes was said aloud.
- One beat per reply that {{user}} can respond to; never end with a question to the player or a menu of options.
- Narration: third person limited, present tense, anchored on {{char}}; no omniscient narration and never {{user}}'s interior.
- Interweave {{char}}'s private first-person thoughts in single asterisks and first-person dialogue in double quotes.
- No stock phrasing, no purple prose, no repeating gestures or sentences from recent replies, no echoing {{user}}'s words back.`;

export const CRITIC_KNOBS = [
    kb(`${P}enabled`, G, 'Code-side rule checks', true, 'Free heuristics on every reply; violations become corrections for the next reply.'),
    kb(`${P}check_user_script`, G, 'Check: scripting {{user}}', true, ''),
    kb(`${P}check_user_interior`, G, 'Check: narrating {{user}}\'s inner life', true, ''),
    kb(`${P}check_mindread`, G, 'Check: reacting to private thoughts', true, 'Off when the tic guard already reports mind-reading.'),
    kb(`${P}check_tense`, G, 'Check: narration tense', true, ''),
    kb(`${P}check_pov`, G, 'Check: narration point of view', true, ''),
    kb(`${P}check_thoughts`, G, 'Check: *private thoughts* present', true, ''),
    kb(`${P}check_dialogue`, G, 'Check: dialogue present', true, ''),
    kb(`${P}check_question_end`, G, 'Check: ending on a question / menu for the player', true, ''),
    kb(`${P}defer_to_ticguard`, G, 'Leave mind-reading, slop and repetition to the tic guard', true, 'Avoids duplicate corrections; the critic still checks everything else.'),
    klist(`${P}user_verbs`, G, '{{user}} as the subject of these verbs counts as scripting', USER_VERBS, 'Narration only (dialogue and *thoughts* are ignored). Things done TO {{user}} never match.'),
    klist(`${P}user_interior_nouns`, G, '{{user}}\'s … (inner life) words', USER_INTERIOR, '"{{user}}\'s heart", "{{user}}\'s thoughts" … in narration.'),
    klist(`${P}user_aliases`, G, 'Other names for the player', [], 'Besides {{user}} and the persona name.'),
    ki(`${P}mindread_ngram`, G, 'Mind-read phrase length (words)', 3, 2, 8, ''),
    { key: `${P}expected_tense`, group: G, label: 'Expected narration tense', type: 'select', default: 'present', options: [{ value: 'present', label: 'Present' }, { value: 'past', label: 'Past' }, { value: 'any', label: 'Any (no check)' }], help: '' },
    klist(`${P}past_markers`, G, 'Past-tense marker words', PAST_MARKERS, ''),
    klist(`${P}present_markers`, G, 'Present-tense marker words', PRESENT_MARKERS, ''),
    ki(`${P}tense_min_hits`, G, 'Tense: wrong-tense markers needed', 4, 1, 50, ''),
    kn(`${P}tense_ratio`, G, 'Tense: wrong markers must outnumber right ones by', 1.5, 0.5, 10, 0.1, ''),
    ki(`${P}pov_min_hits`, G, 'Point of view: first/second-person words needed in narration', 3, 1, 50, ''),
    ki(`${P}min_words_for_format`, G, 'Format checks only on replies of at least (words)', 120, 0, 2000, 'Thought/dialogue checks skip very short replies.'),
    klist(`${P}menu_endings`, G, 'Menu / question-to-player endings', MENU_ENDINGS, 'Phrases in the reply\'s last 200 characters (outside *thoughts*).'),
    ki(`${P}min_words`, G, 'Length check: min words (0 = off)', 0, 0, 5000, ''),
    ki(`${P}max_words`, G, 'Length check: max words (0 = off)', 0, 0, 10000, ''),
    klist(`${P}banned`, G, 'Banned phrases (critic)', [], 'Extra phrases or /regex/flags the critic reports (the tic guard has its own list).'),
    ki(`${P}max_corrections`, G, 'Corrections per turn', 3, 0, 6, ''),
    ki(`${P}escalate_after`, G, 'Firmer wording after the same violation (replies in a row)', 2, 1, 20, ''),
    kt(`${P}firm_prefix`, G, 'Firm wording prefix', 'Again: ', 'Prepended when a violation repeats.'),
    kta(`${P}texts`, G, 'Correction texts (JSON)', JSON.stringify(DEFAULT_TEXT, null, 1), 'A JSON object rule → text. Placeholders: {{uc_detail}}, {{uc_expected}}. Invalid JSON = built-in texts.', CRITIC_PLACEHOLDERS, { advanced: true, rows: 10 }),
    kb(`${P}llm_enabled`, G, 'Hidden critic pass', false, 'After each reply, one hidden call reviews it against your rules and returns up to 3 corrections for the next turn. Costs one extra call per reply.'),
    ki(`${P}llm_every`, G, 'Hidden critic every N replies', 1, 1, 50, ''),
    kb(`${P}llm_only_when_flagged`, G, 'Hidden critic only when the code checks found something', false, ''),
    ki(`${P}llm_max_tokens`, G, 'Hidden critic response tokens', 300, 50, 2000, ''),
    kta(`${P}llm_system`, G, 'Hidden critic prompt (system)', CRITIC_SYSTEM, 'Placeholders: {{uc_rules}}, {{uc_max}}. Must ask for {"corrections":[...]}.', CRITIC_PLACEHOLDERS, { rows: 10 }),
    kta(`${P}llm_rules`, G, 'Rules the hidden critic checks', CRITIC_RULES_TEXT, 'Shown to the critic as {{uc_rules}}.', CRITIC_PLACEHOLDERS, { rows: 8 }),
    kt(`${P}llm_final`, G, 'Hidden critic final instruction', 'Return the corrections JSON for <latest_reply> now.', ''),
    ki(`${P}correction_chars`, G, 'Max characters per correction', 220, 40, 1000, ''),
    ki(`${P}pri`, G, 'Note priority', 74, 0, 100, ''),
];

export const resolveCriticOptions = makeResolver(P, CRITIC_KNOBS, (o) => {
    let texts = null;
    try { texts = JSON.parse(o.texts); } catch { texts = null; }
    o.text_map = { ...DEFAULT_TEXT, ...(isPlainObject(texts) ? Object.fromEntries(Object.entries(texts).filter(([, v]) => typeof v === 'string' && v.trim())) : {}) };
    return o;
});

let CFG = resolveCriticOptions({});
export function setCriticConfig(values) {
    CFG = resolveCriticOptions(values || {});
    return CFG;
}

// ---------------------------------------------------------------------------------------------------------------------
// State

export function emptyCritic() {
    return { corrections: [], streaks: {}, last_rules: [], last_llm_turn: -1000, llm_runs: 0 };
}

export function normalizeCritic(raw) {
    const s = emptyCritic();
    if (!isPlainObject(raw)) return s;
    s.corrections = (Array.isArray(raw.corrections) ? raw.corrections : []).filter(c => isPlainObject(c) && c.text && Number.isFinite(c.for_turn)).map(c => ({
        text: str(c.text, 1000), source: c.source === 'llm' ? 'llm' : 'code', rule: str(c.rule, 30), for_turn: c.for_turn,
    })).slice(-12);
    s.streaks = isPlainObject(raw.streaks) ? Object.fromEntries(Object.entries(raw.streaks).filter(([, v]) => Number.isFinite(v))) : {};
    s.last_rules = (Array.isArray(raw.last_rules) ? raw.last_rules : []).map(String).slice(0, 20);
    s.last_llm_turn = Number.isFinite(raw.last_llm_turn) ? raw.last_llm_turn : -1000;
    s.llm_runs = Number.isFinite(raw.llm_runs) ? raw.llm_runs : 0;
    return s;
}

// ---------------------------------------------------------------------------------------------------------------------
// Code-side detector

function userNames(userName, o) {
    return [...new Set(['{{user}}', userName, ...(o.user_aliases || [])].map(x => String(x ?? '').trim()).filter(Boolean))];
}

function namePattern(names) {
    return names.map(n => escapeRegex(n).replace(/\s+/g, '\\s+')).join('|');
}

function privateThoughtsOf(text) {
    const out = [];
    const re = /(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g;
    let m;
    while ((m = re.exec(String(text ?? '')))) out.push(m[2].trim());
    return out;
}

function ngramSet(text, n) {
    const t = tokens(text);
    const out = new Set();
    for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n).join(' '));
    return out;
}

/** Phrases from the player's *private thoughts* that surface in the reply and were not also said aloud. */
export function mindReadPhrases(reply, userMessage, n = 3) {
    const thoughts = privateThoughtsOf(userMessage);
    if (!thoughts.length) return [];
    const pub = String(userMessage ?? '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1');
    const r = ngramSet(reply, n);
    const p = ngramSet(pub, n);
    const out = [];
    for (const t of thoughts) {
        for (const g of ngramSet(t, n)) {
            const content = g.split(' ').filter(w => w.length > 3).length;
            if (r.has(g) && !p.has(g) && content >= 1 && !out.some(x => x.includes(g))) out.push(g);
        }
    }
    return out.slice(0, 2);
}

function countWords(list, text) {
    const t = tokens(text);
    const set = new Set((list || []).map(x => normText(x)));
    return t.filter(w => set.has(w)).length;
}

/**
 * Detect rule violations in a reply. Pure, cheap, every turn.
 * @param {object} p
 * @param {string} p.reply
 * @param {string} [p.userMessage]
 * @param {string} [p.userName]
 * @param {object} [p.options]
 * @param {boolean} [p.ticguardOn] the tic guard runs too (mind-reading is then left to it when defer_to_ticguard)
 * @returns {{rule:string, detail:string, expected?:string}[]}
 */
export function detectViolations({ reply = '', userMessage = '', userName = '', options, ticguardOn = true } = {}) {
    const o = resolveCriticOptions(options || {});
    if (!o.enabled) return [];
    const text = String(reply ?? '');
    const narration = narrationOf(text);
    const words = wordCount(text);
    const out = [];
    const names = userNames(userName, o);
    const np = namePattern(names);
    if (o.check_user_script && np && o.user_verbs.length) {
        const verbs = o.user_verbs.map(v => escapeRegex(v)).join('|');
        const re = new RegExp(`(?:^|[^\\w'])(${np})\\s+(?:(?:just|then|finally|slowly|quickly|softly|quietly)\\s+)?(${verbs})\\b`, 'i');
        const m = narration.match(re);
        if (m) out.push({ rule: 'user_script', detail: clip(`${m[1]} ${m[2]}`, 60) });
    }
    if (o.check_user_interior && np && o.user_interior_nouns.length) {
        const nouns = o.user_interior_nouns.map(v => escapeRegex(v)).join('|');
        const re = new RegExp(`(?:^|[^\\w'])(${np})['’]s\\s+(?:\\w+\\s+)?(${nouns})\\b`, 'i');
        const m = narration.match(re);
        if (m) out.push({ rule: 'user_interior', detail: clip(m[0].trim(), 60) });
    }
    if (o.check_mindread && !(o.defer_to_ticguard && ticguardOn)) {
        const hits = mindReadPhrases(text, userMessage, o.mindread_ngram);
        if (hits.length) out.push({ rule: 'mindread', detail: hits[0] });
    }
    if (o.check_tense && o.expected_tense !== 'any') {
        const past = countWords(o.past_markers, narration);
        const present = countWords(o.present_markers, narration);
        const [wrong, right, wrongName] = o.expected_tense === 'present' ? [past, present, 'past'] : [present, past, 'present'];
        if (wrong >= o.tense_min_hits && wrong > right * o.tense_ratio) out.push({ rule: 'tense', detail: wrongName, expected: o.expected_tense });
    }
    if (o.check_pov) {
        const nt = tokens(narration);
        const first = nt.filter(w => ['i', 'me', 'my', 'myself', 'i\'m', 'i\'d', 'i\'ll'].includes(w)).length;
        const second = nt.filter(w => ['you', 'your', 'yours', 'yourself', 'you\'re'].includes(w)).length;
        if (first >= o.pov_min_hits) out.push({ rule: 'pov_first', detail: clip((narration.match(/\b(?:I|my|me)\b[^.!?]{0,40}/) || [''])[0], 60) });
        if (second >= o.pov_min_hits) out.push({ rule: 'pov_second', detail: clip((narration.match(/\byou(?:r)?\b[^.!?]{0,40}/i) || [''])[0], 60) });
    }
    if (words >= o.min_words_for_format) {
        if (o.check_thoughts && !thoughtSpans(text).length) out.push({ rule: 'thoughts', detail: '' });
        if (o.check_dialogue && !dialogueSpans(text).length) out.push({ rule: 'dialogue', detail: '' });
    }
    if (o.check_question_end) {
        const tailText = text.replace(/(^|[^*])\*(?!\*)[^*\n]+?\*(?!\*)/g, '$1').trim();
        const tail = tailText.slice(-200);
        const menu = phraseHits(tail, o.menu_endings)[0];
        if (menu) out.push({ rule: 'question_end', detail: menu.match });
        else {
            const lastPara = tailText.split(/\n+/).filter(Boolean).pop() || '';
            const lastNarr = narrationOf(lastPara);
            if (/\?\s*$/.test(lastNarr)) out.push({ rule: 'question_end', detail: clip(lastNarr.slice(-60), 60) });
        }
    }
    if ((o.min_words > 0 && words < o.min_words) || (o.max_words > 0 && words > o.max_words)) {
        out.push({ rule: 'length', detail: String(words), expected: `${o.min_words || '…'}–${o.max_words || '…'}` });
    }
    if (o.banned.length) {
        const hits = phraseHits(text, o.banned).slice(0, 3);
        if (hits.length) out.push({ rule: 'banned', detail: hits.map(h => `"${h.match}"`).join(', ') });
    }
    return out;
}

/** Correction lines for findings (with escalation for repeats). */
export function correctionLines(findings, { streaks = {}, options } = {}) {
    const o = resolveCriticOptions(options || {});
    return (findings || []).slice(0, o.max_corrections).map((f) => {
        const base = renderTemplate(o.text_map[f.rule] || '', { uc_detail: f.detail || '', uc_expected: f.expected || '' }).trim();
        if (!base) return null;
        const firm = (streaks[f.rule] || 0) >= o.escalate_after; // streak = replies in a row with this violation
        return { rule: f.rule, text: clip(`${firm ? o.firm_prefix : ''}${base}`, o.correction_chars) };
    }).filter(Boolean);
}

/** A line is unsafe when it would itself tell the writer to script {{user}}. */
export function scriptsUser(line, userName = '', options) {
    const o = resolveCriticOptions(options || {});
    const np = namePattern(userNames(userName, o));
    if (!np) return false;
    const s = String(line ?? '');
    if (/\b(never|don'?t|do not|stop|avoid|no)\b/i.test(s)) return false;
    return new RegExp(`\\b(?:make|have|let|show)\\s+(?:${np})\\s+\\w+`, 'i').test(s)
        || new RegExp(`(?:^|[^\\w'])(?:${np})\\s+(?:should|will|must|needs to|could)\\b`, 'i').test(s);
}

// ---------------------------------------------------------------------------------------------------------------------
// Op reducer: "critic.observe" (code findings) and "critic.corrections" (hidden pass). Both system-only.

export function applyCriticOp(slice, op, ctx = {}) {
    const o = ctx.options || CFG;
    if (!(ctx.trusted || ctx.source === 'ports' || ctx.source === 'replay')) return `${op.field} is system-only`;
    const turn = Number.isFinite(ctx.turn) ? ctx.turn : 0;
    const v = isPlainObject(op.value) ? op.value : {};
    if (op.field === 'observe') {
        const findings = (Array.isArray(v.findings) ? v.findings : []).filter(f => isPlainObject(f) && CRITIC_RULES.includes(f.rule));
        const rules = [...new Set(findings.map(f => f.rule))];
        const streaks = {};
        for (const r of rules) streaks[r] = (slice.last_rules.includes(r) ? (slice.streaks[r] || 0) : 0) + 1;
        slice.streaks = streaks;
        slice.last_rules = rules;
        const lines = correctionLines(findings, { streaks, options: o });
        slice.corrections = [...slice.corrections.filter(c => c.for_turn > turn + 1 || (c.for_turn === turn + 1 && c.source === 'llm')),
            ...lines.map(l => ({ text: l.text, source: 'code', rule: l.rule, for_turn: turn + 1 }))].slice(-12);
        return 'ok';
    }
    if (op.field === 'corrections') {
        const lines = (Array.isArray(v.lines) ? v.lines : []).map(x => str(x, o.correction_chars)).filter(Boolean).slice(0, o.max_corrections);
        slice.corrections = [...slice.corrections.filter(c => !(c.for_turn === turn + 1 && c.source === 'llm')),
            ...lines.map(t => ({ text: t, source: 'llm', rule: 'llm', for_turn: turn + 1 }))].slice(-12);
        slice.last_llm_turn = turn;
        slice.llm_runs += 1;
        return 'ok';
    }
    return 'unknown critic field';
}

/** Ops to commit for a finished reply (code-side). Empty when the detector is off. */
export function criticObserveOp(findings) {
    return { op: 'set', path: 'critic.observe', value: { findings: (findings || []).map(f => ({ rule: f.rule, detail: str(f.detail, 80), expected: str(f.expected, 40) })) }, reason: 'critic' };
}

// ---------------------------------------------------------------------------------------------------------------------
// Hidden critic pass

/** Should the hidden critic run after this reply? */
export function criticDue({ state, turn = 0, findings = [], options } = {}) {
    const o = resolveCriticOptions(options || {});
    if (!o.llm_enabled) return false;
    const s = normalizeCritic(state?.ports?.critic);
    if (o.llm_only_when_flagged && !(findings || []).length) return false;
    return turn - s.last_llm_turn >= o.llm_every;
}

/**
 * Messages for the hidden critic (send with generateRaw; {{user}}/{{char}} are substituted by index.js).
 * @returns {{systemPrompt:string, messages:{role:string, content:string}[], responseLength:number}}
 */
export function buildCriticMessages({ reply = '', userMessage = '', findings = [], options } = {}) {
    const o = resolveCriticOptions(options || {});
    const marked = String(userMessage || '').replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, (_, pre, inner) => `${pre}⟦private thought, unknown to every character: ${inner.trim()}⟧`);
    const content = [
        `<player_message>\n${marked || '(none)'}\n</player_message>`,
        `<latest_reply>\n${reply}\n</latest_reply>`,
        findings.length ? `<code_checks>\n${findings.map(f => `- ${f.rule}${f.detail ? `: ${f.detail}` : ''}`).join('\n')}\n</code_checks>` : '',
        o.llm_final,
    ].filter(Boolean).join('\n\n');
    return {
        systemPrompt: renderTemplate(o.llm_system, { uc_rules: o.llm_rules, uc_max: o.max_corrections }),
        messages: [{ role: 'user', content }],
        responseLength: o.llm_max_tokens,
    };
}

/** Parse the hidden critic's answer (text or object) into at most max_corrections safe lines. */
export function parseCriticResult(raw, { userName = '', options } = {}) {
    const o = resolveCriticOptions(options || {});
    let obj = raw;
    if (typeof raw === 'string') {
        const s = raw.replace(/<(think|thinking|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim();
        const m = s.match(/\{[\s\S]*\}/);
        try { obj = m ? JSON.parse(m[0]) : null; } catch { obj = null; }
        if (!obj) {
            obj = { corrections: s.split(/\n+/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(l => l && !/^clean$/i.test(l) && !/^[{}[\]]/.test(l)) };
        }
    }
    const list = Array.isArray(obj) ? obj : (isPlainObject(obj) && Array.isArray(obj.corrections) ? obj.corrections : []);
    return list
        .map(x => (typeof x === 'string' ? x : (isPlainObject(x) ? x.text ?? x.correction ?? '' : '')))
        .map(x => str(x, o.correction_chars).replace(/<\/?[a-z][^>]*>/gi, '').trim())
        .filter(x => x && !/\b\d+\s*\/\s*\d+\b|\bscore\b|\bmeter\b/i.test(x) && !scriptsUser(x, userName, o))
        .slice(0, o.max_corrections);
}

/** Interceptor-time output: the corrections addressed to this turn. */
export function criticTurn({ state, turn = 0, options, type = 'normal' } = {}) {
    const o = resolveCriticOptions(options || {});
    if (type === 'quiet' || type === 'impersonate') return { lines: [], director: [] };
    const s = normalizeCritic(state?.ports?.critic);
    const due = s.corrections.filter(c => c.for_turn === turn);
    const seen = new Set();
    const lines = [];
    for (const c of [...due.filter(c => c.source === 'llm'), ...due.filter(c => c.source === 'code')]) {
        const k = normText(c.text);
        if (seen.has(k)) continue;
        seen.add(k);
        lines.push({ text: c.text, pri: o.pri, section: 'critic' });
        if (lines.length >= o.max_corrections) break;
    }
    return { lines, director: lines.map(l => l.text) };
}

export { capNewest, isUserName };
