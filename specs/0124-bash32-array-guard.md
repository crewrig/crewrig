---
id: "0124"
slug: bash32-array-guard
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 798
version: 1.0.0
---

# An unguarded array value expansion does not reach `main`

## Intent

A contributor who reintroduces an unguarded array value expansion — the
empty-array trap that aborts under `set -u` on the Bash shipped with macOS — is
told so before the change lands, naming the offending lines, instead of the
breakage surfacing later on a maintainer's machine as a script that aborts on an
empty array. Today the trap is enforced only for the six suites corrected under
spec 0111, and only inside a test case; a regression in any other governed
script is green in CI (which runs a newer Bash) and broken for every macOS
contributor.

## Requirements

1. The project SHALL enforce, across every governed script, that no array value
   expansion is unguarded, and SHALL reject any change under test in which a
   governed script uses one.
2. An array value expansion SHALL be considered guarded when it is written in a
   form that does not abort on an empty array under `set -u` on the Bash shipped
   with macOS — the canonical guard `${name[@]+"${name[@]}"}` and its
   `${name[*]+"${name[*]}"}` counterpart, a default-valued form `${name[*]:-…}`,
   a length form `${#name[@]}`, a slice form `${name[@]:…}`, or a key form
   `${!name[@]}` — and unguarded otherwise.
3. A rejection per requirement 1 SHALL name every offending location, each by
   file and line, rather than reporting only that a violation exists.
4. The enforcement SHALL treat an expansion that a governed script *uses*
   differently from one it merely *names in prose*, so that a comment documenting
   the prohibition — or explaining that a construct was deliberately avoided — is
   not rejected.
5. The detection SHALL be the consumption-based model already established in the
   repository — counting closed forms and subtracting only those a complete
   canonical guard accounts for — and SHALL NOT introduce a different detection
   model.
6. The detection SHALL be probed by the same fixtures that probe it today, so a
   change to the detection that reopens a previously-closed hole fails in CI.
7. The governed scripts SHALL include the repository's own test scripts, on the
   same terms as the scripts it ships.
8. Every governed script present when this spec is realised SHALL satisfy
   requirement 1 at that point, by being changed to guard its array value
   expansions rather than by being exempted from the check.
9. The enforcement SHALL be exercised identically by every continuous
   integration engine the project governs, so a change rejected by one is
   rejected by all.
10. The documented acknowledged-exception escape hatch SHALL remain available to
    a script that deliberately requires a newer shell, and the enforcement SHALL
    honour it.
11. The rule SHALL be documented alongside the project's existing
    scripting-convention rules, following their established structure.

## Scenarios

**Scenario:** a guarded script is accepted

```text
Given a governed script whose every array value expansion is guarded
When  the enforcement runs
Then  no violation is reported
```

**Scenario:** an unguarded expansion is reintroduced

```text
Given a governed script that uses none of the unguarded forms
When  a change under test adds a line that uses one
Then  the change is rejected
And   the rejection names that line's file and line number
```

**Scenario:** prose mentioning an unguarded expansion is accepted

```text
Given a governed script whose comment explains that an unguarded expansion was
      deliberately avoided
When  the enforcement runs
Then  that comment is not reported as a violation
```

**Scenario:** a deliberate requirement on a newer shell is accepted

```text
Given a governed script that uses an unguarded expansion
And   that line carries the documented acknowledged-exception marker
When  the enforcement runs
Then  that line is not reported as a violation
```

**Scenario:** the detection is probed

```text
Given the fixtures that probe the detection model
When  the enforcement's test suite runs
Then  every fixture reports the verdict it reports today
```

**Scenario:** a test script is governed like any other

```text
Given a change under test that adds an unguarded expansion to a test script
When  the enforcement runs
Then  the change is rejected on the same terms as for a shipped script
```

**Scenario:** the repository as it stands is accepted

```text
Given the repository with requirement 8 satisfied
When  the enforcement runs
Then  no violation is reported
```

## Out of scope

- **The declared-set grep check.** Requirement 2 of spec 0111 — the forbidden
  constructs `mapfile`, `readarray`, and associative-array declaration — is
  untouched by this spec. The array-guard is a separate detection mechanism
  layered on the same enforcement, not a replacement for the declared set.
- **The six suites corrected under spec 0111.** They are already guard-clean;
  this spec extends the enforcement to every governed script, not just those six.
- **Whole-array-as-scalar and indexed expansions.** `${name}` and `${name[0]}`
  also abort on an empty array under `set -u` on the stock shell, but they are a
  distinct, larger class with their own detection problem. This spec is scoped to
  the `[@]`/`[*]` value expansions the established detector already handles.
- **Other portability classes.** GNU-versus-BSD divergence in the userland the
  scripts call out to — `sed -i`, `date -d`, `readlink -f`, `grep -P` — is a real
  and separate hazard with its own detection problem. Nothing here addresses it.
- **The test harnesses' interpreter resolution.** Several suites invoke their
  subject as `bash "$SCRIPT"`, resolving `bash` from `PATH`, so a contributor
  with a newer Bash ahead of `/bin/bash` still exercises the subject under that
  newer shell. This spec makes the *scripts* guard-clean and makes the
  enforcement catch regressions; it does not pin the interpreter the harnesses
  use.
- **Scripts outside the governed set.** Anything not under the directories the
  existing scripting-convention enforcement already covers stays ungoverned by
  this spec.
- **The per-occurrence choice of safe form.** The uniform-guarding decision is
  settled here; which safe form each existing occurrence adopts is a DEV-stage
  detail, not a spec decision.

## Open questions

None. The one question that could have been left open — whether the existing
unguarded expansions should be corrected or exempted — was settled before
authoring, by measurement and then by the maintainer. Measured on `main` at
`f7fbc84`: 117 unguarded array value expansions across the governed tree, most on
arrays that are provably non-empty at the point of use, a minority on
accumulators that can be empty. The maintainer chose uniform guarding over
exemption on the grounds that exempting the provably-non-empty majority would
leave the enforcement unable to distinguish them from the genuinely hazardous
accumulators, and would normalise an escape hatch documented for scripts that
will never run on the stock shell.
