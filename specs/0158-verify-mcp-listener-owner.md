---
id: "0158"
slug: verify-mcp-listener-owner
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 745
version: 1.0.0
---

# Verify the MCP daemon listener's owner

## Intent

An operator who consults the shared MCP daemon's status must be able to tell
whether the process answering on the MCP port is the daemon the supervisor
launched, or an impostor that claimed the port first and now receives the real
bearer token from every registered assistant. Today those two are
indistinguishable: an impostor that answers the health probe and refuses
unauthenticated requests answers every check a healthy daemon would. After
this spec, the status probe verifies the port's owner against the process the
OS supervisor actually runs for the daemon, and reports a mismatch instead of
silent health.

## Requirements

1. When the shared MCP daemon appears to be serving, the status probe SHALL
   verify the process listening on the MCP port against the process the OS
   supervisor launched for the daemon, and SHALL exit non-zero, naming both
   PIDs, when they differ.
2. The expected process SHALL be identified through the OS supervisor — the
   launchd job or the systemd unit — and SHALL NOT be taken from a file or
   artifact that a same-uid local process could write; a probe that trusts a
   falsifiable source to name the expected process SHALL be non-conformant.
3. A hermetic test suite SHALL be able to fix the expected process without a
   real supervisor, and SHALL exercise the owner check with that fixed
   identity in every branch where the port is served, so the branch under
   test is the only difference from a healthy run.
4. When the daemon appears to be serving but the expected process cannot be
   determined — no supervisor unit loaded, or no running process reported —
   or the listening process cannot be identified, the probe SHALL report the
   listener's owner as unverifiable and SHALL exit non-zero rather than
   presenting the daemon as healthy.
5. The usurped-listener report SHALL name the recovery action — rotate the
   bearer token, which the impostor may have received — mirroring the
   disclosure the uninstall path already prints; a report that flags the
   impostor without naming the recovery SHALL be non-conformant.

## Scenarios

**Scenario:** A usurped listener is reported

```text
Given the daemon appears to be serving
And the process listening on the MCP port is not the process the supervisor
  launched
When  the status probe runs
Then  it reports a usurped listener, naming both the listener's PID and the
  expected PID
And  it exits non-zero
```

**Scenario:** The owner is unverifiable

```text
Given the daemon appears to be serving
And no expected process can be determined — no supervisor unit loaded, or no
  running process reported
When  the status probe runs
Then  it reports the listener's owner as unverifiable
And  it exits non-zero
```

**Scenario:** A healthy daemon is verified

```text
Given the daemon appears to be serving
And the process listening on the MCP port is the process the supervisor
  launched
When  the status probe runs
Then  it reports the owner as verified
And  it does not report a usurped listener
```

**Scenario:** The recovery action is named

```text
Given the status probe has reported a usurped listener
Then  the report names rotating the bearer token as the recovery action
```

## Out of scope

- **Preventing the port claim.** The structural elimination of the
  replacement window — accepting a supervisor-held listening socket across
  process replacement — is already requested upstream by spec 0149
  requirement 5; this spec only detects the claim.
- **The post-uninstall window.** The operator-error path after
  `uninstall-mcp-daemon.sh` is already covered by the explicit warning that
  script prints; this spec does not change it.
- **Any change to the daemon, its launcher, the supervisor units, or the
  setup scripts.** This spec touches the status probe and its test suite
  only.
- **Extending the owner check to other tooling** (for example
  `doctor-mempalace.sh`), which stays as-is.

## Open questions

None.
