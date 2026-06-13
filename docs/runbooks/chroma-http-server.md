# Runbook — Shared ChromaDB HTTP server for MemPalace

<!-- crewrig-doc: published=false -->

Operational guide for the `chroma run` daemon introduced by
[ADR 0006](../adr/0006-chromadb-http-server.md) and tracked in
[issue #98](https://github.com/crewrig/crewrig/issues/98). The daemon owns
the single `PersistentClient` against `~/.mempalace/palace`; every CrewRig
CLI session connects to it via `chromadb.HttpClient` through
`scripts/lib/mempalace-http-wrapper.py`.

## Prerequisites

- **MemPalace** installed via `pipx` (`pipx install 'mempalace>=3.3.3,<3.4'`).
  The interpreter at `~/.local/pipx/venvs/mempalace/bin/python` ships the
  `chromadb` package the daemon needs.
- **`chroma` binary** available on `PATH`. The MemPalace pipx venv exposes
  it at `~/.local/pipx/venvs/mempalace/bin/chroma`; symlink it into a
  directory on `PATH` if needed.
- **Free TCP port `8001` on `127.0.0.1`**. Override with
  `MEMPALACE_CHROMA_PORT` if collision (the supervisor unit and the
  wrapper both honor the variable).
- **Supervisor unit installed**: `~/Library/LaunchAgents/com.mempalace.chroma-server.plist`
  (macOS) or `~/.config/systemd/user/mempalace-chroma-server.service` (Linux).
  `scripts/setup-claude-interactive.sh` and `scripts/setup-gemini-interactive.sh`
  install these automatically when the user opts into MemPalace.

## Daily operations

| Action | Command |
|--------|---------|
| Start  | `bash scripts/start-chroma-server.sh` |
| Stop   | `bash scripts/stop-chroma-server.sh` |
| Status | `bash scripts/status-chroma-server.sh` |
| Health | `curl -sf http://127.0.0.1:8001/api/v2/heartbeat` |

The supervisor (launchd `KeepAlive=true` / systemd `Restart=always`)
restarts the daemon within seconds of a crash; the manual `start` and
`stop` scripts are for ad-hoc operations and debugging.

### Logs

- **macOS / Linux** — `~/.mempalace/chroma-server.log` (stdout + stderr).
- **launchd specifics** — `launchctl print gui/$(id -u)/com.mempalace.chroma-server`
  for the supervisor's own diagnostics.
- **systemd specifics** — `journalctl --user -u mempalace-chroma-server`.

### Applying the raised file-descriptor limit to a running daemon

The shipped supervisor units declare an open-file floor of `65536`
(launchd `SoftResourceLimits`/`HardResourceLimits` → `NumberOfFiles`;
systemd `LimitNOFILE`). A fresh install inherits it automatically, but a
daemon already running under the old unit keeps its previous limit until
the supervisor re-execs it. Remediate an existing install without a host
restart:

- **macOS** — reload the launchd job so it re-reads the updated plist:

  ```sh
  launchctl bootout gui/$(id -u)/com.mempalace.chroma-server
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mempalace.chroma-server.plist
  ```

- **Linux** — reload the unit definition and restart the service:

  ```sh
  systemctl --user daemon-reload
  systemctl --user restart mempalace-chroma-server
  ```

Verify the new limit took effect by inspecting the running daemon's
open-file limit:

- **macOS** — `launchctl print gui/$(id -u)/com.mempalace.chroma-server`
  reports the job's resource limits; look for the `number of files`
  entry under the `inherited limits` / `hard/soft limits` section.

- **Linux** — read the kernel's per-process limit:

  ```sh
  cat /proc/"$(pgrep -f 'chroma run')"/limits | grep 'Max open files'
  ```

Both should report `65536` (or higher) once the reload completes.

## Migrating from the legacy `PersistentClient` setup

If you upgraded a working CrewRig install across the #98 boundary:

1. **Stop every running agent CLI session.** Any process still holding a
   `PersistentClient` against `~/.mempalace/palace` will collide with the
   new daemon.
2. **Re-run the setup script for each CLI you use:**

   ```sh
   bash scripts/setup-claude-interactive.sh
   bash scripts/setup-gemini-interactive.sh
   bash scripts/setup-copilot-interactive.sh   # if Copilot is configured
   ```

   The setup script installs the supervisor unit, starts the daemon,
   runs the health check, and rewrites the MCP entry to point at
   `scripts/lib/mempalace-http-wrapper.py`. The order matters: the
   daemon comes up before any MCP entry is written (see ADR 0006 →
   *First-launch ordering*).

3. **Verify** with `bash scripts/status-chroma-server.sh` and by starting
   one CLI session — the first MemPalace MCP call should succeed without
   the wrapper printing a fail-loud error.

The on-disk palace format is unchanged; no data migration is required.

## Troubleshooting

### `Address already in use` on port 8001

Another process holds the port. Identify it and either stop it or
override the daemon port:

```sh
lsof -iTCP:8001 -sTCP:LISTEN
# Either stop the offender, or pick a free port:
export MEMPALACE_CHROMA_PORT=8011
# Re-run the setup script so the unit file and the wrapper both pick
# up the new port.
```

### Daemon not starting after boot

- **macOS**: `launchctl print gui/$(id -u)/com.mempalace.chroma-server`
  shows the last exit status. Check `~/.mempalace/chroma-server.log` for
  the underlying error (most often a missing `chroma` binary on `PATH`).
- **Linux**: `systemctl --user status mempalace-chroma-server` and
  `journalctl --user -u mempalace-chroma-server -n 200`.

### MCP wrapper exits with code 1

The wrapper's fail-loud contract: it exits non-zero when
`HttpClient.heartbeat()` does not answer at startup. The error message
prints the host, port, expected unit name, and the restart command. Run
that command, then restart the agent CLI session — the MCP server
re-spawns on the next invocation.

If the wrapper exits 1 even though `curl http://127.0.0.1:8001/api/v2/heartbeat`
succeeds, check:

- The `MEMPALACE_CHROMA_HOST` and `MEMPALACE_CHROMA_PORT` env vars
  inherited by the agent CLI match the daemon's actual bind address.
- The `chromadb` package version in the MemPalace pipx venv is
  compatible with the `chroma run` server version. ADR 0006 →
  *Open risks #3* documents the pin requirement.

### Recovering from a corrupt palace

If a pre-#98 corruption is suspected (zombie locks in `acquire_write`,
missing `index_metadata.pickle`, stuck `embeddings_queue`):

```sh
bash scripts/stop-chroma-server.sh
mempalace rebuild-from-sqlite        # or the project's documented recovery cmd
bash scripts/start-chroma-server.sh
bash scripts/status-chroma-server.sh
```

A successful rebuild + health check restores normal operation. Capture
the symptom in a logbook comment on issue #98 if it recurs after the
HTTP-server migration — the whole point of #98 is to make this class of
corruption impossible.
