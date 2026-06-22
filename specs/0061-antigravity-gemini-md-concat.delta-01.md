---
id: "0061"
slug: antigravity-gemini-md-concat
status: draft
complexity: small
interaction-mode: MINIMAL
related-issue: 478
version: 2.0.0
---

# Antigravity CLI — generate ~/.gemini/config/AGENTS.md from context files

## ADDED

(none)

## MODIFIED

**Global path substitution.** Every occurrence of `~/.gemini/GEMINI.md` in
the original spec is replaced by `~/.gemini/config/AGENTS.md`. This applies
to the H1 title above, the Intent, all seven Requirements, and all four
Scenarios.

**Rationale.** The file actually read by Antigravity CLI as its single system
context is `~/.gemini/config/AGENTS.md`; `~/.gemini/GEMINI.md` exists only
for legacy compatibility and is not loaded by the CLI during normal operation.
The original spec was authored against incorrect documentation.

The replacement produces the following effective texts for each affected
section of the original spec (unchanged prose is not repeated):

### Intent (replacement)

After running the Antigravity CLI setup, the layered configuration selected
by the user is active in the runtime — not just stored in a staging directory.
Antigravity CLI reads a single system context file
(`~/.gemini/config/AGENTS.md`); the setup script generates that file by
concatenating the priority-ordered context sections in order, with
clearly-labelled separators between each section.

### Requirements (replacements)

```text
1. `scripts/setup-antigravity-interactive.sh` SHALL generate
   `~/.gemini/config/AGENTS.md` at the end of every successful setup run
   that deploys at least one context file to `~/.gemini/antigravity-cli/`.

2. The generated `~/.gemini/config/AGENTS.md` SHALL contain the content of
   each deployed context file from `~/.gemini/antigravity-cli/`, concatenated
   in lexical (priority-number) order.

3. Each section in `~/.gemini/config/AGENTS.md` SHALL be preceded by a
   separator comment of the form `<!-- crewrig-section: <filename> -->` on
   its own line, where `<filename>` is the basename of the source file
   (e.g. `00_SOUL.md`).

4. (unchanged — the individual files under `~/.gemini/antigravity-cli/` are
   retained after generation; no path substitution required.)

5. When the user chooses "keep" on an existing configuration (idempotency
   path), the script SHALL regenerate `~/.gemini/config/AGENTS.md` from the
   current `~/.gemini/antigravity-cli/` files rather than skipping
   generation.

6. The script SHALL NOT write `~/.gemini/config/AGENTS.md` if
   `~/.gemini/antigravity-cli/` contains no `*.md` files after the setup run.

7. The final summary block printed by the script SHALL report the path of the
   generated `~/.gemini/config/AGENTS.md` and its total line count.
```

### Scenarios (replacements)

### Scenario: Fresh setup — config/AGENTS.md generated

Given a clean environment with no prior configuration,
  the user runs the setup script and selects a level, expertise, and team,
  and opts in to the library tier
When the script completes
Then `~/.gemini/config/AGENTS.md` exists,
  its content is the concatenation of the deployed `*.md` files from
  `~/.gemini/antigravity-cli/` in lexical order,
  each section is preceded by a `<!-- crewrig-section: <filename> -->`
  comment,
  and `~/.gemini/antigravity-cli/` still contains the individual files.

### Scenario: Re-run with "keep" — config/AGENTS.md regenerated

Given an environment where the script has already run and
  `~/.gemini/antigravity-cli/` contains existing files
When the user runs the script again and chooses "keep"
Then `~/.gemini/config/AGENTS.md` is regenerated from the current files in
  `~/.gemini/antigravity-cli/`,
  the individual files are not modified,
  and the script exits zero.

### Scenario: Re-run with "refresh" — config/AGENTS.md regenerated from new selection

Given an environment with an existing configuration
When the user runs the script and chooses "refresh",
  then selects a new team and level
Then the old individual files are removed from `~/.gemini/antigravity-cli/`,
  new ones are deployed,
  and `~/.gemini/config/AGENTS.md` is regenerated from the new set of files.

### Scenario: No context files after run — config/AGENTS.md not written

Given `~/.gemini/antigravity-cli/` contains no `*.md` files after the setup
  run
When the script reaches the config/AGENTS.md generation step
Then `~/.gemini/config/AGENTS.md` is not written or overwritten,
  and the script exits zero.

## REMOVED

(none)
