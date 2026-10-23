// select.ts — changeset-aware selection of the pre-push checks (spec 0279 R8, R9, R13).
//
// Usage: imported by scripts/ci-pre-push.ts (never run directly).
// Exit: none; functions throw PrePushError (message names the cause and the fix) on an
//   unreadable input, an unsupported glob or a missing tier file, and the entry maps it to 1.
// Finding format: notices are one-line strings, `ci-pre-push: <text>`-prefixed by the caller.
//
// Reads the capability file through the CI-parity reader (readCapabilities / TriggerRecord.paths)
// and compiles globs with the shared glob engine: no second source of paths, no second matcher.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { globToRegExp, UnsupportedGlobError } from "../glob-engine.ts";
import { readCapabilities } from "../ci-parity/reference-read.ts";
import type { CapRecord } from "../ci-parity/state.ts";
import { parse } from "../yq-accessors/index.ts";

export const DEFAULT_TARGET = "origin/main";
export const CAPABILITIES_FILE = "ci/ci-capabilities.yml";
export const TIER_FILE = "ci/pre-push-tier.json";

/** An error whose message names the cause and the fix; the entry prints it and exits 1. */
export class PrePushError extends Error {}

export interface Selection {
  /** Selected capability ids, in tier-file order. */
  ids: string[];
  notices: string[];
  /** The target ref when it resolves locally (the value to export as BASE_REF), else null. */
  baseRef: string | null;
}

function git(repoDir: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", [...args], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/** The target ref name: CREWRIG_PRE_PUSH_BASE when set and non-empty, else origin/main. */
export function targetRef(env: NodeJS.ProcessEnv = process.env): string {
  const v = env["CREWRIG_PRE_PUSH_BASE"];
  return v !== undefined && v !== "" ? v : DEFAULT_TARGET;
}

/** True when `ref` names a commit in the local repository. Local only: never fetches. */
export function refResolves(repoDir: string, ref: string): boolean {
  return git(repoDir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

/** Capability records of `<repoDir>/ci/ci-capabilities.yml`. */
export function loadCapabilities(repoDir: string): CapRecord[] {
  const file = path.join(repoDir, CAPABILITIES_FILE);
  try {
    return readCapabilities(parse(readFileSync(file, "utf8")));
  } catch (err) {
    throw new PrePushError(
      `cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The fast tier: `{ "<id>": seconds }` of ci/pre-push-tier.json. Fails closed when unreadable. */
export function loadTier(repoDir: string): Record<string, number> {
  const file = path.join(repoDir, TIER_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new PrePushError(
      `cannot read the fast tier ${file}: ${err instanceof Error ? err.message : String(err)}; restore it from the repository`,
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new PrePushError(`${file} must be a JSON object { "<capability id>": <seconds> }`);
  const out: Record<string, number> = {};
  for (const [id, seconds] of Object.entries(raw)) {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0)
      throw new PrePushError(`${file}: the time recorded for '${id}' is not a non-negative number`);
    out[id] = seconds;
  }
  return out;
}

/** Committed changes of `sha` against its merge-base with `target`; `reason` set when unresolved. */
export function changedFiles(
  repoDir: string,
  target: string,
  sha: string,
): { files: string[]; reason: string | null } {
  if (!refResolves(repoDir, target))
    return { files: [], reason: `target ref '${target}' does not resolve locally` };
  const mb = git(repoDir, ["merge-base", sha, target]);
  if (mb === null || mb.trim() === "")
    return { files: [], reason: `no merge-base between ${sha.slice(0, 12)} and '${target}'` };
  const out = git(repoDir, ["diff", "--name-only", "--no-renames", "-z", `${mb.trim()}..${sha}`]);
  if (out === null)
    return { files: [], reason: `git diff failed from merge-base ${mb.trim().slice(0, 12)}` };
  return { files: out.split("\0").filter((f) => f !== ""), reason: null };
}

/**
 * Pure selection (R8c, R8g). `files` null means "unresolved base": every tier capability runs.
 * A capability without a `pull-request` trigger, or with an unreadable `paths:` list, runs with a
 * notice; no `paths:` on its pull-request triggers means it always runs.
 */
export function selectFromChangeset(
  caps: readonly CapRecord[],
  tier: Record<string, number>,
  files: readonly string[] | null,
): { ids: string[]; notices: string[] } {
  const byId = new Map(caps.map((c) => [c.id, c]));
  const ids: string[] = [];
  const notices: string[] = [];
  for (const id of Object.keys(tier)) {
    const cap = byId.get(id);
    if (cap === undefined)
      throw new PrePushError(
        `${TIER_FILE} names '${id}', which has no capability in ${CAPABILITIES_FILE}; remove it from the tier`,
      );
    if (files === null) {
      ids.push(id);
      continue;
    }
    const prs = cap.triggers.filter((t) => t.kind === "pull-request");
    if (prs.length === 0) {
      notices.push(`'${id}' has no pull-request trigger: running it`);
      ids.push(id);
      continue;
    }
    if (prs.some((t) => t.pathsBad)) {
      notices.push(`'${id}' has an unreadable paths filter: running it`);
      ids.push(id);
      continue;
    }
    if (prs.some((t) => t.paths.length === 0)) {
      ids.push(id);
      continue;
    }
    let matched = false;
    try {
      const res = prs.flatMap((t) => t.paths).map((g) => globToRegExp(g));
      matched = files.some((f) => res.some((re) => re.test(f)));
    } catch (err) {
      if (err instanceof UnsupportedGlobError)
        throw new PrePushError(`${CAPABILITIES_FILE}, capability '${id}': ${err.message}`);
      throw err;
    }
    if (matched) ids.push(id);
  }
  return { ids, notices };
}

/** Full selection for the pushed commits `shas` (R8): union of per-sha changesets. */
export function selectForShas(
  repoDir: string,
  shas: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Selection {
  const caps = loadCapabilities(repoDir);
  const tier = loadTier(repoDir);
  const target = targetRef(env);
  const baseRef = refResolves(repoDir, target) ? target : null;
  const union = new Set<string>();
  const reasons: string[] = [];
  for (const sha of shas) {
    const r = changedFiles(repoDir, target, sha);
    if (r.reason !== null) reasons.push(r.reason);
    for (const f of r.files) union.add(f);
  }
  const notices: string[] = [];
  let files: string[] | null = [...union].sort();
  if (reasons.length > 0) {
    notices.push(`${[...new Set(reasons)].join("; ")}: running every fast-tier check`);
    files = null;
  }
  const sel = selectFromChangeset(caps, tier, files);
  return { ids: sel.ids, notices: [...notices, ...sel.notices], baseRef };
}
