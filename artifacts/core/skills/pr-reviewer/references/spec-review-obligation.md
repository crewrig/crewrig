# Spec-review obligation

## Spec-review obligation — tier challenge

When acting as a spec-reviewer (cold-spawned to review a spec-PR), the
role MUST challenge a complexity tier that appears under-stated
relative to the spec's declared blast radius. Emit a `class: spec`
finding citing `AGENTS.md → Team sizing by complexity`. Under-statement
is detected when the spec's `## Requirements` or `## Out of scope`
enumerate a surface broader than the declared tier admits (per the
tier table). Over-statement is a non-blocking observation, not a
blocking finding.

A spec review runs on the `specs/<ticket>` seat, so its findings carry
`s<N>-F<M>` identifiers. A fresh delta-spec PR is a **replaced artifact**,
not a revision: examine it in full — the step-3 bound attaches to an
artifact, never to a seat — while still auditing every prior finding the
seat's dossier carries (`docs/reviewer-seat.md` → *A replaced artifact*).
