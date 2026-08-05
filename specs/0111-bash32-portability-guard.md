---
id: "0111"
slug: bash32-portability-guard
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 697
version: 1.0.0
---

# A shell script that cannot run on a stock macOS shell does not reach `main`

## Intent

A contributor who reintroduces a shell construct that the Bash shipped with
macOS does not understand is told so before the change lands, naming the
offending lines, instead of the breakage surfacing later on a maintainer's
machine as a script that aborts on its first line. And every test suite the
repository ships runs to completion on that shell, so a maintainer working there
gets an honest result rather than a green count produced by a newer shell they
happen to have installed.

## Requirements

1. The project SHALL enforce a declared set of shell constructs as forbidden in
   the governed scripts, and SHALL reject any change under test in which a
   governed script uses one of them.
2. The declared set of requirement 1 SHALL contain at least every construct that
   has already caused a governed script to abort on the stock macOS shell —
   `mapfile`, `readarray`, and associative-array declaration — and SHALL be
   recorded in one place that both the enforcement and the documentation refer
   to.
3. A rejection per requirement 1 SHALL name every offending location, each by
   file and line, rather than reporting only that a violation exists.
4. The enforcement SHALL treat a construct that a governed script *uses*
   differently from one it merely *names in prose*, so that a comment
   documenting the prohibition — or explaining that a construct was deliberately
   avoided — is not rejected.
5. The governed scripts SHALL include the repository's own test scripts, on the
   same terms as the scripts it ships.
6. Every governed script present when this spec is realised SHALL satisfy
   requirement 1 at that point, by being changed to avoid the forbidden
   construct rather than by being exempted from the check.
7. Each test suite changed under requirement 6 SHALL assert the same cases with
   the same verdicts as before the change, so the correction alters what the
   suite runs on and not what it checks.
8. Each test suite changed under requirement 6 SHALL run to completion on the
   stock macOS shell.
9. The enforcement SHALL be exercised identically by every continuous
   integration engine the project governs, so a change rejected by one is
   rejected by all.
10. The documented acknowledged-exception escape hatch SHALL remain available to
    a script that deliberately requires a newer shell, and the enforcement SHALL
    honour it.
11. The rule SHALL be documented alongside the project's existing
    scripting-convention rules, following their established structure.

## Scenarios

**Scenario:** a forbidden construct is reintroduced

```text
Given a governed script that uses none of the forbidden constructs
When  a change under test adds a line that uses one of them
Then  the change is rejected
And   the rejection names that line's file and line number
```

**Scenario:** the repository as it stands is accepted

```text
Given the repository with requirement 6 satisfied
When  the enforcement runs
Then  no violation is reported
```

**Scenario:** prose mentioning a forbidden construct is accepted

```text
Given a governed script whose comment explains that a forbidden construct was
      deliberately avoided
When  the enforcement runs
Then  that comment is not reported as a violation
```

**Scenario:** a deliberate requirement on a newer shell is accepted

```text
Given a governed script that uses a forbidden construct
And   that line carries the documented acknowledged-exception marker
When  the enforcement runs
Then  that line is not reported as a violation
```

**Scenario:** a corrected suite behaves identically on both shells

```text
Given a test suite changed under requirement 6
When  it is run on the stock macOS shell and on a newer shell
Then  it runs to completion on both
And   it reports the same set of case verdicts on both
```

**Scenario:** a test script is governed like any other

```text
Given a change under test that adds a forbidden construct to a test script
When  the enforcement runs
Then  the change is rejected on the same terms as for a shipped script
```

## Out of scope

- **The test harnesses' interpreter resolution.** Several suites invoke their
  subject as `bash "$SCRIPT"`, resolving `bash` from `PATH`, so a contributor
  with a newer Bash ahead of `/bin/bash` still exercises the subject under that
  newer shell. This spec makes the *scripts* portable and makes the enforcement
  catch regressions; it does not pin the interpreter the harnesses use. That is a
  distinct change with a blast radius across every suite, and the anchor issue
  excludes it explicitly.
- **A macOS leg on the CI matrix.** Considered and rejected in the anchor issue:
  heavier and metered differently, and it would only cover scripts some test
  actually exercises, whereas the enforcement here covers every governed script
  whether tested or not. Recorded as the rejected alternative, not a later phase.
- **Other portability classes.** GNU-versus-BSD divergence in the userland the
  scripts call out to — `sed -i`, `date -d`, `readlink -f`, `grep -P` — is a real
  and separate hazard with its own detection problem. Nothing here addresses it,
  and requirement 2's declared set is deliberately about shell-builtin
  availability rather than about external tools.
- **Shell constructs newer than the forbidden set but not yet observed to
  break.** Requirement 2 sets a floor, not a ceiling; growing the set later is an
  ordinary change to it and needs no amendment here.
- **Scripts outside the governed set.** Anything not under the directories the
  existing scripting-convention enforcement already covers stays ungoverned by
  this spec.
- **Extending `ci/ci-capabilities.yml`'s vocabulary to express environment
  variables.** A separate known defect (issue #709) with its own ticket;
  requirement 9 needs no environment variable and must not wait on it.

## Open questions

None. The one question that could have been left open — whether the existing
violations should be corrected or exempted — was settled before authoring, by
measurement and then by the maintainer. Measured on `main` at `508f3f8`: 14
occurrences across 6 files, all under `scripts/tests/`, none in a shipped script;
12 are `mapfile -t X < <(…)` and 2 are associative-array declarations used as
fixed lookup tables over literal keys, with no dynamic key access anywhere, so
the correction is mechanical. Reproduced under `/bin/bash` 3.2.57: `mapfile:
command not found` and `declare: -A: invalid option`. The maintainer chose
correction over exemption on the grounds that exempting 14 lines would both leave
six suites unrunnable on a stock macOS shell — the precise mechanism behind the
false green the anchor issue reports — and normalise an escape hatch documented
for scripts that will never run there.
