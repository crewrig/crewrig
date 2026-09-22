#!/bin/bash
# test-usage-capture.sh — CI validation suite for the usage-capture module
# tree, its fixtures, its three installer-wired manifests, and the shim
# itself (spec 0206, PLAN v3 step 19).
#
# Preflight: node on PATH, node_modules/ajv installed, and require('node:sqlite')
# resolves — or a FATAL and exit 2, never a silent pass. The wording
# deliberately avoids the phrase scripts/check-test-strays.sh greps for
# ("command not found"), for the same reason
# scripts/tests/test-usage-record-schema.sh's own preflight does.
#
# What this suite proves, in order:
#   §1  R27 — every scripts/tests/fixtures/usage-capture/** fixture derives
#       its own expected.json record count, and every derived record
#       validates against schemas/usage-record/v1.schema.json.
#   §2  R28 — the unknown/unrecognized-shape/ fixture yields exactly one
#       uncaptured record and zero captured ones.
#   §3  R18 — the copilot-cli/events-jsonl-ignored/ fixture's events.jsonl is
#       read for cliVersion only, never for a token value.
#   §4  Idempotence — the same cursor mechanism spec 0206 R23's backfill
#       command relies on (claude-code/gemini-cli/copilot-cli byteOffset /
#       maxRowId tracking, antigravity's lastSnapshotDigest): a second
#       derivation over the SAME fixture set, same CREWRIG_USAGE_ROOT, adds
#       zero records.
#   §5  R24 — scripts/lib/usage-capture/backfill.js and
#       scripts/usage-backfill.sh touch none of the four
#       scripts/import-*-history.sh scripts, their MemPalace target, or their
#       state — checked statically (backfill.js never references them; the
#       two systems share no code path) — plus a hermetic empty-$HOME smoke
#       run proving the script itself runs clean.
#   §6  scripts/tests/fixtures/usage-records/mutants/*.json and
#       derivation/recordid-mismatch.json are all rejected by
#       assertRecordShape() — the gap between the structural precheck and the
#       merged schema, in the direction sink.js's own header promises CI
#       closes (PLAN v3-F1 tester gap, fixed in this same diff: record.js's
#       assertRecordShape() gained the rawStatus-conditional, all-zero-tokens
#       and additionalProperties checks the schema's allOf blocks (A)/(C)/
#       (D)/(E) already enforce, four of the eight mutants were silently
#       ACCEPTED before this fix).
#   §7  hooks/usage-capture.sh itself, in the shape the installed manifests
#       actually invoke, with CREWRIG_USAGE_ROOT pointed at a temp directory
#       throughout:
#         (a) installed shape — ${BASH_SOURCE[0]}-anchored resolution is
#             $PWD-independent.
#         (b) PLAN v3-F1 named edit 1 — (i) with a stamp present and the
#             source not newer, all three payloads/ serializations take the
#             fast path and none reaches cli.js; (ii) under the SAME
#             conditions, a payload the extraction cannot read (no path key,
#             a path key whose value is not an existing absolute path, or a
#             relative path) still reaches cli.js.
#         (c) exit-0 contract (R15) — node missing from PATH, CLI override
#             pointed at a nonexistent path, and a throwing stub: exit 0 and
#             zero bytes of output in all three cases.
#   §8  i1-F1 (review/1169#1) — the three gemini-cli format generations
#       (legacy-json, json-kind-summary, jsonl-set-journal) derive pairwise
#       distinct provenance.formatFingerprint values, matching PLAN v3 step 6
#       and docs/usage-capture.md's own "three generations, three
#       fingerprints" claim.
#
# HERMETIC: CREWRIG_USAGE_ROOT is pinned to a throwaway temp directory for
# every invocation in this suite. Nothing is ever written under the real
# ~/.crewrig/usage/, no installer or shim runs against the real $HOME. The
# copilot-cli/events-jsonl-ignored fixture's HOME override is scoped to that
# one fixture's derivation only.
#
# Usage:
#   bash scripts/tests/test-usage-capture.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VALIDATOR="$SCRIPT_DIR/lib/usage-record-validator.js"
DERIVE_JS="$SCRIPT_DIR/tests/lib/usage-capture-derive.js"
MATERIALIZE_JS="$SCRIPT_DIR/tests/lib/materialize-copilot-db.js"
FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/usage-capture"
MUTANTS_DIR="$SCRIPT_DIR/tests/fixtures/usage-records/mutants"
DERIVATION_DIR="$SCRIPT_DIR/tests/fixtures/usage-records/derivation"
CAPTURE_SHIM="$REPO_DIR/hooks/usage-capture.sh"
BACKFILL_JS="$SCRIPT_DIR/lib/usage-capture/backfill.js"
BACKFILL_SH="$SCRIPT_DIR/usage-backfill.sh"

NODE_FLAGS="--disable-warning=ExperimentalWarning"

# --- Preflight ---------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: a Node.js runtime is required to run this suite — install Node and re-run \`npm install\`." >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/node_modules/ajv" ]; then
  echo "FATAL: node_modules/ajv is missing — run \`npm install\` first." >&2
  exit 2
fi
if ! node $NODE_FLAGS -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "FATAL: this Node runtime does not expose node:sqlite unflagged — the copilot-cli adapter and its fixtures require it." >&2
  exit 2
fi

pass=0
fail=0
ok()  { echo "PASS  $1"; pass=$((pass + 1)); }
bad() { echo "FAIL  $1"; if [ -n "${2:-}" ]; then printf '%s\n' "$2" | sed 's/^/      /'; fi; fail=$((fail + 1)); }

FIXTURE_ROOT="$(mktemp -d)"
WORK_ROOT="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_ROOT" "$WORK_ROOT" "${FP_ROOT:-}"' EXIT

# derive <outdir> <mode> [args...] — invokes usage-capture-derive.js with
# CREWRIG_USAGE_ROOT pinned to FIXTURE_ROOT throughout (named edit 2), and
# parses its "RESULT captured=N uncaptured=N total=N" line into
# DERIVE_CAPTURED/DERIVE_UNCAPTURED/DERIVE_TOTAL. Sets DERIVE_RC and
# DERIVE_OUT (combined stdout+stderr) unconditionally.
derive() {
  local outdir="$1"; shift
  DERIVE_OUT="$(CREWRIG_USAGE_ROOT="$FIXTURE_ROOT" node $NODE_FLAGS "$DERIVE_JS" "$@" --out "$outdir" 2>&1)"
  DERIVE_RC=$?
  DERIVE_CAPTURED=""
  DERIVE_UNCAPTURED=""
  DERIVE_TOTAL=""
  DERIVE_STORED=""
  DERIVE_DUPLICATE=""
  DERIVE_REJECTED=""
  if [[ "$DERIVE_OUT" =~ RESULT\ captured=([0-9]+)\ uncaptured=([0-9]+)\ total=([0-9]+) ]]; then
    DERIVE_CAPTURED="${BASH_REMATCH[1]}"
    DERIVE_UNCAPTURED="${BASH_REMATCH[2]}"
    DERIVE_TOTAL="${BASH_REMATCH[3]}"
  fi
  if [[ "$DERIVE_OUT" =~ SUBMIT\ stored=([0-9]+)\ duplicate=([0-9]+)\ rejected=([0-9]+) ]]; then
    DERIVE_STORED="${BASH_REMATCH[1]}"
    DERIVE_DUPLICATE="${BASH_REMATCH[2]}"
    DERIVE_REJECTED="${BASH_REMATCH[3]}"
  fi
}

# validate_dir <dir> — runs the merged schema validator on every rec-*.json
# under <dir>. Echoes back 0 (all clean) or 1 (at least one failure, detail
# printed by the caller).
validate_dir() {
  local dir="$1"
  local f vout vrc
  for f in "$dir"/rec-*.json; do
    [ -f "$f" ] || continue
    vout="$(node $NODE_FLAGS "$VALIDATOR" "$f" 2>&1)"
    vrc=$?
    if [ "$vrc" -ne 0 ] || ! grep -qF ': OK' <<< "$vout"; then
      VALIDATE_DETAIL="$f: $vout"
      return 1
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
echo "=== §1/§2/§4 fixture derivation: counts (R27), schema validity, idempotence ==="

UNKNOWN_CAPTURED=""
UNKNOWN_UNCAPTURED=""

fixture_count=0
for expected in $(find "$FIXTURES_DIR" -name expected.json | sort); do
  dir="$(dirname "$expected")"
  label="${dir#"$FIXTURES_DIR"/}"

  if ! jq -e 'has("adapter")' "$expected" >/dev/null 2>&1; then
    continue # payloads/expected.json — driven separately in §7
  fi
  fixture_count=$((fixture_count + 1))

  adapter="$(jq -r '.adapter' "$expected")"
  exp_captured="$(jq -r '.captured' "$expected")"
  exp_uncaptured="$(jq -r '.uncaptured' "$expected")"
  outdir="$WORK_ROOT/$(echo "$label" | tr '/' '_')"

  case "$adapter" in
    claude-code|gemini-cli)
      transcript_path="$(jq -r '.transcriptPath' "$expected")"
      derive "$outdir" "$adapter" "$dir/$transcript_path" --submit 1
      supports_idempotence=1
      ;;
    antigravity)
      payload_file="$(jq -r '.payloadFile' "$expected")"
      derive "$outdir" antigravity "$dir/$payload_file" --submit 1
      supports_idempotence=1
      ;;
    headless-envelope)
      cli="$(jq -r '.cli' "$expected")"
      envelope_file="$(jq -r '.envelopeFile' "$expected")"
      derive "$outdir" headless "$cli" "$dir/$envelope_file"
      supports_idempotence=0
      ;;
    copilot-cli)
      db="$WORK_ROOT/$(echo "$label" | tr '/' '_').db"
      node $NODE_FLAGS "$MATERIALIZE_JS" "$dir" "$db" >"$WORK_ROOT/materialize.log" 2>&1
      if [ $? -ne 0 ]; then
        bad "$label: materializing the fixture sqlite db failed" "$(cat "$WORK_ROOT/materialize.log")"
        continue
      fi
      # SAFETY: never point $HOME at a git-tracked fixture path — copy it
      # into a throwaway temp dir first. Belt-and-braces alongside
      # usage-capture-derive.js's own $PATH pin: defense in depth against a
      # repeat of the incident this suite's header records (a real CLI
      # binary wrote ~136 MiB of its own cache tree into a tracked fixture
      # directory when $HOME briefly pointed straight at it).
      if [ -d "$dir/home" ]; then
        home_arg="$WORK_ROOT/home-copy-$fixture_count"
        cp -R "$dir/home" "$home_arg"
      else
        home_arg="$WORK_ROOT/empty-home-$fixture_count"
      fi
      derive "$outdir" copilot-cli "$db" --home "$home_arg" --submit 1
      supports_idempotence=1
      ;;
    *)
      bad "$label: unrecognized adapter in expected.json: $adapter"
      continue
      ;;
  esac

  if [ "$DERIVE_RC" -ne 0 ]; then
    bad "$label: derivation failed (exit $DERIVE_RC)" "$DERIVE_OUT"
    continue
  fi

  if [ "$DERIVE_CAPTURED" = "$exp_captured" ] && [ "$DERIVE_UNCAPTURED" = "$exp_uncaptured" ]; then
    ok "$label: captured=$DERIVE_CAPTURED uncaptured=$DERIVE_UNCAPTURED matches expected.json (R27)"
  else
    bad "$label: captured=$DERIVE_CAPTURED uncaptured=$DERIVE_UNCAPTURED, expected captured=$exp_captured uncaptured=$exp_uncaptured (R27)" "$DERIVE_OUT"
  fi

  if validate_dir "$outdir"; then
    ok "$label: every derived record validates against v1.schema.json"
  else
    bad "$label: a derived record failed schema validation" "$VALIDATE_DETAIL"
  fi

  if [ "$label" = "unknown/unrecognized-shape" ]; then
    UNKNOWN_CAPTURED="$DERIVE_CAPTURED"
    UNKNOWN_UNCAPTURED="$DERIVE_UNCAPTURED"
  fi

  if [ "$label" = "copilot-cli/events-jsonl-ignored" ]; then
    rec="$outdir/rec-0.json"
    cli_version="$(jq -r '.provenance.cliVersion' "$rec" 2>/dev/null)"
    exp_version="$(jq -r '.expectedCliVersion' "$expected")"
    poison="$(jq -r '.poisonValue' "$expected")"
    tokens_json="$(jq -c '.tokens' "$rec" 2>/dev/null)"
    if [ "$cli_version" = "$exp_version" ]; then
      ok "$label: cliVersion sourced from events.jsonl's session.start line ($cli_version) — R18 the file IS read, for version only"
    else
      bad "$label: cliVersion was '$cli_version', expected '$exp_version' (events.jsonl session.start.data.copilotVersion)"
    fi
    if jq -e --argjson p "$poison" '.tokens | to_entries | map(.value) | index($p) == null' "$rec" >/dev/null 2>&1; then
      ok "$label: derived tokens never carry the events.jsonl poison value ($poison) — never opened for a token value"
    else
      bad "$label: derived tokens leaked the poison value from events.jsonl" "$tokens_json"
    fi
    exp_tokens="$(jq -c '.expectedTokens' "$expected")"
    if [ "$tokens_json" = "$exp_tokens" ]; then
      ok "$label: derived tokens equal the sqlite row's own columns exactly"
    else
      bad "$label: derived tokens ($tokens_json) do not equal the sqlite row's own columns ($exp_tokens)"
    fi
  fi

  if [ "$supports_idempotence" -eq 1 ]; then
    # R23 idempotence, asserted the mechanism-agnostic way: a re-run must
    # STORE zero new records, regardless of whether that is because the
    # ADAPTER's own cursor derived zero records (claude-code, gemini-cli's
    # jsonl generations, copilot-cli) or because the SINK's recordId-based
    # dedup rejected re-derived ones as duplicates (gemini-cli's whole-JSON
    # legacy-json / json-kind-summary generations, which carry no cursor at
    # all — the file is rewritten wholesale, not appended to).
    case "$adapter" in
      claude-code|gemini-cli) derive "${outdir}-pass2" "$adapter" "$dir/$transcript_path" --submit 1 ;;
      antigravity) derive "${outdir}-pass2" antigravity "$dir/$payload_file" --submit 1 ;;
      copilot-cli) derive "${outdir}-pass2" copilot-cli "$db" --home "$home_arg" --submit 1 ;;
    esac
    if [ "$DERIVE_RC" -eq 0 ] && [ "$DERIVE_STORED" = "0" ]; then
      ok "$label: a second derivation over the same source and CREWRIG_USAGE_ROOT stores zero new records (re-derived: $DERIVE_TOTAL, duplicate: $DERIVE_DUPLICATE) — R23 idempotence"
    else
      bad "$label: second derivation stored $DERIVE_STORED new record(s), expected 0 (idempotence)" "$DERIVE_OUT"
    fi
  fi
done

if [ "$fixture_count" -eq 0 ]; then
  bad "zero fixtures discovered under $FIXTURES_DIR — refusing to pass vacuously"
fi

echo
echo "=== §2 R28: unknown/unrecognized-shape/ yields exactly one uncaptured record, zero captured ==="
if [ "$UNKNOWN_CAPTURED" = "0" ] && [ "$UNKNOWN_UNCAPTURED" = "1" ]; then
  ok "R28: unknown/unrecognized-shape yields 0 captured, 1 uncaptured"
else
  bad "R28: unknown/unrecognized-shape yielded captured=$UNKNOWN_CAPTURED uncaptured=$UNKNOWN_UNCAPTURED, expected 0/1"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §5 R24: backfill.js is independent of the four scripts/import-*-history.sh scripts ==="

if grep -qinE "mempalace|import-(claude|gemini|copilot|antigravity)-history" "$BACKFILL_JS" "$BACKFILL_SH"; then
  bad "R24: backfill.js or usage-backfill.sh references MemPalace or an import-*-history.sh script"
else
  ok "R24: backfill.js and usage-backfill.sh reference neither MemPalace nor any import-*-history.sh script"
fi

EMPTY_HOME="$(mktemp -d)"
BACKFILL_ROOT="$(mktemp -d)"
BACKFILL_OUT="$(HOME="$EMPTY_HOME" CREWRIG_USAGE_ROOT="$BACKFILL_ROOT" node $NODE_FLAGS "$BACKFILL_JS" 2>&1)"
BACKFILL_RC=$?
if [ "$BACKFILL_RC" -eq 0 ] && grep -q '^claude-code: 0 stored' <<< "$BACKFILL_OUT" \
   && grep -q '^gemini-cli: 0 stored' <<< "$BACKFILL_OUT" && grep -q '^copilot-cli: 0 stored' <<< "$BACKFILL_OUT"; then
  ok "R24/R23: backfill.js runs clean (exit 0, 0 stored/CLI) under an empty, hermetic \$HOME"
else
  bad "backfill.js did not run clean under an empty \$HOME (exit $BACKFILL_RC)" "$BACKFILL_OUT"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §6 assertRecordShape() rejects every mutant and the recordId-mismatch derivation fixture ==="

SHAPE_OUT="$(node $NODE_FLAGS "$DERIVE_JS" assert-shape-rejects "$MUTANTS_DIR" "$DERIVATION_DIR" 2>&1)"
SHAPE_RC=$?
echo "$SHAPE_OUT" | sed 's/^/  /'
if [ "$SHAPE_RC" -eq 0 ]; then
  ok "assertRecordShape() rejects every scripts/tests/fixtures/usage-records/mutants/*.json and derivation/recordid-mismatch.json"
else
  bad "assertRecordShape() accepted at least one mutant or derivation fixture it must reject" "$SHAPE_OUT"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §7(a) hooks/usage-capture.sh — installed shape: \${BASH_SOURCE[0]}-anchored, \$PWD-independent ==="

CAPTURE_ABS="$(cd "$(dirname "$CAPTURE_SHIM")" && pwd -P)/$(basename "$CAPTURE_SHIM")"
INSTALLED_CWD="$(mktemp -d)"
INSTALLED_ROOT="$(mktemp -d)"
(cd "$INSTALLED_CWD" && CREWRIG_USAGE_ROOT="$INSTALLED_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< '{"transcript_path":"/home/agent/does/not/exist/unused.jsonl"}') >/dev/null 2>&1
JOURNAL_COUNT=$(find "$INSTALLED_ROOT/journal" -name '*.json' ! -name '*.wing.json' 2>/dev/null | wc -l | tr -d ' ')
if [ "$JOURNAL_COUNT" = "1" ]; then
  ok "§7(a): invoked by absolute path from a cwd that is NOT the repository — exactly one journal entry appears"
else
  bad "§7(a): expected exactly one journal entry, found $JOURNAL_COUNT under $INSTALLED_ROOT/journal"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §7(a') a leftover <root>/spool/<recordId>.json (0206 hand-over) is drained into the journal on the next capture ==="

DRAIN_ROOT="$(mktemp -d)"
mkdir -p "$DRAIN_ROOT/spool"
LEFTOVER_RECORD="$(node $NODE_FLAGS -e "console.log(JSON.stringify(require('$REPO_DIR/schemas/usage-record/samples/gemini-cli.json')))")"
LEFTOVER_ID="$(node $NODE_FLAGS -e "console.log(require('$REPO_DIR/schemas/usage-record/samples/gemini-cli.json').recordId)")"
printf '%s\n' "$LEFTOVER_RECORD" > "$DRAIN_ROOT/spool/$LEFTOVER_ID.json"

(cd "$INSTALLED_CWD" && CREWRIG_USAGE_ROOT="$DRAIN_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< '{"transcript_path":"/home/agent/does/not/exist/unused.jsonl"}') >/dev/null 2>&1

DRAINED_ENTRY="$(find "$DRAIN_ROOT/journal" -name "$LEFTOVER_ID.json" 2>/dev/null)"
SPOOL_LEFTOVER_COUNT=$(find "$DRAIN_ROOT/spool" -type f 2>/dev/null | wc -l | tr -d ' ')
if [ -n "$DRAINED_ENTRY" ] && [ "$SPOOL_LEFTOVER_COUNT" = "0" ]; then
  ok "§7(a'): a hand-placed <root>/spool/<recordId>.json is drained into the journal on the next capture, and spool/ is emptied"
else
  bad "§7(a'): leftover spool record was not drained (journal entry found: '${DRAINED_ENTRY:-<none>}', spool/ files remaining: $SPOOL_LEFTOVER_COUNT)"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §7(b) PLAN v3-F1 named edit 1 — the fast-path/slow-path asymmetry, asserted in both directions ==="

# The shim's own source_key() bash function, duplicated here per its own
# comment ("Keep the two definitions in sync") — this is the only way the
# test can pre-compute the stamp path the shim itself will look for.
source_key() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

ASYM_ROOT="$(mktemp -d)"
ASYM_SRC="$(mktemp)"
echo "fixture transcript content" > "$ASYM_SRC"
mkdir -p "$ASYM_ROOT/state/claude-code"
touch "$ASYM_ROOT/state/claude-code/$(source_key "$ASYM_SRC").stamp"

STUB_DIR="$(mktemp -d)"
cat > "$STUB_DIR/marker-stub.js" <<'EOF'
const fs = require('fs');
fs.writeFileSync(process.env.STUB_MARKER, process.argv.slice(2).join(' '));
EOF

# (i) all three readable payloads/ serializations: stamp present, source not
# newer — fast path, cli.js never reached.
for f in "$FIXTURES_DIR"/payloads/compact-snake-case.json \
         "$FIXTURES_DIR"/payloads/spaced-snake-case.json \
         "$FIXTURES_DIR"/payloads/camel-case.json; do
  name="$(basename "$f")"
  MARKER="$WORK_ROOT/marker-$name"
  rm -f "$MARKER"
  payload="$(sed "s#__TRANSCRIPT_PATH__#$ASYM_SRC#" "$f")"
  STUB_MARKER="$MARKER" CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI="$STUB_DIR/marker-stub.js" \
    CREWRIG_USAGE_ROOT="$ASYM_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< "$payload" >/dev/null 2>&1
  if [ ! -f "$MARKER" ]; then
    ok "§7(b)(i): $name takes the fast path, cli.js not reached (stamp present, source not newer)"
  else
    bad "§7(b)(i): $name reached cli.js — expected the fast path"
  fi
done

# (ii) the two unreadable payloads/ fixtures, SAME stamp/mtime conditions —
# must still reach cli.js. This is v2-F2 itself, and the assertion (i)
# deliberately does NOT cover (plan review, named edit 1).
for f in "$FIXTURES_DIR"/payloads/no-path-key.json \
         "$FIXTURES_DIR"/payloads/unresolvable-path.json; do
  name="$(basename "$f")"
  MARKER="$WORK_ROOT/marker-$name"
  rm -f "$MARKER"
  STUB_MARKER="$MARKER" CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI="$STUB_DIR/marker-stub.js" \
    CREWRIG_USAGE_ROOT="$ASYM_ROOT" bash "$CAPTURE_ABS" claude-code Stop < "$f" >/dev/null 2>&1
  if [ -f "$MARKER" ]; then
    ok "§7(b)(ii): $name (unreadable) reaches cli.js even with a stamp present and source not newer (v2-F2)"
  else
    bad "§7(b)(ii): $name (unreadable) took the fast path — v2-F2 has regressed"
  fi
done

# (ii)(iv) i1-F2 (review/1169#1): relative-path.json exercises the
# "$src" == /* conjunct SPECIFICALLY. Unlike the two fixtures above (an
# absolute path that fails -f, and no src at all — both of which fall
# through even without that conjunct), this scenario gives -f "$src", a
# fresh stamp, AND the freshness check all their OWN, real, passing setup —
# a dedicated cwd holding the literal "relative/p.jsonl" and a stamp keyed
# on that same literal (source_key hashes the raw, unresolved string, never
# an absolute-resolved one — hooks/usage-capture.sh's own source_key()) —
# so the absolute-path conjunct is the ONLY thing standing between this
# case and the fast path. Without this setup, a relative fixture would fall
# through for the same reason the other two already do, and the assertion
# would not detect a regression of the "$src" == /* conjunct itself (the
# gap review/1169#1 flagged: the committed fixtures never actually drove
# this branch).
REL_ROOT="$(mktemp -d)"
REL_CWD="$(mktemp -d)"
mkdir -p "$REL_CWD/relative"
echo "fixture transcript content" > "$REL_CWD/relative/p.jsonl"
mkdir -p "$REL_ROOT/state/claude-code"
touch "$REL_ROOT/state/claude-code/$(source_key "relative/p.jsonl").stamp"
MARKER="$WORK_ROOT/marker-relative-path.json"
rm -f "$MARKER"
(cd "$REL_CWD" && STUB_MARKER="$MARKER" CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI="$STUB_DIR/marker-stub.js" \
  CREWRIG_USAGE_ROOT="$REL_ROOT" bash "$CAPTURE_ABS" claude-code Stop < "$FIXTURES_DIR/payloads/relative-path.json" >/dev/null 2>&1)
if [ -f "$MARKER" ]; then
  ok "§7(b)(ii): relative-path.json reaches cli.js even with -f/stamp/freshness all satisfied — only the absolute-path conjunct blocks it (i1-F2)"
else
  bad "§7(b)(ii): relative-path.json wrongly took the fast path — the \"\$src\" == /* guard has regressed (i1-F2)"
fi

# (iii) with the source NEWER than the stamp, the compact payload reaches cli.js.
NEWER_ROOT="$(mktemp -d)"
NEWER_SRC="$(mktemp)"
mkdir -p "$NEWER_ROOT/state/claude-code"
NEWER_STAMP="$NEWER_ROOT/state/claude-code/$(source_key "$NEWER_SRC").stamp"
touch "$NEWER_STAMP"
sleep 1.1
echo "appended, now newer than the stamp" >> "$NEWER_SRC"
MARKER="$WORK_ROOT/marker-newer"
rm -f "$MARKER"
payload="$(sed "s#__TRANSCRIPT_PATH__#$NEWER_SRC#" "$FIXTURES_DIR/payloads/compact-snake-case.json")"
STUB_MARKER="$MARKER" CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI="$STUB_DIR/marker-stub.js" \
  CREWRIG_USAGE_ROOT="$NEWER_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< "$payload" >/dev/null 2>&1
if [ -f "$MARKER" ]; then
  ok "§7(b)(iii): source newer than the stamp — the compact payload reaches cli.js"
else
  bad "§7(b)(iii): source newer than the stamp — the compact payload wrongly took the fast path"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §7(c) exit-0 contract (R15): node missing, nonexistent CLI override, throwing stub ==="

EXIT0_ROOT="$(mktemp -d)"
EXIT0_PAYLOAD='{"transcript_path":"/home/agent/does/not/exist/unused.jsonl"}'

MINIMAL_PATH="/usr/bin:/bin:/usr/sbin:/sbin"
OUT="$(CREWRIG_USAGE_ROOT="$EXIT0_ROOT" PATH="$MINIMAL_PATH" bash "$CAPTURE_ABS" claude-code Stop <<< "$EXIT0_PAYLOAD" 2>&1)"
RC=$?
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then
  ok "§7(c): node missing from PATH — exit 0, zero bytes of output"
else
  bad "§7(c): node missing from PATH — exit $RC, output: '$OUT'"
fi

OUT="$(CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI=/no/such/cli.js CREWRIG_USAGE_ROOT="$EXIT0_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< "$EXIT0_PAYLOAD" 2>&1)"
RC=$?
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then
  ok "§7(c): CREWRIG_USAGE_CAPTURE_CLI pointed at a nonexistent path — exit 0, zero bytes of output"
else
  bad "§7(c): nonexistent CLI override — exit $RC, output: '$OUT'"
fi

THROW_STUB_DIR="$(mktemp -d)"
cat > "$THROW_STUB_DIR/throw.js" <<'EOF'
throw new Error('deliberate throwing stub — scripts/tests/test-usage-capture.sh §7(c)');
EOF
OUT="$(CREWRIG_USAGE_CAPTURE_TEST=1 CREWRIG_USAGE_CAPTURE_CLI="$THROW_STUB_DIR/throw.js" CREWRIG_USAGE_ROOT="$EXIT0_ROOT" bash "$CAPTURE_ABS" claude-code Stop <<< "$EXIT0_PAYLOAD" 2>&1)"
RC=$?
if [ "$RC" -eq 0 ] && [ -z "$OUT" ]; then
  ok "§7(c): a throwing stub — exit 0, zero bytes of output"
else
  bad "§7(c): throwing stub — exit $RC, output: '$OUT'"
fi

# ---------------------------------------------------------------------------
echo
echo "=== §8 i1-F1: gemini-cli's three format generations derive pairwise-distinct formatFingerprint values ==="

# A FRESH CREWRIG_USAGE_ROOT, distinct from $FIXTURE_ROOT — §1 already
# derived from these same three fixture files against $FIXTURE_ROOT, and
# gemini-cli's jsonl generation is cursor-tracked (byteOffset keyed on the
# absolute source path), so reusing $FIXTURE_ROOT here would see the jsonl
# fixture as already fully consumed and derive zero records (R23
# idempotence — correct behavior, wrong root for what this section needs).
FP_ROOT="$(mktemp -d)"

fp_for() {
  local label="$1" transcript="$2"
  local outdir="$WORK_ROOT/fp-$label"
  local rc
  CREWRIG_USAGE_ROOT="$FP_ROOT" node $NODE_FLAGS "$DERIVE_JS" gemini-cli "$FIXTURES_DIR/gemini-cli/$transcript" --out "$outdir" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -ne 0 ] || [ ! -f "$outdir/rec-0.json" ]; then
    echo ""
    return
  fi
  jq -r '.provenance.formatFingerprint' "$outdir/rec-0.json"
}

FP_LEGACY="$(fp_for legacy-json legacy-json/session.json)"
FP_KINDSUM="$(fp_for json-kind-summary json-kind-summary/session.json)"
FP_JSONL="$(fp_for jsonl-set-journal jsonl-set-journal/session.jsonl)"

if [ -n "$FP_LEGACY" ] && [ -n "$FP_KINDSUM" ] && [ -n "$FP_JSONL" ] \
   && [ "$FP_LEGACY" != "$FP_KINDSUM" ] && [ "$FP_LEGACY" != "$FP_JSONL" ] && [ "$FP_KINDSUM" != "$FP_JSONL" ]; then
  ok "i1-F1: legacy-json/json-kind-summary/jsonl-set-journal formatFingerprint values are pairwise distinct"
else
  bad "i1-F1: expected three pairwise-distinct formatFingerprint values" \
    "legacy-json=$FP_LEGACY json-kind-summary=$FP_KINDSUM jsonl-set-journal=$FP_JSONL"
fi

# ---------------------------------------------------------------------------
echo
echo "=== Summary: $pass passed, $fail failed ==="
if [ "$fail" -gt 0 ]; then
  exit 1
fi
exit 0
