---
id: "0243"
slug: usage-capture-hooks-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1326
version: 1.0.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Sub-spec C1 of the `large`-tier ticket #1231, row C1 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24),
under the release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`
(requirements 27–38): this spec-PR and its implementation PR target
`release/1231-ts-migration`, and "shipped" means merged there, not reached
`main`. Discharges parent requirements 9, 14, 15, 17 and 19 for the two scripts
below, and builds the installed-command rewrite that the other hook rows reuse.
Depends on sub-spec A2, `specs/0240-runtime-foundations-shared-ts-modules.md`
with its `delta-01` (the shared `scripts/lib/paths.ts`, `tmp-file.ts`,
`require-dependency.ts`, the `windows-latest` job template and
`scripts/check-timing-budget.ts`), and on sub-spec B,
`specs/0237-windows-hook-cli-matrix.md` (rows 37–37d of `docs/cli-matrix.md`,
the measured Windows command-line matrix). It inherits the behavioural
contracts of `specs/0206-capture-adapters.md`,
`specs/0211-usage-capture-opt-in.md` and
`specs/0241-antigravity-statusline-shim-prior-command.md` and preserves them
except for the deviations listed in requirement 27.*

## Intent

A user on Windows, macOS or Linux who has enabled usage capture keeps getting
exactly the records they got before, and the two things that produce them — the
capture hook that Claude Code, Gemini CLI and Copilot CLI fire at the end of a
turn or a session, and the status-line command that Antigravity CLI runs to
draw its status bar — no longer need a POSIX shell. Each of the four CLIs runs
a command line written in the form its own interpreter on Windows can parse. A
hook firing that has nothing new to capture costs a stated, small amount of
time, and a status line that had a prior command keeps showing that command's
output and never shows the raw payload. A machine that already has capture
installed is brought to the new form the next time the user runs setup, without
duplicating or disturbing any other hook the user or the framework registered,
and the mechanism that does so is the one the other hook migrations reuse.

## Requirements

1. **Two TypeScript entry points.** `hooks/usage-capture.ts` and
   `hooks/antigravity-statusline-shim.ts` SHALL replace the behaviour of
   `hooks/usage-capture.sh` and `hooks/antigravity-statusline-shim.sh`, each
   runnable as a direct `node` command line with no dispatcher and no
   intermediate CrewRig entry point (parent requirements 1 and 15), each at the
   path of its shell predecessor with `.sh` changed to `.ts` (parent
   requirement 9, spec 0240 requirement 11), and each written to the
   TypeScript conventions of parent requirement 2 (erasable syntax, strict
   typing, every value entering from standard input, the environment or a
   file typed `unknown` and narrowed before use, no file over the 300-line
   warning threshold).

2. **Forwarding shims.** `hooks/usage-capture.sh` and
   `hooks/antigravity-statusline-shim.sh` SHALL remain, each reduced to a
   forwarding shim that only invokes its TypeScript counterpart with the
   arguments and standard input it received, so an installation whose command
   line still names the `.sh` path keeps capturing until setup rewrites it.
   Each shim SHALL stay on the ratchet allowlist without adding an entry
   (parent requirement 10) and SHALL preserve the exit-zero contract of
   requirement 5: it exits zero and writes nothing to standard error on every
   failure, including a `node` executable that is missing from the search path.

3. **No intermediate hop.** On the default path, the capture derivation SHALL
   run inside the hook's own process, and `scripts/lib/usage-capture/cli.js`
   SHALL NOT be a process the hook spawns. The tracked JavaScript set SHALL NOT
   grow (parent requirements 11 and 16): `cli.js` SHALL either be retired or
   converted to TypeScript by this ticket's implementation PR, and the choice
   is the plan's. Its `--cli`, `--event`, `--payload-file` argument contract
   survives only as the test-only override contract of requirement 9.

4. **Arguments and payload.** `hooks/usage-capture.ts` SHALL take the CLI
   identifier (`claude-code`, `gemini-cli` or `copilot-cli`) and the firing
   event name as its first two positional arguments and the CLI's payload on
   standard input, and SHALL forward the event name to the capture step
   verbatim. It SHALL read the whole payload before it makes any decision, so
   the guard of requirement 6 can never consume bytes the capture step needs.

5. **Exit-zero and silence (spec 0206 requirement 15).** Whatever fails —
   an unreadable or malformed payload, a missing or unwritable usage root, a
   capture step that throws, a test override that does not exist — the hook
   SHALL exit with status zero and SHALL write zero bytes to standard output and
   standard error, including every warning Node.js itself would print while
   loading the entry file and the modules the entry loads lazily, on every
   Node.js 24 release, with no Node.js flag and no environment variable on the
   command line (requirement 16 fixes that form). A capture failure SHALL still
   reach the storage boundary as an `uncaptured` record (spec 0206 requirement
   16), never as output. The sole exception is requirement 12. The mechanism
   SHALL be the following, chosen because it was reproduced on Node.js 24.0.0,
   24.2.0, 24.3.0 and 24.13.1 under the repository's root `package.json`, which
   has no `"type"` field, and because it changes no tracked file: (a) each entry
   file carries no module syntax — no top-level `import` or `export` — so
   Node.js loads it as CommonJS and prints no `MODULE_TYPELESS_PACKAGE_JSON`
   warning for it, reaching `node:` built-ins with `require()` and everything
   else with a dynamic `import()`, and declaring nothing at global scope; (b)
   its first statement removes the process's `warning` listeners, which
   silences the deferred warnings of the entry itself (Node.js 24.0.0 prints a
   type-stripping `ExperimentalWarning` for it) and of every ECMAScript module
   the entry then loads lazily, such as the shared modules of spec 0240 under
   `scripts/lib/`, which the typeless root scope would otherwise warn about;
   (c) the listeners are removed before the first lazy `import()`. Blast radius:
   none on the tracked CommonJS files under `scripts/lib/usage-capture/` and
   `scripts/lib/`, whose module type is untouched; the cost is a form rule on the
   entry files only (and, by reuse, on the entry of every later hook row). The
   alternatives were rejected: `"type": "module"` in the root `package.json`
   would re-scope every tracked `.js` file; the same field in `scripts/lib/`
   would re-scope the CommonJS files there; the same field in `hooks/` leaves
   Node.js 24.0.0's `ExperimentalWarning` printed and adds a tracked file that
   re-scopes every future hook entry; an `.mts` entry changes the parent's
   `.ts` path and does not silence lazily loaded `.ts` modules; the
   `--disable-warning` flag the repository's CI uses is a command-line change
   parent requirement 15 rules out. The plan SHALL verify that the entry form
   passes the toolchain gates of spec 0238.

6. **Cheap guard before any work.** The entry module SHALL decide, using the
   Node.js standard library alone and without loading the capture module graph,
   whether there is anything to capture, and SHALL load that graph through a
   lazy `import()` only when the guard finds work (parent requirement 15). The
   guard SHALL exit zero without capture work if and only if all of the
   following hold: a source path was obtained — for `copilot-cli` the fixed
   path `<home>/.copilot/session-store.db`, for the other two the decoded value
   of the payload's top-level `transcript_path` string, or, when that value is
   falsy, of `transcriptPath` — the selection
   `scripts/lib/usage-capture/index.js` makes, so both keys present and
   different key the stamp on the value capture uses — taken from the payload
   parsed as JSON and never from its raw text, so that a
   Windows path written `C:\\Users\\x\\t.jsonl` in the payload is the string
   `C:\Users\x\t.jsonl` before any other decision; that path is absolute on the
   running platform; it names an existing file; a stamp file for it exists at
   `<usage root>/state/<cli>/<key>.stamp`; and the source is not newer than the
   stamp. `<key>` SHALL equal the `sourceKey()` of
   `scripts/lib/usage-capture/cursor.js` — the lowercase SHA-256 hex digest of the
   decoded source path, the very string the capture step wrote the stamp for —
   through one definition or through a test that proves the two equal on a shared
   corpus that includes escaped and Windows-style paths. A payload that does not
   parse as a JSON object, or whose key is absent, not a string or empty, SHALL
   fall through to capture, as SHALL any other condition in doubt: a wrong guess
   costs one capture run, never a lost record.

7. **Slow path.** When the guard finds work, the hook SHALL derive and store
   the records exactly as the shell wrapper's Node.js step did, through the
   spec 0207 storage boundary and the spec 0206 adapters, unchanged in what
   they write.

8. **Usage root and home.** The hook SHALL resolve the usage root as the value
   of `CREWRIG_USAGE_ROOT` when set, otherwise `.crewrig/usage` under the user's
   home directory as the platform defines it (not the `HOME` variable alone,
   which Windows does not set), through the same definition the JavaScript
   modules of the usage subsystem use, and SHALL derive the Copilot CLI store
   path from the same home directory.

9. **Test-only override.** When `CREWRIG_USAGE_CAPTURE_TEST` and
   `CREWRIG_USAGE_CAPTURE_CLI` are both non-empty, the slow path SHALL run the
   script named by `CREWRIG_USAGE_CAPTURE_CLI` as a separate Node.js process
   with `--cli <cli> --event <event> --payload-file <file>`, the payload staged
   in an owner-only temporary file (spec 0240 requirement 10) that is removed
   when the process returns. The override SHALL be ignored when
   `CREWRIG_USAGE_CAPTURE_TEST` is empty, so a wrong production value can never
   silently disable live capture.

10. **No staged payload on the default path.** The default path SHALL NOT write
    the payload, or any file holding it, to disk outside the usage root's own
    record files; this deviates from the shell wrapper's transient payload file
    and retires the hazard `docs/usage-capture.md` records for it.

11. **No third-party dependency.** Neither entry point SHALL import a
    third-party package (parent requirement 6, spec 0240 requirement 16); the
    usage subsystem's modules rely on the Node.js standard library alone today
    and SHALL keep doing so in this ticket.

12. **Missing-dependency diagnostic.** Should a package a later change adds
    become unresolvable when a hook fires, and the failure reach the entry
    module as the `MissingDependencyError` of spec 0240 requirement 7, the hook
    SHALL write that diagnostic — naming the package and telling the user to
    re-run setup — to standard error, SHALL exit with status 1 and never
    status 2, which some of the four CLIs give a blocking meaning, and SHALL
    show no unhandled module-resolution error. This is how parent requirement 6
    is discharged for a hook, and the only case in which requirement 5's
    exit-zero contract yields; the plan SHALL verify, per CLI, that status 1
    does not block that CLI's turn.

13. **Prior command and payload.** `hooks/antigravity-statusline-shim.ts` SHALL
    read its whole standard input and then read
    `<usage root>/state/antigravity-statusline.json`. When that file parses as a
    JSON object whose `priorStatusLineCommand` is a non-empty string, the shim
    SHALL run that command through the default command interpreter of the
    running platform — the one Antigravity CLI would have used for a status
    line command — with the payload on its standard input, and SHALL copy the
    command's standard output to its own standard output byte for byte and let
    the command's standard error through unchanged. When the file is absent,
    unparsable, not an object, or holds an empty, missing or non-string value,
    the shim SHALL write nothing to standard output — never the raw payload
    (issue #1363, spec 0241 requirement 1).

14. **Prior command failure and capture.** A prior command that exits non-zero,
    cannot be started, or closes its standard input early SHALL NOT change the
    shim's exit status, its standard output or whether capture runs. In every
    configuration the shim SHALL then run the capture step for the `antigravity`
    CLI and the `statusline` event, in the shim's own process, adding to its own
    output the silence of requirement 5 (the prior command's standard error
    excepted), and SHALL exit with status zero (spec 0241 requirements 3 to 5).
    The shim SHALL name no interpreter of its own: it hands the prior command
    to the platform's default command interpreter, which on macOS and Linux is
    `sh`, and on Windows SHALL never be a POSIX shell (parent requirement 23).

15. **Budgets.** Each budget is an upper bound on wall-clock time from process
    start to process exit, Node.js start-up included, measured over 10
    consecutive runs on `windows-latest` by the harness of spec 0240
    requirement 13. The values below are initial and the rule that follows may
    only lower them: (a) `hooks/usage-capture.ts` on the fast path of requirement 6, with a
    fresh stamp and nothing to capture: 750 ms; (b) `hooks/usage-capture.ts` on
    the slow path, capturing one fixture payload into an empty temporary usage
    root: 2000 ms; (c) `hooks/antigravity-statusline-shim.ts` with no prior
    command, one fixture payload and an empty temporary usage root, prior-command
    time excluded because it is the user's own: 2000 ms. After the first green
    run of each job the implementation PR SHALL replace the budget with
    `max(3 x the largest observed run, 300 ms)` rounded up to the next 50 ms
    when that is lower than the initial value, and SHALL state the budget in
    the workflow next to its script. A run that exceeds a budget SHALL fail its
    job, naming the script, the budget and the measured time.

16. **Per-CLI command-line shape.** One shared TypeScript module under
    `scripts/lib/` (spec 0240 requirement 11) SHALL be the single source of the
    direct `node` command line each CLI receives, in the form the interpreter
    that CLI uses on Windows parses (rows 37–37d of `docs/cli-matrix.md`):
    (a) Claude Code (Git Bash) and, on macOS and Linux, all four CLIs:
    `node "<abs>" <args>`, path in double quotes; (b) Gemini CLI and Copilot CLI
    (Windows PowerShell 5.1): the same text, with the absolute path spelled out
    — never a `$GEMINI_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}` or
    `${COPILOT_PROJECT_DIR:-$PWD}` token, which those CLIs do not expand
    correctly on Windows (row 37c), and never a `NAME=value` prefix (row 37c,
    `CommandNotFoundException`) — and for Copilot CLI only under the `command`
    or `powershell` key, never `bash` (row 37); (c) Antigravity CLI on Windows:
    `node <abs> <args>` with the path unquoted, because a double-quoted argument
    does not group in the `cmd.exe` that parses its hook command lines (row 37b).
    Row 37b measured Antigravity CLI's hooks surface only, and the module wires
    only its `statusLine.command` surface (requirement 18), so the form of
    this item applies to `statusLine.command` on Windows if and only if row 37e
    records the same interpreter and quoting for it. If row 37e records
    otherwise, the module SHALL refuse a Windows `statusLine.command`, and a
    delta of this spec SHALL set its shape before any is written; the hooks
    surface, wired by later rows, keeps the form of this item. Every absolute
    path SHALL use forward slashes on Windows (rows 37b and 37d) and be the
    physical path of the checkout.

17. **Unsafe path refusal.** The module SHALL refuse, with a diagnostic naming
    the character and the path and without writing anything, a checkout path
    that its target interpreter would read as syntax: `"`, `$`, a backtick or a
    newline for every interpreter, plus, for `cmd.exe`, whitespace and any of
    `& | < > ^ % ( )`. Refusing is the null case of requirement 16(c), and
    applies to the Windows `statusLine.command` only once requirement 18 no
    longer refuses it: a Windows checkout path containing a space cannot then
    be wired for Antigravity CLI, is reported as a parity gap per parent
    requirement 19 in `docs/cli-matrix.md` in the implementation PR, and no
    command line that cannot launch is ever written. When requirements 17 and
    18 would both refuse, the diagnostic of requirement 18 SHALL be the one
    reported, since it concerns the surface and precedes any judgement of the
    path.

18. **Statusline surface unmeasured.** Row 37 records how each CLI parses a
    hook command line in its hooks file; `statusLine.command` in
    `~/.gemini/antigravity-cli/settings.json` is a different surface whose
    Windows parsing is not recorded. The implementation PR SHALL reproduce it on
    Windows with the probe of spec 0237 and add a row 37e to
    `docs/cli-matrix.md` (interpreter, quoting, working directory, path
    separators) before setup writes a Windows statusline command line. The
    module SHALL hold a constant with one entry per measured (CLI, surface,
    operating system) triple, each entry carrying the recorded interpreter and
    quoting rule and a status, `conforming` when they equal row 37b's for
    Antigravity CLI and `contradicting` when they differ. It SHALL hold no
    Windows statusline entry until the implementation PR adds row 37e and the
    entry in the same diff. The module SHALL refuse to produce a Windows
    statusline command line when the entry is absent, with a diagnostic saying
    the surface is unmeasured, and when the entry is `contradicting`, with a
    diagnostic naming the recorded shape, so the refusal of requirement 16(c) is
    decided from the constant alone; it SHALL NOT read `docs/cli-matrix.md` at
    run time. A test, which does read the matrix, SHALL fail when the presence
    of row 37e and the presence of the entry disagree, or when the entry's
    recorded interpreter and quoting differ from row 37e's. A delta of this spec
    that resets the shape after a `contradicting` row SHALL land in one diff
    with the row and the entry, so no head shows them out of step. macOS and
    Linux are unaffected.

19. **Rewrite on the next setup run.** On every run of
    `scripts/setup-claude-interactive.sh`, `scripts/setup-gemini-interactive.sh`,
    `scripts/setup-copilot-interactive.sh` and
    `scripts/setup-antigravity-interactive.sh`, when the CLI already has a
    registered capture command and the user does not choose to remove it, setup
    SHALL rewrite each such command to the shape of requirement 16, keeping its
    event, selector, key order, every other key and every other entry exactly as
    they were. For Antigravity CLI the same applies to `statusLine.command`, and
    the `installedStatusLineCommand` value in
    `<usage root>/state/antigravity-statusline.json` SHALL change in the same run,
    so the framework's own status line never reads as foreign; a crash between
    the two writes SHALL leave a state from which the next run still recognises
    the command as the framework's.

20. **Recognition by content.** A registered command is a capture command when
    its whole shape matches: an optional interpreter or environment prefix, a
    script path ending in `/hooks/usage-capture.sh` or `/hooks/usage-capture.ts`,
    quoted or not, and exactly `<cli-id> <Event>` — the recognition of spec 0211
    requirement 10 extended to the direct form. An operator's own hook that
    merely names a script called `usage-capture.sh` or `usage-capture.ts` with
    other arguments SHALL never be rewritten, kept, deduplicated, re-pointed or
    removed. The signature the Bash library recognises and the one the
    TypeScript module recognises SHALL accept and reject the same commands,
    proven by one shared fixture corpus run through both.

21. **Only where the target exists.** Setup SHALL rewrite a command whose path
    points at another checkout only when the `.ts` file sits next to the
    registered `.sh`. Otherwise it SHALL leave the command as it is — it still
    works through that checkout's own shell script — and say so.

22. **Idempotence and no duplicates.** A second run over an already rewritten
    configuration SHALL write nothing and create no backup. A configuration
    that holds a legacy and a direct capture command on one event SHALL end with
    exactly one, chosen by the live-path rule of spec 0211 requirement 11, and
    no combination of the capture question and the session-recording merge
    SHALL produce both forms or a duplicate. Re-pointing a vanished path
    (spec 0211 requirement 11) SHALL keep working for both forms.

23. **Write safety.** Every write SHALL be backup-first, end at file mode 0600,
    preserve every entry and non-hook key it does not own, refuse a
    configuration that is not a JSON object, and leave the file byte-identical
    when it fails. The content of a configuration file, which can hold a bearer
    token, SHALL NOT appear on the argument list of any process.

24. **Floor precondition.** Setup SHALL NOT rewrite any command to the direct
    form when the `node` it finds runs a major version below 24: it SHALL run
    the floor guard of spec 0240 requirement 1, print its diagnostic, and leave
    every installed command as it is.

25. **Reusable by the other hook rows.** The rewrite SHALL be parameterised by a
    hook descriptor (script basename, argument shape, per-CLI arguments) so
    that `worktree-git-guard` and `mempalace-transcript` (rows C2 and C3) register
    a descriptor without changing the mechanism; a fixture descriptor in this
    ticket's tests SHALL prove it. While the setups are Bash, they SHALL reach
    it through `node`; the mechanism SHALL spawn no POSIX-only utility (parent
    requirement 23).

26. **Wiring files and reports.** `hooks/claude-usage-capture-hooks.json`,
    `hooks/gemini-usage-capture-hooks.json` and
    `hooks/copilot-usage-capture-hooks.json` SHALL carry the direct `node …
    usage-capture.ts <cli-id> <Event>` form with the tokens they carry today,
    which setup always replaces with the absolute path; no installed command
    line SHALL carry a token that row 37c records as unusable on its CLI. Setup
    SHALL tell the user, by name and count, which commands it rewrote, which it
    left and why, and the disclosure before enabling capture SHALL name the
    direct form.

27. **Deviations from the shell behaviour (parent requirement 14).** The
    observable contract of both scripts SHALL be preserved except for exactly
    these, each justified above: the command line each CLI runs
    (requirements 16 and 26); the removal of the transient payload file
    (requirement 10); the exit status 1 of requirement 12; the platform-aware
    absolute-path and home-directory tests (requirements 6 and 8), which on
    macOS and Linux behave as the shell tests did; and the reading of the
    transcript path from the parsed payload's top-level key rather than from the
    first textual match anywhere in it (requirement 6), so a path that occurs
    only nested in the payload now reaches capture instead of the fast path.

28. **`windows-latest` proof (parent requirement 17).** The implementation PR
    SHALL add jobs, copied from the template of spec 0240 requirement 12 and
    recorded in `ci/ci-capabilities.yml` as `portability: specific`
    (spec 0240 requirement 15), that from a non-POSIX interpreter (a) invoke
    `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts` and
    assert a record appears in a temporary usage root, the prior command's
    output is forwarded, and standard error is empty; (b) run the command line
    produced for each of the four CLIs through the invocation row 37 records
    for that CLI — `bash -c` for Claude Code, `powershell.exe -NoProfile
    -NonInteractive -Command` for Gemini CLI and Copilot CLI, `cmd /c` for
    Antigravity CLI's hooks surface, and the interpreter row 37e records for
    its `statusLine.command` surface — and assert the hook ran; the
    `cmd /c` leg proves the launch semantics of that interpreter, not which
    interpreter Antigravity CLI uses for a status line, which is row 37e's
    to state; and (c) enforce the budgets of
    requirement 15.

29. **Oracle (parent requirement 13).** The scripts `hooks/usage-capture.sh` and
    `hooks/antigravity-statusline-shim.sh` migrate here, so
    `scripts/tests/test-usage-capture.sh`,
    `scripts/tests/test-setup-usage-capture-optin.sh`,
    `scripts/tests/test-setup-antigravity-transcript.sh` and the other three
    `scripts/tests/test-setup-*-transcript.sh` suites SHALL stay Bash, SHALL NOT
    migrate in this pull request, and SHALL pass on Linux CI against the
    TypeScript version through the forwarding shims with their assertions
    unchanged, except the assertions whose expected value is a wired command
    text — the fragment and `statusLine.command` equalities to the
    `bash "<abs>/hooks/usage-capture.sh"` form or the bare `.sh` path — which
    SHALL change to the direct form, and which the implementation PR SHALL list.
    Requirement 21 keeps the assertions about handlers pointing at other
    checkouts valid unchanged. New black-box tests in TypeScript SHALL cover
    requirements 6, 13, 14 and 16 to 25.

30. **References updated in the same pull request (parent requirement 9).**
    Every documentation page, workflow path filter, capability entry and
    manifest that names the old invocation SHALL be updated, at least
    `docs/usage-capture.md`, `docs/usage-organization.md`, `docs/layers.md`,
    rows 8c and 9 of `docs/cli-matrix.md`, `.github/workflows/usage-capture.yml`,
    `.gitlab-ci.yml`, `ci/ci-capabilities.yml` and, when a listed core path
    changes, `.crewrig/core-paths.txt`. `docs/usage-capture.md` SHALL also state
    that these hooks need Node.js 24 or later when they fire, and that a Node.js
    downgraded after setup makes them fail with Node.js's own non-zero status
    until setup is re-run.

## Scenarios

**Scenario:** Nothing new to capture, on the fast path

Given a Claude Code Stop payload naming an existing absolute transcript path,
and a stamp for it that is not older than the transcript
When `hooks/usage-capture.ts claude-code Stop` runs with the payload on standard
input
Then it exits zero having written no byte, the capture module graph is never
loaded, no override script is run, and on `windows-latest` its run stays within
its 750 ms budget over 10 runs.

**Scenario:** A healthy run is silent on an unmodified Node.js

Given the repository's root `package.json` with no `"type"` field, Node.js 24
started with no flag and no environment variable, and a fast-path payload, then
a slow-path payload whose capture lazily loads an ECMAScript module under
`scripts/lib/`
When `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts` each
run through their real entry files
Then every run exits zero and writes zero bytes to standard error, on the
current Node.js 24 release and on Node.js 24.0.0 (which prints a type-stripping
warning for an entry that does not remove its listeners first), on Linux and
on `windows-latest`.

**Scenario:** A Windows-style escaped path takes the fast path

Given a payload whose text is `{"transcript_path":"C:\\Users\\x\\t.jsonl"}`
on Windows — and, on macOS and Linux, one whose text is
`{"transcript_path":"/tmp/a\/b.jsonl"}` — a stamp written by the capture step
for the decoded path, and a source not newer than that stamp
When the hook runs
Then the guard decodes the path before deciding, finds the stamp keyed on the
decoded string, exits zero without loading the capture module graph, and does
not fall through to capture.

**Scenario:** A payload that is not JSON goes to capture

Given a payload that does not parse as a JSON object, or whose path key sits
only inside a nested object
When the hook runs
Then it does not take the fast path, it runs capture, and it exits zero
silently.

**Scenario:** A payload that cannot be resolved goes to capture

Given the same stamp, and a payload with no path key, a relative path, or a path
to a missing file
When the hook runs
Then it does not take the fast path, it runs capture, and it still exits zero
silently.

**Scenario:** A changed transcript is captured in-process

Given a transcript newer than its stamp and an empty temporary usage root
When the hook runs
Then exactly one record appears in the root's journal, no other process is
spawned, no file holding the payload is left outside the usage root, and the
exit status is zero.

**Scenario:** A capture failure never reaches the CLI

Given `CREWRIG_USAGE_CAPTURE_TEST` set and `CREWRIG_USAGE_CAPTURE_CLI` naming
a script that throws, then one that does not exist, then a run with `node`
missing from the search path through the forwarding shim
When each is fired
Then every run exits zero and writes zero bytes to standard output and standard
error.

**Scenario:** A dependency is missing when a hook fires

Given a stand-in for a runtime dependency that is declared but not installed
When the hook loads it and the failure reaches the entry module
Then standard error carries one line naming the package and telling the user to
re-run setup, the exit status is 1, and no module-resolution error is shown.

**Scenario:** The statusline with no prior command shows nothing

Given usage capture installed with no `priorStatusLineCommand`, or a missing or
malformed marker file
When a payload is piped to `hooks/antigravity-statusline-shim.ts`
Then standard output is empty, the record is captured, and the exit status is
zero.

**Scenario:** The statusline keeps the prior command's display

Given a `priorStatusLineCommand` that prints a line and another that exits
non-zero after printing
When the payload is piped to the shim
Then the printed line reaches standard output unchanged in both cases, capture
still runs, and the exit status is zero.

**Scenario:** An existing installation is rewritten on the next setup run

Given a Claude Code settings file holding
`bash "/repo/hooks/usage-capture.sh" claude-code Stop` and
`bash "/repo/hooks/usage-capture.sh" claude-code SessionEnd`, and a checkout at
`/repo` that holds `hooks/usage-capture.ts`
When the user re-runs `scripts/setup-claude-interactive.sh` and keeps capture
Then both handlers read `node "/repo/hooks/usage-capture.ts" claude-code …`,
after a 0600 backup, with every other entry untouched and the rewrite reported;
and a second run writes nothing and creates no backup.

**Scenario:** A command that is not ours is never rewritten

Given a hook whose command is `node "/opt/tools/usage-capture.ts" other-tool
Stop`, and another that chains `bash /opt/prep.sh && bash
/repo/hooks/usage-capture.sh claude-code Stop`
When setup runs
Then neither is rewritten, kept, deduplicated or removed.

**Scenario:** A handler pointing at an older checkout is left alone

Given a capture command whose path is another checkout that has
`hooks/usage-capture.sh` but no `hooks/usage-capture.ts`
When setup runs
Then that command is unchanged, and setup says it was left because its
checkout holds no TypeScript hook.

**Scenario:** An unsupported Node.js version stops the rewrite

Given `node` on the search path reports major version 20 and a legacy capture
command is installed
When the user runs setup
Then setup prints the floor guard's diagnostic naming version 20 and the floor
24, rewrites nothing, and leaves the legacy command in place.

**Scenario:** Each CLI's command line launches on Windows

Given a `windows-latest` job with a temporary usage root
When it runs the command line the module produces for each CLI through that CLI's
interpreter invocation — for Antigravity CLI the hooks-surface shape of row 37b
and, once row 37e exists, the statusline shape it records — from a checkout path
that has no space for Antigravity CLI
Then all four launch the hook and a record or a fast-path exit results.

**Scenario:** A Windows path with a space cannot be wired for Antigravity CLI

Given row 37e records `cmd.exe` and unquoted-path parsing for
`statusLine.command`, the module's measured-surface constant carries the entry,
and a Windows checkout at `C:/Users/Ana Diaz/crewrig`
When the module is asked for the Antigravity CLI `statusLine.command`
Then it writes nothing, names the space and the path, and the gap is recorded in
`docs/cli-matrix.md`.

**Scenario:** A Windows statusline line is not written before it is measured

Given the module's measured-surface constant holds no Windows statusline entry,
which is the state until the implementation PR adds row 37e
When setup is asked for a Windows Antigravity `statusLine.command`, from a
checkout path with or without a space
Then the module refuses with the diagnostic saying the surface is unmeasured —
not the unsafe-path one — and macOS and Linux still receive their command line;
and a test fails if the presence of the entry and of row 37e in
`docs/cli-matrix.md` disagree.

**Scenario:** Row 37e contradicts the hooks-surface shape

Given row 37e records that Antigravity CLI parses `statusLine.command` with an
interpreter or quoting other than row 37b's, and the constant's entry carries
that recorded shape with the status `contradicting`
When setup is asked for a Windows `statusLine.command`
Then the module refuses with a diagnostic naming the recorded shape, no command
line is written, and the guard test passes; no command line is written until a
delta of this spec sets the shape, landing in one diff with the row and the
entry.

**Scenario:** A budget regression breaks the job

Given a change that makes the hook load its capture module graph before its
guard
When the `windows-latest` timing step runs the fast-path budget
Then the job fails, naming `hooks/usage-capture.ts`, 750 ms and the measured
time.

**Scenario:** Another hook row registers with the same mechanism

Given a fixture hook descriptor for a script with a different basename and
arguments
When the rewrite runs over a configuration holding its legacy command
Then it is rewritten and recognised exactly like a capture command, and the
mechanism itself is unchanged.

## Out of scope

- `hooks/worktree-git-guard.sh`, `hooks/mempalace-transcript.sh` and the
  `hooks/*-transcript-hooks.json` manifests: rows C2 and C3. This spec builds
  the rewrite they reuse but registers no descriptor for them.
- Migrating `scripts/setup-*-interactive.sh` (row F), `scripts/lib/common.sh`,
  or retiring `scripts/lib/usage-capture-optin.sh` and `scripts/lib/gemini-settings.sh`;
  the latter is touched only if the rewrite needs it, and its merge already
  preserves hooks it does not own.
- Migrating the Bash tests named in requirement 29 (a later pull request,
  parent requirement 13), and migrating `scripts/lib/usage-headless.sh`,
  `scripts/usage-backfill.sh` or any other usage script.
- The capture adapters, the usage-record schema, the storage boundary, the
  Antigravity adapter and the wording or flow of the opt-in questions.
- Windows service management (row D), the symbolic-link fallback (row E), and
  re-measuring rows 37–37d, which stand as measured by sub-spec B.
- Making a hook work when `node` is missing or older than 24 at fire time; the
  floor is checked at setup (requirement 24) and the residual is documented
  (requirement 30).
- Windows behaviour of any CLI on a checkout path that a shipped interpreter
  cannot parse beyond refusing it (requirement 17).
- Node.js version management on the user's machine.

## Open questions

None. Choices the design inputs left to this spec were decided above and marked
as deviations or verification duties: the exit status of requirement 12, the
initial budgets of requirement 15, the refusal rules of requirements 17, 18 and
24, and the fate of `cli.js` (the plan's choice, requirement 3). The parent's
example form `node "<path>/<script>.ts"` (requirement 15) is quoted for four of
the five shapes and unquoted for Antigravity CLI's hooks surface on Windows
because row 37b measured that `cmd.exe` does not group a double-quoted argument
(its statusline surface follows row 37e, requirements 16 to 18); the invariant
of the parent — a direct `node` command line with no dispatcher, no flag — holds,
including for the silence mechanism of requirement 5, which needs no change of
that form, and no delta of spec 0215 is needed.
