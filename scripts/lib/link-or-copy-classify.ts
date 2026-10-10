// link-or-copy-classify.ts — which symlink refusals fall back to a copy (spec 0255 R15, R21).
// A pure function of (code, platform), plus the ONE place that reads the forced-refusal test seam.
//
// This set deliberately differs from `LINK_REFUSALS` of extension/tree-copy.ts: that one guards the
// recreation of links found INSIDE a copied tree on any platform (so it also accepts POSIX `EPERM`,
// `EACCES` and `UNKNOWN`), whereas here a POSIX `EPERM`/`EACCES` means a wrong landing zone, which
// `ln -s` under `set -e` fails on and a silent copy would mask.

/** Name of the forced-refusal test seam (R21). Never documented as a user feature. */
export const FORCED_REFUSAL_ENV = "CREWRIG_TEST_LINK_REFUSAL";

/** Codes that fall back to a copy on every platform: the file system reports links unsupported. */
export const FALLBACK_ANYWHERE: readonly string[] = ["ENOTSUP", "EOPNOTSUPP", "ENOSYS"];

/** Codes that fall back to a copy on win32 only: the missing symbolic-link privilege. */
export const FALLBACK_WIN32_ONLY: readonly string[] = ["EPERM"];

/** `"fallback"` when a refused link is replaced by a copy, `"rethrow"` when the error propagates. */
export function classifyRefusal(code: string, platform: string): "fallback" | "rethrow" {
  if (FALLBACK_ANYWHERE.includes(code)) return "fallback";
  if (platform === "win32" && FALLBACK_WIN32_ONLY.includes(code)) return "fallback";
  return "rethrow";
}

/**
 * The code to throw instead of linking, when the seam is set; `null` when it is unset or empty.
 * A forced refusal also forces the win32 classification (the caller passes "win32" on a `string`).
 */
export function forcedRefusal(env: Record<string, string | undefined>): string | null {
  const value = env[FORCED_REFUSAL_ENV];
  return value === undefined || value === "" ? null : value;
}
