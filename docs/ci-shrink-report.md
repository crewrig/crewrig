# CI shrink report

<!-- crewrig-doc: published=false -->

Final line-count report of slice 5 (issue #1782, spec 0285) of the work package
[#1777](https://github.com/crewrig/crewrig/issues/1777) (spec 0280 R10). Counts are `wc -l`. GitLab output
is not verified on a live runner: it is checked by the generator equality check and the parity guard only.

## Engine-specific CI YAML (the floor of 0280 R10)

| Surface | Baseline (2026-10-24) | After slice 3 (a67ca65e) | After dorny removal (2d424f74) | After slice 5 | Change from baseline |
|---|---|---|---|---|---|
| `.github/workflows/build.yml` | 3,758 | 2,805 | 1,362 | 1,332 | -2,426 |
| `ci/ci-capabilities.yml` | 5,189 | 4,581 | 4,582 | 4,260 | -929 |
| `.gitlab-ci.yml` | 3,734 | 3,037 | 3,038 | 3,039 | -695 |
| Total | 12,681 | 10,423 | 8,982 | 8,631 | -4,050 (-31.9%) |

Floor 8,880, margin 249 lines. The ratchet test `scripts/tests/ci-shrink-report.test.ts` pins the total at 8,631.

## Outside the floor

| Surface | Before slice 5 | After slice 5 |
|---|---|---|
| `taskfiles/ci.yml` | 808 | 808 |
| `scripts/lib/build-ci/` | 788 | 797 |
| `scripts/lib/ci-parity/` | 1,460 | 1,393 |
| `scripts/check-ci-parity.ts` and `scripts/build-ci.ts` | 34 | 34 |
| New: `scripts/tests/ci-shrink-report.test.ts` | 0 | 43 |

The libraries are not part of the floor. `build-ci` grew by 9 lines for the fail-closed GitLab python rule;
`ci-parity` shrank by 67 lines (`filters-doc.ts` deleted, the in-job filter comparison removed).

## Levers of slice 5

| Lever | Result |
|---|---|
| `ci-job` `install` default `omit-dev` (63 explicit lines dropped, 9 explicit `install: ci` added) | -54 lines net in `build.yml`, effective `install` of all 94 jobs identical before and after |
| `gate: false` on the 24 `windows-*` jobs | +24 lines, install saving nil: every Windows capability requires an install, only the no-op gate step is skipped |
| Comment trim of the reference, 644 to 322 comment lines | -322 lines in `ci/ci-capabilities.yml`; non-comment lines byte-identical, every spec, ADR and issue identifier kept |
| GitLab secondary python | Not a line saving: the generator fails for a secondary python other than Debian 3.11; the only secondary-python capability (`windows-history-import`) has no GitLab job |
| Parity tooling by unreachability | -67 lines of `ci-parity`; a re-added `dorny/paths-filter` step is now rejected by the guard |
| Lever c, merge the six `*-node-24-0` twins | Not applied: the reference has no `matrix` field, adding it costs more code than the roughly 130 YAML lines it saves. Required checks of `main` (`ratchet`, `lint-typescript`) name no twin; branch protection is not configured (404) |

## Measures of spec 0280 R10

| Measure | Result |
|---|---|
| Total of the three surfaces at most 8,880 | Met: 8,631 |
| Reduction of at least 30% from 12,681 | Met: 31.9% |
| `ci:pre-push` within 60 s | Met on the measured changesets: 40.6 s and 51.7 s wall-clock for 30 tasks (a change to the generator and parity sources, under load from concurrent agents); 5.8 s for the 13 tasks of a documentation change. The 2026-10-24 record of `docs/pre-push-guard.md` (67 s for 23 tasks at load average 70 to 120) was not reproduced |
| Zero unverified `Install Task` steps | Met: `scripts/check-task-provisioning.ts` passes |
| Thin-job template of at most 15 lines per job | Met for 94 of the 108 jobs of `build.yml` (job body of 15 lines or fewer); the template is the `ci-job` section of `docs/ci-reference-format.md`. The other 14 jobs are exceptions or hand-authored jobs |

## Follow-ups

- Dead-looking cache-guard wrapping in `scripts/lib/build-ci/render-job.ts` (`GUARDED_COMMAND`, `cacheGuard`, `cacheEnv`): kept because removing it needs a replacement guard.
- Spec-changing levers left unused (about 1,500 lines): capability trigger, command and portability defaults, named path sets, compressed Windows evidence, dropping the GitLab `rules:changes` lists.
- The `schedule` branch of the alert job of #1781 is proven only by the first real scheduled failure.
- GitLab output, including the pinned Task install, is not verified on a live runner.
