import { dialogueAttributions, thoughtAttributions } from './dialogue.js';

export const DEFAULT_NPC_AVOID = 'Blackwood\nMarcus\nVoss\nElara\nMaren';

const nameWords = value => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const containsName = (text, name) => ` ${text} `.includes(` ${name} `);

/** Local checks for names the reply introduces. The list stays out of prompts. */
export function flaggedNpcNames(prose, parsed, { list = DEFAULT_NPC_AVOID, established = [], prior = '' } = {}) {
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
    ];
    const flagged = new Map();
    for (const value of possible) {
        const name = nameWords(value);
        if (!name || known.has(name) || !containsName(current, name)) continue;
        if (!blocked.some(entry => containsName(name, entry))) continue;
        before ??= nameWords(typeof prior === 'function' ? prior() : prior);
        if (!containsName(before, name)) flagged.set(name, value.trim());
    }
    return [...flagged.values()];
}
