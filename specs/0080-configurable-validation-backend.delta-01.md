---
id: "0080"
slug: configurable-validation-backend
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 557
version: 1.0.1
---

# Configurable user-gate validation backend

## ADDED

_None._

## MODIFIED

Requirement 16 is reworded to resolve an internal inconsistency surfaced by the
PLAN cold review (issue #557). The original R16 mandated persistence "in the
overlay layer", but `docs/layers.md` defines the overlay layer as adopter-owned
_committed repo paths_; per-user, machine-local selections cannot live in a
committed overlay path without being shared across all fork clones. The original
R16 also contradicted the spec's own OQ2, which blessed "a dedicated config file"
as a candidate. This is a wording fix: the reworded R16 preserves the substantive
intent (selections live outside the core layer and are deterministically
discoverable at gate time) and only removes the impossible "overlay layer"
placement — hence a PATCH bump (1.0.0 → 1.0.1), no requirement is added or
removed.

- Original R16:

  > Per-user selections SHALL be persisted in the overlay layer by the
  > `setup-*-interactive.sh` scripts and SHALL be discoverable by the agent at
  > gate time.

- Replacement R16:

  > Per-user selections SHALL be persisted by the `setup-*-interactive.sh`
  > scripts in a per-user, machine-local configuration OUTSIDE the core layer —
  > not a committed layer file — and SHALL be deterministically discoverable by
  > the agent at gate time.

## REMOVED

_None._
