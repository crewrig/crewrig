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

# Close the world-writable window opened by e2e_chown_bootstrap (Med-1 from
# the #148 security review). The shared helper sets $DIR to a+rwx so the
# container's `agent` UID can write during the interactive login; tightening
# immediately after the container exits — BEFORE the denylist, the API-key
# grep, and the post-flight check — minimizes shared-dev-box exposure.
chmod 700 "$DIR"

# Post-login: the sandbox mount above means the in-container CLI wrote
# directly into $DIR. Apply the denylist (issue #148, design note
# Decision 1 — revised post-developer-feedback at design commit 90c8b87)
# to sweep up leftover noise from prior runs and ignore Bucket D
# artifacts. Source is $DIR itself; no host ~/.gemini read.
#
# Denylist (Decision 1):
#   antigravity-browser-profile/ — ~18k Chromium cache files (#147 §2)
#   antigravity/                 — sibling browser profile
#   tmp/                         — transient session scratch (#147 §2)
#   *.bak / *.ori / *.orig       — Bucket D leftovers (#147 §2.4)
rm -rf \
  "${DIR}/antigravity-browser-profile" \
  "${DIR}/antigravity" \
  "${DIR}/tmp"
find "$DIR" -maxdepth 2 -type f \( -name '*.bak' -o -name '*.ori' -o -name '*.orig' \) -delete

# Normalize modes inside $DIR (Med-2 from the #148 security review). The
# 0600 invariant on oauth_creds.json was previously implicit on whatever
# the Gemini CLI happened to write; assert it. Belt-and-braces against a
# future CLI release loosening file modes.
find "$DIR" -type d -exec chmod 700 {} +
find "$DIR" -type f -exec chmod 600 {} +

# Post-flight: oauth_creds.json is the load-bearing file; settings.json holds
# the selected auth type and is written on first menu choice. Both must be
# present after a successful login. Any other artifact missing is host
# weirdness, not a login-flow failure (Decision 1 blast radius).
missing=()
[ -f "${DIR}/oauth_creds.json" ] || missing+=("oauth_creds.json")
[ -f "${DIR}/settings.json" ]    || missing+=("settings.json")

if [ "${#missing[@]}" -gt 0 ]; then
  e2e_info "[$CLI] WARNING: expected credential file(s) not found in $DIR:"
  for f in "${missing[@]}"; do e2e_info "  - $f"; done
  e2e_info "[$CLI] The login flow may not have completed. Re-run \`task e2e:auth:gemini\` and finish the browser step."
  exit 1
fi

# Refuse to leave API-key material on disk (Decision 7 of ADR 0002). With the
# broader capture we walk the full $DIR rather than the two original files —
# any new Gemini CLI artifact may carry the key. The assignment-shape
# anchor (`=` + ≥16-char value, Low-2 from the #148 security review)
# filters prose mentions inside transcripts / acknowledgments that merely
# name the env var without containing an actual key value.
if grep -rlE '(GEMINI|GOOGLE)_API_KEY[[:space:]]*=[[:space:]]*[A-Za-z0-9_-]{16,}' "$DIR" 2>/dev/null | grep -q .; then
  e2e_die "[$CLI] API-key material detected under $DIR — API keys MUST be passed via the host shell env at scenario run time, never persisted. Delete the offending file(s) and re-run."
fi

e2e_info "[$CLI] Authenticated. Credentials persisted under $DIR (mode 0700; files 0600)."
e2e_info "[$CLI] Bundle contains a long-lived OAuth refresh token. Treat ${DIR} like ~/.ssh — host-only, never sync to cloud storage, never ship in container images."
e2e_info "[$CLI] Next: run scenarios with the dir mounted read-only at /run/gemini-creds (issue #78)."
