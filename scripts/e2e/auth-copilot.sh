#!/usr/bin/env bash
# Guidance flow for GitHub Copilot CLI in the e2e harness (issue #77).
#
# Unlike claude / gemini, this script does NOT launch an interactive container.
# Per ADR 0002 Decision 4, the v1 path is env-var token (PAT): the developer
# mints a fine-grained PAT for the dedicated test account and exports it as
# COPILOT_GITHUB_TOKEN in their shell. Scenarios consume the env var at run
# time via `docker run -e COPILOT_GITHUB_TOKEN ...`; nothing is persisted under
# ~/.crewrig-e2e/copilot/.
#
# If COPILOT_GITHUB_TOKEN is already set in the calling shell, the script runs
# a 5-second sanity test against the e2e image and reports the result.
#
# See docs/adr/0002-e2e-auth-flow.md (Decision 4) for the full rationale,
# including why we deferred device flow despite the empirical fallback path
# being open.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/auth-common.sh
source "${SCRIPT_DIR}/lib/auth-common.sh"

CLI="copilot"
IMAGE="crewrig/e2e-${CLI}:latest"

cat >&2 <<'BANNER'
================================================================================
 e2e auth — GitHub Copilot CLI (PAT-based, v1)
================================================================================
Copilot CLI in our containers reads its credential from the env var
COPILOT_GITHUB_TOKEN at run time (precedence: COPILOT_GITHUB_TOKEN >
GITHUB_TOKEN > GH_TOKEN). No file is written under ~/.crewrig-e2e/copilot/.

Steps (do these on your host, in the shell you will run scenarios from):

  1. Sign into the dedicated TEST GitHub account (NOT your personal one).
  2. Mint a fine-grained PAT:
       https://github.com/settings/personal-access-tokens/new
     Recommended scopes (per ADR 0002 Decision 4):
       - Resource owner   : the test account
       - Repository access: "Public repositories (read-only)" is sufficient
                            for scenario coverage. Tighten further per policy.
       - Permissions      : Copilot — Read & write
                            (no other repo or account scopes required)
     Expiry: fine-grained PATs default to 90 DAYS. Rotate quarterly; CI will
     silently start failing without a calendar reminder.
  3. Add to your shell rc (zsh: ~/.zshrc, bash: ~/.bashrc):

       export COPILOT_GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

     Then `source` it (or open a new shell). Verify with:

       echo "${COPILOT_GITHUB_TOKEN:0:4}…  (length=${#COPILOT_GITHUB_TOKEN})"

  4. Re-run `task e2e:auth:copilot` to trigger the sanity test below.
================================================================================
BANNER

if [ -z "${COPILOT_GITHUB_TOKEN:-}" ]; then
  e2e_info ""
  e2e_info "[$CLI] COPILOT_GITHUB_TOKEN is not set in this shell. Follow the steps above, then re-run."
  exit 0
fi

# Token is set — try a non-interactive sanity check against the image.
e2e_require_docker
e2e_require_image "$IMAGE" "task e2e:build:copilot"

e2e_info ""
e2e_info "[$CLI] COPILOT_GITHUB_TOKEN detected (length=${#COPILOT_GITHUB_TOKEN}). Running sanity test…"

# `copilot --help` does not contact the API, but it does parse the env var
# at startup and will surface a malformed-token error if present. Combined
# with --version this is a fast (~5 s) confidence check that the image is
# usable end-to-end without spending real Copilot quota.
if docker run --rm \
     -e COPILOT_GITHUB_TOKEN \
     "$IMAGE" \
     copilot --version >/dev/null 2>&1; then
  e2e_info "[$CLI] OK — image launches and accepts the env var."
  e2e_info "[$CLI] Quarterly reminder: fine-grained PATs expire in 90 days. Rotate before then."
else
  e2e_info "[$CLI] WARNING: \`copilot --version\` exited non-zero inside the image."
  e2e_info "[$CLI] Re-run with: docker run --rm -e COPILOT_GITHUB_TOKEN $IMAGE copilot --version"
  e2e_info "[$CLI] to see the full error and confirm the token is valid for the test account."
  exit 1
fi
