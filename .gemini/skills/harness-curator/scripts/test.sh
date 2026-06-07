#!/bin/bash
# artifacts/library/skills/harness-curator/scripts/test.sh
#   Smoke test for the bundled curate.sh.
#
# Feeds the fixture at ../assets/sample-frictions.json through
# `scripts/curate.sh --from-stdin --dry-run` (skill-relative paths) and
# asserts on the JSON output. Does not touch MemPalace or `gh` — pure
# offline test. Runs unchanged from any install location since all
# paths are resolved relative to this script's directory.
#
# Exit 0 on pass, non-zero with explanation on fail.

set -euo pipefail

# Paths are resolved relative to this script's location so the test runs
# from anywhere the skill is installed (project-level OR user-level).
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$SKILL_DIR/assets/sample-frictions.json"
SCRIPT="$SKILL_DIR/scripts/curate.sh"

[ -f "$FIXTURE" ] || { echo "FAIL: fixture missing: $FIXTURE" >&2; exit 1; }
[ -x "$SCRIPT" ] || chmod +x "$SCRIPT"

# `jq` is the assertion helper — it is the project's standard JSON tool
# (already required by build-components.sh per its prerequisites).
command -v jq >/dev/null 2>&1 || {
  echo "FAIL: jq is required for test assertions" >&2
  exit 1
}

# `python3` covers the --from-stdin path even without the mempalace pipx
# venv. The script auto-falls back to it.
command -v python3 >/dev/null 2>&1 || {
  echo "FAIL: python3 is required" >&2
  exit 1
}

echo "Running curator on fixture..."
# Disable set -e momentarily so we can inspect a non-zero exit before
# bailing — yields a clearer failure than a bare `set -e` abort.
set +e
OUT=$(bash "$SCRIPT" --from-stdin --dry-run < "$FIXTURE")
RC=$?
set -e
if [ "$RC" -ne 0 ] || [ -z "$OUT" ]; then
  echo "FAIL: harness-curate.sh exit=$RC, stdout-len=${#OUT}" >&2
  echo "--- captured stdout ---" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi

# --- Assertions -----------------------------------------------------------

assert() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS $label"
  else
    echo "  FAIL $label — expected '$expected', got '$actual'" >&2
    return 1
  fi
}

# 10 input drawers: drw-001 through drw-010 (drw-008 exercises whitespace-only
# suggestion; drw-009 exercises routing_failures; drw-010 exercises empty block
# scalar suggestion per spec 0010).
assert "stats.total_drawers"       "10" "$(echo "$OUT" | jq -r '.stats.total_drawers')"

# 5 valid (drw-001,002,003,004,009); 4 malformed: drw-005 (no FRICTION:
# prefix), drw-006 (empty writer_agent), drw-008 (whitespace-only suggestion
# per spec 0010 R1), drw-010 (empty block scalar suggestion per spec 0010 R1).
# drw-007 is well-formed but already correlated → counted in skipped_resolved.
assert "stats.valid_frictions"     "5" "$(echo "$OUT" | jq -r '.stats.valid_frictions')"
assert "stats.skipped_malformed"   "4" "$(echo "$OUT" | jq -r '.stats.skipped_malformed')"

# Regression for issue #69: drw-007 carries `opened_as: <url>` and must be
# filtered before clustering so the curator does not re-open an issue.
assert "stats.skipped_resolved"    "1" "$(echo "$OUT" | jq -r '.stats.skipped_resolved')"

# 4 cluster keys: yq-merge, gh-body-truncation, parked-singleton,
# no-canonical-test. drw-007 is filtered upstream of clustering, so its
# subcategory must not appear as a cluster key — see the explicit assertion
# further down.
assert "stats.clusters_formed"     "4" "$(echo "$OUT" | jq -r '.stats.clusters_formed')"

# Above threshold:
#  - yq-merge (size 2, ≥ threshold)
#  - gh-body-truncation (size 1 BUT severity:high → bypass)
# Parked: parked-singleton (size 1, severity low)
assert "stats.clusters_above_threshold" "2" \
  "$(echo "$OUT" | jq -r '.stats.clusters_above_threshold')"
assert "stats.clusters_parked"     "1" "$(echo "$OUT" | jq -r '.stats.clusters_parked')"

# No routing failures from the fixture clusters that have canonical: set,
# but drw-009 (no-canonical-test) has no canonical → 1 routing failure.
assert "stats.routing_failures"    "1" "$(echo "$OUT" | jq -r '.stats.routing_failures')"

# Schema stability: clusters_truncated is always present, 0 when --max-issues
# is unset. Tests below exercise the >0 path.
assert "stats.clusters_truncated"  "0" "$(echo "$OUT" | jq -r '.stats.clusters_truncated')"

# Exactly 2 clusters in output
assert "len(.clusters)"            "2" "$(echo "$OUT" | jq -r '.clusters | length')"

# --- Spec 0010: skipped[] and routing_failures[] arrays -------------------

# skipped array: 4 malformed drawers (drw-005, drw-006, drw-008, drw-010).
# drw-007 (resolved) must NOT appear in skipped.
SKIPPED_COUNT=$(echo "$OUT" | jq -r '.skipped | length')
assert "skipped[] length"          "4" "$SKIPPED_COUNT"

# Each skipped entry has the required fields.
SKIPPED_KEYS=$(echo "$OUT" | jq -c '.skipped[0] | keys | sort')
assert "skipped[0] keys" '["drawer_id","reason","room","snippet"]' "$SKIPPED_KEYS"

# drw-008 reason is "empty_suggestion" per spec 0010 R1 (whitespace-only).
DRW8_REASON=$(echo "$OUT" | jq -r '.skipped[] | select(.drawer_id == "drw-008") | .reason')
assert "skipped drw-008 reason"    "empty_suggestion" "$DRW8_REASON"

# drw-010 reason is "empty_suggestion" per spec 0010 R1 (empty block scalar).
DRW10_REASON=$(echo "$OUT" | jq -r '.skipped[] | select(.drawer_id == "drw-010") | .reason')
assert "skipped drw-010 reason"    "empty_suggestion" "$DRW10_REASON"

# Spec 0010 scenario 3: distinct reasons in skipped. malformed drawers carry
# parse-failure-specific reasons, not a single catch-all.
SKIPPED_REASONS=$(echo "$OUT" | jq -r '[.skipped[].reason] | unique | sort | join(",")')
assert "skipped distinct reasons"  "empty_suggestion,malformed" "$SKIPPED_REASONS"

# drw-005 snippet starts with the non-FRICTION content.
DRW5_SNIPPET=$(echo "$OUT" | jq -r '.skipped[] | select(.drawer_id == "drw-005") | .snippet')
echo "$DRW5_SNIPPET" | grep -q "Not a friction" || {
  echo "FAIL: drw-005 snippet missing expected content" >&2
  exit 1
}
echo "  PASS skipped drw-005 snippet contains content"

# routing_failures: 1 entry (no-canonical-test cluster from drw-009 lacks canonical).
RF_COUNT=$(echo "$OUT" | jq -r '.routing_failures | length')
assert "routing_failures[] length" "1" "$RF_COUNT"

# routing_failures entry carries the required fields per spec 0010 R3.
RF0_KEYS=$(echo "$OUT" | jq -c '.routing_failures[0] | keys | sort')
assert "routing_failures[0] keys" '["cluster_key","frictions","reason"]' "$RF0_KEYS"

# routing_failures cluster_key and reason.
RF0_KEY=$(echo "$OUT" | jq -r '.routing_failures[0].cluster_key')
assert "routing_failures[0].cluster_key" "no-canonical-test" "$RF0_KEY"
RF0_REASON=$(echo "$OUT" | jq -r '.routing_failures[0].reason')
assert "routing_failures[0].reason" "missing_canonical" "$RF0_REASON"

# routing_failures frictions carries the single drw-009 friction.
RF0_FRICTION_COUNT=$(echo "$OUT" | jq -r '.routing_failures[0].frictions | length')
assert "routing_failures[0].frictions length" "1" "$RF0_FRICTION_COUNT"
RF0_FRICTION_TITLE=$(echo "$OUT" | jq -r '.routing_failures[0].frictions[0].title')
assert "routing_failures[0].frictions[0].title" \
  "No canonical target — cluster must route-fail visibly" "$RF0_FRICTION_TITLE"

# no-canonical-test must NOT appear in clusters[] per spec 0010 scenario 2.
NO_CANON_IN_CLUSTERS=$(echo "$OUT" | jq -c '.clusters[] | select(.cluster_key == "no-canonical-test")')
[ -z "$NO_CANON_IN_CLUSTERS" ] || {
  echo "FAIL: no-canonical-test leaked into clusters despite routing failure" >&2
  echo "$NO_CANON_IN_CLUSTERS" >&2
  exit 1
}
echo "  PASS no-canonical-test absent from clusters (routing failure)"

# yq-merge cluster — 2 frictions, target crewrig/crewrig
YQ=$(echo "$OUT" | jq -c '.clusters[] | select(.cluster_key == "yq-merge")')
[ -n "$YQ" ] || { echo "FAIL: yq-merge cluster missing" >&2; exit 1; }
assert "yq-merge.cluster_size"     "2" "$(echo "$YQ" | jq -r '.cluster_size')"
assert "yq-merge.target_repo"      "https://github.com/crewrig/crewrig" \
  "$(echo "$YQ" | jq -r '.target_repo')"

# Both yq-merge frictions came from room="prompt"; assert the room
# propagates correctly through cluster_frictions().
YQ_ROOMS=$(echo "$YQ" | jq -r '[.frictions[]._room] | unique | join(",")')
assert "yq-merge.frictions[*]._room" "prompt" "$YQ_ROOMS"

# Inline evidence (drw-002 used `evidence: <url>` form) must produce
# a single-entry list — not a parse miss.
DRW2_EVIDENCE=$(echo "$YQ" | jq -r '.frictions[] | select(.title | test("empty file")) | .evidence | length')
assert "drw-002.evidence count (inline form)" "1" "$DRW2_EVIDENCE"

# Body must contain at least one evidence pointer.
YQ_BODY=$(echo "$YQ" | jq -r '.body')
echo "$YQ_BODY" | grep -q "artifacts/core/skills/architect/SKILL.md:42" || {
  echo "FAIL: yq-merge body missing evidence pointer from drw-001" >&2
  exit 1
}
echo "  PASS yq-merge.body contains evidence"

# Body must include the date range computed from filed_at metadata.
echo "$YQ_BODY" | grep -q "2026-05-08 → 2026-05-10" || {
  echo "FAIL: yq-merge body missing date range" >&2
  echo "$YQ_BODY" >&2
  exit 1
}
echo "  PASS yq-merge.body contains date range"

# Labels: three-tuple ["harness-feedback", "room:<dominant>", "severity:<worst>"].
YQ_LABELS=$(echo "$YQ" | jq -c '.labels')
assert "yq-merge.labels" '["harness-feedback","room:prompt","severity:med"]' "$YQ_LABELS"

# No branch_name field anymore — V0 opens issues, not MRs.
YQ_HAS_BRANCH=$(echo "$YQ" | jq 'has("branch_name")')
assert "yq-merge.has(branch_name)" "false" "$YQ_HAS_BRANCH"

# High-severity singleton bypass produced its own cluster; room is "tool".
HIGH=$(echo "$OUT" | jq -c '.clusters[] | select(.cluster_key == "gh-body-truncation")')
[ -n "$HIGH" ] || { echo "FAIL: severity:high singleton not promoted" >&2; exit 1; }
HIGH_ROOM=$(echo "$HIGH" | jq -r '.frictions[0]._room')
assert "gh-body-truncation.frictions[0]._room" "tool" "$HIGH_ROOM"
echo "  PASS severity:high singleton promoted to cluster"

# severity:high label propagates on the high-severity cluster.
HIGH_LABELS=$(echo "$HIGH" | jq -c '.labels')
assert "gh-body-truncation.labels" '["harness-feedback","room:tool","severity:high"]' "$HIGH_LABELS"

# Single-day cluster: gh-body-truncation has 1 friction with one date —
# body should render the "(single day)" form, not a bare date.
HIGH_BODY=$(echo "$HIGH" | jq -r '.body')
echo "$HIGH_BODY" | grep -q "2026-05-09 (single day)" || {
  echo "FAIL: gh-body-truncation body missing single-day marker" >&2
  echo "$HIGH_BODY" >&2
  exit 1
}
echo "  PASS gh-body-truncation.body uses '(single day)' format"

# Parked singleton is NOT in the clusters output.
PARKED=$(echo "$OUT" | jq -c '.clusters[] | select(.cluster_key == "parked-singleton")')
[ -z "$PARKED" ] || { echo "FAIL: parked-singleton should be parked, not in clusters" >&2; exit 1; }
echo "  PASS parked-singleton excluded from output"

# Regression for issue #69: the resolved drawer's subcategory must never
# surface as a cluster_key. drw-007 is severity:high, so absent the
# pre-cluster skip filter it would qualify as a high-severity singleton
# bypass and pollute the output. Its absence proves the filter ran.
RESOLVED_CLUSTER=$(echo "$OUT" | jq -c '.clusters[] | select(.cluster_key == "stale-resolved-fixture")')
[ -z "$RESOLVED_CLUSTER" ] || {
  echo "FAIL: resolved drawer (drw-007) subcategory leaked into clusters" >&2
  echo "$RESOLVED_CLUSTER" >&2
  exit 1
}
echo "  PASS resolved-drawer subcategory absent from clusters"

# --- apply.py orchestration (--dry-run-apply) ----------------------------
# Pipe the curator JSON through apply.py --dry-run-apply. Each cluster
# round-trips as one JSON-array line representing the `gh issue create`
# argv that would have been invoked. The flag exists so we never need to
# stub `gh` to assert orchestration shape.
APPLY="$SKILL_DIR/scripts/apply.py"
[ -f "$APPLY" ] || { echo "FAIL: apply.py missing: $APPLY" >&2; exit 1; }

set +e
APPLY_OUT=$(printf '%s\n' "$OUT" | python3 "$APPLY" --dry-run-apply)
APPLY_RC=$?
set -e
assert "apply --dry-run-apply exit code" "0" "$APPLY_RC"

# Two qualified clusters → exactly two argv lines, no spurious output.
# (apply.py now emits a sibling object line per cluster carrying the
# would_update_drawers list — that line starts with `{`, so the `^\[`
# filter still counts only argv arrays.)
APPLY_LINES=$(printf '%s\n' "$APPLY_OUT" | grep -c '^\[')
assert "apply --dry-run-apply emits one argv line per cluster" "2" "$APPLY_LINES"

# Issue #69: alongside each argv array, apply.py emits a JSON object line
# `{"would_update_drawers": [...], "cluster_key": "..."}` so the
# orchestration shape now exposes the drawers that would receive the
# `opened_as` write-back. Two qualified clusters → two object lines.
APPLY_OBJECTS=$(printf '%s\n' "$APPLY_OUT" | jq -c 'select(type == "object" and (.would_update_drawers // null) != null)' 2>/dev/null || true)
APPLY_OBJ_COUNT=$(printf '%s\n' "$APPLY_OBJECTS" | grep -c .)
assert "apply --dry-run-apply emits one would_update_drawers object per cluster" \
  "2" "$APPLY_OBJ_COUNT"

# yq-merge object: 2 source drawers (drw-001, drw-002) propagated via _drawer_id.
YQ_OBJ=$(printf '%s\n' "$APPLY_OBJECTS" | jq -c 'select(.cluster_key == "yq-merge")')
[ -n "$YQ_OBJ" ] || { echo "FAIL: yq-merge would_update_drawers object missing" >&2; exit 1; }
assert "yq-merge would_update_drawers type"   "array"   "$(echo "$YQ_OBJ" | jq -r '.would_update_drawers | type')"
assert "yq-merge would_update_drawers length" "2"       "$(echo "$YQ_OBJ" | jq -r '.would_update_drawers | length')"
assert "yq-merge would_update_drawers cluster_key" "yq-merge" "$(echo "$YQ_OBJ" | jq -r '.cluster_key')"

# gh-body-truncation object: severity:high singleton → exactly 1 drawer (drw-003).
HIGH_OBJ=$(printf '%s\n' "$APPLY_OBJECTS" | jq -c 'select(.cluster_key == "gh-body-truncation")')
[ -n "$HIGH_OBJ" ] || { echo "FAIL: gh-body-truncation would_update_drawers object missing" >&2; exit 1; }
assert "gh-body-truncation would_update_drawers cluster_key" "gh-body-truncation" \
  "$(echo "$HIGH_OBJ" | jq -r '.cluster_key')"
assert "gh-body-truncation would_update_drawers length" "1" \
  "$(echo "$HIGH_OBJ" | jq -r '.would_update_drawers | length')"

# Helper jq filter: collect all `--label <value>` pairs as a list, in order.
LABELS_FILTER='[. as $a | range(length) | select($a[.] == "--label") | $a[.+1]]'

# yq-merge argv shape: gh issue create against the stripped repo slug,
# carrying the cluster title and the full three-label tuple in order.
YQ_TITLE=$(echo "$YQ" | jq -r '.title')
YQ_ARGV=$(printf '%s\n' "$APPLY_OUT" | jq -c --arg t "$YQ_TITLE" \
  'select(type == "array" and (index($t) != null))')
[ -n "$YQ_ARGV" ] || { echo "FAIL: yq-merge argv line not found in apply output" >&2; exit 1; }
assert "yq-merge argv head" '["gh","issue","create"]' \
  "$(echo "$YQ_ARGV" | jq -c '.[0:3]')"
assert "yq-merge argv --repo (prefix stripped)" "crewrig/crewrig" \
  "$(echo "$YQ_ARGV" | jq -r '.[(index("--repo"))+1]')"
assert "yq-merge argv labels" '["harness-feedback","room:prompt","severity:med"]' \
  "$(echo "$YQ_ARGV" | jq -c "$LABELS_FILTER")"

# gh-body-truncation argv: same structural checks, severity:high labels.
HIGH_TITLE=$(echo "$HIGH" | jq -r '.title')
HIGH_ARGV=$(printf '%s\n' "$APPLY_OUT" | jq -c --arg t "$HIGH_TITLE" \
  'select(type == "array" and (index($t) != null))')
[ -n "$HIGH_ARGV" ] || { echo "FAIL: gh-body-truncation argv line not found" >&2; exit 1; }
assert "gh-body-truncation argv head" '["gh","issue","create"]' \
  "$(echo "$HIGH_ARGV" | jq -c '.[0:3]')"
assert "gh-body-truncation argv --repo (prefix stripped)" "crewrig/crewrig" \
  "$(echo "$HIGH_ARGV" | jq -r '.[(index("--repo"))+1]')"
assert "gh-body-truncation argv labels" '["harness-feedback","room:tool","severity:high"]' \
  "$(echo "$HIGH_ARGV" | jq -c "$LABELS_FILTER")"

# No-clusters branch: empty .clusters yields the friendly notice, exit 0.
EMPTY_JSON='{"stats":{"total_drawers":0,"valid_frictions":0,"skipped_malformed":0,"clusters_formed":0,"clusters_above_threshold":0,"clusters_parked":0,"routing_failures":0},"clusters":[],"skipped":[],"routing_failures":[]}'
set +e
EMPTY_OUT=$(printf '%s\n' "$EMPTY_JSON" | python3 "$APPLY" --dry-run-apply)
EMPTY_RC=$?
set -e
assert "apply --dry-run-apply empty clusters exit code" "0" "$EMPTY_RC"
echo "$EMPTY_OUT" | grep -q "No clusters above threshold; no issues to open." || {
  echo "FAIL: empty-clusters notice missing" >&2
  echo "$EMPTY_OUT" >&2
  exit 1
}
echo "  PASS apply --dry-run-apply emits no-clusters notice"

# --- Auto mode (#42): dedup_match wire shape ------------------------------
# Without --dedup, apply.py must still emit a dedup_match object line per
# cluster carrying `null`, keeping the wire shape uniform across modes.
# With --dedup but no matching open issue (or a `gh` failure), the dedup
# probe fails open and dedup_match is null. We can't safely assert the
# match-found case offline without stubbing `gh`, so this regression
# focuses on the always-emitted shape.
APPLY_DEDUP_OBJECTS=$(printf '%s\n' "$APPLY_OUT" | jq -c 'select(type == "object" and has("dedup_match"))' 2>/dev/null || true)
APPLY_DEDUP_COUNT=$(printf '%s\n' "$APPLY_DEDUP_OBJECTS" | grep -c .)
assert "apply --dry-run-apply emits one dedup_match object per cluster" \
  "2" "$APPLY_DEDUP_COUNT"

# Both dedup_match values must be null in the baseline (no --dedup, no
# live `gh` probe). jq emits 'null' (4 chars) for JSON null.
APPLY_DEDUP_NONNULL=$(printf '%s\n' "$APPLY_DEDUP_OBJECTS" \
  | jq -rc 'select(.dedup_match != null)' | grep -c . || true)
assert "apply (no --dedup): all dedup_match values are null" \
  "0" "$APPLY_DEDUP_NONNULL"

# --- Auto mode (#42): --max-issues truncation ----------------------------
# Synthesize 7 qualifying frictions across distinct subcategories with mixed
# severities, then run curate with --max-issues 3 and assert the output
# carries 3 clusters in the documented order (severity high → med → low,
# size desc, key asc as tie-breaker) plus stats.clusters_truncated == 4.

MAX_FIXTURE=$(mktemp -t crewrig-max.XXXXXX)
trap 'rm -f "$MAX_FIXTURE"' EXIT
cat > "$MAX_FIXTURE" <<'JSON'
[
  {"drawer_id":"m-1","room":"prompt","content":"FRICTION: low-A\n\nwriter_agent: t\nsubcategory: aaa-low\ncanonical: https://github.com/crewrig/crewrig\nseverity: low\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-2","room":"prompt","content":"FRICTION: low-B\n\nwriter_agent: t\nsubcategory: aaa-low\ncanonical: https://github.com/crewrig/crewrig\nseverity: low\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-3","room":"prompt","content":"FRICTION: med-A\n\nwriter_agent: t\nsubcategory: bbb-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-4","room":"prompt","content":"FRICTION: med-B\n\nwriter_agent: t\nsubcategory: bbb-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-5","room":"prompt","content":"FRICTION: med-C\n\nwriter_agent: t\nsubcategory: ccc-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-6","room":"prompt","content":"FRICTION: med-D\n\nwriter_agent: t\nsubcategory: ccc-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-7","room":"tool","content":"FRICTION: high-singleton\n\nwriter_agent: t\nsubcategory: zzz-high\ncanonical: https://github.com/crewrig/crewrig\nseverity: high\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-8","room":"prompt","content":"FRICTION: med-E\n\nwriter_agent: t\nsubcategory: ddd-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"},
  {"drawer_id":"m-9","room":"prompt","content":"FRICTION: med-F\n\nwriter_agent: t\nsubcategory: ddd-med\ncanonical: https://github.com/crewrig/crewrig\nseverity: med\nevidence:\n  - x.md:1\n"}
]
JSON

set +e
MAX_OUT=$(bash "$SCRIPT" --from-stdin --dry-run --max-issues 3 < "$MAX_FIXTURE")
MAX_RC=$?
set -e
assert "max-issues exit code" "0" "$MAX_RC"

# 5 qualifying clusters: aaa-low (size 2), bbb-med (2), ccc-med (2), ddd-med (2),
# zzz-high (1 — bypass via severity:high). --max-issues 3 keeps 3, truncates 2.
assert "max-issues clusters_above_threshold (pre-truncation)" "5" \
  "$(echo "$MAX_OUT" | jq -r '.stats.clusters_above_threshold')"
assert "max-issues clusters_truncated"           "2"           \
  "$(echo "$MAX_OUT" | jq -r '.stats.clusters_truncated')"
assert "max-issues output length"                "3"           \
  "$(echo "$MAX_OUT" | jq -r '.clusters | length')"

# Ranking: severity high first, then med clusters by cluster_key asc (all size 2).
# aaa-low (size 2, severity low) ranks last and is the one truncated out.
assert "max-issues rank[0].cluster_key (high-severity)" "zzz-high" \
  "$(echo "$MAX_OUT" | jq -r '.clusters[0].cluster_key')"
assert "max-issues rank[1].cluster_key (med, asc)"      "bbb-med"  \
  "$(echo "$MAX_OUT" | jq -r '.clusters[1].cluster_key')"
assert "max-issues rank[2].cluster_key (med, asc)"      "ccc-med"  \
  "$(echo "$MAX_OUT" | jq -r '.clusters[2].cluster_key')"

# --max-issues 0 (default) must leave behaviour unchanged: all 5 clusters
# present, clusters_truncated == 0.
set +e
MAX0_OUT=$(bash "$SCRIPT" --from-stdin --dry-run --max-issues 0 < "$MAX_FIXTURE")
MAX0_RC=$?
set -e
assert "max-issues=0 exit code"           "0" "$MAX0_RC"
assert "max-issues=0 output length"       "5" "$(echo "$MAX0_OUT" | jq -r '.clusters | length')"
assert "max-issues=0 clusters_truncated"  "0" "$(echo "$MAX0_OUT" | jq -r '.stats.clusters_truncated')"

# --- Auto mode (#42): schedule-curator.sh dry-run smoke ------------------
# Offline assertion: --dry-run must emit the platform-appropriate config
# blob (plist on Darwin, cron line on Linux) plus the reactive-trigger
# tail message, and exit 0. The interactive fzf prompts make a real
# dry-run un-scriptable here, but a non-interactive surface check on the
# --uninstall path proves the script wires up correctly without an
# installed entry.
SCHEDULER="$SKILL_DIR/scripts/schedule-curator.sh"
[ -f "$SCHEDULER" ] || { echo "FAIL: schedule-curator.sh missing: $SCHEDULER" >&2; exit 1; }
[ -x "$SCHEDULER" ] || { echo "FAIL: schedule-curator.sh not executable" >&2; exit 1; }
echo "  PASS schedule-curator.sh exists and is executable"

# --uninstall on a clean machine must exit 0 with a "nothing to remove"
# message. This validates the script parses args and dispatches on uname.
set +e
SCHED_OUT=$(bash "$SCHEDULER" --uninstall 2>&1)
SCHED_RC=$?
set -e
assert "schedule-curator.sh --uninstall exit code (clean machine)" "0" "$SCHED_RC"
echo "$SCHED_OUT" | grep -qi "nothing to remove\|removed" || {
  echo "FAIL schedule-curator.sh --uninstall: unexpected output" >&2
  echo "$SCHED_OUT" >&2
  exit 1
}
echo "  PASS schedule-curator.sh --uninstall message"

# --- Regression: defensive target_repo normalization (issue #63) ---------
# A filer may set `canonical:` to a file URL (https://github.com/<o>/<r>/
# blob/<branch>/<path>) or a tree URL (.../tree/<branch>/...) despite the
# schema requiring the bare repo form. apply.py must strip /blob/... or
# /tree/... so `gh --repo` receives a valid <owner>/<repo> slug, and warn
# the maintainer on stderr. The clean-URL case must NOT emit the warning
# (idempotence). Inline JSON because this exercises a malformed-input
# shape that the existing sample-frictions fixture deliberately doesn't
# cover.

# Helper: build a minimal one-cluster payload around a given target_repo.
# Strict-mode-safe printf form (single line, no heredoc indentation games).
make_cluster_payload() {
  local target="$1"
  printf '{"stats":{"total_drawers":1,"valid_frictions":1,"skipped_malformed":0,"skipped_resolved":0,"clusters_formed":1,"clusters_above_threshold":1,"clusters_parked":0,"routing_failures":0},"clusters":[{"cluster_key":"norm-probe","cluster_size":1,"target_repo":"%s","title":"normalization probe","body":"body","labels":["harness-feedback"],"frictions":[{"_drawer_id":"drw-norm-1"}]}],"skipped":[],"routing_failures":[]}' "$target"
}

run_normalize_case() {
  local label="$1" target="$2" tmp
  tmp=$(mktemp -d -t crewrig-norm.XXXXXX)
  set +e
  make_cluster_payload "$target" | python3 "$APPLY" --dry-run-apply \
    >"$tmp/out" 2>"$tmp/err"
  local rc=$?
  set -e
  assert "$label exit code" "0" "$rc"
  # argv is the first (and only) JSON array line on stdout.
  local argv
  argv=$(grep '^\[' "$tmp/out" | head -n1)
  [ -n "$argv" ] || { echo "FAIL $label: no argv array line on stdout" >&2; cat "$tmp/out" >&2; exit 1; }
  assert "$label argv --repo (slug only)" "crewrig/crewrig" \
    "$(echo "$argv" | jq -r '.[(index("--repo"))+1]')"
  # Export tmpdir path via global so the caller can inspect stderr.
  NORM_TMP="$tmp"
}

# Sub-case 1: /blob/<branch>/<path> form → stripped, warning emitted.
run_normalize_case "norm.blob" \
  "https://github.com/crewrig/crewrig/blob/main/community-config/skills/architect/SKILL.md"
if ! grep -q "stripping to repo root" "$NORM_TMP/err"; then
  echo "FAIL norm.blob stderr missing 'stripping to repo root' warning" >&2
  cat "$NORM_TMP/err" >&2
  exit 1
fi
echo "  PASS norm.blob stderr contains 'stripping to repo root'"

# Sub-case 2: /tree/<branch>/<path> form → stripped, warning emitted.
run_normalize_case "norm.tree" \
  "https://github.com/crewrig/crewrig/tree/main/community-config"
if ! grep -q "stripping to repo root" "$NORM_TMP/err"; then
  echo "FAIL norm.tree stderr missing 'stripping to repo root' warning" >&2
  cat "$NORM_TMP/err" >&2
  exit 1
fi
echo "  PASS norm.tree stderr contains 'stripping to repo root'"

# Sub-case 3: already-clean bare repo URL → SAME argv shape, NO warning.
# Idempotence guard: the normalization block must not fire on valid input.
run_normalize_case "norm.clean" "https://github.com/crewrig/crewrig"
if grep -q "stripping to repo root" "$NORM_TMP/err"; then
  echo "FAIL norm.clean stderr unexpectedly contains 'stripping to repo root'" >&2
  cat "$NORM_TMP/err" >&2
  exit 1
fi
echo "  PASS norm.clean stderr does not contain 'stripping to repo root'"

# --- Smoke test: setup-labels.sh bootstrap (offline, --dry-run only) -----
# Offline assertions on the dry-run plan — never contacts GitHub. Mirrors
# the norm.* sub-case shape used in the apply.py normalization block
# above. Exercises:
#   (a) plan-line count + shape (proves the LABELS array is intact)
#   (b) all three label families surface (harness-feedback / room:* /
#       severity:*) so a partial vocabulary regression cannot pass
#   (c) usage errors exit non-zero (unknown flag, missing --repo value)

SETUP="$SKILL_DIR/scripts/setup-labels.sh"
[ -f "$SETUP" ] || { echo "FAIL: setup-labels.sh missing: $SETUP" >&2; exit 1; }
[ -x "$SETUP" ] || chmod +x "$SETUP"

# setup.dry_run: --dry-run with a valid --repo exits 0 and emits a plan.
set +e
SETUP_OUT=$(bash "$SETUP" --repo crewrig/crewrig --dry-run 2>/dev/null)
SETUP_RC=$?
set -e
assert "setup.dry_run exit code" "0" "$SETUP_RC"

# setup.plan_count: exactly 9 "would create:" lines (one per label).
SETUP_PLAN_LINES=$(printf '%s\n' "$SETUP_OUT" | grep -c '^would create: ')
assert "setup.plan_count (9 labels)" "9" "$SETUP_PLAN_LINES"

# setup.family.*: all three label families present. Separate assertions —
# a regression that drops one family (e.g. truncated LABELS array) must
# fail loudly, not be swallowed by a single composite check.
SETUP_HAS_FEEDBACK=$(printf '%s\n' "$SETUP_OUT" | grep -c '^would create: harness-feedback ')
SETUP_HAS_ROOM=$(printf '%s\n' "$SETUP_OUT" | grep -c '^would create: room:')
SETUP_HAS_SEVERITY=$(printf '%s\n' "$SETUP_OUT" | grep -c '^would create: severity:')
[ "$SETUP_HAS_FEEDBACK" -ge 1 ] || { echo "FAIL setup.family.feedback: missing harness-feedback line" >&2; exit 1; }
echo "  PASS setup.family.feedback"
[ "$SETUP_HAS_ROOM"     -ge 1 ] || { echo "FAIL setup.family.room: missing room:* line(s)" >&2; exit 1; }
echo "  PASS setup.family.room"
[ "$SETUP_HAS_SEVERITY" -ge 1 ] || { echo "FAIL setup.family.severity: missing severity:* line(s)" >&2; exit 1; }
echo "  PASS setup.family.severity"

# setup.line_shape: every plan line carries color=<6hex> and a description.
# `grep -vc` returns the count of NON-matching plan lines — must be zero.
# `|| true` shields the count==0 case where grep exits 1.
SETUP_BAD_SHAPE=$(printf '%s\n' "$SETUP_OUT" | grep '^would create: ' \
  | grep -vcE ' \(color=[0-9A-Fa-f]{6}, description=.+\)$' || true)
assert "setup.line_shape (color=<6hex>, description=...)" "0" "$SETUP_BAD_SHAPE"

# setup.usage.bogus_flag: unknown argument → non-zero exit.
set +e
bash "$SETUP" --bogus >/dev/null 2>&1
SETUP_BOGUS_RC=$?
set -e
[ "$SETUP_BOGUS_RC" -ne 0 ] || { echo "FAIL setup.usage.bogus_flag: expected non-zero exit, got $SETUP_BOGUS_RC" >&2; exit 1; }
echo "  PASS setup.usage.bogus_flag (rc=$SETUP_BOGUS_RC)"

# setup.usage.repo_no_value: --repo as final arg (no value) → non-zero exit.
set +e
bash "$SETUP" --repo >/dev/null 2>&1
SETUP_NOVALUE_RC=$?
set -e
[ "$SETUP_NOVALUE_RC" -ne 0 ] || { echo "FAIL setup.usage.repo_no_value: expected non-zero exit, got $SETUP_NOVALUE_RC" >&2; exit 1; }
echo "  PASS setup.usage.repo_no_value (rc=$SETUP_NOVALUE_RC)"

# --- Regression: real MemPalace path (no --from-stdin) -------------------
# This section guards the curate-stdout-hijack bug (issue #62): when
# curate.py reads from MemPalace, importing `mempalace.mcp_server` swaps
# `sys.stdout` to keep the JSON-RPC channel clean, hijacking our JSON
# output. The production fix dups fd 1 with `closefd=False` BEFORE the
# import. The pre-existing 31 assertions all run through --from-stdin
# and therefore never exercise the mempalace import path — so they
# could not catch this bug.
#
# Gating: this test runs only when both the mempalace CLI and the
# `mempalace.mcp_server` Python module are importable. Otherwise it
# SKIPs (does not fail) — keeps the suite usable on hosts where the
# curator is being developed without a local mempalace install.

# Resolve a Python that has `mempalace` available. Mirrors the
# auto-detect logic in curate.sh so the probe and the run use the same
# interpreter. Honors a pre-set MEMPALACE_PYTHON if the caller exports
# one.
auto_detect_mp_python() {
  if command -v pipx >/dev/null 2>&1; then
    local pipx_venv
    pipx_venv=$(pipx environment --value PIPX_HOME 2>/dev/null)/venvs/mempalace
    if [ -x "$pipx_venv/bin/python3" ]; then
      echo "$pipx_venv/bin/python3"
      return 0
    fi
  fi
  echo "python3"
}
MEMPALACE_PYTHON="${MEMPALACE_PYTHON:-$(auto_detect_mp_python)}"

if ! command -v mempalace >/dev/null 2>&1 || \
   ! "$MEMPALACE_PYTHON" -c "import mempalace.mcp_server" >/dev/null 2>&1; then
  echo "  SKIP test_from_mempalace_real: mempalace not installed"
else
  # Hermetic palace: MEMPALACE_PALACE_PATH is the env var actually
  # consulted by mempalace.config (despite the v3.3.x docs sometimes
  # referring to it as MEMPALACE_HOME). Pointing it at a fresh tmpdir
  # gives us a one-drawer palace that cannot contaminate the user's
  # real ~/.mempalace store.
  tmpdir=$(mktemp -d -t crewrig-curate-real.XXXXXX)
  # Chain cleanup onto any pre-existing trap (curate.sh installs its
  # own EXIT trap inside --from-stdin runs, but test.sh itself has
  # none yet — this is defensive).
  trap 'rm -rf "$tmpdir"' EXIT
  export MEMPALACE_PALACE_PATH="$tmpdir"

  # Seed exactly one drawer that qualifies as a singleton via the
  # severity:high bypass. Title prefix and the writer_agent / evidence
  # keys mirror the schema in assets/sample-frictions.json. The
  # tool_add_drawer return value carries the assigned drawer_id; capture
  # it for the round-trip assertions below (issue #69).
  SEEDED_DRAWER_ID=$("$MEMPALACE_PYTHON" - <<'PY'
# Mirror curate.py: dup fd 1 BEFORE importing mempalace.mcp_server, which
# swaps sys.stdout for the JSON-RPC channel and would otherwise eat our
# drawer_id capture.
import os
_real = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
from mempalace.mcp_server import tool_add_drawer
result = tool_add_drawer(
    wing="harness-friction",
    room="tool",
    content=(
        "FRICTION: regression probe for curate-stdout-hijack\n\n"
        "writer_agent: test-runner\n"
        "subcategory: real-mempalace-smoke\n"
        "canonical: https://github.com/crewrig/crewrig\n"
        "severity: high\n"
        "evidence:\n"
        "  - artifacts/library/skills/harness-curator/scripts/curate.py:60\n"
    ),
)
_real.write(result.get("drawer_id", "") if isinstance(result, dict) else str(result))
_real.flush()
PY
)
  [ -n "$SEEDED_DRAWER_ID" ] || {
    echo "FAIL test_real: tool_add_drawer returned no drawer_id" >&2
    exit 1
  }
  echo "  PASS test_real seeded drawer ($SEEDED_DRAWER_ID)"

  # Run curate.sh with NO --from-stdin so the real read_from_mempalace
  # path executes. Split stdout / stderr — mempalace chatter on stderr
  # is permitted, stdout MUST contain the JSON.
  set +e
  bash "$SCRIPT" --dry-run >"$tmpdir/out.json" 2>"$tmpdir/err.log"
  REAL_RC=$?
  set -e
  assert "test_real exit code" "0" "$REAL_RC"

  # Primary symptom of the bug: stdout was empty because the JSON went
  # to a closed fd. Size > 0 is the cheapest possible regression check.
  REAL_SIZE=$(wc -c < "$tmpdir/out.json" | tr -d ' ')
  if [ "$REAL_SIZE" -le 0 ]; then
    echo "FAIL test_real.stdout is non-empty — got $REAL_SIZE bytes" >&2
    echo "--- stderr ---" >&2
    cat "$tmpdir/err.log" >&2
    exit 1
  fi
  echo "  PASS test_real.stdout is non-empty ($REAL_SIZE bytes)"

  # Parses as JSON — guards the case where stdout contains garbage
  # rather than nothing (e.g. mixed mempalace logs).
  if ! "$MEMPALACE_PYTHON" -c \
      "import json,sys; json.load(open('$tmpdir/out.json'))" \
      >/dev/null 2>&1; then
    echo "FAIL test_real.stdout parses as JSON" >&2
    echo "--- stdout ---" >&2
    cat "$tmpdir/out.json" >&2
    echo "--- stderr ---" >&2
    cat "$tmpdir/err.log" >&2
    exit 1
  fi
  echo "  PASS test_real.stdout parses as JSON"

  REAL_OUT=$(cat "$tmpdir/out.json")
  assert "test_real.stats.total_drawers"  "1" \
    "$(echo "$REAL_OUT" | jq -r '.stats.total_drawers')"
  assert "test_real.stats.valid_frictions" "1" \
    "$(echo "$REAL_OUT" | jq -r '.stats.valid_frictions')"
  assert "test_real.clusters_above_threshold" "1" \
    "$(echo "$REAL_OUT" | jq -r '.stats.clusters_above_threshold')"
  assert "test_real.cluster_key" "real-mempalace-smoke" \
    "$(echo "$REAL_OUT" | jq -r '.clusters[0].cluster_key')"

  # --- Issue #69 round-trip: _drawer_id propagation + write-back skip ----
  # Pipe the real-MemPalace curator output through apply.py --dry-run-apply
  # and assert that the would_update_drawers list carries the exact
  # drawer_id returned at seed time. This proves _drawer_id propagates
  # from tool_list_drawers → cluster JSON → apply.py argv-build.
  set +e
  REAL_APPLY_OUT=$(printf '%s\n' "$REAL_OUT" | python3 "$APPLY" --dry-run-apply)
  REAL_APPLY_RC=$?
  set -e
  assert "test_real apply --dry-run-apply exit code" "0" "$REAL_APPLY_RC"

  REAL_APPLY_OBJ=$(printf '%s\n' "$REAL_APPLY_OUT" | jq -c 'select(type == "object" and (.would_update_drawers // null) != null)')
  [ -n "$REAL_APPLY_OBJ" ] || {
    echo "FAIL test_real apply.would_update_drawers object missing" >&2
    echo "$REAL_APPLY_OUT" >&2
    exit 1
  }
  REAL_APPLY_IDS=$(echo "$REAL_APPLY_OBJ" | jq -c '.would_update_drawers')
  assert "test_real would_update_drawers carries seeded drawer_id" \
    "[\"$SEEDED_DRAWER_ID\"]" "$REAL_APPLY_IDS"

  # Simulate the real --apply write-back: stamp `opened_as: <url>` on the
  # seeded drawer the same way apply.py's real path does. The fd-dup
  # mirrors the seed script — mempalace.mcp_server swaps sys.stdout on
  # import.
  "$MEMPALACE_PYTHON" - "$SEEDED_DRAWER_ID" <<'PY'
import os, sys
_real = os.fdopen(os.dup(1), "w", encoding="utf-8", closefd=False)
from mempalace.mcp_server import tool_get_drawer, tool_update_drawer
did = sys.argv[1]
drawer = tool_get_drawer(drawer_id=did)
new_content = drawer["content"].rstrip() + "\nopened_as: https://example.com/fake/1\n"
tool_update_drawer(drawer_id=did, content=new_content)
_real.write("ok")
_real.flush()
PY

  # Re-run curate; the freshly stamped drawer must now be filtered as
  # `resolved`, leaving zero valid frictions and zero clusters.
  set +e
  bash "$SCRIPT" --dry-run >"$tmpdir/out2.json" 2>"$tmpdir/err2.log"
  REAL_RC2=$?
  set -e
  assert "test_real second-run exit code" "0" "$REAL_RC2"
  REAL_OUT2=$(cat "$tmpdir/out2.json")
  assert "test_real second-run stats.skipped_resolved" "1" \
    "$(echo "$REAL_OUT2" | jq -r '.stats.skipped_resolved')"
  assert "test_real second-run stats.valid_frictions" "0" \
    "$(echo "$REAL_OUT2" | jq -r '.stats.valid_frictions')"
  assert "test_real second-run stats.clusters_above_threshold" "0" \
    "$(echo "$REAL_OUT2" | jq -r '.stats.clusters_above_threshold')"
  RESOLVED_LEAK=$(echo "$REAL_OUT2" | jq -c '.clusters[] | select(.cluster_key == "real-mempalace-smoke")')
  [ -z "$RESOLVED_LEAK" ] || {
    echo "FAIL test_real second-run: stamped drawer leaked into clusters" >&2
    echo "$RESOLVED_LEAK" >&2
    exit 1
  }
  echo "  PASS test_real second-run: stamped drawer absent from clusters"
fi

echo ""
echo "OK: harness-curate smoke test passed."
