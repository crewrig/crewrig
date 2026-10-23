// hooks.ts — pushed-ref parsing (spec 0279 R11) and hook enablement (R15).
//
// Usage: imported by scripts/ci-pre-push.ts. Imports `node:` modules only, so `hooks install`
//   works in a checkout that has no node_modules.
// Exit: functions return data; runHooksCommand returns { code, out, err } (0 ok, 1 refusal).
// Finding format: notices are one-line strings, prefixed by the caller.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const HOOKS_PATH = ".githooks";

const ZERO_SHA = /^0+$/;

export interface PushPlan {
  /** Commits to check (deduplicated); every one equals the checked-out HEAD. */
  shas: string[];
  notices: string[];
}

/**
 * Parse the git pre-push stdin lines (`<local ref> <local sha> <remote ref> <remote sha>`).
 * `input` undefined or blank behaves as a push of HEAD (a manual `task ci:pre-push`).
 * Deletes and tag refs are skipped, other refs not at HEAD are reported, never failed.
 */
export function parsePushRefs(input: string | undefined, head: string): PushPlan {
  const notices: string[] = [];
  if (input === undefined || input.trim() === "") return { shas: [head], notices };
  const shas = new Set<string>();
  const headLc = head.toLowerCase();
  for (const line of input.split("\n")) {
    if (line.trim() === "") continue;
    const f = line.trim().split(/\s+/);
    if (f.length !== 4)
      throw new Error(`malformed pre-push line (expected 4 fields): ${JSON.stringify(line)}`);
    const [localRef = "", localSha = "", remoteRef = ""] = f;
    if (ZERO_SHA.test(localSha)) {
      notices.push(`skipped delete of ${remoteRef}`);
      continue;
    }
    if (localRef.startsWith("refs/tags/") || remoteRef.startsWith("refs/tags/")) {
      notices.push(`skipped tag ${remoteRef}`);
      continue;
    }
    if (localSha.toLowerCase() !== headLc) {
      notices.push(`not checked: ${localRef} is not the checked-out commit`);
      continue;
    }
    shas.add(head);
  }
  return { shas: [...shas], notices };
}

function git(repoDir: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** A notice when the working tree has uncommitted changes (the checks see them), else null. */
export function dirtyNotice(repoDir: string): string | null {
  const s = git(repoDir, ["status", "--porcelain"]);
  return s !== null && s !== ""
    ? "the working tree is dirty: the checks see uncommitted changes"
    : null;
}

export interface HooksResult {
  code: number;
  out: string;
  err: string;
}

const ok = (out: string): HooksResult => ({ code: 0, out, err: "" });
const refuse = (err: string): HooksResult => ({ code: 1, out: "", err });

/** `hooks install|uninstall|status`: writes only the local config of this repository (R15). */
export function runHooksCommand(
  sub: string | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): HooksResult {
  if (sub !== "install" && sub !== "uninstall" && sub !== "status")
    return refuse("usage: ci-pre-push hooks install|uninstall|status");
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top === null || top === "") return refuse("not inside a git repository: nothing was changed");
  const crewrig =
    existsSync(path.join(top, HOOKS_PATH, "pre-push")) &&
    existsSync(path.join(top, "taskfiles", "ci.yml"));
  if (!crewrig)
    return refuse(
      `${top} is not a CrewRig checkout (.githooks/pre-push and taskfiles/ci.yml are required): nothing was changed`,
    );
  const cur = git(top, ["config", "--local", "--get", "core.hooksPath"]);
  const value = cur === null || cur === "" ? null : cur;
  if (sub === "status")
    return ok(
      value === null ? "core.hooksPath is not set (hook disabled)" : `core.hooksPath=${value}`,
    );
  if (sub === "install") {
    if (value === HOOKS_PATH) return ok(`already enabled (core.hooksPath=${HOOKS_PATH})`);
    if (value !== null && env["FORCE"] !== "true")
      return refuse(
        `core.hooksPath is already set to '${value}': nothing was changed; rerun with FORCE=true to replace it`,
      );
    git(top, ["config", "--local", "core.hooksPath", HOOKS_PATH]);
    const now = git(top, ["config", "--local", "--get", "core.hooksPath"]);
    return now === HOOKS_PATH
      ? ok(`enabled: core.hooksPath=${HOOKS_PATH} (local config of ${top})`)
      : refuse("git config --local core.hooksPath failed: the hook is not enabled");
  }
  if (value === null) return ok("already disabled (core.hooksPath is not set)");
  if (value !== HOOKS_PATH)
    return refuse(
      `core.hooksPath is '${value}', not '${HOOKS_PATH}': nothing was changed (not set by ci:hooks-install)`,
    );
  git(top, ["config", "--local", "--unset", "core.hooksPath"]);
  return ok("disabled: core.hooksPath unset");
}
