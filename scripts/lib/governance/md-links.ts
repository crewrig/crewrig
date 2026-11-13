// md-links.ts — repository scan of relative Markdown links (spec 0259; replaces
// the python3 body of scripts/check-markdown-links.sh).
//
// Usage: runMarkdownLinks(args, cwd) -> { code, lines }
// Files come from the positional arguments or `git ls-files -z -- '*.md'`, both
// relative to the Git top level of the CURRENT working directory (not
// CREWRIG_REPO_DIR); the process changes into that top level, as the script did.
// Exit codes: 0 all links resolve, 1 a broken link or no Git repository.
// Finding-line format: `FAIL: <file>:<line>: '<target>' -> resolved to '<path>'
// (does not exist)`, then `Found N broken relative Markdown link(s).`; all on
// stdout. Printed paths use forward slashes (requirement 24 (b)).
//
// Reuses git-run.ts (runGit). The text rules live in md-links-extract.ts.

import { existsSync, readFileSync, statSync } from "node:fs";
import { sharedTopic } from "../skill-citations/grammar.ts";
import { runGit } from "./git-run.ts";
import {
  decodeIgnore,
  dirnamePy,
  linkTargets,
  pyStrip,
  resolveTarget,
  splitLines,
  stripAngles,
} from "./md-links-extract.ts";

export interface LinksOutcome {
  code: 0 | 1;
  /** Standard-output lines, without trailing newlines. */
  lines: string[];
  /** Standard-error line when the run could not start (deviation (d)). */
  error?: string;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function toplevel(cwd: string): string | undefined {
  const res = runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (res.status !== 0) return undefined;
  return pyStrip(res.stdout.toString("utf8"));
}

function trackedMarkdown(cwd: string): string[] {
  const res = runGit(["ls-files", "-z", "--", "*.md"], { cwd });
  return res.stdout
    .toString("utf8")
    .split("\0")
    .filter((p) => p !== "");
}

const SKILL_REFERENCE =
  /^artifacts\/[^/]+\/skills\/[^/]+\/(references\/shared-[^/]+\.md)$/;

/**
 * The source a skill's `references/shared-<topic>.md` citation stands for: the build copies
 * `artifacts/core/shared/references/<topic>.md` to that path in every built skill, so inside
 * a skill source the citation resolves there (as the build and check-skill-quality do).
 * Returns undefined when `resolved` is not such a citation.
 */
function sharedSource(resolved: string): string | undefined {
  const m = SKILL_REFERENCE.exec(resolved);
  const topic = m === null ? undefined : sharedTopic(m[1] as string);
  return topic === undefined
    ? undefined
    : `artifacts/core/shared/references/${topic}.md`;
}

function scanFile(rel: string, shown: string, lines: string[]): number {
  const fileDir = dirnamePy(rel);
  let broken = 0;
  let inCode = false;
  splitLines(decodeIgnore(readFileSync(rel))).forEach((line, idx) => {
    if (pyStrip(line).startsWith("```")) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    for (const raw of linkTargets(line)) {
      const resolved = resolveTarget(raw, fileDir);
      if (resolved === null || existsSync(resolved)) continue;
      const source = sharedSource(resolved);
      if (source !== undefined && existsSync(source)) continue;
      const target = stripAngles(raw);
      lines.push(
        `FAIL: ${shown}:${idx + 1}: '${target}' -> resolved to '${source ?? resolved}' (does not exist)`,
      );
      broken++;
    }
  });
  return broken;
}

export function runMarkdownLinks(
  args: readonly string[],
  cwd: string,
): LinksOutcome {
  const top = toplevel(cwd);
  if (top === undefined)
    return { code: 1, lines: [], error: `Error: ${cwd}: not a git repository` };
  process.chdir(top);
  const files = args.length > 0 ? [...args] : trackedMarkdown(top);
  const lines: string[] = [];
  let errors = 0;
  for (const rel of files) {
    if (!isFile(rel)) continue;
    const shown =
      process.platform === "win32" ? rel.replaceAll("\\", "/") : rel;
    errors += scanFile(rel, shown, lines);
  }
  if (errors > 0) {
    lines.push(`Found ${errors} broken relative Markdown link(s).`);
    return { code: 1, lines };
  }
  lines.push("All relative Markdown links resolved cleanly.");
  return { code: 0, lines };
}
