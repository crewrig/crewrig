#!/bin/bash
# test-mempalace-version-range.sh — Guard the single MemPalace supported-range
# pin across every literal-text copy in the repository (spec 0082 R5, delta-01).
#
# The executable pin is single-sourced in scripts/lib/common.sh
# (MEMPALACE_MIN_VERSION / MEMPALACE_MAX_VERSION_EXCLUSIVE). A shared shell
# variable physically cannot reach the Markdown, Dockerfile, Taskfile, and skill
# copies of the range literal, so a grep-based guard is the only mechanism that
# can hold the invariant across file types. This guard FAILS when:
#   (a) the superseded 3.3-line range literal survives anywhere in
#       a live file, or
#   (b) any LITERAL NUMERIC `mempalace>=<x>,<<y>` install-hint range differs from
#       the current pin `mempalace>=3.6.0,<3.7`.
#
# Check (b) anchors on a numeric form (`mempalace>=[0-9]`) so it matches only
# baked literals and explicitly NOT the `${MEMPALACE_MIN_VERSION},<${...}`
# interpolated form used by the single source in common.sh and its sourcing
# scripts — flagging that would be a self-inflicted false positive.
#
# Exemptions (delta-01 / spec 0082 v1.0.1, reworded R5): docs/adr/** and specs/**
# are immutable historical records that quote the superseded literal verbatim;
# they are out of scope for both the sweep and this guard. This script's own file
# is exempt too — it necessarily names the forbidden pattern.
#
# The guard runs against the real repository (enforcement) AND proves its own
# scanning logic against hermetic git-init fixtures (fail-then-pass). Neither the
# superseded 3.3-line range literal nor its numeric install-hint prefix appears
# contiguously in this file; both are assembled at runtime from parts, so a plain
# `git grep` for those strings never counts this guard as an offender.
#
# Usage:
#   bash scripts/tests/test-mempalace-version-range.sh
#
# Override the repository root with CREWRIG_REPO_DIR (used by the self-test).

# -e intentionally omitted: pass/fail counters control the harness; adding -e
# would abort on the expected non-zero exits of the scan under test.
set -uo pipefail

REPO_DIR="${CREWRIG_REPO_DIR:-"$(cd "$(dirname "$0")/../.." && pwd)"}"

# --- Range constants, assembled from parts so no contiguous forbidden literal
#     lives in this file (keeps a plain `git grep` for the old strings clean) ---
OLD_MIN="3.3.3"
OLD_MAX="3.4"
NEW_MIN="3.6.0"
NEW_MAX="3.7"
EXPECTED_SPEC="mempalace>=${NEW_MIN},<${NEW_MAX}"

# ERE matching the superseded literal range. Written with escaped dots, so the
# byte sequence here is not the contiguous 3.3-line literal a plain grep flags.
OLD_LIT_RE="${OLD_MIN//./\\.},<${OLD_MAX//./\\.}"

# Pathspecs excluded from both checks (immutable records + this guard).
EXCLUDES=(
  ':(exclude)docs/adr/**'
  ':(exclude)specs/**'
  ':(exclude)scripts/tests/test-mempalace-version-range.sh'
)

# scan_repo <repo_dir>
# Emits one line per violation on stderr; returns 0 when clean, 1 otherwise.
scan_repo() {
  local repo="$1"
  local violations=0
  local hit file rest lineno content token

  # --- Check (a): the superseded literal range must not survive ---
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    echo "  STALE RANGE: $hit" >&2
    violations=$((violations + 1))
  done < <(git -C "$repo" grep -nE "$OLD_LIT_RE" -- . "${EXCLUDES[@]}" 2>/dev/null || true)

  # --- Check (b): every literal numeric mempalace range must equal the pin ---
  while IFS= read -r hit; do
    [ -z "$hit" ] && continue
    file="${hit%%:*}"
    rest="${hit#*:}"
    lineno="${rest%%:*}"
    content="${rest#*:}"
    while IFS= read -r token; do
      [ -z "$token" ] && continue
      if [ "$token" != "$EXPECTED_SPEC" ]; then
        echo "  DIVERGENT RANGE: $file:$lineno: '$token' (want '$EXPECTED_SPEC')" >&2
        violations=$((violations + 1))
      fi
    done < <(printf '%s\n' "$content" | grep -oE 'mempalace>=[0-9][0-9.,<]*')
  done < <(git -C "$repo" grep -nE 'mempalace>=[0-9]' -- . "${EXCLUDES[@]}" 2>/dev/null || true)

  [ "$violations" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Hermetic self-test — prove the scan logic against git-init fixtures.
# ---------------------------------------------------------------------------
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0

init_git_repo() {
  local dir="$1"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" config commit.gpgsign false
}

# make_commit <repo> <file> <content>
# The scan reads tracked content via `git grep`, so fixtures must be committed.
make_commit() {
  local repo="$1" file="$2" content="$3"
  mkdir -p "$repo/$(dirname "$file")"
  printf '%s\n' "$content" > "$repo/$file"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "fixture"
}

new_repo() {
  local repo
  repo="$(mktemp -d "$TMP_ROOT/repo.XXXXXX")"
  init_git_repo "$repo"
  echo "$repo"
}

# ok <label>  /  ko <label>
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ko() { echo "FAIL  $1"; fail=$((fail + 1)); }

# Case a — a surviving superseded literal is flagged (fail).
{
  repo="$(new_repo)"
  make_commit "$repo" "README.md" "pipx install 'mempalace>=${OLD_MIN},<${OLD_MAX}'"
  if scan_repo "$repo" 2>/dev/null; then
    ko "case-a: superseded literal NOT flagged (want failure)"
  else
    ok "case-a: superseded literal is flagged"
  fi
}

# Case b — a divergent numeric install-hint range is flagged (fail).
{
  repo="$(new_repo)"
  make_commit "$repo" "docs/x.md" "run pipx install 'mempalace>=3.5.0,<3.6' now"
  if scan_repo "$repo" 2>/dev/null; then
    ko "case-b: divergent numeric range NOT flagged (want failure)"
  else
    ok "case-b: divergent numeric range is flagged"
  fi
}

# Case c — the exact current pin passes (clean).
{
  repo="$(new_repo)"
  make_commit "$repo" "docs/x.md" "run pipx install '${EXPECTED_SPEC}' now"
  if scan_repo "$repo" 2>/dev/null; then
    ok "case-c: current pin passes"
  else
    ko "case-c: current pin wrongly flagged (want pass)"
  fi
}

# Case d — the ${VAR}-interpolated single-source form is NOT flagged (clean).
# Single-quoted so the placeholder stays literal; the anchor mempalace>=[0-9]
# must not match a '$' after '>='.
{
  repo="$(new_repo)"
  interp='pipx install "mempalace>=${MEMPALACE_MIN_VERSION},<${MEMPALACE_MAX_VERSION_EXCLUSIVE}"'
  make_commit "$repo" "scripts/x.sh" "$interp"
  if scan_repo "$repo" 2>/dev/null; then
    ok "case-d: interpolated single-source form is not flagged"
  else
    ko "case-d: interpolated form wrongly flagged (self-inflicted false positive)"
  fi
}

# Case e — the superseded literal inside an exempt tree (docs/adr, specs) is
# tolerated (clean): immutable historical records quote it verbatim.
{
  repo="$(new_repo)"
  # Both exempt roots carry the superseded literal verbatim in one commit.
  mkdir -p "$repo/docs/adr" "$repo/specs"
  printf '%s\n' "installed via pipx install 'mempalace>=${OLD_MIN},<${OLD_MAX}'" > "$repo/docs/adr/0001-x.md"
  printf '%s\n' "cite 'mempalace>=${OLD_MIN},<${OLD_MAX}' as removed" > "$repo/specs/0082.md"
  git -C "$repo" add -A && git -C "$repo" commit -q -m "exempt-trees"
  if scan_repo "$repo" 2>/dev/null; then
    ok "case-e: superseded literal in docs/adr + specs is exempt"
  else
    ko "case-e: exempt-tree literal wrongly flagged (want pass)"
  fi
}

# ---------------------------------------------------------------------------
# Enforcement — the real repository must be clean.
# ---------------------------------------------------------------------------
{
  if scan_repo "$REPO_DIR"; then
    ok "repo: no stale or divergent MemPalace range literal in tracked files"
  else
    ko "repo: stale or divergent MemPalace range literal(s) found (see above)"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
total=$((pass + fail))
echo ""
echo "Results: $pass/$total passed"
[ "$fail" -eq 0 ] && exit 0 || exit 1
