// gitlab-arm.ts — Arm 2 (R5): compose `build-ci --check` (the TypeScript twin, spawned on
// process.execPath), then the GitLab cache-key agreement (spec 0147 R6/R7).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { get, isYqFalsy, parse, render, tag, YqSeq, type YqNode } from "../yq-accessors/index.ts";
import { sortLines } from "./gha-arm.ts";
import { fail } from "./findings.ts";
import { ShellAbort, type ParityState } from "./state.ts";

const BUILD_CI = path.resolve(import.meta.dirname, "..", "..", "build-ci.ts");

function composeBuildCheck(state: ParityState): void {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", BUILD_CI, "--check"],
    {
      encoding: "utf8",
      env: { ...process.env, REPO_DIR: state.repoDir },
    },
  );
  if (r.status === 0) return;
  fail(state, "reference↔GitLab divergence (gitlab) — composed 'build-ci.sh --check' failed (R5):");
  const out = `${r.stdout}${r.stderr}`.replace(/\n+$/, "");
  for (const ln of out.split("\n")) state.stderr += `    ${ln}\n`;
}

/** `.<id>.cache.key.files[]` of the GitLab file, or null when a sequence on the path aborts yq. */
function gitlabFiles(doc: YqNode, id: string): string[] | null {
  try {
    let n: YqNode = doc;
    for (const k of [id, "cache", "key"]) {
      if (n instanceof YqSeq) return null;
      n = get(n, [k]);
    }
    if (n instanceof YqSeq) return null;
    const files = get(n, ["files"]);
    if (isYqFalsy(files) && tag(files) === "!!null") return [];
    return files instanceof YqSeq ? files.items.map((f) => render(f)) : [];
  } catch {
    return null;
  }
}

function checkCache(state: ParityState): void {
  const cached = state.caps.filter(
    (c) => c.cacheTag !== "" && c.cacheTag !== "!!null" && c.id !== "",
  );
  if (cached.length === 0) return;
  let doc: YqNode = null;
  let unreadable = false;
  try {
    doc = parse(fs.readFileSync(state.gitlabCi, "utf8"));
  } catch {
    unreadable = true;
  }
  for (const c of cached) {
    // A sequence on the path, or an unparseable file, ends the script silently with yq's status.
    const files = unreadable ? null : gitlabFiles(doc, c.id);
    if (files === null) throw new ShellAbort(1);
    if (sortLines(c.cacheFiles) !== sortLines(files))
      fail(
        state,
        `capability '${c.id}' (gitlab): cache key inputs diverge from the reference cache.files (R6)`,
      );
  }
}

export function arm2(state: ParityState): void {
  if (!state.gitlabPresent) return;
  composeBuildCheck(state);
  checkCache(state);
}
