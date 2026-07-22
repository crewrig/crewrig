#!/usr/bin/env bash
# scripts/lib/tls-delegation.sh — Custom root-CA / native-TLS delegation
# (spec 0084). Sourced by the four setup-*-interactive.sh flows. Do NOT
# execute directly.
#
# Detects, deterministically, whether the environment appears to require custom
# certificate trust, and — only on explicit consent — records standard,
# tool-native trust variables to a single per-user managed file
# (~/.crewrig/tls-env.sh) that the runtime wrapper (scripts/lib/tls-exec.sh)
# and the framework's launch paths source. It NEVER edits the user's shell
# profile or global tool configuration in place, and NEVER emits a setting that
# disables or weakens certificate verification (spec 0084 R3/R5/R6/R11).

# _tls_candidate_ca — echo the resolved custom-CA bundle path, or nothing.
# Resolution order (first hit wins), all deterministic:
#   1. an already-set standard cert env var (reuse the user's own value);
#   2. an explicit CREWRIG_TLS_CA / TLS_DELEGATION_CA override;
#   3. the OS consolidated trust bundle (Linux ca-certificates / RHEL bundle;
#      macOS /etc/ssl/cert.pem).
_tls_candidate_ca() {
  local v
  for v in "${SSL_CERT_FILE:-}" "${REQUESTS_CA_BUNDLE:-}" "${NODE_EXTRA_CA_CERTS:-}" \
           "${GIT_SSL_CAINFO:-}" "${CURL_CA_BUNDLE:-}" "${PIP_CERT:-}" \
           "${TLS_DELEGATION_CA:-}" "${CREWRIG_TLS_CA:-}"; do
    if [ -n "$v" ] && [ -f "$v" ]; then
      echo "$v"
      return 0
    fi
  done
  local b
  for b in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
           /etc/ssl/cert.pem; do
    if [ -f "$b" ]; then
      echo "$b"
      return 0
    fi
  done
  return 1
}

# detect_custom_tls_context — return 0 if a custom-trust context is detected.
# Deterministic signals only; never parses any tool's error text (spec 0084 R4).
# Conservative by design: prefer under-firing (the runbook covers the manual
# path) over nagging a user who is not behind a custom CA.
detect_custom_tls_context() {
  # Signal 1: any standard cert/proxy variable already set in the environment.
  local v
  for v in NODE_EXTRA_CA_CERTS SSL_CERT_FILE REQUESTS_CA_BUNDLE PIP_CERT \
           GIT_SSL_CAINFO CURL_CA_BUNDLE HTTPS_PROXY HTTP_PROXY \
           CREWRIG_TLS_CA TLS_DELEGATION_CA; do
    if [ -n "${!v:-}" ]; then
      return 0
    fi
  done
  # Signal 2: an admin-added custom CA anchor. Files placed in these locations
  # are non-default by construction — the stock bundle lives elsewhere.
  if [ -d /usr/local/share/ca-certificates ] \
     && [ -n "$(ls -A /usr/local/share/ca-certificates 2>/dev/null)" ]; then
    return 0
  fi
  if [ -d /etc/pki/ca-trust/source/anchors ] \
     && [ -n "$(ls -A /etc/pki/ca-trust/source/anchors 2>/dev/null)" ]; then
    return 0
  fi
  return 1
}

# offer_tls_delegation — the opt-in flow. Conservative: no offer when no
# custom-trust context is detected. Consent is explicit; declining is a strict
# no-op that writes nothing anywhere (spec 0084 R3).
#
# Two drive paths, mirroring configure_validation_backend:
#   Interactive (default) — fzf yes/no prompt, only after detection fires.
#   Non-interactive (hermetic CI/tests) — TLS_DELEGATION=on|off bypasses fzf
#     and detection; TLS_DELEGATION_CA may pin the bundle path.
offer_tls_delegation() {
  local conf_dir="${HOME}/.crewrig"
  local env_file="${conf_dir}/tls-env.sh"
  local choice=""

  if [ -n "${TLS_DELEGATION:-}" ]; then
    case "${TLS_DELEGATION}" in
      on) choice="yes" ;;
      off) return 0 ;;
      *) echo "  ERROR: invalid TLS_DELEGATION '${TLS_DELEGATION}' (want: on|off)"; return 1 ;;
    esac
  else
    detect_custom_tls_context || return 0
    echo ""
    echo "Custom certificate trust (spec 0084):"
    echo "  Your environment looks like it sits behind a custom or corporate"
    echo "  certificate authority (a TLS-intercepting gateway or a private CA)."
    choice=$(printf '%s\n' no yes | fzf --height 10% \
      --header "Configure the framework's tools to trust your system CA for its network operations? (never disables TLS verification; writes only ~/.crewrig/tls-env.sh)") || choice="no"
    [ -n "$choice" ] || choice="no"
  fi

  if [ "$choice" != "yes" ]; then
    echo "  TLS delegation skipped — nothing written."
    return 0
  fi

  local ca
  ca="$(_tls_candidate_ca || true)"
  if [ -z "$ca" ]; then
    echo "  Could not locate a certificate bundle to delegate trust to."
    echo "  Trust was NOT configured, and no verification-disabling setting was"
    echo "  applied. See docs/runbooks/custom-ca-tls-trust.md to configure it"
    echo "  manually (e.g. export CREWRIG_TLS_CA=/path/to/corporate-ca.pem, then"
    echo "  re-run setup)."
    return 0
  fi

  # --- Persist (machine-local, single-action removable; never the profile) ---
  mkdir -p "$conf_dir"
  {
    printf '# crewrig custom root-CA / native-TLS delegation (spec 0084)\n'
    printf '# Per-user, machine-local. Written only on your explicit consent.\n'
    printf '# Remove in one action:  rm %s\n' "$env_file"
    printf 'export NODE_EXTRA_CA_CERTS=%q\n' "$ca"
    printf 'export SSL_CERT_FILE=%q\n' "$ca"
    printf 'export REQUESTS_CA_BUNDLE=%q\n' "$ca"
    printf 'export PIP_CERT=%q\n' "$ca"
    printf 'export GIT_SSL_CAINFO=%q\n' "$ca"
    printf 'export CURL_CA_BUNDLE=%q\n' "$ca"
    printf 'export UV_NATIVE_TLS=1\n'
  } > "${env_file}.tmp" && mv "${env_file}.tmp" "$env_file"

  # Reach the immediately-following setup bootstrap in this shell too.
  # shellcheck source=/dev/null
  . "$env_file"

  echo "  Custom CA trust configured -> $env_file"
  echo "  Delegated to CA bundle: $ca"
  echo "  Applied for this setup run and, via scripts/lib/tls-exec.sh, for the"
  echo "  framework's runtime paths (MCP servers, the ChromaDB daemon)."
  echo "  Your shell profile was NOT modified. Remove with: rm $env_file"
  echo ""
  echo "  Exact configuration written:"
  sed 's/^/    /' "$env_file"
  return 0
}
