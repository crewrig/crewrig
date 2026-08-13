---
id: "0139"
slug: token-rotation-revocation
status: approved
complexity: small
interaction-mode: MINIMAL
related-issue: 880
version: 1.0.0
---

# Token rotation revokes the old token

## Intent

An operator who follows the printed token-rotation procedure ends up with a
daemon that actually refuses the superseded token — the procedure's whole
purpose. Today the printed step 2 claims the switch script "restarts" the
daemon while the running process keeps honouring the old token until something
replaces it; the operator believes a suspected-leaked credential is dead while
it still works.

## Requirements

1. After the printed rotation procedure completes, the running MemPalace MCP
   daemon SHALL refuse the superseded bearer token and SHALL accept the newly
   minted one. A rotation that leaves the old token honoured is a failure of
   the procedure, not an operator error.
2. `scripts/switch-mempalace-http.sh` SHALL leave the running daemon honouring
   the current value of the token file when it exits successfully — including
   when the supervisor unit was already loaded before the run (the case where
   the daemon installation currently skips any process replacement). When the
   daemon process cannot be replaced, the script SHALL fail visibly rather
   than report success over a stale credential.
3. Every behaviour claim in the printed rotation procedure
   (`scripts/uninstall-mcp-daemon.sh`) SHALL be true of the scripts it names
   at the moment it ships: the procedure SHALL state when the new token takes
   effect (only once the daemon process has been replaced), and the inline
   description of each step SHALL NOT assert a behaviour the named script
   does not have.
4. An automated test SHALL assert the rotation contract end to end — provision
   a daemon, capture the token, rotate, then probe the daemon and require the
   old token refused and the new one accepted. The test SHALL follow the
   repository's behavioural-test conventions (isolated `HOME`, non-production
   port, clean skip when prerequisites are absent) and SHALL NOT mutate the
   machine's real supervisor state or live palace.

## Scenarios

**Scenario:** rotation revokes the superseded token

Given a running daemon serving bearer token A
When  the operator performs the printed rotation procedure and it mints token B
Then  a probe presenting token A is refused and a probe presenting token B is accepted

**Scenario:** switch over an already-loaded supervisor unit takes effect

Given the supervisor unit is already loaded and the daemon process holds token A
When  `scripts/switch-mempalace-http.sh` completes successfully after token B was minted
Then  the running daemon honours token B and no longer honours token A

**Scenario:** the daemon cannot be replaced

Given the supervisor refuses or fails to replace the daemon process during a switch
When  `scripts/switch-mempalace-http.sh` reaches its end
Then  the script fails visibly and does not report a completed switch over the stale credential

## Out of scope

- A `--rotate` command-line flag or any new rotation tooling — tracked as
  issue #744, which must not inherit this defect but is not implemented here.
- Automatic token-file watching or hot reload (a supervisor `WatchPaths`-style
  mechanism); replacement of the daemon process is the accepted revocation
  boundary.
- Rotation or cleanup of the timestamped `.bak` files named by the printed
  procedure's step 3 (the wording stays; the mechanism is unchanged).
- The spec-0136 runbook prose that inherited the false claim — it cites the
  scripts, and the scripts becoming truthful is what this spec fixes; a
  runbook wording refresh, if needed, is a documentation follow-up.

## Open questions
