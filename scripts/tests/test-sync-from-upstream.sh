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
#      customized specs/org/* file does NOT abort the sync (Finding 1).
#   b. Unmodified adopt-on-edit file updated from upstream.
#   c. Modified (non-upstream-historical) adopt-on-edit file frozen, exit 0.
#   d. Strict path still aborts on local edit (regression).
#   e. Marker directory present → sync does NOT abort on the strict .crewrig
#      parent (Finding 1, v3 marker carve-out).
#   f. Empty marker + current blob matches an OLDER upstream version → updates
#      (stale-but-unmodified vendored fork, Finding 2 R6 horn).
#   g. Empty marker + current blob matches NO upstream version → freezes,
#      exit 0, and the freeze marker records the ADOPTER's own blob
#      (pre-feature customization, Finding 2 R7 horn — no data loss).
#
# Spec-0021 directory adopt-on-edit cases (reconcile_dir):
#   h. R3 ADD — upstream ships a file with no org history; AFTER fetching the
#      upstream as a remote (so refs/remotes carry the blob), the new file is
#      ADDed. The fetch-before-assert guards against the `git rev-list --all`
#      leak that the cold review caught (--all would see the blob via
#      refs/remotes and wrongly SKIP).
#   i. R2 SKIP — org committed then deleted a file still shipped upstream; sync
#      does NOT re-create it.
#   j. Org-customized file inside the dir → frozen, not overwritten.
#   k. Untouched dir file matching an upstream history blob → updated.
#   l. Org-deleted file that upstream later re-touches → stays gone across a
#      second sync.
#   m. Shallow-clone guard — a shallow adopter clone refuses to reconcile the
#      adopt-on-edit directory (warns, exit 0, no add) rather than trust an
#      untrustworthy history.
#
# Spec-0031 phantom-entry tolerance cases:
#   n. Phantom tolerance — the manifest declares a strict entry absent from the
#      fetched upstream AND a resolvable adopt-on-edit sibling. The sync warns
#      once for the phantom (apply-loop warn-and-skip; the strict dirty guard
#      skips it silently), restores the resolvable sibling from upstream, and
#      exits 0. The warn line appears EXACTLY once. This case bites if the
#      apply-loop `resolves_at_fetch_head` guard is reverted: `set -e` + a
#      `git restore` on a non-existent FETCH_HEAD path would exit non-zero.
#   o. Clean-sync negative assertion — a fully resolvable manifest emits NO
#      "Warning: skipping manifest entry" line on stderr (spec 0031 "fully
#      resolvable manifest syncs cleanly" scenario; architect advisory #1).
#
# Spec-0064 strict-directory orphan cleanup cases:
#   r. Orphan deletion — a strict directory contains a locally tracked file
#      absent from FETCH_HEAD; the file is deleted, stdout contains
#      "Removed (upstream-deleted): <path>", and exit 0.
#   s. Excluded child preserved — a file under an excluded child of a strict
#      directory is absent from FETCH_HEAD but NOT deleted.
#
# Spec-0086 --preserve-history regression cases (R13):
#   t. Happy path (R5-R6) — after a successful --preserve-history sync, the
#      fetched upstream commit (FETCH_HEAD) is a real ancestor of the current
#      branch tip (git merge-base --is-ancestor), and every restored file is
#      byte-for-byte identical to what an ordinary sync (no flag) would have
#      produced.
#   u. No-op (R11) — when FETCH_HEAD is already an ancestor of the current
#      branch tip at invocation time, no new commit is created and the sync
#      exits 0.
#   v. Shallow-clone refusal (R12) — on a shallow clone, the sync exits
#      non-zero BEFORE any fetch, restore, or commit.
#   w. Unrelated-change refusal (R8) — an uncommitted change outside the
#      paths governed by .crewrig/core-paths.txt and .crewrig/.synced-markers/
#      blocks the graft commit after the policy-aware restore has already
#      applied; the offending path is printed, no commit is created, and the
#      sync exits non-zero.
#   x. Nested-excluded-child refusal (R8, PLAN v2 arch-finding fix) — an
#      uncommitted change under an `excluded` entry nested under a
#      `strict`/`adopt-on-edit` parent (e.g. specs/org under specs) blocks the
#      graft commit exactly like case w, even though the path falls inside the
#      governing parent's own prefix; the strict parent's own restore still
#      applies before the guard fires.
#   y. Direct-excluded-entry refusal (R8, PLAN v2 arch-finding fix) — an
#      uncommitted change under a top-level `excluded` manifest entry with no
#      governing parent overlap (e.g. AGENTS.org.md) blocks the graft commit
#      via the same path_is_governed() carve-out, independently of the nested
#      form covered by case x.
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
# Initialize a bare-minimum git repo with identity set.
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
# Case a — A customized specs/org/* file does NOT abort the strict `specs`
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
  # Customize the org spec. Without the exclude on the guard this aborts the
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
  # Customize the README to something upstream never shipped.
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
  # Adopter customized the README BEFORE the feature shipped — no marker, and
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
# Case h — R3 ADD: upstream ships config/expertise/DATA-ENGINEER.md with no org
#          history. The upstream is wired as a NAMED REMOTE and fetched, so
#          refs/remotes/<name>/main and FETCH_HEAD carry the new blob — this is
#          the exact condition under which `git rev-list --all` leaks. The
#          HEAD-scoped path_in_org_history must still see "never existed" → ADD.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend" \
    "config/expertise/DATA-ENGINEER.md" "upstream data engineer"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Adopter has BACKEND-JAVA.md but has NEVER had DATA-ENGINEER.md.
  make_initial_commit "$adopter" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend"
  # Wire the upstream as a named remote and fetch so refs/remotes is populated —
  # this is what makes a `--all`-based primitive wrongly SKIP the new file.
  git -C "$adopter" remote add canonical "$upstream"
  git -C "$adopter" fetch -q canonical

  run_case "case-h R3 ADD new upstream file (remote fetched)" "$adopter" 0

  added="$(cat "$adopter/config/expertise/DATA-ENGINEER.md" 2>/dev/null)"
  if [ "$added" = "upstream data engineer" ]; then
    echo "PASS  case-h: genuinely-new upstream file ADDed despite fetched remote ref"
    pass=$((pass + 1))
  else
    echo "FAIL  case-h: new file not added (got '$added') — possible --all leak regression"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case i — R2 SKIP: org committed then deleted config/expertise/QA-AUTOMATION.md
#          (still shipped upstream). Sync must NOT re-create it.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/QA-AUTOMATION.md" "upstream qa"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Org committed the file, then deleted it in a later commit (history records
  # the deletion → org owns the path's absence).
  make_initial_commit "$adopter" \
    "config/expertise/QA-AUTOMATION.md" "upstream qa"
  git -C "$adopter" rm -q "config/expertise/QA-AUTOMATION.md"
  git -C "$adopter" commit -q -m "drop QA role"

  run_case "case-i R2 SKIP org-deleted stays gone" "$adopter" 0

  if [ ! -e "$adopter/config/expertise/QA-AUTOMATION.md" ]; then
    echo "PASS  case-i: org-deleted file not re-created"
    pass=$((pass + 1))
  else
    echo "FAIL  case-i: org-deleted file was wrongly re-added"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case j — Org-customized file inside the dir → frozen, not overwritten.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend v1"
  commit_files "$upstream" "advance backend" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend v1"
  # Customize to something upstream never shipped.
  printf 'ORG customised backend\n' > "$adopter/config/expertise/BACKEND-JAVA.md"

  run_case "case-j customised dir member frozen" "$adopter" 0

  after="$(cat "$adopter/config/expertise/BACKEND-JAVA.md" 2>/dev/null)"
  if [ "$after" = "ORG customised backend" ]; then
    echo "PASS  case-j: customised dir member preserved (frozen)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-j: dir member was overwritten: '$after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case k — Untouched dir file matching an upstream history blob → updated.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/FRONTEND-REACT.md" "upstream frontend v1"
  commit_files "$upstream" "advance frontend" \
    "config/expertise/FRONTEND-REACT.md" "upstream frontend v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Adopter vendored the OLD upstream v1 (matches upstream history) — no marker.
  make_initial_commit "$adopter" \
    "config/expertise/FRONTEND-REACT.md" "upstream frontend v1"

  run_case "case-k untouched dir member updates" "$adopter" 0

  after="$(cat "$adopter/config/expertise/FRONTEND-REACT.md" 2>/dev/null)"
  if [ "$after" = "upstream frontend v2" ]; then
    echo "PASS  case-k: untouched dir member updated to upstream v2"
    pass=$((pass + 1))
  else
    echo "FAIL  case-k: expected 'upstream frontend v2', got '$after'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case l — Org-deleted file that upstream LATER re-touches → stays gone across a
#          second sync (R2 durability). Wires the upstream as a remote so both
#          syncs run against a populated refs/remotes.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/QA-AUTOMATION.md" "upstream qa v1"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "config/expertise/QA-AUTOMATION.md" "upstream qa v1"
  git -C "$adopter" rm -q "config/expertise/QA-AUTOMATION.md"
  git -C "$adopter" commit -q -m "drop QA role"

  # First sync: must not re-create.
  ( cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 )

  # Upstream re-touches the file.
  commit_files "$upstream" "revive qa upstream" \
    "config/expertise/QA-AUTOMATION.md" "upstream qa v2"

  run_case "case-l org-deleted stays gone after upstream re-touch" "$adopter" 0

  if [ ! -e "$adopter/config/expertise/QA-AUTOMATION.md" ]; then
    echo "PASS  case-l: org-deleted file stays gone across second sync"
    pass=$((pass + 1))
  else
    echo "FAIL  case-l: org-deleted file re-appeared after upstream re-touch"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case m — Shallow-clone guard: a shallow adopter clone refuses to reconcile the
#          adopt-on-edit directory rather than trust an untrustworthy history.
#          The genuinely-new upstream file is NOT added (fail safe), the sync
#          warns, and exits 0.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "config/expertise/BACKEND-JAVA.md"  "upstream backend" \
    "config/expertise/DATA-ENGINEER.md" "upstream data engineer"

  # Build a NORMAL adopter first, then shallow-clone it so the clone reports
  # is-shallow-repository = true.
  seed="$(mktemp -d "$TMP_ROOT/seed.XXXXXX")"
  init_git_repo "$seed"
  make_initial_commit "$seed" \
    "config/expertise/BACKEND-JAVA.md" "upstream backend" \
    "filler.txt" "v1"
  commit_files "$seed" "more history" "filler.txt" "v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  rm -rf "$adopter"
  git clone -q --depth 1 "file://$seed" "$adopter"
  git -C "$adopter" config user.email "test@example.com"
  git -C "$adopter" config user.name "Test"
  git -C "$adopter" config commit.gpgsign false
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig/.synced-markers"
  printf 'config/expertise\tadopt-on-edit\n.crewrig/.synced-markers\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  git -C "$adopter" add crewrig.config.toml .crewrig/core-paths.txt
  git -C "$adopter" commit -q -m "adopter config"

  run_case_stderr "case-m shallow clone refuses to reconcile dir" \
    "$adopter" 0 "shallow"

  if [ ! -e "$adopter/config/expertise/DATA-ENGINEER.md" ]; then
    echo "PASS  case-m: shallow guard fails safe (new file not added)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-m: shallow guard did not prevent the add"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case n — Spec-0031 phantom tolerance: a strict manifest entry absent from the
#          fetched upstream is skipped-with-warning (exactly once) while a
#          resolvable adopt-on-edit sibling is still restored, and the sync
#          exits 0. Confirms the warn-and-skip fires only in the apply loop
#          (the strict dirty guard skips the phantom silently — no duplicate
#          warning) and that a phantom never aborts the whole sync.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "core-file.txt" "upstream content v1"
  commit_files "$upstream" "advance core-file" "core-file.txt" "upstream content v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  # phantom.txt is declared but exists nowhere upstream; core-file.txt resolves.
  printf 'phantom.txt\tstrict\ncore-file.txt\tadopt-on-edit\n' \
    > "$adopter/.crewrig/core-paths.txt"
  # Adopter vendored the OLD upstream v1 (matches upstream history) so the
  # adopt-on-edit sibling is eligible to update to v2 — proving the apply loop
  # continued past the phantom and actually restored the sibling.
  make_initial_commit "$adopter" "core-file.txt" "upstream content v1"

  phantom_exit=0
  phantom_stderr="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || phantom_exit=$?

  if [ "$phantom_exit" -eq 0 ]; then
    echo "PASS  case-n: phantom entry does not abort sync (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-n: expected exit 0, got $phantom_exit"
    echo "      actual stderr: $phantom_stderr"
    fail=$((fail + 1))
  fi

  warn_line="Warning: skipping manifest entry absent from upstream: phantom.txt"
  if echo "$phantom_stderr" | grep -qF "$warn_line"; then
    echo "PASS  case-n: warn-and-skip line emitted for the phantom entry"
    pass=$((pass + 1))
  else
    echo "FAIL  case-n: missing warn-and-skip line for phantom.txt"
    echo "      actual stderr: $phantom_stderr"
    fail=$((fail + 1))
  fi

  warn_count="$(echo "$phantom_stderr" | grep -cF "$warn_line")"
  if [ "$warn_count" -eq 1 ]; then
    echo "PASS  case-n: warn-and-skip line emitted exactly once (apply loop only)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-n: expected exactly 1 warn line, got $warn_count"
    echo "      actual stderr: $phantom_stderr"
    fail=$((fail + 1))
  fi

  sibling_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$sibling_after" = "upstream content v2" ]; then
    echo "PASS  case-n: resolvable sibling restored from upstream (v2)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-n: sibling not restored (expected 'upstream content v2', got '$sibling_after')"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case o — Spec-0031 negative assertion: a fully resolvable manifest syncs
#          cleanly and emits NO "Warning: skipping manifest entry" line. Guards
#          against a regression where the warn-and-skip path fires spuriously on
#          a manifest with no phantom entries (architect advisory #1).
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\tstrict\nother.txt\tstrict\n' \
    > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream content" \
    "other.txt"     "other content"

  clean_exit=0
  clean_stderr="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || clean_exit=$?

  if [ "$clean_exit" -eq 0 ]; then
    echo "PASS  case-o: fully resolvable manifest syncs cleanly (exit 0)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-o: expected exit 0, got $clean_exit"
    echo "      actual stderr: $clean_stderr"
    fail=$((fail + 1))
  fi

  if echo "$clean_stderr" | grep -qF "Warning: skipping manifest entry"; then
    echo "FAIL  case-o: unexpected skip warning on a fully resolvable manifest"
    echo "      actual stderr: $clean_stderr"
    fail=$((fail + 1))
  else
    echo "PASS  case-o: no skip warning emitted on a fully resolvable manifest"
    pass=$((pass + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case p — Bug 1 regression: strict blob at an older upstream version exits 0.
# The fork is at upstream commit-1 content; upstream advances to commit-2.
# No local modifications → guard must NOT abort.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content"
  commit_files "$upstream" "advance" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "core-file.txt" "upstream v1 content"

  run_case "case-p strict blob behind upstream exits 0 (Bug 1 regression)" "$adopter" 0

  synced="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$synced" = "upstream v2 content" ]; then
    echo "PASS  case-p: strict blob behind upstream updated to v2"
    pass=$((pass + 1))
  else
    echo "FAIL  case-p: expected 'upstream v2 content', got '$synced'"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case q — Bug 2 regression: strict directory entry; upstream adds a new file
# absent from the local index → sync must exit 0 and create the file.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "specs/0001.md" "spec one content"
  commit_files "$upstream" "add new spec" \
    "specs/0099-new.md" "new upstream spec"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'specs\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "specs/0001.md" "spec one content"

  run_case "case-q strict dir new upstream file created (Bug 2 regression)" "$adopter" 0

  if [ -f "$adopter/specs/0099-new.md" ]; then
    echo "PASS  case-q: strict dir new upstream file instantiated"
    pass=$((pass + 1))
  else
    echo "FAIL  case-q: strict dir new upstream file not found after sync"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case r — spec 0064 R2–R3: strict directory contains an orphaned file absent
# from FETCH_HEAD → file deleted, stdout message emitted, exit 0.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "scripts/old-file.sh" "old content" \
    "scripts/active-file.sh" "active content"
  git -C "$upstream" rm -q "scripts/old-file.sh"
  git -C "$upstream" commit -q -m "remove old-file.sh"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'scripts\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "scripts/old-file.sh" "old content" \
    "scripts/active-file.sh" "active content"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" 2>/dev/null)" || actual_exit=$?

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-r: expected exit 0, got $actual_exit"
    ok=0
  fi
  if [ -f "$adopter/scripts/old-file.sh" ]; then
    echo "FAIL  case-r: orphan scripts/old-file.sh still present after sync"
    ok=0
  fi
  if ! echo "$stdout_out" | grep -qF "Removed (upstream-deleted): scripts/old-file.sh"; then
    echo "FAIL  case-r: stdout missing 'Removed (upstream-deleted): scripts/old-file.sh'"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi
  if [ ! -f "$adopter/scripts/active-file.sh" ]; then
    echo "FAIL  case-r: active-file.sh incorrectly removed"
    ok=0
  fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-r: strict dir orphan deleted, message emitted, active file preserved"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case s — spec 0064 R4: excluded child of strict directory absent from
# FETCH_HEAD is NOT deleted by the orphan-cleanup pass.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "specs/0001.md" "spec content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'specs\nspecs/org\texcluded\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "specs/0001.md" "spec content" \
    "specs/org/custom.md" "org content"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" 2>/dev/null)" || actual_exit=$?

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-s: expected exit 0, got $actual_exit"
    ok=0
  fi
  if [ ! -f "$adopter/specs/org/custom.md" ]; then
    echo "FAIL  case-s: excluded child specs/org/custom.md was incorrectly deleted"
    ok=0
  fi
  if echo "$stdout_out" | grep -qF "Removed (upstream-deleted): specs/org"; then
    echo "FAIL  case-s: stdout contained unexpected 'Removed' line for excluded path"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi
  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-s: excluded child not deleted by orphan cleanup"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case t — spec 0086 R5-R6: --preserve-history happy path. After a successful
# --preserve-history sync, the fetched upstream commit (FETCH_HEAD) is a real
# ancestor of the current branch tip, and every restored file is byte-for-byte
# identical to what an ordinary sync (no flag) would have produced. Two
# independent, identically-configured adopters are synced — one with
# --preserve-history, one without — so their resulting working trees can be
# compared directly.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"
  upstream_sha="$(git -C "$upstream" rev-parse HEAD)"

  # crewrig.config.toml and .crewrig/core-paths.txt are committed (not left
  # untracked) so the R8 anti-pollution guard sees a fully clean working tree
  # going in — untracked config/manifest files would otherwise themselves be
  # reported as ungoverned changes.
  adopter_hist="$(mktemp -d "$TMP_ROOT/adopter-hist.XXXXXX")"
  init_git_repo "$adopter_hist"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter_hist/crewrig.config.toml"
  mkdir -p "$adopter_hist/.crewrig"
  printf 'core-file.txt\n' > "$adopter_hist/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter_hist/core-file.txt"
  printf '%s' "other content" > "$adopter_hist/other.txt"
  git -C "$adopter_hist" add -A
  git -C "$adopter_hist" commit -q -m initial

  adopter_plain="$(mktemp -d "$TMP_ROOT/adopter-plain.XXXXXX")"
  init_git_repo "$adopter_plain"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter_plain/crewrig.config.toml"
  mkdir -p "$adopter_plain/.crewrig"
  printf 'core-file.txt\n' > "$adopter_plain/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter_plain/core-file.txt"
  printf '%s' "other content" > "$adopter_plain/other.txt"
  git -C "$adopter_plain" add -A
  git -C "$adopter_plain" commit -q -m initial

  actual_exit=0
  ( cd "$adopter_hist" && CREWRIG_REPO_DIR="$adopter_hist" bash "$SCRIPT_UNDER_TEST" --preserve-history >/dev/null 2>&1 ) || actual_exit=$?
  ( cd "$adopter_plain" && CREWRIG_REPO_DIR="$adopter_plain" bash "$SCRIPT_UNDER_TEST" >/dev/null 2>&1 )

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-t: expected exit 0, got $actual_exit"
    ok=0
  fi
  if ! git -C "$adopter_hist" merge-base --is-ancestor "$upstream_sha" HEAD 2>/dev/null; then
    echo "FAIL  case-t: fetched upstream commit $upstream_sha is not an ancestor of the current branch tip"
    ok=0
  fi

  core_hist="$(cat "$adopter_hist/core-file.txt" 2>/dev/null)"
  core_plain="$(cat "$adopter_plain/core-file.txt" 2>/dev/null)"
  other_hist="$(cat "$adopter_hist/other.txt" 2>/dev/null)"
  other_plain="$(cat "$adopter_plain/other.txt" 2>/dev/null)"

  if [ "$core_hist" != "upstream v2 content" ] || [ "$core_hist" != "$core_plain" ]; then
    echo "FAIL  case-t: core-file.txt diverged from an ordinary sync (hist='$core_hist', plain='$core_plain')"
    ok=0
  fi
  if [ "$other_hist" != "$other_plain" ]; then
    echo "FAIL  case-t: other.txt diverged from an ordinary sync (hist='$other_hist', plain='$other_plain')"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-t: preserve-history happy path grafts ancestry with identical restore content"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case u — spec 0086 R11: no-op when FETCH_HEAD is already an ancestor of the
# current branch tip at invocation time. The adopter is a full clone of
# upstream (so upstream's tip is already reachable from the adopter's own
# history) plus one extra local commit; --preserve-history must create no new
# commit and exit 0.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "core-file.txt" "upstream content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  rm -rf "$adopter"
  git clone -q "file://$upstream" "$adopter"
  git -C "$adopter" config user.email "test@example.com"
  git -C "$adopter" config user.name "Test"
  git -C "$adopter" config commit.gpgsign false
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  git -C "$adopter" add crewrig.config.toml .crewrig/core-paths.txt
  git -C "$adopter" commit -q -m "adopter config"

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-u: expected exit 0, got $actual_exit"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-u: HEAD moved (a commit was created) though FETCH_HEAD was already an ancestor"
    ok=0
  fi
  if ! echo "$stdout_out" | grep -qF "no-op"; then
    echo "FAIL  case-u: stdout missing the no-op acknowledgement"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-u: no-op when FETCH_HEAD already an ancestor, no commit created, exit 0"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case v — spec 0086 R12: --preserve-history refuses to run on a shallow
# clone, exiting non-zero BEFORE any fetch, restore, or commit.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "core-file.txt" "upstream content"

  seed="$(mktemp -d "$TMP_ROOT/seed.XXXXXX")"
  init_git_repo "$seed"
  make_initial_commit "$seed" "core-file.txt" "seed content v1"
  commit_files "$seed" "advance" "core-file.txt" "seed content v2"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  rm -rf "$adopter"
  git clone -q --depth 1 "file://$seed" "$adopter"
  git -C "$adopter" config user.email "test@example.com"
  git -C "$adopter" config user.name "Test"
  git -C "$adopter" config commit.gpgsign false
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  git -C "$adopter" add crewrig.config.toml .crewrig/core-paths.txt
  git -C "$adopter" commit -q -m "adopter config"

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  output="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-v: expected non-zero exit on a shallow clone, got 0"
    ok=0
  fi
  if ! echo "$output" | grep -qi "shallow"; then
    echo "FAIL  case-v: output does not mention the shallow-clone refusal"
    echo "      actual output: $output"
    ok=0
  fi
  if echo "$output" | grep -qF "Fetching"; then
    echo "FAIL  case-v: a fetch was attempted despite the shallow-clone refusal"
    echo "      actual output: $output"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-v: a commit was created despite the shallow-clone refusal"
    ok=0
  fi
  content_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$content_after" != "seed content v2" ]; then
    echo "FAIL  case-v: the working tree was modified despite the shallow-clone refusal"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-v: shallow clone refuses --preserve-history before any fetch/restore/commit"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case w — spec 0086 R8: an uncommitted change outside the paths governed by
# .crewrig/core-paths.txt and .crewrig/.synced-markers/ blocks the graft
# commit. The policy-aware restore has already applied by the time the guard
# fires, the offending path is printed, no commit is created, and the sync
# exits non-zero.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "core-file.txt" "upstream v1 content"
  commit_files "$upstream" "advance" "core-file.txt" "upstream v2 content"

  # crewrig.config.toml and .crewrig/core-paths.txt are committed (not left
  # untracked) so the only uncommitted change going into the R8 check is the
  # deliberate unrelated.txt edit below — an untracked config/manifest file
  # would otherwise ALSO be reported as ungoverned, muddying the assertion.
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "original unrelated content" > "$adopter/unrelated.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  # Uncommitted change OUTSIDE the governed paths: unrelated.txt is not listed
  # in .crewrig/core-paths.txt, nor under .crewrig/.synced-markers/.
  printf 'locally edited unrelated content' > "$adopter/unrelated.txt"

  actual_exit=0
  output="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-w: expected non-zero exit on an unrelated uncommitted change, got 0"
    ok=0
  fi
  if ! echo "$output" | grep -qF "unrelated.txt"; then
    echo "FAIL  case-w: offending path unrelated.txt was not printed"
    echo "      actual output: $output"
    ok=0
  fi
  core_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$core_after" != "upstream v2 content" ]; then
    echo "FAIL  case-w: policy-aware restore did not apply before the graft was blocked (core-file.txt='$core_after')"
    ok=0
  fi
  unrelated_after="$(cat "$adopter/unrelated.txt" 2>/dev/null)"
  if [ "$unrelated_after" != "locally edited unrelated content" ]; then
    echo "FAIL  case-w: unrelated.txt working-tree edit was lost"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-w: a graft commit was created despite the R8 refusal"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-w: unrelated uncommitted change blocks the graft commit after restore applied"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case x — spec 0086 R8, PLAN v2 arch-finding fix (nested form): an
# uncommitted change under specs/org/ — an `excluded` manifest entry nested
# under the `strict` parent specs — blocks the graft commit exactly like case
# w's fully unrelated path, even though specs/org falls inside the "specs"
# prefix that path_is_governed() would otherwise treat as governed. Guards
# against the pre-fix behavior where the nested excluded child matched the
# parent's "$gov"/* wildcard and was silently swept into the graft commit.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "specs/0001.md" "spec v1 content"
  commit_files "$upstream" "advance spec" "specs/0001.md" "spec v2 content"

  # crewrig.config.toml and .crewrig/core-paths.txt are committed (not left
  # untracked) so the only uncommitted change going into the R8 check is the
  # deliberate specs/org/custom.md edit below — an untracked config/manifest
  # file would otherwise ALSO be reported as ungoverned, muddying the
  # assertion (same rationale as case w).
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'specs\nspecs/org\texcluded\n' > "$adopter/.crewrig/core-paths.txt"
  mkdir -p "$adopter/specs/org"
  printf '%s' "spec v1 content" > "$adopter/specs/0001.md"
  printf '%s' "org content v1" > "$adopter/specs/org/custom.md"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  # Uncommitted change under the excluded child specs/org/, nested beneath
  # the strict parent specs.
  printf 'locally edited org content' > "$adopter/specs/org/custom.md"

  actual_exit=0
  output="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-x: expected non-zero exit on an uncommitted change under a nested excluded child, got 0"
    ok=0
  fi
  if ! echo "$output" | grep -qF "specs/org/custom.md"; then
    echo "FAIL  case-x: offending path specs/org/custom.md was not printed"
    echo "      actual output: $output"
    ok=0
  fi
  specs_after="$(cat "$adopter/specs/0001.md" 2>/dev/null)"
  if [ "$specs_after" != "spec v2 content" ]; then
    echo "FAIL  case-x: policy-aware restore of the strict parent specs did not apply before the graft was blocked (specs/0001.md='$specs_after')"
    ok=0
  fi
  org_after="$(cat "$adopter/specs/org/custom.md" 2>/dev/null)"
  if [ "$org_after" != "locally edited org content" ]; then
    echo "FAIL  case-x: specs/org/custom.md working-tree edit was lost"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-x: a graft commit was created despite the nested excluded-child edit"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-x: nested excluded child (specs/org) blocks the graft commit, strict parent restore still applied"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case y — spec 0086 R8, PLAN v2 arch-finding fix (direct form): an
# uncommitted change under AGENTS.org.md — a top-level `excluded` manifest
# entry with NO governing parent overlap — blocks the graft commit via the
# same path_is_governed() carve-out, independently of case x's nested shape.
# Guards against the pre-fix behavior where a bare excluded entry matched
# "$gov" exactly (no policy filter in the loop at all) and was silently swept
# into the graft commit.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" "core-file.txt" "upstream v1 content"
  commit_files "$upstream" "advance" "core-file.txt" "upstream v2 content"

  # crewrig.config.toml and .crewrig/core-paths.txt are committed (not left
  # untracked) so the only uncommitted change going into the R8 check is the
  # deliberate AGENTS.org.md edit below (same rationale as case w/x).
  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\nAGENTS.org.md\texcluded\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "org rules v1" > "$adopter/AGENTS.org.md"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  # Uncommitted change under the top-level excluded entry AGENTS.org.md, with
  # no strict/adopt-on-edit parent overlap at all.
  printf 'locally edited org rules' > "$adopter/AGENTS.org.md"

  actual_exit=0
  output="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-y: expected non-zero exit on an uncommitted change under a direct top-level excluded entry, got 0"
    ok=0
  fi
  if ! echo "$output" | grep -qF "AGENTS.org.md"; then
    echo "FAIL  case-y: offending path AGENTS.org.md was not printed"
    echo "      actual output: $output"
    ok=0
  fi
  core_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$core_after" != "upstream v2 content" ]; then
    echo "FAIL  case-y: policy-aware restore of the strict core-file.txt did not apply before the graft was blocked (core-file.txt='$core_after')"
    ok=0
  fi
  org_after="$(cat "$adopter/AGENTS.org.md" 2>/dev/null)"
  if [ "$org_after" != "locally edited org rules" ]; then
    echo "FAIL  case-y: AGENTS.org.md working-tree edit was lost"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-y: a graft commit was created despite the direct excluded-entry edit"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-y: direct top-level excluded entry (AGENTS.org.md) blocks the graft commit"
    pass=$((pass + 1))
  else
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
