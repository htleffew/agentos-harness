// The Legacy workflow's retirement (B13, DESIGN.md section 8). Before anything Legacy is read for the last time, one
// backup of the extension settings is saved as a file in SillyTavern's user files; it holds every custom prompt,
// including the retired Legacy scene, profile and dice prompts, and it can be read back in from Setup, Connections.
// After that backup exists, each chat converts once on its first open: the scene and character state a Legacy reply
// saved (its scene lines and its profile blocks) becomes the same reply record a Structured reply keeps (`stateChanges`
// for Mind, Heart, Body and Psyche, `v10Profiles` for who a person is), so the reply tray shows old chats and no
// Legacy reader stays in the code. The conversion runs on data already saved; it never reads reply text.
import { ctx, KEY, LOG, on, isChatOpen } from './st.js';
import { settings, saveSettings } from './store.js';
import { changesFromProfiles } from './state.js';

export const BACKUP_SCHEMA = 'roleplay-instructions/settings-backup@1';
export const BACKUP_KEY = 'legacyBackup';
export const CONVERSION_VERSION = 1;
// Kept as they were when a backup is read back in: the record of the backups themselves.
const KEPT_ON_RESTORE = ['legacyBackup', 'memoryBackup'];

const norm = value => String(value ?? '').trim().toLocaleLowerCase();
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const stamp = iso => iso.replace(/[^0-9]/g, '').slice(0, 14);

/** The backup file's text and name for the settings as they are now. */
export function backupFile(reason = 'Settings backup.', now = new Date()) {
    const created = now.toISOString();
    const copy = structuredClone(settings());
    for (const key of KEPT_ON_RESTORE) delete copy[key];
    const text = JSON.stringify({ schema: BACKUP_SCHEMA, created, reason, settings: copy });
    return { name: `roleplay-instructions-settings-backup-${stamp(created)}.json`, text, created };
}

async function uploadFile(name, text) {
    const c = ctx();
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const response = await fetch('/api/files/upload', { method: 'POST', headers: c.getRequestHeaders?.() || { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data: btoa(binary) }) });
    if (!response.ok) throw new Error(`The settings backup was not saved (${response.status}).`);
    return (await response.json().catch(() => ({})))?.path || name;
}

/** The one backup taken before the Legacy workflow was retired. Returns its record; a second call returns the same. */
export async function backupBeforeRetirement({ upload = uploadFile } = {}) {
    const s = settings();
    if (s[BACKUP_KEY]?.name) return s[BACKUP_KEY];
    const file = backupFile('Before the Legacy workflow was retired (B13). It keeps every custom prompt, including the Legacy scene, profile and dice prompts.');
    const path = await upload(file.name, file.text);
    s[BACKUP_KEY] = { name: file.name, path, created: file.created, bytes: file.text.length };
    saveSettings();
    return s[BACKUP_KEY];
}

/** Read a backup file's text. Throws a plain sentence when it is not one. */
export function readBackup(text) {
    let data;
    try { data = JSON.parse(String(text ?? '')); } catch { throw new Error('This file is not a settings backup: it is not JSON.'); }
    if (data?.schema !== BACKUP_SCHEMA || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) {
        throw new Error('This file is not a Roleplay Instructions settings backup.');
    }
    return data;
}

/** Put a backup's settings back in place of the current ones. The record of the backups taken stays. */
export function restoreBackup(text) {
    const data = readBackup(text);
    const root = ctx().extensionSettings;
    const current = root[KEY] && typeof root[KEY] === 'object' ? root[KEY] : {};
    const kept = Object.fromEntries(KEPT_ON_RESTORE.filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, structuredClone(data.settings), kept);
    root[KEY] = current;
    settings();
    saveSettings();
    return { created: data.created || '', keys: Object.keys(data.settings).length, prompts: Object.keys(data.settings.prompts || {}).length };
}

// ---------------------------------------------------------------- the one-time conversion of saved Legacy state

/** Who a person is, from a Legacy profile block's lasting lines, in the shape the Characters card reads. */
function portrayalOf(profile) {
    const stable = profile?.stable || {};
    const text = [stable.who, stable.strength && `Strength: ${stable.strength}`, stable.flaw && `Flaw: ${stable.flaw}`, stable.orientation && `Orientation: ${stable.orientation}`]
        .filter(Boolean).join('. ');
    if (!text && !stable.voice) return null;
    return { subject: clip(profile.name, 80), text: clip(text, 600), ...(stable.voice ? { voice: clip(stable.voice, 300) } : {}), aliases: [], source: 'legacy' };
}

/**
 * Convert one saved Legacy reply record in place. Returns true when it changed. The values the record already
 * carries move into the Structured fields: a profile block's current lines join `stateChanges` (an explicit saved
 * change for the same person keeps precedence, as the old reader gave it), and its lasting lines become `v10Profiles`.
 */
export function convertRecord(rec) {
    if (!rec || typeof rec !== 'object' || rec.v10 || rec.legacyConverted) return false;
    const profiles = Array.isArray(rec.profiles) ? rec.profiles : [];
    if (!profiles.length) return false;
    const saved = Array.isArray(rec.stateChanges) ? rec.stateChanges : [];
    const recorded = new Set(saved.map(change => norm(change.name)));
    rec.stateChanges = [...changesFromProfiles(profiles).filter(change => !recorded.has(norm(change.name))), ...saved];
    const portrayals = profiles.map(portrayalOf).filter(Boolean);
    if (portrayals.length && !Array.isArray(rec.v10Profiles)) rec.v10Profiles = portrayals;
    rec.legacyConverted = CONVERSION_VERSION;
    return true;
}

/** Convert every saved Legacy record of a chat, the shown reply and each kept swipe. Returns the number of replies converted. */
export function convertChat(chat) {
    let count = 0;
    for (const message of Array.isArray(chat) ? chat : []) {
        if (!message || message.is_user) continue;
        const records = new Set([message.extra?.[KEY], ...(Array.isArray(message.swipe_info) ? message.swipe_info.map(info => info?.extra?.[KEY]) : [])]);
        let changed = false;
        for (const rec of records) if (convertRecord(rec)) changed = true;
        if (changed) count += 1;
    }
    return count;
}

/** Convert the open chat once, after the backup exists. Returns { converted } or { skipped, reason }. */
export async function convertOpenChat() {
    if (!isChatOpen()) return { skipped: true, reason: 'no chat' };
    if (!settings()[BACKUP_KEY]?.name) return { skipped: true, reason: 'no backup yet' };
    const c = ctx();
    const meta = c.chatMetadata;
    if (!meta) return { skipped: true, reason: 'no chat data' };
    meta[KEY] ||= {};
    if (meta[KEY].legacyConverted?.v >= CONVERSION_VERSION) return { skipped: true, reason: 'already converted' };
    const converted = convertChat(c.chat || []);
    meta[KEY].legacyConverted = { v: CONVERSION_VERSION, at: Date.now(), replies: converted };
    try { await c.saveChat?.(); } catch (error) { console.warn(LOG, 'saving the converted chat', error); }
    return { converted };
}

let started = false;
/** Take the backup, then convert each chat on its first open. A failed backup is tried again on the next chat open. */
export function startLegacyRetirement() {
    if (started) return;
    started = true;
    const run = async () => {
        try {
            await backupBeforeRetirement();
            const result = await convertOpenChat();
            if (result.converted) {
                console.log(LOG, 'Legacy replies converted', result.converted);
                (await import('./ui/sent.js')).refreshUnderReplies();
            }
        } catch (error) { console.warn(LOG, 'Legacy retirement', error); }
    };
    on('CHAT_CHANGED', () => setTimeout(run, 0));
    setTimeout(run, 0);
}
