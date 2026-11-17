# Recorded judge answers of the `spec-author` measurements (issue #1894)

Fixtures for spec 0290 delta-05 (issue #1902). Each directory holds, for one eval of one
measurement run, the raw judge answer (`judge.txt`) and the spec the run produced
(`produced-spec.md`), copied unmodified from the measurement scratchpad.

The judge numbers its expectations from 1; `grading.json` numbers checks first, so judge
expectation *n* is a later entry there.

| Directory | Judge expectation | Exact rule | Rule that accepts it | Share of the longest verbatim run |
|---|---|---|---|---|
| `m5-eval-1` | 3 (heading and bullets joined onto one line) | rejected | 2 (normalised) | not needed |
| `m5-eval-1` | 4 (own sentence around a verbatim bullet) | rejected | 3 (window) | 61 of 159 = 0.38 |
| `m4-eval-3` | 2 (requirement 2 quoted inside commentary) | rejected | 3 (window) | 85 of 158 = 0.54 |
| `m4-eval-3` | 3 (ellipsis and markdown markers) | rejected | 2 (normalised) | not needed |
| `m2-eval-3` | 2 (over-escaped quotes inside commentary) | rejected | 3 (window) | 59 of 170 = 0.35 |

Three samples only: see `docs/skill-evals.md` on the thin margin of the share floor.
