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
#   copilot  → no on-disk creds (ADR 0002 Decision 4); precedence is
#              COPILOT_GITHUB_TOKEN, then GH_TOKEN.
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
      e2e_info "[$cli] auth NOT ready: neither COPILOT_GITHUB_TOKEN nor GH_TOKEN set"
      return 78
      ;;
    *)
      e2e_die "e2e_auth_ready: unknown CLI '$cli' (expected: claude|gemini|copilot)"
      ;;
  esac
}
