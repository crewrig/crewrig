---
id: "0293"
slug: skill-authoring-standard
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1848
version: 1.1.0
---

# Define the skill authoring standard v2 and the linter that enforces it

## ADDED

- **R22 (a conflict halts the implementation).** When the implementation finds that a skill named in R21 breaks a rule that R17 requires the linter to enforce, the implementation SHALL stop and report the conflict as a `spec`-class finding. It SHALL NOT change which rules are enforced, and it SHALL NOT downgrade a rule to guidance to make a skill pass; the change is made by a delta-spec.

**Scenario:** a rule breaks a protected skill

```text
Given the linter enforces a rule that pr-logbook, a skill that ships evals, breaks
When  the implementation runs the linter on the repository
Then  the work stops, a spec-class finding names the rule and the skill, and no rule is downgraded
```

## MODIFIED

- R7 said "at least three evals and at least six trigger probes of which each of the positive and the negative kinds is at least 40 percent". It now reads: "at least three evals and at least five trigger probes of which each of the positive and the negative kinds is at least 40 percent". The skill that the pilot already protects ships five probes, three positive and two negative, so a minimum of six would make the pilot fail the standard it informed; the standard keeps advising more probes and at least five evals as guidance.
- R8 said the linter reports "a citation of the forms `spec <NNNN>`, `R<N>` and `#<N>` outside code spans and fences". It now reads: "a citation of the forms `spec <NNNN>`, `R<N>`, a number sign and digits introduced by one of the words `issue`, `ticket`, `PR`, `pull request`, `bug`, `refs`, `closes`, `fixes` (matched case-insensitively), and a number sign and digits alone in parentheses, outside code spans and fences". A runtime example such as `Task #2` or the placeholder `#N` is therefore not a citation, because it names no issue or specification.

## REMOVED

- Nothing.
