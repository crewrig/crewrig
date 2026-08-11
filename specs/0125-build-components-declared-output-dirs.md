---
id: "0125"
slug: build-components-declared-output-dirs
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 804
version: 1.0.0
---

# Build components script declares its output directories, and the core-paths guard asks it

## Intent

A developer adding a direct write or new component output path to `scripts/build-components.sh` cannot introduce a silent ungoverned built-output directory, because `scripts/check-core-paths.sh` queries `scripts/build-components.sh` for its declared built-output directories instead of parsing call sites.

## Requirements

1. `scripts/build-components.sh` SHALL support a `--list-output-dirs` query mode flag.
2. When invoked with `--list-output-dirs`, `scripts/build-components.sh` SHALL print the declared built-output directory relative paths (one per line, sorted and unique) and exit 0 without executing prerequisite tool checks (`yq`, `jq`) or compiling components.
3. By default (or when `--tier core` is given with `--list-output-dirs`), `--list-output-dirs` SHALL report the core built-output directories written under the committed project tree (`.claude/skills`, `.claude/agents`, `.gemini/skills`, `.gemini/commands`, `.gemini/agents`, `.github/skills`, `.github/agents`, `.agents/skills`, `.agents/agents`).
4. When `--tier <tier>` is given with `--list-output-dirs` for a non-core tier, `--list-output-dirs` SHALL report the staging output directories under `dist/<tier>/`.
5. `scripts/check-core-paths.sh` SHALL query `scripts/build-components.sh --list-output-dirs` to obtain the built-output directories, replacing the static call-site parse.
6. `scripts/check-core-paths.sh` SHALL fail with exit code 2 when `scripts/build-components.sh --list-output-dirs` fails or returns no output directories.
7. The contract and limitations of `--list-output-dirs` SHALL be documented in `scripts/build-components.sh` and in `docs/cli-matrix.md`.
8. `docs/cli-matrix.md` SHALL be updated in the same diff as required by the CLI Matrix Maintenance protocol.

## Scenarios

**Scenario:** querying built-output directories fast without prerequisite dependencies

```text
Given a system where `yq` or `jq` is not installed
When  `bash scripts/build-components.sh --list-output-dirs` is run
Then  it exits 0 and prints the declared relative output directory paths
And   no error about missing yq or jq is emitted
```

**Scenario:** check-core-paths uses the declared query mode

```text
Given the repository checkout
When  `bash scripts/check-core-paths.sh` is run
Then  it invokes `scripts/build-components.sh --list-output-dirs`
And   it verifies that all reported built-output directories are governed by `.crewrig/core-paths.txt`
```

**Scenario:** a direct output write is declared and caught if ungoverned

```text
Given a direct output write added to `scripts/build-components.sh` writing to an ungoverned directory `.newcli/skills`
When  `bash scripts/check-core-paths.sh` is run
Then  the guard fails and reports `.newcli/skills` as an ungoverned built-output directory
```

**Scenario:** query mode failure causes guard to fail closed

```text
Given `scripts/build-components.sh --list-output-dirs` exits non-zero or produces empty output
When  `bash scripts/check-core-paths.sh` is run
Then  it exits 2 with an explicit failure message
```

## Out of scope

- Re-building components or altering how components are transformed during a normal `build-components.sh` run.
- Non-component build scripts or extension build scripts (`build-claude-plugin.sh`, `build-copilot-plugin.sh`, etc.).

## Open questions

- None.
