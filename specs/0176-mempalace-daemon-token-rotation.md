---
id: "0176"
slug: mempalace-daemon-token-rotation
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 744
version: 1.0.0
---

# Add a token rotation flag for the shared MemPalace daemon

## Intent

Provide an automated CLI path (`--rotate`) in `scripts/switch-mempalace-http.sh` and a corresponding Taskfile task to rotate the shared MemPalace daemon's bearer token, replace the running daemon process, purge stale config backups containing the superseded token, and re-register all supported assistants with the new credential in a single command.

## Requirements

1. `scripts/switch-mempalace-http.sh` SHALL support a `--rotate` flag (and `-r` alias) to trigger bearer token rotation.
2. When `--rotate` is specified, `scripts/switch-mempalace-http.sh` SHALL remove the existing bearer token file at `mcp_token_path` before minting a new bearer token.
3. When `--rotate` is specified, `scripts/switch-mempalace-http.sh` SHALL purge timestamped backup files (`${config}.bak.*`) for each supported assistant configuration that contained the superseded token, preventing persistent credential residue.
4. `scripts/switch-mempalace-http.sh --rotate` SHALL ensure the running daemon process is replaced so that the newly minted token is honoured and the superseded token is rejected (in accordance with spec 0139).
5. `scripts/switch-mempalace-http.sh --rotate` SHALL re-register all present assistant configurations with the newly minted bearer token.
6. A Taskfile entry `mempalace:rotate-token` SHALL be provided to invoke `switch-mempalace-http.sh --rotate`.
7. The rotation instructions in `scripts/uninstall-mcp-daemon.sh` and related operational guidance SHALL be updated to reference `scripts/switch-mempalace-http.sh --rotate` / `task mempalace:rotate-token`.
8. An automated regression test SHALL verify that `--rotate` creates a new token, replaces the daemon process, updates assistant configurations, purges old backup files, and leaves the daemon honouring the new token.
9. The regression test SHALL be wired into CI per spec 0076.

## Scenarios

**Scenario:** Rotate token via `--rotate` flag
Given a running MemPalace HTTP daemon serving bearer token A and assistant configs registered with token A
When the operator runs `scripts/switch-mempalace-http.sh --rotate`
Then a new bearer token B SHALL be minted
And the daemon SHALL honour token B and reject token A
And all present assistant configs SHALL be updated to carry token B
And existing `.bak.*` backup files holding token A SHALL be removed

**Scenario:** Rotate token via Taskfile task
Given a running MemPalace HTTP daemon
When the operator executes `task mempalace:rotate-token`
Then `scripts/switch-mempalace-http.sh --rotate` is executed and the daemon token is rotated

## Out of scope

- Forcibly restarting external running assistant terminal sessions (a restart reminder is printed for the operator).
- Modifying the underlying upstream MemPalace python daemon code.

## Open questions

- None.
