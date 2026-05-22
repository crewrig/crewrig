#!/bin/bash
# test-e2e-docker-images.sh — Regression test for the e2e Docker images.
#
# Locks the runtime contract documented in docs/adr/0001-e2e-docker-images.md:
#
#   - non-root agent user (uid/gid 1000)
#   - WORKDIR /home/agent/workspace
#   - base image pre-creates the mount points for ~/.claude, ~/.gemini,
#     ~/.copilot, ~/.mempalace, owned by `agent`
#   - per-CLI CLI binaries are on PATH and exit 0 on --version
#   - base PATH carries /usr/sbin and /sbin (needed for groupadd/useradd-era
#     diagnostics inside scripts that escalate to root for setup)
#   - compressed image weight stays within the ADR budget
#     (base ≤500 MB, per-CLI ≤800 MB) — gated behind E2E_DOCKER_TESTS_FULL=1
#     since `docker save | gzip` is slow.
#
# Image-dependent assertions SKIP cleanly when the image is not built locally,
# so the suite stays green on machines that have not run `task e2e:build`.
#
# Usage:
#   bash scripts/tests/test-e2e-docker-images.sh
#   E2E_DOCKER_TESTS_FULL=1 bash scripts/tests/test-e2e-docker-images.sh

# -e is intentionally omitted: we rely on explicit pass/fail counters and want
# to keep going past expected non-zero exit codes (e.g. probing absent images).
set -uo pipefail

PASS=0
FAIL=0
SKIP=0

note_pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
note_fail() { echo "FAIL  $1 — $2"; FAIL=$((FAIL + 1)); }
note_skip() { echo "SKIP  $1 — $2"; SKIP=$((SKIP + 1)); }

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not installed; nothing to assert."
  exit 0
fi

image_exists() {
  docker image inspect "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# Per-image contract assertions
# ---------------------------------------------------------------------------
# Pairs of (image, cli_command_for_version_probe). The base image has no CLI
# of its own — its version probe slot is the empty string.
IMAGES=(
  "crewrig/e2e-base:latest|"
  "crewrig/e2e-claude:latest|claude"
  "crewrig/e2e-gemini:latest|gemini"
  "crewrig/e2e-copilot:latest|copilot"
  "crewrig/e2e-mempalace:latest|mempalace"
)

for entry in "${IMAGES[@]}"; do
  img="${entry%%|*}"
  cli="${entry##*|}"
  short="${img#crewrig/e2e-}"
  short="${short%:latest}"

  if ! image_exists "$img"; then
    note_skip "$img — image not built locally" "run \`task e2e:build\` to materialise"
    continue
  fi
  note_pass "$img — image present"

  # --- Non-root user --------------------------------------------------------
  id_out="$(docker run --rm --entrypoint id "$img" 2>/dev/null || true)"
  if [[ "$id_out" == *"uid=1000(agent)"* && "$id_out" == *"gid=1000(agent)"* ]]; then
    note_pass "$img — runs as agent (uid=1000, gid=1000)"
  else
    note_fail "$img — non-root user" "got: $id_out"
  fi

  # --- WORKDIR --------------------------------------------------------------
  pwd_out="$(docker run --rm --entrypoint pwd "$img" 2>/dev/null || true)"
  if [[ "$pwd_out" == "/home/agent/workspace" ]]; then
    note_pass "$img — WORKDIR is /home/agent/workspace"
  else
    note_fail "$img — WORKDIR" "got: $pwd_out"
  fi

  # --- PATH carries /usr/sbin and /sbin -------------------------------------
  path_out="$(docker run --rm --entrypoint bash "$img" -c 'echo "$PATH"' 2>/dev/null || true)"
  if [[ ":$path_out:" == *":/usr/sbin:"* && ":$path_out:" == *":/sbin:"* ]]; then
    note_pass "$img — PATH contains /usr/sbin and /sbin"
  else
    note_fail "$img — PATH" "got: $path_out"
  fi

  # --- Mount points (base only) --------------------------------------------
  if [[ "$short" == "base" ]]; then
    stat_out="$(docker run --rm --entrypoint stat "$img" \
      -c '%U' /home/agent/.claude /home/agent/.gemini /home/agent/.copilot /home/agent/.mempalace \
      2>/dev/null || true)"
    # Expect exactly four lines, each "agent".
    lines_agent="$(printf '%s\n' "$stat_out" | grep -c '^agent$' || true)"
    if [[ "$lines_agent" == "4" ]]; then
      note_pass "$img — all four mount points owned by agent"
    else
      note_fail "$img — mount-point ownership" "expected 4 'agent' lines, got: $stat_out"
    fi
  fi

  # --- Per-CLI --version probe ---------------------------------------------
  if [[ -n "$cli" ]]; then
    if cli_out="$(docker run --rm "$img" "$cli" --version 2>&1)"; then
      if [[ -n "${cli_out//[[:space:]]/}" ]]; then
        note_pass "$img — $cli --version exits 0 with non-empty output"
      else
        note_fail "$img — $cli --version output" "exit 0 but empty stdout"
      fi
    else
      note_fail "$img — $cli --version" "non-zero exit; output: $cli_out"
    fi
  fi

  # --- Compressed size budget (slow; opt-in) -------------------------------
  if [[ "${E2E_DOCKER_TESTS_FULL:-0}" == "1" ]]; then
    if [[ "$short" == "base" ]]; then
      budget=$((500 * 1024 * 1024))
    else
      budget=$((800 * 1024 * 1024))
    fi
    size="$(docker save "$img" 2>/dev/null | gzip -c | wc -c | tr -d ' ')"
    if [[ -n "$size" && "$size" -le "$budget" ]]; then
      note_pass "$img — compressed size ${size} B ≤ budget ${budget} B"
    else
      note_fail "$img — compressed size budget" "got ${size} B, budget ${budget} B"
    fi
  else
    note_skip "$img — compressed size budget" "set E2E_DOCKER_TESTS_FULL=1 to run"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
