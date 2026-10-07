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

1. Provisions a bearer token if one does not already exist for this palace
   — this happens **first**: the daemon launcher refuses to start without
   one, by design (`install_mcp_daemon`, `scripts/lib/common.sh:927`).
2. Installs the daemon launcher and starts it under the supervisor (launchd
   on macOS, systemd user unit on Linux), which waits for the daemon to
   report healthy.
3. Registers every supported CLI against it, over `--transport http`.
4. Re-runs the status check so the conversion is verified, not merely
   assumed.

**Already-running sessions keep their previous memory server until they
restart** — restart every open CLI session to actually pick up the change.
This is a separate, order-independent follow-up rather than a step in the
sequence above, so it is not depicted in the diagram below.

A single CLI can be converted on its own by re-running that CLI's own
`setup-*-interactive.sh`; the machine-wide, all-four-CLIs-or-none obligation
belongs only to `task mempalace:switch-http`.

![Four ordered steps to convert a machine to the shared MemPalace MCP HTTP daemon: provision the bearer token, install and start the daemon, register every CLI with the token, then verify status and auth.](../assets/mempalace-mcp/convert-machine.png)

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

### `Peer MCP writer active` (`-32001`) / Half-converted machine lockout

If an assistant receives an MCP error `-32001` (`Peer MCP writer active; this server is read-only for mutating tools`), the machine may be in a half-converted state where the shared MCP daemon holds the palace lease while the CLI remains configured in `stdio` mode.

The first diagnostic step is running:

```sh
task mempalace:status
```

`scripts/status-mcp-server.sh` diagnoses which assistant configurations are locked out (reporting `stdio (LOCKED OUT by shared daemon)` and exiting with code 1).

To resolve the misconfiguration across all installed assistants, run:

```sh
task mempalace:switch-http
```

## Session-start registration warnings

Setup registers a session check on every CLI (spec 0246). At session start
it reads the expected endpoint from the installed launcher — `MCP_HOST` and
`MCP_PORT` in `~/.crewrig/mcp-daemon-launcher.sh`, never the session's
environment — and sends one unauthenticated request to
`http://<host>:<port>/mcp`. It then classifies the CLI's user-level
`mempalace` registration and shows at most one warning, to you and to the
model. On Copilot CLI the warning reaches the model only, which relays it.
On Antigravity CLI it is sent to the model only, and whether any output can
reach you directly is unconfirmed, pending
[#1472](https://github.com/crewrig/crewrig/issues/1472). It never blocks the
session and never repairs anything.

It stays silent when the registration is correct, when no daemon is
installed, on a platform with no supported supervisor, and when the daemon is
down while the CLI sits on its stdio fallback. The exact wording lives in
`warningFor` (`scripts/lib/mempalace-registration.ts`). The event, the hook
file, and the channels each CLI offers are in
[row 8e of the CLI matrix](../cli-matrix.md).

Some channels rest on the vendor documentation shipped with the CLI, because
no live probe could run: Gemini CLI's model channel, and every Antigravity
CLI channel (spec 0246 delta-02 R7).
[#1472](https://github.com/crewrig/crewrig/issues/1472) tracks their live
confirmation. If a warning you expected never reached you or the model on
one of those CLIs, report it there.

| CLI | Registration file | Setup script |
|---|---|---|
| `claude` | `~/.claude.json` | `scripts/setup-claude-interactive.sh` |
| `gemini` | `~/.gemini/settings.json` | `scripts/setup-gemini-interactive.sh` |
| `copilot` | `~/.copilot/mcp-config.json` | `scripts/setup-copilot-interactive.sh` |
| `antigravity` | `~/.gemini/config/mcp_config.json` | `scripts/setup-antigravity-interactive.sh` |

### What each warning means

Restart the CLI session after every repair below: a running session keeps
the registration it started with.

| The warning says | Meaning | Repair |
|---|---|---|
| no `mempalace` registration | The file exists but has no `mempalace` entry. This session has no memory tools. | `task mempalace:switch-http` |
| no `mempalace` registration, naming a setup script | The registration file does not exist. `switch-http` would refuse this machine (see below). | Run the named `scripts/setup-<cli>-interactive.sh` |
| registered on stdio | The CLI launches its own memory server, and the daemon's lease refuses its writes. | `task mempalace:switch-http` |
| registered at another endpoint | The HTTP entry points elsewhere. The warning shows both endpoints, the registered one redacted (no user info, query, fragment, or control characters). | `task mempalace:switch-http` (read the launcher note below first) |
| unrecognised entry, naming `task mempalace:repair` | The file is strict JSON, but the entry is neither the HTTP shape (`url`/`serverUrl`) nor the stdio shape (`command`). | `task mempalace:repair` to see the options, then `task mempalace:repair -- --restore-backup` or `-- --reset-none`, then `task mempalace:switch-http` |
| not a single strict JSON document | The file fails the strictness test below. | Rewrite the file (next section), then `task mempalace:switch-http` if needed |
| a Gemini file with comments, naming `scripts/setup-gemini-interactive.sh` | `~/.gemini/settings.json` holds comments and its registration is not `ok`. `switch-http` and `repair` read the file with `jq`, which rejects comments: `switch-http` would refuse, and `repair` could not write it. | Run `scripts/setup-gemini-interactive.sh`. It rewrites the file as plain JSON and keeps the comments in a timestamped backup |
| the shared memory daemon is not answering | The daemon is installed, but its MCP endpoint gave neither an authentication refusal nor an MCP answer within 1 s. | `task mempalace:status`, then [Daemon not starting after boot](#daemon-not-starting-after-boot) |

When an entry carries both `url` and `serverUrl`, one value is compared:
`url`, or `serverUrl` when `url` is `null` or `false` (`.url // .serverUrl`,
the order `scripts/doctor-mempalace.sh` uses). An entry whose `url` is
correct is `ok` whatever its `serverUrl` says.

A project-level or local-level `mempalace` entry is not read. A Claude Code
session served by one can still warn about the user-level file.

### A file that is not strict JSON

The check reads each file with Node's own JSON parser and no `jq`. A file is
strict when all of these hold:

- it does not start with a UTF-8 byte order mark;
- it is valid UTF-8;
- it holds exactly one RFC 8259 JSON value, and that value is an object
  whose `mcpServers`, when present, is an object or `null`;
- objects and arrays nest at most 64 levels deep;
- no string or key holds an unpaired surrogate escape such as `"\ud800"`.

Everything else is not strict. That includes an empty or truncated file,
several concatenated documents, an `mcpServers` that is an array or a
scalar, `NaN`, `Infinity`, leading zeros, comments, trailing commas, and
trailing garbage.

`~/.gemini/settings.json` is the one exception for comments, because Gemini
CLI itself reads the file with its comments removed. For that file only,
`//` and `/* … */` comments outside strings are removed before every test
except the byte order mark and UTF-8 ones. Trailing commas are not removed,
by Gemini CLI or by the check, so a Gemini file with a trailing comma is not
strict.

The repair is to rewrite the named file as one strict document: remove the
byte order mark, merge the documents, make `mcpServers` an object, or delete
the comments. Restoring one
of the file's timestamped `<file>.bak.<YYYYmmdd-HHMMSS>` backups is another
way. A backup can predate a token rotation and carry a stale bearer, so run
`task mempalace:switch-http` after restoring one if the registration is not
`ok`.

`task mempalace:repair` is not the tool here. It picks its targets with the
`jq` reader that `task mempalace:status` uses. That reader accepts many such
files and answers *Nothing to repair*. For the same reason, status may still
print `http` for a file the check calls not strict. The two readers are
required to agree on strict files only (spec 0246 delta-01 R4). An empty or
truncated file is the exception: status reports it `unknown`, so
`task mempalace:repair -- --restore-backup` also works on it.

### A Gemini configuration with comments

Gemini CLI accepts comments in `~/.gemini/settings.json`, and so does the
check (spec 0246 delta-02). A commented file whose registration is `ok`
starts silently. When the registration is anything else, the warning names
`scripts/setup-gemini-interactive.sh` instead of `switch-http` or `repair`.
That setup rewrites the file as plain JSON and keeps the commented original
in a timestamped backup (spec 0214).

`task mempalace:status` still reports a commented file `unknown`, because its
`jq` reader rejects comments, and `switch-http` refuses every CLI while that
holds. Setup rewrites the file as plain JSON on every run, so comments come
back only after a hand edit or a restored backup.

### Gemini keeps the check and the registration in one file

On Gemini CLI, the check's hook entry and the `mempalace` registration both
live in `~/.gemini/settings.json`. If that file is deleted or replaced
wholesale, both go, and the check that would report the missing registration
goes with them. The session starts with no warning.

The backstop is the agent-side rule in `artifacts/core/rules/60-tools.md` →
*Session Start* → *Memory unavailable — say so, never skip silently* (spec
0246 R13). An agent with no `mempalace_*` tool tells you so before any work.
To repair, run `scripts/setup-gemini-interactive.sh`, which restores both,
then `task mempalace:switch-http` if status does not show `http`.

### Removing the check by hand

Setup has no opt-out: every setup run registers the check again (spec 0246
R11). To remove it until the next setup run, do one of the following.

- **Silence it on every CLI.** Delete `~/.crewrig/hooks/session-check/`. The
  hook command exits 0 with no output when the installed check is missing.
- **Remove a CLI's entry.** Delete the hook handler whose command contains
  `session-check/mempalace-session-check.ts`, in the file row 8e of the CLI
  matrix names. On Copilot CLI that is the whole file
  `~/.copilot/hooks/crewrig-mempalace-session-check.json`. On Antigravity
  CLI it is the named hook `crewrig-mempalace-session-check` in
  `~/.gemini/config/hooks.json`.

### Platforms

Setup registers the check on macOS and Linux only. On any other platform it
registers nothing, and it removes an entry an earlier run left behind (spec
0246 delta-01 R11). Gemini CLI and Copilot CLI run hook commands under
PowerShell 5.1 on Windows, and Antigravity CLI under `cmd.exe` (CLI matrix
row 37), so a POSIX hook command would fail at every session start there.
On those platforms only the agent-side rule applies.

### When `task mempalace:switch-http` refuses

The warnings name `switch-http` for one CLI, but the command works
machine-wide and all-or-nothing. Before changing any registration it checks
every CLI on `PATH` (`claude`, `gemini`, `copilot`, `agy`). One CLI's problem
therefore blocks the repair of another. Each refusal names the CLI at fault
and ends with *No assistant has been changed*. Fix that CLI, then run
`switch-http` again.

The refusals live in `switch_assistants_to_http`, in
`scripts/lib/common.sh`:

| Refusal | Lines | Repair |
|---|---|---|
| `<cli> is in an unrecognised arrangement` | 1644–1649 | `task mempalace:repair`, then re-run |
| `<cli> is installed but has no configuration file yet` | 1669–1675 | Run that CLI's own setup script once |
| `<cli>'s configuration is not both readable and writable` | 1676–1681 | None is named. Fix the file's owner or mode; a file holding the bearer stays `0600` |
| `<cli>'s configuration does not parse` | 1682–1686 | None is named. The same `jq -e .` gate makes the first refusal fire first, so this one is reached only if the file changes during the run. Restore a backup, then re-run |

The first refusal is checked across all CLIs before the other three.

### `switch-http` rewrites the launcher from your shell

Every `switch-http` run rewrites `~/.crewrig/mcp-daemon-launcher.sh` from
the invoking shell's `MEMPALACE_MCP_HOST` and `MEMPALACE_MCP_PORT`, or from
the defaults `127.0.0.1` and `41893` when they are unset
(`install_mcp_launcher`). It then registers every CLI on that endpoint. The
launcher is rewritten before the pre-flight above, so a refused run has
rewritten it too.

On a machine installed on a non-default port, a repair run from a shell
without those variables therefore moves the daemon and every registration to
the default port. Run `switch-http` with the variables you installed with.
To read the installed endpoint, which the check and status both use:

```sh
grep -E '^MCP_(HOST|PORT)=' ~/.crewrig/mcp-daemon-launcher.sh
```

## Replacing the bearer token

When you need to rotate the bearer token (for instance, after a suspected
leak), follow the four-step manual procedure below. Re-running the switch
script mints a fresh token, replaces the running daemon process so the new
token takes effect immediately, and re-registers every assistant CLI with the
new credential.

![Four ordered steps to replace the shared MCP daemon's bearer token: delete the old token file, run switch-mempalace-http.sh to mint a new token and replace the daemon process, delete each CLI's stale backup config that still holds the old token, then restart every running session.](../assets/mempalace-mcp/rotate-token.png)

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

   Finding no token file, this mints a fresh one, replaces the running
   daemon process under the supervisor (`mcp_daemon_replace_process`), and
   re-registers every CLI with the new credential. **This is the point at
   which the superseded token stops being honored** (spec 0139) — the switch
   script verifies that the new token is served before updating any CLI
   registration, and fails visibly rather than leave a running daemon
   honouring the stale credential.

   > [!WARNING]
   > **Replacement-window residual risk (spec 0139 delta-01 R5):** During the
   > brief process replacement window in step 2 (between terminating the old
   > daemon and binding the new listener), the supervisor port is temporarily
   > released. On an untrusted multi-user system, another local process could
   > theoretically bind the released port before the daemon relaunches; in that
   > event, the switch script fails when probing the listener.

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
