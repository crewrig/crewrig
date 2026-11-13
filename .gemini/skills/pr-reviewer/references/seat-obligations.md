# Seat obligations

Contents: [The brief](#the-brief) · [The seat line](#the-seat-line) · [The dossier](#the-dossier) · [Vacancy](#vacancy) · [Discarded pass](#discarded-pass)

Every pass of a review is attributed to one reviewer seat, keyed `<surface>/<ticket>` with the surface `specs`, `plan` or `review`. A seat is not a surviving process: each pass is a fresh reviewer, so the seat's continuity rests on what the forge already holds. In a CrewRig checkout the full contract is `docs/reviewer-seat.md`; this file is the reviewer's checklist of it.

## The brief

A pass receives references only: the seat key, the artifact (the pull-request number), the revision the seat last examined, and where its prior verdicts, ledger comment and finding dispositions live. It receives no diff, summary, assessment or reasoning from the author, because that would end the independence that makes a review worth asking for. Retrieve everything through the forge CLI. Reading the seat's own earlier verdicts is not authoring context: they are public artifacts.

## The seat line

Every verdict carries `seat: <surface>/<ticket>[#<generation>]` on a line of its own. Where it goes depends on the transport:

- a formal review (`gh pr review`): the first line of the body;
- a plain comment, or a verdict recorded on the logbook issue: the line right after the `## Verdict: …` line;
- the `plan` surface: right after the `### Verdict: …` line.

The seat key names the artifact reviewed, never the place the verdict landed. `lint-verdict.ts --transport` checks the placement.

## The dossier

Rebuild the seat's dossier from the forge before judging anything. Read the seat ledger comment first, then cross-check it against the seat's own non-void verdicts: the verdicts win on any disagreement, and the earlier `examined:` revision wins. Record a mismatch in the verdict. As the fallback, query every location the seat contract lists, the logbook issue included on a pull-request surface too, because a verdict the posting step could not place on the pull request lands there.

## Vacancy

When the dossier cannot be reconstructed, examine the whole artifact and record the vacancy and its cause in the verdict. A widened scope is never silent.

## Discarded pass

A pass whose brief carries authoring-session content is discarded: its verdict is not consumed, it opens no dossier entry and it does not advance the iteration counter. Say so and stop.
