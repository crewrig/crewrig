---
id: "0272"
slug: cli-matrix-generated-from-rows
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1729
version: 1.0.0
---

# Generate the CLI matrix from one source file per row

## Intent

`docs/cli-matrix.md` is a 234,555-byte file whose rows reach 9.4 KB on a single
physical line, 68 of its lines exceed 1 KB, and 57% of commits touch it because
its trigger list covers nearly every path. After this spec, a contributor reads
or edits one feature row in a small file of its own, prints a single row with
one command, and the published `docs/cli-matrix.md` stays at its path, in its
current reading order, assembled from those sources and proven fresh by a check;
the matrix is updated only when a change actually alters a CLI integration
point. It is work package WP4a of the epic #1724 (sections 3, 4 and 6); no row
changes meaning and no parity gap is closed.

## Requirements

Paths: sources live under `docs/cli-matrix/`; the published file is
`docs/cli-matrix.md`. Sizes are bytes as reported by `wc -c`. A **physical
line** is a run of characters ended by a newline. The **row ids** are the ids of
the first column today (`1`, `2`, `3`, `4`, `4b`, `4c`, ... `37e`, `37f`, `44`).

1. `docs/cli-matrix/` SHALL hold the source of truth. Each feature row SHALL
   have one Markdown file `docs/cli-matrix/rows/<id>.md` rendering the row as a
   level-1 heading carrying the id and the feature name (`# 4b — title`, the separator being an em dash, U+2014, in every row heading),
   followed by one bullet
   per field: *Source of truth*, then one bullet per CLI column in the order
   Claude Code, Gemini CLI, Copilot CLI, Antigravity CLI.
2. The other parts of today's file SHALL be separate source files with these fixed names under `docs/cli-matrix/`, which together with the rows are the complete input of the generator: `intro.md` (the H1 `# CLI Support Matrix`, the `crewrig-doc` marker line and the opening prose, up to the `## Supported CLIs` heading), `supported-clis.md` (that heading and one bullet per CLI, replacing its table), `feature-matrix.md` (the `## Feature matrix` heading and its lead sentence "One row per integration point. ..."; it holds no row), `notes.md` (the prose notes that follow the feature table, up to `## Parity gaps`), `parity-gaps.md` (the `## Parity gaps` heading, its preamble, and one list item per gap), and `adding-a-cli.md` (the `## Adding a new CLI` section to the end of the file). Every one of these files except `intro.md`, which already starts with the H1, and every row file SHALL start with a level-1 heading line, so that the repository markdownlint rule MD041 passes on each source with its default configuration; no markdownlint ignore, override or exclusion SHALL be added for `docs/cli-matrix/**`. The generator SHALL emit that first heading demoted by a fixed per-part offset, and every deeper heading inside the part by the same offset: row files +2 (`# 4b — title` becomes `### 4b — title`), and `supported-clis.md`, `feature-matrix.md`, `parity-gaps.md` and `adding-a-cli.md` +1 (so their level-1 line is emitted as `##`, matching today's headings). `notes.md` has no heading in today's file: its level-1 line is a source-only title that the generator consumes without emitting it, the one exception to the offset rule.

3. Every cell SHALL be hard-wrapped on whitespace so that no physical line of
   any source file or of the generated file exceeds 1,024 bytes; the target is
   120 columns wherever whitespace allows, and an unbreakable token such as a
   URL MAY exceed 120 columns but SHALL NOT approach 1,024 bytes. A *Parity
   gaps* item SHALL wrap with indented continuation lines.
4. Row order SHALL be set by an explicit ordered manifest,
   `docs/cli-matrix/order.txt`, one source basename per line, and not by a sort.
   The manifest lists, in this fixed assembly order: `intro.md`,
   `supported-clis.md`, `feature-matrix.md`, every row file in today's row order,
   `notes.md`, `parity-gaps.md`, `adding-a-cli.md`. Justification: today's row
   order is not a natural sort of the ids, and the id `7g` appears on two rows
   (MemPalace layered wake-up, and custom root-CA delegation, spec 0084). The
   two rows SHALL be kept as distinct row files, the second named `7g-2.md` (its
   heading keeps the id `7g`), so that the generated order and ids are
   byte-identical to today's. The generator SHALL join the parts with exactly one
   blank line, and SHALL fail when a file under `docs/cli-matrix/` or
   `docs/cli-matrix/rows/` is absent from the manifest or a manifest line has no
   file. The valid row ids of requirement 8 are the headings of the row files so
   listed.

5. `scripts/build-cli-matrix.ts` SHALL assemble `docs/cli-matrix.md` from the
   source files, running under the Node 24 type-stripping floor like its sibling
   scripts, with no dependency beyond Node's standard library. The generated file
   SHALL carry an HTML comment stating it is generated and MUST NOT be edited by
   hand, naming the source directory and the build command. Its position SHALL be
   after the `crewrig-doc` marker: the H1 stays on line 1 and the marker on line
   3, as today, because the docs-index extractor reads the first line containing
   `crewrig-doc:` after the first level-1 heading (`scripts/lib/docs-index/extract.ts`);
   the generated-file comment follows the marker on line 5. The generator emits
   that comment itself, inserting it, followed by one blank line, after the blank
   line that follows the marker line of `intro.md` (so the comment is line 5 and
   the lead paragraph starts on line 7); `intro.md` holds the H1, a blank line,
   the marker, a blank line and the lead paragraph, and carries no
   generated-file comment of its own. The marker value is unchanged.
6. The generator SHALL have two modes: write (default) and `--check`. `--check`
   SHALL exit non-zero, and print a hint naming the first differing line and
   the command that regenerates, when the checked-in file differs from the
   assembly; it SHALL exit 0 and write nothing otherwise.
7. The generator SHALL be idempotent and byte-deterministic: two runs produce
   identical bytes, the result does not depend on `LC_ALL`, the locale, the
   working directory, the platform, or the line endings of the checkout, and the
   output uses `\n` only. The output SHALL end with exactly one newline.
8. `Taskfile.yml` SHALL gain `cli-matrix:build` (write), `cli-matrix:check`
   (`--check`) and `cli-matrix:row`. `task cli-matrix:row -- <id>` SHALL print
   exactly the content of that row's source file and exit 0; for an unknown id
   it SHALL print the list of valid ids on stderr and exit non-zero. The valid
   ids are read from the manifest.

9. A freshness job running `task cli-matrix:check` SHALL be added to the
   platform-neutral CI reference `ci/ci-capabilities.yml`, following
   `docs/ci-reference-format.md` and its drift-check contract, and the compiled
   outputs (`.github/workflows/*.yml`, `.gitlab-ci.yml`) SHALL be regenerated
   from it in the same diff and shown clean by `scripts/check-ci-parity.ts`. A
   stale `docs/cli-matrix.md` SHALL fail that job.
10. Every CI path filter that names `docs/cli-matrix.md` (today in
    `ci/ci-capabilities.yml` at four places, `.gitlab-ci.yml`,
    `.github/workflows/build.yml` and `.github/workflows/usage-capture.yml`)
    SHALL also match `docs/cli-matrix/**` and `scripts/build-cli-matrix.ts`, so
    that an edit of a row source cannot skip a job the published file triggers.

11. The content SHALL move in two separate commits. The first SHALL place every
    cell verbatim, unwrapped, in its source file, with the generator already
    reproducing today's `docs/cli-matrix.md` modulo the table-to-bullet change;
    "verbatim" means verbatim after table-cell unescaping, each `\|` of a table
    cell becoming `|` in the bullet (nine occurrences at the base commit). The
    second SHALL only wrap lines and change no word. Source files carry links
    relative to their own location so that `scripts/check-markdown-links.ts`
    passes on them; the generator SHALL rewrite those links to the `docs/`-relative
    form so that the generated file reproduces today's links byte for byte.

12. A verification procedure, recorded in the logbook with its output, SHALL
    show for every row and every cell that the whitespace-normalised text in
    `docs/cli-matrix.md` at the base commit, with `\|` unescaped to `|` first, equals the whitespace-normalised text
    of the matching bullet in the new source (headings compared after applying
    the offsets of requirement 2, the source-only title of `notes.md` excluded), for the *Supported CLIs*
    cells, for each *Parity gaps* item, and for the prose notes. Every
    `[GAP...]` entry and every `[measured: ...]` token present at the base commit
    SHALL be present afterwards, with the same count. No rule, cell or gap SHALL
    be lost or reworded.

13. `scripts/tests/hook-command-matrix.test.ts` SHALL keep passing, reading the
    rows 37e and 37f from their row source files after whitespace
    normalisation (the `[measured: key=value; ...]` token SHALL stay a single
    unbroken run once newlines are folded into spaces) instead of looking for the
    `| id |` line prefix. Its negative fixtures SHALL be updated to the new row
    shape and SHALL still reject zero or several tokens.
14. `scripts/tests/e2e-defaults-config.test.ts` SHALL keep passing: its scenario
    names SHALL be searched in the generated `docs/cli-matrix.md` read as one
    whitespace-normalised text, so that a name split by a wrap is still found,
    or in the row sources, and the test SHALL be edited only for that reading.
15. `docs/cli-matrix.md` SHALL remain at its path, listed in `docs/index.json`
    with an unchanged entry. Every inbound link to it, including those that cite
    a row (for example `artifacts/library/skills/user-validate/SKILL.md`, which
    cites rows 27 and 27b), SHALL stay valid; any anchor that the new headings
    would break SHALL be updated at its source. Edits under `artifacts/` SHALL
    bump `metadata.provenance.version` and SHALL regenerate built outputs with
    `node scripts/lib/node-floor-guard.js` then `node scripts/build-components.ts`
    in the same commit. `scripts/check-markdown-links.ts` SHALL pass.
16. The new core paths (`docs/cli-matrix/**`, `scripts/build-cli-matrix.ts`)
    SHALL be classified in `.crewrig/core-paths.txt` and `docs/layers.md` in the
    same diff, and `scripts/check-core-paths.ts` SHALL pass. New documentation
    files SHALL carry whatever publication marker `docs/publication-contract.md`
    requires, source fragments being unpublished.

17. `docs/cli-matrix-maintenance.md` SHALL own the trigger surface and define it
    in full, as the set of CLI integration points, and neither it nor `AGENTS.md`
    SHALL list `artifacts/**`, the generic `scripts/*`
    globs and `CLAUDE.md`/`GEMINI.md` as triggers. `AGENTS.md` SHALL carry only a pointer to that document and a one-line summary of the classes below, not the path list. A pull request SHALL update
    the matrix only when its diff touches one of:
    - a deploy target, meaning where setup, install, link or import scripts place
      files for a CLI: `scripts/setup-*-interactive.ts`, `scripts/setup-playwright-mcp.ts`,
      `scripts/link-extensions.ts`, `scripts/lib/setup/**` (80 tracked files, counted
      with `git ls-files`; included on purpose because it holds the per-CLI setup
      deploy logic),
      `scripts/lib/packaging/sync-manifests*.ts`,
      `scripts/install-*.ts`, `scripts/import-*-history.ts`,
      `scripts/manage-*-component.ts`, `scripts/manage-workspace-component.ts`,
      `scripts/lib/install/**`, `scripts/lib/manage/**`,
      `scripts/lib/link-or-copy*.ts`;
    - hook wiring: `hooks/*-hooks.json`, `hooks/*.ts` (the hook entry points), `scripts/lib/transcript-recognition.ts`,
      `scripts/lib/hook-*.ts` (today `hook-command`, `-config`, `-descriptor`,
      `-guard-manifest`, `-antigravity*`, `-transcript-*`, `-registry`, `-rewrite`,
      `-statusline`, `-recognition`) and `scripts/lib/transcript-hook-rewrite.ts`;
    - CLI-specific build output: `scripts/build-components.ts` and
      `scripts/lib/build-components/**` where a per-CLI emitter changes, plus
      `scripts/build-claude-plugin.ts`, `scripts/build-copilot-plugin.ts`,
      `scripts/build-antigravity-extension.ts`, `scripts/build-extension.ts`;
    - CLI roots and settings: `.claude/**`, `.gemini/**`, `config/claude/**`,
      `config/gemini/**`, `config/copilot/**`, `extensions/**`,
      `.github/workflows/claude.yml`, `.github/workflows/copilot.yml`;
    - a parity gap: any addition, removal or change of a `Parity gaps` item;
    - a CLI-prefixed entry of `Taskfile.yml` or `.gitignore`.
    The list is confirmed at DEV time: the plan stage fixes the grep command
    and the implementation runs it over the repository, pastes its output in the
    logbook, and adds any path found that belongs to one of the six classes and
    is missing.
18. The obligation sentence SHALL read that the contributor edits the affected
    row file under `docs/cli-matrix/` and runs `task cli-matrix:build`, never
    editing `docs/cli-matrix.md` by hand. The *Gap-acceptance evidence rule*,
    the *Parity check*, the *Protocol-only exemption* and the *Symmetric-script
    rule* SHALL keep their present meaning, wording changes being limited to the
    trigger list and to naming the new file locations.
19. The `AGENTS.md` summary of the matrix section SHALL shrink to a pointer to
    `docs/cli-matrix-maintenance.md` plus a one-line summary of the trigger classes
    and the critical rule. The *Core-paths manifest co-maintenance* paragraph
    that follows it SHALL stay untouched. `AGENTS.md` is
    17,027 bytes today with a threshold of 19,100 in
    `scripts/check-agents-size.ts`; the diff SHALL NOT increase its size, SHALL
    NOT raise the threshold, and SHALL change nothing in `AGENTS.md` outside the
    matrix section.

20. After the change, these SHALL hold and be recorded in the logbook next to the
    before values (longest line 9.4 KB, 68 lines over 1 KB, file 234,555 bytes):
    `grep -rn . docs/cli-matrix.md docs/cli-matrix/ docs/cli-matrix-maintenance.md | awk 'length($0) > 1024'`
    prints nothing; `task cli-matrix:check` exits 0; `task cli-matrix:row -- 37e`
    prints one row; the largest file under `docs/cli-matrix/` and the size of
    `docs/cli-matrix.md` are reported.
21. The share of commits touching `docs/cli-matrix.md` or `docs/cli-matrix/`
    SHALL be measured over the month following the merge, with a target below
    20%; this is an observation and not a merge gate.
22. The spec linter, the markdown-link check, the version-bump check, the
    typecheck, the test suite and every `*-ci-wiring` test SHALL pass, none
    disabled or loosened. The change SHALL NOT ship in the same pull request as
    any other work package of epic #1724.

## Scenarios

**Scenario:** A row is printed alone

Given the source directory is built
When  a contributor runs `task cli-matrix:row -- 37e`
Then  exactly the content of `docs/cli-matrix/rows/37e.md` is printed and the exit code is 0

**Scenario:** Unknown row id

Given no row has the id `99`
When  a contributor runs `task cli-matrix:row -- 99`
Then  the exit code is non-zero and stderr lists every valid id from the manifest

**Scenario:** A stale published file fails the check

Given a row source is edited and `docs/cli-matrix.md` is not regenerated
When  `task cli-matrix:check` runs, locally or in CI
Then  it exits non-zero, names the first differing line, and prints `task cli-matrix:build` as the fix

**Scenario:** Regeneration is byte-stable

Given `docs/cli-matrix.md` was just generated
When  the generator runs again under `LC_ALL=C` and under another locale, and from another working directory
Then  the bytes are identical and `--check` exits 0

**Scenario:** Order and duplicate id are preserved

Given the two rows that carry the id `7g`
When  the matrix is generated
Then  both appear, in today's order, as `7g.md` and `7g-2.md`, and removing one from the manifest makes the generator fail

**Scenario:** No content is lost by the move

Given the verbatim commit and the wrapping commit
When  the whitespace-normalised cells of the base commit are compared with the new sources
Then  every cell, every parity-gap item, every `[GAP...]` entry and every `[measured: ...]` token matches, and any difference fails the comparison

**Scenario:** The measured-token test survives wrapping

Given row 37f has its long cell wrapped over several lines
When  `scripts/tests/hook-command-matrix.test.ts` runs
Then  it reads exactly one `[measured: ...]` token per row 37e and 37f and passes

**Scenario:** A row-source-only change still runs CI

Given a pull request changes only `docs/cli-matrix/rows/5b.md`
When  the path-filtered jobs are evaluated
Then  every job that is triggered by `docs/cli-matrix.md` is triggered, and the freshness job fails if the published file was not regenerated

**Scenario:** An unrelated artifact edit does not trigger the matrix duty

Given a pull request edits only a skill body under `artifacts/library/skills/`
When  a reviewer applies the trigger surface of requirement 17
Then  no matrix update is required

**Scenario:** A hook-wiring edit does trigger it

Given a pull request edits `hooks/claude-usage-capture-hooks.json`
When  a reviewer applies the trigger surface
Then  the matrix must be consulted and the affected row file updated in the same diff

**Scenario:** Wrapping a row would split a token

Given a cell contains a URL longer than the target width
When  the wrapping commit is produced
Then  the URL stays on one line, still far under 1,024 bytes, and the whitespace-normalised text is unchanged

## Out of scope

- Changing the meaning of any row, adding or removing a feature row, or closing any parity gap.
- Work packages WP4b and WP4c (the other documents of the epic) and every other work package of epic #1724.
- Rewriting `AGENTS.md` beyond its matrix section, or changing the gap-acceptance evidence rule and the symmetric-script rule.
- Changing the published location, title or navigation order of `docs/cli-matrix.md`.
- A rendered HTML or site view of the matrix.

## Open questions

- [AUTO-PARKED] Whether the Windows checkout (`core.autocrlf`) rewrites the generated file: requirement 7 makes the generator independent of input line endings, but a `.gitattributes` `eol=lf` entry for `docs/cli-matrix*` may be needed so `--check` is stable on Windows; the plan stage tests it on a Windows runner.
- [AUTO-PARKED] The exact set of paths in requirement 17 is derived from today's tree; the DEV stage greps for per-CLI emitters and deploy scripts added since and adjusts the list, keeping the six classes fixed.
- [AUTO-PARKED] Whether other documents or skills quote a row by a table-style anchor: requirement 15 says to update them, the plan stage lists the hits of `git grep -n 'cli-matrix.md#'`.
- Decision (AUTO): row order comes from an explicit manifest, not a sort, because the current order is not a natural sort and has a duplicate id.
- Decision (AUTO): rejected alternative, one YAML file per row rendered into the existing table: a Markdown table row cannot be split across physical lines, so the 1 KB line cap would be unreachable, and the reading experience for the long cells would not improve.
- Decision (AUTO): rejected alternative, keeping the table and only narrowing the trigger list: it leaves the 9.4 KB lines and the single-file merge-conflict hotspot untouched.
- Decision (AUTO): rejected alternative, splitting `docs/cli-matrix.md` into several published pages: it would break the many inbound links and the `docs/index.json` entry for no gain over generation.
- Risk: CI path filters lagging behind the new directory (mitigated by requirements 9 and 10 and the row-source scenario); tests that parse the matrix breaking on wrapped cells (requirements 13 and 14); Windows line endings making the freshness check flap (requirement 7 and the first parked question); a large one-time diff that hides a lost word (requirements 11 and 12).
