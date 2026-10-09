---
id: "0252"
slug: windows-service-management
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1330
version: 1.1.0
---

# OS service management and the daemon lifecycle scripts in TypeScript

*Delta 01 of `specs/0252-windows-service-management.md`. Source: ticket #1330.
Plan v1
(<https://github.com/crewrig/crewrig/issues/1330#issuecomment-6086496477>) listed
spec notes it needed in order to implement the spec; pass 1 of the cold seat
`plan/1330`
(<https://github.com/crewrig/crewrig/issues/1330#issuecomment-6086530408>)
accepted them as admissible and found the `lsof`/`ss` harness of the session-check
suite that the spec's requirement 21 did not name; plan v2
(<https://github.com/crewrig/crewrig/issues/1330#issuecomment-6086611060>) relies on
the readings recorded here. This delta records those readings as normative text, so
the spec stays faithful to what ships, and it adds no behaviour the plan and the seat
did not already settle. None of the readings contradicts the parent chain (spec 0215
and its deltas 01–05): the reading of requirement 16 relies on delta-05, whose spec-PR
(<https://github.com/crewrig/crewrig/pull/1516>) merges before this one. The version is a MINOR bump: requirements 7, 10, 16, 21, 25 and 32
are clarified or narrowed and one requirement is added. This delta runs under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`, and
its spec-PR targets `release/1231-ts-migration`. No implementation of the spec has
shipped yet.*

## ADDED

**Requirement 33 — A daemon process that survives its launcher on Windows.** The
measurement of the plan (step 19) asks whether ending a task on Windows leaves a
process of the daemon tree running. The `stop` and `uninstall` of the Windows backend
SHALL in any case snapshot the descendants of the supervised process before ending
the task and end the leftovers by process identifier and start time, so that
requirement 24's "no process of the daemon tree remains after `stop`" holds. If the
measurement shows that a process of the daemon tree survives the end of its launcher
when the task is ended by the Task Scheduler (an end requested through it, a logoff, a
deletion of the task), requirement 11's guarantee does not hold on Windows for that
case: PRs C and D SHALL NOT ship the Windows `stop` until a delta-spec of this spec
decides the treatment, and the case SHALL NOT be recorded as a parity gap in its place.
This is the same rule requirement 16 applies to the supervised process identifier. An
external kill of the launcher process alone is not in this rule: as on macOS and Linux,
where the launcher's death by `SIGKILL` alone leaves its child, it can leave the daemon
running, the next start refuses fast on the taken port, and the case is recorded under
requirement 25 with its measurement.

## MODIFIED

### Requirement 7 — the console window (plan spec note SN1)

Original (excerpt):

> … and run the daemon with no console window left open on the user's desktop (the plan
> fixes how, and the Windows job of requirement 24 verifies it where the runner
> permits, otherwise the limit is a parity gap under requirement 25).

Replacement:

> … and start the daemon child with no console window of its own. The action of
> requirement 7 is the Node.js executable with the program as its first argument, a
> console program, so the console window of the launcher process itself is not hidden by
> that shape: it SHALL be recorded under requirement 25 with the measurement of the plan's step 19
> taken on a Windows desktop session (the hosted runner has none). Until that
> measurement exists the `docs/cli-matrix.md` row says *unverified*, not *gap*, because
> requirement 25 records no gap without evidence; and a decision to hide the window by
> another action shape is a delta-spec of this spec.

### Requirement 7 and 12 — an optional flag so a clean exit of the ChromaDB daemon is restarted (plan spec note SN4)

Original (excerpt of requirement 7):

> The task's action process SHALL therefore be the process whose end means the daemon is
> down: the launcher SHALL end, with a non-zero status, whenever its daemon child ends
> for any reason while the launcher was not asked to stop, including a child that exits
> with status 0 …

Replacement (appended to requirement 7, and to requirement 12):

> The ChromaDB task runs the trust wrapper of requirement 12, not the launcher, so the
> wrapper SHALL accept an optional flag, `--end-nonzero-on-child-exit`, that gives it
> the launcher's rule: it ends non-zero whenever its child ends while it was not asked
> to stop, a child that exits with status 0 included. The Windows ChromaDB task SHALL
> pass the flag. Without the flag the wrapper keeps the behaviour of requirement 12 (it
> exits with the child's status), which is what `tls-exec.sh` does and what the launchd
> and systemd definitions, which restart on every exit, rely on.

### Requirement 10 — the installed tree (plan spec note SN6)

Original (excerpt):

> The programs a supervisor runs SHALL be materialised under `~/.crewrig/` …: the
> TypeScript MCP launcher (requirement 11) and the TypeScript trust wrapper
> (requirement 12). … The record carries … `LAUNCHER_SOURCE_SHA="…"` (the SHA-256 of
> the program's repository source) … Uninstalling removes both files.

Replacement:

> The installed tree is: the launcher program and its endpoint record as stated; the
> trust wrapper at the path of `MEMPALACE_TLS_EXEC_PATH` (default
> `~/.crewrig/tls-exec.sh`) with `.sh` replaced by `.ts`; and a bundle directory
> `service-lib/` that holds exactly the repository files the installed programs import,
> copied verbatim, so that no program reaches into the repository. Each installed
> program imports the `service-lib/` that sits in its own directory: in the default
> layout the launcher and the wrapper share `~/.crewrig/service-lib/`, and when
> `MEMPALACE_MCP_LAUNCHER_PATH` or `MEMPALACE_TLS_EXEC_PATH` moves one of them out of
> that directory, the installer writes a `service-lib/` beside it too. `LAUNCHER_SOURCE_SHA` is the SHA-256 of the launcher entry source, then
> the trust wrapper source, then the bundle files in a fixed order, so that a change to
> a bundled module is drift too. A test SHALL assert that every static import of both
> entries and of every bundled file resolves inside the bundle and that the bundle
> holds no unused file. Uninstalling removes the launcher program and its endpoint
> record, and removes the trust wrapper and `service-lib/` unless the other daemon's
> definition still names them.

### Requirement 16 — the process and socket inspection tools (plan spec note SN3)

Original (excerpt):

> … on Linux from the kernel's process and socket tables, on macOS and Windows from the
> operating system's own networking facility; the plan fixes the mechanism from
> measurement and records it.

Replacement:

> … on Linux from the kernel's process and socket tables (`/proc`), with no process
> spawned; on macOS with `netstat -anv -p tcp`; on Windows with `netstat -ano` for the
> listener and `powershell` for the Task Scheduler's running-task interface and the
> process table. The parent-process table that the descendant test needs comes from
> `/proc/<pid>/stat` on Linux, from `ps -axo pid=,ppid=` on macOS and from the same
> `powershell` call on Windows. These spawns are the ones parent requirement 23, as
> narrowed by `specs/0215-shell-to-typescript-migration.delta-05.md`, allows, and every
> one goes through the single module `scripts/lib/service/os-inspect.ts`; no other file
> of this row spawns `netstat`, `ps` or `powershell` for inspection. `lsof` and `ss`
> stay forbidden. A failure of one of these calls (the tool absent, refused by a policy
> such as AppLocker or Constrained Language Mode, or timing out) SHALL make the answer
> *undeterminable*: the owner verdict is then UNVERIFIABLE, never USURPED, and a
> Windows `task:` line and doctor section say *UNDETERMINED*. The task path is never
> interpolated into a PowerShell command string. The install verification of
> requirement 8 SHALL NOT depend on these calls.

### Requirement 21 — the harness that stubs `lsof` and `ss` (seat finding v1-F1, plan spec note SN2 withdrawn)

Original (excerpt of the second kind):

> a test that observes a script's `curl` calls through a `curl` stub on `PATH` is
> re-hosted on a loopback stub server, as spec 0247's PR A did; an isolated-`PATH`
> harness … gains `node`; a harness that needs `jq` itself keeps it.

Replacement:

> an isolated-`PATH` harness (`test-mempalace-doctor.sh` `run_doctor_isolated`, the
> `toolbin` directories) gains `node`; a harness that needs `jq` itself keeps it; and
> the TypeScript harness of the session-check suite
> (`scripts/tests/lib/session-check-harness.ts` and
> `scripts/tests/mempalace-registration-agreement.test.ts`), which runs
> `status-mcp-server.sh` with `lsof` and `ss` stubs on `PATH` and asserts that they
> were called, is re-hosted on the `MEMPALACE_MCP_LISTENER_PID` seam alone, the `lsof`
> and `ss` stubs staying only as tripwires that assert they are never called. Its
> `launchctl print` / `systemctl --user show -p MainPID` assertion is kept as it is: the
> supervisor PID is still looked up through those tools, so the
> `MEMPALACE_MCP_EXPECTED_PID` seam is not used there. The one assertion whose text is not
> carried over, that the listener lookup was keyed by the daemon port, is a property of
> the `lsof`/`ss` mechanism and is re-asserted on the TypeScript side by a unit test of
> the listener lookup. At the time of this delta no test of the nine scripts observes
> `curl` through a stub on `PATH`, so the `curl` re-host this requirement anticipated has
> no instance. Re-hosting changes no behaviour asserted and SHALL pass against the shell
> script first.

Requirement 21's first kind also lists the assertion of
`scripts/tests/test-palace-path-propagation.sh` that reads the text of
`start-chroma-server.sh` for its palace-directory fallback line (the plan's Test 7),
found by the same method as the assertions of `test-chroma-server.sh`, and removed in
the pull request that migrates `start-chroma-server.sh`; its behaviour is asserted by
the TypeScript test of the ChromaDB start. Accordingly the third kind of requirement 21,
which lists `test-palace-path-propagation.sh` among the sourced-library suites that "are
not touched", reads: *not touched, except that this one assertion is removed*. The rest
of that suite, which exercises `common.sh` and the shell launcher, is unchanged.

### Requirement 25 and 32 — where the `cli-matrix` row lands (plan spec note SN7)

Original (excerpt of requirement 32, PR D):

> … their shims, callers, the `cli-matrix` row and Windows job …

Replacement:

> … their shims, callers and Windows job …; the `docs/cli-matrix.md` row of
> requirement 25 is added in PR B, which adds the Windows backend, and PRs C, D and E
> extend its entry-point column with the scripts each migrates.

## REMOVED

Nothing is removed.
