// Setup, Presets, Cleanup (DESIGN.md 7, B18): back up every Chat Completion preset, review the copies and Evening Truth
// groups, confirm once, and restore the backup in one step. Nothing changes until she taps the confirm button.
import { h, button, download } from './dom.js';
import { registerPage } from './page-registry.js';
import { ctx, confirmBox } from '../st.js';
import { plainName } from '../preset-library.js';
import { entriesOf, planCleanup, planKey, buildBackup, parseBackup, applyCleanup, restoreBackup, restoreDiff, profileProtections, digest } from '../preset-cleanup.js';

export const PAGE_ID = 'preset-cleanup';
const SETTINGS_KEY = 'roleplay_instructions_preset_backups';
const manager = () => ctx().getPresetManager?.('openai');
const hint = text => h('p', { class: 'ri-help' }, text);
const chip = (text, kind = '') => h('span', { class: `ri-ps-chip${kind ? ' ri-ps-chip-' + kind : ''}` }, text);
const size = value => Number.isFinite(value) ? value.toLocaleString('en-US') : 'not set';
const state = { status: '', busy: '', backup: null, key: '', result: null, copies: null };

// ---- Saved copies of the backup, kept in SillyTavern's user files and listed in the extension's settings ----

const savedList = () => { const list = ctx().extensionSettings?.[SETTINGS_KEY]; return Array.isArray(list) ? list : []; };
function remember(item) {
    const host = ctx();
    if (!host.extensionSettings) return;
    host.extensionSettings[SETTINGS_KEY] = [item, ...savedList().filter(old => old.path !== item.path)].slice(0, 5);
    host.saveSettingsDebounced?.();
}
function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}
const headers = () => ctx().getRequestHeaders?.() || { 'Content-Type': 'application/json' };

/** Write the backup into SillyTavern's user files and read it back to prove it landed. Returns the path, or '' when the host would not take it. */
async function saveServerCopy(backup) {
    try {
        const response = await fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name: backup.name, data: toBase64(backup.text) }) });
        if (!response.ok) return '';
        const path = (await response.json())?.path;
        if (!path) return '';
        const again = await fetch(`/${String(path).replace(/^\/+/, '')}`, { cache: 'no-store' });
        if (!again.ok) return '';
        return await digest(await again.text()) === await digest(backup.text) ? path : '';
    } catch { return ''; }
}

// ---- Steps ----

async function runBackup(rerender) {
    state.busy = 'backup'; state.status = 'Backing up every preset.'; rerender();
    try {
        const entries = entriesOf(manager());
        if (!entries.length) throw new Error('No Chat Completion presets were found. Switch the Main API to Chat Completion first.');
        const backup = await buildBackup(entries);
        const path = await saveServerCopy(backup);
        const downloaded = download(backup.name, backup.text);
        if (!path && !downloaded) throw new Error('The backup could not be saved here or downloaded, so nothing was changed.');
        state.backup = { name: backup.name, count: backup.count, libraryHash: backup.libraryHash, path, downloaded, text: backup.text, created: backup.created };
        if (path) remember({ name: backup.name, path, count: backup.count, created: backup.created });
        state.status = path ? `Backed up ${backup.count} presets. A copy is in SillyTavern’s user files${downloaded ? ' and a download started' : ''}.`
            : `Backed up ${backup.count} presets by download only; the host would not keep a copy.`;
    } catch (error) { state.backup = null; state.status = error.message || String(error); }
    state.busy = ''; rerender();
}

async function runCleanup(rerender) {
    if (!state.backup) return;
    state.busy = 'apply'; state.status = 'Cleaning up.'; rerender();
    try {
        const protectedNames = profileProtections(ctx());
        const outcome = await applyCleanup(manager(), state.key, state.backup, { protectedNames });
        state.result = outcome;
        state.backup = null;
        state.status = `${outcome.retired.length} presets retired and ${outcome.profilesWritten} presets now carry the context sizes as model profiles.${outcome.failed.length ? ` ${outcome.failed.length} could not be deleted: ${outcome.failed.map(plainName).join(', ')}.` : ''} Restore the backup to undo this.`;
    } catch (error) { state.status = error.message || String(error); }
    state.busy = ''; rerender();
}

async function runRestore(backup, label, rerender) {
    state.busy = 'restore'; rerender();
    try {
        const diff = restoreDiff(entriesOf(manager()), backup.entries);
        const parts = [];
        if (diff.recreate.length) parts.push(`bring back ${diff.recreate.length} deleted`);
        if (diff.rewrite.length) parts.push(`rewrite ${diff.rewrite.length} changed`);
        if (!parts.length) { state.status = 'The library already matches this backup.'; state.busy = ''; rerender(); return; }
        const note = diff.added.length ? ` ${diff.added.length} presets made since then stay as they are.` : '';
        if (!await confirmBox(`Restore ${label}? This will ${parts.join(' and ')} presets.${note}`)) { state.busy = ''; state.status = 'Nothing was restored.'; rerender(); return; }
        const done = await restoreBackup(manager(), backup);
        state.result = null; state.backup = null;
        state.status = `Restored: ${done.recreated} brought back, ${done.rewritten} rewritten, ${done.unchanged} already matched.${done.exact ? ' The library matches the backup exactly.' : ' The library differs from the backup in presets made after it.'}`;
    } catch (error) { state.status = error.message || String(error); }
    state.busy = ''; rerender();
}

async function restoreFromText(text, label, rerender) {
    try { await runRestore(await parseBackup(text), label, rerender); }
    catch (error) { state.status = error.message || String(error); rerender(); }
}

// ---- Page ----

const row = (...kids) => h('div', { class: 'ri-ps-line ri-pc-row' }, kids);

function copiesList(plan) {
    const shown = plan.copies.filter(item => item.state !== 'gone');
    const rows = shown.map(item => row(
        h('div', { class: 'ri-pc-names' }, h('strong', {}, plainName(item.copy)), h('span', { class: 'ri-pc-arrow', 'aria-hidden': 'true' }, ' → '), h('span', {}, plainName(item.base))),
        h('p', { class: 'ri-ps-meta' }, `Context ${size(item.copyContext)} (base ${size(item.baseContext)})`,
            item.state === 'ready' ? ' · becomes a model profile on the base' : ''),
        item.state === 'ready' ? chip('Retires', 'on') : chip('Stays', 'conflict'), item.note && hint(item.note)));
    return h('details', { class: 'ri-ps-fold', open: true, id: 'ri-cleanup-copies' }, h('summary', {}, `Copies of a base (${plan.copyCount} of 14 ready)`),
        hint('Each copy has its base’s prompt blocks and sampler values and differs only in the context size it saved.'),
        rows.length ? rows : hint('None of the 14 copies is in this library.'));
}

function groupsList(plan) {
    const items = plan.groups.map(group => h('details', { class: 'ri-ps-fold ri-pc-group', 'data-keeper': group.keeper },
        h('summary', {}, plainName(group.keeper), chip(`${group.members.length} presets`, 'tag')),
        hint('One Evening Truth preset stays; the others retire and their context sizes become model profiles on it.'),
        group.members.map(member => row(h('strong', {}, plainName(member.name)),
            h('p', { class: 'ri-ps-meta' }, `Context ${size(member.context)}`),
            member.keeper ? chip('Stays', 'distinct') : member.kept ? chip('Stays', 'conflict') : chip('Retires', 'on'), member.kept && hint(member.kept)))));
    return h('details', { class: 'ri-ps-fold', open: true, id: 'ri-cleanup-groups' }, h('summary', {}, `Evening Truth groups (${plan.groupCount})`),
        hint('Evening Truth presets that match apart from their context size. Every other Evening Truth preset stays as it is.'),
        items.length ? items : hint('No two Evening Truth presets differ only in context size.'));
}

function restoreSection(rerender) {
    const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Preset backup file',
        onchange: async event => {
            const chosen = event.target.files?.[0];
            event.target.value = '';
            if (chosen) await restoreFromText(await chosen.text(), chosen.name, rerender);
        } });
    const saved = savedList();
    return h('section', { class: 'ri-ps-card ri-pc-card', id: 'ri-cleanup-restore' }, h('h4', { class: 'ri-ps-heading' }, 'Restore a backup'),
        hint('Puts every preset back exactly as the backup holds it, in one step. Presets made after the backup stay.'),
        h('div', { class: 'ri-row ri-row-tight' }, button('Restore from a file', () => file.click(), { kind: 'ghost', disabled: !!state.busy }), file),
        saved.map(item => row(h('strong', {}, item.name), h('p', { class: 'ri-ps-meta' }, `${item.count} presets · saved in SillyTavern’s user files`),
            button('Restore this copy', async () => {
                try {
                    const response = await fetch(`/${String(item.path).replace(/^\/+/, '')}`, { cache: 'no-store' });
                    if (!response.ok) throw new Error('SillyTavern no longer has that copy. Restore from a downloaded file instead.');
                    await restoreFromText(await response.text(), item.name, rerender);
                } catch (error) { state.status = error.message || String(error); rerender(); }
            }, { kind: 'ghost', disabled: !!state.busy }))));
}

export function renderCleanupPage(body) {
    const host = h('div', { class: 'ri-ps ri-pc', id: 'ri-cleanup-page' });
    // A step can rerender more than once, so each pass replaces whichever page element is in the document now.
    const rerender = () => { const fresh = h('div'); renderCleanupPage(fresh); (host.isConnected ? host : document.getElementById('ri-cleanup-page') || host).replaceWith(...fresh.childNodes); };
    const api = manager();
    if (!api?.getPresetList) {
        host.append(hint(ctx().mainApi && ctx().mainApi !== 'openai' ? 'Presets here are Chat Completion presets. Switch the Main API to Chat Completion.' : 'The preset list is not ready yet.'));
        body.append(host);
        return;
    }
    const entries = entriesOf(api);
    const plan = planCleanup(entries, { protectedNames: profileProtections(ctx()) });
    state.key = planKey(plan);
    const busy = !!state.busy;
    const backupCard = h('section', { class: 'ri-ps-card ri-pc-card', id: 'ri-cleanup-backup' }, h('h4', { class: 'ri-ps-heading' }, '1. Back up'),
        hint('Saves every Chat Completion preset into one file before anything changes. The file stays in SillyTavern’s user files and downloads to this device.'),
        state.backup ? h('p', { class: 'ri-ps-meta' }, chip('Backed up', 'on'), ` ${state.backup.count} presets in ${state.backup.name}`) : null,
        h('div', { class: 'ri-row ri-row-tight' },
            button(state.backup ? `Back up again (${entries.length} presets)` : `Back up ${entries.length} presets`, () => runBackup(rerender), { kind: state.backup ? 'ghost' : 'primary', disabled: busy || !entries.length }),
            state.backup && button('Download again', () => { if (!download(state.backup.name, state.backup.text)) { state.status = 'This host could not start the download.'; rerender(); } }, { kind: 'ghost' })));
    const reviewCard = h('section', { class: 'ri-ps-card ri-pc-card', id: 'ri-cleanup-review' }, h('h4', { class: 'ri-ps-heading' }, '2. Review'),
        copiesList(plan), groupsList(plan));
    const confirmCard = h('section', { class: 'ri-ps-card ri-pc-card', id: 'ri-cleanup-confirm' }, h('h4', { class: 'ri-ps-heading' }, '3. Confirm'),
        plan.empty ? hint('There is nothing to clean up in this library.')
            : hint(state.backup ? 'Nothing has changed yet. This button retires the presets listed above and writes their context sizes onto the presets that stay.'
                : 'Back up first; this button stays off until a backup of the current library exists.'),
        h('div', { class: 'ri-row ri-row-tight' }, button(plan.label, () => runCleanup(rerender), { kind: 'primary', disabled: busy || plan.empty || !state.backup, title: plan.label })));
    host.append(h('p', { class: 'ri-help', role: 'status', id: 'ri-cleanup-status' }, state.status),
        hint('Retires the exact copies and merges Evening Truth presets that differ only in context size. A retired preset’s context size stays as a model profile on the preset that remains.'),
        backupCard, reviewCard, confirmCard, restoreSection(rerender));
    body.append(host);
}

let styled = false;
function loadStyles() {
    if (styled || !globalThis.document) return;
    styled = true;
    document.head.append(h('link', { rel: 'stylesheet', id: 'ri-preset-cleanup-css', href: new URL('./preset-cleanup.css', import.meta.url).href }));
}

let mounted = false;
export function mountPresetCleanup() {
    if (mounted || !globalThis.SillyTavern?.getContext) return;
    mounted = true;
    loadStyles();
    registerPage({ id: PAGE_ID, group: 'setup', subgroup: 'Presets', label: 'Cleanup', withoutChat: true, order: 1,
        help: 'Back up every preset, then retire exact copies and merge Evening Truth presets that differ only in context size.',
        aliases: 'preset cleanup backup restore copies duplicate evening truth merge context size model profile', render: renderCleanupPage });
}
try { mountPresetCleanup(); } catch (error) { console.warn('Roleplay Instructions could not add Setup, Presets, Cleanup.', error); }
