---
name: pr-reviewer
description: "Audits a pull request cold, without authoring context, for correctness, convention compliance, test coverage and linter findings, then posts a structured verdict (Approve, Request Changes or Comment) with the CI status, a seat line and class-tagged findings. Use when asked to review, audit or approve a pull request or a spec pull request, to give a second opinion on a change, to run a REVIEW pass or to post a verdict. Trigger terms: review PR, code review, audit pull request, verdict, request changes, approve, seat, cold review. Not for writing a pull-request body or logbook entry (pr-logbook), reviewing uncommitted local changes, composing a local commit message or writing a spec (spec-author)."
license: Apache-2.0
compatibility: "Requires Node >= 24 (the scripts are TypeScript files run with node), git and the gh CLI (diff fetch, check status, verdict post). Optional: markdownlint (lint-markdown.ts), ruff or flake8 (lint-python.ts), oxlint and oxfmt (lint-typescript.ts). A missing optional tool degrades to a note, never aborts the review."
allowed-tools:
  - Read
  - Bash
  - Grep
  - Glob
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "2.1.0"
---


# PR Reviewer

Audit a pull request as an independent reader: no authoring context, no shared assumptions, no manufactured objections. A review that approves everything is worthless, and one that invents objections wastes the author's time, so every finding names a file, a line and a reason, and a solid change is approved plainly.

You have no stake in the change. Read the diff as if you had never seen it. Be skeptical but fair: say what is wrong, where and why, or say it is sound.

## How the scripts report

Every script under `scripts/` runs as `node scripts/<name>.ts`, resolved against this skill's directory. Each answers `--help`, prints one `{ok, data, findings}` object with `--json` (human text then goes to stderr), and exits `0` ok, `1` findings, `2` usage error, `3` the environment or an input is unusable. Read the exit code first: `3` never means the change is bad.

## Protocol

Six steps, in order. Skipping ahead is how a review ends up approving a change whose CI is red.

### 1. Preflight: CI status and iteration label

Run `node scripts/ci-preflight.ts <pr> --json` (add `--required` when the repository distinguishes required checks).

- Exit `0`: every check passes; continue.
- Exit `1`: read `data.verdict_ceiling`. A failing check caps the verdict at `REQUEST_CHANGES` (or `COMMENT` when the failure is clearly an infrastructure flake, said explicitly with the job name). A pending check caps it at `COMMENT` with the verdict stated as deferred until CI resolves.
- Exit `3`: gh is unusable; say so in the verdict instead of guessing a status.

Whenever a check was pending during the pass, finish with one direct `ci-preflight.ts` query before composing the verdict. A background task or monitor reporting "done" is a cue to look, not the look itself, because it watches a process from outside the check. To wait, prefer `--wait <attempts> --interval <seconds>`: its last query is the direct one.

The CI status goes into the verdict in writing (pass, fail or pending, with the failing job). On a later pass of the same seat the reading of the diff narrows (step 3), but this step never does: the head's CI state is part of every pass.

Then run `node scripts/iter-label.ts <pr> --json`. Finding identifiers on the `review` surface are minted from the `iter:<N>` label (see *Finding tags*), so the label must exist before the first identifier. Exit `0` gives `data.iter` (and adds `iter:1` itself when none existed). Exit `3` means the label could not be added: state that in the verdict's CI section and mint no identifier under an assumed number.

### 2. Read the project conventions

Read `references/step-2-conventions.md`.

### 3. Fetch the diff and the metadata

Read `references/step-3-fetch.md`. A seated pass is bounded from its second pass onward; `references/seat-obligations.md` holds the seat line, the dossier and the vacancy rules.

### 4. Run the linters

Read `references/step-4-linters.md`.

### 5. Compose the verdict

Read `references/step-5-compose.md` (the seat line's placement per transport is in `references/seat-obligations.md`), then check the body with `node scripts/lint-verdict.ts --surface <review|specs|plan> --transport <review|comment> --ordinal <N> [--prior-ids <ids>] <file>`. Exit `1` lists malformed tags, identifiers or a misplaced seat line: fix them before posting, because a finding without its tag is returned to the reviewer and costs the author a round trip.

### 6. Post the review

Run `node scripts/post-verdict.ts <pr> --event <approve|request-changes|comment> --body-file <file> --dry-run` first, then without `--dry-run`. The script chooses the transport from the posting identity: a formal review when the authenticated login differs from the author, a plain `## Verdict: …` comment when they are the same (GitHub refuses a self-approval), and it refuses a body over 12 KB. Exit `3` with `data.rung` `denied` means the forge refused the post: return the full verdict to the orchestrator and stop. Asking another agent to post it would launder a permission this session was denied.

Before posting, read `references/assert-fresh-observation.md`: observe the artifact you quote immediately before the post.

## Blocking and non-blocking

Mark every finding blocking or non-blocking. Approve when nothing blocks: the loop ends on a pass with no blocking finding (ADR-0024), and non-blocking findings go to the findings ledger (#961) or a follow-up issue, never to another pass. Passes are capped at 2 at `trivial`/`small` and 3 at `standard`; a fix pass reads only the change since the last examined revision.

## Finding tags

Every finding, blocking or not, carries exactly one `class:` line whose value is `tech`, `arch` or `spec`; read `references/shared-finding-class-taxonomy.md` for what each class routes to. Tag each finding individually: a heading above several findings does not tag them. Non-blocking findings need the tag too, because autonomous modes route them through the same matrix as blocking ones.

Each finding also carries an identifier naming the pass that raised it, stable for the life of the seat: `i<N>-F<M>` on the `review` surface, where `<N>` is the `iter:<N>` ordinal from step 1; `s<N>-F<M>` on the `specs` surface, where `<N>` is the seat's pass ordinal counted across every artifact of that surface; `v<N>-F<M>` on the `plan` surface. A lowercase suffix marks a sub-finding (`v1-F2a`). The next pass's prior-finding audit enumerates these identifiers.

A finding on a surface the change did not touch is allowed, but it must say which condition of the step-3 bound returned that surface to scope. Without that statement it is non-blocking and goes to the deferred-findings ledger instead of routing the iteration.

## Linters

`scripts/lint-markdown.ts` (markdownlint), `scripts/lint-skill.ts` (SKILL.md frontmatter keys, version bump against `BASE_REF`, script citations; parsed with `js-yaml` when resolvable, a line scan otherwise), `scripts/lint-python.ts` (ruff or flake8, bare `print(`), `scripts/lint-json.ts` (`JSON.parse` and a trailing-comma heuristic) and `scripts/lint-typescript.ts` (Oxlint type-aware, Oxfmt). Run them as `node scripts/lint-markdown.ts <file>...` on the matching changed files. A missing optional tool prints a note and exits `0`; `--require-tools` turns that into exit `3`. An unreadable input exits `3` before anything is linted.

## Folded-bugs check

On a bug-type issue (`docs/logbook-issues.md`, Rule D), check that a `tech` finding describing a foldable bug cross-references its folded item and the reverse; that the PR body carries a `Folded bugs` entry; that each resolved item has a regression test or a written justification; and that the item-count and added-line caps and the fold tests are respected. A bug folded despite failing a fold test is a `class: tech` finding.

## Spec-review obligation — tier challenge

When reviewing a spec pull request, read `references/spec-review-obligation.md`.

## Grounding

Read `references/shared-grounding-discipline.md`. One rule is specific to review: verify cross-references, line numbers and any claim about the surroundings of a modified file against the file at the PR's head ref, not the local working tree, which may be behind the base and anchor a confidently wrong blocking finding:

```bash
gh api "repos/<owner>/<repo>/contents/<path>?ref=<headRef>" --header "Accept: application/vnd.github.raw"
```

`gh pr diff` alone is insufficient: it shows added lines, not the rule numbering they point to.

## Friction

Read `references/shared-friction-reporting.md`; invoke the `harness-report` skill at the end of the review when a signal fired.
