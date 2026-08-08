---
id: "0109"
slug: spec-status-invariant-on-main
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 732
version: 2.0.0
---

# 0109 — spec-status-invariant-on-main (delta-02)

This delta makes spec 0109's check **fail the change that can satisfy it**. As
merged, Requirement 2 obliges the linter to fail whenever a non-delta spec
present on the base branch carries `status: draft` — unconditionally, on every
change under test. Because the linter's default target is the whole corpus, one
such spec on `main` fails **every** open pull request in the repository,
including pull requests that touch no spec at all and therefore have no power to
make the check pass.

That is not a hypothetical. Measured on this repository:

| Event | Time (UTC) |
|---|---|
| `specs/0112-spec-id-reservation.md` reaches `main` carrying `status: draft` (PR #727, `36c543d`) | 2026-08-07 22:23:27 |
| PR #729 — two files, `docs/adr/0016-*.md` and `docs/index.json` — merged with `lint-specs` red | 2026-08-08 07:50:24 |
| PR #731 restores the status, unblocking the repository | 2026-08-08 08:51:38 |

For **10 h 28**, a check every pull request was required to pass could be
satisfied by exactly one of them. #729 was merged red on the maintainer's
explicit go-ahead, which is the outcome a blocking check exists to prevent: it
taught the repository that a red `lint-specs` is sometimes ignorable, and it did
so to a pull request whose author could neither have caused nor cured the
failure.

**What this delta deliberately does not do.** Two candidate fixes were checked
against the repository before this delta was written, and both were found already
in force. Recorded here so the next reader does not re-propose them:

- **Making the `draft` → `approved` transition atomic with the spec-PR merge.**
  Already shipped on 2026-07-24 by commit `8877124` (PR #664), two weeks before
  the incident above. `docs/spec-format.md` → *Recording a status transition*
  states that the transition is recorded "**inside the spec-PR's own commit**, so
  the spec lands on `main` already carrying `status: approved`", and that "**no**
  separate, post-merge, metadata-only pull request is required". The window is
  therefore **not** structural, and PR #727 was not following a workflow that
  mandates a second PR — it deviated from a mechanic that already forbade one.
- **Detecting the violation at all.** Already works, and worked here. The `push`
  build on `main` for the offending merge commit failed four minutes after it
  landed, naming the file (`run 31223645801`, `36c543d`, job `lint-specs`).
  `.github/workflows/build.yml` runs the job on `push` to `main` as well as on
  `pull_request`, and on a push it hands the base derivation back to the linter's
  own default (`origin/main`), which on that event resolves to the pushed commit
  itself — so every spec on `main` is "present on the base branch" there, and the
  check is already global on that build.

What was missing is neither the mechanic nor the detection. It is
**attribution**: the check already failed the right build, and additionally
failed every innocent one. This delta removes the second behaviour and preserves
the first.

The version bump is **MAJOR** (`1.0.1` → `2.0.0`). Requirement 2's letter — fail
on any base-branch offender — is contradicted for the case where the change under
test does not touch the offender, so an implementation conforming to the merged
requirement is non-conforming under the replacement. That is a breaking normative
change under `docs/spec-format.md` → *Delta-spec convention → Versioning*, read
on the stronger side of its `MAJOR` clause: the change invalidates not an
in-flight implementation but the shipped one.

## ADDED

**Requirements.**

1. **Requirement 9 — the bystander rule.** When a base-branch offender under
   Requirement 2 is a file the change under test does not modify, the linter
   SHALL report it as a **non-blocking** finding that names the file and the base
   ref, states that the violation lives on the base branch rather than in the
   change under test, and SHALL NOT contribute to the linter's exit status.
   Reporting rather than staying silent is deliberate: the condition is real and
   a reader who meets it should learn that it exists, but a change that cannot
   cure a condition SHALL NOT be failed by it.
2. **Requirement 10 — no change means no bystander.** When the change under test
   modifies no file relative to the base ref, the linter SHALL fail on every
   offender under Requirement 2. With nothing to attribute a base-branch
   violation to, the tree under test *is* the base branch, and its offenders are
   the subject of the run rather than another change's fault. This is the state
   the check runs in on the base branch's own build, and it is what keeps the
   invariant of Requirement 1 mechanically enforced after Requirement 9 narrows
   the pull-request case.
3. **Requirement 11 — attribution is derived, and fails closed when it cannot
   be.** The set of files the change under test modifies SHALL be derived from
   the repository at check time, never from a recorded list, exactly as
   Requirement 3 already obliges for the set of files examined. When that set
   cannot be derived, the linter SHALL fail on every offender under Requirement 2
   and SHALL state on stderr that attribution was unavailable. A change whose
   ownership of a violation cannot be established is reported as owning it, never
   as exempt from it: the alternative is a silent green, which reproduces the
   "green does not mean checked" defect spec 0109 exists to remove.
4. **Requirement 12 — the two outcomes are documented.** `docs/spec-format.md`
   SHALL state which build a base-branch `status: draft` violation fails and
   which build it only warns, so that a reader who meets the warning on their own
   pull request learns from the document that it is not theirs to fix. This
   extends Requirement 7, which already obliges that document to state the
   invariant and name its enforcement.
5. **Requirement 13 — the narrowing is covered.** The behaviour of Requirements 9
   through 11 SHALL be covered by the spec linter's own test suite, with at least
   one case for each of: a change that does not touch the offender passing while
   still reporting it; a change that does touch the offender failing; and a run
   with no change relative to the base ref failing. This extends Requirement 8 to
   the cases this delta introduces, and each case fails if the behaviour it
   covers is removed.

**Scenarios.**

*Scenario:* a change that touches no spec is not failed by a base-branch draft

```text
Given a non-delta spec present on the base branch carrying status: draft
And   a change under test that modifies no file under specs/
When  the spec linter runs
Then  it names that file as a non-blocking finding
And   it exits zero
```

*Scenario:* the base branch's own build still fails

```text
Given a non-delta spec present on the base branch carrying status: draft
And   a tree under test that modifies no file relative to the base ref
When  the spec linter runs
Then  it reports a violation naming that file and exits non-zero
```

*Scenario:* attribution that cannot be derived is not an exemption

```text
Given a non-delta spec present on the base branch carrying status: draft
And   the set of files the change modifies cannot be derived from the repository
When  the spec linter runs
Then  it states on stderr that attribution was unavailable
And   it reports a violation naming that file and exits non-zero
```

**Out of scope,** extending the parent spec's own list:

- **Failing a spec-PR whose own new spec still carries `status: draft`.** The
  only moment that state is wrong is the instant before merge, and CI cannot see
  that instant: a spec-PR under review carries `draft` legitimately, which
  Requirement 2 has always exempted and this delta keeps exempt. A check that
  failed it would sit red for the whole review, training readers to merge red —
  the precise habit the incident above already cost this repository once.
- **Shortening the response time to a red base-branch build.** The build failed
  four minutes after the offending merge; the 10 h 28 was the interval before
  anyone acted on it. That is a paging and post-merge-verification question, not
  a linter question, and it is left to its own ticket.
- **Whether `lint-specs` should lint only the changed spec files rather than the
  whole corpus.** Narrowing the corpus would also remove the blast radius, and it
  would remove the cross-file duplicate-`id` check (spec 0098) with it, since
  that check needs the whole corpus by construction. Attribution is the narrower
  change and costs no existing check.
- **The base-ref wiring asymmetry between the two CI engines** tracked by issue
  #709. Attribution reads the same base ref the check already reads, so it adds
  no new dependency, and it neither fixes nor worsens that gap.

## MODIFIED

1. **Requirement 2 is replaced** so that the failure lands on a change that can
   satisfy it.

   - Original R2:

     > **R2.** The spec linter SHALL fail when a non-delta spec that is present
     > on the base branch of the change under test carries `status: draft`, and
     > SHALL name every offending file. Presence on the base branch is the
     > discriminator: a spec being introduced by the change under test is
     > legitimately `draft` up until the frontmatter edit its own merge mechanic
     > prescribes, and SHALL NOT be flagged.

   - Replacement R2:

     > **R2.** The spec linter SHALL identify every non-delta spec that is
     > present on the base branch of the change under test and carries
     > `status: draft`, and SHALL name every such file. Presence on the base
     > branch is the discriminator for *identifying* an offender: a spec being
     > introduced by the change under test is legitimately `draft` up until the
     > frontmatter edit its own merge mechanic prescribes, and SHALL NOT be
     > identified. Whether an identified offender **fails** the run is decided by
     > whether the change under test modifies that file: it SHALL fail when the
     > change modifies it, and SHALL be reported per Requirement 9 or Requirement
     > 10 when it does not.

   Requirements 1 and 3 through 8 of spec 0109, and the replacement of
   Requirement 5 by delta-01, are **UNCHANGED** and remain in force. In
   particular Requirement 1 — the invariant itself — is untouched: no non-delta
   spec on `main` may carry `status: draft`. This delta changes only which build
   is failed when one does.

2. **The scenario "a draft spec already on the base branch is rejected" is
   replaced**, because its `When`/`Then` no longer hold for a change that does
   not touch the offending file.

   - Original scenario:

     ```text
     Given a spec file present on the change's base branch carrying status: draft
     And   it is not a delta-spec
     When  the spec linter runs
     Then  it reports a violation naming that file and exits non-zero
     ```

   - Replacement scenario:

     ```text
     Given a spec file present on the change's base branch carrying status: draft
     And   it is not a delta-spec
     And   the change under test modifies that file
     When  the spec linter runs
     Then  it reports a violation naming that file and exits non-zero
     ```

   The remaining four scenarios of spec 0109 are unchanged.

## REMOVED

(None. This delta replaces one requirement and one scenario, and adds five
requirements, three scenarios and four out-of-scope items; it removes no
requirement, scenario, or out-of-scope item. Spec 0109 has no open question, and
this delta introduces none.)
