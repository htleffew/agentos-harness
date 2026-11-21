// Stable across hiding a message or copying a chat to a branch.
export function historySourceMark(message) {
    const text = JSON.stringify([message?.send_date, message?.name, !!message?.is_user, message?.mes]);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    return `${text.length}:${hash >>> 0}`;
}

export function historySourceMatches(chat, end, source) {
    const start = end + 1 - source.length;
    return start >= 0 && source.every((mark, offset) => mark === historySourceMark(chat[start + offset]));
}
