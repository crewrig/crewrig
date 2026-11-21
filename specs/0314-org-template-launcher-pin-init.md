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

An organization author can start from a template repository that already holds the launcher and a pin, run one command, and obtain the organization config repository: configuration file, organization identity and rules, empty homes for skills, agents, hooks and teams, and example role, team and level catalogs, all without cloning or forking the framework. The launcher fetches the pinned framework version once, refuses anything that does not match the pin, reuses its cache offline, and keeps working with every future framework version that honours the same small set of fixed names. This spec fixes those names and the scaffold's exact contents, which are the public surfaces of the distribution model that WP3 owns (spec 0288 R12), and it keeps them as small as the scaffold itself.

## Requirements

Parent spec: `specs/0288-distribution-model.md`. This spec adds to it and does not repeat it: wherever it is silent, 0288 R2 to R9 and R27 apply unchanged to the launcher; it fixes the points that R4, R5, R6, R12 and the *Out of scope* line of 0288 leave to WP3. Pointers read at `origin/release/1822-distribution` on 2026-11-21. This spec, like every WP3 pull request, lands on `release/1822-distribution` only (0288 R16, R18).

Shared definitions. A **plain URL** is a string that the WHATWG `URL` parser accepts, whose scheme is `http:` or `https:`, whose host is non-empty, and that holds no userinfo (`user:password@`), no whitespace or control character, and no `"` or `\`. An **exact version** is a SemVer 2.0.0 version `MAJOR.MINOR.PATCH` with an optional `-prerelease` part, no leading `v`, no build metadata (`+...`), and no leading zero in a numeric identifier.

1. **R1 (pin file path).** The pin file SHALL be `crewrig.pin.json` at the root of the organization config repository, and the launcher SHALL read no other file for the pin. A repository without that file is the absent-file defect of R3; the launcher SHALL NOT search elsewhere.
2. **R2 (pin file syntax).** The pin file SHALL be one UTF-8 JSON object holding at least: `version` (string, an exact version) and `sha256` (string, 64 lowercase hexadecimal characters, the digest of the asset `crewrig-<version>.tgz`); and optionally `base_url` (string, a plain URL, R8). The launcher SHALL ignore any other member, so that a later additive member (a signature, for example) does not break a launcher of this version.
3. **R3 (pin defects).** When the pin file is absent, unreadable, not valid JSON, not an object, lacks `version` or `sha256`, or holds a `version` that is not an exact version (a range such as `^1.0.0`, `1.0.0+b`, `01.0.0`, `../x`, a leading `v`), a `sha256` that is not 64 lowercase hexadecimal characters (uppercase included), or a `base_url` that is not a plain URL, the launcher SHALL print one message naming `crewrig.pin.json` and the defect, exit with code 11, and make no network request. Changing the pin remains a reviewed edit of this file (0288 R4).
4. **R4 (launcher form).** The launcher SHALL be the committed file `crewrig`, with `#!/usr/bin/env node` as first line and the executable mode in git. It SHALL exit with code 10 on a Node.js major version below 24, before reading the pin or touching the network (0288 R3).
5. **R5 (forwarding).** The launcher SHALL NOT interpret, filter or reject any command. Once the pinned version is available (R6, R7), it SHALL run the framework entry point of that version with the current Node.js executable (`process.execPath`), passing `<command> [arguments...]` verbatim and in order, with the working directory and environment inherited and the standard streams attached, and SHALL exit with that process's exit code; when that process ends on a signal, the launcher SHALL exit with code 1. This holds for an invocation with no command as well; which commands exist is decided by the entry point (v1: `init` from this spec, and the commands WP4 adds), and an unknown command SHALL produce the entry point's own error after a verified version is available.
6. **R6 (entry-point descriptor).** The archive SHALL contain, at its root, a file `crewrig.entry.json`: one JSON object with a member `entry` (string, a forward-slash path inside the archive naming a regular file that the archive holds, with the path rules of R9). The launcher SHALL read that descriptor from the verified entry under `~/.crewrig/versions/<version>/` and run the file it names as R5 states; it SHALL NOT assume any other archive path. A missing, unreadable or invalid descriptor, or a descriptor naming a file the entry lacks, SHALL end with code 14. Unknown members SHALL be ignored. The file name `crewrig.entry.json`, the member `entry` and the spawn form of R5 are launcher compatibility items, public surface 2 (R18): every future archive SHALL keep them, since launchers already committed in organization repositories do not change when the pin moves. The path the descriptor names stays internal.
7. **R7 (cache hit, offline, replacement).** When `~/.crewrig/versions/<version>/` is a complete entry recording the pinned digest, the launcher SHALL run it with no network access of any kind, whatever the base URL. Under `~/.crewrig/` the launcher SHALL write only beneath `versions/`. When the entry exists but records a different digest, the launcher SHALL NOT run it, SHALL download and verify (R8), and SHALL then replace the entry by an atomic exchange: the old entry is renamed aside inside `versions/`, the verified one renamed into place, and the old one deleted. This exchange of an entry that fails the pinned digest is the only deletion of a cached version the launcher may make, a narrowing of 0288 R7 (which forbids deleting a cached version on its own account); a failed exchange SHALL leave the old entry in place and exit with code 14.
8. **R8 (download).** The base URL SHALL be the first of: the environment variable `CREWRIG_RELEASE_BASE_URL` when set and non-empty (a value that is not a plain URL makes the launcher exit with code 11, naming the variable); the `base_url` member; the default of 0288 R6. A trailing `/` is ignored. The launcher SHALL request `<base>/crewrig-v<version>/crewrig-<version>.tgz` and SHALL:
    - follow at most 5 redirects (status 301, 302, 303, 307, 308) to a plain URL on any host, since integrity rests on the digest and not on the transport (GitHub Releases answers the default URL with a redirect); any other redirect target, or a sixth redirect, is a download failure;
    - treat as a download failure, code 12, an unreachable host, a connection or inactivity timeout of 30 seconds, a non-success final status, and a body larger than 256 MiB (the download is abandoned when the cap is crossed);
    - hash only the body of the final response, and compare the digest with `sha256`: on a mismatch print the expected digest, the actual digest and the final URL, delete the download, exit with code 13, and extract, cache and execute nothing; no variable, pin member, option or configuration key SHALL weaken that check;
    - print only plain URLs in its messages, so no credential can appear in them; a redirect target holding userinfo is a download failure.
9. **R9 (extraction and publication).** Extraction SHALL read the bytes already verified, never a second download, into a staging directory inside `versions/`, and the entry SHALL become visible as `<version>/` only by one rename of the complete staging directory, the verified digest recorded in it. The launcher SHALL accept gzip-compressed ustar archives whose entries are regular files and directories only, and SHALL end with code 14, discarding the staging directory and caching nothing, on: any other entry type (hard or symbolic link, device, FIFO, PAX or GNU extension header); a path that is absolute, holds `..`, a backslash, a drive letter, a UNC prefix, `:` or a NUL byte, or that resolves outside the staging directory; a duplicate path; an entry traversing a path that an earlier entry made a file; or more than 1 GiB of extracted data. When the final rename finds `<version>/` already present (two concurrent runs), the launcher SHALL re-read that entry and, when it is complete and records the pinned digest, discard its own staging directory and run the existing entry with exit status unaffected; only when it fails that test SHALL it end with code 14.
10. **R10 (exit codes).** The launcher's own refusals SHALL use exactly: `10` runtime floor; `11` pin file, base URL or environment variable defect; `12` download failure; `13` digest mismatch; `14` extraction, descriptor or cache failure. The `init` command of this spec SHALL NOT exit with a code from 10 to 14; the spec of each later command SHALL bind that command alike, so that a code in that range always identifies the launcher.
11. **R11 (environment of the launcher).** The launcher SHALL read the one variable `CREWRIG_RELEASE_BASE_URL` for its own behaviour. The runtime's resolution of the user's home directory (`HOME`, `USERPROFILE`) is sanctioned and is what lets a test isolate `~/.crewrig/`. The launcher SHALL neither enable nor disable the proxy handling of the Node.js runtime; whatever the runtime does with its own variables is not part of this contract.
12. **R12 (launcher source and template).** The template repository SHALL be maintained as the directory `templates/org-repo/` of the CrewRig repository; creating the GitHub template repository from it is an administrator act outside this spec. The directory SHALL contain exactly: the launcher `crewrig` (executable, the only copy of the launcher source in the repository), `crewrig.pin.json` and `README.md`. It SHALL NOT contain `crewrig.config.toml`, a `package.json`, a shell, `.cmd` or `.ps1` file, a `.gitignore`, or any directory of R14. The `README.md` SHALL state the Node.js 24 prerequisite, the steps "run `node crewrig init`, review, commit", how to change the pin from the page of a release, how to set a mirror (`base_url`, `CREWRIG_RELEASE_BASE_URL`), and SHALL present this launcher channel and no other as the default (0288 R1). The launcher SHALL behave identically whatever module type a `package.json` of the organization repository declares (0288 R2).
13. **R13 (template pin).** The pin of the template SHALL name an existing framework release (an exact version and the real digest of its asset). The implementation PR SHALL set it to the latest existing release; because that release predates `init`, a pin-bump pull request on the release branch SHALL set it to a release that carries `init` before the human acceptance run of 0288 R28, and the recorder of R28 SHALL check that before the run. An automated test SHALL assert only what needs no network: the template pin is well-formed (R2, R3), the launcher in the template is the canonical launcher, and `node crewrig init` run in a copy of the template, with the pin rewritten to the version and digest of a locally built archive and `CREWRIG_RELEASE_BASE_URL` pointing at a local server, exits with code 0. No test SHALL download the real release.
14. **R14 (init invocation and refusals).** `node crewrig init [--feedback-repo <url>]` SHALL scaffold into the current working directory only and SHALL decide both refusals before writing anything. When `crewrig.config.toml` exists it SHALL refuse naming that file. Otherwise, when the directory holds an entry other than `.git`, `crewrig`, `crewrig.pin.json`, `README.md`, `.gitignore` and `LICENSE` (the files the template and the forge create), it SHALL refuse naming the first such entry in ascending byte order of names. A refusal SHALL exit with code 1, write, change and delete nothing, and say that `init` runs once, in the repository created from the template. When neither case holds, `init` SHALL proceed. An unknown option, a missing option value, or a `--feedback-repo` value that is not a plain URL SHALL exit with code 2 and write nothing.
15. **R15 (scaffold contents).** A successful `init` SHALL create exactly the following and nothing else, each otherwise-empty directory holding a zero-length `.gitkeep`:
    - `crewrig.config.toml` (R16);
    - `config/ORGANIZATION.md` and `config/TOOLS.md`, byte-for-byte copies of `config/ORGANIZATION.md.template` and `config/TOOLS.md.template` of the pinned version;
    - `config/expertise/`, `config/teams/` and `config/level/`, each holding a byte-for-byte copy of every file that directory holds in the pinned version, copied once and never touched by a later command;
    - `artifacts/org/skills/`, `artifacts/org/agents/` and `artifacts/community/hooks/`, empty homes for the organization's skills, agents and hooks, the paths from which the framework reads them (a settled default, open question 2).
16. **R16 (`crewrig.config.toml`).** The file SHALL be valid TOML with exactly two keys, both strings: `canonical_repo`, written as `https://github.com/crewrig/crewrig`; and `feedback_repo`, the repository that receives feedback on organization-owned components, written as the value of `--feedback-repo` when given and as the value of `canonical_repo` otherwise (a settled default, open question 3). A comment above each key SHALL state its meaning, and the one above `feedback_repo` SHALL say an organization sets it to its own repository. Because a plain URL holds no `"`, `\` or control character, the value is written as a TOML basic string without escaping, and the two-key invariant holds for every accepted input.
17. **R17 (personal layers).** `init` SHALL NOT create `config/SOUL.md`, `config/PROFILE.md`, `.gitignore`, or any `.gitignore` entry. Those two personal files stay absent until the user's `init-soul` and `init-personal-profile` steps create them, and the future `.gitignore` of WP4, which ignores them as the CrewRig repository does, adds to the scaffold without any path of R15 changing.
18. **R18 (manifest and ADR rows).** In the WP3 implementation PR, `scripts/lib/framework-release/manifest.txt` SHALL gain these entries and no other for this spec: `crewrig.entry.json`, the bundled entry point the descriptor names, `config/ORGANIZATION.md.template`, `config/TOOLS.md.template`, `config/expertise`, `config/teams` and `config/level`; the framework's own `config/ORGANIZATION.md`, `config/TOOLS.md`, `config/SOUL.md.template` and `config/PROFILE.md.template` SHALL NOT be added. The same PR SHALL fill the *Public surfaces* table of `docs/adr/0022-distribution-model.md` in place and append one dated line to its change log, with exactly these items (the spec-PR edits no ADR):
    - surface 1, pin file: path `crewrig.pin.json`; members `version`, `sha256`, `base_url`; the plain-URL and exact-version grammars; the ignore-unknown rule; and the per-organization base URL row, settled as the `base_url` member;
    - surface 2, launcher: command `init` with option `--feedback-repo`; the forwarding rule (R5); exit codes 10 to 14 and `1`, `2` of `init`; the variable `CREWRIG_RELEASE_BASE_URL`; and the archive compatibility items of R6 (descriptor name, member `entry`, spawn form);
    - surface 3, `crewrig.config.toml`: keys `canonical_repo`, `feedback_repo`, strings, with their meaning;
    - surface 4, organization directories: the paths of R15.

    Everything else (cache and staging layout, limits of R8 and R9, `.gitkeep`, the template `README.md` wording, the archive path the descriptor names) SHALL stay internal (0288 R12) and absent from the table.
19. **R19 (end-to-end tests, 0288 R27).** The tests of 0288 R27 SHALL cover, with no network beyond a local server, on Linux and `windows-latest`: `init` in a fresh template copy, checked as a full directory listing (R15, nothing else created, nothing written outside the working directory and `~/.crewrig/versions/`); refusal for an existing `crewrig.config.toml`, for a non-empty directory, exit 2 for an unknown option; the pin defects of R3 each with code 11; a cached entry with another digest, replaced after a verified download (R7); two concurrent first runs, both succeeding (R9); a redirecting server, a server answering 302 forever, a body over the size cap and a stalled server, each code 12 (R8); archive entries covering each refused form of R9 (`../x`, `..\x`, `C:\x`, a UNC path, a name with `:`, a name with a NUL byte, a symbolic link, a duplicate path, an entry under an earlier file); a missing or invalid `crewrig.entry.json` (code 14); `CREWRIG_RELEASE_BASE_URL` precedence and the empty value; forwarding of arguments, of the exit code and of a signal ending (R5). Rejected-input table, each refused with code 11 or 2 as R3, R8 and R14 state, and its value absent from output: `ftp://h`, `https://`, `https://u:p@h/x`, `https://h/a b`, `https://h/"`, `https://h/a\b`, a value with a newline, `not a url`. The runtime-floor case (code 10) SHALL run on a leg whose Node.js is major version 22.

## Scenarios

**Scenario:** init scaffolds the organization config repository from the template

```text
Given a fresh copy of the template (crewrig, crewrig.pin.json, README.md) with its pin set to a locally built archive, an empty ~/.crewrig/versions/, and CREWRIG_RELEASE_BASE_URL pointing at a local server that serves it
When  the author runs `node crewrig init --feedback-repo https://github.com/acme/crewrig-config`
Then  the launcher downloads, verifies and caches the version, forwards `init`, and the directory gains exactly crewrig.config.toml (canonical_repo = https://github.com/crewrig/crewrig, feedback_repo = https://github.com/acme/crewrig-config), config/ORGANIZATION.md, config/TOOLS.md, the copied config/expertise, config/teams and config/level, and the empty artifacts/org/skills, artifacts/org/agents and artifacts/community/hooks; config/SOUL.md, config/PROFILE.md and .gitignore are absent; the exit code is 0.
```

**Scenario:** init defaults feedback_repo

```text
Given a fresh template copy and a cached pinned version
When  the author runs `node crewrig init`
Then  feedback_repo equals canonical_repo and the comment above it tells the author to set their own repository.
```

**Scenario:** init refuses an existing configuration

```text
Given a cached pinned version and a directory holding crewrig.config.toml
When  the author runs `node crewrig init`
Then  it exits with code 1 naming crewrig.config.toml, says init runs once, and nothing is written, changed or deleted.
```

**Scenario:** init refuses a non-empty directory

```text
Given a cached pinned version and a directory holding the template files, `notes.txt` and `a.txt`
When  the author runs `node crewrig init`
Then  it exits with code 1 naming `a.txt` (ascending byte order), and nothing is written.
```

**Scenario:** init rejects an unsafe feedback repository

```text
Given a cached pinned version and a fresh template copy
When  the author runs `node crewrig init --feedback-repo 'https://h/"x'`
Then  it exits with code 2 and nothing is written, so crewrig.config.toml never holds anything but two string keys.
```

**Scenario:** init accepts exactly the template's files

```text
Given a cached pinned version and a directory holding only .git, crewrig, crewrig.pin.json, README.md and LICENSE
When  the author runs `node crewrig init`
Then  the scaffold of R15 is created and the exit code is 0.
```

**Scenario:** The cached version runs offline and forwards arguments

```text
Given ~/.crewrig/versions/<version>/ is complete and records the pinned digest, and the base URL is unreachable
When  the user runs `node crewrig build --some-arg value`
Then  no network request is made, the entry point named by crewrig.entry.json receives `build --some-arg value`, and the launcher exits with its exit code.
```

**Scenario:** A digest mismatch is refused

```text
Given a pin naming version X.Y.Z with digest D1 and a server whose archive has digest D2
When  any command is run
Then  the launcher prints D1, D2 and the URL, deletes the download, exits with code 13, and nothing is cached or executed.
```

**Scenario:** A redirected download is verified like any other

```text
Given a valid pin and a local server that answers the asset URL with a 302 to another local port serving the archive
When  the user runs `node crewrig init`
Then  the launcher follows the redirect, hashes only the final body, finds the pinned digest and proceeds; a server redirecting forever ends with code 12 after 5 redirects.
```

**Scenario:** A cached entry with another digest is replaced

```text
Given ~/.crewrig/versions/X.Y.Z/ records digest D0 and the pin names D1, and the server serves the archive of digest D1
When  the user runs a command
Then  the launcher downloads and verifies, exchanges the entry atomically (the old one is the only cached version it deletes), and runs the new entry; had the download failed, the old entry would be untouched.
```

**Scenario:** Two first runs race

```text
Given an empty cache and two launcher processes started together for the same pin
When  both finish extracting and the slower one finds <version>/ already present, complete and recording the pinned digest
Then  it discards its staging directory and runs the existing entry; both exit with the entry point's code and neither exits with 14.
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

**Scenario:** A credential in a URL is refused and never printed

```text
Given CREWRIG_RELEASE_BASE_URL is "https://user:secret@mirror.example/r"
When  any command is run
Then  the launcher exits with code 11 naming the variable, makes no request, and the output holds neither "user" nor "secret".
```

**Scenario:** A hostile archive entry is refused

```text
Given a served archive with the pinned digest that holds an entry named ..\outside (or a symbolic link, or C:\x)
When  the launcher extracts it
Then  it exits with code 14, discards the staging directory, and nothing outside it is written.
```

**Scenario:** The runtime floor is not met

```text
Given a Node.js 22 runtime
When  the user runs `node crewrig init`
Then  one sentence names Node.js 24 and 22, the exit code is 10, and neither the pin nor the network is read.
```

**Scenario:** The template stays compatible with the scaffold

```text
Given the template directory, with its pin rewritten to a locally built archive
When  the end-to-end test runs `node crewrig init` in a copy against a local server
Then  it exits with code 0, and the launcher in the template is the canonical launcher.
```

## Out of scope

- A Renovate (or other bot) configuration that bumps `crewrig.pin.json`: a candidate for a later work package; the pin remains a hand-edited, reviewed file.
- `setup`, `build`, `update` and every command beyond `init`; the files the framework reads from the organization directories; the `.gitignore` for personal layers (WP4, which owns that content); the exit-code binding of WP4's commands (R10 asks their specs for it).
- `config/SOUL.md.template`, `config/PROFILE.md.template`, the `config/claude`, `config/gemini` and `config/copilot` templates and the memory-server service files in the archive: left to WP4 with `setup`.
- Creating or publishing the GitHub template repository (an administrator act), signature verification, authenticated mirrors, restricting the base URL host, cache pruning, the standalone binary, the one-command setup (0288 *Out of scope*; WP8).
- Overlay path declarations or any `crewrig.config.toml` key beyond the two of R16.
- Editing `docs/adr/0022-distribution-model.md` in the spec-PR (R18 assigns it to the implementation PR), and correcting the job names in `docs/framework-release.md`, a documentation follow-up the plan folds in without a requirement.
- Any change on `main` before the final merge (0288 R16, R29, R30).

## Open questions

Each question below has its default already encoded in the requirement named; the default stands unless the owner answers otherwise, and the answer is to be written on logbook issue #2101 before approval. Template location and the pin policy, previously open, are settled in R12 and R13.

1. **Directory names (R15).** The scaffold mirrors framework paths (`artifacts/org/skills`, `artifacts/org/agents`, `artifacts/community/hooks`, `config/teams`) so `setup` and `build` need no translation, while the epic says "skills, agents, hooks, teams". Default: mirrored paths; friendlier top-level names only if WP4 adds a path mapping.
2. **`feedback_repo` default (R16).** Without `--feedback-repo` the value equals `canonical_repo`, which sends organization feedback upstream until edited. Alternatives: derive it from the `origin` remote, or make the option mandatory. Default: explicit option with the `canonical_repo` fallback and a comment, no git inspection.
3. **Exit-code numbers (R10).** Launcher range 10 to 14, kept clear of forwarded codes. Default: as written.
4. **Pre-existing files tolerated by `init` (R14).** Closed list `.git`, `crewrig`, `crewrig.pin.json`, `README.md`, `.gitignore`, `LICENSE`. Default: as written, no interactive prompt.
5. **`base_url` in the pin file (R2, R8).** Placed there because the launcher parses no TOML; settles the ADR "1 or 3" row as surface 1. Default: as written.
6. **Limits of R8 and R9 (30 s inactivity, 5 redirects, 256 MiB download, 1 GiB extracted).** Chosen as generous bounds, not measured against the real asset. Default: as written; the plan may tighten them after measuring the first built archive, with a delta-spec if the numbers change.
