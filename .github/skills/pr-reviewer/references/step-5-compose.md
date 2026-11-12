# Step 5: compose the verdict

The verdict opens with the seat line `seat: <surface>/<ticket>[#<generation>]`; its placement depends on the transport step 6 selects (the rule per transport is in the seat obligations that SKILL.md points to), and `lint-verdict.ts --transport` checks it.

From the seat's second pass onward, the first section is a prior-finding audit: for each finding identifier in the seat's dossier, whether this pass accepts the recorded disposition. A prior finding judged unaddressed prevents an approving verdict. A mismatch between the seat ledger and the seat's own verdicts, or an `examined:` revision later than the latest verdict's, is recorded here with its cause. When the seat is vacant, this section records the vacancy and its cause instead.

Then five sections, in this order:

- **CI status**: pass, fail or pending for each required check, from step 1. When a check fails or is pending, this section drives the verdict; do not bury it.
- **Correctness**: does the code do what the PR claims? Cite the file path and line range of each claim.
- **Convention compliance**: does the change follow the rules collected in step 2? Cite the rule and the offending location.
- **Test coverage**: are the changes covered, and do the added tests exercise the new behaviour? Cite test file paths.
- **Linter findings**: one subsection per script that exited `1`, its stdout quoted verbatim.

Every technical claim cites a verifiable source (a file path with a line, or a specific assertion from the diff); without one, write "see diff" or leave the claim out. The verdict stays within 12 KB: `scripts/check-comment-size.ts` and `post-verdict.ts` enforce it, and bulk moves to a linked artifact.

The three verdict events: `APPROVE` when nothing blocks (nits welcome, not required); `REQUEST_CHANGES` when at least one finding must be fixed before merge; `COMMENT` for observations without a verdict, such as a change outside the reviewer's domain or a verdict deferred on pending CI.
