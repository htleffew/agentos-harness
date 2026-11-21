import { promptText } from './prompts.js';
import { askFull } from './st.js';
import { settings } from './store.js';
import { addLog, updateLog } from './log.js';
import { amendExecutionReceipt, executionScope, EXECUTION_OPERATIONS, runAdditional } from './execution.js';

// Exclude helper prompts from the ordinary reply recorder, including overlapping requests.
const inFlight = new Map();
export const isOwnPrompt = messages => Array.isArray(messages) && messages.some(message =>
    typeof message?.content === 'string' && [...inFlight.values()].some(mark=>message.content.includes(mark)));

const MORE_ROOM = tokens => Math.min(8000, tokens * 3 + 1500);
const errorText = error => String(error?.cause?.message || error?.message || error || 'unknown error').slice(0, 400);

const systemPrompts = Object.freeze({
    writerVersions:'systemVersions',writerVersionRewrite:'systemVersions',writerItems:'systemItems',writerStyle:'systemStyleItems',
    writerRewrite:'systemRewrite',writerGoal:'systemGoal',writerWorld:'systemWorldEntry',chapterSummary:'systemChapter',
    chapterCombine:'systemCombine',newChapter:'systemNewChapter',starterWorld:'systemStarter',instructionCheck:'systemCheck',editedState:'rebuild',
});

/** Return the accepted transport text, its execution receipt and a note writer for parsing results. */
export async function request({ operation, what, system = '', user = '', tokens = 600, promptSystemId = '', authorization, onReceipt, target, useProfilePreset = true, signal }) {
    const systemId = promptSystemId || (Object.hasOwn(systemPrompts,operation) ? systemPrompts[operation] : '');
    if (systemId) system = promptText(systemId);
    const room = settings().writer.moreRoom ? MORE_ROOM(tokens) : tokens;
    const preserveDraft=EXECUTION_OPERATIONS[operation]?.preserveDraft===true;
    const { value, receipt } = await runAdditional(operation,{authorization,onReceipt,target,label:what,requireRaw:true,signal,record:false,preserveDraft},async ({profileId,receipt})=>{
        const entry = addLog({ what,
            details:[`Additional model request · attempt ${receipt.attempts} of ${receipt.expected}.`, `Sent through ${receipt.connection}.`,
                `Room for the answer: ${room} tokens.`, `Size of what was sent: about ${Math.round((system.length + user.length) / 4)} tokens.`],
            sent:system ? `${system}\n\n${user}` : user });
        const started = Date.now();
        try {
            const mark = String(user).trim().slice(-180);
            if (mark) inFlight.set(receipt.id,mark);
            let res;
            try { res = await askFull({system,user,tokens:room,profileId,useProfilePreset,signal}); }
            finally { inFlight.delete(receipt.id); }
            if (signal?.aborted) {
                throw Object.assign(new Error(signal.reason?.message || 'The request was cancelled.'),{name:'AbortError',partialText:res.text});
            }
            if (!preserveDraft && receipt.scope!==executionScope()) {
                throw Object.assign(new Error('The chat changed while this request was running.'),{name:'AbortError',partialText:res.text});
            }
            const thinking = res.thinking ? `, of which ${res.thinking} were the model thinking` : '';
            updateLog(entry,{got:res.raw || '',details:[`Size of what came back: ${res.raw.length} characters${thinking}.`]});
            if (!res.text.trim()) {
                const reason = res.thinking ? `The model used its ${room} answer tokens on thinking.` : 'The model returned an empty answer.';
                throw new Error(`${reason} Run the action again to retry.`);
            }
            updateLog(entry,{ok:true,result:'Received an answer.'});
            return { text:res.text, entry };
        } catch (error) {
            const aborted = signal?.aborted || error?.name==='AbortError' || error?.cause?.name==='AbortError';
            const reason = (aborted && signal?.reason?.message) || errorText(error);
            const message = !aborted && /no message generated/i.test(reason) ? 'The model returned an empty answer. Run the action again to retry.' : reason;
            const partial = error?.partialText ?? error?.partial ?? error?.responseText ?? error?.cause?.partialText;
            updateLog(entry,{ok:false,status:aborted ? 'Cancelled' : 'Failed',result:message,...(typeof partial==='string' ? {got:partial} : {})});
            throw Object.assign(new Error(message),{name:aborted ? 'AbortError' : 'Error',partialText:partial});
        } finally {
            updateLog(entry,{details:[`Took ${((Date.now() - started) / 1000).toFixed(1)} seconds.`]});
        }
    });
    return { text:value.text, receipt, note(result,ok = true,details = []) {
        const cancelled=receipt.outcome==='cancelled';
        updateLog(value.entry,{ok:!cancelled && ok,result,details,...(cancelled && {status:'Cancelled'})});
        amendExecutionReceipt(receipt,{result:result || 'Received a result.',outcome:cancelled ? 'cancelled' : ok ? 'completed' : 'failed'},onReceipt);
    } };
}
