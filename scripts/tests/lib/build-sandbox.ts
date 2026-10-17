// build-sandbox.ts — shared helpers of the build/check suites of spec 0265 (annex P1).
// Everything is written into a tree made by `createFixtureTree` (mkdtemp); nothing here
// deletes, moves or rewrites a path it did not create. The fixture tree, the source
// builders and the real `js-yaml` are REUSED, not duplicated.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { agent, skill } from "../fixtures/build-components/entry-kit.ts";
import { REPO, type FixtureTree } from "./build-fixture-tree.ts";
import { trackedFiles } from "./mutation-copy.ts";
import { yamlLib } from "./yaml-lib.ts";

/** Child environment of a build run: `CI` removed, `LC_ALL=C`; pass as `run(args, { env: baseEnv() })`. */
export function baseEnv(): Record<string, string | undefined> {
  return { CI: undefined, NODE_TEST_CONTEXT: undefined, LC_ALL: "C" };
}

/** Copy the working-tree content of the tracked files under `pathspecs` of the checkout into `tree`. */
export function copyFromWorktree(
  tree: FixtureTree,
  pathspecs: readonly string[],
  repo: string = REPO,
): string[] {
  const files = trackedFiles(repo, pathspecs);
  for (const rel of files) tree.write(rel, fs.readFileSync(`${repo}/${rel}`));
  return files;
}

/** Copy the git blobs of `HEAD` under `pathspecs` into `tree` (one `cat-file --batch`, no tar). */
export function copyFromHead(
  tree: FixtureTree,
  pathspecs: readonly string[],
  repo: string = REPO,
): string[] {
  const git = (args: string[], input?: string): Buffer => {
    const r = spawnSync("git", args, { cwd: repo, input, maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr)}`);
    return r.stdout;
  };
  const entries = git(["ls-tree", "-r", "-z", "HEAD", "--", ...pathspecs])
    .toString("utf8")
    .split("\0")
    .filter((e) => e !== "")
    .map((e) => ({ oid: e.split(/[ \t]/)[2] ?? "", rel: e.slice(e.indexOf("\t") + 1) }));
  const out = git(["cat-file", "--batch"], entries.map((e) => `${e.oid}\n`).join(""));
  let at = 0;
  for (const { oid, rel } of entries) {
    const eol = out.indexOf(10, at);
    const [id, type, size] = out.subarray(at, eol).toString("utf8").split(" ");
    if (id !== oid || type !== "blob") throw new Error(`unexpected cat-file header for ${rel}`);
    const start = eol + 1;
    tree.write(rel, out.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return entries.map((e) => e.rel);
}

/** Split at the first two lines that are exactly `---`: the text between them and the rest. */
export function fenceSplit(text: string): { front: string; body: string } | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const open = lines.indexOf("---");
  const close = open < 0 ? -1 : lines.indexOf("---", open + 1);
  if (close < 0) return null;
  return {
    front: lines.slice(open + 1, close).join("\n"),
    body: lines.slice(close + 1).join("\n"),
  };
}

/** The frontmatter mapping of `text` (real `js-yaml`); throws when there is no fenced block. */
export function readFrontmatter(text: string): Record<string, unknown> {
  const split = fenceSplit(text);
  if (split === null) throw new Error("no frontmatter fence in the text");
  const doc = yamlLib.load(split.front);
  if (typeof doc !== "object" || doc === null) throw new Error("frontmatter is not a mapping");
  return Object.fromEntries(Object.entries(doc));
}

/** Seed `artifacts/<tier>/skills/<name>/SKILL.md`. */
export function seedSkill(tree: FixtureTree, tier: string, name: string): string {
  return tree.artifact(`${tier}/skills/${name}/SKILL.md`, skill(name));
}

/** Seed `artifacts/<tier>/agents/<name>/AGENT.md`. */
export function seedAgent(tree: FixtureTree, tier: string, name: string): string {
  return tree.artifact(`${tier}/agents/${name}/AGENT.md`, agent(name));
}
