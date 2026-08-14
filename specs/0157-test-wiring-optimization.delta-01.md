---
id: "0157"
slug: test-wiring-optimization
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 939
version: 1.1.0
---

# 0157 — test-wiring-optimization (delta-01)

This delta reconciles Requirement 2 with Requirement 4 of spec 0157. As
merged, R2 reads "execute only those modified suites", while R4 obliges a
change to a shared `scripts/lib/**` helper to invalidate and re-validate
**every** suite's verdict. The two requirements are in tension in the
cold-cache case: when no suite has a valid cached verdict (first run, or
after a `scripts/lib/**` change), R4 requires re-executing all cache-miss
suites, which is more than "only those modified suites". The implementation
(PR #949) resolves the tension by making the execution set the union of the
modified suites and the cache-miss suites — which equals the modified
suites in the warm-cache case, and equals the full corpus on a cold cache.
This delta makes that resolution normative so the implementation matches the
spec's letter as well as its intent.

## ADDED

1. A scenario SHALL be added to spec 0157 → `## Scenarios` recording the
   cold-cache execution-set contract:

   ```text
   **Scenario:** cold cache re-executes all cache-miss suites

   Given a strays-check invocation with no valid cached verdict for any
         test suite (first run, or after a `scripts/lib/**` change)
   When  the step runs
   Then  every suite whose verdict is a cache-miss is executed, in
         parallel
   and   the step does not silently skip any suite
   ```

## MODIFIED

1. **`specs/0157-test-wiring-optimization.md` → `## Requirements` →
   Requirement 2.**

   Original:

   > When the changeset modifies one or more test suites under
   > `scripts/tests/`, the strays check SHALL execute only those
   > modified suites, not the full corpus of suites.

   Replacement:

   > The strays check SHALL execute the union of (a) the test suites
   > under `scripts/tests/` modified by the changeset and (b) every
   > test suite whose cached verdict is a cache-miss. When the cache
   > is warm and only a subset of suites is modified, this set is
   > exactly the modified suites; on a cold cache (first run, or
   > after a `scripts/lib/**` change per Requirement 4) it is the
   > full corpus of cache-miss suites.

2. **`specs/0157-test-wiring-optimization.md` → `## Scenarios` → existing
   scenario *"changeset edits a single test suite"* (the Then-clause).**

   Original:

   ```text
   Then only `test-foo.sh` is executed and scanned for stray commands
   ```

   Replacement:

   ```text
   Then only `test-foo.sh` is executed and scanned for stray commands
   (its verdict is a cache-miss; every other suite's verdict is served
   from cache)
   ```

## REMOVED

(None. The execution-set semantics are clarified, not retracted; no
requirement of spec 0157 is deleted.)
