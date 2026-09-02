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
#   - e2e_ensure_bundle_dir <cli>
#       : mkdir -p the per-CLI bundle dir AND the e2e root, chmod 0700 both.
#         Makes a declared mount safe on a machine that never ran an auth
#         script (spec 0194 R5; see docker-mount-source-absent note below).
#   - e2e_assert_bundle_modes <cli>
#       : idempotent chmod 700 (dirs) / 600 (files) under the per-CLI bundle
#         dir. Returns non-zero if any path still deviates afterwards.
#
# Docker-mount-source-absent note (spec 0194 step 15): on this host (Docker
# server 29.5.3, macOS), `docker run -v <absent-host-path>:...` fails at the
# daemon with exit 126 ("chown ... permission denied") and leaves 0755
# directories behind. Calling e2e_ensure_bundle_dir BEFORE a scenario case
# (not just e2e_assert_bundle_modes after) is load-bearing, not
# belt-and-braces — see tests/e2e/run.sh.
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

# e2e_ensure_bundle_dir <cli> — mkdir -p the per-CLI bundle dir and the e2e
# root, chmod 0700 both, return non-zero if either still deviates (spec 0194
# R5). This is what makes a declared read-write mount (e.g. [cli.copilot]
# .mounts, tests/e2e/defaults.toml) safe on a machine that has never run the
# matching auth script — see tests/e2e/run.sh's ensure-before / assert-after
# bracket and the docker-mount-source-absent note above this function.
#
# Tightens the e2e ROOT to 0700 here too: it is `drwxr-xr-x` today on a
# workstation that only ever ran `mkdir -p` under the host umask (only the
# per-CLI $DIR gets chmod-ed by the auth scripts). R5 governs what is
# persisted UNDER the host directory, not the directory itself, so this is
# hygiene beyond R5 — done here because the helper already touches the path.
e2e_ensure_bundle_dir() {
  local cli="$1"
  local root dir
  root="$(e2e_e2e_home)"
  dir="$(e2e_cli_dir "$cli")"
  mkdir -p "$dir"
  chmod 700 "$root" "$dir"
  if [[ "$(stat -f '%Lp' "$root" 2>/dev/null || stat -c '%a' "$root")" != "700" ]]; then
    e2e_die "[$cli] e2e_ensure_bundle_dir: could not chmod 700 the e2e root ${root}."
  fi
  if [[ "$(stat -f '%Lp' "$dir" 2>/dev/null || stat -c '%a' "$dir")" != "700" ]]; then
    e2e_die "[$cli] e2e_ensure_bundle_dir: could not chmod 700 ${dir}."
  fi
}

# e2e_assert_bundle_modes <cli> — idempotent chmod 700 (directories) / 600
# (files) under the per-CLI bundle dir, returning non-zero if any path still
# deviates afterwards (spec 0194 R5: the mode invariant holds after a
# scenario run that writes into the bundle, not only after the command that
# establishes the credential). Replaces the four duplicated inline chmod
# triples in scripts/e2e/auth-{claude,gemini,copilot,ollama}.sh.
#
# Verified precondition: Docker Desktop on macOS, where uid remapping lands
# a container's writes back on the host owned by the host user (measured: a
# uid-1000 container created a subdirectory inside a 0700 host-owned bundle,
# and the host saw it `drwxr-xr-x` owned by the host user — chmod then
# corrects it). On native Linux there is no such remapping: a file a
# container writes lands as uid 1000, which a differently-uid'd host user
# cannot chmod. That case is UNVERIFIED — an assumption, not a measurement
# — so this function fails loudly (naming the ownership mismatch) rather
# than silently succeeding when a chmod does not stick.
e2e_assert_bundle_modes() {
  local cli="$1"
  local dir
  dir="$(e2e_cli_dir "$cli")"
  [[ -d "$dir" ]] || return 0

  find "$dir" -type d -exec chmod 700 {} +
  find "$dir" -type f -exec chmod 600 {} +

  local bad=""
  while IFS= read -r -d '' p; do
    local mode
    mode="$(stat -f '%Lp' "$p" 2>/dev/null || stat -c '%a' "$p")"
    if [[ -d "$p" && "$mode" != "700" ]] || [[ -f "$p" && "$mode" != "600" ]]; then
      bad="${bad}${p}(${mode}) "
    fi
  done < <(find "$dir" \( -type d -o -type f \) -print0)

  if [[ -n "$bad" ]]; then
    e2e_die "[$cli] e2e_assert_bundle_modes: mode invariant does not hold after chmod — ownership mismatch? offenders: ${bad}(this is expected-but-unverified on native Linux; see the function's header comment)"
  fi
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
#   copilot  → COPILOT_GITHUB_TOKEN, then GH_TOKEN, then the persisted
#              workstation credential (~/.crewrig-e2e/copilot/config.json,
#              spec 0194 R1-R2), then the Ollama Cloud keypair
#              (~/.crewrig-e2e/ollama/id_ed25519, ADR 0002 Decision 8).
#              The marker sits LAST in this precedence (D2): it mirrors the
#              precedence Copilot itself applies in-container
#              (COPILOT_GITHUB_TOKEN > GITHUB_TOKEN > GH_TOKEN > gh CLI, ADR
#              0002 Decision 4), so the reported path is the path the CLI
#              will actually use. A present-but-rejected credential still
#              reports ready (R2's second sentence) — this is a pure
#              presence test, never a token-validity check.
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
      # Workstation credential passthrough (spec 0194 R1-R2): the persisted
      # copy of the developer's own ~/.copilot/config.json, made by
      # scripts/e2e/auth-copilot.sh. Pure presence test — no docker run, no
      # token validation (R2's second sentence: an unusable credential
      # reports ready and fails inside the scenario, never as an
      # unconfigured pair).
      if [[ -s "${dir}/config.json" ]]; then
        e2e_info "[$cli] auth ready: workstation credential ${dir}/config.json"
        return 0
      fi
      # Ollama Cloud path (ADR 0002 Decision 8): no GitHub token needed when
      # Copilot is routed through Ollama Cloud — the Ed25519 keypair is the
      # credential. Accept if the keypair is present and non-empty.
      if [[ -s "$(e2e_cli_dir ollama)/id_ed25519" ]]; then
        e2e_info "[$cli] auth ready: Ollama Cloud keypair present ($(e2e_cli_dir ollama)/id_ed25519)"
        return 0
      fi
      e2e_info "[$cli] auth NOT ready: no credential found. Start 'copilot' and run '/login' (or \`task e2e:auth:copilot\` to copy the workstation credential into the bundle), or set COPILOT_GITHUB_TOKEN / GH_TOKEN."
      return 78
      ;;
    *)
      e2e_die "e2e_auth_ready: unknown CLI '$cli' (expected: claude|gemini|copilot)"
      ;;
  esac
}
