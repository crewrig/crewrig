#!/bin/bash
# test-monorepo-release.sh — Hermetic regression tests for the monorepo
# release driver (spec 0213 + delta-01, PLAN v2 step 10): bash + jq only, no
# network, no engine call. An `npx` shim on PATH records every invocation, so
# a refused run can be proven to have made none.
#
# scripts/tests/test-monorepo-release-engine.sh is the sibling suite that
# exercises the REAL semantic-release engine end to end (rehearsal + GitLab
# publish against a stub) — this file never gets that far by design.
#
# Cases (PLAN v2 step 10):
#   (a) R10   — each detection branch of release_detect_forge refuses,
#               naming the forge, with zero shim calls and no .releaserc.json
#               written anywhere.
#   (b)       — the RELEASE_DRY_RUN/DRY_RUN switch matrix (canonical, alias,
#               conflict, invalid), and the GitLab merge-request/tag pipeline
#               refusal (v1-F8, v2-F6c wording).
#   (c)       — emit_releaserc github publish is byte-for-byte (jq -S .) the
#               committed golden (test fixtures/release/github-releaserc.golden.json);
#               release_identity exports today's four values when unset and
#               respects values the caller already set.
#   (d)       — R2/R7 structure: the github/gitlab publish configs for the
#               same extension are equal except the publish leg, the
#               notes-leg keys and repositoryUrl; the GitLab publish entry
#               carries exactly one asset, target generic_package, no label;
#               neither forge's REHEARSAL config carries a publish entry.
#   (e)   R11 — a credential value is never printed, only named on refusal;
#               release_is_credential_name / release_strip_args cover
#               CI_REPOSITORY_URL (plan review v2-F2); release-rehearse.mjs
#               refuses (exit 2, naming only) when a credential variable is
#               still present in its own environment.
#   (f)       — docs/gitlab-release-publishing.md names no
#               `extensions install` command (ruling 1).
#
# Usage:
#   bash scripts/tests/test-monorepo-release.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DRIVER="$SCRIPT_DIR/monorepo-release.sh"
LIB="$SCRIPT_DIR/lib/monorepo-release-lib.sh"
FIXTURE_DIR="$SCRIPT_DIR/tests/fixtures/release"

if [ ! -f "$DRIVER" ]; then
  echo "FATAL: cannot find $DRIVER" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "FATAL: jq is required" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

pass=0
fail=0
ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }

# --- The npx/node shim -------------------------------------------------------
# A refused run MUST make no engine call at all (R10). The shim records every
# invocation as one line in SHIM_CALLS; callers assert it stays empty.
SHIM_DIR="$TMP_ROOT/shim-bin"
mkdir -p "$SHIM_DIR"
SHIM_CALLS="$TMP_ROOT/shim-calls.log"
cat > "$SHIM_DIR/npx" <<EOF
#!/bin/bash
echo "npx \$*" >> "$SHIM_CALLS"
exit 0
EOF
chmod +x "$SHIM_DIR/npx"
SHIM_PATH="$SHIM_DIR:$PATH"

# run_driver_refused <env-assignment...> — runs the real top-level driver
# from a neutral, empty cwd (no git repo at all — every case below refuses at
# forge detection, BEFORE release_branch's `git rev-parse` would ever run),
# with the npx shim first on PATH. Sets RC/ERR (every case only asserts the
# exit code and stderr's refusal message, never stdout or the cwd itself).
run_driver_refused() {
  local cwd out err
  cwd="$(mktemp -d "$TMP_ROOT/cwd.XXXXXX")"
  out="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  ( cd "$cwd" && env -i PATH="$SHIM_PATH" HOME="$TMP_ROOT" \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null "$@" bash "$DRIVER" ) > "$out" 2> "$err"
  RC=$?
  ERR="$(cat "$err")"
  rm -f "$out" "$err"
}

# =============================================================================
# (a) R10 — every detection branch refuses, names the forge, calls nothing
# =============================================================================
{
  : > "$SHIM_CALLS"
  run_driver_refused GITEA_ACTIONS=true
  if [ "$RC" -eq 2 ] && grep -q 'unsupported release forge: gitea' <<< "$ERR"; then
    ok "(a) GITEA_ACTIONS=true refuses, naming gitea"
  else
    ng "(a) GITEA_ACTIONS=true: expected exit 2 naming gitea, got rc=$RC: $ERR"
  fi

  : > "$SHIM_CALLS"
  run_driver_refused GITHUB_ACTIONS=true GITLAB_CI=true
  if [ "$RC" -eq 2 ] && grep -q 'unsupported release forge: ambiguous (github+gitlab)' <<< "$ERR"; then
    ok "(a) GITHUB_ACTIONS=true + GITLAB_CI=true refuses, naming the ambiguity"
  else
    ng "(a) ambiguous forge: expected exit 2 naming ambiguous, got rc=$RC: $ERR"
  fi

  : > "$SHIM_CALLS"
  run_driver_refused CI=true
  if [ "$RC" -eq 2 ] && grep -q 'unsupported release forge: unknown CI' <<< "$ERR"; then
    ok "(a) CI=true alone refuses, naming unknown CI"
  else
    ng "(a) unknown CI: expected exit 2 naming unknown CI, got rc=$RC: $ERR"
  fi

  : > "$SHIM_CALLS"
  run_driver_refused
  if [ "$RC" -eq 2 ] && grep -q 'unsupported release forge: none (not a CI environment)' <<< "$ERR"; then
    ok "(a) no CI variable at all refuses, naming 'none (not a CI environment)'"
  else
    ng "(a) no CI vars: expected exit 2 naming none, got rc=$RC: $ERR"
  fi

  if [ ! -s "$SHIM_CALLS" ]; then
    ok "(a) the npx shim recorded zero calls across all four refusals"
  else
    ng "(a) the npx shim recorded a call despite every case refusing: $(cat "$SHIM_CALLS")"
  fi

  stray="$(find "$TMP_ROOT" -name '.releaserc.json' 2>/dev/null)"
  if [ -z "$stray" ]; then
    ok "(a) no .releaserc.json was written anywhere during the four refusals"
  else
    ng "(a) a .releaserc.json was written despite refusing: $stray"
  fi
}

# =============================================================================
# (b) Switch matrix — RELEASE_DRY_RUN/DRY_RUN, and the GitLab
# merge-request/tag pipeline refusal
# =============================================================================
run_mode() {
  # run_mode <env-assignment...> — sources the lib and echoes RELEASE_MODE,
  # or "REFUSED:<rc>" if release_mode exits.
  ( eval "$*"; . "$LIB" >/dev/null 2>&1; release_mode; echo "$RELEASE_MODE" )
}

{
  [ "$(run_mode RELEASE_DRY_RUN=true)" = "rehearsal" ] \
    && ok "(b) RELEASE_DRY_RUN=true selects rehearsal" \
    || ng "(b) RELEASE_DRY_RUN=true did not select rehearsal"

  [ "$(run_mode DRY_RUN=true)" = "rehearsal" ] \
    && ok "(b) DRY_RUN=true (accepted alias) selects rehearsal" \
    || ng "(b) DRY_RUN=true did not select rehearsal"

  [ "$(run_mode)" = "publish" ] \
    && ok "(b) neither variable set selects publish (default)" \
    || ng "(b) the default mode is not publish"

  [ "$(run_mode RELEASE_DRY_RUN=false DRY_RUN=false)" = "publish" ] \
    && ok "(b) both explicitly false selects publish" \
    || ng "(b) both-false did not select publish"

  [ "$(run_mode RELEASE_DRY_RUN=false DRY_RUN=true)" = "rehearsal" ] \
    && ok "(b) a conflict (RELEASE_DRY_RUN=false, DRY_RUN=true) resolves to rehearsal (true wins)" \
    || ng "(b) the conflict did not resolve to rehearsal"

  [ "$(run_mode RELEASE_DRY_RUN=true DRY_RUN=false)" = "rehearsal" ] \
    && ok "(b) the reverse conflict (RELEASE_DRY_RUN=true, DRY_RUN=false) also resolves to rehearsal" \
    || ng "(b) the reverse conflict did not resolve to rehearsal"

  out_invalid1="$(RELEASE_DRY_RUN=maybe bash -c ". '$LIB'; release_mode" 2>&1)"
  rc_invalid1=$?
  if [ "$rc_invalid1" -eq 2 ] && grep -q 'invalid RELEASE_DRY_RUN value' <<< "$out_invalid1"; then
    ok "(b) an invalid RELEASE_DRY_RUN value is refused by name"
  else
    ng "(b) invalid RELEASE_DRY_RUN: expected exit 2 naming it, got rc=$rc_invalid1: $out_invalid1"
  fi

  out_invalid2="$(DRY_RUN=1 bash -c ". '$LIB'; release_mode" 2>&1)"
  rc_invalid2=$?
  if [ "$rc_invalid2" -eq 2 ] && grep -q 'invalid DRY_RUN value' <<< "$out_invalid2"; then
    ok "(b) an invalid DRY_RUN value is refused by name"
  else
    ng "(b) invalid DRY_RUN: expected exit 2 naming it, got rc=$rc_invalid2: $out_invalid2"
  fi

  # GitLab branch resolution: a merge-request pipeline is refused by name,
  # naming both merge-request and tag pipelines in the message (v2-F6c).
  out_mr="$(CI_PIPELINE_SOURCE=merge_request_event CI_COMMIT_BRANCH=main \
    bash -c ". '$LIB'; release_branch gitlab" 2>&1)"
  rc_mr=$?
  if [ "$rc_mr" -eq 2 ] && grep -q 'not a branch pipeline (merge-request or tag)' <<< "$out_mr"; then
    ok "(b) a GitLab merge-request pipeline is refused, naming 'not a branch pipeline (merge-request or tag)'"
  else
    ng "(b) merge-request pipeline: expected exit 2 with that wording, got rc=$rc_mr: $out_mr"
  fi

  # A tag pipeline (no CI_COMMIT_BRANCH at all) hits the same refusal.
  out_tag="$(CI_PIPELINE_SOURCE=push CI_COMMIT_BRANCH= \
    bash -c ". '$LIB'; release_branch gitlab" 2>&1)"
  rc_tag=$?
  if [ "$rc_tag" -eq 2 ] && grep -q 'not a branch pipeline (merge-request or tag)' <<< "$out_tag"; then
    ok "(b) an empty CI_COMMIT_BRANCH (tag pipeline) is refused with the same wording"
  else
    ng "(b) tag pipeline: expected exit 2 with that wording, got rc=$rc_tag: $out_tag"
  fi

  out_ok="$(CI_PIPELINE_SOURCE=push CI_COMMIT_BRANCH=main \
    bash -c ". '$LIB'; release_branch gitlab; echo \"\$RELEASE_BRANCH\"" 2>&1)"
  if [ "$out_ok" = "main" ]; then
    ok "(b) a GitLab branch pipeline resolves RELEASE_BRANCH=main"
  else
    ng "(b) branch pipeline resolution failed: $out_ok"
  fi
}

# =============================================================================
# (c) GitHub unchanged — golden equality, release_identity defaults/override
# =============================================================================
{
  golden="$FIXTURE_DIR/github-releaserc.golden.json"
  if [ ! -f "$golden" ]; then
    ng "(c) golden fixture missing: $golden"
  else
    # The gitmoji facade is resolved from the library's own location (issue
    # #1225), not from <root>; map that one real prefix back to the golden's
    # placeholder, the same literal substitution the golden generator applies.
    actual="$(bash -c ". '$LIB'; emit_releaserc github publish foo /ROOT /ROOT/dist/release/foo main" \
      | jq -S --arg lib "$REPO_DIR/scripts/lib/" \
          'walk(if type == "string" then (split($lib) | join("/ROOT/scripts/lib/")) else . end)')"
    expected="$(jq -S . "$golden")"
    if [ "$actual" = "$expected" ]; then
      ok "(c) emit_releaserc github publish is byte-for-byte (jq -S .) the committed golden"
    else
      ng "(c) emit_releaserc github publish diverges from the golden: $(diff <(echo "$expected") <(echo "$actual"))"
    fi
  fi

  ident_defaults="$(bash -c ". '$LIB'; release_identity github; \
    echo \"\$GIT_AUTHOR_NAME|\$GIT_AUTHOR_EMAIL|\$GIT_COMMITTER_NAME|\$GIT_COMMITTER_EMAIL\"")"
  if [ "$ident_defaults" = "github-actions[bot]|github-actions[bot]@users.noreply.github.com|github-actions[bot]|github-actions[bot]@users.noreply.github.com" ]; then
    ok "(c) release_identity github exports today's four values when unset"
  else
    ng "(c) release_identity github defaults are wrong: $ident_defaults"
  fi

  ident_override="$(GIT_AUTHOR_NAME=custom-name bash -c ". '$LIB'; release_identity github; echo \"\$GIT_AUTHOR_NAME\"")"
  if [ "$ident_override" = "custom-name" ]; then
    ok "(c) release_identity github respects a value the caller already set"
  else
    ng "(c) release_identity github overwrote a preset GIT_AUTHOR_NAME: $ident_override"
  fi

  ident_gitlab="$(bash -c ". '$LIB'; release_identity gitlab; \
    echo \"got:\${GIT_AUTHOR_NAME:-<unset>}\"")"
  if [ "$ident_gitlab" = "got:<unset>" ]; then
    ok "(c) release_identity gitlab sets nothing (the core's semantic-release-bot fallback applies)"
  else
    ng "(c) release_identity gitlab unexpectedly set something: $ident_gitlab"
  fi
}

# =============================================================================
# (d) R2/R7 structure — github vs gitlab, publish vs rehearsal
# =============================================================================
{
  gh_publish="$(bash -c ". '$LIB'; emit_releaserc github publish foo /ROOT /ROOT/out main")"
  gl_publish="$(CI_PROJECT_URL=https://gitlab.example.test/acme/foo CI_SERVER_URL=https://gitlab.example.test \
    bash -c ". '$LIB'; CI_PROJECT_URL=\$CI_PROJECT_URL CI_SERVER_URL=\$CI_SERVER_URL emit_releaserc gitlab publish foo /ROOT /ROOT/out main")"

  shared_fields='{extends, branches, tagFormat, "gitmoji_rules": .plugins[0][1].releaseRules, "prepare": .plugins[2][1].prepareCmd, "git": .plugins[-1]}'
  gh_shared="$(printf '%s' "$gh_publish" | jq -S "$shared_fields")"
  gl_shared="$(printf '%s' "$gl_publish" | jq -S "$shared_fields")"
  if [ "$gh_shared" = "$gl_shared" ]; then
    ok "(d) extends/branches/tagFormat/analyzer rules/prepareCmd/git entry are equal across forges"
  else
    ng "(d) the shared core diverges across forges: $(diff <(echo "$gh_shared") <(echo "$gl_shared"))"
  fi

  gh_has_repo="$(printf '%s' "$gh_publish" | jq 'has("repositoryUrl")')"
  gl_has_repo="$(printf '%s' "$gl_publish" | jq 'has("repositoryUrl")')"
  if [ "$gh_has_repo" = "false" ] && [ "$gl_has_repo" = "true" ]; then
    ok "(d) only the GitLab publish config carries an explicit repositoryUrl"
  else
    ng "(d) repositoryUrl presence is wrong (github=$gh_has_repo gitlab=$gl_has_repo)"
  fi

  gh_has_notes="$(printf '%s' "$gh_publish" | jq '.plugins[0][1] | has("releaseNotes")')"
  gl_has_notes="$(printf '%s' "$gl_publish" | jq '.plugins[0][1] | has("releaseNotes")')"
  if [ "$gh_has_notes" = "false" ] && [ "$gl_has_notes" = "true" ]; then
    ok "(d) only the GitLab config carries the notes-leg override (releaseNotes)"
  else
    ng "(d) releaseNotes presence is wrong (github=$gh_has_notes gitlab=$gl_has_notes)"
  fi

  gl_publish_entry="$(printf '%s' "$gl_publish" | jq -c '.plugins[] | select(type == "array" and .[0] == "@semantic-release/gitlab")')"
  assets_len="$(printf '%s' "$gl_publish_entry" | jq '.[1].assets | length')"
  has_label="$(printf '%s' "$gl_publish_entry" | jq '.[1].assets[0] | has("label")')"
  target="$(printf '%s' "$gl_publish_entry" | jq -r '.[1].assets[0].target')"
  if [ "$assets_len" = "1" ] && [ "$has_label" = "false" ] && [ "$target" = "generic_package" ]; then
    ok "(d) the GitLab publish entry carries exactly one asset, target generic_package, no label"
  else
    ng "(d) the GitLab publish entry's asset shape is wrong: $gl_publish_entry"
  fi

  gh_rehearsal="$(GITHUB_SERVER_URL=https://github.com GITHUB_REPOSITORY=acme/fixture \
    bash -c ". '$LIB'; GITHUB_SERVER_URL=\$GITHUB_SERVER_URL GITHUB_REPOSITORY=\$GITHUB_REPOSITORY emit_releaserc github rehearsal foo /ROOT /ROOT/out main")"
  gl_rehearsal="$(CI_PROJECT_URL=https://gitlab.example.test/acme/foo CI_SERVER_URL=https://gitlab.example.test \
    bash -c ". '$LIB'; CI_PROJECT_URL=\$CI_PROJECT_URL CI_SERVER_URL=\$CI_SERVER_URL emit_releaserc gitlab rehearsal foo /ROOT /ROOT/out main")"
  gh_rehearsal_publish_entries="$(printf '%s' "$gh_rehearsal" | jq '[.plugins[] | select(type == "array" and (.[0] == "@semantic-release/github" or .[0] == "@semantic-release/gitlab"))] | length')"
  gl_rehearsal_publish_entries="$(printf '%s' "$gl_rehearsal" | jq '[.plugins[] | select(type == "array" and (.[0] == "@semantic-release/github" or .[0] == "@semantic-release/gitlab"))] | length')"
  if [ "$gh_rehearsal_publish_entries" = "0" ] && [ "$gl_rehearsal_publish_entries" = "0" ]; then
    ok "(d) neither forge's REHEARSAL config carries a publish entry"
  else
    ng "(d) a REHEARSAL config unexpectedly carries a publish entry (github=$gh_rehearsal_publish_entries gitlab=$gl_rehearsal_publish_entries)"
  fi
}

# =============================================================================
# (e) R11 — a credential is only ever named, never printed
# =============================================================================
{
  cred_out="$(RELEASE_TOKEN=sentinel-XYZ-123 bash -c ". '$LIB'; release_credential github; echo \"GITHUB_TOKEN=\$GITHUB_TOKEN\"")"
  if ! grep -vE '^GITHUB_TOKEN=' <<< "$cred_out" | grep -q 'sentinel-XYZ-123'; then
    ok "(e) release_credential's own stdout never echoes the RELEASE_TOKEN value outside the exported var line"
  else
    ng "(e) release_credential printed the sentinel value somewhere unexpected: $cred_out"
  fi

  missing_out="$(bash -c ". '$LIB'; release_credential github" 2>&1)"
  missing_rc=$?
  if [ "$missing_rc" -eq 2 ] && grep -q 'no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)' <<< "$missing_out"; then
    ok "(e) a missing GitHub credential is refused, naming GITHUB_TOKEN/RELEASE_TOKEN only"
  else
    ng "(e) missing GitHub credential: expected exit 2 naming it, got rc=$missing_rc: $missing_out"
  fi

  missing_gl_out="$(bash -c ". '$LIB'; release_credential gitlab" 2>&1)"
  missing_gl_rc=$?
  if [ "$missing_gl_rc" -eq 2 ] && grep -q 'no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)' <<< "$missing_gl_out"; then
    ok "(e) a missing GitLab credential is refused, naming GITLAB_TOKEN/RELEASE_TOKEN only"
  else
    ng "(e) missing GitLab credential: expected exit 2 naming it, got rc=$missing_gl_rc: $missing_gl_out"
  fi

  # v2-F2: the strip rule covers CI_REPOSITORY_URL as well as the core's own
  # token|password|credential|secret|private pattern.
  if bash -c ". '$LIB'; release_is_credential_name CI_REPOSITORY_URL"; then
    ok "(e) (v2-F2) release_is_credential_name recognizes CI_REPOSITORY_URL"
  else
    ng "(e) (v2-F2) release_is_credential_name does not recognize CI_REPOSITORY_URL"
  fi
  for name in GITHUB_TOKEN GL_TOKEN RELEASE_TOKEN some_password A_SECRET_KEY private_key; do
    if ! bash -c ". '$LIB'; release_is_credential_name '$name'"; then
      ng "(e) release_is_credential_name does not recognize '$name' as a credential"
    fi
  done
  ok "(e) release_is_credential_name recognizes the core's token/password/secret/private/credential pattern"

  # KEEP_THIS_VAR (not "NOT_A_CREDENTIAL" — that name contains "credential"
  # as a substring and would correctly, not spuriously, get stripped).
  #
  # $LIB is passed as $1 (with `_` standing in for $0) rather than
  # interpolated into the -c string: a single-quoted -c script needs no
  # escaping at all, so the Rule 5 array guard below appears byte-for-byte
  # as `${RELEASE_STRIP[@]+"${RELEASE_STRIP[@]}"}` — the literal form
  # scripts/lib/bash32-array-guard.sh's scanner matches. An earlier, more
  # naive double-quoted -c string required backslash-escaping that guard
  # (`\${...}\"...`), which defeated the scanner's exact-substring match and
  # read as unguarded even though it was semantically correct.
  strip_args="$(CI_REPOSITORY_URL=https://gitlab-ci-token:sentinel@example/x.git GITLAB_TOKEN=sentinel2 KEEP_THIS_VAR=keep \
    bash -c '. "$1"; release_strip_args; printf "%s\n" ${RELEASE_STRIP[@]+"${RELEASE_STRIP[@]}"}' _ "$LIB")"
  if grep -qx 'CI_REPOSITORY_URL' <<< "$strip_args" && grep -qx 'GITLAB_TOKEN' <<< "$strip_args"; then
    ok "(e) (v2-F2) release_strip_args strips both CI_REPOSITORY_URL and GITLAB_TOKEN"
  else
    ng "(e) release_strip_args did not strip the expected variables: $strip_args"
  fi
  if ! grep -qx 'KEEP_THIS_VAR' <<< "$strip_args"; then
    ok "(e) release_strip_args leaves a non-credential variable alone"
  else
    ng "(e) release_strip_args over-stripped a non-credential variable"
  fi

  # release-rehearse.mjs's OWN defence-in-depth refusal (v2-F2/v2-F6a): it
  # exits 2 BEFORE ever calling the engine when a credential variable is
  # still present in its environment — this is a pure pre-flight check, so
  # asserting it here needs no engine call and no node_modules.
  if command -v node >/dev/null 2>&1; then
    rehearse_out="$(GITLAB_TOKEN=sentinel-glpat-abc123 node "$SCRIPT_DIR/lib/release-rehearse.mjs" main 2>&1)"
    rehearse_rc=$?
    if [ "$rehearse_rc" -eq 2 ] && grep -q 'GITLAB_TOKEN' <<< "$rehearse_out" && ! grep -q 'sentinel-glpat-abc123' <<< "$rehearse_out"; then
      ok "(e) release-rehearse.mjs refuses (exit 2) with GITLAB_TOKEN present, naming it without printing its value"
    else
      ng "(e) release-rehearse.mjs did not refuse as expected (rc=$rehearse_rc): $rehearse_out"
    fi

    rehearse_out2="$(CI_REPOSITORY_URL=https://gitlab-ci-token:sentinel-def456@example.test/x.git node "$SCRIPT_DIR/lib/release-rehearse.mjs" main 2>&1)"
    rehearse_rc2=$?
    if [ "$rehearse_rc2" -eq 2 ] && grep -q 'CI_REPOSITORY_URL' <<< "$rehearse_out2" && ! grep -q 'sentinel-def456' <<< "$rehearse_out2"; then
      ok "(e) (v2-F2) release-rehearse.mjs also refuses on CI_REPOSITORY_URL, naming it without printing its value"
    else
      ng "(e) release-rehearse.mjs did not refuse on CI_REPOSITORY_URL as expected (rc=$rehearse_rc2): $rehearse_out2"
    fi
  else
    echo "SKIP  (e) release-rehearse.mjs checks — node is not on PATH (probe: 'command -v node' exit $?)"
  fi
}

# =============================================================================
# (f) Ruling 1 — the GitLab doc never RECOMMENDS `extensions install
# <gitlab-url>` as a working step (unmeasured, per open-question ruling 1).
#
# NOTE ON WORDING: the plan text for this case reads "contains no
# `extensions install`". Read literally that would forbid the phrase
# outright, but the doc (already written, PLAN v2 step 13, commit a47c691)
# correctly and deliberately NAMES the command while hedging it as
# unmeasured ("Do not assume `gemini extensions install <gitlab-url>` works
# until that measurement exists") — which is what open-question ruling 1
# actually asks for: no CLAIM that it works, not no MENTION of it at all. A
# literal empty-grep test would force the correct, honest prose back out of
# the doc, so this case checks the real invariant instead: the phrase never
# appears as a bare, runnable example inside a fenced code block (which
# WOULD read as "here is how", contradicting "unmeasured"), and every prose
# mention sits next to the hedge. Flagged for the team in the session report.
# =============================================================================
{
  doc="$REPO_DIR/docs/gitlab-release-publishing.md"
  if [ ! -f "$doc" ]; then
    ng "(f) cannot find $doc"
  else
    in_fence="$(awk '/^```/{f = !f; next} f' "$doc" | grep -c 'extensions install' || true)"
    if [ "$in_fence" -eq 0 ]; then
      ok "(f) 'extensions install' never appears inside a runnable code fence"
    else
      ng "(f) 'extensions install' appears inside a runnable code fence — that reads as a recommendation, contradicting ruling 1's 'unmeasured'"
    fi

    if grep -q 'extensions install' "$doc" && ! grep -q 'unmeasured' "$doc"; then
      ng "(f) 'extensions install' is mentioned with no accompanying 'unmeasured' hedge anywhere in the doc"
    else
      ok "(f) every mention of 'extensions install' coexists with the required 'unmeasured' hedge"
    fi
  fi
}

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
