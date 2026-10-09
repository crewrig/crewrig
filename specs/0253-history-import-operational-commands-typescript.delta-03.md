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
delta-01 then delta-02. Source: a finding made while writing the
`windows-history-import` job of PR C of ticket 1331. It runs under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`:
its spec-PR targets `release/1231-ts-migration`, and the base ref of every
protocol is `origin/release/1231-ts-migration`. The implementation pull requests
realise the parent plus delta-01, delta-02 and this delta (`docs/spec-pr-workflow.md`,
*Delta-spec cumulative rule*). Every requirement number is unchanged.*

*Version: MINOR, 2.1.0 to 2.2.0 (`docs/spec-format.md`, *Versioning*). The delta
corrects the mechanism by which requirement 27 obtains an interpreter on Windows
and keeps the full list of paths the job asserts; it adds one scenario and one
parity-gap statement to requirement 23. No implementation in flight is invalidated, since the Windows job of PR C is the first and is written to the corrected mechanism; an additive normative change, hence MINOR.*

*Finding, measured while writing the job. The interpreter probe
(`detectMempalacePython` in `scripts/lib/mempalace-python.ts`, which runs
`spawnSync(resolved, [...lead, "-c", "import mempalace.mcp_server"])` at line 274)
and the four importers spawn the interpreter without a shell. Node.js refuses to
spawn a `.cmd` or `.bat` file without `shell: true` and throws `EINVAL` (the
hardening against command injection through batch files on Windows, CVE-2024-27980,
shipped in the Node.js security releases 20.12.2 and 21.7.3). The repository
records the same behaviour at `scripts/lib/worktree-claim/git.ts` (the comment on
`gitCommand`: "only `.exe` is accepted (a `.cmd` makes `spawnSync` fail with
EINVAL)"). The evidence of record is the Node.js release notes of those two
versions and that repository comment; the tree holds no other citation of the
advisory. Requirement 27's parenthetical, "a `.cmd` file named for the candidate
the Windows lookup of `detectMempalacePython` probes", therefore names a mechanism
that cannot work. The full list of paths is nevertheless coverable on
`windows-latest` through another mechanism, measured in the job
`windows-history-import` of pull request #1530 (head `09d0858`), which passed on
`windows-latest`
(<https://github.com/crewrig/crewrig/actions/runs/37983663078>): the runner's real
Python (3.12, provisioned by `actions/setup-python@v5`) together with a fake
`mempalace` package that the test writes into a temporary directory and puts on
`PYTHONPATH`. The package holds `mempalace/__init__.py`; `mempalace/__main__.py`,
which appends `sys.argv[1:]` as one JSON line to the file named by
`MEMPALACE_FAKE_LOG` and exits with the integer in `MEMPALACE_FAKE_EXIT`; and
`mempalace/mcp_server.py` with dummy `tool_list_drawers` and `tool_delete_drawer`.
It satisfies the interpreter probe (`<python> -c "import mempalace.mcp_server"`),
the `<python> -m mempalace mine ...` calls and `scripts/lib/history-import/prune_drawers.py`
unchanged. That job ran `scripts/tests/history-import-python.test.ts` (the four
importers) and `scripts/tests/history-import-prune-python.test.ts`
(`prune-transcripts`) and printed per-command wall times. What the measurement does
not cover is a real `mempalace` on Windows: the tests use a fake package, so the real-MemPalace end-to-end path stays unverified there, which requirement 23 records; the same path is not exercised on Linux and macOS either, where the oracle of PR A drives stub interpreters, so the original sentence closing requirement 27, which claimed that coverage, is withdrawn by this delta. No question that this delta can resolve is left open.*

## ADDED

**Scenario:** The Windows job drives the importers and `prune-transcripts` through a
fake `mempalace` package

Given `windows-latest` with Python provisioned by `actions/setup-python`, and a
fake `mempalace` package on `PYTHONPATH` whose `mine` logs its arguments
When PowerShell runs each of the four importers with `yes` then `yes` on standard
input, then `node scripts/prune-transcripts.ts --days 30`, then `node
scripts/prune-transcripts.ts --days 30 --apply`
Then the fake `mine` log shows the dry-run call, then the real call, each with
`--mode convos --wing transcripts --agent <label> --extract exchange`; each importer
prints `Import complete` and exits 0; the dry run of `prune-transcripts` lists
exactly the rooms older than the cutoff and deletes none; and `--apply` deletes
exactly those rooms through the fake `tool_delete_drawer`. The same tests assert, on
the same runner, the missing-interpreter diagnostic with exit 1 (on standard output
for the Claude, Gemini and Copilot importers, on standard error for the Antigravity
importer, as requirement 11 fixes), the missing-source diagnostic with exit 1, the
empty-source message with exit 0, the declined prompt with exit 0, `--help`, and
argument validation.

## MODIFIED

Requirement 27, the sentence on the import scripts and `prune-transcripts` — the
list of paths is kept; only the stub mechanism is replaced, because a `.cmd` file
cannot be spawned by Node.js without a shell (see the finding). The sentences
before and after it (the usage-wrapper part as modified by delta-01, the
`sync-from-upstream` part) are unchanged; the sentence that closes the
requirement is replaced with it, since its claim about Windows no longer holds.
Original:

> For the import scripts and `prune-transcripts`, which need Python, MemPalace and
> a populated history, the job SHALL assert the deterministic offline paths only:
> the missing-interpreter diagnostic and exit 1, the missing-source diagnostic and
> exit 1, the empty-source message and exit 0, `--help`, argument validation, the
> declined-prompt exit 0 and a dry-run against a stub interpreter (a `.cmd` file named for the candidate
> the Windows lookup of `detectMempalacePython` probes, or set through
> `MEMPALACE_PYTHON` for `prune-transcripts`).
> The job states this limit in its name or comments; the end-to-end `mempalace`
> path is covered on Linux and macOS only, and recorded as such in requirement 23.

Replacement:

> For the import scripts and `prune-transcripts`, which need Python, MemPalace and
> a populated history, the job SHALL assert the deterministic offline paths only:
> the missing-interpreter diagnostic and exit 1, the missing-source diagnostic and
> exit 1, the empty-source message and exit 0, `--help`, argument validation, the
> declined-prompt exit 0, the confirmed-prompt flow with its dry-run and real `mine` calls and a failing `mine`, and, for `prune-transcripts`, a dry run, `--apply` and `--project`, all against a fake `mempalace` package. The
> interpreter is the runner's real Python, provisioned by `actions/setup-python`,
> not a stub executable: the test writes a fake `mempalace` package into a temporary
> directory and puts it on `PYTHONPATH`. The package holds `mempalace/__init__.py`;
> `mempalace/__main__.py`, which appends `sys.argv[1:]` as one JSON line to the file
> named by `MEMPALACE_FAKE_LOG` and exits with the integer in `MEMPALACE_FAKE_EXIT`;
> and `mempalace/mcp_server.py` with dummy `tool_list_drawers` and
> `tool_delete_drawer`. It answers the interpreter probe, the `mine` calls and the
> extracted `prune_drawers.py` unchanged. A `.cmd` or `.bat` stub cannot be used:
> the probe and the importers spawn the interpreter without a shell, and Node.js
> 20.12.2 and 21.7.3 (CVE-2024-27980) refuse to spawn such a file without
> `shell: true` and throw `EINVAL`. The same suite also runs on Linux and macOS.
> The job states in its comments that the interpreter is the runner's real Python
> with a fake `mempalace` package; a real `mempalace` with a real palace is not exercised by this job; the original claim that the end-to-end path is covered on Linux and macOS is withdrawn, since the Bash-driven oracle of PR A also drives stub interpreters, so the unverified real-MemPalace path is the same on the three platforms and is recorded for Windows, the platform of the parity rule, in requirement 23.

Requirement 23, the Windows gap — the sentence must agree with requirement 27: the
paths are verified on Windows against a fake package, and only a real `mempalace`
is not. Original, its first clause (the rest of the sentence and the usage-mirror
gap added by delta-01 are unchanged):

> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`;

Replacement:

> The expected gaps to prove or disprove on Windows are the Python and MemPalace
> availability for the four import scripts and `prune-transcripts`. Measured: every
> flow of these scripts is verified on `windows-latest` against a fake `mempalace`
> package on the runner's real Python (requirement 27), and a real `mempalace` installed on Windows with a real palace is unverified (it is equally unexercised on Linux and macOS, where the oracle of PR A also uses stub interpreters; the parity rule records the Windows cell). That SHALL be recorded as a
> parity gap for (the four import scripts x Windows) and (`prune-transcripts` x
> Windows) in the words "real MemPalace on Windows unverified; every flow of the
> scripts verified against a fake package";

## REMOVED

Nothing is removed.
