#!/usr/bin/env bash
# Interactive auth flow for Ollama Cloud in the e2e harness (issue #114).
#
# Populates ~/.crewrig-e2e/ollama/{id_ed25519,id_ed25519.pub} by running
# `ollama signin` inside a TTY-attached container with the host dir bind-
# mounted read-write. The dedicated test account is used; the developer
# completes the browser flow on the host. Scenarios that route Copilot
# through Ollama Cloud (see tests/e2e/local.toml.example) mount the same
# dir read-only into the copilot container.
#
# Idempotent: ollama signin skips the registration step when an existing
# keypair is already registered against the account.
#
# See docs/adr/0002-e2e-auth-flow.md (Decision 8) for the full rationale.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/auth-common.sh
source "${SCRIPT_DIR}/lib/auth-common.sh"

CLI="ollama"
# Reuse the copilot image — base image ships the ollama client (ADR 0001)
# and the copilot image is the one scenarios will exec against, so signin-
# time and run-time share an identical client surface.
IMAGE="crewrig/e2e-copilot:latest"
DIR="$(e2e_cli_dir "$CLI")"

e2e_require_docker
e2e_require_image "$IMAGE" "task e2e:build:copilot"

e2e_info "[$CLI] Preparing ${DIR}…"
mkdir -p "$DIR"

# Decision 6: chown bootstrap is mandatory (macOS) and harmless (Linux).
e2e_chown_bootstrap "$CLI" "$IMAGE"

e2e_info "[$CLI] Launching \`ollama signin\`. Complete the browser flow on the host using the DEDICATED TEST ACCOUNT on ollama.com."
e2e_info "[$CLI] (The CLI will print a URL; open it on the host, approve, then return here.)"

docker run --rm -it \
  -v "${DIR}:/home/agent/.${CLI}" \
  "$IMAGE" \
  bash -c 'ollama serve >/dev/null 2>&1 & sleep 2 && ollama signin' \
  || e2e_die "[$CLI] interactive container exited non-zero. Re-run after resolving the error above."

# Post-flight: id_ed25519 is the load-bearing private key; id_ed25519.pub
# is its public counterpart registered with ollama.com.
missing=()
[ -f "${DIR}/id_ed25519" ]     || missing+=("id_ed25519")
[ -f "${DIR}/id_ed25519.pub" ] || missing+=("id_ed25519.pub")

if [ "${#missing[@]}" -gt 0 ]; then
  e2e_info "[$CLI] WARNING: expected credential file(s) not found in $DIR:"
  for f in "${missing[@]}"; do e2e_info "  - $f"; done
  e2e_info "[$CLI] The signin flow may not have completed. Re-run \`task e2e:auth:ollama\` after authorising in the browser."
  exit 1
fi

# Defensive: refuse to leave Ollama API key material in the dir (Decision 7).
if find "${DIR}" -type f -iname '*api*key*' -print -quit | grep -q .; then
  e2e_die "[$CLI] API-key-like file detected under $DIR — Ollama auth uses an Ed25519 keypair, not an API key. Delete the offending file and re-run."
fi

e2e_info "[$CLI] Authenticated. Ed25519 keypair persisted under $DIR."
e2e_info "[$CLI] Next: scenarios that set OLLAMA_HOST will use this keypair (RO mount)."
