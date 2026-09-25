#!/bin/bash
# test-monorepo-release-engine.sh — Real-engine regression tests for the
# monorepo release driver (spec 0213 + delta-01, PLAN v2 step 11).
#
# Unlike test-monorepo-release.sh (hermetic, no engine, no network), this
# suite runs the REAL semantic-release engine (node_modules required) against
# a throwaway fixture repository, so it needs `npm install --include=dev` to
# have run first. It never touches the real repository tree: every fixture is
# built under a mktemp'd TMP_ROOT, and the real `origin` remote is a local
# bare repository — no network call ever leaves 127.0.0.1.
#
# KNOWN, DOCUMENTED FAILURES (issue #1225): every extension release note
# currently renders EMPTY on `main` (semantic-release-monorepo's ESM plugin
# wrapper cannot see CommonJS semantic-release-gitmoji's `generateNotes`
# step). Issue #1225 fixes this upstream of this branch; until it merges and
# this branch rebases, every assertion that depends on note CONTENT (entries,
# links) fails for that single, well-understood reason. Those assertions are
# marked `ng_1225` below instead of `ng`, and are counted separately so the
# summary line names them. They are written the way they will need to look
# once #1225 lands — weakening them to pass today would defeat their purpose
# as a regression guard.
#
# Fixture construction (mirrors the real repository just enough for the real
# engine to run for real):
#   - scripts/ is a full copy of the real scripts/ (minus scripts/tests, not
#     needed here), so scripts/release-package-extension.sh and
#     scripts/build-extension.sh run unmodified against the fixture's own
#     extensions/.
#   - extensions/core/{foo,bar,baz} are minimal but REAL Gemini extensions
#     (extension.json + package.json + CONTEXT.md — the base skeleton shape),
#     so `scripts/build-extension.sh --target gemini` and packaging succeed
#     for real, producing real archives with real sha256 digests.
#   - foo carries a baseline tag (foo-v1.2.0) and, after it, a feature commit
#     referencing an in-project issue (#12) and a cross-project issue
#     (other/lib#3), a docs-only commit (touches no extension), and a merge
#     commit — the R19/R20/v2-F4 fixture the plan specifies. bar carries a
#     baseline tag and NO commit after it (UNCHANGED). baz carries NO tag
#     (first release, R4 FIRST_RELEASE, no compare link on either forge).
#   - `origin` is a real local bare repository, addressed through a NEUTRAL
#     well-formed URL (never a bare filesystem path — gitmoji's
#     `git-url-parse` throws on one, see the header note on
#     `write_global_gitconfig`) redirected via GIT_CONFIG_GLOBAL `insteadOf`
#     to that bare repo. This is what lets 11b/11g's git operations succeed
#     with no network and no credential.
#
# Usage:
#   bash scripts/tests/test-monorepo-release-engine.sh
#
# -e is intentionally omitted: outcomes are asserted via explicit pass/fail
# counters, matching the sibling suites' idiom (e.g.
# scripts/tests/test-release-package-extension.sh).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FIXTURE_DIR="$SCRIPT_DIR/tests/fixtures/release"

if [ ! -f "$SCRIPT_DIR/monorepo-release.sh" ]; then
  echo "FATAL: cannot find $SCRIPT_DIR/monorepo-release.sh" >&2
  exit 2
fi
if [ ! -d "$REPO_DIR/node_modules/semantic-release" ]; then
  echo "FATAL: node_modules/semantic-release is not installed — run 'npm install --include=dev' first" >&2
  exit 2
fi

# --- A clean, deterministic PATH -------------------------------------------
# node is an asdf shim on this project's dev machines; `env -i` strips the
# HOME/ASDF_* variables the shim needs to resolve the real binary (asdf then
# fails with "$HOME is not defined", exit 126), so every clean invocation
# below uses the REAL install directory instead of the shim.
if command -v asdf >/dev/null 2>&1 && asdf which node >/dev/null 2>&1; then
  NODE_BIN_DIR="$(dirname "$(asdf which node)")"
else
  NODE_BIN_DIR="$(dirname "$(command -v node)")"
fi
CLEAN_PATH="$NODE_BIN_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

TMP_ROOT="$(mktemp -d)"
STUB_PID=""
cleanup() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" >/dev/null 2>&1
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

pass=0
fail=0
bug_1225_count=0

ok() { echo "PASS  $1"; pass=$((pass + 1)); }
ng() { echo "FAIL  $1"; fail=$((fail + 1)); }
# ng_1225 — a failure attributable ONLY to issue #1225 (empty release notes).
# Counted in `fail` (the assertion IS false today) and separately in
# `bug_1225_count`, so the final summary can name them without hiding them.
ng_1225() {
  echo "FAIL  $1 (KNOWN: issue #1225 — release notes render empty on main)"
  fail=$((fail + 1))
  bug_1225_count=$((bug_1225_count + 1))
}

# =============================================================================
# Fixture construction
# =============================================================================

# clean_git <home> <checkout> <args...> — every git call against a fixture
# checkout, with a fully-controlled environment: no ambient
# CI/GIT_CONFIG_*/credential variable, no real ~/.gitconfig (commit.gpgsign,
# credential helpers), no real SYSTEM gitconfig either (this machine's
# Homebrew git ships one at its own sysconfdir, outside /etc/gitconfig, so
# `env -i` alone does not shadow it — `git config --system --list` here
# reports `credential.helper=osxkeychain` even under a from-scratch HOME; a
# sibling suite's PR #1226 broke on a CI runner precisely because a fixture
# relied on config the AUTHOR's machine supplied ambiently — see the
# GIT_CONFIG_SYSTEM=/dev/null below), a resolvable `node`/`git`/`jq`/`tar`
# PATH. <home> is a required, explicit argument rather than a global — this
# function is often called through a `$(... | ...)` pipeline (make_fixture's
# own callers pipe its stdout through `tr`), and bash runs every non-last
# stage of a pipeline in a SUBSHELL, so a global assigned inside one call
# never survives to the next: an earlier draft of this suite relied on a
# global `$FAKE_HOME` here and it silently read as unset (masked by the
# deliberate absence of `-e` in this suite — see the file header), turning
# several before/after comparisons into vacuous
# empty-string-equals-empty-string passes. Taking <home> as a parameter
# removes the hazard structurally.
clean_git() {
  local home="$1" checkout="$2"
  shift 2
  env -i PATH="$CLEAN_PATH" HOME="$home" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git -C "$checkout" "$@"
}

# write_global_gitconfig <file> <origin-bare> [<extra-url> <extra-target>] —
# ALWAYS maps a NEUTRAL, well-formed placeholder URL (never a bare filesystem
# path: semantic-release-gitmoji's ReleaseNotes constructor runs the resolved
# repositoryUrl through git-url-parse, which throws "URL parsing failed" on a
# plain path — verified empirically) to the real bare `origin`, so
# `git ls-remote origin` and a config with no explicit `repositoryUrl` (test
# 11g) both resolve locally with no network. An optional second mapping
# (<extra-url> -> <extra-target>) is added ONLY for scenarios that need one —
# GitLab PUBLISH mode operates directly on the checkout with no clone-local
# insteadOf layer of its own, so it needs an EXTERNAL redirect for its real
# `repositoryUrl` (CI_PROJECT_URL.git). Rehearsal (either forge) must NOT get
# this extra mapping: it creates its OWN clone-local insteadOf for that exact
# same URL text, targeting a throwaway mirror — and this project's git
# (2.55) resolves two equal-length-prefix insteadOf rules by FIRST-DEFINED
# wins (empirically verified: a global rule beat a same-text local rule), so
# an inherited global rule for the forge URL would silently steal rehearsal's
# traffic away from its own mirror. Keeping the extra mapping scenario-scoped
# (never present during a rehearsal invocation) avoids the ambiguity instead
# of depending on undocumented precedence.
NEUTRAL_ORIGIN_URL="https://origin.fixture.invalid/acme/fixture.git"
write_global_gitconfig() {
  local file="$1" origin_bare="$2" extra_url="${3:-}" extra_target="${4:-}"
  {
    printf '[url "%s"]\n\tinsteadOf = %s\n' "$origin_bare" "$NEUTRAL_ORIGIN_URL"
    if [ -n "$extra_url" ]; then
      printf '[url "%s"]\n\tinsteadOf = %s\n' "$extra_target" "$extra_url"
    fi
  } > "$file"
}

# mkext <fixture-root> <name> <version> — a minimal but REAL Gemini extension
# (base-skeleton shape: extension.json + package.json + CONTEXT.md, no
# declared components), so build-extension.sh/release-package-extension.sh
# run unmodified and produce a real archive.
mkext() {
  local fix="$1" name="$2" version="$3"
  mkdir -p "$fix/extensions/core/$name"
  cat > "$fix/extensions/core/$name/extension.json" <<EOF
{
  "name": "$name",
  "version": "$version",
  "description": "fixture extension $name",
  "context": {"source": "CONTEXT.md"},
  "gemini": {"themes": []},
  "claude": {"author": {"name": "fixture"}, "defaultAllowedTools": ["Read"], "settings": {}, "lsp": {}, "bin": null}
}
EOF
  cat > "$fix/extensions/core/$name/package.json" <<EOF
{"name":"$name-extension","version":"$version"}
EOF
  echo "fixture context for $name" > "$fix/extensions/core/$name/CONTEXT.md"
}

# make_fixture — builds ONE fresh fixture (own TMP dir, own bare origin, own
# node_modules symlink) with the foo/bar/baz history the plan specifies.
# Echoes: "<fixture-dir> <origin-bare-dir>". Every case below builds its own
# fixture rather than sharing one, so a mutation in one case (e.g. a broken
# manifest for the package-failure case) can never leak into another.
make_fixture() {
  local root fix home origin_bare
  root="$(mktemp -d "$TMP_ROOT/fixture.XXXXXX")"
  fix="$root/repo"
  home="$root/home"
  mkdir -p "$fix" "$home"

  cp -R "$SCRIPT_DIR" "$fix/scripts"
  rm -rf "$fix/scripts/tests"
  printf 'node_modules/\ndist/\nbuild/\n' > "$fix/.gitignore"

  mkext "$fix" foo 1.2.0
  mkext "$fix" bar 0.4.1
  mkext "$fix" baz 0.0.0

  FAKE_HOME="$home"
  clean_git "$home" "$fix" init -q -b main
  clean_git "$home" "$fix" config user.name fixture
  clean_git "$home" "$fix" config user.email fixture@example.invalid
  clean_git "$home" "$fix" config commit.gpgsign false
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m "chore: init fixture"
  clean_git "$home" "$fix" tag foo-v1.2.0
  clean_git "$home" "$fix" tag bar-v0.4.1

  # foo: an in-project + a cross-project issue reference, a docs-only commit
  # (touches no extension -> excluded from foo's notes by the monorepo
  # path filter), then a merge commit (R19: neither should appear as an
  # entry once #1225 is fixed).
  echo "// feature 1" >> "$fix/extensions/core/foo/CONTEXT.md"
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m ":sparkles: add foo feature (#12)"

  mkdir -p "$fix/docs"
  echo "docs only" > "$fix/docs/NOTE.md"
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m ":memo: update docs"

  # v2-F4: a NESTED cross-project reference (acme/sub/other#5) — gitmoji's
  # default issue regex captures only the last two path segments, so this
  # resolves to the WRONG project on GitLab. The plan's named-edit choice for
  # this ticket is to document the limitation (not fix the regex), so both
  # forges must render NO link for it.
  echo "// feature 2" >> "$fix/extensions/core/foo/CONTEXT.md"
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m ":bug: fix foo bug (other/lib#3, acme/sub/other#5)"

  clean_git "$home" "$fix" checkout -q -b topic
  echo "// topic" >> "$fix/extensions/core/foo/CONTEXT.md"
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m ":sparkles: topic work"
  clean_git "$home" "$fix" checkout -q main
  clean_git "$home" "$fix" merge -q --no-ff -m "Merge branch 'topic'" topic

  # baz: one commit, no prior tag (R4 FIRST_RELEASE).
  echo "// baz feature" >> "$fix/extensions/core/baz/CONTEXT.md"
  clean_git "$home" "$fix" add -A
  clean_git "$home" "$fix" commit -q -m ":sparkles: baz first feature"

  # --initial-branch=main is NOT redundant with a hermetic env: without it,
  # a bare init's HEAD symref name falls back to init.defaultBranch (or the
  # compiled-in default), which existed only via THIS machine's global
  # gitconfig — a CI runner with no such default left HEAD dangling and
  # broke `git fetch` (sibling PR #1226). Pinned explicitly here regardless
  # of GIT_CONFIG_GLOBAL/SYSTEM being nulled below.
  origin_bare="$root/origin.git"
  env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    git init -q --bare --initial-branch=main "$origin_bare" >/dev/null

  local gitconfig
  gitconfig="$root/gitconfig-global"
  write_global_gitconfig "$gitconfig" "$origin_bare"
  clean_git "$home" "$fix" remote add origin "$NEUTRAL_ORIGIN_URL"
  env -i PATH="$CLEAN_PATH" HOME="$home" GIT_CONFIG_GLOBAL="$gitconfig" GIT_CONFIG_SYSTEM=/dev/null \
    git -C "$fix" push -q origin main --tags

  ln -s "$REPO_DIR/node_modules" "$fix/node_modules"

  printf '%s\n%s\n%s\n%s\n' "$fix" "$origin_bare" "$home" "$gitconfig"
}

GH_ENV=(GITHUB_ACTIONS=true GITHUB_ACTION=run GITHUB_EVENT_NAME=workflow_dispatch
        GITHUB_REF=refs/heads/main GITHUB_REPOSITORY=acme/fixture GITHUB_SERVER_URL=https://github.com)

CI_SERVER_URL="https://gitlab.example.test:8443"
CI_PROJECT_PATH="acme/sub/fixture"
CI_PROJECT_URL="$CI_SERVER_URL/$CI_PROJECT_PATH"
GITLAB_FORGE_URL="$CI_PROJECT_URL.git"

gl_env() {
  # gl_env [<api-url>] — the GitLab CI variable block; <api-url> is omitted
  # for rehearsal (no publish leg is ever loaded, so nothing calls the API).
  printf 'GITLAB_CI=true\nCI_COMMIT_REF_NAME=main\nCI_COMMIT_BRANCH=main\nCI_PIPELINE_SOURCE=push\n'
  printf 'CI_PROJECT_ID=7\nCI_PROJECT_PATH=%s\nCI_SERVER_URL=%s\nCI_PROJECT_URL=%s\n' \
    "$CI_PROJECT_PATH" "$CI_SERVER_URL" "$CI_PROJECT_URL"
  [ -n "${1:-}" ] && printf 'CI_API_V4_URL=%s\n' "$1"
}

# run_driver <fixture> <home> <gitconfig|-> <env-lines...> — runs the REAL
# top-level driver, fully clean env plus the given lines. Sets
# DRIVER_RC/DRIVER_OUT/DRIVER_ERR.
run_driver() {
  local fix="$1" home="$2" gitconfig="$3"
  shift 3
  local -a extra=()
  local line
  while IFS= read -r line; do
    [ -n "$line" ] && extra+=("$line")
  done <<< "$(printf '%s\n' "$@")"

  local out err
  out="$(mktemp "$TMP_ROOT/out.XXXXXX")"
  err="$(mktemp "$TMP_ROOT/err.XXXXXX")"
  # GIT_CONFIG_SYSTEM=/dev/null unconditionally: this machine's Homebrew git
  # ships its OWN system config (credential.helper=osxkeychain, outside
  # /etc/gitconfig) that `env -i` alone does not shadow. GIT_CONFIG_GLOBAL
  # defaults to /dev/null too when the caller has no insteadOf redirect of
  # its own to install (gitconfig == "-").
  extra+=("GIT_CONFIG_SYSTEM=/dev/null")
  if [ "$gitconfig" != "-" ]; then
    extra+=("GIT_CONFIG_GLOBAL=$gitconfig")
  else
    extra+=("GIT_CONFIG_GLOBAL=/dev/null")
  fi
  ( cd "$fix" && env -i PATH="$CLEAN_PATH" HOME="$home" "${extra[@]}" \
      bash "$fix/scripts/monorepo-release.sh" ) > "$out" 2> "$err"
  DRIVER_RC=$?
  DRIVER_OUT="$(cat "$out")"
  DRIVER_ERR="$(cat "$err")"
  rm -f "$out" "$err"
}

# extension_line <ext> — the driver's own REHEARSAL/PUBLISHED/UNCHANGED line
# for one extension, from the last captured DRIVER_OUT.
extension_line() {
  printf '%s\n' "$DRIVER_OUT" | grep -E "^(REHEARSAL|PUBLISHED|UNCHANGED|RELEASE-FAILED) $1 "
}

# =============================================================================
# 11a — Rehearsal correctness (R3/R4/R5/R6), both forges
# =============================================================================
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG <<< "$(make_fixture | tr '\n' ' ')"

  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "${GH_ENV[@]}" "RELEASE_DRY_RUN=true"
  gh_out="$DRIVER_OUT"

  if [ "$DRIVER_RC" -eq 0 ]; then
    ok "11a: GitHub rehearsal exits 0"
  else
    ng "11a: GitHub rehearsal exits 0 (rc=$DRIVER_RC): $DRIVER_ERR"
  fi

  foo_line="$(printf '%s\n' "$gh_out" | grep -E '^REHEARSAL foo ')"
  if printf '%s' "$foo_line" | grep -q 'version=1.3.0' \
     && printf '%s' "$foo_line" | grep -q 'tag=foo-v1.3.0' \
     && printf '%s' "$foo_line" | grep -q 'baseline=foo-v1.2.0'; then
    ok "11a: GitHub rehearsal computes foo 1.3.0 / foo-v1.3.0 / baseline foo-v1.2.0"
  else
    ng "11a: GitHub rehearsal foo line wrong: '$foo_line'"
  fi

  if printf '%s\n' "$gh_out" | grep -q 'UNCHANGED bar'; then
    ok "11a: GitHub rehearsal reports bar UNCHANGED"
  else
    ng "11a: GitHub rehearsal did not report bar UNCHANGED"
  fi

  baz_line="$(printf '%s\n' "$gh_out" | grep -E '^REHEARSAL baz ')"
  if printf '%s' "$baz_line" | grep -q 'version=1.0.0' \
     && printf '%s' "$baz_line" | grep -q 'tag=baz-v1.0.0' \
     && printf '%s' "$baz_line" | grep -q 'baseline=none'; then
    ok "11a: GitHub rehearsal computes baz 1.0.0 / baz-v1.0.0 / baseline none (FIRST_RELEASE)"
  else
    ng "11a: GitHub rehearsal baz line wrong: '$baz_line'"
  fi

  # The note text itself is printed on the lines right after the REHEARSAL
  # line, up to the next "--- Rehearsing" header. Extract it for foo.
  gh_notes="$(printf '%s\n' "$gh_out" | awk '/^REHEARSAL foo /{flag=1;next}/^--- Rehearsing:/{flag=0}flag')"
  if printf '%s' "$gh_notes" | grep -q '.'; then
    ok "11a: GitHub rehearsal note for foo is non-empty (#1225 fixed)"
  else
    ng_1225 "11a: GitHub rehearsal note for foo is non-empty"
  fi
  if printf '%s' "$gh_notes" | grep -qE 'https://github\.com/acme/fixture/commit/'; then
    ok "11a: GitHub note carries a commit link under acme/fixture"
  else
    ng_1225 "11a: GitHub note carries a commit link under acme/fixture"
  fi
  if printf '%s' "$gh_notes" | grep -qE 'compare/foo-v1\.2\.0\.\.\.foo-v1\.3\.0'; then
    ok "11a: GitHub note's heading links the compare range foo-v1.2.0...foo-v1.3.0"
  else
    ng_1225 "11a: GitHub note's heading links the compare range foo-v1.2.0...foo-v1.3.0"
  fi

  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "$(gl_env)" "RELEASE_DRY_RUN=true"
  gl_out="$DRIVER_OUT"

  if [ "$DRIVER_RC" -eq 0 ]; then
    ok "11a: GitLab rehearsal exits 0"
  else
    ng "11a: GitLab rehearsal exits 0 (rc=$DRIVER_RC): $DRIVER_ERR"
  fi

  foo_line_gl="$(printf '%s\n' "$gl_out" | grep -E '^REHEARSAL foo ')"
  if printf '%s' "$foo_line_gl" | grep -q 'version=1.3.0' \
     && printf '%s' "$foo_line_gl" | grep -q 'tag=foo-v1.3.0' \
     && printf '%s' "$foo_line_gl" | grep -q 'baseline=foo-v1.2.0'; then
    ok "11a: GitLab rehearsal computes foo 1.3.0 / foo-v1.3.0 / baseline foo-v1.2.0 (same as GitHub)"
  else
    ng "11a: GitLab rehearsal foo line wrong: '$foo_line_gl'"
  fi

  gl_notes="$(printf '%s\n' "$gl_out" | awk '/^REHEARSAL foo /{flag=1;next}/^--- Rehearsing:/{flag=0}flag')"
  if printf '%s' "$gl_notes" | grep -q '.'; then
    ok "11a: GitLab rehearsal note for foo is non-empty (#1225 fixed)"
  else
    ng_1225 "11a: GitLab rehearsal note for foo is non-empty"
  fi
  # Every link on GitLab must target the self-hosted host with its port, and
  # none may be protocol-relative or point at github.com (R20).
  gl_links="$(printf '%s' "$gl_notes" | grep -oE '\]\(([^)]+)\)' | sed -E 's/^\]\(//; s/\)$//'; \
              printf '%s' "$gl_notes" | grep -oE '<https?://[^>]+>' | sed -E 's/^<//; s/>$//')"
  if [ -z "$gl_links" ]; then
    ng_1225 "11a: GitLab note carries at least one link"
  else
    bad_links="$(printf '%s\n' "$gl_links" | grep -vE "^https://gitlab\.example\.test:8443/" || true)"
    if [ -z "$bad_links" ]; then
      ok "11a: every GitLab note link targets the self-hosted host:port"
    else
      ng "11a: a GitLab note link does not target the self-hosted host:port: $bad_links"
    fi
    if printf '%s\n' "$gl_links" | grep -q "^https://gitlab.example.test:8443/acme/sub/fixture/-/commit/"; then
      ok "11a: GitLab note carries a commit link under acme/sub/fixture"
    else
      ng_1225 "11a: GitLab note carries a commit link under acme/sub/fixture"
    fi
    if printf '%s\n' "$gl_links" | grep -q "^https://gitlab.example.test:8443/acme/sub/fixture/-/compare/foo-v1.2.0...foo-v1.3.0$"; then
      ok "11a: GitLab note's heading links the compare range"
    else
      ng_1225 "11a: GitLab note's heading links the compare range"
    fi
    if printf '%s\n' "$gl_links" | grep -q "^https://gitlab.example.test:8443/acme/sub/fixture/-/issues/12$"; then
      ok "11a: GitLab note links the in-project issue #12"
    else
      ng_1225 "11a: GitLab note links the in-project issue #12"
    fi
    if printf '%s\n' "$gl_links" | grep -q "^https://gitlab.example.test:8443/other/lib/-/issues/3$"; then
      ok "11a: GitLab note links the cross-project issue other/lib#3"
    else
      ng_1225 "11a: GitLab note links the cross-project issue other/lib#3"
    fi
  fi
  # v2-F4: the NESTED cross-project reference must get NO link on either
  # forge (gitmoji's issue regex only captures the last two path segments,
  # so it would otherwise resolve to the wrong GitLab project) — this holds
  # REGARDLESS of #1225, since "no link" is also true of an empty note.
  if ! printf '%s' "$gh_notes" | grep -q 'sub/other'; then
    ok "11a (v2-F4): GitHub note carries no link for the nested ref acme/sub/other#5"
  else
    ng "11a (v2-F4): GitHub note unexpectedly links the nested ref acme/sub/other#5: $gh_notes"
  fi
  if ! printf '%s' "$gl_notes" | grep -q 'sub/other'; then
    ok "11a (v2-F4): GitLab note carries no link for the nested ref acme/sub/other#5"
  else
    ng "11a (v2-F4): GitLab note unexpectedly links the nested ref acme/sub/other#5: $gl_notes"
  fi

  baz_line_gl="$(printf '%s\n' "$gl_out" | grep -E '^REHEARSAL baz ')"
  baz_notes_gl="$(printf '%s\n' "$gl_out" | awk '/^REHEARSAL baz /{flag=1;next}/^--- Rehearsing:|^$/{if(flag)flag=flag} flag' | head -5)"
  if printf '%s' "$baz_line_gl" | grep -q 'baseline=none'; then
    ok "11a: GitLab rehearsal also computes baz's baseline as none (FIRST_RELEASE)"
  else
    ng "11a: GitLab rehearsal baz baseline wrong: '$baz_line_gl'"
  fi
}

# =============================================================================
# 11b — R12/R13: the checkout, origin, and stub are left exactly as found;
# ambient credentials do not block rehearsal and never leak into output.
# =============================================================================
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG <<< "$(make_fixture | tr '\n' ' ')"

  refs_before="$(clean_git "$HOME_FIX" "$FIX" for-each-ref)"
  status_before="$(clean_git "$HOME_FIX" "$FIX" status --porcelain=v1 --ignored)"
  worktree_before="$(clean_git "$HOME_FIX" "$FIX" worktree list)"
  origin_refs_before="$(env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$ORIGIN_BARE" for-each-ref)"

  # Sentinel credentials in the OUTER env: rehearsal must need none of them,
  # and R11 says a credential is only ever named, never printed.
  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "${GH_ENV[@]}" "RELEASE_DRY_RUN=true" \
    "GITLAB_TOKEN=sentinel-outer-9f3a" "RELEASE_TOKEN=sentinel-outer-b271"

  if [ "$DRIVER_RC" -eq 0 ]; then
    ok "11b: rehearsal succeeds with sentinel credentials sitting unused in the outer env"
  else
    ng "11b: rehearsal failed with sentinel credentials present (rc=$DRIVER_RC): $DRIVER_ERR"
  fi
  if ! printf '%s\n%s' "$DRIVER_OUT" "$DRIVER_ERR" | grep -qE 'sentinel-outer-9f3a|sentinel-outer-b271'; then
    ok "11b: neither sentinel credential value appears anywhere in the run's output"
  else
    ng "11b: a sentinel credential value leaked into the run's output"
  fi

  refs_after="$(clean_git "$HOME_FIX" "$FIX" for-each-ref)"
  status_after="$(clean_git "$HOME_FIX" "$FIX" status --porcelain=v1 --ignored)"
  worktree_after="$(clean_git "$HOME_FIX" "$FIX" worktree list)"
  origin_refs_after="$(env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$ORIGIN_BARE" for-each-ref)"

  [ "$refs_before" = "$refs_after" ] && ok "11b: the checkout's refs are unchanged by rehearsal" \
    || ng "11b: the checkout's refs changed during rehearsal"
  [ "$status_before" = "$status_after" ] && ok "11b: the checkout's working tree/ignored files are unchanged by rehearsal" \
    || ng "11b: the checkout's working tree changed during rehearsal"
  [ "$worktree_before" = "$worktree_after" ] && ok "11b: 'git worktree list' is unchanged by rehearsal" \
    || ng "11b: a stray worktree survived rehearsal"
  [ "$origin_refs_before" = "$origin_refs_after" ] && ok "11b: origin's refs are unchanged by rehearsal" \
    || ng "11b: origin's refs changed during rehearsal"

  foo_line="$(extension_line foo)"
  if printf '%s' "$foo_line" | grep -qE 'sha256=[0-9a-f]{64}'; then
    ok "11b: the REHEARSAL line reports a sha256 digest for the built archive"
  else
    ng "11b: the REHEARSAL line carries no sha256: '$foo_line'"
  fi
}

# --- 11b (v2-F3): the mirror push must not run the checkout's pre-push hook -
# `git push ... "$r/mirror.git" ...` is a push FROM the checkout, so any
# pre-push hook the adopter installed (husky and similar, often installed by
# `npm install`) would otherwise run and could fail or mutate state — R13
# says the checkout is left exactly as found. The driver guards this with
# `--no-verify` (scripts/monorepo-release.sh, release_rehearse()). This case
# installs a REAL, firing pre-push hook and proves it never runs during
# rehearsal — added specifically because a mutation check (removing
# --no-verify) showed this guarantee had NO test coverage until now: none of
# the fixtures above install a hook, so that mutation was silent before this
# case existed.
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG <<< "$(make_fixture | tr '\n' ' ')"
  HOOK_MARKER="$TMP_ROOT/prepush-fired-marker"
  rm -f "$HOOK_MARKER"
  cat > "$FIX/.git/hooks/pre-push" <<EOF
#!/bin/bash
touch "$HOOK_MARKER"
exit 0
EOF
  chmod +x "$FIX/.git/hooks/pre-push"

  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "${GH_ENV[@]}" "RELEASE_DRY_RUN=true"

  if [ "$DRIVER_RC" -eq 0 ] && [ ! -e "$HOOK_MARKER" ]; then
    ok "11b (v2-F3): the mirror push does not run the checkout's pre-push hook"
  else
    ng "11b (v2-F3): the checkout's pre-push hook fired during rehearsal (rc=$DRIVER_RC, marker present=$([ -e "$HOOK_MARKER" ] && echo yes || echo no)) — the mirror push is missing --no-verify"
  fi
}

# =============================================================================
# 11c/11d/11e — GitLab PUBLISH against the forge stub (R7/R8/R9, R14)
# =============================================================================

start_stub() {
  local extra_env="${1:-}"
  STUB_PORT_FILE="$TMP_ROOT/stub.port"
  STUB_LOG="$TMP_ROOT/stub.$$_$RANDOM.jsonl"
  STUB_UPLOADS="$(mktemp -d "$TMP_ROOT/uploads.XXXXXX")"
  rm -f "$STUB_PORT_FILE"
  env -i PATH="$CLEAN_PATH" HOME="$TMP_ROOT" $extra_env \
    node "$FIXTURE_DIR/forge-stub.mjs" "$STUB_PORT_FILE" "$STUB_LOG" "$STUB_UPLOADS" \
    > "$TMP_ROOT/stub.out" 2> "$TMP_ROOT/stub.err" &
  STUB_PID=$!
  local i
  for i in $(seq 1 50); do
    [ -s "$STUB_PORT_FILE" ] && break
    sleep 0.1
  done
  STUB_PORT="$(cat "$STUB_PORT_FILE" 2>/dev/null)"
}

stop_stub() {
  [ -n "$STUB_PID" ] && kill "$STUB_PID" >/dev/null 2>&1
  wait "$STUB_PID" 2>/dev/null
  STUB_PID=""
}

# --- 11c: happy path -------------------------------------------------------
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG_BASE <<< "$(make_fixture | tr '\n' ' ')"
  GITCONFIG="$TMP_ROOT/gitconfig-11c"
  write_global_gitconfig "$GITCONFIG" "$ORIGIN_BARE" "$GITLAB_FORGE_URL" "$ORIGIN_BARE"

  start_stub
  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "$(gl_env "http://127.0.0.1:$STUB_PORT/api/v4")" \
    "GITLAB_TOKEN=sentinel-glpat-9c21"

  if [ "$DRIVER_RC" -eq 0 ]; then
    ok "11c: GitLab publish exits 0"
  else
    ng "11c: GitLab publish exits 0 (rc=$DRIVER_RC): $DRIVER_ERR"
  fi
  if printf '%s\n' "$DRIVER_OUT" | grep -qE 'PUBLISHED foo tag=foo-v1\.3\.0 archive=foo-1\.3\.0\.tar\.gz sha256=[0-9a-f]{64}'; then
    ok "11c: PUBLISHED line names foo, foo-v1.3.0 and its archive+sha256"
  else
    ng "11c: no matching PUBLISHED line for foo: $DRIVER_OUT"
  fi
  if printf '%s\n' "$DRIVER_OUT" | grep -q 'UNCHANGED bar'; then
    ok "11c: bar is reported UNCHANGED (nothing published for it)"
  else
    ng "11c: bar was not reported UNCHANGED"
  fi
  if ! printf '%s\n%s' "$DRIVER_OUT" "$DRIVER_ERR" | grep -q 'sentinel-glpat-9c21'; then
    ok "11c: the GitLab token value never appears in the run's output (R11)"
  else
    ng "11c: the GitLab token value leaked into the run's output"
  fi

  # baz has no baseline tag, so it ALSO gets a real first release in this
  # same publish run (R4 FIRST_RELEASE) — every log assertion below is
  # scoped to foo specifically so baz's legitimate, parallel PUT/POST does
  # not read as a duplicate.
  put_count="$(grep '"method":"PUT"' "$STUB_LOG" 2>/dev/null | grep -c '"pkg":"foo"' || echo 0)"
  put_line="$(grep '"method":"PUT"' "$STUB_LOG" 2>/dev/null | grep '"pkg":"foo"')"
  if [ "$put_count" -eq 1 ] && printf '%s' "$put_line" | grep -q '"pkg":"foo","version":"1.3.0","label":"foo-1.3.0.tar.gz"'; then
    ok "11c (R8): exactly one PUT to the generic package endpoint, foo/1.3.0/foo-1.3.0.tar.gz"
  else
    ng "11c (R8): expected exactly one matching PUT, got $put_count: $put_line"
  fi

  release_count="$(grep '"tag_name"' "$STUB_LOG" 2>/dev/null | grep -c '"tag_name":"foo-v1.3.0"' || echo 0)"
  release_line="$(grep '"tag_name":"foo-v1.3.0"' "$STUB_LOG" 2>/dev/null | head -1)"
  if [ "$release_count" -eq 1 ] && printf '%s' "$release_line" | grep -q '"tag_name":"foo-v1.3.0"'; then
    ok "11c (R9): exactly one POST .../releases with tag_name=foo-v1.3.0"
  else
    ng "11c (R9): expected exactly one release POST for foo-v1.3.0, got: $release_line"
  fi
  links_len="$(printf '%s' "$release_line" | jq '.body.assets.links | length' 2>/dev/null)"
  link_url="$(printf '%s' "$release_line" | jq -r '.body.assets.links[0].url' 2>/dev/null)"
  if [ "$links_len" = "1" ] && printf '%s' "$link_url" | grep -qE '/packages/generic/foo/1\.3\.0/foo-1\.3\.0\.tar\.gz$'; then
    ok "11c (R9): the release's assets.links has exactly one entry, pointing at the uploaded package"
  else
    ng "11c (R9): assets.links is not the expected single package link (len=$links_len url=$link_url)"
  fi
  description="$(printf '%s' "$release_line" | jq -r '.body.description' 2>/dev/null)"
  if [ "$description" = "foo-v1.3.0" ]; then
    ng_1225 "11c (R9): the release description carries the real release note (falls back to the bare tag when the note is empty)"
  else
    ok "11c (R9): the release description carries the real release note: $description"
  fi

  if ! grep -q '"pkg":"bar"' "$STUB_LOG" 2>/dev/null; then
    ok "11c: nothing was uploaded for bar"
  else
    ng "11c: bar was unexpectedly uploaded"
  fi

  origin_tags="$(env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$ORIGIN_BARE" tag -l)"
  if printf '%s\n' "$origin_tags" | grep -q 'foo-v1.3.0'; then
    ok "11c: origin carries the new tag foo-v1.3.0"
  else
    ng "11c: origin does not carry foo-v1.3.0. Tags: $origin_tags"
  fi
  origin_subject="$(env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$ORIGIN_BARE" log -1 --format=%s main)"
  if [ "$origin_subject" = "🔖 foo-v1.3.0 [skip ci]" ]; then
    ok "11c: origin's main HEAD is the release commit"
  else
    ng "11c: origin's main HEAD subject is unexpected: '$origin_subject'"
  fi

  # R7 (v1-F6): the sha256 of the uploaded body equals the PUBLISHED line's
  # sha256, and the uploaded archive is byte-identical to a FRESH, independent
  # render at the release commit (Case 5 pattern from
  # test-release-package-extension.sh), never by re-packaging and diffing
  # sha256 alone.
  published_sha="$(printf '%s\n' "$DRIVER_OUT" | grep -E '^PUBLISHED foo ' | sed -E 's/.*sha256=([0-9a-f]+)$/\1/')"
  uploaded_file="$(find "$STUB_UPLOADS" -maxdepth 1 -type f -name 'foo-1.3.0-*' | head -1)"
  if [ -n "$uploaded_file" ]; then
    uploaded_sha="$(shasum -a 256 "$uploaded_file" | awk '{print $1}')"
    if [ "$uploaded_sha" = "$published_sha" ]; then
      ok "11c (R7): the uploaded body's sha256 equals the PUBLISHED line's sha256"
    else
      ng "11c (R7): sha256 mismatch — uploaded=$uploaded_sha published=$published_sha"
    fi

    # NEW FINDING (not #1225, not routed to this ticket — reported, not
    # fixed, per the tester's remit): the driver writes `.releaserc.json`
    # directly into the extension's own source directory
    # (extensions/<tier>/<name>/.releaserc.json) and removes it only AFTER
    # `npx semantic-release` returns. But `@semantic-release/exec`'s
    # prepareCmd — which calls build-extension.sh and then packages the
    # result — runs mid-flight, WHILE that file still sits there, and
    # render_gemini's `cp -a "$ext_dir"/. "$build_dir"/` copies it verbatim
    # into the build tree (it names no member of
    # scripts/lib/extension-generated-class.json, so nothing strips it back
    # out). The archive this test just uploaded is expected to carry it —
    # this assertion pins that as a real, currently-shipping asset-shape
    # defect (spec 0183 R17/R18's exact-tree guarantee), not a byproduct of
    # this fixture.
    if tar -tzf "$uploaded_file" | grep -qE '^(\./)?\.releaserc\.json$'; then
      ng "11c (R17/R18, NEW FINDING — not #1225): the published archive carries a stray .releaserc.json (see this block's comment for the mechanism)"
    else
      ok "11c (R17/R18): the published archive carries no stray .releaserc.json"
    fi

    FRESH_OUT="$TMP_ROOT/fresh-render-11c"
    fresh_render_log="$(cd "$FIX" && env -i PATH="$CLEAN_PATH" HOME="$HOME_FIX" \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
      bash scripts/release-package-extension.sh foo --version 1.3.0 --out "$FRESH_OUT" 2>&1)"
    fresh_archive="$FRESH_OUT/foo-1.3.0.tar.gz"
    if [ -f "$fresh_archive" ]; then
      EXTRACT_DIR="$TMP_ROOT/extract-11c"
      mkdir -p "$EXTRACT_DIR"
      tar -xzf "$uploaded_file" -C "$EXTRACT_DIR"
      FRESH_EXTRACT="$TMP_ROOT/fresh-extract-11c"
      mkdir -p "$FRESH_EXTRACT"
      tar -xzf "$fresh_archive" -C "$FRESH_EXTRACT"
      if diff -rq "$EXTRACT_DIR" "$FRESH_EXTRACT" > "$TMP_ROOT/r7-diff.txt" 2>&1; then
        ok "11c (R7): the uploaded archive, extracted, is byte-identical to a fresh independent render"
      else
        ng "11c (R7): the uploaded archive diverges from a fresh render: $(cat "$TMP_ROOT/r7-diff.txt")"
      fi
    else
      ng "11c (R7): the fresh independent render did not produce an archive: $fresh_render_log"
    fi
  else
    ng "11c (R7): no uploaded file found under $STUB_UPLOADS to compare"
  fi

  stop_stub
}

# --- 11d: R14, upload failure ----------------------------------------------
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG_BASE <<< "$(make_fixture | tr '\n' ' ')"
  GITCONFIG="$TMP_ROOT/gitconfig-11d"
  write_global_gitconfig "$GITCONFIG" "$ORIGIN_BARE" "$GITLAB_FORGE_URL" "$ORIGIN_BARE"

  start_stub "FAIL_UPLOAD=1"
  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "$(gl_env "http://127.0.0.1:$STUB_PORT/api/v4")" \
    "GITLAB_TOKEN=sentinel-glpat-9c21"

  if [ "$DRIVER_RC" -ne 0 ]; then
    ok "11d: a forced upload failure makes the driver exit non-zero"
  else
    ng "11d: the driver exited 0 despite a forced upload failure"
  fi
  if printf '%s\n' "$DRIVER_OUT" | grep -q 'RELEASE-FAILED foo step=upload'; then
    ok "11d (R14): classified as step=upload"
  else
    ng "11d (R14): expected 'RELEASE-FAILED foo step=upload': $DRIVER_OUT"
  fi
  if printf '%s\n' "$DRIVER_OUT" | grep -q 'RELEASE-INCOMPLETE-TAG foo-v1.3.0'; then
    ok "11d (R14): reports the incomplete tag foo-v1.3.0 (the tag exists, the release does not)"
  else
    ng "11d (R14): expected 'RELEASE-INCOMPLETE-TAG foo-v1.3.0': $DRIVER_OUT"
  fi
  if ! grep -q '"tag_name"' "$STUB_LOG" 2>/dev/null; then
    ok "11d: no POST .../releases was ever made after the upload failed"
  else
    ng "11d: a release POST happened despite the upload failing"
  fi
  # baz also fails its own (independent) upload in this same run — scope to
  # foo, matching the R8 scoping note in the 11c block above.
  put_count_11d="$(grep '"method":"PUT"' "$STUB_LOG" 2>/dev/null | grep -c '"pkg":"foo"' || echo 0)"
  if [ "$put_count_11d" -eq 1 ]; then
    ok "11d: the failing upload for foo was attempted exactly once (403 is not retried)"
  else
    ng "11d: expected exactly one PUT attempt for foo, got $put_count_11d"
  fi

  stop_stub
}

# --- 11e: R14, package failure ----------------------------------------------
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG_BASE <<< "$(make_fixture | tr '\n' ' ')"
  GITCONFIG="$TMP_ROOT/gitconfig-11e"
  write_global_gitconfig "$GITCONFIG" "$ORIGIN_BARE" "$GITLAB_FORGE_URL" "$ORIGIN_BARE"

  # Break foo's manifest so packaging refuses outright (retired 'components'
  # shape — the same failure ext_assert_current_shape enforces for
  # release-package-extension.sh Case 6-style scenarios), which fails the
  # @semantic-release/exec "prepare" step BEFORE @semantic-release/git ever
  # runs (LOCKSTEP ORDERING) — so no tag or commit should exist afterward.
  broken_manifest="$FIX/extensions/core/foo/extension.json"
  jq '. + {"components": {}}' "$broken_manifest" > "$broken_manifest.tmp"
  mv "$broken_manifest.tmp" "$broken_manifest"
  clean_git "$HOME_FIX" "$FIX" add -A
  clean_git "$HOME_FIX" "$FIX" commit -q -m ":bug: break foo's manifest (test fixture)"
  # NOTE: "origin" the named remote is never touched by the driver's PUBLISH
  # path (only release_rehearse() reads it) — the engine's real git traffic
  # targets CI_PROJECT_URL directly, redirected by GITCONFIG below. Origin is
  # left at its initial-push state on purpose; the assertions below only
  # check for the ABSENCE of a new tag, which holds regardless.

  start_stub
  run_driver "$FIX" "$HOME_FIX" "$GITCONFIG" "$(gl_env "http://127.0.0.1:$STUB_PORT/api/v4")" \
    "GITLAB_TOKEN=sentinel-glpat-9c21"

  if [ "$DRIVER_RC" -ne 0 ]; then
    ok "11e: a broken manifest makes the driver exit non-zero"
  else
    ng "11e: the driver exited 0 despite a broken manifest"
  fi
  if printf '%s\n' "$DRIVER_OUT" | grep -q 'RELEASE-FAILED foo step=package'; then
    ok "11e (R14): classified as step=package"
  else
    ng "11e (R14): expected 'RELEASE-FAILED foo step=package': $DRIVER_OUT"
  fi
  origin_tags_11e="$(env -i PATH="$CLEAN_PATH" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null git -C "$ORIGIN_BARE" tag -l)"
  if ! printf '%s\n' "$origin_tags_11e" | grep -q 'foo-v1.3.0'; then
    ok "11e: no foo-v1.3.0 tag was created in origin"
  else
    ng "11e: a foo-v1.3.0 tag was created in origin despite the package step failing"
  fi
  if ! clean_git "$HOME_FIX" "$FIX" tag -l | grep -q 'foo-v1.3.0'; then
    ok "11e: no foo-v1.3.0 tag was created locally"
  else
    ng "11e: a foo-v1.3.0 tag was created locally despite the package step failing"
  fi
  # baz has no baseline tag, so it independently publishes for real in this
  # same run — scope the "never called" check to foo specifically.
  if ! grep -q '"pkg":"foo"' "$STUB_LOG" 2>/dev/null; then
    ok "11e: the GitLab API was never called for foo (the failure happens before publish)"
  else
    ng "11e: the GitLab API was unexpectedly called for foo: $(grep '"pkg":"foo"' "$STUB_LOG" 2>/dev/null)"
  fi

  stop_stub
}

# =============================================================================
# 11f — Template drift: the vendored GitLab templates, with their documented
# substitutions mapped BACK, equal the installed gitmoji originals. An engine
# upgrade that changes either template fails here, not silently at runtime.
# =============================================================================
{
  GITMOJI_TEMPLATES="$REPO_DIR/node_modules/semantic-release-gitmoji/lib/assets/templates"
  VENDORED="$SCRIPT_DIR/lib/release-notes"

  if [ -f "$GITMOJI_TEMPLATES/commit-template.hbs" ]; then
    reversed_commit="$(sed 's#@@PROJECT_URL@@/-/commit/#https://github.com/{{owner}}/{{repo}}/commit/#g' \
      "$VENDORED/gitlab-commit-template.hbs")"
    if [ "$reversed_commit" = "$(cat "$GITMOJI_TEMPLATES/commit-template.hbs")" ]; then
      ok "11f: gitlab-commit-template.hbs, substitution reversed, equals the installed gitmoji original"
    else
      ng "11f: gitlab-commit-template.hbs has drifted from the installed gitmoji commit-template.hbs"
    fi
  else
    ng "11f: cannot find the installed gitmoji commit-template.hbs to diff against"
  fi

  if [ -f "$GITMOJI_TEMPLATES/default-template.hbs" ]; then
    # NOTE: delimiter is `|`, not `#` — the hbs syntax itself contains `#`
    # (`{{#if ...}}`), which would collide with a `#`-delimited sed
    # substitution in both the pattern AND the replacement.
    reversed_default="$(sed \
      -e 's|{{#if lastRelease\.gitTag}}|{{#if compareUrl}}|' \
      -e 's|(@@PROJECT_URL@@/-/compare/{{lastRelease\.gitTag}}\.\.\.{{nextRelease\.gitTag}})|({{compareUrl}})|' \
      "$VENDORED/gitlab-template.hbs")"
    if [ "$reversed_default" = "$(cat "$GITMOJI_TEMPLATES/default-template.hbs")" ]; then
      ok "11f: gitlab-template.hbs, substitutions reversed, equals the installed gitmoji original"
    else
      ng "11f: gitlab-template.hbs has drifted from the installed gitmoji default-template.hbs"
    fi
  else
    ng "11f: cannot find the installed gitmoji default-template.hbs to diff against"
  fi
}

# =============================================================================
# 11g — R21: two GitHub dry-run renders of foo's note, at a fixed date, from
# (i) the golden main-heredoc config and (ii) emit_releaserc github publish —
# both with the publish leg removed — must be byte-identical.
#
# NOTE (surprising, verified): this assertion passes even TODAY, despite
# issue #1225 — both renders produce the SAME empty note, so they are
# trivially byte-identical. That is a property of the bug (it is
# config-independent), not evidence that #1225 is fixed. Flagged for the
# team in the session report; not weakened here.
# =============================================================================
{
  read -r FIX ORIGIN_BARE HOME_FIX GITCONFIG_BASE <<< "$(make_fixture | tr '\n' ' ')"
  # This scenario relies on ORIGIN'S OWN url (no explicit repositoryUrl in
  # either config), so the base fixture's neutral-origin-only gitconfig is
  # exactly what's needed — no forge-url mapping.

  # shellcheck source=lib/monorepo-release-lib.sh
  . "$SCRIPT_DIR/lib/monorepo-release-lib.sh"

  golden_i="$TMP_ROOT/golden-11g.json"
  jq --arg root "$FIX" '
    walk(if type == "string" then gsub("/ROOT"; $root) else . end)
    | .plugins |= map(select(type != "array" or .[0] != "@semantic-release/github"))
  ' "$FIXTURE_DIR/github-releaserc.golden.json" > "$golden_i"

  config_ii="$TMP_ROOT/config-ii-11g.json"
  emit_releaserc github publish foo "$FIX" "$FIX/dist/release/foo" main | jq '
    .plugins |= map(select(type != "array" or .[0] != "@semantic-release/github"))
  ' > "$config_ii"

  render_notes() {
    local config="$1"
    cp "$config" "$FIX/extensions/core/foo/.releaserc.json"
    ( cd "$FIX/extensions/core/foo" && \
      env -i PATH="$CLEAN_PATH" HOME="$HOME_FIX" \
        GIT_CONFIG_GLOBAL="$GITCONFIG_BASE" GIT_CONFIG_SYSTEM=/dev/null "${GH_ENV[@]}" \
        NODE_OPTIONS="--require $FIXTURE_DIR/fixed-date.cjs" \
        node "$REPO_DIR/scripts/lib/release-rehearse.mjs" main )
    rm -f "$FIX/extensions/core/foo/.releaserc.json"
  }

  result_i="$(render_notes "$golden_i" 2>"$TMP_ROOT/11g-i.err")"
  rc_i=$?
  result_ii="$(render_notes "$config_ii" 2>"$TMP_ROOT/11g-ii.err")"
  rc_ii=$?

  if [ "$rc_i" -eq 0 ] && [ "$rc_ii" -eq 0 ]; then
    ok "11g: both fixed-date dry-run renders succeed"
    notes_i="$(printf '%s' "$result_i" | jq -r '.notes')"
    notes_ii="$(printf '%s' "$result_ii" | jq -r '.notes')"
    if [ "$notes_i" = "$notes_ii" ]; then
      ok "11g (R21): the two GitHub note renders are byte-identical at a fixed date"
    else
      ng "11g (R21): the two GitHub note renders differ: '$notes_i' vs '$notes_ii'"
    fi
  else
    ng "11g: a fixed-date dry-run render failed (rc_i=$rc_i rc_ii=$rc_ii): $(cat "$TMP_ROOT/11g-i.err" "$TMP_ROOT/11g-ii.err")"
  fi
}

echo ""
echo "Results: $pass passed, $fail failed ($bug_1225_count attributable to issue #1225)"
[ "$fail" -eq "$bug_1225_count" ]
