---
name: init-team
description: "Creates a new team file under config/teams/ through a guided interview and a bundled scaffold script that derives the filename and refuses to overwrite. Use when an adopter wants a per-team context and configuration profile, adds a team to config/teams, or types /init-team. Trigger terms: new team file, team profile, config/teams, team context, init team. Not for expertise or role profiles (init-expertise) or personal profiles."
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts) and a host CLI with a structured-question tool (AskUserQuestion on Claude Code). Writes one Markdown file under config/."
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "2.0.0"
---


# Init Team

Creates one file, `config/teams/<NAME>.md`, in the catalog shape of `config/teams/FORGE.md`. You
run the interview, which is judgement; the scripts derive the filename, refuse to clobber, render
and check the file. The file is the organization's own, so upstream sync never touches it.

## Interview rules

- Closed questions with a bounded set of choices go through `AskUserQuestion` (optional-section
  choice, collision decision, confirmation); a plain-text menu gets skipped or misread.
- Open content (mission, stack items, practices, contacts) is free-form chat.
- Talk in the user's language. The file is written in English, so translate the answers faithfully
  and add nothing the user did not say: an invented stack or practice would be read as the team's
  own.
- Keep `header` labels under 12 characters.

## Steps

1. **Name.** Ask for the team name (for example "Atlas"). Run the resolve command; confirm
   `config/teams/<data.file>` with the user.
2. **Collision.** If `data.exists` is true, ask with `AskUserQuestion` (`header: "Exists"`):
   "Pick a different name" (back to step 1), "Overwrite the existing file", "Cancel" (stop, write
   nothing). Overwriting is a decision the user takes, never a default.
3. **Core content**, in chat: a short tagline; the **mission** (one paragraph: what the team builds
   or operates and its north star); the **technology stack** (labeled bullets such as
   `**Language:** Java 21`); 3 to 5 concrete **development practices**.
4. **Optional sections.** `AskUserQuestion` (`header: "Sections"`, `multiSelect: true`): Rituals,
   Collaboration Norms, Documentation, Issue Tracking, Key Contacts. Collect each selected one in
   chat. Rituals is a paragraph, the others are bullet lists.
5. **Draft.** Write the answers JSON to a scratch file, run the dry-run command and show
   `data.content`. Ask with `AskUserQuestion` (`header: "Finalize"`): "Save as is", "Edit a
   section" (back to the relevant step), "Discard draft".
6. **Save and check.** Run the save command, then the linter. End with one line: the file is the
   organization's own and upstream sync will not touch it.

## Scripts

Run `node scripts/<name>.ts` from the skill directory; paths you pass stay relative to the
repository root. Both scripts take `--json` and exit `0` (ok), `1` (finding), `2` (usage error) or
`3` (precondition failed: unreadable input, `--root` not a directory).

| When | Command | Exit `1` means |
|---|---|---|
| After the name is known, and again after any rename | `node scripts/scaffold-config-file.ts --kind team --name "<team name>" --json` | Never used here. Read `data.file` and `data.exists`. |
| To show the draft, then to save it | `node scripts/scaffold-config-file.ts --kind team --answers <answers.json> --dry-run` (draft in `data.content`), then the same without `--dry-run` | `target-exists`: the file exists and was not written. Any other rule names an answers field to fix. |
| After saving | `node scripts/lint-config-file.ts --kind team <path>` | A section is missing, out of order, empty or still a placeholder. Fix the answers and write again with `--force`, which is allowed here because this run created the file. |

Add `--force` to the save command only after the user has chosen to overwrite. Add `--root <dir>`
when the repository root is not the current directory. The answers file is JSON; the field list is
in `node scripts/scaffold-config-file.ts --help`.
