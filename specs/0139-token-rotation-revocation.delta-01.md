---
id: "0139"
slug: token-rotation-revocation
status: implemented
complexity: small
interaction-mode: MINIMAL
related-issue: 880
version: 1.1.0
---

# Token rotation revokes the old token — delta 01

## ADDED

1. **New requirement (R5) — replacement-window risk disclosure.** The rotation
   path SHALL disclose, in its user-facing output at the point the daemon
   process is replaced, the residual risk that another local process may claim
   the released port during the replacement window and receive the newly
   minted token from the first probe that reaches it. The disclosure SHALL
   mirror the existing post-uninstall port-release warning. A rotation that
   replaces the process silently, leaving the operator unaware of the window,
   SHALL be non-conformant; a machine where the window is eliminated
   altogether (the port never released across the replacement) satisfies this
   requirement with no disclosure needed.

Scenario:

**Scenario:** the replacement window is disclosed during rotation

Given an operator runs the rotation procedure on a machine with a running daemon
When  the switch replaces the daemon process
Then  the command output names the replacement-window risk and the fact that whoever holds the port receives the newly minted token

Out-of-scope addition (extends the parent's list):

- Eliminating the replacement window itself — holding the socket across the
  process replacement (supervisor socket-activation or equivalent) — is out of
  scope for this ticket and tracked as a security-hardening follow-up issue,
  together with sweeping the remaining bearer-in-argv call sites.

Rationale (non-normative): the security pass on the implementation PR (#897,
iteration 1) found that the parent spec anticipates the fail-closed case ("no
process accepts") but not the impostor case ("another process accepts"): during
the kill-to-relaunch gap the port is fully released, and a local process that
wins the bind race both defeats the rotation's purpose and receives the fresh
credential. The structural fix is beyond this ticket; the repository's
precedent (the post-uninstall WARNING in `scripts/uninstall-mcp-daemon.sh`)
treats this class of risk as named and disclosed rather than silent. This
delta makes that disclosure normative for the rotation path.

## MODIFIED

## REMOVED
