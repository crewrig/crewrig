---
id: "0248"
slug: worktree-git-guard-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1328
version: 1.0.0
---

# Worktree git guard hook and worktree-claim in TypeScript

*Sub-spec C2 of the `large`-tier ticket #1231, row C2 of the architect
decomposition
(<https://github.com/crewrig/crewrig/issues/1231#issuecomment-5857477069>).
Parent spec: `specs/0215-shell-to-typescript-migration.md` (requirement 24),
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md` (requirements 27–38):
this spec-PR and its implementation PR target `release/1231-ts-migration`, and
"shipped" means merged there, not reached `main`. Discharges parent
requirements 8 (as the named dependency of requirement 2 below), 9, 13, 14, 15
and 17 for the two scripts below, and applies requirements 19, 22 and 23 to
them. Depends on sub-spec C1, `specs/0243-usage-capture-hooks-typescript.md`
with its `delta-01` to `delta-04` (the hook descriptor, the per-CLI command-line
module, the installed-command rewrite, the Antigravity CLI named-hook library
and its guarded Windows form), on sub-spec A2,
`specs/0240-runtime-foundations-shared-ts-modules.md` with its `delta-01`, and
on sub-spec B, `specs/0237-windows-hook-cli-matrix.md`. It inherits the
behavioural contracts of `specs/0114-shared-worktree-agent-isolation.md`,
`specs/0126-claim-gate-tree-convergence.md`,
`specs/0153-tool-boundary-git-worktree-guard.md`,
`specs/0169-multi-cli-worktree-git-guard-wiring.md` and
`specs/0116-antigravity-transcript-activation.delta-03.md` (requirements 27 to
29) and preserves them except for the deviations listed in requirement 38. It
reuses the C1 modules and registers a descriptor with them; it redefines none
of their primitives (`specs/0243-usage-capture-hooks-typescript.delta-03.md`
requirements 25, 33 and 34).*

## Intent

A user on Windows, macOS or Linux whose agent sessions run in shared ticket
worktrees keeps the protection they have today: a whole-tree git operation
(`git reset --hard`, `git checkout -- .`, `git stash`, `git clean`, a forced
worktree removal) is refused at the tool boundary of all four CLIs unless an
exclusive, attributable claim is held on that ticket, and the claim tool itself
(take, run, release, takeover, status, history) behaves the same on the three
operating systems with no POSIX shell and no `jq`. The guard fires before every
shell command an agent runs, so a command that needs no refusal costs a stated,
small amount of time. A machine that already has the guard installed is brought
to the new command line the next time the user runs setup, without duplicating
or disturbing any other hook, and a claim taken by one version of the tool is
honoured by the other for as long as both can run against one repository.

## Requirements

1. **Two TypeScript entry points.** `hooks/worktree-git-guard.ts` and
   `scripts/worktree-claim.ts` SHALL replace the behaviour of
   `hooks/worktree-git-guard.sh` and `scripts/worktree-claim.sh`, each runnable
   as a direct `node` command line with no dispatcher and no intermediate
   CrewRig entry point (parent requirements 1 and 15), each at the path of its
   shell predecessor with `.sh` changed to `.ts` (parent requirement 9, spec
   0240 requirement 11), and each written to the conventions of parent
   requirement 2 (erasable syntax, strict typing, every value entering from
   standard input, the environment, a file, a subprocess or the command line
   typed `unknown` and narrowed before use). Every shared module the two
   entries load SHALL live under `scripts/lib/`, one concern per file, and no
   TypeScript file this ticket adds SHALL exceed the 300-line warning threshold;
   the 927-line shell script is therefore decomposed, not ported as one file.

2. **Named dependency (parent requirement 8).** `scripts/worktree-claim.sh`
   migrates in this row, ahead of its own step, for one reason and no other: it
   is invoked by `hooks/worktree-git-guard.sh`, a step (a) script, which
   delegates every claim decision to it (spec 0153 requirement 3, line
   `CLAIM_SCRIPT="$SCRIPT_DIR/scripts/worktree-claim.sh"`). The dependent
   script is `hooks/worktree-git-guard.sh`; the dependency is
   `scripts/worktree-claim.sh`. A guard in TypeScript cannot keep that
   delegation by spawning the shell script, because parent requirement 23
   forbids a migrated script from spawning a POSIX-only tool and parent
   requirements 5 and 17 forbid a POSIX shell as a prerequisite and as a proof
   environment, so the guard and the claim tool move together. Nothing else in
   this spec migrates a script ahead of its step, and the existence of this
   dependency SHALL NOT be cited as precedent for the other consumers of the
   claim tool (documentation, workflow path filters, Bash tests), which are
   references and tests, not dependents.

3. **One definition of claim state, no hop.** The guard SHALL obtain the claim
   state of a ticket from the same shared module the claim tool's `status`
   subcommand uses, inside its own process, and SHALL NOT spawn the claim tool,
   `bash`, `sh` or any other POSIX-only utility on any path (parent
   requirement 23). The guard's decision SHALL equal the `state: claimed` /
   `state: unclaimed` line the `status` subcommand prints for the same ticket
   and repository, proven by a test that compares the two over a claimed, an
   unclaimed and an unreadable fixture. Delegation (spec 0153 requirement 3) is
   thereby preserved: the guard SHALL NOT reimplement `git status` parsing or
   the claim-directory test.

4. **Input.** The guard SHALL read its payload from standard input unless
   standard input is an interactive terminal, and SHALL read it to the end
   before it makes any decision. When the command taken from the payload is
   absent or an empty string and a first positional argument is present and
   non-empty, the guard SHALL use that argument as the command. It SHALL read no environment variable of
   its own; the claim lookup reads `CREWRIG_REPO_DIR` through requirement 14.

5. **Extraction chain.** The command SHALL be the first of
   `.toolCall.args.CommandLine`, `.toolCall.args`, `.tool_input.command`,
   `.command`, `.tool_input` of the parsed payload that is neither absent, nor
   `null`, nor `false` (the selection of `jq`'s `//` operator, under which an
   empty string is selected and ends the chain). A segment that cannot be
   indexed because an intermediate value is not an object (for example
   `.tool_input.command` over `{"tool_input":"git reset --hard"}`) SHALL count
   as absent and the chain SHALL continue; the shell guard's `jq` fails on such
   a payload and selects nothing, a behaviour that differs between `jq`
   releases, so this is the fail-safe reading and a listed deviation
   (requirement 38(h)). A selected value that is not a string SHALL be taken as
   its JSON text, so that a prohibited phrase inside an object still matches.
   The working directory SHALL be the first of `.cwd`, `.workspace_dir`,
   `.project_dir`, `.workspacePaths[0]` selected the same way. A selected value
   that is an empty string SHALL count as absent at the two fallback steps, as
   the shell guard's `-z` tests did: the argument fallback of requirement 4 then
   applies to the command, and the physical current directory of the process
   becomes the working directory, so `{"cwd":""}` is enforced from the process
   directory and never read as a location outside every worktree. A payload that
   does not parse as JSON, or is empty, SHALL be treated as having no command and
   no working directory, never as an error.

6. **Worktree scope.** The guard SHALL enforce only when the working directory
   contains the path component `/.worktrees/`. On Windows a backslash in the
   working directory SHALL be read as a forward slash before that test and
   before the ticket id is taken, so a payload whose `cwd` is
   `C:\Users\ana\crewrig\.worktrees\1328` is in scope. The ticket id SHALL be
   the text between the **last** `/.worktrees/` in the path and the next `/`
   (or the end of the path); an empty id SHALL allow the command. A working
   directory outside any `.worktrees/` SHALL allow the command without any
   other work.

7. **Prohibited set.** A command is prohibited when its text contains any of
   `git reset --hard`, `git checkout -- .`, `git checkout .`, `git clean`,
   `git worktree remove --force`, `git worktree remove -f`, or when it contains
   `git stash` and does not contain `git stash` followed by one space and one of
   `list`, `show`, `pop`, `apply`, `drop`. These are substring tests on the whole
   command text, with the exact quirks of the shell guard: the stash exemption
   never applies when a phrase of the first group is present, it is satisfied by
   an allowed verb anywhere in the text, and `git clean` matches any text
   containing it. The set SHALL NOT change in this ticket.

8. **Decision.** For a prohibited command inside a ticket worktree the guard
   SHALL allow it when the claim state of that ticket is `claimed`, whichever
   agent holds the claim (the shell guard never compared holders), and SHALL
   refuse it otherwise. The claim state SHALL be read from the repository that
   contains the hook process's own current directory, exactly as the shell
   guard did, and not from the repository named by the payload. When the claim
   state cannot be determined — the current directory is not in a git
   repository, git fails, the claim module cannot load — the guard SHALL refuse:
   an undetermined state is never read as `claimed`.

9. **Refusal contract.** A refusal SHALL write exactly one message to standard
   error, nothing to standard output, and exit with status 1, never 2. The
   message SHALL be the text of the shell guard, beginning
   `mempalace-git-guard: prohibited whole-tree operation in shared worktree
   '.worktrees/<ticket>' refused (Spec 0114 R2 / Spec 0153 R2).`, except for
   the invocation hint of requirement 38(a).

10. **Allow contract and silence.** Every other outcome SHALL exit with status
    zero and write zero bytes to standard output and standard error, including
    every warning Node.js itself prints while loading the entry and its lazily
    loaded modules, on every Node.js 24 release, with no Node.js flag and no
    environment variable on the command line. This includes every failure
    before a prohibited command in a ticket worktree has been identified: an
    unreadable standard input, an unparsable payload, an internal error. Both
    entry files SHALL use the entry form of spec 0243 requirement 5 (no
    top-level `import` or `export`, the `warning` listeners removed as the
    first statement), which is reused, not redefined; the plan SHALL verify it
    passes the toolchain gates of spec 0238.

11. **Cheap guard on the hot path.** The guard fires before every shell
    command of every agent session, on all four CLIs. Its entry module SHALL
    decide, with the Node.js standard library alone and without loading the
    claim module graph, whether there is anything to enforce, and SHALL load
    that graph through a lazy `import()` only when the command is prohibited and
    the working directory is inside a ticket worktree (parent requirement 15).
    A test SHALL prove the graph is not loaded for a safe command, for a
    working directory outside a worktree, and for an unparsable payload.

12. **No third-party dependency.** Neither entry point, and no module they
    load, SHALL import a third-party package (parent requirement 6, spec 0240
    requirement 16). `jq` SHALL NOT be spawned (parent requirement 23).

13. **Forwarding shims for the hook.** `hooks/worktree-git-guard.sh` SHALL
    remain, reduced to a forwarding shim that invokes `hooks/worktree-git-guard.ts`
    with the arguments and standard input it received and returns its exit
    status, standard output and standard error unchanged, so an installation
    whose command line still names the `.sh` path keeps its guard until setup
    rewrites it (parent requirement 9). It SHALL stay on the ratchet allowlist
    without adding an entry. The shim SHALL tell the two cases apart in the
    shell, as `hooks/usage-capture.sh` does for `node` itself. When `node` is
    absent from the search path, the shim, which cannot run the floor guard
    because that guard is a JavaScript file `node` runs, SHALL write one
    shell-authored diagnostic line to standard error naming the missing
    `node` and the Node.js 24 floor, and exit with status zero. When `node` is
    present, the shim SHALL run the floor guard of spec 0240 requirement 1 first,
    which prints its own diagnostic and exits non-zero below 24, and SHALL then
    exit with status zero without running the guard. Both exits are zero because
    a guard that cannot start must not refuse every tool call of every session,
    which Copilot CLI's fail-closed `preToolUse` would do with any non-zero
    status. This is the only fail-open path the migration adds, and it
    replaces the shell guard's silent fail-open on a missing `jq`.

14. **Claim tool surface.** `scripts/worktree-claim.ts` SHALL accept the
    subcommands `run`, `take`, `release`, `takeover`, `status`, `history`, and
    `--help` or `-h`; the options `--agent <name>`, `--ticket <id>`,
    `--operation <text>`, `--stale-after <minutes>`, `--help`/`-h` and `--`,
    which ends option parsing and starts the command `run` wraps; and the
    environment variable `CREWRIG_REPO_DIR`, which names the repository the tool
    inspects and, for `run`, the tree the wrapped command executes in, defaulting
    to the current directory. With no argument it SHALL print the usage block to
    standard output and exit 1. An unknown subcommand or argument, a value-taking
    option in final position, a missing `--agent` for `run`, `take`, `release` or
    `takeover`, and a `run` with no command SHALL each exit 1 with the shell
    tool's `Error:` diagnostic on standard error. `status` and `history` take no
    `--agent`.

15. **Exit contract.** The exit codes SHALL be those of the shell tool: 0
    success; 1 genuine failure (not a repository, unwritable common directory,
    unknown argument, a `git status` that itself fails, a mutating subcommand
    outside `.worktrees/`, no derivable ticket for `status`/`history`, a toplevel
    the `run` cannot enter); 4 refused on claim state (`take` and `run` claimed
    by another agent, `takeover` on a claim that is not stale or does not exist,
    `release` by a non-holder), the holder and `since` on standard output; 5
    refused because the tree is not clean (`take` and `run` only), the
    `git status --porcelain --untracked-files=all` listing on standard output; 6
    `release` on an unclaimed worktree; and for `run` the wrapped command's own
    code. Every refusal `run` raises on its own behalf SHALL still open with
    `Refused:` on standard output or `Error:` on standard error and SHALL
    precede the start of the wrapped command, because the overlap of codes 1, 4
    and 5 with the wrapped command's own codes is told apart by that diagnostic
    only (the contract of the shell tool's header, preserved and kept in the
    `--help` block).

16. **Repository context.** The tool SHALL resolve the toplevel and the git
    common directory physically (symlinks resolved), so that the main checkout,
    a worktree and each subdirectory of either print one string for one
    directory; SHALL place the claim root at
    `<common>/crewrig/worktree-claims`; SHALL require the toplevel to lie under a
    `.worktrees/` component for `run`, `take`, `release` and `takeover` and for
    no other subcommand, so that `status` and `history` answer from the main
    checkout after the worktree has been removed; SHALL take the ticket from
    `--ticket` or, when the toplevel is under `.worktrees/`, from its final
    component, and refuse an id that is empty, contains `/`, or is `.` or `..`, and on Windows
    also an id that contains `\`, which is a separator there and would resolve
    outside the claim root.

17. **Lock semantics.** A claim SHALL be a directory
    `<claim root>/<ticket>/` created by an operation that fails when the
    directory already exists, atomically, with no lock file, no polling and no
    retry. `take` SHALL evaluate the clean-tree gate, create the claim, and
    evaluate the gate again, releasing the claim, appending a `take-aborted`
    ledger line and exiting 5 when the tree became dirty inside that window.
    `release` SHALL remove the claim directory. The ledger SHALL be the sibling
    file `<claim root>/<ticket>.log`, append-only, never a child of the claim
    directory, so that releasing a claim cannot remove its history.

18. **On-disk format, shared across implementations.** The files the tool
    writes SHALL be byte-identical to those of the shell tool: in the claim
    directory `holder`, `since` (ISO 8601 UTC, second precision, trailing `Z`),
    `since_epoch` (decimal seconds) and `operation`, each one line ending in a
    line feed; in the ledger, one line per event of the five tab-separated
    fields timestamp, action, agent, ticket, detail, with a tab, a carriage
    return or a line feed inside a free-text field flattened to one space. A
    worktree on an older checkout may still run the shell tool against the same
    git common directory while another runs this one, so each implementation
    SHALL read, honour, take over, release and extend the claims and ledgers of
    the other, proven by golden claim directories and ledgers captured from the
    shell tool and committed as data, not as a shell file.

19. **Clean-tree gate.** `take` and `run` SHALL evaluate the gate on every
    invocation, including when the caller already holds the claim, as the empty
    output of `git status --porcelain --untracked-files=all` run in the
    toplevel. A `git status` that fails SHALL exit 1 with the shell tool's
    diagnostic and never be read as a clean tree. `takeover` SHALL NOT evaluate
    the gate and grants no waiver, and no subcommand SHALL touch a working-tree
    file. The limit that ignored state is outside the gate SHALL stay stated in
    the `--help` block.

20. **Takeover.** `takeover` SHALL transfer a claim held by another agent whose
    age is at least `--stale-after` minutes (default 30), and SHALL otherwise
    refuse with status 4 naming the age and the threshold. `--stale-after` SHALL
    be refused with exit 1 unless it is all decimal digits and, once its leading
    zeros are stripped (leaving at least one digit), at most 9 of them, as the
    shell tool measures it: `0000000001` is accepted as 1 and `1234567890` is
    refused; the stripped value SHALL be read in base 10. A `since_epoch` that is empty, not all digits,
    has a leading zero, or is longer than 18 digits SHALL be read as infinitely
    old; a value in the future by more than 300 seconds likewise; a value in the
    future by up to 300 seconds SHALL be read as zero age. The null case — no
    claim, or the caller already holds it — SHALL exit 4 and 0 respectively,
    with the shell tool's wording.

21. **`run`.** `run` SHALL evaluate the gate first, then acquire the claim, or,
    when the caller already holds it, proceed without acquiring and append a
    `run-reentrant` ledger line; SHALL re-evaluate the gate after acquiring;
    SHALL run the wrapped command with the toplevel as its working directory,
    always, whichever directory the caller stood in; and SHALL exit with the
    wrapped command's code. At exit, including after an interrupt or a
    termination request, it SHALL release the claim only when this invocation
    acquired it and the holder is still the invoking agent; when the claim is
    gone, or another agent has taken it over, it SHALL leave it intact, append a
    `release-declined` ledger line, print the shell tool's two-line `Notice:` to
    standard error, and keep the wrapped command's code. The claim SHALL NOT be
    released while the wrapped command is still running.

22. **Launching the wrapped command.** The wrapped command SHALL be started
    from its argument vector, with its standard streams inherited and no shell
    interpreting the arguments. A command that cannot be found SHALL exit 127,
    one that cannot be executed 126, each with a diagnostic naming the command
    and with the claim released; a command ended by a signal SHALL give `128`
    plus the signal number on macOS and Linux. On Windows the command SHALL be
    resolved the way the platform resolves an executable name, including the
    `.cmd` shims such as `npm`, without interpreting argument characters as
    shell syntax; when no mechanism can do that safely the tool SHALL refuse
    such a command with exit 1 and a diagnostic before the claim is taken, and
    SHALL NOT fall back to a POSIX shell.

23. **Platform-aware paths.** Every path the tool builds or compares SHALL be
    built and tested platform-independently (parent requirement 22). On macOS
    and Linux every printed path SHALL be byte-identical to the shell tool's; on
    Windows paths SHALL print in the platform's native form and the `.worktrees/`
    test SHALL accept both separators.

24. **No POSIX utility.** The tool SHALL spawn only Git (parent requirement
    23); `date`, `tail`, `cut`, `wc`, `tr`, `cat`, `mkdir`, `rm`, `bash` and
    `sh` SHALL NOT be spawned, and no third-party package SHALL be imported.

25. **Floor and entry form.** The claim entry SHALL use the entry form of
    requirement 10, so `node scripts/worktree-claim.ts` prints no Node.js
    warning on standard error, which is part of its observable contract. As a
    user-facing entry point (parent requirement 4) it SHALL be documented behind
    the floor-guard step the way `docs/ticket-ownership.md` documents
    `ticket-pickup`, and SHALL leave the filesystem unmodified on a Node.js below
    the floor.

26. **Forwarding shim for the claim tool.** `scripts/worktree-claim.sh` SHALL
    remain, reduced to a forwarding shim that runs the floor guard of spec 0240
    requirement 1 and then `scripts/worktree-claim.ts` with every argument and
    its standard input, and
    returns its exit status, standard output and standard error unchanged, so
    the Bash oracle of requirement 35, the nested invocations those tests make
    and any documentation not yet re-read keep working. It SHALL stay on the
    ratchet allowlist without adding an entry. When `node` is absent from the search path the shim, which cannot run the
    floor guard, SHALL write one shell-authored `Error:` line to standard error
    naming the missing `node` and the Node.js 24 floor and exit 1. When `node` is
    present and below the floor, it SHALL exit with the floor guard's non-zero
    status and diagnostic without running the tool.

27. **One descriptor, no new mechanism.** This ticket SHALL register one hook
    descriptor for the guard (basename `worktree-git-guard`, no per-CLI
    arguments, an arguments pattern that accepts none) with the descriptor type
    of spec 0243 requirement 25, and SHALL set `guardedPrefix` on it, which
    spec 0243 delta-03 requirement 34 reserves for the Antigravity CLI hooks
    descriptors of rows C2 and C3 and forbids on the usage-capture descriptor.
    The command lines, the refusals, the measured-surface constant, the
    recognition, the rewrite and the Antigravity named-hook keep and remove
    primitives SHALL be those of `scripts/lib/hook-command.ts`,
    `hook-descriptor.ts`, `hook-recognition.ts`, `hook-rewrite.ts` and
    `hook-antigravity.ts`, with their contracts and signatures unchanged. An
    operation these primitives lack — writing the guard's named-hook entry — SHALL
    be added in a new module that calls them.

28. **Wiring files.** The guard entries of `hooks/claude-transcript-hooks.json`,
    `hooks/gemini-transcript-hooks.json`, `hooks/copilot-transcript-hooks.json`
    and `hooks/antigravity-transcript-hooks.json` SHALL carry the direct `node`
    form with the path tokens they carry today (`$CLAUDE_PROJECT_DIR`,
    `${GEMINI_PROJECT_DIR}`, `${COPILOT_PROJECT_DIR:-$PWD}`, the relative
    `hooks/` path), which setup always replaces with the absolute path of the
    checkout; no installed command line SHALL carry a token that row 37c of
    `docs/cli-matrix.md` records as unusable on its CLI. Events, matchers, hook
    names, the Antigravity `timeout` and every `mempalace-transcript` entry SHALL
    stay byte-identical: those entries belong to row C3, and the two rows touch
    only their own entries in these four files.

29. **Per-CLI command line.** The guard command written for each CLI SHALL be
    the one `hook-command.ts` produces: Claude Code, and every CLI on macOS and
    Linux, `node "<abs>/hooks/worktree-git-guard.ts"`; Gemini CLI and Copilot
    CLI on Windows the same text with the absolute path spelled out, no token and
    no `NAME=value` prefix, for Copilot CLI under the `command` key; and
    Antigravity CLI on Windows, in state (e) of spec 0243 delta-03 requirement 32,
    `set NoDefaultCurrentDirectoryInExePath=1&& node <abs>/hooks/worktree-git-guard.ts`
    with the path unquoted and in forward slashes. In any other state, and for a
    checkout path the target interpreter would read as syntax, the module
    produces no command line and setup SHALL write nothing for that CLI, report
    the module's diagnostic, and the parity gap SHALL be recorded in
    `docs/cli-matrix.md` in the implementation PR (parent requirement 19). The
    path SHALL stay the in-repo physical path of the checkout, never an installed
    copy (spec 0169 requirement 2).

30. **Rewrite on every setup run.** On every run of
    `scripts/setup-claude-interactive.sh`, `scripts/setup-gemini-interactive.sh`,
    `scripts/setup-copilot-interactive.sh` and
    `scripts/setup-antigravity-interactive.sh`, every registered guard command —
    the legacy `bash …/worktree-git-guard.sh` forms, the direct form, and the
    Antigravity CLI named hook `crewrig-worktree-git-guard` — SHALL be rewritten
    to the command line of requirement 29, whichever answer the user gives to the
    session-recording question, including `no` and a cancelled confirmation:
    rewriting keeps the registered hook in place and removes nothing. When the
    user does enable session recording, the guard entry merged from the manifest
    SHALL already be in that form. The rewrite keeps each entry's event, matcher,
    name, key order and every other key and entry; reports by name and count what
    it rewrote and what it left and why; writes backup-first at mode 0600 and
    leaves the file byte-identical when it fails; refuses a configuration that is
    not a JSON object; puts no configuration content on any argument list; is
    idempotent (a second run writes nothing and creates no backup); and leaves a
    command pointing at another checkout unchanged unless the `.ts` file sits
    next to that checkout's registered `.sh` (spec 0243 requirements 19 and 21 to
    23, applied to this descriptor). It SHALL NOT rewrite, keep, deduplicate or
    remove any `mempalace-transcript` command.

31. **Recognition by content, in both twins.** A command SHALL count as the
    framework's guard command when its whole shape matches: an optional
    environment or interpreter prefix, a script path ending in
    `/hooks/worktree-git-guard.sh` or `/hooks/worktree-git-guard.ts`, quoted or
    not, and no arguments; or, for the Antigravity CLI descriptor only, the exact
    guarded form. An operator's own hook that merely names a script called
    `worktree-git-guard.sh` or `.ts` with other arguments or in a longer command
    SHALL never be rewritten, kept, deduplicated, re-pointed or removed. The
    TypeScript recognition and the Bash predicate that classifies framework-owned
    session-recording handlers (`sr_is_own` in `scripts/lib/usage-capture-optin.sh`,
    which today accepts a `bash` wrapper and a `.sh` path only) SHALL accept and
    reject the same commands for the guard, proven by one shared fixture corpus
    run through both, so that the merge of the session-recording manifest
    produces exactly one guard entry from a configuration holding the legacy form,
    the direct form, or both.

32. **Setup reaches the mechanism through `node`.** While the four setups and
    `scripts/lib/common.sh` are Bash, they SHALL obtain the guard command and
    perform its rewrite through `node`, replacing the `jq` substitutions that
    today rewrite the guard (`gsub` of the project-dir token in the Claude setup,
    the `"bash " + $guard_path` rebuild in the Gemini and Copilot setups, and
    `guard_rewrite` in `deploy_antigravity_transcript_hooks`); the new mechanism
    SHALL spawn no POSIX-only utility. A `node` that runs a major version below
    24 SHALL stop the rewrite as spec 0243 requirement 24 does, through the same
    floor check and not a second implementation: setup prints the floor
    diagnostic and leaves every installed guard command as it is.

33. **Latency budgets (parent requirement 15).** Each budget is an upper bound
    on wall-clock time from process start to process exit, Node.js start-up
    included, over 10 consecutive runs on `windows-latest`, measured by the
    harness of spec 0240 requirement 13: (a) `hooks/worktree-git-guard.ts` on its
    fast path (a safe command, or a working directory outside a worktree): 750 ms;
    (b) the same entry on its slow path (a prohibited command in a ticket
    worktree, the claim state read in-process from a fixture repository, for the
    allowed and for the refused outcome): 2000 ms. The values are initial and the
    rule of spec 0243 requirement 15 applies unchanged: after the first green run
    the implementation PR replaces each with `max(3 x the largest observed run,
    300 ms)` rounded up to the next 50 ms when that is lower, states it in the
    workflow next to its script, and a run that exceeds it fails its job naming
    the script, the budget and the measured time. Both stay inside the
    5-second timeout the Antigravity CLI manifest declares for the guard.
    `scripts/worktree-claim.ts` is not wired at a CLI integration point and
    carries no budget.

34. **`windows-latest` proof (parent requirement 17).** The implementation PR
    SHALL add jobs, copied from the template of spec 0240 requirement 12 and
    recorded in `ci/ci-capabilities.yml` as `portability: specific` (spec 0240
    requirement 15), that from a non-POSIX interpreter: (a) invoke
    `hooks/worktree-git-guard.ts` with a payload of each CLI's shape and a working
    directory whose separators are backslashes, and assert exit 1 and the refusal
    text for a prohibited command without a claim, exit 0 with empty streams with
    a claim and for a safe command; (b) run the command line the module produces
    for each of the four CLIs through the invocation row 37 records for it —
    `bash -c` for Claude Code, `powershell.exe -NoProfile -NonInteractive
    -Command` for Gemini CLI and Copilot CLI, `cmd /c` for Antigravity CLI's hooks
    surface — from a checkout path that has no space for Antigravity CLI, and
    assert the guard ran; (c) enforce the budgets of requirement 33; and (d)
    invoke `scripts/worktree-claim.ts` against a fixture repository and worktree
    under a `.worktrees/` directory and assert `take`, `status`, the refusal 4 of
    a second agent, the refusal 5 of a dirty tree, `release`, the notice 6,
    `history`, `takeover`, and `run` propagating a wrapped `git` command's code,
    with the claim directory and the ledger in the format of requirement 18.

35. **Oracle (parent requirement 13).** `scripts/tests/test-worktree-git-guard.sh`
    (101 lines) and `scripts/tests/test-worktree-claim.sh` (1599 lines) SHALL stay
    Bash, SHALL NOT migrate in this pull request, and SHALL pass on Linux CI
    against the TypeScript versions through the shims of requirements 13 and 26
    with their assertions unchanged. The setup suites that assert a wired guard
    command text — `scripts/tests/test-setup-claude-transcript.sh`,
    `test-setup-gemini-transcript.sh`, `test-setup-copilot-transcript.sh`,
    `test-setup-antigravity-transcript.sh`, `test-setup-gemini-settings-merge.sh`
    and `test-setup-usage-capture-optin.sh` — SHALL stay Bash, and only the
    assertions whose expected value is the guard's command text (the `bash` form
    or the `worktree-git-guard.sh` path) SHALL change to the direct form, which
    the implementation PR SHALL list. The two suites above migrate in sub-spec
    J1a (#1340) after the TypeScript versions have merged green on Linux CI and on
    their `windows-latest` jobs; this ticket hands J1a that list and fixes no
    migration of them. New black-box tests in TypeScript SHALL cover what the
    oracle does not: requirements 3, 5 to 8, 10 and 11 (including a machine with
    no `jq`), the interruption and termination paths of requirement 21, the launch
    outcomes of requirement 22, the golden fixtures of requirement 18, the
    wiring of requirements 28 to 32 and the corpus of requirement 31.

36. **CI wiring.** The capabilities that run the two oracle suites — `test-wiring`
    and `chroma-mcp` in `ci/ci-capabilities.yml`, and their renderings in
    `.github/workflows/build.yml` and `.gitlab-ci.yml` — SHALL name
    `hooks/worktree-git-guard.ts`, `scripts/worktree-claim.ts` and the shared
    modules in their path filters and cache keys, so a change to the TypeScript
    source reruns the oracle that guards it; today a change to
    `scripts/worktree-claim.sh` itself triggers neither suite. The existing
    entries naming the `.sh` shim stay. The CI parity check SHALL stay green.

37. **References updated in the same pull request (parent requirement 9).**
    Every documentation page, workflow path filter, capability entry and
    manifest that names the old invocation SHALL be updated: at least
    `docs/agent-team-protocol.md` (the `worktree-claim.sh run`, `take`, `status`,
    `history` and `takeover` invocations and their prose), row 29 and the
    related parity-gap text of `docs/cli-matrix.md`, `docs/layers.md`, the
    `--help` block, the guard's refusal hint, `ci/ci-capabilities.yml`,
    `.gitlab-ci.yml`, `.github/workflows/build.yml` and, when a listed core path
    changes, `.crewrig/core-paths.txt`. The documentation SHALL state that the
    guard needs Node.js 24 or later when it fires, and that a Node.js downgraded
    after setup makes it fail with Node.js's own status until setup is re-run
    (spec 0243 requirement 30).

38. **Deviations from the shell behaviour (parent requirement 14).** The
    observable contract of both scripts SHALL be preserved except for exactly
    these, each justified above: (a) the invocation the guard's refusal message
    and the claim tool's `--help` block name, which becomes
    `node scripts/worktree-claim.ts …` where it was `bash
    scripts/worktree-claim.sh …`, because the second form is not available on
    Windows; the rest of the message is byte-identical; (b) the command lines each
    CLI runs (requirements 28 to 30); (c) on a machine without `jq` the guard now
    parses the payload and enforces, where the shell guard parsed nothing and
    allowed everything; (d) the shell guard allowed a prohibited command when
    `scripts/worktree-claim.sh` was missing or not executable, a branch that has
    no equivalent now that the claim module ships beside the guard, and an
    unloadable module refuses under requirement 8; (e) the diagnostics for a
    wrapped command that cannot be launched and the exit codes of a signalled
    wrapped command (requirement 22), which a shell worded and numbered as
    `line N: <command>: command not found`; (f) native path separators on Windows
    (requirement 23), and the refusal on Windows of a `--ticket` containing `\`
    (requirement 16); (g) the shim behaviour of requirements 13 and 26 when `node`
    is absent or below the floor; (h) an unindexable segment of the extraction
    chain counts as absent where the shell guard's `jq` selected nothing
    (requirement 5). On macOS and Linux no other byte of standard output, standard
    error or any file written differs.

## Scenarios

**Scenario:** A safe command in a worktree costs the fast path

Given a Claude Code `PreToolUse` payload whose `cwd` is
`/repo/.worktrees/1328` and whose command is `git status`
When `hooks/worktree-git-guard.ts` runs with the payload on standard input
Then it exits zero having written no byte, the claim module graph is never
loaded, no other process is spawned, and on `windows-latest` its run stays
within its 750 ms budget over 10 runs.

**Scenario:** A working directory outside any worktree is not enforced

Given a payload whose `cwd` is `/tmp/some-dir` and whose command is
`git reset --hard`
When the guard runs
Then it exits zero silently without loading the claim module graph; and on
Windows a `cwd` of `C:\Users\ana\crewrig\.worktrees\1328` with the same command
is in scope, its ticket id is `1328`, and it takes the slow path.

**Scenario:** A whole-tree operation without a claim is refused

Given a ticket worktree `.worktrees/771` whose ticket has no claim, in the
repository the hook process runs in
When the guard receives `git reset --hard`, then `git clean -fd`, then a bare
`git stash`
Then each is refused with exit status 1, standard output is empty, and standard
error carries one message beginning `mempalace-git-guard:` that names
`.worktrees/771` and the `node scripts/worktree-claim.ts take` hint.

**Scenario:** The same operation with a claim is allowed

Given a claim held on ticket `771` by any agent, taken by `take` or by an
in-flight `run`
When the guard receives `git reset --hard`
Then it exits zero having written no byte; and for `git stash list` and
`git stash pop`, which the exemption allows, it exits zero without needing a
claim.

**Scenario:** Every CLI's payload shape is read

Given the Antigravity CLI payloads `{"toolCall":{"name":"run_command","args":
{"CommandLine":"git reset --hard"}}}`, `{"toolCall":{"args":{"cmd":"git reset
--hard"}}}` and `{"workspacePaths":["/tmp/repo/.worktrees/771"],"toolCall":{"args":
{"CommandLine":"git clean -fd"}}}`, and the Claude Code, Gemini CLI and Copilot
CLI shapes under `.tool_input.command` and `.command`
When the guard runs for each, in a worktree with no claim
Then each is refused with exit status 1; and with the first positional argument
`git reset --hard` and an empty standard input it is refused likewise.

**Scenario:** Nothing parseable allows the command

Given an empty standard input, then the text `not json`, on a machine where `jq`
is absent
When the guard runs with no positional argument
Then it exits zero silently both times; and given a payload that does parse, on
the same machine, it enforces as on a machine with `jq`.

**Scenario:** Empty and unindexable payload values follow the shell's fallbacks

Given the payloads `{"cwd":"","tool_input":{"command":"git reset --hard"}}`,
`{"tool_input":{"command":""}}` with the first positional argument
`git reset --hard`, and `{"tool_input":"git reset --hard","cwd":"/repo/.worktrees/771"}`,
the first two with the hook process's current directory inside
`.worktrees/771`, and no claim
When the guard runs for each
Then the first is enforced from the process directory and refused, the second
takes the command from the argument and is refused, and the third is refused
because the unindexable `.tool_input.command` counts as absent and the chain
reaches `.tool_input`.

**Scenario:** An undetermined claim state refuses

Given a prohibited command in a ticket worktree, and a hook process whose current
directory is not inside any git repository
When the guard runs
Then it refuses with exit status 1 and never reads the undetermined state as
`claimed`; the shell guard refused in the same case, when `status` printed
nothing, and this is preserved.

**Scenario:** An installed legacy command keeps guarding through the shim

Given a configuration still holding `bash "/repo/hooks/worktree-git-guard.sh"`
When the CLI fires it with a prohibited command and no claim
Then the shim forwards to the TypeScript guard and the refusal reaches the CLI
with status 1 and its message; with `node` absent from the search path the shim
writes its own one-line diagnostic and exits zero; and with a `node` reporting
major version 20 the shim runs the floor guard, which prints the diagnostic naming
20 and 24, and exits zero.

**Scenario:** Take, status and release round-trip

Given a clean worktree `.worktrees/736` of a fixture repository
When `take --agent alice`, `status`, a second `take --agent bob`, `release
--agent bob`, `release --agent alice` and `history` run
Then they exit 0, 0, 4, 4, 0 and 0 in that order, `status` prints `state: claimed` and
`holder: alice`, the refusals print the holder and `since`, the claim directory
holds `holder`, `since`, `since_epoch` and `operation`, and `history` prints the
ledger lines of both actions after the claim directory is gone.

**Scenario:** A dirty tree and an unclaimed release are refused with their codes

Given a worktree with an untracked file inside an untracked directory
When `take --agent alice` runs, then `release --agent alice`
Then `take` exits 5 and prints the nested file in the `git status` listing and
leaves no claim, and `release` exits 6 with a notice.

**Scenario:** `run` releases on both outcomes and propagates the code

Given a clean worktree
When `run --agent alice -- true` runs, then `run --agent alice -- sh -c 'exit 42'`
Then the first exits 0 and the second 42, no claim remains after either, and the
ledger records `release alice <ticket> run`.

**Scenario:** `run` from a subdirectory acts on the toplevel

Given a worktree with a subdirectory `sub` and a caller standing in it
When `run --agent alice -- pwd` (or its Windows counterpart) runs
Then the wrapped command's working directory is the worktree root.

**Scenario:** A takeover that lands inside a run survives that run

Given `run --agent alice` wrapping a command that ages the claim and calls
`takeover --agent bob`
When the wrapped command ends
Then bob's claim is left intact, no `release alice` ledger line exists, a
`release-declined` line does, and a `take --agent carol` is refused with 4
naming bob.

**Scenario:** An unreadable `since_epoch` or `--stale-after` is handled safely

Given a claim whose `since_epoch` is `0900`, then 19 digits, then 400 seconds in
the future, then 100 seconds in the future, and a call with `--stale-after 08`,
then `--stale-after 0000000001`, then `--stale-after 1234567890`
When `takeover --agent bob` runs for each
Then the first three take over, the fourth is refused as not stale, `08` means
eight minutes, `0000000001` is accepted as one minute, and the ten-digit value is
refused with exit 1 before any arithmetic.

**Scenario:** A ticket id cannot leave the claim root

Given `status --ticket ../x`, and on Windows `status --ticket "..\x"`
When the tool runs
Then each exits 1 naming the invalid ticket, on Windows because `\` is a
separator there, and nothing is read or written outside the claim root.

**Scenario:** A wrapped command that cannot start releases the claim

Given a clean worktree
When `run --agent alice -- no-such-command` runs
Then it exits 127 with a diagnostic naming the command, and no claim remains.

**Scenario:** Both implementations share a repository

Given a claim directory and a ledger captured from the shell tool and committed
as golden data, and the same pair produced by the TypeScript tool
When each implementation runs `status`, `takeover`, `release` and `history` over
the pair the other wrote
Then every command answers as it would over its own, and the files it writes are
byte-identical to the golden form.

**Scenario:** An existing installation is rewritten on the next setup run

Given a Claude Code settings file holding
`bash "/repo/hooks/worktree-git-guard.sh"` under `PreToolUse` on `Bash`, a
`mempalace-transcript` hook on three events, and a checkout at `/repo` that holds
`hooks/worktree-git-guard.ts`
When the user re-runs `scripts/setup-claude-interactive.sh` and answers `no` to
session recording
Then the guard command reads `node "/repo/hooks/worktree-git-guard.ts"` after a
0600 backup, the three transcript hooks and every other entry are byte-identical,
the rewrite is reported by name and count, and a second run writes nothing and
creates no backup; and the same holds for the Gemini CLI, Copilot CLI and
Antigravity CLI configurations.

**Scenario:** The session-recording merge never duplicates the guard

Given a configuration holding the legacy guard command, then the direct one, then
both
When setup runs and the user answers `yes` to session recording
Then each configuration ends with exactly one guard command, in the form of
requirement 29, and the shared corpus of requirement 31 gives the same
verdict in the TypeScript recognition and in the Bash predicate for every command
in it.

**Scenario:** A command that is not ours is never rewritten

Given a hook whose command is `node "/opt/tools/worktree-git-guard.ts" --strict`,
and another that chains `bash /opt/prep.sh && bash
/repo/hooks/worktree-git-guard.sh`
When setup runs
Then neither is rewritten, kept, deduplicated or removed.

**Scenario:** The Windows Antigravity CLI guard receives the guarded form

Given row 37f and the constant's hooks entry in state (e), and a Windows checkout
at `C:/Users/ana/crewrig`
When setup writes the `crewrig-worktree-git-guard` named hook of
`~/.gemini/config/hooks.json`
Then its `PreToolUse` handler on `run_command` reads
`set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/worktree-git-guard.ts`,
after a 0600 backup, with the `mempalace-transcript` named hook untouched; from
`C:/Users/Ana Diaz/crewrig` the module refuses with the whitespace diagnostic,
setup writes nothing for Antigravity CLI, and the gap is recorded in
`docs/cli-matrix.md`.

**Scenario:** An unsupported Node.js stops the rewrite

Given `node` on the search path reports major version 20 and a legacy guard
command is installed
When the user runs setup
Then setup prints the floor guard's diagnostic naming version 20 and the floor
24, rewrites nothing, and leaves the legacy command in place.

**Scenario:** The Bash oracle passes against the shims

Given the TypeScript versions and both shims on Linux CI
When `scripts/tests/test-worktree-git-guard.sh` and
`scripts/tests/test-worktree-claim.sh` run with their assertions unchanged
Then both pass, and a change to `hooks/worktree-git-guard.ts` or
`scripts/worktree-claim.ts` alone reruns them.

**Scenario:** The claim tool runs from PowerShell with no POSIX layer

Given a `windows-latest` job with a fixture repository and a worktree under
`.worktrees/`
When the job runs the sequence of requirement 34(d) from PowerShell
Then every exit code, marker line, claim file and ledger line matches the shell
tool's contract.

**Scenario:** A budget regression breaks the job

Given a change that makes the guard load the claim module graph before it
decides whether the command is prohibited
When the `windows-latest` timing step runs the fast-path budget
Then the job fails, naming `hooks/worktree-git-guard.ts`, 750 ms and the
measured time.

## Out of scope

- `hooks/mempalace-transcript.sh`, its entries in the four transcript manifests
  and its recognition: row C3. This spec edits only the guard entries and the
  guard alternative of the shared Bash predicate, and the second of the two rows
  to land rebases onto the first without changing the other's entries.
- Migrating `scripts/setup-*-interactive.sh` (row F1), `scripts/lib/common.sh`
  and `scripts/lib/usage-capture-optin.sh` (retired with their last consumer, J4),
  and the `fzf` questions and their wording.
- Migrating the Bash tests of requirement 35 (row J1a, #1340), the other suites
  that mention the guard in setup, and retiring the two shims before J4.
- Changing the prohibited set, the events and matchers the guard is registered
  on, the Antigravity CLI `timeout`, or the coupling of the guard's registration
  to the session-recording opt-in; and extending the guard to a tool a CLI
  offers on Windows that its matcher does not name.
- Making the guard compare the claim's holder with the acting agent, or read
  the claim from the payload's working directory (see *Open questions*).
- Changing the exit status of a refusal, which stays 1.
- Making the guard work when `node` is missing or older than 24 at fire time:
  the floor is checked at setup (requirement 32) and the residual documented
  (requirement 37).
- A latency budget for `scripts/worktree-claim.ts`, and a Windows signal
  semantics beyond what requirement 21 states for the platform.
- Re-measuring rows 37 to 37f of `docs/cli-matrix.md`.
- Any normative change to spec 0215; none is needed (see *Open questions*).

## Open questions

- [GROUNDING] The guard refuses with exit status 1. Spec 0117 cites exit 2 as
  the blocking status on Claude Code `PreToolUse`, and `docs/usage-capture.md`
  records that Claude Code and Gemini CLI read status 1 as a non-blocking
  error on the events it measured; only Copilot CLI documents `preToolUse` as
  fail-closed. Whether status 1 blocks a command on Claude Code `PreToolUse`,
  Gemini CLI `BeforeTool` and Antigravity CLI `PreToolUse` is unmeasured in the
  repository. This spec preserves status 1 (parent requirement 14, requirement 9)
  and does not decide it. It needs a probe and, if status 1 does not block, a
  delta of `specs/0153-tool-boundary-git-worktree-guard.md` and a separate
  ticket; the owner decides whether that blocks the implementation PR.
- [GROUNDING] The guard reads the claim from the repository of the hook
  process's own current directory (requirement 8). The Antigravity CLI hooks
  surface runs in the `hooks.json` directory, which is not a repository, so
  `status` cannot resolve there and the guard refuses every prohibited command
  there even when a claim is held. This is inherited from the shell guard and
  preserved; whether to read the payload's directory instead is a behaviour
  change for a separate ticket. Unverified on a live Antigravity CLI session.
- [GROUNDING] The shell guard only tests that the ticket is claimed, not that
  the acting agent holds the claim, which spec 0153 requirement 2 words more
  strongly. Preserved (requirement 8); closing the gap needs an agent identity
  the payload does not carry.
- Assumption to confirm: the shims fail open when Node.js is missing or below
  24 (requirement 13) rather than refusing every tool call. A fail-closed shim
  would brick Copilot CLI's `preToolUse` for every session on such a machine.
- Assumption to confirm: setup rewrites the guard command whatever the user
  answers to the session-recording question (requirement 30), because parent
  requirement 15 asks for the rewrite on the next run and a declined question
  leaves the hook in place; the Gemini CLI setup's decline message says earlier
  registrations are left in place and its wording changes in the implementation
  PR to say the guard command was rewritten.
- Plan decision with a fallback: how the wrapped command is launched on Windows
  without a shell so that `.cmd` shims resolve (requirement 22). If no
  mechanism satisfies it, the tool refuses such commands and a delta of this
  spec records the gap in `docs/cli-matrix.md`.
- Possible 0215 interpretation, no delta proposed: requirement 9's "a forwarding
  shim that only invokes the TypeScript version" is read here to allow the shim
  of requirement 26 to run the floor guard first, and the guard shim of
  requirement 13 to exit zero below the floor. If the owner reads "only invokes"
  more narrowly, a delta of `0215` requirement 9 is needed before the
  implementation PR.
