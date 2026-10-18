// spec-id-constants.ts — constants and the spec renderer of spec-id-fixture.ts (split for size).

export const SKIP: string | false =
  process.platform === "win32"
    ? "POSIX-only: local bare remotes, path-style URLs and an sh-merged 2>&1 log; the Windows proof of the entry is windows-model-ci-tooling-spec-id.test.ts"
    : false;

/** Git empty tree: the tree of every reservation object. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const REFERENCE_REPO = "crewrig/crewrig";
/** The mark scripts/reserve-spec-id emits on its exit-3 path. */
export const UNSECURED_MARK = "unsecured-id: true";

/**
 * Every variable the check consults for origin or base, cleared before each run (exactly these
 * ten, so the list documents no contract that does not exist). `CREWRIG_SPEC_ID_ORIGIN` is
 * honoured outside CI and the three CI markers select the branch of the origin ladder, so an
 * ambient value would make a laptop exercise a different path than a runner.
 */
export const CLEARED_VARS: readonly string[] = [
  "BASE_REF",
  "CREWRIG_PR_HEAD_REPO",
  "CREWRIG_PR_BASE_REPO",
  "CI_MERGE_REQUEST_SOURCE_PROJECT_PATH",
  "CI_PROJECT_PATH",
  "CI_MERGE_REQUEST_TARGET_BRANCH_NAME",
  "CREWRIG_SPEC_ID_ORIGIN",
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
];

export function renderSpec(id: string, slug: string, issue: string, extra = ""): string {
  const tail = extra === "" ? "" : `\n${extra}`;
  return `---
id: "${id}"
slug: "${slug}"
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: ${issue}
version: 1.0.0${tail}
---

# Title

## Intent

## Requirements

## Scenarios

## Out of scope

## Open questions
`;
}
