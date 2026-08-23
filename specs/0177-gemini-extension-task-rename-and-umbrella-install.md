---
id: "0177"
slug: gemini-extension-task-rename-and-umbrella-install
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1002
version: 1.0.0
---

# Spec 0177: Gemini Extension Task Rename and Cross-CLI Umbrella Install

## Intent

Rename the Gemini-only extension management tasks in `Taskfile.yml` to
explicitly name their target CLI (`install-gemini-extension`,
`install-gemini-extensions`, `link-gemini-extensions`,
`unlink-gemini-extensions`), provide backwards-compatible alias wrappers
with visible deprecation notices for legacy task invocations, add a
cross-CLI umbrella install entry point (`install-extension-all` /
`scripts/install-extension-all.sh`) that installs a given extension across
all supported and present CLIs while reporting explicit per-target outcomes,
and correct misleading documentation and matrix entries regarding Gemini
extension installation.

## Requirements

1. **(Explicit Gemini Task Names)** The Gemini-specific extension tasks in
   `Taskfile.yml` SHALL be named `install-gemini-extension`,
   `install-gemini-extensions`, `link-gemini-extensions`, and
   `unlink-gemini-extensions`.
2. **(Legacy Task Aliases and Deprecation Notice)** The legacy task names
   `install-extension`, `install-extensions`, `link-extensions`, and
   `unlink-extensions` SHALL remain executable and SHALL emit a visible
   deprecation warning to stderr or stdout naming the replacement Gemini-specific
   task and the cross-CLI umbrella task before delegating to the target command.
3. **(Cross-CLI Umbrella Install Task and Script)** A unified task
   `install-extension-all` (taking `EXT=<name>`) SHALL be declared in
   `Taskfile.yml` delegating to a standalone driver script
   `scripts/install-extension-all.sh`.
4. **(Precondition Detection and Explicit Reporting)** The umbrella install
   driver SHALL inspect each supported CLI target (`gemini`, `claude`, `copilot`,
   `antigravity`), execute the appropriate per-CLI installer for present
   runtimes, and print an explicit status line for each target (`INSTALLED`,
   `SKIPPED`, or `FAILED`) accompanied by a reason when skipped.
5. **(No Silent Universal No-Op)** If no supported CLI targets are available or
   if every supported target is skipped, `scripts/install-extension-all.sh`
   SHALL exit with a non-zero status code.
6. **(Failure Aggregation)** If any present CLI installation fails, the umbrella
   driver SHALL continue attempting remaining present targets, collect the
   failure details, and exit with a non-zero status code upon completion.
7. **(CLI Matrix and Documentation Parity)** `docs/cli-matrix.md` row 14 SHALL
   accurately document Gemini's install script path (`scripts/install-extension.sh`
   or `scripts/install-gemini-extension.sh`), and remove the false gap claim;
   row 16 and `README.md` SHALL be updated with the new task names and umbrella
   entry point.
8. **(Hermetic Regression Testing)** An automated test suite
   `scripts/tests/test-install-extension-all.sh` SHALL verify task naming,
   deprecation warnings on legacy aliases, precondition checks, individual
   install invocations, and non-zero exit when all targets are skipped.

## Scenarios

**Scenario:** Explicit Gemini extension installation via new task name

Given an extension `hello-world` authored in the repository
When the user executes `task install-gemini-extension EXT=hello-world`
Then the extension is copied to `~/.gemini/extensions/hello-world/`
And no deprecation warning is emitted

**Scenario:** Legacy task invocation emits deprecation notice

Given an adopter executing the legacy task `task install-extension EXT=hello-world`
When the task runs
Then a deprecation warning is printed pointing to `install-gemini-extension` and `install-extension-all`
And the extension is installed into `~/.gemini/extensions/hello-world/`

**Scenario:** Cross-CLI umbrella install with multiple present CLIs

Given a system where `gemini` directory structure and `claude` CLI are present, while `copilot` and `agy` are absent
When the user executes `task install-extension-all EXT=hello-world`
Then Gemini and Claude installations are executed and reported as `INSTALLED`
And Copilot and Antigravity are reported as `SKIPPED` with missing CLI binary reasons
And the command exits with code 0

**Scenario:** Cross-CLI umbrella install when all targets are absent

Given a sandbox environment where no supported CLIs or prerequisites are present
When the user executes `task install-extension-all EXT=hello-world`
Then all four targets are reported as `SKIPPED` with explicit reasons
And the script exits with a non-zero status code

## Out of scope

- Changing the underlying behavior or implementation mechanics of individual CLI installation scripts (`install-claude-plugin.sh`, `install-copilot-plugin.sh`, `install-antigravity-extension.sh`, `install-extension.sh`).
- Modifying extension authoring or packaging formats tracked under issue #725.
- Removing legacy aliases in this release (deprecation notice only).

## Open questions

*(None — all scope and design decisions are settled by issue #1002).*
