---
id: "0061"
slug: antigravity-gemini-md-concat
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 461
version: 1.0.0
---

# Antigravity CLI — generate ~/.gemini/GEMINI.md from context files

## Intent

After running the Antigravity CLI setup, the layered configuration
selected by the user is active in the runtime — not just stored in a
staging directory. Antigravity CLI reads a single system context file
(`~/.gemini/GEMINI.md`); the setup script generates that file by
concatenating the priority-ordered context sections in order, with
clearly-labelled separators between each section.

## Requirements

1. `scripts/setup-antigravity-interactive.sh` SHALL generate
   `~/.gemini/GEMINI.md` at the end of every successful setup run that
   deploys at least one context file to `~/.gemini/antigravity-cli/`.
2. The generated `~/.gemini/GEMINI.md` SHALL contain the content of each
   deployed context file from `~/.gemini/antigravity-cli/`, concatenated
   in lexical (priority-number) order.
3. Each section in `~/.gemini/GEMINI.md` SHALL be preceded by a separator
   comment of the form `<!-- crewrig-section: <filename> -->` on its own
   line, where `<filename>` is the basename of the source file
   (e.g. `00_SOUL.md`).
4. The individual files under `~/.gemini/antigravity-cli/` SHALL be
   retained after generation; they are the authoritative per-section
   source and enable future re-generation without re-running the full
   interactive flow.
5. When the user chooses "keep" on an existing configuration
   (idempotency path), the script SHALL regenerate `~/.gemini/GEMINI.md`
   from the current `~/.gemini/antigravity-cli/` files rather than
   skipping generation.
6. The script SHALL NOT write `~/.gemini/GEMINI.md` if
   `~/.gemini/antigravity-cli/` contains no `*.md` files after the
   setup run.
7. The final summary block printed by the script SHALL report the path of
   the generated `~/.gemini/GEMINI.md` and its total line count.

## Scenarios

**Scenario:** Fresh setup — GEMINI.md generated

Given a clean environment with no prior configuration,
  the user runs the setup script and selects a level, expertise, and
  team, and opts in to the library tier
When the script completes
Then `~/.gemini/GEMINI.md` exists,
  its content is the concatenation of the deployed `*.md` files from
  `~/.gemini/antigravity-cli/` in lexical order,
  each section is preceded by a `<!-- crewrig-section: <filename> -->`
  comment,
  and `~/.gemini/antigravity-cli/` still contains the individual files.

**Scenario:** Re-run with "keep" — GEMINI.md regenerated

Given an environment where the script has already run and
  `~/.gemini/antigravity-cli/` contains existing files
When the user runs the script again and chooses "keep"
Then `~/.gemini/GEMINI.md` is regenerated from the current files in
  `~/.gemini/antigravity-cli/`,
  the individual files are not modified,
  and the script exits zero.

**Scenario:** Re-run with "refresh" — GEMINI.md regenerated from new selection

Given an environment with an existing configuration
When the user runs the script and chooses "refresh",
  then selects a new team and level
Then the old individual files are removed from `~/.gemini/antigravity-cli/`,
  new ones are deployed,
  and `~/.gemini/GEMINI.md` is regenerated from the new set of files.

**Scenario:** No context files after run — GEMINI.md not written

Given `~/.gemini/antigravity-cli/` contains no `*.md` files after
  the setup run
When the script reaches the GEMINI.md generation step
Then `~/.gemini/GEMINI.md` is not written or overwritten,
  and the script exits zero.

## Out of scope

- Modifying `~/.gemini/GEMINI.md` for the Gemini CLI setup path — that
  script has its own deployment contract and is not affected.
- Detecting or merging content from a pre-existing `~/.gemini/GEMINI.md`
  that was not produced by this script — the file is overwritten on
  every generation pass.
- Updating `docs/cli-matrix.md` — the implementation PR carries this
  obligation per `AGENTS.md` CLI Matrix Maintenance.

## Open questions

_None blocking spec approval._
