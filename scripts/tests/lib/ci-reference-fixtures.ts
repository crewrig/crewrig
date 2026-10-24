// ci-reference-fixtures.ts — reference texts and the build-ci runner shared by the
// build-ci replacement suites (spec 0265, row J2, P8). Group S roots hold two files:
// `ci/ci-capabilities.yml` and the generated `.gitlab-ci.yml`; the entry runs from the checkout
// with REPO_DIR pinned, so no tracked file is copied.

import fs from "node:fs";
import path from "node:path";
import { yamlLib } from "./yaml-lib.ts";
import { makeSandbox, REPO, runEntry, type RunResult } from "./governance-sandbox.ts";

export { makeSandbox, REPO, type RunResult };

const TRIGGER_PUSH = "    trigger:\n      - on: push\n        branches: [main]\n";

/** One portable capability with `build` as id; `requires` is a YAML fragment (indented). */
export function oneCapability(requires: string, command: string, id = "build"): string {
  return (
    `capabilities:\n  - id: ${id}\n    name: "Build"\n${TRIGGER_PUSH}` +
    `    portability: portable\n${requires}    command:\n      - ${command}\n`
  );
}

export const NODE22 = "    requires:\n      runtime: node@22\n";
export const VALID_REFERENCE = oneCapability(NODE22, "npm install");
export const UNKNOWN_TOOL_REFERENCE = oneCapability(
  "    requires:\n      tools: [nonexistent-tool]\n",
  "nonexistent-tool --run",
);
export const UNKNOWN_RUNTIME_REFERENCE = oneCapability(
  "    requires:\n      runtime: cobol@85\n",
  "cobc -x main.cob",
);
export const SPECIFIC_REFERENCE =
  `${VALID_REFERENCE}  - id: pages-deploy\n    name: "Deploy to GitHub Pages"\n${TRIGGER_PUSH}` +
  `    portability: specific\n    exception:\n      engine: github-actions\n` +
  `      evidence: "GitHub Pages has no faithful GitLab equivalent."\n`;
export const ENV_REFERENCE =
  `capabilities:\n  - id: lint-specs\n    name: "Lint specs"\n    trigger:\n` +
  `      - on: pull-request\n        branches: [main]\n    portability: portable\n` +
  `    env:\n      BASE_REF: "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"\n    command:\n` +
  `      - task spec:lint\n`;
export const MANUAL_REFERENCE =
  `capabilities:\n  - id: manual-job\n    name: "Manual Job"\n    trigger:\n      - on: manual\n` +
  `    portability: portable\n    command:\n      - echo "manual"\n` +
  `  - id: manual-with-branch\n    name: "Manual Job with Branch"\n    trigger:\n` +
  `      - on: manual\n        branches: [main]\n    portability: portable\n    command:\n` +
  `      - echo "manual branch"\n`;

/** A fresh root holding `ci/ci-capabilities.yml` = `reference`. */
export function newRoot(reference: string): string {
  const root = makeSandbox("build-ci-");
  fs.mkdirSync(path.join(root, "ci"), { recursive: true });
  fs.writeFileSync(path.join(root, "ci", "ci-capabilities.yml"), reference);
  // build-ci reads the Task pin at generation (spec 0282); a root without one fails closed.
  fs.copyFileSync(path.join(REPO, "ci", "task-pin.json"), path.join(root, "ci", "task-pin.json"));
  return root;
}

/** Run `scripts/build-ci.ts` of the checkout against `root` (REPO_DIR). */
export function runBuildCi(root: string, args: readonly string[] = []): RunResult {
  return runEntry(path.join(REPO, "scripts", "build-ci.ts"), {
    args,
    env: { REPO_DIR: root },
  });
}

/** Top-level keys of a generated pipeline, via the real js-yaml. */
export function topLevelKeys(pipelineText: string): string[] {
  const doc = yamlLib.load(pipelineText);
  return typeof doc === "object" && doc !== null ? Object.keys(doc) : [];
}

/** The raw text of one top-level job (from `<id>:` to the next top-level key). */
export function jobText(pipelineText: string, id: string): string {
  const lines = pipelineText.split("\n");
  const start = lines.indexOf(`${id}:`);
  if (start < 0) throw new Error(`job ${id} not found`);
  let end = start + 1;
  while (end < lines.length && (lines[end] === "" || /^[\s#]/.test(lines[end]!))) end += 1;
  return lines.slice(start, end).join("\n");
}
