# Runbook — Shared MemPalace MCP HTTP server

<!-- crewrig-doc: published=false -->

Operational guide for the shared MemPalace MCP HTTP daemon introduced by
[ADR 0016](../adr/0016-shared-mempalace-mcp-http-server.md) (spec 0113,
tracked under issue #751 / spec 0136 for this documentation). The daemon
holds the palace writer lease on behalf of every converted CLI session —
Claude Code, Gemini CLI, Copilot CLI, and Antigravity CLI — so concurrent
sessions stop contending for it (MCP error `-32001`, *"Peer MCP writer
active"*). See the [CLI support matrix](../cli-matrix.md) rows 7c, 7d and 10
for the per-CLI registration shapes, the launch-time version guard, and the
setup-script wiring; this runbook does not restate those facts.

This daemon is **tier 2** of the two-layer coordination topology; **tier 1**
is the shared ChromaDB daemon documented in
[its own runbook](chroma-http-server.md) (ADR 0006). Tier 1 must already be
serving before tier 2 will start — the daemon waits for it on a bounded
deadline and refuses to start if it never becomes reachable.

## Prerequisites

- **MemPalace** installed at the pinned version:
  `pipx install 'mempalace>=3.6.0,<3.7'` (`task install-mempalace`).
- **The shared ChromaDB daemon (tier 1) already running** — see
  [the ChromaDB runbook](chroma-http-server.md). The launcher waits up to
  `MEMPALACE_MCP_CHROMA_WAIT` seconds (default `60`) before giving up.
- **Free TCP port `41893` on `127.0.0.1`**. Override with `MEMPALACE_MCP_PORT`
  (the launcher and the CLI-registration helper both honor it).

## Converting a machine

Converting is all-or-nothing across the four CLIs, run once per machine:

```sh
task mempalace:switch-http
```

1. Installs the supervisor unit (launchd on macOS, systemd user unit on
   Linux) and the daemon launcher.
2. Provisions a bearer token if one does not already exist for this palace.
3. Starts the daemon and waits for it to report healthy.
4. Registers every supported CLI against it, over `--transport http`.
5. Re-runs the status check so the conversion is verified, not merely
   assumed.

**Already-running sessions keep their previous memory server until they
restart** — restart every open CLI session to actually pick up the change.

A single CLI can be converted on its own by re-running that CLI's own
`setup-*-interactive.sh`; the machine-wide, all-four-CLIs-or-none obligation
belongs only to `task mempalace:switch-http`.

![Five ordered steps to convert a machine to the shared MemPalace MCP HTTP daemon: start the conversion task, the daemon starts and provisions a token, every CLI is registered with the token, the result is verified, then running sessions are restarted.](../assets/mempalace-mcp/convert-machine.png)

## Daily operations

| Action | Command |
|---|---|
| Convert / (re)install and start | `task mempalace:switch-http` |
| Check status | `task mempalace:status` (`bash scripts/status-mcp-server.sh`) |
| Restart | `task mempalace:stop` (`bash scripts/stop-mcp-server.sh`) — see caveat below |
| End the daemon | `task mempalace:uninstall-daemon` |

### Stopping is not uninstalling

Under the installed supervisor (launchd `KeepAlive=true` / systemd
`Restart=always`), `task mempalace:stop` is a **restart request**, not a
shutdown — the supervisor brings the daemon straight back within seconds.
Use it to pick up a config change or clear a wedged process, not to end the
daemon.

To actually end the daemon and remove its supervisor unit, run
`task mempalace:uninstall-daemon` instead. Run this **before** reverting the
change that introduced the daemon: the installed launcher lives outside the
repository, at `~/.crewrig/mcp-daemon-launcher.sh` (deliberately, so a
`git revert` cannot delete the program the supervisor's `ExecStart` names),
and the idle watchdog that reaps stale per-session servers is disabled for
this shared daemon by design — nothing else will stop it from autostarting
forever once the unit is orphaned.

### Logs

- **All platforms** — `~/.mempalace/mcp-server.log` (stdout + stderr of the
  supervised process).
- **macOS specifics** —
  `launchctl print gui/$(id -u)/com.mempalace.mcp-server` for the
  supervisor's own diagnostics.
- **Linux specifics** — `journalctl --user -u mempalace-mcp-server`.

### Checking it is actually serving, and actually authenticated

`bash scripts/status-mcp-server.sh` (`task mempalace:status`) is the
operator's only window onto liveness, onto whether the bearer check is
*actually* enforced, onto launcher drift, and onto which arrangement each of
the four CLIs is registered under — nothing else surfaces these once
sessions stop launching their own memory server. Checking `/healthz` alone
is not enough: it is served with `require_auth=False` and returns `200` in
every state, including one where authentication is silently off.

## Troubleshooting

### `Address already in use` on the daemon's port (default `41893`)

The launcher probes the port before starting and refuses immediately rather
than letting the supervisor retry forever against a port that will not free
itself:

```sh
netstat -anv | grep 41893
```

`lsof` can show nothing here even when the port is genuinely held — a system
service running under launchd is invisible to it without elevated
privileges, which is why `netstat` is the diagnostic of record. Either stop
the holder, or move the daemon to a different port and re-convert:

```sh
MEMPALACE_MCP_PORT=<port> task mempalace:switch-http
```

### Daemon not starting after boot

- **macOS** — `launchctl print gui/$(id -u)/com.mempalace.mcp-server` shows
  the last exit status; check `~/.mempalace/mcp-server.log` for the
  underlying error.
- **Linux** — `systemctl --user status mempalace-mcp-server` and
  `journalctl --user -u mempalace-mcp-server -n 200`.

A daemon that will not start because tier 1 is unreachable reports that
directly in the log, naming
[the ChromaDB runbook's](chroma-http-server.md) status command to check next.

## Replacing the bearer token

**No automated path exists yet.** The framework ships no `--rotate` flag or
script for this daemon; the manual procedure below is the only one that
exists today, and it is ordered so that the daemon never keeps serving under
the superseded token for longer than the single command in step 2 takes to
run.

![Four ordered steps to replace the shared MCP daemon's bearer token: delete the old token file, run switch-mempalace-http.sh to mint a new token and restart the daemon, delete each CLI's stale backup config that still holds the old token, then restart every running session.](../assets/mempalace-mcp/rotate-token.png)

1. **Delete the current token file.** Its path is derived from the palace
   path the same way the daemon derives it (`scripts/lib/common.sh`,
   `mcp_token_path`); from the repository root:

   ```sh
   rm -f "$(source scripts/lib/common.sh && mcp_token_path)"
   ```

2. **Re-run the conversion:**

   ```sh
   task mempalace:switch-http
   ```

   Finding no token file, this mints a fresh one, restarts the daemon under
   the new value — **the point at which the superseded token stops being
   honored** — and re-registers every CLI with the new token, all in the
   same run.

3. **Delete each CLI's stale backup config.** Step 2's re-registration backs
   up each assistant's config file with a timestamp suffix before
   overwriting it, and every backup still contains the *old* token:

   ```sh
   ls ~/.claude.json.bak.* ~/.gemini/settings.json.bak.* \
      ~/.copilot/mcp-config.json.bak.* ~/.gemini/config/mcp_config.json.bak.* \
      2>/dev/null
   ```

   Remove whichever of these exist on this machine.

4. **Restart every running CLI session** so it picks up the new token —
   exactly as after a first conversion, a session already running keeps
   using the value it started with.

To decommission a palace's token entirely instead of rotating it, remove its
whole server directory: `rm -rf "$(dirname "$(source scripts/lib/common.sh && mcp_token_path)")"`.
