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

## Worktree pointer

The *Worktree Isolation* rule (see *Agent Team Protocol → Worktree
Isolation*) applies unchanged to both `spec/*` and the corresponding
implementation branch — each PR runs in its own dedicated worktree.
