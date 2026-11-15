// branches.ts — the GitHub `on.push` branch evaluator of the R6 wiring test (spec 0309 delta-02
// R6, wiring test (b)): does a workflow's `push` trigger name `main` or a `release/` branch, and
// does it carry a path filter.
//
// Usage: readPush(on) -> null (no push key) or {counts, refs, paths, pathsIgnore}; throws
// UnresolvedPatternError (fail closed) on a branch pattern outside the closed matcher.
//
// The matcher knows literals, `*` (no `/`) and `**` (any). `?`, `+`, `[...]` and a backslash are
// outside it and fail closed; a `!` pattern negates the earlier matches of its list.

/** The refs a push trigger is evaluated for: `main` and one `release/` branch. */
export const PUSH_REFS = ["main", "release/1.0"] as const;

export class UnresolvedPatternError extends Error {}

const OUTSIDE = /[?+[\]\\]/;

function toRegExp(pattern: string): RegExp {
  if (OUTSIDE.test(pattern))
    throw new UnresolvedPatternError(`branch pattern '${pattern}' is outside the closed matcher`);
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern.charAt(i);
    if (ch === "*") {
      if (pattern.charAt(i + 1) === "*") {
        src += ".*";
        i++;
      } else src += "[^/]*";
    } else src += ch.replace(/[.^$|(){}]/g, "\\$&");
  }
  return new RegExp(`^${src}$`);
}

/** Whether the pattern list selects `name`; a list with no positive pattern fails closed. */
export function listMatches(patterns: string[], name: string): boolean {
  if (!patterns.some((p) => !p.startsWith("!")))
    throw new UnresolvedPatternError("a branch pattern list holds no positive pattern");
  let hit = false;
  for (const p of patterns) {
    if (p.startsWith("!")) {
      if (hit && toRegExp(p.slice(1)).test(name)) hit = false;
    } else if (toRegExp(p).test(name)) hit = true;
  }
  return hit;
}

export interface PushTrigger {
  /** True when the trigger fires for a branch push to at least one of PUSH_REFS. */
  counts: boolean;
  /** The refs of PUSH_REFS the trigger fires for. */
  refs: string[];
  paths: boolean;
  pathsIgnore: boolean;
}

function strList(v: unknown, what: string): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((e) => typeof e === "string")) return v as string[];
  throw new UnresolvedPatternError(`${what} is not a list of strings`);
}

/** The `push` trigger of an `on:` value; null when the workflow declares none. */
export function readPush(on: unknown): PushTrigger | null {
  let push: unknown;
  if (typeof on === "string") push = on === "push" ? {} : undefined;
  else if (Array.isArray(on)) push = on.includes("push") ? {} : undefined;
  else if (on !== null && typeof on === "object")
    push = Object.hasOwn(on, "push") ? ((on as Record<string, unknown>)["push"] ?? {}) : undefined;
  if (push === undefined) return null;
  if (typeof push !== "object" || Array.isArray(push))
    throw new UnresolvedPatternError("the push trigger is not a mapping");
  const m = push as Record<string, unknown>;
  const has = (k: string): boolean => m[k] !== undefined && m[k] !== null;
  if (has("branches") && has("branches-ignore"))
    throw new UnresolvedPatternError("the push trigger declares both branches and branches-ignore");
  const tagsOnly =
    !has("branches") && !has("branches-ignore") && (has("tags") || has("tags-ignore"));
  let refs: string[] = [...PUSH_REFS];
  if (tagsOnly) refs = [];
  else if (has("branches")) {
    const list = strList(m["branches"], "branches");
    refs = refs.filter((r) => listMatches(list, r));
  } else if (has("branches-ignore")) {
    const list = strList(m["branches-ignore"], "branches-ignore");
    refs = refs.filter((r) => !list.some((p) => toRegExp(p).test(r)));
  }
  return { counts: refs.length > 0, refs, paths: has("paths"), pathsIgnore: has("paths-ignore") };
}
