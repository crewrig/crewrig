#!/bin/bash
# test-build-extension.sh — Regression tests for the generic-declaration-model
# render entry point (spec 0173, as amended by
# specs/0173-extension-declaration-model.delta-01.md), successor to the
# retired scripts/build-extension-pivot.sh and its test.
#
# Absorbs the four cases test-build-extension-pivot.sh carried (round-trip on
# hello-world, provenance-carrier round-trip, no-provenance no-op, non-empty
# Claude SKILL.md body) and adds coverage for the render-at-publication model:
# the inverted --check (COMMITTED/RENDER-FAIL/MISSING-UNDECLARED/GAP/
# VERSION-DRIFT), R5's no-enablement-toggle contract, R10(c)'s
# declaration-tracking (not a fixed file list), R16's skeleton-level
# assertion, and the scaffolder harness (v3-F1/v4-F1) proving the org tier
# reaches a real scaffold end to end.
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RENDER="$SCRIPT_DIR/build-extension.sh"
CLAUDE_PLUGIN="$SCRIPT_DIR/build-claude-plugin.sh"
GENERATED_CLASS="$SCRIPT_DIR/lib/extension-generated-class.json"

if [ ! -f "$RENDER" ]; then
  echo "FATAL: cannot find $RENDER" >&2
  exit 2
fi

# Legacy Case 2's carrier round-trip validates TOML via python3/tomllib,
# which requires Python >= 3.11. Mirror the repo's tool-guard idiom rather
# than silently skipping (a skip would let a real carrier regression pass
# unnoticed).
if ! command -v python3 >/dev/null 2>&1; then
  echo "FATAL: python3 is required for the TOML carrier round-trip test." >&2
  exit 2
fi
if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)' 2>/dev/null; then
  echo "FATAL: Python >= 3.11 is required (tomllib was added in 3.11)." >&2
  echo "       Found: $(python3 --version 2>&1). Please upgrade." >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

toml_parses() {
  python3 -c 'import tomllib,sys; tomllib.load(open(sys.argv[1],"rb"))' "$1" 2>&1
}

# make_sandbox — a fresh mktemp'd copy of scripts/ + extension-skeleton/,
# with extensions/{core,library,org}/ created, so RENDER's own REPO_DIR
# resolution (derived from dirname "$0") keys entirely on the sandbox and no
# case ever touches the real repository tree. Echoes the sandbox path.
make_sandbox() {
  local sandbox
  sandbox="$(mktemp -d "$TMP_ROOT/sandbox.XXXXXX")"
  cp -r "$SCRIPT_DIR" "$sandbox/scripts"
  cp -r "$REPO_DIR/extension-skeleton" "$sandbox/extension-skeleton"
  mkdir -p "$sandbox/extensions/core" "$sandbox/extensions/library" "$sandbox/extensions/org"
  echo "$sandbox"
}

# ---------------------------------------------------------------------------
echo "1. Legacy case — round-trip on hello-world (drift-gate self-test)"
# ---------------------------------------------------------------------------
src="$REPO_DIR/extensions/core/hello-world/commands/hello.md"
if [ -f "$src" ]; then
  # Real hello-world source input, read-only — no sandbox needed. The only
  # write is build/extensions/hello-world/ under the repo's own gitignored
  # build/ root (.gitignore:18), cleaned up before this case returns.
  ( cd "$REPO_DIR" && bash scripts/build-extension.sh --target gemini hello-world ) >/dev/null 2>&1
  produced="$REPO_DIR/build/extensions/hello-world/commands/hello.toml"
  # shellcheck source=lib/render-command.sh
  . "$SCRIPT_DIR/lib/render-command.sh"
  expected="$(render_command_gemini "$src")"
  if [ -f "$produced" ] && [ "$(cat "$produced")" = "$(printf '%s\n' "$expected")" ]; then
    ok "Case 1 — build/extensions/hello-world/commands/hello.toml matches a direct render of hello.md"
  else
    ng "Case 1 — rendered hello.toml diverges from a direct render of hello.md"
  fi
  rm -rf "$REPO_DIR/build"
else
  ng "Case 1 — hello-world pivot commands/hello.md missing"
fi

# ---------------------------------------------------------------------------
echo "2. Legacy case — carrier round-trip on a SYNTHETIC provenance-bearing fixture"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
syn="$sandbox/extensions/core/synth"
mkdir -p "$syn/commands"
cat > "$syn/extension.json" <<'EOF'
{"name":"synth","version":"0.0.1","description":"fixture","commands":{"location":"commands/"}}
EOF
cat > "$syn/commands/x.md" <<'EOF'
---
name: x
description: "Synthetic command carrying provenance"
type: command
metadata:
  provenance:
    version: "1.0.0"
    canonical: "https://example.com/owner/repo"
    feedback: "https://example.com/owner/repo"
---

Do the synthetic thing.
EOF
( cd "$sandbox" && bash scripts/build-extension.sh --target gemini synth ) >/dev/null 2>&1
rendered="$sandbox/build/extensions/synth/commands/x.toml"
if [ ! -f "$rendered" ]; then
  ng "Case 2 — renderer did not emit commands/x.toml"
else
  parse_err="$(toml_parses "$rendered")"
  [ -z "$parse_err" ] && ok "Case 2a — provenance-bearing .toml parses as valid TOML" \
    || ng "Case 2a — provenance-bearing .toml is INVALID TOML: $parse_err"
  grep -q '^# crewrig-provenance: version="1.0.0" canonical="https://example.com/owner/repo" feedback="https://example.com/owner/repo"$' "$rendered" \
    && ok "Case 2b — .toml carries the # crewrig-provenance: comment line" \
    || ng "Case 2b — .toml is missing the # crewrig-provenance: comment line"
  prompt_val="$(python3 -c 'import tomllib,sys; print(tomllib.load(open(sys.argv[1],"rb"))["prompt"])' "$rendered" 2>/dev/null)"
  case "$prompt_val" in
    *crewrig-provenance*) ng "Case 2c — provenance leaked into the prompt body" ;;
    *) ok "Case 2c — prompt body is free of the provenance comment" ;;
  esac
fi

# ---------------------------------------------------------------------------
echo "3. Legacy case — no-provenance no-op"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
noprov="$sandbox/extensions/core/plain"
mkdir -p "$noprov/commands"
cat > "$noprov/extension.json" <<'EOF'
{"name":"plain","version":"0.0.1","description":"fixture","commands":{"location":"commands/"}}
EOF
cat > "$noprov/commands/y.md" <<'EOF'
---
name: y
description: "Plain command, no provenance"
type: command
---

Just a plain prompt.
EOF
( cd "$sandbox" && bash scripts/build-extension.sh --target gemini plain ) >/dev/null 2>&1
rendered_plain="$sandbox/build/extensions/plain/commands/y.toml"
if [ -f "$rendered_plain" ] && [ -z "$(toml_parses "$rendered_plain")" ] && ! grep -q 'crewrig-provenance' "$rendered_plain"; then
  ok "Case 3 — no-provenance command renders valid TOML with no carrier comment"
else
  ng "Case 3 — no-provenance command render is wrong (file=$rendered_plain)"
fi

# ---------------------------------------------------------------------------
echo "4. Legacy case — Claude render of hello-world's pivot yields a NON-EMPTY SKILL.md body"
# ---------------------------------------------------------------------------
if [ -f "$CLAUDE_PLUGIN" ]; then
  out="$TMP_ROOT/plugin-out"
  ( cd "$REPO_DIR" && bash "$CLAUDE_PLUGIN" hello-world "$out" ) >/dev/null 2>&1
  skill="$out/skills/hello/SKILL.md"
  if [ -f "$skill" ]; then
    body="$(awk 'BEGIN{c=0} /^---$/{c++; if(c==2){found=1; next}} found{print}' "$skill" | tr -d '[:space:]')"
    if [ -n "$body" ] && grep -q "This prompt comes from the hello-world extension" "$skill"; then
      ok "Case 4 — Claude SKILL.md body is non-empty (empty-prompt bug stays fixed)"
    else
      ng "Case 4 — Claude SKILL.md body is empty or missing the prompt text"
    fi
  else
    ng "Case 4 — Claude plugin did not emit skills/hello/SKILL.md"
  fi
  rm -rf "$out"
else
  ng "Case 4 — build-claude-plugin.sh not found"
fi

# ---------------------------------------------------------------------------
echo "5. R14/R9 — MCP path-form fidelity: the render passes the declared form through verbatim"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
mcpfix="$sandbox/extensions/core/mcpfix"
mkdir -p "$mcpfix"
cat > "$mcpfix/extension.json" <<'EOF'
{"name":"mcpfix","version":"0.0.1","description":"fixture",
 "mcpServers":{"default":{"command":"node","args":["${extensionPath}/dist/index.js"]}}}
EOF
( cd "$sandbox" && bash scripts/build-extension.sh --target gemini mcpfix ) >/dev/null 2>&1
built="$sandbox/build/extensions/mcpfix/gemini-extension.json"
if [ -f "$built" ] && [ "$(jq -r '.mcpServers.default.args[0]' "$built")" = '${extensionPath}/dist/index.js' ]; then
  ok "Case 5a — braced form is passed through verbatim to the built manifest"
else
  ng "Case 5a — braced form was rewritten or lost in the built manifest"
fi
jq '.mcpServers.default.args = ["dist/index.js"]' "$mcpfix/extension.json" > "$mcpfix/extension.json.tmp" && mv "$mcpfix/extension.json.tmp" "$mcpfix/extension.json"
( cd "$sandbox" && bash scripts/build-extension.sh --target gemini mcpfix ) >/dev/null 2>&1
if [ "$(jq -r '.mcpServers.default.args[0]' "$built")" = "dist/index.js" ]; then
  ok "Case 5b — bare form is passed through verbatim too (the render does not hardcode a form — tests/gemini-extension-path-form.md is what says which one to declare)"
else
  ng "Case 5b — bare form was rewritten in the built manifest"
fi
jq 'del(.mcpServers)' "$mcpfix/extension.json" > "$mcpfix/extension.json.tmp" && mv "$mcpfix/extension.json.tmp" "$mcpfix/extension.json"
( cd "$sandbox" && bash scripts/build-extension.sh --target gemini mcpfix ) >/dev/null 2>&1
if ! jq -e 'has("mcpServers")' "$built" >/dev/null 2>&1; then
  ok "Case 5c — dropping mcpServers from the declaration omits the key from the built manifest (no empty {} leaks through)"
else
  ng "Case 5c — built manifest still carries an mcpServers key with nothing declared"
fi

# ---------------------------------------------------------------------------
echo "6. R10(a) inversion — COMMITTED fires on a generated-output-class file, with a paired negative (R4)"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
committed_fix="$sandbox/extensions/core/committedfix"
mkdir -p "$committed_fix"
cat > "$committed_fix/extension.json" <<'EOF'
{"name":"committedfix","version":"0.0.1","description":"fixture"}
EOF
echo '{"name":"stray"}' > "$committed_fix/claude-extension.json"
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check committedfix 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "COMMITTED" && echo "$out" | grep -q "claude-extension.json" && ! echo "$out" | grep -qi "regenerat"; then
  ok "Case 6a — a committed manifest_class member fails as COMMITTED, pointing away from regeneration"
else
  ng "Case 6a — COMMITTED arm did not fire as expected (rc=$rc):"$'\n'"$out"
fi
rm -f "$committed_fix/claude-extension.json"
echo "context" > "$committed_fix/CLAUDE.md"
echo "*.md" > "$committed_fix/.geminiignore"
echo "[]" > "$committed_fix/accepted-gaps.json"
out2="$( cd "$sandbox" && bash scripts/build-extension.sh --check committedfix 2>&1 )"
if echo "$out2" | grep -q "OK   COMMITTED"; then
  ok "Case 6b — CLAUDE.md/.geminiignore/accepted-gaps.json stay outside the class by construction (paired negative)"
else
  ng "Case 6b — a hand-authored context file or the gap declaration was wrongly charged:"$'\n'"$out2"
fi

# ---------------------------------------------------------------------------
echo "7. R13 — a stale declared gap fails GAP-STALE (repointed at 'context' — spec 0179 step 13 retires the 'hooks' arm of this blanket loop, so this case now exercises the surviving subject)"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
stale_fix="$sandbox/extensions/core/stalegap"
mkdir -p "$stale_fix"
cat > "$stale_fix/extension.json" <<'EOF'
{"name":"stalegap","version":"0.0.1","description":"fixture"}
EOF
cat > "$stale_fix/accepted-gaps.json" <<'EOF'
[{"subject":"context","target":"gemini","reason":"accepted for the fixture"}]
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check stalegap 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GAP-STALE" && echo "$out" | grep -q "context@gemini"; then
  ok "Case 7 — an accepted gap the render no longer observes fails as GAP-STALE"
else
  ng "Case 7 — GAP-STALE did not fire as expected (rc=$rc):"$'\n'"$out"
fi

# ---------------------------------------------------------------------------
echo "8. spec 0179 R12/R14/R15 — a REAL hook-granular gap (not the retired blanket one) warns, never fails the render, and fails --check until declared"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
gap_fix="$sandbox/extensions/core/realgap"
mkdir -p "$gap_fix/hooks"
cat > "$gap_fix/extension.json" <<'EOF'
{"name":"realgap","version":"0.0.1","description":"fixture",
 "hooks":[{"id":"prompt-logger","event":"UserPromptSubmit","command":"echo hi"}]}
EOF
render_out="$( cd "$sandbox" && bash scripts/build-extension.sh --target all realgap 2>&1 )"
render_rc=$?
observed="$sandbox/build/gaps/realgap/observed-gaps.json"
if [ "$render_rc" -eq 0 ] && echo "$render_out" | grep -qi "Warning:.*prompt-logger.*antigravity" \
   && [ -f "$observed" ] \
   && jq -e '.[] | select(.subject=="hooks" and .target=="antigravity" and .hook=="prompt-logger" and .event=="UserPromptSubmit" and .part=="event")' "$observed" >/dev/null 2>&1; then
  ok "Case 8a — the render warns and records the hook-granular gap (hook/event/part), and still exits 0 (R12: never silent, never a build failure)"
else
  ng "Case 8a — render did not warn/record/exit-0 as expected (rc=$render_rc):"$'\n'"$render_out"
fi
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check realgap 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GAP-UNDECLARED" && echo "$out" | grep -q "prompt-logger"; then
  ok "Case 8b — --check fails as GAP-UNDECLARED, naming the hook, with no accepted-gaps.json"
else
  ng "Case 8b — GAP-UNDECLARED did not fire as expected (rc=$rc):"$'\n'"$out"
fi
cat > "$gap_fix/accepted-gaps.json" <<'EOF'
[{"subject":"hooks","target":"antigravity","hook":"prompt-logger","event":"UserPromptSubmit","part":"event","reason":"accepted for the fixture"}]
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check realgap 2>&1 )"
rc=$?
if [ "$rc" -eq 0 ]; then
  ok "Case 8c — declaring the observed hook-granular gap in accepted-gaps.json makes --check pass"
else
  ng "Case 8c — --check still fails after declaring the gap:"$'\n'"$out"
fi

# ---------------------------------------------------------------------------
echo "9. R5 — no subject declared remains valid; a stray components.hooks block does not crash"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
bare_fix="$sandbox/extensions/core/bare"
mkdir -p "$bare_fix"
cat > "$bare_fix/extension.json" <<'EOF'
{"name":"bare","version":"0.0.1","description":"fixture"}
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check bare 2>&1 )"
[ $? -eq 0 ] && ok "Case 9a — an extension declaring no subject at all still renders/checks cleanly" \
  || ng "Case 9a — a subjectless manifest failed:"$'\n'"$out"

stray_fix="$sandbox/extensions/core/strayhooks"
mkdir -p "$stray_fix"
cat > "$stray_fix/extension.json" <<'EOF'
{"name":"strayhooks","version":"0.0.1","description":"fixture","components":{"hooks":{"enabled":true,"location":"hooks/"}}}
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check strayhooks 2>&1 )"
[ $? -eq 0 ] && ok "Case 9b — a stray legacy components.hooks block causes no crash" \
  || ng "Case 9b — a stray components.hooks block broke the render:"$'\n'"$out"

# ---------------------------------------------------------------------------
echo "10. R10(c) — the guard tracks the declared set, not a fixed file list"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
grow_fix="$sandbox/extensions/core/grow"
mkdir -p "$grow_fix/commands"
cat > "$grow_fix/extension.json" <<'EOF'
{"name":"grow","version":"0.0.1","description":"fixture","commands":{"location":"commands/"}}
EOF
cat > "$grow_fix/commands/first.md" <<'EOF'
---
name: first
description: "first command"
type: command
---
First.
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check grow 2>&1 )"
[ $? -eq 0 ] && ok "Case 10a — baseline (one command) is clean" || ng "Case 10a — baseline failed:"$'\n'"$out"

cat > "$grow_fix/commands/second.md" <<'EOF'
---
name: second
description: "second command"
type: command
---
Second.
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check grow 2>&1 )"
[ $? -eq 0 ] && ok "Case 10b — adding a second pivot stays clean after a real render (the declared set grew, and so did the produced set)" \
  || ng "Case 10b — the guard did not track the grown declaration:"$'\n'"$out"

# ---------------------------------------------------------------------------
echo "11. R16 — two arms, because they certify different claims (v2-F2)"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
r16_fix="$sandbox/extensions/core/r16fix"
mkdir -p "$r16_fix/.github/copilot"
cat > "$r16_fix/extension.json" <<'EOF'
{"name":"r16fix","version":"0.0.1","description":"fixture"}
EOF
cat > "$r16_fix/.github/copilot/extension.json" <<'EOF'
{"name":"r16fix","version":"0.0.1"}
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r16fix 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "COMMITTED" && echo "$out" | grep -q ".github/copilot/extension.json"; then
  ok "Case 11(i) — a restored .github/copilot/extension.json inside an extension fails as COMMITTED (class membership)"
else
  ng "Case 11(i) — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# Case 11(ii) — the repo-level assertion against the real, post-deletion
# extension-skeleton/ tree: no file matches manifest_class at a component-dir
# root, and none matches generated_globs anywhere. Component dirs are the
# skeleton's own top-level members (base/, command/, skill/, agent/, hook/,
# mcp-server/, theme/) — each is what create-extension.sh copies verbatim
# into a fresh scaffold's root, so it is the "component-dir root" R16 names.
skeleton_violations=""
for comp_dir in "$REPO_DIR"/extension-skeleton/*/; do
  [ -d "$comp_dir" ] || continue
  while IFS= read -r rel; do
    [ -z "$rel" ] && continue
    if jq -e --arg r "$rel" '.manifest_class | index($r) != null' "$GENERATED_CLASS" >/dev/null 2>&1; then
      skeleton_violations="$skeleton_violations${comp_dir}${rel}"$'\n'
      continue
    fi
    globs="$(jq -r '.generated_globs[]' "$GENERATED_CLASS")"
    while IFS= read -r glob; do
      [ -z "$glob" ] && continue
      # shellcheck disable=SC2254  # deliberate: $glob is a glob pattern
      case "$rel" in
        $glob) skeleton_violations="$skeleton_violations${comp_dir}${rel}"$'\n' ;;
      esac
    done <<< "$globs"
  done < <(cd "$comp_dir" && find . -type f | sed 's#^\./##' | sort)
done
if [ -z "$skeleton_violations" ]; then
  ok "Case 11(ii) — no file under extension-skeleton/ matches manifest_class at a component-dir root or generated_globs anywhere"
else
  ng "Case 11(ii) — extension-skeleton/ still carries a generated-output-class member:"$'\n'"$skeleton_violations"
fi

# ---------------------------------------------------------------------------
echo "12. Scaffolder harness (v3-F1/v4-F1) — the fzf stub, org-tier isolation"
# ---------------------------------------------------------------------------
FZF_STUB_DIR="$TMP_ROOT/fzf-stub"
mkdir -p "$FZF_STUB_DIR"
cat > "$FZF_STUB_DIR/fzf" <<'EOF'
#!/bin/bash
cat > /dev/null
printf '%s' "$CREWRIG_TEST_FZF_SELECTION"
EOF
chmod +x "$FZF_STUB_DIR/fzf"

# scaffold <selection> — a fresh sandbox per case (create-extension.sh's own
# TARGET-exists guard is not idempotent across reruns; a fresh sandbox is
# what makes reruns repeatable). Prints "<sandbox>\t<captured-stdout-b64>".
scaffold() {
  local selection="$1"
  local sandbox out
  sandbox="$(make_sandbox)"
  out="$(cd "$sandbox" && NAME=probe TIER=org CREWRIG_TEST_FZF_SELECTION="$selection" PATH="$FZF_STUB_DIR:$PATH" bash scripts/create-extension.sh 2>&1)"
  printf '%s\t%s\n' "$sandbox" "$(printf '%s' "$out" | base64 | tr -d '\n')"
}

assert_selection_took_effect() {
  # assert_selection_took_effect <label> <sandbox> <stdout> <comp> <file-under-probe>
  local label="$1" sandbox="$2" out="$3" comp="$4" file="$5"
  if echo "$out" | grep -q "Added: $comp"; then
    ok "$label — stdout carries 'Added: $comp'"
  else
    ng "$label — stdout is missing 'Added: $comp':"$'\n'"$out"
  fi
  if [ -e "$sandbox/extensions/org/probe/$file" ]; then
    ok "$label — expected file extensions/org/probe/$file is present"
  else
    ng "$label — expected file extensions/org/probe/$file is MISSING"
  fi
}

# The negative control for the assertion itself (v4-F1): a selection no
# skeleton directory carries must fail the assertion, not reach a clean
# --check.
result="$(scaffold "mcp")"
neg_out_b64="${result#*$'\t'}"
neg_out="$(printf '%s' "$neg_out_b64" | base64 -d)"
if echo "$neg_out" | grep -q "Added:"; then
  ng "Case 12 negative control — an unoffered selection ('mcp') should print no 'Added:' line, but got:"$'\n'"$neg_out"
else
  ok "Case 12 negative control — an unoffered selection ('mcp') prints no 'Added:' line (v4-F1's own failure mode reproduced)"
fi

# ---------------------------------------------------------------------------
echo "13. v2-F1 — scaffold org-tier manifest path (mcp-server, theme)"
# ---------------------------------------------------------------------------
for comp_file in "mcp-server:src/index.ts" "theme:CLAUDE.md"; do
  comp="${comp_file%%:*}"
  file="${comp_file#*:}"
  result="$(scaffold "$comp")"
  sandbox="${result%%$'\t'*}"
  out_b64="${result#*$'\t'}"
  out="$(printf '%s' "$out_b64" | base64 -d)"
  assert_selection_took_effect "Case 13 ($comp)" "$sandbox" "$out" "$comp" "$file"
  chk_out="$( cd "$sandbox" && bash scripts/build-extension.sh --check probe 2>&1 )"
  chk_rc=$?
  if [ "$chk_rc" -eq 0 ]; then
    ok "Case 13 ($comp) — --check is clean on the scaffold (no committed generated-class file, fragment merge targets extension.json only)"
  else
    ng "Case 13 ($comp) — --check failed on a fresh scaffold:"$'\n'"$chk_out"
  fi
  # A scaffold must commit no second manifest — gemini-extension.json is
  # deleted from the skeleton (step 8) and the fragment merge no longer
  # writes it (step 11).
  if [ ! -e "$sandbox/extensions/org/probe/gemini-extension.json" ]; then
    ok "Case 13 ($comp) — the scaffold carries no gemini-extension.json"
  else
    ng "Case 13 ($comp) — the scaffold still carries a gemini-extension.json"
  fi
done

# ---------------------------------------------------------------------------
echo "14. v2-F1 — scaffold org-tier command path"
# ---------------------------------------------------------------------------
result="$(scaffold "command")"
sandbox="${result%%$'\t'*}"
out_b64="${result#*$'\t'}"
out="$(printf '%s' "$out_b64" | base64 -d)"
assert_selection_took_effect "Case 14" "$sandbox" "$out" "command" "commands/sample.md"
if [ ! -e "$sandbox/extensions/org/probe/commands/sample.toml" ]; then
  ok "Case 14 — the scaffold carries no committed commands/sample.toml (the pivot swap of step 8 holds)"
else
  ng "Case 14 — the scaffold still carries a committed commands/sample.toml"
fi
chk_out="$( cd "$sandbox" && bash scripts/build-extension.sh --check probe 2>&1 )"
chk_rc=$?
if [ "$chk_rc" -eq 0 ]; then
  ok "Case 14 — --check is clean on the command scaffold"
else
  ng "Case 14 — --check failed on the command scaffold:"$'\n'"$chk_out"
fi
# Read the manifest's own .name rather than assuming it is "probe": on a host
# whose `file` does not classify JSON as text (macOS's newer libmagic, for
# one), create-extension.sh's `${SKELETON_NAME}` placeholder sed (:64-69,
# pre-existing and out of this ticket's scope) silently skips every .json
# file, so the manifest's `name` stays the literal placeholder and the build
# directory is keyed on THAT string, not on the scaffold's directory name.
manifest_name="$(jq -r '.name' "$sandbox/extensions/org/probe/extension.json")"
if [ -f "$sandbox/build/extensions/$manifest_name/commands/sample.toml" ]; then
  ok "Case 14 — the render produces build/extensions/$manifest_name/commands/sample.toml from the pivot sample.md (ext_discover_dirs reaches extensions/org)"
else
  ng "Case 14 — the render did not produce commands/sample.toml for the org-tier scaffold (build/extensions/$manifest_name/)"
fi

# ---------------------------------------------------------------------------
echo "15. Issue #1004 iter 3 — --check leaves no delegated plugin staging dir inside extensions/"
# ---------------------------------------------------------------------------
# build-claude-plugin.sh's own bare-invocation default stages into
# <ext_dir>/dist-claude-plugin/<name> — physically inside the extension's own
# committed source directory, gitignored but not cleaned up afterward.
# --check's RENDER-FAIL arm (b) forces a full --target all render (which
# delegates to that default, since build-extension.sh does not pass an
# override), so a --check run used to leave that staging dir behind for
# other, unrelated scripts to trip over when they run in the SAME workspace
# — scripts/check-extension-provenance.sh's `find` over extensions/core and
# extensions/library wrongly charged it as an unprovenanced committed
# source, and scripts/tests/test-install-claude-plugin-marketplace.sh's
# stray-dist-claude-plugin `find` over the whole repo wrongly attributed it
# to that OTHER script's own install run. Both false positives were invisible
# under a fresh per-job CI checkout and surfaced only in the fail-safe
# changeset-coverage job that runs the full suite in one workspace (spec
# 0147 R5).
sandbox="$(make_sandbox)"
plugin_fix="$sandbox/extensions/core/pluginstray"
mkdir -p "$plugin_fix"
cat > "$plugin_fix/extension.json" <<'EOF'
{"name":"pluginstray","version":"0.0.1","description":"fixture"}
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check pluginstray 2>&1 )"
rc=$?
stray="$(find "$sandbox/extensions" -mindepth 3 -maxdepth 3 -type d -name 'dist-*-plugin' 2>/dev/null)"
if [ "$rc" -eq 0 ] && [ -z "$stray" ]; then
  ok "Case 15a — --check exits 0 and leaves no dist-*-plugin/ under extensions/ (find extensions -mindepth 3 -maxdepth 3 -name 'dist-*-plugin' is empty)"
else
  ng "Case 15a — --check (rc=$rc) left a stray plugin staging dir behind:"$'\n'"$stray"$'\n'"$out"
fi
# Paired negative — the cleanup must be --check-only. An ORDINARY render (no
# --check) is the one path whose whole point is to leave a persistent,
# inspectable Claude plugin directory behind for `claude --plugin-dir` /
# install-claude-plugin.sh to use (EXTENSION-FORMAT.md's documented model,
# pinned by scripts/tests/test-extension-render-conformance.sh); a fix that
# swept on every render, not just --check, would silently break that
# contract instead.
render_out="$( cd "$sandbox" && bash scripts/build-extension.sh --target claude pluginstray 2>&1 )"
render_rc=$?
if [ "$render_rc" -eq 0 ] && [ -f "$plugin_fix/dist-claude-plugin/pluginstray/.claude-plugin/plugin.json" ]; then
  ok "Case 15b — an ordinary (non --check) render still leaves the Claude plugin directory in place"
else
  ng "Case 15b — an ordinary render (rc=$render_rc) did not leave dist-claude-plugin/pluginstray/.claude-plugin/plugin.json in place:"$'\n'"$render_out"
fi

# ---------------------------------------------------------------------------
echo "16. spec 0179 R17 — scaffold org-tier hook path (hooks.json.fragment, neutral declaration only)"
# ---------------------------------------------------------------------------
result="$(scaffold "hook")"
sandbox="${result%%$'\t'*}"
out_b64="${result#*$'\t'}"
out="$(printf '%s' "$out_b64" | base64 -d)"
assert_selection_took_effect "Case 16" "$sandbox" "$out" "hook" "hooks/logger.sh"
if [ ! -e "$sandbox/extensions/org/probe/hooks/hooks.json" ] && [ ! -e "$sandbox/extensions/org/probe/hooks.json.fragment" ]; then
  ok "Case 16 — the scaffold carries no committed hooks/hooks.json and no leftover hooks.json.fragment (the fragment merge consumed and deleted it)"
else
  ng "Case 16 — the scaffold left a committed hooks/hooks.json or an un-merged hooks.json.fragment behind"
fi
if jq -e '(.hooks // []) | length == 1 and .[0].event == "PreToolUse"' "$sandbox/extensions/org/probe/extension.json" >/dev/null 2>&1; then
  ok "Case 16 — the merged manifest carries exactly one generic hook entry, declared neutrally (event PreToolUse)"
else
  ng "Case 16 — the merged manifest's generic hooks section is missing or malformed"
fi
chk_out="$( cd "$sandbox" && bash scripts/build-extension.sh --check probe 2>&1 )"
chk_rc=$?
if [ "$chk_rc" -eq 0 ]; then
  ok "Case 16 — --check is clean on the hook scaffold (renders on every target the example event has a counterpart on, no gap declaration needed)"
else
  ng "Case 16 — --check failed on the hook scaffold:"$'\n'"$chk_out"
fi

# ---------------------------------------------------------------------------
echo "17. spec 0179 step 26 — R15 gap reconciliation mutation tests"
# ---------------------------------------------------------------------------
sandbox="$(make_sandbox)"
r15_fix="$sandbox/extensions/core/r15fix"
mkdir -p "$r15_fix"
cat > "$r15_fix/extension.json" <<'EOF'
{"name":"r15fix","version":"0.0.1","description":"fixture",
 "hooks":[{"id":"probe","event":"UserPromptSubmit","command":"echo hi"}]}
EOF
cat > "$r15_fix/accepted-gaps.json" <<'EOF'
[{"subject":"hooks","target":"antigravity","hook":"probe","event":"UserPromptSubmit","part":"event","reason":"accepted"}]
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r15fix 2>&1 )"
[ $? -eq 0 ] && ok "Case 17a — baseline (gap declared exactly) is clean" || ng "Case 17a — baseline failed:"$'\n'"$out"

# Delete the entry -> GAP-UNDECLARED, naming the hook, event and target.
echo '[]' > "$r15_fix/accepted-gaps.json"
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r15fix 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GAP-UNDECLARED" && echo "$out" | grep -q "probe" && echo "$out" | grep -q "UserPromptSubmit" && echo "$out" | grep -q "antigravity"; then
  ok "Case 17b — deleting the accepted entry fails GAP-UNDECLARED, naming hook/event/target"
else
  ng "Case 17b — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# Add an entry the render doesn't observe -> GAP-STALE.
cat > "$r15_fix/accepted-gaps.json" <<'EOF'
[{"subject":"hooks","target":"antigravity","hook":"probe","event":"UserPromptSubmit","part":"event","reason":"accepted"},
 {"subject":"hooks","target":"antigravity","hook":"ghost","event":"UserPromptSubmit","part":"event","reason":"never observed"}]
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r15fix 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GAP-STALE" && echo "$out" | grep -q "ghost"; then
  ok "Case 17c — an accepted entry the render no longer observes fails GAP-STALE, naming it"
else
  ng "Case 17c — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# Growth (R14 discrimination bar): two hooks sharing an id, differing ONLY
# in their neutral event, must NOT collapse onto one subject@target key.
# The real vocabulary has exactly one event that gaps on Antigravity
# (UserPromptSubmit); this sandbox's OWN copy of the translator is mutated
# so PreToolUse gaps there too, purely to construct the second colliding
# gap the discrimination bar needs to be tested against.
sed -i.bak 's/antigravity:PreToolUse) echo "PreToolUse" ;;/antigravity:PreToolUse) : ;;/' "$sandbox/scripts/lib/extension-hooks.sh"
cat > "$r15_fix/extension.json" <<'EOF'
{"name":"r15fix","version":"0.0.1","description":"fixture",
 "hooks":[{"id":"probe","event":"PreToolUse","command":"echo a"},
          {"id":"probe","event":"UserPromptSubmit","command":"echo b"}]}
EOF
cat > "$r15_fix/accepted-gaps.json" <<'EOF'
[{"subject":"hooks","target":"antigravity","hook":"probe","event":"UserPromptSubmit","part":"event","reason":"accepted only this one"}]
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r15fix 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "GAP-UNDECLARED" && echo "$out" | grep -q "PreToolUse"; then
  ok "Case 17d — two hooks sharing an id but differing only in event produce DISTINGUISHABLE gap keys (accepting one leaves the other GAP-UNDECLARED, not silently satisfied)"
else
  ng "Case 17d — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# ---------------------------------------------------------------------------
echo "18. spec 0179 step 27 — the four retirements are load-bearing, on all four sections"
# ---------------------------------------------------------------------------
for cli in gemini claude copilot antigravity; do
  sandbox="$(make_sandbox)"
  r27_fix="$sandbox/extensions/core/r27fix"
  mkdir -p "$r27_fix"
  jq -n --arg cli "$cli" '{name:"r27fix", version:"0.0.1", description:"fixture"} * {($cli): {hooks: {}}}' > "$r27_fix/extension.json"
  out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r27fix 2>&1 )"
  rc=$?
  if [ "$rc" -ne 0 ] && echo "$out" | grep -q "VALIDATION-ERROR" && echo "$out" | grep -q "$cli.hooks"; then
    ok "Case 18 ($cli) — a re-added '$cli.hooks' per-CLI key is rejected as inadmissible"
  else
    ng "Case 18 ($cli) — did not reject '$cli.hooks' as expected (rc=$rc):"$'\n'"$out"
  fi
done

# A rendered hooks/hooks.json committed inside a fixture source tree fails COMMITTED (R13).
sandbox="$(make_sandbox)"
r27committed="$sandbox/extensions/core/r27committed"
mkdir -p "$r27committed/hooks"
cat > "$r27committed/extension.json" <<'EOF'
{"name":"r27committed","version":"0.0.1","description":"fixture"}
EOF
echo '{"hooks":{}}' > "$r27committed/hooks/hooks.json"
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r27committed 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "COMMITTED" && echo "$out" | grep -q "hooks/hooks.json"; then
  ok "Case 18 (committed) — a committed hooks/hooks.json fails as COMMITTED and is named"
else
  ng "Case 18 (committed) — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# A matcher declared on a matcher-rejecting event is a validation error, not
# a silently ignored key (R8).
sandbox="$(make_sandbox)"
r27matcher="$sandbox/extensions/core/r27matcher"
mkdir -p "$r27matcher"
cat > "$r27matcher/extension.json" <<'EOF'
{"name":"r27matcher","version":"0.0.1","description":"fixture",
 "hooks":[{"id":"probe","event":"UserPromptSubmit","matcher":"shell","command":"echo hi"}]}
EOF
out="$( cd "$sandbox" && bash scripts/build-extension.sh --check r27matcher 2>&1 )"
rc=$?
if [ "$rc" -ne 0 ] && echo "$out" | grep -q "VALIDATION-ERROR" && echo "$out" | grep -qi "matcher"; then
  ok "Case 18 (matcher) — a matcher on a matcher-rejecting event is a validation error, not silently ignored"
else
  ng "Case 18 (matcher) — did not fail as expected (rc=$rc):"$'\n'"$out"
fi

# ---------------------------------------------------------------------------
echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
