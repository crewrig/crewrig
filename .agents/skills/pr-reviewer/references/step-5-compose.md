# Step 5: compose the review

## 5. Compose the structured review

The verdict opens with the seat line:
`seat: <surface>/<ticket>[#<generation>]`. Its exact placement depends on
which transport step 6 selects, so take it from
`docs/reviewer-seat.md` → *The seat line, and where it goes* rather than
deriving it here.

**From the seat's second pass onward, a prior-finding audit is the
verdict's first section**, before any new finding. It states, per finding
identifier in the seat's dossier, whether this pass accepts the recorded
disposition. A prior finding this pass judges unaddressed **prevents an
approving verdict**. A mismatch between the seat ledger and the seat's
verdicts, or an `examined:` revision later than the latest verdict's, is
recorded here, with the cause. The verdict body stays within 12 KB
(`scripts/check-comment-size.ts`); bulk moves to a linked artifact. When the seat is vacant, that section instead records
the vacancy and its cause.

Then five sections, in this order:

- **CI status** — pass / fail / pending for each required check
  (from step 1). When any required check is failing or pending, this
  section drives the verdict; do not bury it.
- **Correctness** — does the code do what the PR claims? Cite the file
  path and line range for each claim.
- **Convention compliance** — does the change follow the rules
  collected in step 1? Cite the rule and the offending location.
- **Test coverage** — are the changes covered? If tests were added,
  do they actually exercise the new behavior? Cite test file paths.
- **Linter findings** — one subsection per script that produced
  output. Quote the script's stdout verbatim; do not paraphrase.

Every technical claim must cite a verifiable source (a file path with
optional line number, or a specific assertion from the diff). If you
cannot cite, write "see diff" or omit the claim. See *Grounding
discipline* below.
