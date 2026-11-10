# ADR 0022 — Distribution model

<!-- crewrig-doc: section=architecture-adr nav_order=220 published=true title="ADR 0022 — Distribution model" -->

**Status:** Accepted (issue #1839, epic #1822 WP1). Decided by
[spec 0288](../../specs/0288-distribution-model.md) R1 to R15 and the owner
decisions it records. **Nothing described here is available on `main` until the
final merge of spec 0288 R29; until then, adopting from `main` remains the fork
model of [`docs/adoption-guide.md`](../adoption-guide.md) (R30).**

## Context

Adopting CrewRig today means forking the whole framework and keeping the fork in sync ([epic #1822](https://github.com/crewrig/crewrig/issues/1822) section 1). Options A (npm package), B1 (committed launcher plus a JS release asset) and B2 (launcher plus a standalone binary) were compared in [this comment](https://github.com/crewrig/crewrig/issues/1822#issuecomment-6417169946); the owner chose B1 in [this one](https://github.com/crewrig/crewrig/issues/1822#issuecomment-6776004630).

- Goal: an organization repository carries a launcher and a pin; anyone who clones it and runs a command gets exactly the pinned framework version, verified, fetched once, reused offline.
- Constraints: Node.js 24 floor (`scripts/lib/node-floor-guard.js`); no shell, `.cmd` or `.ps1` file in the repository since epic #1231; corporate proxies may block `github.com`; the public contract stays minimal (the `crewrig init` scaffold).
- Non-goals: implementing the release unit, the launcher or `crewrig init` (WP2 to WP4); signatures; the standalone binary; authenticated mirrors.

## Decision

### Default channel and secondary channels

- **B1 is the default channel** (R1): a launcher and a pin file committed in the organization config repository. Documentation and the `crewrig init` scaffold present it, and no other, as the default.
- **npm is an optional secondary channel** (R11): if a version is published there, the package is built from the same build output as the archive and carries the same files. Publishing on npm is not required.
- **B2 (standalone binary) is deferred to WP8**, where it is the candidate answer to the Node.js prerequisite of non-technical users.
- Fork mode stays a permitted, non-default path (R1).

### Launcher

One Node.js file named `crewrig` at the root of the organization repository, invoked as `node crewrig <command> [arguments...]` on Linux, macOS and Windows (R2). The `#!/usr/bin/env node` shebang makes `./crewrig` a POSIX convenience, not the documented form. It uses only Node.js built-ins, enforces the Node.js 24 floor before any download (R3), and ships with no shell, `.cmd` or `.ps1` companion.

### Pin and integrity

The pin file records an exact SemVer version and the SHA-256 of that version's archive (R4). **A pinned SHA-256 is the v1 integrity guarantee**: the launcher refuses any download whose digest differs, and nothing can disable the check (R7). Signature verification (Sigstore/cosign) is deferred; adding it later is expected to be an additive change to the pin file (spec 0288 *Out of scope*). Verified versions are cached under `~/.crewrig/versions/<version>/` (R7).

### Release asset

The asset of a framework version is one archive, `crewrig-<version>.tgz` (R8), holding the bundled entry point, every data file `setup` deploys, and the hook scripts, which keep running as `node <script>.ts` from the extracted directory. The digest covers the whole archive.

### Release unit and tags

The framework becomes a release unit of its own, distinct from the extension units (R9). Stable tags are `crewrig-v<X.Y.Z>`, made from `main` only; prerelease tags are `crewrig-v<X.Y.Z>-next.<N>`, pushed by hand on the release branch (R26). The first stable version is `1.0.0`, released from `main` after the final merge (R9, R25). No extension may be named `crewrig`. A published asset is never replaced. SemVer applies to the public surfaces below alone (R10).

### Mirror base URL

The base URL defaults to `https://github.com/crewrig/crewrig/releases/download` (R6). An organization may set its own value in its repository, and an environment variable overrides it for one invocation. The path layout below the base is the GitHub Releases layout for every mirror, so an Artifactory or Nexus generic remote proxying `github.com` serves it unchanged. The launcher has one code path whatever the base.

### Release integrity and release-branch regime

Release integrity (prerelease provenance, credential confinement, tag creation, immutability, authenticity) is **specified and verified by WP2 of epic #1822, under spec 0288 R31**. WP2 to WP4 land on `release/1822-distribution` under the regime of spec 0288 R16 to R31, which this ADR does not restate.

### Where the public surfaces are enumerated

The single enumeration that R13 requires is the *Public surfaces* section of this ADR.

## Public surfaces (R12, R13)

**Nothing listed here is available on `main` until the final merge of spec 0288 R29; until then, adopting from `main` remains the fork model of [`docs/adoption-guide.md`](../adoption-guide.md) (R30).**

| Surface | Item | Fixed by | Since |
|---|---|---|---|
| 1. Pin file | Path and syntax: exact version, SHA-256 digest (R4) | WP3 spec | — |
| 2. Launcher | Invocation `node crewrig <command> [arguments...]` (R2) | spec 0288 R2 | — |
| 2. Launcher | v1 commands and their arguments | WP3/WP4 specs | — |
| 2. Launcher | Exit codes | WP3/WP4 specs | — |
| 2. Launcher | Environment variables the launcher reads, the base-URL override (R6) among them | WP3/WP4 specs | — |
| 1 or 3, placed by WP3 | Per-organization base URL value (R6) | WP3 spec | — |
| 3. `crewrig.config.toml` | Keys the scaffold writes, with types and meaning | WP3 spec | — |
| 4. Organization directories | Directories the scaffold creates, and files the framework reads from them | WP3/WP4 specs | — |

- **Rule (R13).** A surface absent from this table is internal, even when an organization depends on it. Adding or removing a surface is a change to this table recorded by an ADR or a spec.
- **Internal surfaces (R12).** `scripts/`, the `Taskfile.yml` targets, the archive's internal layout, the cache layout under `~/.crewrig/versions/`, specs, ADRs and the lifecycle carry no SemVer promise.
- **How the table changes.** The WP3 or WP4 implementation PR that ships a named item edits its row in place, on `release/1822-distribution`, and appends one dated line to the change log below. No amendment adds a dated section to this ADR, so the table stays the one place of R13. A one-file spec-PR never carries this edit.
- **Since.** Names the first stable framework version that ships the item; a prerelease (`-next.<N>`) never counts. It stays `—` on the release branch. The final-merge PR of spec 0288 R29 sets it to `1.0.0` (R9) for every row shipped by then; a row shipped later is set by the PR that ships it on `main`, naming the next stable version.

Change log:

- 2026-11-10 — Table created with every item unnamed (issue #1839).

## Rejected alternatives

- **npm as the default channel (option A).** Rejected: one more prerequisite (npm) and one more command per user, a `package.json`, lockfile and `node_modules/` in every organization repository, and npm reads as foreign tooling to non-JavaScript teams ([comparison](https://github.com/crewrig/crewrig/issues/1822#issuecomment-6417169946)). Kept as the optional channel of R11.
- **B2 (standalone binary) from v1.** Rejected: a per-OS build matrix, macOS and Windows code signing, and hooks rewired through the binary, while the robustness of a Node.js single executable on the current code base is unmeasured. Deferred to WP8.
- **A shell/`.cmd` (or PowerShell) launcher pair.** Rejected: B1 already requires Node.js 24, and the repository has held no `.sh`, `.cmd` or `.ps1` file since epic #1231 (R2); a pair would add two scripts to maintain and test per platform.
- **A single-file bundle (`crewrig.mjs`).** Rejected: `setup` deploys data files and hooks run as `node <script>.ts` from the extracted version directory, which one JavaScript file cannot carry (R8).

## Consequences

- The framework gets its first release unit; WP2 adds it beside the extension units, whose tag format and flow stay unchanged (R9).
- An upgrade is a reviewed change to the pin file in the organization repository, the only path to a new version (R4).
- Integrity rests on one digest per version. A compromised release page could hand an author a matching pin for a malicious asset, which is why WP2 must specify release authenticity (R31) before any release ships.
- Node.js 24 stays a user prerequisite until WP8 decides on B2.
- `~/.crewrig/` gains a `versions/` cache that the launcher never prunes (R7; pruning out of scope).
- This ADR becomes a mutable registry: every future public surface edits its *Public surfaces* table.

## Devil's advocate

The strongest counter-argument: option A gets pinning, integrity, proxying and Renovate support for free from npm, and B1 rebuilds each of them (digest check, cache, mirror URL, regex Renovate manager) in a launcher that every organization then carries, for the gain of one command and one prerequisite. The answer: the rebuilt parts are small and testable without a network (R27), the mirror layout reuses what Artifactory and Nexus already proxy, and npm stays available from the same artifact, so an organization that prefers it loses nothing. A second objection concerns placement: an enumeration inside an ADR is prose, not a machine-readable manifest that a future SemVer check could read. That check is out of scope today; WP6, when adopter documentation exists, is the point to revisit the placement.
