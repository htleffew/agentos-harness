// A chat from the M1a run (memory/evidence/m1a, the Structured workflow after turn 32), rebuilt in SillyTavern's chat
// file shape from copies of the run's saved message records, chat metadata and Story World book. Reply names and send
// times are the ones the run used: each staged change's revision fingerprint matches its rebuilt reply.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
export const KEY = 'roleplay_instructions';
export const CHAT_ID = 'Hale of Verath - 2026-11-23@10h04m14s012ms';
export const CHARACTER = 'Hale of Verath';
export const USER = 'User';

export function buildM1aChat() {
    const records = read('m1a-chat-records-after-turn-32.json');
    const state = read('m1a-chat-metadata-after-turn-32.json');
    const book = read('m1a-story-world-after-turn-32.json');
    const start = Date.parse('2026-11-23T17:04:14.012Z');
    const messages = records.map((item, index) => {
        const next = records.slice(index).find(r => r.rec?.memoryTurn)?.rec.memoryTurn;
        const send_date = item.rec?.memoryTurn || (index === 0 ? new Date(start).toISOString() : new Date(Date.parse(next || records[index - 1]?.rec?.memoryTurn || start) - 500).toISOString());
        const extra = item.rec ? { [KEY]: item.rec } : {};
        const m = { name: item.is_user ? USER : CHARACTER, is_user: item.is_user, is_system: false, send_date, mes: item.mes, extra };
        if (!item.is_user) Object.assign(m, { swipe_id: 0, swipes: [item.mes], swipe_info: [{ send_date, gen_started: send_date, gen_finished: send_date, extra: structuredClone(extra) }] });
        return m;
    });
    return { messages, chatMetadata: { [KEY]: state, integrity: state.worldOwner }, book, bookName: state.world, chatId: CHAT_ID };
}

/** The chat as a SillyTavern .jsonl file: a header line with the metadata, then one line per message. */
export function m1aChatFile() {
    const { messages, chatMetadata } = buildM1aChat();
    const header = { user_name: USER, character_name: CHARACTER, create_date: '2026-11-23@10h04m14s012ms', chat_metadata: chatMetadata };
    return [header, ...messages].map(line => JSON.stringify(line)).join('\n');
}
