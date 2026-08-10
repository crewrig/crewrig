---
id: "0119"
slug: overlay-tier-component-resolution
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 789
version: 1.0.0
---

# Overlay-tier component resolution on the per-component install surface

## Intent

An operator who installs one named component gets that component whenever it
exists in any tier the command serves, and an operator who installs a whole
component type gets every component of that type from every tier that command
serves — identically on all four supported command line interfaces. Today the
answer depends on which unrelated tiers happen to be populated: an
organization component becomes unreachable as soon as the community tier
exists, and the resulting message blames a missing build rather than the tier
the operator asked for. One command also delivers components somewhere no
component of its tier belongs — the committed project tree — so an operator
who installs an experimental component finds their checkout modified. And
nothing stops two tiers from claiming one name, so an install can quietly
replace a component the operator never named. After this spec, tier population
can no longer hide a component, every command delivers where the assisted
setup of the same command line interface delivers, one name means one component
everywhere it can be installed, and a genuine miss is reported as a failure
naming the tiers searched.

## Requirements

Requirements 1 to 4 fix where a component is delivered and what it is read
from, 5 to 11 fix which tiers each command serves, 12 to 15 make a name
collision impossible, refuse one that reaches an install command anyway, and
record the rule, 16 to 18 govern the failure report, and 19 to 20 fix the reach
and the verification.

1. For each component type that both a per-component install command and the
   assisted setup of the same command line interface install, the two SHALL
   deliver that type to the same landing zone.
2. For each component type covered by requirement 1, the two SHALL resolve
   components from the same basis, so that neither reads compiled output while
   the other reads authoring sources.
3. A per-component install command SHALL NOT deliver a component of a
   non-`core` tier into the committed project tree.
4. Where the assisted setup of a command line interface deliberately installs
   no component of a given type, and that omission is recorded as a documented
   parity gap, requirements 1 and 2 SHALL NOT be read to oblige a landing zone
   for that type on that command line interface; the omission SHALL remain
   governed by the recorded gap.

5. Each per-component install command SHALL serve every non-`core` tier that
   the assisted setup of the same command line interface installs.
6. No per-component install command SHALL serve the `core` tier, whose landing
   zone is the committed project tree and whose delivery is not an install.
7. A request for a named component SHALL succeed whenever a component of that
   name exists in any served tier, irrespective of which other served tiers
   are populated, empty, or absent.
8. A served tier that is absent, or that is present while holding no component
   of the requested type, SHALL NOT prevent resolution from any other served
   tier.
9. A request that names no component SHALL install every component of the
   requested type from every served tier.
10. For a given command and component type, the named request and the unnamed
    request SHALL resolve over the identical set of served tiers.
11. The `org` tier SHALL be resolvable on every command that serves it, for
    every component type that tier is permitted to hold, on both request
    shapes of requirement 10.

12. Two components SHALL be capable of colliding only where they would be
    installed under the same name into the same landing zone; two components
    whose landing zones differ SHALL NOT be treated as colliding, however their
    names relate.
13. The build SHALL fail when two components would be installed under the same
    name into the same landing zone, and the failure report SHALL name the
    colliding name and every tier declaring it.
14. Requirement 13, and the landing-zone condition of requirement 12 that
    bounds it, SHALL be recorded in project documentation.
15. Notwithstanding requirement 7, where a request nevertheless resolves one
    name to more than one component within a single landing zone, the command
    SHALL NOT install any component under that name; it SHALL report the name
    and every source presenting it, and SHALL terminate with a non-zero status.
    This requirement SHALL NOT be read to establish any order among the
    colliding sources.

16. A named request that resolves in no served tier SHALL be reported as a
    failure and SHALL terminate with a non-zero status.
17. The failure report of requirement 16 SHALL name every tier that was
    searched, and SHALL NOT name a cause that was not established.
18. A failure report SHALL NOT attribute a resolution miss to a missing build
    step unless no served tier for that type was available at all.

19. The behaviour required by requirements 1 through 18 SHALL hold when each
    command is reached through the project's documented task entry points, not
    only when reached directly.
20. Requirements 1 through 18 SHALL be covered by automated regression checks
    that fail when a served tier becomes unreachable on either request shape,
    when a landing zone or resolution basis diverges from the assisted setup of
    the same command line interface, when two components sharing an installed
    name in one landing zone are accepted by the build, or when an install
    command resolves such a pair without reporting it.

## Scenarios

**Scenario:** A named organization component installs while the community tier is populated

```text
Given a command serving the library, community and org tiers for a type
And   the community tier holds at least one component of that type
And   the org tier holds a component named "acme-review"
When  the operator requests the named component "acme-review"
Then  the component from the org tier is installed
And   the command terminates with a zero status
```

**Scenario:** An unnamed request covers every served tier

```text
Given a command serving the library, community and org tiers for a type
And   each of those tiers holds a distinct component of that type
When  the operator requests that type with no name
Then  every component of that type from all three tiers is installed
```

**Scenario:** A served tier holding nothing does not mask another tier

```text
Given a command serving the library, community and org tiers for a type
And   the library and community tiers hold no component of that type
And   the org tier holds a component named "acme-review"
When  the operator requests the named component "acme-review"
Then  the component from the org tier is installed
And   the command terminates with a zero status
```

**Scenario:** The build refuses two tiers claiming one installed name

```text
Given the library tier holds a component named "acme-review"
And   the org tier holds a component of that same name
And   both would be installed into the user home
When  the build runs
Then  the build terminates with a non-zero status
And   the report names "acme-review" and both the library and org tiers
```

**Scenario:** A shared name across differing landing zones is accepted

```text
Given the core tier holds a component named "developer"
And   the org tier holds a component of that same name
And   the core component's landing zone is the committed project tree
And   the org component's landing zone is the user home
When  the build runs
Then  the build terminates with a zero status
```

**Scenario:** A command whose types share one installed namespace is covered

```text
Given a command line interface that installs commands and skills under one landing zone
And   one tier declares a command named "acme-review"
And   another tier declares a skill of that same name
When  the build runs
Then  the build terminates with a non-zero status
And   the report names "acme-review" and both declaring tiers
```

**Scenario:** An install command refuses an ambiguous name instead of picking one

```text
Given a compiled tree produced before the build refused colliding names
And   two of its tiers present a component named "acme-review" for one landing zone
When  the operator requests the named component "acme-review"
Then  no component is installed under that name
And   the report names "acme-review" and both sources presenting it
And   the command terminates with a non-zero status
```

**Scenario:** A per-component command delivers where the assisted setup delivers

```text
Given a component type installed both by a per-component command and by the assisted setup of the same command line interface
When  the operator installs a component of that type through each route in turn
Then  both routes place the component in the same landing zone
And   both routes resolve it from the same basis
```

**Scenario:** A non-core component never reaches the committed project tree

```text
Given a clean checkout with no uncommitted modification
And   a component of a non-core tier
When  the operator installs that component through a per-component command
Then  the checkout reports no added or modified file
```

**Scenario:** An unresolvable name fails and names the tiers searched

```text
Given a command serving a set of tiers for a component type
And   no served tier holds a component named "no-such-component"
When  the operator requests the named component "no-such-component"
Then  the command terminates with a non-zero status
And   the report names every tier that was searched
And   the report does not attribute the miss to a missing build step
```

**Scenario:** A miss is not reported as a missing build

```text
Given a command that resolves from compiled output
And   at least one served tier of that type is available
And   no served tier holds a component named "no-such-component"
When  the operator requests the named component "no-such-component"
Then  the report identifies the requested name as the unresolved subject
And   the report does not instruct the operator to run a build
```

## Out of scope

- **The tier scopes themselves.** Which tiers install automatically and which
  require an explicit opt-in stays exactly as
  [`specs/0019-artifact-build-install-scope.md`](0019-artifact-build-install-scope.md)
  requirements 5 through 8 define it. Requirement 5 borrows that boundary; it
  does not move it, and it grants no tier an installation it did not have.
- **Output routing of the build.** Which root each tier compiles into is
  unchanged; requirement 13 adds a refusal, not a new destination. Requirement
  6 records that the `core` tier reaches the committed project tree through the
  build rather than through an install command, without altering how.
- **A name shared across differing landing zones.** Requirement 12 deliberately
  admits it, and the cost is real: an operator may hold, in the user home, a
  component whose name also names a `core` component in the project tree, and
  see one name denoting two things from two sources. This spec does not forbid
  that pairing, because whether it is harmful depends on how each command line
  interface resolves a name present at both project and user level — behaviour
  no project document records and this ticket has not established. Confirming
  that resolution behaviour, and revisiting requirement 12's bound in its
  light, belongs to a follow-up rather than to a guess made here.
- **Repairing a tree that already holds a collision.** Requirement 13 binds
  what the build accepts, and requirement 15 obliges an install command to
  refuse a collision that reaches it anyway — every compiled tree produced
  before requirement 13 exists is such a tree, so the case is the ordinary
  state at rollout rather than an exotic one. What stays out of scope is
  repairing that tree: this spec does not require any command to regenerate,
  prune, or migrate a compiled tree it finds in that state, only to decline to
  resolve from it silently.
- **Widening requirement 3 beyond these commands.** The prohibition binds the
  four per-component install commands this ticket audits. Extending it to every
  install surface in the project is desirable and deliberately deferred to a
  follow-up ticket, which will audit the surfaces this one has not.
- **Component types the `org` tier is not permitted to hold.** Requirement 11
  reaches only the types that tier may hold; it does not extend the `org` tier
  to further types.
- **The documented Copilot agent parity gap.** Requirement 4 defers to it
  rather than resolving it. Confirming the repository-level Copilot agent
  layout, and installing Copilot agents to the user home once confirmed, stay
  with that gap's own follow-up.
- **Symlink-mode semantics beyond resolution and landing zone.** Which tier
  supplies a component, and where it is delivered, are in scope; the
  copy-versus-link choice is unchanged.
- **Populating the `org` tier.** It ships empty and remains so; the regression
  checks of requirement 20 supply their own fixtures.

## Open questions

None. The two questions this spec carried while drafting are closed by
decision: the `library` tier stays on the per-component install surface, and
requirement 3's prohibition stays bound to the four commands audited here.
Both outcomes are recorded in `Out of scope` above, with their follow-ups. The
question of a name shared across differing landing zones is settled by
requirement 12 rather than left open, and its residual cost is stated there.
