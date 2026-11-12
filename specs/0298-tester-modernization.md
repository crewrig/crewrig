---
id: "0298"
slug: tester-modernization
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1905
version: 1.0.0
---

# Modernize the tester skill and agent to the authoring standard v2

## Intent

The `tester` skill and agent are brought to the skill authoring standard v2 (`docs/skill-authoring-standard.md`), following the `pr-logbook` pilot and the `developer` migration (spec 0295). One step of the skill has a fixed outcome and an expensive failure mode: declaring a test skipped because a tool is "unavailable" without having probed it. That step becomes a bundled script. The skill gets evaluation cases written so that the skill actually loads, which the `developer` measurements showed they must, and the agent stops repeating its skill.

## Requirements

1. **R1 (one implementation pull request).** The work SHALL land as one implementation pull request that changes `artifacts/core/skills/tester/` and `artifacts/core/agents/tester/`, regenerates the built components, and commits the `evals/results.json` of a non-mock run. It SHALL NOT edit `pr-logbook`, `developer`, the eval runner or its settings.
2. **R2 (probe script).** The skill SHALL bundle `scripts/probe-tool.ts <tool> [<subcommand>]`, which runs the empirical probes of the skill's *Tool availability* rule in order and reports each one: (a) the tool's own discovery flag, `<tool> [<subcommand>] --help`; (b) `<tool> --version` when no subcommand is given; (c) a lookup of the tool on `PATH`, reported as a precursor only and never as proof of availability. The tool is run directly, never through a shell. Each probe has a timeout (`--timeout <seconds>`, default 10).
3. **R3 (probe outcome).** The script SHALL exit `0` when at least one of probes (a) and (b) exits `0`. It SHALL exit `1` with one finding of rule `unavailable` when none does, whose message quotes, for the last probe, the exact command, the exit code or the words `command not found` or `timed out`, and the first line of standard error, which is what the skill's skip rationale must carry. The data SHALL list every probe with its command, outcome, exit code and first line of standard error. A tool whose help exits non-zero although it exists is reported unavailable by this rule: the message SHALL say that a minimal real invocation with throwaway input, which the script cannot choose, is the next probe.
4. **R4 (script contract).** `probe-tool.ts` SHALL follow the script contract of the standard: a single TypeScript file with no import, `--help`, `--json` with `{ok, data, findings}`, exit codes `0`/`1`/`2` (unknown option, missing or extra argument, empty tool name)/`3` (an environment failure such as an unreadable `PATH`; a tool that does not exist is exit `1`), and no network call of its own, staging, commit or push. It writes nothing, so it needs no `--dry-run`.
5. **R5 (description).** The skill description SHALL be at most 1,024 characters, third person, state what the skill does, carry a `Use when` clause and the trigger terms, and carry a `Not for` clause naming web end-to-end tests (web-tester) and implementation (developer). The agent description SHALL state when to delegate to the agent.
6. **R6 (prompt style).** The skill body SHALL carry no spec or issue number and no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; each rule it keeps states its reason. The *Tool availability* section SHALL keep the forbidden grounds and the reason, and tell the model to run the script and what each exit code means. The *Finding class taxonomy* and *Friction reporting* sections SHALL become citations, written as code spans (not Markdown links), of `references/shared-finding-class-taxonomy.md` and `references/shared-friction-reporting.md`, with one sentence each on when they apply. `compatibility` SHALL be present and name Node.js 24.
7. **R7 (agent).** The agent SHALL keep its role, model intelligence and hand-off boundaries, drop every sentence that restates the skill, replace its friction paragraph by a one-line pointer to the `harness-report` skill without `config/TOOLS.md`, and receive no `tools` allowlist (it writes test files).
8. **R8 (tests).** `probe-tool.ts` SHALL have automated tests with no network call, wired into the `skill-scripts-ts` task of `taskfiles/ci/modules.yml`: success on a tool that exists, each probe outcome (help ok, help fails and version ok, both fail with a non-zero exit, tool not found, timeout), the `--json` shape, `--help`, exits `2` and `3`, and a run from a copy of the whole skill directory under every package layout.
9. **R9 (evals).** `evals/evals.json` SHALL hold three or four evals and five trigger probes under spec 0290: expectations on the observable output, `file_exists` and `file_contains` checks only, fixtures under `evals/files/`, no forge write. To make the skill load, every eval prompt SHALL ask for the work as a tester task in the words a user would use, and the measurement report SHALL state the `skill_loaded` count. The evals SHALL cover at least: a bug fix verified failing-then-passing, a tool whose availability must be probed before a skip is declared, and a `tech` finding with a missing `class:` tag that must be returned rather than guessed. The probes SHALL be at least two positive and at least two near-miss negatives (implementing a fix, web end-to-end tests, designing a contract, reviewing a pull request).
10. **R10 (frozen cases).** `evals.json` and the fixtures SHALL NOT change after the first non-mock run, except with the coordinator's approval of a restart of the measurement count. If the baseline shows `skill_loaded` 0 on an eval, that eval's prompt SHALL be revised before the cases are frozen, and the revision recorded on the logbook: an eval that never loads the skill is not evidence. The baseline is therefore the first measurement of the final cases, and the count of R11 starts then.
11. **R11 (measurement and spend).** The owner pre-approved the eval spend for wave 1 through the wave coordinator. The implementing agent runs `task skill-evals -- tester` itself in its logged-in Claude Code session, never with `--use-api-key`. Three non-mock measurements are allowed: a baseline on the unchanged skill with the committed cases, a final measurement on the rewritten skill and one retry. A fourth, or a measurement that only refreshes the attestation, needs the coordinator's approval first. Every edit of `SKILL.md`, of a script or of a reference, including the form of a citation, SHALL be made before the final measurement, because the content hash covers them and a stale attestation blocks the pre-push gate. The cost of every measurement is reported on the logbook. No paid measurement, the baseline included, runs before the runner's evidence-check fix of issue #1902 has merged; until then the agent runs the runner in mock mode only, so that no run is wasted on judge flakes.
12. **R12 (acceptance).** The pull request SHALL be merged only when the committed `evals/results.json` is of a non-mock run on its head, its status is not `regression`, and the coordinator accepts the measured figures with the reason on record. A trigger probe that fails is answered by revising the description before the body.
13. **R13 (zero findings).** `task check-skill-quality -- tester` SHALL report zero errors and zero warnings, `metadata.provenance.version` of the skill and the agent SHALL be bumped, the built components SHALL be regenerated in the same commit, and a search of the repository SHALL find no consumer of the skill whose behaviour depends on a removed section; the pull request body SHALL record the reason for the bump level.
14. **R14 (report).** A comment on issue #1852 SHALL report the measured figures, the `skill_loaded` counts, and the follow-ups.

## Scenarios

### Happy path — the tool exists

- **Given** a tool `widgetctl` whose `export --help` exits 0,
- **When** the model runs `probe-tool.ts widgetctl export --json`,
- **Then** it prints one object with `ok: true` and the probes, and exits 0.

### Failure path — the tool is missing

- **Given** no tool named `nosuchtool` on `PATH`,
- **When** `probe-tool.ts nosuchtool` runs,
- **Then** it exits 1 with a finding that quotes `nosuchtool --help` and `command not found`.

### Failure path — the help exits non-zero

- **Given** a tool whose `--help` and `--version` both exit 2 with a usage line,
- **When** `probe-tool.ts` runs,
- **Then** it exits 1 and the finding quotes the exit code and the first line of standard error, and says a minimal real invocation is the next probe.

### Failure path — timeout

- **Given** a tool that sleeps past `--timeout 1`,
- **When** `probe-tool.ts <tool> --timeout 1` runs,
- **Then** the probe is reported `timed out` and the script exits 1.

### Failure path — usage

- **Given** no tool name or an unknown option,
- **When** the script runs,
- **Then** it exits 2 and, under `--json`, prints `ok: false`, `data: null` and a finding of rule `usage`.

## Out of scope

- Any edit of `pr-logbook`, `developer`, the eval runner, `settings.ts` or the standard.
- Choosing the minimal real invocation of a tool: it depends on the tool and stays a judgement in prose.
- Test-writing steps (what to test, naming, structure): they are judgement and stay in prose.
- A `tools` allowlist on the agent.

## Open questions

None.
