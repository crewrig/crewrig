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

// --- Base-branch status invariant (spec 0109) -------------------------------
// The helpers below give the linter the one thing it previously lacked: a view
// of the change's base branch. They exist to answer a single question — is this
// spec file already present on the base branch? — because that is the
// discriminator spec 0109 R2 names: a spec the change under test introduces is
// legitimately `draft` until its own merge mechanic flips it, while a spec
// already on the base branch carrying `draft` is the contradiction R1 forbids.

// gitCapture(args) — run git, capturing both streams. Returns the exit status
// and stdout; never throws and never leaks git's own stderr into the linter's
// output, so callers can probe git freely (including outside a repository).
function gitCapture(args) {
    const result = spawnSync('git', args, { encoding: 'utf8' });
    return {
        status: result.status,
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
    };
}

// resolveBaseRef() — the base ref to compare against, resolved exactly as
// scripts/check-skill-versions.sh:24-33 does so the repository has one idiom
// rather than two: `BASE_REF` when set, else the first remote matching
// `crewrig|origin` (falling back to the first remote at all) with `/main`
// appended. Verifies the ref, retrying once behind a shallow-clone `--depth=50`
// fetch, and returns an `error` (never a silent fallback) if it still does not
// resolve. The linter's positional arguments are spec targets, so `BASE_REF` is
// the only override — that is the one difference from the shell sibling.
function resolveBaseRef() {
    let ref = process.env.BASE_REF;
    if (!ref) {
        const remotes = gitCapture(['remote']).stdout.split('\n').map((r) => r.trim()).filter(Boolean);
        const preferred = remotes.find((r) => /crewrig|origin/.test(r)) || remotes[0];
        if (!preferred) {
            return { error: 'no git remote is configured, so no default base ref could be derived' };
        }
        ref = `${preferred}/main`;
    }

    if (gitCapture(['rev-parse', '--verify', ref]).status === 0) {
        return { ref };
    }

    // Covers fresh CI clones, which are shallow by default.
    const remote = ref.split('/')[0];
    const branch = ref.slice(remote.length + 1);
    if (branch) {
        gitCapture(['fetch', '--depth=50', remote, branch]);
        if (gitCapture(['rev-parse', '--verify', ref]).status === 0) {
            return { ref };
        }
    }

    return { error: `base ref '${ref}' does not resolve and \`git fetch\` did not recover it` };
}

// baseBranchPaths(baseRef, relPaths) — the subset of relPaths that exists on
// baseRef, as a Set. One `git ls-tree` call with the linted paths as pathspecs:
// git reports only the paths it finds, so the returned Set is the intersection
// by construction. R3 is satisfied here — the set comes from the repository at
// check time, never from a recorded list.
function baseBranchPaths(baseRef, relPaths) {
    if (relPaths.length === 0) {
        return new Set();
    }
    const result = gitCapture(['ls-tree', '-r', '-z', '--name-only', baseRef, '--', ...relPaths]);
    if (result.status !== 0) {
        return null;
    }
    return new Set(result.stdout.split('\0').filter(Boolean));
}

// resolveBaseContext(files) — decide whether the base-branch status check runs,
// and if so against which paths. Three outcomes, deliberately distinct:
//
//   1. Not inside a git work tree → SKIP, with a notice on stderr. Without a
//      repository there is no "change under test" and so no base branch to be
//      the discriminator; the check has no subject rather than a subject it
//      failed to inspect. This is the tarball/temp-fixture case, never CI —
//      every CI checkout is a git repository.
//   2. Inside a repository, base ref resolves → ENFORCE.
//   3. Inside a repository, base ref does NOT resolve → hard error, exit 2.
//      Fail closed: a repository whose base cannot be resolved is a wiring
//      fault (missing `fetch-depth: 0`, unfetched remote), and passing it as
//      green would restore the "green does not mean checked" defect that spec
//      0109 exists to remove. Exit 2 — not the linter's own exit 1 — marks it
//      as an environment fault rather than a lint finding, matching
//      check-skill-versions.sh.
function resolveBaseContext(files) {
    const toplevel = gitCapture(['rev-parse', '--show-toplevel']);
    if (toplevel.status !== 0 || toplevel.stdout.trim() === '') {
        console.error(
            `[SKIP] Base-branch status check (spec 0109): not inside a git work tree, `
            + `so the base branch of the change under test cannot be determined. `
            + `Specs already on the base branch were NOT checked for 'status: draft'.`
        );
        return { enforced: false };
    }
    // Both sides are canonicalized before being compared: git reports the
    // physical work-tree path, so a linted path reached through a symlink
    // (a symlinked checkout, /tmp on macOS) would otherwise resolve "outside"
    // the repository and be silently exempted from the check.
    const repoRoot = fs.realpathSync(toplevel.stdout.trim());

    const { ref, error } = resolveBaseRef();
    if (error) {
        console.error(`\n[ERROR] Base-branch status check (spec 0109) cannot run: ${error}.`);
        console.error(`        Point it at a resolvable ref via the BASE_REF environment variable.`);
        process.exit(2);
    }

    // Only paths inside the work tree can be compared against a tree-ish;
    // anything outside it is not part of the change under test.
    const relPathByFile = new Map();
    for (const file of files) {
        const rel = path.relative(repoRoot, fs.realpathSync(path.resolve(file))).split(path.sep).join('/');
        if (rel === '' || rel.startsWith('../')) continue;
        relPathByFile.set(file, rel);
    }

    const basePaths = baseBranchPaths(ref, Array.from(relPathByFile.values()));
    if (basePaths === null) {
        console.error(`\n[ERROR] Base-branch status check (spec 0109): 'git ls-tree ${ref}' failed.`);
        process.exit(2);
    }

    return { enforced: true, ref, basePaths, relPathByFile };
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

    return { hasErrors, errors, id, isDelta, status: fm.status };
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

    // Resolved before the (slow) markdownlint pass so a base-ref wiring fault
    // surfaces immediately instead of after a full lint run.
    const baseContext = resolveBaseContext(uniqueFiles);

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
        const { hasErrors, errors, id, isDelta, status } = lintFile(file);
        fileResults.push({ file, id, isDelta, status });
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

    // Base-branch `status: draft` check (spec 0109 R1/R2). A non-delta spec
    // already present on the base branch has by definition had its own spec-PR
    // merged, which is the trigger docs/spec-format.md assigns to `approved` —
    // so `draft` on it is a contradiction, not a lagging value. Delta-specs are
    // exempt (R2); their convention is deliberately left to its own ticket.
    // The status read is the one in the tree under test, so the change that
    // corrects a stale `draft` passes on the same run that introduces the
    // check — which is what makes R6's single-change landing possible.
    if (baseContext.enforced) {
        const offenders = fileResults.filter(({ file, isDelta, status }) =>
            !isDelta && status === 'draft' && baseContext.basePaths.has(baseContext.relPathByFile.get(file))
        );
        if (offenders.length > 0) {
            console.error(`\n[FAIL] Non-delta specs present on the base branch (${baseContext.ref}) carry 'status: draft':`);
            for (const { file } of offenders) {
                console.error(`  - ${file}`);
            }
            console.error(`  A spec reaches the base branch only by its own merged spec-PR, which is`);
            console.error(`  the trigger docs/spec-format.md assigns to 'approved'. Record the status`);
            console.error(`  that reflects the spec's true state (metadata-only edit).`);
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
