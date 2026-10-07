---
id: "0247"
slug: mempalace-transcript-hook-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1329
version: 1.2.0
---

# MemPalace transcript hook in TypeScript

*Delta 02 of `specs/0247-mempalace-transcript-hook-typescript.md`, cumulative
over delta-01. Source: ticket #1329. Requirement 32 let the preparatory pull
request (#1483) move the hook observation from a fake `curl` to the loopback
stub daemon in one suite only, `scripts/tests/test-mempalace-transcript-hook.sh`.
The implementation PR (PR B) found a second suite that observes the hook the
same way: §5 of `scripts/tests/test-setup-antigravity-transcript.sh`, which
tests spec 0116 requirements 7 to 11. Requirement 32 as it stands requires that
suite to pass with its assertions unchanged, which the TypeScript hook, spawning
no `curl` (requirement 17), cannot do. On 2026-10-07 the owner decided to
re-host §5 on the stub inside PR B, in commit `11574f0b`, and to extend
requirement 32 to that suite in this delta. PR B merges only after this delta.
This delta records that extension and nothing more. It changes no behaviour of
the hook or of setup, and it runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. Line references are to that branch at `a7468111`,
unless a commit is named. The version is a MINOR bump: requirement 32 gains a
permission and a constraint, and one scenario and one out-of-scope item are
added. No question is left open.*

*Why this honours parent requirement 13, which spec 0215 and its deltas 01–04
leave unchanged on this point. That rule forbids migrating a test with its
script, and it requires the test's assertions to stay unchanged and to pass
against the TypeScript version. The suite stays in Bash. Each of the 18 cases
keeps its input and its expected outcome; only the instrument that observes
the outcome changes, the same kind of change that decision Q2 accepted for the
hook's own suite without a delta of spec 0215. What the preparatory pull
request gave that suite was evidence that the new observation reproduces the
shell hook's verdicts before the TypeScript hook is judged by it. Here, the
same evidence is the run against the base's shell hook that `11574f0b`
records, with only §5 swapped in, and the commit touches one file, so it can
be reviewed on its own. The trade-off is that this proof is a recorded run,
not a CI run merged on the release branch; the reviewer can replay it from the
commit. The removed source-text assertion falls under the second exception of
requirement 13, which places such a removal "in the pull request that migrates
the file it checks", which is PR B. Decision Q2 stays true as written: it
governs the hook's own suite, which PR B leaves unchanged. Spec 0116 is
unaffected: its requirements 7 to 11 are the behaviour the 18 cases assert,
and none of them changes.*

## ADDED

**Scenario:** The re-hosted Antigravity cases hold against both hooks

Given §5 of `scripts/tests/test-setup-antigravity-transcript.sh` as commit
`11574f0b` re-hosts it on the stub daemon, in `--mode ok`, with every case's
token file, `MEMPALACE_PYTHON` stub and environment as they were at
`a7468111`
When the suite runs once against the shell hook of `a7468111`, with only §5 of
the base's copy replaced, and once against the TypeScript hook
Then each run ends with exit status 0 and `105 passed, 0 failed`, and these 18
cases pass in both:

| # | Spec 0116 | Input (payload, arguments) | Expected outcome |
|---|---|---|---|
| 1 | R10 | `AGY_STOP`, `Stop` | standard output is `{}` |
| 2 | R10 | the run of case 1 | the answer has no `decision` key |
| 3 | R7 | the run of case 1 | standard error holds `persisted agent-response` |
| 4 | R8, R9 | the run of case 1 | room `transcripts/myproject-*-d8b1fa4a` |
| 5 | R7 | `AGY_PRE`, `PreInvocation` | standard output is `{}` and standard error holds `persisted session-lifecycle` |
| 6 | R9 | the run of case 5 (`workspacePaths: []`) | standard error holds `persisted session-lifecycle to transcripts/` |
| 7 | R10, opted out | `AGY_STOP`, `Stop`, `MEMPALACE_TRANSCRIPT_ENABLED=0` | standard output is `{}` |
| 8–9 | R10, unparseable payload | `NOT JSON`, then an empty payload, `Stop` | standard output is `{}` each time |
| 10 | R10, exactly once | `AGY_STOP`, `Stop` | exactly one line on standard output |
| 11 | R7, content | `AGY_STOP`, `Stop` | the content is `[AGENT] Session turn completed (NO_TOOL_CALL)` |
| 12–13 | R11, Claude Code `Stop` | `CLAUDE_STOP`, no argument | standard output empty, and `persisted agent-response` |
| 14 | R11, Claude Code `UserPromptSubmit` | `CLAUDE_PROMPT`, no argument | standard output empty, and `persisted user-prompt` |
| 15 | R11, Gemini CLI `BeforeAgent` shape | `{"user_input":"gemini prompt"}` | standard output empty, and `persisted user-prompt` |
| 16 | R11, Gemini CLI `AfterModel` shape | `{"model_response":"gemini answer"}` | standard output empty, and `persisted agent-response` |
| 17 | R11, Copilot CLI | `{"session_id":"abc12345","workspace_dir":".../wsproj","prompt":"p"}` | standard output empty, and room `transcripts/wsproj-*-abc12345` |
| 18 | R11, issue #91 | `{"hook_event_name":"PostToolUse","tool_name":"Bash"}` | standard output empty, and nothing persisted |

Cases 7 to 10 never reached the mock `curl` and are textually unchanged. The
assertion "exactly one EXIT trap is installed in the hook" is absent from both
runs, which is why each counts 105 assertions where the suite counted 106 at
`a7468111`.

**Out of scope:** case 17 under an exported `CLAUDE_PROJECT_DIR`. When the
environment running the suite exports `CLAUDE_PROJECT_DIR`, case 17 fails with
both hooks, because requirement 9, like the shell hook, puts that variable
before the payload's `workspace_dir`. The sensitivity predates this ticket, CI
does not export the variable, and the re-host does not touch it. Making the
case hermetic against it is left out: it would change the suite beyond the
move of observation that requirement 32 allows, and the hook's behaviour stays
as it is.

## MODIFIED

### Requirement 32 — §5 of the Antigravity setup suite moves to the stub daemon (owner decision of 2026-10-07)

The original below is requirement 32 as delta-01 replaced it.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 32. **Oracle (parent requirement 13; reworded at delta-01).**
>     Up to `e69d90c6`, `scripts/tests/test-mempalace-transcript-hook.sh`
>     observed the hook through a `curl` placed first on the search path
>     (`:62-88`, `:114-190`, `:192-259`, `:261-338` at that commit). A
>     TypeScript hook that spawns no `curl` (requirement 17) can never call it.
>     Before the implementation PR, a preparatory pull request of this ticket
>     SHALL move that observation to a stub daemon on the loopback interface,
>     keeping every case's input and expected outcome, and SHALL show the suite
>     green against the unchanged shell hook. That pull request is #1483,
>     merged on the release branch as `3b1cf1c8`; the anchors below into the
>     suite are at that commit. The issue-1247 case (`:310-320` at
>     `e69d90c6`) asserted that the token never appears on `curl`'s own
>     argument list, which no daemon can see. In that same preparatory pull
>     request, it SHALL be observed instead through a
>     recorder directory placed first on the search path. That directory holds
>     `curl` and `git` wrappers. Each wrapper appends its own argument list to
>     a log, then runs the real binary found after the recorder directory, so
>     the shell hook still reaches the stub. The case keeps its input. Its
>     expected outcome is that the stub receives the bearer token and no
>     recorded argument list contains it (at `3b1cf1c8`: the recorder set-up
>     shared with the spec-0167 case, `:333-343`, and the assertion,
>     `:366-379`). This is the only change of observation besides the move to
>     the stub daemon. The implementation PR
>     SHALL then run the suite against the TypeScript hook through the
>     forwarding shim, with its assertions unchanged. Three assertions of the
>     suite check the shell source text (`:143-151`, `:179-187`, `:189-201` at
>     `3b1cf1c8`; `:51-59`, `:90-98`, `:100-112` at `e69d90c6`), a property
>     only a shell file has. The implementation PR SHALL remove them
>     under the second exception of parent requirement 13, and SHALL replace
>     each with a black-box TypeScript test of the behaviour it stood for: the
>     5-second bound, the Git top level in a linked worktree, and diagnostics
>     on standard error and not standard output. The suite SHALL NOT migrate to
>     TypeScript in this ticket (row J1a, #1340), and no delta of spec 0215 is
>     needed (decision Q2). The following SHALL pass with their assertions
>     unchanged: the `scripts/tests/test-setup-*-transcript.sh` suites,
>     `scripts/tests/test-setup-gemini-settings-merge.sh`,
>     `scripts/tests/test-setup-usage-capture-optin.sh` and
>     `scripts/tests/hook-antigravity.test.ts`. The exception is any assertion
>     whose expected value is a wired command text or the installed copy that
>     requirement 21 retires. Those SHALL change to the new form. Row C2's
>     tests that pin the transcript behaviour from before this ticket SHALL
>     likewise change, and only their expected values and the test titles that
>     name row C3, where requirements 23,
>     24 and 27 change that behaviour. They are:
>     `scripts/tests/hook-guard-corpus.test.ts` (the `sr_is_transcript` test,
>     `:90`, scoped "until row C3"); the `transcript` field of the rows of
>     `scripts/tests/fixtures/worktree-guard/recognition-corpus.json`;
>     `scripts/tests/hook-guard-merge.test.ts` (the Antigravity CLI Node.js 20
>     deployment test, `:117-140`, since requirement 27 deploys no direct form
>     below the floor); and the transcript entries of
>     `scripts/tests/fixtures/worktree-guard/manifests/*-transcript-hooks.baseline.json`,
>     which `scripts/tests/hook-guard-wiring.test.ts` (`:4-8`) leaves to row
>     C3. The implementation PR SHALL list every changed assertion. New
>     black-box TypeScript tests SHALL cover requirements 3 to 16 and 20 to 29.
>     They SHALL include, for each CLI, the decline path on every class of
>     requirement 24 and the enable path on a `foreign-prefix` command, and, on
>     Antigravity CLI, both paths on a command that names a script called
>     `mempalace-transcript.*` with other arguments inside the
>     `crewrig-mempalace-transcript` named hook. The
>     Bash twin of the transcript predicate SHALL be exercised on the new
>     corpus by an added block in `scripts/tests/test-setup-usage-capture-optin.sh`,
>     which leaves that suite's existing assertions unchanged. Some existing
>     assertions of `scripts/tests/test-setup-copilot-transcript.sh` and
>     `scripts/tests/test-setup-usage-capture-optin.sh` expect what Copilot
>     CLI's full replace does: an operator entry or a top-level key dropped by
>     an enable run. They SHALL change to the merge of requirement 23(b), and
>     the implementation PR SHALL list them with the other changed assertions.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 32. **Oracle (parent requirement 13; reworded at delta-01, extended at
>     delta-02).**
>     Up to `e69d90c6`, `scripts/tests/test-mempalace-transcript-hook.sh`
>     observed the hook through a `curl` placed first on the search path
>     (`:62-88`, `:114-190`, `:192-259`, `:261-338` at that commit). A
>     TypeScript hook that spawns no `curl` (requirement 17) can never call it.
>     Before the implementation PR, a preparatory pull request of this ticket
>     SHALL move that observation to a stub daemon on the loopback interface,
>     keeping every case's input and expected outcome, and SHALL show the suite
>     green against the unchanged shell hook. That pull request is #1483,
>     merged on the release branch as `3b1cf1c8`; the anchors below into the
>     suite are at that commit. The issue-1247 case (`:310-320` at
>     `e69d90c6`) asserted that the token never appears on `curl`'s own
>     argument list, which no daemon can see. In that same preparatory pull
>     request, it SHALL be observed instead through a
>     recorder directory placed first on the search path. That directory holds
>     `curl` and `git` wrappers. Each wrapper appends its own argument list to
>     a log, then runs the real binary found after the recorder directory, so
>     the shell hook still reaches the stub. The case keeps its input. Its
>     expected outcome is that the stub receives the bearer token and no
>     recorded argument list contains it (at `3b1cf1c8`: the recorder set-up
>     shared with the spec-0167 case, `:333-343`, and the assertion,
>     `:366-379`). This is the only change of observation besides the move to
>     the stub daemon. The implementation PR
>     SHALL then run the suite against the TypeScript hook through the
>     forwarding shim, with its assertions unchanged. Three assertions of the
>     suite check the shell source text (`:143-151`, `:179-187`, `:189-201` at
>     `3b1cf1c8`; `:51-59`, `:90-98`, `:100-112` at `e69d90c6`), a property
>     only a shell file has. The implementation PR SHALL remove them
>     under the second exception of parent requirement 13, and SHALL replace
>     each with a black-box TypeScript test of the behaviour it stood for: the
>     5-second bound, the Git top level in a linked worktree, and diagnostics
>     on standard error and not standard output. The suite SHALL NOT migrate to
>     TypeScript in this ticket (row J1a, #1340), and no delta of spec 0215 is
>     needed (decision Q2). The following SHALL pass with their assertions
>     unchanged: the `scripts/tests/test-setup-*-transcript.sh` suites,
>     `scripts/tests/test-setup-gemini-settings-merge.sh`,
>     `scripts/tests/test-setup-usage-capture-optin.sh` and
>     `scripts/tests/hook-antigravity.test.ts`. There are two exceptions. The
>     first is any assertion whose expected value is a wired command text or
>     the installed copy that requirement 21 retires. Those SHALL change to the
>     new form. The second is §5 of
>     `scripts/tests/test-setup-antigravity-transcript.sh`, which the last
>     paragraph of this requirement governs. Row C2's
>     tests that pin the transcript behaviour from before this ticket SHALL
>     likewise change, and only their expected values and the test titles that
>     name row C3, where requirements 23,
>     24 and 27 change that behaviour. They are:
>     `scripts/tests/hook-guard-corpus.test.ts` (the `sr_is_transcript` test,
>     `:90`, scoped "until row C3"); the `transcript` field of the rows of
>     `scripts/tests/fixtures/worktree-guard/recognition-corpus.json`;
>     `scripts/tests/hook-guard-merge.test.ts` (the Antigravity CLI Node.js 20
>     deployment test, `:117-140`, since requirement 27 deploys no direct form
>     below the floor); and the transcript entries of
>     `scripts/tests/fixtures/worktree-guard/manifests/*-transcript-hooks.baseline.json`,
>     which `scripts/tests/hook-guard-wiring.test.ts` (`:4-8`) leaves to row
>     C3. The implementation PR SHALL list every changed assertion. New
>     black-box TypeScript tests SHALL cover requirements 3 to 16 and 20 to 29.
>     They SHALL include, for each CLI, the decline path on every class of
>     requirement 24 and the enable path on a `foreign-prefix` command, and, on
>     Antigravity CLI, both paths on a command that names a script called
>     `mempalace-transcript.*` with other arguments inside the
>     `crewrig-mempalace-transcript` named hook. The
>     Bash twin of the transcript predicate SHALL be exercised on the new
>     corpus by an added block in `scripts/tests/test-setup-usage-capture-optin.sh`,
>     which leaves that suite's existing assertions unchanged. Some existing
>     assertions of `scripts/tests/test-setup-copilot-transcript.sh` and
>     `scripts/tests/test-setup-usage-capture-optin.sh` expect what Copilot
>     CLI's full replace does: an operator entry or a top-level key dropped by
>     an enable run. They SHALL change to the merge of requirement 23(b), and
>     the implementation PR SHALL list them with the other changed assertions.
>
>     **§5 of `scripts/tests/test-setup-antigravity-transcript.sh` (added at
>     delta-02).** That section tests spec 0116 requirements 7 to 11 (`:691-890`
>     at `a7468111`, the §6 banner at `:892`). It observed the hook the same
>     way: through a mock `curl` written to `$TMP_ROOT/bin` and placed first on
>     the search path (`:699-722` at `a7468111`), which the TypeScript hook can
>     never call either. The implementation PR SHALL move that observation to
>     the stub daemon `scripts/tests/fixtures/mempalace-transcript/stub-daemon.ts`,
>     started in `--mode ok`. Each run of the hook SHALL reach the stub through
>     `MEMPALACE_MCP_HOST=127.0.0.1` and `MEMPALACE_MCP_PORT` set to the stub's
>     port, with `NO_PROXY` and `no_proxy` set to `127.0.0.1`. The 18 cases of
>     §5 SHALL keep their input and their expected outcome; the scenario "The
>     re-hosted Antigravity cases hold against both hooks" lists them. Their
>     input is the payload, the arguments, the token file, the
>     `MEMPALACE_PYTHON` stub and the environment. The content case SHALL read
>     the `content` of the last request the stub received, with no trailing
>     line feed, where it read what the mock `curl` was given. No other section
>     of the suite SHALL change for this move. Unlike the move of the hook's own
>     suite, this one SHALL land inside the implementation PR, as one commit
>     that touches only this suite. That commit SHALL record two runs of the
>     suite, both green. The first runs against the shell hook of the base,
>     with only §5 of the base's copy of the suite replaced by the re-hosted
>     §5, so that §2 to §4 keep their expectations from before this ticket. The
>     second runs against the TypeScript hook. That commit is `11574f0b` on
>     `feat/1329-mempalace-transcript-typescript` (§5 at `:691-898`, the §6
>     banner at `:900`). Both of its runs gave `105 passed, 0 failed`. In the
>     same commit, the assertion "exactly one EXIT trap is installed in the
>     hook" (`:815-821` at `a7468111`) SHALL be removed under the second
>     exception of parent requirement 13. It counts the `trap … EXIT` lines of
>     the hook's source, a property only a shell file has. A comment at its
>     place SHALL name its replacement: the describe block "the acknowledgement
>     on every Antigravity path (R5)" of
>     `scripts/tests/mempalace-transcript-args.test.ts`. That block asserts that
>     standard output is exactly `{}` and a line feed, written once, on three
>     paths: nothing to record, a failed persistence, and a missing token file.
>     The same file covers the other paths of the acknowledgement: the disabled
>     path and `Stop extra` of shape (b), the kill-switch of
>     `antigravity-cli <event>`, and the wrong-arity path.

## REMOVED

Nothing is removed.
