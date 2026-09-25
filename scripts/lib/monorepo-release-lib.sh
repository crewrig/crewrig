# shellcheck shell=bash
# monorepo-release-lib.sh — Forge-aware building blocks of the monorepo release
# driver (scripts/monorepo-release.sh), spec 0213 (+ delta-01), PLAN v2 step 2.
#
# Sourced, never executed. Bash 3.2 compatible (docs/scripting-conventions.md
# Rule 5): no associative arrays, no mapfile/readarray, every array expansion
# guarded against the empty case.
#
# The release engine is semantic-release on BOTH forges. What this file decides
# is which forge the run is on, whether it publishes or rehearses, which branch
# it releases from, which identity and credential the engine sees, and the
# generated `.releaserc.json`. That config is composed of three parts:
#
#   (a) the shared core — analyzer, changelog, exec prepareCmd, git. Identical
#       on both forges and semantically identical to the pre-spec heredoc
#       (golden: scripts/tests/fixtures/release/github-releaserc.golden.json);
#   (b) the forge notes leg — EMPTY on GitHub, so GitHub notes stay byte for
#       byte what they were (R21). On GitLab it overrides gitmoji's note
#       template, its commit partial and its issue-link template with links
#       built from CI_PROJECT_URL / CI_SERVER_URL (R20);
#   (c) the forge publish leg — @semantic-release/github or
#       @semantic-release/gitlab, present in publish mode only.
#
# Every refusal below exits 2 before any file is written or any engine call is
# made (R10), and names what it refused — a credential is only ever named,
# never printed (R11).

RELEASE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The environment-variable name rule for credentials. It is the release core's
# own masking rule (semantic-release lib/hide-sensitive.js:
# /token|password|credential|secret|private/i), plus CI_REPOSITORY_URL, which
# GitLab CI exports with the job token embedded (plan review v2-F2). The
# rehearsal strips every exported variable this rule matches, and
# scripts/lib/release-rehearse.mjs refuses to run when one is still present.
# Keep the two in lockstep.
release_is_credential_name() {
  local lc
  lc="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in
    *token*|*password*|*credential*|*secret*|*private*|ci_repository_url) return 0 ;;
  esac
  return 1
}

release_refuse() {
  echo "Error: $*" >&2
  exit 2
}

# release_detect_forge — sets RELEASE_FORGE to `github` or `gitlab`, or refuses
# naming what was detected (R10). Gitea Actions is tested first because its
# runner ALSO exports GITHUB_ACTIONS=true for action compatibility; checking
# GITHUB_ACTIONS first would silently treat a Gitea run as a GitHub one.
release_detect_forge() {
  if [ "${GITEA_ACTIONS:-}" = "true" ]; then
    release_refuse "unsupported release forge: gitea"
  fi
  if [ "${GITHUB_ACTIONS:-}" = "true" ] && [ "${GITLAB_CI:-}" = "true" ]; then
    release_refuse "unsupported release forge: ambiguous (github+gitlab)"
  fi
  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    RELEASE_FORGE=github
    return 0
  fi
  if [ "${GITLAB_CI:-}" = "true" ]; then
    RELEASE_FORGE=gitlab
    return 0
  fi
  if [ "${CI:-}" = "true" ]; then
    release_refuse "unsupported release forge: unknown CI"
  fi
  release_refuse "unsupported release forge: none (not a CI environment)"
}

# release_mode — sets RELEASE_MODE to `publish` or `rehearsal`.
# RELEASE_DRY_RUN is canonical; DRY_RUN is an accepted alias. Either one set to
# `true` selects the rehearsal, so `true` wins a conflict. Only `true`, `false`
# and empty are valid.
release_mode() {
  case "${RELEASE_DRY_RUN:-}" in
    true|false|"") ;;
    *) release_refuse "invalid RELEASE_DRY_RUN value (expected true, false or empty)" ;;
  esac
  case "${DRY_RUN:-}" in
    true|false|"") ;;
    *) release_refuse "invalid DRY_RUN value (expected true, false or empty)" ;;
  esac
  if [ "${RELEASE_DRY_RUN:-}" = "true" ] || [ "${DRY_RUN:-}" = "true" ]; then
    RELEASE_MODE=rehearsal
  else
    RELEASE_MODE=publish
  fi
}

# release_branch <forge> — sets RELEASE_BRANCH.
# github: the checked-out branch, as before this spec.
# gitlab: CI_COMMIT_BRANCH, which GitLab sets on branch pipelines only; a
# merge-request or tag pipeline (the checkout is detached, and the variable is
# empty) is refused (plan v1-F8, v2-F6c).
release_branch() {
  case "$1" in
    github)
      RELEASE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
      ;;
    gitlab)
      if [ "${CI_PIPELINE_SOURCE:-}" = "merge_request_event" ] || [ -z "${CI_COMMIT_BRANCH:-}" ]; then
        release_refuse "not a branch pipeline (merge-request or tag): run the release from a branch pipeline"
      fi
      RELEASE_BRANCH="$CI_COMMIT_BRANCH"
      ;;
  esac
}

# release_identity <forge> — the release commit's identity (R9).
# github: exactly the identity the workflow's former `Configure Git` step and
# step env set, unless the caller already set one. gitlab: nothing is set, so
# the release core falls back to its own `semantic-release-bot` identity
# (semantic-release index.js); adopters override it with the four GIT_* CI
# variables (R18).
release_identity() {
  if [ "$1" = "github" ]; then
    : "${GIT_AUTHOR_NAME:=github-actions[bot]}"
    : "${GIT_AUTHOR_EMAIL:=github-actions[bot]@users.noreply.github.com}"
    : "${GIT_COMMITTER_NAME:=github-actions[bot]}"
    : "${GIT_COMMITTER_EMAIL:=github-actions[bot]@users.noreply.github.com}"
    export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
  fi
}

# A token value is usable when it is non-empty and is not a literal `$NAME`
# left behind by a CI engine that did not expand an undefined variable.
release_token_usable() {
  case "$1" in
    ""|'$'*) return 1 ;;
  esac
  return 0
}

# release_credential <forge> — publish mode only. The credential crosses the
# two CI engines under the one reference env key RELEASE_TOKEN (plan v1-F1);
# the forge's own variable names win when they are already set.
release_credential() {
  case "$1" in
    github)
      if release_token_usable "${GITHUB_TOKEN:-}" || release_token_usable "${GH_TOKEN:-}"; then
        return 0
      fi
      if release_token_usable "${RELEASE_TOKEN:-}"; then
        GITHUB_TOKEN="$RELEASE_TOKEN"
        export GITHUB_TOKEN
        return 0
      fi
      release_refuse "no release credential: set GITHUB_TOKEN (or RELEASE_TOKEN)"
      ;;
    gitlab)
      if release_token_usable "${GITLAB_TOKEN:-}" || release_token_usable "${GL_TOKEN:-}"; then
        return 0
      fi
      if release_token_usable "${RELEASE_TOKEN:-}"; then
        GITLAB_TOKEN="$RELEASE_TOKEN"
        export GITLAB_TOKEN
        return 0
      fi
      release_refuse "no release credential: set the masked CI/CD variable GITLAB_TOKEN (or RELEASE_TOKEN)"
      ;;
  esac
}

# release_disable_credential_helpers — GitLab publish mode only (plan review
# v2-F5). GitLab Runner's FF_GIT_URLS_WITHOUT_TOKENS installs a git credential
# helper that answers with the job token (docs.gitlab.com/runner/configuration/
# feature-flags). The core's first push check targets the credential-free
# `$CI_PROJECT_URL.git`; with that helper present it could succeed as the JOB
# TOKEN on a project allowing job-token pushes, and the release commit and tag
# would then be pushed with the wrong credential. An empty `credential.helper`
# value resets the helper list (git-config(1)); the command-scope entry added
# through GIT_CONFIG_COUNT outranks every config file, and is appended after any
# entry the caller already declared. The push then authenticates with
# GITLAB_TOKEN only, through the URL the core builds from it.
release_disable_credential_helpers() {
  local n="${GIT_CONFIG_COUNT:-0}"
  case "$n" in
    ""|*[!0-9]*) n=0 ;;
  esac
  export "GIT_CONFIG_KEY_${n}=credential.helper"
  export "GIT_CONFIG_VALUE_${n}="
  GIT_CONFIG_COUNT=$((n + 1))
  export GIT_CONFIG_COUNT
}

# release_forge_url <forge> — the forge's own clone URL of this project,
# credential-free. It is the rehearsal's `repositoryUrl` on both forges and the
# GitLab publish `repositoryUrl`: the note generator derives owner, repository
# and host from it, so it must be the real URL, not the throwaway mirror.
release_forge_url() {
  case "$1" in
    github) printf '%s/%s.git' "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" ;;
    gitlab) printf '%s.git' "$CI_PROJECT_URL" ;;
  esac
}

# release_prepare_cmd <root> <ext> <out> <version> — the exec plugin's
# prepareCmd. With <root>=$ROOT_DIR and <version>='${nextRelease.version}' this
# is character for character the pre-spec heredoc's command: it syncs the two
# sibling manifests to the release version (lockstep, spec 0044), then packages
# the rendered installable tree through scripts/release-package-extension.sh,
# the ONE place the artifact's shape is decided (spec 0183 R17/R21/R22). The
# rehearsal passes its clone as <root> and a validated literal version, so it
# runs the clone's own packager (plan v1-F5).
release_prepare_cmd() {
  printf 'for m in package.json extension.json; do [ -f "$m" ] && jq --arg v "%s" '"'"'.version=$v'"'"' "$m" > "$m.tmp" && mv "$m.tmp" "$m"; done; bash %s/scripts/release-package-extension.sh %s --version %s --out %s' \
    "$4" "$1" "$2" "$4" "$3"
}

# emit_releaserc <forge> <mode> <ext> <root> <out> <branch> — writes the
# engine config to stdout, built with jq (never string-concatenated).
#
# LOCKSTEP ORDERING (spec 0044): @semantic-release/exec MUST precede
# @semantic-release/git in the plugin array. semantic-release runs each release
# step's plugins in array order, so exec.prepareCmd (which rewrites the two
# sibling manifests, then packages the release artifact from the rewritten
# tree) runs BEFORE git.prepare (which stages + commits the assets). If git ran
# first, the synced siblings would miss the release commit and re-introduce the
# divergence check-extension-manifest-version.sh forbids — and the package step
# would run against a tree not yet carrying its own release version. The
# `[skip ci]` token in the git `message` MUST be preserved: it is what stops the
# release commit from re-triggering the build pipeline (and the divergence
# guard) — do not drop it when editing this config.
#
# The gitmoji plugin is referenced through its ESM facade
# scripts/lib/release-notes/gitmoji-esm-shim.mjs (issue #1225):
# semantic-release-monorepo resolves wrapped steps with `import()`, which sees
# only `analyzeCommits` on the CommonJS package, so the bare package name left
# every note empty. As in #1225, the facade's absolute path is resolved from
# this library's own location (wrapStep imports the name verbatim), not from
# <root>, so a driver run against another checkout still finds it. Both legs
# and both modes use the facade, so the GitHub note R21 freezes is the one it
# renders; the rehearsal clone is at the same commit, so its facade is the same
# file.
#
# No `gemini-extension.json` arm in prepareCmd: it is a BUILD OUTPUT under the
# render-at-publication model (spec 0173 delta-01), never a committed sibling.
#
# Publish leg: github uploads the ONE archive under its historical label;
# gitlab uploads it to the generic package registry WITHOUT a label, so the
# uploaded file name is the archive's own basename <ext>-<version>.tar.gz
# (plan v1-F4). The path is a glob because the version-bearing file name is
# only known once nextRelease.version is computed.
emit_releaserc() {
  local forge="$1" mode="$2" ext="$3" root="$4" out="$5" branch="$6"
  local repo_url="" project_url="" server_url=""
  if [ "$forge" = "gitlab" ]; then
    project_url="$CI_PROJECT_URL"
    server_url="$CI_SERVER_URL"
    repo_url="$(release_forge_url gitlab)"
  elif [ "$mode" = "rehearsal" ]; then
    repo_url="$(release_forge_url github)"
  fi
  # shellcheck disable=SC2016  # ${nextRelease.version} is the engine's placeholder, not a shell expansion
  jq -n \
    --arg forge "$forge" \
    --arg mode "$mode" \
    --arg ext "$ext" \
    --arg out "$out" \
    --arg branch "$branch" \
    --arg gitmoji_plugin "$RELEASE_LIB_DIR/release-notes/gitmoji-esm-shim.mjs" \
    --arg prepare "$(release_prepare_cmd "$root" "$ext" "$out" '${nextRelease.version}')" \
    --arg repo "$repo_url" \
    --arg purl "$project_url" \
    --arg surl "$server_url" \
    --rawfile tpl "$RELEASE_LIB_DIR/release-notes/gitlab-template.hbs" \
    --rawfile ctpl "$RELEASE_LIB_DIR/release-notes/gitlab-commit-template.hbs" \
    '
    def with_project_url: split("@@PROJECT_URL@@") | join($purl);
    ({releaseRules: {
        major: [":boom:"],
        minor: [":sparkles:"],
        patch: [":bug:", ":ambulance:", ":lock:", ":zap:"]
      }}
      + (if $forge == "gitlab" then
          {releaseNotes: {
            template: ($tpl | with_project_url),
            partials: {commitTemplate: ($ctpl | with_project_url)},
            issueResolution: {template: ($surl + "/{owner}/{repo}/-/issues/{ref}")}
          }}
        else {} end)) as $gitmoji
    | (if $mode != "publish" then []
       elif $forge == "github" then
         [["@semantic-release/github", {assets: [
           {path: ($out + "/*.tar.gz"), label: ($ext + " (installable tree)")}
         ]}]]
       else
         [["@semantic-release/gitlab", {assets: [
           {path: ($out + "/*.tar.gz"), target: "generic_package", packageName: $ext}
         ]}]]
       end) as $publish
    | {
        extends: "semantic-release-monorepo",
        branches: [$branch],
        tagFormat: ($ext + "-v${version}"),
        plugins: (
          [[$gitmoji_plugin, $gitmoji],
           "@semantic-release/changelog",
           ["@semantic-release/exec", {prepareCmd: $prepare}]]
          + $publish
          + [["@semantic-release/git", {
               assets: ["package.json", "extension.json", "CHANGELOG.md"],
               message: ("🔖 " + $ext + "-v${nextRelease.version} [skip ci]\n\n${nextRelease.notes}")
             }]]
        )
      }
    + (if $repo != "" then {repositoryUrl: $repo} else {} end)
    '
}

# release_failed_step <log> — maps the engine log of a failed publish run to the
# step R14 names. The core logs `Failed step "<type>" of plugin "<name>"` for
# the failing plugin (semantic-release lib/plugins/normalize.js); the first one
# is the cause. The GitLab plugin's publish step is split by its own error text
# (lib/publish.js: the generic package upload vs the release API call).
release_failed_step() {
  local log="$1" line type plugin
  line="$(grep -m1 'Failed step "' "$log" || true)"
  if [ -z "$line" ]; then
    echo engine
    return 0
  fi
  type="$(printf '%s\n' "$line" | sed 's/.*Failed step "\([^"]*\)" of plugin "\([^"]*\)".*/\1/')"
  plugin="$(printf '%s\n' "$line" | sed 's/.*Failed step "\([^"]*\)" of plugin "\([^"]*\)".*/\2/')"
  case "$type|$plugin" in
    "prepare|@semantic-release/exec") echo package ;;
    "prepare|@semantic-release/git") echo commit ;;
    "publish|@semantic-release/gitlab")
      if grep -q 'GitLab generics package API' "$log"; then
        echo upload
      elif grep -q 'GitLab release API' "$log"; then
        echo release
      else
        echo engine
      fi
      ;;
    "publish|@semantic-release/github") echo release ;;
    verifyConditions\|*) echo verify ;;
    *) echo engine ;;
  esac
}

# release_created_tag <log> — the tag this engine run created, or nothing. The
# core logs `Created tag <tag>` once the tag exists locally, after every
# prepare step succeeded and before it is pushed (semantic-release index.js).
# Reading the run's own log, rather than diffing `git tag -l`, keeps a remote
# tag the core merely FETCHED during the run from being reported as created.
release_created_tag() {
  sed -n 's/.*Created tag \([^ ]*\).*/\1/p' "$1" | head -n 1
}

# release_sha256 <file> — hex digest, on GNU (sha256sum) or BSD/macOS (shasum).
release_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# release_is_semver <v> — strict SemVer 2.0.0 shape check for the version the
# rehearsal passes, as a literal, to the packager.
release_is_semver() {
  local re='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
  [[ "$1" =~ $re ]]
}

# release_strip_args — sets RELEASE_STRIP to the `env -u NAME` arguments that
# remove every exported credential variable (release_is_credential_name) from
# the rehearsal engine's environment. Defence in depth: the no-publication
# guarantee itself rests on the absent publish leg and the mirror redirect.
release_strip_args() {
  local name
  RELEASE_STRIP=()
  for name in $(compgen -e); do
    if release_is_credential_name "$name"; then
      RELEASE_STRIP+=(-u "$name")
    fi
  done
}
