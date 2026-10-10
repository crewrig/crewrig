---
id: "0256"
slug: setup-entry-points-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1335
version: 1.3.0
---

# Setup entry points in TypeScript

*Delta 03 of `specs/0256-setup-entry-points-typescript.md`. Source: the implementation
and review of ticket 1335 (pull requests #1571 to #1578): the reviewer seat found that
requirement 20 contradicts the shell it claims to preserve (finding `i1-F1` of #1571),
the TypeScript leg of the golden matrix found one difference in what a daemon install
leaves on the machine that the plan foresaw without lettering it, and the Windows job of
requirement 34 found that the path-safety rule of requirement 30 refuses every Windows
checkout. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirements 20, 26, 30 and 44 and adds scenarios. The version is a MINOR bump: no
behaviour of the shell changes, the wording of one requirement is made exact and two
deviations that the differential and Windows tests discovered are recorded as the
letters (s) and (t) that requirement 44 reserved for them. Line references are to
`release/1231-ts-migration` at `4305042`. This delta opens no question; the open
questions of the parent stand.*

## ADDED

**Scenario:** A dependency step hit prints the one line the shell prints

Given a repository whose `package-lock.json` SHA-256 equals the one recorded in
`.crewrig-state/production-deps.sha256`, and a `node_modules` directory
When any of the four setups reaches the dependency step
Then `npm` is not run and the single line
`Production dependencies: skipped — package-lock.json unchanged since the last successful install (sha256 <12 hex characters>). Delete .crewrig-state/production-deps.sha256 to force a re-install.`
is printed on standard output exactly as `install_production_dependencies` of
`scripts/lib/common.sh` prints it, and the run continues.

**Scenario:** The supervised MemPalace daemon runs the TypeScript launcher

Given a Linux or macOS machine on which the first accept probe of requirement 26 finds
no accepting MemPalace HTTP daemon, so that the setup of any CLI installs it (the run
then ends in return code 0 or 1)
When the daemon is installed
Then the supervisor unit points at the TypeScript launcher that the service layer
installs (spec 0252 requirements 11 and 12), `~/.crewrig/service-lib/` and
`~/.crewrig/mcp-daemon-launcher.ts` are those of that launcher, the file
`~/.crewrig/mcp-daemon-launcher.sh` is the endpoint record that the service layer
writes at the legacy path and no longer the shell launcher, the line `Installed
launcher: <home>/.crewrig/mcp-daemon-launcher.ts` is printed, and the daemon, once
started, answers the authenticated accept probe of requirement 26; the shell setup
installed its own launcher `mcp-daemon-launcher.sh` and its unit instead, and the
daemon that either leaves behind serves the same endpoint with the same token.

**Scenario:** A Windows checkout is wired into the usage-capture command

Given the Windows setup of any CLI that keeps usage capture in a hooks file, a
repository whose physical path holds backslashes (`C:\work\crewrig`) and no quote,
`$`, backtick or newline, and the answer `yes` to the usage-capture question
When the capture script path is resolved
Then the path is written with forward slashes, as `scripts/lib/hook-command.ts` writes
every other hook command line on Windows, the capture hook is wired, and no
`the checkout path ... contains a character` error is printed; a path that holds a
quote, `$`, a backtick or a newline is refused on every platform with that error.

## MODIFIED

**Requirement 20 — Dependency step: the hit case.** Original, the clause:

> a hit skips the install silently as the shell does

Replacement:

> a hit skips the install as the shell does, and prints the one line that the shell's
> `install_production_dependencies` prints for it, byte for byte:
> `Production dependencies: skipped — package-lock.json unchanged since the last successful install (sha256 <12 hex characters>). Delete .crewrig-state/production-deps.sha256 to force a re-install.`

Observed: `scripts/lib/common.sh` prints that line on a hit, so "silently" described a
behaviour the shell does not have; the golden cell `deps-step-hit` records the line and
the TypeScript step prints it.

**Requirement 26 — The mapping onto the service modules.** Original, the closing
sentence of the daemon contract of delta-01:

> How the contract maps onto the row-D service modules is left to the PLAN (see Open
> questions); the mapping SHALL not change what a run leaves on the machine, and SHALL
> be pinned by the unchanged `test-setup-mempalace-rc-guard.sh` after its retarget
> (requirement 9).

Replacement:

> The daemon is installed through the service layer of spec 0252 (`installMcpDaemon`),
> which supervises the TypeScript launcher: the mapping SHALL leave on the machine
> everything the shell's daemon install leaves except what deviation (s) of requirement
> 44 lists, and SHALL be pinned by the unchanged `test-setup-mempalace-rc-guard.sh`
> after its retarget (requirement 9) and by the golden cells `ensure-http-rc0`,
> `ensure-http-rc1` and `ensure-http-rc2`; only `ensure-http-rc1`, the cell that
> installs the daemon, runs on the TypeScript leg with tag (s), and the other two run
> without it.

**Requirement 30 — Usage capture: the path-safety rejection.** Original, the clause:

> its path-safety rejection of a path holding a quote, `$`, a backtick, a backslash or
> a newline

Replacement:

> its path-safety rejection of a path holding a quote, `$`, a backtick or a newline,
> and of a backslash everywhere but on Windows, where the physical path of the capture
> script is written with forward slashes as every hook command line of
> `scripts/lib/hook-command.ts` is (deviation (t) of requirement 44)

**Requirement 44 — Listed deviations (s) and (t).** Original, the closing sentence as
delta-01 replaced it, which follows deviation (r):

> Letters (s) onward are reserved for deviations a later differential test discovers
> and a delta of this spec records.

Replacement, tagged in the differential test like (a) to (r):

> (s) the supervised MemPalace daemon runs the TypeScript launcher installed by the
> service layer (spec 0252 requirements 11 and 12): the files that the daemon install
> leaves under `~/.crewrig` (`mcp-daemon-launcher.*`, the `service-lib/` directory) and
> the supervisor unit (`mempalace-mcp-server.service` or its launchd plist) differ from
> the shell's, and the line `Installed launcher: ...` names the TypeScript launcher;
> nothing else of a run differs, and the test honours the tag for the cells that
> install the daemon and for no other; (t) on win32 the physical path of the
> usage-capture script is written with forward slashes where the shell, which has no
> Windows form, refuses a backslash; a quote, `$`, a backtick or a newline stay
> refused. Letters (u) onward are reserved for deviations a later differential test
> discovers and a delta of this spec records.

## REMOVED

None.
