#!/bin/bash
# test-monorepo-release-notes.sh — Regression test for issue #1225: the
# release note scripts/monorepo-release.sh produces for an extension must be
# non-empty and carry that extension's own gitmoji commit subjects.
#
# Root cause under test: semantic-release-monorepo resolves each wrapped step
# (analyzeCommits, generateNotes, success, fail) with an ESM `import()` of the
# plugin name. semantic-release-gitmoji is CommonJS, and Node's named-export
# detection exposes only `analyzeCommits`, so `generateNotes` was never found
# and every extension release shipped an empty note.
#
# Hermetic harness:
#   - a throwaway git repository with one extension directory, a local bare
#     remote (so semantic-release's push-permission probe runs offline), and
#     gitmoji commits both inside and outside the extension;
#   - the REAL scripts/monorepo-release.sh runs against it, generating the
#     REAL .releaserc.json; only `npx` is stubbed on PATH, so instead of the
#     CLI a Node driver runs the engine programmatically in dry-run mode with
#     that exact configuration;
#   - the only override is `verifyConditions: []`, because the GitHub plugin's
#     verifyConditions calls the GitHub API (network + token). Every step that
#     shapes the note (analyzeCommits, generateNotes) runs unmodified, and the
#     CI environment is scrubbed so env-ci resolves the branch from git.
#
# Requires `npm ci` (or `npm install`) to have populated node_modules.
#
# Usage:
#   bash scripts/tests/test-monorepo-release-notes.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$REPO_DIR/node_modules/semantic-release" ]; then
  echo "FATAL: node_modules/semantic-release is missing — run 'npm ci' first" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# --- Fixture repository ------------------------------------------------------
FIXTURE="$TMP_ROOT/repo"
REMOTE="$TMP_ROOT/remote.git"
git init -q --bare -b main "$REMOTE"
git init -q -b main "$FIXTURE"
g() { git -C "$FIXTURE" -c user.name=fixture -c user.email=fixture@example.invalid "$@"; }
g remote add origin "$REMOTE"

EXT_DIR="$FIXTURE/extensions/core/notes-fixture"
mkdir -p "$EXT_DIR"
printf '{\n  "name": "notes-fixture",\n  "version": "0.0.0",\n  "private": true\n}\n' > "$EXT_DIR/package.json"
g add -A && g commit -q -m "🎉 Scaffold notes-fixture"

echo a > "$EXT_DIR/a.txt"
g add -A && g commit -q -m "✨ Add the notes fixture feature"
echo b > "$EXT_DIR/b.txt"
g add -A && g commit -q -m "🐛 Fix the notes fixture defect"
echo outside > "$FIXTURE/outside.txt"
g add -A && g commit -q -m "✨ Add an unrelated root change"
g push -q origin main

# --- Driver: stands in for `npx semantic-release` ----------------------------
NOTES_OUT="$TMP_ROOT/notes.md"
RESULT_OUT="$TMP_ROOT/result.json"
BIN="$TMP_ROOT/bin"
mkdir -p "$BIN"

cat > "$TMP_ROOT/driver.mjs" <<'EOF'
// Runs semantic-release programmatically in dry-run with the .releaserc.json
// that scripts/monorepo-release.sh generated in the current directory.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [repoDir, notesOut, resultOut, remote] = process.argv.slice(2);
const require = createRequire(`${repoDir}/package.json`);
const { default: semanticRelease } = await import(
  pathToFileURL(require.resolve('semantic-release')).href
);

const config = JSON.parse(readFileSync('.releaserc.json', 'utf8'));
// Keep only what git and the engine need; drop every CI marker so env-ci
// resolves the branch from the fixture's git state, not the host runner.
const env = { PATH: process.env.PATH, HOME: process.env.HOME };

const result = await semanticRelease(
  { ...config, repositoryUrl: remote, dryRun: true, ci: false, verifyConditions: [] },
  { cwd: process.cwd(), env }
);

writeFileSync(notesOut, result ? result.nextRelease.notes || '' : '');
writeFileSync(
  resultOut,
  JSON.stringify(result ? { version: result.nextRelease.version, gitTag: result.nextRelease.gitTag } : null)
);
EOF

cat > "$BIN/npx" <<EOF
#!/bin/bash
exec node "$TMP_ROOT/driver.mjs" "$REPO_DIR" "$NOTES_OUT" "$RESULT_OUT" "file://$REMOTE"
EOF
chmod +x "$BIN/npx"

# --- Run the real release script ---------------------------------------------
LOG="$TMP_ROOT/release.log"
(
  cd "$FIXTURE" || exit 2
  # The driver is forge-aware (spec 0213): it refuses to run outside a
  # detected CI, and its rehearsal mode (DRY_RUN=true) no longer calls `npx`.
  # So it runs in GitHub PUBLISH mode, the path that generates the real config
  # and calls `npx semantic-release`; the stubbed `npx` above turns that call
  # into a dry run, and the driver.mjs env scrub keeps the engine from seeing
  # any CI marker or the placeholder credential.
  env -u CI -u GITHUB_REF -u GITHUB_HEAD_REF -u GITLAB_CI -u GITEA_ACTIONS \
    -u DRY_RUN -u RELEASE_DRY_RUN -u GITHUB_TOKEN -u GH_TOKEN \
    GITHUB_ACTIONS=true RELEASE_TOKEN=fixture-placeholder \
    PATH="$BIN:$PATH" bash "$SCRIPT_DIR/monorepo-release.sh"
) > "$LOG" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  ok "monorepo-release.sh dry run exits 0"
else
  ng "monorepo-release.sh dry run exits 0 (rc=$rc)"
fi

# --- Assertions ----------------------------------------------------------------
# Other plugins in the chain legitimately lack generateNotes; only the gitmoji
# entry (bare package name or its ESM facade) must reach the step.
if grep -Eq 'Start step "generateNotes" of plugin "[^"]*gitmoji[^"]*"' "$LOG" \
  && ! grep -Eq 'Plugin "[^"]*gitmoji[^"]*" does not provide step' "$LOG"; then
  ok "semantic-release-monorepo resolves every gitmoji step"
else
  ng "semantic-release-monorepo resolves every gitmoji step"
fi

if [ -f "$RESULT_OUT" ] && [ "$(jq -r '.version' "$RESULT_OUT")" = "1.0.0" ] \
  && [ "$(jq -r '.gitTag' "$RESULT_OUT")" = "notes-fixture-v1.0.0" ]; then
  ok "version and tag computation unchanged (1.0.0, notes-fixture-v1.0.0)"
else
  ng "version and tag computation unchanged (got: $(cat "$RESULT_OUT" 2>/dev/null || echo none))"
fi

if [ -s "$NOTES_OUT" ] && grep -q '[^[:space:]]' "$NOTES_OUT"; then
  ok "release note is non-empty"
else
  ng "release note is non-empty"
fi

for subject in "Add the notes fixture feature" "Fix the notes fixture defect"; do
  if grep -qF "$subject" "$NOTES_OUT" 2>/dev/null; then
    ok "release note carries extension commit: $subject"
  else
    ng "release note carries extension commit: $subject"
  fi
done

if grep -qF "Add an unrelated root change" "$NOTES_OUT" 2>/dev/null; then
  ng "release note excludes commits outside the extension"
else
  ok "release note excludes commits outside the extension"
fi

if [ ! -f "$EXT_DIR/.releaserc.json" ]; then
  ok "generated .releaserc.json is cleaned up"
else
  ng "generated .releaserc.json is cleaned up"
fi

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "--- release log ---"
  cat "$LOG"
  echo "--- rendered note ---"
  cat "$NOTES_OUT" 2>/dev/null || true
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
