---
name: init-team
description: "Create and populate a new team file under config/teams/ through a guided interview. Activate when an adopter wants to add a per-team context and configuration profile. Collects the team's mission, technology stack, and development practices and writes a conformant config/teams/<TEAM>.md, refusing to silently overwrite an existing file."
license: Apache-2.0
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - AskUserQuestion
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.0.2"
---


# Init Team

Guide an adopter through creating a new team file under `config/teams/`. The
output is exactly one Markdown file conforming to the established catalog
shape (the `config/teams/FORGE.md` shape): an H1 team title, then `## Mission`,
`## Technology Stack`, `## Development Practices`, and optional sections such
as `## Rituals`, `## Collaboration Norms`, `## Documentation`,
`## Issue Tracking`, and `## Key Contacts`.

## When to activate

- The adopter types `/init-team` (or the host CLI equivalent).
- The adopter asks to add a per-team context profile not already in
  `config/teams/`.

A new file created through this flow has no upstream version, so it is the
organization's own from the start (it never enters the adopt-on-edit sync).

## Interaction rules

- **Always use `AskUserQuestion`** for closed questions with a bounded set of
  choices (optional-section selection, collision decisions, confirmations).
  Never simulate a multiple-choice menu in plain text.
- Use free-form chat ONLY for open-ended content (mission, stack items,
  practice bullets, contacts).
- Conduct the interview in the user's preferred conversation language; write
  the file itself in English (project content is English-only).
- Keep `header` labels short (max 12 characters).

## Phase 0 — Team name and filename

1. Ask in chat for the team name (e.g. "Atlas").
2. Derive the filename: uppercase, words joined by hyphens, `.md` extension
   (e.g. `ATLAS.md`). Confirm the derived `config/teams/<NAME>.md` path with
   the user.

## Phase 1 — Anti-clobber guard (R8)

1. Check whether `config/teams/<NAME>.md` already exists
   (`test -e config/teams/<NAME>.md`).
2. **If it exists, do NOT overwrite it silently.** Surface the collision and
   require an explicit decision via `AskUserQuestion` (`header: "Exists"`,
   options: "Pick a different name", "Overwrite the existing file", "Cancel").
   - "Pick a different name" → return to Phase 0.
   - "Overwrite" → proceed only after this explicit confirmation.
   - "Cancel" → stop without writing.

## Phase 2 — Core content

Collect, in free-form chat:

1. **Mission** — one short paragraph: what the team builds or operates and its
   north star.
2. **Technology Stack** — the languages, persistence, messaging, build, and
   testing tools (as labeled bullets).
3. **Development Practices** — 3–5 concrete practices the team follows.

## Phase 3 — Optional sections

Use `AskUserQuestion` (`header: "Sections"`, `multiSelect: true`) to offer the
optional sections: "Rituals", "Collaboration Norms", "Documentation",
"Issue Tracking", "Key Contacts". Collect content in chat for each selected
section.

## Phase 4 — Generation

1. Assemble the answers into `config/teams/<NAME>.md` following the
   `config/teams/FORGE.md` structure (H1 title with a short tagline, then the
   collected sections in order).
2. Present the draft for review in chat.
3. Use `AskUserQuestion` (`header: "Finalize"`, options "Save as is",
   "Edit a section", "Discard draft") to confirm before writing.
4. Write the file only after explicit confirmation. End with a short pointer:
   the file is the organization's own and will not be touched by upstream sync.

---

**Constraints:**

- NEVER overwrite an existing `config/teams/*.md` without an explicit user
  decision (R8).
- Always ask the user — never invent a mission, stack, or practices.
- The written file is English-only project content.
