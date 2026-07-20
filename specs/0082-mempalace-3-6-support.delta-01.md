---
id: "0082"
slug: mempalace-3-6-support
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 566
version: 1.0.1
---

# Support the MemPalace 3.6.x line

## ADDED

_None._

## MODIFIED

Requirement 5 is reworded to resolve a conflict surfaced by the PLAN stage: its
absolute "anywhere in the repository" clause reaches immutable historical
records that quote the old literal verbatim — `docs/adr/**` (Architecture
Decision Records, which state past decisions as of their date) and `specs/**`
(specification files, including this one, that cite `>=3.3.3,<3.4` as the string
being removed). Editing those to satisfy the literal sweep would falsify dated,
immutable records. The reworded R5 preserves the substantive intent (no stale or
divergent range string in any live/active location) while exempting those two
historical-record trees from the sweep and its CI guard. Intent unchanged, scope
clarified — a PATCH bump (1.0.0 → 1.0.1); no requirement is added or removed.

- Original R5:

  > Every location in the repository that currently states the MemPalace
  > supported range as the literal `>=3.3.3,<3.4` — including
  > `scripts/prune-transcripts.sh` and `scripts/start-chroma-server.sh` — SHALL
  > state the new supported range, and no `>=3.3.3,<3.4` string (nor any range
  > string divergent from the four setup flows) SHALL remain anywhere in the
  > repository.

- Replacement R5:

  > Every location in the repository that currently states the MemPalace
  > supported range as the literal `>=3.3.3,<3.4` — including
  > `scripts/prune-transcripts.sh` and `scripts/start-chroma-server.sh` — SHALL
  > state the new supported range. No `>=3.3.3,<3.4` string (nor any range
  > string divergent from the four setup flows) SHALL remain in the repository,
  > EXCEPT within immutable historical records that quote it verbatim — namely
  > `docs/adr/**` (Architecture Decision Records) and `specs/**` (specification
  > files that cite the literal as the string being removed). Those two trees
  > are out of scope for both the sweep and its CI guard.

## REMOVED

_None._
