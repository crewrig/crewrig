#!/bin/bash
# test-check-extension-hook-tokens.sh — mutation tests for the R12 token
# check (spec 0179 issue #1005, plan step 25). A sandboxed COPY of scripts/
# and extension-skeleton/ carries one fixture extension whose translator
# gets deliberately broken per case — never the real repository tree.
#
# Usage:
#   bash scripts/tests/test-check-extension-hook-tokens.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit counters.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  echo "$sandbox"
}

write_fixture() {
  # write_fixture <sandbox> <command> — a one-hook extension declaring
  # PreToolUse with the given command string.
  local sandbox="$1" command="$2"
  local ext="$sandbox/extensions/core/tokenfix"
  mkdir -p "$ext"
  jq -n --arg cmd "$command" '{name:"tokenfix", version:"0.0.1", description:"fixture",
    hooks:[{id:"probe", event:"PreToolUse", command: $cmd}]}' > "$ext/extension.json"
}

echo "0. Baseline — a correctly substituted fixture passes"
sandbox="$(make_sandbox)"
write_fixture "$sandbox" 'bash ${extensionRoot}/hooks/handler.sh'
out="$( cd "$sandbox" && bash scripts/check-extension-hook-tokens.sh 2>&1 )"
rc=$?
[ "$rc" -eq 0 ] && ok "Case 0 — baseline passes" || ng "Case 0 — baseline unexpectedly fails:"$'\n'"$out"

echo "1. Exact-token — strip one substitution so a single neutral token survives"
sandbox="$(make_sandbox)"
write_fixture "$sandbox" 'bash ${extensionRoot}/hooks/handler.sh'
# Break Claude's substitution specifically: an early return of the command
# UNCHANGED leaves the neutral token literally unresolved in Claude's
# emitted hooks/hooks.json — a realistic defect shape (a target that never
# got wired into the substitution at all).
sed -i.bak 's/local command="\$1" target="\$2" root_token resolved token_with_slash/local command="$1" target="$2" root_token resolved token_with_slash; [ "$target" = "claude" ] \&\& { printf "%s" "$command"; return 0; }/' "$sandbox/scripts/lib/extension-hooks.sh"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-tokens.sh 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q 'hooks/hooks.json' && echo "$out" | grep -q '\${extensionRoot}'; then
  ok "Case 1 — a surviving neutral token fails the check, naming the file and the token"
else
  ng "Case 1 — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

echo "2. Growth — a command naming the token TWICE, translator mutated global -> first-occurrence"
sandbox="$(make_sandbox)"
write_fixture "$sandbox" 'bash ${extensionRoot}/hooks/handler.sh --root=${extensionRoot}'
sed -i.bak 's|resolved="\${command//\$EXT_HOOKS_NEUTRAL_ROOT_TOKEN/\$root_token}"|resolved="${command/$EXT_HOOKS_NEUTRAL_ROOT_TOKEN/$root_token}"|' "$sandbox/scripts/lib/extension-hooks.sh"
out="$( cd "$sandbox" && bash scripts/check-extension-hook-tokens.sh 2>&1 )"
rc=$?
occurrences="$(echo "$out" | grep -c 'surviving neutral token occurrence')"
if [ "$rc" -ne 0 ] && [ "$occurrences" -ge 2 ]; then
  ok "Case 2 — first-occurrence substitution leaves a second token that the check names as its OWN occurrence (found $occurrences occurrence lines, at least one file affected twice over)"
else
  ng "Case 2 — did not name every surviving occurrence as expected (rc=$rc, occurrences=$occurrences):"$'\n'"$out"
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
