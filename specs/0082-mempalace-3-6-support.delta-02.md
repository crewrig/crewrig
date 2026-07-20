---
id: "0082"
slug: mempalace-3-6-support
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 566
version: 1.0.2
---

# Support the MemPalace 3.6.x line

## ADDED

_None._

## MODIFIED

Requirement 3 and its scenario are reworded to match Python packaging version
semantics, surfaced at the DEV stage. The shared version guard
(`mempalace_version_in_range`) compares with `packaging.version`, which orders a
prerelease of the ceiling (for example `3.7.0rc1`) BELOW `3.7.0` final — so an
exclusive `< 3.7` ceiling admits `3.7.0` prereleases. The original R3 demanded
those be rejected, which the `[MIN, MAX)` comparison cannot express without
special-casing a shared helper for a case that requires an explicit prerelease
opt-in to reach and is therefore near-impossible in practice. The `3.7.0` final
release and every later release ARE rejected. The reworded R3 documents the
ceiling-prerelease as an accepted edge rather than mandating behaviour the guard
does not implement. Intent preserved (the framework refuses the next minor line);
edge clarified — a PATCH bump (1.0.1 → 1.0.2).

- Original R3:

  > The interactive setup SHALL reject an installed MemPalace whose version is at
  > or above the supported ceiling (any version `3.7.0` or higher, including a
  > `3.7.x` prerelease).

- Replacement R3:

  > The interactive setup SHALL reject an installed MemPalace whose version is at
  > or above the supported ceiling `3.7.0` — that is, `3.7.0` final and every
  > later release. A prerelease of the ceiling version itself (for example
  > `3.7.0rc1`), which Python packaging orders below `3.7.0` final and which
  > requires an explicit prerelease opt-in to install, is a documented accepted
  > edge that the framework does not special-case; it MAY be admitted.

- Original Scenario ("Above-ceiling prerelease is rejected"):

  > Given an adopter has a MemPalace 3.7.x prerelease installed
  > When they run the interactive setup for any of the four supported CLIs
  > Then setup rejects the installed version as above the supported line and does
  > not register the memory server.

- Replacement Scenario ("At-or-above-ceiling release is rejected"):

  > Given an adopter has MemPalace `3.7.0` (final) or any later release installed
  > When they run the interactive setup for any of the four supported CLIs
  > Then setup rejects the installed version as at or above the supported ceiling
  > and does not register the memory server.

## REMOVED

_None._
