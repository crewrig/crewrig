---
id: "0120"
slug: bash32-declared-set-single-parser
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 721
version: 1.0.0
---

# The forbidden-construct set has one reader, and the sync check consumes it

## Intent

A maintainer who corrects how the repository's declared set of forbidden shell
constructs is read has exactly one place to correct. Today the portability
enforcement and the test case that checks the declared set against the written
scripting conventions each read that set independently, and the two readings
already disagree about where one row's fields end and the next begin — so a
malformed row draws one honest refusal and one misleading extra complaint inside
the same failing run, and nothing tells a maintainer that a second reader exists
at all. After this change the enforcement is the sole authority on what the
declared set contains: it can be asked what it read, and the synchronisation
check works from that answer instead of forming its own.

## Requirements

1. The repository SHALL contain exactly one interpretation of the declared set's
   row format. Every consumer of the declared set's contents SHALL obtain those
   contents from the enforcement, and SHALL NOT interpret the declared set
   itself.
2. The contents the enforcement reports SHALL carry, for each declared
   construct, both the kind it is declared under and its token, so that a
   consumer can form the same per-kind expectation the synchronisation check
   forms today.
3. Asking the enforcement for the declared set's contents SHALL NOT scan the
   governed tree and SHALL NOT report a portability verdict.
4. The enforcement's verdict behaviour SHALL be unchanged for a caller that does
   not ask for the declared set's contents — the same verdicts, the same
   reported locations, and the same outcomes as before this change.
5. Any declared set the enforcement refuses when asked for a portability verdict
   SHALL be refused, with the same non-zero outcome, when it is asked for the
   declared set's contents; and the converse SHALL hold. Neither request SHALL
   accept a declared set the other refuses.
6. The synchronisation check SHALL fail when the reported contents hold no
   construct, and SHALL fail when the enforcement cannot be asked at all; it
   SHALL report which of those two occurred.
7. The synchronisation check SHALL continue to fail when a declared construct is
   absent from the documented scripting conventions, and SHALL name the absent
   construct in the form those conventions are expected to carry it.
8. Requirement 2 of spec 0111 — the declared set recorded in one place that both
   the enforcement and the documentation refer to — SHALL continue to hold.
9. Every other case in the enforcement's test suite SHALL assert the same cases
   with the same verdicts as before this change, so the correction alters where
   the synchronisation check obtains its input and not what the suite checks.
10. The changed test suite SHALL run to completion on the stock macOS shell.

## Scenarios

**Scenario:** the declared set and the written conventions agree

```text
Given a declared set whose every construct is named in the documented scripting
      conventions
When  the synchronisation check runs
Then  it reports success
And   the number of constructs it compared is the number the enforcement reports
```

**Scenario:** only one reader of the declared set remains

```text
Given the repository after this change
When  it is examined for where the declared set's row format is interpreted
Then  exactly one interpretation is found
And   the synchronisation check is not that interpretation
```

**Scenario:** the verdict path is untouched

```text
Given the repository as it stands
When  the enforcement runs without being asked for the declared set's contents
Then  it reports the same portability verdict, on the same terms, as before this
      change
```

**Scenario:** a declared construct is absent from the written conventions

```text
Given a declared set holding a construct the documented scripting conventions do
      not name
When  the synchronisation check runs
Then  it fails
And   it names that construct in the form the conventions are expected to carry
      it
```

**Scenario:** a malformed row is refused on both requests

```text
Given a declared set holding a row whose token field is empty
When  the enforcement is asked for the declared set's contents
Then  it refuses with the same non-zero outcome as when asked for a portability
      verdict
And   it reports no construct
```

**Scenario:** an empty declared set does not pass the sync check vacuously

```text
Given a declared set that declares no construct
When  the synchronisation check runs
Then  it fails
And   it does not report success on the ground that no construct was found to be
      missing
```

## Out of scope

- **The array-expansion detector and the cases that probe it.** `bare_expansions_in`
  and cases h and i of the enforcement's test suite are untouched here.
- **The enforcement's own reading rules and verdict behaviour.** Its row format,
  its token validation, its command-position anchor, the tree it scans, and the
  exit codes of its verdict path were all settled across the seven review
  iterations of issue #697. Requirement 1 makes that reading the single
  authority; it does not reopen what the reading does.
- **The content of the declared set and of the written conventions.** Neither
  `ci/bash32-forbidden.txt` nor Rule 5 of `docs/scripting-conventions.md` gains
  or loses an entry here. Growing the declared set stays an ordinary change to
  those two files, per spec 0111 requirement 2's floor-not-ceiling clause.
- **The prose restatement in the written conventions is not a consumer.** Rule 5
  names the same tokens in prose deliberately, and that duplication is precisely
  what the synchronisation check exists to police. Requirement 1 does not ask
  for it to be removed, generated, or otherwise derived.
- **Every other guard-and-test pair in the repository.** Whether any of them
  duplicates a reading the same way is a separate question with its own
  evidence; nothing here surveys them or binds them.
- **Multi-CLI build outputs.** This ticket touches no source under `artifacts/`,
  so no rebuild of the per-CLI components is implied.

## Open questions

None. The one question that could have been left open — whether the cheaper
correction, teaching the synchronisation check to read the declared set the same
way the enforcement does, would suffice — is settled by requirement 1 rather than
deferred. That correction leaves two readings in the repository and therefore
leaves the reported cost of issue #721 in place: a maintainer fixing the reading
still has two places to fix, and still nothing tells them so.
