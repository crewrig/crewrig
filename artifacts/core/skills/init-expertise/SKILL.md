---
name: init-expertise
description: "Creates a new expertise (role) file under config/expertise/ through a guided interview and a bundled scaffold script that derives the filename and refuses to overwrite. Use when an adopter wants a domain-expertise or persona profile for a role the catalog lacks, adds a role to config/expertise, or types /init-expertise. Trigger terms: new role file, expertise profile, persona, config/expertise, init expertise. Not for team profiles (init-team) or personal profiles."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts) and a host CLI with a structured-question tool (AskUserQuestion on Claude Code). Writes one Markdown file under config/."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "2.0.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Bash
    - AskUserQuestion
  user-invocable: true
---

# Init Expertise

Creates one file, `config/expertise/<NAME>.md`, in the catalog shape: an H1 role title, a one-line
summary, then `## Responsibilities` (the `PRODUCT-OWNER.md` shape) or `## Stack` for a role tied to a
concrete tech stack (the `BACKEND-JAVA.md` shape), then `## Key Practices`. You run the interview,
which is judgement; the scripts derive the filename, refuse to clobber, render and check the file.
The file is the organization's own, so upstream sync never touches it.

## Interview rules

- Closed questions with a bounded set of choices go through `AskUserQuestion` (shape, collision
  decision, confirmation); a plain-text menu gets skipped or misread.
- Open content (summary, responsibilities, stack items, practices) is free-form chat.
- Talk in the user's language. The file is written in English, so translate the answers faithfully
  and add nothing the user did not say: an invented responsibility would be read as the role's own.
- Keep `header` labels under 12 characters.

## Steps

1. **Name.** Ask for the role name (for example "Data Engineer"). Run the resolve command; confirm
   `config/expertise/<data.file>` with the user.
2. **Collision.** If `data.exists` is true, ask with `AskUserQuestion` (`header: "Exists"`):
   "Pick a different name" (back to step 1), "Overwrite the existing file", "Cancel" (stop, write
   nothing). Overwriting is a decision the user takes, never a default.
3. **Shape.** `AskUserQuestion` (`header: "Shape"`): "Responsibilities + Practices" (general role)
   or "Stack + Practices" (role bound to a tech stack). It becomes `shape` in the answers.
4. **Content**, in chat: the one-line summary ("You assist a ... who ..."); 3 to 5 responsibility
   statements, or the core technologies for a stack; 3 to 5 key practices written as testable
   statements, not vague wishes.
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
| After the name is known, and again after any rename | `node scripts/scaffold-config-file.ts --kind expertise --name "<role name>" --json` | Never used here. Read `data.file` and `data.exists`. |
| To show the draft, then to save it | `node scripts/scaffold-config-file.ts --kind expertise --answers <answers.json> --dry-run` (draft in `data.content`), then the same without `--dry-run` | `target-exists`: the file exists and was not written. Any other rule names an answers field to fix. |
| After saving | `node scripts/lint-config-file.ts --kind expertise <path>` | A section is missing, out of order, empty or still a placeholder. Fix the answers and write again with `--force`, which is allowed here because this run created the file. |

Add `--force` to the save command only after the user has chosen to overwrite. Add `--root <dir>`
when the repository root is not the current directory. The answers file is JSON; the field list is
in `node scripts/scaffold-config-file.ts --help`.
