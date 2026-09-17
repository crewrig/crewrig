#!/bin/bash
# test-usage-record-schema.sh — CI validation suite for the usage record
# contract (spec 0205, PLAN v3 step 6): schema conformance for the four-CLI
# samples, mutant rejection, and recordId derivation.
#
# Three directory expectations, each asserted with a non-zero file count so an
# empty glob can never pass vacuously (R17/R18):
#   - schemas/usage-record/samples/*.json  MUST validate (schema AND recordId
#     derivation).
#   - scripts/tests/fixtures/usage-records/mutants/*.json  MUST be rejected by
#     the schema itself (exit 1, a `schema` error line). A mutant rejected
#     only for a `recordId mismatch` — meaning the schema silently accepted
#     it — is a FAILURE of this suite, not a pass (PLAN v3, step 6).
#   - scripts/tests/fixtures/usage-records/derivation/*.json  MUST pass the
#     schema and fail only recordId derivation (exit 1, `recordId mismatch`,
#     no `schema` error line).
#
# `mutants/zero-for-unread.json` gets one extra reason-check: PLAN v3-F1's
# remediation #2 requires it be rejected BY THE ALL-ZERO BLOCK ON `tokens`,
# not by an incidental missing field, or the block is unfalsifiable by this
# suite (a green that certifies the adjacent property).
#
# Preflight: `node` on PATH and node_modules/ajv installed, or a FATAL and
# exit 2 — never a silent pass. This guard is load-bearing: check-test-strays.sh
# runs every changeset-modified suite from the test-wiring job, which provisions
# no Node on either CI engine. A bare `node` invocation there would print
# "...: node: command not found" to stderr and be counted as a stray by that
# guard's grep, so the FATAL text below deliberately avoids that exact phrase.
#
# Usage:
#   bash scripts/tests/test-usage-record-schema.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATOR="$SCRIPT_DIR/lib/usage-record-validator.js"
SAMPLES_DIR="$REPO_DIR/schemas/usage-record/samples"
MUTANTS_DIR="$SCRIPT_DIR/tests/fixtures/usage-records/mutants"
DERIVATION_DIR="$SCRIPT_DIR/tests/fixtures/usage-records/derivation"

# --- Preflight ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required to run this suite — install Node and re-run \`npm install\`." >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/node_modules/ajv" ]; then
  echo "FATAL: node_modules/ajv is missing — run \`npm install\` first." >&2
  exit 2
fi

pass=0
fail=0

ok() {
  echo "PASS  $1"
  pass=$((pass + 1))
}

bad() {
  echo "FAIL  $1"
  if [ -n "${2:-}" ]; then
    printf '%s\n' "$2" | sed 's/^/      /'
  fi
  fail=$((fail + 1))
}

# run_validator <file> — echo the validator's combined stdout+stderr and set
# RC to its exit code, without letting `set -e` abort this suite on the
# non-zero exits every mutant and derivation fixture is expected to produce.
run_validator() {
  set +e
  RUN_OUT="$(node "$VALIDATOR" "$1" 2>&1)"
  RC=$?
  set -e
}

# --- 1. schemas/usage-record/samples/*.json — every sample validates -------
echo "=== schemas/usage-record/samples/*.json — every sample validates ==="
sample_count=0
for f in "$SAMPLES_DIR"/*.json; do
  [ -f "$f" ] || continue
  sample_count=$((sample_count + 1))
  run_validator "$f"
  if [ "$RC" -eq 0 ] && grep -qF ": OK" <<< "$RUN_OUT"; then
    ok "sample $(basename "$f") validates (schema + recordId)"
  else
    bad "sample $(basename "$f") did NOT validate cleanly (exit $RC)" "$RUN_OUT"
  fi
done
if [ "$sample_count" -eq 0 ]; then
  bad "samples directory has zero files — refusing to pass vacuously ($SAMPLES_DIR)"
fi

# --- 2. mutants/*.json — every mutant is rejected BY THE SCHEMA ------------
echo "=== scripts/tests/fixtures/usage-records/mutants/*.json — every mutant is schema-rejected ==="
mutant_count=0
for f in "$MUTANTS_DIR"/*.json; do
  [ -f "$f" ] || continue
  mutant_count=$((mutant_count + 1))
  name="$(basename "$f")"
  run_validator "$f"
  if [ "$RC" -eq 1 ] && grep -qF ": schema " <<< "$RUN_OUT"; then
    ok "mutant $name is rejected by the schema"
  else
    bad "mutant $name was NOT rejected with a schema error (exit $RC) — a mutant rejected only for a recordId mismatch means the schema silently accepted it" "$RUN_OUT"
  fi

  if [ "$name" = "zero-for-unread.json" ]; then
    if grep -qF "tokens" <<< "$RUN_OUT"; then
      ok "mutant $name is rejected by the all-zero block on tokens, not an incidental field (PLAN v3-F1)"
    else
      bad "mutant $name was rejected for the wrong reason — no mention of tokens in the schema error, so the all-zero block is unfalsifiable by this suite" "$RUN_OUT"
    fi
  fi
done
if [ "$mutant_count" -eq 0 ]; then
  bad "mutants directory has zero files — refusing to pass vacuously ($MUTANTS_DIR)"
fi

# --- 3. derivation/*.json — schema-valid, recordId derivation fails --------
echo "=== scripts/tests/fixtures/usage-records/derivation/*.json — schema passes, recordId derivation fails ==="
derivation_count=0
for f in "$DERIVATION_DIR"/*.json; do
  [ -f "$f" ] || continue
  derivation_count=$((derivation_count + 1))
  name="$(basename "$f")"
  run_validator "$f"
  if [ "$RC" -eq 1 ] && grep -qF "recordId mismatch" <<< "$RUN_OUT" && ! grep -qF ": schema " <<< "$RUN_OUT"; then
    ok "derivation fixture $name passes the schema and fails only recordId derivation"
  else
    bad "derivation fixture $name did not fail for the expected reason (exit $RC)" "$RUN_OUT"
  fi
done
if [ "$derivation_count" -eq 0 ]; then
  bad "derivation directory has zero files — refusing to pass vacuously ($DERIVATION_DIR)"
fi

echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
