// Transient progress for the currently generated reply. It never enters chat history.
let current = null;
const listeners = new Set();

export const replyProgress = () => current;
export const onReplyProgress = fn => listeners.add(fn);

export function showReplyProgress(turn, phase, id) {
    if (phase === 'context') {
        current = { turn, phase, id };
    } else {
        if (current?.turn !== turn || current.phase === phase) return;
        current = { ...current, phase, id: id ?? current.id };
    }
    for (const fn of listeners) fn();
}

export function clearReplyProgress(turn) {
    if (!current || (turn && current.turn !== turn)) return;
    current = null;
    for (const fn of listeners) fn();
}
