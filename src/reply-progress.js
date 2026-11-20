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

export function setReplyPreview(turn, preview) {
    if (current?.turn !== turn || current.preview === preview) return;
    current = { ...current, preview };
    for (const fn of listeners) fn();
}

export function setReplySections(turn, sections) {
    if (current?.turn !== turn) return;
    const stamp = JSON.stringify(sections);
    if (current.sectionStamp === stamp) return;
    current = {...current,sections,sectionStamp:stamp};
    for (const fn of listeners) fn();
}
