import { promptText } from './prompts.js';
// One place for every background request to the AI. Each request is written to the log,
// and a failure comes back with a plain reason instead of an empty result.
import { askFull, listProfiles } from './st.js';
import { settings, saveSettings } from './store.js';
import { addLog, updateLog } from './log.js';

// The texts of this extension's own requests while they are on their way, so the count of what a chat reply sends is
// not taken from one of them.
const inFlight = new Set();
/** Is this finished prompt one of this extension's own requests? */
export const isOwnPrompt = messages => Array.isArray(messages) && messages.some(m => typeof m?.content === 'string' && [...inFlight].some(t => m.content.includes(t)));

const MORE_ROOM = (tokens) => Math.min(8000, tokens * 3 + 1500);

function connectionName(profileId) {
    const p = profileId ? listProfiles().find(x => x.id === String(profileId)) : null;
    return p ? `connection profile "${p.name}"` : "the chat's own connection";
}

const errorText = (e) => String(e?.cause?.message || e?.message || e || 'unknown error').slice(0, 400);

/**
 * Ask the AI and return { text, note }.
 * note(result, ok, details) writes how the answer was used into the same log entry.
 * Throws an Error whose message says in plain words what went wrong.
 */
export async function request({ what, system = '', user = '', tokens = 600, profileId = '', promptSystemId = '' }) {
    const st = settings();
    const systemId = promptSystemId || (/^Write \d+ versions? for /.test(what) ? 'systemVersions'
        : /^Write \d+ items for the list /.test(what) ? 'systemItems'
        : /^Rewrite \d+ items of /.test(what) ? 'systemRewrite'
        : what === 'Write a goal' ? 'systemGoal'
        : /^Write a .+ entry$/.test(what) ? 'systemWorldEntry'
        : what === 'Write a chapter of the story so far' ? 'systemChapter'
        : what === 'Combine the older chapters into one' ? 'systemCombine'
        : what === 'Write a new chapter (summary and first message)' ? 'systemNewChapter'
        : what === 'Fill a story world from the character card' ? 'systemStarter'
        : what === 'Check that it happened' ? 'systemCheck'
        : what === 'Rebuild edited story state' ? 'rebuild' : '');
    if (systemId) system = promptText(systemId);
    const via = connectionName(profileId);
    let room = st.writer.moreRoom ? MORE_ROOM(tokens) : tokens;
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        const entry = addLog({
            what: attempt === 1 ? what : `${what} (second try, more room)`,
            details: [`Sent through ${via}.`, `Room for the answer: ${room} tokens.`, `Size of what was sent: about ${Math.round((system.length + user.length) / 4)} tokens.`],
            sent: system ? `${system}\n\n${user}` : user,
        });
        const started = Date.now();
        let res;
        try {
            const mark = String(user).slice(0, 80);
            inFlight.add(mark);
            try { res = await askFull({ system, user, tokens: room, profileId }); } finally { inFlight.delete(mark); }
        } catch (e) {
            // SillyTavern reports an answer with no text in it as the error "No message generated".
            if (/no message generated/i.test(errorText(e))) {
                res = { text: '', raw: '', thinking: 0 };
                updateLog(entry, { details: ['SillyTavern reported "No message generated": the AI sent back an answer with no text in it.'] });
            } else {
                const reason = `The AI connection gave an error: ${errorText(e)}`;
                updateLog(entry, { ok: false, result: reason, details: [`Took ${((Date.now() - started) / 1000).toFixed(1)} seconds.`] });
                throw new Error(`${reason} The Log tab has the details.`);
            }
        }
        const secs = ((Date.now() - started) / 1000).toFixed(1);
        updateLog(entry, { got: res.raw || '', details: [`Took ${secs} seconds.`, `Size of what came back: ${res.raw.length} characters${res.thinking ? `, of which ${res.thinking} were the model thinking` : ''}.`] });
        if (res.text.trim()) {
            if (attempt === 2 && !st.writer.moreRoom) {
                st.writer.moreRoom = true;
                saveSettings();
                updateLog(entry, { details: ['The second try worked, so "Give the AI more room to answer" was turned on in Settings.'] });
            }
            return {
                text: res.text,
                note(result, ok = true, details = []) { updateLog(entry, { ok, result, details }); },
            };
        }
        last = res.thinking
            ? `The model spent its whole room for the answer (${room} tokens) on thinking and wrote no answer.`
            : `The AI connection returned an empty answer. A model that thinks before it answers can use up the whole room for the answer (${room} tokens) on thinking.`;
        updateLog(entry, { ok: false, result: last });
        if (room >= 8000) break;
        room = MORE_ROOM(room);
    }
    throw new Error(`${last} A second try with more room was also empty. Pick another AI connection in Settings, or look at the Log tab to see what came back.`);
}
