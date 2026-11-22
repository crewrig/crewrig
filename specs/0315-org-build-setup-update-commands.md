---
id: "0315"
slug: org-build-setup-update-commands
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2114
version: 1.0.0
---

# The `build`, `setup` and `update` commands of the organization config repository (WP4 of epic 1822)

## Intent

An organization author, and every user who clones the organization config repository, can run `node crewrig build`, `node crewrig setup` and `node crewrig update` there and get a working CrewRig installation that combines the pinned framework version with the organization's own skills, agents, teams, roles, levels, identity and rules, without ever cloning the framework. `build` compiles the organization's components and shows the author what would be installed, `setup` installs the framework and the organization content for one CLI from the directory it is run in, and `update` brings the repository up to date, fetches whatever version the repository now pins and installs it, in one command. Personal files (identity and profile) stay on the user's machine and out of the repository, the interview skills that create them work in the cloned repository, running `setup` leaves that clone exactly as it was so that the next `update` is never blocked, and the framework version runs correctly whatever `package.json` happens to sit above the user's cache directory. Each command ends with a code that tells a user at once whether the failure is the command's own or the launcher's, and this spec fixes the command surface, the codes and the archive content that the organization adopts, which are the public surfaces that WP4 completes (spec 0288 R12).

## Requirements

Parent specs: `specs/0288-distribution-model.md` and `specs/0314-org-template-launcher-pin-init.md` (with its delta-01 and delta-02). This spec adds to them and changes none of their requirements: wherever it is silent, 0314 R1 to R11 govern the launcher and 0288 R2 to R9 and R27 apply unchanged. It supplies what 0314 R10, R17, R18 and the *Out of scope* list of 0314 leave to WP4. Pointers read at `origin/release/1822-distribution @ 914caad2` on 2026-11-22. This spec, like every WP4 pull request, lands on `release/1822-distribution` only (0288 R16, R18).

Shared definitions. The **organization directory** is the directory that holds `crewrig.config.toml`; it is the working directory of the command unless `--org-dir` names another. The **version root** is the verified directory of the pinned version under `~/.crewrig/versions/`, the root of the archive. An **organization file** is a path of the organization directory that 0314 R15 creates or that R7 and R8 below name; **framework data** is every other file a command reads, and it comes from the version root only.

1. **R1 (commands).** The framework entry point SHALL serve the commands `build`, `setup` and `update`, in addition to `init` (0314 R5), and SHALL keep refusing any other command, and an invocation with no command, with exit code 2 and its own message that lists the commands. The launcher SHALL NOT change: it forwards these commands like any other (0314 R5).
2. **R2 (options).** The three commands SHALL accept `--org-dir <path>`, at most once, naming the organization directory (a relative path read from the working directory); without it the working directory is the organization directory. `setup` and `update` SHALL accept `--cli <name>`, with `<name>` one of `claude`, `gemini`, `copilot`, `antigravity`, and `--answer <id>=<value>`, repeatable, with the meaning that spec 0256 gives it for the per-CLI setups. `build` SHALL accept no other option. An unknown option, a missing option value, a repeated `--org-dir` or `--cli`, a `--cli` value outside the list, an absent `--cli` on `setup` or `update` (the message lists the four values), and `--link` (a version directory is a cache, so a link into it is refused; the copy is the only mode) SHALL exit with code 2 and write nothing.
3. **R3 (exit codes).** Each of the three commands SHALL exit with exactly one of: `0` success; `1` any failure other than a usage error; `2` a usage error (R1, R2). No code from 10 to 14 SHALL ever come from these commands, whatever a child process, a tool or a library ends with, so that a code in that range always identifies the launcher (0314 R10). Every failure SHALL print one message that names the file, path or step at fault, and SHALL NOT print a credential, a signed query string or a stack trace.
4. **R4 (organization directory check).** Before reading anything else, each command SHALL check that the organization directory exists, that it holds `crewrig.config.toml`, and that the file is valid TOML with the two string keys of 0314 R16. Otherwise it SHALL exit with code 1 naming the directory or the file and the defect, and write nothing. A directory that is not a git work tree SHALL be accepted by `build` and `setup`.
5. **R5 (`build`).** `build` SHALL compile the components under `artifacts/org/skills/` and `artifacts/org/agents/` of the organization directory for the four CLIs, with the framework data it needs read from the version root, and SHALL write its output beneath `dist/` of the organization directory, a preview for the author that no other command reads: nothing under the version root, under `~/.crewrig/versions/`, or elsewhere in the organization directory (the `.gitignore` of R7 excepted). The same compile is the one `setup` runs (R6), so that what `build` shows is what `setup` installs. When both homes hold nothing but `.gitkeep`, `build` SHALL exit 0 and say that the organization defines no component; it SHALL NOT create a failure for an empty organization. The `.gitignore` of R7 SHALL be ensured before the compile starts and SHALL stay as written when the compile fails. A component that fails validation SHALL exit with code 1 naming the source file, and SHALL leave the `dist/` of the previous successful `build` unchanged. `build` SHALL be repeatable: two runs on unchanged sources leave identical output. The directory `artifacts/community/hooks/` is not read in this version (R6): when it holds anything other than `.gitkeep`, `build` SHALL print one notice saying that organization hooks are not installed by this version, and the exit code SHALL be unaffected.
6. **R6 (`setup`).** `setup --cli <name>` SHALL install the framework and the organization content for that CLI into the user's home and the CLI's configuration, with the result that spec 0256 specifies for a checkout, except that the repository it reads from is the pair of the organization directory and the version root: the choices it offers (teams, roles, levels), the organization identity, rules and tools, the organization's skills and agents (the compile of R5, which `setup` runs itself into a temporary directory outside the organization directory and removes when it ends, whatever its outcome, so that no `build` run is required beforehand and the organization directory is untouched) come from the organization directory, and the rules, system context, compiled framework skills and agents, hook scripts, CLI settings templates and memory-server service files come from the version root. The directory `artifacts/community/hooks/`, which 0314 R15 reserves, SHALL be neither read nor installed in this version: the hooks that `setup` wires are those of the framework, from the version root (the owner decides in a later spec whether organization hooks join, and with which format); when it holds anything other than `.gitkeep`, `setup` SHALL print the same notice as `build` and go on. An organization file that the framework requires and that is absent (`config/ORGANIZATION.md`, `config/TOOLS.md`) SHALL end `setup` with code 1 naming it, before anything is installed. The files `config/SOUL.md` and `config/PROFILE.md` SHALL be read from the organization directory when present, and their absence SHALL NOT fail `setup`. The hook commands that `setup` writes SHALL name the scripts of the version root of the running version, so that a later `setup` from another pinned version rewires them. `setup` SHALL be idempotent: a second run with the same answers changes nothing.
7. **R7 (personal layers).** `build` SHALL ensure that the `.gitignore` of the organization directory holds the lines `config/SOUL.md`, `config/PROFILE.md` and `dist/`, one per line: an absent file is created with those lines; a present file keeps every existing byte and gains the missing lines at its end, each on its own line, preceded by a line feed when the file does not end with one; a present line is never duplicated, reordered or removed, and a line counts as present when it equals the path or the path with a leading `/`, trailing spaces ignored. `build` is therefore the one command that writes a `.gitignore`, an act of the organization author, whose commit reaches every clone; it does so before compiling, so that a failed compile still leaves the lines in place. `setup` SHALL NOT create or modify any `.gitignore`: it SHALL read the file of the organization directory and, when the file is absent or lacks `config/SOUL.md` or `config/PROFILE.md`, print one warning that names each missing line and says that `build` adds it, then continue; the warning SHALL NOT change the exit code. This is the `.gitignore` that 0314 R17 defers to WP4: `init` stays as 0314 R15 and R17 fix it and creates no `.gitignore`, and no delta of 0314 is needed. Neither command SHALL create `config/SOUL.md` or `config/PROFILE.md`.
8. **R8 (identity and profile commands).** `setup` SHALL NOT write any template anywhere: not into the organization directory, and not into a user-level location. The commands `init-soul` and `init-personal-profile`, run with the organization directory as working directory, SHALL read `config/SOUL.md.template` and `config/PROFILE.md.template` from the organization directory when the file exists there (an organization may commit its own edited template), and otherwise read-only from the version root, `~/.crewrig/versions/<version>/config/SOUL.md.template` and `~/.crewrig/versions/<version>/config/PROFILE.md.template`, where `<version>` is the `version` member of the `crewrig.pin.json` of that organization directory (the version root carries both files, R10). When the pin file cannot supply a version, or that version is not cached, or the cached version lacks the file, a command SHALL stop with one message that tells the user to run `node crewrig setup --cli <name>` (which fetches the pinned version) and SHALL write nothing, in particular not the personal file from nothing. The commands read the pin member `version` only, with no environment variable. The commands SHALL write `config/SOUL.md` and `config/PROFILE.md` in the organization directory, where git ignores them once the `.gitignore` of R7 is in the repository. The two commands need the scripts of the `init-team` skill (the scaffold and the lint script) and stop without them, so `setup` SHALL install the `init-team` skill together with both commands for every CLI of R2 that supports them, and their instructions SHALL describe the lookup order of this requirement.
9. **R9 (`update`).** `update` SHALL, in this order: (a) require the organization directory to be a git work tree whose current branch has an upstream, and a `crewrig` launcher file at its root, otherwise exit 1 naming what is missing and change nothing; (b) update the checkout with a fast-forward-only pull, git being run directly and not through a shell, and never with a merge, a rebase, a reset, a stash or a clean, so that, on a clone where `setup` has run and nothing else was changed, the pull has no local change to conflict with, and a diverged branch, a conflict with local changes, an unreachable remote or any other pull failure ends with code 1, the message names the failure, and no step after it runs (the message states that `setup` alone still installs the version already pinned); (c) run the launcher file of the organization directory, with the current Node.js executable and the organization directory as working directory, passing `setup` and the `--cli` and `--answer` options it received, so that the pin file as the pull left it decides the version, fetched and verified by the launcher (0314 R7 to R9) or reused from the cache with no network; (d) exit 0 when that run exits 0. A pull that finds nothing new SHALL still run step (c). When the run of (c) ends with any code other than 0, `update` SHALL exit with code 1; when that code is from 10 to 14 the message SHALL state it as the launcher's own code with its meaning from 0314 R10, and SHALL name `crewrig.pin.json` for 11, so that the launcher's diagnosis reaches the user and the code range stays the launcher's (R3). `update` SHALL NOT modify `crewrig.pin.json`: the pin changes only through a reviewed commit that the pull brings (0288 R4).
10. **R10 (archive content).** The archive SHALL contain, in addition to what 0314 R18 lists, everything the three commands read from the version root: `config/SOUL.md.template`, `config/PROFILE.md.template`, the directories `config/claude`, `config/gemini` and `config/copilot` (the settings templates), the memory-server service files (`config/launchd`, `config/systemd`, `config/windows`), and every module that `build`, `setup` and `update` load at run time. The framework's own `config/ORGANIZATION.md`, `config/TOOLS.md` and organization-owned directories SHALL stay out of the archive (0314 R18 unchanged). A test SHALL run each of the three commands, and a hook script, from an archive built from the manifest alone, and fail on any missing file.
11. **R11 (module type, issue 2105).** The archive SHALL contain, at its root, a file `package.json` that is one JSON object with exactly one member, `type`, whose value is `module`, and that is not a copy of the repository's own `package.json`. With any ancestor `package.json` of the version directory (in the user's home, `~/.crewrig` or `~/.crewrig/versions`) declaring `"type": "commonjs"`, declaring `"type": "module"`, declaring no `type`, or absent, the entry point (every command of R1), and every hook script that `setup` wires, run from the version directory SHALL behave identically: same exit code, no module-type error, and no module-type warning on standard error. This completes 0314 R18 for the archive root and leaves 0314 R6 and R12 as they are (R12 bans a `package.json` from the template repository only).
12. **R12 (no other write, no launcher change).** `setup` and `update` SHALL write nothing in the organization directory, whether tracked or not, so that `git status` of the clone is the same before and after them; `build` SHALL write there only `dist/` (R5) and the `.gitignore` (R7). No command SHALL modify `crewrig.pin.json` or `crewrig.config.toml`, and none SHALL delete or alter a cached version under `~/.crewrig/versions/`. `setup` MAY write the user-level locations that the per-CLI setups of spec 0256 write today and the temporary directory of R6, which it removes. The three commands SHALL read no CrewRig-specific environment variable other than `CREWRIG_RELEASE_BASE_URL`, which only the launcher reads, including in the run that `update` starts; the runtime's resolution of the home directory (`HOME`, `USERPROFILE`, 0314 R11), the lookup of `git` and `node` on `PATH`, and the temporary-directory resolution of the runtime are not CrewRig-specific variables and fall outside this rule.
13. **R13 (ADR rows and surfaces).** The implementation PR SHALL complete in place, with exactly these items and one dated line appended to the change log, the rows of the *Public surfaces* table of `docs/adr/0022-distribution-model.md` that read "WP4 part pending", and add no section (the spec-PR edits no ADR):
    - surface 2, commands: `build`, `setup` and `update` with `--org-dir`, `--cli` and `--answer` and the refusals of R2 (replacing "further commands: WP4 spec, pending");
    - surface 2, exit codes: `0`, `1` and `2` of the three commands, and the rule that `update` maps a launcher code from 10 to 14 to `1` (R3, R9) (replacing "codes of further commands: WP4 spec, pending");
    - surface 2, environment variables: the statement that the three commands add none (R12), replacing "any further variable: WP4 spec, pending";
    - surface 4, organization directories: `config/SOUL.md` and `config/PROFILE.md` (personal, ignored, written by the user's skills), `config/SOUL.md.template` and `config/PROFILE.md.template` (optional, organization-owned, read first by the commands of R8), `.gitignore` with the three lines that `build` ensures (R7), and `dist/` as the ignored output of `build`, and the statement that `artifacts/community/hooks/` is reserved and not read in v1 (R6), replacing "any further path the framework reads from them: WP4 spec, pending";
    - nothing for the archive layout, the module that each command loads, the compiled output's content, or the archive `package.json` (R11): they stay internal (0288 R12).
14. **R14 (end-to-end tests, 0288 R27).** Tests SHALL cover, on Linux and `windows-latest`, with no network beyond a local server and a local git repository as the upstream, run in a copy of the template whose pin names a locally built archive: `build` on an empty organization and on one with a skill and an agent, and on a defective component (code 1, previous `dist/` unchanged, the `.gitignore` lines present); `build` and `setup` on an organization whose `artifacts/community/hooks/` holds a file (the notice, the file not installed or wired, exit code unaffected); `setup` leaving no temporary directory behind, on success and on a compile failure; `setup` for each CLI, run twice (idempotent), with an absent `config/ORGANIZATION.md` (code 1, nothing installed), with `--link`, with no `--cli`, and with an unknown option (code 2 each, nothing written); `setup` on a clone that is a git work tree, checked with `git status --porcelain` (empty before and after, a `.gitignore` byte-identical), with an absent `.gitignore`, with one lacking only `config/PROFILE.md`, and with a complete one (a warning naming the missing lines, none for the complete file, exit code 0 in each); R7 for `build` on an absent, a complete and a partial `.gitignore` (existing bytes kept, no duplicate, a file with no final line feed, the `/`-prefixed form accepted); the template lookup of R8 with a template committed in the organization directory (it wins), with none there (read-only from the version root of the pinned version, which a check shows unchanged, including after an `update` moved the pin), two clones pinned to different versions each reading their own, and with the pinned version not cached (one message naming `node crewrig setup --cli <name>`, nothing written), with an absent or invalid `crewrig.pin.json` (the same stop), and with a `setup` that left no template anywhere outside the version root; the commands `init-soul` and `init-personal-profile`, installed with `init-team` by `setup` for each CLI, writing their file in the organization directory and git ignoring it after `build`; `update` on a clone where `setup` already ran, with a clean tree before the pull, after a commit that moves the pin to a second local archive (the new version is fetched and the hooks are rewired to it) and one that changes the `.gitignore`, with nothing new to pull, with a diverged branch, with no upstream, with an unreachable remote, with no `crewrig` file, and with a pull that brings a defective pin (code 1, message naming `crewrig.pin.json` and the launcher's code 11) and one that brings a digest the archive does not match (code 1, launcher code 13 named); a check across all of them that no exit code from 10 to 14 occurs; the hostile-`package.json` matrix of R11 for the entry point and one hook; and the closure test of R10.

## Scenarios

### Happy path

**Scenario:** setup installs the organization content from the cloned repository

```text
Given a clone of an organization config repository whose pin names a cached framework version, with one organization skill and a config/ORGANIZATION.md
When  the user runs `node crewrig setup --cli claude`
Then  the organization's teams, roles and levels are offered, the organization skill and the framework content are installed for Claude Code, the hooks name the scripts of the pinned version, no template was written anywhere and no temporary directory remains, the organization directory is unchanged (`git status` is empty), config/SOUL.md and config/PROFILE.md do not exist, and the exit code is 0.
```

**Scenario:** update picks up a new pin and installs it

```text
Given a clone whose upstream holds a commit that changes crewrig.pin.json to a version that is not cached yet, and a local server serving its archive
When  the user runs `node crewrig update --cli claude`
Then  the checkout is fast-forwarded, the launcher fetches and verifies the new version, `setup` runs from it and rewires the hooks to its directory, and the exit code is 0.
```

**Scenario:** the personal files stay out of the repository

```text
Given a repository whose committed .gitignore holds the lines that `build` ensures, on which `setup` has run, and a user who then runs the init-soul and init-personal-profile commands with the repository as working directory
When  the user runs `git status`
Then  config/SOUL.md and config/PROFILE.md exist, were written from the organization's own committed templates when it has them, and otherwise from the version root of the pinned version, and are not listed.
```

**Scenario:** build makes the personal files ignored

```text
Given an organization directory with a .gitignore that holds only node_modules
When  the author runs `node crewrig build`
Then  the file keeps node_modules and gains config/SOUL.md, config/PROFILE.md and dist/, each on its own line, and a second run changes nothing.
```

**Scenario:** update on a clone where setup already ran

```text
Given a clone where `setup` has run, whose `git status` is empty, and an upstream commit that changes .gitignore and moves the pin
When  the user runs `node crewrig update --cli claude`
Then  the fast-forward pull succeeds with no local change in its way, the new version is fetched, `setup` runs from it, and the exit code is 0.
```

**Scenario:** a hostile ancestor package.json does not break the framework

```text
Given a package.json declaring "type": "commonjs" in the user's home directory and the version directory under ~/.crewrig/versions/
When  the user runs `node crewrig build` and a wired hook runs
Then  both behave as with no such file: the same exit code, no module-type error and no warning on standard error, because the archive root holds a package.json with {"type":"module"}.
```

**Scenario:** build on an empty organization

```text
Given an organization directory whose artifacts/org/skills and artifacts/org/agents hold only .gitkeep
When  the author runs `node crewrig build`
Then  the exit code is 0, a message says that no organization component exists, and the .gitignore holds the three lines of R7.
```

### Failure path

**Scenario:** update stops when the pull fails

```text
Given a clone whose branch has diverged from its upstream
When  the user runs `node crewrig update --cli claude`
Then  the exit code is 1, the message names the failed pull and says that `setup` alone installs the pinned version already present, no setup ran, and no file was merged, reset or stashed.
```

**Scenario:** a launcher refusal inside update never surfaces as a launcher code

```text
Given a clone whose upstream commit moves the pin to a version whose archive does not match the pinned digest
When  the user runs `node crewrig update --cli claude`
Then  the launcher's run ends with code 13, `update` exits with code 1, and its message says that the launcher ended with code 13, a digest mismatch, so that no code from 10 to 14 comes from `update` itself.
```

**Scenario:** a failed build still ensures the ignore lines

```text
Given an organization directory without a .gitignore and a skill that fails validation
When  the author runs `node crewrig build`
Then  the exit code is 1 naming the source file, the .gitignore holds config/SOUL.md, config/PROFILE.md and dist/, and no dist/ is created.
```

**Scenario:** organization hooks are reserved, not installed

```text
Given an organization directory whose artifacts/community/hooks holds a script
When  the user runs `node crewrig setup --cli claude`
Then  one notice says that organization hooks are not installed by this version, the framework hooks are wired, the script is not, and the exit code is 0.
```

**Scenario:** setup warns about a missing ignore line and goes on

```text
Given a clone whose .gitignore lacks config/PROFILE.md
When  the user runs `node crewrig setup --cli claude`
Then  one warning names config/PROFILE.md and says that `build` adds it, the installation completes, the .gitignore is byte-identical, and the exit code is 0.
```

**Scenario:** setup refuses a link and a missing CLI

```text
Given a clone with a cached pinned version
When  the user runs `node crewrig setup --link --cli claude`, and then `node crewrig setup`
Then  each run exits with code 2 with a message (the second one listing claude, gemini, copilot and antigravity), and nothing is installed or written.
```

**Scenario:** the directory is not an organization directory

```text
Given a directory without crewrig.config.toml
When  the user runs `node crewrig setup --cli claude --org-dir <that directory>`
Then  the exit code is 1, the message names crewrig.config.toml, and nothing is written.
```

**Scenario:** the archive misses a file a command reads

```text
Given an archive built from the manifest alone
When  the closure test runs build, setup and update, and one hook, from it
Then  each of them completes, and the test fails naming the file when any is absent from the archive.
```

## Out of scope

- A bump of the template pin to a prerelease that carries `init` and these commands (0314 R13): a pull request of its own, before the 0288 R28 acceptance run.
- Issue 2110 (the path-ownership exemption), the transfer of the GitHub App `5864293` to the organization and the Write-role probes: separate items of epic 1822 sequenced before the first stable release.
- The fetch step that retrieves the organization configuration from a remote location, the standalone binary and the one-command setup for non-technical users (WP8): `setup` reads a directory only.
- Installing the hooks of an organization from `artifacts/community/hooks/`: the format of an organization hook and how it is wired are undefined in the framework today, so v1 only reserves the directory (R6) and a later spec decides (follow-up issue #2116: organization hook format and per-CLI wiring, not blocking the final merge of epic 1822).
- Overlay path declarations and any `crewrig.config.toml` key beyond the two of 0314 R16.
- Any option of the existing scripts beyond R2 (`--link`, `--target`, `--tier`, `--check`, `--diagnostics`), setting up several CLIs in one run, uninstalling, and a `doctor` command.
- Organization files at the root of the repository that the framework repository holds (`mcp-servers.org.json`, `model-prices.org.json`, `AGENTS.org.md`): `setup` of this spec does not read them from the organization directory, and they are not public surfaces.
- Removing from git the tracking of a `config/SOUL.md` or `config/PROFILE.md` that an organization already committed: a `.gitignore` line does not untrack a tracked file.
- Pruning cached versions, signature verification and authenticated mirrors (0288 *Out of scope*).
- Editing `docs/adr/0022-distribution-model.md` in the spec-PR (R13 assigns it to the implementation PR), and any change on `main` before the final merge (0288 R16, R29, R30).

## Open questions

Resolved by the owner on 2026-11-22; recorded here with the alternatives rejected.

- `--cli` required on `setup` and `update` (R2): kept. Rejected: defaulting to all four CLIs in one run, which asks every question four times.
- `update` stops at a failed pull (R9): kept, with a message saying that `setup` installs the already pinned version offline. Rejected: warning and running `setup` on a stale checkout.
- The `.gitignore` is written by `build` only, and `setup` only warns (R7): `setup` runs in every user's clone, and rewriting a tracked file there leaves dirty clones and can make the fast-forward pull of `update` fail when upstream later changes it. Rejected: `setup` writing it; `init` writing it, which needs a delta of 0314 R15 and R17.
- No template is copied anywhere (R8): the commands read an organization's own committed template first, then the version root of the version that `crewrig.pin.json` names, read-only. Rejected: copying into `config/`, whose untracked files make the next pull fail; a user-level copy under `~/.crewrig/`, which duplicates state, adds a path nothing prunes, and mixes versions across clones; an environment variable naming the version root, a new public surface to document. The pin identifies the version, so no search of `~/.crewrig/versions/` is needed.
- [PLAN:] `scripts/lib/framework-release/manifest.txt` ships only git-tracked files under their repository paths, but R11 needs an archive-root `package.json` that is not the repository's own `package.json` (which declares workspaces and no `type`). The spec fixes the content and leaves the mechanism to the plan, which must settle how the manifest and the archive builder carry a file whose archive path and content differ from the tracked one, and the WP2 release guards (0288 R31) must accept it.
- [PLAN:] `scripts/setup-claude-interactive.ts` and its three siblings, `scripts/build-components.ts`, and the hook scripts `hooks/usage-capture.ts` (lines 33 to 37) and `hooks/antigravity-statusline-shim.ts` (lines 31 to 35), which call `require(...)`, are written in a deliberate CommonJS form (`__filename`, no top-level `import`) to avoid the module-type warning (specs 0250 R3, 0255 R3). Under the archive-root `"type": "module"` of R11 they load as ES modules and `__filename` is undefined. The commands of this spec must be served by entry code that works under that module type, so the plan must replace that form for the archive entries and for those two hooks without breaking the checkout flow that the same files serve.
- [PLAN:] The instructions of the commands `init-soul` and `init-personal-profile` (`artifacts/core/commands/`, provenance version `1.1.0`) change (R8), so each bumps its `metadata.provenance.version` in the implementation PR, and the `init-team` skill does too if its text changes.
- Organization hooks (R6): resolved by the owner, deferred and tracked in #2116. The directory `artifacts/community/hooks/` has no component format, compile or wiring in the framework today, so this spec reserves it and prints a notice when it is not empty. Rejected: inventing a hook format inside a command spec.
- Accepted limit: `build` writes `dist/` into the organization directory even though only the author reads it.
