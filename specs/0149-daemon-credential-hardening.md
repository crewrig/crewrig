---
id: "0149"
slug: daemon-credential-hardening
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 913
version: 1.0.0
---

# Daemon credential-path hardening

## Intent

The residual credential-exposure items batched by issue #913 after the #880
lifecycle are closed or routed: the two proven-escapable weaknesses of the
anti-argv test guard are fixed, the rotation disclosure tells the operator
what to do about the window it names, the one deliberate bearer-in-argv
exception in the repository is marked as deliberate where it lives, and the
structural elimination of the replacement window — which requires the
upstream MemPalace server to accept an inherited listening socket — is
formally requested upstream instead of silently deferred.

## Requirements

1. The anti-argv guard in the daemon test suite SHALL match bearer-carrying
   argv flags case-insensitively; a lower-case `authorization: bearer` header
   passed through an argv flag SHALL fail the guard.
2. The guard's comment filter SHALL exclude only lines that are comments —
   anchored to the line-number prefix of the match output — so a genuine
   violation line carrying a trailing comment SHALL still fail the guard.
3. The replacement-window disclosure printed by the rotation path SHALL tell
   the operator the recovery action: rotate the token again if the window may
   have been claimed. A disclosure that names the risk without naming the
   recovery SHALL be non-conformant.
4. The one deliberate bearer-in-argv occurrence in the repository
   (`scripts/tests/test-setup-org-mcp.sh`, which asserts the org-MCP
   configuration shape on purpose) SHALL carry an adjacent comment naming it
   deliberate and pointing at this spec; a reader sweeping the repository for
   the pattern SHALL find the justification at the site. No other
   bearer-in-argv occurrence SHALL exist in `scripts/` at merge time.
5. The structural elimination of the replacement window SHALL be requested on
   the upstream MemPalace repository as an issue describing the bind-race
   window, the socket-inheritance capability needed (accepting a
   supervisor-held listening socket across process replacement), and the
   CrewRig context; the issue URL SHALL be recorded on issue #913 before it
   closes. Until upstream ships that capability, the R5 disclosure of spec
   0139 delta-01 SHALL remain the in-force treatment; no local proxy component
   SHALL be introduced.

## Scenarios

**Scenario:** a lower-case bearer header in argv fails the guard

Given the daemon test suite's anti-argv guard
When  a script line passes `-H "authorization: bearer $token"` through curl argv
Then  the guard reports the violation and the suite fails

**Scenario:** a violation with a trailing comment still fails the guard

Given a code line passing a bearer through an argv flag that also carries a trailing comment containing a colon-hash sequence
When  the guard's comment filter runs
Then  the line is not excluded and the guard reports the violation

**Scenario:** the disclosure names the recovery

Given an operator rotating the token on a machine with a running daemon
When  the replacement-window disclosure prints
Then  it names both the risk and the recovery action (rotate again if the window may have been claimed)

**Scenario:** the upstream request is traceable

Given issue #913 at closing time
When  a reader looks for the structural fix's status
Then  the issue carries the URL of the upstream MemPalace request describing the socket-inheritance capability

## Out of scope

- Implementing socket activation locally — a Linux-only
  `systemd-socket-proxyd` (or any proxy holding the port) adds a component
  and a platform asymmetry to mitigate a risk that is already disclosed and
  recoverable; rejected in favour of the upstream request (requirement 5).
- Any change inside the upstream MemPalace package; the upstream issue is the
  boundary of this spec.
- A repository-wide CI guard for bearer-in-argv patterns — one deliberate
  exception exists and the daemon suite's guard covers the credential-bearing
  surface; a CI-wide lint is not warranted by a single site.
- The runbook prose refresh — tracked as issue #914.

## Open questions
