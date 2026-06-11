---
id: "0007"
slug: build-install-spec-author
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 174
version: 1.0.0
---

# Build and install verification for the spec-author skill

## Intent

Contributors gain a reusable Taskfile sanity-check command and a brief
documentation note confirming that the `spec-author` skill and its
matching slim agent are distributed symmetrically across the three
supported command-line interfaces (Claude / Gemini / Copilot) so the
build pipeline's correctness can be verified in one shell call instead
of three manual directory inspections.

## Requirements

1. A new `Taskfile.yml` target named `skill:check` SHALL be added; it
   takes a parameter `NAME=<skill-name>` and verifies that the named
   skill has been built symmetrically across the three supported
   command-line-interface output paths: `.claude/skills/<NAME>/`,
   `.gemini/skills/<NAME>/`, and `.github/skills/<NAME>/`.
2. The target SHALL also verify the matching slim agent file when it
   exists, at the three paths `.claude/agents/<NAME>.md`,
   `.gemini/agents/<NAME>.md`, and `.github/agents/<NAME>.md`. Absence
   of an agent file is acceptable (some skills ship without a slim
   agent); presence on one CLI but not the others SHALL be reported as
   a failure.
3. For each found output file, the target SHALL verify:
   (a) the file exists and is non-empty,
   (b) the YAML frontmatter parses as valid YAML, and
   (c) the required fields `name`, `type`, and
       `metadata.provenance.version` are present and non-empty.
4. On any verification failure the target SHALL exit with a non-zero
   status and print a single-line summary identifying which output
   path failed and which check failed.
5. The target SHALL NOT attempt to invoke the skill against a live
   command-line interface; "smoke" verification here is strictly
   file-level (existence, frontmatter parse, required-field
   non-emptiness). Live invocation against Claude / Gemini / Copilot
   APIs is explicitly out of scope.
6. The target SHALL NOT delegate any check to the spec linter
   (tracked under issue #178); the two tools cover different domains
   (build-pipeline distribution vs. spec-file format under `/specs/`)
   and SHALL remain strictly separated.
7. `docs/cli-matrix.md` row 3 (*Skill definitions directory (built
   output)*) SHALL be amended with a brief inline note citing
   `spec-author` as the canonical example of a skill that ships
   symmetrically across all three CLIs via this row's mechanism. The
   matrix SHALL NOT gain a per-skill row; the document remains a
   description of mechanisms, not a registry.
8. The verification target SHALL exercise the `spec-author` skill at
   minimum as part of the acceptance check for this ticket
   (`task skill:check NAME=spec-author` exits zero on a clean
   checkout).
9. No edit SHALL be made to `scripts/build-components.sh`, to the
   `community-config/skills/spec-author/SKILL.md` or
   `community-config/agents/spec-author/AGENT.md` sources, or to any
   already-built output file. Issues #168 and #172 have already
   produced the artifacts; this ticket adds the verification surface
   over them and one matrix note.

## Scenarios

### Happy path — clean checkout, symmetric build

Given a clean checkout of `crewrig/main` at any commit on or after
  the merge of issue #168 (the spec-author skill source) and issue
  #172 (the routing-engine ticket that incidentally republished the
  built outputs)
When a contributor runs `task skill:check NAME=spec-author`
Then the target exits with status `0`
And the standard-output line "spec-author: OK across .claude/,
  .gemini/, .github/" (or equivalent) is printed
And no other side effect is produced (no file written, no commit
  staged, no network call).

### Failure path — build outputs drift across CLIs

Given a contributor has edited
  `community-config/skills/spec-author/SKILL.md` directly without
  running `bash scripts/build-components.sh`
And as a result `.claude/skills/spec-author/SKILL.md` carries
  content older than the community-config source while
  `.gemini/skills/spec-author/SKILL.md` and
  `.github/skills/spec-author/SKILL.md` were not republished either
When the contributor or a CI step runs `task skill:check NAME=spec-author`
Then the target SHALL exit with status `1`
And the printed summary SHALL identify the specific output path
  that drifted (or all three if the build was never run) and SHALL
  point the reader at `scripts/build-components.sh` as the
  remediation
And the CI job that runs this check on every pull request SHALL
  block merge until the build is rerun and the outputs are
  committed.

## Out of scope

- Editing `scripts/build-components.sh` itself. The build pipeline
  is already correct as of the merges of #168 and #172; this ticket
  adds a verification surface over it.
- Live invocation of the skill against Claude, Gemini, or Copilot
  APIs. The acceptance signal is file-level, not API-level (R5).
- Spec format conformance checks for files under `/specs/`. That is
  tracked under the spec-linter ticket #178 (R6).
- A per-skill row in `docs/cli-matrix.md`. The matrix is a
  description of integration mechanisms, not a registry of every
  skill (R7).
- Verification of other skills (`architect`, `pr-reviewer`,
  `developer`, `tester`, etc.). The Taskfile target is generic
  (`NAME=...`) and will work for those skills too, but this ticket's
  acceptance check exercises only `spec-author`.
- Migration of in-flight tickets onto the new lifecycle — tracked
  under issue #175.
- A new CI job that runs `task skill:check` as a backstop. If
  desired later, the existing `check-components` job already gates
  build-output drift on every pull request; adding a per-skill
  smoke check would be redundant. May be revisited if a friction
  pattern emerges where `check-components` passes but
  `task skill:check` would have failed.

## Open questions

(none — all interview questions were resolved at SPECS time.)
