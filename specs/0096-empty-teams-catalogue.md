---
id: "0096"
slug: empty-teams-catalogue
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 603
version: 1.0.0
---

# Empty-catalogue and escaped-selection guard for team / expertise / level setup pickers

## Intent

A person running the Claude, Gemini, Copilot, or Antigravity interactive
setup script sees the team, expertise, and level selection steps behave the
same way whether their `config/teams/`, `config/expertise/`, and
`config/level/` catalogue directories are populated or left empty, and
whether they deliberately decline to pick an entry. Today, an empty
catalogue directory or a declined pick makes the entire setup script stop
with an error, discarding every step that had not yet run — including the
other two selection categories, MCP registration, and hooks wiring. After
this change, finding nothing to pick in one category, or declining to pick,
simply leaves that one category's rule file undeployed for this run; the
rest of the setup run completes normally. Issue #603 names only the Claude,
Gemini, and Copilot scripts; grounding this spec against the current
repository surfaced the identical defect in
`scripts/setup-antigravity-interactive.sh`, and the user explicitly approved
widening this spec's scope to cover that fourth script as well.

## Requirements

1. When a catalogue directory (`config/teams/`, `config/expertise/`, or
   `config/level/`) contains zero rule files, the corresponding selection
   step in each in-scope setup script SHALL present zero candidate entries
   to the user — no placeholder entry (a literal `*` or `*.md`) SHALL
   appear in the picker.
2. When a selection step yields no chosen entry — because the catalogue is
   empty or because the user exits the picker without choosing one — the
   setup script SHALL skip deploying that category's rule file and SHALL
   continue executing the remaining setup steps; it SHALL NOT terminate the
   script.
3. When a selection step is skipped, the setup script SHALL NOT write a new
   marker file for that category (`.selected_team`, `.selected_expertise`,
   `.selected_level`), and SHALL remove any such marker file already present
   from an earlier run, so a marker file's presence always reflects whether
   that category's rule file is actually installed at the end of the
   current run rather than a stale prior run.
4. The setup script SHALL print a message that distinguishes an empty
   catalogue from a declined pick, naming the affected category in both
   cases.
5. This behavior SHALL be applied identically to all three selection
   categories (team, expertise, level) within each in-scope script.
6. This behavior SHALL be applied identically across the four in-scope
   setup scripts — `scripts/setup-claude-interactive.sh`,
   `scripts/setup-gemini-interactive.sh`,
   `scripts/setup-copilot-interactive.sh`, and
   `scripts/setup-antigravity-interactive.sh`.
7. A regression test SHALL assert, for at least one in-scope script and at
   least one category, that an empty catalogue directory produces zero
   picker entries and that the setup script's selection step allows the
   script to continue rather than terminating it.
8. The implementation PR SHALL consult `docs/cli-matrix.md` per `AGENTS.md`
   → *CLI Matrix Maintenance* (the four in-scope scripts fall within that
   section's trigger list) and SHALL update the document if this change
   alters any row's documented behavior; if no row changes, the PR SHALL
   record that determination explicitly in its description.

## Scenarios

**Scenario:** Normal selection still deploys and records the choice

```text
Given `config/teams/` contains at least one rule file
When  the operator runs an in-scope setup script and picks an entry at the
      team-selection step
Then  the corresponding rule file is installed to the CLI's rules location
And   the `.selected_team` marker is written with the chosen entry's name
And   the setup script continues to the next selection step
```

**Scenario:** Empty catalogue directory is skipped without aborting

```text
Given `config/expertise/` contains zero rule files
When  the operator runs an in-scope setup script and reaches the
      expertise-selection step
Then  the picker shows zero candidate entries, with no literal `*` or
      `*.md` entry offered
And   the setup script prints a message naming expertise as skipped because
      no catalogue entries exist
And   the setup script continues to the level-selection step instead of
      exiting
```

**Scenario:** Declining a non-empty picker is treated the same as an empty
catalogue

```text
Given `config/level/` contains one or more rule files
When  the operator runs an in-scope setup script, reaches the
      level-selection step, and exits the picker without choosing an entry
Then  no level rule file is installed
And   the setup script prints a message naming level as skipped because no
      entry was chosen
And   the setup script continues to the next step instead of exiting
```

**Scenario:** A skipped selection does not leave a stale marker from an
earlier run

```text
Given a prior setup run wrote the `.selected_team` marker after selecting a
      team, and the operator has since chosen "refresh" (clearing the
      previously installed rule files)
When  the operator reaches the team-selection step this run and no team is
      selected, whether because the catalogue is empty or the pick was
      declined
Then  the team rule file is absent at the end of this run
And   the `.selected_team` marker is also absent at the end of this run —
      it is not left over from the prior run
```

## Out of scope

- The pre-existing "keep vs. refresh" prompt (`SKIP_RULES_CONFIG`) and its
  full wipe of previously installed rule files on "refresh" — unchanged by
  this spec.
- Any change to which selection categories exist, or to the
  `config/teams/`, `config/expertise/`, `config/level/` file formats or
  content.
- Any non-interactive alternative to the `fzf` picker (for example, a future
  `--team=<name>` flag) for these scripts.
- Restoring a rule file or marker file that a prior "refresh" already
  deleted — the recovery path remains re-running setup and selecting again.
- Any change to the existing `fzf` / `jq` dependency detection already
  present in each script.

## Open questions

None.
