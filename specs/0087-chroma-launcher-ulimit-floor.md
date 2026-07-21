---
id: "0087"
slug: chroma-launcher-ulimit-floor
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 587
version: 1.0.0
---

# Chroma ad-hoc launcher file-descriptor floor

## Intent

A developer who brings up the shared MemPalace Chroma daemon by hand —
through `scripts/start-chroma-server.sh`, the ad-hoc path used outside the
installed launchd/systemd supervisor — gets a daemon with the same
open-file headroom as a supervisor-launched one, so heavy concurrent
multi-session use through that path no longer risks the file-descriptor
exhaustion that spec 0029 already closed off for the supervised path.

## Requirements

1. `scripts/start-chroma-server.sh` SHALL raise the daemon process's
   open-file soft limit to at least 10240 immediately before launching the
   daemon.
2. The floor SHALL be overridable through a dedicated environment
   variable, so an operator can raise it further without editing the
   script.
3. When the raise fails (e.g. the host's hard ceiling is fixed below the
   requested floor), the script SHALL emit a warning to standard error
   naming the ceiling that remains in effect, and SHALL continue
   launching the daemon rather than aborting.
4. The raised limit SHALL scope to the daemon process the script
   launches; it SHALL NOT alter the limit of the invoking shell or of any
   other process.
5. `docs/runbooks/chroma-http-server.md` SHALL state that the manual
   launch path (`scripts/start-chroma-server.sh`) also carries a raised
   open-file floor, next to the existing documentation of the supervised
   path's floor.
6. A regression test SHALL assert that `scripts/start-chroma-server.sh`
   raises the open-file limit before it invokes the `chroma run` binary,
   so a future refactor cannot silently drop the floor.

## Scenarios

**Scenario:** Manual start raises the floor before the daemon binds

Given a host where `scripts/start-chroma-server.sh` has never been run
When an operator runs `bash scripts/start-chroma-server.sh`
Then the daemon process it starts reports an open-file soft limit of at
least 10240
And the daemon subsequently accepts concurrent connections from multiple
active sessions without an `EMFILE` failure

**Scenario:** Host hard ceiling is fixed below the requested floor

Given a host whose file-descriptor hard ceiling is fixed below 10240
(e.g. an unprivileged container default)
When `scripts/start-chroma-server.sh` attempts to raise the limit
Then the script prints a warning to standard error naming the ceiling
that remains in effect
And the script still starts the daemon successfully

**Scenario:** Concurrent multi-session load stays within the raised
floor's headroom

Given several concurrent active MemPalace sessions each holding a pool of
connections to a daemon started through the ad-hoc script
When the daemon has been running under sustained concurrent load
Then the daemon's open file-descriptor count stays below the raised floor
And no `mempalace_add_drawer` or `mempalace_list_drawers` call fails with
the palace-not-found symptom caused by descriptor exhaustion

## Out of scope

- Raising or altering the file-descriptor limits declared in the shipped
  supervisor configurations (`config/launchd/com.mempalace.chroma-server.plist`,
  `config/systemd/mempalace-chroma-server.service`) — already normatively
  required by spec 0029 (R1-R3, realized by PR #303, merged) and untouched
  here.
- Bounding or pooling the per-session client-side connection count against
  the daemon — the companion client-side fix tracked separately in issue
  #588.
- Reaping orphaned wrapper processes or the connections they hold open —
  already covered by spec 0029 (R4-R5).
- Migrating `scripts/start-chroma-server.sh` to be supervised by launchd or
  systemd instead of run ad hoc, or otherwise unifying the two launch
  paths architecturally.
- Any change to the ChromaDB version, the on-disk index format, or the
  daemon's bind host, port, or transport.

## Open questions

- None. Grounding against the current repository state (the script's
  actual `nohup` invocation, the existing sibling regression test
  `scripts/tests/test-chroma-fd-limits.sh`, and spec 0029's realized
  scope) surfaced no anomaly to resolve.
