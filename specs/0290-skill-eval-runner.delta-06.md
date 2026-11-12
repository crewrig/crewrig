---
id: "0290"
slug: skill-eval-runner
status: draft
complexity: trivial
interaction-mode: INTERMEDIATE
related-issue: 1902
version: 3.1.1
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 06 of `specs/0290-skill-eval-runner.md`, building on delta-01 to delta-05. Source: issue #1902, found while writing the tests of delta-05. The acceptance clause of requirement 49 states that a quote that changes one word of a real excerpt, and a quote whose pieces occur out of order, are rejected. That is true only when no verbatim run of the evidence reaches both floors of rule 3; the implemented and specified rule accepts a long quote with one altered word, and long pieces in the wrong order, because rule 3 ignores the pieces' order and tolerates unmatched words up to 70 percent of the evidence. The version bump is PATCH: a clarification of an acceptance clause, no requirement changes. Requirements modified: R49 (acceptance only). This delta opens no question.*

## ADDED

None.

## MODIFIED

**R49 (evidence matching), as added by delta-05.** Original acceptance: "...a quote that changes one word of a real excerpt, a quote whose pieces occur out of order, a piece shorter than 12 letters and digits next to an ellipsis, a 39-letter-and-digit verbatim run inside invented text, ... are all rejected; ..." Replacement: a quote that changes one word of a real excerpt, and a quote whose real pieces occur out of order, are rejected when no run of consecutive words of the evidence that occurs verbatim in the material holds at least 40 letters and digits and at least 30 percent of the evidence's letters and digits, for instance when the excerpt is short; the same alterations in a long excerpt that leaves such a run are accepted by rule 3. This is intended: rule 3 proves that the evidence is grounded in the run's real output, not that it is faithful to it, and the exact check never proved more. The other cases of the acceptance clause stand (a piece shorter than 12 letters and digits next to an ellipsis, a 39-letter-and-digit verbatim run inside invented text, a verbatim run inside a much longer invented claim, a paraphrase sharing no 40-character run, the 40-letter-and-digit and 30-percent boundaries on both sides).
    Acceptance: a one-word change in a quote of two verbatim runs of 22 and 18 letters and digits is rejected; two real pieces of 22 and 27 letters and digits in reverse order are rejected; both are accepted by the exact rule in their original form.

## REMOVED

None.

## Scenarios

**Scenario:** a short quote with one altered word is rejected

```text
Given a produced spec that holds "Given the widgets service fails after part of the list"
When  the judge's evidence reads "Given the widgets service succeeds after part of the list"
Then  the longest verbatim run is 22 letters and digits, below 40, and the evidence is unsupported
```

## Out of scope

- Any change to the matching rules, their figures or the code: the delta states what the implementation does.
