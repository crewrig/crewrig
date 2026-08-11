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
# Spec-0097 Copilot settings.json workspace-scope carve-out cases (issue #605):
#   z. R8 — a local content mutation confined to
#      `.github/copilot/settings.json` (an `excluded` entry nested under the
#      still-`strict` `.github/copilot` parent), representative of the
#      transcript-hooks hook-merge opt-in, does NOT abort the strict
#      dirty-guard for `.github/copilot`, and the mutated content survives
#      the sync's restore step untouched.
#  aa. R9 — a local content mutation confined to the sibling
#      `.github/copilot/extension.json` (still `strict`, no exclusion) DOES
#      abort the strict dirty-guard for `.github/copilot`, exactly as before
#      the carve-out — guards against the narrow-scope fix silently widening
#      to the whole directory.
#  bb. R10 — the real repo's own `.gitignore` matches a representative
#      `.github/copilot/settings.json.bak.<timestamp>` filename in the shape
#      produced by `backup_file()`, and does NOT match the sibling
#      `extension.json` (pattern stayed narrow).
#
# Spec-0122 signed-graft-commit cases (issue #756):
#  cc. R1, R2, R6, R7 — a repository configured to sign (gpg.format ssh, an
#      ephemeral ed25519 key, commit.gpgsign true) gets a SIGNED graft commit
#      that still carries both parents, whose second parent is the fetched
#      upstream commit byte-for-byte, and whose creation is reported with a
#      `(signed)` suffix on stdout.
#  dd. R3 — a repository that does not sign (commit.gpgsign false) gets an
#      unsigned graft commit, exit 0, no `(signed)` on stdout, and no
#      signing-related line on stderr: the non-signing path gains nothing.
#  ee. R4, R5 — commit.gpgsign true with a user.signingkey that does not
#      exist: the sync refuses, creates no commit, leaves the branch tip
#      where it stood, leaves the restored content in the working tree, and
#      names the unproducible signature in its OWN message. git's signing
#      diagnostic is localized, so no assertion here may read it.
#  ff. R8 — the no-op path (FETCH_HEAD already an ancestor) still exits 0 in
#      a repository configured to sign but unable to: no commit means no
#      signature to produce, so signing capability is never probed.
#  gg. R1, R5 — commit.gpgsign holds a value git cannot read as a boolean.
#      `git commit` itself exits 128 in such a repository, so reporting a
#      successful sync would breach R1 on its face. Guards the shape of the
#      predicate: a config read placed in the word of a `[ … ]` test inside
#      an `if` condition discards git's 128 (errexit is suspended there) and
#      silently produces an unsigned commit with exit 0.
#  hh. R5 ordering — a gpg.ssh.program that exits 0 without writing a
#      signature makes `commit-tree -S` exit 0 and produce a commit with no
#      gpgsig header. The sync must refuse with the branch tip UNMOVED; the
#      same check placed after update-ref would refuse with the tip already
#      on the unsigned commit, satisfying R5 by violating R4.
#  ii. R3 by absence — commit.gpgsign unset, which is the modal non-signing
#      shape and the one no other case reaches (init_git_repo pins it to
#      `false`). Invoked with the operator's own configuration neutralised,
#      because the predicate resolves through global config too.
#  jj. R1, R2 in a SHA-256 repository (PR #803 review) — git's signature
#      header name is hash-algorithm dependent: `gpgsig` under SHA-1,
#      `gpgsig-sha256` under `--object-format=sha256`. A `^gpgsig ` pattern
#      WITH a trailing space matches the first and misses the second, so the
#      R5 post-condition refuses a signature it had just produced and reports
#      the opposite of what happened. Guards both readers of that pattern —
#      the script's post-condition and commit_is_signed.
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

# commit_is_signed <repo> <rev>
# True when <rev> carries a gpgsig header. The sed slice stops at the blank
# line that ends the header block: `git cat-file commit` also prints the
# message, so a naive full-output match reports SIGNED for an unsigned commit
# whose message body happens to begin with `gpgsig`.
#
# NO trailing space in the pattern, deliberately: the header name is
# hash-algorithm dependent (`gpgsig` under SHA-1, `gpgsig-sha256` under
# --object-format=sha256), and a trailing space would report a signed SHA-256
# commit as unsigned. Case jj fails if the space comes back.
commit_is_signed() {
  git -C "$1" cat-file commit "$2" | sed -n '/^$/q;p' | grep -q '^gpgsig'
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

# run_case_dirty_report <name> <repo> <present-path>… -- <absent-line>…
#
# Spec 0129's report assertions, and the reason this helper exists rather than a
# second `run_case_stderr` call: R2 is an ABSENCE requirement, and the string
# that must be absent (`scripts`) is a substring of the string that must be
# present (`scripts/sync-from-upstream.sh`). A substring absence check therefore
# fails whether or not the defect is fixed — a test that can never go green —
# while a substring PRESENCE check on the directory name passes with the defect
# fully present, because the pre-0129 refusal prints `  scripts`. Only a
# WHOLE-LINE comparison discriminates, and the refusal prints each path as two
# spaces followed by the path.
#
# Present paths are matched with the same two-space prefix, for symmetry and
# because a bare substring would match a sibling path that contains this one.
run_case_dirty_report() {
  local name="$1" repo="$2"
  shift 2
  local present=() absent=() bucket="present"
  local a
  for a in "$@"; do
    if [ "$a" = "--" ]; then bucket="absent"; continue; fi
    if [ "$bucket" = "present" ]; then present+=("$a"); else absent+=("$a"); fi
  done

  local actual_exit=0 stderr_out
  stderr_out="$(cd "$repo" && CREWRIG_REPO_DIR="$repo" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || actual_exit=$?

  local ok=1 p n
  if [ "$actual_exit" -ne 1 ]; then
    echo "FAIL  $name (expected exit 1, got $actual_exit)"
    ok=0
  fi
  for p in ${present[@]+"${present[@]}"}; do
    n="$(printf '%s\n' "$stderr_out" | grep -cxF "  $p" || true)"
    if [ "$n" -ne 1 ]; then
      echo "FAIL  $name (expected the line '  $p' exactly once, saw $n)"
      ok=0
    fi
  done
  for p in ${absent[@]+"${absent[@]}"}; do
    if printf '%s\n' "$stderr_out" | grep -qxF "  $p"; then
      echo "FAIL  $name (stderr names '$p' as its own line, which it must not)"
      ok=0
    fi
  done

  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name"
    pass=$((pass + 1))
  else
    echo "      actual stderr: $stderr_out"
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
# Case z — spec 0097 R8 / issue #605: a local mutation confined to
# .github/copilot/settings.json (excluded child nested under the strict
# .github/copilot parent) does not abort the strict dirty-guard, and the
# mutated content is left untouched by the restore step (the excluded child
# is skipped in both passes — same mechanism already covered generically by
# case s, exercised here against the real spec-0097 manifest shape).
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    ".github/copilot/settings.json" '{"hooks": {}}' \
    ".github/copilot/extension.json" '{"name": "upstream-ext"}'

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf '.github/copilot\n.github/copilot/settings.json\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    ".github/copilot/settings.json" '{"hooks": {}}' \
    ".github/copilot/extension.json" '{"name": "upstream-ext"}'

  # Mutate settings.json only, representative of the transcript-hooks
  # hook-merge opt-in rewriting it locally with an absolute hook path.
  # Copilot hooks are an object keyed by camelCase event name.
  printf '{"hooks": {"sessionStart": [{"type": "command", "command": "/Users/agent/.claude/hooks/transcript-hook.sh"}]}}' \
    > "$adopter/.github/copilot/settings.json"

  actual_exit=0
  stderr_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" 2>&1 >/dev/null)" || actual_exit=$?

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-z: expected exit 0, got $actual_exit"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi
  settings_after="$(cat "$adopter/.github/copilot/settings.json" 2>/dev/null)"
  if [ "$settings_after" != '{"hooks": {"sessionStart": [{"type": "command", "command": "/Users/agent/.claude/hooks/transcript-hook.sh"}]}}' ]; then
    echo "FAIL  case-z: settings.json hook-merge mutation was reverted by sync: '$settings_after'"
    ok=0
  fi
  ext_after="$(cat "$adopter/.github/copilot/extension.json" 2>/dev/null)"
  if [ "$ext_after" != '{"name": "upstream-ext"}' ]; then
    echo "FAIL  case-z: unmodified sibling extension.json unexpectedly changed: '$ext_after'"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-z: settings.json mutation does not abort .github/copilot strict guard, content preserved"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case aa — spec 0097 R9 / issue #605: a local mutation confined to the
# sibling .github/copilot/extension.json (still strict, not excluded) still
# aborts the strict dirty-guard for .github/copilot, exactly as it did before
# the settings.json carve-out — proves the fix's scope stayed narrow to
# settings.json alone and did not silently widen to the whole directory.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    ".github/copilot/settings.json" '{"hooks": {}}' \
    ".github/copilot/extension.json" '{"name": "upstream-ext"}'

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf '.github/copilot\n.github/copilot/settings.json\texcluded\n' \
    > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    ".github/copilot/settings.json" '{"hooks": {}}' \
    ".github/copilot/extension.json" '{"name": "upstream-ext"}'

  # Mutate extension.json only — settings.json stays untouched.
  printf '{"name": "locally-edited-ext"}' > "$adopter/.github/copilot/extension.json"

  run_case_stderr \
    "case-aa extension.json mutation still aborts .github/copilot strict guard" \
    "$adopter" \
    1 \
    ".github/copilot"

  # Working tree must still contain the local modification (unchanged by script).
  ext_after="$(cat "$adopter/.github/copilot/extension.json" 2>/dev/null)"
  if [ "$ext_after" = '{"name": "locally-edited-ext"}' ]; then
    echo "PASS  case-aa: extension.json working-tree edit unchanged (abort happened before restore)"
    pass=$((pass + 1))
  else
    echo "FAIL  case-aa: extension.json was unexpectedly modified by the aborted sync"
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case bb — spec 0097 R10 / issue #605: the real repo's committed .gitignore
# ignores a representative .github/copilot/settings.json.bak.<timestamp>
# filename in the exact shape produced by backup_file() in
# scripts/lib/common.sh (`cp -P "$target" "${target}.bak.${stamp}"`,
# `stamp="$(date +%Y%m%d-%H%M%S)"`). Unlike every other case in this file,
# this checks the actual repo's own .gitignore (via `git check-ignore`
# against the real REPO_ROOT) rather than a synthetic fixture — .gitignore
# is not an input to sync-from-upstream.sh, so there is nothing to
# synthesize; the pattern under test either ships in this repo's .gitignore
# or it does not.
# ---------------------------------------------------------------------------
{
  REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
  representative_path=".github/copilot/settings.json.bak.20260723-203351"

  if git -C "$REPO_ROOT" check-ignore -q "$representative_path"; then
    echo "PASS  case-bb: $representative_path is gitignored"
    pass=$((pass + 1))
  else
    echo "FAIL  case-bb: $representative_path is NOT gitignored (git check-ignore returned non-zero)"
    fail=$((fail + 1))
  fi

  # Negative control: the narrow pattern must not widen to cover the
  # sibling extension.json, which is still `strict` and must keep aborting
  # the sync on a local diff (case aa) rather than silently disappearing
  # from git status.
  if git -C "$REPO_ROOT" check-ignore -q ".github/copilot/extension.json"; then
    echo "FAIL  case-bb: sibling extension.json is unexpectedly gitignored (pattern too wide)"
    fail=$((fail + 1))
  else
    echo "PASS  case-bb: sibling extension.json is NOT gitignored (pattern stayed narrow)"
    pass=$((pass + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case cc — spec 0122 R1, R2, R6, R7: a repository configured to sign its
# commits gets a SIGNED graft commit that still carries both parents, the
# second of them the fetched upstream commit byte-for-byte.
#
# The signing key lives OUTSIDE the adopter worktree. Inside it, the R8
# anti-pollution guard would see an untracked, ungoverned path and abort the
# history-preserving step before `git add -A` ever runs — and the resulting
# failure reads as a signing failure, which is what makes it worth naming.
#
# The signing configuration is applied AFTER the fixture's own commits, so
# those commits stay hermetic under init_git_repo's `commit.gpgsign false`
# pin and the case remains constructible on a machine whose global config
# points at a key this process cannot use.
# ---------------------------------------------------------------------------
{
  ok=1
  keydir="$(mktemp -d "$TMP_ROOT/signkey.XXXXXX")"
  if ! ssh-keygen -t ed25519 -N '' -f "$keydir/signer" -q 2>/dev/null; then
    echo "FAIL  case-cc: could not create an ed25519 key — ssh-keygen signing support (OpenSSH >= 8.2) is a precondition of this case, not an optional capability"
    ok=0
  fi

  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"
  upstream_sha="$(git -C "$upstream" rev-parse HEAD)"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config gpg.format ssh
  git -C "$adopter" config user.signingkey "$keydir/signer.pub"
  git -C "$adopter" config commit.gpgsign true

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-cc: expected exit 0, got $actual_exit"
    ok=0
  fi
  if [ "$head_after" = "$tip_before" ]; then
    echo "FAIL  case-cc: HEAD did not move — no graft commit was created"
    ok=0
  fi
  if ! commit_is_signed "$adopter" HEAD; then
    echo "FAIL  case-cc: the graft commit carries no gpgsig header though commit.gpgsign is true"
    ok=0
  fi
  parent_count="$(git -C "$adopter" cat-file commit HEAD | sed -n '/^$/q;p' | grep -c '^parent ')"
  if [ "$parent_count" -ne 2 ]; then
    echo "FAIL  case-cc: the graft commit carries $parent_count parent(s), expected 2"
    ok=0
  fi
  first_parent="$(git -C "$adopter" rev-parse 'HEAD^1' 2>/dev/null || true)"
  second_parent="$(git -C "$adopter" rev-parse 'HEAD^2' 2>/dev/null || true)"
  if [ "$first_parent" != "$tip_before" ]; then
    echo "FAIL  case-cc: first parent is '$first_parent', expected the pre-run tip '$tip_before'"
    ok=0
  fi
  if [ "$second_parent" != "$upstream_sha" ]; then
    echo "FAIL  case-cc: second parent is '$second_parent', expected the fetched upstream commit '$upstream_sha' unchanged (R7)"
    ok=0
  fi
  if ! git -C "$adopter" merge-base --is-ancestor "$upstream_sha" HEAD 2>/dev/null; then
    echo "FAIL  case-cc: the fetched upstream commit is not an ancestor of the new branch tip"
    ok=0
  fi
  if ! echo "$stdout_out" | grep -qF "(signed)"; then
    echo "FAIL  case-cc: stdout does not report the commit as signed"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-cc: signing repository gets a signed graft commit with both parents intact"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case dd — spec 0122 R3: a repository that does not sign its commits is
# untouched by the change. init_git_repo pins `commit.gpgsign false` locally,
# which is what makes the case hermetic: the predicate resolves through global
# config too, so an unpinned fixture would inherit the operator's own setting.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  stdout_file="$(mktemp "$TMP_ROOT/dd-stdout.XXXXXX")"
  stderr_file="$(mktemp "$TMP_ROOT/dd-stderr.XXXXXX")"
  actual_exit=0
  ( cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history >"$stdout_file" 2>"$stderr_file" ) || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-dd: expected exit 0, got $actual_exit"
    echo "      stderr: $(cat "$stderr_file")"
    ok=0
  fi
  if [ "$head_after" = "$tip_before" ]; then
    echo "FAIL  case-dd: HEAD did not move — no graft commit was created"
    ok=0
  fi
  if commit_is_signed "$adopter" HEAD; then
    echo "FAIL  case-dd: the graft commit carries a gpgsig header though commit.gpgsign is false"
    ok=0
  fi
  if grep -qF "(signed)" "$stdout_file"; then
    echo "FAIL  case-dd: stdout reports the commit as signed"
    echo "      actual stdout: $(cat "$stdout_file")"
    ok=0
  fi
  if grep -q "[Ss]ign" "$stderr_file"; then
    echo "FAIL  case-dd: stderr carries a signing-related line on the non-signing path"
    echo "      actual stderr: $(cat "$stderr_file")"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-dd: non-signing repository gets an unsigned graft commit, exit 0, no signing noise"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case ee — spec 0122 R4, R5: commit.gpgsign true with a user.signingkey that
# does not exist. The sync refuses AFTER the policy-aware restore (spec 0122's
# closed open question), so the restored upstream content is already in the
# working tree when it does.
#
# The stderr assertion reads the script's OWN message. git's signing
# diagnostic is localized — on a French-locale machine it opens `erreur :` —
# so an assertion on git's wording would pass in CI and fail on a maintainer's
# laptop for a reason having nothing to do with the requirement.
# ---------------------------------------------------------------------------
{
  keydir="$(mktemp -d "$TMP_ROOT/signkey.XXXXXX")"

  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config gpg.format ssh
  git -C "$adopter" config user.signingkey "$keydir/absent-key.pub"
  git -C "$adopter" config commit.gpgsign true

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stderr_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1 >/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-ee: expected a non-zero exit when the configured signature cannot be produced, got 0"
    ok=0
  fi
  if [ "$head_after" != "$tip_before" ]; then
    echo "FAIL  case-ee: the branch tip moved despite the signing refusal ('$tip_before' -> '$head_after')"
    ok=0
  fi
  content_after="$(cat "$adopter/core-file.txt" 2>/dev/null)"
  if [ "$content_after" != "upstream v2 content" ]; then
    echo "FAIL  case-ee: the restored files are not in the working tree (core-file.txt = '$content_after')"
    ok=0
  fi
  if ! echo "$stderr_out" | grep -qF "refuses to commit — this repository is configured to sign"; then
    echo "FAIL  case-ee: stderr does not name the unproducible signature in the script's own words"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-ee: unproducible signature refuses with no commit, tip unmoved, restore intact"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case ff — spec 0122 R8: the no-op path still exits 0 in a repository that
# is configured to sign but cannot. No commit is created, so no signature is
# needed and signing capability is never probed. Case u's clone shape, where
# FETCH_HEAD is already an ancestor of the branch tip.
#
# Placing a signing probe before the no-op short-circuit is exactly the
# regression this case catches.
# ---------------------------------------------------------------------------
{
  keydir="$(mktemp -d "$TMP_ROOT/signkey.XXXXXX")"

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

  git -C "$adopter" config gpg.format ssh
  git -C "$adopter" config user.signingkey "$keydir/absent-key.pub"
  git -C "$adopter" config commit.gpgsign true

  head_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-ff: expected exit 0 on the no-op path, got $actual_exit"
    ok=0
  fi
  if [ "$head_after" != "$head_before" ]; then
    echo "FAIL  case-ff: HEAD moved (a commit was created) though FETCH_HEAD was already an ancestor"
    ok=0
  fi
  if ! echo "$stdout_out" | grep -qF "no-op"; then
    echo "FAIL  case-ff: stdout missing the no-op acknowledgement"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-ff: no-op path exits 0 in a signing repository that cannot sign"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case gg — spec 0122 R1, R5: commit.gpgsign holds a value git cannot read as
# a boolean, and no signing key is configured at all. `git commit` itself
# exits 128 in such a repository, so a sync reporting success here breaches R1
# on its face.
#
# This is the case that pins the SHAPE of the predicate. Reading the value in
# the word of a `[ … ]` test inside an `if` condition — where errexit is
# suspended — discards git's 128 twice over and yields an unsigned commit with
# exit 0. The assertion is on the script's own English message, not on git's
# localized `fatal :` line.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config commit.gpgsign yesplease

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stderr_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1 >/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-gg: expected a non-zero exit on an unreadable commit.gpgsign, got 0"
    ok=0
  fi
  if [ "$head_after" != "$tip_before" ]; then
    echo "FAIL  case-gg: the branch tip moved despite the unreadable commit.gpgsign ('$tip_before' -> '$head_after')"
    ok=0
  fi
  if ! echo "$stderr_out" | grep -qF "cannot determine whether to sign"; then
    echo "FAIL  case-gg: stderr does not name the unreadable commit.gpgsign in the script's own words"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-gg: unreadable commit.gpgsign refuses with no commit and the tip unmoved"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case hh — spec 0122 R5 ordering: a gpg.ssh.program that exits 0 without
# writing a signature makes `commit-tree -S` exit 0 and hand back a commit
# with no gpgsig header. That is the degradation R5 forbids, and it is
# reachable from a black-box fixture — the shape of a mis-wired signing
# wrapper.
#
# The HEAD assertion is what pins the post-condition's PLACEMENT. Run before
# update-ref, the refusal leaves the tip where it stood; run after, the same
# refusal leaves the tip on the unsigned commit — satisfying R5 by violating
# R4. The stub lives outside the adopter worktree for the same reason case
# cc's key does: the R8 guard rejects an ungoverned path first.
# ---------------------------------------------------------------------------
{
  ok=1
  keydir="$(mktemp -d "$TMP_ROOT/signkey.XXXXXX")"
  if ! ssh-keygen -t ed25519 -N '' -f "$keydir/signer" -q 2>/dev/null; then
    echo "FAIL  case-hh: could not create an ed25519 key — ssh-keygen signing support (OpenSSH >= 8.2) is a precondition of this case, not an optional capability"
    ok=0
  fi
  # git invokes the signing program as
  # `<prog> -Y sign -n git -f <pubkey> <buffer>` and then reads
  # `<buffer>.sig`. The stub creates that file empty and reports success.
  # Taking the LAST argument keeps the stub independent of git's argument
  # order.
  cat > "$keydir/emptysig.sh" <<'STUB'
#!/bin/sh
for arg in "$@"; do buffer="$arg"; done
: > "$buffer.sig"
exit 0
STUB
  chmod +x "$keydir/emptysig.sh"

  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config gpg.format ssh
  git -C "$adopter" config user.signingkey "$keydir/signer.pub"
  git -C "$adopter" config gpg.ssh.program "$keydir/emptysig.sh"
  git -C "$adopter" config commit.gpgsign true

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stderr_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>&1 >/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  if [ "$actual_exit" -eq 0 ]; then
    echo "FAIL  case-hh: expected a non-zero exit when commit-tree returns an unsigned commit, got 0"
    ok=0
  fi
  if [ "$head_after" != "$tip_before" ]; then
    echo "FAIL  case-hh: the branch tip moved onto the unsigned commit — the post-condition runs after update-ref ('$tip_before' -> '$head_after')"
    ok=0
  fi
  if ! echo "$stderr_out" | grep -qF "built an unsigned commit"; then
    echo "FAIL  case-hh: stderr does not name the unsigned-commit refusal"
    echo "      actual stderr: $stderr_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-hh: an unsigned commit from a successful commit-tree -S refuses before the tip moves"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case ii — spec 0122 R3 by absence: commit.gpgsign UNSET, which is the modal
# non-signing shape and the one no other case reaches (init_git_repo pins the
# key to `false`, so every other fixture takes the explicitly-false branch and
# the presence probe always succeeds).
#
# The `--unset` comes AFTER the fixture's own commits, and the script is
# invoked with the operator's configuration neutralised. Both are mandatory,
# not hygiene. Without the isolation, a repository with no local key resolves
# commit.gpgsign to `true` from a maintainer's ~/.gitconfig, so the case would
# be a SIGNING fixture locally and a non-signing one in CI. And with the unset
# applied before the fixture's commits, those commits would be signed with the
# operator's own key — harmless where it works, unconstructible where it does
# not. GIT_CONFIG_NOSYSTEM + HOME + XDG_CONFIG_HOME is preferred over
# GIT_CONFIG_GLOBAL (git >= 2.32) so the suite's git floor is not raised.
# ---------------------------------------------------------------------------
{
  isolated="$(mktemp -d "$TMP_ROOT/isolated-home.XXXXXX")"

  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config --unset commit.gpgsign

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  stdout_file="$(mktemp "$TMP_ROOT/ii-stdout.XXXXXX")"
  stderr_file="$(mktemp "$TMP_ROOT/ii-stderr.XXXXXX")"
  actual_exit=0
  ( cd "$adopter" \
    && GIT_CONFIG_NOSYSTEM=1 HOME="$isolated" XDG_CONFIG_HOME="$isolated" \
       CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history \
       >"$stdout_file" 2>"$stderr_file" ) || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  ok=1
  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-ii: expected exit 0 with commit.gpgsign unset, got $actual_exit"
    echo "      stderr: $(cat "$stderr_file")"
    ok=0
  fi
  if [ "$head_after" = "$tip_before" ]; then
    echo "FAIL  case-ii: HEAD did not move — no graft commit was created"
    ok=0
  fi
  if commit_is_signed "$adopter" HEAD; then
    echo "FAIL  case-ii: the graft commit is signed though commit.gpgsign is unset"
    ok=0
  fi
  if grep -qF "(signed)" "$stdout_file"; then
    echo "FAIL  case-ii: stdout reports the commit as signed"
    echo "      actual stdout: $(cat "$stdout_file")"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-ii: unset commit.gpgsign grafts an unsigned commit and exits 0"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case jj — spec 0122 R1, R2 in a SHA-256 repository (PR #803 cold review).
# Git's signature header name is hash-algorithm dependent: `gpgsig` in a SHA-1
# repository, `gpgsig-sha256` in one created with --object-format=sha256. A
# `^gpgsig ` pattern WITH a trailing space matches the first and misses the
# second, so the R5 post-condition refuses a signature it had just
# successfully produced: no commit at all where an ordinary `git commit` makes
# a signed one. That breaches R1 and R2 rather than serving R5, and the
# refusal message names a cause that did not occur.
#
# Both readers of the pattern are covered, independently:
#   - restore the space in sync-from-upstream.sh -> fails on exit code, on the
#     unmoved HEAD, and on the missing `(signed)`;
#   - restore it in commit_is_signed only        -> fails on that assertion
#     alone, with the sync itself still green.
#
# Reachability is narrow and worth stating: a SHA-256 fork of a SHA-1 upstream
# never gets here, because `git fetch` refuses the object-format mismatch
# first. The fixture therefore needs SHA-256 on BOTH ends — which
# `canonical_repo` permits.
#
# The object format is fixed at init time, so `git init` runs with the flag
# first; a plain re-init inside init_git_repo preserves it (measured) and
# supplies the identity plus the `commit.gpgsign false` pin that keeps the
# fixture's own commits hermetic before the signing config goes on.
# ---------------------------------------------------------------------------
{
  ok=1
  keydir="$(mktemp -d "$TMP_ROOT/signkey.XXXXXX")"
  if ! ssh-keygen -t ed25519 -N '' -f "$keydir/signer" -q 2>/dev/null; then
    echo "FAIL  case-jj: could not create an ed25519 key — ssh-keygen signing support (OpenSSH >= 8.2) is a precondition of this case, not an optional capability"
    ok=0
  fi

  upstream="$(mktemp -d "$TMP_ROOT/upstream-sha256.XXXXXX")"
  adopter="$(mktemp -d "$TMP_ROOT/adopter-sha256.XXXXXX")"
  if ! git init -q --object-format=sha256 "$upstream" 2>/dev/null \
     || ! git init -q --object-format=sha256 "$adopter" 2>/dev/null; then
    echo "FAIL  case-jj: this git cannot create a --object-format=sha256 repository (needs git >= 2.29) — a precondition of this case, not an optional capability"
    ok=0
  fi
  init_git_repo "$upstream"
  init_git_repo "$adopter"

  # Fixture sanity: without this, a silent fallback to SHA-1 would leave the
  # case green while exercising the very header name it exists to NOT test.
  for r in "$upstream" "$adopter"; do
    fmt="$(git -C "$r" rev-parse --show-object-format 2>/dev/null || true)"
    if [ "$fmt" != "sha256" ]; then
      echo "FAIL  case-jj: fixture repo $r reports object format '$fmt', expected 'sha256' — the case would test the SHA-1 header name instead"
      ok=0
    fi
  done

  make_initial_commit "$upstream" \
    "core-file.txt" "upstream v1 content" \
    "other.txt"     "other content"
  commit_files "$upstream" "advance core-file" \
    "core-file.txt" "upstream v2 content"

  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'core-file.txt\n' > "$adopter/.crewrig/core-paths.txt"
  printf '%s' "upstream v1 content" > "$adopter/core-file.txt"
  printf '%s' "other content" > "$adopter/other.txt"
  git -C "$adopter" add -A
  git -C "$adopter" commit -q -m initial

  git -C "$adopter" config gpg.format ssh
  git -C "$adopter" config user.signingkey "$keydir/signer.pub"
  git -C "$adopter" config commit.gpgsign true

  # Premise check, deliberately BEFORE the sync and independent of it: this
  # fixture must really produce the hash-dependent header name, or the case
  # stops being evidence about the trailing space. Asserting it afterwards on
  # the graft commit would conflate "git renamed the header" with "the script
  # refused the commit" — under a restored trailing space HEAD never moves, so
  # the check would fail while pointing at the wrong cause. The throwaway
  # commit is referenced by nothing and changes no ref, index, or file.
  probe_commit="$(git -C "$adopter" commit-tree "$(git -C "$adopter" rev-parse 'HEAD^{tree}')" -m sha256-header-probe -S 2>/dev/null || true)"
  if [ -z "$probe_commit" ] || ! git -C "$adopter" cat-file commit "$probe_commit" 2>/dev/null | sed -n '/^$/q;p' | grep -q '^gpgsig-sha256 '; then
    echo "FAIL  case-jj: this fixture does not produce a 'gpgsig-sha256' header — the case no longer exercises the hash-dependent header name it exists to cover"
    ok=0
  fi

  tip_before="$(git -C "$adopter" rev-parse HEAD)"

  actual_exit=0
  stdout_out="$(cd "$adopter" && CREWRIG_REPO_DIR="$adopter" bash "$SCRIPT_UNDER_TEST" --preserve-history 2>/dev/null)" || actual_exit=$?

  head_after="$(git -C "$adopter" rev-parse HEAD)"

  if [ "$actual_exit" -ne 0 ]; then
    echo "FAIL  case-jj: expected exit 0, got $actual_exit — a signature that WAS produced was read as absent"
    ok=0
  fi
  if [ "$head_after" = "$tip_before" ]; then
    echo "FAIL  case-jj: HEAD did not move — the graft commit was refused though the repository can sign"
    ok=0
  fi
  if ! commit_is_signed "$adopter" HEAD; then
    echo "FAIL  case-jj: commit_is_signed reports the graft commit unsigned in a SHA-256 repository"
    ok=0
  fi
  if ! echo "$stdout_out" | grep -qF "(signed)"; then
    echo "FAIL  case-jj: stdout does not report the commit as signed"
    echo "      actual stdout: $stdout_out"
    ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  case-jj: SHA-256 repository gets a signed graft commit (gpgsig-sha256 recognised)"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# ---------------------------------------------------------------------------
# Case kk — spec 0129 R9: a directory manifest entry with ONE modified member
# reports the MEMBER, and never the entry.
#
# The suite's pre-0129 coverage of the dirty guard runs through a manifest entry
# that resolves to a FILE (`dirty-core refusal`, and case-d), which is the shape
# that never exhibited issue #719 — for a file entry the entry IS the file. This
# is the first case to drive a directory entry through the refusal.
#
# The assertions are whole-line, via run_case_dirty_report, and that is
# load-bearing rather than tidy: asserting the presence of `scripts` as a
# substring passes against the PRE-fix script, which printed exactly that.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "tools/alpha.sh" "upstream alpha" \
    "tools/beta.sh" "upstream beta"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'tools\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "tools/alpha.sh" "upstream alpha" \
    "tools/beta.sh" "upstream beta"

  printf 'locally customised alpha' > "$adopter/tools/alpha.sh"

  run_case_dirty_report \
    "case-kk: a directory entry reports the modified member, not the directory" \
    "$adopter" \
    "tools/alpha.sh" \
    -- \
    "tools"
}

# ---------------------------------------------------------------------------
# Case ll — spec 0129 R10: every modified member is reported, not the first.
#
# This is the case that discriminates R3. On case-kk's single-member fixture an
# implementation that keeps the original `break` passes by accident: it reports
# the one member there is. Only a fixture with several modified members can tell
# "reports the members" from "reports the first member it finds".
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "tools/alpha.sh" "upstream alpha" \
    "tools/beta.sh" "upstream beta" \
    "tools/nested/gamma.sh" "upstream gamma"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'tools\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "tools/alpha.sh" "upstream alpha" \
    "tools/beta.sh" "upstream beta" \
    "tools/nested/gamma.sh" "upstream gamma"

  printf 'locally customised alpha' > "$adopter/tools/alpha.sh"
  printf 'locally customised beta'  > "$adopter/tools/beta.sh"
  printf 'locally customised gamma' > "$adopter/tools/nested/gamma.sh"

  run_case_dirty_report \
    "case-ll: every modified member is reported, not just the first" \
    "$adopter" \
    "tools/alpha.sh" "tools/beta.sh" "tools/nested/gamma.sh" \
    -- \
    "tools"
}

# ---------------------------------------------------------------------------
# Case mm — spec 0129 R1 via the deduplication: a file governed by BOTH a
# directory entry and a nested strict entry is reported exactly once.
#
# The manifest ships two shapes of this, and they fail differently. This fixture
# pins the NESTED-FILE shape (`docs` + `docs/index.json`), where the duplicate is
# produced by one append from the tree branch and one from the blob branch — so a
# deduplication installed at append time inside the tree branch cannot see it.
# The nested-DIRECTORY shape (`artifacts/core` + `artifacts/core/system-context`)
# also answers "governed by two entries" but goes green against that wrong
# placement, which is why the fixture here is the file shape and not that one.
#
# `grep -cxF` equal to 1 is the whole point: a substring count would silently
# absorb any sibling path containing this one.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "papers/index.json" '{"upstream": true}' \
    "papers/other.md" "upstream other"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'papers\npapers/index.json\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "papers/index.json" '{"upstream": true}' \
    "papers/other.md" "upstream other"

  printf '{"locally": "customised"}' > "$adopter/papers/index.json"

  run_case_dirty_report \
    "case-mm: a file governed by two strict entries is reported exactly once" \
    "$adopter" \
    "papers/index.json" \
    -- \
    "papers"
}

# ---------------------------------------------------------------------------
# Case nn — the dedup's seen-string is delimited by a NEWLINE, and a space
# delimiter silently drops a modified file from the refusal.
#
# Without this case the delimiter is defended by a comment and nothing else:
# reverting the newline to a space leaves the rest of the suite fully green, so
# the guard reads as protected while being unprotected. That gap is what the cold
# review of this PR found, and it is the same shape as the defect the whole ticket
# is about — a claim made in prose with no signal behind it.
#
# The fixture is built so a space-delimited membership test produces a FALSE HIT.
# The `container` entry is processed first and stores the member `container/name b`;
# the separate `b` entry probes the string "b", which is a space-separated
# fragment of what is stored. Under a space delimiter that probe reads as
# already-seen and `b` never reaches the report — a modified file, silently
# missing. Under a newline delimiter it cannot: git prints a space in a path
# verbatim but C-quotes control characters, so a member can hold a space and can
# never hold a newline.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "container/name b" "upstream spaced" \
    "b" "upstream b"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'container\nb\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "container/name b" "upstream spaced" \
    "b" "upstream b"

  printf 'locally customised spaced' > "$adopter/container/name b"
  printf 'locally customised b'      > "$adopter/b"

  run_case_dirty_report \
    "case-nn: a space-bearing member does not mask a separate modified file" \
    "$adopter" \
    "container/name b" "b" \
    -- \
    "container"
}

# ---------------------------------------------------------------------------
# Case oo — spec 0129 R4: the refusal states the targeted restoration and warns
# against the directory-level move.
#
# R4 is the half of this spec that reaches the adopter who already knows the
# directory-level habit and would reproduce it from memory. Deleting all four
# guidance lines left the suite green before this case existed, so the
# requirement shipped with no signal behind it.
#
# Asserted on the sentence that carries the warning rather than on the whole
# block: the wording may be improved, but a refusal that stops warning against
# the directory-level checkout has lost the requirement.
# ---------------------------------------------------------------------------
{
  upstream="$(mktemp -d "$TMP_ROOT/upstream.XXXXXX")"
  init_git_repo "$upstream"
  make_initial_commit "$upstream" \
    "tools/alpha.sh" "upstream alpha"

  adopter="$(mktemp -d "$TMP_ROOT/adopter.XXXXXX")"
  init_git_repo "$adopter"
  printf 'canonical_repo = "%s"\n' "$upstream" > "$adopter/crewrig.config.toml"
  mkdir -p "$adopter/.crewrig"
  printf 'tools\n' > "$adopter/.crewrig/core-paths.txt"
  make_initial_commit "$adopter" \
    "tools/alpha.sh" "upstream alpha"

  printf 'locally customised alpha' > "$adopter/tools/alpha.sh"

  run_case_stderr \
    "case-oo: the refusal warns against restoring the containing directory" \
    "$adopter" \
    1 \
    "Never restore the containing directory"

  run_case_stderr \
    "case-oo: the refusal states the targeted restoration command" \
    "$adopter" \
    1 \
    "Restore ONLY the files listed above"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
