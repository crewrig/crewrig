// args.ts — command line and `REPO_DIR` (spec 0250 R4).
//
// Twins scripts/build-components.sh :52-62 (the `while`/`case` argument loop) and
// :15 (`REPO_DIR="${REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"`).
//
// The loop is positional, like the shell's: a value-taking flag swallows the next
// argument whatever it looks like (`--target --check` targets `--check`), an
// unrecognised argument is skipped alone, and a later flag overrides an earlier
// one. The shell died on the missing value with `set -u`'s "$2: unbound variable"
// and status 1; the build writes an `Error:` line and the same status (the wording
// is a listed deviation).

import fs from "node:fs";
import path from "node:path";

import type { BuildOptions, Env } from "./types.ts";

export type ParsedArgs =
  | { readonly ok: true; readonly opts: BuildOptions }
  | { readonly ok: false; readonly message: string };

/** The shell's default `IFS` splitting of an unquoted expansion: spaces, tabs, line feeds. */
export function words(text: string): string[] {
  return text.split(/[ \t\n]+/).filter((word) => word !== "");
}

/** Parse `argv` (script arguments only). Pure: nothing is read from the environment. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let target = "all";
  let tierFilter: string[] | null = null;
  let check = false;
  let listOutputDirs = false;
  let resolve: BuildOptions["resolve"] = null;
  let diagnosticsPath = "";

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const first = argv[i + 1];
    const second = argv[i + 2];
    switch (arg) {
      case "--target":
      case "--tier":
      case "--diagnostics": {
        if (first === undefined) return { ok: false, message: `Error: ${arg} requires a value` };
        if (arg === "--target") target = first;
        else if (arg === "--tier") tierFilter = [...(tierFilter ?? []), ...words(first)];
        else diagnosticsPath = first;
        i += 2;
        break;
      }
      case "--resolve": {
        if (first === undefined || second === undefined) {
          return { ok: false, message: "Error: --resolve requires <source> <target>" };
        }
        resolve = first === "" ? null : { source: first, target: second };
        i += 3;
        break;
      }
      case "--check":
        check = true;
        i += 1;
        break;
      case "--list-output-dirs":
        listOutputDirs = true;
        i += 1;
        break;
      default:
        i += 1;
    }
  }
  return {
    ok: true,
    opts: { target, tierFilter, check, listOutputDirs, resolve, diagnosticsPath },
  };
}

/**
 * `REPO_DIR`: the environment value when set and non-empty (kept verbatim), else the
 * physical parent of the directory that holds the entry file. Derived from the entry
 * file's own location, never by searching for a `.git` entry (a copy of `scripts/`
 * in a throwaway tree builds that tree). Not called for `--list-output-dirs`.
 */
export function resolveRepoDir(env: Env, entryFile: string): string {
  const fromEnv = env["REPO_DIR"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return path.resolve(fs.realpathSync.native(path.dirname(entryFile)), "..");
}

/**
 * A path under a root, as the shell printed it (`$REPO_DIR/artifacts`, `$out_root/.gemini/...`):
 * `root + "/" + rel` byte for byte on POSIX, a trailing slash on `root` included; native
 * separators on win32 only. `rel` uses `/`.
 */
export function joinRoot(platform: NodeJS.Platform, root: string, rel: string): string {
  return platform === "win32" ? path.win32.join(root, rel) : `${root}/${rel}`;
}
