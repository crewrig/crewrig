---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1874
version: 2.1.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 03 of `specs/0290-skill-eval-runner.md`, building on delta-01 and delta-02. Source: the owner's decision after the first maintainer smoke run (issue #1874): a contributor logged in to Claude Code must be able to run `task skill-evals` with no token and no API key. The smoke (2026-11-11, `claude` 2.1.322, logged-in subscription session) showed that a throwaway `CLAUDE_CONFIG_DIR`, with or without a throwaway `HOME`, makes `claude` answer `Not logged in`, so the throwaway configuration of R9 and R33 cannot coexist with the login; and that the real `HOME` with `--setting-sources project --strict-mcp-config` and the skill installed at project scope in the workspace loads no user settings, hooks, CLAUDE.md, MCP servers or user skills (the model reports no user instruction; a one-word reply cost 0.022 US dollars against 0.33 with the full user configuration). The version is a MINOR bump: every input accepted before stays accepted (the token and the API key keep their meaning and precedence), and the change adds a default credential source and moves where the skill is installed; no approved plan is in flight. Requirements modified: R9, R26, R32, R33. Requirements added: R40 to R44. The model pin of R31 changes through a setting, which R31 already allows, and is not a requirement change (see below). This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

40. **Isolation by flags, not by a throwaway home.** Every `claude` invocation the runner makes, the executor of every run and the headless judge driver of R15 alike, SHALL keep the contributor's real `HOME` and, when set, the contributor's `CLAUDE_CONFIG_DIR`, and SHALL pass `--setting-sources project --strict-mcp-config`, so that no user or local settings, hooks, CLAUDE.md, MCP servers or user-scope skills are loaded. `--bare` SHALL NOT be used: it never reads the OAuth login or the keychain. Both invocations SHALL keep `--no-session-persistence`, so that a run leaves no session transcript in the contributor's configuration directory. The flags are built in one place per invocation kind and covered by a test that asserts them on the recorded argv of a stub `claude`.
    Acceptance: the recorded argv of an executor run and of a judge call each contain `--setting-sources` followed by `project`, `--strict-mcp-config` and `--no-session-persistence`, and neither contains `--bare`; the recorded environment of each holds the contributor's `HOME`, not a temporary directory.

41. **Login precondition without a model call.** When neither `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` is set and mock mode is off, the runner SHALL decide whether the contributor is logged in before any model call, by running `claude auth status --json` (a local command that makes no model call; verified on `claude` 2.1.322) with the same environment as an executor run (requirement 42), stdin ignored and a timeout. It SHALL treat the contributor as logged in only when the command exits 0 and its output is a JSON object whose `loggedIn` is `true`. In every other case (exit non-zero, `loggedIn` false or absent, unparseable output, timeout) the runner SHALL make no model call, SHALL print a message telling the contributor to run `claude` and log in (or to set `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`), and SHALL exit 3, writing no results file. When `claude` cannot be started, the message SHALL say so with the install hint of R26 and the exit code SHALL be 3. The runner SHALL read only the `loggedIn` field and SHALL NOT print, log or write any other field of the output, which carries the account's e-mail address and organisation. The runner does not detect a login by the output of a first executor run: the command above exists, so no paid run is spent on detection. The probe runs once per invocation, in the credential check of R33, and the headless judge driver's own preflight uses the same function. A login that lapses during an invocation is not a precondition failure: the affected runs end as executor failures under R24.
    Acceptance: with a stub `claude` whose `auth status --json` exits 1 with `"loggedIn": false`, the runner exits 3 with the login message and the stub's model entry point is never reached; with `"loggedIn": true` and exit 0 the run proceeds; the printed output contains none of the stub's other fields.

42. **Environment of the `claude` child.** The environment given to an executor run and to the judge driver SHALL remain an allowlist, never the runner's whole environment. Its members are `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `CLAUDE_CONFIG_DIR` when the contributor set it, and `USER`, plus exactly ONE credential variable when requirement 33 selects one. `USER` is added because, on macOS, the login is held in the keychain and `claude auth status` reports not logged in when `USER` is absent (verified on `claude` 2.1.322: an environment of `PATH` and `HOME` only gave `loggedIn: false`; adding `USER` gave `loggedIn: true`; `LOGNAME`, `TMPDIR`, `SHELL` and the `XPC_*` variables did not change the result). No other variable of the runner's environment SHALL reach the child.
    Acceptance: the recorded environment of an executor run in session mode holds exactly the allowlist members that are set in the runner's environment and no credential variable; with a token set it additionally holds only `CLAUDE_CODE_OAUTH_TOKEN`; an unrelated variable set in the runner's environment is absent.

43. **The credential source is reported.** The runner's report SHALL name the credential source in use, one of `logged-in Claude Code session`, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`, without printing any secret value, so that a contributor who exports `ANTHROPIC_API_KEY` for other tools sees that the run is billed to that key and not to their subscription.
    Acceptance: a run with only `ANTHROPIC_API_KEY` set reports `ANTHROPIC_API_KEY` as its source and a run with neither variable reports the logged-in session; no report line contains a secret value.

44. **Documented residual risk and prerequisites.** `docs/skill-evals.md` and ADR 0023 SHALL state: (a) the prerequisite is Claude Code installed and logged in; `claude setup-token` and `ANTHROPIC_API_KEY` are optional overrides; (b) the residual risk, restated accurately: in session mode the credential is no longer in the agent's environment, so the agent's `Bash` cannot read it from there; where Claude Code keeps the login in a file under the real configuration directory instead of the keychain, that file is reachable by the agent's `Read` and `Bash`, and the residual is not reduced; on macOS the login is held in the keychain; with `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` the credential is in the child's environment and the previous residual stands unchanged; (c) the agent runs as the contributor with the real `HOME`, so its `Bash`, `Read`, `Write` and `Edit` can reach the contributor's configuration directory and can modify it; the previous throwaway `HOME` never confined the filesystem (an absolute path always reached it), it only removed the default pointer to it, and no tool-level deny rule is added because `Bash` would bypass it and the rule would be a false boundary; (d) `claude` may still update its own state files in the configuration directory (for example a credential refresh), as any invocation does, and several runs in flight share that directory; (e) the measured cost of an isolated run on Sonnet 5.5 (about 0.03 US dollars: 0.022 for a one-word reply, 0.028 for a skill-triggered run of five turns, 0.025 without the skill) is recorded as an input to the recalibration of issue #1852, and no cost default changes in this delta.
    Acceptance: the document and the ADR contain each of the five statements; a test asserts the document names the logged-in prerequisite and no longer lists `claude setup-token` as the preferred path.

## MODIFIED

**R9 (paired runs in fresh context), as modified by delta-01.** Original (delta-01 replacement): "the throwaway configuration SHALL touch no user or repository configuration and receives the credentials of requirement 33 through the environment only; the installed skill contents are those of requirement 32; the executor is Claude Code (R26)." Replacement: the run SHALL load no user or repository configuration, by the flags of requirement 40, with the contributor's real `HOME` and configuration directory; it receives the credential of requirement 33 (a session needs none) under the environment of requirement 42; the installed skill contents and location are those of requirement 32; the executor is Claude Code (R26). Each run still starts from an empty conversation that shares no state with any other run, and the `with_skill` and `without_skill` arms differ only by the presence of the installed skill.
    Acceptance: the Acceptance of requirements 40 and 42 hold, and two runs share no workspace.

**R26 (CLI matrix finding), as modified by delta-01.** Original sentence: "On the token path, the skill-evals runner needs the `claude` binary for both the executor of R9 and the judge, and the documentation of the runner SHALL record this." Replacement: the runner needs the `claude` binary for the executor of R9 and, except when `ANTHROPIC_API_KEY` alone is in use, for the judge, and the documentation of the runner SHALL record this. Every other sentence of delta-01 R26 (the executor is Claude Code only, the eval measures a skill on Claude Code, no row under `docs/cli-matrix/rows/`) is unchanged, and so is the CLI matrix: the runner is a repository development tool and deploys nothing to a CLI target.

**R32 (skill install contents), as modified by delta-01.** Original (delta-01 replacement): "For a `with_skill` run the runner SHALL install the skill into the agent under test by copying `SKILL.md` and the `scripts/`, `references/` and `assets/` directories of the skill when they exist, and SHALL NOT copy `evals/` or any other path, so the agent under test cannot read the expectations it is graded on." Replacement: for a `with_skill` run the runner SHALL install the skill at project scope, in the run's workspace, as `<workspace>/.claude/skills/<name>/`, copying `SKILL.md` and the `scripts/`, `references/` and `assets/` directories when they exist and nothing else (never `evals/` or any other path); the workspace SHALL be a temporary directory outside any repository, so that no repository rule is loaded; a `without_skill` run SHALL have no `<workspace>/.claude/skills` directory; the base replay of R19 SHALL install the merge-base skill in the same place and the same way. The top-level `.claude/` directory of the workspace is the install location, not an output of the run: it SHALL be excluded from the files collected into a run's `outputs/` and so from the produced files given to the judge and to the checks of R4.
    Acceptance: a `with_skill` run's workspace holds `.claude/skills/<name>/SKILL.md` and its scripts and no `evals/` path; a `without_skill` run's workspace has no `.claude/skills`; the run's `outputs/` holds no path under `.claude/`; the workspace lies outside the repository.

**R33 (local credentials), as modified by delta-01.** Original (delta-01 replacement): "Executor and judge SHALL use the credentials of the contributor's own Claude Code installation, read from the environment: `CLAUDE_CODE_OAUTH_TOKEN` ... SHALL be preferred and `ANTHROPIC_API_KEY` SHALL be accepted when it is absent. ... When neither variable is set and mock mode is off, the runner SHALL make no model call, SHALL print a message naming both variables and how to obtain the token, and SHALL exit 3." Replacement, in the order of the original: the credential source SHALL be chosen in this order: `CLAUDE_CODE_OAUTH_TOKEN` when set, else `ANTHROPIC_API_KEY` when set, else the contributor's logged-in Claude Code session, which needs no variable. The two variables are optional overrides, passed to the child through the environment as before. The judge SHALL follow the source: with `CLAUDE_CODE_OAUTH_TOKEN` or with the logged-in session, the judge's model calls are made by headless `claude -p` (the driver of R15, backend `claude-cli`), the token or the session being the same authentication as the executor; with `ANTHROPIC_API_KEY` alone the existing `anthropic` driver is used, as before. The driver's preflight is satisfied by a token in its environment or, without one, by the login probe of requirement 41. The runner SHALL NEVER send the subscription credential to the Messages API, that credential being the value of `CLAUDE_CODE_OAUTH_TOKEN` or the OAuth credential of the contributor's logged-in session: the refusal of a judge configuration that would do so (backend `claude-code` in either authentication mode, or any `api_key_env` naming `CLAUDE_CODE_OAUTH_TOKEN`, exit 3 with no model call, naming the backend or variable and the reason) is unchanged, as are the construction of the effective judge configuration by the runner in a directory of its own under the output directory and the permitted contributor override. Apart from the variables the existing judge configuration already reads, the runner SHALL read no other credential variable. The case "neither variable set and mock mode off" no longer exits 3 by itself: it is the logged-in session, whose absence is the precondition failure of requirement 41 (exit 3, no model call, message telling the contributor to run `claude` and log in).
    Acceptance: with neither variable set and a logged-in stub, the effective judge configuration selects `claude-cli` and the run proceeds; with only `ANTHROPIC_API_KEY` it selects `anthropic`; with a token it selects `claude-cli`; an override that would send the subscription credential to the Messages API is still refused with exit 3.

**Scenarios, restated.** The delta-01 scenario *missing credentials exit 3* is replaced by *a contributor who is not logged in exits 3* below. The delta-01 scenario *the runner builds the judge configuration* is replaced by *the judge follows the credential source* below. The delta-01 scenario *the token is never sent to the Messages API* keeps its text and gains the logged-in session as a second case (below). The delta-01 scenario *evals are not installed with the skill* keeps its text: its "installed directory" is now `<workspace>/.claude/skills/<name>/`. The base scenarios and every other scenario stand.

**Model pin (no requirement change).** R31 requires a Sonnet-class model through one declared, documented setting and leaves the model to ADR 0023. `EXECUTOR_MODEL` and `JUDGE_MODEL` in `scripts/lib/skill-evals/settings.ts` change from `claude-sonnet-4-6` to `claude-sonnet-5-5`, which `claude` 2.1.322 accepted in the smoke; ADR 0023 decision 2 and `docs/skill-evals.md` are updated in the implementation. Recorded results files keep the model they were produced with; the attestation compares content hashes only, so no existing results file becomes stale.

## REMOVED

None. The throwaway `HOME` and `CLAUDE_CONFIG_DIR` of the executor and of the judge driver are removed through the modifications of R9 and R33 above, not as standalone requirements. The `exit_code` checks of R4 keep their own throwaway `HOME` and no credential variable, unchanged.

## Verified against the code and the tool

The statements about existing code that this delta relies on, read before writing it: the executor builds its environment from `PATH`, `LANG`, `LC_ALL`, `TMPDIR` plus a throwaway `HOME` and `CLAUDE_CONFIG_DIR` (`scripts/lib/skill-evals/executor/claude-code.ts`, `buildEnv`); the judge driver does the same through `childEnv` (`tests/e2e/lib/llm_judge_drivers/claude-cli.ts`) and its preflight accepts only a token; `planCredentials` exits 3 with neither variable (`scripts/lib/skill-evals/credentials.ts`); the runner installs the skill under `<root>/home/.claude/skills/<name>` and `collectOutputs` walks the whole workspace (`scripts/lib/skill-evals/run.ts`), which is why requirement 32 excludes `.claude/` from outputs; `judgeEnv` passes no `HOME`. About the tool, on `claude` 2.1.322 and with no model call: `claude auth status --json` exits 0 with `loggedIn: true` for the session, exits 1 with `loggedIn: false` for a throwaway configuration directory, and reports `loggedIn: true` for any non-empty token or key in the environment (so it is a presence check for the overrides, which is why requirement 41 runs it in session mode only).

## Scenarios

**Scenario:** a contributor who is not logged in exits 3

```text
Given neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set, mock mode is off, and claude auth status reports loggedIn false
When  the contributor runs task skill-evals -- pr-logbook
Then  no model call is made
And   the message tells the contributor to run claude and log in
And   the run exits 3, and no results file is written
```

**Scenario:** a logged-in contributor needs no variable

```text
Given neither variable is set and claude auth status reports loggedIn true
When  the contributor runs task skill-evals -- pr-logbook
Then  the run proceeds, the executor and the judge use the logged-in session
And   the report names the logged-in Claude Code session as the credential source
And   no credential variable is present in the child's environment
```

**Scenario:** the judge follows the credential source

```text
Given no judge override
When  the runner prepares its judge calls with a logged-in session and no variable, or with only CLAUDE_CODE_OAUTH_TOKEN
Then  its effective judge configuration, in a directory of its own, selects the headless-claude backend
And   with only ANTHROPIC_API_KEY set it selects the anthropic backend instead
```

**Scenario:** the subscription credential is never sent to the Messages API, in session mode either

```text
Given a logged-in session and no variable, and the judge configuration left at its default
When  the runner judges an expectation
Then  the judge's model call is made by headless claude -p
And   no request is sent to the Messages API
```

**Scenario:** the run is isolated by flags and keeps the real home

```text
Given a contributor whose real HOME holds user settings, hooks, a CLAUDE.md and a user-scope skill
When  the runner starts an executor run and a judge call
Then  each claude child receives --setting-sources project, --strict-mcp-config and --no-session-persistence, and no --bare
And   each child's HOME is the contributor's own HOME, not a temporary directory
And   no variable outside the allowlist of requirement 42 reaches the child
```

**Scenario:** the skill is installed at project scope in the workspace

```text
Given a skill with SKILL.md, scripts/, references/, assets/ and evals/
When  the runner performs the with_skill run and the without_skill run
Then  the with_skill workspace holds .claude/skills/<name>/ with SKILL.md, scripts/, references/ and assets/ and no evals/ path
And   the without_skill workspace has no .claude/skills directory
And   the workspace is a temporary directory outside any repository
And   neither run's outputs/ holds a path under .claude/
```

**Scenario:** the base replay installs the merge-base skill the same way

```text
Given a skill modified against the merge-base
When  the runner performs the base replay of an eval
Then  the merge-base SKILL.md and scripts are installed under <workspace>/.claude/skills/<name>/ of that run's own workspace
```

**Scenario:** the login probe never leaks the account

```text
Given claude auth status prints the account's e-mail address and organisation alongside loggedIn
When  the runner probes the login, whether it succeeds or fails
Then  neither the runner's output nor any written file contains that e-mail address or organisation
```
