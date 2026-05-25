#!/usr/bin/env bash
# Interactive auth flow for Claude Code in the e2e harness (issue #77).
#
# Populates ~/.crewrig-e2e/claude/{.credentials.json,.claude.json} by running
# `claude /login` inside a TTY-attached container with the host dir bind-mounted
# read-write. The dedicated test account is used; the developer completes the
# OAuth browser flow on the host. Subsequent scenario runs mount the same dir
# read-only.
#
# Idempotent: safe to re-run on an already-authenticated dir. Existing
# credential files are preserved by claude itself (it skips the login prompt if
# the session is still valid).
#
# See docs/adr/0002-e2e-auth-flow.md (Decision 2) for the full rationale.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/auth-common.sh
source "${SCRIPT_DIR}/lib/auth-common.sh"

CLI="claude"
IMAGE="crewrig/e2e-${CLI}:latest"
DIR="$(e2e_cli_dir "$CLI")"

e2e_require_docker
e2e_require_image "$IMAGE" "task e2e:build:claude"

e2e_info "[$CLI] Preparing ${DIR}…"
mkdir -p "$DIR"

# Decision 6: chown bootstrap is mandatory (macOS) and harmless (Linux).
e2e_chown_bootstrap "$CLI" "$IMAGE"

e2e_info "[$CLI] Launching interactive login. Complete the browser OAuth flow on the host."
e2e_info "[$CLI] (Press Ctrl-D inside the prompt when Claude reports a successful login.)"

# Interactive RW mount. The container's entry-point launches the `claude` REPL;
# `/login` is the slash command the user issues at the prompt. We attach a TTY
# so the OAuth URL is rendered properly and the user can paste the redirect.
docker run --rm -it \
  -v "${DIR}:/home/agent/.${CLI}" \
  "$IMAGE" \
  claude /login \
  || e2e_die "[$CLI] interactive container exited non-zero. Re-run after resolving the error above."

# Post-flight: both .credentials.json AND .claude.json must land on disk for
# subsequent non-interactive runs to skip the login prompt (upstream:
# tfvchow/field-notes-public#10).
missing=()
[ -f "${DIR}/.credentials.json" ] || missing+=(".credentials.json")
[ -f "${DIR}/.claude.json" ]      || missing+=(".claude.json")

if [ "${#missing[@]}" -gt 0 ]; then
  e2e_info "[$CLI] WARNING: expected credential file(s) not found in $DIR:"
  for f in "${missing[@]}"; do e2e_info "  - $f"; done
  e2e_info "[$CLI] The login flow may not have completed. Re-run \`task e2e:auth:claude\` after authenticating in the browser."
  exit 1
fi

# Defensive: refuse to leave API-key material on disk (Decision 7 of ADR 0002).
if grep -q 'ANTHROPIC_API_KEY' "${DIR}/.credentials.json" 2>/dev/null; then
  e2e_die "[$CLI] '$DIR/.credentials.json' contains ANTHROPIC_API_KEY material — API keys MUST be passed via the host shell env at scenario run time, never persisted. Delete the file and re-run."
fi

e2e_info "[$CLI] Authenticated. Credentials persisted under $DIR."
e2e_info "[$CLI] Next: run scenarios with the dir mounted read-only (issue #78)."
