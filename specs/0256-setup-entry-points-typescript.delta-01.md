---
id: "0256"
slug: setup-entry-points-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1335
version: 1.1.0
---

# Setup entry points in TypeScript

*Delta 01 of `specs/0256-setup-entry-points-typescript.md`. Source: the PLAN pass of
ticket 1335, section `### Spec gaps (delta-01 candidates)`, found by reading the code
the plan has to port. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Ten requirements of
the parent cannot be met as written, contradict the shell they claim to preserve, or
leave a behaviour unsettled: the stdio entries a CLI spawns on Windows (G1), a failed
Chroma install and its Windows twin (G2), the bearer probe on a non-loopback host (G3),
the file mode on Windows (G4), the one-key `--link` reader (G5), the per-CLI arms of the
daemon contract (G6), the Windows guidance texts (G7), the version range check (G8), the
store-access guidance (G9) and the registration writer (G10). This delta modifies
requirements 16, 25, 26, 27, 28, 31, 32, 39 and 44 and adds scenarios. The version is a
MINOR bump: no requirement is invalidated, each is made satisfiable or exact, and the
deviations (m) to (r) that requirement 44 reserved are recorded. Line references are to
`release/1231-ts-migration` at `da85db8`. This delta opens no question; the open
questions of the parent stand, except that the mapping of the return codes of
`ensure_mempalace_http` is narrowed by the table of requirement 26 below.*

## ADDED

**Scenario:** A Windows stdio MCP entry names the TypeScript trust wrapper

Given Windows with no `bash` on the path, a Claude, Copilot or Antigravity setup that
registers the MemPalace stdio entry and the Sequential Thinking entry, and no
`~/.crewrig/tls-exec.ts` yet
When the setup runs
Then `~/.crewrig/tls-exec.ts` is installed before the first entry is written, each
stdio entry's command is `node` with `<home>/.crewrig/tls-exec.ts` as its first
argument followed by the wrapped command (the Sequential Thinking entry wraps
`npx.cmd`), no entry names `bash`, and the same run on Linux or macOS writes the
entries with `bash` and `scripts/lib/tls-exec.sh` exactly as the shell does.

**Scenario:** A failed Chroma daemon install stops the setup

Given a MemPalace installation that is in range and a Chroma daemon install that
returns failure after printing its `ERROR:` lines
When any of the four setups reaches the Chroma step
Then the exit status is 1, the `ERROR:` lines the install printed are the last output
of the run, no MemPalace registration is written and no later step runs.

**Scenario:** On Windows the Chroma daemon is a scheduled task

Given Windows and a MemPalace installation that is in range
When a setup reaches the Chroma step
Then the Chroma daemon is registered as a scheduled task through
`scripts/lib/service/*`, no `ERROR: unsupported OS` line is printed, and a failure of
that registration is rolled back by `installDaemon` and ends the run as the scenario
above does.

**Scenario:** The probe never sends the bearer to a non-loopback host

Given `MEMPALACE_MCP_HOST=0.0.0.0` and a local daemon
When the daemon contract of requirement 26 probes the endpoint
Then no request carries the `Authorization` header, the result is return code 1, and the
arm of requirement 26 for return code 1 runs for that CLI.

**Scenario:** The key `y` leaves the answers piped behind it unread

Given `--link` and standard input `y\nkeep\n` piped to a setup that asks `rules-action`
When the `link-confirm` question is asked
Then the key is `y`, the warning and the prompt `Continue with symlink mode? [y/N]` (followed by one space)
are the setup scripts' own, and the later `rules-action` question receives `keep` from
the line queue without a second read of the pipe.

**Scenario:** A Gemini, Copilot or Antigravity daemon failure writes nothing further

Given the stdio MemPalace entry already written and `ensure_mempalace_http` returning 1
or 2
When the Gemini, Copilot or Antigravity setup handles the result
Then the three-line `WARNING: mempalace stays on the stdio arrangement` (return code 1)
or the four-line `LOCKOUT WARNING` (return code 2) is printed, the entry is neither
removed nor rewritten, and only the Claude setup removes and re-registers it.

**Scenario:** The version range is judged without `packaging`

Given a MemPalace environment that holds no `packaging` module and an installed
version inside the supported range
When a setup checks the version
Then the check passes, and an empty or unparsable version prints the same two `ERROR`
lines as an out-of-range one and exits 1.

## MODIFIED

**Requirement 16 — The `--link` warning and stdin ownership (G5).** Original, the
first sentence:

> The `--link` mode SHALL print the shell's warning and ask the one-key question of
> `scripts/lib/manage/confirm.ts` reused unchanged (exit 1 with `Aborted. Run without
> --link for secure copy mode.` unless the key is `y` or `Y`; the `--answer
> link-confirm=yes` pre-answer of requirement 13 stands for the key, `no` for any other
> key); the line-mode prompter SHALL be created only after that question, so the two
> readers never contend for standard input.

Replacement:

> The `--link` mode SHALL print the warning of the setup scripts (`WARNING: You are
> using symlink mode for system context files.` to `For production use, prefer copy
> mode (the default).`, `setup-claude-interactive.sh:30-36`) and ask the one-key
> question with the prompt `Continue with symlink mode? [y/N]`
> (`setup-claude-interactive.sh:38`), both verbatim; they are not those of
> `linkWarningLines` or of `CONTINUE_PROMPT` in `scripts/lib/manage/confirm.ts` (`:42`,
> `:51`), which are the manage scripts' texts. The question SHALL be asked by a new
> additive export of `scripts/lib/manage/confirm.ts`, with `confirmContinue` and its
> behaviour untouched, that takes the prompt text and returns the key AND the unread
> remainder of the chunk it received, less one line terminator, because `read -n 1`
> leaves the rest of a pipe in place where `readKey` (`:67-79`) takes the first chunk
> and pauses standard input; the line queue of requirement 11 SHALL serve that
> remainder first. The exit and the pre-answer are unchanged (exit 1 with `Aborted. Run
> without --link for secure copy mode.` unless the key is `y` or `Y`; the `--answer
> link-confirm=yes` pre-answer of requirement 13 stands for the key, `no` for any other
> key); the line-mode prompter SHALL be created only after that question, so the two
> readers never contend for standard input.

**Requirement 25 — MemPalace flow (G1, G2, G8, G10).** Original:

> Each setup SHALL keep the flow: detect the Python interpreter, offer the install when
> none, check the installed version against the range (a version outside the range exits
> 1), install the Chroma daemon, and register or converge the MemPalace MCP entry for
> the CLI. The registration SHALL go through `mempalace-registration.ts`, wrapping the
> launch with the trust wrapper when a TLS file exists.

Replacement:

> Each setup SHALL keep the flow: detect the Python interpreter, offer the install when
> none, check the installed version against the range (a version outside the range, an
> empty version or an unparsable one exits 1 with the two `ERROR` lines of the shell),
> install the Chroma daemon, and register or converge the MemPalace MCP entry for the
> CLI. The range check is evaluated by the setup, not by `packaging` in the MemPalace
> environment (deviation (r)). A failure of the Chroma daemon install exits 1 after the
> install's own `ERROR:` lines, and no later step runs. On Windows the Chroma daemon is
> registered as a scheduled task through `scripts/lib/service/*`, with the rollback
> `installDaemon` provides, where the shell stops with `ERROR: unsupported OS`
> (deviation (n)). The HTTP registration SHALL go through `registerAssistant` of
> `scripts/lib/service/assistant-config.ts`, after a backup of the file and with the
> `claude` remover launched through the platform lookup; the stdio registration is
> written by the setup's own writer; `scripts/lib/mempalace-registration.ts`, which
> writes nothing, classifies the result and supplies the warning text. The stdio launch
> is wrapped with the trust wrapper when a TLS file exists: `bash <repo>/scripts/lib/tls-exec.sh`
> on POSIX, and on win32 `node <home>/.crewrig/tls-exec.ts` followed by the wrapped
> command, the program being installed (`installTrustWrapperProgram`,
> `scripts/lib/service/program-install.ts:147`) before the entry is written
> (deviation (m)). On Windows the messages that name the Chroma binary or the pipx
> installation use the Windows forms (deviation (q)).

**Requirement 26 — The daemon contract (G3, G6).** Original:

> The result of `ensure_mempalace_http` (return code 0: HTTP endpoint ready, keep; 1:
> converge to the stdio launch; 2: keep the existing entry and warn) SHALL be preserved
> for each CLI, including the `LOCKOUT WARNING` text the Gemini setup prints. How the
> contract maps onto the row-D service modules is left to the PLAN (see Open
> questions); the mapping SHALL not change what a run leaves on the machine, and SHALL
> be pinned by the unchanged `test-setup-mempalace-rc-guard.sh` after its retarget
> (requirement 9).

Replacement:

> The result of `ensure_mempalace_http` (return code 0: HTTP endpoint ready, keep; 1: no
> usable serving daemon; 2: the daemon verified serving but the registration could not
> be completed) SHALL be preserved for each CLI as the arm the shell runs for it
> (`setup-claude-interactive.sh:232-264`, `setup-gemini-interactive.sh:247-267`,
> `setup-copilot-interactive.sh:316-336`, `setup-antigravity-interactive.sh:270-290`):
>
> | Return code | Claude | Gemini, Copilot, Antigravity |
> |---|---|---|
> | 0 | the entry is kept and counted installed, nothing printed | prints `MemPalace reaches shared memory through the HTTP daemon.` |
> | 1 | removes the user-scope entry, registers the stdio entry, prints `Converged mempalace to the stdio http-wrapper entry (no serving daemon available).` or, when even that fails, `ERROR: could not register even the stdio fallback for mempalace.` | prints `WARNING: mempalace stays on the stdio arrangement — no shared`, `daemon could be established. Sessions will contend for`, `the palace writer lock until the daemon is up.` |
> | 2 | keeps an existing entry and prints `Existing mempalace registration kept (the daemon is verified serving).`, or prints `WARNING: no mempalace registration could be written although the daemon is verified serving.` when there is none | prints the four-line `LOCKOUT WARNING: the daemon is verified serving but registration` text of the shell |
>
> Every message is printed with the indentation the shell prints: two leading spaces, and the continuation lines of a multi-line warning aligned under the first line's text. The prompt of the one-key question ends with one space.
>
> For Gemini, Copilot and Antigravity the stdio entry is written BEFORE the daemon is
> ensured, as `test-mcp-daemon.sh` pins, and return codes 1 and 2 write nothing
> further; only Claude removes and re-registers. The bearer token of the probe is
> never sent to a non-loopback host, as `scripts/lib/service/probe.ts:59` refuses (spec
> 0252): a run configured with `MEMPALACE_MCP_HOST` set to such a host takes return
> code 1 (deviation (o)). How the contract maps onto the row-D service modules is left
> to the PLAN (see Open questions); the mapping SHALL not change what a run leaves on
> the machine, and SHALL be pinned by the unchanged `test-setup-mempalace-rc-guard.sh`
> after its retarget (requirement 9).

**Requirement 27 — MCP registration per CLI (G4).** Original, the last sentence:

> Every written JSON file SHALL be backed up first, written atomically and, where the
> shell restricted it, mode 0600.

Replacement:

> Every written JSON file SHALL be backed up first, written atomically and, where the
> shell restricted it, mode 0600; on win32 the mode is not set, the profile ACL
> applying as in spec 0252 (`scripts/lib/service/assistant-config.ts:88`,
> `scripts/lib/service/token.ts:95-103`; deviation (p)).

**Requirement 28 — Organisation MCP and Sequential Thinking (G1).** Original:

> The organisation MCP declaration SHALL be folded into each CLI's configuration
> through `org-mcp.ts` (for Claude, through `claude mcp add`), and the Sequential
> Thinking opt-in SHALL register the server wrapped as `tls-exec.sh npx -y
> @modelcontextprotocol/server-sequential-thinking` where the shell does.

Replacement:

> The organisation MCP declaration SHALL be folded into each CLI's configuration
> through `org-mcp.ts` (for Claude, through `claude mcp add`), and the Sequential
> Thinking opt-in SHALL register the server wrapped as `tls-exec.sh npx -y
> @modelcontextprotocol/server-sequential-thinking` where the shell does. On win32 a
> stdio command the setup registers SHALL name `node <home>/.crewrig/tls-exec.ts`
> followed by the wrapped command in place of `bash <repo>/scripts/lib/tls-exec.sh`,
> the setup installing that program before it writes the first entry, and the `npx` of
> this entry is `npx.cmd`, resolved through the platform lookup; on POSIX the entry is
> unchanged, and a carrier file still holds one wrapper reference (deviation (m)).

**Requirement 31 — Settings files (G4).** Original:

> Every settings and hook file a setup writes SHALL be byte-identical to the shell's
> output for the inputs it handles, mode 0600 where the shell set it, backed up first
> (`<file>.bak` rule of `backup_file`), and written atomically (requirement 44(j)); a
> file that is not valid JSON SHALL name the file in a one-line error (requirement
> 44(j)).

Replacement:

> Every settings and hook file a setup writes SHALL be byte-identical to the shell's
> output for the inputs it handles, mode 0600 where the shell set it and the platform
> is not win32 (deviation (p)), backed up first (the rule of `backup_file`, which names
> the copy `<file>.bak.<YYYYMMDD-HHMMSS>[.NN]`), and written atomically (requirement
> 44(j)); a file that is not valid JSON SHALL name the file in a one-line error
> (requirement 44(j)).

**Requirement 32 — Session check (G9).** Original, the closing clause:

> […] and print the closing summary of the shell (the rules installed, the registered
> servers for the CLI, and the store-access guidance).

Replacement:

> […] and print the closing summary of the shell (the rules installed, the registered
> servers for the CLI and, for the Gemini and Copilot setups only, the store-access
> guidance, `print_store_access_guidance` being called by those two setups alone,
> `setup-gemini-interactive.sh:526` and `setup-copilot-interactive.sh:512`).

**Requirement 39 — No POSIX tool (G1).** Original, the second sentence:

> They SHALL NOT spawn `fzf`, `jq`, `find`, `sed`, `awk`, `wc`, `diff`, `grep`, `ls`,
> `cp`, `mv`, `rm`, `mktemp`, `curl` or `bash`.

Replacement:

> They SHALL NOT spawn `fzf`, `jq`, `find`, `sed`, `awk`, `wc`, `diff`, `grep`, `ls`,
> `cp`, `mv`, `rm`, `mktemp`, `curl` or `bash`, and on win32 no stdio command they
> register SHALL name `bash` either, since the CLI that later spawns it has none
> (requirement 28).

**Requirement 44 — Listed deviations (m) to (r).** Original, the closing sentence:

> Letters (m) onward are reserved for deviations the plan's differential test
> discovers and a `delta-01` of this spec records.

Replacement, tagged in the differential test like (a) to (l):

> (m) on Windows the stdio MCP entries (the MemPalace entry and the Sequential
> Thinking entry) name the TypeScript trust wrapper `node <home>/.crewrig/tls-exec.ts`
> where the shell names `bash <repo>/scripts/lib/tls-exec.sh`, and `npx.cmd` for
> `npx`; (n) on Windows the Chroma daemon is installed as a scheduled task where the
> shell stops with `unsupported OS` (a failure of the Chroma install exits 1 on every
> platform, as the shell's `set -e` does, so it is wording and not a deviation); (o) the MemPalace
> daemon probe never sends the bearer token to a non-loopback host (spec 0252), so a run
> configured with such a host takes return code 1 where the shell probed with
> authentication; (p) on win32 the mode of a written file is not set, and the
> `windows-setup-entries` job of requirement 34 does not assert one; (q) on win32 the
> pipx guidance and the Chroma binary path in messages are the Windows forms
> (`<venv>\Scripts\chroma.exe`, `py -m pip`, `scoop install pipx`) where the shell names
> `python3`, `brew` and `<py dir>/chroma`; (r) the supported-range check of the MemPalace
> version is evaluated by the setup and no longer needs `packaging` in the MemPalace
> environment, so the run that the shell stopped for lack of `packaging` now passes when
> the version is in range, while an empty or unparsable version stays out of range.
> Letters (s) onward are reserved for deviations a later differential test discovers
> and a delta of this spec records.

## REMOVED

None.
