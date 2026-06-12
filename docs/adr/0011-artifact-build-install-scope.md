# ADR 0011 — Artifact build/install scope model

<!-- crewrig-doc: section=architecture-adr nav_order=110 published=true title="ADR 0011 — Artifact build/install scope model" -->

**Status:** Proposed (issue #258; refines the build/install amalgamation in spec 0014)

## Context

CrewRig compiles artifact sources under `artifacts/` into per-CLI component
files via `scripts/build-components.sh`. The directory is organized into
tiers — `core/`, `library/`, `community/`, and `organisation/` — classified
by `docs/layers.md` and spec 0014.

Testing fork-adoption surfaced two structural defects, both confirmed by
inspecting the current code:

1. **The build is not tier-agnostic, and one tier is dead.**
   `build-components.sh` hardcodes three source roots (`CORE_DIR`,
   `LIBRARY_DIR`, `COMMUNITY_DIR`) and globs only those for skills and
   agents. The `organisation/` tier is never compiled; it holds only
   `.gitkeep` placeholders. The `community → organisation` promotion model
   documented in `docs/layers.md` is therefore unrealisable — anything
   "promoted" to `organisation/` silently stops being built.

2. **Build and install are conflated.** The build writes every compiled
   component into the project-side output directories
   (`$REPO_DIR/.claude/skills/`, `.gemini/skills/`, `.github/skills/`). It
   performs no scope routing. Spec 0014 R11 states the *intent* that `core`
   is project-scoped and `library` is user-home-scoped, but the build
   realizes only the former; home installation of skills exists solely in
   out-of-band manual scripts (`manage-claude-component.sh`). The result: the
   "user-home-scoped" classification is aspirational, and there is no
   first-class notion of *installing* a built artifact to a destination
   distinct from *building* it.

Spec 0014 pinned two scope facts (`core → project`, `library → home`) but
left `community`/`organisation` scope unspecified and did not separate the
build concern from the install concern. This ADR closes both gaps.

## Decision

Separate **building** an artifact from **installing** it, and make the build
tier-agnostic.

### 1. The build compiles every tier

`build-components.sh` SHALL discover and compile artifact sources for every
tier present under `artifacts/`, not a hardcoded subset. Adding a new tier
directory SHALL NOT require editing the build's tier list.

### 2. Installation is routed by scope and trigger

A compiled artifact is *installed* to a destination. The destination and the
trigger depend on the tier:

| Tier | Build | Install destination | Trigger | Maturity |
|---|---|---|---|---|
| `core` | always | **project** (`.claude/skills/` etc. in the repo) | automatic | tooling CrewRig needs to evolve itself and the org artifacts/docs it hosts |
| `library` | always | **home** (`~/.claude/…`) | automatic | harness machinery, useful within CrewRig and across other projects |
| `community` | always | **home** | **on demand** (opt-in) | experimental, in development, or under validation |
| `org` | always | **home** | **on demand** (opt-in) | validated, official organization artifacts |

### 3. Maturity, not scope, distinguishes the overlay tiers

`community` and `org` share the same destination (home) and the same trigger
(opt-in). They differ only in **maturity**: `community` is the sandbox for
experimental or in-progress work; `org` holds validated, official
components. Promotion from `community` to `org` is a maturity transition, not
a scope change.

### 4. Opt-in is the safety boundary

Experimental `community` artifacts do not leak into every project the user
works on, because their installation to home is **opt-in**, not automatic.
This replaces the alternative of project-scoping the sandbox (see
*Alternatives considered*): safety comes from an explicit install gate, which
keeps the maturity model uniform (every overlay tier installs to home) while
preventing unvalidated components from becoming globally active by default.

### 5. The `org` tier becomes real

`artifacts/organisation/` is renamed `artifacts/org/` and, by virtue of the
tier-agnostic build, is compiled like any other tier. The previously dead
promotion target gains a concrete meaning: the opt-in, home-installed home of
validated organization components.

## Consequences

- **Build refactor.** `build-components.sh` stops writing non-`core` tiers
  directly into the project-side output directories. The separation of build
  output from install destination — staging layout, the install entry point,
  the opt-in selection surface for `community`/`org` — is the WHAT realized by
  spec 0019; this ADR fixes the doctrine, not the mechanism.
- **Refines spec 0014.** Spec 0014 R11's `core → project` and `library → home`
  scope facts are preserved. This ADR adds the `community`/`org` scope and
  trigger, and introduces the build/install separation that 0014 amalgamated.
  Because merged specs are immutable, any change to 0014's normative text
  chains via a delta-spec to 0014; otherwise spec 0019 carries the new
  requirements and cites this ADR.
- **`org` rename.** `artifacts/organisation/` → `artifacts/org/`; live
  references in `docs/`, `CONTRIBUTING.md`, `README.md`, and `docs/layers.md`
  follow. Merged specs are not edited (append-only); they retain the
  historical name.
- **Adoption clarity.** Adopters gain a coherent mental model: `core` stays in
  the project (CrewRig's own tooling), `library` is always available in their
  home, and they opt their own `community`/`org` components into their home
  when ready.

## Alternatives considered

- **Scope the sandbox by destination (`community → project`).** Keep
  `community` project-scoped so experimental skills cannot reach home.
  Rejected: the opt-in install trigger already prevents leakage without a
  scope split, and a uniform "all overlay tiers install to home" rule is
  simpler than a per-tier scope matrix.
- **All non-`core` tiers install to home automatically.** Rejected:
  automatically activating experimental `community` components in every
  project is the precise failure mode the opt-in gate exists to prevent.
- **Collapse to a single overlay tier.** Drop the `community`/`org`
  distinction and keep one overlay tier. Rejected: it discards the
  experimental-vs-validated maturity signal that the opt-in promotion model
  depends on.
