// version.ts — the tag grammar of the framework release unit and its version source (spec 0310 R1;
// spec 0288 R26 guard 1). The version is declared in exactly one place: `version` of the root
// package.json at the tagged commit.

import { gitText } from "./git.ts";

const CORE = "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
const STABLE_TAG = new RegExp(`^crewrig-v(${CORE})$`);
const PRERELEASE_TAG = new RegExp(`^crewrig-v(${CORE})-next\\.([1-9][0-9]*)$`);
const CORE_VERSION = new RegExp(`^${CORE}$`);

export interface ParsedTag {
  readonly kind: "stable" | "prerelease";
  readonly tag: string;
  /** `X.Y.Z`, the part the declared version must equal. */
  readonly core: string;
  /** The full version of the asset name: `X.Y.Z` or `X.Y.Z-next.N`. */
  readonly version: string;
}

/** The parsed tag, or `undefined` when it is not of the exact `crewrig-v...` form of its kind. */
export function parseTag(tag: string, kind: "stable" | "prerelease"): ParsedTag | undefined {
  const match = (kind === "stable" ? STABLE_TAG : PRERELEASE_TAG).exec(tag);
  const core = match?.[1];
  if (match === null || core === undefined) return undefined;
  return { kind, tag, core, version: kind === "stable" ? core : `${core}-next.${match[5] ?? ""}` };
}

export function isCoreVersion(text: string): boolean {
  return CORE_VERSION.test(text);
}

export function assetName(version: string): string {
  return `crewrig-${version}.tgz`;
}

/** The `version` of package.json at `commit`; throws with a readable message when it cannot be read. */
export function declaredVersion(repo: string, commit: string): string {
  const raw = gitText(repo, ["show", `${commit}:package.json`]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`package.json at ${commit} is not valid JSON`);
  }
  const version = (parsed as { version?: unknown } | null)?.version;
  if (typeof version !== "string" || version === "") {
    throw new Error(`package.json at ${commit} declares no version`);
  }
  return version;
}
