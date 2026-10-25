// workflow-union.ts — read the jobs of every GitHub workflow file as one set (spec 0287 R8, R12).
// After the staged split `build.yml` is a caller and the job bodies live in `_ci-*.yml`; readers
// that need a job body read the union of `.github/workflows/*.yml`.
import fs from "node:fs";
import path from "node:path";

import { yamlLib } from "./yaml-lib.ts";

const { dump, load } = yamlLib;

const WORKFLOWS = path.join(".github", "workflows");

/** The workflow files (`*.yml`) under `root`, sorted by name. */
export function workflowFiles(root = "."): string[] {
  const dir = path.join(root, WORKFLOWS);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** The raw text of every workflow file, concatenated (for readers that match a job block by regex). */
export function readWorkflowUnionText(root = "."): string {
  return workflowFiles(root)
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
}

/** The merged `jobs` mapping of every workflow file; a duplicate job key throws. */
export function readWorkflowUnion(root = "."): Record<string, Record<string, unknown>> {
  const merged: Record<string, Record<string, unknown>> = {};
  for (const file of workflowFiles(root)) {
    const doc = load(fs.readFileSync(file, "utf8")) as {
      jobs?: Record<string, Record<string, unknown>>;
    } | null;
    for (const [key, job] of Object.entries(doc?.jobs ?? {})) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`duplicate job key '${key}' (second definition in ${file})`);
      }
      merged[key] = job;
    }
  }
  return merged;
}

/** The merged `jobs` mapping serialised as one YAML document (`jobs:` only). */
export function readWorkflowUnionYaml(root = "."): string {
  return dump({ jobs: readWorkflowUnion(root) }, { lineWidth: -1 });
}
