---
id: "0314"
slug: org-template-launcher-pin-init
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 2101
version: 1.0.0
---

# Organization template, launcher contract, pin file and `crewrig init` scaffold (WP3 of epic 1822)

## Intent

An organization author can start from a template repository that already holds the launcher and a valid pin, run one command, and obtain the organization config repository: configuration file, organization identity and rules, empty homes for skills, agents, hooks and teams, and example role, team and level catalogs, all without cloning or forking the framework. The launcher fetches the pinned framework version once, refuses anything that does not match the pin, reuses its cache offline, and reads its settings from a short list of fixed names that organizations and maintainers can rely on. This spec fixes those names and the scaffold's exact contents, which are the public surfaces of the distribution model that WP3 owns (spec 0288 R12), and it keeps them as small as the scaffold itself.

## Requirements

Parent spec: `specs/0288-distribution-model.md` (R1 to R13 are not restated; this spec fixes what R4, R5, R6, R12 and the *Out of scope* line of 0288 leave to WP3). All pointers read at `origin/release/1822-distribution` on 2026-11-21. This spec, like every WP3 pull request, lands on `release/1822-distribution` only (0288 R16, R18).

1. **R1 (path).** The pin file SHALL be the file `crewrig.pin.json`, at the root of the organization config repository, and the launcher SHALL read no other file for the pin. A repository holding no such file is the degenerate case of R3, not a case where the launcher searches elsewhere.
2. **R2 (syntax).** The pin file SHALL be one UTF-8 JSON object with exactly these members: `version` (string, an exact SemVer version, prerelease suffix such as `1.0.0-next.3` allowed, never a range, no leading `v`); `sha256` (string, 64 lowercase hexadecimal characters, the digest of the asset `crewrig-<version>.tgz`); and optionally `base_url` (string, R9). Members not named here SHALL be ignored by the launcher, so that a later additive member (a signature, for example) does not break a launcher of this version. The launcher SHALL compare digests case-sensitively after requiring lowercase form; an uppercase digest is a defect (R3).
3. **R3 (defects).** When the pin file is absent, unreadable, not valid JSON, not an object, lacks `version` or `sha256`, holds a `version` that is not an exact SemVer version, a `sha256` that is not 64 lowercase hexadecimal characters, or a `base_url` that is not a string, the launcher SHALL print one message naming `crewrig.pin.json` and the defect, exit with code 11, and download nothing. The only permitted path to a new version remains a reviewed edit of this file (0288 R4).

4. **R4 (form and floor).** The launcher SHALL be the committed file `crewrig`, whose first line is `#!/usr/bin/env node` and whose mode in the repository is executable. It SHALL import Node.js built-in modules only, and SHALL check the Node.js 24 floor before reading the pin or touching the network (0288 R3), exiting with code 10 on a lower major version.
5. **R5 (forwarding).** For every invocation `node crewrig <command> [arguments...]`, including an invocation with no command, the launcher SHALL, after the pin is read and the pinned version is available (R6, R7), run the framework entry point of the cached version with the same `<command>` and arguments, verbatim and in the same order, the working directory and environment inherited and the standard streams attached, and SHALL exit with that process's exit code. The launcher SHALL NOT interpret, filter or reject any command: which commands exist is decided by the entry point (the v1 command list is `init` from this spec, and the commands WP4 adds). A command the entry point does not know SHALL therefore produce the entry point's own error, after a verified version is available. When the entry point ends on a signal, the launcher SHALL exit non-zero.
6. **R6 (cache hit, offline).** The launcher SHALL resolve the pinned version into `~/.crewrig/versions/<version>/` under the user's home directory, as 0288 R7 requires. When that entry is complete and records the pinned digest, the launcher SHALL run it with no network access of any kind, whatever the configured base URL and whether or not the network is reachable. A cached entry recording a different digest SHALL NOT be run; the launcher SHALL download and verify again. The launcher SHALL NOT create, modify or delete anything under `~/.crewrig/` outside `versions/`.
7. **R7 (download, verification failure, offline with empty cache).** When no usable entry exists, the launcher SHALL download `<base>/crewrig-v<version>/crewrig-<version>.tgz` (0288 R5, R9), compute the SHA-256 digest of the downloaded bytes, and compare it with `sha256`.
    - On a digest mismatch it SHALL print the expected digest, the actual digest and the URL, delete the download, exit with code 13, and neither extract, cache nor execute anything. No flag, environment variable, pin member or configuration key SHALL weaken or skip the check.
    - On a download failure (unreachable host, timeout, non-success status, which includes an empty cache with no network) it SHALL print the URL and the failure, exit with code 12, and leave no entry under `versions/` that a later run could mistake for complete.
    - On a match it SHALL extract into a staging location under `~/.crewrig/versions/` and make the entry visible under `<version>/` only once complete and carrying the verified digest. An archive entry whose path is absolute, contains `..`, or resolves outside the staging location, or that is a link, SHALL make the launcher discard the staging location, exit with code 14, and cache nothing. Any other failure to extract or publish the entry SHALL end the same way (code 14).
8. **R8 (exit codes).** The launcher's own refusals SHALL use exactly these exit codes: `10` runtime floor not met; `11` pin file defect (R3); `12` download failure; `13` digest mismatch; `14` extraction or cache failure. On success the launcher SHALL exit with the forwarded process's code (R5). The framework entry point SHALL NOT itself exit with a code from 10 to 14, so that a code in that range always identifies the launcher.
9. **R9 (base URL).** The base URL SHALL be resolved, first match wins, from (a) the environment variable `CREWRIG_RELEASE_BASE_URL`, when set and non-empty, for that invocation only; (b) the `base_url` member of the pin file; (c) the default `https://github.com/crewrig/crewrig/releases/download`. A trailing `/` of the resolved value SHALL be ignored. A resolved value that is not an absolute `http:` or `https:` URL SHALL be a pin defect when it comes from (b) (R3) and SHALL make the launcher exit with code 11 naming the variable when it comes from (a). The launcher SHALL read no other environment variable or file for its own behaviour. The name `base_url` and the variable name are public surfaces (R18).
10. **R10 (launcher source).** The launcher SHALL have one canonical source in the CrewRig repository, and every copy shipped in the template (R11) SHALL be byte-identical to it, checked by an automated test. The launcher SHALL behave identically whatever module type any `package.json` of the organization repository declares (0288 R2).

11. **R11 (contents).** The template repository SHALL contain exactly: the launcher `crewrig` (R4, executable); `crewrig.pin.json` naming an existing framework release and the real digest of its asset (R2), so that the first command works; and a `README.md`. It SHALL NOT contain `crewrig.config.toml`, any `package.json`, any shell, `.cmd` or `.ps1` file, a `.gitignore`, or any organization directory of R14 or R15 (the scaffold creates them, R14; `.gitignore` is left to WP4, R16). The `README.md` SHALL state the Node.js 24 prerequisite, the steps "run `node crewrig init`, review, commit", how to change the pin from the page of a release, how to set a mirror (`base_url`, `CREWRIG_RELEASE_BASE_URL`), and SHALL present this launcher channel and no other as the default (0288 R1).
12. **R12 (template is consumable).** Running `node crewrig init` in a fresh copy of the template SHALL succeed (R13), so the template's pin and the scaffold stay compatible; an automated test SHALL run that sequence against a locally served archive (R19).

13. **R13 (invocation and refusals).** `node crewrig init [--feedback-repo <url>]` SHALL scaffold into the current working directory, and nowhere else. It SHALL check both refusal cases before writing anything:
    - when `crewrig.config.toml` already exists, it SHALL refuse naming that file;
    - otherwise, when the directory holds any entry other than `.git`, `crewrig`, `crewrig.pin.json`, `README.md`, `.gitignore` and `LICENSE` (the files the template and the forge create), it SHALL refuse naming the first such entry.

    A refusal SHALL exit non-zero with code 1, write, change and delete nothing, and say that `init` runs once, in the repository created from the template. When neither case holds (including a directory holding exactly the template's files), `init` SHALL proceed. An unknown option SHALL exit with code 2 and write nothing.
14. **R14 (scaffold contents).** A successful `init` SHALL create exactly the following, and nothing else, with directories that would otherwise be empty holding a zero-length file named `.gitkeep`:
    - `crewrig.config.toml` (R15);
    - `config/ORGANIZATION.md` and `config/TOOLS.md`, each a byte-for-byte copy of `config/ORGANIZATION.md.template` and `config/TOOLS.md.template` of the pinned version;
    - `config/expertise/`, `config/teams/` and `config/level/`, each holding a byte-for-byte copy of every file that directory holds in the pinned version, copied once and never touched by a later command;
    - `artifacts/org/skills/`, `artifacts/org/agents/` and `artifacts/community/hooks/`, empty homes (with `.gitkeep`) for the organization's skills, agents and hooks, the paths from which the framework reads them.
15. **R15 (`crewrig.config.toml`).** The file SHALL be valid TOML with exactly two keys, each a string: `canonical_repo`, the CrewRig repository, written as `https://github.com/crewrig/crewrig`; and `feedback_repo`, the repository that receives feedback on organization-owned components, written as the value of `--feedback-repo` when given, and as the value of `canonical_repo` otherwise. A comment above each key SHALL state its meaning, and the one above `feedback_repo` SHALL say that an organization sets it to its own repository. A `--feedback-repo` value that is not an absolute `http:` or `https:` URL SHALL be refused with code 2, writing nothing.
16. **R16 (personal layers).** `init` SHALL NOT create `config/SOUL.md`, `config/PROFILE.md`, `.gitignore`, or any `.gitignore` entry. The personal layers stay absent until the user's `init-soul` and `init-personal-profile` steps create them, and the future `.gitignore` of WP4 (which ignores `config/SOUL.md` and `config/PROFILE.md`, as the CrewRig repository does) can be added to the scaffold without any path of R14 changing.

17. **R17 (manifest additions).** `scripts/lib/framework-release/manifest.txt` SHALL gain, in the WP3 implementation PR, these entries and no other for this spec: `config/ORGANIZATION.md.template`, `config/TOOLS.md.template`, `config/expertise`, `config/teams`, `config/level`, and the bundled framework entry point that carries `init` (the file the launcher runs, R5). The framework's own `config/ORGANIZATION.md`, `config/TOOLS.md`, `config/SOUL.md.template` and `config/PROFILE.md.template` SHALL NOT be added by this spec. A test SHALL assert that a built archive contains every file of R14's copies.

18. **R18 (ADR rows).** The implementation PR SHALL fill the *Public surfaces* table of `docs/adr/0022-distribution-model.md` in place, and append one dated line to its change log, with exactly these items (the spec-PR of this file edits no ADR):
    - surface 1, pin file: path `crewrig.pin.json`; members `version`, `sha256`, `base_url`; ignore-unknown rule (R1 to R3, R9);
    - surface 1, per-organization base URL: the `base_url` member (R9), which places the "1 or 3" row;
    - surface 2, launcher: command `init` and its option `--feedback-repo`; the forwarding rule (R5); exit codes 10 to 14 (R8) and `1` and `2` of `init` (R13); the environment variable `CREWRIG_RELEASE_BASE_URL` (R9);
    - surface 3, `crewrig.config.toml`: keys `canonical_repo`, `feedback_repo`, both strings, with their meaning (R15);
    - surface 4, organization directories: `config/ORGANIZATION.md`, `config/TOOLS.md`, `config/expertise/`, `config/teams/`, `config/level/`, `artifacts/org/skills/`, `artifacts/org/agents/`, `artifacts/community/hooks/` as scaffolded (R14), with the files the framework reads from them as WP4 fixes.

    Everything else in this spec (cache layout, staging, archive layout, `.gitkeep`, the template's `README.md` wording, the launcher's source location) SHALL stay internal (0288 R12) and absent from the table.

19. **R19 (end-to-end tests).** The tests of 0288 R27 SHALL be extended to cover, with the same no-network rule, on Linux and `windows-latest`: `init` in a fresh template copy (R13, R14); a refusal for an existing `crewrig.config.toml`; a refusal for a non-empty directory; `--feedback-repo` valid and invalid; the pin-file defects of R3 each with code 11; an archive entry escaping the staging location (R7, code 14); and forwarding of arguments and exit code (R5).

## Scenarios

**Scenario:** init scaffolds the organization config repository from the template

```text
Given a fresh copy of the template (crewrig, crewrig.pin.json, README.md), an empty ~/.crewrig/versions/, and CREWRIG_RELEASE_BASE_URL pointing at a local server that serves the pinned archive
When  the author runs `node crewrig init --feedback-repo https://github.com/acme/crewrig-config`
Then  the launcher downloads, verifies and caches the pinned version, forwards `init`, and the directory gains crewrig.config.toml (canonical_repo = https://github.com/crewrig/crewrig, feedback_repo = https://github.com/acme/crewrig-config), config/ORGANIZATION.md, config/TOOLS.md, the copied catalogs config/expertise, config/teams and config/level, and the empty homes artifacts/org/skills, artifacts/org/agents and artifacts/community/hooks; config/SOUL.md, config/PROFILE.md and .gitignore are absent; the exit code is 0.
```

**Scenario:** init defaults feedback_repo

```text
Given a fresh template copy and a cached pinned version
When  the author runs `node crewrig init`
Then  feedback_repo equals canonical_repo and the comment above it tells the author to set their own repository.
```

**Scenario:** init refuses an existing configuration

```text
Given a directory holding crewrig.config.toml
When  the author runs `node crewrig init`
Then  it exits with code 1 naming crewrig.config.toml, says init runs once, and nothing is written, changed or deleted.
```

**Scenario:** init refuses a non-empty directory

```text
Given a directory holding the template files and a file `notes.txt`
When  the author runs `node crewrig init`
Then  it exits with code 1 naming `notes.txt`, and nothing is written.
```

**Scenario:** init accepts exactly the template's files

```text
Given a directory holding only .git, crewrig, crewrig.pin.json, README.md and LICENSE
When  the author runs `node crewrig init`
Then  the scaffold of R14 is created and the exit code is 0.
```

**Scenario:** The cached version runs offline and forwards arguments

```text
Given ~/.crewrig/versions/<version>/ is complete and records the pinned digest, and the base URL is unreachable
When  the user runs `node crewrig build --some-arg value`
Then  no network request is made, the entry point receives `build --some-arg value`, and the launcher exits with the entry point's exit code.
```

**Scenario:** A digest mismatch is refused

```text
Given a pin naming version X.Y.Z with digest D1 and a server whose archive has digest D2
When  any command is run
Then  the launcher prints D1, D2 and the URL, deletes the download, exits with code 13, and nothing is cached or executed, whatever environment variable or pin member is set.
```

**Scenario:** Unreachable base with an empty cache

```text
Given a valid pin, an empty cache and an unreachable base URL
When  the user runs `node crewrig setup`
Then  the launcher prints the URL and the failure, exits with code 12, and leaves no entry under ~/.crewrig/versions/ that a later run would execute.
```

**Scenario:** A malformed pin file is refused

```text
Given crewrig.pin.json holding "version": "^1.0.0"
When  any command is run
Then  one message names crewrig.pin.json and the range as the defect, the exit code is 11, and no request is made.
```

**Scenario:** The base URL override beats the pin member

```text
Given crewrig.pin.json holds base_url "https://mirror.example/releases" and CREWRIG_RELEASE_BASE_URL is "http://127.0.0.1:8123/"
When  a command needs a download
Then  the request goes to http://127.0.0.1:8123/crewrig-v<version>/crewrig-<version>.tgz, and an empty CREWRIG_RELEASE_BASE_URL makes the pin member apply.
```

**Scenario:** A hostile archive entry is refused

```text
Given a served archive with the pinned digest that holds an entry named ../outside
When  the launcher extracts it
Then  it exits with code 14, discards the staging location, and nothing outside it is written.
```

**Scenario:** The runtime floor is not met

```text
Given Node.js 22
When  the user runs `node crewrig init`
Then  one sentence names Node.js 24 and 22, the exit code is 10, and neither the pin nor the network is read.
```

**Scenario:** The template stays compatible with the scaffold

```text
Given the template at the pinned version
When  the end-to-end test runs `node crewrig init` in a copy against a local server
Then  it exits with code 0 and the launcher in the copy is byte-identical to the canonical launcher source.
```

## Out of scope

- A Renovate (or other bot) configuration that bumps `crewrig.pin.json`: a candidate for a later work package; the pin remains a hand-edited, reviewed file.
- `setup`, `build`, `update` and every other command beyond `init`; the files the framework reads from the organization directories; the `.gitignore` for personal layers (WP4, which owns the `.gitignore` content).
- `config/SOUL.md.template`, `config/PROFILE.md.template`, the `config/claude`, `config/gemini` and `config/copilot` templates and the memory-server service files in the archive: left to WP4 with `setup`.
- Creating or publishing the template repository on GitHub (a repository administrator act), signature verification, authenticated mirrors, restricting the base URL host, cache pruning, the standalone binary, the one-command setup (0288 *Out of scope*; WP8).
- Overlay path declarations or any `crewrig.config.toml` key beyond the two of R15.
- Editing `docs/adr/0022-distribution-model.md` in the spec-PR (R18 assigns it to the implementation PR), and correcting the job names in `docs/framework-release.md`, a documentation follow-up the plan folds in without a requirement.
- Any change on `main` before the final merge (0288 R16, R29, R30).

## Open questions

1. **Template location.** Where does the template repository live: a directory `templates/org-repo/` in the CrewRig repository, mirrored to a dedicated GitHub template repository (for example `crewrig/crewrig-org-template`) by an administrator, or a hand-maintained separate repository? Recommended default: the directory in this repository is the canonical source (so R10 and R12 are testable in CI), and the GitHub template repository is a mirror of it created by an administrator; the creation itself stays out of scope.
2. **Directory names (R14).** The scaffold mirrors the framework paths (`artifacts/org/skills`, `artifacts/org/agents`, `artifacts/community/hooks`, `config/teams`) so `setup` and `build` need no translation. The epic names them "skills, agents, hooks, teams". Recommended default: keep the mirrored paths; offer friendlier top-level names (`skills/`, `agents/`, ...) only if WP4 adds a path mapping.
3. **`feedback_repo` default (R15).** Without `--feedback-repo`, the value equals `canonical_repo`, which sends organization feedback upstream until edited. Alternatives: derive it from the `origin` remote of the directory, or make the option mandatory. Recommended default: the explicit option with the `canonical_repo` fallback and the comment, no git inspection.
4. **Exit-code numbers (R8).** The launcher range 10 to 14 and the reservation of that range against the entry point are proposed here. Recommended default: keep them, since they keep launcher failures distinguishable from forwarded codes.
5. **Allowed pre-existing files for `init` (R13).** The closed list `.git`, `crewrig`, `crewrig.pin.json`, `README.md`, `.gitignore`, `LICENSE` covers the template and a forge-created repository. Recommended default: keep the closed list; a different file blocks `init`, never an interactive prompt.
6. **Template pin freshness (R11).** The template must carry a real digest, so it ships a prerelease pin during the regime (`crewrig-v1.0.0-next.<N>`) and the stable `1.0.0` pin only after the first stable release. Recommended default: the plan sets the pin of each prerelease used for the R28 acceptance run, and a test only checks well-formedness, not that the version is the latest.
7. **Pin member `base_url` versus a TOML key (R9).** The base URL is placed in the pin file because the launcher cannot parse TOML with built-ins alone. Recommended default: keep it in `crewrig.pin.json`; the ADR row "1 or 3" is settled as surface 1.
