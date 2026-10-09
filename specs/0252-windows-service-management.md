---
id: "0252"
slug: windows-service-management
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1330
version: 1.0.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Sub-spec D of the `large`-tier ticket #1231, row D of the architect decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md`, under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md` (requirements
27–38): this spec-PR and its implementation pull requests target
`release/1231-ts-migration`, "shipped" means merged there, not reached `main`, and
the base ref wherever a protocol names `main` is `origin/release/1231-ts-migration`
(requirement 34). Discharges parent requirements 9, 13, 14, 17, 19 and 20 for the
nine scripts of requirement 1, and applies requirements 2, 4, 5, 6, 8 and 23 to
them. Depends on sub-spec C2, `specs/0248-worktree-git-guard-typescript.md` (the
forwarding-shim shape and the `windows-latest` job conventions), on sub-spec C3,
`specs/0247-mempalace-transcript-hook-typescript.md` (the same conventions, and
`scripts/lib/usage-store/mcp.js` and `scripts/lib/tls-env.ts` as it left them), on
sub-spec C1, `specs/0243-usage-capture-hooks-typescript.md` (the entry form of its
requirement 5), on sub-spec A2,
`specs/0240-runtime-foundations-shared-ts-modules.md` with its `delta-01` (the
shared modules, the Node.js floor guard and the `windows-latest` template), and on
sub-spec G1a, `specs/0250-component-build-core-typescript.md` (the model for a
shim over a coexisting shell library). It inherits the behavioural contracts of
`specs/0087` (open-file floor of the ChromaDB start), `specs/0084` (TLS
delegation), `specs/0108` (the diagnostic), `specs/0113` and its deltas (the shared
MCP daemon), `specs/0133`, `specs/0139`, `specs/0158` (listener owner),
`specs/0165` (switch repair), `specs/0172`, `specs/0176` (token rotation) and
`specs/0246` (session-start registration check), and preserves them except for the
deviations of requirement 31. Line references are to `release/1231-ts-migration` at
`a81bca7`.*

## Intent

A contributor on Windows installs, starts, stops, inspects and removes the two
per-user MemPalace background services — the shared ChromaDB daemon and the shared
MCP HTTP daemon — with the same commands, the same messages and the same per-user
scope as on macOS and Linux, without administrator rights and without a POSIX
shell. A contributor on macOS or Linux keeps every flag, message and exit status of
the daemon scripts, of the switch and rotate command, of the repair command and of
the MemPalace diagnostic, except for the few listed changes. When a Windows machine
cannot offer a per-user background mechanism, the contributor is told which
capability is missing and nothing half-registered is left behind. The commands that
report which MemPalace will answer and that repair an interrupted switch run on all
three operating systems without needing `jq`, and the daemon health, authentication
and listener checks run without `curl`, `lsof` or `ss`. A contributor whose
Node.js is too old is told so before anything is written.

## Requirements

1. **Entry points and decomposition.** The behaviour of these nine scripts SHALL be
   carried by TypeScript entry points at the path of each shell predecessor with
   `.sh` changed to `.ts` (parent requirement 9, spec 0240 requirement 11),
   runnable as a direct `node` command line and written to the conventions of
   parent requirement 2: `scripts/start-chroma-server.ts` (102 lines),
   `scripts/stop-chroma-server.ts` (56), `scripts/status-chroma-server.ts` (38),
   `scripts/status-mcp-server.ts` (166), `scripts/stop-mcp-server.ts` (46),
   `scripts/switch-mempalace-http.ts` (144), `scripts/repair-mempalace-http.ts`
   (425), `scripts/uninstall-mcp-daemon.ts` (67) and
   `scripts/doctor-mempalace.ts` (467). No TypeScript file this ticket adds SHALL
   exceed the 300-line warning threshold, so the work is decomposed, one concern
   per file, into the service module under `scripts/lib/service/` (the three
   backends of requirement 5, unit rendering and installation, the supervisor and
   listener PID lookups, the bounded HTTP probe, the daemon state report, the TS
   launcher and the TS trust wrapper of requirement 11, the assistant
   registration reading and writing of requirements 18 and 19, the repair verbs
   and the diagnostic's three sections) and into the two helper modules of
   requirement 4. The plan names the files.

2. **Named dependencies and coexistence (parent requirement 8).** These scripts
   are manage entry points of step (b). The libraries they source —
   the daemon, supervisor, token, registration and Python-detection sections of
   `scripts/lib/common.sh`, `scripts/lib/mcp-daemon-launcher.sh` and
   `scripts/lib/tls-exec.sh` — keep other consumers until row J4: the four
   `scripts/setup-*-interactive.sh` (row F1), `scripts/install-*.sh` and
   `scripts/manage-*-component.sh` (row F2), and the Bash suites that source
   `common.sh`. The slices these nine scripts need therefore migrate here as
   TypeScript twins, because they are dependencies of these scripts and for no
   other reason, and the shell originals SHALL stay in place, byte for byte, until
   J4 retires them with their last consumer. The existence of this dependency SHALL
   NOT be cited as precedent for any other consumer of those libraries. A
   shell/TypeScript conformance test (requirement 26) covers the dual source.

3. **Entry form, floor and silence.** Each entry file SHALL use the entry form of
   spec 0243 requirement 5, reused and not redefined (no top-level `import` or
   `export`, the `warning` listeners removed as the first statement), so that
   `node scripts/<name>.ts` writes no Node.js warning to standard error on any
   Node.js 24 release with no flag and no environment variable on the command
   line. As user-facing entry points (parent requirement 4) they SHALL be
   documented behind the floor-guard step — `node scripts/lib/node-floor-guard.js`,
   then `node scripts/<name>.ts` — and SHALL leave the filesystem unmodified on a
   Node.js below the floor. The shims of requirement 22 and the `Taskfile.yml`
   tasks of requirement 23 run the floor guard first.

4. **Shared helper modules, and what is reused.** The TypeScript port of the
   `scripts/lib/common.sh` helpers that this row and row F3 (#1331) both need SHALL
   be exactly these two modules, standard library only, with these exported
   interfaces, which are stable for the length of the migration (an optional
   parameter MAY be added; no signature changes):

   - `scripts/lib/mempalace-python.ts`: `detectMempalacePython(env?:
     NodeJS.ProcessEnv): string | undefined` (`detect_mempalace_python`: the first
     candidate that imports `mempalace.mcp_server`); `mempalacePythonCandidates(env?:
     NodeJS.ProcessEnv): string[]` (`mempalace_python_candidates`, same order, no
     duplicates); `consoleScriptPython(script: string): string | undefined`
     (`console_script_python`, `common.sh:728-786`, including the `#!/bin/sh`
     polyglot wrapper forms of issue #1417); `resolveSymlink(target: string):
     string` (`resolve_symlink`, `common.sh:678`). On Windows the candidate list
     SHALL name the pipx venv interpreter under `Scripts\` and the `python` and
     `py -3` launchers instead of `python3`, and the pipx home SHALL follow pipx's
     own Windows resolution; the plan fixes the exact list from measurement.
   - `scripts/lib/mempalace-pin.ts`: `readMempalacePin(repoRoot: string): {
     readonly min: string; readonly maxExclusive: string }` and
     `installSpec(pin): string` (`"mempalace>=<min>,<max>"`). The pin SHALL be read
     from the two declaration lines of `scripts/lib/common.sh` (`:15-16`), which
     stay the single source until J4, by the same rules as
     `scripts/lib/mempalace_pin.py`; the module SHALL NOT declare the values a
     second time. J4 relocates the declaration and changes only this module.

   Everything else the daemon scripts need already exists and SHALL be reused, not
   re-ported: `endpoint()`, `tokenPath()` and `tokenPathNoCreate()` of
   `scripts/lib/usage-store/mcp.js`; `tlsEnvPath()` and the reader of
   `scripts/lib/tls-env.ts`; `parseLauncher`, `configPath` and the arrangement
   classification of `scripts/lib/mempalace-registration.ts`; and the shared
   modules of spec 0240 (`paths.ts`, `tmp-file.ts`, `line-endings.ts`,
   `require-dependency.ts`). `scripts/lib/mempalace-transcript/daemon.ts` is the
   transcript hook's single `add_drawer` request, not a lifecycle primitive: this
   row SHALL NOT generalise it and SHALL NOT edit it (it is outside this row's
   ownership and its Bash oracle belongs to row C3); the bounded HTTP probe of the
   service module is a new, separate primitive that contains no JSON-RPC
   `add_drawer` logic, and the plan records the relationship. Where a helper this
   row ports has a second consumer in row F3 or elsewhere, that consumer imports
   the module and SHALL NOT port the function again.

5. **Service lifecycle contract (parent requirement 20).** The service module SHALL
   offer, for each of the two daemons (ChromaDB, MCP), the five operations
   *install*, *start*, *stop*, *status* and *uninstall*, with the same names for the
   same service on every operating system (launchd label `com.mempalace.…`,
   systemd unit `mempalace-…`, Windows task `\CrewRig\mempalace-…`; the overrides
   `MEMPALACE_MCP_LABEL` and `MEMPALACE_MCP_UNIT` keep applying, the unit value
   naming the Windows task leaf) and the same per-user scope: LaunchAgents under
   `~/Library/LaunchAgents`, systemd user units under `~/.config/systemd/user`, and
   a per-user task on Windows. No operation on any operating system SHALL require
   administrator elevation. *Stop* of the MCP daemon keeps its meaning of a restart
   request under supervision (spec 0113: it never disables autostart); *uninstall*
   ends the daemon and removes its registration, and is the only operation that
   does. The operating system's service manager (`launchctl`, `systemctl`,
   `schtasks`) is spawned as parent requirement 23 permits; no other process is
   spawned to manage a service.

6. **Windows mechanism: decision record.** Each Windows daemon SHALL be a
   **Task Scheduler task registered for the current user from an XML definition**
   (`schtasks /Create /XML`, run with `/Run`, ended with `/End`, queried with
   `/Query`, removed with `/Delete`). This is the owner's decision of 2026-10-09
   (gfourny-sfeir, recorded on #1330), taken between this option and the second row
   of the table. The alternatives and why they are rejected SHALL be restated in an
   ADR shipped with the implementation (`docs/adr/`, written in PR B):

   | Alternative | Verdict | Reason |
   |---|---|---|
   | Task Scheduler per-user task (logon trigger, interactive token, least privilege, restart on failure) | **chosen** | Needs no elevation for a task bound to the current user; ships with every Windows edition; has the five operations; supervises and restarts; logs through the launcher. Costs: restart interval floor of one minute, no PID in `schtasks` output (the scheduler's running-task interface supplies it). |
   | `HKCU\…\Run` key or Startup-folder shortcut plus a CrewRig-owned Node supervisor | rejected by the owner | No elevation either, but CrewRig would write and own a respawn loop, a stop path and a PID file; the owner check of spec 0158 requirement 2 forbids trusting a file a same-user process can write, and the supervisor would have to be trusted instead. |
   | Windows service (`sc.exe`, NSSM, WinSW) | rejected | Creating a service needs administrator rights, which requirement 20 of the parent forbids; NSSM and WinSW are also third-party binaries. |
   | Per-user service templates (Windows 10 1903+) | rejected | Only system components can register them; a user cannot. |
   | WSL or Git Bash running the systemd/launchd path | rejected | Needs a POSIX layer, which parent requirement 5 forbids once step (b) has shipped. |
   | A container (Docker) | rejected | A new prerequisite outside parent requirement 5. |

7. **Windows task definition.** The two task definitions SHALL be shipped as XML
   templates under `config/windows/` beside `config/launchd/` and `config/systemd/`,
   with the same `__NAME__` placeholder convention and the same refusal to install
   a definition that still carries an unsubstituted placeholder (spec 0133
   requirement 7). Each SHALL: trigger at logon of the current user only; run
   under the current user's interactive token at least privilege, with no stored
   password and no "run whether the user is logged on or not"; allow one running
   instance (a second start is ignored); have no execution time limit; start
   regardless of battery state; restart on a failed run after the shortest
   interval the Task Scheduler allows, with the largest count it allows; and run
   the daemon with no console window left open on the user's desktop (the plan
   fixes how, and the Windows job of requirement 24 verifies it where the runner
   permits, otherwise the limit is a parity gap under requirement 25). The task
   action SHALL be the absolute path of the Node.js executable running the
   installer (`process.execPath`), with the installed program of requirement 10 as its first argument. The
   definition SHALL carry no secret: the bearer token is read by the launcher
   (requirement 11), never named in a task, plist or unit. The Task Scheduler
   restarts a task only when the process it runs ends with a failure; it does not
   watch a process that task started. The task's action process SHALL therefore be
   the process whose end means the daemon is down: the launcher SHALL end, with a
   non-zero status, whenever its daemon child ends for any reason while the launcher
   was not asked to stop, including a child that exits with status 0, and SHALL NOT
   outlive a child that was killed (requirement 11 states the rule, requirement 24
   tests it).

8. **When the mechanism is unavailable.** When the Windows mechanism cannot be used
   — `schtasks.exe` absent or refused by policy, the task folder not writable, the
   definition rejected — the operation SHALL exit non-zero with one diagnostic that
   names the missing capability and the command that failed, and SHALL leave no
   partially registered service. Enterprise Group Policy may prohibit the creation
   of tasks on a client machine, so a refused `schtasks /Create` SHALL fail closed
   with a message that quotes the `schtasks` error text verbatim, says that Group
   Policy or the machine's administrator may prohibit per-user tasks, states that no
   assistant has been switched and that MemPalace keeps working in stdio mode, one
   session at a time, and points to `doctor-mempalace` (requirement 20) for the
   mechanism's state. It SHALL NOT fall back silently to another mechanism
   (the second row of requirement 6's table included): a fallback needs a new
   decision. An *install* that registered a task and then fails
   to verify it (a `/Query` that does not return it, a `/Run` that is refused)
   deletes the task it created, removes the files it installed under `~/.crewrig/`
   that no other service uses, and says so. *Uninstall* of a task that is absent is
   success ("was not loaded"), as on the other operating systems. On macOS and Linux
   the behaviour of the shell installer (`common.sh:911-983`, `:2059-2106`) is
   preserved, including its messages.

9. **Unit files from the shipped templates.** The templates under `config/launchd/`
   and `config/systemd/` SHALL NOT be edited: `scripts/tests/test-chroma-fd-limits.sh`
   asserts their open-file floor and the shell installer still materialises them.
   The TypeScript installer SHALL materialise each from its template with the same
   substitutions (`__MEMPALACE_HOME__`, `__LAUNCHER_PATH__`, `__PIPX_PYTHON__`,
   `__CHROMA_BIN__`, `__CHROMA_PALACE_PATH__`, `__TLS_EXEC__`), the same palace-path
   rule (`%h/.mempalace/palace` in a systemd unit when no override is set), and the
   same refusal of a residual placeholder, and SHALL replace the interpreter token
   of the program line (`/bin/bash` in a plist, `/usr/bin/env bash` in a unit) with
   the absolute path of the running Node.js executable so that the supervisor runs
   the TypeScript programs of requirement 10. When a template no longer carries the
   token the installer expects, it SHALL exit non-zero, name the template and write
   nothing. The load and enable steps keep the legacy pairs on purpose
   (`launchctl load -w` / `unload -w`, `systemctl --user enable --now` /
   `disable --now`), and the 15-second health poll after install keeps its shape.

10. **Installed programs live outside the repository.** The programs a supervisor
    runs SHALL be materialised under `~/.crewrig/` (spec 0113 and issue #1189: a
    supervisor cannot be relied on to read a program under a protected checkout, and
    a `git revert` must not delete the program a unit names): the TypeScript MCP
    launcher (requirement 11) and the TypeScript trust wrapper (requirement 12).
    Each SHALL be self-contained or depend only on files installed beside it, SHALL
    carry no import that reaches into the repository, and SHALL be written with
    mode 0755 where the platform has modes. Every reader of the installed launcher
    reads one fixed path, `~/.crewrig/mcp-daemon-launcher.sh` (`MEMPALACE_MCP_LAUNCHER_PATH`
    still overrides): `launcherPath()` of `mempalace-registration.ts` (the spec 0246
    session-start check), `mcp_launcher_installed_path` and `mcp_installed_endpoint` of
    `common.sh` (used until row F1 by the setup scripts), the status report and the
    uninstall. None of them is edited, and none is taught a second filename. The
    TypeScript installer therefore writes two files: the program, at
    the path of the record with its `.sh` extension replaced by `.ts` (by default
    `~/.crewrig/mcp-daemon-launcher.ts`, and beside the record whenever
    `MEMPALACE_MCP_LAUNCHER_PATH` moves it; a record path with another extension gets
    `.ts` appended), which the supervisor definition names; and, at the legacy path,
    an *endpoint record* that is not a program. The record carries
    the same three line forms the shell launcher carried, `MCP_HOST="…"`,
    `MCP_PORT="…"` and `LAUNCHER_SOURCE_SHA="…"` (the SHA-256 of the program's
    repository source), plus one `LAUNCHER_PROGRAM="…"` line naming the program, so
    that `parseLauncher`, the 0246 check and `mcp_installed_endpoint` read it
    unchanged. Its body SHALL fail loudly if anything executes it (a message on
    standard error naming the program and exit 1), so a stale supervisor
    definition that still names the legacy path cannot appear to run. The status
    report SHALL tell the two forms apart by the `LAUNCHER_PROGRAM` line and compare
    the recorded hash with the source of the matching form (the TypeScript program
    or the shell launcher), and SHALL report a record whose `LAUNCHER_PROGRAM` file does
    not exist as `*** PROGRAM MISSING ***` and fail the section. When the shell installer of `common.sh` later rewrites
    the legacy path with the real shell launcher, that file is again the program and
    the record, and the TypeScript program beside it is unused. Uninstalling removes
    both files.

11. **TypeScript MCP daemon launcher.** The TypeScript launcher SHALL keep every
    property of `scripts/lib/mcp-daemon-launcher.sh` (spec 0113, ADR 0016):
    (a) *foreground*: it is the process the supervisor owns and it never detaches;
    (b) *the token never reaches a
    world-readable file or an argument list*: it reads the 0600 token and passes it
    to the daemon through the child's environment only; (c) *fail closed*: an absent,
    empty or whitespace-only token file, a token with a character outside
    `[A-Za-z0-9_-]` or shorter than 32 characters, exits non-zero with the same
    diagnostics, before anything else is done; the token file is `MEMPALACE_MCP_TOKEN_FILE`
    when set, otherwise the palace-keyed path of `usage-store/mcp.js` (hash of the
    resolved palace path, first 24 hexadecimal characters); (d)
    `MEMPALACE_MCP_IDLE_HOURS` defaults to `0`; (e) *refuse fast on a taken port*:
    an in-process bind probe of `MCP_HOST:MCP_PORT`, not a spawned interpreter,
    with the same diagnostic; (f) *wait for ChromaDB on a deadline*
    (`MEMPALACE_MCP_CHROMA_WAIT`, default 60 seconds) with a 2-second probe of
    `/api/v2/heartbeat`, then export `MEMPALACE_CHROMA_HOST` and
    `MEMPALACE_CHROMA_PORT`; (g) the wrapper's absence is a diagnosed failure; (h)
    the spec 0172 warning when an assistant is still in stdio mode, through the
    arrangement classification of `mempalace-registration.ts`; (i) the hand-off
    runs `<MEMPALACE_PYTHON> scripts/lib/mempalace-http-wrapper.py --transport http
    --host <MCP_HOST> --port <MCP_PORT>` with inherited standard streams. A Node.js
    process cannot replace itself, so the daemon is a child. The launcher is the
    process a supervisor watches, so: it SHALL forward `SIGTERM` and `SIGINT` to the
    child; on Windows, ending the task SHALL leave no process of the daemon tree
    running; and it SHALL end, with a non-zero status, whenever the child ends for
    any reason while the launcher was not asked to stop — a crash, a kill, a
    signal, and also an exit with status 0, which a task would otherwise treat as
    success and not restart. The launcher SHALL NOT stay alive after its child has
    ended, and a child that ends with a non-zero status keeps that status. A
    launcher asked to stop ends the child, then exits with the status a clean stop
    has under the supervisor. Every `log` and `die` line keeps its format.

12. **TypeScript trust wrapper.** A TypeScript program installed under `~/.crewrig/`
    SHALL replace `scripts/lib/tls-exec.sh` for the TypeScript installer: it reads
    `~/.crewrig/tls-env.sh` with the reader of `scripts/lib/tls-env.ts` (parsed,
    never executed, spec 0247 requirement 16), adds its variables to the
    environment of the command it runs, and runs that command with inherited
    standard streams and its exit status. An absent file is a silent no-op
    (spec 0084). A file the reader reports malformed or unreadable SHALL produce one
    warning naming the file and the first offending line on standard error, and the
    command SHALL still run without those variables.

13. **`start-chroma-server`.** The entry SHALL keep the contract of
    `scripts/start-chroma-server.sh`: idempotent while the PID in
    `~/.mempalace/chroma-server.pid` is alive ("chroma server already running (PID
    N)", exit 0), stale PID file removal with its message, the Python-interpreter
    and `chroma`-binary sanity checks with their messages and exit 1,
    `MEMPALACE_PYTHON`, `MEMPALACE_PALACE_PATH`, `MEMPALACE_CHROMA_HOST` and
    `MEMPALACE_CHROMA_PORT` with their defaults, the daemon appended to
    `chroma-server.log`, the PID file written, the 15-second heartbeat poll with
    its three outcomes (started with PID, process died during startup, heartbeat
    timed out, the latter two removing the PID file and ending the process), and
    the TLS variables of `~/.crewrig/tls-env.sh` applied to the daemon's
    environment as requirement 12 does. On POSIX the open-file soft limit SHALL be
    raised to `MEMPALACE_CHROMA_ULIMIT_FLOOR` (default 10240) before the daemon
    runs, a failure to raise it printing the same warning with the hard ceiling and
    not ending the start (spec 0087), by running the daemon through the Python
    interpreter already in use, which raises the limit and then replaces itself with
    the daemon so the recorded PID is the daemon's; no shell is spawned. On Windows
    the `chroma` executable is the one beside the interpreter under `Scripts\`, the
    limit step does not apply, and the daemon is started detached with no console
    window.

14. **`stop-chroma-server` and `status-chroma-server`.** The entries SHALL keep the
    contracts of the two shell scripts: the supervisor-managed case recognised by
    an answering heartbeat with no PID file (`stop` reports it and does nothing,
    exit 0; `status` reports HEALTHY, exit 0); the stale-PID cases; `status` exit
    0 only when the process is alive and the heartbeat answers; `stop` ends the
    process gracefully, waits up to five seconds, then forces it and says so. On
    Windows a graceful end of a console process is not available and the entry
    SHALL end the process tree and print the "force-stopped" line. The heartbeat
    probe uses the bounded HTTP primitive of requirement 4, with the shell's
    `MEMPALACE_CHROMA_HOST` and `MEMPALACE_CHROMA_PORT`, and no `curl`.

15. **`status-mcp-server`.** The entry SHALL keep `scripts/status-mcp-server.sh`
    section for section: the endpoint of the installed launcher winning over the
    environment (spec 0246 requirement 4) with the loopback rule for the probe
    target (`localhost`, `::1`, `[::1]`, or a dotted quad 127.a.b.c with each octet
    0–255 and no leading zero; any other host is replaced by the environment or
    default host); the 3-second `/healthz` liveness probe with the last twenty log
    lines when not serving; the authentication probe, which sends an
    unauthenticated `tools/list` to `/mcp` and requires `401`, never a header
    carrying the token; the listener-owner section (requirement 16); the launcher
    drift section (the recorded source hash against the current one, `NOT
    INSTALLED`, `drift UNKNOWN`, `DRIFTED`), which also reports `DRIFTED` when the
    interpreter named by the supervisor definition no longer exists (a Node.js
    removed or upgraded by a version manager) and says to re-run the switch; and
    the per-assistant arrangement
    report (spec 0113 requirement 16, spec 0172) with its half-converted
    `LOCKED OUT` verdict; the final exit status is 0 only when every section
    passes. On Windows only, the report gains a `task:` line giving whether the
    task is registered, its state and its last result, so that a task that has
    stopped for good after its restart count ran out is visible; it fails the
    section when the task is registered, not running and its last result is a failure,
    that is any result other than success (`0`), running (`0x41301`), not yet run
    (`0x41303`) and terminated by the user (`0x41306`, what `stop` produces). The test seams `MEMPALACE_MCP_HOST` and `MEMPALACE_MCP_PORT` keep
    working.

16. **Listener and supervisor owner without POSIX tools (spec 0158).** The PID of
    the listener on the daemon port SHALL be found without spawning `lsof`, `ss` or
    any other POSIX-only utility: on Linux from the kernel's process and socket
    tables, on macOS and Windows from the operating system's own networking
    facility; the plan fixes the mechanism from measurement and records it. The PID
    the supervisor runs SHALL come from the supervisor (`launchctl print`,
    `systemctl --user show -p MainPID`, and on Windows the running-task interface of
    the Task Scheduler itself, which names the process the task engine started for
    the task), never from a file, a command line or a process name that a same-user
    process can write or spoof. `schtasks` output carries no PID, so the Windows
    lookup goes through the scheduler's own interface (the plan names the call).
    PR B SHALL measure on `windows-latest` that this interface returns the PID of the
    launcher process; if it does not, no weaker identification SHALL be adopted by the
    plan: a delta-spec of this spec decides how the Windows owner verdict degrades,
    and PR D does not ship before it.
    The test seams `MEMPALACE_MCP_LISTENER_PID` and `MEMPALACE_MCP_EXPECTED_PID`
    keep their *set-but-empty means undeterminable, unset means look up*
    semantics. Because the launcher is now a parent of the daemon (requirement 11),
    the owner verdict SHALL be VERIFIED when the listener PID is the supervised PID
    or a descendant of it, and USURPED otherwise; a squatter outside the supervised
    tree is still reported with the same message and exit status. This is a
    deviation (requirement 31).

17. **`stop-mcp-server` and `uninstall-mcp-daemon`.** `stop-mcp-server` SHALL keep
    its messages and its meaning on macOS and Linux ("restart requested", "no
    supervisor unit loaded/active", exit 1 with "unsupported OS" only for an
    operating system with no backend) and SHALL, on Windows, end the task and run it
    again with the same wording. `uninstall-mcp-daemon` SHALL end the daemon and
    remove its registration through requirement 5, remove the installed launcher
    files of requirement 10, then print the same warning for each assistant still
    registered over HTTP, the same token-retention text and the same rotate and
    decommission instructions. Neither shell script has a Bash test today, so
    requirement 21 gives each a black-box test before it migrates.

18. **`switch-mempalace-http`.** The entry SHALL keep the contract of
    `scripts/switch-mempalace-http.sh` and of the helpers it calls: `--rotate`/`-r`,
    `-h`/`--help`, an unknown argument exiting 1; with `--rotate`, removal of the
    token file and purge of `<config>.bak.*` before and again after the switch; the
    all-or-nothing order (install the daemon and its launcher, provision the token
    by exclusive create, replace the daemon process so it honours the current
    token, register each assistant that is present, run `status-mcp-server`, fail
    when its exit status is non-zero); the refusal to switch any assistant when the
    daemon is not serving; the replacement-window warning of spec 0139; and the
    rollback of spec 0113 requirement 14 that restores each registration captured
    before the transaction. A minted token is 48 characters of `[A-Za-z0-9]` in a
    file readable only by its owner where the platform has modes (on Windows the
    file inherits the private ACL of the user profile directory, a limit recorded
    under requirement 25). The token SHALL NOT appear in any argument list, unit,
    task definition, log line or the output of any process spawned, for any of the
    four assistants: Claude Code's registration is written without placing the
    header on the `claude` command line, and the other three through the secure
    configuration writer of spec 0240 (`tmp-file.ts`). `CREWRIG_TEST_MOCK_DAEMON=true`
    keeps skipping the daemon steps.

19. **`repair-mempalace-http`.** The entry SHALL keep spec 0165's contract
    (requirements 1–9 of that spec): detection of the residue (an assistant
    present whose configuration does not parse, or whose `mempalace` registration
    is neither `http` nor `stdio`), the per-assistant report, `--restore-backup`
    (the most recent usable timestamped backup, written through a staged sibling
    file and a rename so the mode is final before the content is visible, `0600`
    when the content carries a bearer token or when the backup's mode would deny
    its owner read), `--reset-none`, the post-repair verification whose status
    decides the run, `-h`/`--help`, exit 2 for an unknown or mutually exclusive
    option, and the exit status of each path. A backup is *usable* when it parses
    as JSON and the value is neither `null` nor `false` (the `jq -e .` test),
    including a backup that is a symbolic link to one. The command SHALL NOT
    require `jq`.

20. **`doctor-mempalace`.** The entry SHALL keep `scripts/doctor-mempalace.sh`
    (spec 0108 requirements 7–10): the three labelled sections — what a session
    launches, what resolves on `PATH`, what a fresh setup would select — the
    interpreter read from the concatenation `[command] + args` of each of the four
    registration files, the shebang interpreter read as text and never executed,
    the pin and served-version evaluation through `scripts/lib/mempalace_pin.py`
    run under the registered interpreter (the Python toolchain, permitted by parent
    requirement 23; the module stays Python), the unconditional restart note, the
    HTTP-registration branch, the LOCKED OUT conflict, and the exit status (non-zero
    on diverging versions, on a version outside its pin, on diverging pins, or on
    an unreadable pin; a GUARD ABSENT label alone is not a failure). It SHALL only
    read, and SHALL NOT require `jq` (a deviation, requirement 31). On Windows only,
    the report SHALL gain a fourth section, *4. Background service mechanism*, so
    that a machine whose policy blocks the daemon is diagnosable before an install
    is attempted: whether `schtasks.exe` is present; whether the operating system
    exposes a policy that prohibits the creation of tasks, read without creating one
    (the report says *UNDETERMINED* when it cannot tell, and that an install will
    answer); and, for each of the two CrewRig tasks, whether it is registered,
    running, and with which last result. When creation is prohibited the section
    says that the shared daemon cannot be installed on this machine and that each
    assistant therefore stays in stdio mode, one session at a time. The section is
    informational: it never changes the exit status, which keeps the rule above. On
    macOS and Linux the report is unchanged. Doctor mutates nothing, so it SHALL NOT
    create a probe task.

21. **Oracle, and the tests that change (parent requirement 13).** The existing Bash
    tests are the black-box oracle and SHALL keep their assertions, except the three
    kinds below, each listed here and in the plan:

    - *Assertions that check a property only a shell file has*, removed in the pull
      request that migrates the script they check: the assertions of
      `scripts/tests/test-chroma-server.sh` that read the text of
      `start-chroma-server.sh` for `if ! ulimit -n` and `^nohup` (the three tests on
      the open-file floor, tests 9 to 11); any other assertion the plan finds by the
      same method and records.
    - *Harness changes that observe the same behaviour through a different
      mechanism*, made in a preparatory pull request (PR A) before any script
      migrates: a test that observes a script's `curl` calls through a `curl` stub on
      `PATH` is re-hosted on a loopback stub server, as spec 0247's PR A did; an
      isolated-`PATH` harness (`test-mempalace-doctor.sh` `run_doctor_isolated`, the
      `toolbin` directories) gains `node`; a harness that needs `jq` itself keeps it.
      Re-hosting changes no assertion and SHALL pass against the shell script first.
    - *Sourced-library suites* (`test-chroma-health-race.sh`,
      `test-palace-path-propagation.sh`, the `common.sh` sections of
      `test-mcp-daemon.sh`) exercise `common.sh` and the shell launcher, which stay
      until J4, and are not touched.

    A script with no Bash test SHALL gain a black-box test before it migrates, which
    then plays the oracle role: `stop-mcp-server.sh` and
    `uninstall-mcp-daemon.sh` (requirement 17), and
    any further gap the plan finds (for example the `--help` and unknown-argument
    paths of `switch-mempalace-http.sh`). Each new test SHALL pass against the shell
    script in the pull request that adds it. A script and its Bash test SHALL NOT
    migrate in the same pull request: the nine scripts migrate in PRs C, D and E and
    their Bash tests in row J1b.

22. **Forwarding shims (parent requirement 9).** Each of the nine `.sh` paths SHALL
    become a forwarding shim of the shape of `scripts/build-components.sh` (spec 0250
    requirement 22): it runs the Node.js floor guard, then the TypeScript entry with
    every argument and its standard input, and returns its status, standard output
    and standard error unchanged; it fails closed (one `Error:` line and exit 1 when
    `node` is absent). Each shim stays on `ci/shell-allowlist.txt` until row J4 removes
    it, and `scripts/lib/mcp-daemon-launcher.sh` and `scripts/lib/tls-exec.sh` stay
    unchanged there under requirement 2.

23. **Callers.** Every `Taskfile.yml` task (`mempalace:doctor`,
    `mempalace:switch-http`, `mempalace:rotate-token`, `mempalace:status`,
    `mempalace:repair`, `mempalace:stop`, `mempalace:uninstall-daemon`), workflow
    step, document and skill instruction that names an old invocation of the nine
    scripts SHALL be updated in the pull request that migrates the script, to the
    floor guard followed by `node scripts/<name>.ts`. The invocation of
    `status-chroma-server.sh` by `common.sh` (`_health_chroma_daemon`) and of
    `status-mcp-server.sh` by the setup scripts goes through the shim and is left to
    rows F1 and F2.

24. **Windows proof (parent requirement 17).** Each of PRs C, D and E SHALL ship with
    a `windows-latest` job, copied from the template of `build.yml`
    (`windows-node-floor-guard`), whose steps run under `pwsh`, that runs its
    scripts from PowerShell and asserts the observable outcome against the real
    Task Scheduler: install a task for a stand-in daemon registered under a
    throwaway task name, assert `status` reports it, `stop` and `start` change the
    state `/Query` reports, `uninstall` removes it and a second `uninstall` is
    success, and the daemon process tree is gone after `stop`. The job SHALL prove
    the restart rule of requirement 7 on a stand-in launcher run by a real task: when
    its daemon child is killed from outside, the launcher ends with a non-zero status
    (`/Query` reports a failed last result), the task is started again by the Task
    Scheduler within a bounded wait that allows its restart interval, and the same
    holds when the child exits with status 0; the same property SHALL also be
    asserted on every operating system by a unit test of the launcher with a stub
    child, which does not wait for the scheduler. The job SHALL run
    the lifecycle once under a restricted (non-elevated) token and assert it
    succeeds; where the runner cannot produce one, the gap SHALL be recorded under
    requirement 25 with the reason. The job SHALL also prove the unavailable case of
    requirement 8 (the mechanism made unavailable on purpose, and a `/Create`
    refused with an "Access is denied" answer, each a non-zero exit with the
    capability named, the verbatim `schtasks` text and the stdio advice, and `/Query`
    showing no task), the Windows section of `doctor-mempalace` of requirement
    20 in the registered, running and absent states, and the Windows owner verdict
    of requirement 16: VERIFIED for the daemon the task started, USURPED for a
    listener of the same user that the task did not start. The job SHALL be recorded
    in `ci/ci-capabilities.yml` as `portability: specific` (engine `github-actions`;
    GitLab exposes no Windows runner). No timing budget applies: these are not CLI
    integration points (parent requirement 15), so timings are recorded and do not
    gate.

25. **Parity record (parent requirement 19).** The pull request that adds the
    Windows backend SHALL add a row to `docs/cli-matrix.md` for OS service
    management naming, for each of macOS, Linux and Windows, the mechanism and its
    entry points, and recording every cell that does not match the others with its
    evidence. The service layer is shared by the four CLIs (each reaches the same
    daemon), so no CLI column differs from another. At authoring time the known
    gaps to record are: the one-minute restart floor and the finite restart count
    on Windows (a launcher that keeps failing closed, for instance on a missing
    token, eventually exhausts it and stops for good, where launchd and systemd
    never give up); the user-profile ACL in place of mode 0600 for the token file;
    the daemon console window, where the runner cannot show it; and the runner's
    administrator token, where it cannot be restricted. A gap without evidence SHALL
    NOT be recorded.

26. **Dual-source conformance.** While the shell twins stay (requirement 2), a
    Linux-only test SHALL assert, against the shell functions of `common.sh`, that the
    TypeScript twins agree on: the token path derivation, the launcher record parse, the
    placeholder substitution of each unit, the pin read, the Python candidate order
    and the arrangement classification over a corpus of registration files. It SHALL
    be retired with the shell library in row J4.

27. **Security.** No operation SHALL send the bearer token anywhere but the
    loopback `/mcp` endpoint of the installed daemon, in a request header built in
    process; the probe target keeps the loopback rule of requirement 15 (a
    non-loopback launcher host is never probed, PR #1474's finding); the token SHALL
    NOT be printed, logged or placed in an argument list, a unit, a task definition
    or the environment of any process but the daemon's; the unauthenticated probe
    sends none. A token file or backup is staged beside its destination with an
    exclusive, unpredictable name and replaced by rename, never opened through a
    predictable name or through a symbolic link at the destination.

28. **Language, comments and documents.** Every file this ticket adds follows the
    repository's English-only rule. The spec of the Windows decision is carried by
    this spec and the ADR of requirement 6; user documentation of the daemon
    commands (the MemPalace HTTP daemon pages under `docs/`) SHALL be updated in the
    pull request that migrates the script they describe.

29. **Component trees.** None of the nine scripts is a built component, so no
    committed generated tree changes. A pull request of this row that touches
    `artifacts/` SHALL still run the build and stage its outputs (parent `AGENTS.md`,
    *Built components*).

30. **Version bump and matrix.** A skill or agent source this row modifies carries
    the version bump of `docs/version-bump-convention.md`; `docs/cli-matrix.md` and
    `.crewrig/core-paths.txt` are updated in the same diff as the change that
    requires them.

31. **Deviations from the shell contract (parent requirement 14).** The only
    deviations are: (a) `curl`, `jq`, `lsof`, `ss`, `shasum`, `tr`, `sed`, `mktemp`,
    `tail`, `stat`, `readlink` and `python3` (as a socket probe) are no longer spawned
    (parent requirement 23), so the "jq is required" diagnostic and its exit 2 of
    `doctor-mempalace` and `repair-mempalace-http` no longer occur; (b) a registration
    file is parsed with the Node.js JSON parser, which refuses the non-standard
    literals `jq` accepts (`NaN`, `Infinity`), so a file `jq` read now counts as
    unparseable and is reported as residue; (c) the owner verdict accepts a
    descendant of the supervised process (requirement 16); (d) the daemon is a child
    of the launcher (requirement 11), so `ps` shows two processes where the shell
    launcher left one; (e) the open-file raise is performed by the daemon's Python
    interpreter (requirement 13); (f) the TLS file is parsed, not sourced, and a
    malformed file warns and continues (requirement 12); (g) the trust wrapper
    is a TypeScript file named in requirement 10; (h)
    on Windows, every behaviour that names a POSIX mode, signal or utility takes the
    Windows form stated above; (i) the launcher ends with a non-zero status when its
    child exits with status 0 (requirement 11), where the shell launcher, which had
    replaced itself with the daemon, had no such case; (j) on Windows only,
    `doctor-mempalace` prints a fourth section (requirement 20) and
    `status-mcp-server` prints a `task:` line (requirement 15); (k) on every
    operating system `status-mcp-server` reports a missing supervisor interpreter
    as drift (requirement 15), a line that appears only in that failing state; (l)
    the installed launcher is a TypeScript program with an endpoint record at the
    legacy path (requirement 10). A further deviation found in PLAN or DEV is added by a
    delta-spec of this spec, never silently.

32. **Pull-request split.** The work SHALL ship as: **PR A** (oracle hardening:
    requirement 21's black-box tests for the two untested scripts and the harness
    re-hosts, all passing against the shell scripts; no behaviour change); **PR B**
    (the shared helper modules, the service module with its three backends, the
    TypeScript launcher and trust wrapper, the Windows task templates and the ADR, all
    reached by tests only: dark; a `windows-latest` job runs the Task Scheduler
    lifecycle of requirement 24 against a stand-in daemon so the mechanism is proved
    before any script depends on it); **PR C** (the chroma trio, its shims, callers
    and Windows job); **PR D** (`status-mcp-server`, `stop-mcp-server`,
    `uninstall-mcp-daemon`, `switch-mempalace-http`, their shims, callers, the
    `cli-matrix` row and Windows job); **PR E** (`repair-mempalace-http`,
    `doctor-mempalace`, their shims, callers and Windows job). The plan MAY merge or
    split these, and SHALL NOT merge a script's migration with its Bash test's. Each
    pull request targets `release/1231-ts-migration` and is merged only with the
    user's formal permission.

## Scenarios

**Scenario:** Windows user installs the MCP daemon without elevation

Given a Windows 11 machine, a standard (non-administrator) user, Node.js 24 and
MemPalace installed through pipx, and no CrewRig task registered
When  the user runs `node scripts/switch-mempalace-http.ts` from PowerShell
Then  a task `\CrewRig\mempalace-mcp-server` is registered for that user, the
      launcher is installed under `~/.crewrig/`, the daemon answers `/healthz`, the
      four assistants present are registered over HTTP, and the command exits 0
      without any elevation prompt.

**Scenario:** the daemon is brought back after a crash on Windows

Given the daemon task is running under Task Scheduler
When  the daemon process is killed from outside
Then  the task restarts it within the Task Scheduler restart interval, the launcher
      waits for ChromaDB on its deadline rather than failing, and `status` reports
      HEALTHY with the listener PID VERIFIED as a descendant of the supervised
      process.

**Scenario:** stop is a restart request on every operating system

Given the MCP daemon is supervised (launchd, systemd or Task Scheduler)
When  the user runs `stop-mcp-server`
Then  the daemon is ended and brought straight back, the command prints "restart
      requested" and the advice to run `uninstall-mcp-daemon`, and autostart is
      still enabled.

**Scenario:** uninstall ends the daemon and removes every trace

Given the daemon is installed and serving, and Claude Code is still registered over
      HTTP
When  the user runs `uninstall-mcp-daemon`
Then  the supervisor unit or task is removed, the daemon process tree is gone, both
      installed launcher forms are removed, the command warns that Claude Code still
      points at the freed port and prints the rotate and decommission instructions;
      running it a second time prints "Supervisor was not loaded" and exits 0.

**Scenario:** the Windows mechanism is unavailable

Given a Windows machine whose policy refuses `schtasks.exe`
When  the user runs `node scripts/switch-mempalace-http.ts`
Then  the command exits non-zero with one diagnostic naming `schtasks.exe` as the
      missing capability and the command that failed, quoting its error text
      verbatim, saying that Group Policy may prohibit per-user tasks and that
      MemPalace keeps working in stdio mode; no task is registered, no launcher is
      left under `~/.crewrig/` that no other service uses, no assistant has been
      switched, and no other mechanism was tried.

**Scenario:** the daemon dies while its launcher would stay alive

Given the daemon task is running and its Python child is killed from outside
When  the launcher notices that its child has ended
Then  the launcher ends at once with a non-zero status, the Task Scheduler records a
      failed run and starts the task again, and the daemon serves again after the
      launcher's ChromaDB wait; a child that exits with status 0 gives the same
      outcome.

**Scenario:** the doctor explains a blocked machine

Given a Windows machine whose Group Policy prohibits the creation of tasks
When  the user runs `node scripts/doctor-mempalace.ts`
Then  a fourth section reports that task creation is prohibited, that the shared
      daemon cannot be installed here and that each assistant stays in stdio mode,
      the first three sections are printed as on the other operating systems, and
      the exit status is decided by the three original rules only.

**Scenario:** an unauthenticated daemon is reported

Given a daemon that answers `tools/list` on `/mcp` without a bearer token
When  the user runs `status-mcp-server`
Then  the report prints "NOT ENFORCED", the command exits 1, and no request it sent
      carried the token.

**Scenario:** a squatter holds the daemon port

Given the supervised daemon is down and another process of the same user listens on
      the daemon port
When  the user runs `status-mcp-server`
Then  the owner section reports a usurped listener naming both PIDs, advises token
      rotation, and the command exits 1.

**Scenario:** the repair verbs work without jq

Given a machine with no `jq`, a Gemini CLI settings file that is not valid JSON and
      a timestamped backup that is
When  the user runs `repair-mempalace-http --restore-backup`
Then  the backup is restored through a staged file with its mode (0600 if it
      carries a token), the verification reports no residue, and the command exits 0.

**Scenario:** the diagnostic reports a version outside the pin

Given a registered interpreter serving a MemPalace version outside the pin of its
      checkout
When  the user runs `doctor-mempalace`
Then  the three sections are printed, the verdict names the interpreter and the
      range, the restart note is printed, nothing is modified and the command exits
      non-zero.

**Scenario:** chroma starts with a raised open-file limit

Given a macOS or Linux machine whose inherited soft limit is 256
When  the user runs `start-chroma-server`
Then  the daemon runs with a soft limit of 10240, the PID file names the daemon's
      PID, the heartbeat answers within 15 seconds and the command prints "chroma
      server started".

**Scenario:** Node.js is too old

Given a Node.js 22 on the path
When  the user runs `bash scripts/status-mcp-server.sh` or `node
      scripts/status-mcp-server.ts` behind the floor guard
Then  the command exits non-zero naming the detected version, the floor and where to
      obtain a supported release, and has modified nothing.

## Out of scope

- Editing `scripts/lib/common.sh`, `scripts/lib/mcp-daemon-launcher.sh` or
  `scripts/lib/tls-exec.sh`: they retire in row J4 with their last consumer, and the
  setup, install and manage scripts that still call them belong to rows F1 and F2.
- Migrating the Bash tests of these scripts (row J1b), or touching the sourced-library
  suites of requirement 21.
- The setup entry points' own call to the daemon install (row F1), `install-*.sh` and
  `manage-*-component.sh` (row F2), and the history import, prune, usage and sync
  scripts (row F3, which only imports the two helper modules of requirement 4).
- `org_mcp_to_native` and `MCP_RESERVED_NAMES` (row G1b, `scripts/lib/org-mcp.ts`).
- Editing `scripts/lib/mempalace-transcript/daemon.ts` or generalising it.
- The Python wrapper `scripts/lib/mempalace-http-wrapper.py`, `scripts/lib/mempalace_pin.py`
  and the MemPalace server itself.
- A Windows service run as `LocalSystem`, any mechanism needing elevation, a
  system-wide (all users) installation, and running the daemons inside WSL.
- Changing a built component, a hook, or the `config/launchd/` and `config/systemd/`
  templates.
- Detection of, or protection against, a hostile administrator on the same machine.

## Open questions

- None. The Windows per-user mechanism (requirement 6) was decided by the owner on
  2026-10-09: Task Scheduler. The two conditions attached to that decision, that the
  launcher must end when its daemon ends and that a Group Policy refusal must fail
  closed with a diagnosis, are requirements 7, 8, 11, 20 and 24.
