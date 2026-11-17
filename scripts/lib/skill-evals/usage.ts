// usage.ts — the usage declaration of a run (spec 0290 R23 as modified).
//
// Before any model call the runner declares its usage through the existing usage subsystem:
//   node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>
// `<number>` is the ticket number: `--ticket`, else the number of the branch name
// `<prefix>/<NNNN>-<slug>`. No new asset kind is introduced (docs/usage-record-format.md).
//
// Usage: resolveTicket(...), repoSlug(...), declareUsage(...). Exit codes: not applicable (library).
// Finding-line format: not applicable.

import { spawnSync } from "node:child_process";
import path from "node:path";

import { runGit } from "../governance/git-run.ts";

export function ticketFromBranch(branch: string): string | undefined {
  const m = /^[^/]+\/0*(\d+)-/.exec(branch);
  return m?.[1];
}

export function currentBranch(repoRoot: string): string {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot })
    .stdout.toString("utf8")
    .trim();
}

/** `owner/repo` of the `origin` remote (https or ssh GitHub-style URL); undefined when unparseable. */
export function repoSlug(repoRoot: string): string | undefined {
  const url = runGit(["remote", "get-url", "origin"], { cwd: repoRoot })
    .stdout.toString("utf8")
    .trim();
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m?.[1];
}

export interface UsageDeclaration {
  readonly asset: string;
}

export function resolveAsset(
  repoRoot: string,
  ticket: string | undefined,
): { asset: string } | { error: string } {
  const n = ticket ?? ticketFromBranch(currentBranch(repoRoot));
  if (n === undefined || !/^\d+$/.test(n))
    return {
      error:
        "cannot attribute the spend to a ticket: pass --ticket <number> or work on a branch named <prefix>/<NNNN>-<slug>",
    };
  const slug = repoSlug(repoRoot);
  if (slug === undefined) return { error: "cannot derive <owner>/<repo> from the origin remote" };
  return { asset: `forge-issue:${slug}#${n}` };
}

export function declareUsage(
  repoRoot: string,
  asset: string,
): { ok: true } | { ok: false; error: string } {
  const r = spawnSync(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "usage-task.ts"),
      "set",
      "--channel",
      "explicit",
      "--asset",
      asset,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (r.status === 0) return { ok: true };
  return {
    ok: false,
    error: `usage declaration failed (exit ${r.status}): ${(r.stderr || r.stdout || "").trim()}`,
  };
}
