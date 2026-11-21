import { ctx, hasEvent, isReply, names, sub } from './st.js';
import { historySourceMark } from './history-source.js';
import { sceneAt } from './state.js';
import { readReplyWorld } from './reply-world.js';
import { readRecord } from './v10.js';
import { renderEntry } from './world.js';
import { separateReply } from './reply-format.js';
import { proseDialogue } from './dialogue.js';
import { promptText } from './prompts.js';
import { playerContribution } from './quick-action-chat.js';

const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const label = value => normalized(value).toLocaleLowerCase();
const listed = (value, person) => String(value ?? '').split(/[,;\n]|\s+and\s+/i).some(name => label(name) === label(person));
const messageText = content => Array.isArray(content) ? content.map(part => part?.text || '').join('\n') : content;

// The direct host API expands template macros a second time. Context copied
// from the story stays literal and cannot look up the open chat from that API.
export const literalGuidedInput = value => String(value ?? '').replace(/\{\{/g, '{\u2060{');
const scopedNameMacro = /^(?:user|char)(?:\.(?:name|he|she|they|him|her|them|his|their|theirs|himself|herself|themself))?$/i;
export const hasUnscopedMacro = value => [...String(value ?? '').matchAll(/\{\{\s*(.*?)\s*\}\}/gs)].some(([, body]) => !scopedNameMacro.test(body));
export const scopedGuidedTemplate = value => String(value ?? '').replace(/\{\{\s*(.*?)\s*\}\}/gs,
    (match, body) => scopedNameMacro.test(body) ? sub(match) : literalGuidedInput(match));

export function cleanGuidedProse(value) {
    const prose = String(value ?? '').replace(/\s*<sent_instructions>[\s\S]*?<\/sent_instructions>/gi, '');
    return separateReply(prose).text.replace(/<(story_update|tracker|roast|profile)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim();
}

export function guidedTarget(index) {
    const host = ctx(), chat = host.chat || [];
    if (index === undefined) index = chat.findLastIndex(message => !message?.is_system && isReply(message));
    const message = chat[index];
    if (!isReply(message) || message.is_system) return null;
    return {
        chatId: String(host.getCurrentChatId?.() ?? ''), index, swipe: Number(message.swipe_id ?? 0),
        fingerprint: historySourceMark(message), name: message.name || names().char,
        text: String(message.mes ?? ''), latest: index === chat.length - 1,
    };
}

export function validateGuidedTarget(target) {
    const current = target && guidedTarget(target.index);
    if (!current || current.chatId !== target.chatId || current.swipe !== target.swipe || current.fingerprint !== target.fingerprint) {
        throw new Error('The selected reply changed. Reopen Quick actions on the intended revision.');
    }
    return current;
}

export function guidedDirection(cues = [], direction = '') {
    const selected = cues.map(cue => typeof cue === 'string' ? cue : cue?.text)
        .map(text => String(text ?? '').trim()).filter(Boolean);
    return [...new Set([...selected, String(direction ?? '').trim()].filter(Boolean))].join('\n\n');
}

export function freshHistoryCapability() {
    return ctx().mainApi === 'openai' && hasEvent('CHAT_COMPLETION_PROMPT_READY') ? 'substituted' : 'retained';
}

export function freshGuidance() {
    return promptText('freshStart');
}

// The final Chat Completion payload has already expanded macros, formatted chat and
// assembled the active preset. Preserve its other blocks and drop matched old turns.
export function projectGuidedRequest(messages, { type = 'normal', target, freshStart = false, facts = '', currentUserIndex } = {}) {
    if (!freshStart || !Array.isArray(messages)) return { mode: 'ordinary', removed: 0 };
    const chat = ctx().chat || [];
    const boundary = target?.index ?? chat.length;
    const candidates = chat.slice(0, boundary).filter(row => row && !row.is_system);
    const newestUser = Number.isInteger(currentUserIndex) ? chat[currentUserIndex] : candidates.findLast(row => row.is_user);
    const prose = value => normalized(proseDialogue(cleanGuidedProse(value)));
    const current = prose(scopedGuidedTemplate(playerContribution(newestUser)));
    const prefix = type === 'continue' ? prose(scopedGuidedTemplate(target?.text)) : '';
    const forRole = { user: new Set(), assistant: new Set() };
    for (const row of candidates) {
        if (row === newestUser) continue;
        const text = prose(scopedGuidedTemplate(row.is_user ? playerContribution(row) : row.mes));
        if (text) forRole[row.is_user ? 'user' : 'assistant'].add(text);
    }
    if (type === 'swipe' && target?.text) forRole.assistant.add(prose(scopedGuidedTemplate(target.text)));
    const matches = (message, role, value) => {
        if (!value || message?.role !== role) return false;
        const text = prose(messageText(message.content));
        return text === value || text.endsWith(`: ${value}`);
    };
    // Earlier turns can repeat the exact latest wording. Keep its final host
    // occurrence, then remove the matching older examples with their turn peers.
    const keep = new Set([
        messages.findLastIndex(message => matches(message, 'user', current)),
        messages.findLastIndex(message => matches(message, 'assistant', prefix)),
    ]);

    let removed = 0;
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        const text = prose(messageText(message?.content));
        if (keep.has(index) || !text || !forRole[message?.role]) continue;
        const old = forRole[message.role];
        const same = old.has(text) || [...old].some(source => text.endsWith(`: ${source}`));
        if (same) { messages.splice(index, 1); removed++; }
    }
    const oldProse = [...forRole.assistant, ...forRole.user].filter(text => text.length >= 20);
    const retained = messages.some(message => {
        const text = prose(messageText(message?.content));
        if (!text || message.tool_calls || current && message.role === 'user' && text.endsWith(current)) return false;
        if (message.role === 'assistant') return !prefix || !text.endsWith(prefix);
        return message.role === 'system' && oldProse.some(earlier => text.includes(earlier));
    });
    const guidance = [scopedGuidedTemplate(freshGuidance()), facts && `Established story context\n${facts}`].filter(Boolean).join('\n\n');
    // Keep an assistant continuation prefill in the final position where the host put it.
    const last = messages.at(-1);
    const offset = type === 'continue' && last?.role === 'assistant' ? messages.length - 1 : messages.length;
    messages.splice(offset, 0, { role: 'system', content: guidance });
    return { mode: retained ? 'retained' : 'substituted', removed };
}

export function preserveContinuationPrefix(before, after) {
    before = String(before ?? '');
    after = String(after ?? '');
    if (after.startsWith(before)) return after;
    const plain = cleanGuidedProse(before);
    if (!plain || !cleanGuidedProse(after).startsWith(plain)) return null;
    const remainder = cleanGuidedProse(after).slice(plain.length);
    return before + (/\s$/.test(before) ? remainder.trimStart() : remainder);
}

// Player context admits the persona, the player's own past contributions, the
// scene they occupy and sources explicitly establishing what they know.
function playerFacts(world, player) {
    const rows = world.rows || [];
    const records = [...(world.records || []), ...rows.map(readRecord).filter(Boolean)];
    const direct = records.filter(record => label(record.subject) === label(player) && ['knowledge', 'profile'].includes(record.kind))
        .map(record => `${record.basis ? `${record.basis}: ` : ''}${record.text}`);
    for (const row of rows) {
        if (row.kind === 'secret' && (listed(row.fields.known, player) || listed(row.fields.holder, player))) {
            if (row.fields.secret) direct.push(row.fields.secret);
        }
        if (row.kind === 'character' && [row.name, ...row.aliases].some(name => label(name) === label(player))) {
            for (const value of ['who', 'role', 'voice', 'knows'].map(key => row.fields[key]).filter(Boolean)) direct.push(value);
        }
    }
    return [...new Set(direct.filter(Boolean))];
}

function storyFacts(world) {
    const facts = (world.records || []).filter(record => record.kind === 'fact' || record.kind === 'profile').map(record => record.text);
    for (const row of world.rows || []) {
        const record = readRecord(row);
        if (record?.kind === 'fact' || record?.kind === 'profile') facts.push(record.text);
        if (['character', 'place', 'thread', 'chapter'].includes(row.kind)) facts.push(renderEntry(row, { full: false }));
        if (row.kind === 'secret' && row.status === 'out') facts.push(row.fields.secret);
    }
    return [...new Set(facts.filter(Boolean))];
}

const sceneLabels = { where: 'Place', present: 'Present', when: 'Time', time: 'Time', date: 'Date', weather: 'Weather', environment: 'Surroundings' };

export async function guidedContext({ family, target, freshStart = false, fragment = '' }) {
    const host = ctx(), chat = host.chat || [], player = names().user, chatId = host.getCurrentChatId?.();
    const end = target ? target.index + (family === 'swipe' ? 0 : 1) : chat.length;
    const playerView = family === 'draft';
    const scene = sceneAt(end, { overrides: end === chat.length });
    const world = await readReplyWorld(end - 1);
    if (ctx().chat !== host.chat || ctx().getCurrentChatId?.() !== chatId) throw new Error('The chat changed. Open Quick actions in the intended chat.');
    if (target) validateGuidedTarget(target);
    const includeScene = !playerView || listed(scene.present, player);
    const setting = includeScene ? Object.entries(sceneLabels).flatMap(([key, tag]) => scene[key] ? [`${tag}: ${scene[key]}`] : []) : [];
    const known = (playerView ? playerFacts(world, player) : storyFacts(world)).slice(-18).map(text => `• ${String(text).slice(0, 420)}`);
    const facts = [setting.join('\n'), known.join('\n')].filter(Boolean).join('\n\n');
    const visible = chat.slice(0, end).filter(message => message && !message.is_system);
    const start = visible.reduceRight((indices, message, index) => (!message.is_user && indices.length < 5 ? [...indices, index] : indices), []).at(-1) ?? 0;
    const recent = playerView ? visible.filter(message => message.is_user).slice(-5) : visible.slice(Math.max(0, start - 1)).slice(-12);
    const excerpts = freshStart ? recent.filter(message => message.is_user).slice(-1) : recent;
    const lines = excerpts.map(message => {
        const value = cleanGuidedProse(message.is_user ? playerContribution(message) : message.mes);
        return value && `${message.is_user ? `Player ${player}` : message.name || names().char}: ${value.slice(-950)}`;
    }).filter(Boolean);
    const persona = playerView ? String(host.powerUserSettings?.persona_description ?? host.getCharacterCardFields?.()?.persona ?? '').slice(0, 3200) : '';
    const card = !playerView ? host.characters?.find?.(item => item?.name === target?.name) || host.characters?.[host.characterId] : null;
    const portrayal = card ? [card.description ?? card.data?.description, card.personality ?? card.data?.personality].filter(Boolean).join('\n').slice(0, 1800) : '';
    return {
        world, scene, facts, partial: world.partial,
        text: [
            playerView && `Player: ${player}`,
            persona && `Active player persona\n${persona}`,
            portrayal && `Character portrayal: ${target?.name || names().char}\n${portrayal}`,
            facts && `${playerView ? 'Facts the player can use' : 'Established story context'}\n${facts}`,
            lines.length && `${playerView ? 'Prior player contributions' : 'Recent exchanges'}\n${lines.join('\n\n')}`,
            fragment && `Current player draft\n${fragment}`,
        ].filter(Boolean).join('\n\n'),
    };
}
