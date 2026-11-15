// ci-pr-scope.ts — classifies a pull request as spec-only (spec 0287 delta-02 R22).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/ci-pr-scope.ts
// Reads GITHUB_EVENT_NAME and appends `spec-only=<true|false>` to $GITHUB_OUTPUT as its last act.
// Any event other than `pull_request` writes `false` before git is called or the cap applies. For a
// pull request it lists the paths of the merge commit with `git diff --no-renames --name-only -z
// HEAD^1 HEAD` (a rename is a delete of the old path plus an add of the new one, so both count).
// Exit: 0 written; 1 a git error or 3,000 or more entries, with nothing written.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** The first entry count the classifier refuses to classify: it cannot know the list is complete. */
export const CAP = 3000;

/** "true" only for a pull request of 1 to CAP-1 paths that all start with `specs/`. */
export function classify(event: string, paths: string[]): "true" | "false" {
  if (event !== "pull_request") return "false";
  if (paths.length >= CAP)
    throw new Error(`the pull request lists ${paths.length} paths, the cap is ${CAP - 1}`);
  if (paths.length === 0) return "false";
  return paths.every((p) => p.startsWith("specs/")) ? "true" : "false";
}

function main(): void {
  const event = process.env["GITHUB_EVENT_NAME"] ?? "";
  const out = process.env["GITHUB_OUTPUT"];
  if (out === undefined || out === "") throw new Error("GITHUB_OUTPUT is not set");
  let value: "true" | "false" = "false";
  if (event === "pull_request") {
    let raw: string;
    try {
      raw = execFileSync("git", ["diff", "--no-renames", "--name-only", "-z", "HEAD^1", "HEAD"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      throw new Error(`git diff failed: ${(e as Error).message}`);
    }
    value = classify(
      event,
      raw.split("\0").filter((p) => p !== ""),
    );
  }
  fs.appendFileSync(out, `spec-only=${value}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`ci-pr-scope: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
}
