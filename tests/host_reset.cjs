// Save or restore a SillyTavern user folder so each browser suite starts from the same files.
//
//   node tests/host_reset.cjs save    <default-user folder> <snapshot folder>
//   node tests/host_reset.cjs restore <default-user folder> <snapshot folder>
//
// restore deletes every file the snapshot does not hold (presets, World Info books, chats and stacks a suite left
// behind) and copies the snapshot's files back. The extension folder is skipped (lib.js copies it before each suite),
// and so are SillyTavern's backups and thumbnails.
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['extensions', 'backups', 'thumbnails']);
const [mode, live, snap] = process.argv.slice(2);
if (!['save', 'restore'].includes(mode) || !live || !snap) {
    console.error('usage: host_reset.cjs save|restore <default-user folder> <snapshot folder>');
    process.exit(2);
}

const files = (root, rel = '') => {
    const out = [];
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, entry.name);
        if (!rel && SKIP.has(entry.name)) continue;
        if (entry.isDirectory()) out.push(...files(root, r));
        else out.push(r);
    }
    return out;
};

if (mode === 'save') {
    fs.rmSync(snap, { recursive: true, force: true });
    for (const f of files(live)) {
        fs.mkdirSync(path.dirname(path.join(snap, f)), { recursive: true });
        fs.copyFileSync(path.join(live, f), path.join(snap, f));
    }
} else {
    const keep = new Set(files(snap));
    let removed = 0;
    for (const f of files(live)) if (!keep.has(f)) { fs.rmSync(path.join(live, f), { force: true }); removed++; }
    for (const f of keep) {
        fs.mkdirSync(path.dirname(path.join(live, f)), { recursive: true });
        fs.copyFileSync(path.join(snap, f), path.join(live, f));
    }
    if (removed) console.log(`host_reset: removed ${removed} files left by the last suite`);
}
