---
id: "0122"
slug: signed-graft-commit
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 756
version: 1.0.0
---

# The synchronization's own commit is signed wherever the fork signs

## Intent

An organization whose fork signs the commits it creates, and which
synchronizes core-layer content from the upstream project while keeping the
upstream history reachable, ends a synchronization with every commit on its
branch signed — including the one commit the synchronization itself authors.
Today that one commit lands unsigned, and nothing in the run says so: a
branch-protection rule that demands signed commits rejects the resulting
push, so the synchronization cannot complete without manual repair, and
where no such rule is enforced the pull request instead shows a single
unverified commit sitting in the middle of an otherwise verified history, on
both GitHub and Gitea. After this change the operator sees neither the
unverified commit nor a silent degradation into one; a fork that does not
sign its commits notices no difference whatsoever; and the upstream commits
the synchronization brings in are left exactly as upstream published them,
so the ancestry the history-preserving mode exists to establish continues to
hold.

## Requirements

1. The single commit that `scripts/sync-from-upstream.sh` creates under its
   `--preserve-history` mode SHALL carry the same signature status as any
   other commit that same repository would create at that moment.

2. In a repository whose configuration causes the commits it creates to be
   signed, the commit created under `--preserve-history` SHALL be signed
   under the signing identity that repository designates for its own
   commits.

3. In a repository whose configuration does not cause the commits it creates
   to be signed, `--preserve-history` SHALL produce that commit unsigned,
   SHALL request no operator interaction it does not request today, and
   SHALL introduce no failure mode it does not exhibit today.

4. When the repository's configuration calls for a signature that cannot be
   produced in the operator's environment, `scripts/sync-from-upstream.sh`
   SHALL abort the history-preserving step: it SHALL create no commit, SHALL
   leave the branch tip where it stood at invocation, SHALL leave the
   already-restored files in the working tree, SHALL print a message
   identifying the unproducible signature as the cause, and SHALL exit
   non-zero.

5. `scripts/sync-from-upstream.sh` SHALL NOT report a successful
   history-preserving synchronization whose commit carries a signature
   status other than the one the repository's configuration calls for;
   degrading to an unsigned commit SHALL NOT be an outcome the script
   accepts, whether or not it warns while doing so.

6. The commit created under `--preserve-history` SHALL retain both parents it
   carries today — the branch tip as it stood at invocation, and the fetched
   upstream commit — so that the fetched upstream commit remains an ancestor
   of the branch tip.

7. `scripts/sync-from-upstream.sh` SHALL NOT rewrite, re-create, or re-sign
   any commit it imports from the upstream project; every such commit SHALL
   keep the identifier it carries upstream.

8. The history-preserving no-op path — the case where the fetched upstream
   commit is already an ancestor of the branch tip, so no commit is created
   at all — SHALL continue to exit zero whether or not the repository is able
   to produce a signature.

9. The regression-test suite for `scripts/sync-from-upstream.sh` SHALL be
   extended with at least one case covering each of: a signing repository
   (Requirements 1, 2, 6, 7), a non-signing repository (Requirement 3), and
   the calls-for-a-signature-but-cannot-produce-one refusal (Requirements 4
   and 5).

## Scenarios

**Scenario:** a fork that signs its commits gets a signed graft commit

```text
Given a fork whose configuration causes the commits it creates to be signed
And   a fetched upstream commit that is not yet an ancestor of its branch tip
When  the operator runs the synchronization in history-preserving mode
Then  the one commit the run creates is signed
And   that commit carries both parents — the prior branch tip and the
      fetched upstream commit
And   every upstream commit the run brings in keeps the identifier it
      carries upstream
And   the run exits zero
```

**Scenario:** a fork that does not sign its commits is unaffected

```text
Given a fork whose configuration does not cause the commits it creates to be
      signed
When  the operator runs the synchronization in history-preserving mode
Then  the one commit the run creates is unsigned, exactly as before this
      change
And   no operator interaction is requested that was not requested before
And   the run exits zero
```

**Scenario:** the configuration calls for a signature that cannot be produced

```text
Given a fork whose configuration calls for signed commits
And   an environment in which that signature cannot be produced
When  the operator runs the synchronization in history-preserving mode
Then  no commit is created
And   the branch tip stands where it stood at invocation
And   the restored files remain in the working tree
And   the run prints a message naming the unproducible signature as the cause
And   the run exits non-zero
```

**Scenario:** nothing to graft leaves nothing to sign

```text
Given a fork whose configuration calls for signed commits
And   a fetched upstream commit already an ancestor of its branch tip
When  the operator runs the synchronization in history-preserving mode
Then  no commit is created
And   the run exits zero, whether or not that fork can produce a signature
```

## Out of scope

- Re-signing, rewriting, or otherwise altering the commits imported from the
  upstream project. Requirement 7 forbids it outright: changing their
  identifiers destroys the `git merge-base --is-ancestor` relationship that
  spec 0086's `--preserve-history` mode exists to establish.
- The ordinary synchronization path — `scripts/sync-from-upstream.sh` without
  `--preserve-history` — which authors no commit at all and therefore has no
  signature to carry.
- Verifying signatures: trust roots, allowed-signers files, key
  distribution, and any check that a signature is valid or attributable to a
  permitted signer. This spec governs whether a signature is produced, never
  whether anyone can validate it.
- Suppressing or removing any credential interaction — passphrase entry,
  agent prompt — that the repository's ordinary commit creation already
  requires. The history-preserving mode inherits that interaction unchanged,
  consistent with `scripts/sync-from-upstream.sh` remaining a manual,
  operator-invoked tool.
- An operator-facing means to skip signing for this one commit in a
  repository configured to sign. No such need has been reported, and
  Requirement 5 deliberately forecloses the unsigned outcome.
- Any change to which paths the synchronization restores, to the per-path
  policy resolution (`strict` / `adopt-on-edit` / `excluded`), or to the
  marker bookkeeping under `.crewrig/.synced-markers/` — all reused
  unmodified from specs 0016, 0020, and 0086.
- Signing any object the script does not author: tags, notes, and the
  upstream commits themselves.

## Open questions

None. One question was carried while drafting — whether Requirement 4's refusal
belongs *after* the policy-aware restore, matching the posture spec 0086
Requirement 8 established for the anti-pollution guard, or *before* it, matching
the fail-fast shape spec 0086 Requirement 12 uses for a shallow clone. It is
closed in writing on the logbook issue, per `docs/spec-format.md` → *Mandatory
body sections → 5*, in favour of the post-restore placement: the operator's
recovery path is identical either way and already documented, a capability probe
costs a credential interaction on every history-preserving run of every signing
fork including the successful ones, and signing capability is a condition
discovered while doing the work rather than one knowable for free beforehand.
Closure: <https://github.com/crewrig/crewrig/issues/756#issuecomment-5246352615>
