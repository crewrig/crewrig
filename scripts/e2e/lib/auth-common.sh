#!/usr/bin/env bash
# Shared helpers for the e2e auth scripts (issue #77).
#
# Source this file; it provides:
#   - e2e_die <msg>           : print to stderr and exit 1
#   - e2e_skip <msg>          : print to stderr and exit 78 (skip convention)
#   - e2e_info <msg>          : print to stderr (informational)
#   - e2e_require_docker      : fail loudly if `docker` is missing
#   - e2e_require_image <tag> : fail with a build-hint if the image is absent
#   - e2e_e2e_home            : echo the e2e root dir (honors $CREWRIG_E2E_HOME)
#   - e2e_cli_dir <cli>       : echo the per-CLI dir, mkdir -p before use
#   - e2e_chown_bootstrap <cli> <image>
#       : make the host dir writable by the container's agent user (uid 1000)
#         via `chmod a+rwx` on the host. Works on macOS VirtioFS where the
#         previous docker-based chown approach failed with "Permission denied".
#         The `image` parameter is accepted but no longer used.
#
# Conventions:
#   - All scripts that source this file are expected to run under
#     `set -euo pipefail`.
#   - "<cli>" is one of: claude | gemini | copilot.

# Bail loudly if accidentally sourced from a stale shell with leftover state.
set -o nounset

E2E_AGENT_UID="${E2E_AGENT_UID:-1000}"
E2E_AGENT_GID="${E2E_AGENT_GID:-1000}"

e2e_info() { printf '%s\n' "$*" >&2; }
e2e_die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
e2e_skip() { printf 'SKIP: %s\n' "$*" >&2; exit 78; }

e2e_require_docker() {
  command -v docker >/dev/null 2>&1 \
    || e2e_die "docker is required and was not found on \$PATH."
}

e2e_require_image() {
  local image="$1" build_hint="$2"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    e2e_die "image '$image' is not present locally. Build it first: $build_hint"
  fi
}

e2e_e2e_home() {
  # Allow override for CI / multi-user runners (Open risk #5 of ADR 0002).
  printf '%s\n' "${CREWRIG_E2E_HOME:-$HOME}/.crewrig-e2e"
}

e2e_cli_dir() {
  local cli="$1"
  printf '%s\n' "$(e2e_e2e_home)/${cli}"
}

# Universal writability bootstrap. Makes the bind-mount dir writable by the
# container's `agent` user (uid 1000) regardless of the host UID or the
# Docker Desktop filesystem backend (VirtioFS, gRPC-FUSE, osxfs).
#
# Previous approach: spawn a `docker run --user root` container to `chown` the
# dir inside the container. This broke on macOS Docker Desktop ≥ 4.x with
# VirtioFS: the container's root is remapped to the macOS user at the
# VirtioFS layer, so it cannot chown a directory to a different UID — even
# with --privileged.
#
# Current approach: `chmod a+rwx` on the host. The host user always owns the
# dir (created by `mkdir -p` just above); chmod is unconditionally permitted.
# The container's agent user (uid 1000) then has write access via the world-
# execute/write bits. Files written by the container retain uid 1000
# ownership, which scenario runs (also uid 1000) can read.
#
# The `image` parameter is retained for call-site compatibility; it is no
# longer used.
# TODO: rename to e2e_chmod_bootstrap after call sites adopt new name.
e2e_chown_bootstrap() {
  local cli="$1" image="$2"
  : "${image}"  # unused; kept for call-site compatibility — shellcheck SC2034
  local dir
  dir="$(e2e_cli_dir "$cli")"
  e2e_info "[$cli] Asserting writability on $dir (uid:${E2E_AGENT_UID} gid:${E2E_AGENT_GID})…"
  chmod a+rwx "${dir}" \
    || e2e_die "[$cli] writability bootstrap failed — cannot chmod ${dir}."
}

# e2e_gemini_refresh_access_token [creds_file] — return a usable Gemini OAuth
# access token. Reads access_token + expiry_date from oauth_creds.json (the
# shape the Gemini CLI itself writes: no client_id/client_secret embedded —
# those live in the CLI bundle). If the stored access_token still has more
# than 5 min of life, it is printed verbatim with no network call. Otherwise
# the refresh_token is exchanged at the Google token endpoint using the same
# OAuth client the Gemini CLI uses internally. Prints the access_token to
# stdout or calls e2e_die on failure. curl and jq are required on the host.
e2e_gemini_refresh_access_token() {
  local creds_file="${1:-$(e2e_cli_dir gemini)/oauth_creds.json}"
  [[ -f "$creds_file" ]] || e2e_die "[gemini] oauth_creds.json not found at ${creds_file}"
  local access_token expiry_date now_ms
  access_token=$(jq -r '.access_token // empty' "$creds_file")
  expiry_date=$(jq -r '.expiry_date  // 0'     "$creds_file")
  now_ms=$(( $(date +%s) * 1000 ))
  if [[ -n "$access_token" ]] && (( expiry_date - 300000 > now_ms )); then
    printf '%s' "$access_token"
    return 0
  fi
  command -v curl >/dev/null 2>&1 || e2e_die "[gemini] curl is required to refresh the OAuth access token"
  local refresh_token response
  refresh_token=$(jq -r '.refresh_token // empty' "$creds_file")
  [[ -n "$refresh_token" ]] \
    || e2e_die "[gemini] oauth_creds.json has no refresh_token — re-run: task e2e:auth:gemini"
  response=$(curl -s -X POST https://oauth2.googleapis.com/token \
    --data-urlencode "client_id=681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com" \
    --data-urlencode "client_secret=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" \
    --data-urlencode "refresh_token=${refresh_token}" \
    --data-urlencode "grant_type=refresh_token")
  access_token=$(printf '%s' "$response" | jq -r '.access_token // empty')
  [[ -n "$access_token" ]] \
    || e2e_die "[gemini] access token expired and refresh failed — re-run: task e2e:auth:gemini"
  printf '%s' "$access_token"
}

# e2e_auth_ready <cli> — return 0 if the CLI can be exercised non-interactively
# in an e2e run, 78 (SKIP convention) otherwise. Used by the runner to decide
# whether to invoke a (cli, scenario) pair or emit a TAP `# SKIP unconfigured`
# line. Echoes a one-line reason to stderr explaining which path matched.
#
# Decision tree:
#   claude   → on-disk marker (~/.crewrig-e2e/claude/.credentials.json),
#              else ANTHROPIC_API_KEY in the host shell.
#   gemini   → on-disk marker (~/.crewrig-e2e/gemini/oauth_creds.json),
#              else GEMINI_API_KEY in the host shell.
#   copilot  → COPILOT_GITHUB_TOKEN, then GH_TOKEN, then Ollama Cloud
#              keypair (~/.crewrig-e2e/ollama/id_ed25519, ADR 0002 Decision 8).
#
# The on-disk markers come from ADR 0002's auth-<cli>.sh post-flight
# assertions and were chosen as the load-bearing files in those scripts.
e2e_auth_ready() {
  local cli="$1"
  local dir
  dir="$(e2e_cli_dir "$cli")"
  case "$cli" in
    claude)
      if [[ -s "${dir}/.credentials.json" ]]; then
        e2e_info "[$cli] auth ready: on-disk marker ${dir}/.credentials.json"
        return 0
      fi
      if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        e2e_info "[$cli] auth ready: ANTHROPIC_API_KEY set in host shell"
        return 0
      fi
      e2e_info "[$cli] auth NOT ready: no marker file, no ANTHROPIC_API_KEY"
      return 78
      ;;
    gemini)
      if [[ -s "${dir}/oauth_creds.json" ]]; then
        e2e_info "[$cli] auth ready: on-disk marker ${dir}/oauth_creds.json"
        return 0
      fi
      if [[ -n "${GEMINI_API_KEY:-}" ]]; then
        e2e_info "[$cli] auth ready: GEMINI_API_KEY set in host shell"
        return 0
      fi
      e2e_info "[$cli] auth NOT ready: no marker file, no GEMINI_API_KEY"
      return 78
      ;;
    copilot)
      if [[ -n "${COPILOT_GITHUB_TOKEN:-}" ]]; then
        e2e_info "[$cli] auth ready: COPILOT_GITHUB_TOKEN set in host shell"
        return 0
      fi
      if [[ -n "${GH_TOKEN:-}" ]]; then
        e2e_info "[$cli] auth ready: GH_TOKEN set in host shell (fallback)"
        return 0
      fi
      # Ollama Cloud path (ADR 0002 Decision 8): no GitHub token needed when
      # Copilot is routed through Ollama Cloud — the Ed25519 keypair is the
      # credential. Accept if the keypair is present and non-empty.
      if [[ -s "$(e2e_cli_dir ollama)/id_ed25519" ]]; then
        e2e_info "[$cli] auth ready: Ollama Cloud keypair present ($(e2e_cli_dir ollama)/id_ed25519)"
        return 0
      fi
      e2e_info "[$cli] auth NOT ready: neither COPILOT_GITHUB_TOKEN nor GH_TOKEN set, and no Ollama Cloud keypair found"
      return 78
      ;;
    *)
      e2e_die "e2e_auth_ready: unknown CLI '$cli' (expected: claude|gemini|copilot)"
      ;;
  esac
}
