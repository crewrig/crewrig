#!/usr/bin/env bash
# scripts/lib/tls-delegation.sh — forwarding FUNCTION shim (spec 0256 requirement 33, Decision D3).
# The implementation is scripts/tls-delegation.ts (detection in scripts/lib/setup/tls-detect.ts,
# the offer in scripts/lib/setup/tls-offer.ts); this file remains so every Bash caller that SOURCES
# it and calls the public functions below reaches the TypeScript version. Sourced, never executed.
# It retires with the last Bash test that sources it (row J1b).
#
# Each public function keeps its name, arguments, standard output and return code; it runs the
# Node.js floor guard (scripts/lib/node-floor-guard.js) as its own command, then the entry. It never
# calls `exit` and sets no `trap`: with `node` absent it prints one `Error:` line and returns 1, below
# the floor it returns the guard's status and diagnostic, and the entry is not run.
#
# Two things the entry cannot do for a function, so this shim does them in the calling shell:
#   - the interactive question: the entry's own prompter reads lines, the original asked through
#     `fzf`. `offer_tls_delegation` asks through `fzf` exactly as before, once detection fires, and
#     forwards the choice with `--answer tls-delegation=<yes|no>`, so the entry never needs a
#     terminal and never reads standard input here;
#   - the variables: a child process cannot export into this shell. The entry writes
#     `wrote=1|0` to a side-channel file (`--result`); on `wrote=1` the shim sources
#     `~/.crewrig/tls-env.sh` here, as the original did, so the CA variables reach the sourcing shell.
# The variables the entry reads are handed to it explicitly, so a shell variable that was set but
# never exported is seen as the original saw it.
#
# Original description: Custom root-CA / native-TLS delegation (spec 0084). Detects,
# deterministically, whether the environment appears to require custom certificate trust, and — only
# on explicit consent — records standard, tool-native trust variables to a single per-user managed
# file (~/.crewrig/tls-env.sh) that the runtime wrapper (scripts/lib/tls-exec.sh) and the framework's
# launch paths source. It NEVER edits the user's shell profile or global tool configuration in
# place, and NEVER emits a setting that disables or weakens certificate verification (spec 0084
# R3/R5/R6/R11).

_TLS_DELEGATION_SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# _tls_require_node — the floor: `node` present and at Node.js 24 or later. Returns non-zero with
# the diagnostic on standard error otherwise.
_tls_require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Error: node was not found on PATH; tls-delegation.sh needs Node.js 24 or later (https://nodejs.org/en/download)." >&2
    return 1
  fi
  node "${_TLS_DELEGATION_SCRIPTS}/lib/node-floor-guard.js" || return $?
}

# _tls_entry <subcommand> [args...] — run the entry with the variables it reads taken from this
# shell (exported or not). Standard input and output are the caller's.
_tls_entry() {
  local -a vars=()
  local v
  for v in HOME TLS_DELEGATION TLS_DELEGATION_CA CREWRIG_TLS_CA NODE_EXTRA_CA_CERTS \
           SSL_CERT_FILE REQUESTS_CA_BUNDLE PIP_CERT GIT_SSL_CAINFO CURL_CA_BUNDLE \
           UV_SYSTEM_CERTS UV_NATIVE_TLS HTTPS_PROXY HTTP_PROXY; do
    if [ -n "${!v+x}" ]; then
      vars+=("$v=${!v}")
    fi
  done
  env ${vars[@]+"${vars[@]}"} node "${_TLS_DELEGATION_SCRIPTS}/tls-delegation.ts" "$@"
}

# _tls_candidate_ca — echo the resolved custom-CA bundle path, or nothing (return 1).
_tls_candidate_ca() {
  _tls_require_node || return $?
  _tls_entry candidate
}

# detect_custom_tls_context — return 0 if a custom-trust context is detected.
detect_custom_tls_context() {
  _tls_require_node || return $?
  _tls_entry detect
}

# offer_tls_delegation — the opt-in flow: 0 done, 1 for an invalid TLS_DELEGATION. TLS_DELEGATION=on|off
# bypasses the question and the detection; otherwise nothing happens unless detection fires, and the
# yes/no is asked through `fzf` here.
offer_tls_delegation() {
  _tls_require_node || return $?

  local -a answer=()
  local choice=""
  if [ -z "${TLS_DELEGATION:-}" ]; then
    _tls_entry detect || return 0
    choice=$(printf '%s\n' no yes | fzf --height 10% \
      --header "Configure the framework's tools to trust your system CA for its network operations? (never disables TLS verification; writes only ~/.crewrig/tls-env.sh)") || choice="no"
    [ "$choice" = "yes" ] || choice="no"
    answer=(--answer "tls-delegation=$choice")
  fi

  local result
  result="$(mktemp "${TMPDIR:-/tmp}/crewrig-tls-offer.XXXXXX")" || {
    echo "Error: could not create a temporary file for the TLS offer." >&2
    return 1
  }
  local rc=0 line=""
  _tls_entry offer --result "$result" ${answer[@]+"${answer[@]}"} || rc=$?
  IFS= read -r line < "$result" || true
  rm -f "$result"

  if [ "$line" = "wrote=1" ]; then
    # Reach the immediately-following setup bootstrap in this shell too.
    # shellcheck source=/dev/null
    . "${HOME}/.crewrig/tls-env.sh"
  fi
  return "$rc"
}
