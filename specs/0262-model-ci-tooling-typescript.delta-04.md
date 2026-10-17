---
id: "0262"
slug: model-ci-tooling-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.4.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 04 of `specs/0262-model-ci-tooling-typescript.md`. Source: the first pull request of
the row (#1657) pinned every general `yq` installer to `v4.44.3`, which broke the
yq-versus-reader suites of the `build-components-ts` job (`build-components-conformance-org`,
`model-resolve-roundtrip`): they were built against a newer `yq` and fail on `v4.44.3`, as
reproduced in an Ubuntu 24.04 container (42 of 42 pass on `v4.54.1`). Those jobs are path
filtered, so the failure did not show on the pull requests that introduced the pin. It runs
under the release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`.
This delta modifies requirement 19: the general `yq` version, and one new rule (an oracle
suite names the `yq` version it was built against; a change of the general version is proved
against those suites in a container; the headers of `build-components-conformance-org.test.ts`
and `model-resolve-roundtrip.test.ts` SHALL record `v4.54.1` in the next pull request of the
row that touches them). It is numbered 04 on top of delta 03
(`1.3.0`, PR #1674), which SHALL merge first. The version is a MINOR bump. This delta opens no
question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** The yq oracles run on the version they were built against

Given the `build-components-ts` job
When  it installs `yq`
Then  it installs `v4.54.1` verified against its published checksum, and the
      yq-versus-reader suites pass.

**Scenario:** The skill-scripts oracle keeps its own version

Given the `skill-scripts-ts` job of row H or the `model-ci-tooling-ts` job of this row
When  it installs `yq`
Then  it installs `v4.44.3`, the version its goldens were made with.

## MODIFIED

19. **`yq` and `jq` pin of the GitLab generator and of the workflows (decision of this spec).**
    Requirement 19 of the base spec is replaced by: the generator SHALL pin both tools in
    `tool_install_lines` of `scripts/build-ci.sh`, and the workflows SHALL install them from
    versioned URLs verified against a checksum:
    - `yq` (general installers: the generator and every workflow step that installed `yq`
      from `latest`): Go `mikefarah/yq` `v4.54.1`, verified with `sha256sum -c` against the
      published checksum of the `linux_amd64` asset
      (`8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f`);
    - `yq` (the steps named "Install yq v4.44.3", which serve the `skill-scripts-ts` oracle
      of row H, the end-to-end harness job and the `model-ci-tooling-ts` oracle of this row):
      `v4.44.3`, unchanged, because the goldens of those suites were made with it;
    - `jq`: `1.7.1`, as in the base requirement.
    A suite that uses `yq` as an oracle SHALL name the version it was built against in its
    header, and a change of the general version SHALL be proved against those suites in an
    Ubuntu 24.04 container before the pull request opens (their jobs are path filtered).
    The rejected alternatives are recorded on #1339: `latest` (drifts with the upstream
    release) and a single version `v4.44.3` for every job (breaks the oracles above).

## REMOVED

None.
