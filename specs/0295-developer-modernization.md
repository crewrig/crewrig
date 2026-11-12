---
id: "0295"
slug: developer-modernization
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1893
version: 1.0.0
---

# Modernize the developer skill and agent to the authoring standard v2

## Intent

The `developer` skill and agent are brought to the skill authoring standard v2 (`docs/skill-authoring-standard.md`), following the `pr-logbook` pilot. The skill is generic: it ships to adopters whose repositories do not build CrewRig components, yet today it carries CrewRig build steps. Those steps leave the skill. The one fixed-outcome step that is worth a script, the pre-handoff review of the diff, becomes a bundled script. The skill gets evaluation cases and trigger probes, and the agent stops repeating its skill. The effect is measured with the eval runner, not asserted.

## Requirements

1. **R1 (one implementation pull request).** The work SHALL land as one implementation pull request that changes `artifacts/core/skills/developer/` and `artifacts/core/agents/developer/`, regenerates the built components, and commits the `evals/results.json` of a non-mock run. It SHALL NOT edit `pr-logbook`, the eval runner or its settings.
2. **R2 (CrewRig build steps leave the skill).** The skill body SHALL NOT mention the CrewRig build, its mirrors or the `check-components` job, and SHALL NOT contain a `crewrig-repo-only` block. The rule is already stated for every agent of the repository by the *Built components* rule of `AGENTS.md` and by `docs/agent-team-protocol/built-components.md`; no new document is created. The skill keeps one generic sentence telling the model to follow the project's own build and generated-file rules from its working-rules file, and why: a generated file that disagrees with its source fails the project's pipeline.
3. **R3 (pre-handoff script).** The skill SHALL bundle `scripts/pre-handoff.ts`, which reviews the working-tree diff against a base ref before the model reports done. It SHALL report as findings: (a) each changed file that is not covered by a `--scope <path-or-glob>` option (repeatable; with no `--scope` the check is skipped and the data lists the changed files); (b) each file whose diff adds a non-ASCII character, as a warning, and each file whose diff removes one that is absent from the added lines of the same file, as an error, which is how a silent `→` to `->` regression is caught; (c) each file whose mode went from `100755` to a non-executable mode. It SHALL NOT report whether a rebuild is needed (R2).
4. **R4 (script contract).** `pre-handoff.ts` SHALL follow the script contract of the standard: a single TypeScript file with no import, `--help`, `--json` with `{ok, data, findings}`, exit codes `0`/`1`/`2`/`3` (`3` outside a git repository), and no network call, staging, commit or push. It writes nothing, so it needs no `--dry-run`.
5. **R5 (branch start stays in prose).** No `git-start-branch.ts` is created. The branch-start rule stays in the skill as the two commands with the reason (a branch cut from a stale local ref misses merged work), because the script would be a fetch and a branch creation, and the standard's script contract allows no network call outside a forge write. The standard follow-up (R14) records the choice.
6. **R6 (description).** The skill description SHALL be at most 1,024 characters, third person, state what the skill does, carry a `Use when` clause and the trigger terms, and carry a `Not for` clause naming the architect, security and tester skills' territory. The agent description SHALL state when to delegate to the agent.
7. **R7 (prompt style).** The skill body SHALL carry no spec or issue number and no more than five capitalised `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` outside code; each rule it keeps states its reason. The *Finding class taxonomy* and *Friction reporting* sections SHALL be replaced by citations of `references/shared-finding-class-taxonomy.md` and `references/shared-friction-reporting.md`, with one sentence each on when they apply.
8. **R8 (agent).** The agent SHALL keep its role, tool access, model intelligence and hand-off boundaries (architect, security, tester) and drop every sentence that restates the skill (the lifecycle, the diff-as-output rule, the parallelisation rule, the verification rule). Its friction paragraph SHALL become a one-line pointer to the `harness-report` skill with no mention of `config/TOOLS.md`. The sentence about `artifacts/community/` SHALL be removed (R2). The agent SHALL NOT receive a `tools` allowlist: it edits files and runs commands.
9. **R9 (evals).** `evals/evals.json` SHALL hold three or four evals and five trigger probes under spec 0290: expectations stated on the observable output, `file_exists` and `file_contains` checks only, fixtures under `evals/files/`, no eval that writes to a forge. The evals SHALL cover at least: a bounded fix that must not touch what it was not asked to touch, a pre-handoff review that must catch a lost non-ASCII character, and a `tech` finding with a missing `class:` tag that must be surfaced back rather than guessed. The probes SHALL be at least two positive and at least two near-miss negatives that share vocabulary with the skill (design a contract change, write regression tests, review a pull request, write documentation).
10. **R10 (frozen cases).** `evals.json` and the fixtures SHALL NOT change after the first non-mock run, except under R12.
11. **R11 (measurement and spend).** Agents run the eval runner in mock mode only. The owner approves the spend once, on the plan the runner prints for one measurement, and launches each non-mock run in their own terminal. The cost model, from the pilot, is about 0.25 to 0.37 USD of executor cost per run, 17 model runs per measurement and up to seven judge calls per eval; the planned cap is three measurements.
12. **R12 (acceptance and regression path).** The pull request SHALL be merged only when the committed `evals/results.json` is of a non-mock run on its head and its status is not `regression` under the `TOLERANCE` on `main`. After three non-mock runs without that outcome, the work stops and the owner chooses between revising the description, revising the cases (which restarts the count and needs R11's approval again) and abandoning the rewrite. A trigger probe that fails is answered by revising the description before the body.
13. **R13 (zero findings).** `task check-skill-quality -- developer` SHALL report zero errors and zero warnings, `metadata.provenance.version` of the skill and the agent SHALL be bumped, and the built components SHALL be regenerated in the same commit.
14. **R14 (report and follow-ups).** A comment on issue #1852 SHALL report the measured figures, the choices of R2 and R5, and these follow-ups: the `check-exec-bits` duplication in `pr-logbook` is removed in a later edit of that skill that is re-measured anyway; and the standard's no-network clause leaves a branch-start script unwritable, which the standard may amend.

## Scenarios

### Happy path — pre-handoff catches a lost character

- **Given** a diff that replaces `→` by `->` in a file inside the declared scope,
- **When** the model runs `pre-handoff.ts --scope src/ --json`,
- **Then** it prints one object with an error finding naming the file and the removed character, and exits 1.

### Happy path — clean diff

- **Given** a diff limited to the declared scope, adding only ASCII and keeping every file mode,
- **When** `pre-handoff.ts --scope src/` runs,
- **Then** it exits 0 and lists no finding.

### Failure path — file outside the scope

- **Given** a diff that also modifies `README.md` while the scope is `src/`,
- **When** `pre-handoff.ts --scope src/` runs,
- **Then** a finding names `README.md` as out of scope and the script exits 1.

### Failure path — executable bit lost

- **Given** a script whose mode changed from `100755` to `100644`,
- **When** `pre-handoff.ts` runs,
- **Then** it reports an error finding naming the file and exits 1.

### Failure path — outside a repository

- **Given** the built skill directory run in a directory that is not a git repository,
- **When** `pre-handoff.ts` runs,
- **Then** it exits 3 with a message stating that no repository was found, and writes nothing.

### Failure path — regression after three runs

- **Given** three non-mock runs whose status is `regression`,
- **When** the third ends,
- **Then** the work stops and the owner is offered the three choices of R12.

## Out of scope

- Any edit of `pr-logbook`, the eval runner, `settings.ts` or the standard.
- A rebuild-needed check in any script: the build is a CrewRig concern, owned by `AGENTS.md`, the built-components document and the `check-components` job.
- A `tools` allowlist on the agent.
- The wave's other skills and the `tester` pair, which has its own ticket.

## Open questions

None.
