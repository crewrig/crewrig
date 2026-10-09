---
id: "0253"
slug: history-import-operational-commands-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1331
version: 2.2.0
---

# History import and operational commands in TypeScript

*Delta 03 of `specs/0253-history-import-operational-commands-typescript.md`,
cumulative over `specs/0253-history-import-operational-commands-typescript.delta-01.md`
and `specs/0253-history-import-operational-commands-typescript.delta-02.md`: every
Original quoted below is the current text, that is the parent as modified by
delta-01 then delta-02. Source: a finding made while writing the `windows-history-import`
job of PR C of ticket 1331. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration`. The implementation pull requests realise the
parent plus delta-01, delta-02 and this delta (`docs/spec-pr-workflow.md`,
*Delta-spec cumulative rule*). Every requirement number is unchanged.*

*Version: MINOR, 2.1.0 to 2.2.0 (`docs/spec-format.md`, *Versioning*). The delta
narrows the list of paths the `windows-latest` job of requirement 27 SHALL assert
and adds one scenario and one parity-gap statement. It withdraws only assertions
no implementation can meet on `windows-latest` (see the finding), so no in-flight
implementation is invalidated and none that followed delta-02 stops conforming;
that is an additive, not a breaking, normative change, hence MINOR.*

*Finding, measured while writing the job. The interpreter probe
(`detectMempalacePython` in `scripts/lib/mempalace-python.ts`, which runs
`spawnSync(resolved, [...lead, "-c", "import mempalace.mcp_server"])` at line 274)
and the four importers spawn the interpreter without a shell. Node.js refuses to
spawn a `.cmd` or `.bat` file without `shell: true` and throws `EINVAL` (the
hardening against command injection through batch files on Windows, CVE-2024-27980,
shipped in the Node.js security releases 20.12.2 and 21.7.3, April 2024, and in
every later release line). The repository records the same behaviour at
`scripts/lib/worktree-claim/git.ts` (the comment on `gitCommand`: "only `.exe` is
accepted (a `.cmd` makes `spawnSync` fail with EINVAL)"). The evidence of record
is therefore the Node.js release notes of 20.12.2 and 21.7.3 and that repository
comment; the tree holds no other citation of the advisory. A `.cmd` stub can never
be a successful interpreter on `windows-latest`, which is the stub requirement 27
asked for. This pull request builds no `.exe` stub either (the job has no compiler step; building one, for example with a .NET compile step, is possible and left to a later change), and a copy of `node.exe` named `python.exe` cannot answer the probe (measured: Node.js reads `-c` as `--check` and the argument as a script path, so it exits non-zero and the probe rejects the candidate). Consequences on Windows. The four
importers can only be driven to the missing-interpreter path: a `PATH` that holds no candidate makes the probe find none. `prune-transcripts` takes `MEMPALACE_PYTHON`
with no probe (requirement 18), so it can also be driven through `--help`, argument
validation, the unknown-option hint, and a dry run whose interpreter is
`process.execPath` (`node.exe`): the banner (wing, cutoff date, dry-run flag) is
printed, then Node.js is spawned on the extracted Python body, which it cannot run
as JavaScript, so the exit status is non-zero. Not coverable on Windows: the
missing-source message, the empty-source message, the declined and the confirmed
prompt flows, and the `mine` calls of the four importers, all of which sit behind
a successful probe. They stay covered by the POSIX oracle of PR A (requirement 26)
on Linux and macOS only; the PR A tests are POSIX-only. Requirement 27 asked for
them on Windows and requirement 23 expected the Windows gap to be proved or
disproved; this delta records the limit. No question that this delta can resolve is
left open.*

## ADDED

**Scenario:** The Windows job drives the importers to the missing-interpreter path
and `prune-transcripts` to a dry-run banner

Given `windows-latest`, a temporary home, and, for the importers, a spawned environment whose `PATH` holds no `python`, `py`, `pipx` or `mempalace` (so the probe finds nothing; `node` itself is started by its absolute path)
When PowerShell runs each of `node scripts/import-claude-history.ts`,
`node scripts/import-copilot-history.ts`, `node scripts/import-gemini-history.ts`
and `node scripts/import-antigravity-history.ts`, then `node scripts/prune-transcripts.ts
--help`, `node scripts/prune-transcripts.ts --days 0`, `node scripts/prune-transcripts.ts
--bogus`, `node scripts/prune-transcripts.ts` with `MEMPALACE_PYTHON` set to a
path that does not exist, and `node scripts/prune-transcripts.ts --days 30` with
`MEMPALACE_PYTHON` set to `process.execPath`
Then each importer prints the two missing-interpreter `Error:` lines (on standard output for the Claude, Gemini and Copilot importers, on standard error for the Antigravity importer, as requirement 11 fixes) and exits 1; `--help` prints the usage and exits 0; `--days 0` prints `Error: --days
must be at least 1` and exits 1; `--bogus` prints `Unknown option: --bogus` and
the hint line naming `scripts/prune-transcripts.ts` and exits 1; the missing
interpreter prints `Error: <interpreter> not found` and exits 1; and the dry run
prints the banner with the wing, the cutoff date and the dry-run flag, deletes
nothing, and exits with a non-zero status (Node.js fails on the Python body; the
exact value is not asserted). The job asserts no other outcome of the importers
and no `mine` call.

## MODIFIED

Requirement 27, the sentence on the import scripts and `prune-transcripts` — a `.cmd` stub cannot be spawned without a shell and this pull request builds no `.exe` stub, so the paths behind a successful probe are not driven on Windows. The sentences before
and after it (the usage-wrapper part as modified by delta-01, the `sync-from-upstream`
part, and the closing sentences naming the limit) are unchanged. Original:

> For the import scripts and `prune-transcripts`, which need Python, MemPalace and
> a populated history, the job SHALL assert the deterministic offline paths only:
> the missing-interpreter diagnostic and exit 1, the missing-source diagnostic and
> exit 1, the empty-source message and exit 0, `--help`, argument validation, the
> declined-prompt exit 0 and a dry-run against a stub interpreter (a `.cmd` file named for the candidate
> the Windows lookup of `detectMempalacePython` probes, or set through
> `MEMPALACE_PYTHON` for `prune-transcripts`).

Replacement:

> For the import scripts and `prune-transcripts`, which need Python, MemPalace and
> a populated history, the job SHALL assert the deterministic offline paths that
> Windows can reach, and no others. For each of the four import scripts: the
> missing-interpreter diagnostic and exit 1, reached with a `PATH` that holds no
> candidate `detectMempalacePython` probes. For `prune-transcripts`, which takes
> `MEMPALACE_PYTHON` with no probe: `--help`, argument validation, the
> unknown-option hint, the missing-interpreter diagnostic and exit 1, and a dry run
> whose interpreter is `process.execPath` (`node.exe`), which prints the banner
> (wing, cutoff date, dry-run flag) and exits with a non-zero status because Node.js
> cannot run the Python body. No stub interpreter is used on Windows: the probe and
> the importers spawn the interpreter without a shell, Node.js refuses to spawn a
> `.cmd` or `.bat` file without `shell: true` and throws `EINVAL` (CVE-2024-27980,
> hardened in Node.js 20.12.2 and 21.7.3), so a `.cmd` stub can never be a
> successful interpreter, and this pull request builds no `.exe` stub (the job has no compiler step; a later change MAY build one), and a copy of `node.exe` named `python.exe` cannot answer the probe (measured: Node.js reads `-c` as `--check` and the argument as a script path, so it exits non-zero and the probe rejects the candidate). The missing-source message, the
> empty-source message, the declined and the confirmed prompt flows and the `mine`
> calls of the four import scripts all sit behind a successful probe and are not asserted by the Windows job of this requirement (a later change MAY add them once a stub interpreter that Node.js can spawn exists): they stay covered by the POSIX oracle of PR A
> (requirement 26) on Linux and macOS only, because the PR A tests are POSIX-only.

Requirement 23, the Windows gap — the sentence expected the gap to be proved or
disproved for "the Python and MemPalace availability", which the finding now
settles for the same set of paths. Original, its first clause (the rest of the
sentence and the usage-mirror gap added by delta-01 are unchanged):

> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`;

Replacement:

> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`. The gap is recorded as open (these paths are unverified on Windows, not proved impossible), and SHALL be recorded as a parity gap for (the four import scripts x
> Windows) and (`prune-transcripts` x Windows): on `windows-latest` a `.cmd` or `.bat` stub interpreter cannot be spawned (Node.js 20.12.2 and 21.7.3 refuse them without `shell: true`, CVE-2024-27980) and this pull request builds no `.exe` stub, so the
> end-to-end `mempalace` path, the missing-source and empty-source messages, the
> prompt flows and the `mine` calls of the four import scripts, and everything
> `prune-transcripts` does after it spawns a working interpreter, are covered on
> Linux and macOS only; Windows covers the paths named in requirement 27;

## REMOVED

Nothing is removed.
