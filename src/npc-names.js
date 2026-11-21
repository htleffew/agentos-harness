import { dialogueAttributions, thoughtAttributions } from './dialogue.js';

export const DEFAULT_NPC_AVOID = 'Blackwood\nMarcus\nVoss\nElara\nMaren';

const nameWords = value => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const containsName = (text, name) => ` ${text} `.includes(` ${name} `);
const personAction = /^(?:\s*[,—]\s*|\s+)(?:said|asked|replied|answered|whispered|called|walked|stepped|leaned|lifted|took|raised|gave|stood|turned|reached|nodded|shook|entered|left|looked|appeared|arrived|sat|knelt|held|pulled|pushed|folded|smiled|laughed|shouted)\b/i;
const titles = '(?:captain|doctor|professor|detective|officer|lieutenant|sergeant|sir|lady|mister|miss|judge|mayor|chief)';
const personTitle = new RegExp(`\\b${titles}\\.?\\s*$`,'i');
const leadingTitle = new RegExp(`^${titles}\\.?[ \\t]+`,'i');

function proseNameCandidates(prose, blocked) {
    const candidates = [];
    const names = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}\p{M}’'-]+(?:[ \t]+\p{Lu}[\p{L}\p{M}’'-]+){0,2}/gu;
    for (const match of prose.matchAll(names)) {
        const value = match[0].replace(leadingTitle,'');
        if (!blocked.some(entry=>containsName(nameWords(value),entry))) continue;
        const end = match.index + match[0].length;
        if (value!==match[0] || personAction.test(prose.slice(end,end+32)) ||
            personTitle.test(prose.slice(Math.max(0,match.index-24),match.index))) candidates.push(value);
    }
    return candidates;
}

/** Local checks for names the reply introduces. The list stays out of prompts. */
export function flaggedNpcNames(prose, parsed = {}, { list = DEFAULT_NPC_AVOID, established = [], prior = '' } = {}) {
    const blocked = String(list).split(/\r?\n/).map(nameWords).filter(Boolean);
    if (!blocked.length) return [];
    const current = nameWords(prose);
    if (!blocked.some(entry => containsName(current, entry))) return [];
    let before;
    const known = new Set(established.filter(Boolean).map(nameWords));
    const possible = [
        ...(parsed.profiles || []).map(profile => profile.name),
        ...(parsed.ops || []).filter(op => op.k === 'person').map(op => op.a),
        ...(parsed.changes || []).filter(record => record?.kind === 'profile').map(record => record.subject),
        ...String(parsed.scene?.present ?? '').split(/[,;\n]/),
        ...dialogueAttributions(prose).map(match => match.name),
        ...thoughtAttributions(prose).map(match => match.name),
        ...proseNameCandidates(prose, blocked),
    ];
    const flagged = new Map();
    for (const value of possible) {
        const name = nameWords(value);
        if (!name || known.has(name) || !containsName(current, name)) continue;
        if (!blocked.some(entry => containsName(name, entry))) continue;
        before ??= nameWords(typeof prior === 'function' ? prior() : prior);
        if (!containsName(before, name)) flagged.set(name, String(value).trim());
    }
    return [...flagged.values()];
}
