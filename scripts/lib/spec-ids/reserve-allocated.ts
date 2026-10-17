// reserve-allocated.ts — the allocated set, the per-issue lookup and the high-water
// mark of reserve-spec-id (spec 0262).
//
// Usage: loadAllocated(ctx) / findIssueReservation(ctx) / nextFreeId(ids)
// Exit codes: not applicable (library).
// Finding-line format: not applicable.

import { readdirSync, statSync } from "node:fs";
import { runGit } from "../governance/git-run.ts";
import { CARRIER_PRIMARY, CARRIER_TAGS } from "./reserve-carrier.ts";
import { note } from "./exit.ts";

export interface Ctx {
  repoDir: string;
  remote: string;
  referenceRef: string;
  issue: string;
  offline: boolean;
}

const PATTERN_PRIMARY = "refs/spec-ids/*";
const PATTERN_TAGS = "refs/tags/spec-id/*";

function git(ctx: Ctx, args: string[]): { status: number; stdout: string } {
  const res = runGit(["-C", ctx.repoDir, ...args], { cwd: process.cwd() });
  return { status: res.status, stdout: res.stdout.toString("utf8") };
}

function idsFromSpecPaths(paths: string[]): string[] {
  const ids: string[] = [];
  for (const p of paths) {
    if (p === "" || p.startsWith("specs/org/") || !p.startsWith("specs/")) continue;
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (base.includes(".delta-") || base === "_template.md" || base === "README.md") continue;
    if (/^[0-9]{4}-.*\.md$/s.test(base)) ids.push(base.slice(0, base.indexOf("-")));
  }
  return ids;
}

function verifies(ctx: Ctx): boolean {
  return git(ctx, ["rev-parse", "--verify", "--quiet", ctx.referenceRef]).status === 0;
}

function mergedSpecPaths(ctx: Ctx): string[] {
  if (!ctx.offline) {
    if (!verifies(ctx)) {
      const branch = ctx.referenceRef.slice(ctx.referenceRef.indexOf("/") + 1);
      if (branch !== "" && branch !== ctx.referenceRef)
        git(ctx, ["fetch", "--depth=50", ctx.remote, branch]);
    }
    if (verifies(ctx)) {
      const listing = git(ctx, ["ls-tree", "-r", "--name-only", ctx.referenceRef, "--", "specs/"]);
      const text = (listing.status === 0 ? listing.stdout : "").replace(/\n+$/, "");
      if (text !== "") return text.split("\n");
    }
  }
  try {
    return readdirSync(`${ctx.repoDir}/specs`)
      .filter((n) => !n.startsWith(".") && n.endsWith(".md"))
      .filter(
        (n) => statSync(`${ctx.repoDir}/specs/${n}`, { throwIfNoEntry: false })?.isFile() === true,
      )
      .sort()
      .map((n) => `specs/${n}`);
  } catch {
    return [];
  }
}

function idsFromLsRemote(prefix: string, listing: string): string[] {
  const ids: string[] = [];
  for (const line of listing.split("\n")) {
    if (line === "") continue;
    const ref = line.slice(line.indexOf("\t") + 1);
    if (ref.endsWith("^{}")) continue;
    if (ref.startsWith(prefix)) ids.push(ref.slice(prefix.length));
  }
  return ids;
}

/** The allocated ids, plus whether the primary namespace could be read. */
export function loadAllocated(ctx: Ctx): { ids: string[]; readable: boolean } {
  const ids = idsFromSpecPaths(mergedSpecPaths(ctx));
  if (ctx.offline) return { ids, readable: false };
  const primary = git(ctx, ["ls-remote", ctx.remote, PATTERN_PRIMARY]);
  if (primary.status !== 0) {
    note(
      `Notice: cannot read '${PATTERN_PRIMARY}' on '${ctx.remote}' — no access, or the remote is unreachable.`,
    );
    return { ids, readable: false };
  }
  const tags = git(ctx, ["ls-remote", ctx.remote, PATTERN_TAGS]);
  ids.push(...idsFromLsRemote(CARRIER_PRIMARY, primary.stdout));
  ids.push(...idsFromLsRemote(CARRIER_TAGS, tags.status === 0 ? tags.stdout : ""));
  return { ids, readable: true };
}

function findIn(ctx: Ctx, pattern: string): string {
  const probe = `refs/spec-id-issue-probe/${process.pid}`;
  const fetched = git(ctx, [
    "fetch",
    "--no-tags",
    "--quiet",
    "--force",
    ctx.remote,
    `+${pattern}:${probe}/*`,
  ]);
  if (fetched.status !== 0) return "";
  let id = "";
  const refs = git(ctx, ["for-each-ref", "--format=%(refname) %(subject)", probe]);
  for (const line of (refs.status === 0 ? refs.stdout : "").split("\n")) {
    if (line === "") continue;
    const space = line.indexOf(" ");
    const ref = space === -1 ? line : line.slice(0, space);
    const msg = space === -1 ? line : line.slice(space + 1);
    if (msg.endsWith(`issue #${ctx.issue}`)) {
      id = ref.slice(probe.length + 1);
      break;
    }
  }
  const names = git(ctx, ["for-each-ref", "--format=delete %(refname)", probe]);
  if (names.status === 0)
    runGit(["-C", ctx.repoDir, "update-ref", "--stdin"], {
      cwd: process.cwd(),
      input: names.stdout,
    });
  return id;
}

export function findIssueReservation(ctx: Ctx): string {
  const id = findIn(ctx, PATTERN_PRIMARY);
  return id !== "" ? id : findIn(ctx, PATTERN_TAGS);
}

/** `max(four-digit ids) + 1`, zero-padded to four digits. */
export function nextFreeId(ids: string[]): string {
  let highest = 0;
  for (const id of ids) if (/^[0-9]{4}$/.test(id)) highest = Math.max(highest, Number(id));
  return String(highest + 1).padStart(4, "0");
}
