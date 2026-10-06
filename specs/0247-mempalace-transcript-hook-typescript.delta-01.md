---
id: "0247"
slug: mempalace-transcript-hook-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1329
version: 1.1.0
---

# MemPalace transcript hook in TypeScript

*Delta 01 of `specs/0247-mempalace-transcript-hook-typescript.md`. Source:
ticket #1329. The approved PLAN v1
(<https://github.com/crewrig/crewrig/issues/1329#issuecomment-6017974421>)
listed seven readings of the spec (its findings F1–F7) that it needed in order
to implement it. Pass 1 of the cold seat `plan/1329`
(<https://github.com/crewrig/crewrig/issues/1329#issuecomment-6018082160>)
accepted all seven as admissible and raised one more scope question, its
v1-F4: does the no-write/no-backup half of requirement 26 bind the enable path?
On 2026-10-06 the owner decided to record these eight readings as normative
text, so the spec stays faithful to what ships. This delta records those
readings and nothing more. It adds no behaviour that the plan and the seat did
not already settle. None of the readings contradicts the parent chain (spec
0215 and its deltas 01–04). The shim's floor guard (F4) follows the reading of
parent requirement 9 that sibling sub-spec C2 already made
(`specs/0248-worktree-git-guard-typescript.md` requirement 13). The
assertions F5 lets change belong to TypeScript tests of C2's wiring, not to
the Bash oracle of a migrating script that parent requirement 13 freezes. The
issue-1247 re-expression (F3) is made in the preparatory pull request that
decision Q2 already places before the migration. This delta runs under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`,
and its spec-PR targets `release/1231-ts-migration`. The version is a MINOR
bump. Requirements 2, 19, 24, 26, 28 and 32 are clarified or narrowed, and
two scenarios are added. No implementation of this spec has shipped yet, and
the plan that DEV follows already implements every reading recorded here. No
question is left open.*

## ADDED

**Scenario:** The shim stops cleanly below the floor

Given `node` reporting major version 20 on the search path
When `hooks/mempalace-transcript.sh` runs with the arguments `antigravity-cli Stop`,
then with the single argument `Stop`, then with `claude-code`, then with no
argument
Then the floor guard's diagnostic is on standard error and the TypeScript
entry point is not run. Standard output is exactly `{}` and a line feed in the
first two cases, and empty in the last two. The exit status is zero every
time. With `node` absent, standard error holds
`mempalace-transcript: node required`, and the same rule for standard output
and exit status applies.

**Scenario:** Other arguments are never a transcript command

Given the corpus `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`
with the rows `bash "/x/hooks/mempalace-transcript.sh" --foo bar`,
`bash "/x/hooks/mempalace-transcript.sh" Stop extra` and
`node "/x/hooks/mempalace-transcript.ts" claude-code Stop`, each classed `no`
When the Bash predicate and the TypeScript recogniser classify them
Then both return `no`, and setup never rewrites, keeps, deduplicates or removes
such a command. Run by hand, the hook still accepts `Stop extra` as the
Antigravity shape (b) and still ends `claude-code Stop` under requirement 3.

**Scenario:** A second enable run keeps its backup and changes nothing

Given a configuration that an enable run of setup has just written
When the user re-runs the same setup and enables session recording again
Then the configuration's content is byte-identical to the first run's result,
no event holds two transcript commands, and the backup that the enable path
always takes (requirement 29) is still taken. A second run of the rewrite done
before the question, over the same configuration, writes nothing and creates
no backup.

## MODIFIED

### Preamble — line references re-anchored after row C2 (plan F1)

Row C2 (#1480, `38fc9491`) merged after the commit the spec pins. It rewrote
the setups, `scripts/lib/usage-capture-optin.sh`, `scripts/lib/common.sh`,
`scripts/hook-wiring.ts` and `scripts/lib/hook-descriptor.ts`, and added
`scripts/lib/hook-registry.ts`, `scripts/lib/hook-guard-manifest.ts` and
`scripts/lib/hook-antigravity-write.ts`. Original:

> requirement 30. Line references are to `release/1231-ts-migration` at
> `fe0294ce`.*

Replacement:

> requirement 30. Line references are to `release/1231-ts-migration` at
> `e69d90c6`, after row C2 (#1480). The table below maps every anchor that C2
> moved. A reference not in the table resolves at `e69d90c6` exactly as it did
> at `fe0294ce`, because C2 did not change the file it names:
> `hooks/mempalace-transcript.sh`, `scripts/tests/test-mempalace-transcript-hook.sh`,
> `scripts/lib/usage-store/mcp.js`, `scripts/lib/hook-command.ts`,
> `scripts/lib/tls-delegation.sh`, and the `common.sh` lines `:1113`, `:1119`,
> `:1502-1506` and `:2053-2071`.
>
> | Requirement | Anchor at `fe0294ce` | Anchor at `e69d90c6` |
> |---|---|---|
> | 21 | `scripts/setup-claude-interactive.sh:465-467` (install step) | `:473-474` (the copy declared at `:455-457`) |
> | 21 | `scripts/setup-gemini-interactive.sh:418-420` | `:426-427` (declared at `:411-413`) |
> | 21 | `scripts/setup-copilot-interactive.sh:409-411` | `:415-416` (declared at `:404-405`) |
> | 21, 25 | `scripts/lib/common.sh:2369-2371`, `:2369` | `:2447-2448`, inside `deploy_antigravity_transcript_hooks` (`:2436`) |
> | 23 | `scripts/lib/usage-capture-optin.sh:226` (`sr_merge`) | `:256`, which since C2 also chooses `sr_strip_sparing_guard` (`:243`) when the manifest carries no guard |
> | 23(b) | `scripts/lib/usage-capture-optin.sh:874` (`merge_session_recording_hooks`) | `:906`; Copilot CLI's full replace is the `copilot)` program at `:926-930`, which since C2 also carries the installed guard handlers over |
> | 23(c) | `scripts/lib/common.sh:2356`, the shallow merge at `:2435` | `:2436`, the shallow merge at `:2508` |
> | 23 | `scripts/setup-claude-interactive.sh:468-471` (`env` consent) | `:476-479` |
> | 24 | `scripts/lib/usage-capture-optin.sh:206-213` (`sr_is_own`) | `sr_is_transcript` `:211-218`, `sr_is_guard` `:224-231`, `sr_is_own` `:233` |
> | 24 | `scripts/setup-gemini-interactive.sh:421-424` | `:429-431` |
> | 24 | `scripts/setup-copilot-interactive.sh:413-416` | `:419-421` |
> | 24 | `scripts/setup-antigravity-interactive.sh:452-455` | `:459-461` |

### Requirement 2 — the shim below the floor (plan F4)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 2. **Forwarding shim.** `hooks/mempalace-transcript.sh` SHALL remain, reduced
>    to a forwarding shim that only invokes the TypeScript entry point with the
>    arguments and standard input it received, and SHALL stay on the ratchet
>    allowlist without adding an entry (parent requirements 9 and 10). When
>    `node` is missing from the search path the shim SHALL write the single line
>    `mempalace-transcript: node required` to standard error and exit zero — the
>    treatment the shell gives a missing `jq` or `curl`
>    (`hooks/mempalace-transcript.sh:88-89`) — and, when invoked with an
>    Antigravity argument shape (requirement 3), SHALL still write the
>    acknowledgement of requirement 5.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 2. **Forwarding shim (reworded at delta-01).** `hooks/mempalace-transcript.sh`
>    SHALL remain as a forwarding shim. When the toolchain can run the
>    TypeScript entry point, the shim SHALL hand it the arguments and standard
>    input it received, and SHALL pass on the entry's exit status, standard
>    output and standard error unchanged. It SHALL stay on the ratchet
>    allowlist without adding an entry (parent requirements 9 and 10). Before
>    it forwards, the shim SHALL check two things in the shell, as
>    `hooks/worktree-git-guard.sh` does under spec 0248 requirement 13, and
>    these two checks are the only work it does besides forwarding.
>    (a) When `node` is missing from the search path, the shim SHALL write the
>    single line `mempalace-transcript: node required` to standard error and
>    exit zero. This is the treatment the shell gives a missing `jq` or `curl`
>    (`hooks/mempalace-transcript.sh:88-89`).
>    (b) When `node` is present, the shim SHALL run the floor guard of spec 0240
>    requirement 1 first, without forwarding standard input to it. Below
>    Node.js 24 the guard prints its own diagnostic and exits non-zero, and the
>    shim SHALL then exit zero without running the entry point.
>    On both paths, the shim SHALL write the acknowledgement of requirement 5
>    exactly when requirement 3 would put the hook in Antigravity mode, or would
>    end it with a first argument `antigravity-cli`. That is when the first
>    argument is non-empty and is none of `claude-code`, `gemini-cli` and
>    `copilot-cli`. Otherwise it SHALL write nothing to standard output. Both
>    exits are zero so that requirements 5 and 6 hold when the hook cannot
>    start.

### Requirement 19 — naming the case (plan F6)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 19. **Budgets (parent requirement 15).** Each budget is an upper bound on
>     wall-clock time from process start to exit, Node.js start-up included,
>     measured over 10 consecutive runs on `windows-latest` by the harness of
>     spec 0240 requirement 13. Initial values, which the rule below may only
>     lower: (a) direct form, `PostToolUse` payload: 750 ms; (b) shape (a) with
>     `MEMPALACE_TRANSCRIPT_ENABLED` unset: 750 ms; (c) direct form, `Stop`
>     payload naming a 50 MB transcript, persisted to a stub daemon on the
>     loopback interface: 2000 ms; (d) direct form, `UserPromptSubmit` payload,
>     nothing listening on the daemon port: 2000 ms. After the first green run
>     of each job the implementation PR SHALL replace a budget with
>     `max(3 x the largest observed run, 300 ms)` rounded up to the next 50 ms
>     when that is lower, and SHALL state each budget in the workflow next to its
>     script. A run that exceeds a budget SHALL fail its job, naming the script,
>     the case, the budget and the measured time. A daemon that accepts the
>     connection and never answers is bounded by requirement 13, not budgeted.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 19. **Budgets (parent requirement 15; reworded at delta-01).** Each budget is
>     an upper bound on wall-clock time from process start to exit, Node.js
>     start-up included, measured over 10 consecutive runs on `windows-latest`
>     by the harness of spec 0240 requirement 13. Initial values, which the rule
>     below may only lower: (a) direct form, `PostToolUse` payload: 750 ms;
>     (b) shape (a) with `MEMPALACE_TRANSCRIPT_ENABLED` unset: 750 ms;
>     (c) direct form, `Stop` payload naming a 50 MB transcript, persisted to a
>     stub daemon on the loopback interface: 2000 ms; (d) direct form,
>     `UserPromptSubmit` payload, nothing listening on the daemon port:
>     2000 ms. After the first green run of each job, the implementation PR
>     SHALL replace a budget with `max(3 x the largest observed run, 300 ms)`,
>     rounded up to the next 50 ms, when that value is lower. It SHALL state
>     each budget in the workflow next to its script. A run that exceeds a
>     budget SHALL fail its job, naming the script, the case, the budget and the
>     measured time. The harness names the case through a new optional
>     `--case <label>` option of `scripts/check-timing-budget.ts`, whose label
>     its failure line prints (today's line, `:183`, names the script, the
>     budget and the time only). Without the option, the harness's arguments,
>     output and exit codes stay as they are. The option is covered in
>     `scripts/tests/check-timing-budget.test.ts`. A daemon that accepts the
>     connection and never answers is bounded by requirement 13, not budgeted.

### Requirement 24 — recognition grammar and C2 anchors (plan F1, F2)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Recognition by content.** A registered command is a transcript command
>     when its whole shape matches: an optional prefix of `NAME=value` words, an
>     optional `env`, an optional `bash`, `sh` or `node`, a script path ending in
>     `/mempalace-transcript.sh` or `/mempalace-transcript.ts`, quoted or not,
>     and the arguments of one shape of requirement 3; and, for the Antigravity
>     CLI descriptor only, the guarded prefix of spec 0243 delta-03
>     requirement 34 in place of that prefix. Every transcript command SHALL fall
>     in exactly one class, decided from the command text alone:
>     (a) `foreign-prefix` — its prefix carries an assignment to a name other than
>     `MEMPALACE_TRANSCRIPT_ENABLED` and `MEMPALACE_PYTHON`, or it has the direct
>     shape (c) of requirement 3 and carries any `NAME=value` prefix;
>     (b) `direct` — shape (c) with no prefix, or with the guarded prefix only;
>     (c) `legacy-enabled` — shape (a) or (b) whose prefix is made of
>     `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
>     `MEMPALACE_PYTHON=<non-blank word>`, the prefix setup writes today
>     (`scripts/setup-gemini-interactive.sh:421-424`,
>     `scripts/setup-copilot-interactive.sh:413-416`,
>     `scripts/setup-antigravity-interactive.sh:452-455`);
>     (d) `legacy-unmarked` — shape (a) or (b) with no prefix, or with a prefix
>     made only of those two names in which `MEMPALACE_TRANSCRIPT_ENABLED` is
>     absent or not `1`. One transcript-only predicate SHALL exist in each twin
>     — a new Bash predicate in `scripts/lib/usage-capture-optin.sh` and the
>     TypeScript recogniser — returning the class or "not a transcript command",
>     and the two SHALL return the same answer for every row of a new corpus,
>     `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`, each
>     row carrying a `command`, a `transcript` field holding one of `no`,
>     `direct`, `legacy-enabled`, `legacy-unmarked` or `foreign-prefix`, and a
>     `note`. `sr_is_own` (`scripts/lib/usage-capture-optin.sh:206-213`) SHALL be
>     re-expressed as "the transcript predicate returns `direct`,
>     `legacy-enabled` or `legacy-unmarked`, or the command is a worktree git
>     guard command", the guard half accepting and rejecting exactly what it
>     accepts and rejects today, so guard ownership and the guard refresh of
>     `sr_merge` are unchanged (requirement 29). The transcript half changes on
>     purpose: it now rejects a `foreign-prefix` command, which it accepted, and
>     accepts the `node` and `.ts` forms and the legacy Antigravity event
>     argument, which it rejected. The existing corpus
>     `scripts/tests/fixtures/usage-capture/recognition-corpus.json`, its
>     `capture` field and its two consumers stay unchanged. A command that chains
>     an operator's own script, or names a script called `mempalace-transcript.*`
>     with other arguments, is not a transcript command and SHALL never be
>     rewritten, kept, deduplicated or removed.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Recognition by content (reworded at delta-01).** A registered command is
>     a transcript command when its whole shape matches. That shape is: an
>     optional prefix of `NAME=value` words, an optional `env`, an optional
>     `bash`, `sh` or `node`, and a script path ending in
>     `/mempalace-transcript.sh` or `/mempalace-transcript.ts`, quoted or not.
>     After the path comes an argument list in one of the four forms setup has
>     ever written, its words separated by whitespace and trailing whitespace
>     allowed: (i) no argument; (ii) exactly one word of ASCII letters that is
>     not a CLI identifier, the legacy Antigravity event; (iii) exactly one of
>     `claude-code`, `gemini-cli` or `copilot-cli`; (iv) `antigravity-cli`
>     followed by exactly one word of ASCII letters. For the Antigravity CLI
>     descriptor only, the guarded prefix of spec 0243 delta-03 requirement 34
>     may stand in place of that prefix. In the classes below, "shape (a) or
>     (b)" means forms (i) and (ii), and "shape (c)" means forms (iii) and (iv).
>     This recognition grammar is narrower than the runtime acceptance of
>     requirement 3, which stays as written. An empty first argument, further
>     arguments after a legacy event, and a CLI identifier followed by the
>     wrong number of arguments are shapes the hook accepts or ends when it
>     runs. They are never transcript commands, because a command that names a
>     script called `mempalace-transcript.*` with other arguments is not one
>     (last sentence of this requirement). Every transcript command SHALL fall
>     in exactly one class, decided from the command text alone:
>     (a) `foreign-prefix` — its prefix carries an assignment to a name other than
>     `MEMPALACE_TRANSCRIPT_ENABLED` and `MEMPALACE_PYTHON`, or it has the direct
>     shape (c) and carries any `NAME=value` prefix;
>     (b) `direct` — shape (c) with no prefix, or with the guarded prefix only;
>     (c) `legacy-enabled` — shape (a) or (b) whose prefix is made of
>     `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
>     `MEMPALACE_PYTHON=<non-blank word>`. This is the prefix setup writes today
>     (`scripts/setup-gemini-interactive.sh:429-431`,
>     `scripts/setup-copilot-interactive.sh:419-421`,
>     `scripts/setup-antigravity-interactive.sh:459-461`);
>     (d) `legacy-unmarked` — shape (a) or (b) with no prefix, or with a prefix
>     made only of those two names in which `MEMPALACE_TRANSCRIPT_ENABLED` is
>     absent or not `1`. One transcript-only predicate SHALL exist in each twin:
>     a new Bash predicate in `scripts/lib/usage-capture-optin.sh` and the
>     TypeScript recogniser. Each SHALL return the class or "not a transcript
>     command", and the two SHALL return the same answer for every row of a new
>     corpus, `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`.
>     Each row carries a `command`, a `transcript` field holding one of `no`,
>     `direct`, `legacy-enabled`, `legacy-unmarked` or `foreign-prefix`, and a
>     `note`. The corpus SHALL include, classed `no`, a row with the arguments
>     `--foo bar` and a row with the arguments `Stop extra`. Since C2,
>     `sr_is_own` (`scripts/lib/usage-capture-optin.sh:233`) reads
>     `sr_is_transcript or sr_is_guard` (`:211-218`, `:224-231`). It SHALL come
>     to mean "the transcript predicate returns `direct`, `legacy-enabled` or
>     `legacy-unmarked`, or the command is a worktree git guard command". That
>     change SHALL be made by re-expressing `sr_is_transcript` alone. The guard
>     half, `sr_is_guard`, keeps accepting and rejecting exactly what it
>     accepts and rejects today, so guard ownership and the guard refresh of
>     `sr_merge` are unchanged (requirement 29). The transcript half changes on
>     purpose. It now rejects a `foreign-prefix` command, which it accepted. It
>     now accepts the `node` and `.ts` forms and the legacy Antigravity event
>     argument, which it rejected. The existing corpus
>     `scripts/tests/fixtures/usage-capture/recognition-corpus.json`, its
>     `capture` field and its two consumers stay unchanged. A command that
>     chains an operator's own script, or names a script called
>     `mempalace-transcript.*` with other arguments, is not a transcript
>     command and SHALL never be rewritten, kept, deduplicated or removed.

### Requirement 26 — scope of the no-write rule (seat finding v1-F4)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Idempotence and write safety.** A second run over a rewritten
>     configuration SHALL write nothing and create no backup. No combination of
>     the session-recording question and the usage-capture question SHALL add a
>     transcript command to an event that already holds one, or leave two
>     transcript commands on one event of one CLI that setup wrote or rewrote; a
>     configuration that already held two before setup ran keeps no more than it
>     held. Every write SHALL be
>     backup-first, end at mode 0600, preserve every entry and key it does not
>     own — Antigravity CLI's `crewrig-mempalace-transcript` named hook being
>     owned, within the limits of requirement 23(c) — refuse a configuration that is not a JSON object, leave the file
>     byte-identical when it fails, and put no configuration content on the
>     argument list of any process (spec 0243 requirement 23).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Idempotence and write safety (reworded at delta-01).** A second run of
>     the rewrite setup makes before the session-recording question SHALL write
>     nothing and create no backup when it runs over a configuration that rewrite
>     has already rewritten. That rewrite is the in-place rewrite of
>     requirement 23 that the decline and cancel paths rely on: `direct`,
>     `legacy-enabled` and consented `legacy-unmarked` commands moved to the
>     direct form. The enable path keeps the unconditional backup and write it
>     has today, because requirement 29 lists the only changes made to that
>     path and this is not one of them. A second enable run SHALL instead leave
>     the configuration's content byte-identical to the result of the first.
>     No combination of the session-recording question and the usage-capture
>     question SHALL add a transcript command to an event that already holds
>     one, or leave two transcript commands on one event of one CLI that setup
>     wrote or rewrote. A configuration that already held two before setup ran
>     keeps no more than it held. Every write SHALL be backup-first and end at
>     mode 0600. It SHALL preserve every entry and key it does not own;
>     Antigravity CLI's `crewrig-mempalace-transcript` named hook is owned,
>     within the limits of requirement 23(c). It SHALL refuse a configuration
>     that is not a JSON object, leave the file byte-identical when it fails,
>     and put no configuration content on the argument list of any process
>     (spec 0243 requirement 23).

### Requirement 28 — C2's modules and the fourth descriptor field (plan F1, F7)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 28. **Reused mechanism.** The wiring SHALL go through the descriptor,
>     recognition, rewrite and Antigravity hooks modules C1 built
>     (`scripts/lib/hook-descriptor.ts`, `hook-recognition.ts`, `hook-rewrite.ts`,
>     `hook-antigravity.ts`, `scripts/hook-wiring.ts`), reached from the Bash
>     setups through `node`, spawning no POSIX-only utility. Where the descriptor
>     cannot yet express what requirements 3, 24 and 25 need, the implementation
>     PR SHALL extend it only by optional fields whose absence leaves every
>     existing descriptor's behaviour unchanged, proven by C1's tests passing
>     unchanged.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 28. **Reused mechanism (reworded at delta-01).** The wiring SHALL go through
>     the descriptor, recognition, rewrite and Antigravity hooks modules C1
>     built (`scripts/lib/hook-descriptor.ts`, `hook-recognition.ts`,
>     `hook-rewrite.ts`, `hook-antigravity.ts`, `scripts/hook-wiring.ts`). It
>     SHALL also use the modules C2 added. The hook's descriptor is registered
>     in `scripts/lib/hook-registry.ts`, as the worktree git guard's is.
>     `scripts/lib/hook-guard-manifest.ts` and
>     `scripts/lib/hook-antigravity-write.ts` are reused, or mirrored by sibling
>     modules for this hook, and their exported signatures stay as they are.
>     All of it is reached from the Bash setups through `node`, spawning no
>     POSIX-only utility. Where the descriptor cannot yet express what
>     requirements 3, 24 and 25 need, the implementation PR SHALL extend it only
>     by optional fields whose absence leaves every existing descriptor's
>     behaviour unchanged, proven by C1's tests passing unchanged. One such field
>     is `anyScriptDir`. When it is set, the recognised script path ends in
>     `/<basename>.sh` or `/<basename>.ts` without the `/hooks/` directory that
>     `signature()` and `guardedSignature()` of `scripts/lib/hook-recognition.ts`
>     (`:65-72`, `:79-84`) require today. The transcript descriptor sets it, so that the
>     TypeScript recogniser accepts the same script paths as the Bash twin
>     (`sr_is_transcript`, `scripts/lib/usage-capture-optin.sh:211-218`) and
>     the wording of requirement 24.

### Requirement 32 — the issue-1247 case and C2's pre-C3 pins (plan F3, F5)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 32. **Oracle (parent requirement 13).** `scripts/tests/test-mempalace-transcript-hook.sh`
>     observes the hook through a `curl` placed first on the search path
>     (`scripts/tests/test-mempalace-transcript-hook.sh:62-88`, `:114-190`,
>     `:192-259`, `:261-338`), which a TypeScript hook that spawns no `curl`
>     (requirement 17) can never call. Before the
>     implementation PR, a preparatory pull request of this ticket SHALL move
>     that observation to a stub daemon on the loopback interface, keeping every
>     case's input and expected outcome, and SHALL show the suite green against
>     the unchanged shell hook; the implementation PR SHALL then run the suite
>     against the TypeScript hook through the forwarding shim with its assertions
>     unchanged. Its three assertions on the shell source text
>     (`:51-59`, `:90-98`, `:100-112`) check a property only a shell file has and
>     SHALL be removed in the implementation PR under the second exception of
>     parent requirement 13, each replaced by a black-box TypeScript test of the
>     behaviour it stood for (the 5-second bound, the Git top level in a linked
>     worktree, diagnostics on standard error and not standard output). The suite
>     SHALL NOT migrate to TypeScript in this ticket (row J1a, #1340), and no
>     delta of spec 0215 is needed (decision Q2). The
>     `scripts/tests/test-setup-*-transcript.sh` suites, `scripts/tests/test-setup-gemini-settings-merge.sh`,
>     `scripts/tests/test-setup-usage-capture-optin.sh` and
>     `scripts/tests/hook-antigravity.test.ts` SHALL pass with their assertions
>     unchanged, except those whose expected value is a wired command text or the
>     installed copy requirement 21 retires, which SHALL change to the new form
>     and which the implementation PR SHALL list. New black-box TypeScript tests
>     SHALL cover requirements 3 to 16 and 20 to 29, including, for each CLI, the
>     decline path on every class of requirement 24 and the enable path on a
>     `foreign-prefix` command. The Bash twin of the transcript predicate SHALL be
>     exercised on the new corpus by an added block in
>     `scripts/tests/test-setup-usage-capture-optin.sh`, which leaves that suite's
>     existing assertions unchanged. The existing assertions of
>     `scripts/tests/test-setup-copilot-transcript.sh` and
>     `scripts/tests/test-setup-usage-capture-optin.sh` whose expected value
>     follows from Copilot CLI's full replace — an operator entry or a top-level
>     key dropped by an enable run — SHALL change to the merge of requirement
>     23(b), and the implementation PR SHALL list them with the other changed
>     assertions.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 32. **Oracle (parent requirement 13; reworded at delta-01).**
>     `scripts/tests/test-mempalace-transcript-hook.sh` observes the hook
>     through a `curl` placed first on the search path
>     (`scripts/tests/test-mempalace-transcript-hook.sh:62-88`, `:114-190`,
>     `:192-259`, `:261-338`). A TypeScript hook that spawns no `curl`
>     (requirement 17) can never call it. Before the implementation PR, a
>     preparatory pull request of this ticket SHALL move that observation to a
>     stub daemon on the loopback interface, keeping every case's input and
>     expected outcome, and SHALL show the suite green against the unchanged
>     shell hook. The issue-1247 case (`:310-320`) asserts that the token never
>     appears on `curl`'s own argument list, which no daemon can see. In that
>     same preparatory pull request, it SHALL be observed instead through a
>     recorder directory placed first on the search path. That directory holds
>     `curl` and `git` wrappers. Each wrapper appends its own argument list to
>     a log, then runs the real binary found after the recorder directory, so
>     the shell hook still reaches the stub. The case keeps its input. Its
>     expected outcome is that the stub receives the bearer token and no
>     recorded argument list contains it. This is the only change of
>     observation besides the move to the stub daemon. The implementation PR
>     SHALL then run the suite against the TypeScript hook through the
>     forwarding shim, with its assertions unchanged. Three assertions of the
>     suite check the shell source text (`:51-59`, `:90-98`, `:100-112`), a
>     property only a shell file has. The implementation PR SHALL remove them
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
>     likewise change, and only their expected values, where requirements 23,
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
>     requirement 24 and the enable path on a `foreign-prefix` command. The
>     Bash twin of the transcript predicate SHALL be exercised on the new
>     corpus by an added block in `scripts/tests/test-setup-usage-capture-optin.sh`,
>     which leaves that suite's existing assertions unchanged. Some existing
>     assertions of `scripts/tests/test-setup-copilot-transcript.sh` and
>     `scripts/tests/test-setup-usage-capture-optin.sh` expect what Copilot
>     CLI's full replace does: an operator entry or a top-level key dropped by
>     an enable run. They SHALL change to the merge of requirement 23(b), and
>     the implementation PR SHALL list them with the other changed assertions.

### Open questions — descriptor fields (plan F7)

Original:

> - **Descriptor fields (requirement 28).** `scripts/lib/hook-descriptor.ts` has
>   no field for an argument-less legacy command, for an environment prefix the
>   framework owns and drops, or for a rewrite that targets the running checkout
>   whatever path the command names; no C1 descriptor carries any of the three.
>   Back-fill responsibility: this ticket's implementation PR adds them as
>   optional fields under requirement 28, leaving `USAGE_CAPTURE` and
>   `ANTIGRAVITY_STATUSLINE` unchanged, so no delta of spec 0243 is needed.

Replacement:

> - **Descriptor fields (requirement 28, reworded at delta-01).**
>   `scripts/lib/hook-descriptor.ts` cannot say four things:
>   - an argument-less legacy command;
>   - an environment prefix the framework owns and drops;
>   - a rewrite that targets the running checkout, whatever path the command
>     names;
>   - a script path outside a `/hooks/` directory (`anyScriptDir`, requirement
>     28).
>
>   No C1 or C2 descriptor carries any of the four. Back-fill responsibility:
>   this ticket's implementation PR adds them as optional fields under
>   requirement 28, leaving `USAGE_CAPTURE`, `ANTIGRAVITY_STATUSLINE` and
>   `WORKTREE_GIT_GUARD` unchanged, so no delta of spec 0243 or spec 0248 is
>   needed.

## REMOVED

Nothing is removed.
