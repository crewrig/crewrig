// merge-spec-pr.ts — logic of scripts/merge-spec-pr.ts, the exclusive merge
// mechanism for spec-PRs (spec 0262). Mirrors scripts/merge-spec-pr.ts byte for byte.
//
// Standard library only, plus git and `gh` as the only spawned tools.
//
// Usage: runMergeSpecPr(args) — `args` are passed through to `gh pr merge --squash`.
// Exit codes: 1 on a draft spec or a draft PR; otherwise the exit status of git or `gh`.
// Finding-line format: not applicable.

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { runGit } from "./git-run.ts";
import { fatal, ok } from "./report.ts";

/** Hand over to `gh pr merge --squash`, inheriting stdio; returns its exit status. */
function delegate(args: readonly string[]): number {
  const res = spawnSync("gh", ["pr", "merge", "--squash", ...args], {
    stdio: "inherit",
    shell: false,
  });
  if (res.error !== undefined) {
    fatal(`merge-spec-pr: gh: ${res.error.message}`);
    return 127;
  }
  return res.status ?? 1;
}

/**
 * True only when `gh pr view` reports the PR as a draft (output exactly `true`).
 * Fail-open: any `gh` failure or other output returns false and the merge goes on,
 * since GitHub itself still refuses to merge a draft (spec 0168 delta-01 R15 is a
 * clearer message, not a safety measure). The PR is `args[0]` when it is not a flag,
 * else the current branch's PR. `--repo`/`-R <repo>` (or `--repo=<repo>`) is forwarded;
 * other merge flags are not, and a PR given by flag-first argv is looked up by branch.
 */
function prIsDraft(args: readonly string[]): boolean {
  const view = ["pr", "view"];
  if (args[0] !== undefined && !args[0].startsWith("-")) view.push(args[0]);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if ((a === "--repo" || a === "-R") && args[i + 1] !== undefined) {
      view.push("--repo", args[i + 1] as string);
    } else if (a.startsWith("--repo=")) {
      view.push(a);
    }
  }
  const res = spawnSync("gh", [...view, "--json", "isDraft", "--jq", ".isDraft"], {
    stdio: ["ignore", "pipe", "ignore"],
    shell: false,
  });
  if (res.error !== undefined || res.status !== 0) return false;
  return res.stdout.toString("utf8").trim() === "true";
}

/** Map `spec/<slug>` to the spec file stem: `-delta-N` becomes `.delta-N`. */
export function specSlug(branch: string): string {
  return branch.slice("spec/".length).replace(/-delta-([0-9]+)$/, ".delta-$1");
}

/** The frontmatter `status:` value (awk `$2` of the first `status:` line), or "". */
export function frontmatterStatus(text: string): string {
  let fences = 0;
  for (const line of text.split("\n")) {
    if (line === "---") fences += 1;
    if (fences === 1 && line.startsWith("status:")) {
      return line.split(/[ \t]+/).filter((f) => f !== "")[1] ?? "";
    }
  }
  return "";
}

/** Run the whole entry; returns the process exit status. */
export function runMergeSpecPr(args: readonly string[]): number {
  const top = runGit(["rev-parse", "--show-toplevel"], { cwd: process.cwd() });
  if (top.status !== 0) {
    process.stderr.write(top.stderr);
    return top.status;
  }
  const root = top.stdout.toString("utf8").replace(/\n$/, "");
  process.chdir(root);

  const cur = runGit(["branch", "--show-current"], { cwd: root });
  const branch = cur.stdout.toString("utf8").replace(/\n$/, "");

  if (!branch.startsWith("spec/")) {
    ok("  Not on a spec/ branch. Delegating to gh pr merge.");
    return delegate(args);
  }

  const specFile = path.posix.join("specs", `${specSlug(branch)}.md`);
  let isFile = false;
  try {
    isFile = statSync(specFile).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    ok(
      `  WARNING: Spec file ${specFile} not found on branch ${branch}. Delegating to gh pr merge.`,
    );
    return delegate(args);
  }

  const status = frontmatterStatus(readFileSync(specFile, "latin1"));
  if (status === "draft") {
    fatal(`ERROR: Spec file ${specFile} has 'status: draft' in its frontmatter.`);
    fatal("       A draft spec cannot be merged. Please approve it first.");
    return 1;
  }

  if (prIsDraft(args)) {
    fatal("ERROR: This pull request is still a draft.");
    fatal("       Mark it ready first: `gh pr ready` (GitLab: `glab mr update --ready`),");
    fatal("       wait for the post-ready CI run, then merge.");
    return 1;
  }

  ok(`  Spec file ${specFile} is not draft. Delegating to gh pr merge.`);
  return delegate(args);
}
