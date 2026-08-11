---
id: "0002"
slug: spec-author-skill
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 703
version: 1.5.0
---

# 0002 — spec-author-skill (delta-05)

This delta adds a new requirement to spec 0002 to enforce a self-checking habit when drafting specifications. A recurring pattern (observed across four requirements in spec 0108) consists of stating what is forbidden or what the normal case must produce, while failing to state what is permitted or what the degenerate/null case must produce. This delta introduces a mandatory checklist item for the `spec-author` skill to catch these omissions during the authoring phase.

## ADDED

1. **New requirement (R18) — Null-case and permitted-path self-check.** The `spec-author` skill SHALL enforce a mandatory self-check during the authoring phase of any specification. For each drafted requirement, the skill SHALL verify that the requirement explicitly answers the null/degenerate case and names a permitted path, rather than solely stating what is forbidden or describing only the happy path. If a requirement fails this check, the skill SHALL revise it before finalizing the draft.

## MODIFIED

(None. This delta is purely additive.)

## REMOVED

(None. This delta adds a new requirement without removing any existing one.)
