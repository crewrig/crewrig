// release-docs-checks.ts — the (f) and (g) invariants of scripts/tests/test-monorepo-release.sh, as
// functions of a repository root, so the test can run them on the real tree and on mutated copies.
// The workflow pins are anchored per-line regular expressions, not a YAML parse: the Bash suite pins
// the text on purpose, and a parse would still pass after a comment or a reformat. Line endings are
// normalised (`\r?\n`).

import fs from "node:fs";
import path from "node:path";

import { readWorkflowUnionText } from "./workflow-union.ts";

export const GITLAB_DOC = "docs/gitlab-release-publishing.md";
export const RELEASE_WORKFLOW = ".github/workflows/release-monorepo.yml";
export const BUILD_WORKFLOW = ".github/workflows/build.yml";

const lines = (root: string, rel: string): string[] =>
  fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);

/** Lines of `extensions install` inside a fenced block (a fence is a line starting with three backticks). */
export function installLinesInFences(root: string): number {
  let inFence = false;
  let count = 0;
  for (const line of lines(root, GITLAB_DOC)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line.includes("extensions install")) count += 1;
  }
  return count;
}

/** True when the doc mentions `extensions install` without any `unmeasured` hedge. */
export function installMentionUnhedged(root: string): boolean {
  const all = lines(root, GITLAB_DOC);
  return (
    all.some((l) => l.includes("extensions install")) && !all.some((l) => l.includes("unmeasured"))
  );
}

const hasLine = (all: string[], re: RegExp): boolean => all.some((l) => re.test(l));

/** (g)-1: the release workflow may dispatch the checks and never cancels a running release. */
export function releaseWorkflowPinned(root: string): boolean {
  const all = lines(root, RELEASE_WORKFLOW);
  return hasLine(all, /^ {2}actions: write$/) && hasLine(all, /^ {2}cancel-in-progress: false$/);
}

/** (g)-2: build.yml is dispatchable and the workflows define the `ratchet` and `lint-typescript` jobs. */
export function buildWorkflowPinned(root: string): boolean {
  const all = readWorkflowUnionText(root).split(/\r?\n/);
  return (
    hasLine(all, /^ {2}workflow_dispatch:/) &&
    hasLine(all, /^ {2}ratchet:$/) &&
    hasLine(all, /^ {2}lint-typescript:$/)
  );
}
