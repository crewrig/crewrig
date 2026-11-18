// guard-main.ts — command line of scripts/framework-release-guard.ts (spec 0310 R12).

import path from "node:path";

import { parseFlags, required, UsageError } from "./cli.ts";
import type { Io } from "./cli.ts";
import { prereleaseGuards, stableGuards } from "./guards.ts";
import type { Check } from "./guards.ts";

export const RELEASE_BRANCH = "release/1822-distribution";

const OPTIONS = {
  kind: { type: "string" },
  tag: { type: "string" },
  version: { type: "string" },
  ref: { type: "string" },
  commit: { type: "string" },
  repo: { type: "string" },
  "releases-json": { type: "string" },
  "release-branch": { type: "string" },
  "main-branch": { type: "string" },
} as const;

function report(checks: readonly Check[], io: Io): number {
  for (const check of checks)
    io.out(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    io.err(`Error: guard failed: ${failed.map((c) => c.name).join(", ")}; nothing was published`);
    return 1;
  }
  return 0;
}

export function main(argv: readonly string[], io: Io): number {
  try {
    const flags = parseFlags(argv, OPTIONS);
    const common = {
      repo: path.resolve(typeof flags["repo"] === "string" ? flags["repo"] : process.cwd()),
      commit: typeof flags["commit"] === "string" ? flags["commit"] : "HEAD",
      releaseBranch:
        typeof flags["release-branch"] === "string" ? flags["release-branch"] : RELEASE_BRANCH,
      mainBranch: typeof flags["main-branch"] === "string" ? flags["main-branch"] : "main",
    };
    const kind = required(flags, "kind");
    if (kind === "prerelease") return report(prereleaseGuards(required(flags, "tag"), common), io);
    if (kind === "stable") {
      return report(
        stableGuards({
          ...common,
          version: required(flags, "version"),
          ref: required(flags, "ref"),
          releasesJson: required(flags, "releases-json"),
        }),
        io,
      );
    }
    throw new UsageError("--kind must be prerelease or stable");
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof UsageError ? 2 : 1;
  }
}
