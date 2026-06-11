#!/bin/bash
# test-sync-from-upstream.sh — Regression tests for sync-from-upstream.sh.
#
# Cases:
#   1. Clean-core sync: no local modifications → exit 0, files reflect upstream
#   2. Dirty-core refusal: core path modified → exit non-zero, stderr names it
#   3. Empty canonical_repo: canonical_repo = "" → exit non-zero, no git fetch
#   4. Absent canonical_repo: key missing entirely → exit non-zero, no git fetch
#
# Spec-0020 policy cases:
#   a. Excluded org subtree untouched while sibling core path updates, AND a
#      customised specs/org/* file does NOT abort the sync (Finding 1).
#   b. Unmodified adopt-on-edit file updated from upstream.
#   c. Modified (non-upstream-historical) adopt-on-edit file frozen, exit 0.
#   d. Strict path still aborts on local edit (regression).
#   e. Marker directory present → sync does NOT abort on the strict .crewrig
#      parent (Finding 1, v3 marker carve-out).
#   f. Empty marker + current blob matches an OLDER upstream version → updates
#      (stale-but-unmodified vendored fork, Finding 2 R6 horn).
#   g. Empty marker + current blob matches NO upstream version → freezes,
#      exit 0, and the freeze marker records the ADOPTER's own blob
#      (pre-feature customisation, Finding 2 R7 horn — no data loss).
#
# Usage:
#   bash scripts/tests/test-sync-from-upstream.sh

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on expected non-zero exits from the script under test.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$SCRIPT_DIR/sync-from-upstream.sh"

if [ ! -f "$SCRIPT_UNDER_TEST" ]; then
  echo "FATAL: cannot find $SCRIPT_UNDER_TEST" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# init_git_repo <dir>
# Initialise a bare-minimum git repo with identity set.
init_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
}

# make_initial_commit <repo> [<file> <content>]...
# Create an initial commit with one or more files.
make_initial_commit() {
  local repo="$1"; shift
  while [ "$#" -ge 2 ]; do
    local file="$1" content="$2"; shift 2
    mkdir -p "$repo/$(dirname "$file")"
    printf '%s' "$content" > "$repo/$file"
    git -C "$repo" add "$file"
  done
  git -C "$repo" commit -q -m "initial"
}

# commit_files <repo> <message> [<file> <content>]...
# Add/overwrite one or more files and commit them.
commit_files() {
  local repo="$1" message="$2"; shift 2
  while [ "$#" -ge 2 ]; do
    local file="$1" content="$2"; shift 2
    mkdir -p "$repo/$(dirname "$file")"
    printf '%s' "$content" > "$repo/$file"
    git -C "$repo" add "$file"
  done
  git -C "$repo" commit -q -m "$message"
}

# run_case <name> <repo> <expected_exit>
run_case() {
  local name="$1" repo="$2" expected_exit="$3"
  local actual_exit=0
  ( cd "$repo" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 ) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    fail=$((fail + 1))
  fi
}

# run_case_stderr <name> <repo> <expected_exit> <stderr_pattern>
# Like run_case but also checks that stderr matches a grep pattern.
run_case_stderr() {
  local name="$1" repo="$2" expected_exit="$3" pattern="$4"
  local actual_exit=0
  local stderr_out
  stderr_out="$(cd "$repo" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || actual_exit=$?

  local ok=1
  if [ "$actual_exit" -ne "$expected_exit" ]; then
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    ok=0
  fi
  if ! echo "$stderr_out" | grep -q "$pattern"; then
    echo "FAIL  $name (stderr did not contain: $pattern)"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 1 — Clean-core sync: all paths clean → exit 0
# ---------------------------------------------------------------------------
{
  # Build an "upstream" repo that acts as the canonical remote.
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  # Build the adopting repo that will call sync-from-upstream.sh.
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"

  # Write a minimal crewrig.config.toml pointing at upstream.
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"

  # Write a manifest listing just core-file.txt.
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"

  # Give the adopter an initial commit that matches upstream exactly.
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  run_case "clean-core sync exits 0" "$adopter" 0

  # After sync, the working-tree file should still hold upstream content
  # (in the clean case nothing changes, but restore must succeed).
  synced_content="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$synced_content" = "upstream content" ]; then
    echo "PASS  clean-core sync: file content correct"
    pass=$((pass + 1))
  else
    echo "FAIL  clean-core sync: expected 'upstream content', got '$synced_content'"
    fail=$((fail + 1))
  fi

  # Index must not be modified (no staged changes).
  staged="$(git -C "$adopter" diff --cached --name-only)"
  if [ -z "$staged" ]; then
    echo "PASS  clean-core sync: index unchanged"
    pass=$((pass + 1))
  else
    echo "FAIL  clean-core sync: unexpected staged changes: $staged"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 2 — Dirty-core refusal: local modification → exit non-zero + stderr
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream content"

  # Introduce a local modification on the core path.
  printf 'local override content\n' > "$adopter/core-file.txt"

  run_case_stderr \
    "dirty-core refusal exits non-zero" \
    "$adopter" \
    1 \
    "core-file.txt"

  # Working tree must still contain the local modification (unchanged by script).
  content_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$content_after" = "local override content" ]; then
    echo "PASS  dirty-core refusal: working tree unchanged"
    pass=$((pass + 1))
  else
    echo "FAIL  dirty-core refusal: working tree was unexpectedly modified"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case 3 — Empty canonical_repo → exit non-zero, no git fetch attempted
# ---------------------------------------------------------------------------
{
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  # canonical_repo present but empty string.
  printf 'canonical_repo = ""\n' > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "core-file.txt" "content"

  run_case_stderr \
    "empty canonical_repo exits non-zero" \
    "$adopter" \
    1 \
    "canonical_repo"
}

# ---------------------------------------------------------------------------
# Case 4 — Absent canonical_repo key → exit non-zero, no git fetch attempted
# ---------------------------------------------------------------------------
{
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  # No canonical_repo key at all.
  printf '# empty config\n' > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "core-file.txt" "content"

  run_case_stderr \
    "absent canonical_repo exits non-zero" \
    "$adopter" \
    1 \
    "canonical_repo"
}

# ---------------------------------------------------------------------------
# Case a — A customised specs/org/* file does NOT abort the strict `specs`
#          guard, and the sibling core spec is restored from upstream while the
#          org file is left untouched (Finding 1: exclude on BOTH guard and
#          restore). The adopter is byte-identical to upstream on the core spec
#          (the strict guard treats any deviation there as dirty — that is the
#          spec-0016 contract, exercised by case d), so this case isolates the
#          org-subtree carve-out.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "specs/0001.md" "upstream spec content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'specs\tstrict\nspecs/org\texcluded\n' > "$adopter/.crewrig/core-paths.txt"
  # Adopter is clean on the core spec (== upstream) and owns an org spec
  # upstream does not have.
  make_initial_commit "$adopter" \
    "specs/0001.md"        "upstream spec content" \
    "specs/org/orgspec.md" "ORG ONLY content"
  # Customise the org spec. Without the exclude on the guard this aborts the
  # whole sync (the v1 bug); with it, the sync proceeds.
  printf 'ORG customised content\n' > "$adopter/specs/org/orgspec.md"

  run_case "case-a customised org subtree does not abort strict guard" "$adopter" 0

  core_after="$(cat "$adopter/specs/0001.md" 2>/dev/null)"
  if [ "$core_after" = "upstream spec content" ]; then
    echo "PASS  case-a: sibling core spec reflects upstream"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: expected 'upstream spec content', got '$core_after'"
    fail=$((fail + 1))
  fi

  org_after="$(cat "$adopter/specs/org/orgspec.md" 2>/dev/null)"
  if [ "$org_after" = "ORG customised content" ]; then
    echo "PASS  case-a: org spec left untouched"
    pass=$((pass + 1))
  else
    echo "FAIL  case-a: org spec was modified: '$org_after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case b — Unmodified adopt-on-edit file updated from upstream.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "README.md" "upstream readme v1"
  commit_files "$upstream" "advance readme" "README.md" "upstream readme v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'README.md\tadopt-on-edit\n' > "$adopter/.crewrig/core-paths.txt"
  # Adopter holds the latest upstream README (v2), unmodified.
  make_initial_commit "$adopter" "README.md" "upstream readme v2"

  run_case "case-b unmodified adopt-on-edit updates" "$adopter" 0

  readme_after="$(cat "$adopter/README.md" 2>/dev/null)"
  if [ "$readme_after" = "upstream readme v2" ]; then
    echo "PASS  case-b: adopt-on-edit README reflects upstream v2"
    pass=$((pass + 1))
  else
    echo "FAIL  case-b: expected 'upstream readme v2', got '$readme_after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case c — Modified (non-upstream-historical) adopt-on-edit file frozen,
#          exit 0 (no abort, no overwrite).
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "README.md" "upstream readme v1"
  commit_files "$upstream" "advance readme" "README.md" "upstream readme v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'README.md\tadopt-on-edit\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "README.md" "upstream readme v1"
  # Customise the README to something upstream never shipped.
  printf 'ADOPTER customised readme\n' > "$adopter/README.md"

  run_case "case-c modified adopt-on-edit frozen exit 0" "$adopter" 0

  readme_after="$(cat "$adopter/README.md" 2>/dev/null)"
  if [ "$readme_after" = "ADOPTER customised readme" ]; then
    echo "PASS  case-c: customised README preserved (frozen)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-c: README was overwritten: '$readme_after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case d — Strict path still aborts on local edit (regression).
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "AGENTS.md" "upstream agents"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'AGENTS.md\tstrict\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" "AGENTS.md" "upstream agents"
  printf 'local override\n' > "$adopter/AGENTS.md"

  run_case_stderr "case-d strict aborts on local edit" "$adopter" 1 "AGENTS.md"
}

# ---------------------------------------------------------------------------
# Case e — Marker directory present → sync does NOT abort on the strict
#          .crewrig parent (nested-exclude carve-out of .synced-markers).
# ---------------------------------------------------------------------------
{
  # Manifest content shared verbatim by upstream and adopter so the strict
  # .crewrig guard sees no difference EXCEPT the marker subtree (which the
  # exclude must carve out).
  manifest=$'.crewrig\tstrict\n.crewrig/.synced-markers\texcluded\n'

  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  # Upstream ships .crewrig/core-paths.txt but NO .synced-markers/.
  mkdir -p "$upstream/.crewrig"
  printf '%s' "$manifest" > "$upstream/.crewrig/core-paths.txt"
  git -C "$upstream" add .crewrig
  git -C "$upstream" commit -q -m "initial"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf '%s' "$manifest" > "$adopter/.crewrig/core-paths.txt"
  # Adopter has committed marker state that upstream lacks.
  printf 'deadbeef\n' > "$adopter/.crewrig/.synced-markers/README.md.sha"
  git -C "$adopter" add .crewrig
  git -C "$adopter" commit -q -m "initial with markers"

  run_case "case-e marker dir present does not abort .crewrig" "$adopter" 0

  if [ -f "$adopter/.crewrig/.synced-markers/README.md.sha" ]; then
    echo "PASS  case-e: marker file survives sync"
    pass=$((pass + 1))
  else
    echo "FAIL  case-e: marker file was deleted by sync"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case f — Empty marker + current blob matches an OLDER upstream version →
#          updates (stale-but-unmodified vendored fork).
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "README.md" "upstream readme v1"
  commit_files "$upstream" "advance readme" "README.md" "upstream readme v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'README.md\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Adopter vendored the OLD upstream v1 (matches upstream history) — no marker.
  make_initial_commit "$adopter" "README.md" "upstream readme v1"

  run_case "case-f stale-but-unmodified updates (no marker)" "$adopter" 0

  readme_after="$(cat "$adopter/README.md" 2>/dev/null)"
  if [ "$readme_after" = "upstream readme v2" ]; then
    echo "PASS  case-f: stale vendored README updated to upstream v2"
    pass=$((pass + 1))
  else
    echo "FAIL  case-f: expected 'upstream readme v2', got '$readme_after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case g — Empty marker + current blob matches NO upstream version → freezes,
#          exit 0, and the freeze marker records the ADOPTER's own blob.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "README.md" "upstream readme v1"
  commit_files "$upstream" "advance readme" "README.md" "upstream readme v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'README.md\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Adopter customised the README BEFORE the feature shipped — no marker, and
  # the content matches no upstream-historical version.
  make_initial_commit "$adopter" "README.md" "ORG custom readme never upstream"

  run_case "case-g pre-feature custom freezes (no marker)" "$adopter" 0

  readme_after="$(cat "$adopter/README.md" 2>/dev/null)"
  if [ "$readme_after" = "ORG custom readme never upstream" ]; then
    echo "PASS  case-g: pre-feature customisation preserved (no data loss)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: customisation was overwritten: '$readme_after'"
    fail=$((fail + 1))
  fi

  # Reviewer note (b): the freeze marker must record the ADOPTER's OWN blob,
  # not an upstream one — otherwise a later marker fast-path comparison
  # misfires.
  expected_sha="$(git -C "$adopter" hash-object "$adopter/README.md")"
  marker_file="$adopter/.crewrig/.synced-markers/README.md.sha"
  marker_sha="$(cat "$marker_file" 2>/dev/null)"
  if [ "$marker_sha" = "$expected_sha" ]; then
    echo "PASS  case-g: freeze marker records adopter's own blob SHA"
    pass=$((pass + 1))
  else
    echo "FAIL  case-g: freeze marker SHA mismatch (expected $expected_sha, got '$marker_sha')"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
