// Checks on the text of a version before it is saved.
import { names, regexScripts } from './st.js';
import { wordFlag } from './pacing.js';

const USER = '\\{\\{user(?:\\.[Tt]hey)?\\}\\}';
// Words that make {{user}} the one acting when {{user}} is the subject of the order.
const ACT_VERBS = 'must|should|shall|will|would|has to|needs to|is going to|decides|chooses|agrees|refuses|accepts|says|asks|tells|replies|answers|responds|whispers|shouts|admits|confesses|thinks|feels|wants|realizes|realises|notices|knows|believes|wonders|remembers|smiles|laughs|cries|nods|blushes|kisses|hugs|touches|grabs|takes|gives|walks|runs|leaves|enters|sits|stands|looks|turns|moves|reaches|opens|closes|pulls|pushes|does|goes|comes|makes|lets|starts|begins|tries';
// Being made to speak or decide. Reactions someone else can cause ("make {{user}} laugh") are left alone.
const MADE_VERBS = 'say|speak|answer|reply|respond|decide|choose|agree|refuse|accept|admit|confess';

// {{user}} is flagged only as the subject of the order: at the start of a sentence, or joined to the subject with "and".
// A mention anywhere else is someone or something else acting: "the bridge under {{user}} must crack",
// "{{char}} must ask what {{user}} wants", "before {{user}} can react".
const USER_ACTS = [
    new RegExp(`(?:^|[.!?;:]\\s+|\\n\\s*|\\b(?:and|then|but)\\s+)(?:then,?\\s+|next,?\\s+)?${USER}\\s+(?:then\\s+|also\\s+|now\\s+|quickly\\s+|slowly\\s+|finally\\s+|suddenly\\s+)?(?:${ACT_VERBS})\\b`, 'i'),
    new RegExp(`\\b(?:make|makes|making|have|has|having)\\s+\\{\\{user\\}\\}\\s+(?:${MADE_VERBS})\\b`, 'i'),
    new RegExp('\\b(?:write|writes|describe|describes|narrate|narrates|decide|decides|voice|voices|speak for|speaks for)\\b[^.]{0,40}\\{\\{user\\}\\}\'s\\s+(?:reply|response|answer|decision|choice|choices|thoughts|feelings|reaction|dialogue|words|actions)\\b', 'i'),
];

const userActs = (s) => USER_ACTS.some(re => re.test(s));

/** In a list of who drives an event: true when the item is {{user}} themself ("{{user}}'s rival" is someone else). */
export function userDrives(text) {
    return /^\s*\{\{user(?:\.[A-Za-z]+)?\}\}(?!['’]s)/i.test(String(text ?? ''));
}

const HEDGES = /\b(might|could|maybe|perhaps|possibly|consider|considers|try to|tries to|attempt to|attempts to|if appropriate|when appropriate|if the moment allows|if it fits|if possible|feel free|optionally|can choose|may want|should)\b/i;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Swap real names for {{char}} and {{user}}. Returns the new text and how many swaps were made. */
export function swapNames(text) {
    const n = names();
    let swaps = 0;
    let out = String(text ?? '');
    for (const [name, token] of [[n.char, '{{char}}'], [n.user, '{{user}}']]) {
        if (!name || name.length < 2 || /^the /.test(name)) continue;
        const re = new RegExp(`(?<![\\w{])${escapeRe(name)}(?![\\w}])`, 'g');
        out = out.replace(re, () => { swaps++; return token; });
    }
    return { text: out, swaps };
}

// Plain, literal, positive wording works best in orders. Each check shows the word it found.
const WORDING = [
    [/[\u2014\u2013]/, () => 'Has a long dash. Use a comma or a full stop.'],
    [/\b(not|no|never|avoid|avoids|without|instead|stop|stops|rather than)\b|n't\b/i, m => `"${m}" says what to leave out. Orders work better when they say what happens.`],
    [/\b(like an?|as if|as though|tapestry|palpable|unspoken|hangs in|ripple|ripples|a sense of|a mix of)\b/i, m => `"${m}" is figurative. Say the literal thing that happens.`],
    [/\b(somehow|almost|seems? to|seemed to|hints?|hinting|impl(?:y|ies)|subtext|unsaid|subtly)\b/i, m => `"${m}" is vague. Name the visible action.`],
];

function wordingHits(text) {
    const hits = [];
    for (const [re, say] of WORDING) {
        const m = text.match(re);
        if (m) hits.push(say(m[0]));
    }
    return hits;
}

function regexHits(text) {
    const hits = [];
    for (const s of regexScripts()) {
        if (!s || s.disabled || !s.findRegex) continue;
        try {
            const m = String(s.findRegex).match(/^\/([\s\S]+)\/([a-z]*)$/i);
            const re = m ? new RegExp(m[1], m[2].replace(/[gy]/g, '')) : new RegExp(escapeRe(String(s.findRegex)), 'i');
            const found = text.match(re);
            if (found && found[0] && found[0].trim().length > 1) hits.push(`"${found[0].trim().slice(0, 30)}" matches your regex script "${s.scriptName || 'unnamed'}".`);
        } catch { /* a regex this browser cannot read; skip it */ }
        if (hits.length >= 2) break;
    }
    return hits;
}

/** A note for a pairing of "who does it" and "who it happens to" that leaves the AI writer little to work with. '' when the pairing is fine. */
export function pairingNote(actor, target) {
    if (actor === 'char' && target === 'char') return 'The character does this to themself. Versions written with AI will have {{char}} act on {{char}}. If someone else is meant on one side, change it.';
    if (actor === 'new' && target === 'new') return 'Someone new does this to someone new, so two people arrive at once and neither is known to the story. If one of them is someone already in the story, change it.';
    if (actor === 'other' && target === 'other') return 'Both sides are "a named character who is present, other than you". With only {{char}} and you in the scene, nobody fits. With one other person present, that person would act on themself.';
    if (actor === target && actor.startsWith('npc')) return 'Both sides leave the choice of person to the AI, and it may choose the same person for both. If two different people are meant, give one side a narrower choice.';
    if (actor === 'world' && target === 'new') return 'The surroundings act on someone who has not appeared yet. The AI has to bring that person in and have something happen to them in the same reply.';
    if (actor === 'new' && target === 'other') return 'Someone new acts on a named character other than {{char}} and you. With only {{char}} and you in the scene, nobody fits as the one it happens to.';
    return '';
}

/** Does this version agree with who the instruction says does it? Returns one line of advice, or ''. */
export function actorNote(text, actor) {
    const s = String(text ?? '').trim();
    if (!s) return '';
    const charLeads = new RegExp(`^(?:then,?\\s+|next,?\\s+)?\\{\\{char\\}\\}\\s+(?:must|has to|needs to|is to|will)\\b`, 'i').test(s);
    if (actor === 'char' && !/\{\{char(?:\.[A-Za-z]+)?\}\}/i.test(s)) return 'This instruction is set to "the character does it", and this version does not name {{char}}. Change the version, or change "Who does it".';
    if (actor === 'world' && charLeads) return 'This instruction is set to "the surroundings do it", and this version has {{char}} do it. Change the version, or change "Who does it".';
    if ((actor === 'other' || actor === 'new') && charLeads) return `This instruction is set to "${actor === 'new' ? 'someone new' : 'a named character other than {{char}}'} does it", and this version has {{char}} do it. Change the version, or change "Who does it".`;
    return '';
}

/**
 * Look for problems in one version.
 * blocks: only an empty version, which cannot be saved.
 * checks: {{user}} may be acting. Shown as "Check"; you decide, and saving is allowed.
 * warns: advice on wording. Saving is allowed.
 */
export function validateVersion(text) {
    const s = String(text ?? '').trim();
    const blocks = [];
    const checks = [];
    const warns = [];
    if (!s) { blocks.push('This version is empty.'); return { blocks, checks, warns }; }
    if (userActs(s)) checks.push('{{user}} may be acting, speaking, deciding, thinking or feeling here. If so, rewrite it so that someone else acts and {{user}} is only who it happens to. If it reads right to you, keep it.');
    const hedge = s.match(HEDGES);
    if (hedge) warns.push(`"${hedge[0]}" makes this optional. Orders work better: say it must happen.`);
    const n = names();
    for (const name of [n.char, n.user]) {
        if (name && name.length > 1 && !/^the /.test(name) && new RegExp(`(?<![\\w{])${escapeRe(name)}(?![\\w}])`).test(s)) {
            warns.push(`The name "${name}" is written out. Use the name buttons so this works with any character.`);
        }
    }
    warns.push(...wordingHits(s), ...regexHits(s));
    { const w = wordFlag(s); if (w) warns.push(w); }
    return { blocks, checks, warns };
}
