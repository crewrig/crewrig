---
name: init-expertise
description: "Create and populate a new expertise (role) file under
  config/expertise/ through a guided interview. Activate when an adopter wants
  to add a domain-expertise context profile for a role the catalog does not
  yet cover. Collects the role's responsibilities and key practices and writes
  a conformant config/expertise/<ROLE>.md, refusing to silently overwrite an
  existing file."
type: skill
license: Apache-2.0
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.0.2"
claude:
  allowed-tools:
    - Read
    - Write
    - Edit
    - Bash
    - AskUserQuestion
  user-invocable: true
---

# Init Expertise

Guide an adopter through creating a new domain-expertise role file under
`config/expertise/`. The output is exactly one Markdown file conforming to
the established catalog shape — an H1 role title, then `## Responsibilities`
and `## Key Practices` (the `config/expertise/PRODUCT-OWNER.md` shape), or
`## Stack` and `## Key Practices` when the role is tied to a concrete tech
stack (the `config/expertise/BACKEND-JAVA.md` shape).

## When to activate

- The adopter types `/init-expertise` (or the host CLI equivalent).
- The adopter asks to add a role/persona profile not already in
  `config/expertise/`.

A new file created through this flow has no upstream version, so it is the
organization's own from the start (it never enters the adopt-on-edit sync).

## Interaction rules

- **Always use `AskUserQuestion`** for closed questions with a bounded set of
  choices (the role-shape choice, collision decisions, confirmations). Never
  simulate a multiple-choice menu in plain text.
- Use free-form chat ONLY for open-ended content (responsibility statements,
  practice bullets, stack items).
- Conduct the interview in the user's preferred conversation language; write
  the file itself in English (project content is English-only).
- Keep `header` labels short (max 12 characters).

## Phase 0 — Role name and filename

1. Ask in chat for the role name (e.g. "Data Engineer").
2. Derive the filename: uppercase, words joined by hyphens, `.md` extension
   (e.g. `DATA-ENGINEER.md`). Confirm the derived `config/expertise/<NAME>.md`
   path with the user.

## Phase 1 — Anti-clobber guard (R8)

1. Check whether `config/expertise/<NAME>.md` already exists
   (`test -e config/expertise/<NAME>.md`).
2. **If it exists, do NOT overwrite it silently.** Surface the collision and
   require an explicit decision via `AskUserQuestion` (`header: "Exists"`,
   options: "Pick a different name", "Overwrite the existing file", "Cancel").
   - "Pick a different name" → return to Phase 0.
   - "Overwrite" → proceed only after this explicit confirmation.
   - "Cancel" → stop without writing.

## Phase 2 — Shape

Use `AskUserQuestion` (`header: "Shape"`) to choose the section layout:

- "Responsibilities + Practices" — the general role shape (PRODUCT-OWNER).
- "Stack + Practices" — for roles bound to a concrete tech stack
  (BACKEND-JAVA).

## Phase 3 — Content

1. One-line role summary (free-form chat): "You assist a … who …".
2. **Responsibilities** (if chosen) — collect 3–5 responsibility statements in
   chat. **Stack** (if chosen) — collect the core technologies in chat.
3. **Key Practices** — collect 3–5 concrete, actionable practice bullets in
   chat (testable statements, not vague wishes).

## Phase 4 — Generation

1. Assemble the answers into `config/expertise/<NAME>.md`:

   ```markdown
   # <Role Name>

   <one-line summary>

   ## Responsibilities   (or ## Stack)

   - …

   ## Key Practices

   - …
   ```

2. Present the draft for review in chat.
3. Use `AskUserQuestion` (`header: "Finalize"`, options "Save as is",
   "Edit a section", "Discard draft") to confirm before writing.
4. Write the file only after explicit confirmation. End with a short pointer:
   the file is the organization's own and will not be touched by upstream sync.

---

**Constraints:**

- NEVER overwrite an existing `config/expertise/*.md` without an explicit
  user decision (R8).
- Always ask the user — never invent responsibilities or practices.
- The written file is English-only project content.
