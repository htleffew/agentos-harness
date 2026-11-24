// Some suites read fixtures or design tables from docs/, and a release ships tests/ without docs/.
// A suite calls needsDocs(name, ['docs/ux-overhaul/...']) before it reads them. When a path is missing the suite
// prints one SKIP line that names the paths and ends with status 0 instead of failing.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function needsDocs(name, relativePaths) {
    const root = path.join(__dirname, '..');
    const missing = relativePaths.filter(item => !fs.existsSync(path.join(root, item)));
    if (!missing.length) return;
    console.log(`SKIP ${name}: needs ${missing.join(', ')} from the source checkout; docs/ is not shipped with tests/.`);
    process.exit(0);
};
