---
id: "0253"
slug: history-import-operational-commands-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1331
version: 2.0.0
---

# History import and operational commands in TypeScript

*Delta 01 of `specs/0253-history-import-operational-commands-typescript.md`.
Source: the PLAN of ticket 1331
(<https://github.com/crewrig/crewrig/issues/1331#issuecomment-6086354400>), whose
opening list of spec findings S1 to S7 was re-checked against the tree before this
text was written. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration`. The implementation pull requests realise the
parent plus this delta (`docs/spec-pr-workflow.md`, *Delta-spec cumulative rule*).
This delta corrects the parent where the tree contradicts it, and in two places
adds a deviation or a parity gap the parent did not list. The version is a MAJOR
bump: requirement 26 (the oracle PR A must write) and requirement 25 (the closed
deviation list) are modified in a way that invalidates an implementation that
followed the parent's wording. Every requirement number is unchanged.*

*Findings measured and confirmed in the tree. S1: the ratchet
(`scripts/check-ratchet.ts`, `ci/shell-allowlist.txt`, parent requirement 10)
forbids a new tracked shell file, so the oracle of requirement 26 cannot be Bash.
S2: `scripts/tests/test-usage-capture.sh` runs only `backfill.js` and greps the
shim (lines 424 and 432) and `scripts/tests/test-usage-storage.sh` only
intercepts `usage-mirror.sh` as a sentinel (lines 744 to 762). S3:
`scripts/lib/usage-store/mirror.js` lines 275 and 276 spawn `bash
scripts/usage-mirror.sh --from-write`. S4: that grep never reads
`usage-backfill.ts`. S5: `readTlsEnv` is all-or-nothing, the shell is not. S7:
`usage-task` has the subcommands `set`, `show` and `clear` only
(`scripts/usage-task.sh` header, `scripts/lib/usage-store/declaration.js` lines
197 to 217), not `read`. Every other named suite was confirmed by its executing
line. No question that this delta can resolve is left open.*

## ADDED

**Scenario:** A well-formed trust file overrides an inherited variable

Given a temporary home holding `~/.crewrig/tls-env.sh` with the line `export
SSL_CERT_FILE=<path-a>`, an inherited `SSL_CERT_FILE=<path-b>`, and a recording
interpreter stub
When `prune-transcripts` runs (through the `.sh` path against the shell version,
then through the shim against the TypeScript version, with the same assertions)
Then the environment recorded by the interpreter stub, and by a `pipx` stub
answering `pipx environment --value PIPX_HOME`, holds `SSL_CERT_FILE=<path-a>`.

**Scenario:** A malformed trust file applies nothing and the run continues

Given `~/.crewrig/tls-env.sh` whose second line is not a variable assignment the
format of `scripts/lib/tls-env.ts` allows, and an inherited `SSL_CERT_FILE`
When `node scripts/prune-transcripts.ts --days 30` runs
Then exactly one line beginning `Warning:` is written to standard error naming the
file and line 2, the interpreter stub sees the inherited `SSL_CERT_FILE` and no
variable of the file, and the exit status is the one the run would have had with no
trust file.

**Scenario:** The oracle answers the import prompts through both channels

Given the import oracle of requirement 26 with an `fzf` stub whose scripted answers
are `yes` then `y`, and the same two answers as lines on standard input
When the oracle runs against `scripts/import-claude-history.sh` before the
migration and against the same path through the shim after it
Then the same assertions pass in both runs, with no assertion edited by the pull
request that migrates the import scripts.

**Scenario:** The back-fill entry names neither MemPalace nor an import script

Given `scripts/usage-backfill.ts` and `scripts/usage-backfill.sh`
When the unit test of requirement 9 searches both, case-insensitively, for
`mempalace` and `import-<cli>-history`
Then neither file matches.

## MODIFIED

Requirement 9 — the oracle never reads the TypeScript entry, so the constraint on
it needs a test of its own, and the line the oracle checks is 424. Original:

<!-- markdownlint-disable-next-line MD029 -->
> 9. **No reference to MemPalace in the back-fill entry.**
> `scripts/usage-backfill.ts` and its shim SHALL NOT contain the strings
> `mempalace` or `import-<cli>-history`, because
> `scripts/tests/test-usage-capture.sh` (section 5, requirement 24 check, line 422)
> greps the shim and `backfill.js` for them and is an unchanged oracle.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 9. **No reference to MemPalace in the back-fill entry.**
> `scripts/usage-backfill.ts` and its shim SHALL NOT contain the strings
> `mempalace` or `import-<cli>-history`, in any letter case, comments included.
> `scripts/tests/test-usage-capture.sh` (the R24 check, line 424) greps only the
> shim (`usage-backfill.sh`) and `backfill.js`, case-insensitively, and never
> `usage-backfill.ts`; it is an unchanged oracle for those two files only. The
> pull request that migrates the usage wrappers SHALL therefore carry a unit test
> asserting that `scripts/usage-backfill.ts` and `scripts/usage-backfill.sh`
> contain neither string, matched case-insensitively.

Requirement 18, the sentence on the trust file — the precedence claim holds for a
well-formed file only. Original:

<!-- markdownlint-disable-next-line MD029 -->
> The custom-CA variables of `~/.crewrig/tls-env.sh` SHALL be applied to the child
> environment through `readTlsEnv` (no sourcing of a shell file), with the
> precedence that sourcing gave today (requirement 25, item 8 and *Open
> questions*); the import scripts do not read `tls-env.sh` today and keep not
> doing so.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> The custom-CA variables of `~/.crewrig/tls-env.sh` SHALL be applied through
> `readTlsEnv` (no sourcing of a shell file). When `readTlsEnv` returns `ok`, the
> child environment SHALL be `{ ...process.env, ...vars }` for every child the
> entry spawns, including `pipx environment --value PIPX_HOME`, which reproduces
> the precedence that sourcing gave today: a value in the file overrides an
> inherited variable of the same name. When it returns `absent`, nothing is
> applied. When it returns `malformed` or `unreadable`, requirement 25, item 9
> applies, and the precedence of sourcing is not reproduced. A test SHALL prove the
> well-formed precedence (see the first scenario of this delta). The import scripts
> do not read `tls-env.sh` today and keep not doing so.

Requirement 23 — the usage mirror has a consumer outside this spec's edit set, and
Windows has no `bash`. Original, its last sentence:

<!-- markdownlint-disable-next-line MD029 -->
> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`; the Copilot
> usage back-fill reads `~/.copilot/session-store.db`, unchanged here.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`; the Copilot
> usage back-fill reads `~/.copilot/session-store.db`, unchanged here. One gap is
> certain and SHALL be recorded as a parity gap for (usage mirror x Windows): on
> a journal write that passes the gates of `onWrite` (a token file present, no
> backoff stamp younger than `CREWRIG_USAGE_MIRROR_BACKOFF_MS`, and
> `CREWRIG_USAGE_MIRROR` not `0`) `scripts/lib/usage-store/mirror.js` (lines 275
> and 276) spawns `bash scripts/usage-mirror.sh --from-write` detached, and Windows
> has no `bash`. The evidence is that code line; the plan records whether the spawn failure
> is handled, which no `error` listener on that spawn suggests it is not. This
> spec does not edit that JavaScript file (it is outside the edit set of
> requirement 22 and ratchet-exempt): the shim keeps the spawn working on POSIX, and
> the gap is pre-existing and not fixed here. `docs/cli-matrix.md` SHALL carry the
> gap on the row naming the usage mirror, or, when no row names it, in a note on
> row 11 or row 8d that the plan names.

Requirement 25, item 8 and the closing sentence — the precedence holds for a
well-formed file, and a ninth deviation covers the other two outcomes of
`readTlsEnv`. Original, item 8:

<!-- markdownlint-disable-next-line MD029 -->
> TLS variables come from `readTlsEnv` instead of sourcing `tls-env.sh`
> (requirement 18), with the precedence preserved.

Replacement of item 8 and addition of item 9 (the closing sentence of the
requirement, "Any further difference the oracle reveals SHALL be added by a
delta-spec before its pull request merges", is unchanged):

> Item 8: TLS variables come from `readTlsEnv` instead of sourcing `tls-env.sh`
> (requirement 18), with the sourcing precedence preserved for a well-formed
> file.
>
> Item 9: a malformed or unreadable trust file applies no variable at all, where
> the shell executes whatever the file holds, partly applied and possibly aborting
> under `set -e` or failing in `.`. `prune-transcripts` prints one line beginning
> `Warning:` on standard error that names the file and, when `readTlsEnv` reports
> one, the line, and the run continues with the inherited environment.

Requirement 26 — PR A cannot add Bash tests, the table named two suites that do
not run their script, and the import oracle must hold across requirement 12's
`fzf` to `readline` change. Original, from "Scripts with an existing suite" to the
end:

<!-- markdownlint-disable-next-line MD029 -->
> Scripts with an existing suite: `usage-attribute`
> (`test-usage-attribution.sh`, `test-usage-pricing.sh`, `test-usage-dashboard.sh`),
> `usage-backfill` (`test-usage-capture.sh`), `usage-dashboard`
> (`test-usage-dashboard.sh`, `test-usage-pricing.sh`), `usage-mirror`
> (`test-usage-storage.sh`, `test-usage-storage-mirror.sh`), `usage-price`
> (`test-usage-pricing.sh`, `test-usage-dashboard.sh`), `usage-prune` and
> `usage-query` (`test-usage-storage.sh`, `test-usage-attribution.sh` and the
> others that name them), `sync-from-upstream` (`test-sync-from-upstream.sh`).
> The plan SHALL confirm that each named suite executes its script and not merely
> names it. No test references `usage-drain.sh`, `usage-task.sh`, the four import
> scripts or `prune-transcripts.sh`: PR A SHALL add black-box Bash tests for
> those seven, with stubbed `python` / `mempalace` (for the import scripts, a
> `python3` stub first on `PATH` that answers the `import mempalace.mcp_server`
> probe and records the arguments of `-m mempalace mine`, since they ignore
> `MEMPALACE_PYTHON`; for `prune-transcripts`, a stub on `MEMPALACE_PYTHON`
> recording its environment) and prompts answered on standard input, covering at
> least the scenarios of this spec. A script and its Bash test SHALL NOT migrate
> in the same pull request: the Bash tests migrate later in J1a (#1340), not here.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> Scripts with an existing suite that executes them: `usage-attribute`
> (`test-usage-attribution.sh`, `test-usage-pricing.sh`,
> `test-usage-dashboard.sh`), `usage-dashboard` (`test-usage-dashboard.sh`,
> `test-usage-pricing.sh`), `usage-mirror` (`test-usage-storage-mirror.sh` alone),
> `usage-price` (`test-usage-pricing.sh`, `test-usage-dashboard.sh`), `usage-prune`
> and `usage-query` (`test-usage-storage.sh`, `test-usage-attribution.sh` and the
> others that run them), `sync-from-upstream` (`test-sync-from-upstream.sh`). The
> executing lines were confirmed: `test-usage-attribution.sh`,
> `test-usage-pricing.sh` and `test-usage-dashboard.sh` run `usage-attribute.sh`;
> `test-usage-pricing.sh` and `test-usage-dashboard.sh` run `usage-dashboard.sh`
> and `usage-price.sh`; `test-usage-storage.sh` and `test-usage-attribution.sh`
> run `usage-prune.sh` and `usage-query.sh`; `test-sync-from-upstream.sh` runs
> `sync-from-upstream.sh`. Two named suites do not run their script. The oracle of
> `usage-mirror` is `test-usage-storage-mirror.sh` alone, because
> `test-usage-storage.sh` only intercepts `usage-mirror.sh` as a sentinel in a stub
> `bash`. `test-usage-capture.sh` does not run `usage-backfill.sh`: it greps the
> shim and `backfill.js` and runs `backfill.js` directly, so `usage-backfill` has
> no executing oracle for its shim forwarding or its `--reset-cursors` option. No
> test references `usage-drain.sh`, `usage-task.sh`, the four import scripts or
> `prune-transcripts.sh`. PR A SHALL therefore add black-box tests for those
> eight scripts (the seven above and `usage-backfill`).
>
> **Form of the tests.** The ratchet (`scripts/check-ratchet.ts`,
> `ci/shell-allowlist.txt`, parent requirement 10) forbids any new tracked shell
> file, so the tests SHALL be TypeScript `node:test` files under `scripts/tests/`
> named `*.test.ts`, in the shape of `scripts/tests/usage-inventory.test.ts`, and
> SHALL add no `.sh` file. Each drives the `.sh` path as a subprocess, black-box,
> with stubs written at run time into a temporary directory and never tracked, so
> that it passes against the shell version today and, unchanged, through the shim
> after the migration. These tests need a POSIX `bash` and run on the Linux and
> macOS jobs only.
>
> **Stubs.** For the import scripts, a `python3` stub first on `PATH` that
> answers the `import mempalace.mcp_server` probe and records the arguments of
> `-m mempalace mine`, since they ignore `MEMPALACE_PYTHON`, and an `fzf` stub; for
> `prune-transcripts`, a stub on `MEMPALACE_PYTHON` recording its environment,
> and the trust-file precedence assertion of requirement 18. The tests cover the
> scenarios of this spec that the shell version can satisfy today: import with no
> sessions, missing prerequisite, declined and confirmed prompts, the Antigravity
> temporary directory, prune dry run, `--apply` and argument validation, the
> `usage-drain` arguments and budget, and `usage-task` `set`, `show` and `clear`.
> The scenarios that exist only for the TypeScript version (the malformed trust
> file, the `node` form of `usage-task` against its shim, the substring test on
> `usage-backfill.ts`, the self-update of the sync) belong to the tests of the
> pull request that migrates the script.
>
> **Dual-channel answers.** The import oracle SHALL give each scripted answer
> through both channels at once: as a line on the script's standard input, which
> the `readline` prompt of the TypeScript version reads, and as the next scripted
> answer of the `fzf` stub, which the shell version reads. The same assertions then
> pass against the shell version and against the TypeScript version without an
> edit in the pull request that migrates the import scripts, and the `fzf` stub is
> inert for the TypeScript version, which never spawns `fzf`. This is how deviation
> 1 of requirement 25 (`fzf` to `readline`, requirement 12) stays compatible with
> parent requirement 13, which asks for an oracle that passes unchanged. A script
> and its test SHALL NOT migrate in the same pull request, and no pull request
> SHALL change an assertion of an oracle test it makes pass: the existing Bash
> tests migrate later in J1a (#1340), not here.

Requirement 27, the usage-wrapper sentence — `read` is not a subcommand. Original:

<!-- markdownlint-disable-next-line MD029 -->
> For the usage wrappers: a real command (for example `usage-query` on an empty
> store, `usage-task set` then `read`).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> For the usage wrappers: a real command (for example `usage-query` on an empty
> store, `usage-task set` then `show`; the subcommands of `usage-task` are `set`,
> `show` and `clear`).

Scenario "A usage wrapper runs from PowerShell on Windows" — `read` replaced by
`show`. Original, its `When` and `Then` lines:

<!-- markdownlint-disable-next-line MD029 -->
> When PowerShell runs `node scripts/usage-query.ts --rollup`, then `node
> scripts/usage-task.ts set --task-key 1331 --channel protocol` and `node
> scripts/usage-task.ts read`
> Then each exits with the status of its JavaScript command line, the declaration
> read back names task 1331 and channel `protocol`, and no Node.js warning is printed.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> When PowerShell runs `node scripts/usage-query.ts --rollup`, then `node
> scripts/usage-task.ts set --task-key 1331 --channel protocol` and `node
> scripts/usage-task.ts show`
> Then each exits with the status of its JavaScript command line, the declaration
> shown names task 1331 and channel `protocol`, and no Node.js warning is printed.

Open questions — the second is resolved by this delta, the first is kept. Original,
the second item:

<!-- markdownlint-disable-next-line MD029 -->
> **Precedence of `tls-env.sh` variables.** Sourcing `~/.crewrig/tls-env.sh` lets
> the file override an inherited variable; `readTlsEnv` (spec 0247) returns the
> parsed values. The PLAN SHALL verify the semantics match and either apply them as
> the child environment or add a delta-spec listing a deviation.

Replacement: removed. It is settled by the modified requirements 18 and 25 above
(precedence preserved for a well-formed file, deviation 9 for a malformed or
unreadable one). The first open question, the stability of D's interface, is kept
as written: `ls specs` shows no spec 0252 on the release branch, and
`scripts/lib/mempalace-python.ts` and `scripts/lib/mempalace-pin.ts` do not exist
there yet, so the interface D froze cannot be confirmed from the tree.

## REMOVED

Nothing is removed, except the second open question of the parent, replaced as
shown in the section above.
