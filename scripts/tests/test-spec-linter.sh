#!/bin/bash
# test-spec-linter.sh — Regression test for spec-linter.js.
#
# Usage:
#   bash scripts/tests/test-spec-linter.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LINTER_JS="$SCRIPT_DIR/lib/spec-linter.js"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$LINTER_JS" ]; then
  echo "FATAL: cannot find $LINTER_JS" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# Copy markdownlint config to temp root
cp "$ROOT_DIR/.markdownlintrc" "$TMP_ROOT/"
# Link node_modules so npx finds markdownlint
ln -s "$ROOT_DIR/node_modules" "$TMP_ROOT/node_modules"

pass=0
fail=0

render_spec() {
  local id="${1:-0001}"
  local slug="${2:-test-spec}"
  local status="${3:-draft}"
  local complexity="${4:-standard}"
  local extra_fm="${5:-}"
  local headings="${6:-}"

  if [ -z "$headings" ]; then
    headings=$(printf "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions")
  fi

  cat <<EOF
---
id: "$id"
slug: "$slug"
status: "$status"
complexity: "$complexity"
version: 1.0.0
related-issue: 123
$extra_fm
---

# Title

$headings
EOF
}

run_case() {
  local name="$1"
  local files="$2"
  local expected_exit="$3"
  local env_repo_dir="${4:-}"

  local actual_exit=0
  local output
  # We run from TMP_ROOT so markdownlint finds .markdownlintrc
  output=$( ( cd "$TMP_ROOT" && CREWRIG_REPO_DIR="$env_repo_dir" node "$LINTER_JS" $files 2>&1 ) ) || actual_exit=$?

  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    echo "Output:"
    echo "$output"
    fail=$((fail + 1))
  fi
}

# write_core_paths_fixture <dir> <content>
# Write a standalone .crewrig/core-paths.txt fixture at <dir>, for use with
# CREWRIG_REPO_DIR overrides (mirrors write_manifest() in
# scripts/tests/test-check-core-paths.sh:63-67).
write_core_paths_fixture() {
  local dir="$1" content="$2"
  mkdir -p "$dir/.crewrig"
  printf '%s' "$content" > "$dir/.crewrig/core-paths.txt"
}

# -------------------------------------------------------------------------
# Case 1 — Happy path: valid spec → exit 0
# -------------------------------------------------------------------------
spec1="0001-happy-path.md"
render_spec "0001" "happy-path" "draft" > "$TMP_ROOT/$spec1"
run_case "Case 1 — valid spec passes" "$spec1" 0

# -------------------------------------------------------------------------
# Case 2 — Missing heading → exit 1
# -------------------------------------------------------------------------
spec2="0002-missing-heading.md"
render_spec "0002" "missing-heading" "draft" "standard" "" "$(printf "## Intent\n\n## Requirements\n\n## Out of scope\n\n## Open questions")" > "$TMP_ROOT/$spec2"
run_case "Case 2 — missing heading fails" "$spec2" 1

# -------------------------------------------------------------------------
# Case 3 — ID mismatch → exit 1
# -------------------------------------------------------------------------
spec3="0003-id-mismatch.md"
render_spec "9999" "id-mismatch" "draft" > "$TMP_ROOT/$spec3"
run_case "Case 3 — ID mismatch fails" "$spec3" 1

# -------------------------------------------------------------------------
# Case 4 — Delta spec wrong order → exit 1
# -------------------------------------------------------------------------
spec4="0004-delta-order.delta-01.md"
render_spec "0004" "delta-order" "draft" "standard" "" "$(printf "## MODIFIED\n\n## ADDED\n\n## REMOVED")" > "$TMP_ROOT/$spec4"
run_case "Case 4 — delta spec wrong heading order fails" "$spec4" 1

# -------------------------------------------------------------------------
# Case 5 — max-iterations out of bounds → exit 1
# -------------------------------------------------------------------------
spec5="0005-max-iterations.md"
render_spec "0005" "max-iterations" "draft" "standard" "max-iterations: 25" > "$TMP_ROOT/$spec5"
run_case "Case 5 — max-iterations > 20 fails" "$spec5" 1

# -------------------------------------------------------------------------
# Case 6 — superseded-by missing → exit 1
# -------------------------------------------------------------------------
spec6="0006-superseded-missing.md"
render_spec "0006" "superseded-missing" "superseded" > "$TMP_ROOT/$spec6"
run_case "Case 6 — status superseded without superseded-by fails" "$spec6" 1

# -------------------------------------------------------------------------
# Case 7 — interaction-mode missing (status approved) → exit 1
# -------------------------------------------------------------------------
spec7="0007-interaction-missing.md"
render_spec "0007" "interaction-missing" "approved" > "$TMP_ROOT/$spec7"
run_case "Case 7 — status approved without interaction-mode fails" "$spec7" 1

# -------------------------------------------------------------------------
# Case 8 — markdownlint integration → exit 1
# -------------------------------------------------------------------------
# MD001: Header levels should only increase by one level at a time
spec8="0008-markdownlint-fail.md"
cat <<EOF > "$TMP_ROOT/$spec8"
---
id: "0008"
slug: "markdownlint-fail"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title
### Wrong Level Heading
## Intent
## Requirements
## Scenarios
## Out of scope
## Open questions
EOF
run_case "Case 8 — markdownlint failure causes exit 1" "$spec8" 1

# -------------------------------------------------------------------------
# Case 9 — interaction-mode present (status approved) → exit 0
# -------------------------------------------------------------------------
spec9="0009-interaction-present.md"
render_spec "0009" "interaction-present" "approved" "standard" "interaction-mode: INTERMEDIATE" > "$TMP_ROOT/$spec9"
run_case "Case 9 — status approved with interaction-mode passes" "$spec9" 0

# -------------------------------------------------------------------------
# Case 10 — interaction-mode missing (status draft) → exit 0
# -------------------------------------------------------------------------
spec10="0010-interaction-missing-draft.md"
render_spec "0010" "interaction-missing-draft" "draft" > "$TMP_ROOT/$spec10"
run_case "Case 10 — status draft without interaction-mode passes" "$spec10" 0

# -------------------------------------------------------------------------
# Case 11 — Delta spec correct order → exit 0
# -------------------------------------------------------------------------
spec11="0011-delta-ok.delta-01.md"
render_spec "0011" "delta-ok" "draft" "standard" "" "$(printf "## ADDED\n\n## MODIFIED\n\n## REMOVED")" > "$TMP_ROOT/$spec11"
run_case "Case 11 — delta spec correct heading order passes" "$spec11" 0

# -------------------------------------------------------------------------
# Case 12 — superseded-by prohibited (status approved) → exit 1
# -------------------------------------------------------------------------
spec12="0012-superseded-prohibited.md"
render_spec "0012" "superseded-prohibited" "approved" "standard" "interaction-mode: INTERMEDIATE\nsuperseded-by: 0001" > "$TMP_ROOT/$spec12"
run_case "Case 12 — status approved with superseded-by fails" "$spec12" 1

# -------------------------------------------------------------------------
# Case 13 — related-issue not integer → exit 1
# -------------------------------------------------------------------------
spec13="0013-related-issue-string.md"
render_spec "0013" "related-issue-string" "draft" "standard" "related-issue: \"#123\"" > "$TMP_ROOT/$spec13"
run_case "Case 13 — non-integer related-issue fails" "$spec13" 1

# -------------------------------------------------------------------------
# Case 14 — extra headings allowed after mandatory ones → exit 0
# -------------------------------------------------------------------------
spec14="0014-extra-headings.md"
render_spec "0014" "extra-headings" "draft" "standard" "" "$(printf "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions\n\n## Extra Section\n\n### Sub Section")" > "$TMP_ROOT/$spec14"
run_case "Case 14 — extra headings allowed after mandatory ones passes" "$spec14" 0

# -------------------------------------------------------------------------
# Case 15 — headings inside code blocks are ignored → exit 0
# -------------------------------------------------------------------------
spec15="0015-headings-in-code.md"
render_spec "0015" "headings-in-code" "draft" "standard" "" "$(printf "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions\n\n\`\`\`markdown\n## This heading should be ignored\n\`\`\`")" > "$TMP_ROOT/$spec15"
run_case "Case 15 — headings inside code blocks are ignored passes" "$spec15" 0

# -------------------------------------------------------------------------
# Case 16 — mandatory heading missing but present in code block → exit 1
# -------------------------------------------------------------------------
spec16="0016-mandatory-heading-in-code.md"
render_spec "0016" "mandatory-heading-in-code" "draft" "standard" "" "$(printf "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n\`\`\`markdown\n## Open questions\n\`\`\`")" > "$TMP_ROOT/$spec16"
run_case "Case 16 — mandatory heading missing but present in code block fails" "$spec16" 1

# -------------------------------------------------------------------------
# Cases 17-19 exercise the specs/org exclusion (spec 0071) against the real,
# committed .crewrig/core-paths.txt — no CREWRIG_REPO_DIR override. This
# deliberately couples their outcome to `specs/org` remaining classified
# `excluded` in that manifest; Case 20/21 below are what actually prove the
# exclusion mechanism is manifest-driven rather than hardcoded to
# `specs/org`.
# -------------------------------------------------------------------------

# -------------------------------------------------------------------------
# Case 17 — Scenario 1: default CI invocation (no target args, matching the
# `lint-specs` job) ignores a non-conforming specs/org/ file.
# -------------------------------------------------------------------------
mkdir -p "$TMP_ROOT/specs/org"
cat <<'EOF' > "$TMP_ROOT/specs/org/ORG-0001-example.md"
---
id: "ORG-0001"
slug: "example"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title

## Intent

## Requirements
EOF
run_case "Case 17 — non-conforming specs/org file ignored on default CI invocation" "" 0

# -------------------------------------------------------------------------
# Case 18 — Scenario 2: a non-conforming spec outside specs/org/, on the
# same invocation, is still caught (R4).
# -------------------------------------------------------------------------
render_spec "9999" "bad" > "$TMP_ROOT/specs/9999-bad!name.md"
run_case "Case 18 — non-conforming upstream spec still fails alongside specs/org" "" 1

# -------------------------------------------------------------------------
# Case 19 — Scenario 3: explicit `specs/org` target still exempts the
# non-conforming file (reuses Case 17's fixture).
# -------------------------------------------------------------------------
run_case "Case 19 — explicit specs/org target still exempts non-conforming file" "specs/org" 0

# -------------------------------------------------------------------------
# Case 20 — Scenario 4: manifest-driven exclusion generalizes to a path
# never special-cased in spec-linter.js (specs/experimental), proving R5
# (no hardcoded `specs/org` string match). Uses an isolated tree distinct
# from $TMP_ROOT/specs: the shared tree above already carries Case 18's
# deliberately non-conforming, non-excluded specs/9999-bad!name.md fixture,
# which would fail this invocation for an unrelated reason if reused — this
# isolation keeps the assertion pointed squarely at the manifest override.
# -------------------------------------------------------------------------
SCENARIO4_ROOT="$TMP_ROOT/scenario4"
mkdir -p "$SCENARIO4_ROOT/specs/experimental"
cp "$ROOT_DIR/.markdownlintrc" "$SCENARIO4_ROOT/"
ln -s "$ROOT_DIR/node_modules" "$SCENARIO4_ROOT/node_modules"
cat <<'EOF' > "$SCENARIO4_ROOT/specs/experimental/9999-bad.md"
---
id: "9999"
slug: "bad"
status: "draft"
complexity: "standard"
version: 1.0.0
related-issue: 123
---

# Title

## Intent
EOF

write_core_paths_fixture "$TMP_ROOT/fixture-manifest" $'specs/experimental\texcluded\n'

case20_exit=0
case20_output=$( ( cd "$SCENARIO4_ROOT" && CREWRIG_REPO_DIR="$TMP_ROOT/fixture-manifest" node "$LINTER_JS" 2>&1 ) ) || case20_exit=$?
if [ "$case20_exit" -eq 0 ]; then
  echo "PASS  Case 20 — manifest-driven exclusion of a novel path (exit 0)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 20 — expected exit 0, got $case20_exit"
  echo "Output:"
  echo "$case20_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 21 — negative control for Scenario 4: same fixture, no manifest
# override → falls back to the real repo's .crewrig/core-paths.txt, which
# does not classify specs/experimental as excluded → exit 1. Proves Case 20
# passes because of the override, not a blanket skip.
# -------------------------------------------------------------------------
case21_exit=0
case21_output=$( ( cd "$SCENARIO4_ROOT" && node "$LINTER_JS" 2>&1 ) ) || case21_exit=$?
if [ "$case21_exit" -eq 1 ]; then
  echo "PASS  Case 21 — same fixture without override still fails (exit 1)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 21 — expected exit 1, got $case21_exit"
  echo "Output:"
  echo "$case21_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 22 (R9) — two original spec files sharing the same frontmatter `id`
# but distinct slugs → cross-file duplicate-id failure naming both files,
# non-zero exit. R9 requires the failure message to name both colliding
# files directly — exit code alone (as run_case checks) can't distinguish
# "failed naming both files" from "failed for an unrelated reason", so this
# inspects the captured output, mirroring Case 25's technique for the 3-file
# case.
# -------------------------------------------------------------------------
spec22a="0042-collision-a.md"
spec22b="0042-collision-b.md"
render_spec "0042" "collision-a" "draft" > "$TMP_ROOT/$spec22a"
render_spec "0042" "collision-b" "draft" > "$TMP_ROOT/$spec22b"

case22_exit=0
case22_output=$( ( cd "$TMP_ROOT" && node "$LINTER_JS" $spec22a $spec22b 2>&1 ) ) || case22_exit=$?
if [ "$case22_exit" -eq 1 ] \
  && echo "$case22_output" | grep -qF "$spec22a" \
  && echo "$case22_output" | grep -qF "$spec22b" \
  && echo "$case22_output" | grep -q 'Duplicate spec id "0042"'; then
  echo "PASS  Case 22 — duplicate id across two original specs names both files (exit 1)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 22 — expected exit 1 naming both files and the shared id, got exit $case22_exit"
  echo "Output:"
  echo "$case22_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 23 (R10) — a delta-spec file sharing its parent's `id` is NOT a
# duplicate-id collision → exit 0.
# -------------------------------------------------------------------------
spec23a="0043-parent.md"
spec23b="0043-parent.delta-01.md"
render_spec "0043" "parent" "draft" > "$TMP_ROOT/$spec23a"
render_spec "0043" "parent" "draft" "standard" "" "$(printf "## ADDED\n\n## MODIFIED\n\n## REMOVED")" > "$TMP_ROOT/$spec23b"
run_case "Case 23 — delta spec sharing parent id is not a duplicate-id failure" "$spec23a $spec23b" 0

# -------------------------------------------------------------------------
# Case 24 (R11) — all-distinct ids across specs → clean pass, exit 0.
# -------------------------------------------------------------------------
spec24a="0044-first.md"
spec24b="0045-second.md"
render_spec "0044" "first" "draft" > "$TMP_ROOT/$spec24a"
render_spec "0045" "second" "draft" > "$TMP_ROOT/$spec24b"
run_case "Case 24 — distinct ids across specs pass" "$spec24a $spec24b" 0

# -------------------------------------------------------------------------
# Case 25 (R2, R3) — three original spec files sharing the same id → the
# failure names every file in the colliding group, not only the first two
# encountered. Case 22 only proves the 2-file case; R3 explicitly calls out
# the 3-or-more case as a distinct requirement, and only checking the exit
# code (as run_case does) can't prove every path got named, so this case
# inspects the captured output directly.
# -------------------------------------------------------------------------
spec25a="0050-triple-a.md"
spec25b="0050-triple-b.md"
spec25c="0050-triple-c.md"
render_spec "0050" "triple-a" "draft" > "$TMP_ROOT/$spec25a"
render_spec "0050" "triple-b" "draft" > "$TMP_ROOT/$spec25b"
render_spec "0050" "triple-c" "draft" > "$TMP_ROOT/$spec25c"

case25_exit=0
case25_output=$( ( cd "$TMP_ROOT" && node "$LINTER_JS" $spec25a $spec25b $spec25c 2>&1 ) ) || case25_exit=$?
if [ "$case25_exit" -eq 1 ] \
  && echo "$case25_output" | grep -qF "$spec25a" \
  && echo "$case25_output" | grep -qF "$spec25b" \
  && echo "$case25_output" | grep -qF "$spec25c"; then
  echo "PASS  Case 25 — three-way id collision names every colliding file (exit 1)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 25 — expected exit 1 naming all three files, got exit $case25_exit"
  echo "Output:"
  echo "$case25_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 26 (R5, cross-file) — a spec file excluded by the core-paths manifest
# (mirrors Case 20's specs/experimental fixture) shares its id with a real,
# non-excluded spec. The manifest exclusion must be applied before the
# fileResults accumulation that feeds the new duplicate-id check, not only
# in the old per-file loop — so this must NOT be reported as a collision.
# -------------------------------------------------------------------------
SCENARIO26_ROOT="$TMP_ROOT/scenario26"
mkdir -p "$SCENARIO26_ROOT/specs/experimental"
cp "$ROOT_DIR/.markdownlintrc" "$SCENARIO26_ROOT/"
ln -s "$ROOT_DIR/node_modules" "$SCENARIO26_ROOT/node_modules"
render_spec "0071" "real" "draft" > "$SCENARIO26_ROOT/specs/0071-real.md"
render_spec "0071" "twin" "draft" > "$SCENARIO26_ROOT/specs/experimental/0071-twin.md"

write_core_paths_fixture "$TMP_ROOT/fixture-manifest-26" $'specs/experimental\texcluded\n'

case26_exit=0
case26_output=$( ( cd "$SCENARIO26_ROOT" && CREWRIG_REPO_DIR="$TMP_ROOT/fixture-manifest-26" node "$LINTER_JS" specs 2>&1 ) ) || case26_exit=$?
if [ "$case26_exit" -eq 0 ] && ! echo "$case26_output" | grep -q "Duplicate spec id"; then
  echo "PASS  Case 26 — manifest-excluded file sharing an id with a real spec is not a duplicate (R5)"
  pass=$((pass + 1))
else
  echo "FAIL  Case 26 — expected exit 0 with no duplicate-id finding, got exit $case26_exit"
  echo "Output:"
  echo "$case26_output"
  fail=$((fail + 1))
fi

# Negative control for Case 26: same fixture, no manifest override → falls
# back to the real repo's .crewrig/core-paths.txt, which does not classify
# specs/experimental as excluded → the id collision IS reported. Proves
# Case 26 passes because of the exclusion applying to the new check, not
# because the check is silently broken.
case26b_exit=0
case26b_output=$( ( cd "$SCENARIO26_ROOT" && node "$LINTER_JS" specs 2>&1 ) ) || case26b_exit=$?
if [ "$case26b_exit" -eq 1 ] && echo "$case26b_output" | grep -q 'Duplicate spec id "0071"'; then
  echo "PASS  Case 26b — negative control: without the exclusion override the 0071 collision is reported"
  pass=$((pass + 1))
else
  echo "FAIL  Case 26b — expected exit 1 reporting the 0071 collision, got exit $case26b_exit"
  echo "Output:"
  echo "$case26b_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Case 27 — a file whose frontmatter fails to parse (own per-file error) must
# NOT leak a stale/fallback `id` into the cross-file comparison. Regression
# guard: if a future change ever defaulted `id` to the filename-derived
# prefix on a parse failure, this file (filename-prefixed "0072", same as
# spec27b's real id) would spuriously collide with spec27b. Exit code alone
# can't distinguish "failed for its own YAML error" from "failed AND wrongly
# flagged as a duplicate", so this inspects the output for the absence of
# the duplicate-id message.
# -------------------------------------------------------------------------
spec27a="0072-broken.md"
spec27b="0072-good.md"
cat <<'EOF' > "$TMP_ROOT/$spec27a"
---
id: "0072
slug: broken
status: draft
complexity: standard
version: 1.0.0
related-issue: 1
---

# Title

## Intent

## Requirements

## Scenarios

## Out of scope

## Open questions
EOF
render_spec "0072" "good" "draft" > "$TMP_ROOT/$spec27b"

case27_exit=0
case27_output=$( ( cd "$TMP_ROOT" && node "$LINTER_JS" $spec27a $spec27b 2>&1 ) ) || case27_exit=$?
if [ "$case27_exit" -eq 1 ] \
  && echo "$case27_output" | grep -q "Failed to parse YAML frontmatter" \
  && ! echo "$case27_output" | grep -q "Duplicate spec id"; then
  echo "PASS  Case 27 — unparseable frontmatter does not leak a stale id into the cross-file check"
  pass=$((pass + 1))
else
  echo "FAIL  Case 27 — expected exit 1 from the per-file YAML error only, got exit $case27_exit"
  echo "Output:"
  echo "$case27_output"
  fail=$((fail + 1))
fi

# -------------------------------------------------------------------------
# Cases 28-33 (spec 0109) — the base-branch `status: draft` check. Unlike every
# case above, these need a real repository with a real base branch, so they
# build a throwaway one (mirroring new_repo() in
# scripts/tests/test-check-skill-versions.sh:54-66) instead of reusing the flat
# non-git fixtures in $TMP_ROOT. The branch name is pinned with
# `git symbolic-ref` rather than `git init -b`, so the fixture does not depend
# on the host's `init.defaultBranch`.
# -------------------------------------------------------------------------
GITFIX="$TMP_ROOT/gitfix"
mkdir -p "$GITFIX/specs"
cp "$ROOT_DIR/.markdownlintrc" "$GITFIX/"
ln -s "$ROOT_DIR/node_modules" "$GITFIX/node_modules"
(
  cd "$GITFIX" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
)

# Base-branch content: one non-delta spec and one delta-spec, both `draft`.
render_spec "0200" "on-base" "draft" > "$GITFIX/specs/0200-on-base.md"
render_spec "0201" "on-base-delta" "draft" "standard" "" \
  "$(printf "## ADDED\n\n## MODIFIED\n\n## REMOVED")" \
  > "$GITFIX/specs/0201-on-base-delta.delta-01.md"
(
  cd "$GITFIX" || exit 1
  git add specs
  git commit -q -m "base branch content"
  # A remote-tracking `origin/main` so the default base-ref derivation
  # (mirroring scripts/check-skill-versions.sh:24) has something to resolve.
  git remote add origin "$GITFIX"
  git fetch -q origin 2>/dev/null
)

# run_base_case <name> <workdir> <targets> <expected_exit> <base_ref|-> <must_contain|-> <must_not_contain|->
# `-` for base_ref runs with BASE_REF explicitly *unset* (exercising the
# default derivation) rather than inheriting an ambient value from the caller.
run_base_case() {
  local name="$1" workdir="$2" targets="$3" expected_exit="$4"
  local base_ref="$5" must="$6" must_not="$7"

  local actual_exit=0 output ok=true
  if [ "$base_ref" = "-" ]; then
    output=$( ( cd "$workdir" && env -u BASE_REF node "$LINTER_JS" $targets 2>&1 ) ) || actual_exit=$?
  else
    output=$( ( cd "$workdir" && BASE_REF="$base_ref" node "$LINTER_JS" $targets 2>&1 ) ) || actual_exit=$?
  fi

  if [ "$actual_exit" -ne "$expected_exit" ]; then
    ok=false
  fi
  if [ "$must" != "-" ] && ! echo "$output" | grep -qF "$must"; then
    ok=false
  fi
  if [ "$must_not" != "-" ] && echo "$output" | grep -qF "$must_not"; then
    ok=false
  fi

  if [ "$ok" = true ]; then
    echo "PASS  $name (exit $actual_exit)"
    pass=$((pass + 1))
  else
    echo "FAIL  $name (expected exit $expected_exit, got $actual_exit)"
    echo "Output:"
    echo "$output"
    fail=$((fail + 1))
  fi
}

# -------------------------------------------------------------------------
# Case 28 (R2, Scenarios 1 and 3) — a non-delta spec present on the base
# branch carrying `status: draft` is reported by name and fails; the
# delta-spec sitting beside it, equally `draft` and equally on the base
# branch, is NOT reported. One assertion covers both scenarios because the
# exempt file and the flagged file are in the same invocation — an exit code
# alone could not distinguish "flagged the right file" from "flagged both".
#
# This is the case R8 requires: delete the base-branch check from
# spec-linter.js and this case goes red (exit 0, no offender named).
# -------------------------------------------------------------------------
run_base_case "Case 28 — draft non-delta spec on the base branch fails and is named" \
  "$GITFIX" "specs" 1 "main" \
  "specs/0200-on-base.md" "specs/0201-on-base-delta.delta-01.md"

# -------------------------------------------------------------------------
# Case 29 (R2) — same violation, but with BASE_REF unset so the base ref comes
# from the default derivation (first remote matching crewrig|origin, plus
# `/main`). Pins the path CI uses on a `push` event, where no BASE_REF is
# supplied; without this the derivation could rot unnoticed behind the
# explicit-BASE_REF cases.
# -------------------------------------------------------------------------
run_base_case "Case 29 — default base-ref derivation (origin/main) enforces the check" \
  "$GITFIX" "specs" 1 "-" \
  "specs/0200-on-base.md" "-"

# -------------------------------------------------------------------------
# Case 30 (R4, Scenario 4) — correcting the offending spec's status in the
# tree under test clears the violation, even though the base branch still
# carries `draft`. This is what lets the check and the corpus correction land
# in a single change (R6): the status read is the tree's, not the base's.
# -------------------------------------------------------------------------
render_spec "0200" "on-base" "implemented" "standard" "interaction-mode: INTERMEDIATE" \
  > "$GITFIX/specs/0200-on-base.md"
run_base_case "Case 30 — correcting the status in the tree clears the violation" \
  "$GITFIX" "specs" 0 "main" "-" "-"

# -------------------------------------------------------------------------
# Case 31 (R2, Scenario 2) — a spec introduced by the change under test
# (absent from the base branch) is legitimately `draft` and is not flagged.
# -------------------------------------------------------------------------
render_spec "0202" "introduced-by-change" "draft" > "$GITFIX/specs/0202-introduced-by-change.md"
run_base_case "Case 31 — a spec absent from the base branch may be draft" \
  "$GITFIX" "specs" 0 "main" "-" "specs/0202-introduced-by-change.md"

# -------------------------------------------------------------------------
# Case 32 — inside a repository whose base ref cannot be resolved, the linter
# fails closed with exit 2 (an environment fault, distinct from its own exit-1
# lint findings) rather than passing unchecked. Pins the deliberate choice:
# a resolvable repository with an unresolvable base is a wiring fault, and
# reporting it green would restore the "green does not mean checked" defect
# spec 0109 exists to remove.
# -------------------------------------------------------------------------
run_base_case "Case 32 — unresolvable base ref inside a repository fails closed (exit 2)" \
  "$GITFIX" "specs" 2 "no-such-base" "BASE_REF" "-"

# -------------------------------------------------------------------------
# Case 33 — outside any git work tree there is no change under test and so no
# base branch to be the discriminator: the check is skipped, and says so on
# stderr. Pins the other half of the Case 32 decision — the skip is
# deliberate and announced, never silent. Uses its own isolated root so the
# non-conforming fixtures in $TMP_ROOT/specs cannot influence the exit code.
# -------------------------------------------------------------------------
SCENARIO33_ROOT="$TMP_ROOT/scenario33"
mkdir -p "$SCENARIO33_ROOT/specs"
cp "$ROOT_DIR/.markdownlintrc" "$SCENARIO33_ROOT/"
ln -s "$ROOT_DIR/node_modules" "$SCENARIO33_ROOT/node_modules"
render_spec "0203" "outside-any-repo" "draft" > "$SCENARIO33_ROOT/specs/0203-outside-any-repo.md"
run_base_case "Case 33 — outside a git work tree the check skips and announces it" \
  "$SCENARIO33_ROOT" "specs" 0 "main" "Base-branch status check" "-"

# -------------------------------------------------------------------------
# Case 34 — a linted path that cannot be canonicalized (here: a dangling
# symlink under specs/) is reported by name, not as an uncaught stack trace
# from the base-branch check's `realpathSync`. The exit code alone cannot pin
# this: an uncaught throw ALSO exits non-zero, so the regression is invisible
# to an exit-code assertion. The two content assertions are what discriminate
# — the offending path must be named in the linter's own voice, and the
# stack-frame marker of the crash must be absent. Uses its own isolated root
# so the dangling symlink cannot leak into the cases above.
# -------------------------------------------------------------------------
SCENARIO34_ROOT="$TMP_ROOT/scenario34"
mkdir -p "$SCENARIO34_ROOT/specs"
cp "$ROOT_DIR/.markdownlintrc" "$SCENARIO34_ROOT/"
ln -s "$ROOT_DIR/node_modules" "$SCENARIO34_ROOT/node_modules"
render_spec "0204" "beside-a-dangling-symlink" "draft" \
  > "$SCENARIO34_ROOT/specs/0204-beside-a-dangling-symlink.md"
ln -s "./no-such-target.md" "$SCENARIO34_ROOT/specs/0205-dangling.md"
(
  cd "$SCENARIO34_ROOT" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git add specs
  git commit -q -m "content with a dangling symlink"
)
run_base_case "Case 34 — an uncanonicalizable linted path is named, not a stack trace" \
  "$SCENARIO34_ROOT" "specs" 1 "main" \
  "Cannot resolve linted path: specs/0205-dangling.md" "at resolveBaseContext"

# -------------------------------------------------------------------------
# Cases 35-37 (delta-02 R13, covering R10, R9 and the R2 replacement) —
# ATTRIBUTION. Identification is settled by the cases above; these pin who the
# identified violation is charged to.
#
# A second git fixture, not $GITFIX: that one's work tree was mutated by cases
# 30-31 (0200 corrected to `implemented`, 0202 added), and these cases need a
# base-branch offender still carrying `draft` in the tree under test. Built the
# same way — `git symbolic-ref` rather than `git init -b`, so the fixture does
# not depend on the host's init.defaultBranch.
#
# The three cases share this one fixture but do NOT depend on each other's
# order: each one RESETS the work tree (`git checkout -- .`) and then applies
# only the state it needs. An accumulating variant would pass just as green while
# measuring something other than what the case names claim the moment anyone
# inserts or reorders a case — an order-dependent test that silently changes
# meaning is the same class of defect as the check being fixed here.
# -------------------------------------------------------------------------
GITFIX2="$TMP_ROOT/gitfix2"
mkdir -p "$GITFIX2/specs" "$GITFIX2/docs"
cp "$ROOT_DIR/.markdownlintrc" "$GITFIX2/"
ln -s "$ROOT_DIR/node_modules" "$GITFIX2/node_modules"
render_spec "0210" "attributed" "draft" > "$GITFIX2/specs/0210-attributed.md"
printf '# Unrelated\n\nBody.\n' > "$GITFIX2/docs/unrelated.md"
(
  cd "$GITFIX2" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git add specs docs
  git commit -q -m "base branch content"
)

# -------------------------------------------------------------------------
# Case 35 (delta-02 R10) — the tree under test modifies nothing relative to the
# base ref, which is exactly the state the check runs in on the base branch's
# own build (`HEAD` IS the derived base there). With no change to attribute the
# violation to, every offender blocks. This is the case that keeps R1
# mechanically enforced after R9 narrows the pull-request case: remove the
# empty-set branch and the base branch's build goes green while `main` violates
# the invariant.
# -------------------------------------------------------------------------
git -C "$GITFIX2" checkout -q -- .
run_base_case "Case 35 — no change relative to the base ref blocks on every offender (R10)" \
  "$GITFIX2" "specs" 1 "main" \
  "specs/0210-attributed.md" "[WARN]"

# -------------------------------------------------------------------------
# Case 36 (delta-02 R9) — the change under test modifies an unrelated file, so
# the offender is named as a NON-BLOCKING finding and the run passes. This is
# the case the ticket exists for: the pull request that touches no spec is no
# longer failed by a violation it cannot cure. Asserts both halves — the warning
# is present AND no `[FAIL]` block is — because exit 0 alone could not
# distinguish "warned correctly" from "stopped checking".
# -------------------------------------------------------------------------
git -C "$GITFIX2" checkout -q -- .
printf '# Unrelated\n\nBody, edited by the change under test.\n' > "$GITFIX2/docs/unrelated.md"
run_base_case "Case 36 — an offender the change does not touch warns, and does not fail (R9)" \
  "$GITFIX2" "specs" 0 "main" \
  "[WARN]" "[FAIL]"

# -------------------------------------------------------------------------
# Case 37 (delta-02 R2 as replaced) — the change under test modifies the
# offending spec itself and leaves it `draft`. It can record the correct status
# in the same edit, so it is the change that pays. Together with Case 36 this
# pins the replaced R2's discriminator: same offender, same base branch, and the
# outcome turns only on whether the change touches the file.
# -------------------------------------------------------------------------
git -C "$GITFIX2" checkout -q -- .
printf '\nEdited by the change under test.\n' >> "$GITFIX2/specs/0210-attributed.md"
run_base_case "Case 37 — an offender the change does touch fails (R2 as replaced)" \
  "$GITFIX2" "specs" 1 "main" \
  "specs/0210-attributed.md" "[WARN]"

# -------------------------------------------------------------------------
# Case 38 (delta-02 R11) — attribution that cannot be derived is not an
# exemption. The base ref resolves (so this is NOT the Case 32 wiring fault, and
# the exit is the linter's own 1 rather than 2), but it shares no history with
# `HEAD`, so `git merge-base` fails and the modified-file set is unavailable.
# Every offender blocks, and the cause is named on stderr rather than left as an
# unexplained failure.
#
# An orphan branch is the cheapest reproduction of "resolves but has no common
# ancestor"; `git checkout --orphan` keeps the index, so the same specs are
# committed onto it and the offender is present on the base ref as required.
# -------------------------------------------------------------------------
GITFIX3="$TMP_ROOT/gitfix3"
mkdir -p "$GITFIX3/specs"
cp "$ROOT_DIR/.markdownlintrc" "$GITFIX3/"
ln -s "$ROOT_DIR/node_modules" "$GITFIX3/node_modules"
render_spec "0220" "unrelated-history" "draft" > "$GITFIX3/specs/0220-unrelated-history.md"
(
  cd "$GITFIX3" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git add specs
  git commit -q -m "main content"
  git checkout -q --orphan unrelated-base
  # `git add specs`, never `git add -A`: the harness's own scaffolding sits in
  # this directory untracked (.markdownlintrc, the node_modules symlink), and
  # tracking it on the orphan branch makes the `checkout main` below DELETE it —
  # markdownlint then dies on a missing config, which reads as a lint failure
  # rather than as the fixture eating its own tooling.
  git add specs
  git commit -q -m "orphan base sharing no history with main"
  git checkout -q main
)
run_base_case "Case 38 — attribution that cannot be derived blocks, and says so (R11)" \
  "$GITFIX3" "specs" 1 "unrelated-base" \
  "could not be derived" "[WARN]"

# -------------------------------------------------------------------------
# Cases 39-40 (delta-03 R16, covering R14/R15) — WORKING-DIRECTORY INDEPENDENCE.
#
# Both cases assert on `Non-delta specs present on the base branch` — the banner
# only this check emits — and NOT on the offending file's path. The path is also
# printed by markdownlint on any rule violation in the fixture, and markdownlint's
# own failure is exit 1, so a fixture that drifts out of conformance would satisfy
# a path-plus-exit-code assertion while the check never executed. Measured: with
# an MD001 violation injected and run against a linter WITHOUT the fix, exit is 1
# and the path appears. For cases guarding a check whose defect was passing
# without checking, that is the one false-pass that must not be possible. The
# fixture holds exactly one spec, so asserting the banner loses no identity.
#
# A fixture whose specs AND markdownlint configuration both sit under `sub/`.
# The nested configuration is not incidental: `-c .markdownlintrc` is resolved
# against the working directory, so without a config there the run dies at
# markdownlint and never reaches the check. That is exactly why this defect was
# first believed unreachable, and it is what these cases exist to keep reachable.
# -------------------------------------------------------------------------
GITFIX4="$TMP_ROOT/gitfix4"
mkdir -p "$GITFIX4/sub/specs"
cp "$ROOT_DIR/.markdownlintrc" "$GITFIX4/sub/"
ln -s "$ROOT_DIR/node_modules" "$GITFIX4/sub/node_modules"
render_spec "0240" "nested-layout" "draft" > "$GITFIX4/sub/specs/0240-nested-layout.md"
(
  cd "$GITFIX4" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git add sub/specs
  git commit -q -m "draft non-delta spec on the base branch, under sub/"
)

# -------------------------------------------------------------------------
# Case 39 (R14) — the offender is identified when the linter runs from a
# SUBDIRECTORY. Before delta-03, `git ls-tree` resolved the repo-root-relative
# pathspec against the working directory, matched nothing, and returned an empty
# set — so no file was ever identified as present on the base branch and the run
# reported `Linting passed!` with exit 0 on a live violation. Remove the
# `gitCwd = repoRoot` assignment and this case goes red.
# -------------------------------------------------------------------------
git -C "$GITFIX4" checkout -q -- .
git -C "$GITFIX4" config --unset-all diff.relative 2>/dev/null || true
run_base_case "Case 39 — an offender is identified from a subdirectory (R14)" \
  "$GITFIX4/sub" "specs" 1 "main" \
  "Non-delta specs present on the base branch" "-"

# -------------------------------------------------------------------------
# Case 40 (R14, the attribution half) — same subdirectory run, with
# `diff.relative=true` and the offending spec MODIFIED in the tree. It must fail,
# because a change that touches the offender is the change that pays
# (delta-02 R2 as replaced).
#
# This is the case that discriminates a PARTIAL fix, which is why it exists
# alongside Case 39: pin `ls-tree` alone and the offender is identified, but
# `git diff` still reports `specs/0240-nested-layout.md` relative to `sub/`, the
# `changed` set never matches `sub/specs/0240-nested-layout.md`, the offender
# degrades to a bystander, and the run passes with a [WARN]. Hence the assertion
# on the ABSENCE of [WARN] rather than on the exit code alone.
#
# It does not isolate the `diff` derivation from the `ls-tree` one — that is not
# observable through the command line, since the only working directory where
# `diff` misbehaves is one where `ls-tree` has already returned nothing. Stated
# rather than implied, so the case is not read as stronger than it is.
#
# Like cases 35-37 on $GITFIX2, these two do NOT depend on each other's order:
# each resets the work tree and the `diff.relative` setting, then applies only
# what it measures. A third case added here inherits neither.
# -------------------------------------------------------------------------
git -C "$GITFIX4" checkout -q -- .
git -C "$GITFIX4" config diff.relative true
printf '\nEdited by the change under test.\n' >> "$GITFIX4/sub/specs/0240-nested-layout.md"
run_base_case "Case 40 — attribution stays root-anchored under diff.relative (R14)" \
  "$GITFIX4/sub" "specs" 1 "main" \
  "Non-delta specs present on the base branch" "[WARN]"

# -------------------------------------------------------------------------
# Case 41 — Leaked tool scaffolding tags outside code blocks → exit 1
# -------------------------------------------------------------------------
spec41="0041-leaked-scaffolding.md"
headings41=$(printf "## Intent\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions\n\n</content>\n</invoke>")
render_spec "0041" "leaked-scaffolding" "draft" "standard" "" "$headings41" > "$TMP_ROOT/$spec41"
run_case "Case 41 — leaked tool scaffolding fails" "$spec41" 1

# -------------------------------------------------------------------------
# Case 42 — Tool scaffolding tags inside fenced code block → exit 0
# -------------------------------------------------------------------------
spec42="0042-fenced-scaffolding.md"
headings42=$(printf "## Intent\n\n\`\`\`text\n</content>\n</invoke>\n\`\`\`\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions")
render_spec "0042" "fenced-scaffolding" "draft" "standard" "" "$headings42" > "$TMP_ROOT/$spec42"
run_case "Case 42 — tool scaffolding inside fenced code block passes" "$spec42" 0

# -------------------------------------------------------------------------
# Case 43 — Tool scaffolding tags in inline code spans → exit 0
# -------------------------------------------------------------------------
spec43="0043-inline-scaffolding.md"
headings43=$(printf "## Intent\n\nRefers to \`</content>\` and \`</invoke>\` tags.\n\n## Requirements\n\n## Scenarios\n\n## Out of scope\n\n## Open questions")
render_spec "0043" "inline-scaffolding" "draft" "standard" "" "$headings43" > "$TMP_ROOT/$spec43"
run_case "Case 43 — tool scaffolding in inline code span passes" "$spec43" 0

# -------------------------------------------------------------------------
# Cases 44-48 (spec 0168 R1, R2) — AUTOMATED STATUS TRANSITION ENFORCEMENT
# -------------------------------------------------------------------------
GITFIX5="$TMP_ROOT/gitfix5"
mkdir -p "$GITFIX5/specs" "$GITFIX5/docs"
cp "$ROOT_DIR/.markdownlintrc" "$GITFIX5/"
ln -s "$ROOT_DIR/node_modules" "$GITFIX5/node_modules"
render_spec "0300" "base-feature" "implemented" "standard" "interaction-mode: AUTO" > "$GITFIX5/specs/0300-base-feature.md"
(
  cd "$GITFIX5" || exit 1
  git init -q
  git symbolic-ref HEAD refs/heads/main
  git config user.email "test@example.com"
  git config user.name "Test"
  git config commit.gpgsign false
  git add specs
  git commit -q -m "initial main branch"
)

# -------------------------------------------------------------------------
# Case 44 (Spec 0168 R1) — A new spec PR introducing a spec carrying `status: draft`
# fails CI when targeting the base branch.
# -------------------------------------------------------------------------
git -C "$GITFIX5" checkout -q -b spec/0301-new-feature
render_spec "0301" "new-feature" "draft" "standard" "" > "$GITFIX5/specs/0301-new-feature.md"
git -C "$GITFIX5" add specs/0301-new-feature.md
git -C "$GITFIX5" commit -q -m "add spec in draft"
run_base_case "Case 44 — new spec PR carrying draft status fails CI (spec 0168 R1)" \
  "$GITFIX5" "specs" 1 "main" \
  "Non-delta specs added or modified by this change carry 'status: draft'" "-"

# -------------------------------------------------------------------------
# Case 45 (Spec 0168 R1) — Transitioning the new spec to `status: approved` (with
# interaction-mode) passes CI on the spec PR.
# -------------------------------------------------------------------------
render_spec "0301" "new-feature" "approved" "standard" "interaction-mode: AUTO" > "$GITFIX5/specs/0301-new-feature.md"
git -C "$GITFIX5" add specs/0301-new-feature.md
git -C "$GITFIX5" commit -q -m "transition spec to approved"
run_base_case "Case 45 — new spec PR carrying approved status passes CI (spec 0168 R1)" \
  "$GITFIX5" "specs" 0 "main" \
  "-" "Non-delta specs added or modified by this change carry 'status: draft'"

# -------------------------------------------------------------------------
# Case 46 (Spec 0168 R2) — An implementation PR on branch feat/0302-cool-feature
# whose spec still carries `status: approved` fails CI.
# -------------------------------------------------------------------------
git -C "$GITFIX5" checkout -q main
render_spec "0302" "cool-feature" "approved" "standard" "interaction-mode: AUTO" > "$GITFIX5/specs/0302-cool-feature.md"
git -C "$GITFIX5" add specs/0302-cool-feature.md
git -C "$GITFIX5" commit -q -m "merge spec 0302 to main"
git -C "$GITFIX5" checkout -q -b feat/0302-cool-feature
printf 'console.log("implemented");\n' > "$GITFIX5/docs/feature.js"
git -C "$GITFIX5" add docs/feature.js
git -C "$GITFIX5" commit -q -m "implement feature without updating spec status"
run_base_case "Case 46 — implementation PR without status: implemented fails CI (spec 0168 R2)" \
  "$GITFIX5" "specs" 1 "main" \
  "matches spec id '0302', but specification" "-"

# -------------------------------------------------------------------------
# Case 47 (Spec 0168 R2) — An implementation PR that transitions the spec to
# `status: implemented` passes CI.
# -------------------------------------------------------------------------
render_spec "0302" "cool-feature" "implemented" "standard" "interaction-mode: AUTO" > "$GITFIX5/specs/0302-cool-feature.md"
git -C "$GITFIX5" add specs/0302-cool-feature.md
git -C "$GITFIX5" commit -q -m "transition spec 0302 to implemented"
run_base_case "Case 47 — implementation PR with status: implemented passes CI (spec 0168 R2)" \
  "$GITFIX5" "specs" 0 "main" \
  "-" "matches spec id '0302'"

# -------------------------------------------------------------------------
# Case 48 (Spec 0168 R2) — An implementation branch for a ticket that has no
# matching spec file in specs/ (e.g. non-spec bug fix) is a clean pass.
# -------------------------------------------------------------------------
git -C "$GITFIX5" checkout -q main
git -C "$GITFIX5" checkout -q -b fix/0999-no-such-spec
mkdir -p "$GITFIX5/docs"
printf 'console.log("fix");\n' > "$GITFIX5/docs/fix.js"
git -C "$GITFIX5" add docs/fix.js
git -C "$GITFIX5" commit -q -m "fix non-spec issue"
run_base_case "Case 48 — implementation branch with no matching spec file passes (spec 0168 R2)" \
  "$GITFIX5" "specs" 0 "main" \
  "-" "matches spec id"

# -------------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]


