# Skill authoring standard

<!-- crewrig-doc: section=reference nav_order=166 published=true title="Skill authoring standard" -->

How every CrewRig skill is written, and which of these rules a command checks for you. Specification: [spec 0293](../specs/0293-skill-authoring-standard.md) and its [delta 01](../specs/0293-skill-authoring-standard.delta-01.md). The migration waves of the skill modernization epic apply this standard to each skill; the evaluation cases it requires are those of [Skill evals](skill-evals.md).

## Contents

- [How the rules are checked](#how-the-rules-are-checked)
- [Description](#description)
- [Steps that run as scripts](#steps-that-run-as-scripts)
- [The script contract](#the-script-contract)
- [Evals](#evals)
- [Prompt style](#prompt-style)
- [Size and layout](#size-and-layout)
- [Shared references](#shared-references)
- [Migration procedure](#migration-procedure)
- [Scope: agents](#scope-agents)

## How the rules are checked

Run `task check-skill-quality` for every skill, or `task check-skill-quality -- <skill>` for one, before you open a pull request. The pull-request pipeline runs the same check as the `check-skill-quality` job. No hook of any CLI runs it.

- A skill that ships `evals/evals.json` is **protected**: every finding on it is an error and fails the pipeline. Shipping the evals is the moment the skill opts in, so a migrated skill is guarded without waiting for the rest of its wave.
- On any other skill a finding is a **warning**: it is printed and does not fail the run. `--strict` turns every warning into an error, which is how a wave checks its own skills before adding the evals.
- Two findings are errors whatever the skill: a description over the cap, and an evals file that does not validate. The absence of an evals file is always a warning.
- `--json` prints one `{ok, data, findings}` object on stdout. Exit codes: `0` no error, `1` an error finding, `2` usage error, `3` the environment is not ready (`js-yaml` missing, no repository root).

In the sections below, a rule marked **checked** is enforced by the linter under the severity above; a rule marked **guidance** is for the author and the reviewer.

## Description

The description is the text a model reads to decide whether to load the skill, so it is the highest-leverage text of the skill. The `pr-logbook` pilot fixed two mis-triggering probes and one unloaded skill by changing the description alone.

- **Cap (checked, error on every skill and agent).** At most 1,024 characters, counted in Unicode code points after trimming, on the source and on every compiled output. 1,024 is the lowest limit a supported CLI imposes: the open skills format and Claude Code set it at 1,024, and the Claude Code listing truncates a description together with its `when_to_use` text at 1,536. Gemini CLI, GitHub Copilot CLI and Antigravity CLI document no lower limit.
- **Structure (checked: the `Use when` clause).** Third person. State what the skill does, then a `Use when` clause naming the situations that call for it, then the trigger terms a delegating model looks for.
- **Person (checked).** No first-person or second-person pronoun: the description says what the skill does, not what "you" do.
- **Exclusion (guidance).** Add a `Not for …` clause when a neighbouring skill shares vocabulary with yours. One such clause stopped the pilot's skill from triggering on a local commit message.
- **Trigger terms (guidance).** Use the words a user or a delegating model would type, not your internal names for the steps.

## Steps that run as scripts

**Guidance.** A step whose outcome is fixed is a script in the skill's own `scripts/` directory, not prose the model re-derives each run. Fixed outcomes are: an output format, a forge or API call, a validation, a parse, an identifier to mint, a template to fill. The skill body says when to run each script and what each of its exit codes means.

Keep a step in prose when its outcome is a judgement (the content of a section, the wording of a message) or when the script would cost more to keep than the prose it replaces. The pilot kept body composition, the logbook entry text and the squash message in prose for those reasons, and dropped a compose script as over-engineering.

A script that validates a document built from a template reports a finding on the unmodified template, so that placeholder text cannot pass for content. The pilot's body linter did not, which is a recorded finding of that skill.

## The script contract

Ratified from the `pr-logbook` pilot, which applied it to three scripts without a change of shape. Every bundled script follows it.

1. **Form.** A single TypeScript file that runs on Node.js 24 as `node scripts/<name>.ts` from the installed skill directory, with no import and no file outside that directory. Built-in modules come from `process.getBuiltinModule`.
2. **Output.** `--help` prints the usage on standard output and exits `0`. With `--json` the script prints exactly one object `{"ok": boolean, "data": object|null, "findings": [...]}` on standard output and human text on standard error; without it, human text. `ok` is true exactly when the exit code is `0`.
3. **Exit codes.** `0` ok, `1` at least one error finding, `2` usage error (unknown option, missing or extra argument), `3` precondition or environment failure (an unreadable input, a missing tool, not inside a repository). Under `--json`, `2` and `3` still print the object with `ok: false`, `data: null` and a finding whose `rule` is `usage` or `precondition`.
4. **Findings.** An object with `rule` (a stable identifier) and `message` (a sentence for a human, stating the fix). It may carry `severity`, `error` (the default) or `warning`. A warning is listed and does not by itself change the exit code.
5. **Writing.** A script that writes anything accepts `--dry-run`: it reports what it would write and writes nothing. A script that writes to a forge does so only through the forge's own command-line tool (`gh`, `glab`, `tea`), accepts `--dry-run`, and under it prints the command it would run and runs none. A script that writes nothing to a forge makes no network call. A script that writes nothing to a forge may make a read-only query through the forge's own command-line tool, bounded by a timeout, and degrades to exit `3` when the query cannot run, never to success. A script never stages, commits or pushes.
6. **Inputs.** A file path, or `-` for standard input where the usage says so. Options accept `--name value` and `--name=value`.
7. **Duplicated helpers are deliberate.** Two scripts of one skill that need the same small helper each carry a copy, because a script that imports nothing is what lets a skill install as a plain directory. The duplication is not a defect.

`--help` is checked: the linter runs every file directly under a skill's `scripts/` with `--help` from the skill directory, and expects a non-empty usage on stdout and exit `0` within ten seconds. `.ts`, `.js` and `.mjs` files run through `node`, `.py` files through `python3`, and any other file through its execute bit. An interpreter that is not installed produces a `script-help-skipped` finding at the skill's severity, never exit `3`.

## Evals

The schema of `evals/evals.json` is owned by [spec 0290](../specs/0290-skill-eval-runner.md); this standard refers to it and does not redefine it. `evals/` stays in the repository and is never copied to a CLI target.

- **Checked.** The file validates under the runner's schema. It holds at least 3 evals and at least 5 trigger probes, and each of the positive and the negative kinds is at least 40 percent of the probes.
- **Guidance.** Write at most 6 evals that carry expectations. The runner refuses a skill with 7 or more of them, because its worst-case judge calls exceed the judge cap; the linter warns above 6. A skill with more than 6 evals is split, or its evals are reduced, before it is measured. Make the negative probes near-misses that share vocabulary with your domain (reviewing a pull request, writing a spec, writing a local commit message), not unrelated requests. Probes are sampled once per stage, and a probe pool is decided on its own, so a probe set that is too small gives a verdict that is too noisy to act on.
- **Guidance.** Write every expectation on the observable output of the run, never on how it was produced, so the same cases measure the skill before and after its steps move into scripts. Never ask an eval to write to a forge; ask for the text and the command as files.
- **Guidance.** Write every expectation so that a conforming output can quote it on one whole line of a produced file. A quote of one line is the strongest evidence; a quote that spans lines is accepted only when the normalised or window rule matches it, and a paraphrase is refused as evidence. The judge's one re-ask does not turn a paraphrase into a quote.
- **Guidance.** Write one fact per expectation. An expectation that bundles two facts fails when either fails, and the failure does not say which.
- **Guidance.** Do not write an expectation that is only an absence ("does not mention", "never writes"). A judge cannot prove an absence from a quoted line. When the absence concerns a produced file, write a `file_not_contains` check with a regular expression; when it concerns the content of the output, quote the lines that enumerate it.
- **Guidance.** Dry-run the evals against hand-written samples before the baseline run: `task skill-evals -- <skill> --dry-run`, with one `evals/samples/<id>/` directory per eval holding a conforming output. The dry-run runs the check scripts and makes judge calls, with no executor run, and writes nothing to the skill. Every expectation should pass on a conforming sample; a `FAIL` on one is a defect of the case or of the sample, to fix before any paid run.

## Prompt style

- **Explain the reason (checked: capitalised emphasis).** A rule that states why it exists is followed better than one that shouts. The linter reports a body or reference with more than five of `MUST`, `NEVER`, `CRITICAL`, `ALWAYS` or `IMPORTANT` in capitals outside code.
- **No traceability in a runtime prompt (checked).** No `spec <NNNN>`, no requirement number `R<N>` and no issue number written as a number sign and at least three digits, outside code spans and fences. Traceability belongs in specs and in commit history; the model gains nothing from it and the next editor inherits a dead link. A short number sign such as `Task #2` in an example, and the placeholder `#N`, are not citations.
- **Do not explain what the model knows (guidance).** Spend the tokens on what the model cannot derive: your project's conventions, the reason of a non-obvious rule, the outcome of each script exit code.
- **Grounding (guidance).** An instruction to ground claims did not stop the pilot's skill from inventing a motivation in a pull request body. Where a check can be written, write the check.

## Size and layout

- **Checked.** `SKILL.md` has at most 500 lines. `name` is 1 to 64 characters of lowercase letters, digits and single hyphens, equals the directory name. `compatibility` is present, non-empty and at most 500 characters.
- **Checked.** Every `references/`, `scripts/` or `assets/` path the body or a reference cites exists. A path with a `<placeholder>`, a glob, or a trailing slash is not a citation of one file; neither is a path inside a `yaml` fence or a repo-only block.
- **Checked.** References stay one level deep: a reference does not cite another reference of the same skill. A reference longer than 100 lines opens, within its first 20 lines, with a `Contents` heading.

## Shared references

The text that many skills repeat lives once, in `artifacts/core/shared/references/`, one file per topic: `shutdown-protocol`, `idle-behavior`, `grounding-discipline`, `finding-class-taxonomy` and `friction-reporting`.

A skill that needs a topic cites it from its body as `references/shared-<topic>.md`. The build then writes a byte-identical copy of the source to that path in the built skill of every CLI, so the installed skill is still a self-contained directory, and writes nothing for a topic the skill does not cite. The build fails when a cited topic has no source, when a skill source holds a `shared-` file of its own (the prefix is reserved), and, under `--check`, when a copy differs from its source or is no longer cited. The linter treats a shared citation as resolved when the source exists, although the file is absent from the skill's source directory.

### Where the text is copied today

Counted on the sources under `artifacts/`; replacing a copy by a citation is the work of the migration waves, not of this change.

| Topic | Skills | Agents |
|---|---|---|
| Friction reporting | `architect`, `developer`, `doc-writer`, `idea`, `security`, `spec-author`, `tester`, `pr-reviewer`, `pr-logbook`, `web-tester`, `harness-curator`, `harness-report`, `user-validate` | 9 agents carry a `Friction reporting` section |
| Finding class taxonomy | `architect`, `developer`, `idea`, `spec-author`, `pr-reviewer`, `tester` | `web-conformity-checker` |
| Grounding discipline | `architect`, `spec-author`, `pr-reviewer`, `pr-logbook` | `architect` |
| Idle behavior | `pr-logbook` | `pr-reviewer` |
| Shutdown protocol | `pr-logbook` | none |

The shutdown and idle texts are present in fewer skills than the epic estimated; the shared files exist for the waves that bring them back as a team-protocol concern.

## Migration procedure

A wave migrates a skill in this order, which is the order the `pr-logbook` pilot followed and measured.

1. Write the evals first and commit them without touching the skill.
1b. Dry-run the evals against hand-written samples: `task skill-evals -- <skill> --dry-run`. Every expectation should pass on a conforming sample before any baseline is paid for (see [Evals](#evals)).
2. Measure a baseline on the unchanged skill under the runner's sampling plan (spec 0304 R1): each eval runs twice, a stage 2 of two more runs follows only when stage 1 leaves the pool open, and the verdict is `pass` only when both pools are accepted. Every run is recorded, so the spread of the eval runs is visible in `evals/results.json`; there is no separate spread measurement, and a repeat of the same content is refused.
3. Extract the scripts and rewrite the body to this standard.
4. Measure again on the same frozen cases. Keep the rewrite when the new measurement is not `regression`: the runner's regression test (spec 0304 R12, Fisher's exact test over the evals present on both sides, with a drop of 0.10 or more) does not hold against the baseline.

Add these lessons of the pilot:

- Present the measuring tool's cost model when the wave's specification is validated, not at the spend gate. The pilot's paired-run runner was rejected only at the spend gate, which cost a re-scope.
- When a trigger probe fails, revise the description before the body. It is the cheapest and most effective change.
- A skill whose pools sit near an acceptance threshold (0.90 at stage 1, 0.75 over both stages) is re-measured after any later edit of its `SKILL.md`, because a wording change can move it across the line. Each re-measurement is a new content hash, and the ledger counts it.
- Evaluate the eval runner before the skill: a runner that cannot parse one malformed judge answer voids a paid run.

## Scope: agents

The description cap applies to agents. The other rules of this standard apply to skills. Agent frontmatter fields, and the rule text an agent duplicates from its skill, are not governed here.
