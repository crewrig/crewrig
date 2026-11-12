---
id: "0293"
slug: skill-authoring-standard
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1848
version: 1.0.0
---

# Define the skill authoring standard v2 and the linter that enforces it

## Intent

Every CrewRig skill is written to one published standard, and a deterministic check tells an author, before review, whether a skill follows it. The standard says how long and how structured a skill's description is, which steps of a skill run as bundled scripts and how those scripts behave, what a skill's evaluation file holds, how a prompt is worded for current models, and where the text that many skills repeat lives once. The standard is informed by the measured `pr-logbook` pilot: its script contract is ratified with the changes the pilot showed to be needed, and its lessons are written into the procedure the migration waves follow. A skill that ships evaluation cases is protected from the day it ships them: a change that breaks the standard on such a skill fails the pull-request pipeline.

## Requirements

1. **R1 (the standard document).** The rules of R2 to R16 SHALL be published in one normative document, `docs/skill-authoring-standard.md`, that states for each rule whether the linter of R19 enforces it or whether it is guidance for the author and the reviewer, and that records the evidence for the description limit of R2. Skills under the migration waves of epic #1856 SHALL be authored to it.
2. **R2 (description cap).** The `description` of every skill and agent source under `artifacts/`, and of every compiled skill and agent output, SHALL be at most 1,024 characters, counted in Unicode code points after trimming surrounding whitespace. This amends the value 300 in requirements 11 and 17 of spec 0269 to 1,024 and changes nothing else in them (the retention of trigger words and the CI enforcement stay). `scripts/lib/governance/description-length.ts` and `scripts/check-description-length.ts`, their messages, their task description and the documents that quote the old value SHALL state 1,024. The standard SHALL record that 1,024 is the lowest limit any supported CLI imposes.
3. **R3 (description structure).** The `description` of a skill SHALL be written in the third person and SHALL contain, in this order, a statement of what the skill does, a `Use when` clause naming the situations that call for it, and the trigger terms a delegating model looks for. The linter enforces the presence of the `Use when` clause and the absence of first-person and second-person pronouns; the order and the quality of the trigger terms are guidance. The standard SHALL advise a `Not for` clause when a neighbouring skill shares vocabulary with the skill, since the pilot showed one such clause to be the most effective single fix of a mis-triggering skill.
4. **R4 (deterministic steps are scripts).** The standard SHALL require that a step whose outcome is fixed (an output format, a forge or API call, a validation, a parse, an identifier to mint, a template to fill) is implemented as a script in the skill's own `scripts/` directory and not as prose the model re-derives, and SHALL require that the skill body states when to run each script and what each of its exit codes means. The standard SHALL list the kinds of step that stay in prose: content judgement, and any step whose script would cost more to keep than the prose it replaces.
5. **R5 (the script contract is ratified).** The provisional contract of spec 0292 R9 and of `references/script-contract.md` of `pr-logbook` SHALL be ratified by the standard as the contract of every bundled script, with these amendments, and SHALL no longer be labelled provisional anywhere the standard governs:
   - (a) a script is a single-file TypeScript program that runs on Node.js 24 as `node scripts/<name>.ts` from the installed skill directory, with no import and no file outside that directory;
   - (b) `--help` prints the usage on standard output and exits 0; with `--json` the script prints exactly one object `{ok, data, findings}` on standard output and human text on standard error; the exit codes are 0 (ok, no error finding), 1 (at least one error finding), 2 (usage error) and 3 (precondition or environment failure); `ok` is true exactly when the exit code is 0;
   - (c) a finding carries `rule` and `message` and MAY carry `severity`, `error` (the default) or `warning`; a warning is listed in `findings` and does not by itself change the exit code, which is 1 only when at least one finding is an error;
   - (d) a script that writes to a forge SHALL do so only through the forge's own command-line tool, SHALL accept `--dry-run`, and in that mode SHALL print the command it would run and run none; a script that writes anything else accepts `--dry-run` and writes nothing under it; a script that writes nothing to a forge makes no network call;
   - (e) a script never stages, commits or pushes;
   - (f) a small helper that two scripts of one skill both need MAY be duplicated in each, because a script that imports nothing is the price of installing a skill as a plain directory; the duplication is deliberate and is not a defect.
6. **R6 (a validating script rejects its own template).** The standard SHALL state, as guidance, that a script which validates a document built from a template reports a finding on the unmodified template, so that placeholder text cannot pass for content.
7. **R7 (evals file).** A skill SHALL ship `evals/evals.json` valid under spec 0290 R1 to R6, which this standard refers to and does not redefine, with at least three evals and at least six trigger probes of which each of the positive and the negative kinds is at least 40 percent. The standard SHALL advise at least five evals, and negative probes that are near-misses sharing vocabulary with the skill's domain, because the pilot measured a pass rate with no margin over the threshold at five evals and probes that flipped between runs. `evals/` stays in the repository and is not shipped to any CLI target (spec 0290 R7).
8. **R8 (prompt style).** The standard SHALL require that a rule in a skill body or reference explains its reason instead of resting on stacked emphasis (`MUST`, `NEVER`, `CRITICAL`, `ALWAYS`, `IMPORTANT` in capitals); that a runtime prompt carries no spec or issue citation (`spec 0080 R14`, `#1234`), because traceability belongs in specs and in commit history; and that a skill does not explain what the model already knows. The linter enforces the first by reporting a body that holds more than five such capitalised words, and the second by reporting a citation of the forms `spec <NNNN>`, `R<N>` and `#<N>` outside code spans and fences; the third is guidance.
9. **R9 (size and layout).** A `SKILL.md` SHALL have at most 500 lines. Every file a skill's body cites under `references/`, `scripts/` or `assets/` SHALL exist. A reference file SHALL NOT cite another reference file of the same skill (one level deep). A reference longer than 100 lines SHALL open, within its first 20 lines, with a table of contents under a heading named `Contents` or `Table of contents`. `compatibility` SHALL be present, non-empty and at most 500 characters. `name` SHALL be 1 to 64 characters of lowercase letters, digits and single hyphens, neither starting nor ending with a hyphen, and SHALL equal the skill's directory name.
10. **R10 (bundled scripts answer `--help`).** Every file a skill bundles under `scripts/` SHALL, when run with `--help`, print a non-empty usage on standard output and exit 0 within ten seconds, which the linter verifies by running it.
11. **R11 (shared boilerplate lives once).** The text that eight or more skills repeat (the shutdown protocol, the idle behaviour, the grounding discipline, the finding-class taxonomy and friction reporting) SHALL exist in one place in the repository, one file per topic, and SHALL no longer be copied by hand into a skill. A skill that needs a topic cites it from its body as `references/shared-<topic>.md`; the build SHALL place a byte-identical copy of that file in that skill's `references/` in every built output of every supported CLI, so that an installed skill stays a self-contained directory, and SHALL place nothing for a topic the skill does not cite. A shared reference SHALL NOT cite another reference. A check SHALL fail when a built copy differs from its source or when a cited shared topic has no source.
12. **R12 (shared reference and the linter).** The linter SHALL treat a cited `references/shared-<topic>.md` as resolved when the shared source of `<topic>` exists, though the file is absent from the skill's source directory.
13. **R13 (shared reference content).** The shared references SHALL state each rule once, with its reason and without a spec or issue citation, and SHALL cover the five topics of R11. The standard SHALL list, for each of the five topics, the skills and agents that carry a copy today, as the inventory the waves of epic #1856 use when they replace a copy by a citation. Replacing the copies in existing skills is the work of those waves, not of this spec.
14. **R14 (migration procedure).** The standard SHALL set out the procedure a migration wave follows for a skill, in this order: write the evals first, measure a baseline, extract the scripts, measure again, and keep the rewrite only when the pass rate does not fall below the baseline by more than the tolerance of the runner. It SHALL add the lessons of the pilot as steps: the cost model of the measuring tool is presented to the user when the wave's spec is validated and not at the spend gate; the description is the first text to revise when a trigger probe fails; any later edit of a skill that already sits at its pass threshold is followed by a new paid measurement; and an expectation about invented content (grounding) is backed by a deterministic check where one can be written.
15. **R15 (no hook).** Enforcement SHALL NOT rely on a hook of any CLI. It runs as a command an author invokes, as a pre-push mirror and as a job of the pull-request pipeline.
16. **R16 (agents).** The standard SHALL state that the description cap of R2 applies to agents and that the other rules of this spec apply to skills; agent frontmatter and the removal of rule text duplicated between an agent and its skill are not governed by it.
17. **R17 (the linter).** A script `scripts/check-skill-quality.ts` SHALL check every skill source under `artifacts/*/skills/*/` (or the skills named on its command line) against R3 and R7 to R10 and R12, and SHALL follow the script contract of R5: `--help`, `--json`, exit codes 0, 1, 2 and 3, warnings that do not change the exit code, and `--strict`, which makes every warning an error. Each finding names the skill, the file, the rule and a message that states the fix. It SHALL exit 3 when a required dependency is missing or the repository root cannot be found, and 2 on an unknown option or skill. It SHALL make no network call and no model call.
18. **R18 (when a finding blocks).** A finding on a skill that ships `evals/evals.json` SHALL be an error, and a finding on any other skill SHALL be a warning; the absence of `evals/evals.json` is itself a warning. An invalid `evals/evals.json` SHALL always be an error. The description cap of R2 stays an error for every skill and agent, through its own check. A skill therefore becomes protected the moment it ships its evals, without waiting for the rest of its wave.
19. **R19 (wiring).** The linter SHALL run, with no hook, as a task `check-skill-quality` runnable as `task check-skill-quality -- <skill>`, as a pre-push mirror and as a job of the governance group of the pull-request pipeline, in the same way as `check-description-length`, with every generated pipeline file regenerated in the same change and its tests wired so that the test-wiring check passes.
20. **R20 (tests).** The linter SHALL have automated tests that run with no network and cover, for every rule it enforces, a passing case and a failing case, the warning versus error behaviour of R18, `--strict`, the `--json` shape, `--help`, exit 2 and exit 3. The description-cap tests SHALL cover 1,024 characters accepted and 1,025 refused.
21. **R21 (the repository passes).** At the merge of the implementation, `pr-logbook` SHALL produce no error finding, every other skill SHALL produce at most warnings, and no skill or agent source SHALL need a `metadata.provenance.version` bump from this change; `pr-logbook`'s own sources, its evals and its `evals/results.json` SHALL stay byte-identical.

## Scenarios

**Scenario:** a longer description is accepted

```text
Given a skill whose description is 800 characters, in the third person, with a `Use when` clause
When  the description-length check and the skill linter run
Then  both pass
```

**Scenario:** a protected skill breaks the standard

```text
Given a skill that ships evals/evals.json and whose description has no `Use when` clause
When  `check-skill-quality.ts` runs on it
Then  it prints one error finding naming the skill, the file and the rule, and exits 1
```

**Scenario:** an unmigrated skill only warns

```text
Given a skill with no evals directory and a SKILL.md of 520 lines
When  `check-skill-quality.ts` runs on it
Then  it prints a warning for the length and a warning for the missing evals, and exits 0
```

**Scenario:** strict mode

```text
Given the same unmigrated skill
When  the linter runs with `--strict`
Then  the warnings are errors and it exits 1
```

**Scenario:** the cap is exact

```text
Given a skill description of 1,025 characters
When  `check-description-length.ts` runs
Then  it exits 1 and names the file and the length 1,025
```

**Scenario:** a shared reference

```text
Given a skill whose body cites `references/shared-friction-reporting.md` and a shared source for that topic
When  the linter runs on the source, then the components are built
Then  the linter reports no unresolved citation, and every built output of the skill holds a byte-identical copy
```

**Scenario:** an unresolved citation and a script that does not answer `--help`

```text
Given a skill body citing `references/missing.md` and a bundled script that exits 1 on `--help`
When  the linter runs
Then  it reports both findings, each naming its file
```

**Scenario:** usage and environment errors

```text
Given an unknown option, then an unknown skill name, then a missing js-yaml dependency
When  the linter runs
Then  the first two exit 2 and the third exits 3, and with `--json` each prints an object with `ok` false and no `data`
```

## Out of scope

- Migrating any existing skill (waves #1852 to #1855), including replacing their copies of the shared boilerplate by a citation and the one paid re-measurement `pr-logbook` needs when its `SKILL.md`, `AGENT.md` or its reference `script-contract.md` (still labelled provisional) next changes.
- The eval runner and its tolerance, and the schema of `evals/evals.json` (spec 0290).
- Agent frontmatter fields and the duplication between an agent and its skill.
- Fixing `lint-pr-body.ts` so that it rejects the unmodified template, which is a finding of the pilot recorded for `pr-logbook`.
- A hook of any CLI, and any enforcement run by a model.
- A judgement of whether a description's trigger terms are good, or a probe a near-miss; the linter checks structure, not quality.

## Open questions

- Should a finding become blocking per skill as soon as it ships `evals/evals.json` (R18, the coordinator's recommendation, which protects `pr-logbook` immediately), or only once the whole wave of the skill is migrated, as the issue says? R18 is drafted to the first; the owner decides at the SPECS gate.
