---
id: "0255"
slug: install-manage-link-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1334
version: 1.1.0
---

# Install, manage and link scripts in TypeScript

*Delta 01 of `specs/0255-install-manage-link-typescript.md`. Source: ticket 1334,
plan finding `v1-F1` of seat `plan/1334`, pass 1
(<https://github.com/crewrig/crewrig/issues/1334#issuecomment-6097225882>). It runs
under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Parent
requirement 13 of `specs/0215-shell-to-typescript-migration.md` makes the Bash tests
the unchanged black-box oracle of a migrated script, and requirement 26 of
`specs/0255-install-manage-link-typescript.md` applies that rule to the thirteen
scripts of its requirement 1. The plan review found that requirement 26 cannot hold
for every Bash assertion: some of them do not run a script, they read its source
text, and a forwarding shim carries none of that text. This delta modifies
requirement 26 so that such an assertion is retargeted, once, in a pull request that
migrates nothing, and adds the scenario that proves it. The version is a MINOR bump:
no requirement is invalidated, one is made satisfiable. This delta changes no other
requirement of the parent and opens no question.*

## ADDED

**Scenario:** A source-reading assertion follows the declaration into TypeScript

Given a Bash suite that greps a manage script's destination assignments
(`DEST="$AGY_CUSTOMIZATION_ROOT/skills"` and the like) to prove where it installs
When the shim replaces the script
Then the retargeted assertion reads the same fact by evaluating the TypeScript
descriptor of that CLI through a helper, it fails when the helper prints nothing (the
vacuity guard), it fails when the declared destination is mutated, and every other assertion of the suite passes
unchanged through the shim.

## MODIFIED

**Requirement 26 — Oracle: the assertions that read a script as text.** Original,
three sentences of requirement 26 (the first sentence of its second half, the pass
sentence and the editing sentence, and the closing sentence on the new suites):

> The Bash suites stay unchanged in their assertions: […]
>
> All of them SHALL pass unchanged through the shims on Linux and macOS; […] The only
> edits allowed are in a preparatory pull request that leaves the thirteen scripts
> byte-identical (an empty diff, asserted in its description) and lets a suite stage
> those dependencies.
>
> These suites SHALL land in the preparatory pull request, against the shell, before
> any entry exists.

Replacement:

> The Bash suites stay unchanged in their assertions, except the assertions retargeted
> under this requirement: […]
>
> All of them SHALL pass through the shims on Linux and macOS with their assertions
> unchanged, save for the retargeting of (a) to (d) below; […] The only edits allowed
> are those of two pull requests that migrate no script and leave the thirteen scripts
> and the libraries of requirements 2 and 25 byte-identical (an empty diff, asserted in
> each description): the preparatory pull request, which lets a suite stage the
> dependencies of the entries, and the retargeting pull request of (b).
>
> (a) An assertion that reads the source text of a script of requirement 1 (a `grep`,
> `sed`, `awk` or `cat` of the file, or of the libraries it sources) instead of running
> it cannot pass against a shim, which holds none of that text, so it is not an oracle
> of the observable contract once the script is a shim (parent requirement 13: the Bash
> suites are the unchanged oracle of observable behaviour). What such an assertion
> checks here is a declared fact (a destination, a staging root, the served tier set)
> that has a TypeScript equivalent, so it is retargeted, not removed.
>
> (b) A pull request that migrates no script, merged after the TypeScript declaration
> modules exist on the release branch and before the pull request that installs the
> shims, SHALL retarget each such assertion so that it reads the same fact from the
> TypeScript declaration. The declaration modules are the per-CLI descriptors of
> requirement 6 (home, accepted types and aliases, staging roots, destinations, refresh
> CLI) and the component-resolution twins of requirement 5, which carry the shared tier
> constant `COMPONENT_OVERLAY_TIERS` (`scripts/lib/component-resolve.sh:54`; it is not a
> per-CLI field). A Bash suite SHALL read a TypeScript declaration by **evaluating** the
> module, through a helper that imports it and prints the declared facts (for example a
> `node` helper under `scripts/tests/lib/`), and never by matching the module's text;
> the sandbox already requires a `node` on the restricted `PATH`. A retargeted assertion
> SHALL keep its vacuity guard (a guard that **fails** when the helper prints nothing,
> never one that passes on an empty read) and its mutation property (mutating the
> declared fact in the TypeScript declaration makes the assertion fail), and the
> single-declaration property of the tier set is restated for TypeScript (one exported
> constant, or a guard that fails on two). No check SHALL be weakened or deleted; where
> a fact has no TypeScript declaration yet, the declaration is added rather than the
> check dropped. This is a bounded application of the oracle rule in a pull request that
> migrates no script, and a narrower edit than the removal parent requirement 13
> prescribes for a property that has no TypeScript equivalent; it does not derogate
> from the parent.
>
> (c) Every retargeted assertion SHALL be listed in the description of that pull
> request, with its text before and after.
>
> (d) Every other Bash assertion of the suites of requirement 26 stays unchanged and
> passes through the shims.
>
> The suites that requirement 26 asks for scripts with no Bash test SHALL land in the
> preparatory pull request, against the shell, before any entry exists.

At authoring, at the head of `release/1231-ts-migration`, the assertions of (a) that
the plan review and a search of `scripts/tests/` found are:

- `scripts/tests/test-component-tier-resolution.sh`, case `R20/R1` (lines 1156 to
  1199): `resolved_by_name` and `scan_set` read the landing zone declared by each
  command, `manage-claude-component.sh`, `manage-workspace-component.sh`,
  `manage-copilot-component.sh` and `manage-antigravity-component.sh`, and by the
  sourced `scripts/lib/*.sh` files, and compare it with the one in the assisted setup
  script of the same CLI. Only the command side moves to the TypeScript descriptor;
  the setup side is a row F1 script and stays text until that row migrates it.
- the same suite, case `R20/R2+R5` (lines 1226 to 1293), two facts: the arguments of
  every `component_set_staging_roots` call in `scan_set "$cmd"`, compared with the
  setup's staging root (the guard of trap 5, read the argument of the call and never a
  bare substring, becomes a guard on the evaluated descriptor); and the **tier set**,
  the single `COMPONENT_OVERLAY_TIERS` declaration across the scanned set, which must
  include `library`, `community` and `org` and fails on zero or on more than one
  declaration (the retarget reads it from the TypeScript twin of the constant).
- `scripts/tests/test-antigravity-component-install.sh`, lines 553 to 576, six `grep`
  assertions on `$MANAGE`. Four read a declared destination and move to the descriptor:
  the customization root constant (553), the skills destination (556), the policies
  destination, still under `ANTIGRAVITY_HOME` (spec 0123's exclusion, 573), and the MCP
  settings target (576). The other two, at 566 and 569, check that `PLACED_NAMES` is
  fed and that the supersession migration is called with the right arguments; they
  check an internal channel of the shell, have no declaration to move, and SHALL be
  retargeted to the observable that channel serves, a behavioural assertion that the
  supersession migration actually runs after a placement and fails when it is never
  reached. No check of this suite is deleted.

A search of the other suites that exercise these scripts found no further reader of
their text: `test-install-extension-all.sh`, `test-install-claude-plugin-marketplace.sh`
and `test-build-extension.sh` run the scripts and assert on output and files, and
`test-check-extension-provenance.sh` only mentions `install-extension.sh` and
`link-extensions.sh` in comments and reproduces the `cp -rf` and `ln -s` primitives
itself. The list above is a finding, not a closed enumeration: the plan fixes the
exhaustive list by a call-trace of every suite against the thirteen scripts and the
libraries they source, and an assertion that call-trace finds and that this list omits
is retargeted under (b) with no further delta.

## REMOVED

None.
