// machine-paths.ts — reject machine-specific home paths in tracked files
// (spec 0081 R5/R6; TypeScript twin of check-no-machine-paths.sh, spec 0259).
//
// `git grep` runs through runGit, so binary-file, attribute and ordering semantics stay
// Git's own. Its output is decoded as latin1 (one char per byte, the C-locale view the
// shell has), parsed on the first two colons like the shell does, and every home-path
// token of a line is extracted with a JS RegExp (the shell uses `grep -oE` per line).
//
// Unsupported: a tracked path that itself contains a colon. The `path:line:content`
// output of `git grep -n` is then ambiguous, in the shell and here alike; the parse is
// kept identical so both twins misreport it the same way.
//
// Standard library only. Reuses git-run.ts.
// Usage: evaluateMachinePaths(repoDir)
// Exit codes: 0 clean, 1 at least one non-benign home path.
// Finding-line format: `<path>:<line>: <token>` on stderr.

import { runGit } from "./git-run.ts";

export interface MachinePathsOutcome {
  code: number;
  /** Standard output text (the OK line). */
  stdout: string;
  /** Standard error bytes (git's own stderr, findings, the FAILED block). */
  stderr: Buffer;
}

const PATTERN = "/(Users|home)/[A-Za-z0-9._-]+(/|$)";
const TOKEN = /([A-Za-z]:)?\/(Users|home)\/[A-Za-z0-9._-]+(\/|$)/g;

/** Self-exclusions: the two shell files, their TypeScript twins and this ticket's scan tests. */
export const EXCLUDES: readonly string[] = [
  "scripts/check-no-machine-paths.sh",
  "scripts/check-no-machine-paths.ts",
  "scripts/tests/governance-check-no-machine-paths.test.ts",
  "scripts/tests/governance-repo-scans-differential.test.ts",
  "scripts/tests/windows-governance-repo-scans.test.ts",
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Whether `token` is a declared benign home path (owner `agent`, or drive-letter `ana`). */
export function isBenignToken(token: string, content: string): boolean {
  const pathPart = token.replace(/^[A-Za-z]:/, "");
  const owner = pathPart.replace(/^\/[^/]*\//, "").replace(/\/.*$/, "");
  // agent: e2e container's non-root user (docker/e2e/base.Dockerfile, uid/gid 1000).
  if (owner === "agent") return true;
  // ana: fictional owner of example Windows checkout paths; drive-letter /Users/ form only,
  // starting a word (a host-prefixed form is not a drive letter). Owner decision on #1326 and #1438.
  if (owner === "ana") {
    if (pathPart === token) return false;
    if (!pathPart.startsWith("/Users/")) return false;
    return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(token)}`).test(content);
  }
  return false;
}

/** Scan the tracked files of `repoDir` and build the check's outcome. */
export function evaluateMachinePaths(repoDir: string): MachinePathsOutcome {
  const git = runGit(
    ["grep", "-nE", PATTERN, "--", ".", ...EXCLUDES.map((p) => `:(exclude)${p}`)],
    { cwd: repoDir },
  );
  const findings: string[] = [];
  for (const hit of git.stdout.toString("latin1").split("\n")) {
    const i = hit.indexOf(":");
    const rest = i < 0 ? hit : hit.slice(i + 1);
    const file = i < 0 ? hit : hit.slice(0, i);
    const j = rest.indexOf(":");
    const lineno = j < 0 ? rest : rest.slice(0, j);
    const content = j < 0 ? rest : rest.slice(j + 1);
    for (const m of content.matchAll(TOKEN)) {
      if (m[0] !== "" && !isBenignToken(m[0], content)) findings.push(`${file}:${lineno}: ${m[0]}`);
    }
  }
  const lines = [...findings];
  let code = 0;
  let stdout = "";
  if (findings.length > 0) {
    code = 1;
    lines.push(
      "",
      `FAILED: ${findings.length} machine-specific home-directory path(s) in tracked files (spec 0081).`,
      "",
      "Tracked files must not contain absolute /Users/<user>/ or /home/<user>/ paths.",
      "Replace them with a neutral placeholder ($HOME, <user>, <repo>). The benign",
      "owners declared in scripts/check-no-machine-paths.sh are allowed: 'agent'",
      "(docker/e2e/base.Dockerfile) and 'ana' (Windows drive-letter form C:/Users/ana/",
      "only). A new benign owner requires a one-line, commented addition citing its source.",
    );
  } else {
    stdout = "OK: no machine-specific home-directory paths in tracked files.\n";
  }
  const body = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  // git's own stderr reaches the terminal first in the shell (`|| true` swallows only the status).
  return {
    code,
    stdout,
    stderr: Buffer.concat([git.stderr, Buffer.from(body, "latin1")]),
  };
}
