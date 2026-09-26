#!/usr/bin/env bash
# test-usage-pricing.sh — the no-daemon, no-network suite for the
# comparative-pricing engine (spec 0209 R38-R41, PLAN v2 step 12; plan/1172#2
# APPROVE review's named edit 1, the delta-01 R33 two-store ownership note
# https://github.com/crewrig/crewrig/issues/1172#issuecomment-5776029958). Cases
# 17-18 cover spec 0209 delta-01 R43-R48 and R50 (issue #1193); Case 17 calls
# the dashboard for the R47 agreement, and Case 19 extends it to a --period
# rollup narrowed by --task-key (issue #1205).
#
# Fully offline: CREWRIG_USAGE_ROOT is a fresh mktemp -d per case,
# MEMPALACE_PALACE_PATH a temp path with no token file, CREWRIG_USAGE_OFFLINE=1,
# CREWRIG_USAGE_CAPTURE_TEST=1, CREWRIG_USAGE_MIRROR=0. No daemon is ever
# contacted (no mirrored/ marker is ever created — pruneRecord() takes the
# pending-marker branch, an ENOENT no-op). The pinned price list is a ~9-entry
# hand-built fixture (scripts/tests/fixtures/usage-pricing/pricelist/
# fixture.json), never the 2.9 MB real LiteLLM blob; the two FX fixtures
# (fx/2026-09-18.json, fx/2026-09-21.json) carry the deliberate Friday/Monday
# gap PLAN v2 step 3 measured on the real ECB feed.
#
# Preflight: node on PATH and node_modules/ajv installed, or a FATAL and
# exit 2 — never a silent pass (test-usage-storage.sh l. 29-37 idiom).
#
# Mutation discipline (test-usage-storage.sh l. 16-19 / test-usage-attribution.sh
# l. 16-18's own convention): each named mutation edits a tracked module IN
# PLACE, proves the property goes red, then restores with `git checkout --`
# before the suite continues — never left mutated across cases. The end-to-end
# prune case (R37) exercises the REAL two-member derivedStores() registry
# (attribution-ledger + price-store, both shipped by DEV 0208/0209) directly —
# no synthetic third member is registered, unlike test-usage-attribution.sh's
# own registry case, because this ticket's own two real members are already
# what delta-01 R33's two-store criterion asks for.
#
# HOME safety (test-usage-storage.sh l. 62-79 idiom, applied to
# $HOME/.crewrig/usage rather than $HOME/.mempalace/server/): this suite never
# overrides HOME and never writes under the real usage root. A marker of
# $HOME/.crewrig/usage is captured before anything runs and re-asserted
# unchanged at the end.
#
# Usage:
#   bash scripts/tests/test-usage-pricing.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# --- R28-style HOME marker: capture BEFORE anything runs --------------------
REAL_HOME_USAGE_DIR="$HOME/.crewrig/usage"
if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  if [ ! -r "$REAL_HOME_USAGE_DIR" ]; then
    echo "FATAL: $REAL_HOME_USAGE_DIR exists but is not readable — refusing to assume it is empty." >&2
    exit 2
  fi
  HOME_USAGE_MARKER_BEFORE="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_BEFORE="<absent>"
fi

# --- Sandbox -------------------------------------------------------------
HELPERS_DIR="$(mktemp -d)"
MUTATION_GUARD_FILES="scripts/lib/usage-price/resolve.js scripts/lib/usage-price/compute.js scripts/lib/usage-price/fx.js scripts/lib/usage-price/store.js scripts/lib/usage-price/rollup.js scripts/lib/usage-store/rollup.js scripts/lib/usage-store/prune.js scripts/lib/usage-store/query.js"
CASE_ROOTS=""

# shellcheck disable=SC2329  # invoked via trap cleanup EXIT, not dead
cleanup() {
  for f in $MUTATION_GUARD_FILES; do
    if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
      git -C "$REPO_DIR" checkout -- "$f" 2>/dev/null || true
    fi
  done
  rm -rf "$HELPERS_DIR" 2>/dev/null || true
  for d in $CASE_ROOTS; do
    rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT

unset CREWRIG_USAGE_ROOT 2>/dev/null || true
export CREWRIG_USAGE_OFFLINE=1
export CREWRIG_USAGE_CAPTURE_TEST=1
export CREWRIG_USAGE_MIRROR=0
unset CREWRIG_USAGE_WING 2>/dev/null || true
unset CREWRIG_USAGE_ALLOW_PRUNED 2>/dev/null || true
unset PRICE_ORG_FILE 2>/dev/null || true
unset PRICE_CURRENCY 2>/dev/null || true
unset PRICE_AS_OF_TODAY 2>/dev/null || true
unset FX_INJECT_SEED_FILE 2>/dev/null || true

# Refuse to run against a dirty tree — the mutation-discipline phases below
# edit-then-restore tracked files, and a pre-existing diff would make
# "restore" ambiguous about which content is "clean".
for f in $MUTATION_GUARD_FILES; do
  if ! git -C "$REPO_DIR" diff --quiet -- "$f" 2>/dev/null; then
    echo "FATAL: $f has uncommitted changes — refusing to run mutation-discipline cases against a dirty tree." >&2
    exit 2
  fi
done

new_case_root() {
  local d
  d="$(mktemp -d)"
  CASE_ROOTS="$CASE_ROOTS $d"
  echo "$d"
}

FIXTURES_DIR="$SCRIPT_DIR/tests/fixtures/usage-pricing"

# --- Node driver -----------------------------------------------------------
DRIVER="$HELPERS_DIR/driver.js"
cat > "$DRIVER" <<'NODE_EOF'
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_DIR = process.env.USAGE_TEST_REPO_DIR;
if (!REPO_DIR) {
  console.error('FATAL: USAGE_TEST_REPO_DIR not set');
  process.exit(2);
}

function req(rel) {
  return require(path.join(REPO_DIR, rel));
}

function envOr(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function deriveRecordId(sessionId, idempotencyKey) {
  return crypto.createHash('sha256').update(`${sessionId}\x1F${idempotencyKey}`).digest('hex');
}

function loadOrg() {
  const orgFile = process.env.PRICE_ORG_FILE;
  if (!orgFile) return { entries: {}, copilot: {} };
  const parsed = JSON.parse(fs.readFileSync(orgFile, 'utf8'));
  return { entries: parsed.entries || {}, copilot: parsed.copilot || {} };
}

// pin <fixturesDir> — writes the pinned fixture price list into CREWRIG_USAGE_ROOT.
function cmdPin() {
  const layout = req('scripts/lib/usage-store/layout.js');
  const fixturesDir = process.argv[3];
  const blob = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'pricelist', 'fixture.json'), 'utf8'));
  const pointer = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'pricelist', 'PINNED.json'), 'utf8'));
  fs.mkdirSync(layout.pricelistDir(), { recursive: true });
  fs.writeFileSync(path.join(layout.pricelistDir(), `${pointer.sha}.json`), JSON.stringify(blob));
  fs.writeFileSync(layout.pinnedPointer(), JSON.stringify(pointer, null, 2));
  console.log(`PINNED sha=${pointer.sha}`);
}

// seed-fx <fixingFixtureFile> — copies a fixed ECB fixing fixture into the fx
// cache at its own date-named path.
function cmdSeedFx() {
  const layout = req('scripts/lib/usage-store/layout.js');
  const srcFile = process.argv[3];
  const fixing = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  const dir = path.join(layout.fxDir(), 'ecb');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${fixing.date}.json`), JSON.stringify(fixing));
  console.log(`SEEDED ${fixing.date}`);
}

// make-record — env-var driven synthetic usage record generator (mirrors
// test-usage-storage.sh's own driver). recordId is always derived honestly
// (sha256(sessionId + U+001F + idempotencyKey)), per docs/usage-record-format.md.
function cmdMakeRecord() {
  const kind = envOr('MR_KIND', 'captured');
  const cli = envOr('MR_CLI', 'claude-code');
  const session = envOr('MR_SESSION', 'test-session');
  const idemKey = envOr('MR_IDEMKEY', 'test-idem-key');
  const projectRoot = envOr('MR_PROJECT_ROOT', '/home/agent/workspaces/crewrig');
  const requestInstant = envOr('MR_REQUEST_INSTANT', new Date().toISOString());
  const captureInstant = envOr('MR_CAPTURE_INSTANT', requestInstant);
  const fidelity = envOr('MR_FIDELITY', 'per-request');
  const recordId = deriveRecordId(session, idemKey);

  const record = {
    schemaVersion: '1.0.0',
    kind,
    fidelity,
    recordId,
    idempotencyKey: idemKey,
    provenance: {
      cli,
      cliVersion: '1.0.0',
      captureChannel: 'test-fixture',
      formatFingerprint: `sha256:${'0'.repeat(32)}`,
    },
    identity: {
      sessionId: session,
      parentSessionId: envOr('MR_PARENT_SESSION', null) || null,
      agentId: envOr('MR_AGENT_ID', null) || null,
      projectRoot,
    },
    timing: { requestInstant, captureInstant },
  };

  if (kind === 'captured') {
    record.modelId = envOr('MR_MODEL_ID', 'claude-sonnet-5');
    record.interaction = envOr('MR_INTERACTION', 'user-turn');
    const cacheWriteJson = process.env.MR_CACHE_WRITE_JSON;
    record.tokens = {
      netInput: Number(envOr('MR_NET_INPUT', '100')),
      cacheRead: Number(envOr('MR_CACHE_READ', '0')),
      cacheWrite: cacheWriteJson ? JSON.parse(cacheWriteJson) : Number(envOr('MR_CACHE_WRITE', '0')),
      output: Number(envOr('MR_OUTPUT', '50')),
      reasoning: Number(envOr('MR_REASONING', '0')),
    };
    record.raw = { vendor: 'test-fixture', usage: {} };
    record.rawStatus = 'complete';
  } else {
    record.uncapturedReason = envOr('MR_UNCAPTURED_REASON', 'test-fixture uncaptured reason');
  }

  process.stdout.write(JSON.stringify(record));
}

function cmdWrite() {
  const file = process.argv[3];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const journal = req('scripts/lib/usage-store/journal.js');
  const result = journal.write(record);
  console.log(`STATUS=${result.status}`);
  if (result.reason) console.log(`REASON=${result.reason}`);
}

// compute-price <recordFile> — the PURE computation, no cache read, no write:
// store.computePriceObject() directly. Used for arithmetic-only assertions
// that do not need storage semantics.
function cmdComputePrice() {
  const file = process.argv[3];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = req('scripts/lib/usage-price/store.js');
  const opts = { currency: envOr('PRICE_CURRENCY', 'USD'), org: loadOrg() };
  store.computePriceObject(record, opts).then((p) => process.stdout.write(JSON.stringify(p)));
}

// resolve-and-compute <recordFile> — resolve.resolve() + compute.computeUsd()
// called DIRECTLY (bypassing store.computePriceObject(), which folds
// compute.computeUsd()'s per-component breakdown into just amountUsd plus
// the two flag arrays and never forwards `components` itself). Used for
// assertions that need to see WHICH field/tier/threshold priced a component,
// not only the aggregate amount.
function cmdResolveAndCompute() {
  const file = process.argv[3];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pricelist = req('scripts/lib/usage-price/pricelist.js');
  const resolveModel = req('scripts/lib/usage-price/resolve.js');
  const compute = req('scripts/lib/usage-price/compute.js');
  const snapshot = pricelist.pinned();
  const org = loadOrg();
  const resolved = resolveModel.resolve(record.modelId, { pricelist: snapshot, org });
  if (resolved.unpriced) {
    process.stdout.write(JSON.stringify({ unpriced: true, step: resolved.step, reason: resolved.reason }));
    return;
  }
  const computed = compute.computeUsd(record, resolved.entry);
  process.stdout.write(JSON.stringify({ resolution: { step: resolved.step, entryKey: resolved.entryKey, family: resolved.family }, ...computed }));
}

// price-record <recordFile> — the cache-aware read-through path:
// store.priceRecord(). Used for storage-semantics assertions (three
// timestamps, --as-of-today).
function cmdPriceRecord() {
  const file = process.argv[3];
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const store = req('scripts/lib/usage-price/store.js');
  const opts = {
    currency: envOr('PRICE_CURRENCY', 'USD'),
    asOfToday: process.env.PRICE_AS_OF_TODAY === '1',
    org: loadOrg(),
  };
  store.priceRecord(record, opts).then((p) => process.stdout.write(JSON.stringify(p)));
}

function cmdResolve() {
  const modelId = process.argv[3];
  const pricelist = req('scripts/lib/usage-price/pricelist.js');
  const resolveModel = req('scripts/lib/usage-price/resolve.js');
  const snapshot = pricelist.pinned();
  const org = loadOrg();
  const result = resolveModel.resolve(modelId, { pricelist: snapshot, org });
  process.stdout.write(JSON.stringify(result));
}

// fx-resolve <date> — fx.resolve(date, ctx). When FX_INJECT_SEED_FILE is set,
// ctx.fetchFixings is an in-process, no-network injected fetcher that writes
// that ONE fixture fixing file into the cache and counts its own calls.
function cmdFxResolve() {
  const date = process.argv[3];
  const fx = req('scripts/lib/usage-price/fx.js');
  const layout = req('scripts/lib/usage-store/layout.js');
  let calls = 0;
  const ctx = {};
  const injectSeedFile = process.env.FX_INJECT_SEED_FILE;
  if (injectSeedFile) {
    ctx.fetchFixings = async () => {
      calls += 1;
      const fixing = JSON.parse(fs.readFileSync(injectSeedFile, 'utf8'));
      const dir = path.join(layout.fxDir(), 'ecb');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${fixing.date}.json`), JSON.stringify(fixing));
      return { source: 'injected', fixingsWritten: 1 };
    };
  }
  fx.resolve(date, ctx).then((r) => {
    console.log(JSON.stringify(r));
    console.log(`FETCHER_CALLS=${calls}`);
  });
}

function cmdRollup() {
  const period = process.argv[3];
  const cli = process.argv[4];
  const priceRollup = req('scripts/lib/usage-price/rollup.js');
  priceRollup.rollup({ period, cli }, { combined: true }).then((r) => console.log(JSON.stringify(r)));
}

function cmdPeriodOf() {
  const file = process.argv[3];
  const layout = req('scripts/lib/usage-store/layout.js');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(layout.period(record));
}

// plant-price <recordFile> <priceJsonFile> — writes a price file verbatim at
// the record's own layout.priceEntry() path (Case 19g's pre-delta entry).
function cmdPlantPrice() {
  const layout = req('scripts/lib/usage-store/layout.js');
  const record = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const price = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const filePath = layout.priceEntry(record.provenance.cli, layout.period(record), record.recordId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(price, null, 2));
  console.log(`PLANTED ${filePath}`);
}

// rollup-fetch-count <period> <currency> — two rollup() passes in ONE process
// with the freshness gate live (CREWRIG_USAGE_OFFLINE deleted in-process) and
// an injected ctx.fetchFixings that counts its calls and always fails as a
// network error would. Prints each pass's result, then FETCHER_CALLS=<n>.
async function cmdRollupFetchCount() {
  const period = process.argv[3];
  const currency = process.argv[4];
  delete process.env.CREWRIG_USAGE_OFFLINE;
  const priceRollup = req('scripts/lib/usage-price/rollup.js');
  let calls = 0;
  const fetchFixings = async () => {
    calls += 1;
    throw new Error('injected network error');
  };
  const opts = { combined: true, currency, ctx: { fetchFixings } };
  for (let pass = 1; pass <= 2; pass++) {
    calls = 0;
    const r = await priceRollup.rollup({ period }, opts);
    console.log(JSON.stringify(r));
    console.log(`FETCHER_CALLS=${calls}`);
  }
}

function main() {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'pin':
      return cmdPin();
    case 'seed-fx':
      return cmdSeedFx();
    case 'make-record':
      return cmdMakeRecord();
    case 'write':
      return cmdWrite();
    case 'compute-price':
      return cmdComputePrice();
    case 'resolve-and-compute':
      return cmdResolveAndCompute();
    case 'price-record':
      return cmdPriceRecord();
    case 'resolve':
      return cmdResolve();
    case 'fx-resolve':
      return cmdFxResolve();
    case 'rollup':
      return cmdRollup();
    case 'period-of':
      return cmdPeriodOf();
    case 'plant-price':
      return cmdPlantPrice();
    case 'rollup-fetch-count':
      return cmdRollupFetchCount();
    default:
      console.error(`unknown driver command: ${cmd}`);
      process.exit(2);
  }
}

main();
NODE_EOF

export USAGE_TEST_REPO_DIR="$REPO_DIR"

run_driver() {
  node --disable-warning=ExperimentalWarning "$DRIVER" "$@"
}

jget() {
  # $1 = JSON string, $2 = a JS expression over `v` (the parsed value)
  node -e "const v = JSON.parse(process.argv[1]); console.log(eval(process.argv[2]))" "$1" "$2"
}

# new_root_and_pin_into <varname> — creates a fresh case root, exports
# CREWRIG_USAGE_ROOT/MEMPALACE_PALACE_PATH in the CURRENT shell (never called
# via a $(...) capture, which would fork a subshell and silently discard the
# exports), pins the fixture price list into it, and assigns the root path to
# the named variable.
new_root_and_pin_into() {
  local __var="$1"
  local d
  d="$(new_case_root)"
  export CREWRIG_USAGE_ROOT="$d"
  export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
  run_driver pin "$FIXTURES_DIR" >/dev/null
  eval "$__var=\"\$d\""
}

echo "=== usage-pricing suite (spec 0209 R38-R41) ==="
echo "FIXTURES_DIR=$FIXTURES_DIR"

# =============================================================================
# Case 1 — Family fallback carries ~ (R13)
# =============================================================================
echo
echo "=== Case 1: family fallback carries ~ (R13) ==="
new_root_and_pin_into CASE1_ROOT

r1_resolve="$(run_driver resolve "gemini-3.8-pro")"
r1_family="$(jget "$r1_resolve" 'v.family')"
r1_entry_key="$(jget "$r1_resolve" 'v.entryKey')"
if [ "$r1_family" = "true" ] && [ "$r1_entry_key" = "gemini-3.8-flash" ]; then
  ok "gemini-3.8-pro resolves via family fallback to gemini-3.8-flash, flagged family:true"
else
  bad "gemini-3.8-pro did not resolve via a flagged family fallback" "$r1_resolve"
fi

RESOLVE_JS="$REPO_DIR/scripts/lib/usage-price/resolve.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'family: followed.step === \'family\',';
if (!src.includes(needle)) { console.error('FATAL: finalize() family-flag marker not found in resolve.js'); process.exit(1); }
src = src.replace(needle, 'family: false, // MUTATION: family-fallback flag flipped off');
fs.writeFileSync(p, src);
" "$RESOLVE_JS"
mut1_resolve="$(run_driver resolve "gemini-3.8-pro")"
git -C "$REPO_DIR" checkout -- "$RESOLVE_JS"
mut1_family="$(jget "$mut1_resolve" 'v.family')"
if [ "$mut1_family" = "false" ]; then
  ok "MUTATION RED: flipping the family flag off makes gemini-3.8-pro's family:false"
else
  bad "MUTATION not red: family flag still reads true" "$mut1_resolve"
fi
if git -C "$REPO_DIR" diff --quiet -- "$RESOLVE_JS"; then
  ok "resolve.js is restored after Case 1's mutation"
else
  bad "resolve.js was NOT fully restored after Case 1's mutation"
fi

# =============================================================================
# Case 2 — 1-hour tier picks the _above_1hr field, not the base one (R14/R39)
# =============================================================================
echo
echo "=== Case 2: 1-hour cache-write tier picks …_above_1hr (R14/R39) ==="
CASE2_RECORD="$HELPERS_DIR/case2-record.json"
MR_MODEL_ID="claude-sonnet-4-5" MR_NET_INPUT=1000 MR_CACHE_WRITE_JSON='{"1hr":500}' MR_OUTPUT=100 \
  run_driver make-record > "$CASE2_RECORD"
c2_price="$(run_driver resolve-and-compute "$CASE2_RECORD")"
c2_field="$(jget "$c2_price" "v.components.cacheWrite[0].field")"
c2_amount="$(jget "$c2_price" "v.amountUsd")"
if [ "$c2_field" = "cache_creation_input_token_cost_above_1hr" ] && [ "$c2_amount" = "0.0075" ]; then
  ok "1-hour tier priced at cache_creation_input_token_cost_above_1hr (amountUsd=0.0075)"
else
  bad "1-hour tier did not price at the _above_1hr field" "$c2_price"
fi

COMPUTE_JS="$REPO_DIR/scripts/lib/usage-price/compute.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`function cacheWriteBaseField(tierKey) {
  if (tierKey && /^(1h|1hr|3600)\\\$/i.test(tierKey)) return 'cache_creation_input_token_cost_above_1hr';
  return 'cache_creation_input_token_cost';
}\`;
if (!src.includes(needle)) { console.error('FATAL: cacheWriteBaseField marker not found in compute.js'); process.exit(1); }
src = src.replace(needle, \`function cacheWriteBaseField(tierKey) {
  return 'cache_creation_input_token_cost'; // MUTATION: swapped for the base field
}\`);
fs.writeFileSync(p, src);
" "$COMPUTE_JS"
mut2_price="$(run_driver resolve-and-compute "$CASE2_RECORD")"
git -C "$REPO_DIR" checkout -- "$COMPUTE_JS"
mut2_field="$(jget "$mut2_price" "v.components.cacheWrite[0].field")"
if [ "$mut2_field" = "cache_creation_input_token_cost" ]; then
  ok "MUTATION RED: swapping cacheWriteBaseField for the base field prices at cache_creation_input_token_cost instead"
else
  bad "MUTATION not red: cacheWrite field is still the _above_1hr one" "$mut2_price"
fi
if git -C "$REPO_DIR" diff --quiet -- "$COMPUTE_JS"; then
  ok "compute.js is restored after Case 2's mutation"
else
  bad "compute.js was NOT fully restored after Case 2's mutation"
fi

# =============================================================================
# Case 3 — Compound threshold composes on the R14-selected field, never the
# base one (R14/R18/R39)
# =============================================================================
echo
echo "=== Case 3: compound cache_creation_input_token_cost_above_1hr_above_200k_tokens composes on the R14-selected field (R14/R18/R39) ==="
CASE3_RECORD="$HELPERS_DIR/case3-record.json"
MR_MODEL_ID="claude-sonnet-4-5" MR_NET_INPUT=250000 MR_CACHE_WRITE_JSON='{"1hr":1000}' MR_OUTPUT=100 \
  run_driver make-record > "$CASE3_RECORD"
c3_price="$(run_driver resolve-and-compute "$CASE3_RECORD")"
c3_field="$(jget "$c3_price" "v.components.cacheWrite[0].field")"
c3_net_field="$(jget "$c3_price" "v.components.netInput.field")"
if [ "$c3_field" = "cache_creation_input_token_cost_above_1hr_above_200k_tokens" ] && [ "$c3_net_field" = "input_cost_per_token_above_200k_tokens" ]; then
  ok "the compound field composes on the R14-selected (1hr) field, not the base cache-write field"
else
  bad "the compound field did not compose on the R14-selected field" "$c3_price"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`function siblingField(baseField, threshold) {
  return \\\`\\\${baseField}_above_\\\${suffixFor(threshold)}_tokens\\\`;
}\`;
if (!src.includes(needle)) { console.error('FATAL: siblingField marker not found in compute.js'); process.exit(1); }
const replacement = \`function siblingField(baseField, threshold) {
  return \\\`cache_creation_input_token_cost_above_\\\${suffixFor(threshold)}_tokens\\\`; // MUTATION: sibling of the BASE field name, never the R14-selected one
}\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$COMPUTE_JS"
mut3_price="$(run_driver resolve-and-compute "$CASE3_RECORD")"
git -C "$REPO_DIR" checkout -- "$COMPUTE_JS"
mut3_field="$(jget "$mut3_price" "v.components.cacheWrite[0].field")"
if [ "$mut3_field" != "cache_creation_input_token_cost_above_1hr_above_200k_tokens" ]; then
  ok "MUTATION RED: looking the sibling up from the base field name loses the compound composition"
else
  bad "MUTATION not red: the compound field is still selected" "$mut3_price"
fi
if git -C "$REPO_DIR" diff --quiet -- "$COMPUTE_JS"; then
  ok "compute.js is restored after Case 3's mutation"
else
  bad "compute.js was NOT fully restored after Case 3's mutation"
fi

# =============================================================================
# Case 4 — Reasoning never added on top of output (R16/R39)
# =============================================================================
echo
echo "=== Case 4: reasoning never added on top of output (R16/R39) ==="
CASE4_EQ_RECORD="$HELPERS_DIR/case4-eq-record.json"
MR_MODEL_ID="gemini-3.8-flash" MR_NET_INPUT=100 MR_OUTPUT=50 MR_REASONING=20 \
  run_driver make-record > "$CASE4_EQ_RECORD"
c4_eq_price="$(run_driver compute-price "$CASE4_EQ_RECORD")"
c4_eq_unpriced="$(jget "$c4_eq_price" "JSON.stringify(v.unpricedComponents)")"
c4_eq_amount="$(jget "$c4_eq_price" "v.amountUsd")"
if [ "$c4_eq_unpriced" = '[]' ] && [ "$c4_eq_amount" = "0.000044999999999999996" ]; then
  ok "reasoning-equal entry: no divergence flag, no separate reasoning cost (amountUsd=0.000045)"
else
  bad "reasoning-equal entry did not price as expected" "$c4_eq_price"
fi

CASE4_DIV_RECORD="$HELPERS_DIR/case4-div-record.json"
MR_MODEL_ID="dashscope/reasoning-diverge-model" MR_NET_INPUT=100 MR_OUTPUT=50 MR_REASONING=20 \
  run_driver make-record > "$CASE4_DIV_RECORD"
c4_div_price="$(run_driver compute-price "$CASE4_DIV_RECORD")"
c4_div_unpriced="$(jget "$c4_div_price" "JSON.stringify(v.unpricedComponents)")"
c4_div_amount="$(jget "$c4_div_price" "v.amountUsd")"
if [ "$c4_div_unpriced" = '["reasoning-rate-divergence"]' ] && [ "$c4_div_amount" = "0.00019999999999999998" ]; then
  ok "reasoning-divergent entry: flagged reasoning-rate-divergence, still no separate reasoning cost charged"
else
  bad "reasoning-divergent entry did not price as expected" "$c4_div_price"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`  if (reasoning > 0 && reasoningRate !== undefined && outputRate !== undefined && reasoningRate !== outputRate) {
    unpricedComponents.push('reasoning-rate-divergence');
  }\`;
if (!src.includes(needle)) { console.error('FATAL: reasoning-divergence marker not found in compute.js'); process.exit(1); }
const replacement = \`  if (reasoning > 0 && reasoningRate !== undefined && outputRate !== undefined && reasoningRate !== outputRate) {
    unpricedComponents.push('reasoning-rate-divergence');
    amountUsd += reasoning * reasoningRate; // MUTATION: reasoning added on top of output
  }\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$COMPUTE_JS"
mut4_price="$(run_driver compute-price "$CASE4_DIV_RECORD")"
git -C "$REPO_DIR" checkout -- "$COMPUTE_JS"
mut4_amount="$(jget "$mut4_price" "v.amountUsd")"
if [ "$mut4_amount" != "$c4_div_amount" ]; then
  ok "MUTATION RED: adding a reasoning term changes the price ($c4_div_amount -> $mut4_amount)"
else
  bad "MUTATION not red: amountUsd unchanged after adding a reasoning term" "$mut4_price"
fi
if git -C "$REPO_DIR" diff --quiet -- "$COMPUTE_JS"; then
  ok "compute.js is restored after Case 4's mutation"
else
  bad "compute.js was NOT fully restored after Case 4's mutation"
fi

# =============================================================================
# Case 5 — the long-context override applies to the whole request, not only
# the tokens above the threshold (R18/R39)
# =============================================================================
echo
echo "=== Case 5: _above_200k applies to the whole request (R18/R39) ==="
CASE5_RECORD="$HELPERS_DIR/case5-record.json"
MR_MODEL_ID="claude-sonnet-4-5" MR_NET_INPUT=250000 MR_CACHE_WRITE=0 MR_OUTPUT=100 \
  run_driver make-record > "$CASE5_RECORD"
c5_price="$(run_driver resolve-and-compute "$CASE5_RECORD")"
c5_net_amount="$(jget "$c5_price" "v.components.netInput.amountUsd")"
if [ "$c5_net_amount" = "1.5" ]; then
  ok "the whole 250000-token request prices at the override rate (netInput amountUsd=1.5)"
else
  bad "the override rate was not applied to the whole request" "$c5_price"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`  if (netInput > 0) {
    const picked = rateFor(entry, 'input_cost_per_token', threshold);
    if (picked) {
      const amt = netInput * picked.rate;\`;
if (!src.includes(needle)) { console.error('FATAL: netInput pricing marker not found in compute.js'); process.exit(1); }
const replacement = \`  if (netInput > 0) {
    const picked = rateFor(entry, 'input_cost_per_token', threshold);
    if (picked) {
      const amt = (threshold !== null && picked.field !== 'input_cost_per_token') ? (netInput - threshold) * picked.rate : netInput * picked.rate; // MUTATION: excess tokens only\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$COMPUTE_JS"
mut5_price="$(run_driver resolve-and-compute "$CASE5_RECORD")"
git -C "$REPO_DIR" checkout -- "$COMPUTE_JS"
mut5_net_amount="$(jget "$mut5_price" "v.components.netInput.amountUsd")"
if [ "$mut5_net_amount" = "0.3" ]; then
  ok "MUTATION RED: pricing only the excess (50000 tokens) yields 0.3 instead of the whole-request 1.5"
else
  bad "MUTATION not red: netInput amountUsd unchanged" "$mut5_price"
fi
if git -C "$REPO_DIR" diff --quiet -- "$COMPUTE_JS"; then
  ok "compute.js is restored after Case 5's mutation"
else
  bad "compute.js was NOT fully restored after Case 5's mutation"
fi

# =============================================================================
# Case 6 — fixing search direction: the most recent fixing ON OR BEFORE the
# computation date, never one after it (R22/R40)
# =============================================================================
echo
echo "=== Case 6: fixing search direction (R22/R40) ==="
FX_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$FX_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-21.json" >/dev/null

c6_out="$(run_driver fx-resolve "2026-09-19")"
c6_fixing_date="$(echo "$c6_out" | head -1 | jget "$(echo "$c6_out" | head -1)" "v.fixingDate")"
if [ "$c6_fixing_date" = "2026-09-18" ]; then
  ok "the deliberate gap resolves to the previous fixing (2026-09-18), never the later one"
else
  bad "fixing search picked the wrong direction" "$c6_out"
fi

FX_JS="$REPO_DIR/scripts/lib/usage-price/fx.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`function selectFixing(date) {
  const dates = listCachedDates();
  let chosen = null;
  for (const d of dates) {
    if (d <= date) chosen = d;
    else break;
  }
  return chosen;
}\`;
if (!src.includes(needle)) { console.error('FATAL: selectFixing marker not found in fx.js'); process.exit(1); }
const replacement = \`function selectFixing(date) {
  const dates = listCachedDates();
  for (const d of dates) {
    if (d >= date) return d; // MUTATION: next fixing instead of previous
  }
  return null;
}\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$FX_JS"
mut6_out="$(run_driver fx-resolve "2026-09-19")"
git -C "$REPO_DIR" checkout -- "$FX_JS"
mut6_fixing_date="$(jget "$(echo "$mut6_out" | head -1)" "v.fixingDate")"
if [ "$mut6_fixing_date" = "2026-09-21" ]; then
  ok "MUTATION RED: reversing the direction picks the later (wrong) fixing 2026-09-21"
else
  bad "MUTATION not red: direction unchanged" "$mut6_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$FX_JS"; then
  ok "fx.js is restored after Case 6's mutation"
else
  bad "fx.js was NOT fully restored after Case 6's mutation"
fi

# =============================================================================
# Case 7 — the freshness gate: a fetch is attempted (injected, no network)
# when the cache cannot prove it holds the newest published fixing (R22/R29/R40)
# =============================================================================
echo
echo "=== Case 7: fixing freshness gate (R22/R29/R40) ==="
GATE_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$GATE_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null

# The gate case runs WITHOUT CREWRIG_USAGE_OFFLINE=1 — resolve() takes the
# offline branch unconditionally when that flag is set, never even
# consulting ctx.fetchFixings, so the injected-fetcher path this case
# exercises requires the flag unset for this one invocation only.
unset CREWRIG_USAGE_OFFLINE
export FX_INJECT_SEED_FILE="$FIXTURES_DIR/fx/2026-09-21.json"
c7_out="$(run_driver fx-resolve "2026-09-21")"
unset FX_INJECT_SEED_FILE
export CREWRIG_USAGE_OFFLINE=1
c7_fixing_date="$(jget "$(echo "$c7_out" | sed -n '1p')" "v.fixingDate")"
c7_has_staleness="$(jget "$(echo "$c7_out" | sed -n '1p')" "Object.prototype.hasOwnProperty.call(v, 'fxStaleness')")"
c7_calls="$(echo "$c7_out" | sed -n '2p')"
if [ "$c7_fixing_date" = "2026-09-21" ] && [ "$c7_has_staleness" = "false" ] && [ "$c7_calls" = "FETCHER_CALLS=1" ]; then
  ok "the gate fires, refreshes once (injected, no network), and resolves the live 2026-09-21 fixing with no fxStaleness"
else
  bad "the freshness gate did not behave as expected" "$c7_out"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'const gateFires = !newest || newest < date;';
if (!src.includes(needle)) { console.error('FATAL: gateFires marker not found in fx.js'); process.exit(1); }
src = src.replace(needle, 'const gateFires = !newest; // MUTATION: gate never fires when the cache is non-empty');
fs.writeFileSync(p, src);
" "$FX_JS"
MUT7_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$MUT7_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null
unset CREWRIG_USAGE_OFFLINE
export FX_INJECT_SEED_FILE="$FIXTURES_DIR/fx/2026-09-21.json"
mut7_out="$(run_driver fx-resolve "2026-09-21")"
unset FX_INJECT_SEED_FILE
export CREWRIG_USAGE_OFFLINE=1
git -C "$REPO_DIR" checkout -- "$FX_JS"
mut7_fixing_date="$(jget "$(echo "$mut7_out" | sed -n '1p')" "v.fixingDate")"
mut7_calls="$(echo "$mut7_out" | sed -n '2p')"
if [ "$mut7_fixing_date" = "2026-09-18" ] && [ "$mut7_calls" = "FETCHER_CALLS=0" ]; then
  ok "MUTATION RED: with the gate neutralized, no refresh is attempted and the stale 2026-09-18 fixing is used silently"
else
  bad "MUTATION not red: the gate still fired" "$mut7_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$FX_JS"; then
  ok "fx.js is restored after Case 7's mutation"
else
  bad "fx.js was NOT fully restored after Case 7's mutation"
fi

# =============================================================================
# Case 8 — fxStaleness is present whenever the gate fired but the refresh was
# suppressed (R22/R41)
# =============================================================================
echo
echo "=== Case 8: fxStaleness present when the gate is suppressed (R22/R41) ==="
SUPPRESS_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$SUPPRESS_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null

c8_out="$(run_driver fx-resolve "2026-09-21")"
c8_fixing_date="$(jget "$(echo "$c8_out" | sed -n '1p')" "v.fixingDate")"
c8_age_days="$(jget "$(echo "$c8_out" | sed -n '1p')" "v.fxStaleness && v.fxStaleness.ageDays")"
c8_reason="$(jget "$(echo "$c8_out" | sed -n '1p')" "v.fxStaleness && v.fxStaleness.reason")"
c8_calls="$(echo "$c8_out" | sed -n '2p')"
if [ "$c8_fixing_date" = "2026-09-18" ] && [ "$c8_age_days" = "3" ] && [ "$c8_reason" = "offline" ] && [ "$c8_calls" = "FETCHER_CALLS=0" ]; then
  ok "CREWRIG_USAGE_OFFLINE=1 suppresses the refresh, resolves at 2026-09-18, and stamps fxStaleness {ageDays:3, reason:offline}"
else
  bad "the suppression case did not behave as expected" "$c8_out"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`  if (staleReason) {
    result.fxStaleness = {\`;
if (!src.includes(needle)) { console.error('FATAL: fxStaleness-attach marker not found in fx.js'); process.exit(1); }
src = src.replace(needle, \`  if (false && staleReason) { // MUTATION: omit fxStaleness even when the gate was suppressed
    result.fxStaleness = {\`);
fs.writeFileSync(p, src);
" "$FX_JS"
mut8_out="$(run_driver fx-resolve "2026-09-21")"
git -C "$REPO_DIR" checkout -- "$FX_JS"
mut8_has_staleness="$(jget "$(echo "$mut8_out" | sed -n '1p')" "Object.prototype.hasOwnProperty.call(v, 'fxStaleness')")"
if [ "$mut8_has_staleness" = "false" ]; then
  ok "MUTATION RED: fxStaleness is silently omitted under CREWRIG_USAGE_OFFLINE=1"
else
  bad "MUTATION not red: fxStaleness is still present" "$mut8_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$FX_JS"; then
  ok "fx.js is restored after Case 8's mutation"
else
  bad "fx.js was NOT fully restored after Case 8's mutation"
fi

# =============================================================================
# Case 9 — every computed price carries its three timestamps (R27/R41)
# =============================================================================
echo
echo "=== Case 9: three timestamps present (R27/R41) ==="
new_root_and_pin_into C9_ROOT
run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-21.json" >/dev/null

TODAY_INSTANT="$(node -e "console.log(new Date().toISOString())")"
C9_RECORD="$HELPERS_DIR/case9-record.json"
MR_SESSION="case9-session" MR_IDEMKEY="case9-key" MR_REQUEST_INSTANT="$TODAY_INSTANT" \
  MR_MODEL_ID="claude-sonnet-5" run_driver make-record > "$C9_RECORD"

c9_price="$(PRICE_CURRENCY=EUR run_driver price-record "$C9_RECORD")"
c9_sha="$(jget "$c9_price" "v.snapshot && v.snapshot.sha")"
c9_fixing="$(jget "$c9_price" "v.fixingDate")"
c9_computed_at="$(jget "$c9_price" "v.computedAt")"
if [ -n "$c9_sha" ] && [ "$c9_sha" != "undefined" ] && [ -n "$c9_fixing" ] && [ "$c9_fixing" != "null" ] && [ -n "$c9_computed_at" ] && [ "$c9_computed_at" != "undefined" ]; then
  ok "the price carries snapshot.sha, fixingDate, and computedAt"
else
  bad "one of the three timestamps is missing" "$c9_price"
fi

STORE_JS="$REPO_DIR/scripts/lib/usage-price/store.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`    fixingDate: null,
    computedAt,
    resolution,\`;
if (!src.includes(needle)) { console.error('FATAL: computedAt marker not found in store.js'); process.exit(1); }
src = src.replace(needle, \`    fixingDate: null,
    resolution, // MUTATION: computedAt dropped from the price object\`);
fs.writeFileSync(p, src);
" "$STORE_JS"
C9_RECORD_MUT="$HELPERS_DIR/case9-record-mut.json"
MR_SESSION="case9-session-mut" MR_IDEMKEY="case9-key-mut" MR_REQUEST_INSTANT="$TODAY_INSTANT" \
  MR_MODEL_ID="claude-sonnet-5" run_driver make-record > "$C9_RECORD_MUT"
mut9_price="$(PRICE_CURRENCY=EUR run_driver price-record "$C9_RECORD_MUT")"
git -C "$REPO_DIR" checkout -- "$STORE_JS"
mut9_has_computed_at="$(jget "$mut9_price" "Object.prototype.hasOwnProperty.call(v, 'computedAt')")"
if [ "$mut9_has_computed_at" = "false" ]; then
  ok "MUTATION RED: dropping computedAt from the object literal removes it from the stored price"
else
  bad "MUTATION not red: computedAt is still present" "$mut9_price"
fi
if git -C "$REPO_DIR" diff --quiet -- "$STORE_JS"; then
  ok "store.js is restored after Case 9's mutation"
else
  bad "store.js was NOT fully restored after Case 9's mutation"
fi

# =============================================================================
# Case 10 — --as-of-today re-resolves all three timestamps, never carrying a
# stored computedAt forward (R28/R41)
# =============================================================================
echo
echo "=== Case 10: --as-of-today re-resolves (R28/R41) ==="
new_root_and_pin_into C10_ROOT
C10_RECORD="$HELPERS_DIR/case10-record.json"
MR_SESSION="case10-session" MR_IDEMKEY="case10-key" MR_MODEL_ID="claude-sonnet-5" run_driver make-record > "$C10_RECORD"

c10_price1="$(run_driver price-record "$C10_RECORD")"
sleep 1.1
c10_price2="$(PRICE_AS_OF_TODAY=1 run_driver price-record "$C10_RECORD")"
c10_computed1="$(jget "$c10_price1" "v.computedAt")"
c10_computed2="$(jget "$c10_price2" "v.computedAt")"
if [ "$c10_computed1" != "$c10_computed2" ]; then
  ok "--as-of-today re-resolves a fresh computedAt ($c10_computed1 -> $c10_computed2)"
else
  bad "--as-of-today did not re-resolve computedAt" "price1=$c10_price1 price2=$c10_price2"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'if (!asOfToday && fs.existsSync(filePath)) {';
if (!src.includes(needle)) { console.error('FATAL: asOfToday-bypass marker not found in store.js'); process.exit(1); }
src = src.replace(needle, 'if (fs.existsSync(filePath)) { // MUTATION: --as-of-today no longer bypasses the stored cache');
fs.writeFileSync(p, src);
" "$STORE_JS"
C10_RECORD_MUT="$HELPERS_DIR/case10-record-mut.json"
MR_SESSION="case10-session-mut" MR_IDEMKEY="case10-key-mut" MR_MODEL_ID="claude-sonnet-5" run_driver make-record > "$C10_RECORD_MUT"
mut10_price1="$(run_driver price-record "$C10_RECORD_MUT")"
sleep 1.1
mut10_price2="$(PRICE_AS_OF_TODAY=1 run_driver price-record "$C10_RECORD_MUT")"
git -C "$REPO_DIR" checkout -- "$STORE_JS"
mut10_computed1="$(jget "$mut10_price1" "v.computedAt")"
mut10_computed2="$(jget "$mut10_price2" "v.computedAt")"
if [ "$mut10_computed1" = "$mut10_computed2" ]; then
  ok "MUTATION RED: --as-of-today now carries the stored computedAt forward instead of re-resolving"
else
  bad "MUTATION not red: computedAt still changed" "price1=$mut10_price1 price2=$mut10_price2"
fi
if git -C "$REPO_DIR" diff --quiet -- "$STORE_JS"; then
  ok "store.js is restored after Case 10's mutation"
else
  bad "store.js was NOT fully restored after Case 10's mutation"
fi

# =============================================================================
# Case 11 & 12 — session-cumulative contributes exactly one snapshot (R32),
# and a combined rollup carries the mixed marker (R33, spec 0209)
# =============================================================================
echo
echo "=== Case 11/12: session-cumulative one snapshot (R32) + mixed marker (R33/0209) ==="
new_root_and_pin_into C11_ROOT
C11_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C11_INSTANT_BASE="$(node -e "console.log(new Date().toISOString())")"

MR_SESSION="c11-per-request-session" MR_IDEMKEY="c11-k1" MR_FIDELITY="per-request" MR_MODEL_ID="claude-sonnet-5" \
  MR_REQUEST_INSTANT="$C11_INSTANT_BASE" run_driver make-record > "$HELPERS_DIR/c11-r1.json"
MR_SESSION="c11-cumulative-session" MR_IDEMKEY="c11-k2" MR_FIDELITY="session-cumulative" MR_MODEL_ID="claude-sonnet-5" \
  MR_REQUEST_INSTANT="$C11_INSTANT_BASE" run_driver make-record > "$HELPERS_DIR/c11-r2.json"
MR_SESSION="c11-cumulative-session" MR_IDEMKEY="c11-k3" MR_FIDELITY="session-cumulative" MR_MODEL_ID="claude-sonnet-5" \
  MR_REQUEST_INSTANT="$C11_INSTANT_BASE" run_driver make-record > "$HELPERS_DIR/c11-r3.json"

for f in c11-r1 c11-r2 c11-r3; do
  run_driver write "$HELPERS_DIR/$f.json" >/dev/null
done

c11_rollup="$(run_driver rollup "$C11_PERIOD" claude-code)"
c11_sc_count="$(jget "$c11_rollup" "v.byFidelity['session-cumulative'].count")"
c11_mixed="$(jget "$c11_rollup" "JSON.stringify(v.combined.mixed)")"
if [ "$c11_sc_count" = "1" ]; then
  ok "session-cumulative bucket contributes exactly one snapshot, not both"
else
  bad "session-cumulative bucket did not contribute exactly one snapshot" "$c11_rollup"
fi
if [ "$c11_mixed" = '["per-request","session-cumulative"]' ]; then
  ok "the combined total carries mixed:[per-request, session-cumulative], naming both contributing fidelities"
else
  bad "the combined total's mixed marker is wrong" "$c11_rollup"
fi

USAGE_STORE_ROLLUP_JS="$REPO_DIR/scripts/lib/usage-store/rollup.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = \"'session-cumulative': lastSnapshots(captured),\";
if (!src.includes(marker)) { console.error('FATAL: contributingRecords marker not found in usage-store/rollup.js'); process.exit(1); }
src = src.replace(marker, \"'session-cumulative': captured.filter((r) => r.fidelity === 'session-cumulative'), // MUTATION: sum all snapshots\");
fs.writeFileSync(p, src);
" "$USAGE_STORE_ROLLUP_JS"
mut11_rollup="$(run_driver rollup "$C11_PERIOD" claude-code)"
git -C "$REPO_DIR" checkout -- "$USAGE_STORE_ROLLUP_JS"
mut11_sc_count="$(jget "$mut11_rollup" "v.byFidelity['session-cumulative'].count")"
if [ "$mut11_sc_count" = "2" ]; then
  ok "MUTATION RED: session-cumulative now sums both snapshots (count=2) instead of the last one"
else
  bad "MUTATION not red: session-cumulative count unchanged" "$mut11_rollup"
fi
if git -C "$REPO_DIR" diff --quiet -- "$USAGE_STORE_ROLLUP_JS"; then
  ok "usage-store/rollup.js is restored after Case 11's mutation"
else
  bad "usage-store/rollup.js was NOT fully restored after Case 11's mutation"
fi

PRICE_ROLLUP_JS="$REPO_DIR/scripts/lib/usage-price/rollup.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'result.combined = { sum, unpricedCount, unconvertedCount, mixed };';
if (!src.includes(marker)) { console.error('FATAL: combined-mixed marker not found in usage-price/rollup.js'); process.exit(1); }
src = src.replace(marker, 'result.combined = { sum, unpricedCount, unconvertedCount }; // MUTATION: mixed marker dropped');
fs.writeFileSync(p, src);
" "$PRICE_ROLLUP_JS"
mut12_rollup="$(run_driver rollup "$C11_PERIOD" claude-code)"
git -C "$REPO_DIR" checkout -- "$PRICE_ROLLUP_JS"
mut12_has_mixed="$(jget "$mut12_rollup" "Object.prototype.hasOwnProperty.call(v.combined, 'mixed')")"
if [ "$mut12_has_mixed" = "false" ]; then
  ok "MUTATION RED: dropping the mixed key removes it from the combined total"
else
  bad "MUTATION not red: mixed marker still present" "$mut12_rollup"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRICE_ROLLUP_JS"; then
  ok "usage-price/rollup.js is restored after Case 12's mutation"
else
  bad "usage-price/rollup.js was NOT fully restored after Case 12's mutation"
fi

# =============================================================================
# Case 13 — unpriced is never counted as a zero-cost record (R34)
# =============================================================================
echo
echo "=== Case 13: unpriced never counted as zero (R34) ==="
new_root_and_pin_into C13_ROOT
C13_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C13_INSTANT="$(node -e "console.log(new Date().toISOString())")"

MR_SESSION="c13-priced-session" MR_IDEMKEY="c13-k1" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C13_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c13-priced.json"
MR_SESSION="c13-unpriced-session" MR_IDEMKEY="c13-k2" MR_MODEL_ID="totally-unresolvable-model-xyz" MR_REQUEST_INSTANT="$C13_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c13-unpriced.json"
run_driver write "$HELPERS_DIR/c13-priced.json" >/dev/null
run_driver write "$HELPERS_DIR/c13-unpriced.json" >/dev/null

c13_rollup="$(run_driver rollup "$C13_PERIOD" claude-code)"
c13_pr_count="$(jget "$c13_rollup" "v.byFidelity['per-request'].count")"
c13_pr_unpriced="$(jget "$c13_rollup" "v.byFidelity['per-request'].unpricedCount")"
if [ "$c13_pr_count" = "2" ] && [ "$c13_pr_unpriced" = "1" ]; then
  ok "the unpriced record is tallied separately (unpricedCount=1), not folded into the priced sum"
else
  bad "the unpriced record was not tallied correctly" "$c13_rollup"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`      if (cls === 'unpriced') {
        unpricedCount += 1;
      } else if (cls === 'unconverted') {
        unconvertedCount += 1;
      } else {
        pricedCount += 1;
        sum += price.amount;
      }\`;
if (!src.includes(needle)) { console.error('FATAL: unpriced-tally marker not found in usage-price/rollup.js'); process.exit(1); }
const replacement = \`      if (false && cls === 'unpriced') { // MUTATION: unpriced counted as a zero-cost record
        unpricedCount += 1;
      } else if (cls === 'unconverted') {
        unconvertedCount += 1;
      } else {
        pricedCount += 1;
        sum += price.amount || 0;
      }\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$PRICE_ROLLUP_JS"
mut13_rollup="$(run_driver rollup "$C13_PERIOD" claude-code)"
git -C "$REPO_DIR" checkout -- "$PRICE_ROLLUP_JS"
mut13_pr_unpriced="$(jget "$mut13_rollup" "v.byFidelity['per-request'].unpricedCount")"
if [ "$mut13_pr_unpriced" = "0" ]; then
  ok "MUTATION RED: the unpriced record is now silently counted as a zero-cost priced record (unpricedCount=0)"
else
  bad "MUTATION not red: unpricedCount unchanged" "$mut13_rollup"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRICE_ROLLUP_JS"; then
  ok "usage-price/rollup.js is restored after Case 13's mutation"
else
  bad "usage-price/rollup.js was NOT fully restored after Case 13's mutation"
fi

# =============================================================================
# Case 14 — end-to-end prune reaches BOTH registered derived stores together
# (R37 + delta-01 R31/R33's two-store half — the named edit 1 reason this
# ticket carries a delta-spec at all)
# =============================================================================
echo
echo "=== Case 14: end-to-end prune, two registered stores (R37 + delta-01 R31/R33) ==="
new_root_and_pin_into C14_ROOT
C14_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C14_INSTANT="$(node -e "console.log(new Date().toISOString())")"

MR_SESSION="c14-prune-session" MR_IDEMKEY="c14-prune-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C14_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c14-record.json"
c14_write="$(run_driver write "$HELPERS_DIR/c14-record.json")"
if echo "$c14_write" | grep -qF 'STATUS=stored'; then
  ok "Case 14: the journal record stores"
else
  bad "Case 14: the journal record did NOT store" "$c14_write"
fi
run_driver price-record "$HELPERS_DIR/c14-record.json" >/dev/null

bash "$REPO_DIR/scripts/usage-attribute.sh" add --period "$C14_PERIOD" --cli claude-code \
  --task-key "usage-pricing-prune-task" --reason "Case 14 two-store prune scenario" --author "test-suite" >/dev/null

C14_JOURNAL_ENTRY="$C14_ROOT/journal/claude-code/$C14_PERIOD"
C14_PRICE_PARTITION="$C14_ROOT/prices/claude-code/$C14_PERIOD"
C14_LEDGER_PARTITION="$C14_ROOT/ledger/$C14_PERIOD"
if [ -n "$(find "$C14_JOURNAL_ENTRY" -maxdepth 1 -name '*.json' ! -name '*.wing.json' 2>/dev/null)" ] \
  && [ -n "$(find "$C14_PRICE_PARTITION" -maxdepth 1 -name '*.price.json' 2>/dev/null)" ] \
  && [ -n "$(find "$C14_LEDGER_PARTITION" -maxdepth 1 -name '*.json' 2>/dev/null)" ]; then
  ok "Case 14: before pruning, the journal entry, the price file, and the ledger entry all exist"
else
  bad "Case 14: pre-prune fixture state is not as expected" "journal=$(ls "$C14_JOURNAL_ENTRY" 2>&1) price=$(ls "$C14_PRICE_PARTITION" 2>&1) ledger=$(ls "$C14_LEDGER_PARTITION" 2>&1)"
fi

c14_prune_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C14_PERIOD" --force)"
c14_price_gone=1
[ -d "$C14_PRICE_PARTITION" ] && c14_price_gone=0
c14_ledger_gone=1
[ -d "$C14_LEDGER_PARTITION" ] && c14_ledger_gone=0
if [ "$c14_price_gone" -eq 1 ] && [ "$c14_ledger_gone" -eq 1 ]; then
  ok "Case 14: both the price partition and the ledger period directory are gone (rmdir'd, not just emptied)"
else
  bad "Case 14: a store's partition directory survived the prune" "price_gone=$c14_price_gone ledger_gone=$c14_ledger_gone report=$c14_prune_out"
fi
if grep -qF "$C14_PERIOD" <<< "$(cat "$C14_ROOT/pruned/claude-code/$C14_PERIOD.json" 2>/dev/null || echo MISSING)" || [ -f "$C14_ROOT/pruned/claude-code/$C14_PERIOD.json" ]; then
  ok "Case 14: the pruned marker is present"
else
  bad "Case 14: the pruned marker is missing"
fi
if grep -qE 'attribution-ledger: [1-9]' <<< "$c14_prune_out" && grep -qE 'price-store: [1-9]' <<< "$c14_prune_out"; then
  ok "Case 14: the report names BOTH attribution-ledger and price-store, each with a non-zero count"
else
  bad "Case 14: the report did not name both stores with non-zero counts" "$c14_prune_out"
fi

PRUNE_JS="$REPO_DIR/scripts/lib/usage-store/prune.js"

# --- Mutation 14a: total no-op walk ---
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'for (const store of layout.derivedStores()) {';
if (!src.includes(needle)) { console.error('FATAL: registry-walk marker not found in prune.js'); process.exit(1); }
src = src.replace(needle, 'for (const store of []) { // MUTATION 14a: total no-op walk');
fs.writeFileSync(p, src);
" "$PRUNE_JS"

new_root_and_pin_into C14A_ROOT
C14A_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C14A_INSTANT="$(node -e "console.log(new Date().toISOString())")"
MR_SESSION="c14a-session" MR_IDEMKEY="c14a-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C14A_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c14a-record.json"
run_driver write "$HELPERS_DIR/c14a-record.json" >/dev/null
run_driver price-record "$HELPERS_DIR/c14a-record.json" >/dev/null
bash "$REPO_DIR/scripts/usage-attribute.sh" add --period "$C14A_PERIOD" --cli claude-code \
  --task-key "usage-pricing-mut14a-task" --reason "Mutation 14a" --author "test-suite" >/dev/null
mut14a_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C14A_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
if ! grep -qiF 'attribution-ledger' <<< "$mut14a_out" && ! grep -qiF 'price-store' <<< "$mut14a_out"; then
  ok "MUTATION 14a RED: a total no-op walk names no store at all in the report"
else
  bad "MUTATION 14a not red: a store was still named" "$mut14a_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored after Mutation 14a"
else
  bad "prune.js was NOT fully restored after Mutation 14a"
fi

# --- Mutation 14b: skip the period arm (attribution-ledger's own scope) ---
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \"if (store.scope === 'period') {\n      dir = store.dirFor(per);\";
if (!src.includes(needle)) { console.error('FATAL: period-arm marker not found in prune.js'); process.exit(1); }
src = src.replace(needle, \"if (store.scope === 'period' && false) { // MUTATION 14b: skip the period arm\n      dir = store.dirFor(per);\");
fs.writeFileSync(p, src);
" "$PRUNE_JS"

new_root_and_pin_into C14B_ROOT
C14B_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C14B_INSTANT="$(node -e "console.log(new Date().toISOString())")"
MR_SESSION="c14b-session" MR_IDEMKEY="c14b-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C14B_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c14b-record.json"
run_driver write "$HELPERS_DIR/c14b-record.json" >/dev/null
run_driver price-record "$HELPERS_DIR/c14b-record.json" >/dev/null
bash "$REPO_DIR/scripts/usage-attribute.sh" add --period "$C14B_PERIOD" --cli claude-code \
  --task-key "usage-pricing-mut14b-task" --reason "Mutation 14b" --author "test-suite" >/dev/null
mut14b_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C14B_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
mut14b_ledger_survives=0
[ -n "$(find "$C14B_ROOT/ledger/$C14B_PERIOD" -type f 2>/dev/null)" ] && mut14b_ledger_survives=1
if ! grep -qiF 'attribution-ledger' <<< "$mut14b_out" && [ "$mut14b_ledger_survives" -eq 1 ] && grep -qE 'price-store: [1-9]' <<< "$mut14b_out"; then
  ok "MUTATION 14b RED: skipping the period arm leaves attribution-ledger unreported and its entries physically surviving, while price-store still runs"
else
  bad "MUTATION 14b not red" "ledger_survives=$mut14b_ledger_survives report=$mut14b_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored after Mutation 14b"
else
  bad "prune.js was NOT fully restored after Mutation 14b"
fi

# --- Mutation 14c: skip the cli-period arm (price-store's own scope) ---
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \"} else if (store.scope === 'cli-period') {\n      dir = store.dirFor(cli, per);\";
if (!src.includes(needle)) { console.error('FATAL: cli-period-arm marker not found in prune.js'); process.exit(1); }
src = src.replace(needle, \"} else if (store.scope === 'cli-period' && false) { // MUTATION 14c: skip the cli-period arm\n      dir = store.dirFor(cli, per);\");
fs.writeFileSync(p, src);
" "$PRUNE_JS"

new_root_and_pin_into C14C_ROOT
C14C_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C14C_INSTANT="$(node -e "console.log(new Date().toISOString())")"
MR_SESSION="c14c-session" MR_IDEMKEY="c14c-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C14C_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c14c-record.json"
run_driver write "$HELPERS_DIR/c14c-record.json" >/dev/null
run_driver price-record "$HELPERS_DIR/c14c-record.json" >/dev/null
bash "$REPO_DIR/scripts/usage-attribute.sh" add --period "$C14C_PERIOD" --cli claude-code \
  --task-key "usage-pricing-mut14c-task" --reason "Mutation 14c" --author "test-suite" >/dev/null
mut14c_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C14C_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
mut14c_price_survives=0
[ -d "$C14C_ROOT/prices/claude-code/$C14C_PERIOD" ] && mut14c_price_survives=1
if ! grep -qiF 'price-store' <<< "$mut14c_out" && [ "$mut14c_price_survives" -eq 1 ] && grep -qE 'attribution-ledger: [1-9]' <<< "$mut14c_out"; then
  ok "MUTATION 14c RED: skipping the cli-period arm leaves price-store unreported and its partition physically surviving, while attribution-ledger still runs"
else
  bad "MUTATION 14c not red" "price_survives=$mut14c_price_survives report=$mut14c_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored after Mutation 14c"
else
  bad "prune.js was NOT fully restored after Mutation 14c"
fi

# =============================================================================
# Case 15 — no registered store holds anything: behaviour is unchanged from
# before the delta, and no store is named in the report (delta-01 R32/R33)
# =============================================================================
echo
echo "=== Case 15: no registered store holds anything (delta-01 R32/R33) ==="
C15_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$C15_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
C15_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C15_INSTANT="$(node -e "console.log(new Date().toISOString())")"
MR_SESSION="c15-session" MR_IDEMKEY="c15-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C15_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c15-record.json"
run_driver write "$HELPERS_DIR/c15-record.json" >/dev/null
# Deliberately: no pricing, no ledger entry — neither registered store holds
# anything for this period.

c15_prune_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C15_PERIOD" --force)"
if ! grep -qiF 'attribution-ledger' <<< "$c15_prune_out" && ! grep -qiF 'price-store' <<< "$c15_prune_out" && grep -qF '1 record(s) removed' <<< "$c15_prune_out"; then
  ok "no registered store holds anything: neither store is named, journal removal proceeds exactly as before the delta"
else
  bad "the no-registered-store case did not behave as expected" "$c15_prune_out"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \`    let storeNames;
    try {
      storeNames = fs.readdirSync(dir);
    } catch (err) {
      continue; // nothing recorded for this store at this period
    }\`;
if (!src.includes(needle)) { console.error('FATAL: empty-store-skip marker not found in prune.js'); process.exit(1); }
const replacement = \`    let storeNames;
    try {
      storeNames = fs.readdirSync(dir);
    } catch (err) {
      storeReports.push({ id: store.id, removed: 0 }); // MUTATION 15: name a store in the report anyway
      continue;
    }\`;
src = src.replace(needle, replacement);
fs.writeFileSync(p, src);
" "$PRUNE_JS"

C15M_ROOT="$(new_case_root)"
export CREWRIG_USAGE_ROOT="$C15M_ROOT"
export MEMPALACE_PALACE_PATH="$(mktemp -d)/palace"
C15M_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C15M_INSTANT="$(node -e "console.log(new Date().toISOString())")"
MR_SESSION="c15m-session" MR_IDEMKEY="c15m-key" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C15M_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c15m-record.json"
run_driver write "$HELPERS_DIR/c15m-record.json" >/dev/null
mut15_out="$(bash "$REPO_DIR/scripts/usage-prune.sh" claude-code "$C15M_PERIOD" --force)"
git -C "$REPO_DIR" checkout -- "$PRUNE_JS"
if grep -qE 'attribution-ledger: 0' <<< "$mut15_out" && grep -qE 'price-store: 0' <<< "$mut15_out"; then
  ok "MUTATION 15 RED: both empty stores are now falsely named in the report with removed:0"
else
  bad "MUTATION 15 not red: no store was falsely named" "$mut15_out"
fi
if git -C "$REPO_DIR" diff --quiet -- "$PRUNE_JS"; then
  ok "prune.js is restored after Mutation 15"
else
  bad "prune.js was NOT fully restored after Mutation 15"
fi

# =============================================================================
# Case 16 — an uncaptured record in a --period selection never reaches
# model-id resolution: the per-record path marks it, stores nothing for it,
# and never prices it at zero (R34, #1194)
# =============================================================================
echo
echo "=== Case 16: uncaptured record in a --period selection (R34, #1194) ==="
new_root_and_pin_into C16_ROOT
C16_PERIOD="$(node -e "const d=new Date(); console.log(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'))")"
C16_INSTANT="$(node -e "console.log(new Date().toISOString())")"

MR_SESSION="c16-captured-session" MR_IDEMKEY="c16-k1" MR_MODEL_ID="claude-sonnet-5" MR_REQUEST_INSTANT="$C16_INSTANT" \
  run_driver make-record > "$HELPERS_DIR/c16-captured.json"
MR_KIND="uncaptured" MR_SESSION="c16-uncaptured-session" MR_IDEMKEY="c16-k2" MR_REQUEST_INSTANT="$C16_INSTANT" \
  MR_UNCAPTURED_REASON="c16: transcript unavailable" run_driver make-record > "$HELPERS_DIR/c16-uncaptured.json"
run_driver write "$HELPERS_DIR/c16-captured.json" >/dev/null
run_driver write "$HELPERS_DIR/c16-uncaptured.json" >/dev/null
C16_CAPTURED_ID="$(jget "$(cat "$HELPERS_DIR/c16-captured.json")" 'v.recordId')"
C16_UNCAPTURED_ID="$(jget "$(cat "$HELPERS_DIR/c16-uncaptured.json")" 'v.recordId')"

c16_rollup_before="$(bash "$REPO_DIR/scripts/usage-price.sh" --period "$C16_PERIOD" --cli claude-code --rollup)"

c16_rc=0
c16_out="$(bash "$REPO_DIR/scripts/usage-price.sh" --period "$C16_PERIOD" --cli claude-code 2>"$HELPERS_DIR/c16-stderr.txt")" || c16_rc=$?
c16_lines="$(printf '%s\n' "$c16_out" | grep -c . || true)"
if [ "$c16_rc" = "0" ] && [ "$c16_lines" = "2" ]; then
  ok "--period over one captured + one uncaptured record exits 0 with one JSONL line per selected record"
else
  bad "--period over a selection holding an uncaptured record did not complete (rc=$c16_rc, lines=$c16_lines)" "$c16_out
$(cat "$HELPERS_DIR/c16-stderr.txt")"
fi

c16_line_of() {
  # $1 = recordId — prints that record's JSONL line, or {} when absent.
  printf '%s\n' "$c16_out" | node -e "
const id = process.argv[1];
const lines = require('fs').readFileSync(0, 'utf8').split('\n').filter(Boolean);
const hit = lines.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).find((o) => o && o.recordId === id);
console.log(JSON.stringify(hit || {}));
" "$1"
}
c16_captured_line="$(c16_line_of "$C16_CAPTURED_ID")"
c16_uncaptured_line="$(c16_line_of "$C16_UNCAPTURED_ID")"

if [ "$(jget "$c16_captured_line" "typeof v.amount === 'number' && v.amount > 0 && !v.uncaptured && !v.unpriced")" = "true" ]; then
  ok "the captured record's line carries a numeric, non-zero amount"
else
  bad "the captured record's line does not carry a numeric amount" "$c16_captured_line"
fi
if [ "$(jget "$c16_uncaptured_line" "v.uncaptured === true && v.kind === 'uncaptured' && v.amount === null && v.amountUsd === null && !Object.prototype.hasOwnProperty.call(v, 'unpriced') && v.resolution && v.resolution.step === 'uncaptured'")" = "true" ]; then
  ok "the uncaptured record's line is marked uncaptured:true, amount:null, and carries no unpriced flag (a separate R34 tally)"
else
  bad "the uncaptured record's line is not the expected uncaptured marker" "$c16_uncaptured_line"
fi

c16_uncaptured_price_files="$(find "$C16_ROOT/prices" -name "$C16_UNCAPTURED_ID.price.json" 2>/dev/null || true)"
c16_captured_price_files="$(find "$C16_ROOT/prices" -name "$C16_CAPTURED_ID.price.json" 2>/dev/null || true)"
if [ -z "$c16_uncaptured_price_files" ] && [ -n "$c16_captured_price_files" ]; then
  ok "no price file is stored under <root>/prices/** for the uncaptured record (the captured one is stored)"
else
  bad "the price store holds the wrong files for Case 16" "uncaptured: ${c16_uncaptured_price_files:-<none>}
captured: ${c16_captured_price_files:-<none>}"
fi

c16_rollup_after="$(bash "$REPO_DIR/scripts/usage-price.sh" --period "$C16_PERIOD" --cli claude-code --rollup)"
if [ "$(jget "$c16_rollup_after" "v.uncapturedCount === 1 && v.combined.unpricedCount === 0 && v.byFidelity['per-request'].count === 1")" = "true" ] \
  && [ "$c16_rollup_after" = "$c16_rollup_before" ]; then
  ok "--rollup on the same selection still reports uncapturedCount:1, unpricedCount:0, and is unchanged by the per-record run"
else
  bad "--rollup on the Case 16 selection changed or mis-tallies the uncaptured record" "before: $c16_rollup_before
after:  $c16_rollup_after"
fi

node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = \"if (record.kind !== 'captured') return uncapturedMarker(record, currency);\";
if (!src.includes(needle)) { console.error('FATAL: uncaptured-guard marker not found in store.js'); process.exit(1); }
src = src.replace(needle, '// MUTATION: uncaptured guard dropped');
fs.writeFileSync(p, src);
" "$STORE_JS"
mut16_rc=0
bash "$REPO_DIR/scripts/usage-price.sh" --period "$C16_PERIOD" --cli claude-code --no-store \
  >/dev/null 2>"$HELPERS_DIR/mut16-stderr.txt" || mut16_rc=$?
git -C "$REPO_DIR" checkout -- "$STORE_JS"
if [ "$mut16_rc" != "0" ] && grep -qF "toLowerCase" "$HELPERS_DIR/mut16-stderr.txt"; then
  ok "MUTATION RED: dropping the uncaptured guard sends the record into model-id resolution, which throws (toLowerCase of undefined)"
else
  bad "MUTATION not red: the selection still priced without the uncaptured guard (rc=$mut16_rc)" "$(cat "$HELPERS_DIR/mut16-stderr.txt")"
fi
if git -C "$REPO_DIR" diff --quiet -- "$STORE_JS"; then
  ok "store.js is restored after Case 16's mutation"
else
  bad "store.js was NOT fully restored after Case 16's mutation"
fi

# =============================================================================
# Case 17 — period placement of a straddling session-cumulative session
# (spec 0209 delta-01 R43, R45-R48, R50's acceptance criterion)
# =============================================================================
# Session A: 100/300/500 wholly in 2026-05. Session B: 700 in 2026-05's last
# hour, 900 in 2026-06. Fixture price 3e-6 USD per netInput token, output 0.
# Every amount is compared with |delta| <= 1e-12; counts are exact.
# Red on main (filter-first): P = 0.0015, P + P+1 = 0.0042, every pricedCount
# check, and the dashboard agreement for P. Pins of unchanged behavior: P+1
# sum and count, the session rollups, and the post-prune sum and count.
echo
echo "=== Case 17: period placement of a straddling session (delta-01 R43-R48, R50) ==="
new_root_and_pin_into C17_ROOT

# approx <a> <b> — exit 0 when |a - b| <= 1e-12.
approx() {
  node -e "process.exit(Math.abs(Number(process.argv[1]) - Number(process.argv[2])) <= 1e-12 ? 0 : 1)" "$1" "$2"
}

# sc_record <session> <idemKey> <requestInstant> <netInput> [modelId] — writes
# one session-cumulative record straight into the journal.
sc_record() {
  local out
  MR_SESSION="$1" MR_IDEMKEY="$2" MR_REQUEST_INSTANT="$3" MR_NET_INPUT="$4" MR_OUTPUT=0 \
    MR_FIDELITY="session-cumulative" MR_MODEL_ID="${5:-claude-sonnet-5}" run_driver make-record > "$HELPERS_DIR/$2.json"
  out="$(run_driver write "$HELPERS_DIR/$2.json")"
  grep -qF 'STATUS=stored' <<< "$out" || bad "fixture record $2 did NOT store" "$out"
}

# price_sc <selector...> — the session-cumulative bucket of usage:price --rollup
# as "<sum>|<count>|<pricedCount>|<unpricedCount>".
price_sc() {
  local out
  out="$(bash "$REPO_DIR/scripts/usage-price.sh" "$@" --rollup)"
  jget "$out" "(b => [b.sum, b.count, b.pricedCount, b.unpricedCount].join('|'))(v.byFidelity['session-cumulative'])"
}

# dash_sc <period> [selector...] — the dashboard's session-cumulative figures
# for --period (and any further selection) as
# "<amount>|<pricedCount>|<unpricedCount>|<netInput>".
dash_sc() {
  local out period="$1"
  shift
  out="$(bash "$REPO_DIR/scripts/usage-dashboard.sh" report --json --period "$period" "$@")"
  jget "$out" "(p => [p.amount, p.pricedCount, p.unpricedCount, (v.totals.tokens.byFidelity['session-cumulative'] || {}).netInput].join('|'))(v.totals.price.byFidelity['session-cumulative'] || {})"
}

# query_sc <period> [selector...] — usage:query --period --rollup
# session-cumulative netInput.
query_sc() {
  local out period="$1"
  shift
  out="$(bash "$REPO_DIR/scripts/usage-query.sh" --period "$period" "$@" --rollup)"
  jget "$out" "v.byFidelity['session-cumulative'].netInput"
}

sc_record c17-session-a c17-a1 2026-05-10T10:00:00.000Z 100
sc_record c17-session-a c17-a2 2026-05-10T11:00:00.000Z 300
sc_record c17-session-a c17-a3 2026-05-10T12:00:00.000Z 500
sc_record c17-session-b c17-b1 2026-05-31T23:00:00.000Z 700
sc_record c17-session-b c17-b2 2026-06-01T01:00:00.000Z 900

IFS='|' read -r c17_p_sum c17_p_count c17_p_priced c17_p_unpriced <<< "$(price_sc --period 2026-05)"
IFS='|' read -r c17_n_sum c17_n_count c17_n_priced c17_n_unpriced <<< "$(price_sc --period 2026-06)"
if approx "$c17_p_sum" 0.0015 && [ "$c17_p_count" = "1" ]; then
  ok "--period 2026-05 --rollup: session-cumulative sum = 0.0015, count = 1 (A's 500-token snapshot only; B is placed in 2026-06)"
else
  bad "--period 2026-05 --rollup: expected sum 0.0015, count 1" "got sum=$c17_p_sum count=$c17_p_count"
fi
if approx "$c17_n_sum" 0.0027 && [ "$c17_n_count" = "1" ]; then
  ok "--period 2026-06 --rollup: session-cumulative sum = 0.0027, count = 1 (B's 900-token snapshot)"
else
  bad "--period 2026-06 --rollup: expected sum 0.0027, count 1" "got sum=$c17_n_sum count=$c17_n_count"
fi
if [ "$c17_p_priced|$c17_p_unpriced|$c17_n_priced|$c17_n_unpriced" = "1|0|1|0" ]; then
  ok "--period --rollup reports pricedCount = 1, unpricedCount = 0 for each of 2026-05 and 2026-06"
else
  bad "--period --rollup pricedCount/unpricedCount are wrong (expected 1|0|1|0)" "got $c17_p_priced|$c17_p_unpriced|$c17_n_priced|$c17_n_unpriced"
fi

c17_a_sum="$(price_sc --session c17-session-a | cut -d'|' -f1)"
c17_b_sum="$(price_sc --session c17-session-b | cut -d'|' -f1)"
if approx "$c17_a_sum" 0.0015 && approx "$c17_b_sum" 0.0027; then
  ok "--session rollups: A = 0.0015, B = 0.0027"
else
  bad "--session rollups: expected A 0.0015, B 0.0027" "got A=$c17_a_sum B=$c17_b_sum"
fi
c17_periods="$(node -e "console.log(Number(process.argv[1]) + Number(process.argv[2]))" "$c17_p_sum" "$c17_n_sum")"
c17_sessions="$(node -e "console.log(Number(process.argv[1]) + Number(process.argv[2]))" "$c17_a_sum" "$c17_b_sum")"
if approx "$c17_periods" "$c17_sessions" && approx "$c17_periods" 0.0042; then
  ok "R46: P + P+1 = 0.0042 = the two sessions' own rollups (no session counted twice)"
else
  bad "R46: P + P+1 does not equal A + B = 0.0042" "periods=$c17_periods sessions=$c17_sessions"
fi

for c17_m in 2026-05 2026-06; do
  if [ "$c17_m" = "2026-05" ]; then
    c17_line="$c17_p_sum|$c17_p_priced|$c17_p_unpriced"; c17_tok=500
  else
    c17_line="$c17_n_sum|$c17_n_priced|$c17_n_unpriced"; c17_tok=900
  fi
  IFS='|' read -r c17_d_amount c17_d_priced c17_d_unpriced c17_d_net <<< "$(dash_sc "$c17_m")"
  c17_q_net="$(query_sc "$c17_m")"
  IFS='|' read -r c17_sum c17_priced c17_unpriced <<< "$c17_line"
  if approx "$c17_d_amount" "$c17_sum" && [ "$c17_d_priced|$c17_d_unpriced" = "$c17_priced|$c17_unpriced" ] \
    && [ "$c17_d_net" = "$c17_tok" ] && [ "$c17_q_net" = "$c17_tok" ]; then
    ok "R47 --period $c17_m: usage:price = dashboard (amount $c17_sum, pricedCount $c17_priced, unpricedCount $c17_unpriced) and usage:query = dashboard = $c17_tok tokens"
  else
    bad "R47 --period $c17_m: usage:price / usage:query disagree with the dashboard" "usage:price sum|priced|unpriced=$c17_line; dashboard amount|priced|unpriced|netInput=$c17_d_amount|$c17_d_priced|$c17_d_unpriced|$c17_d_net; usage:query netInput=$c17_q_net (expected $c17_tok)"
  fi
done

# Mutation (pre-prune): rollupInput() always returns run(opts), i.e. the
# filter-first read of P alone — B's 700-token snapshot is then counted in P.
QUERY_JS="$REPO_DIR/scripts/lib/usage-store/query.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const marker = 'if (!opts.period || opts.undrained || opts.pending) return';
if (!src.includes(marker)) { console.error('FATAL: rollupInput marker not found in usage-store/query.js'); process.exit(1); }
src = src.replace(marker, 'return');
fs.writeFileSync(p, src);
" "$QUERY_JS"
mut17_sum="$(price_sc --period 2026-05 | cut -d'|' -f1)"
git -C "$REPO_DIR" checkout -- "$QUERY_JS"
if ! approx "$mut17_sum" 0.0015 && approx "$mut17_sum" 0.0036; then
  ok "MUTATION RED: a filter-first rollupInput() counts B's 700-token snapshot in 2026-05 (0.0036, not 0.0015)"
else
  bad "MUTATION not red: the 2026-05 figure did not regress to filter-first 0.0036" "got $mut17_sum"
fi
if git -C "$REPO_DIR" diff --quiet -- "$QUERY_JS"; then
  ok "usage-store/query.js is restored after Case 17's mutation"
else
  bad "usage-store/query.js was NOT fully restored after Case 17's mutation"
fi

# R48: an explicit prune of P+1 makes B's 700-token snapshot its last
# surviving one, which R43 places in P.
bash "$REPO_DIR/scripts/usage-prune.sh" claude-code 2026-06 --force >/dev/null
IFS='|' read -r c17_pp_sum c17_pp_count c17_pp_priced c17_pp_unpriced <<< "$(price_sc --period 2026-05)"
if approx "$c17_pp_sum" 0.0036 && [ "$c17_pp_count" = "2" ]; then
  ok "R48 after pruning 2026-06: --period 2026-05 --rollup sum = 0.0036, count = 2 (A 500 + B's surviving 700)"
else
  bad "R48 after pruning 2026-06: expected sum 0.0036, count 2" "got sum=$c17_pp_sum count=$c17_pp_count"
fi
IFS='|' read -r c17_d_amount c17_d_priced c17_d_unpriced c17_d_net <<< "$(dash_sc 2026-05)"
if approx "$c17_d_amount" "$c17_pp_sum" && [ "$c17_pp_priced|$c17_pp_unpriced" = "2|0" ] \
  && [ "$c17_d_priced|$c17_d_unpriced" = "2|0" ] && [ "$c17_d_net" = "1200" ]; then
  ok "R47/R48 after pruning 2026-06: pricedCount = 2 and the dashboard agrees (amount 0.0036, pricedCount 2, 1200 tokens)"
else
  bad "R47/R48 after pruning 2026-06: usage:price and the dashboard disagree" "usage:price sum|priced|unpriced=$c17_pp_sum|$c17_pp_priced|$c17_pp_unpriced; dashboard=$c17_d_amount|$c17_d_priced|$c17_d_unpriced|$c17_d_net"
fi

# =============================================================================
# Case 18 — a superseded snapshot contributes nothing, and the unpriced tally
# follows the last snapshot (spec 0209 delta-01 R44)
# =============================================================================
# Session C: a priced 200-token snapshot in 2026-05, then a last snapshot in
# 2026-06 whose model no longer resolves. Red on main (filter-first): the
# 2026-05 zeros and every pricedCount check. Pins: the 2026-06 count and
# unpricedCount.
echo
echo "=== Case 18: a superseded snapshot contributes nothing; unpriced follows the last snapshot (delta-01 R44) ==="
new_root_and_pin_into C18_ROOT
sc_record c18-session-c c18-c1 2026-05-20T10:00:00.000Z 200
sc_record c18-session-c c18-c2 2026-06-02T10:00:00.000Z 600 totally-unresolvable-model-xyz

IFS='|' read -r c18_p_sum c18_p_count c18_p_priced c18_p_unpriced <<< "$(price_sc --period 2026-05)"
if [ "$c18_p_count|$c18_p_priced|$c18_p_unpriced" = "0|0|0" ] && approx "$c18_p_sum" 0; then
  ok "--period 2026-05 --rollup: session-cumulative count = 0, pricedCount = 0, unpricedCount = 0, sum = 0 (the 2026-05 snapshot is superseded)"
else
  bad "--period 2026-05 --rollup: the superseded snapshot still contributes" "got sum=$c18_p_sum count=$c18_p_count priced=$c18_p_priced unpriced=$c18_p_unpriced"
fi
IFS='|' read -r c18_n_sum c18_n_count c18_n_priced c18_n_unpriced <<< "$(price_sc --period 2026-06)"
if [ "$c18_n_count|$c18_n_unpriced" = "1|1" ]; then
  ok "--period 2026-06 --rollup: session-cumulative count = 1, unpricedCount = 1 (the unpriced tally lands where the session is placed)"
else
  bad "--period 2026-06 --rollup: expected count 1, unpricedCount 1" "got count=$c18_n_count unpriced=$c18_n_unpriced"
fi
if [ "$c18_n_priced" = "0" ]; then
  ok "--period 2026-06 --rollup: pricedCount = 0"
else
  bad "--period 2026-06 --rollup: pricedCount is NOT 0" "got $c18_n_priced"
fi
IFS='|' read -r _ c18_dp_priced c18_dp_unpriced _ <<< "$(dash_sc 2026-05)"
IFS='|' read -r _ c18_dn_priced c18_dn_unpriced _ <<< "$(dash_sc 2026-06)"
if [ "$c18_dp_priced|$c18_dp_unpriced|$c18_dn_priced|$c18_dn_unpriced" = "$c18_p_priced|$c18_p_unpriced|$c18_n_priced|$c18_n_unpriced" ]; then
  ok "R47: the dashboard's pricedCount/unpricedCount agree for 2026-05 (0/0) and 2026-06 (0/1)"
else
  bad "R47: the dashboard's pricedCount/unpricedCount disagree with usage:price" "dashboard 05=$c18_dp_priced/$c18_dp_unpriced 06=$c18_dn_priced/$c18_dn_unpriced; usage:price 05=$c18_p_priced/$c18_p_unpriced 06=$c18_n_priced/$c18_n_unpriced"
fi

# =============================================================================
# Case 19 — a --period rollup narrowed by --task-key agrees with the dashboard
# (spec 0209 delta-01 R45/R47, issue #1205)
# =============================================================================
# The key is seeded by --session ledger entries. K1 (c19-task) straddles:
# 200 in 2026-05, 400 in 2026-06, so it is placed in 2026-06. K2 (c19-task)
# is 300 in 2026-05 only. O1 (no key) is 1000 in 2026-05 and O2 (no key) 800
# in 2026-06. Fixture price 3e-6 USD per netInput token, output 0. Expected
# under --task-key c19-task: 2026-05 = K2 300 (0.0009), 2026-06 = K1 400
# (0.0012). Red on main (--period wins and the key is ignored): 2026-05 =
# 1300 (0.0039), 2026-06 = 1200 (0.0036), and every dashboard agreement.
echo
echo "=== Case 19: --period + --task-key rollup agrees with the dashboard (delta-01 R45/R47, #1205) ==="
new_root_and_pin_into C19_ROOT
sc_record c19-session-k1 c19-k1a 2026-05-20T10:00:00.000Z 200
sc_record c19-session-k1 c19-k1b 2026-06-02T10:00:00.000Z 400
sc_record c19-session-k2 c19-k2a 2026-05-12T10:00:00.000Z 300
sc_record c19-session-o1 c19-o1a 2026-05-15T10:00:00.000Z 1000
sc_record c19-session-o2 c19-o2a 2026-06-05T10:00:00.000Z 800
for c19_s in c19-session-k1 c19-session-k2; do
  bash "$REPO_DIR/scripts/usage-attribute.sh" add --session "$c19_s" --task-key c19-task \
    --reason "usage-pricing suite: Case 19 attributes $c19_s to c19-task" --author "test-suite" >/dev/null
done

for c19_pair in "2026-05:0.0009:300" "2026-06:0.0012:400"; do
  IFS=':' read -r c19_m c19_want_sum c19_want_tok <<< "$c19_pair"
  IFS='|' read -r c19_sum c19_count c19_priced c19_unpriced <<< "$(price_sc --period "$c19_m" --task-key c19-task)"
  IFS='|' read -r c19_d_amount c19_d_priced c19_d_unpriced c19_d_net <<< "$(dash_sc "$c19_m" --task-key c19-task)"
  c19_q_net="$(query_sc "$c19_m" --task-key c19-task)"
  if approx "$c19_sum" "$c19_want_sum" && [ "$c19_count|$c19_priced|$c19_unpriced" = "1|1|0" ]; then
    ok "--period $c19_m --task-key c19-task --rollup: usage:price sum = $c19_want_sum, count = pricedCount = 1, unpricedCount = 0"
  else
    bad "--period $c19_m --task-key c19-task --rollup: expected sum $c19_want_sum, 1|1|0" "got sum=$c19_sum count|priced|unpriced=$c19_count|$c19_priced|$c19_unpriced"
  fi
  if approx "$c19_d_amount" "$c19_sum" && [ "$c19_d_priced|$c19_d_unpriced" = "$c19_priced|$c19_unpriced" ] \
    && [ "$c19_d_net" = "$c19_want_tok" ] && [ "$c19_q_net" = "$c19_want_tok" ]; then
    ok "R47 --period $c19_m --task-key c19-task: usage:price = dashboard (amount $c19_sum, pricedCount $c19_priced, unpricedCount $c19_unpriced) and usage:query = dashboard = $c19_want_tok tokens"
  else
    bad "R47 --period $c19_m --task-key c19-task: usage:price / usage:query disagree with the dashboard" "usage:price sum|priced|unpriced=$c19_sum|$c19_priced|$c19_unpriced; dashboard amount|priced|unpriced|netInput=$c19_d_amount|$c19_d_priced|$c19_d_unpriced|$c19_d_net; usage:query netInput=$c19_q_net (expected $c19_want_tok)"
  fi
done

# =============================================================================
# Named ladder fixtures (v1-F2)
# =============================================================================
echo
echo "=== Named ladder fixtures (v1-F2) ==="
new_root_and_pin_into LADDER_ROOT

# "Gemini 3.8 Flash (Medium)" -> gemini-3.8-flash is a REQUIRED hit through
# the composed closure (depth 2: slug then vsep) — the repository's only
# Antigravity statusline dialect, and the same entry step 5/Case 4 cites for
# its R16 duplicate-rate case.
ladder_hit="$(run_driver resolve "Gemini 3.8 Flash (Medium)")"
ladder_step="$(jget "$ladder_hit" "v.step")"
ladder_key="$(jget "$ladder_hit" "v.entryKey")"
if [ "$ladder_step" = "exact" ] && [ "$ladder_key" = "gemini-3.8-flash" ]; then
  ok "Gemini 3.8 Flash (Medium) resolves through the composed closure to gemini-3.8-flash (step=exact)"
else
  bad "the required-hit ladder fixture did not resolve as expected" "$ladder_hit"
fi

# gemini-3.8-pro and gpt-5-copilot are EXPECTED family-fallback outcomes, not
# defects — named here so a future reader does not read the miss as a
# regression (both already asserted with their ~ marker as part of Case 1's
# setup for gemini-3.8-pro; gpt-5-copilot is asserted here for completeness).
ladder_gpt5="$(run_driver resolve "gpt-5-copilot")"
ladder_gpt5_family="$(jget "$ladder_gpt5" "v.family")"
ladder_gpt5_key="$(jget "$ladder_gpt5" "v.entryKey")"
if [ "$ladder_gpt5_family" = "true" ] && [ "$ladder_gpt5_key" = "gpt-5" ]; then
  ok "gpt-5-copilot is an EXPECTED family-fallback outcome onto gpt-5 (not a defect)"
else
  bad "gpt-5-copilot did not resolve as the expected family-fallback outcome" "$ladder_gpt5"
fi

# Mutation A: a deliberately non-composing ladder (the whole rewrite-generator
# set emptied) — the required hit must go red.
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'const REWRITE_GENERATORS = [genLower, genSlug, genVsep, genEffort, genChan, genDated];';
if (!src.includes(needle)) { console.error('FATAL: REWRITE_GENERATORS marker not found in resolve.js'); process.exit(1); }
src = src.replace(needle, 'const REWRITE_GENERATORS = []; // MUTATION: deliberately non-composing ladder');
fs.writeFileSync(p, src);
" "$RESOLVE_JS"
ladder_mutA="$(run_driver resolve "Gemini 3.8 Flash (Medium)")"
git -C "$REPO_DIR" checkout -- "$RESOLVE_JS"
ladder_mutA_unpriced="$(jget "$ladder_mutA" "!!v.unpriced")"
if [ "$ladder_mutA_unpriced" = "true" ]; then
  ok "MUTATION RED: a non-composing ladder leaves the required hit unpriced"
else
  bad "MUTATION not red: the record still resolved" "$ladder_mutA"
fi
if git -C "$REPO_DIR" diff --quiet -- "$RESOLVE_JS"; then
  ok "resolve.js is restored after the named-ladder non-composing mutation"
else
  bad "resolve.js was NOT fully restored after the named-ladder non-composing mutation"
fi

# Mutation B: the effort token is stripped WITHOUT consuming the surrounding
# separator run (pass-2 named edit 2's exact failure mode — it yields the
# absent candidate "gemini-3.8-flash-"). Reproducing it against THIS
# implementation requires disabling both of its two independent safeguards:
# EFFORT_PAREN_RE's leading `\s*`, and genSlug's own leading/trailing '-'
# trim — either alone still saves the closure (verified empirically), so
# both must be neutralized together to observe the described failure.
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');

const needle1 = \"\\\`\\\\\\\\s*\\\\\\\\((\\\${EFFORT_TOKENS.join('|')})\\\\\\\\)\\\\\\\\s*\\\$\\\`\";
if (!src.includes(needle1)) { console.error('FATAL: EFFORT_PAREN_RE marker not found in resolve.js'); process.exit(1); }
const replacement1 = \"\\\`\\\\\\\\((\\\${EFFORT_TOKENS.join('|')})\\\\\\\\)\\\\\\\\s*\\\$\\\`\";
src = src.split(needle1).join(replacement1);

const needle2 = \".replace(/^-+|-+\$/g, '');\";
if (!src.includes(needle2)) { console.error('FATAL: collapse-trim marker not found in resolve.js'); process.exit(1); }
src = src.replace(needle2, '; // MUTATION: leading/trailing hyphen trim dropped');

fs.writeFileSync(p, src);
" "$RESOLVE_JS"
ladder_mutB="$(run_driver resolve "Gemini 3.8 Flash (Medium)")"
git -C "$REPO_DIR" checkout -- "$RESOLVE_JS"
ladder_mutB_step="$(jget "$ladder_mutB" "v.step")"
ladder_mutB_family="$(jget "$ladder_mutB" "!!v.family")"
if [ "$ladder_mutB_step" != "exact" ] || [ "$ladder_mutB_family" = "true" ]; then
  ok "MUTATION RED: stripping the effort token without its separator run loses the clean exact hit (step=$ladder_mutB_step family=$ladder_mutB_family — the un-composed candidate now carries a trailing hyphen and only a family-fallback rescue is left, itself a wrong, flagged result)"
else
  bad "MUTATION not red: the required hit is still an unflagged exact match" "$ladder_mutB"
fi
if git -C "$REPO_DIR" diff --quiet -- "$RESOLVE_JS"; then
  ok "resolve.js is restored after the named-ladder separator-run mutation"
else
  bad "resolve.js was NOT fully restored after the named-ladder separator-run mutation"
fi

# =============================================================================
# Structural assertions (R5, R35) + no-network grep over the read paths
# =============================================================================
echo
echo "=== Structural assertions (R5, R35) + no-network grep ==="

grep_write="$(grep -rn "journalEntry(\|wingSidecar(" "$REPO_DIR/scripts/lib/usage-price/" 2>&1 || true)"
if [ -z "$grep_write" ]; then
  ok "R35: the price tree never calls journalEntry( or wingSidecar( for writing"
else
  bad "R35: a journal-owned write call was found in the price tree" "$grep_write"
fi

openrouter_files="$(grep -rl "openrouter.ai" "$REPO_DIR/scripts/lib/usage-price/" 2>&1 || true)"
openrouter_file_count="$(printf '%s\n' "$openrouter_files" | grep -c . || true)"
if [ "$openrouter_file_count" -eq 1 ] && grep -qF "crosscheck.js" <<< "$openrouter_files"; then
  ok "R5: the OpenRouter host string appears in exactly one file (crosscheck.js)"
else
  bad "R5: the OpenRouter host string does not appear in exactly one file" "$openrouter_files"
fi

crosscheck_requires="$(grep -rn "require(.*crosscheck" "$REPO_DIR/scripts/lib/usage-price/" 2>&1 || true)"
crosscheck_require_count="$(printf '%s\n' "$crosscheck_requires" | grep -c . || true)"
if [ "$crosscheck_require_count" -eq 1 ]; then
  ok "R5: crosscheck.js is require()'d from exactly one place"
else
  bad "R5: crosscheck.js is require()'d from an unexpected number of places" "$crosscheck_requires"
fi

# The brief's own literal file list names "scripts/lib/usage-price/layout.js",
# which does not exist — layout.js lives under scripts/lib/usage-store/, one
# of this ticket's two appended surfaces. Read charitably as a directory-
# prefix slip on the read-path list's last entry; grepped here against the
# real file instead, and reported as a disagreement in the logbook note.
grep_network="$(grep -n -E "fetch\(|https?://" \
  "$REPO_DIR/scripts/lib/usage-price/resolve.js" \
  "$REPO_DIR/scripts/lib/usage-price/compute.js" \
  "$REPO_DIR/scripts/lib/usage-price/store.js" \
  "$REPO_DIR/scripts/lib/usage-price/rollup.js" \
  2>&1 || true)"
if [ -z "$grep_network" ]; then
  ok "no-network grep: resolve.js, compute.js, store.js, rollup.js reach no fetch(/https?:// at all"
else
  bad "no-network grep found a hit in the read-path modules" "$grep_network"
fi

grep_network_layout="$(grep -n "fetch(" "$REPO_DIR/scripts/lib/usage-store/layout.js" "$REPO_DIR/scripts/lib/usage-store/prune.js" 2>&1 || true)"
if [ -z "$grep_network_layout" ]; then
  ok "no-network grep: the two appended surfaces (layout.js, prune.js) never call fetch("
else
  bad "no-network grep found a fetch( call in the appended surfaces" "$grep_network_layout"
fi

# =============================================================================
# R38 — full resolution pipeline, positive coverage (exact / alias / org
# precedence / unresolvable), against realistic sample-derived records
# =============================================================================
echo
echo "=== R38 full resolution pipeline (exact / alias / org precedence / unresolvable) ==="
new_root_and_pin_into R38_ROOT

r38_exact="$(run_driver compute-price "$FIXTURES_DIR/records/exact-match-claude-code.json")"
r38_exact_step="$(jget "$r38_exact" "v.resolution.step")"
if [ "$r38_exact_step" = "exact" ]; then
  ok "R38: a sample-derived claude-code record resolves via an exact match"
else
  bad "R38: exact match did not resolve as expected" "$r38_exact"
fi

r38_alias="$(run_driver compute-price "$FIXTURES_DIR/records/alias-resolution-gemini.json")"
r38_alias_step="$(jget "$r38_alias" "v.resolution.step")"
r38_alias_key="$(jget "$r38_alias" "v.resolution.entryKey")"
if [ "$r38_alias_step" = "alias" ] && [ "$r38_alias_key" = "claude-sonnet-4-6" ]; then
  ok "R38: a sample-derived gemini-cli record naming an aliasOf entry re-resolves to its target"
else
  bad "R38: alias re-resolution did not behave as expected" "$r38_alias"
fi

# R4 — a price entry's provenance carries the primary source's own per-entry
# source URL when the primary source declares one for the resolved entry.
# claude-sonnet-5 (r38_exact) declares none; claude-sonnet-4-6 (r38_alias,
# reached via alias) declares one — both branches asserted off the two R38
# calls above, no new fixture records needed.
r38_exact_source_url="$(jget "$r38_exact" "v.resolution.sourceUrl")"
if [ "$r38_exact_source_url" = "undefined" ]; then
  ok "R4: an entry declaring no per-entry source stays absent from resolution.sourceUrl, never fabricated"
else
  bad "R4: resolution.sourceUrl should be absent for claude-sonnet-5 (declares no source)" "$r38_exact"
fi

r38_alias_source_url="$(jget "$r38_alias" "v.resolution.sourceUrl")"
if [ "$r38_alias_source_url" = "https://models.litellm.ai/pricing#claude-sonnet-4-6" ]; then
  ok "R4: the resolved entry's own declared source URL is threaded onto resolution.sourceUrl"
else
  bad "R4: resolution.sourceUrl was not threaded from the resolved entry" "$r38_alias"
fi

STORE_JS="$REPO_DIR/scripts/lib/usage-price/store.js"
node -e "
const fs = require('fs');
const p = process.argv[1];
let src = fs.readFileSync(p, 'utf8');
const needle = 'if (sourceUrl) resolution.sourceUrl = sourceUrl;';
if (!src.includes(needle)) { console.error('FATAL: R4 sourceUrl marker not found in store.js'); process.exit(1); }
src = src.replace(needle, '// MUTATION: R4 sourceUrl thread dropped');
fs.writeFileSync(p, src);
" "$STORE_JS"
mut_r4_alias="$(run_driver compute-price "$FIXTURES_DIR/records/alias-resolution-gemini.json")"
git -C "$REPO_DIR" checkout -- "$STORE_JS"
mut_r4_source_url="$(jget "$mut_r4_alias" "v.resolution.sourceUrl")"
if [ "$mut_r4_source_url" = "undefined" ]; then
  ok "MUTATION RED: dropping the R4 sourceUrl thread makes it absent from a price whose entry declares one"
else
  bad "MUTATION not red: resolution.sourceUrl still present after dropping the thread" "$mut_r4_alias"
fi
if git -C "$REPO_DIR" diff --quiet -- "$STORE_JS"; then
  ok "store.js is restored after the R4 mutation"
else
  bad "store.js was NOT fully restored after the R4 mutation"
fi

r38_org="$(PRICE_ORG_FILE="$FIXTURES_DIR/org/model-prices.org.json" run_driver resolve-and-compute "$FIXTURES_DIR/records/exact-match-claude-code.json")"
r38_org_step="$(jget "$r38_org" "v.resolution.step")"
r38_org_rate="$(jget "$r38_org" "v.components.netInput.rate")"
if [ "$r38_org_step" = "org-exact" ] && [ "$r38_org_rate" = "0.000001" ]; then
  ok "R38: the org override table takes precedence over the primary source for the same identifier"
else
  bad "R38: org-exact precedence did not behave as expected" "$r38_org"
fi

r38_org_added="$(PRICE_ORG_FILE="$FIXTURES_DIR/org/model-prices.org.json" run_driver resolve "org-only-custom-model")"
r38_org_added_step="$(jget "$r38_org_added" "v.step")"
if [ "$r38_org_added_step" = "org-added" ]; then
  ok "R38: an identifier only the org table declares resolves at the org-added step"
else
  bad "R38: org-added resolution did not behave as expected" "$r38_org_added"
fi

r38_unpriced="$(run_driver resolve "totally-unresolvable-model-xyz-987")"
r38_unpriced_flag="$(jget "$r38_unpriced" "!!v.unpriced")"
if [ "$r38_unpriced_flag" = "true" ]; then
  ok "R38: an unresolvable identifier receives the unpriced marker, no heuristic guess substituted"
else
  bad "R38: unresolvable identifier was not marked unpriced" "$r38_unpriced"
fi

# R20/R21 (copilot.js), in one assertion: no record schema v1 produces today
# carries a first-party price (DEV's own logbook note, re-confirmed here by
# construction — the fixture carries token counts only), so R20's own
# fallback clause governs and the pinned primary source prices the record;
# with the org table declaring copilot.plan=legacy-premium-request, that
# price carries the R21 caveat.
r38_copilot="$(PRICE_ORG_FILE="$FIXTURES_DIR/org/model-prices.org.json" run_driver compute-price "$FIXTURES_DIR/records/copilot-legacy-plan.json")"
r38_copilot_caveat="$(jget "$r38_copilot" "v.copilot && v.copilot.caveat")"
r38_copilot_step="$(jget "$r38_copilot" "v.resolution.step")"
if [ "$r38_copilot_step" = "exact" ] && [ "$r38_copilot_caveat" = "legacy-plan-reference-price" ]; then
  ok "R20/R21: a Copilot record with no first-party price falls back to the primary source and carries the legacy-plan caveat"
else
  bad "R20/R21: the Copilot legacy-plan path did not behave as expected" "$r38_copilot"
fi

# =============================================================================
# Registry mutation discipline note
# =============================================================================
# Unlike test-usage-attribution.sh's own registry case, this suite never
# mutates layout.js to register a synthetic third member: delta-01 R33's
# two-store criterion is discharged directly against the REAL two-member
# derivedStores() registry (attribution-ledger + price-store) that DEV
# 0208/0209 already ship — Case 14 above. derivedStores() itself is never
# mutated by this suite.

# =============================================================================
# Case 19 — a failed currency conversion keeps its USD amount labelled USD, is
# tallied apart as unconverted, and is re-attempted rather than served from
# the store (spec 0209 delta-02 R51-R54, R34 and R47 as modified; R56)
# =============================================================================
# Records, period 2026-09, CLI claude-code (fixture price 3e-6 USD per netInput
# token, output 0): p0 = 0.003 and p1 = 0.006 USD per-request; u1 per-request
# with an unresolvable model; s1a/s1b one session-cumulative session whose last
# snapshot s1b = 0.0012 USD; x1 uncaptured; p2 = 0.009 USD serves 19h only.
# The FX fixtures list USD and GBP only, so JPY is the missing currency and EUR
# converts at 1 / rate(USD). Sub-cases are labelled in execution order: 19d
# seeds the fixtures 19e reads (plan v1's 19e and 19d, swapped per
# plan/1202#1 v1-F2).
echo
echo "=== Case 19: a failed conversion is labelled USD, tallied apart, and re-attempted (delta-02 R51-R54, R56) ==="

MR_SESSION="c19-p0" MR_IDEMKEY="c19-p0" MR_REQUEST_INSTANT="2026-09-10T10:00:00.000Z" MR_NET_INPUT=1000 MR_OUTPUT=0 \
  run_driver make-record > "$HELPERS_DIR/c19-p0.json"
MR_SESSION="c19-p1" MR_IDEMKEY="c19-p1" MR_REQUEST_INSTANT="2026-09-10T11:00:00.000Z" MR_NET_INPUT=2000 MR_OUTPUT=0 \
  run_driver make-record > "$HELPERS_DIR/c19-p1.json"
MR_SESSION="c19-p2" MR_IDEMKEY="c19-p2" MR_REQUEST_INSTANT="2026-09-10T12:00:00.000Z" MR_NET_INPUT=3000 MR_OUTPUT=0 \
  run_driver make-record > "$HELPERS_DIR/c19-p2.json"
MR_SESSION="c19-u1" MR_IDEMKEY="c19-u1" MR_REQUEST_INSTANT="2026-09-10T13:00:00.000Z" MR_OUTPUT=0 \
  MR_MODEL_ID="totally-unresolvable-model-xyz" run_driver make-record > "$HELPERS_DIR/c19-u1.json"
MR_SESSION="c19-s1" MR_IDEMKEY="c19-s1a" MR_REQUEST_INSTANT="2026-09-11T10:00:00.000Z" MR_NET_INPUT=100 MR_OUTPUT=0 \
  MR_FIDELITY="session-cumulative" run_driver make-record > "$HELPERS_DIR/c19-s1a.json"
MR_SESSION="c19-s1" MR_IDEMKEY="c19-s1b" MR_REQUEST_INSTANT="2026-09-11T12:00:00.000Z" MR_NET_INPUT=400 MR_OUTPUT=0 \
  MR_FIDELITY="session-cumulative" run_driver make-record > "$HELPERS_DIR/c19-s1b.json"
MR_KIND="uncaptured" MR_SESSION="c19-x1" MR_IDEMKEY="c19-x1" MR_REQUEST_INSTANT="2026-09-10T14:00:00.000Z" \
  MR_UNCAPTURED_REASON="c19: transcript unavailable" run_driver make-record > "$HELPERS_DIR/c19-x1.json"

# c19_write <name...> — writes the named Case 19 records into the journal.
c19_write() {
  local n out
  for n in "$@"; do
    out="$(run_driver write "$HELPERS_DIR/c19-$n.json")"
    grep -qF 'STATUS=stored' <<< "$out" || bad "Case 19 fixture record $n did NOT store" "$out"
  done
}

# c19_seed_root <varname> — a fresh pinned root holding every Case 19 record
# but p2, with p0 stored in EUR (status ok, amount in C19_P0_EUR) while both FX
# fixtures were cached, and the FX cache then removed.
c19_seed_root() {
  new_root_and_pin_into "$1"
  c19_write p0 p1 u1 s1a s1b x1
  run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null
  run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-21.json" >/dev/null
  C19_P0_EUR="$(jget "$(PRICE_CURRENCY=EUR run_driver price-record "$HELPERS_DIR/c19-p0.json")" \
    "(v.conversion || {}).status === 'ok' && v.currency === 'EUR' ? v.amount : 'not-converted'")"
  rm -rf "$CREWRIG_USAGE_ROOT/fx"
}

c19_seed_fx() {
  run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-18.json" >/dev/null
  run_driver seed-fx "$FIXTURES_DIR/fx/2026-09-21.json" >/dev/null
}

# c19_price <name> [currency] — the per-record read-through path (stores).
c19_price() {
  PRICE_CURRENCY="${2:-USD}" run_driver price-record "$HELPERS_DIR/c19-$1.json"
}

# c19_rollup <currency> / c19_dash <currency> — both surfaces over one selection.
c19_rollup() {
  bash "$REPO_DIR/scripts/usage-price.sh" --period 2026-09 --cli claude-code --rollup --currency "$1"
}
c19_dash() {
  bash "$REPO_DIR/scripts/usage-dashboard.sh" report --json --period 2026-09 --cli claude-code --currency "$1"
}

# c19_stored <name> — the record's stored price file, or {} when absent.
c19_stored() {
  local id f
  id="$(jget "$(cat "$HELPERS_DIR/c19-$1.json")" 'v.recordId')"
  f="$(find "$CREWRIG_USAGE_ROOT/prices" -name "$id.price.json" 2>/dev/null | head -1)"
  if [ -n "$f" ]; then cat "$f"; else echo '{}'; fi
}

# c19_bucket <rollupJson> <fidelity> — "<sum>|<count>|<priced>|<unpriced>|<unconverted>".
c19_bucket() {
  jget "$1" "(b => [b.sum, b.count, b.pricedCount, b.unpricedCount, b.unconvertedCount].join('|'))((v.byFidelity || {})['$2'] || {})"
}

# c19_dash_sc <viewJson> — the dashboard's session-cumulative figures as
# "<amount ?? 0>|<priced>|<unpriced>|<unconverted>".
c19_dash_sc() {
  jget "$1" "(p => [p.amount === null || p.amount === undefined ? 0 : p.amount, p.pricedCount, p.unpricedCount, p.unconvertedCount].join('|'))(((v.totals || {}).price || {byFidelity: {}}).byFidelity['session-cumulative'] || {})"
}

C19_PARTITION="['per-request', 'run-total', 'session-cumulative'].every((f) => { const b = v.byFidelity[f]; return b.pricedCount + b.unpricedCount + b.unconvertedCount === b.count; })"
C19_NO_UNCONVERTED="['per-request', 'run-total', 'session-cumulative'].every((f) => v.byFidelity[f].unconvertedCount === 0) && v.combined.unconvertedCount === 0"
# The fixing-date range the dashboard reports for session c19-s1 (s1b alone).
C19_S1_FIXING="JSON.stringify(((v.sessions || []).find((s) => s.sessionId === 'c19-s1') || {price: {timestamps: {}}}).price.timestamps.fixingDate)"

c19_seed_root C19_ROOT
if [ "$C19_P0_EUR" = "not-converted" ]; then
  bad "Case 19 setup: p0 did not store a converted EUR price while the fixtures were cached"
fi

# --- 19a (R51, no fixing): EUR with no fixing on or before the date ----------
c19a="$(c19_price p1 EUR)"
if [ "$(jget "$c19a" "v.amountUsd > 0 && v.amount === v.amountUsd && v.currency === 'USD'")" = "true" ]; then
  ok "19a R51: an EUR price with no fixing on or before the computation date keeps its USD amount, labelled USD"
else
  bad "19a R51: the failed EUR conversion is not a USD amount labelled USD" "$c19a"
fi
if [ "$(jget "$c19a" "(v.conversion || {}).status === 'no-fixing-on-or-before' && v.conversion.requested === 'EUR' && v.fixingDate === null")" = "true" ]; then
  ok "19a R51: it carries status no-fixing-on-or-before, requested EUR, and no fixing date"
else
  bad "19a R51: the failure status, requested currency or fixing date is wrong" "$c19a"
fi

# --- 19b (R53, R54, R34): the EUR rollup tallies failures apart --------------
c19b_rc=0
c19b="$(c19_rollup EUR 2>"$HELPERS_DIR/c19b-stderr.txt")" || c19b_rc=$?
if [ "$c19b_rc" = "0" ] && [ "$(jget "$c19b" "v.currency === 'EUR'")" = "true" ]; then
  ok "19b R53: --rollup --currency EUR over failed conversions exits 0"
else
  bad "19b R53: --rollup --currency EUR failed (rc=$c19b_rc)" "$c19b
$(cat "$HELPERS_DIR/c19b-stderr.txt")"
fi
IFS='|' read -r c19b_pr_sum c19b_pr_count c19b_pr_priced c19b_pr_unpriced c19b_pr_unconv <<< "$(c19_bucket "$c19b" per-request)"
if approx "$c19b_pr_sum" "$C19_P0_EUR" && [ "$c19b_pr_count|$c19b_pr_priced|$c19b_pr_unpriced|$c19b_pr_unconv" = "3|1|1|1" ]; then
  ok "19b R53/R54: per-request sum = p0's EUR amount alone; count 3 = priced 1 + unpriced 1 + unconverted 1"
else
  bad "19b R53/R54: per-request expected sum $C19_P0_EUR and count|priced|unpriced|unconverted 3|1|1|1" "got sum=$c19b_pr_sum $c19b_pr_count|$c19b_pr_priced|$c19b_pr_unpriced|$c19b_pr_unconv"
fi
IFS='|' read -r c19b_sc_sum c19b_sc_count c19b_sc_priced c19b_sc_unpriced c19b_sc_unconv <<< "$(c19_bucket "$c19b" session-cumulative)"
if approx "$c19b_sc_sum" 0 && [ "$c19b_sc_count|$c19b_sc_priced|$c19b_sc_unpriced|$c19b_sc_unconv" = "1|0|0|1" ]; then
  ok "19b R53/R54: session-cumulative sum 0, count 1 = unconverted 1 (s1b's USD amount enters no sum)"
else
  bad "19b R53/R54: session-cumulative expected sum 0 and count|priced|unpriced|unconverted 1|0|0|1" "got sum=$c19b_sc_sum $c19b_sc_count|$c19b_sc_priced|$c19b_sc_unpriced|$c19b_sc_unconv"
fi
if [ "$(jget "$c19b" "(v.byFidelity || {})['run-total'] && v.byFidelity['run-total'].count === 0 && v.byFidelity['run-total'].unconvertedCount === 0")" = "true" ]; then
  ok "19b R53: the empty run-total bucket reports unconvertedCount 0 (reported even when zero)"
else
  bad "19b R53: the run-total bucket does not report unconvertedCount 0" "$c19b"
fi
c19b_comb_sum="$(jget "$c19b" '(v.combined || {}).sum')"
if approx "$c19b_comb_sum" "$C19_P0_EUR" \
  && [ "$(jget "$c19b" "(v.combined || {}).unconvertedCount === 2 && v.combined.unpricedCount === 1 && v.uncapturedCount === 1")" = "true" ]; then
  ok "19b R53/R34: combined sum = p0's EUR amount; unconverted 2, unpriced 1 and uncaptured 1 are three distinct tallies"
else
  bad "19b R53/R34: the combined total or the uncaptured tally is wrong" "$c19b"
fi
if [ "$(jget "$c19b" "$C19_PARTITION")" = "true" ]; then
  ok "19b R54: priced + unpriced + unconverted = count in every bucket"
else
  bad "19b R54: the three tallies do not partition every bucket" "$c19b"
fi
c19b_s1b="$(c19_stored s1b)"
if [ "$(jget "$c19b_s1b" "v.currency === 'USD' && v.amount === v.amountUsd && (v.conversion || {}).status === 'no-fixing-on-or-before' && v.fixingDate === null")" = "true" ]; then
  ok "19b R51: the rollup stores s1b's failure labelled USD, with no fixing date"
else
  bad "19b R51: s1b's stored failure is not labelled USD with no fixing date" "$c19b_s1b"
fi

# --- 19c (R47): the dashboard agrees over the same empty FX cache ------------
c19c_rc=0
c19c="$(c19_dash EUR 2>"$HELPERS_DIR/c19c-stderr.txt")" || c19c_rc=$?
IFS='|' read -r c19c_amount c19c_priced c19c_unpriced c19c_unconv <<< "$(c19_dash_sc "$c19c")"
if [ "$c19c_rc" = "0" ] && approx "$c19c_amount" "$c19b_sc_sum" \
  && [ "$c19c_priced|$c19c_unpriced|$c19c_unconv" = "$c19b_sc_priced|$c19b_sc_unpriced|$c19b_sc_unconv" ]; then
  ok "19c R47: the dashboard's EUR session-cumulative figures equal the rollup's (amount ?? 0 = sum; priced|unpriced|unconverted = $c19c_priced|$c19c_unpriced|$c19c_unconv)"
else
  bad "19c R47: the dashboard and the rollup disagree on session-cumulative (rc=$c19c_rc)" "dashboard amount|priced|unpriced|unconverted=$c19c_amount|$c19c_priced|$c19c_unpriced|$c19c_unconv; rollup sum|priced|unpriced|unconverted=$c19b_sc_sum|$c19b_sc_priced|$c19b_sc_unpriced|$c19b_sc_unconv
$(cat "$HELPERS_DIR/c19c-stderr.txt")"
fi
if [ "$(jget "$c19c" "$C19_S1_FIXING")" = "null" ] && [ "$(jget "$(c19_stored s1b)" 'v.fixingDate')" = "null" ]; then
  ok "19c R47 precondition: s1b carries no fixing date on both surfaces"
else
  bad "19c R47 precondition: s1b's fixing date differs between the surfaces" "dashboard: $(jget "$c19c" "$C19_S1_FIXING"); stored: $(jget "$(c19_stored s1b)" 'v.fixingDate')"
fi

# --- 19d (R52, retry): the fixing arrives, the stored failure is not served --
c19_seed_fx
c19d="$(c19_price p1 EUR)"
c19d_expected="$(node -e "console.log(Number(process.argv[1]) / 1.149)" "$(jget "$c19d" 'v.amountUsd')")"
if [ "$(jget "$c19d" "(v.conversion || {}).status === 'ok' && v.currency === 'EUR' && v.conversion.rateOfRecord === 'ECB' && v.fixingDate === '2026-09-21'")" = "true" ] \
  && approx "$(jget "$c19d" 'v.amount')" "$c19d_expected"; then
  ok "19d R52: once a fixing is available, a second EUR request is converted (ok, EUR, ECB, fixingDate 2026-09-21), not served the stored failure"
else
  bad "19d R52: the second EUR request did not receive the converted price" "$c19d"
fi
c19d_roll="$(c19_rollup EUR)"
if [ "$(jget "$c19d_roll" "$C19_NO_UNCONVERTED && v.byFidelity['per-request'].pricedCount === 2 && v.byFidelity['session-cumulative'].pricedCount === 1")" = "true" ] \
  && approx "$(jget "$c19d_roll" "v.byFidelity['per-request'].sum")" "$(node -e "console.log(0.009 / 1.149)")" \
  && approx "$(jget "$c19d_roll" "v.byFidelity['session-cumulative'].sum")" "$(node -e "console.log(0.0012 / 1.149)")"; then
  ok "19d R52/R53: the EUR rollup then converts p1 and s1b (per-request priced 2, session-cumulative priced 1, every unconvertedCount 0)"
else
  bad "19d R52/R53: the EUR rollup still carries a failure after the fixing arrived" "$c19d_roll"
fi

# --- 19e (R51, missing rate): JPY is not listed by the fixing ----------------
c19e="$(c19_price p1 JPY)"
if [ "$(jget "$c19e" "v.amountUsd > 0 && v.amount === v.amountUsd && v.currency === 'USD'")" = "true" ]; then
  ok "19e R51: a JPY price the fixing lists no rate for keeps its USD amount, labelled USD"
else
  bad "19e R51: the failed JPY conversion is not a USD amount labelled USD" "$c19e"
fi
if [ "$(jget "$c19e" "(v.conversion || {}).status === 'no-such-currency' && v.conversion.requested === 'JPY' && v.fixingDate === '2026-09-21'")" = "true" ]; then
  ok "19e R51: it carries status no-such-currency, requested JPY, and the consulted fixing's date 2026-09-21"
else
  bad "19e R51: the failure status, requested currency or consulted fixing date is wrong" "$c19e"
fi
c19e_roll="$(c19_rollup JPY)"
IFS='|' read -r c19e_pr_sum c19e_pr_count c19e_pr_priced c19e_pr_unpriced c19e_pr_unconv <<< "$(c19_bucket "$c19e_roll" per-request)"
IFS='|' read -r c19e_sc_sum c19e_sc_count c19e_sc_priced c19e_sc_unpriced c19e_sc_unconv <<< "$(c19_bucket "$c19e_roll" session-cumulative)"
if approx "$c19e_pr_sum" 0 && approx "$c19e_sc_sum" 0 \
  && [ "$c19e_pr_count|$c19e_pr_priced|$c19e_pr_unpriced|$c19e_pr_unconv" = "3|0|1|2" ] \
  && [ "$c19e_sc_count|$c19e_sc_priced|$c19e_sc_unpriced|$c19e_sc_unconv" = "1|0|0|1" ] \
  && [ "$(jget "$c19e_roll" "(v.combined || {}).sum === 0 && v.combined.unconvertedCount === 3 && v.combined.unpricedCount === 1")" = "true" ] \
  && [ "$(jget "$c19e_roll" "$C19_PARTITION")" = "true" ]; then
  ok "19e R53/R54: the JPY rollup counts every priced record unconverted (per-request 2, session-cumulative 1, combined 3), u1 stays unpriced, and no sum holds a USD amount"
else
  bad "19e R53/R54: the JPY rollup mis-tallies the missing-rate failures" "$c19e_roll"
fi
c19e_dash="$(c19_dash JPY)"
IFS='|' read -r c19e_d_amount c19e_d_priced c19e_d_unpriced c19e_d_unconv <<< "$(c19_dash_sc "$c19e_dash")"
if approx "$c19e_d_amount" "$c19e_sc_sum" \
  && [ "$c19e_d_priced|$c19e_d_unpriced|$c19e_d_unconv" = "$c19e_sc_priced|$c19e_sc_unpriced|$c19e_sc_unconv" ]; then
  ok "19e R47 (v1-F3): the dashboard's JPY session-cumulative figures equal the rollup's over the seeded fixings (priced|unpriced|unconverted = $c19e_d_priced|$c19e_d_unpriced|$c19e_d_unconv)"
else
  bad "19e R47 (v1-F3): the dashboard and the rollup disagree on JPY session-cumulative" "dashboard=$c19e_d_amount|$c19e_d_priced|$c19e_d_unpriced|$c19e_d_unconv; rollup sum|priced|unpriced|unconverted=$c19e_sc_sum|$c19e_sc_priced|$c19e_sc_unpriced|$c19e_sc_unconv"
fi
c19e_d_fixing="$(jget "$c19e_dash" "$C19_S1_FIXING")"
c19e_s_fixing="$(jget "$(c19_stored s1b)" 'v.fixingDate')"
if [ "$c19e_d_fixing" = '{"min":"2026-09-21","max":"2026-09-21"}' ] && [ "$c19e_s_fixing" = "2026-09-21" ]; then
  ok "19e R47 precondition: s1b carries fixing date 2026-09-21 on both surfaces"
else
  bad "19e R47 precondition: s1b's fixing date differs between the surfaces" "dashboard: $c19e_d_fixing; stored: $c19e_s_fixing"
fi

# --- 19f (R52 x R51): USD requests over stored failures labelled USD ---------
c19f_dash="$(c19_dash USD)"
if [ "$(jget "$c19f_dash" "((v.totals || {}).price || {}).unconvertedCount === 0 && v.totals.price.pricedCount === 3 && v.totals.price.unpricedCount === 1")" = "true" ]; then
  ok "19f(1) R52: the dashboard's USD view over stored JPY failures counts them priced (3), unpriced 1, unconverted 0"
else
  bad "19f(1) R52: the dashboard's USD view served a stored failure" "$(jget "$c19f_dash" "JSON.stringify((v.totals || {}).price)")"
fi
c19f_p1="$(c19_price p1)"
if [ "$(jget "$c19f_p1" "(v.conversion || {}).status === 'ok' && !Object.prototype.hasOwnProperty.call(v.conversion, 'requested') && v.currency === 'USD'")" = "true" ]; then
  ok "19f(2) R51/R52: a USD request over p1's stored failure carries status ok and no requested currency"
else
  bad "19f(2) R51/R52: the USD request was served a failed conversion status" "$c19f_p1"
fi
c19f_roll="$(c19_rollup USD)"
if [ "$(jget "$c19f_roll" "$C19_NO_UNCONVERTED && v.byFidelity['per-request'].pricedCount === 2 && v.byFidelity['session-cumulative'].pricedCount === 1")" = "true" ] \
  && approx "$(jget "$c19f_roll" "v.byFidelity['per-request'].sum")" 0.009 \
  && approx "$(jget "$c19f_roll" "v.byFidelity['session-cumulative'].sum")" 0.0012; then
  ok "19f(3) R52/R53: the USD rollup recomputes p0 and s1b from their stored failures (sums 0.009 and 0.0012) with every unconvertedCount 0"
else
  bad "19f(3) R52/R53: the USD rollup counted a stored failure" "$c19f_roll"
fi

# --- 19g (R52, legacy heal): a pre-delta entry labelled EUR ------------------
C19G_LEGACY="$HELPERS_DIR/c19g-legacy.json"
jget "$(c19_stored p1)" "JSON.stringify(Object.assign(v, { amount: v.amountUsd, currency: 'EUR', fixingDate: null, conversion: { status: 'no-fixing-on-or-before', requested: 'EUR' } }))" > "$C19G_LEGACY"
run_driver plant-price "$HELPERS_DIR/c19-p1.json" "$C19G_LEGACY" >/dev/null
c19g="$(c19_price p1 EUR)"
if [ "$(jget "$c19g" "(v.conversion || {}).status === 'ok' && v.currency === 'EUR' && v.conversion.rateOfRecord === 'ECB' && v.fixingDate === '2026-09-21'")" = "true" ]; then
  ok "19g R52: a pre-delta stored failure (USD amount labelled EUR) is recomputed, not served, and converts"
else
  bad "19g R52: the pre-delta stored failure was served" "$c19g"
fi

# --- 19h (R52 cost bound): one refresh attempt per date per pass -------------
new_root_and_pin_into C19H_ROOT
c19_write p0 p1 p2
c19h="$(run_driver rollup-fetch-count 2026-09 EUR)"
c19h_calls="$(printf '%s\n' "$c19h" | sed -n '2p;4p' | paste -sd'|' -)"
if [ "$c19h_calls" = "FETCHER_CALLS=1|FETCHER_CALLS=1" ]; then
  ok "19h R52 cost bound: one refresh attempt per computation date per pass (1 then 1 — not one per record, not one per process)"
else
  bad "19h R52 cost bound: expected FETCHER_CALLS=1 in each of the two passes" "$c19h_calls"
fi
c19h_unconv="$(printf '%s\n' "$c19h" | sed -n '1p;3p' | while IFS= read -r l; do jget "$l" "(b => b.unconvertedCount === 3 && b.pricedCount === 0 && b.sum === 0)(v.byFidelity['per-request'])"; done | paste -sd'|' -)"
if [ "$c19h_unconv" = "true|true" ]; then
  ok "19h R53: with every retrieval failing, all three records are unconverted in both passes"
else
  bad "19h R53: the two passes do not count all three records unconverted" "$c19h"
fi

# --- Case 19 mutations M19-1..M19-5 (in place, restored with git checkout) ---
# c19_mutate <file> <label> <needle> <replacement> — FATAL when the anchor is missing.
c19_mutate() {
  node -e "
const fs = require('fs');
const [p, label, needle, replacement] = process.argv.slice(1);
const src = fs.readFileSync(p, 'utf8');
if (!src.includes(needle)) { console.error('FATAL: ' + label + ' marker not found in ' + p); process.exit(1); }
fs.writeFileSync(p, src.replace(needle, replacement));
" "$@"
}

# c19_restored <file> <mutationId> — asserts the file is back to its committed content.
c19_restored() {
  if git -C "$REPO_DIR" diff --quiet -- "$1"; then
    ok "$(basename "$1") is restored after $2"
  else
    bad "$(basename "$1") was NOT fully restored after $2"
  fi
}

# M19-1 (store.js): a failed conversion is labelled with the requested currency.
c19_seed_root C19_M1_ROOT
c19_mutate "$STORE_JS" "R51 USD-label" "if (converted.conversion.status === 'ok') {" \
  "if (true) { // MUTATION: a failed conversion labelled with the requested currency"
mut19_1="$(c19_price p1 EUR)"
git -C "$REPO_DIR" checkout -- "$STORE_JS"
if [ "$(jget "$mut19_1" "v.currency")" = "EUR" ] && [ "$(jget "$mut19_1" "(v.conversion || {}).status")" = "no-fixing-on-or-before" ]; then
  ok "MUTATION RED (M19-1 -> 19a): labelling a failure with the requested currency states EUR on a USD amount"
else
  bad "MUTATION not red (M19-1 -> 19a): the failed price is still labelled USD" "$mut19_1"
fi
c19_restored "$STORE_JS" "M19-1"

# M19-2 (fx.js): no-such-currency drops the consulted fixing's date.
c19_seed_root C19_M2_ROOT
c19_seed_fx
c19_mutate "$FX_JS" "no-such-currency fixingDate" \
  "conversion: { status: 'no-such-currency', requested: ccy, fixingDate: resolved.fixingDate } };" \
  "conversion: { status: 'no-such-currency', requested: ccy } }; // MUTATION: consulted fixing date dropped"
mut19_2="$(c19_price p1 JPY)"
git -C "$REPO_DIR" checkout -- "$FX_JS"
if [ "$(jget "$mut19_2" "(v.conversion || {}).status === 'no-such-currency' && v.fixingDate === null")" = "true" ]; then
  ok "MUTATION RED (M19-2 -> 19e): dropping the consulted fixing date leaves the JPY failure with fixingDate null"
else
  bad "MUTATION not red (M19-2 -> 19e): the JPY failure still carries a fixing date" "$mut19_2"
fi
c19_restored "$FX_JS" "M19-2"

# M19-3 (store.js): the R52 status guard is removed. 19d stays green under it
# (R51's USD label already misses the EUR currency check — plan/1202#1 v1-F1);
# 19f(1-3) and 19g prove the guard. The 19e state (stored JPY failures labelled
# USD) is rebuilt here rather than inherited from the main sequence.
c19_seed_root C19_M3_ROOT
c19_seed_fx
c19_mutate "$STORE_JS" "R52 status-guard" \
  "  if (!stored.conversion || !USABLE_CONVERSION_STATUSES.has(stored.conversion.status)) return false;" \
  "  // MUTATION: R52 status guard removed"
c19_rollup JPY >/dev/null
mut19_3_dash="$(c19_dash USD)"
mut19_3_p1="$(c19_price p1)"
mut19_3_roll="$(c19_rollup USD)"
jget "$(c19_stored p1)" "JSON.stringify(Object.assign(v, { amount: v.amountUsd, currency: 'EUR', fixingDate: null, conversion: { status: 'no-fixing-on-or-before', requested: 'EUR' } }))" > "$C19G_LEGACY"
run_driver plant-price "$HELPERS_DIR/c19-p1.json" "$C19G_LEGACY" >/dev/null
mut19_3_legacy="$(c19_price p1 EUR)"
git -C "$REPO_DIR" checkout -- "$STORE_JS"
if [ "$(jget "$mut19_3_dash" "((v.totals || {}).price || {}).unconvertedCount > 0")" = "true" ]; then
  ok "MUTATION RED (M19-3 -> 19f(1)): without the guard the dashboard's USD view serves stored failures as unconverted"
else
  bad "MUTATION not red (M19-3 -> 19f(1)): the dashboard's USD view still recomputes" "$(jget "$mut19_3_dash" "JSON.stringify((v.totals || {}).price)")"
fi
if [ "$(jget "$mut19_3_p1" "(v.conversion || {}).status")" = "no-such-currency" ]; then
  ok "MUTATION RED (M19-3 -> 19f(2)): without the guard a USD request is served p1's stored JPY failure"
else
  bad "MUTATION not red (M19-3 -> 19f(2)): the USD request still recomputes" "$mut19_3_p1"
fi
if [ "$(jget "$mut19_3_roll" "(v.combined || {}).unconvertedCount > 0")" = "true" ]; then
  ok "MUTATION RED (M19-3 -> 19f(3)): without the guard the USD rollup counts stored failures as unconverted"
else
  bad "MUTATION not red (M19-3 -> 19f(3)): the USD rollup still recomputes" "$mut19_3_roll"
fi
if [ "$(jget "$mut19_3_legacy" "(v.conversion || {}).status")" = "no-fixing-on-or-before" ]; then
  ok "MUTATION RED (M19-3 -> 19g): without the guard the pre-delta EUR-labelled failure is served"
else
  bad "MUTATION not red (M19-3 -> 19g): the pre-delta entry is still recomputed" "$mut19_3_legacy"
fi
c19_restored "$STORE_JS" "M19-3"

# M19-4 (rollup.js): the unconverted branch also adds its USD amount to the sum.
c19_seed_root C19_M4_ROOT
c19_mutate "$PRICE_ROLLUP_JS" "unconverted-tally" "        unconvertedCount += 1;" \
  "        unconvertedCount += 1;
        sum += price.amount; // MUTATION: an unconverted USD amount summed"
mut19_4="$(c19_rollup EUR)"
git -C "$REPO_DIR" checkout -- "$PRICE_ROLLUP_JS"
mut19_4_sum="$(jget "$mut19_4" "v.byFidelity['per-request'].sum")"
if ! approx "$mut19_4_sum" "$C19_P0_EUR" && approx "$mut19_4_sum" "$(node -e "console.log(Number(process.argv[1]) + 0.006)" "$C19_P0_EUR")"; then
  ok "MUTATION RED (M19-4 -> 19b): summing unconverted amounts adds p1's 0.006 USD into the EUR per-request sum"
else
  bad "MUTATION not red (M19-4 -> 19b): the per-request sum is unchanged" "$mut19_4"
fi
c19_restored "$PRICE_ROLLUP_JS" "M19-4"

# M19-5 (fx.js): the per-pass memo is bypassed.
new_root_and_pin_into C19_M5_ROOT
c19_write p0 p1 p2
c19_mutate "$FX_JS" "fx-memo" "  if (!(ctx.fxMemo instanceof Map)) return resolveOnce(date, ctx);" \
  "  return resolveOnce(date, ctx); // MUTATION: per-pass memo bypassed"
mut19_5="$(run_driver rollup-fetch-count 2026-09 EUR)"
git -C "$REPO_DIR" checkout -- "$FX_JS"
mut19_5_calls="$(printf '%s\n' "$mut19_5" | sed -n '2p;4p' | paste -sd'|' -)"
if [ "$mut19_5_calls" = "FETCHER_CALLS=3|FETCHER_CALLS=3" ]; then
  ok "MUTATION RED (M19-5 -> 19h): bypassing the memo makes one refresh attempt per record (3 per pass)"
else
  bad "MUTATION not red (M19-5 -> 19h): expected FETCHER_CALLS=3 in each pass" "$mut19_5_calls"
fi
c19_restored "$FX_JS" "M19-5"

# =============================================================================
# Summary
# =============================================================================
echo
echo "=== Summary ==="
echo "PASS: $pass  FAIL: $fail"

echo
echo "=== HOME safety re-check ==="
if [ -e "$REAL_HOME_USAGE_DIR" ]; then
  HOME_USAGE_MARKER_AFTER="$(find "$REAL_HOME_USAGE_DIR" -type f 2>/dev/null | LC_ALL=C sort)"
else
  HOME_USAGE_MARKER_AFTER="<absent>"
fi
if [ "$HOME_USAGE_MARKER_BEFORE" = "$HOME_USAGE_MARKER_AFTER" ]; then
  ok "\$HOME/.crewrig/usage is unchanged after the run"
else
  # A raw snapshot mismatch is not automatically a failure (spec 0216): a
  # concurrently running, capture-enabled sibling session may legitimately
  # write into the real usage root the whole time this suite runs. Classify
  # each difference instead of failing on any difference:
  #   - a path that disappeared is always a failure (R2/R4, scenario 3);
  #   - a newly observed path is a failure only when its basename matches a
  #     file this suite itself produced under one of its own sandboxed
  #     $CASE_ROOTS (R3) — usage-store artifacts are named after a sha256
  #     recordId (scripts/lib/usage-store/layout.js), so a basename match is
  #     sha256-strength evidence the suite's own output leaked out;
  #   - anything else is a concurrent writer's unrelated, benign activity
  #     (R3, R5) and is not a failure.
  home_before_list="$HOME_USAGE_MARKER_BEFORE"
  [ "$home_before_list" = "<absent>" ] && home_before_list=""
  home_after_list="$HOME_USAGE_MARKER_AFTER"
  [ "$home_after_list" = "<absent>" ] && home_after_list=""
  home_print_list() {
    [ -n "$1" ] && printf '%s\n' "$1"
    return 0
  }
  home_removed="$(LC_ALL=C comm -23 <(home_print_list "$home_before_list") <(home_print_list "$home_after_list"))"
  home_added="$(LC_ALL=C comm -13 <(home_print_list "$home_before_list") <(home_print_list "$home_after_list"))"
  home_own_basenames=""
  if [ -n "$CASE_ROOTS" ]; then
    # shellcheck disable=SC2086  # deliberate word split of the $CASE_ROOTS path list
    home_own_basenames="$(find $CASE_ROOTS -type f -print0 2>/dev/null | xargs -0 -n1 basename 2>/dev/null | LC_ALL=C sort -u)"
  fi
  home_offenders="$home_removed"
  if [ -n "$home_added" ]; then
    home_old_ifs="$IFS"
    IFS="
"
    for home_added_path in $home_added; do
      home_added_base="$(basename "$home_added_path")"
      if grep -qxF "$home_added_base" <<< "$home_own_basenames"; then
        if [ -n "$home_offenders" ]; then
          home_offenders="$home_offenders
$home_added_path"
        else
          home_offenders="$home_added_path"
        fi
      fi
    done
    IFS="$home_old_ifs"
  fi
  if [ -z "$home_offenders" ]; then
    ok "\$HOME/.crewrig/usage is unchanged after the run"
  else
    bad "\$HOME/.crewrig/usage CHANGED during the run" "$home_offenders"
  fi
fi

if [ "$fail" -gt 0 ]; then
  exit 1
fi
