---
id: "0199"
slug: org-model-mapping-override
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1119
version: 1.0.0
---

# Organization-level override channel for model mappings

Authored for issue #1119, seam (e) of epic #1100 (CLI-agnostic model
declaration for subagents). Four seams are on `main`: the capability-profile
vocabulary ([`specs/0195-agent-capability-profile.md`](0195-agent-capability-profile.md),
`bdfdd8c`), the spec 0143 delta
([`specs/0143-copilot-subagent-model-fallback.delta-01.md`](0143-copilot-subagent-model-fallback.delta-01.md),
`b565e87`), the four core default mappings
([`specs/0197-model-mapping.md`](0197-model-mapping.md), `f8336dc`), and the
build's resolution of a profile against the mapping in force
([`specs/0198-build-mapping-resolution.md`](0198-build-mapping-resolution.md),
`8773a06`). This spec defines the one thing every mapping today lacks: a way
for the adopting organization to change what a target resolves to, without
editing an upstream-owned file. It also settles the synchronization
consequence that requirement 8 of spec 0197 recorded and Decision 6 of spec
0198 deferred here.

**Vocabulary.** *Target*, *mapping*, *offering*, *surface*, *resolution* and
*drop* carry the meanings spec 0197 gives them. Three terms are new here. The
**core mapping** for a target is the upstream-owned `model-mappings/<target>.yml`
of spec 0197 requirement 1. The **org channel file** for a target is the
org-owned file this spec introduces. The **mapping in force** for a target is
what `mapping_in_force` — the single named point of spec 0198 requirement 2 —
returns: today the core mapping, after this spec the two merged.

**Evidence base.** Every claim below about existing behaviour is cited from the
tree at `8773a06`, by file and by the function or line that carries it. No
claim rests on a vendor document or on an installed CLI: this spec changes no
target's native surface and probes nothing.

**Contradicted premises.** Three statements in merged repository artifacts
disagree with what this spec requires. Each is named rather than silently
worked around, and the disposition of each is stated.

**Premise 1 — spec 0121 requirement 3: a local modification to a built agent
output halts the sync.** That requirement reads "A local modification to a
built Antigravity component output SHALL halt an upstream synchronisation and
name the affected core-layer path, exactly as a local modification to a built
Claude Code, Gemini CLI, or GitHub Copilot CLI component output does." The
reclassification requirement 8 of spec 0197 hands to this seam removes that
halt for the four compiled **agent** output trees, because under an org
override the divergence is the correct output of the build rather than a hand
edit, and `scripts/sync-from-upstream.sh` cannot tell the two apart without
running the build. Requirement 3's *parity* clause — Antigravity treated
exactly as the other three — is honoured: all four agent trees move together.
Its *halt* clause is contradicted for those four trees alone; the compiled
skill and command trees keep it. **Disposition:** a delta-spec of spec 0121
narrowing requirement 3 to the built outputs that remain `strict`, mandated by
requirement 44 below. Named and repaired by delta, not by editing the merged
body.

**Premise 2 — spec 0121 requirement 2: the same guarantee for every built-output
directory.** That requirement reads "Every directory that the component build
writes component outputs into SHALL carry the same upstream-synchronisation
guarantee as every other such directory, and no such directory SHALL be left
without one." Read as *identical policy*, it forbids agent trees and skill
trees carrying different policies. Read as *a guarantee of the governed class*,
it forbids only the ungoverned state — the mischief it was written for
(issue #755), where `.agents/skills` and `.agents/agents` appeared in no
manifest at all. The second reading is the one the requirement's own shipped implementation
adopts: `dir_is_governed()` in `scripts/check-core-paths.sh` accepts **either**
`strict` **or** `adopt-on-edit`, so two different policies already satisfy it
today, and the manifest already exercises that (`config/expertise` is
`adopt-on-edit` while `artifacts/core` is `strict`). **Disposition:** this spec
adopts the governed-class reading, and requirement 42 keeps the new policy
inside that class so no built-output directory is ever left without a
guarantee. No delta is owed. Recorded so that a reviewer holding the
identical-policy reading finds the argument rather than reconstructing it.

**Premise 3 — spec 0020 requirement 8: three policies.** That requirement reads
"The synchronization SHALL classify every managed path under exactly one
policy: **strict** …, **adopt-on-edit** …, or **excluded** …". Read as a closed
menu, it forbids the fourth policy requirement 42 introduces. Two statements in
spec 0020 itself contradict the closed reading: its `## Out of scope` places
"the concrete sync-manifest syntax" outside the spec as a HOW concern, and it
records that "this spec introduces the category and classifies only the named
paths; broader reclassification is a separate change" — anticipating exactly
the separate change this ticket is. The operative clause of requirement 8 is
*exactly one*: a path carries one policy, never two. **Disposition:** this spec
adopts the open reading; requirement 8's uniqueness clause is preserved
verbatim by requirement 42. No delta is owed. If a future reading holds the
menu closed, the fix is a delta of spec 0020 and not a redesign of this
channel, because nothing here depends on the policy's *name*.

**Decision 1 — the channel is one org file per target, beside the core file it
overrides: `model-mappings/<target>.org.yml`.** Three placements were
considered. A root-level `model-mappings.org.yml` mirrors `mcp-servers.org.json`
most literally and needs no `:(exclude)` carve-out at all, but one file for
four targets forces a per-target wrapper key, and that second top-level shape
forks everything downstream: the checker's node walker, the merge, and the
`docs/model-mapping-format.md` node tables would each have to describe two
shapes rather than one, and "declare a mapping for a target the core layer
leaves unconfigured" becomes a schema variation instead of a file creation. A
nested `model-mappings/org/<target>.yml` costs exactly one manifest line and
mirrors `specs/org/` and `docs/org/`, but departs from the `<name>.org.<ext>`
convention this ticket names. The chosen form keeps the org file **shape-identical
to a core mapping** — same top-level keys, same node kinds, same addressing
grammar — so one assertion table validates both, and the merge is a per-target,
file-to-file operation over one schema. Its one cost is four `excluded`
manifest lines instead of one, and a fifth target later needing a fifth line;
requirement 41 turns that silent maintenance hazard into a failing build, which
is cheaper than the shape fork it buys off.

**Decision 2 — the merge replaces whole nodes at an address, and never merges
fields inside one.** An org node whose address is absent from the core mapping
is added; an org node whose address is present replaces the core node entirely.
Field-granular merging is rejected on the strength of requirement 5 of spec
0197: a node's `grounds:` list grounds *that node's own declarations*, so a node
half-composed of core fields and half of org fields carries a grounds list that
grounds neither. Whole-node replacement keeps every node in the merged mapping
internally coherent, which is what lets the existing assertion table run against
the merged result unchanged — the property requirement 33 depends on. The cost
is that an organization changing one field of an offering restates the whole
offering; the benefit is that what it restates is auditable as a unit.

**Decision 3 — removal is allowed, expressed as an explicit tombstone, and
refused on the guard.** An organization that may not send data to a given
vendor needs an offering *gone*, not outranked; and every implicit form of
removal considered — an offering with a null rank, an empty `native-value` —
is a malformed node that the checker would have to start tolerating. So removal
is a top-level `remove:` list of addresses, explicit and reportable. It is
refused on `guard` and on `guard/terms/<id>`: that guard encodes requirement 8
of spec 0143 delta-01, a live upstream defect, and deleting it is how an
organization silently re-enables the defect for its own fork. An organization
that has evidence the defect is fixed replaces `guard/state` instead — and then
meets requirement 33 of spec 0197 at the merged mapping, where the checker
demands the evidence. The distinction is deliberate: this channel lets an
organization override a *preference* freely and a *defect guard* only against
evidence.

**Decision 4 — the merged mapping is materialized, and the handle stays a
path.** `mapping_in_force` already returns an opaque handle that every accessor
in `scripts/lib/model-resolve.sh` feeds to `yq` as a file argument, and Decision
4 of spec 0198 bought exactly one thing with that indirection: seam (e) replaces
one function and touches no rule. Materializing the merged document to a file
and returning its path spends that budget and no more. Returning a serialized
YAML *string* instead would change every accessor's `yq` invocation to read
standard input — the rewrite Decision 4 exists to prevent — and merging inside
each accessor would perform the merge tens of times per build and leak
provenance into every rule, which requirement 2 of spec 0198 forbids. The
merged document is deterministic and cached per target per build invocation, so
the resolution outcome stays the deterministic function of source and mapping
that requirement 28 of spec 0197 requires.

**Decision 5 — the checker validates three things, and only the third one
binds.** The core file alone, the org file alone, and the merged result. The
merged result is where the invariants actually live — rank total order,
selection totality and guard evidence are all properties of the offering set in
force, and an org file that is impeccable alone can still collide with a core
rank it never saw. The two single-file passes exist for attribution: told only
that the merged Claude mapping has a duplicate rank, an author does not know
which of two files to edit. This mirrors the two-instrument split Decision 8 of
spec 0197 draws between the checker and the resolver, one level down.

**Decision 6 — the fourth sync policy is `regenerable`, and it differs from
`strict` in exactly one behaviour.** Requirement 8 of spec 0197 asks for
compiled agent outputs to be "regenerable artifacts whose drift from upstream is
acceptable **for as long as** the build regenerates them from the declarations
in force and its drift check passes". Three existing policies were tested
against that sentence. `excluded` is unavailable: `scripts/check-core-paths.sh`
fails any built-output directory that carries no `strict`/`adopt-on-edit`
guarantee and states that it admits no exemption allowlist, which is
requirement 2 of spec 0121 doing its job. `adopt-on-edit` is mechanically
workable and needs no new policy, and it is rejected on three counts: its
freeze is *unconditional and permanent* where requirement 8 asks for an
acceptance conditioned on a check that keeps passing; its name tells a reader
the adopter may hand-edit these files, which stays forbidden; and applied to
four directory entries it turns on `reconcile_dir`, which refuses to reconcile a
directory entry on a shallow clone and writes one committed marker file per
compiled agent per target, and it drops the spec 0064 orphan cleanup that
removes an output whose source upstream deleted. A conditional `strict` that
consults the drift check was rejected outright: it would make
`scripts/sync-from-upstream.sh` — a hermetic git operation — depend on running
the component build. `regenerable` therefore restores exactly as `strict`
restores, including orphan cleanup, and differs in one behaviour: a local
divergence never aborts the sync, and is reported instead. A fork that has
overridden nothing is byte-for-byte unaffected.

**Decision 7 — compiled skill and command outputs stay `strict`.** No mapping
reaches a compiled skill or command, so no org override can change one, and an
organization's *own* compiled components are additions rather than
modifications — which the strict dirty guard already ignores, because it
enumerates upstream members (`git ls-tree -r FETCH_HEAD -- "$path/"` in
`scripts/sync-from-upstream.sh`) and an org-only file is not among them.
Reclassifying those trees would weaken a guard against a state that cannot
arise, which is the anti-pattern Decision 6 of spec 0198 names: a guard weakened
ahead of its need protects nothing while looking like it does.

**Decision 8 — org cells carry the full grounding discipline of requirement 5 of
spec 0197, unrelaxed.** An org offering rests on an observation of that
organization's own environment — its model catalogue, its contract, its
compliance constraint — exactly as a core offering rests on upstream's, so the
same `grounds:` list expresses it. Relaxing the rule for org nodes would make
`grounds:` conditional on where a node came from, and a reader of the merged
mapping could then no longer tell an authorized relaxation from a defect. It
would also fork the assertion table on provenance, which is the coupling
requirement 2 of spec 0198 forbids one layer down. The cost is one line per
node; the benefit is that the merged mapping is auditable by exactly the rules
the core mapping is.

**Complexity tier — `standard`.** The implementation adds one artifact class
(the org channel, four illustrative stubs), one merge point inside an existing
library function, a third validation pass and a set of new assertions in an
existing checker, a fourth synchronization policy touching
`scripts/sync-from-upstream.sh` and `scripts/check-core-paths.sh` and their two
test suites, two continuous-integration capability path sets, four
documentation surfaces, and one delta-spec of spec 0121. That is a developer, a
tester and a reviewer, which exceeds the single documentation surface a `small`
tier covers. It is not `large`: every design question is settled here rather
than deferred to sub-spec decomposition, the resolution rules of spec 0197 are
inherited unchanged, and the deliverable is one channel plus one policy rather
than several independent workstreams.

## Intent

An adopting organization can change what any command-line interface resolves a
capability declaration to, and can do so in its own file — replacing one model
entry, one native surface, one prose template or one guard state, adding entries
the framework never shipped, taking entries out of circulation, or substituting
its whole lineup for an interface, including one the framework leaves
unconfigured. Its file wins wherever the two disagree, every place they disagree
is reported rather than resolved quietly, and nothing the framework owns is
edited to achieve it. Everything downstream reads the two as one: the same
checks that hold the framework's own declarations to their invariants hold the
combined result to them, and the compiled outputs regenerate accordingly.
Because those outputs then legitimately differ from the framework's, an upstream
synchronization no longer refuses to run on account of them, while every other
built output still refuses. The framework ships this channel present but silent,
carrying no entry and no secret, so an organization that never opens it notices
no change at all.

## Requirements

Requirements 1 through 9 define the channel and its ownership, 10 through 22 the
override semantics, 23 through 28 the mapping in force, 29 through 36 the
validation surface, 37 through 41 the continuous-integration guards, 42 through
50 the synchronization reclassification, and 51 through 56 the documentation
surfaces.

1. The framework SHALL carry, for each supported target, at most one
   organization-level override channel file, and each such file SHALL be a
   single committed file at `model-mappings/<target>.org.yml`, whose name
   identifies the target it serves.
2. An org channel file SHALL declare the target it serves, and that declaration
   SHALL agree with the target its filename identifies — the filename stem with
   the trailing `.org` removed.
3. An org channel file SHALL admit exactly the node kinds, key sets and value
   domains that `docs/model-mapping-format.md` makes normative for a core
   mapping, plus the two top-level keys requirements 13 and 15 introduce, and no
   others.
4. Every offering, every surface item and every guard term an org channel file
   declares SHALL carry the grounding of requirement 5 of spec 0197 — either a
   citation or an explicit assumption, and neither both nor neither — under the
   same rules, with no relaxation on account of the declaration being
   org-owned.
5. An org channel file SHALL be classified in the layer boundary contract
   (`docs/layers.md`) and in the synchronization manifest
   (`.crewrig/core-paths.txt`) as org-owned and **excluded** from upstream
   synchronization, nested under the `model-mappings` parent, so that upstream
   synchronization never modifies, deletes, restores, or refuses to proceed on
   account of its contents.
6. An organization SHALL be able to change what any target resolves to without
   editing any upstream-owned file.
7. Upstream SHALL ship one org channel file per supported target, each declaring
   no offering, no surface, no template and no guard state, and carrying no
   credential or other secret; a fresh adopter SHALL receive no org-level
   override until it populates a channel file itself.
8. An org channel file whose document declares nothing SHALL be a supported
   state: the mapping in force for its target SHALL equal that target's core
   mapping, and no report, drop, note or check rejection SHALL be produced on
   account of it.
9. The absence of an org channel file for a target SHALL be indistinguishable,
   in every outcome this spec defines, from the presence of one declaring
   nothing.
10. The mapping in force for a target SHALL be the core mapping for that target
    overridden by that target's org channel file, and where the two declare a
    node at the same address the org-declared node SHALL be the one in force.
11. An override SHALL be expressed at one of the addresses the addressing
    grammar of `docs/model-mapping-format.md` publishes — `surfaces/<id>`,
    `surfaces/<id>/template`, `offerings/<id>`, `guard`, `guard/state`,
    `guard/terms/<id>` — and SHALL NOT be expressed at any other granularity.
12. An org-declared node whose address the core mapping does not declare SHALL
    be added to the mapping in force; an org-declared node whose address the
    core mapping does declare SHALL replace that core node **entirely**, and no
    field of the replaced core node SHALL survive into the merged node.
13. An org channel file SHALL be able to remove a core-declared node from the
    mapping in force by naming its address in a top-level `remove:` list, and a
    node so named SHALL be absent from the mapping in force.
14. A `remove:` entry naming the address `guard`, or an address of the form
    `guard/terms/<id>`, SHALL be rejected by the check of requirement 29 and
    SHALL have no effect on the mapping in force; every other address of
    requirement 11 SHALL be removable.
15. An org channel file SHALL be able to declare, through a top-level
    `replaces-core:` flag, that it substitutes the whole mapping for its target:
    the core mapping SHALL NOT be consulted, and the mapping in force SHALL be
    the org channel file alone. The flag SHALL default to *not substituting*
    when absent.
16. An org channel file declaring `replaces-core:` as substituting SHALL NOT
    also declare a `remove:` list, and a file declaring both SHALL be rejected
    by the check of requirement 29.
17. Where a target has an org channel file and no core mapping, the mapping in
    force SHALL be that org channel file, and the target SHALL be served exactly
    as a target whose core mapping declared the same content — including a
    target the core layer leaves unconfigured through a mapping declaring zero
    offerings.
18. Every address at which an org-declared node is added to, replaces, or is
    removed from the mapping in force SHALL be recorded on the diagnostic output
    of whatever performed the merge, naming the target, the address, and which
    of those three dispositions applied. No such record SHALL be placed inside
    any compiled agent output, and none SHALL fail the merge.
19. A `remove:` entry naming an address the core mapping does not declare, and
    an org-declared node at an address the core mapping does not declare while
    `replaces-core:` substitutes, SHALL each be recorded per requirement 18 as
    having had no effect, and SHALL NOT be silent and SHALL NOT fail.
20. The ranks of the offerings in the mapping in force SHALL be a strict total
    order, which is requirement 28 of spec 0197 evaluated over the merged
    offering set.
21. Where the mapping in force nonetheless carries two offerings at one rank,
    the selection of requirement 23 of spec 0197 SHALL resolve the tie by the
    lower offering identifier in ascending lexicographic order, SHALL record one
    diagnostic note naming the rank and both identifiers, and SHALL NOT fail —
    so that a resolution stays a deterministic function of the agent source and
    the mapping in force, and depends on no property of which file a node was
    read from.
22. No override SHALL cause a resolution to fail, block, or raise an error,
    which is requirement 15 of spec 0197: every situation the merge leaves
    unresolvable SHALL degrade to the fallback path of requirement 6 of spec
    0143 delta-01 and SHALL be recorded on the diagnostic output alone.
23. `mapping_in_force` in `scripts/lib/model-resolve.sh` SHALL return a handle
    to the mapping in force for the requested target, and SHALL remain the only
    point at which the build obtains a mapping — requirement 2 of spec 0198.
24. No rule of requirements 7 through 31 of spec 0198 SHALL change, and no
    accessor of `scripts/lib/model-resolve.sh` other than `mapping_in_force`
    SHALL change, on account of this spec.
25. The handle of requirement 23 SHALL be readable by every existing accessor
    without that accessor being modified.
26. The merged document a handle denotes SHALL be a deterministic function of
    the core mapping's bytes and the org channel file's bytes: two runs over
    identical inputs SHALL produce identical merged content, and the order of
    the merged document's nodes SHALL be fixed by rule rather than by traversal
    accident.
27. A merged document materialized during a build SHALL be created outside the
    repository's tracked content, SHALL be removed when the build that created
    it ends, and SHALL never be committed.
28. The merge for one target SHALL be performed at most once per build
    invocation, and every resolution performed in that invocation for that
    target SHALL read the same merged document.
29. `scripts/check-model-mappings.sh` SHALL reject an org channel file whose
    declared target is not a supported target or disagrees with its filename, a
    key the schema does not admit, a node carrying neither a citation nor an
    assumption or carrying both, a `remove:` entry that is not an address of
    requirement 11, a `remove:` entry forbidden by requirement 14, and the
    combination requirement 16 forbids.
30. That check SHALL apply, to each org-declared offering, surface item and
    guard term, every assertion it applies to the core-declared node of the same
    kind.
31. That check SHALL validate the mapping in force for each target — the merged
    result — against the full assertion set of requirements 47 through 50 of
    spec 0197, and SHALL reject a duplicate rank, a duplicate offering
    identifier, a native value outside the domain the mapping in force declares,
    a selection that is not total over the seven `intelligence` rungs, and a
    guard recorded in the **directed** state without evidence for each of its
    two terms.
32. Each rejection that check emits SHALL name which of the three sources it
    concerns — the core mapping, the org channel file, or the mapping in force —
    so that an author is told which file to edit.
33. That check SHALL remain hermetic in the sense of requirement 46 of spec
    0197: decidable from the mapping files and the domains of spec 0195 alone,
    without network access, without an installed CLI, and without resolving any
    agent source.
34. That check SHALL remain an authoring-time gate, and its rejection SHALL NOT
    become a resolution failure — requirement 51 of spec 0197 and requirement 48
    of spec 0198 — so a mapping in force the check would reject SHALL still be
    resolvable against, degrading the cells it cannot read.
35. Each class of rejection requirements 29 through 31 introduce SHALL carry its
    own distinct assertion identifier, and each SHALL be exercised by at least
    one fixture the check is expected to reject, so that an assertion which has
    stopped detecting its condition fails the build instead of passing it.
36. `scripts/check-model-mappings.sh --print-selection` SHALL print the
    selection of the mapping in force, and SHALL identify each mapping by a
    stable label rather than by the location of a materialized merged document,
    so that no machine-specific path can enter a pinned expectation.
37. The `check-model-mappings` capability in `ci/ci-capabilities.yml` SHALL run
    whenever an org channel file changes.
38. The `component-drift` capability SHALL run whenever an org channel file
    changes, in its trigger `paths:` sets and in its `cache.files` set, so that
    a change to an override alone runs the drift check and cannot pass on a
    cached result derived from a different mapping.
39. The drift check `bash scripts/build-components.sh --target all --check`
    SHALL be evaluated against the mapping in force, so that a change to an org
    channel file whose regenerated compiled outputs are not committed in the
    same change fails it — requirement 46 of spec 0198 evaluated against the
    merged mapping.
40. The `core-paths` capability in `ci/ci-capabilities.yml` SHALL run whenever
    `scripts/sync-from-upstream.sh` changes, so that the suite which tests that
    script cannot be skipped by a change to the script alone.
41. Continuous integration SHALL fail, and SHALL name the target, when a
    supported target has no `excluded` entry for its org channel file in
    `.crewrig/core-paths.txt`.
42. The synchronization manifest SHALL admit a fourth policy for a path whose
    content the build regenerates. Under that policy synchronization SHALL
    restore the path from upstream exactly as the **strict** policy restores it,
    SHALL NOT abort on a local modification, and SHALL report each restored
    member whose local content had diverged. Every managed path SHALL still
    carry exactly one policy.
43. The four compiled agent output trees — `.claude/agents`, `.gemini/agents`,
    `.github/agents`, `.agents/agents` — SHALL carry the policy of requirement
    42, and SHALL all carry it, so that no supported target's agent outputs are
    treated differently from another's.
44. The change set SHALL land a delta-spec of spec 0121 narrowing its
    requirement 3 to the built outputs that remain **strict**, so that no merged
    requirement obliges a halt the shipped synchronization no longer performs.
45. The compiled skill and command output trees SHALL remain **strict**, and a
    local modification to one SHALL continue to halt an upstream synchronization
    and name the affected path.
46. A path carrying the policy of requirement 42 SHALL count as carrying an
    upstream-synchronization guarantee for the purpose of requirement 2 of spec
    0121, so that `scripts/check-core-paths.sh` neither fails it as ungoverned
    nor exempts it from resolving at `HEAD`.
47. A fork that has populated no org channel file SHALL observe no change in the
    outcome of an upstream synchronization relative to the behaviour before this
    spec.
48. A fork whose compiled agent outputs differ from upstream's because they were
    regenerated from the declarations in force SHALL be able to complete an
    upstream synchronization, and SHALL be told which agent outputs were
    restored over so that it knows to regenerate them.
49. The synchronization's history-preserving mode SHALL treat a path carrying
    the policy of requirement 42 as part of the governed set, so that its
    anti-pollution guard neither aborts on a regenerated agent output nor
    silently admits an ungoverned change.
50. `scripts/tests/test-sync-from-upstream.sh` SHALL cover the policy of
    requirement 42 with at least a case where a diverged agent output does not
    abort and is restored and reported, a case where a diverged compiled skill
    output still aborts, and a case where a fork with no divergence is
    unaffected.
51. `docs/model-mapping-format.md` SHALL document the override channel: its
    location, its shape, the `remove:` and `replaces-core:` keys, the merge
    rules of requirements 10 through 17, and the three validation passes of
    requirements 29 through 32.
52. The change set SHALL provide an adopter-facing how-to describing how an
    organization overrides a mapping, mirroring the role `docs/org-mcp-declaration.md`
    plays for the org MCP channel, and SHALL state that the channel carries no
    secret and that the organization owns whatever it later adds.
53. `docs/cli-matrix.md` SHALL record how each supported CLI's compiled agent
    outputs are affected by an org-level override.
54. `docs/layers.md` and `.crewrig/core-paths.txt` SHALL both state the
    classification of the org channel files and the reclassification of
    requirement 43, and the two statements SHALL agree.
55. Every document that enumerates the synchronization policy set SHALL
    enumerate the policy of requirement 42 alongside the existing three.
56. No requirement of this spec SHALL be conditioned on the outcome of probe C
    of issue #1113: an override reaches the build through the mapping in force
    alone, so every verdict of that probe is absorbed by an edit to a mapping
    file or by a delta of spec 0197, and none reaches this channel's rules.

## Scenarios

**Scenario:** An organization replaces one offering and the build emits it

```text
Given a core Claude Code mapping declaring an offering `opus` at rank 2
And an org channel file `model-mappings/claude.org.yml` declaring an offering
     with the identifier `opus`, a different native value, and its own grounds
When the build compiles an agent whose profile selects that offering
Then the compiled Claude Code agent output carries the org-declared native
     value, the merge report names `offerings/opus` as replaced on target
     `claude`, and no field of the core `opus` offering survives into the
     merged offering
```

**Scenario:** An organization adds an offering the framework never shipped

```text
Given a core Gemini CLI mapping declaring three offerings
And an org channel file declaring a fourth offering at an unused rank, with an
     intelligence rung above every core offering, and its own grounds
When the build resolves an agent declaring `intelligence: max`
Then that fourth offering is the one selected, and the merge report names it as
     added on target `gemini`
```

**Scenario:** An organization removes an offering from circulation

```text
Given a core mapping declaring offerings `a`, `b` and `c`
And an org channel file whose `remove:` list names `offerings/b`
When the mapping in force is validated and resolved against
Then no resolution can select `b`, the merge report names `offerings/b` as
     removed, and the selection over the seven intelligence rungs remains total
     across the offerings that remain
```

**Scenario:** An organization substitutes its whole lineup for one target

```text
Given a core Antigravity CLI mapping declaring five offerings and a guidance
     surface
And an org channel file for that target declaring `replaces-core:` as
     substituting, with two offerings and its own guidance template
When the build resolves any agent for that target
Then only the two org-declared offerings are candidates, the core mapping is not
     consulted, and the org-declared template is the one rendered
```

**Scenario:** An organization configures a target the core layer left
unconfigured

```text
Given a core GitHub Copilot CLI mapping declaring zero offerings
And an org channel file for that target declaring one offering and a frontmatter
     surface, with grounds
When the build compiles an agent whose profile that offering serves
Then the compiled GitHub Copilot CLI agent output carries the org-declared
     declination, where before the spec the target yielded no resolution
```

**Scenario:** An organization ships an override without regenerating the outputs

```text
Given a change that edits an org channel file
And leaves the compiled agent outputs at their previous content
When continuous integration runs
Then the drift check fails and names the outputs that do not match the mapping
     in force
```

**Scenario:** An org override collides with a core rank

```text
Given a core mapping declaring an offering at rank 3
And an org channel file adding a different offering at rank 3
When the checker runs, and separately when the build resolves an agent
Then the checker rejects the mapping in force with the duplicate-rank assertion
     and names the mapping in force as the source
And the build does not fail: it selects the offering with the lower identifier,
     records one diagnostic note naming the rank and both identifiers, and emits
     a resolution
```

**Scenario:** An organization tries to delete the Claude Code defect guard

```text
Given an org channel file for Claude Code whose `remove:` list names `guard`
When the checker runs
Then it rejects the file, names the org channel file as the source, and the
     mapping in force retains the core guard unchanged
```

**Scenario:** An organization flips the guard to directed without evidence

```text
Given an org channel file for Claude Code replacing `guard/state` with the
     directed state, and replacing neither guard term
When the checker runs
Then it rejects the mapping in force because a directed guard carries no
     evidence for each of its two terms, and names the mapping in force as the
     source
```

**Scenario:** An org channel file omits its grounding

```text
Given an org channel file declaring an offering with no `grounds` list
When the checker runs
Then it rejects the org channel file under the same assertion that rejects an
     ungrounded core offering, with no relaxation on account of the file being
     org-owned
```

**Scenario:** A fork with an override completes an upstream synchronization

```text
Given a fork whose org channel file changes what two agents resolve to
And whose compiled agent outputs were regenerated accordingly and committed
When the fork runs the upstream synchronization
Then the synchronization does not abort, restores the affected agent outputs
     from upstream, reports each one it restored over, and the fork regenerates
     them by re-running the build
```

**Scenario:** A hand-edited compiled skill output still halts the sync

```text
Given a fork that has hand-edited a compiled skill output
When the fork runs the upstream synchronization
Then the synchronization aborts and names that skill output, exactly as before
     this spec
```

**Scenario:** A fork that has overridden nothing sees no change

```text
Given a fork that has populated no org channel file and edited no built output
When the fork runs the upstream synchronization
Then its outcome is identical to the outcome before this spec, on every managed
     path
```

**Scenario:** A supported target loses its manifest carve-out

```text
Given a change that adds a supported target's core mapping without adding the
     `excluded` manifest entry for that target's org channel file
When continuous integration runs
Then it fails and names the target whose org channel file carries no carve-out
```

**Scenario:** Upstream ships the channel silent

```text
Given a fresh adopter who has cloned the framework and populated no org channel
     file
When the build compiles every agent for every target
Then the compiled outputs are byte-identical to what the core mappings alone
     produce, no merge report is emitted, and no shipped org channel file
     carries a credential or other secret
```

## Out of scope

- Any change to the normative text of specs 0195, 0197, 0198, 0143 or its
  delta-01. The three contradicted premises above are named, and the only one
  repaired is repaired by the spec 0121 delta requirement 44 mandates.
- The resolution rules themselves. Requirements 15 through 28 of spec 0197 and 7
  through 31 of spec 0198 are inherited verbatim; this spec changes what a
  resolution reads, never how it reads it.
- Org-level override of a capability *profile*. A profile belongs to the agent
  source that declares it; this channel overrides mappings alone. An
  organization that wants a different profile for an agent changes the agent
  source through the tiers `artifacts/` already provides.
- The migration of the core agent sources to `metadata.model:` profiles and the
  removal of `metadata.claude.model` from them. Seam (f).
- The compiled-layout convention for agent outputs. Seam (g). Requirements 43
  and 45 name output trees as directories, never as file patterns within them.
- Directed emission onto any out-of-band surface. An org channel file may name
  one exactly as a core mapping may, and naming directs nothing — requirements
  11 through 13 of spec 0197 are unchanged.
- Runtime routing. Nothing here changes a target's session default model, its
  interactive model picker, or the behaviour of its Auto router.
- Model declaration for skills and commands. The channel serves agent sources
  alone, and Decision 7 keeps the compiled skill and command trees out of the
  reclassification.
- Reconciling or propagating an override across targets. An override declared
  for one target is never copied into another target's mapping in force.
- Validating, health-checking or normalizing what an organization declares
  beyond the assertions of requirements 29 through 31 — in particular, whether a
  native value an organization declares names a model that organization can
  actually reach is not decidable hermetically and is not attempted.
- Managing, encrypting or otherwise securing anything an organization places in
  its own channel file. Upstream ships the channel silent and the organization
  owns whatever it later adds.
- The orphan-cleanup behaviour of the **strict** policy, which deletes a locally
  tracked file absent from upstream under a strict directory entry, and which
  therefore removes an organization's own compiled component from a strict
  built-output tree on every synchronization. The condition predates this
  ticket, is unrelated to model mappings, and is recorded in `## Open questions`
  rather than repaired here; under requirement 42 the same cleanup is harmless
  on an agent tree, because the build re-creates what it removed.
- The execution of probe C of issue #1113 and any delta of spec 0197 its
  verdicts warrant, per requirement 56.

## Open questions

Each item carries what the content gate owes it: **confirm** where a maintainer
decision is asked for, **audit** where the item is recorded for the record and
no closure is owed on the logbook issue.

- [GROUNDING:] **confirm.** The intent paragraph of issue #1119 states that the
  channel "follows the root-level `<name>.org.<ext>` ownership convention of
  spec 0020 / spec 0091". Decision 1 keeps the `<name>.org.<ext>` filename form
  but places the file **beside its core mapping** under `model-mappings/`
  rather than at the repository root, so that an org channel file is
  shape-identical to a core mapping and one assertion table validates both. The
  maintainer is asked to confirm the placement; the alternative — a single
  root-level `model-mappings.org.yml` — is recorded in Decision 1 with the cost
  it carries.
- [GROUNDING:] **confirm.** Requirement 44 mandates a delta-spec of spec 0121
  narrowing its requirement 3, because the reclassification of requirement 43
  removes a halt that merged requirement obliges. A delta-spec ships as its own
  one-file spec pull request and therefore merges before the implementation
  branch of this ticket opens. The maintainer is asked to confirm that ordering
  at the content gate; the alternative is to leave requirement 3 contradicted by
  shipped behaviour, which this spec does not recommend and which would surface
  as a `spec`-class finding in the REVIEW loop rather than being avoided.
- [GROUNDING:] **confirm.** Premise 3 adopts the open reading of requirement 8
  of spec 0020, on the strength of two statements in spec 0020's own
  `## Out of scope` — that the concrete sync-manifest syntax is a HOW concern,
  and that broader reclassification is a separate change. The maintainer is
  asked to confirm that reading. Nothing in this channel depends on the fourth
  policy's *name*, so a closed reading costs a delta of spec 0020 and no
  redesign.
- [GROUNDING:] **audit.** `.crewrig/core-paths.txt` at `8773a06` classifies
  `model-mappings` as `strict` with no nested entry, and
  `scripts/check-model-mappings.sh` enumerates `model-mappings/*.yml` by
  default — a glob that already matches `<target>.org.yml`. Requirement 29's
  filename rule and requirement 32's source attribution both depend on the
  checker distinguishing the two forms rather than treating an org file as a
  malformed core file. Recorded so the implementation does not inherit the
  default glob unexamined.
- [GROUNDING:] **audit.** The nested-exclusion mechanism in
  `scripts/sync-from-upstream.sh` matches a manifest entry against a member with
  a quoted `case` pattern (`case "$member" in "$excl"/*|"$excl")`), so a wildcard
  manifest entry such as `model-mappings/*.org.yml` would be compared literally
  and would not carve out anything. This is why requirement 1 yields one
  manifest line per target and requirement 41 guards the set, rather than one
  wildcard line. Recorded for audit; no closure is owed.
- [GROUNDING:] **audit.** The **strict** apply branch of
  `scripts/sync-from-upstream.sh` deletes every locally tracked file under a
  strict directory entry that is absent from the fetched upstream tree (spec
  0064 orphan cleanup). An organization's own compiled skill, committed under
  `.claude/skills/` or a sibling tree, meets that condition and is removed on
  every synchronization. The condition is unrelated to model mappings and
  predates this ticket; `## Out of scope` excludes it and it is recorded here so
  it is not lost. Under requirement 42 the same cleanup is harmless on an agent
  tree, because the build re-creates what it removed.
- [GROUNDING:] **audit.** The `core-paths` capability in
  `ci/ci-capabilities.yml` at `8773a06` runs
  `scripts/tests/test-sync-from-upstream.sh` but does not list
  `scripts/sync-from-upstream.sh` in its trigger `paths:` sets, so a change to
  that script alone is changeset-gated out of the suite that tests it.
  Requirement 40 closes the gap; the gap predates this ticket and is recorded
  rather than attributed to it.
- [GROUNDING:] **audit.** Requirement 27 forbids a materialized merged document
  from being committed or from outliving the build. A materialized document left
  inside the repository would be caught by the drift check and by
  `scripts/check-no-machine-paths.sh`, but only after the fact; the requirement
  is stated so the implementation chooses a location outside the tracked tree
  rather than relying on those two to notice. Recorded for the test strategy at
  PLAN.
- [GROUNDING:] **audit.** Upstream's own continuous integration exercises the
  empty-channel path on every run (requirement 7 ships four silent files), but
  exercises no *populated* override, because upstream declares none. Every
  populated case in `## Scenarios` therefore has to be covered by fixtures
  outside `artifacts/` and outside `model-mappings/`, in the manner spec 0198
  established for its resolver suite. Recorded for the test strategy at PLAN.
