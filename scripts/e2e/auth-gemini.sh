#!/usr/bin/env bash
# Interactive auth flow for Gemini CLI in the e2e harness (issue #77).
#
# Populates ~/.crewrig-e2e/gemini/{oauth_creds.json,settings.json} by running
# `gemini` inside a TTY-attached container; the developer picks "Login with
# Google" and completes the browser flow on the host. Subsequent scenario
# runs mount the same dir read-only.
#
# Idempotent: safe to re-run on an already-authenticated dir. The CLI skips
# the login menu when oauth_creds.json carries a valid refresh token.
#
# See docs/adr/0002-e2e-auth-flow.md (Decision 3) for the full rationale.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/auth-common.sh
source "${SCRIPT_DIR}/lib/auth-common.sh"

CLI="gemini"
IMAGE="crewrig/e2e-${CLI}:latest"
DIR="$(e2e_cli_dir "$CLI")"

e2e_require_docker
e2e_require_image "$IMAGE" "task e2e:build:gemini"

e2e_info "[$CLI] Preparing ${DIR}…"
mkdir -p "$DIR"

# Decision 6: chown bootstrap is mandatory (macOS) and harmless (Linux).
e2e_chown_bootstrap "$CLI" "$IMAGE"

e2e_info "[$CLI] Launching Gemini CLI. In the menu, pick \"Login with Google\" and complete the browser flow."
e2e_info "[$CLI] Once you see the welcome prompt, type \"/quit\" (or Ctrl-D) to exit."

docker run --rm -it \
  -v "${DIR}:/home/agent/.${CLI}" \
  "$IMAGE" \
  gemini \
  || e2e_die "[$CLI] interactive container exited non-zero. Re-run after resolving the error above."

# Post-flight: oauth_creds.json is the load-bearing file; settings.json holds
# the selected auth type and is written on first menu choice. Both should be
# present after a successful login.
missing=()
[ -f "${DIR}/oauth_creds.json" ] || missing+=("oauth_creds.json")
[ -f "${DIR}/settings.json" ]    || missing+=("settings.json")

if [ "${#missing[@]}" -gt 0 ]; then
  e2e_info "[$CLI] WARNING: expected credential file(s) not found in $DIR:"
  for f in "${missing[@]}"; do e2e_info "  - $f"; done
  e2e_info "[$CLI] The login flow may not have completed. Re-run \`task e2e:auth:gemini\` and finish the browser step."
  exit 1
fi

# Refuse to leave API-key material on disk (Decision 7 of ADR 0002).
if grep -qE 'GEMINI_API_KEY|GOOGLE_API_KEY' "${DIR}/settings.json" 2>/dev/null \
   || grep -qE 'GEMINI_API_KEY|GOOGLE_API_KEY' "${DIR}/oauth_creds.json" 2>/dev/null; then
  e2e_die "[$CLI] API-key material detected in $DIR — API keys MUST be passed via the host shell env at scenario run time, never persisted. Delete the offending file and re-run."
fi

e2e_info "[$CLI] Authenticated. Credentials persisted under $DIR."
e2e_info "[$CLI] Next: run scenarios with the dir mounted read-only (issue #78)."
