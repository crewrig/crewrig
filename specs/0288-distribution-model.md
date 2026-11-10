---
id: "0288"
slug: distribution-model
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1839
version: 1.0.0
---

# Distribution model and release-branch regime (parent spec of epic 1822)

## Intent

An organization that adopts CrewRig no longer forks the framework. Its own small repository carries a launcher and a pin naming one framework version; anyone who clones that repository and runs a command gets exactly that version, refused if its content does not match the pin, fetched once from the public CrewRig releases or from the organization's own mirror, and reused offline afterwards. Maintainers gain a published framework release, distinct from the extension releases, and a short, explicit list of the surfaces they promise to keep stable; everything else stays free to change. The work that builds this reaches `main` as one tested whole, only after a person unfamiliar with CrewRig has completed the first shared-skill loop from a test release.

## Requirements

Every "verified" pointer below is a `path:line` at `origin/main @ 426819f2`, or a forge read made on 2026-11-10. The owner decisions this spec records are those of the epic comment [issuecomment-6776004630](https://github.com/crewrig/crewrig/issues/1822#issuecomment-6776004630) and of issue #1839 section 1; they are fixed inputs, not proposals. R1 to R11 define the distribution model, R12 and R13 the minimal public contract, R14 and R15 the DEV-stage deliverables of issue #1839, and R16 to R30 the release-branch regime of epic #1822.

1. **R1 (default channel).** The default channel by which an organization obtains the CrewRig framework SHALL be a launcher committed in the organization config repository together with a pin file (option B1 of the [comparison comment](https://github.com/crewrig/crewrig/issues/1822#issuecomment-6417169946)). The documentation and the `crewrig init` scaffold SHALL present this channel, and no other, as the default. The npm channel of R11 and the fork mode of epic #1822 section 2 remain permitted non-default paths; no other channel SHALL be documented as supported by this epic.

2. **R2 (launcher form).** The launcher SHALL be one file named `crewrig`, at the root of the organization config repository, written as a Node.js script. Its documented invocation SHALL be `node crewrig <command> [arguments...]` on Linux, macOS and Windows alike. Its first line SHALL be `#!/usr/bin/env node`, so that `./crewrig <command>` also works on a POSIX system with the executable bit set; that form is a convenience and SHALL NOT be the documented one. No shell script, `.cmd` or `.ps1` companion SHALL be shipped: the repository holds none since epic #1231 and the ratchet allowlist is empty. The launcher SHALL depend on nothing but the Node.js runtime and its built-in modules, because nothing is installed before it first runs, and SHALL behave identically whatever module type any `package.json` of the organization repository declares.

3. **R3 (runtime floor).** The launcher SHALL require the same Node.js floor as the framework (Node.js 24, `scripts/lib/node-floor-guard.js`). Run on a lower major version, it SHALL print one sentence naming the required floor and the version found, exit non-zero, and download nothing — never a syntax error or a stack trace.

4. **R4 (pin file).** The organization config repository SHALL carry exactly one pin file recording (a) the framework version as an exact SemVer version, never a range, and (b) the lowercase hexadecimal SHA-256 digest of that version's release asset (R8). The pin file's path and syntax are a public surface (R12) and are fixed by the spec of WP3. When the pin file is missing, unreadable, malformed, holds a range, or holds a digest that is not 64 hexadecimal characters, the launcher SHALL refuse with a message naming the file and the defect, exit non-zero, and download nothing. Changing the pinned version or digest is a reviewed change to that file in the organization repository; it is the only permitted path to a new version.

5. **R5 (resolution and download).** On every command, the launcher SHALL resolve the pinned version. When a verified copy of that version with the pinned digest is in the cache (R7), it SHALL run that copy with no network access. Otherwise it SHALL download the asset `crewrig-<version>.tgz` from `<base>/<tag>/crewrig-<version>.tgz`, where `<base>` is the mirror base URL of R6 and `<tag>` the release tag of R9. On a download failure (unreachable host, timeout, non-success HTTP status), it SHALL exit non-zero with a message naming the URL and the failure, cache nothing, and leave nothing that a later run could mistake for a complete download.

6. **R6 (mirror base URL).** The base URL SHALL default to `https://github.com/crewrig/crewrig/releases/download`. It SHALL be configurable (a) per organization, as a value committed in the organization config repository, and (b) per invocation, through an environment variable that overrides (a) for that invocation only, for continuous integration and local tests. Both names are public surfaces (R12) fixed by the spec of WP3. The path layout below the base SHALL be the GitHub Releases layout of R5 for the default and for every mirror alike, so that a generic remote proxying `github.com` (Artifactory, Nexus) serves it without rewriting. The launcher SHALL take one code path whatever the base: no behaviour, and in particular not the integrity check of R7, SHALL depend on whether the base is the default.

7. **R7 (integrity and cache).** Before extracting or running anything it downloaded, the launcher SHALL compute the SHA-256 digest of the downloaded archive bytes and compare it with the pin. On a mismatch it SHALL refuse, print the expected digest, the actual digest and the URL, delete the download, exit non-zero, and cache and execute nothing. No flag, environment variable or configuration key SHALL disable, weaken or bypass this check. A verified archive SHALL be extracted into `~/.crewrig/versions/<version>/` under the user's home directory on every operating system, the entry recording the digest it was verified against, and an entry SHALL become usable only once complete, so that an interrupted run or two concurrent runs never leave a partly extracted version that a later run would execute. When the cache holds the pinned version under a different recorded digest, the launcher SHALL NOT run it and SHALL download and verify again. The launcher SHALL NOT create, change or delete anything under `~/.crewrig/` outside `versions/`, which already holds other CrewRig state (`hooks/`, `system-context/`, `usage/`, `validation.conf`), and SHALL NOT delete a cached version on its own.

8. **R8 (release asset shape).** The release asset of a framework version SHALL be one gzip-compressed tar archive named `crewrig-<version>.tgz`, not a single-file bundle. It SHALL contain the bundled command-line entry point, every data file that `setup` deploys (rules, compiled skills and agents, and the like), and the hook scripts, which keep running as `node <script>.ts` from the extracted version directory. Running a command from the extracted archive SHALL require no package-manager installation step for the framework itself. The digest of R4 is computed over the whole archive; a file outside the archive is not part of the version.

9. **R9 (framework release unit).** The framework SHALL become a release unit of its own, distinct from the extension units. Today `scripts/monorepo-release.ts` releases extensions only, under the tag format `<ext>-v<version>` (`scripts/lib/monorepo-release/releaserc.ts:50`; the only extension is `extensions/core/hello-world`, and every GitHub Release of the repository is a `hello-world-v*` one), and the framework has never been released. A stable framework release SHALL be tagged `crewrig-v<X.Y.Z>`, the stable counterpart of the prerelease form `crewrig-v<X.Y.Z>-next.<N>` that issue #1839 fixes (R26), and the ADR of R15 records this format. It is disjoint from `<ext>-v*` only while no extension is named `crewrig`, so no extension SHALL be given that name; it is disjoint from the `spec-id/*` reservation tags by construction. Each framework release SHALL be a GitHub Release of `crewrig/crewrig` carrying the asset of R8 and its SHA-256 digest, published so that an organization author can write the pin of R4 from the release page alone. Stable framework releases SHALL be made from `main` only. Once published, a version's asset SHALL NOT be replaced, since every pin of that version would then refuse it; a defective release is superseded by a new version. The extension units, their tag format and their release-PR flow SHALL stay unchanged.

10. **R10 (version semantics).** The framework version SHALL follow SemVer over the public contract of R12 alone: a breaking change to a public surface SHALL bump MAJOR, an additive change to one SHALL bump at least MINOR, and a change confined to internal surfaces SHALL never require a MAJOR bump.

11. **R11 (npm as optional secondary channel).** When a framework version is also published on npm, the npm package SHALL be built from the same build output as the archive of that version and carry the same files, and SHALL NOT be presented as the default channel. Publishing on npm is optional and is not required by any requirement of this spec.

12. **R12 (the four public surfaces).** The public, SemVer-versioned contract of the framework SHALL consist of exactly what the `crewrig init` scaffold exposes, in four surfaces: (1) the pin file, its path and syntax (R4); (2) the launcher's commands, their arguments, their exit codes, and the environment variables the launcher reads (R6); (3) the keys of `crewrig.config.toml` that the scaffold writes, with their types and meaning; (4) the organization-owned directories that the scaffold creates and the files the framework reads from them. Every other surface — `scripts/`, the `Taskfile.yml` targets, the archive's internal layout, the cache layout under `~/.crewrig/versions/`, specs, ADRs and the lifecycle — SHALL be internal and SHALL carry no SemVer promise.

13. **R13 (one enumeration).** The public surfaces SHALL be enumerated, item by item, in one place that the ADR of R15 names, so that "is this surface public?" has a single answer. A surface absent from that enumeration SHALL be internal even when an organization depends on it; making it public SHALL go through a change to the enumeration recorded by an ADR or a spec.

14. **R14 (deliverables, outside the spec-PR).** The spec-PR of this ticket SHALL contain this file only (one-file rule, `specs/0003-spec-pr-workflow.md` R2). The DEV stage of #1839 SHALL deliver, on `main`: the ADR of R15; and an epic #1822 body in which the default channel is B1, WP2 to WP4 are listed as targeting `release/1822-distribution`, and no remaining statement presents npm as the default channel (the sequence diagram and the *Direction* bullets that still show the npm flow included).

15. **R15 (ADR "Distribution model").** The ADR SHALL be `docs/adr/0022-distribution-model.md`, 0022 being the next free number at authoring time (the last is `docs/adr/0021-task-is-the-ci-contract.md`), or the next free number if 0022 is taken when it lands. It SHALL record: B1 as the default channel; npm as an optional secondary channel built from the same artifact; the standalone binary (B2) deferred to WP8; signature verification deferred, with a pinned SHA-256 as the v1 integrity guarantee; the Node.js launcher and the rejection of a shell/`.cmd` wrapper pair; the archive asset and the rejection of a single-file bundle; the release tag formats of R9 and R26; the mirror base URL; the location of the enumeration of R13; and, each with the reason for its rejection, the alternatives considered: npm as default (option A), B2 from v1, the wrapper pair, and the single-file bundle.

16. **R16 (own regime, scoped).** WP2, WP3 and WP4 of epic #1822 — their spec-PRs, delta-spec PRs, implementation PRs and sub-tickets — SHALL land on `release/1822-distribution` and on no other branch, except the single file R26 places on `main`. For those work packages only, the ordering rule of `specs/0003-spec-pr-workflow.md` (R3, R4) and of `docs/spec-pr-workflow.md` → *Ordering rule* reads with `release/1822-distribution` in place of `main`. This regime is defined here for epic #1822: it SHALL NOT be read as an amendment of spec 0003, as a reading or extension of the derogation of `specs/0215-shell-to-typescript-migration.delta-04.md` (whose R27 forbids its generalisation), or as a precedent for any other ticket, and it sunsets at the final merge of R29. WP0 (#1823), this ticket (#1839), WP5 to WP8, and any work package the epic adds later SHALL flow through `main`; a later work package joins the release branch only through a delta-spec of this spec.

17. **R17 (preconditions and sequencing).** `release/1822-distribution` SHALL be cut from `origin/main` after this spec has merged on `main` with `status: approved`. Creating it is a repository act of the owner or of the orchestrating session holding the rights, never of a `spec-author`, `developer` or reviewer agent. The protection of the branch is the existing ruleset `release-protected` (id 24240579), verified with `gh api repos/crewrig/crewrig/rulesets/24240579` on 2026-11-10: `enforcement: active`, `conditions.ref_name.include` = `refs/heads/release/**`, rules `deletion`, `non_fast_forward` and required status checks `ratchet` and `lint-typescript` (integration 15368). That ruleset is shared by every `release/**` branch (`release/1231-ts-migration` and `release/1445-acceptance-base` exist on 2026-11-10); this regime SHALL NOT create, modify or delete it. No branch of WP2, WP3 or WP4 SHALL be cut, and no pull request SHALL be opened against the release branch, until, in this order: this spec has merged; the branch exists; the ruleset is re-verified active over it with the two required contexts; the ADR of R15 has merged on `main` and is present on the release branch; the epic body reads as R14 requires. When any of these does not hold, an agent SHALL stop and report the missing precondition to the owner, and SHALL NOT open the pull request against `main` as a fallback.

18. **R18 (targeting, lifecycle and merge authorisation).** Every pull request of WP2, WP3 and WP4 SHALL target `release/1822-distribution`. Branch prefixes and names keep their conventions (`spec/<NNNN>-<slug>`, `feat/<NNNN>-<slug>`, and the like); only the branch each is cut from and merged into changes, and the one-file rule of a spec-PR is unchanged. For these tickets, a spec reaches `status: approved` when its spec-PR merges on the release branch and `status: implemented` when its implementation PR merges there (`docs/spec-format.md` → *Lifecycle states* reads accordingly). The rule of `AGENTS.md` → *Branching Strategy* that no pull request merges without the user's formal permission, asked immediately before the merge, SHALL apply to every merge into the release branch, sync pull requests included.

19. **R19 (up-to-date merge precondition).** For a pull request of WP2, WP3 or WP4, the up-to-date precondition of `AGENTS.md` → *Branching Strategy* reads: immediately before `gh pr merge`, the pull request's head SHALL be 0 commits behind `origin/release/1822-distribution`, every check SHALL be green on that head, and that head SHALL be the one the reviewer approved. A feature branch MAY be rebased onto the release branch; the release branch itself is shared and SHALL NEVER be rebased, reset or force-pushed.

20. **R20 (drift control).** `main` SHALL be merged into the release branch after every pull request of WP2, WP3 or WP4 that lands there, and at least once every seven days while the branch exists. Each sync SHALL be a pull request of its own, from a branch named `chore/1822-sync-main-<YYYYMMDD>`, targeting the release branch, merged with the merge-commit method — never squash, never rebase — so that `main`'s commits become ancestors of the release branch and the final merge does not re-conflict on files already reconciled; the repository allows that method (`gh api repos/crewrig/crewrig` → `allow_merge_commit: true`, verified 2026-11-10). The spec linter already exempts that branch form from its implementation-PR check (`scripts/lib/spec-linter.js:778-783`, pattern `^chore\/\d{4}-sync-main`). When `main` has no commit the release branch lacks, no sync pull request SHALL be opened and the no-op SHALL be recorded on the epic. Conflicts SHALL be resolved inside the sync pull request. A change made on `main` to a surface that the release branch has replaced or reshaped SHALL be ported in the same sync pull request or, when it cannot be ported there, named in it with a follow-up ticket — never dropped. A conflict on a `metadata.provenance.version` field SHALL resolve to the next SemVer step above the higher of the two values.

21. **R21 (issue closing and epic tracking).** A closing keyword acts only on a merge into the default branch, so the agent that merges a pull request of WP2, WP3 or WP4 into the release branch SHALL close that work package's sub-ticket by hand immediately after the merge, with a comment naming the pull request; `AGENTS.md` → *Logbook Issues* Rule C keeps its obligation and changes only its mechanism. No pull request SHALL carry a closing keyword for epic #1822 under this regime, the final merge of R29 included, since the epic continues with WP5 to WP8 on `main`. From the moment the release branch exists, the epic body's work-package table SHALL distinguish, for each of WP2 to WP4, *merged on the release branch* from *on `main`*, and SHALL be kept current at every state change.

22. **R22 (spec ids stay collision-free).** Sub-spec files of WP2 to WP4 live only on the release branch until the final merge, so the merged-spec source of the allocated set (`scripts/lib/spec-ids/reserve-allocated.ts:44`, `mergedSpecPaths`, read from `main`) does not see them; the reservation refs `refs/spec-ids/*` and `refs/tags/spec-id/*` (`scripts/lib/spec-ids/reserve-allocated.ts:21-22`) keep their ids out of the allocated set for every other session. No reservation ref SHALL therefore be deleted, pruned or reclaimed before the final merge has landed and every spec file of WP2 to WP4 is on `main`. A sub-spec author SHALL secure its id with `scripts/reserve-spec-id.ts --issue <N>` exactly as on `main`; a delta-spec reuses its parent's id and secures nothing.

23. **R23 (base ref for every agent).** For every agent working WP2, WP3 or WP4, whatever CLI runs it, the base ref SHALL be `origin/release/1822-distribution` wherever the protocol names `main`: the ticket worktree is created from it (`docs/agent-team-protocol/worktree-isolation.md:13` reads `git worktree add -b <branch> .worktrees/<ticket-id> origin/release/1822-distribution`); a `pr-reviewer` reads the pull request's actual `baseRefName` and diffs against it; and the pre-push rebase of a feature branch targets it. An orchestrator briefing a sub-agent SHALL state the base ref in the brief, except in a reviewer-seat brief, whose closed reference list (`docs/reviewer-seat.md`) is unchanged: the seated reviewer derives the base from the pull request.

24. **R24 (CI coverage of the release branch).** The release branch SHALL rely on the checks that already trigger on it, and the gaps below are recorded, not silently accepted. Verified on 2026-11-10:
    - Run on a pull request to, and a push on, `release/**`: `build.yml` (`.github/workflows/build.yml:5-12`), which carries the required `ratchet` (`:34`, `BASE_REF` set to the pull request's base at `:40`) and `lint-typescript` (`:52`) and calls the six stage workflows, among them `lint-specs` (`.github/workflows/_ci-gate.yml:119`, `BASE_REF` at `:126`), `check-skill-versions` (`.github/workflows/_ci-governance.yml:234`, `BASE_REF` at `:238`), `check-spec-id-reserved` (`.github/workflows/_ci-governance.yml:275`) and the `windows-latest` jobs of `.github/workflows/_ci-windows.yml`; and `derive-spec-status.yml`, `mempalace-session-check.yml`, `playwright-mcp.yml`, `release-notes.yml`, `release-tests.yml`, `scripting-conventions.yml` (pull requests only), `spec-view.yml`, `ticket-pickup.yml`, `windows-hook-probe.yml` and the `usage-*.yml` workflows, each of which lists `release/**` beside `main`.
    - Do not run on the release branch: `pages.yml` (push on `main`), `release-monorepo.yml` (push on `main` and manual dispatch, R25), `security-mcp.yml` (pull request to `main` only, `.github/workflows/security-mcp.yml:3-12`), `changeset-coverage.yml` (schedule on the default branch and manual dispatch) and `release-rehearsal.yml` (manual dispatch only); `claude.yml` and `copilot.yml` react to comments. `security-mcp.yml` is a gap: it audits changes to `package.json` and `package-lock.json`, which WP2 is likely to make. Until a pull request on `main` adds `release/**` to its `pull_request.branches` and that change reaches the release branch by sync, a pull request of WP2 to WP4 that changes a `package.json` or `package-lock.json` SHALL run `npm audit --audit-level=critical` locally (the command of `.github/workflows/security-mcp.yml:44`) and record the result on its logbook comment.
    - On a push, `ratchet` and `lint-specs` receive an empty `BASE_REF` and fall back to `main`, which is cumulative and still meaningful; the pull-request run stays authoritative for the merge.

25. **R25 (no extension release and no stable framework release from the release branch).** `release-monorepo.yml` runs on a push to `main` and on manual dispatch (`.github/workflows/release-monorepo.yml:3-8`), and its engine releases from the branch it is run on (`scripts/lib/monorepo-release/releaserc.ts:49`, `branches: [input.branch]`). It SHALL NOT be dispatched on the release branch, and no stable framework tag (R9) SHALL be created from it. Releases of work outside the epic continue from `main` unchanged and reach the release branch by the sync of R20. The first stable framework release SHALL be made from `main`, after the final merge of R29, and not before.

26. **R26 (prereleases for human acceptance — differs from 0215 delta-04 R36).** Prereleases of the framework release unit MAY be published, under these conditions only: each is started by a maintainer's manual dispatch, never by a push or a schedule; it runs from `release/1822-distribution` only, and a dispatch on any other ref SHALL refuse before creating any tag or release; it is tagged `crewrig-v<X.Y.Z>-next.<N>`, `<N>` starting at 1 and increasing for a given `X.Y.Z`; its GitHub Release is marked *prerelease* and never *latest*; it carries the same asset shape and digest as a stable release (R8, R9) and is never replaced once published. Prereleases exist for the human acceptance test of R28; no prerelease SHALL be published from `main`. Because GitHub offers a manually dispatched workflow only when its file exists on the default branch, the dispatch entry point SHALL be present on `main` before the first prerelease, as the one file of the release-unit work that lands on `main` ahead of the final merge; on `main` it SHALL produce nothing but the refusal above.

27. **R27 (end-to-end tests without real releases).** Automated tests of the launcher SHALL NOT download from GitHub Releases or from any network host. They SHALL serve a locally built archive from a local HTTP server through the per-invocation base URL override of R6, and SHALL cover at least: first run (download, verify, cache, run), a digest mismatch (refusal, nothing cached or executed), a cached run with the base URL unreachable, an unreachable base URL with an empty cache, and a malformed pin file. They SHALL run on pull requests to `main` and to `release/**`, on Linux and on `windows-latest`.

28. **R28 (human acceptance condition).** Before the final-merge pull request is opened, at least one person unfamiliar with CrewRig — who has not contributed to `crewrig/crewrig` and has not operated a CrewRig fork — SHALL complete the first shared-skill loop from a prerelease of R26 pinned by its digest, with no help beyond the documentation that prerelease and its template ship: as organization author, scaffold an organization config repository, add a skill and push it; as colleague, clone that repository, run `node crewrig setup`, and use the skill in at least one supported CLI. The run SHALL be recorded as a comment on epic #1822 naming the prerelease tag, the role each participant played (never their identity), the elapsed time to first shared skill (the epic's success measure), and every blocker met. A run that a blocker stops does not satisfy this requirement: the fix lands on the release branch, a new prerelease is published, and the loop is run again.

29. **R29 (single final merge and sunset).** After WP2, WP3 and WP4 have merged on the release branch, exactly one pull request SHALL merge `release/1822-distribution` into `main`; there SHALL be no partial or milestone merge. It is the downstream pull request that `docs/post-merge-flow.md` (an "intermediate integration branch that must eventually reach `main`") requires after each merge into the release branch; for those merges, step 3 of that flow is satisfied by this standing statement and no per-work-package pull request toward `main` SHALL be opened. The final pull request SHALL be opened only when: every spec and delta-spec of WP2 to WP4 records `status: implemented` on the release branch head; the branch is 0 commits behind `main` (a last sync of R20 has landed); every check is green, the `windows-latest` jobs included; and R28 is satisfied and recorded. The user's formal permission SHALL be asked immediately before the merge. When a condition does not hold, the pull request SHALL NOT be opened, or SHALL NOT be merged, and the release branch stays. After the final merge, no pull request SHALL target the release branch, the owner deletes the branch, worktrees and base refs revert to `main`, reservation refs are kept (R22), prerelease tags and releases are kept, and the shared ruleset of R17 is left in place.

30. **R30 (reading of `main` during the regime).** While the release branch lives, a reference to `main` in the process rules that R16 to R29 name (stage ordering, lifecycle status triggers, the up-to-date precondition, worktree and review base, the linters' comparison base) SHALL read as the branch the pull request targets. A reference to `main` as what adopters see SHALL keep its meaning: until the final merge, adopting from `main` remains the fork model of `docs/adoption-guide.md`, and no document on `main` — the WP0 README (#1823) included — SHALL present the launcher, the pin file or `crewrig init` as available.

## Scenarios

**Scenario:** First run downloads, verifies, caches and runs the pinned version

Given an organization config repository whose pin file names version `X.Y.Z` with the digest of `crewrig-X.Y.Z.tgz`, no mirror configured, and an empty `~/.crewrig/versions/`
When a colleague runs `node crewrig setup` on Windows
Then the launcher downloads `https://github.com/crewrig/crewrig/releases/download/crewrig-vX.Y.Z/crewrig-X.Y.Z.tgz`, finds its digest equal to the pin, extracts it into `~/.crewrig/versions/X.Y.Z/` with the digest recorded, and runs `setup` from there; nothing else under `~/.crewrig/` changes.

**Scenario:** A cached version runs offline

Given `~/.crewrig/versions/X.Y.Z/` is complete and records the pinned digest
When the colleague runs `node crewrig build` with no network access
Then the command runs from the cache and no download is attempted.

**Scenario:** A digest mismatch is refused

Given a pin file naming `X.Y.Z` with digest `D1`, and a base URL serving an archive whose digest is `D2`
When any command is run
Then the launcher prints `D1`, `D2` and the URL, deletes the download, exits non-zero, caches nothing and executes nothing, and no flag, variable or configuration key makes it proceed.

**Scenario:** A corporate mirror takes the same path

Given the organization repository configures the base URL of an Artifactory generic remote that proxies `github.com`
When a colleague behind a proxy that blocks `github.com` runs `node crewrig setup`
Then the archive is fetched from `<mirror>/crewrig-vX.Y.Z/crewrig-X.Y.Z.tgz` with no path rewrite, and is verified against the pin exactly as from the default base.

**Scenario:** The runtime floor is not met

Given a machine with Node.js 22
When the user runs `node crewrig setup`
Then one sentence names Node.js 24 as the floor and 22 as the version found, the exit code is non-zero, and nothing is downloaded.

**Scenario:** The organization repository declares an ES module package

Given the organization config repository has a `package.json` declaring `"type": "module"`
When the user runs `node crewrig setup`
Then the launcher behaves exactly as in a repository with no `package.json`.

**Scenario:** A work package lands on the release branch and its sub-ticket is closed by hand

Given the release branch exists under the active `release-protected` ruleset, the ADR has merged on `main` and been synced, and the WP2 spec-PR has merged on the release branch with `status: approved`
When the WP2 implementation PR, cut from `origin/release/1822-distribution`, is approved, found 0 commits behind that branch with every check green on the approved head, and merged there with the user's permission
Then the agent closes the WP2 sub-ticket by hand with a comment naming the pull request, the epic table shows WP2 as merged on the release branch and not on `main`, and no pull request toward `main` is opened for WP2.

**Scenario:** A work-package pull request is opened against `main` by mistake

Given the release branch exists and a WP3 pull request has `main` as its base
When a reviewer audits it
Then the reviewer raises a finding naming R16 and R18, the pull request is retargeted to `release/1822-distribution`, and it is not merged on `main`.

**Scenario:** A precondition of the regime is missing

Given this spec has merged and the release branch exists, but the ADR of R15 has not merged on `main`
When an agent picks up WP2
Then it opens no pull request against the release branch, reports the missing precondition to the owner, and does not fall back to `main`.

**Scenario:** A sync with nothing to carry

Given `main` has no commit that the release branch lacks
When the weekly sync date arrives
Then no sync pull request is opened and the no-op is recorded on the epic.

**Scenario:** A prerelease is dispatched from the release branch

Given the prerelease entry point is on `main` and WP2 has merged on the release branch
When a maintainer dispatches it on `release/1822-distribution`
Then a GitHub Release `crewrig-vX.Y.Z-next.1` is created, marked prerelease and not latest, carrying `crewrig-X.Y.Z.tgz` and its digest, and no stable `crewrig-vX.Y.Z` tag exists.

**Scenario:** A prerelease is dispatched from another ref

Given the prerelease entry point is on `main`
When a maintainer dispatches it on `main` or on any branch other than `release/1822-distribution`
Then it refuses before creating any tag or release.

**Scenario:** End-to-end tests never touch a real release

Given a pull request of WP3 to the release branch
When CI runs the launcher's end-to-end tests on Linux and on `windows-latest`
Then each test serves a locally built archive through the base URL override, no request leaves the runner, and the mismatch, offline-cache, unreachable-base and malformed-pin cases each pass.

**Scenario:** The final merge is attempted before the acceptance run

Given WP2 to WP4 have merged on the release branch, but no recorded run of R28 has completed the shared-skill loop
When an agent proposes to merge the release branch into `main`
Then the pull request is not opened, or is not merged, and the release branch stays.

**Scenario:** The final merge

Given every spec of WP2 to WP4 records `status: implemented` on the release branch, a person unfamiliar with CrewRig has completed the shared-skill loop from `crewrig-vX.Y.Z-next.N` and the run is recorded on #1822, the last sync has landed and every check is green
When the user gives formal permission
Then exactly one pull request merges the release branch into `main`, it closes neither epic #1822 nor any other issue, the branch is then deleted, the `release-protected` ruleset stays, and the first stable `crewrig-vX.Y.Z` release can be made from `main`.

## Out of scope

- Implementing the framework release unit, the launcher, `crewrig init`, `setup`, `build` and `update`: WP2 to WP4, each under its own spec.
- The exact path and syntax of the pin file, the names of the mirror configuration key and environment variable, and the v1 command list: fixed by the specs of WP3 and WP4 within the surfaces of R12.
- Publishing on npm and reserving the `@crewrig` npm scope (optional, later; R11 only constrains the content if it happens).
- Signature verification (Sigstore/cosign) and the standalone binary (B2, WP8). Adding a signature later is expected to be an additive change to the pin file.
- Authenticated mirrors (credentials for an Artifactory or Nexus remote); v1 assumes the base URL is readable without credentials.
- Restricting the base URL's scheme or host: integrity rests on the pinned digest of R7 whatever the transport.
- Pruning or garbage-collecting `~/.crewrig/versions/`.
- A mechanical check that fails a pull request changing a public surface without the matching SemVer bump.
- A Renovate configuration that bumps the pin file; a candidate for WP3.
- Migrating existing forks (WP5), deprecating fork-as-default (WP6), `crewrig contribute` (WP7), and the one-command setup for non-technical users (WP8).
- The epic's "open question for WP1" on whether the friction curator runs per user or against a shared organization palace: it is not in the scope of issue #1839 and stays on the epic.

## Open questions

- **Prerelease entry point on `main` (R26).** GitHub offers a manually dispatched workflow only when its file exists on the default branch, so the entry point must reach `main` ahead of the final merge. Which pull request carries it? Recommended: one small pull request on `main`, under WP2, adding only that workflow file, whose job refuses any ref other than `release/1822-distribution`; the steps it runs on the release branch come from that branch's own copy of the file.
- **Final-merge method (R29).** Recommended: the merge-commit method, so that the commits the prereleases are tagged on stay reachable from `main` and the work-package history survives; spec 0215 delta-04 R37 left the method to the owner at merge time.
- **First stable version (R9, R10, R26).** Recommended: `1.0.0`, with prereleases `crewrig-v1.0.0-next.<N>`, because the point of R12 is a SemVer promise and a `0.y.z` version makes no promise; the alternative, `0.1.0`, keeps the contract free to change during WP5 to WP8.
- **Participants of the acceptance run (R28).** Must both roles, organization author and colleague, be played by people unfamiliar with CrewRig? Recommended: yes, one such person may play both roles in sequence, because the organization author is the epic's primary persona and the colleague's half alone would not test `crewrig init`.
