---
id: "0311"
slug: org-extensions-outside-root-workspaces
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 2073
version: 1.0.0
---

# Org extensions outside the upstream-locked workspace set

## Intent

An adopting organization that commits its own extensions under `extensions/org/`
keeps a working dependency install on every CI job and every developer machine,
without editing any upstream-owned file. The upstream dependency lockfile stays
valid whatever the adopter's org tier contains, and the org tier still has a
documented, supported way to install and build its own extensions' dependencies.

## Requirements

1. The root workspace set SHALL cover only the upstream-owned extension tiers
   (`extensions/core/*` and `extensions/library/*`). `extensions/org/*` SHALL NOT
   be part of it, so the upstream lockfile, generated where the org tier is empty,
   describes exactly the workspaces that exist in an unmodified checkout.
2. With any number of extensions under `extensions/org/` (zero included) and no
   edit to a `strict` path, a frozen install of the root dependency tree
   (`npm ci`, with or without `--omit=dev --workspaces=false`) SHALL succeed on
   an adopter's checkout. This covers the install steps of
   `.github/actions/ci-job/action.yml` and `.github/workflows/_ci-integration.yml`.
3. An adopter SHALL NOT need to regenerate the root lockfile, edit the root
   `package.json`, or edit any other file listed `strict` in
   `.crewrig/core-paths.txt` to add, rename or remove an org extension.
4. A documented install path for `extensions/org/*` SHALL exist: an org
   extension that ships the standard skeleton `package.json` can have its own
   dependencies installed and its own `build` and `test` scripts run, and that
   path SHALL be reachable without touching the root lockfile. When
   `extensions/org/` holds no extension, the path SHALL complete successfully
   as a no-op rather than fail.
5. The upstream lockfile and the root `build` and `test` scripts SHALL keep
   covering every extension under `extensions/core/` and `extensions/library/`
   exactly as before; the change SHALL NOT alter the resolved versions of any
   upstream dependency.
6. `task create-extension` SHALL keep producing an `extensions/org/<name>`
   extension in the standard skeleton format (including its `package.json`), and
   its output SHALL satisfy requirement 2 without a follow-up manual step.
7. `docs/adoption-guide.md` and `extensions/org/README.md` SHALL state that the
   org tier is outside the root workspace set and SHALL name the install path of
   requirement 4. The extension-tiers contract of spec 0024 (org tier excluded
   from the sync, never guarded, restored or aborted on) SHALL remain unchanged.
8. A regression check SHALL fail when the root workspace declaration matches a
   path under `extensions/org/`, and SHALL fail when a frozen root install
   breaks in the presence of a skeleton-shaped org extension.

## Scenarios

### Happy path

- **Given** an adopter fork whose `extensions/org/demo/` holds the standard
  skeleton `package.json` and whose strict files are byte-identical to upstream,
- **When** a CI job runs the frozen root install (`npm ci --omit=dev --workspaces=false`),
- **Then** it exits 0 and the sync with upstream still reports no strict-path
  divergence.

### Happy path: org tier install

- **Given** the same fork with one org extension,
- **When** the adopter runs the documented org-tier install path,
- **Then** that extension's dependencies are installed and its `build` script
  can run, and the root lockfile is unchanged byte for byte.

### Empty org tier

- **Given** an upstream checkout where `extensions/org/` holds only its README,
- **When** the frozen root install and the org-tier install path both run,
- **Then** both exit 0 and neither modifies a tracked file.

### Failure path

- **Given** a change to the root `package.json` that re-adds a pattern matching
  `extensions/org/*` to the workspace set,
- **When** the regression check runs,
- **Then** it fails and names the offending workspace pattern.

## Out of scope

- A fourth extension tier or any change to the three-tier layout of spec 0024.
- Making the org tier's lockfiles shared with, or merged into, the upstream
  lockfile.
- Publishing or packaging org extensions (the packaging scripts are unchanged).
- Populating `extensions/library/`.
- Repairing an adopter fork whose lockfile was already regenerated with org
  extensions; the adopter restores the strict files from upstream through the
  normal sync.
- Rejected alternative: keep `extensions/*/*` and make the adopter regenerate
  the lockfile. It diverges two `strict` files and aborts the next sync.
- Rejected alternative: ignore `extensions/org` in the root lockfile check or
  mark `package.json` and `package-lock.json` as non-strict. It weakens the
  upstream-owned guarantee for every adopter.
- Rejected alternative: remove `package.json` from org extensions. It leaves the
  extension skeleton format.

## Open questions

- Which install path serves `extensions/org/*`? (a) a per-extension install
  (`npm ci` in each directory, each with its own lockfile) driven by a `task`
  target; (b) an adopter-owned, org-tier root `package.json` workspace file
  under `extensions/org/` with its own lockfile; (c) documentation only, no
  tooling. Recommendation: (b), because one adopter-owned lockfile keeps the
  tier inside the adopter's sphere and needs no new loop.
- Should `npm run build` and `npm run test` at the root also cover the org tier
  after this change? (a) no, the org install path owns its own scripts;
  (b) yes, through an aggregating `task` target. Recommendation: (a), since the
  root scripts are upstream-owned and must not depend on adopter content.
- Must the regression check run in upstream CI only, or also be shipped to
  adopters? (a) upstream only; (b) shipped, strict, and run in adopter CI.
  Recommendation: (b), at no extra adopter edit.
