---
id: "0069"
slug: mempalace-wakeup-parity
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 415
version: 2.0.0
---

# Record the MemPalace layered-wake-up parity gap and bound the session sweep

## ADDED

_None._

## MODIFIED

Requirement 4 is replaced. The original R4 rested on a false premise:
`config/TOOLS.md` is not a build output of
`artifacts/core/rules/60-tools.md`. Its own header comment declares that
it "carries organization-specific additions only" and
`scripts/setup-claude-interactive.sh` deploys the two files
independently (`artifacts/core/rules/60-tools.md` at priority 60,
`config/TOOLS.md` as the priority-65 organization overlay); moreover
`scripts/build-components.sh` never processes rules files and contains no
reference to `TOOLS.md`. Implementing the original R4 verbatim is
therefore either vacuous — no such build step exists — or harmful, since
duplicating framework rule content into the organization overlay breaks
the core/overlay separation.

- Original R4:

  > The corrected rule content SHALL be reflected in its build output
  > `config/TOOLS.md` within the same change.

- Replacement R4:

  > The change SHALL run the component build
  > (`bash scripts/build-components.sh`) and confirm zero drift in
  > committed build outputs; framework rule content SHALL NOT be
  > duplicated into the priority-65 organization overlay
  > `config/TOOLS.md`.

## REMOVED

_None._
