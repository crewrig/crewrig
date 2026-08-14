---
id: "0149"
slug: daemon-credential-hardening
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 951
version: 1.1.0
---

# Daemon credential-path hardening — delta 01

Rationale (non-normative): Spec 0149 Requirement 3 and spec 0139 delta-01
Requirement 5 originally directed the operator to "rotate the token again" if
the replacement window between stopping and relaunching the MCP daemon was
claimed by a local squatter process. However, re-running rotation without
evicting the squatter re-runs the same probe path (`scripts/lib/common.sh`,
`mcp_daemon_replace_process`): minting a new token and immediately probing
`host:port`. Because an impostor listening on that port answers `2xx` to the
probe, `mcp_daemon_replace_process` treats it as a successful replacement,
hands the freshly minted credential directly to the squatter, and never
discloses or resolves the usurpation. Recovery must therefore be
**evict-then-rotate**: identify the process occupying the port, terminate it,
verify that the port is actually released, and only then allow the supervised
daemon to bind and receive the new token.

## ADDED

1. **Requirement 6 — Eviction before token provisioning on replacement.**
   When `mcp_daemon_replace_process` replaces the running daemon process, it
   SHALL verify that any process listening on `${host}:${port}` is the
   expected supervised daemon process before probing it with the newly minted
   token. If a squatter process (a process whose PID does not match the
   supervised daemon PID) is detected holding the port, the replacement path
   SHALL terminate the squatter process, verify that the port is freed, and
   allow the supervisor to start the legitimate daemon before issuing probes
   carrying the fresh token.

2. **Requirement 7 — Port release verification.**
   Before probing with the new credential, the replacement path SHALL verify
   that the port is either cleanly released or bound exclusively by the
   supervised daemon process. If the port remains occupied by an unauthorized
   process or if the squatter cannot be evicted, the replacement path SHALL fail
   visibly and SHALL NOT transmit the new token over the unverified socket.

3. **Requirement 8 — Hermetic eviction testability.**
   The test suite SHALL be able to exercise the squatter eviction and port-free
   verification paths hermetically using simulated listener and supervisor PID
   controls without requiring a real OS supervisor or destructive system kills.

**Scenarios:**

**Scenario:** Evicting a squatter during daemon process replacement

Given a local process is squatting the daemon port `${host}:${port}`
And the squatter process PID differs from the supervisor-managed daemon PID
When  `mcp_daemon_replace_process` runs
Then  the squatter process is terminated
And   the port is verified to be released before the new daemon binds
And   the fresh token is only probed against the verified daemon

**Scenario:** Failing safely when a squatter cannot be evicted

Given a squatter process is bound to `${host}:${port}`
And the squatter process cannot be terminated or the port remains occupied
When  `mcp_daemon_replace_process` runs
Then  it fails visibly with an error
And   it does not send the newly minted token to the unverified port

## MODIFIED

- **Requirement 3:**

Original text:
> 3. The replacement-window disclosure printed by the rotation path SHALL tell
> the operator the recovery action: rotate the token again if the window may
> have been claimed. A disclosure that names the risk without naming the
> recovery SHALL be non-conformant.

Replacement text:
> 3. The replacement-window disclosure printed by the rotation path SHALL tell
> the operator the recovery action: evict any squatter process bound to the
> port, verify that the port is released, and only then rotate the token. A
> disclosure that names the risk without naming the evict-then-rotate recovery
> action SHALL be non-conformant.

- **Scenario:**

Original text:
> **Scenario:** the disclosure names the recovery
>
> Given an operator rotating the token on a machine with a running daemon
> When  the replacement-window disclosure prints
> Then  it names both the risk and the recovery action (rotate again if the window may have been claimed)

Replacement text:
> **Scenario:** the disclosure names the evict-then-rotate recovery
>
> Given an operator rotating the token on a machine with a running daemon
> When  the replacement-window disclosure prints
> Then  it names both the risk and the evict-then-rotate recovery action (evict the squatter, verify port release, then rotate the token)

## REMOVED
