// gate.ts — the runtime path gate decision (spec 0283 R6). Pure core plus a git-backed diff.
//
// Usage: decide(input) -> {changed, notice?}. Exit codes: not applicable (see ci-paths-gate.ts).

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { globToRegExp } from "../glob-engine.ts";

const run = promisify(execFile);

export interface Decision {
  changed: boolean;
  /** Fail-open reason; the entry prints it as a `::notice title=ci-paths-gate::` line. */
  failOpen?: string;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const ZERO = /^0+$/;

/** The changed files of the event, or a fail-open reason. */
export async function changedFiles(
  event: string,
  before: string,
  gitFn: (a: string[]) => Promise<string> = git,
): Promise<{ files: string[] } | { reason: string }> {
  const lines = (s: string): string[] => s.split("\n").filter((l) => l !== "");
  try {
    if (event === "pull_request") {
      return { files: lines(await gitFn(["diff", "--name-only", "HEAD^1", "HEAD"])) };
    }
    if (before === "" || ZERO.test(before)) return { reason: "no base commit" };
    let parent = "";
    try {
      parent = (await gitFn(["rev-parse", "HEAD^1"])).trim();
    } catch {
      parent = "";
    }
    if (parent !== before) {
      let have = true;
      try {
        await gitFn(["cat-file", "-e", `${before}^{commit}`]);
      } catch {
        have = false;
      }
      if (!have) {
        try {
          await gitFn(["fetch", "--depth=1", "origin", before]);
        } catch {
          return { reason: `base ${before.slice(0, 12)} not fetchable` };
        }
      }
    }
    return { files: lines(await gitFn(["diff", "--name-only", before, "HEAD"])) };
  } catch (e) {
    return { reason: `diff failed: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** `changed` for an event given the effective globs; UnsupportedGlobError propagates. */
export async function decide(
  id: string,
  event: string,
  before: string,
  globsByKind: Record<string, string[]>,
  gitFn?: (a: string[]) => Promise<string>,
): Promise<Decision> {
  void id;
  const kind = event === "pull_request" ? "pull-request" : event === "push" ? "push" : "";
  if (kind === "") return { changed: true };
  const globs = globsByKind[kind] ?? [];
  if (globs.length === 0) return { changed: true };
  const res = globs.map((g) => globToRegExp(g));
  const got = await changedFiles(event, before, gitFn);
  if ("reason" in got) return { changed: true, failOpen: got.reason };
  return { changed: got.files.some((f) => res.some((r) => r.test(f))) };
}
