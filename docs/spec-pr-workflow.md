<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Spec-PR workflow

<!-- crewrig-doc: published=false -->

This keeps the WHAT auditable as a standalone diff and decouples the
qualification timeline from the realization timeline.

## One-file rule

A spec-branch SHALL contain **exactly one new file** under `/specs/`
and nothing else. No co-mingling with implementation edits, no
incidental fixes, no build outputs. The rationale: the spec-PR is the
auditable artifact of qualification — its diff must be reviewable as a
self-contained WHAT, without the reader having to mentally subtract
unrelated changes.

## Ordering rule

The spec-PR MUST merge to `main` **before** the implementation branch
is cut. The four valid implementation-branch prefixes — `feat/`,
`fix/`, `docs/`, `refactor/` — all follow the `<prefix>/<NNNN>-<slug>`
suffix convention so that implementation work traces back to its spec
id by branch name alone. Cutting an implementation branch while the
corresponding spec-PR is still open is a process violation; the
*Retroactive review loop* surfaces this as a `class: tech` finding
(see the rule there).

## Reserving the spec id

The spec id is **secured before the spec branch is created**, and therefore
before the spec file exists. Run the tool as the first act of the SPECS
stage, with nothing written yet:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts --issue <related-issue>
```

The first line of stdout is the id. Only then cut `spec/<NNNN>-<slug>` and
write `specs/<NNNN>-<slug>.md`, so that the branch name, the filename and
the frontmatter `id` agree from the first commit rather than being
reconciled later.

Why this and not `max(existing) + 1`: two sessions picking up two tickets in
the same second read the same maximum and walk away with the same number.
The collision is then discovered by an unrelated third pull request *after*
both offending specs have merged, and by that point the id is carried by an
issue, a branch name, a pull-request title and a logbook. A reservation is a
git object pushed to a ref under a dedicated namespace, and the remote's
create-only compare-and-swap means exactly one of two racing sessions gets
it; the loser is refused and retries automatically.
`specs/0112-spec-id-reservation.md` is the full contract.

Ids are never reused and a gap in the sequence is fine. An abandoned
reservation is harmless: no expiry, no reclamation pass, no release protocol.

### Pre-allocating an id for a sibling session

An orchestrating session that spawns sibling sessions for parallel tickets
sometimes wants to tell a sibling, in its kickoff brief, which spec id it
will use — for example so the sibling's branch name is known before that
sibling ever runs `spec-author`. That claim is only true once the
orchestrator has actually run:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts --id <NNNN> --issue <sibling-issue>
```

for that id, in the same step it creates the sibling's branch or spawns the
sibling session — **before** communicating the "reserved" claim. Asserting a
computed or predicted id in a brief, without this command actually securing
it, was exactly the friction issue #1265 (`specs/0112-spec-id-reservation.delta-02.md`)
exists to close: `git ls-remote` at the time showed no reservation for
either claimed id.

Once secured this way, the sibling session's ordinary `spec-author`
invocation — `reserve-spec-id.ts --issue <sibling-issue>`, with no `--id`,
per its unchanged contract (`artifacts/core/skills/spec-author/SKILL.md` →
*ID allocation*) — reuses that exact id instead of computing a new one, per
spec 0112 delta-02 requirements 17-18. Nothing else has to change on the
sibling's side: it does not need to know, or trust, that a reservation was
pre-made — the tool tells it.

### Offline, and contributing from a fork

Both cases reach the same exit code, `3`: the id is allocated locally but
**not** secured, because either there was no remote to reach or the author
holds no write access to the reference repository. The tool prints the id and
then, as a structured field, the mark to carry:

```text
unsecured-id: true
```

Copy that line verbatim into the spec frontmatter. It is not optional and it
is not cosmetic — it is the machine-readable statement that another session
may still take the id, and it is what `scripts/check-spec-id-reserved.ts`
reads at pull-request time. That check discriminates by origin:

- a pull request from a branch of the reference repository **fails** on an
  unsecured id;
- a pull request from a **fork** has the condition reported without blocking,
  because its author could not have secured it.

**The maintainer's obligation.** Before merging a fork contribution, a
maintainer secures the id and removes the mark in the same act:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts --id <NNNN> --issue <related-issue>
```

Re-running that command for an id already secured for the same issue is a
no-op that exits `0`. If the id turns out to be held by a *different* ticket,
the command exits `1` naming both tickets — that is the collision surfacing
before merge instead of after, which is the whole point.

### Changing the carrier namespace

Which ref namespace holds reservations is named by `.crewrig/spec-id-carrier`,
a tracked file in this repository, and the value is constrained to a closed
pair:

| Value | Notes |
|---|---|
| `refs/spec-ids/` | The shipped default. Invisible in branch and tag listings; no CI wakes on it. |
| `refs/tags/spec-id/` | For a remote that refuses a custom top-level namespace. Visible in the tag listing. |

An adopter whose remote refuses the default changes that one line, by pull
request, and `scripts/sync-from-upstream.ts` never touches it again (the entry
is `excluded`). Anything outside the pair — including the near miss
`refs/spec-id/` — exits `1` naming the offending value, because a third
namespace would be written by the push and read by neither the allocation
union nor the pull-request check.

The setting is repository-scoped **on purpose**, and not an environment
variable each contributor exports. The compare-and-swap locks a *ref*, not an
*id*: two contributors with divergent carriers both succeed and both walk away
with the same id, on an ordinary remote where both namespaces work. A
convention that has to hold across strangers forking a public framework is not
a guarantee. `CREWRIG_SPEC_ID_CARRIER` survives only as a one-off override for a single
invocation, for debugging — never as the configuration route.

### Securing an identifier for a spec under `specs/org/`

`specs/org/` is the org-owned overlay, and upstream deliberately does not know
its numbering convention (`specs/0071-org-specs-lint-exclusion.md`). So
upstream cannot compute the next free org identifier, and does not try. It
secures an identifier the organization has already chosen:

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/reserve-spec-id.ts --corpus org --id <ORG-IDENTIFIER> --issue <N>
```

`--corpus org` **requires** `--id`; without it the command exits `1` saying so,
rather than silently falling back to an upstream computation and handing back a
number from the wrong corpus. The corpus is always told, never inferred from
the identifier's shape — inferring it would mean upstream recognising an org
convention, which is exactly the layer boundary spec 0071 drew.

Org reservations live in the **sibling** namespace of the configured carrier
(`refs/spec-ids-org/` or `refs/tags/spec-id-org/`), never a child of it. That is
load-bearing rather than stylistic: an `ls-remote` pattern's `*` crosses `/`, so
a nested `refs/spec-ids/org/<ID>` would be returned by a read of
`refs/spec-ids/*` and org reservations would appear inside the upstream
allocated set they are required to stay out of. As siblings, an upstream `0042`
and an org `0042` coexist without either read seeing the other, and a spec under
`specs/org/` is never failed by the upstream pull-request check.

**One constraint to know before designing a convention.** A reservation *is* a
git ref, so an identifier must be nameable as one. An identifier containing a
space, a `..` sequence, a `~`, a `^`, a `:`, a `?`, a `*`, a `[`, a backslash, or
a trailing `.lock` **cannot be secured at all** — the command exits `1` naming
the identifier and the constraint, before any push. This is not a narrowing of
the opaque-string contract: nothing in the tooling parses or interprets an
identifier. It is a statement of what the carrier can physically hold, and it is
surfaced here because an organization needs it *before* it settles on a
convention, not at first use. There is deliberately no encoding scheme: encoding
would make the stored identifier differ from the written one and reintroduce a
mapping nobody asked for.

## Independence rule

The spec-PR and the implementation-PR are **independent pull
requests**: each closes its own GitHub issue via its own
`Closes #<related-issue>` directive, and the implementation-PR MUST
NOT auto-close the spec-PR. Treating them as a single coupled unit
would defeat the purpose of the two-PR flow — qualification and
realization are deliberately separated so that a merged spec can
outlive a failed implementation attempt and be re-realized by a
later PR without information loss.

That "closes its own issue" default assumes a dedicated logbook issue
exists apart from the spec's `related-issue`. When the `related-issue`
is instead the ticket's shared logbook issue — the common case under
*Logbook Issues → Rule A*, where no separate dedicated logbook issue
exists — the spec-PR body SHALL NOT carry any closing-keyword
directive for that issue: no `Closes #<N>`, `Fixes #<N>`, or
`Resolves #<N>`, in any phrasing. Merging the spec-PR under that
directive would close the ticket's own journal mid-flight, well before
PLAN, DEV, and REVIEW have even run.

Rewording the sentence around the closing keyword does not sidestep
this. GitHub's closing-keyword parser matches the literal adjacent
token pattern (`close|fix|resolve #<N>`) regardless of the surrounding
sentence's meaning, so a negated sentence such as "this spec-PR closes
no issue on merge; `#<N>` stays open" still auto-closes `#<N>` on
merge. The carve-out is therefore a hard rule, not a discouraged
practice: the spec-PR body must instead use a non-adjacent reference —
"Related `#<N>`" or "the implementation PR (tracking `#<N>`) will
close it on merge" — anything that keeps a closing keyword and the
issue number from landing next to each other.

When the spec's `related-issue` is *not* the shared logbook issue — a
dedicated logbook issue exists separately, per Rule A's second
paragraph — today's rule continues unchanged: each PR closes its own
`related-issue` via its own closing directive. Either way, only the
implementation-PR ever carries the closing directive for the shared
logbook issue itself, consistent with *Logbook Issues → Rule C*.

## Delta-spec cumulative rule

A single implementation-PR MAY absorb **N delta-spec PRs** targeting
the same ticket. Delta-specs accumulate on `main` as immutable
amendments to the original spec; the implementation-PR realizes the
union of the original spec plus every merged delta. The originating
loop iteration is defined in the *Retroactive review loop* section
below — a `spec`-class finding produces a new delta-spec PR before
the implementation-PR is retried.

## Draft-PR procedure

Contract: `specs/0168-spec-status-transition-enforcement.delta-01.md`
(R7-R16). A spec-PR or delta spec-PR is opened as a **Draft PR/MR** while the
spec is `status: draft`, so the spec linter tolerates the draft status until
approval. The procedure is identical on every CLI.

1. **Open as draft:** `gh pr create --draft` (GitHub) or
   `glab mr create --draft` (GitLab).
2. After the approval event, in order: (a) commit the flip to
   `status: approved` with `interaction-mode` as a new commit; (b) `git push`;
   (c) mark ready with `gh pr ready` or `glab mr update --ready`; (d) wait
   for the CI run created by the ready transition to be green; (e) only then
   merge (`node scripts/merge-spec-pr.ts`).

**The signal.** `scripts/lib/spec-linter.js` reads `CREWRIG_PR_DRAFT`. Only the
exact value `true` skips requirement 1 of spec 0168 (the `newDraftOffenders`
check), with a non-failing `[NOTICE]` naming each tolerated file. Absent,
empty, `false` or any other value leaves it enforced. Every other check runs
unchanged. GitHub sets the variable from `github.event.pull_request.draft`;
`build.yml` re-runs on `ready_for_review` and `converted_to_draft`.

**GitHub residual.** A re-run replays the original event payload, so a re-run
of a run created while the PR was draft keeps `CREWRIG_PR_DRAFT=true` and can
end green after the PR was marked ready. Step (d) therefore uses the run
created by the ready transition, never a re-run of a draft-era run.

**GitLab.** `CI_MERGE_REQUEST_DRAFT` (introduced in GitLab 17.10, the minimum
for this feature; an older instance leaves the variable undefined, which means
not draft) maps onto `CREWRIG_PR_DRAFT` in `ci/ci-capabilities.yml`. The
variable is fixed at pipeline creation, and marking an MR ready is not
documented to create a pipeline, so the head pipeline may be a stale
draft-era one (R12). Step (d) requires a fresh merge-request pipeline: create
it with the merge-request pipeline creation API, using a single mechanism:

```sh
glab api --method POST projects/:id/merge_requests/<iid>/pipelines
```

Sources: `https://docs.gitlab.com/api/merge_requests/` (create merge request
pipeline) and `https://docs.gitlab.com/ci/variables/predefined_variables/`
(`CI_MERGE_REQUEST_DRAFT`). The endpoint and the 17.10 claim match those pages
but are documented, not live-verified against a GitLab instance.

**Gitea.** To our knowledge `tea pulls create` offers no `--draft` flag, so the
Draft path is documented as unavailable there and requirement 1 applies
unchanged: the spec must already be `approved` when the PR opens. No WIP-title
heuristic is used.

**Merge wrapper.** `scripts/merge-spec-pr.ts` refuses a PR that is still a draft
(`gh pr view --json isDraft`), naming the readiness step. It fails open if
`gh` fails, GitHub itself refuses to merge a draft PR, and the wrapper does not
check that the run post-dates the ready transition (R15 timestamp check not
implemented): step (d) is procedural.

## Worktree pointer

The *Worktree Isolation* rule (see *Agent Team Protocol → Worktree
Isolation*) applies unchanged to both `spec/*` and the corresponding
implementation branch — each PR runs in its own dedicated worktree.
