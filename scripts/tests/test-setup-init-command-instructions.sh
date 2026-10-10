#!/bin/bash
# test-setup-init-command-instructions.sh — Regression tests for setup interactive
# prerequisite instructions (spec 0192, issue #1071).
#
# Hermetic unit tests asserting:
#   (1) Structural presence: each setup script formats check_finalized with its
#       CLI-specific invocation matching README.md.
#   (2) Functional output: when identity files are missing, each script's logic
#       emits the exact documented executable command line for that CLI.
#
# Usage:
#   bash scripts/tests/test-setup-init-command-instructions.sh

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SETUP_ANTIGRAVITY="$REPO_DIR/scripts/setup-antigravity-interactive.sh"
SETUP_COPILOT="$REPO_DIR/scripts/setup-copilot-interactive.sh"
SETUP_CLAUDE="$REPO_DIR/scripts/setup-claude-interactive.sh"
SETUP_GEMINI="$REPO_DIR/scripts/setup-gemini-interactive.sh"

pass=0
fail=0
ok()  { echo "  ok: $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL: $1" >&2; fail=$((fail + 1)); }

echo "1. Structural assertions in setup scripts"

# Retargeted (spec 0256 R9, PR D1): the invocation each setup instructs is read from the DECLARATION
# (`init.soul`, `init.profile`), not from the setup text. Pinned against the unchanged shell by
# scripts/tests/setup-retarget-others.test.ts ("the init-command string per CLI") and the golden cell
# `missing-identity` of the four setup-golden suites (the printed `run: <command> <skill>` line).
decl() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$REPO_DIR/scripts/tests/lib/print-setup-declarations.ts" "$1"; }
check_declared_init() {
  local cli="$1" soul="$2" profile="$3" declared got_soul got_profile
  declared="$(decl "$cli")" || declared=""
  if [ -z "$declared" ]; then bad "$cli: empty declaration (vacuity guard)"; return; fi
  got_soul="$(printf '%s\n' "$declared" | grep '^init\.soul=' | head -1 | cut -d= -f2-)"
  got_profile="$(printf '%s\n' "$declared" | grep '^init\.profile=' | head -1 | cut -d= -f2-)"
  [ -n "$got_soul" ] && [ -n "$got_profile" ] || { bad "$cli: declaration lacks init.soul / init.profile"; return; }
  if [ "$got_soul" = "$soul" ] && [ "$got_profile" = "$profile" ]; then
    ok "$cli declares the instruction: $got_soul / $got_profile"
  else
    bad "$cli declares '$got_soul' / '$got_profile', expected '$soul' / '$profile'"
  fi
}
check_declared_init antigravity 'agy -i "/init-soul" --new-project' 'agy -i "/init-personal-profile" --new-project'
check_declared_init copilot     'copilot -i "/init-soul"'          'copilot -i "/init-personal-profile"'
check_declared_init claude      'claude /init-soul'                'claude /init-personal-profile'
check_declared_init gemini      'gemini /init-soul'                'gemini /init-personal-profile'

echo ""
echo "2. Functional prerequisite guidance format assertions"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Mock repo dir without SOUL.md and PROFILE.md
MOCK_REPO="$TMP_DIR/mock-repo"
mkdir -p "$MOCK_REPO/config"

# Retargeted (spec 0256 R9, PR D2): the `check_finalized` block used to be re-typed from the shell text
# and executed here. It now RUNS the TypeScript identity check: the real `identity-check` step of
# scripts/lib/setup/steps.ts, through the real flow runner (runSetup) over the CLI's own descriptor
# trimmed to banner + identity-check, against the mock repo and a throwaway HOME. Pinned against the
# unchanged shell by the golden cell `<cli>/missing-identity` of the four setup-golden suites (the
# shell's stdout and status for the same condition) and by scripts/tests/setup-prerequisites.test.ts.
# Retired with the shell text: the `check_finalized` body copied from each `.sh` (it re-implemented
# the script's function instead of exercising it).
run_identity_check() {
  REPO_DIR_UNDER_TEST="$MOCK_REPO" HOME_UNDER_TEST="$TMP_DIR/home" REPO_ROOT="$REPO_DIR" \
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const root = process.env.REPO_ROOT + "/scripts/";
    const load = (rel) => import(pathToFileURL(root + rel).href);
    const cli = process.argv[1];
    const { runSetup } = await load("lib/setup/flow.ts");
    const { commonSteps } = await load("lib/setup/steps.ts");
    const mod = await load("lib/setup/cli-" + cli + ".ts");
    const base = Object.values(mod).find((v) => v && typeof v === "object" && v.cli === cli);
    const descriptor = { ...base, steps: ["banner", "identity-check"] };
    const { PassThrough } = await import("node:stream");
    const stdin = new PassThrough(); stdin.end();
    const status = await runSetup(descriptor, {
      argv: [], stdin,
      stdout: { write: (t) => process.stdout.write(t) },
      stderr: { write: (t) => process.stderr.write(t) },
      env: { HOME: process.env.HOME_UNDER_TEST }, platform: process.platform,
      home: process.env.HOME_UNDER_TEST, repoDir: process.env.REPO_DIR_UNDER_TEST,
      steps: commonSteps,
    });
    process.exitCode = status;
  ' "$1" 2>&1
}

# check_identity_run <cli> <soul-invocation> <profile-invocation> <label>
check_identity_run() {
  local cli="$1" soul="$2" profile="$3" label="$4" out status
  mkdir -p "$TMP_DIR/home"
  out="$(run_identity_check "$cli")"; status=$?
  # Vacuity guard: the run must have produced the banner and the status of a refusal.
  if ! grep -qF '====================================' <<< "$out"; then bad "$label: the TypeScript flow did not run -- $out"; return; fi
  if [ "$status" -eq 1 ] \
     && grep -qxF "  - config/SOUL.md is missing — run: $soul" <<< "$out" \
     && grep -qxF "  - config/PROFILE.md is missing — run: $profile" <<< "$out"; then
    ok "$label prerequisite output matches the documented invocation, status 1"
  else
    bad "$label prerequisite output mismatch (status $status) -- $out"
  fi
}
check_identity_run antigravity 'agy -i "/init-soul" --new-project' 'agy -i "/init-personal-profile" --new-project' "Antigravity"
check_identity_run copilot     'copilot -i "/init-soul"'          'copilot -i "/init-personal-profile"'          "Copilot"
check_identity_run claude      'claude /init-soul'                'claude /init-personal-profile'                "Claude"
check_identity_run gemini      'gemini /init-soul'                'gemini /init-personal-profile'                "Gemini"

# A present SOUL.md and PROFILE.md lets the check pass (status 0, no refusal): the refusal is conditional.
touch "$MOCK_REPO/config/SOUL.md" "$MOCK_REPO/config/PROFILE.md"
out="$(run_identity_check gemini)"; status=$?
if [ "$status" -eq 0 ] && ! grep -qF 'Cannot proceed' <<< "$out" && grep -qF '====================================' <<< "$out"; then
  ok "identity files present: the TypeScript check passes (status 0)"
else
  bad "identity files present: expected status 0 without refusal (status $status) -- $out"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All $pass tests passed."
  exit 0
else
  echo "$fail test(s) failed out of $((pass + fail))." >&2
  exit 1
fi
