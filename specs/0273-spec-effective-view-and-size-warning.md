---
id: "0273"
slug: spec-effective-view-and-size-warning
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1730
version: 1.0.0
---

# Spec effective view and spec size warning

## Intent

An agent that needs the current requirements of a spec must read the base file
and every delta file, and the two largest specs (0263, 0265) weigh 365 KB and
437 KB. After this spec, `task spec:view -- <id>` prints the base spec and its
deltas as one read-only document, and the spec linter warns, without failing,
when a spec file exceeds 40 KB, while `docs/spec-format.md` explains how to
split an oversized spec. It is work package WP4b of the epic #1724 (sections 3,
4 and 6). Complexity is `small`: one read-only script, one linter warning and one
documentation section, with no change to the delta-spec cumulative rule.

## Requirements

Sizes are bytes as reported by `wc -c`. A **delta** of spec `<id>` is a file
`specs/<NNNN>-<slug>.delta-NN.md` whose frontmatter `id` equals `<id>`.

1. `Taskfile.yml` SHALL define `spec:view`, run as `task spec:view -- <id>`. It
   SHALL run `node scripts/lib/node-floor-guard.js` and then a TypeScript script
   under `scripts/` (Node.js 24 floor, no dependency beyond those the sibling
   scripts use), and SHALL accept the id with or without zero padding (`273` and
   `0273`).
2. The command SHALL write one Markdown document to stdout and nothing else to
   stdout. It SHALL be read-only: it SHALL NOT write, rename or delete any file,
   and it SHALL NOT change the delta-spec cumulative rule, under which the base
   file and the deltas remain the only normative sources.
3. The document SHALL begin with a header naming the spec, the base file, the
   delta files in the order applied, and the cumulative `version` read from the
   highest-numbered delta (the base `version` when there is none).
4. The document SHALL then contain the body of the base spec (everything after
   its frontmatter) byte-for-byte unmodified, followed by one section per delta
   in ascending delta number, each headed `Delta NN` and carrying that delta's
   ADDED, MODIFIED and REMOVED text verbatim and in that order. The view SHALL
   NOT parse, match, mark, rewrite or delete any quoted item: it performs no
   resolution of MODIFIED or REMOVED text, and it SHALL NOT emit any marker or
   any section other than the header, the base body and the delta sections.
5. A reader determines the effective text of a requirement by reading the base
   body and then the delta sections in order; the later delta prevails, per the
   delta-spec cumulative rule, which this command only presents and never applies.
6. For an id with no spec file, the command SHALL print an error naming the id
   on stderr, nothing on stdout, and exit with a non-zero code. For a spec with
   no delta, it SHALL print the header and the base body and exit 0, the header
   stating that there are no deltas.
7. The output SHALL be deterministic: the same files produce byte-identical
   output, with no timestamp and no absolute path.
8. The spec linter (`scripts/lib/spec-linter.js`) SHALL emit a line beginning
   `[WARN]` for each spec or delta file it visits larger than 40960 bytes,
   naming the file and its size in bytes. This holds in every linter mode: full
   scan, path-scoped run (files passed as arguments) and base-branch checks. The warning SHALL NOT change the exit
   code or the error count: a run that passes without it still passes with it.
9. The warning SHALL apply to every visited file regardless of age, including the
   existing `specs/0263-setup-service-tests-typescript.md` and
   `specs/0265-build-checks-tests-typescript.md`, and SHALL NOT fail the run
   for them. This spec SHALL NOT edit, split or exempt those two files.
10. The warning text SHALL point to `docs/spec-format.md` → *Splitting an
    oversized spec*.
11. `docs/spec-format.md` SHALL gain a section *Splitting an oversized spec*,
    stating that: a spec above 40 KB is split into sub-specs, each its own spec
    with its own id and ticket, linked from the parent by an Out of scope or
    Requirements line; a delta is not a way to split, because a delta amends a
    spec and adds to its size, and deltas of a split spec still follow the
    cumulative rule; and `task spec:view -- <id>` is the way to read a spec with
    its deltas. The *Spec linter* section SHALL list the size warning.
12. The change SHALL include automated tests for requirements 1 to 10 (in the
    existing spec-linter and script test locations), the spec linter, the
    markdown-link check, the typecheck, the formatter and the test suite SHALL
    pass, and `docs/cli-matrix.md` SHALL be consulted per `AGENTS.md`.

## Scenarios

**Scenario:** A spec with two deltas

Given a spec `0002` with `delta-01` and `delta-02`
When  `task spec:view -- 0002` runs
Then  stdout holds the header, the base body, `Delta 01` then `Delta 02`, the cumulative version of `delta-02`, and no file has changed

**Scenario:** Deltas are presented verbatim

Given a delta whose MODIFIED section quotes a requirement and gives its replacement
When  the view is rendered
Then  the base body is byte-identical to the base file body, the `Delta NN` section holds the MODIFIED text verbatim, and no marker or `Unresolved` section appears

**Scenario:** Unknown id

Given no `specs/9999-*.md` file exists
When  `task spec:view -- 9999` runs
Then  stdout is empty, stderr names `9999`, and the exit code is non-zero

**Scenario:** A spec without delta

Given a spec with no delta file
When  `task spec:view -- <id>` runs
Then  the output states that there are no deltas, holds the base body, and the exit code is 0

**Scenario:** Oversized spec warns but passes

Given a spec file of 40961 bytes that otherwise lints clean
When  `task spec:lint` runs
Then  a `[WARN]` line names the file and its size, and the exit code is 0

**Scenario:** Existing oversized specs do not fail

Given specs 0263 and 0265 on the branch
When  `task spec:lint` runs
Then  each is named in a `[WARN]` line and the exit code is unchanged

**Scenario:** Path-scoped run warns

Given a spec file of 40961 bytes passed as an argument to the linter
When  `task spec:lint -- <file>` runs
Then  the `[WARN]` line is emitted and the exit code is 0

**Scenario:** Exactly 40 KB

Given a spec file of exactly 40960 bytes
When  `task spec:lint` runs
Then  no size warning is emitted

## Out of scope

- Splitting, shrinking or exempting specs 0263 and 0265, or any other existing spec.
- Making the size warning a failure, or a configurable threshold.
- Editing, rewriting or generating spec files from the effective view; the view is never normative.
- Resolving, marking or applying MODIFIED and REMOVED items inside the view; no quote syntax is parsed.
- Slimming `docs/cli-matrix*` and the other work packages of epic #1724 (WP4a, WP4c and the rest).

## Open questions

- Decision (AUTO): the view does no quote resolution or marking, because delta quote syntax is not uniform (seat findings v1-F1 to v1-F3); it presents base and deltas in order and the cumulative rule alone decides what prevails.
- Decision (AUTO): the threshold is 40960 bytes, the epic's proposal, and a file of exactly 40960 bytes does not warn.
