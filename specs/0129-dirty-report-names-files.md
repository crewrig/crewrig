---
id: "0129"
slug: dirty-report-names-files
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 719
version: 1.0.0
---

# The sync refusal names the files it found, never the directory holding them

## Intent

When `scripts/sync-from-upstream.sh` refuses to run because a downstream adopter has
modified an upstream-owned path, it currently reports the manifest entry it was checking.
For the 35 of 59 entries that name a directory, that means a single customized file is
reported as `scripts` — and an adopter who is told `scripts` acts on `scripts`. They align
the whole directory to upstream, run the sync, then restore the whole directory from their
previous commit, and in doing so silently revert every file upstream added or changed in
between. One reported case lost a launch-time version guard and an installer update, found
much later through unrelated test failures. After this spec the refusal names the modified
files themselves and states how to restore exactly those, so the destructive move has no
occasion to be invented.

## Requirements

1. When the guard refuses, its report SHALL name each locally modified file individually,
   at its full path relative to the repository root.
2. For a manifest entry that resolves to a directory, the report SHALL NOT name that entry.
   Only its modified members appear. An adopter restores what they are shown, so showing a
   container is what produces the over-erasure this spec exists to end.
3. The enumeration SHALL be complete: every modified member of every refusing entry is
   reported, not the first one found. A partial list sends the adopter back for a second
   refusal, and the second list is the one they act on hastily.
4. The refusal SHALL state the restoration as a targeted operation over the named files, and
   SHALL warn against restoring the containing directory. Requirement 2 removes the occasion
   for the destructive move; this requirement removes the ambiguity for an adopter who
   already knows the directory-level habit.
5. A manifest entry that resolves to a single file SHALL be reported exactly as it is today.
   Its report is already precise, and changing it would churn the one path that never had
   this defect.
6. Paths excluded under a refusing entry SHALL remain excluded from the report, unchanged
   from current behaviour. An org-owned file is not the adopter's to revert.
7. The exit status of a refusal SHALL remain unchanged.
8. The cost of the non-refusing path SHALL NOT increase. The guard already visits every
   member of every directory entry when nothing is modified, because the early exit it
   performs is only reachable once something is; completeness is therefore free where it is
   paid every run, and paid only where the adopter is already stopped.
9. A regression case SHALL cover a manifest entry that resolves to a **directory** with
   exactly one modified member, asserting that the report names that member and does not
   name the directory. The existing suite covers the dirty guard only through a manifest
   entry that resolves to a file, which is the shape that never exhibited the defect.
10. A regression case SHALL cover a directory entry with **more than one** modified member,
    asserting every one of them is named. Requirement 3 is the requirement a first-match
    implementation satisfies by accident on a single-file fixture.

## Scenarios

**Scenario:** one customized file inside a directory entry

```text
Given a manifest entry naming a directory
And   exactly one file inside it modified locally
When  the adopter runs the sync
Then  the refusal names that file at its full path
And   the refusal does not name the directory
And   the refusal states how to restore that file alone
```

**Scenario:** several customized files inside one directory entry

```text
Given a manifest entry naming a directory
And   three files inside it modified locally
When  the adopter runs the sync
Then  the refusal names all three
```

**Scenario:** the precise entry is untouched

```text
Given a manifest entry naming a single file
And   that file modified locally
When  the adopter runs the sync
Then  the refusal names that file exactly as before this spec
```

**Scenario:** nothing modified

```text
Given a manifest whose entries are all unmodified locally
When  the adopter runs the sync
Then  no refusal is raised
And   the sync proceeds
```

## Out of scope

- **Restoring the adopter's files on their behalf.** The alternative considered and declined
  at the scoping gate: the script would set the modified files aside, sync, and put them
  back, removing the manual move rather than guiding it. Declined because it changes what
  this tool is — today it never touches what the adopter wrote, it refuses instead — and an
  interruption mid-operation would leave the tree in an intermediate state. Adding a
  silent-loss risk to the script whose subject is silent loss deserves its own ticket and
  its own decision, not a clause in this one.
- **The `adopt-on-edit` and `excluded` policies.** This spec changes what a `strict` refusal
  reports. The reconciliation paths for the other two policies are untouched.
- **The manifest format.** Whether an adopter should be able to declare a policy per file
  inside a directory is a different question, and a real one; it is not this one. This spec
  makes the existing shape report honestly rather than changing the shape.
- **The wording of the guard's other diagnostics.** Only the refusal that lists modified
  paths is in scope.

## Open questions

None. The scoping question the ticket left open — whether the fix informs the adopter or
performs the restoration for them — was decided at the scoping gate in favour of informing,
and the alternative is recorded above rather than left implicit.
