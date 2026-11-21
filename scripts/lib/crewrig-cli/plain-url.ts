// plain-url.ts — plain URLs and repository URLs of the framework entry point (spec 0314, shared
// definitions; R14, R16). The launcher keeps its own copy: it must run before any file is installed.

/** The canonical repository of the framework, the value of `canonical_repo` (spec 0314 R16). */
export const CANONICAL_REPO = "https://github.com/crewrig/crewrig";

/**
 * A plain URL: WHATWG-parsable, scheme http or https, a non-empty host, no userinfo, no whitespace or
 * control character, no double quote and no backslash.
 */
export function isPlainUrl(text: string): boolean {
  if (/[\s"\\\p{Cc}]/u.test(text)) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.hostname !== "" && url.username === "" && url.password === "";
}

/** Remove one trailing `/`, then one `.git` suffix (spec 0314 R14). */
export function normalizeRepo(text: string): string {
  const slashed = text.endsWith("/") ? text.slice(0, -1) : text;
  return slashed.endsWith(".git") ? slashed.slice(0, -".git".length) : slashed;
}

/** A repository URL: `https://<host>/<owner>/<repo>` with no query, no fragment and exactly two path segments. */
export function isRepositoryUrl(text: string): boolean {
  if (!isPlainUrl(text) || text.includes("?") || text.includes("#")) return false;
  const url = new URL(text);
  if (url.protocol !== "https:") return false;
  const segments = url.pathname.split("/");
  return segments.length === 3 && segments[1] !== "" && segments[2] !== "";
}

/**
 * Whether a normalised value designates the canonical repository: scheme http or https, host github.com
 * or www.github.com, path /crewrig/crewrig, the host and the path compared case-insensitively.
 */
export function designatesCanonical(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  const schemeOk = url.protocol === "http:" || url.protocol === "https:";
  const hostOk = url.hostname === "github.com" || url.hostname === "www.github.com";
  return schemeOk && hostOk && url.pathname.toLowerCase() === "/crewrig/crewrig";
}
