---
id: "0035"
slug: idiomatic-french-calque-rules
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 311
version: 1.0.0
---

# Framework-level idiomatic-French calque catalog in core rules

## Intent

The idiomatic-French calque catalog (currently in `spec-author/SKILL.md` as
R17) is elevated to the framework-level core rules file
(`artifacts/core/rules/60-tools.md`) so that every agent and orchestrator
reading the deployed rules avoids anglicisms in French-language interactive
prose — not only the spec-author skill during interview sessions.

## Requirements

1. `artifacts/core/rules/60-tools.md` SHALL gain an **Idiomatic French**
   section that applies whenever the user's preferred language is French.
2. The section SHALL enumerate a **calque catalog**: common software-engineering
   terms that have idiomatic French equivalents, paired as `<English calque>
   → <idiomatic French>`. The catalog SHALL include at minimum:
   - `gate` / `user gate` → `point de validation`
   - `build` (noun/verb) → `construction` / `compilation` / `construire`
   - `install` (noun/verb) → `installation` / `installer`
   - `scope` (noun) → `portée`
   - `merge` (noun/verb) → `fusion` / `fusionner`
   - `opt-in` → `activation à la demande`
   - `tier` → `palier`
   - `worktree` → `espace de travail`
   - `spec-PR` → `PR de spécification`
   - `lint` / `linter` → `analyse statique` / `vérificateur stylistique`
   - `commit` (noun) → `validation`
   - anglicized verbs ending in `-er` derived from English (`spawner`,
     `shipper`, `merger` as a verb, `amender` in the English sense) →
     describe the action idiomatically in French
3. The section SHALL clarify the **translation boundary**: items that MUST
   NOT be translated include genuine code identifiers, file paths, CLI tool
   names, GitHub label values, frontmatter field names, literal skill/agent
   names (e.g., `spec-author`, `team-lead`), and proper nouns. These appear
   in backtick spans or inline code as-is.
4. The calque-avoidance rule SHALL apply to all agent-authored prose directed
   at the user (chat messages, progress updates, logbook comments, plan
   summaries) whenever French is the active interaction language. It does NOT
   apply to content written into the repository (commits, PR bodies, spec
   files) — those follow the English-only project-content rule in `AGENTS.md`.
5. The section SHALL be self-contained: it SHALL NOT reference
   `spec-author/SKILL.md` R17 as its source (the two documents serve
   different audiences and must remain independently readable).

## Scenarios

**Scenario:** Orchestrator produces French progress update without anglicisms.

Given the user's preferred language is French  
And the orchestrator is reporting progress on a lifecycle stage  
When it composes a French-language status message  
Then it uses `point de validation` (not `gate`), `construction` (not `build`),
`fusion` (not `merge`), and `espace de travail` (not `worktree`)  
And code identifiers such as `AGENTS.md`, `fix/0034-…`, and `spec-author`
remain in their original form within backtick spans

**Scenario:** Agent preserves English for repository-bound content.

Given the user's preferred language is French  
And the agent is composing a commit message, PR title, or spec file body  
When it writes the content  
Then the content is fully in English per the `AGENTS.md` project-content rule  
And the Idiomatic French section has no effect on this content

## Out of scope

- Modifying `spec-author/SKILL.md` R17 — the calque catalog there covers the
  spec-author interview path; this spec adds a parallel, independently
  readable catalog at the framework level.
- Language guidance for interaction languages other than French — the catalog
  is French-specific; other languages are addressed by their own future specs.
- Enforcing calque-avoidance in repository-bound content (commits, PR bodies,
  spec files) — those follow the `AGENTS.md` English-only rule.

## Open questions

- None. The fix surface (a new section in `artifacts/core/rules/60-tools.md`)
  and the catalog minimum set are both settled from the evidence in issue #311.
