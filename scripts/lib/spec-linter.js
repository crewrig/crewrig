const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');
const semver = require('semver');

const STATUS_ENUM = ['draft', 'approved', 'implemented', 'archived', 'superseded'];
const COMPLEXITY_ENUM = ['trivial', 'small', 'standard', 'large'];
const INTERACTION_MODE_ENUM = ['FULL', 'INTERMEDIATE', 'MINIMAL', 'AUTO'];

const ORIGINAL_HEADINGS = ['## Intent', '## Requirements', '## Scenarios', '## Out of scope', '## Open questions'];
const DELTA_HEADINGS = ['## ADDED', '## MODIFIED', '## REMOVED'];

function globSpecs(targetPath) {
    const result = [];
    if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
            if (targetPath.endsWith('.md')) {
                result.push(targetPath);
            }
        } else if (stat.isDirectory()) {
            const files = fs.readdirSync(targetPath, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(targetPath, file.name);
                if (file.isDirectory()) {
                    result.push(...globSpecs(fullPath));
                } else if (file.name.endsWith('.md') && file.name !== '_template.md' && file.name !== 'README.md') {
                    result.push(fullPath);
                }
            }
        }
    } else {
        // It might be a glob or exact path. Let's just return it and let markdownlint fail if missing.
        // Actually, if it's explicitly passed and doesn't exist, we'll try treating it as a glob.
        // For simplicity, we just use Node's simple glob. 
        // We'll let bash globbing expand process.argv.
    }
    return result;
}

// loadCorePathsManifest() — reads .crewrig/core-paths.txt and returns its
// entries as { path, policy } objects. Mirrors the parsing rules in
// scripts/check-core-paths.sh:41-54: blank/`#` lines are skipped, the path is
// the first whitespace-delimited field, the policy is the next token
// (defaulting to `strict`). A missing manifest resolves to an empty list
// rather than throwing, so a checkout without the file still lints normally.
function loadCorePathsManifest() {
    const repoDir = process.env.CREWRIG_REPO_DIR || path.join(__dirname, '..', '..');
    const manifestPath = path.join(repoDir, '.crewrig', 'core-paths.txt');

    let content;
    try {
        content = fs.readFileSync(manifestPath, 'utf8');
    } catch (e) {
        return [];
    }

    const entries = [];
    for (const rawLine of content.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
            continue;
        }
        const match = trimmed.match(/^(\S+)(?:\s+(\S+))?/);
        if (!match) {
            continue;
        }
        entries.push({ path: match[1], policy: match[2] || 'strict' });
    }
    return entries;
}

// isExcludedSpecPath(relPath, entries) — true iff the manifest entry whose
// path most closely (longest-prefix match) matches relPath classifies it
// `excluded`. relPath must match exactly, or relPath must sit under the
// entry's path bounded by `/` (so `specs/org2` does not match an entry for
// `specs/org`). This is the R5 mechanism: the caller never hardcodes
// `specs/org` — whatever the manifest classifies `excluded` under `specs/`
// is skipped, today and for any future nested entry.
function isExcludedSpecPath(relPath, entries) {
    const normalized = relPath.split(path.sep).join('/');
    let best = null;
    for (const entry of entries) {
        if (normalized === entry.path || normalized.startsWith(entry.path + '/')) {
            if (!best || entry.path.length > best.path.length) {
                best = entry;
            }
        }
    }
    return best !== null && best.policy === 'excluded';
}

function lintFile(filePath) {
    let hasErrors = false;
    const errors = [];

    const reportError = (msg) => {
        errors.push(msg);
        hasErrors = true;
    };

    const content = fs.readFileSync(filePath, 'utf8');
    const basename = path.basename(filePath);
    const isDelta = basename.includes('.delta-');
    let id;

    if (basename === '_template.md' || basename === 'README.md') {
        return { hasErrors, errors, id, isDelta };
    }

    let expectedId = '';
    let expectedSlug = '';
    const match = basename.match(/^(\d{4})-([a-z0-9\-]+?)(?:\.delta-\d+)?\.md$/);
    if (!match) {
        reportError(`Filename does not match <NNNN>-<kebab-slug>.md or <NNNN>-<kebab-slug>.delta-<NN>.md`);
    } else {
        expectedId = match[1];
        expectedSlug = match[2];
    }

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
        reportError(`Missing YAML frontmatter block`);
        return { hasErrors, errors, id, isDelta };
    }

    let fm;
    try {
        fm = yaml.load(fmMatch[1]);
    } catch (e) {
        reportError(`Failed to parse YAML frontmatter: ${e.message}`);
        return { hasErrors, errors, id, isDelta };
    }

    if (!fm) {
        reportError(`Frontmatter is empty`);
        return { hasErrors, errors, id, isDelta };
    }

    const mandatoryFields = ['id', 'slug', 'status', 'complexity', 'version', 'related-issue'];
    for (const field of mandatoryFields) {
        if (!(field in fm) || fm[field] === null || fm[field] === undefined) {
            reportError(`Missing mandatory frontmatter field: '${field}'`);
        }
    }

    if (fm.id !== undefined) {
        const fmIdStr = typeof fm.id === 'string' ? fm.id : fm.id.toString().padStart(4, '0');
        id = fmIdStr;
        if (fmIdStr !== expectedId) {
            reportError(`Frontmatter 'id' ("${fmIdStr}") does not match filename prefix ("${expectedId}")`);
        }
    }
    if (fm.slug !== undefined && fm.slug !== expectedSlug) {
        reportError(`Frontmatter 'slug' ("${fm.slug}") does not match filename slug ("${expectedSlug}")`);
    }

    if (fm.status && !STATUS_ENUM.includes(fm.status)) {
        reportError(`Invalid 'status' ("${fm.status}"). Allowed: ${STATUS_ENUM.join(', ')}`);
    }
    if (fm.complexity && !COMPLEXITY_ENUM.includes(fm.complexity)) {
        reportError(`Invalid 'complexity' ("${fm.complexity}"). Allowed: ${COMPLEXITY_ENUM.join(', ')}`);
    }

    if (fm.status && fm.status !== 'draft') {
        if (!('interaction-mode' in fm) || fm['interaction-mode'] === null) {
            reportError(`'interaction-mode' MUST be present if status is not 'draft'`);
        }
    }
    if (fm['interaction-mode'] && !INTERACTION_MODE_ENUM.includes(fm['interaction-mode'])) {
        reportError(`Invalid 'interaction-mode' ("${fm['interaction-mode']}"). Allowed: ${INTERACTION_MODE_ENUM.join(', ')}`);
    }

    if (fm.version && !semver.valid(fm.version.toString())) {
        reportError(`Invalid 'version' ("${fm.version}"). Must be valid SemVer.`);
    }

    if ('related-issue' in fm && !Number.isInteger(fm['related-issue'])) {
        reportError(`'related-issue' MUST be an integer.`);
    }

    if ('max-iterations' in fm && fm['max-iterations'] !== null) {
        if (!Number.isInteger(fm['max-iterations'])) {
            reportError(`'max-iterations' MUST be an integer.`);
        } else if (fm['max-iterations'] < 1 || fm['max-iterations'] > 20) {
            reportError(`'max-iterations' MUST be bounded between 1 and 20 (inclusive).`);
        }
    }

    if (fm.status === 'superseded') {
        if (!('superseded-by' in fm) || !fm['superseded-by']) {
            reportError(`'superseded-by' is REQUIRED when status is 'superseded'.`);
        }
    } else {
        if ('superseded-by' in fm && fm['superseded-by'] !== null) {
            reportError(`'superseded-by' is PROHIBITED when status is not 'superseded'.`);
        }
    }

    const lines = content.split('\n');
    const h2Headings = [];
    let inCodeBlock = false;
    for (const line of lines) {
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (!inCodeBlock && line.startsWith('## ')) {
            h2Headings.push(line.trim());
        }
    }

    if (!isDelta) {
        if (h2Headings.length < ORIGINAL_HEADINGS.length) {
            reportError(`Missing mandatory H2 headings for original spec. Required: ${ORIGINAL_HEADINGS.join(', ')}`);
        } else {
            for (let i = 0; i < ORIGINAL_HEADINGS.length; i++) {
                if (h2Headings[i] !== ORIGINAL_HEADINGS[i]) {
                    reportError(`Heading #${i + 1} MUST be "${ORIGINAL_HEADINGS[i]}", found "${h2Headings[i] || 'None'}"`);
                }
            }
        }
    } else {
        if (h2Headings.length < DELTA_HEADINGS.length) {
            reportError(`Missing mandatory H2 headings for delta spec. Required: ${DELTA_HEADINGS.join(', ')}`);
        } else {
            for (let i = 0; i < DELTA_HEADINGS.length; i++) {
                if (h2Headings[i] !== DELTA_HEADINGS[i]) {
                    reportError(`Heading #${i + 1} MUST be "${DELTA_HEADINGS[i]}" (no intermediate wrappers), found "${h2Headings[i] || 'None'}"`);
                }
            }
        }
    }

    return { hasErrors, errors, id, isDelta };
}

function run() {
    const rawTargets = process.argv.slice(2);
    let targets = rawTargets.length > 0 ? rawTargets : ['specs'];
    
    const filesToLint = [];
    for (const target of targets) {
        filesToLint.push(...globSpecs(target));
    }

    if (filesToLint.length === 0) {
        console.error(`No valid markdown specs found.`);
        process.exit(1);
    }
    
    const uniqueFiles = Array.from(new Set(filesToLint));

    console.log(`Running markdownlint-cli on ${uniqueFiles.length} files...`);
    const lintResult = spawnSync('npx', ['markdownlint', ...uniqueFiles, '-c', '.markdownlintrc'], { stdio: 'inherit' });
    if (lintResult.status !== 0) {
        console.error(`\n[ERROR] markdownlint failed.`);
        process.exit(1);
    }
    
    console.log(`Running semantic validation...`);
    let totalErrors = 0;

    const manifestEntries = loadCorePathsManifest();

    const fileResults = [];
    for (const file of uniqueFiles) {
        if (isExcludedSpecPath(file, manifestEntries)) continue;
        const { hasErrors, errors, id, isDelta } = lintFile(file);
        fileResults.push({ file, id, isDelta });
        if (hasErrors) {
            console.error(`\n[FAIL] ${file}`);
            for (const err of errors) {
                console.error(`  - ${err}`);
            }
            totalErrors++;
        }
    }

    // Cross-file duplicate-`id` check (spec 0098). Groups the already-parsed
    // `id` from every non-excluded, non-delta file (R4/R5) and reports any
    // group of size >= 2 as a failure naming every colliding file (R1-R3).
    // Files whose `id` is `undefined` (frontmatter failed to parse) already
    // carry their own per-file error above, so they're skipped here rather
    // than double-reported. Groups of size 1 (or an empty map) satisfy R7 by
    // construction — no finding is ever emitted for them.
    const idGroups = new Map();
    for (const { file, id, isDelta } of fileResults) {
        if (isDelta || id === undefined) continue;
        if (!idGroups.has(id)) {
            idGroups.set(id, []);
        }
        idGroups.get(id).push(file);
    }
    for (const [id, files] of idGroups) {
        if (files.length >= 2) {
            console.error(`\n[FAIL] Duplicate spec id "${id}" across files:`);
            for (const f of files) {
                console.error(`  - ${f}`);
            }
            totalErrors++;
        }
    }

    if (totalErrors > 0) {
        console.error(`\nLinting failed: ${totalErrors} files contain errors.`);
        process.exit(1);
    }
    
    console.log(`\nLinting passed!`);
}

run();
