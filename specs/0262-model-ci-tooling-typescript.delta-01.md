---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.1.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 01 of `specs/0262-model-ci-tooling-typescript.md`. Source: the scalar-style spike of
PR 4 of the plan of ticket #1339, run against real `yq` v4.44.3 in an Ubuntu 24.04 container,
which is the decision gate that PLAN v4 attached to the `yq` reader (stop rule of finding
v2-F1 of seat `plan/1339`). It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 and adds one requirement (31) to
the reader of requirement 5. The version is a MINOR bump: one case is added to a closed list,
no requirement is relaxed otherwise. This delta opens no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

31. **Reader parity classes.** The shared reader of requirement 5 SHALL reproduce, byte for
     byte against `yq` v4.44.3 on the corpus of the spike (twenty-five classes, kept as goldens
     generated in a container and regenerated in a second image; the three classes that
     requirement 24 (d) and (f) excludes, namely multi-document input and the two explicit-tag
     classes, are not compared with `yq`: a test asserts the `Error:` line and exit 1 of the
     entry directly), the following behaviours of
     the accessors the scripts use: the plain-versus-quoted distinction of scalars (`false` and
     `"false"`, `~` and `"~"`), number and date token text (`0x1F`, `1e3`, `1_000`, `0b1`),
     empty values (rendered as an empty line by `yq -r`, absent keys as `null`), `tag`,
     `length` in bytes, the `// ""` default, `keys` in DOCUMENT order (including integer-like
     keys, with hexadecimal and octal integer keys printed in decimal), duplicate keys (both
     kept, `keys` repeats the name, a lookup returns the last), anchors and aliases (an alias
     is not resolved by `yq -r`: it prints `*name` and has an empty tag and length 0), and the
     merge key `<<` (an ordinary key whose value is an alias). A scalar or empty document root
     makes `keys` fail with a non-zero status, as `yq` does.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec is replaced by: (a) Ordering
    follows requirement 3. (b) On Windows, printed paths use forward slashes. (c) Where the
    shell fails through its own runtime and not through a message of the script (an unreadable
    input, a Bash arithmetic or `[` diagnostic that carries a script path and line number, a
    `yq` abort such as `Error: cannot index array with 'item'`), the entry SHALL print one
    `Error: <path>: <reason>` line on standard error and exit 1; such inputs are excluded from
    the byte comparison and compared on exit status only. (d) `check-model-mappings` SHALL
    reject multi-document YAML input deliberately with a stable `Error:` line and exit 1 (the
    shell rejects it with unstable text). (e) An offering id that starts with `-` is treated
    literally by `check-model-mappings` (the shell makes `grep -qxF` print its usage text and
    accepts the id with exit 0): the entry accepts the id and prints no usage text. (f) A YAML
    input that carries an explicit tag that the failsafe schema of the reader does not know
    (`!custom x`, `!!int 5`), which `yq` accepts and `js-yaml` rejects with an unknown-tag
    error (the tags `!!str`, `!!map` and `!!seq` load and are supported): the entry SHALL print one
    `Error: <path>: <reason>` line on standard error and exit 1, and such inputs are excluded
    from the comparison with `yq` (a test asserts the `Error:` line and exit 1 of the entry
    directly, since `yq` itself exits 0 on them); no YAML file tracked in this
    repository carries an explicit tag, and a test SHALL assert that on the tracked files read
    by the scripts of this row (`ci/ci-capabilities.yml`, `.github/workflows/*.yml`,
    `.gitlab-ci.yml`, `model-mappings/*.yml`, the front matter of the agent and skill
    sources). No other deviation is permitted.

**Scenario:** A tag in a fixture

Given a Bash-suite fixture whose YAML carries an explicit tag
When  the entry reads it
Then  it prints one `Error:` line on standard error and exits 1, and a test asserts exactly
      that, without comparing the input with `yq`.

**Scenario:** The tracked files carry no tag

Given the tracked YAML files read by the scripts of this row
When  the tag-absence test runs
Then  it finds no explicit tag.

## REMOVED

None.
