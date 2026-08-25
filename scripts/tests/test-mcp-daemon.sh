#!/usr/bin/env bash
# test-mcp-daemon.sh — Regression tests for the shared MemPalace MCP HTTP
# daemon (spec 0113, ADR 0016).
#
# ISOLATION CONTRACT — read this before adding a case.
#
# Every test that touches supervisor or daemon state isolates on ALL THREE
# axes, and refuses to run if any of them resolves to its production value:
#
#   1. label / unit name  — a shared label lets a test act on the operator's
#                           real supervisor unit; launchd labels are keyed by
#                           uid (gui/<uid>) and `systemctl --user` units too,
#                           so $HOME alone does not isolate them.
#   2. PORT               — the axis that matters most here and the one a
#                           label guard does not watch. This tier is reached
#                           over HTTP: a correctly test-labelled unit that
#                           fails to bind because production holds the socket
#                           leaves the clients connecting to PRODUCTION. The
#                           writes then land in the operator's real palace with
#                           every assertion passing — green and destructive at
#                           once.
#   3. $HOME              — keeps the palace, the lock filename and the token
#                           path off the real store.
#
# The same contract is documented at test-chroma-server.sh:19-21.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
nope() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }

# --- Isolation guard (refuses rather than risks) -----------------------------
PROD_LABEL="com.mempalace.mcp-server"
PROD_UNIT="mempalace-mcp-server"
PROD_PORT="8021"
# 41893 is the CURRENT default (common.sh:~720, since #748); 8021 predates
# that move and a machine provisioned before it still binds the old value.
#
# Be precise about what these two constants do, because the guard below reads
# as though they protect the operator and they do not: the port override is
# unconditional, so the effective port is always drawn from 18000-18899 and
# can never equal either constant. Both clauses are therefore UNREACHABLE as
# the file stands. They are kept as a tripwire on the override itself — weaken
# it to `${VAR:-default}` or drop it, and an operator who exports a production
# port reaches the tests with the guard already in place to catch them. What
# protects a pre-#748 machine today is the override, not this comparison.
PROD_PORT_CURRENT="41893"

# Capture the real HOME BEFORE overriding it. Comparing $HOME to `cd ~` after
# the override compares the override to itself and is always equal — a guard
# that would refuse every run, i.e. protect by permanently skipping the tests
# it exists to protect.
REAL_HOME="${HOME}"
# Same capture, and this one guards a hazard that IS live. The port drawn
# below is random, so it can land on whatever port the operator configured for
# their OWN daemon — binding that is precisely the axis-2 hazard above, and no
# comparison against the two production constants sees it, since the operator
# may serve on any port at all. Refuse rather than re-roll, per this file's
# contract. No emptiness test is needed beside it: unset leaves this empty and
# the override is always non-empty, so the comparison is simply false. And do
# NOT extend this to refuse merely because the captured value is a production
# port — exporting 8021 is how a pre-#748 machine is configured, the override
# already makes such a machine safe, and refusing there would skip the tests
# on exactly the population axis 2 exists to protect.
REAL_MCP_PORT="${MEMPALACE_MCP_PORT:-}"
TEST_HOME="$(mktemp -d)"
export HOME="${TEST_HOME}"
export MEMPALACE_MCP_LABEL="com.mempalace.mcp-server-test-$$"
export MEMPALACE_MCP_UNIT="mempalace-mcp-server-test-$$"
export MEMPALACE_MCP_PORT="$((18000 + (RANDOM % 900)))"
export MEMPALACE_MCP_LAUNCHER_PATH="${TEST_HOME}/.crewrig/mcp-daemon-launcher.sh"
# The launcher only needs an interpreter PATH substituted in; the tests never
# execute the wrapper, so any resolvable python satisfies them. Without this a
# runner with no mempalace venv fails every launcher assertion for a reason
# that has nothing to do with what is under test.
export MEMPALACE_PYTHON="${MEMPALACE_PYTHON:-$(command -v python3 || echo /usr/bin/python3)}"
# Every launcher invocation below exercises a refusal and must die at the token
# check. Without this, a regression that lets one through would sit in the
# ChromaDB wait for a full minute per case and the suite would look hung.
export MEMPALACE_MCP_CHROMA_WAIT=2
# Point the launcher's ChromaDB dependency at a dead port. Every launcher case
# below asserts a REFUSAL, and a refusal test must not be able to succeed at
# starting something: if a regression removes the token guards, the launcher
# would otherwise reach its exec and spawn a REAL daemon from inside the test
# suite. Discovered by deliberately removing both guards — the suite hung with
# a live daemon rather than failing. The dead port makes the exec unreachable,
# so a broken guard shows up as a failed assertion instead of a background
# process nobody notices.
export MEMPALACE_CHROMA_PORT=1
# Claude Code resolves its user config through CLAUDE_CONFIG_DIR, so $HOME alone
# does NOT isolate the Claude arm. Nothing exercises it today, but the coverage
# this suite still owes (the switch transaction, the Claude reader) does — and
# whoever writes it would mutate the operator's real ~/.claude.json unless the
# variable is already redirected. Added before the coverage that needs it.
export CLAUDE_CONFIG_DIR="${TEST_HOME}/.claude-config"
mkdir -p "${CLAUDE_CONFIG_DIR}"

cleanup() { rm -rf "${TEST_HOME}"; }
trap cleanup EXIT

if [ "${MEMPALACE_MCP_LABEL}" = "${PROD_LABEL}" ] \
  || [ "${MEMPALACE_MCP_UNIT}" = "${PROD_UNIT}" ] \
  || [ "${MEMPALACE_MCP_PORT}" = "${PROD_PORT}" ] \
  || [ "${MEMPALACE_MCP_PORT}" = "${PROD_PORT_CURRENT}" ] \
  || [ "${MEMPALACE_MCP_PORT}" = "${REAL_MCP_PORT}" ] \
  || [ "${HOME}" = "${REAL_HOME}" ]; then
  echo "REFUSING TO RUN: an isolation axis resolved to its production value." >&2
  echo "  label=${MEMPALACE_MCP_LABEL} unit=${MEMPALACE_MCP_UNIT} port=${MEMPALACE_MCP_PORT}" >&2
  if [ "${MEMPALACE_MCP_PORT}" = "${REAL_MCP_PORT}" ]; then
    echo "  the randomly chosen test port collides with MEMPALACE_MCP_PORT=${REAL_MCP_PORT}" >&2
    echo "  from your environment — re-run to draw a different one." >&2
  fi
  exit 2
fi

# shellcheck source=../lib/common.sh
. "${REPO_DIR}/scripts/lib/common.sh"
CREWRIG_REPO_DIR="${REPO_DIR}"

echo "test-mcp-daemon.sh — isolated in ${TEST_HOME}"
echo ""

# --- 1. Token provisioning ---------------------------------------------------
echo "Token provisioning (R8):"
tok="$(mcp_token_read_or_create)"
[ -n "${tok}" ] && ok "a token is created when absent" || nope "no token created"

tok2="$(mcp_token_read_or_create)"
[ "${tok}" = "${tok2}" ] && ok "re-reading returns the same token (idempotent)" \
  || nope "second call produced a different token"

tok_file="$(mcp_token_path)"
# GNU first: `stat -f` on GNU means "filesystem" and SUCCEEDS with unusable
# output, so probing BSD-style first silently yields garbage on Linux.
perms="$(stat -c '%a' "${tok_file}" 2>/dev/null || stat -f '%Lp' "${tok_file}" 2>/dev/null)"
[ "${perms}" = "600" ] && ok "token file is mode 0600" || nope "token file is mode ${perms}, expected 600"

# Symlinked palace directory canonicalization (spec 0159 / issue #746)
real_palace="${TEST_HOME}/real_palace"
sym_palace="${TEST_HOME}/sym_palace"
mkdir -p "${real_palace}"
ln -s "${real_palace}" "${sym_palace}"
p_real="$(MEMPALACE_PALACE_PATH="${real_palace}" mcp_token_path)"
p_sym="$(MEMPALACE_PALACE_PATH="${sym_palace}" mcp_token_path)"
[ "${p_real}" = "${p_sym}" ] && ok "symlinked palace path resolves to identical token path as real directory (spec 0159)" \
  || nope "symlinked palace path (${p_sym}) diverges from real directory (${p_real})"

# --- 2. The launcher refuses to serve without a token ------------------------
# This is the finding that would otherwise have shipped a daemon with
# authentication silently disabled: MemPalace requires a token only on a
# non-loopback bind, and its auth gate short-circuits on an empty one.
echo ""

# refuses_for_token <case-label> — run the launcher and assert it refused FOR
# THE TOKEN, not merely that it exited non-zero.
#
# Checking the exit code alone is not enough and this was proven, not assumed:
# with the token guards deliberately removed the suite still went green, because
# the launcher then died on the unreachable ChromaDB dependency instead. A
# refusal test that does not name the reason passes for whichever failure
# happens first, which is the "green for the wrong reason" trap this file
# exists to avoid. So: assert the diagnostic mentions the token.
# Bounded: the launcher's happy path is an exec into a server that never
# returns, so any regression letting a refusal case through turns this suite
# into a hang rather than a failure. No `timeout(1)` on stock macOS, hence the
# watchdog.
run_launcher_bounded() {
  local out_file rc
  out_file="$(mktemp)"
  bash "${launcher}" >"${out_file}" 2>&1 &
  local pid=$!
  ( sleep 20; kill -9 "${pid}" 2>/dev/null ) &
  local watchdog=$!
  wait "${pid}" 2>/dev/null; rc=$?
  kill "${watchdog}" 2>/dev/null
  cat "${out_file}"; rm -f "${out_file}"
  return "${rc}"
}

refuses_for_token() {
  local label="$1" out rc
  out="$(run_launcher_bounded)"; rc=$?
  if [ "${rc}" -eq 0 ]; then
    nope "${label} — launcher STARTED (auth would be disabled)"
    return
  fi
  case "${out}" in
    *"bearer token"*) ok "${label}" ;;
    *) nope "${label} — refused, but not for the token: ${out}" ;;
  esac
}

echo "Launcher refuses an absent or empty token (R8, security):"
install_mcp_launcher >/dev/null 2>&1
launcher="$(mcp_launcher_installed_path)"
[ -f "${launcher}" ] && ok "launcher materialised to the installed path" \
  || nope "launcher not installed at ${launcher}"

rm -f "${tok_file}"
refuses_for_token "launcher refuses to start with no token file"

mkdir -p "$(dirname "${tok_file}")"; : > "${tok_file}"
refuses_for_token "launcher refuses to start with an empty token"

# Whitespace-only is the case that defeated the first version of this guard:
# the shell sees a non-empty string, upstream .strip()s it to empty, and an
# empty auth_token short-circuits the bearer check — the daemon then serves the
# whole palace unauthenticated while the launcher reports success.
printf '   \t  \n' > "${tok_file}"
refuses_for_token "launcher refuses to start with a whitespace-only token"

printf 'short\n' > "${tok_file}"
refuses_for_token "launcher refuses a token shorter than 32 characters"

printf 'has spaces and $(id) in it padded to length aaaaaaaaaaaa\n' > "${tok_file}"
refuses_for_token "launcher refuses a token with unexpected characters"

# mcp_token_read_or_create must refuse the same content rather than hand back
# an empty string that would register `Authorization: Bearer ` on four CLIs.
printf '   \n' > "${tok_file}"
if mcp_token_read_or_create >/dev/null 2>&1; then
  nope "token reader returned success on a whitespace-only file"
else
  ok "token reader refuses a whitespace-only token file"
fi
rm -f "${tok_file}"

# Acceptance, not just refusal. Every case above asserts a REFUSAL; with only
# those, tightening the charset to [A-Za-z0-9] would keep the suite fully green
# while rejecting every token `mempalace serve` provisions (token_urlsafe uses
# - and _) and breaking the documented convergence. The dead ChromaDB port
# gives the success signal for free: dying at ChromaDB means the token gate was
# passed.
accepts_token() {
  local label="$1" out
  out="$(run_launcher_bounded)"
  case "${out}" in
    *"ChromaDB daemon unreachable"*) ok "${label}" ;;
    *"bearer token"*) nope "${label} — refused at the token gate: ${out}" ;;
    *) nope "${label} — unexpected outcome: ${out}" ;;
  esac
}

printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n' > "${tok_file}"
accepts_token "a 48-character alphanumeric token is accepted"

# upstream's secrets.token_urlsafe alphabet includes - and _
printf 'abcdefghij-klmnopqrst_uvwxyz0123456789ABCDEF\n' > "${tok_file}"
accepts_token "an upstream-style token with - and _ is accepted"

printf '  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  \n' > "${tok_file}"
accepts_token "a valid token with surrounding whitespace is normalised, not rejected"

# --- 3. The launcher never puts the token in argv ----------------------------
echo ""
echo "Token stays out of the process table (R8):"
grep -q 'export MEMPALACE_MCP_HTTP_TOKEN' "${launcher}" \
  && ok "token is exported, not passed as an argument" \
  || nope "token is not exported"
# The exec spans a line continuation, so strip continuations before matching.
exec_stmt="$(sed -e ':a' -e 'N' -e '$!ba' -e 's/\\\n[[:space:]]*/ /g' "${launcher}" | grep -E '^exec ' || true)"
case "${exec_stmt}" in
  *'--transport http'*) ok "handoff execs the wrapper with --transport http" ;;
  *) nope "exec statement does not carry --transport http: ${exec_stmt}" ;;
esac
case "${exec_stmt}" in
  *TOKEN*) nope "the exec statement mentions the token — it would land in argv" ;;
  *) ok "the exec statement carries no token (credential stays in the environment)" ;;
esac
grep -q "${tok}" "${launcher}" 2>/dev/null \
  && nope "the token VALUE was substituted into the launcher" \
  || ok "no token value is baked into the launcher"

# Reintroduction guard: no credential may travel through an argv flag either —
# not the hand-built header, and not curl's own credential flags, which end up
# in the same place. /proc/<pid>/cmdline is world-readable on Linux, so a local
# uid sampling the process table while a probe runs harvests the credential —
# the reason both probes feed the header through a stdin curl config instead
# (scripts/lib/common.sh `_mcp_daemon_probe_accepts`, and `_probe_code` in
# section 16 below). BOTH halves of the banned string — the header name and
# the scheme word — are concatenated at runtime (`argv_hdr`, `argv_scheme`) so
# THIS assertion cannot satisfy the search it performs. Splitting the scheme
# alone sufficed while the search was case-sensitive; it does not since spec
# 0149 R1 made the match case-insensitive, because any line in this block that
# spells the header name out then self-trips the pattern. It deliberately
# admits every spelling of the flag rather than the canonical one only:
# `--header` as well as `-H`, `=` or nothing in place of the space
# (`--header=`, `-H'…'`, `-HAuthorization:…`), an optional opening quote, and
# anything at all between the colon and the scheme name — a cold review put
# all four variants past the earlier `-(H|-header) ` form untouched.
# Over-matching is the right failure direction here: a false positive costs a
# reader one glance, a false negative ships the credential back into the
# process table.
#
# Comments are stripped by matching grep -n's own `<line>:` prefix ANCHORED
# (spec 0149 R2), NOT by leading whitespace — the trap section 4 below
# documents — and NOT unanchored, which used to swallow any genuine violation
# whose line merely carried a trailing comment. The anchor is why the sweep
# runs ONE FILE AT A TIME: hand `grep -n` two paths and every hit gains a
# `<path>:` prefix, so `^[0-9]` never matches and the filter degenerates into
# excluding nothing. The filter is load-bearing either way, since common.sh's
# `register_mempalace_mcp` explains the hazard in prose that quotes the very
# flag being banned.
#
# Scope: the two files this spec governs, swept through the same helper as the
# fixture below — the executable witness that every shape the pattern claims to
# catch is caught, that a pure comment is still excluded, and that the swept
# paths were actually read. The one deliberate occurrence in the repository,
# scripts/tests/test-setup-org-mcp.sh, asserts the org-MCP argv shape on
# purpose and carries a comment saying so at its own call site (spec 0149 R4);
# no other occurrence exists under scripts/.
argv_scheme="Bea""rer"
argv_hdr="Authoriz""ation"
argv_hdr_lc="$(printf '%s' "${argv_hdr}" | tr '[:upper:]' '[:lower:]')"
argv_scheme_lc="$(printf '%s' "${argv_scheme}" | tr '[:upper:]' '[:lower:]')"
# Three shapes, one alternation. The header shape is the one the daemon probes
# could regress into; the other two are the likelier INNOCENT reintroduction —
# a contributor reaching for curl's own credential flags, which put the raw
# token in argv just as plainly as a hand-built header does:
#   A  -H/--header "<hdr>: <scheme> …"   the header shape
#   B  --oauth2-bearer <token>           curl sends the same header from it
#   C  curl … -u/--user "<user>:<pass>"  basic auth, credential in argv
# C is anchored on `curl` on the same line and on the `user:password` colon,
# unlike A and B: bare `-u` is far too common to match on its own (`shopt -u`,
# `systemctl --user`, `date -u '+%H:%M'` — the last would match the colon rule
# without the anchor). A and B need no anchor: both flags are unambiguous.
argv_pat="-(H|-header)[[:space:]=]*[\"']?${argv_hdr}:.*${argv_scheme}"
argv_pat="${argv_pat}|--oauth2-${argv_scheme_lc}[[:space:]=]"
argv_pat="${argv_pat}|curl.*[[:space:]]-(u|-user)[[:space:]=]+[\"']?[^\"'[:space:]]*:"
# ONE pattern and ONE filter, shared by the self-test and the real sweep.
#
# A path that does not exist is recorded as a violation, not skipped. This is
# the difference between a guard and a guard-shaped no-op: `grep` on a missing
# file yields no hits and `2>/dev/null` eats the diagnostic, so renaming either
# swept file — `git mv`, a refactor — would otherwise disarm the sweep and
# leave every assertion in this block green while the repository is searched
# for nothing. Checking inside the helper, on exactly the paths it is about to
# search, is what makes the property hold BY CONSTRUCTION: a second list at the
# call site could drift from the first, this cannot.
_argv_bearer_hits() {
  local f line hits all=""
  for f in "$@"; do
    if [ ! -f "${f}" ]; then
      all="${all}${f}:0:MISSING — the guard swept a path that does not exist"$'\n'
      continue
    fi
    hits="$(grep -niE -- "${argv_pat}" "${f}" 2>/dev/null \
      | grep -vE '^[0-9]+:[[:space:]]*#' || true)"
    [ -n "${hits}" ] || continue
    # Per line, not per blob: prefixing the file to the whole blob left the
    # second and later hits of a file carrying grep's bare `<line>:`, so a
    # reader had to infer block boundaries to attribute them.
    while IFS= read -r line; do
      [ -n "${line}" ] && all="${all}${f}:${line}"$'\n'
    done <<< "${hits}"
  done
  printf '%s' "${all}"
}

# Self-test BEFORE the sweep: this guard is a static grep whose passing state
# looks identical whether or not it can still catch a violation, so it has to
# prove it can. Five fixture lines under ${TEST_HOME} (the cleanup trap at
# :102-103 removes them): the lower-case shape R1 names, the trailing-comment
# shape R2 names, a pure comment that must stay excluded, and one line per
# credential-flag shape B and C. Every word the pattern searches for is handed
# to printf at runtime, for the same reason the pattern itself splits them.
argv_fixture="${TEST_HOME}/argv-guard-fixture.txt"
{ printf 'curl -H "%s: %s $t" http://x\n'              "${argv_hdr_lc}" "${argv_scheme_lc}"
  printf 'curl -H "%s: %s $t" http://x  # ref: #913\n' "${argv_hdr}"    "${argv_scheme}"
  printf '  # prose: NOT curl -H "%s: %s $t"\n'        "${argv_hdr}"    "${argv_scheme}"
  printf 'curl --oauth2-%s "$t" http://x\n'            "${argv_scheme_lc}"
  printf 'curl -sS -u "%s" http://x\n'                 'svc:$t'
} > "${argv_fixture}"
argv_self_hits="$(_argv_bearer_hits "${argv_fixture}")"
argv_self_n="$(printf '%s' "${argv_self_hits}" | grep -c . || true)"
case "${argv_self_hits}" in
  *"${argv_hdr_lc}: ${argv_scheme_lc}"*) ok "the guard catches a violation spelled in lower case (R1)" ;;
  *) nope "the guard missed the lower-case violation: ${argv_self_hits}" ;;
esac
case "${argv_self_hits}" in
  *"# ref: #913"*) ok "the guard catches a violation carrying a trailing comment (R2)" ;;
  *) nope "the comment filter swallowed a violation carrying a trailing comment: ${argv_self_hits}" ;;
esac
case "${argv_self_hits}" in
  *"--oauth2-${argv_scheme_lc}"*) ok "the guard catches curl's own token flag (shape B)" ;;
  *) nope "the guard missed the credential-carrying curl flag: ${argv_self_hits}" ;;
esac
case "${argv_self_hits}" in
  *'"svc:$t"'*) ok "the guard catches basic auth passed through argv (shape C)" ;;
  *) nope "the guard missed the basic-auth credential in argv: ${argv_self_hits}" ;;
esac
# The assertion that kills the degenerate "exclude nothing" filter, which would
# satisfy every case above while making the guard useless: exactly the four
# violation lines are reported, and the pure comment is not.
[ "${argv_self_n}" -eq 4 ] \
  && ok "the anchored filter excludes the comment line and nothing else (R2)" \
  || nope "expected exactly 4 fixture violations, got ${argv_self_n}: ${argv_self_hits}"

argv_bearer_hits="$(_argv_bearer_hits \
  "${REPO_DIR}/scripts/lib/common.sh" \
  "${REPO_DIR}/scripts/tests/test-mcp-daemon.sh")"
# Asserted BEFORE the sweep verdict, and separately from it: a clean sweep and
# a sweep that searched nothing are the same empty string, so the emptiness
# below carries information only once the paths are known to have been read.
case "${argv_bearer_hits}" in
  *":0:MISSING"*) nope "the sweep is vacuous — a swept path does not exist: ${argv_bearer_hits}" ;;
  *) ok "every swept path exists, so a clean sweep below means something" ;;
esac
[ -z "${argv_bearer_hits}" ] \
  && ok "no credential is passed through an argv flag (R8)" \
  || nope "a credential reached argv: ${argv_bearer_hits}"

# --- 4. Unit files never carry the token -------------------------------------
echo ""
echo "Unit files carry no credential (R8):"
for unit in "${REPO_DIR}/config/launchd/com.mempalace.mcp-server.plist" \
            "${REPO_DIR}/config/systemd/mempalace-mcp-server.service"; do
  # Strip comments STRUCTURALLY, then look for an assignment anywhere in what
  # remains. Filtering by leading whitespace made this unfalsifiable for the
  # plist, whose every body line is indented — an injected
  # <string>token=SECRET</string> passed as "commentary".
  body="$(sed -e 's/<!--.*-->//g' -e '/<!--/,/-->/d' -e 's/^[[:space:]]*#.*$//' "${unit}")"
  if printf '%s' "${body}" | grep -qiE 'token[=[:space:]]*[A-Za-z0-9_-]{8,}|MEMPALACE_MCP_HTTP_TOKEN'; then
    nope "$(basename "${unit}") carries a token outside commentary"
  else
    ok "$(basename "${unit}") carries no credential"
  fi
done

# --- 5. Drift detection compares versions, not bytes -------------------------
echo ""
echo "Launcher drift check (step 5):"
recorded="$(grep -m1 '^LAUNCHER_SOURCE_SHA=' "${launcher}" | cut -d'"' -f2)"
current="$(mcp_launcher_source_sha)"
[ -n "${recorded}" ] && ok "installed launcher records its source hash" \
  || nope "no source hash recorded"
[ "${recorded}" = "${current}" ] \
  && ok "a fresh install reports IN SYNC (not spurious drift)" \
  || nope "fresh install reports drift — the check compares the wrong quantity"

# --- 5b. Config modes: a credential-bearing file must never widen ------------
echo ""
echo "Client configs never widen when the token lands in them (R8):"
mkdir -p "${TEST_HOME}/.gemini"
echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
chmod 600 "${TEST_HOME}/.gemini/settings.json"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
mode="$(stat -c '%a' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null || stat -f '%Lp' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null)"
[ "${mode}" = "600" ] \
  && ok "a 0600 config stays 0600 after the token is written into it" \
  || nope "config widened to ${mode} — mv inherits the temp file's mode"

echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
chmod 644 "${TEST_HOME}/.gemini/settings.json"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
mode="$(stat -c '%a' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null || stat -f '%Lp' "${TEST_HOME}/.gemini/settings.json" 2>/dev/null)"
[ "${mode}" = "600" ] \
  && ok "an already-0644 config is narrowed to 0600 once it holds a token" \
  || nope "config left at ${mode} while holding a bearer token"

# --- 6. Arrangement reader ---------------------------------------------------
echo ""
echo "Per-assistant arrangement reader (R16, delta-01 R14):"
mkdir -p "${TEST_HOME}/.gemini"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["x"]}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "a command-based entry reads as stdio" || nope "stdio entry misread"

echo '{"mcpServers":{"mempalace":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "http" ] \
  && ok "a url-based entry reads as http" || nope "http entry misread"

echo '{"mcpServers":{"mempalace":{"nonsense":true}}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "unknown" ] \
  && ok "an entry in neither arrangement reads as unknown (reported, not converged)" \
  || nope "unrecognised entry not flagged"

echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "none" ] \
  && ok "no entry reads as none" || nope "missing entry misread"

echo 'not json' > "${TEST_HOME}/.gemini/settings.json"
[ "$(mcp_assistant_arrangement gemini)" = "unknown" ] \
  && ok "a non-parseable config reads as unknown, not none (R3)" \
  || nope "non-parseable config misread as none"

# --- 7. Capture and restore round-trip (R13) ---------------------------------
echo ""
echo "Capture and restore (R13):"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["original"]}}}' > "${TEST_HOME}/.gemini/settings.json"
cap="$(capture_mempalace_registration gemini)"
register_mempalace_mcp gemini "test-token" >/dev/null 2>&1
[ "$(mcp_assistant_arrangement gemini)" = "http" ] \
  && ok "registration switches the entry to http" || nope "registration did not switch"
# R11 is REPLACE, not add-alongside — and asserting the http shape is present
# does not prove it. An entry carrying BOTH shapes reads as http (the reader
# tests `has("url")` first) while still holding a `command` the CLI would spawn:
# a session with its own writer, which is precisely the R1 defect this ticket
# exists to remove. Assert the absence.
jq -e '.mcpServers.mempalace | has("command") | not' "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
  && ok "no spawn-capable key survives the switch (R11 replace, not add)" \
  || nope "the switched entry still carries a command — the session would spawn its own writer"
restore_mempalace_registration gemini "${cap}"
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "restore returns the entry to its prior arrangement" || nope "restore did not return the prior arrangement"
restored="$(jq -c '.mcpServers.mempalace' "${TEST_HOME}/.gemini/settings.json")"
[ "${restored}" = "${cap}" ] \
  && ok "restored entry is byte-identical to the captured one" \
  || nope "restored entry differs from the capture"

# --- 8. Rollback restores what it is given ----------------------------------
echo ""
echo "Rollback primitives (R13, R14):"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["orig"]}}}' > "${TEST_HOME}/.gemini/settings.json"
cap_g="$(capture_mempalace_registration gemini)"
register_mempalace_mcp gemini "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" >/dev/null 2>&1
_switch_rollback "gemini" "null" "${cap_g}" "null" "null" >/dev/null 2>&1
[ "$(mcp_assistant_arrangement gemini)" = "stdio" ] \
  && ok "_switch_rollback restores an assistant named in its list" \
  || nope "_switch_rollback did not restore the assistant it was given"

# The defect this guards is that the CALLER must name the assistant whose own
# switch failed. register_mempalace_mcp is not atomic for Claude — `mcp remove`
# lands, the write may not — so an assistant tracked only on SUCCESS is left
# with no registration at all and, because the failed list stays empty, R14
# never reports it. Assert the caller's contract structurally: the assistant is
# added to the rollback list BEFORE the attempt, not after.
if awk '/^  for cli in \$present; do$/,/^  done$/' "${REPO_DIR}/scripts/lib/common.sh" \
   | grep -B2 'if register_mempalace_mcp' | grep -q 'applied="\$applied \$cli"'; then
  ok "the rollback list is built before the attempt, not after it succeeds"
else
  nope "an assistant is only tracked after a SUCCESSFUL switch — a failed one is abandoned"
fi

# --- 9. Every setup script wires the switch (R3, F5) -------------------------
echo ""
echo "Setup scripts switch their assistant (R3):"
missing=""
for cli in claude gemini copilot antigravity; do
  grep -q "offer_mcp_http_switch" "${REPO_DIR}/scripts/setup-${cli}-interactive.sh" || missing="${missing} ${cli}"
done
[ -z "${missing}" ] \
  && ok "all four setup scripts offer the switch" \
  || nope "setup scripts still stdio-only:${missing} — a later run would silently revert the switch"

# The revert is not hypothetical: `mempalace` is reserved, so the preservation
# helper deliberately drops an operator entry under that name and the framework
# rewrites it stdio-shaped. Assert the reservation still holds, since that is
# what makes wiring every setup mandatory rather than merely tidy.
grep -q 'MCP_RESERVED_NAMES=(mempalace' "${REPO_DIR}/scripts/lib/common.sh" \
  && ok "mempalace is still a reserved name (so setups must switch it themselves)" \
  || nope "mempalace is no longer reserved — re-check whether the setups still need to switch"

# --- 10. The daemon must OUTLIVE the reaper (#749) ---------------------------
# The defect this guards shipped once and was invisible to every static check:
# the wrapper starts an orphan-reaper thread that calls os._exit(0) when its
# parent is PID 1, which is the NORMAL state of a supervised daemon. It killed
# the daemon every ~60s with exit code 0 and no log line. Only watching the
# process live past the reaper's poll interval reveals it.
echo ""
echo "Daemon lifetime (R2, #749):"

# Hermetic half: the reaper must not be armed under the HTTP transport.
if grep -q 'if not _transport_is_http():' "${REPO_DIR}/scripts/lib/mempalace-http-wrapper.py"; then
  ok "the orphan reaper is not armed under --transport http"
else
  nope "the orphan reaper runs unconditionally — a supervised daemon will kill itself"
fi

# Behavioural half: probed skip, because CI has no mempalace venv. Quoting the
# reason rather than silently passing, per the tester skill.
if "${MEMPALACE_PYTHON}" -c 'import mempalace' >/dev/null 2>&1; then
  export MEMPALACE_CHROMA_PORT=8001   # the real one; we need a working handoff
  install_mcp_launcher >/dev/null 2>&1
  # ORPHAN IT. A daemon whose parent is this test shell is never orphaned, so
  # the reaper never fires and the assertion passes with the defect present —
  # verified. The double-fork makes the intermediate shell exit immediately,
  # reparenting the daemon to PID 1, which is exactly what a supervisor does.
  ( bash "$(mcp_launcher_installed_path)" >/dev/null 2>&1 & ) &
  sleep 1
  waited=0
  until curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1 \
        || [ "${waited}" -ge 40 ]; do sleep 2; waited=$((waited + 2)); done
  if curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1; then
    # The reaper polls every 5s; 20s is four intervals of margin.
    sleep 20
    if curl -sf --max-time 3 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1; then
      ok "an ORPHANED daemon still serves 20s later (four reaper intervals)"
    else
      nope "the orphaned daemon died within 20s — the reaper is killing it"
    fi
  else
    nope "the daemon never became healthy"
  fi
  pkill -f "transport http --host 127.0.0.1 --port ${MEMPALACE_MCP_PORT}" 2>/dev/null
else
  echo "  skip mempalace is not importable from ${MEMPALACE_PYTHON} — cannot"
  echo "       start a real daemon, so the behavioural lifetime check is skipped."
fi

# --- 11. Switch transaction, end-to-end (spec 0133 R2, R15) ------------------
# The transaction's "present" gate is `command -v`, so stub each tool on PATH;
# the stubs must exist for capture/arrangement/register to treat the four
# assistants as present without a real install.
echo ""
echo "Switch transaction, end-to-end (R2, R11-R15):"
mkdir -p "${TEST_HOME}/bin"
for c in claude gemini copilot agy; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "${TEST_HOME}/bin/${c}"
  chmod +x "${TEST_HOME}/bin/${c}"
done
export ORIG_PATH="${PATH}"
export PATH="${TEST_HOME}/bin:${PATH}"

# Four hermetic configs. claude starts with no mempalace entry (captures null);
# the other three start stdio-shaped, giving the transaction prior arrangements
# to restore to and to converge.
mkdir -p "${TEST_HOME}/.gemini/config" "${TEST_HOME}/.copilot"
echo '{"mcpServers":{}}' > "${TEST_HOME}/.claude.json"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["c"]}}}' > "${TEST_HOME}/.gemini/settings.json"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["p"]}}}' > "${TEST_HOME}/.copilot/mcp-config.json"
echo '{"mcpServers":{"mempalace":{"command":"bash","args":["a"]}}}' > "${TEST_HOME}/.gemini/config/mcp_config.json"
chmod 600 "${TEST_HOME}/.claude.json"

# Force a mid-transaction failure on the SECOND assistant switched. `present`
# is ordered claude, gemini, copilot, antigravity, so gemini is switched second.
# Making its config DIRECTORY unwritable passes the R12 floor (the file itself
# stays readable and writable) but makes write_json_config_secure's mktemp fail
# — the failure lands in the APPLY loop, after claude has already been switched,
# so the rollback must restore claude. gemini's backup_file silently no-ops
# (it writes into the same unwritable directory), which is harmless.
chmod 555 "${TEST_HOME}/.gemini"
out1="$(switch_assistants_to_http "test-token" 2>&1)"; rc1=$?
chmod 755 "${TEST_HOME}/.gemini"

[ "${rc1}" -ne 0 ] \
  && ok "a switch that fails partway returns non-zero" \
  || nope "the failed switch returned success"
case "${out1}" in
  *"gemini could not be switched"*) ok "the failing assistant is reported" ;;
  *) nope "no report of the gemini failure: ${out1}" ;;
esac
[ "$(mcp_assistant_arrangement claude)" = "none" ] \
  && ok "the FIRST assistant's entry is restored to its prior arrangement" \
  || nope "claude was not restored after the rollback"
jq -e '(.mcpServers | has("mempalace")) | not' "${TEST_HOME}/.claude.json" >/dev/null 2>&1 \
  && ok "the restored claude carries no orphan HTTP entry" \
  || nope "claude still carries a mempalace entry after the rollback"

# --- 11b. A repeated run converges a partial state (R15) ----------------------
# Leave one assistant (copilot) already switched to the shared daemon and the
# rest on their previous arrangement; the repeated run must find that partial
# state, converge every present assistant, and say it did.
register_mempalace_mcp copilot "test-token" >/dev/null 2>&1
out2="$(switch_assistants_to_http "test-token" 2>&1)"; rc2=$?
[ "${rc2}" -eq 0 ] \
  && ok "a repeated run converges (returns success)" \
  || nope "the repeated run did not converge: ${out2}"
case "${out2}" in
  *"found a partial state"*) ok "the repeated run reports the found partial state" ;;
  *) nope "the repeated run did not report a partial state: ${out2}" ;;
esac
all_http=1
for cli in claude gemini copilot antigravity; do
  [ "$(mcp_assistant_arrangement "$cli")" = "http" ] || all_http=0
done
[ "${all_http}" -eq 1 ] \
  && ok "every present assistant reaches the shared daemon" \
  || nope "not every assistant was converged to http"

# R3 (spec 0165): a non-parseable claude config reads as unknown, not none.
# Anchored here: .claude.json is http-shaped, the claude stub is on PATH, and
# nothing later in this file reads .claude.json.
echo 'not json' > "${TEST_HOME}/.claude.json"
[ "$(mcp_assistant_arrangement claude)" = "unknown" ] \
  && ok "a non-parseable claude config reads as unknown, not none (R3)" \
  || nope "non-parseable claude config misread as none"

export PATH="${ORIG_PATH}"

# --- 12. Null-capture restore leaves no orphan (spec 0133 R8) ----------------
echo ""
echo "Null-capture restore (R8):"
echo '{"mcpServers":{}}' > "${TEST_HOME}/.gemini/settings.json"
cap="$(capture_mempalace_registration gemini)"
[ "${cap}" = "null" ] \
  && ok "an assistant with no prior entry captures null" \
  || nope "expected a null capture, got: ${cap}"
register_mempalace_mcp gemini "test-token" >/dev/null 2>&1
[ "$(mcp_assistant_arrangement gemini)" = "http" ] \
  && ok "registration switches the empty assistant to http" \
  || nope "registration did not switch the empty assistant"
restore_mempalace_registration gemini "${cap}"
[ "$(mcp_assistant_arrangement gemini)" = "none" ] \
  && ok "a null-capture restore removes the http entry" \
  || nope "the null restore left an http entry behind"
jq -e '(.mcpServers | has("mempalace")) | not' "${TEST_HOME}/.gemini/settings.json" >/dev/null 2>&1 \
  && ok "no mempalace entry remains after the null restore" \
  || nope "an orphan mempalace entry survived the null restore"

# --- 13. status-mcp-server.sh branches (spec 0133 R4, R5, R6) ----------------
# A hermetic stand-in for the daemon so the status probe can be exercised
# without a real mempalace install: GET /healthz returns 200, POST /mcp returns
# the code given on the command line (401 passes the auth branch; anything else
# trips the NOT ENFORCED branch).
cat > "${TEST_HOME}/fake-mcp.py" <<'PY'
import http.server, socketserver, sys
port = int(sys.argv[1]); code = int(sys.argv[2])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/healthz':
            self.send_response(200); self.end_headers(); self.wfile.write(b'ok')
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        self.send_response(code); self.end_headers(); self.wfile.write(b'{}')
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", port), H) as s:
    s.serve_forever()
PY

# _start_fake_mcp — launch fake-mcp.py in the background and poll for readiness
# on /healthz up to 5s. Replaces fixed sleep 1 intervals to prevent CI flakes (spec 0182).
_start_fake_mcp() {
  local port="$1"
  local code="$2"
  "${MEMPALACE_PYTHON}" "${TEST_HOME}/fake-mcp.py" "${port}" "${code}" >/dev/null 2>&1 &
  local pid=$!
  local waited=0
  until curl -sf --max-time 1 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1 \
        || [ "${waited}" -ge 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done
  if ! curl -sf --max-time 1 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then
    echo "FATAL: fake-mcp.py failed to bind port ${port} within 5s (pid ${pid})" >&2
    kill "${pid}" 2>/dev/null
    exit 1
  fi
  echo "${pid}"
}

echo ""
echo "status-mcp-server.sh branches (R4, R5, R6):"

# --- 13a. NOT SERVING (R4) ----------------------------------------------------
# No server on the probe port: healthz fails, rc=1, and the probe prints the
# daemon log tail or a statement that no log exists. Assert the no-log arm.
mkdir -p "${HOME}/.mempalace"
rm -f "${HOME}/.mempalace/mcp-server.log"
out="$(bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] && ok "NOT SERVING exits non-zero" || nope "NOT SERVING exited ${rc}"
case "${out}" in
  *"NOT SERVING"*) ok "NOT SERVING is printed" ;;
  *) nope "no NOT SERVING line: ${out}" ;;
esac
case "${out}" in
  *"no log at"*) ok "a missing daemon log is stated, not assumed" ;;
  *) nope "no 'no log' statement: ${out}" ;;
esac

# The log-tail arm: with a log file present, the probe tails it.
printf 'probe log line\n' > "${HOME}/.mempalace/mcp-server.log"
out="$(bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
case "${out}" in
  *"probe log line"*) ok "the NOT SERVING probe tails the daemon log" ;;
  *) nope "the daemon log tail was not shown: ${out}" ;;
esac
rm -f "${HOME}/.mempalace/mcp-server.log"

# --- 13b. Authentication NOT ENFORCED (R5) ------------------------------------
# Daemon "serving" (healthz 200) but an unauthenticated /mcp returns 200, not
# 401: the probe must report authentication is NOT enforced and exit non-zero.
fake_pid="$(_start_fake_mcp "${MEMPALACE_MCP_PORT}" 200)"
# Precondition check: verify fake-mcp is actively serving /healthz so the non-401 test is not vacuous (spec 0182 R4)
curl -sf --max-time 1 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1 \
  && ok "fake-mcp /healthz is live (precondition verified, non-vacuous)" \
  || nope "fake-mcp /healthz is not reachable"
out="$(bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -ne 0 ] \
  && ok "an unauthenticated probe returning non-401 exits non-zero" \
  || nope "auth-not-enforced exited ${rc}"
case "${out}" in
  *"NOT ENFORCED"*) ok "authentication not enforced is reported" ;;
  *) nope "no NOT ENFORCED report: ${out}" ;;
esac

# --- 13c. Launcher drift (R6) -------------------------------------------------
# A daemon serving WITH auth enforced (healthz 200, /mcp 401) isolates the
# drift branch: the ONLY reason to exit non-zero is the launcher hash mismatch.
install_mcp_launcher >/dev/null 2>&1
launcher="$(mcp_launcher_installed_path)"
sed 's/^LAUNCHER_SOURCE_SHA=.*/LAUNCHER_SOURCE_SHA="deadbeef"/' "${launcher}" > "${launcher}.new"
mv "${launcher}.new" "${launcher}"
fake_pid="$(_start_fake_mcp "${MEMPALACE_MCP_PORT}" 401)"
out="$(bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -ne 0 ] \
  && ok "a drifted launcher exits non-zero" \
  || nope "launcher drift exited ${rc}"
case "${out}" in
  *"DRIFTED"*) ok "launcher drift is reported as DRIFTED" ;;
  *) nope "no DRIFTED report: ${out}" ;;
esac

# --- 13d. Listener owner (spec 0158) -----------------------------------------
# The owner check compares the process listening on the MCP port against the
# process the OS supervisor runs for the daemon. Both sides are fixed via
# environment so the branch under test is the ONLY difference from a healthy
# run (R3): MEMPALACE_MCP_EXPECTED_PID fixes the supervisor side,
# MEMPALACE_MCP_LISTENER_PID fixes the listener side. The launcher is
# re-installed first because 13c left its hash corrupted to deadbeef — the
# healthy-match case asserts exit 0, which requires EVERY probe check to pass,
# including the drift check (v2-F1).
install_mcp_launcher >/dev/null 2>&1
launcher="$(mcp_launcher_installed_path)"
fake_pid="$(_start_fake_mcp "${MEMPALACE_MCP_PORT}" 401)"

# Healthy match: listener PID == expected PID -> verified, exit 0.
out="$(MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=1234 \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "a listener matching the supervised process exits 0" \
  || nope "healthy owner exited ${rc}: ${out}"
case "${out}" in
  *"VERIFIED"*) ok "the matching owner is reported as VERIFIED" ;;
  *) nope "no VERIFIED report: ${out}" ;;
esac

# Usurped mismatch: listener PID != expected PID -> non-zero, naming both PIDs
# and the recovery action (R1, R5).
out="$(MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=5678 \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "a mismatched listener exits non-zero" \
  || nope "usurped owner exited ${rc}"
case "${out}" in
  *"USURPED"*) ok "a mismatched listener is reported as USURPED" ;;
  *) nope "no USURPED report: ${out}" ;;
esac
case "${out}" in
  *"PID 5678"*"PID 1234"*) ok "the usurped report names both PIDs" ;;
  *) nope "the usurped report does not name both PIDs: ${out}" ;;
esac
case "${out}" in
  *"Rotate"*) ok "the usurped report names the recovery action (rotate the token)" ;;
  *) nope "no recovery action named: ${out}" ;;
esac

# Unverifiable: expected process undeterminable (no supervisor unit loaded).
out="$(MEMPALACE_MCP_EXPECTED_PID='' MEMPALACE_MCP_LISTENER_PID=5678 \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "an undeterminable expected process exits non-zero" \
  || nope "unverifiable (no supervisor) exited ${rc}"
case "${out}" in
  *"UNVERIFIABLE"*) ok "an undeterminable expected process is reported as UNVERIFIABLE" ;;
  *) nope "no UNVERIFIABLE report: ${out}" ;;
esac

# Unverifiable: listener unidentifiable (forced by an empty
# MEMPALACE_MCP_LISTENER_PID — set-but-empty, not unset).
out="$(MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID='' \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "an unidentifiable listener exits non-zero" \
  || nope "unverifiable (no listener) exited ${rc}"
case "${out}" in
  *"UNVERIFIABLE"*) ok "an unidentifiable listener is reported as UNVERIFIABLE" ;;
  *) nope "no UNVERIFIABLE report: ${out}" ;;
esac

# --- 13e. Half-converted stdio assistant lockout (spec 0172 R1) ----------------
# When daemon is serving and an assistant is in stdio mode, status-mcp-server.sh
# must report LOCKED OUT and exit 1.
mkdir -p "${TEST_HOME}/.gemini"
cat > "${TEST_HOME}/.gemini/settings.json" <<'EOF'
{
  "mcpServers": {
    "mempalace": {
      "command": "python3",
      "args": ["/some/path/mempalace-http-wrapper.py"]
    }
  }
}
EOF
out="$(MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=1234 \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -ne 0 ] \
  && ok "status-mcp-server exits non-zero on half-converted stdio assistant (spec 0172 R1)" \
  || nope "status-mcp-server exited 0 on half-converted stdio assistant"
case "${out}" in
  *"LOCKED OUT"*) ok "status-mcp-server reports LOCKED OUT on stdio assistant" ;;
  *) nope "status-mcp-server did not report LOCKED OUT: ${out}" ;;
esac

# --- 13f. Fully converted http assistant (spec 0172 R2) -----------------------
cat > "${TEST_HOME}/.gemini/settings.json" <<'EOF'
{
  "mcpServers": {
    "mempalace": {
      "url": "http://127.0.0.1:41893/mcp",
      "headers": { "Authorization": "Bearer token123" }
    }
  }
}
EOF
out="$(MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=1234 \
  bash "${REPO_DIR}/scripts/status-mcp-server.sh" 2>&1)"; rc=$?
[ "${rc}" -eq 0 ] \
  && ok "status-mcp-server exits 0 on fully converted http assistant (spec 0172 R2)" \
  || nope "status-mcp-server exited non-zero on http assistant: ${rc} ${out}"
case "${out}" in
  *"http (shared daemon)"*) ok "status-mcp-server reports http (shared daemon)" ;;
  *) nope "status-mcp-server did not report http: ${out}" ;;
esac
rm -f "${TEST_HOME}/.gemini/settings.json"

kill "${fake_pid}" 2>/dev/null

# --- 14. _materialise_mcp_unit refuses unsubstituted placeholders (R7) -------
echo ""
echo "Unit materialisation refuses an unsubstituted placeholder (R7):"
# A template with only the two known placeholders materialises cleanly.
clean_tpl="${TEST_HOME}/clean.plist"
printf '%s\n' '__LAUNCHER_PATH__' '__MEMPALACE_HOME__/mcp-server.log' > "${clean_tpl}"
_materialise_mcp_unit "${clean_tpl}" "${TEST_HOME}/clean-out.plist" >/dev/null 2>&1 \
  && ok "a template with the known placeholders materialises" \
  || nope "a clean template was refused"
[ -e "${TEST_HOME}/clean-out.plist" ] \
  && ok "the clean unit was emitted" \
  || nope "clean materialisation did not produce a unit"

# A template carrying a placeholder this materialiser does not know must be
# refused, and must NOT emit a unit that would log to a literal path.
bad_tpl="${TEST_HOME}/bad.plist"
printf '%s\n' '__LAUNCHER_PATH__' '__MEMPALACE_HOME__/mcp-server.log' '__UNKNOWN_KEYS__' > "${bad_tpl}"
if _materialise_mcp_unit "${bad_tpl}" "${TEST_HOME}/bad-out.plist" >/dev/null 2>&1; then
  nope "an unsubstituted placeholder was materialised silently"
else
  ok "an unsubstituted placeholder is refused"
fi
[ -e "${TEST_HOME}/bad-out.plist" ] \
  && nope "a refused unit was still emitted" \
  || ok "a refused unit is not emitted (no literal-path unit ships)"

# --- 15. Launcher token path agrees with mcp_token_path (spec 0133 R9) -------
echo ""
echo "Launcher token-path derivation agrees with mcp_token_path (R9):"
install_mcp_launcher >/dev/null 2>&1
launcher="$(mcp_launcher_installed_path)"
# A palace whose dirname is reached through a SYMLINK and whose subdirectory
# does not yet exist. mcp_token_path's mkdir-parent fix creates the target,
# then `cd` resolves through the symlink; the launcher must compute the SAME
# key rather than fall back to the literal (unresolved) path. Without the fix
# the two derivations diverge and this assertion fails.
mkdir -p "${TEST_HOME}/real-palace"
ln -sf "${TEST_HOME}/real-palace" "${TEST_HOME}/palace-link"
export MEMPALACE_PALACE_PATH="${TEST_HOME}/palace-link/subdir/palace"
out="$(run_launcher_bounded)"
launcher_tok="$(printf '%s\n' "${out}" | sed -n 's/.*bearer token file not found: //p' | head -n1)"
tok_path="$(mcp_token_path)"
unset MEMPALACE_PALACE_PATH
[ -n "${launcher_tok}" ] \
  && ok "the launcher reports a token path when the palace parent is absent" \
  || nope "the launcher reported no token path: ${out}"
[ "${launcher_tok}" = "${tok_path}" ] \
  && ok "launcher token path == mcp_token_path when the palace parent is missing" \
  || nope "launcher '${launcher_tok}' != mcp_token_path '${tok_path}' — derivations diverged"

# --- 16. mcp_daemon_replace_process actually revokes the old token (spec 0139) ---
echo ""
echo "mcp_daemon_replace_process — token rotation revokes the old one (R1, R2):"

# Hermetic half, always runs: drive the helper against fake-mcp.py so its
# decision logic and its fail-visibly path are pinned in CI, which has no
# mempalace venv to exercise a real daemon.
#
# The accept predicate mcp_daemon_replace_process uses is POSITIVE — a 2xx on
# POST /mcp — not "neither 401 nor 000". Verified against the real mempalace
# handler while writing this section (mempalace/mcp_server.py
# `_request_rejected` / `do_POST`): a missing OR incorrect bearer both send
# exactly 401 (there is no reachable 403 branch from a loopback probe with no
# Origin header), and an authenticated non-notification method is answered
# `_send_json(200, response)`. The 401-vs-403 residual the PLAN flagged as an
# assumption to confirm does not exist on this codepath, so the helper
# accepts only a 2xx rather than widening the refusal set to guess at it
# (cold PLAN review on #880, non-blocking note #2).
#
# Runs against its OWN port, one above MEMPALACE_MCP_PORT, rather than the
# suite's main one: several curl POSTs against fake-mcp.py leave TIME_WAIT
# sockets behind on whatever port they hit (observed to linger ~20s on this
# box), and the behavioural half below binds MEMPALACE_MCP_PORT for a REAL
# daemon moments later. mcp-daemon-launcher.sh's own port preflight
# (":118-143") does not set SO_REUSEADDR, so it would see that residue as
# "already in use" and die — the daemon would then never become healthy for
# a reason that has nothing to do with what this section tests. Keeping the
# two halves on disjoint ports avoids the collision outright instead of
# sleeping it out.
HERMETIC_PORT=$((MEMPALACE_MCP_PORT + 1))
printf '%s\n' "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" > "${tok_file}"

fake_pid="$(_start_fake_mcp "${HERMETIC_PORT}" 200)"
out="$(MCP_DAEMON_REPLACE_DEADLINE=1 MEMPALACE_MCP_PORT="${HERMETIC_PORT}" mcp_daemon_replace_process 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -eq 0 ] \
  && ok "a process already accepting the current token returns 0" \
  || nope "an already-accepting process was not recognised: ${out}"
[ -z "${out}" ] \
  && ok "no restart is requested when the current token is already accepted" \
  || nope "unexpected output on the accept-immediately path: ${out}"

fake_pid="$(_start_fake_mcp "${HERMETIC_PORT}" 401)"
out="$(MCP_DAEMON_REPLACE_DEADLINE=1 MEMPALACE_MCP_PORT="${HERMETIC_PORT}" mcp_daemon_replace_process 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -ne 0 ] \
  && ok "a process that never accepts the current token returns non-zero" \
  || nope "a permanently-401 process was reported as replaced"
case "${out}" in
  *"did not accept the current token"*) ok "the deadline failure names the daemon and points at the log" ;;
  *) nope "no deadline-expiry diagnostic: ${out}" ;;
esac
# R5 (delta-01) is normative and this string is its only executable witness.
# A substring, not the paragraph, so a copy edit does not break the suite.
# The pair reads as one contract with the `[ -z "${out}" ]` assertion above,
# which is its negative control: silence when the current token is already
# accepted (no window opens — R5's carve-out), the disclosure whenever a
# replacement is attempted. Note this fixture runs under the randomised label
# com.mempalace.mcp-server-test-$$ with no unit loaded, so it takes the Darwin
# `else` branch and no process is in fact replaced — the disclosure covers
# that path too, by design (see the helper's comment).
case "${out}" in
  *"receives the newly minted token"*) ok "the replacement window is disclosed before the stop is issued (R5)" ;;
  *) nope "no replacement-window disclosure: ${out}" ;;
esac
# Second half of the same witness: spec 0149 delta-01 R3 makes a disclosure that names
# the risk without naming the evict-then-rotate recovery non-conformant, so the risk
# substring above cannot be the only thing asserted.
case "${out}" in
  *"Evict any squatter process"*"verify port"*"rotate the token"*) ok "the disclosure names the evict-then-rotate recovery (0149 delta-01 R3)" ;;
  *) nope "the disclosure names the risk without the evict-then-rotate recovery action: ${out}" ;;
esac

# Squatter eviction during replacement (spec 0149 delta-01 R6, R7, R8):
echo ""
echo "mcp_daemon_replace_process — squatter eviction and port verification (0149 delta-01 R6, R7, R8):"

# Test 1: Squatter answering 200 on the port does NOT trigger accept-immediately early return
fake_pid="$(_start_fake_mcp "${HERMETIC_PORT}" 200)"
out="$(MCP_DAEMON_REPLACE_DEADLINE=1 MEMPALACE_MCP_PORT="${HERMETIC_PORT}" \
  MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=5678 \
  MEMPALACE_MCP_EVICT_CMD="true" \
  mcp_daemon_replace_process 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -ne 0 ] \
  && ok "a squatter on the port is refused early accept-immediately even when answering 200" \
  || nope "squatter was falsely accepted immediately"
case "${out}" in
  *"squatter PID 5678 detected"*|*"failed to evict squatter"*) ok "squatter detection is reported" ;;
  *) nope "no squatter detection reported: ${out}" ;;
esac

# Test 2: Successful eviction allows verified daemon to be probed and succeed
fake_pid="$(_start_fake_mcp "${HERMETIC_PORT}" 200)"
evict_flag="${TEST_HOME}/evicted.flag"
rm -f "${evict_flag}"
out="$(MCP_DAEMON_REPLACE_DEADLINE=2 MEMPALACE_MCP_PORT="${HERMETIC_PORT}" \
  MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=5678 \
  MEMPALACE_MCP_EVICT_CMD="touch '${evict_flag}'; export MEMPALACE_MCP_LISTENER_PID=1234" \
  mcp_daemon_replace_process 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -eq 0 ] \
  && ok "evicting the squatter allows the verified daemon to succeed (R6)" \
  || nope "replacement failed after eviction: ${out}"
[ -f "${evict_flag}" ] \
  && ok "eviction command was executed (R6)" \
  || nope "eviction command was not executed"

# Test 3: Non-evictable squatter fails visibly without transmitting the token (R7)
fake_pid="$(_start_fake_mcp "${HERMETIC_PORT}" 200)"
out="$(MCP_DAEMON_REPLACE_DEADLINE=1 MEMPALACE_MCP_PORT="${HERMETIC_PORT}" \
  MEMPALACE_MCP_EXPECTED_PID=1234 MEMPALACE_MCP_LISTENER_PID=9999 \
  MEMPALACE_MCP_EVICT_CMD="true" \
  mcp_daemon_replace_process 2>&1)"; rc=$?
kill "${fake_pid}" 2>/dev/null
[ "${rc}" -ne 0 ] \
  && ok "failed eviction results in visible failure (R7)" \
  || nope "failed eviction reported success: ${out}"
case "${out}" in
  *"failed to evict squatter"*) ok "failure diagnostic names failed squatter eviction" ;;
  *) nope "missing eviction failure message: ${out}" ;;
esac

# Behavioural half: probed skip on the prerequisites the launcher actually
# needs, mirroring section 10 — CI has no mempalace venv, so quote the reason
# rather than silently passing.
#
# BOTH prerequisites, not just the import. mcp-daemon-launcher.sh's
# CHROMA_WAIT_SECONDS loop waits on ChromaDB and `die`s when it stays
# unreachable for MEMPALACE_MCP_CHROMA_WAIT, which this suite pins to 2s
# above — so a developer with mempalace installed and Chroma stopped used to
# get "the daemon never became healthy" and a red suite for a missing
# prerequisite, which is the opposite of the clean skip R4 claims. The probe
# below is that loop's own, verbatim (same endpoint, same --max-time), so it
# tests exactly what the launcher is about to test — the same reasoning
# _wait_bindable records for the port preflight.
#
# Scenario 2 (specs/0139) assumes an ALREADY-LOADED supervisor unit; that
# precondition is structurally untestable here — install_daemon_supervisor
# reads config/launchd/${label}.plist and no plist ships for a randomised
# test label (com.mempalace.mcp-server-test-$$). This half instead asserts
# the property scenario 2 demands — the running process gets replaced and the
# superseded token stops being honoured — without the supervisor precondition:
# it covers the process-replacement EFFECT, not the launchd-unit STATE. The
# "replace" step below is therefore kill-and-relaunch, not launchctl/systemctl:
# with no unit loaded there is no supervisor path to exercise, and naming it
# here keeps the next reader from looking for a launchctl path that isn't
# there.
echo ""
behav_chroma_host="127.0.0.1"
behav_chroma_port="8001"
if "${MEMPALACE_PYTHON}" -c 'import mempalace' >/dev/null 2>&1 \
   && curl -sf --max-time 2 \
        "http://${behav_chroma_host}:${behav_chroma_port}/api/v2/heartbeat" \
        >/dev/null 2>&1; then
  # The real ones; the launcher waits on them, and install_mcp_launcher below
  # bakes them into the materialised launcher — so they must be the endpoint
  # the gate just proved reachable, not a second guess at it.
  export MEMPALACE_CHROMA_HOST="${behav_chroma_host}"
  export MEMPALACE_CHROMA_PORT="${behav_chroma_port}"

  # _probe_code <token> — the bare HTTP status from POST /mcp bearing
  # <token>; same curl shape the helper's own probe uses, kept local to the
  # test so the exact code (not just accept/reject) can be asserted. No
  # `|| echo "000"` fallback: curl's own `-w '%{http_code}'` already writes
  # literal "000" whenever no HTTP response code was received, regardless of
  # curl's exit status — a fallback double-writes on that exact path
  # (verified: a refused connection captures "000000", not "000").
  #
  # The bearer travels in a curl config read from stdin rather than an `-H`
  # argv flag, matching the helper's probe — but deliberately as a SECOND
  # implementation of that shape, not a call into it: this probe must reach
  # the wire without going through the code it is used to judge, or a bug in
  # the lib's curl shape would hide itself behind the assertions meant to
  # catch it.
  _probe_code() {
    printf 'header = "Authorization: Bearer %s"\n' "$1" \
      | curl -K - -s -o /dev/null -w '%{http_code}' --max-time 3 \
        -X POST "http://127.0.0.1:${MEMPALACE_MCP_PORT}/mcp" \
        -H 'Content-Type: application/json' \
        -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null
  }

  # _wait_bindable — block until MEMPALACE_MCP_PORT is actually bindable, or
  # ~40s elapse (the same budget this section's own daemon health-wait already
  # uses below). Every curl probe against this port — section 13's
  # status-mcp-server.sh runs against fake-mcp.py, and every probe in this
  # section's own behavioural half — leaves a TIME_WAIT socket behind
  # (measured to linger ~20s on macOS loopback for a handful of connections;
  # a longer preceding run of probes, as happens right before the "replace"
  # relaunch below, can leave more of them). mcp-daemon-launcher.sh's own port
  # preflight (:118-143) does not set SO_REUSEADDR, so it sees that residue as
  # "already in use" and dies before ever binding — the daemon then never
  # becomes healthy for a reason that has nothing to do with what this
  # section tests. Same probe shape as that preflight, so it is testing
  # exactly what the launcher is about to test.
  _wait_bindable() {
    local w=0
    while ! "${MEMPALACE_PYTHON}" - "127.0.0.1" "${MEMPALACE_MCP_PORT}" <<'PROBE' >/dev/null 2>&1
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind((sys.argv[1], int(sys.argv[2])))
except OSError:
    sys.exit(1)
finally:
    s.close()
PROBE
    do
      w=$((w + 1))
      [ "${w}" -ge 40 ] && return 1
      sleep 1
    done
    return 0
  }

  install_mcp_launcher >/dev/null 2>&1
  rm -f "${tok_file}"
  A="$(mcp_token_read_or_create)"
  _wait_bindable || echo "  WARNING: port ${MEMPALACE_MCP_PORT} still not bindable after 40s — starting anyway."
  ( bash "$(mcp_launcher_installed_path)" >/dev/null 2>&1 & ) &
  sleep 1
  waited=0
  until curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1 \
        || [ "${waited}" -ge 40 ]; do sleep 2; waited=$((waited + 2)); done

  if curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1; then
    code_a="$(_probe_code "${A}")"
    case "${code_a}" in
      2??) ok "a fresh daemon accepts the token it started with (baseline, not vacuous)" ;;
      *) nope "the baseline probe with token A returned ${code_a}, not 2xx" ;;
    esac

    # The ticket's defect, asserted live rather than traced: rotate the
    # token file without replacing the process, and the OLD process is still
    # the one answering — it must refuse the new token.
    rm -f "${tok_file}"
    B="$(mcp_token_read_or_create)"
    code_b_before="$(_probe_code "${B}")"
    [ "${code_b_before}" = "401" ] \
      && ok "the new token is refused while the old process still runs (the shipped defect, R1)" \
      || nope "expected 401 for the new token pre-replace, got ${code_b_before}"

    if MCP_DAEMON_REPLACE_DEADLINE=2 mcp_daemon_replace_process >/dev/null 2>&1; then
      nope "mcp_daemon_replace_process reported success with no supervisor unit to replace"
    else
      ok "mcp_daemon_replace_process fails visibly when it cannot replace the process (R2)"
    fi

    # No supervisor unit is loaded in this harness (see the comment above), so
    # there is no launchctl/systemctl path to exercise. Replace the process
    # the only way available: kill and relaunch it directly.
    pkill -f "transport http --host 127.0.0.1 --port ${MEMPALACE_MCP_PORT}" 2>/dev/null
    sleep 1
    # The probes just above (baseline, defect assertion, the failed replace
    # attempt's own polling) all connected to this same port and leave fresh
    # TIME_WAIT residue of their own — wait it out again before rebinding.
    _wait_bindable || echo "  WARNING: port ${MEMPALACE_MCP_PORT} still not bindable after 40s — starting anyway."
    ( bash "$(mcp_launcher_installed_path)" >/dev/null 2>&1 & ) &
    sleep 1
    waited=0
    until curl -sf --max-time 2 "http://127.0.0.1:${MEMPALACE_MCP_PORT}/healthz" >/dev/null 2>&1 \
          || [ "${waited}" -ge 40 ]; do sleep 2; waited=$((waited + 2)); done

    code_b_after="$(_probe_code "${B}")"
    case "${code_b_after}" in
      2??) ok "the replaced process accepts the new token" ;;
      *) nope "the replaced process returned ${code_b_after} for the new token, expected 2xx" ;;
    esac
    code_a_after="$(_probe_code "${A}")"
    [ "${code_a_after}" = "401" ] \
      && ok "the replaced process refuses the superseded token (R1: rotation revokes it)" \
      || nope "the replaced process still answers the superseded token: ${code_a_after}"
  else
    nope "the daemon never became healthy — cannot exercise the rotation contract"
  fi
  pkill -f "transport http --host 127.0.0.1 --port ${MEMPALACE_MCP_PORT}" 2>/dev/null
  unset -f _probe_code
  unset -f _wait_bindable
else
  # Name WHICH prerequisite is missing: "skipped" without a reason is
  # indistinguishable from a silent pass, and the two have different fixes.
  if ! "${MEMPALACE_PYTHON}" -c 'import mempalace' >/dev/null 2>&1; then
    echo "  skip mempalace is not importable from ${MEMPALACE_PYTHON} — cannot start a"
    echo "       real daemon, so the behavioural rotation check is skipped."
  else
    echo "  skip ChromaDB is unreachable at ${behav_chroma_host}:${behav_chroma_port} — the"
    echo "       launcher will not start the daemon without it (ADR 0006), so the"
    echo "       behavioural rotation check is skipped. Run"
    echo "       scripts/start-chroma-server.sh to exercise this half."
  fi
fi

echo ""
echo "----------------------------------------"
echo "  passed: ${PASS}   failed: ${FAIL}"
[ "${FAIL}" -eq 0 ] || exit 1
