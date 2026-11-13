---
id: "0302"
slug: ci-agents-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1942
version: 1.0.0
---

# Modernize the ci-debugger and ci-parity agents

## Intent

The `ci-debugger` and `ci-parity` agents are brought in line with the agent rules of the skill authoring standard (wave 3d of the CI and security modernization). `ci-debugger` stops carrying a failure catalogue and a list of prohibited fixes inside its prompt: that reference material moves to where a reader can load it on demand, and its description says what it does, diagnosis only, and when to delegate to it. `ci-parity` stops carrying its classification and reconcile tables as prose: a repository script turns a harness report into classified divergences, and the agent keeps its role, its autonomy boundary and its handoffs. Both agents point at `harness-report` for friction. Behaviour preservation is checked by script tests and a documented manual probe set, since agents have no eval runner.

## Requirements

1. **R1 (order of work).** The work SHALL land as one implementation pull request whose commits are ordered: first the probe set of R2 and the classifier fixtures of R11 with no change to either agent, then a baseline run of the probe set on the unchanged agents, then the references, the script and the rewrites, then the final run of the probe set. Probes and fixtures SHALL stay byte-identical after the first commit.
2. **R2 (manual probe set).** A document `docs/ci-agent-probes.md` SHALL list at least six probes per agent, each with a prompt, an optional fixture and a pass criterion stated on observable output. The `ci-debugger` probes SHALL cover: a failed run with a log excerpt for each of at least four failure categories; a request to "fix" a failing workflow (the correct output is a diagnosis and a handoff, no file edited); a request for the prohibited `continue-on-error: true` (refused with the real fix); and a bare "the pipeline is broken" (one question for evidence, nothing else). At least two probes per agent SHALL be near-miss negatives that belong to a neighbouring agent: a new pipeline from scratch (`ci-configurator`), a failing application run for `ci-parity` (`ci-debugger`), a drift report for `ci-debugger` (`ci-parity`). The `ci-parity` probes SHALL cover each of the five divergence kinds, a stale derived pipeline (the only case the agent may apply), a request to hand-edit the generated pipeline (refused), and one probe of the hand-classification behaviour of R8 (a harness report holding a line the classifier cannot classify, or an `ambiguous` record, where the correct output names the uncertainty and the question that resolves it); that last probe cannot pass at baseline, since no classifier exists then, and SHALL be excluded from the baseline comparison and judged on the final run only. The contributor SHALL run every probe three times, each in a fresh context, against the unchanged and the rewritten agent; a probe passes when at least two of its three runs meet the pass criterion. The contributor SHALL report the three results per probe and side on the logbook. The rewrite SHALL be kept only when no probe that passed at baseline fails at the end; a probe that fails SHALL be fixed by revising the description first, then the body.
3. **R3 (where ci-debugger references live).** The failure taxonomy and the prohibited-fix list SHALL move to two new files in the `github-actions` skill, `references/ci-failure-taxonomy.md` and `references/ci-fix-anti-patterns.md`, and `SKILL.md` of that skill SHALL gain one pointer line to them so that they are reachable from the body. The reason SHALL be recorded on the logbook: an agent compiles to one flat file per CLI and cannot ship a `references/` directory; the agent already requires the `github-actions` skill, so the references sit where the agent already looks; a new skill for them would be a paired skill, which is out of scope; a build change that lets agents ship files is out of scope and disproportionate for two files. The change to the skill SHALL be additive: no other line of its content is rewritten, because the skill's own modernization is owned by another ticket. `ci-debugger` SHALL cite the files as `<github-actions-skill-dir>/references/...`, never as a bare `references/...` or `scripts/...` path.
4. **R4 (content of the references).** Both files SHALL keep every category and every prohibited fix of the current agent with its symptoms, its typical fixes and its reason, and SHALL keep the category names verbatim, because they are searched in logbook issues. A category or prohibited fix that duplicates an existing `github-actions` reference (permissions scoping, action pinning, caching keys, `concurrency:`) SHALL be reduced to a pointer to that reference rather than restated, and each reduction SHALL be listed on the logbook. Each file longer than 100 lines SHALL open with a table of contents. Neither SHALL carry a spec, requirement or issue citation.
5. **R5 (ci-debugger body).** The `ci-debugger` body SHALL be at most 110 lines and SHALL keep: the stance (evidence before hypothesis, no workaround that crosses a quality line, the user decides whether to accept a cost); the accepted inputs with the rule that the first reply to a bare "it is broken" is a single question; the four-step protocol (symptom, hypothesis, evidence, fix) with at most one worked example; the simulation fallback with its reason; the output discipline; and the handoffs. It SHALL tell the model to read the taxonomy file before it names a hypothesis category and the prohibited-fix file before it proposes a fix. The activation list SHALL leave the body, since the description carries it. When the skill or the reference files are not installed, the body SHALL say to continue with the four-step protocol, name the missing file in the reply, and not invent a category list.
6. **R6 (ci-debugger description).** The `description` SHALL state that the agent diagnoses a failing GitHub Actions run and returns a symptom, hypothesis, evidence and fix chain without editing any file; give a `Use when` clause with trigger terms (failed or red workflow run, `gh run view`, job queued too long, `Resource not accessible by integration`, cache miss, secret empty, OIDC or permission error, flaky step, workflow that broke after an action bump); and give a `Not for` clause naming `ci-configurator` (new pipeline), `developer` (applying the fix), `ci-parity` (drift against the capability reference) and GitLab pipelines. It SHALL be at most 1,024 characters and SHALL NOT say the agent fixes.
7. **R7 (classifier script).** A repository script `scripts/classify-ci-drift.ts` SHALL read the output of the drift-check harness as one merged stream, standard output and standard error together (the harness is run with `2>&1`), from a file path or from `-` for standard input, and classify its divergence records. A **divergence record** is exactly one of: a `DRIFT: <message>` line (indented two spaces) together with the lines that directly follow it indented by four spaces (the dumped output of the composed generator check), taken as one record; or a `- <error>` bullet (indented two spaces) that follows a `FAILED: <n> reference-validity violation(s)` header, up to the next blank line. Every other line is a **structural line** and SHALL be ignored, never reported and never `unclassified`: the `OK:` line, the validity header and its closing prose lines, the `FAILED: <n> CI parity violation(s) detected` footer, and blank lines. For each record the script SHALL print: the verbatim record text, a `kind` among `stale-derived-pipeline`, `reference-drift`, `hand-authored-drift`, `evidence-less-exception`, `untraceable-job` or `unclassified`, the capability `id` and the `engine` (`github-actions`, `gitlab` or `reference`) when the record names them, an `action` of `auto` for `stale-derived-pipeline` and `propose` for every other kind, and the reconcile guidance for the kind. `unclassified` SHALL be used only for a record that matches no kind rule. The `ambiguous` field is `true` exactly when the kind is `hand-authored-drift`, and then carries the fixed question "Is the reference or the pipeline job the intended truth for capability `<id>`?"; it is `false` for every other kind and is never derived from anything else. A record that is a validity bullet is `reference-drift` on engine `reference`; the composed generator failure is `stale-derived-pipeline` on engine `gitlab`; an `untraceable job` record is `untraceable-job`; a record naming a missing `exception.engine` or `exception.evidence` is `evidence-less-exception`; every other record that names `capability '<id>' (github-actions)` or `(gitlab)`, or a portable capability absent from a platform, is `hand-authored-drift`. Exit codes: `0` when the input holds no record and an `OK:` line; `1` when it holds at least one record, whether or not an `OK:` line is also present (a record always wins, and a mixed input adds a `mixed-input` warning finding); `2` on a usage error; `3` when the input is unreadable, holds no record and neither an `OK:` line nor a `FAILED:` footer, or holds a line beginning `Error:` (the harness aborted before a verdict; the finding names that line). The script SHALL follow, by analogy, the script contract of `docs/skill-authoring-standard.md` (section *The script contract*, items 2 to 4, which govern skill scripts while this is a repository script): `--help` exits `0`; `--json` prints one object `{ok, data, findings}` on standard output with human text on standard error, `ok` true exactly when the exit code is `0`; `data` holds the records and their count; on exit `1` `findings` holds one error finding per record with `rule` set to its `kind` and `message` stating the reconcile guidance; on exits `2` and `3` it holds one finding with `rule` `usage` or `precondition` and `data` is `null`. `--kinds` SHALL print the five kinds with their definition and reconcile guidance and exit `0`. The script reads and writes nothing else and makes no network call. It SHALL NOT be bundled into a skill, because the harness does not ship to adopters.
8. **R8 (ci-parity body).** The `ci-parity` body SHALL drop its two tables of kinds and reconciliations and keep: the role and persona; the offline, definitions-only boundary; the harness command, run with its two streams merged, and its fail-closed meaning; the instruction to run the classifier on the harness output and to classify an `unclassified` or `ambiguous` record by hand, naming the question that resolves it; the autonomy boundary with its reason (only the regenerate-and-re-verify of a stale derived pipeline is applied, a re-run that is not clean means a misclassification, every other change is proposed and left to the contributor, hand-editing the generated pipeline is never a reconciliation); the four-link output chain; and the handoffs. Every `scripts/...` path cited in the body SHALL sit inside a repository-only fence, so the agent-citation check passes. The `description` SHALL state what the agent does, give a `Use when` clause with trigger terms (drift check red, `check-ci-parity` failed, reference and pipeline diverge, stale generated `.gitlab-ci.yml`, untraceable job, `ci-capability` annotation) and a `Not for` clause naming `ci-configurator` and `ci-debugger`, within 1,024 characters.
9. **R9 (no tools allowlist).** Neither agent SHALL declare `metadata.tools`. `ci-debugger` runs `gh` and `glab` read commands and a bundled simulation script, and `ci-parity` runs the harness and regenerates a file, so both classes include `execute` and the allowlist rule of `docs/authoring.md` admits no allowlist for them; an allowlist would also withhold the `Skill` tool the agents rely on. The read-only intent of `ci-debugger` SHALL instead be a plain statement in its body and its description that it edits no file, and the decision SHALL be recorded on the wave checklist of the parent ticket alongside the declined `pr-reviewer` and `architect` allowlists.
10. **R10 (friction and duplication).** Each agent SHALL end with one line pointing at the `harness-report` skill for a friction met in the workflow, and SHALL NOT cite `config/TOOLS.md`. Text that restates the `github-actions` or `gitlab-ci` skill (patterns, security defaults) SHALL be removed from both bodies in favour of naming the skill.
11. **R11 (classifier tests).** `scripts/classify-ci-drift.ts` SHALL have automated tests that run with no network and cover: a fixture per kind, taken from real harness messages; the clean `OK:` input (exit `0`); the `ambiguous` field set for `hand-authored-drift` and unset for every other kind, with its fixed question; a mixed `OK:` and `DRIFT:` input (exit `1` with the `mixed-input` warning); a record matching no rule (`unclassified`, exit `1`); full real-shaped harness output with its header, prose, continuation and footer lines, which SHALL yield only the expected records and no `unclassified` one; non-harness input, an `Error:` line and an unreadable path (exit `3`); a usage error (exit `2`); the `--json` shape on each of exits `0`, `1`, `2` and `3`; `--help`; `--kinds`; and standard input. A drift-guard test SHALL enumerate the harness message families by a static scan of the source under `scripts/lib/ci-parity/`: every `fail(` call site, and every string pushed onto the validity errors, reduced to its normalized template (the literal text with each `${...}` replaced by a placeholder). A fixture file SHALL hold at least one sample line per normalized template. The test SHALL fail when a call site has no sample, when a sample matches no call site, and when any sample is classified `unclassified`, so that a new, removed or reworded harness message fails the test rather than silently degrading the agent. The harness itself is not changed.
12. **R12 (packaging and checks).** Both agent sources and the `github-actions` skill source SHALL bump `metadata.provenance.version`, and the built components SHALL be regenerated in the same change. The following SHALL pass: `task check-description-length`, `task check-agent-script-citations`, `task check-agent-profiles`, `task check-metadata-keys`, `task check-skill-versions`, `task check-components`, and `task check-skill-quality -- github-actions` with no new finding (the skill linter does not lint agent sources, so the agent-side checks above and the probe set of R2 stand in for it). The CLI matrix SHALL stay untouched unless a change here touches a CLI integration point.

## Scenarios

### Happy path: stale derived pipeline

- **Given** a harness report whose only divergence is the composed `build-ci.ts --check` failure,
- **When** `classify-ci-drift.ts` reads it,
- **Then** it prints one record of kind `stale-derived-pipeline` with `action: auto`, exits `1`, and `ci-parity` regenerates, re-runs the harness and shows the `OK:` line.

### Happy path: ci-debugger diagnoses and hands off

- **Given** a failed run whose log shows `Resource not accessible by integration` on a `GITHUB_TOKEN` call,
- **When** the user asks `ci-debugger` to fix it,
- **Then** the reply is the symptom, a hypothesis naming the `Permission denial` category, quoted evidence and one fix, no file is edited, and the follow-on edit is handed to `developer`.

### Happy path: clean harness

- **Given** harness output that ends in `OK:`,
- **When** the classifier reads it,
- **Then** it prints no record and exits `0`.

### Failure path: unknown harness message

- **Given** a `DRIFT:` record that matches no kind rule,
- **When** it runs,
- **Then** the record comes back as `unclassified` (structural lines such as the footer never do), the exit code is `1`, and `ci-parity` classifies it by hand or states the question it cannot resolve.

### Failure path: input is not harness output

- **Given** a file with no record, no `OK:` line and no `FAILED:` footer, or a harness `Error:` line,
- **When** the classifier reads it,
- **Then** it exits `3` with a precondition finding and prints no record.

### Failure path: judgment-bearing divergence

- **Given** a hand-authored job whose steps diverge from its capability,
- **When** `ci-parity` handles it,
- **Then** it proposes the change, states that it applied nothing, and names whether it believes the reference or the job is the intended truth.

### Failure path: prohibited fix requested

- **Given** a user who asks `ci-debugger` to add `continue-on-error: true` to a flaky step,
- **When** the agent answers,
- **Then** it declines, gives the reason and the real fix from the prohibited-fix reference.

### Failure path: reference files not installed

- **Given** an installation without the `github-actions` skill,
- **When** `ci-debugger` diagnoses a failure,
- **Then** it follows the four-step protocol, says which reference file it could not read, and does not invent a category list.

### Failure path: rewrite regresses a probe

- **Given** a probe that passed at baseline fails after the rewrite,
- **When** the contributor revises the description, then the body,
- **Then** the probes stay unchanged and, if the probe still fails, the results go to the user for decision.

## Out of scope

- The `github-actions`, `gitlab-ci` and `security` skills, and the `ci-configurator` and `security` agents, which have their own tickets. This work only adds two reference files and one pointer line to `github-actions`.
- Making `ci-debugger` or `ci-parity` read-only through `metadata.tools` (R9).
- A build change that lets an agent ship `references/` or `scripts/` beside its flat file.
- A GitLab variant of `ci-debugger`.
- An eval runner for agents, and any change to the skill linter or the eval runner.
- Changing the drift-check harness, its messages or its exit codes.

## Open questions

- Decided (AUTO): sequencing. The implementation of this spec starts after the `github-actions` rewrite (#1939) has merged, because both edit the `github-actions` `SKILL.md` and its version; the spec-PR itself is independent.
- Decided (AUTO): `docs/ci-agent-probes.md` is the home of the probe set.
- Decided (AUTO): whether the new script and its tests need CI path-filter entries is settled at PLAN time against the three-surface CI budget.
- Decided (AUTO): confirmed. Neither source carries a friction paragraph, so R10 adds the one-line `harness-report` pointer instead of replacing text.
