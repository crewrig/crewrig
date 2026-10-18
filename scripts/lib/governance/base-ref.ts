// base-ref.ts — TypeScript port of the retired scripts/lib/base-ref-resolve.sh plus the
// remote probe, fetch fallback and unresolvable-base diagnostic shared by the
// version-bump checks (spec 0259; reused by row I2).
//
// Every function takes the directory git runs in (`cwd`, default: the process
// directory, like the shell) and spawns only git. `ts-scope.ts` is not reused:
// its preferredRemote()/resolveBase() are pinned to repoRoot() and origin-first.
//
// Usage:
//   const base = normalizeBaseRef(argv[0] ?? process.env.BASE_REF ?? "");
//   const ref = base !== "" ? base : defaultBaseRef(preferredRemote(cwd), cwd);
//   if (!ensureBaseResolvable(ref, cwd)) { fatal(...unresolvableBaseLines(ref)); exit 2 }
// Exit codes: not applicable (library); the caller maps an unresolvable base to 2.
// Finding-line format: not applicable.

import { runGit } from "./git-run.ts";

function verifies(args: readonly string[], cwd: string): boolean {
  return runGit(args, { cwd }).status === 0;
}

/**
 * Echo `value` unchanged, except that a trailing `/` (an unexpanded CI variable
 * such as `origin/`) yields the empty string so the caller treats it as unset.
 */
export function normalizeBaseRef(value: string): string {
  return value.endsWith("/") ? "" : value;
}

/**
 * The trunk ref used when BASE_REF is unset: `<remote>/main`, else
 * `<remote>/develop` when only that verifies, else `<remote>/main` regardless
 * (so the caller's fetch-then-fail path runs unchanged).
 */
export function defaultBaseRef(remote: string, cwd: string = process.cwd(), repoDir = "."): string {
  const mainRef = `${remote}/main`;
  const developRef = `${remote}/develop`;
  if (verifies(["-C", repoDir, "rev-parse", "--verify", mainRef], cwd)) return mainRef;
  if (verifies(["-C", repoDir, "rev-parse", "--verify", developRef], cwd)) return developRef;
  return mainRef;
}

/**
 * First of `<name>`, `<remote>/<name>` that verifies as a commit, or `null`.
 * Bare-first (the opposite of ts-scope.ts). A name already starting with
 * `<remote>/` is tried once; a name starting with `-` or empty never resolves.
 */
export function resolveRemoteRef(
  name: string,
  remote = "origin",
  cwd: string = process.cwd(),
  repoDir = ".",
): string | null {
  if (name === "" || name.startsWith("-")) return null;
  const refs = name.startsWith(`${remote}/`) ? [name] : [name, `${remote}/${name}`];
  for (const ref of refs)
    if (verifies(["-C", repoDir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd))
      return ref;
  return null;
}

/**
 * The remote used to derive the default base: the first remote whose name
 * contains `crewrig` or `origin`, else the first remote, else `""` (the shell
 * pipeline's empty result).
 */
export function preferredRemote(cwd: string = process.cwd()): string {
  const out = runGit(["remote"], { cwd }).stdout.toString("utf8");
  const remotes = out.split("\n").filter((r) => r !== "");
  return remotes.find((r) => /crewrig|origin/.test(r)) ?? remotes[0] ?? "";
}

/**
 * True when `baseRef` verifies, or when a `git fetch --depth=50 <remote> <ref>`
 * (split at the first `/`; the whole string when there is none) makes it
 * succeed. Mirrors the shell: the fetch exit status alone decides.
 */
export function ensureBaseResolvable(baseRef: string, cwd: string = process.cwd()): boolean {
  if (verifies(["rev-parse", "--verify", baseRef], cwd)) return true;
  const slash = baseRef.indexOf("/");
  const remote = slash === -1 ? baseRef : baseRef.slice(0, slash);
  const ref = slash === -1 ? baseRef : baseRef.slice(slash + 1);
  return verifies(["fetch", "--depth=50", remote, ref], cwd);
}

/**
 * The two-line stderr diagnostic. The default variant is check-skill-versions.sh:
 * its first line holds unescaped backticks inside double quotes, so `git fetch`
 * runs as a command substitution and contributes its (empty) stdout: the real
 * text reads "and  failed." with two spaces. check-extension-version-bump.sh
 * escapes the backticks, so `escaped` yields "and `git fetch` failed.".
 * Frozen from each shell run on an unresolvable-base fixture.
 */
export function unresolvableBaseLines(baseRef: string, escaped = false): [string, string] {
  const fetchText = escaped ? "`git fetch`" : "";
  return [
    `Error: cannot resolve base ref '${baseRef}' and ${fetchText} failed.`,
    "       Pass a resolvable ref as the first argument or via BASE_REF.",
  ];
}
