---
id: "0172"
slug: mempalace-writability-visibility
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 989
version: 1.0.0
---

# MemPalace Writability Visibility and Half-Converted State Detection

## Intent

When a machine runs the shared MemPalace MCP HTTP daemon while one or more client assistants remain configured in the legacy stdio arrangement, those sessions are permanently locked out of writing by the daemon's exclusive lease. Today, this lockout is invisible during the session start sweep and is only discovered at the end of the session when mutating writes fail, causing data loss.

This specification makes the half-converted state visible and actionable: `scripts/status-mcp-server.sh` (`task mempalace:status`) flags stdio registrations as locked out by the active daemon and exits non-zero on mixed configurations; `scripts/doctor-mempalace.sh` and the daemon launcher warn of the lockout; and `artifacts/core/rules/60-tools.md` establishes `task mempalace:status` as the primary diagnostic step when receiving a write lock error `-32001` while amending the claim that peer locks are rare.

## Requirements

1. **R1. Mixed arrangement detection in `scripts/status-mcp-server.sh`.** When the shared MemPalace MCP HTTP daemon is serving and healthy, any installed assistant whose configuration is in `stdio` mode is permanently locked out of writing by the daemon's lease. `scripts/status-mcp-server.sh` SHALL report stdio registrations with an explicit lockout warning (e.g. `stdio (LOCKED OUT by running daemon)`) and SHALL exit non-zero (exit code 1) when any installed assistant is in `stdio` while the daemon is serving.
2. **R2. Clean verdict on fully-converted machine.** When the shared MemPalace MCP HTTP daemon is serving and healthy, and every installed assistant is in `http` mode (or `none`/`absent`), `scripts/status-mcp-server.sh` SHALL exit 0.
3. **R3. Half-converted detection in `scripts/doctor-mempalace.sh`.** `scripts/doctor-mempalace.sh` (`task mempalace:doctor`) SHALL report a failure when the shared MCP HTTP daemon is running while any assistant registration is in `stdio` mode, naming the remedy (`bash scripts/switch-mempalace-http.sh`).
4. **R4. Daemon launcher startup notice.** When `scripts/lib/mcp-daemon-launcher.sh` starts the daemon, it SHALL inspect assistant registrations and emit a notice on stderr if any installed assistant remains in `stdio` mode, directing the operator to `bash scripts/switch-mempalace-http.sh`.
5. **R5. Primary diagnostic step on write lock refusal.** `artifacts/core/rules/60-tools.md`, `~/.crewrig/system-context/friction-reporting-reference.md`, and `docs/runbooks/mempalace-mcp-server.md` SHALL document that upon receiving an MCP error `-32001` (`Peer MCP writer active; this server is read-only for mutating tools`), the agent or operator's first diagnostic action SHALL be executing `task mempalace:status` (`bash scripts/status-mcp-server.sh`) to identify whether the machine is in a half-converted state.
6. **R6. Qualification of write-lock rarity claim.** `artifacts/core/rules/60-tools.md` SHALL qualify its assertion regarding peer-held write locks: on a half-converted machine where the daemon is active but the assistant is configured as `stdio`, write lock refusal is permanent and total, rather than a transient peer collision.
7. **R7. Multi-CLI parity.** The detection and reporting of assistant arrangements SHALL operate symmetrically across all four supported assistants (`claude`, `gemini`, `copilot`, `antigravity`).
8. **R8. Automated test coverage.** Automated regression tests under `scripts/tests/` SHALL verify:
   - `scripts/status-mcp-server.sh` exits 1 and reports lockout when the daemon is serving and an assistant is in `stdio`.
   - `scripts/status-mcp-server.sh` exits 0 when the daemon is serving and all present assistants are in `http`.
   - `scripts/doctor-mempalace.sh` flags half-converted configurations.

## Scenarios

**Scenario:** Status check on a half-converted machine

```text
Given the shared MemPalace MCP HTTP daemon is serving and healthy
And an installed assistant (e.g. Claude or Gemini) is configured in stdio mode
When an operator or script runs scripts/status-mcp-server.sh
Then it reports the assistant as locked out by the running daemon
And it exits with code 1
```

**Scenario:** Status check on a fully-converted machine

```text
Given the shared MemPalace MCP HTTP daemon is serving and healthy
And all installed assistants are configured in http mode
When an operator or script runs scripts/status-mcp-server.sh
Then it reports all assistants in http (shared daemon) mode
And it exits with code 0
```

**Scenario:** Agent encounters write lock error and diagnoses via runbook

```text
Given an agent session configured in stdio receives error -32001 on a mutating call
When the agent follows the protocol in 60-tools.md and runs task mempalace:status
Then the output diagnoses that the running daemon holds the lease while the CLI is on stdio
And names bash scripts/switch-mempalace-http.sh to resolve the misconfiguration
```

**Scenario:** Daemon launcher detects stdio assistants at startup

```text
Given one or more installed assistants are configured in stdio mode
When scripts/lib/mcp-daemon-launcher.sh executes
Then it emits a warning on stderr identifying the stdio assistants
And directs the operator to run bash scripts/switch-mempalace-http.sh
```

## Out of scope

- Modifying upstream MemPalace python package distributions directly.
- Automatically mutating assistant configuration files during `status-mcp-server.sh` or daemon launch without operator invocation of `switch-mempalace-http.sh`.

## Open questions

- None.
