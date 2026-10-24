// mempalace-range-scan.ts — the repo-wide MemPalace range-literal sweep behind
// mempalace-version-range.test.ts (spec 0263, ported from scan_repo of
// test-mempalace-version-range.sh, spec 0082 R5 delta-01).
//
// The sweep runs on `git grep` (tracked content only), never a filesystem walk.
// Check (a): the superseded literal range must not survive anywhere.
// Check (b): every literal numeric `mempalace>=<x>,<<y>` token must equal the
// current pin; the `${VAR}` interpolated form never matches the numeric anchor.
// This file names no numeric install-hint literal: patterns are assembled at
// runtime so the sweep never flags its own sources.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scrubGitEnv } from "../../lib/git-env.ts";

/** Pathspecs excluded from both checks: immutable records and the guard's own files. */
export const EXCLUDES: readonly string[] = [
  ":(exclude)docs/adr/**",
  ":(exclude)specs/**",
  ":(exclude)scripts/tests/mempalace-version-range.test.ts",
  ":(exclude)scripts/tests/lib/mempalace-range-scan.ts",
];

export interface ScanOptions {
  /** The current pin as the install spec, e.g. the output of installSpec(pin). */
  readonly expectedSpec: string;
  /** ERE matching the superseded literal range (check a). */
  readonly oldLiteralRe: string;
}

export interface ScanResult {
  readonly violations: string[];
}

/** Environment that shields git from the machine's own configuration. */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = scrubGitEnv(process.env);
  env["GIT_CONFIG_GLOBAL"] = os.devNull;
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  return env;
}

function git(repo: string, args: readonly string[]): { status: number | null; stdout: string } {
  const r = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: gitEnv(),
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout };
}

/** The ERE for a superseded range, with escaped dots (no contiguous literal). */
export function supersededRe(oldMin: string, oldMax: string): string {
  const esc = (s: string): string => s.replaceAll(".", "\\.");
  return `${esc(oldMin)},<${esc(oldMax)}`;
}

function grepLines(repo: string, pattern: string): string[] {
  // Exit 1 (no match) and any other failure both mean "no hits", as `|| true` did.
  const r = git(repo, ["grep", "-nE", pattern, "--", ".", ...EXCLUDES]);
  return r.status === 0 ? r.stdout.split("\n").filter((l) => l !== "") : [];
}

/** Scan the tracked content of `repoDir`; an empty `violations` means clean. */
export function scanRepo(repoDir: string, opts: ScanOptions): ScanResult {
  const violations: string[] = [];
  for (const hit of grepLines(repoDir, opts.oldLiteralRe)) {
    violations.push(`STALE RANGE: ${hit}`);
  }
  const tokenRe = new RegExp(`mempalace>=[0-9][0-9.,<]*`, "g");
  for (const hit of grepLines(repoDir, "mempalace>=[0-9]")) {
    const m = /^([^:]*):(\d+):(.*)$/s.exec(hit);
    if (m === null) continue;
    const [, file = "", lineno = "", content = ""] = m;
    for (const token of content.match(tokenRe) ?? []) {
      if (token !== opts.expectedSpec) {
        violations.push(
          `DIVERGENT RANGE: ${file}:${lineno}: '${token}' (want '${opts.expectedSpec}')`,
        );
      }
    }
  }
  return { violations };
}

/** A fresh git-init repository under `parent`, configured per command only. */
export function newRepo(parent: string): string {
  const repo = fs.mkdtempSync(path.join(parent, "repo-"));
  const r = spawnSync("git", ["-C", repo, "init", "-q"], { env: gitEnv() });
  if (r.status !== 0) throw new Error("git init failed");
  return repo;
}

/** Write `content` to `file` and commit it; the scan reads tracked content. */
export function makeCommit(repo: string, file: string, content: string): void {
  writeFile(repo, file, content);
  commitAll(repo);
}

/** Write a file without tracking it. */
export function writeFile(repo: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), `${content}\n`);
}

/** Stage everything and commit with per-command identity options. */
export function commitAll(repo: string): void {
  const c = [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "-c",
    "commit.gpgsign=false",
  ];
  git(repo, ["add", "-A"]);
  const r = git(repo, [...c, "commit", "-q", "-m", "fixture"]);
  if (r.status !== 0) throw new Error("git commit failed");
}
