---
id: "0215"
slug: shell-to-typescript-migration
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1231
version: 1.0.0
---

# Shell-to-TypeScript migration (parent spec)

## Intent

A user on Windows, macOS or Linux installs CrewRig and runs every part of it —
setup, install, build, hooks, skill-bundled tools, CI checks and tests — with
the same commands and the same observable behaviour on the three operating
systems, and without a POSIX compatibility layer (Windows Subsystem for Linux
or Git Bash). At the end of the migration no shell script remains in the
repository, the four supported CLIs keep working on all three operating
systems, and at no point during the migration does a script lose behaviour or
does the shell footprint grow back.

This is the parent spec of a `large`-tier ticket. It states the invariants of
the whole migration and declares its decomposition into sub-specs; it does not
specify how any individual script is rewritten. Its requirements encode the
seven bindings resolved unanimously in IDEA session issue #1192 (parent study
issue #1191) and are not open to re-negotiation at sub-spec level.

## Requirements

1. **Runtime and distribution (binding 1).** Every CrewRig script that this
   spec migrates SHALL be authored in TypeScript and SHALL run on Node.js 24
   LTS directly from its `.ts` source, through Node's built-in type stripping,
   with no compilation, bundling or transpilation step between the repository
   checkout and execution.

2. **Runtime and distribution (binding 1).** Migrated TypeScript sources SHALL
   use erasable syntax only — no construct that type stripping cannot remove
   without code generation (`enum`, `namespace` with runtime content, parameter
   properties, legacy decorators, `import =` aliases). A CI check SHALL reject
   any non-erasable construct, and a CI check SHALL type-check every TypeScript
   source, because type stripping executes code without checking types.

3. **Runtime and distribution (binding 1).** The supported distribution channel
   SHALL be the repository checkout: every migrated script SHALL run from a
   path inside a cloned CrewRig repository, and no migrated script SHALL be
   placed under a `node_modules` directory (Node refuses type stripping there).

4. **Runtime and distribution (binding 1).** Every migrated user-facing entry
   point SHALL verify, before modifying any file, that the running Node.js
   major version is 24 or later; when it is not, the entry point SHALL exit
   non-zero with a diagnostic naming the detected version, the required floor,
   and where to obtain a supported release, and SHALL leave the filesystem
   unmodified. The check SHALL run and emit that diagnostic on Node.js releases
   that cannot execute TypeScript at all, so it SHALL NOT depend on type
   stripping; how it achieves this is left to sub-spec A.

5. **Runtime and distribution (binding 1).** The prerequisites for a first
   install SHALL be limited to Git, Node.js 24 LTS, the Python toolchain
   MemPalace already requires, and the target CLI itself. A POSIX shell SHALL
   NOT be a prerequisite on any operating system once the setup/install/manage
   step of the strangler order (requirement 8) has shipped.

6. **Runtime and distribution (binding 1).** Every third-party runtime
   dependency a migrated script introduces SHALL be pinned by the repository
   lockfile and SHALL be justified in the sub-spec that introduces it; a
   sub-spec that needs no third-party dependency SHALL rely on the Node.js
   standard library alone.

7. **Scope and strangler order (binding 2).** The migration scope SHALL be
   every tracked shell script in the repository — measured by issue #1191 at
   258 files and about 78,000 lines on `main @ ab480c0`, and at 268 tracked
   `*.sh` source files and 84,588 lines at `main @ 3cbe519` when authoring this
   spec (both counts exclude the built copies under `.claude/`, `.gemini/`,
   `.github/` and `.agents/`) — including hook scripts, `scripts/lib/`
   libraries, CI checks, the Bash test suites, the scripts bundled with skills
   under `artifacts/**/skills/*/scripts/`, and the scripts shipped with
   `extensions/` and `extension-skeleton/`. The end state SHALL contain no
   tracked shell script and no shipped command line that invokes `bash` or
   `sh`.

8. **Scope and strangler order (binding 2).** The migration SHALL proceed
   incrementally, with shell and TypeScript coexisting, in this order: (a)
   hooks; (b) setup, install, manage and import entry points; (c) build
   scripts; (d) skill- and extension-bundled scripts; (e) CI checks and tests,
   ending with the removal of the last shell file. A shared `scripts/lib/`
   shell library SHALL be retired in the same step as its last consumer, not
   earlier. A sub-spec MAY migrate a script ahead of its step only when that
   script is a dependency of a script in the current step, and SHALL name that
   dependency.

9. **Scope and strangler order (binding 2).** When a script migrates, its
   previous `.sh` path SHALL either be removed in the same pull request or be
   reduced to a forwarding shim that only invokes the TypeScript version; a
   shim SHALL remain on the ratchet allowlist (requirement 10) and SHALL be
   removed no later than the final sub-spec. Every documentation page,
   `Taskfile.yml` task, workflow step and skill instruction that names the old
   invocation SHALL be updated in the same pull request that migrates the
   script.

10. **Ratchet (binding 3).** From the first pull request that migrates a
    script, a CI check SHALL fail when a tracked shell script — a `*.sh` file,
    or any file whose shebang names `bash` or `sh` — exists outside a committed
    allowlist. The allowlist SHALL list exactly the shell files present when
    the check lands, SHALL only shrink, and the check SHALL fail when a pull
    request adds an entry or leaves an entry whose file no longer exists. Built
    copies regenerated from an allowlisted source SHALL be covered through
    their source and SHALL NOT need their own entry.

11. **Ratchet (binding 3).** The same check SHALL fail when a pull request adds
    a tracked Python file that does not import the `mempalace` Python library,
    or adds a tracked JavaScript file (`*.js`, `*.mjs`, `*.cjs`) outside the
    set present when the check lands (requirement 16). The only JavaScript
    files a pull request MAY add are the Node.js floor guard of requirement 4
    and a configuration file whose third-party tool requires JavaScript; each
    SHALL enter the allowlist with its justification in the sub-spec that
    introduces it.

12. **Ratchet (binding 3).** The ratchet check itself, and every new CI check
    the migration introduces, SHALL be written in TypeScript under requirements
    1–3.

13. **Oracle rule (binding 4).** A script and its Bash test SHALL NOT migrate
    in the same pull request. While the script migrates, its existing Bash test
    SHALL remain unchanged in its assertions and SHALL pass against the
    TypeScript version on Linux CI; the test SHALL migrate only in a later pull
    request, after the TypeScript version has shipped green on Linux CI and on
    its `windows-latest` job (requirement 17). A script with no Bash test SHALL
    gain a black-box test before or with its migration, and that test SHALL
    then play the oracle role.

14. **Oracle rule (binding 4).** A migrated script SHALL preserve the
    observable contract of the script it replaces — command-line arguments,
    exit codes, standard output, standard error and files written — except
    where its sub-spec lists a deviation explicitly and justifies it.

15. **Hooks (binding 5).** Every migrated hook SHALL be wired in
    `hooks/*-transcript-hooks.json` and `hooks/*-usage-capture-hooks.json` as a
    direct `node "<path>/<hook>.ts"` command line, with no dispatcher and no
    intermediate CrewRig entry point. Setup SHALL rewrite already-installed
    hook command lines to the new form on its next run. Each hook sub-spec
    SHALL set a per-hook latency budget — stated as an upper bound on
    wall-clock time from process start to exit, Node.js start-up included, over
    a stated number of runs — and a timing assertion in that hook's
    `windows-latest` CI job SHALL fail the build when the budget is exceeded. A
    hook on a hot path SHALL keep a cheap guard in its entry module and SHALL
    load the rest of its module graph through a lazy `import()` only when the
    guard finds work to do. A hook SHALL NOT migrate before its budget is set.

16. **Permitted languages (binding 6).** The code base SHALL contain only three
    kinds of scripting code: TypeScript, which SHALL be the only language for
    new code; the JavaScript already tracked when the ratchet lands (at
    authoring time 51 source files, including the usage subsystem under
    `scripts/lib/usage-*` and `scripts/lib/spec-linter.js`), which already runs
    on Node.js, MAY be typed in place when a change touches it, and SHALL NOT
    grow beyond the exceptions of requirement 11; and code that imports the
    `mempalace` Python library, the sole exception to "Node only" — at
    authoring time `scripts/lib/mempalace-http-wrapper.py`,
    `scripts/lib/mempalace_pin.py`,
    `artifacts/library/skills/harness-curator/scripts/curate.py` and
    `artifacts/library/skills/harness-curator/scripts/apply.py`. The other
    tracked Python files (`scripts/lib/check-figure-labels.py`,
    `scripts/lib/en_us_sweep.py`) SHALL migrate to TypeScript. Invoking the
    excepted Python files from a migrated script is permitted.

17. **Parity proof (binding 7).** Every migrated script SHALL ship, in the pull
    request that migrates it, with a `windows-latest` CI job that invokes it
    from a non-POSIX command interpreter (PowerShell or `cmd.exe`) and asserts
    its observable outcome; the job SHALL pass before the pull request merges.

18. **Parity proof (binding 7).** Before the first hook migrates,
    `docs/cli-matrix.md` SHALL carry a row, backed by empirical reproduction on
    Windows, that records for each of the four CLIs which command interpreter
    parses a hook command line and how it treats quoting, environment-variable
    expansion (`$CLAUDE_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}` and their
    equivalents) and path separators. A CLI that cannot run hooks on Windows
    SHALL be recorded as a parity gap with evidence per
    `docs/cli-matrix-maintenance.md`, never omitted.

19. **Multi-CLI parity.** Every migrated component SHALL keep working on Claude
    Code, Gemini CLI, GitHub Copilot CLI and Antigravity CLI on Windows, macOS
    and Linux; any (CLI × operating system) cell where it cannot SHALL be
    recorded as a parity gap with concrete evidence in `docs/cli-matrix.md` in
    the same pull request.

20. **Cross-cutting — OS service management.** The per-user background services
    CrewRig manages today through macOS LaunchAgents (`config/launchd/`) and
    Linux user units (`config/systemd/`) SHALL gain a Windows equivalent that
    offers the same lifecycle operations (install, start, stop, status,
    uninstall) and the same per-user scope, without requiring administrator
    elevation. When the Windows mechanism is unavailable, the operation SHALL
    exit non-zero with a diagnostic naming the missing capability, and SHALL
    leave no partially registered service behind.

21. **Cross-cutting — Symbolic links.** Every place that creates a symbolic
    link SHALL attempt the link and, when the operating system refuses it
    (Windows without Developer Mode or elevation), SHALL fall back to a copy,
    SHALL report the fallback to the user, and SHALL refresh the copy on every
    later run of the same operation so that it cannot silently go stale.

22. **Cross-cutting — Paths, line endings and case.** Migrated scripts SHALL
    build every path with platform-aware path handling and SHALL accept input
    files with either LF or CRLF line endings. Every generated file that is
    committed to the repository SHALL be byte-identical whichever operating
    system generated it, with LF line endings. No migrated script SHALL depend
    on two paths that differ only by letter case.

23. **Cross-cutting — External POSIX tools.** A migrated script SHALL NOT spawn
    `jq`, `yq`, `awk`, `sed`, `grep`, `mktemp`, `curl`, `ln` or any other
    POSIX-only utility. Spawning Git, the forge CLIs (`gh`, `glab`, `tea`), the
    four supported CLIs, the Python toolchain for the `mempalace` exception,
    and the host operating system's service manager is permitted. JSON handling
    SHALL use the Node.js standard library; the YAML library, where one is
    needed, SHALL be chosen by the first sub-spec that needs it and reused by
    every later one.

24. **Decomposition and termination.** This ticket SHALL be delivered through
    sub-specs, each a separate ticket with its own spec file, spec-PR and
    implementation PR, and each citing this spec as its parent. Normative
    changes to this parent SHALL chain via delta-specs of `0215`. The proposed
    decomposition below SHALL be confirmed or amended by the `architect`-led
    decomposition on the parent ticket before any `developer` is spawned; an
    amendment that reorders the strangler steps of requirement 8 or drops a
    cross-cutting concern SHALL require a delta of this spec.

    | # | Proposed sub-spec | Covers | Depends on |
    |---|---|---|---|
    | A | Foundations | Ratchet and allowlist (R10–R12); TypeScript conventions, type-check and erasable-syntax check (R2); Node floor check (R4); `windows-latest` CI scaffolding and timing harness (R15, R17); shared path, line-ending and temporary-file handling (R22) | — |
    | B | Windows hook command lines | Measured `docs/cli-matrix.md` row for the four CLIs (R18) | A |
    | C | Hooks | `usage-capture`, `worktree-git-guard`, `mempalace-transcript`, `antigravity-statusline-shim`; hook JSON rewiring and installed-hook rewrite; per-hook budgets (R15) | A, B |
    | D | OS service management | Windows equivalent of LaunchAgents and user units (R20) | A |
    | E | Symbolic links | Link-or-copy fallback (R21) | A |
    | F | Setup, install, manage and import | The 18 `scripts/{setup,install,manage,import}-*.sh` entry points and their helpers | C, D, E |
    | G | Build | `scripts/build-*.sh` and their helpers; byte-identical outputs (R22) | F |
    | H | Skill- and extension-bundled scripts | `artifacts/**/skills/*/scripts/`, `extensions/`, `extension-skeleton/`; YAML library reuse (R23) | G |
    | I | CI checks | `scripts/check-*.sh` and the remaining non-`mempalace` Python (R16) | H |
    | J | Tests and final removal | The Bash test suites under `scripts/tests/` and `tests/`, retirement of shell-specific conventions, `Taskfile.yml`, empty allowlist | I |

25. **Decomposition and termination.** The parent ticket SHALL terminate only
    when all of the following hold on `main`: the ratchet allowlist is empty;
    no tracked shell script exists; no hook file, `Taskfile.yml` task, workflow
    step, documentation page or skill instruction invokes a shell script; every
    sub-spec carries `status: implemented`; and every migrated user-facing
    entry point has a green `windows-latest` job.

## Scenarios

**Scenario:** Windows user installs CrewRig without a POSIX layer

Given a Windows machine with Git, Node.js 24 LTS, Python and Claude Code
installed, and neither Git Bash on the `PATH` nor WSL enabled
When the user clones the repository and runs the Claude Code setup entry point
from PowerShell after step (b) of the strangler order has shipped
Then setup completes with exit code zero, deploys the rules, skills and agents,
wires every hook as a `node "…/<hook>.ts"` command line, and a new Claude Code
session runs those hooks without error.

**Scenario:** Migrated hook stays within its latency budget

Given the `usage-capture` hook migrated with a budget set by sub-spec C
When its `windows-latest` CI job runs the hook the stated number of times with
nothing to capture
Then the timing assertion passes, and only the entry module's guard runs
before the process exits.

**Scenario:** A hook regression breaks its budget

Given a pull request that makes a migrated hook load its full module graph
before its guard runs
When the hook's `windows-latest` CI job runs the timing assertion
Then the job fails, naming the hook, its budget and the measured time, and the
pull request cannot merge.

**Scenario:** A new shell script is rejected by the ratchet

Given the ratchet check is active on `main`
When a pull request adds `scripts/check-new-thing.sh`, or adds an entry to the
allowlist
Then the ratchet check fails, naming the offending file or entry.

**Scenario:** A new non-TypeScript source file is rejected

Given the ratchet check is active on `main`
When a pull request adds a Python file that does not import `mempalace`, or a
new `*.mjs` helper script that is neither the Node.js floor guard nor a
tool-mandated configuration file
Then the ratchet check fails, naming the file and the permitted languages of
requirement 16.

**Scenario:** A script and its Bash test migrate together

Given a pull request that replaces `scripts/foo.sh` with `scripts/foo.ts` and
also rewrites `scripts/tests/test-foo.sh`
When the pull request is reviewed
Then the reviewer rejects it as a violation of the oracle rule, and the test
rewrite is split into a later pull request.

**Scenario:** Unsupported Node.js version

Given a machine where `node --version` reports Node.js 20, which cannot execute
TypeScript
When the user runs any migrated setup entry point
Then the floor check still runs, the entry point exits non-zero with a
diagnostic naming version 20, the required floor 24 and where to obtain a
supported release, no module-loading or syntax error is shown instead, and no
file is modified.

**Scenario:** Symbolic link refused on Windows

Given a Windows account without Developer Mode or elevation
When setup reaches a step that creates a symbolic link
Then it copies the target instead, tells the user the copy fallback was used,
and a later setup run refreshes the copy.

**Scenario:** Windows service mechanism unavailable

Given a Windows machine where the chosen per-user service mechanism cannot be
used
When the user asks CrewRig to install the MemPalace MCP HTTP daemon as a
service
Then the operation exits non-zero with a diagnostic naming the missing
capability and leaves no partially registered service.

**Scenario:** Build output is platform-independent

Given the build step has migrated
When the same commit is built on Windows, macOS and Linux
Then every generated, committed file is byte-identical across the three runs.

## Out of scope

- Publishing CrewRig on npm, or any distribution channel other than the
  repository checkout (a later, separate decision).
- A self-contained binary per operating system (Bun, Deno or Node single
  executable application) and the associated code signing and notarization.
- A mandatory conversion of the existing JavaScript (the usage subsystem under
  `scripts/lib/usage-*`, `scripts/lib/spec-linter.js` and similar) to
  TypeScript: it already runs on Node.js and does not block the "no shell"
  end state; requirement 16 lets a change type it in place and forbids it to
  grow.
- Replacing MemPalace, or rewriting the four `mempalace`-importing Python
  files.
- Inline commands in GitHub Actions workflow `run:` steps that the runner's
  default shell interprets; only their invocations of tracked shell scripts are
  in scope (requirement 9).
- The shell content that skills teach users to write for their own projects
  (for example the `github-actions` and `gitlab-ci` skills' guidance); only
  scripts CrewRig itself executes are in scope.
- Supporting Windows through WSL or Git Bash as an alternative path once the
  relevant step has shipped; they are neither required nor forbidden.
- Node.js version management on the user's machine (nvm-windows, fnm, Volta);
  CrewRig checks the floor (requirement 4) but does not install Node.js.
- The implementation of any individual script, the concrete latency budget
  values, the Windows service mechanism and the YAML library — each belongs to
  the sub-spec named in requirement 24.

## Open questions
